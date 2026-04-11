/**
 * Webhook Routes — External provider callbacks
 * These routes are NOT behind JWT auth — they use provider-specific verification.
 */
import { Router } from 'express';
import { MonoWebhookController } from '../modules/webhooks/mono-webhook.controller';
import { ATVoiceCallbackController } from '../modules/webhooks/at-voice-callback.controller';

const router = Router();

/* ---------- Mono DirectPay Webhooks ---------- */

router.post(
  '/mono',
  MonoWebhookController.verifySignature,
  MonoWebhookController.handleWebhook
);

/* ---------- Africa's Talking Voice Callback ---------- */

router.post(
  '/africastalking/voice',
  ATVoiceCallbackController.handleCallback
);

export default router;
