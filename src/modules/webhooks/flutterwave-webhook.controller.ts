import { Request, Response } from 'express';
import pino from 'pino';
import { FlutterwaveDebitProvider } from '../../shared/providers/flutterwave-debit.provider';
import { AutoDebit } from '../loans/auto-debit.model';

const logger = pino({ name: 'flutterwave-webhook' });

export class FlutterwaveWebhookController {
  static verifySignature(req: Request, res: Response, next: Function) {
    const signature = req.headers['verif-hash'];
    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
      return res.status(401).json({ status: 'error', message: 'Invalid signature' });
    }
    next();
  }

  static async handleWebhook(req: Request, res: Response) {
    try {
      const payload = req.body;
      logger.info({ payload }, 'Received Flutterwave Webhook');

      // Check if it's a successful charge/mandate validation
      if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
        const txRef = payload.data.tx_ref;
        const provider = new FlutterwaveDebitProvider();
        
        // Verify the transaction again to be sure
        const txData = await provider.verifyTransaction(txRef);
        if (txData?.status === 'successful') {
          // If this was an account linking (e-mandate)
          if (txData.payment_type === 'account' || txData.payment_type === 'debit_ng_account') {
            const token = txData.flw_ref || payload.data.flw_ref;
            const email = txData.customer?.email;
            
            // Wait, we need the userId. Webhooks don't have user context.
            // We encoded it in txRef: mandate-${userId}-${Date.now()}
            const match = txRef.match(/^mandate-([a-f0-9]{24})-/);
            if (match) {
              const userId = match[1];

              await AutoDebit.updateMany(
                { userId: String(userId), type: "bank", status: "active" },
                { $set: { status: "revoked" } }
              );

              await AutoDebit.create({
                userId: String(userId),
                type: "bank",
                provider: "flutterwave",
                token: token,
                email: email || '',
                bankName: txData.account?.bank_name || 'Bank',
                bankCode: txData.account?.bank_code || '000',
                accountNumber: txData.account?.account_number || '0000000000',
                accountName: txData.customer?.name || 'Prime User',
                status: "active",
              });
              logger.info({ userId }, 'Bank mandate activated via webhook');
            }
          }
        }
      }

      res.status(200).send('OK');
    } catch (err) {
      logger.error(err, 'Webhook processing error');
      res.status(500).send('Error processing webhook');
    }
  }
}
