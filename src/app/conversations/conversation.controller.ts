import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Session } from '../middleware/auth';
import logger from '../utils/logger';
import { requireAuth } from '../middleware/auth';
import { HonoSSEOutput } from './conversation.dto';
import { optimizedIntentDetection } from '../intents/intent.service';
import { mastraMemoryService } from '../../mastra/memory/memory.service';
import { memoryPatterns } from '../../mastra/memory/memory.dto';
import { messageHistory } from './history.service';
import { generateRequestMessages } from './conversation.service';

type Env = {
  Variables: {
    user: Session;
  };
};

const app = new Hono<Env>();
const memoryContext = mastraMemoryService;

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

  return streamSSE(c, async stream => {
    const sseOutput = new HonoSSEOutput(stream, user.id);
    try {
      sseOutput.onStart?.({ sessionId: user.id, streaming: true });

      if (!message || typeof message !== 'string') {
        throw new Error('Message is required and must be a string');
      }

      const result = await optimizedIntentDetection(message);
      logger.info(`[${user.id}] Agent: Intent Result: `, result);

      // If an agent is found, stream the response from the agent
      if (result.suitableAgent) {
        const startTime = Date.now();
        const { runtimeContext, messages } = await generateRequestMessages(
          user,
          c,
          message
        );
        const agentStream = await result.suitableAgent.stream(messages, {
          resourceId: memoryPatterns.getResourceId(user.id),
          threadId: memoryPatterns.getThreadId(user.id),
          maxRetries: 1,
          maxSteps: 10,
          maxTokens: 800,
          onFinish: () => {
            const duration = Date.now() - startTime;
            logger.info(`[${user.id}] Agent: Stream took ${duration} ms`);
          },
          runtimeContext,
        });

        let accumulated = '';

        // Consume the stream and feed to SSE output
        for await (const chunk of agentStream.textStream) {
          if (accumulated.length === 0) {
            const duration = Date.now() - startTime;
            logger.info(
              `[${user.id}] Agent: Time to first chunk took ${duration} ms`
            );
          }
          accumulated += chunk;
          sseOutput.onChunk(chunk, accumulated);
        }
      } else {
        throw new Error('No suitable agent found');
      }
    } catch (error) {
      logger.error('Error during streaming chat:', error);
      sseOutput.onError(
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
      await new Promise(resolve => setTimeout(resolve, 500));
    } finally {
      sseOutput.onFinish?.({ complete: true, sessionId: user.id });
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

  const result = await optimizedIntentDetection(message);
  if (result.suitableAgent) {
    const startTime = Date.now();
    const { runtimeContext, messages } = await generateRequestMessages(
      user,
      c,
      message
    );

    const response = await result.suitableAgent.generate(messages, {
      resourceId: memoryPatterns.getResourceId(user.id),
      threadId: memoryPatterns.getThreadId(user.id),
      maxRetries: 0,
      maxSteps: 10,
      maxTokens: 800,
      runtimeContext,
    });
    const duration = Date.now() - startTime;
    logger.info(`[${user.id}] Agent: Generate took ${duration} ms`);

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
  const history = await messageHistory.getHistory(user.id, 10);

  return c.json({
    userId: user.id,
    messageCount: history.length,
    messages: history,
  });
});

/**
 * @swagger
 * /api/v1/chat/history:
 *   delete:
 *     summary: Clear chat history for authenticated user
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *       - CookieAuth: []
 *     responses:
 *       200:
 *         description: History cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 userId:
 *                   type: string
 *       401:
 *         description: Unauthorized - authentication required
 */
app.delete('/history', requireAuth, c => {
  const user = c.get('user');
  messageHistory.clearHistory(user.id);
  return c.json({ message: 'History cleared', userId: user.id });
});

/**
 * @swagger
 * /api/v1/chat/init:
 *   post:
 *     summary: Initialize the chat memory for the user session
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *       - CookieAuth: []
 *     responses:
 *       200:
 *         description: Memory initialized successfully
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
app.post('/init', requireAuth, async c => {
  const user = c.get('user');
  await memoryContext.initializeUserMemory(user.id, 'userProfile');
  return c.json({ success: true, message: 'Agent initialized' });
});

export { app as chatRouter };
