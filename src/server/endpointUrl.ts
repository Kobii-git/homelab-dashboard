// Apply the same constraint at input validation and immediately before credentials are sent.
export function isLocalEndpointPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u0020\u007f]/.test(path);
}

export function resolveEndpointUrl(baseUrl: string, path: string): URL {
  if (!isLocalEndpointPath(path)) throw new Error("Endpoint path is not permitted");
  const base = new URL(baseUrl);
  const resolved = new URL(path, base);
  if (resolved.origin !== base.origin || resolved.username || resolved.password) {
    throw new Error("Endpoint must remain on its configured origin");
  }
  return resolved;
}
