import { exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { identifySponsorImageRead } from "./experience-sponsor-read-image.ts";
import { reserveSponsorImageReadAttempt, takeSponsorImageReadAttempt } from "./experience-sponsor-read-attempts.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { IMAGE_WITNESS_LIMITS } from "./generated-image-witness.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

type Actor = Pick<PilotUser, "userId" | "streamId" | "projectExecution">;
type Lookup = { outputId: string } | { mediaKey: string; ownerUserId?: string };
type Row = Record<string, unknown>;
type Assertion = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
type Facts = Readonly<{ actorUserId: string; jobId: string; outputId: string; sourceEventId: string; documentId: string; projectId: string;
  generationId: string; contentRef: string; originalMediaKey: string; originalMediaUrl: string; originalContentSha256: string; width: number; height: number; usedBytes: number;
  provider: "openai"; model: string; sourceSurface: "outputs"; operation: "image-result" | "image-media";
  maximumBytes: number; monotonicDeadline: number; deadlineAtMs: number; assertion: Assertion }>;
export type SponsorNativeImageRead = Facts;
const contexts = new WeakMap<SponsorNativeImageRead, { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; actor: Actor; lookup: string }>();
const fail = (code = "sponsor_native_read_unavailable"): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const boundedJson = (column: string, path: string, maximum: number, type = false) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum}
  THEN CASE WHEN json_valid(${column}) THEN ${type ? `COALESCE(json_type(${column},'$.${path}'),'absent')` : `json_extract(${column},'$.${path}')`} END END`;
const outputExpression = boundedJson("payload", "object_id", IMAGE_WITNESS_LIMITS.rowBodyBytes);
const generationExpression = boundedJson("payload", "generation_id", IMAGE_WITNESS_LIMITS.rowBodyBytes);
const revisionExpression = boundedJson("content_json", "imageRevision.media.url", IMAGE_WITNESS_LIMITS.revisionBodyBytes);

/** Dormant definitions only. No initializer or public approval path installs
 * these indexes. Missing/mismatched definitions fail closed for actors whose
 * existing native job history requires sponsored-resource classification. */
export const SPONSOR_NATIVE_IMAGE_READ_INDEXES = Object.freeze([
  { name: "idx_sponsor_image_output_lookup", sql: `CREATE INDEX idx_sponsor_image_output_lookup ON events(stream_id,${outputExpression}) WHERE type='GenerationCompleted'` },
  { name: "idx_sponsor_image_revision_media_lookup", sql: `CREATE INDEX idx_sponsor_image_revision_media_lookup ON artifact_revisions(owner_id,${revisionExpression})` },
  { name: "idx_sponsor_image_generation_lookup", sql: `CREATE INDEX idx_sponsor_image_generation_lookup ON events(stream_id,${generationExpression}) WHERE type='GenerationCompleted'` },
  { name: "idx_sponsor_image_actor_history", sql: "CREATE INDEX idx_sponsor_image_actor_history ON experience_sponsor_consumptions(actor_user_id,job_id)" },
].map(definition => Object.freeze(definition)));

class Lifetime {
  deadline = performance.now() + 30_000;
  async wait<T>(run: () => Promise<T>): Promise<T> {
    const remaining = Math.floor(this.deadline - performance.now());
    if (remaining <= 0) return fail("sponsor_native_read_deadline");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([run(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SponsorEntitlementError("sponsor_native_read_deadline")), remaining);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
const textCell = (column: string, alias: string, maximum = 240) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum} THEN ${column} END AS ${alias}`;
const publicCell = (field: string) => boundedJson("event.payload", field, IMAGE_WITNESS_LIMITS.rowBodyBytes);
const originCell = (field: string) => boundedJson("revision.content_json", `origin.${field}`, IMAGE_WITNESS_LIMITS.revisionBodyBytes);
const completionIds = `CASE WHEN typeof(job.result_json)='text' AND length(CAST(job.result_json AS BLOB))<=131072
  THEN CASE WHEN json_valid(job.result_json) THEN CASE WHEN json_type(job.result_json,'$.appendedEventIds')='array'
    AND length(CAST(json_extract(job.result_json,'$.appendedEventIds') AS BLOB))<=16384 THEN json_extract(job.result_json,'$.appendedEventIds') END END END`;
