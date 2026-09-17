import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { beginSponsorOutputAssetRead, requireSponsorOutputAssetRead, type SponsorOutputAssetRead } from "./experience-sponsor-output-asset-read.ts";
import { sponsorOutputAssetReadEnvironment } from "./experience-sponsor-output-read-budget.ts";
import { sponsorImageResponseBody } from "./experience-sponsor-native-image-budget.ts";
import { sponsorJobReadFailure } from "./experience-sponsor-job-read.ts";
import { hasProjectContextCookie } from "./project-request-context.ts";
import { prepareOutputDurableRun, wakeOutputDurableJobs } from "./output-durable-control.ts";
import { exactKeys, jsonIssues } from "../src/experiences/compiler.ts";
import { readOutputModel3dPayload, requireModel3dMiniAppCostApproval } from "./output-model3d-execution.ts";
import { requireSponsorAdmission, sponsorAdmissionPayer, sponsorAdmissionPlan, sponsorSceneAdmissionPreparation, sponsorAudioAdmissionPreparation, type SponsorAdmissionAuthority } from "./experience-sponsor-admission.ts";
import { requireSponsorExecution, sponsorSceneRunPreparation, sponsorAudioRunPreparation, type SponsorExecutionAuthority } from "./experience-sponsor-execution.ts";
import { prepareSceneSponsorAdmission, prepareSceneSponsorRun, requireSceneSponsorAdmissionForTarget, requireSceneSponsorAdmissionCurrent, sceneSponsorRunTransaction } from "./output-scene-sponsored-handoff.ts";
import { prepareAudioSponsorAdmission, prepareAudioSponsorRun, requireAudioSponsorAdmissionForTarget, requireAudioSponsorAdmissionCurrent, audioSponsorRunTransaction } from "./output-audio-sponsored-handoff.ts";
import { readSponsorInternalCommand } from "./experience-sponsor-approval.ts";
import { readSponsoredAudioActorRequest, readSponsoredAudioReview } from "../src/experiences/sponsored-audio-actor-intent.ts";
import { outputModel3dPreflightAssertions } from "./output-model3d-preflight.ts";
import { model3dMiniAppAttemptMatches } from "../src/model/model3d-mini-app-consent.ts";
import { resolveOutputModel3dRecoverySource } from "./output-model3d-source.ts";
import { parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { requireAudioMiniAppCostApproval } from "./output-audio-execution.ts";
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { outputAudioPreflightAssertions } from "./output-audio-preflight.ts";
import { outputVideoPreflightProof, requireOutputVideoOriginal } from "./output-video-preflight.ts";
import { outputStoryboardPreflightProof } from "./output-storyboard-preflight.ts";
import { readStoryboardExecutionOffer } from "../src/model/output-storyboard-offer.ts";
import { requireSceneMiniAppCostApproval } from "./scene-mini-app-consent.ts";
import type { SceneSourceVersion } from './scene-source-generation.ts';
import { readSceneJobSourceWitness } from './scene-job-source-witness.ts';
import { foldEvents, type CreativeEvent, type CreativeProjection } from "../src/model/events.ts";
import { inspectOutputRequirement, outputCountSatisfies, outputRequirementInterpretationNeedsReview, type OutputRequirementSpec } from "../src/model/output-requirements.ts";
import { compileOutputPlan, type OutputPlan, type OutputPlanTarget } from "../src/model/output-plan.ts";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES, MAX_OUTPUT_MODEL3D_ASSET_BYTES, validOutputAssetName, type OutputAssetInspection } from "../src/model/output-asset-inspection.ts";
import { createOutputDeliveryArchive, createOutputDeliveryArchiveStream, outputDeliveryScopeForPlan, planOutputDeliveryParts, type OutputDeliveryManifestInput, type OutputDeliveryScopeInput, type OutputDeliveryPart, type OutputDeliveryScopeAmendmentInput } from "../src/model/output-delivery-archive.ts";
import { OUTPUT_PREFLIGHT_TARGET_MAX_COUNT } from "../src/model/output-delivery-contract.ts";
import type { OutputAssetRow, OutputCommandResponse, OutputConfirmedPlan, OutputConfirmationOptions, OutputPlanSuggestions, OutputGrantRow, OutputNativeTargetPreflight, OutputPreflight, OutputRequirementRow, OutputRequirementsSnapshot, OutputResultRow } from "../src/model/output-delivery-contract.ts";
import { outputScopeAmendmentReasonIssue } from "../src/model/output-scope-amendment.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority.ts";
import { captureOutputGovernanceAssertions } from "./output-requirement-governance-assertions.ts";
import type { OutputGovernanceWitness } from "./output-governance-witness.ts";
import { claimOutputAssetStorage, acknowledgeOutputAssetStorage, cleanupOutputAssetStorage, outputAssetPublicationAssertion, outputAssetPublicationStatements } from "./output-asset-storage-control.ts";
import { outputAssetObjectKeys, outputAssetStorageCustodyMatches } from "./output-asset-storage-identity.ts";
import { verifyOutputSourceEvidence, type OutputSourceEvidenceCheck } from "./output-source-evidence-capacity.ts";
import { hasCapability, requireUser, type PilotUser } from "./pilot-policy.ts";
import type { ProjectRequestContext } from "./project-access.ts";
import { readEvents, streamHead, uuidV7, type EventRow, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";
import { commitOutputCommand, ensureOutputRequirementsSchema, outputAssertionStatements, outputScopeAuthority, outputSourceEpochAssertion, parseOutputRevision, OutputConflictError, readOutputCommand, readOutputSlots, outputSlotFromRow,
  retainedOutputBodyAssertions, rememberOutputPrivateBody, inheritRetainedOutputPrivateBodies, outputCommandReceiptAssertion,
  type OutputCommandReceipt, type OutputCommandPermission, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion, type OutputCommandWrite } from "./output-requirements-ledger.ts";

import { outputBulkDeliveryAssertion, outputAssetReadAssertions, MAX_OUTPUT_DELIVERY_PART_READS, type OutputReadModel, type OutputBulkAssetEvidence } from "./output-requirements-read-model.ts";
import { idPattern, record, json, fail, identifier, ownedBuffer, canonicalOutputJson, outputDigest, captureOutputPrivateSources, outputProofReadStatements, outputActiveSourceDeadlineAssertions, discloseOutputResponse, discloseOutputJson } from "./output-disclosure-proof.ts";
import { continueOutputTrustedContext, OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY, OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT, outputSourceDigests, outputRequirements, normalizePlanSuggestions, readOutputProjectSourceSnapshot } from "./output-trusted-context.ts";
import { outputReviewEligibility, readOutputModel } from "./output-read-model-producer.ts";
import { buildSnapshot, retainedOutputAmendments } from "./output-requirements-snapshot.ts";
export { canonicalOutputJson, outputDigest, outputActiveSourceDeadlineAssertions, outputReviewEligibility };

const BASE = "/api/output-requirements";
const RESOLVER_VERSION = "output-plan-v1";
const VALIDATION_POLICY = "output-owned-file-v1";
const MAX_COMMAND_BYTES = 512_000;
const nowIso = () => new Date().toISOString();
/** Internal model bytes are privately owned for this request; avoid a second 64 MiB allocation. */
const assetBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.byteLength > MAX_OUTPUT_ASSET_BYTES && bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : ownedBuffer(bytes);


export type OutputTrustedContext = {
  request: Request; env: WorkerEnv; scope: OutputScope; principal: PilotUser; projectContext: ProjectRequestContext | null;
  events: CreativeEvent[]; projection: CreativeProjection; ownerHead: number; projectHead: number;
  requirements: OutputRequirementRow[]; requirementsDigest: string; sourceDigest: string;
  context: ReturnType<typeof authoritativeCreativeContext> | null; sourceProblems: string[];
  sourceAssertions: OutputSqlAssertion[];
  /** Internal adapters only: exact original command body retained with its atomic receipt. */
  retainedCommandEnvelope?: Record<string, unknown>;
  sourcePrivateCaptured: boolean;
  sourceEvidence: OutputSourceEvidenceCheck;
  governanceWitness?: OutputGovernanceWitness;
};
export type OutputBridgeTargetInput = {
  request: Request; env: WorkerEnv; scope: OutputScope; principal: PilotUser;
  confirmedPlan: OutputConfirmedPlan; target: OutputPlanTarget;
  context: ReturnType<typeof authoritativeCreativeContext>;
  /** Captured owner stream epoch; required by cross-Document Video source custody. */
  ownerHead?: number;
  /** Already authorized source events for read-only reference rights verification. */
  sourceEvents?: readonly CreativeEvent[];
  /** Current retained source assertions, required by native Scene. */
  sourceAssertions?: readonly OutputSqlAssertion[];
  /** Private original/same-transaction successor; never a wire authority. */
  sceneSourceVersion?: SceneSourceVersion;
  /** Initial server preparation only. Execution must provide its persisted
   * successor instead of asking for a newly captured source baseline. */
  sceneUseVersionedHistory?: boolean;
  sourceDigest: string; requirementsDigest: string;
};
export type OutputPreparedAdmission = {
  /** Retained source proofs run before command events in the same admission transaction. */
  sourceAssertions?: OutputSqlAssertion[];
  sceneJobAdmissions?: OutputCommandWrite['sceneJobAdmissions'];
  /** Existing queue-anchor events, known before transaction allocation. No creative text in public envelopes. */
  events: Array<{ type: string; payload: Record<string, unknown> }>;
  /** Must be side-effect free until these statements run in the enclosing D1 batch. */
  buildStatements: (events: EventRow[]) => { statements: D1PreparedStatement[]; assertions: OutputSqlAssertion[] };
};
export interface OutputExecutionBridge {
  preflight(input: OutputBridgeTargetInput): Promise<OutputNativeTargetPreflight>;
  prepareAdmission(input: Omit<OutputBridgeTargetInput, "target"> & {
    grantId: string; preflight: OutputPreflight; slots: OutputOperationSlot[]; governanceWitness?: OutputGovernanceWitness; sceneCostConsent?: unknown; audioCostConsent?: unknown; model3dCostConsent?: unknown;
    sponsorAdmission?: SponsorAdmissionAuthority;
  }): Promise<OutputPreparedAdmission>;
  /** May schedule existing admitted job IDs only. The runner rechecks slot/grant/current authority before every call. */
  dispatch(input: { request: Request; env: WorkerEnv; scope: OutputScope; principal: PilotUser; executionContext: WorkerExecutionContext; slots: OutputOperationSlot[] }): Promise<void>;
  /** Resolve only a successful authorized ordinary/native result. Rejected private drafts are never candidates. */
  resolveResult?(input: OutputBridgeTargetInput & { nativeJobId: string }): Promise<{ bytes: Uint8Array; name: string; origin: Record<string, unknown>; assertions: OutputSqlAssertion[] }>;
  cleanupExpiredOrRevoked?(input: { request: Request; env: WorkerEnv; scope: OutputScope; principal: PilotUser; slots: OutputOperationSlot[] }): Promise<void>;
}

export { retainedOutputBodyAssertions, rememberOutputPrivateBody } from "./output-requirements-ledger.ts";

/** Read the real selected project; no owner-account fallback for a governed Document. */
export async function loadOutputTrustedContext(request: Request, env: WorkerEnv, documentId: string, permission: OutputCommandPermission = "read"): Promise<OutputTrustedContext | Response> {
  identifier(documentId, "document_id_required");
  const auth = await requireUser(request, env, "viewer", { account: "principal" });
  return continueOutputTrustedContext(request, env, documentId, permission, auth);
}

const sourceDeadlinePrepared = new WeakSet<OutputTrustedContext>();

function requireCurrentSource(trusted: OutputTrustedContext) {
  if (!trusted.context || trusted.sourceProblems.length) fail(trusted.sourceProblems[0] ?? "source_context_unavailable", 409);
  if (!sourceDeadlinePrepared.has(trusted)) {
    trusted.sourceAssertions.push(...outputActiveSourceDeadlineAssertions(trusted.context));
    sourceDeadlinePrepared.add(trusted);
  }
  return trusted.context;
}


async function privateEventBody(env: WorkerEnv, scope: OutputScope, eventId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=? AND redacted_at IS NULL")
    .bind(eventId, scope.ownerUserId, scope.projectId, scope.documentId).first<{ private_json: string }>();
  if (!row) fail("output_private_evidence_unavailable", 410);
  return rememberOutputPrivateBody(scope, eventId, row.private_json);
}


async function readConfirmedPlan(trusted: OutputTrustedContext, requestedId?: string): Promise<OutputConfirmedPlan | null> {
  const row = await trusted.env.DB.prepare(`SELECT * FROM output_plan_revisions WHERE scope_key=? AND document_id=? ${requestedId ? "AND plan_revision_id=?" : ""} ORDER BY revision DESC LIMIT 1`)
    .bind(trusted.scope.key, trusted.scope.documentId, ...(requestedId ? [requestedId] : [])).first<Record<string, unknown>>();
  if (!row) return null;
  const body = await privateEventBody(trusted.env, trusted.scope, String(row.confirmed_event_id));
  const stored = record(body.confirmed_plan);
  if (!stored.plan || stored.revisionId !== row.plan_revision_id || stored.sourceDigest !== row.source_digest || stored.requirementsDigest !== row.requirements_digest) fail("output_plan_evidence_mismatch", 409);
  return stored as OutputConfirmedPlan;
}

function currentPlan(trusted: OutputTrustedContext, plan: OutputConfirmedPlan | null): OutputConfirmedPlan {
  if (!plan) fail("confirmed_output_plan_required", 409);
  if (plan.requirementsDigest !== trusted.requirementsDigest || plan.sourceDigest !== trusted.sourceDigest) fail("output_plan_needs_reconfirmation", 409);
  return plan;
}

export async function outputTargetContractDigest(target: OutputPlanTarget, sourceDigest: string) {
  const { selected: _selected, ordinal: _ordinal, label: _label, requirement_revision: _requirementRevision, suggested_count: _suggestedCount, source_revision: _sourceRevision, ...contract } = target;
  return outputDigest({ policy: VALIDATION_POLICY, sourceDigest, contract });
}

function requireCompleteOutputReadModel(model: OutputReadModel) {
  if (!model.complete) fail(model.reasonCodes[0] ?? "output_read_model_unavailable", 503);
  return model;
}
async function readAssets(trusted: OutputTrustedContext): Promise<OutputAssetRow[]> { return (await readOutputModel(trusted)).assets; }
async function readResults(trusted: OutputTrustedContext): Promise<OutputResultRow[]> { return (await readOutputModel(trusted)).results; }
async function readGrants(trusted: OutputTrustedContext): Promise<OutputGrantRow[]> { return (await readOutputModel(trusted)).grants; }


/** Trusted worker-only resolver shared by admission, dispatch, provider guards and recovery. */
export async function loadOutputCurrentContext(env: WorkerEnv, scope: OutputScope) {
  const authority = outputScopeAuthority(scope, "request");
  const projectSource = scope.kind === "project" ? await readOutputProjectSourceSnapshot(env, scope, "request") : null;
  const initial = projectSource ?? await env.DB.prepare(`SELECT (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS head WHERE (${authority.sql})`)
    .bind(`creative:${scope.ownerUserId}`, ...(authority.bindings ?? [])).first<{ head: number }>();
  if (!initial) fail("output_execution_authority_revoked", 403);
  const head = Number(initial.head);
  const events = projectSource?.events ?? await readEvents(env, `creative:${scope.ownerUserId}`);
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, scope.documentId, scope.projectId);
  if (!projection.documents.some((document) => document.id === scope.documentId && document.projectId === scope.projectId && !document.removed)) fail("document_not_found", 404);
  const requirements = outputRequirements(projection);
  const context = authoritativeCreativeContext(events, { documentId: scope.documentId, projectId: scope.projectId });
  const digests = await outputSourceDigests(projection, requirements, scope.documentId, scope.projectId, context);
  const governanceAssertions = scope.organizationId ? await captureOutputGovernanceAssertions(env, scope.organizationId, projection.blocks, { deferValidation: true, maximumCaptureBatches: OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT }) : [];
  const sourceAssertion = await captureOutputPrivateSources(env, scope, events, projection, head, [authority, ...(projectSource ? [projectSource.assertion] : []), ...governanceAssertions]);
  const sourceEvidence = await verifyOutputSourceEvidence(env, scope.ownerUserId, projection.blocks, { maximumDistinctObjects: OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY });
  if (sourceEvidence.reasonCode) fail(sourceEvidence.reasonCode, 409);
  return { ...digests, context, head, events, requirements, assertions: [authority, ...(projectSource ? [projectSource.assertion] : []), ...sourceAssertion, ...governanceAssertions, ...outputActiveSourceDeadlineAssertions(context), { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${scope.ownerUserId}`, head] }] as OutputSqlAssertion[] };
}

/** A time bound for the same currently selected request capability, not new authority. */
function outputRequestDeadlineCapture(scope: OutputScope): OutputSqlAssertion | null {
  if (scope.kind !== "project") return null;
  return { sql: `(SELECT json_array(selected.expires_at,project.owner_user_id,
      (SELECT member.role FROM project_memberships member WHERE member.project_access_id=project.project_access_id
        AND member.organization_id=project.organization_id AND member.project_id=project.project_id AND member.user_id=?
        AND member.status='active' AND member.revoked_at IS NULL),
      json((SELECT json_group_array(json_array(grant_id,expires_at)) FROM (
        SELECT grant_id,expires_at FROM capability_grants WHERE user_id=? AND capability='project.output.request'
          AND scope_type='project' AND organization_id=project.organization_id AND project_access_id=project.project_access_id
          AND status='active' AND revoked_at IS NULL ORDER BY grant_id))))
    FROM project_context_sessions selected JOIN organization_projects project
      ON project.project_access_id=selected.project_access_id AND project.organization_id=selected.organization_id
    WHERE selected.context_id=? AND selected.principal_user_id=? AND selected.project_access_id=?
      AND selected.organization_id=? AND project.project_id=? AND project.owner_user_id=?)`,
    bindings: [scope.actorUserId, scope.actorUserId, scope.contextId, scope.actorUserId, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId] };
}
function outputRequestDeadline(scope: OutputScope, raw: unknown) {
  if (scope.kind !== "project") return null;
  if (typeof raw !== "string" || raw.length > 32_768) fail("output_execution_authority_revoked", 403);
  const tuple: unknown = JSON.parse(raw);
  if (!Array.isArray(tuple) || tuple.length !== 4 || typeof tuple[0] !== "string" || !Number.isFinite(Date.parse(tuple[0]))
    || tuple[1] !== scope.ownerUserId || !Array.isArray(tuple[3]) || tuple[3].length > 128) fail("output_execution_authority_revoked", 403);
  const deadlines = tuple[3].map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string"
      || row[1] !== null && (typeof row[1] !== "string" || !Number.isFinite(Date.parse(row[1])))) fail("output_execution_authority_revoked", 403);
    return row[1] === null ? Number.POSITIVE_INFINITY : Date.parse(row[1]);
  });
  const permissionDeadline = scope.actorUserId === scope.ownerUserId || tuple[2] === "editor"
    ? Number.POSITIVE_INFINITY : Math.max(...deadlines);
  return Math.min(Date.parse(tuple[0]), permissionDeadline);
}

type OutputGrantEvidence = { row: Record<string, unknown>; authorization: Record<string, unknown>; confirmedPlan: OutputConfirmedPlan; preflight: OutputPreflight; slots: OutputOperationSlot[] };

/** One scoped read retains both immutable creative bodies; it never synthesizes a grant. */
async function readOutputGrantEvidence(env: WorkerEnv, scope: OutputScope, grantId: string, includeSlots = false): Promise<OutputGrantEvidence> {
  const requestDeadline = outputRequestDeadlineCapture(scope);
  const statements = [env.DB.prepare(`SELECT grant_row.*,plan.confirmed_event_id,plan.source_digest AS plan_source_digest,plan.requirements_digest AS plan_requirements_digest,
      preflight.event_id AS preflight_event_id,preflight.terms_digest,plan_body.private_json AS plan_private_json,preflight_body.private_json AS preflight_private_json,
      authorization_body.private_json AS authorization_private_json,
      ${requestDeadline?.sql ?? "NULL"} AS dispatch_scope,
      grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS deadline_current
    FROM output_execution_grants grant_row JOIN output_plan_revisions plan ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
    JOIN output_preflights preflight ON preflight.scope_key=grant_row.scope_key AND preflight.preflight_id=grant_row.preflight_id
    LEFT JOIN event_private_payloads plan_body ON plan_body.private_event_id=plan.confirmed_event_id AND plan_body.owner_id=plan.owner_user_id AND plan_body.project_id=plan.project_id AND plan_body.document_id=plan.document_id AND plan_body.redacted_at IS NULL
    LEFT JOIN event_private_payloads preflight_body ON preflight_body.private_event_id=preflight.event_id AND preflight_body.owner_id=plan.owner_user_id AND preflight_body.project_id=plan.project_id AND preflight_body.document_id=plan.document_id AND preflight_body.redacted_at IS NULL
    LEFT JOIN event_private_payloads authorization_body ON authorization_body.private_event_id=grant_row.authorization_event_id AND authorization_body.owner_id=plan.owner_user_id AND authorization_body.project_id=plan.project_id AND authorization_body.document_id=plan.document_id AND authorization_body.redacted_at IS NULL
    WHERE grant_row.scope_key=? AND grant_row.grant_id=? AND grant_row.actor_user_id=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=?`)
    .bind(...(requestDeadline?.bindings ?? []), scope.key, grantId, scope.actorUserId, scope.documentId, scope.projectId, scope.ownerUserId)];
  if (includeSlots) statements.push(env.DB.prepare(`SELECT slot.* FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    WHERE slot.scope_key=? AND slot.grant_id=? AND grant_row.actor_user_id=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=? ORDER BY slot.created_at,slot.slot_id`)
    .bind(scope.key, grantId, scope.actorUserId, scope.documentId, scope.projectId, scope.ownerUserId));
  const [grantResult, slotsResult] = await env.DB.batch<Record<string, unknown>>(statements);
  const row = grantResult.results[0];
  if (!row) fail("output_execution_grant_not_found", 404);
  if (row.context_id !== scope.contextId) fail("output_execution_context_changed", 403);
  if (typeof row.plan_private_json !== "string" || typeof row.preflight_private_json !== "string" || typeof row.authorization_private_json !== "string") fail("output_private_evidence_unavailable", 410);
  const confirmedPlan = record(rememberOutputPrivateBody(scope, String(row.confirmed_event_id), row.plan_private_json).confirmed_plan) as OutputConfirmedPlan;
  const preflight = record(rememberOutputPrivateBody(scope, String(row.preflight_event_id), row.preflight_private_json).preflight) as OutputPreflight;
  const authorization = rememberOutputPrivateBody(scope, String(row.authorization_event_id), row.authorization_private_json);
  if (confirmedPlan.id !== scope.documentId || confirmedPlan.revisionId !== row.plan_revision_id || confirmedPlan.sourceDigest !== row.plan_source_digest || confirmedPlan.requirementsDigest !== row.plan_requirements_digest
    || preflight.id !== row.preflight_id || preflight.planRevisionId !== confirmedPlan.revisionId || preflight.termsDigest !== row.terms_digest || authorization.grant_id !== row.grant_id) fail("output_execution_contract_changed", 409);
  return { row, authorization, confirmedPlan, preflight, slots: (slotsResult?.results ?? []).map((slot) => outputSlotFromRow(scope.key, slot)) };
}

async function validateOutputExecutionTarget(current: { sourceDigest: string; requirementsDigest: string }, evidence: OutputGrantEvidence, slot: OutputOperationSlot) {
  const { confirmedPlan, preflight } = evidence;
  const target = confirmedPlan.plan?.targets.find((candidate) => candidate.id === slot.targetId);
  const targetPreflight = preflight.targets?.find((candidate) => candidate.targetId === slot.targetId);
  if (evidence.row.grant_id !== slot.grantId || confirmedPlan.revisionId !== slot.planRevisionId || !target || !target.selected || target.blocking_issues.length || !targetPreflight?.available
    || current.sourceDigest !== slot.sourceDigest || confirmedPlan.sourceDigest !== current.sourceDigest || confirmedPlan.requirementsDigest !== current.requirementsDigest || confirmedPlan.targetContractDigests[target.id] !== slot.targetContractDigest
    || await outputTargetContractDigest(target, current.sourceDigest) !== slot.targetContractDigest || await outputDigest(targetPreflight) !== slot.routeDigest) fail("output_execution_contract_changed", 409);
  return { target, targetPreflight };
}

export async function resolveOutputExecutionAuthority(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot) {
  if (scope.key !== slot.scopeKey) fail("output_execution_scope_mismatch", 403);
  const current = await loadOutputCurrentContext(env, scope);
  const evidence = await readOutputGrantEvidence(env, scope, slot.grantId);
  if (!["authorized", "active"].includes(String(evidence.row.status)) || !Number(evidence.row.deadline_current)) fail("output_execution_grant_inactive", 403);
  const { target, targetPreflight } = await validateOutputExecutionTarget(current, evidence, slot);
  const grantDeadline = Date.parse(String(evidence.row.expires_at));
  if (!Number.isFinite(grantDeadline)) fail("output_execution_grant_inactive", 403);
  const requestCapture = outputRequestDeadlineCapture(scope), requestDeadline = outputRequestDeadline(scope, evidence.row.dispatch_scope);
  const deadlineAssertions: OutputSqlAssertion[] = [{ sql: "EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS ? AND expires_at=?)",
    bindings: [scope.key, slot.grantId, scope.actorUserId, scope.contextId, String(evidence.row.expires_at)], deadlineMs: grantDeadline }];
  if (requestCapture && requestDeadline !== null) deadlineAssertions.push({ sql: `${requestCapture.sql}=?`, bindings: [...(requestCapture.bindings ?? []), String(evidence.row.dispatch_scope)], deadlineMs: requestDeadline });
  return { ...current, confirmedPlan: evidence.confirmedPlan, target, preflight: evidence.preflight, targetPreflight, assertions: [...current.assertions, ...retainedOutputBodyAssertions(scope), ...deadlineAssertions] };
}

/** Current read/publication proof for the original personal Image result. This
 * deliberately does not grant a provider dispatch deadline or paid capability. */
export async function resolveOutputFalRecoveryAuthority(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot){
  if(scope.kind!=="personal"||scope.contextId!==null||scope.organizationId!==null||scope.projectAccessId!==null||scope.key!==slot.scopeKey
    ||scope.actorUserId!==scope.ownerUserId||slot.attemptOrdinal!==0||slot.previousSlotId!==null)fail("output_fal_recovery_scope_unsupported",403);
  const current=await loadOutputCurrentContext(env,scope),evidence=await readOutputGrantEvidence(env,scope,slot.grantId);
  if(!["authorized","active","completed"].includes(String(evidence.row.status)))fail("output_execution_grant_inactive",403);
  const {target,targetPreflight}=await validateOutputExecutionTarget(current,evidence,slot);
  if(target.media_kind!=="image"||targetPreflight.provider!=="fal"||targetPreflight.route!=="document-image-fal-manual-v1")fail("output_fal_recovery_route_unsupported",403);
  const proof=prepareOutputExecutionProof(scope,{...current,confirmedPlan:evidence.confirmedPlan,target,preflight:evidence.preflight,targetPreflight,
    assertions:[...current.assertions,...retainedOutputBodyAssertions(scope),{sql:`EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS NULL AND status IN('authorized','active','completed'))`,bindings:[scope.key,slot.grantId,scope.actorUserId]}]});
  return proof;
}

/** Original Video read/publication authority, never paid dispatch. */
export async function resolveOutputVideoRecoveryAuthority(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot){
  if(scope.kind!=="personal"||scope.contextId!==null||scope.organizationId!==null||scope.projectAccessId!==null||scope.key!==slot.scopeKey
    ||scope.actorUserId!==scope.ownerUserId||slot.attemptOrdinal!==0||slot.previousSlotId!==null)fail("output_video_recovery_scope_unsupported",403);
  const current=await loadOutputCurrentContext(env,scope),evidence=await readOutputGrantEvidence(env,scope,slot.grantId);
  if(!["authorized","active","completed"].includes(String(evidence.row.status)))fail("output_execution_grant_inactive",403);
  const {target,targetPreflight}=await validateOutputExecutionTarget(current,evidence,slot);
  if(target.media_kind!=="video"||targetPreflight.provider!=="fal"||targetPreflight.route!=="document-video-owned-still-four-seconds-manual-v1")fail("output_video_recovery_route_unsupported",403);
  const proof=prepareOutputExecutionProof(scope,{...current,confirmedPlan:evidence.confirmedPlan,target,preflight:evidence.preflight,targetPreflight,
    assertions:[...current.assertions,...retainedOutputBodyAssertions(scope),{sql:`EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS NULL AND status IN('authorized','active','completed'))`,bindings:[scope.key,slot.grantId,scope.actorUserId]}]});
  return proof;
}

/** Original Audio read/publication authority, never renewed paid dispatch. */
export async function resolveOutputAudioRecoveryAuthority(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot){
  if(scope.kind!=="personal"||scope.contextId!==null||scope.organizationId!==null||scope.projectAccessId!==null||scope.key!==slot.scopeKey
    ||scope.actorUserId!==scope.ownerUserId||slot.attemptOrdinal!==0||slot.previousSlotId!==null)fail("output_audio_recovery_scope_unsupported",403);
  const current=await loadOutputCurrentContext(env,scope),evidence=await readOutputGrantEvidence(env,scope,slot.grantId);
  if(!["authorized","active","completed"].includes(String(evidence.row.status)))fail("output_execution_grant_inactive",403);
  const {target,targetPreflight}=await validateOutputExecutionTarget(current,evidence,slot);
  if(target.media_kind!=="audio"||targetPreflight.provider!=="fal"||targetPreflight.model!=="fal-ai/stable-audio-3/medium/text-to-audio"
    ||targetPreflight.route!=="document-audio-timed-music-manual-v1")fail("output_audio_recovery_route_unsupported",403);
  return prepareOutputExecutionProof(scope,{...current,confirmedPlan:evidence.confirmedPlan,target,preflight:evidence.preflight,targetPreflight,
    assertions:[...current.assertions,...retainedOutputBodyAssertions(scope),{sql:`EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS NULL AND status IN('authorized','active','completed'))`,bindings:[scope.key,slot.grantId,scope.actorUserId]}]});
}

/** Authority to read and publish one already accepted original, never to submit
 * a replacement or renew its paid dispatch deadline. The recovery lease must
 * additionally bind the private checkpoint and the original provider call. */
export async function resolveOutputModel3dRecoveryAuthority(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot, caller?: {request:Request;user:PilotUser}){
  if(scope.kind!=="personal"||scope.contextId!==null||scope.organizationId!==null||scope.projectAccessId!==null||scope.key!==slot.scopeKey
    ||scope.actorUserId!==scope.ownerUserId||!(slot.attemptOrdinal===0&&slot.previousSlotId===null
      ||slot.attemptOrdinal===1&&Boolean(slot.previousSlotId)&&caller?.user.userId===scope.actorUserId))fail("output_model3d_recovery_scope_unsupported",403);
  const current=await loadOutputCurrentContext(env,scope),evidence=await readOutputGrantEvidence(env,scope,slot.grantId);
  if(!["authorized","active","completed"].includes(String(evidence.row.status)))fail("output_execution_grant_inactive",403);
  const {target,targetPreflight}=await validateOutputExecutionTarget(current,evidence,slot);
  const payload=await readOutputModel3dPayload(targetPreflight.settings.payload);
  if(target.media_kind!=="model3d"||targetPreflight.provider!=="fal"||targetPreflight.route!=="model3d-mini-app-static-glb-v1"
    ||targetPreflight.maximumCalls!==1||!payload||targetPreflight.model!==payload.preview.model
    ||payload.preview.requestId!==slot.jobId||payload.preview.documentId!==scope.documentId
    ||payload.preview.projectId!==scope.projectId||payload.preview.actorUserId!==scope.actorUserId||!model3dMiniAppAttemptMatches(payload.preview,slot))
    fail("output_model3d_recovery_route_unsupported",403);
  // Reference recovery rechecks the same owned origin, distinct Document copy,
  // rights, exact pixels and retention through the actual current caller. The
  // retained provider receipt alone never grants current source authority.
  const needsSource=slot.attemptOrdinal===1||payload.contract.reference!==null;
  if(needsSource&&(!caller||caller.user.userId!==scope.actorUserId))fail("output_model3d_recovery_scope_unsupported",403);
  const originalSource=needsSource?await resolveOutputModel3dRecoverySource({request:caller!.request,env,scope,principal:caller!.user,
    confirmedPlan:evidence.confirmedPlan,target,context:current.context,sourceEvents:current.events,sourceAssertions:current.assertions,
    sourceDigest:current.sourceDigest,requirementsDigest:current.requirementsDigest},slot):null;
  if(originalSource&&(originalSource.requestId!==slot.jobId||originalSource.expiresAt!==payload.preview.expiresAt
    ||(slot.attemptOrdinal===0?originalSource.replacement!==null:
      originalSource.replacement?.id!==payload.preview.replacementCycleId||originalSource.replacement?.predecessor.providerRequestId!==payload.preview.previousProviderRequestId)))fail("output_model3d_recovery_route_unsupported",403);
  return prepareOutputExecutionProof(scope,{...current,confirmedPlan:evidence.confirmedPlan,target,preflight:evidence.preflight,targetPreflight,
    assertions:[...current.assertions,...(originalSource?.sourceAssertions??[]),...retainedOutputBodyAssertions(scope),{sql:`EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS NULL AND status IN('authorized','active','completed'))`,bindings:[scope.key,slot.grantId,scope.actorUserId]}]});
}

/** Reuse retained evidence only while every later event is proven nonsemantic.
 * Scope/grant/slot/deadline checks remain live SQL at each write and provider call.
 */
export function prepareOutputExecutionProof(scope: OutputScope, authority: Awaited<ReturnType<typeof resolveOutputExecutionAuthority>>) {
  if (authority.confirmedPlan.id !== scope.documentId || authority.confirmedPlan.sourceDigest !== authority.sourceDigest) fail("output_execution_scope_mismatch", 403);
  const sourceEpoch = { head: authority.head, sourceDigest: authority.sourceDigest };
  let replaced = 0;
  const assertions = authority.assertions.map((assertion) => {
    if (assertion.sql === "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?" && assertion.bindings?.[0] === `creative:${scope.ownerUserId}`) {
      // The Document and a governed origin can share this owner. Every such
      // capture must agree on the exact same head before using the same epoch.
      if (assertion.bindings.length !== 2 || assertion.bindings[1] !== authority.head) fail("output_source_epoch_required", 403);
      replaced++; return outputSourceEpochAssertion(scope, sourceEpoch);
    }
    return assertion;
  });
  if (replaced < 1) fail("output_source_epoch_required", 403);
  return { ...authority, sourceEpoch, assertions };
}

function isGovernancePlanningCapacity(code: string) {
  return code === "output_source_governance_capacity_exceeded" || code === "output_source_governance_proof_too_large";
}

function commandWrite(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, permission: OutputCommandPermission): Pick<OutputCommandWrite, "scope" | "permission" | "expectedHead" | "expectedProjectHead" | "key" | "digest" | "action" | "sourceAssertions" | "retainedEnvelope"> {
  const expected = parseOutputRevision(body.expectedRevision);
  if (expected !== trusted.ownerHead) fail("output_revision_conflict", 409);
  const freeStructureEdit = permission === "author" && ["save", "confirm"].includes(String(body.action));
  const sourceProblem = trusted.sourceProblems.find((code) => code.startsWith("output_source_") && !(freeStructureEdit && isGovernancePlanningCapacity(code)));
  if (sourceProblem) fail(isGovernancePlanningCapacity(sourceProblem) ? sourceProblem : "output_source_private_evidence_unavailable", 409);
  return { scope: trusted.scope, permission, expectedHead: expected, expectedProjectHead: trusted.projectHead, key: identifier(body.clientMutationId, "client_mutation_id_required"), digest, action: String(body.action), ...(trusted.retainedCommandEnvelope ? { retainedEnvelope: trusted.retainedCommandEnvelope } : {}), sourceAssertions: [...trusted.sourceAssertions, ...retainedOutputBodyAssertions(trusted.scope)] };
}

async function saveRequirement(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string) {
  const reasonIssue = outputScopeAmendmentReasonIssue(body.amendmentReason);
  if (reasonIssue) fail(reasonIssue);
  const blockId = identifier(body.blockId, "block_id_required"), proposed = record(body.spec);
  if (proposed.id !== blockId) fail("requirement_block_identity_mismatch");
  const inspection = inspectOutputRequirement(proposed);
  if (inspection.status === "invalid") return json({ error: "invalid_output_requirement", issues: inspection.issues }, 400);
  const existing = trusted.projection.libraryBlocks.find((block) => block.id === blockId);
  const occupied = await trusted.env.DB.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?").bind(`creative:${trusted.scope.ownerUserId}`, blockId).first<{ count: number }>();
  if (Number(occupied?.count ?? 0) !== (existing ? 1 : 0)) fail("output_block_identity_unavailable", 409);
  if (existing && (existing.documentId !== trusted.scope.documentId || existing.projectId !== trusted.scope.projectId || existing.scope !== "document" || existing.removed)) fail("foreign_or_removed_output_block", 403);
  if (existing?.locked) fail("output_block_locked", 409);
  if (existing && existing.type.toLowerCase() !== "output") fail("output_requirement_endpoint_cannot_convert_source", 403);
  if (existing && Object.keys(existing.properties).some((key) => key.startsWith("organization_context_package_") || key === "organization_context_source_block_id")) fail("organization_context_package_decision_immutable", 403);
  const content = typeof proposed.original_text === "string" ? proposed.original_text : String(existing?.properties.text ?? "");
  const subtype = typeof proposed.label === "string" ? proposed.label : String(existing?.properties.subtype ?? "Output");
  const planSuggestions = normalizePlanSuggestions(inspection.spec, body.planSuggestions === undefined ? existing?.properties.output_plan_suggestions : body.planSuggestions, body.planSuggestions !== undefined);
  // Validate the raw value before checking blankness. Preserve valid authored
  // text exactly; omitting this field also leaves a retained draft reason intact.
  const amendmentReason = typeof body.amendmentReason === "string" && body.amendmentReason.trim() ? body.amendmentReason : "";
  const events: OutputCommandWrite["events"] = existing ? [
    ...(existing.type !== "output" ? [{ type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "type", old_value: existing.type, new_value: "output" } }] : []),
    { type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "text", old_value: existing.properties.text ?? null, new_value: content } },
    { type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "subtype", old_value: existing.properties.subtype ?? null, new_value: subtype } },
    { type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "output_spec", old_value: existing.properties.output_spec ?? null, new_value: proposed } },
    { type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "output_plan_suggestions", old_value: existing.properties.output_plan_suggestions ?? null, new_value: planSuggestions } },
    ...(body.amendmentReason !== undefined && amendmentReason !== (existing.properties.output_amendment_reason ?? "") ? [{ type: "BlockPropertyEdited", payload: { block_id: blockId, property_path: "output_amendment_reason", old_value: existing.properties.output_amendment_reason ?? null, new_value: amendmentReason } }] : []),
  ] : [{ type: "BlockCreated", payload: { block_id: blockId, type: "output", scope: "document", position: `z-output-${blockId}`, handle: `output/${blockId}`, properties: { text: content, subtype, output_spec: proposed, output_plan_suggestions: planSuggestions, ...(amendmentReason ? { output_amendment_reason: amendmentReason } : {}), authority: "authored" } } }];
  const assertions: OutputSqlAssertion[] = [...(!existing ? [{ sql: "NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?)", bindings: [`creative:${trusted.scope.ownerUserId}`, blockId] }] : []), ...(trusted.scope.kind === "project" ? [{ sql: "NOT EXISTS(SELECT 1 FROM project_context_package_members member JOIN project_context_package_bindings binding ON binding.binding_id=member.binding_id AND binding.organization_id=member.organization_id AND binding.status='active' WHERE binding.project_access_id=? AND binding.organization_id=? AND member.target_block_id=?)", bindings: [trusted.scope.projectAccessId, trusted.scope.organizationId, blockId] }] : [])];
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events, assertions });
}

async function removeRequirement(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string) {
  const blockId = identifier(body.blockId, "block_id_required");
  const block = trusted.projection.blocks.find((value) => value.id === blockId && value.type.toLowerCase() === "output" && !value.removed);
  if (!block) fail("output_block_not_found", 404);
  if (block.locked) fail("output_block_locked", 409);
  if (Object.keys(block.properties).some((key) => key.startsWith("organization_context_package_") || key === "organization_context_source_block_id")) fail("organization_context_package_decision_immutable", 403);
  const commitments = await retainedCommitmentGuards(trusted, null, blockId);
  if (commitments.blockers.length) return json({ error: "output_active_commitment_requires_cancellation", commitments: commitments.blockers }, 409);
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [{ type: "BlockRemoved", payload: { block_id: blockId, output_requirement_removed: true } }], assertions: commitments.assertions });
}

function owedTargetIds(plan: OutputPlan) {
  return new Set(plan.obligations.filter((obligation) => obligation.required || obligation.selected).flatMap((obligation) => obligation.target_ids));
}

/** A failed/cancelled display status does not settle an unknown provider charge. */
const activeCommitmentSql = `(slot.status IN('authorized','queued','running','uncertain') OR EXISTS(SELECT 1 FROM output_provider_calls pending
  WHERE pending.scope_key=slot.scope_key AND pending.slot_id=slot.slot_id AND (pending.used_microusd IS NULL OR pending.status IN('pending','uncertain'))))`;

async function retainedCommitmentGuards(trusted: OutputTrustedContext, next: OutputPlan | null, removedRequirementId?: string) {
  const rows = await trusted.env.DB.prepare(`SELECT slot.slot_id,slot.grant_id,slot.job_id,slot.target_id,slot.plan_revision_id,CASE WHEN ${activeCommitmentSql} THEN 1 ELSE 0 END AS active
    FROM output_operation_slots slot JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    WHERE slot.scope_key=? AND plan.document_id=?`).bind(trusted.scope.key, trusted.scope.documentId).all<Record<string, unknown>>();
  const plans = new Map<string, OutputConfirmedPlan>(), affected: string[] = [], blockers: Array<{ targetId: string; grantId: string; jobId: string; slotId: string }> = [];
  const owed = next ? owedTargetIds(next) : new Set<string>();
  for (const row of rows.results) {
    const planId = String(row.plan_revision_id);
    if (!plans.has(planId)) { const value = await readConfirmedPlan(trusted, planId); if (!value) fail("output_commitment_evidence_unavailable", 409); plans.set(planId, value); }
    const oldTarget = plans.get(planId)!.plan.targets.find((target) => target.id === row.target_id);
    if (!oldTarget) fail("output_commitment_evidence_unavailable", 409);
    if (removedRequirementId && oldTarget.requirement_id !== removedRequirementId) continue;
    const replacement = next?.targets.find((target) => target.id === oldTarget.id);
    // Compare the target contract without global source versions. Saving any source
    // edit still pauses execution separately through the conservative source hash.
    const changed = !replacement || !owed.has(oldTarget.id) || await outputTargetContractDigest(replacement, "scope-amendment") !== await outputTargetContractDigest(oldTarget, "scope-amendment");
    if (!changed) continue;
    affected.push(String(row.slot_id));
    if (Number(row.active) === 1) blockers.push({ targetId: String(row.target_id), grantId: String(row.grant_id), jobId: String(row.job_id), slotId: String(row.slot_id) });
  }
  const assertions: OutputSqlAssertion[] = affected.length ? [{ sql: `NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.scope_key=? AND slot.slot_id IN(SELECT value FROM json_each(?)) AND ${activeCommitmentSql})`, bindings: [trusted.scope.key, JSON.stringify(affected)] }] : [];
  return { blockers, assertions };
}

async function confirmPlan(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string) {
  const reasonIssue = outputScopeAmendmentReasonIssue(body.amendmentReason);
  if (reasonIssue) fail(reasonIssue);
  if (!trusted.requirements.length) fail("output_requirements_required", 409);
  if (trusted.requirements.some((requirement) => requirement.status !== "valid" || !requirement.spec)) return json({ error: "output_requirements_need_confirmation", issues: trusted.requirements.filter((row) => row.status !== "valid").map((row) => ({ blockId: row.blockId, status: row.status, issues: row.issues })) }, 409);
  if (trusted.requirements.some((requirement) => outputRequirementInterpretationNeedsReview(requirement.spec!))) fail("output_interpretation_review_required", 409);
  const proposals = trusted.requirements.reduce<OutputPlanSuggestions>((result, row) => ({ count_policies: { ...result.count_policies, ...row.planSuggestions.count_policies }, suggested_counts: { ...result.suggested_counts, ...row.planSuggestions.suggested_counts } }), { count_policies: {}, suggested_counts: {} });
  const options = { ...proposals, ...record(body.options) } as OutputConfirmationOptions;
  const allowed = new Set(["selected_optional_ids", "selected_target_ids", "count_policies", "suggested_counts"]);
  if (Object.keys(options).some((key) => !allowed.has(key))) fail("invalid_output_plan_options");
  for (const key of ["selected_optional_ids", "selected_target_ids"] as const) if (options[key] !== undefined && (!Array.isArray(options[key]) || options[key]!.some((value) => typeof value !== "string" || value.length > 500) || new Set(options[key]).size !== options[key]!.length)) fail("invalid_output_plan_selection");
  const plan = compileOutputPlan(trusted.requirements.map((row) => row.spec!) as OutputRequirementSpec[], { ...options, document_id: trusted.scope.documentId, source_revision: trusted.sourceDigest, requirement_revision: trusted.requirementsDigest, max_targets: 1000 });
  if (plan.issues.length) return json({ error: "invalid_output_plan", issues: plan.issues }, 400);
  const previous = await readConfirmedPlan(trusted), revisionId = uuidV7(), createdAt = nowIso();
  const commitments = await retainedCommitmentGuards(trusted, plan);
  if (commitments.blockers.length) return json({ error: "output_active_commitment_requires_cancellation", commitments: commitments.blockers }, 409);
  const nextOwed = owedTargetIds(plan), nextObligations = new Set(plan.obligations.filter((obligation) => obligation.required || obligation.selected).map((obligation) => obligation.id));
  const withdrawnTargetIds = previous ? [...owedTargetIds(previous.plan)].filter((id) => !nextOwed.has(id)) : [];
  const withdrawnObligationIds = previous?.plan.obligations.filter((obligation) => (obligation.required || obligation.selected) && !nextObligations.has(obligation.id)).map((obligation) => obligation.id) ?? [];
  const withdrawal = withdrawnTargetIds.length > 0 || withdrawnObligationIds.length > 0;
  const amendmentReason = typeof body.amendmentReason === "string" ? body.amendmentReason : "";
  if (withdrawal && outputScopeAmendmentReasonIssue(amendmentReason, { required: true })) return json({ error: "output_scope_amendment_reason_required", withdrawnTargetIds, withdrawnObligationIds }, 409);
  const targetContractDigests: Record<string, string> = {};
  for (const target of plan.targets) targetContractDigests[target.id] = await outputTargetContractDigest(target, trusted.sourceDigest);
  const confirmedPlan: OutputConfirmedPlan = { id: trusted.scope.documentId, revisionId, revision: (previous?.revision ?? 0) + 1, confirmedAt: createdAt, requirementsDigest: trusted.requirementsDigest, sourceDigest: trusted.sourceDigest, plan, targetContractDigests, confirmationOptions: options };
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [{ type: "OutputPlanConfirmed", payload: { plan_revision_id: revisionId, confirmed_plan: confirmedPlan, ...(withdrawal ? { scope_amendment: { previous_plan_revision_id: previous!.revisionId, reason: amendmentReason, withdrawn_target_ids: withdrawnTargetIds, withdrawn_obligation_ids: withdrawnObligationIds } } : {}) } }], assertions: commitments.assertions,
    buildSidecars: (events) => ({ statements: [trusted.env.DB.prepare(`INSERT INTO output_plan_revisions(scope_key,scope_kind,owner_user_id,project_id,document_id,organization_id,project_access_id,plan_revision_id,plan_id,revision,confirmed_event_id,requirements_digest,source_digest,resolver_version,source_head,target_count,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(trusted.scope.key, trusted.scope.kind, trusted.scope.ownerUserId, trusted.scope.projectId, trusted.scope.documentId, trusted.scope.organizationId, trusted.scope.projectAccessId, revisionId, confirmedPlan.id, confirmedPlan.revision, events.at(-1)!.eventId, trusted.requirementsDigest, trusted.sourceDigest, RESOLVER_VERSION, trusted.ownerHead, plan.targets.length, createdAt),
      ...plan.targets.map((target, index) => trusted.env.DB.prepare("INSERT INTO output_plan_targets(scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal) VALUES(?,?,?,?,?,?,?,?)").bind(trusted.scope.key, revisionId, target.id, targetContractDigests[target.id], target.media_kind, target.required ? 1 : 0, target.selected ? 1 : 0, index))] }) });
}

