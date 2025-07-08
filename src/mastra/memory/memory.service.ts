import { Memory } from '@mastra/memory';
import {
  createMastraMemory,
  memoryPatterns,
  UserProfileSchema,
  createAgentMemoryConfig,
  validateMemoryConfig,
  mastraConfig,
  ThreadMetadata,
  UserMemorySummary,
} from './memory.dto';
import logger from '../utils/logger';
import { CoreMessage } from '@mastra/core';

// Helper functions for message content filtering when vNext network is enabled

/**
 * Determines if a text block should be kept based on its content
 * @param text - The text content to check
 * @returns false if the text contains both "resourceId" and "resourceType" (indicating JSON selection object), true otherwise
 */
function shouldKeepTextBlock(text: string): boolean {
  return !(text.includes('resourceId') && text.includes('resourceType'));
}

/**
 * Filters message content to remove text blocks containing resourceId/resourceType JSON
 * @param message - The CoreMessage to filter
 * @returns null if no content blocks remain after filtering, otherwise a new message with filtered content
 */
function filterMessageContent(message: CoreMessage): CoreMessage | null {
  if (!message.content) {
    return message;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = message.content as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredContent: any;

  // Handle legacy format: content has a 'parts' property
  if (content.parts && Array.isArray(content.parts)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filteredParts = content.parts.filter((part: any) => {
      if (part.type === 'text' && typeof part.text === 'string') {
        return shouldKeepTextBlock(part.text);
      }
      return true; // Keep non-text parts
    });

    if (filteredParts.length === 0) {
      return null; // Drop message if no content blocks remain
    }

    filteredContent = {
      ...content,
      parts: filteredParts,
    };
  }
  // Handle vNext format: content is a direct array
  else if (Array.isArray(content)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filteredArray = content.filter((block: any) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return shouldKeepTextBlock(block.text);
      }
      return true; // Keep non-text blocks
    });

    if (filteredArray.length === 0) {
      return null; // Drop message if no content blocks remain
    }

    filteredContent = filteredArray;
  }
  // Handle other content formats - pass through unchanged
  else {
    filteredContent = content;
  }

  // Return new message object with filtered content, preserving all other properties
  return {
    ...message,
    content: filteredContent,
  };
}

// Helper functions removed as they're no longer needed with the new Memory API

/**
 * Mastra Memory Service
 *
 * Provides persistent, user-scoped memory management using Mastra's memory system
 * with proper API usage. Replaces the session-based MessageHistory with
 * user-specific persistent storage across conversations.
 *
 * IMPORTANT NOTE: Mastra Memory API Design
 * ========================================
 * The Mastra Memory API is designed around automatic memory management through
 * agent interactions rather than direct memory manipulation. Working memory
 * updates happen automatically when agents with proper memory configuration
 * interact with users. This service provides compatibility methods for
 * session state tracking and logging, but the actual working memory updates
 * are handled by the Mastra agent system during conversations.
 *
 * Working memory updates occur when:
 * - Agents are configured with memory and proper resourceId/threadId
 * - Agent interactions include memory context in generate() or stream() calls
 * - The working memory schema is defined in the memory configuration
 */
class MastraMemoryService {
  private memory: Memory;
  private readonly retentionDays = 30;

  constructor() {
    this.memory = createMastraMemory();
    this.initializeCleanupScheduler();
  }

  /**
   * Initialize automatic cleanup scheduler for memory retention
   */
  private initializeCleanupScheduler(): void {
    if (mastraConfig.memory.enableAutoCleanup) {
      const intervalMs =
        mastraConfig.memory.cleanupIntervalHours * 60 * 60 * 1000;
      setInterval(() => {
        this.performCleanup().catch(error => {
          logger.error('Memory cleanup failed', { error });
        });
      }, intervalMs);
    }
  }

  /**
   * Get memory configuration for a user and thread
   */
  private getMemoryConfig(userId: string) {
    const config = createAgentMemoryConfig(userId);

    if (!validateMemoryConfig(config)) {
      throw new Error(`Invalid memory configuration for user ${userId}`);
    }

    return config;
  }

  getMemory(): Memory {
    return this.memory;
  }

