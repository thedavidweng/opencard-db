const BAD_UA = new Set([
  "",
  "-",
  "*",
  "null",
  "undefined",
  "curl",
  "wget",
  "python-requests",
  "go-http-client",
]);

/** Official mode: require a meaningful User-Agent or X-Client-Name. */
export function hasClientIdentification(request: Request): boolean {
  const clientName = request.headers.get("X-Client-Name")?.trim() ?? "";
  if (clientName.length >= 2) return true;

  const ua = request.headers.get("User-Agent")?.trim() ?? "";
  if (ua.length < 3) return false;
  const lower = ua.toLowerCase();
  if (BAD_UA.has(lower)) return false;
  // Bare default library UAs without app name
  if (lower === "curl/7" || lower.startsWith("curl/") && lower.length < 12) {
    return false;
  }
  return true;
}
