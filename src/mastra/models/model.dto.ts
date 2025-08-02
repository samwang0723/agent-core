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
    modelName: 'claude-4-sonnet',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
  'claude-3-7-sonnet': {
    provider: 'anthropic',
    modelName: 'claude-3-7-sonnet',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
  'claude-3-5-sonnet': {
    provider: 'anthropic',
    modelName: 'claude-3-5-sonnet',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
  'gpt-4o': {
    provider: 'openai',
    modelName: 'gpt-4o',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
  'gpt-4o-mini': {
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
  'gpt-4.1': {
    provider: 'openai',
    modelName: 'gpt-4.1',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
  'gemini-2.5-pro': {
    provider: 'google',
    modelName: 'gemini-2.5-pro',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
  'gemini-2.5-flash': {
    provider: 'google',
    modelName: 'gemini-2.5-flash',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
  'gemini-2.0-flash': {
    provider: 'google',
    modelName: 'gemini-2.0-flash',
    baseURL: 'http://0.0.0.0:4000/v1',
    apiKey: process.env.LITELLM_KEY,
  },
};
