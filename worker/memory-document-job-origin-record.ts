import { decodeDocumentJobOriginManifest, type DocumentJobOriginManifest,
  type DocumentJobOriginManifestMaterial } from "./memory-document-job-origin-manifest.ts";

/** Exact persisted header projection. These columns are data, not read authority. */
export const DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS = Object.freeze([
  "origin_id", "schema_version", "recipe_version", "actor_user_id", "scope_key", "job_id", "turn_id",
  "user_event_id", "user_content_id", "answer_event_id", "answer_content_id", "manifest_content_ref",
  "owner_user_id", "stream_id", "organization_id", "project_access_id", "project_id", "document_id",
  "attempt_count", "correlation_id", "request_sha256", "claim_sha256", "input_content_ref", "input_sha256",
  "input_expires_at", "job_requested_at", "job_started_at", "job_lease_expires_at", "job_expires_at",
  "requested_sequence", "source_head", "project_source_head", "user_source_sequence", "user_sha256",
  "answer_source_sequence", "answer_sha256", "answer_expires_at", "mode", "renderer_recipe", "locale",
  "enrollment_id", "enrollment_revision", "permission_epoch", "policy_version", "enrolled_at",
  "enrollment_expires_at", "retention_days", "selection_cursor", "consumed_value_sha256", "source_count",
  "ledger_revision_count", "selector_count", "selector_list_sha256", "manifest_sha256", "manifest_expires_at",
  "proof_valid_until", "source_retention_ceiling", "created_at", "status", "withdrawn_at", "withdrawal_reason",
] as const);
type HeaderColumn = typeof DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS[number];
type Scalar = string | number | null;
export type DocumentJobOriginHeader = Readonly<Record<HeaderColumn, Scalar>>;
export type DocumentJobOriginRecordComparison = Readonly<{
  header: DocumentJobOriginHeader; manifest: DocumentJobOriginManifestMaterial;
}>;

const fail = (): never => { throw new Error("document_job_origin_record_invalid"); };
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 240 && v.isWellFormed();
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const timestamp = (v: unknown): number => {
  if (typeof v !== "string" || v.length !== 24) return fail();
  const ms = Date.parse(v);
  return Number.isSafeInteger(ms) && new Date(ms).toISOString() === v ? ms : fail();
};

// Own flat primitive rows before the codec's first crypto await. No accessors,
// inherited properties, toJSON hooks, extra operational columns or aliases.
function ownRow<K extends string>(value: unknown, columns: readonly K[]): Record<K, Scalar> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const names = Reflect.ownKeys(value);
  if (names.length !== columns.length || names.some(key => typeof key !== "string" || !columns.includes(key as K))) return fail();
  const result = Object.create(null) as Record<K, Scalar>;
  for (const key of columns) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail();
    const item: unknown = descriptor.value;
    if (item !== null && typeof item !== "string" && typeof item !== "number") return fail();
    if (typeof item === "string" && (item.length > 8192 || !item.isWellFormed())) return fail();
    if (typeof item === "number" && !Number.isSafeInteger(item)) return fail();
    result[key] = item as Scalar;
  }
  return result;
}

function ownSelectors(value: unknown): Record<"origin_id" | "resource_kind" | "resource_id", Scalar>[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!integer(length, 1, 513) || Reflect.ownKeys(value).length !== length + 1) return fail();
  const rows = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail();
    rows.push(ownRow(descriptor.value, ["origin_id", "resource_kind", "resource_id"]));
  }
  return rows;
}

/** Compare a complete persisted header/manifest/reverse index, never authorize
 * a response. Callers must independently prove current access, enrollment, job,
 * body custody/retention, native source replay and deterministic answer equality.
 * A null result is not permission for ordinary/provider fallback. An expired
 * creation lease may compare historically; this neither renews it nor asserts
 * that an answer remains unexpired now. No DB, provider or native capability. */
