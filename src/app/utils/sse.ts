import { SSEStreamingApi } from 'hono/streaming';
import { CustomLogger } from './logger';

// SSE Message Types
interface BaseSSEMessage {
  type: string;
  timestamp: string;
  request_id: string;
}

interface TranscriptMessage extends BaseSSEMessage {
  type: 'transcript';
  data: string;
  metadata: {
    char_count: number;
    processing_time_ms: number;
    engine: string;
  };
}

interface TextMessage extends BaseSSEMessage {
  type: 'text';
  data: string;
  metadata?: {
    sequence: number;
    format: 'sentence' | 'raw';
    char_count: number;
    is_complete_sentence: boolean;
  };
}

interface AudioMessage extends BaseSSEMessage {
  type: 'audio';
  data: string;
  metadata?: {
    sequence: number;
    chunk_size: number;
    engine: string;
    encoding: string;
  };
}

interface StatusMessage extends BaseSSEMessage {
  type: 'status';
  status: string;
  message: string;
  metadata?: {
    processing_time_ms?: number;
    transcribed_length?: number;
    total_processing_time_ms?: number;
    audio_chunks?: number;
    text_chunks?: number;
    engine?: string;
  };
}

interface ErrorMessage extends BaseSSEMessage {
  type: 'error';
  error: {
    code: string;
    message: string;
    timestamp: string;
    request_id: string;
    recoverable: boolean;
    processing_time_ms: number;
  };
}

type SSEMessage =
  | TranscriptMessage
  | TextMessage
  | AudioMessage
  | StatusMessage
  | ErrorMessage;

export type {
  SSEMessage,
  TranscriptMessage,
  TextMessage,
  AudioMessage,
  StatusMessage,
  ErrorMessage,
};

// SSE Utility Functions
export class SSEHelper {
  /**
   * Format SSE message for streaming
   */
  static formatMessage(message: SSEMessage): string {
    return `data: ${JSON.stringify(message)}\n\n`;
  }

  /**
   * Send SSE prelude to establish connection
   */
  static async sendPrelude(stream: SSEStreamingApi): Promise<void> {
    await stream.write(':\n\n');
  }

  /**
   * Send keep-alive message
   */
  static async sendKeepAlive(stream: SSEStreamingApi): Promise<void> {
    await stream.write(': keep-alive\n\n');
  }

  /**
   * Send formatted SSE message
   */
  static async sendMessage(
    stream: SSEStreamingApi,
    message: SSEMessage
  ): Promise<void> {
    await stream.write(this.formatMessage(message));
  }

  /**
   * Create and manage keep-alive interval with enhanced logging
   */
  static createKeepAliveInterval(
    stream: SSEStreamingApi,
    intervalMs: number = 500,
    logger?: CustomLogger,
    userId?: string
  ): NodeJS.Timeout {
    let keepAliveCount = 0;
    const startTime = performance.now();

    if (logger && userId) {
      logger.info(
        `[${userId}] SSE keep-alive started with ${intervalMs}ms interval`
      );
    }

    const intervalId = setInterval(async () => {
      try {
        await this.sendKeepAlive(stream);
        keepAliveCount++;

        if (logger && userId && keepAliveCount % 10 === 0) {
          const elapsed = performance.now() - startTime;
          logger.debug(
            `[${userId}] SSE keep-alive: ${keepAliveCount} sent, ${elapsed.toFixed(0)}ms elapsed`
          );
        }
      } catch (error) {
        if (logger) {
          const elapsed = performance.now() - startTime;
          logger.error(
            `[${userId || 'unknown'}] SSE keep-alive failed after ${keepAliveCount} pings, ${elapsed.toFixed(0)}ms:`,
            error
          );
        }
        clearInterval(intervalId);
      }
    }, intervalMs);

    return intervalId;
  }

  /**
   * Create status message
   */
  static createStatusMessage(
    requestId: string,
    status: string,
    message: string,
    metadata?: StatusMessage['metadata']
  ): StatusMessage {
    return {
      type: 'status',
      status,
      message,
      timestamp: new Date().toISOString(),
      request_id: requestId,
      ...(metadata && { metadata }),
    };
  }

