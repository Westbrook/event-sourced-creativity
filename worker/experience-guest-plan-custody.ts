import { canonicalJson, compileExperience, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceDraftId, experienceDocumentRoute, isDraftId, type ExperiencePlan } from "../src/experiences/intake.ts";
import { guestContextAdoptionData, inspectGuestContextAdoption, type GuestContextAdoptionWitness } from "./experience-guest-context-adoption.ts";
import { guestFail, guestHash, guestId } from "./experience-guest-session.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { preparePrivateContent } from "./private-content-storage.ts";
import type { WorkerEnv } from "./runtime.ts";

type Proof = { sql: string; bindings: (string | number | null)[] };
type Adoption = ReturnType<typeof guestContextAdoptionData>;
type Mapping = { session_id: string; destination_user_id: string; draft_id: string; content_id: string; draft_hash: string;
  content_digest: string; lineage_digest: string; created_at: string; expires_at: string };
type Source = { session_id: string; policy_id: string; policy_digest: string; draft_id: string; draft_hash: string; request_digest: string;
  content_digest: string; draft_bytes: number; event_bytes: number; event_count: number; expires_at: string };
const mappingColumns = "session_id,destination_user_id,draft_id,content_id,draft_hash,content_digest,lineage_digest,created_at,expires_at";
const sourceColumns = "session_id,policy_id,policy_digest,draft_id,draft_hash,request_digest,content_digest,draft_bytes,event_bytes,event_count,expires_at";
const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const tuple = (row: object, columns: string) => JSON.stringify(columns.split(",").map(key => (row as Record<string, unknown>)[key]));
// Sibling proof relations preserve each complete authority boundary without
// accumulating an unbounded outer AND tree in the pinned D1 engine.
function all(...proofs: Proof[]): Proof {
  return { sql: `EXISTS(WITH ${proofs.map((proof, i) => `p${i} AS MATERIALIZED(SELECT 1 WHERE ${proof.sql})`).join(",")}
    SELECT 1 FROM ${proofs.map((_, i) => `p${i}`).join(",")})`, bindings: proofs.flatMap(proof => proof.bindings) };
}
function bound(env: WorkerEnv, db: WorkerEnv["DB"]) { if (env.DB !== db) return guestFail("database_changed"); }
function assert(env: WorkerEnv, proof: Proof) {
  const token = crypto.randomUUID();
  return [env.DB.prepare(`INSERT INTO experience_guest_plan_custody_assertions VALUES(?,CASE WHEN ${proof.sql} THEN 1 ELSE 0 END)`).bind(token, ...proof.bindings),
    env.DB.prepare("DELETE FROM experience_guest_plan_custody_assertions WHERE token=?").bind(token)];
}
/** Inert mapping only. Original guest identities, events, bytes and lifetimes
 * remain unchanged. This module installs no schema and exposes no route. */
