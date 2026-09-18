import assert from "node:assert/strict";
import test from "node:test";
import { createVideoOutputContract, parseVideoOutputContract } from "../src/model/output-video-contract.ts";
import { inspectOutputRequirement } from "../src/model/output-requirements.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget } from "../worker/experience-output-recipe.ts";
import { inspectOutputTargetFile, outputTargetContractDigest } from "../worker/output-requirements-api.ts";
import { preflightOutputNativeTarget, outputDocumentExecutionBridge } from "../worker/output-document-execution.ts";
import { outputNativeTargetRefusal } from "../worker/output-image-slides-preflight.ts";
import { resolveOutputNativeResult } from "../worker/output-native-result.ts";

const source = { draftId: "experience-draft-" + "a".repeat(64), draftHash: "sha256:" + "b".repeat(64),
  releaseHash: "sha256:" + "c".repeat(64), requestHash: "sha256:" + "d".repeat(64), sourceBindingHash: "sha256:" + "e".repeat(64) };
const reference = { version: 1, sourceProjectId: "original-project", sourceDocumentId: "original-document", sourceBlockId: "original-block",
  referenceId: "original-reference", sha256: "f".repeat(64), permissionAttestation: "i-own-or-have-permission" };
const options = { document_id: "destination-document", source_revision: "source-1", requirement_revision: "requirements-1" };
const scope = { documentId: options.document_id, sourceRevision: options.source_revision, requirementRevision: options.requirement_revision };
const contract = (frameSize = "1280x720") => createVideoOutputContract({ source, reference, frameSize });
const recipe = (frameSize = "1280x720") => createExperienceOutputRecipe({ output: "video", requirementId: "video-r", deliverableId: "video-d", contract: contract(frameSize) });
const compiled = () => compileOutputPlan([recipe().spec], options);

test("closed Video contract preserves explicit frame and original still identity without minting source authority", () => {
  for (const frame of ["1280x720", "720x1280"]) {
    const value = contract(frame); assert.ok(value); assert.equal(value.frameSize, frame);
    assert.equal(value.seconds, 4); assert.equal(value.resolution, "480p"); assert.equal(value.audioMode, "silent");
    assert.equal(value.referenceCount, 1); assert.equal(value.productionMode, "manual");
    assert.deepEqual(value.reference, reference); assert.deepEqual(parseVideoOutputContract(value), value);
    assert.ok(Object.isFrozen(value) && Object.isFrozen(value.source) && Object.isFrozen(value.reference));
    for (const key of ["grant", "approved", "owned", "expiresAt", "maximumMicrousd"]) assert.equal(Object.hasOwn(value, key), false);
  }
  for (const frameSize of [undefined, "480p", "auto", "1024x1024"]) assert.equal(createVideoOutputContract({ source, reference, frameSize }), null);
  assert.equal(createVideoOutputContract({ source: { ...source, sourceBindingHash: "unbound" }, reference, frameSize: "1280x720" }), null);
  assert.equal(createVideoOutputContract({ source, reference: { ...reference, url: "https://other.invalid" }, frameSize: "1280x720" }), null);
});

test("contract parser refuses altered policy, missing fields, extra authority and accessors", () => {
  for (const patch of [{ seconds: 5 }, { resolution: "720p" }, { audioMode: "original_ambient" }, { referenceCount: 2 },
    { productionMode: "managed" }, { clipCount: 2 }, { id: "future-policy" }, { approved: true }, { reference: null }])
    assert.equal(parseVideoOutputContract({ ...contract(), ...patch }), null);
  const missing = { ...contract() }; delete missing.source; assert.equal(parseVideoOutputContract(missing), null);
  let reads = 0; const getter = { ...contract() };
  Object.defineProperty(getter, "seconds", { enumerable: true, get() { reads++; throw Error("getter"); } });
  assert.equal(parseVideoOutputContract(getter), null); assert.equal(reads, 0);
});

test("actual shared recipe/schema/compiler keep one four-second video and exact immutable source binding", () => {
  for (const frameSize of ["1280x720", "720x1280"]) {
    const built = recipe(frameSize), plan = compileOutputPlan([built.spec], options);
    assert.equal(built.nativeReadiness, "unavailable"); assert.equal(inspectOutputRequirement(built.spec).status, "valid");
    assert.deepEqual(plan.issues, []); assert.equal(plan.targets.length, 1);
    const target = plan.targets[0];
    assert.deepEqual(target.quantity, { kind: "exact", unit: "video", value: 1 });
    assert.deepEqual(target.content_quantity, { kind: "exact", unit: "second", value: 4 });
    assert.deepEqual(target.count_policy, { kind: "exact", unit: "second", value: 4 });
    assert.deepEqual(target.video_contract, contract(frameSize));
    assert.equal(matchExperienceOutputRecipeTarget(built, plan, scope), target);
    target.video_contract.reference.sha256 = "0".repeat(64);
    assert.equal(built.spec.deliverables[0].video_contract.reference.sha256, reference.sha256);
    assert.equal(matchExperienceOutputRecipeTarget(built, plan, scope), null);
  }
});

