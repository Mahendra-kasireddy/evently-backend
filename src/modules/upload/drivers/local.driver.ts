import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { StorageDriver } from '../interfaces/storage-driver.interface';

/**
 * Development-only storage driver. Writes files under a local directory and
 * returns a URL served by the Upload controller (`GET /upload/file/:key`).
 * NEVER intended for production — use the S3 driver there.
 */
export class LocalStorageDriver implements StorageDriver {
  private readonly logger = new Logger(LocalStorageDriver.name);
  private readonly root: string;

  constructor(
    private readonly dir: string,
    private readonly publicBaseUrl: string,
    private readonly routePrefix = '/api/upload/file',
  ) {
    this.root = resolve(process.cwd(), dir);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    void contentType; // content type is irrelevant on disk; served route re-derives it
    const dest = this.safeJoin(key);
    await fs.mkdir(dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
    const base = this.publicBaseUrl ? this.publicBaseUrl.replace(/\/+$/, '') : '';
    return `${base}${this.routePrefix}/${key}`;
  }

  async remove(key: string): Promise<void> {
    try {
      await fs.unlink(this.safeJoin(key));
    } catch (err) {
      this.logger.warn(`Failed to delete local file "${key}": ${String(err)}`);
    }
  }

  /** Reads a stored file for the serving route. Throws if the key escapes root. */
  read(key: string): Promise<Buffer> {
    return fs.readFile(this.safeJoin(key));
  }

  /** Prevents path traversal — the resolved path must stay under `root`. */
  private safeJoin(key: string): string {
    const dest = resolve(this.root, key);
    if (dest !== this.root && !dest.startsWith(this.root + '/')) {
      throw new Error('Invalid storage key');
    }
    return join(this.root, key);
  }
}
