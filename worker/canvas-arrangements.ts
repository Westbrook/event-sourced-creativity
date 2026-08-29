import { foldCanvasEvents, organizeCanvasItems, type CanvasArrangementFrame, type CanvasItem, type CanvasProjection } from "../src/canvas/model.ts";
import { outcomeArrangementManifests, outcomeArrangementRevisions, outcomeArrangementSelectionIds } from "../src/canvas/outcome-arrangements.ts";
import { foldEvents, type CreativeEvent, type CreativeProjection, type EventInput } from "../src/model/events.ts";
import { outcomeRecipe, type OutcomeRecipeId } from "../src/model/outcome-recipes.ts";
import { commitAuthoringPlan, dismissAuthoringPreview, readAuthoringState, releaseExpiredAuthoringLease, storeAuthoringPreview, type AuthoringPlan } from "./authoring-commits.ts";
import { currentAuthoringPreviewDisclosure } from "./authoring-preview-disclosure.ts";
import { canonicalConsent, consentHash, executionAdmissionGuard, executionAuthorityCurrent, executionContentCustodyGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { hasCapability, requireConsent, requireUser, type BudgetReservationGuard, type PilotUser, type ProjectExecutionScope } from "./pilot-policy.ts";
import { readProjectEventPage, readProjectRequestContext, resolveOwnerExecutionScope, synchronizeProjectScope, type ProjectRequestContext } from "./project-access.ts";
import { readEvents, streamHead, type WorkerEnv } from "./runtime.ts";
import { assertAtomicCanvasArrangementEvents, CANVAS_ARRANGEMENT_MAX_EVENTS, validCanvasArrangementFrame } from "./canvas-arrangement-contract.ts";

const VERSION = "canvas-arrangement-v1";
const PREVIEW_MS = 15 * 60_000;
const MAX_SNAPSHOT_BYTES = 1_000_000;
const privateJson = "CASE WHEN redacted_at IS NULL AND json_valid(content) THEN content ELSE '{}' END";
type RecipeId = OutcomeRecipeId;
type Identity = { operationId: string; projectId: string; canvasId: string };
export type CanvasArrangementRequest = Identity & {
  recipeId: RecipeId; name: string; selectedItemIds: string[];
  expectedLayoutRevision: string; expectedSourceRevision: string; undoOperationId?: string;
};
export type RetainedCanvasArrangement = CanvasArrangementRequest & {
  arrangementId: string; before: CanvasArrangementFrame[]; after: CanvasArrangementFrame[];
  sources: Array<{ itemId: string; sourceKind: CanvasItem["sourceKind"]; sourceId: string; rot: number; z: string }>;
  undoArrangementId: string | null;
};
type Snapshot = { hash: string; guard: BudgetReservationGuard; resources: Array<[string, string, string | null, string, string | null]> };
type CanvasAuthority = {
  principal: PilotUser; shared: ProjectRequestContext | null; binding: ConsequentialBinding;
  sourceHead: number; events: CreativeEvent[]; projection: CreativeProjection; canvas: CanvasProjection;
  canAuthor: boolean; snapshot: Snapshot;
};
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown, maximum = 100): value is string => typeof value === "string"
  && value.length <= maximum && /^[a-z0-9][a-z0-9:_-]*$/iu.test(value);
const result = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const failure = (error: string, status = 409) => result({ error, providerCalls: 0, maximumMicrousd: 0 }, status);
const mergeGuards = (...guards: BudgetReservationGuard[]): BudgetReservationGuard => ({
  sql: guards.map((guard) => "(" + guard.sql + ")").join(" AND "), bindings: guards.flatMap((guard) => guard.bindings),
});
const identityMatches = (plan: AuthoringPlan, identity: Identity) =>
  plan.operation === "canvas-arrangement" && plan.binding.projectId === identity.projectId
  && plan.binding.canvasId === identity.canvasId && plan.result.operationId === identity.operationId;

function normalizeIdentity(body: Record<string, unknown>): Identity {
  if (!id(body.projectId, 120) || !id(body.canvasId, 120) || !id(body.operationId, 80)) throw new Error("canvas_arrangement_scope_invalid");
  return { projectId: body.projectId, canvasId: body.canvasId, operationId: body.operationId };
}
function normalizeRequest(body: Record<string, unknown>): CanvasArrangementRequest {
  const identity = normalizeIdentity(body);
  const selected = Array.isArray(body.selectedItemIds) ? outcomeArrangementSelectionIds(body.selectedItemIds as string[]) : null;
  if (!selected || selected.some((itemId) => !id(itemId, 120))) throw new Error("canvas_arrangement_selection_invalid");
  if (typeof body.recipeId !== "string" || !outcomeRecipe(body.recipeId)) throw new Error("canvas_arrangement_recipe_invalid");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || Array.from(name).length > 80 || /\p{Cc}/u.test(name)) throw new Error("canvas_arrangement_name_invalid");
  if (typeof body.expectedLayoutRevision !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(body.expectedLayoutRevision)
    || typeof body.expectedSourceRevision !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(body.expectedSourceRevision))
    throw new Error("canvas_arrangement_revision_required");
  if (body.undoOperationId !== undefined && (!id(body.undoOperationId, 80) || body.undoOperationId === identity.operationId))
    throw new Error("canvas_arrangement_undo_invalid");
  return { ...identity, recipeId: body.recipeId as RecipeId, name, selectedItemIds: [...selected],
    expectedLayoutRevision: body.expectedLayoutRevision, expectedSourceRevision: body.expectedSourceRevision,
    ...(body.undoOperationId !== undefined ? { undoOperationId: body.undoOperationId as string } : {}) };
}

