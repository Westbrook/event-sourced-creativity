import { captureNativeStoryHandle, nativeStoryCompletionPath, validateNativeStoryCompletion, NATIVE_STORY_COMPLETION_MAX_BYTES, type NativeStoryHandle, type NativeStoryCompletion } from "./native-short-story-generation.ts";
import {
  RETAINED_STORY_JSON_MAX_BYTES, retainedStoryRequestPath, validateRetainedStoryDto,
  type RetainedStoryDto, type RetainedStorySelection,
} from "./retained-short-story.ts";

export type RetainedStoryReadControls = {
  origin: string;
  signal: AbortSignal;
  current: () => boolean;
  request: (path: string, init: RequestInit) => Promise<Response>;
};

/** One bounded, same-origin read. This private transport cannot admit or run a job. */
async function readNativeJson<T extends {expiresAt:string}>(
  path:string, controls:RetainedStoryReadControls, maximumBytes:number, validate:(value:unknown)=>T|null,
):Promise<T> {
  const url = new URL(path, controls.origin);
  const current = () => {
    if (controls.signal.aborted || !controls.current()) throw new Error("retained_story_withdrawn");
  };
  if (url.origin !== controls.origin || url.pathname + url.search !== path || url.hash) throw new Error("retained_story_unavailable");
  current();
  const response = await controls.request(path, { method: "GET", credentials: "same-origin", cache: "no-store",
    redirect: "error", headers: { accept: "application/json" }, signal: controls.signal });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    current();
    if (response.status !== 200 || response.redirected || response.url !== url.href
      || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")
      || !response.body) throw new Error("retained_story_unavailable");
    const declared = response.headers.get("content-length");
    const encoding = response.headers.get("content-encoding");
    const identityEncoding = encoding === null || encoding.trim().toLowerCase() === "identity";
    if (declared !== null && (!/^(0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared))
      || identityEncoding && Number(declared) > maximumBytes)) throw new Error("retained_story_unavailable");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      current();
      const item = await reader.read();
      current();
      if (item.done) break;
      if (!(item.value instanceof Uint8Array) || item.value.byteLength === 0) throw new Error("retained_story_unavailable");
      length += item.value.byteLength;
      if (length > maximumBytes) throw new Error("retained_story_unavailable");
      chunks.push(item.value);
    }
    complete = true;
    // Fetch exposes decoded bytes; compressed Content-Length describes the
    // encoded representation. The measured decoded cap always applies.
    if (identityEncoding && declared !== null && Number(declared) !== length) throw new Error("retained_story_unavailable");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const candidate: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    current();
    const value = validate(candidate);
    if (!value || !(Date.parse(value.expiresAt) > Date.now())) throw new Error("retained_story_unavailable");
    current();
    return value;
  } finally {
    if (!complete) {
      try {
        const cancellation = reader ? reader.cancel() : response.body?.cancel();
        // Observe cancellation failure, but never let an untrusted source's
        // pending cancellation delay withdrawal or retain our reader lock.
        if (cancellation) void cancellation.catch(() => undefined);
      }
      catch { /* Withdrawal cannot turn a failed read into a positive result. */ }
    }
    reader?.releaseLock();
  }
}

/** A same-origin read, not admission or a replacement for the server's current authority check. */
export async function readRetainedShortStory(
  selection:RetainedStorySelection, controls:RetainedStoryReadControls,
):Promise<RetainedStoryDto> {
  const expected=Object.freeze({documentId:selection.documentId,artifactId:selection.artifactId,
    revision:selection.revision,contentSha256:selection.contentSha256});
  return readNativeJson(retainedStoryRequestPath(expected),controls,RETAINED_STORY_JSON_MAX_BYTES,
    value=>validateRetainedStoryDto(value,expected));
}

/** Explicit completion check only. Unavailable never retries submission or picks a newer artifact. */
export async function readNativeStoryCompletion(
  value:NativeStoryHandle, controls:RetainedStoryReadControls,
):Promise<NativeStoryCompletion> {
  const handle=captureNativeStoryHandle(value);
  if(!handle)throw new Error("invalid_native_story_handle");
  return readNativeJson(nativeStoryCompletionPath(handle),controls,NATIVE_STORY_COMPLETION_MAX_BYTES,
    candidate=>validateNativeStoryCompletion(candidate,handle));
}
