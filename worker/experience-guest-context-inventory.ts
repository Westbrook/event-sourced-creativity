import { digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { guestFail, type GuestClaimProof } from "./experience-guest-session.ts";
import { readGuestImageSourceForCustody } from "./experience-guest-source.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import type { WorkerEnv } from "./runtime.ts";

type Value = string | number | null;
type Proof = { sql: string; bindings: Value[] };
type Source = Awaited<ReturnType<typeof readGuestImageSourceForCustody>>;
export type GuestContextInventory = Readonly<{ version: 1; sessionId: string; guestSubject: string; projectId: string;
  documentId: string; draftHash: string; sourceHead: number; expiresAt: string; manifestDigest: string }>;
type Manifest = Readonly<{ version: 1; kind: "original-image-context"; sessionId: string; guestSubject: string;
  projectId: string; documentId: string; draftId: string; draftHash: string; contentDigest: string;
  sourceEventIds: readonly string[]; sourceHead: number; expiresAt: string; nativeSnapshotDigest: string }>;
type InventoryData = Readonly<{ plan: Source["saved"]["plan"]; sourceEventIds: string[]; session: Source["session"];
  manifest: Manifest; proof: Proof; sourceProof: Proof }>;
const inventories = new WeakMap<GuestContextInventory, { db: WorkerEnv["DB"]; data: InventoryData }>();
const unavailable = (): never => guestFail("context_inventory_unavailable");
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const join = (...parts: Proof[]): Proof => ({ sql: parts.map(part => `(${part.sql})`).join(" AND "), bindings: parts.flatMap(part => part.bindings) });
const objectSql = (columns: readonly string[], alias = "") => `json_object(${columns.flatMap(column => [`'${column}'`, `${alias}${column}`]).join(",")})`;
const flatRow = (value: unknown, columns: readonly string[]): value is Record<string, Value> => record(value) && exactKeys(value, columns)
  && Object.values(value).every(item => item === null || typeof item === "string" || typeof item === "number" && Number.isFinite(item));
const time = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const sourceColumns = ["session_id", "policy_id", "policy_digest", "draft_id", "draft_hash", "request_digest", "content_digest", "draft_bytes", "event_bytes", "event_count", "expires_at"];
const sessionColumns = ["session_id", "policy_id", "terms_digest", "guest_subject", "project_id", "document_id", "session_hash", "claim_hash", "created_at_ms", "expires_at_ms"];
// Source-policy revocation stops new source issuance; it does not revoke an
// already committed source or change the manifest bound to an existing lease.
const policyColumns = ["policy_id", "policy_digest", "policy_json", "review_digest"];
const draftColumns = ["content_id", "owner_id", "kind", "content", "created_at", "expires_at", "redacted_at"];
const commitColumns = ["session_id", "draft_hash", "head", "event_ids_json"];
const eventColumns = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"];
// D1 allows at most 32 function arguments. json_set retains explicit nulls;
// json_patch would silently remove nullable custody/redaction fields.
const eventWitness = `json_set(${objectSql(eventColumns, "e.")},
  '$.owner_id',body.owner_id,'$.project_id',body.project_id,'$.document_id',body.document_id,'$.private_json',body.private_json,
  '$.created_at',body.created_at,'$.redacted_at',body.redacted_at,'$.receipt_key',receipt.client_event_id,'$.receipt_created_at',receipt.created_at)`;
const eventJoins = `JOIN events e ON e.event_id=expected.value
  JOIN event_private_payloads body ON body.private_event_id=e.event_id
  JOIN event_client_receipts receipt ON receipt.event_id=e.event_id AND receipt.stream_id=e.stream_id AND receipt.sequence=e.sequence`;
const registries = ["memory_native_answer_origins", "memory_structured_answer_origins", "memory_document_job_answer_origins"] as const;
const registrySchemaSql = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
  (SELECT type,name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition FROM sqlite_schema
    WHERE type IN('table','view') AND name IN(${registries.map(name => `'${name}'`).join(",")}) ORDER BY name LIMIT 4))`;

// These are the installed native sidecars which can independently retain work
// outside the original context events. Every branch is an exclusion, including
// completed or redacted rows: this baseline never claims generated outputs.
// Optional durable jobs have native document_jobs/slot/grant parent rows, which
// are already excluded; this module does not install their dormant schema.
const closureBranches = [
  ["events", "d.actor=s.guest AND d.event_id NOT IN(SELECT value FROM json_each(s.ids))"],
  ["private_content", "d.owner_id=s.guest AND d.content_id<>s.draft"],
  ["external_content", "d.owner_id=s.guest"],
  ["event_private_payloads", "d.owner_id=s.guest AND d.private_event_id NOT IN(SELECT value FROM json_each(s.ids))"],
  ["event_client_receipts", "d.stream_id=s.stream AND d.event_id NOT IN(SELECT value FROM json_each(s.ids))"],
  ["event_write_stage", "d.owner_id=s.guest OR d.stream_id=s.stream"],
  ["organization_projects", "d.project_id=s.project OR d.owner_user_id=s.guest"],
  ["project_resource_scopes", "d.project_id=s.project OR d.owner_user_id=s.guest OR d.resource_id IN(s.draft,s.document)"],
  ["private_content_retention_scopes", "d.content_id=s.draft OR d.project_id=s.project"],
  ["project_event_scopes", "d.event_id IN(SELECT value FROM json_each(s.ids)) OR d.source_stream_id=s.stream OR d.owner_user_id=s.guest"],
  ["document_jobs", "d.owner_id=s.guest OR d.stream_id=s.stream OR d.document_id=s.document"],
  ["generation_preflights", "d.owner_id=s.guest OR d.stream_id=s.stream OR d.document_id=s.document"],
  ["artifact_revisions", "d.owner_id=s.guest OR d.project_id=s.project OR d.document_id=s.document"],
  ["consequential_executions", "d.actor_user_id=s.guest OR d.stream_id=s.stream OR d.project_id=s.project OR d.document_id=s.document"],
  ["authoring_commits", "d.actor_user_id=s.guest OR d.project_id=s.project OR d.document_id=s.document"],
  ["budget_reservations", "d.owner_id=s.guest OR d.stream_id=s.stream"],
  ["cost_budget_reservations", "d.owner_id=s.guest OR d.stream_id=s.stream"],
  ["shares", "d.owner_id=s.guest OR d.stream_id=s.stream"],
  ["share_scopes", "d.owner_id=s.guest OR d.project_id=s.project OR d.resource_id=s.document"],
  ["project_context_package_bindings", "d.project_id=s.project OR d.document_id=s.document"],
  ["project_review_tasks", "d.project_id=s.project OR d.document_id=s.document"],
  ["output_commands", "d.scope_key=s.scope OR d.actor_user_id=s.guest"],
  ["output_plan_revisions", "d.scope_key=s.scope OR d.owner_user_id=s.guest OR d.project_id=s.project OR d.document_id=s.document"],
  ["output_plan_targets", "d.scope_key=s.scope"],
  ["output_preflights", "d.scope_key=s.scope OR d.actor_user_id=s.guest"],
  ["output_execution_grants", "d.scope_key=s.scope OR d.actor_user_id=s.guest OR d.payer_user_id=s.guest"],
  ["output_operation_slots", "d.scope_key=s.scope"],
  ["output_operation_routes", "d.scope_key=s.scope"],
  ["output_provider_calls", "d.scope_key=s.scope"],
  ["output_assets", "d.scope_key=s.scope OR d.owner_user_id=s.guest OR d.created_by_user_id=s.guest OR d.document_id=s.document"],
  ["output_native_storage_writes", "d.scope_key=s.scope"],
  ["output_asset_storage_writes", "d.scope_key=s.scope OR d.owner_user_id=s.guest OR d.actor_user_id=s.guest OR d.project_id=s.project OR d.document_id=s.document"],
  ["output_results", "d.scope_key=s.scope OR d.created_by_user_id=s.guest OR d.document_id=s.document"],
  ["output_target_acceptances", "d.scope_key=s.scope OR d.reviewer_user_id=s.guest"],
  ["output_plan_fulfillments", "d.scope_key=s.scope"],
  ["output_delivery_manifests", "d.scope_key=s.scope OR d.created_by_user_id=s.guest OR d.document_id=s.document"],
] as const;
// Workerd D1 also limits compound SELECT terms. Keep each independently
// materialized existence group below that limit; each retains at most one row.
// All exclusions and the single captured scope binding remain unchanged.
const closureGroups = Array.from({ length: Math.ceil(closureBranches.length / 4) }, (_, index) => closureBranches.slice(index * 4, index * 4 + 4));
const closureSql = `NOT EXISTS(WITH inventory_input AS(SELECT ? AS value),inventory_scope AS(
  SELECT ${["guest", "stream", "project", "document", "draft", "ids", "scope"].map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM inventory_input),
  ${closureGroups.map((group, index) => `inventory_closure_${index} AS MATERIALIZED(
    ${group.map(([table, condition]) => `SELECT 1 FROM ${table} d,inventory_scope s WHERE ${condition}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
  SELECT 1 WHERE ${closureGroups.map((_, index) => `EXISTS(SELECT 1 FROM inventory_closure_${index})`).join(" OR ")})`;

/** Read-only, dormant and context-only. Caller input supplies credentials, never
 * a manifest or a plan. A minted inventory is authority only when its captured
 * SQL proof is checked in the same atomic transaction as the custody copy.
 * No route, schema installation, guest activation or provider is invoked. */
export async function inspectGuestContextInventory(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof }): Promise<GuestContextInventory> {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof"])) return unavailable();
  const db = env.DB, current = () => { if (env.DB !== db) guestFail("database_changed"); };
  const source = await readGuestImageSourceForCustody(request, env, structuredClone(input.proof));
  current();
  const { session, saved, commit } = source, { plan } = saved, ids = [...commit.eventIds], idsJson = JSON.stringify(ids);
  if (ids.length < 3 || ids.length > 16 || new Set(ids).size !== ids.length || commit.head !== ids.length
    || plan.events.length !== ids.length || plan.events.some((event, index) => event.type !== (["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"][index] ?? "BlockCreated"))) return unavailable();
  const parts: Proof[] = [session.policy.guard];
  async function snapshot(table: string, key: string, value: Value, columns: string[], bound = "1") {
    const row = await db.prepare(`SELECT ${objectSql(columns)} AS witness FROM ${table} WHERE ${key}=? AND (${bound})`).bind(value).first<{ witness: string }>();
    current();
    if (!row || typeof row.witness !== "string") return unavailable();
    const parsed: unknown = JSON.parse(row.witness);
    // Native persisted text has explicit byte limits. The compiler's 8192
    // per-definition-string limit does not bound a serialized whole plan.
    if (!flatRow(parsed, columns)) return unavailable();
    parts.push({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${key}=? AND ${objectSql(columns)}=?)`, bindings: [value, row.witness] });
    return { witness: row.witness, row: parsed };
  }
  const sourceRow = await snapshot("experience_guest_sources", "session_id", session.row.session_id, sourceColumns);
  if (sourceColumns.some(key => sourceRow.row[key] !== (saved.row as unknown as Record<string, unknown>)[key])) return unavailable();
  // The immutable session tuple survives adoption. Only revoked_at_ms is left
  // to the adoption receipt's exact DB-minted tombstone postcondition.
  const sessionRow = await snapshot("experience_guest_sessions", "session_id", session.row.session_id, sessionColumns);
  if (sessionColumns.some(key => sessionRow.row[key] !== (session.row as unknown as Record<string, unknown>)[key])) return unavailable();
  const policy = await snapshot("experience_guest_source_policies", "policy_id", saved.row.policy_id, policyColumns, "length(CAST(policy_json AS BLOB))<=4096");
  if (policyColumns.some(key => policy.row[key] !== (saved.policy.row as unknown as Record<string, unknown>)[key])) return unavailable();
  const draft = await snapshot("private_content", "content_id", plan.draftId, draftColumns, "typeof(content)='text' AND length(CAST(content AS BLOB))<=65536");
  if (draft.row.owner_id !== session.row.guest_subject || draft.row.kind !== "experience-draft" || draft.row.content !== saved.row.content
    || draft.row.redacted_at !== null || draft.row.expires_at !== saved.row.expires_at || !time(draft.row.created_at)
    || !time(draft.row.expires_at) || draft.row.created_at >= draft.row.expires_at) return unavailable();
  const originalCommit = await snapshot("experience_guest_source_commits", "session_id", session.row.session_id, commitColumns, "length(CAST(event_ids_json AS BLOB))<=4096");
  if (originalCommit.row.draft_hash !== plan.draftHash || originalCommit.row.head !== ids.length || originalCommit.row.event_ids_json !== idsJson) return unavailable();
  const events = await db.prepare(`SELECT ${eventWitness} AS witness FROM json_each(?) expected ${eventJoins}
    WHERE typeof(e.payload)='text' AND length(CAST(e.payload AS BLOB))<=65536 AND typeof(body.private_json)='text'
      AND length(CAST(body.private_json AS BLOB))<=65536 ORDER BY CAST(expected.key AS INTEGER)`).bind(idsJson).all<{ witness: string }>();
  current();
  if (events.results.length !== ids.length) return unavailable();
  let eventBytes = 0;
  for (const [index, entry] of events.results.entries()) {
    const event: unknown = JSON.parse(entry.witness), expected = plan.events[index];
    if (!flatRow(event, [...eventColumns, "owner_id", "project_id", "document_id", "private_json", "created_at", "redacted_at", "receipt_key", "receipt_created_at"])
      || event.event_id !== ids[index] || event.stream_id !== plan.streamId || event.sequence !== index + 1
      || event.actor !== session.row.guest_subject || event.client_id !== "server:guest-source" || event.correlation_id !== plan.draftId
      || event.schema_version !== 1 || event.causation_id !== null || event.compensates_event_id !== null || event.type !== expected.type
      || event.owner_id !== session.row.guest_subject || event.project_id !== expected.payload.project_id || event.document_id !== (expected.payload.document_id ?? null)
      || event.private_json !== JSON.stringify(expected.payload) || event.payload !== JSON.stringify(publicEventPayload(ids[index], expected.payload, true).payload)
      || event.redacted_at !== null || event.receipt_key !== expected.payload.client_event_id || !time(event.occurred_at) || !time(event.recorded_at)
      || event.created_at !== event.recorded_at || event.receipt_created_at !== event.recorded_at) return unavailable();
    eventBytes += bytes(String(event.payload)) + bytes(String(event.private_json));
  }
  if (eventBytes !== saved.row.event_bytes) return unavailable();
  const witnesses = `[${events.results.map(row => row.witness).join(",")}]`;
  parts.push({ sql: `(SELECT COUNT(*) FROM json_each(?) expected ${eventJoins}
    JOIN json_each(?) snapshots ON snapshots.key=expected.key WHERE ${eventWitness}=snapshots.value)=?`, bindings: [idsJson, witnesses, ids.length] });
  parts.push({ sql: `(SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
    AND (SELECT COUNT(*) FROM event_client_receipts WHERE stream_id=?)=? AND ? > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  bindings: [plan.streamId, ids.length, plan.streamId, commit.head, plan.streamId, ids.length, saved.row.expires_at] });
  try {
    const memory = await nativeMemoryAnswerExclusion(env, { answerAlias: "private_content" });
    current();
    parts.push({ sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND (${memory.sql}))`, bindings: [plan.draftId, ...memory.bindings] });
    const schema = await db.prepare(`SELECT ${registrySchemaSql} AS snapshot`).first<{ snapshot: string }>();
    current();
    if (!schema || typeof schema.snapshot !== "string" || bytes(schema.snapshot) > 65_536) return unavailable();
    const observed: unknown = JSON.parse(schema.snapshot);
    if (!Array.isArray(observed) || observed.length > registries.length || observed.some(row => !record(row) || !exactKeys(row, ["type", "name", "sql"])
      || row.type !== "table" || !registries.includes(row.name as typeof registries[number]) || typeof row.sql !== "string")) return unavailable();
    // The actual native helper qualifies structured/job schemas. The legacy
    // event-ID registry uses exact observed definition/absence stability plus
    // required-column query failure, not an invented DDL allowlist.
    parts.push({ sql: `${registrySchemaSql}=?`, bindings: [schema.snapshot] });
    for (const entry of observed) parts.push({ sql: `NOT EXISTS(SELECT 1 FROM ${entry.name} WHERE user_event_id IN(SELECT value FROM json_each(?)) OR answer_event_id IN(SELECT value FROM json_each(?)))`, bindings: [idsJson, idsJson] });
  } catch { current(); return unavailable(); }
  parts.push({ sql: closureSql, bindings: [JSON.stringify({ guest: session.row.guest_subject, stream: plan.streamId,
    project: plan.projectId, document: plan.documentId, draft: plan.draftId, ids: idsJson, scope: `personal:${session.row.guest_subject}:${plan.projectId}` })] });
  const sourceProof = join(...parts), proof = join(session.guard, sourceProof);
  const manifest: Manifest = { version: 1, kind: "original-image-context", sessionId: session.row.session_id, guestSubject: session.row.guest_subject,
    projectId: plan.projectId, documentId: plan.documentId, draftId: plan.draftId, draftHash: plan.draftHash, contentDigest: saved.row.content_digest,
    sourceEventIds: ids, sourceHead: commit.head, expiresAt: saved.row.expires_at,
    nativeSnapshotDigest: await digest({ source: sourceRow.witness, session: sessionRow.witness, policy: policy.witness,
      draft: draft.witness, commit: originalCommit.witness, events: witnesses }) };
  const manifestDigest = await digest(manifest);
  current();
  // All async observation/hashing ends before this complete live read. The
  // same proof remains mandatory inside the caller's atomic custody operation.
  let live;
  try { live = await db.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings).first(); }
  catch { current(); return unavailable(); }
  current(); if (!live) return unavailable();
  const inventory: GuestContextInventory = Object.freeze({ version: 1, sessionId: session.row.session_id, guestSubject: session.row.guest_subject,
    projectId: plan.projectId, documentId: plan.documentId, draftHash: plan.draftHash, sourceHead: commit.head, expiresAt: saved.row.expires_at, manifestDigest });
  const data = freeze({ plan, sourceEventIds: ids, session, manifest, proof, sourceProof });
  // Never recursively freeze a runtime DB binding or env.
  inventories.set(inventory, { db, data });
  return inventory;
}

/** Internal only. Object identity proves minting, not freshness: the caller
 * must execute data.proof atomically before copying. sourceProof deliberately
 * excludes only the active-session marker for an exact revoke postcondition. */
export function guestContextInventoryData(env: WorkerEnv, inventory: GuestContextInventory): InventoryData {
  const captured = inventory && typeof inventory === "object" ? inventories.get(inventory) : undefined;
  if (!captured) return unavailable();
  if (env.DB !== captured.db) return guestFail("database_changed");
  return captured.data;
}
