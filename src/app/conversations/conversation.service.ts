import { Context } from 'hono';
import { Session } from '../middleware/auth';
import { UserRuntimeContext } from '../../mastra/utils/context';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { CoreMessage } from '@mastra/core';
import logger from '../utils/logger';

// Context cache with 60-second TTL
interface CachedContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  timestamp: number;
}

const contextCache = new Map<string, CachedContext>();
const CACHE_TTL = 60000; // 60 seconds
const MAX_CONTEXT_LENGTH = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCachedData(key: string): any | null {
  const cached = contextCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  contextCache.delete(key);
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCachedData(key: string, data: any): void {
  contextCache.set(key, { data, timestamp: Date.now() });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatDateTime(timezone: string): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

function truncateContext(
  message: string,
  maxLength: number = MAX_CONTEXT_LENGTH
): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength - 3) + '...';
}

export async function generateRequestContext(
  session: Session,
  context: Context
): Promise<{
  runtimeContext: RuntimeContext<UserRuntimeContext>;
  contextMessage: CoreMessage;
}> {
  // Check cache for user context
  const cacheKey = `${session.id}_${session.email}`;
  let cachedUserData = getCachedData(cacheKey);

  // Extract only essential headers
  const timezone = context.req.header('x-client-timezone') || 'UTC';

  // Parallel processing of independent operations
  const [runtimeContext, formattedDateTime] = await Promise.all([
    // Runtime context setup
    Promise.resolve(
      (() => {
        const ctx = new RuntimeContext<UserRuntimeContext>();
        ctx.set('sessionId', session.id);
        ctx.set('email', session.email);
        ctx.set('timezone', timezone);
        ctx.set('googleAuthToken', session.accessToken || '');
        return ctx;
      })()
    ),

    // Date formatting
    Promise.resolve(formatDateTime(timezone)),
  ]);

  // Set datetime in runtime context
  runtimeContext.set('datetime', formattedDateTime);

  // Cache user data if not already cached
  if (!cachedUserData) {
    cachedUserData = {
      name: session.name,
      timezone: timezone,
    };
    setCachedData(cacheKey, cachedUserData);
  }

  logger.debug(`[${session.id}] Agent session initialized`);
  logger.debug(`[${session.id}] Runtime context ready`);

  // Create concise context message with truncation
  const contextMessage = truncateContext(
    `[Context: ${formattedDateTime} ${timezone}. User: ${cachedUserData.name}]`
  );

  return {
    runtimeContext,
    contextMessage: {
      role: 'system',
      content: contextMessage,
    },
  };
}
