import { beginMemoryPrivacyMutation } from './memory-privacy-mutation.ts';
/** Pure HTTP boundary. No server imports, persistence, enrollment side effects, or retries. */
import { parseMemoryCustody, type MemoryCustody } from "../model/memory-custody.ts";
import { createMemoryElapsed, memoryTimestamp, parseMemoryLifetime, type MemoryClockSample,
  type MemoryRecallLifetime } from "../model/memory-lifetime.ts";
import { rollingLiveMemoryConsumption, type LiveMemoryConsumption } from "../model/memory-observations.ts";
import { MEMORY_ASSISTED_OUTCOMES_VERSION, parseMemoryAssistedOutcomes, type MemoryAssistedOutcomes } from "../model/memory-assisted-outcomes.ts";
import { MEMORY_SAVED_OUTPUTS_VERSION, parseMemorySavedOutputs, type MemorySavedOutputs } from "../model/memory-saved-outputs.ts";
import { MEMORY_CONSUMPTION_EPISODES_VERSION, parseMemoryConsumptionEpisodes, type MemoryConsumptionEpisodes } from "../model/memory-consumption-episodes.ts";
import { MEMORY_CONSUMPTION_V2, MEMORY_CONSUMPTION_V3, MEMORY_CONSUMPTION_V4, MEMORY_CONSUMPTION_V5, MEMORY_CONSUMPTION_V6, parseMemoryConsumptionV2, parseMemoryConsumptionV3, parseMemoryConsumptionV4, parseMemoryConsumptionV5, parseMemoryConsumptionV6, type MemoryConsumptionV2 } from "../model/memory-consumption-v2.ts";
export { MEMORY_WRITE_CONTRACT } from "../model/memory-custody.ts";
export type { MemoryCustody } from "../model/memory-custody.ts";

export const MEMORY_POLICY = "personal-memory-v2" as const;
export const MEMORY_TIMING = "daily-with-daytime-catch-up" as const;

export type MemoryReviewContract = {
  timing: typeof MEMORY_TIMING;
  preferredLocalWindow: { startHour: 1; endHour: 5 };
  freshDaytimeCatchUpAllowed: true;
  savedPagesMayContinueOutsideWindow: true;
  strictlyOvernight: false;
  deliverySlaVerified: false;
};

/** Observed native structured-ledger state, not a mutation receipt or current consent. */
export type MemoryStructuredCleanup =
  | { scopeKey: null; state: "unreported" }
  | { scopeKey: string; state: "absent" | "active" | "pending" | "complete" };

export type MemoryEnrollment = {
  id: string; projectId: string; documentId: string; organizationId: string | null;
  revision: number; learn: boolean; recall: boolean; background: boolean;
  retentionDays: number; timeZone: string; expiresAt: string;
  /** Older policy tombstones must remain manageable; this is not activation evidence. */
  policyVersion: string;
  lastAdmittedAt: string | null; throughSequence: number; cutoffSequence: number | null;
  backlog: boolean; nextDueAt: string; attempts: number; status: string;
  /** Missing on legacy responses is unreported, never evidence of completed cleanup. */
  structuredCleanup?: MemoryStructuredCleanup;
};

export type MemorySettings = {
  /** Deployment admission only, not consent or scheduling qualification. */
  enabled: boolean; policyVersion: typeof MEMORY_POLICY; reviewContract: MemoryReviewContract;
  /** Unknown or absent write contracts do not prevent actor-owned inspection and erasure. */
  writeContractVersion: string | null;
  enrollments: MemoryEnrollment[]; nextAfter: string | null;
};

export type MemoryPreferences = {
  projectId: string; documentId: string; learn: boolean; recall: boolean; background: boolean;
  retentionDays: number; timeZone: string; expiresAt: string; revision: number;
  confirmation: "ENABLE_PERSONAL_MEMORY"; policyVersion: typeof MEMORY_POLICY;
  /** The caller's explicit consent snapshot, never inferred from an enrollment or response. */
  expectedCustody: MemoryCustody;
  /** Required when background is true. The client never supplies consent for its caller. */
  reviewTiming?: typeof MEMORY_TIMING;
};

export type MemorySaveResult = {
  enrollment: MemoryEnrollment; reviewContract: MemoryReviewContract;
  historyStartsAt: string; priorMemoryCleared: boolean; uiChanged: false;
};

export type MemoryForgetResult =
  | { erased: true; reEnrollmentRequired: true; otherDevicesAndBackupsPurged: false }
  | { erased: false; memoryWithdrawn: true; physicalCleanupPending: true;
      reEnrollmentRequired: true; otherDevicesAndBackupsPurged: false };

