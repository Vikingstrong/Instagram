import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { readDatabaseUrl } from './database.config.js';

@Module({
  providers: [
    {
      provide: DatabaseService,
      useFactory: () =>
        new DatabaseService(readDatabaseUrl(process.env, 'development')),
    },
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
