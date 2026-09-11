import type { OutputRequirementsSnapshot } from "./output-delivery-contract.ts";

export const OUTPUT_REVIEW_PREVIEW_MAX_BYTES = 24 * 1024 * 1024;
export type OutputPreviewFile = { byteLength: number; sha256: string; mimeType: string };
export function outputReviewPreviewResourceAllows(state: string, retained: boolean): boolean {
  return state === "ready" || retained && state === "refreshing";
}

/** Shared across result controllers: bound reserved/retained bytes and concurrent reads. */
export class OutputReviewPreviewBudget {
  #owners = new Map<object, { bytes: number; loading: boolean }>();
  #listeners = new Set<() => void>();
  subscribe(listener: () => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  reserve(bytes: number): { release: () => void; settle: () => void } | null {
    const owners = [...this.#owners.values()];
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > OUTPUT_REVIEW_PREVIEW_MAX_BYTES
      || owners.length >= 4 || owners.filter((owner) => owner.loading).length >= 2
      || owners.reduce((total, owner) => total + owner.bytes, bytes) > 2 * OUTPUT_REVIEW_PREVIEW_MAX_BYTES) return null;
    const id = {}, owner = { bytes, loading: true }; this.#owners.set(id, owner);
    const changed = () => { for (const listener of this.#listeners) listener(); };
    return {
      release: () => { if (this.#owners.delete(id)) changed(); },
      settle: () => { if (this.#owners.has(id) && owner.loading) { owner.loading = false; changed(); } },
    };
  }
}
export const outputReviewPreviewBudget = new OutputReviewPreviewBudget();
export function outputReviewPreviewKind(mime: string): "image" | "audio" | "video" | null {
  if (mime === "image/jpeg" || mime === "image/png") return "image";
  if (mime === "audio/mpeg" || mime === "audio/wav" || mime === "audio/x-wav") return "audio";
  return mime === "video/mp4" ? "video" : null;
}

/** A preview belongs to this exact matched result, not merely to a reusable asset. */
export function outputReviewPreviewIdentity(snapshot: OutputRequirementsSnapshot, resultId: string): string | null {
  const result = snapshot.results.find((entry) => entry.id === resultId);
  const asset = snapshot.assets.find((entry) => entry.id === result?.assetId);
  const plan = snapshot.confirmedPlan;
  const target = plan?.plan.targets.find((entry) => entry.id === result?.targetId);
  if (!result || !asset || !plan || !target || !snapshot.permissions.canDownload
    || !asset.available || asset.inspection.status !== "inspected" || asset.mediaKind !== target.media_kind
    || !result.resultRevision || result.planRevisionId !== plan.revisionId
    || !result.targetContractDigest || result.targetContractDigest !== plan.targetContractDigests?.[target.id]
    || result.sourceDigest !== snapshot.sourceRevision || result.sha256 !== asset.sha256
    || !/^[a-f0-9]{64}$/.test(asset.sha256) || target.blocking_issues.length) return null;
  return JSON.stringify([snapshot.documentId, snapshot.projectId, snapshot.scope, snapshot.sourceRevision,
    snapshot.requirementRevision, plan.revisionId, target.id, result.targetContractDigest,
    result.id, result.resultRevision, asset.id, asset.sha256, asset.mimeType, asset.byteLength, asset.downloadUrl]);
}

/** Bounded exact bytes only: never render a redirect, active document, or unchecked thumbnail. */
export async function readOutputReviewPreview(response: Response, expected: OutputPreviewFile, signal?: AbortSignal): Promise<Blob> {
  const fail = () => new Error("The exact file could not be verified for preview.");
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const length = response.headers.get("content-length");
  if (signal?.aborted || !response.ok || response.redirected || !response.body
    || !outputReviewPreviewKind(expected.mimeType) || mime !== expected.mimeType
    || !Number.isSafeInteger(expected.byteLength) || expected.byteLength < 1
    || expected.byteLength > OUTPUT_REVIEW_PREVIEW_MAX_BYTES || !/^[a-f0-9]{64}$/.test(expected.sha256)
    || length !== null && (!/^\d+$/.test(length) || Number(length) !== expected.byteLength)) {
    void response.body?.cancel().catch(() => undefined); throw fail();
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw fail();
      const next = await reader.read();
      if (signal?.aborted) throw fail();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > expected.byteLength || size > OUTPUT_REVIEW_PREVIEW_MAX_BYTES) throw fail();
      chunks.push(next.value);
    }
    if (size !== expected.byteLength) throw fail();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (signal?.aborted || digest !== expected.sha256) throw fail();
    return new Blob([bytes], { type: expected.mimeType });
  } finally {
    signal?.removeEventListener("abort", abort);
    // A hostile or stalled underlying source may never settle cancellation.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
