import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { MAIL_CONFIG, type MailConfiguration } from './mail.config.js';

export type AuthMail = {
  id: string;
  to: string;
  link: string;
};
@Injectable()
export class SmtpSender {
  private readonly transport;
  constructor(@Inject(MAIL_CONFIG) private readonly config: MailConfiguration) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTLS,
      auth: config.auth,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  }
  async send(mail: AuthMail): Promise<void> {
    const subject = 'Восстановление пароля';
    await this.transport.sendMail({
      from: this.config.from,
      to: mail.to,
      messageId: `<${mail.id}@${this.config.from.split('@')[1]}>`,
      subject,
      text: `${subject}\n\nОткройте ссылку и подтвердите действие:\n${mail.link}\n\nЕсли вы не запрашивали это письмо, проигнорируйте его.`,
    });
  }
}
