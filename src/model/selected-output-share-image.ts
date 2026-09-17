import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "./output-asset-inspection.ts";

/** Exact-byte format/metadata qualification only; never publishing authority. */
export const SELECTED_OUTPUT_SHARE_IMAGE_POLICY = "selected-output-share-png-v1" as const;
export const SELECTED_OUTPUT_SHARE_IMAGE_RESOLUTION_POLICY = "selected-output-share-png-resolution-v1" as const;
export type SelectedOutputShareImagePolicy = typeof SELECTED_OUTPUT_SHARE_IMAGE_POLICY | typeof SELECTED_OUTPUT_SHARE_IMAGE_RESOLUTION_POLICY;
export const SELECTED_OUTPUT_SHARE_IMAGE_LIMITS = Object.freeze({ bytes: MAX_OUTPUT_ASSET_BYTES, chunks: 4096 });
export type SelectedOutputShareImageExpected = Readonly<{ sha256: string; width: number; height: number; byteLength: number }>;
export type SelectedOutputShareImageRefusal = "invalid_input" | "unsupported_png" | "unqualified_metadata" | "invalid_png" | "selection_mismatch";
declare const imageQualification: unique symbol;
export type QualifiedSelectedOutputShareImage<Policy extends SelectedOutputShareImagePolicy = typeof SELECTED_OUTPUT_SHARE_IMAGE_POLICY> = Readonly<{
  [imageQualification]: true;
  status: "qualified";
  policy: Policy;
  mimeType: "image/png";
  sha256: string;
  width: number;
  height: number;
  byteLength: number;
}>;
export type SelectedOutputShareImageQualification<Policy extends SelectedOutputShareImagePolicy = typeof SELECTED_OUTPUT_SHARE_IMAGE_POLICY> = QualifiedSelectedOutputShareImage<Policy>
  | Readonly<{ status: "unqualified"; policy: Policy; reason: SelectedOutputShareImageRefusal }>;

const ownedImages = new WeakMap<QualifiedSelectedOutputShareImage<SelectedOutputShareImagePolicy>, Uint8Array<ArrayBuffer>>();
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const chromaticities = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000];
const expectedKeys = ["sha256", "width", "height", "byteLength"] as const;

function expectedFacts(value: unknown): SelectedOutputShareImageExpected | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== "string" || !expectedKeys.includes(key as typeof expectedKeys[number]))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, "value") || !field.enumerable) return null;
    result[key] = field.value;
  }
  if (typeof result.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(result.sha256)
    || ![result.width, result.height].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= 16_384)
    || typeof result.byteLength !== "number" || !Number.isSafeInteger(result.byteLength)
    || result.byteLength < 1 || result.byteLength > SELECTED_OUTPUT_SHARE_IMAGE_LIMITS.bytes) return null;
  return Object.freeze({ sha256: result.sha256, width: result.width as number, height: result.height as number, byteLength: result.byteLength });
}

/** Copy native, nonshared bytes before any await. Supplied iterators/getters are
 * never used; a subarray copies only its selected region. */
function captureBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
  const length = typedLength.call(value) as number;
  // The intrinsic ArrayBuffer getter rejects shared memory and proxy impostors.
  bufferLength.call(typedBuffer.call(value));
  if (!length || length > SELECTED_OUTPUT_SHARE_IMAGE_LIMITS.bytes) return null;
  const copy = new Uint8Array(length);
  setBytes.call(copy, value as Uint8Array);
  return copy;
}

/** Deliberately narrower than native private PNG support. No opaque payload
 * chunks, profiles, suggested palettes or ancillary strings are public-safe by
 * default. Native inspection below supplies CRC, inflate and scanline checks. */
