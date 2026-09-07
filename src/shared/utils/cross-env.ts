/**
 * Staging and production run against the SAME MongoDB cluster, telling
 * themselves apart with a `_staging` collection suffix (see collection.utils).
 * They also share ONE Mono business / ONE Flutterwave account / ONE VFD merchant,
 * and Mono only lets you register a single webhook URL - so a `debit.successful`
 * webhook for a debit that STAGING started can be delivered to PRODUCTION's
 * endpoint (or vice-versa). The receiving side then can't find the AutoDebitLog
 * (it lives in the other env's collection) and the loan is never reconciled.
 *
 * These helpers let the reconcile cron read the *other* environment's
 * `webhook_events` so a debit outcome is never lost just because Mono picked the
 * wrong URL. Each environment still only ever WRITES its own collections.
 */
import mongoose from 'mongoose';
import { getCollectionName } from './collection.utils';

/** This env's + the other env's collection name for a base name, e.g.
 *  ['webhook_events', 'webhook_events_staging']. */
export function bothEnvCollectionNames(base: string): [string, string] {
  const mine = getCollectionName(base);
  const sibling = mine.endsWith('_staging') ? base : `${base}_staging`;
  return [mine, sibling];
}

function rawCollection(name: string) {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection not ready');
  return db.collection(name);
}

export type MonoDebitOutcome = 'successful' | 'failed' | 'processing' | null;

/**
 * Look for a Mono debit webhook (successful / failed / processing) whose
 * reference_number or session_id matches one of `refs`, across BOTH this env's
 * and the sibling env's `webhook_events`. Returns the mapped outcome, or null
 * when no webhook has been seen for this debit yet.
 */
export async function findMonoDebitOutcome(refs: string[]): Promise<{ outcome: MonoDebitOutcome; data?: any }> {
  const clean = refs.filter(Boolean);
  if (!clean.length) return { outcome: null };

  const [mine, sibling] = bothEnvCollectionNames('webhook_events');
  const names = mine === sibling ? [mine] : [mine, sibling];

  for (const name of names) {
    let rows: any[] = [];
    try {
      rows = await rawCollection(name)
        .find({
          provider: 'mono',
          eventType: { $in: ['events.mandates.debit.successful', 'events.mandates.debit.failed', 'events.mandates.debit.processing'] },
          $or: [
            { 'payload.data.reference_number': { $in: clean } },
            { 'payload.data.session_id': { $in: clean } },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
    } catch {
      continue;
    }
    if (!rows.length) continue;

    // Prefer a terminal outcome over "processing" if both were delivered.
    const success = rows.find((r) => r.eventType === 'events.mandates.debit.successful');
    if (success) return { outcome: 'successful', data: success.payload?.data };
    const failed = rows.find((r) => r.eventType === 'events.mandates.debit.failed');
    if (failed) return { outcome: 'failed', data: failed.payload?.data };
    return { outcome: 'processing', data: rows[0].payload?.data };
  }

  return { outcome: null };
}

/**
 * Where does this loan live? `loans` is still environment-split (test loans must
 * not pollute production reporting), so a shared AutoDebitLog can point at a
 * loan owned by the OTHER environment. Callers use this to skip such rows and
 * let the owning env reconcile them.
 */
export async function loanEnv(loanId: string): Promise<'this' | 'sibling' | 'missing'> {
  const [mine, sibling] = bothEnvCollectionNames('loans');
  try {
    const { Types } = mongoose;
    const _id: any = Types.ObjectId.isValid(loanId) ? new Types.ObjectId(loanId) : loanId;
    if (await rawCollection(mine).findOne({ _id } as any, { projection: { _id: 1 } })) return 'this';
    if (mine !== sibling && (await rawCollection(sibling).findOne({ _id } as any, { projection: { _id: 1 } }))) return 'sibling';
  } catch {
    /* fall through */
  }
  return 'missing';
}
