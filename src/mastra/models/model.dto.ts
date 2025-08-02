export type ModelProvider = 'anthropic' | 'openai' | 'google';

export interface ModelConfig {
  provider: ModelProvider;
  modelName: string;
  baseURL?: string;
  apiKey?: string;
}

// Available model configurations
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'claude-4-sonnet': {
    provider: 'anthropic',
    modelName: 'claude-sonnet-4-20250514',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  'claude-3-7-sonnet': {
    provider: 'anthropic',
    modelName: 'claude-3-7-sonnet-20250219',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  'claude-3-5-sonnet': {
    provider: 'anthropic',
    modelName: 'claude-3-5-sonnet-20241022',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  'claude-3-5-haiku': {
    provider: 'anthropic',
    modelName: 'claude-3-5-haiku-20241022',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  'o4-mini': {
    provider: 'openai',
    modelName: 'o4-mini-2025-04-16',
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
  },
  'gpt-4o': {
    provider: 'openai',
    modelName: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
  },
  'gpt-4o-mini': {
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
  },
  'gpt-4.1': {
    provider: 'openai',
    modelName: 'gpt-4.1-2025-04-14',
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
  },
  'gemini-2.5-pro': {
    provider: 'google',
    modelName: 'gemini-2.5-pro',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: process.env.GOOGLE_API_KEY,
  },
  'gemini-2.5-flash': {
    provider: 'google',
    modelName: 'gemini-2.5-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: process.env.GOOGLE_API_KEY,
  },
  'gemini-2.0-flash': {
    provider: 'google',
    modelName: 'gemini-2.0-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: process.env.GOOGLE_API_KEY,
  },
  'gemini-1.5-flash': {
    provider: 'google',
    modelName: 'gemini-1.5-flash-latest',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: process.env.GOOGLE_API_KEY,
  },
};
