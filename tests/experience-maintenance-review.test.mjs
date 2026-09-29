import assert from "node:assert/strict";
import test from "node:test";
import { definitions } from "../src/experiences/catalog.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceDocumentRoute, initialValues, registeredExperience } from "../src/experiences/intake.ts";
import { ExperienceIntakeRuntime } from "../src/experiences/intake-runtime.ts";
import { describeExperienceMaintenance, reviewExperienceMaintenance } from "../src/experiences/maintenance-review.ts";

// Direct production compiler/runtime imports; the final test supplies only a
// synthetic retained HTTP response. No browser, provider, publication or spend.
const original = await registeredExperience("slides");
assert.ok(original);
const originalOrder = original.definition.decisions.map(decision => decision.id);
const proposal = () => ({
  schemaVersion: 1,
  experienceId: "slides",
  baseReleaseHash: original.releaseHash,
  evidenceRefs: ["evidence/local-order-review.json"],
  changes: { decisionOrder: [...originalOrder].reverse() },
});
async function refused(raw) {
  const result = await reviewExperienceMaintenance(raw);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.issues) && result.issues.length > 0);
  assert.equal(Object.hasOwn(result, "review"), false);
  return result;
}
function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const item of Object.values(value)) assertDeepFrozen(item);
}

test("maintenance describes all registered outputs through the trusted current catalog", async () => {
  for (const definition of definitions) {
    const description = await describeExperienceMaintenance(definition.id);
    const current = await registeredExperience(definition.id);
    assert.ok(description);
    assert.deepEqual(Object.keys(description).sort(), ["schemaVersion", "mode", "experienceId", "baseReleaseHash", "definition", "output", "decisions", "allowedChanges", "proposalTemplate"].sort());
    assert.equal(description.schemaVersion, 1);
    assert.equal(description.mode, "proposal-only");
    assert.equal(description.experienceId, definition.id);
    assert.equal(description.baseReleaseHash, current.releaseHash);
    assert.deepEqual(description.definition, current.definition);
    assert.deepEqual(description.output, current.output);
    assert.deepEqual(description.decisions, current.definition.decisions.map(decision => ({
      id: decision.id, label: current.copy[decision.labelKey], bindingSlot: decision.bindingSlot, interactionRef: decision.interactionRef,
    })));
    assert.deepEqual(description.allowedChanges, ["decisionOrder"]);
    assert.equal(description.proposalTemplate.baseReleaseHash, current.releaseHash);
    assert.equal(description.proposalTemplate.experienceId, definition.id);
    assert.deepEqual(description.proposalTemplate.changes, { decisionOrder: current.definition.decisions.map(decision => decision.id) });
    await refused(description.proposalTemplate);
  }
  for (const id of ["unknown-output", "", null, undefined, {}, ["slides"], 1]) {
    assert.equal(await describeExperienceMaintenance(id), null);
  }
});

