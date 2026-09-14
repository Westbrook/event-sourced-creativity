import assert from "node:assert/strict";
import test from "node:test";
import { experienceOutputBinding, experienceOutputCommandKey, experienceOutputEnvelope, validateExperienceOutputEnvelope } from "../worker/experience-output-binding.ts";
import { digest } from "../src/experiences/compiler.ts";
import { MAX_SCENE_PREPARATION_RENEWALS, scenePreparationSuccessor, scenePreparationCommandKey,
  scenePreparationCycleMatches, scenePreparationMayRenew, type ScenePreparationPredecessor,
  type SceneRenewalEligibility } from "../worker/experience-scene-renewal.ts";

async function binding() {
  return experienceOutputBinding({ draftId: `experience-draft-${"a".repeat(64)}`, draftHash: `sha256:${"b".repeat(64)}`,
    request: { experienceId: "scene" }, events: [], release: { releaseHash: `sha256:${"c".repeat(64)}`, output: { output: "scene" } },
    projectId: "project-1", documentId: "document-1", streamId: "creative:actor-1" });
}
function predecessor(): ScenePreparationPredecessor {
  return { ordinal: 0, cycleId: null,
    confirmation: { key: "original:confirm", eventId: "event-confirm", digest: "d".repeat(64), planRevisionId: "plan-1" },
    preflight: { key: "original:preflight", eventId: "event-preflight", digest: "e".repeat(64), preflightId: "preflight-1" },
    sourceDigest: "source-1", requirementsDigest: "requirements-1" };
}
function eligible(): SceneRenewalEligibility {
  return { now: Date.parse("2026-09-13T18:00:00.000Z"), preparationExpiresAt: "2026-09-13T17:00:00.000Z",
    retentionExpiresAt: "2026-09-14T18:00:00.000Z", requiredWindowMs: 900_000,
    sourceCurrent: true, custodyCurrent: true, releaseCurrent: true, requirementCurrent: true, evidenceComplete: true,
    authorizationReceipts: 0, runReceipts: 0, grants: 0, slots: 0, jobs: 0, tokenReservations: 0, costReservations: 0, providerCalls: 0 };
}

test("legacy Scene cycle and envelope remain byte-identical to published 306", async () => {
  // Fixed vector generated with the HEAD implementation before Video support.
  const root = await binding(), cycle = await scenePreparationSuccessor(root, predecessor());
  assert.equal(Object.hasOwn(cycle, "output"), false);
  assert.equal(cycle.id, "f0dcbaf52d55d5f04327b09186893478bda1eb4c0c169aa1cecf6dade020d038");
  assert.equal(await digest(await experienceOutputEnvelope({ ...root, preparationCycle: cycle }, "confirm", 42,
    { explicitRequirementsConfirmation: true })), "sha256:59f43ebbd0fa7748b9ca0526d965be1797219afa7175690313917f051353dd5d");
});

test("concurrent successor identity is deterministic and leaves original v1 keys and receipts unchanged", async () => {
  const b = await binding(), p = predecessor(), before = structuredClone(p), originalKey = await experienceOutputCommandKey(b, "confirm");
  const cycles = await Promise.all(Array.from({ length: 12 }, () => scenePreparationSuccessor(b, p)));
  assert.equal(new Set(cycles.map(c => c.id)).size, 1);
  assert.equal(await experienceOutputCommandKey(b, "confirm"), originalKey);
  assert.deepEqual(p, before);
  assert.notEqual(scenePreparationCommandKey(cycles[0]!, "confirm"), originalKey);
  assert.equal(Object.isFrozen(cycles[0]!.predecessor.confirmation), true);
});

test("Video reuses lineage while separating cycle identities and retaining original draft/save", async () => {
  const scene = await binding(), video = { ...scene, output: "video" as const }, p = predecessor();
  const original = await experienceOutputCommandKey(video, "save");
  const cycle = await scenePreparationSuccessor(video, p), second = await scenePreparationSuccessor(video, p);
  assert.deepEqual(cycle, second); assert.equal(cycle.output, "video");
  assert.equal(cycle.draftId, video.draftId);
  assert.match(scenePreparationCommandKey(cycle, "confirm"), /^video-cycle-v1:/);
  assert.notEqual(cycle.id, (await scenePreparationSuccessor(scene, p)).id);
  assert.equal(await scenePreparationCycleMatches(scene, p, cycle), false);
  assert.equal(await scenePreparationCycleMatches(video, p, { ...cycle, output: undefined }), false);
  assert.equal(await experienceOutputCommandKey(video, "save"), original);
  await assert.rejects(experienceOutputCommandKey({ ...video, preparationCycle: cycle }, "save"));
  const body = await experienceOutputEnvelope({ ...video, preparationCycle: cycle }, "confirm", 7);
  assert.equal(body.documentId, video.documentId);
  assert.equal(body.clientMutationId, scenePreparationCommandKey(cycle, "confirm"));
});

