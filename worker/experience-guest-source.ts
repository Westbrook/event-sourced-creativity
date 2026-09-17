import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, validateIntakeRequest, type ExperiencePlan } from "../src/experiences/intake.ts";
import { preparePrivateContent } from "./private-content-storage.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { appendEvents } from "./event-append.ts";
import { eventWriteBindings, makeEvent } from "./event-write-primitives.ts";
import { GUEST_DB_NOW, guestFail, guestHash, guestId, guestSession, type GuestClaimProof } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

type Proof = { sql: string; bindings: (string | number | null)[] };
type Session = Awaited<ReturnType<typeof guestSession>>;
export type GuestSourcePolicy = Readonly<{ version: 1; policyId: string; sessionPolicyId: string; sessionTermsDigest: string;
  releaseHash: string; maximumDraftBytes: number; maximumEventBytes: number; maximumEvents: number; draftLifetimeMs: number }>;
const int = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const bytes = (v: string) => new TextEncoder().encode(v).byteLength;
const join = (...parts: Proof[]): Proof => ({ sql: parts.map(p => `(${p.sql})`).join(" AND "), bindings: parts.flatMap(p => p.bindings) });
const policyKeys = ["version", "policyId", "sessionPolicyId", "sessionTermsDigest", "releaseHash", "maximumDraftBytes", "maximumEventBytes", "maximumEvents", "draftLifetimeMs"];
export function readGuestSourcePolicy(raw: unknown): GuestSourcePolicy {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, policyKeys) || raw.version !== 1
    || !guestId(raw.policyId) || !guestId(raw.sessionPolicyId) || !guestHash(raw.sessionTermsDigest) || !guestHash(raw.releaseHash)
    || !int(raw.maximumDraftBytes, 1, 65_536) || !int(raw.maximumEventBytes, 1, 65_536) || !int(raw.maximumEvents, 1, 16)
    || !int(raw.draftLifetimeMs, 1, 604_800_000)) return guestFail("source_policy_invalid");
  return freeze(JSON.parse(canonicalJson(raw)) as GuestSourcePolicy);
}

