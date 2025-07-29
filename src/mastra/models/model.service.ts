import { createOpenAI } from '@ai-sdk/openai';
import logger from '../utils/logger';
import { LanguageModelV1 } from 'ai';
import { MODEL_CONFIGS } from './model.dto';

// Create a model instance from a given key
export const createModelByKey = (
  modelKey?: string
): LanguageModelV1 | undefined => {
  if (!modelKey) return undefined;

  const config = MODEL_CONFIGS[modelKey];

  if (!config) {
    const availableModels = Object.keys(MODEL_CONFIGS).join(', ');
    const error = `Unknown model key: ${modelKey}. Available models: ${availableModels}`;
    logger.error(error);
    throw new Error(error);
  }

  if (!config.apiKey) {
    const envVar =
      config.provider === 'anthropic'
        ? 'ANTHROPIC_API_KEY'
        : config.provider === 'google'
          ? 'GOOGLE_API_KEY'
          : 'OPENAI_API_KEY';
    const error = `Missing API key for ${config.provider} (model: ${modelKey}). Please set ${envVar} environment variable.`;
    logger.error(error);
    throw new Error(error);
  }

  logger.info(
    `Initializing LLM model: ${config.modelName} (${config.provider}) from key: ${modelKey}`
  );

  try {
    switch (config.provider) {
      case 'anthropic': {
        const anthropic = createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = anthropic(config.modelName as any);
        logger.info(
          `✅ Anthropic model ${config.modelName} initialized successfully for key ${modelKey}`
        );
        return model;
      }
      case 'openai': {
        const openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = openai(config.modelName as any);
        logger.info(
          `✅ OpenAI model ${config.modelName} initialized successfully for key ${modelKey}`
        );
        return model;
      }
      case 'google': {
        const google = createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = google(config.modelName as any);
        logger.info(
          `✅ Google model models/${config.modelName} initialized successfully for key ${modelKey}`
        );
        return model;
      }
      default: {
        const error = `Unsupported provider: ${config.provider}`;
        logger.error(error);
        throw new Error(error);
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      `Failed to initialize model ${config.modelName} for key ${modelKey}: ${errorMessage}`
    );
    throw error;
  }
};

// List all available models
export const getAvailableModels = () => {
  return Object.entries(MODEL_CONFIGS).map(([key, config]) => ({
    key,
    provider: config.provider,
    modelName: config.modelName,
    isConfigured: !!config.apiKey,
  }));
};