export type MemoryExcerpt = { sourceEventId: string; recordedAt: string; user: string; assistant: string };
export type MemorySource = { eventId: string; type: string; blockId: string | null; recordedAt: string; validUntil: string };
export type MemoryRecall = {
  mode: "live-reference-memory";
  lifetime: MemoryRecallLifetime;
  scope: { organizationId: string | null; projectId: string; documentId: string };
  treatment: "untrusted-historical-evidence"; method: "extractive-not-semantic";
  consumption: Record<string, number>;
  /** Absent on older responses; never interpreted as zero activity or complete history. */
  rollingConsumption?: LiveMemoryConsumption;
  /** Optional certified assisted decisions, never independent preference evidence. */
  assistedOutcomes?: MemoryAssistedOutcomes;
  savedOutputs?: MemorySavedOutputs;
  /** Explicit inspector opt-in only; absent is unavailable, not a zero history. */
  consumptionEpisodes?: MemoryConsumptionEpisodes | MemoryConsumptionV2;
  rollingConversation: { summary: MemoryExcerpt[]; recent: MemoryExcerpt[]; completeFromStart: false };
  coverage: {
    since: string; throughSequence: number; remainingThroughSequence: number | null;
    bounded: true; sourceCount: number;
  };
  sources: MemorySource[]; note: string;
};
/** A local display lease, separate from the wire value; retirement cannot be undone. */
export type MemoryRecallLease = Readonly<{ value: MemoryRecall; remaining: () => number; retire: () => void }>;
export type MemoryRecallOptions = Readonly<{ consumptionEpisodes?: boolean | typeof MEMORY_CONSUMPTION_V2 | typeof MEMORY_CONSUMPTION_V3 | typeof MEMORY_CONSUMPTION_V4 | typeof MEMORY_CONSUMPTION_V5 | typeof MEMORY_CONSUMPTION_V6 }>;

export class MemoryClientError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly mutationUnknown: boolean;

  constructor(code: string, status: number | null = null, mutationUnknown = false) {
    super(mutationUnknown ? "The memory change could not be confirmed. Reload before trying again."
      : code === "memory_revision_changed" || code === "memory_authority_or_revision_changed" || code === "memory_custody_changed"
        ? "Memory changed. Reload before trying again."
        : code === "memory_request_cancelled" ? "The memory request was canceled."
          : "The memory request could not be completed.");
    this.name = "MemoryClientError";
    this.code = code; this.status = status; this.mutationUnknown = mutationUnknown;
  }
}

type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ObjectValue = Record<string, unknown>;
const SETTINGS_PATH = "/api/memory/settings";
const RECALL_PATH = "/api/memory/recall";
const EXPORT_PATH = "/api/memory/export";
const RESPONSE_BYTE_LIMIT = 131_072;
const EXPORT_BYTE_LIMIT = 65_536;
const ENROLLMENT_ID = /^[a-f0-9]{64}$/u;
const NOTE = "Observed actions are not inferred preferences; excerpts are truncated and access-filtered.";
const ENROLLMENT_KEYS = ["id", "projectId", "documentId", "organizationId", "revision", "learn", "recall", "background",
  "retentionDays", "timeZone", "expiresAt", "policyVersion", "lastAdmittedAt", "throughSequence", "cutoffSequence",
  "backlog", "nextDueAt", "attempts", "status"];
const PREFERENCE_KEYS = ["projectId", "documentId", "learn", "recall", "background", "retentionDays", "timeZone",
  "expiresAt", "revision", "confirmation", "policyVersion", "expectedCustody", "reviewTiming"];
const ACTIONS = new Set(["encounter", "inspect", "compare", "edit", "commit", "reuse", "remove", "restore", "critique",
  "request", "accept", "reject", "defer", "conversation"]);
// This is the sealed live-export source subset, not the broader observation vocabulary.
const EXPORT_ACTIONS = {
  DocumentOpened: "encounter", DocumentRenamed: "edit", DocumentViewVisited: "encounter", ObjectViewed: "inspect", DocumentArtifactViewed: "inspect",
  ComparisonOpened: "compare", BlockCreated: "edit", BlockRenamed: "edit", BlockPropertyEdited: "edit", ChipEdited: "edit", BlockWeightSet: "edit",
  BlockLocked: "edit", BlockUnlocked: "edit", BlockRelationAdded: "edit", BlockRelationRemoved: "edit",
  BlockRemoved: "remove", BlockRestored: "restore", ObjectSaved: "commit", ObjectPinned: "commit", ObjectExported: "commit",
  DocumentArtifactExported: "commit", ArtifactApproved: "commit", CanvasItemPlaced: "reuse", CanvasReferenceCreated: "reuse",
  ContextSetFormalized: "reuse", ObjectDiscarded: "reject", ObjectCritiqued: "critique", ArtifactChangesRequested: "critique",
  ArtifactReviewRequested: "request", GenerationRequested: "request", DocumentRenderRequested: "request", ProposalAccepted: "accept",
  ProposalRejected: "reject", ProposalDeclined: "defer", BriefItemAccepted: "accept", BriefItemIgnored: "defer", BriefDismissed: "defer",
  AssistantReasoned: "conversation",
} as const;
const ERROR_CODES = new Set(["authentication_required", "principal_account_required", "consent_required", "pilot_consent_required",
  "memory_schema_unavailable", "memory_id_required", "memory_revision_required", "memory_not_found", "memory_disabled", "memory_unavailable", "memory_export_unavailable", "memory_consumption_version_unsupported",
  "method_not_allowed", "same_origin_required", "memory_request_too_large", "invalid_memory_request",
  "explicit_memory_erasure_required", "memory_revision_changed", "explicit_memory_preferences_required",
  "explicit_memory_custody_required", "invalid_memory_custody", "memory_custody_changed",
  "explicit_memory_review_timing_required", "invalid_memory_expiry", "invalid_memory_timezone",
  "memory_background_authority_unavailable", "memory_authority_or_revision_changed", "context_scope_required",
  "context_project_denied", "context_project_history_unavailable", "context_document_denied", "context_custody_unavailable"]);

