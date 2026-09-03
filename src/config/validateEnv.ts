/**
 * Startup environment validation.
 *
 * Runs once at boot. In production a *missing critical* var throws (fail fast —
 * better than serving half-broken). In non-production it only warns. Non-critical
 * but important vars (Mono webhook secret, frontend URL, provider keys) always
 * warn so a misconfigured environment is obvious in the logs.
 *
 * Motivation: several modules use `process.env.X!` non-null assertions or silent
 * `|| ''` fallbacks (e.g. Mono base URL defaulting to *staging*, webhook secret
 * falling back to the API secret key). On a fresh host those produce subtle,
 * hard-to-trace failures instead of a clear boot error.
 */
import pino from 'pino';

const logger = pino({ name: 'env-validator' });

const CRITICAL = [
  'DB_URL',
  'ACCESS_TOKEN_SECRET',
  'REFRESH_TOKEN_SECRET',
  'CRYPTOJS_KEY',
];

const IMPORTANT = [
  'REDIS_URL',
  'FRONTEND_URL',
  'MONO_SECRET_KEY',
  'MONO_WEBHOOK_SECRET',
  'MONO_BASE_URL',
  'FLUTTERWAVE_SECRET_KEY',
  'CUSTOMER_KEY',
  'CUSTOMER_SECRET',
  'BASE_URL',
  'AUTH_URL',
  'CLOUDINARY_CLOUD_NAME',
];

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === 'production' || process.env.ENV === 'production';

  const missingCritical = CRITICAL.filter((k) => !process.env[k]);
  const missingImportant = IMPORTANT.filter((k) => !process.env[k]);

  if (missingImportant.length) {
    logger.warn({ missing: missingImportant }, 'Environment: important variables are not set');
  }

  // Specific high-impact misconfigurations
  if (!process.env.MONO_WEBHOOK_SECRET) {
    logger.error(
      'MONO_WEBHOOK_SECRET is not set — ALL Mono webhooks will be rejected (mandates will not activate, debits will not reconcile).'
    );
  }
  if (isProd && !process.env.FRONTEND_URL) {
    logger.error('FRONTEND_URL is not set in production — Mono mandate redirects will point at the staging front-end.');
  }
  if (isProd && !process.env.MONO_BASE_URL) {
    logger.warn('MONO_BASE_URL not set — defaulting to https://api.withmono.com (usually correct).');
  }

  if (missingCritical.length) {
    const msg = `Environment: missing CRITICAL variables: ${missingCritical.join(', ')}`;
    if (isProd) {
      logger.fatal(msg);
      throw new Error(msg);
    }
    logger.error(msg + ' (continuing — non-production)');
  }

  logger.info(
    { critical: CRITICAL.length - missingCritical.length, important: IMPORTANT.length - missingImportant.length },
    'Environment validation complete'
  );
}