test("lineage validation refuses changed predecessor, source, release, Document and arbitrary candidate data", async () => {
  const b = await binding(), p = predecessor(), cycle = await scenePreparationSuccessor(b, p);
  assert.equal(await scenePreparationCycleMatches(b, p, cycle), true);
  for (const altered of [{ ...b, documentId: "other" }, { ...b, releaseHash: "other" }, { ...b, sourceBindingHash: "other" }])
    assert.equal(await scenePreparationCycleMatches(altered, p, cycle), false);
  assert.equal(await scenePreparationCycleMatches(b, { ...p, confirmation: { ...p.confirmation, eventId: "other" } }, cycle), false);
  assert.equal(await scenePreparationCycleMatches(b, p, { ...cycle, extra: true }), false);
  assert.equal(await scenePreparationCycleMatches(b, p, { ...cycle, ordinal: 3 }), false);
});

test("actual command envelopes bind successor identity and cannot replay across the root or another cycle", async () => {
  const root = await binding(), p = predecessor(), cycle = await scenePreparationSuccessor(root, p);
  const renewed = { ...root, preparationCycle: cycle };
  const envelope = await experienceOutputEnvelope(renewed, "confirm", 42, { explicitRequirementsConfirmation: true });
  const hash = (await digest(envelope)).slice(7);
  assert.deepEqual(await validateExperienceOutputEnvelope(envelope, renewed, "confirm", hash), envelope);
  assert.equal(envelope.clientMutationId, scenePreparationCommandKey(cycle, "confirm"));
  await assert.rejects(validateExperienceOutputEnvelope(envelope, root, "confirm", hash));
  const other = await scenePreparationSuccessor(root, { ...p, preflight: { ...p.preflight, eventId: "other" } });
  await assert.rejects(validateExperienceOutputEnvelope(envelope, { ...root, preparationCycle: other }, "confirm", hash));
  await assert.rejects(experienceOutputEnvelope(renewed, "save", 42));
  await assert.rejects(experienceOutputCommandKey({ ...renewed, preparationCycle: { ...cycle, id: "f".repeat(64) } }, "confirm"));
  await assert.rejects(experienceOutputCommandKey({ ...root, preparationCycle: undefined }, "confirm"));
});

test("successors are bounded, require complete lineage and cannot mint another save stage", async () => {
  const b = await binding(), p = predecessor();
  await assert.rejects(scenePreparationSuccessor({ ...b, output: "image" }, p));
  for (const bad of [{ ...p, ordinal: -1 }, { ...p, ordinal: 1 }, { ...p, cycleId: "a".repeat(64) },
    { ...p, ordinal: MAX_SCENE_PREPARATION_RENEWALS }, { ...p, preflight: { ...p.preflight, digest: "" } }])
    await assert.rejects(scenePreparationSuccessor(b, bad));
  const cycle = await scenePreparationSuccessor(b, p);
  assert.throws(() => scenePreparationCommandKey(cycle, "save" as never));
  assert.equal(new Set(["confirm", "preflight", "authorize", "run"].map(stage => scenePreparationCommandKey(cycle, stage as "confirm"))).size, 4);
});

test("unknown predecessor/root fields cannot split one receipt identity into multiple valid successors", async () => {
  const b = await binding(), p = predecessor();
  for (const value of [{ ...p, extra: true }, { ...p, confirmation: { ...p.confirmation, extra: true } },
    { ...p, preflight: { ...p.preflight, extra: true } }]) await assert.rejects(scenePreparationSuccessor(b, value));
  await assert.rejects(scenePreparationSuccessor({ ...b, extra: true } as typeof b, p));
  const cycle = await scenePreparationSuccessor(b, p);
  await assert.rejects(scenePreparationSuccessor({ ...b, preparationCycle: cycle }, p));
  await assert.rejects(scenePreparationSuccessor({ ...b, preparationCycle: undefined }, p));
});

test("renewal eligibility requires positive complete never-authorized evidence, including settled history", () => {
  const e = eligible(); assert.equal(scenePreparationMayRenew(e), true);
  for (const key of ["authorizationReceipts", "runReceipts", "grants", "slots", "jobs", "tokenReservations", "costReservations", "providerCalls"] as const) {
    for (const value of [undefined, null, -1, 1, "0", NaN])
      assert.equal(scenePreparationMayRenew({ ...e, [key]: value } as unknown as SceneRenewalEligibility), false, `${key}: ${value}`);
  }
  for (const key of ["sourceCurrent", "custodyCurrent", "releaseCurrent", "requirementCurrent", "evidenceComplete"] as const)
    assert.equal(scenePreparationMayRenew({ ...e, [key]: false }), false, key);
});

test("renewal requires expired preparation and retention for the full new window without extending either", () => {
  const e = eligible();
  for (const patch of [{ preparationExpiresAt: new Date(e.now + 1).toISOString() }, { preparationExpiresAt: "invalid" },
    { retentionExpiresAt: new Date(e.now + e.requiredWindowMs).toISOString() }, { retentionExpiresAt: "invalid" },
    { requiredWindowMs: 0 }, { now: NaN }]) assert.equal(scenePreparationMayRenew({ ...e, ...patch }), false);
  assert.equal(scenePreparationMayRenew({ ...e, preparationExpiresAt: new Date(e.now).toISOString() }), true);
  assert.equal(scenePreparationMayRenew(undefined as unknown as SceneRenewalEligibility), false);
});
