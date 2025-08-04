import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Session } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import logger from '../utils/logger';
import { transcribeAudio, synthesizeSpeechStream } from './voice.service';
import { memoryPatterns } from '../../mastra/memory/memory.dto';
import { generateRequestContext } from '../conversations/conversation.service';
import { mastra } from '../../mastra';
import { SSEMessage, SSEHelper } from '../utils/sse';

type Env = {
  Variables: {
    user: Session;
  };
};

const app = new Hono<Env>();

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
  const iteratorStartTime = performance.now();
  logger.debug('createSentenceIterator starting');

  const reader = textStream.getReader();
  const sentenceQueue: string[] = [];
  let sentenceResolve: ((value: string) => void) | null = null;
  let streamComplete = false;
  let sentenceCount = 0;

  const buffer = new TextStreamBuffer((sentence: string) => {
    sentenceCount++;
    const now = performance.now();
    logger.debug(
      `Sentence ${sentenceCount} processed after ${(now - iteratorStartTime).toFixed(2)} ms: "${sentence.substring(0, 50)}..."`
    );

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
      let streamChunkCount = 0;
      logger.debug('Starting text stream processing');

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const readStartTime = performance.now();
        const { done, value } = await reader.read();
        const readEndTime = performance.now();

        streamChunkCount++;
        if (streamChunkCount === 1) {
          logger.debug(
            `First text stream read took ${(readEndTime - readStartTime).toFixed(2)} ms`
          );
        }

        if (done) break;
        buffer.addText(value);
      }

      logger.debug(
        `Text stream processing complete - ${streamChunkCount} chunks processed`
      );
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
  let yieldCount = 0;
  while (true) {
    if (sentenceQueue.length > 0) {
      const sentence = sentenceQueue.shift()!;
      if (!sentence && streamComplete) break; // End of stream
      if (sentence) {
        yieldCount++;
        const yieldTime = performance.now();
        logger.debug(
          `Yielding sentence ${yieldCount} after ${(yieldTime - iteratorStartTime).toFixed(2)} ms`
        );
        yield sentence;
      }
    } else if (streamComplete) {
      // Stream is complete and no more sentences
      break;
    } else {
      // Wait for next sentence
      const waitStartTime = performance.now();
      const sentence = await new Promise<string>(resolve => {
        sentenceResolve = resolve;
      });
      const waitEndTime = performance.now();

      if (yieldCount === 0) {
        logger.debug(
          `First sentence wait took ${(waitEndTime - waitStartTime).toFixed(2)} ms`
        );
      }

      if (!sentence) break; // End of stream
      yieldCount++;
      const yieldTime = performance.now();
      logger.debug(
        `Yielding sentence ${yieldCount} after ${(yieldTime - iteratorStartTime).toFixed(2)} ms`
      );
      yield sentence;
    }
  }

  const iteratorEndTime = performance.now();
  logger.debug(
    `createSentenceIterator completed in ${(iteratorEndTime - iteratorStartTime).toFixed(2)} ms, yielded ${yieldCount} sentences`
  );
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
 *                 description: TTS engine to use (cartesia, elevenlabs, cartesiachinese)
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
    const includeMetadata = c.req.query('include_metadata') === 'true';

    let textSequence = 0;
    let audioSequence = 0;

    // Send SSE prelude immediately to establish connection
    await SSEHelper.sendPrelude(stream);

    // Keep-alive mechanism with enhanced logging
    const keepAliveInterval = SSEHelper.createKeepAliveInterval(
      stream,
      500,
      logger,
      user.id
    );

    // Session management for lifecycle tracking
    const sessionManager = SSEHelper.createSessionManager(
      user.id,
      '/voice/realtime',
      logger
    );

    // Helper function to send SSE messages with proper formatting and tracking
    const sendMessage = async (message: SSEMessage) => {
      await SSEHelper.sendMessage(stream, message);
      sessionManager.trackMessage(message.type);
    };

    // Text streaming callback for dual streaming
    const textStreamCallback = includeText
      ? async (text: string, format: 'sentence' | 'raw') => {
          // Filter based on text format preference
          if (format === 'sentence') {
            const metadata = includeMetadata
              ? {
                  sequence: textSequence++,
                  format: format,
                  char_count: text.length,
                  is_complete_sentence: false,
                }
              : undefined;

            const message = SSEHelper.createTextMessage(
              requestId,
              text + ' ', // Add space to ensure sentence boundaries
              metadata
            );

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
      const transcriptionStartedMessage = SSEHelper.createStatusMessage(
        requestId,
        'transcription_started',
        'Starting audio transcription'
      );
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
      const transcriptMessage = SSEHelper.createTranscriptMessage(
        requestId,
        transcribedText,
        {
          char_count: transcribedText.length,
          processing_time_ms: transcriptionEndTime - transcriptionStartTime,
          engine: 'groq',
        }
      );
      await sendMessage(transcriptMessage);

      // Send status: Transcription complete
      const transcriptionCompleteMessage = SSEHelper.createStatusMessage(
        requestId,
        'transcription_complete',
        'Audio transcription completed',
        {
          processing_time_ms: transcriptionEndTime - transcriptionStartTime,
          transcribed_length: transcribedText.length,
        }
      );
      await sendMessage(transcriptionCompleteMessage);

      // Step 2: Generate context for AI processing
      const contextStartTime = performance.now();
      const { runtimeContext, contextMessage, localeSystemMessage } =
        await generateRequestContext(user, c);
      const contextEndTime = performance.now();

      logger.info(
        `[${user.id}] Context generation took ${(contextEndTime - contextStartTime).toFixed(2)} ms`
      );

      // Step 3: Get memory patterns thread/resource key
      const resourceId = memoryPatterns.getResourceId(user.id);
      const threadId = memoryPatterns.getThreadId(requestId);

      // Send status: Starting AI processing
      const aiProcessingStartedMessage = SSEHelper.createStatusMessage(
        requestId,
        'ai_processing_started',
        'Starting AI text generation'
      );
      await sendMessage(aiProcessingStartedMessage);

      // Step 4: Stream AI response
      const masterAgent = mastra.getAgent('masterAgent')!;
      logger.info(`[${user.id}] Using master agent for AI processing`);
      const startTime = Date.now();
      const streamResult = await masterAgent.stream(transcribedText, {
        resourceId,
        threadId,
        maxRetries: 1,
        maxSteps: 2,
        maxTokens: 128,
        runtimeContext,
        context: [
          { role: 'system', content: localeSystemMessage },
          contextMessage,
        ],
      });
      const endTime = Date.now();
      const duration = endTime - startTime;
      logger.debug(`[${user.id}] AI processing took ${duration}ms`);

      const textStream = streamResult.textStream as ReadableStream<string>;

      // Send status: AI processing complete, starting TTS
      const ttsStartedMessage = SSEHelper.createStatusMessage(
        requestId,
        'tts_started',
        'Starting text-to-speech conversion'
      );
      await sendMessage(ttsStartedMessage);

      // Step 5: Create sentence iterator and TTS stream with text streaming callback
      const sentenceIteratorStartTime = performance.now();
      const sentenceIterator = createSentenceIterator(textStream);
      const sentenceIteratorEndTime = performance.now();
      logger.debug(
        `[${user.id}] Sentence iterator creation took ${(sentenceIteratorEndTime - sentenceIteratorStartTime).toFixed(2)} ms`
      );

      const ttsStreamStartTime = performance.now();
      const ttsStream = synthesizeSpeechStream(
        sentenceIterator,
        engine,
        undefined,
        textStreamCallback
      );
      const ttsStreamEndTime = performance.now();
      logger.debug(
        `[${user.id}] TTS stream setup took ${(ttsStreamEndTime - ttsStreamStartTime).toFixed(2)} ms`
      );

      // Step 6: Stream audio chunks via SSE
      const reader = ttsStream.getReader();
      let chunkCount = 0;
      let firstAudioChunk = true;

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const readStartTime = performance.now();
          const { done, value } = await reader.read();
          const readEndTime = performance.now();

          if (firstAudioChunk) {
            logger.debug(
              `[${user.id}] First reader.read() took ${(readEndTime - readStartTime).toFixed(2)} ms`
            );
          }

          if (done) break;

          chunkCount++;

          if (firstAudioChunk) {
            const firstAudioTime = performance.now();
            logger.debug(
              `[${user.id}] First audio chunk (before processing) after ${(firstAudioTime - requestStartTime).toFixed(2)} ms`
            );
          }

          // Send audio chunk with enhanced metadata
          const base64StartTime = performance.now();
          const base64Audio = Buffer.from(value).toString('base64');
          const base64EndTime = performance.now();

          if (firstAudioChunk) {
            logger.debug(
              `[${user.id}] Base64 encoding took ${(base64EndTime - base64StartTime).toFixed(2)} ms`
            );
          }

          const metadata = includeMetadata
            ? {
                sequence: audioSequence++,
                chunk_size: value.length,
                engine: engine,
                encoding: 'pcm_s16le',
              }
            : undefined;

          const messageCreateStartTime = performance.now();
          const audioMessage = SSEHelper.createAudioMessage(
            requestId,
            base64Audio,
            metadata
          );
          const messageCreateEndTime = performance.now();

          if (firstAudioChunk) {
            logger.debug(
              `[${user.id}] Audio message creation took ${(messageCreateEndTime - messageCreateStartTime).toFixed(2)} ms`
            );
          }

          const sendStartTime = performance.now();
          await sendMessage(audioMessage);
          const sendEndTime = performance.now();

          if (firstAudioChunk) {
            logger.debug(
              `[${user.id}] First audio chunk send took ${(sendEndTime - sendStartTime).toFixed(2)} ms`
            );
            logger.debug(
              `[${user.id}] First audio chunk (sent) after ${(sendEndTime - requestStartTime).toFixed(2)} ms`
            );
            firstAudioChunk = false;
          }
        }

        // Send completion signals
        const completionMessage = SSEHelper.createStatusMessage(
          requestId,
          'complete',
          'Processing completed successfully',
          {
            total_processing_time_ms: performance.now() - requestStartTime,
            audio_chunks: chunkCount,
            text_chunks: textSequence,
            engine: engine,
          }
        );
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
      const errorCode = SSEHelper.determineErrorCode(errorMessage);

      const errorSSEMessage = SSEHelper.createErrorMessage(
        requestId,
        errorMessage,
        errorCode,
        errorCode !== 'MISSING_AUDIO_FILE',
        errorTime - requestStartTime
      );
      await sendMessage(errorSSEMessage);
    } finally {
      clearInterval(keepAliveInterval);

      // End session tracking
      sessionManager.end();

      const finalTime = performance.now();
      logger.info(
        `[${user.id}] Realtime audio session completed after ${(finalTime - requestStartTime).toFixed(2)} ms`
      );
    }
  });
});

export { app as realtimeAudioRouter };
