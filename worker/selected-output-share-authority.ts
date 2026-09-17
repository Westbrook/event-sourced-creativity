import type { WorkerEnv } from "./runtime.ts";
import { AUTH_BYTES, EVENT_BYTES, nativeRetainedTextCustodyAssertion, nativeRetainedTextCustodySnapshot, type NativeRetainedTextCustody } from "./native-retained-text-custody.ts";
import { nativeRetainedMediaCustodyAssertion, nativeRetainedMediaCustodySnapshot, type NativeRetainedMediaCustody,
  type NativeRetainedMediaSnapshot } from "./native-retained-media-custody.ts";
import { selectedOutputShareMediaRecoveryLineage } from "./selected-output-share-media-recovery.ts";
import { documentJobMaxAttempts } from "../src/model/document-jobs.ts";
import { MAX_MANUAL_PRESENTATION_SLIDES } from "../src/model/presentation-count-policy.ts";
import { selectedShareProofQuery, selectedSharePredicateProof, selectedShareProofStatement,
  type SelectedShareProofQuery } from "./selected-output-share-proof.ts";

/** Detached, read-only provenance proof. This module does not install schema or
 * expose an endpoint, and a proof is not permission to create a public link. */
declare const selectedShareAuthority: unique symbol;
export type SelectedOutputShareAuthority = Readonly<{ [selectedShareAuthority]: true }>;
type SqlValue = string | number | null;
type Assertion = { sql: string; bindings: SqlValue[] };
type Snapshot = Readonly<{ jobId: string; completionId: string; expiresAt: string }>;
type Custody = { kind: "text"; proof: NativeRetainedTextCustody } | { kind: "media"; proof: NativeRetainedMediaCustody };
type State = { env: WorkerEnv; db: WorkerEnv["DB"]; environment: string; custody: Custody; snapshot: Snapshot; assertion: readonly SelectedShareProofQuery[] };
const proofs = new WeakMap<object, State>();
const encoder = new TextEncoder();
// Reuse the native custody transport budgets; do not enlarge the private reader.
const RAW_BYTES = AUTH_BYTES, WITNESS_BYTES = EVENT_BYTES, SCHEMA_BYTES = AUTH_BYTES;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
function fail(): never { throw new Error("selected_output_share_authority_unavailable"); }
const bytes = (value: string) => encoder.encode(value).length;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const parse = (value: unknown) => { try { return typeof value === "string" ? object(JSON.parse(value)) : null; } catch { return null; } };
const validId = (value: unknown): value is string => typeof value === "string" && identifier.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const environment = (env: WorkerEnv) => JSON.stringify([env.FORMA_PILOT_COHORT_ID ?? "", env.FORMA_ADMIN_EMAILS ?? ""]);

const optionalTables = ["experience_sponsor_active_jobs", "experience_sponsor_consumptions", "experience_sponsor_intakes"] as const;
type SchemaRow = { name: string; type: string; sql: string | null };
async function sponsorSchema(env: WorkerEnv): Promise<{ names: Set<string>; assertion: Assertion }> {
  const result = await env.DB.prepare(`SELECT name,type,CASE WHEN length(CAST(sql AS BLOB))<=${SCHEMA_BYTES} THEN sql ELSE NULL END AS sql
    FROM sqlite_master WHERE name IN(?,?,?) ORDER BY name LIMIT 4`).bind(...optionalTables).all<SchemaRow>();
  if (!result.success || result.results.length > optionalTables.length) return fail();
  const names = new Set<string>(), clauses: string[] = [], bindings: SqlValue[] = [];
  for (const row of result.results) {
    if (!optionalTables.includes(row.name as typeof optionalTables[number]) || names.has(row.name) || row.type !== "table"
      || typeof row.sql !== "string" || !row.sql || bytes(row.sql) > SCHEMA_BYTES) return fail();
    names.add(row.name);
    clauses.push("EXISTS(SELECT 1 FROM sqlite_master WHERE name=? AND type='table' AND CAST(sql AS BLOB)=CAST(? AS BLOB))");
    bindings.push(row.name, row.sql);
  }
  for (const name of optionalTables) if (!names.has(name)) {
    clauses.push("NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name=?)"); bindings.push(name);
  }
  return { names, assertion: { sql: clauses.join(" AND "), bindings } };
}

/** Time boundaries of configuredPilotAdmissionGuard (intake-authority.ts).
 * The ordinary branch needs one current, bound participant. Prefer the latest
 * applicable end, rather than expiring at an unrelated shorter cohort. The
 * owner-recovery exception has no past-end cutoff; only a scheduled live cohort
 * can end that exception. Actual authorization remains the native predicate.
 * This bounds transported witness bytes, not database scan/sort work. */
