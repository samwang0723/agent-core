import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Session } from '../middleware/auth';
import logger from '../utils/logger';
import { requireAuth } from '../middleware/auth';
import { HonoSSEOutput } from './conversation.dto';
import { optimizedIntentDetection } from '../intents/intent.service';

type Env = {
  Variables: {
    user: Session;
  };
};

const app = new Hono<Env>();

/**
 * @swagger
 * /api/v1/chat/stream:
 *   post:
 *     summary: Send message with streaming response (SSE) for authenticated user
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *       - CookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 description: The user message
 *             required:
 *               - message
 *     responses:
 *       200:
 *         description: Streaming response
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       400:
 *         description: Bad request - invalid message
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Server error
 */
app.post('/stream', requireAuth, async c => {
  const user = c.get('user');
  const { message } = await c.req.json();

  if (!message || typeof message !== 'string') {
    return c.json({ error: 'Message is required and must be a string' }, 400);
  }

  // Extract request headers for timezone detection
  const requestHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(c.req.header())) {
    requestHeaders[key.toLowerCase()] = value;
  }

  // Debug logging to see what headers we're receiving
  logger.debug('=== REQUEST HEADERS DEBUG ===');
  logger.debug('All headers:', JSON.stringify(requestHeaders, null, 2));
  logger.debug(
    'X-Client-Timezone header:',
    requestHeaders['x-client-timezone']
  );
  logger.debug(
    'X-Client-Datetime header:',
    requestHeaders['x-client-datetime']
  );
  logger.debug('X-Forwarded-For header:', requestHeaders['x-forwarded-for']);
  logger.debug('X-Real-IP header:', requestHeaders['x-real-ip']);
  logger.debug('============================');

  const result = await optimizedIntentDetection(message);

  return streamSSE(c, async stream => {
    // Create SSE output strategy
    const sseOutput = new HonoSSEOutput(stream, user.id);

    try {
      sseOutput.onStart?.({ sessionId: user.id, streaming: true });

      // If an agent is found, stream the response from the agent
      if (result.suitableAgent) {
        const agentStream = await result.suitableAgent.stream([
          { role: 'user', content: message },
        ]);

        let accumulated = '';

        // Consume the stream and feed to SSE output
        for await (const chunk of agentStream.textStream) {
          accumulated += chunk;
          sseOutput.onChunk(chunk, accumulated);
        }
      } else {
        const noAgentResponse = 'No suitable agent found';
        sseOutput.onChunk(noAgentResponse, noAgentResponse);
      }

      sseOutput.onFinish?.({ complete: true, sessionId: user.id });
    } catch (error) {
      logger.error('Error during streaming chat:', error);
      sseOutput.onError(
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  });
});

/**
 * @swagger
 * /api/v1/chat:
 *   post:
 *     summary: Send message with regular JSON response for authenticated user
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *       - CookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 description: The user message
 *             required:
 *               - message
 *     responses:
 *       200:
 *         description: The full response from the agent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:
 *                   type: string
 *                 cost:
 *                   type: number
 *                 tokens:
 *                   type: integer
 *                 userId:
 *                   type: string
 *       400:
 *         description: Bad request - invalid message
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Server error
 */
app.post('/', requireAuth, async c => {
  const user = c.get('user');
  const { message } = await c.req.json();

  if (!message || typeof message !== 'string') {
    return c.json({ error: 'Message is required and must be a string' }, 400);
  }

  // Extract request headers for timezone detection
  const requestHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(c.req.header())) {
    requestHeaders[key.toLowerCase()] = value;
  }

  const result = await optimizedIntentDetection(message);
  if (result.suitableAgent) {
    const response = await result.suitableAgent.generate([
      { role: 'user', content: message },
    ]);
    return c.json({
      response: response.text,
      userId: user.id,
    });
  }

  return c.json({
    response: 'No suitable agent found',
    userId: user.id,
  });
});

/**
 * @swagger
 * /api/v1/chat/history:
 *   get:
 *     summary: Get chat history for authenticated user
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *       - CookieAuth: []
 *     responses:
 *       200:
 *         description: Chat history retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                 messageCount:
 *                   type: integer
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized - authentication required
 */
app.get('/history', requireAuth, async c => {
  const user = c.get('user');

  return c.json({
    userId: user.id,
    messageCount: 0,
    messages: [],
  });
});

/**
 * @swagger
 * /api/v1/chat/init:
 *   post:
 *     summary: Initialize the chat swarm for the user session
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *       - CookieAuth: []
 *     responses:
 *       200:
 *         description: Swarm initialized successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized - authentication required
 */
app.post('/init', requireAuth, c => {
  return c.json({ success: true, message: 'Agent initialized' });
});

export { app as chatRouter };
