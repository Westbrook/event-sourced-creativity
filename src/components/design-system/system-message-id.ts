/** Stable, compact catalog identifier for audited system-authored English copy. */
export function formaSystemMessageId(source: string) {
  const normalized = source.replace(/\s+/gu, " ").trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `system.auto.${(hash >>> 0).toString(36)}.${normalized.length}`;
}