async function admissionDeadline(env: WorkerEnv, native: Pick<ReturnType<typeof nativeRetainedTextCustodySnapshot>, "identity">): Promise<{ expiresAt: string | null; assertion: Assertion }> {
  const configured = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
  const breakglass = new Set((env.FORMA_ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!configured || breakglass.has(native.identity.email.toLowerCase())) return { expiresAt: null, assertion: { sql: "1", bindings: [] } };
  const cte = `share_policy_identity AS (SELECT ? AS cohort_id,? AS user_id,? AS email),
    share_policy_selected AS (
      SELECT cohort.* FROM pilot_cohorts cohort JOIN organizations organization
        ON organization.organization_id=cohort.organization_id AND organization.status='active'
      WHERE cohort.cohort_id=(SELECT cohort_id FROM share_policy_identity)),
    share_policy_participant AS (
      SELECT json_object('mode','participant','selected',selected.cohort_id,'organization',selected.organization_id,
        'cohort',cohort.cohort_id,'status',cohort.status,'startsAt',cohort.starts_at,'deadline',cohort.ends_at,
        'participant',participant.participant_id,'user',participant.user_id,'email',participant.email_normalized,
        'enrollmentDeadline',(SELECT MIN(future.starts_at) FROM pilot_cohorts future
          JOIN pilot_participants unbound ON unbound.cohort_id=future.cohort_id AND unbound.organization_id=future.organization_id
          WHERE future.organization_id=selected.organization_id AND future.status IN('active','paused')
            AND future.starts_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND future.ends_at>future.starts_at
            AND unbound.email_normalized=(SELECT email FROM share_policy_identity)
            AND unbound.user_id IS NULL AND unbound.status='active' AND unbound.revoked_at IS NULL)) AS witness
      FROM share_policy_selected selected JOIN pilot_cohorts cohort ON cohort.organization_id=selected.organization_id
      JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      WHERE cohort.status IN('active','paused') AND cohort.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND cohort.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND participant.user_id=(SELECT user_id FROM share_policy_identity) AND participant.email_normalized=(SELECT email FROM share_policy_identity)
        AND participant.status='active' AND participant.revoked_at IS NULL
      ORDER BY cohort.ends_at DESC,cohort.cohort_id,participant.participant_id LIMIT 1),
    share_policy_owner AS (
      SELECT json_object('mode','owner-recovery','selected',cohort.cohort_id,'organization',cohort.organization_id,
        'status',cohort.status,'startsAt',cohort.starts_at,'endsAt',cohort.ends_at,'membership',member.membership_id,
        'acceptedAt',member.accepted_at,'user',owner.user_id,'email',owner.email,
        'deadline',(SELECT MIN(future.starts_at) FROM pilot_cohorts future WHERE future.organization_id=cohort.organization_id
          AND future.status IN('active','paused') AND future.starts_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND future.ends_at>future.starts_at)) AS witness
      FROM share_policy_selected cohort JOIN organization_memberships member ON member.organization_id=cohort.organization_id
        AND member.user_id=(SELECT user_id FROM share_policy_identity) AND member.role='owner' AND member.status='active'
        AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN users owner ON owner.user_id=member.user_id AND owner.email=(SELECT email FROM share_policy_identity)
      WHERE (cohort.status='closed' OR cohort.ends_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR cohort.starts_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id
          AND successor.status IN('active','paused') AND successor.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND successor.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY member.membership_id LIMIT 1),
    share_policy AS (SELECT witness FROM share_policy_participant UNION ALL SELECT witness FROM share_policy_owner
      WHERE NOT EXISTS(SELECT 1 FROM share_policy_participant))`;
  const bindings: SqlValue[] = [configured, native.identity.userId, native.identity.email.toLowerCase()];
  const selected = await env.DB.prepare(`WITH ${cte} SELECT witness FROM share_policy WHERE length(CAST(witness AS BLOB))<=${AUTH_BYTES}`)
    .bind(...bindings).first<{ witness: string }>();
  if (!selected || typeof selected.witness !== "string" || bytes(selected.witness) > AUTH_BYTES) return fail();
  const policy = parse(selected.witness);
  if (!policy || policy.mode !== "participant" && policy.mode !== "owner-recovery" || policy.user !== native.identity.userId
    || policy.email !== native.identity.email.toLowerCase() || policy.selected !== configured
    || policy.deadline !== null && (!timestamp(policy.deadline) || Date.parse(policy.deadline) <= Date.now())) return fail();
  const enrollmentDeadline = policy.mode === "participant" ? policy.enrollmentDeadline : null;
  if (enrollmentDeadline !== null && (!timestamp(enrollmentDeadline) || Date.parse(enrollmentDeadline) <= Date.now())) return fail();
  const expiresAt = typeof enrollmentDeadline === "string" && (policy.deadline === null || enrollmentDeadline < String(policy.deadline))
    ? enrollmentDeadline : policy.deadline as string | null;
  return { expiresAt, assertion: {
    sql: `EXISTS(WITH ${cte} SELECT 1 FROM share_policy WHERE CAST(witness AS BLOB)=CAST(? AS BLOB))`,
    bindings: [...bindings, selected.witness],
  } };
}

const jsonRow = (columns: Record<string, string>) => {
  const entries = Object.entries(columns);
  const initial = `json_object(${entries.slice(0, 15).flatMap(([name, value]) => [`'${name}'`, value]).join(",")})`;
  // json_set preserves explicit SQL NULL fields and insertion order. json_patch
  // would delete those fields and change the byte-exact provenance witness.
  return entries.length <= 15 ? initial
    : `json_set(${initial},${entries.slice(15).flatMap(([name, value]) => [`'$.${name}'`, value]).join(",")})`;
};
const jobJson = jsonRow({ jobId: "job.job_id", ownerId: "job.owner_id", streamId: "job.stream_id", documentId: "job.document_id",
  kind: "job.kind", status: "job.status", sourceSurface: "job.source_surface", correlationId: "job.correlation_id",
  attemptCount: "job.attempt_count", requestedSequence: "job.requested_sequence", requestJson: "job.request_json", resultJson: "job.result_json",
  expiresAt: "job.expires_at", completedAt: "job.completed_at", errorMessage: "job.error_message" });
const completionJson = jsonRow({ eventId: "completion.event_id", streamId: "completion.stream_id", type: "completion.type",
  actor: "completion.actor", clientId: "completion.client_id", correlationId: "completion.correlation_id", sequence: "completion.sequence",
  payload: "completion.payload" });
const slotJson = jsonRow({ scopeKey: "slot.scope_key", slotId: "slot.slot_id", grantId: "slot.grant_id", planRevisionId: "slot.plan_revision_id",
  targetId: "slot.target_id", targetContractDigest: "slot.target_contract_digest", sourceDigest: "slot.source_digest", jobId: "slot.job_id",
  routeDigest: "slot.route_digest", attemptOrdinal: "slot.attempt_ordinal", previousSlotId: "slot.previous_slot_id", status: "slot.status",
  outcomeEventId: "slot.outcome_event_id", provider: "slot.provider", model: "slot.model", costReservationId: "slot.cost_reservation_id",
  tokenReservationId: "slot.token_reservation_id", maximumMicrousd: "slot.maximum_microusd", maximumCalls: "slot.maximum_calls", maximumTokens: "slot.maximum_tokens" });
const planJson = jsonRow({ scopeKey: "plan.scope_key", scopeKind: "plan.scope_kind", ownerId: "plan.owner_user_id", projectId: "plan.project_id",
  documentId: "plan.document_id", organizationId: "plan.organization_id", projectAccessId: "plan.project_access_id",
  planRevisionId: "plan.plan_revision_id", sourceDigest: "plan.source_digest" });
const grantJson = jsonRow({ scopeKey: "grant_row.scope_key", grantId: "grant_row.grant_id", planRevisionId: "grant_row.plan_revision_id",
  actorId: "grant_row.actor_user_id", payerId: "grant_row.payer_user_id", contextId: "grant_row.context_id", preflightId: "grant_row.preflight_id",
  authorizationEventId: "grant_row.authorization_event_id", status: "grant_row.status", expiresAt: "grant_row.expires_at",
  maximumMicrousd: "grant_row.maximum_microusd", maximumCalls: "grant_row.maximum_calls" });
const preflightJson = jsonRow({ scopeKey: "preflight.scope_key", preflightId: "preflight.preflight_id", planRevisionId: "preflight.plan_revision_id",
  actorId: "preflight.actor_user_id", termsDigest: "preflight.terms_digest", eventId: "preflight.event_id" });
const authorizationJson = jsonRow({ eventId: "authorization.event_id", streamId: "authorization.stream_id", type: "authorization.type",
  actor: "authorization.actor", clientId: "authorization.client_id", correlationId: "authorization.correlation_id", sequence: "authorization.sequence", payload: "authorization.payload",
  privateId: "body.private_event_id", ownerId: "body.owner_id", projectId: "body.project_id", documentId: "body.document_id",
  privateJson: "body.private_json", redactedAt: "body.redacted_at",
  scoped: "EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=authorization.event_id)" });

function provenanceQuery(schema: Set<string>, media = false): string {
  const sponsor = [
    ...(schema.has("experience_sponsor_consumptions") ? ["NOT EXISTS(SELECT 1 FROM experience_sponsor_consumptions sponsor WHERE sponsor.job_id=job.job_id)"] : []),
    ...(schema.has("experience_sponsor_active_jobs") ? ["NOT EXISTS(SELECT 1 FROM experience_sponsor_active_jobs sponsor WHERE sponsor.job_id=job.job_id)"] : []),
    ...(schema.has("experience_sponsor_intakes") ? ["NOT EXISTS(SELECT 1 FROM experience_sponsor_intakes sponsor WHERE sponsor.document_id=job.document_id)"] : []),
  ];
  // output_slot_id is a readJob projection, not a physical document_jobs column.
  // Joining every actual slot also makes duplicate/contradictory bindings refuse.
  return `selected_share_jobs AS (
    SELECT json_object('job',${jobJson},'completion',${completionJson},'slot',${slotJson},'plan',${planJson},'grant',${grantJson},'preflight',${preflightJson},'authorization',${authorizationJson}${media ? `,'mediaCompletion',CASE WHEN length(CAST(media_body.private_json AS BLOB)) BETWEEN 1 AND ${RAW_BYTES} THEN media_body.private_json ELSE NULL END` : ""}) AS witness
    FROM events completion JOIN document_jobs job ON job.stream_id=completion.stream_id AND job.correlation_id=completion.correlation_id
    LEFT JOIN output_operation_slots slot ON slot.job_id=job.job_id
    LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    LEFT JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    LEFT JOIN output_preflights preflight ON preflight.scope_key=grant_row.scope_key AND preflight.preflight_id=grant_row.preflight_id
    LEFT JOIN events authorization ON authorization.event_id=grant_row.authorization_event_id
    LEFT JOIN event_private_payloads body ON body.private_event_id=grant_row.authorization_event_id
    ${media ? "LEFT JOIN event_private_payloads media_body ON media_body.private_event_id=completion.event_id" : ""}
    WHERE completion.event_id=? AND completion.stream_id=? AND completion.type='DocumentRenderCompleted'
      AND completion.actor='worker:renderer' AND ${media
        ? "completion.client_id IN('server:document-job:render_document','output-video-recovery','output-model3d-recovery')"
        : "completion.client_id='server:document-job:render_document'"}
      AND job.owner_id=? AND job.document_id=? AND job.kind='render_document' AND job.status='completed'
      AND job.error_message IS NULL AND job.completed_at IS NOT NULL
      AND typeof(job.attempt_count)='integer' AND job.attempt_count BETWEEN 1 AND ${documentJobMaxAttempts("render_document")}
      AND job.correlation_id=(job.job_id||':attempt:'||CAST(job.attempt_count AS TEXT))
      AND typeof(job.expires_at)='text' AND length(CAST(job.expires_at AS BLOB))=24
      AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND typeof(job.request_json)='text' AND length(CAST(job.request_json AS BLOB)) BETWEEN 1 AND ${RAW_BYTES}
      AND typeof(job.result_json)='text' AND length(CAST(job.result_json AS BLOB)) BETWEEN 1 AND ${RAW_BYTES}
      AND length(CAST(completion.payload AS BLOB)) BETWEEN 1 AND ${RAW_BYTES}
      AND (body.private_json IS NULL OR length(CAST(body.private_json AS BLOB)) BETWEEN 1 AND ${RAW_BYTES})
      AND (authorization.payload IS NULL OR length(CAST(authorization.payload AS BLOB)) BETWEEN 1 AND ${RAW_BYTES})
      AND NOT EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=completion.event_id)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE
        (scope.resource_kind='job' AND scope.resource_id=job.job_id) OR (scope.resource_kind='document' AND scope.resource_id=job.document_id))
      AND (SELECT COUNT(*) FROM output_operation_slots other WHERE other.job_id=job.job_id)=CASE WHEN slot.slot_id IS NULL THEN 0 ELSE 1 END
      AND (SELECT COUNT(*) FROM document_jobs other WHERE other.stream_id=completion.stream_id AND other.correlation_id=completion.correlation_id)=1
      AND (SELECT COUNT(*) FROM events other WHERE other.stream_id=completion.stream_id AND other.correlation_id=completion.correlation_id AND other.type='DocumentRenderCompleted')=1
      ${sponsor.length ? `AND ${sponsor.join(" AND ")}` : ""}
  ), bounded_selected_share_jobs AS (SELECT witness FROM selected_share_jobs WHERE length(CAST(witness AS BLOB))<=${WITNESS_BYTES})`;
}

/** Unknown workflow, recovery and sponsor lineage is outside this initial slice.
 * Scan keys only, never authored prose. JSON is already byte bounded at SQL. */
function ordinaryLineage(value: unknown): boolean {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (Array.isArray(item)) { pending.push(...item); continue; }
    const row = object(item);
    if (!row) continue;
    for (const [key, child] of Object.entries(row)) {
      if (/sponsor|workflow|recover|replacement/iu.test(key)) return false;
      pending.push(child);
    }
  }
  return true;
}
const matches = (value: unknown, expected: Record<string, unknown>) => {
  const row = object(value);
  return Boolean(row && Object.keys(row).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, item]) => Object.hasOwn(row, key) && row[key] === item));
};

