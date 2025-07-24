import { Hono, Context } from 'hono';
import { google } from 'googleapis';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import {
  storeUserSession,
  removeUserSession,
  Session,
  requireAuth,
  getUserSession,
} from '../middleware/auth';
import { createServerError } from '../utils/api-error';
import { ErrorCodes } from '../utils/error-code';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  UserService,
  storeOAuthState,
  getOAuthState,
  deleteOAuthState,
  storeAuthCode,
  getAuthCode,
  deleteAuthCode,
} from './user.service';
import { importCalendarTask, importGmailTask } from '../jobs/job.service';

type Env = {
  Variables: {
    user: Session;
  };
};

const app = new Hono<Env>();

// Gmail OAuth Configuration
const OAuth2 = google.auth.OAuth2;
const redirectUri =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://localhost:${process.env.PORT || 3000}/api/v1/auth/google/callback`;

const oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);

/**
 * Generate a simple session token (replace with JWT in production)
 */
const generateSessionToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Handle upstream OAuth callback
 */
const handleUpstreamOAuthCallback = async (
  c: Context,
  code: string,
  state: string
) => {
  if (!code || !state) {
    logger.error(
      'Missing required parameters: code and state for upstream OAuth'
    );
    return c.redirect('/?auth=error&reason=missing_parameters');
  }

  // Retrieve the stored OAuth state
  const oauthState = await getOAuthState(state);
  if (!oauthState) {
    logger.error('Invalid or expired OAuth state for upstream OAuth');
    return c.redirect('/?auth=error&reason=invalid_state');
  }

  // Check if state has expired
  if (Date.now() > oauthState.expires_at) {
    await deleteOAuthState(state);
    logger.error('OAuth state has expired for upstream OAuth');
    return c.redirect('/?auth=error&reason=expired_state');
  }

  try {
    // Exchange code for tokens using the existing OAuth2 client
    const { tokens } = await oauth2Client.getToken(code);

    // Get user info
    const callbackOAuth2Client = new OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
    callbackOAuth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      version: 'v2',
      auth: callbackOAuth2Client,
    });
    const userResponse = await oauth2.userinfo.get();
    const userInfo = userResponse.data;

    // Store/update user and integration
    const userService = new UserService();
    const user = await userService.findOrCreateUser({
      email: userInfo.email,
      name: userInfo.name,
    });

    await userService.upsertGoogleIntegration(user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    // Generate a secure authorization code for the upstream app
    const authCode = crypto.randomBytes(32).toString('hex');
    const authCodeData = {
      user_id: user.id,
      tokens,
      user_info: userInfo,
      created_at: Date.now(),
      expires_at: Date.now() + 5 * 60 * 1000, // 5 minutes
    };

    // Store the authorization code
    await storeAuthCode(authCode, authCodeData);

    // Clean up OAuth state
    await deleteOAuthState(state);

    // Redirect to upstream application with authorization code
    const redirectUrl = new URL(oauthState.redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    redirectUrl.searchParams.set('state', oauthState.state);

    logger.info(`Redirecting upstream OAuth to: ${redirectUrl.toString()}`);
    return c.redirect(redirectUrl.toString());
  } catch (error) {
    logger.error('Error in upstream OAuth callback:', error);

    // Redirect to upstream app with error
    const redirectUrl = new URL(oauthState.redirect_uri);
    redirectUrl.searchParams.set('error', 'oauth_callback_failed');
    redirectUrl.searchParams.set('state', oauthState.state);

    return c.redirect(redirectUrl.toString());
  }
};

/**
 * @swagger
 * /api/v1/auth/google:
 *   get:
 *     summary: Initiate Google OAuth authentication
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirect to Google OAuth consent screen
 *       500:
 *         description: Server error
 */
