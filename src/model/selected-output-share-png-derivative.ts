import { MAX_OUTPUT_ASSET_BYTES } from "./output-asset-inspection.ts";
import { qualifySelectedOutputShareImage, copySelectedOutputShareImageBytes, SELECTED_OUTPUT_SHARE_IMAGE_POLICY,
  type QualifiedSelectedOutputShareImage } from "./selected-output-share-image.ts";
import { inspectSelectedOutputSharePngProvenance, PNG_PROVENANCE_REVIEW_PROFILE, PNG_PROVENANCE_REVIEW_PARSER } from "./selected-output-share-png-provenance-review.ts";

export const SELECTED_OUTPUT_SHARE_PNG_DERIVATIVE_VERSION = "selected-output-share-png-cabx-removal-v1" as const;
declare const derivativePreparation: unique symbol;
export type PreparedPngDerivativeV1 = Readonly<{
  [derivativePreparation]: true;
  status: "prepared_derivative";
  activation: "disabled";
  version: typeof SELECTED_OUTPUT_SHARE_PNG_DERIVATIVE_VERSION;
  source: Readonly<{ sha256: string; byteLength: number; width: number; height: number; selectionWitnessDigest: string;
    inspectorProfile: typeof PNG_PROVENANCE_REVIEW_PROFILE; inspectorParser: typeof PNG_PROVENANCE_REVIEW_PARSER; inspectorProfileDigest: string }>;
  public: Readonly<{ sha256: string; byteLength: number; width: number; height: number; mimeType: "image/png"; policy: typeof SELECTED_OUTPUT_SHARE_IMAGE_POLICY }>;
  transform: Readonly<{
    removedChunk: Readonly<{ type: "caBX"; offset: 33; dataByteLength: 13012; byteLength: 13024; sha256: string }>;
    retainedRanges: readonly [Readonly<{ sourceOffset: 0; byteLength: 33 }>, Readonly<{ sourceOffset: 13057; byteLength: number }>];
    publishingScopeDigest: string;
    pixelPreservation: "unchanged-image-bytes";
    provenance: "embedded-C2PA-manifest-removed";
  }>;
}>;
export type PngDerivativeRefusal = Readonly<{ status: "refused"; activation: "disabled"; reason: "invalid_input" | "source_refused" | "unsupported_profile" | "invalid_derivative" }>;
export type PngDerivativePreparation = PreparedPngDerivativeV1 | PngDerivativeRefusal;

const preparedBytes = new WeakMap<PreparedPngDerivativeV1, QualifiedSelectedOutputShareImage>();
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
function capture(input: unknown): Uint8Array<ArrayBuffer> | null {
  if (input === null || typeof input !== "object" || Object.getPrototypeOf(input) !== Uint8Array.prototype) return null;
  const length = typedLength.call(input) as number; bufferLength.call(typedBuffer.call(input));
  if (length <= 0 || length > MAX_OUTPUT_ASSET_BYTES) return null;
  const owned = new Uint8Array(length); setBytes.call(owned, input as Uint8Array); return owned;
}
function freeze<T>(value: T): Readonly<T> { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join(""); }

/** Prepare one exact public-copy transformation from an owned source snapshot.
 * The source inspection is structural evidence, never publishing authority.
 * No source mutation, arbitrary stripping, transcode, provider or network call.
 * Receipt is private: do not spread source identity into recipient DTOs.
 */
export async function prepareSelectedOutputSharePngDerivativeV1(input: unknown, sourceExpectedFacts: unknown, bindings: unknown): Promise<PngDerivativePreparation> {
  const refuse = (reason: PngDerivativeRefusal["reason"]): PngDerivativeRefusal => Object.freeze({ status: "refused", activation: "disabled", reason });
  let source: Uint8Array<ArrayBuffer> | null = null, publicBytes: Uint8Array<ArrayBuffer> | null = null;
  try {
    source = capture(input); if (!source) return refuse("invalid_input");
    // This invocation captures its closed facts/bindings before returning a
    // promise. All later values below come from that immutable inspected result.
    const inspection = await inspectSelectedOutputSharePngProvenance(source, sourceExpectedFacts, bindings);
    if (inspection.status !== "review_candidate") return refuse("source_refused");
    const inspected = inspection.source, removed = inspected.caBX;
    if (inspection.activation !== "disabled" || inspection.profile !== PNG_PROVENANCE_REVIEW_PROFILE || inspection.inspection.parserVersion !== PNG_PROVENANCE_REVIEW_PARSER
      || inspected.byteLength !== source.length || removed.offset !== 33 || removed.dataByteLength !== 13012 || removed.chunkByteLength !== 13024) return refuse("unsupported_profile");
    publicBytes = new Uint8Array(source.length - removed.chunkByteLength);
    setBytes.call(publicBytes, source.subarray(0, 33)); setBytes.call(publicBytes, source.subarray(13057), 33);
    if (publicBytes.length + 13024 !== source.length) return refuse("invalid_derivative");
    for (let at = 0; at < publicBytes.length; at++) if (publicBytes[at] !== source[at < 33 ? at : at + 13024]) return refuse("invalid_derivative");
    const expected = { sha256: await sha256(publicBytes), byteLength: publicBytes.length, width: inspected.width, height: inspected.height };
    const qualified = await qualifySelectedOutputShareImage(publicBytes, expected);
    if (qualified.status !== "qualified" || qualified.policy !== SELECTED_OUTPUT_SHARE_IMAGE_POLICY || qualified.sha256 !== expected.sha256
      || qualified.byteLength !== expected.byteLength || qualified.width !== expected.width || qualified.height !== expected.height) return refuse("invalid_derivative");
    const receipt: Omit<PreparedPngDerivativeV1, typeof derivativePreparation> = { status: "prepared_derivative", activation: "disabled", version: SELECTED_OUTPUT_SHARE_PNG_DERIVATIVE_VERSION,
      source: { sha256: inspected.pngSha256, byteLength: inspected.byteLength, width: inspected.width, height: inspected.height, selectionWitnessDigest: inspected.selectionWitnessDigest,
        inspectorProfile: inspection.profile, inspectorParser: inspection.inspection.parserVersion, inspectorProfileDigest: inspection.inspection.profileDigest },
      public: { ...expected, mimeType: "image/png", policy: qualified.policy },
      transform: { removedChunk: { type: "caBX", offset: 33, dataByteLength: 13012, byteLength: 13024, sha256: removed.chunkSha256 },
        retainedRanges: [{ sourceOffset: 0, byteLength: 33 }, { sourceOffset: 13057, byteLength: source.length - 13057 }],
        publishingScopeDigest: inspection.publishingScopeDigest, pixelPreservation: "unchanged-image-bytes", provenance: "embedded-C2PA-manifest-removed" },
    };
    const prepared = freeze(receipt) as PreparedPngDerivativeV1;
    preparedBytes.set(prepared, qualified); return prepared;
  } catch { return refuse("invalid_input"); }
  finally { source?.fill(0); publicBytes?.fill(0); }
}

/** Return fresh derivative bytes only for this process's actual preparation.
 * No native custody, sharing authority or source bytes are returned. */
export function copyPreparedSelectedOutputSharePngBytes(prepared: unknown): Uint8Array<ArrayBuffer> | null {
  if (prepared === null || typeof prepared !== "object") return null;
  const qualified = preparedBytes.get(prepared as PreparedPngDerivativeV1);
  return qualified ? copySelectedOutputShareImageBytes(qualified) : null;
}
