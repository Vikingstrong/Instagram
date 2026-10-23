import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from './auth.config.js';
import { PasswordHasher } from './password-hasher.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import {
  AuthSecurity,
  AuthMutationGuard,
  UploadMutationGuard,
} from './auth-security.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import { AuthErrorFilter } from './auth-error.filter.js';
import { VerifiedSessionGuard } from './auth-session.guard.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [DatabaseModule, MailModule],
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_CONFIG,
      useFactory: () => readAuthConfiguration(process.env),
    },
    PasswordHasher,
    AuthService,
    AuthSecurity,
    AuthMutationGuard,
    UploadMutationGuard,
    AuthRateLimiter,
    VerifiedSessionGuard,
    { provide: APP_FILTER, useClass: AuthErrorFilter },
  ],
  exports: [
    AuthService,
    AuthSecurity,
    AuthMutationGuard,
    UploadMutationGuard,
    AuthRateLimiter,
    VerifiedSessionGuard,
  ],
})
export class AuthModule {}