function bridgeTarget(trusted: OutputTrustedContext, plan: OutputConfirmedPlan, target: OutputPlanTarget): OutputBridgeTargetInput {
  return { request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, confirmedPlan: plan, target, context: requireCurrentSource(trusted), ownerHead: trusted.ownerHead, sourceEvents: trusted.events, sourceAssertions: trusted.sourceAssertions, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    ...(Object.hasOwn(target,'scene_contract')?{sceneUseVersionedHistory:true}:{}) };
}

/** These dormant preparation reads must not adopt a replacement caller while
 * loading the original quote/job. Native proof creation follows this capture. */
function sceneSponsorPreparationCurrent(trusted: OutputTrustedContext, body: Record<string, unknown>) {
  const request = trusted.request, signal = request.signal, env = trusted.env, database = env.DB, principal = trusted.principal;
  const facts = () => canonicalOutputJson({ command: body, scope: trusted.scope, principal: trusted.principal, projectContext: trusted.projectContext,
    ownerHead: trusted.ownerHead, context: trusted.context, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    events: trusted.events, sourceAssertions: trusted.sourceAssertions, sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    request: { url: request.url, method: request.method, headers: [...request.headers.entries()] },
    configuration: { key: env.OPENAI_API_KEY ?? null, model: env.OPENAI_MODEL ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null } });
  const captured = facts();
  const current = () => {
    let aborted: unknown, actualSignal: unknown;
    try { actualSignal = Object.getOwnPropertyDescriptor(Request.prototype, "signal")?.get?.call(request);
      aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get?.call(signal); } catch { fail("sponsor_scene_handoff_changed", 403); }
    if (trusted.request !== request || request.signal !== signal || actualSignal !== signal || aborted !== false || trusted.env !== env || env.DB !== database
      || trusted.principal !== principal || facts() !== captured) fail("sponsor_scene_handoff_changed", 403);
  };
  current(); return current;
}

