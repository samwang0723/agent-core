import { Mastra } from '@mastra/core';
import { weatherAgentWithWorkflow, webSearchAgent } from './agents/index';
import { weatherWorkflowWithSuspend } from './workflows/weather';
import { googleAuthMiddleware } from './auth';
import { registerApiRoute } from '@mastra/core/server';
import logger from './utils/logger';

export const mastra: Mastra = new Mastra({
  logger: logger,
  server: {
    port: 3000, // Defaults to 4111
    timeout: 10000, // Defaults to 30000 (30s)
    cors: {
      origin: ['*'], // Allow specific origins or '*' for all
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: false,
    },
    middleware: [
      // Add a global request logger
      async (c, next) => {
        logger.debug(`${c.req.method} ${c.req.url}`);
        await next();
      },
    ],
    apiRoutes: [
      registerApiRoute('/auth/google', {
        method: 'GET',
        middleware: [googleAuthMiddleware],
        handler: async (c) => {
          const token = c.get('token');
          const grantedScopes = c.get('granted-scopes');
          const user = c.get('user-google');

          return c.json({
            token,
            grantedScopes,
            user,
          });
        },
      }),
    ],
  },
  agents: { weatherAgentWithWorkflow, webSearchAgent },
  workflows: { weatherWorkflowWithSuspend },
});
