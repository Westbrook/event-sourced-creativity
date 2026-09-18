import { createCreativeEventFold, type CreativeEvent, type CreativeProjection } from "../src/model/events.ts";
import { measureRetainedState } from "../src/model/retained-state.ts";
import { inspectCurrentGuestImageResultEdit, inspectCurrentGuestImageResultMetadata,
  type GuestImageResultEditRead, type GuestImageResultMetadataRead, type GuestImageResultMetadataFacts, type GuestImageResultMetadataSnapshot } from "../src/model/generated-image-edit-current.ts";
import { parseGuestImageResultCompletedCustodyReview, type GuestImageResultCompletedCustodyReview } from "../src/model/generated-image-edit.ts";
import { guestImageResultEditOperationSha256, parseGuestImageResultEditRequest, parseGuestImageResultRevision,
  type GuestImageResultEditRequest, type GuestImageResultEditSnapshot, type GuestImageResultRevision } from "../src/model/generated-image-revision.ts";
import { parseGuestImageResultClaimEvent, type GuestImageResultClaimPresentation } from "../src/model/guest-image-result-presentation.ts";
import { outputAssetSha256 } from "../src/model/output-asset-inspection.ts";

/** Inert evidence only. The private completed owner in custody.ts owns native
 * reads, admission, exact schema/graph proofs, deadlines and role retention.
 * Calling this qualifier cannot create custody or disclose any stored bytes. */
type Row = Readonly<Record<string, unknown>>;
export type ClaimedImageCurrentEvidence = Readonly<{
  read: GuestImageResultEditRead;
  eventRows: readonly Row[];
  revisionRows: readonly Row[];
  monotonicDeadline: number;
  wallDeadline: number;
  /** Measured canonical/proof owner data outside these three evidence roots.
   * This adds to the fixed accounting ceiling; it cannot raise that ceiling. */
  outsideRetainedBytes: number;
}>;
/** Association-only evidence for the fixed local adoption consumer. It does
 * not contain planner bytes and cannot be used by the strict edit inspector. */
export type ClaimedImageLocalAdoptionEvidence = Readonly<{
  read: GuestImageResultMetadataRead;
  eventRows: readonly Row[];
  revisionRows: readonly Row[];
  monotonicDeadline: number;
  wallDeadline: number;
  outsideRetainedBytes: number;
}>;
type ClaimedImageProofEvidence = ClaimedImageCurrentEvidence | ClaimedImageLocalAdoptionEvidence;
type ClaimedImageMetadataSnapshot = GuestImageResultMetadataSnapshot;
export type ClaimedImageOrigin = Readonly<{
  outputId: string; documentId: string; generationId: string; sourceEventId: string;
  contentRef: string; contentSha256: string; claim: GuestImageResultCompletedCustodyReview;
}>;
export type ClaimedImageMedia = Readonly<{
  url: string; mediaType: "image/png"; sha256: string; byteLength: number; width: number; height: number;
}>;
export type ClaimedImageEnvelope = Readonly<{
  kind: "generated-image"; schemaVersion: 2; origin: ClaimedImageOrigin; initialMedia: ClaimedImageMedia;
  request: GuestImageResultEditRequest | null; imageRevision: GuestImageResultRevision | null;
}>;
export type ClaimedImageRetainedRevision = Readonly<{
  row: Row; envelope: ClaimedImageEnvelope; event: CreativeEvent | null;
}>;
export type ClaimedImageCurrentFacts = Readonly<{
  snapshot: Readonly<GuestImageResultEditSnapshot>;
  canonical: GuestImageResultClaimPresentation;
  origin: ClaimedImageOrigin;
  initialMedia: ClaimedImageMedia;
  retained: readonly ClaimedImageRetainedRevision[];
  retainedExpiresAt: string;
  artifactKey: string;
  derivativeMetadata: ClaimedImageRevisionMetadata | null;
  localContext: Readonly<{ eventIds: readonly string[]; resourceIds: readonly string[] }>;
}>;
type ClaimedImageMetadataOrigin = Readonly<Omit<ClaimedImageOrigin, "contentSha256"> & { contentSha256: string | null }>;
type ClaimedImageQualifiedFacts<S extends Readonly<ClaimedImageMetadataSnapshot>> = Readonly<
  Omit<ClaimedImageCurrentFacts, "snapshot" | "origin"> & { snapshot: S;
    origin: Readonly<Omit<ClaimedImageOrigin, "contentSha256"> & { contentSha256: S["contentSha256"] }> }>;
export type ClaimedImageLocalAdoptionFacts = Readonly<ClaimedImageQualifiedFacts<ClaimedImageMetadataSnapshot> & {
  title: string;
  plannerExpiresAt: string;
  contentExpiresAt: string;
  localPair: GuestImageResultMetadataFacts["localPair"];
}>;
const fail = (): never => { throw new Error("claimed_image_current_unavailable"); };
const encoder = new TextEncoder();
const row = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value: Row, expected: readonly string[]) => {
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  return names.length === expected.length && expected.every(key => Object.hasOwn(descriptors, key))
    && names.every(key => typeof key === "string" && descriptors[key]!.enumerable && Object.hasOwn(descriptors[key]!, "value"));
};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const originKeys = ["outputId", "documentId", "generationId", "sourceEventId", "contentRef", "contentSha256", "claim"] as const;
const mediaKeys = ["url", "mediaType", "sha256", "byteLength", "width", "height"] as const;
const revisionRowKeys = ["revision_id", "owner_id", "organization_id", "project_access_id", "project_id", "document_id", "artifact_id", "revision",
  "content_json", "content_sha256", "created_by_user_id", "created_at", "expires_at", "redacted_at"] as const;
const equalReview = (left: unknown, right: GuestImageResultCompletedCustodyReview): boolean => {
  const parsed = parseGuestImageResultCompletedCustodyReview(left);
  return parsed !== null && parsed.version === right.version && parsed.kind === right.kind && parsed.custodyId === right.custodyId
    && parsed.claimEventId === right.claimEventId && parsed.lineageDigest === right.lineageDigest;
};
function sameOrigin(value: unknown, origin: ClaimedImageMetadataOrigin): boolean {
  return row(value) && keys(value, originKeys) && originKeys.every(key => key === "claim"
    ? equalReview(value.claim, origin.claim) : value[key] === origin[key]);
}
function rawPlannerOrigin(value: ClaimedImageMetadataOrigin): value is ClaimedImageOrigin {
  return digest(value.contentSha256);
}
function sameMedia(value: unknown, media: ClaimedImageMedia): boolean {
  return row(value) && keys(value, mediaKeys) && mediaKeys.every(key => value[key] === media[key]);
}
function privateEvent(rows: readonly Row[], event: CreativeEvent, scope: { ownerId: string; projectId: string; documentId: string },
  budget: { evidence: ClaimedImageProofEvidence; roots: unknown; current: () => number }): Row {
  let value: Row | undefined;
  for (const candidate of rows) {
    budget.current();
    if (candidate.event_id === event.eventId) { if (value) return fail(); value = candidate; }
  }
  if (!value) return fail();
  if (value.private_owner !== scope.ownerId || value.private_project !== scope.projectId || value.private_document !== scope.documentId
    || value.private_redacted !== null || typeof value.private_json !== "string" || value.private_json.length === 0
    || value.event_id !== event.eventId || value.stream_id !== event.streamId || value.sequence !== event.sequence
    || value.type !== event.type || value.occurred_at !== event.occurredAt || value.recorded_at !== event.recordedAt
    || value.actor !== event.actor || value.client_id !== event.clientId || value.correlation_id !== event.correlationId
    || value.causation_id !== event.causationId || value.compensates_event_id !== event.compensatesEventId
    || value.schema_version !== event.schemaVersion) return fail();
  // serializeEvent consumed this same private JSON in the owning reader. This
  // independent join refuses a row associated with another decoded payload.
  let payload: unknown;
  currentAdmit(budget.evidence, budget.roots, jsonParseWork(value.private_json));
  try { payload = JSON.parse(value.private_json); } catch { return fail(); }
  budget.current();
  const leftSize = jsonValueSize(payload), rightSize = jsonValueSize(event.payload);
  currentAdmit(budget.evidence, [budget.roots, payload], logicalString(leftSize.n) + logicalString(rightSize.n));
  if (JSON.stringify(payload) !== JSON.stringify(event.payload)) return fail();
  budget.current(); currentAdmit(budget.evidence, [budget.roots, payload]);
  return value;
}
function artifactKey(outputId: string): string {
  return "generated-image/" + Array.from(encoder.encode(outputId), byte => byte.toString(16).padStart(2, "0")).join("");
}