function audioAcknowledgementErrorClear(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const error = Object.getOwnPropertyDescriptor(value,"error");
  return error ? Object.hasOwn(error,"value") && error.value===undefined : !("error" in value);
}
function audioSponsorPreparationCurrent(trusted: OutputTrustedContext, body: Record<string, unknown>) {
  const request = trusted.request, signal = request.signal, env = trusted.env, database = env.DB, principal = trusted.principal;
  const identities = {scope:trusted.scope,context:trusted.context,events:trusted.events};
  const deadline = Math.min(Infinity,...trusted.sourceAssertions.flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]));
  const facts = () => canonicalOutputJson({ command: body, scope: trusted.scope, principal: trusted.principal, projectContext: trusted.projectContext,
    ownerHead: trusted.ownerHead, context: trusted.context, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    events: trusted.events, sourceAssertions: trusted.sourceAssertions, sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    request: { url: request.url, method: request.method, headers: [...request.headers.entries()] },
    configuration: { key: env.OPENAI_API_KEY ?? null, fal: env.FAL_KEY ?? null, audioProvider: env.FORMA_AUDIO_PROVIDER ?? null, audioModel: env.FAL_AUDIO_MODEL ?? null, model: env.OPENAI_MODEL ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null } });
  const captured = facts();
  const current = () => {
    let aborted: unknown, actualSignal: unknown;
    try { actualSignal = Object.getOwnPropertyDescriptor(Request.prototype, "signal")?.get?.call(request);
      aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get?.call(signal); } catch { fail("sponsor_audio_handoff_changed", 403); }
    if (trusted.request !== request || request.signal !== signal || actualSignal !== signal || aborted !== false || trusted.env !== env || env.DB !== database
      || trusted.principal !== principal || trusted.scope !== identities.scope || trusted.context !== identities.context || trusted.events !== identities.events
      || !Number.isFinite(Date.now()) || Date.now()>=deadline || facts() !== captured) fail("sponsor_audio_handoff_changed", 403);
  };
  current(); return current;
}

