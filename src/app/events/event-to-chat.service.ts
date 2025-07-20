import {
  Event,
  EventType,
  EventPriority,
  EventSource,
  CalendarNewEventEvent,
  CalendarUpcomingEventEvent,
  ChatMessageEvent,
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
  public async convertEventToChat(event: Event): Promise<void> {
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
      const chatMessage = await this.generateEventMessage(event);

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
   * Check if the event is a calendar event that should be converted to chat
   */
  private isCalendarEvent(event: Event): boolean {
    return [
      EventType.CALENDAR_NEW_EVENT,
      EventType.CALENDAR_UPCOMING_EVENT,
      EventType.CALENDAR_EVENT_REMINDER,
      EventType.CALENDAR_BATCH_SUMMARY,
    ].includes(event.type);
  }

  /**
   * Generate a contextual AI message about the calendar event
   */
  private async generateEventMessage(event: Event): Promise<string | null> {
    try {
      const prompt = this.createEventPrompt(event);

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
   * Create a prompt for the AI to generate a message about the calendar event
   */
  private createEventPrompt(event: Event): string {
    const baseContext = `You are Friday, the user's AI assistant. A calendar event was just detected. Respond naturally and conversationally as if you're proactively helping manage their schedule. Keep it brief and helpful.`;

    switch (event.type) {
      case EventType.CALENDAR_NEW_EVENT:
        return this.createNewEventPrompt(
          event as CalendarNewEventEvent,
          baseContext
        );

      case EventType.CALENDAR_UPCOMING_EVENT:
        return this.createUpcomingEventPrompt(
          event as CalendarUpcomingEventEvent,
          baseContext
        );

      default:
        return `${baseContext}\n\nA calendar event was detected: ${JSON.stringify(event.data)}. Mention this to the user conversationally.`;
    }
  }

  /**
   * Create prompt for new calendar events
   */
  private createNewEventPrompt(
    event: CalendarNewEventEvent,
    baseContext: string
  ): string {
    const { title, startTime, location } = event.data;
    const startDate = new Date(startTime).toLocaleDateString();
    const startTimeStr = new Date(startTime).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    let eventDetails = `"${title}" on ${startDate} at ${startTimeStr}`;
    if (location) {
      eventDetails += ` at ${location}`;
    }

    return `${baseContext}

A new event was just added to the calendar: ${eventDetails}.

Respond naturally as their assistant, acknowledging the new event and offering brief, helpful assistance if appropriate (like asking if they need preparation help or noting any relevant details). Keep it conversational and concise.`;
  }

  /**
   * Create prompt for upcoming event reminders
   */
  private createUpcomingEventPrompt(
    event: CalendarUpcomingEventEvent,
    baseContext: string
  ): string {
    const { title, startTime, location, timeUntilStart, reminder } = event.data;
    const startTimeStr = new Date(startTime).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    let urgency = '';
    if (reminder === 'starting') {
      urgency = 'starting very soon';
    } else if (timeUntilStart <= 30) {
      urgency = `starting in ${timeUntilStart} minutes`;
    } else {
      urgency = `coming up in ${timeUntilStart} minutes`;
    }

    let eventDetails = `"${title}" ${urgency} at ${startTimeStr}`;
    if (location) {
      eventDetails += ` at ${location}`;
    }

    return `${baseContext}

Upcoming event reminder: ${eventDetails}.

Respond naturally as their assistant with a friendly heads-up about the upcoming event. Keep it brief and helpful - maybe mention preparation if relevant. Be conversational.`;
  }

  /**
   * Broadcast the generated chat message as a Pusher event
   */
  private async broadcastChatMessage(
    userId: string,
    message: string,
    triggerEvent: Event
  ): Promise<void> {
    // Import pusherEventBroadcaster dynamically to avoid circular dependency
    const { pusherEventBroadcaster } = await import('./pusher.service');

    try {
      // Create a chat message event
      const chatMessageEvent: ChatMessageEvent = {
        id: `chat-message-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        userId,
        type: EventType.CHAT_MESSAGE,
        timestamp: new Date(),
        priority: EventPriority.MEDIUM,
        source: EventSource.SYSTEM,
        data: {
          message,
          isProactive: true,
          triggerEventType: triggerEvent.type,
          triggerEventId: triggerEvent.id,
        },
      };

      // Broadcast the chat message event
      await pusherEventBroadcaster.broadcastEvent(chatMessageEvent);

      logger.debug('Broadcasted chat message event', {
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
