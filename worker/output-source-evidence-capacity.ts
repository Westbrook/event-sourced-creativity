import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";
import { verifySourceDocumentEvidence } from "./source-reference-evidence.ts";
import type { WorkerEnv } from "./runtime.ts";

type SourceBlock = { type: string; properties: Record<string, unknown> };
export type OutputSourceEvidenceCheck = {
  status: "verified" | "unavailable" | "capacity_exceeded";
  reasonCode: "context_source_evidence_unavailable" | "context_source_evidence_capacity_exceeded" | null;
  referenceCount: number; distinctObjectCount: number; countsComplete: boolean; objectReads: number;
};

/** Counts only the same extracted reference claims checked by the existing worker. */
export function outputExtractedSourceReferences<T extends SourceBlock>(blocks: readonly T[]): T[] {
  return blocks.filter((block) => block.type === "reference" && (block.properties.source_evidence_hash || block.properties.extraction_status === "ready"));
}

function ownedKey(ownerId: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/media/")) return null;
  let key: string;
  try { key = decodeURIComponent(value.slice("/api/media/".length)); } catch { return null; }
  return mediaKeyMatchesOwnerNamespace(key, ownerId) ? key : null;
}

/**
 * Capacity is explicit and caller-owned: admission must reserve these binding
 * calls, not guess that a nearly-full provider request has room for references.
 * This invocation never reuses metadata from another scope or request.
 */
export async function verifyOutputSourceEvidence(env: WorkerEnv, ownerId: string, blocks: readonly SourceBlock[], options: { maximumDistinctObjects: number }): Promise<OutputSourceEvidenceCheck> {
  const limit = options.maximumDistinctObjects;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 8) throw new Error("invalid_output_source_evidence_capacity");
  const references = outputExtractedSourceReferences(blocks), keys = references.map((block) => ownedKey(ownerId, block.properties.media_url));
  const expected = new Set(keys.filter((key): key is string => key !== null));
  const result = (status: OutputSourceEvidenceCheck["status"], reads = 0): OutputSourceEvidenceCheck => ({ status,
    reasonCode: status === "verified" ? null : status === "capacity_exceeded" ? "context_source_evidence_capacity_exceeded" : "context_source_evidence_unavailable",
    referenceCount: references.length, distinctObjectCount: expected.size, countsComplete: keys.every((key) => key !== null), objectReads: reads });
  if (keys.some((key) => key === null)) return result("unavailable");
  // Do this before the first HEAD. No prefix scan, partial verification, or
  // source removal can turn a too-large corpus into an authorized smaller one.
  if (expected.size > limit) return result("capacity_exceeded");
  let reads = 0;
  const metadata = new Map<string, Promise<Awaited<ReturnType<WorkerEnv["MEDIA"]["head"]>>>>();
  const head: WorkerEnv["MEDIA"]["head"] = (key) => {
    if (!expected.has(key)) throw new Error("output_source_evidence_scope_mismatch");
    let pending = metadata.get(key);
    if (!pending) {
      reads++;
      pending = typeof env.MEDIA.head === "function" ? env.MEDIA.head(key) : env.MEDIA.get(key);
      metadata.set(key, pending);
    }
    return pending;
  };
  // Only the metadata lookup changes. The existing validator still checks each
  // block's ownership, MIME, content hash, extraction receipt, text and anchors.
  const boundedEnv: WorkerEnv = { ...env, MEDIA: { ...env.MEDIA, head } };
  try {
    for (const block of references) if (!await verifySourceDocumentEvidence(boundedEnv, ownerId, block.properties.media_url, block.properties)) return result("unavailable", reads);
    return result("verified", reads);
  } catch { return result("unavailable", reads); }
}
