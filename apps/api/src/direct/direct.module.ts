import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DirectService } from './direct.service.js';
import { DirectController } from './direct.controller.js';
import { DirectEventsController } from './direct-events.controller.js';
import {
  DIRECT_EVENTS_CONFIG,
  DirectEvents,
  defaultDirectEventsConfig,
} from './direct-events.js';

// FR-09 conversations, messages and their SSE notices. Participant rules
// live here only.
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DirectController, DirectEventsController],
  providers: [
    DirectService,
    DirectEvents,
    { provide: DIRECT_EVENTS_CONFIG, useValue: defaultDirectEventsConfig },
  ],
})
export class DirectModule {}
