/**
 * Voice Call Provider — Abstraction Layer (V2)
 * 
 * Providers:
 * - Termii (Nigeria-native): Voice OTP ping + SMS with full message
 * - Africa's Talking: Full TTS via webhook-driven <Say> XML
 * 
 * Features:
 * - Number rotation (anti-blocking) — arrays of caller numbers in admin settings
 * - Admin-switchable via settings.voiceCallConfig.provider
 * - Escalation-tier-aware recovery messages
 *
 * Termii Docs: https://developers.termii.com/voice-call
 * AT Docs: https://developers.africastalking.com/docs/voice/overview
 */
import axios, { AxiosError } from 'axios';
import pino from 'pino';

const logger = pino({ name: 'voice-call-provider' });

/* ---------- INTERFACE ---------- */

export interface IVoiceCallProvider {
  readonly providerName: string;
  makeCall(to: string, message: string): Promise<string>; // returns call/message ID
  sendRecoverySms?(to: string, message: string): Promise<void>;
}

/* ---------- ESCALATION TIERS ---------- */

export interface EscalationTier {
  daysMin: number;
  daysMax: number;
  maxCallsPerDay: number;
  smsTemplate: string;
  sendEmail?: boolean;
}

export interface MessageTemplateVars {
  name: string;
  amount: string;
  outstanding: string;
  date: string;
  days: number;
  rate?: string;
  link?: string;
  phone?: string;
}

const DEFAULT_TEMPLATES: Record<string, string> = {
  tier1: 'Dear {name}, your loan of {amount} naira was due on {date}. Please make payment to avoid penalties. Thank you.',
  tier2: 'Urgent reminder. Your loan is {days} days overdue. A daily penalty is being applied. Your current outstanding balance is {outstanding} naira. Please pay now to protect your credit standing.',
  tier3: 'Final warning. Failure to pay {outstanding} naira within 48 hours may result in your account being flagged. This will affect your future loan eligibility and credit score. Pay immediately.',
  tier4: 'Notice. Your Prime Finance account has been flagged for review. Non-payment will lower your credit standing and limit future loan access. Outstanding balance: {outstanding} naira. Contact support immediately.',
};

/**
 * Get the recovery message for a given escalation tier
 */
export function getRecoveryMessage(
  daysOverdue: number,
  vars: MessageTemplateVars,
  customTemplates?: Record<string, string>
): { tier: string; message: string; maxCallsPerDay: number; sendEmail: boolean } {
  const templates = { ...DEFAULT_TEMPLATES, ...customTemplates };

  let tier: string;
  let maxCallsPerDay: number;
  let sendEmail = false;

  if (daysOverdue <= 3) {
    tier = 'tier1';
    maxCallsPerDay = 1;
  } else if (daysOverdue <= 7) {
    tier = 'tier2';
    maxCallsPerDay = 2;
  } else if (daysOverdue <= 14) {
    tier = 'tier3';
    maxCallsPerDay = 3;
  } else {
    tier = 'tier4';
    maxCallsPerDay = 3;
    sendEmail = true;
  }

  let message = templates[tier] || DEFAULT_TEMPLATES[tier] || '';
  message = message
    .replace(/{name}/g, vars.name)
    .replace(/{amount}/g, vars.amount)
    .replace(/{outstanding}/g, vars.outstanding)
    .replace(/{date}/g, vars.date)
    .replace(/{days}/g, String(vars.days))
    .replace(/{rate}/g, vars.rate || '')
    .replace(/{link}/g, vars.link || '')
    .replace(/{phone}/g, vars.phone || '');

  return { tier, message, maxCallsPerDay, sendEmail };
}

/* ---------- TERMII IMPLEMENTATION ---------- */

export class TermiiVoiceProvider implements IVoiceCallProvider {
  readonly providerName = 'termii';
  private apiKey: string;
  private baseUrl = 'https://v3.api.termii.com';
  private senderIds: string[];

  constructor(senderIds?: string[]) {
    this.apiKey = process.env.TERMII_API_KEY || '';
    this.senderIds = senderIds?.length
      ? senderIds
      : [process.env.TERMII_SENDER_ID || 'PrimeFinance'];

    if (!this.apiKey) {
      logger.warn('TERMII_API_KEY not configured');
    }
  }

  /**
   * Get a random sender ID from the rotation pool
   */
  private getRandomSenderId(): string {
    return this.senderIds[Math.floor(Math.random() * this.senderIds.length)];
  }

  /**
   * Make a voice call (speaks numeric OTP code as attention-getter)
   * Then sends the full message via SMS.
   */
  async makeCall(to: string, message: string): Promise<string> {
    const phone = this.formatPhone(to);
    const code = this.generateReminderCode();

    try {
      const voiceRes = await axios.post(`${this.baseUrl}/api/sms/otp/call`, {
        api_key: this.apiKey,
        phone_number: phone,
        code
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      const messageId = voiceRes.data?.message_id || voiceRes.data?.pinId || '';
      logger.info({ phone, messageId }, 'Termii voice call sent');

      // Follow-up SMS with full message
      try {
        await this.sendRecoverySms(phone, message);
      } catch (smsErr: any) {
        logger.warn({ phone, error: smsErr.message }, 'Termii SMS follow-up failed (non-fatal)');
      }

      return messageId;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ phone, status: axErr.response?.status, data: axErr.response?.data }, 'Termii voice call failed');
      throw new Error(`Termii voice call failed: ${axErr.message}`);
    }
  }