/** Include only source/board evidence used by this selection, never an unrelated account's provider history. */
function sourceEventIds(events: CreativeEvent[], projection: CreativeProjection, canvas: CanvasProjection, selected?: readonly string[]) {
  const ids = new Set<string>(), resources = new Set<string>();
  const visit = (value: unknown, key = "") => {
    if (key === "sourceEventId" && typeof value === "string") ids.add(value);
    if (key === "sourceEvents" && Array.isArray(value)) for (const id of value) if (typeof id === "string") ids.add(id);
    if ((key === "id" || /(?:_id|Id)$/u.test(key)) && typeof value === "string") resources.add(value);
    if (Array.isArray(value)) for (const child of value) visit(child);
    else if (value && typeof value === "object") for (const [name, child] of Object.entries(value)) visit(child, name);
  };
  const board = canvas.canvases.find((item) => item.id === canvas.selectedCanvasId);
  visit(board);
  if (selected) {
    const manifests = outcomeArrangementManifests(projection, canvas, selected);
    if (!manifests.ok) throw new Error("canvas_arrangement_selection_unavailable");
    visit(manifests.value);
    for (const event of events) {
      const p = event.payload, operation = record(p.operation), object = record(operation.object), sketch = record(operation.sketch);
      const itemId = String(p.item_id ?? object.item_id ?? sketch.item_id ?? "");
      if (String(p.canvas_id ?? "") === canvas.selectedCanvasId && resources.has(itemId)
        && ["CanvasTextApplied", "StrokeAdded", "StrokeErased", "CanvasLockAcquired", "CanvasLockReleased", "CanvasLockOverridden"].includes(event.type))
        ids.add(event.eventId);
      if (["RightsAsserted", "ReferenceIngested"].includes(event.type)) {
        const refs = ["block_id", "reference_id", "source_id", "document_id", "object_id", "artifact_id"]
          .map((key) => p[key]).filter((value): value is string => typeof value === "string" && value.length > 0);
        if (refs.length ? refs.some((ref) => resources.has(ref)) : p.project_id === canvas.projectId) ids.add(event.eventId);
      }
    }
  }
  return [...ids].sort();
}

/** Captured bytes are guarded once at the final receipt. A fresh second projection
 * below prevents a privacy erasure between the initial read and this capture becoming an accepted preview. */
async function sourceSnapshot(env: WorkerEnv, binding: ConsequentialBinding, head: number, evidenceIds: string[]): Promise<Snapshot> {
  const scope = binding.scope, owner = scope?.ownerUserId ?? binding.actorUserId;
  const eventBindings: Array<string | number | null> = [owner, binding.streamId, head, JSON.stringify(evidenceIds)];
  const eventSql = "SELECT COALESCE(json_group_array(json_array(event_id,payload,private_json,redacted_at)),'[]') AS value FROM("
    + "SELECT event.event_id,event.payload,secret.private_json,secret.redacted_at FROM events event "
    + "LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? "
    + "WHERE event.stream_id=? AND event.sequence<=? AND event.event_id IN(SELECT value FROM json_each(?)) ORDER BY event.event_id)";
  // New arrangement/content receipts do not change existing source custody.
  const resourceSql = "SELECT COALESCE(json_group_array(json_array(resource_kind,resource_id,source_event_id,visibility,actor_user_id)),'[]') AS value FROM("
    + "SELECT resource_kind,resource_id,source_event_id,visibility,actor_user_id FROM project_resource_scopes "
    + "WHERE owner_user_id=? AND project_id=? AND resource_kind IN('canvas','canvas_item','canvas_context','document','block','relation','reference','output','artifact') "
    + (scope ? "AND project_access_id=? AND organization_id=? " : "")
    + "ORDER BY resource_kind,resource_id)";
  const resourceBindings: Array<string | number | null> = [owner, binding.projectId, ...(scope ? [scope.projectAccessId, scope.organizationId] : [])];
  const event = await env.DB.prepare(eventSql).bind(...eventBindings).first<{ value: string }>();
  const resources = await env.DB.prepare(resourceSql).bind(...resourceBindings).first<{ value: string }>();
  if (!event || !resources || new TextEncoder().encode(event.value + resources.value).byteLength > MAX_SNAPSHOT_BYTES)
    throw new Error("canvas_arrangement_snapshot_too_large");
  if (!scope && resources.value !== "[]") throw new Error("canvas_arrangement_custody_unavailable");
  return { hash: await consentHash({ events: event.value, resources: resources.value }),
    resources: JSON.parse(resources.value) as Snapshot["resources"], guard: {
      sql: "(" + eventSql + ")=? AND (" + resourceSql + ")=?",
      bindings: [...eventBindings, event.value, ...resourceBindings, resources.value],
    } };
}

async function authorityEvents(env: WorkerEnv, shared: ProjectRequestContext | null, streamId: string): Promise<CreativeEvent[]> {
  if (!shared) return readEvents(env, streamId);
  const events: CreativeEvent[] = [];
  let after = 0;
  for (;;) {
    const page = await readProjectEventPage(env, shared, after, 5000, false);
    events.push(...page.events.filter((event) => event.type !== "ProjectResourceRestricted"));
    if (!page.hasMore) break;
    if (page.nextAfter <= after) throw new Error("canvas_arrangement_history_unavailable");
    after = page.nextAfter;
  }
  return events;
}