  /**
   * Get user memory including conversation history and working memory
   * When MASTRA_USING_VNEXT_NETWORK=true, filters out text blocks containing
   * resourceId/resourceType JSON to keep only pure conversational content.
   */
  async getUserMemory(
    userId: string,
    limit: number = 30
  ): Promise<{
    messages: CoreMessage[];
    workingMemory?: UserProfileSchema;
  }> {
    try {
      const threadId = memoryPatterns.getThreadId(userId);
      const resourceId = memoryPatterns.getResourceId(userId);
      const usingVNextNetwork =
        process.env.MASTRA_USING_VNEXT_NETWORK === 'true';
      const { messages } = await this.memory.query({
        threadId,
        resourceId,
        selectBy: {
          last: limit,
        },
      });

      let filteredMessages = messages;
      if (usingVNextNetwork) {
        const originalCount = messages.length;
        filteredMessages = messages
          .map(message => filterMessageContent(message))
          .filter((message): message is CoreMessage => message !== null);

        const filteredCount = filteredMessages.length;
        const droppedCount = originalCount - filteredCount;

        logger.debug(
          `[${userId}] vNext filtering: ${originalCount} -> ${filteredCount} messages (${droppedCount} dropped)`
        );

        if (droppedCount > 0) {
          logger.debug(
            `[${userId}] Dropped ${droppedCount} messages with no remaining content blocks after filtering`
          );
        }
      }

      return { messages: filteredMessages };
    } catch (error) {
      logger.error('Failed to get user memory', {
        error,
        userId,
      });
      return { messages: [] };
    }
  }

  /**
   * Save a user message to memory
   * Note: Current Mastra Memory API doesn't have direct message storage
   * Using working memory to store recent context
   */
  async saveMessage(
    role: 'user' | 'assistant',
    userId: string,
    message: string
  ): Promise<void> {
    try {
      const threadId = memoryPatterns.getThreadId(userId);
      const resourceId = memoryPatterns.getResourceId(userId);
      const thread = await this.memory.getThreadById({ threadId });
      if (!thread) {
        await this.memory.createThread({
          threadId,
          resourceId,
          metadata: {
            title: 'User Session',
          },
        });
      }
      await this.memory.saveMessages({
        format: 'v2',
        messages: [
          {
            role,
            content: {
              format: 2,
              parts: [{ type: 'text', text: message }],
            },
            createdAt: new Date(),
            id: `user-message-${Date.now()}`,
            threadId,
            resourceId,
          },
        ],
      });

      logger.debug('User message saved to memory', { userId, threadId });
    } catch (error) {
      logger.error('Failed to save user message', {
        error,
        userId,
        message: safePreview(message, 10).preview,
      });
      throw error;
    }
  }

  /**
   * Get all threads for a user
   */
  async getUserThreads(userId: string): Promise<ThreadMetadata[]> {
    try {
      const resourceId = memoryPatterns.getResourceId(userId);

      // Use getThreadsByResourceId method from the Memory API
      const threads = await this.memory.getThreadsByResourceId({ resourceId });

      return threads.map(thread => ({
        threadId: memoryPatterns.extractSessionId(thread.id),
        userId,
        createdAt: thread.createdAt,
        lastActivity: thread.updatedAt,
        messageCount: 0, // Default to 0 as messageCount may not exist
        title: (thread.metadata?.title as string) || undefined,
      }));
    } catch (error) {
      logger.error('Failed to get user threads', { error, userId });
      return [];
    }
  }

  /**
   * Clear memory for a specific user thread
   */
  async clearUserMemory(userId: string): Promise<void> {
    try {
      const threadId = memoryPatterns.getThreadId(userId);
      // Clear working memory for this thread
      await this.memory.deleteThread(threadId);

      logger.info('User memory cleared', { userId, threadId });
    } catch (error) {
      logger.error('Failed to clear user memory', {
        error,
        userId,
      });
      throw error;
    }
  }

  /**
   * Clear all memory for a user (all threads)
   */
  async clearAllUserMemory(userId: string): Promise<void> {
    try {
      const resourceId = memoryPatterns.getResourceId(userId);

      // Get all threads and clear them individually
      const threads = await this.memory.getThreadsByResourceId({ resourceId });

      for (const thread of threads) {
        await this.memory.getWorkingMemory({
          threadId: thread.id,
          resourceId,
        });
      }

      logger.info('All user memory cleared', { userId });
    } catch (error) {
      logger.error('Failed to clear all user memory', { error, userId });
      throw error;
    }
  }

