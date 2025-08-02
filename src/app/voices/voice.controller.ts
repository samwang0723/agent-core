import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Session } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import logger from '../utils/logger';
import { transcribeAudio, synthesizeSpeechStream } from './voice.service';
import { memoryPatterns } from '../../mastra/memory/memory.dto';
import { generateRequestContext } from '../conversations/conversation.service';
import { mastra } from '../../mastra';
import {
  SSEMessage,
  TranscriptMessage,
  TextMessage,
  AudioMessage,
  StatusMessage,
  ErrorMessage,
} from '../utils/sse';

type Env = {
  Variables: {
    user: Session;
  };
};

const app = new Hono<Env>();

// Memory pattern cache with TTL for optimization (reusing from conversation controller)
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
 * Text stream buffer class to handle sentence-based chunking
 */
class TextStreamBuffer {
  private buffer = '';
  private readonly sentenceEnders = ['.', '!', '?'];
  private readonly minChunkSize = 10;
  private readonly maxBufferSize = 200;

  constructor(private onSentence: (sentence: string) => void) {}

  addText(text: string) {
    this.buffer += text;
    this.processBuffer();
  }

  flush() {
    if (this.buffer.trim()) {
      this.onSentence(this.buffer.trim());
      this.buffer = '';
    }
  }

  private processBuffer() {
    while (this.buffer.length >= this.minChunkSize) {
      let sentenceEnd = -1;

      // Find the nearest sentence ender
      for (const ender of this.sentenceEnders) {
        const index = this.buffer.indexOf(ender);
        if (index !== -1 && (sentenceEnd === -1 || index < sentenceEnd)) {
          sentenceEnd = index;
        }
      }

      if (sentenceEnd !== -1) {
        // Extract complete sentence
        const sentence = this.buffer.substring(0, sentenceEnd + 1).trim();
        this.buffer = this.buffer.substring(sentenceEnd + 1);

        if (sentence) {
          this.onSentence(sentence);
        }
      } else if (this.buffer.length > this.maxBufferSize) {
        // Force process if buffer gets too large
        const lastSpace = this.buffer.lastIndexOf(' ', this.maxBufferSize);
        if (lastSpace > 0) {
          const chunk = this.buffer.substring(0, lastSpace).trim();
          this.buffer = this.buffer.substring(lastSpace + 1);

          if (chunk) {
            this.onSentence(chunk);
          }
        } else {
          break;
        }
      } else {
        break;
      }
    }
  }
}

/**
 * Creates an async iterator from text chunks that yields complete sentences
 */
async function* createSentenceIterator(textStream: ReadableStream<string>) {
  const reader = textStream.getReader();
  const sentenceQueue: string[] = [];
  let sentenceResolve: ((value: string) => void) | null = null;
  let streamComplete = false;

  const buffer = new TextStreamBuffer((sentence: string) => {
    if (sentenceResolve) {
      sentenceResolve(sentence);
      sentenceResolve = null;
    } else {
      sentenceQueue.push(sentence);
    }
  });

  // Process the text stream
  const processStream = async () => {
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer.addText(value);
      }
      buffer.flush();
    } catch (error) {
      logger.error('Error processing text stream:', error);
    } finally {
      reader.releaseLock();
      streamComplete = true;

      // Push a sentinel value to ensure the iterator exits
      if (sentenceResolve) {
        sentenceResolve('');
        sentenceResolve = null;
      } else {
        // If no one is waiting, push empty string to queue
        sentenceQueue.push('');
      }
    }
  };

  // Start processing in background
  processStream();

  // Yield sentences as they become available
  while (true) {
    if (sentenceQueue.length > 0) {
      const sentence = sentenceQueue.shift()!;
      if (!sentence && streamComplete) break; // End of stream
      if (sentence) yield sentence;
    } else if (streamComplete) {
      // Stream is complete and no more sentences
      break;
    } else {
      // Wait for next sentence
      const sentence = await new Promise<string>(resolve => {
        sentenceResolve = resolve;
      });

      if (!sentence) break; // End of stream
      yield sentence;
    }
  }
}

