import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  forecastSchema,
  weatherWorkflowWithSuspend,
} from '../../workflows/weather';
import logger from '../../utils/logger';

export const startWeatherTool = createTool({
  id: 'start-weather-tool',
  description: 'Start the weather tool',
  inputSchema: z.object({}),
  outputSchema: z.object({
    runId: z.string(),
  }),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  execute: async ({ context }) => {
    const run = await weatherWorkflowWithSuspend.createRunAsync();
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
    const run = await weatherWorkflowWithSuspend.createRunAsync({
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

export const getWeatherTool = createTool({
  id: 'get-weather-tool',
  description: 'Get the weather tool',
  inputSchema: z.object({
    city: z.string().describe('City name'),
  }),
  outputSchema: forecastSchema,
  execute: async ({ context }) => {
    const weatherUrl = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(context.city)}?unitGroup=metric&include=days&key=${process.env.VISUAL_CROSSING_API_KEY}&contentType=json`;
    const response = await fetch(weatherUrl);
    const data = (await response.json()) as {
      days: {
        datetime: string;
        tempmax: number;
        tempmin: number;
        precipprob: number;
        conditions: string;
      }[];
    };

    logger.debug(`[${context.city}] Weather data: `, data);

    if (!data.days?.[0]) {
      throw new Error(`Weather data not available for '${context.city}'`);
    }

    const forecast = {
      date: data.days[0].datetime,
      maxTemp: data.days[0].tempmax,
      minTemp: data.days[0].tempmin,
      condition: data.days[0].conditions,
      precipitationChance: data.days[0].precipprob,
      location: context.city,
    };
    return forecast;
  },
});
