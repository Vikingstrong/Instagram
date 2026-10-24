import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ReadinessModule } from './readiness/readiness.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { SocialModule } from './social/social.module.js';
import { PostsModule } from './posts/posts.module.js';
import { CoinsModule } from './coins/coins.module.js';
import { StoriesModule } from './stories/stories.module.js';
import { CallsModule } from './calls/calls.module.js';
import { DirectModule } from './direct/direct.module.js';
import { LivesModule } from './lives/lives.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ReadinessModule,
    AuthModule,
    UsersModule,
    SocialModule,
    PostsModule,
    DirectModule,
    CallsModule,
    StoriesModule,
    CoinsModule,
    LivesModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'api',
      // Keep credentials/cookies and driver-error snapshots out of APM traces.
      http: {
        ignore: [/^\/api\/v1\/(?:auth|users|me|search|posts|media|direct|calls|stories|coins|lives)(?:\/|$)/],
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
