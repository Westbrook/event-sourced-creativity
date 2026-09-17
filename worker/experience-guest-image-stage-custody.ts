import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { inspectCompletedGuestImageClaim, guestImageCompletedClaimData } from "./experience-guest-image-claim.ts";
import { guestFail, guestHash, guestId } from "./experience-guest-session.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { publicEventPayload } from "./event-privacy.ts";
import type { WorkerEnv } from "./runtime.ts";

type Value = string | number | null;
export type GuestImageStageProof = { sql: string; bindings: Value[] };
export type GuestImageStageHistoryRole = "confirmation" | "quote" | "construction";
export type GuestImageStageHistoryState = "confirmed" | "preflight-claimed-unknown" | "quoted";
type Command = { scope_key: string; actor_user_id: string; command_key: string; request_digest: string; action: string; event_id: string; created_at: string };
type Resource = { resource_id: string; campaign_id: string; policy_digest: string; limits_digest: string; actor_user_id: string;
  session_digest: string; operation: string; intent_key: string; payload_digest: string; text_bytes: number; issued_grant_id: null; recorded_at_ms: number };
type Event = { id: string; sequence: number; occurred: string; recorded: string; public: string; privateDigest: string };
type CopyIdentity = { role: GuestImageStageHistoryRole; contentId: string; digest: string; bytes: number };
export type GuestImageStageClaimLineage = Readonly<{
  version: 1; kind: "original-image-stage-custody"; sessionId: string; guestSubject: string; destinationUserId: string; projectId: string; documentId: string;
  manifestDigest: string; nativeSnapshotDigest: string; contextLineageDigest: string; saveLineageDigest: string;
  source: { head: number; saveHead: number; stageHead: number; state: GuestImageStageHistoryState; expiresAt: string; originalPayerUserId: string; saveEventId: string;
    confirmation: Event; confirmationCommand: Command; confirmationResource: Resource;
    quote: (Event & { preflightId: string; planRevisionId: string; expiresAt: string; termsDigest: string }) | null; quoteCommand: Command | null;
    construction: { driverId: string; commandDigest: string; resource: Resource } | null };
  copies: CopyIdentity[];
}>;
export type GuestImageStageCustodyRow = { session_id: string; destination_user_id: string; lease_id: string; request_id: string;
  manifest_digest: string; context_lineage_digest: string; save_lineage_digest: string; lineage_json: string; lineage_digest: string; created_at_ms: number };
export type GuestImageStageCopyRow = { session_id: string; role: GuestImageStageHistoryRole; content_id: string; original_digest: string;
  byte_length: number; created_at: string; expires_at: string };
export const GUEST_IMAGE_STAGE_CUSTODY_COLUMNS = "session_id,destination_user_id,lease_id,request_id,manifest_digest,context_lineage_digest,save_lineage_digest,lineage_json,lineage_digest,created_at_ms";
export const GUEST_IMAGE_STAGE_COPY_COLUMNS = "session_id,role,content_id,original_digest,byte_length,created_at,expires_at";
const commandKeys = ["scope_key", "actor_user_id", "command_key", "request_digest", "action", "event_id", "created_at"];
const resourceKeys = ["resource_id", "campaign_id", "policy_digest", "limits_digest", "actor_user_id", "session_digest", "operation", "intent_key", "payload_digest", "text_bytes", "issued_grant_id", "recorded_at_ms"];
const eventKeys = ["id", "sequence", "occurred", "recorded", "public", "privateDigest"];
const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const fail = (part = "unavailable"): never => guestFail(`image_stage_custody_${part}`);
const integer = (value: unknown, min = 0, max = 8_000_000_000_000): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value: unknown, max = 240): value is string => typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value
  && value.isWellFormed() && !/[\p{Cc}]/u.test(value) && !/^forma-guest-(session|claim)-v1\./u.test(value);
const rawHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24 && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const contentId = (value: unknown): value is string => typeof value === "string" && /^guest-image-stage-history-[a-f0-9]{64}$/u.test(value);
const tuple = (row: object, columns: string) => JSON.stringify(columns.split(",").map(key => (row as Record<string, unknown>)[key]));
const arraySql = (columns: string, alias: string) => `json_array(${columns.split(",").map(key => `${alias}.${key}`).join(",")})`;
const all = (...parts: GuestImageStageProof[]): GuestImageStageProof => ({ sql: `EXISTS(WITH ${parts.map((part, i) => `stage_custody_p${i} AS MATERIALIZED(SELECT 1 WHERE ${part.sql})`).join(",")}
  SELECT 1 FROM ${parts.map((_, i) => `stage_custody_p${i}`).join(",")})`, bindings: parts.flatMap(part => part.bindings) });