function publicPngChunks(bytes: Uint8Array, resolutionProfile: boolean): SelectedOutputShareImageRefusal | null {
  if (bytes.length < 57 || !signature.every((value, index) => bytes[index] === value)) return "unsupported_png";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 8, count = 0, color = 0, seenData = false, ended = false, resolutionStage = 0;
  const singletons = new Set<string>();
  while (cursor + 12 <= bytes.length) {
    if (++count > SELECTED_OUTPUT_SHARE_IMAGE_LIMITS.chunks) return "invalid_png";
    const length = view.getUint32(cursor), start = cursor + 8, end = start + length;
    if (end + 4 > bytes.length) return "invalid_png";
    const type = String.fromCharCode(bytes[cursor + 4]!, bytes[cursor + 5]!, bytes[cursor + 6]!, bytes[cursor + 7]!);
    if (count === 1 && type !== "IHDR") return "invalid_png";
    // The optional resolution profile is a complete, contiguous, ordered trio.
    if (resolutionStage === 1 && type !== "oFFs" || resolutionStage === 2 && type !== "pHYs") return "invalid_png";
    if (type !== "IDAT") {
      if (singletons.has(type)) return "invalid_png";
      singletons.add(type);
    }
    if (type === "IHDR") {
      if (count !== 1 || length !== 13) return "invalid_png";
      color = bytes[start + 9]!;
      if (bytes[start + 8] !== 8 || color !== 2 && color !== 6 || bytes[start + 12] !== 0) return "unsupported_png";
    } else if (type === "IDAT") {
      seenData = true;
    } else if (type === "IEND") {
      if (!seenData || length !== 0 || end + 4 !== bytes.length) return "invalid_png";
      ended = true; break;
    } else if (type === "sRGB") {
      if (seenData || length !== 1 || bytes[start]! > 3) return "invalid_png";
    } else if (type === "gAMA") {
      if (seenData || length !== 4) return "invalid_png";
      if (view.getUint32(start) !== 45455) return "unqualified_metadata";
    } else if (type === "cHRM") {
      if (seenData || length !== 32) return "invalid_png";
      if (!chromaticities.every((value, index) => view.getUint32(start + index * 4) === value)) return "unqualified_metadata";
    } else if (type === "tRNS") {
      if (seenData || color !== 2 || length !== 6) return "invalid_png";
      if ([0, 2, 4].some(offset => view.getUint16(start + offset) > 255)) return "invalid_png";
    } else if (resolutionProfile && type === "eXIf") {
      if (seenData || resolutionStage !== 0 || length !== 54) return "invalid_png";
      // Complete big-endian TIFF: header; two 72/1 rationals at 8 and 16;
      // IFD at 24 with exactly X/YResolution RATIONAL tags; next IFD is zero.
      // Every byte is checked. No EXIF prefix, padding, private tags or pointers.
      if (view.getUint16(start) !== 0x4d4d || view.getUint16(start + 2) !== 42 || view.getUint32(start + 4) !== 24
        || view.getUint32(start + 8) !== 72 || view.getUint32(start + 12) !== 1
        || view.getUint32(start + 16) !== 72 || view.getUint32(start + 20) !== 1 || view.getUint16(start + 24) !== 2
        || view.getUint16(start + 26) !== 0x011a || view.getUint16(start + 28) !== 5 || view.getUint32(start + 30) !== 1
        || view.getUint32(start + 34) !== 8 || view.getUint16(start + 38) !== 0x011b || view.getUint16(start + 40) !== 5
        || view.getUint32(start + 42) !== 1 || view.getUint32(start + 46) !== 16 || view.getUint32(start + 50) !== 0) return "unqualified_metadata";
      resolutionStage = 1;
    } else if (resolutionProfile && type === "oFFs") {
      if (seenData || resolutionStage !== 1 || length !== 9) return "invalid_png";
      if (view.getInt32(start) !== 0 || view.getInt32(start + 4) !== 0 || bytes[start + 8] !== 0) return "unqualified_metadata";
      resolutionStage = 2;
    } else if (resolutionProfile && type === "pHYs") {
      if (seenData || resolutionStage !== 2 || length !== 9) return "invalid_png";
      if (view.getUint32(start) !== 2834 || view.getUint32(start + 4) !== 2834 || bytes[start + 8] !== 1) return "unqualified_metadata";
      resolutionStage = 3;
    } else return "unqualified_metadata";
    cursor = end + 4;
  }
  return ended ? null : "invalid_png";
}

/** Capture and qualify the exact selected PNG against trusted expected facts.
 * A result says nothing about ownership, current revision, title, consent,
 * visible content, rights, embedded pixel steganography, or public read access.
 * It never strips metadata, changes pixels, creates a share, or calls a provider.
 */
export async function qualifySelectedOutputShareImage(input: unknown, expected: unknown): Promise<SelectedOutputShareImageQualification> {
  return qualifyImage(input, expected, SELECTED_OUTPUT_SHARE_IMAGE_POLICY);
}

/** Explicit resolution-only profile; the default v1 gate remains unchanged.
 * Supports v1 PNGs plus the closed eXIf/oFFs/pHYs trio, never arbitrary EXIF.
 * This is format qualification only, with the same publishing-authority limits.
 */
export async function qualifyResolutionSelectedOutputShareImage(input: unknown, expected: unknown): Promise<SelectedOutputShareImageQualification<typeof SELECTED_OUTPUT_SHARE_IMAGE_RESOLUTION_POLICY>> {
  return qualifyImage(input, expected, SELECTED_OUTPUT_SHARE_IMAGE_RESOLUTION_POLICY);
}

async function qualifyImage<Policy extends SelectedOutputShareImagePolicy>(input: unknown, expected: unknown, policy: Policy): Promise<SelectedOutputShareImageQualification<Policy>> {
  const refused = (reason: SelectedOutputShareImageRefusal): SelectedOutputShareImageQualification<Policy> =>
    Object.freeze({ status: "unqualified", policy, reason });
  let bytes: Uint8Array<ArrayBuffer> | null = null, retained = false;
  try {
    const facts = expectedFacts(expected);
    if (!facts) return refused("invalid_input");
    bytes = captureBytes(input);
    if (!bytes) return refused("invalid_input");
    if (bytes.length !== facts.byteLength) return refused("selection_mismatch");
    const failure = publicPngChunks(bytes, policy === SELECTED_OUTPUT_SHARE_IMAGE_RESOLUTION_POLICY);
    if (failure) return refused(failure);
    const inspection = await inspectOutputAsset(bytes, "image.png", { snapshot: false });
    if (inspection.status !== "inspected" || inspection.kind !== "image" || inspection.mimeType !== "image/png"
      || inspection.extension !== "png") return refused("invalid_png");
    if (inspection.sha256 !== facts.sha256 || inspection.byteLength !== facts.byteLength
      || inspection.facts.width !== facts.width || inspection.facts.height !== facts.height) return refused("selection_mismatch");
    const result = Object.freeze({ status: "qualified", policy, mimeType: "image/png", ...facts }) as QualifiedSelectedOutputShareImage<Policy>;
    ownedImages.set(result, bytes); retained = true;
    return result;
  } catch { return refused("invalid_input"); }
  finally { if (!retained) bytes?.fill(0); }
}

/** Return a fresh copy of exactly the locally qualified bytes. Serialized or
 * forged facts cannot retrieve bytes; modifying this copy cannot alter future
 * reads. The caller still must check current publishing authority separately. */
export function copySelectedOutputShareImageBytes(qualification: unknown): Uint8Array<ArrayBuffer> | null {
  if (qualification === null || typeof qualification !== "object") return null;
  const bytes = ownedImages.get(qualification as QualifiedSelectedOutputShareImage<SelectedOutputShareImagePolicy>);
  return bytes ? new Uint8Array(bytes) : null;
}
