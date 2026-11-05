/** Resolve login destinations against a fixed origin and return only local paths. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.includes("\\") ||
    Array.from(next).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return "/";
  try {
    const base = "https://ride-stats.invalid";
    const url = new URL(next, base);
    return url.origin === base && !url.pathname.startsWith("//") ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