/** Inert, source-free policy/receipt DDL; creative bodies use native storage. */
export const GUEST_SOURCE_SCHEMA = [
  `CREATE TABLE experience_guest_source_policies(policy_id TEXT PRIMARY KEY NOT NULL,policy_digest TEXT NOT NULL,policy_json TEXT NOT NULL,review_digest TEXT NOT NULL,revoked_at_ms INTEGER)`,
  `CREATE TRIGGER experience_guest_source_policy_insert BEFORE INSERT ON experience_guest_source_policies WHEN EXISTS(SELECT 1 FROM experience_guest_source_policies WHERE policy_id=NEW.policy_id) BEGIN SELECT RAISE(ABORT,'guest source policy exists'); END`,
  `CREATE TRIGGER experience_guest_source_policy_update BEFORE UPDATE ON experience_guest_source_policies WHEN NEW.policy_id IS NOT OLD.policy_id OR NEW.policy_digest IS NOT OLD.policy_digest OR NEW.policy_json IS NOT OLD.policy_json OR NEW.review_digest IS NOT OLD.review_digest OR OLD.revoked_at_ms IS NOT NULL OR NEW.revoked_at_ms IS NULL BEGIN SELECT RAISE(ABORT,'guest source policy immutable'); END`,
  `CREATE TRIGGER experience_guest_source_policy_delete BEFORE DELETE ON experience_guest_source_policies BEGIN SELECT RAISE(ABORT,'guest source policy immutable'); END`,
  `CREATE TABLE experience_guest_sources(session_id TEXT PRIMARY KEY NOT NULL,policy_id TEXT NOT NULL,policy_digest TEXT NOT NULL,draft_id TEXT UNIQUE NOT NULL,
    draft_hash TEXT NOT NULL,request_digest TEXT NOT NULL,content_digest TEXT NOT NULL,draft_bytes INTEGER NOT NULL,event_bytes INTEGER NOT NULL,event_count INTEGER NOT NULL,
    expires_at TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES experience_guest_sessions(session_id),FOREIGN KEY(policy_id) REFERENCES experience_guest_source_policies(policy_id))`,
  `CREATE TABLE experience_guest_source_commits(session_id TEXT PRIMARY KEY NOT NULL,draft_hash TEXT NOT NULL,head INTEGER NOT NULL,event_ids_json TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES experience_guest_sources(session_id))`,
  ...["experience_guest_sources", "experience_guest_source_commits"].flatMap(table => [
    `CREATE TRIGGER ${table}_insert BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE session_id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'guest source exists'); END`,
    ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'guest source immutable'); END`),
  ]),
  `CREATE TABLE experience_guest_source_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1))`,
] as const;

async function sourcePolicy(env: WorkerEnv, session: Session, policyId: string, active: boolean) {
  if (!guestId(policyId)) return guestFail("source_policy_unavailable");
  const row = await env.DB.prepare(`SELECT * FROM experience_guest_source_policies WHERE policy_id=?${active ? " AND revoked_at_ms IS NULL" : ""}`)
    .bind(policyId).first<{ policy_id: string; policy_digest: string; policy_json: string; review_digest: string }>();
  if (!row || !guestHash(row.review_digest) || bytes(row.policy_json) > 4096) return guestFail("source_policy_unavailable");
  let raw: unknown; try { raw = JSON.parse(row.policy_json); } catch { return guestFail("source_policy_unavailable"); }
  const policy = readGuestSourcePolicy(raw);
  if (row.policy_id !== policy.policyId || row.policy_digest !== await digest(policy) || row.policy_json !== canonicalJson(policy)
    || policy.sessionPolicyId !== session.row.policy_id || policy.sessionTermsDigest !== session.row.terms_digest) return guestFail("source_policy_unavailable");
  return { row, policy, guard: { sql: `EXISTS(SELECT 1 FROM experience_guest_source_policies WHERE policy_id=? AND policy_digest=? AND policy_json=? AND review_digest=?${active ? " AND revoked_at_ms IS NULL" : ""})`,
    bindings: [row.policy_id, row.policy_digest, row.policy_json, row.review_digest] } };
}

type SourceRow = { session_id: string; policy_id: string; policy_digest: string; draft_id: string; draft_hash: string; request_digest: string;
  content_digest: string; draft_bytes: number; event_bytes: number; event_count: number; expires_at: string; content: string };
async function original(env: WorkerEnv, session: Session) {
  const db = env.DB;
  const row = await env.DB.prepare(`SELECT source.*,body.content FROM experience_guest_sources source JOIN private_content body
    ON body.content_id=source.draft_id AND body.owner_id=? AND body.kind='experience-draft' AND body.redacted_at IS NULL
    AND body.expires_at=source.expires_at AND body.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE source.session_id=? AND length(CAST(body.content AS BLOB))=source.draft_bytes AND source.draft_bytes BETWEEN 1 AND 65536
      AND (${session.guard.sql})`).bind(session.row.guest_subject, session.row.session_id, ...session.guard.bindings).first<SourceRow>();
  if (env.DB !== db) return guestFail("database_changed");
  if (!row) return null;
  const policy = await sourcePolicy(env, session, row.policy_id, false);
  let plan: ExperiencePlan; try { plan = JSON.parse(row.content) as ExperiencePlan; } catch { return guestFail("source_unavailable"); }
  if (!record(plan) || jsonIssues(plan).length) return guestFail("source_unavailable");
  const { draftHash, ...base } = plan;
  if (plan.version !== 1 || plan.draftId !== row.draft_id || draftHash !== row.draft_hash || await digest(base) !== draftHash
    || canonicalJson(plan) !== row.content || await digest(row.content) !== row.content_digest || row.policy_digest !== policy.row.policy_digest
    || plan.streamId !== `creative:${session.row.guest_subject}` || plan.projectId !== session.row.project_id || plan.documentId !== session.row.document_id
    || plan.request?.intentId !== session.row.session_id || plan.request.experienceId !== "image" || plan.request.reference
    || plan.release?.releaseHash !== policy.policy.releaseHash || !Array.isArray(plan.events) || plan.events.length !== row.event_count
    || row.draft_bytes > policy.policy.maximumDraftBytes || row.event_bytes > policy.policy.maximumEventBytes || row.event_count > policy.policy.maximumEvents)
    return guestFail("source_unavailable");
  const proof = join(session.guard, policy.guard, { sql: `EXISTS(SELECT 1 FROM experience_guest_sources source JOIN private_content body
    ON body.content_id=source.draft_id AND body.owner_id=? AND body.kind='experience-draft' AND body.content=? AND body.expires_at=? AND body.redacted_at IS NULL
    WHERE source.session_id=? AND source.policy_id=? AND source.policy_digest=? AND source.draft_hash=? AND source.content_digest=?
      AND source.request_digest=? AND source.expires_at=body.expires_at AND source.draft_bytes=? AND source.event_bytes=? AND source.event_count=?
      AND body.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=body.content_id)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=body.content_id)
      AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='document' AND resource_id=?))`,
  bindings: [session.row.guest_subject, row.content, row.expires_at, row.session_id, row.policy_id, row.policy_digest, row.draft_hash,
    row.content_digest, row.request_digest, row.draft_bytes, row.event_bytes, row.event_count, plan.projectId, plan.documentId] });
  if (env.DB !== db) return guestFail("database_changed");
  return { row, plan: freeze(plan), policy, proof };
}
function assertion(env: WorkerEnv, proof: Proof) {
  const token = crypto.randomUUID();
  return [env.DB.prepare(`INSERT INTO experience_guest_source_assertions VALUES(?,CASE WHEN ${proof.sql} THEN 1 ELSE 0 END)`).bind(token, ...proof.bindings),
    env.DB.prepare("DELETE FROM experience_guest_source_assertions WHERE token=?").bind(token)];
}
async function preparedResponse(env: WorkerEnv, saved: NonNullable<Awaited<ReturnType<typeof original>>>, replayed: boolean) {
  const db = env.DB;
  if (!await db.prepare(`SELECT 1 WHERE ${saved.proof.sql}`).bind(...saved.proof.bindings).first()) return guestFail("source_unavailable");
  if (env.DB !== db) return guestFail("database_changed");
  return { status: "prepared" as const, plan: saved.plan, expiresAt: saved.row.expires_at, replayed };
}

/** Closed native Image source formation only; session leases do not themselves
 * authorize storage. An explicit finite source policy is independently required. */
export async function prepareGuestImageSource(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof; policyId: string; request: unknown }) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof", "policyId", "request"]) || bytes(canonicalJson(input)) > 32768) return guestFail("source_request_invalid");
  const captured = structuredClone(input), db = env.DB, session = await guestSession(env, request, captured.proof);
  const requestDigest = await digest(captured.request), existing = await original(env, session);
  if (env.DB !== db) return guestFail("database_changed");
  if (existing) {
    if (existing.row.policy_id !== captured.policyId || existing.row.request_digest !== requestDigest) return guestFail("source_conflict");
    return preparedResponse(env, existing, true);
  }
  const policy = await sourcePolicy(env, session, captured.policyId, true), validated = await validateIntakeRequest(captured.request);
  if (!validated || validated.request.experienceId !== "image" || validated.request.reference || validated.request.intentId !== session.row.session_id
    || validated.release.releaseHash !== policy.policy.releaseHash) return guestFail("source_request_invalid");
  const plan = await buildExperiencePlan(session.row.guest_subject, validated.request, validated.release);
  if (plan.projectId !== session.row.project_id || plan.documentId !== session.row.document_id) return guestFail("source_identity_incompatible");
  const content = canonicalJson(plan), draftBytes = bytes(content), contentDigest = await digest(content);
  const events = plan.events.map(e => makeEvent(plan.streamId, 0, session.row.guest_subject, "server:guest-source", plan.draftId, e.type, e.payload));
  // Explicit native payload budgets cover both private and public envelopes;
  // this is not a database filesystem-size or invoice estimate.
  const eventBytes = events.reduce((sum, event) => { const binding = eventWriteBindings(event); return sum + bytes(String(binding[12])) + bytes(String(binding[16])); }, 0);
  if (draftBytes > policy.policy.maximumDraftBytes || eventBytes > policy.policy.maximumEventBytes || events.length > policy.policy.maximumEvents) return guestFail("source_limit");
  const now = await db.prepare(`SELECT ${GUEST_DB_NOW} AS now`).first<{ now: number }>();
  if (!now || env.DB !== db) return guestFail("database_changed");
  const ceiling = new Date(Math.min(session.row.expires_at_ms, now.now + policy.policy.draftLifetimeMs)).toISOString();
  const guard = join(session.guard, policy.guard, { sql: `NOT EXISTS(SELECT 1 FROM events WHERE stream_id=?)
    AND NOT EXISTS(SELECT 1 FROM experience_guest_sources WHERE session_id=?)
    AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='document' AND resource_id=?)`,
  bindings: [plan.streamId, session.row.session_id, plan.projectId, plan.documentId] });
  const prepared = await preparePrivateContent(env, session.row.guest_subject, "experience-draft", content, undefined, undefined, guard, { contentId: plan.draftId }, ceiling);
  if (env.DB !== db) return guestFail("database_changed");
  try {
    await db.batch([...prepared.statements, db.prepare(`INSERT INTO experience_guest_sources VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(session.row.session_id, captured.policyId, policy.row.policy_digest, plan.draftId, plan.draftHash, requestDigest, contentDigest, draftBytes, eventBytes, events.length, prepared.expiresAt),
      ...assertion(env, join(session.guard, policy.guard, { sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
        AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      bindings: [plan.draftId, session.row.guest_subject, content, prepared.expiresAt] }))]);
  } catch (error) {
    if (env.DB !== db) return guestFail("database_changed");
    const saved = await original(env, session);
    if (!saved || saved.row.request_digest !== requestDigest || saved.row.policy_id !== captured.policyId) throw error;
    return preparedResponse(env, saved, true);
  }
  if (env.DB !== db) return guestFail("database_changed");
  const saved = await original(env, session); if (!saved) return guestFail("source_unavailable");
  return preparedResponse(env, saved, false);
}

