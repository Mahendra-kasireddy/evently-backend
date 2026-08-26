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
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  otp: {
    delivery: process.env.OTP_DELIVERY ?? 'stub',
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

  // Reusable file-upload module. `driver=s3` for any S3-compatible store
  // (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO); `driver=local` for
  // development only (files written under `local.dir`, served via /upload/file).
  upload: {
    driver: process.env.UPLOAD_DRIVER ?? 'local',
    // Public base URL used to build returned file URLs (e.g. CDN / bucket host).
    publicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined, // set for R2/Spaces/MinIO
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      // Path-style is required by MinIO and some S3-compatible providers.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    },
    local: {
      dir: process.env.UPLOAD_LOCAL_DIR ?? 'uploads',
    },
  },
});
