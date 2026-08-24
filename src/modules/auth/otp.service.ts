import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';

import { Otp, OtpDocument, OtpPurpose } from './schemas/otp.schema';
import { SmsProvider } from './providers/sms.provider';

export interface IssuedOtp {
  requestId: string;
  sentTo: string;
  /** Present only in non-production (stub) mode, so the flow is testable. */
  devCode?: string;
}

@Injectable()
export class OtpService {
  constructor(
    @InjectModel(Otp.name) private readonly otpModel: Model<OtpDocument>,
    private readonly config: ConfigService,
    private readonly sms: SmsProvider,
  ) {}

  /** Generates, stores (hashed), and delivers an OTP for a phone number. */
  async issue(phone: string): Promise<IssuedOtp> {
    const length = this.config.get<number>('otp.length', 6);
    const ttl = this.config.get<number>('otp.ttlSeconds', 300);

    // Phone-based abuse protection (anti SMS-bombing), on top of per-IP throttling.
    await this.assertPhoneNotThrottled(phone);

    const code = this.generateCode(length);
    const codeHash = await bcrypt.hash(code, 10);

    const doc = await this.otpModel.create({
      phone,
      codeHash,
      purpose: OtpPurpose.LOGIN,
      expiresAt: new Date(Date.now() + ttl * 1000),
    });

    await this.sms.sendOtp(phone, code);

    const isProd = this.config.get<string>('env') === 'production';
    return {
      requestId: doc._id.toString(),
      sentTo: this.mask(phone),
      devCode: isProd ? undefined : code,
    };
  }

  /**
   * Verifies a code against an issued OTP. Returns the phone on success.
   * Enforces single-use, expiry, and a max-attempts ceiling.
   */
  async verify(requestId: string, code: string): Promise<string> {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new NotFoundException('Invalid or expired OTP request');
    }
    const otp = await this.otpModel.findById(requestId).select('+codeHash').exec();
    if (!otp) throw new NotFoundException('Invalid or expired OTP request');
    if (otp.consumed) throw new GoneException('This code has already been used');
    if (otp.expiresAt.getTime() < Date.now()) throw new GoneException('Code has expired');

    const maxAttempts = this.config.get<number>('otp.maxAttempts', 5);
    if (otp.attempts >= maxAttempts) {
      throw new HttpException(
        'Too many attempts — request a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Non-production convenience: a fixed master code so manual/browser
    // testing doesn't depend on reading the real per-request devCode.
    const isProd = this.config.get<string>('env') === 'production';
    const isMasterCode = !isProd && code === '123456';

    const matches = isMasterCode || (await bcrypt.compare(code, otp.codeHash));
    if (!matches) {
      otp.attempts += 1;
      await otp.save();
      throw new BadRequestException('Incorrect code');
    }

    otp.consumed = true;
    await otp.save();
    return otp.phone;
  }

  /**
   * Per-phone abuse guard (anti SMS-bombing). Uses the existing `otps` collection:
   *  - resend cooldown: no new code while a recent un-consumed one is still young
   *  - active cap: too many un-consumed, non-expired codes for one phone
   * Both raise HTTP 429; per-IP limits are enforced separately by the throttler.
   */
  private async assertPhoneNotThrottled(phone: string): Promise<void> {
    const cooldown = this.config.get<number>('otp.resendCooldownSeconds', 15);
    const maxActive = this.config.get<number>('otp.maxActive', 5);
    const now = Date.now();

    const recent = await this.otpModel
      .findOne({ phone, consumed: false })
      .sort({ createdAt: -1 })
      .exec();
    if (recent) {
      const createdAt = recent.get('createdAt') as Date | undefined;
      const ageMs = createdAt ? now - createdAt.getTime() : cooldown * 1000;
      if (ageMs < cooldown * 1000) {
        const wait = Math.ceil((cooldown * 1000 - ageMs) / 1000);
        throw new HttpException(
          `Please wait ${wait}s before requesting another code`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const active = await this.otpModel.countDocuments({
      phone,
      consumed: false,
      expiresAt: { $gt: new Date(now) },
    });
    if (active >= maxActive) {
      throw new HttpException(
        'Too many OTP requests for this number — try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private generateCode(length: number): string {
    const max = 10 ** length;
    const n = Math.floor(Math.random() * max);
    return n.toString().padStart(length, '0');
  }

  /** +91 98765 43210 -> +91 ***** 43210 */
  private mask(phone: string): string {
    if (phone.length < 4) return phone;
    return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
  }
}
