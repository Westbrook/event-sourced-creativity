import { fixture, glb, sha } from "./helpers/model3d-native-execution-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readOutputModel3dPayload, verifyModel3dPreparedReceipt, assertModel3dPreparedAttempt, qualifyOutputModel3dCompletion } from "../worker/output-model3d-execution.ts";
import { registeredExperience, initialValues, buildExperiencePlan, experienceDocumentRoute } from "../src/experiences/intake.ts";
import { experienceSourceMatches } from "../src/experiences/host-source.ts";
import { referenceContinuationSource } from "./helpers/model3d-terminal-source.mjs";
import { readModel3dReferencePlan } from "../src/experiences/model3d-reference-plan.ts";
test("exact text/image/saved-view preparation matches existing Rodin receipt and original attempt", async () => {
  for (const kind of [null, "image", "saved-model-view"]) {
    const { payload, receipt, offer } = await fixture(kind); assert(offer); assert(Object.isFrozen(offer));
    assert.deepEqual(JSON.parse(JSON.stringify(await verifyModel3dPreparedReceipt(offer, receipt))), JSON.parse(JSON.stringify(receipt)));
    assert.notEqual(receipt.requestDigest, offer.preview.preparationDigest);
    const attempt = { model: receipt.model, maximumInputTokens: 0, maximumOutputTokens: 0, clientRequestId: "forma-model3d-original", logicalCallKey: "model3d:initial", requestDigest: receipt.requestDigest };
    assert.doesNotThrow(() => assertModel3dPreparedAttempt(offer, receipt, attempt));
    for (const change of [{ model: "other" }, { requestDigest: "1".repeat(64) }, { maximumInputTokens: 1 }, { logicalCallKey: "model3d:retry" }, { clientRequestId: "new-arbitrary-job" }])
      assert.throws(() => assertModel3dPreparedAttempt(offer, receipt, { ...attempt, ...change }));
    for (const change of [v => { v.model3dPrompt += " changed"; }, v => { v.model3dPreparation.parameters.prompt = "changed"; }, v => { v.model3dCostPreview.preparationDigest = "sha256:" + "0".repeat(64); }, v => { v.itemCount = 2; }]) {
      const changed = structuredClone(payload); change(changed); assert.equal(await readOutputModel3dPayload(changed), null);
    }
  }
});
test("server reference continuation keeps the exact captured principal and readonly source guards without invented HTTP auth", async () => {
  const f = await fixture("image"), selection = f.offer.contract.reference.selection, calls = [];
  const request = new Request("https://output-execution.invalid"), env = {}, auth = { user: { userId: "owner" }, principal: { userId: "owner" }, impersonation: null };
  auth.principal = auth.user;
  const properties = { reference_id: selection.referenceId, source_content_hash: selection.sha256, media_url: "/api/media/owned/image.png",
    media_type: "image/png", pixel_reference_mode: "image", rights: "owned" };
  const trusted = { projection: { libraryBlocks: [{ id: selection.sourceBlockId, properties }] }, context: {}, ownerHead: 91,
    sourceAssertions: [{ sql: "source-exact=?", bindings: ["source"] }] };
  let denied = false;
  const prepare = referenceContinuationSource({
    async continueOutputTrustedContext(...args) { calls.push(args); return denied ? new Response(null, { status: 403 }) : trusted; },
    async inspectModel3dReferenceCustody(t, a, s) { assert.equal(t, trusted); assert.equal(a, auth); assert.equal(s, selection); return { sourceDigest: "f".repeat(64) }; },
    readModel3dReferencePlan,
    projectIntakeAuthority(e, a, source) { assert.equal(e, env); assert.equal(a, auth); assert.deepEqual(source, { projectId: selection.sourceProjectId, documentId: selection.sourceDocumentId }); return { sql: "authority=?", bindings: ["same"] }; },
    outputActiveSourceDeadlineAssertions(context) { assert.equal(context, trusted.context); return [{ sql: "deadline>?", bindings: ["now"] }]; },
  });
  const selected = await prepare(request, env, auth, selection);
  assert.deepEqual(calls[0], [request, env, selection.sourceDocumentId, "read", auth]);
  assert.equal(request.headers.has("authorization"), false); assert.equal(selected.head, 91);
  assert.deepEqual(selected.guard.bindings, ["same", "source", "now"]); assert.deepEqual(selected.reference.selection, selection);
  denied = true; await assert.rejects(prepare(request, env, auth, selection), error => error.status === 403);
  assert.equal(calls.length, 2);
});
test("changed reference bytes/settings, custom iterators and getters cannot pass the before-upload comparison", async () => {
  const { receipt, offer, payload } = await fixture("image");
  for (const change of [v => { v.submittedPrompt += " changed"; }, v => { v.settings.seed = 1; }, v => { v.referenceInputs[0].sha256 = "1".repeat(64); }, v => { v.referenceInputs[0].referenceId = "replacement"; }, v => { v.referenceInputs[0].index = 1; }, v => { v.referenceInputs.push(v.referenceInputs[0]); }]) {
    const altered = structuredClone(receipt); change(altered); await assert.rejects(verifyModel3dPreparedReceipt(offer, altered));
  }
  let invoked = 0;
  const altered = structuredClone(receipt); Object.defineProperty(altered, "submittedPrompt", { enumerable: true, get() { invoked++; return receipt.submittedPrompt; } });
  await assert.rejects(verifyModel3dPreparedReceipt(offer, altered)); assert.equal(invoked, 0);
  const bad = structuredClone(payload); bad.model3dPreparation.references[Symbol.iterator] = function* () { invoked++; yield bad.model3dPreparation.references[0]; };
  assert.equal(await readOutputModel3dPayload(bad), null); assert.equal(invoked, 0);
});
test("original paid completion binds exact static bytes; unqualified output preserves paid identity without object/approval claims", async () => {
  const { offer, receipt, preview } = await fixture("image");
  const call = { clientRequestId: "forma-model3d-original", provider: "fal", operation: "model3d", model: receipt.model, status: "completed", providerRequestId: "provider-original", costMicrousd: preview.maximumMicrousd, totalTokens: 0 };
  const input = bytes => ({ offer, prepared: receipt, calls: [call], providerRequestId: call.providerRequestId, primary: { bytes, mimeType: "model/gltf-binary", sha256: sha(bytes), role: "mesh", format: "glb" } });
  const bytes = glb(), original = input(bytes), promised = qualifyOutputModel3dCompletion(original); bytes.fill(0);
  const result = await promised;
  assert.equal(result.qualification.status, "qualified"); assert.equal(result.primarySha256, original.primary.sha256); assert.equal(result.requirementFulfilled, false); assert.equal(result.semanticObjectCount, "unverified");
  const invalid = await qualifyOutputModel3dCompletion(input(new Uint8Array([1,2,3])));
  assert.equal(invalid.qualification.status, "unqualified"); assert.equal(invalid.providerRequestId, call.providerRequestId); assert.equal(invalid.requirementFulfilled, false);
  for (const change of [v => { v.calls = []; }, v => { v.calls.push(call); }, v => { v.providerRequestId = "replacement"; }, v => { v.calls[0] = { ...call, status: "accepted" }; }, v => { v.calls[0] = { ...call, costMicrousd: 0 }; }, v => { v.primary.sha256 = "0".repeat(64); }]) {
    const v = input(glb()); change(v); await assert.rejects(qualifyOutputModel3dCompletion(v));
  }
});
test("real registered Model3D intake and exact source matcher accepts original text/reference and refuses all tested source tampering", async () => {
  const release = await registeredExperience("model3d"); assert(release);
  for (const kind of [null, "image", "saved-model-view"]) {
    const f = await fixture(kind), reference = f.offer.contract.reference;
    const values = initialValues(release); values.subject = { value: "A ceramic kettle · إبريق", provenance: "authored" };
    const request = { intentId: "11111111-2222-4333-8444-555555555555", experienceId: "model3d", releaseHash: release.releaseHash, values, ...(reference ? { reference: reference.selection } : {}) };
    const properties = { reference_id: "original-reference", source_content_hash: reference?.selection.sha256, media_url: "/api/media/owned/image.png", media_type: "image/png", pixel_reference_mode: "image", rights: "owned" };
    if (kind === "saved-model-view") Object.assign(properties, { model_reference_id: "original-model", model_content_hash: "3".repeat(64), model_url: "/api/media/owned/model.glb",
      model_view: { version: 1, position: [3.6,2.7,4.5], target: [0,0,0], fov: 35, background: "#ffffff" } });
    const plan = await buildExperiencePlan("owner", request, release, reference ? { version: 1, selection: reference.selection, sourceDigest: reference.sourceDigest, properties } : undefined);
    const appended = plan.events.map((event, index) => ({ ...event, eventId: `original-${index}`, sequence: index + 1 }));
    const receipt = { status: "complete", generation: "unavailable", projectId: plan.projectId, documentId: plan.documentId, draftId: plan.draftId, draftHash: plan.draftHash, documentRoute: experienceDocumentRoute(plan), head: appended.length, appended, rejected: [] };
    const current = { documentId: plan.documentId, projectId: plan.projectId, documents: [{ id: plan.documentId, projectId: plan.projectId, title: plan.title, removed: false }],
      blocks: appended.filter(event => event.type === "BlockCreated").map(event => ({ id: event.payload.block_id, documentId: plan.documentId, projectId: plan.projectId, scope: "document", canvasId: "", removed: false, locked: false, type: event.payload.type, handle: event.payload.handle, position: event.payload.position, properties: event.payload.properties, sourceEvents: [event.eventId] })),
      relations: [], events: appended.map(event => ({ ...event, streamId: plan.streamId, actor: "user" })) };
    assert.equal(experienceSourceMatches(plan, receipt, current), true);
    for (const change of [v => { v.projectId = "foreign"; }, v => { v.blocks[0].properties.text = "changed"; }, v => { v.blocks[0].sourceEvents = ["replacement"]; }, v => { v.blocks[0].locked = true; }, v => { v.blocks.push(v.blocks[0]); }, v => { v.events[0].actor = "other"; }, v => { v.relations.push({ documentId: plan.documentId }); }, ...(reference ? [v => { v.blocks.at(-1).properties.source_content_hash = "0".repeat(64); }] : [])]) {
      const changed = structuredClone(current); change(changed); assert.equal(experienceSourceMatches(plan, receipt, changed), false);
    }
  }
});
