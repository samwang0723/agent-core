import {
  EventType,
  EventPriority,
  EventSource,
  GmailImportantEmailEvent,
  CalendarUpcomingEventEvent,
  CalendarNewEventEvent,
} from './event.types';
import { GmailMessage } from '../emails/email.dto';
import { CalendarEvent } from '../calendar/calendar.dto';
import logger from '../utils/logger';

export class EventDetector {
  private static readonly IMPORTANCE_KEYWORDS = [
    'urgent',
    'asap',
    'immediately',
    'emergency',
    'critical',
    'important',
    'deadline',
    'overdue',
    'time sensitive',
    'priority',
    'action required',
    'respond today',
    'needs attention',
    'final notice',
    'last chance',
    'security',
    'alert',
    'invoice',
    'purchase',
    'order',
    'payment',
    'receipt',
    'refund',
    'shipping',
    'delivery',
  ];

  private static readonly VIP_DOMAINS = [
    'gmail.com',
    'bank.com',
    'playstation.com',
    'google.com',
    'microsoft.com',
    'apple.com',
    'amazon.com',
    'meta.com',
    'netflix.com',
    'spotify.com',
    'youtube.com',
    'github.com',
    'crypto.com',
  ];

  private static readonly CALENDAR_IMPORTANT_KEYWORDS = [
    'meeting',
    'interview',
    'presentation',
    'deadline',
    'due',
    'launch',
    'release',
    'review',
    'standup',
    'sync',
    'planning',
  ];

  public static detectImportantEmails(
    emails: (GmailMessage & { id: string })[]
  ): GmailImportantEmailEvent[] {
    const events: GmailImportantEmailEvent[] = [];

    for (const email of emails) {
      const importance = this.calculateEmailImportance(email);

      if (importance === 'high' || importance === 'urgent') {
        const event: GmailImportantEmailEvent = {
          id: `gmail-${email.id}-${Date.now()}`,
          userId: email.userId,
          type: EventType.GMAIL_IMPORTANT_EMAIL,
          timestamp: new Date(),
          priority:
            importance === 'urgent' ? EventPriority.URGENT : EventPriority.HIGH,
          source: EventSource.GMAIL_SYNC,
          data: {
            emailId: email.id,
            subject: email.subject || 'No Subject',
            fromAddress: email.fromAddress || 'Unknown Sender',
            snippet: this.createEmailSnippet(email.body ?? null),
            importance,
            receivedTime: email.receivedTime,
          },
        };

        events.push(event);
        logger.info(
          `Detected important email: ${email.subject} from ${email.fromAddress}`,
          {
            importance,
            emailId: email.id,
          }
        );
      }
    }

    return events;
  }

  public static detectCalendarEvents(
    userId: string,
    newEvents: (CalendarEvent & { id: string })[],
    existingEventIds: Set<string>
  ): (CalendarUpcomingEventEvent | CalendarNewEventEvent)[] {
    const events: (CalendarUpcomingEventEvent | CalendarNewEventEvent)[] = [];
    const now = new Date();

    for (const event of newEvents) {
      const isNewEvent = !existingEventIds.has(event.googleEventId);

      // Detect new events
      if (isNewEvent) {
        const newEventEvent: CalendarNewEventEvent = {
          id: `calendar-new-${event.id}-${Date.now()}`,
          userId,
          type: EventType.CALENDAR_NEW_EVENT,
          timestamp: new Date(),
          priority: this.calculateEventPriority(event),
          source: EventSource.CALENDAR_SYNC,
          data: {
            eventId: event.id,
            title: event.title || 'No Title',
            startTime: event.startTime,
            endTime: event.endTime,
            location: event.location ?? undefined,
            description: event.description ?? undefined,
            attendees: event.attendees ?? undefined,
          },
        };

        events.push(newEventEvent);
        logger.info(`Detected new calendar event: ${event.title}`, {
          eventId: event.id,
          startTime: event.startTime.toISOString(),
        });
      }

      // Detect upcoming events (within next 24 hours)
      const timeUntilStart = event.startTime.getTime() - now.getTime();
      const minutesUntilStart = Math.floor(timeUntilStart / (1000 * 60));

      if (minutesUntilStart > 0 && minutesUntilStart <= 60 * 60 * 2) {
        // 24 hours
        let reminder: 'soon' | 'starting' | 'overdue' = 'soon';

        if (minutesUntilStart <= 15) {
          reminder = 'starting';
        } else if (minutesUntilStart <= 60) {
          reminder = 'soon';
        }

        const upcomingEvent: CalendarUpcomingEventEvent = {
          id: `calendar-upcoming-${event.id}-${Date.now()}`,
          userId,
          type: EventType.CALENDAR_UPCOMING_EVENT,
          timestamp: new Date(),
          priority:
            reminder === 'starting' ? EventPriority.URGENT : EventPriority.HIGH,
          source: EventSource.CALENDAR_SYNC,
          data: {
            eventId: event.id,
            title: event.title || 'No Title',
            startTime: event.startTime,
            endTime: event.endTime,
            location: event.location ?? undefined,
            timeUntilStart: minutesUntilStart,
            reminder,
          },
        };

        events.push(upcomingEvent);
        logger.info(`Detected upcoming calendar event: ${event.title}`, {
          eventId: event.id,
          minutesUntilStart,
          reminder,
        });
      }
    }

    return events;
  }

