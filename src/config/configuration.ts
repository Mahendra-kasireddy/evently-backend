/**
 * Typed configuration namespace. Consume via ConfigService:
 *   configService.get('jwt.accessSecret')
 */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',

  mongo: {
    uri: process.env.MONGO_URI,
    dbName: process.env.MONGO_DB_NAME,
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    prefix: process.env.BULLMQ_PREFIX ?? 'evently',
    /*
     * Managed Redis (Upstash, Redis Cloud, Render's external URL) speaks TLS
     * and advertises itself as `rediss://`. ioredis only negotiates TLS when it
     * is handed a `tls` option, so a plain host/port/password against one of
     * those hangs and then fails the handshake. Set REDIS_TLS=true there; a
     * local redis:7-alpine container needs it off.
     */
    tls: (process.env.REDIS_TLS ?? 'false') === 'true',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  otp: {
    /** 'test' (no SMS, 123456 accepted) or 'twilio' (real SMS). */
    mode: process.env.OTP_MODE === 'twilio' ? 'twilio' : 'test',
    length: parseInt(process.env.OTP_LENGTH ?? '6', 10),
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '15', 10),
    maxActive: parseInt(process.env.OTP_MAX_ACTIVE ?? '5', 10),
    defaultDialCode: process.env.OTP_DEFAULT_DIAL_CODE ?? '+91',
    smsApiKey: process.env.OTP_SMS_API_KEY,
  },

  whatsapp: {
    /**
     * 'handoff' opens the customer's own WhatsApp with the message ready;
     * 'cloud' posts to Meta's Cloud API and needs every value below plus an
     * approved template. Defaults to handoff so the feature works with no
     * external account at all.
     */
    delivery: process.env.WHATSAPP_DELIVERY ?? 'handoff',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME ?? '',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en',
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0',
  },

  /** Where the guest-facing links point. */
  publicUrls: {
    /** The API's own externally reachable base, including the /api prefix. */
    api: process.env.PUBLIC_API_URL ?? '',
    /** The web app, where a guest actually reads the invitation. */
    web: process.env.PUBLIC_WEB_URL ?? '',
    /** Optional store link, included in the WhatsApp message only when set. */
    app: process.env.PUBLIC_APP_LINK ?? '',
  },

  socket: {
    path: process.env.SOCKET_IO_PATH ?? '/socket.io',
    corsOrigin: process.env.SOCKET_IO_CORS_ORIGIN ?? '*',
    wsNamespace: process.env.WS_NAMESPACE ?? '/ws',
    yjsNamespace: process.env.YJS_NAMESPACE ?? '/yjs',
  },

  mail: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.MAIL_FROM,
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },

  /**
   * Razorpay. Absent keys are not an error at boot — the app runs without a
   * gateway and the payment routes say so plainly when they are called, rather
   * than the whole API refusing to start over a feature most requests do not
   * touch. `PaymentService.assertConfigured` is where that is decided.
   */
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    /* Set separately in the Razorpay dashboard; a webhook is verified against
       this, never against the API key secret. */
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },

  // Reusable file-upload module. `driver=cloudinary` in production (images,
  // videos and documents on Cloudinary's CDN); `driver=local` for development
  // only (files written under `local.dir`, served via /upload/file).
  upload: uploadConfig(),
});

/**
 * Upload settings. The driver defaults to Cloudinary in production and to the
 * local disk elsewhere; env validation refuses `local` in production.
 *
 * `publicBaseUrl` is the host every stored file's URL starts with — it is what
 * `UserService.assertOwnUpload` checks a profile photo against. Under
 * Cloudinary it defaults to this cloud's delivery host.
 */
function uploadConfig() {
  const production = process.env.NODE_ENV === 'production';
  const driver = process.env.UPLOAD_DRIVER || (production ? 'cloudinary' : 'local');
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? '';
  const explicitBase = process.env.UPLOAD_PUBLIC_BASE_URL ?? '';
  return {
    driver,
    publicBaseUrl:
      explicitBase ||
      (driver === 'cloudinary' && cloudName ? `https://res.cloudinary.com/${cloudName}` : ''),
    cloudinary: {
      cloudName,
      apiKey: process.env.CLOUDINARY_API_KEY ?? '',
      apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
      folder: process.env.CLOUDINARY_FOLDER || 'evently',
    },
    local: {
      dir: process.env.UPLOAD_LOCAL_DIR ?? 'uploads',
    },
  };
}
