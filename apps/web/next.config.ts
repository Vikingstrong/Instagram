import type { NextConfig } from "next";
import { getApiOrigin } from "./config/api-origin";

const nextConfig: NextConfig = {
  // Only public bundled artwork may enter the shared image optimizer cache.
  // Protected API media must keep its own session-aware delivery path.
  images: {
    localPatterns: [
      { pathname: "/auth-art/**", search: "" },
      { pathname: "/coins/**", search: "" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${getApiOrigin()}/api/v1/:path*`,
      },
    ];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
