/** All evidence is private input metadata. Never include it in public error text. */
export const IMAGE_REFERENCE_CONTRACT_VERSION = "image-reference-2026-09-22-v1";
// Decimal MB is deliberately conservative where the docs do not define units.
export const IMAGE_REFERENCE_MAX_BYTES = 20_000_000;
export const IMAGE_REFERENCE_MAX_COUNT = 16;
export type ReferenceBytes = { bytes: Uint8Array; mimeType: string };
export class ImageReferenceValidationError extends Error {
  readonly code: string;
  readonly referenceIndex: number | null;
  constructor(code: string, referenceIndex: number | null) { super(code); this.code = code; this.referenceIndex = referenceIndex; }
}

/** Check the entire selection before the first moderation or media call. No filtering. */
export function validateImageReferenceStageLimits<T extends ReferenceBytes>(references: readonly T[]): readonly T[] {
  if (references.length > IMAGE_REFERENCE_MAX_COUNT) throw new ImageReferenceValidationError("reference_count_exceeded", null);
  for (const [index, reference] of references.entries()) {
    if (!(reference.bytes instanceof Uint8Array) || !reference.bytes.byteLength) throw new ImageReferenceValidationError("reference_image_empty", index);
    if (!["image/png", "image/jpeg", "image/webp"].includes(reference.mimeType)) throw new ImageReferenceValidationError("reference_image_type_unsupported", index);
    if (reference.bytes.byteLength > IMAGE_REFERENCE_MAX_BYTES) throw new ImageReferenceValidationError("reference_moderation_size_exceeded", index);
  }
  return references;
}

/** Container-header facts only: does not certify decode, content, rights or consent. */
export function inspectReferenceDimensions(bytes: Uint8Array, mimeType: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (at: number, value: string) => at + value.length <= bytes.length && [...value].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  let width = 0, height = 0;
  if (mimeType === "image/png" && bytes.length >= 33 && has(0, "\x89PNG\r\n\x1a\n") && view.getUint32(8) === 13 && has(12, "IHDR")) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mimeType === "image/jpeg" && has(0, "\xff\xd8")) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9 || at + 2 > bytes.length) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker!) && length >= 8) { height = view.getUint16(at + 3); width = view.getUint16(at + 5); break; }
      at += length;
    }
  } else if (mimeType === "image/webp" && bytes.length >= 20 && has(0, "RIFF") && has(8, "WEBP") && view.getUint32(4, true) === bytes.length - 8) {
    const length = view.getUint32(16, true);
    if (20 + length <= bytes.length) {
      if (has(12, "VP8X") && length === 10) {
        width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
        height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
      } else if (has(12, "VP8L") && length >= 5 && bytes[20] === 0x2f) {
        const bits = view.getUint32(21, true); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
      } else if (has(12, "VP8 ") && length >= 10 && has(23, "\x9d\x01\x2a")) {
        width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
      }
    }
  }
  if (!width || !height) throw new ImageReferenceValidationError("reference_dimensions_unverified", null);
  return { width, height, basis: "container-header" as const };
}
export type EvidenceReference = ReferenceBytes & { referenceId: string; semanticRole: string; source: string };
export async function captureImageReferenceEvidence(references: readonly EvidenceReference[]) {
  validateImageReferenceStageLimits(references);
  // Snapshot every input synchronously before the first await; bind all facts to
  // those exact bytes even if the caller later mutates the original arrays.
  const inputs = references.map(reference => ({ ...reference, bytes: new Uint8Array(reference.bytes) }));
  const result = [];
  for (const [order, reference] of inputs.entries()) {
    if (!reference.referenceId.trim() || !reference.semanticRole.trim() || !reference.source.trim()) throw new ImageReferenceValidationError("reference_identity_role_required", order);
    const dimensions = inspectReferenceDimensions(reference.bytes, reference.mimeType);
    const digest = await crypto.subtle.digest("SHA-256", reference.bytes);
    result.push({ version: IMAGE_REFERENCE_CONTRACT_VERSION, referenceId: reference.referenceId,
      order, byteLength: reference.bytes.byteLength, sha256: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join(""),
      mimeType: reference.mimeType, dimensions, semanticRole: reference.semanticRole, source: reference.source });
  }
  return result;
}
// Derivatives are deliberately not generated or admitted by this module. A future
// proposal must bind original+derivative hashes/order/MIME/dimensions, transformation,
// required-content coverage, explicit consent and private retention before dispatch.
