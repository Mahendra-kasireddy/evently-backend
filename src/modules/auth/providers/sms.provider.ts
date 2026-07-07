import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SMS delivery seam. Today it supports a 'stub' mode that logs the code
 * (so the OTP flow is fully testable without a paid SMS account).
 *
 * To go live: set OTP_DELIVERY=sms and implement sendViaProvider() for your
 * provider (MSG91 / 2Factor / Twilio) using OTP_SMS_API_KEY.
 */
@Injectable()
export class SmsProvider {
  private readonly logger = new Logger(SmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const mode = this.config.get<string>('otp.delivery');
    if (mode === 'sms') {
      return this.sendViaProvider(phone, code);
    }
    // stub mode
    this.logger.warn(`[OTP][stub] code for ${phone} is ${code} (delivery disabled)`);
  }

  private async sendViaProvider(phone: string, code: string): Promise<void> {
    // const apiKey = this.config.get<string>('otp.smsApiKey');
    // TODO: real HTTP call to the SMS provider once the provider is confirmed.
    this.logger.error(
      `OTP_DELIVERY=sms but no provider is wired yet. Would have sent ${code} to ${phone}.`,
    );
    throw new Error('SMS provider not configured');
  }
}
