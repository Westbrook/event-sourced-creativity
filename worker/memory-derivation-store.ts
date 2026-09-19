import { memoryDerivationLifecycleSchemaProfile } from "./memory-derivation-lifecycle-schema.ts";
import { memoryDerivationCompletionSchemaProfile } from "./memory-derivation-completion-schema.ts";
import { memoryDerivationUserControlSchemaProfile } from "./memory-derivation-user-control-schema.ts";
import { memoryDerivationResultsSchemaProfile } from "./memory-derivation-results-schema.ts";
import { memoryDerivationRecoverySchemaProfile } from "./memory-derivation-recovery-schema.ts";
import { memoryDerivationFinanceSchemaProfile } from "./memory-derivation-finance-schema.ts";
import { memoryDerivationJobSchemaProfile } from "./memory-derivation-job-schema.ts";
import { memoryDigest } from "../src/model/scoped-memory.ts";
import { memoryCanonical, type MemorySqlGuard } from "./memory-sql.ts";
import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { WorkerEnv } from "./runtime.ts";
import { MEMORY_DERIVATION_POLICY, MEMORY_DERIVATION_PURPOSES, DERIVATION_QUALIFICATION_COLUMNS,
  derivationExact, derivationConsentId, derivationHash, derivationId, derivationInteger, derivationTime, parseMemoryDerivationQualification,
  type MemoryDerivationQualification } from "./memory-derivation-policy.ts";
import type { MemoryDerivationPurpose } from "./memory-derivation-result.ts";

export const DERIVATION_GRANT_COLUMNS = ["consent_id", "grant_id", "revision", "actor_user_id", "owner_user_id", "organization_id", "project_access_id",
  "project_id", "document_id", "enrollment_id", "enrollment_revision", "permission_epoch", "policy_version", "purpose", "qualification_id",
  "terms_sha256", "payer_user_id", "monthly_cap_microusd", "source_after_sequence", "retention_days", "background_enabled", "consented_at", "expires_at", "revoked_at"] as const;
export type MemoryDerivationGrant = {
  consent_id: string; grant_id: string; revision: number; actor_user_id: string; owner_user_id: string; organization_id: string | null; project_access_id: string | null;
  project_id: string; document_id: string; enrollment_id: string; enrollment_revision: number; permission_epoch: string;
  policy_version: typeof MEMORY_DERIVATION_POLICY; purpose: MemoryDerivationPurpose; qualification_id: string; terms_sha256: string;
  payer_user_id: string; monthly_cap_microusd: number; source_after_sequence: number; retention_days: number; background_enabled: number;
  consented_at: string; expires_at: string; revoked_at: string | null;
};
export const memoryDerivationSchemaProfile = {
  source: "0043_memory_derivation_purpose_grants",
  names: ["idx_memory_derivation_grant_active", "idx_memory_derivation_grant_actor", "idx_memory_derivation_grant_organization",
    "idx_memory_derivation_grant_parent", "idx_memory_derivation_qualification_current", "memory_derivation_grant_immutable",
    "memory_derivation_grant_no_replace", "memory_derivation_grant_parent_changed", "memory_derivation_grant_qualification_withdrawn", "memory_derivation_grants",
    "memory_derivation_qualification_immutable", "memory_derivation_qualification_no_replace", "memory_derivation_qualifications"],
  tables: ["memory_derivation_grants", "memory_derivation_qualifications"], count: 13,
  digest: "sha256:ea62945c5ccafa73b45faf546169b6b8d198fdc038b7bbed666c882338b02523",
} as const;
type Row = Record<string, unknown>;
type Query = { sql: string; bindings: (string | number | null)[] };
const profiles = [memoryDerivationSchemaProfile, memoryDerivationJobSchemaProfile, memoryDerivationFinanceSchemaProfile, memoryDerivationRecoverySchemaProfile, memoryDerivationResultsSchemaProfile, memoryDerivationUserControlSchemaProfile, memoryDerivationCompletionSchemaProfile, memoryDerivationLifecycleSchemaProfile] as const;
const schemaTables = profiles.flatMap(profile => [...profile.tables]);
const family = "name LIKE 'memory_derivation_%' OR name LIKE 'idx_memory_derivation_%' OR "
  + schemaTables.map(table => `tbl_name='${table}' OR instr(lower(COALESCE(sql,'')),'${table}')>0`).join(" OR ");
