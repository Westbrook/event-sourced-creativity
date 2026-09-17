import { canonicalJson, digest, jsonIssues, record } from "../src/experiences/compiler.ts";
import type { WorkerEnv } from "./runtime.ts";

export type GuestCustodyTerms = Readonly<{ version: 1; policyId: string; origin: string; startsAtMs: number; expiresAtMs: number;
  sessionLifetimeMs: number; leaseLifetimeMs: number; maximumSessions: number; maximumLeaseAcquisitions: number }>;
const keys = ["version", "policyId", "origin", "startsAtMs", "expiresAtMs", "sessionLifetimeMs", "leaseLifetimeMs", "maximumSessions", "maximumLeaseAcquisitions"];
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
export const guestId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value);
export const guestHash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
export const guestFail = (reason: string): never => { throw new Error(`guest_custody_${reason}`); };
export const GUEST_DB_NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";

/** Validation alone neither provisions these terms nor grants a session. */
export function readGuestCustodyTerms(raw: unknown): GuestCustodyTerms {
  if (jsonIssues(raw).length || !record(raw) || Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))
    || raw.version !== 1 || !guestId(raw.policyId) || typeof raw.origin !== "string"
    || !integer(raw.startsAtMs, 0, 8_640_000_000_000_000) || !integer(raw.expiresAtMs, 1, 8_640_000_000_000_000)
    || raw.expiresAtMs <= raw.startsAtMs || !integer(raw.sessionLifetimeMs, 1, 604_800_000)
    || !integer(raw.leaseLifetimeMs, 1, 900_000) || raw.leaseLifetimeMs > raw.sessionLifetimeMs
    || !integer(raw.maximumSessions, 1, 10_000) || !integer(raw.maximumLeaseAcquisitions, 1, 100)) return guestFail("terms_invalid");
  let origin: URL; try { origin = new URL(raw.origin); } catch { return guestFail("terms_invalid"); }
  if (origin.protocol !== "https:" || origin.origin !== raw.origin || origin.username || origin.password) return guestFail("terms_invalid");
  return Object.freeze(JSON.parse(canonicalJson(raw)) as GuestCustodyTerms);
}

