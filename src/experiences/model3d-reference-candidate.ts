import { exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { readModel3dReferenceIntent, type Model3dReferenceIntent } from "./model3d-reference.ts";
import { isPrivateReferencePreview } from "./model3d-reference-plan.ts";

export type Model3dReferenceCandidate = Readonly<{
  source: Omit<Model3dReferenceIntent, "permissionAttestation">;
  label: string;
  preview: string;
}>;

/** Discovery metadata is not a rights statement or a successful custody inspection. */
export function readModel3dReferenceCandidate(value: unknown): Model3dReferenceCandidate | null {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["source", "label", "preview"])
    || !record(value.source) || !exactKeys(value.source, ["version", "kind", "sourceProjectId", "sourceDocumentId", "sourceBlockId", "referenceId", "sha256"])
    || typeof value.label !== "string" || !value.label || !isPrivateReferencePreview(value.preview)) return null;
  // Structural parser reuse only: this constant is deliberately not returned as
  // attestation. The picker must get its checkbox statement from the user.
  if (!readModel3dReferenceIntent({ ...value.source, permissionAttestation: "i-own-or-have-permission" })) return null;
  return freeze(structuredClone(value)) as Model3dReferenceCandidate;
}
