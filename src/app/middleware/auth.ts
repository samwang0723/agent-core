import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import logger from '../utils/logger';
import { google } from 'googleapis';
import { createAuthError } from '../utils/api-error';
import { ErrorCodes } from '../utils/error-code';
import { SessionService } from '../users/user.service';
import { UserService } from '../users/user.service';
import { toolRegistry } from '../../mastra/tools/registry';
import { importCalendarTask, importGmailTask } from '../jobs/job.service';

export interface Session {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  sessionId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiryDate?: number;
  createdAt: Date;
  timezone?: string;
}

const sessionService = new SessionService();
const SESSION_EXPIRATION_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Store user session
 */
export const storeUserSession = async (
  token: string,
  user: Session
): Promise<void> => {
  await sessionService.createSession(
    token,
    { ...user, createdAt: new Date() },
    SESSION_EXPIRATION_SECONDS
  );
};

/**
 * Get user session
 */
export const getUserSession = async (
  token: string
): Promise<Session | null> => {
  return sessionService.getSession(token);
};

/**
 * Remove user session
 */
export const removeUserSession = async (token: string): Promise<void> => {
  await sessionService.deleteSession(token);
};

/**
 * Checks if the access token is expired and refreshes it if needed.
 * @param token The session token.
 * @param userSession The user session object.
 */
export const refreshAccessTokenIfNeeded = async (
  token: string,
  userSession: Session
): Promise<void> => {
  // Check if access token exists and if it's expired
  const hasAccessToken = !!userSession.accessToken;
  const isTokenExpired = userSession.tokenExpiryDate
    ? Date.now() > userSession.tokenExpiryDate - 5 * 60 * 1000 // 5-minute buffer
    : !hasAccessToken; // If no expiry date but has token, assume valid; if no token, assume expired

  logger.debug(
    `Token refresh check - hasAccessToken: ${hasAccessToken}, isTokenExpired: ${isTokenExpired}, expiryDate: ${userSession.tokenExpiryDate ? new Date(userSession.tokenExpiryDate).toISOString() : 'none'}`
  );

  if (!isTokenExpired) {
    toolRegistry.setAccessTokenForAll(userSession.accessToken!);
    logger.debug(
      `[${userSession.id}] Tool: Access token not expired: ${userSession.accessToken}`
    );
    return;
  }

  logger.info(
    `Access token expired or missing, attempting refresh for user ${userSession.id}`
  );

  let refreshToken = userSession.refreshToken;

  // If no refresh token in session, try to get it from the database
  if (!refreshToken) {
    logger.warn(
      'No refresh token in session, attempting to fetch from database...'
    );
    try {
      const userService = new UserService();
      const integration = await userService.getGoogleIntegration(
        userSession.id
      );
      if (integration?.refresh_token) {
        refreshToken = integration.refresh_token;
        logger.info('Successfully retrieved refresh token from database');

        // Update the session with the refresh token for future use
        userSession.refreshToken = refreshToken;
        await sessionService.updateSession(token, userSession);
      }
    } catch (error) {
      logger.error('Failed to fetch refresh token from database:', error);
    }
  }

  if (!refreshToken) {
    logger.error(
      `Access token expired, but no refresh token available in session or database for user ${userSession.id}`
    );
    await removeUserSession(token);
    throw createAuthError(
      ErrorCodes.REFRESH_TOKEN_ERROR,
      'Session expired, please log in again.'
    );
  }

  try {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({
      refresh_token: refreshToken,
    });

    logger.info(
      `Attempting to refresh access token for user ${userSession.id}...`
    );
    const { credentials } = await client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error('No access token returned from refresh request');
    }

    logger.info(
      `Access token refreshed successfully for user ${userSession.id}`
    );

    // Update session with new token info
    userSession.accessToken = credentials.access_token;
    userSession.tokenExpiryDate =
      typeof credentials.expiry_date === 'number'
        ? credentials.expiry_date
        : Date.now() + 60 * 60 * 1000; // Default to 1 hour if no expiry provided

    // Update refresh token if a new one was provided
    if (credentials.refresh_token) {
      userSession.refreshToken = credentials.refresh_token;
    }

    // The session key (token) remains the same, but the session data is updated.
    await sessionService.updateSession(token, userSession);
    logger.debug(
      `Session updated with new access token for user ${userSession.id}`
    );

    // Update agent factory with new access token
    toolRegistry.setAccessTokenForAll(userSession.accessToken);
    logger.debug(
      `[${userSession.id}] Tool: Access token updated: ${userSession.accessToken}`
    );
    // Sync data with new token in background (don't block the request)
    setImmediate(async () => {
      try {
        await Promise.all([
          importGmailTask.trigger({
            token: userSession.accessToken!,
            userId: userSession.id,
          }),
          importCalendarTask.trigger({
            token: userSession.accessToken!,
            userId: userSession.id,
          }),
        ]);
        logger.debug(`Background sync completed for user ${userSession.id}`);
      } catch (syncError) {
        logger.error(
          `Background sync failed for user ${userSession.id}:`,
          syncError
        );
      }
    });
  } catch (error) {
    logger.error(
      `Failed to refresh access token for user ${userSession.id}:`,
      error
    );
    // If refresh fails, the user needs to re-authenticate.
    await removeUserSession(token);
    throw createAuthError(
      ErrorCodes.REFRESH_TOKEN_ERROR,
      'Session expired, please log in again.'
    );
  }
};