// A bounded control-metadata boolean only, never authored result content.
// Unknown/redacted authorization is -1 rather than a false ordinary proof.
const sponsorMarker = `COALESCE((SELECT CASE WHEN typeof(authorization.private_json)='text' AND length(CAST(authorization.private_json AS BLOB))<=131072
  THEN CASE WHEN json_valid(authorization.private_json) THEN CASE WHEN json_type(authorization.private_json,'$.output_command_envelope.sponsor_entitlement') IS NOT NULL THEN 1 ELSE 0 END ELSE -1 END ELSE -1 END
  FROM event_private_payloads authorization WHERE authorization.private_event_id=execution.authorization_event_id
    AND authorization.owner_id=plan.owner_user_id AND authorization.project_id=plan.project_id AND authorization.document_id=plan.document_id
    AND authorization.redacted_at IS NULL),-1)`;
const joinedColumns = [
  ...["job_id", "owner_id", "stream_id", "document_id", "correlation_id", "kind", "source_surface"].map(name => textCell(`job.${name}`, name)),
  textCell("slot.scope_key", "scope_key"), textCell("slot.slot_id", "slot_id"), textCell("slot.grant_id", "grant_id"),
  textCell("slot.provider", "provider"), textCell("slot.model", "model"),
  textCell("plan.project_id", "project_id"),
  textCell("plan.scope_kind", "scope_kind"), textCell("execution.context_id", "context_id"),
  textCell("execution.actor_user_id", "actor_user_id"), textCell("execution.payer_user_id", "payer_user_id"),
  textCell("event.event_id", "event_id"), textCell("event.stream_id", "event_stream"), textCell("event.correlation_id", "event_correlation"),
  textCell(publicCell("object_id"), "output_id"), textCell(publicCell("source_surface"), "event_surface"),
  `${boundedJson("event.payload", "source_surface", IMAGE_WITNESS_LIMITS.rowBodyBytes, true)} AS event_surface_type`,
  `${sponsorMarker} AS sponsor_marker`,
  textCell(publicCell("generation_id"), "generation_id"),
].join(",");
const eventJobs = `LEFT JOIN document_jobs job INDEXED BY idx_document_jobs_stream_correlation
  ON job.stream_id=event.stream_id AND job.correlation_id=event.correlation_id
  LEFT JOIN output_operation_slots slot ON slot.job_id=job.job_id
  LEFT JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
  LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id`;

async function all(env: WorkerEnv, life: Lifetime, sql: string, bindings: (string | number | null)[]) {
  const result = await life.wait(() => env.DB.prepare(sql).bind(...bindings).all<Row>());
  if (!result.success || result.results.length > 4) return fail();
  return result.results;
}
function lookupKey(raw: unknown, actorUserId: string): string {
  if (jsonIssues(raw).length || !record(raw)) return fail("sponsor_native_read_lookup_invalid");
  if (exactKeys(raw, ["outputId"]) && id(raw.outputId)) return JSON.stringify({ outputId: raw.outputId });
  if ((exactKeys(raw, ["mediaKey"]) || exactKeys(raw, ["mediaKey", "ownerUserId"])) && typeof raw.mediaKey === "string" && raw.mediaKey.length > 0
    && new TextEncoder().encode(raw.mediaKey).length <= 1024 && id(raw.ownerUserId ?? actorUserId))
    return JSON.stringify({ mediaKey: raw.mediaKey, ownerUserId: raw.ownerUserId ?? actorUserId });
  return fail("sponsor_native_read_lookup_invalid");
}

