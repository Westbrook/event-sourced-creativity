import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceDocumentRoute } from "../src/experiences/intake.ts";
import { appendEvents } from "./event-append.ts";
import { eventWriteBindings, makeEvent, type EventRow } from "./event-write-primitives.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { GUEST_DB_NOW, guestFail, guestHash, guestId } from "./experience-guest-session.ts";
import { guestContextInventoryData, type GuestContextInventory } from "./experience-guest-context-inventory.ts";
import type { WorkerEnv } from "./runtime.ts";

type Proof = { sql: string; bindings: (string | number | null)[] };
type Lease = { session_id: string; lease_id: string; destination_user_id: string; manifest_digest: string; request_id: string;
  request_ids_json: string; acquisitions: number; created_at_ms: number; expires_at_ms: number };
type Target = { id: string; sequence: number; occurred: string; recorded: string; type: string; public: string;
  privateDigest: string; project: string | null; document: string | null; key: string };
type Lineage = { version: 1; sessionId: string; guestSubject: string; projectId: string; documentId: string; draftHash: string;
  manifestDigest: string; sourceEventIds: readonly string[]; sourceHead: number; destinationUserId: string; origin: string;
  targetStart: number; targetHead: number; events: readonly Target[]; lease: Lease };
const leaseColumns = "session_id,lease_id,destination_user_id,manifest_digest,request_id,request_ids_json,acquisitions,created_at_ms,expires_at_ms";
type Receipt = { session_id: string; destination_user_id: string; lease_id: string; request_id: string; manifest_digest: string;
  lineage_json: string; lineage_digest: string; created_at_ms: number };
const client = "server:guest-context-adoption", correlation = (id: string) => `guest-context-adoption:${id}`;
const eventKey = (id: string, index: number) => `guest-context-adoption:v1:${id}:${index}`;
const json = (value: unknown) => JSON.stringify(value);
const join = (...proofs: Proof[]): Proof => ({ sql: proofs.map(p => `(${p.sql})`).join(" AND "), bindings: proofs.flatMap(p => p.bindings) });

