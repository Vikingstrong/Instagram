import { UseGuards, applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiResponse,
  ApiSecurity,
  type SchemaObject,
} from '@nestjs/swagger';
import { AuthApiErrorResponseSchema } from '@instagram/contracts';
import { AuthMutationGuard } from './auth-security.js';
import { AuthError } from './auth.error.js';

// Shared by controllers that use the Auth error contract and session cookies.
export const schema = (value: {
  toJSONSchema(options: { target: 'openapi-3.0' }): unknown;
}): SchemaObject =>
  value.toJSONSchema({ target: 'openapi-3.0' }) as SchemaObject;
export const noStore = {
  'Cache-Control': { schema: { type: 'string' as const, enum: ['no-store'] } },
};
export function errorResponse(status: number) {
  return ApiResponse({
    status,
    headers: noStore,
    schema: schema(AuthApiErrorResponseSchema),
  });
}
export function mutationBody(
  value: Parameters<typeof schema>[0],
  example: Record<string, unknown>,
) {
  return applyDecorators(
    UseGuards(AuthMutationGuard),
    ApiSecurity('csrfToken'),
    ApiBody({ schema: schema(value), examples: { demo: { value: example } } }),
    errorResponse(400),
    errorResponse(403),
    errorResponse(413),
  );
}
export function parse<T>(
  value: unknown,
  validator: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): T {
  const parsed = validator.safeParse(value);
  if (!parsed.success) throw new AuthError('INVALID_REQUEST');
  return parsed.data;
}
