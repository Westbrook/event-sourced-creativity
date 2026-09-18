import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { GUEST_CUSTODY_SCHEMA, guestFail, guestHash, guestId, readGuestCustodyTerms } from "./experience-guest-session.ts";
import { GUEST_CONTEXT_ADOPTION_SCHEMA } from "./experience-guest-context-adoption.ts";
import type { WorkerEnv } from "./runtime.ts";

type Value = string | number | null;
type Proof = { sql: string; bindings: Value[] };
type Row = Record<string, Value>;
type Context = { env: WorkerEnv; db: WorkerEnv["DB"] };
export type GuestSourceRetirementAssociation = Readonly<{
  sessionId: string; guestSubject: string; projectId: string; documentId: string; draftId: string; draftHash: string;
  sourceCreatedAt: string; sourceExpiresAt: string; sessionCreatedAtMs: number; sessionExpiresAtMs: number; sessionRevokedAtMs: number | null;
  sessionPolicyId: string; sessionTermsDigest: string; origin: string; committedHead: number | null; sourceEventIds: readonly string[];
  originals: readonly Readonly<{ eventId: string; sequence: number; occurredAt: string; recordedAt: string; type: string; publicJson: string }>[];
}>;
export type GuestSourceRetirementCustody = Readonly<{ mode: "unclaimed" | "canonical-prefix";
  proof: Readonly<{ sql: string; bindings: readonly Value[] }> }>;
