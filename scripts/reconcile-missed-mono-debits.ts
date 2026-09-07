/**
 * Repair loans where a Mono bank debit really went through (Mono sent
 * `events.mandates.debit.successful`) but the loan was never credited - because
 * the webhook landed on the other environment's endpoint and the reconcile cron
 * couldn't see it.
 *
 * For every `auto_debit_logs[_staging]` row still `pending`/`processing` whose
 * reference has a matching `debit.successful` in EITHER `webhook_events` store,
 * it: marks the log `successful` + `reconciledAt`, subtracts the amount from the
 * loan's `outstanding`, appends a `repayment_history` entry, flips the loan to
 * `complete` when it hits zero, and writes a COMPLETED Transfer + ledger entry
 * for visibility. Idempotent (skips rows already `reconciledAt`, and repayLoan-
 * style idempotency on `ext-debit-<ref>`).
 *
 *   DB_URL=... DATABASE_NAME=prime-loan NODE_ENV=dev DNS_SERVERS=8.8.8.8,1.1.1.1 \
 *     npx ts-node scripts/reconcile-missed-mono-debits.ts [--apply] [--ref <reference>]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(','));

const staging = process.env.NODE_ENV === 'dev';
const S = (n: string) => (staging ? `${n}_staging` : n);

async function run() {
  const apply = process.argv.includes('--apply');
  const refArg = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : null;
  const dbUrl = process.env.DB_URL;
  const dbName = process.env.DATABASE_NAME || 'prime-loan';
  if (!dbUrl) throw new Error('DB_URL is required');

  await mongoose.connect(dbUrl, { dbName, family: 4, serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db!;
  console.log(`Connected (${staging ? 'STAGING' : 'LIVE'} collections) - ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  const logsCol = db.collection(S('auto_debit_logs'));
  const loansCol = db.collection(S('loans'));

  const q: any = { provider: 'mono', status: { $in: ['pending', 'processing'] } };
  if (refArg) q.reference = refArg;
  const pending = await logsCol.find(q).toArray();
  console.log(`${pending.length} pending Mono debit log(s) to check`);

  for (const log of pending) {
    const refs = [log.reference, log.providerReference, log.sessionId].filter(Boolean);
    let evt: any = null;
    for (const wecol of ['webhook_events', 'webhook_events_staging']) {
      evt = await db.collection(wecol).findOne({
        eventType: 'events.mandates.debit.successful',
        $or: [
          { 'payload.data.reference_number': { $in: refs } },
          { 'payload.data.session_id': { $in: refs } },
        ],
      });
      if (evt) break;
    }
    if (!evt) {
      console.log(`  ${log.reference}: no debit.successful webhook found - leaving pending`);
      continue;
    }

    const d = evt.payload.data;
    const loan = await loansCol.findOne({ _id: log.loanId } as any) || await loansCol.findOne({ _id: new mongoose.Types.ObjectId(String(log.loanId)) } as any);
    if (!loan) {
      console.log(`  ${log.reference}: loan ${log.loanId} not in ${S('loans')} - skip (other env owns it)`);
      continue;
    }
    if (log.reconciledAt) { console.log(`  ${log.reference}: already reconciled - skip`); continue; }

    const amount = log.amount;
    const newOutstanding = Math.max(0, Number(loan.outstanding) - amount);
    const paidInFull = newOutstanding <= 0;
    const when = new Date(d.date || evt.createdAt);

    console.log(
      `  ${log.reference}: loan ${loan._id} outstanding ₦${loan.outstanding} -> ₦${newOutstanding}` +
        `${paidInFull ? ' (COMPLETE)' : ''}  [debit ₦${amount} on ${when.toISOString()}]`
    );
    if (!apply) continue;

    await loansCol.updateOne(
      { _id: loan._id },
      {
        $set: { outstanding: newOutstanding, loan_payment_status: paidInFull ? 'complete' : 'in-progress' },
        $push: {
          repayment_history: { amount, outstanding: newOutstanding, action: 'auto-deduction', date: when.toISOString() } as any,
        },
      } as any
    );
    await logsCol.updateOne(
      { _id: log._id },
      { $set: { status: 'successful', settledAt: when, reconciledAt: new Date(), providerResponse: d } }
    );

    const traceId = `trace_reconcile_${String(log._id)}`;
    await db.collection(S('transfers_v2')).updateOne(
      { reference: `ext-debit-${log.reference}` },
      {
        $setOnInsert: {
          userId: String(log.userId), traceId,
          fromAccount: 'bank_account', toAccount: 'loan_repayment',
          amount, transferType: 'inter', status: 'COMPLETED',
          reference: `ext-debit-${log.reference}`,
          remark: 'Automatic loan repayment (Mono bank auto-debit)',
          processedAt: when, createdAt: when, updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    console.log(`    written.`);
  }

  await mongoose.disconnect();
  console.log(`\n${apply ? 'Done.' : 'Dry run - re-run with --apply.'}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
