import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SocialService } from './social.service.js';
import {
  MeSocialController,
  UsersSocialController,
} from './social.controller.js';

// Follows, follow requests, follower removal and suggestions.
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [UsersSocialController, MeSocialController],
  providers: [SocialService],
})
export class SocialModule {}