const fail = (): never => guestFail("source_retirement_unavailable");
const current = (ctx: Context) => { if (ctx.env.DB !== ctx.db) guestFail("database_changed"); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const integer = (value: unknown, minimum = 0, maximum = 8_640_000_000_000_000): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const text = (value: unknown, maximum = 240): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum
  && value.trim() === value && value.isWellFormed() && !/[\p{Cc}]/u.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const objectSql = (columns: readonly string[], alias = "") => `json_object(${columns.flatMap(column => [`'${column}'`, `${alias}${column}`]).join(",")})`;
const flat = (value: unknown, columns: readonly string[]): value is Row => record(value) && exactKeys(value, columns)
  && Object.values(value).every(item => item === null || typeof item === "string" || typeof item === "number" && Number.isFinite(item));
const redaction = (alias: string) => `typeof(${alias}.private_json)='text' AND (${alias}.redacted_at IS NULL OR (${alias}.private_json=''
  AND typeof(${alias}.redacted_at)='text' AND length(CAST(${alias}.redacted_at AS BLOB))=24
  AND ${alias}.redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ',${alias}.redacted_at)))`;
function parsed(value: unknown, maximum = 65536): Record<string, unknown> {
  if (typeof value !== "string" || !value.isWellFormed() || bytes(value) > maximum) return fail();
  let result: unknown; try { result = JSON.parse(value); } catch { return fail(); }
  if (!record(result)) return fail(); return result;
}
function together(parts: readonly Proof[]): Proof {
  return { sql: `EXISTS(WITH ${parts.map((part, index) => `source_custody_${index} AS MATERIALIZED(SELECT 1 WHERE ${part.sql})`).join(",")}
    SELECT 1 FROM ${parts.map((_, index) => `source_custody_${index}`).join(",")})`, bindings: parts.flatMap(part => part.bindings) };
}
async function checkedDigest(ctx: Context, value: unknown) { const result = await digest(value); current(ctx); return result; }
async function prove(ctx: Context, proof: Proof) {
  const row = await ctx.db.prepare(`SELECT 1 AS verified WHERE ${proof.sql}`).bind(...proof.bindings).first(); current(ctx);
  if (!row) return fail();
}

const families = [GUEST_CUSTODY_SCHEMA, GUEST_CONTEXT_ADOPTION_SCHEMA] as const;
const normalize = (sql: string) => sql.replace(/\s+/gu, " ").trim().replace(/;$/u, "").replace(/CREATE TABLE IF NOT EXISTS /iu, "CREATE TABLE ");
const items = families.map(family => family.map(sql => {
  const match = /^CREATE (TABLE|INDEX|TRIGGER)(?: IF NOT EXISTS)? ([a-zA-Z0-9_]+)/u.exec(sql.trim());
  if (!match) return fail(); return { type: match[1].toLowerCase(), name: match[2], sql: normalize(sql) };
}));
const names = items.flatMap(family => family.map(item => item.name));
const tables = items.flatMap(family => family.filter(item => item.type === "table").map(item => item.name));
const schemaSql = `(SELECT json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',definition)) FROM
  (SELECT type,name,tbl_name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql ELSE NULL END AS definition
    FROM sqlite_schema WHERE name IN(${names.map(name => `'${name}'`).join(",")}) OR tbl_name IN(${tables.map(name => `'${name}'`).join(",")})
    ORDER BY name,type LIMIT 129))`;
async function schema(ctx: Context): Promise<{ proof: Proof; custody: boolean; adoption: boolean }> {
  const row = await ctx.db.prepare(`SELECT ${schemaSql} AS witness`).first<{ witness: string }>(); current(ctx);
  if (!row || typeof row.witness !== "string" || bytes(row.witness) > 262144) return fail();
  let observed: unknown; try { observed = JSON.parse(row.witness); } catch { return fail(); }
  if (!Array.isArray(observed) || observed.length > 128 || observed.some(item => !record(item)
    || !exactKeys(item, ["type", "name", "table", "sql"]) || typeof item.name !== "string" || typeof item.table !== "string"
    || !tables.includes(item.table) || !["table", "index", "trigger"].includes(String(item.type))
    || item.sql !== null && typeof item.sql !== "string")) return fail();
  const explicit = observed.filter(item => !(item.type === "index" && item.sql === null
    && String(item.name).startsWith(`sqlite_autoindex_${item.table}_`)
    && /^[1-9][0-9]*$/u.test(String(item.name).slice(`sqlite_autoindex_${item.table}_`.length))));
  if (explicit.some(item => !names.includes(String(item.name)) || typeof item.sql !== "string")
    || new Set(explicit.map(item => item.name)).size !== explicit.length) return fail();
  const actual = new Map(explicit.map(item => [String(item.name), item]));
  const present = items.map(family => {
    const found = family.filter(item => actual.has(item.name));
    if (!found.length) return false;
    if (found.length !== family.length || family.some(item => {
      const observed = actual.get(item.name); return !observed || observed.type !== item.type || normalize(String(observed.sql)) !== item.sql;
    })) return fail();
    return true;
  });
  return { proof: { sql: `${schemaSql}=?`, bindings: [row.witness] }, custody: present[0], adoption: present[1] };
}
const eventColumns = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"];
const metadataSql = `json_set(${objectSql(eventColumns, "event.")},'$.owner_id',body.owner_id,'$.project_id',body.project_id,
  '$.document_id',body.document_id,'$.created_at',body.created_at)`;
const adoptionColumns = ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "lineage_json", "lineage_digest", "created_at_ms"];
const leaseColumns = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id", "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"];
const projectColumns = ["project_access_id", "project_id", "organization_id", "owner_user_id", "status", "created_at", "updated_at"];
const scopeColumns = ["project_access_id", "resource_kind", "resource_id", "organization_id", "project_id", "owner_user_id", "visibility", "source_event_id", "actor_user_id", "created_at"];
const projectEventColumns = ["event_id", "project_access_id", "organization_id", "project_id", "owner_user_id", "source_stream_id", "source_sequence", "project_sequence", "actor_user_id", "created_at"];

