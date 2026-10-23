import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DirectService } from './direct.service.js';
import { DirectController } from './direct.controller.js';

// FR-09 conversations and messages. Participant rules live here only.
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DirectController],
  providers: [DirectService],
})
export class DirectModule {}
