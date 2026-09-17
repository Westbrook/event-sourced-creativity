import { canonicalJson, digest, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceDraftId, experienceResourceId, receiptPrefix, type ExperiencePlan } from "../src/experiences/intake.ts";
import { EXPERIENCE_IMAGE_RATIOS, experienceImageFormat } from "../src/experiences/image-ratio.ts";
import { inspectOutputRequirement } from "../src/model/output-requirements.ts";
import { authoritativeCreativeContext } from "./context-authority.ts";
import { publicEventPayload } from "./event-privacy.ts";
import type { EventRow } from "./event-write-primitives.ts";
import { guestFail, guestHash, guestId, readGuestCustodyTerms, type GuestClaimProof } from "./experience-guest-session.ts";
import { compileGuestSponsorApprovalProposal, compileGuestSponsorSessionBinding, compileGuestSponsorSourceBinding, deriveGuestSponsorDriver } from "./experience-guest-sponsor-contract.ts";
import { experienceOutputBinding, experienceOutputEnvelope } from "./experience-output-binding.ts";
import { createExperienceOutputRecipe } from "./experience-output-recipe.ts";
import { SPONSOR_ENTITLEMENT_SCHEMA } from "./experience-sponsor-entitlement.ts";
import { SPONSOR_RESOURCE_SCHEMA } from "./experience-sponsor-resources.ts";
import { SPONSOR_APPROVAL_SCHEMA } from "./experience-sponsor-approval.ts";
import { SPONSOR_ISSUER_SCHEMA } from "./experience-sponsor-issuer.ts";
import { SPONSOR_DRIVER_SCHEMA } from "./experience-sponsor-driver.ts";
import { SPONSOR_INTAKE_SCHEMA } from "./experience-sponsor-intake.ts";
import { SPONSOR_READ_POLICY_SCHEMA } from "./experience-sponsor-read-policy.ts";
import { SPONSOR_READ_APPROVAL_SCHEMA } from "./experience-sponsor-read-approval.ts";
import { SPONSOR_READ_ATTEMPT_SCHEMA } from "./experience-sponsor-read-attempts.ts";
import { SPONSOR_INTAKE_READ_POLICY_SCHEMA } from "./experience-sponsor-intake-read-policy.ts";
import { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA } from "./experience-sponsor-intake-read-approval.ts";
import { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA, SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA } from "./experience-sponsor-intake-read-attempts.ts";
import { SPONSOR_NATIVE_IMAGE_READ_INDEXES } from "./experience-sponsor-native-image-read.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { normalizePlanSuggestions } from "./output-trusted-context.ts";
import type { WorkerEnv } from "./runtime.ts";

import { readGuestImageSourceForCustody, readGuestSourcePolicy } from "./experience-guest-source.ts";
import { GUEST_CONTEXT_ADOPTION_SCHEMA } from "./experience-guest-context-adoption.ts";
import { GUEST_PLAN_CUSTODY_SCHEMA } from "./experience-guest-plan-custody.ts";

import { GUEST_IMAGE_SAVE_CLAIM_SCHEMA } from "./experience-guest-image-claim-inventory.ts";

export type Value = string | number | null;
export type Row = Record<string, Value>;
export type Proof = { sql: string; bindings: Value[] };
export type Context = { env: WorkerEnv; db: WorkerEnv["DB"] } | { env: WorkerEnv; db: WorkerEnv["DB"]; request: Request; url: string; headers: string; origin: string; signal: AbortSignal };
export const fail = (part = "unavailable"): never => { throw new Error(`guest_image_output_retirement_${part}`); };
export const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
export const integer = (value: unknown, min = 0, max = 8_000_000_000_000): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
export const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
export const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value)
  && !/^forma-guest-(session|claim)-v1\./u.test(value);
export const objectSql = (columns: readonly string[], alias = "") => `json_object(${columns.flatMap(column => [`'${column}'`, `${alias}${column}`]).join(",")})`;
export const flatRow = (value: unknown, columns: readonly string[]): value is Row => record(value) && exactKeys(value, columns)
  && Object.values(value).every(item => item === null || typeof item === "string" || typeof item === "number" && Number.isFinite(item));
export const current = (ctx: Context) => {
  if (ctx.env.DB !== ctx.db) guestFail("database_changed");
  if (!("request" in ctx)) return;
  const { request } = ctx, url = new URL(request.url), site = request.headers.get("sec-fetch-site");
  if (request.signal !== ctx.signal || request.signal.aborted || request.method !== "POST" || request.url !== ctx.url
    || JSON.stringify(Array.from(request.headers)) !== ctx.headers || url.protocol !== "https:" || url.username || url.password
    || url.search || url.hash || url.origin !== ctx.origin || request.headers.get("origin") !== ctx.origin
    || site !== null && site !== "same-origin" && site !== "none") return fail();
};
export function json(value: unknown, maximum = 65536): Record<string, unknown> {
  if (typeof value !== "string" || bytes(value) > maximum || value.includes("\0")) return fail();
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { return fail(); }
  if (!record(parsed) || jsonIssues(parsed).length) return fail();
  return parsed;
}
export function together(parts: readonly Proof[]): Proof {
  // Sibling CTEs preserve actual D1 expression depth and bind limits.
  return { sql: `EXISTS(WITH ${parts.map((part, i) => `guest_retirement_proof_${i} AS MATERIALIZED(SELECT 1 WHERE ${part.sql})`).join(",")}
    SELECT 1 FROM ${parts.map((_, i) => `guest_retirement_proof_${i}`).join(",")})`, bindings: parts.flatMap(part => part.bindings) };
}
export async function checkedDigest(ctx: Context, value: unknown) {
  const result = await digest(value); current(ctx); return result;
}
export const canonicalRedactionSql = (column: string) => `typeof(${column})='text' AND length(CAST(${column} AS BLOB))=24
  AND ${column}=strftime('%Y-%m-%dT%H:%M:%fZ',${column})`;
