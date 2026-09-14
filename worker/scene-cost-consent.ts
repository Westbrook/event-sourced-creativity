import { documentRenderGuidance, documentRenderGuidanceProblem } from "../src/model/document-render-guidance.ts";
import { buildManagedProductionPlan, type ManagedProductionPlan } from "../src/model/managed-production.ts";
import { documentRenderTokenReservation } from "../src/model/generation-budget.ts";
import { foldEvents } from "../src/model/events.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { standingConstraints } from "../src/model/taste.ts";
import { createSceneConfiguration, isSceneMedium } from "../src/model/scene-configuration.ts";
import { isSceneCostPreview, isSceneSafeUnusedProof, sceneCostApprovalMatches, sceneCostLimits, sceneCostRequestHash, type SceneCostPreview, type SceneCostRequest, type SceneSafeUnusedProof } from "../src/model/scene-cost-consent.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority.ts";
import { consentHash, executionAdmissionGuard, executionContentCustodyGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { governedPackageSourceRightsValidity, sourceRightsDispatchGuard } from "./context-package-rights.ts";
import { hasCapability, type BudgetReservationGuard, type PilotUser, type ProjectExecutionScope } from "./pilot-policy.ts";
import { readProjectSourceEvents, resolveOwnerExecutionScope } from "./project-access.ts";
import { ProductionWorkflowContextError, resolveProductionWorkflowContext } from "./production-workflow.ts";
import { readWorkspaceEvents, streamHead, type EventReadProof, type WorkerEnv } from "./runtime.ts";
import { OutputConflictError, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import { assertSceneHistoryRead, readSceneHistoryProof } from "./scene-history-proof-read.ts";
import { SceneHistoryProofError } from "./scene-history-proof.ts";


/** Private canonical audit witness, emitted only by the executor after a known local stop. */
export type ScenePolicyStopWitness = {
  version:"scene-policy-stop-v1";code:"scene_paid_authority_changed";stage:"before-pending"|"after-pending";
  job_id:string;document_id:string;project_id:string;actor_user_id:string;attempt_correlation_id:string;
  provider:"openai";model:string;client_request_id:string;artifact_id:string;
  binding_hash:string;source_hash:string;request_hash:string;period:string;
  reservation_id:string;cost_reservation_id:string;reserved_tokens:number;reserved_microusd:number;
  organization_id:string|null;project_access_id:string|null;pilot_cohort_id:string|null;stopped_at:string;
  used_tokens:number;used_microusd:number;
};
export function scenePolicyStopIncomingField(value:Record<string,unknown>){
  return ["scene_policy_stop","scenePolicyStop","scenePolicyStopWitness","scenePolicyStopSummary","generationReceipt","generation_receipt","safeUnused"].find(key=>Object.hasOwn(value,key))??null;
}

export class SceneCostConsentError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.name = "SceneCostConsentError"; this.code = code; this.status = status; }
}
function fail(code = "scene_cost_changed", status = 409): never { throw new SceneCostConsentError(code, status); }
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function earliestSceneDeadline(values: Array<string | null | undefined>) {
  const dates=values.filter((value):value is string=>value!==undefined&&value!==null);
  if(!dates.length||dates.some(value=>!Number.isFinite(Date.parse(value))))fail("scene_cost_authority_changed",403);
  return dates.reduce((earliest,value)=>Date.parse(value)<Date.parse(earliest)?value:earliest);
}
const requestIdValid = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9:_-]{0,119}$/iu.test(value);

/** Balanced conjunctions keep the same proof under native D1 expression depth. */
function conjunction(guards: readonly BudgetReservationGuard[]): BudgetReservationGuard {
  if (!guards.length) return { sql: "1", bindings: [] };
  if (guards.length === 1) return guards[0]!;
  const middle = Math.ceil(guards.length / 2), left = conjunction(guards.slice(0, middle)), right = conjunction(guards.slice(middle));
  return { sql: "(" + left.sql + ") AND (" + right.sql + ")", bindings: [...left.bindings, ...right.bindings] };
}

/** Only canonical numeric/source identity is returned; raw evidence never leaves this request. */
export type PreparedSceneCost = {
  preview: SceneCostPreview;
  binding: ConsequentialBinding;
  /** Original bounded proofs; every write/dispatch must preserve the full array. */
  assertions: readonly OutputSqlAssertion[];
  production: ManagedProductionPlan | null;
  authoredSnapshot: Record<string, unknown>;
  effectiveSnapshot: Record<string, unknown>;
  scope: ProjectExecutionScope | undefined;
  validUntil: string;
};