async function prepareAuthority(request: Request, env: WorkerEnv, identity: Identity, selectedIds?: readonly string[]): Promise<CanvasAuthority | Response> {
  const authenticated = await requireUser(request, env, "viewer", { account: "principal" });
  if (authenticated.response || !authenticated.user) return authenticated.response ?? failure("authentication_required", 401);
  const principal = authenticated.user, consent = requireConsent(principal);
  if (consent) return consent;
  const selected = await readProjectRequestContext(request, env, principal);
  if (selected.response) return selected.response;
  const shared = selected.context;
  if (shared && shared.projectId !== identity.projectId) return failure("canvas_arrangement_project_denied", 403);
  let scope: ProjectExecutionScope | undefined = shared ? {
    organizationId: shared.organizationId, projectAccessId: shared.projectAccessId, projectId: shared.projectId,
    ownerUserId: shared.ownerUserId, actorUserId: principal.userId,
  } : undefined;
  if (!shared) {
    const custody = await resolveOwnerExecutionScope(env, principal, "", identity.projectId, "read");
    if (custody.denied) return failure("canvas_arrangement_custody_unavailable", 403);
    scope = custody.scope;
  }
  const permitted = (capability: "project.read" | "project.author" | "project.canvas.use") =>
    scope ? hasCapability(principal, capability, scope)
      : capability === "project.canvas.use" ? principal.access.canvasAccess : principal.access.capabilities.includes(capability);
  if (!permitted("project.read") || !permitted("project.canvas.use")) return failure("canvas_arrangement_access_denied", 403);
  if (scope) await synchronizeProjectScope(env, scope);
  const streamId = scope ? "creative:" + scope.ownerUserId : principal.streamId;
  const binding: ConsequentialBinding = {
    version: VERSION, operation: "canvas-arrangement", intentHash: "", actorUserId: principal.userId,
    permissionEpoch: principal.access.permissionEpoch, streamId, projectId: identity.projectId,
    canvasId: identity.canvasId, documentId: "", blockId: "", sourceHash: "", period: "",
    scope: scope ?? null, contextSessionId: shared?.contextId ?? null, pilotCohortId: null,
    steps: [], publicQuery: "", request: {},
  };
  const sourceHead = await streamHead(env, streamId), initialEvents = await authorityEvents(env, shared, streamId);
  const initialCanvas = foldCanvasEvents(initialEvents, identity.projectId, identity.canvasId);
  if (initialCanvas.selectedCanvasId !== identity.canvasId || initialCanvas.projectId !== identity.projectId)
    return failure("canvas_arrangement_board_unavailable", 409);
  const evidenceIds = sourceEventIds(initialEvents, foldEvents(initialEvents, Infinity, undefined, identity.projectId), initialCanvas, selectedIds);
  const snapshot = await sourceSnapshot(env, binding, sourceHead, evidenceIds);
  const events = await authorityEvents(env, shared, streamId), canvas = foldCanvasEvents(events, identity.projectId, identity.canvasId);
  const projection = foldEvents(events, Infinity, undefined, identity.projectId);
  if (canonicalConsent(evidenceIds) !== canonicalConsent(sourceEventIds(events, projection, canvas, selectedIds)))
    return failure("canvas_arrangement_source_changed", 409);
  if (canvas.projectId !== identity.projectId || canvas.selectedCanvasId !== identity.canvasId
    || !canvas.canvases.some((board) => board.id === identity.canvasId && board.projectId === identity.projectId && !board.removed))
    return failure("canvas_arrangement_board_unavailable", 409);
  if (scope && !snapshot.resources.some(([kind, resourceId]) => kind === "canvas" && resourceId === identity.canvasId))
    return failure("canvas_arrangement_custody_unavailable", 403);
  const guard = mergeGuards(executionAdmissionGuard(principal, binding, sourceHead), snapshot.guard);
  if (!await env.DB.prepare("SELECT 1 AS current WHERE " + guard.sql).bind(...guard.bindings).first())
    return failure("canvas_arrangement_source_changed", 409);
  return { principal, shared, binding, sourceHead, snapshot, events, canvas,
    projection, canAuthor: permitted("project.author") };
}

async function requestHash(authority: CanvasAuthority, request: CanvasArrangementRequest) {
  return consentHash({ version: VERSION, actorUserId: authority.principal.userId,
    scope: authority.binding.scope, request });
}
async function intentPreviewId(env: WorkerEnv, authority: CanvasAuthority, operationId: string): Promise<string | null> {
  const guard = executionAdmissionGuard(authority.principal, authority.binding, null);
  const row = await env.DB.prepare("SELECT preview_id FROM authoring_commits WHERE actor_user_id=? AND operation='canvas-arrangement' "
    + "AND json_extract(result_json,'$.operationId')=? AND " + guard.sql
    + " UNION ALL SELECT content_id AS preview_id FROM private_content WHERE owner_id=? AND kind='authoring-preview' "
    + "AND json_extract(" + privateJson + ",'$.plan.operation')='canvas-arrangement' "
    + "AND json_extract(" + privateJson + ",'$.plan.result.operationId')=? AND " + guard.sql + " LIMIT 1")
    .bind(authority.principal.userId, operationId, ...guard.bindings, authority.principal.userId, operationId, ...guard.bindings)
    .first<{ preview_id: string }>();
  return row?.preview_id ?? null;
}