app.get('/google', async c => {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar.events',
  ];

  try {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state: 'gmail-auth', // CSRF protection
      include_granted_scopes: true,
      response_type: 'code',
    });

    logger.info(`Redirecting to Google OAuth: ${authUrl}`);
    return c.redirect(authUrl);
  } catch (error) {
    logger.error('Error generating auth URL:', error);
    throw createServerError(
      ErrorCodes.AUTH_INIT_ERROR,
      undefined,
      error instanceof Error ? error.message : String(error)
    );
  }
});

/**
 * @swagger
 * /api/v1/auth/google/callback:
 *   get:
 *     summary: Handle Google OAuth callback
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from Google
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *         description: State parameter for CSRF protection
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     picture:
 *                       type: string
 *                     sessionId:
 *                       type: string
 *                       description: Auto-created chat session ID
 *       400:
 *         description: Bad request - invalid parameters
 *       500:
 *         description: Server error
 */
app.get('/google/callback', async c => {
  const { code, state } = c.req.query();

  logger.info(`Callback received with: code: ${!!code} state: ${state}`);

  // Check if this is an upstream OAuth flow (state starts with 'oauth_state_')
  const isUpstreamOAuth =
    typeof state === 'string' && state.startsWith('oauth_state_');

  if (isUpstreamOAuth) {
    // Handle upstream OAuth flow
    return handleUpstreamOAuthCallback(c, code as string, state as string);
  } else {
    // Handle direct browser OAuth flow
    if (state !== 'gmail-auth') {
      logger.error('Invalid state parameter');
      return c.redirect('/?auth=error&reason=invalid_state');
    }
  }

  if (!code) {
    logger.error('Authorization code is missing');
    return c.redirect('/?auth=error&reason=missing_code');
  }

  try {
    // Create a new OAuth2 client instance for this request
    const callbackOAuth2Client = new OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    // Exchange code for tokens using the new client instance
    const { tokens } = await callbackOAuth2Client.getToken(code as string);
    logger.info('Tokens received successfully');
    logger.info('Token details:', {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      tokenType: tokens.token_type,
      expiryDate: tokens.expiry_date,
    });

    if (!tokens.refresh_token) {
      logger.warn(
        'Refresh token not received. User may need to re-authenticate for offline access.'
      );
    }

    // Set credentials on the new client instance
    callbackOAuth2Client.setCredentials(tokens);

    // Try to get user info using direct fetch with access token as fallback
    let userInfo: {
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    try {
      // First try with the Google API client
      const oauth2 = google.oauth2({
        version: 'v2',
        auth: callbackOAuth2Client,
      });
      const response = await oauth2.userinfo.get();
      userInfo = {
        id: response.data.id || undefined,
        email: response.data.email || undefined,
        name: response.data.name || undefined,
        picture: response.data.picture || undefined,
      };
      logger.info('User info retrieved via Google API client');
    } catch (apiError) {
      logger.warn('Google API client failed, trying direct fetch:', {
        error: apiError instanceof Error ? apiError.message : String(apiError),
        stack: apiError instanceof Error ? apiError.stack : undefined,
      });

      // Fallback to direct fetch with access token
      if (tokens.access_token) {
        logger.info(
          `Attempting direct fetch with access token: ${tokens.access_token.substring(
            0,
            20
          )}...`
        );

        // Try the userinfo endpoint with Authorization header
        const userInfoResponse = await fetch(
          'https://www.googleapis.com/oauth2/v2/userinfo',
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              Accept: 'application/json',
            },
          }
        );

        logger.info(`Direct fetch response status: ${userInfoResponse.status}`);

        if (!userInfoResponse.ok) {
          const errorText = await userInfoResponse.text();
          logger.error(`Direct fetch error response: ${errorText}`);
          throw createServerError(
            ErrorCodes.GOOGLE_USERINFO_ERROR,
            `Direct fetch failed: ${userInfoResponse.status} ${userInfoResponse.statusText}`,
            { status: userInfoResponse.status, response: errorText }
          );
        }

        userInfo = (await userInfoResponse.json()) as {
          id?: string;
          email?: string;
          name?: string;
          picture?: string;
        };
        logger.info('User info retrieved via direct fetch');
      } else {
        throw createServerError(
          ErrorCodes.GOOGLE_TOKEN_ERROR,
          'No access token available for direct fetch'
        );
      }
    }

    if (!userInfo || !userInfo.email || !userInfo.id) {
      throw createServerError(
        ErrorCodes.GOOGLE_USERINFO_ERROR,
        'Failed to retrieve user info',
        userInfo
      );
    }

    const userService = new UserService();
    const user = await userService.findOrCreateUser({
      email: userInfo.email,
      name: userInfo.name,
    });

    // Store/update the integration with the new tokens
    await userService.upsertGoogleIntegration(user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    // If Google didn't provide a refresh token this time, fetch the existing one from the database
    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      logger.warn(
        'No refresh token from Google, attempting to fetch from database...'
      );
      try {
        const existingIntegration = await userService.getGoogleIntegration(
          user.id
        );
        if (existingIntegration?.refresh_token) {
          refreshToken = existingIntegration.refresh_token;
          logger.info('Successfully retrieved refresh token from database');
        } else {
          logger.warn('No refresh token found in database either');
        }
      } catch (error) {
        logger.error('Failed to fetch refresh token from database:', error);
      }
    }

    const sessionToken = generateSessionToken();
    const sessionId = `sid_${randomUUID()}`;

    // Extract timezone from header
    const timezone = c.req.header('X-Client-Timezone') || 'UTC';

    const session: Session = {
      id: user.id,
      email: user.email,
      name: user.name || '',
      picture: userInfo.picture || '',
      sessionId,
      accessToken: tokens.access_token || undefined,
      refreshToken: refreshToken || undefined,
      tokenExpiryDate: tokens.expiry_date || undefined,
      createdAt: new Date(),
      timezone,
    };

    // Store session
    await storeUserSession(sessionToken, session);

    // Update last login timestamp
    await userService.updateLastLogin(user.id);

    // Set cookie
    setCookie(c, 'auth_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    logger.info(`Session stored for user: ${userInfo.email}`);

    // Start the Gmail import workflow
    if (session.accessToken) {
      await importGmailTask.trigger({
        token: session.accessToken,
        userId: user.id,
      });
      await importCalendarTask.trigger({
        token: session.accessToken,
        userId: user.id,
      });
    }

    // Redirect to a success page or the main app
    return c.redirect(
      `/?auth=success&token_type=bearer&session_id=${sessionId}`
    );
  } catch (error) {
    logger.error('Error in Google OAuth callback:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Redirect to an error page
    return c.redirect('/?auth=error&reason=callback_failed');
  }
});

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Log out the user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully logged out
 *       401:
 *         description: Not authenticated
 */
app.post('/logout', requireAuth, async c => {
  const userSession = c.get('user');
  let token: string | undefined;

  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    token = getCookie(c, 'auth_token');
  }

  if (token) {
    const userService = new UserService();
    await userService.deleteGoogleIntegration(userSession.id);
    await removeUserSession(token);
    deleteCookie(c, 'auth_token', { path: '/' });
  }
  return c.json({ success: true, message: 'Logged out successfully' });
});

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Check authentication status
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserSession'
 *       401:
 *         description: Not authenticated
 */
