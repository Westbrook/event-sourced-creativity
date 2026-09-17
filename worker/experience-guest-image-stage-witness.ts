import { providerInputInstructions } from "./output-image-slides-preflight.ts";
import { foldEvents } from "../src/model/events.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import type { OutputConfirmedPlan, OutputPreflight, OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import { outputRequirementInterpretationNeedsReview } from "../src/model/output-requirements.ts";
import { outputTargetContractDigest } from "./output-requirements-api.ts";
import { outputDigest } from "./output-disclosure-proof.ts";
import { sponsorImageTextSource } from "./experience-sponsor-image-format.ts";
import { matchSponsorImageTemplate } from "./experience-sponsor-campaign.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";
/** The original prefix/schema readers below are mechanically compared with the
 * accepted a2745c first-SAVE witness. Its strict N+1 API is unchanged. This file
 * owns a separate finite four-state closure; it never edits an existing proof. */
import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceResourceId } from "../src/experiences/intake.ts";
import { experienceImageFormat } from "../src/experiences/image-ratio.ts";
import { inspectOutputRequirement } from "../src/model/output-requirements.ts";
import { authoritativeCreativeContext } from "./context-authority.ts";
import { publicEventPayload } from "./event-privacy.ts";
import type { EventRow } from "./event-write-primitives.ts";
import { readGuestImageSourceForCustody } from "./experience-guest-source.ts";
import { GUEST_DB_NOW, guestFail, guestHash, type GuestClaimProof } from "./experience-guest-session.ts";
import { guestApprovedCampaignData, type GuestApprovedCampaignWitness } from "./experience-guest-sponsor-approval.ts";
import { compileGuestSponsorSessionBinding, compileGuestSponsorSourceBinding, deriveGuestSponsorDriver } from "./experience-guest-sponsor-contract.ts";
import { experienceOutputBinding, experienceOutputEnvelope } from "./experience-output-binding.ts";
import { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget } from "./experience-output-recipe.ts";
import { SPONSOR_ENTITLEMENT_SCHEMA } from "./experience-sponsor-entitlement.ts";
import { SPONSOR_RESOURCE_SCHEMA, type SponsorResourceInput } from "./experience-sponsor-resources.ts";
import { SPONSOR_APPROVAL_SCHEMA } from "./experience-sponsor-approval.ts";
import { SPONSOR_ISSUER_SCHEMA } from "./experience-sponsor-issuer.ts";
import { SPONSOR_DRIVER_SCHEMA } from "./experience-sponsor-driver.ts";
import { SPONSOR_INTAKE_SCHEMA } from "./experience-sponsor-intake.ts";
import { SPONSOR_READ_POLICY_SCHEMA } from "./experience-sponsor-read-policy.ts";
import { SPONSOR_READ_APPROVAL_SCHEMA } from "./experience-sponsor-read-approval.ts";
import { SPONSOR_READ_ATTEMPT_SCHEMA } from "./experience-sponsor-read-attempts.ts";
import { SPONSOR_INTAKE_READ_POLICY_SCHEMA } from "./experience-sponsor-intake-read-policy.ts";
import { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA } from "./experience-sponsor-intake-read-approval.ts";
import { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA } from "./experience-sponsor-intake-read-attempts.ts";
import { SPONSOR_NATIVE_IMAGE_READ_INDEXES } from "./experience-sponsor-native-image-read.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { normalizePlanSuggestions, outputRequirements, outputSourceDigests } from "./output-trusted-context.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

type Value = string | number | null;
type Proof = { sql: string; bindings: Value[] };
type Source = Awaited<ReturnType<typeof readGuestImageSourceForCustody>>;
type Approved = ReturnType<typeof guestApprovedCampaignData>;
type Binding = Awaited<ReturnType<typeof experienceOutputBinding>>;
type Driver = Awaited<ReturnType<typeof deriveGuestSponsorDriver>>;
type NativeContext = ReturnType<typeof authoritativeCreativeContext>;
export type StageData = Readonly<{
  state: "saved" | "confirmed" | "claimed" | "quoted"; base: GuestImageOutputData; context: NativeContext;
  sourceDigest: string; requirementsDigest: string; review: Readonly<Record<string, unknown>>; reviewedRequirementDigest: string;
  confirmationOptions: OutputConfirmedPlan["confirmationOptions"]; compiledPlan: OutputConfirmedPlan["plan"];
  target: OutputConfirmedPlan["plan"]["targets"][number]; contractDigest: string;
  confirmEnvelope: Record<string, unknown>; confirmDigest: string; confirmKey: string;
  confirmed: OutputConfirmedPlan | null; confirmEvent: EventRow | null; driver: Driver;
  confirmResource: SponsorResourceInput; preflightResource: SponsorResourceInput;
  preflightEnvelope: Record<string, unknown> | null; preflightDigest: string | null;
  quote: OutputPreflight | null; quoteEvent: EventRow | null; transport: unknown;
  expiresAtMs: number; nowMs: number; assertion: OutputSqlAssertion;
}>;
declare const stageWitnessBrand: unique symbol;
export type GuestImageStageWitness = Readonly<{ [stageWitnessBrand]: true }>;
const stageWitnesses = new WeakMap<GuestImageStageWitness, Captured>();
export type GuestImageOutputInput = Readonly<{ proof: GuestClaimProof; campaignId: string; policyDigest: string; draftHash: string }>;
type Saved = Readonly<{ event: EventRow; eventId: string; createdAt: string; revision: number; requirementId: string;
  commandKey: string; requestDigest: string }>;
type GuestImageOutputData = Readonly<{
  state: "saved"; plan: Source["saved"]["plan"]; session: Source["session"]; policy: Approved["policy"];
  sourceHead: number; sourceEventIds: readonly string[]; scopeKey: string; requirementId: string;
  binding: Binding; envelope: Readonly<Record<string, unknown>>; payload: Readonly<Record<string, unknown>>;
  commandKey: string; requestDigest: string; resourceInput: SponsorResourceInput;
  beforeProof: OutputSqlAssertion | null; assertion: OutputSqlAssertion; saved: Saved | null;
}>;
type Context = { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; headers: string; url: string; origin: string;
  approvedWitness: GuestApprovedCampaignWitness; approved: Approved };
type Captured = { stage: StageData | null; stageProofs: Proof[]; stageEvents: EventRow[]; resourceIds: string[]; ctx: Context; data: GuestImageOutputData; prefix: Proof[]; memory: { proof: Proof; registries: string[] };
  sponsor: { proof: Proof; tables: Set<string> }; source: Source; minimumWriteMs: number; expiresAtMs: number;
  limitsDigest: string; resourceTimestamp: number | null; driverId: string };

const fail = (part = "unavailable"): never => guestFail(`image_output_${part}`);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const objectSql = (columns: readonly string[], alias = "") => {
  const first = columns.slice(0, 15), rest = columns.slice(15);
  const base = `json_object(${first.flatMap(column => [`'${column}'`, `${alias}${column}`]).join(",")})`;
  return rest.length ? `json_set(${base},${rest.flatMap(column => [`'$.${column}'`, `${alias}${column}`]).join(",")})` : base;
};
const flatRow = (value: unknown, columns: readonly string[]): value is Record<string, Value> => record(value) && exactKeys(value, columns)
  && Object.values(value).every(item => item === null || typeof item === "string" || typeof item === "number" && Number.isFinite(item));
