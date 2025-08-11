import {
  EventType,
  EventPriority,
  EventSource,
  LoginSummaryEvent,
  GmailImportantEmailEvent,
} from './event.types';
import { mastra } from '../../mastra';
import logger from '../utils/logger';
import { pusherEventBroadcaster } from './pusher.service';
import { mastraMemoryService } from '../../mastra/memory/memory.service';
import {
  getLastLoginTime,
  getUserEmail,
  getUserTimezone,
  updateLastLoginTime,
} from '../users/user.repository';
import { CalendarService } from '../calendar';
import { GmailService } from '../emails';
import { EventDetector } from './event.detector';
import { ConflictDetectionService } from './conflict-detection.service';
import {
  GoogleCalendarEvent,
  GoogleEmailMessage,
} from '../types/google-api.types';
import { CalendarConflictEvent } from './event.types';

export class LoginSummaryService {
  private static instance: LoginSummaryService;

  private constructor() {}

  public static getInstance(): LoginSummaryService {
    if (!LoginSummaryService.instance) {
      LoginSummaryService.instance = new LoginSummaryService();
    }
    return LoginSummaryService.instance;
  }

  /**
   * Generate and broadcast login summary for user
   */
  public async generateLoginSummary(
    userId: string,
    accessToken: string,
    locale: string = 'en'
  ): Promise<void> {
    const summaryId = `login-summary-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    logger.info(`Generating login summary for user ${userId}`, {
      summaryId,
      userId,
      locale,
    });

    const userEmail = await getUserEmail(userId);
    const timezone = await getUserTimezone(userId);

    try {
      // Get last login time
      const lastLoginAt = await getLastLoginTime(userId);
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
      logger.debug('emailResponse', { emailResponse });
      const emails = (emailResponse.messages || []) as GoogleEmailMessage[];

      // Filter data since 8 hours ago
      const cutoffTime = new Date(now.getTime() - 8 * 60 * 60 * 1000); // Default to 8h ago

      const newCalendarEvents = calendarEvents.filter(event => {
        const eventCreated = new Date(event.created || event.updated || 0);
        return eventCreated > cutoffTime;
      });

      const upcomingEvents = calendarEvents.filter(event => {
        const startTime = new Date(
          event.start.dateTime || event.start.date || ''
        );
        const timeUntilStart = startTime.getTime() - now.getTime();
        const minutesUntilStart = Math.floor(timeUntilStart / (1000 * 60));
        return minutesUntilStart > 0 && minutesUntilStart <= 8 * 60; // Next 8 hours
      });

      const recentEmails = emails.filter(email => {
        const receivedTime = new Date(parseInt(email.internalDate, 10));
        return receivedTime > cutoffTime;
      });

      // For login summaries, we want to be more inclusive with emails
      // Convert recent emails to the format expected by EventDetector
      const emailsForDetection = recentEmails.map(email => ({
        id: email.id,
        userId,
        messageId: email.id,
        threadId: email.threadId,
        subject:
          email.headers.find(h => h.name.toLowerCase() === 'subject')?.value ||
          '',
        body: email.textBody || '',
        receivedTime: new Date(parseInt(email.internalDate, 10)),
        isUnread: true,
        importance: false,
        fromAddress:
          email.headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
      }));

      // Detect important emails (high/urgent only)
      const importantEmails =
        EventDetector.detectImportantEmails(emailsForDetection);

      // For login summaries, if no "important" emails found, include some recent emails
      // This ensures users see email activity even if nothing is flagged as critical
      let emailsToInclude = importantEmails;
      if (importantEmails.length === 0 && recentEmails.length > 0) {
        // Take up to 3 most recent emails for login summary
        const recentEmailsForSummary = recentEmails.slice(0, 3);
        emailsToInclude = recentEmailsForSummary.map(email => ({
          id: `gmail-${email.id}-${Date.now()}`,
          userId,
          type: EventType.GMAIL_IMPORTANT_EMAIL,
          timestamp: new Date(),
          priority: EventPriority.MEDIUM,
          source: EventSource.GMAIL_SYNC,
          data: {
            emailId: email.id,
            subject:
              email.headers.find(h => h.name.toLowerCase() === 'subject')
                ?.value || 'No Subject',
            fromAddress:
              email.headers.find(h => h.name.toLowerCase() === 'from')?.value ||
              'Unknown Sender',
            snippet: email.textBody?.substring(0, 100) || '',
            importance: 'high' as const,
            receivedTime: new Date(parseInt(email.internalDate, 10)),
          },
        }));
      }

      logger.debug(`Emails for login summary`, {
        userId,
        strictImportantEmails: importantEmails.length,
        emailsToInclude: emailsToInclude.length,
        recentEmailsSample: recentEmails.slice(0, 3).map(email => ({
          subject:
            email.headers.find(h => h.name.toLowerCase() === 'subject')
              ?.value || '',
          from:
            email.headers.find(h => h.name.toLowerCase() === 'from')?.value ||
            '',
          receivedTime: new Date(
            parseInt(email.internalDate, 10)
          ).toISOString(),
        })),
      });

      // Detect conflicts among calendar events
      let conflicts: CalendarConflictEvent[] = [];
      if (calendarEvents.length > 1) {
        const conflictAnalysis = ConflictDetectionService.analyzeEventConflicts(
          userId,
          userEmail,
          calendarEvents.map(event => ({
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
        importantEmails: emailsToInclude.length,
        conflicts: conflicts.length,
      };

      // Skip if no meaningful updates
      const hasUpdates = Object.values(stats).some(count => count > 0);
      if (!hasUpdates) {
        logger.info(`No updates for login summary for user ${userId}`, {
          summaryId,
        });
        return;
      }

      // Generate AI summary with detailed data
      const summary = await this.generateAISummary(
        stats,
        cutoffTime,
        locale,
        timezone,
        {
          newCalendarEvents,
          upcomingEvents,
          emailsToInclude,
          conflicts,
        }
      );

      if (summary) {
        // Create login summary event for storage/analytics
        const loginSummaryEvent: LoginSummaryEvent = {
          id: summaryId,
          userId,
          type: EventType.LOGIN_SUMMARY,
          timestamp: now,
          priority: EventPriority.HIGH,
          source: EventSource.SYSTEM,
          data: {
            summaryId,
            lastLoginAt: lastLoginAt || undefined,
            summary,
            stats,
            periodCovered: this.formatTimePeriod(cutoffTime, now),
          },
        };

        // Store the event for analytics (without broadcasting through event system)
        const { EventStorage } = await import('./event.storage');
        const eventStorage = new EventStorage();
        await eventStorage.storeEvent(loginSummaryEvent);

        // Broadcast summary directly as chat message to avoid double AI processing
        await pusherEventBroadcaster.broadcastChatMessage(userId, summary);

        // Save to conversation history for persistence
        try {
          await mastraMemoryService.saveMessage('assistant', userId, summary);
        } catch (error) {
          logger.error('Failed to save login summary to conversation history', {
            error: error instanceof Error ? error.message : String(error),
            userId,
            summaryId,
          });
        }

        // Update last login time
        await updateLastLoginTime(userId, now);

        logger.info(
          `Successfully generated and broadcast login summary ${summaryId}`,
          {
            userId,
            stats,
            periodCovered: loginSummaryEvent.data.periodCovered,
            messageLength: summary.length,
          }
        );
      }
    } catch (error) {
      logger.error(`Failed to generate login summary ${summaryId}`, {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Generate AI-powered login summary
   */
  private async generateAISummary(
    stats: {
      newCalendarEvents: number;
      upcomingEvents: number;
      importantEmails: number;
      conflicts: number;
    },
    since: Date,
    locale: string,
    timezone: string,
    detailedData?: {
      newCalendarEvents: GoogleCalendarEvent[];
      upcomingEvents: GoogleCalendarEvent[];
      emailsToInclude: GmailImportantEmailEvent[];
      conflicts: CalendarConflictEvent[];
    }
  ): Promise<string | null> {
    try {
      const generalAgent = mastra.getAgent('generalAgent');
      if (!generalAgent) {
        logger.error('General agent not found for login summary');
        return null;
      }

      const timePeriod = this.formatTimePeriod(since, new Date());
      const prompt = this.createLoginSummaryPrompt(
        stats,
        timePeriod,
        locale,
        timezone,
        detailedData
      );

      logger.debug(`Login summary prompt`, {
        prompt,
      });

      const response = await generalAgent.generate(prompt, {
        maxRetries: 0,
        maxSteps: 1,
        maxOutputTokens: 600,
      });

      return response.text || null;
    } catch (error) {
      logger.error('Error generating login summary', {
        error: error instanceof Error ? error.message : String(error),
        stats,
      });
      return null;
    }
  }

  /**
   * Create prompt for login summary
   */
  private createLoginSummaryPrompt(
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
      emailsToInclude: GmailImportantEmailEvent[];
      conflicts: CalendarConflictEvent[];
    }
  ): string {
    const baseContext = `You are Friday, the user's AI assistant. Welcome the user and provide a concise summary of what's happened since their last login. Be warm, conversational, and actionable. ALWAYS respond with Language locale ${locale}, user timezone ${timezone}, current date and time is ${new Date().toLocaleString()}.`;

    let updatesDetail = `\nUpdates ${timePeriod}:\n`;

    // Add detailed calendar events
    if (stats.newCalendarEvents > 0 && detailedData?.newCalendarEvents) {
      updatesDetail += `- ${stats.newCalendarEvents} new calendar event${stats.newCalendarEvents === 1 ? '' : 's'} added:\n`;
      detailedData.newCalendarEvents.slice(0, 3).forEach(event => {
        const startTime = new Date(
          event.start.dateTime || event.start.date || ''
        );
        updatesDetail += `  • "${event.summary || 'No Title'}" at ${startTime.toLocaleString()}\n`;
      });
      if (detailedData.newCalendarEvents.length > 3) {
        updatesDetail += `  • ...and ${detailedData.newCalendarEvents.length - 3} more\n`;
      }
    }

    // Add detailed upcoming events
    if (stats.upcomingEvents > 0 && detailedData?.upcomingEvents) {
      updatesDetail += `- ${stats.upcomingEvents} event${stats.upcomingEvents === 1 ? '' : 's'} coming up in the next 24 hours:\n`;
      detailedData.upcomingEvents.slice(0, 3).forEach(event => {
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
      if (detailedData.upcomingEvents.length > 3) {
        updatesDetail += `  • ...and ${detailedData.upcomingEvents.length - 3} more\n`;
      }
    }

    // Add detailed email information
    if (stats.importantEmails > 0 && detailedData?.emailsToInclude) {
      updatesDetail += `- ${stats.importantEmails} new email${stats.importantEmails === 1 ? '' : 's'} received:\n`;
      detailedData.emailsToInclude.slice(0, 3).forEach(email => {
        const subject = email.data?.subject || 'No Subject';
        const from = email.data?.fromAddress || 'Unknown Sender';
        updatesDetail += `  • "${subject}" from ${from}\n`;
      });
      if (detailedData.emailsToInclude.length > 3) {
        updatesDetail += `  • ...and ${detailedData.emailsToInclude.length - 3} more\n`;
      }
    }

    // Add detailed conflict information
    if (stats.conflicts > 0 && detailedData?.conflicts) {
      updatesDetail += `- ${stats.conflicts} calendar conflict${stats.conflicts === 1 ? '' : 's'} detected:\n`;
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

Provide a warm welcome message with a brief overview of these updates. Keep it conversational and under 5-6 sentences with some important details. Focus on what needs attention first.`;
  }

  /**
   * Format time period for display
   */
  private formatTimePeriod(since: Date, now: Date): string {
    const diffMs = now.getTime() - since.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays >= 1) {
      return diffDays === 1 ? 'since yesterday' : `since ${diffDays} days ago`;
    } else if (diffHours >= 1) {
      return diffHours === 1
        ? 'since 1 hour ago'
        : `since ${diffHours} hours ago`;
    } else {
      return 'since your last visit';
    }
  }
}

// Export singleton instance
export const loginSummaryService = LoginSummaryService.getInstance();