function capture(raw: GuestSourceRetirementAssociation): GuestSourceRetirementAssociation {
  if (!record(raw) || !exactKeys(raw, ["sessionId", "guestSubject", "projectId", "documentId", "draftId", "draftHash", "sourceCreatedAt", "sourceExpiresAt",
    "sessionCreatedAtMs", "sessionExpiresAtMs", "sessionRevokedAtMs", "sessionPolicyId", "sessionTermsDigest", "origin", "committedHead", "sourceEventIds", "originals"])
    || jsonIssues(raw).length || !guestId(raw.sessionId) || !/^guest:[a-f0-9-]{36}$/u.test(raw.guestSubject)
    || !guestId(raw.projectId) || !guestId(raw.documentId) || !/^experience-draft-[a-f0-9]{64}$/u.test(raw.draftId)
    || !guestHash(raw.draftHash) || !guestId(raw.sessionPolicyId) || !guestHash(raw.sessionTermsDigest)
    || !iso(raw.sourceCreatedAt) || !iso(raw.sourceExpiresAt) || raw.sourceCreatedAt >= raw.sourceExpiresAt
    || !integer(raw.sessionCreatedAtMs) || !integer(raw.sessionExpiresAtMs, 1) || raw.sessionCreatedAtMs >= raw.sessionExpiresAtMs
    || Date.parse(raw.sourceExpiresAt) > raw.sessionExpiresAtMs || raw.sessionRevokedAtMs !== null && !integer(raw.sessionRevokedAtMs)
    || !Array.isArray(raw.sourceEventIds) || raw.sourceEventIds.length > 16 || raw.sourceEventIds.some(value => !uuid(value))
    || new Set(raw.sourceEventIds).size !== raw.sourceEventIds.length || !Array.isArray(raw.originals)
    || raw.originals.length !== raw.sourceEventIds.length || (raw.committedHead === null ? raw.originals.length !== 0 : raw.committedHead !== raw.originals.length || !integer(raw.committedHead, 1, 16))) return fail();
  let origin: URL; try { origin = new URL(raw.origin); } catch { return fail(); }
  if (origin.protocol !== "https:" || origin.origin !== raw.origin) return fail();
  for (const [index, event] of raw.originals.entries()) if (!record(event)
    || !exactKeys(event, ["eventId", "sequence", "occurredAt", "recordedAt", "type", "publicJson"])
    || event.eventId !== raw.sourceEventIds[index] || event.sequence !== index + 1 || !iso(event.occurredAt) || !iso(event.recordedAt)
    || event.type !== (["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"][index] ?? "BlockCreated") || typeof event.publicJson !== "string") return fail();
  return freeze(structuredClone(raw));
}
function originalProof(input: GuestSourceRetirementAssociation): Proof {
  const expected = [input.sessionId, input.guestSubject, input.projectId, input.documentId, input.draftId, input.draftHash,
    input.sourceCreatedAt, input.sourceExpiresAt, input.sessionCreatedAtMs, input.sessionExpiresAtMs, input.sessionRevokedAtMs,
    input.sessionPolicyId, input.sessionTermsDigest];
  const source: Proof = { sql: `EXISTS(SELECT 1 FROM experience_guest_sources source JOIN experience_guest_sessions session ON session.session_id=source.session_id
    JOIN private_content content ON content.content_id=source.draft_id
    WHERE json_array(session.session_id,session.guest_subject,session.project_id,session.document_id,source.draft_id,source.draft_hash,
      content.created_at,source.expires_at,session.created_at_ms,session.expires_at_ms,session.revoked_at_ms,session.policy_id,session.terms_digest)=?
      AND content.owner_id=session.guest_subject AND content.kind='experience-draft' AND content.expires_at=source.expires_at)`, bindings: [JSON.stringify(expected)] };
  if (input.committedHead === null) return together([source, { sql: "NOT EXISTS(SELECT 1 FROM experience_guest_source_commits WHERE session_id=?)", bindings: [input.sessionId] }]);
  const originals = input.originals.map((event, index) => ({ event_id: event.eventId, stream_id: `creative:${input.guestSubject}`, sequence: event.sequence,
    occurred_at: event.occurredAt, recorded_at: event.recordedAt, actor: input.guestSubject, client_id: "server:guest-source", correlation_id: input.draftId,
    causation_id: null, compensates_event_id: null, schema_version: 1, type: event.type, payload: event.publicJson,
    owner_id: input.guestSubject, project_id: input.projectId, document_id: index === 0 ? null : input.documentId, created_at: event.recordedAt }));
  return together([source, { sql: `EXISTS(SELECT 1 FROM experience_guest_source_commits committed JOIN experience_guest_sources source ON source.session_id=committed.session_id
    WHERE committed.session_id=? AND committed.draft_hash=source.draft_hash AND committed.head=source.event_count AND committed.head=? AND committed.event_ids_json=?)`,
  bindings: [input.sessionId, input.committedHead, JSON.stringify(input.sourceEventIds)] }, { sql: `(SELECT COUNT(*) FROM json_each(?) expected
    JOIN events event ON event.event_id=json_extract(expected.value,'$.event_id') JOIN event_private_payloads body ON body.private_event_id=event.event_id
    WHERE ${metadataSql}=expected.value)=?`, bindings: [JSON.stringify(originals), originals.length] }]);
}
async function snapshot(ctx: Context, parts: Proof[], table: string, key: string, value: string, columns: string[], bound: string): Promise<Row> {
  const result = await ctx.db.prepare(`SELECT CASE WHEN ${bound} THEN ${objectSql(columns)} END AS witness FROM ${table} WHERE ${key}=?`).bind(value).first<{ witness: string | null }>(); current(ctx);
  if (!result || typeof result.witness !== "string" || bytes(result.witness) > 131072) return fail();
  const valueRow = parsed(result.witness, 131072);
  if (!flat(valueRow, columns)) return fail();
  parts.push({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${key}=? AND ${objectSql(columns)}=?)`, bindings: [value, result.witness] });
  return valueRow;
}
async function relation(ctx: Context, parts: Proof[], table: string, columns: string[], where: string, selector: string, order: string): Promise<Row[]> {
  const sql = `(SELECT json_group_array(json(witness)) FROM (SELECT ${objectSql(columns)} AS witness FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT 2))`;
  const result = await ctx.db.prepare(`SELECT ${sql} AS witness`).bind(selector).first<{ witness: string }>(); current(ctx);
  if (!result || typeof result.witness !== "string" || bytes(result.witness) > 32768) return fail();
  let rows: unknown; try { rows = JSON.parse(result.witness); } catch { return fail(); }
  // A valid destination owner has one native owner/Project row and at most one
  // Document scope in that exact access. Two observed rows are contradictory.
  if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => !flat(row, columns))) return fail();
  parts.push({ sql: `${sql}=?`, bindings: [selector, result.witness] }); return rows as Row[];
}

/** Closed historical prefix custody only. The returned proof reads no private
 * source/copy text and remains unchanged across original-body erasure. It is
 * consumed in the writer's before, in-batch after and final recovery checks. */
export async function captureGuestSourceRetirementCustody(env: WorkerEnv, raw: GuestSourceRetirementAssociation): Promise<GuestSourceRetirementCustody> {
  const input = capture(raw), ctx: Context = { env, db: env.DB };
  try {
    // When the original conservative guards suffice, optional adoption history
    // supplies no exception authority and must not become a cleanup prerequisite.
    const conservative: Proof = { sql: `NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='document' AND resource_id=?)`,
    bindings: [input.projectId, input.documentId] };
    const unchanged = await ctx.db.prepare(`SELECT 1 AS verified WHERE ${conservative.sql}`).bind(...conservative.bindings).first(); current(ctx);
    if (unchanged) return freeze({ mode: "unclaimed", proof: conservative });
    const definitions = await schema(ctx); current(ctx);
    const parts: Proof[] = [definitions.proof, originalProof(input)];
    if (!definitions.custody) return fail();
    const policy = await snapshot(ctx, parts, "experience_guest_policies", "policy_id", input.sessionPolicyId,
      ["policy_id", "terms_digest", "terms_json", "review_digest", "revoked_at_ms"], "typeof(terms_json)='text' AND length(CAST(terms_json AS BLOB)) BETWEEN 1 AND 4096");
    const terms = readGuestCustodyTerms(parsed(policy.terms_json));
    if (terms.policyId !== input.sessionPolicyId || terms.origin !== input.origin || policy.terms_digest !== input.sessionTermsDigest
      || canonicalJson(terms) !== policy.terms_json || await checkedDigest(ctx, terms) !== input.sessionTermsDigest || !guestHash(policy.review_digest)) return fail();
    let present = false;
    if (definitions.adoption) {
      present = Boolean(await ctx.db.prepare("SELECT 1 AS present FROM experience_guest_context_adoptions WHERE session_id=?").bind(input.sessionId).first()); current(ctx);
    }
    if (!present) {
      if (definitions.adoption) parts.push({ sql: "NOT EXISTS(SELECT 1 FROM experience_guest_context_adoptions WHERE session_id=?)", bindings: [input.sessionId] });
      parts.push({ sql: `NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
        AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='document' AND resource_id=?)`, bindings: [input.projectId, input.documentId] });
      const proof = together(parts); await prove(ctx, proof); current(ctx); return freeze({ mode: "unclaimed", proof });
    }
    if (input.committedHead === null || input.committedHead < 3) return fail();
    const blockIds = input.originals.filter(event => event.type === "BlockCreated").map(event => parsed(event.publicJson).block_id);
    if (blockIds.some(id => !guestId(id))) return fail();
    // Shared logical IDs never excuse an explicit original-event reference or
    // original guest ownership/participation in a typed prefix block scope.
    parts.push({ sql: `NOT EXISTS(SELECT 1 FROM project_resource_scopes
      WHERE source_event_id IN(SELECT value FROM json_each(?)))
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='block'
        AND resource_id IN(SELECT value FROM json_each(?)) AND (owner_user_id=? OR actor_user_id=?))`,
    bindings: [JSON.stringify(input.sourceEventIds), JSON.stringify(blockIds), input.guestSubject, input.guestSubject] });
    const row = await snapshot(ctx, parts, "experience_guest_context_adoptions", "session_id", input.sessionId, adoptionColumns,
      "typeof(lineage_json)='text' AND length(CAST(lineage_json AS BLOB)) BETWEEN 1 AND 65536");
    const lineage = parsed(row.lineage_json);
    if (!record(lineage.lease) || typeof lineage.lease.request_ids_json !== "string" || lineage.lease.request_ids_json.length > 16301
      || jsonIssues({ ...lineage, lease: { ...lineage.lease, request_ids_json: "" } }).length
      || !exactKeys(lineage, ["version", "sessionId", "guestSubject", "projectId", "documentId", "draftHash", "manifestDigest", "sourceEventIds", "sourceHead", "destinationUserId", "origin", "targetStart", "targetHead", "events", "lease"])
      || lineage.version !== 1 || lineage.sessionId !== input.sessionId || lineage.guestSubject !== input.guestSubject
      || lineage.projectId !== input.projectId || lineage.documentId !== input.documentId || lineage.draftHash !== input.draftHash || lineage.origin !== input.origin
      || !text(row.destination_user_id) || row.destination_user_id.startsWith("guest:") || lineage.destinationUserId !== row.destination_user_id
      || !guestId(row.lease_id) || !guestId(row.request_id) || !guestHash(row.manifest_digest) || lineage.manifestDigest !== row.manifest_digest
      || !guestHash(row.lineage_digest) || canonicalJson(lineage) !== row.lineage_json || await checkedDigest(ctx, lineage) !== row.lineage_digest
      || !integer(row.created_at_ms) || row.created_at_ms !== input.sessionRevokedAtMs || row.created_at_ms < input.sessionCreatedAtMs
      || row.created_at_ms < Date.parse(input.sourceCreatedAt) || row.created_at_ms >= Date.parse(input.sourceExpiresAt) || row.created_at_ms >= input.sessionExpiresAtMs
      || lineage.sourceHead !== input.committedHead || canonicalJson(lineage.sourceEventIds) !== canonicalJson(input.sourceEventIds)
      || !integer(lineage.targetStart, 1) || lineage.targetHead !== lineage.targetStart + input.committedHead - 1
      || !Array.isArray(lineage.events) || lineage.events.length !== input.committedHead || !flat(lineage.lease, leaseColumns)) return fail();
    const destination = row.destination_user_id;
    const lease = await snapshot(ctx, parts, "experience_guest_claim_leases", "session_id", input.sessionId, leaseColumns,
      "typeof(request_ids_json)='text' AND length(CAST(request_ids_json AS BLOB)) BETWEEN 1 AND 16301");
    if (canonicalJson(lease) !== canonicalJson(lineage.lease) || lease.session_id !== input.sessionId || lease.lease_id !== row.lease_id
      || lease.destination_user_id !== destination || lease.manifest_digest !== row.manifest_digest || lease.request_id !== row.request_id
      || !integer(lease.created_at_ms) || !integer(lease.expires_at_ms, 1) || lease.created_at_ms > row.created_at_ms || lease.expires_at_ms <= row.created_at_ms
      || !integer(lease.acquisitions, 1, 100)) return fail();
    let history: unknown; try { history = JSON.parse(String(lease.request_ids_json)); } catch { return fail(); }
    if (!Array.isArray(history) || history.length !== lease.acquisitions || history.some(value => !guestId(value))
      || new Set(history).size !== history.length || history.at(-1) !== lease.request_id || JSON.stringify(history) !== lease.request_ids_json) return fail();
    const copied: Row[] = [], receiptRows: Row[] = [], copiedIds: string[] = [];
    for (const [index, target] of lineage.events.entries()) {
      const original = input.originals[index], expectedDocument = index === 0 ? null : input.documentId;
      if (!record(target) || !exactKeys(target, ["id", "sequence", "occurred", "recorded", "type", "public", "privateDigest", "project", "document", "key"])
        || !uuid(target.id) || !iso(target.occurred) || !iso(target.recorded) || Date.parse(target.recorded) > row.created_at_ms
        || Date.parse(original.recordedAt) > row.created_at_ms || target.sequence !== lineage.targetStart + index || target.type !== original.type
        || target.project !== input.projectId || target.document !== expectedDocument || !guestHash(target.privateDigest)
        || target.key !== `guest-context-adoption:v1:${input.sessionId}:${index}` || typeof target.public !== "string"
        || canonicalJson(parsed(target.public)) !== canonicalJson({ ...parsed(original.publicJson), client_event_id: target.key, _private_ref: target.id })) return fail();
      copiedIds.push(target.id);
      copied.push({ event_id: target.id, stream_id: `creative:${destination}`, sequence: Number(target.sequence), occurred_at: target.occurred, recorded_at: target.recorded,
        actor: "user", client_id: "server:guest-context-adoption", correlation_id: `guest-context-adoption:${input.sessionId}`,
        causation_id: null, compensates_event_id: null, schema_version: 1, type: String(target.type), payload: target.public,
        owner_id: destination, project_id: input.projectId, document_id: expectedDocument, created_at: target.recorded });
      receiptRows.push({ stream_id: `creative:${destination}`, client_event_id: target.key, event_id: target.id, sequence: Number(target.sequence), created_at: target.recorded });
    }
    if (new Set([...input.sourceEventIds, ...copiedIds]).size !== input.sourceEventIds.length + copiedIds.length) return fail();
    parts.push({ sql: `(SELECT COUNT(*) FROM json_each(?) expected JOIN events event ON event.event_id=json_extract(expected.value,'$.event_id')
      JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE ${metadataSql}=expected.value AND (${redaction("body")}))=?`,
    bindings: [JSON.stringify(copied), copied.length] }, { sql: `(SELECT COUNT(*) FROM json_each(?) expected JOIN event_client_receipts receipt
      ON receipt.stream_id=json_extract(expected.value,'$.stream_id') AND receipt.client_event_id=json_extract(expected.value,'$.client_event_id')
      WHERE ${objectSql(["stream_id", "client_event_id", "event_id", "sequence", "created_at"], "receipt.")}=expected.value)=?`, bindings: [JSON.stringify(receiptRows), receiptRows.length] });
    const projects = await relation(ctx, parts, "organization_projects", projectColumns, "project_id=?", input.projectId, "project_access_id");
    const scopes = await relation(ctx, parts, "project_resource_scopes", scopeColumns, "resource_kind='document' AND resource_id=?", input.documentId, "project_access_id");
    for (const project of projects) if (project.project_id !== input.projectId || project.owner_user_id !== destination
      || !text(project.project_access_id) || !text(project.organization_id) || !text(project.status) || !iso(project.created_at) || !iso(project.updated_at)) return fail();
    for (const scope of scopes) {
      const project = projects[0];
      if (!project || scope.resource_kind !== "document" || scope.resource_id !== input.documentId || scope.project_id !== input.projectId
        || scope.owner_user_id !== destination || scope.actor_user_id !== destination || scope.visibility !== "collaborative_output"
        || scope.project_access_id !== project.project_access_id || scope.organization_id !== project.organization_id || !iso(scope.created_at)) return fail();
      if (scope.source_event_id === null) continue;
      // The only additional recognized provenance is the exact immutable
      // adopted DocumentCreated, never a later same-ID/collaborator event.
      if (scope.source_event_id !== copiedIds[1]) return fail();
      const projected = await snapshot(ctx, parts, "project_event_scopes", "event_id", copiedIds[1], projectEventColumns, "1");
      if (projected.project_access_id !== project.project_access_id || projected.organization_id !== project.organization_id
        || projected.project_id !== input.projectId || projected.owner_user_id !== destination || projected.source_stream_id !== `creative:${destination}`
        || projected.source_sequence !== Number(lineage.targetStart) + 1 || !integer(projected.project_sequence, 1)
        || projected.actor_user_id !== destination || projected.created_at !== scope.created_at) return fail();
    }
    const proof = together(parts); await prove(ctx, proof); current(ctx); return freeze({ mode: "canonical-prefix", proof });
  } catch {
    current(ctx); return fail();
  }
}