function validateWitness(raw: string, native: ReturnType<typeof nativeRetainedTextCustodySnapshot>): Snapshot {
  const witness = parse(raw), job = object(witness?.job), completion = object(witness?.completion), slot = object(witness?.slot),
    plan = object(witness?.plan), grant = object(witness?.grant), preflight = object(witness?.preflight), authorization = object(witness?.authorization);
  if (!job || !completion || !slot || !plan || !grant || !preflight || !authorization) return fail();
  const request = parse(job.requestJson), result = parse(job.resultJson), completed = parse(completion.payload);
  const owner = native.identity.userId, selected = native.selection;
  if (!request || !result || !completed || !validId(job.jobId) || job.ownerId !== owner || job.streamId !== `creative:${owner}`
    || job.documentId !== selected.documentId || completion.eventId !== native.completionId
    || !timestamp(job.expiresAt) || Date.parse(job.expiresAt) <= Date.now() || !timestamp(job.completedAt)
    || !Number.isSafeInteger(job.requestedSequence) || Number(job.requestedSequence) < 0
    || !Number.isSafeInteger(completion.sequence) || Number(completion.sequence) <= Number(job.requestedSequence)
    || request.artifactKind !== selected.output || result.artifactKind !== selected.output || result.artifactId !== selected.artifactId
    || request.productionMode !== "manual" || !ordinaryLineage(request) || !ordinaryLineage(result) || !ordinaryLineage(completed)) return fail();
  const eventIds = result.appendedEventIds;
  if (!Array.isArray(eventIds) || eventIds.length < 1 || eventIds.length > 128 || eventIds.some(id => !validId(id))
    || new Set(eventIds).size !== eventIds.length || !eventIds.includes(native.completionId)) return fail();
  if (selected.output === "slides" ? !Number.isSafeInteger(request.itemCount) || Number(request.itemCount) < 1 || Number(request.itemCount) > MAX_MANUAL_PRESENTATION_SLIDES
    : selected.output === "short_story" ? request.itemCount !== 1 : request.itemCount !== undefined && request.itemCount !== 1) return fail();
  if (slot.slotId === null) {
    if (job.sourceSurface !== "document" || Object.hasOwn(request, "outputExecution") || Object.hasOwn(result, "outputExecution")) return fail();
  } else {
    const body = parse(authorization.privateJson), publicAuthorization = parse(authorization.payload);
    const envelope = object(body?.output_command_envelope);
    const reference = { scopeKey: slot.scopeKey, grantId: slot.grantId, slotId: slot.slotId, planRevisionId: slot.planRevisionId,
      targetId: slot.targetId, targetContractDigest: slot.targetContractDigest, sourceDigest: slot.sourceDigest };
    if (job.sourceSurface !== "outputs" || !Object.values(reference).every(validId) || !matches(request.outputExecution, reference)
      || !matches(result.outputExecution, reference) || slot.jobId !== job.jobId || slot.status !== "succeeded"
      || slot.attemptOrdinal !== 0 || slot.previousSlotId !== null || slot.outcomeEventId !== native.completionId
      || plan.scopeKey !== slot.scopeKey || plan.scopeKind !== "personal" || plan.ownerId !== owner || plan.projectId !== native.projectId
      || plan.documentId !== selected.documentId || plan.organizationId !== null || plan.projectAccessId !== null
      || plan.planRevisionId !== slot.planRevisionId || plan.sourceDigest !== slot.sourceDigest
      || grant.scopeKey !== slot.scopeKey || grant.grantId !== slot.grantId || grant.planRevisionId !== slot.planRevisionId
      || grant.actorId !== owner || grant.payerId !== owner || grant.contextId !== null || grant.status !== "completed"
      || preflight.scopeKey !== slot.scopeKey || preflight.preflightId !== grant.preflightId || preflight.planRevisionId !== slot.planRevisionId
      || preflight.actorId !== owner || !validId(preflight.termsDigest) || !validId(preflight.eventId)
      || !body || !publicAuthorization || !envelope || !ordinaryLineage(body) || !ordinaryLineage(publicAuthorization)
      || authorization.eventId !== grant.authorizationEventId || authorization.privateId !== grant.authorizationEventId
      || authorization.ownerId !== owner || authorization.projectId !== native.projectId || authorization.documentId !== selected.documentId
      || authorization.redactedAt !== null || authorization.scoped !== 0 || authorization.streamId !== `creative:${owner}`
      || authorization.type !== "OutputExecutionAuthorized" || authorization.actor !== `user:${owner}` || authorization.clientId !== "server:output-requirements"
      || publicAuthorization._private_ref !== authorization.eventId || Number(authorization.sequence) >= Number(completion.sequence)
      || body.project_id !== native.projectId || body.document_id !== selected.documentId || body.actor_user_id !== owner
      || body.grant_id !== slot.grantId || body.plan_revision_id !== slot.planRevisionId || body.preflight_id !== grant.preflightId
      || body.source_digest !== slot.sourceDigest || body.maximum_microusd !== grant.maximumMicrousd || body.maximum_calls !== grant.maximumCalls) return fail();
    // The mini-app retained envelope is the actual authorize command. An empty
    // object proves neither its selected Document nor its deliberate approval.
    const expectedRevision = typeof envelope.expectedRevision === "string" && /^output:\d+$/u.test(envelope.expectedRevision)
      ? Number(envelope.expectedRevision.slice("output:".length)) : NaN;
    if (envelope.action !== "authorize" || envelope.documentId !== selected.documentId || envelope.explicitAuthorization !== true
      || !validId(envelope.clientMutationId) || envelope.clientMutationId !== authorization.correlationId
      || envelope.preflightId !== preflight.preflightId || envelope.termsDigest !== preflight.termsDigest
      || envelope.maximumMicrousd !== grant.maximumMicrousd || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 0 || expectedRevision >= Number(authorization.sequence)) return fail();
    const targets = body.authorized_targets;
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > 1000
      || targets.filter(value => object(value)?.operation_slot_id === slot.slotId).length !== 1
      || !targets.some(value => matches(value, { target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: job.jobId, route_digest: slot.routeDigest }))) return fail();
  }
  const expiresAt = job.expiresAt < native.sourceExpiresAt ? job.expiresAt : native.sourceExpiresAt;
  return Object.freeze({ jobId: job.jobId, completionId: native.completionId, expiresAt });
}


