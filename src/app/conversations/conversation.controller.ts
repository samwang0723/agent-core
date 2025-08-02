import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Session } from '../middleware/auth';
import logger from '../utils/logger';
import { requireAuth } from '../middleware/auth';
import {
  SSEMessage,
  TextMessage,
  StatusMessage,
  ErrorMessage,
} from '../utils/sse';
import { mastraMemoryService } from '../../mastra/memory/memory.service';
import { memoryPatterns } from '../../mastra/memory/memory.dto';
import { messageHistory } from './history.service';
import { generateRequestContext } from './conversation.service';
import { mastra } from '../../mastra';

type Env = {
  Variables: {
    user: Session;
  };
};

const app = new Hono<Env>();
const memoryContext = mastraMemoryService;

// Memory pattern cache with TTL for optimization
const memoryPatternCache = new Map<
  string,
  { resourceId: string; threadId: string; timestamp: number }
>();
const MEMORY_CACHE_TTL = 30000; // 30 seconds

// Helper function to get cached memory patterns
function getCachedMemoryPatterns(userId: string) {
  const cacheKey = userId;
  const cached = memoryPatternCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < MEMORY_CACHE_TTL) {
    return { resourceId: cached.resourceId, threadId: cached.threadId };
  }

  const memoryStart = performance.now();
  const resourceId = memoryPatterns.getResourceId(userId);
  const threadId = memoryPatterns.getThreadId(userId);
  const memoryEnd = performance.now();

  logger.info(
    `[${userId}] Memory pattern generation took ${(memoryEnd - memoryStart).toFixed(2)} ms`
  );

  memoryPatternCache.set(cacheKey, { resourceId, threadId, timestamp: now });
  return { resourceId, threadId };
}

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
    const requestStartTime = performance.now();
    const requestId = `${user.id}-${Date.now()}`;

    let textSequence = 0;

    // Send SSE prelude immediately to establish connection
    await stream.write(':\n\n');

    // Keep-alive mechanism
    const keepAliveInterval = setInterval(async () => {
      try {
        await stream.write(': keep-alive\n\n');
      } catch (error) {
        logger.error('Error writing keep-alive:', error);
        clearInterval(keepAliveInterval);
      }
    }, 500);

    // Helper function to send SSE messages with proper formatting
    const sendMessage = async (message: SSEMessage) => {
      await stream.write(`data: ${JSON.stringify(message)}\n\n`);
    };

    try {
      if (!message) {
        throw new Error('Message is required');
      }

      // Send status: Starting processing
      const startMessage: StatusMessage = {
        type: 'status',
        status: 'processing_started',
        message: 'Starting message processing',
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };
      await sendMessage(startMessage);

      // Detailed timing instrumentation
      const contextStartTime = performance.now();
      const { runtimeContext, contextMessage, locale, localeSystemMessage } =
        await generateRequestContext(user, c);
      const contextEndTime = performance.now();
      logger.info(
        `[${user.id}] Context generation took ${(contextEndTime - contextStartTime).toFixed(2)} ms`
      );

      // Get cached memory patterns for optimization
      const { resourceId, threadId } = getCachedMemoryPatterns(user.id);

      // This will hold the stream of text chunks, unified from different sources.
      logger.info(`[${user.id}] Agent: Using agent (locale: ${locale})`);

      // Send status: AI processing started
      const aiProcessingMessage: StatusMessage = {
        type: 'status',
        status: 'ai_processing_started',
        message: 'Starting AI text generation',
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };
      await sendMessage(aiProcessingMessage);

      const masterAgent = mastra.getAgent('masterAgent')!;
      const agentStreamStartTime = performance.now();
      const streamResult = await masterAgent.stream(message, {
        resourceId,
        threadId,
        maxRetries: 1,
        maxSteps: 5,
        maxTokens: 1024,
        onFinish: () => {
          const totalDuration = performance.now() - requestStartTime;
          logger.info(
            `[${user.id}] Agent: Total stream took ${totalDuration.toFixed(2)} ms`
          );
        },
        runtimeContext,
        context: [
          { role: 'system', content: localeSystemMessage },
          contextMessage,
        ],
      });
      const agentStreamEndTime = performance.now();
      logger.info(
        `[${user.id}] Agent stream setup took ${(agentStreamEndTime - agentStreamStartTime).toFixed(2)} ms`
      );

      const textStream = streamResult.textStream as ReadableStream<string>;

      let chunkCount = 0;
      let firstChunkReceived = false;

      // Consume the stream and feed to SSE output
      for await (const chunk of textStream) {
        chunkCount++;

        if (!firstChunkReceived) {
          const firstChunkTime = performance.now();
          logger.info(
            `[${user.id}] Time to first chunk: ${(firstChunkTime - requestStartTime).toFixed(2)} ms`
          );
          firstChunkReceived = true;
        }

        try {
          // Send text chunk as structured message
          const textMessage: TextMessage = {
            type: 'text',
            data: chunk,
            timestamp: new Date().toISOString(),
            request_id: requestId,
            metadata: {
              sequence: textSequence++,
              format: 'raw',
              char_count: chunk.length,
              is_complete_sentence: false,
            },
          };
          await sendMessage(textMessage);

          if (process.env.ENABLE_PERFORMANCE_LOGGING === 'true') {
            logger.debug(
              `[${user.id}] Processed chunk ${chunkCount}, size: ${chunk.length} chars`
            );
          }
        } catch (chunkError) {
          logger.error(
            `[${user.id}] Error processing chunk ${chunkCount}:`,
            chunkError
          );
          // Continue processing remaining chunks for graceful degradation
        }
      }

      // Send completion message
      const completionMessage: StatusMessage = {
        type: 'status',
        status: 'complete',
        message: 'Processing completed successfully',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        metadata: {
          total_processing_time_ms: performance.now() - requestStartTime,
          text_chunks: textSequence,
        },
      };
      await sendMessage(completionMessage);

      const totalProcessingTime = performance.now() - requestStartTime;
      logger.info(
        `[${user.id}] Total request processing time: ${totalProcessingTime.toFixed(2)} ms, chunks: ${chunkCount}`
      );
    } catch (error) {
      const errorTime = performance.now();
      logger.error(
        `[${user.id}] Error during streaming chat at ${(errorTime - requestStartTime).toFixed(2)} ms:`,
        error
      );

      // Send structured error message
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      const errorCode = errorMessage.includes('Message is required')
        ? 'MISSING_MESSAGE'
        : errorMessage.includes('Context')
          ? 'CONTEXT_GENERATION_FAILED'
          : errorMessage.includes('Agent')
            ? 'AI_PROCESSING_FAILED'
            : 'UNKNOWN_ERROR';

      const errorSSEMessage: ErrorMessage = {
        type: 'error',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        error: {
          code: errorCode,
          message: errorMessage,
          timestamp: new Date().toISOString(),
          request_id: requestId,
          recoverable: errorCode !== 'MISSING_MESSAGE',
          processing_time_ms: errorTime - requestStartTime,
        },
      };
      await sendMessage(errorSSEMessage);

      await new Promise(resolve => setTimeout(resolve, 500));
    } finally {
      clearInterval(keepAliveInterval);

      const finalTime = performance.now();
      logger.info(
        `[${user.id}] Stream session completed after ${(finalTime - requestStartTime).toFixed(2)} ms`
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

  if (!message) {
    return c.json({ error: 'Message is required' }, 400);
  }

  const requestStartTime = performance.now();

  // Context generation with timing
  const contextStartTime = performance.now();
  const { runtimeContext, contextMessage, localeSystemMessage } =
    await generateRequestContext(user, c);
  const contextEndTime = performance.now();
  logger.info(
    `[${user.id}] Context generation took ${(contextEndTime - contextStartTime).toFixed(2)} ms`
  );
  logger.info(`[${user.id}] Agent: Context Message: ${contextMessage.content}`);

  // Get cached memory patterns
  const { resourceId, threadId } = getCachedMemoryPatterns(user.id);
  try {
    const masterAgent = mastra.getAgent('masterAgent')!;
    const generateStartTime = performance.now();
    const response = await masterAgent.generate(message, {
      resourceId,
      threadId,
      maxRetries: 1,
      maxSteps: 5,
      maxTokens: 1024,
      runtimeContext,
      context: [
        { role: 'system', content: localeSystemMessage },
        contextMessage,
      ],
    });
    const generateEndTime = performance.now();
    const totalDuration = generateEndTime - requestStartTime;
    logger.info(
      `[${user.id}] Agent generate took ${(generateEndTime - generateStartTime).toFixed(2)} ms, total: ${totalDuration.toFixed(2)} ms`
    );

    return c.json({
      response: response.text,
      userId: user.id,
    });
  } catch (error) {
    const errorTime = performance.now();
    const totalDuration = errorTime - requestStartTime;
    logger.error(
      `[${user.id}] Error in non-streaming chat after ${totalDuration.toFixed(2)} ms:`,
      error
    );

    return c.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
        userId: user.id,
      },
      500
    );
  }
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