/** Inert context-only custody schema. No route, installer or active policy imports it. */
export const GUEST_CONTEXT_ADOPTION_SCHEMA = [
  `CREATE TABLE experience_guest_context_adoptions(session_id TEXT PRIMARY KEY NOT NULL,destination_user_id TEXT NOT NULL,
    lease_id TEXT UNIQUE NOT NULL,request_id TEXT NOT NULL,manifest_digest TEXT NOT NULL,lineage_json TEXT NOT NULL,
    lineage_digest TEXT NOT NULL,created_at_ms INTEGER NOT NULL,FOREIGN KEY(session_id) REFERENCES experience_guest_sessions(session_id))`,
  `CREATE TRIGGER experience_guest_context_adoption_insert BEFORE INSERT ON experience_guest_context_adoptions WHEN EXISTS(SELECT 1 FROM experience_guest_context_adoptions WHERE session_id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'guest context adoption exists'); END`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_guest_context_adoption_${action.toLowerCase()} BEFORE ${action} ON experience_guest_context_adoptions BEGIN SELECT RAISE(ABORT,'guest context adoption immutable'); END`),
  `CREATE TABLE experience_guest_context_adoption_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1))`,
] as const;
function assertions(env: WorkerEnv, proofs: Proof[]) {
  return proofs.flatMap(proof => {
    const token = crypto.randomUUID();
    return [env.DB.prepare(`INSERT INTO experience_guest_context_adoption_assertions VALUES(?,CASE WHEN ${proof.sql} THEN 1 ELSE 0 END)`).bind(token, ...proof.bindings),
      env.DB.prepare("DELETE FROM experience_guest_context_adoption_assertions WHERE token=?").bind(token)];
  });
}
async function destination(request: Request, env: WorkerEnv): Promise<ProjectIntakeAuthorization> {
  if (/(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return guestFail("personal_principal_required");
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || !auth.user.access.capabilities.includes("project.author") || auth.user.userId.startsWith("guest:")) return guestFail("destination_unavailable");
  return { user: auth.user, principal: auth.user, impersonation: null };
}
function origin(request: Request, expected: string) {
  if (request.method !== "POST" || new URL(request.url).origin !== expected || request.headers.get("origin") !== expected) guestFail("origin_required");
}
function leaseProof(lease: Lease, active: boolean): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=? AND lease_id=? AND destination_user_id=?
    AND manifest_digest=? AND request_id=? AND request_ids_json=? AND acquisitions=? AND created_at_ms=? AND expires_at_ms=?${active ? ` AND expires_at_ms>${GUEST_DB_NOW}` : ""})`,
  bindings: [lease.session_id, lease.lease_id, lease.destination_user_id, lease.manifest_digest, lease.request_id,
    lease.request_ids_json, lease.acquisitions, lease.created_at_ms, lease.expires_at_ms] };
}
function receiptProof(row: Receipt): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_context_adoptions WHERE session_id=? AND destination_user_id=? AND lease_id=?
    AND request_id=? AND manifest_digest=? AND lineage_json=? AND lineage_digest=? AND created_at_ms=?)`,
  bindings: [row.session_id, row.destination_user_id, row.lease_id, row.request_id, row.manifest_digest, row.lineage_json, row.lineage_digest, row.created_at_ms] };
}
function currentCustody(lineage: Lineage): Proof {
  // Native resource IDs are global. A prefix block can leave personal custody
  // without changing its immutable event or the containing Document's scope.
  const blocks = json(lineage.events.filter(event => event.type === "BlockCreated")
    .flatMap(event => { const block = (JSON.parse(event.public) as Record<string, unknown>).block_id; return typeof block === "string" ? [block] : []; }));
  const resources = json([...new Set([lineage.projectId, lineage.documentId,
    ...lineage.events.flatMap(event => { const block = (JSON.parse(event.public) as Record<string, unknown>).block_id; return typeof block === "string" ? [block] : []; })])]);
  return { sql: `NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='document' AND resource_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='block' AND resource_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND (type='ProjectRemoved' AND json_extract(payload,'$.project_id')=?
      OR type='DocumentRemoved' AND json_extract(payload,'$.document_id')=?))
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id IN(SELECT json_extract(value,'$.id') FROM json_each(?)))
    AND NOT EXISTS(WITH reserved(id) AS(SELECT value FROM json_each(?))
      SELECT 1 FROM events replacement WHERE replacement.stream_id=? AND replacement.event_id NOT IN(SELECT json_extract(value,'$.id') FROM json_each(?))
        AND (replacement.type='ProjectCreated' AND json_extract(replacement.payload,'$.project_id') IN(SELECT id FROM reserved)
          OR replacement.type IN('DocumentCreated','DocumentForked') AND (json_extract(replacement.payload,'$.document_id') IN(SELECT id FROM reserved)
            OR json_extract(replacement.payload,'$.new_document_id') IN(SELECT id FROM reserved))
          OR replacement.type='BlockCreated' AND json_extract(replacement.payload,'$.block_id') IN(SELECT id FROM reserved)))`,
  bindings: [lineage.projectId, lineage.documentId, blocks, `creative:${lineage.destinationUserId}`, lineage.projectId, lineage.documentId, json(lineage.events),
    resources, `creative:${lineage.destinationUserId}`, json(lineage.events)] };
}
function targetProof(lineage: Lineage, privateBodies: readonly string[]): Proof {
  const expected = lineage.events.map((event, i) => ({ ...event, private: privateBodies[i] }));
  return { sql: `(SELECT COUNT(*) FROM json_each(?) expected
    JOIN events event ON event.event_id=json_extract(expected.value,'$.id') AND event.stream_id=? AND event.sequence=json_extract(expected.value,'$.sequence')
      AND event.occurred_at=json_extract(expected.value,'$.occurred') AND event.recorded_at=json_extract(expected.value,'$.recorded')
      AND event.actor='user' AND event.client_id=? AND event.correlation_id=? AND event.schema_version=1 AND event.causation_id IS NULL AND event.compensates_event_id IS NULL
      AND event.type=json_extract(expected.value,'$.type') AND event.payload=json_extract(expected.value,'$.public')
    JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.owner_id=? AND body.redacted_at IS NULL
      AND body.project_id IS json_extract(expected.value,'$.project') AND body.document_id IS json_extract(expected.value,'$.document')
      AND body.private_json=json_extract(expected.value,'$.private') AND body.created_at=event.recorded_at
    JOIN event_client_receipts receipt ON receipt.stream_id=event.stream_id AND receipt.event_id=event.event_id AND receipt.sequence=event.sequence
      AND receipt.client_event_id=json_extract(expected.value,'$.key') AND receipt.created_at=event.recorded_at)=?`,
  bindings: [json(expected), `creative:${lineage.destinationUserId}`, client, correlation(lineage.sessionId), lineage.destinationUserId, expected.length] };
}
function tombstone(lineage: Lineage, row: Receipt): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_sessions session JOIN experience_guest_source_commits source ON source.session_id=session.session_id
    WHERE session.session_id=? AND session.guest_subject=? AND session.project_id=? AND session.document_id=? AND session.revoked_at_ms=?
      AND source.draft_hash=? AND source.head=? AND source.event_ids_json=?)`,
  bindings: [lineage.sessionId, lineage.guestSubject, lineage.projectId, lineage.documentId, row.created_at_ms,
    lineage.draftHash, lineage.sourceHead, json(lineage.sourceEventIds)] };
}
function parseLineage(row: Receipt): Lineage {
  let value: unknown; try { value = JSON.parse(row.lineage_json); } catch { return guestFail("adoption_unavailable"); }
  if (!record(value) || !record(value.lease) || typeof value.lease.request_ids_json !== "string" || value.lease.request_ids_json.length > 16_301
    // Lease history has its own original bounded grammar (100 IDs). Applying
    // the interface-definition 8192-character string limit would strand a
    // valid completed adoption after enough authorized lease reacquisitions.
    || jsonIssues({ ...value, lease: { ...value.lease, request_ids_json: "" } }).length || value.version !== 1 || !exactKeys(value, ["version", "sessionId", "guestSubject", "projectId", "documentId", "draftHash", "manifestDigest", "sourceEventIds", "sourceHead", "destinationUserId", "origin", "targetStart", "targetHead", "events", "lease"])
    || value.sessionId !== row.session_id || value.destinationUserId !== row.destination_user_id || value.manifestDigest !== row.manifest_digest
    || !guestHash(row.lineage_digest) || !Number.isSafeInteger(row.created_at_ms) || row.created_at_ms < 0
    || typeof value.guestSubject !== "string" || !value.guestSubject.startsWith("guest:")
    || !guestHash(value.draftHash) || !guestHash(value.manifestDigest) || !guestId(value.projectId) || !guestId(value.documentId)
    || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 16 || !Array.isArray(value.sourceEventIds)
    || value.sourceEventIds.length !== value.events.length || value.sourceHead !== value.events.length || value.sourceEventIds.some(id => !guestId(id))
    || new Set(value.sourceEventIds).size !== value.sourceEventIds.length
    || !Number.isSafeInteger(value.targetStart) || Number(value.targetStart) < 1 || value.targetHead !== Number(value.targetStart) + value.events.length - 1
    || !record(value.lease) || !exactKeys(value.lease, leaseColumns.split(",")) || value.lease.session_id !== row.session_id || value.lease.lease_id !== row.lease_id || value.lease.request_id !== row.request_id
    || value.lease.destination_user_id !== row.destination_user_id || value.lease.manifest_digest !== row.manifest_digest
    || typeof value.origin !== "string" || !value.origin.startsWith("https://") || canonicalJson(value) !== row.lineage_json) return guestFail("adoption_unavailable");
  const lineage = value as Lineage;
  let history: unknown; try { history = JSON.parse(lineage.lease.request_ids_json); } catch { return guestFail("adoption_unavailable"); }
  if (!Array.isArray(history) || history.length < 1 || history.length > 100 || history.length !== lineage.lease.acquisitions
    || history.some(id => !guestId(id)) || new Set(history).size !== history.length || history.at(-1) !== lineage.lease.request_id
    || json(history) !== lineage.lease.request_ids_json || !Number.isSafeInteger(lineage.lease.created_at_ms)
    || !Number.isSafeInteger(lineage.lease.expires_at_ms) || lineage.lease.created_at_ms < 0 || lineage.lease.expires_at_ms <= lineage.lease.created_at_ms)
    return guestFail("adoption_unavailable");
  if (lineage.events.some((event, i) => !record(event) || !exactKeys(event, ["id", "sequence", "occurred", "recorded", "type", "public", "privateDigest", "project", "document", "key"])
    || !guestId(event.id) || !guestHash(event.privateDigest) || event.sequence !== lineage.targetStart + i || event.key !== eventKey(lineage.sessionId, i)
    || typeof event.occurred !== "string" || typeof event.recorded !== "string" || typeof event.public !== "string"
    || !["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen", "BlockCreated"].includes(event.type)
    || event.project !== lineage.projectId || event.document !== (event.type === "ProjectCreated" ? null : lineage.documentId))
    || new Set(lineage.events.map(event => event.id)).size !== lineage.events.length) return guestFail("adoption_unavailable");
  return lineage;
}
function result(lineage: Lineage, replayed: boolean) {
  return freeze({ version: 1 as const, status: "context-adopted" as const, sessionId: lineage.sessionId, destinationUserId: lineage.destinationUserId,
    leaseId: lineage.lease.lease_id, requestId: lineage.lease.request_id, manifestDigest: lineage.manifestDigest,
    projectId: lineage.projectId, documentId: lineage.documentId, eventIds: lineage.events.map(e => e.id), head: lineage.targetHead,
    route: experienceDocumentRoute({ documentId: lineage.documentId, title: "Image" }), contextCustodyTransferred: true as const,
    miniAppClaimComplete: false as const, replayed });
}
/** Resume from immutable lineage and current canonical custody. Revoked/expired
 * guest proof is never revived, and missing private copies are never recreated. */