const CLAIMED_CURRENT_AGGREGATE = 155_108_864;
const logicalArray = (n: number) => 64 + 16 * n;
const logicalSet = (n: number) => 64 + 32 * n;
const logicalMap = (n: number) => 64 + 48 * n;
const logicalString = (n: number) => 24 + 2 * n;
const logicalRecord = (names: readonly string[]) => 64 + names.reduce((sum, key) => sum + 16 + 2 * key.length, 0);
// outputAssetSha256: the 32-byte digest, its Array.from roster, thirty-two
// two-character hexadecimal strings and joined sixty-four-character string.
const hashDigestWork = 32 + logicalArray(32) + 32 * logicalString(2) + logicalString(64);
const currentMeasureLimits = Object.freeze({ bytes: CLAIMED_CURRENT_AGGREGATE,
  // Every traversal edge costs at least 16 bytes; 8 also allows null roots.
  nodes: Math.floor(CLAIMED_CURRENT_AGGREGATE / 8), depth: 96 });
const currentMeasure = (value: unknown) => measureRetainedState(value, currentMeasureLimits);
function currentAdmit(evidence: ClaimedImageProofEvidence, extra: unknown = null, work = 0): void {
  if (!Number.isSafeInteger(evidence.outsideRetainedBytes) || evidence.outsideRetainedBytes < 0
    || !Number.isSafeInteger(work) || work < 0) return fail();
  const retained = currentMeasure([evidence.read, evidence.eventRows, evidence.revisionRows, extra]).bytes;
  if (retained + evidence.outsideRetainedBytes + work > CLAIMED_CURRENT_AGGREGATE) return fail();
}

// JSON text statistics, not JSON text. q/b count quote/backslash code units in
// the SERIALIZED text. JSON serialization emits no raw control or lone UTF-16
// surrogate, so quoting that text is exactly the q+b expansion below.
type JsonSize = { n: number; q: number; b: number };
const jsonAdd = (a: JsonSize, b: JsonSize): JsonSize => ({ n: a.n + b.n, q: a.q + b.q, b: a.b + b.b });
const jsonPunctuation = (n: number): JsonSize => ({ n, q: 0, b: 0 });
const jsonQuoteText = (s: JsonSize): JsonSize => ({ n: 2 + s.n + s.q + s.b, q: 2 + s.q, b: 2 * s.b + s.q });
function jsonStringSize(value: string): JsonSize {
  let n = 2, q = 2, b = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 34) { n += 2; q++; b++; }
    else if (c === 92) { n += 2; b += 2; }
    else if ([8, 9, 10, 12, 13].includes(c)) { n += 2; b++; }
    else if (c < 32) { n += 6; b++; }
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { n += 2; i++; } else { n += 6; b++; }
    } else if (c >= 0xdc00 && c <= 0xdfff) { n += 6; b++; }
    else n++;
  }
  return { n, q, b };
}
function jsonArraySize(items: Iterable<JsonSize>): JsonSize {
  let result = jsonPunctuation(2), count = 0;
  for (const item of items) { result = jsonAdd(result, item); if (count++) result.n++; }
  return result;
}
function jsonRecordSize(entries: Iterable<readonly [string, JsonSize]>): JsonSize {
  let result = jsonPunctuation(2), count = 0;
  for (const [key, value] of entries) {
    result = jsonAdd(result, jsonAdd(jsonStringSize(key), value)); result.n += 1 + (count++ ? 1 : 0);
  }
  return result;
}
function jsonValueSize(value: unknown): JsonSize {
  const ancestors = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): JsonSize => {
    if (++nodes > currentMeasureLimits.nodes || depth > currentMeasureLimits.depth) return fail();
    if (item === null) return jsonPunctuation(4);
    if (typeof item === "string") return jsonStringSize(item);
    if (typeof item === "boolean") return jsonPunctuation(item ? 4 : 5);
    if (typeof item === "number" && Number.isFinite(item)) return jsonPunctuation(Object.is(item, -0) ? 1 : String(item).length);
    if (!item || typeof item !== "object" || ancestors.has(item)) return fail();
    const proto = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return fail();
    ancestors.add(item);
    let result = jsonPunctuation(2), count = 0;
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) {
        const property = Object.getOwnPropertyDescriptor(item, String(i));
        if (!property || !Object.hasOwn(property, "value")) return fail();
        result = jsonAdd(result, visit(property.value, depth + 1)); if (count++) result.n++;
      }
    } else {
      // Inputs are private detached JSON. Inspect descriptors; never call a
      // getter, toJSON, coercion hook or inherited property.
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (!property?.enumerable || !Object.hasOwn(property, "value")) return fail();
        result = jsonAdd(result, jsonAdd(jsonStringSize(key), visit(property.value, depth + 1)));
        result.n += 1 + (count++ ? 1 : 0);
      }
    }
    ancestors.delete(item);
    if (result.n > CLAIMED_CURRENT_AGGREGATE) return fail();
    return result;
  };
  return visit(value, 0);
}
function utf8Length(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 128) result++;
    else if (c < 2048) result += 2;
    else if (c >= 0xd800 && c <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { result += 4; i++; }
    else result += 3; // TextEncoder replaces a lone surrogate with U+FFFD.
  }
  return result;
}

// Explicit finish625–663 + generationHistoryItems168–181 reservation. N is a
// conservative cardinality bound, not an assumed byte amplification factor.
function currentFinishWork(B: number, N: number): number {
  const A = logicalArray(N), S = logicalSet(N);
  const visibilityContainers =
    3 * A + S + // documents spread/filter/id map/set
    3 * A + S + // visible collections spread/filter/id map/set
    A + N * logicalArray(2) + // Object.entries(membership), entry pairs
    5 * A + 2 * S + // blocks spread/filter/current filter/two id maps/sets
    3 * A + // relations spread/library filter/document filter
    2 * A + // retained collections spread/filter
    4 * A + S + // outputs spread/library/current/id map/set
    3 * A + // artifacts spread/library/current
    3 * A; // annotations/preferences/conditions spreads
  const visibilityScalarCopies =
    2 * B + // document-id array and Set
    2 * B + // collection-id array and Set
    B + // membership entry keys
    4 * B + // library/current block-id arrays and Sets
    2 * B; // output-id array and Set
  const families = 2 * A + // source spread and flatMap result
    (64 * N + 16 * N) + A + logicalArray(1) + // all member lists; one callback scratch/return
    B + // {...family}: every original family belongs to the measured map once
    N * (16 + 2 * "members".length) + // replacement members slots
    64 * N + // possible asRecord(non-record) empty fallback objects
    B; // active String(object_id) / replacement scalar copy allowance
  const projectContainers = 2 * A + // spread and result
    11 * A + S + // ONE sequential project callback, not multiplied by projects
    N * (logicalArray(2) + logicalArray(2)); // retained recent-generation/artifact slices
  const projectFields = B + // copied own fields of all original project records
    2 * B + // ONE callback document-id map and Set
    N * (logicalRecord(["documentCount", "collectionCount", "blockCount", "outputCount", "artifactCount", "recentGenerations", "recentArtifacts"]) + 5 * 16)
    + logicalRecord(["id", "name", "state", "createdSequence", "lastSequence", "documentCount", "collectionCount", "blockCount", "outputCount", "artifactCount", "recentGenerations", "recentArtifacts"]) + B;
  // Prior project recent fan arrays plus the active project fan arrays have
  // at most N members in total: document ownership partitions outputs.
  const historyContainers = logicalMap(N) + // active fan map
    (64 * N + 16 * N) + A + // fan buckets plus one in-flight replacement
    logicalArray(2 * N) + // active history items
    (64 * N + 16 * N) + // retained sorted fan arrays across all project cards
    A + 16 * N + A; // one fan's sequence map/numbers and standalone filter
  const historyRecords = 256 * N + 422 * N; // exact fixed output/fan record charges; see derivation
  const historyScalarCopies = B + // fan map keys from output.promptFanId
    B + // output-history id/documentId
    B; // fan-history id/documentId/quality/purpose
  return visibilityContainers + visibilityScalarCopies + families + projectContainers + projectFields
    + historyContainers + historyRecords + historyScalarCopies;
}

// A finite parser reservation before the ONE preflight JSON.parse. Each JSON
// value/property consumes at least one source code unit. Charge 64 per value,
// 16 per edge and 2 per decoded key/string unit, plus the root: <=82*L+64.
// Once parsed, use its measured size for the unchanged helper's later parse.
const jsonParseWork = (text: string) => 64 + 82 * text.length;

