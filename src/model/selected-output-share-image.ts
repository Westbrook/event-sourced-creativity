import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "./output-asset-inspection.ts";

/** Exact-byte format/metadata qualification only; never publishing authority. */
export const SELECTED_OUTPUT_SHARE_IMAGE_POLICY = "selected-output-share-png-v1" as const;
export const SELECTED_OUTPUT_SHARE_IMAGE_LIMITS = Object.freeze({ bytes: MAX_OUTPUT_ASSET_BYTES, chunks: 4096 });
export type SelectedOutputShareImageExpected = Readonly<{ sha256: string; width: number; height: number; byteLength: number }>;
export type SelectedOutputShareImageRefusal = "invalid_input" | "unsupported_png" | "unqualified_metadata" | "invalid_png" | "selection_mismatch";
declare const imageQualification: unique symbol;
export type QualifiedSelectedOutputShareImage = Readonly<{
  [imageQualification]: true;
  status: "qualified";
  policy: typeof SELECTED_OUTPUT_SHARE_IMAGE_POLICY;
  mimeType: "image/png";
  sha256: string;
  width: number;
  height: number;
  byteLength: number;
}>;
export type SelectedOutputShareImageQualification = QualifiedSelectedOutputShareImage
  | Readonly<{ status: "unqualified"; policy: typeof SELECTED_OUTPUT_SHARE_IMAGE_POLICY; reason: SelectedOutputShareImageRefusal }>;

const ownedImages = new WeakMap<QualifiedSelectedOutputShareImage, Uint8Array<ArrayBuffer>>();
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
function publicPngChunks(bytes: Uint8Array): SelectedOutputShareImageRefusal | null {
  if (bytes.length < 57 || !signature.every((value, index) => bytes[index] === value)) return "unsupported_png";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 8, count = 0, color = 0, seenData = false, ended = false;
  const singletons = new Set<string>();
  while (cursor + 12 <= bytes.length) {
    if (++count > SELECTED_OUTPUT_SHARE_IMAGE_LIMITS.chunks) return "invalid_png";
    const length = view.getUint32(cursor), start = cursor + 8, end = start + length;
    if (end + 4 > bytes.length) return "invalid_png";
    const type = String.fromCharCode(bytes[cursor + 4]!, bytes[cursor + 5]!, bytes[cursor + 6]!, bytes[cursor + 7]!);
    if (count === 1 && type !== "IHDR") return "invalid_png";
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
  const refused = (reason: SelectedOutputShareImageRefusal): SelectedOutputShareImageQualification =>
    Object.freeze({ status: "unqualified", policy: SELECTED_OUTPUT_SHARE_IMAGE_POLICY, reason });
  let bytes: Uint8Array<ArrayBuffer> | null = null, retained = false;
  try {
    const facts = expectedFacts(expected);
    if (!facts) return refused("invalid_input");
    bytes = captureBytes(input);
    if (!bytes) return refused("invalid_input");
    if (bytes.length !== facts.byteLength) return refused("selection_mismatch");
    const failure = publicPngChunks(bytes);
    if (failure) return refused(failure);
    const inspection = await inspectOutputAsset(bytes, "image.png", { snapshot: false });
    if (inspection.status !== "inspected" || inspection.kind !== "image" || inspection.mimeType !== "image/png"
      || inspection.extension !== "png") return refused("invalid_png");
    if (inspection.sha256 !== facts.sha256 || inspection.byteLength !== facts.byteLength
      || inspection.facts.width !== facts.width || inspection.facts.height !== facts.height) return refused("selection_mismatch");
    const result = Object.freeze({ status: "qualified", policy: SELECTED_OUTPUT_SHARE_IMAGE_POLICY, mimeType: "image/png", ...facts }) as QualifiedSelectedOutputShareImage;
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
  const bytes = ownedImages.get(qualification as QualifiedSelectedOutputShareImage);
  return bytes ? new Uint8Array(bytes) : null;
}
