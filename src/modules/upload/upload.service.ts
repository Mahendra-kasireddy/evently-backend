import { BadRequestException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { imageSize } from 'image-size';

import {
  DeleteOutcome,
  StorageDriver,
  StoredObject,
  StoredRef,
  UploadedFileMeta,
} from './interfaces/storage-driver.interface';
import { MediaAsset, MediaAssetStatus } from './schemas/media-asset.schema';
import { CloudinaryStorageDriver } from './drivers/cloudinary.driver';
import { LocalStorageDriver } from './drivers/local.driver';
import { UPLOAD_RULES, UploadPurpose, UploadRule } from './upload.constants';

/** Minimal shape of a multer file — avoids a hard dependency on the Express types. */
export interface IncomingFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Generic, reusable upload service. Validates against per-purpose rules, then
 * delegates persistence to a swappable storage driver (Cloudinary in
 * production, local disk in development). Returns metadata only — file bytes
 * never touch Mongo.
 */
@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  private driver!: StorageDriver;
  private local?: LocalStorageDriver;

  constructor(
    private readonly config: ConfigService,
    /*
     * Where each stored file is recorded (see MediaAsset). Optional so a
     * caller without Mongo — a unit test, a script — can still upload; such
     * files simply go unrecorded, which means they are never auto-deleted.
     */
    @Optional()
    @InjectModel(MediaAsset.name)
    private readonly assets?: Model<MediaAsset>,
  ) {}

  onModuleInit(): void {
    const driver = this.config.get<string>('upload.driver', 'local');

    if (driver === 'cloudinary') {
      // Throws on missing credentials — env validation already requires them,
      // this is the second line for a misconfigured ConfigService.
      this.driver = new CloudinaryStorageDriver({
        cloudName: this.config.get<string>('upload.cloudinary.cloudName', ''),
        apiKey: this.config.get<string>('upload.cloudinary.apiKey', ''),
        apiSecret: this.config.get<string>('upload.cloudinary.apiSecret', ''),
        folder: this.config.get<string>('upload.cloudinary.folder', 'evently'),
      });
      this.logger.log('Upload driver: cloudinary');
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      // env.validation refuses this too; kept so a test or script that skips
      // validation still cannot quietly write production files to a wiped disk.
      throw new Error(
        'UPLOAD_DRIVER=local is not allowed in production: the container disk is wiped on every deploy. ' +
          'Set UPLOAD_DRIVER=cloudinary with CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
      );
    }
    const dir = this.config.get<string>('upload.local.dir', 'uploads');
    const publicBaseUrl = this.config.get<string>('upload.publicBaseUrl', '');
    this.local = new LocalStorageDriver(dir, publicBaseUrl);
    this.driver = this.local;
    this.logger.log(`Upload driver: local (${dir})`);
  }

  /**
   * Validates and stores one file, returning its metadata. `ownerId` is the
   * signed-in uploader (from the JWT, never the request body); guest uploads
   * pass none.
   */
  async upload(
    file: IncomingFile | undefined,
    purpose: UploadPurpose,
    ownerId?: string,
  ): Promise<UploadedFileMeta> {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('No file provided');
    }
    const rule = UPLOAD_RULES[purpose];
    if (!rule) throw new BadRequestException('Unsupported upload purpose');

    this.validate(file, rule);

    const ext = this.extensionOf(file.originalname);
    const now = new Date();
    const key = `${purpose}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(
      2,
      '0',
    )}/${randomUUID()}.${ext}`;

    const stored = await this.driver.put(key, file.buffer, file.mimetype);
    await this.record(key, stored, purpose, ownerId);

    return {
      fileName: key.split('/').pop() as string,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: stored.url,
      key,
      uploadedAt: now.toISOString(),
      provider: stored.provider,
      publicId: stored.publicId,
      resourceType: stored.resourceType,
      format: stored.format,
      width: stored.width,
      height: stored.height,
      duration: stored.duration,
    };
  }

  /**
   * A derived copy of something already uploaded — a thumbnail, a smaller
   * display rendition — stored beside its original.
   *
   * The key is the original's with a suffix before the extension, so the three
   * files sort together, the relationship is readable in a bucket listing, and
   * deleting an original tells you exactly what else to delete. It goes through
   * the same driver as everything else: this exposes the existing storage
   * rather than being a second one.
   */
  async putVariant(
    originalKey: string,
    suffix: string,
    body: Buffer,
    extension: string,
    contentType: string,
  ): Promise<{ key: string; url: string }> {
    if (!originalKey) throw new BadRequestException('A variant needs an original');
    /* Strip the original's extension rather than appending to it, so a key
       reads `…/<uuid>.thumb.webp` and not `…/<uuid>.jpg.thumb.webp`. */
    const base = originalKey.replace(/\.[^./]+$/, '');
    const key = `${base}.${suffix}.${extension}`;
    const stored = await this.driver.put(key, body, contentType);
    await this.record(key, stored, 'variant');
    return { key, url: stored.url };
  }

  /**
   * Removes a previously uploaded object (best-effort, never throws) — for
   * flows that own their files outright, like an invitation's memories. A
   * failure is recorded so the cleanup script can retry it.
   */
  async remove(key: string): Promise<void> {
    try {
      const asset = await this.assets?.findOne({ key }).lean().exec();
      await this.deleteStored({
        key,
        publicId: asset?.publicId,
        resourceType: asset?.resourceType,
      });
      await this.assets
        ?.updateOne(
          { key },
          { status: MediaAssetStatus.DELETED, deletedAt: new Date(), lastError: '' },
        )
        .exec();
    } catch (err) {
      const message = errorText(err);
      this.logger.warn(`Failed to delete stored file "${key}": ${message}`);
      await this.assets
        ?.updateOne(
          { key },
          {
            status: MediaAssetStatus.DELETE_FAILED,
            lastError: message,
            lastAttemptAt: new Date(),
            $inc: { deleteAttempts: 1 },
          },
        )
        .exec()
        .catch(() => undefined);
    }
  }

  /** Strict deletion through the configured driver — throws on failure. */
  deleteStored(ref: StoredRef): Promise<DeleteOutcome> {
    return this.driver.delete(ref);
  }

  /**
   * Records a stored file. Never fails the upload: a file that could not be
   * recorded is merely untracked, and untracked files are never auto-deleted.
   */
  private async record(
    key: string,
    stored: StoredObject,
    purpose: string,
    ownerId?: string,
  ): Promise<void> {
    if (!this.assets) return;
    try {
      await this.assets.create({
        key,
        url: stored.url,
        provider: stored.provider,
        publicId: stored.publicId ?? '',
        resourceType: stored.resourceType ?? '',
        purpose,
        owner: ownerId && Types.ObjectId.isValid(ownerId) ? new Types.ObjectId(ownerId) : null,
      });
    } catch (err) {
      this.logger.warn(`Could not record stored file "${key}": ${errorText(err)}`);
    }
  }

  /** A locally-stored file's absolute path, traversal-checked. Only valid for the local driver. */
  localPath(key: string): string {
    if (!this.local) throw new BadRequestException('Local file serving is disabled');
    return this.local.pathFor(key);
  }

  get isLocal(): boolean {
    return !!this.local;
  }

  // --- validation -------------------------------------------------------------

  private validate(file: IncomingFile, rule: UploadRule): void {
    if (file.size > rule.maxBytes) {
      throw new BadRequestException(
        `File too large — max ${(rule.maxBytes / (1024 * 1024)).toFixed(0)}MB`,
      );
    }
    if (!rule.mimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type "${file.mimetype}"`);
    }
    const ext = this.extensionOf(file.originalname);
    if (!rule.extensions.includes(ext)) {
      throw new BadRequestException(`Unsupported file extension ".${ext}"`);
    }
    if (rule.image) {
      let dims: { width?: number; height?: number };
      try {
        dims = imageSize(file.buffer);
      } catch {
        throw new BadRequestException('Invalid or corrupt image file');
      }
      const { width, height } = dims;
      if (!width || !height) throw new BadRequestException('Could not read image dimensions');
      const r = rule.image;
      if (r.minWidth && width < r.minWidth) {
        throw new BadRequestException(`Image width must be at least ${r.minWidth}px`);
      }
      if (r.minHeight && height < r.minHeight) {
        throw new BadRequestException(`Image height must be at least ${r.minHeight}px`);
      }
      if (r.maxWidth && width > r.maxWidth) {
        throw new BadRequestException(`Image width must be at most ${r.maxWidth}px`);
      }
      if (r.maxHeight && height > r.maxHeight) {
        throw new BadRequestException(`Image height must be at most ${r.maxHeight}px`);
      }
    }
  }

  private extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  }
}

/** An error's message, without its stack or any request options. */
export function errorText(err: unknown): string {
  const e = err as { message?: string; http_code?: number };
  const text = (e?.message ?? String(err ?? 'unknown error')).slice(0, 300);
  return e?.http_code ? `${text} [http ${e.http_code}]` : text;
}
