import { parseMemoryEditReview } from '../src/model/memory-edit-review.ts';
import { parseSemanticMemoryAnswerPresentation } from '../src/model/memory-answer.ts';
import { authoringEventProof } from './authoring-event-proof.ts';
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { ASSISTANT_MESSAGES } from "../src/components/design-system/locales/assistant-messages.ts";
import { isBlockKind } from "../src/model/block-types.ts";
import { ASSISTANT_MODELS, type AssistantModel, type AssistantTask } from "../src/model/assistant-model-policy.ts";
import { assistantSurfaceForRoute, type AssistantSurface } from "../src/model/assistant-route-policy.ts";
import { ASSISTANT_STATE_EVENT_SQL } from "../src/model/assistant-event-views.ts";
import type { MemoryAnswerPresentation } from "../src/model/memory-answer.ts";
import { assistantActionEvents, normalizeAssistantActions, type AssistantContextAction } from "../src/model/assistant-proposals.ts";
import { validateContextCompositionGraph } from "../src/model/combined-context.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { ASSISTANT_CONTEXT_LIMITS, boundAssistantContext, compileAssistantContext, protectedAssistantDecision, type AssistantContext } from "../src/model/conversation-context.ts";
import { foldEvents, type CreativeEvent, type EventInput } from "../src/model/events.ts";
import { outputBlockRemovalEvents, outputBlockTextEditEvents } from "../src/model/output-authoring.ts";
import type { FormaCapability } from "../src/platform/capabilities.ts";
import { readCanvasGovernance } from "./canvas-governance-policy.ts";
import {
  hasCapability,
  releaseBudget,
  releaseCostBudget,
  requireCapability,
  requireConsent,
  requireUser,
  settleBudget,
  settleCostBudget,
  type PilotUser,
  type BudgetReservationGuard,
} from "./pilot-policy.ts";
import { type AssistantProviderResult } from "./assistant-provider.ts";
import { reconcileConsequentialUsage } from "./consequential-consent.ts";
import { assistantPaidReplyReadGuard, assistantSubmissionStatus, assistantReadAuthorityGuard, assistantMemoryPreparedDocument, certifiedAssistantTaskFeed, certifiedAssistantTurnResponse, rememberAssistantFeedTurnSource, rememberAssistantMemoryTurnSource, type AssistantTaskFeedEntry, assistantTurnContentCustody, ensureAssistantSpecialistColumns, savedAssistantRequest, handleAssistantSpecialistConsent, parkUnsignedAssistantTasks, cancelConsentedAssistantTask, type SpecialistActor, type SpecialistTaskRecord, type AssistantSpecialistHost, type MemoryEditPublication } from "./assistant-specialist-consent.ts";
import { readNativeDocumentMemory, prepareNativeStructuredConversationContext, nativeStructuredConversationContextPrecommitStatements, nativeStructuredConversationContextMatches,
  prepareNativeStructuredConversationOwnSend, nativeStructuredConversationOwnSendStatements, nativeStructuredConversationOwnSendMatches,
  type NativeDocumentMemoryContext, type PreparedNativeStructuredConversationContext } from "./memory-live-context.ts";
import { NATIVE_MEMORY_ANSWER_KIND, nativeMemoryOriginCapture, prepareNativeMemoryOrigin,
  nativeStructuredMemoryOriginCapture, nativeStructuredMemoryOriginPublicationCurrent, prepareNativeStructuredMemoryOrigin } from "./memory-native-origin.ts";
import { revalidateNativeAnswerOrigin, revalidateNativeStructuredAnswerOrigin, nativeStructuredMemoryOriginReadStatements,
  nativeStructuredMemoryOriginReadMatches } from "./memory-native-origin-reader.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { nativeMemoryAssistantReply, nativeStructuredMemoryAssistantReply } from "./memory-assistant-reply.ts";
import { liveMemoryEnabled, liveMemoryOriginWithdrawalStatements, prepareNativeMemorySelection, nativeMemorySelectionStatements,
  discoverNativeStructuredConversationOriginals, type NativeMemorySelection } from "./memory-live-store.ts";
import { governedPackageSourceRightsCurrent, governedPackageSourceRightsValidity, sourceRightsDispatchGuard, sourceRightsDispatchGuardForAssistant,
  sourceRightsDispatchGuardForStructuredAssistant } from "./context-package-rights.ts";
import { AssistantContextReadWitness, assistantOwnSendProjectIndexGuard, assistantStructuredOwnSendProjectIndexGuard, rememberAssistantContextRead,
  type AssistantContextReadDescriptor, type AssistantOwnSendFootprint, type AssistantStructuredOwnSendFootprint } from "./assistant-context-source.ts";
import { prepareOutputRequirementClientEvents } from "./output-requirement-event-guards.ts";
import { appendProjectEvents, projectDocumentPublicationEvents, projectSourceProjectionCurrentAssertion, projectStructuredSourceProjectionCurrentAssertion, readProjectAssistantEventView, readProjectEventPage, readProjectRequestContext, resolveOwnerExecutionScope, synchronizeProjectScope } from "./project-access.ts";
import { priceTextUsageBreakdownMicrousd } from "./replay-cost.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, serializeEvent, streamHead, uuidV7, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";

type AssistantReply = { key?: string; values?: Record<string, string | number>; text?: string };
type AssistantProposal = { id: string; key: string; route?: string; kind: "navigate" | AssistantContextAction["kind"]; turnId: string; summary?: string };
type AssistantTurn = { id: string; user: string; reply: AssistantReply; proposal: AssistantProposal | null; proposals?: AssistantProposal[]; originalRequest?: unknown;
  memory?:MemoryAnswerPresentation };
type AssistantRecallMemory=
  |{mode:"extractive";selection:NativeMemorySelection;value:NativeDocumentMemoryContext;source:AssistantContextReadWitness<NativeDocumentMemoryContext>}
  |{mode:"structured";selection:NativeMemorySelection;value:PreparedNativeStructuredConversationContext};
type AuthorizedAssistant = SpecialistActor;
type PreparedAssistantAction = {
  id: string;
  turnId: string;
  action: AssistantContextAction;
  key: string;
  summary: string;
  sourceVersions: Array<{ blockId: string; version: number }>;
};
type AssistantTurnRow = { turn_id: string; proposal_json: string | null; user_content: string; assistant_content: string; request_json?: string|null;
  source_created_at?:string;source_sequence?:number;
  source_user_ref?:string;source_answer_ref?:string;source_turn_record?:string;source_message_id?:string;source_response_id?:string;
  source_message_record?:string;source_response_record?:string;source_metadata_checked?:number;source_metadata_record?:string|null };
type StoredAssistantProposal = {
  proposal_id: string;
  actor_user_id: string;
  scope_key: string;
  turn_id: string;
  organization_id: string | null;
  project_access_id: string | null;
  project_id: string;
  document_id: string;
  action_kind: string;
  action_content_ref: string;
  source_versions_json: string;
  expected_head: number;
  permission_epoch: string;
  status: string;
  expires_at: string;
  content: string;
};
type StoredAssistantTask = SpecialistTaskRecord;

const initializedAssistants = new WeakMap<D1Database, Promise<void>>();
const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" };

async function ensureAssistantSchema(env: WorkerEnv) {
  let pending = initializedAssistants.get(env.DB);
  if (!pending) {
    pending = (async () => {
      await env.DB.batch([
        env.DB.prepare("CREATE TABLE IF NOT EXISTS assistant_turns (turn_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, scope_key TEXT NOT NULL, organization_id TEXT, project_access_id TEXT, project_id TEXT, document_id TEXT, route_family TEXT NOT NULL, user_content_ref TEXT NOT NULL, assistant_content_ref TEXT NOT NULL, proposal_json TEXT, permission_epoch TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT NOT NULL, PRIMARY KEY(actor_user_id,scope_key,turn_id))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_assistant_turns_actor_scope ON assistant_turns(actor_user_id,scope_key,created_at)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS assistant_action_proposals (proposal_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,scope_key TEXT NOT NULL,turn_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,project_id TEXT NOT NULL,document_id TEXT NOT NULL,action_kind TEXT NOT NULL,action_content_ref TEXT NOT NULL,source_versions_json TEXT NOT NULL,expected_head INTEGER NOT NULL,permission_epoch TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,resolved_at TEXT)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_assistant_proposals_actor_scope ON assistant_action_proposals(actor_user_id,scope_key,status,created_at)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS assistant_action_commits(commit_id TEXT PRIMARY KEY NOT NULL,verified INTEGER NOT NULL CHECK(verified=1),created_at TEXT NOT NULL)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS assistant_specialist_tasks(task_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,scope_key TEXT NOT NULL,turn_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,project_id TEXT,document_id TEXT,route_family TEXT NOT NULL,task_kind TEXT NOT NULL,selected_model TEXT NOT NULL,token_reservation_id TEXT NOT NULL,cost_reservation_id TEXT NOT NULL,estimated_microusd INTEGER NOT NULL,maximum_input_tokens INTEGER NOT NULL,maximum_output_tokens INTEGER NOT NULL,locale TEXT NOT NULL,permission_epoch TEXT NOT NULL,status TEXT NOT NULL,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,lease_expires_at TEXT,provider_submitted INTEGER NOT NULL DEFAULT 0,UNIQUE(actor_user_id,scope_key,turn_id,task_kind))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_assistant_tasks_actor_scope ON assistant_specialist_tasks(actor_user_id,scope_key,status,created_at)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS assistant_billing_reconciliations(reconciliation_id TEXT PRIMARY KEY NOT NULL,task_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,reviewer_user_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,evidence_classification TEXT NOT NULL CHECK(evidence_classification='verified-no-provider-charge'),occurred_at TEXT NOT NULL,UNIQUE(task_id,reviewer_user_id))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_assistant_billing_reconciliations_actor_scope ON assistant_billing_reconciliations(actor_user_id,organization_id,project_access_id,occurred_at)"),
        env.DB.prepare("CREATE TRIGGER IF NOT EXISTS assistant_billing_reconciliation_block_update BEFORE UPDATE ON assistant_billing_reconciliations BEGIN SELECT RAISE(ABORT,'assistant billing audit is append-only'); END"),
        env.DB.prepare("CREATE TRIGGER IF NOT EXISTS assistant_billing_reconciliation_block_delete BEFORE DELETE ON assistant_billing_reconciliations BEGIN SELECT RAISE(ABORT,'assistant billing audit is append-only'); END"),
      ]);
      await ensureAssistantSpecialistColumns(env);
    })().catch((error) => { initializedAssistants.delete(env.DB); throw error; });
    initializedAssistants.set(env.DB, pending);
  }
  return pending;
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}

