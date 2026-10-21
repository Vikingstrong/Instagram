import "server-only";

import { headers } from "next/headers";

import { getApiOrigin } from "../../config/api-origin";
import { createApiClient } from "./client";

// Create inside each request, never as a singleton or inside a shared cache.
// Browser callers use createApiClient() with its relative same-origin URLs.
export async function createServerApiClient() {
  const incoming = await headers();
  const cookie = incoming.get("cookie");
  const origin = incoming.get("origin");

  return createApiClient({
    baseUrl: getApiOrigin(),
    fetchImpl: (input, init) => {
      const forwarded = new Headers(init.headers);
      if (cookie) forwarded.set("cookie", cookie);
      if (origin) forwarded.set("origin", origin);
      return fetch(input, {
        ...init,
        headers: forwarded,
        // Session context must never be followed to a redirect destination.
        redirect: "error",
      });
    },
  });
}
