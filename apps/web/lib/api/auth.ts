import {
  authEndpoints,
  AuthCsrfResponseSchema,
  AuthLogoutResponseSchema,
  AuthUserResponseSchema,
  AuthEmailAcceptedResponseSchema,
  AuthPasswordResetResponseSchema,
  type AuthLoginRequest,
  type AuthRegisterRequest,
} from "@instagram/contracts";

import { createApiClient, type ApiClient } from "./client";

// Fetch a fresh CSRF token for each explicit mutation. Never replay mutations
// automatically: a lost response may already have created an account/session.
export function createAuthClient(api: ApiClient = createApiClient()) {
  async function emailAction<T>(endpoint: Parameters<ApiClient["request"]>[0], schema: import("./client").ResponseSchema<T>, body: unknown) {
    const csrf = await api.request(authEndpoints.csrf, AuthCsrfResponseSchema);
    if (!csrf.ok) return csrf;
    return api.request(endpoint, schema, { body, csrfToken: csrf.data.csrfToken });
  }
  async function authenticate(
    endpoint: typeof authEndpoints.login | typeof authEndpoints.register,
    body: AuthLoginRequest | AuthRegisterRequest,
  ) {
    const csrf = await api.request(authEndpoints.csrf, AuthCsrfResponseSchema);
    if (!csrf.ok) return csrf;
    return api.request(endpoint, AuthUserResponseSchema, {
      body,
      csrfToken: csrf.data.csrfToken,
    });
  }

  return {
    requestPasswordReset: (email: string) => emailAction(authEndpoints.requestPasswordReset, AuthEmailAcceptedResponseSchema, { email }),
    resetPassword: (token: string, password: string) => emailAction(authEndpoints.resetPassword, AuthPasswordResetResponseSchema, { token, password }),
    login: (body: AuthLoginRequest) => authenticate(authEndpoints.login, body),
    register: (body: AuthRegisterRequest) => authenticate(authEndpoints.register, body),
    async logout() {
      const csrf = await api.request(authEndpoints.csrf, AuthCsrfResponseSchema);
      if (!csrf.ok) return csrf;
      return api.request(authEndpoints.logout, AuthLogoutResponseSchema, {
        body: {},
        csrfToken: csrf.data.csrfToken,
      });
    },
  };
}