function check(condition: unknown): asserts condition { if (!condition) throw new Error("invalid-memory-contract"); }
function object(value: unknown): ObjectValue {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null);
  return value as ObjectValue;
}
function keys(value: ObjectValue, allowed: readonly string[], required: readonly string[] = allowed) {
  check(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)));
}
function text(value: unknown, max = 120, empty = false): string {
  check(typeof value === "string" && (empty || value.length > 0) && value.length <= max);
  return value;
}
function id(value: unknown): string { const result = text(value, 64); check(ENROLLMENT_ID.test(result)); return result; }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  check(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max); return value;
}
function bool(value: unknown): boolean { check(typeof value === "boolean"); return value; }
function date(value: unknown): string {
  const result = text(value, 40); const timestamp = Date.parse(result);
  check(Number.isFinite(timestamp) && new Date(timestamp).toISOString() === result); return result;
}
function zone(value: unknown): string {
  const result = text(value, 80); new Intl.DateTimeFormat("en-US", { timeZone: result }).format(); return result;
}
function nullableText(value: unknown, max = 120): string | null { return value === null ? null : text(value, max); }
function nullableDate(value: unknown): string | null { return value === null ? null : date(value); }
function nullableSequence(value: unknown, min = 0): number | null { return value === null ? null : integer(value, min); }

function review(value: unknown): MemoryReviewContract {
  const row = object(value);
  keys(row, ["timing", "preferredLocalWindow", "freshDaytimeCatchUpAllowed", "savedPagesMayContinueOutsideWindow", "strictlyOvernight", "deliverySlaVerified"]);
  const window = object(row.preferredLocalWindow); keys(window, ["startHour", "endHour"]);
  check(row.timing === MEMORY_TIMING && window.startHour === 1 && window.endHour === 5
    && row.freshDaytimeCatchUpAllowed === true && row.savedPagesMayContinueOutsideWindow === true
    && row.strictlyOvernight === false && row.deliverySlaVerified === false);
  return { timing: MEMORY_TIMING, preferredLocalWindow: { startHour: 1, endHour: 5 },
    freshDaytimeCatchUpAllowed: true, savedPagesMayContinueOutsideWindow: true, strictlyOvernight: false, deliverySlaVerified: false };
}

function structuredCleanup(value: unknown): MemoryStructuredCleanup {
  const row = object(value); keys(row, ["scopeKey", "state"]);
  if (row.state === "unreported") { check(row.scopeKey === null); return { scopeKey: null, state: "unreported" }; }
  check(row.state === "absent" || row.state === "active" || row.state === "pending" || row.state === "complete");
  return { scopeKey: id(row.scopeKey), state: row.state };
}

function enrollment(value: unknown): MemoryEnrollment {
  const row = object(value); keys(row, [...ENROLLMENT_KEYS, "structuredCleanup"], ENROLLMENT_KEYS);
  const through = integer(row.throughSequence), cutoff = nullableSequence(row.cutoffSequence, through);
  check(row.backlog === (cutoff !== null));
  if (row.status === "forgotten" || row.status === "revoked" || row.status === "erased")
    check(row.learn === false && row.recall === false && row.background === false);
  return { id: id(row.id), projectId: text(row.projectId), documentId: text(row.documentId), organizationId: nullableText(row.organizationId),
    revision: integer(row.revision, 1), learn: bool(row.learn), recall: bool(row.recall), background: bool(row.background),
    retentionDays: integer(row.retentionDays, 1, 365), timeZone: zone(row.timeZone), expiresAt: date(row.expiresAt),
    policyVersion: text(row.policyVersion, 80), lastAdmittedAt: nullableDate(row.lastAdmittedAt), throughSequence: through,
    cutoffSequence: cutoff, backlog: cutoff !== null, nextDueAt: date(row.nextDueAt), attempts: integer(row.attempts), status: text(row.status),
    ...(Object.hasOwn(row, "structuredCleanup") ? { structuredCleanup: structuredCleanup(row.structuredCleanup) } : {}) };
}

function preferences(value: unknown): MemoryPreferences {
  const row = object(value); keys(row, PREFERENCE_KEYS, PREFERENCE_KEYS.filter(key => key !== "reviewTiming"));
  check(row.confirmation === "ENABLE_PERSONAL_MEMORY" && row.policyVersion === MEMORY_POLICY);
  const expectedCustody = parseMemoryCustody(row.expectedCustody); check(expectedCustody !== null);
  const background = bool(row.background);
  const hasTiming = Object.hasOwn(row, "reviewTiming");
  check(!hasTiming || row.reviewTiming === undefined || row.reviewTiming === MEMORY_TIMING);
  check(!background || hasTiming && row.reviewTiming === MEMORY_TIMING);
  const expiresAt = date(row.expiresAt), now = Date.now(), expiry = Date.parse(expiresAt);
  check(expiry > now && expiry <= now + 365 * 86_400_000);
  const result: MemoryPreferences = { projectId: text(row.projectId), documentId: text(row.documentId), learn: bool(row.learn),
    recall: bool(row.recall), background, retentionDays: integer(row.retentionDays, 1, 365), timeZone: zone(row.timeZone), expiresAt,
    revision: integer(row.revision, 0, Number.MAX_SAFE_INTEGER - 1), confirmation: "ENABLE_PERSONAL_MEMORY", policyVersion: MEMORY_POLICY,
    expectedCustody };
  if (hasTiming && row.reviewTiming !== undefined) result.reviewTiming = MEMORY_TIMING;
  check(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 4096);
  return result;
}

