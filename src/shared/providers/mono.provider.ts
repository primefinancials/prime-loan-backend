import pino from 'pino';
import axios from 'axios';
import https from 'https';

const logger = pino({ name: 'mono-provider' });

const MONO_BASE_URL = process.env.MONO_BASE_URL || 'https://api.withmono.com';

/** YYYY-MM-DD for "now" in Africa/Lagos (WAT, UTC+1) — mandates are rejected if start_date is in the past. */
function lagosDateString(offsetYears = 0): string {
  const now = new Date();
  // WAT has no DST; +1h from UTC.
  const wat = new Date(now.getTime() + 60 * 60 * 1000);
  if (offsetYears) wat.setUTCFullYear(wat.getUTCFullYear() + offsetYears);
  return wat.toISOString().split('T')[0];
}

export class MonoProvider {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly httpsAgent: https.Agent;

  constructor() {
    this.baseUrl = MONO_BASE_URL;
    this.secretKey = process.env.MONO_SECRET_KEY || '';
    this.httpsAgent = new https.Agent({ keepAlive: true });
  }

  private getHeaders() {
    if (!this.secretKey) {
      throw new Error('Mono credentials not configured. Please set MONO_SECRET_KEY.');
    }
    return {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'mono-sec-key': this.secretKey,
    };
  }

  /**
   * Mono's API is intermittently slow / returns 502-504 (seen constantly on the
   * hosted-initiate endpoint). Retry transient failures — network errors,
   * timeouts, and 429/502/503/504 — with backoff. 4xx (except 429) fail fast.
   * Safe for GETs and for `initiate` (Mono dedupes on `reference`).
   */
  private async request(config: {
    method: 'get' | 'post' | 'patch';
    url: string;
    data?: any;
    params?: any;
    attempts?: number;
    timeout?: number;
    backoffMs?: number;
  }): Promise<any> {
    const maxAttempts = config.attempts ?? 3;
    const backoff = config.backoffMs ?? 2000;
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await axios.request({
          method: config.method,
          url: config.url,
          data: config.data,
          params: config.params,
          headers: this.getHeaders(),
          httpsAgent: this.httpsAgent,
          timeout: config.timeout ?? 35000,
        });
      } catch (err: any) {
        lastErr = err;
        const status = err.response?.status;
        const transient =
          !err.response || // network error / timeout
          err.code === 'ECONNABORTED' ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'ECONNRESET' ||
          status === 429 ||
          status === 502 ||
          status === 503 ||
          status === 504;
        if (!transient || attempt === maxAttempts) throw err;
        const wait = attempt * backoff;
        logger.warn(
          { url: config.url, attempt, status: status || err.code },
          `Mono request transient failure — retrying in ${wait}ms`
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  private frontendUrl(): string {
    const url = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (!url) {
      if (process.env.NODE_ENV === 'production' || process.env.ENV === 'production') {
        throw new Error('FRONTEND_URL is not configured — cannot build the Mono redirect URL in production.');
      }
      return 'https://prime-loan-web-v2-staging.vercel.app';
    }
    return url.replace(/\/+$/, '');
  }

  /**
   * Initiate a Direct Debit mandate via the hosted authorisation flow.
   * `POST /v2/payments/initiate` → returns `data.mandate_id` (mmc_…) and
   * `data.mono_url` (the customer authorisation link).
   */
  async initiateMandate(params: {
    amount: number; // Max debitable amount over the mandate period, in Naira
    email: string;
    name: string;
    phone?: string;
    address?: string;
    bvn?: string;
    nin?: string;
    reference: string;
    description: string;
  }): Promise<{ mandateId: string; monoUrl: string; reference: string; raw: any }> {
    try {
      const startDate = lagosDateString(0);
      const endDate = lagosDateString(5); // 5-year validity

      let identity: { type: string; number: string } | undefined;
      if (params.bvn) identity = { type: 'bvn', number: params.bvn };
      else if (params.nin) identity = { type: 'nin', number: params.nin };

      const payload = {
        amount: Math.round(params.amount * 100), // Naira → kobo
        type: 'recurring-debit',
        method: 'mandate',
        mandate_type: 'emandate',
        debit_type: 'variable',
        description: params.description,
        reference: params.reference,
        start_date: startDate,
        end_date: endDate,
        redirect_url: `${this.frontendUrl()}/loans/mono-callback`,
        customer: {
          email: params.email,
          name: params.name || 'Prime User',
          phone: params.phone || '08000000000',
          address: params.address || 'Lagos, Nigeria',
          ...(identity ? { identity } : {}),
        },
      };

      // Keep total time under the frontend proxy's ceiling: 2 tries, 18s each,
      // 2s gap → ≤ 38s. If it still fails the frontend retries the whole call.
      const response = await this.request({
        method: 'post',
        url: `${this.baseUrl}/v2/payments/initiate`,
        data: payload,
        attempts: 2,
        timeout: 18000,
        backoffMs: 2000,
      });

      const d = response.data?.data ?? response.data ?? {};
      const mandateId: string | undefined = d.mandate_id || d.id || d.payment_id;
      const monoUrl: string | undefined = d.mono_url || d.payment_link || d.url;

      if (!mandateId || !monoUrl) {
        logger.error({ response: response.data }, 'Mono initiate: could not parse mandate_id / mono_url');
        throw new Error('Mono did not return a usable mandate id / authorisation URL');
      }

      return { mandateId, monoUrl, reference: d.reference || params.reference, raw: response.data };
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Mono initiate mandate failed');
      throw new Error(
        error.response?.data?.message || error.message || 'Failed to initiate Mono mandate'
      );
    }
  }

  /**
   * Retrieve a mandate: `GET /v3/payments/mandates/{id}`.
   * Response `data` carries `status`, `ready_to_debit`, `approved`, account
   * details and a `balance` field (max debitable amount for this mandate).
   * Returns the full envelope `{ status, message, data }`.
   */
  async getMandateStatus(mandateId: string): Promise<any> {
    try {
      const response = await this.request({
        method: 'get',
        url: `${this.baseUrl}/v3/payments/mandates/${mandateId}`,
      });
      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, mandateId }, 'Mono getMandateStatus failed');
      const notFound = error.response?.status === 404;
      const err = new Error(error.response?.data?.message || 'Failed to fetch Mono mandate status');
      (err as any).notFound = notFound;
      (err as any).status = error.response?.status;
      throw err;
    }
  }

