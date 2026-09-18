import { MAX_AUDIO_UPLOAD_BYTES } from "./audio.ts";
import { captureNativeRetainedAudioMedia, type NativeRetainedAudioContent } from "./native-retained-audio.ts";

type Media = NonNullable<NativeRetainedAudioContent["media"]>;
type Controls = { signal: AbortSignal; current: () => boolean; origin: string;
  request: (path: string, init: RequestInit) => Promise<Response> };

// A generated key can be overwritten. Playback therefore uses only an owned
// Blob whose complete bytes match this immutable retained receipt. This is an
// explicit user-triggered read, not a provider call or an audio quality check.
export async function readNativeRetainedAudioMedia(media: Media, controls: Controls): Promise<Blob> {
  const selected = captureNativeRetainedAudioMedia(media);
  if (!selected) throw new Error("retained_audio_unavailable");
  const url = new URL(selected.url, controls.origin);
  if (url.origin !== controls.origin || url.pathname !== selected.url || url.search || url.hash) throw new Error("retained_audio_unavailable");
  const controller = new AbortController(), deadline = Date.now() + 30_000;
  const current = () => !controls.signal.aborted && !controller.signal.aborted && controls.current() && Date.now() < deadline;
  const check = () => { if (!current()) throw new Error("retained_audio_retired"); };
  check();
  let stop!: (reason: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => { stop = reject; });
  const abort = () => { controller.abort(); stop(new Error("retained_audio_retired")); };
  controls.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 30_000);
  const settle = <T>(operation: Promise<T>) => Promise.race([operation, stopped]);
  const cancel = (operation: (() => Promise<unknown>) | undefined) => {
    // Observe cancellation failure without retaining the read on an untrusted
    // source's pending cancellation; the ownership/timeout path already wins.
    try { if (operation) void operation().catch(() => undefined); } catch { /* Already released. */ }
  };
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    check();
    const request = controls.request(selected.url, { method: "GET", signal: controller.signal,
      credentials: "same-origin", redirect: "error", cache: "no-store" });
    void request.then(late => { if (!current()) cancel(late.body ? () => late.body!.cancel() : undefined); }, () => undefined).catch(() => undefined);
    response = await settle(request); check();
    if (response.status !== 200 || response.redirected || response.url !== url.href
      || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== selected.mediaType) throw new Error("retained_audio_unavailable");
    const header = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
    const identity = encoding === null || encoding.trim().toLowerCase() === "identity";
    if (header !== null && (!/^(0|[1-9]\d*)$/u.test(header) || !Number.isSafeInteger(Number(header))
      || identity && (Number(header) < 1 || Number(header) > MAX_AUDIO_UPLOAD_BYTES))) throw new Error("retained_audio_size");
    reader = response.body?.getReader();
    if (!reader) throw new Error("retained_audio_unavailable");
    // One fixed allocation avoids retaining an unbounded number of tiny chunks.
    const bytes = new Uint8Array(MAX_AUDIO_UPLOAD_BYTES); let size = 0, chunks = 0;
    for (;;) {
      check(); const part = await settle(reader.read()); check();
      if (part.done) break;
      if (++chunks > 65_536 || !(part.value instanceof Uint8Array) || !part.value.byteLength
        || size + part.value.byteLength > MAX_AUDIO_UPLOAD_BYTES) throw new Error("retained_audio_size");
      bytes.set(part.value, size); size += part.value.byteLength;
    }
    complete = true;
    if (!size || identity && header !== null && size !== Number(header)) throw new Error("retained_audio_size");
    const exact = bytes.subarray(0, size);
    const actual = Array.from(new Uint8Array(await settle(crypto.subtle.digest("SHA-256", exact))), value => value.toString(16).padStart(2, "0")).join("");
    check();
    if (actual !== selected.sha256) throw new Error("retained_audio_changed");
    return new Blob([exact], { type: selected.mediaType });
  } finally {
    clearTimeout(timer); controls.signal.removeEventListener("abort", abort); controller.abort();
    if (!complete) cancel(reader ? () => reader!.cancel() : response?.body ? () => response!.body!.cancel() : undefined);
    reader?.releaseLock();
  }
}
