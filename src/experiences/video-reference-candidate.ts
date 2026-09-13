import { exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { readVideoReferenceIntent, type VideoReferenceIntent } from "./video-reference.ts";
import { isPrivateReferencePreview } from "./model3d-reference-plan.ts";
export type VideoReferenceCandidate = Readonly<{ source: Omit<VideoReferenceIntent, "permissionAttestation">; label: string; preview: string }>;
/** Discovery has no permission assertion. The checkbox must supply it later. */
export function readVideoReferenceCandidate(value: unknown): VideoReferenceCandidate | null {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["source", "label", "preview"])
    || !record(value.source) || !exactKeys(value.source, ["version", "sourceProjectId", "sourceDocumentId", "sourceBlockId", "referenceId", "sha256"])
    || typeof value.label !== "string" || !value.label || !isPrivateReferencePreview(value.preview)) return null;
  // Parser shape-check only; this constant is never returned as attestation.
  if (!readVideoReferenceIntent({ ...value.source, permissionAttestation: "i-own-or-have-permission" })) return null;
  return freeze(structuredClone(value)) as VideoReferenceCandidate;
}
