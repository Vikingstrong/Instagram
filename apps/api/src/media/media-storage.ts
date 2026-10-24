import { createReadStream, type ReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type MediaVariant = 'full' | 'thumb';
// Every stored file of one media item: image variants and the video.
export type MediaFile = MediaVariant | 'video' | 'audio' | 'opus';
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

// Private file storage. Only the API reads it, after checking access; there
// are no public URLs. A future object-storage adapter implements the same API.
export interface MediaStorage {
  write(id: string, variant: MediaVariant, data: Buffer): Promise<void>;
  read(id: string, variant: MediaVariant): Promise<Buffer | null>;
  // Moves a prepared file (from incoming()) into place.
  importFile(id: string, file: MediaFile, source: string): Promise<void>;
  // Size and a byte-range reader, for streaming video; null when missing.
  open(
    id: string,
    file: MediaFile,
  ): Promise<{
    size: number;
    stream(start: number, end: number): ReadStream;
  } | null>;
  remove(id: string): Promise<void>;
  // Private scratch directory for uploads and transcoding.
  incoming(): Promise<string>;
  // Removes scratch entries older than the given time; returns the count.
  sweepIncoming(olderThan: Date): Promise<number>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INCOMING = '.incoming';

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
  // validated UUID and a fixed file name.
  private path(id: string, file?: MediaFile): string {
    if (!uuid.test(id)) throw new Error('Invalid media id.');
    if (!file) return join(this.root, id);
    return join(
      this.root,
      id,
      file === 'video'
        ? 'video.mp4'
        : file === 'audio'
          ? 'audio.m4a'
          : file === 'opus'
            ? 'audio.webm'
            : `${file}.webp`,
    );
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

  async importFile(id: string, file: MediaFile, source: string): Promise<void> {
    await mkdir(this.path(id), { recursive: true });
    const target = this.path(id, file);
    try {
      await rename(source, target);
    } catch (error) {
      // Another volume: copy, then drop the source.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyFile(source, target);
      await rm(source, { force: true });
    }
  }

  async open(id: string, file: MediaFile) {
    const path = this.path(id, file);
    try {
      const { size } = await stat(path);
      return {
        size,
        stream: (start: number, end: number) =>
          createReadStream(path, { start, end }),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  // Idempotent: removing missing files succeeds.
  async remove(id: string): Promise<void> {
    await rm(this.path(id), { recursive: true, force: true });
  }

  async incoming(): Promise<string> {
    const dir = join(this.root, INCOMING);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async sweepIncoming(olderThan: Date): Promise<number> {
    const dir = await this.incoming();
    let removed = 0;
    for (const name of await readdir(dir)) {
      const entry = join(dir, name);
      try {
        if ((await stat(entry)).mtime < olderThan) {
          await rm(entry, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        // Gone already or busy; retried next time.
      }
    }
    return removed;
  }
}
