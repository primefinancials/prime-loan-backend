/**
 * Mono Direct Debit - canonical status mapping.
 *
 * SINGLE SOURCE OF TRUTH for turning a Mono mandate payload (from
 * `GET /v3/payments/mandates/{id}`, from `initiateMandate`, or from a webhook
 * `data` object) into the local `AutoDebit.status` vocabulary.
 *
 * Every consumer (checkAccount, initiateBankMono, linkBankMono, the repayment
 * cron, the admin auto-debit controller, the reconciliation cron and the
 * webhook handler) MUST use `mapMonoMandateStatus` rather than its own ad-hoc
 * string checks. Previously each of those files interpreted Mono status
 * differently (`active`, `approved`, `ready_to_debit`, `initiated`, `cancelled`
 * ...), so the same mandate could look linked on one screen and broken on another.
 *
 * Verified against docs.mono.co (Sept 2026):
 *   lifecycle: awaiting_authorization -> initiated -> approved -> (ready_to_debit) -> paused|cancelled|rejected|expired
 *   - `approved`      = the ₦50 NIBSS e-mandate transfer completed. NOT yet debitable.
 *   - `ready_to_debit`= the account can actually be debited (delivered by
 *                       `events.mandates.ready`; 5min-24h in prod, ~1h in sandbox).
 */

export type LocalMandateStatus =
  | 'initiating'   // we asked Mono to create the mandate; customer has not finished auth
  | 'pending'      // mandate exists on Mono, awaiting approval / ready-to-debit
  | 'approved'     // customer approved (₦50 done) but Mono has not confirmed ready-to-debit
  | 'active'       // ready_to_debit === true - safe to call /debit
  | 'rejected'     // bank rejected the mandate
  | 'cancelled'    // cancelled (by us, the customer, or Mono)
  | 'expired'      // past end_date
  | 'failed';      // mandate setup failed

export interface MappedMonoStatus {
  /** local AutoDebit.status value to persist */
  local: LocalMandateStatus;
  /** raw Mono status string (lower-cased) for logging / display */
  raw: string;
  /** true only when Mono says the account can be debited right now */
  readyToDebit: boolean;
  /** true once the customer has authorised (approved or ready) */
  approved: boolean;
  /** true for states that will never become debitable without a fresh mandate */
  terminal: boolean;
}

/**
 * @param monoResponse a Mono mandate object. Accepts the full axios `response.data`
 *        (`{ status, data: {...} }`), the inner `data` object, or a webhook `data`
 *        object - it unwraps `.data` one level if present.
 */
