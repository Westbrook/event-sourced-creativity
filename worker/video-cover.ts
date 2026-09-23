import { inspectVideoCover, VIDEO_COVER_MAX_BYTES } from '../src/model/video-cover.ts';
import type { WorkerEnv } from './runtime.ts';

const hash = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
export function videoCoverKey(sourceKey: string, sourceSha256: string) {
  // Same owner namespace, but never directly readable through /api/media.
  return `${sourceKey}.cover-${sourceSha256}.webp`;
}
/** Organization erasure removes every revision of the source's cover as well. */
export async function deleteVideoCovers(media: R2Bucket, sourceKey: string, owner: string) {
  if (!sourceKey.endsWith('.mp4')) return;
  const prefix = `${sourceKey}.cover-`; let cursor: string | undefined;
  do {
    const page = await media.list({ prefix, cursor, limit: 100, include: ['customMetadata'] });
    for (const object of page.objects) {
      if (!object.key.startsWith(prefix) || !/^[a-f0-9]{64}\.webp$/.test(object.key.slice(prefix.length))) continue;
      const retained = await media.head(object.key), metadata = retained?.customMetadata;
      if (!retained) continue;
      if (metadata?.ownerId !== owner || metadata.source !== 'video-cover' || metadata.sourceKey !== sourceKey) throw Error('video_cover_owner_mismatch');
      await media.delete(object.key);
      if (await media.head(object.key)) throw Error('video_cover_delete_failed');
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
const MAX_LEGACY_VIDEO_BYTES = 32_000_000;

type StoredObject = NonNullable<Awaited<ReturnType<R2Bucket['head']>>>;
const mime = (object: StoredObject) => { const headers = new Headers(); object.writeHttpMetadata(headers); return headers.get('content-type'); };
function sourceHash(source: StoredObject, owner: string) {
  const metadata = source.customMetadata;
  return metadata?.ownerId === owner && metadata.source === 'provider-generated-media'
    && mime(source) === 'video/mp4' && /^[a-f0-9]{64}$/.test(metadata.sha256 ?? '') ? metadata.sha256! : null;
}
async function boundedBody(request: Pick<Request, 'body' | 'headers'>, maximum = VIDEO_COVER_MAX_BYTES) {
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > maximum) throw Error('cover_too_large');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.length;
      if (length > maximum || chunks.length >= 4096) throw Error('cover_too_large');
      chunks.push(next.value);
    }
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

/** Called only after the original media's normal owner/project authorization. */
export async function handleVideoCover(request: Request, env: WorkerEnv, sourceKey: string, source: StoredObject, owner: string, writable: boolean) {
  const headers = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
  const reply = (status: number, code: string) => Response.json({ error: code }, { status, headers });
  const recordedHash = sourceHash(source, owner);
  // Older generated videos retained their owner and source, but not a checksum.
  // Bind those covers to the immutable R2 object version without rewriting the original.
  const legacy = !recordedHash && source.customMetadata?.sha256 === undefined
    && source.customMetadata?.ownerId === owner && source.customMetadata?.source === 'provider-generated-media'
    && mime(source) === 'video/mp4' && Boolean(source.httpEtag);
  if (!recordedHash && !legacy) return reply(404, 'video_cover_source_unavailable');
  const sourceEtag = source.httpEtag;
  const identity = recordedHash ?? await hash(new TextEncoder().encode(`legacy-video-cover-v1:${sourceEtag}:${source.size}`));
  const key = videoCoverKey(sourceKey, identity);
  headers.set('x-video-cover-writable', writable ? '1' : '0');
  const current = async () => {
    const value = await env.MEDIA.head(sourceKey);
    return value && value.httpEtag === sourceEtag && (recordedHash ? sourceHash(value, owner) === recordedHash
      : value.customMetadata?.ownerId === owner && value.customMetadata?.source === 'provider-generated-media'
        && value.customMetadata?.sha256 === undefined && mime(value) === 'video/mp4');
  };
  const existing = await env.MEDIA.get(key);
  if (existing && (existing.customMetadata?.sourceKey !== sourceKey
    || !/^[a-f0-9]{64}$/.test(existing.customMetadata?.sourceSha256 ?? '')
    || (recordedHash ? existing.customMetadata?.sourceSha256 !== recordedHash : existing.customMetadata?.sourceEtag !== sourceEtag)
    || existing.customMetadata?.ownerId !== owner || mime(existing) !== 'image/webp')) {
    void existing.body.cancel().catch(() => undefined); return reply(409, 'video_cover_invalid');
  }
  if (request.method === 'POST' && !writable) { void existing?.body.cancel().catch(() => undefined); return reply(403, 'video_cover_write_forbidden'); }
  let sourceSha256 = recordedHash ?? existing?.customMetadata?.sourceSha256;
  if (!sourceSha256) {
    if (!writable) return reply(404, 'video_cover_missing');
    if (typeof source.size !== 'number' || !Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_LEGACY_VIDEO_BYTES) return reply(413, 'video_cover_source_too_large');
    const original = await env.MEDIA.get(sourceKey);
    if (!original || original.httpEtag !== sourceEtag) { void original?.body.cancel().catch(() => undefined); return reply(409, 'video_cover_source_changed'); }
    try { sourceSha256 = await hash(await boundedBody(new Response(original.body), MAX_LEGACY_VIDEO_BYTES)); }
    catch { return reply(413, 'video_cover_source_too_large'); }
    if (!await current()) return reply(409, 'video_cover_source_changed');
  }
  headers.set('x-video-source-sha256', sourceSha256);
  if (request.method === 'GET') {
    if (!existing) return reply(404, 'video_cover_missing');
    if (!await current()) { void existing.body.cancel().catch(() => undefined); return reply(409, 'video_cover_source_changed'); }
    headers.set('content-type', 'image/webp'); headers.set('etag', existing.httpEtag);
    headers.set('content-length', String(existing.size));
    return new Response(existing.body, { headers });
  }
  if (existing) void existing.body.cancel().catch(() => undefined);
  if (!writable) return reply(403, 'video_cover_write_forbidden');
  if (request.headers.get('x-video-source-sha256') !== sourceSha256) return reply(409, 'video_cover_source_changed');
  if (request.headers.get('content-type') !== 'image/webp') return reply(415, 'video_cover_webp_required');
  if (existing) return Response.json({ url: request.url, mimeType: 'image/webp' }, { headers });
  let bytes: Uint8Array<ArrayBuffer>, size: { width: number; height: number };
  try { bytes = await boundedBody(request); size = inspectVideoCover(bytes); }
  catch { return reply(400, 'video_cover_invalid'); }
  if (!await current()) return reply(409, 'video_cover_source_changed');
  await env.MEDIA.put(key, bytes.buffer, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'image/webp' }, customMetadata: {
    ownerId: owner, artifactId: source.customMetadata!.artifactId ?? '', source: 'video-cover', sourceKey, sourceSha256, ...(legacy ? { sourceEtag } : {}),
    sha256: await hash(bytes), mimeType: 'image/webp', width: String(size.width), height: String(size.height), capture: 'browser-frame-v1',
  } });
  if (!await current()) { await env.MEDIA.delete(key); return reply(409, 'video_cover_source_changed'); }
  return Response.json({ url: request.url, mimeType: 'image/webp', ...size }, { headers });
}
