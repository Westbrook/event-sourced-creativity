import type { NativeMemoryOriginDependency, NativeMemoryOriginEnrollment,
  NativeStructuredMemoryOriginOriginal, NativeStructuredMemoryOriginRevision } from "./memory-native-origin.ts";

export const DOCUMENT_JOB_ORIGIN_MANIFEST_RECIPE = "native-document-job-origin-manifest-v1";
export const DOCUMENT_JOB_ORIGIN_MANIFEST_LIMITS = { bytes: 65_536, contextBytes: 16_384,
  originals: 128, ledgerRevisions: 64, selectors: 513 } as const;
type Dependency = Omit<NativeMemoryOriginDependency, "origin_id">;
type Original = Omit<NativeStructuredMemoryOriginOriginal, "origin_id">;
type Revision = Omit<NativeStructuredMemoryOriginRevision, "origin_id">;
type JobBinding = { originId: string; jobId: string; attemptCount: number; claimSha256: string; requestSha256: string;
  inputContentRef: string; inputSha256: string; sourceHead: number; projectSourceHead: number | null };
type Common = { schemaVersion: 1; recipeVersion: typeof DOCUMENT_JOB_ORIGIN_MANIFEST_RECIPE; job: JobBinding;
  enrollment: NativeMemoryOriginEnrollment; contextJson: string; consumedValueSha256: string;
  renderer: {recipe: "document-job-evidence-answer-v1"; locale: "en" | "fr" | "ar" | "ja"};
  lifetime: {capturedAt: string; publicationValidUntil: string; sourceRetentionCeiling: string} };
export type DocumentJobOriginManifest = Common & ({ mode: "extractive"; dependencies: Dependency[] } | {
  mode: "structured"; projectionOptions: {maxBytes: number; specifiedMaxBytes: boolean};
  intervals: {afterSequence: number; throughSequence: number}[]; originals: Original[]; ledgerRevisions: Revision[];
  ledgerHead: {ledgerId: string; revision: number; bodyRef: string; bodyHash: string};
});
export type DocumentJobOriginSelector = {resource_kind: "event" | "private-content" | "ledger" | "enrollment"; resource_id: string};
export type DocumentJobOriginManifestMaterial = Readonly<{text: string; sha256: string;
  selectors: readonly Readonly<DocumentJobOriginSelector>[]; selectorListSha256: string}>;

const utf8 = (text: string) => new TextEncoder().encode(text);
const fail = (): never => { throw new Error("document_job_origin_manifest_invalid"); };
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && value.isWellFormed();
const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const at = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const keys = (value: unknown, wanted: readonly string[]): boolean => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === [...wanted].sort().join("\0");
const commonKeys = ["schemaVersion", "recipeVersion", "job", "enrollment", "contextJson", "consumedValueSha256", "renderer", "lifetime", "mode"];
const enrollmentKeys = ["enrollment_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id", "project_id",
  "document_id", "revision", "policy_version", "permission_epoch", "enrolled_at", "expires_at", "retention_days", "cursor_sequence"];
const segmentKeys = ["segment_enrollment_id", "segment_revision", "segment_recipe", "segment_first_sequence", "segment_last_sequence",
  "segment_member_count", "segment_ordinal", "segment_created_at", "segment_retention_ceiling"] as const;
const dependencyKeys = ["ordinal", "event_stream_id", "event_id", "source_sequence", "event_type", "recorded_at", "block_id", "turn_id",
  "user_content_id", "assistant_content_id", "projection_sha256", "source_retention_ceiling", "consumed", ...segmentKeys];
const originalKeys = ["ordinal", "event_stream_id", "event_id", "source_sequence", "event_type", "role", "turn_id", "content_id",
  "content_sha256", "projection_sha256", "recorded_at", "source_retention_ceiling", "retained_by_ledger", "presented_in_context"];
