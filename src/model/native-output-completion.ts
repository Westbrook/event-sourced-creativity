import { nativeRetainedOutputRequestPath } from "./native-retained-output.ts";
import type { RetainedStorySelection } from "./retained-short-story.ts";

/** Exact original native job identity; never a newer artifact or current draft. */
export type NativeOutputHandle = Readonly<{ documentId: string; jobId: string }>;
export type NativeCompletionOutput = "scene" | "slides" | "storyboard" | "audio" | "video" | "model3d";
export type NativeOutputCompletion<Output extends NativeCompletionOutput> = Readonly<{
  schemaVersion: 1; kind: `native-${Output}-completion`; handle: NativeOutputHandle;
  selection: RetainedStorySelection; expiresAt: string;
}>;
export const NATIVE_OUTPUT_COMPLETION_MAX_BYTES = 8192;
const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

function own(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return null; }
}

export function captureNativeOutputHandle(value: unknown): NativeOutputHandle | null {
  const row = own(value, ["documentId", "jobId"]);
  return row && typeof row.documentId === "string" && opaque.test(row.documentId)
    && typeof row.jobId === "string" && opaque.test(row.jobId)
    ? Object.freeze({ documentId: row.documentId, jobId: row.jobId }) : null;
}

export function nativeOutputCompletionPath(output: NativeCompletionOutput, value: NativeOutputHandle): string {
  if (output !== "scene" && output !== "slides" && output !== "storyboard" && output !== "audio" && output !== "video" && output !== "model3d") throw new TypeError("invalid_native_completion_output");
  const handle = captureNativeOutputHandle(value);
  if (!handle) throw new TypeError(`invalid_native_${output}_handle`);
  return `/api/retained-output/${output}/jobs/${encodeURIComponent(handle.documentId)}/${encodeURIComponent(handle.jobId)}`;
}

export function parseNativeOutputCompletionUrl(output: NativeCompletionOutput, value: string): NativeOutputHandle | null {
  if (output !== "scene" && output !== "slides" && output !== "storyboard" && output !== "audio" && output !== "video" && output !== "model3d") return null;
  if (typeof value !== "string" || value.length > 4096) return null;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c || code === 0x23) return null;
  }
  try {
    const url = new URL(value);
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    const match = new RegExp(`^/api/retained-output/${output}/jobs/([^/]+)/([^/]+)$`, "u").exec(url.pathname);
    if (!match) return null;
    const handle = captureNativeOutputHandle({ documentId: decodeURIComponent(match[1]!), jobId: decodeURIComponent(match[2]!) });
    return handle && url.pathname === nativeOutputCompletionPath(output, handle) && value === url.origin + url.pathname ? handle : null;
  } catch { return null; }
}

/** A current bounded selection from the literal output's read-only completion endpoint. */
export function validateNativeOutputCompletion<Output extends NativeCompletionOutput>(output: Output, value: unknown, expected: NativeOutputHandle, now = Date.now()): NativeOutputCompletion<Output> | null {
  if (output !== "scene" && output !== "slides" && output !== "storyboard" && output !== "audio" && output !== "video" && output !== "model3d") return null;
  const expectedHandle = captureNativeOutputHandle(expected);
  if (!expectedHandle) return null;
  const row = own(value, ["schemaVersion", "kind", "handle", "selection", "expiresAt"]);
  if (!row || row.schemaVersion !== 1 || row.kind !== `native-${output}-completion`) return null;
  const handle = captureNativeOutputHandle(row.handle), selected = own(row.selection, ["documentId", "artifactId", "revision", "contentSha256"]);
  if (!handle || handle.documentId !== expectedHandle.documentId || handle.jobId !== expectedHandle.jobId || !selected
    || selected.documentId !== handle.documentId || selected.revision !== 0 || typeof row.expiresAt !== "string"
    || !Number.isFinite(now) || !(Date.parse(row.expiresAt) > now)) return null;
  try {
    if (new Date(row.expiresAt).toISOString() !== row.expiresAt) return null;
    const selection = Object.freeze({ ...selected }) as RetainedStorySelection;
    nativeRetainedOutputRequestPath({ output, selection });
    const receipt = Object.freeze({ schemaVersion: 1 as const, kind: `native-${output}-completion` as const,
      handle, selection, expiresAt: row.expiresAt });
    return new TextEncoder().encode(JSON.stringify(receipt)).length <= NATIVE_OUTPUT_COMPLETION_MAX_BYTES ? receipt : null;
  } catch { return null; }
}

/** Selection-only handoff; the existing reader rechecks current access and exact bytes. */
export function nativeOutputRetainedRoute(output: NativeCompletionOutput, value: unknown, expected: NativeOutputHandle): string | null {
  const receipt = validateNativeOutputCompletion(output, value, expected);
  if (!receipt) return null;
  const selected = receipt.selection;
  return `/make/${output}?` + new URLSearchParams({ document: selected.documentId, artifact: selected.artifactId,
    revision: String(selected.revision), sha256: selected.contentSha256 }).toString();
}
