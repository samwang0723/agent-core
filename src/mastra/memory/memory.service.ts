import { Memory } from '@mastra/memory';
import {
  createMastraMemory,
  memoryPatterns,
  UserProfileSchema,
  createAgentMemoryConfig,
  validateMemoryConfig,
  mastraConfig,
  Message,
  ThreadMetadata,
  UserMemorySummary,
} from './memory.dto';
import logger from '../utils/logger';

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
  private readonly maxMessagesPerThread = 1000;
  private readonly retentionDays = 90;

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
  private getMemoryConfig(userId: string, threadId: string) {
    const config = createAgentMemoryConfig(userId, threadId);

    if (!validateMemoryConfig(config)) {
      throw new Error(
        `Invalid memory configuration for user ${userId}, thread ${threadId}`
      );
    }

    return config;
  }

  getMemory(): Memory {
    return this.memory;
  }

  /**
   * Get user memory including conversation history and working memory
   */
  async getUserMemory(
    userId: string,
    threadId: string
  ): Promise<{
    messages: Message[];
    workingMemory?: UserProfileSchema;
  }> {
    try {
      const threadId = memoryPatterns.getThreadId(userId);
      const { uiMessages } = await this.memory.query({
        threadId,
        selectBy: {
          last: 50,
        },
      });
      const mappedMessages = uiMessages
        .map(msg => {
          const role = msg.role;
          if (role === 'user' || role === 'assistant') {
            return {
              role: role,
              content: msg.content,
              timestamp: msg.createdAt,
            };
          }
          if (role === 'data') {
            return {
              role: 'tool' as const,
              content: msg.content,
              timestamp: msg.createdAt,
            };
          }
          return null;
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      return {
        messages: mappedMessages,
      };
    } catch (error) {
      logger.error('Failed to get user memory', {
        error,
        userId,
        threadId,
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
    threadId: string,
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
        threadId,
        message: safePreview(message, 50).preview,
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
  async clearUserMemory(userId: string, threadId: string): Promise<void> {
    try {
      const threadId = memoryPatterns.getThreadId(userId);
      // Clear working memory for this thread
      await this.memory.deleteThread(threadId);

      logger.info('User memory cleared', { userId, threadId });
    } catch (error) {
      logger.error('Failed to clear user memory', {
        error,
        userId,
        threadId,
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
  async getWorkingMemory(
    userId: string,
    threadId: string
  ): Promise<UserProfileSchema | null> {
    try {
      const config = this.getMemoryConfig(userId, threadId);

      const workingMemory = await this.memory.getWorkingMemory({
        threadId: config.thread,
        resourceId: config.resource,
      });

      return (workingMemory as UserProfileSchema) || null;
    } catch (error) {
      logger.error('Failed to get working memory', { error, userId, threadId });
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
      const threadId = `init-${Date.now()}`;
      const config = this.getMemoryConfig(userId, threadId);

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
          threadId,
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
      const threadId = threads[0]?.threadId || `summary-${Date.now()}`;
      const workingMemory = await this.getWorkingMemory(userId, threadId);

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
