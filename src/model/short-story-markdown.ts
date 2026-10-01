/**
 * Exact Short story Markdown bytes, without native admission or lineage proof.
 *
 * Callers must independently establish the retained artifact, target, owner,
 * current revision and source relationship. Supplied artifact JSON bytes are
 * only measured and hashed: this module neither parses them nor establishes
 * that they are retained JSON or correspond to the supplied narrative.
 */
import { MAX_OUTPUT_ASSET_NAME_BYTES, outputAssetSha256, validOutputAssetName, type OutputShortStoryMarkdownInspection } from "./output-asset-inspection.ts";

export const SHORT_STORY_MARKDOWN_PROFILE = "forma.short-story.markdown@1";
export const SHORT_STORY_MARKDOWN_MIME = "text/markdown; charset=utf-8";
export const MAX_SHORT_STORY_MARKDOWN_BYTES = 512_000;
export const MAX_SHORT_STORY_ARTIFACT_JSON_BYTES = 1_000_000;

export type ShortStoryMarkdownDocument = {
  readonly name: string;
  readonly contentMarkdown: string;
  /** Caller-owned bytes. Mutation invalidates the accompanying inspection. */
  readonly bytes: Uint8Array;
  readonly inspection: OutputShortStoryMarkdownInspection;
  readonly artifactJsonByteLength: number;
  readonly artifactJsonSha256: string;
};

const encoder = new TextEncoder();
// ignoreBOM disables BOM removal: an authored leading U+FEFF is content.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
const checks = Object.freeze(["utf8_well_formed", "utf8_exact_roundtrip", "narrative_nonblank", "narrative_byte_limit", "artifact_json_byte_limit"]);
const limitations = Object.freeze([
  "Encoding and byte fidelity only",
  "Artifact JSON correspondence unverified",
  "Native identity, lineage and custody unverified",
  "Narrative quality, quantity, rights and acceptance unverified",
]);
const noErrors: readonly [] = Object.freeze([] as const);

function fail(code: string): never { throw new Error(code); }

function wellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function filename(artifactId: string): string {
  // A valid UTF-8 component cannot use fewer bytes than UTF-16 code units.
  // Bound work before scanning, normalizing or encoding a supplied identity.
  if (typeof artifactId !== "string" || artifactId.length > MAX_OUTPUT_ASSET_NAME_BYTES || !wellFormedUtf16(artifactId) || !validOutputAssetName(artifactId)) fail("short_story_markdown_invalid_artifact_id");
  const name = `short-story-${artifactId}.md`;
  if (!validOutputAssetName(name)) fail("short_story_markdown_invalid_artifact_id");
  return name;
}

/** Copy the exact view, without consulting caller-defined accessors or iterators. */
function snapshotBytes(value: Uint8Array, maximum: number, invalidCode: string, tooLargeCode: string): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(invalidCode);
  let length: number;
  try { length = typedArrayByteLength.call(value) as number; } catch { return fail(invalidCode); }
  if (length > maximum) fail(tooLargeCode);
  try {
    const snapshot = new Uint8Array(length);
    Uint8Array.prototype.set.call(snapshot, value);
    return snapshot;
  } catch { return fail(invalidCode); }
}

function artifactJsonSnapshot(bytes: Uint8Array): Uint8Array {
  return snapshotBytes(bytes, MAX_SHORT_STORY_ARTIFACT_JSON_BYTES, "short_story_artifact_json_invalid_bytes", "short_story_artifact_json_too_large");
}

function narrativeBytes(content: string): Uint8Array {
  if (typeof content !== "string") fail("short_story_markdown_invalid_text");
  // Well-formed UTF-8 requires at least one byte per UTF-16 code unit.
  if (content.length > MAX_SHORT_STORY_MARKDOWN_BYTES) fail("short_story_markdown_too_large");
  if (!wellFormedUtf16(content)) fail("short_story_markdown_ill_formed_utf16");
  if (content.trim().length === 0) fail("short_story_markdown_blank");
  const bytes = encoder.encode(content);
  if (bytes.byteLength > MAX_SHORT_STORY_MARKDOWN_BYTES) fail("short_story_markdown_too_large");
  return bytes;
}

