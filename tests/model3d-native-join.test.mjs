import test from "node:test";
import assert from "node:assert/strict";
import { fixture, glb, sha } from "./helpers/model3d-native-execution-fixture.mjs";
import { readModel3dExecutionOffer } from "../src/model/output-model3d-offer.ts";
import { qualifyOutputModel3dCompletion } from "../worker/output-model3d-execution.ts";
import { OUTPUT_MODEL3D_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { outputTerms } from "../src/experiences/output-terms.ts";
import { decodeExperienceBinding, ExperienceOutputBindingClient } from "../src/experiences/output-binding-client.ts";
import { captureExperienceModel3dEvidence, captureExperienceModel3dTarget, verifyExperienceModel3dRead } from "../src/experiences/model3d-native-result.ts";
import { captureExperienceNativeResult } from "../src/experiences/native-result-association.ts";
import { validateNativeRetainedOutputDto } from "../src/model/native-retained-output.ts";
import { experienceHostRoute, parseExperienceHostRoute } from "../src/experiences/host-route.ts";
const clone = value => JSON.parse(JSON.stringify(value));
const now = Date.parse("2026-09-13T00:00:00.000Z");
function quote(f) {
  const { preview: p, payload } = f;
  const target = { targetId: "target-model", available: true, provider: "fal", model: p.model, route: "model3d-mini-app-static-glb-v1",
    reasonCode: "output_model3d_ready_for_separate_approval", reason: "Original static assembly",
    transferCode: "output_transfer_model3d_not_yet_authorized", transferDescription: "Only the exact listed reference after approval and Create",
    maximumMicrousd: p.maximumMicrousd, maximumCalls: 1, maximumTokens: 1,
    settings: { kind: "render_document", payload, calls: [{ stage: "model3d:initial", provider: "fal", model: p.model, maximumMicrousd: p.maximumMicrousd }],
      executionPolicy: OUTPUT_MODEL3D_EXECUTION_POLICY, preparationOnly: false, executionAvailable: true, explicitCostAndTransferApprovalRequired: true,
      costPreview: p, description: payload.model3dPreparation, original: { requestId: p.requestId, expiresAt: p.expiresAt, draftId: p.draftId,
        actorUserId: p.actorUserId, projectId: p.projectId, documentId: p.documentId, sourceDigest: p.sourceDigest, requirementsDigest: p.requirementsDigest } } };
  const preflight = { id: "preflight", planRevisionId: "plan", termsDigest: "a".repeat(64), sourceDigest: p.sourceDigest,
    requirementsDigest: p.requirementsDigest, createdAt: "2026-09-12T00:00:00.000Z", expiresAt: p.expiresAt,
    maximumMicrousd: p.maximumMicrousd, maximumCalls: 1, targets: [target], operationAttempts: { "target-model": { ordinal: 0, previousSlotId: null } } };
  const identity = { draftId: p.draftId, draftHash: f.offer.contract.source.draftHash, releaseHash: f.offer.contract.source.releaseHash,
    documentId: p.documentId, projectId: p.projectId, output: "model3d", actorUserId: p.actorUserId };
  const state = { version: 1, ...identity, sourceSurface: "outputs", model3dCostPreview: p, status: "review", disposition: "prepared",
    current: { custody: "verified", source: "verified", sourceDigest: p.sourceDigest, requirementsDigest: p.requirementsDigest }, stage: "preflight",
    plan: { revisionId: "plan", targetId: target.targetId, targetContractDigest: "e".repeat(64), sourceDigest: p.sourceDigest, requirementsDigest: p.requirementsDigest },
    preflight, original: null, grant: null, permitted: { prepare: false, authorize: true, run: false, resumeRun: false } };
  return { target, preflight, identity, state };
}
test("closed original quote displays one Rodin request and exact reference without inventing permission", async () => {
  for (const kind of [null, "image", "saved-model-view"]) {
    const f = await fixture(kind), q = quote(f);
    assert(readModel3dExecutionOffer(q.target));
    const options = { now, output: "model3d", targetId: q.target.targetId, expectedModel3dContract: f.offer.contract, model3dCostPreview: f.preview };
    const terms = outputTerms(q.preflight, options);
    assert.equal(terms.available, true); assert.equal(terms.grantAvailable, false);
    assert.equal(terms.summary.maximumGenerationCalls, 1); assert.match(terms.summary.output, /static GLB/);
    assert.equal(terms.summary.safety, null); assert.match(terms.summary.source, /original mesh bytes are not transferred/);
    for (const mutate of [v => { v.targets[0].settings.payload.model3dPrompt += "changed"; }, v => { v.targets[0].maximumCalls = 2; },
      v => { v.targets[0].settings.calls[0].stage = "model3d:retry"; }, v => { v.targets[0].settings.executionPolicy.maximumMilliseconds++; },
      v => { v.sourceDigest = "1".repeat(64); }, v => { v.targets[0].settings.original.requestId = "model3d-" + "1".repeat(64); }]) {
      const bad = clone(q.preflight); mutate(bad); assert.equal(outputTerms(bad, options).available, false);
    }
    assert.equal(outputTerms(q.preflight, { ...options, now: Date.parse(f.preview.expiresAt) }).available, false);
    assert(decodeExperienceBinding(q.state, q.identity));
    const mismatch = clone(q.state); mismatch.model3dCostPreview.referenceBytes++;
    assert.equal(decodeExperienceBinding(mismatch, q.identity), null);
  }
});
test("real transport client sends no automatic POST and requires both exact explicit 3D approvals", async () => {
  const f = await fixture("image"), q = quote(f), calls = [], origin = "https://forma.test"; let active = true;
  const client = new ExperienceOutputBindingClient(q.identity, { origin, current: () => active, request: async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    // Synthetic response port only. No real admission, browser, network or provider.
    const response = new Response(JSON.stringify(q.state), { headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", { value: origin + path }); return response;
  } });
  const shown = await client.read(); assert.equal(calls.length, 1); assert.equal(calls[0].method, "GET");
  const approval = { ...f.preview, confirmed: true, providerTransferConfirmed: true };
  for (const bad of [undefined, f.preview, { ...approval, confirmed: false }, { ...approval, referenceSha256: "0".repeat(64) }]) {
    await client.command("authorize", shown, undefined, undefined, bad); assert.equal(calls.length, 1);
  }
  await client.command("authorize", shown, undefined, undefined, approval); assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.model3dCostConsent, approval); assert.equal(calls[1].path.endsWith("/authorize"), true);
  assert.equal(Object.hasOwn(calls[1].body, "audioCostConsent"), false);
  active = false; await client.command("authorize", client.state, undefined, undefined, approval); assert.equal(calls.length, 2);
  client.dispose(); assert.equal(client.pending, false);
});
async function completed(kind = "image") {
  const f = await fixture(kind), bytes = glb(), p = f.preview;
  const call = { clientRequestId: "forma-model3d-original", provider: "fal", operation: "model3d", model: p.model,
    status: "completed", providerRequestId: "provider-original", costMicrousd: p.maximumMicrousd, totalTokens: 0 };
  const receipt = await qualifyOutputModel3dCompletion({ offer: f.offer, prepared: f.receipt, calls: [call], providerRequestId: call.providerRequestId,
    primary: { bytes, sha256: sha(bytes), mimeType: "model/gltf-binary", role: "mesh", format: "glb" } });
  const files = [{ url: "/api/media/" + encodeURIComponent("owner/model.glb"), mimeType: "model/gltf-binary", fileName: "model.glb",
    fileSize: bytes.byteLength, format: "glb", role: "mesh", sha256: sha(bytes), previewSupported: true }];
  const execution = { scopeKey: "personal:owner:project", grantId: "grant", slotId: "slot", planRevisionId: "plan",
    targetId: "target-model", targetContractDigest: "e".repeat(64), sourceDigest: p.sourceDigest };
  const evidence = { schemaVersion: 1, jobId: p.requestId, actorUserId: p.actorUserId, documentId: p.documentId, projectId: p.projectId,
    artifactId: "artifact", execution, contract: f.offer.contract, costPreview: p, receipt, files };
  const input = { schema_version: 1, artifact_kind: "model3d", artifact_id: "artifact", document_id: p.documentId, project_id: p.projectId,
    output_model3d: evidence, model3d_preparation: f.payload.model3dPreparation,
    request: { source_surface: "outputs", model3d_prompt: f.payload.model3dPrompt, model3d_prompt_source: "document",
      model3d_settings: f.payload.model3dSettings, model3d_adaptation: f.payload.model3dAdaptation, model3d_reference_block_ids: f.payload.model3dReferenceBlockIds },
    render: { ...f.receipt, providerJobId: call.providerRequestId } };
  const selection = { documentId: p.documentId, artifactId: "artifact", revision: 0, contentSha256: "1".repeat(64) };
  const target = { output: "model3d", selection }, retained = validateNativeRetainedOutputDto({ schemaVersion: 1, kind: "native-retained-output",
    output: "model3d", selection, title: "Kettle <not markup>", expiresAt: p.expiresAt, content: { files, availability: "mesh-reference" } }, target, now);
  assert(retained);
  const expected = { contract: f.offer.contract, costPreview: p, jobId: p.requestId, actorUserId: p.actorUserId, documentId: p.documentId,
    projectId: p.projectId, artifactId: "artifact", ...execution, usedCalls: 1, usedMicrousd: p.maximumMicrousd };
  return { f, evidence, input, retained, expected };
}
test("explicit text-only original recovery decodes without authorizing a replacement or reference transfer", async () => {
  for (const kind of [null, "image", "saved-model-view"]) {
    const f = await fixture(kind), q = quote(f), p = f.preview, state = clone(q.state);
    const command = key => ({ key, eventId: key + "-event" });
    state.status = "unavailable"; state.disposition = "original_run_recorded";
    state.permitted = { prepare: false, authorize: false, run: false, resumeRun: false, recoverResult: true };
    state.original = { authorization: command("authorize"), run: command("run"), grantId: "grant", grantStatus: "active",
      slotId: "slot", slotStatus: "uncertain", jobId: p.requestId, jobStatus: "failed", correlationId: "correlation", jobExpiresAt: p.expiresAt,
      targetId: q.target.targetId, targetContractDigest: state.plan.targetContractDigest, routeDigest: "route",
      planRevisionId: state.plan.revisionId, sourceDigest: p.sourceDigest, requirementsDigest: p.requirementsDigest, expiresAt: p.expiresAt };
    const counters = { maximumMicrousd: p.maximumMicrousd, maximumCalls: 1, usedMicrousd: 0, exposedMicrousd: p.maximumMicrousd, usedCalls: 0, pendingCalls: 1 };
    state.grant = { id: "grant", status: "active", planRevisionId: state.plan.revisionId, actorUserId: p.actorUserId, payerUserId: p.actorUserId,
      expiresAt: p.expiresAt, ...counters, disclosure: clone(q.preflight), operations: [{ id: "slot", targetId: q.target.targetId,
        jobId: p.requestId, status: "uncertain", ...counters }] };
    assert.equal(Boolean(decodeExperienceBinding(state, q.identity)), kind === null);
    if (kind !== null) continue;
    for (const mutate of [v => { v.permitted.run = true; }, v => { v.original.jobStatus = "canceled"; },
      v => { v.preflight.targets[0].model = "foreign"; }, v => { v.original.jobId = "foreign"; },
      v => { v.current.source = "changed"; }, v => { v.grant.status = v.original.grantStatus = "revoked"; }]) {
      const bad = clone(state); mutate(bad); assert.equal(decodeExperienceBinding(bad, q.identity), null);
    }
    const origin = "https://forma.test", requests = [];
    const client = new ExperienceOutputBindingClient(q.identity, { origin, current: () => true, request: async (path, init) => {
      requests.push({ path, method: init.method, body: init.body && JSON.parse(init.body) });
      const response = Response.json(state); Object.defineProperty(response, "url", { value: origin + path }); return response;
    } });
    const shown = await client.read(); assert.equal(requests.length, 1);
    await client.command("recoverResult", shown);
    assert.equal(requests.length, 2); assert.equal(requests[1].path.endsWith("/recover-result"), true);
    assert.deepEqual(requests[1].body, { draftHash: q.identity.draftHash, grantId: "grant", jobId: p.requestId, explicitRecovery: true });
    client.dispose();
  }
});
test("retained native reader joins original private receipt, current selection and exact GLB; tampering refuses", async () => {
  for (const kind of [null, "image", "saved-model-view"]) {
    const c = await completed(kind);
    assert(captureExperienceModel3dEvidence({ output_model3d: c.evidence }));
    assert.equal(await verifyExperienceModel3dRead(JSON.stringify(c.input), c.evidence, c.retained, c.expected), true);
    for (const change of [v => { v.render.providerJobId = "other"; }, v => { v.render.requestDigest = "0".repeat(64); },
      v => { v.request.model3d_prompt += "changed"; }, v => { v.output_model3d.actorUserId = "other"; },
      v => { v.model3d_preparation.references.push({}); }, v => { v.output_model3d.receipt.qualification.status = "unqualified"; }]) {
      const bad = clone(c.input); change(bad); assert.equal(await verifyExperienceModel3dRead(JSON.stringify(bad), c.evidence, c.retained, c.expected), false);
    }
    for (const change of [{ usedCalls: 0 }, { usedMicrousd: 0 }, { slotId: "other" }, { projectId: "other" }])
      assert.equal(await verifyExperienceModel3dRead(JSON.stringify(c.input), c.evidence, c.retained, { ...c.expected, ...change }), false);
    const edited = clone(c.retained); edited.selection.revision = 1;
    assert.equal(await verifyExperienceModel3dRead(JSON.stringify(c.input), c.evidence, edited, c.expected), false);
  }
});
test("completion association is identity only, refuses stale edits and separates one requested GLB from zero prose items", async () => {
  const c = await completed(), p = c.f.preview, settings = { output_model3d: c.evidence, model3d_files: c.evidence.files };
  const payload = { document_id: p.documentId, project_id: p.projectId, source_surface: "outputs", artifact_id: "artifact", artifact_kind: "model3d",
    item_count: 0, items: [], requested_by_user_id: p.actorUserId, content_ref: "content", content_expires_at: p.expiresAt, input_ref: "input",
    input_expires_at: p.expiresAt, provider: "fal", model_id: p.model, provider_job_id: "provider-original", planner_model_id: null, planner_response_id: null,
    media_url: c.evidence.files[0].url, media_type: "model/gltf-binary", presentation: null, used_reference_pixels: true, reference_inputs: c.f.receipt.referenceInputs, settings };
  const identity = { output: "model3d", documentId: p.documentId, projectId: p.projectId, ownerUserId: p.actorUserId,
    jobId: p.requestId, correlationId: "correlation", expiresAt: p.expiresAt };
  const job = { jobId: p.requestId, documentId: p.documentId, sourceSurface: "outputs", kind: "render_document", status: "completed",
    result: { appendedEventIds: ["completed"], artifactId: "artifact", artifactKind: "model3d" } };
  const current = { documentId: p.documentId, projectId: p.projectId, documents: [{ id: p.documentId, projectId: p.projectId, removed: false }],
    events: [{ eventId: "completed", streamId: "creative:owner", actor: "worker:renderer", correlationId: "correlation", type: "DocumentRenderCompleted", payload }],
    outputs: [], artifacts: [{ id: "artifact", documentId: p.documentId, kind: "model3d", itemCount: 0, sourceEventId: "completed",
      sourceSurface: "outputs", contentRef: "content", inputRef: "input", mediaUrl: payload.media_url, settings }] };
  const candidate = captureExperienceNativeResult(identity, job, current, now); assert(candidate); assert.equal(candidate.output, "model3d");
  for (const change of [v => { v.events[0].payload.item_count = 1; }, v => { v.events[0].payload.provider_job_id = "other"; },
    v => { v.artifacts[0].inputRef = "other"; }, v => { v.events[0].correlationId = "other"; },
    v => { v.events.push({ type: "DocumentArtifactEdited", payload: { artifact_id: "artifact" } }); },
    v => { v.events[0].payload.settings.output_model3d.receipt.qualification.status = "unqualified"; }]) {
    const bad = clone(current); change(bad); assert.equal(captureExperienceNativeResult(identity, job, bad, now), null);
  }
  const route = experienceHostRoute("/document/document?progress-report", "model3d", p.draftId);
  assert.equal(parseExperienceHostRoute(route).output, "model3d"); assert.equal(parseExperienceHostRoute(route + "#other"), null);
  assert.equal(captureExperienceModel3dTarget({ media_kind: "model3d", selected: true, required: true, model3d_contract: c.f.offer.contract,
    quantity: { kind: "exact", unit: "model", value: 1 }, source_scope: { kind: "document" }, coverage: { kind: "document_context" }, blocking_issues: [] }, c.f.offer.contract), true);
});
