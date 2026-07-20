/**
 * Webhook Routes — External provider callbacks
 * These routes are NOT behind JWT auth — they use provider-specific verification.
 */
import { Router } from 'express';
import { ATVoiceCallbackController } from '../modules/webhooks/at-voice-callback.controller';
import { FintechWalletController } from '../modules/loans/fintech-wallet.controller';

const router = Router();

import { FlutterwaveWebhookController } from '../modules/webhooks/flutterwave-webhook.controller';

/* ---------- Flutterwave Webhooks ---------- */
router.post(
  '/flutterwave',
  FlutterwaveWebhookController.verifySignature,
  FlutterwaveWebhookController.handleWebhook
);

/* ---------- Africa's Talking Voice Callback ---------- */

router.post(
  '/africastalking/voice',
  ATVoiceCallbackController.handleCallback
);

/* ---------- Monnify Webhooks ---------- */
router.post(
  '/monnify',
  FintechWalletController.handleMonnifyWebhook
);

/* ---------- Mono Webhooks ---------- */
import { MonoWebhookController } from '../modules/webhooks/mono-webhook.controller';
router.post(
  '/mono',
  MonoWebhookController.verifySignature,
  MonoWebhookController.handleWebhook
);

export default router;