/**
 * @swagger
 * /api/v1/voice/realtime:
 *   post:
 *     summary: Realtime audio processing with optional text streaming - STT -> AI -> TTS streaming
 *     tags: [Voice]
 *     security:
 *       - BearerAuth: []
 *       - CookieAuth: []
 *     parameters:
 *       - name: include_text
 *         in: query
 *         description: Enable text streaming alongside audio
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *       - name: text_format
 *         in: query
 *         description: Text streaming format preference
 *         required: false
 *         schema:
 *           type: string
 *           enum: [raw, sentences, both]
 *           default: sentences
 *         description: |
 *           Format options:
 *           - raw: Stream raw text chunks as they are generated
 *           - sentences: Stream complete sentences only
 *           - both: Stream both raw chunks and complete sentences
 *       - name: include_metadata
 *         in: query
 *         description: Include sequence numbers and timing metadata
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: Audio file to transcribe
 *               engine:
 *                 type: string
 *                 description: TTS engine to use (cartesia, elevenlabs, minimax)
 *                 default: cartesia
 *     responses:
 *       200:
 *         description: Streaming response with audio and/or text
 *         content:
 *           text/event-stream:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [audio]
 *                     data:
 *                       type: string
 *                       description: Base64-encoded audio chunk
 *                     metadata:
 *                       type: object
 *                 - type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [transcript]
 *                     data:
 *                       type: string
 *                       description: Transcribed text from audio input
 *                     metadata:
 *                       type: object
 *                       properties:
 *                         char_count:
 *                           type: integer
 *                         processing_time_ms:
 *                           type: number
 *                         engine:
 *                           type: string
 *                 - type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [text]
 *                     data:
 *                       type: string
 *                       description: AI response text chunks (streaming)
 *                     metadata:
 *                       type: object
 *                       properties:
 *                         sequence:
 *                           type: integer
 *                         format:
 *                           type: string
 *                           enum: [raw, sentence]
 *                         char_count:
 *                           type: integer
 *                         is_complete_sentence:
 *                           type: boolean
 *                 - type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [status]
 *                     status:
 *                       type: string
 *                     message:
 *                       type: string
 *                 - type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [error]
 *                     error:
 *                       type: object
 *       400:
 *         description: Bad request - missing audio file
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Server error
 */
