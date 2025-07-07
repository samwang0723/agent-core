import { Context } from 'hono';
import { Session } from '../middleware/auth';
import { UserRuntimeContext } from '../../mastra/utils/context';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { CoreMessage } from '@mastra/core';
import { messageHistory } from './history.service';
import logger from '../utils/logger';

export async function generateRequestMessages(
  session: Session,
  context: Context,
  message: string
): Promise<{
  runtimeContext: RuntimeContext<UserRuntimeContext>;
  messages: CoreMessage[];
}> {
  // Extract request headers for timezone detection
  const requestHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(context.req.header())) {
    requestHeaders[key.toLowerCase()] = value;
  }

  // Brings runtime context to Agent
  const runtimeContext = new RuntimeContext<UserRuntimeContext>();
  runtimeContext.set('email', session.email);
  runtimeContext.set(
    'datetime',
    (requestHeaders['x-client-datetime'] as string) || new Date().toISOString()
  );
  runtimeContext.set('timezone', requestHeaders['x-client-timezone'] as string);
  runtimeContext.set('googleAuthToken', session.accessToken || '');

  // Brings time context to Agent
  const currentDateTimePlusTimezoneInfo = `[Context: Current date and time in ${requestHeaders['x-client-timezone']} timezone: ${new Date().toLocaleString(
    'en-US',
    {
      timeZone: requestHeaders['x-client-timezone'] as string,
    }
  )}]`;

  const history = await messageHistory.getHistory(session.id, 10);

  logger.info(`[${session.id}] History: `, history);

  return {
    runtimeContext,
    messages: [
      ...history,
      {
        role: 'user',
        content: `${currentDateTimePlusTimezoneInfo} \n\n ${message}`,
      },
    ],
  };
}