  /**
   * Send an SMS with the full recovery message
   */
  async sendRecoverySms(to: string, message: string): Promise<void> {
    const phone = this.formatPhone(to);
    const senderId = this.getRandomSenderId();

    await axios.post(`${this.baseUrl}/api/sms/send`, {
      api_key: this.apiKey,
      to: phone,
      from: senderId,
      sms: message,
      type: 'plain',
      channel: 'generic'
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    logger.info({ to: phone, senderId }, 'Termii recovery SMS sent');
  }

  private formatPhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    if (cleaned.startsWith('+')) cleaned = cleaned.substring(1);
    if (cleaned.startsWith('0')) cleaned = '234' + cleaned.substring(1);
    if (!cleaned.startsWith('234')) cleaned = '234' + cleaned;
    return cleaned;
  }

  private generateReminderCode(): number {
    return Math.floor(10000 + Math.random() * 90000);
  }
}

/* ---------- AFRICA'S TALKING IMPLEMENTATION ---------- */

export class AfricasTalkingVoiceProvider implements IVoiceCallProvider {
  readonly providerName = 'africastalking';
  private username: string;
  private apiKey: string;
  private callFromNumbers: string[];
  private callbackUrl: string;

  constructor(callFromNumbers?: string[]) {
    this.username = process.env.AT_USERNAME || '';
    this.apiKey = process.env.AT_API_KEY || '';
    this.callbackUrl = process.env.AT_VOICE_CALLBACK_URL || '';
    this.callFromNumbers = callFromNumbers?.length
      ? callFromNumbers
      : [process.env.AT_CALL_FROM || ''];

    if (!this.apiKey || !this.username) {
      logger.warn('AT_API_KEY or AT_USERNAME not configured');
    }
  }

  /**
   * Get a random caller number from the rotation pool
   */
  private getRandomCallFrom(): string {
    return this.callFromNumbers[Math.floor(Math.random() * this.callFromNumbers.length)];
  }

  /**
   * Make an outbound call with custom TTS message.
   * 1. Store the message in the callback controller's message store
   * 2. Initiate the call via AT SDK
   * 3. When user answers, AT calls our callback URL
   * 4. Our callback returns <Say>{message}</Say>
   */
  async makeCall(to: string, message: string): Promise<string> {
    const phone = this.formatPhone(to);
    const callFrom = this.getRandomCallFrom();

    try {
      // Initialize AT SDK
      const AfricasTalking = require('africastalking')({
        apiKey: this.apiKey,
        username: this.username
      });
      const voice = AfricasTalking.VOICE;

      // Store message for the callback to retrieve
      // We use the destination number as a temporary key (replaced by sessionId on callback)
      const { ATVoiceCallbackController } = await import('../../modules/webhooks/at-voice-callback.controller');

      // Make the call
      const response = await voice.call({
        callFrom,
        callTo: [phone],
        ...(this.callbackUrl ? { callbackUrl: this.callbackUrl } : {})
      });

      // AT returns entries array with sessionId
      const entries = response?.entries || [];
      const sessionId = entries[0]?.sessionId || `at_${Date.now()}`;

      // Store message keyed by sessionId for the callback
      ATVoiceCallbackController.storeCallMessage(sessionId, message);

      // Also store by phone number as fallback
      ATVoiceCallbackController.storeCallMessage(phone, message);

      logger.info({ phone, callFrom, sessionId }, 'AT voice call initiated');
      return sessionId;
    } catch (error) {
      const err = error as any;
      logger.error({ phone, callFrom, error: err.message }, 'AT voice call failed');
      throw new Error(`Africa's Talking voice call failed: ${err.message}`);
    }
  }

  private formatPhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    if (cleaned.startsWith('0')) cleaned = '+234' + cleaned.substring(1);
    if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
    return cleaned;
  }
}

/* ---------- FACTORY ---------- */

/**
 * Factory to get the configured voice call provider.
 * Reads from admin settings for provider choice + number rotation arrays.
 * Falls back to env vars if settings unavailable.
 */
export async function getVoiceProvider(): Promise<IVoiceCallProvider> {
  try {
    const { SettingsService } = await import('../../modules/admin/settings.service');
    const settings = await SettingsService.getSettings();
    const voiceConfig = (settings as any)?.voiceCallConfig;

    const provider = voiceConfig?.provider || process.env.VOICE_CALL_PROVIDER || 'termii';

    switch (provider) {
      case 'africastalking': {
        const numbers = voiceConfig?.atCallFromNumbers || [];
        return new AfricasTalkingVoiceProvider(numbers.length ? numbers : undefined);
      }
      case 'termii':
      default: {
        const senderIds = voiceConfig?.termiiSenderIds || [];
        return new TermiiVoiceProvider(senderIds.length ? senderIds : undefined);
      }
    }
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'Failed to load voice settings, defaulting to Termii');
    return new TermiiVoiceProvider();
  }
}