async function preflightPlan(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge?: OutputExecutionBridge) {
  requireCurrentSource(trusted);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, identifier(body.planRevisionId, "plan_revision_id_required")));
  const requested = body.targetIds === undefined ? plan.plan.targets.filter((target) => target.selected).map((target) => target.id) : body.targetIds;
  if (!Array.isArray(requested) || !requested.length || requested.length > OUTPUT_PREFLIGHT_TARGET_MAX_COUNT || requested.some((value) => typeof value !== "string") || new Set(requested).size !== requested.length) fail("finite_target_selection_required", 409);
  const selected = requested.map((id) => plan.plan.targets.find((target) => target.id === id));
  if (selected.some((target) => !target?.selected)) fail("target_not_selected_in_confirmed_plan", 409);
  const targets: OutputNativeTargetPreflight[] = [];
  let model3dOriginalDeadline: number | null = null;
  let audioOriginalDeadline: number | null = null;
  let storyboardOriginalDeadline: number | null = null;
  let videoOriginalDeadline: number | null = null;
  const operationAttempts: OutputPreflight["operationAttempts"] = {};
  if (body.alternativeOfSlotId && selected.length !== 1) fail("choose_one_target_for_explicit_alternative");
  const identities = (selected as OutputPlanTarget[]).map((target) => ({ targetId: target.id, contract: plan.targetContractDigests[target.id] }));
  const attempts = await trusted.env.DB.prepare(`SELECT slot.*,EXISTS(SELECT 1 FROM output_provider_calls call
      WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND (call.used_microusd IS NULL OR call.status IN('pending','uncertain'))) AS unresolved_cost
    FROM output_operation_slots slot JOIN output_plan_revisions retained_plan ON retained_plan.scope_key=slot.scope_key AND retained_plan.plan_revision_id=slot.plan_revision_id
    JOIN json_each(?) wanted ON slot.target_id=json_extract(wanted.value,'$.targetId') AND slot.target_contract_digest=json_extract(wanted.value,'$.contract')
    WHERE slot.scope_key=? AND retained_plan.document_id=? AND NOT EXISTS(SELECT 1 FROM output_operation_slots newer
      WHERE newer.scope_key=slot.scope_key AND newer.target_id=slot.target_id AND newer.target_contract_digest=slot.target_contract_digest AND newer.attempt_ordinal>slot.attempt_ordinal)`)
    .bind(JSON.stringify(identities), trusted.scope.key, trusted.scope.documentId).all<Record<string, unknown>>();
  const lastAttempt = new Map(attempts.results.map((row) => [String(row.target_id), row]));
  for (const target of selected as OutputPlanTarget[]) {
    const initial = lastAttempt.get(target.id);
    const replacementCycle = record(record(body.experienceBinding).replacementCycle);
    // This only permits running the unpaid verifier below. Its server-owned
    // source/lineage proof must succeed before any preflight can be recorded.
    const replacementRequested = Boolean(body.alternativeOfSlotId && initial?.status === "uncertain" && initial.attempt_ordinal === 0
      && initial.previous_slot_id === null && Object.hasOwn(target, "model3d_contract")
      && /^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output\/prepare$/u.test(new URL(trusted.request.url).pathname)
      && replacementCycle.ordinal === 1 && record(replacementCycle.predecessor).slotId === initial.slot_id);
    let recoveryReason = "";
    if (body.alternativeOfSlotId) {
      if (!initial || initial.slot_id !== body.alternativeOfSlotId || !replacementRequested && !["succeeded", "failed", "cancelled", "unavailable"].includes(String(initial.status))) fail("previous_output_operation_not_terminal", 409);
      if (Number(initial.unresolved_cost) && !replacementRequested) fail("reconcile_previous_output_cost_before_alternative", 409);
      operationAttempts[target.id] = { ordinal: Number(initial.attempt_ordinal) + 1, previousSlotId: String(initial.slot_id) };
    } else if (initial) recoveryReason = "This target already has an authorized operation. Recover its stored result or explicitly authorize an alternative; a second initial operation will not be created.";
    else operationAttempts[target.id] = { ordinal: 0, previousSlotId: null };
    if (!bridge || target.blocking_issues.length || recoveryReason) {
      targets.push({ targetId: target.id, available: false, reason: recoveryReason || target.blocking_issues.map((issue) => issue.message).join(" ") || "Native generation is unavailable because no verified execution bridge is installed.", reasonCode: recoveryReason ? "output_existing_operation_requires_recovery" : target.blocking_issues.length ? "output_target_requires_resolution" : "output_native_execution_unavailable", transferCode: "output_transfer_none_authorized", provider: null, model: null, route: null, maximumMicrousd: 0, maximumCalls: 0, maximumTokens: 0, settings: {}, transferDescription: "No source transmission is authorized." });
      continue;
    }
    const result = await bridge.preflight(bridgeTarget(trusted, plan, target));
    if (result.targetId !== target.id) fail("bridge_target_mismatch", 500);
    if (replacementRequested) {
      const payload = await readOutputModel3dPayload(record(result.settings).payload), proof = outputModel3dPreflightAssertions(result);
      if (!result.available || !payload || !proof?.length || payload.preview.version !== "model3d-mini-app-replacement-cost-v1"
        || payload.preview.previousSlotId !== initial?.slot_id || payload.preview.previousJobId !== initial?.job_id
        || payload.preview.replacementCycleId !== replacementCycle.id || payload.preview.maximumMicrousd !== 400000
        || payload.preview.priorHeldMicrousd !== 400000 || payload.preview.cumulativeMaximumMicrousd !== 800000)
        fail("experience_model3d_replacement_unavailable", 409);
    }
    if (Object.hasOwn(target, "model3d_contract") && (result.available || result.reasonCode === "output_native_model3d_unconfigured")) {
      const proof = outputModel3dPreflightAssertions(result);
      const deadlines = proof?.flatMap(value => value.deadlineMs === undefined ? [] : [value.deadlineMs]);
      if (!proof?.length || !deadlines?.length || deadlines.some(value => !Number.isFinite(value))) fail("output_model3d_original_unavailable", 409);
      model3dOriginalDeadline = Math.min(model3dOriginalDeadline ?? Infinity, ...deadlines);
      trusted.sourceAssertions.push(...proof);
    }
    if (Object.hasOwn(target, "audio_contract") && result.available) {
      const audioSource = outputAudioPreflightAssertions(result);
      if (!audioSource?.length) fail("output_audio_original_unavailable", 409);
      const deadlines = audioSource.flatMap(value => value.deadlineMs === undefined ? [] : [value.deadlineMs]);
      if (!deadlines.length || deadlines.some(value => !Number.isFinite(value))) fail("output_audio_original_unavailable", 409);
      audioOriginalDeadline = Math.min(audioOriginalDeadline ?? Infinity, ...deadlines);
      trusted.sourceAssertions.push(...audioSource);
    }
    if (Object.hasOwn(target, "video_contract") && result.available) {
      const proof = outputVideoPreflightProof(result);
      if (!proof?.sourceAssertions.length || !Number.isFinite(Date.parse(proof.expiresAt))) fail("output_video_original_unavailable", 409);
      videoOriginalDeadline = Math.min(videoOriginalDeadline ?? Infinity, Date.parse(proof.expiresAt));
      trusted.sourceAssertions.push(...proof.sourceAssertions);
    }
    if (Object.hasOwn(target, "storyboard_contract") && result.available) {
      const proof = outputStoryboardPreflightProof(result);
      if (!proof?.sourceAssertions.length || !Number.isFinite(Date.parse(proof.expiresAt))) fail("output_storyboard_original_unavailable", 409);
      storyboardOriginalDeadline = Math.min(storyboardOriginalDeadline ?? Infinity, Date.parse(proof.expiresAt));
      trusted.sourceAssertions.push(...proof.sourceAssertions);
    }
    if (result.available && (![result.maximumMicrousd, result.maximumCalls, result.maximumTokens].every((number) => Number.isSafeInteger(number) && number > 0) || !result.provider || !result.model || !result.route)) fail("bridge_preflight_incomplete", 500);
    if (result.available) outputProviderStages(result);
    targets.push(result);
  }
  const createdAt = nowIso(), preflightId = uuidV7();
  if (videoOriginalDeadline !== null && videoOriginalDeadline <= Date.now()) fail("output_video_original_expired", 409);
  if (storyboardOriginalDeadline !== null && storyboardOriginalDeadline <= Date.now()) fail("output_storyboard_original_expired", 409);
  if (model3dOriginalDeadline !== null && model3dOriginalDeadline <= Date.now()) fail("output_model3d_original_expired", 409);
  const expiresAtMs = Math.min(Date.now() + 15 * 60_000, audioOriginalDeadline ?? Infinity, storyboardOriginalDeadline ?? Infinity, model3dOriginalDeadline ?? Infinity, videoOriginalDeadline ?? Infinity);
  if (expiresAtMs <= Date.now()) fail("output_audio_original_expired", 409);
  const withoutDigest = { id: preflightId, planRevisionId: plan.revisionId, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, targets, operationAttempts,
    maximumMicrousd: targets.filter((target) => target.available).reduce((sum, target) => sum + target.maximumMicrousd, 0), maximumCalls: targets.filter((target) => target.available).reduce((sum, target) => sum + target.maximumCalls, 0), expiresAt: new Date(expiresAtMs).toISOString(), createdAt };
  const preflight: OutputPreflight = { ...withoutDigest, termsDigest: await outputDigest(withoutDigest) };
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "request"), events: [{ type: "OutputPlanPreflighted", payload: { preflight_id: preflightId, plan_revision_id: plan.revisionId, preflight } }],
    buildSidecars: (events) => ({ statements: [trusted.env.DB.prepare("INSERT INTO output_preflights(scope_key,preflight_id,plan_revision_id,actor_user_id,terms_digest,event_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(trusted.scope.key, preflightId, plan.revisionId, trusted.scope.actorUserId, preflight.termsDigest, events.at(-1)!.eventId, preflight.expiresAt, createdAt)] }) });
}

function outputProviderStages(offered: OutputNativeTargetPreflight): Array<{ stage: string; provider: string; model: string }> {
  if (!Array.isArray(offered.settings.calls) || !offered.settings.calls.length || offered.settings.calls.length !== offered.maximumCalls) fail("bridge_provider_call_routes_required", 500);
  const calls = offered.settings.calls.map(record);
  if (calls.some((call) => typeof call.stage !== "string" || !idPattern.test(call.stage) || typeof call.provider !== "string" || !call.provider || typeof call.model !== "string" || !call.model) || new Set(calls.map((call) => call.stage)).size !== calls.length) fail("bridge_provider_call_routes_invalid", 500);
  return calls as Array<{ stage: string; provider: string; model: string }>;
}

async function authorizePlan(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge?: OutputExecutionBridge, sponsorAdmission?: SponsorAdmissionAuthority) {
  if (!bridge) fail("native_execution_unavailable", 409);
  if (Object.hasOwn(body, "sponsor_entitlement") !== Boolean(sponsorAdmission)) fail("sponsor_authority_unavailable", 403);
  const scenePreparation = sponsorAdmission ? sponsorSceneAdmissionPreparation(sponsorAdmission, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) : null;
  const audioPreparation = sponsorAdmission ? sponsorAudioAdmissionPreparation(sponsorAdmission, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) : null;
  const assertSceneRequest = () => { if (scenePreparation && sponsorSceneAdmissionPreparation(sponsorAdmission!, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) !== scenePreparation) fail("sponsor_scene_handoff_changed", 403); if (audioPreparation && sponsorAudioAdmissionPreparation(sponsorAdmission!, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) !== audioPreparation) fail("sponsor_audio_handoff_changed", 403); };
  if (body.explicitAuthorization !== true || !Number.isSafeInteger(body.maximumMicrousd) || Number(body.maximumMicrousd) <= 0) fail("explicit_spending_authorization_required", 403);
  const preflightId = identifier(body.preflightId, "preflight_id_required");
  const row = await trusted.env.DB.prepare("SELECT * FROM output_preflights WHERE scope_key=? AND preflight_id=? AND actor_user_id=?").bind(trusted.scope.key, preflightId, trusted.scope.actorUserId).first<Record<string, unknown>>();
  assertSceneRequest();
  if (!row || String(row.expires_at) <= nowIso()) fail("output_preflight_expired", 409);
  const preflight = record((await privateEventBody(trusted.env, trusted.scope, String(row.event_id))).preflight) as OutputPreflight;
  assertSceneRequest();
  if (row.terms_digest !== body.termsDigest || preflight.termsDigest !== body.termsDigest || preflight.sourceDigest !== trusted.sourceDigest || preflight.requirementsDigest !== trusted.requirementsDigest) fail("output_authorization_terms_changed", 409);
  if (!preflight.targets.length || preflight.targets.some((target) => !target.available)) fail("unavailable_selected_output_route", 409);
  if (preflight.maximumMicrousd > Number(body.maximumMicrousd) || Number(body.maximumMicrousd) > 1_000_000_000_000) fail("output_authorization_ceiling_insufficient", 403);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, preflight.planRevisionId));
  assertSceneRequest();
  const model3dTargets=plan.plan.targets.filter(target=>target.selected&&Object.hasOwn(target,"model3d_contract"));
  if(model3dTargets.length&&(!/^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output\/authorize$/u.test(new URL(trusted.request.url).pathname)
    ||model3dTargets.length!==1||preflight.targets.length!==1||trusted.scope.kind!=="personal"||trusted.scope.contextId))fail("model3d_mini_app_route_required",403);
  if(Boolean(model3dTargets.length)!==Object.hasOwn(body,"model3dCostConsent"))fail("model3d_mini_app_confirmation_required",403);
  const audioTargets=plan.plan.targets.filter(target=>target.selected&&Object.hasOwn(target,"audio_contract"));
  if(audioTargets.length&&!/^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output\/authorize$/u.test(new URL(trusted.request.url).pathname))fail("audio_mini_app_route_required",403);
  if(audioTargets.length>1||audioTargets.length&&preflight.targets.length!==1||Boolean(audioTargets.length)!==Object.hasOwn(body,"audioCostConsent"))fail("audio_mini_app_confirmation_required",403);
  const storyboardTargets=plan.plan.targets.filter(target=>target.selected&&Object.hasOwn(target,"storyboard_contract"));
  if(storyboardTargets.length&&(!/^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output\/authorize$/u.test(new URL(trusted.request.url).pathname)
    ||storyboardTargets.length!==1||preflight.targets.length!==1||trusted.scope.kind!=="personal"||trusted.scope.contextId))fail("storyboard_mini_app_route_required",403);
  const videoTargets=plan.plan.targets.filter(target=>target.selected&&Object.hasOwn(target,"video_contract"));
  if(videoTargets.length&&(!/^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output\/authorize$/u.test(new URL(trusted.request.url).pathname)
    ||videoTargets.length!==1||preflight.targets.length!==1||trusted.scope.kind!=="personal"||trusted.scope.contextId))fail("video_mini_app_route_required",403);
  const context = requireCurrentSource(trusted), grantId = uuidV7(), createdAt = nowIso();
  const slots: OutputOperationSlot[] = [];
  const sceneTargets = plan.plan.targets.filter(target => target.selected && Object.hasOwn(target, "scene_contract"));
  if (sceneTargets.length > 1 || sceneTargets.length && preflight.targets.length !== 1
    || Boolean(sceneTargets.length) !== Object.hasOwn(body, "sceneCostConsent")) fail("scene_mini_app_confirmation_required", 403);
  let sceneExpiresAt: string | null = null;
  if (scenePreparation && sceneTargets.length !== 1) fail("sponsor_scene_handoff_changed", 403);
  if (audioPreparation && audioTargets.length !== 1) fail("sponsor_audio_handoff_changed", 403);
  const assertSceneCurrent = () => { if (scenePreparation) requireSceneSponsorAdmissionCurrent(scenePreparation, bridgeTarget(trusted, plan, sceneTargets[0]!), preflight, body.sceneCostConsent); if (audioPreparation) requireAudioSponsorAdmissionCurrent(audioPreparation, bridgeTarget(trusted, plan, audioTargets[0]!), preflight, body.audioCostConsent); };
  for (const offered of preflight.targets) {
    const target = plan.plan.targets.find((value) => value.id === offered.targetId);
    if (!target || !target.selected || target.blocking_issues.length) fail("output_target_no_longer_executable", 409);
    const current = scenePreparation ? await requireSceneSponsorAdmissionForTarget(scenePreparation, bridgeTarget(trusted, plan, target), preflight, body.sceneCostConsent)
      : audioPreparation ? await requireAudioSponsorAdmissionForTarget(audioPreparation, bridgeTarget(trusted, plan, target), preflight, body.audioCostConsent) : await bridge.preflight(bridgeTarget(trusted, plan, target));
    assertSceneCurrent();
    if (canonicalOutputJson(current) !== canonicalOutputJson(offered)) fail("output_provider_terms_changed", 409);
    const attempt = preflight.operationAttempts[target.id];
    if (!attempt || !Number.isSafeInteger(attempt.ordinal) || attempt.ordinal < 0) fail("output_attempt_identity_missing", 409);
    let jobId = uuidV7();
    if(Object.hasOwn(target,"video_contract")){
      const {proof}=requireOutputVideoOriginal(bridgeTarget(trusted,plan,target),current,{attemptOrdinal:attempt.ordinal,previousSlotId:attempt.previousSlotId});
      jobId=proof.requestId;sceneExpiresAt=proof.expiresAt;trusted.sourceAssertions.push(...proof.sourceAssertions);
    }
    if(Object.hasOwn(target,"model3d_contract")){
      const original=await readOutputModel3dPayload(record(offered.settings).payload),fresh=await readOutputModel3dPayload(record(current.settings).payload),proof=outputModel3dPreflightAssertions(current);
      if(!original||!fresh||!proof?.length||!model3dMiniAppAttemptMatches(fresh.preview,{jobId:fresh.preview.requestId,attemptOrdinal:attempt.ordinal,previousSlotId:attempt.previousSlotId})||fresh.preview.actorUserId!==trusted.scope.actorUserId
        ||fresh.preview.documentId!==trusted.scope.documentId||fresh.preview.projectId!==trusted.scope.projectId
        ||fresh.preview.sourceDigest!==trusted.sourceDigest||fresh.preview.requirementsDigest!==trusted.requirementsDigest)fail("output_model3d_original_attempt_required",403);
      requireModel3dMiniAppCostApproval(body.model3dCostConsent,original.preview,fresh.preview);
      jobId=fresh.preview.requestId;sceneExpiresAt=fresh.preview.expiresAt;trusted.sourceAssertions.push(...proof);
    }
    if(Object.hasOwn(target,"storyboard_contract")){
      const original=readStoryboardExecutionOffer(offered),offer=readStoryboardExecutionOffer(current),proof=outputStoryboardPreflightProof(current);
      if(!original||!offer||!proof?.sourceAssertions.length||attempt.ordinal!==0||attempt.previousSlotId
        ||offer.original.actorUserId!==trusted.scope.actorUserId||offer.original.documentId!==trusted.scope.documentId||offer.original.projectId!==trusted.scope.projectId
        ||offer.original.sourceDigest!==trusted.sourceDigest||offer.original.requirementsDigest!==trusted.requirementsDigest
        ||proof.requestId!==offer.original.requestId||proof.expiresAt!==offer.original.expiresAt||Date.parse(proof.expiresAt)<=Date.now())fail("output_storyboard_original_attempt_required",403);
      jobId=proof.requestId;sceneExpiresAt=proof.expiresAt;trusted.sourceAssertions.push(...proof.sourceAssertions);
    }
    if (Object.hasOwn(target, "scene_contract")) {
      const [originalScene, currentScene] = await Promise.all([
        readOutputScenePayload(record(offered.settings).payload), readOutputScenePayload(record(current.settings).payload),
      ]);
      assertSceneCurrent();
      if (!originalScene || !currentScene || attempt.ordinal !== 0 || attempt.previousSlotId) fail("output_scene_original_attempt_required", 409);
      const preview = currentScene.outputScene.costPreview;
      if (preview.actorUserId !== trusted.scope.actorUserId || preview.projectId !== trusted.scope.projectId
        || preview.documentId !== trusted.scope.documentId || preview.contextSessionId !== trusted.scope.contextId) fail("output_scene_scope_mismatch", 403);
      requireSceneMiniAppCostApproval(body.sceneCostConsent, originalScene.outputScene.costPreview, preview);
      jobId = preview.requestId;
      sceneExpiresAt = preview.expiresAt;
    }
    if(Object.hasOwn(target,"audio_contract")){
      const preview=parseAudioMiniAppCostPreview(record(current.settings).costPreview);
      if(!preview||attempt.ordinal!==0||attempt.previousSlotId||preview.actorUserId!==trusted.scope.actorUserId||preview.documentId!==trusted.scope.documentId||preview.projectId!==trusted.scope.projectId||trusted.scope.kind!=="personal"||trusted.scope.contextId)fail("output_audio_original_attempt_required",403);
      requireAudioMiniAppCostApproval(body.audioCostConsent,record(offered.settings).costPreview,preview);
      jobId=preview.requestId;sceneExpiresAt=preview.expiresAt;
    }
    slots.push({ scopeKey: trusted.scope.key, slotId: uuidV7(), grantId, planRevisionId: plan.revisionId, targetId: target.id, targetContractDigest: plan.targetContractDigests[target.id], sourceDigest: trusted.sourceDigest, provider: offered.provider!, model: offered.model!, routeDigest: await outputDigest(offered), jobId, costReservationId: uuidV7(), tokenReservationId: uuidV7(), maximumMicrousd: offered.maximumMicrousd, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens, status: "authorized", attemptOrdinal: attempt.ordinal, previousSlotId: attempt.previousSlotId });
    assertSceneCurrent();
  }
  if (slots.reduce((sum, slot) => sum + slot.maximumMicrousd, 0) !== preflight.maximumMicrousd || slots.reduce((sum, slot) => sum + slot.maximumCalls, 0) !== preflight.maximumCalls) fail("output_allocation_mismatch", 500);
  const prepared = await bridge.prepareAdmission({ request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, confirmedPlan: plan, context, ownerHead: trusted.ownerHead, sourceEvents: trusted.events, sourceAssertions: trusted.sourceAssertions, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, grantId, preflight, slots, ...(sponsorAdmission ? { sponsorAdmission } : {}), governanceWitness: trusted.governanceWitness, ...(sceneTargets.length ? { sceneCostConsent: body.sceneCostConsent,sceneUseVersionedHistory:true } : {}), ...(audioTargets.length?{audioCostConsent:body.audioCostConsent}:{}), ...(model3dTargets.length?{model3dCostConsent:body.model3dCostConsent}:{}) });
  assertSceneCurrent();
  if (!prepared.events.length) fail("output_admission_receipt_required", 500);
  // Preserve the original Scene quote deadline through final atomic admission.
  if (sceneExpiresAt && Date.parse(sceneExpiresAt) <= Date.now()) fail("scene_mini_app_confirmation_required", 403);
  const grantExpiresAt = sceneExpiresAt && sceneExpiresAt < preflight.expiresAt ? sceneExpiresAt : preflight.expiresAt;
  const write = commandWrite(trusted, body, digest, "request");
  const sourceAssertions = [...(write.sourceAssertions ?? []), ...(sceneExpiresAt ? [{ sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [sceneExpiresAt], deadlineMs: Date.parse(sceneExpiresAt) }] : [])], captured = new Set(sourceAssertions.map(canonicalOutputJson));
  for (const assertion of prepared.sourceAssertions ?? []) {
    const key = canonicalOutputJson(assertion);
    if (!captured.has(key)) { captured.add(key); sourceAssertions.push(assertion); }
  }
  const sponsor = sponsorAdmission ? sponsorAdmissionPayer(sponsorAdmission, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) : null;
  if (sponsor && (slots.length !== 1 || trusted.scope.kind !== "personal")) fail("sponsor_recipe_unsupported", 403);
  const sponsoredPlan = sponsorAdmission ? await sponsorAdmissionPlan(sponsorAdmission, trusted, { scopeKey: trusted.scope.key,
    planRevisionId: plan.revisionId, slotId: slots[0]!.slotId, executionGrantId: grantId, jobId: slots[0]!.jobId,
    costReservationId: slots[0]!.costReservationId, tokenReservationId: slots[0]!.tokenReservationId, commandKey: write.key }) : null;
  assertSceneCurrent();
  return commitOutputCommand(trusted.env, { ...write, sourceAssertions,sceneJobAdmissions:prepared.sceneJobAdmissions, events: [...prepared.events, { type: "OutputExecutionAuthorized", payload: { grant_id: grantId, plan_revision_id: plan.revisionId, preflight_id: preflightId, maximum_microusd: Number(body.maximumMicrousd), maximum_calls: preflight.maximumCalls, authorized_targets: slots.map((slot) => ({ target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: slot.jobId, route_digest: slot.routeDigest })), source_digest: trusted.sourceDigest } }],
    assertions: [{ sql: "EXISTS(SELECT 1 FROM output_preflights preflight JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.redacted_at IS NULL WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND preflight.terms_digest=? AND preflight.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))", bindings: [trusted.scope.key, preflightId, trusted.scope.actorUserId, preflight.termsDigest, createdAt] }],
    buildSidecars: (events) => {
      assertSceneCurrent();
      const native = prepared.buildStatements(events);
      if (!native.statements.length || !native.assertions.length) throw new Error("output_atomic_native_admission_required");
      return { statements: [trusted.env.DB.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,context_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'authorized',?,?)")
        .bind(trusted.scope.key, grantId, plan.revisionId, trusted.scope.actorUserId, sponsor?.payerUserId ?? trusted.scope.actorUserId, trusted.scope.contextId, preflightId, events.at(-1)!.eventId, Number(body.maximumMicrousd), preflight.maximumCalls, grantExpiresAt, createdAt),
        ...slots.map((slot) => trusted.env.DB.prepare(`INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,attempt_ordinal,previous_slot_id,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'authorized',?,?)`).bind(slot.scopeKey, slot.slotId, slot.grantId, slot.planRevisionId, slot.targetId, slot.targetContractDigest, slot.sourceDigest, slot.provider, slot.model, slot.routeDigest, slot.jobId, slot.costReservationId, slot.tokenReservationId, slot.maximumMicrousd, slot.maximumCalls, slot.maximumTokens, slot.attemptOrdinal, slot.previousSlotId, createdAt, createdAt)),
        ...slots.flatMap((slot) => outputProviderStages(preflight.targets.find((target) => target.targetId === slot.targetId)!).map((call) => trusted.env.DB.prepare("INSERT INTO output_operation_routes(scope_key,slot_id,stage_key,provider,model,maximum_calls) VALUES(?,?,?,?,?,1)").bind(slot.scopeKey, slot.slotId, call.stage, call.provider, call.model))),
        ...native.statements, ...(sponsoredPlan?.admissionStatements ?? []).map(statement => trusted.env.DB.prepare(statement.sql).bind(...statement.bindings))], receiptAssertions: sponsoredPlan ? [sponsoredPlan.nativeAssertion] : [], assertions: [
          ...(sponsor?.assertions ?? []),
          { sql: "(SELECT COALESCE(SUM(maximum_microusd),0) FROM output_operation_slots WHERE scope_key=? AND grant_id=?)<=? AND (SELECT COALESCE(SUM(maximum_calls),0) FROM output_operation_slots WHERE scope_key=? AND grant_id=?)=?", bindings: [trusted.scope.key, grantId, Number(body.maximumMicrousd), trusted.scope.key, grantId, preflight.maximumCalls] },
          // Typed 3D children carried exact parent/hold/one-child assertions in
          // the pre-write source proof above. All generic alternatives retain
          // their original terminal-and-settled requirement.
          ...slots.filter((slot) => slot.previousSlotId && !model3dTargets.some(target => target.id === slot.targetId)).map((slot) => ({ sql: "EXISTS(SELECT 1 FROM output_operation_slots previous WHERE previous.scope_key=? AND previous.slot_id=? AND previous.target_id=? AND previous.target_contract_digest=? AND previous.attempt_ordinal=? AND previous.status IN('succeeded','failed','cancelled','unavailable') AND NOT EXISTS(SELECT 1 FROM output_provider_calls pending WHERE pending.scope_key=previous.scope_key AND pending.slot_id=previous.slot_id AND pending.used_microusd IS NULL))", bindings: [slot.scopeKey, slot.previousSlotId, slot.targetId, slot.targetContractDigest, slot.attemptOrdinal - 1] })),
          ...native.assertions] };
    } });
}

function outputRunGrantAssertion(scope: OutputScope, grantId: string): OutputSqlAssertion {
  return { sql: "EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS ? AND status IN('authorized','active') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))", bindings: [scope.key, grantId, scope.actorUserId, scope.contextId] };
}

