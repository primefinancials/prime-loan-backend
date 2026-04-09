/**
 * Bill Provider Factory
 * - Reads active provider from admin settings
 * - Returns normalized provider instance
 * - Automatic failover: if primary fails with network error, retries with fallback
 */
import { NormalizedBillProvider } from './bill-provider.interface';
import { FlutterwaveBillProvider } from './flutterwave-bill.provider';
import { PayBetaBillProvider } from './paybeta-bill.provider';
import { SettingsService } from '../../admin/settings.service';
import pino from 'pino';

const logger = pino({ name: 'bill-provider-factory' });

/* ---------- Singleton Cache ---------- */
let flutterwaveInstance: FlutterwaveBillProvider | null = null;
let paybetaInstance: PayBetaBillProvider | null = null;

function getFlutterwave(): FlutterwaveBillProvider {
  if (!flutterwaveInstance) flutterwaveInstance = new FlutterwaveBillProvider();
  return flutterwaveInstance;
}

function getPayBeta(): PayBetaBillProvider {
  if (!paybetaInstance) paybetaInstance = new PayBetaBillProvider();
  return paybetaInstance;
}

/* ---------- Factory ---------- */

export async function getBillProvider(): Promise<NormalizedBillProvider> {
  try {
    const settings = await SettingsService.getSettings();
    const providerName = (settings as any)?.billPaymentProvider || 'flutterwave';
    return providerName === 'paybeta' ? getPayBeta() : getFlutterwave();
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'Failed to read settings, defaulting to Flutterwave');
    return getFlutterwave();
  }
}

export function getFallbackProvider(currentProvider: NormalizedBillProvider): NormalizedBillProvider {
  return currentProvider.providerName === 'flutterwave' ? getPayBeta() : getFlutterwave();
}

/**
 * Execute a provider operation with automatic failover.
 * If primary provider throws a network/timeout error, retries with the fallback.
 */
export async function withFailover<T>(
  operation: (provider: NormalizedBillProvider) => Promise<T>,
  operationName: string = 'bill-operation'
): Promise<T> {
  const primary = await getBillProvider();

  try {
    return await operation(primary);
  } catch (primaryErr: any) {
    const isNetworkError = isFailoverEligible(primaryErr);

    if (!isNetworkError) {
      // Business logic error (invalid params, insufficient funds, etc.) — don't failover
      throw primaryErr;
    }

    logger.warn(
      { provider: primary.providerName, operation: operationName, error: primaryErr.message },
      'Primary provider failed with network error, failing over'
    );

    const fallback = getFallbackProvider(primary);
    try {
      const result = await operation(fallback);
      logger.info(
        { from: primary.providerName, to: fallback.providerName, operation: operationName },
        'Failover succeeded'
      );
      return result;
    } catch (fallbackErr: any) {
      logger.error(
        { primary: primary.providerName, fallback: fallback.providerName, operation: operationName, error: fallbackErr.message },
        'Failover also failed'
      );
      // Throw original error with context
      throw new Error(`Both providers failed for ${operationName}. Primary (${primary.providerName}): ${primaryErr.message}. Fallback (${fallback.providerName}): ${fallbackErr.message}`);
    }
  }
}

/**
 * Determine if an error is eligible for failover (network issues only)
 */
function isFailoverEligible(error: any): boolean {
  if (!error) return false;

  // Axios network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP 5xx server errors
  if (error.response?.status && error.response.status >= 500) {
    return true;
  }

  // Timeout errors
  if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
    return true;
  }

  return false;
}
