export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  attendees?: {
    email: string;
    responseStatus: string;
  }[];
  organizer?: {
    email: string;
  };
  htmlLink: string;
  status: string;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
}

export interface GoogleCalendarsResponse {
  response: GoogleCalendarInfo[];
  calendarsType?: string;
}

export interface GoogleCalendarListEventsResponse {
  events: GoogleCalendarEvent[];
}

export interface CalendarEvent {
  id?: string; // My DB's UUID
  userId: string;
  googleEventId: string;
  title?: string | null;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  attendees?: object[] | null;
  organizer?: object | null;
  status?: string | null;
  htmlLink?: string | null;
}
