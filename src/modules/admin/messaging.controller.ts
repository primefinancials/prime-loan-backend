/**
 * Admin Messaging Controller
 * ---------------------------
 * Manual voice-call and SMS triggers for ANY phone number - a platform user,
 * a guarantor, a reference, anyone. Not tied to a user record.
 *
 *   POST /backoffice/messaging/call        single call, synchronous
 *   POST /backoffice/messaging/sms         single SMS, synchronous
 *   POST /backoffice/messaging/bulk        bulk call or SMS - starts a background job, returns 202
 *   GET  /backoffice/messaging/bulk        recent bulk jobs
 *   GET  /backoffice/messaging/bulk/:id    poll one job's progress
 */
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import {
  TermiiVoiceProvider,
  AfricasTalkingVoiceProvider,
  getVoiceProvider,
  IVoiceCallProvider,
} from '../../shared/providers/voice-call.provider';

const logger = pino({ name: 'admin-messaging' });

const MAX_BULK_RECIPIENTS = 500;
const BULK_SEND_DELAY_MS = 350; // spacing between sends - stay under provider rate limits

function adminId(req: Request): string {
  return String((req as any).admin?._id || (req as any).admin?.id || (req as any).user?._id || 'admin-system');
}

/**
 * Accepts a single string, a newline/comma/semicolon-separated block, or an
 * array, and returns a deduped list of cleaned phone numbers.
 */
