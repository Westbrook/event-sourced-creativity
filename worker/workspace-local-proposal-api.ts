import { ideasInDocument } from '../src/model/project-ideas.ts';
import { isOutputContextType } from "../src/model/output-requirements.ts";
import { outputAuthoringBlocksFromEvents, prepareOutputRequirementClientEvents, type OutputAuthoringGuardResult } from "./output-requirement-event-guards.ts";
import { buildWorkspaceQuickEditPlan, normalizeWorkspaceQuickEditIntent, validWorkspaceQuickEditEvents, WORKSPACE_QUICK_EDIT_VERSION, type WorkspaceQuickEditIntent } from "../src/model/workspace-local-proposal.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { audioRightsAllowed } from "../src/model/audio.ts";
import { foldEvents } from "../src/model/events.ts";
import { authoringPreview, commitAuthoringPlan, dismissAuthoringPreview, latestAuthoringPreview, readAuthoringState, releaseExpiredAuthoringLease, storeAuthoringPreview, type AuthoringPlan, type RetainedAuthoringPreview } from "./authoring-commits.ts";
import { currentAuthoringPreviewDisclosure } from "./authoring-preview-disclosure.ts";
import { canonicalConsent, consentHash, executionAdmissionGuard, executionAuthorityCurrent, type ConsequentialBinding } from "./consequential-consent.ts";
import { contextSourceHash, prepareDocumentAuthority } from "./context-authoring-authority.ts";
import { packAuthoringSourceProof, prepareAuthoringSourceProof } from "./context-authoring-source.ts";
import { governedPackageSourceRightsValidity, sourceRightsDispatchGuard } from "./context-package-rights.ts";
import { readProjectSourceEvents, synchronizeProjectScope } from "./project-access.ts";
import type { BudgetReservationGuard, PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const headers = { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });
const outputRefusal = (guard: Extract<OutputAuthoringGuardResult<never>, { ok: false }>) => response({ error: guard.error, status: "not-applied", ...(guard.blockId ? { blockId: guard.blockId } : {}) }, guard.status);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const operation = "workspace-quick-edit";
const privateJson = "CASE WHEN redacted_at IS NULL AND json_valid(content) THEN content ELSE '{}' END";
const combine = (...guards: BudgetReservationGuard[]): BudgetReservationGuard => ({
  sql: guards.map((guard) => "(" + guard.sql + ")").join(" AND "), bindings: guards.flatMap((guard) => guard.bindings),
});
type Prepared = Exclude<Awaited<ReturnType<typeof prepareWorkspace>>, Response>;