/** The nonzero branch accepts only the private-issued genuine snapshot bridge.
 * No declaration supplied in a request or copied public descriptor can mint it. */
function restoredOriginalModel3d(native: NativeRetainedMediaSnapshot): boolean {
  const basis = native.nativeOriginal, selected = native.selection;
  return Boolean(basis && basis.output === "model3d" && basis.relation === "selected-restored-original" && basis.originalRevision === 0
    && basis.selectedRevision === selected.revision && selected.revision > 0 && basis.selectedContentSha256 === selected.contentSha256
    && basis.originalContentSha256 === selected.contentSha256 && basis.mediaSha256 === selected.mediaSha256
    && basis.mediaSha256 === native.media.sha256 && basis.mediaByteLength === native.media.byteLength);
}

/** Current Notes may differ from the genuine original content hash, or return
 * to its value. Only the authentic native bridge proves that relationship. */
function originalVideoWithNotes(native: NativeRetainedMediaSnapshot): boolean {
  const basis = native.nativeOriginal, selected = native.selection;
  return Boolean(basis && basis.output === "video" && basis.relation === "selected-original-with-notes" && basis.originalRevision === 0
    && basis.selectedRevision === selected.revision && selected.revision > 0 && basis.selectedContentSha256 === selected.contentSha256
    && /^[a-f0-9]{64}$/u.test(basis.originalContentSha256) && basis.mediaSha256 === selected.mediaSha256
    && basis.mediaSha256 === native.media.sha256 && basis.mediaByteLength === native.media.byteLength
    && native.media.readMode === "native-output-video");
}

