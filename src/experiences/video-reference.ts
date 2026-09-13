/** Requested profile, not measured media, a quote or generation authorization. */
export const EXPERIENCE_VIDEO_INTENT = Object.freeze({
  version: 1, seconds: 4, resolution: "480p", audioMode: "silent", referenceCount: 1,
} as const);

/** Select existing author-owned context; no URL, upload or ownership claim. */
export type VideoReferenceIntent = Readonly<{
  version: 1;
  sourceProjectId: string;
  sourceDocumentId: string;
  sourceBlockId: string;
  referenceId: string;
  sha256: string;
  permissionAttestation: "i-own-or-have-permission";
}>;
const keys = ["version", "sourceProjectId", "sourceDocumentId", "sourceBlockId", "referenceId", "sha256", "permissionAttestation"] as const;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,239}$/u.test(value);
export function readVideoReferenceIntent(value: unknown): VideoReferenceIntent | null {
  try {
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key])) return null;
    const copy = Object.fromEntries(keys.map(key => [key, descriptors[key]!.value]));
    if (copy.version !== 1 || copy.permissionAttestation !== "i-own-or-have-permission"
      || ![copy.sourceProjectId, copy.sourceDocumentId, copy.sourceBlockId, copy.referenceId].every(id)
      || typeof copy.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(copy.sha256)) return null;
    return Object.freeze(copy) as VideoReferenceIntent;
  } catch { return null; }
}
