import { CompositeIntentDetector } from './methods/composite';
import { KeywordIntentDetector } from './methods/keyword';
import { PatternIntentDetector } from './methods/pattern';
import { IToolIntentDetector, ToolIntentResult } from './intent.dto';
import { Agent } from '@mastra/core';
import {
  gmailAgent,
  gcalendarAgent,
  confluenceAgent,
  jiraAgent,
  webSearchAgent,
  weatherAgentWithWorkflow,
  restaurantAgent,
} from '../../mastra/agents/index';

// Create a singleton intent detector instance using composite pattern for best accuracy
const createIntentDetector = (): IToolIntentDetector => {
  const keywordDetector = new KeywordIntentDetector();
  const patternDetector = new PatternIntentDetector();

  // Use composite detector with weighted scoring
  // Pattern detector gets higher weight (0.7) as it's more sophisticated
  return new CompositeIntentDetector(
    [patternDetector, keywordDetector],
    [0.7, 0.3]
  );
};

// Global intent detector instance
const intentDetector = createIntentDetector();

// Optimized intent detection with caching
export async function optimizedIntentDetection(
  message: string
): Promise<ToolIntentResult> {
  const result = await intentDetector.detectToolIntent(message);
  let suitableAgent: Agent | undefined;

  if (result.requiresTools && result.detectedTools?.[0]) {
    switch (result.detectedTools?.[0]) {
      case 'weather':
        suitableAgent = weatherAgentWithWorkflow;
        break;
      case 'websearch':
        suitableAgent = webSearchAgent;
        break;
      case 'email':
        suitableAgent = gmailAgent;
        break;
      case 'calendar':
        suitableAgent = gcalendarAgent;
        break;
      case 'confluence':
        suitableAgent = confluenceAgent;
        break;
      case 'jira':
        suitableAgent = jiraAgent;
        break;
      case 'restaurant':
        suitableAgent = restaurantAgent;
        break;
      default:
        suitableAgent = undefined;
    }
  }

  return { ...result, suitableAgent };
}