function assistantTesters(env: WorkerEnv) {
  return new Set((env.FORMA_ASSISTANT_INTERNAL_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

function featureUsers(value: string | undefined) {
  return new Set((value ?? "").split(",").map((candidate) => candidate.trim()).filter(Boolean));
}

function assistantActionsEnabled(env: WorkerEnv, actor: AuthorizedAssistant) {
  return featureUsers(env.FORMA_ASSISTANT_ACTION_USER_IDS).has(actor.principal.userId) && actor.canPropose;
}

function assistantTaskKind(message: string, actions: PreparedAssistantAction[]): AssistantTask {
  if (/\b(?:governance|compliance|security policy|procurement|audit policy)\b/iu.test(message)) return "governance-review";
  if (/\b(?:across|compare|synthesize)\b.{0,30}\b(?:documents|projects)\b/iu.test(message)) return "cross-document-synthesis";
  return actions.length ? "proposal" : "page-guidance";
}

function assistantAllowedModels(env: WorkerEnv): AssistantModel[] {
  if (!env.FORMA_ASSISTANT_ALLOWED_MODELS) return ["gpt-5.6-luna", "gpt-5.6-terra"];
  return [...new Set(env.FORMA_ASSISTANT_ALLOWED_MODELS.split(",").map((item) => item.trim()))]
    .filter((item): item is AssistantModel => ASSISTANT_MODELS.includes(item as AssistantModel));
}

function workspaceCapabilities(path: string): { organizationId: string; capabilities: readonly FormaCapability[] } | null {
  const match = path.match(/^\/settings\/workspaces\/([^/]+)(?:\/([^/]+))?$/);
  if (!match || match[1] === "invitations") return null;
  let organizationId = "";
  try { organizationId = decodeURIComponent(match[1]); } catch { return { organizationId: "", capabilities: [] }; }
  const section = match[2] ?? "overview";
  const capabilities: readonly FormaCapability[] = section === "members" ? ["workspace.member.read", "workspace.member.manage"]
    : section === "projects" ? ["workspace.project.read", "workspace.project.manage"]
    : section === "usage" ? ["workspace.usage.read", "workspace.budget.manage"]
    : section === "activity" ? ["workspace.audit.read", "workspace.policy.manage"]
    : ["workspace.member.read", "workspace.project.read", "workspace.usage.read", "workspace.audit.read"];
  return { organizationId, capabilities };
}

async function observedContextFirst<T>(env:WorkerEnv,sql:string,bindings:readonly (string|number|null)[],source?:AssistantContextReadWitness){
  const statement=env.DB.prepare(sql).bind(...bindings);
  if(!source)return statement.first<T>();
  const rows=await statement.all<Record<string,unknown>>();source.observe([statement],[rows],[{sql,bindings}]);
  return(rows.results[0]??null) as T|null;
}

async function authorizeAssistant(request: Request, env: WorkerEnv, source?:AssistantContextReadWitness): Promise<{ authorized: AuthorizedAssistant | null; response: Response | null }> {
  const auth = await requireUser(request, env, "viewer", { account: "principal" });
  if (auth.response || !auth.user) return { authorized: null, response: auth.response ?? json({ error: "authentication_required" }, 401) };
  const principal = auth.user;
  const consent = requireConsent(principal);
  if (consent) return { authorized: null, response: consent };
  const url = new URL(request.url);
  const route = url.searchParams.get("route") ?? "";
  if (!route.startsWith("/") || route.startsWith("//")) return { authorized: null, response: json({ error: "assistant_route_invalid" }, 400) };
  const surface = assistantSurfaceForRoute(route);
  if (!surface.available || surface.host !== "creator") return { authorized: null, response: json({ error: "assistant_surface_denied" }, 403) };
  const selected = await readProjectRequestContext(request, env, principal);
  if (selected.response) return { authorized: null, response: selected.response };
  let project = selected.context;
  let scope = project ? { organizationId: project.organizationId, projectAccessId: project.projectAccessId } : undefined;
  if (project && !hasCapability(principal, "project.read", scope)) return { authorized: null, response: json({ error: "assistant_project_denied" }, 403) };
  if (surface.application === "canvas") {
    const governance = await readCanvasGovernance(env, principal.role);
    if (!governance.access || project && !hasCapability(principal, "project.canvas.use", scope)) return { authorized: null, response: json({ error: "assistant_canvas_denied" }, 403) };
  }
  const workspace = workspaceCapabilities(surface.route);
  if (workspace && project && project.organizationId !== workspace.organizationId) {
    return { authorized: null, response: json({ error: "assistant_workspace_project_mismatch" }, 403) };
  }
  if (workspace && (!workspace.organizationId || !workspace.capabilities.some((capability) => hasCapability(principal, capability, { organizationId: workspace.organizationId })))) {
    return { authorized: null, response: json({ error: "assistant_workspace_denied" }, 403) };
  }
  const requestedProjectId = url.searchParams.get("projectId")?.trim() ?? "";
  if (project && requestedProjectId && requestedProjectId !== project.projectId) return { authorized: null, response: json({ error: "assistant_project_mismatch" }, 403) };
  let projectId = project?.projectId ?? null;
  if (!project && requestedProjectId) {
    const owned = await observedContextFirst(env,"SELECT 1 AS authorized FROM events WHERE stream_id=? AND type='ProjectCreated' AND json_extract(payload,'$.project_id')=? LIMIT 1",
      [principal.streamId, requestedProjectId],source);
    if (!owned) return { authorized: null, response: json({ error: "assistant_project_denied" }, 403) };
    projectId = requestedProjectId;
  }
  if (surface.documentId) {
    if (project) {
      const resource = await observedContextFirst(env,"SELECT 1 AS authorized FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND resource_kind='document' AND resource_id=? LIMIT 1",
        [project.projectAccessId, project.organizationId, project.projectId, project.ownerUserId, surface.documentId],source);
      if (!resource) return { authorized: null, response: json({ error: "assistant_document_denied" }, 403) };
    } else {
      const resource = await observedContextFirst<{project_id:string}>(env,`SELECT COALESCE(json_extract(document.payload,'$.project_id'),
        (SELECT json_extract(project.payload,'$.project_id') FROM events project WHERE project.stream_id=document.stream_id
          AND project.sequence<=document.sequence AND project.type IN('ProjectCreated','ProjectOpened') ORDER BY project.sequence DESC LIMIT 1)) AS project_id
        FROM events document WHERE document.stream_id=? AND document.type='DocumentCreated' AND json_extract(document.payload,'$.document_id')=? LIMIT 1`,
        [principal.streamId, surface.documentId],source);
      if (!resource || projectId && String(resource.project_id) !== projectId) return { authorized: null, response: json({ error: "assistant_document_denied" }, 403) };
      projectId = String(resource.project_id);
    }
  }
  let legacyScopeKey:string|undefined;
  if(!project&&projectId){
    const custody=await resolveOwnerExecutionScope(env,principal,surface.documentId??"",projectId,"read");
    if(custody.denied)return{authorized:null,response:json({error:"assistant_project_custody_unavailable"},403)};
    if(custody.scope){
      legacyScopeKey=assistantScopeKey({principal,project:null,surface,projectId,canPropose:false});
      scope={organizationId:custody.scope.organizationId,projectAccessId:custody.scope.projectAccessId};
      project={contextId:"",organizationId:custody.scope.organizationId,projectAccessId:custody.scope.projectAccessId,projectId,ownerUserId:custody.scope.ownerUserId,principalUserId:principal.userId,role:"owner",permissions:principal.access.capabilities.filter(capability=>hasCapability(principal,capability,custody.scope)),expiresAt:""};
      if(workspace&&workspace.organizationId!==project.organizationId)return{authorized:null,response:json({error:"assistant_workspace_project_mismatch"},403)};
    }
  }
  return { authorized: { principal, project, surface, projectId, canPropose: scope?hasCapability(principal,"project.author",scope):principal.access.capabilities.includes("project.author"),...(legacyScopeKey?{legacyScopeKey}:{}) }, response: null };
}

async function scopedAssistantEvents(env: WorkerEnv, actor: AuthorizedAssistant, source?:AssistantContextReadWitness) {
  if (actor.project) {
    const headRow = await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=?")
      .bind(actor.project.projectAccessId, actor.project.organizationId).first<{ head: number }>();
    const head = Number(headRow?.head ?? 0);
    const state = await readProjectAssistantEventView(env, actor.project, { documentId: actor.surface.documentId, canvasId: actor.surface.canvasId,sourceObserver:source?.observe });
    const recent = await readProjectEventPage(env, actor.project, Math.max(0, head - 32), 32, false,source?.observe);
    if(source){
      const descriptor:AssistantContextReadDescriptor={sql:"SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?",bindings:[`creative:${actor.project.ownerUserId}`],role:"owner-head",streamId:`creative:${actor.project.ownerUserId}`};
      const statement=env.DB.prepare(descriptor.sql).bind(...descriptor.bindings);
      source.observe([statement],[await statement.all<Record<string,unknown>>()],[descriptor]);
      source.require(projectSourceProjectionCurrentAssertion(actor.project),own=>projectSourceProjectionCurrentAssertion(actor.project!,own),
        own=>projectStructuredSourceProjectionCurrentAssertion(actor.project!,own));
    }
    return [...new Map([...state, ...recent.events].map((event) => [event.eventId, event])).values()]
      .filter((event) => event.type !== "ProjectResourceRestricted")
      .sort((left, right) => left.sequence - right.sequence) as CreativeEvent[];
  }
  let head:number;
  if(source){
    const descriptor:AssistantContextReadDescriptor={sql:"SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?",bindings:[actor.principal.streamId],role:"owner-head",streamId:actor.principal.streamId};
    const statement=env.DB.prepare(descriptor.sql).bind(...descriptor.bindings);
    const result=await statement.all<Record<string,unknown>>();source.observe([statement],[result],[descriptor]);head=Number(result.results[0]?.head??0);
  }else head=await streamHead(env, actor.principal.streamId);
  const documentId = actor.surface.documentId ?? "", canvasId = actor.surface.canvasId ?? "", projectId = actor.projectId ?? "";
  const joins = "FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL";
  const selected=source?"event.*,secret.private_json,CASE WHEN secret.private_event_id IS NULL THEN NULL ELSE json_array(secret.private_event_id,secret.owner_id,secret.project_id,secret.document_id,secret.created_at,secret.redacted_at) END AS source_private_record":"event.*,secret.private_json";
  const documentProject = "COALESCE(json_extract(event.payload,'$.project_id'),(SELECT json_extract(previous.payload,'$.project_id') FROM events previous WHERE previous.stream_id=event.stream_id AND previous.sequence<=event.sequence AND previous.type IN('ProjectCreated','ProjectOpened') ORDER BY previous.sequence DESC LIMIT 1))";
  const eventDocument = "COALESCE(json_extract(event.payload,'$.document_id'),(SELECT json_extract(previous.payload,'$.document_id') FROM events previous WHERE previous.stream_id=event.stream_id AND previous.sequence<=event.sequence AND previous.type IN('DocumentCreated','DocumentOpened') ORDER BY previous.sequence DESC LIMIT 1))";
  const bootstrap:AssistantContextReadDescriptor = {sql:`SELECT ${selected} ${joins} WHERE event.stream_id=?
    AND(event.type IN('ProjectCreated','ProjectOpened','ProjectRenamed') AND(?='' OR json_extract(event.payload,'$.project_id')=?)
      OR event.type IN('DocumentCreated','DocumentForked','DocumentRenamed','DocumentRemoved','DocumentRestored')
        AND((?<>'' AND json_extract(event.payload,'$.document_id')=?) OR(?='' AND(?='' OR ${documentProject}=?)))
      OR event.type IN('CanvasCreated','CanvasRenamed','CanvasRemoved','CanvasRestored') AND(?='' OR json_extract(event.payload,'$.canvas_id')=?) AND(?='' OR json_extract(event.payload,'$.project_id')=?))
    ORDER BY event.sequence DESC LIMIT 128`,bindings:[actor.principal.userId, actor.principal.streamId, projectId, projectId, documentId, documentId, documentId, projectId, projectId, canvasId, canvasId, projectId, projectId]};
  const semantic:AssistantContextReadDescriptor = {sql:`SELECT ${selected} ${joins} WHERE event.stream_id=? AND event.type IN(${ASSISTANT_STATE_EVENT_SQL})
    AND((?='' AND ?='') AND(?='' OR json_extract(event.payload,'$.project_id')=? OR event.type='DocumentCreated' AND ${documentProject}=?)
      OR ${eventDocument}=? OR json_extract(event.payload,'$.canvas_id')=? OR json_extract(event.payload,'$.source_canvas_id')=?
      OR event.type IN('ProjectCreated','ProjectOpened','ProjectRenamed') AND json_extract(event.payload,'$.project_id')=?)
    ORDER BY event.sequence DESC LIMIT 384`,bindings:[actor.principal.userId, actor.principal.streamId, documentId, canvasId, projectId, projectId, projectId, documentId, canvasId, canvasId, projectId]};
  const boundaries:AssistantContextReadDescriptor = {sql:`SELECT ${selected} ${joins} WHERE event.stream_id=? AND event.type='BlockCreated'
    AND(?='' OR ${eventDocument}=?)
    AND(json_extract(event.payload,'$.type')='exclusion' OR json_extract(secret.private_json,'$.properties.intent')='prohibit' OR json_extract(secret.private_json,'$.properties.locked')=1)
    ORDER BY event.sequence DESC LIMIT 32`,bindings:[actor.principal.userId, actor.principal.streamId, documentId, documentId]};
  const latest:AssistantContextReadDescriptor = {sql:`SELECT ${selected} ${joins} WHERE event.stream_id=? AND event.sequence>? ORDER BY event.sequence ASC LIMIT 32`,
    bindings:[actor.principal.userId, actor.principal.streamId, Math.max(0, head - 32)],role:"ascending-events"};
  const descriptors=[bootstrap,semantic,boundaries,latest];
  const statements=descriptors.map(item=>env.DB.prepare(item.sql).bind(...item.bindings));
  const results = await env.DB.batch<Record<string, unknown>>(statements);
  source?.observe(statements,results,descriptors);
  return [...new Map(results.flatMap((result) => result.results).map((row) => { const event = serializeEvent(row); return [event.eventId, event]; })).values()]
    .sort((left, right) => left.sequence - right.sequence) as CreativeEvent[];
}

function actionKey(action: AssistantContextAction) {
  return action.kind === "context.create" ? "assistant.action.createDecision"
    : action.kind === "context.edit" ? "assistant.action.editDecision"
    : action.kind === "context.remove" ? "assistant.action.removeDecision"
    : action.kind === "context.relation.add" ? "assistant.action.addRelation"
    : "assistant.action.removeRelation";
}

function actionSummary(action: AssistantContextAction, context: AssistantContext) {
  if (action.kind === "context.create" || action.kind === "context.edit") return action.text.slice(0, 600);
  if (action.kind === "context.remove") return context.decisionAtoms.find((item) => item.id === action.targetBlockId)?.text.slice(0, 320) ?? "";
  const from = context.decisionAtoms.find((item) => item.id === action.fromBlockId)?.text.slice(0, 120) ?? "";
  const to = context.decisionAtoms.find((item) => item.id === action.toBlockId)?.text.slice(0, 120) ?? "";
  return `${from} → ${to}`;
}

function prepareTypedAssistantActions(actions: AssistantContextAction[], context: AssistantContext, turnId: string): PreparedAssistantAction[] {
  return actions.map((action) => {
    const targetIds = action.kind === "context.edit" || action.kind === "context.remove" ? [action.targetBlockId]
      : action.kind === "context.relation.add" || action.kind === "context.relation.remove" ? [action.fromBlockId, action.toBlockId] : [];
    const protectedIds = context.decisionAtoms.filter((item) => item.protected || item.locked || item.immutable || item.intent === "prohibit").map((item) => item.id);
    const ids = new Set([...targetIds, ...protectedIds]);
    const sourceVersions = context.decisionAtoms.filter((item) => ids.has(item.id)).map((item) => ({ blockId: item.id, version: item.version }));
    return { id: uuidV7(), turnId, action, key: actionKey(action), summary: actionSummary(action, context), sourceVersions };
  });
}

function preparedAssistantActions(message: string, context: AssistantContext, turnId: string): PreparedAssistantAction[] {
  return prepareTypedAssistantActions(normalizeAssistantActions(message, context), context, turnId);
}

const assistantProposalSourceRecord="json_array(proposal.proposal_id,proposal.actor_user_id,proposal.scope_key,proposal.turn_id,proposal.organization_id,proposal.project_access_id,proposal.project_id,proposal.document_id,proposal.action_kind,proposal.action_content_ref,proposal.source_versions_json,proposal.expected_head,proposal.permission_epoch,proposal.status,proposal.expires_at,content.owner_id,content.kind,content.content,content.expires_at)";

function encodedAssistantProposals(actions:PreparedAssistantAction[],proposal:AssistantProposal|null){
  return actions.length?JSON.stringify({proposals:actions.map(({id,turnId,key,action})=>({id,turnId,key,kind:action.kind}))})
    :proposal?JSON.stringify(proposal):null;
}

async function pendingTurnProposals(env: WorkerEnv, actor: AuthorizedAssistant, turnId: string, raw: string | null,sourceRecords?:string[],freshActions?:PreparedAssistantAction[]): Promise<AssistantProposal[]> {
  if (!raw) return [];
  let metadata: AssistantProposal[];
  try {
    const parsed = JSON.parse(raw) as AssistantProposal | { proposals?: AssistantProposal[] };
    metadata = Array.isArray((parsed as { proposals?: AssistantProposal[] }).proposals)
      ? (parsed as { proposals: AssistantProposal[] }).proposals
      : [parsed as AssistantProposal];
  } catch { return []; }
  if (!metadata.some((proposal) => proposal.kind !== "navigate")) return metadata.filter((proposal) => proposal.kind === "navigate");
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`SELECT proposal.proposal_id,proposal.action_kind,proposal.source_versions_json,content.content,${assistantProposalSourceRecord} AS source_record
    FROM assistant_action_proposals proposal JOIN private_content content
      ON content.content_id=proposal.action_content_ref AND content.owner_id=proposal.actor_user_id
        AND content.redacted_at IS NULL AND content.expires_at>?
    WHERE proposal.actor_user_id=? AND proposal.scope_key=? AND proposal.turn_id=?
      AND proposal.status='pending' AND proposal.expires_at>?
    ORDER BY proposal.created_at,proposal.proposal_id`).bind(now, actor.principal.userId, assistantScopeKey(actor), turnId, now)
    .all<{ proposal_id: string; action_kind: string; source_versions_json:string;content: string;source_record:string }>();
  const pending = new Map(rows.results.map((row) => [String(row.proposal_id), row]));
  return metadata.flatMap((proposal) => {
    if (proposal.kind === "navigate") return [proposal];
    const row = pending.get(proposal.id);
    if (!row || row.action_kind !== proposal.kind) return [];
    try {
      const action = JSON.parse(row.content) as AssistantContextAction;
      if (action.kind !== proposal.kind) return [];
      const fresh=freshActions?.find(item=>item.id===proposal.id);
      if(freshActions&&(!fresh||fresh.turnId!==proposal.turnId||fresh.key!==proposal.key||fresh.action.kind!==proposal.kind
        ||JSON.stringify(fresh.action)!==row.content||JSON.stringify(fresh.sourceVersions)!==row.source_versions_json))return[];
      // Fresh summary prose is request-local presentation, not a stored memory or
      // a claim about current document text. Never attach it to a changed action.
      const summary = fresh?fresh.summary:action.kind === "context.create" || action.kind === "context.edit" ? String(action.text ?? "").slice(0, 600) : "";
      sourceRecords?.push(row.source_record);
      return [{ ...proposal, ...(summary ? { summary } : {}) }];
    } catch { return []; }
  });
}

function assistantProposalSourceProof(actor:AuthorizedAssistant,records:string[]):BudgetReservationGuard{
  if(!records.length)return{sql:"1",bindings:[]};
  const custody=assistantTurnContentCustody(actor,"authored");
  return{sql:`NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
    SELECT 1 FROM assistant_action_proposals proposal JOIN private_content content
      ON content.content_id=proposal.action_content_ref AND content.owner_id=proposal.actor_user_id
      AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE proposal.proposal_id=json_extract(expected.value,'$[0]') AND proposal.status='pending'
      AND proposal.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${assistantProposalSourceRecord}=expected.value
      AND ${custody.sql.replaceAll("authored.","content.")}))`,bindings:[JSON.stringify(records),...custody.bindings]};
}

const assistantHistoryTurnRecord="json_array(turn.actor_user_id,turn.scope_key,turn.turn_id,turn.organization_id,turn.project_access_id,turn.project_id,turn.document_id,turn.user_content_ref,turn.assistant_content_ref,turn.proposal_json,turn.request_json)";
const assistantHistoryEventRecord=(alias:"message"|"response")=>"json_array("+["event_id","stream_id","sequence","type","actor","correlation_id","payload"].map(column=>alias+"."+column).join(",")+")";
const assistantHistoryContentSources="authored.content_id AS source_user_ref,answer.content_id AS source_answer_ref";
const assistantHistoryEventSources="message.event_id AS source_message_id,response.event_id AS source_response_id,"+assistantHistoryEventRecord("message")+" AS source_message_record,"+assistantHistoryEventRecord("response")+" AS source_response_record";
const assistantTurnOrder=new WeakMap<AssistantTurn,string>();
const assistantMemoryRequests=new WeakMap<AssistantTurn,string|null>();
const assistantMemoryOriginIds=new WeakMap<AssistantTurn,string>();
async function ordinaryAssistantExclusion(env:WorkerEnv,turnAlias?:"turn"|"metadata"):Promise<BudgetReservationGuard>{
  const [answer,authored]=await Promise.all([nativeMemoryAnswerExclusion(env,{answerAlias:"answer",turnAlias}),
    nativeMemoryAnswerExclusion(env,{answerAlias:"authored"})]);
  return{sql:`(${answer.sql}) AND (${authored.sql})`,bindings:[...answer.bindings,...authored.bindings]};
}

/** A retired marked turn is not a new empty slot. Do not attempt to derive or
 * overwrite another answer for its old id when its origin is unavailable. */
async function unavailableNativeMemoryTurn(env:WorkerEnv,actor:AuthorizedAssistant,turnId:string):Promise<boolean>{
  const exclusion=await ordinaryAssistantExclusion(env,"turn");
  if(await env.DB.prepare(`SELECT 1 AS marked FROM assistant_turns turn
    LEFT JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id
    LEFT JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id
    WHERE turn.actor_user_id=? AND turn.scope_key=? AND turn.turn_id=? AND NOT(${exclusion.sql}) LIMIT 1`)
    .bind(actor.principal.userId,assistantScopeKey(actor),turnId,...exclusion.bindings).first())return true;
  // Erasure may remove the turn row while retaining its immutable event marker
  // or origin tombstone. That historical id must not become a new write slot.
  const marker=await nativeMemoryAnswerExclusion(env,{answerAlias:"answer",turnAlias:"turn"});
  return Boolean(await env.DB.prepare(`WITH turn AS(SELECT ? AS actor_user_id,? AS scope_key,? AS turn_id,? AS project_id,? AS document_id,? AS organization_id,? AS project_access_id),
    answer AS(SELECT NULL AS content_id,'chat-assistant' AS kind)
    SELECT 1 AS marked FROM turn,answer WHERE NOT(${marker.sql}) LIMIT 1`)
    .bind(actor.principal.userId,assistantScopeKey(actor),turnId,actor.projectId,actor.surface.documentId??null,actor.project?.organizationId??null,actor.project?.projectAccessId??null,...marker.bindings).first());
}

type MemoryTurnRow=AssistantTurnRow&{origin_id:string;answer_event_id:string;answer_content_id:string};
/** Marked history has its own dependency witness, never the ordinary chat lane.
 * Even when the feature is disabled, no marked bytes fall back to plain history. */
async function nativeMemoryAssistantTurnsForProtocol(env:WorkerEnv,actor:AuthorizedAssistant,version:1|2,turnId?:string):Promise<AssistantTurn[]>{
  try{
  if(!liveMemoryEnabled(env,actor.principal.userId)||!actor.surface.documentId||!actor.projectId)return[];
  const schema=await env.DB.prepare(version===1
    ?"SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name IN('memory_native_answer_origins','memory_native_answer_dependencies')"
    :"SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name IN('memory_structured_answer_origins','memory_structured_answer_originals','memory_structured_answer_ledger_revisions')").first<{count:number}>();
  if(schema?.count!==(version===1?2:3))return[];
  const originTable=version===1?"memory_native_answer_origins":"memory_structured_answer_origins";
  const baseSql=`SELECT turn.turn_id,turn.proposal_json,turn.request_json,turn.created_at AS source_created_at,origin.answer_source_sequence AS source_sequence,
    authored.content AS user_content,answer.content AS assistant_content,origin.origin_id,origin.answer_event_id,origin.answer_content_id
    FROM assistant_turns turn JOIN ${originTable} origin ON origin.actor_user_id=turn.actor_user_id
      AND origin.scope_key=turn.scope_key AND origin.turn_id=turn.turn_id AND origin.answer_content_id=turn.assistant_content_ref
    JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.kind='chat-user'
    JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.kind=?
    JOIN events response ON response.event_id=origin.answer_event_id AND json_extract(response.payload,'$.memory_origin_version')=${version}
    WHERE turn.actor_user_id=? AND turn.scope_key=? AND turn.document_id=?`;
  const baseBindings=[NATIVE_MEMORY_ANSWER_KIND,actor.principal.userId,assistantScopeKey(actor),actor.surface.documentId];
  const selected=await env.DB.prepare(baseSql+`${turnId?" AND turn.turn_id=?":""} ORDER BY origin.answer_source_sequence DESC,turn.turn_id DESC LIMIT ?`)
    .bind(...baseBindings,...(turnId?[turnId]:[]),turnId?2:ASSISTANT_CONTEXT_LIMITS.turns).all<MemoryTurnRow>();
  if(!selected.success||turnId&&selected.results.length!==1)return[];
  const result:AssistantTurn[]=[];
  for(const candidate of selected.results){
    const exact={sql:baseSql+" AND turn.turn_id=? AND origin.origin_id=? LIMIT 2",bindings:[...baseBindings,candidate.turn_id,candidate.origin_id]};
    const statement=env.DB.prepare(exact.sql).bind(...exact.bindings);
    const rows=structuredClone(await statement.all<MemoryTurnRow>());
    if(!rows.success||rows.results.length!==1)continue;
    const row=rows.results[0]!;
    if(row.proposal_json!==null)continue;
    const witness=new AssistantContextReadWitness<AssistantTurn>(env);
    witness.observe([statement],[rows as D1Result<Record<string,unknown>>],[exact]);
    const target={originId:row.origin_id,turnId:row.turn_id,answerEventId:row.answer_event_id,answerContentId:row.answer_content_id,answer:row.assistant_content};
    const structuredRetained=version===2?await revalidateNativeStructuredAnswerOrigin(env,assistantMemoryPreparedDocument(actor),target,witness):null;
    const retained=version===1?await revalidateNativeAnswerOrigin(env,assistantMemoryPreparedDocument(actor),target,witness):structuredRetained;
    if(!retained)continue;
    const turn:AssistantTurn={id:row.turn_id,user:row.user_content,reply:{text:row.assistant_content},proposal:null,
      memory:{...(version===1?{version:"native-memory-answer-v1" as const,method:"extractive-not-semantic" as const}
        :{version:"native-memory-answer-v2" as const,method:"structured-not-semantic" as const}),checkedAt:new Date().toISOString(),validUntil:retained.validUntil}};
    if(Date.parse(turn.memory!.checkedAt)>=Date.parse(retained.validUntil))continue;
    witness.seal(turn);if(!witness.statements().length)continue;
    assistantTurnOrder.set(turn,String(row.source_sequence).padStart(20,"0"));
    assistantMemoryRequests.set(turn,row.request_json??null);
    assistantMemoryOriginIds.set(turn,row.origin_id);
    const retainedSource=structuredRetained?{
      statements(){
        const observed=witness.statements(),native=nativeStructuredMemoryOriginReadStatements(env,structuredRetained);
        return observed.length&&native?.length?[...observed,...native]:[];
      },
      matches(results:readonly D1Result<Record<string,unknown>>[]){
        const observed=witness.statements(),native=nativeStructuredMemoryOriginReadStatements(env,structuredRetained);
        return Boolean(observed.length&&native?.length&&results.length===observed.length+native.length
          &&witness.matches(results.slice(0,observed.length))
          &&nativeStructuredMemoryOriginReadMatches(env,structuredRetained,results.slice(observed.length)));
      },
    }:witness;
    result.push(rememberAssistantMemoryTurnSource(turn,retainedSource));
  }
  return result.reverse();
  }catch{return[];}
}

async function nativeMemoryAssistantTurns(env:WorkerEnv,actor:AuthorizedAssistant,turnId?:string):Promise<AssistantTurn[]>{
  const remembered=[...await nativeMemoryAssistantTurnsForProtocol(env,actor,1,turnId),...await nativeMemoryAssistantTurnsForProtocol(env,actor,2,turnId)];
  // A same-turn cross-protocol collision never picks a preferred set of bytes.
  // Each reader also proves the negative other-protocol claim for its origin.
  const unique=remembered.filter(item=>remembered.filter(other=>other.id===item.id).length===1);
  return unique.sort((left,right)=>(assistantTurnOrder.get(left)??"").localeCompare(assistantTurnOrder.get(right)??"")).slice(-ASSISTANT_CONTEXT_LIMITS.turns);
}

async function withNativeMemoryAssistantTurns(env:WorkerEnv,actor:AuthorizedAssistant,ordinary:AssistantTurn[]):Promise<AssistantTurn[]>{
  const remembered=await nativeMemoryAssistantTurns(env,actor);
  return [...ordinary,...remembered].sort((left,right)=>(assistantTurnOrder.get(left)??"").localeCompare(assistantTurnOrder.get(right)??""))
    .slice(-ASSISTANT_CONTEXT_LIMITS.turns);
}

/** A committed send advances the head captured by prior memory display proofs.
 * Reissue only those bounded historical reads; never rebase the new derivation. */
async function refreshAssistantMemoryHistory(env:WorkerEnv,actor:AuthorizedAssistant,
  state:{context:AssistantContext;turns:AssistantTurn[]}):Promise<{context:AssistantContext;turns:AssistantTurn[]}>{
  const context=state.context,history=[...state.turns],turns:AssistantTurn[]=[];
  const semantics=(turn:AssistantTurn)=>JSON.stringify({...turn,
    memory:turn.memory?{version:turn.memory.version,method:turn.memory.method}:undefined});
  for(const previous of history){
    if(previous.memory?.version!=="native-memory-answer-v2"){turns.push(previous);continue;}
    const originId=assistantMemoryOriginIds.get(previous),request=assistantMemoryRequests.get(previous),expected=semantics(previous);
    // A new object deliberately has no private source association. If its
    // original origin no longer validates, final proof filtering retires its ID.
    const unavailable={...previous};
    const candidates=await nativeMemoryAssistantTurns(env,actor,previous.id),current=candidates.length===1?candidates[0]:undefined;
    turns.push(originId&&request!==undefined&&current&&assistantMemoryOriginIds.get(current)===originId
      &&assistantMemoryRequests.get(current)===request&&semantics(current)===expected?current:unavailable);
  }
  return{context,turns};
}

/** Recheck the exact hydrated source in its original custody lane inside the final SELECT-only snapshot. */
function assistantHistorySourceProof(actor:AuthorizedAssistant,row:AssistantTurnRow,sourceCustody:BudgetReservationGuard,scopeKey=assistantScopeKey(actor),exclusion:BudgetReservationGuard={sql:"1",bindings:[]}):BudgetReservationGuard{
  if(!row.source_user_ref||!row.source_answer_ref)return{sql:"0",bindings:[]};
  const table=typeof row.source_turn_record==="string";
  if(!table&&(!row.source_message_id||!row.source_response_id||!row.source_message_record||!row.source_response_record))return{sql:"0",bindings:[]};
  const expected=JSON.stringify({actor:actor.principal.userId,scopeKey,turnId:row.turn_id,userRef:row.source_user_ref,answerRef:row.source_answer_ref,
    user:String(row.user_content),reply:String(row.assistant_content),turn:row.source_turn_record??null,messageId:row.source_message_id??null,responseId:row.source_response_id??null,
    message:row.source_message_record??null,response:row.source_response_record??null,metadata:row.source_metadata_record??null});
  const source=table?`JOIN assistant_turns turn ON turn.actor_user_id=json_extract(expected.value,'$.actor')
      AND turn.scope_key=json_extract(expected.value,'$.scopeKey') AND turn.turn_id=json_extract(expected.value,'$.turnId')`
    :`JOIN events message ON message.event_id=json_extract(expected.value,'$.messageId')
      JOIN events response ON response.event_id=json_extract(expected.value,'$.responseId') AND response.stream_id=message.stream_id AND response.correlation_id=message.correlation_id`;
  const metadata=!table&&row.source_metadata_checked===1?`LEFT JOIN assistant_turns metadata ON metadata.actor_user_id=json_extract(expected.value,'$.actor')
    AND metadata.scope_key=json_extract(expected.value,'$.scopeKey') AND metadata.turn_id=json_extract(expected.value,'$.turnId')`:"";
  const metadataExact=metadata?` AND (CASE WHEN metadata.turn_id IS NULL THEN NULL ELSE ${assistantHistoryTurnRecord.replaceAll("turn.","metadata.")} END) IS json_extract(expected.value,'$.metadata')`:"";
  const exact=table?`${assistantHistoryTurnRecord}=json_extract(expected.value,'$.turn') AND turn.user_content_ref=authored.content_id AND turn.assistant_content_ref=answer.content_id`
    :`${assistantHistoryEventRecord("message")}=json_extract(expected.value,'$.message') AND ${assistantHistoryEventRecord("response")}=json_extract(expected.value,'$.response')
      AND json_extract(message.payload,'$.content_ref')=authored.content_id AND json_extract(response.payload,'$.content_ref')=answer.content_id`;
  return{sql:`EXISTS(SELECT 1 FROM(SELECT ? AS value) expected ${source} ${metadata}
    JOIN private_content authored ON authored.content_id=json_extract(expected.value,'$.userRef') AND authored.owner_id=json_extract(expected.value,'$.actor')
      AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN private_content answer ON answer.content_id=json_extract(expected.value,'$.answerRef') AND answer.owner_id=json_extract(expected.value,'$.actor')
      AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE ${exact}${metadataExact} AND authored.content=json_extract(expected.value,'$.user') AND answer.content=json_extract(expected.value,'$.reply') AND (${sourceCustody.sql}) AND (${exclusion.sql}))`,
    bindings:[expected,...sourceCustody.bindings,...exclusion.bindings]};
}

async function assistantTurnFromRow(env: WorkerEnv, actor: AuthorizedAssistant, row: AssistantTurnRow,sourceProof?:BudgetReservationGuard,presentation?:AssistantReply,freshActions?:PreparedAssistantAction[]): Promise<AssistantTurn> {
  const proposalSources:string[]=[];
  const proposals = await pendingTurnProposals(env, actor, String(row.turn_id), row.proposal_json,sourceProof?proposalSources:undefined,freshActions);
  let originalRequest:unknown;try{if(row.request_json)originalRequest=JSON.parse(row.request_json);}catch{/* Old free history may lack a reviewable request snapshot. */}
  const turn:AssistantTurn={
    id: String(row.turn_id),
    user: String(row.user_content),
    reply: presentation ?? { text: String(row.assistant_content) },
    proposal: proposals[0] ?? null,
    ...(proposals.length > 1 ? { proposals } : {}),
    ...(originalRequest?{originalRequest}:{}),
  };
  assistantTurnOrder.set(turn,Number.isSafeInteger(row.source_sequence)?String(row.source_sequence).padStart(20,"0"):row.source_created_at??"");
  if(!sourceProof)return turn;
  const proposalProof=freshActions&&proposals.filter(proposal=>proposal.kind!=="navigate").length!==freshActions.length
    ?{sql:"0",bindings:[]}:assistantProposalSourceProof(actor,proposalSources);
  return rememberAssistantFeedTurnSource(turn,{sql:`(${sourceProof.sql}) AND (${proposalProof.sql})`,bindings:[...sourceProof.bindings,...proposalProof.bindings]});
}

async function recentAssistantTurns(env: WorkerEnv, actor: AuthorizedAssistant,generationTurns?:AssistantTurn[]): Promise<AssistantTurn[]> {
  const replyProof=assistantPaidReplyReadGuard(actor,assistantScopeKey(actor),actor.surface.documentId?"json_extract(message.payload,'$.turn_id')":"turn.turn_id");
  const authoredCustody=assistantTurnContentCustody(actor,"authored"),answerCustody=assistantTurnContentCustody(actor,"answer");
  if (!actor.surface.documentId) {
    const exclusion=await ordinaryAssistantExclusion(env,"turn");
    const rows = await env.DB.prepare(`SELECT turn.turn_id,turn.proposal_json,turn.request_json,turn.created_at AS source_created_at,authored.content AS user_content,answer.content AS assistant_content,
      ${assistantHistoryContentSources},${assistantHistoryTurnRecord} AS source_turn_record
      FROM assistant_turns turn
      JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>?
      JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>?
      WHERE turn.actor_user_id=? AND turn.scope_key=? AND ${authoredCustody.sql} AND ${answerCustody.sql} AND (${exclusion.sql}) AND (${replyProof.sql})
      ORDER BY turn.created_at DESC LIMIT ?`)
      .bind(new Date().toISOString(), new Date().toISOString(), actor.principal.userId, assistantScopeKey(actor),...authoredCustody.bindings,...answerCustody.bindings,...exclusion.bindings,...replyProof.bindings, ASSISTANT_CONTEXT_LIMITS.turns)
      .all<AssistantTurnRow>();
    const sourceCustody={sql:`(${authoredCustody.sql}) AND (${answerCustody.sql})`,bindings:[...authoredCustody.bindings,...answerCustody.bindings]};
    const turns=await Promise.all(rows.results.reverse().map((row) => assistantTurnFromRow(env, actor, row,assistantHistorySourceProof(actor,row,sourceCustody,undefined,exclusion))));
    generationTurns?.push(...turns);return turns;
  }

  const scope = actor.project;
  const now = new Date().toISOString();
  const stream = scope ? `creative:${scope.ownerUserId}` : actor.principal.streamId;
  let guard = "";
  const bindings: string[] = [];
  if (scope) {
    for (const [kind, alias] of [["event", "message"], ["event", "response"], ["content", "authored"], ["content", "answer"]] as const) {
      guard += kind === "event"
        ? ` AND EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=${alias}.event_id AND custody.project_access_id=? AND custody.organization_id=? AND custody.project_id=? AND custody.owner_user_id=? AND custody.actor_user_id=?)`
        : ` AND EXISTS(SELECT 1 FROM project_resource_scopes custody WHERE custody.resource_kind='content' AND custody.resource_id=${alias}.content_id AND custody.project_access_id=? AND custody.organization_id=? AND custody.project_id=? AND custody.owner_user_id=? AND custody.actor_user_id=? AND custody.visibility='actor_private')`;
      bindings.push(scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, actor.principal.userId);
    }
    for (const alias of ["authored", "answer"] as const) {
      guard += ` AND EXISTS(SELECT 1 FROM private_content_retention_scopes custody WHERE custody.content_id=${alias}.content_id AND custody.organization_id=? AND custody.project_access_id=? AND custody.project_id=? AND custody.actor_user_id=?)`;
      bindings.push(scope.organizationId, scope.projectAccessId, scope.projectId, actor.principal.userId);
    }
  } else {
    guard = " AND "+authoredCustody.sql+" AND "+answerCustody.sql;
  }

  const exclusion=await ordinaryAssistantExclusion(env,"metadata");
  const rows = await env.DB.prepare(`SELECT json_extract(message.payload,'$.turn_id') AS turn_id,metadata.proposal_json,metadata.request_json,message.recorded_at AS source_created_at,message.sequence AS source_sequence,authored.content AS user_content,answer.content AS assistant_content,
    ${assistantHistoryContentSources},${assistantHistoryEventSources},1 AS source_metadata_checked,
    CASE WHEN metadata.turn_id IS NULL THEN NULL ELSE ${assistantHistoryTurnRecord.replaceAll("turn.","metadata.")} END AS source_metadata_record
    FROM events message INDEXED BY idx_events_stream_type
    JOIN private_content authored ON authored.content_id=json_extract(message.payload,'$.content_ref') AND authored.owner_id=?
      AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>?
    JOIN events response INDEXED BY idx_events_correlation ON response.correlation_id=message.correlation_id AND response.stream_id=message.stream_id
      AND response.type='AssistantReasoned' AND json_extract(response.payload,'$.operation')='creative-chat'
      AND json_extract(response.payload,'$.document_id')=? AND json_extract(response.payload,'$.turn_id')=json_extract(message.payload,'$.turn_id')
    JOIN private_content answer ON answer.content_id=json_extract(response.payload,'$.content_ref') AND answer.owner_id=?
      AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>?
    LEFT JOIN assistant_turns metadata ON metadata.actor_user_id=? AND metadata.scope_key=? AND metadata.turn_id=json_extract(message.payload,'$.turn_id')
    WHERE message.stream_id=? AND message.type='ChatMessageSent' AND json_extract(message.payload,'$.document_id')=?${guard} AND (${exclusion.sql}) AND (${replyProof.sql})
    ORDER BY message.sequence DESC,response.sequence DESC LIMIT ?`)
    .bind(actor.principal.userId, now, actor.surface.documentId, actor.principal.userId, now, actor.principal.userId,
      assistantScopeKey(actor), stream, actor.surface.documentId, ...bindings,...exclusion.bindings,...replyProof.bindings, ASSISTANT_CONTEXT_LIMITS.turns * 3)
    .all<AssistantTurnRow>();
  const seen = new Set<string>();
  const unique = rows.results.filter((row) => {
    const id = String(row.turn_id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, ASSISTANT_CONTEXT_LIMITS.turns).reverse();
  const sourceCustody={sql:"1"+guard,bindings:[...bindings]};
  const ordinary=await Promise.all(unique.map((row) => assistantTurnFromRow(env, actor, row,assistantHistorySourceProof(actor,row,sourceCustody,undefined,exclusion))));
  const current=await withNativeMemoryAssistantTurns(env,actor,ordinary);
  if(!actor.legacyScopeKey){generationTurns?.push(...ordinary);return current;}
  const legacy=await legacyAssistantTurns(env,actor);
  generationTurns?.push(...[...legacy.filter(turn=>!ordinary.some(item=>item.id===turn.id)),...ordinary].slice(-ASSISTANT_CONTEXT_LIMITS.turns));
  return[...legacy.filter(turn=>!current.some(item=>item.id===turn.id)),...current].slice(-ASSISTANT_CONTEXT_LIMITS.turns);
}

/** Retain an owner's pre-migration free history without adopting its private bytes into tenant custody. */

async function legacyAssistantTurns(env:WorkerEnv,actor:AuthorizedAssistant){
  if(!actor.legacyScopeKey||actor.project?.ownerUserId!==actor.principal.userId)return[];
  const tableExclusion=await ordinaryAssistantExclusion(env,"turn");
  const eventExclusion=await ordinaryAssistantExclusion(env);
  const rows=await env.DB.prepare(`SELECT turn.turn_id,turn.proposal_json,turn.request_json,turn.created_at AS source_created_at,authored.content AS user_content,answer.content AS assistant_content,
    ${assistantHistoryContentSources},${assistantHistoryTurnRecord} AS source_turn_record
    FROM assistant_turns turn JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE turn.actor_user_id=? AND turn.scope_key=? AND turn.organization_id IS NULL AND turn.project_access_id IS NULL AND turn.project_id=?
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id IN(authored.content_id,answer.content_id)) AND ${tableExclusion.sql}
    ORDER BY turn.created_at DESC LIMIT ?`).bind(actor.principal.userId,actor.legacyScopeKey,actor.projectId,...tableExclusion.bindings,ASSISTANT_CONTEXT_LIMITS.turns).all<AssistantTurnRow>();
  // Historical owner chat may predate assistant_turns. A derived resource index alone is not tenant adoption.
  const historical=actor.surface.documentId?(await env.DB.prepare(`SELECT json_extract(message.payload,'$.turn_id') AS turn_id,NULL AS proposal_json,message.recorded_at AS source_created_at,authored.content AS user_content,answer.content AS assistant_content,
    ${assistantHistoryContentSources},${assistantHistoryEventSources}
    FROM events message JOIN private_content authored ON authored.content_id=json_extract(message.payload,'$.content_ref') AND authored.owner_id=? AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN events response ON response.stream_id=message.stream_id AND response.correlation_id=message.correlation_id AND response.type='AssistantReasoned'
      AND json_extract(response.payload,'$.operation')='creative-chat' AND json_extract(response.payload,'$.document_id')=json_extract(message.payload,'$.document_id')
      AND json_extract(response.payload,'$.turn_id')=json_extract(message.payload,'$.turn_id')
    JOIN private_content answer ON answer.content_id=json_extract(response.payload,'$.content_ref') AND answer.owner_id=? AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE message.stream_id=? AND message.type='ChatMessageSent' AND json_extract(message.payload,'$.document_id')=?
      AND COALESCE(json_extract(message.payload,'$.project_id'),?)=?
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id IN(authored.content_id,answer.content_id)) AND ${eventExclusion.sql}
    ORDER BY message.sequence DESC,response.sequence DESC LIMIT ?`).bind(actor.principal.userId,actor.principal.userId,actor.principal.streamId,actor.surface.documentId,actor.projectId,actor.projectId,...eventExclusion.bindings,ASSISTANT_CONTEXT_LIMITS.turns).all<AssistantTurnRow>()).results:[];
  const sourceCustody={sql:"NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id IN(authored.content_id,answer.content_id))",bindings:[]};
  const seen=new Set<string>();return[...rows.results,...historical].filter(row=>Boolean(row.turn_id)&&!seen.has(row.turn_id)&&Boolean(seen.add(row.turn_id))).slice(0,ASSISTANT_CONTEXT_LIMITS.turns).reverse()
    .map(row=>rememberAssistantFeedTurnSource({id:row.turn_id,user:row.user_content,reply:{text:row.assistant_content},proposal:null}as AssistantTurn,
      assistantHistorySourceProof(actor,row,sourceCustody,actor.legacyScopeKey,row.source_turn_record?tableExclusion:eventExclusion)));
}

function assistantScopeKey(actor: AuthorizedAssistant) {
  const scope = [actor.project?.organizationId ?? "", actor.project?.projectAccessId ?? "", actor.projectId ?? "", actor.surface.documentId ?? ""];
  if (!actor.surface.documentId) scope.push(
    actor.surface.application,
    actor.surface.page,
    actor.surface.canonicalFamily,
    workspaceCapabilities(actor.surface.route)?.organizationId ?? "",
    actor.surface.page === "workspace" ? (new URL(actor.surface.route, "https://forma.local").pathname.split("/")[4] ?? "overview") : "",
    actor.surface.canvasId ?? "",
    actor.surface.focusedResourceId ?? "",
  );
  return JSON.stringify(scope);
}

async function exactAssistantTurn(env: WorkerEnv, actor: AuthorizedAssistant, turnId: string,
  expected?:{user:string;reply:string;requestJson:string;presentation:AssistantReply;actions:PreparedAssistantAction[];proposal:AssistantProposal|null}): Promise<AssistantTurn | null> {
  const replyProof=assistantPaidReplyReadGuard(actor,assistantScopeKey(actor),"turn.turn_id");
  const authoredCustody=assistantTurnContentCustody(actor,"authored"),answerCustody=assistantTurnContentCustody(actor,"answer");
  const memory=(await nativeMemoryAssistantTurns(env,actor,turnId))[0];
  if(memory){
    if(expected&&(memory.user!==expected.user||memory.reply.text!==expected.reply||assistantMemoryRequests.get(memory)!==expected.requestJson||expected.actions.length||expected.proposal!==null))return null;
    return memory;
  }
  const exclusion=await ordinaryAssistantExclusion(env,"turn");
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT turn.turn_id,turn.proposal_json,turn.request_json,turn.created_at AS source_created_at,authored.content AS user_content,answer.content AS assistant_content,
    ${assistantHistoryContentSources},${assistantHistoryTurnRecord} AS source_turn_record
    FROM assistant_turns turn
    JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>?
    JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>?
    WHERE turn.actor_user_id=? AND turn.scope_key=? AND turn.turn_id=? AND ${authoredCustody.sql} AND ${answerCustody.sql} AND (${exclusion.sql}) AND (${replyProof.sql}) LIMIT 1`)
    .bind(now, now, actor.principal.userId, assistantScopeKey(actor), turnId,...authoredCustody.bindings,...answerCustody.bindings,...exclusion.bindings,...replyProof.bindings)
    .first<AssistantTurnRow>();
  if (!row) return !expected&&actor.legacyScopeKey?(await legacyAssistantTurns(env,actor)).find(turn=>turn.id===turnId)??null:null;
  // Preserve the fresh response's localized key/values only when the committed
  // source still contains this exact message, rendered reply and request snapshot.
  if(expected&&(row.user_content!==expected.user||row.assistant_content!==expected.reply||row.request_json!==expected.requestJson
    ||row.proposal_json!==encodedAssistantProposals(expected.actions,expected.proposal)))return null;
  const sourceCustody={sql:`(${authoredCustody.sql}) AND (${answerCustody.sql})`,bindings:[...authoredCustody.bindings,...answerCustody.bindings]};
  return assistantTurnFromRow(env, actor, row,assistantHistorySourceProof(actor,row,sourceCustody,undefined,exclusion),expected?.presentation,expected?.actions);
}

async function assistantContext(request: Request, env: WorkerEnv, actor: AuthorizedAssistant, source?:AssistantContextReadWitness,focusedBlockId?:string) {
  // Ordinary reads capture complete source rows. POST binds this certificate
  // to its exact server-allocated write suffix before replaying it.
  const candidates = await scopedAssistantEvents(env, actor,source);
  const knownDocuments = new Set(candidates.filter((event) => event.type === "DocumentCreated" || event.type === "DocumentForked").map((event) => String(event.payload.document_id ?? "")));
  const events = candidates.filter((event) => {
    const projectId = String(event.payload.project_id ?? "");
    if (actor.projectId && projectId && projectId !== actor.projectId) return false;
    const documentId = String(event.payload.document_id ?? "");
    if (documentId && !knownDocuments.has(documentId)) return false;
    if (actor.surface.documentId && documentId && documentId !== actor.surface.documentId) return false;
    const canvasId = String(event.payload.canvas_id ?? event.payload.source_canvas_id ?? "");
    if (actor.surface.canvasId && canvasId && canvasId !== actor.surface.canvasId) return false;
    return true;
  });
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, actor.surface.documentId ?? "", actor.projectId ?? "");
  const canvasProjection = actor.surface.canvasId ? foldCanvasEvents(events, actor.projectId ?? "", actor.surface.canvasId) : null;
  // Retain deadlines before compilation or any subsequent await; an expiry
  // during the rights read must not turn a formerly future deadline into null.
  if(source)for(const block of [...projection.blocks,...projection.libraryBlocks])source.before(creativeContextRightsValidity(block.properties).validUntil);
  const context = compileAssistantContext({
    route: actor.surface.route,
    events,
    projection,
    canvasProjection,
    actorUserId: actor.principal.userId,
    capabilities: actor.project?.permissions ?? actor.principal.access.capabilities,
    ...(actor.project ? { organizationId: actor.project.organizationId, projectAccessId: actor.project.projectAccessId } : {}),
    projectId: actor.projectId,
    selectedItemIds: new URL(request.url).searchParams.getAll("selected"),
    ...(focusedBlockId?{focusedBlockId}:{}),
  });
  if(actor.project){
    if(source){
      const rights=await governedPackageSourceRightsValidity(env,actor.project.organizationId,projection.blocks,(scope)=>synchronizeProjectScope(env,scope));
      // An unavailable rights read has incomplete dependencies. It cannot
      // certify a page just because the earlier eligibility flag was unsafe.
      if(!rights.current){source.invalidate();context.totals.unsafeRightsDecisions=Math.max(1,Number(context.totals.unsafeRightsDecisions??0));}
      else{try{source.require(sourceRightsDispatchGuard(rights),own=>sourceRightsDispatchGuardForAssistant(rights,own),
        own=>sourceRightsDispatchGuardForStructuredAssistant(rights,own));source.before(rights.validUntil);}catch{source.invalidate();}}
    }else if(!await governedPackageSourceRightsCurrent(env,actor.project.organizationId,projection.blocks))
      context.totals.unsafeRightsDecisions=Math.max(1,Number(context.totals.unsafeRightsDecisions??0));
  }
  const generationTurns:AssistantTurn[]=[];
  const turns = await recentAssistantTurns(env, actor,generationTurns);
  // Display-only memory turns cannot contribute prose or displace the ordinary
  // generation window. Any consumer of remembered text must retain its origin.
  context.recentTurns = generationTurns.slice(-Math.floor(ASSISTANT_CONTEXT_LIMITS.turns / 2)).flatMap((turn, index) => [
    { id: `${turn.id}:user`, role: "user" as const, text: turn.user.slice(0, ASSISTANT_CONTEXT_LIMITS.turnChars), sequence: index * 2 },
    { id: `${turn.id}:assistant`, role: "assistant" as const, text: String(turn.reply.text ?? turn.reply.key ?? "").slice(0, ASSISTANT_CONTEXT_LIMITS.turnChars), sequence: index * 2 + 1 },
  ]);
  const bounded=boundAssistantContext(context);
  if(source)rememberAssistantContextRead(bounded,source);
  return { context:bounded, turns };
}

async function prepareAssistantTurn(env: WorkerEnv, actor: AuthorizedAssistant, input: {
  turnId: string;
  message: string;
  reply: string;
  proposal: AssistantProposal | null;
  documentId: string | null;
  actions?: PreparedAssistantAction[];
  requestJson:string;
  memory?:AssistantRecallMemory;
},source:AssistantContextReadWitness) {
  const scope = actor.project;
  const policy = scope ? await env.DB.prepare("SELECT transient_days,version FROM organization_retention_policies WHERE organization_id=?").bind(scope.organizationId)
    .first<{ transient_days: number; version: number }>() : null;
  const structuredCapture=input.memory?.mode==="structured"?await nativeStructuredMemoryOriginCapture(env,input.memory.value):null;
  const capture=input.memory?.mode==="structured"?structuredCapture:input.memory?await nativeMemoryOriginCapture(input.memory.value):null;
  if(input.memory&&(!capture||input.proposal!==null||(input.actions?.length??0)!==0))throw new Error("assistant_memory_unavailable");
  const now = new Date();
  const createdAt = now.toISOString();
  const retentionDays = Math.max(1, Math.min(365, Number(policy?.transient_days ?? Number(env.FORMA_RETENTION_DAYS ?? 30)) || 30));
  const expiresAt = new Date(now.getTime() + retentionDays * 86_400_000).toISOString();
  const answerExpiresAt=capture?new Date(Math.min(Date.parse(expiresAt),Date.parse(capture.sourceRetentionCeiling))).toISOString():expiresAt;
  const authoredId = uuidV7();
  const answerId = uuidV7();
  const actions = input.actions ?? [];
  const actionContents = new Map(actions.map((action) => [action.id, uuidV7()]));
  const active = scope&&!scope.contextId?`EXISTS(SELECT 1 FROM organization_projects project
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status=\'active\'
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status=\'active\'
    JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=project.owner_user_id AND member.status=\'active\' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
    WHERE project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND project.owner_user_id=? AND project.status=\'active\')`:`EXISTS(SELECT 1 FROM project_context_sessions context
      JOIN organization_projects project ON project.project_access_id=context.project_access_id AND project.organization_id=context.organization_id AND project.status='active'
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
      LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
      WHERE context.context_id=? AND context.principal_user_id=? AND context.revoked_at IS NULL AND context.expires_at>? AND context.expires_at>strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') AND project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND(project.owner_user_id=? OR project_member.membership_id IS NOT NULL))`;
  const activeBindings=scope?!scope.contextId?[scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,actor.principal.userId]:[actor.principal.userId,actor.principal.userId,scope.contextId,actor.principal.userId,createdAt,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,actor.principal.userId]:[];

  const authority=assistantReadAuthorityGuard(actor);
  const selectionStatements=input.memory?nativeMemorySelectionStatements(env,input.memory.selection):[];
  const memoryPrecommit=input.memory?.mode==="structured"?nativeStructuredConversationContextPrecommitStatements(env,input.memory.value.proof)
    :input.memory?.source.precommitStatements()??[];
  if(input.memory&&(!selectionStatements?.length||!memoryPrecommit?.length))throw new Error("assistant_memory_unavailable");
  const streamId = scope ? `creative:${scope.ownerUserId}` : actor.principal.streamId;
  const correlation = `${actor.principal.userId}:${input.turnId}`;
  const head = source.ownerHead(streamId);
  if(head===null)throw new Error("assistant_context_source_unavailable");
  const projectHead=scope?source.projectHead(scope.projectAccessId,scope.organizationId):null;
  if(scope&&projectHead===null)throw new Error("assistant_context_source_unavailable");
  if(input.memory?.mode==="structured"&&structuredCapture?.sourceHead!==head)throw new Error("assistant_memory_unavailable");
  const base = { ...(actor.projectId ? { project_id: actor.projectId } : {}), ...(input.documentId ? { document_id: input.documentId } : {}), actor_user_id: actor.principal.userId, source_surface: actor.surface.page, turn_id: input.turnId };
  const authored = makeEvent(streamId, head + 1, `user:${actor.principal.userId}`, "web:assistant", correlation, "ChatMessageSent", { ...base, content_ref: authoredId });
  const answer = makeEvent(streamId, head + 2, `user:${actor.principal.userId}`, "web:assistant", correlation, "AssistantReasoned", { ...base, operation: "creative-chat", content_ref: answerId, deterministic: true,
    ...(input.memory?{memory_origin_version:input.memory.mode==="structured"?2:1,organization_id:scope?.organizationId??null,project_access_id:scope?.projectAccessId??null,owner_user_id:scope?.ownerUserId??actor.principal.userId}:{}),
    ...(actions.length ? { proposal_count: actions.length } : {}) }, { causationId: authored.eventId });
  if(input.memory?.mode==="structured"){
    // One server publication timestamp binds both event receipts and all three
    // private bodies. makeEvent's independently sampled clocks are kept for v1.
    authored.occurredAt=createdAt;authored.recordedAt=createdAt;
    answer.occurredAt=createdAt;answer.recordedAt=createdAt;
  }
  const originInput={originId:uuidV7(),turnId:input.turnId,
    userEventId:authored.eventId,userContentId:authoredId,userSourceSequence:authored.sequence,user:input.message,
    answerEventId:answer.eventId,answerContentId:answerId,answerSourceSequence:answer.sequence,answer:input.reply,createdAt,answerExpiresAt};
  const structuredOrigin=input.memory?.mode==="structured"?await prepareNativeStructuredMemoryOrigin(env,input.memory.value,
    {...originInput,manifestContentRef:uuidV7(),manifestExpiresAt:answerExpiresAt}):null;
  const extractiveOrigin=input.memory?.mode==="extractive"?await prepareNativeMemoryOrigin(input.memory.value,originInput):null;
  if(input.memory&&!(structuredOrigin??extractiveOrigin))throw new Error("assistant_memory_unavailable");
  // Every source assertion runs before any private copy or authored event in
  // this one atomic batch. A failure must roll back, not merely hide the reply.
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("SELECT CASE WHEN ("+authority.sql+") THEN 1 ELSE json('assistant_read_scope_denied') END AS assistant_commit_authorized").bind(...authority.bindings),
    ...source.precommitStatements(),
    ...(selectionStatements??[]),
    ...(memoryPrecommit??[]),
  ];
  const privateEntries: Array<[string, string, string,string]> = [
    [authoredId, "chat-user", input.message,expiresAt],
    [answerId, input.memory?NATIVE_MEMORY_ANSWER_KIND:"chat-assistant", input.reply,answerExpiresAt],
    ...(structuredOrigin?[[structuredOrigin.manifest.contentRef,structuredOrigin.manifest.kind,structuredOrigin.manifest.text,structuredOrigin.manifest.expiresAt] as [string,string,string,string]]:[]),
    ...actions.map((action): [string, string, string,string] => [actionContents.get(action.id)!, "assistant-action", JSON.stringify(action.action),expiresAt]),
  ];
  for (const [contentId, kind, content,contentExpiresAt] of privateEntries) {
    if (scope) {
      statements.push(env.DB.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) SELECT ?,?,?,?,?,?,NULL WHERE ${active}`)
        .bind(contentId, actor.principal.userId, kind, content, createdAt, contentExpiresAt,...activeBindings));
      statements.push(env.DB.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) SELECT ?,'content',?,?,?,?,'actor_private',NULL,?,? WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)")
        .bind(scope.projectAccessId, contentId, scope.organizationId, scope.projectId, scope.ownerUserId, actor.principal.userId, createdAt, contentId, actor.principal.userId));
      statements.push(env.DB.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) SELECT ?,?,?,?,?,'transient-private',?,?,? WHERE EXISTS(SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND resource_kind='content' AND resource_id=? AND actor_user_id=?)")
        .bind(contentId, scope.organizationId, scope.projectAccessId, scope.projectId, actor.principal.userId, Number(policy?.version ?? 0), contentExpiresAt, createdAt, scope.projectAccessId, scope.organizationId, contentId, actor.principal.userId));
    } else {
      statements.push(env.DB.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
        .bind(contentId, actor.principal.userId, kind, content, createdAt, contentExpiresAt));
    }
  }

  const proposals = actions.map((action, index) => makeEvent(streamId, head + 3 + index, "model:forma-assistant", "server:assistant", correlation, "MutationProposed", {
    ...base,
    proposal_id: action.id,
    action_kind: action.action.kind,
    content_ref: actionContents.get(action.id),
    requires_approval: true,
  }, { causationId: answer.eventId }));
  const placeholders = EVENT_WRITE_COLUMNS.split(",").map(() => "?").join(",");
  const receipts = [
    `assistant:${actor.principal.userId}:${scope?.projectAccessId ?? "personal"}:${input.documentId ?? "page"}:${input.turnId}:user`,
    `assistant:${actor.principal.userId}:${scope?.projectAccessId ?? "personal"}:${input.documentId ?? "page"}:${input.turnId}:assistant`,
    ...actions.map((action) => `assistant:${actor.principal.userId}:${scope?.projectAccessId ?? "personal"}:${input.documentId ?? "page"}:${input.turnId}:proposal:${action.id}`),
  ];
  if(structuredOrigin){
    // Materialize exactly two ordered rows from one captured head. Both events
    // enter the existing staging gate together; no first-event success can be
    // used as a head allowance for a later, separately guarded INSERT.
    statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS})
      SELECT ${EVENT_WRITE_COLUMNS} FROM (SELECT ${EVENT_WRITE_COLUMNS.split(",").map(column=>`? AS ${column}`).join(",")} UNION ALL SELECT ${placeholders})
      WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? ORDER BY sequence`)
      .bind(...eventWriteBindings(authored),...eventWriteBindings(answer),streamId,head));
  }
  for (const [index, event] of [authored, answer, ...proposals].entries()) {
    if(!structuredOrigin)statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${placeholders} WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`)
      .bind(...eventWriteBindings(event), streamId, head + index));
    statements.push(env.DB.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=?)")
      .bind(streamId, receipts[index], event.eventId, event.sequence, createdAt, event.eventId, streamId));
  }

  if(scope){
    // Publish native custody before a review can advance past these raw owner
    // sequences. Reuse the ordinary projection allowlist, including page chat;
    // proposal events deliberately advance only the owner head, not this index.
    const published=projectDocumentPublicationEvents([authored,answer,...proposals] as CreativeEvent[],scope.projectId,input.documentId);
    if(published.length!==2||published[0]?.eventId!==authored.eventId||published[1]?.eventId!==answer.eventId)
      throw new Error("assistant_publication_contract_changed");
    for(const[index,event]of published.entries()){
      statements.push(env.DB.prepare(`INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)
          AND(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?
          AND EXISTS(SELECT 1 FROM project_migration_states WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?)`)
        .bind(event.eventId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,streamId,event.sequence,projectHead!+index+1,actor.principal.userId,createdAt,
          event.eventId,streamId,event.sequence,scope.projectAccessId,scope.organizationId,projectHead!+index,
          scope.projectAccessId,scope.organizationId,scope.ownerUserId,head));
    }
    statements.push(env.DB.prepare(`UPDATE project_migration_states SET last_owner_sequence=?,updated_at=?
      WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?
        AND(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`)
      .bind(head+2+proposals.length,createdAt,scope.projectAccessId,scope.organizationId,scope.ownerUserId,head,streamId,head+2+proposals.length));
  }

  const proposalExpiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  for (const action of actions) {
    const contentId = actionContents.get(action.id)!;
    const scopeGuard = scope ? ` AND EXISTS(SELECT 1 FROM project_resource_scopes resource
      JOIN private_content_retention_scopes retention ON retention.content_id=resource.resource_id
        AND retention.organization_id=resource.organization_id AND retention.project_access_id=resource.project_access_id
        AND retention.actor_user_id=resource.actor_user_id
      WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.resource_kind='content'
        AND resource.resource_id=? AND resource.actor_user_id=? AND resource.visibility='actor_private')` : "";
    statements.push(env.DB.prepare(`INSERT INTO assistant_action_proposals(proposal_id,actor_user_id,scope_key,turn_id,organization_id,project_access_id,project_id,document_id,action_kind,action_content_ref,source_versions_json,expected_head,permission_epoch,status,created_at,expires_at,resolved_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending',?,?,NULL
      WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND redacted_at IS NULL)${scopeGuard}`)
      .bind(action.id, actor.principal.userId, assistantScopeKey(actor), input.turnId, scope?.organizationId ?? null, scope?.projectAccessId ?? null,
        actor.projectId!, input.documentId!, action.action.kind, contentId, JSON.stringify(action.sourceVersions), head, actor.principal.access.permissionEpoch,
        createdAt, proposalExpiresAt, contentId, actor.principal.userId,
        ...(scope ? [scope.projectAccessId, scope.organizationId, contentId, actor.principal.userId] : [])));
  }

  const complete = `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)
    AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)
    AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)
    AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)
    AND EXISTS(SELECT 1 FROM event_client_receipts WHERE stream_id=? AND client_event_id=? AND event_id=?)
    AND EXISTS(SELECT 1 FROM event_client_receipts WHERE stream_id=? AND client_event_id=? AND event_id=?)
    AND (SELECT COUNT(*) FROM assistant_action_proposals WHERE actor_user_id=? AND scope_key=? AND turn_id=? AND status='pending')=?
    `;
  const encodedProposal = encodedAssistantProposals(actions,input.proposal);
  // NULL violates the NOT NULL status constraint and atomically rolls back every
  // private row, scope, event, and receipt if authorization or the event head moved.
  statements.push(env.DB.prepare(`INSERT INTO assistant_turns(turn_id,actor_user_id,scope_key,organization_id,project_access_id,project_id,document_id,route_family,user_content_ref,assistant_content_ref,proposal_json,permission_epoch,request_json,status,created_at,completed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ${complete} THEN 'completed' ELSE NULL END,?,?)`).bind(
    input.turnId, actor.principal.userId, assistantScopeKey(actor), scope?.organizationId ?? null, scope?.projectAccessId ?? null, actor.projectId, input.documentId,
    actor.surface.canonicalFamily, authoredId, answerId, encodedProposal, actor.principal.access.permissionEpoch,input.requestJson,
    authoredId, actor.principal.userId, answerId, actor.principal.userId, authored.eventId, streamId, head + 1, answer.eventId, streamId, head + 2,
    streamId, receipts[0], authored.eventId, streamId, receipts[1], answer.eventId,
    actor.principal.userId, assistantScopeKey(actor), input.turnId, actions.length,
    createdAt, createdAt,
  ));
  const origin=structuredOrigin??extractiveOrigin;
  if(origin){
    statements.push(...origin.statements.map(statement=>env.DB.prepare(statement.sql).bind(...statement.bindings)));
  }

  const footprintBase={
    streamId,sourceHead:head,actorUserId:actor.principal.userId,turnId:input.turnId,
    scope:scope?{organizationId:scope.organizationId,projectAccessId:scope.projectAccessId,projectId:scope.projectId,ownerUserId:scope.ownerUserId}:null,
    eventWrites:[authored,answer,...proposals].map(event=>eventWriteBindings(event)),
    contents:privateEntries.map(([id,kind,content,contentExpiresAt])=>[id,actor.principal.userId,kind,content,createdAt,contentExpiresAt,null]),
    receipts:[authored,answer,...proposals].map((event,index)=>[streamId,receipts[index]!,event.eventId,event.sequence,createdAt]),
    resources:scope?privateEntries.map(([id])=>[scope.projectAccessId,"content",id,scope.organizationId,scope.projectId,scope.ownerUserId,"actor_private",null,actor.principal.userId,createdAt]):[],
    retentions:scope?privateEntries.map(([id,,,contentExpiresAt])=>[id,scope.organizationId,scope.projectAccessId,scope.projectId,actor.principal.userId,"transient-private",Number(policy?.version??0),contentExpiresAt,createdAt]):[],
  };
  const footprint:AssistantOwnSendFootprint|AssistantStructuredOwnSendFootprint=structuredOrigin?{
    ...footprintBase,memoryAnswer:{version:2 as const},projectId:actor.projectId!,documentId:input.documentId!,manifestContentId:structuredOrigin.manifest.contentRef,
  }:{...footprintBase,...(input.memory?{memoryAnswer:{version:1 as const}}:{})};
  if(scope){
    const indexed=structuredOrigin?assistantStructuredOwnSendProjectIndexGuard(footprint as AssistantStructuredOwnSendFootprint,true)
      :assistantOwnSendProjectIndexGuard(footprint as AssistantOwnSendFootprint,true);
    statements.push(env.DB.prepare(`SELECT CASE WHEN (${indexed.sql}) AND EXISTS(SELECT 1 FROM project_migration_states
      WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?)
      THEN 1 ELSE json('assistant_publication_incomplete') END AS assistant_publication_verified`)
      .bind(...indexed.bindings,scope.projectAccessId,scope.organizationId,scope.ownerUserId,head+2+proposals.length));
  }
  const bound=structuredOrigin?source.bindStructuredOwnSend(footprint as AssistantStructuredOwnSendFootprint):source.bindOwnSend(footprint as AssistantOwnSendFootprint);
  if(bound.statements().length===0)throw new Error("assistant_context_source_unavailable");
  const structuredOwn=input.memory?.mode==="structured"?await prepareNativeStructuredConversationOwnSend(env,input.memory.value,footprint as AssistantStructuredOwnSendFootprint):null;
  if(input.memory?.mode==="structured"&&!structuredOwn)throw new Error("assistant_memory_unavailable");
  const publicationCurrent=()=>!structuredOrigin||input.memory?.mode==="structured"&&nativeStructuredMemoryOriginPublicationCurrent(env,input.memory.value,structuredOrigin);
  if(!publicationCurrent())throw new Error("assistant_memory_unavailable");
  const memorySource=structuredOwn?{
    statements:()=>publicationCurrent()?nativeStructuredConversationOwnSendStatements(env,structuredOwn)??[]:[],
    matches:(results:readonly D1Result<Record<string,unknown>>[])=>publicationCurrent()&&nativeStructuredConversationOwnSendMatches(env,structuredOwn,results),
  }:input.memory?.mode==="extractive"?input.memory.source:undefined;
  if(structuredOwn){
    const ownFinal=memorySource!.statements();
    if(!ownFinal.length)throw new Error("assistant_memory_unavailable");
    const pageOwnFinal=bound.structuredOwnPrecommitStatements();
    if(!pageOwnFinal.length)throw new Error("assistant_context_source_unavailable");
    statements.push(...ownFinal,...pageOwnFinal);
  }
  // Absence is certified in the FINAL response batch, not inferred from equal
  // reply bytes or a racy recovery read. Immutable own event IDs distinguish a
  // concurrent winner from a successful commit whose response was lost.
  let competingSendGuard:BudgetReservationGuard={sql:"NOT EXISTS(SELECT 1 FROM events WHERE event_id IN(SELECT value FROM json_each(?)))",
    bindings:[JSON.stringify(footprint.eventWrites.map(event=>event[0]))]};
  if(structuredOrigin){
    const eventIds=JSON.stringify(footprint.eventWrites.map(event=>event[0])),contentIds=JSON.stringify(footprint.contents.map(content=>content[0]));
    const absent:BudgetReservationGuard[]=[
      competingSendGuard,
      {sql:"NOT EXISTS(SELECT 1 FROM event_write_stage WHERE event_id IN(SELECT value FROM json_each(?)))",bindings:[eventIds]},
      {sql:"NOT EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id IN(SELECT value FROM json_each(?)))",bindings:[eventIds]},
      // Client receipt names intentionally match a concurrent same-turn winner.
      // Candidate EVENT identities, not those reusable names, prove absence.
      {sql:"NOT EXISTS(SELECT 1 FROM event_client_receipts WHERE event_id IN(SELECT value FROM json_each(?)))",bindings:[eventIds]},
      {sql:"NOT EXISTS(SELECT 1 FROM private_content WHERE content_id IN(SELECT value FROM json_each(?)))",bindings:[contentIds]},
      {sql:"NOT EXISTS(SELECT 1 FROM assistant_turns WHERE user_content_ref IN(SELECT value FROM json_each(?)) OR assistant_content_ref IN(SELECT value FROM json_each(?)))",bindings:[contentIds,contentIds]},
      {sql:"NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins WHERE origin_id=?)",bindings:[structuredOrigin.header.origin_id]},
      {sql:"NOT EXISTS(SELECT 1 FROM memory_structured_answer_originals WHERE origin_id=?)",bindings:[structuredOrigin.header.origin_id]},
      {sql:"NOT EXISTS(SELECT 1 FROM memory_structured_answer_ledger_revisions WHERE origin_id=?)",bindings:[structuredOrigin.header.origin_id]},
      ...(scope?[
        {sql:"NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)))",bindings:[eventIds]},
        {sql:"NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(SELECT value FROM json_each(?)))",bindings:[contentIds]},
        {sql:"NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id IN(SELECT value FROM json_each(?)))",bindings:[contentIds]},
      ]:[]),
    ];
    // A sanitized failed-write or concurrent-winner response must not silently
    // leave any of this candidate's private manifest, custody, or provenance.
    const condition=absent.map(guard=>"("+guard.sql+")").join(" AND "),bindings=absent.flatMap(guard=>guard.bindings);
    competingSendGuard={sql:condition,bindings};
  }
  return{statements,source:bound,competingSendGuard,memorySource,publicationCurrent,structuredOriginId:structuredOrigin?.header.origin_id};
}

const outputIntents = [
  { kind: "audio", pattern: /audio|music|musique|soundtrack|sound|sonore|bande.?son|musical|موسيقى|الموسيقى|صوت|الصوت|音楽|音声|サウンド|オーディオ/iu },
  { kind: "slides", pattern: /slides|presentation|présentation|diapositive|diaporama|deck|عرض|شرائح|スライド|プレゼン/iu },
  { kind: "storyboard", pattern: /storyboard|scénarimage|قصة مصورة|絵コンテ|ストーリーボード/iu },
  { kind: "video", pattern: /video|vidéo|film|فيديو|映像|動画|ビデオ/iu },
  { kind: "scene", pattern: /scene|scène|مشهد|シーン|場面/iu },
  { kind: "short_story", pattern: /story|récit|histoire|قصة|物語|ストーリー/iu },
  { kind: "image", pattern: /image|picture|photo|visuel|صورة|صوره|画像|イメージ|写真/iu },
] as const;

const responseLocale = (value: unknown) => {
  const language = typeof value === "string" ? value.trim().toLocaleLowerCase().split("-")[0] : "en";
  return language === "fr" || language === "ar" || language === "ja" ? language : "en";
};

function answerFor(context: AssistantContext, message: string, requestedLocale: unknown): AssistantReply {
  const normalized = message.toLocaleLowerCase();
  const matchingAtom = context.decisionAtoms.find((atom) => normalized.includes(atom.type.toLocaleLowerCase()) || atom.text && normalized.includes(atom.text.toLocaleLowerCase().slice(0, Math.min(atom.text.length, 18))));
  if (matchingAtom && /what|which|explain|describe|audio|sound|music|direction|style|palette|constraint|exclusion/i.test(normalized)) {
    return { key: "assistant.response.decision", values: { type: matchingAtom.type, text: matchingAtom.text } };
  }
  const output = outputIntents.find((candidate) => candidate.pattern.test(normalized));
  if (output) {
    const kind = output.kind;
    const locale = responseLocale(requestedLocale);
    const key = `assistant.kind.${kind}` as keyof typeof ASSISTANT_MESSAGES.en;
    return { key: "assistant.response.output", values: { kind, label: ASSISTANT_MESSAGES[locale][key], outputs: context.totals.outputsByKind[kind] ?? 0 } };
  }
  if (context.surface.page === "canvas" || context.surface.page === "canvas-library") {
    return context.selectedItems[0] ? { key: "assistant.response.canvasSelection", values: { title: context.selectedItems[0].title } }
      : { key: "assistant.response.canvas", values: {} };
  }
  if (context.surface.page === "activity") {
    const recent = context.recentActions.at(-1)?.type ?? "";
    const key = /Failed|Interrupted|Blocked/u.test(recent) ? "assistant.response.activityFailure"
      : /GenerationCompleted|DocumentRenderCompleted/u.test(recent) ? "assistant.response.activityResult"
      : /^Block|Relation/u.test(recent) ? "assistant.response.activityDecision" : "assistant.response.activity";
    return { key, values: { actions: context.recentActions.length } };
  }
  if (context.surface.page === "deliver") return { key: "assistant.response.deliver", values: { outputs: context.totals.outputs } };
  if (context.surface.page === "projects" || context.surface.page === "canvas-projects") return { key: "assistant.response.projects", values: {} };
  if (context.documentTitle) {
    return context.decisionAtoms.length ? { key: "assistant.response.document", values: { title: context.documentTitle, decisions: context.totals.decisions, outputs: context.totals.outputs } }
      : { key: "assistant.response.documentEmpty", values: { title: context.documentTitle } };
  }
  return { key: "assistant.response.page", values: { page: context.surface.page } };
}

function localizedAnswer(reply: AssistantReply, requestedLocale: unknown) {
  if(typeof reply.text==="string")return reply.text;
  const locale = responseLocale(requestedLocale);
  const key = String(reply.key ?? "");
  const messages: Readonly<Record<string, string>> = ASSISTANT_MESSAGES[locale];
  const template = messages[key] ?? ASSISTANT_MESSAGES.en[key as keyof typeof ASSISTANT_MESSAGES.en] ?? "";
  return template.replace(/\{([^}]+)\}/gu, (_match, name: string) => {
    const value = reply.values?.[name] ?? "";
    return typeof value === "number" ? new Intl.NumberFormat(locale).format(value) : value;
  });
}

function proposalFor(context: AssistantContext, turnId: string, canPropose: boolean): AssistantProposal | null {
  if (!canPropose) return null;
  const intent = context.unfinishedIntents.find((candidate) => candidate.route);
  if (intent?.route) return { id: `${turnId}:intent`, turnId, kind: "navigate", key: "assistant.action.reviewIntent", route: intent.route };
  const selected = context.selectedItems.find((item) => item.kind === "document" && item.documentId);
  if (selected?.documentId) return { id: `${turnId}:selection`, turnId, kind: "navigate", key: "assistant.action.openDocument", route: `/document/${encodeURIComponent(selected.documentId)}` };
  if (context.surface.page === "activity") return { id: `${turnId}:activity`, turnId, kind: "navigate", key: "assistant.action.openDeliver", route: "/deliver" };
  if (context.surface.page === "deliver") return { id: `${turnId}:deliver`, turnId, kind: "navigate", key: "assistant.action.openActivity", route: "/activity" };
  if (context.scope.documentId) return { id: `${turnId}:context`, turnId, kind: "navigate", key: "assistant.action.reviewContext", route: `/document/${encodeURIComponent(context.scope.documentId)}` };
  if (context.surface.page !== "projects" && context.surface.page !== "canvas-projects") return { id: `${turnId}:projects`, turnId, kind: "navigate", key: "assistant.action.openProjects", route: "/projects" };
  return null;
}

function validAssistantAction(value: unknown, expectedKind: string): AssistantContextAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== expectedKind) return null;
  const exact = (keys: string[]) => Object.keys(candidate).every((key) => keys.includes(key));
  if (candidate.kind === "context.create") {
    if (!exact(["kind", "blockType", "text", "intent"]) || typeof candidate.blockType !== "string" || typeof candidate.text !== "string"
      || !candidate.text.trim() || candidate.text.length > 600 || !["include", "avoid", "prohibit"].includes(String(candidate.intent))
      || candidate.blockType === "exclusion" && !["avoid", "prohibit"].includes(String(candidate.intent))) return null;
  } else if (candidate.kind === "context.edit") {
    if (!exact(["kind", "targetBlockId", "text"]) || typeof candidate.targetBlockId !== "string" || typeof candidate.text !== "string"
      || !candidate.targetBlockId || !candidate.text.trim() || candidate.text.length > 600) return null;
  } else if (candidate.kind === "context.remove") {
    if (!exact(["kind", "targetBlockId"]) || typeof candidate.targetBlockId !== "string" || !candidate.targetBlockId) return null;
  } else if (candidate.kind === "context.relation.add" || candidate.kind === "context.relation.remove") {
    if (!exact(["kind", "fromBlockId", "toBlockId", "relationKind"]) || typeof candidate.fromBlockId !== "string"
      || typeof candidate.toBlockId !== "string" || typeof candidate.relationKind !== "string" || !candidate.relationKind || candidate.relationKind.length > 64) return null;
  } else return null;
  return candidate as AssistantContextAction;
}

function activeAssistantProjectGuard(actor: AuthorizedAssistant, now: string) {
  const selected = actor.project;
  if (!selected) return { sql: "", bindings: [] as Array<string | number | null> };
  if(!selected.contextId)return{sql:" AND EXISTS(SELECT 1 FROM organization_projects project JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status=\'active\' JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id AND owner.status=\'active\' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status=\'active\' WHERE project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND project.owner_user_id=? AND project.status=\'active\')",bindings:[selected.projectAccessId,selected.organizationId,selected.projectId,selected.ownerUserId,actor.principal.userId]};
  const sql = ` AND EXISTS(SELECT 1 FROM project_context_sessions context
    JOIN organization_projects project ON project.project_access_id=context.project_access_id AND project.organization_id=context.organization_id AND project.status='active'
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
    JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
    LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id
      AND project_member.project_id=project.project_id AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
    WHERE context.context_id=? AND context.principal_user_id=? AND context.revoked_at IS NULL AND context.expires_at>?
      AND project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=?
      AND(project.owner_user_id=? OR project_member.role IN('owner','editor')))`;
  const bindings: Array<string | number | null> = [actor.principal.userId, actor.principal.userId, selected.contextId, actor.principal.userId, now,
    selected.projectAccessId, selected.organizationId, selected.projectId, selected.ownerUserId, actor.principal.userId];
  return { sql, bindings };
}

function proposalGuard(actor: AuthorizedAssistant, proposal: StoredAssistantProposal, now: string) {
  const project = activeAssistantProjectGuard(actor, now);
  const sql = `EXISTS(SELECT 1 FROM assistant_action_proposals candidate JOIN private_content private_action
      ON private_action.content_id=candidate.action_content_ref AND private_action.owner_id=candidate.actor_user_id
        AND private_action.redacted_at IS NULL AND private_action.expires_at>?
      WHERE candidate.proposal_id=? AND candidate.actor_user_id=? AND candidate.scope_key=? AND candidate.turn_id=?
        AND candidate.project_id=? AND candidate.document_id=? AND candidate.permission_epoch=?
        AND candidate.action_content_ref=? AND candidate.action_kind=? AND candidate.status='pending' AND candidate.expires_at>?)${project.sql}`;
  const bindings: Array<string | number | null> = [now, proposal.proposal_id, actor.principal.userId, assistantScopeKey(actor), proposal.turn_id,
    proposal.project_id, proposal.document_id, actor.principal.access.permissionEpoch, proposal.action_content_ref, proposal.action_kind, now];
  bindings.push(...project.bindings);
  return { sql, bindings };
}

async function commitStandaloneAssistantDecision(env: WorkerEnv, actor: AuthorizedAssistant, proposal: StoredAssistantProposal,
  decision: "accepted" | "rejected", mutation?: EventInput, expectedHead?: number) {
  const now = new Date().toISOString();
  const streamId = actor.project ? `creative:${actor.project.ownerUserId}` : actor.principal.streamId;
  const head = expectedHead ?? await streamHead(env, streamId);
  const correlation = `assistant-${decision}:${actor.principal.userId}:${proposal.proposal_id}`;
  const base = { project_id: proposal.project_id, document_id: proposal.document_id, actor_user_id: actor.principal.userId, proposal_id: proposal.proposal_id, turn_id: proposal.turn_id, source_surface: "assistant" };
  const event = makeEvent(streamId, head + 1, `user:${actor.principal.userId}`, "web:assistant", correlation,
    decision === "accepted" ? "ProposalAccepted" : "ProposalRejected", base);
  const events = [event, ...(mutation ? [makeEvent(streamId, head + 2, `user:${actor.principal.userId}`, "web:assistant", correlation,
    mutation.type, mutation.payload, { causationId: event.eventId })] : [])];
  const guard = proposalGuard(actor, proposal, now);
  const statements: D1PreparedStatement[] = [];
  const sharedRejection=decision==="rejected"?actor.project:null;
  let projectHead:number|null=null;
  let rejectionAuthority:BudgetReservationGuard|null=null;
  let publication:BudgetReservationGuard={sql:"1",bindings:[]};
  if(sharedRejection){
    // A private proposal decision is not a generic authoring operation. Publish
    // only this server-generated rejection, without changing its admission gate.
    if(events.length!==1||event.type!=="ProposalRejected")throw new Error("assistant_rejection_publication_invalid");
    const row=await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=?")
      .bind(sharedRejection.projectAccessId,sharedRejection.organizationId).first<{head:number}>();
    projectHead=Number(row?.head);
    if(!Number.isSafeInteger(projectHead)||projectHead<0)throw new Error("assistant_rejection_publication_invalid");
    rejectionAuthority=assistantReadAuthorityGuard(actor);
    statements.push(env.DB.prepare(`SELECT CASE WHEN (${rejectionAuthority.sql}) THEN 1 ELSE json('assistant_rejection_authority_changed') END AS assistant_rejection_authorized`)
      .bind(...rejectionAuthority.bindings));
    const current=projectSourceProjectionCurrentAssertion(sharedRejection);
    statements.push(env.DB.prepare(`SELECT CASE WHEN (${current.sql}) THEN 1 ELSE json('assistant_rejection_projection_stale') END AS assistant_rejection_projection_current`)
      .bind(...current.bindings));
  }
  const placeholders = EVENT_WRITE_COLUMNS.split(",").map(() => "?").join(",");
  for (const [index, current] of events.entries()) {
    const receipt = `assistant-${decision}:${actor.principal.userId}:${proposal.proposal_id}:${index}`;
    statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${placeholders}
      WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND ${guard.sql}`)
      .bind(...eventWriteBindings(current), streamId, head + index, ...guard.bindings));
    statements.push(env.DB.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND actor=?)")
      .bind(streamId, receipt, current.eventId, current.sequence, now, current.eventId, streamId, `user:${actor.principal.userId}`));
  }
  if(sharedRejection){
    const scope=sharedRejection;
    const custody=[event.eventId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,streamId,event.sequence,projectHead!+1,actor.principal.userId,now];
    statements.push(env.DB.prepare(`INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=? AND actor=? AND type='ProposalRejected')
        AND(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?
        AND EXISTS(SELECT 1 FROM project_migration_states WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?)`)
      .bind(...custody,event.eventId,streamId,event.sequence,`user:${actor.principal.userId}`,scope.projectAccessId,scope.organizationId,projectHead,
        scope.projectAccessId,scope.organizationId,scope.ownerUserId,head));
    statements.push(env.DB.prepare(`UPDATE project_migration_states SET last_owner_sequence=?,updated_at=?
      WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?
        AND(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`)
      .bind(event.sequence,now,scope.projectAccessId,scope.organizationId,scope.ownerUserId,head,streamId,event.sequence));
    publication={sql:`EXISTS(SELECT 1 FROM project_event_scopes custody
      WHERE(custody.event_id,custody.project_access_id,custody.organization_id,custody.project_id,custody.owner_user_id,custody.source_stream_id,custody.source_sequence,custody.project_sequence,custody.actor_user_id,custody.created_at)
        IS(?,?,?,?,?,?,?,?,?,?))
      AND(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?
      AND EXISTS(SELECT 1 FROM project_migration_states WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?)
      AND(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND EXISTS(SELECT 1 FROM event_client_receipts WHERE(stream_id,client_event_id,event_id,sequence,created_at) IS(?,?,?,?,?))`,
    bindings:[...custody,scope.projectAccessId,scope.organizationId,projectHead!+1,scope.projectAccessId,scope.organizationId,scope.ownerUserId,event.sequence,
      streamId,event.sequence,streamId,`assistant-rejected:${actor.principal.userId}:${proposal.proposal_id}:0`,event.eventId,event.sequence,now]};
  }
  statements.push(env.DB.prepare(`UPDATE assistant_action_proposals SET status=?,resolved_at=?
    WHERE proposal_id=? AND actor_user_id=? AND scope_key=? AND status='pending' AND permission_epoch=? AND expires_at>?`)
    .bind(decision, now, proposal.proposal_id, actor.principal.userId, assistantScopeKey(actor), actor.principal.access.permissionEpoch, now));
  const eventChecks = events.map(() => "EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND actor=?)").join(" AND ");
  statements.push(env.DB.prepare(`INSERT INTO assistant_action_commits(commit_id,verified,created_at)
    VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM assistant_action_proposals WHERE proposal_id=? AND actor_user_id=? AND scope_key=? AND status=?)
      AND ${eventChecks} AND (${publication.sql}) THEN 1 ELSE 0 END,?)`)
    .bind(`${proposal.proposal_id}:${decision}`, proposal.proposal_id, actor.principal.userId, assistantScopeKey(actor), decision,
      ...events.flatMap((current) => [current.eventId, streamId, `user:${actor.principal.userId}`]),...publication.bindings, now));
  // Reuse the original request's authority; the new event/scope does not mint a
  // replacement principal. Keep this outside the commit predicate's SQL depth.
  if(rejectionAuthority)statements.push(env.DB.prepare(`SELECT CASE WHEN (${rejectionAuthority.sql}) THEN 1 ELSE json('assistant_rejection_authority_changed') END AS assistant_rejection_authority_current`)
    .bind(...rejectionAuthority.bindings));
  await env.DB.batch(statements);
  return events;
}

