/**
 * One-off migration: normalise `loan.percentage`.
 *
 * Older loans stored the interest RATE as a fraction (0.1 for "10%"), so the
 * admin - which renders `${loan.percentage}%` - showed "0.1%". New loans store
 * the human percentage (e.g. 10). This backfills existing rows.
 *
 * Strategy (conservative):
 *   - 0 < percentage < 1  -> it is a stored fraction: multiply by 100. This
 *     preserves each loan's own historical rate (0.05 -> 5, 0.1 -> 10).
 *   - percentage == 0 / missing -> set to the currently configured rate
 *     (best guess; only matters for display).
 *   - percentage >= 1 -> leave untouched (already a human percentage, or we
 *     can't safely tell).
 *
 * Connection + collection naming mirror the app (DATABASE_NAME + the `_staging`
 * suffix when NODE_ENV=dev), so:
 *   staging:  NODE_ENV=dev        DB_URL=... DATABASE_NAME=... ts-node scripts/fix-loan-percentage.ts [--apply]
 *   live:     NODE_ENV=production DB_URL=... DATABASE_NAME=... ts-node scripts/fix-loan-percentage.ts [--apply]
 * Without --apply it is a dry run.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Some networks' default resolver drops SRV lookups (mongodb+srv://). Allow an
// override so this one-off script can still run.
if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(','));

async function run() {
  const apply = process.argv.includes('--apply');
  const dbUrl = process.env.DB_URL;
  const dbName = process.env.DATABASE_NAME || 'prime-loan';
  if (!dbUrl) throw new Error('DB_URL is required');

  await mongoose.connect(dbUrl, { dbName, family: 4, serverSelectionTimeoutMS: 15000 });
  console.log(`Connected to db "${dbName}" (NODE_ENV=${process.env.NODE_ENV || 'unset'}) - ${apply ? 'APPLY' : 'DRY RUN'}`);

  const Loan = (await import('../src/modules/loans/loan.model')).default;
  const { getCollectionName } = await import('../src/shared/utils/collection.utils');

  let configuredRate = 0;
  try {
    const settingsDoc: any = await mongoose.connection.db
      .collection(getCollectionName('settings'))
      .findOne({});
    const interest = settingsDoc?.loan?.interest;
    configuredRate = Number(interest?.value || 0);
    console.log(`Settings (${getCollectionName('settings')}): interest.percentage=${!!interest?.percentage} interest.value=${configuredRate}`);
  } catch (e: any) {
    console.warn(`Could not read settings (${e.message}); zeros will be left as-is.`);
  }

  const loans = await Loan.find({}, { percentage: 1 }).lean();
  console.log(`Scanning ${loans.length} loans in "${(Loan.collection as any).name}"...`);

  const ops: any[] = [];
  const buckets: Record<string, number> = { fraction: 0, zero: 0, untouched: 0 };

  for (const l of loans as any[]) {
    const p = Number(l.percentage);
    let target: number | null = null;

    if (p > 0 && p < 1) {
      target = Math.round(p * 100 * 100) / 100; // fraction -> percent, keep 2dp
      buckets.fraction++;
    } else if ((!p || p === 0) && configuredRate > 0) {
      target = configuredRate;
      buckets.zero++;
    } else {
      buckets.untouched++;
    }

    if (target !== null && target !== p) {
      ops.push({ updateOne: { filter: { _id: l._id }, update: { $set: { percentage: target } } } });
      if (ops.length <= 25) console.log(`  ${l._id}: ${l.percentage} -> ${target}`);
    }
  }

  console.log(`\nfraction->x100: ${buckets.fraction}, zero->${configuredRate}: ${buckets.zero}, left alone: ${buckets.untouched}`);
  console.log(`${ops.length} loan(s) to update.`);

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