app.get('/me', requireAuth, async c => {
  // The user session is attached by the requireAuth middleware
  // The 'user' property is available on the context 'c'
  const userSession = c.get('user');

  // Return only non-sensitive user information
  return c.json({
    id: userSession.id,
    email: userSession.email,
    name: userSession.name,
    picture: userSession.picture,
    sessionId: userSession.sessionId,
    createdAt: userSession.createdAt,
  });
});

/**
 * @swagger
 * /api/v1/auth/oauth/initiate:
 *   post:
 *     summary: Initiate OAuth for upstream applications
 *     tags: [OAuth API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               redirect_uri:
 *                 type: string
 *                 description: Upstream application's callback URL
 *               state:
 *                 type: string
 *                 description: State parameter for CSRF protection
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Optional custom scopes
 *             required:
 *               - redirect_uri
 *     responses:
 *       200:
 *         description: OAuth URL generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 auth_url:
 *                   type: string
 *                 state:
 *                   type: string
 *                 expires_at:
 *                   type: string
 *       400:
 *         description: Invalid request
 */
app.post('/oauth/initiate', async c => {
  const body = await c.req.json();
  const { redirect_uri, state, scopes } = body;

  if (!redirect_uri) {
    throw createServerError(
      ErrorCodes.VALIDATION_ERROR,
      'redirect_uri is required'
    );
  }

  // Validate redirect_uri format
  try {
    new URL(redirect_uri);
  } catch {
    throw createServerError(
      ErrorCodes.VALIDATION_ERROR,
      'Invalid redirect_uri format'
    );
  }

  const defaultScopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar',
  ];

  const requestedScopes = scopes || defaultScopes;
  const internalState = state || crypto.randomBytes(16).toString('hex');

  // Store the redirect URI and state for validation during callback
  const oauthState = {
    redirect_uri,
    state: internalState,
    created_at: Date.now(),
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
  };

  // In production, use Redis or database for this
  // For now, we'll use a simple in-memory store
  const stateKey = `oauth_state_${crypto.randomBytes(16).toString('hex')}`;

  // You'll need to implement a temporary state storage
  await storeOAuthState(stateKey, oauthState);

  try {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: requestedScopes,
      state: stateKey, // Use our internal state key
      include_granted_scopes: true,
      response_type: 'code',
    });

    return c.json({
      auth_url: authUrl,
      state: internalState,
      expires_at: new Date(oauthState.expires_at).toISOString(),
    });
  } catch (error) {
    logger.error('Error generating OAuth URL for upstream app:', error);
    throw createServerError(
      ErrorCodes.AUTH_INIT_ERROR,
      undefined,
      error instanceof Error ? error.message : String(error)
    );
  }
});

