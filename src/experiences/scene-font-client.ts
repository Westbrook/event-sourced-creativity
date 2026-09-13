import { SCENE_FONT_SHA256, SCENE_FONT_URL } from "../components/scene-text-measurement.ts";
import { ExperienceHostOperation } from "./host-operation.ts";

/** Public pinned asset only. This read has no private source, job or provider
 * authority. Caller rechecks its result lease after awaiting it. A blocked or
 * unavailable font must leave the literal Scene readable without a page claim.
 */
export async function readExperienceSceneFont(controls: {
  origin: string; signal: AbortSignal; current(): boolean;
  request?: typeof fetch; timeoutMs?: number;
}): Promise<ArrayBuffer | null> {
  const abort = new AbortController();
  const operation = new ExperienceHostOperation(() => abort.abort(), controls.timeoutMs);
  const withdraw = () => { abort.abort(); operation.cancel(); };
  controls.signal.addEventListener("abort", withdraw, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined, complete = false;
  const current = () => operation.current() && !abort.signal.aborted && !controls.signal.aborted && controls.current();
  try {
    const url = new URL(SCENE_FONT_URL, controls.origin);
    if (!current() || url.origin !== controls.origin || !["http:", "https:"].includes(url.protocol)) return null;
    response = await operation.wait((controls.request ?? fetch)(SCENE_FONT_URL, {
      method: "GET", credentials: "omit", redirect: "error", cache: "force-cache",
      headers: { accept: "font/ttf, application/octet-stream" }, signal: abort.signal,
    }));
    if (!current() || response.status !== 200 || response.redirected || response.url !== url.href || !response.body
      || !/^(?:font\/ttf|application\/(?:octet-stream|x-font-ttf))(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) return null;
    const declared = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
    const identity = encoding === null || encoding.trim().toLowerCase() === "identity";
    if (declared !== null && (!/^(0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared))
      || identity && Number(declared) !== 49_744)) return null;
    reader = response.body.getReader();
    const bytes = new Uint8Array(49_744); let offset = 0;
    for (;;) {
      if (!current()) return null;
      const chunk = await operation.wait(reader.read());
      if (!current()) return null;
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array) || !chunk.value.length || offset + chunk.value.length > bytes.length) return null;
      bytes.set(chunk.value, offset); offset += chunk.value.length;
    }
    complete = true;
    if (offset !== bytes.length) return null;
    const digest = await operation.wait(crypto.subtle.digest("SHA-256", bytes));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return current() && hash === SCENE_FONT_SHA256 ? bytes.buffer : null;
  } catch { return null; }
  finally {
    controls.signal.removeEventListener("abort", withdraw);
    operation.finish();
    if (!complete) {
      abort.abort();
      try { const cancellation = reader ? reader.cancel() : response?.body?.cancel(); if (cancellation) void cancellation.catch(() => {}); }
      catch { /* A failed cancellation cannot postpone withdrawal. */ }
    }
    reader?.releaseLock();
  }
}
