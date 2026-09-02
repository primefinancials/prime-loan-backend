/**
 * Webhook Event dedupe store.
 *
 * Providers (Mono especially) redeliver the same webhook many times — Mono
 * retries with exponential backoff up to 25 times over 48h, reusing the same
 * `event_id`. Without a dedupe guard, a redelivered `debit.successful` would
 * reconcile a loan twice, and a redelivered `mandate.cancelled` is harmless but
 * noisy.
 *
 * `markProcessed` inserts a row keyed by `provider:eventId`. The unique index
 * makes a concurrent/duplicate delivery fail fast, so the caller can no-op.
 * Rows self-expire after 7 days (well past Mono's 48h retry window).
 */
import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../utils/collection.utils';

export interface IWebhookEvent extends Document {
  provider: string;               // 'mono' | 'flutterwave' | 'monnify'
  eventId: string;                // provider's event id
  eventType?: string;             // e.g. 'events.mandates.debit.successful'
  dedupeKey: string;              // `${provider}:${eventId}` — unique
  payload?: any;
  handledAt: Date;
  createdAt: Date;
  expiresAt: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    provider: { type: String, required: true, index: true },
    eventId: { type: String, required: true },
    eventType: { type: String },
    dedupeKey: { type: String, required: true, unique: true },
    payload: { type: Schema.Types.Mixed },
    handledAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true, collection: getCollectionName('webhook_events') }
);

export const WebhookEvent = mongoose.model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);

/**
 * True if we have already fully processed this event.
 *
 * The row is written by `markWebhookProcessed` AFTER processing succeeds, so a
 * handler that throws (and returns 5xx) can be safely retried by the provider —
 * the downstream operations it performs (loan reconciliation keyed by
 * idempotency key, `updateMany` status writes) are themselves idempotent.
 *
 * When `eventId` is missing we cannot dedupe here; returns `false` and the
 * caller falls back to its own idempotency (e.g. AutoDebitLog status).
 */
export async function alreadyProcessedWebhook(provider: string, eventId: string | undefined | null): Promise<boolean> {
  if (!eventId) return false;
  try {
    const existing = await WebhookEvent.exists({ dedupeKey: `${provider}:${eventId}` });
    return !!existing;
  } catch {
    return false;
  }
}

/** Record that this event has been processed. Safe to call with a missing id (no-op). */
export async function markWebhookProcessed(
  provider: string,
  eventId: string | undefined | null,
  eventType?: string,
  payload?: any
): Promise<void> {
  if (!eventId) return;
  try {
    await WebhookEvent.create({ provider, eventId: String(eventId), eventType, dedupeKey: `${provider}:${eventId}`, payload });
  } catch (err: any) {
    if (err?.code === 11000) return; // already marked by a concurrent delivery
    // swallow — dedupe is best-effort
  }
}