/** Inert DDL. No automatic migration or policy installer imports this module. */
export const GUEST_CUSTODY_SCHEMA = [
  `CREATE TABLE experience_guest_policies(policy_id TEXT PRIMARY KEY NOT NULL,terms_digest TEXT NOT NULL,terms_json TEXT NOT NULL,review_digest TEXT NOT NULL,revoked_at_ms INTEGER)`,
  `CREATE TRIGGER experience_guest_policy_insert BEFORE INSERT ON experience_guest_policies WHEN EXISTS(SELECT 1 FROM experience_guest_policies WHERE policy_id=NEW.policy_id) BEGIN SELECT RAISE(ABORT,'guest policy exists'); END`,
  `CREATE TRIGGER experience_guest_policy_update BEFORE UPDATE ON experience_guest_policies WHEN NEW.policy_id IS NOT OLD.policy_id OR NEW.terms_digest IS NOT OLD.terms_digest OR NEW.terms_json IS NOT OLD.terms_json OR NEW.review_digest IS NOT OLD.review_digest OR OLD.revoked_at_ms IS NOT NULL OR NEW.revoked_at_ms IS NULL BEGIN SELECT RAISE(ABORT,'guest policy immutable'); END`,
  `CREATE TRIGGER experience_guest_policy_delete BEFORE DELETE ON experience_guest_policies BEGIN SELECT RAISE(ABORT,'guest policy immutable'); END`,
  `CREATE TABLE experience_guest_sessions(session_id TEXT PRIMARY KEY NOT NULL,policy_id TEXT NOT NULL,terms_digest TEXT NOT NULL,
    guest_subject TEXT UNIQUE NOT NULL,project_id TEXT UNIQUE NOT NULL,document_id TEXT UNIQUE NOT NULL,session_hash TEXT UNIQUE NOT NULL,claim_hash TEXT UNIQUE NOT NULL,
    created_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER,
    FOREIGN KEY(policy_id) REFERENCES experience_guest_policies(policy_id))`,
  `CREATE INDEX experience_guest_sessions_policy ON experience_guest_sessions(policy_id)`,
  `CREATE TRIGGER experience_guest_session_insert BEFORE INSERT ON experience_guest_sessions WHEN EXISTS(SELECT 1 FROM experience_guest_sessions WHERE session_id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'guest session exists'); END`,
  `CREATE TRIGGER experience_guest_session_update BEFORE UPDATE ON experience_guest_sessions WHEN NEW.session_id IS NOT OLD.session_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.terms_digest IS NOT OLD.terms_digest OR NEW.guest_subject IS NOT OLD.guest_subject OR NEW.project_id IS NOT OLD.project_id OR NEW.document_id IS NOT OLD.document_id OR NEW.session_hash IS NOT OLD.session_hash OR NEW.claim_hash IS NOT OLD.claim_hash OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.expires_at_ms IS NOT OLD.expires_at_ms OR OLD.revoked_at_ms IS NOT NULL OR NEW.revoked_at_ms IS NULL BEGIN SELECT RAISE(ABORT,'guest session immutable'); END`,
  `CREATE TRIGGER experience_guest_session_delete BEFORE DELETE ON experience_guest_sessions BEGIN SELECT RAISE(ABORT,'guest session immutable'); END`,
  `CREATE TABLE experience_guest_claim_leases(session_id TEXT PRIMARY KEY NOT NULL,lease_id TEXT UNIQUE NOT NULL,destination_user_id TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,request_id TEXT NOT NULL,request_ids_json TEXT NOT NULL CHECK(json_valid(request_ids_json) AND json_type(request_ids_json)='array' AND json_array_length(request_ids_json) BETWEEN 1 AND 100),acquisitions INTEGER NOT NULL CHECK(acquisitions BETWEEN 1 AND 100),
    created_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL,FOREIGN KEY(session_id) REFERENCES experience_guest_sessions(session_id))`,
  `CREATE TRIGGER experience_guest_lease_insert BEFORE INSERT ON experience_guest_claim_leases WHEN EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'guest lease exists'); END`,
  `CREATE TRIGGER experience_guest_lease_update BEFORE UPDATE ON experience_guest_claim_leases WHEN NEW.session_id IS NOT OLD.session_id OR NEW.lease_id IS NOT OLD.lease_id OR NEW.destination_user_id IS NOT OLD.destination_user_id OR NEW.manifest_digest IS NOT OLD.manifest_digest OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.acquisitions<>OLD.acquisitions+1 OR NEW.request_id=OLD.request_id OR NEW.request_ids_json IS NOT json_insert(OLD.request_ids_json,'$[#]',NEW.request_id) OR EXISTS(SELECT 1 FROM json_each(OLD.request_ids_json) WHERE value=NEW.request_id) OR OLD.expires_at_ms>${GUEST_DB_NOW} BEGIN SELECT RAISE(ABORT,'guest lease immutable'); END`,
  `CREATE TRIGGER experience_guest_lease_delete BEFORE DELETE ON experience_guest_claim_leases BEGIN SELECT RAISE(ABORT,'guest lease immutable'); END`,
] as const;

type PolicyRow = { policy_id: string; terms_digest: string; terms_json: string; review_digest: string; revoked_at_ms: number | null };
export async function guestPolicy(env: WorkerEnv, request: Request, policyId: string) {
  if (!guestId(policyId)) return guestFail("policy_unavailable");
  const row = await env.DB.prepare("SELECT * FROM experience_guest_policies WHERE policy_id=? AND revoked_at_ms IS NULL").bind(policyId).first<PolicyRow>();
  if (!row || !guestHash(row.review_digest)) return guestFail("policy_unavailable");
  let raw: unknown; try { raw = JSON.parse(row.terms_json); } catch { return guestFail("policy_unavailable"); }
  const terms = readGuestCustodyTerms(raw);
  if (terms.policyId !== row.policy_id || row.terms_json !== canonicalJson(terms) || row.terms_digest !== await digest(terms)) return guestFail("policy_unavailable");
  if (request.method !== "POST" || new URL(request.url).origin !== terms.origin || request.headers.get("origin") !== terms.origin) return guestFail("origin_required");
  const sql = `EXISTS(SELECT 1 FROM experience_guest_policies WHERE policy_id=? AND terms_digest=? AND terms_json=? AND review_digest=? AND revoked_at_ms IS NULL)
    AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}<?`;
  return { terms, row, guard: { sql, bindings: [row.policy_id, row.terms_digest, row.terms_json, row.review_digest, terms.startsAtMs, terms.expiresAtMs] } };
}
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
function newToken(purpose: "session" | "claim") { return `forma-guest-${purpose}-v1.${hex(crypto.getRandomValues(new Uint8Array(32)))}`; }
export async function guestTokenHash(value: unknown, purpose: "session" | "claim") {
  if (typeof value !== "string" || !new RegExp(`^forma-guest-${purpose}-v1\\.[a-f0-9]{64}$`, "u").test(value)) return guestFail("proof_unavailable");
  return digest({ domain: `forma-guest-${purpose}@1`, token: value });
}