  /**
   * Cancel a mandate: `PATCH /v3/payments/mandates/{id}/cancel` (no body).
   * Used for user "disconnect" and admin "disconnect" so the mandate is
   * cancelled on BOTH ends. Safe to call on an already-cancelled mandate
   * (treated as success).
   */
  async cancelMandate(mandateId: string): Promise<{ ok: boolean; raw: any }> {
    try {
      const response = await this.request({
        method: 'patch',
        url: `${this.baseUrl}/v3/payments/mandates/${mandateId}/cancel`,
        data: {},
      });
      return { ok: true, raw: response.data };
    } catch (error: any) {
      const status = error.response?.status;
      const body = error.response?.data;
      // Already cancelled / not found → nothing left to cancel on Mono's side.
      if (status === 404 || /cancel|not.?found|already/i.test(JSON.stringify(body || ''))) {
        logger.warn({ mandateId, body }, 'Mono cancelMandate: already cancelled / not found — treating as success');
        return { ok: true, raw: body };
      }
      logger.error({ error: body || error.message, mandateId }, 'Mono cancelMandate failed');
      throw new Error(body?.message || 'Failed to cancel Mono mandate');
    }
  }

  /** Pause a mandate: `PATCH /v3/payments/mandates/{id}/pause`. */
  async pauseMandate(mandateId: string): Promise<any> {
    const response = await this.request({
      method: 'patch',
      url: `${this.baseUrl}/v3/payments/mandates/${mandateId}/pause`,
      data: {},
    });
    return response.data;
  }

  /** Reinstate a paused/cancelled mandate: `PATCH /v3/payments/mandates/{id}/reinstate`. */
  async reinstateMandate(mandateId: string): Promise<any> {
    const response = await this.request({
      method: 'patch',
      url: `${this.baseUrl}/v3/payments/mandates/${mandateId}/reinstate`,
      data: {},
    });
    return response.data;
  }

