import * as calendarRepo from './calendar.repository';
import {
  GoogleCalendarEvent,
  CalendarEvent,
  GoogleCalendarListEventsResponse,
  GoogleCalendarInfo,
  GoogleCalendarsResponse,
} from './calendar.dto';
import logger from '../utils/logger';
import { McpClient } from '../../mastra/tools/remote/mcp.service';
import { toolRegistry } from '../../mastra/tools/registry';

export class CalendarService {
  private client: McpClient | undefined = undefined;
  private accessToken: string | null = null;

  public async initialize(token: string): Promise<void> {
    try {
      this.client = toolRegistry.getClient('google-assistant');
      if (!this.client) {
        throw new Error('Google Assistant MCP client not found.');
      }
      this.accessToken = token;
    } catch (error) {
      logger.error('Error initializing Gmail service', { error });
      throw new Error('Failed to initialize Gmail service.');
    }
  }

  public async getCalendarEvents(): Promise<GoogleCalendarListEventsResponse> {
    if (!this.client) {
      throw new Error('Calendar service not initialized.');
    }

    const startOfToday = new Date();
    const endOfTwoDays = new Date(startOfToday);
    endOfTwoDays.setDate(endOfTwoDays.getDate() + 2); // Two days from today
    endOfTwoDays.setMilliseconds(-1); // End of the day before

    const listCalendarsResponse = (await this.client.callTool(
      'gcalendar_list_calendars',
      {},
      this.accessToken!
    )) as GoogleCalendarsResponse;
    const calendars = listCalendarsResponse.response || [];

    // 1. if primary id exists, using primary
    // 2. if no primary id, using id equals to email (using regex)
    let primaryCalendar = calendars.find(
      (calendar: GoogleCalendarInfo) => calendar.id === 'primary'
    );

    if (!primaryCalendar) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      primaryCalendar = calendars.find((calendar: GoogleCalendarInfo) =>
        emailRegex.test(calendar.id)
      );
    }

    const response = (await this.client.callTool(
      'gcalendar_list_events',
      {
        calendarId: primaryCalendar?.id || 'primary',
        timeMin: startOfToday.toISOString(),
        timeMax: endOfTwoDays.toISOString(),
        maxResults: 20,
      },
      this.accessToken!
    )) as GoogleCalendarListEventsResponse;

    // Process the response to strip HTML tags from event descriptions
    if (response.events && Array.isArray(response.events)) {
      response.events = response.events.map((event: GoogleCalendarEvent) => ({
        ...event,
        description: this.stripHtmlTags(event.description)?.slice(0, 200),
      }));
    }

    return response;
  }

  private parseEventTime(eventTime: {
    date?: string;
    dateTime?: string;
  }): Date {
    return new Date(eventTime.dateTime || eventTime.date!);
  }

  private stripHtmlTags(
    htmlString: string | null | undefined
  ): string | undefined {
    if (!htmlString) {
      return undefined;
    }

    // Remove HTML tags using regex and decode HTML entities
    const stripped = htmlString
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
      .replace(/&amp;/g, '&') // Replace encoded ampersands
      .replace(/&lt;/g, '<') // Replace encoded less than
      .replace(/&gt;/g, '>') // Replace encoded greater than
      .replace(/&quot;/g, '"') // Replace encoded quotes
      .replace(/&#39;/g, "'") // Replace encoded single quotes
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .trim(); // Remove leading/trailing whitespace

    return stripped || undefined;
  }

  public async batchInsertCalendarEvents(
    userId: string,
    events: GoogleCalendarEvent[]
  ): Promise<(CalendarEvent & { id: string })[]> {
    if (events.length === 0) {
      logger.info('No calendar events to insert.');
      return [];
    }

    const formattedEvents: CalendarEvent[] = events.map(event => ({
      userId,
      googleEventId: event.id,
      title: event.summary,
      description: this.stripHtmlTags(event.description),
      startTime: this.parseEventTime(event.start),
      endTime: this.parseEventTime(event.end),
      location: event.location,
      attendees: event.attendees,
      organizer: event.organizer,
      status: event.status,
      htmlLink: event.htmlLink,
    }));

    try {
      const inserted = await calendarRepo.insertCalendarEvents(formattedEvents);

      const fullInsertedEvents = formattedEvents
        .map(formattedEvent => {
          const dbRecord = inserted.find(
            i => i.google_event_id === formattedEvent.googleEventId
          );
          return {
            ...formattedEvent,
            id: dbRecord?.id,
          };
        })
        .filter((e): e is CalendarEvent & { id: string } => !!e.id);

      return fullInsertedEvents;
    } catch (error) {
      logger.error('Error inserting calendar events into database', {
        error,
        count: events.length,
      });
      throw new Error('Failed to insert calendar events.');
    }
  }
}

export default new CalendarService();
