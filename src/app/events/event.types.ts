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
  GMAIL_IMPORTANT_EMAIL = 'gmail_important_email',
  CALENDAR_UPCOMING_EVENT = 'calendar_upcoming_event',
  CALENDAR_NEW_EVENT = 'calendar_new_event',
  CALENDAR_EVENT_REMINDER = 'calendar_event_reminder',
  CALENDAR_BATCH_SUMMARY = 'calendar_batch_summary',
  EMAIL_BATCH_SUMMARY = 'email_batch_summary',
  SYSTEM_NOTIFICATION = 'system_notification',
  CHAT_MESSAGE = 'chat_message',
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

export interface SystemNotificationEvent extends BaseEvent {
  type: EventType.SYSTEM_NOTIFICATION;
  data: {
    title: string;
    message: string;
    actionUrl?: string;
  };
}

export interface ChatMessageEvent extends BaseEvent {
  type: EventType.CHAT_MESSAGE;
  data: {
    message: string;
    isProactive: boolean;
    triggerEventType?: EventType;
    triggerEventId?: string;
    isBatchSummary?: boolean;
    batchType?: 'calendar' | 'email';
    batchId?: string;
  };
}

export interface CalendarBatchSummaryEvent extends BaseEvent {
  type: EventType.CALENDAR_BATCH_SUMMARY;
  data: {
    batchId: string;
    newEventsCount: number;
    upcomingEventsCount: number;
    summary: string;
  };
}

export interface EmailBatchSummaryEvent extends BaseEvent {
  type: EventType.EMAIL_BATCH_SUMMARY;
  data: {
    batchId: string;
    emailCount: number;
    urgentCount: number;
    summary: string;
  };
}

export type Event =
  | GmailImportantEmailEvent
  | CalendarUpcomingEventEvent
  | CalendarNewEventEvent
  | CalendarBatchSummaryEvent
  | EmailBatchSummaryEvent
  | SystemNotificationEvent
  | ChatMessageEvent;

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
