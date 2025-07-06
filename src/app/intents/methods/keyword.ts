import logger from '../../utils/logger';
import { IToolIntentDetector, ToolIntentResult } from '../intent.dto';

/**
 * Keyword-based implementation of tool intent detection.
 * Uses predefined keyword patterns to detect when external tools are required.
 */
export class KeywordIntentDetector implements IToolIntentDetector {
  private readonly toolKeywords: Record<string, string[]> = {
    email: [
      'send email',
      'check inbox',
      'compose message',
      'email',
      'send message',
      'check mail',
      'write email',
      'reply to email',
      'forward email',
      'delete email',
      'read email',
      'inbox',
      'outbox',
      'draft',
      'compose',
      'mail',
    ],
    calendar: [
      'schedule meeting',
      'book appointment',
      'check calendar',
      'calendar',
      'meeting',
      'appointment',
      'schedule',
      'book time',
      'free time',
      'busy',
      'available',
      'reschedule',
      'cancel meeting',
      'event',
      'reminder',
      'agenda',
      'time slot',
    ],
    restaurant: [
      'book table',
      'find restaurant',
      'find me restaurant',
      'find me a restaurant',
      'find me a good restaurant',
      'find me a good restaurant in',
      'find me a good restaurant in the area',
      'make reservation',
      'restaurant',
      'table',
      'reservation',
      'book dinner',
      'book lunch',
      'dining',
      'food',
      'cuisine',
      'menu',
      'reserve table',
      'restaurant booking',
      'table for',
      'dinner reservation',
    ],
    websearch: [
      'google',
      'search the web',
      'web search',
      'search online',
      'internet search',
      'bing',
      'search engine',
      'lookup online',
      'look up online',
      'research online',
      'find on web',
      'find on internet',
      'latest news',
      'current news',
      'recent news',
      'news about',
      'search news',
      'google search',
      'web lookup',
      'online research',
    ],
    confluence: [
      'confluence',
      'confluence search',
      'confluence page',
      'confluence space',
      'search confluence',
      'find in confluence',
      'confluence documentation',
      'wiki page',
      'wiki search',
      'team wiki',
      'documentation search',
      'confluence wiki',
      'search wiki',
      'wiki documentation',
      'create confluence page',
      'edit confluence page',
      'update confluence page',
      'confluence space search',
      'team documentation',
      'check on confluence',
      'check confluence',
      'look at confluence',
      'look on confluence',
      'find on confluence',
      'check the confluence',
      'look in confluence',
      'confluence docs',
      'confluence document',
    ],
    jira: [
      'jira',
      'jira ticket',
      'jira issue',
      'jira search',
      'search jira',
      'find in jira',
      'jira board',
      'create ticket',
      'create issue',
      'jira sprint',
      'sprint planning',
      'backlog',
      'jira backlog',
      'kanban board',
      'jira kanban',
      'assign ticket',
      'ticket status',
      'issue status',
      'jira dashboard',
      'epic',
      'user story',
      'jira query',
      'jira filter',
      'close ticket',
      'resolve issue',
      'update ticket',
      'jira assignee',
      'check on jira',
      'check jira',
      'look at jira',
      'look on jira',
      'find on jira',
      'check the jira',
      'look in jira',
      'jira tasks',
      'jira project',
    ],
    weather: [
      'weather',
      'weather forecast',
      'weather report',
      'weather conditions',
      'weather today',
      'weather tomorrow',
      'current weather',
      'today weather',
      'tomorrow weather',
      'check weather',
      'what is the weather',
      'how is the weather',
      'weather like',
      'forecast',
      'weather forecast',
      'weekly forecast',
      'daily forecast',
      'extended forecast',
      'temperature',
      'current temperature',
      'temperature today',
      'temperature tomorrow',
      'how hot',
      'how cold',
      'how warm',
      'how cool',
      'temperature outside',
      'outside temperature',
      'rain',
      'raining',
      'will it rain',
      'chance of rain',
      'rain forecast',
      'rain today',
      'rain tomorrow',
      'snow',
      'snowing',
      'will it snow',
      'chance of snow',
      'snow forecast',
      'snow today',
      'snow tomorrow',
      'sunny',
      'sun',
      'sunshine',
      'cloudy',
      'clouds',
      'overcast',
      'windy',
      'wind',
      'wind speed',
      'stormy',
      'storms',
      'thunderstorm',
      'storm warning',
      'weather alert',
      'weather warning',
      'weather advisory',
      'severe weather',
      'humidity',
      'air pressure',
      'barometric pressure',
      'visibility',
      'air quality',
      'uv index',
      'pollen count',
      'allergy forecast',
      'umbrella',
      'need umbrella',
      'bring umbrella',
      'take umbrella',
      'jacket',
      'need jacket',
      'bring jacket',
      'coat',
      'need coat',
      'bring coat',
      'dress for weather',
      'weather appropriate',
      'local weather',
      'nearby weather',
      'here weather',
      'weather in',
      'weather at',
      'weather for',
      'good weather',
      'bad weather',
      'nice weather',
      'terrible weather',
      'awful weather',
      'beautiful weather',
      'perfect weather',
      'weather suitable',
      'outdoor weather',
      'weather activities',
      'weather sports',
      'warmer',
      'colder',
      'wetter',
      'drier',
      'than yesterday',
      'than usual',
      'than average',
      'weather yesterday',
      'weather last week',
      'weather comparison',
      'precipitation',
      'chance of precipitation',
      'drizzle',
      'shower',
      'downpour',
      'hail',
      'sleet',
      'fog',
      'foggy',
      'mist',
      'misty',
      'clear',
      'clear skies',
      'partly cloudy',
      'mostly cloudy',
      'overcast',
      'partly sunny',
      'mostly sunny',
    ],
  };

