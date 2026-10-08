import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { envValidationSchema } from '../../config/env.validation';
import { OtpService, TEST_OTP } from './otp.service';
import type { OtpDocument } from './schemas/otp.schema';
import type { SmsProvider } from './providers/sms.provider';

/** An OtpService whose stored code is `real`, under the given OTP_MODE. */
async function serviceFor(mode: 'test' | 'twilio', real = '987654') {
  const otp = {
    phone: '9876543210',
    codeHash: await bcrypt.hash(real, 4),
    consumed: false,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const model = {
    findById: () => ({ select: () => ({ exec: () => Promise.resolve(otp) }) }),
  } as unknown as Model<OtpDocument>;
  const values: Record<string, unknown> = { 'otp.mode': mode, 'otp.maxAttempts': 5 };
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as ConfigService;
  return new OtpService(model, config, {} as SmsProvider);
}

const id = new Types.ObjectId().toString();

describe('OTP_MODE', () => {
  it('test: 123456 logs in', async () => {
    await expect((await serviceFor('test')).verify(id, TEST_OTP)).resolves.toBe('9876543210');
  });

  it('test: the real code still works too', async () => {
    await expect((await serviceFor('test')).verify(id, '987654')).resolves.toBe('9876543210');
  });

  it('twilio: 123456 is just a wrong code', async () => {
    await expect((await serviceFor('twilio')).verify(id, TEST_OTP)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('twilio: the SMS code logs in', async () => {
    await expect((await serviceFor('twilio')).verify(id, '987654')).resolves.toBe('9876543210');
  });

  describe('boot validation', () => {
    const base = {
      MONGO_URI: 'mongodb://x',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    };

    it('defaults to test', () => {
      expect(envValidationSchema.validate(base).value.OTP_MODE).toBe('test');
    });

    it('refuses twilio without its credentials', () => {
      expect(envValidationSchema.validate({ ...base, OTP_MODE: 'twilio' }).error).toBeDefined();
    });

    it('accepts twilio with its credentials', () => {
      const { error } = envValidationSchema.validate({
        ...base,
        OTP_MODE: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC1',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_FROM_NUMBER: '+15550000000',
      });
      expect(error).toBeUndefined();
    });

    it('rejects anything but test or twilio', () => {
      expect(envValidationSchema.validate({ ...base, OTP_MODE: 'sms' }).error).toBeDefined();
    });
  });
});
