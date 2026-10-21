import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
  type ReadinessResponse,
} from '../contracts/foundation.js';
import { DatabaseService } from '../infrastructure/database/database.service.js';

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async check(): Promise<ReadinessResponse> {
    try {
      await this.database.checkConnection();
    } catch {
      // Driver errors can contain credentials. Neither log nor return them.
      throw new ServiceUnavailableException(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service is temporarily unavailable.',
            requestId: randomUUID(),
          },
        }),
      );
    }
    return ReadinessResponseSchema.parse({ status: 'ready' });
  }
}
