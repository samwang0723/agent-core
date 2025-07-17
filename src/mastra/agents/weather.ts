import { Agent } from '@mastra/core/agent';
import { toolRegistry } from '../tools/registry';
import { mastraMemoryService } from '../memory/memory.service';
import { createModelByKey } from '../models/model.service';

export const weatherAgent = new Agent({
  name: 'Weather Agent',
  instructions: `You are a helpful weather assistant that provides weather forecast information.
- ALWAYS respond with Language locale users want. DO NOT REJECT USER'S LANGUAGE. Pass language requirements to all agents.
Your primary function is to help users get weather details for specific locations. When responding:
- Always ask for a location if none is provided
- If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
- Include relevant details like humidity, wind conditions, and precipitation
- Keep responses concise but informative, 15 days weather forecast is enough.
- Using Celsius for temperature.
 
The result will be the 15 days weather forecast for the city. Please also suggest how should the user dress up based on the weather forecast.`,
  model: createModelByKey('gemini-2.0-flash')!,
  tools: {
    getWeatherTool: toolRegistry.getTool('get-weather-tool')!,
  },
  memory: mastraMemoryService.getMemory(),
});
