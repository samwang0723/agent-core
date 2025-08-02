export type ModelProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'cartesia'
  | 'deepgram'
  | 'elevenlabs'
  | 'azure'
  | 'minimax';

export interface ModelConfig {
  provider: ModelProvider;
  modelName: string;
  apiKey?: string;
  baseURL?: string;
}

export interface TranscriptionConfig extends ModelConfig {
  format?: 'wav' | 'webm';
  language?: string;
  encoding?: string;
  sampleRate?: number;
  inputType?: 'raw' | 'container';
}

// Transcription Model Configurations
export const transcriptionConfigs: Record<string, TranscriptionConfig> = {
  groq: {
    provider: 'groq',
    modelName: 'whisper-large-v3',
    apiKey: process.env.GROQ_API_KEY,
    format: (process.env.GROQ_TRANSCRIPTION_FORMAT as 'wav' | 'webm') || 'wav',
    inputType: 'container',
  },
};

export interface TextToSpeechConfig extends ModelConfig {
  voiceId?: string;
  groupId?: string; // Add Group ID for MiniMax
}

// Text-to-Speech Model Configurations
export const ttsConfigs: Record<string, TextToSpeechConfig> = {
  groq: {
    provider: 'groq',
    modelName: 'playai-tts',
    apiKey: process.env.GROQ_API_KEY,
    voiceId: process.env.GROQ_VOICE_ID,
  },
  cartesia: {
    provider: 'cartesia',
    modelName: 'sonic-turbo-2025-03-07',
    apiKey: process.env.CARTESIA_API_KEY,
    voiceId: process.env.CARTESIA_VOICE_ID,
  },
  cartesiachinese: {
    provider: 'cartesia',
    modelName: 'sonic-turbo-2025-03-07',
    apiKey: process.env.CARTESIA_API_KEY,
    voiceId: 'e90c6678-f0d3-4767-9883-5d0ecf5894a8',
  },
  elevenlabs: {
    provider: 'elevenlabs',
    modelName: process.env.ELEVENLABS_MODEL_NAME || 'eleven_multilingual_v2',
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID,
  },
};