async function commitSharedAssistantApproval(env: WorkerEnv, actor: AuthorizedAssistant, proposal: StoredAssistantProposal,
  mutation: EventInput, expectedHead: number) {
  const scope = actor.project!;
  const now = new Date().toISOString();
  const correlation = `assistant-accepted:${actor.principal.userId}:${proposal.proposal_id}`;
  const guard = proposalGuard(actor, proposal, now);
  return appendProjectEvents(env, scope, actor.principal, {
    action: "batch",
    correlationId: correlation,
    clientId: "web:assistant",
    events: [
      { type: "ProposalAccepted", payload: { proposal_id: proposal.proposal_id, turn_id: proposal.turn_id, actor_user_id: actor.principal.userId,
        project_id: proposal.project_id, document_id: proposal.document_id, source_surface: "assistant" } },
      mutation,
    ],
  }, undefined, {
    preserveGovernance: true,
    expectedOwnerHead: expectedHead,
    assistantAcceptance: { proposalId: proposal.proposal_id, turnId: proposal.turn_id, actorUserId: actor.principal.userId,
      scopeKey: assistantScopeKey(actor), organizationId: scope.organizationId, projectAccessId: scope.projectAccessId,
      projectId: scope.projectId, documentId: proposal.document_id },
    guardSql: guard.sql,
    guardBindings: guard.bindings,
    buildStatements: (lastEventId) => [
      env.DB.prepare(`UPDATE assistant_action_proposals SET status='accepted',resolved_at=?
        WHERE proposal_id=? AND actor_user_id=? AND scope_key=? AND permission_epoch=? AND status='pending' AND expires_at>?
          AND EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=? AND project_access_id=? AND organization_id=? AND actor_user_id=?)`)
        .bind(now, proposal.proposal_id, actor.principal.userId, assistantScopeKey(actor), actor.principal.access.permissionEpoch, now,
          lastEventId, scope.projectAccessId, scope.organizationId, actor.principal.userId),
      env.DB.prepare(`INSERT INTO assistant_action_commits(commit_id,verified,created_at) VALUES(?,CASE WHEN
        EXISTS(SELECT 1 FROM assistant_action_proposals WHERE proposal_id=? AND actor_user_id=? AND scope_key=? AND status='accepted')
        AND EXISTS(SELECT 1 FROM project_event_scopes accepted_scope JOIN events accepted ON accepted.event_id=accepted_scope.event_id
          WHERE accepted_scope.project_access_id=? AND accepted_scope.organization_id=? AND accepted_scope.actor_user_id=?
            AND accepted.type='ProposalAccepted' AND accepted.correlation_id=? AND json_extract(accepted.payload,'$.proposal_id')=?)
        AND EXISTS(SELECT 1 FROM project_event_scopes changed_scope JOIN events changed ON changed.event_id=changed_scope.event_id
          WHERE changed_scope.event_id=? AND changed_scope.project_access_id=? AND changed_scope.organization_id=?
            AND changed_scope.actor_user_id=? AND changed.correlation_id=?) THEN 1 ELSE 0 END,?)`)
        .bind(`${proposal.proposal_id}:accepted`, proposal.proposal_id, actor.principal.userId, assistantScopeKey(actor),
          scope.projectAccessId, scope.organizationId, actor.principal.userId, correlation, proposal.proposal_id,
          lastEventId, scope.projectAccessId, scope.organizationId, actor.principal.userId, correlation, now),
    ],
  });
}

