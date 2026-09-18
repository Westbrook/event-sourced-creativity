/** Pure checks for a CURRENT original-Video/Notes relationship. These do not
 * issue custody or authority, identify a latest-operation delta, or prove that
 * earlier revisions were Notes-only. The caller owns exact retained sources. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };
export type SelectedOutputShareVideoNotesEditIdentity = Readonly<{
  ownerId: string; documentId: string; projectId: string; artifactId: string;
  contentId: string; revision: number; contentSha256: string;
}>;
const encoder = new TextEncoder();
const contentBytes = 1_000_000, receiptBytes = 1_048_576;
// Match MAX_ARTIFACT_ITEM_BYTES in the actual Document editor writer.
const notesBytes = 80_000;
const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const digest = /^[a-f0-9]{64}$/u;
const object = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const within = (value: unknown, maximum: number): value is string => typeof value === "string"
  && value.length <= maximum && encoder.encode(value).length <= maximum;

function parse(input: unknown, maximum: number): Json {
  if (!within(input, maximum)) throw Error("video_notes_bytes");
  const raw = input;
  // JSON.parse alone loses duplicate keys and rounds numeric tokens. Check
  // lexical JSON first so neither can conceal a non-Notes source difference.
  let offset = 0, nodes = 0;
  const whitespace = () => { while (offset < raw.length && /[\t\n\r ]/u.test(raw[offset]!)) offset++; };
  function string(): string {
    if (raw[offset++] !== '"') throw Error("video_notes_string");
    const start = offset - 1;
    while (offset < raw.length) {
      const char = raw[offset++];
      if (char === "\\") { offset++; continue; }
      if (char === '"') return JSON.parse(raw.slice(start, offset)) as string;
    }
    throw Error("video_notes_string_end");
  }
  function visit(depth: number): void {
    if (++nodes > 100_000 || depth > 64) throw Error("video_notes_bounds");
    whitespace();
    if (raw[offset] === '"') { string(); return; }
    if (raw[offset] === "{") {
      offset++; whitespace(); const names = new Set<string>();
      if (raw[offset] === "}") { offset++; return; }
      while (offset < raw.length) {
        const key = string();
        if (names.has(key)) throw Error("video_notes_duplicate_key");
        names.add(key); whitespace();
        if (raw[offset++] !== ":") throw Error("video_notes_colon");
        visit(depth + 1); whitespace();
        const separator = raw[offset++];
        if (separator === "}") return;
        if (separator !== ",") throw Error("video_notes_object_separator");
        whitespace();
      }
      throw Error("video_notes_object_end");
    }
    if (raw[offset] === "[") {
      offset++; whitespace();
      if (raw[offset] === "]") { offset++; return; }
      while (offset < raw.length) {
        visit(depth + 1); whitespace();
        const separator = raw[offset++];
        if (separator === "]") return;
        if (separator !== ",") throw Error("video_notes_array_separator");
      }
      throw Error("video_notes_array_end");
    }
    for (const literal of ["null", "true", "false"]) if (raw.startsWith(literal, offset)) { offset += literal.length; return; }
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(raw.slice(offset))?.[0];
    if (!token) throw Error("video_notes_json");
    const number = Number(token);
    if (!Number.isFinite(number) || Number.isInteger(number) && !Number.isSafeInteger(number)
      || JSON.stringify(number) !== token) throw Error("video_notes_number");
    offset += token.length;
  }
  visit(0); whitespace();
  if (offset !== raw.length) throw Error("video_notes_json_trailing");
  return JSON.parse(raw) as Json;
}

function same(left: Json, right: Json): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => same(value, right[index]!));
  if (!object(left) || !object(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && same(left[key]!, right[key]!));
}

/** Compare bounded raw JSON, preserving all keys and values except the one
 * item's Notes. Never compare a lossy normalized editor or public projection. */
export function selectedOutputShareVideoNotesContent(originalRaw: unknown, currentRaw: unknown): boolean {
  try {
    const original = parse(originalRaw, contentBytes), current = parse(currentRaw, contentBytes);
    if (!object(original) || !object(current)
      || [original, current].some(body => ["video_revision", "audio_revision", "model3d_revision"].some(key => Object.hasOwn(body, key))
        || !Array.isArray(body.items) || body.items.length !== 1 || !object(body.items[0])
        || !Object.hasOwn(body.items[0], "notes") || !within(body.items[0].notes, notesBytes))) return false;
    // These are owned parsed JSON objects. Alter only the comparison copy; the
    // caller's actual raw source/hash and current selected Notes remain intact.
    const originalItem = (original.items as Json[])[0] as Row;
    const currentItem = (current.items as Json[])[0] as Row;
    currentItem.notes = originalItem.notes!;
    return same(original, current);
  } catch { return false; }
}

function captureIdentity(input: SelectedOutputShareVideoNotesEditIdentity): Record<string, unknown> {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw Error("video_notes_identity");
  const keys = ["ownerId", "documentId", "projectId", "artifactId", "contentId", "revision", "contentSha256"];
  const names = Reflect.ownKeys(input), captured: Record<string, unknown> = Object.create(null);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) throw Error("video_notes_identity_keys");
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) throw Error("video_notes_identity_accessor");
    captured[key] = field.value;
  }
  if (!within(captured.ownerId, 240) || !captured.ownerId || /[\0-\u0020\u007f]/u.test(captured.ownerId)
    || ["documentId", "projectId", "artifactId", "contentId"].some(key => typeof captured[key] !== "string" || !opaque.test(captured[key]))
    || !Number.isSafeInteger(captured.revision) || Number(captured.revision) <= 0
    || typeof captured.contentSha256 !== "string" || !digest.test(captured.contentSha256)) throw Error("video_notes_identity_values");
  return captured;
}

/** Match the exact private direct-editor producer body. The caller separately
 * pins the actual public event/actor/client and private row scope/retirement. */
export function selectedOutputShareVideoNotesEdit(privateRaw: unknown, expected: SelectedOutputShareVideoNotesEditIdentity): boolean {
  try {
    const identity = captureIdentity(expected), body = parse(privateRaw, receiptBytes);
    const keys = ["artifact_id", "artifact_kind", "document_id", "project_id", "content_ref", "revision",
      "changed_fields", "content_sha256", "edited_by_user_id", "source_surface"];
    if (!object(body) || Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) return false;
    return body.artifact_id === identity.artifactId && body.artifact_kind === "video"
      && body.document_id === identity.documentId && body.project_id === identity.projectId
      && body.content_ref === identity.contentId && body.revision === identity.revision
      && body.content_sha256 === identity.contentSha256 && body.edited_by_user_id === identity.ownerId
      && body.source_surface === "document-artifact-editor" && Array.isArray(body.changed_fields)
      && body.changed_fields.length === 2 && body.changed_fields[0] === "content_markdown" && body.changed_fields[1] === "items";
  } catch { return false; }
}