async function prepareWorkspace(request: Request, env: WorkerEnv, body: Record<string, unknown>, authority: "read" | "author") {
  const prepared = await prepareDocumentAuthority(request, env, body, authority);
  if (prepared instanceof Response) return prepared;
  // Migrated owners without a selected cookie must use the same tenant-custodied source.
  const events = prepared.scope ? await readProjectSourceEvents(env, prepared.scope) : prepared.events;
  const projection = foldEvents(events, Infinity, prepared.binding.documentId, prepared.binding.projectId);
  const sourceHash = await contextSourceHash(prepared.binding.projectId, prepared.binding.documentId, undefined, projection, events);
  const binding: ConsequentialBinding = { ...prepared.binding, version: WORKSPACE_QUICK_EDIT_VERSION, operation, blockId: "", canvasId: null, sourceHash, intentHash: sourceHash };
  return { ...prepared, events, projection, binding };
}
function sameScope(saved: RetainedAuthoringPreview, principal: PilotUser, binding: ConsequentialBinding) {
  const original = saved.plan.binding;
  return saved.plan.operation === operation && original.operation === operation && original.actorUserId === principal.userId
    && original.projectId === binding.projectId && original.documentId === binding.documentId && original.blockId === "" && original.canvasId === null
    && original.streamId === binding.streamId && canonicalConsent(original.scope) === canonicalConsent(binding.scope);
}
async function operationPreviewId(env: WorkerEnv, principal: PilotUser, binding: ConsequentialBinding, operationId: string) {
  const guard = executionAdmissionGuard(principal, binding, null);
  const found = await env.DB.prepare(`SELECT preview_id FROM(
    SELECT content_id AS preview_id FROM private_content WHERE owner_id=? AND kind='authoring-preview'
      AND json_extract(${privateJson},'$.plan.operation')='workspace-quick-edit' AND json_extract(${privateJson},'$.plan.result.operationId')=?
    UNION ALL SELECT preview_id FROM authoring_commits WHERE actor_user_id=? AND operation='workspace-quick-edit'
      AND json_extract(result_json,'$.operationId')=?) WHERE ${guard.sql} LIMIT 1`)
    .bind(principal.userId, operationId, principal.userId, operationId, ...guard.bindings).first<{ preview_id: string }>();
  return found?.preview_id ?? null;
}
async function latestReceiptId(env: WorkerEnv, principal: PilotUser, binding: ConsequentialBinding) {
  const guard = executionAdmissionGuard(principal, binding, null);
  const row = await env.DB.prepare(`SELECT preview_id FROM authoring_commits WHERE actor_user_id=? AND operation='workspace-quick-edit'
    AND project_id=? AND document_id=? AND block_id='' AND canvas_id IS NULL AND COALESCE(organization_id,'')=? AND COALESCE(project_access_id,'')=?
    AND COALESCE(json_extract(result_json,'$.dismissed'),0)<>1 AND ${guard.sql} ORDER BY created_at DESC,rowid DESC LIMIT 1`)
    .bind(principal.userId, binding.projectId, binding.documentId, binding.scope?.organizationId ?? "", binding.scope?.projectAccessId ?? "", ...guard.bindings).first<{ preview_id: string }>();
  return row?.preview_id ?? null;
}
function operationAvailable(userId: string, operationId: string): BudgetReservationGuard {
  return { sql: `NOT EXISTS(SELECT 1 FROM private_content WHERE owner_id=? AND kind='authoring-preview'
    AND json_extract(${privateJson},'$.plan.operation')='workspace-quick-edit' AND json_extract(${privateJson},'$.plan.result.operationId')=?)
    AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE actor_user_id=? AND operation='workspace-quick-edit' AND json_extract(result_json,'$.operationId')=?)`,
    bindings: [userId, operationId, userId, operationId] };
}
async function sourceProof(env: WorkerEnv, prepared: Prepared) {
  const { projection, events, binding } = prepared;
  let expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const rights = (properties: Record<string, unknown>) => {
    const validity = creativeContextRightsValidity(properties);
    if (validity.issue) throw new Error("workspace_quick_edit_source_rights_unavailable");
    if (validity.validUntil && validity.validUntil < expiresAt) expiresAt = validity.validUntil;
  };
  const blocks = projection.libraryBlocks.filter((block) => !block.removed);
  for (const block of blocks) {
    rights(block.properties);
    const referenceId = String(block.properties.reference_id ?? "");
    if (referenceId) {
      const latest = [...events].reverse().find((event) => ["ReferenceIngested", "RightsAsserted"].includes(event.type) && event.payload.reference_id === referenceId);
      if (!latest || !(block.type === "audio" ? audioRightsAllowed(latest.payload.rights_class)
        : ["owned", "owned_or_licensed", "account-generated"].includes(String(latest.payload.rights_class ?? "")))) throw new Error("workspace_quick_edit_source_rights_unavailable");
      rights(latest.payload);
    }
  }
  const governed = await governedPackageSourceRightsValidity(env, binding.scope?.organizationId ?? "", blocks, (scope) => synchronizeProjectScope(env, scope));
  if (!governed.current) throw new Error("workspace_quick_edit_source_rights_unavailable");
  if (governed.validUntil && governed.validUntil < expiresAt) expiresAt = governed.validUntil;
  const native = await prepareAuthoringSourceProof(env, prepared);
  return { native, governed, expiresAt };
}
const stalePreview = (saved: RetainedAuthoringPreview, binding: ConsequentialBinding) =>
  saved.plan.binding.sourceHash !== binding.sourceHash || saved.plan.binding.permissionEpoch !== binding.permissionEpoch
    || saved.plan.binding.contextSessionId !== binding.contextSessionId || saved.plan.expiresAt <= new Date().toISOString();