function settings(value: unknown, after?: string): MemorySettings {
  const row = object(value); keys(row, ["enabled", "policyVersion", "reviewContract", "writeContractVersion", "enrollments", "nextAfter"],
    ["enabled", "policyVersion", "reviewContract", "enrollments", "nextAfter"]);
  const writeContractVersion = row.writeContractVersion === undefined || row.writeContractVersion === null
    ? null : text(row.writeContractVersion, RESPONSE_BYTE_LIMIT, true);
  check(row.policyVersion === MEMORY_POLICY && Array.isArray(row.enrollments) && row.enrollments.length <= 50);
  const enrollments = row.enrollments.map(enrollment);
  let previous = after ?? "";
  const cleanupStates = new Map<string, { state: MemoryStructuredCleanup["state"]; scope: string }>();
  for (const item of enrollments) {
    check(item.id > previous); previous = item.id;
    const cleanup = item.structuredCleanup;
    if (cleanup?.scopeKey) {
      const scope = JSON.stringify([item.organizationId, item.projectId, item.documentId]), previousCleanup = cleanupStates.get(cleanup.scopeKey);
      check(!previousCleanup || previousCleanup.state === cleanup.state && previousCleanup.scope === scope);
      cleanupStates.set(cleanup.scopeKey, { state: cleanup.state, scope });
    }
  }
  const nextAfter = row.nextAfter === null ? null : id(row.nextAfter);
  check(nextAfter === null || enrollments.length === 50 && nextAfter === previous && nextAfter > (after ?? ""));
  return { enabled: bool(row.enabled), policyVersion: MEMORY_POLICY, reviewContract: review(row.reviewContract), writeContractVersion, enrollments, nextAfter };
}

function saved(value: unknown, request: MemoryPreferences): MemorySaveResult {
  const row = object(value); keys(row, ["enrollment", "reviewContract", "historyStartsAt", "priorMemoryCleared", "uiChanged"]);
  const item = enrollment(row.enrollment);
  check(item.projectId === request.projectId && item.documentId === request.documentId && item.revision === request.revision + 1
    && item.organizationId === (request.expectedCustody.kind === "personal" ? null : request.expectedCustody.organizationId)
    && item.policyVersion === request.policyVersion && item.learn === request.learn && item.recall === request.recall
    && item.background === request.background && item.retentionDays === request.retentionDays && item.timeZone === request.timeZone
    && item.expiresAt === request.expiresAt && row.uiChanged === false);
  const priorMemoryCleared = bool(row.priorMemoryCleared);
  check(item.structuredCleanup?.state !== "pending" || !priorMemoryCleared);
  return { enrollment: item, reviewContract: review(row.reviewContract), historyStartsAt: date(row.historyStartsAt),
    priorMemoryCleared, uiChanged: false };
}

function forgotten(value: unknown): MemoryForgetResult {
  const row = object(value);
  check(row.reEnrollmentRequired === true && row.otherDevicesAndBackupsPurged === false);
  if (row.erased === false) {
    keys(row, ["erased", "memoryWithdrawn", "physicalCleanupPending", "reEnrollmentRequired", "otherDevicesAndBackupsPurged"]);
    check(row.memoryWithdrawn === true && row.physicalCleanupPending === true);
    return { erased: false, memoryWithdrawn: true, physicalCleanupPending: true,
      reEnrollmentRequired: true, otherDevicesAndBackupsPurged: false };
  }
  keys(row, ["erased", "reEnrollmentRequired", "otherDevicesAndBackupsPurged"]);
  check(row.erased === true);
  return { erased: true, reEnrollmentRequired: true, otherDevicesAndBackupsPurged: false };
}

function rollingConsumption(value: unknown, sources: MemorySource[], lifetime: MemoryRecallLifetime, since: string, retentionDays: number): LiveMemoryConsumption {
  const expected = rollingLiveMemoryConsumption(sources, lifetime, since, retentionDays), row = object(value);
  keys(row, ["version", "basis", "completeFromStart", "sourceLimit", "sourceLimitReached", "windows"]);
  check(row.version === expected.version && row.basis === expected.basis && row.completeFromStart === false
    && row.sourceLimit === 64 && row.sourceLimitReached === expected.sourceLimitReached);
  check(Array.isArray(row.windows) && row.windows.length === expected.windows.length);
  const counts = (value: unknown, wanted: LiveMemoryConsumption["windows"][number]["document"], block = false) => {
    const group = object(value); keys(group, block ? ["sourceIndex", "actions", "sourceIndexes"] : ["actions", "sourceIndexes"]);
    const actions = object(group.actions); keys(actions, Object.keys(wanted.actions));
    for (const [action, count] of Object.entries(wanted.actions)) check(actions[action] === count);
    check(Array.isArray(group.sourceIndexes) && group.sourceIndexes.length === wanted.sourceIndexes.length
      && group.sourceIndexes.every((index, position) => index === wanted.sourceIndexes[position]));
    return group;
  };
  row.windows.forEach((value, position) => {
    const window = object(value), wanted = expected.windows[position]; keys(window, ["windowDays", "since", "document", "blocks"]);
    check(window.windowDays === wanted.windowDays && window.since === wanted.since);
    counts(window.document, wanted.document);
    check(Array.isArray(window.blocks) && window.blocks.length === wanted.blocks.length);
    window.blocks.forEach((value, index) => { const group = counts(value, wanted.blocks[index], true); check(group.sourceIndex === wanted.blocks[index].sourceIndex); });
  });
  // Return newly derived counts/references, never the response's mutable asserted aggregate.
  return expected;
}

