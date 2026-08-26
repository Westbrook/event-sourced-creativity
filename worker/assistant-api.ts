import { foldCanvasEvents } from "../src/canvas/model.ts";
import { ASSISTANT_MESSAGES } from "../src/components/design-system/locales/assistant-messages.ts";
import { isBlockKind } from "../src/model/block-types.ts";
import { ASSISTANT_MODELS, selectAssistantModel, type AssistantModel, type AssistantTask } from "../src/model/assistant-model-policy.ts";
import { assistantSurfaceForRoute, type AssistantSurface } from "../src/model/assistant-route-policy.ts";
import { ASSISTANT_STATE_EVENT_SQL } from "../src/model/assistant-event-views.ts";
import { assistantActionEvents, normalizeAssistantActions, type AssistantContextAction } from "../src/model/assistant-proposals.ts";
import { validateContextCompositionGraph } from "../src/model/combined-context.ts";
import { ASSISTANT_CONTEXT_LIMITS, boundAssistantContext, compileAssistantContext, protectedAssistantDecision, type AssistantContext } from "../src/model/conversation-context.ts";
import { foldEvents, type CreativeEvent, type EventInput } from "../src/model/events.ts";
import { outputBlockRemovalEvents, outputBlockTextEditEvents } from "../src/model/output-authoring.ts";
import type { FormaCapability } from "../src/platform/capabilities.ts";
import { readCanvasGovernance } from "./canvas-governance-policy.ts";
import {
  claimCostBudgetReservation,
  hasCapability,
  pilotExecutionAllowance,
  readAccountBudgets,
  releaseBudget,
  releaseCostBudget,
  requireCapability,
  requireConsent,
  requireUser,
  reserveBudget,
  reserveCostBudget,
  settleBudget,
  settleCostBudget,
  type PilotUser,
} from "./pilot-policy.ts";
import { AssistantProviderRejectedError, requestAssistantProvider, type AssistantProviderResult } from "./assistant-provider.ts";
import { governedPackageSourceRightsCurrent } from "./context-package-rights.ts";
import { appendProjectEvents, readProjectAssistantEventView, readProjectEventPage, readProjectRequestContext, type ProjectRequestContext } from "./project-access.ts";
import { priceTextUsageBreakdownMicrousd } from "./replay-cost.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, serializeEvent, streamHead, uuidV7, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";

type AssistantReply = { key?: string; values?: Record<string, string | number>; text?: string };
type AssistantProposal = { id: string; key: string; route?: string; kind: "navigate" | AssistantContextAction["kind"]; turnId: string; summary?: string };
type AssistantTurn = { id: string; user: string; reply: AssistantReply; proposal: AssistantProposal | null; proposals?: AssistantProposal[] };
type AuthorizedAssistant = { principal: PilotUser; project: ProjectRequestContext | null; surface: AssistantSurface; projectId: string | null; canPropose: boolean };
type PreparedAssistantAction = {
  id: string;
  turnId: string;
  action: AssistantContextAction;
  key: string;
  summary: string;
  sourceVersions: Array<{ blockId: string; version: number }>;
};
type AssistantTurnRow = { turn_id: string; proposal_json: string | null; user_content: string; assistant_content: string };
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
type PreparedAssistantTask = {
  id: string;
  turnId: string;
  kind: AssistantTask;
  model: AssistantModel;
  tokenReservationId: string;
  costReservationId: string;
  estimatedMicrousd: number;
  inputTokens: number;
  outputTokens: number;
  locale: string;
};
type StoredAssistantTask = {
  task_id: string;
  actor_user_id: string;
  scope_key: string;
  turn_id: string;
  organization_id: string | null;
  project_access_id: string | null;
  project_id: string | null;
  document_id: string | null;
  task_kind: string;
  selected_model: string;
  token_reservation_id: string;
  cost_reservation_id: string;
  estimated_microusd: number;
  maximum_input_tokens: number;
  maximum_output_tokens: number;
  locale: string;
  permission_epoch: string;
  status: string;
  error_code: string | null;
  lease_expires_at: string | null;
  provider_submitted: number;
};

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

