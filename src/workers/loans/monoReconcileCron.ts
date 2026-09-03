/**
 * Mono Reconciliation Cron
 * ------------------------
 * Safety net for missed / delayed Mono webhooks. Every N minutes it:
 *
 *  1. Re-queries every non-terminal Mono mandate row against Mono and persists
 *     the mapped status (so an `approved`→`ready` transition, or a Mono-side
 *     cancellation, is reflected even if the webhook never arrived).
 *  2. Sweeps orphaned `initiating` mandates (customer abandoned the flow) older
 *     than 30 min - cancels them on Mono and marks them `cancelled`, so they do
 *     not pile up on Mono and do not block the user from re-linking.
 *  3. Settles `AutoDebitLog` rows still `pending`/`processing` after a grace
 *     period by asking Mono for the debit outcome; `successful` → reconcile the
 *     loan, `failed` → mark failed. Rows with no match after 24h are failed.
 *
 * All Mono status interpretation goes through mapMonoMandateStatus /
 * AutoDebitService, so this worker can never disagree with the webhook handler.
 */
import { QueueService } from '../../shared/queue';
import { SettingsService } from '../../modules/admin/settings.service';
import { DatabaseService } from '../../shared/db';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import { AutoDebit } from '../../modules/loans/auto-debit.model';
import { AutoDebitLog } from '../../modules/loans/auto-debit-log.model';
import { AutoDebitService } from '../../modules/loans/auto-debit.service';
import { MonoProvider } from '../../shared/providers/mono.provider';
import { mapMonoMandateStatus, extractDebitReferences } from '../../shared/providers/mono.status';
import pino from 'pino';

const logger = pino({ name: 'mono-reconcile-cron' });
const WK = 'mono-reconcile';

const ORPHAN_INITIATING_MIN = 30;      // cancel abandoned initiations older than this
const DEBIT_GRACE_MIN = 25;            // don't chase a debit until it's had time to settle
const DEBIT_STALE_HOURS = 24;          // give up on an unmatched pending debit after this
const ACTIVE_RECHECK_MIN = 360;        // re-verify a locally-'active' Mono mandate at most every 6h