function consumptionChoice(value: MemoryRecallOptions | undefined): false | typeof MEMORY_CONSUMPTION_EPISODES_VERSION | typeof MEMORY_CONSUMPTION_V2 | typeof MEMORY_CONSUMPTION_V3 | typeof MEMORY_CONSUMPTION_V4 | typeof MEMORY_CONSUMPTION_V5 | typeof MEMORY_CONSUMPTION_V6 {
  if (value === undefined) return false;
  check(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype);
  const names = Reflect.ownKeys(value);
  check(names.length <= 1 && names.every(name => name === "consumptionEpisodes"));
  if (names.length === 0) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "consumptionEpisodes");
  check(descriptor?.enumerable && Object.hasOwn(descriptor, "value") && (typeof descriptor.value === "boolean" || descriptor.value === MEMORY_CONSUMPTION_V2 || descriptor.value === MEMORY_CONSUMPTION_V3 || descriptor.value === MEMORY_CONSUMPTION_V4 || (descriptor.value === MEMORY_CONSUMPTION_V5 || descriptor.value === MEMORY_CONSUMPTION_V6)));
  return descriptor.value === true ? MEMORY_CONSUMPTION_EPISODES_VERSION : descriptor.value;
}

function recall(value: unknown, request: MemoryEnrollment, includeConsumption: ReturnType<typeof consumptionChoice>): MemoryRecall {
  const required = ["mode", "lifetime", "scope", "treatment", "method", "consumption", "rollingConversation", "coverage", "sources", "note"];
  const row = object(value); keys(row, [...required, "rollingConsumption", "assistedOutcomes", "savedOutputs", "consumptionEpisodes"], required);
  check(includeConsumption || !Object.hasOwn(row, "consumptionEpisodes"));
  const lifetime = parseMemoryLifetime(row.lifetime); check(lifetime !== null);
  const checkedAt = memoryTimestamp(lifetime.checkedAt)!, validUntil = memoryTimestamp(lifetime.validUntil)!;
  const enrollmentExpiry = memoryTimestamp(request.expiresAt); check(enrollmentExpiry !== null && validUntil <= enrollmentExpiry);
  check(row.mode === "live-reference-memory" && row.treatment === "untrusted-historical-evidence"
    && row.method === "extractive-not-semantic" && row.note === NOTE);
  const scope = object(row.scope); keys(scope, ["organizationId", "projectId", "documentId"]);
  check(scope.organizationId === request.organizationId && scope.projectId === request.projectId && scope.documentId === request.documentId);
  check(Array.isArray(row.sources) && row.sources.length <= 64);
  const sources: MemorySource[] = row.sources.map(value => {
    const source = object(value); keys(source, ["eventId", "type", "blockId", "recordedAt", "validUntil"]);
    const recordedAt = date(source.recordedAt), sourceUntil = date(source.validUntil);
    const recorded = memoryTimestamp(recordedAt), until = memoryTimestamp(sourceUntil);
    check(recorded !== null && recorded <= checkedAt && until !== null && until > checkedAt
      && until <= enrollmentExpiry && validUntil <= until);
    return { eventId: text(source.eventId, 512), type: text(source.type), blockId: nullableText(source.blockId, 512), recordedAt, validUntil: sourceUntil };
  });
  const sourceMap = new Map(sources.map(source => [source.eventId, source])); check(sourceMap.size === sources.length);
  const assistedOutcomes = Object.hasOwn(row, "assistedOutcomes")
    ? parseMemoryAssistedOutcomes(row.assistedOutcomes, sources, lifetime) : undefined;
  check(assistedOutcomes !== null);
  const savedOutputs = Object.hasOwn(row, "savedOutputs")
    ? parseMemorySavedOutputs(row.savedOutputs, sources, lifetime) : undefined;
  check(savedOutputs !== null);
  const consumptionEpisodes = Object.hasOwn(row, "consumptionEpisodes")
    ? includeConsumption === MEMORY_CONSUMPTION_V2 || includeConsumption === MEMORY_CONSUMPTION_V3 || includeConsumption === MEMORY_CONSUMPTION_V4 || (includeConsumption === MEMORY_CONSUMPTION_V5 || includeConsumption === MEMORY_CONSUMPTION_V6) ? (includeConsumption === MEMORY_CONSUMPTION_V6 ? parseMemoryConsumptionV6 : includeConsumption === MEMORY_CONSUMPTION_V5 ? parseMemoryConsumptionV5 : includeConsumption === MEMORY_CONSUMPTION_V4 ? parseMemoryConsumptionV4 : includeConsumption === MEMORY_CONSUMPTION_V3 ? parseMemoryConsumptionV3 : parseMemoryConsumptionV2)(row.consumptionEpisodes, lifetime, request.documentId,
      { since: String(object(row.coverage).since), expiresAt: request.expiresAt })
      : parseMemoryConsumptionEpisodes(row.consumptionEpisodes, sources, lifetime, request.documentId) : undefined;
  check(consumptionEpisodes !== null);
  const rawCounts = object(row.consumption); check(Object.keys(rawCounts).every(key => ACTIONS.has(key)));
  const consumption: Record<string, number> = Object.fromEntries(Object.entries(rawCounts).map(([key, count]) => [key, integer(count, 1, 64)] as const));
  check(Object.values(consumption).reduce((sum, count) => sum + count, 0) <= sources.length);
  const rolling = object(row.rollingConversation); keys(rolling, ["summary", "recent", "completeFromStart"]);
  check(rolling.completeFromStart === false && Array.isArray(rolling.summary) && Array.isArray(rolling.recent)
    && rolling.summary.length <= 6 && rolling.recent.length <= 2 && (rolling.summary.length === 0 || rolling.recent.length === 2));
  const seen = new Set<string>();
  const excerpt = (value: unknown): MemoryExcerpt => {
    const item = object(value); keys(item, ["sourceEventId", "recordedAt", "user", "assistant"]);
    const sourceEventId = text(item.sourceEventId, 512), recordedAt = date(item.recordedAt), source = sourceMap.get(sourceEventId);
    check(source?.type === "AssistantReasoned" && source.recordedAt === recordedAt && !seen.has(sourceEventId)); seen.add(sourceEventId);
    const user = text(item.user, 1024, true), assistant = text(item.assistant, 1024, true);
    check(Array.from(user).length <= 512 && Array.from(assistant).length <= 512);
    return { sourceEventId, recordedAt, user, assistant };
  };
  const summary = rolling.summary.map(excerpt), recent = rolling.recent.map(excerpt);
  const coverage = object(row.coverage); keys(coverage, ["since", "throughSequence", "remainingThroughSequence", "bounded", "sourceCount"]);
  const throughSequence = integer(coverage.throughSequence), since = date(coverage.since);
  check(coverage.bounded === true && coverage.sourceCount === sources.length);
  return { mode: "live-reference-memory", lifetime, scope: { organizationId: request.organizationId, projectId: request.projectId, documentId: request.documentId },
    treatment: "untrusted-historical-evidence", method: "extractive-not-semantic", consumption,
    ...(assistedOutcomes ? { assistedOutcomes } : {}),
    ...(savedOutputs ? { savedOutputs } : {}),
    ...(consumptionEpisodes ? { consumptionEpisodes } : {}),
    ...(Object.hasOwn(row, "rollingConsumption") ? { rollingConsumption: rollingConsumption(row.rollingConsumption, sources, lifetime, since, request.retentionDays) } : {}),
    rollingConversation: { summary, recent, completeFromStart: false },
    coverage: { since, throughSequence, remainingThroughSequence: nullableSequence(coverage.remainingThroughSequence, throughSequence),
      bounded: true, sourceCount: sources.length }, sources, note: NOTE };
}

