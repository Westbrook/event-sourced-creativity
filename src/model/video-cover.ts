/** Covers are private derived media, addressed through the original video's authorization. */
export const VIDEO_COVER_MAX_EDGE = 960;
export const VIDEO_COVER_MAX_BYTES = 1_000_000;
export const VIDEO_COVER_QUERY = 'video-cover';

export function videoCoverUrl(source: string | null | undefined): string | null {
  if (!source || source.includes('?') || source.includes('#')) return null;
  const prefix = source.startsWith('/api/media/') ? '/api/media/' : source.match(/^\/api\/shared\/[^/]+\/media\//)?.[0];
  if (!prefix) return null;
  const encoded = source.slice(prefix.length);
  try {
    const key = decodeURIComponent(encoded);
    if (!key || encodeURIComponent(key) !== encoded || !key.endsWith('.mp4')) return null;
  } catch { return null; }
  return `${source}?${VIDEO_COVER_QUERY}=webp`;
}

/** Bounded still WebP container validation; this does not certify pixel provenance. */
export function inspectVideoCover(bytes: Uint8Array): { width: number; height: number } {
  const invalid = (): never => { throw new Error('invalid_video_cover'); };
  if (bytes.length < 30 || bytes.length > VIDEO_COVER_MAX_BYTES) return invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (offset: number, word: string) => [...word].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  if (!has(0, 'RIFF') || !has(8, 'WEBP') || view.getUint32(4, true) !== bytes.length - 8) return invalid();
  let width = 0, height = 0, canvasWidth = 0, canvasHeight = 0, at = 12, chunks = 0;
  while (at + 8 <= bytes.length) {
    if (++chunks > 16) return invalid();
    const length = view.getUint32(at + 4, true), start = at + 8, end = start + length + length % 2;
    if (end > bytes.length) return invalid();
    if (has(at, 'VP8X')) {
      if (at !== 12 || length !== 10 || bytes[start]! & 0xc3 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) return invalid();
      canvasWidth = 1 + bytes[start + 4]! + (bytes[start + 5]! << 8) + (bytes[start + 6]! << 16);
      canvasHeight = 1 + bytes[start + 7]! + (bytes[start + 8]! << 8) + (bytes[start + 9]! << 16);
    } else if (has(at, 'VP8 ')) {
      if (width || length <= 10 || bytes[start]! & 1 || !has(start + 3, '\x9d\x01\x2a')) return invalid();
      width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff;
    } else if (has(at, 'VP8L')) {
      if (width || length <= 5 || bytes[start] !== 0x2f || bytes[start + 4]! >> 5) return invalid();
      const bits = view.getUint32(start + 1, true);
      width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
    } else if (!has(at, 'ALPH') && !has(at, 'ICCP')) return invalid();
    at = end;
  }
  if (at !== bytes.length || !width || !height || width > VIDEO_COVER_MAX_EDGE || height > VIDEO_COVER_MAX_EDGE
    || canvasWidth && (canvasWidth !== width || canvasHeight !== height)) return invalid();
  return { width, height };
}
