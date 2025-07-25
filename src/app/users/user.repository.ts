import { query } from '../utils/database';
import { StoredSession } from './user.dto';
import { Session } from '../middleware/auth';

export interface User {
  id: string; // uuid
  email: string;
  name?: string;
  created_at: Date;
  last_login_at?: Date;
}

export interface Integration {
  id: string; // uuid
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
}

export const createSession = async (
  id: string,
  userId: string,
  data: Session,
  expiresAt: Date
): Promise<StoredSession> => {
  const result = await query<StoredSession>(
    'INSERT INTO sessions (id, user_id, data, expires_at, timezone, locale) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [
      id,
      userId,
      JSON.stringify(data),
      expiresAt,
      data.timezone || null,
      data.locale || null,
    ]
  );
  return result.rows[0];
};

export const getSessionById = async (
  id: string
): Promise<StoredSession | null> => {
  const result = await query<StoredSession>(
    'SELECT * FROM sessions WHERE id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [id]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
};

export const getSessionByUserId = async (
  userId: string
): Promise<StoredSession | null> => {
  const result = await query<StoredSession>(
    'SELECT * FROM sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
};

export const deleteSessionById = async (id: string): Promise<void> => {
  await query('DELETE FROM sessions WHERE id = $1', [id]);
};

export const updateSession = async (
  id: string,
  data: Session
): Promise<StoredSession | null> => {
  const result = await query<StoredSession>(
    'UPDATE sessions SET data = $1, timezone = $2, locale = $3 WHERE id = $4 RETURNING *',
    [JSON.stringify(data), data.timezone || null, data.locale || null, id]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
};

export const deleteExpiredSessions = async (): Promise<void> => {
  await query('DELETE FROM sessions WHERE expires_at <= NOW()');
};

export const findUserByEmail = async (
  email: string
): Promise<User | undefined> => {
  const { rows } = await query<User>('SELECT * FROM users WHERE email = $1', [
    email,
  ]);
  return rows[0];
};

export const createUser = async (
  email: string,
  name?: string
): Promise<User> => {
  const { rows } = await query<User>(
    'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING *',
    [email, name]
  );
  return rows[0];
};

export const upsertIntegration = async (
  userId: string,
  provider: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null
): Promise<Integration> => {
  const text = `
    INSERT INTO integrations (user_id, provider, access_token, refresh_token, expires_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, provider)
    DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, integrations.refresh_token),
      expires_at = EXCLUDED.expires_at
    RETURNING *;
  `;
  const values = [userId, provider, accessToken, refreshToken, expiresAt];
  const { rows } = await query<Integration>(text, values);
  return rows[0];
};

export const getIntegrationByProvider = async (
  userId: string,
  provider: string
): Promise<Integration | null> => {
  const result = await query<Integration>(
    'SELECT * FROM integrations WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
};

export const updateUserLastLogin = async (userId: string): Promise<User> => {
  const { rows } = await query<User>(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING *',
    [userId]
  );
  if (rows.length === 0) {
    throw new Error(`User with ID ${userId} not found`);
  }
  return rows[0];
};

export const deleteIntegration = async (
  userId: string,
  provider: string
): Promise<void> => {
  await query('DELETE FROM integrations WHERE user_id = $1 AND provider = $2', [
    userId,
    provider,
  ]);
};

export const getActiveUsersWithGoogleIntegration = async (): Promise<
  Array<{
    user_id: string;
    access_token: string;
    refresh_token?: string;
    locale?: string;
  }>
> => {
  const result = await query<{
    user_id: string;
    access_token: string;
    refresh_token?: string;
    locale?: string;
  }>(
    `SELECT user_id, access_token, refresh_token, locale 
     FROM integrations 
     WHERE provider = 'google' 
     AND access_token IS NOT NULL 
     AND (expires_at IS NULL OR expires_at > NOW())`,
    []
  );
  return result.rows;
};
