import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
const model = await import("../src/model/output-model3d-contract.ts");
const { createExperienceModel3dRecipe } = await import("../worker/experience-model3d-recipe.ts");
const { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget } = await import("../worker/experience-output-recipe.ts");
const { compileOutputPlan } = await import("../src/model/output-plan.ts");
const { inspectOutputRequirement } = await import("../src/model/output-requirements.ts");
const { validateModel3dRequest, serializeRodinInput, DEFAULT_MODEL3D_SETTINGS } = await import("../src/model/model3d.ts");
const source = { draftId: "experience-draft-" + "a".repeat(64), draftHash: "sha256:" + "b".repeat(64),
  releaseHash: "sha256:" + "c".repeat(64), requestHash: "sha256:" + "d".repeat(64), sourceBindingHash: "sha256:" + "e".repeat(64) };
const selected = { version: 1, kind: "image", sourceProjectId: "original-project", sourceDocumentId: "original-document",
  sourceBlockId: "original-block", referenceId: "original-reference", sha256: "1".repeat(64), permissionAttestation: "i-own-or-have-permission" };
const reference = { selection: selected, sourceDigest: "2".repeat(64), copiedBlockId: "new-document-copy" };
const input = () => structuredClone({ ...source, reference });
const specFor = contract => createExperienceModel3dRecipe({ output: "model3d", requirementId: "requirement", deliverableId: "deliverable", contract });
const options = { document_id: "document", source_revision: "source", requirement_revision: "requirements" };