  /**
   * Balance inquiry for a mandate's linked account.
   *
   * `GET /v3/payments/mandates/{id}/balance-inquiry?amount=<kobo>`
   *
   * Verified against the live API (Sept 2026): `amount` is REQUIRED — without it
   * Mono returns `400 "Amount is required to check balance"`. So this is always a
   * "can the account cover <amount>?" check, not a raw balance read. Mono bills a
   * small fee per call, so callers must gate it behind an explicit user action
   * and the result is cached upstream.
   *
   * @param amountNaira the amount to test sufficiency against (e.g. the loan's
   *        outstanding balance). Required, > 0.
   */
  async getMandateBalance(
    mandateId: string,
    amountNaira: number
  ): Promise<{ balance: number | null; sufficient: boolean | null; testedAmount: number; currency: string; raw: any }> {
    if (!amountNaira || amountNaira <= 0) {
      throw new Error('A positive amount is required for a Mono balance inquiry.');
    }
    const testedKobo = Math.round(amountNaira * 100);
    try {
      const response = await this.request({
        method: 'get',
        url: `${this.baseUrl}/v3/payments/mandates/${mandateId}/balance-inquiry`,
        params: { amount: testedKobo },
      });
      const d = response.data?.data ?? response.data ?? {};

      // If Mono echoes an actual balance it is in kobo. Some responses only
      // return a sufficiency boolean.
      const rawBal = d.balance ?? d.available_balance ?? d.account_balance;
      const balance = rawBal === undefined || rawBal === null ? null : Number(rawBal) / 100;
      const sufficient =
        d.sufficient !== undefined ? Boolean(d.sufficient)
        : d.has_sufficient_funds !== undefined ? Boolean(d.has_sufficient_funds)
        : d.status === 'successful' && balance !== null ? balance >= amountNaira
        : null;

      return { balance, sufficient, testedAmount: amountNaira, currency: d.currency || 'NGN', raw: response.data };
    } catch (error: any) {
      logger.error(
        { error: error.response?.data || error.message, mandateId },
        'Mono getMandateBalance failed'
      );
      throw new Error(error.response?.data?.message || 'Failed to run Mono balance inquiry');
    }
  }

  /**
   * Direct debit an account (variable mandate): `POST /v3/payments/mandates/{id}/debit`.
   * ASYNC — the immediate `response_code: "00"` only means "accepted".
   * Real settlement arrives via `events.mandates.debit.successful/failed`.
   * Returns `{ accepted, providerReference, sessionId, raw }`.
   */
  async chargeAccount(params: {
    accountId: string; // the mandate id (mmc_…)
    amount: number; // Naira
    reference: string;
    narration: string;
  }): Promise<{ accepted: boolean; providerReference?: string; sessionId?: string; raw: any }> {
    try {
      const payload = {
        amount: Math.round(params.amount * 100), // Naira → kobo
        narration: params.narration,
        reference: params.reference,
      };

      // No auto-retry on a debit — an ambiguous 5xx/timeout might mean it landed.
      // Mono dedupes on `reference`; the reconcile cron settles anything unclear.
      const response = await this.request({
        method: 'post',
        url: `${this.baseUrl}/v3/payments/mandates/${params.accountId}/debit`,
        data: payload,
        attempts: 1,
      });

      const d = response.data?.data ?? response.data ?? {};
      const rc = response.data?.response_code ?? d.response_code;
      const accepted =
        rc === '00' || rc === 0 || /success|processing|pending/i.test(String(d.status || response.data?.status || ''));

      return {
        accepted,
        providerReference: d.reference_number || d.reference,
        sessionId: d.session_id || d.sessionId,
        raw: response.data,
      };
    } catch (error: any) {
      const body = error.response?.data;
      logger.error({ error: body || error.message, reference: params.reference }, 'Mono chargeAccount failed');
      const msg =
        (typeof body === 'object' ? body?.message || JSON.stringify(body) : body) ||
        error.message ||
        'Mono account charge failed';
      throw new Error(msg);
    }
  }

  /**
   * Retrieve debits for a mandate (reconciliation fallback when a webhook is
   * missed). Endpoint path is not yet confirmed in the docs; tries the most
   * likely shape and returns [] on 404 so the caller degrades gracefully.
   */
  async getMandateDebits(mandateId: string): Promise<any[]> {
    for (const path of [
      `/v3/payments/mandates/${mandateId}/debits`,
      `/v3/payments/mandates/${mandateId}/transactions`,
    ]) {
      try {
        const response = await this.request({ method: 'get', url: `${this.baseUrl}${path}`, attempts: 2 });
        const d = response.data?.data ?? response.data;
        return Array.isArray(d) ? d : Array.isArray(d?.debits) ? d.debits : [];
      } catch (error: any) {
        if (error.response?.status === 404) continue;
        logger.warn({ error: error.response?.data || error.message, mandateId, path }, 'Mono getMandateDebits failed');
        return [];
      }
    }
    return [];
  }

  /**
   * @deprecated Mono Connect account-info endpoint. Kept for the legacy admin
   * balance path (`user.mono_account.id`). New code uses `getMandateBalance`.
   */
  async getAccountInfo(accountId: string): Promise<any> {
    try {
      const response = await this.request({ method: 'get', url: `${this.baseUrl}/v2/accounts/${accountId}` });
      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, accountId }, 'Mono getAccountInfo failed');
      throw new Error(error.response?.data?.message || 'Failed to fetch Mono account info');
    }
  }
}
