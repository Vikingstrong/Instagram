import { Controller, Get, Header, Inject } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
  readinessEndpoint,
  type ReadinessResponse,
} from '../contracts/foundation.js';
import { ReadinessService } from './readiness.service.js';

const noStoreHeader = {
  'Cache-Control': { schema: { type: 'string' as const, enum: ['no-store'] } },
};

@ApiTags('Foundation')
@Controller('readiness')
export class ReadinessController {
  constructor(
    @Inject(ReadinessService) private readonly readiness: ReadinessService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'getReadiness',
    summary: 'Check API and PostgreSQL readiness',
    description: 'Performs a real database query. No session is required.',
  })
  @ApiResponse({
    status: readinessEndpoint.successStatus,
    description: 'The API can query PostgreSQL.',
    headers: noStoreHeader,
    schema: ReadinessResponseSchema.toJSONSchema({
      target: 'openapi-3.0',
    }) as SchemaObject,
  })
  @ApiResponse({
    status: readinessEndpoint.unavailableStatus,
    description:
      'PostgreSQL is unavailable. No internal connection details are returned.',
    headers: noStoreHeader,
    schema: ApiErrorResponseSchema.toJSONSchema({
      target: 'openapi-3.0',
    }) as SchemaObject,
  })
  check(): Promise<ReadinessResponse> {
    return this.readiness.check();
  }
}
