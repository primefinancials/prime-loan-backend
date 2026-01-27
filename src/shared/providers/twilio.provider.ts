import { Twilio } from 'twilio';
import pino from 'pino';

const logger = pino({ name: 'twilio-provider' });

export class TwilioProvider {
    private client: Twilio;
    private fromNumber: string;

    constructor() {
        // These should be set in environment variables
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        this.fromNumber = process.env.TWILIO_FROM_NUMBER || '';

        if (accountSid && authToken) {
            this.client = new Twilio(accountSid, authToken);
        } else {
            logger.warn('Twilio credentials not found. Default call provider will be disabled.');
            this.client = null as any;
        }
    }

    /**
     * Initiate a call to a user
     * @param to Phone number to call
     * @param message Message to speak
     */
    async makeCall(to: string, message: string) {
        if (!this.client || !this.fromNumber) {
            throw new Error('Twilio is not configured');
        }

        try {
            const call = await this.client.calls.create({
                twiml: `<Response><Say>${message}</Say></Response>`,
                to,
                from: this.fromNumber,
            });

            logger.info({ sid: call.sid, to }, 'Twilio call initiated');
            return call.sid;
        } catch (error: any) {
            logger.error({ error: error.message, to }, 'Failed to initiate Twilio call');
            throw error;
        }
    }
}
