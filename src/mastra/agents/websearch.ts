import { Agent } from '@mastra/core/agent';
import { toolRegistry } from '../tools/registry';
import { mastraMemoryService } from '../memory/memory.service';
import { createModelByKey } from '../models/model.service';

export const webSearchAgent = new Agent({
  name: 'Web Search Agent',
  instructions: `You are a professional web search assistant powered by Brave. Search the web for the most relevant information.`,
  model: createModelByKey('gemini-2.5-flash')!,
  tools: {
    webSearchTool: toolRegistry.getServerTool(
      'web-search',
      'brave_web_search'
    )!,
  },
  memory: mastraMemoryService.getMemory(),
});