/** Media-specific provenance, after exact native current custody. Outputs media
 * needs its original receipt bridge; ordinary Document revisions keep current
 * native custody without manufacturing an original revision or recovery lease. */
function validateMediaWitness(raw: string, native: NativeRetainedMediaSnapshot): Snapshot {
  const witness = parse(raw), job = object(witness?.job), completion = object(witness?.completion), slot = object(witness?.slot),
    plan = object(witness?.plan), grant = object(witness?.grant), preflight = object(witness?.preflight), authorization = object(witness?.authorization);
  if (!job || !completion || !slot || !plan || !grant || !preflight || !authorization) return fail();
  const request = parse(job.requestJson), result = parse(job.resultJson), completed = parse(completion.payload), privateCompletion = parse(witness?.mediaCompletion);
  if (!privateCompletion) return fail();
  const settings = object(privateCompletion.settings);
  const mediaCompletion = { sourceSurface: privateCompletion.source_surface ?? null, itemCount: privateCompletion.item_count,
    videoReceipt: settings && Object.hasOwn(settings, "output_video") ? object(settings.output_video) ? "object" : "invalid" : null,
    model3dReceipt: settings && Object.hasOwn(settings, "output_model3d") ? object(settings.output_model3d) ? "object" : "invalid" : null };
  const owner = native.identity.userId, selected = native.selection;
  if (!request || !result || !completed || !validId(job.jobId) || job.ownerId !== owner || job.streamId !== `creative:${owner}`
    || job.documentId !== selected.documentId || completion.eventId !== native.completionId
    || !timestamp(job.expiresAt) || Date.parse(job.expiresAt) <= Date.now() || !timestamp(job.completedAt)
    || !Number.isSafeInteger(job.requestedSequence) || Number(job.requestedSequence) < 0
    || !Number.isSafeInteger(completion.sequence) || Number(completion.sequence) <= Number(job.requestedSequence)
    || request.artifactKind !== selected.output || result.artifactKind !== selected.output || result.artifactId !== selected.artifactId
    || request.productionMode !== "manual" || !selectedOutputShareMediaRecoveryLineage({ output: selected.output,
      jobId: job.jobId, slotId: slot.slotId, completionId: native.completionId, completionClient: completion.clientId,
      request, result, publicCompletion: completed, privateCompletion })) return fail();
  const eventIds = result.appendedEventIds;
  if (!Array.isArray(eventIds) || eventIds.length < 1 || eventIds.length > 128 || eventIds.some(id => !validId(id))
    || new Set(eventIds).size !== eventIds.length || !eventIds.includes(native.completionId)) return fail();
  if (request.itemCount !== undefined && request.itemCount !== 1 && !(selected.output === "model3d" && request.itemCount === 0)
    || mediaCompletion.itemCount !== (selected.output === "model3d" ? 0 : 1)) return fail();
  if (slot.slotId === null) {
    if (job.sourceSurface !== "document" || Object.hasOwn(request, "outputExecution") || Object.hasOwn(result, "outputExecution")
      || mediaCompletion.sourceSurface !== null && mediaCompletion.sourceSurface !== "document"
      || mediaCompletion.videoReceipt !== null || mediaCompletion.model3dReceipt !== null
      || native.media.readMode !== "owned-media") return fail();
  } else {
    // These markers come from the actual private completion, already pinned by
    // native custody. They select the native original packed proof, rather than
    // treating a slot declaration as evidence that the proof ran. Revised
    // Outputs Video/GLB need an original-to-current provenance bridge. Audio
    // uses the ordinary job completion path with exact request AND result
    // references, including its native current edit/restore receipt lineage.
    if (mediaCompletion.sourceSurface !== "outputs"
      || (selected.output === "audio" ? mediaCompletion.videoReceipt !== null || mediaCompletion.model3dReceipt !== null || native.media.readMode !== "owned-media"
        : selected.output === "video"
          ? selected.revision !== 0 && !originalVideoWithNotes(native) || mediaCompletion.videoReceipt !== "object" || mediaCompletion.model3dReceipt !== null || native.media.readMode !== "native-output-video"
          : mediaCompletion.model3dReceipt !== "object" || mediaCompletion.videoReceipt !== null
            || selected.revision !== 0 && !restoredOriginalModel3d(native))) return fail();
    const body = parse(authorization.privateJson), publicAuthorization = parse(authorization.payload);
    const envelope = object(body?.output_command_envelope);
    const reference = { scopeKey: slot.scopeKey, grantId: slot.grantId, slotId: slot.slotId, planRevisionId: slot.planRevisionId,
      targetId: slot.targetId, targetContractDigest: slot.targetContractDigest, sourceDigest: slot.sourceDigest };
    if (job.sourceSurface !== "outputs" || !Object.values(reference).every(validId)
      || !(selected.output === "video" && !Object.hasOwn(request, "outputExecution")) && !matches(request.outputExecution, reference)
      || !matches(result.outputExecution, reference) || slot.jobId !== job.jobId || slot.status !== "succeeded"
      || slot.attemptOrdinal !== 0 || slot.previousSlotId !== null || slot.outcomeEventId !== native.completionId
      || plan.scopeKey !== slot.scopeKey || plan.scopeKind !== "personal" || plan.ownerId !== owner || plan.projectId !== native.projectId
      || plan.documentId !== selected.documentId || plan.organizationId !== null || plan.projectAccessId !== null
      || plan.planRevisionId !== slot.planRevisionId || plan.sourceDigest !== slot.sourceDigest
      || grant.scopeKey !== slot.scopeKey || grant.grantId !== slot.grantId || grant.planRevisionId !== slot.planRevisionId
      || grant.actorId !== owner || grant.payerId !== owner || grant.contextId !== null || grant.status !== "completed"
      || preflight.scopeKey !== slot.scopeKey || preflight.preflightId !== grant.preflightId || preflight.planRevisionId !== slot.planRevisionId
      || preflight.actorId !== owner || !validId(preflight.termsDigest) || !validId(preflight.eventId)
      || !body || !publicAuthorization || !envelope || !ordinaryLineage(body) || !ordinaryLineage(publicAuthorization)
      || authorization.eventId !== grant.authorizationEventId || authorization.privateId !== grant.authorizationEventId
      || authorization.ownerId !== owner || authorization.projectId !== native.projectId || authorization.documentId !== selected.documentId
      || authorization.redactedAt !== null || authorization.scoped !== 0 || authorization.streamId !== `creative:${owner}`
      || authorization.type !== "OutputExecutionAuthorized" || authorization.actor !== `user:${owner}` || authorization.clientId !== "server:output-requirements"
      || publicAuthorization._private_ref !== authorization.eventId || Number(authorization.sequence) >= Number(completion.sequence)
      || body.project_id !== native.projectId || body.document_id !== selected.documentId || body.actor_user_id !== owner
      || body.grant_id !== slot.grantId || body.plan_revision_id !== slot.planRevisionId || body.preflight_id !== grant.preflightId
      || body.source_digest !== slot.sourceDigest || body.maximum_microusd !== grant.maximumMicrousd || body.maximum_calls !== grant.maximumCalls) return fail();
    // The mini-app retained envelope is the actual authorize command. An empty
    // object proves neither its selected Document nor its deliberate approval.
    const expectedRevision = typeof envelope.expectedRevision === "string" && /^output:\d+$/u.test(envelope.expectedRevision)
      ? Number(envelope.expectedRevision.slice("output:".length)) : NaN;
    if (envelope.action !== "authorize" || envelope.documentId !== selected.documentId || envelope.explicitAuthorization !== true
      || !validId(envelope.clientMutationId) || envelope.clientMutationId !== authorization.correlationId
      || envelope.preflightId !== preflight.preflightId || envelope.termsDigest !== preflight.termsDigest
      || envelope.maximumMicrousd !== grant.maximumMicrousd || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 0 || expectedRevision >= Number(authorization.sequence)) return fail();
    const targets = body.authorized_targets;
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > 1000
      || targets.filter(value => object(value)?.operation_slot_id === slot.slotId).length !== 1
      || !targets.some(value => matches(value, { target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: job.jobId, route_digest: slot.routeDigest }))) return fail();
  }
  const expiresAt = job.expiresAt < native.expiresAt ? job.expiresAt : native.expiresAt;
  return Object.freeze({ jobId: job.jobId, completionId: native.completionId, expiresAt });
}