/**
 * @swagger
 * /api/v1/auth/oauth/token:
 *   post:
 *     summary: Exchange authorization code for access token
 *     tags: [OAuth API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *                 description: Authorization code from callback
 *               grant_type:
 *                 type: string
 *                 enum: [authorization_code, refresh_token]
 *               refresh_token:
 *                 type: string
 *                 description: Required when grant_type is refresh_token
 *             required:
 *               - grant_type
 *     responses:
 *       200:
 *         description: Access token response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token:
 *                   type: string
 *                 token_type:
 *                   type: string
 *                 expires_in:
 *                   type: number
 *                 refresh_token:
 *                   type: string
 *                 user_id:
 *                   type: string
 *                 user_info:
 *                   type: object
 */
app.post('/oauth/token', async c => {
  const body = await c.req.json();
  const { code, grant_type, refresh_token } = body;

  if (!grant_type) {
    throw createServerError(
      ErrorCodes.VALIDATION_ERROR,
      'grant_type is required'
    );
  }

  if (grant_type === 'authorization_code') {
    if (!code) {
      throw createServerError(
        ErrorCodes.VALIDATION_ERROR,
        'code is required for authorization_code grant'
      );
    }

    // Retrieve authorization code data
    const authCodeData = await getAuthCode(code);
    if (!authCodeData) {
      throw createServerError(
        ErrorCodes.INVALID_TOKEN,
        'Invalid or expired authorization code'
      );
    }

    // Check if code has expired
    if (Date.now() > authCodeData.expires_at) {
      await deleteAuthCode(code);
      throw createServerError(
        ErrorCodes.INVALID_TOKEN,
        'Authorization code has expired'
      );
    }

    // Generate session token for the upstream app
    const sessionToken = generateSessionToken();

    // Extract timezone from header
    const timezone = c.req.header('X-Client-Timezone') || 'UTC';

    const session: Session = {
      id: authCodeData.user_id,
      email: authCodeData.user_info.email || '',
      name: authCodeData.user_info.name || '',
      picture: authCodeData.user_info.picture || '',
      sessionId: `sid_${randomUUID()}`,
      accessToken: authCodeData.tokens.access_token || undefined,
      refreshToken: authCodeData.tokens.refresh_token || undefined,
      tokenExpiryDate: authCodeData.tokens.expiry_date || undefined,
      createdAt: new Date(),
      timezone,
    };
    await storeUserSession(sessionToken, session);

    // Sync data with new token in background (don't block the request)
    setImmediate(async () => {
      try {
        if (session.accessToken) {
          await Promise.all([
            importGmailTask.trigger({
              token: session.accessToken,
              userId: session.id,
            }),
            importCalendarTask.trigger({
              token: session.accessToken,
              userId: session.id,
            }),
          ]);
          logger.debug(`Background sync completed for user ${session.id}`);
        }
      } catch (syncError) {
        logger.error(
          `Background sync failed for user ${session.id}:`,
          syncError
        );
      }
    });

    // Clean up authorization code
    await deleteAuthCode(code);

    return c.json({
      access_token: sessionToken,
      token_type: 'Bearer',
      user_id: authCodeData.user_id,
      user_info: {
        email: authCodeData.user_info.email,
        name: authCodeData.user_info.name,
        picture: authCodeData.user_info.picture,
      },
    });
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      throw createServerError(
        ErrorCodes.VALIDATION_ERROR,
        'refresh_token is required for refresh_token grant'
      );
    }

    // Implement refresh token logic
    // This would involve finding the user by refresh token and refreshing their Google tokens
    // For brevity, this is simplified
    throw createServerError(
      ErrorCodes.VALIDATION_ERROR,
      'Refresh token grant not yet implemented'
    );
  } else {
    throw createServerError(
      ErrorCodes.VALIDATION_ERROR,
      'Unsupported grant_type'
    );
  }
});

