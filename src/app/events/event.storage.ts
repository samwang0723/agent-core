import { Event } from './event.types';
import logger from '../utils/logger';

export class EventStorage {
  private events: Map<string, Event> = new Map();
  private readonly maxEvents = 1000; // Maximum events to keep in memory
  private readonly maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  public async storeEvent(event: Event): Promise<void> {
    this.events.set(event.id, event);

    // Clean up old events if we exceed the maximum
    if (this.events.size > this.maxEvents) {
      await this.cleanup();
    }

    logger.debug(`Stored event ${event.id} for user ${event.userId}`);
  }

  public async getEvent(eventId: string): Promise<Event | undefined> {
    return this.events.get(eventId);
  }

  public async getEventsForUser(
    userId: string,
    limit: number = 50
  ): Promise<Event[]> {
    const userEvents: Event[] = [];

    for (const event of this.events.values()) {
      if (event.userId === userId) {
        userEvents.push(event);
      }
    }

    // Sort by timestamp (newest first) and limit
    return userEvents
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public async cleanup(): Promise<void> {
    const now = new Date();
    const cutoffTime = now.getTime() - this.maxAge;
    let removedCount = 0;

    for (const [eventId, event] of this.events) {
      if (event.timestamp.getTime() < cutoffTime) {
        this.events.delete(eventId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.info(`Cleaned up ${removedCount} old events from storage`);
    }
  }

  public async getStorageStats(): Promise<{
    totalEvents: number;
    oldestEvent: Date | null;
    newestEvent: Date | null;
  }> {
    const events = Array.from(this.events.values());
    const timestamps = events.map(e => e.timestamp.getTime());

    return {
      totalEvents: events.length,
      oldestEvent:
        timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
      newestEvent:
        timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null,
    };
  }
}