  /**
   * Create error message
   */
  static createErrorMessage(
    requestId: string,
    error: Error | string,
    errorCode: string,
    recoverable: boolean = true,
    processingTimeMs?: number
  ): ErrorMessage {
    const errorMessage = error instanceof Error ? error.message : error;
    return {
      type: 'error',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      error: {
        code: errorCode,
        message: errorMessage,
        timestamp: new Date().toISOString(),
        request_id: requestId,
        recoverable,
        processing_time_ms: processingTimeMs || 0,
      },
    };
  }

  /**
   * Create text message
   */
  static createTextMessage(
    requestId: string,
    data: string,
    metadata?: TextMessage['metadata']
  ): TextMessage {
    return {
      type: 'text',
      data,
      timestamp: new Date().toISOString(),
      request_id: requestId,
      ...(metadata && { metadata }),
    };
  }

  /**
   * Create audio message
   */
  static createAudioMessage(
    requestId: string,
    data: string,
    metadata?: AudioMessage['metadata']
  ): AudioMessage {
    return {
      type: 'audio',
      data,
      timestamp: new Date().toISOString(),
      request_id: requestId,
      ...(metadata && { metadata }),
    };
  }

  /**
   * Create transcript message
   */
  static createTranscriptMessage(
    requestId: string,
    data: string,
    metadata: TranscriptMessage['metadata']
  ): TranscriptMessage {
    return {
      type: 'transcript',
      data,
      timestamp: new Date().toISOString(),
      request_id: requestId,
      metadata,
    };
  }

  /**
   * Determine error code from error message
   */
  static determineErrorCode(errorMessage: string): string {
    if (errorMessage.includes('Message is required')) return 'MISSING_MESSAGE';
    if (errorMessage.includes('Context')) return 'CONTEXT_GENERATION_FAILED';
    if (errorMessage.includes('Agent')) return 'AI_PROCESSING_FAILED';
    if (errorMessage.includes('No speech detected'))
      return 'NO_SPEECH_DETECTED';
    if (errorMessage.includes('Audio file is required'))
      return 'MISSING_AUDIO_FILE';
    if (errorMessage.includes('TTS')) return 'TTS_PROCESSING_FAILED';
    if (errorMessage.includes('transcription')) return 'TRANSCRIPTION_FAILED';
    return 'UNKNOWN_ERROR';
  }

  /**
   * Log SSE connection lifecycle events
   */
  static logConnectionStart(
    logger: CustomLogger,
    userId: string,
    endpoint: string
  ): void {
    logger.info(`[${userId}] SSE connection started for ${endpoint}`);
  }

  static logConnectionEnd(
    logger: CustomLogger,
    userId: string,
    endpoint: string,
    duration: number,
    stats?: Record<string, unknown>
  ): void {
    const statsMsg = stats ? ` - ${JSON.stringify(stats)}` : '';
    logger.info(
      `[${userId}] SSE connection ended for ${endpoint} after ${duration.toFixed(0)}ms${statsMsg}`
    );
  }

  static logMessageSent(
    logger: CustomLogger,
    userId: string,
    messageType: string,
    sequence?: number
  ): void {
    const seq = sequence !== undefined ? ` #${sequence}` : '';
    logger.debug(`[${userId}] SSE sent ${messageType}${seq}`);
  }

  /**
   * Create SSE session manager with lifecycle tracking
   */
  static createSessionManager(
    userId: string,
    endpoint: string,
    logger?: CustomLogger
  ) {
    const startTime = performance.now();
    let messageCount = 0;
    const messageStats: Record<string, number> = {};

    if (logger) {
      this.logConnectionStart(logger, userId, endpoint);
    }

    return {
      trackMessage: (messageType: string) => {
        messageCount++;
        messageStats[messageType] = (messageStats[messageType] || 0) + 1;
        if (logger) {
          this.logMessageSent(logger, userId, messageType, messageCount);
        }
      },

      end: () => {
        const duration = performance.now() - startTime;
        const stats = {
          totalMessages: messageCount,
          messageTypes: messageStats,
        };
        if (logger) {
          this.logConnectionEnd(logger, userId, endpoint, duration, stats);
        }
        return stats;
      },
    };
  }
}
