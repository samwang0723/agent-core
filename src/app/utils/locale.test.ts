// Simple test file to demonstrate locale functionality
// Run with: bun test src/app/utils/locale.test.ts

import { describe, it, expect } from 'bun:test';
import {
  detectLocale,
  createLocaleSystemMessage,
  getLocaleName,
} from './locale';

describe('Locale Utils', () => {
  it('should detect locale from query parameters', () => {
    const mockContext = {
      req: {
        query: (key: string) => (key === 'locale' ? 'es' : null),
        header: () => null,
      },
    } as any;

    const locale = detectLocale(mockContext);
    expect(locale).toBe('es');
  });

  it('should detect locale from headers', () => {
    const mockContext = {
      req: {
        query: () => null,
        header: (key: string) => (key === 'x-locale' ? 'fr' : null),
      },
    } as any;

    const locale = detectLocale(mockContext);
    expect(locale).toBe('fr');
  });

  it('should parse Accept-Language header', () => {
    const mockContext = {
      req: {
        query: () => null,
        header: (key: string) =>
          key === 'accept-language' ? 'de-DE,de;q=0.9,en;q=0.8' : null,
      },
    } as any;

    const locale = detectLocale(mockContext);
    expect(locale).toBe('de');
  });

  it('should fallback to default locale', () => {
    const mockContext = {
      req: {
        query: () => null,
        header: () => null,
      },
    } as any;

    const locale = detectLocale(mockContext);
    expect(locale).toBe('en');
  });

  it('should create correct locale system message', () => {
    const message = createLocaleSystemMessage('es');
    expect(message).toContain('Responde en español');
    expect(message).toContain('Spanish');
  });

  it('should get correct locale name', () => {
    expect(getLocaleName('zh')).toBe('Chinese');
    expect(getLocaleName('ja')).toBe('Japanese');
    expect(getLocaleName('ko')).toBe('Korean');
  });
});
