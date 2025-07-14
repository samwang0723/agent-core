import { query } from '../utils/database';
import { CalendarEvent } from './calendar.dto';

export const insertCalendarEvents = async (
  events: Partial<CalendarEvent>[]
): Promise<{ id: string; google_event_id: string }[]> => {
  if (events.length === 0) {
    return [];
  }

  const values = events.map(event => [
    event.userId,
    event.googleEventId,
    event.title,
    event.description,
    event.startTime,
    event.endTime,
    event.location,
    JSON.stringify(event.attendees || null),
    JSON.stringify(event.organizer || null),
    event.status,
    event.htmlLink,
  ]);

  const text = `
    WITH input_rows (user_id, google_event_id, title, description, start_time, end_time, location, attendees, organizer, status, html_link) AS (
      SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::timestamptz[], $7::text[], $8::jsonb[], $9::jsonb[], $10::text[], $11::text[])
    ),
    inserted AS (
        INSERT INTO calendar_events (user_id, google_event_id, title, description, start_time, end_time, location, attendees, organizer, status, html_link)
        SELECT * FROM input_rows
        ON CONFLICT (user_id, google_event_id, start_time) DO UPDATE
        SET title = EXCLUDED.title,
            description = EXCLUDED.description,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            location = EXCLUDED.location,
            attendees = EXCLUDED.attendees,
            organizer = EXCLUDED.organizer,
            status = EXCLUDED.status,
            html_link = EXCLUDED.html_link
        RETURNING id, google_event_id
    )
    SELECT id, google_event_id FROM inserted
    UNION ALL
    SELECT ce.id, ce.google_event_id FROM calendar_events ce
    JOIN input_rows i ON ce.user_id = i.user_id AND ce.google_event_id = i.google_event_id AND ce.start_time = i.start_time;
  `;

  const formattedValues = values[0].map((_, colIndex) =>
    values.map(row => row[colIndex])
  );

  const result = await query(text, formattedValues);
  return result.rows as { id: string; google_event_id: string }[];
};

export const getCalendarEventsByTimeRange = async (
  userId: string,
  userEmail: string,
  fromTime: string,
  toTime: string,
  limit: number = 10
): Promise<
  { title: string; description: string; start_time: string; end_time: string }[]
> => {
  const text = `
    SELECT 
      title,
      description,
      start_time,
      end_time
    FROM calendar_events 
    WHERE user_id = $1 
      AND start_time >= $2::timestamptz 
      AND end_time <= $3::timestamptz
      AND attendees IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 
        FROM jsonb_array_elements(attendees) as attendee
        WHERE attendee->>'email' = $4 
          AND attendee->>'responseStatus' = 'declined'
      )
    ORDER BY start_time ASC
    LIMIT $5
  `;

  const result = await query(text, [
    userId,
    fromTime,
    toTime,
    userEmail,
    limit,
  ]);
  return result.rows as {
    title: string;
    description: string;
    start_time: string;
    end_time: string;
  }[];
};
