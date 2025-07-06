import { CoreMessage, LanguageModelUsage, ToolCall, ToolResult } from 'ai';
import { SSEStreamingApi } from 'hono/streaming';
import logger from '../utils/logger';

export type Message = CoreMessage;

export interface LoggableEvent {
  usage: LanguageModelUsage;
  stepType: 'initial' | 'continue' | 'tool-result';
  toolCalls?: ToolCall<string, unknown>[];
  toolResults?: ToolResult<string, unknown, unknown>[];
}
export interface TimeRange {
  from: string;
  to: string;
}
export interface ClientLocation {
  timezone: string;
  country?: string;
  city?: string;
}
export interface OutputStrategy {
  onStart?: (data: { sessionId: string; streaming: boolean }) => void;
  onChunk: (text: string, accumulated: string) => void;
  onFinish?: (data: { complete: boolean; sessionId: string }) => void;
  onError?: (error: string) => void;
}

export class HonoSSEOutput implements OutputStrategy {
  private stream: SSEStreamingApi;
  private sessionId: string;
  private isClosed = false;

  constructor(stream: SSEStreamingApi, sessionId: string) {
    this.stream = stream;
    this.sessionId = sessionId;
  }

  private safeWrite(event: string, data: object): void {
    if (this.isClosed) return;

    try {
      this.stream.writeSSE({ event, data: JSON.stringify(data) });
    } catch (error) {
      logger.error('Error writing to SSE stream:', {
        error,
        sessionId: this.sessionId,
      });
      this.isClosed = true;
    }
  }

  onStart(data: { sessionId: string; streaming: boolean }): void {
    this.safeWrite('start', data);
  }

  onChunk(text: string, accumulated: string): void {
    this.safeWrite('chunk', { text, accumulated });
  }

  onFinish(data: { complete: boolean; sessionId: string }): void {
    if (this.isClosed) return;

    this.safeWrite('finish', data);
    this.isClosed = true;
    try {
      this.stream.close();
    } catch (error) {
      logger.error('Error closing SSE stream:', {
        error,
        sessionId: this.sessionId,
      });
    }
  }

  onError(error: string): void {
    if (this.isClosed) return;

    this.safeWrite('error', { error });
  }
}

export class CollectOutput implements OutputStrategy {
  private fullText = '';
  private errorMessage: string | null = null;

  onChunk(text: string, accumulated: string): void {
    if (this.errorMessage) {
      return;
    }
    this.fullText = accumulated;
  }

  onError(error: string): void {
    this.errorMessage = error;
  }

  getFullText(): string {
    if (this.errorMessage) {
      throw new Error(this.errorMessage);
    }
    return this.fullText;
  }
}
