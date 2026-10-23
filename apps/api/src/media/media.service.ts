import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import type { MediaKind, Prisma } from '../generated/prisma/client.js';
import { mkdir, rm } from 'node:fs/promises';
import { ImageProcessor } from './image-processor.js';
import {
  MEDIA_STORAGE,
  type MediaFile,
  type MediaStorage,
  type MediaVariant,
} from './media-storage.js';
import {
  outputSize,
  VideoProcessor,
  type VideoInfo,
} from './video-processor.js';

export const MEDIA_CLEANUP = Symbol('MEDIA_CLEANUP');
// Abandoned uploads older than this are treated as failed.
const PENDING_TTL_MS = 3600_000;

export function mediaUrl(id: string, variant: MediaFile): string {
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
  // Video jobs in flight; shutdown waits for them.
  private readonly jobs = new Set<Promise<void>>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(VideoProcessor) private readonly videos: VideoProcessor,
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

  open(id: string, file: MediaFile) {
    return this.storage.open(id, file);
  }

  // Private scratch directory for uploaded originals.
  incomingDir(): Promise<string> {
    return this.storage.incoming();
  }

  // Quick check of an uploaded original before anything is recorded.
  inspectVideo(file: string): Promise<VideoInfo> {
    return this.videos.inspect(file);
  }

  // PENDING video row inside the caller's transaction. Its size is the
  // expected output size until processing reports the real one.
  createVideo(
    tx: Prisma.TransactionClient,
    ownerId: string,
    info: VideoInfo,
    kind: MediaKind = 'POST',
  ): Promise<{ id: string }> {
    return tx.media.create({
      data: {
        ownerId,
        kind,
        type: 'VIDEO',
        ...outputSize(info.width, info.height),
      },
      select: { id: true },
    });
  }

  // Transcodes in the background and makes the media READY, or marks it
  // failed for its author. The original is always removed afterwards. If
  // the post was deleted meanwhile, the prepared files are discarded.
  processVideo(id: string, original: string): Promise<void> {
    const job = this.runVideo(id, original).finally(() => {
      this.jobs.delete(job);
    });
    this.jobs.add(job);
    return job;
  }

  private async runVideo(id: string, original: string): Promise<void> {
    let work: string | undefined;
    try {
      work = `${original}.work`;
      await mkdir(work, { recursive: true });
      const video = await this.videos.process(original, work);
      await this.storage.write(id, 'full', video.full);
      await this.storage.write(id, 'thumb', video.thumb);
      await this.storage.importFile(id, 'video', video.file);
      const { count } = await this.database.prisma.media.updateMany({
        where: { id, state: 'PENDING', failedAt: null },
        data: {
          state: 'READY',
          width: video.width,
          height: video.height,
          durationMs: video.durationMs,
        },
      });
      if (count !== 1) await this.storage.remove(id);
    } catch {
      // Rejected content or a failed encoder: the author sees "failed".
      await this.database.prisma.media
        .updateMany({
          where: { id, state: 'PENDING' },
          data: { failedAt: new Date() },
        })
        .catch(() => undefined);
      await this.storage.remove(id).catch(() => undefined);
    } finally {
      await rm(original, { force: true }).catch(() => undefined);
      if (work)
        await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // Jobs live in memory: after a restart unfinished videos cannot finish.
  async failInterruptedVideos(): Promise<number> {
    const { count } = await this.database.prisma.media.updateMany({
      where: { type: 'VIDEO', state: 'PENDING', failedAt: null },
      data: { failedAt: new Date() },
    });
    return count;
  }

  // Resolves when no video is being processed (tests, shutdown).
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.allSettled(this.jobs);
  }

  // Removes files, then the row, for DELETED media and abandoned uploads.
  // Rows still referenced by a post or avatar are kept (NO ACTION / SET NULL).
  async cleanup(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - PENDING_TTL_MS);
    // Failed videos were kept for their author to see; their posts go now.
    const failed = await this.database.prisma.media.findMany({
      where: { kind: 'POST', failedAt: { lt: cutoff }, state: { not: 'DELETED' } },
      select: { id: true },
      take: 100,
    });
    for (const { id } of failed)
      await this.database.prisma
        .$transaction(async (tx) => {
          await tx.post.deleteMany({ where: { mediaId: id } });
          await this.markDeleted(tx, id);
        })
        .catch(() => undefined);
    await this.storage.sweepIncoming(cutoff).catch(() => 0);
    const rows = await this.database.prisma.media.findMany({
      where: {
        OR: [
          { state: 'DELETED' },
          {
            state: 'PENDING',
            createdAt: { lt: cutoff },
          },
        ],
        post: null,
        story: null,
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
      where: { id, state: { not: 'READY' }, post: null, story: null },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.failInterruptedVideos().catch(() => 0);
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
    await this.idle();
  }
}
