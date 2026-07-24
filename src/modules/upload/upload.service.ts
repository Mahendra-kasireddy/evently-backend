import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { imageSize } from 'image-size';

import { StorageDriver } from './interfaces/storage-driver.interface';
import { UploadedFileMeta } from './interfaces/storage-driver.interface';
import { S3StorageDriver } from './drivers/s3.driver';
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
 * delegates persistence to a swappable storage driver (S3-compatible in prod,
 * local disk in dev). Returns metadata only — file bytes never touch Mongo.
 */
@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  private driver!: StorageDriver;
  private local?: LocalStorageDriver;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const driver = this.config.get<string>('upload.driver', 'local');
    const publicBaseUrl = this.config.get<string>('upload.publicBaseUrl', '');

    if (driver === 's3') {
      this.driver = new S3StorageDriver({
        endpoint: this.config.get<string>('upload.s3.endpoint') || undefined,
        region: this.config.get<string>('upload.s3.region', 'us-east-1'),
        bucket: this.config.get<string>('upload.s3.bucket', ''),
        accessKeyId: this.config.get<string>('upload.s3.accessKeyId', ''),
        secretAccessKey: this.config.get<string>('upload.s3.secretAccessKey', ''),
        forcePathStyle: this.config.get<boolean>('upload.s3.forcePathStyle', false),
        publicBaseUrl,
      });
      this.logger.log('Upload driver: s3');
    } else {
      const dir = this.config.get<string>('upload.local.dir', 'uploads');
      this.local = new LocalStorageDriver(dir, publicBaseUrl);
      this.driver = this.local;
      this.logger.log(`Upload driver: local (${dir})`);
    }
  }

  /** Validates and stores one file, returning its metadata. */
  async upload(file: IncomingFile | undefined, purpose: UploadPurpose): Promise<UploadedFileMeta> {
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

    const url = await this.driver.put(key, file.buffer, file.mimetype);

    return {
      fileName: key.split('/').pop() as string,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url,
      key,
      uploadedAt: now.toISOString(),
    };
  }

  /** Removes a previously uploaded object (best-effort). */
  remove(key: string): Promise<void> {
    return this.driver.remove(key);
  }

  /** Reads a locally-stored file (dev serving route). Only valid for the local driver. */
  readLocal(key: string): Promise<Buffer> {
    if (!this.local) throw new BadRequestException('Local file serving is disabled');
    return this.local.read(key);
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