/** Authoritative mutation validation folds only exact graph/state events, never conversation or provider history. */
async function assistantAuthoritativeProjection(env: WorkerEnv, actor: AuthorizedAssistant) {
  const types = "'ProjectCreated','ProjectOpened','ProjectRenamed','DocumentCreated','DocumentOpened','DocumentForked','DocumentRenamed','DocumentRemoved','DocumentRestored','BlockCreated','BlockRehomed','BlockRenamed','BlockPropertyEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRemoved','BlockRestored','BlockRelationAdded','BlockRelationRemoved','ChipEdited','ExtractionRequested','ExtractionCompleted','ExtractionFailed'";
  const selected = actor.project;
  const statement = selected
    ? env.DB.prepare(`SELECT event.*,secret.private_json FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
        LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
        WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.project_id=? AND scope.owner_user_id=?
          AND event.type IN(${types}) ORDER BY scope.project_sequence`)
      .bind(selected.ownerUserId, selected.projectAccessId, selected.organizationId, selected.projectId, selected.ownerUserId)
    : env.DB.prepare(`SELECT event.*,secret.private_json FROM events event
        LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
        WHERE event.stream_id=? AND event.type IN(${types}) ORDER BY event.sequence`)
      .bind(actor.principal.userId, actor.principal.streamId);
  const rows = await statement.all<Record<string, unknown>>();
  return foldEvents(rows.results.map((row) => serializeEvent(row)) as CreativeEvent[], Number.POSITIVE_INFINITY,
    actor.surface.documentId ?? "", actor.projectId ?? "");
}

