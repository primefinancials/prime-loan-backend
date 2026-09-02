/**
 * Auto-Debit Log Model — one row per external auto-debit *attempt*
 * (card / bank-mandate / fintech-wallet), across every provider.
 *
 * CHANGE (Mono stabilisation): the log is now the reconciliation anchor for
 * asynchronous providers (Mono, Monnify, OPay). A debit is written here as
 * `pending` when the provider accepts it, and only moves to `successful`
 * (triggering loan reconciliation) or `failed` when the provider webhook —
 * or the reconciliation cron — confirms the real outcome. Added fields:
 *   - providerReference / sessionId : what the provider returned synchronously,
 *     so the webhook can match on the provider's own id (Mono's webhook key is
 *     `reference_number`, which is NOT the `reference` we sent).
 *   - mandateId  : the mandate/token used (for grouping + provider look-ups).
 *   - source     : who triggered it (cron | admin | webhook | user).
 *   - settledAt / reversedAt : reconciliation timestamps for idempotency.
 */
import { Schema, model, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IAutoDebitLog extends Document {
  userId: string;
  loanId?: string;
  type: 'card' | 'bank' | 'wallet';
  amount: number;
  reference: string;               // the reference WE generated and sent to the provider
  token: string;                   // card token / mandate id
  mandateId?: string;              // provider mandate id (for bank/wallet)
  providerReference?: string;      // provider's own transaction reference (e.g. Mono reference_number)
  sessionId?: string;              // provider session id (NIP session, etc.)
  status: 'pending' | 'processing' | 'successful' | 'failed';
  provider: 'flutterwave' | 'monnify' | 'mono' | 'opay' | string;
  source?: 'cron' | 'admin' | 'webhook' | 'user' | string;
  actorId?: string;                // admin id when source = 'admin'
  narration?: string;
  providerResponse?: any;
  errorMessage?: string;
  settledAt?: Date;                // when moved to successful/failed by webhook/cron
  reversedAt?: Date;               // when an optimistic repayment was reversed
  createdAt: Date;
  updatedAt: Date;
}

const AutoDebitLogSchema = new Schema<IAutoDebitLog>(
  {
    userId: { type: String, required: true, index: true },
    loanId: { type: String, index: true },
    type: { type: String, enum: ['card', 'bank', 'wallet'], required: true },
    amount: { type: Number, required: true },
    reference: { type: String, required: true, unique: true },
    token: { type: String, required: true },
    mandateId: { type: String, index: true },
    providerReference: { type: String, index: true },
    sessionId: { type: String },
    status: { type: String, enum: ['pending', 'processing', 'successful', 'failed'], default: 'pending' },
    provider: { type: String, default: 'flutterwave' },
    source: { type: String, default: 'cron' },
    actorId: { type: String },
    narration: { type: String },
    providerResponse: { type: Schema.Types.Mixed },
    errorMessage: { type: String },
    settledAt: { type: Date },
    reversedAt: { type: Date },
  },
  { collection: getCollectionName('auto_debit_logs'), timestamps: true }
);

export const AutoDebitLog = model<IAutoDebitLog>('AutoDebitLog', AutoDebitLogSchema);
