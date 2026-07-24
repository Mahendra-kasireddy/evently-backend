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