async function validateRecordedOutputRun(trusted: OutputTrustedContext, evidence: OutputGrantEvidence, bridge: OutputExecutionBridge, statuses: readonly string[]) {
  const slots = evidence.slots, ready = slots.filter((slot) => statuses.includes(slot.status));
  if (!slots.length) fail("output_execution_grant_not_found", 404);
  if (!ready.length) return ready;
  if (!["authorized", "active"].includes(String(evidence.row.status)) || !Number(evidence.row.deadline_current)) {
    await bridge.cleanupExpiredOrRevoked?.({ request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, slots });
    fail("output_execution_grant_inactive", 403);
  }
  requireCurrentSource(trusted);
  // All targets share this already-authorized Document and immutable grant body.
  // The later per-job HTTP runner rechecks its live route before any transfer.
  for (const slot of ready) await validateOutputExecutionTarget(trusted, evidence, slot);
  return ready;
}

// Only the dormant internal entry can supply a fresh execution seal. Registered
// requests retain their existing refusal of sponsored personal execution.
async function requireRecordedSponsorExecution(trusted: OutputTrustedContext, grantId: string, evidence: OutputGrantEvidence, authority?: SponsorExecutionAuthority) {
  const envelope = record(evidence.authorization.output_command_envelope);
  if (trusted.scope.kind !== "personal" || !Object.hasOwn(envelope, "sponsor_entitlement")) {
    if (authority) fail("sponsor_execution_binding_changed", 403);
    return null;
  }
  if (!authority) fail("sponsor_execution_not_enabled", 403);
  const sponsor = await requireSponsorExecution(authority, trusted.env, trusted.scope.actorUserId, { grantId, scopeKey: trusted.scope.key });
  if (canonicalOutputJson(envelope.sponsor_entitlement) !== canonicalOutputJson(sponsor.marker)) fail("sponsor_execution_binding_changed", 403);
  return sponsor;
}

async function runGrant(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge: OutputExecutionBridge | undefined, executionContext: WorkerExecutionContext, executionAuthority?: SponsorExecutionAuthority) {
  if (!bridge) fail("native_execution_unavailable", 409);
  const sceneRun = executionAuthority ? sponsorSceneRunPreparation(executionAuthority, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) : null;
  const audioRun = executionAuthority ? sponsorAudioRunPreparation(executionAuthority, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) : null;
  const assertSceneRequest = () => { if (sceneRun && sponsorSceneRunPreparation(executionAuthority!, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) !== sceneRun) fail("sponsor_scene_handoff_changed", 403); if (audioRun && sponsorAudioRunPreparation(executionAuthority!, { request: trusted.request, env: trusted.env, actorUserId: trusted.scope.actorUserId, documentId: trusted.scope.documentId }) !== audioRun) fail("sponsor_audio_handoff_changed", 403); };
  const grantId = identifier(body.grantId, "grant_id_required");
  const evidence = await readOutputGrantEvidence(trusted.env, trusted.scope, grantId, true);
  assertSceneRequest();
  const sponsor = await requireRecordedSponsorExecution(trusted, grantId, evidence, executionAuthority);
  assertSceneRequest();
  const ready = await validateRecordedOutputRun(trusted, evidence, bridge, ["authorized", "queued", "running"]);
  assertSceneRequest();
  const readyIds = ready.map((slot) => slot.slotId);
  const sceneJobRuns:NonNullable<OutputCommandWrite['sceneJobRuns']>=[];
  const sceneRunAssertions: OutputSqlAssertion[] = [];
  const sceneRunChecks: Array<Parameters<typeof sceneSponsorRunTransaction>[1]> = [];
  const audioRunChecks: Array<Parameters<typeof audioSponsorRunTransaction>[1]> = [];
  for(const slot of ready){
    if(audioRun){
      if(!evidence.confirmedPlan.plan.targets.some(target=>target.id===slot.targetId&&Object.hasOwn(target,"audio_contract")))fail("sponsor_audio_handoff_changed",403);
      const job=await trusted.env.DB.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=?").bind(slot.jobId,trusted.scope.ownerUserId,`creative:${trusted.scope.actorUserId}`,trusted.scope.documentId).first<{correlation_id:string}>();
      assertSceneRequest();if(!job)fail("sponsor_audio_handoff_changed",403);
      const captured={request:trusted.request,env:trusted.env,scope:trusted.scope,slot,correlationId:job.correlation_id};sceneRunAssertions.push(...audioSponsorRunTransaction(audioRun,captured));audioRunChecks.push(captured);
    }
    if(!evidence.confirmedPlan.plan.targets.some(target=>target.id===slot.targetId&&Object.hasOwn(target,'scene_contract')))continue;
    const retained=await trusted.env.DB.prepare('SELECT scene_source_version_json IS NOT NULL AS present,scene_source_protocol,correlation_id FROM document_jobs WHERE job_id=? AND owner_id=?').bind(slot.jobId,trusted.scope.ownerUserId).first<{present:number;scene_source_protocol:number;correlation_id:string}>();
    assertSceneRequest();
    if(retained&&Boolean(retained.scene_source_protocol===1)!==Boolean(retained.present))throw new OutputConflictError('output_scene_source_witness_unavailable',409);
    if(sceneRun&&!retained?.present)fail("sponsor_scene_handoff_changed",403);
    if(retained?.present){const receipt=await readSceneJobSourceWitness(trusted.env,trusted.scope,slot,retained.correlation_id);
      assertSceneRequest();
      if(sceneRun){const captured={request:trusted.request,env:trusted.env,scope:trusted.scope,slot,correlationId:retained.correlation_id,raw:receipt.raw};sceneRunAssertions.push(...sceneSponsorRunTransaction(sceneRun,captured));sceneRunChecks.push(captured);}
      sceneJobRuns.push({slot,version:receipt.witness.successor,previousRaw:receipt.raw});}
  }
  const saved = await commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "request"),sceneJobRuns, events: [{ type: "OutputExecutionRunRequested", payload: { grant_id: grantId, job_ids: evidence.slots.map((slot) => slot.jobId), existing_jobs_only: true } }],
    assertions: [...(sponsor?.assertions ?? []), ...sceneRunAssertions, ...(ready.length ? [outputRunGrantAssertion(trusted.scope, grantId), { sql: "NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.scope_key=? AND slot.grant_id=? AND slot.status IN('authorized','queued','running') AND slot.slot_id NOT IN(SELECT value FROM json_each(?)))", bindings: [trusted.scope.key, grantId, JSON.stringify(readyIds)] }] : [])],
    buildSidecars: (events) => { assertSceneRequest(); if(sceneRun)for(const captured of sceneRunChecks)sceneSponsorRunTransaction(sceneRun,captured); if(audioRun)for(const captured of audioRunChecks)audioSponsorRunTransaction(audioRun,captured); const durable = prepareOutputDurableRun(trusted.env, trusted.scope, ready, events.at(-1)!.eventId); return ({ statements: [trusted.env.DB.prepare("UPDATE output_operation_slots SET status='queued',updated_at=? WHERE scope_key=? AND grant_id=? AND status='authorized' AND slot_id IN(SELECT value FROM json_each(?))").bind(nowIso(), trusted.scope.key, grantId, JSON.stringify(readyIds)), trusted.env.DB.prepare("UPDATE output_execution_grants SET status='active' WHERE scope_key=? AND grant_id=? AND status='authorized'").bind(trusted.scope.key, grantId), ...durable.statements], assertions: [...(ready.length ? [outputRunGrantAssertion(trusted.scope, grantId)] : []), ...durable.assertions] }); } });
  // Dispatch is an existing-job wake-up only. No new source read, slot, budget,
  // provider call or alternative is created here; the job HTTP runner owns work.
  assertSceneRequest();
  if (ready.length) { const woke=await wakeOutputDurableJobs(trusted.env,ready);assertSceneRequest();if(!woke){await bridge.dispatch({ request: trusted.request, env: trusted.env, scope: trusted.scope, principal: trusted.principal, executionContext,
    slots: ready.map((slot) => slot.status === "authorized" ? { ...slot, status: "queued" } : slot) });assertSceneRequest();} }
  return saved;
}

async function resumeRecordedOutputRun(trusted: OutputTrustedContext, grantId: string, bridge: OutputExecutionBridge | undefined, executionContext: WorkerExecutionContext, executionAuthority?: SponsorExecutionAuthority) {
  if (!bridge) fail("native_execution_unavailable", 409);
  const identity = () => ({request:trusted.request,env:trusted.env,actorUserId:trusted.scope.actorUserId,documentId:trusted.scope.documentId});
  const audioRun = executionAuthority ? sponsorAudioRunPreparation(executionAuthority,identity()) : null;
  const current = () => { if(audioRun && sponsorAudioRunPreparation(executionAuthority!,identity())!==audioRun)fail("sponsor_audio_handoff_changed",403); };
  const evidence = await readOutputGrantEvidence(trusted.env, trusted.scope, grantId, true); current();
  const sponsor = await requireRecordedSponsorExecution(trusted, grantId, evidence, executionAuthority); current();
  const pending = await validateRecordedOutputRun(trusted, evidence, bridge, ["queued", "running"]); current();
  if (!pending.length) return;
  const audioChecks:Array<Parameters<typeof audioSponsorRunTransaction>[1]>=[],audioAssertions:OutputSqlAssertion[]=[];
  if(audioRun)for(const slot of pending){
    const job=await trusted.env.DB.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=?")
      .bind(slot.jobId,trusted.scope.ownerUserId,`creative:${trusted.scope.actorUserId}`,trusted.scope.documentId).first<{correlation_id:string}>();
    current();if(!job)fail("sponsor_audio_handoff_changed",403);
    const captured={request:trusted.request,env:trusted.env,scope:trusted.scope,slot,correlationId:job.correlation_id};
    audioAssertions.push(...audioSponsorRunTransaction(audioRun,captured));audioChecks.push(captured);
  }
  const currentSlots=()=>{current();if(audioRun)for(const captured of audioChecks)audioSponsorRunTransaction(audioRun,captured);};
  // Identical replay resumes only recorded jobs under fresh authority. Exact
  // provider receipts and leases decide whether a logical call was consumed.
  const statements=[...(sponsor?.assertions ?? []),...audioAssertions, outputScopeAuthority(trusted.scope, "request"), outputRunGrantAssertion(trusted.scope, grantId), ...trusted.sourceAssertions, ...retainedOutputBodyAssertions(trusted.scope),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${trusted.scope.ownerUserId}`, trusted.ownerHead] }].flatMap((assertion) => outputAssertionStatements(trusted.env, assertion));
  currentSlots();const checked=await trusted.env.DB.batch(statements);currentSlots();
  if(audioRun){const own=(value:unknown,key:PropertyKey):unknown=>value&&typeof value==="object"?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
    if(!Array.isArray(checked)||own(checked,"length")!==statements.length||Array.from({length:statements.length},(_,index)=>{
      const result=own(checked,index);return own(result,"success")!==true||!audioAcknowledgementErrorClear(result);
    }).some(Boolean))fail("sponsor_audio_handoff_changed",403);
  }
  const woke=await wakeOutputDurableJobs(trusted.env,pending);currentSlots();
  if(!woke){await bridge.dispatch({request:trusted.request,env:trusted.env,scope:trusted.scope,principal:trusted.principal,executionContext,slots:pending});currentSlots();}
}

export function outputAssetStorageIdentity(scope: OutputScope, assetId: string, inspection: OutputAssetInspection) {
  if (inspection.status !== "inspected" || !inspection.sha256 || !inspection.extension || !inspection.mimeType) fail("output_asset_not_inspected", 400);
  return { ...outputAssetObjectKeys(scope, assetId, inspection.sha256, inspection.extension),
    metadata: { ownerId: scope.ownerUserId, projectId: scope.projectId, scopeKey: scope.key, assetId, documentId: scope.documentId, sha256: inspection.sha256, mimeType: inspection.mimeType, outputRequirementAsset: "1" } };
}

async function readBoundedRequest(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maximumBytes) fail("output_request_too_large", 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > maximumBytes) { await reader.cancel(); fail("output_request_too_large", 413); }
    chunks.push(part.value);
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

type PreparedAsset = { id: string; name: string; storageKey: string; inspection: OutputAssetInspection; mediaKind: OutputAssetRow["mediaKind"]; createdAt: string; sourceDigest: string; origin: Record<string, unknown> };
async function prepareOwnedAsset(trusted: OutputTrustedContext, bytes: Uint8Array, name: string, origin: Record<string, unknown>, command: { key: string; digest: string; assertions?: OutputSqlAssertion[] }): Promise<PreparedAsset> {
  if (!validOutputAssetName(name)) fail("invalid_output_asset_name");
  const inspection = await inspectOutputAsset(bytes, name, { snapshot: false });
  if (inspection.status !== "inspected" || !inspection.kind || !inspection.sha256 || !inspection.mimeType) return fail(inspection.errors[0] ?? "output_asset_unsupported", 415);
  const candidateId = uuidV7(), candidateStorage = outputAssetStorageIdentity(trusted.scope, candidateId, inspection);
  const claimed = await claimOutputAssetStorage(trusted.env, { scope: trusted.scope, assetId: candidateId, commandKey: command.key, requestDigest: command.digest, sourceDigest: trusted.sourceDigest, storageKey: candidateStorage.key, sha256: inspection.sha256, byteLength: bytes.byteLength, expectedHead: trusted.ownerHead, expectedProjectHead: trusted.projectHead, sourceAssertions: [...trusted.sourceAssertions, ...(command.assertions ?? []), ...retainedOutputBodyAssertions(trusted.scope)] });
  const receipt = claimed.receipt, id = receipt.asset_id, identity = outputAssetStorageIdentity(trusted.scope, id, inspection);
  if (receipt.storage_key !== identity.key && receipt.storage_key !== identity.legacyKey) fail("output_asset_write_identity_conflict", 409);
  const storage = { ...identity, key: receipt.storage_key };
  if (!claimed.claimed && (receipt.status !== "written" || receipt.write_acknowledged !== 1 || receipt.publication_event_id)) fail("output_asset_write_reconciliation_required", 409);
  try {
    if (claimed.claimed) {
      const acknowledgement = await trusted.env.MEDIA.put(storage.key, assetBuffer(bytes), { httpMetadata: { contentType: inspection.mimeType }, customMetadata: storage.metadata });
      if (!acknowledgement || record(acknowledgement).key !== storage.key) fail("output_asset_write_unacknowledged", 409);
      await acknowledgeOutputAssetStorage(trusted.env, receipt);
    } else {
      // A retry can reuse a durably acknowledged unpublished write, but never
      // issues another PUT for an uncertain receipt or trusts metadata as bytes.
      const stored = await trusted.env.MEDIA.get(storage.key);
      if (!stored || !outputAssetStorageCustodyMatches({ ownerUserId: trusted.scope.ownerUserId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId, scopeKey: trusted.scope.key, assetId: id, sha256: inspection.sha256, storageKey: storage.key }, stored.customMetadata) || Number(stored.size) !== inspection.byteLength) fail("output_asset_custody_mismatch", 409);
      const retained = await inspectOutputAsset(new Uint8Array(await new Response(stored.body).arrayBuffer()), name);
      if (retained.status !== "inspected" || retained.sha256 !== inspection.sha256) fail("output_asset_bytes_changed", 409);
    }
    await trusted.env.DB.batch([outputScopeAuthority(trusted.scope, "author"), ...trusted.sourceAssertions, ...(command.assertions ?? []), ...retainedOutputBodyAssertions(trusted.scope), outputAssetPublicationAssertion(trusted.scope.key, id, storage.key, inspection.sha256)].flatMap((assertion) => outputAssertionStatements(trusted.env, assertion)));
    return { id, name, storageKey: storage.key, inspection, mediaKind: inspection.kind === "presentation" ? "slides" : inspection.kind, createdAt: receipt.created_at, sourceDigest: trusted.sourceDigest, origin };
  } catch (error) { await cleanupOutputAssetStorage(trusted.env, trusted.scope.key, id); throw error; }
}

function assetEvent(asset: PreparedAsset) {
  return { type: "OutputAssetAdopted", payload: { asset_id: asset.id, asset: { id: asset.id, name: asset.name, inspection: asset.inspection, origin: asset.origin, sourceDigest: asset.sourceDigest } } };
}
function assetStatements(trusted: OutputTrustedContext, asset: PreparedAsset, events: EventRow[]): D1PreparedStatement[] {
  const event = events.find((value) => value.type === "OutputAssetAdopted" && value.payload.asset_id === asset.id);
  if (!event) throw new Error("output_asset_event_required");
  return [...outputAssertionStatements(trusted.env, outputAssetPublicationAssertion(trusted.scope.key, asset.id, asset.storageKey, asset.inspection.sha256!)), trusted.env.DB.prepare(`INSERT INTO output_assets(scope_key,asset_id,document_id,owner_user_id,created_by_user_id,source_digest,storage_key,content_sha256,byte_length,mime_type,media_kind,created_event_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(trusted.scope.key, asset.id, trusted.scope.documentId, trusted.scope.ownerUserId, trusted.scope.actorUserId, asset.sourceDigest, asset.storageKey, asset.inspection.sha256!, asset.inspection.byteLength, asset.inspection.mimeType!, asset.mediaKind, event.eventId, asset.createdAt), ...outputAssetPublicationStatements(trusted.env, trusted.scope.key, asset.id, event.eventId)];
}

async function cleanupUncommittedOutputAsset(trusted: OutputTrustedContext, asset: PreparedAsset) {
  await cleanupOutputAssetStorage(trusted.env, trusted.scope.key, asset.id);
}

async function storeUpload(trusted: OutputTrustedContext, request: Request) {
  const body = { action: "adopt", documentId: trusted.scope.documentId, expectedRevision: request.headers.get("x-output-expected-revision"), clientMutationId: request.headers.get("x-output-client-mutation-id") };
  if (request.headers.get("x-output-rights-confirmed") !== "true") fail("owned_file_rights_attestation_required", 403);
  let name = "";
  try { name = decodeURIComponent(request.headers.get("x-output-filename") ?? ""); } catch { fail("invalid_output_asset_name"); }
  const bytes = await readBoundedRequest(request, /\.glb$/iu.test(name) ? MAX_OUTPUT_MODEL3D_ASSET_BYTES : MAX_OUTPUT_ASSET_BYTES);
  const inspection = await inspectOutputAsset(bytes, name, { snapshot: false });
  if (inspection.status !== "inspected") return json({ error: "output_asset_not_inspectable", inspection }, 415);
  const digest = await outputDigest({ ...body, name, sha256: inspection.sha256, rightsAttested: true });
  const previous = await readOutputCommand(trusted.env, trusted.scope, identifier(body.clientMutationId, "client_mutation_id_required"), digest, { allowUnavailableReceipt: true });
  if (previous) return { replayed: true, receipt: previous, events: [] as EventRow[] };
  commandWrite(trusted, body, digest, "author");
  requireCurrentSource(trusted);
  const asset = await prepareOwnedAsset(trusted, bytes, name, { kind: "owned_upload", rightsAttestedBy: trusted.scope.actorUserId, rightsAttestedAt: nowIso() }, { key: identifier(body.clientMutationId), digest });
  try {
    const saved = await commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [assetEvent(asset)], buildSidecars: (events) => ({ statements: assetStatements(trusted, asset, events) }) });
    return saved;
  } finally { await cleanupUncommittedOutputAsset(trusted, asset); }
}

async function loadOutputAssetEvidence(trusted: OutputTrustedContext, assetId: string, preloaded?: OutputBulkAssetEvidence) {
  requireCurrentSource(trusted);
  if (preloaded) {
    if (preloaded.row.asset_id !== assetId || preloaded.row.scope_key !== trusted.scope.key || preloaded.row.document_id !== trusted.scope.documentId || preloaded.row.owner_user_id !== trusted.scope.ownerUserId || preloaded.row.redacted_at) fail("output_asset_unavailable", 404);
    const { row, origin } = preloaded;
    if (origin.kind === "native_job" && row.source_digest !== trusted.sourceDigest) fail("native_output_source_needs_recheck", 409);
    if (origin.kind !== "native_job" && (origin.kind !== "owned_upload" || origin.rightsAttestedBy !== row.created_by_user_id)) fail("output_asset_rights_evidence_missing", 409);
    return preloaded;
  }
  const row = await trusted.env.DB.prepare("SELECT * FROM output_assets WHERE scope_key=? AND asset_id=? AND document_id=? AND owner_user_id=? AND redacted_at IS NULL")
    .bind(trusted.scope.key, assetId, trusted.scope.documentId, trusted.scope.ownerUserId).first<Record<string, unknown>>();
  if (!row) fail("output_asset_unavailable", 404);
  const body = await privateEventBody(trusted.env, trusted.scope, String(row.created_event_id)), asset = record(body.asset), origin = record(asset.origin);
  if (origin.kind === "native_job" && row.source_digest !== trusted.sourceDigest) fail("native_output_source_needs_recheck", 409);
  if (origin.kind !== "native_job" && (origin.kind !== "owned_upload" || origin.rightsAttestedBy !== row.created_by_user_id)) fail("output_asset_rights_evidence_missing", 409);
  return { row, asset, origin, name: String(asset.name ?? "") };
}

