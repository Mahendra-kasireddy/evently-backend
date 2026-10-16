import { BadGatewayException, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiOptions, UploadApiResponse } from 'cloudinary';
import {
  DeleteOutcome,
  StorageDriver,
  StoredObject,
  StoredRef,
} from '../interfaces/storage-driver.interface';

export interface CloudinaryDriverConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Every asset is stored under this folder, so Evently's files sit together. */
  folder?: string;
}

type ResourceType = 'image' | 'video' | 'raw';

/** Videos above this size go up in chunks rather than one request. */
const CHUNKED_ABOVE_BYTES = 20 * 1024 * 1024;
const CHUNK_SIZE = 20 * 1024 * 1024;

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);
const RAW_EXTS = new Set(['pdf']);

/**
 * Cloudinary storage driver — production storage for images, videos and
 * documents, so nothing depends on the API host's (ephemeral) disk.
 *
 * The rest of the app keeps speaking in storage keys
 * (`<purpose>/<yyyy>/<mm>/<uuid>.<ext>`); this driver maps a key to a
 * Cloudinary asset deterministically, so `remove(key)` finds what `put(key)`
 * stored without anything extra being saved:
 *
 *  - images and videos: public_id = `<folder>/<key without extension>`, under
 *    the `image` / `video` resource type;
 *  - PDFs: the `raw` resource type, whose public_id keeps its extension. Raw
 *    rather than image because new Cloudinary accounts refuse to deliver PDFs
 *    stored as images.
 *
 * URLs are always https (`secure_url`). Errors are logged with Cloudinary's
 * message and http code only — never the request options or credentials.
 */
export class CloudinaryStorageDriver implements StorageDriver {
  private readonly logger = new Logger(CloudinaryStorageDriver.name);
  private readonly folder: string;

  constructor(cfg: CloudinaryDriverConfig) {
    if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) {
      throw new Error(
        'Cloudinary upload driver needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET',
      );
    }
    cloudinary.config({
      cloud_name: cfg.cloudName,
      api_key: cfg.apiKey,
      api_secret: cfg.apiSecret,
      secure: true,
    });
    this.folder = (cfg.folder ?? 'evently').replace(/^\/+|\/+$/g, '');
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const resourceType = resourceTypeOf(key, contentType);
    const options: UploadApiOptions = {
      public_id: this.publicIdOf(key, resourceType),
      resource_type: resourceType,
      overwrite: false,
      unique_filename: false,
      use_filename: false,
    };
    const chunked = resourceType === 'video' && body.length > CHUNKED_ABOVE_BYTES;

    let result: UploadApiResponse;
    try {
      result = await sendBuffer(
        body,
        chunked ? { ...options, chunk_size: CHUNK_SIZE } : options,
        chunked,
      );
    } catch (err) {
      const e = err as { message?: string; http_code?: number };
      this.logger.error(
        `Cloudinary upload failed for "${key}" (${resourceType}): ${e?.message ?? 'unknown error'}` +
          (e?.http_code ? ` [http ${e.http_code}]` : ''),
      );
      throw new BadGatewayException('Could not store the file right now — please try again');
    }

    return {
      url: result.secure_url,
      provider: 'cloudinary',
      publicId: result.public_id,
      resourceType,
      format: result.format,
      width: result.width,
      height: result.height,
      duration: typeof result.duration === 'number' ? result.duration : undefined,
    };
  }

  /**
   * Deletes one asset by the `public_id` and resource type Cloudinary gave it
   * (falling back to the ones its key maps to). Refuses anything outside the
   * app's folder or with an unexpected shape, so no caller can reach another
   * part of the account. "not found" counts as done: a retry after a
   * timed-out success must not be an error.
   */
  async delete(ref: StoredRef): Promise<DeleteOutcome> {
    const resourceType = ref.resourceType || resourceTypeOf(ref.key, '');
    const publicId = ref.publicId || this.publicIdOf(ref.key, resourceType);
    this.assertManaged(publicId, resourceType);
    const res = (await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    })) as { result?: string } | undefined;
    if (res?.result === 'ok') return 'deleted';
    if (res?.result === 'not found') return 'not_found';
    throw new Error(`Cloudinary did not delete "${publicId}" (${res?.result ?? 'no result'})`);
  }

  async remove(key: string): Promise<void> {
    try {
      await this.delete({ key });
    } catch (err) {
      // Deletion is best-effort — never let an orphaned asset break a flow.
      const e = err as { message?: string };
      this.logger.warn(
        `Failed to delete Cloudinary asset "${key}": ${e?.message ?? 'unknown error'}`,
      );
    }
  }

  /** Only Evently's own assets, by a well-formed id, of a known type. */
  private assertManaged(publicId: string, resourceType: string): void {
    const inFolder = this.folder ? publicId.startsWith(`${this.folder}/`) : true;
    if (
      !inFolder ||
      publicId.includes('..') ||
      !/^[A-Za-z0-9_\-./]+$/.test(publicId) ||
      !['image', 'video', 'raw'].includes(resourceType)
    ) {
      throw new Error(`Refusing to delete an asset outside Evently's storage: "${publicId}"`);
    }
  }

  /** The Cloudinary public_id for a storage key. */
  publicIdOf(key: string, resourceType: ResourceType): string {
    const clean = key.replace(/^\/+/, '');
    // Raw assets keep their extension in the public_id; images and videos do not.
    const id = resourceType === 'raw' ? clean : clean.replace(/\.[^./]+$/, '');
    return this.folder ? `${this.folder}/${id}` : id;
  }
}

/** Which Cloudinary resource type a file belongs to, by type then extension. */
export function resourceTypeOf(key: string, contentType: string): ResourceType {
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'raw';
  if (contentType.startsWith('image/')) return 'image';
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (RAW_EXTS.has(ext)) return 'raw';
  return 'image';
}

/** Streams a buffer to Cloudinary, in one request or in chunks. */
function sendBuffer(
  body: Buffer,
  options: UploadApiOptions,
  chunked: boolean,
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const done = (error?: unknown, result?: UploadApiResponse) => {
      if (error || !result) reject(error ?? new Error('Empty response from Cloudinary'));
      else resolve(result);
    };
    const stream = chunked
      ? cloudinary.uploader.upload_chunked_stream(options, done)
      : cloudinary.uploader.upload_stream(options, done);
    stream.end(body);
  });
}
