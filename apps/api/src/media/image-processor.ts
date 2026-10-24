import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { commentAttachmentRules, imageUploadRules } from '@instagram/contracts';
import { AuthError } from '../auth/auth.error.js';

export type ProcessedImage = {
  width: number;
  height: number;
  full: Buffer;
  thumb: Buffer;
};

const formats = new Set(['jpeg', 'png', 'webp']);
// Decoding is CPU- and memory-heavy: at most two images at a time.
const MAX_PARALLEL = 2;

// Validates the decoded content (not the name or declared type) and writes
// new WebP files: EXIF orientation applied, all metadata dropped.
@Injectable()
export class ImageProcessor {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_PARALLEL)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  processComment(input: Buffer): Promise<ProcessedImage> {
    if (input.length > commentAttachmentRules.maxBytes)
      throw new AuthError('IMAGE_TOO_LARGE');
    return this.slot(async () => {
      try {
        const options = {
          limitInputPixels: commentAttachmentRules.maxTotalPixels,
          failOn: 'error' as const,
        };
        const meta = await sharp(input, options).metadata();
        const pages = meta.pages ?? 1;
        const height = meta.pageHeight ?? meta.height;
        if (
          !meta.width ||
          !height ||
          !meta.format ||
          !['jpeg', 'png', 'webp', 'gif'].includes(meta.format) ||
          pages > commentAttachmentRules.maxFrames ||
          meta.width * height * pages > commentAttachmentRules.maxTotalPixels ||
          (pages > 1 && meta.format !== 'gif')
        )
          throw new Error('Invalid image');
        const full = await sharp(input, { ...options, animated: true })
          .rotate()
          .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80, effort: 3 })
          .toBuffer({ resolveWithObject: true });
        const thumb = await sharp(input, options)
          .rotate()
          .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
          .webp()
          .toBuffer();
        return {
          full: full.data,
          thumb,
          width: full.info.width,
          height: full.info.pageHeight ?? full.info.height,
        };
      } catch {
        throw new AuthError('INVALID_IMAGE');
      }
    });
  }

  process(input: Buffer): Promise<ProcessedImage> {
    if (input.length > imageUploadRules.maxBytes)
      throw new AuthError('IMAGE_TOO_LARGE');
    return this.slot(async () => {
      const options = {
        limitInputPixels: imageUploadRules.maxPixels,
        failOn: 'error' as const,
      };
      const metadata = await sharp(input, options)
        .metadata()
        .catch(() => {
          throw new AuthError('INVALID_IMAGE');
        });
      // One still image per post: animated WebP and multi-page input are refused.
      if (
        !metadata.format ||
        !formats.has(metadata.format) ||
        (metadata.pages ?? 1) > 1 ||
        !metadata.width ||
        !metadata.height
      )
        throw new AuthError('INVALID_IMAGE');
      try {
        const base = sharp(input, options).rotate();
        const full = await base
          .clone()
          .resize(1080, 1350, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        const thumb = await base
          .clone()
          .resize(480, 480, { fit: 'cover', position: 'attention' })
          .webp({ quality: 78 })
          .toBuffer();
        return {
          width: full.info.width,
          height: full.info.height,
          full: full.data,
          thumb,
        };
      } catch {
        throw new AuthError('INVALID_IMAGE');
      }
    });
  }
}