function proof(value: OutputSqlAssertion): Proof { return { sql: value.sql, bindings: [...(value.bindings ?? [])] }; }
function together(parts: readonly Proof[]): Proof {
  // Sibling relations keep native principal/source predicates out of a deep
  // boolean tree when the caller wraps this proof in an atomic CHECK.
  return { sql: `EXISTS(WITH ${parts.map((part, i) => `guest_output_proof_${i} AS MATERIALIZED(SELECT 1 WHERE ${part.sql})`).join(",")}
    SELECT 1 FROM ${parts.map((_, i) => `guest_output_proof_${i}`).join(",")})`, bindings: parts.flatMap(part => part.bindings) };
}
function current(ctx: Context) {
  if (ctx.env.DB !== ctx.db) return guestFail("database_changed");
  const { request } = ctx, url = new URL(request.url), site = request.headers.get("sec-fetch-site");
  if (request.signal.aborted || request.method !== "POST" || request.url !== ctx.url || JSON.stringify(Array.from(request.headers)) !== ctx.headers
    || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.origin !== ctx.origin
    || request.headers.get("origin") !== ctx.origin || site !== null && site !== "same-origin" && site !== "none") return fail();
  // Object identity is not freshness, but it prevents cross-request/env reuse.
  guestApprovedCampaignData(request, ctx.env, ctx.approvedWitness);
}
async function prove(ctx: Context, assertion: Proof) {
  current(ctx); let row;
  try { row = await ctx.db.prepare(`SELECT 1 AS current WHERE ${assertion.sql}`).bind(...assertion.bindings).first<{ current: number }>(); }
  catch { current(ctx); return fail(); }
  current(ctx); if (row?.current !== 1) return fail();
}

const sourceColumns = ["session_id", "policy_id", "policy_digest", "draft_id", "draft_hash", "request_digest", "content_digest", "draft_bytes", "event_bytes", "event_count", "expires_at"];
const sessionColumns = ["session_id", "policy_id", "terms_digest", "guest_subject", "project_id", "document_id", "session_hash", "claim_hash", "created_at_ms", "expires_at_ms"];
const policyColumns = ["policy_id", "policy_digest", "policy_json", "review_digest"];
const draftColumns = ["content_id", "owner_id", "kind", "content", "created_at", "expires_at", "redacted_at"];
const commitColumns = ["session_id", "draft_hash", "head", "event_ids_json"];
const eventColumns = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"];
const bodyColumns = ["owner_id", "project_id", "document_id", "private_json", "created_at", "redacted_at"];
const eventWitness = `json_set(${objectSql(eventColumns, "e.")},${bodyColumns.flatMap(key => [`'$.${key}'`, `body.${key}`]).join(",")})`;
const prefixWitness = `json_set(${eventWitness},'$.receipt_key',receipt.client_event_id,'$.receipt_created_at',receipt.created_at)`;
const prefixJoins = `JOIN events e ON e.event_id=expected.value JOIN event_private_payloads body ON body.private_event_id=e.event_id
  JOIN event_client_receipts receipt ON receipt.event_id=e.event_id AND receipt.stream_id=e.stream_id AND receipt.sequence=e.sequence`;
const commandColumns = ["scope_key", "actor_user_id", "command_key", "request_digest", "action", "event_id", "created_at"];
const resourceColumns = ["resource_id", "campaign_id", "policy_digest", "limits_digest", "actor_user_id", "session_digest", "operation", "intent_key", "payload_digest", "text_bytes", "issued_grant_id"];

/** Capture the immutable original rows directly. This deliberately does not
 * edit/strip the empty-output inventory SQL to manufacture an allowed tail. */
