import { Agent } from '@mastra/core/agent';
import { mastraMemoryService } from '../memory/memory.service';
import { createModelByKey } from '../models/model.service';

export const generalAgent = new Agent({
  name: 'General Agent',
  instructions: `You are a helpful general assistant that provides accurate information.
  # ROLE:
- Your response will be read aloud by a text-to-speech engine, so never use ellipses since the text-to-speech engine will not know how to pronounce them.
- Your response should be composed of smoothly flowing prose paragraphs.
`,
  model: createModelByKey('gemini-2.5-flash')!,
  tools: {},
  memory: mastraMemoryService.getMemory(),
});