/**
 * @swagger
 * /api/v1/auth/oauth/validate:
 *   post:
 *     summary: Validate access token
 *     tags: [OAuth API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               access_token:
 *                 type: string
 *             required:
 *               - access_token
 *     responses:
 *       200:
 *         description: Token validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 user_id:
 *                   type: string
 *                 user_info:
 *                   type: object
 *                 expires_at:
 *                   type: string
 */
app.post('/oauth/validate', async c => {
  const body = await c.req.json();
  const { access_token } = body;

  if (!access_token) {
    throw createServerError(
      ErrorCodes.VALIDATION_ERROR,
      'access_token is required'
    );
  }

  try {
    const userSession = await getUserSession(access_token);

    if (!userSession) {
      return c.json({ valid: false });
    }

    // Check if token is expired
    const isExpired = userSession.tokenExpiryDate
      ? Date.now() > userSession.tokenExpiryDate
      : false;

    if (isExpired) {
      return c.json({ valid: false, reason: 'Token expired' });
    }

    return c.json({
      valid: true,
      user_id: userSession.id,
      user_info: {
        email: userSession.email,
        name: userSession.name,
        picture: userSession.picture,
      },
      expires_at: userSession.tokenExpiryDate
        ? new Date(userSession.tokenExpiryDate).toISOString()
        : undefined,
    });
  } catch (error) {
    logger.error('Error validating token:', error);
    return c.json({ valid: false, reason: 'Validation error' });
  }
});

export { app as authRouter };

/**
 * @swagger
 * components:
 *   schemas:
 *     UserSession:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         email:
 *           type: string
 *         name:
 *           type: string
 *         picture:
 *           type: string
 *         sessionId:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */
