import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { ImageProcessor } from './image-processor.js';
import {
  LocalMediaStorage,
  MEDIA_STORAGE,
  mediaRoot,
} from './media-storage.js';
import { MEDIA_CLEANUP, MediaService } from './media.service.js';

// Image processing, private storage and cleanup. No access rules here: posts
// and profiles decide who may read a file (architecture §10).
@Module({
  imports: [DatabaseModule],
  providers: [
    ImageProcessor,
    MediaService,
    {
      provide: MEDIA_STORAGE,
      useFactory: () => new LocalMediaStorage(mediaRoot(process.env)),
    },
    {
      provide: MEDIA_CLEANUP,
      useFactory: () =>
        process.env.MEDIA_CLEANUP_ENABLED === undefined
          ? process.env.NODE_ENV !== 'test'
          : process.env.MEDIA_CLEANUP_ENABLED === 'true',
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