  /**
   * Tool-specific minimum keyword thresholds.
   * Tools with unique, specific names can have lower thresholds.
   */
  private readonly toolMinimumThresholds: Record<string, number> = {
    confluence: 1, // "confluence" is highly specific
    jira: 1, // "jira" is highly specific
    weather: 1, // "weather" is highly specific
    email: 2, // "email" is more generic, keep higher threshold
    calendar: 2, // Calendar terms can be ambiguous
    restaurant: 2, // Restaurant terms can be ambiguous
    websearch: 2, // Web search terms are often generic
  };

  /**
   * Get the minimum keyword threshold for a specific tool.
   */
  private getMinimumThreshold(toolName: string): number {
    return this.toolMinimumThresholds[toolName] || 2; // Default to 2 if not specified
  }

  /**
   * Analyzes a transcript to detect if external tools are required.
   * Uses keyword matching with confidence scoring based on matches found.
   */
  async detectToolIntent(transcript: string): Promise<ToolIntentResult> {
    if (!transcript || transcript.trim().length === 0) {
      return {
        requiresTools: false,
        detectedTools: [],
        confidence: 0,
      };
    }

    const normalizedTranscript = transcript.toLowerCase().trim();
    const detectedTools: string[] = [];
    let totalMatches = 0;
    let maxMatches = 0;

    // Check each tool category for keyword matches
    for (const [toolName, keywords] of Object.entries(this.toolKeywords)) {
      let matches = 0;
      const matchedKeywords: string[] = [];

      for (const keyword of keywords) {
        if (normalizedTranscript.includes(keyword.toLowerCase())) {
          matches++;
          matchedKeywords.push(keyword);
        }
      }

      // Use tool-specific minimum threshold instead of global threshold
      const minimumMatches = this.getMinimumThreshold(toolName);

      if (matches >= minimumMatches) {
        detectedTools.push(toolName);
        totalMatches += matches;
        maxMatches = Math.max(maxMatches, matches);

        logger.debug(
          `[KeywordIntentDetector] Detected ${toolName} tool intent with ${matches} keyword matches (threshold: ${minimumMatches}):`,
          matchedKeywords
        );
      } else if (matches > 0) {
        logger.debug(
          `[KeywordIntentDetector] ${toolName} tool intent below threshold with ${matches} matches (threshold: ${minimumMatches}):`,
          matchedKeywords
        );
      }
    }

    const requiresTools = detectedTools.length > 0;

    // Calculate confidence based on number of matches
    // Higher confidence for more matches, capped at 1.0
    const confidence = requiresTools ? Math.min(totalMatches * 0.2, 1.0) : 0;

    const result: ToolIntentResult = {
      requiresTools,
      detectedTools: requiresTools ? detectedTools : undefined,
      confidence: requiresTools ? confidence : undefined,
    };

    if (requiresTools) {
      logger.info(
        `[KeywordIntentDetector] Tool intent detected: ${
          transcript.substring(0, 100) + (transcript.length > 100 ? '...' : '')
        }`,
        {
          detectedTools,
          confidence,
          totalMatches,
        }
      );
    } else {
      logger.debug(
        `[KeywordIntentDetector] No tool intent detected for transcript: ${
          transcript.substring(0, 100) + (transcript.length > 100 ? '...' : '')
        }`
      );
    }

    return result;
  }

  /**
   * Get all available tool categories and their keywords.
   * Useful for debugging and monitoring.
   */
  getToolCategories(): Record<string, string[]> {
    return { ...this.toolKeywords };
  }

  /**
   * Add custom keywords to a tool category.
   * Allows runtime extension of keyword patterns.
   */
  addKeywords(toolName: string, keywords: string[]): void {
    if (!this.toolKeywords[toolName]) {
      this.toolKeywords[toolName] = [];
    }
    this.toolKeywords[toolName].push(...keywords);
    logger.debug(
      `[KeywordIntentDetector] Added ${keywords.length} keywords to ${toolName} category`
    );
  }
}
