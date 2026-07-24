import { Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { StorageDriver } from '../interfaces/storage-driver.interface';

export interface S3DriverConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl?: string;
}

/**
 * S3-compatible storage driver. Works with AWS S3, Cloudflare R2, DigitalOcean
 * Spaces and MinIO — the differences are all expressed through env (endpoint,
 * region, path-style). Objects are written with a long cache header; the URL is
 * derived from the public base URL when provided, else the bucket/endpoint host.
 */
export class S3StorageDriver implements StorageDriver {
  private readonly logger = new Logger(S3StorageDriver.name);
  private readonly client: S3Client;

  constructor(private readonly cfg: S3DriverConfig) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return this.urlFor(key);
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    } catch (err) {
      // Deletion is best-effort — never let an orphaned object break a flow.
      this.logger.warn(`Failed to delete S3 object "${key}": ${String(err)}`);
    }
  }

  private urlFor(key: string): string {
    if (this.cfg.publicBaseUrl) {
      return `${this.cfg.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
    }
    if (this.cfg.endpoint) {
      const host = this.cfg.endpoint.replace(/\/+$/, '');
      return this.cfg.forcePathStyle ? `${host}/${this.cfg.bucket}/${key}` : `${host}/${key}`;
    }
    return `https://${this.cfg.bucket}.s3.${this.cfg.region}.amazonaws.com/${key}`;
  }
}
