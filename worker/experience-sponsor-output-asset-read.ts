import { freeze } from "../src/experiences/compiler.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { beginSponsorNativeImageRead, requireSponsorNativeImageRead } from "./experience-sponsor-native-image-read.ts";
import { SponsorNativeImageReadBudget } from "./experience-sponsor-native-image-budget.ts";
import { sponsorJobReadPredicate } from "./experience-sponsor-job-read.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { OutputSqlAssertion } from "./output-requirements-ledger.ts";

type Actor = Pick<PilotUser, "userId" | "streamId" | "projectExecution">;
type Facts = { kind: "sponsored"; assetId: string; documentId: string; storageKey: string; byteLength: number; budget: SponsorNativeImageReadBudget; assertions: OutputSqlAssertion[] };
export type SponsorOutputAssetRead = Readonly<Facts>;
type Ordinary = Readonly<{ kind: "ordinary"; assertion: OutputSqlAssertion }>;
const contexts = new WeakMap<SponsorOutputAssetRead, { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; actor: Actor }>();
const fail = (code = "sponsor_output_read_unavailable"): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const scalar = (column: string, maximum = 240) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum} THEN ${column} END`;
const origin = (field: string) => `CASE WHEN typeof(body.private_json)='text' AND length(CAST(body.private_json AS BLOB))<=131072 THEN CASE WHEN json_valid(body.private_json) THEN ${scalar(`json_extract(body.private_json,'$.asset.origin.${field}')`)} END END`;
const publicScalar = (field: string) => `CASE WHEN typeof(event.payload)='text' AND length(CAST(event.payload AS BLOB))<=131072 THEN CASE WHEN json_valid(event.payload) THEN ${scalar(`json_extract(event.payload,'$.${field}')`)} END END`;
/** Dormant definition. No route or initializer installs it. Exact lookup must
 * precede native private-source loading and cannot scan every asset body. */
export const SPONSOR_OUTPUT_ASSET_READ_INDEXES = Object.freeze([
  Object.freeze({ name: "idx_sponsor_output_asset_lookup", sql: "CREATE INDEX idx_sponsor_output_asset_lookup ON output_assets(owner_user_id,document_id,asset_id)" }),
]);

/** A whole native Outputs snapshot/package has no one-job read allowance. This
 * predicate is control metadata only; neither private bodies nor job JSON leave
 * SQLite. Ordinary project and distinct-payer jobs do not imply sponsorship. */
export async function beginSponsorOutputAssetRead(request: Request, env: WorkerEnv, actor: Actor, documentId: string, assetId?: string): Promise<SponsorOutputAssetRead | Ordinary | null> {
  if (request.method !== "GET" || actor.projectExecution || !id(documentId) || assetId !== undefined && !id(assetId)) return null;
  const control = new SponsorNativeImageReadBudget(0, performance.now() + 30_000, request.signal);
  const schema = await control.wait(env.DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name IN('document_jobs','output_operation_slots','output_execution_grants','output_plan_revisions','experience_sponsor_consumptions') LIMIT 5`).all<{ name: string }>());
  if (!schema.success) return fail("sponsor_output_read_configuration");
  const names = new Set(schema.results.map(row => row.name));
  const sponsorObjects = await control.wait(env.DB.prepare(`SELECT 1 FROM sqlite_schema WHERE lower(name) GLOB 'experience_sponsor_*' OR lower(tbl_name) GLOB 'experience_sponsor_*' LIMIT 1`).first());
  if (!["document_jobs", "output_operation_slots", "output_execution_grants", "output_plan_revisions"].every(name => names.has(name))) {
    const nativeObjects = await control.wait(env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE lower(name) IN('output_operation_slots','output_execution_grants','output_plan_revisions','output_assets','output_native_storage_writes','output_asset_storage_writes') OR lower(tbl_name) IN('output_operation_slots','output_execution_grants','output_plan_revisions','output_assets','output_native_storage_writes','output_asset_storage_writes') LIMIT 1").first());
    if (sponsorObjects || nativeObjects) return fail("sponsor_output_read_configuration");
    return null;
  }
  if (sponsorObjects && !names.has("experience_sponsor_consumptions")) return fail("sponsor_output_read_configuration");
  const predicate = await control.wait(sponsorJobReadPredicate(env, actor));
  // Immutable consumption surviving deletion of its job is ambiguous, never an
  // ordinary-resource proof. Its actor index is required only when populated.
  if (names.has("experience_sponsor_consumptions") && await control.wait(env.DB.prepare("SELECT 1 FROM experience_sponsor_consumptions LIMIT 1").first())) {
    const index = await control.wait(env.DB.prepare("SELECT CASE WHEN length(CAST(sql AS BLOB))<=4096 THEN sql END AS sql FROM sqlite_schema WHERE type='index' AND name='idx_sponsor_image_actor_history'").first<{ sql: string }>());
    if (index?.sql !== "CREATE INDEX idx_sponsor_image_actor_history ON experience_sponsor_consumptions(actor_user_id,job_id)") return fail("sponsor_output_read_configuration");
    const lost = await control.wait(env.DB.prepare(`SELECT 1 FROM experience_sponsor_consumptions used INDEXED BY idx_sponsor_image_actor_history
      WHERE used.actor_user_id=? AND NOT EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=used.job_id AND job.owner_id=? AND job.stream_id=?) LIMIT 1`).bind(actor.userId, actor.userId, actor.streamId).first());
    if (lost) return fail("sponsor_output_read_configuration");
  }
  const known = await control.wait(env.DB.prepare(`SELECT 1 FROM document_jobs INDEXED BY idx_document_jobs_stream_document WHERE stream_id=? AND document_id=? AND ${predicate} LIMIT 1`).bind(actor.streamId, documentId).first());
  if (!known) return Object.freeze({ kind: "ordinary" as const, assertion: {
    sql: `NOT EXISTS(SELECT 1 FROM document_jobs INDEXED BY idx_document_jobs_stream_document WHERE stream_id=? AND document_id=? AND ${predicate})`,
    bindings: [actor.streamId,documentId] } });
  if (!assetId) return fail("sponsor_output_selection_required");
  const definition = SPONSOR_OUTPUT_ASSET_READ_INDEXES[0]!;
  const index = await control.wait(env.DB.prepare("SELECT CASE WHEN length(CAST(sql AS BLOB))<=4096 THEN sql END AS sql FROM sqlite_schema WHERE type='index' AND name=?").bind(definition.name).first<{ sql: string }>());
  if (index?.sql !== definition.sql) return fail("sponsor_output_read_configuration");
  const row = await control.wait(env.DB.prepare(`SELECT ${scalar("asset.scope_key")} AS scope_key,${scalar("asset.storage_key",1024)} AS storage_key,
      ${scalar("asset.content_sha256",64)} AS sha,CASE WHEN typeof(asset.byte_length)='integer' THEN asset.byte_length END AS byte_length,
      ${scalar("asset.created_event_id")} AS created_event_id,${scalar("asset.source_digest")} AS source_digest,
      ${scalar("body.project_id")} AS project_id,${scalar("asset.created_by_user_id")} AS creator,
      ${origin("kind")} AS origin_kind,${origin("jobId")} AS job_id,${origin("slotId")} AS slot_id,${origin("completionEventId")} AS completion_event,
      ${origin("resultId")} AS generation_id,${origin("sourceDigest")} AS origin_source,${origin("targetContractDigest")} AS target_digest,${origin("rightsAttestedBy")} AS rights
    FROM output_assets asset INDEXED BY idx_sponsor_output_asset_lookup LEFT JOIN event_private_payloads body ON body.private_event_id=asset.created_event_id
      AND body.owner_id=asset.owner_user_id AND body.document_id=asset.document_id AND body.redacted_at IS NULL
    WHERE asset.owner_user_id=? AND asset.document_id=? AND asset.asset_id=? AND asset.redacted_at IS NULL LIMIT 2`).bind(actor.userId, documentId, assetId).all<Record<string, unknown>>());
  if (!row.success || row.results.length !== 1) return fail();
  const asset = row.results[0]!;
  const adoption: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_assets asset JOIN event_private_payloads body
    ON body.private_event_id=asset.created_event_id AND body.owner_id=asset.owner_user_id AND body.document_id=asset.document_id
    WHERE asset.owner_user_id=? AND asset.document_id=? AND asset.asset_id=? AND asset.scope_key=? AND asset.created_event_id=?
      AND asset.storage_key=? AND asset.content_sha256=? AND asset.byte_length=? AND asset.source_digest=? AND asset.created_by_user_id=?
      AND asset.redacted_at IS NULL AND body.redacted_at IS NULL AND body.project_id=? AND ${origin("kind") }=?)`,
  bindings: [actor.userId,documentId,assetId,String(asset.scope_key),String(asset.created_event_id),String(asset.storage_key),String(asset.sha),Number(asset.byte_length),String(asset.source_digest),String(asset.creator),String(asset.project_id),String(asset.origin_kind)] };
  if (asset.origin_kind === "owned_upload" && asset.rights === asset.creator && id(asset.creator)) return Object.freeze({ kind: "ordinary" as const, assertion: {
    sql: `(${adoption.sql}) AND EXISTS(SELECT 1 FROM event_private_payloads body WHERE body.private_event_id=? AND ${origin("rightsAttestedBy") }=?)`,
    bindings: [...(adoption.bindings ?? []),String(asset.created_event_id),asset.creator] } });
  if (asset.origin_kind !== "native_job" || !id(asset.job_id) || !id(asset.completion_event) || !id(asset.slot_id)
    || !id(asset.project_id) || !id(asset.scope_key) || !id(asset.created_event_id) || typeof asset.storage_key !== "string"
    || !Number.isSafeInteger(asset.byte_length) || Number(asset.byte_length) <= 0 || typeof asset.sha !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha)
    || !id(asset.generation_id) || asset.origin_source !== asset.source_digest || !id(asset.target_digest)) return fail();
  const lineage: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM document_jobs job
    JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN events completed ON completed.event_id=slot.outcome_event_id AND completed.stream_id=job.stream_id AND completed.correlation_id=job.correlation_id
    WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.status='completed'
      AND slot.slot_id=? AND slot.scope_key=? AND slot.source_digest=? AND slot.target_contract_digest=? AND slot.status='succeeded'
      AND completed.event_id=? AND ((completed.type='GenerationCompleted' AND job.kind='generate') OR (completed.type='DocumentRenderCompleted' AND job.kind='render_document')) AND plan.owner_user_id=job.owner_id
      AND plan.document_id=job.document_id AND plan.project_id=? AND plan.scope_kind='personal')`,
  bindings: [asset.job_id,actor.userId,actor.streamId,documentId,asset.slot_id,asset.scope_key,String(asset.source_digest),asset.target_digest,asset.completion_event,asset.project_id] };
  if (!await control.wait(env.DB.prepare(`SELECT 1 WHERE ${lineage.sql}`).bind(...(lineage.bindings ?? [])).first())) return fail();
  adoption.sql += ` AND EXISTS(SELECT 1 FROM event_private_payloads body WHERE body.private_event_id=? AND body.owner_id=? AND body.document_id=? AND body.project_id=? AND body.redacted_at IS NULL
    AND ${origin("jobId") }=? AND ${origin("slotId") }=? AND ${origin("completionEventId") }=? AND ${origin("resultId") }=? AND ${origin("sourceDigest") }=? AND ${origin("targetContractDigest") }=?)`;
  adoption.bindings = [...(adoption.bindings ?? []),asset.created_event_id,actor.userId,documentId,asset.project_id,asset.job_id,asset.slot_id,asset.completion_event,asset.generation_id,String(asset.origin_source),asset.target_digest];
  // A coherent ordinary native result may be Slides/3D as well as Image. Its
  // valid authorization must positively lack sponsor authority; a damaged or
  // absent private marker cannot turn a native result into an ordinary one.
  const ordinary: OutputSqlAssertion = { sql: `NOT EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND ${predicate}) AND EXISTS(
    SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    JOIN event_private_payloads authorization ON authorization.private_event_id=grant_row.authorization_event_id
    WHERE slot.job_id=? AND slot.slot_id=? AND slot.scope_key=? AND authorization.owner_id=? AND authorization.document_id=? AND authorization.project_id=? AND authorization.redacted_at IS NULL
      AND CASE WHEN typeof(authorization.private_json)='text' AND length(CAST(authorization.private_json AS BLOB))<=131072 THEN CASE WHEN json_valid(authorization.private_json)
        THEN CASE WHEN json_type(authorization.private_json,'$.output_command_envelope.sponsor_entitlement') IS NULL THEN 1 ELSE 0 END ELSE 0 END ELSE 0 END=1)`,
  bindings: [asset.job_id,asset.job_id,asset.slot_id,asset.scope_key,actor.userId,documentId,asset.project_id] };
  if (await control.wait(env.DB.prepare(`SELECT 1 WHERE ${ordinary.sql}`).bind(...(ordinary.bindings ?? [])).first())) return Object.freeze({ kind: "ordinary" as const, assertion: {
    sql: `(${adoption.sql}) AND (${lineage.sql}) AND (${ordinary.sql})`,bindings: [...(adoption.bindings ?? []),...(lineage.bindings ?? []),...(ordinary.bindings ?? [])] } });
  const completion = await control.wait(env.DB.prepare(`SELECT ${publicScalar("object_id")} AS output_id,${publicScalar("generation_id")} AS generation_id FROM events event
    WHERE event.event_id=? AND event.stream_id=? AND event.type='GenerationCompleted'`).bind(asset.completion_event, actor.streamId).first<{ output_id: string; generation_id: string }>());
  if (!completion || !id(completion.output_id) || completion.generation_id !== asset.generation_id || !/^[A-Za-z0-9._-]{1,200}$/u.test(completion.generation_id)) return fail();
  const lookup = { mediaKey: `${ownerMediaNamespace(actor.userId)}/generated/${completion.generation_id}.png` };
  const context = await control.wait(beginSponsorNativeImageRead(request, env, actor, lookup));
  if (!context) return fail();
  const native = requireSponsorNativeImageRead(context, request, env, actor, lookup);
  if (native.jobId !== asset.job_id || native.sourceEventId !== asset.completion_event || native.outputId !== completion.output_id
    || native.documentId !== documentId || native.projectId !== asset.project_id || native.originalContentSha256 !== asset.sha) return fail();
  const budget = new SponsorNativeImageReadBudget(native.maximumBytes - native.usedBytes, Math.min(control.monotonicDeadline,native.monotonicDeadline), request.signal);
  // Reserve the bounded scalar metadata admission above in this same attempt.
  budget.spend(32_768);
  // The native disclosure evaluates every guard in one atomic DB.batch. Keep
  // independent guards as sibling statements instead of nesting their complete
  // authority trees, which exceeds D1's expression depth without adding proof.
  const assertions = freeze([{ sql: native.assertion.sql, bindings: [...native.assertion.bindings] },lineage,adoption]);
  const result = Object.freeze({ kind: "sponsored" as const, assetId, documentId, storageKey: asset.storage_key, byteLength: Number(asset.byte_length), budget, assertions });
  contexts.set(result,{request,env,db:env.DB,actor}); return result;
}
export function requireSponsorOutputAssetRead(context: SponsorOutputAssetRead, request: Request, env: WorkerEnv, actor: Actor): Facts {
  const state = contexts.get(context);
  if (!state || state.request !== request || state.env !== env || state.db !== env.DB || state.actor !== actor) return fail();
  context.budget.check(); contexts.delete(context); return context;
}
