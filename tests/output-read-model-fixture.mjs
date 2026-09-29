import assert from "node:assert/strict";
import { registerScalingSourceImports, measureOutputBindings } from "./output-read-model-test-helpers.mjs";
const hooks = registerScalingSourceImports();
const { outputTestDatabase } = await import("./output-server-test-helpers.mjs");
const { ensureSchema, makeEvent, appendEvents } = await import("../worker/runtime.ts");
const { handleOutputRequirements } = await import("../worker/output-requirements-api.ts");
const { handleWorkspaces } = await import("../worker/workspaces-api.ts");
const { synchronizeProjectScope } = await import("../worker/project-access.ts");
const { outputAssetObjectKeys } = await import("../worker/output-asset-storage-identity.ts");
const { parseOutputRequirement } = await import("../src/model/output-requirements.ts");
const { inspectOutputAsset } = await import("../src/model/output-asset-inspection.ts");
const { extractSourceDocument, sourceDocumentEvidence, sourceDocumentEvidenceDigest } = await import("../src/model/source-documents.ts");
const { ownerMediaNamespace } = await import("../src/model/media-ownership.ts");
const { png } = await import("./output-asset-fixtures.mjs");
hooks.deregister();

export const outputReadModelOwner = "dev-local-creative", outputReadModelProject = "scaling-project", outputReadModelDocument = "scaling-document", outputReadModelBase = "/api/output-requirements";
const owner = outputReadModelOwner, project = outputReadModelProject, doc = outputReadModelDocument, base = outputReadModelBase;
export const outputReadModelScope = { kind: "personal", key: `personal:${owner}:${project}`, ownerUserId: owner, actorUserId: owner, projectId: project, documentId: doc, organizationId: null, projectAccessId: null, contextId: null };

