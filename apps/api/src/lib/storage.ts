import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../env';

// Secure file-storage abstraction. Two drivers behind one interface:
//  - 'local'  : filesystem, for development (this sandbox)
//  - 's3'     : object storage, for staging/production (S3, MinIO, R2, ...)
// The API only ever hands out short-lived presigned upload/download URLs;
// bytes never flow through the app tier in production.

export interface StorageDriver {
  key(tenantId: string, filename: string): string;
  presignUpload(key: string, contentType: string): Promise<{ url: string; method: 'PUT' | 'POST' }>;
  presignDownload(key: string): Promise<string>;
  putObject(key: string, data: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
}

class LocalDriver implements StorageDriver {
  constructor(private dir: string) {}

  key(tenantId: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${tenantId}/${crypto.randomUUID()}-${safe}`;
  }

  private full(key: string): string {
    return path.join(this.dir, key);
  }

  async presignUpload(key: string): Promise<{ url: string; method: 'PUT' | 'POST' }> {
    // In dev the "presigned" URL is a local API upload endpoint (see files module).
    return { url: `/api/v1/files/local-upload/${encodeURIComponent(key)}`, method: 'PUT' };
  }

  async presignDownload(key: string): Promise<string> {
    return `/api/v1/files/local-download/${encodeURIComponent(key)}`;
  }

  async putObject(key: string, data: Buffer): Promise<void> {
    const full = this.full(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }

  async getObject(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }
}

// S3 driver stub — wired to @aws-sdk/client-s3 in staging/prod. Kept as an
// interface-compatible placeholder so dev has zero AWS dependency.
class S3Driver implements StorageDriver {
  key(tenantId: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${tenantId}/${crypto.randomUUID()}-${safe}`;
  }
  async presignUpload(): Promise<{ url: string; method: 'PUT' | 'POST' }> {
    throw new Error('S3 driver not configured. Set STORAGE_DRIVER=s3 with S3_* env in staging/prod.');
  }
  async presignDownload(): Promise<string> {
    throw new Error('S3 driver not configured.');
  }
  async putObject(): Promise<void> {
    throw new Error('S3 driver not configured.');
  }
  async getObject(): Promise<Buffer> {
    throw new Error('S3 driver not configured.');
  }
}

export const storage: StorageDriver =
  env.STORAGE_DRIVER === 's3' ? new S3Driver() : new LocalDriver(env.STORAGE_LOCAL_DIR);

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