/** Read exact private bytes. MIME, filenames and supplied dimensions are never authority. */
async function loadExactAsset(trusted: OutputTrustedContext, assetId: string, preloaded?: OutputBulkAssetEvidence) {
  const { row, name, origin } = await loadOutputAssetEvidence(trusted, assetId, preloaded);
  const object = await trusted.env.MEDIA.get(String(row.storage_key));
  if (!object || Number(object.size ?? 0) > (row.media_kind === "model3d" ? MAX_OUTPUT_MODEL3D_ASSET_BYTES : MAX_OUTPUT_ASSET_BYTES) || !outputAssetStorageCustodyMatches({ ownerUserId: trusted.scope.ownerUserId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId, scopeKey: trusted.scope.key, assetId, sha256: String(row.content_sha256), storageKey: String(row.storage_key) }, object.customMetadata)) fail("output_asset_custody_mismatch", 409);
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  const inspection = await inspectOutputAsset(bytes, name, { snapshot: false });
  if (inspection.status !== "inspected" || inspection.sha256 !== row.content_sha256 || inspection.byteLength !== row.byte_length || inspection.mimeType !== row.mime_type) fail("output_asset_bytes_changed", 409);
  const expectedStorage = outputAssetStorageIdentity(trusted.scope, assetId, inspection);
  if (expectedStorage.key !== row.storage_key && expectedStorage.legacyKey !== row.storage_key) fail("output_asset_custody_mismatch", 409);
  return { row, bytes, name, inspection, origin };
}

export function inspectOutputTargetFile(target: OutputPlanTarget, inspection: OutputAssetInspection) {
  if (Object.hasOwn(target, "video_contract")) return { status: "failed" as const, checks: [], problems: ["video_contract_media_validation_unavailable"] };
  // Generic Markdown/file inspection cannot prove the narrative body contract.
  // This fence also protects reuse, human approval and final delivery rechecks.
  if (Object.hasOwn(target, "audio_contract")) return { status: "failed" as const, checks: [], problems: ["audio_contract_media_validation_unavailable"] };
  if (Object.hasOwn(target, "storyboard_contract")) return { status: "failed" as const, checks: [], problems: ["storyboard_contract_media_validation_unavailable"] };
  if (Object.hasOwn(target, "narrative_contract")) return { status: "failed" as const, checks: [], problems: ["narrative_body_validation_unavailable"] };
  const problems = target.blocking_issues.map((issue) => issue.code);
  const checks = [...inspection.checks];
  const kind = inspection.kind === "presentation" ? "slides" : inspection.kind;
  if (inspection.status !== "inspected") problems.push("asset_structure_unverified");
  if (target.media_kind !== kind) problems.push("target_media_kind_mismatch");
  if (target.aspect_ratio) {
    const width = kind === "slides" ? inspection.facts.slideWidthEmu : inspection.facts.width;
    const height = kind === "slides" ? inspection.facts.slideHeightEmu : inspection.facts.height;
    if (!width || !height) problems.push("required_aspect_ratio_unmeasured");
    else if (width * target.aspect_ratio.height !== height * target.aspect_ratio.width) problems.push("required_aspect_ratio_mismatch");
    else checks.push("exact_authored_aspect_ratio");
  }
  if (target.content_quantity) {
    const actual = target.content_quantity.unit === "slide" ? inspection.facts.slideCount : target.content_quantity.unit === "second" ? inspection.facts.durationSeconds : undefined;
    if (actual === undefined || !target.count_policy) problems.push("required_content_quantity_unmeasured");
    else if (!outputCountSatisfies(actual, target.content_quantity, target.count_policy)) problems.push("required_content_quantity_mismatch");
    else checks.push("authored_and_confirmed_count_policy");
  }
  if (target.coverage.kind === "unresolved" || target.source_scope.kind === "unknown") problems.push("required_coverage_unresolved");
  return { status: problems.length ? "failed" as const : "passed" as const, checks: [...new Set(checks)], problems: [...new Set(problems)] };
}