export const GUEST_PLAN_CUSTODY_SCHEMA = [
  `CREATE TABLE experience_guest_plan_custodies(session_id TEXT PRIMARY KEY NOT NULL,destination_user_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,content_id TEXT UNIQUE NOT NULL,draft_hash TEXT NOT NULL,content_digest TEXT NOT NULL,lineage_digest TEXT NOT NULL,
    created_at TEXT NOT NULL,expires_at TEXT NOT NULL,UNIQUE(destination_user_id,draft_id),
    FOREIGN KEY(session_id) REFERENCES experience_guest_context_adoptions(session_id))`,
  `CREATE TRIGGER experience_guest_plan_custody_insert BEFORE INSERT ON experience_guest_plan_custodies WHEN EXISTS(SELECT 1 FROM experience_guest_plan_custodies WHERE session_id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'guest plan custody exists'); END`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_guest_plan_custody_${action.toLowerCase()} BEFORE ${action} ON experience_guest_plan_custodies BEGIN SELECT RAISE(ABORT,'guest plan custody immutable'); END`),
  `CREATE TABLE experience_guest_plan_custody_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1))`,
] as const;
async function identity(data: Adoption) {
  return `experience-draft-${(await digest({ domain: "forma-guest-plan-custody-v1", sessionId: data.lineage.sessionId,
    destinationUserId: data.lineage.destinationUserId, lineageDigest: data.row.lineage_digest })).slice(7)}`;
}
function personalContent(): string {
  return `NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=content.content_id)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=content.content_id)`;
}
async function validatePlan(content: string, data: Adoption, expectedId: string, expectedDigest: string) {
  if (typeof content !== "string" || !content.isWellFormed() || bytes(content) < 1 || bytes(content) > 65536) return guestFail("plan_unavailable");
  let plan: ExperiencePlan; try { plan = JSON.parse(content) as ExperiencePlan; } catch { return guestFail("plan_unavailable"); }
  if (!record(plan) || jsonIssues(plan).length || plan.version !== 1 || !record(plan.request) || !record(plan.release)
    || plan.draftId !== expectedId || plan.draftHash !== data.lineage.draftHash || plan.streamId !== `creative:${data.lineage.guestSubject}`
    || plan.projectId !== data.lineage.projectId || plan.documentId !== data.lineage.documentId || plan.request.intentId !== data.lineage.sessionId
    || plan.request.experienceId !== "image" || plan.release.output?.output !== "image" || plan.request.releaseHash !== plan.release.releaseHash
    || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference") || !Array.isArray(plan.events)
    || plan.events.length !== data.lineage.events.length || canonicalJson(plan) !== content || await digest(content) !== expectedDigest
    || await experienceDraftId(data.lineage.guestSubject, data.lineage.sessionId) !== expectedId) return guestFail("plan_unavailable");
  const compiled = await compileExperience(plan.release.definition, { version: "forma-experience-context@2", qualification: "context-authoring",
    interactions: Object.fromEntries(Object.values(plan.release.interactions).map(interaction => [interaction.id, interaction])),
    outputs: { [plan.release.output.id]: plan.release.output }, copy: plan.release.copy });
  if (!compiled.ok || canonicalJson(compiled.release) !== canonicalJson(plan.release)
    || canonicalJson(await buildExperiencePlan(data.lineage.guestSubject, plan.request, plan.release)) !== content
    || plan.events.some((event, i) => event.type !== data.lineage.events[i].type
      || canonicalJson({ ...event.payload, client_event_id: data.lineage.events[i].key }) !== canonicalJson(JSON.parse(data.bodies[i]))))
    return guestFail("plan_unavailable");
  return freeze(plan);
}
function response(plan: ExperiencePlan, data: Adoption, mapping: Mapping, replayed: boolean) {
  const lineage = data.lineage;
  return freeze({ version: 1 as const, status: "context-only" as const, plan, expiresAt: mapping.expires_at,
    custody: { version: 1 as const, kind: "guest-context" as const, sessionId: lineage.sessionId, destinationUserId: lineage.destinationUserId,
      manifestDigest: lineage.manifestDigest, lineageDigest: data.row.lineage_digest, draftId: plan.draftId, draftHash: plan.draftHash,
      projectId: plan.projectId, documentId: plan.documentId, targetStreamId: `creative:${lineage.destinationUserId}`,
      eventIds: lineage.events.map(event => event.id), head: lineage.targetHead, documentRoute: experienceDocumentRoute(plan),
      appended: lineage.events.map((event, i) => ({ eventId: event.id, streamId: `creative:${lineage.destinationUserId}`, sequence: event.sequence,
        occurredAt: event.occurred, recordedAt: event.recorded, actor: "user", clientId: "server:guest-context-adoption",
        correlationId: `guest-context-adoption:${lineage.sessionId}`, causationId: null, compensatesEventId: null, schemaVersion: 1,
        type: event.type, payload: JSON.parse(data.bodies[i]) as Record<string, unknown> })) },
    generationAvailable: false as const, miniAppClaimComplete: false as const, replayed });
}
function mappingProof(mapping: Mapping, content: string, exclusion: Proof): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_plan_custodies mapping JOIN private_content content ON content.content_id=mapping.content_id
    WHERE json_array(${mappingColumns.split(",").map(key => `mapping.${key}`).join(",")})=?
      AND content.owner_id=mapping.destination_user_id AND content.kind='experience-draft' AND content.content=?
      AND content.created_at=mapping.created_at AND content.expires_at=mapping.expires_at AND content.redacted_at IS NULL
      AND content.expires_at>${now} AND (${personalContent()}) AND (${exclusion.sql}))`,
  bindings: [tuple(mapping, mappingColumns), content, ...exclusion.bindings] };
}
async function existing(request: Request, env: WorkerEnv, witness: GuestContextAdoptionWitness, mapping: Mapping) {
  const db = env.DB, data = guestContextAdoptionData(env, witness);
  if (mapping.session_id !== data.lineage.sessionId || mapping.destination_user_id !== data.lineage.destinationUserId
    || mapping.draft_hash !== data.lineage.draftHash || mapping.lineage_digest !== data.row.lineage_digest || !guestHash(mapping.content_digest)
    || mapping.content_id !== await identity(data) || mapping.draft_id !== await experienceDraftId(data.lineage.guestSubject, data.lineage.sessionId))
    return guestFail("plan_unavailable");
  bound(env, db);
  const exclusion = await nativeMemoryAnswerExclusion(env, { answerAlias: "content" }); bound(env, db);
  const proof = all(data.proof, { sql: `EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=?
    AND content.kind='experience-draft' AND content.redacted_at IS NULL AND content.expires_at>${now} AND (${personalContent()}) AND (${exclusion.sql}))`,
  bindings: [mapping.content_id, mapping.destination_user_id, ...exclusion.bindings] });
  const row = await db.prepare(`SELECT content FROM private_content WHERE content_id=? AND length(CAST(content AS BLOB)) BETWEEN 1 AND 65536 AND ${proof.sql}`)
    .bind(mapping.content_id, ...proof.bindings).first<{ content: string }>(); bound(env, db);
  if (!row) return guestFail("plan_unavailable");
  const plan = await validatePlan(row.content, data, mapping.draft_id, mapping.content_digest); bound(env, db);
  const final = all(data.proof, mappingProof(mapping, row.content, exclusion));
  if (!await db.prepare(`SELECT 1 WHERE ${final.sql}`).bind(...final.bindings).first()) return guestFail("plan_unavailable");
  bound(env, db);
  return response(plan, data, mapping, true);
}
/** Canonical read only. Missing dormant support never installs or initializes it. */
export async function readGuestContextPlan(request: Request, env: WorkerEnv, input: { draftId: string }) {
  if (request.method !== "GET" || jsonIssues(input).length || !record(input) || !exactKeys(input, ["draftId"]) || !isDraftId(input.draftId)) return guestFail("plan_invalid");
  const db = env.DB, draftId = input.draftId;
  const schema = await db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='experience_guest_plan_custodies'").first(); bound(env, db);
  if (!schema) return null;
  // A draft ID is a lookup selector, never authorization. Private bytes are read
  // only after the canonical destination's complete custody witness is proven.
  const mapping = await db.prepare(`SELECT ${mappingColumns} FROM experience_guest_plan_custodies WHERE draft_id=?`).bind(draftId).first<Mapping>(); bound(env, db);
  if (!mapping) return null;
  const witness = await inspectGuestContextAdoption(request, env, { sessionId: mapping.session_id }); bound(env, db);
  if (!witness) return guestFail("plan_unavailable");
  const result = await existing(request, env, witness, mapping); bound(env, db);
  return result;
}
/** Retain original saved settings after context adoption. This is a new native
 * canonical private copy under its ordinary retention policy; it never extends
 * or relabels the guest source. No output authority or provider work is created. */
