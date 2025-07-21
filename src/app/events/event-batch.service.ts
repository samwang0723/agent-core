import {
  EventType,
  EventPriority,
  EventSource,
  CalendarNewEventEvent,
  CalendarUpcomingEventEvent,
  GmailImportantEmailEvent,
  ChatMessageEvent,
} from './event.types';
import { mastra } from '../../mastra';
import logger from '../utils/logger';
import { eventBroadcaster } from './event.service';
import { notificationCache } from '../utils/notification-cache';

export class EventBatchService {
  private static instance: EventBatchService;

  private constructor() {}

  public static getInstance(): EventBatchService {
    if (!EventBatchService.instance) {
      EventBatchService.instance = new EventBatchService();
    }
    return EventBatchService.instance;
  }

  /**
   * Process a batch of calendar events and generate a summary message
   */
  public async processCalendarEventBatch(
    userId: string,
    events: (CalendarNewEventEvent | CalendarUpcomingEventEvent)[]
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const batchId = `calendar-batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    logger.info(`Processing calendar event batch for user ${userId}`, {
      batchId,
      eventCount: events.length,
      userId,
    });

    try {
      // Group events by type
      const newEvents = events.filter(
        e => e.type === EventType.CALENDAR_NEW_EVENT
      ) as CalendarNewEventEvent[];
      const upcomingEvents = events.filter(
        e => e.type === EventType.CALENDAR_UPCOMING_EVENT
      ) as CalendarUpcomingEventEvent[];

      // Extract event IDs for cache check
      const eventIds = events.map(e =>
        e.type === EventType.CALENDAR_NEW_EVENT
          ? (e as CalendarNewEventEvent).data.eventId
          : (e as CalendarUpcomingEventEvent).data.eventId
      );

      // Check for duplicate notification using event IDs
      if (
        await notificationCache.isDuplicateByIds(userId, 'calendar', eventIds)
      ) {
        logger.info(
          `Skipping duplicate calendar notification for user ${userId}`,
          {
            batchId,
            eventIds,
            eventCount: events.length,
          }
        );
        return;
      }

      // Generate summary message
      const summaryMessage = await this.generateCalendarSummary(
        newEvents,
        upcomingEvents
      );

      if (summaryMessage) {
        // Create and broadcast summary event
        await this.broadcastSummaryMessage(
          userId,
          summaryMessage,
          'calendar',
          batchId
        );

        // Mark notification as sent in cache using event IDs
        await notificationCache.markNotifiedByIds(
          userId,
          'calendar',
          eventIds,
          {
            batchId,
            eventCount: events.length,
            eventIds,
          }
        );

        logger.info(`Successfully processed calendar batch ${batchId}`, {
          userId,
          newEventsCount: newEvents.length,
          upcomingEventsCount: upcomingEvents.length,
          eventIds,
        });
      }
    } catch (error) {
      logger.error(`Failed to process calendar event batch ${batchId}`, {
        error: error instanceof Error ? error.message : String(error),
        userId,
        eventCount: events.length,
      });
    }
  }

  /**
   * Process a batch of email events and generate a summary message
   */
  public async processEmailEventBatch(
    userId: string,
    events: GmailImportantEmailEvent[]
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const batchId = `email-batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    logger.info(`Processing email event batch for user ${userId}`, {
      batchId,
      eventCount: events.length,
      userId,
    });

    try {
      // Extract email IDs for cache check
      const emailIds = events.map(e => e.data.emailId);

      // Check for duplicate notification using email IDs
      if (await notificationCache.isDuplicateByIds(userId, 'email', emailIds)) {
        logger.info(
          `Skipping duplicate email notification for user ${userId}`,
          {
            batchId,
            emailIds,
            eventCount: events.length,
          }
        );
        return;
      }

      // Generate summary message
      const summaryMessage = await this.generateEmailSummary(events);

      if (summaryMessage) {
        // Create and broadcast summary event
        await this.broadcastSummaryMessage(
          userId,
          summaryMessage,
          'email',
          batchId
        );

        // Mark notification as sent in cache using email IDs
        await notificationCache.markNotifiedByIds(userId, 'email', emailIds, {
          batchId,
          eventCount: events.length,
          emailIds,
        });

        logger.info(`Successfully processed email batch ${batchId}`, {
          userId,
          eventCount: events.length,
          emailIds,
        });
      }
    } catch (error) {
      logger.error(`Failed to process email event batch ${batchId}`, {
        error: error instanceof Error ? error.message : String(error),
        userId,
        eventCount: events.length,
      });
    }
  }

