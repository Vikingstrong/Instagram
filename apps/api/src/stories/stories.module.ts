import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { VideoUploadInterceptor } from '../posts/video-upload.interceptor.js';
import { StoriesController } from './stories.controller.js';
import { StoriesService } from './stories.service.js';
@Module({
  imports: [DatabaseModule, AuthModule, MediaModule],
  controllers: [StoriesController],
  providers: [StoriesService, VideoUploadInterceptor],
})
export class StoriesModule {}
