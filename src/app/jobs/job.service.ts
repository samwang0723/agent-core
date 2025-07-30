import logger from '../utils/logger';
import { GmailService } from '../emails';
import { embeddingService } from '../embeddings';
import { CalendarService } from '../calendar';
import { task, wait, schedules } from '@trigger.dev/sdk/v3';
import {
  getActiveUsersWithGoogleIntegration,
  getSessionByUserId,
} from '../users/user.repository';
import { EventDetector } from '../events/event.detector';
import { EventType } from '../events/event.types';
import { unifiedSummaryService } from '../events/unified-summary.service';
import { pusherEventBroadcaster } from '../events/pusher.service';
import { featureFlags } from '../utils/feature-flags';
import {
  GoogleCalendarEvent,
  GoogleEmailMessage,
} from '../types/google-api.types';

export const importGmailTask = task({
  id: 'import-gmail',
  maxDuration: 300,
  run: async (payload: { token: string; userId: string }, { ctx }) => {
    logger.info('Fetching and storing emails in the background...', {
      payload,
      ctx,
    });
    await importGmail(payload.token, payload.userId);

    await wait.for({ seconds: 5 });

    return {
      message: 'gmail imported',
    };
  },
});

async function importGmail(token: string, userId: string): Promise<string> {
  try {
    logger.info('Fetching and storing emails in the background...');
    const gmailService = new GmailService();
    await gmailService.initialize(token);
    const emailResponse = await gmailService.getEmails();
    const emails = emailResponse.messages || [];

    logger.info(`Fetched ${emails.length} emails`);
    if (emails.length > 0) {
      const insertedEmails = await gmailService.batchInsertEmails(
        userId,
        emails
      );
      logger.info(
        `Successfully processed ${insertedEmails.length} emails in the background.`
      );

      const emailsForEmbedding = insertedEmails.map(e => ({
        id: e.id,
        fromAddress: e.fromAddress ?? undefined,
        subject: e.subject ?? undefined,
        body: e.body ?? undefined,
      }));

      await embeddingService.createEmbeddingsForEmails(
        userId,
        emailsForEmbedding
      );
      logger.info(
        `Successfully created embeddings for ${insertedEmails.length} emails.`
      );

      // Note: Email events are now handled by unified summary system
      logger.info(
        `Successfully imported ${insertedEmails.length} emails for user ${userId}`
      );
    } else {
      logger.info('No new emails to process in the background.');
    }

    return 'imported';
  } catch (error) {
    logger.error('Error in importGmail activity', {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    throw new Error('Failed to import Gmail');
  }
}

export const importCalendarTask = task({
  id: 'import-calendar',
  maxDuration: 300,
  run: async (payload: { token: string; userId: string }, { ctx }) => {
    logger.info('Fetching and storing calendar events in the background...', {
      payload,
      ctx,
    });
    await importCalendar(payload.token, payload.userId);

    await wait.for({ seconds: 5 });

    return {
      message: 'calendar imported',
    };
  },
});

async function importCalendar(token: string, userId: string): Promise<string> {
  try {
    logger.info('Fetching and storing calendar events in the background...');
    const calendarService = new CalendarService();
    await calendarService.initialize(token);

    // Note: Event detection now handled by unified summary system

    const eventResponse = await calendarService.getCalendarEvents();
    const events = eventResponse.events || [];

    logger.info(`Fetched ${events.length} calendar events`);
    if (events.length > 0) {
      const insertedEvents = await calendarService.batchInsertCalendarEvents(
        userId,
        events
      );
      logger.info(
        `Successfully processed ${insertedEvents.length} events in the background.`
      );

      const eventsForEmbedding = insertedEvents.map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        location: e.location,
        startTime: e.startTime,
        endTime: e.endTime,
      }));

      await embeddingService.createEmbeddingsForCalendarEvents(
        userId,
        eventsForEmbedding
      );
      logger.info(
        `Successfully created embeddings for ${insertedEvents.length} events.`
      );

      // Note: Calendar events are now handled by unified summary system
      logger.info(
        `Successfully imported ${insertedEvents.length} calendar events for user ${userId}`
      );
    } else {
      logger.info('No new calendar events to process in the background.');
    }

    return 'imported';
  } catch (error) {
    logger.error('Error in importCalendar activity', {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    throw new Error('Failed to import Calendar events');
  }
}

export const syncGmailCronTask = schedules.task({
  id: 'sync-gmail-cron',
  maxDuration: 1800,
  cron: '*/60 * * * *',
  run: async (payload, { ctx }) => {
    logger.info('Starting scheduled Gmail sync for all users...', { ctx });

    try {
      const activeUsers = await getActiveUsersWithGoogleIntegration();
      logger.info(
        `Found ${activeUsers.length} active users with Google integration`
      );

      let successCount = 0;
      let errorCount = 0;

      for (const user of activeUsers) {
        try {
          await importGmail(user.access_token, user.user_id);
          successCount++;
          logger.info(`Successfully synced Gmail for user ${user.user_id}`);
        } catch (error) {
          errorCount++;
          logger.error(`Failed to sync Gmail for user ${user.user_id}`, {
            error: error instanceof Error ? error.message : String(error),
            userId: user.user_id,
          });
        }

        await wait.for({ seconds: 10 });
      }

      logger.info(
        `Gmail sync completed: ${successCount} successful, ${errorCount} errors`
      );

      return {
        message: `Gmail sync completed: ${successCount} successful, ${errorCount} errors`,
        successCount,
        errorCount,
        totalUsers: activeUsers.length,
      };
    } catch (error) {
      logger.error('Error in scheduled Gmail sync', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const syncCalendarCronTask = schedules.task({
  id: 'sync-calendar-cron',
  cron: '*/30 * * * *',
  maxDuration: 1800,
  run: async (payload, { ctx }) => {
    logger.info('Starting scheduled Calendar sync for all users...', { ctx });

    try {
      const activeUsers = await getActiveUsersWithGoogleIntegration();
      logger.info(
        `Found ${activeUsers.length} active users with Google integration`
      );

      let successCount = 0;
      let errorCount = 0;

      for (const user of activeUsers) {
        try {
          await importCalendar(user.access_token, user.user_id);
          successCount++;
          logger.info(`Successfully synced Calendar for user ${user.user_id}`);
        } catch (error) {
          errorCount++;
          logger.error(`Failed to sync Calendar for user ${user.user_id}`, {
            error: error instanceof Error ? error.message : String(error),
            userId: user.user_id,
          });
        }

        await wait.for({ seconds: 10 });
      }

      logger.info(
        `Calendar sync completed: ${successCount} successful, ${errorCount} errors`
      );

      return {
        message: `Calendar sync completed: ${successCount} successful, ${errorCount} errors`,
        successCount,
        errorCount,
        totalUsers: activeUsers.length,
      };
    } catch (error) {
      logger.error('Error in scheduled Calendar sync', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const unifiedSummaryCronTask = schedules.task({
  id: 'unified-summary-cron',
  cron: '*/10 * * * *', // Every 30 minutes
  maxDuration: 1800,
  run: async (payload, { ctx }) => {
    // Check if feature is enabled
    if (!featureFlags.isPeriodicSummaryEnabled()) {
      logger.info('Unified summary cron job skipped - feature disabled', {
        ctx,
      });
      return {
        message: 'Feature disabled',
        successCount: 0,
        errorCount: 0,
        totalUsers: 0,
      };
    }

    logger.info('Starting unified summary generation for all users...', {
      ctx,
    });

    try {
      const activeUsers = await getActiveUsersWithGoogleIntegration();
      logger.info(
        `Found ${activeUsers.length} active users for unified summary`
      );

      let successCount = 0;
      let errorCount = 0;

      for (const user of activeUsers) {
        try {
          // Check if user is enabled for unified notifications
          if (
            !featureFlags.isUnifiedNotificationsEnabledForUser(user.user_id)
          ) {
            logger.debug(
              `Skipping unified summary for user ${user.user_id} - not enabled`
            );
            continue;
          }

          const session = await getSessionByUserId(user.user_id);
          await unifiedSummaryService.generatePeriodicSummary(
            user.user_id,
            user.access_token,
            session?.locale || 'en'
          );
          successCount++;
          logger.info(
            `Successfully generated unified summary for user ${user.user_id}`
          );
        } catch (error) {
          errorCount++;
          logger.error(
            `Failed to generate unified summary for user ${user.user_id}`,
            {
              error: error instanceof Error ? error.message : String(error),
              userId: user.user_id,
            }
          );
        }

        await wait.for({ seconds: 2 });
      }

      logger.info(
        `Unified summary generation completed: ${successCount} successful, ${errorCount} errors`
      );

      return {
        message: `Unified summary generation completed: ${successCount} successful, ${errorCount} errors`,
        successCount,
        errorCount,
        totalUsers: activeUsers.length,
      };
    } catch (error) {
      logger.error('Error in unified summary generation', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const realTimeEventsCronTask = schedules.task({
  id: 'real-time-events-cron',
  cron: '*/20 * * * *', // Every 10 minutes
  maxDuration: 1200,
  run: async (payload, { ctx }) => {
    // Check if feature is enabled
    if (!featureFlags.isRealTimeEventsEnabled()) {
      logger.info('Real-time events cron job skipped - feature disabled', {
        ctx,
      });
      return {
        message: 'Feature disabled',
        successCount: 0,
        errorCount: 0,
        totalUsers: 0,
      };
    }

    logger.info('Starting real-time events broadcast for all users...', {
      ctx,
    });

    try {
      const activeUsers = await getActiveUsersWithGoogleIntegration();
      logger.info(
        `Found ${activeUsers.length} active users for real-time events`
      );

      let successCount = 0;
      let errorCount = 0;

      for (const user of activeUsers) {
        try {
          // Check if user is enabled for unified notifications
          if (
            !featureFlags.isUnifiedNotificationsEnabledForUser(user.user_id)
          ) {
            logger.debug(
              `Skipping real-time events for user ${user.user_id} - not enabled`
            );
            continue;
          }

          await broadcastRealTimeEvents(user.user_id, user.access_token);
          successCount++;
          logger.info(
            `Successfully broadcasted real-time events for user ${user.user_id}`
          );
        } catch (error) {
          errorCount++;
          logger.error(
            `Failed to broadcast real-time events for user ${user.user_id}`,
            {
              error: error instanceof Error ? error.message : String(error),
              userId: user.user_id,
            }
          );
        }

        await wait.for({ seconds: 1 });
      }

      logger.info(
        `Real-time events broadcast completed: ${successCount} successful, ${errorCount} errors`
      );

      return {
        message: `Real-time events broadcast completed: ${successCount} successful, ${errorCount} errors`,
        successCount,
        errorCount,
        totalUsers: activeUsers.length,
      };
    } catch (error) {
      logger.error('Error in real-time events broadcast', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

async function broadcastRealTimeEvents(
  userId: string,
  accessToken: string
): Promise<void> {
  try {
    // Initialize services
    const calendarService = new CalendarService();
    const gmailService = new GmailService();

    await Promise.all([
      calendarService.initialize(accessToken),
      gmailService.initialize(accessToken),
    ]);

    // Fetch recent data (last 10 minutes)
    const cutoffTime = new Date(Date.now() - 10 * 60 * 1000);
    const now = new Date();

    const [calendarResponse, emailResponse] = await Promise.all([
      calendarService.getCalendarEvents(),
      gmailService.getEmails(),
    ]);

    const calendarEvents = (calendarResponse.events ||
      []) as GoogleCalendarEvent[];
    const emails = (emailResponse.messages || []) as GoogleEmailMessage[];

    // Filter for recent changes
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
      return minutesUntilStart > 0 && minutesUntilStart <= 60; // Next hour
    });

    const recentEmails = emails.filter(email => {
      const receivedTime = new Date(parseInt(email.internalDate, 10));
      return receivedTime > cutoffTime;
    });

    // Broadcast raw events without chat conversion
    for (const event of newCalendarEvents) {
      await pusherEventBroadcaster.broadcastToUser(
        userId,
        EventType.CALENDAR_NEW_EVENT,
        {
          eventId: event.id,
          title: event.summary || 'No Title',
          startTime: new Date(event.start.dateTime || event.start.date || ''),
          endTime: new Date(event.end.dateTime || event.end.date || ''),
          location: event.location,
          description: event.description,
          attendees: event.attendees,
        }
      );
    }

    for (const event of upcomingEvents) {
      const timeUntilStart = Math.floor(
        (new Date(event.start.dateTime || event.start.date || '').getTime() -
          now.getTime()) /
          (1000 * 60)
      );

      await pusherEventBroadcaster.broadcastToUser(
        userId,
        EventType.CALENDAR_UPCOMING_EVENT,
        {
          eventId: event.id,
          title: event.summary || 'No Title',
          startTime: new Date(event.start.dateTime || event.start.date || ''),
          endTime: new Date(event.end.dateTime || event.end.date || ''),
          location: event.location,
          timeUntilStart,
          reminder: timeUntilStart <= 15 ? 'starting' : 'soon',
        }
      );
    }

    // Detect and broadcast important emails
    const importantEmails = EventDetector.detectImportantEmails(
      recentEmails.map(email => ({
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
      }))
    );

    for (const emailEvent of importantEmails) {
      await pusherEventBroadcaster.broadcastToUser(
        userId,
        EventType.GMAIL_IMPORTANT_EMAIL,
        emailEvent.data
      );
    }

    logger.debug(
      `Broadcasted ${newCalendarEvents.length} calendar events, ${upcomingEvents.length} upcoming events, ${importantEmails.length} important emails for user ${userId}`
    );
  } catch (error) {
    logger.error(`Error broadcasting real-time events for user ${userId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
