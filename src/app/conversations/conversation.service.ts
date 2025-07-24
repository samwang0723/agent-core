import { Context } from 'hono';
import { Session } from '../middleware/auth';
import { UserRuntimeContext } from '../../mastra/utils/context';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { CoreMessage } from '@mastra/core';
import logger from '../utils/logger';
import {
  detectLocale,
  createLocaleSystemMessage,
  getLocaleName,
  SupportedLocale,
} from '../utils/locale';

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

function formatDateTime(timezone: string): string {
  return new Date().toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
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
  locale: SupportedLocale;
  localeSystemMessage: string;
}> {
  // Check cache for user context
  const cacheKey = `${session.id}_${session.email}`;
  let cachedUserData = getCachedData(cacheKey);

  // Extract essential headers and detect locale
  // Prioritize session timezone over header timezone
  const timezone =
    session.timezone || context.req.header('x-client-timezone') || 'UTC';
  const locale = detectLocale(context);

  // Parallel processing of independent operations
  const [runtimeContext, formattedDateTime] = await Promise.all([
    // Runtime context setup
    Promise.resolve(
      (() => {
        const ctx = new RuntimeContext<UserRuntimeContext>();
        ctx.set('sessionId', session.id);
        ctx.set('email', session.email);
        ctx.set('timezone', timezone);
        ctx.set('locale', locale);
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
      locale: locale,
    };
    setCachedData(cacheKey, cachedUserData);
  }

  logger.debug(`[${session.id}] Agent session initialized`);
  logger.debug(`[${session.id}] Runtime context ready`);

  // Create locale system message for AI responses
  const localeSystemMessage = createLocaleSystemMessage(locale);

  // Create concise context message with truncation
  const contextMessage = truncateContext(
    `[Context: ${formattedDateTime} ${timezone}. User: ${cachedUserData.name}. ALWAYS respond with Language locale: ${getLocaleName(locale)}]`
  );

  logger.debug(
    `[${session.id}] Locale detected: ${locale} (${getLocaleName(locale)})`
  );

  return {
    runtimeContext,
    contextMessage: {
      role: 'system',
      content: contextMessage,
    },
    locale,
    localeSystemMessage,
  };
}
