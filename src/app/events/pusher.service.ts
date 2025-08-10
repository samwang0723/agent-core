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

    // Add Pusher error handling to prevent crashes
    this.setupPusherErrorHandling();

    this.eventStorage = new EventStorage();

    logger.info('Pusher Event Broadcaster initialized', {
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      appId: process.env.PUSHER_APP_ID || 'not set',
    });
  }

  private setupPusherErrorHandling(): void {
    // The server-side Pusher SDK does not expose a client-like connection API.
    // We rely on robust error handling in `safeTrigger` per request instead.
    return;
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
      logger.info(
        `Broadcasting event ${event.id} for user ${event.userId}, type: ${event.type}, PID: ${process.pid}`
      );

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
        logger.info(
          `Auto-creating default subscription for user ${event.userId} in process ${process.pid}`
        );
        await eventSubscriptionManager.initializeDefaultSubscription(
          event.userId
        );

        // Verify subscription was created
        const hasSubscriptionNow =
          await eventSubscriptionManager.hasActiveSubscription(
            event.userId,
            event.type
          );

        if (!hasSubscriptionNow) {
          logger.error(
            `Failed to create subscription for user ${event.userId} in process ${process.pid}`
          );
          return {
            success: true,
            subscriberCount: 0,
            eventId: event.id,
          };
        }

        logger.info(
          `Successfully created subscription for user ${event.userId} in process ${process.pid}`
        );
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
      await this.safeTrigger(channelName, event.type, eventData);

      logger.info(
        `SUCCESS: Broadcasted event ${event.id} to channel ${channelName} in process ${process.pid}`,
        {
          eventType: event.type,
          userId: event.userId,
          priority: event.priority,
          processId: process.pid,
        }
      );

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
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
          await this.safeTrigger(channelName, 'system_notification', eventData);
        }
        logger.info(
          `Broadcasted system notification to ${userIds.length} specific users`
        );
      } else {
        // Broadcast to all users (use a global channel)
        await this.safeTrigger(
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
   * Broadcast a chat message directly to a user
   */
  public async broadcastChatMessage(
    userId: string,
    message: string
  ): Promise<void> {
    try {
      const channelName = `user-${userId}`;
      const chatData = {
        message,
        timestamp: new Date().toISOString(),
        isProactive: true,
      };

      await this.safeTrigger(channelName, 'chat_message', chatData);

      logger.debug(`Broadcasted chat message to user ${userId}`, {
        userId,
        message,
        messageLength: message.length,
      });
    } catch (error) {
      logger.error(`Failed to broadcast chat message to user ${userId}`, {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
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

  /**
   * Safely trigger Pusher events with error handling
   */
  private async safeTrigger(
    channels: string | string[],
    event: string,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.pusher.trigger(channels, event, data);
    } catch (error: unknown) {
      // Handle specific socket/connection errors gracefully
      const err = error as { code?: string; message?: string } | undefined;
      if (
        err?.code === 'ECONNRESET' ||
        err?.code === 'EPIPE' ||
        err?.message?.includes('socket') ||
        err?.message?.includes('connection')
      ) {
        logger.warn('Socket connection issue during Pusher trigger:', {
          error: err?.message,
          code: err?.code,
          channels,
          event,
          retryable: true,
        });

        // Attempt one retry after a brief delay
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.pusher.trigger(channels, event, data);
          logger.info('Pusher trigger retry succeeded');
        } catch (retryError: unknown) {
          const rerr = retryError as
            | { message?: string; code?: string }
            | undefined;
          logger.error('Pusher trigger retry failed:', {
            error: rerr?.message,
            code: rerr?.code,
            channels,
            event,
          });
          // Don't throw - log and continue to prevent crashes
        }
      } else {
        // For non-socket errors, log and re-throw
        logger.error('Non-socket Pusher error:', {
          error: err?.message,
          code: err?.code,
          channels,
          event,
        });
        throw error;
      }
    }
  }

  /**
   * Convert event to chat with user's locale
   */
  private async convertEventToChatWithLocale(event: Event): Promise<void> {
    try {
      // Get user's session to determine locale
      const { getSessionByUserId } = await import('../users/user.repository');
      const session = await getSessionByUserId(event.userId);
      const locale = session?.locale || 'en';

      // Convert event to chat with proper locale
      await eventToChatService.convertEventToChat(event, locale);
    } catch (error) {
      logger.error('Failed to get user locale for chat conversion', {
        error: error instanceof Error ? error.message : String(error),
        eventId: event.id,
        userId: event.userId,
      });
      // Fallback to default locale
      await eventToChatService.convertEventToChat(event, 'en');
    }
  }
}

export const pusherEventBroadcaster = PusherEventBroadcaster.getInstance();
