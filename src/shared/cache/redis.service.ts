/**
 * Redis Cache Service
 * Centralized caching functionality with TTL support
 */
import Redis from 'ioredis';

export class RedisService {
  private static instance: Redis;

  static getInstance(): Redis {
    if (!this.instance) {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.instance = new Redis(redisUrl, {
        maxLoadingRetryTime: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      this.instance.on('error', (error) => {
        console.error('Redis connection error:', error);
      });

      this.instance.on('connect', () => {
        console.log('Redis connected successfully');
      });
    }

    return this.instance;
  }

  /**
   * Set cache with TTL
   */
  static async set(key: string, value: any, ttlSeconds = 3600): Promise<void> {
    const redis = this.getInstance();
    const serializedValue = JSON.stringify(value);
    await redis.setex(key, ttlSeconds, serializedValue);
  }

  /**
   * Get cache value
   */
  static async get<T>(key: string): Promise<T | null> {
    const redis = this.getInstance();
    const value = await redis.get(key);
    
    if (!value) return null;
    
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.error('Error parsing cached value:', error);
      return null;
    }
  }

  /**
   * Delete cache key
   */
  static async del(key: string): Promise<void> {
    const redis = this.getInstance();
    await redis.del(key);
  }

  /**
   * Check if key exists
   */
  static async exists(key: string): Promise<boolean> {
    const redis = this.getInstance();
    const result = await redis.exists(key);
    return result === 1;
  }

  /**
   * Set cache with pattern-based expiry
   */
  static async setWithPattern(pattern: string, key: string, value: any, ttlSeconds = 3600): Promise<void> {
    const fullKey = `${pattern}:${key}`;
    await this.set(fullKey, value, ttlSeconds);
  }

  /**
   * Get cache with pattern
   */
  static async getWithPattern<T>(pattern: string, key: string): Promise<T | null> {
    const fullKey = `${pattern}:${key}`;
    return this.get<T>(fullKey);
  }

  /**
   * Delete all keys matching pattern
   */
  static async delPattern(pattern: string): Promise<void> {
    const redis = this.getInstance();
    const keys = await redis.keys(`${pattern}:*`);
    
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  /**
   * Increment counter
   */
  static async incr(key: string, ttlSeconds?: number): Promise<number> {
    const redis = this.getInstance();
    const result = await redis.incr(key);
    
    if (ttlSeconds && result === 1) {
      await redis.expire(key, ttlSeconds);
    }
    
    return result;
  }

  /**
   * Cache function result
   */
  static async cacheFunction<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds = 3600
  ): Promise<T> {
    const cached = await this.get<T>(key);
    
    if (cached !== null) {
      return cached;
    }
    
    const result = await fn();
    await this.set(key, result, ttlSeconds);
    
    return result;
  }
}