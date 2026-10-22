import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { MAIL_CONFIG, readMailConfiguration } from './mail.config.js';
import { MailService } from './mail.service.js';
import { SmtpSender } from './smtp.sender.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: MAIL_CONFIG,
      useFactory: () => readMailConfiguration(process.env),
    },
    SmtpSender,
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