/** Rebuild only the reference contract. Retention bounds certify no future source access. */
function referenceExport(value: unknown, request: MemoryEnrollment): string {
  const row = object(value); keys(row, ["format", "capturedAt", "enrollment", "scope", "treatment", "method", "deadlineSemantics", "coverage", "sources", "includes"]);
  check(row.format === "forma-memory-reference-export-v1" && row.treatment === "untrusted-historical-evidence"
    && row.method === "descriptive-source-references" && row.deadlineSemantics === "retention-upper-bounds-not-an-access-lease");
  const instant = (value: unknown): number => { const result = memoryTimestamp(value); check(result !== null); return result; };
  const capturedAt = date(row.capturedAt), captured = instant(capturedAt), expiry = instant(request.expiresAt);
  check(captured < expiry);
  const item = object(row.enrollment); keys(item, ["id", "revision", "policyVersion", "retentionDays", "expiresAt"]);
  check(item.id === request.id && item.revision === request.revision && item.policyVersion === request.policyVersion
    && item.retentionDays === request.retentionDays && item.expiresAt === request.expiresAt);
  const scope = object(row.scope); keys(scope, ["organizationId", "projectId", "documentId"]);
  check(scope.organizationId === request.organizationId && scope.projectId === request.projectId && scope.documentId === request.documentId);
  const coverage = object(row.coverage); keys(coverage, ["since", "throughSequence", "remainingThroughSequence", "completeFromStart", "bounded", "sourceLimit", "sourceCount", "moreEligibleSources"]);
  const since = date(coverage.since), sinceTime = instant(since), throughSequence = integer(coverage.throughSequence, request.throughSequence);
  const remainingThroughSequence = nullableSequence(coverage.remainingThroughSequence, throughSequence);
  check(sinceTime <= captured && sinceTime >= captured - request.retentionDays * 86_400_000
    && coverage.completeFromStart === false && coverage.bounded === true && coverage.sourceLimit === 64);
  check(Array.isArray(row.sources) && row.sources.length <= 64 && coverage.sourceCount === row.sources.length);
  const moreEligibleSources = bool(coverage.moreEligibleSources);
  check(!moreEligibleSources || row.sources.length === 64);
  const seen = new Set<string>(); let previous = 0;
  const sources = row.sources.map(value => {
    const source = object(value); keys(source, ["eventId", "sequence", "type", "blockId", "recordedAt", "retentionExpiresAt", "action"]);
    const eventId = text(source.eventId, 512), sequence = integer(source.sequence, 1, throughSequence), type = text(source.type);
    check(!seen.has(eventId) && sequence > previous && Object.hasOwn(EXPORT_ACTIONS, type));
    const action = EXPORT_ACTIONS[type as keyof typeof EXPORT_ACTIONS]; check(source.action === action);
    const recordedAt = date(source.recordedAt), recorded = instant(recordedAt);
    const retentionExpiresAt = date(source.retentionExpiresAt), retained = instant(retentionExpiresAt);
    check(recorded >= sinceTime && recorded <= captured && retained > captured
      && retained <= expiry && retained <= recorded + request.retentionDays * 86_400_000);
    seen.add(eventId); previous = sequence;
    return { eventId, sequence, type, blockId: nullableText(source.blockId, 512), recordedAt, retentionExpiresAt, action };
  });
  check(!moreEligibleSources || sources[0].sequence > 1);
  const includes = object(row.includes); keys(includes, ["prose", "vectors", "inferredPreferences", "completeHistory"]);
  check(includes.prose === false && includes.vectors === false && includes.inferredPreferences === false && includes.completeHistory === false);
  const result = JSON.stringify({ format: "forma-memory-reference-export-v1", capturedAt,
    enrollment: { id: request.id, revision: request.revision, policyVersion: request.policyVersion, retentionDays: request.retentionDays, expiresAt: request.expiresAt },
    scope: { organizationId: request.organizationId, projectId: request.projectId, documentId: request.documentId },
    treatment: "untrusted-historical-evidence", method: "descriptive-source-references",
    deadlineSemantics: "retention-upper-bounds-not-an-access-lease",
    coverage: { since, throughSequence, remainingThroughSequence, completeFromStart: false, bounded: true, sourceLimit: 64,
      sourceCount: sources.length, moreEligibleSources }, sources,
    includes: { prose: false, vectors: false, inferredPreferences: false, completeHistory: false },
  }, null, 2) + "\n";
  check(new TextEncoder().encode(result).byteLength <= EXPORT_BYTE_LIMIT);
  return result;
}