/** Resource classification and admission only. The native reader must still
 * prove current creative custody, exact origin/provider/model and requested
 * original/edited media membership, then compose this final assertion with its
 * own native disclosure proof. No R2 or authored result payload is transferred
 * before admission; only bounded authorization control metadata is inspected.
 *
 * An ordinary installation without sponsor state needs no dormant schemas or
 * indexes. Once any consumption exists, the actor-history index is an activation
 * prerequisite; absent configuration refuses uncertain classification, including
 * unrelated owners. Positive ordinary native proof can still return early.
 * With indexes installed, unrelated ordinary resources remain ordinary. */
export async function beginSponsorNativeImageRead(request: Request, env: WorkerEnv, actor: Actor, raw: Lookup): Promise<SponsorNativeImageRead | null> {
  const life = new Lifetime(), key = lookupKey(raw, actor.userId);
  const lookup = Object.freeze(JSON.parse(key) as Lookup);
  const ownerId = "mediaKey" in lookup ? lookup.ownerUserId! : actor.userId, streamId = `creative:${ownerId}`;
  if (request.method !== "GET") return fail("sponsor_native_read_get_required");
  if (!id(actor.userId) || !id(ownerId)) return fail();
  const base = await all(env, life, `SELECT name FROM sqlite_schema WHERE type='table' AND name IN('document_jobs','output_operation_slots','output_execution_grants') LIMIT 3`, []);
  // The initial app schema can predate Outputs entirely. A partial Outputs
  // schema cannot establish absence of distinct-payer jobs and is refused.
  const names = new Set(base.map(row => row.name));
  if (!names.has("output_operation_slots") && !names.has("output_execution_grants")) return null;
  if (names.size !== 3) return fail("sponsor_native_read_configuration");
  const stored = "mediaKey" in lookup ? await life.wait(() => env.DB.prepare(`SELECT ${textCell("job.owner_id", "owner_id")},${textCell("job.correlation_id", "correlation_id")},
      ${textCell("event.correlation_id", "event_correlation")},${textCell("execution.payer_user_id", "payer_user_id")},${textCell("stored.publication_event_id", "publication_event_id")},
      ${textCell("plan.scope_kind", "scope_kind")},${textCell("execution.context_id", "context_id")},${textCell("job.job_id", "job_id")},${sponsorMarker} AS sponsor_marker
      FROM output_native_storage_writes stored INDEXED BY idx_output_native_storage_writes_unique_1
      LEFT JOIN output_operation_slots slot ON slot.scope_key=stored.scope_key AND slot.slot_id=stored.slot_id
      LEFT JOIN document_jobs job ON job.job_id=slot.job_id
      LEFT JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
      LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      LEFT JOIN events event ON event.event_id=stored.publication_event_id WHERE stored.storage_key=?`)
    .bind((lookup as { mediaKey: string }).mediaKey).first<Row>()) : null;
  const consumptionSchema = await life.wait(() => env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='experience_sponsor_consumptions'").first());
  const storedConsumed = stored && id(stored.job_id) && consumptionSchema
    ? await life.wait(() => env.DB.prepare("SELECT 1 FROM experience_sponsor_consumptions WHERE job_id=?").bind(stored.job_id).first()) : null;
  // Cross-account project editors and managed billing are existing ordinary
  // native contexts. A distinct payer alone never identifies sponsorship.
  if (stored && !storedConsumed && stored.sponsor_marker === 0 && id(stored.job_id)
    && id(stored.publication_event_id) && stored.correlation_id === stored.event_correlation) return null;
  const suspiciousOriginal = stored && (storedConsumed || stored.sponsor_marker !== 0 || stored.owner_id !== ownerId
    || !id(stored.publication_event_id) || stored.correlation_id !== stored.event_correlation);
  let consumed: unknown = null;
  if (consumptionSchema) {
    const nonempty = await life.wait(() => env.DB.prepare("SELECT 1 FROM experience_sponsor_consumptions LIMIT 1").first());
    if (nonempty) {
      const definition = await life.wait(() => env.DB.prepare("SELECT CASE WHEN length(CAST(sql AS BLOB))<=4096 THEN sql END AS sql FROM sqlite_schema WHERE name='idx_sponsor_image_actor_history' AND type='index'").first<{ sql: string }>());
      if (definition?.sql !== SPONSOR_NATIVE_IMAGE_READ_INDEXES[3]!.sql) return fail("sponsor_native_read_configuration");
      consumed = await life.wait(() => env.DB.prepare("SELECT 1 FROM experience_sponsor_consumptions INDEXED BY idx_sponsor_image_actor_history WHERE actor_user_id=? LIMIT 1").bind(ownerId).first());
    }
  }
  // Legacy jobs can use the caller-supplied Outputs surface without native
  // slots or grants. Missing joins alone are not evidence of sponsorship;
  // immutable consumption above preserves damaged sponsored history.
  const history = consumed || suspiciousOriginal ? null : await life.wait(() => env.DB.prepare(`WITH owner_jobs AS MATERIALIZED (
      SELECT ${textCell("job_id", "job_id", 200)},owner_id,${textCell("kind", "kind", 32)},${textCell("source_surface", "source_surface", 32)}
      FROM document_jobs INDEXED BY idx_document_jobs_owner_status
      WHERE owner_id=? AND stream_id=? LIMIT ${IMAGE_WITNESS_LIMITS.events + 1})
    SELECT (SELECT COUNT(*) FROM owner_jobs) AS count,COALESCE(MAX(CASE WHEN job.kind='generate' AND job.source_surface='outputs'
      AND plan.scope_kind='personal' AND execution.context_id IS NULL AND execution.payer_user_id<>job.owner_id AND ${sponsorMarker}<>0
      THEN 1 ELSE 0 END),0) AS present FROM owner_jobs job
    LEFT JOIN output_operation_slots slot ON slot.job_id=job.job_id
    LEFT JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
    LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id`)
    .bind(ownerId, streamId).first<{ count: number; present: number }>());
  if (history && history.count > IMAGE_WITNESS_LIMITS.events) return fail("sponsor_native_read_history_capacity");
  if (!history?.present && !suspiciousOriginal && !consumed) return null;
  const definitions = await all(env, life, `SELECT name,CASE WHEN length(CAST(sql AS BLOB))<=4096 THEN sql END AS sql
    FROM sqlite_schema WHERE type='index' AND name IN(?,?,?,?) LIMIT 4`, SPONSOR_NATIVE_IMAGE_READ_INDEXES.map(item => item.name));
  if (SPONSOR_NATIVE_IMAGE_READ_INDEXES.some(expected => !definitions.some(found => found.name === expected.name && found.sql === expected.sql)))
    return fail("sponsor_native_read_configuration");

  let rows: Row[], candidateAssertion: Assertion;
  if ("outputId" in lookup) {
    const sql = `SELECT ${joinedColumns} FROM events event INDEXED BY idx_sponsor_image_output_lookup ${eventJobs}
      WHERE event.stream_id=? AND event.type='GenerationCompleted' AND ${outputExpression.replaceAll("payload", "event.payload") }=? LIMIT 2`;
    rows = await all(env, life, sql, [streamId, lookup.outputId]);
    candidateAssertion = { sql: `EXISTS(SELECT 1 FROM events event INDEXED BY idx_sponsor_image_output_lookup
      WHERE event.stream_id=? AND event.type='GenerationCompleted' AND ${outputExpression.replaceAll("payload", "event.payload")}=? AND event.event_id=?)`, bindings: [streamId, lookup.outputId] };
  } else {
    const original = await all(env, life, `SELECT ${joinedColumns},'original' AS representation,
      ${textCell("stored.storage_key", "storage_key", 1024)},${textCell("stored.publication_event_id", "publication_event_id")},
      ${textCell("stored.status", "storage_status")},stored.write_acknowledged
      FROM output_native_storage_writes stored INDEXED BY idx_output_native_storage_writes_unique_1
      LEFT JOIN output_operation_slots slot ON slot.scope_key=stored.scope_key AND slot.slot_id=stored.slot_id
      LEFT JOIN document_jobs job ON job.job_id=slot.job_id
      LEFT JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
      LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      LEFT JOIN events event ON event.event_id=stored.publication_event_id WHERE stored.storage_key=? LIMIT 2`, [lookup.mediaKey]);
    const mediaUrl = `/api/media/${encodeURIComponent(lookup.mediaKey)}`;
    const edited = await all(env, life, `SELECT ${joinedColumns},'edited' AS representation,
      ${textCell("revision.revision_id", "revision_id")},${textCell("revision.content_sha256", "revision_sha")},
      ${textCell(originCell("outputId"), "revision_output")},${textCell(originCell("sourceEventId"), "revision_origin")}
      FROM artifact_revisions revision INDEXED BY idx_sponsor_image_revision_media_lookup
      LEFT JOIN events event ON event.event_id=${originCell("sourceEventId")} ${eventJobs}
      WHERE revision.owner_id=? AND ${revisionExpression.replaceAll("content_json", "revision.content_json")}=? LIMIT 2`, [ownerId, mediaUrl]);
    rows = [...original, ...edited];
    const generationPrefix = `${ownerMediaNamespace(ownerId)}/generated/`;
    const generationId = lookup.mediaKey.startsWith(generationPrefix) && lookup.mediaKey.endsWith(".png") ? lookup.mediaKey.slice(generationPrefix.length, -4) : "";
    if (!rows.length && /^[A-Za-z0-9._-]{1,200}$/u.test(generationId)) {
      rows = await all(env, life, `SELECT ${joinedColumns},'generation' AS representation FROM events event INDEXED BY idx_sponsor_image_generation_lookup ${eventJobs}
        WHERE event.stream_id=? AND event.type='GenerationCompleted' AND ${generationExpression.replaceAll("payload", "event.payload")}=? LIMIT 2`, [streamId, generationId]);
    }
    const candidate = rows[0];
    candidateAssertion = candidate?.representation === "original" ? {
      sql: `EXISTS(SELECT 1 FROM output_native_storage_writes WHERE storage_key=? AND scope_key=? AND slot_id=?
        AND publication_event_id=? AND status='written' AND write_acknowledged=1)`, bindings: [lookup.mediaKey],
    } : candidate?.representation === "generation" ? {
      sql: `EXISTS(SELECT 1 FROM events event INDEXED BY idx_sponsor_image_generation_lookup
        WHERE event.stream_id=? AND event.type='GenerationCompleted' AND ${generationExpression.replaceAll("payload", "event.payload")}=? AND event.event_id=?)`,
      bindings: [streamId, generationId],
    } : { sql: `EXISTS(SELECT 1 FROM artifact_revisions revision WHERE revision_id=? AND owner_id=? AND content_sha256=?
        AND ${revisionExpression.replaceAll("content_json", "revision.content_json")}=? AND ${originCell("sourceEventId") }=? AND ${originCell("outputId") }=?)`,
    bindings: [String(candidate?.revision_id ?? ""), ownerId, String(candidate?.revision_sha ?? ""), mediaUrl] };
  }
  if (!rows.length) {
    if ("outputId" in lookup) return fail();
    if ("mediaKey" in lookup && lookup.mediaKey.startsWith(`${ownerMediaNamespace(ownerId)}/generated/`) && lookup.mediaKey.endsWith(".png")) return fail();
    return null;
  }
  if (rows.length !== 1) return fail();
  const candidate = rows[0]!;
  if (candidate.representation === "edited" && (!id(candidate.revision_origin) || !id(candidate.revision_output)
    || candidate.revision_origin !== candidate.event_id || candidate.revision_output !== candidate.output_id)) return fail();
  if (!id(candidate.event_id) || !id(candidate.output_id) || candidate.event_stream !== streamId || !id(candidate.event_correlation)
    || candidate.representation === "original" && (candidate.storage_status !== "written" || candidate.write_acknowledged !== 1 || candidate.publication_event_id !== candidate.event_id)) return fail();
  // Legacy ordinary Images can have no Document Job. Native Outputs candidates
  // cannot lose their slot/grant and silently become ordinary.
  const legacyCompletion = candidate.event_surface_type === "absent" || candidate.event_surface_type === "null"
    || id(candidate.event_surface) && candidate.event_surface !== "outputs";
  if (candidate.job_id === null && legacyCompletion && candidate.representation !== "original") return null;
  const sponsored = consumptionSchema && id(candidate.job_id) ? await life.wait(() => env.DB.prepare("SELECT 1 FROM experience_sponsor_consumptions WHERE job_id=?").bind(candidate.job_id).first()) : null;
  if (!sponsored && candidate.sponsor_marker === 0 && id(candidate.job_id) && candidate.correlation_id === candidate.event_correlation) return null;
  if (!id(candidate.job_id) || candidate.owner_id !== ownerId || candidate.stream_id !== streamId || candidate.correlation_id !== candidate.event_correlation) return fail();
  // Legacy callers can label both job and completion as Outputs. Exact absence
  // of sponsor/native lineage preserves such unslotted jobs even when this
  // owner also has sponsored jobs; a surface label alone is not sponsorship.
  if (!sponsored && (legacyCompletion || id(candidate.event_surface)) && candidate.slot_id === null && candidate.grant_id === null
    && candidate.scope_key === null && candidate.sponsor_marker !== 1 && candidate.representation !== "original") return null;
  if (!sponsored && (candidate.scope_kind === "project" || candidate.context_id !== null)) return null;
  if (!id(candidate.actor_user_id) || candidate.actor_user_id !== ownerId || !id(candidate.payer_user_id)
    || !id(candidate.scope_key) || !id(candidate.slot_id) || !id(candidate.grant_id)) return fail();
  if (candidate.payer_user_id === ownerId) {
    if (!sponsored) return null;
  }
  const authority = await life.wait(() => identifySponsorImageRead(request, env, { jobId: candidate.job_id }));
  const operation: "image-result" | "image-media" = "outputId" in lookup ? "image-result" : "image-media";
  const attempt = await life.wait(() => reserveSponsorImageReadAttempt(authority, request, env, operation));
  const ticket = await life.wait(() => takeSponsorImageReadAttempt(attempt, authority, request, env));
  life.deadline = Math.min(life.deadline, ticket.monotonicDeadline);
  if (!id(candidate.event_id) || !id(candidate.output_id) || !id(candidate.document_id) || !id(candidate.project_id) || !id(candidate.correlation_id)
    || candidate.owner_id !== actor.userId || candidate.event_stream !== actor.streamId || candidate.event_correlation !== candidate.correlation_id
    || candidate.kind !== "generate" || candidate.source_surface !== "outputs" || candidate.event_surface !== "outputs"
    || candidate.provider !== "openai" || !id(candidate.model) || typeof candidate.generation_id !== "string" || !/^[A-Za-z0-9._-]{1,200}$/u.test(candidate.generation_id)
    || candidate.representation === "original" && (candidate.storage_status !== "written" || candidate.write_acknowledged !== 1 || candidate.publication_event_id !== candidate.event_id)
    || candidate.representation === "edited" && (candidate.revision_origin !== candidate.event_id || candidate.revision_output !== candidate.output_id)) return fail();
  // Reserve bounded post-admission control responses before dispatch. Parent
  // native readers start at this usedBytes ceiling, never a fresh full budget.
  const usedBytes = 65_536 + 16_384 + 16_384 + 16_384 + 1024;
  if (usedBytes > ticket.maximumBytes) return fail("sponsor_native_read_bytes");
  // output_ref is private in the actual event privacy contract. Extract only
  // this bounded scalar after admission; never claim a public immutable ref.
  const content = await life.wait(() => env.DB.prepare(`SELECT CASE WHEN typeof(private_json)='text' AND length(CAST(private_json AS BLOB))<=131072
      THEN CASE WHEN json_valid(private_json) THEN CASE WHEN typeof(json_extract(private_json,'$.output_ref'))='text' AND length(CAST(json_extract(private_json,'$.output_ref') AS BLOB))<=200
        THEN json_extract(private_json,'$.output_ref') END END END AS content_ref FROM event_private_payloads
    WHERE private_event_id=? AND owner_id=? AND document_id=? AND (project_id IS NULL OR project_id=?) AND redacted_at IS NULL`)
    .bind(candidate.event_id, actor.userId, candidate.document_id, candidate.project_id).first<{ content_ref: string | null }>());
  if (!content || !id(content.content_ref)) return fail();
  const completed = await life.wait(() => env.DB.prepare(`SELECT ${completionIds} AS completion_ids
    FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
    WHERE job.job_id=? AND job.owner_id=? AND job.status='completed' AND slot.status='succeeded' AND execution.status='completed'
      AND slot.outcome_event_id=? AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id
        AND (calls.status IN('pending','uncertain') OR calls.used_microusd IS NULL))`)
    .bind(candidate.job_id, actor.userId, candidate.event_id).first<{ completion_ids: string | null }>());
  if (!completed?.completion_ids || !(JSON.parse(completed.completion_ids) as unknown[]).includes(candidate.event_id)) return fail();
  const originalMediaKey = `${ownerMediaNamespace(ownerId)}/generated/${candidate.generation_id}.png`;
  const original = await life.wait(() => env.DB.prepare(`SELECT ${textCell("content_sha256", "sha", 64)} FROM output_native_storage_writes
    WHERE storage_key=? AND scope_key=? AND slot_id=? AND publication_event_id=? AND status='written' AND write_acknowledged=1`)
    .bind(originalMediaKey, candidate.scope_key, candidate.slot_id, candidate.event_id).first<{ sha: string | null }>());
  if (!original?.sha || !/^[a-f0-9]{64}$/u.test(original.sha)) return fail();
  const dimensions = await life.wait(() => env.DB.prepare(`SELECT
    CASE WHEN typeof(issuance.envelope_json)='text' AND length(CAST(issuance.envelope_json AS BLOB))<=131072
      THEN CASE WHEN json_valid(issuance.envelope_json) THEN CASE WHEN json_type(issuance.envelope_json,'$.recipe.width')='integer'
        THEN json_extract(issuance.envelope_json,'$.recipe.width') END END END AS width,
    CASE WHEN typeof(issuance.envelope_json)='text' AND length(CAST(issuance.envelope_json AS BLOB))<=131072
      THEN CASE WHEN json_valid(issuance.envelope_json) THEN CASE WHEN json_type(issuance.envelope_json,'$.recipe.height')='integer'
        THEN json_extract(issuance.envelope_json,'$.recipe.height') END END END AS height
    FROM experience_sponsor_consumptions used JOIN experience_sponsor_issuances issuance ON issuance.grant_id=used.grant_id WHERE used.job_id=?`)
    .bind(candidate.job_id).first<{ width: number | null; height: number | null }>());
  if (!dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)
    || Number(dimensions.width) < 1 || Number(dimensions.width) > 16_384 || Number(dimensions.height) < 1 || Number(dimensions.height) > 16_384) return fail();
  const linkBindings = "outputId" in lookup ? [...candidateAssertion.bindings, candidate.event_id]
    : candidate.representation === "generation" ? [...candidateAssertion.bindings, candidate.event_id]
    : candidate.representation === "original" ? [...candidateAssertion.bindings, candidate.scope_key, candidate.slot_id, candidate.event_id]
    : [...candidateAssertion.bindings, candidate.event_id, candidate.output_id];
  const assertion = freeze({ sql: `(${ticket.assertion.sql}) AND (${candidateAssertion.sql}) AND EXISTS(
    SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN events event ON event.event_id=slot.outcome_event_id
    WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=? AND job.status='completed'
      AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.status='succeeded' AND slot.provider='openai' AND slot.model=?
      AND execution.status='completed' AND event.event_id=? AND event.stream_id=job.stream_id AND event.correlation_id=job.correlation_id
      AND plan.project_id=? AND event.type='GenerationCompleted' AND ${publicCell("object_id") }=? AND ${publicCell("source_surface") }='outputs'
      AND ${publicCell("generation_id") }=? AND EXISTS(SELECT 1 FROM event_private_payloads private
        WHERE private.private_event_id=event.event_id AND private.owner_id=job.owner_id AND private.document_id=job.document_id
          AND (private.project_id IS NULL OR private.project_id=plan.project_id) AND private.redacted_at IS NULL
          AND ${boundedJson("private.private_json", "output_ref", 131072)}=?)
      AND EXISTS(SELECT 1 FROM output_native_storage_writes WHERE storage_key=? AND scope_key=slot.scope_key AND slot_id=slot.slot_id
        AND publication_event_id=event.event_id AND status='written' AND write_acknowledged=1 AND content_sha256=?)
      AND ${completionIds}=?
      AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id
        AND (calls.status IN('pending','uncertain') OR calls.used_microusd IS NULL)))`,
  bindings: [...ticket.assertion.bindings, ...linkBindings, candidate.job_id, actor.userId, actor.streamId, candidate.document_id,
    candidate.correlation_id, candidate.scope_key, candidate.slot_id, candidate.grant_id, candidate.model, candidate.event_id, candidate.project_id,
    candidate.output_id, candidate.generation_id, content.content_ref, originalMediaKey, original.sha, completed.completion_ids] as (string | number | null)[] });
  const checked = await life.wait(() => env.DB.prepare(`SELECT 1 AS present WHERE ${assertion.sql}`).bind(...assertion.bindings).first());
  if (!checked) return fail();
  const context: SponsorNativeImageRead = freeze({ actorUserId: actor.userId, jobId: candidate.job_id, outputId: candidate.output_id, sourceEventId: candidate.event_id,
    documentId: candidate.document_id, projectId: candidate.project_id, generationId: candidate.generation_id, contentRef: content.content_ref,
    originalMediaKey, originalMediaUrl: `/api/media/${encodeURIComponent(originalMediaKey)}`, originalContentSha256: original.sha,
    width: Number(dimensions.width), height: Number(dimensions.height), usedBytes,
    provider: "openai" as const, model: candidate.model, sourceSurface: "outputs" as const,
    operation, maximumBytes: ticket.maximumBytes, monotonicDeadline: life.deadline, deadlineAtMs: ticket.deadlineAtMs, assertion });
  contexts.set(context, { request, env, db: env.DB, actor, lookup: key });
  return context;
}

export function requireSponsorNativeImageRead(context: SponsorNativeImageRead, request: Request, env: WorkerEnv, actor: Actor, lookup: Lookup): Facts {
  const state = contexts.get(context);
  if (!state || state.request !== request || state.env !== env || state.db !== env.DB || state.actor !== actor || state.lookup !== lookupKey(lookup, actor.userId)
    || actor.userId !== context.actorUserId || actor.streamId !== `creative:${context.actorUserId}` || actor.projectExecution
    || performance.now() >= context.monotonicDeadline) return fail("sponsor_native_read_context_unavailable");
  contexts.delete(context);
  return context;
}