function parsed(raw: unknown, maximum: number): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.isWellFormed() || bytes(raw) < 1 || bytes(raw) > maximum || raw.includes("\0")) return fail("invalid");
  let value: unknown; try { value = JSON.parse(raw); } catch { return fail("invalid"); }
  if (!record(value)) return fail("invalid"); return value;
}
function json(raw: unknown, maximum: number): Record<string, unknown> {
  const value = parsed(raw, maximum);
  if (jsonIssues(value).length) return fail("invalid"); return value;
}
const roleBound = (role: GuestImageStageHistoryRole) => role === "construction" ? 131072 : 65536;
export function guestImageStageHistoryRoles(state: GuestImageStageHistoryState): readonly GuestImageStageHistoryRole[] {
  if (state === "confirmed") return ["confirmation"];
  if (state === "preflight-claimed-unknown") return ["confirmation", "construction"];
  if (state === "quoted") return ["confirmation", "quote", "construction"];
  return fail("invalid");
}
function resource(value: unknown): value is Resource {
  return record(value) && exactKeys(value, resourceKeys) && text(value.resource_id, 240) && text(value.campaign_id, 200)
    && guestHash(value.policy_digest) && guestHash(value.limits_digest) && text(value.actor_user_id) && guestHash(value.session_digest)
    && ["text-intake", "preflight"].includes(String(value.operation)) && text(value.intent_key, 200) && guestHash(value.payload_digest)
    && integer(value.text_bytes, 0, 1_048_576) && value.issued_grant_id === null && integer(value.recorded_at_ms);
}
function command(value: unknown, owner: string, project: string, event: Event, action: "confirm" | "preflight"): value is Command {
  return record(value) && exactKeys(value, commandKeys) && value.scope_key === `personal:${owner}:${project}` && value.actor_user_id === owner
    && text(value.command_key, 200) && rawHash(value.request_digest) && value.action === action && value.event_id === event.id && value.created_at === event.recorded;
}
function historicalEvent(value: unknown, keys: string[], sequence: number, source: { expiresAt: unknown; saveEventId: unknown }): value is Event & Record<string, unknown> {
  return record(value) && exactKeys(value, keys) && guestId(value.id) && value.id !== source.saveEventId && value.sequence === sequence
    && iso(value.occurred) && value.occurred === value.recorded && iso(source.expiresAt) && value.recorded < source.expiresAt
    && typeof value.public === "string" && bytes(value.public) <= 8192 && guestHash(value.privateDigest);
}
/** Public immutable commitments only. This parser never authorizes access. */
export function readGuestImageStageClaimLineage(raw: unknown): GuestImageStageClaimLineage {
  const value = json(raw, 65536);
  if (!exactKeys(value, ["version", "kind", "sessionId", "guestSubject", "destinationUserId", "projectId", "documentId", "manifestDigest", "nativeSnapshotDigest", "contextLineageDigest", "saveLineageDigest", "source", "copies"])
    || value.version !== 1 || value.kind !== "original-image-stage-custody" || !guestId(value.sessionId) || !guestId(value.projectId) || !guestId(value.documentId)
    || !text(value.guestSubject) || !/^guest:[a-f0-9-]{36}$/u.test(value.guestSubject) || !text(value.destinationUserId) || value.destinationUserId.startsWith("guest:")
    || !guestHash(value.manifestDigest) || !guestHash(value.nativeSnapshotDigest) || !guestHash(value.contextLineageDigest) || !guestHash(value.saveLineageDigest)
    || !record(value.source) || !Array.isArray(value.copies) || canonicalJson(value) !== raw) return fail("invalid");
  const source = value.source;
  if (!exactKeys(source, ["head", "saveHead", "stageHead", "state", "expiresAt", "originalPayerUserId", "saveEventId", "confirmation", "confirmationCommand", "confirmationResource", "quote", "quoteCommand", "construction"])
    || !integer(source.head, 3, 16) || source.saveHead !== source.head + 1 || !["confirmed", "preflight-claimed-unknown", "quoted"].includes(String(source.state))
    || source.stageHead !== source.head + (source.state === "quoted" ? 3 : 2) || !iso(source.expiresAt) || !text(source.originalPayerUserId)
    || source.originalPayerUserId.startsWith("guest:") || !guestId(source.saveEventId)
    || !historicalEvent(source.confirmation, eventKeys, source.head + 2, { expiresAt: source.expiresAt, saveEventId: source.saveEventId })
    || !command(source.confirmationCommand, value.guestSubject, value.projectId, source.confirmation, "confirm")
    || !resource(source.confirmationResource) || source.confirmationResource.operation !== "text-intake"
    || source.confirmationResource.actor_user_id !== value.guestSubject || source.confirmationResource.recorded_at_ms < Date.parse(source.confirmation.recorded)
    || source.confirmationResource.recorded_at_ms >= Date.parse(source.expiresAt)) return fail("invalid");
  const confirmed = json(source.confirmation.public, 8192);
  if (!exactKeys(confirmed, ["plan_revision_id", "project_id", "document_id", "actor_user_id", "_private_ref"])
    || !guestId(confirmed.plan_revision_id) || confirmed.project_id !== value.projectId || confirmed.document_id !== value.documentId
    || confirmed.actor_user_id !== value.guestSubject || confirmed._private_ref !== source.confirmation.id) return fail("invalid");
  if (source.state === "quoted") {
    if (!historicalEvent(source.quote, [...eventKeys, "preflightId", "planRevisionId", "expiresAt", "termsDigest"], source.head + 3, { expiresAt: source.expiresAt, saveEventId: source.saveEventId })
      || !record(source.quote) || source.quote.id === source.confirmation.id || source.quote.recorded < source.confirmation.recorded
      || !guestId(source.quote.preflightId) || source.quote.planRevisionId !== confirmed.plan_revision_id || !rawHash(source.quote.termsDigest)
      || !iso(source.quote.expiresAt) || source.quote.expiresAt <= source.quote.recorded || source.quote.expiresAt > source.expiresAt
      || Date.parse(source.quote.expiresAt) > Date.parse(source.quote.recorded) + 15 * 60_000
      || !command(source.quoteCommand, value.guestSubject, value.projectId, source.quote, "preflight")) return fail("invalid");
    const quoted = json(source.quote.public, 8192);
    if (!exactKeys(quoted, ["preflight_id", "plan_revision_id", "project_id", "document_id", "actor_user_id", "_private_ref"])
      || quoted.preflight_id !== source.quote.preflightId || quoted.plan_revision_id !== confirmed.plan_revision_id
      || quoted.project_id !== value.projectId || quoted.document_id !== value.documentId || quoted.actor_user_id !== value.guestSubject || quoted._private_ref !== source.quote.id) return fail("invalid");
  } else if (source.quote !== null || source.quoteCommand !== null) return fail("invalid");
  if (source.state === "confirmed") { if (source.construction !== null) return fail("invalid"); }
  else {
    const construction = source.construction;
    if (!record(construction) || !exactKeys(construction, ["driverId", "commandDigest", "resource"]) || !text(construction.driverId, 200)
      || !rawHash(construction.commandDigest) || !resource(construction.resource) || construction.resource.operation !== "preflight"
      || construction.resource.resource_id !== `${construction.driverId}:preflight` || source.confirmationResource.resource_id !== `${construction.driverId}:text`
      || construction.resource.recorded_at_ms < Date.parse(source.confirmation.recorded) || construction.resource.recorded_at_ms >= Date.parse(source.expiresAt)
      || source.state === "quoted" && (source.quoteCommand as Command).request_digest !== construction.commandDigest
      || resourceKeys.filter(key => !["resource_id", "operation", "recorded_at_ms"].includes(key)).some(key => (construction.resource as unknown as Record<string, Value>)[key] !== (source.confirmationResource as unknown as Record<string, Value>)[key])) return fail("invalid");
  }
  const roles = guestImageStageHistoryRoles(source.state as GuestImageStageHistoryState);
  if (value.copies.length !== roles.length || value.copies.some((copy, index) => !record(copy) || !exactKeys(copy, ["role", "contentId", "digest", "bytes"])
    || copy.role !== roles[index] || !contentId(copy.contentId) || !guestHash(copy.digest) || !integer(copy.bytes, 1, roleBound(roles[index]))
    || copy.role === "confirmation" && copy.digest !== (source.confirmation as Event).privateDigest
    || copy.role === "quote" && copy.digest !== (source.quote as Event).privateDigest)
    || new Set(value.copies.map(copy => copy.contentId)).size !== roles.length) return fail("invalid");
  return freeze(value as unknown as GuestImageStageClaimLineage);
}
/** Exact existing bytes only. It does not construct a quote or validate live authority. */
export function guestImageStageHistoryStorageValue(role: GuestImageStageHistoryRole, raw: unknown): string {
  if (!["confirmation", "quote", "construction"].includes(role)) return fail("invalid");
  const value = role === "construction" ? parsed(raw, roleBound(role)) : json(raw, roleBound(role));
  if (role === "construction") {
    if (!exactKeys(value, ["stage", "resource"]) || !record(value.stage)
      || !exactKeys(value.stage, ["driver_id", "stage", "command_json", "command_digest"]) || !text(value.stage.driver_id, 200)
      || value.stage.stage !== "preflight" || !rawHash(value.stage.command_digest) || !resource(value.resource)
      || value.resource.operation !== "preflight" || value.resource.resource_id !== `${value.stage.driver_id}:preflight`
      || jsonIssues({ ...value, stage: { ...value.stage, command_json: "" } }).length || canonicalJson(value) !== raw) return fail("invalid");
    // The original command is independently bounded and parsed. Its serialized
    // string can exceed the generic JSON validator's per-string source limit.
    const envelope = json(value.stage.command_json, 65536);
    if (envelope.action !== "preflight") return fail("invalid");
  } else {
    const keys = role === "confirmation" ? ["plan_revision_id", "confirmed_plan", "output_command_envelope", "project_id", "document_id", "actor_user_id"]
      : ["preflight_id", "plan_revision_id", "preflight", "guest_sponsor_quote_transport", "output_command_envelope", "project_id", "document_id", "actor_user_id"];
    if (!exactKeys(value, keys) || !guestId(value.plan_revision_id) || !guestId(value.project_id) || !guestId(value.document_id)
      || !text(value.actor_user_id) || !/^guest:[a-f0-9-]{36}$/u.test(value.actor_user_id) || !record(value.output_command_envelope)
      || value.output_command_envelope.action !== (role === "confirmation" ? "confirm" : "preflight")
      || role === "confirmation" && !record(value.confirmed_plan)
      || role === "quote" && (!guestId(value.preflight_id) || !record(value.preflight) || !record(value.guest_sponsor_quote_transport))) return fail("invalid");
  }
  return raw as string;
}
export async function guestImageStageHistoryIdentity(input: { sessionId: string; destinationUserId: string; manifestDigest: string; role: GuestImageStageHistoryRole; originalDigest: string }): Promise<string> {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId", "destinationUserId", "manifestDigest", "role", "originalDigest"])
    || !guestId(input.sessionId) || !text(input.destinationUserId) || input.destinationUserId.startsWith("guest:") || !guestHash(input.manifestDigest)
    || !["confirmation", "quote", "construction"].includes(input.role) || !guestHash(input.originalDigest)) return fail("invalid");
  return `guest-image-stage-history-${(await digest({ domain: "forma-guest-image-stage-history@1", ...input })).slice(7)}`;
}

