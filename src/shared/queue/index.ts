// src/shared/queue/index.ts
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

const logger = pino({ name: 'queue-service' });

export class QueueService {
  private static connection: IORedis | null = null;

  /**
   * Initialize Redis connection
   */
  static async connect() {
    if (this.connection) return;

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    logger.info({ redisUrl }, 'Connecting to Redis for BullMQ...');

    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // ⚙️ Required for BullMQ
      enableReadyCheck: false,
    });

    this.connection.on('connect', () => logger.info('✅ Redis connected'));
    this.connection.on('error', (err) => logger.error({ err }, 'Redis error'));
  }

  /**
   * Create a queue
   */
  static createQueue(queueName: string) {
    if (!this.connection) throw new Error('QueueService not connected');
    return new Queue(queueName, { connection: this.connection });
  }

  /**
   * Create a worker
   */
  static createWorker(queueName: string, handler: any, options: any = {}) {
    if (!this.connection) throw new Error('QueueService not connected');

    const worker = new Worker(queueName, handler, {
      connection: this.connection,
      ...options,
    });

    worker.on('completed', (job) =>
      logger.info({ queueName, jobId: job.id }, '✅ Job completed')
    );

    worker.on('failed', (job, err) =>
      logger.error({ queueName, jobId: job?.id, err }, '❌ Job failed')
    );

    worker.on('error', (err) =>
      logger.error({ err }, `⚠️ Worker error on queue ${queueName}`)
    );

    return worker;
  }

  /**
   * Schedule a repeatable job
   */
  static async scheduleRepeatableJob(queueName: string, repeatConfig: any, data: any = {}) {
    const queue = this.createQueue(queueName);
    const repeat = typeof repeatConfig === 'string' ? { pattern: repeatConfig } : repeatConfig;
    // Use the queue name as the job name to keep it simple
    await queue.add(queueName, data, {
      repeat,
      removeOnComplete: 5,
      removeOnFail: 10
    });
    logger.info(`Scheduled repeatable job for ${queueName} with repeat config: ${JSON.stringify(repeat)}`);
  }

  /**
   * Remove all repeatable jobs for a queue (useful when config changes)
   */
  static async removeRepeatableJobs(queueName: string) {
    const queue = this.createQueue(queueName);
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await queue.removeRepeatableByKey(job.key);
    }
    logger.info(`Removed existing repeatable jobs for ${queueName}`);
  }

  /**
   * Lightweight liveness check for /health/ready.
   */
  static async ping(): Promise<boolean> {
    try {
      if (!this.connection) return false;
      const res = await this.connection.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Graceful shutdown
   */
  static async closeAll() {
    logger.info('🔌 Closing BullMQ Redis connection...');
    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
      logger.info('✅ Redis connection closed');
    }
  }
}