function authoritativeAssistantEvents(action: AssistantContextAction, context: AssistantContext,
  projection: Awaited<ReturnType<typeof assistantAuthoritativeProjection>>, turnId: string) {
  let events = assistantActionEvents(action, context, { blockId: uuidV7(), relationId: uuidV7(), turnId });
  if (events.length !== 1) return { events: [], error: "assistant_proposal_invalid" };
  if (action.kind === "context.edit" || action.kind === "context.remove") {
    const target = projection.libraryBlocks.find((block) => block.id === action.targetBlockId && !block.removed
      && block.projectId === context.scope.projectId && block.documentId === context.scope.documentId);
    if (!target || protectedAssistantDecision(target) || target.properties.source_evidence_hash || target.properties.organization_context_package_binding_id
      || target.properties.organization_context_package_id || target.properties.source_artifact_id || target.properties.source_artifact_item_id
      || target.properties.context_set_root_id || projection.libraryBlockRelations.some((relation) => !relation.removed && relation.kind === "artifact_contains"
        && (relation.fromBlockId === target.id || relation.toBlockId === target.id))) return { events: [], error: "assistant_proposal_invalid" };
    events = action.kind === "context.edit"
      ? outputBlockTextEditEvents(target, projection.libraryBlocks, action.text, "assistant")
      : outputBlockRemovalEvents(target, projection.libraryBlocks, projection.libraryBlockRelations, events[0]!);
    if (events.length !== 1) return { events: [], error: "assistant_proposal_invalid" };
    events = events.map((event) => ({ ...event, payload: { ...event.payload, project_id: context.scope.projectId,
      document_id: context.scope.documentId, source_surface: "assistant", source_chat_turn_id: turnId } }));
  }
  const outputGuard=prepareOutputRequirementClientEvents(events,projection.libraryBlocks);
  if(!outputGuard.ok)return {events:[],error:outputGuard.error};
  events=outputGuard.events;
  const issue = validateContextCompositionGraph({ blocks: projection.libraryBlocks, relations: projection.libraryBlockRelations,
    events, ignoreLocks: false });
  return issue ? { events: [], error: issue.code } : { events, error: null };
}