export async function retainGuestContextPlan(request: Request, env: WorkerEnv, input: { sessionId: string }) {
  if (request.method !== "POST" || jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return guestFail("plan_invalid");
  const db = env.DB, sessionId = input.sessionId, witness = await inspectGuestContextAdoption(request, env, { sessionId }); bound(env, db);
  if (!witness) return guestFail("plan_unavailable");
  const data = guestContextAdoptionData(env, witness), prior = await db.prepare(`SELECT ${mappingColumns} FROM experience_guest_plan_custodies WHERE session_id=?`).bind(sessionId).first<Mapping>(); bound(env, db);
  if (prior) { const result = await existing(request, env, witness, prior); bound(env, db); return result; }
  const draftId = await experienceDraftId(data.lineage.guestSubject, sessionId), exclusion = await nativeMemoryAnswerExclusion(env, { answerAlias: "content" }); bound(env, db);
  const original = { sql: `EXISTS(SELECT 1 FROM experience_guest_sources source JOIN private_content content ON content.content_id=source.draft_id
    WHERE source.session_id=? AND source.draft_id=? AND source.draft_hash=? AND content.owner_id=? AND content.kind='experience-draft'
      AND content.redacted_at IS NULL AND content.expires_at=source.expires_at AND content.expires_at>${now}
      AND source.draft_bytes BETWEEN 1 AND 65536 AND length(CAST(content.content AS BLOB))=source.draft_bytes
      AND (${personalContent()}) AND (${exclusion.sql}))`, bindings: [sessionId, draftId, data.lineage.draftHash, data.lineage.guestSubject, ...exclusion.bindings] };
  const readProof = all(data.proof, original);
  const source = await db.prepare(`SELECT source.*,content.content FROM experience_guest_sources source JOIN private_content content ON content.content_id=source.draft_id
    WHERE source.session_id=? AND ${readProof.sql}`).bind(sessionId, ...readProof.bindings).first<Source & { content: string }>(); bound(env, db);
  if (!source) return guestFail("plan_unavailable");
  const plan = await validatePlan(source.content, data, draftId, source.content_digest); bound(env, db);
  if (source.event_count !== plan.events.length || source.request_digest !== await digest(plan.request)) return guestFail("plan_unavailable");
  const sourceProof = all(original, { sql: `EXISTS(SELECT 1 FROM experience_guest_sources source JOIN private_content content ON content.content_id=source.draft_id
    WHERE json_array(${sourceColumns.split(",").map(key => `source.${key}`).join(",")})=? AND content.content=?)`, bindings: [tuple(source, sourceColumns), source.content] });
  const guard = all(data.proof, sourceProof), contentId = await identity(data); bound(env, db);
  const prepared = await preparePrivateContent(env, data.lineage.destinationUserId, "experience-draft", source.content, undefined, undefined, guard, { contentId }); bound(env, db);
  const mapping: Mapping = { session_id: sessionId, destination_user_id: data.lineage.destinationUserId, draft_id: draftId, content_id: contentId,
    draft_hash: plan.draftHash, content_digest: source.content_digest, lineage_digest: data.row.lineage_digest, created_at: prepared.createdAt, expires_at: prepared.expiresAt };
  try {
    const statements = [...prepared.statements,
      db.prepare(`INSERT INTO experience_guest_plan_custodies(${mappingColumns}) VALUES(?,?,?,?,?,?,?,?,?)`).bind(...JSON.parse(tuple(mapping, mappingColumns)) as string[]),
      ...assert(env, all(data.proof, sourceProof, mappingProof(mapping, source.content, exclusion)))];
    const results = await db.batch(statements); bound(env, db);
    if (!Array.isArray(results) || results.length !== statements.length || results.some(result => result?.success !== true)
      || results.slice(0, prepared.requiredInserts).some(result => Number(result?.meta.changes) !== 1)
      || Number(results[prepared.statements.length]?.meta.changes) !== 1) return guestFail("plan_save_unconfirmed");
  } catch (error) {
    bound(env, db);
    const recovered = await db.prepare(`SELECT ${mappingColumns} FROM experience_guest_plan_custodies WHERE session_id=?`).bind(sessionId).first<Mapping>(); bound(env, db);
    if (!recovered) throw error;
    const current = await inspectGuestContextAdoption(request, env, { sessionId }); bound(env, db);
    if (!current) return guestFail("plan_unavailable");
    const result = await existing(request, env, current, recovered); bound(env, db);
    return result;
  }
  bound(env, db);
  const current = await inspectGuestContextAdoption(request, env, { sessionId }); bound(env, db);
  if (!current) return guestFail("plan_unavailable");
  const result = await existing(request, env, current, mapping); bound(env, db);
  return { ...result, replayed: false };
}
