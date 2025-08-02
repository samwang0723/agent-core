/**
 * Simplified Audio Services
 * Direct provider integrations without complex abstractions
 */

import type { TextToSpeechConfig } from './config';
import { transcriptionConfigs, ttsConfigs } from './config';
import { CartesiaClient } from '@cartesia/cartesia-js';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import Groq from 'groq-sdk';
import logger from '../utils/logger';

/**
 * Sanitizes and validates text for TTS processing
 * @param text - Raw text input
 * @param minLength - Minimum required length (default: 3)
 * @returns Sanitized text or null if invalid
 */
export function sanitizeTextForTTS(
  text: string,
  minLength: number = 3
): string | null {
  // Initial validation
  const cleanText = text.trim();
  if (!cleanText) {
    console.warn('Empty text provided for TTS');
    return null;
  }

  // Remove markdown links entirely [text](url) or [text](url "title")
  let sanitizedText = cleanText.replace(/\[([^\]]*)\]\([^)]*\)/g, '');

  // Remove markdown image links entirely ![alt](url) or ![alt](url "title")
  sanitizedText = sanitizedText.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');

  // Remove markdown formatting characters
  sanitizedText = sanitizedText
    // Remove headers (# ## ### etc.)
    .replace(/^#{1,6}\s*/gm, '')
    // Remove bold and italic (**text**, __text__, *text*, _text_)
    .replace(/(\*{1,2}|_{1,2})(.*?)\1/g, '$2')
    // Remove strikethrough (~~text~~)
    .replace(/~~(.*?)~~/g, '$1')
    // Remove inline code (`text`)
    .replace(/`([^`]*)`/g, '$1')
    // Remove code blocks (```code```)
    .replace(/```[\s\S]*?```/g, '')
    // Remove blockquotes (> text)
    .replace(/^>\s*/gm, '')
    // Remove horizontal rules (--- or ***)
    .replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '')
    // Remove list markers (- * + 1. 2. etc.)
    .replace(/^[\s]*[-*+]\s*/gm, '')
    .replace(/^[\s]*\d+\.\s*/gm, '')
    // Remove table syntax (| cell |)
    .replace(/\|/g, ' ')
    // Remove HTML tags
    .replace(/(<([^>]+)>)/gi, '')
    // Remove URLs that aren't in markdown format
    .replace(/https?:\/\/[^\s]+/g, '')
    // Remove email addresses
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '')
    // Remove control characters and non-printable characters
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Remove excessive punctuation (more than 3 consecutive)
    .replace(/([.!?]){4,}/g, '$1$1$1')
    // Normalize whitespace (multiple spaces, tabs, newlines)
    .replace(/\s+/g, ' ')
    // Remove standalone punctuation marks
    .replace(/^\s*[.!?,:;]\s*/g, '')
    .trim();

  if (sanitizedText.length < minLength) {
    console.warn(
      'Text chunk too short after sanitization, skipping:',
      sanitizedText
    );
    return null;
  }

  if (!sanitizedText) {
    console.warn('Text chunk empty after sanitization, skipping');
    return null;
  }

  return sanitizedText;
}

// Simple transcription function
export async function transcribeAudio(
  audio: Buffer,
  engine: string = 'groq'
): Promise<string> {
  try {
    if (engine === 'groq') {
      const config = transcriptionConfigs.groq;
      if (!config || !config.apiKey) {
        console.error('Groq API key is not configured for transcription.');
        return '';
      }

      const groq = new Groq();

      const audioFile = new File([audio], 'audio.webm', {
        type: 'audio/webm',
      });
      const { text } = await groq.audio.transcriptions.create({
        file: audioFile,
        model: config.modelName,
      });

      return text.trim() || '';
    }

    // Add other providers here as needed
    return '';
  } catch (error) {
    console.error('Transcription failed:', error);
    return '';
  }
}

// Simple TTS function
export async function synthesizeSpeech(
  text: string,
  engine: string = 'cartesia',
  abortSignal?: AbortSignal
): Promise<Response> {
  try {
    // Validate and sanitize text input
    const sanitizedText = sanitizeTextForTTS(text);
    if (!sanitizedText) {
      return new Response('Invalid text content', { status: 400 });
    }

    if (engine === 'cartesia' || engine === 'cartesiachinese') {
      const config =
        engine === 'cartesia'
          ? ttsConfigs.cartesia
          : ttsConfigs.cartesiachinese;
      if (!config || !config.apiKey || !config.voiceId) {
        console.error(
          'Cartesia API key or Voice ID is not configured for TTS.'
        );
        return new Response('Cartesia TTS not configured', { status: 500 });
      }

      if (abortSignal?.aborted) {
        return new Response('TTS operation cancelled', { status: 200 });
      }

      // Additional validation for voice ID
      if (!config.voiceId.trim()) {
        console.error('Cartesia voice ID is empty');
        return new Response('Invalid voice configuration', { status: 500 });
      }

      const cartesia = new CartesiaClient({ apiKey: config.apiKey });

      const audioResponse = await cartesia.tts.bytes({
        modelId: config.modelName,
        transcript: sanitizedText,
        voice: {
          mode: 'id',
          id: config.voiceId,
        },
        outputFormat: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sampleRate: 24000,
        },
      });

      return new Response(audioResponse, { status: 200 });
    }

    if (engine === 'elevenlabs') {
      const config = ttsConfigs.elevenlabs as TextToSpeechConfig;
      if (!config || !config.apiKey || !config.voiceId) {
        console.error(
          'ElevenLabs API key or Voice ID is not configured for TTS.'
        );
        return new Response('ElevenLabs TTS not configured', { status: 500 });
      }

      if (abortSignal?.aborted) {
        return new Response('TTS operation cancelled', { status: 200 });
      }

      // Additional validation for voice ID
      if (!config.voiceId.trim()) {
        console.error('ElevenLabs voice ID is empty');
        return new Response('Invalid voice configuration', { status: 500 });
      }

      const elevenlabs = new ElevenLabsClient({ apiKey: config.apiKey });

      const audioStream = await elevenlabs.textToSpeech.stream(config.voiceId, {
        text: sanitizedText,
        modelId: config.modelName,
        outputFormat: 'pcm_24000',
      });

      const chunks: Buffer[] = [];
      const reader = audioStream.getReader();
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (abortSignal?.aborted) {
            return new Response('TTS operation cancelled', { status: 200 });
          }
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }

      // Convert S16LE to F32LE
      const s16leBuffer = Buffer.concat(chunks);

      return new Response(s16leBuffer, { status: 200 });
    }

    throw new Error(`Unsupported TTS engine: ${engine}`);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.info('TTS operation was cancelled');
      return new Response('TTS operation cancelled', { status: 200 });
    }
    console.error('TTS synthesis failed:', error);
    return new Response('TTS synthesis failed', { status: 500 });
  }
}

// Simple streaming TTS function
export function synthesizeSpeechStream(
  textChunks: AsyncIterable<string>,
  engine: string = 'cartesia',
  abortSignal?: AbortSignal,
  onTextChunk?: (text: string, format: 'sentence' | 'raw') => void
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Add initial configuration validation and diagnostics
        if (engine === 'cartesia' || engine === 'cartesiachinese') {
          const config =
            engine === 'cartesia'
              ? ttsConfigs.cartesia
              : ttsConfigs.cartesiachinese;
          if (!config || !config.apiKey || !config.voiceId) {
            throw new Error(
              'Cartesia API key or Voice ID is not configured for TTS.'
            );
          }
          logger.debug('Cartesia TTS config validated:', {
            hasApiKey: !!config.apiKey,
            voiceId: config.voiceId,
            modelName: config.modelName,
          });
        } else if (engine === 'elevenlabs') {
          const config = ttsConfigs.elevenlabs as TextToSpeechConfig;
          if (!config || !config.apiKey || !config.voiceId) {
            throw new Error(
              'ElevenLabs API key or Voice ID is not configured for TTS.'
            );
          }
          logger.debug('ElevenLabs TTS config validated:', {
            hasApiKey: !!config.apiKey,
            voiceId: config.voiceId,
            modelName: config.modelName,
          });
        }

        // Common text processing logic
        const processTextChunks = async (
          processTextChunk: (text: string) => Promise<void>
        ) => {
          let textBuffer = '';
          const sentenceEnders = ['.', '!', '?', '\n', '。', '！', '？'];
          const minChunkSize = 20;

          // Process incoming text chunks
          logger.debug('Starting to process text chunks');
          for await (const chunk of textChunks) {
            if (abortSignal?.aborted) break;

            // deprecated: Stream raw text chunks immediately if callback provided
            // if (onTextChunk) {
            //   onTextChunk(chunk, 'raw');
            // }

            textBuffer += chunk;

            // Look for sentence boundaries
            while (textBuffer.length >= minChunkSize) {
              let sentenceEnd = -1;

              // Find the nearest sentence ender
              for (const ender of sentenceEnders) {
                const index = textBuffer.indexOf(ender);
                if (
                  index !== -1 &&
                  (sentenceEnd === -1 || index < sentenceEnd)
                ) {
                  sentenceEnd = index;
                }
              }

              if (sentenceEnd !== -1) {
                // Process complete sentence
                const sentence = textBuffer
                  .substring(0, sentenceEnd + 1)
                  .trim();
                textBuffer = textBuffer.substring(sentenceEnd + 1);

                if (sentence) {
                  // Stream complete sentence if callback provided
                  if (onTextChunk) {
                    onTextChunk(sentence, 'sentence');
                  }
                  await processTextChunk(sentence);
                }
              } else if (textBuffer.length > 100) {
                // Force process if buffer gets too large
                const lastSpace = textBuffer.lastIndexOf(' ', 100);
                if (lastSpace > 0) {
                  const chunk = textBuffer.substring(0, lastSpace).trim();
                  textBuffer = textBuffer.substring(lastSpace + 1);

                  if (chunk) {
                    // Stream forced chunk if callback provided
                    if (onTextChunk) {
                      onTextChunk(chunk, 'sentence');
                    }
                    await processTextChunk(chunk);
                  }
                } else {
                  break;
                }
              } else {
                break;
              }
            }
          }

          // Process any remaining text
          if (textBuffer.trim() && !abortSignal?.aborted) {
            const remaining = textBuffer.trim();
            logger.debug(
              'Processing remaining text buffer:',
              remaining.length,
              'chars'
            );
            if (onTextChunk) {
              onTextChunk(remaining, 'sentence');
            }
            await processTextChunk(remaining);
          }
          logger.debug('Finished processing all text chunks');
        };

        if (engine === 'cartesia' || engine === 'cartesiachinese') {
          const config =
            engine === 'cartesia'
              ? ttsConfigs.cartesia
              : ttsConfigs.cartesiachinese;
          if (!config || !config.apiKey || !config.voiceId) {
            throw new Error(
              'Cartesia API key or Voice ID is not configured for TTS.'
            );
          }

          const cartesia = new CartesiaClient({ apiKey: config.apiKey });

          const processTextChunk = async (text: string) => {
            if (abortSignal?.aborted) return;

            // Validate and sanitize text content
            const sanitizedText = sanitizeTextForTTS(text);
            if (!sanitizedText) return;

            try {
              // Validate configuration before making API call
              if (!config.voiceId || config.voiceId.trim() === '') {
                throw new Error('Cartesia voice ID is not configured or empty');
              }

              const response = await cartesia.tts.sse({
                modelId: config.modelName,
                transcript: sanitizedText,
                voice: {
                  mode: 'id',
                  id: config.voiceId!,
                },
                outputFormat: {
                  container: 'raw',
                  encoding: 'pcm_s16le',
                  sampleRate: 24000,
                },
              });

              for await (const chunk of response) {
                if (abortSignal?.aborted || chunk.type === 'done') return;

                if (chunk.type === 'chunk' && chunk.data) {
                  const audioData = Uint8Array.from(atob(chunk.data), c =>
                    c.charCodeAt(0)
                  );
                  controller.enqueue(audioData);
                }
              }
            } catch (error) {
              if (error instanceof Error && error.name !== 'AbortError') {
                // Enhanced error logging for 400 errors
                if (error.message.includes('Status code: 400')) {
                  console.error('Cartesia API 400 error details:', {
                    originalText: text,
                    sanitizedText: sanitizedText,
                    textLength: sanitizedText.length,
                    voiceId: config.voiceId,
                    modelName: config.modelName,
                    error: error.message,
                  });
                } else {
                  console.error('Error processing text chunk:', error);
                }
              }
            }
          };

          await processTextChunks(processTextChunk);
        } else if (engine === 'elevenlabs') {
          const config = ttsConfigs.elevenlabs as TextToSpeechConfig;
          if (!config || !config.apiKey || !config.voiceId) {
            throw new Error(
              'ElevenLabs API key or Voice ID is not configured for TTS.'
            );
          }

          const elevenlabs = new ElevenLabsClient({ apiKey: config.apiKey });

          const processTextChunk = async (text: string) => {
            if (abortSignal?.aborted) return;

            // Validate and sanitize text content
            const sanitizedText = sanitizeTextForTTS(text);
            if (!sanitizedText) return;

            try {
              // Validate configuration before making API call
              if (!config.voiceId || config.voiceId.trim() === '') {
                throw new Error(
                  'ElevenLabs voice ID is not configured or empty'
                );
              }

              const audioStream = await elevenlabs.textToSpeech.stream(
                config.voiceId!,
                {
                  text: sanitizedText,
                  modelId: config.modelName,
                  outputFormat: 'pcm_24000',
                }
              );

              // Collect chunks and convert to F32LE
              const chunks: Buffer[] = [];
              const reader = audioStream.getReader();
              try {
                // eslint-disable-next-line no-constant-condition
                while (true) {
                  if (abortSignal?.aborted) {
                    return;
                  }
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(Buffer.from(value));
                }
              } finally {
                reader.releaseLock();
              }

              // Convert S16LE to F32LE and enqueue
              const s16leBuffer = Buffer.concat(chunks);
              controller.enqueue(s16leBuffer);
            } catch (error) {
              if (error instanceof Error && error.name !== 'AbortError') {
                // Enhanced error logging for 400 errors
                if (
                  error.message.includes('Status code: 400') ||
                  error.message.includes('400')
                ) {
                  console.error('ElevenLabs API 400 error details:', {
                    originalText: text,
                    sanitizedText: sanitizedText,
                    textLength: sanitizedText.length,
                    voiceId: config.voiceId,
                    modelName: config.modelName,
                    error: error.message,
                  });
                } else {
                  console.error('Error processing text chunk:', error);
                }
              }
            }
          };

          await processTextChunks(processTextChunk);
        } else {
          throw new Error(`Unsupported streaming TTS engine: ${engine}`);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.debug('Streaming TTS was aborted');
        } else {
          logger.error('Streaming TTS failed:', error);
          controller.error(error);
        }
      } finally {
        logger.debug('Attempting to close stream controller');
        try {
          controller.close();
          logger.debug('Stream controller closed successfully');
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // Controller might already be closed
          logger.warn('Controller already closed or error closing:', e);
        }
      }
    },
    cancel() {
      console.info('Streaming TTS was cancelled by client');
    },
  });
}
