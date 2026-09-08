import type { WorkerEnv } from "./runtime.ts";

export const DOCUMENT_PROFILE_POLICY = "document-profile-v1";
export const DOCUMENT_PROFILE_RECIPE = "native-document-palette-choice-v1";

/** Consent/suppression metadata only. Inferred claims and source content are never stored here. */
export type DocumentProfileGrant = {
  grant_id: string; actor_user_id: string; owner_user_id: string;
  organization_id: string | null; project_access_id: string | null;
  project_id: string; document_id: string; permission_epoch: string;
  policy_version: typeof DOCUMENT_PROFILE_POLICY; recipe_version: typeof DOCUMENT_PROFILE_RECIPE;
  revision: number; enrollment_id: string; enrollment_revision: number;
  infer_enabled: number; inspect_enabled: number; background_enabled: number;
  source_after_sequence: number; consented_at: string; expires_at: string;
  retention_days: number; revoked_at: string | null;
};
export type DocumentProfileSuppression = {
  grant_id: string; grant_revision: number; claim_key: string; revision: number;
  state: "active" | "revoked"; created_at: string; expires_at: string;
};
export type DocumentProfileWithdrawalSelector =
  | { enrollmentId: string; currentEnrollmentRevision?: number }
  | { grantId: string; currentRevision: number }
  | { actorUserId: string; personalOnly?: boolean }
  | { organizationId: string };
export type DocumentProfileSqlGuard = { sql: string; bindings: (string | number | null)[] };

const GRANT_COLUMNS = ["grant_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id",
  "project_id", "document_id", "permission_epoch", "policy_version", "recipe_version", "revision", "enrollment_id",
  "enrollment_revision", "infer_enabled", "inspect_enabled", "background_enabled", "source_after_sequence",
  "consented_at", "expires_at", "retention_days", "revoked_at"] as const;
const SUPPRESSION_COLUMNS = ["grant_id", "grant_revision", "claim_key", "revision", "state", "created_at", "expires_at"] as const;
const integerColumns = new Set(["revision", "enrollment_revision", "infer_enabled", "inspect_enabled", "background_enabled",
  "source_after_sequence", "retention_days", "grant_revision"]);
