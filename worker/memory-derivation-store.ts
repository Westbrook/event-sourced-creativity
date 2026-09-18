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
const family = "name LIKE 'memory_derivation_%' OR name LIKE 'idx_memory_derivation_%' OR tbl_name IN('memory_derivation_grants','memory_derivation_qualifications') OR instr(lower(COALESCE(sql,'')),'memory_derivation_grants')>0 OR instr(lower(COALESCE(sql,'')),'memory_derivation_qualifications')>0";
const snapshot = `(SELECT json_group_array(json_object('name',name,'sql',sql,'table',tbl_name,'type',type)) FROM (SELECT name,sql,tbl_name,type FROM sqlite_schema WHERE ${family} ORDER BY name,type))`;
const fail = (): never => { throw new Error("memory-derivation-schema-unavailable"); };
export const derivationAssertion = (env: WorkerEnv, guard: MemorySqlGuard) => env.DB.prepare(`SELECT CASE WHEN (${guard.condition}) THEN 1 ELSE json('memory_derivation_changed') END AS verified`).bind(...guard.bindings);
export function derivationResults(raw: unknown, count: number): raw is D1Result<Row>[] {
  return Array.isArray(raw) && raw.length === count && Array.from(raw).every(result => result && typeof result === "object"
    && Object.hasOwn(result, "success") && result.success === true && result.error === undefined && Object.hasOwn(result, "results") && Array.isArray(result.results)
    && Array.from(result.results).every(row => row && typeof row === "object" && !Array.isArray(row)));
}
export function derivationChanged(result: D1Result<Row>, expected: number): boolean {
  const meta = Object.getOwnPropertyDescriptor(result, "meta");
  if (!meta || !Object.hasOwn(meta, "value") || !meta.value || typeof meta.value !== "object" || Array.isArray(meta.value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(meta.value))) return false;
  const changes = Object.getOwnPropertyDescriptor(meta.value, "changes");
  return !!changes && Object.hasOwn(changes, "value") && derivationInteger(changes.value) && changes.value === expected && result.results.length === 0;
}
export function derivationVerified(result: D1Result<Row>): boolean {
  return result.results.length === 1 && derivationExact(result.results[0], ["verified"]) && result.results[0].verified === 1;
}
export async function memoryDerivationSchema(env: WorkerEnv): Promise<{ present: boolean; guard: MemorySqlGuard }> {
  const db = env.DB, result = structuredClone(await db.prepare(`SELECT name,sql,tbl_name AS 'table',type FROM sqlite_schema WHERE ${family} ORDER BY name,type LIMIT 17`).all<Row>());
  if (env.DB !== db || !derivationResults([result], 1) || result.results.length > 15) fail();
  const rows = result.results;
  if (rows.some(row => !derivationExact(row, ["name", "sql", "table", "type"]) || !derivationId(row.name) || !derivationId(row.table)
    || !["table", "index", "trigger"].includes(String(row.type)) || row.sql !== null && typeof row.sql !== "string")) fail();
  const explicit = rows.filter(row => row.sql !== null);
  if (rows.length && (explicit.length !== 13 || rows.some(row => row.sql === null && !(row.type === "index"
    && (row.name === "sqlite_autoindex_memory_derivation_grants_1" && row.table === "memory_derivation_grants"
      || row.name === "sqlite_autoindex_memory_derivation_qualifications_1" && row.table === "memory_derivation_qualifications")))
    || "sha256:" + await memoryDigest(memoryCanonical(explicit.map(row => ({ ...row,
      sql: (row.sql as string).trim().replace(/;$/u, "").replace(/\bIF\s+NOT\s+EXISTS\s+/giu, "") })))) !== memoryDerivationSchemaProfile.digest)) fail();
  if (env.DB !== db) fail();
  return { present: rows.length > 0, guard: { condition: `${snapshot}=? AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema)`,
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
    const count = result.results[0].count, terminal = { condition: `(${schema.guard.condition}) AND NOT EXISTS(SELECT 1 FROM memory_derivation_grants WHERE ${affected})`,
      bindings: [...schema.guard.bindings, ...where.bindings] };
    const statements = [assertion(schema.guard), assertion({ condition: `(SELECT COUNT(*) FROM memory_derivation_grants WHERE ${affected})=?`, bindings: [...where.bindings, count] }),
      db.prepare(erase ? `DELETE FROM memory_derivation_grants WHERE ${affected}` : `UPDATE memory_derivation_grants SET revoked_at=MAX(consented_at,?) WHERE ${affected}`).bind(...(erase ? [] : [now]), ...where.bindings),
      assertion({ condition: "changes()=?", bindings: [count] }), assertion(terminal)];
    const assertionIndexes = [0, 1, 3, 4]; let used = false;
    if (env.DB !== db || memoryCanonical(selector) !== original) throw new Error("memory-derivation-withdrawal-changed");
    return { statements, terminalAssertions: [assertion(terminal)], assertionIndexes, bookkeepingWrites: 1,
      acknowledge(raw: unknown) { if (used) return false; used = true;
        return env.DB === db && memoryCanonical(selector) === original && derivationResults(raw, statements.length)
          && assertionIndexes.every(index => derivationVerified(raw[index]!)) && derivationChanged(raw[2]!, count); } };
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
  const statements = [assertion(schema.guard)], assertionIndexes = [0]; let writeIndex: number | null = null;
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
        && assertionIndexes.every(index => derivationVerified(raw[index]!)) && (writeIndex === null || derivationChanged(raw[writeIndex]!, changed)); } };
}
export async function sweepExpiredDerivationGrants(env: WorkerEnv, limit = 128): Promise<number> {
  if (!derivationInteger(limit, 1, 128)) throw new Error("memory-derivation-cleanup-invalid");
  const db = env.DB, schema = await memoryDerivationSchema(env), statements = [derivationAssertion(env, schema.guard),
    ...(schema.present ? [db.prepare(`DELETE FROM memory_derivation_grants WHERE (grant_id,revision) IN(
      SELECT grant_id,revision FROM memory_derivation_grants WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at,grant_id,revision LIMIT ?)`).bind(limit)] : []),
    derivationAssertion(env, schema.guard)];
  if (env.DB !== db) fail();
  const result = structuredClone(await db.batch(statements));
  if (env.DB !== db || !derivationResults(result, statements.length) || !derivationVerified(result[0]!) || !derivationVerified(result.at(-1)!)
    || schema.present && (!derivationInteger(result[1]?.meta?.changes, 0, limit) || !derivationChanged(result[1]!, Number(result[1]?.meta?.changes)))) throw new Error("memory-derivation-cleanup-unconfirmed");
  return schema.present ? Number(result[1]!.meta.changes) : 0;
}