test("complete reorder produces a deterministic proposal with unchanged semantics and frozen base", async () => {
  const beforeDefinitions = canonicalJson(definitions);
  const beforeRelease = canonicalJson(original);
  const input = proposal();
  const result = await reviewExperienceMaintenance(input);
  assert.equal(result.ok, true);
  const review = result.review;
  assert.deepEqual(Object.keys(review).sort(), ["schemaVersion", "mode", "experienceId", "baseReleaseHash", "candidateReleaseHash", "baseDefinition", "candidateDefinition", "semanticDiff", "evidenceRefs", "dependencies", "reviewRequired", "candidateRelease"].sort());
  assert.equal(review.mode, "proposal-only");
  assert.equal(review.baseReleaseHash, original.releaseHash);
  assert.equal(review.candidateReleaseHash, review.candidateRelease.releaseHash);
  assert.notEqual(review.candidateReleaseHash, original.releaseHash);
  assert.equal(review.candidateDefinition.revision, original.definition.revision + 1);
  assert.equal(review.candidateDefinition.layout, original.definition.layout);
  assert.deepEqual(review.candidateDefinition.decisions, [...original.definition.decisions].reverse());
  assert.deepEqual({ ...review.candidateDefinition, revision: original.definition.revision,
    decisions: original.definition.decisions }, original.definition);
  assert.deepEqual(review.baseDefinition, original.definition);
  assert.deepEqual(review.candidateRelease.output, original.output);
  assert.deepEqual(review.candidateRelease.copy, original.copy);
  assert.deepEqual(review.candidateRelease.interactions, original.interactions);
  assert.deepEqual(review.dependencies, original.dependencies);
  assert.deepEqual(review.candidateRelease.dependencies, original.dependencies);
  assert.deepEqual(review.evidenceRefs, input.evidenceRefs);
  assert.deepEqual(new Map(review.semanticDiff.map(change => [change.field, { before: change.before, after: change.after }])), new Map([
    ["decisionOrder", { before: originalOrder, after: [...originalOrder].reverse() }],
  ]));
  assert.ok(review.reviewRequired.length > 0);
  assert.ok(review.reviewRequired.every(item => typeof item === "string" && item.length > 0));
  assert.equal(Object.isFrozen(review.baseDefinition), true);
  assert.equal(Object.isFrozen(original.definition), true);
  assertDeepFrozen(review);
  assert.throws(() => { review.baseDefinition.revision++; }, TypeError);
  input.evidenceRefs.push("later evidence");
  input.changes.decisionOrder.reverse();
  assert.deepEqual(review.evidenceRefs, ["evidence/local-order-review.json"]);
  assert.deepEqual(review.candidateDefinition.decisions.map(decision => decision.id), [...originalOrder].reverse());
  assert.equal(canonicalJson(original), beforeRelease);
  assert.equal(canonicalJson(definitions), beforeDefinitions);
  assert.equal(canonicalJson(await registeredExperience("slides")), beforeRelease);
  const repeated = await reviewExperienceMaintenance(proposal());
  assert.equal(repeated.ok, true);
  assert.equal(canonicalJson(repeated.review), canonicalJson(review));
});

test("caller mutation during catalog resolution cannot change the snapshotted proposal", async () => {
  const input = proposal();
  const pending = reviewExperienceMaintenance(input);
  input.experienceId = "image";
  input.baseReleaseHash = `sha256:${"0".repeat(64)}`;
  input.changes.layout = original.definition.layout;
  input.changes.decisionOrder.reverse();
  input.evidenceRefs[0] = "mutated after invocation";
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.review.experienceId, "slides");
  assert.equal(result.review.baseReleaseHash, original.releaseHash);
  assert.equal(result.review.candidateDefinition.layout, original.definition.layout);
  assert.deepEqual(result.review.candidateDefinition.decisions.map(decision => decision.id), [...originalOrder].reverse());
  assert.deepEqual(result.review.evidenceRefs, ["evidence/local-order-review.json"]);
});

test("no-op proposals do not manufacture a revision and layouts are never accepted operations", async () => {
  for (const changes of [{}, { decisionOrder: originalOrder }]) {
    await refused({ ...proposal(), changes });
  }
  for (const layout of ["stage-and-controls", "stacked-stage", "chat", "single-prompt", "", null, true]) {
    await refused({ ...proposal(), changes: { layout } });
    await refused({ ...proposal(), changes: { decisionOrder: [...originalOrder].reverse(), layout } });
  }
});

test("stale base, unknown output and incomplete or duplicate decision orders are rejected", async () => {
  await refused({ ...proposal(), baseReleaseHash: `sha256:${"0".repeat(64)}` });
  await refused({ ...proposal(), experienceId: "new-output" });
  for (const decisionOrder of [[], originalOrder.slice(1), [...originalOrder, "unknown"], originalOrder.map(() => originalOrder[0]), ["unknown", ...originalOrder.slice(1)], "claim,evidence"]) {
    await refused({ ...proposal(), changes: { decisionOrder } });
  }
});

