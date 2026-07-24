/** Metadata returned to API clients. No file bytes are ever stored in Mongo. */
export interface UploadedFileMeta {
  fileName: string; // storage file name (the key's basename)
  originalName: string; // client-provided name
  mimeType: string;
  size: number; // bytes
  url: string; // publicly resolvable URL
  key: string; // storage key/path (stable handle for deletion)
  uploadedAt: string; // ISO timestamp
}

/** What a storage backend must implement. Swappable via env (s3 | local). */
export interface StorageDriver {
  /** Persists the buffer under `key` and returns its public URL. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Removes an object (best-effort). */
  remove(key: string): Promise<void>;
}