const revisionKeys = ["ordinal", "ledger_id", "storage_revision", "predecessor_revision", "predecessor_hash", "body_ref", "body_hash", "created_at", "expires_at"];
const sourceTypes = new Set(["DocumentOpened", "DocumentViewVisited", "ObjectViewed", "DocumentArtifactViewed", "ComparisonOpened",
  "BlockCreated", "BlockPropertyEdited", "ChipEdited", "BlockWeightSet", "BlockLocked", "BlockUnlocked", "BlockRelationAdded", "BlockRelationRemoved",
  "BlockRemoved", "BlockRestored", "ObjectSaved", "ObjectPinned", "ObjectExported", "DocumentArtifactExported", "ArtifactApproved",
  "CanvasItemPlaced", "CanvasReferenceCreated", "ContextSetFormalized", "ObjectDiscarded", "ObjectCritiqued", "ArtifactChangesRequested",
  "ArtifactReviewRequested", "GenerationRequested", "DocumentRenderRequested", "ProposalAccepted", "ProposalRejected", "ProposalDeclined",
  "BriefItemAccepted", "BriefItemIgnored", "BriefDismissed", "AssistantReasoned"]);

/** Own only plain data, without invoking getters/toJSON or retaining aliases.
 * Limits apply before cryptographic awaits. Unknown fields are rejected below. */
function own(value: unknown, depth = 0, budget = {nodes: 0}): unknown {
  if (++budget.nodes > 8192 || depth > 20) return fail();
  if (value === null || typeof value === "boolean" || integer(value, -Number.MAX_SAFE_INTEGER)) return value;
  if (typeof value === "string") return value.length <= 65536 && value.isWellFormed() && utf8(value).length <= 65536 ? value : fail();
  if (!value || typeof value !== "object") return fail();
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !Object.hasOwn(length, "value") || !integer(length.value, 0, 513)) return fail();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.some(name => typeof name !== "string")) return fail();
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 513 || names.length !== value.length + 1) return fail();
    return Array.from({length: value.length}, (_, index) => {
      const entry = descriptors[String(index)];
      return entry && Object.hasOwn(entry, "value") && entry.enumerable ? own(entry.value, depth + 1, budget) : fail();
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || names.length > 64) return fail();
  return Object.fromEntries((names as string[]).sort().map(name => {
    const entry = descriptors[name];
    if (!Object.hasOwn(entry, "value") || !entry.enumerable) return fail();
    return [name, own(entry.value, depth + 1, budget)];
  }));
}