/** Rebuild the same final written-source snapshot used by Scene execution, without source or index writes. */
export async function prepareSceneCostConsent(
  env: WorkerEnv,
  user: PilotUser,
  documentId: string,
  payload: Record<string, unknown>,
  contextSessionId: string | null,
  options: { synchronize?: boolean } = {},
): Promise<PreparedSceneCost> {
  if (!documentId || documentId.length > 160 || !requestIdValid(payload.sceneRequestId)) fail("scene_cost_request_required", 400);
  if (payload.artifactKind !== "scene" || payload.sceneMedium !== undefined && !isSceneMedium(payload.sceneMedium)
    || payload.productionMode !== undefined && payload.productionMode !== "manual" && payload.productionMode !== "managed") fail("scene_cost_request_invalid", 400);
  if (payload.itemCount !== undefined && (!Number.isSafeInteger(payload.itemCount) || Number(payload.itemCount) < 1)
    || payload.locale !== undefined && (typeof payload.locale !== "string" || !payload.locale || payload.locale.length > 40)) fail("scene_cost_request_invalid", 400);
  const guidanceProblem = documentRenderGuidanceProblem(payload);
  if (guidanceProblem) fail(guidanceProblem.error, 400);
  const guidance = documentRenderGuidance(payload);
  const initial = user.projectExecution
    ? await readProjectSourceEvents(env, user.projectExecution, { synchronize: options.synchronize === true })
    : await readWorkspaceEvents(env, user.streamId);
  const initialProjection = foldEvents(initial, Infinity, documentId, user.projectExecution?.projectId ?? "");
  const initialDocument = initialProjection.documents.find(document => document.id === documentId && !document.removed);
  if (!initialDocument) fail("document_not_found", 404);
  let scope = user.projectExecution;
  if (!scope) {
    const custody = await resolveOwnerExecutionScope(env, user, documentId, initialDocument.projectId, "read");
    if (custody.denied) fail("scene_cost_authority_changed", 403);
    scope = custody.scope;
  }
  if (scope && (scope.actorUserId !== user.userId || scope.projectId !== initialDocument.projectId || user.streamId !== "creative:" + scope.ownerUserId)) fail("scene_cost_authority_changed", 403);
  if (!(scope ? hasCapability(user, "project.read", scope) : user.access.capabilities.includes("project.read"))) fail("scene_cost_authority_changed", 403);
  if (contextSessionId !== null && (!scope || !requestIdValid(contextSessionId))) fail("scene_cost_authority_changed", 403);
  const sourceHead = await streamHead(env, user.streamId);
  const period = new Date().toISOString().slice(0, 7);
  const monthEnd = new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),1)).toISOString();
  const selected = contextSessionId ? await env.DB.prepare("SELECT expires_at FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND revoked_at IS NULL")
    .bind(contextSessionId,user.userId).first<{expires_at:string}>() : null;
  if(contextSessionId&&!selected)fail("scene_cost_authority_changed",403);
  const readValidUntil = earliestSceneDeadline([monthEnd, selected?.expires_at, ...user.access.grants.map(grant=>grant.expiresAt)]);
  const history = await readSceneHistoryProof(env, {
    streamId: user.streamId, expectedOwnerHead: sourceHead, deadlineMs: Date.parse(readValidUntil),
    ...(scope ? { project: { projectAccessId: scope.projectAccessId, organizationId: scope.organizationId,
      projectId: scope.projectId, ownerUserId: scope.ownerUserId } } : {}),
  });
  // Certify the ACTUAL hydrated rows in the same snapshot as the original raw
  // proof. A separate successful read cannot exclude transient edit/restore ABA.
  const sourceProof: EventReadProof = {
    statements: outputProofReadStatements(env, history.assertions),
    verify(results) {
      assertSceneHistoryRead(results, history.assertions.length);
      requireSceneCostDeadline({validUntil: readValidUntil});
    },
  };
  const events = scope
    ? await readProjectSourceEvents(env, scope, { synchronize: options.synchronize === true, sourceProof })
    : await readWorkspaceEvents(env, user.streamId, sourceProof);
  const projection = foldEvents(events, Infinity, documentId, initialDocument.projectId);
  const document = projection.documents.find(candidate => candidate.id === documentId && candidate.projectId === initialDocument.projectId && !candidate.removed);
  if (!document) fail("document_not_found", 404);
  const supplied = record(payload.snapshot);
  const trusted = authoritativeCreativeContext(events, {
    documentId, projectId: document.projectId,
    ...(typeof payload.canvasId === "string" ? { canvasId: payload.canvasId } : {}),
    ...(typeof payload.contextSetId === "string" ? { contextSetId: payload.contextSetId } : {}),
    ...(typeof payload.contextRootBlockId === "string" ? { contextRootBlockId: payload.contextRootBlockId } : {}),
    snapshot: supplied,
    ...(Array.isArray(payload.sourceBlockVersions) ? { sourceBlockVersions: payload.sourceBlockVersions as Array<Record<string, unknown>> } : {}),
  });
  let effectiveSnapshot: Record<string, unknown> = trusted.snapshot;
  let configuration = createSceneConfiguration(isSceneMedium(payload.sceneMedium) ? payload.sceneMedium : "visual");
  let sources: Awaited<ReturnType<typeof resolveProductionWorkflowContext>>["sources"] = [];
  let sourceGuard: BudgetReservationGuard = { sql: "1", bindings: [] };
  let sourceDeadline: string | null = null;
  if (payload.workflowId !== undefined || payload.workflowStageId !== undefined || payload.workflowSources !== undefined) {
    const resolved = await resolveProductionWorkflowContext({
      env, events, documentId, projectId: document.projectId, ownerId: scope?.ownerUserId ?? user.userId, scope,
      snapshot: trusted.snapshot, workflowId: payload.workflowId, workflowStageId: payload.workflowStageId,
      workflowSources: payload.workflowSources, requestedFormat: "scene",
    });
    effectiveSnapshot = resolved.snapshot;
    sources = resolved.sources;
    sourceGuard = resolved.dispatchGuard ?? sourceGuard;
    sourceDeadline = resolved.dispatchExpiresAt ?? null;
    configuration = resolved.sceneConfiguration ?? configuration;
  }
  const constraints = standingConstraints(events).map(item => ({
    preference_id: item.preferenceId, axis: item.axis, value: item.value, polarity: item.polarity,
    authority: "authored", source_event_refs: item.evidenceRefs, source_claim_ref: item.sourceClaimRef ?? null,
  }));
  effectiveSnapshot = { ...effectiveSnapshot, document: { id: document.id, title: document.title }, ...(constraints.length ? { standing_constraints: constraints } : {}) };
  const productionMode = payload.productionMode === "managed" ? "managed" : "manual";
  const production = productionMode === "managed"
    ? buildManagedProductionPlan("scene", effectiveSnapshot, { requestedItemCount: Number(payload.itemCount ?? 0), sceneMedium: configuration.medium })
    : null;
  const limits = sceneCostLimits(production, Number(payload.itemCount ?? 1));
  const request: SceneCostRequest = {
    documentId, requestId: payload.sceneRequestId, sceneMedium: configuration.medium, productionMode,
    ...(payload.itemCount === undefined ? {} : { itemCount: Number(payload.itemCount) }),
    audience: guidance.audience,
    tone: guidance.tone,
    locale: typeof payload.locale === "string" ? payload.locale.toLowerCase() : "en",
    ...(typeof payload.workflowId === "string" ? { workflowId: payload.workflowId } : {}),
    ...(typeof payload.workflowStageId === "string" ? { workflowStageId: payload.workflowStageId } : {}),
    workflowSources: sources,
    ...(typeof payload.canvasId === "string" ? { canvasId: payload.canvasId } : {}),
    ...(typeof payload.contextSetId === "string" ? { contextSetId: payload.contextSetId } : {}),
    ...(typeof payload.contextRootBlockId === "string" ? { contextRootBlockId: payload.contextRootBlockId } : {}),
  };
  const requestHash = await sceneCostRequestHash(request), sourceHash = await consentHash(effectiveSnapshot);
  const model = String(env.OPENAI_MODEL ?? "gpt-5.6-terra");
  const binding: ConsequentialBinding = {
    version: "scene-cost-v1", operation: "written-scene", intentHash: requestHash, actorUserId: user.userId,
    permissionEpoch: user.access.permissionEpoch, streamId: user.streamId, projectId: document.projectId, documentId,
    canvasId: request.canvasId ?? null, blockId: "", sourceHash, period, scope: scope ?? null, contextSessionId,
    pilotCohortId: null, steps: [], publicQuery: "", request: { request, configuration, sources, model, limits },
  };
  const bindingHash = await consentHash({ binding, authorization: user.authorizationSnapshot });
  const preview: SceneCostPreview = {
    version: "scene-cost-v1", requestId: request.requestId, actorUserId: user.userId, projectId: document.projectId, documentId,
    contextSessionId, permissionEpoch: user.access.permissionEpoch, period, requestHash, sourceHash, provider: "openai", model,
    sceneMedium: configuration.medium, productionMode, reusedSourceCount: sources.length, ...limits, bindingHash,
  };
  const rights = scope ? await governedPackageSourceRightsValidity(env, scope.organizationId, projection.blocks) : { current: true, validUntil: null };
  if (!rights.current) fail("context_source_rights_expired");
  const authoredRights=(Array.isArray(trusted.snapshot.facts)?trusted.snapshot.facts:[]).map(value=>record(value))
    .filter(fact=>fact.active!==false&&record(fact.properties).active!==false&&Number(record(fact.properties).weight??1)>0)
    .map(fact=>creativeContextRightsValidity(record(fact.properties)));
  if(authoredRights.some(rights=>rights.issue))fail("context_source_rights_expired");
  const validUntil=earliestSceneDeadline([monthEnd,sourceDeadline,rights.validUntil,selected?.expires_at,...authoredRights.map(rights=>rights.validUntil),...user.access.grants.map(grant=>grant.expiresAt)]);
  const assertions: readonly OutputSqlAssertion[] = Object.freeze([
    executionAdmissionGuard(user, binding, sourceHead),
    ...(selected?[{sql:"EXISTS(SELECT 1 FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND expires_at=? AND revoked_at IS NULL)",bindings:[contextSessionId!,user.userId,selected.expires_at]}]:[]),
    ...history.assertions,
    sourceGuard, sourceRightsDispatchGuard(rights),
    ...(rights.validUntil ? [{ sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [rights.validUntil] }] : []),
    ...(scope ? [{ sql: "EXISTS(SELECT 1 FROM project_resource_scopes WHERE (project_access_id,organization_id,project_id,owner_user_id,resource_kind,resource_id)=(?,?,?,?,'document',?))", bindings: [scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, documentId] }] : []),
    { sql: "? > strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [validUntil], deadlineMs: Date.parse(validUntil) },
  ].map(assertion => {
    const bindings = [...(assertion.bindings ?? [])]; Object.freeze(bindings);
    return Object.freeze({ ...assertion, bindings });
  }));
  const checked = await env.DB.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions));
  assertSceneHistoryRead(checked, assertions.length);
  requireSceneCostDeadline({validUntil});
  return { preview, binding, assertions, production, authoredSnapshot: trusted.snapshot, effectiveSnapshot, scope, validUntil };
}

