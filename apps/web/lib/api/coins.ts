import {
  authEndpoints,
  AuthCsrfResponseSchema,
  CoinClaimResponseSchema,
  CoinTransactionsResponseSchema,
  CoinWalletResponseSchema,
  coinsEndpoints,
} from "@instagram/contracts";
import { createApiClient, type ApiClient } from "./client";
import { withPath } from "./social";

export function createCoinsClient(api: ApiClient = createApiClient()) {
  return {
    wallet: (signal?: AbortSignal) =>
      api.request(coinsEndpoints.wallet, CoinWalletResponseSchema, { signal }),
    transactions: (cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(coinsEndpoints.transactions, {}, { cursor }),
        CoinTransactionsResponseSchema,
        { signal },
      ),
    claim: async (signal?: AbortSignal) => {
      const csrf = await api.request(
        authEndpoints.csrf,
        AuthCsrfResponseSchema,
        { signal },
      );
      if (!csrf.ok) return csrf;
      return api.request(coinsEndpoints.claim, CoinClaimResponseSchema, {
        body: {},
        csrfToken: csrf.data.csrfToken,
        signal,
      });
    },
  };
}

export const formatCoins = (value: string) =>
  new Intl.NumberFormat("ru-RU").format(BigInt(value));