/** Cleanup must not let a stalled or rejected underlying cancel obscure the request outcome. */
function cancelBody(body: Pick<ReadableStream<Uint8Array>, "cancel"> | null) {
  try { void body?.cancel().catch(() => undefined); } catch { /* Best-effort, without waiting or exposing errors. */ }
}

async function readJson(response: Response, signal?: AbortSignal, observe?: () => void, byteLimit = RESPONSE_BYTE_LIMIT): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null, cancelled = false;
  const cancel = () => { if (!cancelled) { cancelled = true; cancelBody(reader ?? response.body); } };
  let rejectAbort: (error: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  // An already-aborted signal may reject before the first read starts racing this promise.
  void interrupted.catch(() => undefined);
  const abort = () => { cancel(); rejectAbort(new Error("memory-request-cancelled")); };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0, result = "";
  try {
    if (signal?.aborted) { abort(); throw new Error("memory-request-cancelled"); }
    observe?.();
    check(/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""));
    check(response.body !== null);
    reader = response.body.getReader();
    for (;;) {
      const reading = reader.read();
      const chunk = await (signal ? Promise.race([reading, interrupted]) : reading);
      check(!signal?.aborted);
      observe?.();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > byteLimit) throw new Error("memory-response-too-large");
      result += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(result + decoder.decode());
  } catch (error) { cancel(); throw error; }
  finally {
    signal?.removeEventListener("abort", abort);
    try { reader?.releaseLock(); } catch { /* A pending read can outlive cancellation; it has a rejection handler. */ }
  }
}

function input<T>(parse: () => T): T {
  try { return parse(); } catch { throw new MemoryClientError("invalid_memory_request"); }
}