type CurrentParserShape = {
  bytes: number; objects: number; properties: number; keyUnits: number;
  descriptorPrimitiveBytes: number; maximumEncode: number;
  maximumPrimitive: number; ownKeyArrays: number;
};
function currentParserShape(value: unknown): CurrentParserShape {
  const result: CurrentParserShape = { bytes: currentMeasure(value).bytes, objects: 0,
    properties: 0, keyUnits: 0, descriptorPrimitiveBytes: 0, maximumEncode: 0,
    maximumPrimitive: 0, ownKeyArrays: 0 };
  const seen = new Set<object>(); let nodes = 0;
  const primitive = (item: unknown): number => item === null || item === undefined ? 8
    : typeof item === "string" ? logicalString(item.length)
      : typeof item === "number" || typeof item === "boolean" ? 16 : 0;
  const visit = (item: unknown, depth: number) => {
    if (++nodes > currentMeasureLimits.nodes || depth > currentMeasureLimits.depth) return fail();
    const scalar = primitive(item);
    result.maximumPrimitive = Math.max(result.maximumPrimitive, scalar);
    if (typeof item === "string") result.maximumEncode = Math.max(result.maximumEncode, utf8Length(item));
    if (!item || typeof item !== "object") return;
    if (seen.has(item)) return; // owner JSON has no aliases; partial rejecting copies are no larger
    seen.add(item); result.objects++;
    let keys = 0, keyBytes = 0;
    const property = (key: string, member: unknown) => {
      keys++; result.properties++; result.keyUnits += key.length;
      keyBytes += logicalString(key.length);
      result.maximumEncode = Math.max(result.maximumEncode, utf8Length(key));
      result.descriptorPrimitiveBytes += primitive(member);
    };
    if (Array.isArray(item)) {
      property("length", item.length); // descriptors includes it, unlike array value traversal
      for (let i = 0; i < item.length; i++) {
        const d = Object.getOwnPropertyDescriptor(item, String(i));
        if (!d || !Object.hasOwn(d, "value")) return fail();
        property(String(i), d.value); visit(d.value, depth + 1);
      }
    } else {
      const proto = Object.getPrototypeOf(item);
      if (proto !== Object.prototype && proto !== null) return fail();
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        const d = Object.getOwnPropertyDescriptor(item, key);
        if (!d?.enumerable || !Object.hasOwn(d, "value")) return fail();
        property(key, d.value); visit(d.value, depth + 1);
      }
    }
    result.ownKeyArrays += logicalArray(keys) + keyBytes;
  };
  visit(value, 0); return result;
}
function currentCaptureTemporary(s: CurrentParserShape): number {
  const descriptorMaps = 64 * s.objects + 16 * s.properties + 2 * s.keyUnits;
  const names = s.ownKeyArrays;
  // {value,writable,enumerable,configurable}: record198 + booleans48.
  const descriptorRecords = 246 * s.properties + s.descriptorPrimitiveBytes;
  return descriptorMaps + names + descriptorRecords + logicalSet(s.objects) + s.maximumEncode;
}
function currentParserShallow(value: unknown, omit: readonly string[] = []): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 64;
  let bytes = 64;
  for (const key in value) {
    if (!Object.hasOwn(value, key) || omit.includes(key)) continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d?.enumerable || !Object.hasOwn(d, "value")) return fail();
    bytes += 16 + 2 * key.length;
    const item: unknown = d.value;
    if (item === null || item === undefined) bytes += 8;
    else if (typeof item === "string") bytes += logicalString(item.length);
    else if (typeof item === "number" || typeof item === "boolean") bytes += 16;
    // Referenced subobjects already belong to separately counted trees.
  }
  return bytes;
}
function currentParserField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (d && !Object.hasOwn(d, "value")) return fail();
  return d?.value;
}
const currentSchemaArray = (keys: readonly string[]) => logicalArray(keys.length)
  + keys.reduce((sum, key) => sum + logicalString(key.length), 0);
const currentInternalJsonWork = (value: unknown) => {
  if (value === undefined) return 0; // stringify(undefined) returns no string
  const length = jsonValueSize(value).n;
  return logicalString(length) + 3 * length; // well-formed JSON UTF8 <=3*UTF16
};

function currentCompletedReviewWork(value: unknown): number {
  const s = currentParserShape(value);
  const capturedReview = s.bytes, returnedFiveFieldReview = s.bytes;
  // generated-image-edit.snapshot uses one Object.defineProperty descriptor
  // after its recursive child returns, unlike claimedEditData's assignment.
  const defineProperty = logicalRecord(["value", "enumerable"]) + 16 + s.maximumPrimitive;
  return capturedReview + currentCaptureTemporary(s) + defineProperty + returnedFiveFieldReview
    + s.ownKeyArrays + currentSchemaArray(["version", "kind", "custodyId", "claimEventId", "lineageDigest"]);
}

// One ownerMediaNamespace call AFTER a valid claimed-owner <=200-byte check.
function currentOwnerNamespaceWork(): number {
  return 200 + logicalArray(200) + 200 * logicalString(2)
    + 2 * logicalString(2) + logicalString(400) + logicalString(402);
}
function currentClaimedMediaParserWork(value: unknown): number {
  if (typeof value !== "string" || !value.startsWith("/api/media/") || value.length > 3083) return 0;
  const suffix = Math.max(0, value.length - 11);
  const decodeAndCanonicalize = logicalString(suffix) + logicalString(suffix) + 3 * suffix
    + logicalString(3072) + logicalString(3083);
  const match = logicalArray(5) + logicalRecord(["index", "input", "groups"]) + 16 + 8
    + logicalString(1024) + logicalString(1024) + logicalString(36) + logicalString(15) + logicalString(36)
    + logicalString(1024); // regexp input scalar
  // Regex key already passed <=1024 UTF8, but decoded owner has not yet passed
  // the200-byte owner check: up to512 hex pairs may be decoded first.
  const ownerDecode = logicalString(1024) + logicalArray(512) + 512 * logicalString(2)
    + 512 + logicalString(512) + 3 * 512 + currentOwnerNamespaceWork();
  const returnedLocation = logicalRecord(["ownerId", "custodyId", "outputId", "revisionId"])
    + logicalString(200) + logicalString(36) + logicalString(15) + logicalString(36);
  return decodeAndCanonicalize + match + ownerDecode + returnedLocation;
}

function currentClaimEventParserWork(value: unknown): number {
  const shape = currentParserShape(value), payload = currentParserField(value, "payload");
  const stream = currentParserField(value, "streamId"), streamLength = typeof stream === "string" ? stream.length : 0;
  const capturedEvent = shape.bytes;
  const fieldValidation = shape.ownKeyArrays + currentSchemaArray(["prose", "bullets", "json", "xml"]);
  const ownerSliceAndCheck = logicalString(streamLength) + 3 * streamLength + logicalString(205);
  const sourceVersionSet = logicalSet(19) + 19 * logicalString(36);
  const claimedIdentityStrings = logicalString(15) + logicalString("guest-image-result-claim:v1:".length + 36)
    + currentOwnerNamespaceWork() + logicalString(1024) + logicalString(3072) + logicalString(3083);
  return capturedEvent + currentCaptureTemporary(shape) + fieldValidation + ownerSliceAndCheck
    + sourceVersionSet + claimedIdentityStrings + currentInternalJsonWork(payload);
}

const currentNativeRequestKeys = ["expectedRevision", "expectedEditEventId", "expectedContentSha256", "generationId", "sourceEventId",
  "contentRef", "sourceMediaUrl", "sourceMediaSha256", "sourceId", "recipe", "resultMediaSha256", "resultByteLength"] as const;
const currentClaimRevisionKeys = ["schemaVersion", "operation", "revision", "editEventId", "outputId", "documentId", "generationId",
  "sourceEventId", "contentRef", "contentSha256", "source", "media", "sourceId", "recipe", "recipeSha256", "operationSha256", "claim"] as const;

function currentClaimRequestParserWork(value: unknown): number {
  const shape = currentParserShape(value), claim = currentParserField(value, "claim"), recipe = currentParserField(value, "recipe");
  const capturedInput = shape.bytes, detachedReturn = shape.bytes;
  // A successful native recipe passed sameData and a successful review has
  // the exact same five values. Therefore the final detached tree has the
  // input's logical size; malformed data cannot reach that second capture.
  const firstOrFinalCapture = currentCaptureTemporary(shape);
  const nativeRest = currentParserShallow(value, ["schemaVersion", "claim"]);
  const nativeRequest = nativeRest;
  const finalLiteral = currentParserShallow(value);
  const schemas = shape.ownKeyArrays + currentSchemaArray([...currentNativeRequestKeys, "schemaVersion", "claim"])
    + currentSchemaArray(currentNativeRequestKeys) + logicalArray(3) + shape.bytes; // native token-value array scalar subset
  return capturedInput + detachedReturn + firstOrFinalCapture + currentCompletedReviewWork(claim)
    + nativeRest + nativeRequest + finalLiteral + currentNativeRecipeWork(recipe)
    + currentClaimedMediaParserWork(currentParserField(value, "sourceMediaUrl")) + schemas + logicalString(15);
}

