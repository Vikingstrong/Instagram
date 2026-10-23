import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { PostsService } from './posts.service.js';
import { PostsController } from './posts.controller.js';
import { InteractionsService } from './interactions.service.js';
import { InteractionsController } from './interactions.controller.js';

// Posts, avatars and protected image delivery. The post visibility policy
// (post-policy.ts) is the one rule for posts, grids, the feed, likes,
// comments and image reads.
@Module({
  imports: [DatabaseModule, AuthModule, MediaModule],
  controllers: [PostsController, InteractionsController],
  providers: [PostsService, InteractionsService],
})
export class PostsModule {}
