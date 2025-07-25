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
import { eventBatchService } from '../events/event-batch.service';
import { EventType } from '../events/event.types';

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

      // Detect and process important email events in batch
      try {
        const importantEmailEvents =
          EventDetector.detectImportantEmails(insertedEmails);

        if (importantEmailEvents.length > 0) {
          // Process emails as a batch for summary
          const session = await getSessionByUserId(userId);
          await eventBatchService.processEmailEventBatch(
            userId,
            session?.locale || 'en',
            importantEmailEvents
          );

          logger.info(
            `Processed ${importantEmailEvents.length} important email events as batch for user ${userId}`
          );
        }
      } catch (error) {
        logger.error('Error detecting/processing email events batch', {
          error: error instanceof Error ? error.message : String(error),
          userId,
        });
      }
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

    // Get existing calendar event IDs to detect new events
    const { getExistingCalendarEventIds } = await import(
      '../calendar/calendar.repository'
    );
    const existingEventIds = await getExistingCalendarEventIds(userId);
    const session = await getSessionByUserId(userId);

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

      // Detect and process calendar events in batch
      try {
        const calendarEvents = EventDetector.detectCalendarEvents(
          userId,
          insertedEvents,
          existingEventIds
        );

        if (calendarEvents.length > 0) {
          // Separate conflict events from regular calendar events
          const conflictEvents = calendarEvents.filter(
            e => e.type === EventType.CALENDAR_CONFLICT_DETECTED
          );
          const regularCalendarEvents = calendarEvents.filter(
            e => e.type !== EventType.CALENDAR_CONFLICT_DETECTED
          );

          // Process regular calendar events as a batch for summary
          if (regularCalendarEvents.length > 0) {
            await eventBatchService.processCalendarEventBatch(
              userId,
              session?.locale || 'en',
              regularCalendarEvents
            );
            logger.info(
              `Processed ${regularCalendarEvents.length} calendar events as batch for user ${userId}`
            );
          }

          // Process conflict events as a batch for summary
          if (conflictEvents.length > 0) {
            await eventBatchService.processConflictEventBatch(
              userId,
              session?.locale || 'en',
              conflictEvents
            );
            logger.info(
              `Processed ${conflictEvents.length} conflict events as batch for user ${userId}`
            );
          }
        } else {
          logger.info(
            `No new calendar events to process in the background for user ${userId}`
          );
        }
      } catch (error) {
        logger.error('Error detecting/processing calendar events batch', {
          error: error instanceof Error ? error.message : String(error),
          userId,
        });
      }
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
  cron: '*/20 * * * *',
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
  cron: '*/10 * * * *',
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
