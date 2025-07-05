import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { mastra } from '../..';
import { forecastSchema } from '../../workflows/weather';

export const startWeatherTool = createTool({
  id: 'start-weather-tool',
  description: 'Start the weather tool',
  inputSchema: z.object({}),
  outputSchema: z.object({
    runId: z.string(),
  }),
  execute: async ({ context }) => {
    const workflow = mastra.getWorkflow('weatherWorkflowWithSuspend');
    const run = await workflow.createRunAsync();
    await run.start({
      inputData: {},
    });

    return {
      runId: run.runId,
    };
  },
});

export const resumeWeatherTool = createTool({
  id: 'resume-weather-tool',
  description: 'Resume the weather tool',
  inputSchema: z.object({
    runId: z.string(),
    city: z.string().describe('City name'),
  }),
  outputSchema: forecastSchema,
  execute: async ({ context }) => {
    const workflow = mastra.getWorkflow('weatherWorkflowWithSuspend');
    const run = await workflow.createRunAsync({
      runId: context.runId,
    });
    const result = await run.resume({
      step: 'fetch-weather',
      resumeData: {
        city: context.city,
      },
    });
    switch (result.status) {
      case 'success':
        return result.result as z.infer<typeof forecastSchema>;
      case 'failed':
        throw result.error;
      default:
        throw new Error(`Unexpected workflow status: ${result.status}`);
    }
  },
});
