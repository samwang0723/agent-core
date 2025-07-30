import {
  Event,
  EventType,
  LoginSummaryEvent,
  UnifiedPeriodicSummaryEvent,
} from './event.types';
import { memoryPatterns } from '../../mastra/memory/memory.dto';
import { mastraMemoryService } from '../../mastra/memory/memory.service';
import { mastra } from '../../mastra';
import logger from '../utils/logger';

export class EventToChatService {
  private static instance: EventToChatService;

  private constructor() {}

  public static getInstance(): EventToChatService {
    if (!EventToChatService.instance) {
      EventToChatService.instance = new EventToChatService();
    }
    return EventToChatService.instance;
  }

  /**
   * Convert a calendar event into a chat message and broadcast it to the user
   */
  public async convertEventToChat(
    event: Event,
    locale: string = 'en'
  ): Promise<void> {
    try {
      // Only process calendar events
      if (!this.isCalendarEvent(event)) {
        return;
      }

      logger.info(`Converting calendar event to chat message`, {
        eventId: event.id,
        eventType: event.type,
        userId: event.userId,
      });

      // Generate AI message about the event
      const chatMessage = await this.generateEventMessage(event, locale);

      if (!chatMessage) {
        logger.warn('Failed to generate chat message for event', {
          eventId: event.id,
        });
        return;
      }

      // Create a chat message event and broadcast it
      await this.broadcastChatMessage(event.userId, chatMessage, event);

      // Also save to conversation history for persistence
      await this.saveToConversationHistory(event.userId, chatMessage);

      logger.info(`Successfully broadcasted calendar event as chat message`, {
        eventId: event.id,
        userId: event.userId,
        messageLength: chatMessage.length,
      });
    } catch (error) {
      logger.error('Failed to convert event to chat message', {
        error: error instanceof Error ? error.message : String(error),
        eventId: event.id,
        userId: event.userId,
      });
    }
  }

  /**
   * Check if the event should be converted to chat (unified summaries only)
   */
  private isCalendarEvent(event: Event): boolean {
    return [
      EventType.LOGIN_SUMMARY,
      EventType.UNIFIED_PERIODIC_SUMMARY,
    ].includes(event.type);
  }

  /**
   * Generate a contextual AI message about the calendar event
   */
  private async generateEventMessage(
    event: Event,
    locale: string
  ): Promise<string | null> {
    try {
      const prompt = this.createEventPrompt(event, locale);

      // Use the general agent to generate a natural conversational response
      const generalAgent = mastra.getAgent('generalAgent');

      if (!generalAgent) {
        logger.error('General agent not found');
        return null;
      }

      // Get user's memory patterns for context
      const resourceId = memoryPatterns.getResourceId(event.userId);
      const threadId = memoryPatterns.getThreadId(event.userId);

      // Generate response using the agent
      const response = await generalAgent.generate(prompt, {
        resourceId,
        threadId,
        maxRetries: 2,
        maxSteps: 2,
        maxTokens: 200, // Keep responses concise
      });

      return response.text || null;
    } catch (error) {
      logger.error('Error generating event message', {
        error: error instanceof Error ? error.message : String(error),
        eventId: event.id,
      });
      return null;
    }
  }

  /**
   * Create a prompt for the AI to generate a message about the unified summary
   */
  private createEventPrompt(event: Event, locale: string): string {
    switch (event.type) {
      case EventType.LOGIN_SUMMARY:
        return this.createLoginSummaryPrompt(
          event as LoginSummaryEvent,
          locale
        );

      case EventType.UNIFIED_PERIODIC_SUMMARY:
        return this.createPeriodicSummaryPrompt(
          event as UnifiedPeriodicSummaryEvent,
          locale
        );

      default:
        return `You are Friday, the user's AI assistant. Here's a system update: ${JSON.stringify(event.data)}. Present this to the user in a friendly way. ALWAYS respond with Language locale ${locale}.`;
    }
  }

  /**
   * Create prompt for login summary
   */
  private createLoginSummaryPrompt(
    event: LoginSummaryEvent,
    locale: string
  ): string {
    return `You are Friday, the user's AI assistant. The user just logged in and here's their personalized summary: ${event.data.summary}. Present this warmly as their welcome back message. ALWAYS respond with Language locale ${locale}.`;
  }

  /**
   * Create prompt for periodic summary
   */
  private createPeriodicSummaryPrompt(
    event: UnifiedPeriodicSummaryEvent,
    locale: string
  ): string {
    return `You are Friday, the user's AI assistant. Here's a periodic update for the user: ${event.data.summary}. Present this as a helpful status update. ALWAYS respond with Language locale ${locale}.`;
  }

  /**
   * Broadcast the generated chat message directly to the user
   */
  private async broadcastChatMessage(
    userId: string,
    message: string,
    triggerEvent: Event
  ): Promise<void> {
    // Import pusherEventBroadcaster dynamically to avoid circular dependency
    const { pusherEventBroadcaster } = await import('./pusher.service');

    try {
      // Broadcast the summary directly as a chat message
      await pusherEventBroadcaster.broadcastChatMessage(userId, message);

      logger.debug('Broadcasted summary chat message', {
        userId,
        messageLength: message.length,
        triggerEventId: triggerEvent.id,
      });
    } catch (error) {
      logger.error('Failed to broadcast chat message', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  /**
   * Save the chat message to conversation history for persistence
   */
  private async saveToConversationHistory(
    userId: string,
    message: string
  ): Promise<void> {
    try {
      await mastraMemoryService.saveMessage('assistant', userId, message);
      logger.debug('Saved proactive message to conversation history', {
        userId,
      });
    } catch (error) {
      logger.error('Failed to save proactive message to history', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      // Don't throw - this is non-critical
    }
  }
}

// Export singleton instance
export const eventToChatService = EventToChatService.getInstance();