function validate(value: unknown): DocumentJobOriginManifest {
  const m = value as DocumentJobOriginManifest;
  if (!m || (m.mode !== "extractive" && m.mode !== "structured")
    || !keys(m, [...commonKeys, ...(m.mode === "extractive" ? ["dependencies"]
      : ["projectionOptions", "intervals", "originals", "ledgerRevisions", "ledgerHead"])])
    || m.schemaVersion !== 1 || m.recipeVersion !== DOCUMENT_JOB_ORIGIN_MANIFEST_RECIPE
    || !keys(m.job, ["originId", "jobId", "attemptCount", "claimSha256", "requestSha256", "inputContentRef", "inputSha256", "sourceHead", "projectSourceHead"])
    || ![m.job.originId, m.job.jobId, m.job.inputContentRef].every(id)
    || ![m.job.claimSha256, m.job.requestSha256, m.job.inputSha256, m.consumedValueSha256].every(digest)
    || !integer(m.job.attemptCount, 1) || !integer(m.job.sourceHead, 1, Number.MAX_SAFE_INTEGER - 2)
    || !keys(m.enrollment, enrollmentKeys)
    || ![m.enrollment.enrollment_id, m.enrollment.actor_user_id, m.enrollment.owner_user_id, m.enrollment.project_id,
      m.enrollment.document_id, m.enrollment.policy_version, m.enrollment.permission_epoch].every(id)
    || !integer(m.enrollment.revision, 1) || !integer(m.enrollment.retention_days, 1, 365)
    || !integer(m.enrollment.cursor_sequence, m.mode === "extractive" ? 1 : 0, m.job.sourceHead)
    || (m.enrollment.organization_id === null) !== (m.enrollment.project_access_id === null)
    || (m.enrollment.organization_id === null ? m.enrollment.actor_user_id !== m.enrollment.owner_user_id || m.job.projectSourceHead !== null
      : !id(m.enrollment.organization_id) || !id(m.enrollment.project_access_id) || !integer(m.job.projectSourceHead, 0, Number.MAX_SAFE_INTEGER - 2))
    || !keys(m.renderer, ["recipe", "locale"]) || m.renderer.recipe !== "document-job-evidence-answer-v1"
    || !["en", "fr", "ar", "ja"].includes(m.renderer.locale)
    || !keys(m.lifetime, ["capturedAt", "publicationValidUntil", "sourceRetentionCeiling"])
    || ![m.enrollment.enrolled_at, m.enrollment.expires_at, m.lifetime.capturedAt, m.lifetime.publicationValidUntil, m.lifetime.sourceRetentionCeiling].every(at)
    || typeof m.contextJson !== "string" || !m.contextJson || utf8(m.contextJson).length > 16384) return fail();
  const parsedContext = JSON.parse(m.contextJson);
  if (!parsedContext || typeof parsedContext !== "object" || Array.isArray(parsedContext)) return fail();
  const captured = Date.parse(m.lifetime.capturedAt), enrolled = Date.parse(m.enrollment.enrolled_at), expiry = Date.parse(m.enrollment.expires_at);
  const lease = Date.parse(m.lifetime.publicationValidUntil), ceiling = Date.parse(m.lifetime.sourceRetentionCeiling);
  if (enrolled > captured || captured >= lease || lease - captured > 60000 || lease > ceiling || ceiling > expiry) return fail();
  const stream = "creative:" + m.enrollment.owner_user_id;
  const validSourceTime = (recorded: string, limit: string, enrollmentFloor = m.mode === "extractive") => at(recorded) && at(limit)
    && (!enrollmentFloor || Date.parse(recorded) >= enrolled)
    && Date.parse(recorded) <= captured && Date.parse(limit) > captured && Date.parse(limit) <= expiry
    && Date.parse(limit) <= Date.parse(recorded) + m.enrollment.retention_days * 86400000;
  const events = new Set<string>(), contents = new Set<string>();
  let previous = 0, earliest = expiry;
  if (m.mode === "extractive") {
    if (!Array.isArray(m.dependencies) || m.dependencies.length < 1 || m.dependencies.length > 128) return fail();
    const turns = new Set<string>(), groups = new Map<number, Dependency[]>(); let consumed = 0;
    for (const [ordinal, row] of m.dependencies.entries()) {
      if (!keys(row, dependencyKeys) || row.ordinal !== ordinal || row.event_stream_id !== stream || !id(row.event_id)
        || events.has(row.event_id) || !integer(row.source_sequence, previous + 1, m.enrollment.cursor_sequence)
        || !sourceTypes.has(row.event_type) || !digest(row.projection_sha256) || row.block_id !== null && !id(row.block_id)
        || !integer(row.consumed, 0, 1) || !validSourceTime(row.recorded_at, row.source_retention_ceiling)) return fail();
      previous = row.source_sequence; events.add(row.event_id); earliest = Math.min(earliest, Date.parse(row.source_retention_ceiling)); consumed += row.consumed;
      if (row.event_type === "AssistantReasoned") {
        if (!id(row.turn_id) || turns.has(row.turn_id) || !id(row.user_content_id) || !id(row.assistant_content_id)
          || row.user_content_id === row.assistant_content_id) return fail();
        turns.add(row.turn_id); contents.add(row.user_content_id); contents.add(row.assistant_content_id);
      } else if ([row.turn_id, row.user_content_id, row.assistant_content_id].some(item => item !== null)) return fail();
      if (row.segment_enrollment_id === null) {
        if (row.consumed !== 1 || segmentKeys.some(key => row[key] !== null)) return fail();
      } else {
        if (row.event_type !== "AssistantReasoned" || row.segment_enrollment_id !== m.enrollment.enrollment_id
          || row.segment_revision !== m.enrollment.revision || row.segment_recipe !== "live-conversation-references-v1"
          || !integer(row.segment_first_sequence, 1, row.source_sequence) || !integer(row.segment_last_sequence, row.source_sequence, m.enrollment.cursor_sequence)
          || !integer(row.segment_member_count, 1, 8) || !integer(row.segment_ordinal, 0, row.segment_member_count - 1)
          || !at(row.segment_created_at) || Date.parse(row.segment_created_at) < enrolled || Date.parse(row.segment_created_at) > captured
          || !at(row.segment_retention_ceiling) || Date.parse(row.segment_retention_ceiling) < Date.parse(row.source_retention_ceiling)) return fail();
        const group = groups.get(row.segment_first_sequence) ?? []; group.push(row); groups.set(row.segment_first_sequence, group);
      }
    }
    if (consumed < 1 || consumed > 64 || groups.size > 8) return fail();
    let last = 0;
    for (const [first, rows] of [...groups].sort(([left], [right]) => left - right)) {
      const head = rows[0];
      if (first <= last || rows.length !== head.segment_member_count || rows[0].source_sequence !== first
        || rows.at(-1)!.source_sequence !== head.segment_last_sequence || !rows.some(row => row.consumed === 1)) return fail();
      for (const [ordinal, row] of rows.entries()) if (row.segment_ordinal !== ordinal
        || segmentKeys.some(key => key !== "segment_ordinal" && row[key] !== head[key])) return fail();
      last = head.segment_last_sequence!;
    }
  } else {
    if (!keys(m.projectionOptions, ["maxBytes", "specifiedMaxBytes"]) || !integer(m.projectionOptions.maxBytes, 1, 16384)
      || typeof m.projectionOptions.specifiedMaxBytes !== "boolean" || !m.projectionOptions.specifiedMaxBytes && m.projectionOptions.maxBytes !== 16384
      || !keys(m.ledgerHead, ["ledgerId", "revision", "bodyRef", "bodyHash"]) || !digest(m.ledgerHead.ledgerId) || !digest(m.ledgerHead.bodyHash)
      || !id(m.ledgerHead.bodyRef) || !integer(m.ledgerHead.revision, 1, 64)
      || !Array.isArray(m.originals) || m.originals.length < 2 || m.originals.length > 128 || m.originals.length % 2 !== 0
      || !Array.isArray(m.ledgerRevisions) || m.ledgerRevisions.length !== m.ledgerHead.revision
      || !Array.isArray(m.intervals) || m.intervals.length < 1 || m.intervals.length > 32) return fail();
    for (const interval of m.intervals) {
      if (!keys(interval, ["afterSequence", "throughSequence"]) || !integer(interval.afterSequence, 0, m.job.sourceHead - 1)
        || !integer(interval.throughSequence, interval.afterSequence + 1, m.job.sourceHead)) return fail();
    }
    const pairs = new Map<string, Original[]>();
    for (const [ordinal, row] of m.originals.entries()) {
      if (!keys(row, originalKeys) || row.ordinal !== ordinal || row.event_stream_id !== stream || ![row.event_id, row.turn_id, row.content_id].every(id)
        || events.has(row.event_id) || contents.has(row.content_id) || !integer(row.source_sequence, previous + 1, m.job.sourceHead)
        || row.role !== "user" && row.role !== "assistant" || row.event_type !== (row.role === "user" ? "ChatMessageSent" : "AssistantReasoned")
        || !digest(row.content_sha256) || !digest(row.projection_sha256)
        || !validSourceTime(row.recorded_at, row.source_retention_ceiling, row.retained_by_ledger === 1)
        || !integer(row.retained_by_ledger, 0, 1) || !integer(row.presented_in_context, 0, 1)
        || !m.intervals.some(interval => row.source_sequence > interval.afterSequence && row.source_sequence <= interval.throughSequence)) return fail();
      previous = row.source_sequence; events.add(row.event_id); contents.add(row.content_id);
      earliest = Math.min(earliest, Date.parse(row.source_retention_ceiling));
      const pair = pairs.get(row.turn_id) ?? []; pair.push(row); pairs.set(row.turn_id, pair);
    }
    if (!m.originals.some(row => row.retained_by_ledger === 1) || [...pairs.values()].some(pair => pair.length !== 2
      || pair[0].role !== "user" || pair[1].role !== "assistant")) return fail();
    let predecessor: Revision | undefined;
    for (const [ordinal, row] of m.ledgerRevisions.entries()) {
      if (!keys(row, revisionKeys) || row.ordinal !== ordinal || row.ledger_id !== m.ledgerHead.ledgerId
        || row.storage_revision !== ordinal + 1 || row.predecessor_revision !== ordinal || row.predecessor_hash !== (predecessor?.body_hash ?? null)
        || !id(row.body_ref) || contents.has(row.body_ref) || !digest(row.body_hash) || !at(row.created_at) || !at(row.expires_at)
        || Date.parse(row.created_at) > captured || Date.parse(row.created_at) >= Date.parse(row.expires_at)
        || Date.parse(row.expires_at) <= captured
        || predecessor && Date.parse(row.created_at) < Date.parse(predecessor.created_at)) return fail();
      contents.add(row.body_ref); earliest = Math.min(earliest, Date.parse(row.expires_at)); predecessor = row;
    }
    if (predecessor?.body_ref !== m.ledgerHead.bodyRef || predecessor.body_hash !== m.ledgerHead.bodyHash) return fail();
  }
  // Structured live custody can shorten the aggregate below its declared row
  // expiries. Only genuine replay proves that exact saved ceiling; this pure
  // codec must not reject a conservative earlier deadline or renew it.
  if (m.mode === "extractive" ? earliest !== ceiling : earliest < ceiling) return fail();
  return m;
}