async function readAuthority(env: WorkerEnv, custody: NativeRetainedTextCustody): Promise<SelectedOutputShareAuthority> {
  const db = env.DB, capturedEnvironment = environment(env), native = nativeRetainedTextCustodySnapshot(custody, env), custodyAssertion = nativeRetainedTextCustodyAssertion(custody, env);
  const policy = await admissionDeadline(env, native);
  const schema = await sponsorSchema(env), cte = provenanceQuery(schema.names);
  const bindings: SqlValue[] = [native.completionId, `creative:${native.identity.userId}`, native.identity.userId, native.selection.documentId];
  const result = await db.prepare(`WITH ${cte} SELECT witness FROM bounded_selected_share_jobs LIMIT 2`).bind(...bindings).all<{ witness: string }>();
  if (!result.success || result.results.length !== 1 || typeof result.results[0]?.witness !== "string" || bytes(result.results[0].witness) > WITNESS_BYTES) return fail();
  const raw = result.results[0].witness, source = validateWitness(raw, native);
  const snapshot = Object.freeze({ ...source, expiresAt: policy.expiresAt && policy.expiresAt < source.expiresAt ? policy.expiresAt : source.expiresAt });
  const assertion = Object.freeze([
    selectedSharePredicateProof(schema.assertion), selectedShareProofQuery(custodyAssertion.sql, custodyAssertion.bindings),
    selectedSharePredicateProof(policy.assertion),
    selectedShareProofQuery(`WITH ${cte}
      SELECT 1 AS admitted FROM bounded_selected_share_jobs WHERE CAST(witness AS BLOB)=CAST(? AS BLOB)
        AND (SELECT COUNT(*) FROM selected_share_jobs)=1`, [...bindings, raw]),
  ]);
  const statement = selectedShareProofStatement(assertion);
  const final = await db.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`)
    .bind(...statement.bindings).first<{ admitted: number }>();
  if (env.DB !== db || environment(env) !== capturedEnvironment || final?.admitted !== 1 || Date.parse(snapshot.expiresAt) <= Date.now()) return fail();
  nativeRetainedTextCustodySnapshot(custody, env);
  const proof = Object.freeze({}) as SelectedOutputShareAuthority;
  proofs.set(proof, { env, db, environment: capturedEnvironment, custody: { kind: "text", proof: custody }, snapshot, assertion });
  return proof;
}

async function readMediaAuthority(env: WorkerEnv, custody: NativeRetainedMediaCustody): Promise<SelectedOutputShareAuthority> {
  const db = env.DB, capturedEnvironment = environment(env), native = nativeRetainedMediaCustodySnapshot(custody, env), custodyAssertion = nativeRetainedMediaCustodyAssertion(custody, env);
  const policy = await admissionDeadline(env, native);
  const schema = await sponsorSchema(env), cte = provenanceQuery(schema.names, true);
  const bindings: SqlValue[] = [native.completionId, `creative:${native.identity.userId}`, native.identity.userId, native.selection.documentId];
  const result = await db.prepare(`WITH ${cte} SELECT witness FROM bounded_selected_share_jobs LIMIT 2`).bind(...bindings).all<{ witness: string }>();
  if (!result.success || result.results.length !== 1 || typeof result.results[0]?.witness !== "string" || bytes(result.results[0].witness) > WITNESS_BYTES) return fail();
  const raw = result.results[0].witness, source = validateMediaWitness(raw, native);
  const snapshot = Object.freeze({ ...source, expiresAt: policy.expiresAt && policy.expiresAt < source.expiresAt ? policy.expiresAt : source.expiresAt });
  const assertion = Object.freeze([
    selectedSharePredicateProof(schema.assertion), selectedShareProofQuery(custodyAssertion.sql, custodyAssertion.bindings),
    selectedSharePredicateProof(policy.assertion),
    selectedShareProofQuery(`WITH ${cte}
      SELECT 1 AS admitted FROM bounded_selected_share_jobs WHERE CAST(witness AS BLOB)=CAST(? AS BLOB)
        AND (SELECT COUNT(*) FROM selected_share_jobs)=1`, [...bindings, raw]),
  ]);
  const statement = selectedShareProofStatement(assertion);
  const final = await db.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`)
    .bind(...statement.bindings).first<{ admitted: number }>();
  if (env.DB !== db || environment(env) !== capturedEnvironment || final?.admitted !== 1 || Date.parse(snapshot.expiresAt) <= Date.now()) return fail();
  nativeRetainedMediaCustodySnapshot(custody, env);
  const proof = Object.freeze({}) as SelectedOutputShareAuthority;
  proofs.set(proof, { env, db, environment: capturedEnvironment, custody: { kind: "media", proof: custody }, snapshot, assertion });
  return proof;
}