  private static calculateEmailImportance(
    email: GmailMessage
  ): 'low' | 'medium' | 'high' | 'urgent' {
    let score = 0;
    const subject = (email.subject || '').toLowerCase();
    const body = (email.body || '').toLowerCase();
    const fromAddress = (email.fromAddress || '').toLowerCase();

    // Check for importance keywords in subject (higher weight)
    for (const keyword of this.IMPORTANCE_KEYWORDS) {
      if (subject.includes(keyword)) {
        score += keyword === 'urgent' || keyword === 'emergency' ? 3 : 2;
      }
    }

    // Check for importance keywords in body (lower weight)
    for (const keyword of this.IMPORTANCE_KEYWORDS) {
      if (body.includes(keyword)) {
        score += keyword === 'urgent' || keyword === 'emergency' ? 2 : 1;
      }
    }

    // Check if from VIP domain or known important sender
    if (this.VIP_DOMAINS.some(domain => fromAddress.includes(domain))) {
      score += 1;
    }

    // Check for email patterns that indicate importance
    if (subject.includes('re:') || subject.includes('fwd:')) {
      score += 1; // Replies and forwards might be important
    }

    if (subject.includes('meeting') || subject.includes('calendar')) {
      score += 2; // Meeting-related emails
    }

    // Determine importance level
    if (score >= 4) return 'urgent';
    if (score >= 3) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  private static calculateEventPriority(event: CalendarEvent): EventPriority {
    const title = (event.title || '').toLowerCase();
    const description = (event.description || '').toLowerCase();
    const hasLocation = !!event.location;
    const hasAttendees = event.attendees && event.attendees.length > 0;

    let score = 0;

    // Check for important keywords
    for (const keyword of this.CALENDAR_IMPORTANT_KEYWORDS) {
      if (title.includes(keyword)) {
        score += 2;
      }
      if (description.includes(keyword)) {
        score += 1;
      }
    }

    // Meeting with location is more important
    if (hasLocation) score += 1;

    // Meeting with multiple attendees is more important
    if (hasAttendees) score += 1;

    // Meeting duration (longer meetings might be more important)
    const duration = event.endTime.getTime() - event.startTime.getTime();
    const hours = duration / (1000 * 60 * 60);
    if (hours >= 2) score += 1;

    if (score >= 4) return EventPriority.HIGH;
    if (score >= 2) return EventPriority.MEDIUM;
    return EventPriority.LOW;
  }

  private static createEmailSnippet(body: string | null): string {
    if (!body) return '';

    // Remove HTML tags and get first 100 characters
    const plainText = body.replace(/<[^>]*>/g, '').trim();
    return plainText.length > 100
      ? plainText.substring(0, 100) + '...'
      : plainText;
  }
}
