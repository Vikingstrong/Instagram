import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { videoUploadRules } from '@instagram/contracts';
import type { AuthenticatedRequest } from '../auth/auth-session.guard.js';
import { AuthRateLimiter } from '../auth/auth-rate-limiter.js';
import { AuthError } from '../auth/auth.error.js';
import { MediaService } from '../media/media.service.js';

// Video uploads go to the private scratch directory on disk, never into
// memory. The per-user limit is taken before any byte is read; the size
// limit stops the upload as soon as it is exceeded (multer removes the
// partial file).
@Injectable()
export class VideoUploadInterceptor implements NestInterceptor {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    this.limiter.consume('video-upload', request.authUser!.id, 10, 3600_000);
    const destination = await this.media.incomingDir();
    const upload = multer({
      storage: multer.diskStorage({
        destination,
        filename: (_request, _file, done) =>
          done(null, `${randomUUID()}.upload`),
      }),
      limits: {
        fileSize: videoUploadRules.maxBytes,
        files: 1,
        fields: 1,
        parts: 2,
        fieldSize: 16_384,
      },
    }).single(videoUploadRules.multipartField);
    await new Promise<void>((resolve, reject) =>
      upload(request, http.getResponse<Response>(), (error: unknown) => {
        if (!error) resolve();
        else if (error instanceof multer.MulterError)
          reject(
            new AuthError(
              error.code === 'LIMIT_FILE_SIZE'
                ? 'VIDEO_TOO_LARGE'
                : 'INVALID_REQUEST',
            ),
          );
        else reject(error);
      }),
    );
    return next.handle();
  }
}