function currentClaimRevisionParserWork(value: unknown): number {
  const shape = currentParserShape(value), claim = currentParserField(value, "claim"), recipe = currentParserField(value, "recipe");
  const source = currentParserField(value, "source"), media = currentParserField(value, "media");
  const capturedInput = shape.bytes, detachedReturn = shape.bytes;
  const firstOrFinalCapture = currentCaptureTemporary(shape);
  const finalLiteral = currentParserShallow(value) + currentParserShallow(source) + currentParserShallow(media);
  const schemas = shape.ownKeyArrays + currentSchemaArray(currentClaimRevisionKeys)
    + currentSchemaArray(["revision", "eventId", "mediaUrl", "sha256", "width", "height"])
    + currentSchemaArray(["url", "mediaType", "sha256", "byteLength", "width", "height"])
    + logicalArray(3) + shape.bytes; // three UUID-value scalar copies
  return capturedInput + detachedReturn + firstOrFinalCapture + currentCompletedReviewWork(claim)
    + currentNativeRecipeWork(recipe) + finalLiteral + schemas + logicalString(15)
    + currentClaimedMediaParserWork(currentParserField(source, "mediaUrl"))
    + currentClaimedMediaParserWork(currentParserField(media, "url"));
}

function currentClaimOperationParserWork(context: unknown, request: unknown): number {
  const scope = currentParserShape(context);
  const scopeCapture = scope.bytes + currentCaptureTemporary(scope);
  const scopeKeys = scope.ownKeyArrays + currentSchemaArray(["ownerId", "projectId", "documentId", "outputId"]);
  const reconstructedPayload = currentParserShallow(context)
    + (16 + 2 * "domain".length) + logicalString("guest-image-result-edit@1".length)
    + (16 + 2 * "request".length);
  // The caller owns the operation JSON/UTF8/hash reservation, using its exact
  // domain/context/request shadow. This helper covers the hidden recapture,
  // nested full request parse, URL parse and payload record only.
  return scopeCapture + scopeKeys + currentClaimRequestParserWork(request)
    + currentClaimedMediaParserWork(currentParserField(request, "sourceMediaUrl")) + reconstructedPayload;
}


function currentNativeRecipeWork(value: unknown): number {
  if (value === undefined) return 0; // recipe() short-circuits after stringify returns undefined
  const measured = currentMeasure(value), json = jsonValueSize(value);
  // recipe() allocates both BEFORE applying its 32,768-byte rejection. Keep
  // encoded live across normalization/comparison; retaining encoder scratch in
  // this sum after its last use is conservative. Three UTF-8 bytes per UTF-16
  // code unit bounds JSON.stringify output, including surrogate escaping.
  const serialized = logicalString(json.n) + 3 * json.n;
  const object = (v: unknown): v is Record<string, unknown> => v !== null
    && typeof v === "object" && !Array.isArray(v);
  const length = (v: unknown) => typeof v === "string" ? v.length : 0;
  if (!object(value) || !Array.isArray(value.sources) || !Array.isArray(value.layers)
    || value.sources.length > 12 || value.layers.length > 12) return serialized;
  const sourceKeys = ["id", "blockId", "label", "mediaUrl", "contentHash", "kind"];
  const sourceWithUnlockKeys = [...sourceKeys, "requiresUnlock"];
  const layerKeys = ["id", "sourceId", "x", "y", "scale", "opacity"];
  const recipeKeys = ["version", "aspect", "width", "height", "background", "sources", "layers"];
  const s = value.sources.length, l = value.layers.length;
  // N bounds raw Object.keys cardinalities. Sum actual key lengths instead of
  // assuming small keys on an invalid recipe/source/layer object.
  const rawKeys = (v: unknown): number => {
    if (!object(v)) return 0;
    let count = 0, units = 0;
    for (const key in v) if (Object.hasOwn(v, key)) { count++; units += key.length; }
    if (count > measured.nodes) throw new Error("claimed_image_current_unavailable");
    return logicalArray(count) + 24 * count + 2 * units;
  };
  const fixedKeys = (keys: readonly string[]) => logicalArray(keys.length)
    + keys.reduce((sum, key) => sum + logicalString(key.length), 0);
  let maximumRawKeys = rawKeys(value), sourceRecords = 0, sourceIdCopies = 0, sourceScratch = 0;
  for (const entry of value.sources) {
    const source = object(entry) ? entry : null;
    maximumRawKeys = Math.max(maximumRawKeys, rawKeys(source));
    const id = Math.min(256, length(source?.id)), blockId = Math.min(256, length(source?.blockId));
    const kind = length(source?.kind), media = length(source?.mediaUrl);
    const hash = length(source?.contentHash), label = length(source?.label);
    const suffix = Math.max(0, media - "/api/media/".length), key = Math.min(2048, suffix);
    const canonicalMedia = "/api/media/".length + 9 * key;
    // One original normalized record and its {...source} rest copy coexist.
    // kind is deliberately RAW: the helper trims only for its enum check,
    // then returns value.kind unchanged. Whitespace-padded kinds can be long.
    const fields = logicalString(id) + logicalString(blockId)
      + logicalString(Math.min(160, label)) + logicalString(canonicalMedia)
      + logicalString(64) + logicalString(kind);
    sourceRecords += logicalRecord(sourceWithUnlockKeys) + fields + 16
      + logicalRecord(sourceKeys) + fields;
    // The mapped ID array and sourceIds Set each contain scalar ID occurrences.
    sourceIdCopies += 2 * logicalString(id);
    // Only one map callback runs at once. Earlier result records remain in
    // sourceRecords; no accepted cap is applied to raw trim/decode inputs.
    const active = logicalArray(2) + logicalString(5) + logicalString(10)
      + logicalString(kind) // text(kind), before enum refusal
      + logicalString(suffix) + logicalString(suffix) // slice, decoded key before cap
      + logicalArray(key + 1) + 24 * (key + 1) + 2 * key // split and substring values
      + logicalString(9 * key) // encoded key; returned URL is in fields
      + logicalString(hash) + logicalString(64) // first hash trim, valid second trim
      + logicalString(label) // before slice(0,160); returned label is in fields
      + logicalRecord(["requiresUnlock"]) + 16; // conditional object spread input
    sourceScratch = Math.max(sourceScratch, active);
  }
  let layerRecords = 0, layerIdCopies = 0, layerSourceIdCopies = 0;
  for (const entry of value.layers) {
    const layer = object(entry) ? entry : null;
    maximumRawKeys = Math.max(maximumRawKeys, rawKeys(layer));
    const id = Math.min(256, length(layer?.id)), sourceId = Math.min(256, length(layer?.sourceId));
    layerRecords += logicalRecord(layerKeys) + logicalString(id) + logicalString(sourceId) + 4 * 16;
    layerIdCopies += 2 * logicalString(id);
    layerSourceIdCopies += 2 * logicalString(sourceId);
  }
  const sourceContainers = 3 * logicalArray(s) + logicalSet(s); // normalized, rest, IDs, ID Set
  const layerContainers = logicalArray(l);
  // These duplicate checks are sequential; each temporary map array and Set
  // coexist with the original sourceIds Set and accumulated layer records.
  const layerCheck = logicalArray(l) + logicalSet(l) + Math.max(layerIdCopies, layerSourceIdCopies);
  const sizeRecord = logicalRecord(["width", "height"]) + 2 * 16;
  const normalizedRecipe = logicalRecord(recipeKeys) + 3 * 16
    + logicalString(length(value.aspect)) + logicalString(length(value.background));
  // sameData reaches at most root -> array -> source/layer record -> scalar.
  // One matched root Object.keys array can stay live while a child keys()
  // creates raw-left and normalized-right arrays. A mismatching raw object can
  // have arbitrary own keys; use its actual measured cardinality/text above.
  const rightKeys = Math.max(fixedKeys(recipeKeys), fixedKeys(sourceKeys), fixedKeys(layerKeys));
  const comparisonKeys = fixedKeys(recipeKeys) + maximumRawKeys + rightKeys;
  return serialized + sourceContainers + sourceRecords + sourceIdCopies + sourceScratch
    + layerContainers + layerRecords + layerCheck + sizeRecord + normalizedRecipe + comparisonKeys;
}