test("Scene reorder keeps each character and its goal adjacent in renderer order", async () => {
  const scene = await registeredExperience("scene");
  assert.ok(scene);
  const sceneOrder = scene.definition.decisions.map(decision => decision.id);
  const rest = sceneOrder.filter(id => !["characterA", "goalA", "characterB", "goalB"].includes(id));
  const input = { ...proposal(), experienceId: "scene", baseReleaseHash: scene.releaseHash };
  const paired = ["characterB", "goalB", "characterA", "goalA", ...rest];
  const accepted = await reviewExperienceMaintenance({ ...input, changes: { decisionOrder: paired } });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.review.candidateDefinition.decisions.map(decision => decision.id), paired);
  assert.equal(accepted.review.candidateDefinition.layout, scene.definition.layout);
  for (const decisionOrder of [
    ["characterA", "characterB", "goalA", "goalB", ...rest],
    ["goalA", "characterA", "characterB", "goalB", ...rest],
    ["characterA", "goalA", "goalB", "characterB", ...rest],
    ["characterA", "goalA", "characterB", rest[0], "goalB", ...rest.slice(1)],
  ]) await refused({ ...input, changes: { decisionOrder } });
});

test("proposal shape cannot introduce approval, publication, cost, provider or dependency authority", async () => {
  for (const key of Object.keys(proposal())) {
    const input = proposal(); delete input[key]; await refused(input);
  }
  for (const [key, value] of Object.entries({ schemaVersion: 2, baseReleaseHash: "latest", evidenceRefs: [], changes: null })) {
    await refused({ ...proposal(), [key]: value });
  }
  const escalation = { approval: true, approved: true, publish: true, release: true, actorUserId: "owner", provider: "fal", model: "unreviewed", maximumMicrousd: 1, cost: 1, grantId: "invented", catalog: {}, dependencies: {}, candidateRelease: {}, definition: {} };
  for (const [key, value] of Object.entries(escalation)) {
    await refused({ ...proposal(), [key]: value });
    await refused({ ...proposal(), changes: { decisionOrder: [...originalOrder].reverse(), [key]: value } });
  }
});

test("evidence and overall input bounds reject missing, duplicate and excessive material", async () => {
  for (const evidenceRefs of [[], [""], ["same", "same"], [" space"], ["line\nbreak"], ["x".repeat(241)], [1], null, "evidence.json", Array.from({ length: 9 }, (_, index) => `evidence-${index}`)]) {
    await refused({ ...proposal(), evidenceRefs });
  }
  // Every string and array stays inside generic jsonIssues bounds; multibyte
  // text forces the independent 16 KiB UTF-8 envelope bound.
  const oversized = { ...proposal(), evidenceRefs: ["a" + "界".repeat(3000), "b" + "界".repeat(3000)] };
  assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > 16384);
  assert.ok((await refused(oversized)).issues.some(issue => issue.code === "proposal_limit"));
});

test("non-JSON values, getters and unsafe prototypes never become a review", async () => {
  let invoked = 0;
  const getter = proposal();
  Object.defineProperty(getter, "experienceId", { enumerable: true, get() { invoked++; throw Error("getter invoked"); } });
  const nestedGetter = proposal();
  Object.defineProperty(nestedGetter.changes, "decisionOrder", { enumerable: true, get() { invoked++; throw Error("nested getter invoked"); } });
  const toJSON = { ...proposal(), toJSON() { invoked++; throw Error("toJSON invoked"); } };
  const inherited = Object.assign(Object.create({ approved: true }), proposal());
  const unsafeKey = JSON.parse(JSON.stringify(proposal()));
  Object.defineProperty(unsafeKey.changes, "__proto__", { value: { approved: true }, enumerable: true });
  const symbol = proposal(); symbol[Symbol("authority")] = true;
  const cyclic = proposal(); cyclic.changes.self = cyclic;
  const hidden = proposal(); Object.defineProperty(hidden, "approved", { value: true, enumerable: false });
  for (const input of [undefined, null, true, 1, "proposal", [], new Date(), getter, nestedGetter, toJSON, inherited, unsafeKey, symbol, cyclic, hidden,
    { ...proposal(), changes: { decisionOrder: () => originalOrder } }, { ...proposal(), schemaVersion: Infinity }, { ...proposal(), schemaVersion: 1n }]) {
    await refused(input);
  }
  assert.equal(invoked, 0);
});