/** Synchronous after awaited SQL: a still-valid row can expire while its response is in transit. */
export function requireSceneCostDeadline(prepared: Pick<PreparedSceneCost, "validUntil">) {
  if(!(Date.parse(prepared.validUntil)>Date.now()))fail("scene_cost_authority_changed",403);
}

export async function sceneCostAuthorityCurrent(env: WorkerEnv, guard: BudgetReservationGuard) {
  return Boolean(await env.DB.prepare("SELECT 1 AS current WHERE " + guard.sql).bind(...guard.bindings).first());
}

export function requireSceneCostApproval(value: unknown, prepared: PreparedSceneCost) {
  if (!value || typeof value !== "object" || (value as Record<string, unknown>).confirmed !== true) fail("scene_cost_confirmation_required", 428);
  if (!sceneCostApprovalMatches(value, prepared.preview)) fail();
}

export function sceneCostErrorResponse(error: unknown): Response {
  const code = error instanceof SceneCostConsentError || error instanceof ContextIntegrityError || error instanceof ProductionWorkflowContextError
    || error instanceof SceneHistoryProofError || error instanceof OutputConflictError
    ? error.code : error instanceof Error && (error.message === "project_source_index_stale" || error.message === "output_source_changed_during_read") ? error.message : "scene_cost_unavailable";
  const status = error instanceof SceneCostConsentError || error instanceof ProductionWorkflowContextError
    || error instanceof SceneHistoryProofError || error instanceof OutputConflictError ? error.status : 409;
  return Response.json({ error: code, attemptSubmission: "not-submitted" }, { status, headers: { "cache-control": "private, no-store" } });
}



type SceneUnusedPreparation = { proof: SceneSafeUnusedProof; guard: BudgetReservationGuard };

type ScenePolicySnapshot={rows:unknown[][];raw:string;guard:BudgetReservationGuard};
async function scenePolicySnapshot(env:WorkerEnv,sql:string,bindings:Array<string|number|null>):Promise<ScenePolicySnapshot|null>{
  const result=await env.DB.prepare("SELECT ("+sql+") AS evidence").bind(...bindings).first<{evidence:string}>();
  if(!result||typeof result.evidence!=="string")return null;
  try{
    const rows:unknown=JSON.parse(result.evidence);if(!Array.isArray(rows)||rows.some(row=>!Array.isArray(row)))return null;
    return{rows,raw:result.evidence,guard:{sql:"("+sql+")=?",bindings:[...bindings,result.evidence]}};
  }catch{return null;}
}
const policyWitnessKeys=[
  "version","code","stage","job_id","document_id","project_id","actor_user_id","attempt_correlation_id",
  "provider","model","client_request_id","artifact_id","binding_hash","source_hash","request_hash","period",
  "reservation_id","cost_reservation_id","reserved_tokens","reserved_microusd","organization_id","project_access_id",
  "pilot_cohort_id","stopped_at","used_tokens","used_microusd",
] as const;
const policyFailure=(value:Record<string,unknown>)=>value.code==="scene_paid_authority_changed"&&value.httpStatus===403
  &&value.category==="access"&&value.scope==="project"&&value.action==="check_project"&&value.retryable===false&&value.requestId===null;
export type ScenePolicyStopEvidence={unused:boolean;stoppedRequestId:string|null;guard:BudgetReservationGuard;hashInput:unknown};

/**
 * Current canonical origin + the complete attempt family + exact settled ledgers.
 * This is read-only and never interprets a provider rejection or a caller marker as a local stop.
 */