/**
 * Authentication middleware for Hono
 */
export const requireAuth = async (c: Context, next: Next): Promise<void> => {
  let token: string | undefined;
  let tokenSource: 'header' | 'cookie' | 'none' = 'none';

  // Extract token from Authorization header or cookie
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
    tokenSource = 'header';
  } else {
    token = getCookie(c, 'auth_token');
    if (token) {
      tokenSource = 'cookie';
    }
  }

  logger.debug(
    `Auth check - token source: ${tokenSource}, token present: ${!!token}`
  );

  if (!token) {
    logger.warn('Authentication required: No token provided');
    throw createAuthError(ErrorCodes.AUTH_REQUIRED);
  }

  let userSession: Session | null;
  try {
    userSession = await getUserSession(token);
  } catch (error) {
    logger.error('Failed to retrieve user session:', error);
    throw createAuthError(ErrorCodes.INVALID_TOKEN);
  }

  if (!userSession) {
    logger.warn(
      `Invalid token: Session not found for token from ${tokenSource}`
    );
    throw createAuthError(ErrorCodes.INVALID_TOKEN);
  }

  logger.debug(
    `User session found for ${userSession.email} (${userSession.id})`
  );

  try {
    // Refresh access token if needed (this will update the session if refreshed)
    await refreshAccessTokenIfNeeded(token, userSession);

    // Get the potentially updated session after refresh
    const updatedSession = await getUserSession(token);
    if (!updatedSession) {
      logger.error('Session was removed during token refresh');
      throw createAuthError(ErrorCodes.INVALID_TOKEN);
    }

    c.set('user', updatedSession);
    logger.debug(`Authentication successful for user ${updatedSession.email}`);
  } catch (error) {
    logger.error(`Token refresh failed for user ${userSession.email}:`, error);

    // If it's already an auth error, just re-throw it
    if (error && typeof error === 'object' && 'code' in error) {
      throw error;
    }

    // Otherwise, wrap it in a generic auth error
    throw createAuthError(
      ErrorCodes.REFRESH_TOKEN_ERROR,
      'Authentication failed, please log in again.'
    );
  }

  await next();
};

/**
 * Optional authentication middleware for Hono
 */
export const optionalAuth = async (c: Context, next: Next): Promise<void> => {
  try {
    let token: string | undefined;

    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = getCookie(c, 'auth_token');
    }

    if (token) {
      const userSession = await getUserSession(token);
      if (userSession) {
        c.set('user', userSession);
      }
    }
  } catch (error) {
    logger.error('Optional authentication middleware error:', error);
  }
  await next();
};
