/**
 * Webhook Routes — External provider callbacks
 * These routes are NOT behind JWT auth — they use provider-specific verification.
 */
import { Router } from 'express';
import { ATVoiceCallbackController } from '../modules/webhooks/at-voice-callback.controller';

const router = Router();

/* ---------- Flutterwave Webhooks ---------- */
// TODO: Implement FlutterwaveWebhookController for auto-debit payment status updates
// router.post(
//   '/flutterwave',
//   FlutterwaveWebhookController.verifySignature,
//   FlutterwaveWebhookController.handleWebhook
// );

/* ---------- Africa's Talking Voice Callback ---------- */

router.post(
  '/africastalking/voice',
  ATVoiceCallbackController.handleCallback
);

export default router;