test("closed static GLB intent retains exact original image and distinct copy without minting authority", () => {
  const authored = input(), contract = model.createModel3dOutputContract(authored);
  assert(contract); assert.deepEqual(contract.source, source); assert.deepEqual(contract.reference, reference);
  assert.equal(contract.requestedSubjectCount, 1); assert.equal(contract.primaryGlbCount, 1);
  assert.equal(contract.staticPolicy, "model3d-static-rooted-assembly-v1");
  assert(!Object.hasOwn(contract, "qualified")); assert(!Object.hasOwn(contract, "grantId")); assert(!Object.hasOwn(contract, "semanticObjectCount"));
  authored.reference.selection.sha256 = "f".repeat(64); assert.equal(contract.reference.selection.sha256, selected.sha256);
  assert(Object.isFrozen(contract)); assert(Object.isFrozen(contract.source)); assert(Object.isFrozen(contract.reference.selection));
  assert.deepEqual(model.parseModel3dOutputContract(JSON.parse(JSON.stringify(contract))), contract);
});
test("text-only and saved-model-view use the existing distinct Rodin model choices", () => {
  const text = model.createModel3dOutputContract({ ...source, reference: null });
  assert(text); assert.equal(model.model3dOutputModel(text), "fal-ai/hyper3d/rodin/v2.5/text-to-3d");
  const saved = input(); saved.reference.selection.kind = "saved-model-view";
  const contract = model.createModel3dOutputContract(saved);
  assert(contract); assert.equal(model.model3dOutputModel(contract), "fal-ai/hyper3d/rodin/v2.5");
  assert.equal(contract.reference.selection.kind, "saved-model-view", "actual model hash/camera custody still belongs to the server");
});
test("fixed settings reuse valid existing GLB defaults and preserve literal prompt bytes", () => {
  assert.deepEqual(model.MODEL3D_MINI_APP_SETTINGS, DEFAULT_MODEL3D_SETTINGS);
  const prompt = "A single lamp 日本語  <literal>\nMatte clay";
  for (const count of [0, 1]) {
    const checked = validateModel3dRequest({ prompt, settings: model.MODEL3D_MINI_APP_SETTINGS, referenceCount: count });
    assert.equal(checked.valid, true);
    const wire = serializeRodinInput(prompt, model.MODEL3D_MINI_APP_SETTINGS, count ? ["https://fal.media/declared-placeholder-not-fetched"] : []);
    assert.equal(wire.input.prompt, prompt); assert.equal(wire.input.geometry_file_format, "glb");
    assert.equal(wire.settings.addons.high_pack, false); assert.equal(wire.settings.preview_render, false);
  }
});
test("missing hashes, invented owner/URL/receipt, extra references and alias-copy identities refuse", () => {
  const variants = [
    v => { delete v.reference.selection.sha256; }, v => { v.reference.selection.sha256 = ""; },
    v => { v.reference.selection.ownerId = "owner"; }, v => { v.reference.selection.url = "/api/media/arbitrary"; },
    v => { v.reference.selection.permissionAttestation = true; }, v => { v.reference.sourceDigest = null; },
    v => { v.reference.copiedBlockId = v.reference.selection.sourceBlockId; }, v => { v.reference = [v.reference, v.reference]; },
    v => { v.grantId = "invented"; }, v => { delete v.reference; }, v => { v.reference.selection.kind = "uploaded-mesh"; },
  ];
  for (const change of variants) { const v = input(); change(v); assert.equal(model.createModel3dOutputContract(v), null); }
});
test("getters, hidden/symbol fields and changed output policy do not become a contract", () => {
  let calls = 0;
  const v = input(); Object.defineProperty(v.reference.selection, "sha256", { enumerable: true, get() { calls++; throw Error("getter"); } });
  assert.equal(model.createModel3dOutputContract(v), null); assert.equal(calls, 0);
  const extra = input(); extra[Symbol.iterator] = () => { calls++; }; assert.equal(model.createModel3dOutputContract(extra), null);
  const hidden = input(); Object.defineProperty(hidden, "hidden", { value: true }); assert.equal(model.createModel3dOutputContract(hidden), null);
  const contract = model.createModel3dOutputContract(input());
  for (const [key, value] of [["primaryGlbCount", 2], ["fileFormat", "obj"], ["staticPolicy", "provider-says-static"], ["maximumReferenceImages", 5]]) {
    assert.equal(model.parseModel3dOutputContract({ ...contract, [key]: value }), null);
  }
  assert.equal(calls, 0);
});
test("actual requirement compiler yields exactly one original contract-bound GLB target", () => {
  const contract = model.createModel3dOutputContract(input()), recipe = specFor(contract);
  assert.deepEqual(createExperienceOutputRecipe({ output: "model3d", requirementId: "requirement", deliverableId: "deliverable", contract }), recipe);
  assert.equal(inspectOutputRequirement(recipe.spec).status, "valid");
  const plan = compileOutputPlan([recipe.spec], options);
  assert.deepEqual(plan.issues, []); assert.equal(plan.targets.length, 1); assert.deepEqual(plan.targets[0].model3d_contract, contract);
  assert.equal(plan.targets[0].media_kind, "model3d"); assert.equal(plan.targets[0].count_policy, null); assert.equal(plan.targets[0].aspect_ratio, null);
  assert(matchExperienceOutputRecipeTarget(recipe, plan, { documentId: "document", sourceRevision: "source", requirementRevision: "requirements" }));
  const changed = structuredClone(plan); changed.targets[0].model3d_contract.reference.selection.sha256 = "f".repeat(64);
  assert.equal(matchExperienceOutputRecipeTarget(recipe, changed, { documentId: "document", sourceRevision: "source", requirementRevision: "requirements" }), null);
});
test("extra formats, quantity, optionality, content count and conflicting media contracts refuse", () => {
  const spec = specFor(model.createModel3dOutputContract(input())).spec;
  const variants = [v => { v.deliverables[0].required = false; }, v => { v.deliverables[0].quantity.value = 2; },
    v => { v.deliverables[0].format_variants = []; }, v => { v.deliverables[0].content_quantity = { kind: "exact", unit: "second", value: 1 }; },
    v => { v.deliverables[0].audio_contract = {}; }, v => { v.deliverables[0].source_scope = { kind: "blocks", block_ids: ["other"] }; }];
  for (const change of variants) { const value = structuredClone(spec); change(value); assert.equal(inspectOutputRequirement(value).status, "invalid"); }
});
test("legacy Model3D plans omit the new field and retain the pinned pre-integration compiler output", () => {
  const spec = structuredClone(specFor(model.createModel3dOutputContract({ ...source, reference: null })).spec);
  delete spec.deliverables[0].model3d_contract; delete spec.deliverables[0].value_origins.model3d_contract;
  const actual = compileOutputPlan([spec], options), json = JSON.stringify(actual);
  // Captured from the actual unchanged compiler before this field was added;
  // unlike comparing two imports of current source, this survives integration.
  assert.equal(Buffer.byteLength(json), 1281);
  assert.equal(createHash("sha256").update(json).digest("hex"), "2ab4523dfe513ea523d4b9d766f8d341015a8031afb5078cfee8d738be0c8a69");
  assert(!Object.hasOwn(actual.targets[0], "model3d_contract"));
});