/** The exported assertion includes BOTH current native custody and completed
 * actor-paid provenance. Callers must execute it again at commit/public read. */
export async function readSelectedOutputShareAuthority(env: WorkerEnv, custody: NativeRetainedTextCustody): Promise<SelectedOutputShareAuthority> {
  try { return await readAuthority(env, custody); } catch { return fail(); }
}


/** Detached media authority. Native custody must be authentic and current; this
 * proof alone neither qualifies media bytes nor authorizes a public link. */
export async function readSelectedOutputShareMediaAuthority(env: WorkerEnv, custody: NativeRetainedMediaCustody): Promise<SelectedOutputShareAuthority> {
  try { return await readMediaAuthority(env, custody); } catch { return fail(); }
}

function state(proof: SelectedOutputShareAuthority, env: WorkerEnv): State {
  const captured = proof && typeof proof === "object" ? proofs.get(proof) : undefined;
  if (!captured || captured.env !== env || captured.db !== env.DB || captured.environment !== environment(env)
    || Date.parse(captured.snapshot.expiresAt) <= Date.now()) return fail();
  if (captured.custody.kind === "text") nativeRetainedTextCustodySnapshot(captured.custody.proof, env);
  else nativeRetainedMediaCustodySnapshot(captured.custody.proof, env);
  return captured;
}
export function selectedOutputShareAuthoritySnapshot(proof: SelectedOutputShareAuthority, env: WorkerEnv): Snapshot {
  return Object.freeze({ ...state(proof, env).snapshot });
}
export function selectedOutputShareAuthorityAssertion(proof: SelectedOutputShareAuthority, env: WorkerEnv): readonly SelectedShareProofQuery[] {
  const assertion = state(proof, env).assertion;
  return Object.freeze(assertion.map(query => selectedShareProofQuery(query.sql, query.bindings)));
}
