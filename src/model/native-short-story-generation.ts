import { RETAINED_STORY_ROUTE, retainedStoryRequestPath, type RetainedStorySelection } from "./retained-short-story.ts";
import { documentRenderGuidance } from "./document-render-guidance.ts";

/** Native Document/manual-render identity only; never an Experience admission or a budget receipt. */
export type NativeStoryHandle = Readonly<{ documentId: string; jobId: string }>;
export type NativeStorySetup = Readonly<{ documentId: string; audience: string; tone: string; locale: string }>;
export type NativeStoryFailureReason = "budget-blocked" | "user-canceled" | "unavailable";
export type NativeStorySubmission =
  | Readonly<{ disposition: "acknowledged"; handle: NativeStoryHandle; reused: boolean }>
  | Readonly<{ disposition: "not-dispatched"; handle: null; reason: NativeStoryFailureReason }>
  | Readonly<{ disposition: "dispatched-unconfirmed"; handle: null }>;
export type NativeStoryCompletion = Readonly<{
  schemaVersion: 1; kind: "native-short-story-completion"; handle: NativeStoryHandle;
  selection: RetainedStorySelection; expiresAt: string;
}>;
export const NATIVE_STORY_COMPLETION_MAX_BYTES = 8192;
const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

function own(value: unknown, keys: readonly string[], exact = true): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (exact && Reflect.ownKeys(descriptors).length !== keys.length) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return null; }
}

/** Closed native manual settings; guidance retains its existing trim/120-unit rules. */
export function captureNativeStorySetup(value: unknown): NativeStorySetup | null {
  const row = own(value, ["documentId", "audience", "tone", "locale"]);
  if (!row || typeof row.documentId !== "string" || !opaque.test(row.documentId)
    || typeof row.audience !== "string" || typeof row.tone !== "string"
    || row.audience.length > 256 || row.tone.length > 256
    || typeof row.locale !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(row.locale)
    || row.locale.length > 35) return null;
  const guidance = documentRenderGuidance(row);
  if (guidance.issues.length) return null;
  return Object.freeze({ documentId: row.documentId, audience: guidance.audience, tone: guidance.tone, locale: row.locale });
}

export function captureNativeStoryHandle(value: unknown): NativeStoryHandle | null {
  const row = own(value, ["documentId", "jobId"]);
  return row && typeof row.documentId === "string" && opaque.test(row.documentId)
    && typeof row.jobId === "string" && opaque.test(row.jobId)
    ? Object.freeze({ documentId: row.documentId, jobId: row.jobId }) : null;
}

/** Only the acknowledged native response is inspected; a boolean or a newest-artifact guess cannot supply this. */
export function acknowledgedNativeStoryHandle(value: unknown, expected: {
  documentId: string; documentRevision: unknown; requestKey: unknown;
}): NativeStoryHandle | null {
  const row = own(value, ["jobId", "documentId", "kind", "status", "sourceSurface", "productionMode", "documentRevision", "requestKey", "result"], false);
  const result = row && own(row.result, ["artifactKind"], false);
  if (!row || !result || row.documentId !== expected.documentId || row.kind !== "render_document"
    || row.sourceSurface !== "document" || row.productionMode !== "manual" || result.artifactKind !== "short_story"
    || typeof expected.documentRevision !== "string" || !expected.documentRevision
    || typeof expected.requestKey !== "string" || !expected.requestKey
    || row.documentRevision !== expected.documentRevision || row.requestKey !== expected.requestKey
    || typeof row.status !== "string" || !["queued", "running", "committing", "completed", "partial", "failed", "canceled"].includes(row.status)) return null;
  return captureNativeStoryHandle({ documentId: row.documentId, jobId: row.jobId });
}

export function nativeStoryCompletionPath(value: NativeStoryHandle): string {
  const handle = captureNativeStoryHandle(value);
  if (!handle) throw new TypeError("invalid_native_story_handle");
  return `/api/retained-story/jobs/${encodeURIComponent(handle.documentId)}/${encodeURIComponent(handle.jobId)}`;
}

export function parseNativeStoryCompletionUrl(value: string): NativeStoryHandle | null {
  if (typeof value !== "string" || value.length > 4096 || /[\0-\u0020\u007f\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/api\/retained-story\/jobs\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (!match) return null;
    const handle = captureNativeStoryHandle({ documentId: decodeURIComponent(match[1]!), jobId: decodeURIComponent(match[2]!) });
    return handle && url.pathname === nativeStoryCompletionPath(handle) && value === url.origin + url.pathname ? handle : null;
  } catch { return null; }
}

export function validateNativeStoryCompletion(value: unknown, expected: NativeStoryHandle, now = Date.now()): NativeStoryCompletion | null {
  const expectedHandle = captureNativeStoryHandle(expected);
  if (!expectedHandle) return null;
  const row = own(value, ["schemaVersion", "kind", "handle", "selection", "expiresAt"]);
  if (!row || row.schemaVersion !== 1 || row.kind !== "native-short-story-completion") return null;
  const handle = captureNativeStoryHandle(row.handle), selected = own(row.selection, ["documentId", "artifactId", "revision", "contentSha256"]);
  if (!handle || handle.documentId !== expectedHandle.documentId || handle.jobId !== expectedHandle.jobId || !selected
    || selected.documentId !== handle.documentId || selected.revision !== 0 || typeof row.expiresAt !== "string"
    || !Number.isFinite(now) || !(Date.parse(row.expiresAt) > now)) return null;
  try {
    if (new Date(row.expiresAt).toISOString() !== row.expiresAt) return null;
    const selection = Object.freeze({ ...selected }) as RetainedStorySelection;
    retainedStoryRequestPath(selection);
    const receipt = Object.freeze({ schemaVersion: 1 as const, kind: "native-short-story-completion" as const,
      handle, selection, expiresAt: row.expiresAt });
    return new TextEncoder().encode(JSON.stringify(receipt)).length <= NATIVE_STORY_COMPLETION_MAX_BYTES ? receipt : null;
  } catch { return null; }
}

/** Selection-only handoff to the existing authenticated reader and its artifact-bound Edit action. */
export function nativeStoryRetainedRoute(value: unknown, expected: NativeStoryHandle): string | null {
  const receipt = validateNativeStoryCompletion(value, expected);
  if (!receipt) return null;
  const selected = receipt.selection;
  return RETAINED_STORY_ROUTE + "?" + new URLSearchParams({ document: selected.documentId, artifact: selected.artifactId,
    revision: String(selected.revision), sha256: selected.contentSha256 }).toString();
}