async function readAdoptionData(request: Request, env: WorkerEnv, input: { sessionId: string }, canonicalRead = false) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return guestFail("adoption_invalid");
  const captured = structuredClone(input), db = env.DB, auth = await destination(request, env);
  if (env.DB !== db) return guestFail("database_changed");
  const row = await db.prepare("SELECT * FROM experience_guest_context_adoptions WHERE session_id=? AND destination_user_id=? AND length(CAST(lineage_json AS BLOB)) BETWEEN 1 AND 65536")
    .bind(captured.sessionId, auth.user.userId).first<Receipt>();
  if (env.DB !== db) return guestFail("database_changed");
  if (!row) return null;
  const lineage = parseLineage(row);
  if (canonicalRead && request.method === "GET") {
    if (new URL(request.url).origin !== lineage.origin || request.headers.has("origin") && request.headers.get("origin") !== lineage.origin
      || request.headers.get("sec-fetch-site") === "cross-site")
      return guestFail("origin_required");
  } else origin(request, lineage.origin);
  if (await digest(lineage) !== row.lineage_digest) return guestFail("adoption_unavailable");
  const native = projectIntakeAuthority(env, auth, lineage), custody = currentCustody(lineage);
  if (env.DB !== db) return guestFail("database_changed");
  const read = await db.prepare(`SELECT body.private_json FROM json_each(?) expected JOIN event_private_payloads body ON body.private_event_id=json_extract(expected.value,'$.id')
    AND body.owner_id=? AND body.redacted_at IS NULL WHERE (${native.sql}) AND (${custody.sql}) ORDER BY CAST(expected.key AS INTEGER)`)
    .bind(json(lineage.events), auth.user.userId, ...native.bindings, ...custody.bindings).all<{ private_json: string }>();
  if (env.DB !== db) return guestFail("database_changed");
  const bodies = read.results.map(r => r.private_json);
  if (bodies.length !== lineage.events.length || (await Promise.all(bodies.map(body => digest(body)))).some((hash, i) => hash !== lineage.events[i].privateDigest)) return guestFail("adoption_unavailable");
  const final = join(native, custody, receiptProof(row), leaseProof(lineage.lease, false), tombstone(lineage, row), targetProof(lineage, bodies));
  if (env.DB !== db) return guestFail("database_changed");
  if (!await db.prepare(`SELECT 1 AS current WHERE ${final.sql}`).bind(...final.bindings).first()) return guestFail("adoption_unavailable");
  if (env.DB !== db) return guestFail("database_changed");
  return { result: result(lineage, true), lineage, row, bodies, auth, proof: final };
}