app.post('/realtime', requireAuth, async c => {
  const user = c.get('user');

  return streamSSE(c, async stream => {
    const requestStartTime = performance.now();
    const requestId = `${user.id}-${Date.now()}`;

    // Parse query parameters for streaming options
    const includeText = c.req.query('include_text') === 'true';
    // const textFormat = c.req.query('text_format') || 'sentences';
    const includeMetadata = c.req.query('include_metadata') === 'true';

    let textSequence = 0;
    let audioSequence = 0;

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

    // Text streaming callback for dual streaming
    const textStreamCallback = includeText
      ? async (text: string, format: 'sentence' | 'raw') => {
          // Filter based on text format preference
          if (format === 'sentence') {
            const message: TextMessage = {
              type: 'text',
              data: text + ' ', // Add space to ensure sentence boundaries
              timestamp: new Date().toISOString(),
              request_id: requestId,
            };

            if (includeMetadata) {
              message.metadata = {
                sequence: textSequence++,
                format: format,
                char_count: text.length,
                is_complete_sentence: false,
              };
            }

            await sendMessage(message);
          }
        }
      : undefined;

    try {
      // Parse multipart form data for audio file
      const formData = await c.req.formData();
      const audioFile = formData.get('audio') as File;
      const engine = (formData.get('engine') as string) || 'cartesia';

      if (!audioFile) {
        throw new Error('Audio file is required');
      }

      // Convert File to Buffer for transcription
      const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

      logger.info(
        `[${user.id}] Starting realtime audio processing with ${engine} engine`
      );

      // Send status: Starting transcription
      const transcriptionStartedMessage: StatusMessage = {
        type: 'status',
        status: 'transcription_started',
        message: 'Starting audio transcription',
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };
      await sendMessage(transcriptionStartedMessage);

      // Step 1: Transcribe audio to text
      const transcriptionStartTime = performance.now();
      const transcribedText = await transcribeAudio(audioBuffer);
      const transcriptionEndTime = performance.now();

      logger.info(
        `[${user.id}] Transcription took ${(transcriptionEndTime - transcriptionStartTime).toFixed(2)} ms`
      );

      if (!transcribedText.trim()) {
        throw new Error('No speech detected in audio');
      }

      logger.info(`[${user.id}] Transcribed: "${transcribedText}"`);

      // Send transcript as dedicated transcript event
      const transcriptMessage: TranscriptMessage = {
        type: 'transcript',
        data: transcribedText,
        timestamp: new Date().toISOString(),
        request_id: requestId,
        metadata: {
          char_count: transcribedText.length,
          processing_time_ms: transcriptionEndTime - transcriptionStartTime,
          engine: 'groq',
        },
      };
      await sendMessage(transcriptMessage);

      // Send status: Transcription complete
      const transcriptionCompleteMessage: StatusMessage = {
        type: 'status',
        status: 'transcription_complete',
        message: 'Audio transcription completed',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        metadata: {
          processing_time_ms: transcriptionEndTime - transcriptionStartTime,
          transcribed_length: transcribedText.length,
        },
      };
      await sendMessage(transcriptionCompleteMessage);

      // Step 2: Generate context for AI processing
      const contextStartTime = performance.now();
      const { runtimeContext, contextMessage, localeSystemMessage } =
        await generateRequestContext(user, c);
      const contextEndTime = performance.now();

      logger.info(
        `[${user.id}] Context generation took ${(contextEndTime - contextStartTime).toFixed(2)} ms`
      );

      // Step 3: Get cached memory patterns
      const { resourceId, threadId } = getCachedMemoryPatterns(user.id);

      // Send status: Starting AI processing
      const aiProcessingStartedMessage: StatusMessage = {
        type: 'status',
        status: 'ai_processing_started',
        message: 'Starting AI text generation',
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };
      await sendMessage(aiProcessingStartedMessage);

      // Step 4: Stream AI response
      const masterAgent = mastra.getAgent('masterAgent')!;
      logger.info(`[${user.id}] Using master agent for AI processing`);

      const streamResult = await masterAgent.stream(transcribedText, {
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

      const textStream = streamResult.textStream as ReadableStream<string>;

      // Send status: AI processing complete, starting TTS
      const ttsStartedMessage: StatusMessage = {
        type: 'status',
        status: 'tts_started',
        message: 'Starting text-to-speech conversion',
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };
      await sendMessage(ttsStartedMessage);

      // Step 5: Create sentence iterator and TTS stream with text streaming callback
      const sentenceIterator = createSentenceIterator(textStream);
      const ttsStream = synthesizeSpeechStream(
        sentenceIterator,
        engine,
        undefined,
        textStreamCallback
      );

      // Step 6: Stream audio chunks via SSE
      const reader = ttsStream.getReader();
      let chunkCount = 0;
      let firstAudioChunk = true;

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunkCount++;

          if (firstAudioChunk) {
            const firstAudioTime = performance.now();
            logger.info(
              `[${user.id}] First audio chunk after ${(firstAudioTime - requestStartTime).toFixed(2)} ms`
            );
            firstAudioChunk = false;
          }

          // Send audio chunk with enhanced metadata
          const base64Audio = Buffer.from(value).toString('base64');
          const audioMessage: AudioMessage = {
            type: 'audio',
            data: base64Audio,
            timestamp: new Date().toISOString(),
            request_id: requestId,
          };

          if (includeMetadata) {
            audioMessage.metadata = {
              sequence: audioSequence++,
              chunk_size: value.length,
              engine: engine,
              encoding: 'pcm_s16le',
            };
          }

          await sendMessage(audioMessage);
        }

        // Send completion signals
        const completionMessage: StatusMessage = {
          type: 'status',
          status: 'complete',
          message: 'Processing completed successfully',
          timestamp: new Date().toISOString(),
          request_id: requestId,
          metadata: {
            total_processing_time_ms: performance.now() - requestStartTime,
            audio_chunks: chunkCount,
            text_chunks: textSequence,
            engine: engine,
          },
        };
        await sendMessage(completionMessage);

        const totalTime = performance.now() - requestStartTime;
        logger.info(
          `[${user.id}] Realtime audio processing completed in ${totalTime.toFixed(2)} ms, ${chunkCount} audio chunks, ${textSequence} text chunks`
        );
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      const errorTime = performance.now();
      logger.error(
        `[${user.id}] Realtime audio error after ${(errorTime - requestStartTime).toFixed(2)} ms:`,
        error
      );

      // Send enhanced error to client
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      const errorCode = errorMessage.includes('No speech detected')
        ? 'NO_SPEECH_DETECTED'
        : errorMessage.includes('Audio file is required')
          ? 'MISSING_AUDIO_FILE'
          : errorMessage.includes('TTS')
            ? 'TTS_PROCESSING_FAILED'
            : errorMessage.includes('transcription')
              ? 'TRANSCRIPTION_FAILED'
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
          recoverable: errorCode !== 'MISSING_AUDIO_FILE',
          processing_time_ms: errorTime - requestStartTime,
        },
      };
      await sendMessage(errorSSEMessage);
    } finally {
      clearInterval(keepAliveInterval);

      const finalTime = performance.now();
      logger.info(
        `[${user.id}] Realtime audio session completed after ${(finalTime - requestStartTime).toFixed(2)} ms`
      );
    }
  });
});

export { app as realtimeAudioRouter };