function claimedCurrentModelWork(evidence: ClaimedImageProofEvidence, current: () => number): number {
  currentAdmit(evidence);
  const input = evidence.read, E = input.events.length;
  if (E > 50_000) return fail();
  const rawJson = "rawJson" in input.planner ? input.planner.rawJson : null;
  let plannerParsedBytes = 0, plannerEncodedBytes = 0;
  if (rawJson !== null) {
    if (typeof rawJson !== "string") return fail();
    currentAdmit(evidence, null, jsonParseWork(rawJson));
    let parsedPlanner: unknown;
    try { parsedPlanner = JSON.parse(rawJson); } catch { return fail(); }
    plannerParsedBytes = currentMeasure(parsedPlanner).bytes;
    plannerEncodedBytes = utf8Length(rawJson);
    parsedPlanner = null;
  }
  let eventIdBytes = 0, rightsIdBytes = 0, maxEventBytes = 0, maxEventJson = 0;
  let aliasNodes = 1, aliasUnits = 9;
  const accountAlias = (value: unknown) => {
    if (value === undefined) return;
    aliasNodes = Math.max(aliasNodes, Math.min(4096, currentMeasure(value).nodes));
    aliasUnits = Math.max(aliasUnits, jsonValueSize(value).n);
  };
  for (const event of input.events) {
    current(); eventIdBytes += logicalString(event.eventId.length);
    if (typeof event.payload.reference_id === "string") rightsIdBytes += logicalString(event.payload.reference_id.length);
    maxEventBytes = Math.max(maxEventBytes, currentMeasure(event).bytes);
    maxEventJson = Math.max(maxEventJson, jsonValueSize(event).n);
    accountAlias(event.payload.block_id); accountAlias(event.payload.reference_id); accountAlias(event.payload.property);
    accountAlias(event.payload.property_path);
    if (event.type === "BlockCreated" && event.payload.properties && typeof event.payload.properties === "object")
      accountAlias((event.payload.properties as Row).reference_id);
    if (event.type === "ExtractionCompleted" && Array.isArray(event.payload.chips)) for (const chip of event.payload.chips)
      if (chip && typeof chip === "object" && !Array.isArray(chip)) accountAlias((chip as Row).property);
  }
  const evidenceSize = currentMeasure([input, evidence.eventRows, evidence.revisionRows]);
  // One active descriptor walk: descriptor map + key list + four-field data
  // descriptors. N bounds property count; B covers copied scalar keys/values.
  const descriptors = logicalArray(evidenceSize.nodes) + 64 + 16 * evidenceSize.nodes
    + evidenceSize.nodes * (logicalRecord(["value", "writable", "enumerable", "configurable"]) + 3 * 16)
    + evidenceSize.bytes;
  const eventSelection =
    6 * logicalArray(E) + logicalSet(E) + 2 * eventIdBytes + // copied input, ID map, claim/edit/no-edit/visible filters
    plannerParsedBytes + plannerEncodedBytes +
    maxEventBytes + 2 * logicalString(maxEventJson) + 3 * maxEventJson + // active detached claim, stringify + encoder
    descriptors;
  currentAdmit(evidence, null, eventSelection);
  const oneFold = (withoutEdits: boolean, other: unknown) => {
    const otherBytes = currentMeasure(other).bytes;
    const fold = createCreativeEventFold(Infinity, input.documentId, input.projectId);
    let peak = 0;
    for (const event of input.events) {
      current(); if (withoutEdits && event.type === "GeneratedImageEdited") continue;
      if (!fold.accept(event)) break;
      const measured = fold.measureRetainedState(currentMeasureLimits);
      peak = Math.max(peak, measured.bytes);
      currentAdmit(evidence, other, eventSelection + measured.bytes);
    }
    const before = fold.measureRetainedState(currentMeasureLimits);
    const finish = currentFinishWork(before.bytes, before.nodes);
    currentAdmit(evidence, other, eventSelection + before.bytes + finish);
    peak = Math.max(peak, before.bytes + finish);
    const projection = fold.finish(); current();
    const after = fold.measureRetainedState(currentMeasureLimits);
    currentAdmit(evidence, other, eventSelection + after.bytes);
    peak = Math.max(peak, after.bytes);
    return { projection, peak: peak + otherBytes };
  };
  const complete = oneFold(false, null);
  // The current projection survives; full maps from oneFold do not escape it.
  const original = oneFold(true, complete.projection);
  const foldPeak = Math.max(complete.peak, original.peak);
  const projection = complete.projection;
  let output: (typeof projection.libraryOutputs)[number] | undefined;
  for (const candidate of projection.libraryOutputs) if (candidate.id === input.outputId) {
    if (output) return fail(); output = candidate;
  }
  let origin: (typeof input.events)[number] | undefined;
  for (const event of input.events) if (event.eventId === input.planner.claim.claimEventId) {
    if (origin) return fail(); origin = event;
  }
  if (!output || !origin) return fail();

  // Superset of potential local proofs. A valid pair necessarily has these
  // exact matches. Aliases/malformed headers can only disqualify it later.
  // No currentness or source authority is conferred by this accounting scan.
  let localProofBytes = 0, largestLocal: JsonSize = jsonPunctuation(0), maxLabel = 160, blockCount = 0, maxBlockBytes = 0;
  for (const block of projection.libraryBlocks) {
    current();
    if (block.projectId !== input.projectId || block.documentId !== input.documentId) continue;
    blockCount++; maxLabel = Math.max(maxLabel, block.handle.length);
    maxBlockBytes = Math.max(maxBlockBytes, currentMeasure(block).bytes);
    const ref = block.properties.reference_id;
    if (typeof ref !== "string") continue;
    let receipt: (typeof input.events)[number] | undefined, creation: typeof receipt;
    let receipts = 0, creations = 0;
    for (const event of input.events) {
      current();
      if (event.type === "ReferenceIngested" && event.payload.reference_id === ref) { receipt = event; receipts++; }
      if (event.type === "BlockCreated" && event.payload.block_id === block.id) { creation = event; creations++; }
    }
    if (receipts !== 1 || creations !== 1 || !receipt || !creation) continue;
    const proof = jsonValueSize({ receipt, creation, current: block.properties, locked: block.locked, sourceEvents: block.sourceEvents });
    localProofBytes += logicalString(proof.n);
    // Componentwise maximum bounds nested escaping even if maxima come from
    // different candidate pairs. Do not select by length alone.
    largestLocal = { n: Math.max(largestLocal.n, proof.n), q: Math.max(largestLocal.q, proof.q), b: Math.max(largestLocal.b, proof.b) };
  }
  const arbitraryText = (n: number): JsonSize => ({ n: 2 + 6 * n, q: 2 + n, b: 2 * n });
  const uriText = (n: number): JsonSize => ({ n: 2 + n, q: 2, b: 0 });
  // Existing media grammar: decoded key <=2048 UTF-16 units, URI encoding
  // expands each by at most9 ASCII units, plus '/api/media/' (11 units).
  const mediaUnits = 11 + 9 * 2048;
  const sourceShape = { id: arbitraryText(256), blockId: arbitraryText(256), label: arbitraryText(maxLabel),
    mediaUrl: uriText(mediaUnits), contentHash: uriText(64), kind: uriText(10), requiresUnlock: jsonPunctuation(5) };
  const sourceJson = jsonRecordSize(Object.entries(sourceShape));
  const sourceBytes = logicalRecord(Object.keys(sourceShape)) + logicalString(256) * 2 + logicalString(maxLabel)
    + logicalString(mediaUnits) + logicalString(64) + logicalString(10) + 16;
  const selectedCount = Math.min(128, blockCount);
  function* repeat(size: JsonSize, n: number) { for (let i = 0; i < n; i++) yield size; }
  const sourcesJson = jsonArraySize(repeat(sourceJson, selectedCount));
  const fingerprintTuple = jsonArraySize([arbitraryText(256), arbitraryText(256), uriText(mediaUnits), uriText(64), uriText(10), jsonPunctuation(5)]);
  const fingerprint = jsonArraySize(repeat(fingerprintTuple, selectedCount));
  const sourceProof = jsonRecordSize([["ordinary", jsonQuoteText(fingerprint)],
    ["local", jsonArraySize(largestLocal.n ? [jsonQuoteText(largestLocal)] : [])]]);
  const p = origin.payload, revision = output.imageRevision;
  const scalarSelection = { ownerId: input.ownerId, projectId: input.projectId, documentId: input.documentId, outputId: input.outputId,
    generationId: p.generation_id, sourceEventId: origin.eventId, sequence: origin.sequence, contentRef: p.output_ref,
    ...(rawJson === null ? {} : { rawJson }), plannerExpiresAt: input.planner.expiresAt, contentExpiresAt: p.content_expires_at, claim: input.planner.claim,
    mediaUrl: output.mediaUrl, mediaSha256: revision?.mediaSha256 ?? p.source_content_hash, width: output.width, height: output.height,
    revision: revision?.revision ?? 0, editEventId: revision?.editEventId ?? null, expectedRawSha256: revision?.contentSha256 ?? null,
    byteLength: revision?.byteLength ?? p.image_byte_length, head: input.head };
  const entries = Object.entries(scalarSelection).map(([key, value]) => [key, jsonValueSize(value)] as const);
  const selectionJson = jsonRecordSize([...entries, ["sources", sourcesJson],
    ["sourceIds", jsonArraySize([arbitraryText(42)])], ["sourceProof", jsonQuoteText(sourceProof)]]);
  const selectionBytes = currentMeasure(scalarSelection).bytes + logicalArray(selectedCount) + selectedCount * sourceBytes
    + logicalArray(1) + logicalString(42) + logicalString(sourceProof.n)
    + 3 * 16 + 2 * ("sources".length + "sourceIds".length + "sourceProof".length);
  const sourceSelection =
    2 * logicalMap(E) + 2 * rightsIdBytes + // rights/ingested maps and their scalar keys
    2 * logicalSet(E) + 2 * evidenceSize.bytes + // marked block/reference IDs
    9 * logicalArray(blockCount) + // blocks, ordinary/filter, local/map/filter, source/map/filter arrays
    (blockCount + 1) * sourceBytes + // all pre-limit ordinary/local source objects plus one normalize argument/result
    3 * logicalArray(selectedCount) + selectedCount * (sourceBytes + logicalArray(6) + sourceBytes) + // fingerprint normalization/filter/field tuples
    3 * logicalArray(E) + // one local source's creation/receipt/other-creation matching filters
    2 * logicalArray(1) + // local sourceIds filter and sourceProof proof-string map
    evidenceSize.bytes + 3 * logicalString(mediaUnits) + 2 * logicalString(2048)
      + logicalArray(2049) + 2049 * logicalString(1) + // one media decoder, retained URLs and split path parts
    localProofBytes + logicalString(fingerprint.n) + logicalString(sourceProof.n) +
    logicalSet(selectedCount) + logicalArray(selectedCount) + selectedCount * logicalString(256);
  const comparisonJson = Math.max(jsonValueSize(output.claimedOrigin ?? null).n, jsonValueSize(output.imageRevision ?? null).n);
  const comparisonWork = 2 * logicalString(comparisonJson);
  // claimedHistoryId: <=4096 visited values, <=25 active levels. Its parts
  // array headers/slots and primitive-result string headers are each <=nodes.
  // At each level the joined primitive content is bounded by that identity's
  // JSON spelling; quoted JSON only adds syntax/escaping to String(array).
  const aliasWork = logicalSet(aliasNodes) + (64 + 16 + 24) * aliasNodes + 2 * 25 * aliasUnits;
  const editReplayWork = 2 * currentMeasure(output).bytes + 3 * currentMeasure(input.planner.claim).bytes;
  // Accepted source caps apply only AFTER normalization. One raw candidate can
  // first construct/trim a much larger block id, label, reference id or receipt
  // URL. Charge the actual selected-block and event bounds for those fields.
  const rawNormalizationWork = 2 * maxBlockBytes + 2 * maxEventBytes + logicalString(6);
  // One local comparator retains receiptValues/propertyValues, one active
  // Object.entries scalar copy, the localContext tuple and fixed-key sets.
  const localComparisonWork = 4 * maxEventBytes + maxBlockBytes
    + logicalSet(31) + 2 * logicalArray(31) + 31 * logicalArray(2);
  // First compact selection/proof persists through the second select; at the
  // final comparison both selections and both proof strings may coexist.
  // Snapshot has another shallow source roster and scalar/media fields. Keep
  // the whole selection allowance and explicitly add its new nested-media,
  // status and content-hash shape, although sourceProof is absent in reality.
  const snapshotShape = logicalRecord(["status", "media", "contentSha256"])
    + logicalRecord(["url", "mediaType", "sha256", "width", "height", "byteLength"])
    + logicalString(7) + logicalString(9) + logicalString(64);
  // The shared model selector now has a fixed metadata-only sibling. Its
  // normalized read/planner records do not copy the event array, but their
  // scalar fields and the strict wrapper's rest/spread selections coexist.
  // A metadata result additionally copies one exact local pair's source and
  // sourceEvents array; maxBlockBytes bounds the latter's retained values.
  // These are logical allocation reservations, not measured peak heap.
  const normalizedReadWork = logicalRecord(["ownerId", "projectId", "documentId", "outputId", "events", "head", "planner"])
    + logicalRecord(["contentRef", "expiresAt", "claim"])
    + currentMeasure([input.ownerId, input.projectId, input.documentId, input.outputId, input.head,
      input.planner.contentRef, input.planner.expiresAt, input.planner.claim]).bytes;
  const metadataPairWork = logicalRecord(["sourceId", "blockId", "referenceId", "receiptEventId", "creationEventId",
    "sourceExpiresAt", "locked", "sourceEvents", "source", "proof"])
    + sourceBytes + maxBlockBytes + logicalString(largestLocal.n) + 6 * logicalString(42) + logicalString(24)
    + logicalRecord(["status", "snapshot", "title", "plannerExpiresAt", "contentExpiresAt", "localPair"])
    + currentMeasure(output.title ?? "").bytes + 2 * logicalString(24) + logicalString(7);
  const modelCompanionWork = 2 * normalizedReadWork + 2 * selectionBytes + metadataPairWork;
  const hiddenPeak = foldPeak + eventSelection + sourceSelection + comparisonWork + aliasWork + editReplayWork
    + rawNormalizationWork + localComparisonWork + modelCompanionWork
    + 3 * selectionBytes + snapshotShape + 2 * logicalString(selectionJson.n) + plannerEncodedBytes + hashDigestWork;
  // Preflight graphs still exist HERE. Charge them separately; only scalar
  // hiddenPeak leaves this scope before the unchanged pure helper is called.
  currentAdmit(evidence, [complete.projection, original.projection, scalarSelection],
    eventSelection + sourceSelection + comparisonWork + aliasWork + editReplayWork + rawNormalizationWork + localComparisonWork + modelCompanionWork
      + 3 * selectionBytes + snapshotShape + 2 * logicalString(selectionJson.n));
  currentAdmit(evidence, null, hiddenPeak);
  return hiddenPeak;
}


