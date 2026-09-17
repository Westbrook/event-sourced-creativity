/** Return only the existing private media route; remote and redirect-like paths never enter the board. */
export function referenceCompositionMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/media/") || /[?#\s\\]/u.test(value)) return null;
  try {
    const key = decodeURIComponent(value.slice("/api/media/".length));
    if (!key || key.length > 2048 || /[\p{Cc}\\]/u.test(key) || key.split("/").some(part => part === ".." || part === ".")) return null;
    return `/api/media/${encodeURIComponent(key)}`;
  } catch { return null; }
}
