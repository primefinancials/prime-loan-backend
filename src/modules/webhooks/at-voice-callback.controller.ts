/**
 * Africa's Talking Voice Callback Controller
 * 
 * When AT connects an outbound call and the user answers,
 * AT sends a POST to this endpoint asking "what should I say?"
 * We respond with XML containing a <Say> tag with the recovery message.
 *
 * POST /webhooks/africastalking/voice
 */
import { Request, Response } from 'express';
import pino from 'pino';

const logger = pino({ name: 'at-voice-callback' });

/**
 * In-memory store for pending call messages.
 * Key: sessionId (from AT), Value: message to speak.
 * Entries auto-expire after 5 minutes.
 */
const callMessageStore = new Map<string, { message: string; timestamp: number }>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of callMessageStore.entries()) {
    if (value.timestamp < fiveMinutesAgo) {
      callMessageStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export class ATVoiceCallbackController {

  /**
   * Store a message for a pending call session
   * Called by AfricasTalkingVoiceProvider before making the call.
   */
  static storeCallMessage(sessionId: string, message: string): void {
    callMessageStore.set(sessionId, { message, timestamp: Date.now() });
    logger.info({ sessionId }, 'Call message stored');
  }

  /**
   * Retrieve and consume a stored message
   */
  static getCallMessage(sessionId: string): string | null {
    const entry = callMessageStore.get(sessionId);
    if (entry) {
      callMessageStore.delete(sessionId); // One-time use
      return entry.message;
    }
    return null;
  }

  /**
   * POST /webhooks/africastalking/voice
   * 
   * AT sends:
   * - isActive: '1' when call is active, '0' when ended
   * - sessionId: unique session identifier
   * - callerNumber: the number that placed the call
   * - destinationNumber: the user's number
   * - direction: 'Outbound'
   * - dtmfDigits: (optional) if user pressed any digits
   */
  static async handleCallback(req: Request, res: Response) {
    const { sessionId, isActive, direction } = req.body;

    logger.info({ sessionId, isActive, direction }, 'AT voice callback received');

    // If call has ended, nothing to do
    if (isActive === '0' || isActive === 0) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
      res.set('Content-Type', 'application/xml');
      return res.send(xml);
    }

    // Look up the stored message for this session
    const message = ATVoiceCallbackController.getCallMessage(sessionId);

    if (!message) {
      // Fallback message if store miss
      logger.warn({ sessionId }, 'No stored message found for session — using default');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="en-US-Standard-C">This is a reminder from Prime Finance. Please log in to your account for important updates. Thank you.</Say>
</Response>`;
      res.set('Content-Type', 'application/xml');
      return res.send(xml);
    }

    // Return the custom message as TTS
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="en-US-Standard-C">${escapeXml(message)}</Say>
</Response>`;

    res.set('Content-Type', 'application/xml');
    return res.send(xml);
  }
}

/**
 * Escape XML special characters in user-generated text
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