test("uninspectable in-process proposals return issues instead of escaping the review result contract", async () => {
  const revoked = Proxy.revocable(proposal(), {});
  revoked.revoke();
  for (const input of [revoked.proxy, new Proxy(proposal(), {}), new Proxy(proposal(), {
    getPrototypeOf() { throw Error("synthetic unsafe prototype trap"); },
  })]) await refused(input);
});

test("candidate selection and return to the original preserve the saved Document and receipt using GET only", async () => {
  const reviewed = await reviewExperienceMaintenance(proposal());
  assert.equal(reviewed.ok, true);
  const values = initialValues(original);
  values.claim = { value: "A retained claim", provenance: "authored" };
  values.evidence = { value: [1, 2, 3].map(index => ({ id: `e${index}`, text: `Retained evidence ${index}` })), provenance: "authored" };
  const request = { intentId: "0f2c1d1e-8548-4bd3-baf8-7468ec6d0791", experienceId: "slides", releaseHash: original.releaseHash, values };
  const plan = await buildExperiencePlan("synthetic-maintenance-owner", request, original);
  const receipt = {
    status: "complete", generation: "unavailable", draftId: plan.draftId, draftHash: plan.draftHash,
    projectId: plan.projectId, documentId: plan.documentId, documentRoute: experienceDocumentRoute(plan),
    head: plan.events.length, rejected: [], appended: plan.events.map((event, index) => ({
      ...structuredClone(event), eventId: crypto.randomUUID(), streamId: plan.streamId, actor: "user", clientId: "web:experience-intake",
      correlationId: `experience-intake:${plan.projectId}`, schemaVersion: 1, compensatesEventId: null, sequence: index + 1,
    })),
  };
  const before = canonicalJson({ plan, receipt });
  const calls = [];
  const fetcher = async (path, init) => {
    calls.push({ path, method: init?.method ?? "GET" });
    assert.equal(init?.method, undefined, "resuming a retained draft must not prepare, commit or buy");
    if (path === `/api/experiences/drafts/${plan.draftId}`) return Response.json({ plan });
    assert.equal(path, `/api/experiences/drafts/${plan.draftId}/receipt`);
    return Response.json(receipt);
  };
  for (const selection of [reviewed.review.candidateRelease, original]) {
    const runtime = new ExperienceIntakeRuntime(selection, fetcher);
    try {
      assert.equal(runtime.release.releaseHash, selection.releaseHash);
      await runtime.resume(plan.draftId);
      assert.equal(runtime.state.phase, "complete");
      assert.deepEqual(runtime.state.issues, []);
      assert.equal(runtime.draftId, plan.draftId);
      assert.equal(runtime.intentId, request.intentId);
      assert.equal(runtime.documentRoute, receipt.documentRoute);
      assert.equal(runtime.release.releaseHash, original.releaseHash);
      assert.equal(runtime.presentation.definition.layout, original.definition.layout);
      assert.deepEqual(runtime.presentation.definition.decisions.map(decision => decision.id), originalOrder);
      assert.equal(runtime.admissionRelease.releaseHash, selection.releaseHash);
      assert.equal(runtime.canRetry, selection.releaseHash === original.releaseHash);
      assert.deepEqual(runtime.committedPlan, plan);
      assert.deepEqual(runtime.receipt, receipt);
      assert.equal(runtime.receipt.documentId, plan.documentId);
      assert.deepEqual(runtime.state.draft.values, values);
    } finally { runtime.dispose(); }
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.method === "GET"));
  assert.equal(canonicalJson({ plan, receipt }), before);
  assert.equal((await registeredExperience("slides")).releaseHash, original.releaseHash);
});