export async function readScenePolicyStopEvidence(
  env:WorkerEnv,user:PilotUser,row:Record<string,unknown>,checkpoint:Record<string,unknown>,
  scope:ProjectExecutionScope|undefined,
):Promise<ScenePolicyStopEvidence|null>{
  if(row.kind!=="render_document"||row.status!=="failed"||row.attempt_count!==1||row.lease_expires_at!==null
    ||row.owner_id!==user.userId||row.stream_id!==user.streamId||row.correlation_id!==String(row.job_id)+":attempt:1"
    ||!policyFailure(record(checkpoint.errorDetail))||checkpoint.providerSubmissionProtocol!==1
    ||!sceneObject(checkpoint.providerSubmissions)||Object.hasOwn(checkpoint,"providerSubmissionLegacyUncertain")&&checkpoint.providerSubmissionLegacyUncertain!==false)return null;
  let saved:Record<string,unknown>;try{saved=record(JSON.parse(String(row.request_json)));}catch{return null;}
  const {confirmed,...candidate}=record(saved.sceneCostConsent);
  if(confirmed!==true||!isSceneCostPreview(candidate)||saved.artifactKind!=="scene"||saved.sceneRequestId!==row.job_id
    ||candidate.requestId!==row.job_id||candidate.documentId!==row.document_id||candidate.actorUserId!==user.userId)return null;
  if(["providerJobId","providerRequestId","providerModel","providerResponseRef","audioProviderSubmission","presentationProviderSubmission","storyboardProviderSubmission",
    "renderedItems","productionSceneReceipts","productionFrameReceipts","productionAnchor","prepaidProviderCostMicrousd","artifactPlan"].some(key=>Object.hasOwn(checkpoint,key)))return null;
  const tokenId=checkpoint.reservationId,costId=checkpoint.costReservationId;
  if(typeof tokenId!=="string"||!tokenId||typeof costId!=="string"||!costId)return null;
  const prefix=String(row.job_id)+":",familyBindings=[String(row.job_id),prefix.length,prefix,String(row.job_id)];
  const familySql="SELECT COALESCE(json_group_array(json_array(event_id,stream_id,sequence,actor,client_id,correlation_id,type,payload,causation_id,occurred_at,private_owner,private_document,private_json,redacted_at)),'[]') FROM (SELECT event.event_id,event.stream_id,event.sequence,event.actor,event.client_id,event.correlation_id,event.type,event.payload,event.causation_id,event.occurred_at,secret.owner_id AS private_owner,secret.document_id AS private_document,secret.private_json,secret.redacted_at FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.correlation_id=? OR substr(event.correlation_id,1,?)=? OR json_extract(event.payload,'$.job_id')=? ORDER BY event.sequence,event.event_id LIMIT 16)";
  const tokenFields=["reservation_id","owner_id","stream_id","correlation_id","operation","period","reserved_tokens","used_tokens","status","settlement_reason","created_at","settled_at","updated_at"];
  const costFields=["reservation_id","owner_id","workspace_id","stream_id","correlation_id","operation","period","reserved_microusd","used_microusd","status","allow_user_overage","created_at","settled_at","updated_at"];
  const ledgerSql=(table:string,fields:string[])=>"SELECT COALESCE(json_group_array(json_array("+fields.join(",")+")),'[]') FROM (SELECT "+fields.join(",")+" FROM "+table+" WHERE correlation_id=? OR substr(correlation_id,1,?)=? OR reservation_id=? ORDER BY reservation_id LIMIT 2)";
  const [family,tokens,costs,billing,pilots]=await Promise.all([
    scenePolicySnapshot(env,familySql,familyBindings),
    scenePolicySnapshot(env,ledgerSql("budget_reservations",tokenFields),[String(row.job_id),prefix.length,prefix,tokenId]),
    scenePolicySnapshot(env,ledgerSql("cost_budget_reservations",costFields),[String(row.job_id),prefix.length,prefix,costId]),
    scenePolicySnapshot(env,"SELECT COALESCE(json_group_array(json_array(reservation_kind,reservation_id,organization_id,project_access_id,actor_user_id,workspace_scope_id,created_at)),'[]') FROM (SELECT * FROM project_budget_reservation_scopes WHERE reservation_id IN (?,?) ORDER BY reservation_kind,reservation_id LIMIT 3)",[tokenId,costId]),
    scenePolicySnapshot(env,"SELECT COALESCE(json_group_array(json_array(reservation_id,cohort_id,organization_id,actor_user_id,created_at)),'[]') FROM (SELECT * FROM pilot_cost_reservation_scopes WHERE reservation_id IN (?,?) ORDER BY reservation_id LIMIT 2)",[tokenId,costId]),
  ]);
  if(!family||!tokens||!costs||!billing||!pilots||family.rows.length>6||tokens.rows.length!==1||costs.rows.length!==1
    ||tokens.rows[0]!.length!==tokenFields.length||costs.rows[0]!.length!==costFields.length)return null;
  const token=Object.fromEntries(tokenFields.map((field,index)=>[field,tokens.rows[0]![index]]));
  const cost=Object.fromEntries(costFields.map((field,index)=>[field,costs.rows[0]![index]]));
  const typedEvents:Array<{id:string;sequence:number;actor:string;correlation:string;type:string;causation:unknown;at:string;payload:Record<string,unknown>}>=[];
  for(const event of family.rows){
    if(event.length!==14||event[1]!==row.stream_id||typeof event[0]!=="string"||!Number.isSafeInteger(event[2])
      ||event[10]!== (scope?.ownerUserId??user.userId)||event[13]!==null||typeof event[12]!=="string"||!sceneInstant(event[9]))return null;
    let payload:Record<string,unknown>;try{
      const publicValue:unknown=JSON.parse(String(event[7])),privateValue:unknown=JSON.parse(String(event[12]));
      if(!sceneObject(publicValue)||!sceneObject(privateValue)||publicValue._private_ref!==event[0])return null;
      payload={...publicValue,...privateValue};
    }catch{return null;}
    if(!["ProjectDocumentJobQueued","DocumentRenderRequested","BudgetReserved","DocumentRenderFailed","GenerationUsageRecorded","BudgetReleased"].includes(String(event[6])))return null;
    if(event[6]!=="ProjectDocumentJobQueued"&&(event[5]!==row.correlation_id||event[4]!=="server:document-job:render_document"))return null;
    if(event[11]!==null&&event[11]!==row.document_id)return null;
    typedEvents.push({id:event[0],sequence:Number(event[2]),actor:String(event[3]),correlation:String(event[5]),type:String(event[6]),causation:event[8],at:String(event[9]),payload});
  }
  const one=(type:string)=>{const values=typedEvents.filter(event=>event.type===type);return values.length===1?values[0]:null;};
  const queued=one("ProjectDocumentJobQueued"),requested=one("DocumentRenderRequested"),reserved=one("BudgetReserved"),failed=one("DocumentRenderFailed"),released=one("BudgetReleased");
  if(!requested||!reserved||!failed||!released||reserved.actor!=="worker:policy"||failed.actor!=="worker:renderer"||released.actor!=="worker:policy"
    ||!["user","user:"+user.userId].includes(requested.actor)||requested.payload.document_id!==row.document_id||requested.payload.project_id!==candidate.projectId
    ||requested.payload.artifact_kind!=="scene"||requested.payload.production_mode!==candidate.productionMode||requested.payload.item_count!==candidate.itemCount
    ||requested.payload.estimated_cost_microusd!==candidate.maximumMicrousd
    ||!(requested.sequence<reserved.sequence&&reserved.sequence<failed.sequence&&failed.sequence<released.sequence)
    ||reserved.causation!==requested.id||failed.causation!==requested.id)return null;
  if(scope){
    if(!queued||queued.correlation!==row.job_id||queued.actor!=="user:"+user.userId||queued.sequence>=requested.sequence
      ||queued.payload.job_id!==row.job_id||queued.payload.document_id!==row.document_id||queued.payload.kind!=="render_document"
      ||queued.payload.actor_user_id!==user.userId||queued.payload.history_owner_user_id!==scope.ownerUserId
      ||queued.payload.organization_id!==scope.organizationId||queued.payload.project_access_id!==scope.projectAccessId||queued.payload.project_id!==scope.projectId)return null;
  }else if(queued)return null;
  const witness=released.payload.scene_policy_stop;
  if(!sceneObject(witness)||Object.keys(witness).length!==policyWitnessKeys.length||policyWitnessKeys.some(key=>!Object.hasOwn(witness,key))
    ||witness.version!=="scene-policy-stop-v1"||witness.code!=="scene_paid_authority_changed"||!["before-pending","after-pending"].includes(String(witness.stage))
    ||witness.job_id!==row.job_id||witness.document_id!==row.document_id||witness.project_id!==candidate.projectId||witness.actor_user_id!==user.userId
    ||witness.attempt_correlation_id!==row.correlation_id||witness.provider!=="openai"||witness.model!==candidate.model
    ||typeof witness.client_request_id!=="string"||!witness.client_request_id||witness.artifact_id!==requested.payload.artifact_id||witness.artifact_id!==checkpoint.artifactId
    ||witness.binding_hash!==candidate.bindingHash||witness.source_hash!==candidate.sourceHash||witness.request_hash!==candidate.requestHash||witness.period!==candidate.period
    ||witness.reservation_id!==tokenId||witness.cost_reservation_id!==costId||witness.reserved_microusd!==candidate.maximumMicrousd
    ||witness.reserved_tokens!==documentRenderTokenReservation("scene",candidate.itemCount,candidate.maximumProviderCallCount)
    ||witness.organization_id!==(scope?.organizationId??null)||witness.project_access_id!==(scope?.projectAccessId??null)
    ||!sceneInstant(witness.stopped_at)||!sceneInstant(row.started_at)||!sceneInstant(row.completed_at)
    ||Date.parse(witness.stopped_at)<Date.parse(row.started_at)||Date.parse(witness.stopped_at)>Date.parse(released.at)||Date.parse(released.at)>Date.parse(row.completed_at))return null;
  if(reserved.payload.operation!=="document-render:scene"||reserved.payload.artifact_kind!=="scene"||reserved.payload.artifact_id!==witness.artifact_id
    ||reserved.payload.reservation_id!==tokenId||reserved.payload.cost_reservation_id!==costId||reserved.payload.period!==candidate.period
    ||reserved.payload.reserved_tokens!==witness.reserved_tokens||reserved.payload.reserved_microusd!==candidate.maximumMicrousd
    ||failed.payload.artifact_id!==witness.artifact_id||failed.payload.artifact_kind!=="scene"||failed.payload.document_id!==row.document_id
    ||failed.payload.error_code!=="scene_paid_authority_changed"||failed.payload.http_status!==403||failed.payload.error_category!=="access"
    ||failed.payload.error_scope!=="project"||failed.payload.retryable!==false||failed.payload.provider_request_id!==null||failed.payload.provider_job_id!==null
    ||released.payload.operation!=="document-render:scene"||released.payload.reason!=="document_scene_failed"
    ||released.payload.artifact_kind!=="scene"||released.payload.artifact_id!==witness.artifact_id||released.payload.reservation_id!==tokenId
    ||released.payload.reserved_tokens!==witness.reserved_tokens||released.payload.used_tokens!==witness.used_tokens
    ||released.payload.released_tokens!==Number(witness.reserved_tokens)-Number(witness.used_tokens))return null;
  let paidTokens=0,paidCost=0,stopped=0,completed=0;const responseIds=new Set<string>();
  for(const [key,value] of Object.entries(checkpoint.providerSubmissions)){
    if(!sceneObject(value)||key!==value.clientRequestId||value.provider!=="openai"||value.operation!=="planning"||value.model!==candidate.model)return null;
    if(key===witness.client_request_id){
      if(witness.stage!=="after-pending"||Object.keys(value).sort().join(",")!=="clientRequestId,costMicrousd,model,operation,provider,status"
        ||value.status!=="rejected"||value.costMicrousd!==0)return null;
      stopped++;continue;
    }
    if(value.status!=="completed"||typeof value.providerRequestId!=="string"||!value.providerRequestId||responseIds.has(value.providerRequestId)
      ||!["inputTokens","outputTokens","totalTokens","costMicrousd"].every(field=>Number.isSafeInteger(value[field])&&Number(value[field])>=0)
      ||Number(value.totalTokens)!==Number(value.inputTokens)+Number(value.outputTokens))return null;
    responseIds.add(value.providerRequestId);completed++;paidTokens+=Number(value.totalTokens);paidCost+=Number(value.costMicrousd);
  }
  if(stopped!==(witness.stage==="after-pending"?1:0)||witness.used_tokens!==paidTokens||witness.used_microusd!==paidCost
    ||checkpoint.costReservationPeriod!==candidate.period||checkpoint.costReservationMicrousd!==candidate.maximumMicrousd)return null;
  for(const [ledger,id,amount,used,unit] of [[token,tokenId,witness.reserved_tokens,paidTokens,"tokens"],[cost,costId,candidate.maximumMicrousd,paidCost,"microusd"]] as const){
    if(ledger.reservation_id!==id||ledger.owner_id!==user.userId||ledger.stream_id!==row.stream_id||ledger.correlation_id!==row.correlation_id
      ||ledger.operation!=="document-render:scene"||ledger.period!==candidate.period||ledger["reserved_"+unit]!==amount||ledger["used_"+unit]!==used
      ||ledger.status!==(used>0?"settled":"released")||!sceneInstant(ledger.created_at)||!sceneInstant(ledger.settled_at)||!sceneInstant(ledger.updated_at)
      ||Date.parse(ledger.created_at)>Date.parse(witness.stopped_at)||Date.parse(ledger.settled_at)<Date.parse(witness.stopped_at)
      ||Date.parse(ledger.settled_at)>Date.parse(released.at)||ledger.updated_at!==ledger.settled_at)return null;
  }
  if(token.settlement_reason!==(paidTokens>0?"document_scene_failed_after_planning":"document_scene_failed")
    ||cost.workspace_id!==(scope?.organizationId??"forma")||cost.allow_user_overage!==0)return null;
  const usage=typedEvents.filter(event=>event.type==="GenerationUsageRecorded");
  const charged=paidTokens>0||paidCost>0;
  if(usage.length!==(charged?1:0)||typedEvents.length!==(scope?5:4)+usage.length)return null;
  if(charged){
    const event=usage[0]!;
    if(event.actor!=="worker:policy"||event.sequence<=failed.sequence||event.sequence>=released.sequence||event.causation!==failed.id||released.causation!==event.id
      ||event.payload.document_id!==row.document_id||event.payload.artifact_id!==witness.artifact_id||event.payload.artifact_kind!=="scene"
      ||event.payload.reservation_id!==tokenId||event.payload.cost_reservation_id!==costId||event.payload.total_tokens!==paidTokens
      ||event.payload.cost_microusd!==paidCost||typeof event.payload.planner_response_id!=="string"||!responseIds.has(event.payload.planner_response_id))return null;
  }else if(released.causation!==failed.id||!completed&&(failed.payload.prompt_ref!==null||failed.payload.provider_charge_status!=="not_applicable"))return null;
  if(scope){
    if(billing.rows.length!==2||!["tokens","usd"].every(kind=>billing.rows.some(entry=>entry.length===7&&entry[0]===kind&&entry[1]===(kind==="tokens"?tokenId:costId)
      &&entry[2]===scope.organizationId&&entry[3]===scope.projectAccessId&&entry[4]===user.userId&&entry[5]===scope.organizationId)))return null;
  }else if(billing.rows.length)return null;
  if(witness.pilot_cohort_id===null){if(pilots.rows.length)return null;}
  else if(typeof witness.pilot_cohort_id!=="string"||!scope||pilots.rows.length!==1||pilots.rows[0]!.length!==5
    ||pilots.rows[0]![0]!==costId||pilots.rows[0]![1]!==witness.pilot_cohort_id||pilots.rows[0]![2]!==scope.organizationId||pilots.rows[0]![3]!==user.userId)return null;
  const rowColumns=["job_id","owner_id","stream_id","document_id","kind","status","source_surface","correlation_id","requested_sequence","request_json","result_json","error_message","attempt_count","requested_at","started_at","completed_at","lease_expires_at","notified_at","expires_at","updated_at"];
  const exactRow:BudgetReservationGuard={sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_array("+rowColumns.join(",")+")=?)",
    bindings:[String(row.job_id),JSON.stringify(rowColumns.map(key=>row[key]))]};
  return{unused:completed===0,stoppedRequestId:witness.stage==="after-pending"?witness.client_request_id:null,
    guard:conjunction([exactRow,family.guard,tokens.guard,costs.guard,billing.guard,pilots.guard]),
    hashInput:{family:family.raw,tokens:tokens.raw,costs:costs.raw,billing:billing.raw,pilots:pilots.raw}};
}

