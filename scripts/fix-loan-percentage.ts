/**
 * One-off migration: normalise `loan.percentage`.
 *
 * Older loans stored the interest rate as a fraction (0.1 for "10%") - or, in a
 * few cases, the interest AMOUNT in naira - so the admin, which renders
 * `${loan.percentage}%`, showed "0.1%" (or "200%"). New loans now store the
 * human percentage (e.g. 10). This script backfills existing rows.
 *
 * Strategy (conservative - only touches rows that are clearly wrong):
 *   - If interest is configured in percentage mode, the correct value is
 *     `settings.loan.interest.value`. Any loan whose `percentage` is 0, a
 *     fraction (0 < p < 1), or wildly different from that value is reset to it.
 *   - If interest is a flat amount, `percentage` is meaningless for display; we
 *     leave it unless it is a fraction, in which case we zero it.
 *
 * Usage:  NODE_ENV=dev ts-node scripts/fix-loan-percentage.ts            (dry run)
 *         NODE_ENV=dev ts-node scripts/fix-loan-percentage.ts --apply    (write)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const apply = process.argv.includes('--apply');
  const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017';
  const dbName = process.env.DATABASE_NAME || 'prime-loan';

  await mongoose.connect(dbUrl.includes('mongodb+srv') || dbUrl.match(/\/[^/]+$/) ? dbUrl : `${dbUrl}/${dbName}`);
  console.log(`Connected (${apply ? 'APPLY' : 'DRY RUN'})`);

  const Loan = (await import('../src/modules/loans/loan.model')).default;
  const { SettingsService } = await import('../src/modules/admin/settings.service');

  const settings: any = await SettingsService.getSettings();
  const interest = settings?.loan?.interest;
  const isPercentMode = !!interest?.percentage;
  const correctRate = Number(interest?.value || 0);

  console.log(`Settings: interest.percentage=${isPercentMode} interest.value=${correctRate}`);

  const loans = await Loan.find({}, { percentage: 1 }).lean();
  console.log(`Scanning ${loans.length} loans...`);

  let toFix = 0;
  const ops: any[] = [];

  for (const l of loans as any[]) {
    const p = Number(l.percentage);
    let target: number | null = null;

    if (isPercentMode && correctRate > 0) {
      // Wrong if 0, a fraction, or not close to the configured rate.
      if (!(Math.abs(p - correctRate) < 0.001)) target = correctRate;
    } else {
      // Flat-amount mode: only clean up stored fractions.
      if (p > 0 && p < 1) target = 0;
    }

    if (target !== null) {
      toFix++;
      ops.push({ updateOne: { filter: { _id: l._id }, update: { $set: { percentage: target } } } });
      if (toFix <= 20) console.log(`  ${l._id}: ${p} -> ${target}`);
    }
  }

  console.log(`${toFix} loan(s) need fixing.`);

  if (apply && ops.length) {
    const res = await Loan.bulkWrite(ops);
    console.log(`Applied. modified=${res.modifiedCount}`);
  } else if (!apply && ops.length) {
    console.log('Dry run - re-run with --apply to write.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
