import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Sends the login code — or, in OTP_MODE=test, deliberately does not.
 *
 * `test`   → nothing is sent; the code is logged and 123456 is accepted
 *            (see OtpService). For local work and APK testing.
 * `twilio` → a real SMS through Twilio's Messages API, using TWILIO_ACCOUNT_SID,
 *            TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (required at boot in
 *            this mode — see env.validation).
 */
@Injectable()
export class SmsProvider implements OnModuleInit {
  private readonly logger = new Logger(SmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const mode = this.config.get<string>('otp.mode');
    if (mode === 'twilio') {
      this.logger.log('OTP_MODE=twilio — login codes are sent by SMS.');
      return;
    }
    // Loud on purpose: test mode on a live server means 123456 opens any account.
    const say = this.config.get<string>('env') === 'production' ? 'warn' : 'log';
    this.logger[say]('OTP_MODE=test — no SMS is sent and 123456 logs in to any number.');
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    if (this.config.get<string>('otp.mode') === 'twilio') {
      return this.sendViaTwilio(phone, code);
    }
    this.logger.warn(`[OTP][test] code for ${phone} is ${code} (no SMS sent)`);
  }

  /** "+919876543210" from the 10-digit number the app sends. */
  private toE164(phone: string): string {
    if (phone.startsWith('+')) return phone;
    const dial = this.config.get<string>('otp.defaultDialCode', '+91');
    return `${dial}${phone}`;
  }

  private async sendViaTwilio(phone: string, code: string): Promise<void> {
    const sid = this.config.get<string>('twilio.accountSid') ?? '';
    const token = this.config.get<string>('twilio.authToken') ?? '';
    const from = this.config.get<string>('twilio.fromNumber') ?? '';
    const minutes = Math.round(this.config.get<number>('otp.ttlSeconds', 300) / 60);

    const body = new URLSearchParams({
      To: this.toE164(phone),
      From: from,
      Body: `${code} is your Evently login code. It expires in ${minutes} minutes. Do not share it with anyone.`,
    });

    let response: Response;
    try {
      response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (err) {
      this.logger.error(`Twilio unreachable: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Could not send the code. Please try again.');
    }

    if (!response.ok) {
      // Twilio's own reason (bad number, unverified trial recipient, …) for the
      // logs; never the code, never the credentials.
      const detail = await response.text().catch(() => '');
      this.logger.error(`Twilio refused the SMS (${response.status}): ${detail.slice(0, 300)}`);
      throw new ServiceUnavailableException('Could not send the code. Please try again.');
    }
  }
}