function assistantProviderEnabled(env: WorkerEnv, actor: AuthorizedAssistant) {
  const scope = actor.project ? { organizationId: actor.project.organizationId, projectAccessId: actor.project.projectAccessId } : undefined;
  return Boolean(env.OPENAI_API_KEY && featureUsers(env.FORMA_ASSISTANT_PROVIDER_USER_IDS).has(actor.principal.userId)
    && actor.canPropose && (scope ? hasCapability(actor.principal, "project.output.request", scope)
      : actor.principal.access.capabilities.includes("project.output.request")));
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

async function prepareAssistantTask(env: WorkerEnv, actor: AuthorizedAssistant, input: {
  turnId: string;
  message: string;
  actions: PreparedAssistantAction[];
  locale: unknown;
  model: unknown;
  premiumApproval: unknown;
}): Promise<PreparedAssistantTask | null> {
  if (!assistantProviderEnabled(env, actor)) return null;
  const scope = actor.project ? { organizationId: actor.project.organizationId, projectAccessId: actor.project.projectAccessId, actorUserId: actor.principal.userId } : undefined;
  if (!(await pilotExecutionAllowance(env, actor.principal.userId, scope)).allowed) return null;
  const budgets = await readAccountBudgets(env, actor.principal.userId, scope?.organizationId);
  const kind = assistantTaskKind(input.message, input.actions);
  const premiumApproved = input.premiumApproval === true && actor.principal.role === "admin"
    && featureUsers(env.FORMA_ASSISTANT_SOL_USER_IDS).has(actor.principal.userId);
  const selection = selectAssistantModel(kind, {
    allowedModels: assistantAllowedModels(env),
    remainingMicrousd: Math.min(budgets.costBudgets.user.remainingMicrousd, budgets.costBudgets.workspace.remainingMicrousd),
    premiumApproved,
    ...(typeof input.model === "string" ? { requestedModel: input.model } : {}),
  });
  if (selection.blocked || !selection.model) return null;
  const streamId = actor.project ? `creative:${actor.project.ownerUserId}` : actor.principal.streamId;
  const correlation = `assistant-specialist:${actor.principal.userId}:${input.turnId}`;
  const token = await reserveBudget(env, actor.principal.userId, selection.inputTokens + selection.outputTokens, {
    streamId,
    correlationId: correlation,
    operation: `assistant:${kind}:${selection.model}`,
    ...(scope ? { projectScope: scope } : {}),
  });
  if (!token.ok) return null;
  try {
    const cost = await reserveCostBudget(env, actor.principal.userId, selection.estimatedMicrousd, {
      maximumMicrousd: selection.estimatedMicrousd,
      allowUserOverage: false,
      period: token.period,
      streamId,
      correlationId: correlation,
      operation: `assistant:${kind}:${selection.model}`,
      ...(scope ? { projectScope: scope } : {}),
    });
    if (!cost.ok) {
      await releaseBudget(env, actor.principal.userId, token.reservationId, { reason: "assistant_cost_budget_unavailable" });
      return null;
    }
    return {
      id: uuidV7(),
      turnId: input.turnId,
      kind,
      model: selection.model,
      tokenReservationId: token.reservationId,
      costReservationId: cost.reservationId,
      estimatedMicrousd: selection.estimatedMicrousd,
      inputTokens: selection.inputTokens,
      outputTokens: selection.outputTokens,
      locale: responseLocale(input.locale),
    };
  } catch {
    await releaseBudget(env, actor.principal.userId, token.reservationId, { reason: "assistant_admission_failed" });
    return null;
  }
}

async function releasePreparedAssistantTask(env: WorkerEnv, actor: AuthorizedAssistant, task: PreparedAssistantTask | null) {
  if (!task) return;
  const retained = await env.DB.prepare("SELECT 1 AS present FROM assistant_specialist_tasks WHERE task_id=? AND actor_user_id=?")
    .bind(task.id, actor.principal.userId).first();
  if (retained) return;
  await releaseCostBudget(env, actor.principal.userId, task.costReservationId);
  await releaseBudget(env, actor.principal.userId, task.tokenReservationId, { reason: "assistant_turn_not_committed" });
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

async function authorizeAssistant(request: Request, env: WorkerEnv): Promise<{ authorized: AuthorizedAssistant | null; response: Response | null }> {
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
  const project = selected.context;
  const scope = project ? { organizationId: project.organizationId, projectAccessId: project.projectAccessId } : undefined;
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
    const owned = await env.DB.prepare("SELECT 1 AS authorized FROM events WHERE stream_id=? AND type='ProjectCreated' AND json_extract(payload,'$.project_id')=? LIMIT 1")
      .bind(principal.streamId, requestedProjectId).first();
    if (!owned) return { authorized: null, response: json({ error: "assistant_project_denied" }, 403) };
    projectId = requestedProjectId;
  }
  if (surface.documentId) {
    if (project) {
      const resource = await env.DB.prepare("SELECT 1 AS authorized FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND resource_kind='document' AND resource_id=? LIMIT 1")
        .bind(project.projectAccessId, project.organizationId, project.projectId, project.ownerUserId, surface.documentId).first();
      if (!resource) return { authorized: null, response: json({ error: "assistant_document_denied" }, 403) };
    } else {
      const resource = await env.DB.prepare(`SELECT COALESCE(json_extract(document.payload,'$.project_id'),
        (SELECT json_extract(project.payload,'$.project_id') FROM events project WHERE project.stream_id=document.stream_id
          AND project.sequence<=document.sequence AND project.type IN('ProjectCreated','ProjectOpened') ORDER BY project.sequence DESC LIMIT 1)) AS project_id
        FROM events document WHERE document.stream_id=? AND document.type='DocumentCreated' AND json_extract(document.payload,'$.document_id')=? LIMIT 1`)
        .bind(principal.streamId, surface.documentId).first<{ project_id: string }>();
      if (!resource || projectId && String(resource.project_id) !== projectId) return { authorized: null, response: json({ error: "assistant_document_denied" }, 403) };
      projectId = String(resource.project_id);
    }
  }
  return { authorized: { principal, project, surface, projectId, canPropose: !project || hasCapability(principal, "project.author", scope) }, response: null };
}

async function scopedAssistantEvents(env: WorkerEnv, actor: AuthorizedAssistant) {
  if (actor.project) {
    const headRow = await env.DB.prepare("SELECT COALESCE(MAX(project_sequence),0) AS head FROM project_event_scopes WHERE project_access_id=? AND organization_id=?")
      .bind(actor.project.projectAccessId, actor.project.organizationId).first<{ head: number }>();
    const head = Number(headRow?.head ?? 0);
    const state = await readProjectAssistantEventView(env, actor.project, { documentId: actor.surface.documentId, canvasId: actor.surface.canvasId });
    const recent = await readProjectEventPage(env, actor.project, Math.max(0, head - 32), 32, false);
    return [...new Map([...state, ...recent.events].map((event) => [event.eventId, event])).values()]
      .filter((event) => event.type !== "ProjectResourceRestricted")
      .sort((left, right) => left.sequence - right.sequence) as CreativeEvent[];
  }
  const head = await streamHead(env, actor.principal.streamId);
  const documentId = actor.surface.documentId ?? "", canvasId = actor.surface.canvasId ?? "", projectId = actor.projectId ?? "";
  const joins = "FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL";
  const documentProject = "COALESCE(json_extract(event.payload,'$.project_id'),(SELECT json_extract(previous.payload,'$.project_id') FROM events previous WHERE previous.stream_id=event.stream_id AND previous.sequence<=event.sequence AND previous.type IN('ProjectCreated','ProjectOpened') ORDER BY previous.sequence DESC LIMIT 1))";
  const eventDocument = "COALESCE(json_extract(event.payload,'$.document_id'),(SELECT json_extract(previous.payload,'$.document_id') FROM events previous WHERE previous.stream_id=event.stream_id AND previous.sequence<=event.sequence AND previous.type IN('DocumentCreated','DocumentOpened') ORDER BY previous.sequence DESC LIMIT 1))";
  const bootstrap = env.DB.prepare(`SELECT event.*,secret.private_json ${joins} WHERE event.stream_id=?
    AND(event.type IN('ProjectCreated','ProjectOpened','ProjectRenamed') AND(?='' OR json_extract(event.payload,'$.project_id')=?)
      OR event.type IN('DocumentCreated','DocumentForked','DocumentRenamed','DocumentRemoved','DocumentRestored')
        AND((?<>'' AND json_extract(event.payload,'$.document_id')=?) OR(?='' AND(?='' OR ${documentProject}=?)))
      OR event.type IN('CanvasCreated','CanvasRenamed','CanvasRemoved','CanvasRestored') AND(?='' OR json_extract(event.payload,'$.canvas_id')=?) AND(?='' OR json_extract(event.payload,'$.project_id')=?))
    ORDER BY event.sequence DESC LIMIT 128`).bind(actor.principal.userId, actor.principal.streamId, projectId, projectId, documentId, documentId, documentId, projectId, projectId, canvasId, canvasId, projectId, projectId);
  const semantic = env.DB.prepare(`SELECT event.*,secret.private_json ${joins} WHERE event.stream_id=? AND event.type IN(${ASSISTANT_STATE_EVENT_SQL})
    AND((?='' AND ?='') AND(?='' OR json_extract(event.payload,'$.project_id')=? OR event.type='DocumentCreated' AND ${documentProject}=?)
      OR ${eventDocument}=? OR json_extract(event.payload,'$.canvas_id')=? OR json_extract(event.payload,'$.source_canvas_id')=?
      OR event.type IN('ProjectCreated','ProjectOpened','ProjectRenamed') AND json_extract(event.payload,'$.project_id')=?)
    ORDER BY event.sequence DESC LIMIT 384`).bind(actor.principal.userId, actor.principal.streamId, documentId, canvasId, projectId, projectId, projectId, documentId, canvasId, canvasId, projectId);
  const boundaries = env.DB.prepare(`SELECT event.*,secret.private_json ${joins} WHERE event.stream_id=? AND event.type='BlockCreated'
    AND(?='' OR ${eventDocument}=?)
    AND(json_extract(event.payload,'$.type')='exclusion' OR json_extract(secret.private_json,'$.properties.intent')='prohibit' OR json_extract(secret.private_json,'$.properties.locked')=1)
    ORDER BY event.sequence DESC LIMIT 32`).bind(actor.principal.userId, actor.principal.streamId, documentId, documentId);
  const latest = env.DB.prepare(`SELECT event.*,secret.private_json ${joins} WHERE event.stream_id=? AND event.sequence>? ORDER BY event.sequence ASC LIMIT 32`)
    .bind(actor.principal.userId, actor.principal.streamId, Math.max(0, head - 32));
  const results = await env.DB.batch<Record<string, unknown>>([bootstrap, semantic, boundaries, latest]);
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

async function pendingTurnProposals(env: WorkerEnv, actor: AuthorizedAssistant, turnId: string, raw: string | null): Promise<AssistantProposal[]> {
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
  const rows = await env.DB.prepare(`SELECT proposal.proposal_id,proposal.action_kind,content.content
    FROM assistant_action_proposals proposal JOIN private_content content
      ON content.content_id=proposal.action_content_ref AND content.owner_id=proposal.actor_user_id
        AND content.redacted_at IS NULL AND content.expires_at>?
    WHERE proposal.actor_user_id=? AND proposal.scope_key=? AND proposal.turn_id=?
      AND proposal.status='pending' AND proposal.expires_at>?
    ORDER BY proposal.created_at,proposal.proposal_id`).bind(now, actor.principal.userId, assistantScopeKey(actor), turnId, now)
    .all<{ proposal_id: string; action_kind: string; content: string }>();
  const pending = new Map(rows.results.map((row) => [String(row.proposal_id), row]));
  return metadata.flatMap((proposal) => {
    if (proposal.kind === "navigate") return [proposal];
    const row = pending.get(proposal.id);
    if (!row || row.action_kind !== proposal.kind) return [];
    try {
      const action = JSON.parse(row.content) as AssistantContextAction;
      if (action.kind !== proposal.kind) return [];
      const summary = action.kind === "context.create" || action.kind === "context.edit" ? String(action.text ?? "").slice(0, 600) : "";
      return [{ ...proposal, ...(summary ? { summary } : {}) }];
    } catch { return []; }
  });
}

async function assistantTurnFromRow(env: WorkerEnv, actor: AuthorizedAssistant, row: AssistantTurnRow): Promise<AssistantTurn> {
  const proposals = await pendingTurnProposals(env, actor, String(row.turn_id), row.proposal_json);
  return {
    id: String(row.turn_id),
    user: String(row.user_content),
    reply: { text: String(row.assistant_content) },
    proposal: proposals[0] ?? null,
    ...(proposals.length > 1 ? { proposals } : {}),
  };
}

async function recentAssistantTurns(env: WorkerEnv, actor: AuthorizedAssistant): Promise<AssistantTurn[]> {
  if (!actor.surface.documentId) {
    const rows = await env.DB.prepare(`SELECT turn.turn_id,turn.proposal_json,authored.content AS user_content,answer.content AS assistant_content
      FROM assistant_turns turn
      JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.redacted_at IS NULL AND authored.expires_at>?
      JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.redacted_at IS NULL AND answer.expires_at>?
      WHERE turn.actor_user_id=? AND turn.scope_key=?
      ORDER BY turn.created_at DESC LIMIT ?`)
      .bind(new Date().toISOString(), new Date().toISOString(), actor.principal.userId, assistantScopeKey(actor), ASSISTANT_CONTEXT_LIMITS.turns)
      .all<AssistantTurnRow>();
    return Promise.all(rows.results.reverse().map((row) => assistantTurnFromRow(env, actor, row)));
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
    guard = " AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes custody WHERE custody.content_id=authored.content_id)"
      + " AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes custody WHERE custody.content_id=answer.content_id)";
  }

  const rows = await env.DB.prepare(`SELECT json_extract(message.payload,'$.turn_id') AS turn_id,metadata.proposal_json,authored.content AS user_content,answer.content AS assistant_content
    FROM events message INDEXED BY idx_events_stream_type
    JOIN private_content authored ON authored.content_id=json_extract(message.payload,'$.content_ref') AND authored.owner_id=?
      AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>?
    JOIN events response INDEXED BY idx_events_correlation ON response.correlation_id=message.correlation_id AND response.stream_id=message.stream_id
      AND response.type='AssistantReasoned' AND json_extract(response.payload,'$.operation')='creative-chat'
      AND json_extract(response.payload,'$.document_id')=? AND json_extract(response.payload,'$.turn_id')=json_extract(message.payload,'$.turn_id')
    JOIN private_content answer ON answer.content_id=json_extract(response.payload,'$.content_ref') AND answer.owner_id=?
      AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>?
    LEFT JOIN assistant_turns metadata ON metadata.actor_user_id=? AND metadata.scope_key=? AND metadata.turn_id=json_extract(message.payload,'$.turn_id')
    WHERE message.stream_id=? AND message.type='ChatMessageSent' AND json_extract(message.payload,'$.document_id')=?${guard}
    ORDER BY message.sequence DESC,response.sequence DESC LIMIT ?`)
    .bind(actor.principal.userId, now, actor.surface.documentId, actor.principal.userId, now, actor.principal.userId,
      assistantScopeKey(actor), stream, actor.surface.documentId, ...bindings, ASSISTANT_CONTEXT_LIMITS.turns * 3)
    .all<AssistantTurnRow>();
  const seen = new Set<string>();
  const unique = rows.results.filter((row) => {
    const id = String(row.turn_id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, ASSISTANT_CONTEXT_LIMITS.turns).reverse();
  return Promise.all(unique.map((row) => assistantTurnFromRow(env, actor, row)));
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

async function exactAssistantTurn(env: WorkerEnv, actor: AuthorizedAssistant, turnId: string): Promise<AssistantTurn | null> {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT turn.turn_id,turn.proposal_json,authored.content AS user_content,answer.content AS assistant_content
    FROM assistant_turns turn
    JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.redacted_at IS NULL AND authored.expires_at>?
    JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.redacted_at IS NULL AND answer.expires_at>?
    WHERE turn.actor_user_id=? AND turn.scope_key=? AND turn.turn_id=? LIMIT 1`)
    .bind(now, now, actor.principal.userId, assistantScopeKey(actor), turnId)
    .first<AssistantTurnRow>();
  if (!row) return null;
  return assistantTurnFromRow(env, actor, row);
}

async function assistantContext(request: Request, env: WorkerEnv, actor: AuthorizedAssistant) {
  const candidates = await scopedAssistantEvents(env, actor);
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
  });
  if(actor.project&&!await governedPackageSourceRightsCurrent(env,actor.project.organizationId,projection.blocks))
    context.totals.unsafeRightsDecisions=Math.max(1,Number(context.totals.unsafeRightsDecisions??0));
  const turns = await recentAssistantTurns(env, actor);
  context.recentTurns = turns.slice(-Math.floor(ASSISTANT_CONTEXT_LIMITS.turns / 2)).flatMap((turn, index) => [
    { id: `${turn.id}:user`, role: "user" as const, text: turn.user.slice(0, ASSISTANT_CONTEXT_LIMITS.turnChars), sequence: index * 2 },
    { id: `${turn.id}:assistant`, role: "assistant" as const, text: String(turn.reply.text ?? turn.reply.key ?? "").slice(0, ASSISTANT_CONTEXT_LIMITS.turnChars), sequence: index * 2 + 1 },
  ]);
  return { context:boundAssistantContext(context), turns };
}

async function commitAssistantTurn(env: WorkerEnv, actor: AuthorizedAssistant, input: {
  turnId: string;
  message: string;
  reply: string;
  proposal: AssistantProposal | null;
  documentId: string | null;
  actions?: PreparedAssistantAction[];
  task?: PreparedAssistantTask | null;
}) {
  const scope = actor.project;
  const policy = scope ? await env.DB.prepare("SELECT transient_days,version FROM organization_retention_policies WHERE organization_id=?").bind(scope.organizationId)
    .first<{ transient_days: number; version: number }>() : null;
  const now = new Date();
  const createdAt = now.toISOString();
  const retentionDays = Math.max(1, Math.min(365, Number(policy?.transient_days ?? Number(env.FORMA_RETENTION_DAYS ?? 30)) || 30));
  const expiresAt = new Date(now.getTime() + retentionDays * 86_400_000).toISOString();
  const authoredId = uuidV7();
  const answerId = uuidV7();
  const actions = input.actions ?? [];
  const actionContents = new Map(actions.map((action) => [action.id, uuidV7()]));
  const active = `EXISTS(SELECT 1 FROM project_context_sessions context
      JOIN organization_projects project ON project.project_access_id=context.project_access_id AND project.organization_id=context.organization_id AND project.status='active'
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
      LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
      WHERE context.context_id=? AND context.principal_user_id=? AND context.revoked_at IS NULL AND context.expires_at>? AND project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND(project.owner_user_id=? OR project_member.membership_id IS NOT NULL))`;

  const statements: D1PreparedStatement[] = [];
  const privateEntries: Array<[string, string, string]> = [
    [authoredId, "chat-user", input.message],
    [answerId, "chat-assistant", input.reply],
    ...actions.map((action): [string, string, string] => [actionContents.get(action.id)!, "assistant-action", JSON.stringify(action.action)]),
  ];
  for (const [contentId, kind, content] of privateEntries) {
    if (scope) {
      statements.push(env.DB.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) SELECT ?,?,?,?,?,?,NULL WHERE ${active}`)
        .bind(contentId, actor.principal.userId, kind, content, createdAt, expiresAt, actor.principal.userId, actor.principal.userId, scope.contextId, actor.principal.userId, createdAt, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, actor.principal.userId));
      statements.push(env.DB.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) SELECT ?,'content',?,?,?,?,'actor_private',NULL,?,? WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)")
        .bind(scope.projectAccessId, contentId, scope.organizationId, scope.projectId, scope.ownerUserId, actor.principal.userId, createdAt, contentId, actor.principal.userId));
      statements.push(env.DB.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) SELECT ?,?,?,?,?,'transient-private',?,?,? WHERE EXISTS(SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND resource_kind='content' AND resource_id=? AND actor_user_id=?)")
        .bind(contentId, scope.organizationId, scope.projectAccessId, scope.projectId, actor.principal.userId, Number(policy?.version ?? 0), expiresAt, createdAt, scope.projectAccessId, scope.organizationId, contentId, actor.principal.userId));
    } else {
      statements.push(env.DB.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
        .bind(contentId, actor.principal.userId, kind, content, createdAt, expiresAt));
    }
  }

  const streamId = scope ? `creative:${scope.ownerUserId}` : actor.principal.streamId;
  const correlation = `${actor.principal.userId}:${input.turnId}`;
  const head = await streamHead(env, streamId);
  const base = { ...(actor.projectId ? { project_id: actor.projectId } : {}), ...(input.documentId ? { document_id: input.documentId } : {}), actor_user_id: actor.principal.userId, source_surface: actor.surface.page, turn_id: input.turnId };
  const authored = makeEvent(streamId, head + 1, `user:${actor.principal.userId}`, "web:assistant", correlation, "ChatMessageSent", { ...base, content_ref: authoredId });
  const answer = makeEvent(streamId, head + 2, `user:${actor.principal.userId}`, "web:assistant", correlation, "AssistantReasoned", { ...base, operation: "creative-chat", content_ref: answerId, deterministic: true, ...(actions.length ? { proposal_count: actions.length } : {}) }, { causationId: authored.eventId });
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
  for (const [index, event] of [authored, answer, ...proposals].entries()) {
    statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${placeholders} WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`)
      .bind(...eventWriteBindings(event), streamId, head + index));
    statements.push(env.DB.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=?)")
      .bind(streamId, receipts[index], event.eventId, event.sequence, createdAt, event.eventId, streamId));
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
  if (input.task) {
    const task = input.task;
    statements.push(env.DB.prepare(`INSERT INTO assistant_specialist_tasks(task_id,actor_user_id,scope_key,turn_id,organization_id,project_access_id,project_id,document_id,
      route_family,task_kind,selected_model,token_reservation_id,cost_reservation_id,estimated_microusd,maximum_input_tokens,maximum_output_tokens,locale,
      permission_epoch,status,error_code,created_at,updated_at,started_at,completed_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',NULL,?,?,NULL,NULL
      WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)
        AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)`)
      .bind(task.id, actor.principal.userId, assistantScopeKey(actor), input.turnId, scope?.organizationId ?? null, scope?.projectAccessId ?? null,
        actor.projectId, input.documentId, actor.surface.canonicalFamily, task.kind, task.model, task.tokenReservationId, task.costReservationId,
        task.estimatedMicrousd, task.inputTokens, task.outputTokens, task.locale, actor.principal.access.permissionEpoch, createdAt, createdAt,
        authoredId, actor.principal.userId, answerId, actor.principal.userId));
  }

  const complete = `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)
    AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)
    AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)
    AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)
    AND EXISTS(SELECT 1 FROM event_client_receipts WHERE stream_id=? AND client_event_id=? AND event_id=?)
    AND EXISTS(SELECT 1 FROM event_client_receipts WHERE stream_id=? AND client_event_id=? AND event_id=?)
    AND (SELECT COUNT(*) FROM assistant_action_proposals WHERE actor_user_id=? AND scope_key=? AND turn_id=? AND status='pending')=?
    AND (?='' OR EXISTS(SELECT 1 FROM assistant_specialist_tasks WHERE task_id=? AND actor_user_id=? AND scope_key=? AND turn_id=? AND status='queued'))`;
  const encodedProposal = actions.length
    ? JSON.stringify({ proposals: actions.map(({ id, turnId, key, action }) => ({ id, turnId, key, kind: action.kind })) })
    : input.proposal ? JSON.stringify(input.proposal) : null;
  // NULL violates the NOT NULL status constraint and atomically rolls back every
  // private row, scope, event, and receipt if authorization or the event head moved.
  statements.push(env.DB.prepare(`INSERT INTO assistant_turns(turn_id,actor_user_id,scope_key,organization_id,project_access_id,project_id,document_id,route_family,user_content_ref,assistant_content_ref,proposal_json,permission_epoch,status,created_at,completed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ${complete} THEN 'completed' ELSE NULL END,?,?)`).bind(
    input.turnId, actor.principal.userId, assistantScopeKey(actor), scope?.organizationId ?? null, scope?.projectAccessId ?? null, actor.projectId, input.documentId,
    actor.surface.canonicalFamily, authoredId, answerId, encodedProposal, actor.principal.access.permissionEpoch,
    authoredId, actor.principal.userId, answerId, actor.principal.userId, authored.eventId, streamId, head + 1, answer.eventId, streamId, head + 2,
    streamId, receipts[0], authored.eventId, streamId, receipts[1], answer.eventId,
    actor.principal.userId, assistantScopeKey(actor), input.turnId, actions.length,
    input.task?.id ?? "", input.task?.id ?? "", actor.principal.userId, assistantScopeKey(actor), input.turnId, createdAt, createdAt,
  ));

  await env.DB.batch(statements);
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
  const placeholders = EVENT_WRITE_COLUMNS.split(",").map(() => "?").join(",");
  for (const [index, current] of events.entries()) {
    const receipt = `assistant-${decision}:${actor.principal.userId}:${proposal.proposal_id}:${index}`;
    statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${placeholders}
      WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND ${guard.sql}`)
      .bind(...eventWriteBindings(current), streamId, head + index, ...guard.bindings));
    statements.push(env.DB.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND actor=?)")
      .bind(streamId, receipt, current.eventId, current.sequence, now, current.eventId, streamId, `user:${actor.principal.userId}`));
  }
  statements.push(env.DB.prepare(`UPDATE assistant_action_proposals SET status=?,resolved_at=?
    WHERE proposal_id=? AND actor_user_id=? AND scope_key=? AND status='pending' AND permission_epoch=? AND expires_at>?`)
    .bind(decision, now, proposal.proposal_id, actor.principal.userId, assistantScopeKey(actor), actor.principal.access.permissionEpoch, now));
  const eventChecks = events.map(() => "EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND actor=?)").join(" AND ");
  statements.push(env.DB.prepare(`INSERT INTO assistant_action_commits(commit_id,verified,created_at)
    VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM assistant_action_proposals WHERE proposal_id=? AND actor_user_id=? AND scope_key=? AND status=?)
      AND ${eventChecks} THEN 1 ELSE 0 END,?)`)
    .bind(`${proposal.proposal_id}:${decision}`, proposal.proposal_id, actor.principal.userId, assistantScopeKey(actor), decision,
      ...events.flatMap((current) => [current.eventId, streamId, `user:${actor.principal.userId}`]), now));
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

