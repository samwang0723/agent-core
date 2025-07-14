import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { z } from 'zod';
import logger from '../utils/logger';
// import { TokenLimiter, ToolCallFilter } from '@mastra/memory/processors';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

// User profile schema for structured working memory
const userProfileSchema = z.object({
  name: z.string().optional(),
  location: z.string().optional(),
  timezone: z.string().optional(),
  preferences: z
    .object({
      communicationStyle: z.enum(['formal', 'casual', 'technical']).optional(),
      projectGoal: z.string().optional(),
      keyDeadlines: z
        .array(
          z.object({
            name: z.string(),
            date: z.string(),
          })
        )
        .optional(),
      preferredLanguage: z.string().optional(),
      notificationSettings: z
        .object({
          email: z.boolean().optional(),
          slack: z.boolean().optional(),
          sms: z.boolean().optional(),
        })
        .optional(),
      workingHours: z
        .object({
          start: z.string().optional(),
          end: z.string().optional(),
          timezone: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  sessionState: z
    .object({
      currentProject: z.string().optional(),
      activeFeatures: z.array(z.string()).optional(),
      lastActivity: z.string().optional(),
      lastTaskDiscussed: z.string().optional(),
      lastAgentUsed: z.string().optional(),
      currentContext: z.string().optional(),
    })
    .optional(),
});

// PostgreSQL connection configuration using shared config
const createPostgresConfig = () => {
  // Support both DATABASE_URL and individual components
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      schemaName: process.env.MASTRA_MEMORY_SCHEMA || undefined,
    };
  }

  // Build connection string from shared database config
  return {
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/mastra_memory',
    schemaName: process.env.MASTRA_MEMORY_SCHEMA || undefined,
  };
};

// Singleton instance for PostgreSQL storage to prevent duplicate connections
let postgresStorageInstance: PostgresStore | null = null;

// Create PostgreSQL storage with proper error handling and singleton pattern
const createPostgresStorage = () => {
  // Return existing instance if already created
  if (postgresStorageInstance) {
    logger.debug('Reusing existing PostgreSQL storage instance');
    return postgresStorageInstance;
  }

  try {
    const config = createPostgresConfig();
    logger.info('Initializing PostgreSQL storage for memory persistence');

    // Create PostgresStore following official Mastra documentation
    const storage = new PostgresStore({
      connectionString: config.connectionString,
      ...(config.schemaName && { schemaName: config.schemaName }),
    });

    // Store the instance for reuse
    postgresStorageInstance = storage;
    logger.info('PostgreSQL storage singleton instance created');

    return storage;
  } catch (error) {
    logger.error('Failed to initialize PostgreSQL storage:', error);
    logger.warn('Memory will not persist between sessions');
    return null;
  }
};

const createLibSQLStorage = () => {
  const storage = new LibSQLStore({
    url: 'file:./mastra.db',
  });
  logger.info('Initialized LibSQL storage for memory persistence');
  return storage;
};

const createLibSQLVectorStore = () => {
  const vectorStore = new LibSQLVector({
    connectionUrl: 'file:./mastra.db',
  });
  logger.info('Initialized LibSQL vector store for memory persistence');
  return vectorStore;
};

// Singleton instance for Memory to prevent multiple instances
let memoryInstance: Memory | null = null;

// Memory configuration following Mastra best practices with singleton pattern
export const createMastraMemory = () => {
  // Return existing instance if already created
  if (memoryInstance) {
    logger.debug('Reusing existing Mastra Memory instance');
    return memoryInstance;
  }

  try {
    const module = process.env.MASTRA_MEMORY_MODULE || 'libsql';
    const storage =
      module === 'postgres' ? createPostgresStorage() : createLibSQLStorage();
    const vectorStore =
      module === 'libsql' ? createLibSQLVectorStore() : undefined;
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY,
      headers: {
        'Accept-Encoding': 'identity',
      },
    });
    const embeddingModel = google.textEmbeddingModel(
      'gemini-embedding-exp-03-07',
      {
        outputDimensionality: 1536, // optional, number of dimensions for the embedding
        taskType: 'SEMANTIC_SIMILARITY', // optional, specifies the task type for generating embeddings
      }
    );

    const memory = new Memory({
      options: {
        lastMessages: 10,
        workingMemory: {
          enabled: true,
          scope: 'resource', // Enable resource-scoped memory for cross-conversation persistence
          schema: userProfileSchema,
        },
        semanticRecall: {
          topK: 3, // Retrieve 3 most similar messages
          messageRange: 2, // Include 2 messages before and after each match
          scope: 'resource', // Search across all threads for this user
        },
      },
      processors: [
        // Ensure the total tokens from memory don't exceed ~127k
        // new TokenLimiter(127000),
        // new ToolCallFilter(),
      ],
      embedder: embeddingModel,
      storage: storage || undefined,
      vector: vectorStore,
    });

    // Store the instance for reuse
    memoryInstance = memory;

    if (storage) {
      logger.info(
        'Successfully initialized Mastra Memory singleton with PostgreSQL persistence'
      );
    } else {
      logger.warn(
        'Initialized Mastra Memory singleton without persistent storage'
      );
    }

    return memory;
  } catch (error) {
    logger.error('Failed to initialize Mastra Memory with PostgreSQL:', error);

    // Fallback to in-memory storage
    logger.warn(
      'Falling back to in-memory storage - data will not persist between sessions'
    );
    const fallbackMemory = new Memory({
      options: {
        lastMessages: 10,
        workingMemory: {
          enabled: true,
          scope: 'resource',
          schema: userProfileSchema,
        },
        // semanticRecall: {
        //   topK: 3, // Retrieve 3 most similar messages
        //   messageRange: 2, // Include 2 messages before and after each match
        //   scope: 'resource', // Search across all threads for this user
        // },
      },
    });

    // Store the fallback instance for reuse
    memoryInstance = fallbackMemory;
    return fallbackMemory;
  }
};

