import { Session } from '../middleware/auth';
import { GoogleTokens, GoogleUserInfo } from './user.dto';
import * as userRepo from './user.repository';
import { createClient, RedisClientType } from 'redis';
import logger from '../utils/logger';

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

// Redis client for OAuth state and auth codes
let redisClient: RedisClientType | null = null;

const initRedis = async (): Promise<RedisClientType> => {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = createClient({ url: redisUrl });
    await redisClient.connect();
  }
  return redisClient;
};

// Fallback in-memory storage for development
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
  try {
    const redis = await initRedis();
    const key = `oauth_state:${stateKey}`;
    await redis.setEx(key, 10 * 60, JSON.stringify(oauthState)); // 10 minutes TTL
  } catch (error) {
    console.error('Redis error, falling back to in-memory store:', error);
    // Fallback to in-memory storage
    oauthStateStore.set(stateKey, oauthState);
    setTimeout(
      () => {
        oauthStateStore.delete(stateKey);
      },
      10 * 60 * 1000
    );
  }
};

export const getOAuthState = async (
  stateKey: string
): Promise<OAuthState | null> => {
  try {
    const redis = await initRedis();
    const key = `oauth_state:${stateKey}`;
    const dataStr = await redis.get(key);
    return dataStr ? (JSON.parse(dataStr) as OAuthState) : null;
  } catch (error) {
    console.error('Redis error, falling back to in-memory store:', error);
    // Fallback to in-memory storage
    return oauthStateStore.get(stateKey) || null;
  }
};

export const deleteOAuthState = async (stateKey: string): Promise<void> => {
  try {
    const redis = await initRedis();
    const key = `oauth_state:${stateKey}`;
    await redis.del(key);
  } catch (error) {
    console.error('Redis error, falling back to in-memory store:', error);
    // Fallback to in-memory storage
    oauthStateStore.delete(stateKey);
  }
};

// Auth Code Storage Functions
export const storeAuthCode = async (
  authCode: string,
  authCodeData: AuthCodeData
): Promise<void> => {
  try {
    const redis = await initRedis();
    const key = `auth_code:${authCode}`;
    await redis.setEx(key, 5 * 60, JSON.stringify(authCodeData)); // 5 minutes TTL
  } catch (error) {
    console.error('Redis error, falling back to in-memory store:', error);
    // Fallback to in-memory storage
    authCodeStore.set(authCode, authCodeData);
    setTimeout(
      () => {
        authCodeStore.delete(authCode);
      },
      5 * 60 * 1000
    );
  }
};

export const getAuthCode = async (
  authCode: string
): Promise<AuthCodeData | null> => {
  try {
    const redis = await initRedis();
    const key = `auth_code:${authCode}`;
    const dataStr = await redis.get(key);

    if (dataStr) {
      const data = JSON.parse(dataStr) as AuthCodeData;
      return data;
    }
    return null;
  } catch (error) {
    console.error('Redis error, falling back to in-memory store:', error);
    // Fallback to in-memory storage
    const data = authCodeStore.get(authCode) || null;
    logger.debug(
      `getAuthCode: ${authCode}, found in memory: ${!!data}, store size: ${authCodeStore.size}`
    );
    if (data) {
      logger.debug(
        `getAuthCode: expires_at: ${data.expires_at}, current: ${Date.now()}, expired: ${Date.now() > data.expires_at}`
      );
    }
    return data;
  }
};

export const deleteAuthCode = async (authCode: string): Promise<void> => {
  try {
    const redis = await initRedis();
    const key = `auth_code:${authCode}`;
    await redis.del(key);
  } catch (error) {
    console.error('Redis error, falling back to in-memory store:', error);
    // Fallback to in-memory storage
    authCodeStore.delete(authCode);
  }
};

// Token response caching to handle duplicate requests
export const storeTokenResponse = async (
  authCode: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokenResponse: any
): Promise<void> => {
  try {
    const redis = await initRedis();
    const key = `token_response:${authCode}`;
    await redis.setEx(key, 60, JSON.stringify(tokenResponse)); // 1 minute TTL
  } catch (error) {
    console.error('Redis error storing token response:', error);
  }
};

export const getTokenResponse = async (
  authCode: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> => {
  try {
    const redis = await initRedis();
    const key = `token_response:${authCode}`;
    const responseStr = await redis.get(key);
    if (responseStr) {
      return JSON.parse(responseStr);
    }
    return null;
  } catch (error) {
    console.error('Redis error getting token response:', error);
    return null;
  }
};