async function bindResult(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge?: OutputExecutionBridge) {
  requireCurrentSource(trusted);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, identifier(body.planRevisionId, "plan_revision_id_required")));
  const target = plan.plan.targets.find((candidate) => candidate.id === body.targetId);
  if (!target) fail("output_target_not_found", 404);
  if (target.blocking_issues.length) return json({ error: "output_target_unresolved", issues: target.blocking_issues }, 409);
  if ([body.assetId, body.nativeJobId, body.acceptanceId].filter(Boolean).length !== 1) fail("choose_one_output_result");
  if (body.acceptanceId) return reuseTargetAcceptance(trusted, body, digest, plan, target);
  commandWrite(trusted, body, digest, "author");
  let preparedAsset: PreparedAsset | undefined;
  let sourceAssertions: OutputSqlAssertion[] = [];
  if (body.nativeJobId) {
    if (!bridge?.resolveResult) fail("native_result_adoption_unavailable", 409);
    const native = await bridge.resolveResult({ ...bridgeTarget(trusted, plan, target), nativeJobId: identifier(body.nativeJobId, "native_job_id_required") });
    if (!native.assertions.length) fail("native_result_lineage_required", 500);
    preparedAsset = await prepareOwnedAsset(trusted, native.bytes, native.name, { ...native.origin, kind: "native_job", jobId: body.nativeJobId }, { key: identifier(body.clientMutationId), digest, assertions: native.assertions });
    sourceAssertions = native.assertions;
  }
  try {
    const stored = preparedAsset ? null : await loadExactAsset(trusted, identifier(body.assetId, "asset_id_required"));
    const inspection = preparedAsset?.inspection ?? stored!.inspection;
    const assetId = preparedAsset?.id ?? String(stored!.row.asset_id);
    const measured = inspectOutputTargetFile(target, inspection), resultId = uuidV7(), createdAt = nowIso();
    const result = { id: resultId, targetId: target.id, planRevisionId: plan.revisionId, assetId, resultRevision: inspection.sha256!, targetContractDigest: plan.targetContractDigests[target.id], sourceDigest: trusted.sourceDigest, sha256: inspection.sha256!, checksStatus: measured.status, checks: measured.checks, problems: measured.problems, createdByUserId: trusted.scope.actorUserId, createdAt };
    const saved = await commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [...(preparedAsset ? [assetEvent(preparedAsset)] : []), { type: "OutputResultBound", payload: { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, asset_id: assetId, result } }], assertions: sourceAssertions,
      buildSidecars: (events) => ({ statements: [...(preparedAsset ? assetStatements(trusted, preparedAsset, events) : []), trusted.env.DB.prepare(`INSERT INTO output_results(scope_key,result_id,document_id,plan_revision_id,target_id,target_contract_digest,source_digest,asset_id,result_revision,content_sha256,validation_policy,checks_status,created_by_user_id,bound_event_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(trusted.scope.key, resultId, trusted.scope.documentId, plan.revisionId, target.id, result.targetContractDigest, trusted.sourceDigest, assetId, result.resultRevision, result.sha256, VALIDATION_POLICY, measured.status, trusted.scope.actorUserId, events.at(-1)!.eventId, createdAt)],
        assertions: [{ sql: "EXISTS(SELECT 1 FROM output_assets asset JOIN event_private_payloads private_body ON private_body.private_event_id=asset.created_event_id AND private_body.redacted_at IS NULL WHERE asset.scope_key=? AND asset.asset_id=? AND asset.document_id=? AND asset.content_sha256=? AND asset.redacted_at IS NULL)", bindings: [trusted.scope.key, assetId, trusted.scope.documentId, result.sha256] }] }) });
    return saved;
  } finally { if (preparedAsset) await cleanupUncommittedOutputAsset(trusted, preparedAsset); }
}

async function reuseTargetAcceptance(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, plan: OutputConfirmedPlan, target: OutputPlanTarget) {
  const acceptanceId = identifier(body.acceptanceId, "acceptance_id_required");
  const result = (await readResults(trusted)).find((candidate) => candidate.acceptanceId === acceptanceId && candidate.review === "approved");
  if (!result || result.targetId !== target.id || result.targetContractDigest !== plan.targetContractDigests[target.id] || result.sourceDigest !== trusted.sourceDigest || result.checksStatus !== "passed") fail("prior_output_acceptance_not_eligible", 409);
  const asset = await loadExactAsset(trusted, result.assetId);
  if (asset.inspection.sha256 !== result.sha256 || result.resultRevision !== result.sha256 || inspectOutputTargetFile(target, asset.inspection).status !== "passed") fail("prior_output_acceptance_not_eligible", 409);
  const createdAt = nowIso();
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "author"), events: [{ type: "OutputFulfillmentSelected", payload: { plan_revision_id: plan.revisionId, target_id: target.id, acceptance_id: acceptanceId, result_id: result.id, reused_human_approval: true, eligibility: { sourceDigest: trusted.sourceDigest, targetContractDigest: result.targetContractDigest, resultRevision: result.resultRevision, sha256: result.sha256, checkedAt: createdAt } } }],
    assertions: [{ sql: `EXISTS(SELECT 1 FROM output_target_acceptances accepted JOIN output_results result ON result.scope_key=accepted.scope_key AND result.result_id=accepted.result_id
      JOIN output_assets asset ON asset.scope_key=result.scope_key AND asset.asset_id=result.asset_id AND asset.redacted_at IS NULL
      JOIN event_private_payloads approval_body ON approval_body.private_event_id=accepted.approval_event_id AND approval_body.redacted_at IS NULL
      JOIN event_private_payloads asset_body ON asset_body.private_event_id=asset.created_event_id AND asset_body.redacted_at IS NULL
      WHERE accepted.scope_key=? AND accepted.acceptance_id=? AND accepted.target_id=? AND accepted.target_contract_digest=? AND accepted.source_digest=?
        AND accepted.result_id=? AND accepted.result_revision=? AND accepted.content_sha256=? AND accepted.validation_policy=? AND result.checks_status='passed' AND asset.content_sha256=accepted.content_sha256)`,
      bindings: [trusted.scope.key, acceptanceId, target.id, plan.targetContractDigests[target.id], trusted.sourceDigest, result.id, result.resultRevision, result.sha256, VALIDATION_POLICY] }, distinctPhysicalFileAssertion(trusted, plan, target, result.sha256)],
    buildSidecars: (events) => ({ statements: [trusted.env.DB.prepare(`INSERT INTO output_plan_fulfillments(scope_key,plan_revision_id,target_id,acceptance_id,eligibility_event_id,checked_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(scope_key,plan_revision_id,target_id) DO UPDATE SET acceptance_id=excluded.acceptance_id,eligibility_event_id=excluded.eligibility_event_id,checked_at=excluded.checked_at`)
      .bind(trusted.scope.key, plan.revisionId, target.id, acceptanceId, events.at(-1)!.eventId, createdAt)] }) });
}

function distinctPhysicalFileAssertion(trusted: OutputTrustedContext, plan: OutputConfirmedPlan, target: OutputPlanTarget, sha256: string): OutputSqlAssertion {
  return { sql: `NOT EXISTS(SELECT 1 FROM output_plan_fulfillments selected JOIN output_target_acceptances accepted ON accepted.scope_key=selected.scope_key AND accepted.acceptance_id=selected.acceptance_id
    WHERE selected.scope_key=? AND selected.plan_revision_id=? AND selected.target_id<>? AND accepted.content_sha256=?)`, bindings: [trusted.scope.key, plan.revisionId, target.id, sha256] };
}

async function reviewResult(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string) {
  requireCurrentSource(trusted);
  const resultId = identifier(body.resultId, "result_id_required");
  if (!["approve", "changes_requested"].includes(String(body.decision))) fail("output_review_decision_required");
  const row = await trusted.env.DB.prepare("SELECT * FROM output_results WHERE scope_key=? AND result_id=? AND document_id=?").bind(trusted.scope.key, resultId, trusted.scope.documentId).first<Record<string, unknown>>();
  if (!row) fail("output_result_not_found", 404);
  await privateEventBody(trusted.env, trusted.scope, String(row.bound_event_id));
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, String(row.plan_revision_id)));
  const target = plan.plan.targets.find((candidate) => candidate.id === row.target_id);
  if (!target || plan.targetContractDigests[target.id] !== row.target_contract_digest || row.source_digest !== trusted.sourceDigest || row.validation_policy !== VALIDATION_POLICY) fail("output_result_needs_recheck", 409);
  const asset = await loadExactAsset(trusted, String(row.asset_id));
  const measured = inspectOutputTargetFile(target, asset.inspection);
  const approve = body.decision === "approve";
  if (approve && (body.reviewedCoverage !== true || body.reviewedRights !== true)) fail("output_content_and_rights_review_required", 403);
  if (approve && (measured.status !== "passed" || row.checks_status !== "passed" || row.content_sha256 !== asset.inspection.sha256 || row.result_revision !== asset.inspection.sha256)) return json({ error: "output_mandatory_checks_failed", problems: measured.problems }, 409);
  if (approve) {
    const unique = distinctPhysicalFileAssertion(trusted, plan, target, asset.inspection.sha256!);
    if (!await trusted.env.DB.prepare(`SELECT 1 AS distinct_file WHERE (${unique.sql})`).bind(...(unique.bindings ?? [])).first()) fail("physical_output_targets_require_distinct_files", 409);
  }
  const reviewEligibility = outputReviewEligibility(trusted.scope, trusted.principal, String(row.created_by_user_id), String(asset.row.created_by_user_id), asset.origin);
  if (!reviewEligibility.reviewAllowed) fail(reviewEligibility.independentReviewBlocked ? "independent_output_reviewer_required" : "output_action_not_authorized", 403);
  const acceptanceId = approve ? uuidV7() : null, createdAt = nowIso();
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 10_000) fail("output_review_note_too_long");
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "review"), events: [{ type: approve ? "OutputTargetAccepted" : "OutputTargetChangesRequested", payload: { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, ...(acceptanceId ? { acceptance_id: acceptanceId } : {}), content_sha256: row.content_sha256, result_revision: row.result_revision, target_contract_digest: row.target_contract_digest, source_digest: trusted.sourceDigest, validation_policy: VALIDATION_POLICY, reviewed_coverage: approve, reviewed_rights: approve, reviewer_user_id: trusted.scope.actorUserId, note } }],
    assertions: [{ sql: "EXISTS(SELECT 1 FROM output_results result JOIN output_assets asset ON asset.scope_key=result.scope_key AND asset.asset_id=result.asset_id JOIN event_private_payloads body ON body.private_event_id=result.bound_event_id AND body.redacted_at IS NULL WHERE result.scope_key=? AND result.result_id=? AND result.content_sha256=? AND result.source_digest=? AND asset.redacted_at IS NULL AND asset.content_sha256=result.content_sha256)", bindings: [trusted.scope.key, resultId, row.content_sha256 as string, trusted.sourceDigest] }, ...(approve ? [distinctPhysicalFileAssertion(trusted, plan, target, asset.inspection.sha256!)] : [])],
    buildSidecars: (events) => ({ statements: approve ? [trusted.env.DB.prepare(`INSERT INTO output_target_acceptances(scope_key,acceptance_id,target_id,target_contract_digest,result_id,result_revision,content_sha256,source_digest,validation_policy,reviewer_user_id,approval_event_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(trusted.scope.key, acceptanceId!, target.id, row.target_contract_digest as string, resultId, row.result_revision as string, row.content_sha256 as string, trusted.sourceDigest, VALIDATION_POLICY, trusted.scope.actorUserId, events.at(-1)!.eventId, createdAt),
      trusted.env.DB.prepare(`INSERT INTO output_plan_fulfillments(scope_key,plan_revision_id,target_id,acceptance_id,eligibility_event_id,checked_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(scope_key,plan_revision_id,target_id) DO UPDATE SET acceptance_id=excluded.acceptance_id,eligibility_event_id=excluded.eligibility_event_id,checked_at=excluded.checked_at`)
        .bind(trusted.scope.key, plan.revisionId, target.id, acceptanceId!, events.at(-1)!.eventId, createdAt)] : [trusted.env.DB.prepare(`DELETE FROM output_plan_fulfillments WHERE scope_key=? AND acceptance_id IN(SELECT acceptance_id FROM output_target_acceptances WHERE scope_key=? AND result_id=?)`).bind(trusted.scope.key, trusted.scope.key, resultId)] }) });
}

type DeliveryEntry = { targetId: string; assetId: string; acceptanceId: string; resultId: string; resultRevision: string; sha256: string; targetContractDigest: string };
async function currentDeliveryEntries(trusted: OutputTrustedContext, plan: OutputConfirmedPlan, options: { targetIds?: Set<string> } = {}): Promise<DeliveryEntry[]> {
  requireCurrentSource(trusted);
  const model = requireCompleteOutputReadModel(await readOutputModel(trusted));
  const entries: DeliveryEntry[] = [], owed = owedTargetIds(plan.plan), memberships = model.fulfillments.get(plan.revisionId);
  const acceptedResults = new Map(model.results.filter((result) => result.acceptanceId && result.review === "approved").map((result) => [result.acceptanceId, result]));
  for (const target of plan.plan.targets) {
    if (!owed.has(target.id) || options.targetIds && !options.targetIds.has(target.id)) continue;
    const acceptanceId = memberships?.get(target.id);
    if (!acceptanceId) continue;
    const result = acceptedResults.get(acceptanceId);
    if (!result || result.checksStatus !== "passed" || result.targetContractDigest !== plan.targetContractDigests[target.id] || result.sourceDigest !== trusted.sourceDigest || result.targetId !== target.id) fail("output_acceptance_needs_recheck", 409);
    const retained = model.assetEvidence.get(result.assetId);
    if (!retained) fail("output_asset_unavailable", 404);
    const evidence = await loadOutputAssetEvidence(trusted, result.assetId, retained), inspection = retained.inspection;
    if (!retained.available || evidence.row.content_sha256 !== result.sha256 || inspection.status !== "inspected" || inspection.sha256 !== result.sha256 || result.resultRevision !== result.sha256 || inspectOutputTargetFile(target, inspection).status !== "passed") fail("output_accepted_file_changed", 409);
    entries.push({ targetId: target.id, assetId: result.assetId, acceptanceId, resultId: result.id, resultRevision: result.resultRevision, sha256: result.sha256, targetContractDigest: result.targetContractDigest });
  }
  return entries;
}

function deliveryAssertions(trusted: OutputTrustedContext, plan: OutputConfirmedPlan, entries: DeliveryEntry[]): OutputSqlAssertion[] {
  return [outputBulkDeliveryAssertion(trusted.scope, plan.revisionId, trusted.sourceDigest, VALIDATION_POLICY, entries)];
}

function assertOutputHistoryReason(reason: unknown) {
  if (outputScopeAmendmentReasonIssue(reason, { required: true })) fail("output_scope_history_reason_unverified", 409);
}

async function readOutputScopeHistory(trusted: OutputTrustedContext, plan: OutputConfirmedPlan) {
  const rows = await trusted.env.DB.prepare(`SELECT revision.plan_revision_id,revision.revision,revision.confirmed_event_id,body.private_json,event.occurred_at,event.actor,event.client_id
    FROM output_plan_revisions revision JOIN events event ON event.event_id=revision.confirmed_event_id
    LEFT JOIN event_private_payloads body ON body.private_event_id=revision.confirmed_event_id AND body.owner_id=? AND body.project_id=? AND body.document_id=? AND body.redacted_at IS NULL
    WHERE revision.scope_key=? AND revision.document_id=? AND revision.owner_user_id=? AND revision.revision<=? ORDER BY revision.revision LIMIT 129`)
    .bind(trusted.scope.ownerUserId, trusted.scope.projectId, trusted.scope.documentId, trusted.scope.key, trusted.scope.documentId, trusted.scope.ownerUserId, plan.revision).all<Record<string, unknown>>();
  let scopeHistoryComplete = rows.results.length === plan.revision && plan.revision <= 128;
  const scopeAmendments: OutputDeliveryScopeAmendmentInput[] = [];
  let previous: OutputConfirmedPlan | null = null;
  for (const [index, row] of rows.results.entries()) {
    if (typeof row.private_json !== "string") { scopeHistoryComplete = false; previous = null; continue; }
    const payload = rememberOutputPrivateBody(trusted.scope, String(row.confirmed_event_id), row.private_json);
    // A retained incompatible reason cannot be omitted, rewritten, or hidden by
    // a later confirmation to make the assignment appear exportable.
    if (payload.scope_amendment !== undefined) assertOutputHistoryReason(record(payload.scope_amendment).reason);
    if (Number(row.revision) !== index + 1) { scopeHistoryComplete = false; previous = null; continue; }
    const current = record(payload.confirmed_plan) as OutputConfirmedPlan;
    if (!current.plan || current.revisionId !== row.plan_revision_id || current.revision !== Number(row.revision)) { scopeHistoryComplete = false; previous = null; continue; }
    if (previous) {
      const owed = owedTargetIds(current.plan), obligations = new Set(current.plan.obligations.filter((entry) => entry.required || entry.selected).map((entry) => entry.id));
      const withdrawnTargets = previous.plan.targets.filter((target) => owedTargetIds(previous!.plan).has(target.id) && !owed.has(target.id)).map((target) => ({ id: target.id, label: target.label }));
      const withdrawnObligations = previous.plan.obligations.filter((entry) => (entry.required || entry.selected) && !obligations.has(entry.id)).map((entry) => ({ id: entry.id, label: entry.label }));
      const amendment = record(payload.scope_amendment);
      if (withdrawnTargets.length || withdrawnObligations.length) {
        const sameIds = (value: unknown, expected: string[]) => Array.isArray(value) && value.every((id) => typeof id === "string") && canonicalOutputJson([...value].sort()) === canonicalOutputJson([...expected].sort());
        if (amendment.previous_plan_revision_id !== previous.revisionId || typeof amendment.reason !== "string" || !amendment.reason.trim() || !sameIds(amendment.withdrawn_target_ids, withdrawnTargets.map((target) => target.id)) || !sameIds(amendment.withdrawn_obligation_ids, withdrawnObligations.map((entry) => entry.id))) scopeHistoryComplete = false;
        else scopeAmendments.push({ id: String(row.confirmed_event_id), previousPlanRevisionId: previous.revisionId, planRevisionId: current.revisionId, occurredAt: String(row.occurred_at), reason: amendment.reason, actorRole: row.client_id === "server:output-requirements" && row.actor === `user:${String(payload.actor_user_id ?? "")}` ? "authorized_author" : "unknown", withdrawnObligations, withdrawnTargets });
      } else if (payload.scope_amendment) scopeHistoryComplete = false;
    } else if (Number(row.revision) !== 1) scopeHistoryComplete = false;
    previous = current;
  }
  if (previous?.revisionId !== plan.revisionId || scopeAmendments.length > 64) scopeHistoryComplete = false;
  if (scopeAmendments.length > 64) fail("output_delivery_history_capacity_exceeded", 409);
  return { scopeHistoryComplete, scopeAmendments };
}

async function prepareDelivery(trusted: OutputTrustedContext, body: Record<string, unknown>, digest: string, bridge?: OutputExecutionBridge) {
  requireCurrentSource(trusted);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, identifier(body.planRevisionId, "plan_revision_id_required")));
  requireCompleteOutputReadModel(await readOutputModel(trusted));
  const snapshot = await buildSnapshot(trusted, bridge);
  if (snapshot.confirmedPlan?.revisionId !== plan.revisionId) fail("latest_output_plan_required", 409);
  if (snapshot.capabilities.limitationCodes?.includes("output_scope_history_reason_unverified")) fail("output_scope_history_reason_unverified", 409);
  const partial = snapshot.summary?.delivery_ready !== true;
  if (partial && body.allowPartial !== true) return json({ error: "output_assignment_incomplete", summary: snapshot.summary }, 409);
  const entries = await currentDeliveryEntries(trusted, plan);
  if (!entries.length) fail("no_accepted_outputs_to_export", 409);
  const manifestId = uuidV7(), createdAt = nowIso();
  const history = await readOutputScopeHistory(trusted, plan);
  const scope = outputDeliveryScopeForPlan(plan.plan, { status: snapshot.summary?.scope_known ? partial ? "partial" : "complete" : "unknown", inventoryComplete: snapshot.summary?.scope_known === true, includedTargetIds: entries.map((entry) => entry.targetId) });
  const archiveInput: OutputDeliveryManifestInput = { schemaVersion: 1, deliveryId: manifestId, planId: plan.id, planRevision: plan.revisionId, createdAt, targets: entries.map((entry) => ({ targetId: entry.targetId, fileId: entry.assetId, acceptanceId: entry.acceptanceId })), scope, ...history };
  const fileIds = new Set(entries.map((entry) => entry.assetId));
  const files = snapshot.assets.filter((asset) => fileIds.has(asset.id)).map((asset) => ({ id: asset.id, byteLength: asset.byteLength, kind: asset.mediaKind }));
  if (files.length !== fileIds.size) fail("output_delivery_file_inventory_changed", 409);
  const parts = planOutputDeliveryParts(files, archiveInput);
  const manifest = { schemaVersion: 1, id: manifestId, planId: plan.id, planRevisionId: plan.revisionId, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, isPartial: partial, createdAt, entries, summary: snapshot.summary, scope, parts, ...history };
  return commitOutputCommand(trusted.env, { ...commandWrite(trusted, body, digest, "read"), events: [{ type: "OutputDeliveryPrepared", payload: { manifest_id: manifestId, plan_revision_id: plan.revisionId, is_partial: partial, manifest } }], assertions: deliveryAssertions(trusted, plan, entries),
    buildSidecars: (events) => ({ statements: [trusted.env.DB.prepare("INSERT INTO output_delivery_manifests(scope_key,manifest_id,document_id,plan_revision_id,created_by_user_id,event_id,is_partial,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(trusted.scope.key, manifestId, trusted.scope.documentId, plan.revisionId, trusted.scope.actorUserId, events.at(-1)!.eventId, partial ? 1 : 0, createdAt)] }) });
}

async function downloadDelivery(trusted: OutputTrustedContext, manifestId: string) {
  requireCurrentSource(trusted);
  // Older prepared manifests may predate the history fields. They still cannot
  // bypass an incompatible retained amendment in this Document's ancestry.
  for (const amendment of retainedOutputAmendments(trusted)) assertOutputHistoryReason(record(amendment.payload.scope_amendment).reason);
  const row = await trusted.env.DB.prepare("SELECT * FROM output_delivery_manifests WHERE scope_key=? AND manifest_id=? AND document_id=?").bind(trusted.scope.key, manifestId, trusted.scope.documentId).first<Record<string, unknown>>();
  if (!row) fail("output_delivery_not_found", 404);
  const manifest = record((await privateEventBody(trusted.env, trusted.scope, String(row.event_id))).manifest);
  const plan = currentPlan(trusted, await readConfirmedPlan(trusted, String(row.plan_revision_id)));
  if (manifest.sourceDigest !== trusted.sourceDigest || manifest.requirementsDigest !== trusted.requirementsDigest || !Array.isArray(manifest.entries)) fail("output_delivery_needs_recheck", 409);
  const pinned = manifest.entries as DeliveryEntry[], eligible = await currentDeliveryEntries(trusted, plan, { targetIds: new Set(pinned.map((entry) => entry.targetId)) });
  if (pinned.some((entry) => !eligible.some((candidate) => canonicalOutputJson(candidate) === canonicalOutputJson(entry)))) fail("output_delivery_acceptance_changed", 409);
  const savedScope = manifest.scope as OutputDeliveryScopeInput | undefined;
  if (savedScope) {
    const currentScope = outputDeliveryScopeForPlan(plan.plan, { status: savedScope.status, inventoryComplete: savedScope.inventoryComplete, includedTargetIds: pinned.map((entry) => entry.targetId), reasonCodes: savedScope.reasonCodes });
    if (canonicalOutputJson(currentScope) !== canonicalOutputJson(savedScope)) fail("output_delivery_scope_changed", 409);
  }
  const history = { scopeHistoryComplete: manifest.scopeHistoryComplete === true, scopeAmendments: Array.isArray(manifest.scopeAmendments) ? manifest.scopeAmendments as OutputDeliveryScopeAmendmentInput[] : [] };
  for (const amendment of history.scopeAmendments) assertOutputHistoryReason(record(amendment).reason);
  if (manifest.scopeHistoryComplete !== undefined && canonicalOutputJson(history) !== canonicalOutputJson(await readOutputScopeHistory(trusted, plan))) fail("output_delivery_history_changed", 409);
  const archiveInput: OutputDeliveryManifestInput = { schemaVersion: 1, deliveryId: manifestId, planId: plan.id, planRevision: plan.revisionId, createdAt: String(manifest.createdAt), targets: pinned.map((entry) => ({ targetId: entry.targetId, fileId: entry.assetId, acceptanceId: entry.acceptanceId })), ...(savedScope ? { scope: savedScope } : {}), ...history };
  const model = requireCompleteOutputReadModel(await readOutputModel(trusted));
  const fileIds = new Set(pinned.map((entry) => entry.assetId));
  const files = model.assets.filter((asset) => fileIds.has(asset.id)).map((asset) => ({ id: asset.id, byteLength: asset.byteLength, kind: asset.mediaKind }));
  if (files.length !== fileIds.size) fail("output_delivery_file_inventory_changed", 409);
  const currentParts = planOutputDeliveryParts(files, archiveInput);
  const parts = Array.isArray(manifest.parts) ? manifest.parts as OutputDeliveryPart[] : currentParts;
  if (canonicalOutputJson(parts) !== canonicalOutputJson(currentParts)) fail("output_delivery_package_changed", 409);
  const requestedPart = new URL(trusted.request.url).searchParams.get("part") ?? "1";
  if (!/^[1-9]\d*$/u.test(requestedPart)) fail("invalid_output_delivery_part", 400);
  const part = parts.find((candidate) => candidate.index === Number(requestedPart));
  if (!part) fail("output_delivery_part_not_found", 404);
  if (part.fileIds.length > MAX_OUTPUT_DELIVERY_PART_READS) fail("output_delivery_package_needs_repreparation", 409);
  const assets = new Map<string, Awaited<ReturnType<typeof loadExactAsset>>>();
  for (const fileId of part.fileIds) {
    const evidence = model.assetEvidence.get(fileId);
    if (!evidence) fail("output_asset_unavailable", 404);
    assets.set(fileId, await loadExactAsset(trusted, fileId, evidence));
  }
  const archiveFiles = [...assets.entries()].map(([id, asset]) => ({ id, name: asset.name, bytes: asset.bytes, expectedSha256: asset.inspection.sha256! }));
  const archiveManifest = { ...archiveInput, packagePart: { index: part.index, parts } };
  if (archiveFiles.some(file => file.bytes.byteLength > MAX_OUTPUT_ASSET_BYTES)) {
    // Large meshes remain singleton parts. Their hashes are rechecked before
    // the same final authority proof discloses a bounded streaming ZIP.
    const archive = await createOutputDeliveryArchiveStream(archiveFiles, archiveManifest, { snapshot: false });
    const completion = archive.manifest.deliveryStatus, packageCount = archive.manifest.packagePart.count;
    return discloseOutputResponse(trusted, () => ({ body: archive.stream, init: { headers: { "content-type": archive.mimeType, "content-length": String(archive.byteLength), "content-disposition": `attachment; filename="forma-outputs-${completion}${packageCount > 1 ? `-part-${part.index}-of-${packageCount}` : ""}.zip"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-output-delivery-completion": completion, "x-output-delivery-scope": "entire-delivery-package", "x-output-package-part": String(part.index), "x-output-package-parts": String(packageCount), "x-output-contains-complete-package": packageCount === 1 ? "true" : "false" } } }), deliveryAssertions(trusted, plan, pinned));
  }
  const archive = await createOutputDeliveryArchive(archiveFiles, archiveManifest);
  const completion = archive.manifest.deliveryStatus, packageCount = archive.manifest.packagePart.count;
  // The shared final proof owns synchronous construction of this exact archive response.
  return discloseOutputResponse(trusted, () => ({ body: ownedBuffer(archive.bytes), init: { headers: { "content-type": archive.mimeType, "content-disposition": `attachment; filename="forma-outputs-${completion}${packageCount > 1 ? `-part-${part.index}-of-${packageCount}` : ""}.zip"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-output-delivery-completion": completion, "x-output-delivery-scope": "entire-delivery-package", "x-output-package-part": String(part.index), "x-output-package-parts": String(packageCount), "x-output-contains-complete-package": packageCount === 1 ? "true" : "false", "x-output-sha256": archive.sha256 } } }),
    deliveryAssertions(trusted, plan, pinned));
}

async function downloadAsset(trusted: OutputTrustedContext, assetId: string, sponsored?: SponsorOutputAssetRead) {
  const asset = await loadExactAsset(trusted, assetId);
  return discloseOutputResponse(trusted, () => ({ body: sponsored ? sponsorImageResponseBody(asset.bytes, sponsored.budget) : assetBuffer(asset.bytes), init: { headers: { "content-type": asset.inspection.mimeType!, "content-disposition": `attachment; filename="output.${asset.inspection.extension}"; filename*=UTF-8''${encodeURIComponent(asset.name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-output-sha256": asset.inspection.sha256!, "x-output-review": "File inspection download does not establish assignment acceptance or complete delivery." } } }), [
    { sql: "EXISTS(SELECT 1 FROM output_assets asset JOIN event_private_payloads body ON body.private_event_id=asset.created_event_id AND body.redacted_at IS NULL WHERE asset.scope_key=? AND asset.asset_id=? AND asset.document_id=? AND asset.redacted_at IS NULL AND asset.content_sha256=?)", bindings: [trusted.scope.key, assetId, trusted.scope.documentId, asset.inspection.sha256!] }, ...(sponsored ? sponsored.assertions : [])], outputAssetReadAssertions(trusted.scope, [asset.row]));
}


type OutputCommittedDisclosure = { scope: OutputScope; receipt: OutputCommandReceipt; replayed: boolean };


/** A verified commit is never relabeled as a failed purchase merely because its view was withdrawn. */
async function withholdCommittedOutput(env: WorkerEnv, committed: OutputCommittedDisclosure, status: number) {
  const proof = outputCommandReceiptAssertion(committed.scope, committed.receipt);
  const [authority, checked] = await env.DB.batch<Record<string, unknown>>(outputProofReadStatements(env, [outputScopeAuthority(committed.scope, "read"), proof]));
  const authorityDenied = status === 401 || status === 403 || authority?.success === false || Number(authority?.results[0]?.current) !== 1;
  const responseStatus = authorityDenied ? status === 401 ? 401 : 403 : 410;
  const code = authorityDenied ? "output_execution_authority_revoked" : "output_private_evidence_unavailable";
  if (checked?.success === false || Number(checked?.results[0]?.current) !== 1) return json({ error: code }, responseStatus);
  const { receipt, replayed } = committed;
  return Response.json({ ok: true, replayed, command: { action: receipt.action, eventId: receipt.eventId }, appended: [], snapshot: null,
    privateUnavailable: true, receipt: { committed: true, clientMutationId: receipt.key, action: receipt.action, eventId: receipt.eventId },
    error: code, errorCode: code }, { status: responseStatus, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

function responseCommand(receipt: { action: string; eventId: string; payload: Record<string, unknown> }, documentId: string): OutputCommandResponse["command"] {
  const payload = receipt.payload;
  const savedParts = record(payload.manifest).parts;
  const partCount = Array.isArray(savedParts) && savedParts.length ? savedParts.length : 1;
  const downloadUrl = typeof payload.manifest_id === "string" ? `${BASE}/deliveries/${encodeURIComponent(payload.manifest_id)}?documentId=${encodeURIComponent(documentId)}` : null;
  return { action: receipt.action, eventId: receipt.eventId,
    ...(typeof payload.plan_revision_id === "string" ? { planRevisionId: payload.plan_revision_id } : {}),
    ...(payload.preflight ? { preflight: payload.preflight as OutputPreflight } : {}),
    ...(typeof payload.grant_id === "string" ? { grantId: payload.grant_id } : {}),
    ...(typeof payload.asset_id === "string" ? { assetId: payload.asset_id } : {}),
    ...(typeof payload.result_id === "string" ? { resultId: payload.result_id } : {}),
    ...(typeof payload.acceptance_id === "string" ? { acceptanceId: payload.acceptance_id } : {}),
    ...(downloadUrl ? { manifestId: String(payload.manifest_id), downloadUrl, downloadUrls: Array.from({ length: partCount }, (_, index) => `${downloadUrl}${partCount > 1 ? `&part=${index + 1}` : ""}`), partCount } : {}) };
}

async function executeExperienceCommand(trusted: OutputTrustedContext, body: Record<string, unknown>, bridge: OutputExecutionBridge, executionContext: WorkerExecutionContext, sponsorAdmission?: SponsorAdmissionAuthority, executionAuthority?: SponsorExecutionAuthority) {
    const action = String(body.action);
    if (!["save", "confirm", "preflight", "authorize", "run"].includes(action)) fail("experience_output_action_unsupported", 400);
    const envelope = structuredClone(body), digest = await outputDigest(envelope);
    const key = identifier(envelope.clientMutationId, "client_mutation_id_required");
    const replay = await readOutputCommand(trusted.env, trusted.scope, key, digest, { allowUnavailableReceipt: true });
    if (replay) {
      if (replay.privateUnavailable) fail("original_command_content_unavailable", 410);
      // This branch is invoked only by an explicit POST run, never passive re-entry.
      if (action === "run") await resumeRecordedOutputRun(trusted, identifier(replay.payload.grant_id, "grant_id_required"), bridge, executionContext, executionAuthority);
      return { replayed: true, receipt: replay, events: [] as EventRow[] };
    }
    const bound = { ...trusted, retainedCommandEnvelope: envelope };
    return action === "save" ? saveRequirement(bound, envelope, digest)
      : action === "confirm" ? confirmPlan(bound, envelope, digest)
      : action === "preflight" ? preflightPlan(bound, envelope, digest, bridge)
      : action === "authorize" ? authorizePlan(bound, envelope, digest, bridge, sponsorAdmission)
      : runGrant(bound, envelope, digest, bridge, executionContext, executionAuthority);
}

/** Internal, server-bound mini-app adapter. No HTTP caller chooses these capabilities. */
export const outputExperienceCommands = {
  readConfirmedPlan,
  readGrantEvidence: readOutputGrantEvidence,
  snapshot: buildSnapshot,
  disclose: discloseOutputJson,
  /** Dormant native preparation only; no registered route creates a sponsor seal. */
  async prepareSponsoredSceneAdmission(trusted: OutputTrustedContext, body: Record<string, unknown>) {
    if (jsonIssues(body).length || body.action !== "authorize" || Object.hasOwn(body, "sponsor_entitlement")) fail("sponsor_command_invalid", 403);
    requireCurrentSource(trusted);
    const current = sceneSponsorPreparationCurrent(trusted, body);
    const row = await trusted.env.DB.prepare("SELECT event_id,expires_at,terms_digest FROM output_preflights WHERE scope_key=? AND preflight_id=? AND actor_user_id=?")
      .bind(trusted.scope.key, identifier(body.preflightId, "preflight_id_required"), trusted.scope.actorUserId).first<{ event_id: string; expires_at: string; terms_digest: string }>();
    current();
    if (!row || row.expires_at <= nowIso() || row.terms_digest !== body.termsDigest) fail("output_preflight_expired", 409);
    const quote = record((await privateEventBody(trusted.env, trusted.scope, row.event_id)).preflight) as OutputPreflight;
    current();
    const plan = currentPlan(trusted, await readConfirmedPlan(trusted, quote.planRevisionId));
    current();
    if (plan.plan.targets.length !== 1 || quote.targets.length !== 1 || !Object.hasOwn(plan.plan.targets[0]!, "scene_contract")) fail("sponsor_scene_handoff_changed", 403);
    const source = bridgeTarget(trusted, plan, plan.plan.targets[0]!);
    delete source.sceneUseVersionedHistory;
    const prepared = await prepareSceneSponsorAdmission({ source, command: body, quote });
    current(); return prepared;
  },
  /** Uses only the exact retained original-job successor, never a fresh baseline. */
  async prepareSponsoredSceneRun(trusted: OutputTrustedContext, body: Record<string, unknown>) {
    if (jsonIssues(body).length || body.action !== "run" || Object.hasOwn(body, "sponsor_entitlement")) fail("sponsor_command_invalid", 403);
    requireCurrentSource(trusted);
    const current = sceneSponsorPreparationCurrent(trusted, body);
    const evidence = await readOutputGrantEvidence(trusted.env, trusted.scope, identifier(body.grantId, "grant_id_required"), true);
    current();
    if (evidence.slots.length !== 1 || !["authorized", "active"].includes(String(evidence.row.status)) || !Number(evidence.row.deadline_current)) fail("sponsor_scene_handoff_changed", 403);
    const slot = evidence.slots[0]!, { target } = await validateOutputExecutionTarget(trusted, evidence, slot);
    current();
    if (!Object.hasOwn(target, "scene_contract")) fail("sponsor_scene_handoff_changed", 403);
    const job = await trusted.env.DB.prepare("SELECT correlation_id,scene_source_protocol FROM document_jobs WHERE job_id=? AND owner_id=?")
      .bind(slot.jobId, trusted.scope.ownerUserId).first<{ correlation_id: string; scene_source_protocol: number }>();
    current();
    if (!job || job.scene_source_protocol !== 1) fail("sponsor_scene_handoff_changed", 403);
    const source = bridgeTarget(trusted, evidence.confirmedPlan, target);
    delete source.sceneUseVersionedHistory;
    const prepared = await prepareSceneSponsorRun({ source, command: body, quote: evidence.preflight, slot, correlationId: job.correlation_id });
    current(); return prepared;
  },
  /** Classify an exact retained authorize before attempting fresh actor collection.
   * It returns inert original receipt data only. No renewed consent, issuance,
   * grant, source witness, hold or provider dispatch is constructed on replay. */
  async readSponsoredAudioAdmissionReplay(trusted: OutputTrustedContext, body: Record<string, unknown>) {
    if (jsonIssues(body).length || !exactKeys(body, ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "audioCostConsent"])
      || body.action !== "authorize" || body.documentId !== trusted.scope.documentId || Object.hasOwn(body, "sponsor_entitlement")
      || trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.contextId
      || trusted.principal.userId !== trusted.scope.actorUserId || trusted.principal.fictional || trusted.principal.projectExecution) fail("sponsor_command_invalid", 403);
    const current = audioSponsorPreparationCurrent(trusted, body);
    const auth = await readExistingPrincipalRequest(trusted.request, trusted.env, "creator", { account: "principal" });
    current();
    if ("kind" in auth || auth.response || !auth.user || canonicalOutputJson(auth.user) !== canonicalOutputJson(trusted.principal)) fail("sponsor_audio_handoff_changed", 403);
    const key = identifier(body.clientMutationId, "client_mutation_id_required");
    const row = await trusted.env.DB.prepare(`SELECT command.request_digest,command.event_id,private.private_json FROM output_commands command
      LEFT JOIN event_private_payloads private ON private.private_event_id=command.event_id AND private.owner_id=? AND private.project_id=? AND private.document_id=? AND private.redacted_at IS NULL
      WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`)
      .bind(trusted.scope.ownerUserId, trusted.scope.projectId, trusted.scope.documentId, trusted.scope.key, trusted.scope.actorUserId, key)
      .first<{ request_digest: string; event_id: string; private_json: string | null }>();
    current(); if (!row) return null;
    if (typeof row.private_json !== "string" || new TextEncoder().encode(row.private_json).byteLength > 524288) fail("original_command_content_unavailable", 410);
    const retained = record(JSON.parse(row.private_json)), envelope = record(retained.output_command_envelope), marker = record(envelope.sponsor_entitlement), intent = record(marker.audio_actor_intent);
    if (!exactKeys(marker, ["payer_user_id", "campaign_id", "policy_digest", "envelope_digest", "consumption_id", "audio_actor_intent"])
      || !exactKeys(intent, ["request", "review", "requestDigest", "reviewDigest", "commandDigest"])) fail("sponsor_audio_handoff_changed", 403);
    const originalCommand = { ...envelope }; delete originalCommand.sponsor_entitlement;
    if (canonicalOutputJson(originalCommand) !== canonicalOutputJson(body) || marker.payer_user_id === trusted.scope.actorUserId) fail("mutation_key_reused_with_different_content", 409);
    const digest = await outputDigest(envelope); current();
    if (digest !== row.request_digest || intent.commandDigest !== `sha256:${await outputDigest(body)}`) fail("mutation_key_reused_with_different_content", 409);
    current();
    const storedRequest = readSponsoredAudioActorRequest(intent.request), review = record(intent.review), preview = record(review.preview);
    const url = new URL(trusted.request.url);
    if (trusted.request.method !== "POST" || trusted.request.bodyUsed || url.search || url.hash
      || url.pathname !== `/api/experiences/drafts/${String(preview.draftId)}/output/authorize`
      || storedRequest.sponsorReview.campaignId !== marker.campaign_id || storedRequest.sponsorReview.reviewDigest !== intent.reviewDigest
      || review.payerUserId !== marker.payer_user_id || review.policyDigest !== marker.policy_digest) fail("sponsor_audio_handoff_changed", 403);
    const supplied = readSponsoredAudioActorRequest(await readSponsorInternalCommand(trusted.request, 4096)); current();
    if (canonicalOutputJson(supplied) !== canonicalOutputJson(storedRequest)) fail("mutation_key_reused_with_different_content", 409);
    const requestDigest = await outputDigest(supplied); current();
    const reviewDigest = await outputDigest(review); current();
    if (`sha256:${requestDigest}` !== intent.requestDigest || `sha256:${reviewDigest}` !== intent.reviewDigest) fail("sponsor_audio_handoff_changed", 403);
    const receipt = await readOutputCommand(trusted.env, trusted.scope, key, digest); current();
    if (!receipt || receipt.action !== "authorize" || receipt.eventId !== row.event_id) fail("sponsor_audio_handoff_changed", 403);
    const assertions = [outputScopeAuthority(trusted.scope, "request"), outputCommandReceiptAssertion(trusted.scope, receipt), {
      sql: "EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=? AND private_json=? AND redacted_at IS NULL)",
      bindings: [row.event_id, trusted.scope.ownerUserId, trusted.scope.projectId, trusted.scope.documentId, row.private_json],
    }];
    const checked = await trusted.env.DB.batch<Record<string, unknown>>(outputProofReadStatements(trusted.env, assertions)); current();
    const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
    if (!Array.isArray(checked) || own(checked, "length") !== assertions.length || Array.from({ length: assertions.length }, (_, index) => {
      const result = own(checked, index), rows = own(result, "results");
      return own(result, "success") !== true || !audioAcknowledgementErrorClear(result) || !Array.isArray(rows) || own(rows, "length") !== 1 || own(own(rows, 0), "current") !== 1;
    }).some(Boolean)) fail("sponsor_audio_handoff_changed", 403);
    current(); return { kind: "retained" as const, receipt, marker: structuredClone(marker), envelope: structuredClone(envelope) };
  },
  /** Dormant Audio preparation. The exact original POST is consumed inside its opaque owner. */
  async prepareSponsoredAudioAdmission(trusted: OutputTrustedContext, body: Record<string, unknown>, review: unknown) {
    if (jsonIssues(body).length || body.action !== "authorize" || Object.hasOwn(body, "sponsor_entitlement")) fail("sponsor_command_invalid", 403);
    requireCurrentSource(trusted);
    const capturedReview = readSponsoredAudioReview(review), baseCurrent = audioSponsorPreparationCurrent(trusted, body);
    const current = () => { baseCurrent(); if (canonicalOutputJson(readSponsoredAudioReview(review)) !== canonicalOutputJson(capturedReview)) fail("sponsor_audio_handoff_changed",403); };
    const retained = await trusted.env.DB.prepare("SELECT 1 AS present FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?")
      .bind(trusted.scope.key,trusted.scope.actorUserId,identifier(body.clientMutationId,"client_mutation_id_required")).first<{present:number}>();
    current(); if(retained)fail("sponsor_audio_original_admission_replay_required",409);
    const row = await trusted.env.DB.prepare("SELECT event_id,expires_at,terms_digest FROM output_preflights WHERE scope_key=? AND preflight_id=? AND actor_user_id=?")
      .bind(trusted.scope.key, identifier(body.preflightId, "preflight_id_required"), trusted.scope.actorUserId).first<{ event_id: string; expires_at: string; terms_digest: string }>();
    current();
    if (!row || row.expires_at <= nowIso() || row.terms_digest !== body.termsDigest) fail("output_preflight_expired", 409);
    const quote = record((await privateEventBody(trusted.env, trusted.scope, row.event_id)).preflight) as OutputPreflight;
    current();
    const plan = currentPlan(trusted, await readConfirmedPlan(trusted, quote.planRevisionId));
    current();
    if (plan.plan.targets.length !== 1 || quote.targets.length !== 1 || !Object.hasOwn(plan.plan.targets[0]!, "audio_contract")) fail("sponsor_audio_handoff_changed", 403);
    const prepared = await prepareAudioSponsorAdmission({ source: bridgeTarget(trusted, plan, plan.plan.targets[0]!), trusted, command: body, quote, review: capturedReview });
    current(); return prepared;
  },
  /** Independently supplied Run intent and retained original native job; never fresh authorize consent. */
  async prepareSponsoredAudioRun(trusted: OutputTrustedContext, body: Record<string, unknown>) {
    if (jsonIssues(body).length || body.action !== "run" || Object.hasOwn(body, "sponsor_entitlement")) fail("sponsor_command_invalid", 403);
    requireCurrentSource(trusted);
    const current = audioSponsorPreparationCurrent(trusted, body);
    if (trusted.request.method !== "POST" || trusted.request.bodyUsed) fail("sponsor_audio_handoff_changed", 403);
    const evidence = await readOutputGrantEvidence(trusted.env, trusted.scope, identifier(body.grantId, "grant_id_required"), true);
    current();
    if (evidence.slots.length !== 1 || !["authorized", "active"].includes(String(evidence.row.status)) || !Number(evidence.row.deadline_current)) fail("sponsor_audio_handoff_changed", 403);
    const slot = evidence.slots[0]!, { target } = await validateOutputExecutionTarget(trusted, evidence, slot);
    current();
    if (!Object.hasOwn(target, "audio_contract")) fail("sponsor_audio_handoff_changed", 403);
    const job = await trusted.env.DB.prepare("SELECT correlation_id FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=?")
      .bind(slot.jobId, trusted.scope.ownerUserId, `creative:${trusted.scope.actorUserId}`, trusted.scope.documentId).first<{ correlation_id: string }>();
    current(); if (!job) fail("sponsor_audio_handoff_changed", 403);
    const prepared = await prepareAudioSponsorRun({ source: bridgeTarget(trusted, evidence.confirmedPlan, target), command: body, quote: evidence.preflight, slot, correlationId: job.correlation_id });
    current(); return prepared;
  },
  async execute(trusted: OutputTrustedContext, body: Record<string, unknown>, bridge: OutputExecutionBridge, executionContext: WorkerExecutionContext) {
    if (Object.hasOwn(body, "sponsor_entitlement")) fail("sponsor_authority_unavailable", 403);
    return executeExperienceCommand(trusted, body, bridge, executionContext);
  },
  /** Dormant internal entry only. No registered HTTP route can issue or pass a seal. */
  async executeSponsored(trusted: OutputTrustedContext, body: Record<string, unknown>, authority: SponsorAdmissionAuthority, bridge: OutputExecutionBridge, executionContext: WorkerExecutionContext) {
    if (jsonIssues(body).length) fail("sponsor_command_invalid", 403);
    const command = structuredClone(body);
    const { request, env, governanceWitness, ...data } = trusted;
    const captured = { ...structuredClone(data), request, env, governanceWitness };
    inheritRetainedOutputPrivateBodies(trusted.scope, captured.scope);
    if (command.action !== "authorize" || Object.hasOwn(command, "sponsor_entitlement")) fail("sponsor_command_invalid", 403);
    const sponsorship = await requireSponsorAdmission(authority, captured, command);
    const envelope = { ...command, sponsor_entitlement: sponsorship.marker };
    return executeExperienceCommand(captured, envelope, bridge, executionContext, authority);

  },
  /** Dormant internal Run only. Registered routes cannot construct this seal. */
  async executeSponsoredRun(trusted: OutputTrustedContext, body: Record<string, unknown>, authority: SponsorExecutionAuthority, bridge: OutputExecutionBridge, executionContext: WorkerExecutionContext) {
    if (jsonIssues(body).length) fail("sponsor_command_invalid", 403);
    const command = structuredClone(body);
    const { request, env, governanceWitness, ...data } = trusted;
    const captured = { ...structuredClone(data), request, env, governanceWitness };
    inheritRetainedOutputPrivateBodies(trusted.scope, captured.scope);
    if (command.action !== "run" || Object.hasOwn(command, "sponsor_entitlement")) fail("sponsor_command_invalid", 403);
    const sponsor = await requireSponsorExecution(authority, env, captured.scope.actorUserId, {
      request, command, grantId: identifier(command.grantId, "grant_id_required"), scopeKey: captured.scope.key,
    });
    return executeExperienceCommand(captured, { ...command, sponsor_entitlement: sponsor.marker }, bridge, executionContext, undefined, authority);
  },
};

export async function handleOutputRequirements(request: Request, env: WorkerEnv, path: string, executionContext: WorkerExecutionContext, bridge?: OutputExecutionBridge): Promise<Response> {
  if (path !== BASE && !path.startsWith(`${BASE}/`)) return json({ error: "not_found" }, 404);
  let committed: OutputCommittedDisclosure | null = null;
  try {
    const url = new URL(request.url), isUpload = path === `${BASE}/assets` && request.method === "POST";
    let body: Record<string, unknown> = {};
    if (request.method === "POST" && !isUpload) {
      const raw = new TextDecoder().decode(await readBoundedRequest(request, MAX_COMMAND_BYTES));
      try { body = record(JSON.parse(raw)); } catch { return json({ error: "invalid_json" }, 400); }
    }
    const documentId = identifier(body.documentId ?? url.searchParams.get("documentId"), "document_id_required");
    const action = isUpload ? "adopt" : String(body.action ?? "");
    const permission: OutputCommandPermission = ["save", "remove", "bind", "adopt", "confirm"].includes(action) ? "author" : ["preflight", "authorize", "run"].includes(action) ? "request" : action === "review" ? "review" : "read";
    // Classify before native history/private-source loading. An explicit asset
    // may spend one original Image attempt; a snapshot/package may not inherit it.
    let ordinaryReadAssertion: OutputSqlAssertion | undefined;
    if (request.method === "GET" && !hasProjectContextCookie(request)) {
      const auth = await readExistingPrincipalRequest(request, env, "viewer", { account: "principal" }).catch(async error => {
        // Preserve the existing ordinary cold-install/onboarding path only when
        // no retained sponsor configuration makes that classification uncertain.
        if (!/no such table:/u.test(String(error))) throw error;
        const retained = await env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE lower(name) GLOB 'experience_sponsor_*' OR lower(tbl_name) GLOB 'experience_sponsor_*' LIMIT 1").first();
        if (retained) return { response: json({ error: "sponsor_output_read_configuration" }, 403), user: null };
        return null;
      });
      if (auth && "response" in auth && auth.response) return auth.response;
      const actor = auth === null ? null : "kind" in auth ? { userId: auth.identity.userId, streamId: `creative:${auth.identity.userId}` } : auth.user;
      if (actor) {
        const match = /^\/api\/output-requirements\/assets\/([^/]+)$/u.exec(path);
        const assetId = match ? identifier(decodeURIComponent(match[1])) : undefined;
        const context = await beginSponsorOutputAssetRead(request, env, actor, documentId, assetId);
        if (context?.kind === "ordinary") ordinaryReadAssertion = context.assertion;
        if (context?.kind === "sponsored" && auth) {
          if ("kind" in auth) return json({ error: "sponsor_principal_changed" }, 403);
          const selected = requireSponsorOutputAssetRead(context, request, env, actor);
          const bounded = sponsorOutputAssetReadEnvironment(env, selected.budget, selected);
          const trusted = await continueOutputTrustedContext(request, bounded, documentId, "read", auth);
          if (trusted instanceof Response) return trusted;
          return await downloadAsset(trusted, selected.assetId, context);
        }
      }
    }
    const trusted = await loadOutputTrustedContext(request, env, documentId, permission);
    if (trusted instanceof Response) return trusted;
    if (ordinaryReadAssertion) trusted.sourceAssertions.push(ordinaryReadAssertion);
    await ensureOutputRequirementsSchema(env);
    if (request.method === "GET") {
      if (path === BASE) return await discloseOutputJson(trusted, await buildSnapshot(trusted, bridge));
      const asset = /^\/api\/output-requirements\/assets\/([^/]+)$/u.exec(path), delivery = /^\/api\/output-requirements\/deliveries\/([^/]+)$/u.exec(path);
      if (asset) return await downloadAsset(trusted, identifier(decodeURIComponent(asset[1])));
      if (delivery) return await downloadDelivery(trusted, identifier(decodeURIComponent(delivery[1])));
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!isUpload && path !== BASE) return json({ error: "not_found" }, 404);
    if (!isUpload && !["save", "remove", "confirm", "preflight", "authorize", "run", "bind", "review", "export"].includes(action)) return json({ error: "unknown_output_action" }, 400);
    if (!isUpload && Object.hasOwn(body, "sponsor_entitlement")) fail("sponsor_authority_unavailable", 403);
    const digest = isUpload ? "" : await outputDigest(body);
    if (!isUpload) {
      parseOutputRevision(body.expectedRevision);
      const replay = await readOutputCommand(env, trusted.scope, identifier(body.clientMutationId, "client_mutation_id_required"), digest, { allowUnavailableReceipt: true });
      if (replay) {
        committed = { scope: trusted.scope, receipt: replay, replayed: true };
        if (replay.privateUnavailable) return await withholdCommittedOutput(env, committed, 410);
        if (replay.action === "run") await resumeRecordedOutputRun(trusted, identifier(replay.payload.grant_id, "grant_id_required"), bridge, executionContext);
        const current = replay.action === "run" ? await loadOutputTrustedContext(request, env, documentId, "read") : trusted;
        if (current instanceof Response) return await withholdCommittedOutput(env, committed, current.status);
        inheritRetainedOutputPrivateBodies(trusted.scope, current.scope);
        const snapshot = await buildSnapshot(current, bridge);
        return await discloseOutputJson(current, { ok: true, replayed: true, command: responseCommand(replay, documentId), appended: [], snapshot } satisfies OutputCommandResponse,
          200, [outputCommandReceiptAssertion(committed.scope, replay)]);
      }
      commandWrite(trusted, body, digest, permission);
    }
    const saved = isUpload ? await storeUpload(trusted, request)
      : action === "save" ? await saveRequirement(trusted, body, digest)
      : action === "remove" ? await removeRequirement(trusted, body, digest)
      : action === "confirm" ? await confirmPlan(trusted, body, digest)
      : action === "preflight" ? await preflightPlan(trusted, body, digest, bridge)
      : action === "authorize" ? await authorizePlan(trusted, body, digest, bridge)
      : action === "run" ? await runGrant(trusted, body, digest, bridge, executionContext)
      : action === "bind" ? await bindResult(trusted, body, digest, bridge)
      : action === "review" ? await reviewResult(trusted, body, digest)
      : await prepareDelivery(trusted, body, digest, bridge);
    if (saved instanceof Response) {
      const bytes = saved.body === null ? null : await saved.arrayBuffer();
      return await discloseOutputResponse(trusted, () => ({ body: bytes, init: { status: saved.status, statusText: saved.statusText, headers: saved.headers } }));
    }
    committed = { scope: trusted.scope, receipt: saved.receipt, replayed: saved.replayed };
    if (saved.receipt.privateUnavailable) return await withholdCommittedOutput(env, committed, 410);
    const latest = await loadOutputTrustedContext(request, env, documentId, "read");
    if (latest instanceof Response) return await withholdCommittedOutput(env, committed, latest.status);
    inheritRetainedOutputPrivateBodies(trusted.scope, latest.scope);
    const snapshot = await buildSnapshot(latest, bridge);
    return await discloseOutputJson(latest, { ok: true, replayed: saved.replayed, command: responseCommand(saved.receipt, documentId), appended: saved.events, snapshot } satisfies OutputCommandResponse,
      200, [outputCommandReceiptAssertion(committed.scope, saved.receipt)]);
  } catch (error) {
    if (committed) {
      try { return await withholdCommittedOutput(env, committed, error instanceof OutputConflictError ? error.status : 410); }
      catch { return json({ error: "output_private_evidence_unavailable" }, 410); }
    }
    const sponsoredFailure = sponsorJobReadFailure(error); if (sponsoredFailure) return sponsoredFailure;
    if (/no such table: experience_sponsor_(?:read_policies|read_attempts)/u.test(String(error))) return json({ error: "sponsor_read_policy_unavailable" }, 403);
    if (error instanceof OutputConflictError) return json({ error: error.code }, error.status);
    if (error instanceof ContextIntegrityError) return json({ error: error.code }, 409);
    if (String(error).includes("CHECK constraint failed")) return json({ error: "output_revision_or_authority_changed" }, 409);
    // Never expose private source, filenames, provider prompts or internal SQL through errors.
    return json({ error: "output_requirements_failed", message: "This Output operation could not be completed. Saved requirements and historical work remain available." }, 500);
  }
}