function assistantTaskGuard(actor: AuthorizedAssistant, task: StoredAssistantTask, now: string) {
  const project = activeAssistantProjectGuard(actor, now);
  const sql = `EXISTS(SELECT 1 FROM assistant_specialist_tasks specialist JOIN assistant_turns turn
      ON turn.actor_user_id=specialist.actor_user_id AND turn.scope_key=specialist.scope_key AND turn.turn_id=specialist.turn_id
      JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id
        AND answer.redacted_at IS NULL AND answer.expires_at>?
      WHERE specialist.task_id=? AND specialist.actor_user_id=? AND specialist.scope_key=? AND specialist.turn_id=?
        AND specialist.permission_epoch=? AND specialist.selected_model=? AND specialist.status='running')${project.sql}`;
  return {
    sql,
    bindings: [now, task.task_id, actor.principal.userId, assistantScopeKey(actor), task.turn_id,
      actor.principal.access.permissionEpoch, task.selected_model, ...project.bindings] as Array<string | number | null>,
  };
}

async function commitAssistantSpecialistResult(env: WorkerEnv, actor: AuthorizedAssistant, task: StoredAssistantTask,
  result: AssistantProviderResult, context: AssistantContext) {
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
  const guard = assistantTaskGuard(actor, task, createdAt);
  const streamId = scope ? `creative:${scope.ownerUserId}` : actor.principal.streamId;
  const head = await streamHead(env, streamId);
  const correlation = `assistant-specialist:${actor.principal.userId}:${task.turn_id}`;
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
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE private_content SET content=? WHERE content_id=? AND owner_id=? AND redacted_at IS NULL AND expires_at>? AND ${guard.sql}`)
      .bind(result.reply, existing.assistant_content_ref, actor.principal.userId, createdAt, ...guard.bindings),
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
  statements.push(env.DB.prepare("UPDATE assistant_turns SET proposal_json=? WHERE actor_user_id=? AND scope_key=? AND turn_id=?")
    .bind(encoded, actor.principal.userId, assistantScopeKey(actor), task.turn_id));
  statements.push(env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='completed',error_code=NULL,updated_at=?,completed_at=?
    WHERE task_id=? AND actor_user_id=? AND scope_key=? AND permission_epoch=? AND status='running'`)
    .bind(createdAt, createdAt, task.task_id, actor.principal.userId, assistantScopeKey(actor), actor.principal.access.permissionEpoch));
  const exactActions = actions.length ? ` AND (SELECT COUNT(*) FROM assistant_action_proposals WHERE proposal_id IN(${actions.map(() => "?").join(",")})
    AND actor_user_id=? AND scope_key=? AND turn_id=? AND status='pending')=?` : "";
  statements.push(env.DB.prepare(`INSERT INTO assistant_action_commits(commit_id,verified,created_at) VALUES(?,CASE WHEN
    EXISTS(SELECT 1 FROM assistant_specialist_tasks WHERE task_id=? AND actor_user_id=? AND scope_key=? AND status='completed')
    AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND type='AssistantReasoned')${exactActions} THEN 1 ELSE 0 END,?)`)
    .bind(`task:${task.task_id}`, task.task_id, actor.principal.userId, assistantScopeKey(actor), answered.eventId, streamId,
      ...(actions.length ? [...actions.map((action) => action.id), actor.principal.userId, assistantScopeKey(actor), task.turn_id, actions.length] : []), createdAt));
  await env.DB.batch(statements);
}