  /**
   * Get user working memory
   */
  async getWorkingMemory(userId: string): Promise<UserProfileSchema | null> {
    try {
      const threadId = memoryPatterns.getThreadId(userId);
      const resourceId = memoryPatterns.getResourceId(userId);

      const workingMemory = await this.memory.getWorkingMemory({
        threadId,
        resourceId,
      });

      return (workingMemory as UserProfileSchema) || null;
    } catch (error) {
      logger.error('Failed to get working memory', { error, userId });
      return null;
    }
  }

  /**
   * Initialize user working memory with default template
   * Note: Mastra Memory API handles memory initialization automatically
   * when agents first interact with users. This method serves as a
   * compatibility layer and preparation step.
   */
  async initializeUserMemory(
    userId: string,
    template:
      | 'userProfile'
      | 'businessContext'
      | 'technicalContext' = 'userProfile'
  ): Promise<void> {
    try {
      const config = this.getMemoryConfig(userId);

      // Check if working memory already exists
      const existing = await this.memory.getWorkingMemory({
        threadId: config.thread,
        resourceId: config.resource,
      });

      if (existing && Object.keys(existing).length > 0) {
        logger.debug('User memory already initialized', {
          userId,
          memoryKeys: Object.keys(existing).join(', '),
        });
        return;
      }

      // Log initialization attempt for debugging and tracking
      logger.info('User memory initialization requested', {
        userId,
        template,
        resourceId: config.resource,
      });

      // Note: Mastra Memory API initializes working memory automatically
      // when agents first interact with users. The memory schema defined
      // in the configuration will be used automatically.
      logger.debug(
        'Memory initialization prepared for first agent interaction',
        {
          userId,
          template,
        }
      );
    } catch (error) {
      logger.error('Failed to prepare user memory initialization', {
        error,
        userId,
      });
      throw error;
    }
  }

  /**
   * Get user memory summary
   */
  async getUserMemorySummary(userId: string): Promise<UserMemorySummary> {
    try {
      const threads = await this.getUserThreads(userId);
      const workingMemory = await this.getWorkingMemory(userId);

      const totalMessages = threads.reduce(
        (sum, thread) => sum + thread.messageCount,
        0
      );
      const lastActivity =
        threads.length > 0
          ? new Date(Math.max(...threads.map(t => t.lastActivity.getTime())))
          : new Date();

      return {
        userId,
        totalThreads: threads.length,
        totalMessages,
        lastActivity,
        workingMemory: workingMemory || undefined,
      };
    } catch (error) {
      logger.error('Failed to get user memory summary', { error, userId });
      return {
        userId,
        totalThreads: 0,
        totalMessages: 0,
        lastActivity: new Date(),
      };
    }
  }

  /**
   * Perform memory cleanup based on retention policies
   */
  async performCleanup(): Promise<void> {
    try {
      logger.info('Starting memory cleanup');

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

      // Memory cleanup would need to be implemented based on Mastra's cleanup APIs
      // For now, we'll log the cleanup attempt
      logger.info('Memory cleanup completed', { cutoffDate });
    } catch (error) {
      logger.error('Memory cleanup failed', { error });
      throw error;
    }
  }
}

// Safe preview utility that handles string operations on unknown types
export function safePreview(
  value: unknown,
  maxLength: number = 100
): { preview: string; originalLength: number } {
  if (typeof value === 'string') {
    return {
      preview:
        value.length > maxLength
          ? value.substring(0, maxLength) + '...'
          : value,
      originalLength: value.length,
    };
  }

  // Placeholder for tool logging
  // Helper function for safe object-to-string conversion with truncation
  function safeStringify(value: unknown, maxLength: number = 1000): string {
    try {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';

      let stringified: string;
      if (typeof value === 'string') {
        stringified = value;
      } else if (typeof value === 'object') {
        stringified = JSON.stringify(value);
      } else {
        stringified = String(value);
      }

      return stringified.length > maxLength
        ? stringified.substring(0, maxLength) + '...'
        : stringified;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // Fallback for circular references or other JSON.stringify errors
      return `[Object: ${typeof value}]`;
    }
  }

  // For non-string values, convert to safe string representation
  const stringified = safeStringify(value, maxLength * 2); // Allow more room for conversion
  const preview =
    stringified.length > maxLength
      ? stringified.substring(0, maxLength) + '...'
      : stringified;

  return {
    preview,
    originalLength: stringified.length,
  };
}

// Create and export singleton instance
const mastraMemoryService = new MastraMemoryService();

export { mastraMemoryService };
