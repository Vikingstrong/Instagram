import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DirectModule } from '../direct/direct.module.js';
import { CallsController, CallsMutationGuard } from './calls.controller.js';
import { CallsService } from './calls.service.js';
import { CALLS_CONFIG, readCallsConfig } from './calls.config.js';
@Module({
  imports: [DatabaseModule, AuthModule, DirectModule],
  controllers: [CallsController],
  providers: [
    CallsService,
    CallsMutationGuard,
    { provide: CALLS_CONFIG, useFactory: () => readCallsConfig(process.env) },
  ],
})
export class CallsModule {}
