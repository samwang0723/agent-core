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