/** Existing public completed-claim read retains its POST/origin contract. */
export async function readGuestContextAdoption(request: Request, env: WorkerEnv, input: { sessionId: string }) {
  const db = env.DB, data = await readAdoptionData(request, env, input);
  if (env.DB !== db) return guestFail("database_changed");
  return data?.result ?? null;
}

/** Internal canonical read witness. The original actor/plan remain guest-owned;
 * this proves only the already completed canonical context copy. Serialization
 * never carries the private proof, and every mutation must repeat it atomically. */
export type GuestContextAdoptionWitness = Readonly<{ version: 1; kind: "canonical-guest-context"; sessionId: string;
  destinationUserId: string; projectId: string; documentId: string; manifestDigest: string }>;
const adoptionWitnesses = new WeakMap<GuestContextAdoptionWitness, { db: WorkerEnv["DB"]; data: NonNullable<Awaited<ReturnType<typeof readAdoptionData>>> }>();
export async function inspectGuestContextAdoption(request: Request, env: WorkerEnv, input: { sessionId: string }) {
  const db = env.DB, data = await readAdoptionData(request, env, input, true);
  if (env.DB !== db) return guestFail("database_changed");
  if (!data) return null;
  const witness: GuestContextAdoptionWitness = Object.freeze({ version: 1, kind: "canonical-guest-context", sessionId: data.lineage.sessionId,
    destinationUserId: data.lineage.destinationUserId, projectId: data.lineage.projectId, documentId: data.lineage.documentId,
    manifestDigest: data.lineage.manifestDigest });
  adoptionWitnesses.set(witness, { db, data: freeze(data) });
  return witness;
}
export function guestContextAdoptionData(env: WorkerEnv, witness: GuestContextAdoptionWitness) {
  const saved = witness && typeof witness === "object" ? adoptionWitnesses.get(witness) : undefined;
  if (!saved) return guestFail("adoption_unavailable");
  if (env.DB !== saved.db) return guestFail("database_changed");
  return saved.data;
}