const nullableColumns = new Set(["organization_id", "project_access_id", "revoked_at"]);
const hasControlCharacters = (value: string): boolean => Array.from(value).some(character => {
  const code = character.charCodeAt(0); return code < 32 || code === 127;
});
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.isWellFormed() && !hasControlCharacters(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const invalid = (): never => { throw new Error("document_profile_withdrawal_invalid"); };

/** Deployment admission is additive to, never a substitute for, purpose-specific consent. No wildcard rollout. */
export function documentProfileEnabled(env: WorkerEnv, actorUserId: string): boolean {
  return id(actorUserId) && env.FORMA_MEMORY_ENABLED === "true" && env.FORMA_MEMORY_PROFILE_ENABLED === "true"
    && (env.FORMA_MEMORY_USER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(actorUserId)
    && (env.FORMA_MEMORY_PROFILE_USER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(actorUserId);
}

type SchemaTable = { name: string; type: string };
type SchemaObject = SchemaTable & { tbl_name: string; sql: string | null };
type SchemaColumn = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number };
type TableState = { present: boolean; ready: boolean };
type ProfileTables = { grants: TableState; suppressions: TableState; guard: DocumentProfileSqlGuard };
const PROFILE_SCHEMA_OBJECTS = `SELECT type,name,tbl_name,sql FROM sqlite_schema
  WHERE tbl_name IN('memory_document_profile_grants','memory_document_profile_suppressions') ORDER BY type,name,tbl_name,sql`;
function columnsMatch(rows: readonly SchemaColumn[], columns: readonly string[], primaryKey: readonly string[]): boolean {
  return rows.length === columns.length && rows.every((row, index) => row.cid === index && row.name === columns[index]
    && row.type.toUpperCase() === (integerColumns.has(row.name) ? "INTEGER" : "TEXT")
    && row.notnull === (nullableColumns.has(row.name) ? 0 : 1) && row.dflt_value === null && row.hidden === 0
    && row.pk === (primaryKey.indexOf(row.name) + 1));
}
/** Read afresh in a single snapshot; missing/failed schema is never cached as ready. */
async function profileTables(env: WorkerEnv): Promise<ProfileTables> {
  const results = await env.DB.batch<SchemaTable | SchemaColumn | SchemaObject>([
    env.DB.prepare("SELECT name,type FROM sqlite_schema WHERE name IN('memory_document_profile_grants','memory_document_profile_suppressions') ORDER BY name,type"),
    env.DB.prepare("SELECT cid,name,type,[notnull],dflt_value,pk,hidden FROM pragma_table_xinfo('memory_document_profile_grants') ORDER BY cid"),
    env.DB.prepare("SELECT cid,name,type,[notnull],dflt_value,pk,hidden FROM pragma_table_xinfo('memory_document_profile_suppressions') ORDER BY cid"),
    env.DB.prepare(PROFILE_SCHEMA_OBJECTS),
  ]);
  if (results.length !== 4 || results.some(result => result.success !== true)) throw new Error("document_profile_schema_unavailable");
  const tables = results[0].results as SchemaTable[];
  const objects = results[3].results as SchemaObject[];
  const state = (name: string, index: number, columns: readonly string[], primaryKey: readonly string[]): TableState => {
    const matches = tables.filter(row => row.name === name);
    return { present: matches.length > 0, ready: matches.length === 1 && matches[0].type === "table"
      && !objects.some(row => row.tbl_name === name && row.type === "trigger")
      && columnsMatch(results[index].results as SchemaColumn[], columns, primaryKey) };
  };
  const columnSnapshot = (index: number) => JSON.stringify((results[index].results as SchemaColumn[])
    .map(row => [row.cid, row.name, row.type, row.notnull, row.dflt_value, row.pk, row.hidden]));
  const guard: DocumentProfileSqlGuard = { sql: `(SELECT json_group_array(json_array(name,type)) FROM
      (SELECT name,type FROM sqlite_schema WHERE name IN('memory_document_profile_grants','memory_document_profile_suppressions') ORDER BY name,type)) IS ?
    AND (SELECT json_group_array(json_array(cid,name,type,[notnull],dflt_value,pk,hidden)) FROM
      (SELECT cid,name,type,[notnull],dflt_value,pk,hidden FROM pragma_table_xinfo('memory_document_profile_grants') ORDER BY cid)) IS ?
    AND (SELECT json_group_array(json_array(cid,name,type,[notnull],dflt_value,pk,hidden)) FROM
      (SELECT cid,name,type,[notnull],dflt_value,pk,hidden FROM pragma_table_xinfo('memory_document_profile_suppressions') ORDER BY cid)) IS ?
    AND (SELECT json_group_array(json_array(type,name,tbl_name,sql)) FROM (${PROFILE_SCHEMA_OBJECTS})) IS ?`,
    bindings: [JSON.stringify(tables.map(row => [row.name, row.type])), columnSnapshot(1), columnSnapshot(2),
      JSON.stringify(objects.map(row => [row.type, row.name, row.tbl_name, row.sql]))] };
  return { grants: state("memory_document_profile_grants", 1, GRANT_COLUMNS, ["grant_id"]),
    suppressions: state("memory_document_profile_suppressions", 2, SUPPRESSION_COLUMNS, ["grant_id", "grant_revision", "claim_key"]), guard };
}

function profileAssertion(env: WorkerEnv, guard: DocumentProfileSqlGuard, schema = false): D1PreparedStatement {
  return env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE json('${schema
    ? "document_profile_schema_unavailable" : "document_profile_withdrawal_unconfirmed"}') END AS verified`).bind(...guard.bindings);
}
function profileSchemaValid(tables: ProfileTables): void {
  if (tables.grants.present && !tables.grants.ready || tables.suppressions.present && !tables.suppressions.ready)
    throw new Error("document_profile_schema_unavailable");
}
function exactGrantRow(grant: DocumentProfileGrant): DocumentProfileSqlGuard {
  return { sql: `EXISTS(SELECT 1 FROM memory_document_profile_grants WHERE ${GRANT_COLUMNS.map(column => `${column} IS ?`).join(" AND ")})`,
    bindings: GRANT_COLUMNS.map(column => grant[column]) };
}
export async function documentProfileSchemaReady(env: WorkerEnv): Promise<boolean> {
  try {
    const tables = await profileTables(env);
    return tables.grants.ready && tables.suppressions.ready;
  } catch { return false; }
}

function validGrant(grant: DocumentProfileGrant): boolean {
  return Boolean(grant && typeof grant === "object" && exactKeys(grant, GRANT_COLUMNS)
    && [grant.grant_id, grant.actor_user_id, grant.owner_user_id, grant.project_id, grant.document_id,
      grant.permission_epoch, grant.enrollment_id].every(id)
    && (grant.organization_id === null) === (grant.project_access_id === null)
    && (grant.organization_id === null ? grant.owner_user_id === grant.actor_user_id
      : id(grant.organization_id) && id(grant.project_access_id))
    && grant.policy_version === DOCUMENT_PROFILE_POLICY && grant.recipe_version === DOCUMENT_PROFILE_RECIPE
    && positive(grant.revision) && positive(grant.enrollment_revision)
    && [grant.infer_enabled, grant.inspect_enabled, grant.background_enabled].every(value => value === 0 || value === 1)
    && Number.isSafeInteger(grant.source_after_sequence) && grant.source_after_sequence >= 0
    && Number.isSafeInteger(grant.retention_days) && grant.retention_days >= 1 && grant.retention_days <= 365
    && timestamp(grant.consented_at) && timestamp(grant.expires_at)
    && (grant.revoked_at === null ? grant.consented_at < grant.expires_at && grant.revision < Number.MAX_SAFE_INTEGER
      : timestamp(grant.revoked_at)));
}
/** Exact original row plus live deadline. Callers add their own infer/inspect purpose and native authority guards. */
export function documentProfileGrantGuard(grant: DocumentProfileGrant): DocumentProfileSqlGuard {
  if (!validGrant(grant)) return { sql: "0", bindings: [] };
  return { sql: `EXISTS(SELECT 1 FROM memory_document_profile_grants profile_grant WHERE
    ${GRANT_COLUMNS.map(column => `profile_grant.${column} IS ?`).join(" AND ")}
    AND profile_grant.revoked_at IS NULL
    AND profile_grant.consented_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND profile_grant.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    bindings: GRANT_COLUMNS.map(column => grant[column]) };
}

function withdrawalSelection(selector: DocumentProfileWithdrawalSelector): DocumentProfileSqlGuard {
  if (!selector || typeof selector !== "object") return invalid();
  if ("enrollmentId" in selector && id(selector.enrollmentId)
    && (exactKeys(selector, ["enrollmentId"]) || exactKeys(selector, ["enrollmentId", "currentEnrollmentRevision"])
      && positive(selector.currentEnrollmentRevision))) {
    return { sql: `enrollment_id=?${selector.currentEnrollmentRevision === undefined ? "" : " AND enrollment_revision=?"}`,
      bindings: [selector.enrollmentId, ...(selector.currentEnrollmentRevision === undefined ? [] : [selector.currentEnrollmentRevision])] };
  }
  if ("grantId" in selector && exactKeys(selector, ["grantId", "currentRevision"]) && id(selector.grantId) && positive(selector.currentRevision))
    return { sql: "grant_id=? AND revision=?", bindings: [selector.grantId, selector.currentRevision] };
  if ("actorUserId" in selector && id(selector.actorUserId) && (exactKeys(selector, ["actorUserId"])
    || exactKeys(selector, ["actorUserId", "personalOnly"]) && typeof selector.personalOnly === "boolean"))
    return { sql: `actor_user_id=?${selector.personalOnly ? " AND organization_id IS NULL AND project_access_id IS NULL" : ""}`,
      bindings: [selector.actorUserId] };
  if ("organizationId" in selector && exactKeys(selector, ["organizationId"]) && id(selector.organizationId))
    return { sql: "organization_id=?", bindings: [selector.organizationId] };
  return invalid();
}

/** Return inverse writes for the caller's guarded atomic batch. Never execute or install schema here.
 * Missing grants cannot authorize an actor/org/enrollment lookup in suppression-only storage: nonempty
 * orphan storage fails closed, while empty storage is asserted empty again in the caller's batch. An exact
 * grant/revision selector can still erase all suppressions for that exact grant ID without inventing scope information.
 * Present malformed tables fail closed rather than widening the requested withdrawal. */
export async function documentProfileWithdrawalStatements(env: WorkerEnv, selectorInput: DocumentProfileWithdrawalSelector,
  now: string): Promise<D1PreparedStatement[]> {
  if (!timestamp(now)) return invalid();
  const selector = structuredClone(selectorInput);
  const selection = withdrawalSelection(selector);
  const tables = await profileTables(env);
  profileSchemaValid(tables);
  // Schema absence is part of the original privacy decision, not permission to ignore a later table.
  // Every path rechecks the captured schema in the caller's transaction, including both tables absent.
  const statements: D1PreparedStatement[] = [profileAssertion(env, tables.guard, true)];
  if (!tables.grants.ready && tables.suppressions.ready && !("grantId" in selector)) {
    if (await env.DB.prepare("SELECT 1 AS present FROM memory_document_profile_suppressions LIMIT 1").first())
      throw new Error("document_profile_schema_unavailable");
    statements.push(profileAssertion(env, { sql: "NOT EXISTS(SELECT 1 FROM memory_document_profile_suppressions)", bindings: [] }, true));
    statements.push(profileAssertion(env, tables.guard, true));
    return statements;
  }
  // Only an exact revision selector changes under our UPDATE. Capture at most its single primary-key
  // row, then require that original row before touching hashes. Scoped selectors stay stable and
  // remain set-based, so account/org erasure has no arbitrary target-count ceiling.
  const exact = "grantId" in selector;
  const captured = exact && tables.grants.ready
    ? structuredClone(await env.DB.prepare(`SELECT * FROM memory_document_profile_grants WHERE ${selection.sql}`)
      .bind(...selection.bindings).first<DocumentProfileGrant>()) : null;
  if (exact && tables.grants.ready) statements.push(profileAssertion(env, captured ? exactGrantRow(captured)
    : { sql: `NOT EXISTS(SELECT 1 FROM memory_document_profile_grants WHERE ${selection.sql})`, bindings: selection.bindings }));
  const target: DocumentProfileSqlGuard | null = tables.grants.ready
    ? exact ? captured ? { sql: "grant_id=?", bindings: [captured.grant_id] } : null
      : { sql: `grant_id IN(SELECT grant_id FROM memory_document_profile_grants WHERE ${selection.sql})`, bindings: selection.bindings }
    : exact ? { sql: "grant_id=?", bindings: [selector.grantId] } : null;
  if (tables.suppressions.ready) {
    if (target) statements.push(env.DB.prepare(`DELETE FROM memory_document_profile_suppressions WHERE ${target.sql}`).bind(...target.bindings));
  }
  // Erase every claim hash first, including old/inactive rows. Only the grant revision tombstone survives;
  // it defeats stale suppress writes without retaining semantic claim hashes after withdrawal or forgetting.
  if (tables.grants.ready && (!exact || captured)) statements.push(env.DB.prepare(`UPDATE memory_document_profile_grants SET infer_enabled=0,inspect_enabled=0,
    background_enabled=0,revision=revision+CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END,
    revoked_at=COALESCE(revoked_at,?),expires_at=MIN(expires_at,?)
    WHERE (revoked_at IS NULL OR expires_at>? OR infer_enabled<>0 OR inspect_enabled<>0 OR background_enabled<>0)
      AND (${selection.sql})`).bind(now, now, now, ...selection.bindings));
  statements.push(profileAssertion(env, tables.guard, true));
  if (tables.grants.ready) {
    const terminal = exact ? captured ? exactGrantRow({ ...captured,
      infer_enabled: 0, inspect_enabled: 0, background_enabled: 0, revision: captured.revision + (captured.revoked_at === null ? 1 : 0),
      revoked_at: captured.revoked_at ?? now, expires_at: captured.expires_at < now ? captured.expires_at : now })
      : { sql: `NOT EXISTS(SELECT 1 FROM memory_document_profile_grants WHERE ${selection.sql})`, bindings: selection.bindings }
      : { sql: `NOT EXISTS(SELECT 1 FROM memory_document_profile_grants WHERE (${selection.sql})
          AND (revoked_at IS NULL OR infer_enabled<>0 OR inspect_enabled<>0 OR background_enabled<>0 OR expires_at>?))`,
        bindings: [...selection.bindings, now] };
    statements.push(profileAssertion(env, terminal));
  }
  if (tables.suppressions.ready && target) statements.push(profileAssertion(env,
    { sql: `NOT EXISTS(SELECT 1 FROM memory_document_profile_suppressions WHERE ${target.sql})`, bindings: target.bindings }));
  return statements;
}

function profileSweepMaximum(maximum: number): number {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 256) throw new Error("document_profile_sweep_invalid");
  return maximum;
}
function profileExpirySource(now: string, grantTablePresent: boolean): { from: string; condition: string; bindings: (string | number | null)[] } {
  if (!timestamp(now) || typeof grantTablePresent !== "boolean") throw new Error("document_profile_sweep_invalid");
  return { from: `FROM memory_document_profile_suppressions profile_suppression${grantTablePresent
    ? " LEFT JOIN memory_document_profile_grants profile_grant ON profile_grant.grant_id=profile_suppression.grant_id" : ""}`,
    condition: `profile_suppression.expires_at<=? OR profile_suppression.state='revoked'${grantTablePresent ? ` OR profile_grant.grant_id IS NULL
      OR profile_grant.revision<>profile_suppression.grant_revision OR profile_grant.revoked_at IS NOT NULL
      OR profile_grant.infer_enabled<>1 OR profile_grant.inspect_enabled<>1 OR profile_grant.background_enabled<>0
      OR profile_grant.expires_at<=?
      OR strftime('%Y-%m-%dT%H:%M:%fZ',profile_suppression.created_at,'+'||profile_grant.retention_days||' days')<=?` : ""}`,
    bindings: grantTablePresent ? [now, now, now] : [now] };
}

/** Pure bounded deletion descriptor. Its caller must certify the optional schema in the same batch.
 * No enrollment, inference, feature flag, or scheduling action is performed by this descriptor. */
export function documentProfileSuppressionExpiryQuery(now: string,
  options: { grantTablePresent: boolean; limit?: number }): DocumentProfileSqlGuard {
  const source = profileExpirySource(now, options.grantTablePresent), maximum = profileSweepMaximum(options.limit ?? 128);
  return { sql: `DELETE FROM memory_document_profile_suppressions WHERE rowid IN(
    SELECT profile_suppression.rowid ${source.from} WHERE (${source.condition})
    ORDER BY profile_suppression.expires_at,profile_suppression.grant_id,profile_suppression.grant_revision,profile_suppression.claim_key LIMIT ?)`,
    bindings: [...source.bindings, maximum] };
}

function profileSweepCandidateExpression(grantTablePresent: boolean): string {
  return `json_array(${SUPPRESSION_COLUMNS.map(column => `profile_suppression.${column}`).join(",")},${grantTablePresent
    ? `CASE WHEN profile_grant.grant_id IS NULL THEN NULL ELSE json_array(${GRANT_COLUMNS.map(column => `profile_grant.${column}`).join(",")}) END`
    : "NULL"})`;
}
function validSweepCandidate(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 8) return false;
  const [grantId, grantRevision, claimKey, revision, state, createdAt, expiresAt, grant] = value;
  if (!id(grantId) || !positive(grantRevision) || !id(claimKey) || !positive(revision)
    || state !== "active" && state !== "revoked" || !timestamp(createdAt) || !timestamp(expiresAt)
    || state === "active" && createdAt >= expiresAt) return false;
  return grant === null || Array.isArray(grant) && grant.length === GRANT_COLUMNS.length
    && validGrant(Object.fromEntries(GRANT_COLUMNS.map((column, index) => [column, grant[index]])) as DocumentProfileGrant);
}
function profileSweepConfirmed(results: D1Result<Record<string, unknown>>[], length: number, assertions: number[]): void {
  if (results.length !== length || results.some(result => result.success !== true)
    || assertions.some(index => results[index].results.length !== 1 || results[index].results[0]?.verified !== 1
      || !exactKeys(results[index].results[0], ["verified"]))) throw new Error("document_profile_sweep_unconfirmed");
}

/** Physically retire only a bounded, exact metadata snapshot. This retention operation is independent
 * of rollout flags and visits; callers decide when to invoke it. It never learns or enrolls anyone.
 * A changed grant/source, skipped DELETE, or changed optional schema aborts the whole deletion batch. */
export async function sweepExpiredDocumentProfileSuppressions(env: WorkerEnv,
  maximum = 128): Promise<{ deleted: number; pending: boolean }> {
  profileSweepMaximum(maximum);
  const now = new Date().toISOString(), tables = await profileTables(env);
  profileSchemaValid(tables);
  if (!tables.suppressions.ready) {
    const results = await env.DB.batch<Record<string, unknown>>([
      profileAssertion(env, tables.guard, true), profileAssertion(env, tables.guard, true),
    ]);
    profileSweepConfirmed(results, 2, [0, 1]);
    return { deleted: 0, pending: false };
  }
  const source = profileExpirySource(now, tables.grants.ready);
  const candidateExpression = profileSweepCandidateExpression(tables.grants.ready);
  const selection = `SELECT ${candidateExpression} AS candidate ${source.from} WHERE (${source.condition})
    ORDER BY profile_suppression.expires_at,profile_suppression.grant_id,profile_suppression.grant_revision,profile_suppression.claim_key LIMIT ?`;
  const selected = await env.DB.prepare(selection).bind(...source.bindings, maximum).all<{ candidate: string }>();
  if (selected.success !== true || selected.results.length > maximum) throw new Error("document_profile_sweep_unconfirmed");
  const candidates = selected.results.map(row => {
    if (typeof row.candidate !== "string" || !exactKeys(row, ["candidate"])) throw new Error("document_profile_sweep_invalid");
    const value: unknown = JSON.parse(row.candidate);
    if (!validSweepCandidate(value)) throw new Error("document_profile_sweep_invalid");
    return value;
  });
  const candidateJson = JSON.stringify(candidates);
  // The bounded snapshot retains only exact consent/suppression metadata until this call returns.
  const match = `profile_suppression.grant_id=json_extract(wanted.value,'$[0]')
    AND profile_suppression.grant_revision=json_extract(wanted.value,'$[1]')
    AND profile_suppression.claim_key=json_extract(wanted.value,'$[2]')`;
  const exactSources: DocumentProfileSqlGuard = {
    sql: `NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(SELECT 1 ${source.from}
      WHERE ${match} AND ${candidateExpression} IS wanted.value AND (${source.condition})))`,
    bindings: [candidateJson, ...source.bindings],
  };
  const target = `(grant_id,grant_revision,claim_key) IN(SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?))`;
  const results = await env.DB.batch<Record<string, unknown>>([
    profileAssertion(env, tables.guard, true), profileAssertion(env, exactSources),
    env.DB.prepare(`DELETE FROM memory_document_profile_suppressions WHERE ${target}`).bind(candidateJson),
    profileAssertion(env, tables.guard, true),
    profileAssertion(env, { sql: `NOT EXISTS(SELECT 1 FROM memory_document_profile_suppressions WHERE ${target})`, bindings: [candidateJson] }),
  ]);
  profileSweepConfirmed(results, 5, [0, 1, 3, 4]);
  const deleted = results[2].meta.changes;
  if (typeof deleted !== "number" || !Number.isSafeInteger(deleted) || deleted !== candidates.length) throw new Error("document_profile_sweep_unconfirmed");
  const pendingResults = await env.DB.batch<Record<string, unknown>>([
    profileAssertion(env, tables.guard, true),
    env.DB.prepare(`SELECT 1 AS pending ${source.from} WHERE (${source.condition}) LIMIT 1`).bind(...source.bindings),
    profileAssertion(env, tables.guard, true),
  ]);
  profileSweepConfirmed(pendingResults, 3, [0, 2]);
  const pending = pendingResults[1].results;
  if (pending.length > 1 || pending.length === 1 && (pending[0].pending !== 1 || !exactKeys(pending[0], ["pending"])))
    throw new Error("document_profile_sweep_unconfirmed");
  return { deleted, pending: pending.length === 1 };
}
