import {
  EventType,
  EventPriority,
  EventSource,
  CalendarNewEventEvent,
  CalendarUpcomingEventEvent,
  GmailImportantEmailEvent,
  CalendarConflictEvent,
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
   * Process a batch of calendar conflict events and generate a summary message
   */
  public async processConflictEventBatch(
    userId: string,
    conflicts: CalendarConflictEvent[]
  ): Promise<void> {
    if (conflicts.length === 0) {
      return;
    }

    const batchId = `conflict-batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    logger.info(`Processing conflict event batch for user ${userId}`, {
      batchId,
      conflictCount: conflicts.length,
      userId,
    });

    try {
      // Extract conflict IDs for cache check
      const conflictIds = conflicts.map(c => c.data.conflictId);

      // Check for duplicate notification using conflict IDs
      if (
        await notificationCache.isDuplicateByIds(
          userId,
          'conflict',
          conflictIds
        )
      ) {
        logger.info(
          `Skipping duplicate conflict notification for user ${userId}`,
          {
            batchId,
            conflictIds,
            conflictCount: conflicts.length,
          }
        );
        return;
      }

      // Generate summary message
      const summaryMessage = await this.generateConflictSummary(conflicts);

      if (summaryMessage) {
        // Create and broadcast summary event
        await this.broadcastSummaryMessage(
          userId,
          summaryMessage,
          'conflict',
          batchId
        );

        // Mark notification as sent in cache using conflict IDs
        await notificationCache.markNotifiedByIds(
          userId,
          'conflict',
          conflictIds,
          {
            batchId,
            conflictCount: conflicts.length,
            conflictIds,
          }
        );

        logger.info(`Successfully processed conflict batch ${batchId}`, {
          userId,
          conflictCount: conflicts.length,
          conflictIds,
        });
      }
    } catch (error) {
      logger.error(`Failed to process conflict event batch ${batchId}`, {
        error: error instanceof Error ? error.message : String(error),
        userId,
        conflictCount: conflicts.length,
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
   * Generate AI-powered summary for conflict events
   */
  private async generateConflictSummary(
    conflicts: CalendarConflictEvent[]
  ): Promise<string | null> {
    try {
      const generalAgent = mastra.getAgent('generalAgent');
      if (!generalAgent) {
        logger.error('General agent not found for conflict summary');
        return null;
      }

      const prompt = this.createConflictSummaryPrompt(conflicts);

      const response = await generalAgent.generate(prompt, {
        maxRetries: 2,
        maxSteps: 2,
        maxTokens: 400,
      });

      return response.text || null;
    } catch (error) {
      logger.error('Error generating conflict summary', {
        error: error instanceof Error ? error.message : String(error),
        conflictCount: conflicts.length,
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
   * Create prompt for conflict event summary
   */
  private createConflictSummaryPrompt(
    conflicts: CalendarConflictEvent[]
  ): string {
    const baseContext = `You are Friday, the user's AI assistant. The user has calendar scheduling conflicts that need attention. Provide a helpful summary with actionable suggestions.`;

    // Group conflicts by severity and type
    const severityBreakdown = conflicts.reduce(
      (acc, conflict) => {
        acc[conflict.data.severity]++;
        return acc;
      },
      { minor: 0, moderate: 0, major: 0 }
    );

    let conflictDetails = `\nScheduling conflicts detected (${conflicts.length} total):\n`;

    // Add severity breakdown
    if (severityBreakdown.major > 0) {
      conflictDetails += `- ${severityBreakdown.major} major conflict${severityBreakdown.major === 1 ? '' : 's'} (significant overlaps)\n`;
    }
    if (severityBreakdown.moderate > 0) {
      conflictDetails += `- ${severityBreakdown.moderate} moderate conflict${severityBreakdown.moderate === 1 ? '' : 's'}\n`;
    }
    if (severityBreakdown.minor > 0) {
      conflictDetails += `- ${severityBreakdown.minor} minor conflict${severityBreakdown.minor === 1 ? '' : 's'} (tight scheduling)\n`;
    }

    // Add specific conflict examples (up to 3 most severe)
    const sortedConflicts = conflicts
      .sort((a, b) => {
        const severityOrder = { major: 3, moderate: 2, minor: 1 };
        return severityOrder[b.data.severity] - severityOrder[a.data.severity];
      })
      .slice(0, 3);

    conflictDetails += `\nMost critical conflicts:\n`;
    sortedConflicts.forEach(conflict => {
      const events = conflict.data.conflictingEvents;
      const event1 = events[0];
      const event2 = events[1];

      if (conflict.data.conflictType === 'back_to_back') {
        conflictDetails += `- "${event1.title}" → "${event2.title}" (back-to-back, ${conflict.data.overlapDuration} min gap)\n`;
      } else {
        conflictDetails += `- "${event1.title}" overlaps with "${event2.title}" (${conflict.data.overlapDuration} min ${conflict.data.conflictType.replace('_', ' ')})\n`;
      }
    });

    return `${baseContext}${conflictDetails}

Provide a brief, helpful summary of the conflicts and suggest 1-2 specific actions the user should take to resolve them. Be conversational and actionable. Keep it under 3-4 sentences.`;
  }

  /**
   * Broadcast summary message as a chat event
   */
  private async broadcastSummaryMessage(
    userId: string,
    message: string,
    type: 'calendar' | 'email' | 'conflict',
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