const sceneUnusedForbiddenCheckpoint = [
  "reservationId", "costReservationId", "costReservationMicrousd", "costReservationPeriod",
  "plannerResponseId", "plannerResponseIds", "plannerModel", "plannerUsage", "plannerInput",
  "providerJobId", "providerRequestId", "providerModel", "providerInput", "providerResponseRef",
  "artifactPlan", "artifactId", "renderedItems", "productionPlan", "productionSceneReceipts",
  "productionFrameReceipts", "productionAnchor", "presentationProviderSubmission", "audioProviderSubmission",
  "storyboardProviderSubmission", "audioInputReceipt", "videoInputReceipt", "prepaidProviderCostMicrousd",
] as const;
const sceneObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sceneInstant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
async function sceneRawSnapshotHash(snapshot: Record<string, unknown>) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Only these complete, newly admitted, never-submitted histories can prepare changed work.
 * Missing fields are not zeroes. A rejected provider call, even at zero cost, is not unused. */
async function prepareSceneUnusedProof(
  env: WorkerEnv, user: PilotUser, row: Record<string, unknown>, saved: Record<string, unknown>,
  preview: SceneCostPreview | null, binding: ConsequentialBinding, readGuard: BudgetReservationGuard, authorityDeadline: string,
): Promise<SceneUnusedPreparation | null> {
  if (!preview || !sceneCostApprovalMatches(saved.sceneCostConsent, preview)
    || saved.sceneRequestId !== row.job_id || saved.artifactKind !== "scene"
    || row.lease_expires_at !== null || !sceneInstant(row.completed_at) || !sceneInstant(row.updated_at)
    || !sceneInstant(row.requested_at) || !sceneInstant(row.expires_at)
    || Date.parse(row.requested_at) > Date.parse(row.completed_at) || Date.parse(row.completed_at) > Date.parse(row.updated_at)
    || !(Date.parse(row.expires_at) > Date.now())) return null;
  let checkpoint: Record<string, unknown>;
  try { const value: unknown = JSON.parse(String(row.result_json)); if (!sceneObject(value)) return null; checkpoint = value; } catch { return null; }
  const failure = record(checkpoint.errorDetail), receipt = record(checkpoint.generationReceipt);
  const policyStop=policyFailure(failure)&&row.status==="failed"&&row.attempt_count===1;
  const policyAllowedCheckpoint=new Set(["reservationId","costReservationId","costReservationMicrousd","costReservationPeriod","artifactId","productionPlan"]);
  if (checkpoint.artifactKind !== "scene" || checkpoint.providerSubmissionProtocol !== 1
    || !Object.hasOwn(checkpoint, "providerSubmissions") || !sceneObject(checkpoint.providerSubmissions)
    || !policyStop && Object.keys(checkpoint.providerSubmissions).length !== 0
    || Object.hasOwn(checkpoint, "providerSubmissionLegacyUncertain") && checkpoint.providerSubmissionLegacyUncertain !== false
    || sceneUnusedForbiddenCheckpoint.some(key => Object.hasOwn(checkpoint, key)&&(!policyStop||!policyAllowedCheckpoint.has(key)))) return null;
  let reason: SceneSafeUnusedProof["reason"];
  if (row.status === "canceled" && row.attempt_count === 0 && row.started_at === null
    && row.correlation_id === row.job_id && row.error_message === "canceled_by_user" && failure.code === "canceled_by_user") {
    reason = "canceled-before-start";
  } else if (row.status === "failed" && row.attempt_count === 1 && sceneInstant(row.started_at)
    && Date.parse(row.started_at) >= Date.parse(row.requested_at) && Date.parse(row.started_at) <= Date.parse(row.completed_at)
    && row.correlation_id === String(row.job_id) + ":attempt:1" && row.error_message === "workflow_source_unavailable"
    && failure.code === "workflow_source_unavailable" && failure.httpStatus === 404 && failure.requestId === null
    && receipt.failure_code === "workflow_source_unavailable") {
    reason = "source-unavailable-before-dispatch";
  } else if(policyStop&&sceneInstant(row.started_at)&&Date.parse(row.started_at)>=Date.parse(row.requested_at)
    &&Date.parse(row.started_at)<=Date.parse(row.completed_at)&&row.correlation_id===String(row.job_id)+":attempt:1"
    &&row.error_message===failure.message&&receipt.failure_code==="scene_paid_authority_changed"&&receipt.failure_category==="access"
    &&receipt.actual_provider_call_count===0&&receipt.reservation_status==="released"){
    reason="policy-stopped-before-dispatch";
  } else return null;
  if (receipt.schema_version !== 1 || receipt.artifact_kind !== "scene" || receipt.provider !== "openai" || receipt.model !== preview.model
    || receipt.scene_medium !== preview.sceneMedium || receipt.production_mode !== preview.productionMode
    || receipt.provider_request_status !== "not_submitted" || receipt.source_transmission_status !== "not_transmitted"
    || receipt.settled_cost_microusd !== 0 || !["estimated", "not_reserved", "released"].includes(String(receipt.reservation_status))
    || !Object.hasOwn(receipt, "actual_provider_call_count") || receipt.actual_provider_call_count !== null && receipt.actual_provider_call_count !== 0
    || receipt.planned_provider_call_count !== preview.providerCallCount || receipt.maximum_provider_call_count !== preview.maximumProviderCallCount
    || receipt.maximum_authorized_cost_microusd !== preview.maximumMicrousd || typeof receipt.input_ref !== "string") return null;

  const custody = executionContentCustodyGuard(binding, "content");
  const retention = binding.scope
    ? " AND EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=content.content_id AND retention.classification='governed-evidence' AND retention.assigned_expires_at=content.expires_at)" : "";
  const content = await env.DB.prepare("SELECT content.content_id,content.content,content.expires_at FROM private_content content WHERE (content.content_id,content.owner_id,content.kind)=(?,?,'document-artifact-input') AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (" + custody.sql + ")" + retention + " AND (" + readGuard.sql + ")")
    .bind(receipt.input_ref, user.userId, ...custody.bindings, ...readGuard.bindings).first<{content_id:string;content:string;expires_at:string}>();
  if (!content || !sceneInstant(content.expires_at)) return null;
  let input: Record<string, unknown>;
  try { const value: unknown = JSON.parse(content.content); if (!sceneObject(value)) return null; input = value; } catch { return null; }
  const settings = record(input.request), source = record(input.source), planner = record(input.planner), accounting = record(input.accounting);
  if (input.schema_version !== 1 || input.job_id !== row.job_id || input.document_id !== row.document_id || input.artifact_kind !== "scene"
    || input.scene_request_id !== row.job_id || input.scene_cost_binding_hash !== preview.bindingHash
    || input.captured_at !== receipt.captured_at || input.scene_medium !== preview.sceneMedium
    || settings.production_mode !== preview.productionMode || settings.planned_provider_call_count !== preview.providerCallCount
    || settings.maximum_provider_call_count !== preview.maximumProviderCallCount || settings.reservation_microusd !== preview.maximumMicrousd
    || planner.provider !== "openai" || planner.model !== preview.model || planner.request_status !== "not_submitted"
    || source.scope !== "authorized_document_context" || source.status !== "not_transmitted"
    || accounting.settled_cost_microusd !== 0 || accounting.maximum_authorized_cost_microusd !== preview.maximumMicrousd
    || !sceneObject(input.document_snapshot) || !sceneObject(input.production_workflow_snapshot)
    || JSON.stringify(input.document_snapshot) !== JSON.stringify(saved.snapshot)
    || JSON.stringify(input.source_block_versions) !== JSON.stringify(saved.sourceBlockVersions)) return null;
  const requestHash = await sceneCostRequestHash({ ...saved, documentId: String(row.document_id), requestId: String(row.job_id) } as SceneCostRequest);
  const authoredHash = await sceneRawSnapshotHash(input.document_snapshot);
  const effectiveHash = await consentHash(input.production_workflow_snapshot);
  if (requestHash !== preview.requestHash || effectiveHash !== preview.sourceHash
    || authoredHash !== source.snapshot_sha256 || authoredHash !== receipt.source_snapshot_sha256) return null;

  if(policyStop){
    const evidence=await readScenePolicyStopEvidence(env,user,row,checkpoint,binding.scope??undefined);
    if(!evidence?.unused)return null;
    if(preview.productionMode==="managed"){
      const expected=buildManagedProductionPlan("scene",input.production_workflow_snapshot,{requestedItemCount:Number(saved.itemCount??0),sceneMedium:preview.sceneMedium});
      if(await consentHash(checkpoint.productionPlan)!==await consentHash(expected))return null;
    }else if(Object.hasOwn(checkpoint,"productionPlan"))return null;
    const guard=conjunction([
      {sql:"EXISTS(SELECT 1 FROM private_content content WHERE (content.content_id,content.owner_id,content.kind,content.content,content.expires_at)=(?,?,'document-artifact-input',?,?) AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ("+custody.sql+")"+retention+")",bindings:[content.content_id,user.userId,content.content,content.expires_at,...custody.bindings]},
      evidence.guard,
    ]);
    const evidenceHash=await consentHash({version:"scene-safe-unused-v1",row,sourceInput:content.content,...record(evidence.hashInput)});
    const verifiedAt=new Date().toISOString(),month=verifiedAt.slice(0,7);
    const expiresAt=earliestSceneDeadline([authorityDeadline,row.expires_at,content.expires_at,new Date(Date.parse(verifiedAt)+30_000).toISOString(),new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString()]);
    const proof:SceneSafeUnusedProof={version:"scene-safe-unused-v1",requestId:String(row.job_id),actorUserId:user.userId,projectId:preview.projectId,documentId:String(row.document_id),
      contextSessionId:binding.contextSessionId,permissionEpoch:user.access.permissionEpoch,bindingHash:preview.bindingHash,jobStatus:"failed",
      jobUpdatedAt:row.updated_at,attemptCount:1,reason,verifiedAt,expiresAt,evidenceHash};
    return{proof,guard};
  }

  // Include every original/older attempt correlation, even when the current attempt has no events.
  const prefix = String(row.job_id) + ":";
  const familySql = "SELECT COALESCE(json_group_array(json_array(event_id,stream_id,sequence,actor,correlation_id,type,payload,private_owner,private_document,private_json,redacted_at)),'[]') FROM (SELECT event.event_id,event.stream_id,event.sequence,event.actor,event.correlation_id,event.type,event.payload,secret.owner_id AS private_owner,secret.document_id AS private_document,secret.private_json,secret.redacted_at FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.correlation_id=? OR substr(event.correlation_id,1,?)=? OR json_extract(event.payload,'$.job_id')=? ORDER BY event.sequence,event.event_id)";
  const familyBindings = [String(row.job_id), prefix.length, prefix, String(row.job_id)];
  const family = await env.DB.prepare("SELECT (" + familySql + ") AS evidence").bind(...familyBindings).first<{evidence:string}>();
  if (!family || typeof family.evidence !== "string") return null;
  let events: unknown;
  try { events = JSON.parse(family.evidence); } catch { return null; }
  if (!Array.isArray(events)) return null;
  let anchors = 0, cancellations = 0;
  for (const event of events) {
    if (!Array.isArray(event) || event.length !== 11 || event[1] !== row.stream_id || event[4] !== row.job_id) return null;
    let payload: Record<string, unknown>;
    try { const value: unknown = JSON.parse(String(event[6])); if (!sceneObject(value)) return null; payload = value; } catch { return null; }
    if (payload.job_id !== row.job_id || payload.document_id !== row.document_id || payload.kind !== "render_document") return null;
    if (event[5] === "ProjectDocumentJobQueued" && binding.scope && event[3] === "user:" + user.userId
      && payload.organization_id === binding.scope.organizationId && payload.project_access_id === binding.scope.projectAccessId
      && payload.project_id === binding.scope.projectId && payload.actor_user_id === user.userId
      && payload.history_owner_user_id === binding.scope.ownerUserId) anchors++;
    else if (reason === "canceled-before-start" && event[5] === "JobCanceled" && event[3] === "worker:scheduler"
      && payload.previous_status === "queued" && payload.released_reservation_count === 0
      && payload._private_ref === event[0] && event[7] === (binding.scope?.ownerUserId ?? user.userId)
      && event[8] === row.document_id && event[10] === null) {
      let detail: Record<string, unknown>;
      try { const value: unknown = JSON.parse(String(event[9])); if (!sceneObject(value)) return null; detail = value; } catch { return null; }
      if (detail.requested_by !== user.userId) return null;
      cancellations++;
    } else return null;
  }
  if (anchors !== (binding.scope ? 1 : 0) || cancellations !== (reason === "canceled-before-start" ? 1 : 0)) return null;
  const ledgerEmpty = (table: "budget_reservations" | "cost_budget_reservations"): BudgetReservationGuard => ({
    sql: "NOT EXISTS(SELECT 1 FROM " + table + " WHERE correlation_id=? OR substr(correlation_id,1,?)=?)",
    bindings: [String(row.job_id), prefix.length, prefix],
  });
  const ledgerGuard = conjunction([ledgerEmpty("budget_reservations"), ledgerEmpty("cost_budget_reservations")]);
  if (!await sceneCostAuthorityCurrent(env, ledgerGuard)) return null;
  const guard = conjunction([
    {sql: "EXISTS(SELECT 1 FROM private_content content WHERE (content.content_id,content.owner_id,content.kind,content.content,content.expires_at)=(?,?,'document-artifact-input',?,?) AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (" + custody.sql + ")" + retention + ")", bindings: [content.content_id, user.userId, content.content, content.expires_at, ...custody.bindings]},
    {sql: "(" + familySql + ")=?", bindings: [...familyBindings, family.evidence]},
    ledgerGuard,
  ]);
  const evidenceHash = await consentHash({version:"scene-safe-unused-v1",row,sourceInput:content.content,family:family.evidence,tokenReservations:[],costReservations:[]});
  const verifiedAt = new Date().toISOString(), month = verifiedAt.slice(0,7);
  const expiresAt = earliestSceneDeadline([authorityDeadline, row.expires_at, content.expires_at, new Date(Date.parse(verifiedAt)+30_000).toISOString(), new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString()]);
  const proof: SceneSafeUnusedProof = {
    version:"scene-safe-unused-v1",requestId:String(row.job_id),actorUserId:user.userId,projectId:preview.projectId,documentId:String(row.document_id),
    contextSessionId:binding.contextSessionId,permissionEpoch:user.access.permissionEpoch,bindingHash:preview.bindingHash,
    jobStatus:row.status as "canceled"|"failed",jobUpdatedAt:row.updated_at,attemptCount:Number(row.attempt_count),reason,verifiedAt,expiresAt,evidenceHash,
  };
  return {proof,guard};
}