export async function outputReadModelFixture(count, { grants = true, shared = false, actingReviewer = false, sourceReferences = 0, sourceClaimsPerObject = 1, pageSize = 250 } = {}) {
  let scope = { ...outputReadModelScope }, requestHeaders = {}, organizationId = null, projectAccessId = null, contextId = null;
  const reviewer = shared ? "independent-output-reviewer" : owner;
  const state = outputTestDatabase();
  await ensureSchema(state.env);
  const now = new Date().toISOString(), stream = `creative:${owner}`;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)").run(owner, "creative@local.forma", "Local creative", now, now, now);
  await appendEvents(state.env, [
    makeEvent(stream, 0, `user:${owner}`, "scaling", "seed", "ProjectCreated", { project_id: project, name: "Output bulk-read tests" }),
    makeEvent(stream, 0, `user:${owner}`, "scaling", "seed", "DocumentCreated", { project_id: project, document_id: doc, title: "One full output assignment", handle: "scaling-document" }),
    makeEvent(stream, 0, `user:${owner}`, "scaling", "seed", "BlockCreated", { project_id: project, document_id: doc, block_id: "source", scope: "document", type: "direction", position: "a0", handle: "direction/source", properties: { text: "One authored, retained source.", authority: "authored", weight: 1 } }),
  ]);
  for (let index = 0; index < sourceReferences; index++) {
    const mimeType = "text/plain", bytes = new TextEncoder().encode(`Retained source statement ${index}.`);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const extracted = await extractSourceDocument(new File([bytes], `source-${index}.txt`, { type: mimeType }));
    const sourceEvidence = sourceDocumentEvidence(extracted, hash, mimeType), evidenceHash = await sourceDocumentEvidenceDigest(sourceEvidence);
    const key = `${ownerMediaNamespace(owner)}/read-model-source-${index}.txt`;
    state.media.set(key, { bytes, contentType: mimeType, metadata: { ownerId: owner, sha256: hash, mimeType, sourceEvidenceSha256: evidenceHash } });
    for (let claim = 0; claim < sourceClaimsPerObject; claim++) {
    const suffix = claim === 0 ? "" : `-${claim}`;
    await appendEvents(state.env, [makeEvent(stream, 0, `user:${owner}`, "scaling", `source-${index}${suffix}`, "BlockCreated", { project_id: project, document_id: doc, block_id: `reference-${index}${suffix}`, scope: "document", type: "reference", position: `r${index}${suffix}`, properties: {
      reference_id: `owned-reference-${index}${suffix}`, media_url: `/api/media/${encodeURIComponent(key)}`, source_evidence_hash: evidenceHash, source_content_hash: hash, source_mime_type: mimeType, source_kind: extracted.sourceKind, extraction_status: extracted.status,
      text: extracted.text, source_citations: extracted.segments.map((segment) => ({ anchor: segment.anchor, excerpt: segment.text })), source_segment_count: extracted.segments.length, source_excerpt_truncated: extracted.truncated,
    } }), makeEvent(stream, 0, `user:${owner}`, "scaling", `source-rights-${index}${suffix}`, "RightsAsserted", { project_id: project, document_id: doc, reference_id: `owned-reference-${index}${suffix}`, rights_class: "owned" })]);
    }
  }
  if (shared) {
    const workspace = async (path, body) => handleWorkspaces(new Request(`http://localhost/api/workspaces${path.length ? `/${path.join("/")}` : ""}`, { method: "POST", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) }), state.env, path);
    const created = await workspace([], { name: "Shared Output read model fixture" }); assert.equal(created.status, 201, await created.clone().text()); organizationId = (await created.json()).organizationId;
    const attached = await workspace([organizationId, "projects"], { projectId: project }); assert.equal(attached.status, 201, await attached.clone().text()); projectAccessId = (await attached.json()).projectAccessId;
    const selected = await workspace([organizationId, "projects", projectAccessId, "context"]); assert.equal(selected.status, 200, await selected.clone().text());
    requestHeaders = { cookie: selected.headers.get("set-cookie").split(";")[0] }; contextId = decodeURIComponent(requestHeaders.cookie.split("=").slice(1).join("="));
    scope = { ...scope, kind: "project", key: `project:${organizationId}:${projectAccessId}`, organizationId, projectAccessId, contextId };
    state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)").run(reviewer, "reviewer@local.forma", "Independent reviewer", now, now, now);
    state.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)").run("reviewer-organization-membership", organizationId, reviewer, owner, now, now, now);
    state.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)").run("reviewer-project-membership", organizationId, projectAccessId, project, reviewer, owner, now, now);
    state.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,'project.review.approve','project',?,?,?,'active',?,?,?)").run("independent-reviewer-grant", reviewer, organizationId, projectAccessId, project, owner, now, now);
    // Match the app's initial project hydration; measured Output requests must
    // prove this projection is current rather than silently repairing it.
    await synchronizeProjectScope(state.env, { organizationId, projectAccessId, projectId: project, ownerUserId: owner });
  }
  const counters = measureOutputBindings(state, { pageSize, trace: true });
  const execution = { waitUntil() { throw new Error("unexpected_background_dispatch"); } };
  const send = (path = `${base}?documentId=${doc}`, init = {}) => handleOutputRequirements(new Request(`http://localhost${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers ?? {})), ...requestHeaders } }), state.env, path.split("?")[0], execution);
  let mutation = 0;
  const snapshot = async () => { const response = await send(); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const command = async (body) => {
    const expectedRevision = `output:${state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head}`;
    return send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: doc, clientMutationId: `scaling-${++mutation}`, expectedRevision, ...body }) });
  };
  const spec = parseOutputRequirement({ id: "images-output", type: "output", subtype: "Social media image", content: 'Output images at aspect ratio "1:1".' }).spec;
  spec.deliverables[0].format_variants = [spec.deliverables[0].format_variants[0]];
  spec.deliverables[0].format_variants[0].quantity = { kind: "exact", unit: "image", value: count };
  const saved = await command({ action: "save", blockId: spec.id, spec }); assert.equal(saved.status, 200, await saved.clone().text());
  const confirmed = await command({ action: "confirm" }); assert.equal(confirmed.status, 200, await confirmed.clone().text());
  const plan = (await confirmed.json()).snapshot.confirmedPlan;
  assert.equal(plan.plan.targets.length, count);
  const entries = [], events = [], assets = [];
  const event = (type, payload) => { const value = makeEvent(stream, 0, `user:${owner}`, "scaling", "bulk-seed", type, { project_id: project, document_id: doc, actor_user_id: owner, ...payload }); events.push(value); return value; };
  for (const [index, target] of plan.plan.targets.entries()) {
    const bytes = png({ width: index + 2, height: index + 2 }), name = `accepted-${index}.png`, inspection = await inspectOutputAsset(bytes, name);
    assert.equal(inspection.status, "inspected");
    const id = `asset-${index}`, resultId = `result-${index}`, acceptanceId = `acceptance-${index}`;
    const keys = outputAssetObjectKeys(scope, id, inspection.sha256, inspection.extension);
    await state.env.MEDIA.put(keys.key, bytes, { httpMetadata: { contentType: inspection.mimeType }, customMetadata: { ownerId: owner, projectId: project, documentId: doc, scopeKey: scope.key, assetId: id, sha256: inspection.sha256, mimeType: inspection.mimeType, outputRequirementAsset: "1" } });
    const created = event("OutputAssetAdopted", { asset_id: id, asset: { id, name, inspection, origin: { kind: "owned_upload", rightsAttestedBy: owner, rightsAttestedAt: now }, sourceDigest: plan.sourceDigest } });
    const result = { id: resultId, targetId: target.id, planRevisionId: plan.revisionId, assetId: id, resultRevision: inspection.sha256, targetContractDigest: plan.targetContractDigests[target.id], sourceDigest: plan.sourceDigest, sha256: inspection.sha256, checksStatus: "passed", checks: ["actual_png", "exact_authored_aspect_ratio"], problems: [], createdByUserId: owner, createdAt: now };
    const bound = event("OutputResultBound", { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, asset_id: id, result });
    const accepted = event("OutputTargetAccepted", { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, acceptance_id: acceptanceId, content_sha256: inspection.sha256, result_revision: inspection.sha256, target_contract_digest: plan.targetContractDigests[target.id], source_digest: plan.sourceDigest, validation_policy: "output-owned-file-v1", reviewed_coverage: true, reviewed_rights: true, reviewer_user_id: reviewer, note: "Actual fixture file reviewed for this contract." });
    if (shared) { accepted.actor = `user:${reviewer}`; accepted.payload.actor_user_id = reviewer; }
    assets.push({ id, resultId, acceptanceId, target, inspection, created, bound, accepted, key: keys.key });
    entries.push({ targetId: target.id, assetId: id, acceptanceId, resultId, resultRevision: inspection.sha256, sha256: inspection.sha256, targetContractDigest: plan.targetContractDigests[target.id] });
  }
  let preflightEvent, authorizationEvent;
  if (grants) {
    const preflight = { id: "grant-preflight", planRevisionId: plan.revisionId, termsDigest: "retained-terms", sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest, targets: [], maximumMicrousd: count * 1000, maximumCalls: count, expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now, operationAttempts: {} };
    preflightEvent = event("OutputPlanPreflighted", { preflight_id: preflight.id, plan_revision_id: plan.revisionId, preflight });
    authorizationEvent = event("OutputExecutionAuthorized", { preflight_id: preflight.id, plan_revision_id: plan.revisionId, grant_id: "history-grant" });
  }
  await appendEvents(state.env, events);
  state.sqlite.exec("BEGIN");
  try {
    for (const value of assets) {
      const { id, resultId, acceptanceId, target, inspection, created, bound, accepted, key } = value;
      state.sqlite.prepare("INSERT INTO output_assets(scope_key,asset_id,document_id,owner_user_id,created_by_user_id,source_digest,storage_key,content_sha256,byte_length,mime_type,media_kind,created_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, id, doc, owner, owner, plan.sourceDigest, key, inspection.sha256, inspection.byteLength, inspection.mimeType, "image", created.eventId, now);
      state.sqlite.prepare("INSERT INTO output_results(scope_key,result_id,document_id,plan_revision_id,target_id,target_contract_digest,source_digest,asset_id,result_revision,content_sha256,validation_policy,checks_status,created_by_user_id,bound_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, resultId, doc, plan.revisionId, target.id, plan.targetContractDigests[target.id], plan.sourceDigest, id, inspection.sha256, inspection.sha256, "output-owned-file-v1", "passed", owner, bound.eventId, now);
      state.sqlite.prepare("INSERT INTO output_target_acceptances(scope_key,acceptance_id,target_id,target_contract_digest,result_id,result_revision,content_sha256,source_digest,validation_policy,reviewer_user_id,approval_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, acceptanceId, target.id, plan.targetContractDigests[target.id], resultId, inspection.sha256, inspection.sha256, plan.sourceDigest, "output-owned-file-v1", reviewer, accepted.eventId, now);
      state.sqlite.prepare("INSERT INTO output_plan_fulfillments(scope_key,plan_revision_id,target_id,acceptance_id,eligibility_event_id,checked_at) VALUES(?,?,?,?,?,?)").run(scope.key, plan.revisionId, target.id, acceptanceId, accepted.eventId, now);
    }
    if (grants) {
      state.sqlite.prepare("INSERT INTO output_preflights(scope_key,preflight_id,plan_revision_id,actor_user_id,terms_digest,event_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run(scope.key, "grant-preflight", plan.revisionId, owner, "retained-terms", preflightEvent.eventId, "2099-01-01T00:00:00.000Z", now);
      state.sqlite.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, "history-grant", plan.revisionId, owner, owner, "grant-preflight", authorizationEvent.eventId, count * 1000, count, "active", "2099-01-01T00:00:00.000Z", now);
      for (const [index, target] of plan.plan.targets.entries()) {
        const slot = `slot-${index}`;
        state.sqlite.prepare("INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, slot, "history-grant", plan.revisionId, target.id, plan.targetContractDigests[target.id], plan.sourceDigest, "test-provider-not-called", "fixture", "fixture-route", `job-${index}`, `cost-${index}`, `tokens-${index}`, 1000, 1, 100, index % 2 ? "uncertain" : "succeeded", now, now);
        state.sqlite.prepare("INSERT INTO output_operation_routes(scope_key,slot_id,stage_key,provider,model,maximum_calls) VALUES(?,?,?,?,?,?)").run(scope.key, slot, "initial", "test-provider-not-called", "fixture", 1);
        state.sqlite.prepare("INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,used_microusd,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, slot, `call-${index}`, `request-${index}`, `digest-${index}`, "initial", "test-provider-not-called", "fixture", 1000, index % 2 ? null : 400, index % 2 ? "uncertain" : "settled", now);
      }
    }
    state.sqlite.exec("COMMIT");
  } catch (error) { state.sqlite.exec("ROLLBACK"); throw error; }
  if (shared) await synchronizeProjectScope(state.env, { organizationId, projectAccessId, projectId: project, ownerUserId: owner });
  if (shared && actingReviewer) {
    // Simulate only the trusted hosting identity transport, not a permission
    // shortcut: the real API must resolve this member and issue their selection.
    requestHeaders = { "oai-authenticated-user-id": reviewer, "oai-authenticated-user-email": "reviewer@local.forma" };
    const selected = await handleWorkspaces(new Request(`http://localhost/api/workspaces/${organizationId}/projects/${projectAccessId}/context`, { method: "POST", headers: requestHeaders }), state.env, [organizationId, "projects", projectAccessId, "context"]);
    assert.equal(selected.status, 200, await selected.clone().text());
    requestHeaders.cookie = selected.headers.get("set-cookie").split(";")[0]; contextId = decodeURIComponent(requestHeaders.cookie.split("=").slice(1).join("="));
    scope = { ...scope, actorUserId: reviewer, contextId };
    await synchronizeProjectScope(state.env, { organizationId, projectAccessId, projectId: project, ownerUserId: owner });
  }
  counters.reset();
  return { ...state, send, snapshot, command, counters, plan, assets, entries, scope, organizationId, projectAccessId, contextId, requestHeaders, reviewer, sourceReferences, actingReviewer };
}