export function mapMonoMandateStatus(monoResponse: any): MappedMonoStatus {
  const root = monoResponse ?? {};
  // Unwrap one { data: {...} } envelope if the meaningful fields live inside it.
  const d =
    root.data && (root.data.status !== undefined || root.data.ready_to_debit !== undefined || root.data.approved !== undefined)
      ? root.data
      : root;

  const raw = String(d.status ?? d.mandate_status ?? '').toLowerCase().trim();
  const readyFlag = d.ready_to_debit === true || d.readyToDebit === true;
  const approvedFlag = d.approved === true;

  // ── TERMINAL / NON-DEBITABLE STATES FIRST ────────────────────────────────
  // The live Mono API returns `ready_to_debit: true` EVEN ON A CANCELLED
  // mandate (observed: {status:"cancelled", approved:false, ready_to_debit:true}).
  // So `status` is authoritative for terminal states and MUST be checked before
  // any ready/approved flag, or we would treat a dead mandate as debitable.
  if (raw === 'rejected' || raw === 'declined') {
    return { local: 'rejected', raw, readyToDebit: false, approved: false, terminal: true };
  }
  if (raw === 'cancelled' || raw === 'canceled' || raw === 'revoked' || raw === 'deleted') {
    return { local: 'cancelled', raw: raw || 'cancelled', readyToDebit: false, approved: false, terminal: true };
  }
  if (raw === 'expired') {
    return { local: 'expired', raw, readyToDebit: false, approved: false, terminal: true };
  }
  if (raw === 'failed' || raw === 'error') {
    return { local: 'failed', raw, readyToDebit: false, approved: false, terminal: true };
  }
  // Paused is recoverable (reinstate) - not terminal, but not debitable.
  if (raw === 'paused' || raw === 'suspended' || raw === 'inactive' || raw === 'on_hold') {
    return { local: 'pending', raw: raw || 'paused', readyToDebit: false, approved: approvedFlag, terminal: false };
  }

  // ── DEBITABLE ───────────────────────────────────────────────────────────
  // Mono marks a live, debitable mandate as status:"approved" + approved:true +
  // ready_to_debit:true. Require ready_to_debit AND a non-terminal status.
  if (readyFlag && (raw === '' || raw === 'approved' || raw === 'active' || raw === 'ready' || raw === 'ready_to_debit')) {
    return { local: 'active', raw: raw || 'ready', readyToDebit: true, approved: true, terminal: false };
  }
  if (raw === 'active' || raw === 'ready' || raw === 'ready_to_debit') {
    return { local: 'active', raw, readyToDebit: true, approved: true, terminal: false };
  }

  // ── AUTHORISED, NOT YET READY ───────────────────────────────────────────
  if (approvedFlag || raw === 'approved') {
    return { local: 'approved', raw: raw || 'approved', readyToDebit: false, approved: true, terminal: false };
  }

  // ── IN PROGRESS ─────────────────────────────────────────────────────────
  return { local: 'pending', raw: raw || 'pending', readyToDebit: false, approved: false, terminal: false };
}

/**
 * Map a Mono webhook `event` string to a coarse intent. Used by the webhook
 * controller so a missing/renamed event still routes sensibly.
 */
export type MonoWebhookIntent =
  | 'mandate.created'
  | 'mandate.approved'
  | 'mandate.ready'
  | 'mandate.rejected'
  | 'mandate.cancelled'
  | 'mandate.paused'
  | 'mandate.reinstated'
  | 'mandate.expired'
  | 'debit.processing'
  | 'debit.successful'
  | 'debit.failed'
  | 'unknown';

export function classifyMonoWebhook(event: string): MonoWebhookIntent {
  const e = String(event || '').toLowerCase();
  if (e.includes('debit') && (e.includes('success') || e.endsWith('.successful'))) return 'debit.successful';
  if (e.includes('debit') && e.includes('fail')) return 'debit.failed';
  if (e.includes('debit') && e.includes('processing')) return 'debit.processing';
  if (e.includes('mandate') && e.includes('reinstate')) return 'mandate.reinstated';
  if (e.includes('mandate') && (e.includes('cancel') || e.includes('revoke') || e.includes('delete'))) return 'mandate.cancelled';
  if (e.includes('mandate') && e.includes('pause')) return 'mandate.paused';
  if (e.includes('mandate') && e.includes('reject')) return 'mandate.rejected';
  if (e.includes('mandate') && e.includes('expire')) return 'mandate.expired';
  if (e.includes('mandate') && e.includes('ready')) return 'mandate.ready';
  if (e.includes('mandate') && (e.includes('approve') || e.includes('active'))) return 'mandate.approved';
  if (e.includes('mandate') && e.includes('creat')) return 'mandate.created';
  return 'unknown';
}

/** Pull the mandate id out of a webhook `data` object (varies by event). */
export function extractMandateId(data: any): string | undefined {
  if (!data) return undefined;
  return (
    data.mandate ||        // debit.* and mandate.action.* events
    data.mandate_id ||
    data.id ||             // mandate.created / approved / ready / rejected / expired
    undefined
  );
}

/** Pull the debit transaction reference(s) out of a webhook `data` object. */
export function extractDebitReferences(data: any): string[] {
  if (!data) return [];
  const refs = [data.reference_number, data.reference, data.session_id, data.sessionId, data.trx_ref]
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
  return Array.from(new Set(refs));
}
