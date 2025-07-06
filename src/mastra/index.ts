import { Mastra } from '@mastra/core';
import { weatherAgentWithWorkflow, webSearchAgent } from './agents/index';
import { weatherWorkflowWithSuspend } from './workflows/weather';
import logger from './utils/logger';
import { intentRouter } from './network/intent';

export const mastra: Mastra = new Mastra({
  logger: logger,
  server: {
    port: 4111, // Defaults to 4111
    timeout: 30000, // Defaults to 30000 (30s)
    cors: {
      origin: ['*'], // Allow specific origins or '*' for all
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-Client-Timezone',
        'X-Client-Datetime',
      ],
      credentials: true,
      maxAge: 86400,
    },
  },
  agents: { weatherAgentWithWorkflow, webSearchAgent },
  workflows: { weatherWorkflowWithSuspend },
  networks: { intentRouter },
});
