import { CalendarEvent } from '../calendar/calendar.dto';
import {
  CalendarConflictEvent,
  EventType,
  EventPriority,
  EventSource,
} from './event.types';
import logger from '../utils/logger';

export interface ConflictDetectionOptions {
  backToBackThreshold?: number; // minutes between events to consider "back-to-back"
  enableBackToBackDetection?: boolean;
  minOverlapForDetection?: number; // minimum minutes of overlap to trigger conflict
}

export interface ConflictAnalysis {
  hasConflicts: boolean;
  conflicts: CalendarConflictEvent[];
}

export class ConflictDetectionService {
  private static readonly DEFAULT_OPTIONS: Required<ConflictDetectionOptions> =
    {
      backToBackThreshold: 0, // 0 minutes = touching events
      enableBackToBackDetection: true,
      minOverlapForDetection: 1, // 1 minute minimum overlap
    };

  public static analyzeEventConflicts(
    userId: string,
    userEmail: string,
    events: (CalendarEvent & { id: string })[],
    options: ConflictDetectionOptions = {}
  ): ConflictAnalysis {
    const config = { ...this.DEFAULT_OPTIONS, ...options };
    const conflicts: CalendarConflictEvent[] = [];

    // Filter out events that should not trigger conflicts
    const filteredEvents = events.filter(event =>
      this.shouldIncludeInConflictDetection(event, userEmail)
    );

    if (filteredEvents.length < events.length) {
      logger.debug(
        `Filtered out ${events.length - filteredEvents.length} events from conflict detection (whole day/OOO events)`,
        {
          originalCount: events.length,
          filteredCount: filteredEvents.length,
          userId,
        }
      );
    }

    // Sort events by start time for efficient processing
    const sortedEvents = filteredEvents.sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    // Check each event against all subsequent events
    for (let i = 0; i < sortedEvents.length; i++) {
      for (let j = i + 1; j < sortedEvents.length; j++) {
        const event1 = sortedEvents[i];
        const event2 = sortedEvents[j];

        // If event2 starts after event1 ends completely, no more conflicts possible for event1
        if (event2.startTime.getTime() >= event1.endTime.getTime()) {
          const timeBetween =
            (event2.startTime.getTime() - event1.endTime.getTime()) /
            (1000 * 60);

          // Check for back-to-back conflicts
          if (
            config.enableBackToBackDetection &&
            timeBetween <= config.backToBackThreshold
          ) {
            const conflict = this.createBackToBackConflict(
              userId,
              event1,
              event2,
              timeBetween
            );
            conflicts.push(conflict);
          }
          break; // No more overlaps possible for event1
        }

        // Check for time overlap
        const overlapAnalysis = this.analyzeTimeOverlap(event1, event2);
        if (
          overlapAnalysis.hasOverlap &&
          overlapAnalysis.overlapMinutes >= config.minOverlapForDetection
        ) {
          const conflict = this.createOverlapConflict(
            userId,
            event1,
            event2,
            overlapAnalysis
          );
          conflicts.push(conflict);
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
    };
  }

  private static analyzeTimeOverlap(
    event1: CalendarEvent & { id: string },
    event2: CalendarEvent & { id: string }
  ): {
    hasOverlap: boolean;
    overlapMinutes: number;
    overlapType: 'exact' | 'partial';
  } {
    const start1 = event1.startTime.getTime();
    const end1 = event1.endTime.getTime();
    const start2 = event2.startTime.getTime();
    const end2 = event2.endTime.getTime();

    // No overlap if events don't intersect
    if (end1 <= start2 || end2 <= start1) {
      return { hasOverlap: false, overlapMinutes: 0, overlapType: 'partial' };
    }

    // Calculate overlap period
    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    const overlapMinutes = (overlapEnd - overlapStart) / (1000 * 60);

    // Determine if it's exact or partial overlap
    const isExactOverlap = start1 === start2 && end1 === end2;

    return {
      hasOverlap: true,
      overlapMinutes,
      overlapType: isExactOverlap ? 'exact' : 'partial',
    };
  }

  private static createOverlapConflict(
    userId: string,
    event1: CalendarEvent & { id: string },
    event2: CalendarEvent & { id: string },
    overlapAnalysis: {
      overlapMinutes: number;
      overlapType: 'exact' | 'partial';
    }
  ): CalendarConflictEvent {
    const severity = this.calculateConflictSeverity(
      overlapAnalysis.overlapMinutes,
      overlapAnalysis.overlapType
    );
    const suggestions = this.generateConflictSuggestions(
      event1,
      event2,
      overlapAnalysis
    );

    return {
      id: `conflict-${event1.id}-${event2.id}-${Date.now()}`,
      userId,
      type: EventType.CALENDAR_CONFLICT_DETECTED,
      timestamp: new Date(),
      priority:
        severity === 'major' ? EventPriority.HIGH : EventPriority.MEDIUM,
      source: EventSource.CALENDAR_SYNC,
      data: {
        conflictId: `${event1.id}-${event2.id}`,
        conflictingEvents: [
          {
            eventId: event1.id,
            title: event1.title || 'Untitled Event',
            startTime: event1.startTime,
            endTime: event1.endTime,
            location: event1.location ?? undefined,
          },
          {
            eventId: event2.id,
            title: event2.title || 'Untitled Event',
            startTime: event2.startTime,
            endTime: event2.endTime,
            location: event2.location ?? undefined,
          },
        ],
        conflictType:
          overlapAnalysis.overlapType === 'exact'
            ? 'exact_overlap'
            : 'partial_overlap',
        severity,
        overlapDuration: Math.round(overlapAnalysis.overlapMinutes),
        suggestions,
        detectedAt: new Date(),
      },
    };
  }

  private static createBackToBackConflict(
    userId: string,
    event1: CalendarEvent & { id: string },
    event2: CalendarEvent & { id: string },
    timeBetween: number
  ): CalendarConflictEvent {
    const suggestions = this.generateBackToBackSuggestions(
      event1,
      event2,
      timeBetween
    );

    return {
      id: `conflict-b2b-${event1.id}-${event2.id}-${Date.now()}`,
      userId,
      type: EventType.CALENDAR_CONFLICT_DETECTED,
      timestamp: new Date(),
      priority: EventPriority.LOW,
      source: EventSource.CALENDAR_SYNC,
      data: {
        conflictId: `b2b-${event1.id}-${event2.id}`,
        conflictingEvents: [
          {
            eventId: event1.id,
            title: event1.title || 'Untitled Event',
            startTime: event1.startTime,
            endTime: event1.endTime,
            location: event1.location ?? undefined,
          },
          {
            eventId: event2.id,
            title: event2.title || 'Untitled Event',
            startTime: event2.startTime,
            endTime: event2.endTime,
            location: event2.location ?? undefined,
          },
        ],
        conflictType: 'back_to_back',
        severity: 'minor',
        overlapDuration: Math.round(Math.abs(timeBetween)), // Gap duration in minutes (always positive)
        suggestions,
        detectedAt: new Date(),
      },
    };
  }

  private static calculateConflictSeverity(
    overlapMinutes: number,
    overlapType: 'exact' | 'partial'
  ): 'minor' | 'moderate' | 'major' {
    if (overlapType === 'exact') {
      return 'major'; // Exact time conflicts are always major
    }

    if (overlapMinutes >= 60) {
      return 'major'; // 1+ hour overlap
    } else if (overlapMinutes >= 30) {
      return 'moderate'; // 30+ minute overlap
    } else {
      return 'minor'; // Less than 30 minutes
    }
  }

  private static generateConflictSuggestions(
    event1: CalendarEvent & { id: string },
    event2: CalendarEvent & { id: string },
    overlapAnalysis: {
      overlapMinutes: number;
      overlapType: 'exact' | 'partial';
    }
  ) {
    const suggestions = [];

    // Determine which event might be easier to reschedule (newer events are often more flexible)
    const event1Duration =
      (event1.endTime.getTime() - event1.startTime.getTime()) / (1000 * 60);
    const event2Duration =
      (event2.endTime.getTime() - event2.startTime.getTime()) / (1000 * 60);

    // Suggest rescheduling the shorter event first
    const shorterEvent = event1Duration <= event2Duration ? event1 : event2;
    // const longerEvent = shorterEvent === event1 ? event2 : event1;

    suggestions.push({
      action: 'reschedule' as const,
      description: `Consider rescheduling "${shorterEvent.title}" to avoid the ${Math.round(overlapAnalysis.overlapMinutes)}-minute conflict`,
      eventId: shorterEvent.id,
    });

    if (
      overlapAnalysis.overlapMinutes <
      Math.min(event1Duration, event2Duration) / 2
    ) {
      // If overlap is less than half the duration of either event, suggest shortening
      suggestions.push({
        action: 'shorten' as const,
        description: `Shorten one of the events by ${Math.round(overlapAnalysis.overlapMinutes)} minutes to eliminate overlap`,
      });
    }

    if (overlapAnalysis.overlapType === 'exact') {
      suggestions.push({
        action: 'cancel' as const,
        description: 'Consider canceling one of the duplicate events',
      });
    }

    suggestions.push({
      action: 'accept_conflict' as const,
      description:
        'Accept the scheduling conflict if both events are necessary',
    });

    return suggestions;
  }

  private static generateBackToBackSuggestions(
    event1: CalendarEvent & { id: string },
    event2: CalendarEvent & { id: string },
    timeBetween: number
  ) {
    const suggestions = [];
    const gapMinutes = Math.abs(timeBetween);
    const gapDescription =
      gapMinutes === 0
        ? 'events are back-to-back with no gap'
        : `only ${Math.round(gapMinutes)} minute${gapMinutes === 1 ? '' : 's'} between events`;

    if (
      event1.location !== event2.location &&
      (event1.location || event2.location)
    ) {
      suggestions.push({
        action: 'reschedule' as const,
        description: `Consider adding travel time between "${event1.title}" and "${event2.title}" (different locations, ${gapDescription})`,
      });
    }

    suggestions.push({
      action: 'shorten' as const,
      description: `Consider ending "${event1.title}" early to create more transition time (currently ${gapDescription})`,
      eventId: event1.id,
    });

    suggestions.push({
      action: 'accept_conflict' as const,
      description:
        gapMinutes === 0
          ? 'Accept the back-to-back scheduling if no transition time is needed'
          : `Accept the tight scheduling (${Math.round(gapMinutes)} minute${gapMinutes === 1 ? '' : 's'} gap)`,
    });

    return suggestions;
  }

  /**
   * Determine if an event should be included in conflict detection
   * Excludes whole day events and Out of Office/Annual Leave events
   */
  private static shouldIncludeInConflictDetection(
    event: CalendarEvent & { id: string },
    userEmail: string
  ): boolean {
    // Skip whole day events - these are usually informational (holidays, etc.)
    if (this.isWholeDayEvent(event)) {
      return false;
    }

    // Skip Out of Office and Annual Leave events
    if (this.isOutOfOfficeEvent(event)) {
      return false;
    }

    // if current user has declined/rejected the event, skip
    if (event.attendees) {
      const userAttendee = event.attendees.find(
        attendee => attendee.email === userEmail
      );
      if (userAttendee && userAttendee.responseStatus === 'declined') {
        return false;
      }
    }

    // if event is in the past, skip
    if (event.startTime < new Date()) {
      return false;
    }

    return true;
  }

  /**
   * Check if an event is a whole day event
   * Whole day events typically span 24 hours or more and are often informational
   */
  private static isWholeDayEvent(event: CalendarEvent): boolean {
    const duration = event.endTime.getTime() - event.startTime.getTime();
    const hours = duration / (1000 * 60 * 60);

    // Consider events 20+ hours as whole day events
    // This accounts for timezone differences and slightly imprecise whole day events
    return hours >= 20;
  }

  /**
   * Check if an event is related to Out of Office or Annual Leave
   */
  private static isOutOfOfficeEvent(event: CalendarEvent): boolean {
    const title = (event.title || '').toLowerCase();
    const description = (event.description || '').toLowerCase();

    const oooKeywords = [
      'out of office',
      'ooo',
      'annual leave',
      'al',
      'vacation',
      'holiday',
      'time off',
      'pto',
      'personal time off',
      'sick leave',
      'medical leave',
      'maternity leave',
      'paternity leave',
      'bereavement',
      'sabbatical',
      'leave of absence',
      'day off',
      'working from home', // Sometimes people block calendar for WFH
      'wfh',
      'remote work',
      'unavailable',
      'busy',
      'blocked',
      'do not schedule',
    ];

    // Check both title and description for OOO indicators
    return oooKeywords.some(
      keyword => title.includes(keyword) || description.includes(keyword)
    );
  }

  public static logConflictDetection(conflicts: CalendarConflictEvent[]): void {
    if (conflicts.length === 0) {
      logger.debug('No calendar conflicts detected');
      return;
    }

    logger.info(`Detected ${conflicts.length} calendar conflicts`, {
      conflictCount: conflicts.length,
      conflictTypes: conflicts.map(c => c.data.conflictType),
      severities: conflicts.map(c => c.data.severity),
    });

    conflicts.forEach(conflict => {
      logger.info(`Calendar conflict detected: ${conflict.data.conflictType}`, {
        conflictId: conflict.data.conflictId,
        severity: conflict.data.severity,
        overlapDuration: conflict.data.overlapDuration,
        eventTitles: conflict.data.conflictingEvents.map(e => e.title),
      });
    });
  }
}
