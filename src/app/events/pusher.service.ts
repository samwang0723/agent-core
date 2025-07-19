import Pusher from 'pusher';
import {
  Event,
  EventBroadcastResult,
  EventType,
  EventPriority,
  EventSource,
} from './event.types';
import logger from '../utils/logger';
import { eventSubscriptionManager } from './subscription.manager';
import { EventStorage } from './event.storage';
import { eventToChatService } from './event-to-chat.service';

export class PusherEventBroadcaster {
  private static instance: PusherEventBroadcaster;
  private pusher: Pusher;
  private eventStorage: EventStorage;

  private constructor() {
    // Initialize Pusher with environment variables
    this.pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID || '',
      key: process.env.PUSHER_KEY || '',
      secret: process.env.PUSHER_SECRET || '',
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      useTLS: true,
    });

    this.eventStorage = new EventStorage();

    logger.info('Pusher Event Broadcaster initialized', {
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      appId: process.env.PUSHER_APP_ID || 'not set',
    });
  }

  public static getInstance(): PusherEventBroadcaster {
    if (!PusherEventBroadcaster.instance) {
      PusherEventBroadcaster.instance = new PusherEventBroadcaster();
    }
    return PusherEventBroadcaster.instance;
  }

  public async broadcastEvent(event: Event): Promise<EventBroadcastResult> {
    try {
      // Store the event for persistence
      await this.eventStorage.storeEvent(event);

      // Add process identification for debugging cross-process issues
      logger.info(`Broadcasting event ${event.id} for user ${event.userId}, type: ${event.type}, PID: ${process.pid}`);

      // Check if user has active subscriptions for this event type
      const hasSubscription =
        await eventSubscriptionManager.hasActiveSubscription(
          event.userId,
          event.type
        );

      if (!hasSubscription) {
        // Changed to INFO level to make this visible across processes
        logger.info(
          `SUBSCRIPTION_MISSING: User ${event.userId} has no active subscription for event type ${event.type} in process ${process.pid}`
        );
        
        // Auto-create default subscription to fix cross-process issue
        logger.info(`Auto-creating default subscription for user ${event.userId} in process ${process.pid}`);
        await eventSubscriptionManager.initializeDefaultSubscription(event.userId);
        
        // Verify subscription was created
        const hasSubscriptionNow = await eventSubscriptionManager.hasActiveSubscription(
          event.userId,
          event.type
        );
        
        if (!hasSubscriptionNow) {
          logger.error(`Failed to create subscription for user ${event.userId} in process ${process.pid}`);
          return {
            success: true,
            subscriberCount: 0,
            eventId: event.id,
          };
        }
        
        logger.info(`Successfully created subscription for user ${event.userId} in process ${process.pid}`);
      }

      // Create user-specific channel
      const channelName = `user-${event.userId}`;

      // Prepare event data for Pusher
      const eventData = {
        id: event.id,
        timestamp: event.timestamp.toISOString(),
        priority: event.priority,
        source: event.source,
        ...event.data,
      };

      // Broadcast to user's private channel
      await this.pusher.trigger(channelName, event.type, eventData);

      logger.info(`SUCCESS: Broadcasted event ${event.id} to channel ${channelName} in process ${process.pid}`, {
        eventType: event.type,
        userId: event.userId,
        priority: event.priority,
        processId: process.pid,
      });

      // Convert calendar events to chat messages (non-blocking)
      this.convertEventToChatAsync(event);

      return {
        success: true,
        subscriberCount: 1, // Pusher handles the actual subscriber count
        eventId: event.id,
      };
    } catch (error) {
      logger.error(`Failed to broadcast event ${event.id} via Pusher`, {
        error: error instanceof Error ? error.message : String(error),
        userId: event.userId,
        eventType: event.type,
      });

      return {
        success: false,
        subscriberCount: 0,
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async broadcastToUser(
    userId: string,
    eventType: EventType,
    data: Record<string, unknown>
  ): Promise<void> {
    const event: Event = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      type: eventType,
      timestamp: new Date(),
      data,
      priority: EventPriority.MEDIUM,
      source: EventSource.SYSTEM,
    } as Event;

    await this.broadcastEvent(event);
  }

  public async broadcastSystemNotification(
    message: string,
    userIds?: string[]
  ): Promise<void> {
    const eventData = {
      title: 'System Notification',
      message,
      timestamp: new Date().toISOString(),
    };

    try {
      if (userIds && userIds.length > 0) {
        // Broadcast to specific users
        for (const userId of userIds) {
          const channelName = `user-${userId}`;
          await this.pusher.trigger(
            channelName,
            'system_notification',
            eventData
          );
        }
        logger.info(
          `Broadcasted system notification to ${userIds.length} specific users`
        );
      } else {
        // Broadcast to all users (use a global channel)
        await this.pusher.trigger(
          'global-notifications',
          'system_notification',
          eventData
        );
        logger.info('Broadcasted system notification to all users');
      }
    } catch (error) {
      logger.error('Failed to broadcast system notification via Pusher', {
        error: error instanceof Error ? error.message : String(error),
        userIds: userIds?.length || 'all',
      });
    }
  }

  public async authenticateUser(
    socketId: string,
    channelName: string,
    userId: string
  ): Promise<string> {
    try {
      // Validate that the user is trying to access their own channel
      const expectedChannel = `user-${userId}`;
      if (channelName !== expectedChannel) {
        throw new Error('Unauthorized channel access');
      }

      // Generate authentication signature for private channel
      const authResponse = this.pusher.authorizeChannel(socketId, channelName);

      logger.info(`Authenticated user ${userId} for channel ${channelName}`);

      return authResponse.auth;
    } catch (error) {
      logger.error(
        `Failed to authenticate user ${userId} for channel ${channelName}`,
        {
          error: error instanceof Error ? error.message : String(error),
          socketId,
        }
      );
      throw error;
    }
  }

  /**
   * Convert calendar events to chat messages asynchronously (non-blocking)
   */
  private convertEventToChatAsync(event: Event): void {
    // Run in background without blocking the main event broadcasting
    eventToChatService.convertEventToChat(event).catch(error => {
      logger.error('Background chat conversion failed', {
        error: error instanceof Error ? error.message : String(error),
        eventId: event.id,
        userId: event.userId,
      });
    });
  }

  public async cleanup(): Promise<void> {
    // Clean up old events from storage
    await this.eventStorage.cleanup();
  }

  public getChannelInfo(): { key: string; cluster: string; appId: string } {
    return {
      key: process.env.PUSHER_KEY || '',
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      appId: process.env.PUSHER_APP_ID || '',
    };
  }
}

export const pusherEventBroadcaster = PusherEventBroadcaster.getInstance();
