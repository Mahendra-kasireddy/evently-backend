/** Metadata returned to API clients. No file bytes are ever stored in Mongo. */
export interface UploadedFileMeta {
  fileName: string; // storage file name (the key's basename)
  originalName: string; // client-provided name
  mimeType: string;
  size: number; // bytes
  url: string; // publicly resolvable URL (https in production)
  key: string; // storage key/path (stable handle for deletion)
  uploadedAt: string; // ISO timestamp
  /*
   * What the storage provider reports about the stored asset. Optional and
   * additive: the local driver reports none of it, and every existing client
   * reads only the fields above.
   */
  provider?: StorageProvider;
  /** The provider's own id for the asset (Cloudinary `public_id`). */
  publicId?: string;
  resourceType?: 'image' | 'video' | 'raw';
  format?: string;
  width?: number;
  height?: number;
  /** Seconds, for video. */
  duration?: number;
}

export type StorageProvider = 'local' | 'cloudinary';

/** What a driver reports after storing an object. Only `url` is required. */
export interface StoredObject {
  url: string;
  provider: StorageProvider;
  publicId?: string;
  resourceType?: 'image' | 'video' | 'raw';
  format?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/** What a storage backend must implement. Swappable via env (cloudinary | local). */
export interface StorageDriver {
  /** Persists the buffer under `key` and returns where it can be read. */
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  /** Removes an object (best-effort). */
  remove(key: string): Promise<void>;
}