/** A closed, context-only baseline copy. Original actor/IDs/financial history
 * remain immutable; this does not adopt generated media or a mini-app draft. */
export async function adoptGuestContextSource(request: Request, env: WorkerEnv,
  input: { inventory: GuestContextInventory; leaseId: string; requestId: string }) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["inventory", "leaseId", "requestId"])
    || !guestId(input.leaseId) || !guestId(input.requestId)) return guestFail("adoption_invalid");
  const { inventory, leaseId, requestId } = input, db = env.DB, data = guestContextInventoryData(env, inventory);
  origin(request, data.session.policy.terms.origin);
  const prior = await readGuestContextAdoption(request, env, { sessionId: inventory.sessionId });
  if (env.DB !== db) return guestFail("database_changed");
  const exactResult = (saved: NonNullable<typeof prior>) => {
    if (saved.leaseId !== leaseId || saved.requestId !== requestId || saved.manifestDigest !== inventory.manifestDigest) return guestFail("adoption_conflict");
    return saved;
  };
  if (prior) return exactResult(prior);
  const auth = await destination(request, env), native = projectIntakeAuthority(env, auth, inventory);
  if (env.DB !== db) return guestFail("database_changed");
  const lease = await db.prepare(`SELECT ${leaseColumns} FROM experience_guest_claim_leases WHERE session_id=? AND lease_id=? AND request_id=? AND destination_user_id=? AND manifest_digest=? AND expires_at_ms>${GUEST_DB_NOW}`)
    .bind(inventory.sessionId, leaseId, requestId, auth.user.userId, inventory.manifestDigest).first<Lease>();
  if (!lease) return guestFail("lease_unavailable");
  const head = await db.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(auth.user.streamId).first<{ head: number }>();
  if (!head || !Number.isSafeInteger(head.head) || head.head < 0) return guestFail("adoption_unavailable");
  const events = data.plan.events.map((event, index) => makeEvent(auth.user.streamId, head.head + index + 1, "user", client, correlation(inventory.sessionId), event.type,
    { ...structuredClone(event.payload), client_event_id: eventKey(inventory.sessionId, index) }));
  const bodies = events.map(event => json(event.payload)), hashes = await Promise.all(bodies.map(body => digest(body)));
  const target = events.map((event, i): Target => { const b = eventWriteBindings(event); return { id: event.eventId, sequence: event.sequence, occurred: event.occurredAt,
    recorded: event.recordedAt, type: event.type, public: String(b[12]), privateDigest: hashes[i], project: b[14] as string | null, document: b[15] as string | null, key: String(event.payload.client_event_id) }; });
  const lineage: Lineage = { version: 1, sessionId: inventory.sessionId, guestSubject: inventory.guestSubject, projectId: inventory.projectId, documentId: inventory.documentId,
    draftHash: inventory.draftHash, manifestDigest: inventory.manifestDigest, sourceEventIds: data.sourceEventIds, sourceHead: inventory.sourceHead,
    destinationUserId: auth.user.userId, origin: data.session.policy.terms.origin, targetStart: head.head + 1, targetHead: head.head + events.length, events: target, lease };
  const encoded = canonicalJson(lineage), hash = await digest(lineage);
  const resourceIds = json([...new Set(data.plan.events.flatMap(event => [event.payload.project_id, event.payload.document_id, event.payload.block_id].filter(id => typeof id === "string")))]);
  const collision: Proof = { sql: `NOT EXISTS(SELECT 1 FROM events prior,json_tree(prior.payload) item WHERE prior.stream_id=? AND prior.sequence<=?
    AND item.type='text' AND item.value IN(SELECT value FROM json_each(?)))`, bindings: [auth.user.streamId, head.head, resourceIds] };
  if (env.DB !== db) return guestFail("database_changed");
  try {
    await appendEvents(env, events, { expectedHead: head.head, retries: 1, prepareSidecars: (assigned: EventRow[]) => [
      ...assertions(env, [data.proof, native, leaseProof(lease, true), collision, currentCustody(lineage)]),
      ...assigned.map(event => db.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) VALUES(?,?,?,?,?)")
        .bind(event.streamId, String(event.payload.client_event_id), event.eventId, event.sequence, event.recordedAt)),
      db.prepare(`INSERT INTO experience_guest_context_adoptions VALUES(?,?,?,?,?,?,?,${GUEST_DB_NOW})`)
        .bind(inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, encoded, hash),
      db.prepare("UPDATE experience_guest_sessions SET revoked_at_ms=(SELECT created_at_ms FROM experience_guest_context_adoptions WHERE session_id=?) WHERE session_id=? AND revoked_at_ms IS NULL")
        .bind(inventory.sessionId, inventory.sessionId),
      ...assertions(env, [data.sourceProof, data.session.policy.guard, native, leaseProof(lease, true), collision, currentCustody(lineage), targetProof(lineage, bodies),
        { sql: `EXISTS(SELECT 1 FROM experience_guest_context_adoptions receipt JOIN experience_guest_sessions session ON session.session_id=receipt.session_id
          WHERE receipt.session_id=? AND receipt.destination_user_id=? AND receipt.lease_id=? AND receipt.request_id=? AND receipt.manifest_digest=?
            AND receipt.lineage_json=? AND receipt.lineage_digest=? AND receipt.created_at_ms=session.revoked_at_ms
            AND session.guest_subject=? AND session.project_id=? AND session.document_id=? AND session.expires_at_ms>${GUEST_DB_NOW})`,
          bindings: [inventory.sessionId, auth.user.userId, leaseId, requestId, inventory.manifestDigest, encoded, hash, inventory.guestSubject, inventory.projectId, inventory.documentId] }]),
    ] });
  } catch (error) {
    if (env.DB !== db) return guestFail("database_changed");
    const original = await readGuestContextAdoption(request, env, { sessionId: inventory.sessionId });
    if (env.DB !== db) return guestFail("database_changed");
    if (!original) throw error;
    return exactResult(original);
  }
  if (env.DB !== db) return guestFail("database_changed");
  const saved = await readGuestContextAdoption(request, env, { sessionId: inventory.sessionId });
  if (env.DB !== db) return guestFail("database_changed");
  if (!saved) return guestFail("adoption_unavailable");
  return { ...exactResult(saved), replayed: false };
}