function presentationPreview(previewId: string, approvalHash: string, plan: AuthoringPlan) {
  if (!plan.arrangement) throw new Error("canvas_arrangement_preview_unavailable");
  const { sources: _sources, undoArrangementId: _undoArrangementId, ...preview } = plan.arrangement;
  return { ...preview, previewId, approvalHash, expiresAt: plan.expiresAt, maximumEvents: CANVAS_ARRANGEMENT_MAX_EVENTS,
    providerCalls: 0, maximumMicrousd: 0, changesSemantics: false };
}
async function existingIntent(env: WorkerEnv, authority: CanvasAuthority, identity: Identity, hash?: string, includeDisposition = false) {
  const previewId = await intentPreviewId(env, authority, identity.operationId);
  if (!previewId) return null;
  const state = await readAuthoringState(env, authority.principal, authority.binding, previewId, { readOnly: true });
  if (!state) return failure("canvas_arrangement_access_denied", 403);
  if (state.committed) {
    const receipt = await env.DB.prepare("SELECT project_id,canvas_id,organization_id,project_access_id FROM authoring_commits "
      + "WHERE preview_id=? AND actor_user_id=?").bind(previewId, authority.principal.userId)
      .first<{ project_id: string; canvas_id: string | null; organization_id: string | null; project_access_id: string | null }>();
    if (!receipt || receipt.project_id !== identity.projectId || receipt.canvas_id !== identity.canvasId
      || (receipt.organization_id ?? "") !== (authority.binding.scope?.organizationId ?? "")
      || (receipt.project_access_id ?? "") !== (authority.binding.scope?.projectAccessId ?? "")
      || state.committed.result.operationId !== identity.operationId || hash && state.committed.result.requestHash !== hash)
      return failure("canvas_arrangement_operation_mismatch");
    if (!await executionAuthorityCurrent(env, authority.principal, authority.binding, null)) return failure("canvas_arrangement_access_denied", 403);
    return result({ status: "applied", ...identity, previewId, approvalHash: state.committed.approvalHash, ...state.committed.result, providerCalls: 0, maximumMicrousd: 0, changesSemantics: false });
  }
  const saved = state.saved;
  if (!saved || !identityMatches(saved.plan, identity) || saved.plan.binding.actorUserId !== authority.principal.userId
    || canonicalConsent(saved.plan.binding.scope) !== canonicalConsent(authority.binding.scope))
    return failure("canvas_arrangement_operation_unavailable");
  if (hash && saved.plan.result.requestHash !== hash) return failure("canvas_arrangement_operation_mismatch");
  if (!includeDisposition && saved.state === "dismissed") return result({ status: "dismissed", ...identity, previewId });
  if (!includeDisposition && saved.plan.expiresAt <= new Date().toISOString()) return failure("canvas_arrangement_preview_expired");
  const disclosure = await currentAuthoringPreviewDisclosure(env, authority.principal, authority.binding, previewId,
    saved.approvalHash, saved.plan, state.retainedContent);
  if (!disclosure) return failure("canvas_arrangement_access_denied", 403);
  if (disclosure.committed) return result({ status: "applied", ...identity, previewId,
    approvalHash: disclosure.committed.approvalHash, ...disclosure.committed.result, providerCalls: 0, maximumMicrousd: 0, changesSemantics: false });
  if (includeDisposition) {
    if (!disclosure.retainedCurrent || !disclosure.planExpiryValid) return failure("canvas_arrangement_preview_unavailable", 403);
    if (!disclosure.receiptAbsent) return failure("canvas_arrangement_receipt_pending", 503);
    if (saved.state === "dismissed") return result({ status: "dismissed", ...identity, previewId, approvalHash: saved.approvalHash });
  }
  if (state.status === "applying" && !disclosure.leaseExpired) return result({ status: "applying", ...identity, previewId,
    ...(includeDisposition ? { approvalHash: saved.approvalHash } : {}) }, 202);
  if (includeDisposition && disclosure.planExpired) {
    if (saved.state !== undefined && saved.state !== "review" && saved.state !== "applying")
      return failure("canvas_arrangement_preview_unavailable", 403);
    // This exact, current tuple authorizes only an explicit question, never Apply or replacement.
    return result({ error: "canvas_arrangement_preview_expired", providerCalls: 0, maximumMicrousd: 0,
      disposition: { version: 1, actorUserId: authority.principal.userId, ...identity, previewId, approvalHash: saved.approvalHash } }, 409);
  }
  if (!disclosure.privateCurrent) return failure("canvas_arrangement_preview_unavailable", 403);
  return result({ status: "review", preview: presentationPreview(previewId, saved.approvalHash, saved.plan) });
}

