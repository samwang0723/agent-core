import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createWorkflow, createStep } from '@mastra/core/workflows';

const forecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
  location: z.string()
});
function getWeatherCondition(code) {
  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    95: "Thunderstorm"
  };
  return conditions[code] || "Unknown";
}
const fetchWeatherWithSuspend = createStep({
  id: "fetch-weather",
  description: "Fetches weather forecast for a given city",
  inputSchema: z.object({}),
  resumeSchema: z.object({
    city: z.string().describe("The city to get the weather for")
  }),
  outputSchema: forecastSchema,
  execute: async ({ resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({
        message: "Please enter the city to get the weather for"
      });
    }
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      resumeData.city
    )}&count=1`;
    const geocodingResponse = await fetch(geocodingUrl);
    const geocodingData = await geocodingResponse.json();
    if (!geocodingData.results?.[0]) {
      throw new Error(`Location '${resumeData.city}' not found`);
    }
    const { latitude, longitude} = geocodingData.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=precipitation,weathercode&timezone=auto,&hourly=precipitation_probability,temperature_2m`;
    const response = await fetch(weatherUrl);
    const data = await response.json();
    const forecast = {
      date: (/* @__PURE__ */ new Date()).toISOString(),
      maxTemp: Math.max(...data.hourly.temperature_2m),
      minTemp: Math.min(...data.hourly.temperature_2m),
      condition: getWeatherCondition(data.current.weathercode),
      precipitationChance: data.hourly.precipitation_probability.reduce(
        (acc, curr) => Math.max(acc, curr),
        0
      ),
      location: resumeData.city
    };
    return forecast;
  }
});
const weatherWorkflowWithSuspend = createWorkflow({
  id: "weather-workflow-with-suspend",
  inputSchema: z.object({}),
  outputSchema: forecastSchema
}).then(fetchWeatherWithSuspend).commit();

const startWeatherTool = createTool({
  id: "start-weather-tool",
  description: "Start the weather tool",
  inputSchema: z.object({}),
  outputSchema: z.object({
    runId: z.string()
  }),
  execute: async ({ context }) => {
    const run = await weatherWorkflowWithSuspend.createRunAsync();
    await run.start({
      inputData: {}
    });
    return {
      runId: run.runId
    };
  }
});
const resumeWeatherTool = createTool({
  id: "resume-weather-tool",
  description: "Resume the weather tool",
  inputSchema: z.object({
    runId: z.string(),
    city: z.string().describe("City name")
  }),
  outputSchema: forecastSchema,
  execute: async ({ context }) => {
    const run = await weatherWorkflowWithSuspend.createRunAsync({
      runId: context.runId
    });
    const result = await run.resume({
      step: "fetch-weather",
      resumeData: {
        city: context.city
      }
    });
    switch (result.status) {
      case "success":
        return result.result;
      case "failed":
        throw result.error;
      default:
        throw new Error(`Unexpected workflow status: ${result.status}`);
    }
  }
});

export { resumeWeatherTool as r, startWeatherTool as s, weatherWorkflowWithSuspend as w };
//# sourceMappingURL=weather.mjs.map
