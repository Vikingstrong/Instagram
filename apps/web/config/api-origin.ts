// Server configuration shared by Next rewrites and the server API client.
// Never expose the internal address through NEXT_PUBLIC_* or client props.
export function getApiOrigin(
  value = process.env.API_INTERNAL_ORIGIN ?? "http://127.0.0.1:4000",
): string {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid origin");
    }
    return url.origin;
  } catch {
    // A misconfigured value could contain credentials; do not echo it.
    throw new Error(
      "API_INTERNAL_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.",
    );
  }
}
