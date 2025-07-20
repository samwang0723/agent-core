import crypto from 'crypto';
import logger from './logger';

interface CacheEntry {
  timestamp: number;
  data: any;
}

export class NotificationCache {
  private static instance: NotificationCache;
  private cache: Map<string, CacheEntry> = new Map();
  private thresholdMinutes: number;
  private cleanupInterval: NodeJS.Timeout;

  private constructor() {
    this.thresholdMinutes = parseInt(
      process.env.NOTIFICATION_CACHE_THRESHOLD_MINUTES || '30'
    );
    
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  public static getInstance(): NotificationCache {
    if (!NotificationCache.instance) {
      NotificationCache.instance = new NotificationCache();
    }
    return NotificationCache.instance;
  }

  public isDuplicate(
    userId: string,
    type: 'email' | 'calendar',
    contentHash: string
  ): boolean {
    const key = this.generateKey(userId, type, contentHash);
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    const now = Date.now();
    const thresholdMs = this.thresholdMinutes * 60 * 1000;
    const isWithinThreshold = now - entry.timestamp < thresholdMs;

    if (!isWithinThreshold) {
      this.cache.delete(key);
      return false;
    }

    logger.info('Duplicate notification detected and skipped', {
      userId,
      type,
      contentHash,
      timeSinceLastMs: now - entry.timestamp,
      thresholdMs,
    });

    return true;
  }

  public markNotified(
    userId: string,
    type: 'email' | 'calendar',
    contentHash: string,
    data?: any
  ): void {
    const key = this.generateKey(userId, type, contentHash);
    this.cache.set(key, {
      timestamp: Date.now(),
      data,
    });

    logger.debug('Notification cached', {
      userId,
      type,
      contentHash,
      cacheSize: this.cache.size,
    });
  }

  public generateContentHash(content: string[]): string {
    const sortedContent = content.sort().join('|');
    return crypto.createHash('sha256').update(sortedContent).digest('hex').substring(0, 16);
  }

  private generateKey(userId: string, type: string, contentHash: string): string {
    return `${type}:${userId}:${contentHash}`;
  }

  private cleanup(): void {
    const now = Date.now();
    const thresholdMs = this.thresholdMinutes * 60 * 1000;
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > thresholdMs) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug('Notification cache cleanup completed', {
        removedEntries: removedCount,
        remainingEntries: this.cache.size,
      });
    }
  }

  public getCacheStats(): { size: number; thresholdMinutes: number } {
    return {
      size: this.cache.size,
      thresholdMinutes: this.thresholdMinutes,
    };
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

export const notificationCache = NotificationCache.getInstance();