/** Exact current/revision value join. The caller may only publish the returned
 * snapshot after its live completed-owner before/after proof succeeds. This
 * result has no brand and is not accepted as a read/write capability anywhere. */
export async function qualifyClaimedImageCurrent(evidence: ClaimedImageCurrentEvidence): Promise<ClaimedImageCurrentFacts> {
  const current = () => {
    if (!Number.isFinite(evidence.monotonicDeadline) || !Number.isFinite(evidence.wallDeadline)
      || performance.now() >= evidence.monotonicDeadline || Date.now() >= evidence.wallDeadline) return fail();
    return Date.now();
  };
  current();
  if (!Number.isSafeInteger(evidence.outsideRetainedBytes) || evidence.outsideRetainedBytes < 0) return fail();
  const read = evidence.read;
  const work = claimedCurrentModelWork(evidence, current); current();
  currentAdmit(evidence, null, work);
  const snapshot = await inspectCurrentGuestImageResultEdit(() => read, current); current();
  currentAdmit(evidence, snapshot);
  if (snapshot.status !== "current") return fail();
  return qualifyClaimedImageRevisionChain(evidence, snapshot, current);
}

/** Both named consumers qualify the same actual private revision chain. The
 * generic shape preserves the strict reader's real rawJson and the separate
 * metadata consumer's absence of planner bytes without manufacturing either. */