function decodedNarrative(bytes: Uint8Array): string {
  try { return decoder.decode(bytes); } catch { return fail("short_story_markdown_invalid_utf8"); }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function expectedHash(value: string, errorCode: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) fail(errorCode);
  return value;
}

function documentResult(name: string, contentMarkdown: string, bytes: Uint8Array, sha256: string, artifactJsonByteLength: number, artifactJsonSha256: string): ShortStoryMarkdownDocument {
  const inspection: OutputShortStoryMarkdownInspection = Object.freeze({
    status: "inspected",
    profile: SHORT_STORY_MARKDOWN_PROFILE,
    kind: "document",
    mimeType: SHORT_STORY_MARKDOWN_MIME,
    extension: "md",
    byteLength: bytes.byteLength,
    sha256,
    facts: Object.freeze({ encoding: "utf-8" }),
    checks,
    limitations,
    errors: noErrors,
  });
  // Metadata is immutable. The returned byte array is privately copied from
  // input, but remains caller-owned and must be revalidated after mutation.
  return Object.freeze({ name, contentMarkdown, bytes, inspection, artifactJsonByteLength, artifactJsonSha256 });
}

/**
 * Encode the whole supplied narrative, without trimming or reconstructing it.
 * JSON size/hash are separate facts, not source identity or correspondence.
 */
export async function encodeShortStoryMarkdown(artifactId: string, contentMarkdown: string, artifactJsonBytes: Uint8Array): Promise<ShortStoryMarkdownDocument> {
  const name = filename(artifactId);
  const bytes = narrativeBytes(contentMarkdown);
  const jsonBytes = artifactJsonSnapshot(artifactJsonBytes);
  if (decodedNarrative(bytes) !== contentMarkdown) fail("short_story_markdown_roundtrip_mismatch");
  // All bytes are privately owned before the first asynchronous hash.
  const [sha256, artifactJsonSha256] = await Promise.all([outputAssetSha256(bytes), outputAssetSha256(jsonBytes)]);
  return documentResult(name, contentMarkdown, bytes, sha256, jsonBytes.byteLength, artifactJsonSha256);
}

/**
 * Re-read stored bytes against separately supplied expected lengths/digests.
 * Matching caller-supplied expectations is structural consistency, not proof
 * of their origin, retained custody, native authority or current permission.
 */
export async function readShortStoryMarkdown(
  artifactId: string,
  markdownBytes: Uint8Array,
  expectedByteLength: number,
  expectedSha256: string,
  artifactJsonBytes: Uint8Array,
  expectedArtifactJsonSha256: string,
): Promise<ShortStoryMarkdownDocument> {
  const name = filename(artifactId);
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 1 || expectedByteLength > MAX_SHORT_STORY_MARKDOWN_BYTES) fail("short_story_markdown_invalid_expected_length");
  const fileHash = expectedHash(expectedSha256, "short_story_markdown_invalid_expected_hash");
  const jsonHash = expectedHash(expectedArtifactJsonSha256, "short_story_artifact_json_invalid_expected_hash");
  const bytes = snapshotBytes(markdownBytes, MAX_SHORT_STORY_MARKDOWN_BYTES, "short_story_markdown_invalid_bytes", "short_story_markdown_too_large");
  const jsonBytes = artifactJsonSnapshot(artifactJsonBytes);
  if (bytes.byteLength !== expectedByteLength) fail("short_story_markdown_length_mismatch");
  const contentMarkdown = decodedNarrative(bytes);
  const reencoded = narrativeBytes(contentMarkdown);
  if (!equalBytes(bytes, reencoded)) fail("short_story_markdown_roundtrip_mismatch");
  const [sha256, artifactJsonSha256] = await Promise.all([outputAssetSha256(bytes), outputAssetSha256(jsonBytes)]);
  if (sha256 !== fileHash) fail("short_story_markdown_hash_mismatch");
  if (artifactJsonSha256 !== jsonHash) fail("short_story_artifact_json_hash_mismatch");
  return documentResult(name, contentMarkdown, bytes, sha256, jsonBytes.byteLength, artifactJsonSha256);
}
