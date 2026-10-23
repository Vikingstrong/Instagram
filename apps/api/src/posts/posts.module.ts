import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { PostsService } from './posts.service.js';
import { PostsController } from './posts.controller.js';

// Posts, avatars and protected image delivery. The post visibility policy
// (post-policy.ts) is the one rule for posts, grids and image reads.
@Module({
  imports: [DatabaseModule, AuthModule, MediaModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
