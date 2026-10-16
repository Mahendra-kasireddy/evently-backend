import { BadGatewayException, BadRequestException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import { envValidationSchema } from '../../config/env.validation';
import configuration from '../../config/configuration';
import { UserService } from '../user/user.service';
import { UploadService } from './upload.service';
import { UploadPurpose } from './upload.constants';

/*
 * Cloudinary is mocked at the module boundary: no request leaves the test.
 * Each upload "succeeds" by echoing back what a real upload returns, built
 * from the options it was given.
 */
jest.mock('cloudinary', () => {
  const uploader = {
    upload_stream: jest.fn(),
    upload_chunked_stream: jest.fn(),
    destroy: jest.fn(),
  };
  return { v2: { config: jest.fn(), uploader } };
});

const uploader = cloudinary.uploader as unknown as {
  upload_stream: jest.Mock;
  upload_chunked_stream: jest.Mock;
  destroy: jest.Mock;
};

const SECRET = 'super-secret-value';

type Opts = { public_id: string; resource_type: string; chunk_size?: number };

/** A stream whose `end()` answers like Cloudinary. */
function answering(response: (o: Opts) => unknown, error?: unknown) {
  return (options: Opts, done: (e?: unknown, r?: unknown) => void) => ({
    end: () => (error ? done(error) : done(undefined, response(options))),
  });
}

const ok = (o: Opts) => ({
  secure_url: `https://res.cloudinary.com/demo/${o.resource_type}/upload/v1/${o.public_id}`,
  public_id: o.public_id,
  format: o.resource_type === 'video' ? 'mp4' : 'png',
  width: o.resource_type === 'raw' ? undefined : 640,
  height: o.resource_type === 'raw' ? undefined : 480,
  duration: o.resource_type === 'video' ? 12.5 : undefined,
});

function serviceWith(values: Record<string, unknown>): UploadService {
  const config = {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as unknown as ConfigService;
  const service = new UploadService(config);
  service.onModuleInit();
  return service;
}

const cloudinaryService = () =>
  serviceWith({
    'upload.driver': 'cloudinary',
    'upload.cloudinary.cloudName': 'demo',
    'upload.cloudinary.apiKey': 'key',
    'upload.cloudinary.apiSecret': SECRET,
    'upload.cloudinary.folder': 'evently',
  });

let png: Buffer;
beforeAll(async () => {
  png = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 80, b: 120 } },
  })
    .png()
    .toBuffer();
});

beforeEach(() => {
  jest.clearAllMocks();
  uploader.upload_stream.mockImplementation(answering(ok));
  uploader.upload_chunked_stream.mockImplementation(answering(ok));
  uploader.destroy.mockResolvedValue({ result: 'ok' });
});

const image = () => ({
  originalname: 'me.png',
  mimetype: 'image/png',
  size: png.length,
  buffer: png,
});