export async function handleAssistantProposal(request: Request, env: WorkerEnv, proposalId: string, operation: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(proposalId) || !["accept", "reject"].includes(operation)) return json({ error: "assistant_proposal_not_found" }, 404);
  if ((await request.text()).trim()) return json({ error: "assistant_request_invalid" }, 400);
  const authorization = await authorizeAssistant(request, env);
  if (authorization.response || !authorization.authorized) return authorization.response!;
  const actor = authorization.authorized;
  if (!assistantActionsEnabled(env, actor)) return json({ error: "assistant_authoring_denied" }, 403);
  await ensureAssistantSchema(env);
  const now = new Date().toISOString();
  const proposal = await env.DB.prepare(`SELECT proposal.*,content.content FROM assistant_action_proposals proposal
    JOIN private_content content ON content.content_id=proposal.action_content_ref AND content.owner_id=proposal.actor_user_id
      AND content.redacted_at IS NULL AND content.expires_at>?
    WHERE proposal.proposal_id=? AND proposal.actor_user_id=? AND proposal.scope_key=?
      AND proposal.project_id=? AND proposal.document_id=? LIMIT 1`).bind(now, proposalId, actor.principal.userId,
    assistantScopeKey(actor), actor.projectId ?? "", actor.surface.documentId ?? "").first<StoredAssistantProposal>();
  if (!proposal) return json({ error: "assistant_proposal_not_found" }, 404);
  if (proposal.permission_epoch !== actor.principal.access.permissionEpoch) return json({ error: "assistant_authorization_changed" }, 403);
  if (proposal.organization_id !== (actor.project?.organizationId ?? null) || proposal.project_access_id !== (actor.project?.projectAccessId ?? null)) {
    return json({ error: "assistant_proposal_not_found" }, 404);
  }
  if (proposal.status !== "pending") return proposal.status === (operation === "accept" ? "accepted" : "rejected")
    ? json({ proposalId, status: proposal.status, idempotent: true }) : json({ error: "assistant_proposal_resolved" }, 409);
  if (proposal.expires_at <= now) return json({ error: "assistant_proposal_expired" }, 410);
  if (operation === "reject") {
    try {
      await commitStandaloneAssistantDecision(env, actor, proposal, "rejected");
      return json({ proposalId, status: "rejected" });
    } catch { return json({ error: "assistant_proposal_stale" }, 409); }
  }

  let raw: unknown;
  let versions: Array<{ blockId: string; version: number }>;
  try {
    raw = JSON.parse(proposal.content);
    versions = JSON.parse(proposal.source_versions_json) as Array<{ blockId: string; version: number }>;
  } catch { return json({ error: "assistant_proposal_invalid" }, 409); }
  const action = validAssistantAction(raw, proposal.action_kind);
  if (!action || !Array.isArray(versions) || versions.length > ASSISTANT_CONTEXT_LIMITS.decisions
    || versions.some((item) => !item || typeof item.blockId !== "string" || !Number.isSafeInteger(item.version))) {
    return json({ error: "assistant_proposal_invalid" }, 409);
  }
  const streamId = actor.project ? `creative:${actor.project.ownerUserId}` : actor.principal.streamId;
  const head = await streamHead(env, streamId);
  const current = await assistantContext(request, env, actor);
  if (await streamHead(env, streamId) !== head) return json({ error: "assistant_proposal_stale" }, 409);
  if (current.context.scope.projectId !== proposal.project_id || current.context.scope.documentId !== proposal.document_id
    || versions.some((version) => current.context.decisionAtoms.find((item) => item.id === version.blockId)?.version !== version.version)) {
    return json({ error: "assistant_proposal_stale" }, 409);
  }
  const projection = await assistantAuthoritativeProjection(env, actor);
  if (await streamHead(env, streamId) !== head) return json({ error: "assistant_proposal_stale" }, 409);
  const checked = authoritativeAssistantEvents(action, current.context, projection, proposal.turn_id);
  if (checked.events.length !== 1) return json({ error: checked.error ?? "assistant_proposal_invalid" }, 409);
  const changes = checked.events;
  try {
    if (actor.project) {
      const committed = await commitSharedAssistantApproval(env, actor, proposal, changes[0]!, head);
      if (!committed.ok) return committed;
    } else {
      await commitStandaloneAssistantDecision(env, actor, proposal, "accepted", changes[0]!, head);
    }
    return json({ proposalId, status: "accepted", kind: action.kind });
  } catch { return json({ error: "assistant_proposal_stale" }, 409); }
}

function providerAssistantActions(result: AssistantProviderResult, context: AssistantContext): AssistantContextAction[] {
  return result.actions.flatMap((item): AssistantContextAction[] => {
    let candidate: AssistantContextAction | null = null;
    if (item.kind === "context.create" && isBlockKind(item.block_type) && item.block_type !== "reference") {
      candidate = { kind: "context.create", blockType: item.block_type, text: String(item.text ?? ""), intent: item.intent };
    } else if (item.kind === "context.edit" && typeof item.target_block_id === "string") {
      candidate = { kind: "context.edit", targetBlockId: item.target_block_id, text: String(item.text ?? "") };
    } else if (item.kind === "context.remove" && typeof item.target_block_id === "string") {
      candidate = { kind: "context.remove", targetBlockId: item.target_block_id };
    } else if ((item.kind === "context.relation.add" || item.kind === "context.relation.remove")
      && typeof item.from_block_id === "string" && typeof item.to_block_id === "string") {
      candidate = { kind: item.kind, fromBlockId: item.from_block_id, toBlockId: item.to_block_id, relationKind: String(item.relation_kind ?? "") };
    }
    if (!candidate || !validAssistantAction(candidate, item.kind)) return [];
    return assistantActionEvents(candidate, context, { blockId: uuidV7(), relationId: uuidV7(), turnId: "assistant-validation" }).length === 1 ? [candidate] : [];
  });
}

