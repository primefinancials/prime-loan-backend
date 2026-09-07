/**
 * Mirror a user's linked auto-debit methods between the staging and live
 * environments so a bank / card authorised while testing on one is usable on
 * the other WITHOUT the user re-linking (and without exposing that "staging"
 * exists). This is safe because both environments talk to ONE Mono business /
 * ONE Flutterwave account / ONE VFD merchant and share the `users` collection -
 * a mandate token is equally valid on both.
 *
 * `auto_debits` stays environment-split (see auto-debit.model.ts) because a
 * stale test mandate must not silently appear for every production user; this
 * script makes the copy an explicit, per-user operation.
 *
 *   DB_URL=... DATABASE_NAME=prime-loan DNS_SERVERS=8.8.8.8,1.1.1.1 \
 *     npx ts-node scripts/sync-autodebit-methods.ts --user <email|userId> [--from staging|live] [--apply]
 *
 * --from is the SOURCE env (default: staging). Rows are upserted into the other
 * env by `token` (the mandate/card id); an existing row for that token is
 * updated in place, never duplicated. Dry run unless --apply.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(','));

async function run() {
  const argv = process.argv;
  const apply = argv.includes('--apply');
  const userArg = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;
  const from = (argv.includes('--from') ? argv[argv.indexOf('--from') + 1] : 'staging').toLowerCase();
  if (!userArg) throw new Error('--user <email|userId> is required');
  if (!['staging', 'live'].includes(from)) throw new Error('--from must be "staging" or "live"');

  const dbUrl = process.env.DB_URL;
  const dbName = process.env.DATABASE_NAME || 'prime-loan';
  if (!dbUrl) throw new Error('DB_URL is required');

  await mongoose.connect(dbUrl, { dbName, family: 4, serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db!;

  const srcCol = from === 'staging' ? 'auto_debits_staging' : 'auto_debits';
  const dstCol = from === 'staging' ? 'auto_debits' : 'auto_debits_staging';
  console.log(`Sync ${srcCol} -> ${dstCol} for "${userArg}" - ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  // users is shared - resolve the id once.
  const user =
    (await db.collection('users').findOne({ email: userArg })) ||
    (await db.collection('users').findOne({ 'user_metadata.email': userArg })) ||
    (mongoose.Types.ObjectId.isValid(userArg)
      ? await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(userArg) } as any)
      : null);
  if (!user) throw new Error(`No user matched "${userArg}"`);
  const userId = String(user._id);
  console.log(`user ${userId} <${user.email || user.user_metadata?.email}>`);

  const rows = await db.collection(srcCol).find({ userId }).toArray();
  console.log(`${rows.length} method(s) in ${srcCol}\n`);

  for (const r of rows) {
    const { _id, ...fields } = r;
    const existing = await db.collection(dstCol).findOne({ userId, token: r.token });
    console.log(
      `  ${r.type}/${r.provider} ${r.bankName || ''} ${String(r.accountNumber || r.token).slice(-4)} ` +
        `[${r.status}] -> ${existing ? 'update existing' : 'insert'}`
    );
    if (!apply) continue;
    await db.collection(dstCol).updateOne(
      { userId, token: r.token },
      { $set: { ...fields, updatedAt: new Date() }, $setOnInsert: { createdAt: r.createdAt || new Date() } },
      { upsert: true }
    );
  }

  await mongoose.disconnect();
  console.log(`\n${apply ? 'Done.' : 'Dry run - re-run with --apply.'}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
