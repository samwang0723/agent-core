import logger from '../utils/logger';
import { GmailService } from '../emails';
import { embeddingService } from '../embeddings';
import { CalendarService } from '../calendar';
import { task, wait } from '@trigger.dev/sdk/v3';

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
