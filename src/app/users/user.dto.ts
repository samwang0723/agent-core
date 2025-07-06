import { Session } from '../middleware/auth';

export interface GoogleUserInfo {
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}

export interface GoogleTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}

export interface StoredSession {
  id: string;
  user_id: string;
  data: Session;
  expires_at: Date;
  created_at: Date;
}