async function originalPrefix(ctx: Context, source: Source) {
  const { session, saved, commit } = source, { plan } = saved, ids = [...commit.eventIds], idsJson = JSON.stringify(ids);
  if (ids.length < 3 || ids.length > 16 || new Set(ids).size !== ids.length || commit.head !== ids.length || plan.events.length !== ids.length
    || plan.events.some((event, index) => event.type !== (["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"][index] ?? "BlockCreated"))) return fail();
  const parts: Proof[] = [proof(session.guard)];
  async function snapshot(table: string, key: string, value: Value, columns: string[], bound = "1") {
    const observed = await ctx.db.prepare(`SELECT ${objectSql(columns)} AS witness FROM ${table} WHERE ${key}=? AND (${bound})`)
      .bind(value).first<{ witness: string }>(); current(ctx);
    if (!observed || typeof observed.witness !== "string") return fail();
    let row: unknown; try { row = JSON.parse(observed.witness); } catch { return fail(); }
    if (!flatRow(row, columns)) return fail();
    parts.push({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${key}=? AND ${objectSql(columns)}=?)`, bindings: [value, observed.witness] });
    return row;
  }
  const sourceRow = await snapshot("experience_guest_sources", "session_id", session.row.session_id, sourceColumns); current(ctx);
  if (sourceColumns.some(key => sourceRow[key] !== (saved.row as unknown as Record<string, unknown>)[key])) return fail();
  const sessionRow = await snapshot("experience_guest_sessions", "session_id", session.row.session_id, sessionColumns); current(ctx);
  if (sessionColumns.some(key => sessionRow[key] !== (session.row as unknown as Record<string, unknown>)[key])) return fail();
  const policy = await snapshot("experience_guest_source_policies", "policy_id", saved.row.policy_id, policyColumns, "length(CAST(policy_json AS BLOB))<=4096"); current(ctx);
  if (policyColumns.some(key => policy[key] !== (saved.policy.row as unknown as Record<string, unknown>)[key])) return fail();
  const draft = await snapshot("private_content", "content_id", plan.draftId, draftColumns, "typeof(content)='text' AND length(CAST(content AS BLOB))<=65536"); current(ctx);
  if (draft.owner_id !== session.row.guest_subject || draft.kind !== "experience-draft" || draft.content !== saved.row.content || draft.redacted_at !== null
    || draft.expires_at !== saved.row.expires_at || !iso(draft.created_at) || !iso(draft.expires_at) || draft.created_at >= draft.expires_at) return fail();
  const originalCommit = await snapshot("experience_guest_source_commits", "session_id", session.row.session_id, commitColumns, "length(CAST(event_ids_json AS BLOB))<=4096"); current(ctx);
  if (originalCommit.draft_hash !== plan.draftHash || originalCommit.head !== ids.length || originalCommit.event_ids_json !== idsJson) return fail();
  const rows = await ctx.db.prepare(`SELECT ${prefixWitness} AS witness FROM json_each(?) expected ${prefixJoins}
    WHERE typeof(e.payload)='text' AND length(CAST(e.payload AS BLOB))<=65536 AND typeof(body.private_json)='text'
      AND length(CAST(body.private_json AS BLOB))<=65536 ORDER BY CAST(expected.key AS INTEGER)`).bind(idsJson).all<{ witness: string }>(); current(ctx);
  if (rows.success !== true || !Array.isArray(rows.results) || rows.results.length !== ids.length) return fail();
  let eventBytes = 0;
  const events: EventRow[] = [];
  for (const [index, entry] of rows.results.entries()) {
    let row: unknown; try { row = JSON.parse(entry.witness); } catch { return fail(); }
    const expected = plan.events[index];
    if (!flatRow(row, [...eventColumns, ...bodyColumns, "receipt_key", "receipt_created_at"])
      || row.event_id !== ids[index] || row.stream_id !== plan.streamId || row.sequence !== index + 1 || row.actor !== session.row.guest_subject
      || row.client_id !== "server:guest-source" || row.correlation_id !== plan.draftId || row.schema_version !== 1 || row.causation_id !== null
      || row.compensates_event_id !== null || row.type !== expected.type || row.owner_id !== session.row.guest_subject
      || row.project_id !== expected.payload.project_id || row.document_id !== (expected.payload.document_id ?? null)
      || row.private_json !== JSON.stringify(expected.payload) || row.payload !== JSON.stringify(publicEventPayload(ids[index], expected.payload, true).payload)
      || row.redacted_at !== null || row.receipt_key !== expected.payload.client_event_id || !iso(row.occurred_at) || !iso(row.recorded_at)
      || row.created_at !== row.recorded_at || row.receipt_created_at !== row.recorded_at) return fail();
    eventBytes += bytes(String(row.payload)) + bytes(String(row.private_json));
    events.push({ eventId: ids[index], streamId: plan.streamId, sequence: index + 1, occurredAt: row.occurred_at, recordedAt: row.recorded_at,
      actor: session.row.guest_subject, clientId: "server:guest-source", correlationId: plan.draftId, causationId: null,
      compensatesEventId: null, schemaVersion: 1, type: expected.type, payload: structuredClone(expected.payload) });
  }
  if (eventBytes !== saved.row.event_bytes) return fail();
  parts.push({ sql: `(SELECT COUNT(*) FROM json_each(?) expected ${prefixJoins} JOIN json_each(?) snapshots ON snapshots.key=expected.key
    WHERE ${prefixWitness}=snapshots.value)=?`, bindings: [idsJson, `[${rows.results.map(row => row.witness).join(",")}]`, ids.length] });
  return { parts, events };
}

const registries = ["memory_native_answer_origins", "memory_structured_answer_origins", "memory_document_job_answer_origins"] as const;
const registrySchemaSql = `(SELECT json_group_array(json_object('type',type,'name',name,'sql',definition)) FROM
  (SELECT type,name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS definition FROM sqlite_schema
    WHERE type IN('table','view') AND name IN(${registries.map(name => `'${name}'`).join(",")}) ORDER BY name LIMIT 4))`;
async function memoryProof(ctx: Context, draftId: string) {
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

const sponsorFamilies = [
  { required: true, sql: SPONSOR_ENTITLEMENT_SCHEMA }, { required: true, sql: SPONSOR_RESOURCE_SCHEMA }, { required: true, sql: SPONSOR_APPROVAL_SCHEMA },
  { required: false, sql: SPONSOR_ISSUER_SCHEMA }, { required: true, sql: SPONSOR_DRIVER_SCHEMA }, { required: false, sql: SPONSOR_INTAKE_SCHEMA },
  { required: false, sql: SPONSOR_READ_POLICY_SCHEMA }, { required: false, sql: SPONSOR_READ_APPROVAL_SCHEMA }, { required: false, sql: SPONSOR_READ_ATTEMPT_SCHEMA },
  { required: false, sql: SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { required: false, sql: SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { required: false, sql: SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA },
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
const sponsorNames = sponsorFamilies.flatMap(family => family.sql.map(sql => schemaItem(sql).name));
const sponsorTables = sponsorFamilies.flatMap(family => family.sql.map(schemaItem)).filter(item => item.type === "table").map(item => item.name);
const sponsorSchemaSql = `(SELECT json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',sql)) FROM
  (SELECT type,name,tbl_name,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql ELSE NULL END AS sql FROM sqlite_schema
    WHERE name IN(${sponsorNames.map(name => `'${name}'`).join(",")}) OR tbl_name IN(${sponsorTables.map(name => `'${name}'`).join(",")}) ORDER BY name,type))`;
async function sponsorSchema(ctx: Context) {
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
  for (const family of sponsorFamilies) {
    const expected = family.sql.map(schemaItem), present = expected.filter(item => entries.has(item.name));
    if (!family.required && !present.length) continue;
    if (present.length !== expected.length || expected.some(item => {
      const actual = entries.get(item.name); return !actual || actual.type !== item.type || normalizedDdl(String(actual.sql)) !== item.sql;
    })) return fail("schema_unavailable");
    expected.filter(item => item.type === "table").forEach(item => tables.add(item.name));
  }
  return { proof: { sql: `${sponsorSchemaSql}=?`, bindings: [row.snapshot] } as Proof, tables };
}

const nativeBranches = [
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
function unsupportedIdentityJson(column: string, selectors: readonly string[] = ["documentId"]) {
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
function boundedIdentityValue(column: string, key: string) {
  // Do not rely on AND/OR predicate evaluation order to guard JSON parsing.
  return `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=65536
    THEN CASE WHEN json_valid(${column}) THEN json_extract(${column},'$.${key}') END END`;
}
function closure(captured: Captured, tail: string | null, includeNative: boolean): Proof {
  const { data, source, sponsor } = captured, { plan, session } = data;
  const rows: string[][] = includeNative ? nativeBranches.map(row => [...row]) : [];
  // Only exact rows independently validated below may enter this four-state footprint.
  const allowed = new Map<string, string>([
    ["output_commands", "d.scope_key=s.scope AND d.actor_user_id=s.guest AND d.command_key IN(SELECT value FROM json_each(s.commands))"],
    ["output_plan_revisions", "s.plan IS NOT NULL AND d.scope_key=s.scope AND d.plan_revision_id=s.plan"],
    ["output_plan_targets", "s.plan IS NOT NULL AND d.scope_key=s.scope AND d.plan_revision_id=s.plan AND d.target_id=s.target"],
    ["output_preflights", "s.quote IS NOT NULL AND d.scope_key=s.scope AND d.preflight_id=s.quote"],
  ]);
  for (const row of rows) if (allowed.has(row[0])) row[1] = `(${row[1]}) AND NOT(${allowed.get(row[0])})`;
  const add = (table: string, predicate: string) => { if (sponsor.tables.has(table)) rows.push([table, predicate]); };
  add("experience_sponsor_resource_receipts", "(d.actor_user_id=s.guest OR d.session_digest=s.session) AND d.resource_id NOT IN(SELECT value FROM json_each(s.resources))");
  for (const table of ["experience_sponsor_grants", "experience_sponsor_consumptions"]) add(table, "d.actor_user_id=s.guest OR d.session_digest=s.session");
  add("experience_sponsor_active_jobs", "d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_consumptions used WHERE used.consumption_id=d.consumption_id AND (used.actor_user_id=s.guest OR used.session_digest=s.session))");
  // Unsupported retained identity JSON cannot be silently classified as an
  // unrelated actor's work. This bounded inspector refuses that inventory;
  // it does not repair, delete or reinterpret another actor's receipt.
  add("experience_sponsor_issuances", `${unsupportedIdentityJson("d.driver_command_json")} OR ${unsupportedIdentityJson("d.envelope_json", ["documentId", "projectId", "ownerUserId", "actorUserId", "payerUserId", "sessionDigest"])}
    OR d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_grants issued WHERE issued.grant_id=d.grant_id AND (issued.actor_user_id=s.guest OR issued.session_digest=s.session))
    OR ${boundedIdentityValue("d.driver_command_json", "documentId")}=s.document
    OR ${boundedIdentityValue("d.envelope_json", "documentId")}=s.document
    OR ${boundedIdentityValue("d.envelope_json", "projectId")}=s.project
    OR ${boundedIdentityValue("d.envelope_json", "ownerUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "actorUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "payerUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "sessionDigest")}=s.session`);
  add("experience_sponsor_driver_intents", `(${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver
    OR d.actor_user_id=s.guest OR d.session_digest=s.session OR d.document_id=s.document
    OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document) AND NOT(s.plan IS NOT NULL AND d.driver_id=s.driver)`);
  add("experience_sponsor_driver_stages", `(${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver
    OR EXISTS(SELECT 1 FROM experience_sponsor_driver_intents intent WHERE intent.driver_id=d.driver_id AND (intent.actor_user_id=s.guest OR intent.session_digest=s.session OR intent.document_id=s.document))
    OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document) AND NOT(s.claimed=1 AND d.driver_id=s.driver AND d.stage='preflight')`);
  add("experience_sponsor_intakes", "d.actor_user_id=s.guest OR d.session_digest=s.session OR d.draft_id=s.draft OR d.project_id=s.project OR d.document_id=s.document");
  add("experience_sponsor_read_attempts", "d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=d.job_id AND (job.owner_id=s.guest OR job.stream_id=s.stream OR job.document_id=s.document))");
  add("experience_sponsor_intake_read_attempts", "d.actor_user_id=s.guest OR d.resource_key='draft:'||s.draft");
  if (includeNative) for (const registry of captured.memory.registries) rows.push([registry, "d.user_event_id IN(SELECT value FROM json_each(s.ids)) OR d.answer_event_id IN(SELECT value FROM json_each(s.ids))"]);
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  const names = ["guest", "stream", "project", "document", "draft", "ids", "prefix", "scope", "tail", "command", "resource", "session", "driver", "commands", "resources", "plan", "target", "quote", "claimed"];
  return { sql: `NOT EXISTS(WITH guest_output_closure_input AS(SELECT ? AS value),guest_output_closure_scope AS(
    SELECT ${names.map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM guest_output_closure_input),
    ${groups.map((group, i) => `guest_output_closure_${i} AS MATERIALIZED(${group.map(([table, predicate]) => `SELECT 1 FROM ${table} d,guest_output_closure_scope s WHERE ${predicate}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, i) => `EXISTS(SELECT 1 FROM guest_output_closure_${i})`).join(" OR ")})`, bindings: [JSON.stringify({
    guest: session.row.guest_subject, stream: plan.streamId, project: plan.projectId, document: plan.documentId, draft: plan.draftId,
    ids: JSON.stringify([...source.commit.eventIds, ...(tail ? [tail] : []), ...captured.stageEvents.map(event => event.eventId)]), prefix: JSON.stringify(source.commit.eventIds),
    scope: data.scopeKey, tail, command: data.commandKey, resource: data.resourceInput.resourceId, session: data.resourceInput.sessionDigest, driver: captured.driverId,
    commands: JSON.stringify([data.commandKey, ...captured.stageEvents.map(event => event.correlationId)]), resources: JSON.stringify(captured.resourceIds),
    plan: captured.stage?.confirmed?.revisionId ?? null, target: captured.stage?.target.id ?? null,
    quote: captured.stage?.quote?.id ?? null, claimed: captured.stage?.state === "claimed" || captured.stage?.state === "quoted" ? 1 : 0 })] };
}

function freshSource(captured: Captured): Proof {
  const { source, minimumWriteMs, expiresAtMs, ctx } = captured, { policy } = ctx.approved;
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_source_policies WHERE policy_id=? AND policy_digest=? AND revoked_at_ms IS NULL)
    AND NOT EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=?)
    AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}<?`,
  bindings: [source.saved.row.policy_id, source.saved.row.policy_digest, source.session.row.session_id, minimumWriteMs,
    policy.startsAtMs, policy.resources.startsAtMs, expiresAtMs] };
}
function personalBlockScopes(captured: Captured): Proof {
  const ids = captured.source.saved.plan.events.filter(event => event.type === "BlockCreated").map(event => {
    if (typeof event.payload.block_id !== "string") return fail();
    return event.payload.block_id;
  });
  ids.push(captured.data.requirementId);
  if (new Set(ids).size !== ids.length) return fail();
  // Personal native block provenance excludes a shared-project association
  // anywhere for these exact IDs. Project-scoped PKs do not prove UUID-global
  // custody. Keep the existing empty inventory unchanged and add this guard.
  return { sql: `NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='block'
    AND resource_id IN(SELECT value FROM json_each(?)))`, bindings: [JSON.stringify(ids)] };
}
function expectedResource(captured: Captured) {
  const input = captured.data.resourceInput;
  return { resource_id: input.resourceId, campaign_id: input.campaignId, policy_digest: input.policyDigest, limits_digest: captured.limitsDigest,
    actor_user_id: input.actorUserId, session_digest: input.sessionDigest, operation: input.operation, intent_key: input.intentKey,
    payload_digest: input.payloadDigest, text_bytes: input.textBytes, issued_grant_id: null };
}
function resourceProof(captured: Captured): Proof {
  const timestamp = captured.resourceTimestamp;
  return { sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts WHERE ${objectSql(resourceColumns)}=?
    AND typeof(recorded_at_ms)='integer' AND ${timestamp === null ? "recorded_at_ms>=? AND recorded_at_ms<?" : "recorded_at_ms=?"})`,
  bindings: [JSON.stringify(expectedResource(captured)), ...(timestamp === null ? [captured.minimumWriteMs, captured.expiresAtMs] : [timestamp])] };
}
function eventRow(event: EventRow, data: GuestImageOutputData) {
  return { event_id: event.eventId, stream_id: event.streamId, sequence: event.sequence, occurred_at: event.occurredAt, recorded_at: event.recordedAt,
    actor: event.actor, client_id: event.clientId, correlation_id: event.correlationId, causation_id: event.causationId,
    compensates_event_id: event.compensatesEventId, schema_version: event.schemaVersion, type: event.type,
    payload: JSON.stringify(publicEventPayload(event.eventId, event.payload, true).payload), owner_id: data.session.row.guest_subject,
    project_id: data.plan.projectId, document_id: data.plan.documentId, private_json: JSON.stringify(event.payload), created_at: event.recordedAt, redacted_at: null };
}
function validateEvent(captured: Captured, raw: EventRow): EventRow {
  const { data } = captured;
  if (!record(raw) || !exactKeys(raw, ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId", "correlationId", "causationId", "compensatesEventId", "schemaVersion", "type", "payload"])
    || jsonIssues(raw).length || !uuid(raw.eventId) || data.sourceEventIds.includes(raw.eventId) || raw.streamId !== data.plan.streamId
    || raw.sequence !== data.sourceHead + 1 || raw.actor !== data.session.row.guest_subject || raw.clientId !== "server:guest-output"
    || raw.correlationId !== data.commandKey || raw.causationId !== null || raw.compensatesEventId !== null || raw.schemaVersion !== 1 || raw.type !== "BlockCreated"
    || !iso(raw.occurredAt) || !iso(raw.recordedAt) || raw.occurredAt !== raw.recordedAt || JSON.stringify(raw.payload) !== JSON.stringify(data.payload)
    || Date.parse(raw.recordedAt) >= captured.expiresAtMs) return fail("successor_invalid");
  return freeze(structuredClone(raw));
}
async function inspectBase(request: Request, env: WorkerEnv, input: GuestImageOutputInput,
  approvedWitness: GuestApprovedCampaignWitness): Promise<Captured> {
  if (!(request instanceof Request) || jsonIssues(input).length || !record(input) || !exactKeys(input, ["proof", "campaignId", "policyDigest", "draftHash"])
    || typeof input.campaignId !== "string" || !guestHash(input.policyDigest) || !guestHash(input.draftHash)) return fail();
  const copied = structuredClone(input), approved = guestApprovedCampaignData(request, env, approvedWitness), headers = JSON.stringify(Array.from(request.headers));
  const ctx: Context = { request, env, db: env.DB, url: request.url, headers, origin: approved.policy.guestAdmission.origin, approvedWitness, approved };
  current(ctx);
  if (bytes(headers) > 32768 || copied.campaignId !== approved.policy.campaignId || copied.policyDigest !== approved.policyDigest) return fail();
  const source = await readGuestImageSourceForCustody(request, env, copied.proof); current(ctx);
  const { plan } = source.saved, { session } = source, { policy } = approved, admission = policy.guestAdmission;
  if (copied.draftHash !== plan.draftHash || session.row.policy_id !== admission.sessionPolicyId || session.row.terms_digest !== admission.sessionTermsDigest
    || session.policy.terms.origin !== admission.origin || source.saved.row.policy_id !== admission.sourcePolicyId
    || source.saved.row.policy_digest !== admission.sourcePolicyDigest || plan.release.releaseHash !== admission.releaseHash
    || session.row.guest_subject === policy.payerUserId) return fail();
  const prefix = await originalPrefix(ctx, source); current(ctx);
  const ratio = plan.request.values.ratio, format = ratio?.provenance === "authored" ? experienceImageFormat(ratio.value) : null, template = policy.templates[0];
  if (!format || template.width !== format.dimensions.width || template.height !== format.dimensions.height || template.recipeVersion !== `image@${plan.release.definition.revision}`) return fail();
  const sessionBinding = await compileGuestSponsorSessionBinding({ domain: "forma-sponsor-guest-session@1", sessionId: session.row.session_id,
    guestSubject: session.row.guest_subject, projectId: plan.projectId, documentId: plan.documentId, sessionPolicyId: session.row.policy_id,
    sessionTermsDigest: session.row.terms_digest, expiresAtMs: session.row.expires_at_ms }); current(ctx);
  const sourceBinding = await compileGuestSponsorSourceBinding({ domain: "forma-sponsor-guest-source@1", sessionDigest: sessionBinding.sessionDigest,
    sourcePolicyId: source.saved.row.policy_id, sourcePolicyDigest: source.saved.row.policy_digest, draftId: plan.draftId, draftHash: plan.draftHash,
    requestDigest: source.saved.row.request_digest, contentDigest: source.saved.row.content_digest, releaseHash: plan.release.releaseHash,
    sourceHead: source.commit.head, sourceEventIds: [...source.commit.eventIds], expiresAtMs: Date.parse(source.saved.row.expires_at) }); current(ctx);
  const driver = await deriveGuestSponsorDriver({ version: 1, action: "run-guest-sponsored-image", campaignId: policy.campaignId,
    sessionId: session.row.session_id, documentId: plan.documentId, draftId: plan.draftId, draftHash: plan.draftHash, guestSourceDigest: sourceBinding.guestSourceDigest }); current(ctx);
  const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement"); current(ctx);
  const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable"); current(ctx);
  const variantId = await experienceResourceId(plan.draftId, "native-output-variant"); current(ctx);
  const recipe = createExperienceOutputRecipe({ output: "image", requirementId, deliverableId, variantId, aspectRatio: format.aspect_ratio });
  if (inspectOutputRequirement(recipe.spec).status === "invalid") return fail();
  const planSuggestions = normalizePlanSuggestions(recipe.spec, undefined, false), binding = await experienceOutputBinding(plan); current(ctx);
  const envelope = await experienceOutputEnvelope(binding, "save", source.commit.head, { blockId: requirementId, spec: recipe.spec, planSuggestions,
    guestSponsorPreparation: { protocol: "guest-image-source@1", campaignId: policy.campaignId, approvalId: approved.approvalId,
      termsDigest: approved.termsDigest, policyDigest: approved.policyDigest, session: sessionBinding.binding, source: sourceBinding.binding, driver: driver.command } }); current(ctx);
  const payloadDigest = await digest(envelope); current(ctx);
  const commandKey = String(envelope.clientMutationId), requestDigest = payloadDigest.slice(7), scopeKey = `personal:${session.row.guest_subject}:${plan.projectId}`;
  const payload = { block_id: requirementId, type: "output", scope: "document", position: `z-output-${requirementId}`, handle: `output/${requirementId}`,
    properties: { text: recipe.spec.original_text, subtype: recipe.spec.label, output_spec: recipe.spec, output_plan_suggestions: planSuggestions, authority: "authored" },
    output_command_envelope: envelope, project_id: plan.projectId, document_id: plan.documentId, actor_user_id: session.row.guest_subject };
  const context = authoritativeCreativeContext(prefix.events, { documentId: plan.documentId, projectId: plan.projectId });
  const resourceInput: SponsorResourceInput = { limits: policy.resources, campaignId: policy.campaignId, policyDigest: approved.policyDigest,
    actorUserId: session.row.guest_subject, sessionDigest: sessionBinding.sessionDigest, intentKey: commandKey, operation: "text-intake",
    payloadDigest, textBytes: bytes(canonicalJson(context.snapshot)), resourceId: `${commandKey}:text` };
  const limitsDigest = await digest(policy.resources); current(ctx);
  const memory = await memoryProof(ctx, plan.draftId); current(ctx);
  const sponsor = await sponsorSchema(ctx); current(ctx);
  const clock = await ctx.db.prepare(`SELECT ${GUEST_DB_NOW} AS now`).first<{ now: number }>(); current(ctx);
  if (!clock || !Number.isSafeInteger(clock.now) || clock.now < 0) return fail();
  const expiresAtMs = Math.min(policy.expiresAtMs, policy.resources.expiresAtMs, session.row.expires_at_ms, session.policy.terms.expiresAtMs,
    Date.parse(source.saved.row.expires_at), clock.now + policy.maximumGrantLifetimeMs);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= clock.now) return fail();
  const data: GuestImageOutputData = { state: "saved", plan, session, policy, sourceHead: source.commit.head, sourceEventIds: [...source.commit.eventIds],
    scopeKey, requirementId, binding, envelope, payload, commandKey, requestDigest, resourceInput, beforeProof: null, assertion: { sql: "0", bindings: [] }, saved: null };
  const captured: Captured = { ctx, data, prefix: prefix.parts, memory, sponsor, source, minimumWriteMs: clock.now, expiresAtMs,
    limitsDigest, resourceTimestamp: null, driverId: driver.driverId, stage: null, stageProofs: [], stageEvents: [], resourceIds: [] };
  const command = await ctx.db.prepare(`SELECT ${objectSql(commandColumns)} AS witness FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?`)
    .bind(scopeKey, session.row.guest_subject, commandKey).first<{ witness: string }>(); current(ctx);
  if (!command) return fail("save_required");
  let receipt: unknown; try { receipt = JSON.parse(command.witness); } catch { return fail(); }
    if (!flatRow(receipt, commandColumns) || receipt.request_digest !== requestDigest || receipt.action !== "save") return fail("save_conflict");
    const row = await ctx.db.prepare(`SELECT ${eventWitness} AS witness FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id
      WHERE e.event_id=? AND length(CAST(body.private_json AS BLOB))<=65536 AND length(CAST(e.payload AS BLOB))<=65536`).bind(receipt.event_id).first<{ witness: string }>(); current(ctx);
    if (!row || typeof row.witness !== "string") return fail();
    let savedRow: unknown; try { savedRow = JSON.parse(row.witness); } catch { return fail(); }
    if (!flatRow(savedRow, [...eventColumns, ...bodyColumns]) || !iso(receipt.created_at) || savedRow.recorded_at !== receipt.created_at) return fail();
    const event: EventRow = { eventId: String(savedRow.event_id), streamId: String(savedRow.stream_id), sequence: Number(savedRow.sequence),
      occurredAt: String(savedRow.occurred_at), recordedAt: String(savedRow.recorded_at), actor: String(savedRow.actor), clientId: String(savedRow.client_id),
      correlationId: String(savedRow.correlation_id), causationId: savedRow.causation_id as string | null, compensatesEventId: savedRow.compensates_event_id as string | null,
      schemaVersion: Number(savedRow.schema_version), type: String(savedRow.type), payload: structuredClone(payload) };
    const saved: Saved = { event, eventId: event.eventId, createdAt: event.recordedAt, revision: source.commit.head + 1, requirementId, commandKey, requestDigest };
    captured.data = { ...data, state: "saved", saved };
    validateEvent(captured, event);
    if (row.witness !== JSON.stringify(eventRow(event, captured.data))) return fail();
    const resource = await ctx.db.prepare(`SELECT recorded_at_ms FROM experience_sponsor_resource_receipts WHERE ${objectSql(resourceColumns)}=?`)
      .bind(JSON.stringify(expectedResource(captured))).first<{ recorded_at_ms: number }>(); current(ctx);
    const minimum = Math.max(policy.startsAtMs, policy.resources.startsAtMs, Number((session.row as unknown as Record<string, unknown>).created_at_ms));
    if (!resource || !Number.isSafeInteger(resource.recorded_at_ms) || !Number.isSafeInteger(minimum) || resource.recorded_at_ms < minimum
      || resource.recorded_at_ms > clock.now || resource.recorded_at_ms >= expiresAtMs || Date.parse(event.recordedAt) < minimum) return fail();
    captured.resourceTimestamp = resource.recorded_at_ms;
  captured.resourceIds.push(resourceInput.resourceId);
  captured.stageProofs.push(
    { sql: `EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE ${eventWitness}=?)`, bindings: [JSON.stringify(eventRow(event, captured.data))] },
    { sql: `EXISTS(SELECT 1 FROM output_commands WHERE ${objectSql(commandColumns)}=?)`, bindings: [command.witness] }, resourceProof(captured));
  const history = [...prefix.events, event];
  const nativeContext = authoritativeCreativeContext(history, { documentId: plan.documentId, projectId: plan.projectId });
  const requirements = outputRequirements(foldEvents(history));
  if (requirements.length !== 1 || requirements[0].status !== "valid" || !requirements[0].spec
    || outputRequirementInterpretationNeedsReview(requirements[0].spec) || !await sponsorImageTextSource(nativeContext.snapshot.facts)) return fail();
  current(ctx);
  const digests = await outputSourceDigests(foldEvents(history), requirements, plan.documentId, plan.projectId, nativeContext); current(ctx);
  const confirmationOptions = { count_policies: {}, suggested_counts: {} };
  const compiledPlan = compileOutputPlan([requirements[0].spec], { ...confirmationOptions, document_id: plan.documentId,
    source_revision: digests.sourceDigest, requirement_revision: digests.requirementsDigest, max_targets: 1 });
  const target = matchExperienceOutputRecipeTarget(recipe, compiledPlan, { documentId: plan.documentId,
    sourceRevision: digests.sourceDigest, requirementRevision: digests.requirementsDigest });
  if (!target || compiledPlan.issues.length || compiledPlan.targets.length !== 1) return fail();
  const contractDigest = await outputTargetContractDigest(target, digests.sourceDigest); current(ctx);
  const review = { version: 1, purpose: "confirm-guest-image-requirement", campaignId: policy.campaignId,
    policyDigest: approved.policyDigest, sessionDigest: sessionBinding.sessionDigest, guestSourceDigest: sourceBinding.guestSourceDigest,
    releaseHash: plan.release.releaseHash, documentId: plan.documentId, sourceRevision: source.commit.head + 1,
    save: { eventId: event.eventId, commandKey, requestDigest }, ...digests, requirement: requirements[0],
    confirmationOptions, plan: compiledPlan, targetContractDigest: contractDigest };
  const reviewedRequirementDigest = await digest(review); current(ctx);
  const confirmEnvelope = await experienceOutputEnvelope(binding, "confirm", source.commit.head + 1,
    { options: confirmationOptions, explicitRequirementsConfirmation: true, reviewedRequirementDigest }); current(ctx);
  const confirmDigest = await outputDigest(confirmEnvelope); current(ctx);
  const driverPayloadDigest = await digest({ command: driver.command, ...digests }); current(ctx);
  const driverResourceBase = { limits: policy.resources, campaignId: policy.campaignId, policyDigest: approved.policyDigest,
    actorUserId: session.row.guest_subject, sessionDigest: sessionBinding.sessionDigest, intentKey: driver.intentKey,
    payloadDigest: driverPayloadDigest, textBytes: bytes(canonicalJson(nativeContext.snapshot)) };
  captured.stage = { state: "saved", base: captured.data, context: nativeContext, ...digests, review,
    reviewedRequirementDigest, confirmationOptions, compiledPlan, target, contractDigest, confirmEnvelope, confirmDigest,
    confirmKey: String(confirmEnvelope.clientMutationId), confirmed: null, confirmEvent: null, driver,
    confirmResource: { ...driverResourceBase, operation: "text-intake", resourceId: `${driver.driverId}:text` },
    preflightResource: { ...driverResourceBase, operation: "preflight", resourceId: `${driver.driverId}:preflight` },
    preflightEnvelope: null, preflightDigest: null, quote: null, quoteEvent: null, transport: null,
    expiresAtMs, nowMs: clock.now, assertion: { sql: "0", bindings: [] } };
  return captured;
}

const planColumns = ["scope_key", "scope_kind", "owner_user_id", "project_id", "document_id", "organization_id", "project_access_id",
  "plan_revision_id", "plan_id", "revision", "confirmed_event_id", "requirements_digest", "source_digest", "resolver_version", "source_head", "target_count", "created_at"];
const targetColumns = ["scope_key", "plan_revision_id", "target_id", "target_contract_digest", "media_kind", "required", "selected", "ordinal"];
const quoteColumns = ["scope_key", "preflight_id", "plan_revision_id", "actor_user_id", "terms_digest", "event_id", "expires_at", "created_at"];
const intentColumns = ["driver_id", "campaign_id", "actor_user_id", "session_digest", "intent_key", "document_id", "command_json", "command_digest",
  "source_digest", "requirements_digest", "source_text_bytes", "created_at_ms"];
const stageColumns = ["driver_id", "stage", "command_json", "command_digest"];
function stage(captured: Captured): StageData { if (!captured.stage) return fail(); return captured.stage; }
function exactRow(table: string, columns: string[], row: Record<string, Value>): Proof {
  if (!flatRow(row, columns)) return fail("row_invalid");
  return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${objectSql(columns)}=?)`, bindings: [JSON.stringify(row)] };
}
function nativePayload(captured: Captured, envelope: Record<string, unknown>, values: Record<string, unknown>) {
  const { data } = captured;
  return { ...values, output_command_envelope: structuredClone(envelope), project_id: data.plan.projectId,
    document_id: data.plan.documentId, actor_user_id: data.session.row.guest_subject };
}
function stageEvent(captured: Captured, raw: EventRow, kind: "confirm" | "preflight", payload: Record<string, unknown>) {
  const data = stage(captured), key = kind === "confirm" ? data.confirmKey : String(data.preflightEnvelope?.clientMutationId);
  const offset = kind === "confirm" ? 2 : 3;
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId", "correlationId", "causationId", "compensatesEventId", "schemaVersion", "type", "payload"])
    || !uuid(raw.eventId) || [...captured.source.commit.eventIds, captured.data.saved!.eventId].includes(raw.eventId)
    || kind === "preflight" && raw.eventId === data.confirmEvent?.eventId
    || raw.streamId !== captured.data.plan.streamId || raw.sequence !== captured.data.sourceHead + offset
    || raw.actor !== captured.data.session.row.guest_subject || raw.clientId !== "server:guest-output" || raw.correlationId !== key
    || raw.causationId !== null || raw.compensatesEventId !== null || raw.schemaVersion !== 1
    || raw.type !== (kind === "confirm" ? "OutputPlanConfirmed" : "OutputPlanPreflighted")
    || !iso(raw.recordedAt) || raw.occurredAt !== raw.recordedAt || Date.parse(raw.recordedAt) >= captured.expiresAtMs
    || raw.recordedAt < (kind === "confirm" ? captured.data.saved!.createdAt : data.confirmEvent!.recordedAt)
    || JSON.stringify(raw.payload) !== JSON.stringify(payload) || bytes(JSON.stringify(payload)) > 65536) return fail("successor_invalid");
  return freeze(structuredClone(raw));
}
function commandRow(captured: Captured, event: EventRow, action: "confirm" | "preflight", requestDigest: string) {
  return { scope_key: captured.data.scopeKey, actor_user_id: captured.data.session.row.guest_subject, command_key: event.correlationId,
    request_digest: requestDigest, action, event_id: event.eventId, created_at: event.recordedAt };
}
export function guestImagePlanRows(data: StageData, confirmed: OutputConfirmedPlan, event: EventRow) {
  const { base } = data;
  return {
    plan: { scope_key: base.scopeKey, scope_kind: "personal", owner_user_id: base.session.row.guest_subject,
      project_id: base.plan.projectId, document_id: base.plan.documentId, organization_id: null, project_access_id: null,
      plan_revision_id: confirmed.revisionId, plan_id: confirmed.id, revision: 1, confirmed_event_id: event.eventId,
      requirements_digest: data.requirementsDigest, source_digest: data.sourceDigest, resolver_version: "output-plan-v1",
      source_head: base.sourceHead + 1, target_count: 1, created_at: event.recordedAt },
    target: { scope_key: base.scopeKey, plan_revision_id: confirmed.revisionId, target_id: data.target.id,
      target_contract_digest: data.contractDigest, media_kind: "image", required: 1, selected: 1, ordinal: 0 },
  };
}
export function guestImageIntentRow(data: StageData, createdAtMs: number) {
  return { driver_id: data.driver.driverId, campaign_id: data.base.policy.campaignId, actor_user_id: data.base.session.row.guest_subject,
    session_digest: data.base.resourceInput.sessionDigest, intent_key: data.driver.intentKey, document_id: data.base.plan.documentId,
    command_json: data.driver.commandJson, command_digest: data.driver.commandDigest, source_digest: data.sourceDigest,
    requirements_digest: data.requirementsDigest, source_text_bytes: data.confirmResource.textBytes, created_at_ms: createdAtMs };
}
export function guestImageQuoteRow(data: StageData, quote: OutputPreflight, event: EventRow) {
  return { scope_key: data.base.scopeKey, preflight_id: quote.id, plan_revision_id: quote.planRevisionId,
    actor_user_id: data.base.session.row.guest_subject, terms_digest: quote.termsDigest, event_id: event.eventId,
    expires_at: quote.expiresAt, created_at: quote.createdAt };
}
function expectedStageResource(captured: Captured, input: SponsorResourceInput) {
  return { resource_id: input.resourceId, campaign_id: input.campaignId, policy_digest: input.policyDigest, limits_digest: captured.limitsDigest,
    actor_user_id: input.actorUserId, session_digest: input.sessionDigest, operation: input.operation, intent_key: input.intentKey,
    payload_digest: input.payloadDigest, text_bytes: input.textBytes, issued_grant_id: null };
}
function stagedResourceProof(captured: Captured, input: SponsorResourceInput, recordedAtMs: number | null, minimum: number): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts WHERE ${objectSql(resourceColumns)}=?
    AND typeof(recorded_at_ms)='integer' AND ${recordedAtMs === null ? "recorded_at_ms>=? AND recorded_at_ms<?" : "recorded_at_ms=?"})`,
  bindings: [JSON.stringify(expectedStageResource(captured, input)), ...(recordedAtMs === null ? [minimum, captured.expiresAtMs] : [recordedAtMs])] };
}
function fullAssertion(captured: Captured): Proof {
  const { data, source } = captured, count = data.sourceHead + 1 + captured.stageEvents.length;
  return together([...captured.prefix, captured.memory.proof, captured.sponsor.proof, proof(captured.ctx.approved.assertion),
    freshSource(captured), personalBlockScopes(captured), ...captured.stageProofs,
    { sql: `(SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND (SELECT COUNT(*) FROM event_client_receipts WHERE stream_id=?)=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    bindings: [data.plan.streamId, count, data.plan.streamId, count, data.plan.streamId, data.sourceHead, source.saved.row.expires_at] },
    closure(captured, data.saved!.eventId, true)]);
}
function copyCaptured(captured: Captured): Captured {
  return { ...captured, stage: { ...stage(captured) }, stageProofs: [...captured.stageProofs], stageEvents: [...captured.stageEvents], resourceIds: [...captured.resourceIds] };
}
async function addConfirmation(captured: Captured, raw: EventRow, intentTime: number, resourceTime: number | null) {
  const data = stage(captured);
  if (data.state !== "saved" || !record(raw.payload.confirmed_plan) || !uuid(raw.payload.confirmed_plan.revisionId)
    || !Number.isSafeInteger(intentTime) || intentTime < Date.parse(captured.data.saved!.createdAt) || intentTime >= captured.expiresAtMs) return fail("confirmation_invalid");
  const confirmed: OutputConfirmedPlan = { id: captured.data.plan.documentId, revisionId: raw.payload.confirmed_plan.revisionId,
    revision: 1, confirmedAt: raw.recordedAt, requirementsDigest: data.requirementsDigest, sourceDigest: data.sourceDigest,
    plan: data.compiledPlan, targetContractDigests: { [data.target.id]: data.contractDigest }, confirmationOptions: data.confirmationOptions };
  const payload = nativePayload(captured, data.confirmEnvelope, { plan_revision_id: confirmed.revisionId, confirmed_plan: confirmed });
  const event = stageEvent(captured, raw, "confirm", payload), rows = guestImagePlanRows(data, confirmed, event);
  const preflightEnvelope = await experienceOutputEnvelope(captured.data.binding, "preflight", captured.data.sourceHead + 2,
    { planRevisionId: confirmed.revisionId, targetIds: [data.target.id] }); current(captured.ctx);
  const preflightDigest = await outputDigest(preflightEnvelope); current(captured.ctx);
  captured.stage = { ...data, state: "confirmed", confirmed, confirmEvent: event, preflightEnvelope, preflightDigest };
  captured.stageEvents.push(event); captured.resourceIds.push(data.confirmResource.resourceId);
  captured.stageProofs.push(
    { sql: `EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE ${eventWitness}=?)`, bindings: [JSON.stringify(eventRow(event, captured.data))] },
    exactRow("output_commands", commandColumns, commandRow(captured, event, "confirm", data.confirmDigest)),
    exactRow("output_plan_revisions", planColumns, rows.plan), exactRow("output_plan_targets", targetColumns, rows.target),
    exactRow("experience_sponsor_driver_intents", intentColumns, guestImageIntentRow(data, intentTime)),
    stagedResourceProof(captured, data.confirmResource, resourceTime, intentTime));
}
function addClaim(captured: Captured, resourceTime: number | null) {
  const data = stage(captured);
  if (data.state !== "confirmed" || !data.preflightEnvelope || !data.preflightDigest || !data.confirmEvent) return fail("claim_invalid");
  captured.stage = { ...data, state: "claimed" }; captured.resourceIds.push(data.preflightResource.resourceId);
  captured.stageProofs.push(exactRow("experience_sponsor_driver_stages", stageColumns,
    { driver_id: data.driver.driverId, stage: "preflight", command_json: canonicalJson(data.preflightEnvelope), command_digest: data.preflightDigest }),
  stagedResourceProof(captured, data.preflightResource, resourceTime, Date.parse(data.confirmEvent.recordedAt)));
}

/** Validate the retained native offer against its actual captured transport;
 * never reconstruct actual provider evidence from policy or new configuration. */
export async function guestImageQuoteRecipe(data: StageData, offered: OutputNativeTargetPreflight, transport: unknown): Promise<SponsorRecipe> {
  if (jsonIssues(offered).length || jsonIssues(transport).length || bytes(canonicalJson({ offered, transport })) > 49152
    || offered.targetId !== data.target.id || offered.available !== true || offered.provider !== "openai" || typeof offered.model !== "string"
    || ![offered.maximumCalls, offered.maximumMicrousd, offered.maximumTokens].every(value => Number.isSafeInteger(value) && value > 0)
    || !record(offered.settings.payload) || offered.settings.payload.outputTargetInstructions !== providerInputInstructions({ target: data.target })
    || !record(offered.settings.imageRender) || !record(offered.settings.imageRender.format) || !record(offered.settings.imageRender.format.dimensions)
    || !Array.isArray(offered.settings.calls) || offered.settings.calls.length !== offered.maximumCalls
    || offered.settings.calls.some(call => !record(call) || typeof call.stage !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(call.stage)
      || !Number.isSafeInteger(call.maximumMicrousd) || Number(call.maximumMicrousd) <= 0)
    || new Set(offered.settings.calls.map(call => record(call) ? call.stage : null)).size !== offered.maximumCalls) return fail("quote_invalid");
  const dimensions = offered.settings.imageRender.format.dimensions;
  const recipe: SponsorRecipe = { appId: "image", recipeVersion: `image@${data.base.plan.release.definition.revision}`,
    releaseDigest: data.base.plan.release.releaseHash, outputKind: "image", provider: offered.provider, model: offered.model,
    routeDigest: await digest(offered), settingsDigest: await digest(offered.settings), outputCount: 1, durationMs: 0,
    width: Number(dimensions.width), height: Number(dimensions.height), calls: { parsing: 0, planning: 1, render: 1, repair: 0 },
    maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd };
  if (!matchSponsorImageTemplate(data.base.policy.templates[0], { recipe, offered, transport })) return fail("quote_template_mismatch");
  return recipe;
}
async function addQuote(captured: Captured, raw: EventRow) {
  const data = stage(captured), value = raw.payload.preflight, transport = raw.payload.guest_sponsor_quote_transport;
  if (data.state !== "claimed" || !data.confirmed || !data.preflightEnvelope || !data.preflightDigest || jsonIssues(value).length
    || !record(value) || !exactKeys(value, ["id", "planRevisionId", "sourceDigest", "requirementsDigest", "targets", "operationAttempts", "maximumMicrousd", "maximumCalls", "expiresAt", "createdAt", "termsDigest"])
    || !uuid(value.id) || value.planRevisionId !== data.confirmed.revisionId || value.sourceDigest !== data.sourceDigest || value.requirementsDigest !== data.requirementsDigest
    || !Array.isArray(value.targets) || value.targets.length !== 1 || !record(value.targets[0]) || value.targets[0].targetId !== data.target.id
    || canonicalJson(value.operationAttempts) !== canonicalJson({ [data.target.id]: { ordinal: 0, previousSlotId: null } })
    || value.maximumMicrousd !== value.targets[0].maximumMicrousd || value.maximumCalls !== value.targets[0].maximumCalls
    || value.createdAt !== raw.recordedAt || !iso(value.expiresAt) || !iso(value.createdAt) || value.expiresAt <= value.createdAt
    || Date.parse(value.expiresAt) > Math.min(captured.expiresAtMs, Date.parse(value.createdAt) + 15 * 60_000)) return fail("quote_invalid");
  const { termsDigest, ...withoutDigest } = value;
  if (termsDigest !== await outputDigest(withoutDigest)) return fail("quote_invalid"); current(captured.ctx);
  const quote = value as unknown as OutputPreflight;
  await guestImageQuoteRecipe(data, quote.targets[0], transport); current(captured.ctx);
  const event = stageEvent(captured, raw, "preflight", nativePayload(captured, data.preflightEnvelope,
    { preflight_id: quote.id, plan_revision_id: data.confirmed.revisionId, preflight: quote, guest_sponsor_quote_transport: transport }));
  captured.stage = { ...data, state: "quoted", quote: freeze(structuredClone(quote)), quoteEvent: event, transport: freeze(structuredClone(transport)) };
  captured.stageEvents.push(event);
  captured.stageProofs.push(
    { sql: `EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE ${eventWitness}=?)`, bindings: [JSON.stringify(eventRow(event, captured.data))] },
    exactRow("output_commands", commandColumns, commandRow(captured, event, "preflight", data.preflightDigest)),
    exactRow("output_preflights", quoteColumns, guestImageQuoteRow(data, quote, event)));
}
async function readEvent(captured: Captured, commandKey: string): Promise<EventRow | null> {
  const { ctx, data } = captured;
  const row = await ctx.db.prepare(`SELECT ${eventWitness} AS witness FROM output_commands command
    JOIN events e ON e.event_id=command.event_id JOIN event_private_payloads body ON body.private_event_id=e.event_id
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?
      AND typeof(e.payload)='text' AND length(CAST(e.payload AS BLOB))<=65536
      AND typeof(body.private_json)='text' AND length(CAST(body.private_json AS BLOB))<=65536`)
    .bind(data.scopeKey, data.session.row.guest_subject, commandKey).first<{ witness: string }>(); current(ctx);
  if (!row) return null;
  let value: unknown, payload: unknown;
  try { value = JSON.parse(row.witness); payload = record(value) && typeof value.private_json === "string" ? JSON.parse(value.private_json) : null; } catch { return fail(); }
  if (!flatRow(value, [...eventColumns, ...bodyColumns]) || !record(payload) || jsonIssues(payload).length) return fail();
  const event: EventRow = { eventId: String(value.event_id), streamId: String(value.stream_id), sequence: Number(value.sequence),
    occurredAt: String(value.occurred_at), recordedAt: String(value.recorded_at), actor: String(value.actor), clientId: String(value.client_id),
    correlationId: String(value.correlation_id), causationId: value.causation_id as string | null, compensatesEventId: value.compensates_event_id as string | null,
    schemaVersion: Number(value.schema_version), type: String(value.type), payload };
  if (row.witness !== JSON.stringify(eventRow(event, data)) || !iso(event.recordedAt) || Date.parse(event.recordedAt) > stage(captured).nowMs) return fail();
  return event;
}
async function resourceTime(captured: Captured, input: SponsorResourceInput, minimum: number) {
  const row = await captured.ctx.db.prepare(`SELECT recorded_at_ms FROM experience_sponsor_resource_receipts WHERE ${objectSql(resourceColumns)}=?`)
    .bind(JSON.stringify(expectedStageResource(captured, input))).first<{ recorded_at_ms: number }>(); current(captured.ctx);
  if (!row || !Number.isSafeInteger(row.recorded_at_ms) || row.recorded_at_ms < minimum || row.recorded_at_ms > stage(captured).nowMs
    || row.recorded_at_ms >= captured.expiresAtMs) return fail("resource_unavailable");
  return row.recorded_at_ms;
}

export async function inspectGuestImageStages(request: Request, env: WorkerEnv, input: GuestImageOutputInput,
  approved: GuestApprovedCampaignWitness): Promise<GuestImageStageWitness> {
  const captured = await inspectBase(request, env, input, approved); current(captured.ctx);
  const confirm = await readEvent(captured, stage(captured).confirmKey); current(captured.ctx);
  if (confirm) {
    const data = stage(captured), intent = await captured.ctx.db.prepare("SELECT created_at_ms FROM experience_sponsor_driver_intents WHERE driver_id=?")
      .bind(data.driver.driverId).first<{ created_at_ms: number }>(); current(captured.ctx);
    if (!intent || !Number.isSafeInteger(intent.created_at_ms) || intent.created_at_ms > data.nowMs) return fail();
    const time = await resourceTime(captured, data.confirmResource, intent.created_at_ms); current(captured.ctx);
    await addConfirmation(captured, confirm, intent.created_at_ms, time); current(captured.ctx);
    const row = await captured.ctx.db.prepare("SELECT stage FROM experience_sponsor_driver_stages WHERE driver_id=? AND stage='preflight'")
      .bind(data.driver.driverId).first<{ stage: string }>(); current(captured.ctx);
    if (row) {
      addClaim(captured, await resourceTime(captured, data.preflightResource, Date.parse(confirm.recordedAt))); current(captured.ctx);
      const quoted = await readEvent(captured, String(stage(captured).preflightEnvelope?.clientMutationId)); current(captured.ctx);
      if (quoted) { await addQuote(captured, quoted); current(captured.ctx); }
    }
  }
  captured.stage = freeze({ ...stage(captured), assertion: fullAssertion(captured) });
  await prove(captured.ctx, proof(stage(captured).assertion)); current(captured.ctx);
  const witness = Object.freeze(Object.create(null)) as GuestImageStageWitness;
  stageWitnesses.set(witness, captured); return witness;
}
function capturedStage(request: Request, env: WorkerEnv, witness: GuestImageStageWitness) {
  const captured = witness && typeof witness === "object" ? stageWitnesses.get(witness) : undefined;
  if (!captured || captured.ctx.request !== request || captured.ctx.env !== env) return fail();
  current(captured.ctx); return captured;
}
export function guestImageStageData(request: Request, env: WorkerEnv, witness: GuestImageStageWitness): StageData {
  return stage(capturedStage(request, env, witness));
}
export async function recheckGuestImageStages(request: Request, env: WorkerEnv, witness: GuestImageStageWitness) {
  const captured = capturedStage(request, env, witness);
  await prove(captured.ctx, proof(stage(captured).assertion)); current(captured.ctx);
}
export async function guestImageConfirmationSuccessor(request: Request, env: WorkerEnv, witness: GuestImageStageWitness,
  event: EventRow, intentTime: number): Promise<OutputSqlAssertion> {
  const captured = copyCaptured(capturedStage(request, env, witness));
  await addConfirmation(captured, event, intentTime, null); current(captured.ctx);
  return freeze(fullAssertion(captured));
}
export function guestImageClaimSuccessor(request: Request, env: WorkerEnv, witness: GuestImageStageWitness): OutputSqlAssertion {
  const captured = copyCaptured(capturedStage(request, env, witness)); addClaim(captured, null);
  return freeze(fullAssertion(captured));
}
export async function guestImageQuoteSuccessor(request: Request, env: WorkerEnv, witness: GuestImageStageWitness,
  event: EventRow): Promise<OutputSqlAssertion> {
  const captured = copyCaptured(capturedStage(request, env, witness));
  await addQuote(captured, event); current(captured.ctx); return freeze(fullAssertion(captured));
}