export class MonoReconcileCron {
  static register() {
    WorkerControlService.register('mono-reconcile', async () => {
      const settings = await SettingsService.getSettings();
      let schedule = '*/15 * * * *'; // every 15 minutes
      const wc = settings.workersConfig as any;
      if (wc?.has?.('mono-reconcile')) {
        const config = wc.get('mono-reconcile');
        if (config?.cronSchedule?.trim()) schedule = config.cronSchedule;
      }
      await QueueService.removeRepeatableJobs('mono-reconcile');
      await QueueService.scheduleRepeatableJob('mono-reconcile', schedule);
      return QueueService.createWorker('mono-reconcile', async () => {
        await this.run();
      });
    });
  }

  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();
    this.register();
    await WorkerControlService.start('mono-reconcile');
  }

  private static async run() {
    let mandatesSynced = 0;
    let orphansCancelled = 0;
    let debitsSettled = 0;
    let debitsFailed = 0;

    try {
      // ── 1 + 2. Mandate rows ──────────────────────────────────────────
      // In-progress rows every run; 'active' rows only if we haven't checked
      // them against Mono recently (mandates get cancelled/paused out-of-band
      // and the live API keeps reporting ready_to_debit, so a local 'active'
      // can be a lie - but re-checking every one every 15 min wastes Mono calls).
      const staleActiveCutoff = new Date(Date.now() - ACTIVE_RECHECK_MIN * 60000);
      const rows = await AutoDebit.find({
        provider: 'mono',
        $or: [
          { status: { $in: ['initiating', 'pending', 'approved'] } },
          {
            $and: [
              { status: 'active' },
              { $or: [
                { lastSyncedAt: { $exists: false } },
                { lastSyncedAt: { $lt: staleActiveCutoff } },
              ] },
            ],
          },
        ],
      });

      for (const row of rows) {
        try {
          const ageMin = (Date.now() - new Date(row.createdAt).getTime()) / 60000;

          const synced = await AutoDebitService.syncMonoMandate(row);
          mandatesSynced++;

          if (
            row.status === 'initiating' &&
            !synced.readyToDebit &&
            synced.local !== 'approved' &&
            ageMin > ORPHAN_INITIATING_MIN
          ) {
            await AutoDebitService.cancelMethod(row, {
              reason: `Orphaned initiation (${Math.round(ageMin)} min, never authorised)`,
              localStatus: 'cancelled',
            });
            orphansCancelled++;
          }
        } catch (err: any) {
          logger.warn({ mandateId: row.token, error: err.message }, 'mandate sync failed');
        }
      }

      // ── 3. Pending debits ────────────────────────────────────────────
      const graceCutoff = new Date(Date.now() - DEBIT_GRACE_MIN * 60000);
      const pendingLogs = await AutoDebitLog.find({
        provider: 'mono',
        status: { $in: ['pending', 'processing'] },
        createdAt: { $lt: graceCutoff },
      }).limit(200);

      const provider = new MonoProvider();

      for (const log of pendingLogs) {
        try {
          const mandateId = log.mandateId || log.token;
          if (!mandateId) continue;

          const debits = await provider.getMandateDebits(mandateId);
          const ourRefs = [log.reference, log.providerReference, log.sessionId].filter(Boolean) as string[];

          const match = debits.find((d: any) => {
            const dRefs = extractDebitReferences(d);
            return dRefs.some((r) => ourRefs.includes(r));
          });

          if (match) {
            const st = String(match.status || '').toLowerCase();
            const success = st === 'successful' || st === 'success' || match.success === true || match.response_code === '00';
            const failed = st === 'failed' || match.success === false || (match.response_code && match.response_code !== '00' && match.response_code !== '99');

            if (success) {
              log.status = 'successful';
              log.settledAt = new Date();
              log.providerReference = log.providerReference || match.reference_number;
              log.providerResponse = match;
              await log.save();
              await AutoDebitService.reconcile(log._id as any);
              debitsSettled++;
            } else if (failed) {
              log.status = 'failed';
              log.settledAt = new Date();
              log.errorMessage = match.message || `Mono debit failed (code ${match.response_code})`;
              log.providerResponse = match;
              await log.save();
              debitsFailed++;
            }
            // else still processing on Mono - leave pending.
          } else {
            const ageH = (Date.now() - new Date(log.createdAt).getTime()) / 3600000;
            if (ageH > DEBIT_STALE_HOURS) {
              log.status = 'failed';
              log.settledAt = new Date();
              log.errorMessage = `No Mono debit record found after ${Math.round(ageH)}h - marked stale`;
              await log.save();
              debitsFailed++;
            }
          }
        } catch (err: any) {
          logger.warn({ reference: log.reference, error: err.message }, 'debit reconcile failed');
        }
      }

      if (mandatesSynced || orphansCancelled || debitsSettled || debitsFailed) {
        await WorkerLogService.log(
          WK,
          'info',
          `Mono reconcile: ${mandatesSynced} mandates synced, ${orphansCancelled} orphans cancelled, ${debitsSettled} debits settled, ${debitsFailed} debits failed`,
          { mandatesSynced, orphansCancelled, debitsSettled, debitsFailed }
        );
      }
      await WorkerControlService.reportActivity('mono-reconcile', `synced ${mandatesSynced}, settled ${debitsSettled}`);
    } catch (err: any) {
      logger.error({ error: err.message }, 'Fatal error in Mono reconcile cron');
      await WorkerLogService.log(WK, 'error', `Fatal error in Mono reconcile cron: ${err.message}`);
    }
  }
}

if (require.main === module) {
  MonoReconcileCron.start().catch(console.error);
}
