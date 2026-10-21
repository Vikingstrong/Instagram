import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { ReadinessController } from './readiness.controller.js';
import { ReadinessService } from './readiness.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ReadinessController],
  providers: [ReadinessService],
})
export class ReadinessModule {}