/** Internal-only issue; raw secrets returned once. The generated IDs reserve no
 * native Document, identity, generation, media or financial authority. A future
 * ingress must deliver the session in a secure HttpOnly cookie; none exists here. */
export async function issueGuestClaimSession(request: Request, env: WorkerEnv, policyId: string) {
  const db = env.DB, policy = await guestPolicy(env, request, policyId);
  const sessionToken = newToken("session"), claimToken = newToken("claim"), sessionId = crypto.randomUUID();
  const guestSubject = `guest:${crypto.randomUUID()}`, projectId = crypto.randomUUID(), documentId = crypto.randomUUID();
  const hashes = await Promise.all([guestTokenHash(sessionToken, "session"), guestTokenHash(claimToken, "claim")]);
  if (env.DB !== db) return guestFail("database_changed");
  const row = await db.prepare(`INSERT INTO experience_guest_sessions(session_id,policy_id,terms_digest,guest_subject,project_id,document_id,session_hash,claim_hash,created_at_ms,expires_at_ms)
    SELECT ?,?,?,?,?,?,?,?,${GUEST_DB_NOW},MIN(${GUEST_DB_NOW}+?,?) WHERE (${policy.guard.sql})
    AND (SELECT COUNT(*) FROM experience_guest_sessions WHERE policy_id=?)<? RETURNING expires_at_ms`)
    .bind(sessionId, policyId, policy.row.terms_digest, guestSubject, projectId, documentId, ...hashes,
      policy.terms.sessionLifetimeMs, policy.terms.expiresAtMs, ...policy.guard.bindings, policyId, policy.terms.maximumSessions).first<{ expires_at_ms: number }>();
  if (!row) return guestFail("session_unavailable");
  return Object.freeze({ version: 1 as const, sessionId, guestSubject, projectId, documentId, sessionToken, claimToken, expiresAtMs: row.expires_at_ms });
}

export type GuestClaimProof = Readonly<{ sessionId: string; sessionToken: string; claimToken: string }>;
export async function guestSession(env: WorkerEnv, request: Request, proof: GuestClaimProof) {
  if (jsonIssues(proof).length || !record(proof) || Object.keys(proof).sort().join() !== "claimToken,sessionId,sessionToken" || !guestId(proof.sessionId)) return guestFail("proof_unavailable");
  const hashes = await Promise.all([guestTokenHash(proof.sessionToken, "session"), guestTokenHash(proof.claimToken, "claim")]);
  const row = await env.DB.prepare(`SELECT * FROM experience_guest_sessions WHERE session_id=? AND session_hash=? AND claim_hash=? AND revoked_at_ms IS NULL AND expires_at_ms>${GUEST_DB_NOW}`)
    .bind(proof.sessionId, ...hashes).first<{ session_id: string; policy_id: string; terms_digest: string; project_id: string; document_id: string; guest_subject: string; expires_at_ms: number }>();
  if (!row) return guestFail("proof_unavailable");
  const policy = await guestPolicy(env, request, row.policy_id);
  if (row.terms_digest !== policy.row.terms_digest) return guestFail("policy_unavailable");
  return { row, policy, guard: { sql: `EXISTS(SELECT 1 FROM experience_guest_sessions WHERE session_id=? AND session_hash=? AND claim_hash=? AND terms_digest=? AND revoked_at_ms IS NULL AND expires_at_ms>${GUEST_DB_NOW}) AND (${policy.guard.sql})`,
    bindings: [row.session_id, ...hashes, row.terms_digest, ...policy.guard.bindings] } };
}

/** Revocation removes both proof purposes and every lease's usable authority.
 * It neither deletes creative data nor touches a native account or budget. */
export async function revokeGuestClaimSession(request: Request, env: WorkerEnv, proof: GuestClaimProof) {
  const db = env.DB, session = await guestSession(env, request, proof);
  if (env.DB !== db) return guestFail("database_changed");
  const changed = await db.prepare(`UPDATE experience_guest_sessions SET revoked_at_ms=${GUEST_DB_NOW} WHERE session_id=? AND (${session.guard.sql})`)
    .bind(session.row.session_id, ...session.guard.bindings).run();
  if (Number(changed.meta.changes) !== 1) return guestFail("proof_unavailable");
}