export async function snapshot(ctx: Context, parts: Proof[], table: string, key: string, value: Value, columns: string[], bound: string): Promise<Row> {
  const observed = await ctx.db.prepare(`SELECT ${objectSql(columns)} AS witness FROM ${table} WHERE ${key}=? AND (${bound})`).bind(value).first<{ witness: string }>(); current(ctx);
  if (!observed || typeof observed.witness !== "string") return fail();
  let row: unknown; try { row = JSON.parse(observed.witness); } catch { return fail(); }
  if (!flatRow(row, columns)) return fail();
  parts.push({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${key}=? AND ${objectSql(columns)}=?)`, bindings: [value, observed.witness] });
  return row;
}
export const sourceColumns = ["session_id", "policy_id", "policy_digest", "draft_id", "draft_hash", "request_digest", "content_digest", "draft_bytes", "event_bytes", "event_count", "expires_at"];
export const sessionColumns = ["session_id", "policy_id", "terms_digest", "guest_subject", "project_id", "document_id", "session_hash", "claim_hash", "created_at_ms", "expires_at_ms", "revoked_at_ms"];
export const policyColumns = ["policy_id", "policy_digest", "policy_json", "review_digest", "revoked_at_ms"];
export const sessionPolicyColumns = ["policy_id", "terms_digest", "terms_json", "review_digest", "revoked_at_ms"];
export const draftColumns = ["content_id", "owner_id", "kind", "content", "created_at", "expires_at", "redacted_at"];
export const commitColumns = ["session_id", "draft_hash", "head", "event_ids_json"];
export const eventColumns = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"];
export const bodyColumns = ["owner_id", "project_id", "document_id", "private_json", "created_at", "redacted_at"];
export const eventWitness = `json_set(${objectSql(eventColumns, "e.")},${bodyColumns.flatMap(key => [`'$.${key}'`, `body.${key}`]).join(",")})`;
export const prefixWitness = `json_set(${eventWitness},'$.receipt_key',receipt.client_event_id,'$.receipt_created_at',receipt.created_at)`;
export const prefixJoins = `JOIN events e ON e.event_id=expected.value JOIN event_private_payloads body ON body.private_event_id=e.event_id
  JOIN event_client_receipts receipt ON receipt.event_id=e.event_id AND receipt.stream_id=e.stream_id AND receipt.sequence=e.sequence`;
export const commandColumns = ["scope_key", "actor_user_id", "command_key", "request_digest", "action", "event_id", "created_at"];
export const resourceColumns = ["resource_id", "campaign_id", "policy_digest", "limits_digest", "actor_user_id", "session_digest", "operation", "intent_key", "payload_digest", "text_bytes", "issued_grant_id", "recorded_at_ms"];

const registries = ["memory_native_answer_origins", "memory_structured_answer_origins", "memory_document_job_answer_origins"] as const;
const registrySchemaSql = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
  (SELECT type,name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition FROM sqlite_schema
    WHERE type IN('table','view') AND name IN(${registries.map(name => `'${name}'`).join(",")}) ORDER BY name LIMIT 4))`;
export async function memoryProof(ctx: Context, draftId: string) {
  // Independent native family qualification, not an all-three-present gate.
  const memory = await nativeMemoryAnswerExclusion(ctx.env, { answerAlias: "private_content" }); current(ctx);
  const row = await ctx.db.prepare(`SELECT ${registrySchemaSql} AS snapshot`).first<{ snapshot: string }>(); current(ctx);
  if (!row || typeof row.snapshot !== "string" || bytes(row.snapshot) > 65536) return fail();
  let observed: unknown; try { observed = JSON.parse(row.snapshot); } catch { return fail(); }
  if (!Array.isArray(observed) || observed.length > registries.length || observed.some(entry => !record(entry)
    || !exactKeys(entry, ["type", "name", "sql"]) || entry.type !== "table" || !registries.includes(entry.name as typeof registries[number]) || typeof entry.sql !== "string")) return fail();
  return { proof: together([{ sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND (${memory.sql}))`, bindings: [draftId, ...memory.bindings] },
    { sql: `${registrySchemaSql}=?`, bindings: [row.snapshot] }]), registries: observed.map(entry => String(entry.name)) };
}

type SponsorSchemaFamily = { required: boolean; sql: readonly string[]; alternatives?: readonly (readonly string[])[] };
const sponsorFamilies: readonly SponsorSchemaFamily[] = [
  { required: false, sql: GUEST_CONTEXT_ADOPTION_SCHEMA }, { required: false, sql: GUEST_PLAN_CUSTODY_SCHEMA },
  { required: true, sql: SPONSOR_ENTITLEMENT_SCHEMA }, { required: true, sql: SPONSOR_RESOURCE_SCHEMA }, { required: true, sql: SPONSOR_APPROVAL_SCHEMA },
  { required: false, sql: SPONSOR_ISSUER_SCHEMA }, { required: false, sql: SPONSOR_DRIVER_SCHEMA }, { required: false, sql: SPONSOR_INTAKE_SCHEMA },
  { required: false, sql: SPONSOR_READ_POLICY_SCHEMA }, { required: false, sql: SPONSOR_READ_APPROVAL_SCHEMA }, { required: false, sql: SPONSOR_READ_ATTEMPT_SCHEMA },
  { required: false, sql: SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { required: false, sql: SPONSOR_INTAKE_READ_APPROVAL_SCHEMA },
  { required: false, sql: SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA, alternatives: [SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA] },
  // The native sponsored reader separately provisions this exact index on an
  // entitlement table. Its other indexes concern events/artifact rows and are
  // outside this sponsor-family schema witness; none grants guest authority.
  { required: false, sql: SPONSOR_NATIVE_IMAGE_READ_INDEXES.filter(index => index.name === "idx_sponsor_image_actor_history").map(index => index.sql) },
];
const normalizedDdl = (value: string) => value.replace(/\s+/gu, " ").trim().replace(/;$/u, "").replace(/CREATE TABLE IF NOT EXISTS /iu, "CREATE TABLE ");
const schemaItem = (sql: string) => {
  const match = /^CREATE (TABLE|INDEX|TRIGGER)(?: IF NOT EXISTS)? ([a-zA-Z0-9_]+)/u.exec(sql.trim());
  if (!match) return fail("schema_unavailable");
  return { type: match[1].toLowerCase(), name: match[2], sql: normalizedDdl(sql) };
};
function schemaProfile(families: readonly SponsorSchemaFamily[]) {
  const sponsorVariants = families.map(family => ({ required: family.required,
    variants: [family.sql, ...(family.alternatives ?? [])].map(variant => variant.map(schemaItem)) }));
  const sponsorNames = [...new Set(sponsorVariants.flatMap(family => family.variants.flatMap(variant => variant.map(item => item.name))))];
  const sponsorTables = [...new Set(sponsorVariants.flatMap(family => family.variants.flatMap(variant =>
    variant.filter(item => item.type === "table").map(item => item.name))))];
  const sponsorSchemaSql = `(SELECT json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',sql)) FROM
  (SELECT type,name,tbl_name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql ELSE NULL END AS sql FROM sqlite_schema
    WHERE name IN(${sponsorNames.map(name => `'${name}'`).join(",")}) OR tbl_name IN(${sponsorTables.map(name => `'${name}'`).join(",")}) ORDER BY name,type))`;
  return { sponsorVariants, sponsorNames, sponsorTables, sponsorSchemaSql };
}
const firstSaveSchemaProfile = schemaProfile(sponsorFamilies);
const laterStageSchemaProfile = schemaProfile([...sponsorFamilies.map(family => family.sql === SPONSOR_DRIVER_SCHEMA ? { ...family, required: true } : family),
  { required: false, sql: GUEST_IMAGE_SAVE_CLAIM_SCHEMA }]);
async function readSponsorSchema(ctx: Context, profile: ReturnType<typeof schemaProfile>) {
  const { sponsorVariants, sponsorNames, sponsorTables, sponsorSchemaSql } = profile;
  const row = await ctx.db.prepare(`SELECT ${sponsorSchemaSql} AS snapshot`).first<{ snapshot: string }>(); current(ctx);
  if (!row || typeof row.snapshot !== "string" || bytes(row.snapshot) > 262144) return fail("schema_unavailable");
  let observed: unknown; try { observed = JSON.parse(row.snapshot); } catch { return fail("schema_unavailable"); }
  if (!Array.isArray(observed) || observed.some(item => !record(item) || !exactKeys(item, ["type", "name", "table", "sql"])
    || typeof item.name !== "string" || typeof item.table !== "string" || !sponsorTables.includes(item.table)
    || item.sql !== null && typeof item.sql !== "string" || !["table", "index", "trigger"].includes(String(item.type)))) return fail("schema_unavailable");
  const explicit = observed.filter(item => !(item.type === "index" && item.sql === null
    && String(item.name).startsWith(`sqlite_autoindex_${item.table}_`)
    && /^[1-9][0-9]*$/u.test(String(item.name).slice(`sqlite_autoindex_${item.table}_`.length))));
  // Unknown explicit objects can change writes/ownership even when all named
  // native tables still exist. Pin genuine implicit indexes too, without
  // mistaking their null SQL for an explicitly installed native definition.
  if (explicit.some(item => !sponsorNames.includes(String(item.name)) || typeof item.sql !== "string")
    || new Set(explicit.map(item => item.name)).size !== explicit.length) return fail("schema_unavailable");
  const entries = new Map(explicit.map(item => [String(item.name), item]));
  const tables = new Set<string>();
  for (const family of sponsorVariants) {
    const names = new Set(family.variants.flatMap(variant => variant.map(item => item.name)));
    const present = [...names].filter(name => entries.has(name));
    if (!family.required && !present.length) continue;
    // Accept one whole native version, never a per-object mixture. The raw
    // observed snapshot below still fences a later legitimate schema change.
    const expected = family.variants.find(variant => present.length === variant.length && variant.every(item => {
      const actual = entries.get(item.name); return actual && actual.type === item.type && normalizedDdl(String(actual.sql)) === item.sql;
    }));
    if (!expected) return fail("schema_unavailable");
    expected.filter(item => item.type === "table").forEach(item => tables.add(item.name));
  }
  return { proof: { sql: `${sponsorSchemaSql}=?`, bindings: [row.snapshot] } as Proof, tables, snapshot: row.snapshot };
}

export async function sponsorSchema(ctx: Context) { return readSponsorSchema(ctx, firstSaveSchemaProfile); }
export async function laterStageSponsorSchema(ctx: Context) { return readSponsorSchema(ctx, laterStageSchemaProfile); }

export const nativeBranches = [
  ["events", "d.actor=s.guest AND d.event_id NOT IN(SELECT value FROM json_each(s.ids))"],
  ["private_content", "d.owner_id=s.guest AND d.content_id<>s.draft"], ["external_content", "d.owner_id=s.guest"],
  ["event_private_payloads", "d.owner_id=s.guest AND d.private_event_id NOT IN(SELECT value FROM json_each(s.ids))"],
  ["event_client_receipts", "d.stream_id=s.stream AND d.event_id NOT IN(SELECT value FROM json_each(s.prefix))"],
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
  ["budget_reservations", "d.owner_id=s.guest OR d.stream_id=s.stream"], ["cost_budget_reservations", "d.owner_id=s.guest OR d.stream_id=s.stream"],
  ["shares", "d.owner_id=s.guest OR d.stream_id=s.stream"], ["share_scopes", "d.owner_id=s.guest OR d.project_id=s.project OR d.resource_id=s.document"],
  ["project_context_package_bindings", "d.project_id=s.project OR d.document_id=s.document"], ["project_review_tasks", "d.project_id=s.project OR d.document_id=s.document"],
  ["output_commands", "(d.scope_key=s.scope OR d.actor_user_id=s.guest) AND NOT(d.scope_key=s.scope AND d.actor_user_id=s.guest AND d.command_key=s.command AND d.event_id=s.tail)"],
  ["output_plan_revisions", "d.scope_key=s.scope OR d.owner_user_id=s.guest OR d.project_id=s.project OR d.document_id=s.document"], ["output_plan_targets", "d.scope_key=s.scope"],
  ["output_preflights", "d.scope_key=s.scope OR d.actor_user_id=s.guest"],
  ["output_execution_grants", "d.scope_key=s.scope OR d.actor_user_id=s.guest OR d.payer_user_id=s.guest"],
  ...["output_operation_slots", "output_operation_routes", "output_provider_calls", "output_native_storage_writes", "output_plan_fulfillments"].map(table => [table, "d.scope_key=s.scope"]),
  ["output_assets", "d.scope_key=s.scope OR d.owner_user_id=s.guest OR d.created_by_user_id=s.guest OR d.document_id=s.document"],
  ["output_asset_storage_writes", "d.scope_key=s.scope OR d.owner_user_id=s.guest OR d.actor_user_id=s.guest OR d.project_id=s.project OR d.document_id=s.document"],
  ["output_results", "d.scope_key=s.scope OR d.created_by_user_id=s.guest OR d.document_id=s.document"],
  ["output_target_acceptances", "d.scope_key=s.scope OR d.reviewer_user_id=s.guest"],
  ["output_delivery_manifests", "d.scope_key=s.scope OR d.created_by_user_id=s.guest OR d.document_id=s.document"],
];
export function unsupportedIdentityJson(column: string, selectors: readonly string[] = ["documentId"]) {
  const keys = selectors.map(key => `'${key}'`).join(",");
  // JSON1 reads a duplicate key's first value while JSON.parse retains its
  // last. Exactly one text value per selected identity avoids that ambiguity
  // without pretending to validate an unrelated actor's complete command.
  return `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=65536 THEN CASE WHEN json_valid(${column})
    THEN json_type(${column})<>'object'
      OR (SELECT COUNT(*) FROM json_each(${column}) identity WHERE identity.key IN(${keys}))<>${selectors.length}
      OR (SELECT COUNT(DISTINCT identity.key) FROM json_each(${column}) identity WHERE identity.key IN(${keys}) AND identity.type='text')<>${selectors.length}
    ELSE 1 END ELSE 1 END`;
}
export function boundedIdentityValue(column: string, key: string) {
  // Do not rely on AND/OR predicate evaluation order to guard JSON parsing.
  return `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=65536
    THEN CASE WHEN json_valid(${column}) THEN json_extract(${column},'$.${key}') END END`;
}
async function readSource(ctx: Context, sessionId: string, mode: "due" | "retained") {
  const parts: Proof[] = [];
  const source = await snapshot(ctx, parts, "experience_guest_sources", "session_id", sessionId, sourceColumns,
    "length(CAST(draft_id AS BLOB))<=128 AND length(CAST(policy_id AS BLOB))<=160 AND length(CAST(expires_at AS BLOB))=24 AND length(CAST(policy_digest AS BLOB))=71 AND length(CAST(draft_hash AS BLOB))=71 AND length(CAST(request_digest AS BLOB))=71 AND length(CAST(content_digest AS BLOB))=71 AND draft_bytes BETWEEN 1 AND 65536 AND event_bytes BETWEEN 1 AND 65536 AND event_count BETWEEN 3 AND 16");
  if (!guestId(source.policy_id) || !guestHash(source.policy_digest) || !guestHash(source.draft_hash)
    || !guestHash(source.request_digest) || !guestHash(source.content_digest) || !iso(source.expires_at)
    || !integer(source.draft_bytes, 1, 65_536) || !integer(source.event_bytes, 1, 65_536) || !integer(source.event_count, 3, 16)) return fail();
  if (mode === "due") {
    const due = await ctx.db.prepare("SELECT ?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due").bind(source.expires_at).first<{ due: number }>();
    current(ctx); if (due?.due !== 1) return fail("not_due");
  } else {
    const retained = await ctx.db.prepare("SELECT ?>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS retained").bind(source.expires_at).first<{ retained: number }>();
    current(ctx); if (retained?.retained !== 1) return fail("expired");
  }
  const sessionParts: Proof[] = [];
  const session = await snapshot(ctx, sessionParts, "experience_guest_sessions", "session_id", sessionId, sessionColumns,
    "length(CAST(guest_subject AS BLOB))<=160 AND length(CAST(project_id AS BLOB))<=160 AND length(CAST(document_id AS BLOB))<=160 AND length(CAST(policy_id AS BLOB))<=160 AND length(CAST(terms_digest AS BLOB))=71 AND length(CAST(session_hash AS BLOB))=71 AND length(CAST(claim_hash AS BLOB))=71");
  const sessionProof = sessionParts[0];
  parts.push(sessionProof);
  if (typeof session.guest_subject !== "string" || !/^guest:[a-f0-9-]{36}$/u.test(session.guest_subject)
    || !guestId(session.policy_id) || !guestHash(session.terms_digest) || !guestHash(session.session_hash) || !guestHash(session.claim_hash)
    || !integer(session.created_at_ms, 0, 8_640_000_000_000_000) || !integer(session.expires_at_ms, 1, 8_640_000_000_000_000)
    || session.expires_at_ms <= session.created_at_ms || Date.parse(source.expires_at) > session.expires_at_ms) return fail();
  const sourcePolicy = await snapshot(ctx, parts, "experience_guest_source_policies", "policy_id", source.policy_id, policyColumns, "length(CAST(policy_json AS BLOB)) BETWEEN 1 AND 4096");
  const sessionPolicy = await snapshot(ctx, parts, "experience_guest_policies", "policy_id", session.policy_id, sessionPolicyColumns, "length(CAST(terms_json AS BLOB)) BETWEEN 1 AND 4096");
  let policy, terms;
  try { policy = readGuestSourcePolicy(json(sourcePolicy.policy_json)); terms = readGuestCustodyTerms(json(sessionPolicy.terms_json)); }
  catch { return fail(); }
  const draftId = await experienceDraftId(session.guest_subject, sessionId); current(ctx);
  const [projectId, documentId, policyDigest, termsDigest] = await Promise.all([
    experienceResourceId(draftId, "project"), experienceResourceId(draftId, "document"), checkedDigest(ctx, policy), checkedDigest(ctx, terms),
  ]);
  current(ctx);
  if (draftId !== source.draft_id || projectId !== session.project_id || documentId !== session.document_id
    || policy.policyId !== source.policy_id || policyDigest !== source.policy_digest || sourcePolicy.policy_digest !== policyDigest
    || canonicalJson(policy) !== sourcePolicy.policy_json || !guestHash(sourcePolicy.review_digest)
    || policy.sessionPolicyId !== session.policy_id || policy.sessionTermsDigest !== session.terms_digest
    || terms.policyId !== session.policy_id || termsDigest !== session.terms_digest || sessionPolicy.terms_digest !== termsDigest
    || canonicalJson(terms) !== sessionPolicy.terms_json || !guestHash(sessionPolicy.review_digest)
    || session.created_at_ms < terms.startsAtMs || session.expires_at_ms > terms.expiresAtMs
    || session.expires_at_ms - session.created_at_ms > terms.sessionLifetimeMs
    || source.draft_bytes > policy.maximumDraftBytes || source.event_bytes > policy.maximumEventBytes || source.event_count > policy.maximumEvents) return fail();
  const draft = await snapshot(ctx, parts, "private_content", "content_id", draftId, draftColumns, "typeof(content)='text' AND length(CAST(content AS BLOB))<=65536");
  if (draft.owner_id !== session.guest_subject || draft.kind !== "experience-draft" || draft.expires_at !== source.expires_at
    || !iso(draft.created_at) || Date.parse(draft.created_at) >= Date.parse(source.expires_at)
    || draft.redacted_at !== null && (!iso(draft.redacted_at) || draft.content !== "")) return fail();
  if (mode === "retained" && draft.redacted_at !== null) return fail();
  let planEvents: unknown[] | null = null, retainedPlan: ExperiencePlan | null = null;
  if (draft.redacted_at === null) {
    if (typeof draft.content !== "string" || bytes(draft.content) !== source.draft_bytes || await checkedDigest(ctx, draft.content) !== source.content_digest) return fail();
    const plan = json(draft.content), { draftHash, ...base } = plan;
    if (plan.version !== 1 || draftHash !== source.draft_hash || await checkedDigest(ctx, base) !== draftHash || canonicalJson(plan) !== draft.content || plan.draftId !== draftId
      || plan.streamId !== `creative:${session.guest_subject}` || plan.projectId !== projectId || plan.documentId !== documentId
      || !record(plan.request) || plan.request.intentId !== sessionId || plan.request.experienceId !== "image" || plan.request.reference !== undefined
      || await checkedDigest(ctx, plan.request) !== source.request_digest || !record(plan.release) || plan.release.releaseHash !== policy.releaseHash
      || !Array.isArray(plan.events) || plan.events.length !== source.event_count) return fail();
    planEvents = plan.events; retainedPlan = plan as unknown as ExperiencePlan;
  }
  current(ctx);
  const rawCommit = await ctx.db.prepare(`SELECT ${commitColumns.join(",")},${objectSql(commitColumns)} AS witness FROM experience_guest_source_commits
    WHERE session_id=? AND length(CAST(event_ids_json AS BLOB))<=4096`).bind(sessionId).first<Row>();
  current(ctx);
  let eventIds: string[] = [];
  if (rawCommit) {
    let parsed: unknown; try { parsed = JSON.parse(String(rawCommit.event_ids_json)); } catch { return fail(); }
    if (rawCommit.draft_hash !== source.draft_hash || rawCommit.head !== source.event_count || !Array.isArray(parsed)
      || parsed.length !== source.event_count || parsed.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/u.test(id))
      || new Set(parsed).size !== parsed.length || JSON.stringify(parsed) !== rawCommit.event_ids_json || typeof rawCommit.witness !== "string") return fail();
    eventIds = parsed;
    parts.push({ sql: `EXISTS(SELECT 1 FROM experience_guest_source_commits WHERE session_id=? AND ${objectSql(commitColumns)}=?)`, bindings: [sessionId, rawCommit.witness] });
  } else return fail();
  const idsJson = JSON.stringify(eventIds), rows = await ctx.db.prepare(`SELECT ${prefixWitness} AS witness
    FROM json_each(?) expected ${prefixJoins} WHERE typeof(e.payload)='text' AND length(CAST(e.payload AS BLOB))<=65536
      AND typeof(body.private_json)='text' AND length(CAST(body.private_json AS BLOB))<=65536 ORDER BY CAST(expected.key AS INTEGER)`)
    .bind(idsJson).all<{ witness: string }>();
  current(ctx);
  if (rows.success !== true || !Array.isArray(rows.results) || rows.results.length !== eventIds.length) return fail();
  let retainedBytes = 0, prefixRetained = true; const blockIds: string[] = [], contextEvents: EventRow[] = [];
  for (const [index, entry] of rows.results.entries()) {
    const event = json(entry.witness), payload = json(event.payload as Value), id = eventIds[index], eventDocument = index === 0 ? null : documentId;
    const expectedType = ["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"][index] ?? "BlockCreated";
    if (event.event_id !== id || event.stream_id !== `creative:${session.guest_subject}` || event.sequence !== index + 1
      || event.actor !== session.guest_subject || event.client_id !== "server:guest-source" || event.correlation_id !== draftId
      || event.schema_version !== 1 || event.type !== expectedType || event.causation_id !== null || event.compensates_event_id !== null
      || event.owner_id !== session.guest_subject || event.project_id !== projectId || event.document_id !== eventDocument
      || event.receipt_key !== receiptPrefix(draftId) + index || payload.client_event_id !== event.receipt_key
      || payload._private_ref !== id || payload.project_id !== projectId || (payload.document_id ?? null) !== eventDocument
      || !iso(event.recorded_at) || !iso(event.occurred_at) || event.created_at !== event.recorded_at
      || event.receipt_created_at !== event.recorded_at || typeof event.private_json !== "string") return fail();
    if (index >= 3) {
      if (!uuid(payload.block_id)) return fail();
      blockIds.push(payload.block_id);
    }
    retainedBytes += bytes(String(event.payload)) + bytes(event.private_json);
    if (planEvents) {
      const expected = planEvents[index];
      if (!record(expected) || expected.type !== event.type || !record(expected.payload)
        || JSON.stringify(publicEventPayload(id, expected.payload, true).payload) !== event.payload) return fail();
      // Payload comes from the still-retained committed plan; every EventRow
      // association and timestamp comes from the observed original prefix.
      contextEvents.push({ eventId: id, streamId: String(event.stream_id), sequence: index + 1,
        occurredAt: event.occurred_at, recordedAt: event.recorded_at, actor: String(event.actor), clientId: String(event.client_id),
        correlationId: String(event.correlation_id), causationId: null, compensatesEventId: null, schemaVersion: 1,
        type: String(event.type), payload: structuredClone(expected.payload) });
    }
    if (event.redacted_at !== null) {
      prefixRetained = false;
      if (mode === "retained") return fail();
      if (!iso(event.redacted_at) || event.private_json !== "") return fail();
    } else {
      const privatePayload = json(event.private_json);
      if (privatePayload.client_event_id !== event.receipt_key || privatePayload.project_id !== projectId || (privatePayload.document_id ?? null) !== eventDocument
        || JSON.stringify(publicEventPayload(id, privatePayload, true).payload) !== event.payload) return fail();
      if (planEvents) {
        const expected = planEvents[index];
        if (!record(expected) || expected.type !== event.type || JSON.stringify(expected.payload) !== event.private_json) return fail();
      }
      // Once native cleanup has already erased the draft, the immutable event
      // receipt and exact native association authorize due erasure of this
      // original envelope. They cannot certify its historical private bytes.
    }
  }
  if (retainedBytes > source.event_bytes || new Set(blockIds).size !== blockIds.length) return fail();
  if (mode === "retained" && retainedBytes !== source.event_bytes) return fail();
  if (!integer(session.revoked_at_ms) && session.revoked_at_ms !== null
    || !integer(sourcePolicy.revoked_at_ms) && sourcePolicy.revoked_at_ms !== null
    || !integer(sessionPolicy.revoked_at_ms) && sessionPolicy.revoked_at_ms !== null
    || Date.parse(source.expires_at) - Date.parse(String(draft.created_at)) > policy.draftLifetimeMs) return fail();
  parts.push({ sql: `(SELECT COUNT(*) FROM json_each(?) expected ${prefixJoins} JOIN json_each(?) snapshots ON snapshots.key=expected.key
    WHERE ${prefixWitness}=snapshots.value)=?`, bindings: [idsJson, `[${rows.results.map(row => row.witness).join(",")}]`, eventIds.length] });
  if (mode === "due") parts.push({ sql: `?<=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, bindings: [source.expires_at] });
  else parts.push({ sql: `?>strftime('%Y-%m-%dT%H:%M:%fZ','now')`, bindings: [source.expires_at] });
  return { source, session, policy, terms, draft, plan: retainedPlan, eventIds, blockIds, contextEvents, parts, draftId, projectId, documentId,
    prefixWitnesses: rows.results.map(row => row.witness), prefixRetained, sessionProof,
    associationParts: parts.filter(part => part !== sessionProof) };
}

export async function historicalSource(ctx: Context, sessionId: string) { return readSource(ctx, sessionId, "due"); }


const approvalColumns = ["approval_id", "campaign_id", "payer_user_id", "terms_digest", "terms_json", "policy_digest", "policy_json",
  "approved_by_user_id", "payer_authority_json", "approval_command_json", "approved_at_ms", "revoked_at_ms"];
export async function historicalApproval(ctx: Context, parts: Proof[], campaignId: string) {
  const text = approvalColumns.slice(0, 10);
  const row = await snapshot(ctx, parts, "experience_sponsor_approvals", "campaign_id", campaignId, approvalColumns,
    text.map(column => `typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=131072 AND instr(${column},char(0))=0`).join(" AND "));
  if (!id(row.approval_id) || !id(row.payer_user_id) || row.payer_user_id.startsWith("guest:")
    || row.approved_by_user_id !== row.payer_user_id || !integer(row.approved_at_ms)
    || row.revoked_at_ms !== null && (!integer(row.revoked_at_ms) || row.revoked_at_ms < row.approved_at_ms)) return fail();
  const command = json(row.approval_command_json, 131072);
  if (!exactKeys(command, ["version", "action", "approvalId", "proposal", "reviewedTermsDigest", "confirmation"])
    || command.version !== 1 || command.action !== "approve-guest-sponsor-campaign" || command.approvalId !== row.approval_id
    || command.confirmation !== "APPROVE_GUEST_SPONSOR_CAMPAIGN" || !guestHash(command.reviewedTermsDigest)
    || canonicalJson(command) !== row.approval_command_json) return fail();
  const compiled = await compileGuestSponsorApprovalProposal(command.proposal); current(ctx);
  if (command.reviewedTermsDigest !== compiled.termsDigest || row.campaign_id !== compiled.policy.campaignId
    || row.payer_user_id !== compiled.policy.payerUserId || row.terms_digest !== compiled.termsDigest || row.terms_json !== compiled.termsJson
    || row.policy_digest !== compiled.policyDigest || row.policy_json !== compiled.policyJson
    || row.approved_at_ms < compiled.policy.startsAtMs || row.approved_at_ms >= compiled.policy.expiresAtMs) return fail();
  let payer: unknown; try { payer = JSON.parse(String(row.payer_authority_json)); } catch { return fail(); }
  // This is the recorded ten-field authority array, not current payer access.
  // Native access JSON can exceed compiler jsonIssues' per-string limit.
  if (!Array.isArray(payer) || payer.length !== 10 || payer[0] !== row.payer_user_id || JSON.stringify(payer) !== row.payer_authority_json) return fail();
  return { row, ...compiled };
}

type Historical = Awaited<ReturnType<typeof historicalSource>>;
export async function saveAssociation(ctx: Context, original: Historical) {
  const { source, session, policy: sourcePolicy, terms, plan, eventIds, draftId, projectId, documentId, parts } = original;
  const associationOffset = parts.length;
  const streamId = `creative:${session.guest_subject}`, identity = (await checkedDigest(ctx, { namespace: "experience-output-command@1", streamId, draftId })).slice(7); current(ctx);
  const commandKey = `experience-output-v1:${identity}:save`, scopeKey = `personal:${session.guest_subject}:${projectId}`;
  const requirementId = await experienceResourceId(draftId, "native-output-requirement"); current(ctx);
  // Native command keys are scoped by actor and project; another actor's
  // valid same-key command must not postpone this source's due cleanup.
  const commandIdentity: Value[] = [scopeKey, session.guest_subject, commandKey];
  const commandRow = await ctx.db.prepare(`SELECT ${objectSql(commandColumns)} AS witness FROM output_commands
    WHERE scope_key=? AND actor_user_id=? AND command_key=? AND typeof(request_digest)='text' AND length(request_digest)=64
      AND length(CAST(event_id AS BLOB))=36 AND length(CAST(created_at AS BLOB))=24`).bind(...commandIdentity).first<{ witness: string }>(); current(ctx);
  if (!commandRow || typeof commandRow.witness !== "string") return fail();
  let command: unknown; try { command = JSON.parse(commandRow.witness); } catch { return fail(); }
  if (!flatRow(command, commandColumns)) return fail();
  parts.push({ sql: `EXISTS(SELECT 1 FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=? AND ${objectSql(commandColumns)}=?)`,
    bindings: [...commandIdentity, commandRow.witness] });
  if (command.scope_key !== scopeKey || command.actor_user_id !== session.guest_subject || command.action !== "save"
    || typeof command.request_digest !== "string" || !/^[a-f0-9]{64}$/u.test(command.request_digest) || !uuid(command.event_id)
    || eventIds.includes(command.event_id) || !iso(command.created_at)) return fail();
  const eventId = command.event_id;
  const observed = await ctx.db.prepare(`SELECT ${eventWitness} AS witness FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id
    WHERE e.event_id=? AND typeof(e.payload)='text' AND length(CAST(e.payload AS BLOB))<=65536
      AND typeof(body.private_json)='text' AND length(CAST(body.private_json AS BLOB))<=65536`).bind(eventId).first<{ witness: string }>(); current(ctx);
  if (!observed || typeof observed.witness !== "string") return fail();
  let tail: unknown; try { tail = JSON.parse(observed.witness); } catch { return fail(); }
  if (!flatRow(tail, [...eventColumns, ...bodyColumns]) || tail.event_id !== eventId || tail.stream_id !== streamId || tail.sequence !== eventIds.length + 1
    || tail.actor !== session.guest_subject || tail.client_id !== "server:guest-output" || tail.correlation_id !== commandKey
    || tail.causation_id !== null || tail.compensates_event_id !== null || tail.schema_version !== 1 || tail.type !== "BlockCreated"
    || tail.recorded_at !== command.created_at || tail.occurred_at !== tail.recorded_at || tail.created_at !== tail.recorded_at
    || tail.owner_id !== session.guest_subject || tail.project_id !== projectId || tail.document_id !== documentId
    || typeof tail.private_json !== "string" || tail.redacted_at !== null && (!iso(tail.redacted_at) || tail.private_json !== "")) return fail();
  const publicPayload = { block_id: requirementId, type: "output", scope: "document", project_id: projectId, document_id: documentId,
    actor_user_id: session.guest_subject, _private_ref: eventId };
  if (JSON.stringify(publicPayload) !== tail.payload) return fail();
  const resource = await snapshot(ctx, parts, "experience_sponsor_resource_receipts", "resource_id", `${commandKey}:text`, resourceColumns,
    "length(CAST(campaign_id AS BLOB))<=200 AND length(CAST(policy_digest AS BLOB))=71 AND length(CAST(limits_digest AS BLOB))=71 AND length(CAST(session_digest AS BLOB))=71 AND length(CAST(payload_digest AS BLOB))=71");
  if (!id(resource.campaign_id)) return fail();
  const approval = await historicalApproval(ctx, parts, resource.campaign_id); current(ctx);
  const { policy } = approval, admission = policy.guestAdmission;
  if (admission.origin !== terms.origin || admission.sessionPolicyId !== session.policy_id || admission.sessionTermsDigest !== session.terms_digest
    || admission.sourcePolicyId !== source.policy_id || admission.sourcePolicyDigest !== source.policy_digest || admission.releaseHash !== sourcePolicy.releaseHash
    || policy.payerUserId === session.guest_subject) return fail();
  const sessionBinding = await compileGuestSponsorSessionBinding({ domain: "forma-sponsor-guest-session@1", sessionId: session.session_id,
    guestSubject: session.guest_subject, projectId, documentId, sessionPolicyId: session.policy_id,
    sessionTermsDigest: session.terms_digest, expiresAtMs: session.expires_at_ms }); current(ctx);
  const sourceBinding = await compileGuestSponsorSourceBinding({ domain: "forma-sponsor-guest-source@1", sessionDigest: sessionBinding.sessionDigest,
    sourcePolicyId: source.policy_id, sourcePolicyDigest: source.policy_digest, draftId, draftHash: source.draft_hash,
    requestDigest: source.request_digest, contentDigest: source.content_digest, releaseHash: sourcePolicy.releaseHash,
    sourceHead: eventIds.length, sourceEventIds: eventIds, expiresAtMs: Date.parse(String(source.expires_at)) }); current(ctx);
  const driver = await deriveGuestSponsorDriver({ version: 1, action: "run-guest-sponsored-image", campaignId: policy.campaignId,
    sessionId: session.session_id, documentId, draftId, draftHash: source.draft_hash, guestSourceDigest: sourceBinding.guestSourceDigest }); current(ctx);
  const limitsDigest = await checkedDigest(ctx, policy.resources); current(ctx);
  const minimum = Math.max(policy.startsAtMs, policy.resources.startsAtMs, Number(session.created_at_ms), Number(approval.row.approved_at_ms));
  const maximum = Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, Number(session.expires_at_ms), terms.expiresAtMs, Date.parse(String(source.expires_at)));
  if (resource.policy_digest !== approval.policyDigest || resource.limits_digest !== limitsDigest || resource.actor_user_id !== session.guest_subject
    || resource.session_digest !== sessionBinding.sessionDigest || resource.operation !== "text-intake" || resource.intent_key !== commandKey
    || resource.payload_digest !== `sha256:${command.request_digest}` || resource.issued_grant_id !== null
    || !integer(resource.text_bytes, 0, policy.resources.maximumOperationTextBytes) || !integer(resource.recorded_at_ms, minimum, maximum - 1)
    || Date.parse(command.created_at) < minimum || Date.parse(command.created_at) >= maximum) return fail();
  const template = policy.templates[0], ratio = EXPERIENCE_IMAGE_RATIOS.find(value => value.dimensions.width === template.width && value.dimensions.height === template.height);
  if (!ratio) return fail();
  const deliverableId = await experienceResourceId(draftId, "native-output-deliverable"); current(ctx);
  const variantId = await experienceResourceId(draftId, "native-output-variant"); current(ctx);
  const recipe = createExperienceOutputRecipe({ output: "image", requirementId, deliverableId, variantId, aspectRatio: { width: ratio.width, height: ratio.height } });
  if (inspectOutputRequirement(recipe.spec).status === "invalid") return fail();
  const planSuggestions = normalizePlanSuggestions(recipe.spec, undefined, false);
  const preparation = { protocol: "guest-image-source@1", campaignId: policy.campaignId, approvalId: approval.row.approval_id,
    termsDigest: approval.termsDigest, policyDigest: approval.policyDigest, session: sessionBinding.binding, source: sourceBinding.binding, driver: driver.command };
  let expectedEnvelope: Record<string, unknown> | null = null, binding: Awaited<ReturnType<typeof experienceOutputBinding>> | null = null;
  let expectedPayload: Record<string, unknown> | null = null;
  if (plan) {
    const choice = plan.request.values?.ratio, format = choice?.provenance === "authored" ? experienceImageFormat(choice.value) : null;
    if (!format || format.dimensions.width !== template.width || format.dimensions.height !== template.height
      || template.recipeVersion !== `image@${plan.release.definition?.revision}`) return fail();
    binding = await experienceOutputBinding(plan); current(ctx);
    expectedEnvelope = await experienceOutputEnvelope(binding, "save", eventIds.length, { blockId: requirementId, spec: recipe.spec, planSuggestions, guestSponsorPreparation: preparation }); current(ctx);
    if (await checkedDigest(ctx, expectedEnvelope) !== resource.payload_digest) return fail(); current(ctx);
    expectedPayload = { block_id: requirementId, type: "output", scope: "document", position: `z-output-${requirementId}`, handle: `output/${requirementId}`,
      properties: { text: recipe.spec.original_text, subtype: recipe.spec.label, output_spec: recipe.spec, output_plan_suggestions: planSuggestions, authority: "authored" },
      output_command_envelope: expectedEnvelope, project_id: projectId, document_id: documentId, actor_user_id: session.guest_subject };
    // The retained, committed plan still provides the original private bytes,
    // even when a prior native cleanup erased a subset of event bodies.
    const context = authoritativeCreativeContext(original.contextEvents, { documentId, projectId });
    if (resource.text_bytes !== bytes(canonicalJson(context.snapshot))) return fail();
  }
  if (tail.redacted_at === null) {
    const payload = json(tail.private_json), envelope = payload.output_command_envelope;
    if (!record(envelope) || !exactKeys(envelope, ["blockId", "spec", "planSuggestions", "guestSponsorPreparation", "action", "documentId", "expectedRevision", "clientMutationId", "experienceBinding"])
      || !record(envelope.experienceBinding)) return fail();
    const binding = envelope.experienceBinding;
    if (!exactKeys(binding, ["version", "draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash", "output", "projectId", "documentId", "streamId"])
      || binding.version !== 1 || binding.draftId !== draftId || binding.draftHash !== source.draft_hash || binding.releaseHash !== sourcePolicy.releaseHash
      || binding.requestHash !== source.request_digest || !guestHash(binding.sourceBindingHash) || binding.output !== "image"
      || binding.projectId !== projectId || binding.documentId !== documentId || binding.streamId !== streamId) return fail();
    const expected = expectedEnvelope ?? { blockId: requirementId, spec: recipe.spec, planSuggestions, guestSponsorPreparation: preparation,
      action: "save", documentId, expectedRevision: `output:${eventIds.length}`, clientMutationId: commandKey, experienceBinding: binding };
    if (canonicalJson(envelope) !== canonicalJson(expected) || await checkedDigest(ctx, envelope) !== resource.payload_digest) return fail(); current(ctx);
    const expectedPayload = { block_id: requirementId, type: "output", scope: "document", position: `z-output-${requirementId}`, handle: `output/${requirementId}`,
      properties: { text: recipe.spec.original_text, subtype: recipe.spec.label, output_spec: recipe.spec, output_plan_suggestions: planSuggestions, authority: "authored" },
      output_command_envelope: envelope, project_id: projectId, document_id: documentId, actor_user_id: session.guest_subject };
    if (JSON.stringify(expectedPayload) !== tail.private_json || JSON.stringify(publicEventPayload(eventId, payload, true).payload) !== tail.payload) return fail();
    // Without the original private plan, sourceBindingHash and text_bytes are
    // pinned historical commitments; the erased text is not reconstructed.
  }
  original.associationParts.push(...parts.slice(associationOffset));
  return { tail, observed: observed.witness, eventId, requirementId, commandKey, scopeKey, resource,
    sessionDigest: sessionBinding.sessionDigest, driverId: driver.driverId, command, approval, sessionBinding, sourceBinding, driver,
    limitsDigest, minimum, maximum, recipe, planSuggestions, preparation, binding, expectedEnvelope, expectedPayload };
}

/** Internal historical facts only. The consumer must provide and execute its
 * own complete graph closure; these collections confer no custody or erasure
 * capability and cannot be passed to an existing opaque inventory accessor. */
export async function collectRetainedGuestImageHistory(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof }) {
  if (!(request instanceof Request) || jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof"])) return fail();
  const ctx: Context = { request, env, db: env.DB, url: request.url, headers: JSON.stringify(Array.from(request.headers)),
    origin: new URL(request.url).origin, signal: request.signal };
  if (bytes(ctx.headers) > 32768) return fail();
  current(ctx);
  const liveSource = await readGuestImageSourceForCustody(request, env, structuredClone(input.proof)); current(ctx);
  if (liveSource.session.policy.terms.origin !== ctx.origin) return fail();
  const original = await readSource(ctx, liveSource.session.row.session_id, "retained"); current(ctx);
  if (!original.plan || canonicalJson(original.plan) !== canonicalJson(liveSource.saved.plan) || original.draft.content !== liveSource.saved.row.content
    || JSON.stringify(original.eventIds) !== JSON.stringify(liveSource.commit.eventIds)
    || sessionColumns.some(key => original.session[key] !== (liveSource.session.row as unknown as Row)[key])) return fail();
  const sponsor = await laterStageSponsorSchema(ctx); current(ctx);
  const saved = await saveAssociation(ctx, original); current(ctx);
  if (saved.tail.redacted_at !== null) return fail();
  const memory = await memoryProof(ctx, original.draftId); current(ctx);
  const currentPolicyProof: Proof = { sql: liveSource.session.policy.guard.sql, bindings: [...liveSource.session.policy.guard.bindings] };
  const currentSessionProof: Proof = { sql: liveSource.session.guard.sql, bindings: [...liveSource.session.guard.bindings] };
  const currentGuards: Proof[] = [currentPolicyProof, currentSessionProof];
  return { mode: "retained" as const, ctx, original, saved, sponsor, memory, liveSource, currentGuards, currentPolicyProof, currentSessionProof };
}

export async function collectDueGuestImageHistory(env: WorkerEnv, input: { sessionId: string }) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId"]) || !guestId(input.sessionId)) return fail();
  const ctx: Context = { env, db: env.DB };
  const original = await historicalSource(ctx, input.sessionId); current(ctx);
  const sponsor = await laterStageSponsorSchema(ctx); current(ctx);
  const saved = await saveAssociation(ctx, original); current(ctx);
  const memory = await memoryProof(ctx, original.draftId); current(ctx);
  return { mode: "due" as const, ctx, original, saved, sponsor, memory, currentGuards: [] as Proof[], currentPolicyProof: null, currentSessionProof: null };
}

/** A structural predicate only: the consumer must join the exact immutable
 * completion mapping and native completion time. No credential or custody
 * authority is produced by replacing this one observed session field. */
export function guestImageHistorySessionProof(original: Pick<Awaited<ReturnType<typeof historicalSource>>, "session">,
  input: { revokedAtMs: number }): Proof {
  if (!record(input) || !exactKeys(input, ["revokedAtMs"]) || !integer(input.revokedAtMs)
    || original.session.revoked_at_ms !== null && original.session.revoked_at_ms !== input.revokedAtMs) return fail();
  const expected = { ...original.session, revoked_at_ms: input.revokedAtMs };
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_sessions WHERE session_id=? AND ${objectSql(sessionColumns)}=?)`,
    bindings: [original.session.session_id, JSON.stringify(expected)] };
}
