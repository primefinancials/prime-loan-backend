import { Queue, Worker, JobsOptions, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

const logger = pino({ name: 'queue-service' });

export class QueueService {
  private static connection: IORedis | null = null;

  static async connect() {
    if (this.connection) return;

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.connection = new IORedis(redisUrl);

    this.connection.on('connect', () => logger.info('✅ Redis connected'));
    this.connection.on('error', (err) => logger.error({ err }, 'Redis error'));
  }

  static async closeAll() {
    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
      logger.info('🔌 Redis connection closed');
    }
  }

  static createWorker(queueName: string, handler: any, options: any = {}) {
    if (!this.connection) throw new Error('QueueService not connected');

    const worker = new Worker(queueName, handler, {
      connection: this.connection,
      ...options,
    });

    worker.on('error', (err) => logger.error({ err }, `Worker error: ${queueName}`));
    return worker;
  }

  static createQueue(queueName: string) {
    if (!this.connection) throw new Error('QueueService not connected');
    return new Queue(queueName, { connection: this.connection });
  }
}