async function qualifyClaimedImageRevisionChain<S extends Readonly<ClaimedImageMetadataSnapshot>>(
  evidence: ClaimedImageProofEvidence, snapshot: S, current: () => number,
  additionalRoots: unknown = null,
): Promise<ClaimedImageQualifiedFacts<S>> {
  const read = evidence.read;
  if (!Array.isArray(evidence.eventRows) || !Array.isArray(evidence.revisionRows)
    || evidence.eventRows.length !== read.events.length || evidence.revisionRows.length > 128) return fail();
  const retainedRoots: unknown[] = [snapshot, additionalRoots];
  const admit = (extra: unknown = null, scratch = 0) => { current(); currentAdmit(evidence, [retainedRoots, extra], scratch); };
  admit(null, logicalArray(read.events.length));
  const origins = read.events.filter(event => event.eventId === snapshot.claim.claimEventId);
  retainedRoots.push(origins); admit();
  if (origins.length !== 1) return fail();
  admit(null, currentClaimEventParserWork(origins[0]));
  const canonical = parseGuestImageResultClaimEvent(origins[0]);
  if (!canonical || canonical.payload.custody_id !== snapshot.claim.custodyId) return fail();
  retainedRoots.push(canonical); admit();
  privateEvent(evidence.eventRows, canonical, snapshot, { evidence, roots: retainedRoots, current });
  admit(null, utf8Length(snapshot.outputId) + logicalArray(utf8Length(snapshot.outputId)) + utf8Length(snapshot.outputId) * logicalString(2));
  const p = canonical.payload, key = artifactKey(snapshot.outputId);
  const origin: ClaimedImageQualifiedFacts<S>["origin"] = Object.freeze({ outputId: snapshot.outputId, documentId: snapshot.documentId,
    generationId: snapshot.generationId, sourceEventId: snapshot.sourceEventId, contentRef: snapshot.contentRef,
    contentSha256: snapshot.contentSha256, claim: snapshot.claim });
  const initialMedia: ClaimedImageMedia = Object.freeze({ url: p.media_url, mediaType: "image/png", sha256: p.source_content_hash,
    byteLength: p.image_byte_length, width: p.image_width, height: p.image_height });
  retainedRoots.push(key, origin, initialMedia); admit(null, logicalArray(read.events.length));
  const edits = read.events.filter(event => event.type === "GeneratedImageEdited"
    && (event.payload.output_id === snapshot.outputId || event.payload.object_id === snapshot.outputId));
  if (snapshot.revision !== edits.length || evidence.revisionRows.length !== (edits.length === 0 ? 0 : edits.length + 1)) return fail();
  let media = initialMedia, editEventId: string | null = null, expiry = p.content_expires_at, totalBytes = 0;
  const retained: ClaimedImageRetainedRevision[] = [], revisionIds = new Set<string>(), operations = new Set<string>();
  retainedRoots.push(edits, retained, revisionIds, operations); admit();
  const textHash = async (value: string, extra: unknown = null) => {
    admit([extra, value], utf8Length(value) + hashDigestWork);
    const hash = await outputAssetSha256(encoder.encode(value));
    current(); admit([extra, value, hash]); return hash;
  };
  for (let index = 0; index < evidence.revisionRows.length; index++) {
    // A body-free original has no raw planner hash. Edited state must bind a
    // genuine raw hash to every actual retained origin and revision below.
    if (!rawPlannerOrigin(origin)) return fail();
    current(); const value = evidence.revisionRows[index];
    if (!row(value) || !keys(value, revisionRowKeys) || value.owner_id !== snapshot.ownerId || value.organization_id !== null
      || value.project_access_id !== null || value.project_id !== snapshot.projectId || value.document_id !== snapshot.documentId
      || value.artifact_id !== key || value.revision !== index || !uuid(value.revision_id) || revisionIds.has(value.revision_id)
      || value.created_by_user_id !== snapshot.ownerId || !iso(value.created_at) || Date.parse(value.created_at) > current()
      || !iso(value.expires_at) || Date.parse(value.expires_at) <= current() || value.expires_at > p.content_expires_at
      || value.expires_at <= value.created_at || value.created_at < canonical.recordedAt || value.redacted_at !== null
      || typeof value.content_json !== "string" || !value.content_json.isWellFormed() || !digest(value.content_sha256)) return fail();
    const length = utf8Length(value.content_json); totalBytes += length;
    if (length < 1 || length > 100_000 || totalBytes > 8_000_000 || await textHash(value.content_json) !== value.content_sha256) return fail();
    revisionIds.add(value.revision_id); if (value.expires_at < expiry) expiry = value.expires_at;
    let envelope: unknown;
    admit(null, jsonParseWork(value.content_json));
    try { envelope = JSON.parse(value.content_json); } catch { return fail(); }
    current(); admit(envelope, currentCompletedReviewWork(currentParserField(currentParserField(envelope, "origin"), "claim")));
    if (!row(envelope) || !keys(envelope, ["kind", "schemaVersion", "origin", "initialMedia", "request", "imageRevision"])
      || envelope.kind !== "generated-image" || envelope.schemaVersion !== 2 || !sameOrigin(envelope.origin, origin)
      || !sameMedia(envelope.initialMedia, initialMedia)) return fail();
    if (index === 0) {
      if (envelope.request !== null || envelope.imageRevision !== null || value.created_at !== edits[0]?.recordedAt) return fail();
      retained.push(Object.freeze({ row: value, envelope: Object.freeze({ kind: "generated-image", schemaVersion: 2, origin,
        initialMedia, request: null, imageRevision: null }), event: null }));
      admit(envelope);
      continue;
    }
    admit(envelope, currentClaimRevisionParserWork(envelope.imageRevision));
    const record = parseGuestImageResultRevision(envelope.imageRevision, snapshot.ownerId, value.revision_id);
    admit([envelope, record], currentClaimRequestParserWork(envelope.request));
    const request = parseGuestImageResultEditRequest(envelope.request), event = edits[index - 1]!;
    const loopRoots = [envelope, record, request, event];
    admit(loopRoots, currentCompletedReviewWork(record?.claim) + currentCompletedReviewWork(request?.claim)
      + currentCompletedReviewWork(record?.claim) + currentParserShallow(origin));
    if (!record || !request || !equalReview(record.claim, snapshot.claim) || !equalReview(request.claim, snapshot.claim)
      || record.revision !== index || !sameOrigin({ outputId: record.outputId, documentId: record.documentId, generationId: record.generationId,
        sourceEventId: record.sourceEventId, contentRef: record.contentRef, contentSha256: record.contentSha256, claim: record.claim }, origin)
      || record.source.eventId !== (editEventId ?? canonical.eventId) || record.source.mediaUrl !== media.url || record.source.sha256 !== media.sha256
      || record.source.width !== media.width || record.source.height !== media.height || request.expectedRevision !== index - 1
      || request.expectedEditEventId !== editEventId || request.expectedContentSha256 !== origin.contentSha256
      || request.generationId !== origin.generationId || request.sourceEventId !== origin.sourceEventId || request.contentRef !== origin.contentRef
      || request.sourceMediaUrl !== media.url || request.sourceMediaSha256 !== media.sha256 || request.sourceId !== record.sourceId
      || request.resultMediaSha256 !== record.media.sha256 || request.resultByteLength !== record.media.byteLength) return fail();
    const recipeSize = jsonValueSize(record.recipe), requestRecipeSize = jsonValueSize(request.recipe);
    admit(loopRoots, logicalString(recipeSize.n) + logicalString(requestRecipeSize.n));
    if (JSON.stringify(request.recipe) !== JSON.stringify(record.recipe)) return fail();
    admit(loopRoots, logicalString(recipeSize.n));
    const recipeJson = JSON.stringify(record.recipe);
    if (record.recipeSha256 !== await textHash(recipeJson, loopRoots)) return fail();
    current(); admit([loopRoots, recipeJson]);
    const operationScope = { ownerId: snapshot.ownerId, projectId: snapshot.projectId, documentId: snapshot.documentId, outputId: snapshot.outputId };
    const operationValue = { domain: "guest-image-result-edit@1", ...operationScope, request };
    const operationSize = jsonValueSize(operationValue);
    // JSON is well formed; three UTF-8 bytes per UTF-16 unit bounds the encoded
    // operation while preserving the helper's exact existing domain and order.
    admit([loopRoots, recipeJson, operationScope, operationValue], currentClaimOperationParserWork(operationScope, request)
      + logicalString(operationSize.n) + 3 * operationSize.n + hashDigestWork);
    const operation = await guestImageResultEditOperationSha256(operationScope, request); current();
    admit([loopRoots, recipeJson, operationScope, operationValue, operation]);
    if (operation !== record.operationSha256 || operations.has(record.operationSha256)) return fail();
    operations.add(record.operationSha256);
    privateEvent(evidence.eventRows, event, snapshot, { evidence, roots: [retainedRoots, loopRoots, recipeJson, operationScope, operationValue, operation], current });
    const ep = event.payload;
    if (event.eventId !== record.editEventId || event.recordedAt !== value.created_at
      || ep.image_revision_id !== value.revision_id || ep.image_revision_sha256 !== value.content_sha256
      || ep.image_edit_operation_sha256 !== record.operationSha256 || ep.content_sha256 !== origin.contentSha256
      || ep.previous_revision !== index - 1 || ep.previous_edit_event_id !== editEventId
      || ep.media_url !== record.media.url || ep.source_content_hash !== record.media.sha256
      || ep.image_width !== record.media.width || ep.image_height !== record.media.height || ep.image_byte_length !== record.media.byteLength) return fail();
    media = record.media; editEventId = record.editEventId;
    retained.push(Object.freeze({ row: value, envelope: Object.freeze({ kind: "generated-image", schemaVersion: 2, origin,
      initialMedia, request, imageRevision: record }), event }));
    admit([loopRoots, recipeJson, operationScope, operationValue, operation]);
  }
  if (!sameMedia(snapshot.media, media) || snapshot.editEventId !== editEventId || Date.parse(expiry) <= current()) return fail();
  // The pure model establishes the one exact current local pair. This native
  // row join supplies its required-role expiry, which revised pure values can
  // only upper-bound. Locked pairs remain visible but cannot be edit sources.
  admit(null, logicalArray(snapshot.sources.length));
  const local = snapshot.sources.filter(source => source.mediaUrl === snapshot.media.url);
  if (local.length > 1) return fail();
  const localEvents: string[] = [], localResources: string[] = [];
  retainedRoots.push(local, localEvents, localResources); admit();
  for (const source of local) {
    admit(null, logicalArray(read.events.length));
    const created = read.events.filter(event => event.type === "BlockCreated" && event.payload.block_id === source.blockId);
    if (created.length !== 1 || !row(created[0]!.payload.properties)) return fail();
    const creation = created[0]!, properties = creation.payload.properties as Row;
    admit(created, logicalArray(read.events.length));
    const receipts = read.events.filter(event => event.type === "ReferenceIngested" && event.payload.reference_id === properties.reference_id);
    if (receipts.length !== 1 || !uuid(source.blockId) || !uuid(properties.reference_id)
      || properties.source_expires_at !== expiry || receipts[0]!.payload.source_expires_at !== expiry) return fail();
    const localRoots = [retainedRoots, created, receipts];
    privateEvent(evidence.eventRows, creation, snapshot, { evidence, roots: localRoots, current });
    privateEvent(evidence.eventRows, receipts[0]!, snapshot, { evidence, roots: localRoots, current });
    localEvents.push(receipts[0]!.eventId, creation.eventId); localResources.push(source.blockId, properties.reference_id);
    admit([created, receipts]);
  }
  const last = retained.at(-1), revision = last?.envelope.imageRevision;
  let derivativeMetadata: ClaimedImageRevisionMetadata | null = null;
  if (snapshot.revision > 0) {
    if (!revision || !last || typeof last.row.revision_id !== "string" || typeof last.row.content_sha256 !== "string") return fail();
    admit(null, currentClaimRevisionParserWork(revision));
    derivativeMetadata = claimedImageRevisionMetadata(snapshot.ownerId, last.row.revision_id, last.row.content_sha256, revision);
  }
  const facts = Object.freeze({ snapshot, canonical, origin, initialMedia, retained: Object.freeze(retained), retainedExpiresAt: expiry, artifactKey: key, derivativeMetadata,
    localContext: Object.freeze({ eventIds: Object.freeze(localEvents), resourceIds: Object.freeze(localResources) }) });
  admit(facts); return facts;
}

