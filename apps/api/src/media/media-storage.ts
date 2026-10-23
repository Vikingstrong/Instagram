import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type MediaVariant = 'full' | 'thumb';
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

// Private file storage. Only the API reads it, after checking access; there
// are no public URLs. A future object-storage adapter implements the same API.
export interface MediaStorage {
  write(id: string, variant: MediaVariant, data: Buffer): Promise<void>;
  read(id: string, variant: MediaVariant): Promise<Buffer | null>;
  remove(id: string): Promise<void>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Default: <repo>/.local/media (ignored by Git, outside web/API public paths).
// Same depth from src/media and dist/media.
export function mediaRoot(env: NodeJS.ProcessEnv): string {
  return env.MEDIA_ROOT
    ? resolve(env.MEDIA_ROOT)
    : fileURLToPath(new URL('../../../../.local/media', import.meta.url));
}

export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly root: string) {}

  // Ids come from the database, but the path is still built only from a
  // validated UUID and a fixed variant name.
  private path(id: string, variant?: MediaVariant): string {
    if (!uuid.test(id)) throw new Error('Invalid media id.');
    return variant
      ? join(this.root, id, `${variant}.webp`)
      : join(this.root, id);
  }

  async write(id: string, variant: MediaVariant, data: Buffer): Promise<void> {
    await mkdir(this.path(id), { recursive: true });
    await writeFile(this.path(id, variant), data, { flag: 'w' });
  }

  async read(id: string, variant: MediaVariant): Promise<Buffer | null> {
    try {
      return await readFile(this.path(id, variant));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  // Idempotent: removing missing files succeeds.
  async remove(id: string): Promise<void> {
    await rm(this.path(id), { recursive: true, force: true });
  }
}
