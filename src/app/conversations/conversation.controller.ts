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
    const sseOutput = new HonoSSEOutput(stream, user.id);

    // Send SSE prelude immediately to establish connection
    await stream.write(':\n\n');

    // Keep-alive mechanism
    const keepAliveInterval = setInterval(async () => {
      try {
        await stream.write(': keep-alive\n\n');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        clearInterval(keepAliveInterval);
      }
    }, 500);

    try {
      sseOutput.onStart?.({ sessionId: user.id, streaming: true });

      if (!message || typeof message !== 'string') {
        throw new Error('Message is required and must be a string');
      }

      // Detailed timing instrumentation
      const contextStartTime = performance.now();
      const { runtimeContext, contextMessage } = await generateRequestContext(
        user,
        c
      );
      const contextEndTime = performance.now();
      logger.info(
        `[${user.id}] Context generation took ${(contextEndTime - contextStartTime).toFixed(2)} ms`
      );

      const usingVNextNetwork =
        process.env.MASTRA_USING_VNEXT_NETWORK === 'true';

      // Get cached memory patterns for optimization
      const { resourceId, threadId } = getCachedMemoryPatterns(user.id);

      // This will hold the stream of text chunks, unified from different sources.
      let textStream: ReadableStream<string>;
      if (usingVNextNetwork) {
        const networkStartTime = performance.now();
        const network = mastra.vnext_getNetwork('orchestrator-network')!;
        const networkEndTime = performance.now();
        logger.info(
          `[${user.id}] vNext network retrieval took ${(networkEndTime - networkStartTime).toFixed(2)} ms`
        );

        logger.info(`[${user.id}] Agent: Using vNext network`);

        const streamStartTime = performance.now();
        const networkResult = await network.stream(
          `${contextMessage.content} ${message}`,
          {
            resourceId,
            threadId,
            runtimeContext,
          }
        );
        const streamEndTime = performance.now();
        logger.info(
          `[${user.id}] Network stream setup took ${(streamEndTime - streamStartTime).toFixed(2)} ms`
        );

        // Adapt Mastra vNext stream to a simple text stream - OPTIMIZED VERSION
        const reader = (
          networkResult.stream as ReadableStream<{
            type: string;
            argsTextDelta?: string;
          }>
        ).getReader();

        textStream = new ReadableStream<string>({
          async start(controller) {
            let firstChunkTime: number | null = null;
            try {
              let done = false;
              while (!done) {
                const chunkStartTime = performance.now();
                const result = await reader.read();
                done = result.done;

                if (!done && result.value?.argsTextDelta) {
                  if (firstChunkTime === null) {
                    firstChunkTime = performance.now();
                    logger.info(
                      `[${user.id}] First chunk received after ${(firstChunkTime - requestStartTime).toFixed(2)} ms`
                    );
                  }

                  const chunkEndTime = performance.now();
                  if (process.env.ENABLE_PERFORMANCE_LOGGING === 'true') {
                    logger.debug(
                      `[${user.id}] Chunk processing took ${(chunkEndTime - chunkStartTime).toFixed(2)} ms`
                    );
                  }

                  // Minimize latency by immediately enqueuing
                  controller.enqueue(result.value.argsTextDelta);
                }
              }
              controller.close();
            } catch (error) {
              logger.error(`[${user.id}] Stream error:`, error);
              // Graceful error recovery - try to provide partial response
              if (firstChunkTime !== null) {
                controller.enqueue(
                  '\n\n[Response was interrupted due to an error]'
                );
              }
              controller.error(error);
            } finally {
              reader.releaseLock();
            }
          },
        });
      } else {
        // NOTE: This is the old way of doing it. intent detection may not be accurate
        // to determine which agent to use based on random conversation.
        // We should use the vNext network for this.
        const intentStartTime = performance.now();
        const result = await optimizedIntentDetection(message);
        const intentEndTime = performance.now();
        logger.info(
          `[${user.id}] Intent detection took ${(intentEndTime - intentStartTime).toFixed(2)} ms`
        );
        logger.info(`[${user.id}] Agent: Intent Result: `, result);
        logger.info(`[${user.id}] Agent: Using agent`);

        const agentStreamStartTime = performance.now();
        const streamResult = await result.suitableAgent!.stream(message, {
          resourceId,
          threadId,
          maxRetries: 1,
          maxSteps: 10,
          maxTokens: 800,
          onFinish: () => {
            const totalDuration = performance.now() - requestStartTime;
            logger.info(
              `[${user.id}] Agent: Total stream took ${totalDuration.toFixed(2)} ms`
            );
          },
          runtimeContext,
          context: [contextMessage],
        });
        const agentStreamEndTime = performance.now();
        logger.info(
          `[${user.id}] Agent stream setup took ${(agentStreamEndTime - agentStreamStartTime).toFixed(2)} ms`
        );

        textStream = streamResult.textStream as ReadableStream<string>;
      }

      let accumulated = '';
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

        accumulated += chunk;

        try {
          sseOutput.onChunk(chunk, accumulated);

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

      // Enhanced error recovery with partial response capability
      try {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        sseOutput.onError(errorMessage);

        // Provide diagnostic information in development
        if (process.env.NODE_ENV === 'development') {
          await stream.write(
            `data: {"error": "${errorMessage}", "timestamp": ${errorTime}}\n\n`
          );
        }
      } catch (errorHandlingError) {
        logger.error(
          `[${user.id}] Error in error handling:`,
          errorHandlingError
        );
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    } finally {
      clearInterval(keepAliveInterval);

      const finalTime = performance.now();
      logger.info(
        `[${user.id}] Stream session completed after ${(finalTime - requestStartTime).toFixed(2)} ms`
      );

      try {
        sseOutput.onFinish?.({ complete: true, sessionId: user.id });
      } catch (finishError) {
        logger.error(`[${user.id}] Error in finish handler:`, finishError);
      }
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

  const requestStartTime = performance.now();

  // Context generation with timing
  const contextStartTime = performance.now();
  const { runtimeContext, contextMessage } = await generateRequestContext(
    user,
    c
  );
  const contextEndTime = performance.now();
  logger.info(
    `[${user.id}] Context generation took ${(contextEndTime - contextStartTime).toFixed(2)} ms`
  );
  logger.info(`[${user.id}] Agent: Context Message: ${contextMessage.content}`);

  // Get cached memory patterns
  const { resourceId, threadId } = getCachedMemoryPatterns(user.id);

  const usingVNextNetwork = process.env.MASTRA_USING_VNEXT_NETWORK === 'true';

  try {
    if (usingVNextNetwork) {
      const networkStartTime = performance.now();
      const network = mastra.vnext_getNetwork('orchestrator-network')!;
      const networkEndTime = performance.now();
      logger.info(
        `[${user.id}] vNext network retrieval took ${(networkEndTime - networkStartTime).toFixed(2)} ms`
      );

      logger.info(
        `[${user.id}] Agent: Using vNext network: ${contextMessage.content} ${message}`
      );

      const generateStartTime = performance.now();
      const response = await network.generate(
        `${contextMessage.content} ${message}`,
        {
          resourceId,
          threadId,
          runtimeContext,
        }
      );
      const generateEndTime = performance.now();
      const totalDuration = generateEndTime - requestStartTime;
      logger.info(
        `[${user.id}] vNext generate took ${(generateEndTime - generateStartTime).toFixed(2)} ms, total: ${totalDuration.toFixed(2)} ms`
      );

      return c.json({
        response: response.result,
        userId: user.id,
      });
    } else {
      const intentStartTime = performance.now();
      const result = await optimizedIntentDetection(message);
      const intentEndTime = performance.now();
      logger.info(
        `[${user.id}] Intent detection took ${(intentEndTime - intentStartTime).toFixed(2)} ms`
      );

      if (result.suitableAgent) {
        const generateStartTime = performance.now();
        const response = await result.suitableAgent.generate(message, {
          resourceId,
          threadId,
          maxRetries: 0,
          maxSteps: 10,
          maxTokens: 800,
          runtimeContext,
          context: [contextMessage],
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
      }
    }

    const totalDuration = performance.now() - requestStartTime;
    logger.info(
      `[${user.id}] No suitable agent found, total time: ${totalDuration.toFixed(2)} ms`
    );

    return c.json({
      response: 'No suitable agent found',
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