async function commitAssistantSpecialistResult(env: WorkerEnv, actor: AuthorizedAssistant, task: StoredAssistantTask,
  result: AssistantProviderResult, context: AssistantContext, proof:BudgetReservationGuard) {
  if(!await env.DB.prepare("SELECT 1 AS current WHERE "+proof.sql).bind(...proof.bindings).first())throw new Error("assistant_result_custody_changed");
  if(await env.DB.prepare("SELECT 1 AS committed FROM assistant_action_commits WHERE commit_id=? AND verified=1").bind("task:"+task.task_id).first())return;
  const existing = await env.DB.prepare(`SELECT turn.assistant_content_ref,turn.proposal_json FROM assistant_turns turn
    WHERE turn.actor_user_id=? AND turn.scope_key=? AND turn.turn_id=?`).bind(actor.principal.userId, assistantScopeKey(actor), task.turn_id)
    .first<{ assistant_content_ref: string; proposal_json: string | null }>();
  if (!existing) throw new Error("assistant_turn_missing");
  const currentProposals = await pendingTurnProposals(env, actor, task.turn_id, existing.proposal_json);
  const previousActions = await env.DB.prepare(`SELECT content.content FROM assistant_action_proposals proposal
    JOIN private_content content ON content.content_id=proposal.action_content_ref AND content.owner_id=proposal.actor_user_id
    WHERE proposal.actor_user_id=? AND proposal.scope_key=? AND proposal.turn_id=? AND proposal.status='pending'`)
    .bind(actor.principal.userId, assistantScopeKey(actor), task.turn_id).all<{ content: string }>();
  const known = new Set(previousActions.results.map((row) => row.content));
  const generated = assistantActionsEnabled(env, actor) ? providerAssistantActions(result, context).filter((action) => !known.has(JSON.stringify(action))) : [];
  const actions = prepareTypedAssistantActions(generated, context, task.turn_id);
  const scope = actor.project;
  const policy = scope ? await env.DB.prepare("SELECT transient_days,version FROM organization_retention_policies WHERE organization_id=?")
    .bind(scope.organizationId).first<{ transient_days: number; version: number }>() : null;
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + Math.max(1, Math.min(365, Number(policy?.transient_days ?? Number(env.FORMA_RETENTION_DAYS ?? 30)) || 30)) * 86_400_000).toISOString();
  const proposalExpiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  const guard = proof;
  const streamId = scope ? `creative:${scope.ownerUserId}` : actor.principal.streamId;
  const head = await streamHead(env, streamId);
  const correlation = task.task_id;
  const base = { ...(actor.projectId ? { project_id: actor.projectId } : {}), ...(task.document_id ? { document_id: task.document_id } : {}),
    actor_user_id: actor.principal.userId, source_surface: actor.surface.page, turn_id: task.turn_id, task_id: task.task_id };
  const answered = makeEvent(streamId, head + 1, `user:${actor.principal.userId}`, "server:assistant", correlation, "AssistantReasoned", {
    ...base, operation: "creative-chat", content_ref: existing.assistant_content_ref, model: task.selected_model, deterministic: false,
    ...(actions.length ? { proposal_count: actions.length } : {}),
  });
  const actionContents = new Map(actions.map((action) => [action.id, uuidV7()]));
  const proposed = actions.map((action, index) => makeEvent(streamId, head + 2 + index, "model:forma-assistant", "server:assistant", correlation,
    "MutationProposed", { ...base, proposal_id: action.id, action_kind: action.action.kind, content_ref: actionContents.get(action.id), requires_approval: true },
    { causationId: answered.eventId }));
  const originWrites=await liveMemoryOriginWithdrawalStatements(env,{contentId:existing.assistant_content_ref},"source-changed",createdAt);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE private_content SET content=? WHERE content_id=? AND owner_id=? AND kind='chat-assistant' AND redacted_at IS NULL AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${guard.sql}`)
      .bind(result.reply, existing.assistant_content_ref, actor.principal.userId, createdAt, ...guard.bindings),
    // Content equality alone would also admit an ignored UPDATE of an identical
    // reply. Prove the guarded replacement matched before retiring its lineage.
    env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('assistant_result_content_changed') END AS verified"),
    ...originWrites,
  ];
  for (const action of actions) {
    const contentId = actionContents.get(action.id)!;
    statements.push(env.DB.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)
      SELECT ?,?,'assistant-action',?,?,?,NULL WHERE ${guard.sql}`)
      .bind(contentId, actor.principal.userId, JSON.stringify(action.action), createdAt, expiresAt, ...guard.bindings));
    if (scope) {
      statements.push(env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
        SELECT ?,'content',?,?,?,?,'actor_private',NULL,?,? WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)`)
        .bind(scope.projectAccessId, contentId, scope.organizationId, scope.projectId, scope.ownerUserId, actor.principal.userId, createdAt, contentId, actor.principal.userId));
      statements.push(env.DB.prepare(`INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at)
        SELECT ?,?,?,?,?,'transient-private',?,?,? WHERE EXISTS(SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND resource_kind='content' AND resource_id=? AND actor_user_id=?)`)
        .bind(contentId, scope.organizationId, scope.projectAccessId, scope.projectId, actor.principal.userId, Number(policy?.version ?? 0), expiresAt, createdAt,
          scope.projectAccessId, scope.organizationId, contentId, actor.principal.userId));
    }
    statements.push(env.DB.prepare(`INSERT INTO assistant_action_proposals(proposal_id,actor_user_id,scope_key,turn_id,organization_id,project_access_id,project_id,document_id,action_kind,action_content_ref,source_versions_json,expected_head,permission_epoch,status,created_at,expires_at,resolved_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,NULL WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)`)
      .bind(action.id, actor.principal.userId, assistantScopeKey(actor), task.turn_id, scope?.organizationId ?? null, scope?.projectAccessId ?? null,
        actor.projectId!, task.document_id!, action.action.kind, contentId, JSON.stringify(action.sourceVersions), head, actor.principal.access.permissionEpoch,
        createdAt, proposalExpiresAt, contentId, actor.principal.userId));
  }
  const placeholders = EVENT_WRITE_COLUMNS.split(",").map(() => "?").join(",");
  for (const [index, event] of [answered, ...proposed].entries()) {
    statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${placeholders}
      WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND ${guard.sql}`)
      .bind(...eventWriteBindings(event), streamId, head + index, ...guard.bindings));
    statements.push(env.DB.prepare(`INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=?)`)
      .bind(streamId, `assistant-specialist:${actor.principal.userId}:${task.task_id}:${index}`, event.eventId, event.sequence, createdAt, event.eventId, streamId));
  }
  const metadata = [
    ...currentProposals.filter((proposal) => proposal.kind !== "navigate").map(({ summary: _summary, ...proposal }) => proposal),
    ...actions.map(({ id, turnId, key, action }) => ({ id, turnId, key, kind: action.kind })),
  ];
  const encoded = metadata.length ? JSON.stringify({ proposals: metadata }) : existing.proposal_json;
  statements.push(env.DB.prepare("UPDATE assistant_turns SET proposal_json=? WHERE actor_user_id=? AND scope_key=? AND turn_id=? AND "+guard.sql)
    .bind(encoded, actor.principal.userId, assistantScopeKey(actor), task.turn_id,...guard.bindings));
  statements.push(env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='completed',error_code=NULL,updated_at=?,completed_at=?
    WHERE task_id=? AND actor_user_id=? AND scope_key=? AND ${guard.sql}`)
    .bind(createdAt, createdAt, task.task_id, actor.principal.userId, assistantScopeKey(actor),...guard.bindings));
  const exactActions = actions.length ? ` AND (SELECT COUNT(*) FROM assistant_action_proposals WHERE proposal_id IN(${actions.map(() => "?").join(",")})
    AND actor_user_id=? AND scope_key=? AND turn_id=? AND status='pending')=?` : "";
  statements.push(env.DB.prepare(`INSERT INTO assistant_action_commits(commit_id,verified,created_at) VALUES(?,CASE WHEN
    EXISTS(SELECT 1 FROM assistant_specialist_tasks WHERE task_id=? AND actor_user_id=? AND scope_key=? AND status='completed')
    AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND type='AssistantReasoned')${exactActions}
    AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='chat-assistant' AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND ${guard.sql} THEN 1 ELSE 0 END,?)`)
    .bind(`task:${task.task_id}`, task.task_id, actor.principal.userId, assistantScopeKey(actor), answered.eventId, streamId,
      ...(actions.length ? [...actions.map((action) => action.id), actor.principal.userId, assistantScopeKey(actor), task.turn_id, actions.length] : []),existing.assistant_content_ref,actor.principal.userId,result.reply,...guard.bindings, createdAt));
  await env.DB.batch(statements);
}

/** A history read can park unsigned legacy rows, but cannot buy work or release an unknown bill. */
async function resumeAssistantTasks(_request:Request,env:WorkerEnv,actor:AuthorizedAssistant,_execution:WorkerExecutionContext){
  await parkUnsignedAssistantTasks(env,actor,assistantScopeKey(actor));
}

async function recentAssistantTasks(env: WorkerEnv, actor: AuthorizedAssistant):Promise<AssistantTaskFeedEntry[]> {
  const keys=[assistantScopeKey(actor),...(actor.legacyScopeKey?[actor.legacyScopeKey]:[])];
  const rows=await env.DB.prepare(`SELECT task.*,
    execution.execution_id AS consent_execution_id,execution.binding_hash AS consent_binding_hash,step.status AS step_status
    FROM assistant_specialist_tasks task LEFT JOIN consequential_executions execution ON execution.execution_id=task.task_id AND execution.actor_user_id=task.actor_user_id AND execution.operation='assistant-specialist'
      AND json_extract(task.result_json,'$.specialistConsentVersion')=1 AND execution.binding_hash=json_extract(task.result_json,'$.bindingHash')
      AND task.token_reservation_id=task.task_id||':tokens:0' AND task.cost_reservation_id=task.task_id||':usd:0'
    LEFT JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id AND step.step_index=0
    WHERE task.actor_user_id=? AND task.scope_key IN(${keys.map(()=>"?").join(",")}) ORDER BY task.created_at DESC LIMIT 8`)
    .bind(actor.principal.userId,...keys).all<SpecialistTaskRecord&{consent_execution_id:string|null;consent_binding_hash:string|null;step_status:string|null}>();
  return rows.results.map(row=>({record:row,display:{id:row.task_id,turnId:row.turn_id,kind:row.task_kind,model:row.selected_model,status:row.status,error:row.error_code,estimatedMicrousd:Number(row.estimated_microusd),
    ...(row.consent_execution_id?{executionId:row.consent_execution_id,bindingHash:row.consent_binding_hash,canExecute:false,submission:assistantSubmissionStatus(row.step_status)}:{})}}));
}

export async function handleAssistantTask(request: Request, env: WorkerEnv, taskId: string, operation: string): Promise<Response> {
  if (request.method !== "POST" || !["cancel", "reconcile"].includes(operation)) return json({ error: "method_not_allowed" }, 405);
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(taskId)) return json({ error: "assistant_request_invalid" }, 400);
  const supplied = (await request.text()).trim();
  let confirmation: unknown = null;
  if (operation === "reconcile") {
    try { confirmation = supplied ? JSON.parse(supplied) : null; } catch { return json({ error: "assistant_request_invalid" }, 400); }
    if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)
      || (confirmation as Record<string, unknown>).confirmedNoProviderCharge !== true
      || Object.keys(confirmation).some((key) => key !== "confirmedNoProviderCharge")) return json({ error: "assistant_charge_verification_required" }, 400);
  } else if (supplied) return json({ error: "assistant_request_invalid" }, 400);
  const authorization = await authorizeAssistant(request, env);
  if (authorization.response || !authorization.authorized) return authorization.response!;
  const actor = authorization.authorized;
  await ensureAssistantSchema(env);
  const task = await env.DB.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=? AND actor_user_id=? AND scope_key=? LIMIT 1")
    .bind(taskId, actor.principal.userId, assistantScopeKey(actor)).first<StoredAssistantTask>();
  if (!task) return json({ error: "assistant_task_not_found" }, 404);
  if(operation==="cancel"){const signed=await cancelConsentedAssistantTask(env,actor,assistantSpecialistHost,task);if(signed)return signed;}
  if (task.permission_epoch !== actor.principal.access.permissionEpoch) return json({ error: "assistant_authorization_changed" }, 403);
  if (operation === "reconcile") {
    // The task-owner route can never provide the independent reviewer required for
    // an ambiguous paid submission, even when that owner is a platform admin.
    return json({ error: "assistant_independent_reviewer_required" }, 403);
  }
  await parkUnsignedAssistantTasks(env,actor,assistantScopeKey(actor));
  return json({error:"assistant_legacy_approval_required",taskId,noAutomaticRetry:true},409);
}

/** The historical no-charge attestation must never overwrite a signed receipt or already recorded spend. */
function legacyAssistantNoChargeSql(task:string){
  return `${task}.result_json IS NULL
    AND NOT EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.actor_user_id=${task}.actor_user_id AND(
      execution.execution_id=${task}.task_id OR EXISTS(SELECT 1 FROM consequential_execution_steps step WHERE step.execution_id=execution.execution_id
        AND(step.token_reservation_id=${task}.token_reservation_id OR step.cost_reservation_id=${task}.cost_reservation_id))))
    AND NOT EXISTS(SELECT 1 FROM budget_reservations tokens WHERE tokens.reservation_id=${task}.token_reservation_id AND tokens.owner_id=${task}.actor_user_id AND tokens.used_tokens>0)
    AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=${task}.cost_reservation_id AND cost.owner_id=${task}.actor_user_id AND cost.used_microusd>0)`;
}

/** Rescue another actor's uncertain bill without exposing their conversation or widening project authority. */
export async function handleAssistantBillingReconciliation(request: Request, env: WorkerEnv, taskId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(taskId)) return json({ error: "assistant_task_not_found" }, 404);
  const authorization = await requireCapability(request, env, "platform.provider.configure");
  if (authorization.response || !authorization.user) return authorization.response!;
  const reviewer = authorization.user;
  if (reviewer.role !== "admin" || !assistantTesters(env).has(reviewer.userId)) return json({ error: "assistant_reconciliation_denied" }, 403);
  const consent = requireConsent(reviewer);
  if (consent) return consent;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "assistant_charge_verification_required" }, 400);
    body = parsed as Record<string, unknown>;
  } catch { return json({ error: "assistant_charge_verification_required" }, 400); }
  const actorUserId = typeof body.actorUserId === "string" ? body.actorUserId.trim() : "";
  const organizationId = body.organizationId === null ? null : typeof body.organizationId === "string" ? body.organizationId.trim() : undefined;
  const projectAccessId = body.projectAccessId === null ? null : typeof body.projectAccessId === "string" ? body.projectAccessId.trim() : undefined;
  if (!actorUserId || actorUserId.length > 160 || actorUserId === reviewer.userId || organizationId === undefined || projectAccessId === undefined
    || Boolean(organizationId) !== Boolean(projectAccessId) || (organizationId?.length ?? 0) > 160 || (projectAccessId?.length ?? 0) > 160
    || body.confirmedNoProviderCharge !== true
    || Object.keys(body).some((key) => !["actorUserId", "organizationId", "projectAccessId", "confirmedNoProviderCharge"].includes(key))) {
    return json({ error: "assistant_charge_verification_required" }, 400);
  }

  if (organizationId && projectAccessId) {
    const scope = { organizationId, projectAccessId };
    if (!hasCapability(reviewer, "workspace.budget.manage", scope) || !hasCapability(reviewer, "project.author", scope)) {
      return json({ error: "assistant_reconciliation_denied" }, 403);
    }
    const authorized = await env.DB.prepare(`SELECT 1 AS authorized FROM organization_projects project
      JOIN organization_memberships reviewer_membership ON reviewer_membership.organization_id=project.organization_id
        AND reviewer_membership.user_id=? AND reviewer_membership.role IN('owner','administrator')
        AND reviewer_membership.status='active' AND reviewer_membership.accepted_at IS NOT NULL AND reviewer_membership.revoked_at IS NULL
      JOIN organization_memberships actor_membership ON actor_membership.organization_id=project.organization_id
        AND actor_membership.user_id=? AND actor_membership.status='active' AND actor_membership.accepted_at IS NOT NULL AND actor_membership.revoked_at IS NULL
      LEFT JOIN project_memberships reviewer_project ON reviewer_project.project_access_id=project.project_access_id
        AND reviewer_project.organization_id=project.organization_id AND reviewer_project.project_id=project.project_id
        AND reviewer_project.user_id=? AND reviewer_project.status='active' AND reviewer_project.revoked_at IS NULL
      LEFT JOIN project_memberships actor_project ON actor_project.project_access_id=project.project_access_id
        AND actor_project.organization_id=project.organization_id AND actor_project.project_id=project.project_id
        AND actor_project.user_id=? AND actor_project.status='active' AND actor_project.revoked_at IS NULL
      WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active'
        AND(project.owner_user_id=? OR reviewer_project.role IN('owner','editor'))
        AND(project.owner_user_id=? OR actor_project.role IN('owner','editor')) LIMIT 1`)
      .bind(reviewer.userId, actorUserId, reviewer.userId, actorUserId, projectAccessId, organizationId, reviewer.userId, actorUserId).first();
    if (!authorized) return json({ error: "assistant_reconciliation_denied" }, 403);
  }

  await ensureAssistantSchema(env);
  const task = await env.DB.prepare(`SELECT * FROM assistant_specialist_tasks WHERE task_id=? AND actor_user_id=?
    AND organization_id IS ? AND project_access_id IS ? LIMIT 1`)
    .bind(taskId, actorUserId, organizationId, projectAccessId).first<StoredAssistantTask>();
  if (!task) return json({ error: "assistant_task_not_found" }, 404);
  const signed=await env.DB.prepare(`SELECT execution.execution_id,execution.operation,execution.organization_id,execution.project_access_id
    FROM consequential_executions execution WHERE execution.actor_user_id=? AND(execution.execution_id=? OR EXISTS(
      SELECT 1 FROM consequential_execution_steps step WHERE step.execution_id=execution.execution_id AND(step.token_reservation_id=? OR step.cost_reservation_id=?)))
    ORDER BY execution.execution_id=? DESC LIMIT 1`).bind(actorUserId,taskId,task.token_reservation_id,task.cost_reservation_id,taskId)
    .first<{execution_id:string;operation:string;organization_id:string|null;project_access_id:string|null}>();
  if(task.result_json!==null&&task.result_json!==undefined||signed){
    if(signed?.execution_id===taskId&&signed.operation==="assistant-specialist"&&signed.organization_id===organizationId&&signed.project_access_id===projectAccessId){
      // An independent reviewer may finish persisted usage accounting, but this legacy checkbox is not a signed no-charge receipt.
      try{await reconcileConsequentialUsage(env,actorUserId,taskId);}catch{/* Keep the exact retained evidence and remaining hold for free recovery. */}
    }
    return json({error:"assistant_signed_billing_evidence_required",taskId,noAutomaticRetry:true},409);
  }
  const knownUsage=await env.DB.prepare(`SELECT 1 AS present FROM assistant_specialist_tasks task WHERE task.task_id=? AND task.actor_user_id=? AND NOT(${legacyAssistantNoChargeSql("task")})`)
    .bind(taskId,actorUserId).first();
  if(knownUsage)return json({error:"assistant_recorded_usage_cannot_be_reconciled_as_free",taskId,noAutomaticRetry:true},409);
  if (task.status === "reconciled") return json({ taskId, status: "reconciled", idempotent: true });
  if (!["needs-review", "reconciling"].includes(task.status)) return json({ error: "assistant_task_reconciliation_unavailable" }, 409);

  const started = new Date().toISOString();
  const auditId = uuidV7();
  const evidence = { task_id: taskId, actor_user_id: actorUserId, reviewer_user_id: reviewer.userId,
    project_access_id: projectAccessId ?? "", evidence_classification: "verified-no-provider-charge" };
  const statements = [
    env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='reconciling',updated_at=?
      WHERE task_id=? AND actor_user_id=? AND scope_key=? AND organization_id IS ? AND project_access_id IS ?
        AND status IN('needs-review','reconciling') AND ${legacyAssistantNoChargeSql("assistant_specialist_tasks")}`)
      .bind(started, taskId, actorUserId, task.scope_key, organizationId, projectAccessId),
    env.DB.prepare(`INSERT OR IGNORE INTO assistant_billing_reconciliations(reconciliation_id,task_id,actor_user_id,reviewer_user_id,organization_id,project_access_id,evidence_classification,occurred_at)
      SELECT ?,?,?,?,?,?,'verified-no-provider-charge',? WHERE EXISTS(SELECT 1 FROM assistant_specialist_tasks
        WHERE task_id=? AND actor_user_id=? AND scope_key=? AND status='reconciling' AND ${legacyAssistantNoChargeSql("assistant_specialist_tasks")})`)
      .bind(auditId, taskId, actorUserId, reviewer.userId, organizationId, projectAccessId, started, taskId, actorUserId, task.scope_key),
  ];
  if (organizationId) {
    statements.push(env.DB.prepare(`INSERT INTO organization_audit_events(audit_id,organization_id,actor_user_id,action,resource_kind,resource_id,detail_json,occurred_at)
      SELECT ?,?,?, 'AssistantProviderChargeReconciled','assistant-billing',?,?,? WHERE EXISTS(SELECT 1 FROM assistant_billing_reconciliations
        WHERE task_id=? AND actor_user_id=? AND reviewer_user_id=? AND organization_id=? AND project_access_id IS ?)
        AND NOT EXISTS(SELECT 1 FROM organization_audit_events WHERE organization_id=? AND action='AssistantProviderChargeReconciled'
          AND resource_kind='assistant-billing' AND resource_id=? AND actor_user_id=?)
        AND EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.task_id=? AND task.actor_user_id=? AND task.status='reconciling' AND ${legacyAssistantNoChargeSql("task")})`)
      .bind(uuidV7(), organizationId, reviewer.userId, taskId, JSON.stringify(evidence), started,
        taskId, actorUserId, reviewer.userId, organizationId, projectAccessId, organizationId, taskId, reviewer.userId, taskId, actorUserId));
  }
  try {
    const results = await env.DB.batch(statements);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return json({ error: "assistant_task_reconciliation_unavailable" }, 409);
    if(!await env.DB.prepare(`SELECT 1 AS current FROM assistant_specialist_tasks task WHERE task.task_id=? AND task.actor_user_id=? AND task.status=\'reconciling\' AND ${legacyAssistantNoChargeSql("task")}`).bind(taskId,actorUserId).first())
      return json({error:"assistant_recorded_usage_cannot_be_reconciled_as_free",taskId,noAutomaticRetry:true},409);
    await releaseCostBudget(env, actorUserId, task.cost_reservation_id);
    await releaseBudget(env, actorUserId, task.token_reservation_id, { reason: "assistant_admin_verified_no_provider_charge" });
    const ended = new Date().toISOString();
    const completed = await env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='reconciled',error_code=NULL,updated_at=?,completed_at=?
      WHERE task_id=? AND actor_user_id=? AND scope_key=? AND organization_id IS ? AND project_access_id IS ? AND status='reconciling'
        AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status IN('active','executing'))
        AND NOT EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status IN('active','executing'))
        AND EXISTS(SELECT 1 FROM assistant_billing_reconciliations WHERE task_id=? AND actor_user_id=? AND reviewer_user_id=?)
        AND ${legacyAssistantNoChargeSql("assistant_specialist_tasks")}`)
      .bind(ended, ended, taskId, actorUserId, task.scope_key, organizationId, projectAccessId,
        task.cost_reservation_id, actorUserId, task.token_reservation_id, actorUserId, taskId, actorUserId, reviewer.userId).run();
    return Number(completed.meta.changes ?? 0) === 1 ? json({ taskId, status: "reconciled" }) : json({ error: "assistant_reconciliation_incomplete" }, 409);
  } catch { return json({ error: "assistant_reconciliation_incomplete" }, 409); }
}

/** Accepted Memory text is authored work. It is never enrolled in the disposable
 * private-copy graph. Public source identifiers retain negative provenance after
 * the private Memory result retires; no supporting profile text is published. */
async function publishAssistantMemoryEdit(env:WorkerEnv,actor:AuthorizedAssistant,publication:MemoryEditPublication){
  if(!assistantActionsEnabled(env,actor))return json({error:'assistant_authoring_denied'},403);
  const {review,blockId,context,sourceHead,preconditions}=publication,edit=review.edits.find(item=>item.blockId===blockId);
  if(!edit)return json({error:'assistant_memory_edit_invalid'},409);
  const projection=await assistantAuthoritativeProjection(env,actor),checked=authoritativeAssistantEvents(
    {kind:'context.edit',targetBlockId:blockId,text:edit.suggestedText},context,projection,review.turnId);
  if(checked.events.length!==1)return json({error:'assistant_memory_edit_invalid'},409);
  const stream=actor.project?'creative:'+actor.project.ownerUserId:actor.principal.streamId;
  const receipt='memory-edit:'+review.executionId+':'+blockId,now=new Date().toISOString();
  const mutation=checked.events[0]!;
  mutation.payload={...mutation.payload,memory_authored_version:1,source_chat_turn_id:review.turnId,request_id:review.executionId};
  const guard={sql:'NOT EXISTS(SELECT 1 FROM event_client_receipts WHERE stream_id=? AND client_event_id=?)',bindings:[stream,receipt]};
  const assertProof=(proof:BudgetReservationGuard)=>env.DB.prepare("SELECT CASE WHEN ("+proof.sql+") THEN 1 ELSE json('assistant_memory_edit_stale') END AS verified").bind(...proof.bindings);
  const receipts=(eventId:string,sequence:number)=>[
    env.DB.prepare(`INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=? AND type='BlockPropertyEdited'
        AND json_extract(payload,'$.source_chat_turn_id')=? AND json_extract(payload,'$.memory_authored_version')=1)`)
      .bind(stream,receipt,eventId,sequence,now,eventId,stream,sequence,review.turnId),
    env.DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM event_client_receipts WHERE stream_id=? AND client_event_id=? AND event_id=?) THEN 1 ELSE json('assistant_memory_edit_stale') END AS verified")
      .bind(stream,receipt,eventId),
  ];
  let eventId:string;
  if(actor.project){
    const response=await appendProjectEvents(env,actor.project,actor.principal,{action:'batch',events:[mutation],clientId:'web:assistant-memory',correlationId:review.executionId},undefined,{
      preserveGovernance:true,authoringOperation:'memory-edit',expectedOwnerHead:sourceHead,guardSql:guard.sql,guardBindings:guard.bindings,preconditions,
      buildStatements:(lastId,proof,events)=>{if(!proof)throw Error('assistant_memory_edit_stale');return [assertProof(proof),...receipts(lastId,events!.at(-1)!.sequence)];},
    });
    if(!response.ok)return response;
    const body=await response.json() as {appended?:Array<{eventId:string}>};
    if(body.appended?.length!==1||!body.appended[0]?.eventId)throw Error('assistant_memory_edit_unconfirmed');
    eventId=body.appended[0].eventId;
  }else{
    const event=makeEvent(stream,sourceHead+1,'user','web:assistant-memory',review.executionId,mutation.type,mutation.payload);
    eventId=event.eventId;
    const authority=assistantReadAuthorityGuard(actor),placeholders=EVENT_WRITE_COLUMNS.split(',').map(()=>'?').join(',');
    const committed=await env.DB.batch<Record<string,unknown>>([...preconditions,env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${placeholders}
      WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (${authority.sql}) AND (${guard.sql})`)
      .bind(...eventWriteBindings(event),stream,sourceHead,...authority.bindings,...guard.bindings),assertProof(authoringEventProof([event])),...receipts(event.eventId,event.sequence)]);
    if(committed.some(result=>result.success!==true)||committed.at(-1)?.results[0]?.verified!==1)throw Error('assistant_memory_edit_unconfirmed');
  }
  return json({status:'applied',executionId:review.executionId,eventId,blockId,independentEvidence:false,preservedOnMemoryWithdrawal:true});
}

