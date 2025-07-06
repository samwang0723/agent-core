/**
 * Centralized error codes for the API
 * Each error code should be descriptive and unique
 */
export enum ErrorCodes {
  // Authentication Errors
  AUTH_INIT_ERROR = 'AUTH_INIT_ERROR',
  AUTH_CALLBACK_ERROR = 'AUTH_CALLBACK_ERROR',
  INVALID_STATE = 'INVALID_STATE',
  MISSING_CODE = 'MISSING_CODE',
  TOKEN_EXCHANGE_ERROR = 'TOKEN_EXCHANGE_ERROR',
  USER_INFO_ERROR = 'USER_INFO_ERROR',
  SESSION_CREATION_ERROR = 'SESSION_CREATION_ERROR',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  LOGOUT_ERROR = 'LOGOUT_ERROR',
  REFRESH_TOKEN_ERROR = 'REFRESH_TOKEN_ERROR',

  // General API Errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Google API Errors
  GOOGLE_API_ERROR = 'GOOGLE_API_ERROR',
  GOOGLE_TOKEN_ERROR = 'GOOGLE_TOKEN_ERROR',
  GOOGLE_USERINFO_ERROR = 'GOOGLE_USERINFO_ERROR',
}

/**
 * Error messages mapping for consistent messaging
 */
export const ErrorMessages = {
  [ErrorCodes.AUTH_INIT_ERROR]: 'Authentication initialization failed',
  [ErrorCodes.AUTH_CALLBACK_ERROR]: 'Authentication callback processing failed',
  [ErrorCodes.INVALID_STATE]: 'Invalid state parameter - possible CSRF attack',
  [ErrorCodes.MISSING_CODE]: 'Authorization code is missing from callback',
  [ErrorCodes.TOKEN_EXCHANGE_ERROR]:
    'Failed to exchange authorization code for tokens',
  [ErrorCodes.USER_INFO_ERROR]: 'Failed to retrieve user information',
  [ErrorCodes.SESSION_CREATION_ERROR]: 'Failed to create user session',
  [ErrorCodes.AUTH_REQUIRED]: 'Authentication required',
  [ErrorCodes.INVALID_TOKEN]: 'Invalid or expired session token',
  [ErrorCodes.LOGOUT_ERROR]: 'Logout failed',
  [ErrorCodes.REFRESH_TOKEN_ERROR]:
    'Failed to refresh access token. Please log in again.',
  [ErrorCodes.INTERNAL_ERROR]: 'Internal server error',
  [ErrorCodes.NOT_FOUND]: 'Resource not found',
  [ErrorCodes.VALIDATION_ERROR]: 'Validation failed',
  [ErrorCodes.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded',
  [ErrorCodes.GOOGLE_API_ERROR]: 'Google API request failed',
  [ErrorCodes.GOOGLE_TOKEN_ERROR]: 'Google token operation failed',
  [ErrorCodes.GOOGLE_USERINFO_ERROR]:
    'Failed to retrieve user info from Google',
} as const;