/** A durable job ID survives request/result expiry; absence of retained private bytes never means unused. */
export async function readExistingSceneRequest(
  env: WorkerEnv, user: PilotUser, documentId: string, requestId: unknown, contextSessionId: string | null,
  options: { certifyUnused?: boolean } = {},
): Promise<{ row: Record<string, unknown>; preview: SceneCostPreview | null; scope: ProjectExecutionScope | undefined; safeUnused: SceneSafeUnusedProof | null } | null> {
  if (!requestIdValid(requestId) || !documentId || documentId.length > 160) fail("scene_cost_request_required", 400);
  const row = await env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=?").bind(requestId).first<Record<string, unknown>>();
  if (!row) return null;
  if (row.owner_id !== user.userId || row.stream_id !== user.streamId || row.document_id !== documentId || row.kind !== "render_document") fail("scene_cost_request_unavailable");
  let saved: Record<string, unknown> = {};
  try { saved = record(JSON.parse(String(row.request_json))); } catch { /* A durable ID still blocks a replacement purchase. */ }
  if (saved.artifactKind !== undefined && saved.artifactKind !== "scene" || saved.sceneRequestId !== undefined && saved.sceneRequestId !== requestId) fail("scene_cost_request_unavailable");
  const descriptor = { ...record(saved.sceneCostConsent) }; delete descriptor.confirmed;
  const preview = isSceneCostPreview(descriptor) && descriptor.requestId === requestId
    && descriptor.actorUserId === user.userId && descriptor.documentId === documentId ? descriptor : null;
  const origin = await env.DB.prepare("SELECT json_extract(payload,'$.project_id') AS project_id FROM events WHERE stream_id=? AND type IN('DocumentCreated','DocumentForked') AND json_extract(payload,'$.document_id')=? ORDER BY sequence LIMIT 1")
    .bind(user.streamId, documentId).first<{ project_id: string }>();
  const projectId = preview?.projectId ?? origin?.project_id;
  if (!projectId) fail("scene_cost_existing_unavailable");
  let scope = user.projectExecution;
  if (scope && scope.projectId !== projectId) fail("scene_cost_authority_changed", 403);
  if (!scope) {
    const custody = await resolveOwnerExecutionScope(env, user, documentId, projectId, "read");
    if (custody.denied) fail("scene_cost_authority_changed", 403);
    scope = custody.scope;
  }
  if (!(scope ? hasCapability(user, "project.read", scope) : user.access.capabilities.includes("project.read"))) fail("scene_cost_authority_changed", 403);
  const binding: ConsequentialBinding = {
    version: "scene-receipt-read-v1", operation: "written-scene-read", actorUserId: user.userId, permissionEpoch: user.access.permissionEpoch,
    intentHash: "", sourceHash: "", streamId: user.streamId, projectId, documentId, canvasId: null, blockId: "",
    period: new Date().toISOString().slice(0, 7), scope: scope ?? null, contextSessionId, pilotCohortId: null, steps: [], publicQuery: "", request: {},
  };
  const selected = contextSessionId ? await env.DB.prepare("SELECT expires_at FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND revoked_at IS NULL")
    .bind(contextSessionId,user.userId).first<{expires_at:string}>() : null;
  if(contextSessionId&&!selected)fail("scene_cost_authority_changed",403);
  const validUntil=earliestSceneDeadline(["9999-12-31T00:00:00Z",selected?.expires_at,...user.access.grants.map(grant=>grant.expiresAt)]);
  const rowColumns = ["job_id","owner_id","stream_id","document_id","kind","status","source_surface","correlation_id","requested_sequence","request_json","result_json","error_message","attempt_count","requested_at","started_at","completed_at","lease_expires_at","notified_at","expires_at","updated_at"];
  const guards = [
    executionAdmissionGuard(user, binding, null),
    ...(selected?[{sql:"EXISTS(SELECT 1 FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND expires_at=? AND revoked_at IS NULL)",bindings:[contextSessionId!,user.userId,selected.expires_at]}]:[]),
    { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_array(" + rowColumns.join(",") + ")=?)",
      bindings: [String(row.job_id), JSON.stringify(rowColumns.map(key=>row[key]))] },
    ...(scope ? [{
      sql: "EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN events anchor ON anchor.event_id=resource.source_event_id AND anchor.stream_id=? AND anchor.type='ProjectDocumentJobQueued' AND anchor.actor='user:'||resource.actor_user_id WHERE (resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.resource_kind,resource.resource_id,resource.actor_user_id,resource.visibility)=(?,?,?,?,'job',?,?,'actor_private') AND (json_extract(anchor.payload,'$.job_id'),json_extract(anchor.payload,'$.document_id'),json_extract(anchor.payload,'$.organization_id'),json_extract(anchor.payload,'$.project_access_id'),json_extract(anchor.payload,'$.actor_user_id'))=(?,?,?,?,?))",
      bindings: [user.streamId, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, String(row.job_id), user.userId, String(row.job_id), documentId, scope.organizationId, scope.projectAccessId, user.userId],
    }] : [{
      sql: "NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?)",
      bindings: [String(row.job_id)],
    }]),
  ];
  const readGuard = conjunction(guards);
  const unused = options.certifyUnused ? await prepareSceneUnusedProof(env, user, row, saved, preview, binding, readGuard, validUntil) : null;
  // One final snapshot certifies authority, the entire job row and all proof evidence together.
  if (!await sceneCostAuthorityCurrent(env, unused ? conjunction([readGuard, unused.guard]) : readGuard)) fail("scene_cost_authority_changed", 403);
  requireSceneCostDeadline({validUntil});
  if(!(Date.parse(String(row.expires_at))>Date.now()))return {row:{...row,request_json:"{}",result_json:null,error_message:null},preview:null,scope,safeUnused:null};
  return { row, preview, scope, safeUnused: unused && isSceneSafeUnusedProof(unused.proof) ? unused.proof : null };
}

/** Serializes parallel/lost-response submissions in the existing durable primary key, across every terminal state. */
export function sceneRequestExclusion(requestId: string, guard: BudgetReservationGuard): BudgetReservationGuard {
  return conjunction([guard, {
    sql: "NOT EXISTS(SELECT 1 FROM document_jobs WHERE job_id=?)",
    bindings: [requestId],
  }]);
}