type Saved = NonNullable<Awaited<ReturnType<typeof original>>>;
async function committed(env: WorkerEnv, session: Session, saved: Saved) {
  const db = env.DB;
  const expected = JSON.stringify(saved.plan.events.map((e, index) => ({ key: e.payload.client_event_id, type: e.type, payload: JSON.stringify(e.payload), sequence: index + 1 })));
  const rows = await env.DB.prepare(`SELECT expected.value AS expected,event.event_id,event.sequence,event.type,event.payload,body.private_json,body.project_id,body.document_id,
    commit_row.head,commit_row.event_ids_json FROM json_each(?) expected JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=json_extract(expected.value,'$.key')
    JOIN events event ON event.event_id=receipt.event_id AND event.stream_id=receipt.stream_id AND event.sequence=receipt.sequence AND event.actor=?
      AND event.client_id='server:guest-source' AND event.correlation_id=? AND event.schema_version=1 AND event.causation_id IS NULL AND event.compensates_event_id IS NULL
    JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.owner_id=? AND body.redacted_at IS NULL
    JOIN experience_guest_source_commits commit_row ON commit_row.session_id=? AND commit_row.draft_hash=?
    WHERE (${saved.proof.sql}) ORDER BY CAST(expected.key AS INTEGER)`)
    .bind(expected, saved.plan.streamId, session.row.guest_subject, saved.plan.draftId, session.row.guest_subject, session.row.session_id, saved.plan.draftHash, ...saved.proof.bindings)
    .all<{ expected: string; event_id: string; sequence: number; type: string; payload: string; private_json: string; project_id: string | null; document_id: string | null; head: number; event_ids_json: string }>();
  if (env.DB !== db) return guestFail("database_changed");
  if (!rows.results.length) {
    const receipt = await db.prepare(`SELECT 1 FROM experience_guest_source_commits WHERE session_id=? AND (${saved.proof.sql})`)
      .bind(session.row.session_id, ...saved.proof.bindings).first();
    if (env.DB !== db) return guestFail("database_changed");
    if (receipt) return guestFail("source_commit_unavailable");
    return null;
  }
  if (rows.results.length !== saved.plan.events.length) return guestFail("source_commit_unavailable");
  const ids = rows.results.map((row, index) => {
    const e = saved.plan.events[index];
    if (row.sequence !== index + 1 || row.type !== e.type || row.private_json !== JSON.stringify(e.payload)
      || row.payload !== JSON.stringify(publicEventPayload(row.event_id, e.payload, true).payload)
      || row.project_id !== (e.payload.project_id ?? null) || row.document_id !== (e.payload.document_id ?? null)
      || row.head !== saved.plan.events.length || row.event_ids_json !== rows.results[0].event_ids_json) return guestFail("source_commit_unavailable");
    return row.event_id;
  });
  if (JSON.stringify(ids) !== rows.results[0].event_ids_json) return guestFail("source_commit_unavailable");
  return { status: "complete" as const, documentId: saved.plan.documentId, projectId: saved.plan.projectId, head: saved.plan.events.length,
    eventIds: ids, route: experienceDocumentRoute(saved.plan), custodyTransferred: false as const };
}