export async function validateDocumentJobOriginRecord(headerInput: unknown, manifestText: unknown,
  selectorRows: unknown): Promise<DocumentJobOriginRecordComparison | null> {
  try {
    const h = ownRow(headerInput, DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS), selectors = ownSelectors(selectorRows);
    if (h.schema_version !== 1 || h.recipe_version !== "native-document-job-answer-origin-v1"
      || h.status !== "active" || h.withdrawn_at !== null || h.withdrawal_reason !== null) return null;
    for (const key of ["origin_id", "actor_user_id", "job_id", "turn_id", "user_event_id", "user_content_id",
      "answer_event_id", "answer_content_id", "manifest_content_ref", "owner_user_id", "project_id", "document_id",
      "correlation_id", "input_content_ref", "enrollment_id", "permission_epoch", "policy_version"] as const)
      if (!id(h[key])) return null;
    const ownIdentities = new Set([h.user_event_id, h.answer_event_id, h.user_content_id, h.answer_content_id, h.manifest_content_ref]);
    if (ownIdentities.size !== 5
      || h.input_content_ref === h.answer_content_id || h.input_content_ref === h.manifest_content_ref) return null;
    for (const key of ["request_sha256", "claim_sha256", "input_sha256", "user_sha256", "answer_sha256",
      "consumed_value_sha256", "selector_list_sha256", "manifest_sha256"] as const) if (!digest(h[key])) return null;
    if (h.user_sha256 !== h.input_sha256 || h.stream_id !== "creative:" + h.owner_user_id) return null;
    if (h.organization_id === null) {
      if (h.project_access_id !== null || h.project_source_head !== null || h.actor_user_id !== h.owner_user_id) return null;
    } else if (!id(h.organization_id) || !id(h.project_access_id) || !integer(h.project_source_head, 0, Number.MAX_SAFE_INTEGER - 2)) return null;
    if (h.scope_key !== JSON.stringify([h.organization_id ?? "", h.project_access_id ?? "", h.project_id, h.document_id])) return null;
    if (!integer(h.attempt_count, 1) || !integer(h.source_head, 1, Number.MAX_SAFE_INTEGER - 2)
      || !integer(h.requested_sequence, 0, h.source_head) || !integer(h.selection_cursor, h.mode === "extractive" ? 1 : 0, h.source_head)
      || h.user_source_sequence !== h.source_head + 1 || h.answer_source_sequence !== h.source_head + 2
      || !integer(h.enrollment_revision, 1) || !integer(h.retention_days, 1, 365)
      || !integer(h.source_count, 1, 128) || !integer(h.selector_count, 1, 513)) return null;
    if (h.mode === "extractive") { if (h.ledger_revision_count !== 0) return null; }
    else if (h.mode !== "structured" || h.source_count < 2 || h.source_count % 2 !== 0 || !integer(h.ledger_revision_count, 1, 64)) return null;
    if (h.renderer_recipe !== "document-job-evidence-answer-v1" || !["en", "fr", "ar", "ja"].includes(h.locale as string)) return null;
    const t = Object.fromEntries((["input_expires_at", "job_requested_at", "job_started_at", "job_lease_expires_at",
      "job_expires_at", "answer_expires_at", "enrolled_at", "enrollment_expires_at", "manifest_expires_at",
      "proof_valid_until", "source_retention_ceiling", "created_at"] as const).map(key => [key, timestamp(h[key])])) as Record<string, number>;
    if (t.job_requested_at > t.job_started_at || t.job_started_at > t.created_at || t.enrolled_at > t.created_at
      || t.created_at >= t.proof_valid_until || t.proof_valid_until > Math.min(t.job_lease_expires_at, t.input_expires_at, t.job_expires_at, t.source_retention_ceiling)
      || t.created_at >= t.answer_expires_at || t.answer_expires_at > t.manifest_expires_at
      || t.manifest_expires_at > Math.min(t.source_retention_ceiling, t.input_expires_at, t.job_expires_at)
      || t.source_retention_ceiling > t.enrollment_expires_at) return null;
    const keys = selectors.map(row => {
      if (row.origin_id !== h.origin_id || !id(row.resource_id)
        || (row.resource_kind === "event" || row.resource_kind === "private-content") && ownIdentities.has(row.resource_id)
        || !["event", "private-content", "ledger", "enrollment"].includes(row.resource_kind as string)) return fail();
      return JSON.stringify([row.resource_kind, row.resource_id]);
    });
    if (keys.length !== h.selector_count || new Set(keys).size !== keys.length) return null;
    keys.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const material = await decodeDocumentJobOriginManifest(manifestText);
    if (!material || material.sha256 !== h.manifest_sha256 || material.selectorListSha256 !== h.selector_list_sha256
      || material.selectors.length !== keys.length
      || material.selectors.some((row, i) => JSON.stringify([row.resource_kind, row.resource_id]) !== keys[i])) return null;
    const m = JSON.parse(material.text) as DocumentJobOriginManifest, e = m.enrollment;
    const bindings: Partial<Record<HeaderColumn, Scalar>> = {
      origin_id: m.job.originId, job_id: m.job.jobId, attempt_count: m.job.attemptCount,
      request_sha256: m.job.requestSha256, claim_sha256: m.job.claimSha256,
      input_content_ref: m.job.inputContentRef, input_sha256: m.job.inputSha256,
      source_head: m.job.sourceHead, project_source_head: m.job.projectSourceHead,
      actor_user_id: e.actor_user_id, owner_user_id: e.owner_user_id, organization_id: e.organization_id,
      project_access_id: e.project_access_id, project_id: e.project_id, document_id: e.document_id,
      enrollment_id: e.enrollment_id, enrollment_revision: e.revision, permission_epoch: e.permission_epoch,
      policy_version: e.policy_version, enrolled_at: e.enrolled_at, enrollment_expires_at: e.expires_at,
      retention_days: e.retention_days, selection_cursor: e.cursor_sequence, mode: m.mode,
      renderer_recipe: m.renderer.recipe, locale: m.renderer.locale, consumed_value_sha256: m.consumedValueSha256,
      source_retention_ceiling: m.lifetime.sourceRetentionCeiling, proof_valid_until: m.lifetime.publicationValidUntil,
      source_count: m.mode === "extractive" ? m.dependencies.length : m.originals.length,
      ledger_revision_count: m.mode === "extractive" ? 0 : m.ledgerRevisions.length,
    };
    if (Object.entries(bindings).some(([key, value]) => h[key as HeaderColumn] !== value)
      || timestamp(m.lifetime.capturedAt) > t.created_at) return null;
    return Object.freeze({ header: Object.freeze(h), manifest: material });
  } catch { return null; }
}