// Resource ID and Thread ID patterns for user-specific memory scoping
export const memoryPatterns = {
  // Generate resourceId from user ID for persistent cross-session memory
  getResourceId: (userId: string): string => `user:${userId}`,

  // Generate threadId from session ID for conversation threads
  getThreadId: (sessionId: string): string => `session:${sessionId}`,

  // Generate combined ID for specific use cases
  getCombinedId: (userId: string, sessionId: string): string =>
    `user:${userId}:session:${sessionId}`,

  // Extract user ID from resourceId
  extractUserId: (resourceId: string): string =>
    resourceId.replace('user:', ''),

  // Extract session ID from threadId
  extractSessionId: (threadId: string): string =>
    threadId.replace('session:', ''),
};

// Mastra-specific configuration settings with environment variables
export const mastraConfig = {
  // Development settings
  development: {
    enableDebugLogs:
      process.env.MASTRA_DEV_MODE === 'true' ||
      process.env.NODE_ENV === 'development',
    enableMemoryInspection:
      process.env.MASTRA_ENABLE_DEBUGGING === 'true' ||
      process.env.NODE_ENV === 'development',
  },

  // Memory settings with PostgreSQL
  memory: {
    // PostgreSQL-specific settings
    schemaName: process.env.MASTRA_MEMORY_SCHEMA || 'mastra',

    // Retention settings from environment
    retentionDays: parseInt(process.env.MASTRA_MEMORY_RETENTION_DAYS || '30'),
    maxMessages: parseInt(process.env.MASTRA_MEMORY_MAX_MESSAGES || '1000'),

    // Cleanup settings
    enableAutoCleanup: true,
    cleanupIntervalHours: 24,

    // Performance settings
    batchSize: 100,
    maxConcurrentOperations: 5,
  },

  // Workflow settings
  workflow: {
    maxSteps: parseInt(process.env.MASTRA_WORKFLOW_MAX_STEPS || '5'),
    timeoutMs: parseInt(process.env.MASTRA_WORKFLOW_TIMEOUT || '30000'),
  },

  // Feature flags
  features: {
    enableTelemetry: process.env.MASTRA_ENABLE_TELEMETRY === 'true',
    enableVectorSearch:
      process.env.MASTRA_MEMORY_ENABLE_VECTOR_SEARCH !== 'false',
    useOptimizedEmbeddings: true,
  },

  // Logging and monitoring
  logging: {
    level: process.env.MASTRA_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
    enableStructuredLogs: process.env.NODE_ENV === 'production',
    enableMemoryLogs: process.env.MASTRA_DEV_MODE === 'true',
  },
};

// Export types for TypeScript support
export type UserProfileSchema = z.infer<typeof userProfileSchema>;
export type MastraMemoryInstance = ReturnType<typeof createMastraMemory>;

// Memory configuration interface
export interface MastraMemoryConfig {
  resource: string;
  thread: string;
}

// Helper function to create agent memory configuration for use in agent creation
export const createAgentMemoryConfig = (userId: string) => {
  return {
    resource: `user:${userId}`,
    thread: `session:${userId}`,
    userId,
  };
};

// Utility function to validate memory configuration
export const validateMemoryConfig = (config: MastraMemoryConfig): boolean => {
  try {
    if (!config.resource || !config.thread) {
      logger.warn('Memory configuration missing resource or thread ID');
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Invalid memory configuration', { error, config });
    return false;
  }
};

// Thread metadata interface
export interface ThreadMetadata {
  threadId: string;
  userId: string;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  title?: string;
}

// User memory summary interface
export interface UserMemorySummary {
  userId: string;
  totalThreads: number;
  totalMessages: number;
  lastActivity: Date;
  workingMemory?: UserProfileSchema;
}