/** Resolve only this exact original; a concurrent canonical receipt is never annotated Done. */
async function dismissArrangementIfUnapplied(env: WorkerEnv, authority: CanvasAuthority, identity: Identity,
  previewId: string, approvalHash: string) {
  const { principal, binding } = authority;
  let state = await readAuthoringState(env, principal, binding, previewId, { readOnly: true });
  if (!state) return failure("canvas_arrangement_access_denied", 403);
  let retainedContent: string | null = null, retainedPlan: string | null = null;
  // At most one explicit expired-lease release. Reading alone never invokes it.
  for (let pass = 0; pass < 2; pass++) {
    const saved = state.saved;
    if (!saved || !identityMatches(saved.plan, identity) || saved.approvalHash !== approvalHash) break;
    const current = await currentAuthoringPreviewDisclosure(env, principal, binding, previewId,
      approvalHash, saved.plan, state.retainedContent);
    if (!current) return failure("canvas_arrangement_access_denied", 403);
    if (pass === 0 && current.leaseExpired) {
      await releaseExpiredAuthoringLease(env, principal, binding, previewId);
      state = await readAuthoringState(env, principal, binding, previewId, { readOnly: true });
      if (!state) return failure("canvas_arrangement_access_denied", 403);
      continue;
    }
    if (current.retainedCurrent) {
      retainedContent = state.retainedContent; retainedPlan = JSON.stringify(saved.plan);
    }
    break;
  }
  const admission = executionAdmissionGuard(principal, binding, null), custody = executionContentCustodyGuard(binding);
  const discard = env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','dismissed')
    WHERE content_id=? AND owner_id=? AND kind='authoring-preview' AND content IS ? AND redacted_at IS NULL
      AND json_valid(content) AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND json_extract(${privateJson},'$.approvalHash')=?
      AND COALESCE(json_extract(${privateJson},'$.state'),'review') IN('review','dismissed')
      AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?) AND ${custody.sql} AND ${admission.sql}`)
    .bind(previewId, principal.userId, retainedContent, approvalHash, previewId, ...custody.bindings, ...admission.bindings);
  const savedCustody = executionContentCustodyGuard(binding, "saved");
  const savedJson = "CASE WHEN saved.redacted_at IS NULL AND json_valid(saved.content) THEN saved.content ELSE '{}' END";
  // UPDATE and positive outcome share one native transaction; absence is never cancellation.
  const outcome = env.DB.prepare(`SELECT receipt.result_json,receipt.approval_hash,
      CASE WHEN json_extract(${savedJson},'$.plan')=json(?) AND json_extract(${savedJson},'$.approvalHash')=?
        THEN COALESCE(json_extract(${savedJson},'$.state'),'review') ELSE NULL END AS preview_state,
      CASE WHEN saved.content=json_set(?,'$.state','dismissed')
        AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?) THEN 1 ELSE 0 END AS dismissed
    FROM(SELECT ? AS preview_id) requested
    LEFT JOIN private_content saved ON saved.content_id=requested.preview_id AND saved.owner_id=? AND saved.kind='authoring-preview'
      AND saved.redacted_at IS NULL AND json_valid(saved.content) AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${savedCustody.sql}
    LEFT JOIN authoring_commits receipt ON receipt.preview_id=requested.preview_id AND receipt.actor_user_id=?
      AND receipt.operation=? AND receipt.project_id=? AND receipt.document_id=? AND receipt.block_id=?
      AND receipt.canvas_id IS ? AND receipt.organization_id IS ? AND receipt.project_access_id IS ?
      AND receipt.approval_hash=? AND json_extract(receipt.result_json,'$.operationId')=? AND receipt.verified=1
    WHERE ${admission.sql}`)
    .bind(retainedPlan, approvalHash, retainedContent, previewId, previewId, principal.userId, ...savedCustody.bindings,
      principal.userId, binding.operation, binding.projectId, binding.documentId, binding.blockId, binding.canvasId,
      binding.scope?.organizationId ?? null, binding.scope?.projectAccessId ?? null, approvalHash, identity.operationId, ...admission.bindings);
  const rows = await env.DB.batch([discard, outcome]);
  const current = rows[1]?.results?.[0] as { result_json: string | null; approval_hash: string | null; preview_state: string | null; dismissed: number } | undefined;
  if (!current) return failure("canvas_arrangement_access_denied", 403);
  if (current.result_json && current.approval_hash === approvalHash)
    return result({ status: "applied", ...identity, previewId, approvalHash, ...JSON.parse(current.result_json) as AuthoringPlan["result"],
      providerCalls: 0, maximumMicrousd: 0, changesSemantics: false });
  if (current.preview_state === "applying" || current.preview_state === "applied")
    return result({ status: "applying", ...identity, previewId, approvalHash }, 202);
  if (current.preview_state === "dismissed" && Number(current.dismissed) === 1)
    return result({ status: "dismissed", ...identity, previewId, approvalHash });
  return failure("canvas_arrangement_preview_unavailable", 403);
}

async function validateSelection(authority: CanvasAuthority, request: CanvasArrangementRequest) {
  if (!authority.canAuthor) throw new Error("canvas_arrangement_read_only");
  const revisions = await outcomeArrangementRevisions(authority.projection, authority.canvas, request.selectedItemIds);
  if (!revisions.ok) throw new Error("canvas_arrangement_selection_unavailable");
  if (revisions.value.layoutRevision !== request.expectedLayoutRevision || revisions.value.sourceRevision !== request.expectedSourceRevision)
    throw new Error("canvas_arrangement_source_changed");
  const items = request.selectedItemIds.map((itemId) => authority.canvas.items.find((item) =>
    item.id === itemId && item.canvasId === request.canvasId && item.projectId === request.projectId));
  if (items.some((item) => !item || item.removed || !item.visible || item.lockedBy
    || !validCanvasArrangementFrame({ itemId: item.id, x: item.x, y: item.y, w: item.w, h: item.h })))
    throw new Error("canvas_arrangement_item_unavailable");
  if (authority.binding.scope) {
    const resources = new Set(authority.snapshot.resources.map(([kind, resourceId]) => kind + ":" + resourceId));
    for (const item of items as CanvasItem[]) {
      const kind = item.sourceKind === "document" ? "document" : item.sourceKind === "output" ? "output"
        : item.sourceKind === "artifact" ? "artifact" : item.sourceKind === "context" ? "canvas_context" : "block";
      if (!resources.has("canvas_item:" + item.id) || !resources.has(kind + ":" + item.sourceId))
        throw new Error("canvas_arrangement_custody_unavailable");
    }
  }
  return items as CanvasItem[];
}

async function createPlan(env: WorkerEnv, authority: CanvasAuthority, request: CanvasArrangementRequest, hash: string): Promise<AuthoringPlan> {
  const items = await validateSelection(authority, request);
  const before = items.map((item) => ({ itemId: item.id, x: item.x, y: item.y, w: item.w, h: item.h }));
  const positions = organizeCanvasItems(items, outcomeRecipe(request.recipeId)!.arrangement);
  let after = before.map((frame) => ({ ...frame, ...positions.get(frame.itemId)! }));
  let undoArrangementId: string | null = null;
  if (request.undoOperationId) {
    const originalId = await intentPreviewId(env, authority, request.undoOperationId);
    const original = originalId ? await readAuthoringState(env, authority.principal, authority.binding, originalId, { readOnly: true }) : null;
    const arrangementId = original?.committed?.result.arrangementId;
    const event = arrangementId ? authority.events.find((candidate) => candidate.type === "CanvasArrangementCreated"
      && candidate.actor === "user:" + authority.principal.userId && candidate.payload.arrangement_id === arrangementId
      && candidate.payload.project_id === request.projectId && candidate.payload.canvas_id === request.canvasId) : null;
    if (!event || !original?.committed || event.payload.recipe_id !== request.recipeId
      || canonicalConsent(event.payload.item_ids) !== canonicalConsent(request.selectedItemIds))
      throw new Error("canvas_arrangement_undo_unavailable");
    const previous = Array.isArray(event.payload.previous_frames) ? event.payload.previous_frames.map(record) : [];
    const applied = Array.isArray(event.payload.frames) ? event.payload.frames.map(record) : [];
    const sources = Array.isArray(event.payload.source_items) ? event.payload.source_items.map(record) : [];
    if (previous.length !== items.length || applied.length !== items.length || sources.length !== items.length)
      throw new Error("canvas_arrangement_undo_unavailable");
    after = items.map((item, index) => {
      const target = previous[index], current = applied[index], source = sources[index];
      if (target.item_id !== item.id || current.item_id !== item.id || source.item_id !== item.id
        || source.source_id !== item.sourceId || source.source_kind !== item.sourceKind || source.rot !== item.rot || source.z !== item.z
        || current.x !== item.x || current.y !== item.y || current.w !== item.w || current.h !== item.h
        || !validCanvasArrangementFrame(target)) throw new Error("canvas_arrangement_undo_conflict");
      return { itemId: item.id, x: Number(target.x), y: Number(target.y), w: item.w, h: item.h };
    });
    undoArrangementId = String(arrangementId);
  }
  if (after.some((frame) => !validCanvasArrangementFrame(frame))) throw new Error("canvas_arrangement_geometry_out_of_bounds");
  const arrangementId = "outcome-arrangement:" + await consentHash({ actor: authority.principal.userId, operationId: request.operationId });
  if (authority.events.some((event) => event.type === "CanvasArrangementCreated" && event.payload.arrangement_id === arrangementId))
    throw new Error("canvas_arrangement_operation_unavailable");
  const sources = items.map((item) => ({ itemId: item.id, sourceKind: item.sourceKind, sourceId: item.sourceId, rot: item.rot, z: item.z }));
  let pt = Date.now();
  for (const event of authority.events) {
    if (event.type !== "CanvasRegisterSet") continue;
    const operation = record(event.payload.operation), object = record(operation.object);
    if (!request.selectedItemIds.includes(String(object.item_id ?? event.payload.item_id ?? ""))) continue;
    const clock = record(operation.hlc ?? event.payload.hlc), previous = Number(clock.pt ?? Date.parse(event.occurredAt));
    if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER)
      throw new Error("canvas_arrangement_clock_unavailable");
    pt = Math.max(pt, previous + 1);
  }
  const site = authority.principal.userId + ":canvas-arrangement";
  const common = { project_id: request.projectId, canvas_id: request.canvasId, arrangement_id: arrangementId,
    organization_action_id: request.operationId, history_action_id: request.operationId, history_owner_id: authority.principal.userId,
    source_surface: "canvas-outcome-arrangement", arrangement_is_context: false };
  const framePayload = (frame: CanvasArrangementFrame) => ({ item_id: frame.itemId, x: frame.x, y: frame.y, w: frame.w, h: frame.h });
  const events: EventInput[] = [{ type: "CanvasArrangementCreated", payload: {
    ...common, client_event_id: arrangementId + ":0", name: request.name, kind: outcomeRecipe(request.recipeId)!.arrangement, recipe_id: request.recipeId,
    item_ids: request.selectedItemIds, previous_frames: before.map(framePayload), frames: after.map(framePayload),
    source_items: sources.map((source) => ({ item_id: source.itemId, source_kind: source.sourceKind, source_id: source.sourceId, rot: source.rot, z: source.z })),
    undo_of_arrangement_id: undoArrangementId,
  } }];
  for (let index = 0; index < items.length; index++) for (const prop of ["x", "y"] as const) {
    const ordinal = events.length;
    events.push({ type: "CanvasRegisterSet", payload: {
      ...common, client_event_id: arrangementId + ":" + ordinal, item_id: items[index].id, previous_value: before[index][prop],
      selected_item_ids: request.selectedItemIds, operation: { object: { kind: "canvas_item", item_id: items[index].id },
        prop, value: after[index][prop], hlc: { pt, c: ordinal, site } },
    } });
  }
  assertAtomicCanvasArrangementEvents(events, authority.principal.userId);
  const binding = { ...authority.binding, intentHash: hash,
    sourceHash: await consentHash({ layoutRevision: request.expectedLayoutRevision, sourceRevision: request.expectedSourceRevision, evidence: authority.snapshot.hash }), request };
  return { operation: "canvas-arrangement", binding, sourceHead: authority.sourceHead, events, changes: [],
    arrangement: { ...request, arrangementId, before, after, sources, undoArrangementId },
    result: { operationId: request.operationId, requestHash: hash, arrangementId, itemCount: items.length, blockIds: [], relationCount: 0 },
    expiresAt: new Date(Date.now() + PREVIEW_MS).toISOString() };
}

function noPriorIntent(authority: CanvasAuthority, operationId: string): BudgetReservationGuard {
  return { sql: "NOT EXISTS(SELECT 1 FROM authoring_commits WHERE actor_user_id=? AND operation='canvas-arrangement' AND json_extract(result_json,'$.operationId')=?) "
    + "AND NOT EXISTS(SELECT 1 FROM private_content WHERE owner_id=? AND kind='authoring-preview' "
    + "AND json_extract(" + privateJson + ",'$.plan.operation')='canvas-arrangement' AND json_extract(" + privateJson + ",'$.plan.result.operationId')=?)",
  bindings: [authority.principal.userId, operationId, authority.principal.userId, operationId] };
}
function uniqueCommittedArrangement(authority: CanvasAuthority, plan: AuthoringPlan): BudgetReservationGuard {
  return { sql: "(SELECT COUNT(*) FROM events WHERE stream_id=? AND type='CanvasArrangementCreated' AND json_extract(payload,'$.arrangement_id')=?)=1 "
    + "AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE actor_user_id=? AND operation='canvas-arrangement' AND json_extract(result_json,'$.operationId')=?)",
  bindings: [authority.binding.streamId, plan.result.arrangementId!, authority.principal.userId, plan.result.operationId!] };
}

/** Free preview/recovery and explicit online apply. No call uses the Canvas offline queue or a provider. */
export async function handleCanvasArrangements(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "POST") return failure("method_not_allowed", 405);
  let body: Record<string, unknown>;
  try { body = record(await request.json()); } catch { return failure("invalid_json", 400); }
  if (Object.keys(body).some((key) => !["action", "operationId", "projectId", "canvasId", "recipeId", "name", "selectedItemIds",
    "expectedLayoutRevision", "expectedSourceRevision", "undoOperationId", "previewId", "approvalHash", "confirmed", "includeDisposition", "onlyIfUnapplied"].includes(key)))
    return failure("canvas_arrangement_request_invalid", 400);
  const action = String(body.action ?? "");
  if (!["preview", "undo-preview", "apply", "retrieve", "dismiss"].includes(action)) return failure("canvas_arrangement_action_invalid", 400);
  if (Object.hasOwn(body, "includeDisposition") && (action !== "retrieve" || body.includeDisposition !== true)
    || Object.hasOwn(body, "onlyIfUnapplied") && (action !== "dismiss" || body.onlyIfUnapplied !== true))
    return failure("canvas_arrangement_request_invalid", 400);
  let identity: Identity, normalized: CanvasArrangementRequest | null = null;
  try {
    identity = normalizeIdentity(body);
    if (action === "preview" || action === "undo-preview" || action === "apply") normalized = normalizeRequest(body);
    if (action === "undo-preview" && !normalized?.undoOperationId) return failure("canvas_arrangement_undo_invalid", 400);
  } catch (error) { return failure(error instanceof Error ? error.message : "canvas_arrangement_request_invalid", 400); }
  try {
    const authority = await prepareAuthority(request, env, identity, normalized?.selectedItemIds);
    if (authority instanceof Response) return authority;
    const hash = normalized ? await requestHash(authority, normalized) : undefined;
    const existing = await existingIntent(env, authority, identity, hash, body.includeDisposition === true);
    if (action === "retrieve") return existing ?? (body.includeDisposition === true
      ? failure("canvas_arrangement_operation_unavailable")
      : result({ status: "not-applied", ...identity, providerCalls: 0, maximumMicrousd: 0 }));
    if (action === "preview" || action === "undo-preview") {
      if (existing) return existing;
      const plan = await createPlan(env, authority, normalized!, hash!);
      const guard = mergeGuards(authority.snapshot.guard, noPriorIntent(authority, identity.operationId), {
        sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [authority.binding.streamId, authority.sourceHead],
      });
      try {
        const preview = await storeAuthoringPreview(env, authority.principal, plan, guard);
        if (!await executionAuthorityCurrent(env, authority.principal, authority.binding, authority.sourceHead))
          return failure("canvas_arrangement_access_changed", 403);
        const disclosure = await currentAuthoringPreviewDisclosure(env, authority.principal, authority.binding, preview.previewId,
          preview.approvalHash, plan, JSON.stringify({ plan, approvalHash: preview.approvalHash, state: "review" }), authority.sourceHead);
        if (!disclosure) return failure("canvas_arrangement_access_changed", 403);
        if (!disclosure.privateCurrent) return failure("canvas_arrangement_preview_unavailable", 403);
        return result({ status: "review", preview: presentationPreview(preview.previewId, preview.approvalHash, plan) });
      } catch (error) {
        const recovered = await existingIntent(env, authority, identity, hash);
        if (recovered) return recovered;
        throw error;
      }
    }
    if (!id(body.previewId, 128) || typeof body.approvalHash !== "string" || !/^[a-f0-9]{64}$/u.test(body.approvalHash)
      || action === "apply" && body.confirmed !== true) return failure("canvas_arrangement_confirmation_required", 428);
    const previewId = await intentPreviewId(env, authority, identity.operationId);
    if (!previewId || previewId !== body.previewId) return failure("canvas_arrangement_preview_unavailable");
    if (action === "dismiss" && body.onlyIfUnapplied === true)
      return dismissArrangementIfUnapplied(env, authority, identity, previewId, body.approvalHash);
    let state = await readAuthoringState(env, authority.principal, authority.binding, previewId, { readOnly: true });
    if (!state) return failure("canvas_arrangement_access_denied", 403);
    // Only explicit original Apply/Discard invokes the existing atomic expired-lease release.
    if (state.status === "applying" && state.saved && identityMatches(state.saved.plan, identity)
      && state.saved.approvalHash === body.approvalHash) {
      const lease = await currentAuthoringPreviewDisclosure(env, authority.principal, authority.binding, previewId,
        body.approvalHash, state.saved.plan, state.retainedContent);
      if (!lease) return failure("canvas_arrangement_access_denied", 403);
      if (lease.leaseExpired) {
        await releaseExpiredAuthoringLease(env, authority.principal, authority.binding, previewId);
        state = await readAuthoringState(env, authority.principal, authority.binding, previewId, { readOnly: true });
        if (!state) return failure("canvas_arrangement_access_denied", 403);
      }
    }
    if (state.committed) {
      if (state.committed.approvalHash !== body.approvalHash) return failure("canvas_arrangement_operation_mismatch");
      if (action === "dismiss") await dismissAuthoringPreview(env, authority.principal, authority.binding, previewId, body.approvalHash);
      return await existingIntent(env, authority, identity, hash) ?? failure("canvas_arrangement_receipt_pending");
    }
    if (state.status === "applying") return result({ status: "applying", ...identity, previewId }, 202);
    const saved = state.saved;
    if (!saved || !identityMatches(saved.plan, identity) || saved.approvalHash !== body.approvalHash)
      return failure("canvas_arrangement_preview_unavailable");
    if (action === "dismiss") {
      const dismissed = await dismissAuthoringPreview(env, authority.principal, authority.binding, previewId, body.approvalHash);
      return dismissed ? result({ status: "dismissed", ...identity, previewId })
        : result({ status: "applying", ...identity, previewId }, 202);
    }
    if (!normalized || !saved.plan.arrangement || saved.plan.result.requestHash !== hash
      || canonicalConsent(saved.plan.binding.request) !== canonicalConsent(normalized) || saved.state === "dismissed")
      return failure("canvas_arrangement_operation_mismatch");
    await validateSelection(authority, normalized);
    const plan = saved.plan;
    assertAtomicCanvasArrangementEvents(plan.events, authority.principal.userId);
    const current = { ...authority.binding, intentHash: hash!, sourceHash: await consentHash({
      layoutRevision: normalized.expectedLayoutRevision, sourceRevision: normalized.expectedSourceRevision, evidence: authority.snapshot.hash,
    }), request: normalized };
    try {
      await commitAuthoringPlan(env, authority.principal, current, authority.shared, previewId, saved.approvalHash, plan,
        authority.sourceHead, mergeGuards(authority.snapshot.guard, uniqueCommittedArrangement(authority, plan)));
    } catch {
      // A response can disappear after COMMIT. Read the existing identity; never issue a replacement mutation.
      const recovered = await existingIntent(env, authority, identity, hash);
      if (recovered && recovered.status !== 200) return recovered;
      if (recovered) {
        const status = record(await recovered.clone().json()).status;
        if (status === "applied" || status === "applying") return recovered;
      }
      return failure("canvas_arrangement_commit_not_applied");
    }
    return await existingIntent(env, authority, identity, hash) ?? failure("canvas_arrangement_receipt_pending", 503);
  } catch (error) {
    const code = error instanceof Error ? error.message : "canvas_arrangement_unavailable";
    return failure(code.startsWith("canvas_arrangement_") ? code : "canvas_arrangement_unavailable",
      /read_only|access|custody/u.test(code) ? 403 : 409);
  }
}
