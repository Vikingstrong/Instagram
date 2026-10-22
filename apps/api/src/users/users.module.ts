import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersService } from './users.service.js';
import {
  MeController,
  SearchController,
  UsersController,
} from './users.controller.js';

// Profiles, username and privacy settings, and user search.
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [UsersController, MeController, SearchController],
  providers: [UsersService],
})
export class UsersModule {}