/** Free deterministic rules, separate human approval and canonical atomic receipt. No model, purchase or queue. */
export async function handleWorkspaceLocalProposal(request: Request, env: WorkerEnv) {
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = record(await request.json()); } catch { return response({ error: "invalid_request" }, 400); }
  const action = String(body.action ?? "");
  if (!["preview", "apply", "retrieve", "resume", "dismiss"].includes(action)) return response({ error: "authoring_action_required" }, 400);
  const allowed = action === "preview" ? ["action", "projectId", "documentId", "operationId", "prompt", "targetBlockId"]
    : action === "resume" ? ["action", "projectId", "documentId", "operationId"] : ["action", "projectId", "documentId", "previewId", "approvalHash"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return response({ error: "workspace_quick_edit_invalid_request" }, 400);
  const prepared = await prepareWorkspace(request, env, body, "read");
  if (prepared instanceof Response) return prepared;
  const { principal, binding } = prepared;
  let previewId = typeof body.previewId === "string" ? body.previewId : "", approvalHash = typeof body.approvalHash === "string" ? body.approvalHash : "";
  let intent: WorkspaceQuickEditIntent | null = null, requestHash = "";
  if (action === "preview") {
    try { intent = normalizeWorkspaceQuickEditIntent(body); } catch (error) { return response({ error: (error as Error).message }, 400); }
    requestHash = await consentHash(intent);
    previewId = await operationPreviewId(env, principal, binding, intent.operationId) ?? "";
  } else if (action === "resume") {
    if (body.operationId !== undefined) {
      if (typeof body.operationId !== "string" || !/^[A-Za-z0-9_-]{16,120}$/u.test(body.operationId)) return response({ error: "workspace_quick_edit_operation_required" }, 400);
      previewId = await operationPreviewId(env, principal, binding, body.operationId) ?? "";
    } else {
      const latest = await latestAuthoringPreview(env, principal, binding);
      previewId = latest?.previewId ?? await latestReceiptId(env, principal, binding) ?? "";
    }
    if (!previewId) return await executionAuthorityCurrent(env, principal, binding, null) ? response({ status: "none" }) : response({ error: "context_authorization_changed" }, 403);
  }
  if (previewId) {
    if (previewId.length > 120 || action !== "preview" && action !== "resume" && !/^[a-f0-9]{64}$/u.test(approvalHash)) return response({ error: "authoring_approval_required" }, 428);
    // Checking an uncertain outcome never acquires/releases a lease or replays a write.
    const state = await readAuthoringState(env, principal, binding, previewId, { readOnly: true });
    if (!state) return response({ error: "context_authorization_changed" }, 403);
    const { saved, committed } = state;
    if (state.receiptPending) return response({ error: "authoring_receipt_unavailable", status: "applying", previewId }, 503);
    if (action === "preview" || action === "resume") approvalHash = committed?.approvalHash ?? saved?.approvalHash ?? "";
    if (committed && committed.approvalHash !== approvalHash) return response({ error: "authoring_approval_changed" }, 409);
    if (requestHash && (committed?.result.requestHash ?? saved?.plan.result.requestHash) !== requestHash) return response({ error: "workspace_quick_edit_operation_conflict" }, 409);
    if (committed && action !== "dismiss") {
      const disclosure = saved && sameScope(saved, principal, binding) && saved.approvalHash === approvalHash
        ? await currentAuthoringPreviewDisclosure(env, principal, binding, previewId, approvalHash, saved.plan, state.retainedContent) : null;
      if (!disclosure && !await executionAuthorityCurrent(env, principal, binding, null)) return response({ error: "context_authorization_changed" }, 403);
      return response({ status: "applied", previewId, approvalHash, ...committed.result, idempotent: true,
        ...(disclosure?.privateCurrent ? { preview: authoringPreview(previewId, approvalHash, saved!.plan) } : {}) });
    }
    if (action === "dismiss" && committed) return await dismissAuthoringPreview(env, principal, binding, previewId, approvalHash)
      ? response({ status: "dismissed" }) : response({ error: "authoring_save_in_progress", status: "applying" }, 409);
    if (!saved || saved.approvalHash !== approvalHash || !sameScope(saved, principal, binding) || !saved.plan.localReview
      || await consentHash(saved.plan) !== approvalHash || !validWorkspaceQuickEditEvents(saved.plan.events)) return response({ error: "authoring_preview_unavailable" }, 403);
    if (action === "dismiss") {
      if (state.leaseExpired) await releaseExpiredAuthoringLease(env, principal, binding, previewId);
      return await dismissAuthoringPreview(env, principal, binding, previewId, approvalHash)
        ? response({ status: "dismissed" }) : response({ error: "authoring_save_in_progress", status: "applying" }, 409);
    }
    const stale = stalePreview(saved, binding);
    if (action !== "apply" || saved.state === "applying" && !state.leaseExpired) {
      const disclosure = await currentAuthoringPreviewDisclosure(env, principal, binding, previewId, approvalHash, saved.plan, state.retainedContent);
      if (!disclosure) return response({ error: "context_authorization_changed" }, 403);
      if (disclosure.committed) return response({ status: "applied", previewId, approvalHash, ...disclosure.committed.result, idempotent: true });
      if (!disclosure.privateCurrent) return response({ error: "authoring_preview_unavailable" }, 403);
      if (action !== "apply") return response({ status: disclosure.leaseExpired ? "not-applied" : state.status, preview: authoringPreview(previewId, approvalHash, saved.plan), stale, retryable: disclosure.leaseExpired, dismissed: saved.state === "dismissed" });
      return response({ status: "applying", preview: authoringPreview(previewId, approvalHash, saved.plan) }, 202);
    }
    if (saved.state === "dismissed") return response({ error: "authoring_preview_dismissed", status: "not-applied" }, 409);
    try {
      const author = await prepareWorkspace(request, env, body, "author");
      if (author instanceof Response) return author;
      if (stale || stalePreview(saved, author.binding)) throw new Error("authoring_preview_stale");
      const currentOutput = prepareOutputRequirementClientEvents(saved.plan.events, outputAuthoringBlocksFromEvents(author.events));
      if (!currentOutput.ok) return outputRefusal(currentOutput);
      if (JSON.stringify(currentOutput.events) !== JSON.stringify(saved.plan.events)) throw new Error("authoring_preview_stale");
      const intent = normalizeWorkspaceQuickEditIntent(saved.plan.localReview);
      const planned = buildWorkspaceQuickEditPlan({ projection: author.projection, intent, sourceHead: saved.plan.sourceHead, createId: () => saved.plan.result.blockIds[0] });
      const checkedOutput = prepareOutputRequirementClientEvents(planned.events, outputAuthoringBlocksFromEvents(author.events));
      if (!checkedOutput.ok) return outputRefusal(checkedOutput);
      if (JSON.stringify(checkedOutput.events) !== JSON.stringify(saved.plan.events)) throw new Error("authoring_preview_stale");
      const proof = await sourceProof(env, author);
      await releaseExpiredAuthoringLease(env, author.principal, author.binding, previewId);
      const current = { ...author.binding, intentHash: saved.plan.binding.intentHash, request: saved.plan.binding.request };
      const result = await commitAuthoringPlan(env, author.principal, current, author.shared, previewId, approvalHash, saved.plan, author.sourceHead, (events) =>
        packAuthoringSourceProof(combine(proof.native, sourceRightsDispatchGuard(proof.governed, {
          streamId: current.streamId, actorUserId: principal.userId, correlationId: "authoring:" + principal.userId + ":" + previewId, eventIds: events.map((event) => event.eventId),
        }), { sql: "strftime('%Y-%m-%dT%H:%M:%fZ','now')<?", bindings: [proof.expiresAt] })));
      if (!await executionAuthorityCurrent(env, principal, binding, null)) return response({ error: "authoring_result_read_unavailable", previewId }, 403);
      return response({ status: "applied", previewId, approvalHash, ...result });
    } catch (error) {
      const outcome = await readAuthoringState(env, principal, binding, previewId, { readOnly: true });
      if (!outcome) return response({ error: "context_authorization_changed" }, 403);
      if (outcome.committed) return outcome.committed.approvalHash === approvalHash
        ? response({ status: "applied", previewId, approvalHash, ...outcome.committed.result, idempotent: true })
        : response({ error: "authoring_approval_changed" }, 409);
      if (outcome.status === "applying") return response({ status: "applying", previewId, approvalHash }, outcome.receiptPending ? 503 : 202);
      return response({ error: error instanceof Error && /^(?:authoring_|workspace_quick_edit_|context_|project_|stale_sequence)/u.test(error.message) ? error.message : "authoring_not_applied", status: "not-applied", previewId }, 409);
    }
  }
  if (action !== "preview" || !intent) return response({ error: "authoring_approval_required" }, 428);
  const author = await prepareWorkspace(request, env, body, "author");
  if (author instanceof Response) return author;
  try {
    const target = intent.targetBlockId ? ideasInDocument(author.projection,author.binding.documentId).find(block=>block.id===intent.targetBlockId) : undefined;
    if (target && isOutputContextType(target.type)) return response({ error: "output_requirement_endpoint_required", status: "not-applied", blockId: target.id }, 409);
    const planned = buildWorkspaceQuickEditPlan({ projection: author.projection, intent, sourceHead: author.sourceHead });
    const output = prepareOutputRequirementClientEvents(planned.events, outputAuthoringBlocksFromEvents(author.events));
    if (!output.ok) return outputRefusal(output);
    const proof = await sourceProof(env, author);
    const current = { ...author.binding, intentHash: requestHash, request: { ...intent } };
    const plan: AuthoringPlan = { operation, binding: current, sourceHead: author.sourceHead, events: output.events, changes: planned.changes, localReview: planned.review,
      result: { blockIds: planned.blockIds, relationCount: 0, documentId: current.documentId, operationId: intent.operationId, requestHash }, expiresAt: proof.expiresAt };
    const preview = await storeAuthoringPreview(env, principal, plan, packAuthoringSourceProof(combine(proof.native, sourceRightsDispatchGuard(proof.governed),
      operationAvailable(principal.userId, intent.operationId), { sql: "strftime('%Y-%m-%dT%H:%M:%fZ','now')<?", bindings: [proof.expiresAt] })));
    if (!await executionAuthorityCurrent(env, principal, current, author.sourceHead)) return response({ error: "context_authorization_changed" }, 403);
    const disclosure = await currentAuthoringPreviewDisclosure(env, principal, current, preview.previewId, preview.approvalHash,
      plan, JSON.stringify({ plan, approvalHash: preview.approvalHash, state: "review" }), author.sourceHead);
    if (!disclosure) return response({ error: "context_authorization_changed" }, 403);
    if (!disclosure.privateCurrent) return response({ error: "authoring_preview_unavailable" }, 403);
    return response({ status: "not-applied", preview });
  } catch (error) {
    // The winner of simultaneous previews is read back; no second plan is rebuilt or published.
    const winner = await operationPreviewId(env, principal, binding, intent.operationId);
    if (winner) {
      const state = await readAuthoringState(env, principal, binding, winner, { readOnly: true });
      if (state?.committed?.result.requestHash === requestHash) return response({ status: "applied", previewId: winner, approvalHash: state.committed.approvalHash, ...state.committed.result, idempotent: true });
      if (state?.saved && sameScope(state.saved, principal, binding) && state.saved.plan.result.requestHash === requestHash) {
        const disclosure = await currentAuthoringPreviewDisclosure(env, principal, binding, winner, state.saved.approvalHash, state.saved.plan, state.retainedContent);
        if (!disclosure) return response({ error: "context_authorization_changed" }, 403);
        if (disclosure.committed) return response({ status: "applied", previewId: winner, approvalHash: disclosure.committed.approvalHash, ...disclosure.committed.result, idempotent: true });
        if (!disclosure.privateCurrent) return response({ error: "authoring_preview_unavailable" }, 403);
        return response({ status: disclosure.leaseExpired ? "not-applied" : state.status, preview: authoringPreview(winner, state.saved.approvalHash, state.saved.plan), stale: stalePreview(state.saved, binding), retryable: disclosure.leaseExpired, idempotent: true });
      }
      return response({ error: "workspace_quick_edit_operation_conflict" }, 409);
    }
    return response({ error: error instanceof Error && /^(?:workspace_quick_edit_|authoring_|context_)/u.test(error.message) ? error.message : "workspace_quick_edit_unavailable", status: "not-applied" }, 409);
  }
}