/** Dormant DDL only. No route, migration, installer or storage fallback. */
export const GUEST_IMAGE_STAGE_CUSTODY_SCHEMA = [
  `CREATE TABLE experience_guest_image_stage_custodies(session_id TEXT PRIMARY KEY NOT NULL,destination_user_id TEXT NOT NULL,
    lease_id TEXT UNIQUE NOT NULL,request_id TEXT NOT NULL,manifest_digest TEXT NOT NULL,context_lineage_digest TEXT NOT NULL,
    save_lineage_digest TEXT NOT NULL,lineage_json TEXT NOT NULL,lineage_digest TEXT NOT NULL,created_at_ms INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES experience_guest_image_claims(session_id))`,
  `CREATE TABLE experience_guest_image_stage_copies(session_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('confirmation','quote','construction')),
    content_id TEXT UNIQUE NOT NULL,original_digest TEXT NOT NULL,byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=CASE WHEN role='construction' THEN 131072 ELSE 65536 END),
    created_at TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(session_id,role),
    FOREIGN KEY(session_id) REFERENCES experience_guest_image_stage_custodies(session_id),FOREIGN KEY(content_id) REFERENCES private_content(content_id))`,
  ...["custodies", "copies"].flatMap(table => [
    `CREATE TRIGGER experience_guest_image_stage_${table}_no_reinsert BEFORE INSERT ON experience_guest_image_stage_${table}
      WHEN EXISTS(SELECT 1 FROM experience_guest_image_stage_${table} WHERE ${table === "copies" ? "(session_id=NEW.session_id AND role=NEW.role) OR content_id=NEW.content_id" : "session_id=NEW.session_id OR lease_id=NEW.lease_id"})
      BEGIN SELECT RAISE(ABORT,'guest image stage custody exists'); END`,
    ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_guest_image_stage_${table}_no_${action.toLowerCase()} BEFORE ${action} ON experience_guest_image_stage_${table}
      BEGIN SELECT RAISE(ABORT,'guest image stage custody immutable'); END`),
  ]),
  `CREATE TRIGGER experience_guest_image_stage_content_identity BEFORE UPDATE OF content_id,owner_id,kind ON private_content
    WHEN EXISTS(SELECT 1 FROM experience_guest_image_stage_copies WHERE content_id=OLD.content_id)
      AND (NEW.content_id IS NOT OLD.content_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind)
    BEGIN SELECT RAISE(ABORT,'guest image stage content identity immutable'); END`,
] as const;
const tables = ["experience_guest_image_stage_custodies", "experience_guest_image_stage_copies"];
const normalizedDdl = (value: string) => value.replace(/\s+/gu, " ").trim().replace(/;$/u, "");
const objects = GUEST_IMAGE_STAGE_CUSTODY_SCHEMA.map(sql => {
  const match = /^CREATE (TABLE|TRIGGER) ([a-z_]+)/u.exec(sql); if (!match) return fail("schema_unavailable");
  return { type: match[1].toLowerCase(), name: match[2], sql: normalizedDdl(sql), table: match[1] === "TABLE" ? match[2]
    : match[2] === "experience_guest_image_stage_content_identity" ? "private_content" : match[2].startsWith("experience_guest_image_stage_custodies_") ? tables[0] : tables[1] };
});
const schemaSql = `(SELECT json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',definition)) FROM
  (SELECT type,name,tbl_name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql ELSE NULL END AS definition FROM sqlite_schema
    WHERE name IN(${objects.map(item => `'${item.name}'`).join(",")}) OR tbl_name IN(${tables.map(name => `'${name}'`).join(",")}) ORDER BY name,type))`;
/** Exact whole-family witness includes the named trigger on private_content. */
export async function inspectGuestImageStageCustodySchema(env: WorkerEnv) {
  const db = env.DB, result = await db.prepare(`SELECT ${schemaSql} AS snapshot`).first<{ snapshot: string }>();
  if (env.DB !== db) return fail("database_changed");
  if (!result || typeof result.snapshot !== "string" || bytes(result.snapshot) > 131072) return fail("schema_unavailable");
  let found: unknown; try { found = JSON.parse(result.snapshot); } catch { return fail("schema_unavailable"); }
  if (!Array.isArray(found) || found.some(item => !record(item) || !exactKeys(item, ["type", "name", "table", "sql"])
    || typeof item.name !== "string" || typeof item.table !== "string" || !["table", "trigger", "index"].includes(String(item.type))
    || item.sql !== null && typeof item.sql !== "string")) return fail("schema_unavailable");
  const explicit = found.filter(item => !(item.type === "index" && item.sql === null && tables.includes(String(item.table))
    && new RegExp(`^sqlite_autoindex_${item.table}_[1-9][0-9]*$`, "u").test(String(item.name))));
  if (explicit.length !== objects.length || new Set(explicit.map(item => item.name)).size !== objects.length
    || objects.some(expected => !explicit.some(item => item.type === expected.type && item.name === expected.name && item.table === expected.table
      && typeof item.sql === "string" && normalizedDdl(item.sql) === expected.sql))) return fail("schema_unavailable");
  return freeze({ snapshot: result.snapshot, proof: { sql: `${schemaSql}=?`, bindings: [result.snapshot] } as GuestImageStageProof });
}
/** Immutable metadata predicate only. Native completed custody must be joined separately. */
export function guestImageStageCustodyMappingProof(row: GuestImageStageCustodyRow, copies: readonly GuestImageStageCopyRow[]): GuestImageStageProof {
  return all({ sql: `EXISTS(SELECT 1 FROM experience_guest_image_stage_custodies custody WHERE ${arraySql(GUEST_IMAGE_STAGE_CUSTODY_COLUMNS, "custody")}=?)`, bindings: [tuple(row, GUEST_IMAGE_STAGE_CUSTODY_COLUMNS)] },
    { sql: `(SELECT COUNT(*) FROM experience_guest_image_stage_copies WHERE session_id=?)=? AND
      (SELECT COUNT(*) FROM json_each(?) expected JOIN experience_guest_image_stage_copies copy ON ${arraySql(GUEST_IMAGE_STAGE_COPY_COLUMNS, "copy")}=expected.value)=?`,
    bindings: [row.session_id, copies.length, JSON.stringify(copies.map(copy => tuple(copy, GUEST_IMAGE_STAGE_COPY_COLUMNS))), copies.length] });
}
/** Internal source-free facts. A selector and this returned DTO confer no read authority. */
export async function readGuestImageStageCustodyMapping(env: WorkerEnv, input: { sessionId: string }) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return fail("invalid");
  const db = env.DB, current = () => { if (env.DB !== db) return fail("database_changed"); };
  const schema = await inspectGuestImageStageCustodySchema(env); current();
  const row = await db.prepare(`SELECT ${GUEST_IMAGE_STAGE_CUSTODY_COLUMNS} FROM experience_guest_image_stage_custodies WHERE session_id=?
    AND length(CAST(lineage_json AS BLOB)) BETWEEN 1 AND 65536`).bind(input.sessionId).first<GuestImageStageCustodyRow>(); current();
  if (!row) {
    const present = await db.prepare("SELECT 1 FROM experience_guest_image_stage_custodies WHERE session_id=?").bind(input.sessionId).first(); current();
    if (present) return fail(); return null;
  }
  const lineage = readGuestImageStageClaimLineage(row.lineage_json);
  if (row.session_id !== input.sessionId || row.session_id !== lineage.sessionId || row.destination_user_id !== lineage.destinationUserId
    || row.manifest_digest !== lineage.manifestDigest || row.context_lineage_digest !== lineage.contextLineageDigest || row.save_lineage_digest !== lineage.saveLineageDigest
    || !text(row.lease_id, 200) || !text(row.request_id, 200) || !integer(row.created_at_ms) || !guestHash(row.lineage_digest)
    || row.lineage_digest !== await digest(lineage)) return fail(); current();
  const result = await db.prepare(`SELECT ${GUEST_IMAGE_STAGE_COPY_COLUMNS} FROM experience_guest_image_stage_copies WHERE session_id=?
    ORDER BY CASE role WHEN 'confirmation' THEN 0 WHEN 'quote' THEN 1 WHEN 'construction' THEN 2 ELSE 3 END LIMIT 4`).bind(input.sessionId).all<GuestImageStageCopyRow>(); current();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== lineage.copies.length) return fail();
  const copies: GuestImageStageCopyRow[] = [];
  for (let i = 0; i < lineage.copies.length; i++) {
    const copy = result.results[i], expected = lineage.copies[i];
    if (!Object.hasOwn(result.results, i) || !copy || !exactKeys(copy, GUEST_IMAGE_STAGE_COPY_COLUMNS.split(",")) || copy.session_id !== row.session_id
      || copy.role !== expected.role || copy.content_id !== expected.contentId || copy.original_digest !== expected.digest || copy.byte_length !== expected.bytes
      || !iso(copy.created_at) || !iso(copy.expires_at) || copy.expires_at <= copy.created_at
      || copy.content_id !== await guestImageStageHistoryIdentity({ sessionId: lineage.sessionId, destinationUserId: lineage.destinationUserId,
        manifestDigest: lineage.manifestDigest, role: expected.role, originalDigest: expected.digest })) return fail(); current();
    copies.push(copy);
  }
  const proof = all(schema.proof, guestImageStageCustodyMappingProof(row, copies));
  const live = await db.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings).first<{ current: number }>(); current();
  if (live?.current !== 1) return fail();
  return freeze({ row, lineage, copies, proof, schema });
}
function personalContent(): string {
  return `NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=content.content_id)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=content.content_id)`;
}
function capturedCopy(owner: string, copy: GuestImageStageCopyRow): void {
  // Unlike scalar SQL equality, JSON can make two nulls compare equal. Reject
  // malformed captured operands before serializing the exact non-null tuple.
  if (!text(owner) || owner.startsWith("guest:") || !record(copy) || jsonIssues(copy).length
    || !exactKeys(copy, GUEST_IMAGE_STAGE_COPY_COLUMNS.split(",")) || !guestId(copy.session_id)
    || !["confirmation", "quote", "construction"].includes(copy.role) || !contentId(copy.content_id) || !guestHash(copy.original_digest)
    || !integer(copy.byte_length, 1, roleBound(copy.role)) || !iso(copy.created_at) || !iso(copy.expires_at) || copy.expires_at <= copy.created_at) return fail("body_unavailable");
}
/** Incomplete exact metadata predicate only. This pure value helper cannot mint
 * canonical authority; the dedicated reader joins its real completed witness. */
export function guestImageStageCopyMetadataProof(owner: string, copy: GuestImageStageCopyRow, exclusion: GuestImageStageProof): GuestImageStageProof {
  capturedCopy(owner, copy);
  return { sql: `EXISTS(SELECT 1 FROM private_content content WHERE json_array(content.content_id,content.owner_id,content.created_at,content.expires_at,length(CAST(content.content AS BLOB)))=?
    AND content.kind='guest-image-stage-history' AND content.redacted_at IS NULL
    AND content.created_at<=${now} AND content.expires_at>${now} AND (${personalContent()}) AND (${exclusion.sql}))`,
  bindings: [JSON.stringify([copy.content_id, owner, copy.created_at, copy.expires_at, copy.byte_length]), ...exclusion.bindings] };
}
/** Incomplete exact body predicate only. This pure value helper cannot mint
 * canonical authority; the dedicated reader joins its real completed witness. */
export function guestImageStageCopyBodyProof(owner: string, copy: GuestImageStageCopyRow, body: string, exclusion: GuestImageStageProof): GuestImageStageProof {
  capturedCopy(owner, copy);
  if (typeof body !== "string" || !body.isWellFormed() || bytes(body) !== copy.byte_length) return fail("body_unavailable");
  return { sql: `EXISTS(SELECT 1 FROM private_content content WHERE json_array(content.content_id,content.owner_id,content.content,length(CAST(content.content AS BLOB)),content.created_at,content.expires_at)=?
    AND content.kind='guest-image-stage-history' AND content.created_at<=${now} AND content.expires_at>${now}
    AND content.redacted_at IS NULL AND (${personalContent()}) AND (${exclusion.sql}))`,
  bindings: [JSON.stringify([copy.content_id, owner, body, copy.byte_length, copy.created_at, copy.expires_at]), ...exclusion.bindings] };
}
/** Incomplete exact body-set predicate only. Its bounded values never confer
 * canonical authority; the dedicated reader joins its real completed witness. */
export function guestImageStageCopyBodiesProof(owner: string, copies: readonly GuestImageStageCopyRow[], contents: readonly string[], exclusion: GuestImageStageProof): GuestImageStageProof {
  if (!Array.isArray(copies) || copies.length < 1 || copies.length > 3 || jsonIssues(copies).length
    || !Array.isArray(contents) || contents.length !== copies.length || Reflect.ownKeys(contents).length !== contents.length + 1) return fail("body_unavailable");
  const properties = Object.getOwnPropertyDescriptors(contents), identities = new Set<string>(), roles = new Set<GuestImageStageHistoryRole>();
  const expected: (string | number)[][] = [];
  for (let index = 0; index < copies.length; index++) {
    const copy = copies[index], property = properties[String(index)]; capturedCopy(owner, copy);
    if (!property || !Object.hasOwn(property, "value") || !property.enumerable) return fail("body_unavailable");
    const body: unknown = property.value;
    if (typeof body !== "string" || !body.isWellFormed() || bytes(body) !== copy.byte_length
      || identities.has(copy.content_id) || roles.has(copy.role)) return fail("body_unavailable");
    identities.add(copy.content_id); roles.add(copy.role);
    expected.push([copy.content_id, owner, body, copy.byte_length, copy.created_at, copy.expires_at]);
  }
  return { sql: `(SELECT COUNT(DISTINCT content.content_id) FROM json_each(?) stage_expected JOIN private_content content
    ON json_array(content.content_id,content.owner_id,content.content,length(CAST(content.content AS BLOB)),content.created_at,content.expires_at)=stage_expected.value
    WHERE content.kind='guest-image-stage-history' AND content.created_at<=${now} AND content.expires_at>${now}
    AND content.redacted_at IS NULL AND (${personalContent()}) AND (${exclusion.sql}))=?`,
  bindings: [JSON.stringify(expected), ...exclusion.bindings, copies.length] };
}
function bindCompleted(mapping: NonNullable<Awaited<ReturnType<typeof readGuestImageStageCustodyMapping>>>, completed: ReturnType<typeof guestImageCompletedClaimData>) {
  const { row, lineage } = mapping, native = completed.lineage;
  if (row.destination_user_id !== native.destinationUserId || row.session_id !== native.sessionId || row.lease_id !== completed.row.lease_id
    || row.request_id !== completed.row.request_id || row.manifest_digest !== native.manifestDigest || row.context_lineage_digest !== completed.row.context_lineage_digest
    || row.save_lineage_digest !== completed.row.lineage_digest || row.created_at_ms !== completed.row.created_at_ms
    || lineage.projectId !== native.projectId || lineage.documentId !== native.documentId || lineage.guestSubject !== native.guestSubject
    || lineage.source.head !== native.source.head || lineage.source.saveHead !== native.source.save.sequence || lineage.source.saveEventId !== native.source.save.id
    || lineage.source.expiresAt !== native.source.expiresAt || native.source.eventIds.includes(lineage.source.confirmation.id)
    || lineage.source.quote && native.source.eventIds.includes(lineage.source.quote.id)
    || Date.parse(lineage.source.confirmation.recorded) < Date.parse(native.source.save.recorded)) return fail();
}
/** Dedicated current canonical read. Historical output is never a live quote capability. */
export async function readClaimedGuestImageStageHistory(request: Request, env: WorkerEnv, input: { sessionId: string }) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return fail("invalid");
  const db = env.DB, witness = await inspectCompletedGuestImageClaim(request, env, input);
  if (env.DB !== db) return fail("database_changed");
  if (!witness) return null;
  const current = () => guestImageCompletedClaimData(request, env, witness), completed = current();
  const mapping = await readGuestImageStageCustodyMapping(env, input); current();
  if (!mapping) return null; bindCompleted(mapping, completed);
  const exclusion = await nativeMemoryAnswerExclusion(env, { answerAlias: "content" }); current();
  const base = all(completed.proof, mapping.proof), components: { role: GuestImageStageHistoryRole; originalDigest: string; createdAt: string; expiresAt: string; content: string }[] = [];
  const bodyContents: string[] = [];
  for (const copy of mapping.copies) {
    const readable = all(base, guestImageStageCopyMetadataProof(completed.lineage.destinationUserId, copy, exclusion));
    const found = await db.prepare(`SELECT content FROM private_content WHERE content_id=? AND length(CAST(content AS BLOB)) BETWEEN 1 AND ? AND ${readable.sql}`)
      .bind(copy.content_id, roleBound(copy.role), ...readable.bindings).first<{ content: string }>(); current();
    if (!found) return fail("body_unavailable");
    const content = guestImageStageHistoryStorageValue(copy.role, found.content);
    if (await digest(content) !== copy.original_digest) return fail("body_unavailable"); current();
    const value = parsed(content, roleBound(copy.role)), source = mapping.lineage.source;
    if (copy.role === "construction") {
      if (!source.construction || canonicalJson(value.resource) !== canonicalJson(source.construction.resource)
        || !record(value.stage) || value.stage.driver_id !== source.construction.driverId || value.stage.command_digest !== source.construction.commandDigest
        || (await digest(json(value.stage.command_json, 65536))).slice(7) !== source.construction.commandDigest) return fail("body_unavailable"); current();
    } else {
      const event = copy.role === "confirmation" ? source.confirmation : source.quote;
      if (!event || value.project_id !== mapping.lineage.projectId || value.document_id !== mapping.lineage.documentId || value.actor_user_id !== mapping.lineage.guestSubject
        || JSON.stringify(publicEventPayload(event.id, value, true).payload) !== event.public) return fail("body_unavailable");
    }
    bodyContents.push(content);
    components.push({ role: copy.role, originalDigest: copy.original_digest, createdAt: copy.created_at, expiresAt: copy.expires_at, content });
  }
  // No disclosure uses a cached proof alone. This final joined SQL follows every
  // digest/parse await, and the opaque request/DB guard follows its own await.
  const final = all(base, guestImageStageCopyBodiesProof(completed.lineage.destinationUserId, mapping.copies, bodyContents, exclusion)), result = await db.prepare(`SELECT 1 AS current WHERE ${final.sql}`).bind(...final.bindings).first<{ current: number }>(); current();
  if (result?.current !== 1) return fail("body_unavailable");
  return freeze({ version: 1 as const, kind: "guest-image-stage-history" as const, sessionId: mapping.lineage.sessionId,
    documentId: mapping.lineage.documentId, stageState: mapping.lineage.source.state,
    provenance: { guestSubject: mapping.lineage.guestSubject, originalPayerUserId: mapping.lineage.source.originalPayerUserId,
      originalSourceExpiresAt: mapping.lineage.source.expiresAt, originalQuoteExpiresAt: mapping.lineage.source.quote?.expiresAt ?? null },
    components, generationAvailable: false as const, miniAppClaimComplete: false as const });
}
