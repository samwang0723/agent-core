/**
 * Type definitions for Google API responses
 */

export interface GoogleCalendarDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarAttendee {
  email: string;
  responseStatus: string;
  [key: string]: unknown;
}

export interface GoogleCalendarOrganizer {
  email?: string;
  displayName?: string;
  self?: boolean;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleCalendarDateTime;
  end: GoogleCalendarDateTime;
  attendees?: GoogleCalendarAttendee[];
  organizer?: GoogleCalendarOrganizer;
  status?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
}

export interface GoogleEmailHeader {
  name: string;
  value: string;
}

export interface GoogleEmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  headers: GoogleEmailHeader[];
  textBody?: string;
}