/** Body-free local-source adoption qualification. The immutable planner-copy
 * association retains its canonical JSON-string digest as contentDigest.
 * Original revision zero has no raw planner hash here; an edited projection's
 * raw hash is bound to every genuine private revision by the full chain above.
 * Only the fresh completed owner proves that association and role retention.
 * This helper performs no IO, grants no provider rights, and supplies no body. */
export async function qualifyClaimedImageLocalAdoption(
  evidence: ClaimedImageLocalAdoptionEvidence,
): Promise<ClaimedImageLocalAdoptionFacts> {
  const current = () => {
    if (!Number.isFinite(evidence.monotonicDeadline) || !Number.isFinite(evidence.wallDeadline)
      || performance.now() >= evidence.monotonicDeadline || Date.now() >= evidence.wallDeadline) return fail();
    return Date.now();
  };
  current();
  if (!Number.isSafeInteger(evidence.outsideRetainedBytes) || evidence.outsideRetainedBytes < 0) return fail();
  const work = claimedCurrentModelWork(evidence, current); current();
  currentAdmit(evidence, null, work);
  const metadata = inspectCurrentGuestImageResultMetadata(() => evidence.read, current); current();
  currentAdmit(evidence, metadata);
  if (metadata.status !== "current") return fail();
  const facts = await qualifyClaimedImageRevisionChain(evidence, metadata.snapshot, current, metadata);
  current(); currentAdmit(evidence, [metadata, facts]);
  const pair = metadata.localPair;
  if (pair && (pair.sourceExpiresAt !== facts.retainedExpiresAt
    || facts.localContext.eventIds.length !== 2 || facts.localContext.resourceIds.length !== 2
    || facts.localContext.eventIds[0] !== pair.receiptEventId || facts.localContext.eventIds[1] !== pair.creationEventId
    || facts.localContext.resourceIds[0] !== pair.blockId || facts.localContext.resourceIds[1] !== pair.referenceId)) return fail();
  if (!pair && (facts.localContext.eventIds.length || facts.localContext.resourceIds.length)) return fail();
  const result = Object.freeze({ ...facts, title: metadata.title, plannerExpiresAt: metadata.plannerExpiresAt,
    contentExpiresAt: metadata.contentExpiresAt, localPair: pair });
  currentAdmit(evidence, [metadata, facts, result]); return result;
}

/** Additional inert writer preparation. Its caller already owns the original
 * immutable evidence and fresh facts; this does not read storage or establish
 * authority. The complete projection must leave the writer's preparation
 * scope after selecting its bounded current ordinary-source facts. */
export type ClaimedImageEditProjectionEvidence = Readonly<{
  read: GuestImageResultEditRead;
  eventRows: readonly Row[];
  facts: ClaimedImageCurrentFacts;
  monotonicDeadline: number;
  wallDeadline: number;
  outsideRetainedBytes: number;
}>;
export function qualifyClaimedImageEditProjection(evidence: ClaimedImageEditProjectionEvidence): Readonly<CreativeProjection> {
  const expiry = Date.parse(evidence.facts.retainedExpiresAt);
  const current = () => {
    const now = Date.now();
    if (!Number.isFinite(expiry) || !Number.isFinite(evidence.monotonicDeadline) || !Number.isFinite(evidence.wallDeadline)
      || performance.now() >= evidence.monotonicDeadline || now >= evidence.wallDeadline || now >= expiry) return fail();
    return now;
  };
  current();
  if (!Number.isSafeInteger(evidence.outsideRetainedBytes) || evidence.outsideRetainedBytes < 0) return fail();
  const read = evidence.read, snapshot = evidence.facts.snapshot;
  if (snapshot.ownerId !== read.ownerId || snapshot.projectId !== read.projectId || snapshot.documentId !== read.documentId
    || snapshot.outputId !== read.outputId || snapshot.head !== read.head || evidence.eventRows.length !== read.events.length) return fail();
  // Facts stay live through this extra fold. Charging them outside the normal
  // evidence roots can only consume the fixed ceiling, never increase it.
  const measured: ClaimedImageCurrentEvidence = { read, eventRows: evidence.eventRows,
    revisionRows: evidence.facts.retained.map(value => value.row), monotonicDeadline: evidence.monotonicDeadline,
    wallDeadline: evidence.wallDeadline, outsideRetainedBytes: evidence.outsideRetainedBytes + currentMeasure(evidence.facts).bytes };
  // Reuse the exact source-derived complete/no-edit fold preflight. It returns
  // only a scalar; its graphs retire before the actual projection is built.
  // This is additional bounded CPU work, not reuse of a caller's projection.
  const work = claimedCurrentModelWork(measured, current); current();
  currentAdmit(measured, null, work);
  const fold = createCreativeEventFold(Infinity, read.documentId, read.projectId);
  for (const event of read.events) {
    current(); if (!fold.accept(event)) break;
    if (fold.measureRetainedState(currentMeasureLimits).bytes > work) return fail();
    currentAdmit(measured, null, work);
  }
  const before = fold.measureRetainedState(currentMeasureLimits);
  if (before.bytes + currentFinishWork(before.bytes, before.nodes) > work) return fail();
  currentAdmit(measured, null, work);
  const projection = fold.finish(); current();
  const retained = fold.measureRetainedState(currentMeasureLimits).bytes;
  if (retained > work) return fail(); currentAdmit(measured, null, retained);
  return projection;
}

// Arithmetic only: callers still measure their own live roots and admit the
// resulting work under the fixed operation ceiling. No authority or admission
// follows from these numbers, and no IO or application parser runs here.
export {
  currentClaimEventParserWork as claimedImageLocalAdoptionCanonicalWork,
  currentClaimRequestParserWork as claimedImageEditRequestWork,
  currentClaimRevisionParserWork as claimedImageEditRevisionWork,
  currentClaimOperationParserWork as claimedImageEditOperationWork,
  currentNativeRecipeWork as claimedImageEditRecipeWork,
  currentClaimedMediaParserWork as claimedImageEditMediaWork,
};


/** Closed authored derivative metadata, shared by the specific current reader
 * and later claimed writer. Original copied PNGs retain the separate immutable
 * twelve-field copy descriptor. Metadata is never an authorization receipt. */
export type ClaimedImageRevisionMetadata = Readonly<{
  ownerId: string; custodyId: string; outputId: string; generationId: string;
  claimEventId: string; lineageDigest: string; revisionId: string; editEventId: string;
  revisionSha256: string; operationSha256: string; sha256: string;
  mimeType: "image/png"; model: "authored-composition"; source: "generated-image-editor";
}>;
export function claimedImageRevisionMetadata(ownerId: string, revisionId: string, revisionSha256: string,
  value: GuestImageResultRevision): ClaimedImageRevisionMetadata {
  const revision = parseGuestImageResultRevision(value, ownerId, revisionId);
  if (!revision || !digest(revisionSha256)) return fail();
  return Object.freeze({ ownerId, custodyId: revision.claim.custodyId, outputId: revision.outputId, generationId: revision.generationId,
    claimEventId: revision.claim.claimEventId, lineageDigest: revision.claim.lineageDigest, revisionId, editEventId: revision.editEventId,
    revisionSha256, operationSha256: revision.operationSha256, sha256: revision.media.sha256,
    mimeType: "image/png", model: "authored-composition", source: "generated-image-editor" });
}
