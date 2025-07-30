export interface BaseEvent {
  id: string;
  userId: string;
  type: EventType;
  timestamp: Date;
  data: Record<string, unknown>;
  priority: EventPriority;
  source: EventSource;
}

export enum EventType {
  // Raw events for frontend notifications (no chat conversion)
  GMAIL_IMPORTANT_EMAIL = 'gmail_important_email',
  CALENDAR_UPCOMING_EVENT = 'calendar_upcoming_event',
  CALENDAR_NEW_EVENT = 'calendar_new_event',
  CALENDAR_CONFLICT_DETECTED = 'calendar_conflict_detected',

  // Unified summaries (with chat conversion)
  LOGIN_SUMMARY = 'login_summary',
  UNIFIED_PERIODIC_SUMMARY = 'unified_periodic_summary',

  // System events
  SYSTEM_NOTIFICATION = 'system_notification',
}

export enum EventPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum EventSource {
  GMAIL_SYNC = 'gmail_sync',
  CALENDAR_SYNC = 'calendar_sync',
  SYSTEM = 'system',
}

export interface GmailImportantEmailEvent extends BaseEvent {
  type: EventType.GMAIL_IMPORTANT_EMAIL;
  data: {
    emailId: string;
    subject: string;
    fromAddress: string;
    snippet: string;
    importance: 'high' | 'urgent';
    receivedTime: Date;
  };
}

export interface CalendarUpcomingEventEvent extends BaseEvent {
  type: EventType.CALENDAR_UPCOMING_EVENT;
  data: {
    eventId: string;
    title: string;
    startTime: Date;
    endTime: Date;
    location?: string;
    timeUntilStart: number; // minutes
    reminder: 'soon' | 'starting' | 'overdue';
  };
}

export interface CalendarNewEventEvent extends BaseEvent {
  type: EventType.CALENDAR_NEW_EVENT;
  data: {
    eventId: string;
    title: string;
    startTime: Date;
    endTime: Date;
    location?: string;
    description?: string;
    attendees?: {
      email: string;
      responseStatus: string;
      [key: string]: unknown;
    }[];
  };
}

// Raw events for frontend (no chat conversion)
export interface GmailImportantEmailEvent extends BaseEvent {
  type: EventType.GMAIL_IMPORTANT_EMAIL;
  data: {
    emailId: string;
    subject: string;
    fromAddress: string;
    snippet: string;
    importance: 'high' | 'urgent';
    receivedTime: Date;
  };
}

export interface CalendarUpcomingEventEvent extends BaseEvent {
  type: EventType.CALENDAR_UPCOMING_EVENT;
  data: {
    eventId: string;
    title: string;
    startTime: Date;
    endTime: Date;
    location?: string;
    timeUntilStart: number; // minutes
    reminder: 'soon' | 'starting' | 'overdue';
  };
}

export interface CalendarNewEventEvent extends BaseEvent {
  type: EventType.CALENDAR_NEW_EVENT;
  data: {
    eventId: string;
    title: string;
    startTime: Date;
    endTime: Date;
    location?: string;
    description?: string;
    attendees?: {
      email: string;
      responseStatus: string;
      [key: string]: unknown;
    }[];
  };
}

export interface CalendarConflictEvent extends BaseEvent {
  type: EventType.CALENDAR_CONFLICT_DETECTED;
  data: {
    conflictId: string;
    conflictingEvents: {
      eventId: string;
      title: string;
      startTime: Date;
      endTime: Date;
      location?: string;
    }[];
    conflictType: 'exact_overlap' | 'partial_overlap' | 'back_to_back';
    severity: 'minor' | 'moderate' | 'major';
    overlapDuration?: number; // minutes of overlap (for overlaps) or gap duration (for back-to-back)
    suggestions: {
      action: 'reschedule' | 'shorten' | 'cancel' | 'accept_conflict';
      description: string;
      eventId?: string;
    }[];
    detectedAt: Date;
  };
}

// Unified summary events (with chat conversion)
export interface LoginSummaryEvent extends BaseEvent {
  type: EventType.LOGIN_SUMMARY;
  data: {
    summaryId: string;
    lastLoginAt?: Date;
    summary: string;
    stats: {
      newCalendarEvents: number;
      upcomingEvents: number;
      importantEmails: number;
      conflicts: number;
    };
    periodCovered: string;
  };
}

export interface UnifiedPeriodicSummaryEvent extends BaseEvent {
  type: EventType.UNIFIED_PERIODIC_SUMMARY;
  data: {
    summaryId: string;
    lastSummaryAt: Date;
    summary: string;
    stats: {
      newCalendarEvents: number;
      upcomingEvents: number;
      importantEmails: number;
      conflicts: number;
    };
    changesSinceLastSummary: boolean;
  };
}

// System events
export interface SystemNotificationEvent extends BaseEvent {
  type: EventType.SYSTEM_NOTIFICATION;
  data: {
    title: string;
    message: string;
    actionUrl?: string;
  };
}

// Clean union type with only necessary events
export type Event =
  | GmailImportantEmailEvent
  | CalendarUpcomingEventEvent
  | CalendarNewEventEvent
  | CalendarConflictEvent
  | LoginSummaryEvent
  | UnifiedPeriodicSummaryEvent
  | SystemNotificationEvent;

export interface EventSubscription {
  userId: string;
  eventTypes: EventType[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventBroadcastResult {
  success: boolean;
  subscriberCount: number;
  eventId: string;
  error?: string;
}