function normalisePhones(input: any): string[] {
  if (!input) return [];
  const raw: string[] = Array.isArray(input) ? input : String(input).split(/[\n,;]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let p of raw) {
    p = String(p).trim();
    if (!p) continue;
    const cleaned = p.replace(/[^\d+]/g, '');
    if (cleaned.replace(/\D/g, '').length < 7) continue; // too short to be a real number
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function resolveVoiceProvider(name?: string): IVoiceCallProvider | null {
  if (name === 'termii') return new TermiiVoiceProvider();
  if (name === 'africastalking') return new AfricasTalkingVoiceProvider();
  return null;
}

export class MessagingController {
  /** POST /backoffice/messaging/call - single call, synchronous */
  static async sendCall(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, message, provider: providerName } = req.body;
      const [target] = normalisePhones(phone);
      if (!target) return res.status(400).json({ status: 'failed', message: 'A valid phone number is required' });
      if (!String(message || '').trim()) return res.status(400).json({ status: 'failed', message: 'Message is required' });

      const provider = resolveVoiceProvider(providerName) || (await getVoiceProvider());
      logger.info({ phone: target, provider: provider.providerName, admin: adminId(req) }, 'Admin single call');
      const callId = await provider.makeCall(target, message);

      return res.status(200).json({
        status: 'success',
        data: { phone: target, provider: provider.providerName, callId, timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin single call failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /** POST /backoffice/messaging/sms - single SMS, synchronous */
  static async sendSms(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, message } = req.body;
      const [target] = normalisePhones(phone);
      if (!target) return res.status(400).json({ status: 'failed', message: 'A valid phone number is required' });
      if (!String(message || '').trim()) return res.status(400).json({ status: 'failed', message: 'Message is required' });

      const provider = new TermiiVoiceProvider();
      logger.info({ phone: target, admin: adminId(req) }, 'Admin single SMS');
      await provider.sendRecoverySms!(target, message);

      return res.status(200).json({
        status: 'success',
        data: { phone: target, provider: 'termii', timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin single SMS failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /** POST /backoffice/messaging/bulk - { type: 'call'|'sms', phones, message, provider? } */
  static async startBulk(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, message, provider: providerName } = req.body;
      if (type !== 'call' && type !== 'sms') {
        return res.status(400).json({ status: 'failed', message: "type must be 'call' or 'sms'" });
      }
      if (!String(message || '').trim()) return res.status(400).json({ status: 'failed', message: 'Message is required' });

      const phones = normalisePhones(req.body.phones);
      if (!phones.length) return res.status(400).json({ status: 'failed', message: 'At least one valid phone number is required' });
      if (phones.length > MAX_BULK_RECIPIENTS) {
        return res.status(400).json({ status: 'failed', message: `Too many recipients - max ${MAX_BULK_RECIPIENTS} per batch` });
      }

      const { BulkMessageJob } = await import('./bulk-message-job.model');
      const job = await BulkMessageJob.create({
        type,
        message,
        provider: type === 'call' ? providerName : undefined,
        recipients: phones.map((phone) => ({ phone, status: 'pending' })),
        total: phones.length,
        status: 'running',
        requestedBy: adminId(req),
      });

      logger.info({ jobId: job._id, type, count: phones.length, admin: adminId(req) }, 'Bulk message job started');

      // Fire-and-forget: process in the background, the UI polls for progress.
      void MessagingController.runBulkJob(String(job._id));

      return res.status(202).json({ status: 'success', data: { jobId: job._id, total: phones.length } });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to start bulk message job');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  private static async runBulkJob(jobId: string) {
    const { BulkMessageJob } = await import('./bulk-message-job.model');
    const job = await BulkMessageJob.findById(jobId).lean();
    if (!job) return;

    let voiceProvider: IVoiceCallProvider | null = null;
    let smsProvider: TermiiVoiceProvider | null = null;
    try {
      if (job.type === 'call') voiceProvider = resolveVoiceProvider(job.provider) || (await getVoiceProvider());
      else smsProvider = new TermiiVoiceProvider();
    } catch (e: any) {
      logger.error({ jobId, error: e.message }, 'Bulk job could not resolve a provider - aborting');
      await BulkMessageJob.updateOne({ _id: jobId }, { $set: { status: 'completed', completedAt: new Date() } });
      return;
    }

    for (let i = 0; i < job.recipients.length; i++) {
      const phone = job.recipients[i].phone;
      try {
        let providerId: string | undefined;
        if (job.type === 'call') {
          providerId = await voiceProvider!.makeCall(phone, job.message);
        } else {
          await smsProvider!.sendRecoverySms!(phone, job.message);
        }
        await BulkMessageJob.updateOne(
          { _id: jobId, 'recipients.phone': phone },
          {
            $set: { 'recipients.$.status': 'sent', 'recipients.$.providerId': providerId || null, 'recipients.$.sentAt': new Date() },
            $inc: { sentCount: 1 },
          }
        );
      } catch (e: any) {
        await BulkMessageJob.updateOne(
          { _id: jobId, 'recipients.phone': phone },
          { $set: { 'recipients.$.status': 'failed', 'recipients.$.error': String(e.message || 'Send failed').slice(0, 300) }, $inc: { failedCount: 1 } }
        );
      }
      if (i < job.recipients.length - 1) await new Promise((r) => setTimeout(r, BULK_SEND_DELAY_MS));
    }

    await BulkMessageJob.updateOne({ _id: jobId }, { $set: { status: 'completed', completedAt: new Date() } });
    logger.info({ jobId }, 'Bulk message job completed');
  }

  /** GET /backoffice/messaging/bulk/:id */
  static async getBulkJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { BulkMessageJob } = await import('./bulk-message-job.model');
      const job = await BulkMessageJob.findById(req.params.id).lean();
      if (!job) return res.status(404).json({ status: 'failed', message: 'Job not found' });
      return res.status(200).json({ status: 'success', data: job });
    } catch (err) {
      next(err);
    }
  }

  /** GET /backoffice/messaging/bulk - recent jobs (no recipient list, for a history table) */
  static async listBulkJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const { BulkMessageJob } = await import('./bulk-message-job.model');
      const jobs = await BulkMessageJob.find({}, { recipients: 0 }).sort({ createdAt: -1 }).limit(15).lean();
      return res.status(200).json({ status: 'success', data: jobs });
    } catch (err) {
      next(err);
    }
  }
}
