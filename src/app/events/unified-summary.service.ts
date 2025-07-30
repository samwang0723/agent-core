import {
  EventType,
  EventPriority,
  EventSource,
  UnifiedPeriodicSummaryEvent,
  GmailImportantEmailEvent,
} from './event.types';
import { mastra } from '../../mastra';
import logger from '../utils/logger';
import { pusherEventBroadcaster } from './pusher.service';
import { mastraMemoryService } from '../../mastra/memory/memory.service';
import { CalendarService } from '../calendar';
import { GmailService } from '../emails';
import { EventDetector } from './event.detector';
import { ConflictDetectionService } from './conflict-detection.service';
import { notificationCache } from '../utils/notification-cache';
import {
  GoogleCalendarEvent,
  GoogleEmailMessage,
} from '../types/google-api.types';
import { CalendarConflictEvent } from './event.types';
import { getUserEmail, getUserTimezone } from '../users/user.repository';

export class UnifiedSummaryService {
  private static instance: UnifiedSummaryService;

  private constructor() {}

  public static getInstance(): UnifiedSummaryService {
    if (!UnifiedSummaryService.instance) {
      UnifiedSummaryService.instance = new UnifiedSummaryService();
    }
    return UnifiedSummaryService.instance;
  }

  /**
   * Generate and broadcast unified periodic summary for user
   */
  public async generatePeriodicSummary(
    userId: string,
    accessToken: string,
    locale: string = 'en'
  ): Promise<void> {
    const summaryId = `unified-summary-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    logger.info(`Generating periodic unified summary for user ${userId}`, {
      summaryId,
      userId,
      locale,
    });

    const userEmail = await getUserEmail(userId);
    const timezone = await getUserTimezone(userId);

    try {
      // Use a default lookback of 30 minutes for periodic summaries
      const lastSummaryAt = new Date(Date.now() - 30 * 60 * 1000);

      const now = new Date();

      // Initialize services
      const calendarService = new CalendarService();
      const gmailService = new GmailService();

      await Promise.all([
        calendarService.initialize(accessToken),
        gmailService.initialize(accessToken),
      ]);

      // Fetch recent data
      const [calendarResponse, emailResponse] = await Promise.all([
        calendarService.getCalendarEvents(),
        gmailService.getEmails(),
      ]);

      const calendarEvents = (calendarResponse.events ||
        []) as GoogleCalendarEvent[];
      const emails = (emailResponse.messages || []) as GoogleEmailMessage[];

      // Filter data since last summary
      const newCalendarEvents = calendarEvents.filter(event => {
        const eventCreated = new Date(event.created || event.updated || 0);
        return eventCreated > lastSummaryAt;
      });

      const upcomingEvents = calendarEvents.filter(event => {
        const startTime = new Date(
          event.start.dateTime || event.start.date || ''
        );
        const timeUntilStart = startTime.getTime() - now.getTime();
        const minutesUntilStart = Math.floor(timeUntilStart / (1000 * 60));
        return minutesUntilStart > 0 && minutesUntilStart <= 2 * 60; // Next 2 hours
      });

      const recentEmails = emails.filter(email => {
        const receivedTime = new Date(parseInt(email.internalDate, 10));
        return receivedTime > lastSummaryAt;
      });

      // Detect important emails
      const importantEmails = EventDetector.detectImportantEmails(
        recentEmails.map(email => ({
          id: email.id,
          userId,
          messageId: email.id,
          threadId: email.threadId,
          subject:
            email.headers.find(h => h.name.toLowerCase() === 'subject')
              ?.value || '',
          body: email.textBody || '',
          receivedTime: new Date(parseInt(email.internalDate, 10)),
          isUnread: true,
          importance: false,
          fromAddress:
            email.headers.find(h => h.name.toLowerCase() === 'from')?.value ||
            '',
        }))
      );

      // Detect conflicts among calendar events (only recent ones)
      let conflicts: CalendarConflictEvent[] = [];
      if (newCalendarEvents.length > 1) {
        const conflictAnalysis = ConflictDetectionService.analyzeEventConflicts(
          userId,
          userEmail,
          newCalendarEvents.map(event => ({
            id: event.id,
            userId,
            googleEventId: event.id,
            title: event.summary || 'No Title',
            description: event.description,
            startTime: new Date(event.start.dateTime || event.start.date || ''),
            endTime: new Date(event.end.dateTime || event.end.date || ''),
            location: event.location,
            attendees: event.attendees,
            organizer: event.organizer,
            status: event.status,
            htmlLink: event.htmlLink,
          })),
          {
            enableBackToBackDetection: true,
            backToBackThreshold: 0,
            minOverlapForDetection: 1,
          }
        );

        if (conflictAnalysis.hasConflicts) {
          conflicts = conflictAnalysis.conflicts;
        }
      }

      // Calculate statistics
      const stats = {
        newCalendarEvents: newCalendarEvents.length,
        upcomingEvents: upcomingEvents.length,
        importantEmails: importantEmails.length,
        conflicts: conflicts.length,
      };

      // Check if there are meaningful changes
      const changesSinceLastSummary = Object.values(stats).some(
        count => count > 0
      );

      if (!changesSinceLastSummary) {
        logger.info(`No changes for periodic summary for user ${userId}`, {
          summaryId,
          lastSummaryAt: lastSummaryAt.toISOString(),
        });
        return;
      }

      // Check for duplicate notification using stats as content hash
      const statsKey = JSON.stringify(stats);
      const contentHash = notificationCache.generateContentHash([statsKey]);

      if (
        await notificationCache.isDuplicate(userId, 'calendar', contentHash)
      ) {
        logger.info(`Skipping duplicate periodic summary for user ${userId}`, {
          summaryId,
          stats,
        });
        return;
      }

      // Generate AI summary with detailed data
      const summary = await this.generateAISummary(
        stats,
        lastSummaryAt,
        now,
        locale,
        timezone,
        {
          newCalendarEvents,
          upcomingEvents,
          importantEmails,
          conflicts,
        }
      );

      if (summary) {
        // Create unified summary event for storage/analytics
        const unifiedSummaryEvent: UnifiedPeriodicSummaryEvent = {
          id: summaryId,
          userId,
          type: EventType.UNIFIED_PERIODIC_SUMMARY,
          timestamp: now,
          priority: EventPriority.MEDIUM,
          source: EventSource.SYSTEM,
          data: {
            summaryId,
            lastSummaryAt,
            summary,
            stats,
            changesSinceLastSummary,
          },
        };

        // Store the event for analytics (without broadcasting through event system)
        const { EventStorage } = await import('./event.storage');
        const eventStorage = new EventStorage();
        await eventStorage.storeEvent(unifiedSummaryEvent);

        // Broadcast summary directly as chat message to avoid double AI processing
        await pusherEventBroadcaster.broadcastChatMessage(userId, summary);

        // Save to conversation history for persistence
        try {
          await mastraMemoryService.saveMessage('assistant', userId, summary);
        } catch (error) {
          logger.error(
            'Failed to save periodic summary to conversation history',
            {
              error: error instanceof Error ? error.message : String(error),
              userId,
              summaryId,
            }
          );
        }

        // Mark notification as sent in cache
        await notificationCache.markNotified(userId, 'calendar', contentHash, {
          summaryId,
          stats,
          timestamp: now.toISOString(),
        });

        logger.info(
          `Successfully generated and broadcast periodic summary ${summaryId}`,
          {
            userId,
            stats,
            changesSinceLastSummary,
            messageLength: summary.length,
          }
        );
      }
    } catch (error) {
      logger.error(`Failed to generate periodic summary ${summaryId}`, {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Generate AI-powered periodic summary
   */
  private async generateAISummary(
    stats: {
      newCalendarEvents: number;
      upcomingEvents: number;
      importantEmails: number;
      conflicts: number;
    },
    since: Date,
    now: Date,
    locale: string,
    timezone: string,
    detailedData?: {
      newCalendarEvents: GoogleCalendarEvent[];
      upcomingEvents: GoogleCalendarEvent[];
      importantEmails: GmailImportantEmailEvent[];
      conflicts: CalendarConflictEvent[];
    }
  ): Promise<string | null> {
    try {
      const generalAgent = mastra.getAgent('generalAgent');
      if (!generalAgent) {
        logger.error('General agent not found for periodic summary');
        return null;
      }

      const timePeriod = this.formatTimePeriod(since, now);
      const prompt = this.createPeriodicSummaryPrompt(
        stats,
        timePeriod,
        locale,
        timezone,
        detailedData
      );

      const response = await generalAgent.generate(prompt, {
        maxRetries: 2,
        maxSteps: 2,
        maxTokens: 250,
      });

      return response.text || null;
    } catch (error) {
      logger.error('Error generating periodic summary', {
        error: error instanceof Error ? error.message : String(error),
        stats,
      });
      return null;
    }
  }

  /**
   * Create prompt for periodic summary
   */
  private createPeriodicSummaryPrompt(
    stats: {
      newCalendarEvents: number;
      upcomingEvents: number;
      importantEmails: number;
      conflicts: number;
    },
    timePeriod: string,
    locale: string,
    timezone: string,
    detailedData?: {
      newCalendarEvents: GoogleCalendarEvent[];
      upcomingEvents: GoogleCalendarEvent[];
      importantEmails: GmailImportantEmailEvent[];
      conflicts: CalendarConflictEvent[];
    }
  ): string {
    const baseContext = `You are Friday, the user's AI assistant. Provide a concise periodic update of what's happened recently. Be helpful, conversational, and actionable. ALWAYS respond with Language locale ${locale}, user timezone ${timezone}, current date and time is ${new Date().toLocaleString()}.`;

    let updatesDetail = `\nUpdates ${timePeriod}:\n`;

    // Add detailed calendar events
    if (stats.newCalendarEvents > 0 && detailedData?.newCalendarEvents) {
      updatesDetail += `- ${stats.newCalendarEvents} new calendar event${stats.newCalendarEvents === 1 ? '' : 's'} added:\n`;
      detailedData.newCalendarEvents.slice(0, 2).forEach(event => {
        const startTime = new Date(
          event.start.dateTime || event.start.date || ''
        );
        updatesDetail += `  • "${event.summary || 'No Title'}" at ${startTime.toLocaleString()}\n`;
      });
      if (detailedData.newCalendarEvents.length > 2) {
        updatesDetail += `  • ...and ${detailedData.newCalendarEvents.length - 2} more\n`;
      }
    }

    // Add detailed upcoming events
    if (stats.upcomingEvents > 0 && detailedData?.upcomingEvents) {
      updatesDetail += `- ${stats.upcomingEvents} event${stats.upcomingEvents === 1 ? '' : 's'} starting in the next 2 hours:\n`;
      detailedData.upcomingEvents.slice(0, 2).forEach(event => {
        const startTime = new Date(
          event.start.dateTime || event.start.date || ''
        );
        const timeUntilStart = startTime.getTime() - Date.now();
        const hoursUntilStart = Math.floor(timeUntilStart / (1000 * 60 * 60));
        const minutesUntilStart = Math.floor(
          (timeUntilStart % (1000 * 60 * 60)) / (1000 * 60)
        );

        let timeDescription = '';
        if (hoursUntilStart > 0) {
          timeDescription = `in ${hoursUntilStart}h ${minutesUntilStart}m`;
        } else if (minutesUntilStart > 0) {
          timeDescription = `in ${minutesUntilStart}m`;
        } else {
          timeDescription = 'starting soon';
        }

        updatesDetail += `  • "${event.summary || 'No Title'}" ${timeDescription}\n`;
      });
      if (detailedData.upcomingEvents.length > 2) {
        updatesDetail += `  • ...and ${detailedData.upcomingEvents.length - 2} more\n`;
      }
    }

    // Add detailed email information
    if (stats.importantEmails > 0 && detailedData?.importantEmails) {
      updatesDetail += `- ${stats.importantEmails} important email${stats.importantEmails === 1 ? '' : 's'} received:\n`;
      detailedData.importantEmails.slice(0, 2).forEach(email => {
        const subject = email.data?.subject || 'No Subject';
        const from = email.data?.fromAddress || 'Unknown Sender';
        updatesDetail += `  • "${subject}" from ${from}\n`;
      });
      if (detailedData.importantEmails.length > 2) {
        updatesDetail += `  • ...and ${detailedData.importantEmails.length - 2} more\n`;
      }
    }

    // Add detailed conflict information
    if (stats.conflicts > 0 && detailedData?.conflicts) {
      updatesDetail += `- ${stats.conflicts} new calendar conflict${stats.conflicts === 1 ? '' : 's'} detected:\n`;
      detailedData.conflicts.slice(0, 2).forEach(conflict => {
        const conflictType =
          conflict.data.conflictType === 'exact_overlap'
            ? 'overlapping'
            : 'back-to-back';
        updatesDetail += `  • ${conflictType} events: "${conflict.data.conflictingEvents[0].title}" and "${conflict.data.conflictingEvents[1].title}"\n`;
      });
      if (detailedData.conflicts.length > 2) {
        updatesDetail += `  • ...and ${detailedData.conflicts.length - 2} more conflicts\n`;
      }
    }

    return `${baseContext}${updatesDetail}

Provide a brief summary of these updates and suggest any actions needed. Keep it conversational and under under 5-6 sentences with some important detail. Focus on what's most urgent or important.`;
  }

  /**
   * Format time period for display
   */
  private formatTimePeriod(since: Date, now: Date): string {
    const diffMs = now.getTime() - since.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);

    if (diffHours >= 1) {
      return diffHours === 1
        ? 'in the last hour'
        : `in the last ${diffHours} hours`;
    } else if (diffMinutes >= 1) {
      return diffMinutes === 1
        ? 'in the last minute'
        : `in the last ${diffMinutes} minutes`;
    } else {
      return 'in the last few moments';
    }
  }
}

// Export singleton instance
export const unifiedSummaryService = UnifiedSummaryService.getInstance();