/** Review of the unchanged saved draft commits actual native events/private
 * envelopes once. No PilotUser, trusted identity headers or user row is forged. */
export async function commitGuestImageSource(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof; draftHash: string }) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof", "draftHash"]) || !guestHash(input.draftHash)) return guestFail("source_request_invalid");
  const captured = structuredClone(input), db = env.DB, session = await guestSession(env, request, captured.proof), saved = await original(env, session);
  if (env.DB !== db) return guestFail("database_changed");
  if (!saved || saved.plan.draftHash !== captured.draftHash) return guestFail("source_unavailable");
  const prior = await committed(env, session, saved);
  if (env.DB !== db) return guestFail("database_changed");
  if (prior) return { ...prior, replayed: true };
  const policy = await sourcePolicy(env, session, saved.row.policy_id, true), live = join(saved.proof, policy.guard);
  if (env.DB !== db) return guestFail("database_changed");
  const events = saved.plan.events.map(e => makeEvent(saved.plan.streamId, 0, session.row.guest_subject, "server:guest-source", saved.plan.draftId, e.type, e.payload));
  try {
    await appendEvents(env, events, { expectedHead: 0, retries: 1, prepareSidecars: assigned => {
      const ids = JSON.stringify(assigned.map(e => e.eventId)), expected = JSON.stringify(assigned.map(e => ({ id: e.eventId, sequence: e.sequence, payload: JSON.stringify(e.payload), public: JSON.stringify(publicEventPayload(e.eventId, e.payload, true).payload), project: e.payload.project_id ?? null, document: e.payload.document_id ?? null, type: e.type })));
      return [...assigned.map(e => db.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) VALUES(?,?,?,?,?)")
        .bind(e.streamId, String(e.payload.client_event_id), e.eventId, e.sequence, e.recordedAt)),
      db.prepare("INSERT INTO experience_guest_source_commits VALUES(?,?,?,?)").bind(session.row.session_id, saved.plan.draftHash, assigned.length, ids),
      ...assertion(env, join(live, { sql: `(SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT COUNT(*) FROM json_each(?) expected
        JOIN events e ON e.event_id=json_extract(expected.value,'$.id') AND e.stream_id=? AND e.sequence=json_extract(expected.value,'$.sequence') AND e.type=json_extract(expected.value,'$.type') AND e.actor=?
          AND e.payload=json_extract(expected.value,'$.public') AND e.client_id='server:guest-source' AND e.correlation_id=? AND e.schema_version=1 AND e.causation_id IS NULL AND e.compensates_event_id IS NULL
        JOIN event_private_payloads body ON body.private_event_id=e.event_id AND body.owner_id=? AND body.private_json=json_extract(expected.value,'$.payload') AND body.redacted_at IS NULL
          AND body.project_id IS json_extract(expected.value,'$.project') AND body.document_id IS json_extract(expected.value,'$.document'))=?`,
      bindings: [saved.plan.streamId, assigned.length, expected, saved.plan.streamId, session.row.guest_subject, saved.plan.draftId, session.row.guest_subject, assigned.length] }))];
    } });
  } catch (error) {
    if (env.DB !== db) return guestFail("database_changed");
    const originalCommit = await committed(env, session, saved); if (!originalCommit) throw error;
    return { ...originalCommit, replayed: true };
  }
  if (env.DB !== db) return guestFail("database_changed");
  const result = await committed(env, session, saved); if (!result) return guestFail("source_commit_unavailable");
  return { ...result, replayed: false };
}

/** Server-internal read-only source proof for a separately governed custody
 * inventory. It never prepares or commits a source and is not a claim witness
 * or canonical account authority. No route exposes this proof object. */
export async function readGuestImageSourceForCustody(request: Request, env: WorkerEnv, proof: GuestClaimProof) {
  if (jsonIssues(proof).length) return guestFail("proof_unavailable");
  const captured = structuredClone(proof), db = env.DB;
  const session = await guestSession(env, request, captured);
  if (env.DB !== db) return guestFail("database_changed");
  const saved = await original(env, session);
  if (env.DB !== db) return guestFail("database_changed");
  if (!saved) return guestFail("source_unavailable");
  const commit = await committed(env, session, saved);
  if (env.DB !== db) return guestFail("database_changed");
  if (!commit) return guestFail("source_commit_unavailable");
  return freeze({ session, saved, commit });
}