function selectorSet(manifest: DocumentJobOriginManifest): DocumentJobOriginSelector[] {
  const unique = new Map<string, DocumentJobOriginSelector>();
  const add = (resource_kind: DocumentJobOriginSelector["resource_kind"], resource_id: string | null) => {
    if (resource_id !== null) unique.set(JSON.stringify([resource_kind, resource_id]), {resource_kind, resource_id});
  };
  add("enrollment", manifest.enrollment.enrollment_id);
  if (manifest.mode === "extractive") for (const row of manifest.dependencies) {
    add("event", row.event_id); add("private-content", row.user_content_id); add("private-content", row.assistant_content_id);
  } else {
    for (const row of manifest.originals) { add("event", row.event_id); add("private-content", row.content_id); }
    for (const row of manifest.ledgerRevisions) { add("ledger", row.ledger_id); add("private-content", row.body_ref); }
  }
  if (unique.size > 513) return fail();
  return [...unique.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, value]) => value);
}
async function sha256(text: string): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", utf8(text) as BufferSource);
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function material(value: unknown, exactText?: string): Promise<DocumentJobOriginManifestMaterial | null> {
  try {
    const owned = own(value), text = JSON.stringify(owned);
    if (utf8(text).length > 65536 || exactText !== undefined && text !== exactText) return null;
    const manifest = validate(owned), selectors = selectorSet(manifest);
    // Dedicated bounded serialization: the old native canonical helper permits
    // only 256 array members, while this independently validated set permits 513.
    const selectorJson = JSON.stringify(selectors);
    if (utf8(selectorJson).length > 65536 || await sha256(manifest.contextJson) !== manifest.consumedValueSha256) return null;
    const [hash, selectorHash] = await Promise.all([sha256(text), sha256(selectorJson)]);
    return Object.freeze({text, sha256: hash, selectors: Object.freeze(selectors.map(row => Object.freeze(row))), selectorListSha256: selectorHash});
  } catch { return null; }
}

/** Pure comparison-data codec, NOT a native capture or permission to publish.
 * The writer must derive every input from genuine private frames, separately
 * assert job/source/custody authority, and bind the exact header/output footprint.
 * This codec never stores operational enrollment lease tokens or raw ledger rows. */
export function encodeDocumentJobOriginManifest(value: unknown): Promise<DocumentJobOriginManifestMaterial | null> { return material(value); }

/** Historical publication leases may be past. Decoding never refreshes them or
 * grants access: GET/recovery require independent fresh original-source replay. */
export async function decodeDocumentJobOriginManifest(text: unknown): Promise<DocumentJobOriginManifestMaterial | null> {
  try {
    if (typeof text !== "string" || text.length > 65536 || !text.isWellFormed() || utf8(text).length > 65536) return null;
    return await material(JSON.parse(text), text);
  } catch { return null; }
}
