import { inspectVideoCover, VIDEO_COVER_MAX_BYTES, VIDEO_COVER_MAX_EDGE, videoCoverUrl } from '../model/video-cover.ts';

type CoverResult = { blob: Blob | null; retry: boolean };
const pending = new Map<string, Promise<CoverResult>>();
let captureTail: Promise<unknown> = Promise.resolve();
const MAX_VIDEO_BYTES = 64_000_000;

/** Live completion maintenance; historical lists backfill lazily through the preview. */
export function warmCompletedVideoCovers(events: readonly { type: string; payload: Record<string, unknown> }[]) {
  if (typeof HTMLVideoElement === 'undefined') return;
  const warm = async (source: string, attempt = 0): Promise<void> => {
    const result = await ensureVideoCover(source);
    if (result.retry && attempt < 2) setTimeout(() => { void warm(source, attempt + 1); }, (attempt + 1) * 5000);
  };
  for (const event of events) if (event.type === 'DocumentRenderCompleted' && event.payload.artifact_kind === 'video'
    && typeof event.payload.media_url === 'string') void warm(event.payload.media_url);
}

async function readBytes(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > maximum) throw Error('video_cover_size');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.length; if (length > maximum) throw Error('video_cover_size');
      chunks.push(next.value);
    }
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Decode once off-DOM. The only persistent output is a still WebP. */
export async function captureVideoCover(blob: Blob, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const video = document.createElement('video'), url = URL.createObjectURL(blob);
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  const waitFor = (event: string, action: () => void) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { video.removeEventListener(event, done); video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(Error('video_cover_decode')); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted(); else action();
  });
  try {
    await waitFor('loadeddata', () => { video.src = url; video.load(); });
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) throw Error('video_cover_dimensions');
    await waitFor('seeked', () => { video.currentTime = Math.min(1, video.duration * .1); });
    signal.throwIfAborted();
    const scale = Math.min(1, VIDEO_COVER_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw Error('video_cover_canvas');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .82));
    signal.throwIfAborted();
    // Unsupported encoders can silently return PNG. Never upload it as WebP.
    if (!image || image.type !== 'image/webp' || image.size > VIDEO_COVER_MAX_BYTES) throw Error('video_cover_webp_unavailable');
    inspectVideoCover(new Uint8Array(await image.arrayBuffer()));
    return image;
  } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

async function readCover(response: Response): Promise<CoverResult> {
  if (response.headers.get('content-type') !== 'image/webp') throw Error('video_cover_type');
  const bytes = await readBytes(response, VIDEO_COVER_MAX_BYTES); inspectVideoCover(bytes);
  return { blob: new Blob([bytes], { type: 'image/webp' }), retry: false };
}

/** No success cache: each mount rechecks server authorization and source identity. */
export function ensureVideoCover(source: string): Promise<CoverResult> {
  const cover = videoCoverUrl(source); if (!cover) return Promise.resolve({ blob: null, retry: false });
  const previous = pending.get(source); if (previous) return previous;
  const run = async (): Promise<CoverResult> => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000), signal = controller.signal;
    const get = (url: string) => fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
    try {
      const existing = await get(cover);
      if (existing.ok) return await readCover(existing);
      const digest = existing.headers.get('x-video-source-sha256');
      if (existing.status !== 404 || existing.headers.get('x-video-cover-writable') !== '1' || !digest || !/^[a-f0-9]{64}$/.test(digest)) {
        return { blob: null, retry: existing.status >= 500 || existing.status === 409 || existing.status === 429 };
      }
      // Serialize expensive decoding; recheck after waiting in case another tab supplied the cover.
      const capture = async (): Promise<CoverResult> => {
        signal.throwIfAborted();
        const recheck = await get(cover);
        if (recheck.ok) return readCover(recheck);
        if (recheck.status !== 404 || recheck.headers.get('x-video-source-sha256') !== digest || recheck.headers.get('x-video-cover-writable') !== '1') return { blob: null, retry: recheck.status === 409 || recheck.status >= 500 };
        const video = await get(source);
        if (!video.ok || video.headers.get('content-type') !== 'video/mp4') return { blob: null, retry: video.status >= 500 };
        const bytes = await readBytes(video, MAX_VIDEO_BYTES);
        const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        if (actual !== digest) return { blob: null, retry: true };
        const image = await captureVideoCover(new Blob([bytes], { type: 'video/mp4' }), signal);
        const saved = await fetch(cover, { method: 'POST', credentials: 'same-origin', signal,
          headers: { 'content-type': 'image/webp', 'x-video-source-sha256': digest }, body: image });
        if (!saved.ok) return { blob: null, retry: saved.status >= 500 || saved.status === 409 || saved.status === 429 };
        // Render the retained winner when concurrent tabs raced to create the same cover.
        const retained = await get(cover); return retained.ok ? readCover(retained) : { blob: null, retry: true };
      };
      const task = captureTail.then(capture, capture); captureTail = task.catch(() => undefined);
      return await task;
    } catch { return { blob: null, retry: true }; }
    finally { clearTimeout(timer); }
  };
  const promise = run().finally(() => pending.delete(source)); pending.set(source, promise); return promise;
}
