import { Context } from 'hono';
import { Session } from '../middleware/auth';
import { UserRuntimeContext } from '../../mastra/utils/context';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { CoreMessage } from '@mastra/core';
import logger from '../utils/logger';

export async function generateRequestContext(
  session: Session,
  context: Context
): Promise<{
  runtimeContext: RuntimeContext<UserRuntimeContext>;
  contextMessage: CoreMessage;
}> {
  // Extract request headers for timezone detection
  const requestHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(context.req.header())) {
    requestHeaders[key.toLowerCase()] = value;
  }

  // Brings runtime context to Agent
  const runtimeContext = new RuntimeContext<UserRuntimeContext>();
  runtimeContext.set('sessionId', session.id);
  runtimeContext.set('email', session.email);
  runtimeContext.set('timezone', requestHeaders['x-client-timezone'] as string);
  runtimeContext.set(
    'datetime',
    new Date().toLocaleString('en-US', {
      timeZone: requestHeaders['x-client-timezone'] as string,
    })
  );
  runtimeContext.set('googleAuthToken', session.accessToken || '');
  logger.debug(`[${session.id}] ============= Agent: session: `, session);
  logger.debug(
    `[${session.id}] ============= Agent: runtimeContext: ${runtimeContext.get('googleAuthToken')}`
  );

  // Brings time context to Agent
  const contextMessage = `[Context: Current date and time in ${requestHeaders['x-client-timezone']} timezone: ${new Date().toLocaleString(
    'en-US',
    {
      timeZone: requestHeaders['x-client-timezone'] as string,
    }
  )}. User name: ${session.name}]`;

  return {
    runtimeContext,
    contextMessage: {
      role: 'system',
      content: `${contextMessage}`,
    },
  };
}
