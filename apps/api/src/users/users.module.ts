import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersService } from './users.service.js';
import { MeController, UsersController } from './users.controller.js';

// Profiles, username and privacy settings; search joins in the next slice.
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [UsersController, MeController],
  providers: [UsersService],
})
export class UsersModule {}
