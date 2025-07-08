import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export const forecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
  location: z.string(),
});

export const fetchWeatherWithSuspend = createStep({
  id: 'fetch-weather',
  description:
    'Fetches weather forecast for a given city using Visual Crossing API',
  inputSchema: z.object({}),
  resumeSchema: z.object({
    city: z.string().describe('The city to get the weather for'),
  }),
  outputSchema: forecastSchema,
  execute: async ({ resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({
        message: 'Please enter the city to get the weather for',
      });
    }

    if (!process.env.VISUAL_CROSSING_API_KEY) {
      throw new Error(
        'VISUAL_CROSSING_API_KEY environment variable is required'
      );
    }

    const weatherUrl = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(resumeData.city)}?unitGroup=metric&include=days&key=${process.env.VISUAL_CROSSING_API_KEY}&contentType=json`;
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

    if (!data.days?.[0]) {
      throw new Error(`Weather data not available for '${resumeData.city}'`);
    }

    const forecast = {
      date: data.days[0].datetime,
      maxTemp: data.days[0].tempmax,
      minTemp: data.days[0].tempmin,
      condition: data.days[0].conditions,
      precipitationChance: data.days[0].precipprob,
      location: resumeData.city,
    };

    return forecast;
  },
});

export const weatherWorkflowWithSuspend = createWorkflow({
  id: 'weather-workflow-with-suspend',
  inputSchema: z.object({}),
  outputSchema: forecastSchema,
})
  .then(fetchWeatherWithSuspend)
  .commit();
