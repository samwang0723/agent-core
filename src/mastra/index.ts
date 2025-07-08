import { Mastra } from '@mastra/core';
import {
  weatherAgent,
  webSearchAgent,
  gcalendarAgent,
  gmailAgent,
  confluenceAgent,
  jiraAgent,
  restaurantAgent,
} from './agents/index';
import { weatherWorkflowWithSuspend } from './workflows/weather';
import logger from './utils/logger';
import { orchestratorNetwork } from './network/orchestrator';

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
  agents: {
    weatherAgent,
    webSearchAgent,
    gcalendarAgent,
    gmailAgent,
    confluenceAgent,
    jiraAgent,
    restaurantAgent,
  },
  workflows: { weatherWorkflowWithSuspend },
  vnext_networks: {
    'orchestrator-network': orchestratorNetwork,
  },
});
