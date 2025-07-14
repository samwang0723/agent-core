import { query } from '../utils/database';
import { GmailMessage } from './email.dto';

export const insertEmails = async (
  emails: Partial<GmailMessage>[]
): Promise<{ id: string; message_id: string }[]> => {
  if (emails.length === 0) {
    return [];
  }

  const values = emails.map(email => [
    email.userId,
    email.messageId,
    email.threadId,
    email.subject,
    email.body,
    email.receivedTime,
    email.isUnread,
    email.importance,
    email.fromAddress,
  ]);

  const text = `
    WITH input_rows (user_id, message_id, thread_id, subject, body, received_time, is_unread, importance, from_address) AS (
      SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::bool[], $8::bool[], $9::text[])
    ),
    inserted AS (
        INSERT INTO emails (user_id, message_id, thread_id, subject, body, received_time, is_unread, importance, from_address)
        SELECT * FROM input_rows
        ON CONFLICT (user_id, message_id) DO NOTHING
        RETURNING id, message_id
    )
    SELECT id, message_id FROM inserted
    UNION ALL
    SELECT e.id, e.message_id FROM emails e
    JOIN input_rows i ON e.user_id = i.user_id AND e.message_id = i.message_id;
  `;

  // pg-node does not support array of arrays directly, need to format it.
  const formattedValues = values[0].map((_, colIndex) =>
    values.map(row => row[colIndex])
  );

  const result = await query(text, formattedValues);
  return result.rows as { id: string; message_id: string }[];
};
