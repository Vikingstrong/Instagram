import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import type { MediaKind, Prisma } from '../generated/prisma/client.js';
import { ImageProcessor } from './image-processor.js';
import {
  MEDIA_STORAGE,
  type MediaStorage,
  type MediaVariant,
} from './media-storage.js';

export const MEDIA_CLEANUP = Symbol('MEDIA_CLEANUP');
// Abandoned uploads older than this are treated as failed.
const PENDING_TTL_MS = 3600_000;

export function mediaUrl(id: string, variant: MediaVariant): string {
  return `/api/v1/media/${id}/${variant}`;
}

// Files and their database state. The database and storage share no
// transaction: rows are PENDING until files exist, and DELETED/abandoned rows
// are removed by a repeatable cleanup. Access rules live with the owners
// (posts, profiles); this service never decides who may read a file.
@Injectable()
export class MediaService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(MEDIA_CLEANUP) private readonly cleanupEnabled: boolean,
  ) {}

  // Validates and prepares the image first, then records a PENDING row and
  // writes its files. The caller makes it READY in its own transaction.
  async store(
    ownerId: string,
    kind: MediaKind,
    input: Buffer,
  ): Promise<{ id: string; width: number; height: number }> {
    const image = await this.images.process(input);
    const media = await this.database.prisma.media.create({
      data: { ownerId, kind },
      select: { id: true },
    });
    try {
      await this.storage.write(media.id, 'full', image.full);
      await this.storage.write(media.id, 'thumb', image.thumb);
    } catch (error) {
      await this.discard(media.id);
      throw error;
    }
    return { id: media.id, width: image.width, height: image.height };
  }

  // Conditional PENDING → READY inside the caller's transaction.
  async activate(
    tx: Prisma.TransactionClient,
    media: { id: string; width: number; height: number },
  ): Promise<void> {
    const { count } = await tx.media.updateMany({
      where: { id: media.id, state: 'PENDING' },
      data: { state: 'READY', width: media.width, height: media.height },
    });
    if (count !== 1) throw new Error('Media is no longer pending.');
  }

  // Stops serving at once; files go in cleanup.
  async markDeleted(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.media.updateMany({
      where: { id, state: { not: 'DELETED' } },
      data: { state: 'DELETED', deletedAt: new Date() },
    });
  }

  // Best effort after a failed upload or a deletion; cleanup retries later.
  async discard(id: string): Promise<void> {
    try {
      await this.database.prisma.media.updateMany({
        where: { id, state: { not: 'DELETED' } },
        data: { state: 'DELETED', deletedAt: new Date() },
      });
      await this.purge(id);
    } catch {
      // Left for cleanup.
    }
  }

  read(id: string, variant: MediaVariant): Promise<Buffer | null> {
    return this.storage.read(id, variant);
  }

  // Removes files, then the row, for DELETED media and abandoned uploads.
  // Rows still referenced by a post or avatar are kept (NO ACTION / SET NULL).
  async cleanup(now = new Date()): Promise<number> {
    const rows = await this.database.prisma.media.findMany({
      where: {
        OR: [
          { state: 'DELETED' },
          {
            state: 'PENDING',
            createdAt: { lt: new Date(now.getTime() - PENDING_TTL_MS) },
          },
        ],
        post: null,
      },
      select: { id: true },
      take: 100,
    });
    let removed = 0;
    for (const { id } of rows) {
      try {
        await this.purge(id);
        removed += 1;
      } catch {
        // Retried on the next run.
      }
    }
    return removed;
  }

  private async purge(id: string): Promise<void> {
    await this.storage.remove(id);
    await this.database.prisma.media.deleteMany({
      where: { id, state: { not: 'READY' }, post: null },
    });
  }

  onApplicationBootstrap(): void {
    if (!this.cleanupEnabled) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.cleanup()
        .then(() => undefined)
        .catch(() => {
          // Database errors are retried on the next run; never logged raw.
        })
        .finally(() => {
          this.running = undefined;
        });
    }, 600_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
