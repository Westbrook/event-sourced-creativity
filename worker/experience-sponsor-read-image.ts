import { canonicalJson, exactKeys, jsonIssues, record } from "../src/experiences/compiler.ts";
import { createCreativeEventFold, type CreativeEvent } from "../src/model/events.ts";
import { originalGeneratedImageUrl } from "../src/model/generated-image-original-url.ts";
import { GENERATED_IMAGE_EDIT_LIMITS } from "../src/model/generated-image-edit.ts";
import { createImageEventConsumer } from "./generated-image-event-consumer.ts";
import { readImageWitness, imageWitnessStatement, imageWitnessAcknowledged, type ImageWitnessGuard } from "./generated-image-witness.ts";
import { compileSponsorEnvelope, SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { sponsorIssuedAuthorityAssertion } from "./experience-sponsor-approval.ts";
import { takeSponsorImageReadAttempt, type SponsorImageReadAttempt } from "./experience-sponsor-read-attempts.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { serializeEvent, type WorkerEnv } from "./runtime.ts";

type Row = Record<string, unknown>;
type Assertion = { sql: string; bindings: (string | number | null)[] };
function fail(code: string): never { throw new SponsorEntitlementError(code); }
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const boundedJson = (v: unknown): v is string => typeof v === "string" && new TextEncoder().encode(v).byteLength <= 131_072;
const columns = ["user_id", "email", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const lineageCells = ["job.document_id", "job.stream_id", "job.correlation_id", "plan.project_id", "plan.source_digest", "slot.scope_key", "slot.slot_id",
  "slot.route_digest", "slot.model", "execution.grant_id", "execution.payer_user_id", "used.consumption_id", "used.campaign_id", "used.envelope_digest",
  "used.session_digest", "used.intent_key", "issued.grant_id", "issued.policy_digest"];
const databaseNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
declare const resourceAuthority: unique symbol;
/** Resource admission only. This opaque value never authorizes creative bytes. */
export type SponsorImageReadAuthority = Readonly<{ [resourceAuthority]: true }>;
type State = { request: Request; env: WorkerEnv; database: WorkerEnv["DB"]; actorUserId: string; campaignId: string; jobId: string;
  policyDigest: string; projectId: string; documentId: string; streamId: string; correlationId: string; model: string; width: number; height: number; assertions: Assertion[] };
const authorities = new WeakMap<SponsorImageReadAuthority, State>();

// Indexed, one-job lineage. No stream replay, private output, R2 object or
// monetary reservation is read to decide whether a request must be counted.
const ORIGINAL_FROM = `FROM document_jobs job
 JOIN output_operation_slots slot ON slot.job_id=job.job_id
 JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN experience_sponsor_consumptions used ON used.job_id=job.job_id AND used.actor_user_id=job.owner_id
 JOIN experience_sponsor_grants issued ON issued.grant_id=used.grant_id AND issued.campaign_id=used.campaign_id
 JOIN experience_sponsor_issuances issuance ON issuance.grant_id=issued.grant_id AND issuance.campaign_id=issued.campaign_id
 JOIN experience_sponsor_approvals approval ON approval.campaign_id=issued.campaign_id AND approval.policy_digest=issued.policy_digest
 WHERE job.job_id=? AND job.owner_id=? AND job.stream_id='creative:'||job.owner_id
 AND job.kind='generate' AND job.source_surface='outputs'
 AND plan.scope_kind='personal' AND plan.owner_user_id=job.owner_id AND plan.document_id=job.document_id
 AND execution.actor_user_id=job.owner_id AND execution.payer_user_id<>job.owner_id AND execution.context_id IS NULL
 AND execution.plan_revision_id=slot.plan_revision_id AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
 AND slot.source_digest=plan.source_digest
 AND slot.provider='openai' AND slot.maximum_calls=2 AND execution.maximum_calls=2
 AND (SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1
 AND issued.actor_user_id=used.actor_user_id AND issued.intent_key=used.intent_key AND issued.session_digest=used.session_digest
 AND issued.envelope_digest=used.envelope_digest AND issuance.actor_user_id=used.actor_user_id AND issuance.intent_key=used.intent_key
 AND issuance.envelope_digest=used.envelope_digest AND issuance.policy_digest=issued.policy_digest
 AND approval.payer_user_id=execution.payer_user_id AND approval.approved_by_user_id=approval.payer_user_id
 AND slot.maximum_microusd=used.maximum_microusd AND execution.maximum_microusd=slot.maximum_microusd
 AND ${lineageCells.map(cell => `(typeof(${cell})='text' AND length(CAST(${cell} AS BLOB))<=4096)`).join(" AND ")}
 AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=plan.project_id)
 AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='document' AND resource_id=job.document_id)
   OR (resource_kind='job' AND resource_id=job.job_id))`;

async function assertCurrent(env: WorkerEnv, assertions: Assertion[]) {
  const result = await env.DB.batch<Row>(assertions.map(a => imageWitnessStatement(env, a)));
  if (!imageWitnessAcknowledged(result, assertions.length)) fail("sponsor_read_authority_changed");
}

/** Dormant first stage. The caller supplies only a lookup job ID. Historical
 * issuer/consumption equality identifies the resource payer; it is not current
 * creative custody. In particular, no result/media tuple is returned here. */
export async function identifySponsorImageRead(request: Request, env: WorkerEnv, raw: unknown): Promise<SponsorImageReadAuthority> {
  if (request.method !== "GET" || jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["jobId"]) || !id(raw.jobId)) fail("sponsor_read_request_invalid");
  // This increment supports the original canonical personal beta only.
  if (env.FORMA_PILOT_COHORT_ID?.trim() || /(?:^|;)\s*forma_project_context=/u.test(request.headers.get("cookie") ?? "")) fail("sponsor_read_personal_principal_required");
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if ("kind" in auth || auth.response || !auth.user || auth.user.fictional || auth.user.projectExecution
    || auth.user.billingUserId && auth.user.billingUserId !== auth.user.userId || auth.user.consentVersion !== POLICY_VERSION) fail("sponsor_read_personal_principal_required");
  const actor = auth.user!;
  const row = await env.DB.prepare(`SELECT job.document_id,job.stream_id,job.correlation_id,plan.project_id,plan.source_digest,plan.source_head,slot.scope_key,slot.slot_id,
    slot.route_digest,slot.model,slot.maximum_tokens,slot.maximum_microusd,execution.grant_id AS execution_grant_id,execution.payer_user_id,
    used.consumption_id,used.campaign_id,used.envelope_digest,used.session_digest,used.intent_key,issued.grant_id AS issued_grant_id,issued.policy_digest,
    CASE WHEN length(CAST(issuance.envelope_json AS BLOB))<=131072 THEN issuance.envelope_json END AS envelope_json,
    CASE WHEN length(CAST(approval.policy_json AS BLOB))<=131072 THEN approval.policy_json END AS policy_json
    ${ORIGINAL_FROM} LIMIT 2`).bind(raw.jobId, actor.userId).all<Row>();
  if (!row.success || row.results.length !== 1) fail("sponsor_read_original_unavailable");
  const original = row.results[0]!;
  if (!boundedJson(original.envelope_json) || !boundedJson(original.policy_json)) fail("sponsor_read_original_unavailable");
  const compiled = await compileSponsorEnvelope(JSON.parse(original.policy_json), JSON.parse(original.envelope_json));
  const e = compiled.envelope, recipe = e.recipe;
  if (compiled.policy.version !== 2 || compiled.policyDigest !== original.policy_digest || compiled.envelopeDigest !== original.envelope_digest
    || e.actorUserId !== actor.userId || e.ownerUserId !== actor.userId || e.campaignId !== original.campaign_id
    || e.consumptionId !== original.consumption_id || e.sessionDigest !== original.session_digest || e.intentKey !== original.intent_key
    || e.payerUserId !== original.payer_user_id || e.projectId !== original.project_id || e.documentId !== original.document_id
    || e.sourceDigest !== `sha256:${original.source_digest}` || e.sourceRevision !== original.source_head
    || recipe.appId !== "image" || recipe.outputKind !== "image" || recipe.outputCount !== 1 || recipe.provider !== "openai"
    || recipe.model !== original.model || recipe.routeDigest !== `sha256:${original.route_digest}`
    || recipe.maximumTokens !== original.maximum_tokens || recipe.maximumMicrousd !== original.maximum_microusd
    || recipe.calls.parsing !== 0 || recipe.calls.planning !== 1 || recipe.calls.render !== 1 || recipe.calls.repair !== 0) fail("sponsor_read_original_changed");
  const principal = await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(actor.userId).first<Row>();
  const snapshot = actor.authorizationSnapshot;
  if (!principal || !snapshot || principal.user_id !== actor.userId || principal.email !== actor.email || principal.role !== actor.role
    || principal.consent_version !== POLICY_VERSION || principal.updated_at !== snapshot.updatedAt
    || String(principal.permission_epoch ?? "") !== snapshot.rawEpoch || String(principal.grants_json ?? "[]") !== snapshot.grants
    || String(principal.organizations_json ?? "[]") !== snapshot.organizations || String(principal.projects_json ?? "[]") !== snapshot.projects
    || String(principal.identity_policies_json ?? "[]") !== snapshot.identityPolicies
    || Number(principal.approved_canvas_requirements ?? 0) !== snapshot.canvasRequirements) fail("sponsor_read_principal_changed");
  const principalJson = JSON.stringify(columns.map(key => principal[key] ?? null));
  const assertions: Assertion[] = [
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) current WHERE json_array(${columns.map(c => `current.${c}`).join(",")})=?)`, bindings: [actor.userId, principalJson] },
    { sql: `EXISTS(SELECT 1 ${ORIGINAL_FROM} AND job.document_id=? AND job.stream_id=? AND job.correlation_id=? AND plan.project_id=?
      AND slot.scope_key=? AND slot.slot_id=? AND execution.grant_id=? AND issued.grant_id=? AND used.consumption_id=? AND used.campaign_id=?
      AND issued.policy_digest=? AND issuance.envelope_json=? AND approval.policy_json=?
      AND slot.route_digest=? AND slot.model=? AND slot.maximum_tokens=? AND slot.maximum_microusd=? AND execution.payer_user_id=?
      AND plan.source_digest=? AND plan.source_head=?)`,
    bindings: [raw.jobId, actor.userId, e.documentId, String(original.stream_id), String(original.correlation_id), e.projectId,
      String(original.scope_key), String(original.slot_id), String(original.execution_grant_id), String(original.issued_grant_id), e.consumptionId, e.campaignId,
      compiled.policyDigest, String(original.envelope_json), String(original.policy_json), String(original.route_digest), recipe.model,
      recipe.maximumTokens, recipe.maximumMicrousd, e.payerUserId, String(original.source_digest), e.sourceRevision] },
  ];
  const issued = await sponsorIssuedAuthorityAssertion({ policy: compiled.policy, policyDigest: compiled.policyDigest,
    grantId: String(original.issued_grant_id), actorUserId: actor.userId, sessionDigest: e.sessionDigest, intentKey: e.intentKey, envelopeDigest: compiled.envelopeDigest });
  assertions.push({ sql: issued.sql, bindings: [...(issued.bindings ?? [])] });
  await assertCurrent(env, assertions);
  const authority = Object.freeze({}) as SponsorImageReadAuthority;
  authorities.set(authority, { request, env, database: env.DB, actorUserId: actor.userId, campaignId: e.campaignId, jobId: raw.jobId,
    policyDigest: compiled.policyDigest, projectId: e.projectId, documentId: e.documentId, streamId: String(original.stream_id), correlationId: String(original.correlation_id),
    model: recipe.model, width: recipe.width, height: recipe.height, assertions });
  return authority;
}

export function requireSponsorImageReadAuthority(authority: SponsorImageReadAuthority, request: Request, env: WorkerEnv) {
  const state = authorities.get(authority);
  if (!state || state.request !== request || state.env !== env || state.database !== env.DB) return fail("sponsor_read_authority_unavailable");
  return { actorUserId: state.actorUserId, campaignId: state.campaignId, jobId: state.jobId, policyDigest: state.policyDigest, assertions: structuredClone(state.assertions) };
}

class ReadLifetime {
  count = 0;
  usedBytes = 0;
  cutoff: number;
  maximumBytes: number;
  constructor(monotonicDeadline: number, maximumBytes: number) { this.cutoff = monotonicDeadline; this.maximumBytes = maximumBytes; }
  check() { if (performance.now() >= this.cutoff) fail("sponsor_read_deadline"); }
  sql(count: number) { this.check(); this.count += count; if (this.count > 900) fail("sponsor_read_query_capacity"); }
  account(value: unknown) { this.usedBytes += new TextEncoder().encode(JSON.stringify(value)).byteLength; if (this.usedBytes > this.maximumBytes) fail("sponsor_read_byte_capacity"); }
  expect(bytes: number) { this.check(); if (this.usedBytes + bytes > this.maximumBytes) fail("sponsor_read_byte_capacity"); }
  run<T>(maximumBytes: number, work: () => Promise<T>) { this.expect(maximumBytes); return this.wait(work()); }
  async wait<T>(work: Promise<T>): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SponsorEntitlementError("sponsor_read_deadline")), Math.max(1, this.cutoff - performance.now())); })]);
      this.check(); this.account(value); return value;
    } finally { clearTimeout(timer); }
  }
}

/** Closed adapter for the existing Image witness's bounded query families.
 * Reserve worst-case returned JSON bytes BEFORE dispatch. Actual returned bytes
 * are counted by life.wait, including prefetched pages the witness discards.
 * A changed/unknown native query is refused rather than assigned a zero cost. */
function witnessDatabase(env: WorkerEnv, life: ReadLifetime): Pick<WorkerEnv, "DB"> {
  const statements = new WeakMap<D1PreparedStatement, { original: D1PreparedStatement; maximumBytes: number }>();
  const maximumFor = (sql: string): number => {
    if (sql.includes("page AS MATERIALIZED") && sql.includes("used<=512000")) return 3_200_000;
    if (sql.includes("AS count,COALESCE(MAX(sequence),0) AS head")) return 4_096;
    if (sql.includes("AS revision_id,length(CAST(content_json AS BLOB)) AS body_bytes")) return 524_288;
    if (sql.includes("AS witness FROM artifact_revisions")) return 4_800_000;
    if (sql.startsWith("SELECT CASE WHEN (") && sql.endsWith(" END AS current")) return 1_024;
    if (sql.startsWith("SELECT instance_nonce,generation AS epoch,")) return 4_096;
    return fail("sponsor_read_witness_query_unbounded");
  };
  const wrap = (original: D1PreparedStatement, maximumBytes: number): D1PreparedStatement => {
    const statement = { bind(...values: unknown[]) { return wrap(original.bind(...values), maximumBytes); } } as D1PreparedStatement;
    statements.set(statement, { original, maximumBytes }); return statement;
  };
  const DB = { prepare(sql: string) {
    const maximumBytes = maximumFor(sql);
    // SQLite affinity is not a type constraint. Bound malformed retained scalar
    // cells before they cross the DB boundary; native validation still refuses
    // the absent/noninteger witness. Valid native queries keep their semantics.
    if (sql.includes("AS count,COALESCE(MAX(sequence),0) AS head")) sql = sql.replace("COALESCE(MAX(sequence),0) AS head",
      "CASE WHEN typeof(COALESCE(MAX(sequence),0))='integer' THEN COALESCE(MAX(sequence),0) END AS head");
    if (sql.includes("AS witness FROM artifact_revisions")) sql += " AND typeof(revision)='integer' AND revision>=0";
    return wrap(env.DB.prepare(sql), maximumBytes);
  },
    async batch<T>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const captured = items.map(item => statements.get(item) ?? fail("sponsor_read_witness_query_unbounded"));
      life.expect(captured.reduce((n, item) => n + item.maximumBytes, 1_024));
      return env.DB.batch<T>(captured.map(item => item.original));
    } } as WorkerEnv["DB"];
  return { DB };
}

/** Dormant second stage. A fresh attempt is consumed before any source replay.
 * Uses the native bounded Image witness and reducer; no R2 or provider work.
 * Returned original-media facts still require the future native byte reader to
 * verify exact bytes and enforce this attempt's byte/deadline limit. */
export async function resolveSponsorImageRead(authority: SponsorImageReadAuthority, attempt: SponsorImageReadAttempt, request: Request, env: WorkerEnv) {
  requireSponsorImageReadAuthority(authority, request, env);
  const ticket = await takeSponsorImageReadAttempt(attempt, authority, request, env), state = authorities.get(authority)!;
  const life = new ReadLifetime(ticket.monotonicDeadline, ticket.maximumBytes);
  life.sql(1);
  const job = await life.run(65_536, () => env.DB.prepare(`SELECT job.status,job.updated_at,slot.outcome_event_id,slot.status AS slot_status,execution.status AS grant_status,
    CASE WHEN json_valid(job.result_json) AND json_type(job.result_json,'$.appendedEventIds')='array'
      AND length(CAST(json_extract(job.result_json,'$.appendedEventIds') AS BLOB))<=16384 THEN json_extract(job.result_json,'$.appendedEventIds') END AS completion_ids,
    (SELECT COUNT(*) FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id
      AND (calls.status IN('pending','uncertain') OR calls.used_microusd IS NULL)) AS unresolved_calls FROM document_jobs job
    JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
    WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.correlation_id=? AND length(CAST(job.updated_at AS BLOB))<=40
      AND typeof(job.status)='text' AND length(CAST(job.status AS BLOB))<=32
      AND (slot.outcome_event_id IS NULL OR length(CAST(slot.outcome_event_id AS BLOB))<=200)`)
    .bind(state.jobId, state.actorUserId, state.streamId, state.correlationId).first<Row>());
  if (!job || !["queued", "running", "committing", "completed", "partial", "failed", "canceled"].includes(String(job.status))) fail("sponsor_read_original_unavailable");
  let completed: CreativeEvent | null = null, privateJson = "", privateProject: string | null = null;
  if (job.status === "completed") {
    if (job.slot_status !== "succeeded" || job.grant_status !== "completed" || job.unresolved_calls !== 0) fail("sponsor_read_completion_unconfirmed");
    if (typeof job.completion_ids !== "string" || !JSON.parse(job.completion_ids).includes(job.outcome_event_id)) fail("sponsor_read_completion_unconfirmed");
    life.sql(1);
    const row = await life.run(2_097_152, () => env.DB.prepare(`SELECT event.*,body.owner_id private_owner,body.project_id private_project,body.document_id private_document,
      CASE WHEN length(CAST(body.private_json AS BLOB))<=131072 THEN body.private_json END private_json,body.redacted_at private_redacted
      FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id
      WHERE event.event_id=? AND event.stream_id=? AND event.correlation_id=? AND event.type='GenerationCompleted'
        AND body.redacted_at IS NULL
        AND typeof(event.sequence)='integer' AND typeof(event.schema_version)='integer'
        AND length(CAST(event.payload AS BLOB))<=131072
        AND ${["event.event_id", "event.stream_id", "event.actor", "event.client_id", "event.correlation_id", "event.causation_id", "event.compensates_event_id", "event.occurred_at", "event.recorded_at", "body.owner_id", "body.project_id", "body.document_id"].map(field => `(${field} IS NULL OR length(CAST(${field} AS BLOB))<=512)`).join(" AND ")}`)
      .bind(job.outcome_event_id as string, state.streamId, state.correlationId).first<Row>());
    if (!row || row.private_owner !== state.actorUserId || row.private_document !== state.documentId
      || row.private_project !== null && row.private_project !== state.projectId || row.private_redacted !== null || !boundedJson(row.private_json)) fail("sponsor_read_completion_unavailable");
    privateJson = row.private_json;
    privateProject = row.private_project == null ? null : String(row.private_project);
    completed = serializeEvent(row);
    const p = completed.payload;
    if (completed.actor !== "worker:generator" || p.document_id !== state.documentId || p.project_id != null && p.project_id !== state.projectId
      || p.source_surface !== "outputs" || p.provider !== "openai" || p.model_id !== state.model
      || p.simulation !== false || p.quality !== "high" || p.purpose !== "final" || p.media_type !== "image/png" || !id(p.object_id)
      || canonicalJson(p.object_ids) !== canonicalJson([p.object_id]) || !id(p.generation_id) || !id(p.output_ref) || !hash(p.source_content_hash)
      || !Number.isSafeInteger(p.image_width) || Number(p.image_width) < 1 || Number(p.image_width) > 16_384
      || !Number.isSafeInteger(p.image_height) || Number(p.image_height) < 1 || Number(p.image_height) > 16_384
      || p.image_width !== state.width || p.image_height !== state.height
      || !originalGeneratedImageUrl(state.actorUserId, completed)) fail("sponsor_read_completion_changed");
  } else if (ticket.operation !== "image-status") fail("sponsor_read_result_not_complete");
  const outputId = completed ? String(completed.payload.object_id) : `pending:${state.jobId}`;
  const key = "generated-image/" + Array.from(new TextEncoder().encode(outputId), byte => byte.toString(16).padStart(2, "0")).join("");
  const decode = (row: Row): CreativeEvent => {
    if (row.stream_id !== state.streamId || row.private_json !== null && row.private_owner !== state.actorUserId) fail("sponsor_read_private_custody_changed");
    return serializeEvent({ ...row, private_json: row.private_redacted === null ? row.private_json : null });
  };
  const fold = createCreativeEventFold();
  const image = completed ? createImageEventConsumer(outputId, key, decode) : null;
  const consumer = image ?? { accept(row: Row) { if (!fold.accept(decode(row))) fail("sponsor_read_history_changed"); },
    checkpoint() { return fold.measureRetainedState({ bytes: 16_000_000, nodes: 100_000, depth: 96 }); } };
  const witness = await readImageWitness(witnessDatabase(env, life), state.streamId, state.actorUserId, key, outputId, life, consumer);
  const imageState = image?.finish(), projection = imageState?.projection ?? fold.finish({ documentId: state.documentId, projectId: state.projectId });
  const document = projection.documents.find(d => d.id === state.documentId);
  if (!document || document.removed || document.projectId !== state.projectId || projection.documentId !== state.documentId || projection.projectId !== state.projectId) fail("sponsor_read_document_unavailable");
  const final: ImageWitnessGuard[] = [...state.assertions, { sql: ticket.assertion.sql, bindings: [...ticket.assertion.bindings] }, ...witness.guards,
    { sql: `EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
      JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
      WHERE job.job_id=? AND job.owner_id=? AND job.status=? AND job.updated_at=? AND job.correlation_id=?
      AND slot.outcome_event_id IS ? AND slot.status=? AND execution.status=?
      AND CASE WHEN json_valid(job.result_json) AND json_type(job.result_json,'$.appendedEventIds')='array'
        AND length(CAST(json_extract(job.result_json,'$.appendedEventIds') AS BLOB))<=16384 THEN json_extract(job.result_json,'$.appendedEventIds') END IS ?
      AND (SELECT COUNT(*) FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id
        AND (calls.status IN('pending','uncertain') OR calls.used_microusd IS NULL))=?)`,
    bindings: [state.jobId, state.actorUserId, String(job.status), String(job.updated_at), state.correlationId,
      job.outcome_event_id == null ? null : String(job.outcome_event_id), String(job.slot_status), String(job.grant_status),
      job.completion_ids == null ? null : String(job.completion_ids), Number(job.unresolved_calls)] }];
  let original = null;
  if (completed && imageState) {
    const p = completed.payload, aliases = imageState.events.filter(e => ["GenerationCompleted", "IdeationPreviewCompleted"].includes(e.type)
      && (e.payload.object_id === outputId || Array.isArray(e.payload.object_ids) && e.payload.object_ids.includes(outputId)));
    const output = projection.libraryOutputs.filter(o => o.id === outputId), initial = imageState.initial!.libraryOutputs.filter(o => o.id === outputId);
    if (aliases.length !== 1 || aliases[0]!.eventId !== completed.eventId || canonicalJson(aliases[0]!.payload) !== canonicalJson(p)
      || imageState.events.some(e => e.eventId !== completed!.eventId && ["GenerationCompleted", "IdeationPreviewCompleted"].includes(e.type) && e.payload.generation_id === p.generation_id)
      || imageState.events.some(e => ["DocumentRenderCompleted", "DocumentArtifactEdited"].includes(e.type) && [outputId, key].includes(String(e.payload.artifact_id)))
      || output.length !== 1 || output[0]!.discarded || output[0]!.documentId !== state.documentId || output[0]!.generationId !== p.generation_id
      || output[0]!.sourceEventId !== completed.eventId || output[0]!.contentRef !== p.output_ref
      || initial.length !== 1 || initial[0]!.sourceEventId !== completed.eventId || initial[0]!.mediaUrl !== p.media_url) fail("sponsor_read_output_unavailable");
    const url = originalGeneratedImageUrl(state.actorUserId, completed)!, mediaKey = decodeURIComponent(url.slice("/api/media/".length));
    final.push({ sql: `EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND document_id=? AND project_id IS ? AND private_json=? AND redacted_at IS NULL)
      AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL
        AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB)) BETWEEN 1 AND ? AND json_valid(content) AND json_type(content)='object')
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='artifact' AND resource_id IN (?,?))
        OR (resource_kind='content' AND resource_id=?) OR (resource_kind='media' AND resource_id IN (?,?)))
      AND (? IS NULL OR julianday(?)>julianday('now'))`,
    bindings: [completed.eventId, state.actorUserId, state.documentId, privateProject, privateJson, String(p.output_ref), state.actorUserId, GENERATED_IMAGE_EDIT_LIMITS.rawBytes, String(p.output_ref),
      outputId, key, String(p.output_ref), url, mediaKey, p.content_expires_at == null ? null : String(p.content_expires_at), p.content_expires_at == null ? null : String(p.content_expires_at)] });
    original = Object.freeze({ representation: "original-generation" as const, outputId, generationId: String(p.generation_id), sourceEventId: completed.eventId, contentRef: String(p.output_ref),
      mediaUrl: url, mediaKey, mediaType: "image/png" as const, sha256: String(p.source_content_hash), width: Number(p.image_width), height: Number(p.image_height) });
  }
  const result = { jobId: state.jobId, documentId: state.documentId, status: String(job.status), updatedAt: String(job.updated_at), original: ticket.operation === "image-status" ? null : original,
    operation: ticket.operation, maximumBytes: ticket.maximumBytes, deadlineAtMs: ticket.deadlineAtMs };
  // Reserve the tuple's wire representation too. The extra bytes cover the
  // remainingBytes field; future native byte I/O must spend only the remainder.
  life.account(result); life.account("x".repeat(64));
  // DB-clock deadline and all original proofs are the final asynchronous work.
  final.push({ sql: `${databaseNow}<?`, bindings: [ticket.deadlineAtMs] });
  life.sql(final.length);
  const verified = await life.run(final.length * 1_024, () => env.DB.batch<Row>(final.map(g => imageWitnessStatement(env, g))));
  if (!imageWitnessAcknowledged(verified, final.length)) fail("sponsor_read_current_custody_changed");
  return Object.freeze({ ...result, remainingBytes: Math.max(0, ticket.maximumBytes - life.usedBytes) });
}