const assistantSpecialistHost:AssistantSpecialistHost={
  authorize:authorizeAssistant,scopeKey:assistantScopeKey,ensure:ensureAssistantSchema,
  kind:(message,context,turnId)=>assistantTaskKind(message,preparedAssistantActions(message,context,turnId)),
  allowedModels:assistantAllowedModels,providerEnrolled:(env,userId)=>featureUsers(env.FORMA_ASSISTANT_PROVIDER_USER_IDS).has(userId),
  solEnrolled:(env,userId)=>featureUsers(env.FORMA_ASSISTANT_SOL_USER_IDS).has(userId),
  turn:exactAssistantTurn,commit:commitAssistantSpecialistResult,applyMemoryEdit:publishAssistantMemoryEdit,
};
export async function handleAssistantSpecialist(request:Request,env:WorkerEnv,execution:WorkerExecutionContext){
  return handleAssistantSpecialistConsent(request,env,execution,assistantSpecialistHost);
}

/** Explicit field-local reuse of one already-paid, retained assistant suggestion.
 * This read neither resumes a task nor creates a turn/quote/provider operation.
 * No browser draft is accepted; the later apply transaction still revalidates
 * its exact full source and canonical replacement. */
export async function handleAssistantFieldSuggestion(request:Request,env:WorkerEnv):Promise<Response>{
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const query=new URL(request.url).searchParams,blockId=query.get('blockId')??'',locale=query.get('locale')??'';
  if(request.url.length>4096||[...query.keys()].some(key=>!['route','projectId','blockId','locale'].includes(key)||query.getAll(key).length!==1)
    ||!blockId||blockId.length>240||!blockId.isWellFormed()||!['en','fr','ar','ja'].includes(locale))return json({error:'assistant_field_request_invalid'},400);
  try{
    const source=new AssistantContextReadWitness(env),authorization=await authorizeAssistant(request,env,source);
    if(authorization.response||!authorization.authorized)return authorization.response!;
    const actor=authorization.authorized,projectId=actor.projectId,documentId=actor.surface.documentId;
    if(!projectId||!documentId||actor.surface.canvasId||!assistantActionsEnabled(env,actor)||!liveMemoryEnabled(env,actor.principal.userId))
      return json({error:'assistant_field_unavailable'},403);
    await ensureAssistantSchema(env);
    const state=await assistantContext(request,env,actor,source,blockId),atom=state.context.decisionAtoms.find(item=>item.id===blockId);
    const emptyValue={version:'memory-field-completion-v1',suggestion:null},empty=()=>json(emptyValue);
    if(!atom||atom.locked||atom.immutable||atom.protected||!atom.providerEligible||atom.providerVisibility!=='editable')return empty();
    const latest=(await recentAssistantTasks(env,actor)).find(entry=>entry.record.status==='completed'
      &&entry.record.scope_key===assistantScopeKey(actor)&&entry.record.document_id===actor.surface.documentId&&entry.record.locale===locale);
    if(!latest)return empty();
    return await certifiedAssistantTaskFeed(env,actor,assistantScopeKey(actor),state,[latest],value=>{
    const feed=value as {contextUnavailable?:boolean;tasks?:Array<{certifiedCompleted?:boolean;completedReview?:{
      executionId:string;turnId:string;quote:{bindingHash:string};originalRequest:{sourceHash:string;locale:string};
      memory?:unknown;result?:{sourceStatus?:string;editReview?:unknown}}}>};
    const completed=feed.tasks?.[0]?.certifiedCompleted&&feed.tasks[0].completedReview;
    const memory=completed&&parseSemanticMemoryAnswerPresentation(completed.memory);
    if(feed.contextUnavailable||!completed||!memory||completed.result?.sourceStatus!=='semantic-memory-assisted'
      ||completed.originalRequest.locale!==locale)return emptyValue;
    const review=parseMemoryEditReview(completed.result.editReview,{executionId:completed.executionId,turnId:completed.turnId,
      projectId,documentId,sourceHash:completed.originalRequest.sourceHash,locale});
    const edit=review?.edits.find(item=>item.blockId===blockId&&item.revision===atom.version&&item.beforeExcerpt===atom.text);
    if(!review||!edit)return emptyValue;
    return {version:'memory-field-completion-v1',suggestion:{review:{...review,edits:[edit]},bindingHash:completed.quote.bindingHash,
      validUntil:memory.validUntil,independentEvidence:false}};
    });
  }catch{return json({error:'assistant_field_unavailable',noAutomaticRetry:true},409);}
}

export async function handleAssistant(request: Request, env: WorkerEnv, execution: WorkerExecutionContext): Promise<Response> {
  if(request.method!=="GET"&&request.method!=="POST")return json({error:"method_not_allowed"},405);
  const source=new AssistantContextReadWitness(env);
  const authorization=await authorizeAssistant(request,env,source);if(authorization.response||!authorization.authorized)return authorization.response!;
  const actor=authorization.authorized;await ensureAssistantSchema(env);const state=await assistantContext(request,env,actor,source);
  if(request.method==="GET"){await resumeAssistantTasks(request,env,actor,execution);return certifiedAssistantTaskFeed(env,actor,assistantScopeKey(actor),state,await recentAssistantTasks(env,actor));}
  let body:{turnId?:unknown;message?:unknown;locale?:unknown;model?:unknown;premiumApproval?:unknown;memoryMode?:unknown};
  try{body=await request.json()as typeof body;}catch{return json({error:"assistant_request_invalid"},400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"assistant_request_invalid"},400);
  const turnId=typeof body.turnId==="string"?body.turnId.trim():"",message=typeof body.message==="string"?body.message.trim():"";
  if(!/^[a-zA-Z0-9_-]{8,80}$/u.test(turnId))return json({error:"assistant_turn_invalid"},400);
  if(!message||message.length>ASSISTANT_CONTEXT_LIMITS.turnChars)return json({error:"assistant_message_invalid"},400);
  if(Object.hasOwn(body,"memoryMode")&&body.memoryMode!=="recall")return json({error:"assistant_memory_mode_invalid"},400);
  // Select from fresh native enrollment and ledger metadata before *any* saved
  // turn early return. No selected structured failure can fall through to v1.
  const memoryPrepared=assistantMemoryPreparedDocument(actor);
  const selection=body.memoryMode==="recall"?await prepareNativeMemorySelection(env,memoryPrepared):undefined;
  if(body.memoryMode==="recall"&&!selection)return json({error:"assistant_memory_unavailable",noAutomaticRetry:true},409);
  const selectionOptions=selection?{memorySelection:selection}:{};
  const selectedTurn=(turn:AssistantTurn)=>selection?turn.memory?.version===(selection.mode==="structured"?"native-memory-answer-v2":"native-memory-answer-v1"):!turn.memory;
  const recallConflict=(turn:AssistantTurn)=>{
    const changedProtocol=turn.user===message&&Boolean(turn.memory)===Boolean(selection)&&Boolean(selection);
    return json({error:changedProtocol?"assistant_memory_unavailable":"assistant_turn_conflict",...(changedProtocol?{noAutomaticRetry:true}:{})},409);
  };
  const previous=await exactAssistantTurn(env,actor,turnId);
  if(previous)return previous.user===message&&selectedTurn(previous)
    ?certifiedAssistantTurnResponse(env,actor,assistantScopeKey(actor),state,previous,200,selectionOptions)
    :recallConflict(previous);
  if(await unavailableNativeMemoryTurn(env,actor,turnId))return json({error:"assistant_turn_unavailable",noAutomaticRetry:true},409);
  // Send always remains zero-cost, even when an old caller supplies a model or premium flag.
  const generationContext=source.context();
  if(!generationContext)return certifiedAssistantTurnResponse(env,actor,assistantScopeKey(actor),state,null,200,{freshContextSource:source,persistenceFailed:true,neverSubmitted:true,...selectionOptions});
  let memory:AssistantRecallMemory|undefined;
  let reply:AssistantReply;
  if(selection?.mode==="structured"){
    const streamId=actor.project?`creative:${actor.project.ownerUserId}`:actor.principal.streamId;
    const sourceHead=source.ownerHead(streamId);
    const preparedDocument=sourceHead===null?null:{...memoryPrepared,sourceHead};
    const originals=preparedDocument?await discoverNativeStructuredConversationOriginals(env,preparedDocument,selection):null;
    const value=originals&&preparedDocument?await prepareNativeStructuredConversationContext(env,originals.enrollment,preparedDocument,originals.captures):null;
    const text=value?nativeStructuredMemoryAssistantReply(value.context,body.locale):null;
    if(!value||!text)return json({error:"assistant_memory_unavailable",noAutomaticRetry:true},409);
    memory={mode:"structured",selection,value};reply={text};
  }else if(selection){
    const memorySource=new AssistantContextReadWitness<NativeDocumentMemoryContext>(env);
    const value=await readNativeDocumentMemory(env,assistantMemoryPreparedDocument(actor),memorySource);
    const text=value?nativeMemoryAssistantReply(value,body.locale):null;
    if(!value||!text||!await nativeMemoryOriginCapture(value))return json({error:"assistant_memory_unavailable",noAutomaticRetry:true},409);
    memorySource.seal(value);
    if(!memorySource.statements().length)return json({error:"assistant_memory_unavailable",noAutomaticRetry:true},409);
    memory={mode:"extractive",selection,value,source:memorySource};reply={text};
  }else reply=answerFor(generationContext,message,body.locale);
  const originalMemorySource=memory?.mode==="structured"?(()=>{
    const value=memory.value;
    return{statements:()=>nativeStructuredConversationContextPrecommitStatements(env,value.proof)??[],
      matches:(results:readonly D1Result<Record<string,unknown>>[])=>nativeStructuredConversationContextMatches(env,value,results)};
  })():memory?.source;
  const actions=!memory&&assistantActionsEnabled(env,actor)?preparedAssistantActions(message,generationContext,turnId):[];
  const actionProposals:AssistantProposal[]=actions.map(({id,turnId:sourceTurn,key,summary,action})=>({id,turnId:sourceTurn,key,summary,kind:action.kind})),proposal=memory?null:actionProposals[0]??proposalFor(generationContext,turnId,actor.canPropose);
  const originalRequest={...savedAssistantRequest(request,actor,turnId,responseLocale(body.locale)),...(memory?{memoryMode:"recall"}:{})},requestJson=JSON.stringify(originalRequest);
  const expected={user:message,reply:localizedAnswer(reply,body.locale),requestJson,presentation:reply,actions,proposal};
  let prepared:Awaited<ReturnType<typeof prepareAssistantTurn>>|undefined;
  try{
    prepared=await prepareAssistantTurn(env,actor,{turnId,message,reply:expected.reply,proposal,documentId:generationContext.scope.documentId,actions,requestJson,memory},source);
    if(!prepared.publicationCurrent())throw new Error("assistant_memory_unavailable");
    await env.DB.batch(prepared.statements);
  }catch{
    // Keep the prepared, server-allocated footprint even if a successful batch
    // lost its response. Never advance the head and reuse the old derivation.
    const accepted=await exactAssistantTurn(env,actor,turnId,expected);
    if(accepted&&prepared&&selectedTurn(accepted)&&(!prepared.structuredOriginId||assistantMemoryOriginIds.get(accepted)===prepared.structuredOriginId))return certifiedAssistantTurnResponse(env,actor,assistantScopeKey(actor),await refreshAssistantMemoryHistory(env,actor,state),accepted,200,{freshContextSource:prepared.source,
      ...(prepared.memorySource?{freshMemorySource:prepared.memorySource}:{}),...selectionOptions,allowConcurrentDuplicateIf:prepared.competingSendGuard});
    if(memory?.mode==="structured"&&!prepared)return json({error:"assistant_memory_unavailable",noAutomaticRetry:true},409);
    const concurrent=await exactAssistantTurn(env,actor,turnId);
    if(concurrent)return concurrent.user===message&&selectedTurn(concurrent)?certifiedAssistantTurnResponse(env,actor,assistantScopeKey(actor),await refreshAssistantMemoryHistory(env,actor,state),concurrent,200,
      {...selectionOptions,...(prepared?{freshContextSource:prepared.source,allowConcurrentDuplicateIf:prepared.competingSendGuard,
        // A different persisted origin is independently certified. It cannot use
        // our own-final proof; this branch proves our complete candidate absent.
        ...(memory?.mode==="structured"?{requireConcurrentDuplicate:true}:prepared.memorySource?{freshMemorySource:prepared.memorySource}:{})}:{})})
      :recallConflict(concurrent);
    return certifiedAssistantTurnResponse(env,actor,assistantScopeKey(actor),state,null,200,{freshContextSource:source,
      // A failed write can report a retryable persistence error only while its
      // ORIGINAL strict derivation still holds and its complete candidate is absent.
      ...(originalMemorySource?{freshMemorySource:originalMemorySource}:{}),...selectionOptions,persistenceFailed:true,
      ...(prepared?{allowConcurrentDuplicateIf:prepared.competingSendGuard,...(memory?.mode==="structured"?{requireConcurrentDuplicate:true}:{})}:{neverSubmitted:true})});
  }
  const committed=await exactAssistantTurn(env,actor,turnId,expected);
  return certifiedAssistantTurnResponse(env,actor,assistantScopeKey(actor),await refreshAssistantMemoryHistory(env,actor,state),committed,201,{freshContextSource:prepared.source,
    ...(prepared.memorySource?{freshMemorySource:prepared.memorySource}:{}),...selectionOptions});
}