  /**
   * Generate AI-powered summary for calendar events
   */
  private async generateCalendarSummary(
    newEvents: CalendarNewEventEvent[],
    upcomingEvents: CalendarUpcomingEventEvent[]
  ): Promise<string | null> {
    try {
      const generalAgent = mastra.getAgent('generalAgent');
      if (!generalAgent) {
        logger.error('General agent not found for calendar summary');
        return null;
      }

      const prompt = this.createCalendarSummaryPrompt(
        newEvents,
        upcomingEvents
      );

      const response = await generalAgent.generate(prompt, {
        maxRetries: 2,
        maxSteps: 2,
        maxTokens: 300,
      });

      return response.text || null;
    } catch (error) {
      logger.error('Error generating calendar summary', {
        error: error instanceof Error ? error.message : String(error),
        newEventsCount: newEvents.length,
        upcomingEventsCount: upcomingEvents.length,
      });
      return null;
    }
  }

  /**
   * Generate AI-powered summary for email events
   */
  private async generateEmailSummary(
    events: GmailImportantEmailEvent[]
  ): Promise<string | null> {
    try {
      const generalAgent = mastra.getAgent('generalAgent');
      if (!generalAgent) {
        logger.error('General agent not found for email summary');
        return null;
      }

      const prompt = this.createEmailSummaryPrompt(events);

      const response = await generalAgent.generate(prompt, {
        maxRetries: 2,
        maxSteps: 2,
        maxTokens: 300,
      });

      return response.text || null;
    } catch (error) {
      logger.error('Error generating email summary', {
        error: error instanceof Error ? error.message : String(error),
        eventCount: events.length,
      });
      return null;
    }
  }

  /**
   * Create prompt for calendar event summary
   */
  private createCalendarSummaryPrompt(
    newEvents: CalendarNewEventEvent[],
    upcomingEvents: CalendarUpcomingEventEvent[]
  ): string {
    const baseContext = `You are Friday, the user's AI assistant. Provide a concise, helpful summary of calendar updates. Be conversational and actionable.`;

    let eventDetails = '';

    if (newEvents.length > 0) {
      eventDetails += `\nNew events added:\n`;
      newEvents.forEach(event => {
        const { title, startTime, location } = event.data;
        const startDate = new Date(startTime).toLocaleDateString();
        const startTimeStr = new Date(startTime).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        eventDetails += `- "${title}" on ${startDate} at ${startTimeStr}`;
        if (location) eventDetails += ` at ${location}`;
        eventDetails += '\n';
      });
    }

    if (upcomingEvents.length > 0) {
      eventDetails += `\nUpcoming events:\n`;
      upcomingEvents.forEach(event => {
        const { title, timeUntilStart, reminder } = event.data;
        const urgency =
          reminder === 'starting'
            ? 'starting now'
            : `in ${timeUntilStart} minutes`;
        eventDetails += `- "${title}" ${urgency}\n`;
      });
    }

    return `${baseContext}

Calendar updates detected:${eventDetails}

Provide a brief, natural summary mentioning the key events and any preparation needed. Keep it conversational and under 2-3 sentences.`;
  }

  /**
   * Create prompt for email event summary
   */
  private createEmailSummaryPrompt(events: GmailImportantEmailEvent[]): string {
    const baseContext = `You are Friday, the user's AI assistant. Provide a concise summary of important emails received. Be helpful and actionable.`;

    let emailDetails = `\nImportant emails received:\n`;
    events.forEach(event => {
      const { subject, fromAddress, importance } = event.data;
      emailDetails += `- "${subject}" from ${fromAddress} (${importance} priority)\n`;
    });

    return `${baseContext}${emailDetails}

Provide a brief, natural summary highlighting the important emails and suggest any needed actions. Keep it conversational and under 2-3 sentences.`;
  }

  /**
   * Broadcast summary message as a chat event
   */
  private async broadcastSummaryMessage(
    userId: string,
    message: string,
    type: 'calendar' | 'email',
    batchId: string
  ): Promise<void> {
    try {
      const chatMessageEvent: ChatMessageEvent = {
        id: `${type}-summary-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        userId,
        type: EventType.CHAT_MESSAGE,
        timestamp: new Date(),
        priority: EventPriority.MEDIUM,
        source: EventSource.SYSTEM,
        data: {
          message,
          isProactive: true,
          isBatchSummary: true,
          batchType: type,
          batchId,
        },
      };

      await eventBroadcaster.broadcastEvent(chatMessageEvent);

      logger.info(`Broadcasted ${type} summary message`, {
        userId,
        batchId,
        messageLength: message.length,
      });
    } catch (error) {
      logger.error(`Failed to broadcast ${type} summary message`, {
        error: error instanceof Error ? error.message : String(error),
        userId,
        batchId,
      });
      throw error;
    }
  }
}

// Export singleton instance
export const eventBatchService = EventBatchService.getInstance();