describe('UploadService on Cloudinary', () => {
  it('configures the SDK once, over https, with the given credentials', () => {
    cloudinaryService();
    expect(cloudinary.config).toHaveBeenCalledWith({
      cloud_name: 'demo',
      api_key: 'key',
      api_secret: SECRET,
      secure: true,
    });
  });

  it('uploads an image and returns its https URL and metadata', async () => {
    const meta = await cloudinaryService().upload(image(), UploadPurpose.PROFILE_IMAGE);

    const [options] = uploader.upload_stream.mock.calls[0];
    expect(options.resource_type).toBe('image');
    // The storage key keeps its shape; the public_id is the key under the
    // folder, without the extension.
    expect(meta.key).toMatch(/^profileImage\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    expect(options.public_id).toBe(`evently/${meta.key.replace(/\.png$/, '')}`);
    expect(meta.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(meta).toMatchObject({
      provider: 'cloudinary',
      resourceType: 'image',
      publicId: options.public_id,
      width: 640,
      height: 480,
      mimeType: 'image/png',
      originalName: 'me.png',
    });
  });

  it('uploads a small video in one request', async () => {
    const meta = await cloudinaryService().upload(
      {
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        size: 1024,
        buffer: Buffer.alloc(1024, 1),
      },
      UploadPurpose.MEMORY_VIDEO,
    );
    expect(uploader.upload_stream).toHaveBeenCalledTimes(1);
    expect(uploader.upload_stream.mock.calls[0][0].resource_type).toBe('video');
    expect(meta).toMatchObject({ resourceType: 'video', duration: 12.5 });
  });

  it('sends a large video in chunks', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 1);
    await cloudinaryService().upload(
      { originalname: 'reel.mov', mimetype: 'video/quicktime', size: big.length, buffer: big },
      UploadPurpose.VIDEO,
    );
    expect(uploader.upload_stream).not.toHaveBeenCalled();
    const [options] = uploader.upload_chunked_stream.mock.calls[0];
    expect(options).toMatchObject({ resource_type: 'video', chunk_size: 20 * 1024 * 1024 });
  });

  it('stores a PDF as a raw asset, keeping its extension', async () => {
    const pdf = Buffer.from('%PDF-1.4 test');
    const meta = await cloudinaryService().upload(
      { originalname: 'pan.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf },
      UploadPurpose.PAN,
    );
    const [options] = uploader.upload_stream.mock.calls[0];
    expect(options.resource_type).toBe('raw');
    expect(options.public_id).toBe(`evently/${meta.key}`);
    expect(options.public_id.endsWith('.pdf')).toBe(true);
  });

  it('turns a Cloudinary failure into a 502 and never logs the secret', async () => {
    uploader.upload_stream.mockImplementation(
      answering(ok, { message: 'Invalid Signature', http_code: 401 }),
    );
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      cloudinaryService().upload(image(), UploadPurpose.PROFILE_IMAGE),
    ).rejects.toBeInstanceOf(BadGatewayException);

    const lines = logged.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('Invalid Signature');
    expect(lines).not.toContain(SECRET);
    logged.mockRestore();
  });

  it('still validates type, size and dimensions before anything is sent', async () => {
    const service = cloudinaryService();
    await expect(
      service.upload(
        { ...image(), mimetype: 'image/gif', originalname: 'x.gif' },
        UploadPurpose.GALLERY,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upload({ ...image(), size: 9 * 1024 * 1024 }, UploadPurpose.PROFILE_IMAGE),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Under the profile photo's 100×100 minimum.
    const tiny = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(
      service.upload(
        { originalname: 't.png', mimetype: 'image/png', size: tiny.length, buffer: tiny },
        UploadPurpose.PROFILE_IMAGE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(undefined, UploadPurpose.GALLERY)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(uploader.upload_stream).not.toHaveBeenCalled();
  });

  it('stores a rendition beside its original', async () => {
    const { key, url } = await cloudinaryService().putVariant(
      'memoryPhoto/2026/10/abc.jpg',
      'thumb',
      png,
      'webp',
      'image/webp',
    );
    expect(key).toBe('memoryPhoto/2026/10/abc.thumb.webp');
    expect(url).toMatch(/^https:\/\//);
    expect(uploader.upload_stream.mock.calls[0][0].public_id).toBe(
      'evently/memoryPhoto/2026/10/abc.thumb',
    );
  });

  it('deletes by the same public_id and resource type it stored under', async () => {
    const service = cloudinaryService();
    await service.remove('memoryVideo/2026/10/abc.mp4');
    await service.remove('pan/2026/10/doc.pdf');
    expect(uploader.destroy).toHaveBeenNthCalledWith(1, 'evently/memoryVideo/2026/10/abc', {
      resource_type: 'video',
      invalidate: true,
    });
    expect(uploader.destroy).toHaveBeenNthCalledWith(2, 'evently/pan/2026/10/doc.pdf', {
      resource_type: 'raw',
      invalidate: true,
    });
  });

  it('treats a failed delete as best-effort', async () => {
    uploader.destroy.mockRejectedValue(new Error('network'));
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(cloudinaryService().remove('gallery/2026/10/a.png')).resolves.toBeUndefined();
    warned.mockRestore();
  });

  it('serves no local files under Cloudinary', () => {
    const service = cloudinaryService();
    expect(service.isLocal).toBe(false);
    expect(() => service.localPath('gallery/a.png')).toThrow(BadRequestException);
  });

  it('refuses to start without credentials', () => {
    expect(() =>
      serviceWith({ 'upload.driver': 'cloudinary', 'upload.cloudinary.cloudName': 'demo' }),
    ).toThrow(/CLOUDINARY_API_KEY/);
  });
});

describe('UploadService driver selection', () => {
  const previous = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = previous;
  });

  it('refuses the local disk in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => serviceWith({ 'upload.driver': 'local' })).toThrow(/not allowed in production/);
  });

  it('keeps the local disk for development', () => {
    process.env.NODE_ENV = 'development';
    expect(serviceWith({ 'upload.driver': 'local' }).isLocal).toBe(true);
  });
});

describe('upload env validation', () => {
  const base = {
    MONGO_URI: 'mongodb://x',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };
  const creds = {
    CLOUDINARY_CLOUD_NAME: 'demo',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
  };

  it('defaults to local in development', () => {
    expect(envValidationSchema.validate(base).value.UPLOAD_DRIVER).toBe('local');
  });

  it('defaults to cloudinary in production, and then needs its credentials', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(envValidationSchema.validate(prod).error?.message).toMatch(/CLOUDINARY_CLOUD_NAME/);
    const { error, value } = envValidationSchema.validate({ ...prod, ...creds });
    expect(error).toBeUndefined();
    expect(value.UPLOAD_DRIVER).toBe('cloudinary');
  });

  it('refuses the local driver in production', () => {
    const { error } = envValidationSchema.validate({
      ...base,
      ...creds,
      NODE_ENV: 'production',
      UPLOAD_DRIVER: 'local',
    });
    expect(error?.message).toMatch(/not allowed in production/);
  });

  it('refuses cloudinary without each credential', () => {
    for (const missing of Object.keys(creds)) {
      const partial: Record<string, string> = { ...creds };
      delete partial[missing];
      const { error } = envValidationSchema.validate({
        ...base,
        UPLOAD_DRIVER: 'cloudinary',
        ...partial,
      });
      expect(error?.message).toContain(missing);
    }
  });

  it('no longer accepts the removed s3 driver', () => {
    expect(envValidationSchema.validate({ ...base, UPLOAD_DRIVER: 's3' }).error).toBeDefined();
  });
});

describe('upload configuration', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('points the upload host at the Cloudinary cloud, so its photos count as ours', () => {
    process.env.UPLOAD_DRIVER = 'cloudinary';
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    delete process.env.UPLOAD_PUBLIC_BASE_URL;
    const upload = configuration().upload;
    expect(upload.publicBaseUrl).toBe('https://res.cloudinary.com/demo');

    const users = new UserService(
      {} as never,
      {} as never,
      { get: () => upload.publicBaseUrl } as unknown as ConfigService,
    );
    expect(() =>
      users.assertOwnUpload('https://res.cloudinary.com/demo/image/upload/v1/evently/a.png'),
    ).not.toThrow();
    expect(() => users.assertOwnUpload('https://evil.example.com/a.png')).toThrow(
      BadRequestException,
    );
  });

  it('defaults the driver by environment', () => {
    delete process.env.UPLOAD_DRIVER;
    process.env.NODE_ENV = 'production';
    expect(configuration().upload.driver).toBe('cloudinary');
    process.env.NODE_ENV = 'development';
    expect(configuration().upload.driver).toBe('local');
  });
});
