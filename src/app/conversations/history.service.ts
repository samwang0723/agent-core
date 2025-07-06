import { mastraMemoryService } from '../../mastra/memory/memory.service';
import { Message, UserMemorySummary } from '../../mastra/memory/memory.dto';
import logger from '../utils/logger';

// Message history management class - Pure Mastra Memory wrapper
class MessageHistory {
  /**
   * Get message history for a specific user
   * Used for: Getting conversation history for display/context
   */
  async getHistory(userId: string, threadId: string): Promise<Message[]> {
    try {
      const { messages } = await mastraMemoryService.getUserMemory(
        userId,
        threadId
      );

      // Convert Mastra messages to conversation messages
      return messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })) as Message[];
    } catch (error) {
      logger.error('Failed to get history from Mastra memory', {
        error,
        userId,
        threadId,
      });
      throw error;
    }
  }

  /**
   * Clear all history for a specific user
   * Used for: Reset conversation functionality
   */
  async clearHistory(userId: string, threadId: string): Promise<void> {
    try {
      await mastraMemoryService.clearUserMemory(userId, threadId);
    } catch (error) {
      logger.error('Failed to clear history in Mastra memory', {
        error,
        userId,
        threadId,
      });
      throw error;
    }
  }

  /**
   * Initialize user memory with Mastra
   * Used for: Setting up new user sessions
   */
  async initializeUserMemory(userId: string, threadId: string): Promise<void> {
    try {
      await mastraMemoryService.initializeUserMemory(userId);
      logger.debug('User memory initialized', { userId, threadId });
    } catch (error) {
      logger.error('Failed to initialize user memory', {
        error,
        userId,
        threadId,
      });
      throw error;
    }
  }

  /**
   * Get user memory summary
   * Used for: Analytics and debugging
   */
  async getUserMemorySummary(
    userId: string
  ): Promise<UserMemorySummary | null> {
    try {
      return await mastraMemoryService.getUserMemorySummary(userId);
    } catch (error) {
      logger.error('Failed to get user memory summary', { error, userId });
      return null;
    }
  }
}

// Global message history instance
const messageHistory = new MessageHistory();

// Export the message history instance and types
export { messageHistory };
export type { Message };
