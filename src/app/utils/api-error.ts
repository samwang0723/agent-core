import { ErrorCodes, ErrorMessages } from './error-code';

/**
 * Custom API Error class for consistent error handling
 */
export class ApiError<T = unknown> extends Error {
  public readonly statusCode: number;
  public readonly errorCode: ErrorCodes;
  public readonly details?: T;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    errorCode: ErrorCodes,
    message?: string,
    details?: T,
    isOperational = true
  ) {
    // Use predefined message if not provided
    const errorMessage = message || ErrorMessages[errorCode];
    super(errorMessage);

    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Convert error to JSON format for API responses
   */
  toJSON() {
    return {
      error: this.message,
      code: this.errorCode,
      ...(this.details && { details: this.details }),
    };
  }
}

/**
 * Factory functions for common error types
 */
export class AuthError<T = unknown> extends ApiError<T> {
  constructor(errorCode: ErrorCodes, message?: string, details?: T) {
    super(401, errorCode, message, details);
  }
}

export class ValidationError<T = unknown> extends ApiError<T> {
  constructor(message?: string, details?: T) {
    super(400, ErrorCodes.VALIDATION_ERROR, message, details);
  }
}

export class NotFoundError<T = unknown> extends ApiError<T> {
  constructor(message?: string, details?: T) {
    super(404, ErrorCodes.NOT_FOUND, message, details);
  }
}

export class InternalError<T = unknown> extends ApiError<T> {
  constructor(message?: string, details?: T) {
    super(500, ErrorCodes.INTERNAL_ERROR, message, details);
  }
}

/**
 * Helper function to create authentication errors
 */
export const createAuthError = <T = unknown>(
  errorCode: ErrorCodes,
  message?: string,
  details?: T
): AuthError<T> => {
  return new AuthError(errorCode, message, details);
};

/**
 * Helper function to create server errors
 */
export const createServerError = <T = unknown>(
  errorCode: ErrorCodes,
  message?: string,
  details?: T
): ApiError<T> => {
  return new ApiError(500, errorCode, message, details);
};
