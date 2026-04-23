import pino from 'pino';

/**
 * Shared application logger using Pino
 */
const logger = pino({
  name: 'prime-loan-backend',
  level: process.env.LOG_LEVEL || 'info',
  // Standard pino serializers can be added here if needed
  base: {
    env: process.env.NODE_ENV,
    version: '2.0.0'
  }
});

export default logger;
