import { Session } from '../middleware/auth';
import { GoogleTokens, GoogleUserInfo } from './user.dto';
import * as userRepo from './user.repository';

// Interface definitions for OAuth flow
interface OAuthState {
  redirect_uri: string;
  state: string;
  created_at: number;
  expires_at: number;
}

interface AuthCodeData {
  user_id: string;
  tokens: GoogleTokens;
  user_info: GoogleUserInfo;
  created_at: number;
  expires_at: number;
}

// Temporary storage for OAuth state and auth codes
// In production, use Redis or a database
const oauthStateStore = new Map<string, OAuthState>();
const authCodeStore = new Map<string, AuthCodeData>();

export class UserService {
  public async findOrCreateUser(
    userInfo: GoogleUserInfo
  ): Promise<userRepo.User> {
    if (!userInfo.email) {
      throw new Error('User email is missing');
    }
    const existingUser = await userRepo.findUserByEmail(userInfo.email);
    if (existingUser) {
      return existingUser;
    }
    return userRepo.createUser(userInfo.email, userInfo.name ?? undefined);
  }

  public async upsertGoogleIntegration(
    userId: string,
    tokens: GoogleTokens
  ): Promise<userRepo.Integration> {
    if (!tokens.access_token) {
      throw new Error('Access token is missing from Google tokens');
    }

    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    return userRepo.upsertIntegration(
      userId,
      'google',
      tokens.access_token,
      tokens.refresh_token ?? null,
      expiresAt
    );
  }

  public async getGoogleIntegration(
    userId: string
  ): Promise<userRepo.Integration | null> {
    return userRepo.getIntegrationByProvider(userId, 'google');
  }

  public async updateLastLogin(userId: string): Promise<void> {
    await userRepo.updateUserLastLogin(userId);
  }

  public async deleteGoogleIntegration(userId: string): Promise<void> {
    await userRepo.deleteIntegration(userId, 'google');
  }
}

export class SessionService {
  public async createSession(
    token: string,
    session: Session,
    expirationSeconds: number
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + expirationSeconds * 1000);
    await userRepo.createSession(token, session.id, session, expiresAt);
  }

  public async getSession(token: string): Promise<Session | null> {
    const storedSession = await userRepo.getSessionById(token);
    return storedSession?.data || null;
  }

  public async updateSession(token: string, session: Session): Promise<void> {
    await userRepo.updateSession(token, session);
  }

  public async deleteSession(token: string): Promise<void> {
    await userRepo.deleteSessionById(token);
  }
}

// OAuth State Storage Functions
export const storeOAuthState = async (
  stateKey: string,
  oauthState: OAuthState
): Promise<void> => {
  oauthStateStore.set(stateKey, oauthState);

  // Set expiration
  setTimeout(
    () => {
      oauthStateStore.delete(stateKey);
    },
    10 * 60 * 1000
  ); // 10 minutes
};

export const getOAuthState = async (
  stateKey: string
): Promise<OAuthState | null> => {
  return oauthStateStore.get(stateKey) || null;
};

export const deleteOAuthState = async (stateKey: string): Promise<void> => {
  oauthStateStore.delete(stateKey);
};

// Auth Code Storage Functions
export const storeAuthCode = async (
  authCode: string,
  authCodeData: AuthCodeData
): Promise<void> => {
  authCodeStore.set(authCode, authCodeData);

  // Set expiration
  setTimeout(
    () => {
      authCodeStore.delete(authCode);
    },
    5 * 60 * 1000
  ); // 5 minutes
};

export const getAuthCode = async (
  authCode: string
): Promise<AuthCodeData | null> => {
  return authCodeStore.get(authCode) || null;
};

export const deleteAuthCode = async (authCode: string): Promise<void> => {
  authCodeStore.delete(authCode);
};
