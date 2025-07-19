import { EventType, EventSubscription } from './event.types';
import logger from '../utils/logger';

export class EventSubscriptionManager {
  private static instance: EventSubscriptionManager;
  private subscriptions: Map<string, EventSubscription> = new Map();

  private constructor() {}

  public static getInstance(): EventSubscriptionManager {
    if (!EventSubscriptionManager.instance) {
      EventSubscriptionManager.instance = new EventSubscriptionManager();
    }
    return EventSubscriptionManager.instance;
  }

  public async hasActiveSubscription(userId: string, eventType: EventType): Promise<boolean> {
    const subscription = this.subscriptions.get(userId);
    return subscription?.isActive && subscription.eventTypes.includes(eventType) || false;
  }

  public async getSubscription(userId: string): Promise<EventSubscription | undefined> {
    return this.subscriptions.get(userId);
  }

  public async createOrUpdateSubscription(
    userId: string,
    eventTypes: EventType[],
    isActive: boolean = true
  ): Promise<EventSubscription> {
    const now = new Date();
    const existing = this.subscriptions.get(userId);
    
    const subscription: EventSubscription = {
      userId,
      eventTypes,
      isActive,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.subscriptions.set(userId, subscription);
    
    logger.info(`Updated event subscription for user ${userId}`, {
      eventTypes,
      isActive,
    });

    return subscription;
  }

  public async enableSubscription(userId: string): Promise<void> {
    const subscription = this.subscriptions.get(userId);
    if (subscription) {
      subscription.isActive = true;
      subscription.updatedAt = new Date();
      logger.info(`Enabled event subscription for user ${userId}`);
    }
  }

  public async disableSubscription(userId: string): Promise<void> {
    const subscription = this.subscriptions.get(userId);
    if (subscription) {
      subscription.isActive = false;
      subscription.updatedAt = new Date();
      logger.info(`Disabled event subscription for user ${userId}`);
    }
  }

  public async deleteSubscription(userId: string): Promise<void> {
    this.subscriptions.delete(userId);
    logger.info(`Deleted event subscription for user ${userId}`);
  }

  public async initializeDefaultSubscription(userId: string): Promise<EventSubscription> {
    // Default to all event types enabled
    const defaultEventTypes = [
      EventType.GMAIL_IMPORTANT_EMAIL,
      EventType.CALENDAR_UPCOMING_EVENT,
      EventType.CALENDAR_NEW_EVENT,
      EventType.CALENDAR_EVENT_REMINDER,
      EventType.CHAT_MESSAGE,
    ];

    return this.createOrUpdateSubscription(userId, defaultEventTypes, true);
  }

  public async getActiveSubscribers(): Promise<string[]> {
    const activeUsers: string[] = [];
    for (const [userId, subscription] of this.subscriptions) {
      if (subscription.isActive) {
        activeUsers.push(userId);
      }
    }
    return activeUsers;
  }
}

export const eventSubscriptionManager = EventSubscriptionManager.getInstance();