test("invalid Video shapes cannot widen scope or silently use legacy target semantics", () => {
  for (const mutate of [entry => { entry.video_contract = undefined; }, entry => { entry.video_contract = null; },
    entry => { entry.media_kind = "image"; }, entry => { entry.quantity.value = 2; },
    entry => { entry.content_quantity.value = 5; }, entry => { delete entry.content_quantity; },
    entry => { entry.source_scope = { kind: "blocks", block_ids: ["one"] }; }, entry => { entry.coverage = { kind: "document_outline" }; },
    entry => { entry.format_variants = []; }, entry => { entry.series = undefined; }, entry => { entry.audio_contract = undefined; }]) {
    const value = structuredClone(recipe().spec); mutate(value.deliverables[0]);
    const result = inspectOutputRequirement(value); assert.equal(result.status, "invalid"); assert.equal(result.preserved, value);
    assert.equal(compileOutputPlan([value], options).targets.length, 0);
  }
  const request = { output: "video", requirementId: "video-r", deliverableId: "video-r", contract: contract() };
  assert.throws(() => createExperienceOutputRecipe(request), /recipe_invalid/);
});

test("actual target digest includes source selection, duration, audio, resolution and frame", async () => {
  const target = compiled().targets[0], original = await outputTargetContractDigest(target, "source-digest");
  for (const mutate of [t => { delete t.video_contract; }, t => { t.video_contract.source.draftHash = "sha256:" + "0".repeat(64); },
    t => { t.video_contract.reference.referenceId = "different"; }, t => { t.video_contract.reference.sha256 = "0".repeat(64); },
    t => { t.video_contract.frameSize = "720x1280"; }, t => { t.video_contract.seconds = 5; },
    t => { t.video_contract.audioMode = "original_ambient"; }, t => { t.video_contract.resolution = "720p"; }]) {
    const changed = structuredClone(target); mutate(changed);
    assert.notEqual(await outputTargetContractDigest(changed, "source-digest"), original);
  }
});

test("actual preflight, admission, generic file and native-result boundaries refuse Video before work", async () => {
  for (const value of [contract(), null, undefined, {}]) {
    const target = { ...compiled().targets[0], video_contract: value };
    const env = { DB: { prepare() { assert.fail("database command"); }, batch() { assert.fail("database command"); } },
      get MEDIA() { return assert.fail("media read"); }, get FAL_KEY() { return assert.fail("provider configuration"); } };
    const input = { target, env, request: new Request("https://forma.invalid/api/output"), scope: { documentId: "d", actorUserId: "owner" },
      principal: { userId: "owner" }, context: { snapshot: {} }, confirmedPlan: { plan: { targets: [target] } },
      slots: [{ targetId: target.id }], preflight: { targets: [{ targetId: target.id, available: true }] } };
    const preflight = await preflightOutputNativeTarget(input);
    assert.equal(preflight.available, false); assert.equal(preflight.reasonCode, "output_video_preparation_unavailable");
    assert.equal(preflight.maximumCalls, 0); assert.equal(preflight.maximumMicrousd, 0);
    assert.equal(outputNativeTargetRefusal(input).reasonCode, "output_native_video_unavailable");
    await assert.rejects(outputDocumentExecutionBridge.prepareAdmission(input), error => error.code === "output_video_execution_unavailable");
    await assert.rejects(resolveOutputNativeResult({ ...input, nativeJobId: "unadmitted" }), error => error.code === "native_video_contract_result_unavailable");
    assert.deepEqual(inspectOutputTargetFile(target, { status: "inspected", kind: "video", checks: ["synthetic_video"], facts: { durationSeconds: 4 } }),
      { status: "failed", checks: [], problems: ["video_contract_media_validation_unavailable"] });
  }
});

test("ordinary Video requirements and generic file checks do not acquire the new contract", () => {
  const spec = structuredClone(recipe().spec); delete spec.deliverables[0].video_contract;
  const target = compileOutputPlan([spec], options).targets[0]; assert.ok(target); assert.equal(Object.hasOwn(target, "video_contract"), false);
  assert.equal(inspectOutputTargetFile(target, { status: "inspected", kind: "video", checks: [], facts: { durationSeconds: 4 } }).status, "passed");
});
