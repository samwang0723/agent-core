import { AgentNetwork } from '@mastra/core/network';
import { weatherAgentWithWorkflow } from '../agents/weather';
import { webSearchAgent } from '../agents/websearch';
import { createModelByKey } from '../models/model.service';

export const intentRouter = new AgentNetwork({
  name: 'Intent Router',
  instructions:
    'Route user messages to the correct agent (web search, weather checking).',
  model: createModelByKey('gemini-2.5-flash')!,
  agents: [webSearchAgent, weatherAgentWithWorkflow],
});
