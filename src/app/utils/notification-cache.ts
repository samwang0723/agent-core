import crypto from 'crypto';
import { createClient, RedisClientType } from 'redis';
import logger from './logger';

interface CacheEntry {
  timestamp: number;
  data: unknown;
}

export class NotificationCache {
  private static instance: NotificationCache;
  private redis: RedisClientType;
  private thresholdMinutes: number;
  private isConnected: boolean = false;

  private constructor() {
    this.thresholdMinutes = parseInt(
      process.env.NOTIFICATION_CACHE_THRESHOLD_MINUTES || '30'
    );

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = createClient({ url: redisUrl });

    this.initializeRedis();
  }

  public static getInstance(): NotificationCache {
    if (!NotificationCache.instance) {
      NotificationCache.instance = new NotificationCache();
    }
    return NotificationCache.instance;
  }

  public async isDuplicate(
    userId: string,
    type: 'email' | 'calendar',
    contentHash: string
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, falling back to in-memory cache');
      return false;
    }

    try {
      const key = this.generateKey(userId, type, contentHash);
      const entryStr = await this.redis.get(key);

      if (!entryStr) {
        return false;
      }

      const entry: CacheEntry = JSON.parse(entryStr);
      const now = Date.now();
      const thresholdMs = this.thresholdMinutes * 60 * 1000;
      const isWithinThreshold = now - entry.timestamp < thresholdMs;

      if (!isWithinThreshold) {
        await this.redis.del(key);
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
    } catch (error) {
      logger.error('Error checking duplicate notification in Redis', { error });
      return false;
    }
  }

  public async isDuplicateByIds(
    userId: string,
    type: 'email' | 'calendar' | 'conflict',
    ids: string[]
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, falling back to in-memory cache');
      return false;
    }

    try {
      const sortedIds = ids.sort();
      const idsKey = sortedIds.join('|');
      const key = this.generateKey(userId, type, idsKey);
      const entryStr = await this.redis.get(key);

      if (!entryStr) {
        return false;
      }

      const entry: CacheEntry = JSON.parse(entryStr);
      const now = Date.now();
      const thresholdMs = this.thresholdMinutes * 60 * 1000;
      const isWithinThreshold = now - entry.timestamp < thresholdMs;

      if (!isWithinThreshold) {
        await this.redis.del(key);
        return false;
      }

      logger.info('Duplicate notification detected and skipped (ID-based)', {
        userId,
        type,
        ids: sortedIds,
        idsKey,
        timeSinceLastMs: now - entry.timestamp,
        thresholdMs,
      });

      return true;
    } catch (error) {
      logger.error('Error checking duplicate notification by IDs in Redis', {
        error,
      });
      return false;
    }
  }

  public async markNotified(
    userId: string,
    type: 'email' | 'calendar',
    contentHash: string,
    data?: unknown
  ): Promise<void> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, cannot cache notification');
      return;
    }

    try {
      const key = this.generateKey(userId, type, contentHash);
      const entry: CacheEntry = {
        timestamp: Date.now(),
        data,
      };

      const thresholdSeconds = this.thresholdMinutes * 60;
      await this.redis.setEx(key, thresholdSeconds, JSON.stringify(entry));

      logger.debug('Notification cached in Redis', {
        userId,
        type,
        contentHash,
        ttlSeconds: thresholdSeconds,
      });
    } catch (error) {
      logger.error('Error caching notification in Redis', { error });
    }
  }

  public async markNotifiedByIds(
    userId: string,
    type: 'email' | 'calendar' | 'conflict',
    ids: string[],
    data?: unknown
  ): Promise<void> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, cannot cache notification');
      return;
    }

    try {
      const sortedIds = ids.sort();
      const idsKey = sortedIds.join('|');
      const key = this.generateKey(userId, type, idsKey);
      const entry: CacheEntry = {
        timestamp: Date.now(),
        data,
      };

      const thresholdSeconds = this.thresholdMinutes * 60;
      await this.redis.setEx(key, thresholdSeconds, JSON.stringify(entry));

      logger.debug('Notification cached in Redis (ID-based)', {
        userId,
        type,
        ids: sortedIds,
        idsKey,
        ttlSeconds: thresholdSeconds,
      });
    } catch (error) {
      logger.error('Error caching notification by IDs in Redis', { error });
    }
  }

  public generateContentHash(content: string[]): string {
    const sortedContent = content.sort().join('|');
    return crypto
      .createHash('sha256')
      .update(sortedContent)
      .digest('hex')
      .substring(0, 16);
  }

  private generateKey(
    userId: string,
    type: string,
    contentHash: string
  ): string {
    return `${type}:${userId}:${contentHash}`;
  }

  private async initializeRedis(): Promise<void> {
    try {
      await this.redis.connect();
      this.isConnected = true;
      logger.info('Redis connected successfully for notification cache');
    } catch (error) {
      logger.error('Failed to connect to Redis for notification cache', {
        error,
      });
      this.isConnected = false;
    }

    this.redis.on('error', error => {
      logger.error('Redis connection error', { error });
      this.isConnected = false;
    });

    this.redis.on('connect', () => {
      logger.info('Redis reconnected');
      this.isConnected = true;
    });
  }

  public async getCacheStats(): Promise<{
    size: number;
    thresholdMinutes: number;
    isConnected: boolean;
  }> {
    let size = 0;

    if (this.isConnected) {
      try {
        const info = await this.redis.info('keyspace');
        const match = info.match(/keys=(\d+)/);
        size = match ? parseInt(match[1]) : 0;
      } catch (error) {
        logger.error('Error getting Redis cache stats', { error });
      }
    }

    return {
      size,
      thresholdMinutes: this.thresholdMinutes,
      isConnected: this.isConnected,
    };
  }

  public async destroy(): Promise<void> {
    if (this.isConnected) {
      try {
        await this.redis.quit();
        this.isConnected = false;
        logger.info('Redis connection closed');
      } catch (error) {
        logger.error('Error closing Redis connection', { error });
      }
    }
  }
}

export const notificationCache = NotificationCache.getInstance();
