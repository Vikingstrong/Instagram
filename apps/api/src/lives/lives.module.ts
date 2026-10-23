import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DirectModule } from '../direct/direct.module.js';
import { CallsModule } from '../calls/calls.module.js';
import { LivesController, LivesMutationGuard } from './lives.controller.js';
import {
  LIVES_CONFIG,
  LivesService,
  defaultLivesConfig,
} from './lives.service.js';

// FR-12 live streams: state, viewers, signaling and chat. Access is the post
// rule of PostsModule (post-policy.ts); notices go through the Direct SSE hub.
@Module({
  imports: [DatabaseModule, AuthModule, DirectModule, CallsModule],
  controllers: [LivesController],
  providers: [
    LivesService,
    LivesMutationGuard,
    { provide: LIVES_CONFIG, useValue: defaultLivesConfig },
  ],
})
export class LivesModule {}
