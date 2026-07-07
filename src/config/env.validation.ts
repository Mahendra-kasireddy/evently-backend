import * as Joi from 'joi';

/**
 * Validates process.env at boot. The app refuses to start if anything
 * required is missing or malformed — fail fast instead of at first request.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api'),

  // Mongo
  MONGO_URI: Joi.string().required(),
  MONGO_DB_NAME: Joi.string().optional(),

  // Redis / BullMQ
  REDIS_HOST: Joi.string().default('127.0.0.1'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().default(0),
  BULLMQ_PREFIX: Joi.string().default('evently'),

  // JWT — secrets must be strong (>=32 chars); rejects scaffolding placeholders at boot.
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('1h'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // OTP
  OTP_DELIVERY: Joi.string().valid('stub', 'sms').default('stub'),
  OTP_LENGTH: Joi.number().default(6),
  OTP_TTL_SECONDS: Joi.number().default(300),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().default(15),
  OTP_MAX_ACTIVE: Joi.number().default(5),
  OTP_DEFAULT_DIAL_CODE: Joi.string().default('+91'),
  OTP_SMS_API_KEY: Joi.string().allow('').optional(),

  // Socket.IO
  SOCKET_IO_PATH: Joi.string().default('/socket.io'),
  SOCKET_IO_CORS_ORIGIN: Joi.string().default('*'),
  WS_NAMESPACE: Joi.string().default('/ws'),
  YJS_NAMESPACE: Joi.string().default('/yjs'),

  // Mail (Nodemailer) — optional until you wire the provider
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_SECURE: Joi.boolean().optional(),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().optional(),

  // SMS (Twilio) — optional
  TWILIO_ACCOUNT_SID: Joi.string().allow('').optional(),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').optional(),
  TWILIO_FROM_NUMBER: Joi.string().allow('').optional(),

  // Push (Firebase) — optional
  FIREBASE_PROJECT_ID: Joi.string().allow('').optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('').optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').optional(),
});