const automaticIndexes: readonly string[] = profiles.flatMap(profile => "automaticIndexes" in profile ? [...profile.automaticIndexes] : profile.tables.map(table => `sqlite_autoindex_${table}_1`));
const maximumSchemaRows = profiles.reduce((sum, profile) => sum + profile.count, automaticIndexes.length);
const snapshot = `(SELECT json_group_array(json_object('name',name,'sql',sql,'table',tbl_name,'type',type)) FROM (SELECT name,sql,tbl_name,type FROM sqlite_schema WHERE ${family} ORDER BY name,type))`;
const fail = (): never => { throw new Error("memory-derivation-schema-unavailable"); };
export const derivationAssertion = (env: WorkerEnv, guard: MemorySqlGuard) => env.DB.prepare(`SELECT CASE WHEN (${guard.condition}) THEN 1 ELSE json('memory_derivation_changed') END AS verified`).bind(...guard.bindings);
export function derivationResults(raw: unknown, count: number): raw is D1Result<Row>[] {
  return Array.isArray(raw) && raw.length === count && Array.from(raw).every(result => result && typeof result === "object"
    && Object.hasOwn(result, "success") && result.success === true && result.error === undefined && Object.hasOwn(result, "results") && Array.isArray(result.results)
    && Array.from(result.results).every(row => row && typeof row === "object" && !Array.isArray(row)));
}
export function derivationChanged(result: D1Result<Row>, expected: number, cascadeChanges = 0): boolean {
  const meta = Object.getOwnPropertyDescriptor(result, "meta");
  if (!meta || !Object.hasOwn(meta, "value") || !meta.value || typeof meta.value !== "object" || Array.isArray(meta.value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(meta.value))) return false;
  const changes = Object.getOwnPropertyDescriptor(meta.value, "changes");
  return !!changes && Object.hasOwn(changes, "value") && derivationInteger(changes.value) && (changes.value === expected || changes.value === expected + cascadeChanges) && result.results.length === 0;
}
export function derivationVerified(result: D1Result<Row>): boolean {
  return result.results.length === 1 && derivationExact(result.results[0], ["verified"]) && result.results[0].verified === 1;
}
export async function memoryDerivationSchema(env: WorkerEnv): Promise<{ present: boolean; jobsPresent: boolean; financePresent: boolean; recoveryPresent: boolean; resultsPresent: boolean; userControlsPresent: boolean; completionPresent: boolean; lifecyclePresent: boolean; guard: MemorySqlGuard }> {
  const db = env.DB, result = structuredClone(await db.prepare(`SELECT name,sql,tbl_name AS 'table',type FROM sqlite_schema WHERE ${family} ORDER BY name,type LIMIT ${maximumSchemaRows + 1}`).all<Row>());
  if (env.DB !== db || !derivationResults([result], 1) || result.results.length > maximumSchemaRows) fail();
  const rows = result.results;
  if (rows.some(row => !derivationExact(row, ["name", "sql", "table", "type"]) || !derivationId(row.name) || !derivationId(row.table)
    || !["table", "index", "trigger"].includes(String(row.type)) || row.sql !== null && typeof row.sql !== "string")) fail();
  const explicit = rows.filter(row => row.sql !== null), names: readonly string[] = profiles.flatMap(profile => [...profile.names]);
  if (explicit.some(row => !names.includes(String(row.name))) || rows.some(row => row.sql === null && !(row.type === "index"
    && schemaTables.includes(String(row.table) as typeof schemaTables[number]) && automaticIndexes.includes(String(row.name)) && String(row.name).startsWith(`sqlite_autoindex_${row.table}_`)))) fail();
  const installed: boolean[] = [];
  for (const profile of profiles) {
    const selected = explicit.filter(row => (profile.names as readonly string[]).includes(String(row.name)));
    installed.push(selected.length > 0);
    if (selected.length && (selected.length !== profile.count || "sha256:" + await memoryDigest(memoryCanonical(selected.map(row => ({ ...row,
      sql: (row.sql as string).trim().replace(/;$/u, "").replace(/\bIF\s+NOT\s+EXISTS\s+/giu, "") })))) !== profile.digest)) fail();
  }
  if (installed[1] && !installed[0] || installed[2] && !installed[1] || installed[3] && !installed[2] || installed[4] && !installed[2] || installed[5] && !installed[4] || installed[6] && !installed[5] || installed[7] && !installed[4] || env.DB !== db) fail();
  return { present: installed[0]!, jobsPresent: installed[1]!, financePresent: installed[2]!, recoveryPresent: installed[3]!, resultsPresent: installed[4]!, userControlsPresent: installed[5]!, completionPresent: installed[6]!, lifecyclePresent: installed[7]!, guard: { condition: `${snapshot}=? AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema)`,
    bindings: [JSON.stringify(rows.map(row => ({ name: row.name, sql: row.sql, table: row.table, type: row.type })))] } };
}
export function memoryDerivationBinding(env: WorkerEnv) {
  const sourceSha256 = env.FORMA_MEMORY_DERIVATION_SOURCE_SHA256, origin = env.FORMA_MEMORY_DERIVATION_ORIGIN,
    deploymentId = env.FORMA_MEMORY_DERIVATION_DEPLOYMENT_ID;
  try { return derivationHash(sourceSha256) && typeof origin === "string" && new URL(origin).protocol === "https:"
    && new URL(origin).origin === origin && derivationId(deploymentId) ? { sourceSha256, origin, deploymentId } : null; } catch { return null; }
}
export function memoryDerivationEnabled(env: WorkerEnv, actorId: string): boolean {
  return env.FORMA_MEMORY_ENABLED === "true" && (env.FORMA_MEMORY_USER_IDS ?? "").split(",").map(value => value.trim()).includes(actorId)
    && env.FORMA_MEMORY_DERIVATION_ENABLED === "true"
    && (env.FORMA_MEMORY_DERIVATION_USER_IDS ?? "").split(",").map(value => value.trim()).includes(actorId)
    && memoryDerivationBinding(env) !== null;
}
export function memoryDerivationGrantShape(row: unknown): row is MemoryDerivationGrant {
  return derivationExact(row, DERIVATION_GRANT_COLUMNS) && derivationConsentId(row.consent_id) && derivationHash(row.grant_id) && derivationHash(row.terms_sha256)
    && [row.actor_user_id, row.owner_user_id, row.project_id, row.document_id, row.enrollment_id, row.permission_epoch, row.qualification_id].every(derivationId)
    && (row.organization_id === null && row.project_access_id === null && row.owner_user_id === row.actor_user_id
      || derivationId(row.organization_id) && derivationId(row.project_access_id))
    && row.payer_user_id === row.actor_user_id && row.policy_version === MEMORY_DERIVATION_POLICY
    && MEMORY_DERIVATION_PURPOSES.some(purpose => purpose === row.purpose) && derivationInteger(row.revision, 1)
    && derivationInteger(row.enrollment_revision, 1) && derivationInteger(row.monthly_cap_microusd, 1, 1_000_000_000)
    && derivationInteger(row.source_after_sequence, 0, Number.MAX_SAFE_INTEGER - 1) && derivationInteger(row.retention_days, 1, 365)
    && (row.background_enabled === 0 || row.background_enabled === 1) && derivationTime(row.consented_at) && derivationTime(row.expires_at)
    && row.consented_at < row.expires_at && (row.revoked_at === null || derivationTime(row.revoked_at) && row.revoked_at >= row.consented_at);
}
export async function memoryDerivationGrantId(e: Pick<LiveMemoryEnrollment, "actor_user_id" | "owner_user_id" | "organization_id" | "project_access_id" | "project_id" | "document_id">, purpose: MemoryDerivationPurpose): Promise<string> {
  return memoryDigest(memoryCanonical([e.actor_user_id, e.owner_user_id, e.organization_id, e.project_access_id, e.project_id, e.document_id, purpose]));
}
export function derivationRowGuard(table: "memory_derivation_grants" | "memory_derivation_qualifications" | "memory_live_enrollments", columns: readonly string[], row: object): MemorySqlGuard {
  const values = columns.map(column => (row as Row)[column]);
  if (values.some(value => value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isSafeInteger(value)))) return { condition: "0", bindings: [] };
  return { condition: `EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(column => column + " IS ?").join(" AND ")})`, bindings: values as Query["bindings"] };
}
export async function readDerivationQualification(env: WorkerEnv, qualificationId: string) {
  const db = env.DB, binding = memoryDerivationBinding(env), bindingKey = memoryCanonical(binding);
  if (!binding || !derivationId(qualificationId)) return null;
  const result = structuredClone(await db.prepare(`SELECT ${DERIVATION_QUALIFICATION_COLUMNS.join(",")} FROM memory_derivation_qualifications WHERE qualification_id=? LIMIT 2`).bind(qualificationId).all<Row>());
  if (env.DB !== db || !derivationResults([result], 1) || result.results.length !== 1) return null;
  const qualified = await parseMemoryDerivationQualification(result.results[0], binding);
  return env.DB === db && memoryCanonical(memoryDerivationBinding(env)) === bindingKey ? qualified : null;
}
export function derivationQualificationGuard(row: MemoryDerivationQualification): MemorySqlGuard {
  const exact = derivationRowGuard("memory_derivation_qualifications", DERIVATION_QUALIFICATION_COLUMNS, row);
  return { condition: `(${exact.condition}) AND ?='qualified' AND ?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    bindings: [...exact.bindings, row.status, row.qualified_at, row.expires_at] };
}

/** The consent trigger durably lowers a payer-month floor independently of a
 * later reservation attempt. Pin its exact extra D1 change and resulting cap;
 * a failed monetary admission must never roll an accepted lower cap back. */
export async function prepareDerivationCapFloor(env: WorkerEnv, grant: MemoryDerivationGrant, installed: boolean) {
  if (!installed) return { changes: 0, before: [] as MemorySqlGuard[], after: [] as MemorySqlGuard[] };
  const db = env.DB, period = grant.consented_at.slice(0, 7), query = `SELECT
    (SELECT cap_microusd FROM memory_derivation_month_caps WHERE payer_id=? AND period=?) AS cap_microusd,
    (SELECT MIN(monthly_cap_microusd) FROM memory_derivation_grants WHERE actor_user_id=? AND substr(consented_at,1,7)=?) AS accepted_cap`;
  const result = structuredClone(await db.prepare(query).bind(grant.payer_user_id, period, grant.payer_user_id, period).all<Row>());
  if (env.DB !== db || !memoryDerivationGrantShape(grant) || !derivationResults([result], 1) || result.results.length !== 1
    || result.results.some(row => !derivationExact(row, ["cap_microusd", "accepted_cap"])
      || [row.cap_microusd,row.accepted_cap].some(value => value !== null && !derivationInteger(value, 1, 1_000_000_000)))) fail();
  const prior = result.results[0]!.cap_microusd as number | null, accepted = result.results[0]!.accepted_cap as number | null;
  const cap = Math.min(prior ?? grant.monthly_cap_microusd, accepted ?? grant.monthly_cap_microusd, grant.monthly_cap_microusd);
  const guard = (values: number[]): MemorySqlGuard => ({ condition: `(SELECT json_group_array(cap_microusd) FROM memory_derivation_month_caps WHERE payer_id=? AND period=?)=?`,
    bindings: [grant.payer_user_id, period, JSON.stringify(values)] });
  return { changes: prior === cap ? 0 : 1, before: [guard(prior === null ? [] : [prior])], after: [guard([cap])] };
}

/** Persist the most restrictive accepted cap BEFORE a reservation attempt.
 * This is monotonic bookkeeping, not authority to read sources or spend money.
 * No source/grant backfill is performed by a schema migration. */
export async function synchronizeDerivationMonthCap(env: WorkerEnv, payerId: string, period: string): Promise<number | null> {
  if (!derivationId(payerId) || period !== new Date().toISOString().slice(0, 7)) throw Error("memory-finance-cap-period-invalid");
  const db = env.DB, schema = await memoryDerivationSchema(env);
  if (!schema.financePresent || env.DB !== db) throw Error("memory-finance-schema-unavailable");
  const accepted = `SELECT MIN(cap) FROM (
    SELECT monthly_cap_microusd AS cap FROM memory_derivation_grants WHERE actor_user_id=?
      AND (substr(consented_at,1,7)=? OR revoked_at IS NULL AND background_enabled=1 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    UNION ALL SELECT authorized_cap_microusd AS cap FROM memory_derivation_finance WHERE payer_id=? AND period=?)`;
  const values = [payerId,period,payerId,period];
  const query = `SELECT (SELECT cap_microusd FROM memory_derivation_month_caps WHERE payer_id=? AND period=?) AS retained,
    (${accepted}) AS accepted`;
  const result = structuredClone(await db.prepare(query).bind(payerId,period,...values).all<Row>());
  if (env.DB !== db || !derivationResults([result],1) || result.results.length !== 1 || !derivationExact(result.results[0],["retained","accepted"])
    || Object.values(result.results[0]).some(value => value !== null && !derivationInteger(value,1,1_000_000_000))) throw Error("memory-finance-cap-unavailable");
  const row=result.results[0]!, retained=row.retained as number|null, acceptedCap=row.accepted as number|null;
  if (retained===null && acceptedCap===null) return null;
  const cap=Math.min(retained??acceptedCap!,acceptedCap??retained!);
  const assertion=(guard:MemorySqlGuard)=>derivationAssertion({...env,DB:db},guard);
  const statements=[assertion(schema.guard),assertion({condition:"?=strftime('%Y-%m','now')",bindings:[period]}),
    assertion({condition:`EXISTS(SELECT 1 FROM (${query}) WHERE retained IS ? AND accepted IS ?)`,bindings:[payerId,period,...values,retained,acceptedCap]}),
    db.prepare(`INSERT INTO memory_derivation_month_caps(payer_id,period,cap_microusd) SELECT ?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM memory_derivation_month_caps WHERE payer_id=? AND period=?)`).bind(payerId,period,cap,payerId,period),
    assertion({condition:"changes()=?",bindings:[Number(retained===null)]}),
    db.prepare("UPDATE memory_derivation_month_caps SET cap_microusd=? WHERE payer_id=? AND period=? AND cap_microusd>?").bind(cap,payerId,period,cap),
    assertion({condition:"changes()=?",bindings:[Number(retained!==null && retained>cap)]}),
    assertion({condition:"EXISTS(SELECT 1 FROM memory_derivation_month_caps WHERE payer_id=? AND period=? AND cap_microusd=?)",bindings:[payerId,period,cap]})];
  const receipt=structuredClone(await db.batch<Row>(statements));
  if(env.DB!==db || !derivationResults(receipt,statements.length)
    || ![0,1,2,4,6,7].every(index=>derivationVerified(receipt[index]!))
    || !derivationChanged(receipt[3]!,Number(retained===null)) || !derivationChanged(receipt[5]!,Number(retained!==null&&retained>cap)))
    throw Error("memory-finance-cap-commit-unconfirmed");
  return cap;
}

/** D1 reports total trigger/FK changes, while SQLite adapters may report direct
 * changes. Pin the exact private descendant count, then accept only those two
 * known receipts. The separate SQL changes() assertion proves direct mutation. */
async function derivationCascadeChanges(env: WorkerEnv, jobsPresent: boolean, financePresent: boolean, resultsPresent: boolean, completionPresent: boolean, where: Query, erase = false) {
  if (!jobsPresent) return { count: 0, guard: { condition: "1", bindings: [] } as MemorySqlGuard };
  const query = `WITH selected AS (SELECT consent_id,payer_user_id,consented_at FROM memory_derivation_grants WHERE ${where.sql}),
    cursors AS (SELECT consent_id FROM memory_derivation_cursors WHERE consent_id IN(SELECT consent_id FROM selected)),
    jobs AS (SELECT job_id FROM memory_derivation_jobs WHERE consent_id IN(SELECT consent_id FROM cursors))
    SELECT (SELECT COUNT(*) FROM cursors)+(SELECT COUNT(*) FROM jobs)+
      (SELECT COUNT(*) FROM memory_derivation_job_sources WHERE job_id IN(SELECT job_id FROM jobs))${completionPresent ? `+
      (SELECT COUNT(*) FROM memory_derivation_completions WHERE job_id IN(SELECT job_id FROM jobs))+
      (SELECT COUNT(*) FROM memory_derivation_completion_cursors WHERE consent_id IN(SELECT consent_id FROM cursors))` : ""}${resultsPresent ? `+
      (SELECT COUNT(*) FROM memory_derivation_results WHERE job_id IN(SELECT job_id FROM jobs))+
      (SELECT COUNT(*) FROM memory_derivation_result_dependencies WHERE job_id IN(SELECT job_id FROM jobs))` : ""}${financePresent ? `+
      (SELECT COUNT(*) FROM memory_derivation_job_finance WHERE job_id IN(SELECT job_id FROM jobs))+
      (SELECT COUNT(*) FROM memory_derivation_finance f JOIN memory_derivation_job_finance link ON link.finance_id=f.finance_id
        WHERE link.job_id IN(SELECT job_id FROM jobs) AND f.admission_closed_at IS NULL)${erase ? `+
      (SELECT COUNT(*) FROM (SELECT DISTINCT payer_user_id,substr(consented_at,1,7) AS period FROM selected) retiring
        WHERE COALESCE((SELECT cap_microusd FROM memory_derivation_month_caps WHERE payer_id=retiring.payer_user_id AND period=retiring.period),1000000001)
          >(SELECT MIN(monthly_cap_microusd) FROM memory_derivation_grants WHERE actor_user_id=retiring.payer_user_id AND substr(consented_at,1,7)=retiring.period))` : ""}` : ""} AS count`;
  const result = structuredClone(await env.DB.prepare(query).bind(...where.bindings).all<Row>());
  if (!derivationResults([result], 1) || result.results.length !== 1 || !derivationExact(result.results[0], ["count"])
    || !derivationInteger(result.results[0]!.count)) fail();
  const count = result.results[0]!.count as number;
  return { count, guard: { condition: `(${query})=?`, bindings: [...where.bindings, count] } };
}

export type DerivationWithdrawalSelector = { enrollmentId: string; currentEnrollmentRevision?: number }
  | { grantId: string; currentRevision: number } | { actorUserId: string; personalOnly?: boolean } | { organizationId: string };
function withdrawalWhere(selector: DerivationWithdrawalSelector): Query {
  const keys = (names: readonly string[]): boolean => derivationExact(selector, names);
  if ("enrollmentId" in selector && derivationId(selector.enrollmentId)
    && (keys(["enrollmentId"]) || keys(["enrollmentId", "currentEnrollmentRevision"]) && derivationInteger(selector.currentEnrollmentRevision, 1)))
    return { sql: "enrollment_id=?" + (selector.currentEnrollmentRevision === undefined ? "" : " AND enrollment_revision=?"),
      bindings: [selector.enrollmentId, ...(selector.currentEnrollmentRevision === undefined ? [] : [selector.currentEnrollmentRevision])] };
  if ("grantId" in selector && keys(["grantId", "currentRevision"]) && derivationHash(selector.grantId) && derivationInteger(selector.currentRevision, 1))
    return { sql: "grant_id=? AND revision=?", bindings: [selector.grantId, selector.currentRevision] };
  if ("actorUserId" in selector && derivationId(selector.actorUserId) && (keys(["actorUserId"])
    || keys(["actorUserId", "personalOnly"]) && typeof selector.personalOnly === "boolean"))
    return { sql: "actor_user_id=?" + (selector.personalOnly ? " AND organization_id IS NULL" : ""), bindings: [selector.actorUserId] };
  if ("organizationId" in selector && keys(["organizationId"]) && derivationId(selector.organizationId)) return { sql: "organization_id=?", bindings: [selector.organizationId] };
  throw new Error("memory-derivation-withdrawal-invalid");
}
/** A source/consent inverse never settles money. Original paid job identities
 * and uncertain holds belong to independent accounting, not these privacy rows.
 * erase=true removes private scope metadata under the caller's native erasure
 * proof; ordinary purpose revocation retains its immutable revision until expiry. */
export async function prepareDerivationWithdrawal(env: WorkerEnv, selector: DerivationWithdrawalSelector, now: string, erase = false) {
  const db = env.DB, original = memoryCanonical(selector), where = withdrawalWhere(selector), schema = await memoryDerivationSchema(env);
  if (!derivationTime(now) || env.DB !== db || memoryCanonical(selector) !== original) throw new Error("memory-derivation-withdrawal-invalid");
  const assertion = (guard: MemorySqlGuard) => derivationAssertion({ ...env, DB: db }, guard);
  // A whole-actor/organization privacy inverse authorizes the entire matching
  // set, including same-count concurrent replacements. Do not materialize that
  // set or impose a lifetime row ceiling on the right to withdraw/erase it.
  // Execution-limit failures remain atomic and retriable; this bounds receipt
  // memory, not database work. Narrow grant/enrollment CAS retains exact rows.
  if (schema.present && ("actorUserId" in selector || "organizationId" in selector)) {
    const affected = `(${where.sql})${erase ? "" : " AND revoked_at IS NULL"}`;
    const result = structuredClone(await db.prepare(`SELECT COUNT(*) AS count FROM memory_derivation_grants WHERE ${affected}`).bind(...where.bindings).all<Row>());
    if (env.DB !== db || !derivationResults([result], 1) || result.results.length !== 1
      || !derivationExact(result.results[0], ["count"]) || !derivationInteger(result.results[0].count)) throw new Error("memory-derivation-withdrawal-unavailable");
    const cascade = await derivationCascadeChanges({ ...env, DB: db }, schema.jobsPresent, schema.financePresent, schema.resultsPresent, schema.completionPresent, { sql: affected, bindings: where.bindings }, erase);
    const count = result.results[0].count, terminal = { condition: `(${schema.guard.condition}) AND NOT EXISTS(SELECT 1 FROM memory_derivation_grants WHERE ${affected})`,
      bindings: [...schema.guard.bindings, ...where.bindings] };
    const statements = [assertion(cascade.guard), assertion(schema.guard), assertion({ condition: `(SELECT COUNT(*) FROM memory_derivation_grants WHERE ${affected})=?`, bindings: [...where.bindings, count] }),
      db.prepare(erase ? `DELETE FROM memory_derivation_grants WHERE ${affected}` : `UPDATE memory_derivation_grants SET revoked_at=MAX(consented_at,?) WHERE ${affected}`).bind(...(erase ? [] : [now]), ...where.bindings),
      assertion({ condition: "changes()=?", bindings: [count] }), assertion(terminal)];
    const assertionIndexes = [0, 1, 2, 4, 5]; let used = false;
    if (env.DB !== db || memoryCanonical(selector) !== original) throw new Error("memory-derivation-withdrawal-changed");
    return { statements, terminalAssertions: [assertion(terminal)], assertionIndexes, bookkeepingWrites: 1,
      acknowledge(raw: unknown) { if (used) return false; used = true;
        return env.DB === db && memoryCanonical(selector) === original && derivationResults(raw, statements.length)
          && assertionIndexes.every(index => derivationVerified(raw[index]!)) && derivationChanged(raw[3]!, count, cascade.count); } };
  }
  let captured: MemoryDerivationGrant[] = [];
  if (schema.present) {
    const result = structuredClone(await db.prepare(`SELECT ${DERIVATION_GRANT_COLUMNS.join(",")} FROM memory_derivation_grants WHERE ${where.sql} ORDER BY grant_id,revision LIMIT 4097`).bind(...where.bindings).all<Row>());
    if (env.DB !== db || !derivationResults([result], 1) || result.results.length > 4096 || !result.results.every(memoryDerivationGrantShape)
      || new TextEncoder().encode(JSON.stringify(result.results)).byteLength > 4194304) throw new Error("memory-derivation-withdrawal-unavailable");
    captured = result.results as MemoryDerivationGrant[];
  }
  const inventory = (values: MemoryDerivationGrant[]): MemorySqlGuard => ({
    condition: `(${schema.guard.condition}) AND (SELECT json_group_array(json_array(${DERIVATION_GRANT_COLUMNS.join(",")})) FROM
      (SELECT ${DERIVATION_GRANT_COLUMNS.join(",")} FROM memory_derivation_grants WHERE ${where.sql} ORDER BY grant_id,revision))=?`,
    bindings: [...schema.guard.bindings, ...where.bindings, JSON.stringify(values.map(row => DERIVATION_GRANT_COLUMNS.map(key => row[key])))],
  });
  const expected = erase ? [] : captured.map(row => ({ ...row, revoked_at: row.revoked_at ?? (row.consented_at > now ? row.consented_at : now) }));
  const terminal = schema.present ? inventory(expected) : schema.guard, changed = erase ? captured.length : captured.filter(row => row.revoked_at === null).length;
  const cascade = await derivationCascadeChanges({ ...env, DB: db }, schema.jobsPresent, schema.financePresent, schema.resultsPresent, schema.completionPresent,
    { sql: `(${where.sql})${erase ? "" : " AND revoked_at IS NULL"}`, bindings: where.bindings }, erase);
  const statements = [assertion(schema.guard), assertion(cascade.guard)], assertionIndexes = [0, 1]; let writeIndex: number | null = null;
  if (schema.present) {
    assertionIndexes.push(statements.length); statements.push(assertion(inventory(captured))); writeIndex = statements.length;
    statements.push(db.prepare(erase ? `DELETE FROM memory_derivation_grants WHERE ${where.sql}`
      : `UPDATE memory_derivation_grants SET revoked_at=MAX(consented_at,?) WHERE ${where.sql} AND revoked_at IS NULL`).bind(...(erase ? [] : [now]), ...where.bindings));
    assertionIndexes.push(statements.length); statements.push(assertion({ condition: "changes()=?", bindings: [changed] }));
  }
  assertionIndexes.push(statements.length); statements.push(assertion(terminal));
  if (env.DB !== db || memoryCanonical(selector) !== original) throw new Error("memory-derivation-withdrawal-changed");
  let used = false;
  return { statements, terminalAssertions: [assertion(terminal)], assertionIndexes, bookkeepingWrites: Number(writeIndex !== null),
    acknowledge(raw: unknown) { if (used) return false; used = true;
      return env.DB === db && memoryCanonical(selector) === original && derivationResults(raw, statements.length)
        && assertionIndexes.every(index => derivationVerified(raw[index]!)) && (writeIndex === null || derivationChanged(raw[writeIndex]!, changed, cascade.count)); } };
}
export async function sweepExpiredDerivationGrants(env: WorkerEnv, limit = 128): Promise<number> {
  if (!derivationInteger(limit, 1, 128)) throw new Error("memory-derivation-cleanup-invalid");
  const db = env.DB, schema = await memoryDerivationSchema(env), where = { sql: `(grant_id,revision) IN(
    SELECT grant_id,revision FROM memory_derivation_grants WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at,grant_id,revision LIMIT ?)`, bindings: [limit] };
  const cascade = await derivationCascadeChanges({ ...env, DB: db }, schema.jobsPresent, schema.financePresent, schema.resultsPresent, schema.completionPresent, where, true);
  const statements = [derivationAssertion(env, schema.guard), derivationAssertion(env, cascade.guard),
    ...(schema.present ? [db.prepare(`DELETE FROM memory_derivation_grants WHERE ${where.sql}`).bind(limit),
      db.prepare("SELECT changes() AS direct_changes")] : []), derivationAssertion(env, schema.guard)];
  if (env.DB !== db) fail();
  const result = structuredClone(await db.batch<Row>(statements)), direct = schema.present ? result[3]?.results[0]?.direct_changes : 0;
  if (env.DB !== db || !derivationResults(result, statements.length) || !derivationVerified(result[0]!) || !derivationVerified(result[1]!) || !derivationVerified(result.at(-1)!)
    || schema.present && (result[3]?.results.length !== 1 || !derivationExact(result[3].results[0], ["direct_changes"])
      || !derivationInteger(direct, 0, limit) || !derivationChanged(result[2]!, Number(direct), cascade.count))) throw new Error("memory-derivation-cleanup-unconfirmed");
  return Number(direct);
}
