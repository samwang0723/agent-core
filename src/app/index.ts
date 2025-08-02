import { Hono } from 'hono';
import { cors } from 'hono/cors';
// import { serveStatic } from 'hono/bun';
import { apiRouter } from './api/routes';
import logger from './utils/logger';
import { ApiError } from './utils/api-error';
import { ErrorCodes } from './utils/error-code';
import { ContentfulStatusCode } from 'hono/utils/http-status';

const app = new Hono();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Middleware
// Add cookie parser middleware - Hono has built-in cookie helpers, no middleware needed.
// For serving a simple web interface
// app.use('/*', serveStatic({ root: './public' }));
// app.use('/favicon.ico', serveStatic({ path: './public/favicon.ico' }));

// CORS middleware
app.use(
  '/api/*',
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
      : '*',
    allowHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Client-Timezone',
      'X-Client-Datetime',
      'X-Locale',
      'Accept-Language',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true,
    maxAge: 86400,
  })
);

// Mount API routes
app.route('/api/v1', apiRouter);

// 404 handler
app.notFound(c => {
  return c.json(
    {
      error: 'Route not found',
      code: ErrorCodes.NOT_FOUND,
      details: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404
  );
});

// Error handling middleware
app.onError((err, c) => {
  logger.error('Error caught by error handler:', {
    error: err.message,
    // stack: err.stack,
    url: c.req.path,
    method: c.req.method,
  });

  if (err instanceof ApiError) {
    return c.json(err.toJSON(), err.statusCode as ContentfulStatusCode);
  }

  // Handle specific known error types
  if (err.name === 'ValidationError') {
    return c.json(
      {
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_ERROR,
        details: err.message,
      },
      400
    );
  }

  // Default fallback for unhandled errors
  const isDevelopment = process.env.NODE_ENV === 'development';
  return c.json(
    {
      error: 'Internal server error',
      code: ErrorCodes.INTERNAL_ERROR,
      ...(isDevelopment && {
        details: {
          message: err.message,
          stack: err.stack,
        },
      }),
    },
    500
  );
});

logger.info(`🚀 Agent Core API Server running on http://localhost:${PORT}`);
logger.info(`🔐 Authentication: http://localhost:${PORT}/api/v1/auth/google`);

export default {
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 60,
};
