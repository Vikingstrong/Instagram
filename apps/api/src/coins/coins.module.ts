import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { COINS_CLOCK } from './coin-clock.js';
import { CoinsController } from './coins.controller.js';
import { CoinsService } from './coins.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CoinsController],
  providers: [
    CoinsService,
    { provide: COINS_CLOCK, useValue: () => new Date() },
  ],
  exports: [CoinsService],
})
export class CoinsModule {}