/** Each call sends at most one request. Mutations with uncertain outcomes must be reconciled by a fresh read. */
export function createLiveMemoryClient(transport: Transport = fetch,
  clock: () => MemoryClockSample = () => ({ monotonic: performance.now(), wall: Date.now() })) {
  const sample = (): MemoryClockSample => {
    try { const value = clock(); return { monotonic: value.monotonic, wall: value.wall }; }
    catch { return { monotonic: NaN, wall: NaN }; }
  };
  async function request<T>(path: string, method: "GET" | "PUT" | "DELETE", body: unknown,
    signal: AbortSignal | undefined, parse: (value: unknown) => T, observe?: () => void, byteLimit = RESPONSE_BYTE_LIMIT): Promise<T> {
    const mutation = method !== "GET";
    if (signal?.aborted) throw new MemoryClientError("memory_request_cancelled");
    const finishMutation = mutation ? beginMemoryPrivacyMutation() : undefined;
    try {
      let response: Response;
      try {
        response = await transport(path, { method, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", signal,
          headers: { accept: "application/json", ...(mutation ? { "content-type": "application/json" } : {}) },
          ...(mutation ? { body: JSON.stringify(body) } : {}) });
      } catch {
        throw new MemoryClientError(signal?.aborted ? "memory_request_cancelled" : "memory_request_failed", null, mutation);
      }
      if (!response.ok) {
        let code = "memory_request_rejected", knownRejection = false;
        try {
          const value = object(await readJson(response, signal, undefined, byteLimit));
          if (typeof value.error === "string" && ERROR_CODES.has(value.error)) { code = value.error; knownRejection = true; }
          if (value.error === "memory_write_unconfirmed") code = "memory_write_unconfirmed";
          // A failure body carrying success or pending claims is not a confirmed rejection.
          // Only the exact HTTP 200 Forget contract above can acknowledge withdrawal.
          if (["erased", "memoryWithdrawn", "physicalCleanupPending", "reEnrollmentRequired", "otherDevicesAndBackupsPurged",
            "enrollment", "priorMemoryCleared", "structuredCleanup"].some(key => Object.hasOwn(value, key))) knownRejection = false;
        } catch { /* Never expose a raw server body, parser error or arbitrary server message. */ }
        if (signal?.aborted) throw new MemoryClientError("memory_request_cancelled", response.status, mutation);
        throw new MemoryClientError(code, response.status, mutation && (response.status >= 500 || !knownRejection));
      }
      try {
        if (response.status !== 200) { cancelBody(response.body); throw new Error("invalid-memory-status"); }
        const value = await readJson(response, signal, observe, byteLimit); check(!signal?.aborted); return parse(value);
      } catch { throw new MemoryClientError(signal?.aborted ? "memory_request_cancelled" : "memory_response_invalid", response.status, mutation); }
    } finally { finishMutation?.(); }
  }

  return {
    async settings(after?: string, signal?: AbortSignal): Promise<MemorySettings> {
      const cursor = after === undefined ? undefined : input(() => id(after));
      return request(SETTINGS_PATH + (cursor === undefined ? "" : `?after=${encodeURIComponent(cursor)}`), "GET", undefined, signal,
        value => settings(value, cursor));
    },
    async save(value: MemoryPreferences, signal?: AbortSignal): Promise<MemorySaveResult> {
      const draft = input(() => preferences(value));
      return request(SETTINGS_PATH, "PUT", draft, signal, value => saved(value, draft));
    },
    async forget(value: MemoryEnrollment, signal?: AbortSignal): Promise<MemoryForgetResult> {
      const item = input(() => enrollment(value));
      return request(`${SETTINGS_PATH}?id=${encodeURIComponent(item.id)}`, "DELETE",
        { revision: item.revision, confirmation: "FORGET_MY_MEMORY" }, signal, forgotten);
    },
    async exportReferences(value: MemoryEnrollment, signal?: AbortSignal): Promise<string> {
      const item = input(() => { const copied = enrollment(value); check(copied.recall && copied.policyVersion === MEMORY_POLICY); return copied; });
      if (signal?.aborted) throw new MemoryClientError("memory_request_cancelled");
      const start = sample(), elapsed = createMemoryElapsed(start), expiry = memoryTimestamp(item.expiresAt);
      const observe = () => {
        const current = sample(), duration = elapsed.elapsed(current);
        check(expiry !== null && Number.isFinite(duration) && current.wall < expiry && duration < expiry - start.wall);
      };
      try { observe(); } catch { throw new MemoryClientError("invalid_memory_request"); }
      if (signal?.aborted) throw new MemoryClientError("memory_request_cancelled");
      return request(`${EXPORT_PATH}?id=${encodeURIComponent(item.id)}&revision=${item.revision}`, "GET", undefined, signal, raw => {
        const result = referenceExport(raw, item);
        observe(); check(!signal?.aborted);
        return result;
      }, observe, EXPORT_BYTE_LIMIT);
    },
    async recall(value: MemoryEnrollment, signal?: AbortSignal, options?: MemoryRecallOptions): Promise<MemoryRecallLease> {
      const { item, includeConsumption } = input(() => ({ item: enrollment(value), includeConsumption: consumptionChoice(options) }));
      // Begin before transport. Every header/body observation and final validation contributes to this budget.
      const elapsed = createMemoryElapsed(sample());
      const observe = () => check(Number.isFinite(elapsed.elapsed(sample())));
      try { observe(); } catch { throw new MemoryClientError("memory_response_invalid"); }
      const extra = includeConsumption ? `&consumptionEpisodes=${includeConsumption}` : "";
      return request(`${RECALL_PATH}?id=${encodeURIComponent(item.id)}&outcomes=${MEMORY_ASSISTED_OUTCOMES_VERSION}&savedOutputs=${MEMORY_SAVED_OUTPUTS_VERSION}${extra}`, "GET", undefined, signal, raw => {
        const value = recall(raw, item, includeConsumption);
        const budget = memoryTimestamp(value.lifetime.validUntil)! - memoryTimestamp(value.lifetime.checkedAt)!;
        const remaining = () => {
          const available = Math.max(0, budget - elapsed.elapsed(sample()));
          if (!(available > 0)) { elapsed.retire(); return 0; }
          return available;
        };
        check(remaining() > 0);
        return Object.freeze({ value, remaining, retire: elapsed.retire });
      }, observe);
    },
  };
}
