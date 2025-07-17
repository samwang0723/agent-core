import { Context } from 'hono';
import logger from './logger';

export type SupportedLocale =
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'pt'
  | 'it'
  | 'ru';

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const SUPPORTED_LOCALES: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  it: 'Italian',
  ru: 'Russian',
};

export const LOCALE_RESPONSE_INSTRUCTIONS: Record<SupportedLocale, string> = {
  en: 'Respond in English',
  es: 'Responde en español',
  fr: 'Répondez en français',
  de: 'Antworten Sie auf Deutsch',
  zh: '请用中文回答',
  ja: '日本語で回答してください',
  ko: '한국어로 답변해주세요',
  pt: 'Responda em português',
  it: 'Rispondi in italiano',
  ru: 'Отвечайте на русском языке',
};

/**
 * Detects user locale from various sources in order of priority:
 * 1. Query parameter 'locale' or 'lang'
 * 2. Request header 'X-Locale' or 'X-Language'
 * 3. Accept-Language header (first supported locale)
 * 4. Default locale (en)
 */
export function detectLocale(context: Context): SupportedLocale {
  try {
    // 1. Check query parameters
    const queryLocale =
      context.req.query('locale') || context.req.query('lang');
    if (queryLocale && isValidLocale(queryLocale)) {
      logger.debug(`Locale detected from query parameter: ${queryLocale}`);
      return queryLocale as SupportedLocale;
    }

    // 2. Check custom headers
    const headerLocale =
      context.req.header('x-locale') || context.req.header('x-language');
    if (headerLocale && isValidLocale(headerLocale)) {
      logger.debug(`Locale detected from header: ${headerLocale}`);
      return headerLocale as SupportedLocale;
    }

    // 3. Parse Accept-Language header
    const acceptLanguage = context.req.header('accept-language');
    if (acceptLanguage) {
      const detectedLocale = parseAcceptLanguage(acceptLanguage);
      if (detectedLocale) {
        logger.debug(`Locale detected from Accept-Language: ${detectedLocale}`);
        return detectedLocale;
      }
    }

    // 4. Fallback to default
    logger.debug(`Using default locale: ${DEFAULT_LOCALE}`);
    return DEFAULT_LOCALE;
  } catch (error) {
    logger.error('Error detecting locale:', error);
    return DEFAULT_LOCALE;
  }
}

/**
 * Parses Accept-Language header and returns first supported locale
 */
function parseAcceptLanguage(acceptLanguage: string): SupportedLocale | null {
  try {
    // Parse "en-US,en;q=0.9,es;q=0.8" format
    const languages = acceptLanguage
      .split(',')
      .map(lang => {
        const [locale, qValue] = lang.trim().split(';');
        const quality = qValue ? parseFloat(qValue.split('=')[1]) : 1.0;
        return { locale: locale.toLowerCase(), quality };
      })
      .sort((a, b) => b.quality - a.quality); // Sort by quality descending

    for (const { locale } of languages) {
      // Try exact match first (e.g., "en" from "en-US")
      const shortLocale = locale.split('-')[0];
      if (isValidLocale(shortLocale)) {
        return shortLocale as SupportedLocale;
      }
    }

    return null;
  } catch (error) {
    logger.error('Error parsing Accept-Language header:', error);
    return null;
  }
}

/**
 * Validates if a locale string is supported
 */
function isValidLocale(locale: string): boolean {
  return Object.keys(SUPPORTED_LOCALES).includes(locale.toLowerCase());
}

/**
 * Gets the response instruction for a given locale
 */
export function getLocaleInstruction(locale: SupportedLocale): string {
  return (
    LOCALE_RESPONSE_INSTRUCTIONS[locale] ||
    LOCALE_RESPONSE_INSTRUCTIONS[DEFAULT_LOCALE]
  );
}

/**
 * Gets the human-readable name for a locale
 */
export function getLocaleName(locale: SupportedLocale): string {
  return SUPPORTED_LOCALES[locale] || SUPPORTED_LOCALES[DEFAULT_LOCALE];
}

/**
 * Creates a system message for AI models to respond in the specified locale
 */
export function createLocaleSystemMessage(locale: SupportedLocale): string {
  const instruction = getLocaleInstruction(locale);
  const languageName = getLocaleName(locale);

  return `${instruction}. Always respond in ${languageName}, regardless of the input language. Maintain natural, fluent communication in ${languageName}.`;
}