async function finishAssistantTask(env: WorkerEnv, task: StoredAssistantTask, status: "failed" | "needs-review" | "canceled", code: string) {
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE assistant_specialist_tasks SET status=?,error_code=?,updated_at=?,completed_at=? WHERE task_id=? AND actor_user_id=? AND status IN('queued','running')")
    .bind(status, code, now, now, task.task_id, task.actor_user_id).run();
}

async function runAssistantSpecialist(request: Request, env: WorkerEnv, taskId: string): Promise<void> {
  const task = await env.DB.prepare("SELECT * FROM assistant_specialist_tasks WHERE task_id=? LIMIT 1").bind(taskId).first<StoredAssistantTask>();
  if (!task || task.status !== "queued") return;
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 10 * 60_000).toISOString();
  const claimed = await env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='running',updated_at=?,started_at=?,lease_expires_at=?
    WHERE task_id=? AND actor_user_id=? AND status='queued'
      AND (SELECT COUNT(*) FROM assistant_specialist_tasks active WHERE active.actor_user_id=? AND active.status='running')<2`)
    .bind(now, now, lease, task.task_id, task.actor_user_id, task.actor_user_id).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) return;
  task.status = "running";
  let dispatched = false;
  let settled = false;
  try {
    const live = await authorizeAssistant(request, env);
    const actor = live.authorized;
    if (live.response || !actor || actor.principal.userId !== task.actor_user_id || assistantScopeKey(actor) !== task.scope_key
      || actor.principal.access.permissionEpoch !== task.permission_epoch || !assistantProviderEnabled(env, actor)
      || !assistantAllowedModels(env).includes(task.selected_model as AssistantModel)
      || task.selected_model === "gpt-5.6-sol" && (actor.principal.role !== "admin" || !featureUsers(env.FORMA_ASSISTANT_SOL_USER_IDS).has(actor.principal.userId))) {
      throw new Error("assistant_authorization_changed");
    }
    const turn = await exactAssistantTurn(env, actor, task.turn_id);
    if (!turn) throw new Error("assistant_turn_missing");
    const current = await assistantContext(request, env, actor);
    if (!await claimCostBudgetReservation(env, task.actor_user_id, task.cost_reservation_id)) throw new Error("assistant_budget_claim_denied");
    const dispatchedAt = new Date().toISOString();
    const submission = await env.DB.prepare(`UPDATE assistant_specialist_tasks SET provider_submitted=1,updated_at=?,lease_expires_at=?
      WHERE task_id=? AND actor_user_id=? AND scope_key=? AND permission_epoch=? AND status='running' AND provider_submitted=0`)
      .bind(dispatchedAt, new Date(Date.now() + 10 * 60_000).toISOString(), task.task_id, task.actor_user_id, task.scope_key, task.permission_epoch).run();
    if (Number(submission.meta.changes ?? 0) !== 1) throw new Error("assistant_authorization_changed");
    task.provider_submitted = 1;
    dispatched = true;
    const result = await requestAssistantProvider(env, task.actor_user_id, {
      model: task.selected_model as AssistantModel,
      context: current.context,
      message: turn.user,
      locale: task.locale,
      maximumInputTokens:task.maximum_input_tokens,
      maximumOutputTokens: task.maximum_output_tokens,
    });
    const pricedModel = ASSISTANT_MODELS.includes(result.model as AssistantModel) ? result.model : task.selected_model;
    const actual = priceTextUsageBreakdownMicrousd(pricedModel, result.usage).totalMicrousd;
    await settleBudget(env, task.actor_user_id, task.token_reservation_id, result.usage.totalTokens || result.usage.inputTokens + result.usage.outputTokens);
    await settleCostBudget(env, task.actor_user_id, task.cost_reservation_id, actual);
    settled = true;
    if (result.model !== task.selected_model) throw new Error("assistant_provider_model_mismatch");
    if (actual > task.estimated_microusd) throw new Error("assistant_provider_budget_exceeded");
    const final = await authorizeAssistant(request, env);
    if (!final.authorized || final.response || final.authorized.principal.userId !== task.actor_user_id
      || final.authorized.principal.access.permissionEpoch !== task.permission_epoch || assistantScopeKey(final.authorized) !== task.scope_key) {
      throw new Error("assistant_authorization_changed");
    }
    const refreshed = await assistantContext(request, env, final.authorized);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await commitAssistantSpecialistResult(env, final.authorized, task, result, refreshed.context);
        return;
      } catch (error) {
        if (attempt === 2 || !/assistant_action_commits|events\.stream_id|events\.sequence|CHECK constraint/iu.test(error instanceof Error ? error.message : String(error))) throw error;
      }
    }
  } catch (error) {
    const code = error instanceof Error && /^assistant_[a-z_]+(?:_\d+)?$/u.test(error.message) ? error.message : "assistant_specialist_failed";
    if (!dispatched || error instanceof AssistantProviderRejectedError) {
      await releaseCostBudget(env, task.actor_user_id, task.cost_reservation_id);
      await releaseBudget(env, task.actor_user_id, task.token_reservation_id, { reason: code });
      await finishAssistantTask(env, task, "failed", code);
    } else if (!settled) {
      // A paid POST may have reached its provider. Never duplicate or release its uncertain charge automatically.
      await finishAssistantTask(env, task, "needs-review", code);
    } else {
      await finishAssistantTask(env, task, "failed", code);
    }
  } finally {
    const next = await env.DB.prepare("SELECT task_id FROM assistant_specialist_tasks WHERE actor_user_id=? AND scope_key=? AND status='queued' ORDER BY created_at LIMIT 1")
      .bind(task.actor_user_id, task.scope_key).first<{ task_id: string }>();
    if (next) await runAssistantSpecialist(request, env, String(next.task_id));
  }
}

/** Polling can recover an interrupted request without ever replaying an ambiguous paid submission. */
async function resumeAssistantTasks(request: Request, env: WorkerEnv, actor: AuthorizedAssistant, execution: WorkerExecutionContext) {
  const now = new Date().toISOString();
  const expired = await env.DB.prepare(`SELECT * FROM assistant_specialist_tasks WHERE actor_user_id=? AND scope_key=?
    AND status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=? LIMIT 8`)
    .bind(actor.principal.userId, assistantScopeKey(actor), now).all<StoredAssistantTask>();
  for (const task of expired.results) {
    if (Number(task.provider_submitted) === 1) {
      await finishAssistantTask(env, task, "needs-review", "assistant_provider_submission_uncertain");
      continue;
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE cost_budget_reservations SET status='active',updated_at=? WHERE reservation_id=? AND owner_id=? AND status='executing'")
        .bind(now, task.cost_reservation_id, actor.principal.userId),
      env.DB.prepare("UPDATE assistant_specialist_tasks SET status='queued',updated_at=?,started_at=NULL,lease_expires_at=NULL WHERE task_id=? AND actor_user_id=? AND scope_key=? AND status='running' AND provider_submitted=0 AND lease_expires_at<=?")
        .bind(now, task.task_id, actor.principal.userId, assistantScopeKey(actor), now),
    ]);
  }
  const pending = await env.DB.prepare("SELECT task_id FROM assistant_specialist_tasks WHERE actor_user_id=? AND scope_key=? AND status='queued' ORDER BY created_at LIMIT 2")
    .bind(actor.principal.userId, assistantScopeKey(actor)).all<{ task_id: string }>();
  for (const task of pending.results) {
    const background = new Request(request.url, { method: "GET", headers: request.headers });
    execution.waitUntil(runAssistantSpecialist(background, env, String(task.task_id)).catch(() => undefined));
  }
}

async function recentAssistantTasks(env: WorkerEnv, actor: AuthorizedAssistant) {
  const rows = await env.DB.prepare(`SELECT task_id,turn_id,task_kind,selected_model,status,error_code,estimated_microusd
    FROM assistant_specialist_tasks WHERE actor_user_id=? AND scope_key=? ORDER BY created_at DESC LIMIT 8`)
    .bind(actor.principal.userId, assistantScopeKey(actor)).all<{
      task_id: string;
      turn_id: string;
      task_kind: string;
      selected_model: string;
      status: string;
      error_code: string | null;
      estimated_microusd: number;
    }>();
  return rows.results.map((row) => ({ id: row.task_id, turnId: row.turn_id, kind: row.task_kind,
    model: row.selected_model, status: row.status, error: row.error_code, estimatedMicrousd: Number(row.estimated_microusd) }));
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
  if (task.permission_epoch !== actor.principal.access.permissionEpoch) return json({ error: "assistant_authorization_changed" }, 403);
  if (operation === "reconcile") {
    // The task-owner route can never provide the independent reviewer required for
    // an ambiguous paid submission, even when that owner is a platform admin.
    return json({ error: "assistant_independent_reviewer_required" }, 403);
  }
  if (task.status === "canceled") return json({ taskId, status: "canceled", idempotent: true });
  if (task.status !== "queued") return json({ error: "assistant_task_already_started" }, 409);
  const now = new Date().toISOString();
  const canceled = await env.DB.prepare("UPDATE assistant_specialist_tasks SET status='canceled',error_code='assistant_canceled',updated_at=?,completed_at=? WHERE task_id=? AND actor_user_id=? AND scope_key=? AND status='queued'")
    .bind(now, now, taskId, actor.principal.userId, assistantScopeKey(actor)).run();
  if (Number(canceled.meta.changes ?? 0) !== 1) return json({ error: "assistant_task_already_started" }, 409);
  await releaseCostBudget(env, actor.principal.userId, task.cost_reservation_id);
  await releaseBudget(env, actor.principal.userId, task.token_reservation_id, { reason: "assistant_user_canceled" });
  return json({ taskId, status: "canceled" });
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
  if (task.status === "reconciled") return json({ taskId, status: "reconciled", idempotent: true });
  if (!["needs-review", "reconciling"].includes(task.status)) return json({ error: "assistant_task_reconciliation_unavailable" }, 409);

  const started = new Date().toISOString();
  const auditId = uuidV7();
  const evidence = { task_id: taskId, actor_user_id: actorUserId, reviewer_user_id: reviewer.userId,
    project_access_id: projectAccessId ?? "", evidence_classification: "verified-no-provider-charge" };
  const statements = [
    env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='reconciling',updated_at=?
      WHERE task_id=? AND actor_user_id=? AND scope_key=? AND organization_id IS ? AND project_access_id IS ?
        AND status IN('needs-review','reconciling')`)
      .bind(started, taskId, actorUserId, task.scope_key, organizationId, projectAccessId),
    env.DB.prepare(`INSERT OR IGNORE INTO assistant_billing_reconciliations(reconciliation_id,task_id,actor_user_id,reviewer_user_id,organization_id,project_access_id,evidence_classification,occurred_at)
      SELECT ?,?,?,?,?,?,'verified-no-provider-charge',? WHERE EXISTS(SELECT 1 FROM assistant_specialist_tasks
        WHERE task_id=? AND actor_user_id=? AND scope_key=? AND status='reconciling')`)
      .bind(auditId, taskId, actorUserId, reviewer.userId, organizationId, projectAccessId, started, taskId, actorUserId, task.scope_key),
  ];
  if (organizationId) {
    statements.push(env.DB.prepare(`INSERT INTO organization_audit_events(audit_id,organization_id,actor_user_id,action,resource_kind,resource_id,detail_json,occurred_at)
      SELECT ?,?,?, 'AssistantProviderChargeReconciled','assistant-billing',?,?,? WHERE EXISTS(SELECT 1 FROM assistant_billing_reconciliations
        WHERE task_id=? AND actor_user_id=? AND reviewer_user_id=? AND organization_id=? AND project_access_id IS ?)
        AND NOT EXISTS(SELECT 1 FROM organization_audit_events WHERE organization_id=? AND action='AssistantProviderChargeReconciled'
          AND resource_kind='assistant-billing' AND resource_id=? AND actor_user_id=?)`)
      .bind(uuidV7(), organizationId, reviewer.userId, taskId, JSON.stringify(evidence), started,
        taskId, actorUserId, reviewer.userId, organizationId, projectAccessId, organizationId, taskId, reviewer.userId));
  }
  try {
    const results = await env.DB.batch(statements);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return json({ error: "assistant_task_reconciliation_unavailable" }, 409);
    await releaseCostBudget(env, actorUserId, task.cost_reservation_id);
    await releaseBudget(env, actorUserId, task.token_reservation_id, { reason: "assistant_admin_verified_no_provider_charge" });
    const ended = new Date().toISOString();
    const completed = await env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='reconciled',error_code=NULL,updated_at=?,completed_at=?
      WHERE task_id=? AND actor_user_id=? AND scope_key=? AND organization_id IS ? AND project_access_id IS ? AND status='reconciling'
        AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status IN('active','executing'))
        AND NOT EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status IN('active','executing'))
        AND EXISTS(SELECT 1 FROM assistant_billing_reconciliations WHERE task_id=? AND actor_user_id=? AND reviewer_user_id=?)`)
      .bind(ended, ended, taskId, actorUserId, task.scope_key, organizationId, projectAccessId,
        task.cost_reservation_id, actorUserId, task.token_reservation_id, actorUserId, taskId, actorUserId, reviewer.userId).run();
    return Number(completed.meta.changes ?? 0) === 1 ? json({ taskId, status: "reconciled" }) : json({ error: "assistant_reconciliation_incomplete" }, 409);
  } catch { return json({ error: "assistant_reconciliation_incomplete" }, 409); }
}

export async function handleAssistant(request: Request, env: WorkerEnv, execution: WorkerExecutionContext): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = await authorizeAssistant(request, env);
  if (authorization.response || !authorization.authorized) return authorization.response!;
  const actor = authorization.authorized;
  await ensureAssistantSchema(env);
  const state = await assistantContext(request, env, actor);
  if (request.method === "GET") {
    await resumeAssistantTasks(request, env, actor, execution);
    return json({ ...state, tasks: await recentAssistantTasks(env, actor) });
  }

  let body: { turnId?: unknown; message?: unknown; locale?: unknown; model?: unknown; premiumApproval?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ error: "assistant_request_invalid" }, 400); }
  const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(turnId)) return json({ error: "assistant_turn_invalid" }, 400);
  if (!message || message.length > ASSISTANT_CONTEXT_LIMITS.turnChars) return json({ error: "assistant_message_invalid" }, 400);
  const previous = await exactAssistantTurn(env, actor, turnId);
  if (previous) return previous.user === message ? json({ context: state.context, turn: previous }) : json({ error: "assistant_turn_conflict" }, 409);

  const reply = answerFor(state.context, message, body.locale);
  const actions = assistantActionsEnabled(env, actor) ? preparedAssistantActions(message, state.context, turnId) : [];
  const actionProposals: AssistantProposal[] = actions.map(({ id, turnId: sourceTurn, key, summary, action }) => ({ id, turnId: sourceTurn, key, summary, kind: action.kind }));
  const proposal = actionProposals[0] ?? proposalFor(state.context, turnId, actor.canPropose);
  let task: PreparedAssistantTask | null = null;
  try {
    const visibleProtected=state.context.decisionAtoms.filter((decision)=>decision.providerEligible&&(decision.protected||decision.locked||decision.type==="exclusion"||decision.intent==="prohibit")).length;
    const protectedComplete=visibleProtected>=Number(state.context.totals.protectedDecisions??visibleProtected);
    const safeRights=Number(state.context.totals.unsafeRightsDecisions??0)===0;
    const completeProtectedText=Number(state.context.totals.truncatedProtectedDecisions??0)===0;
    const synthesisAvailable=assistantTaskKind(message,actions)!=="cross-document-synthesis";
    if(protectedComplete&&completeProtectedText&&safeRights&&synthesisAvailable)task=await prepareAssistantTask(env,actor,{turnId,message,actions,locale:body.locale,model:body.model,premiumApproval:body.premiumApproval});
  } catch { /* Account, policy, or provider unavailability never blocks zero-cost page guidance. */ }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await commitAssistantTurn(env, actor, { turnId, message, reply: localizedAnswer(reply, body.locale), proposal, documentId: state.context.scope.documentId, actions, task });
      if (task) {
        const background = new Request(request.url, { method: "GET", headers: request.headers });
        execution.waitUntil(runAssistantSpecialist(background, env, task.id).catch(() => undefined));
      }
      return json({ context: state.context,
        turn: { id: turnId, user: message, reply, proposal, ...(actionProposals.length > 1 ? { proposals: actionProposals } : {}) },
        ...(task ? { task: { id: task.id, turnId, kind: task.kind, model: task.model, status: "queued", estimatedMicrousd: task.estimatedMicrousd } } : {}),
      }, 201);
    } catch (error) {
      const accepted = await exactAssistantTurn(env, actor, turnId);
      if (accepted) {
        await releasePreparedAssistantTask(env, actor, task);
        return accepted.user === message ? json({ context: state.context, turn: accepted }) : json({ error: "assistant_turn_conflict" }, 409);
      }
      if (attempt === 3 || !/assistant_turns\.status|events\.stream_id|events\.sequence|event_append_contention/iu.test(error instanceof Error ? error.message : String(error))) {
        await releasePreparedAssistantTask(env, actor, task);
        return json({ error: "assistant_persistence_failed" }, 503);
      }
    }
  }
  await releasePreparedAssistantTask(env, actor, task);
  return json({ error: "assistant_persistence_failed" }, 503);
}
