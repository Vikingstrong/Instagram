import { Controller, Get, Inject, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DirectEvents } from './direct-events.js';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/auth-session.guard.js';
import { AuthSecurity, cookieValue } from '../auth/auth-security.js';
import { sessionHash } from '../auth/auth.service.js';
import { AuthRateLimiter } from '../auth/auth-rate-limiter.js';
import { errorResponse } from '../auth/auth-http.js';

// FR-09 realtime (stage 7): one Server-Sent Events stream per tab. The
// session cookie is checked before the stream opens; no token in the URL.
@ApiTags('Direct')
@ApiSecurity('session')
@Controller('direct')
@UseGuards(SessionGuard)
export class DirectEventsController {
  constructor(
    @Inject(DirectEvents) private readonly events: DirectEvents,
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  @Get('events')
  @ApiProduces('text/event-stream')
  @ApiOperation({
    operationId: 'directEvents',
    summary: 'Stream of Direct change notices (SSE)',
    description:
      'Sends "ready" once the subscription is active, then "message" events with { conversationId, messageId } after each stored message in the user\'s conversations, and a comment heartbeat. Message text is read through the REST history. The stream ends on logout, password reset or session expiry; clients reconnect and sync over REST.',
  })
  @ApiResponse({ status: 200, description: 'text/event-stream' })
  @errorResponse(401)
  @errorResponse(403)
  @errorResponse(429)
  stream(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): void {
    const userId = request.authUser!.id;
    this.limiter.consume('direct-stream', userId, 60, 60_000);
    const token = cookieValue(request, this.security.sessionCookie)!;
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // no-transform keeps proxies from compressing (and so buffering) it.
    response.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    request.socket.setTimeout(0);
    this.events.open(userId, token, sessionHash(token), response);
  }
}
