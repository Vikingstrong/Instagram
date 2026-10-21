import { createApiClient, type ApiClient, type ApiEndpoint } from "./client";
import { readyFixture, unavailableFixture } from "./contracts.fixture";

// Fixture mode for parallel UI work and tests. Responses still go through the
// real client path (status check + schema parse); `mode` marks the client so
// fixture results are never mistaken for the live API.

export type FixtureResponse = { status: number; body: unknown };

type RouteKey = `${ApiEndpoint["method"]} ${ApiEndpoint["path"]}`;

export type FixtureRoutes = Partial<Record<RouteKey, FixtureResponse>>;

export function createFixtureClient(routes: FixtureRoutes): ApiClient {
  return createApiClient({
    mode: "fixture",
    fetchImpl: async (input, init) => {
      const fixture = routes[`${init.method} ${input}` as RouteKey];
      if (!fixture) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(fixture.body), {
        status: fixture.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}

export const readinessFixtureRoutes = {
  ready: { "GET /api/v1/readiness": { status: 200, body: readyFixture } },
  unavailable: {
    "GET /api/v1/readiness": { status: 503, body: unavailableFixture },
  },
} satisfies Record<string, FixtureRoutes>;
