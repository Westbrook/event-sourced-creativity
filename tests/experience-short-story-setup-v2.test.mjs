import assert from "node:assert/strict";
import test from "node:test";
import { buildExperiencePlan, experienceIds, registeredExperience, receiptPrefix } from "../src/experiences/intake.ts";
import { canonicalJson, compileExperience, digest } from "../src/experiences/compiler.ts";
import { fixtureCatalog } from "../src/experiences/catalog.ts";
import { BLOCK_TYPES } from "../src/model/block-types.ts";
import { inspectOutputRequirement, outputRequirementInterpretationNeedsReview } from "../src/model/output-requirements.ts";
import { buildShortStorySetupV2, decodeShortStorySetupV2, decodeShortStorySetupV2Receipt, captureExperienceIntakeJson, prepareShortStorySetupV2ReceiptChecker, shortStorySetupV2Archive, SHORT_STORY_SETUP_V2_BASE_RELEASE_HASH } from "../src/experiences/short-story-setup-v2.ts";

import { activeExperienceAdmission, EXPERIENCE_SETUP_ACTIVATION, SHORT_STORY_SETUP_V2_ARCHIVED_IDENTITY, readExperiencePrepare, experiencePrepareBody, readExperienceCommit, experienceCommitBody, readExperienceAdmission, experiencePrepareAdmission, experiencePlanAdmission, experienceAdmissionsEqual } from "../src/experiences/intake-protocol.ts";

// Static synthetic references from the owner's one approved unchanged V1 replay.
// baseline.json SHA-256: ffc1c04910ef83132fe2ff764c9615c9607ec76939b3942320f32e05c01e979f.
// No fixture execution, Worker, database, provider, browser or receipt store is imported.
const owner = "experience-owner";
const draftId = "experience-draft-414b05fa7d49f9bd93d73fbece47c90f64a3862af4051d19379ee833d370074c";
const projectId = "239f58c0-bac4-53da-a27b-d8eef9d6f121";
const documentId = "ccd53a06-e5f5-5ec8-abe8-1a22c3e93099";
const v1Golden = [
  {"id":"image","request":{"experienceId":"image","intentId":"8fa4b34e-7542-4ea5-9158-c7150ed24f02","releaseHash":"sha256:5a7e1f4cb6eac13bf5b165a35f0238282638018eb9c91b8ba00229e9d4b1186d","values":{"composition":{"provenance":"default","value":"center"},"lighting":{"provenance":"default","value":"daylight"},"subject":{"provenance":"authored","value":"Authored subject"}}},"draftHash":"sha256:70393361b786ea27e53c1b5ad9604ba3a9fb5776130658d1afb74477e11a2e52","releaseHash":"sha256:5a7e1f4cb6eac13bf5b165a35f0238282638018eb9c91b8ba00229e9d4b1186d","count":7},
  {"id":"short-story","request":{"experienceId":"short-story","intentId":"8fa4b34e-7542-4ea5-9158-c7150ed24f02","releaseHash":"sha256:da8cd1a20d106289e23ad9f6b8fcb0417928e2290a6f8168f6295c66dfbf4a88","values":{"causality":{"provenance":"authored","value":{"decision":"Authored Decision","goal":"Authored Goal","obstacle":"Authored Obstacle"}},"character":{"provenance":"authored","value":"Authored character"},"ending":{"provenance":"default","value":"resolution"}}},"draftHash":"sha256:2442ed7072b854ea9ef0e42d2246870311f3c9ec998b367095a5d0e2514a560c","releaseHash":"sha256:da8cd1a20d106289e23ad9f6b8fcb0417928e2290a6f8168f6295c66dfbf4a88","count":7},
  {"id":"scene","request":{"experienceId":"scene","intentId":"8fa4b34e-7542-4ea5-9158-c7150ed24f02","releaseHash":"sha256:61cb534ee9ecec56b9524b9e8515456aa3e9e3db8739309d3bcfcb35f772c290","values":{"conflict":{"provenance":"authored","value":{"a":"Authored Participant A","b":"Authored Participant B","goalA":"Authored Goal A","goalB":"Authored Goal B","secret":"Authored Secret"}},"knowledge":{"provenance":"default","value":"a"},"tension":{"provenance":"default","value":"low"}}},"draftHash":"sha256:963bf63094ceaafa04edab691a6c38722a3200c977c59eb037ce18e4d555d330","releaseHash":"sha256:61cb534ee9ecec56b9524b9e8515456aa3e9e3db8739309d3bcfcb35f772c290","count":7},
  {"id":"slides","request":{"experienceId":"slides","intentId":"8fa4b34e-7542-4ea5-9158-c7150ed24f02","releaseHash":"sha256:993187d61a7495bb0a86cf7ddd64d60c6cdab8c0f871cf0691b1de66323c907b","values":{"claim":{"provenance":"authored","value":"Authored claim"},"evidence":{"provenance":"authored","value":[{"id":"e1","text":"Evidence 1"},{"id":"e2","text":"Evidence 2"},{"id":"e3","text":"Evidence 3"}]}}},"draftHash":"sha256:0ef23433368d3cc4f502942a92a75c504d82811704631d7fc3931d29347c9297","releaseHash":"sha256:993187d61a7495bb0a86cf7ddd64d60c6cdab8c0f871cf0691b1de66323c907b","count":6},
  {"id":"storyboard","request":{"experienceId":"storyboard","intentId":"8fa4b34e-7542-4ea5-9158-c7150ed24f02","releaseHash":"sha256:f757fbcf332705a63685c157b0795aea2bf272884f8cf80347037ee0e9027a40","values":{"event":{"provenance":"authored","value":"Authored event"},"reveal":{"provenance":"authored","value":"Authored reveal"},"revealFrame":{"provenance":"default","value":"2"},"subject":{"provenance":"authored","value":"Authored subject"}}},"draftHash":"sha256:f370a0d147ecdb4c4c649277439b83444767539d80c1933ff84e7cac4ee90e44","releaseHash":"sha256:f757fbcf332705a63685c157b0795aea2bf272884f8cf80347037ee0e9027a40","count":8},
  {"id":"video","request":{"experienceId":"video","intentId":"8fa4b34e-7542-4ea5-9158-c7150ed24f02","releaseHash":"sha256:d9bd38babb87264331044c80e788acd29e36f90bb3fd06ce81b9c06d06d45734","values":{"anchor":{"provenance":"default","value":"center"},"camera":{"provenance":"default","value":"fixed"},"motion":{"provenance":"default","value":"still"},"subject":{"provenance":"authored","value":"Authored subject"}}},"draftHash":"sha256:4b88dd4345efc9e5e385a170250a433037a09163007c4b5c14111b75a58eb7db","releaseHash":"sha256:d9bd38babb87264331044c80e788acd29e36f90bb3fd06ce81b9c06d06d45734","count":8},
  {"id":"audio","request":{"experienceId":"audio","intentId":"8fa4b34e-7542-4ea5-9158-c7150ed24f02","releaseHash":"sha256:37fdd78c042933bfa57944fb78e03b8004f43c914fb03184c6e66374bd2a63b1","values":{"energy":{"provenance":"default","value":{"ending":2,"opening":1,"peak":4}},"instrument":{"provenance":"default","value":"piano"},"moment":{"provenance":"authored","value":"Authored moment"}}},"draftHash":"sha256:037dfe5f176c9df29dcd5ccbafec8176cf91372d419442f89a437d8f95e9d5ae","releaseHash":"sha256:37fdd78c042933bfa57944fb78e03b8004f43c914fb03184c6e66374bd2a63b1","count":7},
  {"id":"model3d","request":{"experienceId":"model3d","intentId":"8fa4b34e-7542-4ea5-9158-c7150ed24f02","releaseHash":"sha256:744b246bc40d7a19143b1ec4729a67ab9432a215576cc234929a1c65faaabdb7","values":{"object":{"provenance":"authored","value":"Authored object"},"proportions":{"provenance":"default","value":{"depth":2,"height":3,"width":2}},"surface":{"provenance":"default","value":"matte"}}},"draftHash":"sha256:10c9ea3edfc3b464c1f8332fc6e3e9014a18264fda62bf38b9aa7dd418db6000","releaseHash":"sha256:744b246bc40d7a19143b1ec4729a67ab9432a215576cc234929a1c65faaabdb7","count":7}
];
const storyGolden = v1Golden.find(row => row.id === "short-story");
const clone = value => structuredClone(value);
function frozen(value) {
  if (value && typeof value === "object") { assert.equal(Object.isFrozen(value), true); Object.values(value).forEach(frozen); }
}
function expected(plan) {
  // Synthetic retained-owner reference. Production must obtain these values from
  // trusted retained bytes/metadata, never mirror an untrusted candidate.
  return { intentId: plan.request.intentId, draftId: plan.draftId, draftHash: plan.draftHash, projectId: plan.projectId, documentId: plan.documentId, setupHash: plan.setup.setupHash };
}
async function rehash(plan) { const base = { ...plan }; delete base.draftHash; plan.draftHash = await digest(base); return plan; }
async function fixture(request = clone(storyGolden.request), principal = owner) {
  const release = await registeredExperience("short-story");
  const archive = await shortStorySetupV2Archive(release);
  const plan = await buildShortStorySetupV2(principal, request, release, archive.identity);
  return { release, archive, plan, retained: expected(plan) };
}
function receiptFor(plan) {
  // Prospective response fixture only: these are not server commit receipts.
  return {
    status: "complete", projectId: plan.projectId, documentId: plan.documentId,
    appended: plan.events.map((event, index) => ({
      eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      streamId: plan.streamId, sequence: 21 + index, occurredAt: "2026-09-02T12:00:00.000Z", recordedAt: "2026-09-02T12:00:01.000Z",
      actor: "user", clientId: "web:experience-intake", correlationId: "experience-intake:" + plan.projectId,
      causationId: null, compensatesEventId: null, schemaVersion: 1, type: event.type, payload: clone(event.payload),
    })),
    rejected: [], head: 20 + plan.events.length, draftId: plan.draftId, draftHash: plan.draftHash,
    generation: "unavailable", documentRoute: "/document/" + plan.documentId + "/short-story",
  };
}
const forbidden = new Set(["jobId", "grantId", "slotId", "planId", "providerJobId", "providerRequestId", "costReservationId", "paidMediaConfirmed", "preflightAcknowledged", "budgetAcknowledged", "output_execution", "output_plan", "output_result", "output_acceptance", "interpretation_basis"]);
function noAuthority(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); noAuthority(child); }
}
function pure(name, body) {
  test(name, { concurrency: false }, async t => {
    t.mock.method(globalThis, "fetch", async () => assert.fail("pure setup must not fetch"));
    await body(t);
  });
}

pure("all eight V1 canonical hashes, requests, identities and receipt bytes stay unchanged", async () => {
  assert.deepEqual(experienceIds, v1Golden.map(row => row.id));
  for (const row of v1Golden) {
    const release = await registeredExperience(row.id);
    const plan = await buildExperiencePlan(owner, clone(row.request), release);
    assert.equal(release.releaseHash, row.releaseHash);
    assert.equal(plan.version, 1);
    assert.equal(plan.draftHash, row.draftHash);
    const base = { ...plan }; delete base.draftHash;
    assert.equal(await digest(base), row.draftHash, "independent baseline covers every canonical plan byte");
    assert.equal(canonicalJson(plan.request), canonicalJson(row.request));
    assert.deepEqual([plan.draftId, plan.projectId, plan.documentId], [draftId, projectId, documentId]);
    assert.equal(plan.events.length, row.count);
    plan.events.forEach((event, index) => assert.equal(event.payload.client_event_id, "experience-intake:v1:" + draftId + ":" + index));
    assert.equal(receiptPrefix(draftId), "experience-intake:v1:" + draftId + ":");
    assert.equal(plan.events.some(event => event.payload.type === "output"), false);
  }
});

pure("V2 adds exactly one suggested, unreviewed typed Output in the original Document", async () => {
  const { release, archive, plan, retained } = await fixture();
  assert.equal(SHORT_STORY_SETUP_V2_BASE_RELEASE_HASH, storyGolden.releaseHash);
  assert.equal(archive.qualification, "setup-only");
  assert.equal(archive.identity.setupHash, await digest(archive.descriptor));
  assert.equal(archive.identity.baseReleaseHash, storyGolden.releaseHash);
  const v1 = await buildExperiencePlan(owner, clone(storyGolden.request), release);
  assert.equal(v1.draftHash, storyGolden.draftHash);
  assert.equal(plan.version, 2);
  assert.deepEqual([plan.draftId, plan.projectId, plan.documentId], [v1.draftId, v1.projectId, v1.documentId]);
  assert.equal(canonicalJson(plan.request), canonicalJson(v1.request));
  assert.equal(canonicalJson(plan.release), canonicalJson(v1.release));
  assert.equal(plan.events.length, 8);
  for (const [index, original] of v1.events.entries()) {
    const next = clone(plan.events[index]), before = clone(original);
    assert.equal(next.payload.client_event_id, "experience-intake:v2:" + plan.draftId + ":" + index);
    delete next.payload.client_event_id; delete before.payload.client_event_id;
    assert.deepEqual(next, before);
  }
  const output = plan.events[7];
  assert.equal(output.type, "BlockCreated");
  assert.equal(output.payload.client_event_id, "experience-intake:v2:" + plan.draftId + ":7");
  assert.deepEqual([output.payload.project_id, output.payload.document_id, output.payload.scope, output.payload.type], [plan.projectId, plan.documentId, "document", "output"]);
  assert.equal(output.payload.block_id, plan.outputBlockId);
  assert.notEqual(plan.outputBlockId, plan.events[6].payload.block_id);
  assert.equal(output.payload.handle, "output/" + plan.outputBlockId);
  assert.equal(output.payload.position, "z-output-" + plan.outputBlockId);
  const properties = output.payload.properties, spec = properties.output_spec;
  assert.deepEqual(Object.keys(properties).sort(), ["text", "subtype", "output_spec", "output_plan_suggestions", "authority", "experience_origin", "experience_release"].sort());
  assert.equal(properties.text, "1 short story"); assert.equal(properties.subtype, "Short story");
  assert.equal(properties.authority, "inferred"); assert.equal(properties.experience_origin, "default");
  assert.deepEqual(properties.output_plan_suggestions, {});
  assert.equal(inspectOutputRequirement(spec).status, "valid");
  assert.equal(outputRequirementInterpretationNeedsReview(spec), true);
  assert.equal(Object.hasOwn(spec.value_origins, "interpretation_basis"), false);
  assert.deepEqual(Object.keys(spec).sort(), ["schema_version", "id", "label", "original_text", "value_origins", "deliverables"].sort());
  assert.equal(spec.id, plan.outputBlockId); assert.equal(spec.deliverables.length, 1);
  const delivery = spec.deliverables[0];
  assert.equal(delivery.id, plan.deliverableId); assert.notEqual(delivery.id, plan.outputBlockId);
  assert.equal(delivery.label, "Short story"); assert.equal(delivery.original_text, "1 short story");
  assert.equal(delivery.required, true); assert.equal(delivery.media_kind, "document");
  assert.deepEqual(delivery.artifact_format, { kind: "short_story", version: 1 });
  assert.deepEqual(delivery.quantity, { kind: "exact", unit: "document", value: 1 });
  assert.deepEqual(delivery.source_scope, { kind: "document" }); assert.deepEqual(delivery.coverage, { kind: "document_context" });
  for (const origins of [spec.value_origins, delivery.value_origins]) for (const origin of Object.values(origins)) {
    assert.equal(origin.kind, "suggested"); assert.equal(typeof origin.text, "string"); assert.notEqual(origin.text.length, 0);
  }
  for (const key of ["weight", "influence", "intent", "effect"]) assert.equal(Object.hasOwn(properties, key), false);
  noAuthority(plan); frozen(plan); frozen(archive);
  assert.deepEqual(await decodeShortStorySetupV2(owner, plan, archive.identity, retained), plan);
});

pure("typed authored values remain exact while readable text preserves V1 trimming", async () => {
  const request = clone(storyGolden.request);
  request.values.character.value = "  A traveler\nwith a map  ";
  request.values.causality.value = { goal: "  Arrive\nintact  ", obstacle: "  Closed gate  ", decision: "  Wait  " };
  request.values.ending = { value: "open", provenance: "authored" };
  const { release, plan } = await fixture(request);
  const v1 = await buildExperiencePlan(owner, request, release);
  assert.equal(plan.events[3].payload.properties.text, "A traveler\nwith a map");
  assert.equal(plan.events[4].payload.properties.text, "Goal: Arrive\nintact\nObstacle: Closed gate\nDecision: Wait");
  assert.equal(plan.events[5].payload.properties.text, "Ending: Open");
  for (let index = 3; index <= 5; index++) {
    assert.deepEqual(plan.events[index].payload.properties, v1.events[index].payload.properties);
    const key = ["character", "causality", "ending"][index - 3];
    assert.deepEqual(plan.events[index].payload.properties.experience_value, request.values[key].value);
  }
});

pure("deterministic retry identity preserves same-intent V1/V2 conflict rather than minting", async () => {
  const { plan, release, archive, retained } = await fixture();
  assert.deepEqual(await buildShortStorySetupV2(owner, plan.request, release, archive.identity), plan);
  const v1 = await buildExperiencePlan(owner, plan.request, release);
  assert.equal(v1.draftId, plan.draftId); assert.equal(v1.documentId, plan.documentId); assert.notEqual(v1.draftHash, plan.draftHash);
  // This is a collision signal for the future retained-record transaction, not
  // proof that this disconnected builder can inspect or reject an existing row.
  const changedRequest = clone(plan.request); changedRequest.values.character.value = "Another traveler";
  const changed = await buildShortStorySetupV2(owner, changedRequest, release, archive.identity);
  assert.equal(changed.draftId, plan.draftId); assert.equal(changed.documentId, plan.documentId); assert.notEqual(changed.draftHash, plan.draftHash);
  await assert.rejects(decodeShortStorySetupV2(owner, changed, archive.identity, retained), /experience_setup_invalid/);
  const otherOwner = await fixture(clone(plan.request), "another-owner");
  const newRequest = clone(plan.request); newRequest.intentId = "d4187696-5ae9-4a2d-8a9b-b5f6531b5e96";
  const otherIntent = await fixture(newRequest);
  for (const other of [otherOwner.plan, otherIntent.plan]) for (const key of ["draftId", "projectId", "documentId", "outputBlockId", "deliverableId"]) assert.notEqual(other[key], plan[key]);
  await assert.rejects(decodeShortStorySetupV2("another-owner", plan, archive.identity, retained), /experience_setup_invalid/);
});

pure("seven other releases and mismatched Short story requests cannot activate V2", async () => {
  const { release, archive } = await fixture();
  for (const row of v1Golden.filter(row => row.id !== "short-story")) {
    const other = await registeredExperience(row.id);
    await assert.rejects(shortStorySetupV2Archive(other), /experience_setup_invalid/);
    await assert.rejects(buildShortStorySetupV2(owner, row.request, other, archive.identity), /experience_setup_invalid/);
    const mismatched = clone(storyGolden.request); mismatched.experienceId = row.id;
    await assert.rejects(buildShortStorySetupV2(owner, mismatched, release, archive.identity), /experience_setup_invalid/);
  }
  for (const mutate of [
    request => { request.output_spec = {}; }, request => { request.version = 2; },
    request => { request.intentId = "not-an-intent"; }, request => { request.releaseHash = "sha256:" + "0".repeat(64); },
    request => { request.values.character.value = ""; }, request => { request.values.character.value = "x".repeat(601); },
    request => { request.values.causality.value.goal = "x".repeat(401); },
    request => { request.values.character.provenance = "confirmed"; }, request => { request.values.character.provenance = "default"; },
    request => { request.values.ending = { value: "unknown", provenance: "authored" }; }, request => { request.values.causality.value.private = "hidden"; },
    request => { request.values.character.private = "hidden"; }, request => { delete request.values.ending; },
  ]) {
    const request = clone(storyGolden.request); mutate(request);
    await assert.rejects(buildShortStorySetupV2(owner, request, release, archive.identity), /experience_setup_invalid/);
  }
});

pure("literal release pin rejects self-rehashed catalogs; setup identity is independently bound", async () => {
  const { release, archive, plan, retained } = await fixture();
  const catalog = clone(fixtureCatalog); catalog.copy["short_story.character"] = "Protagonist";
  const changed = await compileExperience(release.definition, catalog);
  assert.equal(changed.ok, true); assert.notEqual(changed.release.releaseHash, release.releaseHash);
  await assert.rejects(shortStorySetupV2Archive(changed.release), /experience_setup_invalid/);
  const disguised = clone(changed.release); disguised.releaseHash = release.releaseHash;
  await assert.rejects(shortStorySetupV2Archive(disguised), /experience_setup_invalid/);
  for (const mutate of [
    identity => { identity.id = "short_story.output-setup@3"; }, identity => { identity.version = 3; },
    identity => { identity.setupHash = "sha256:" + "0".repeat(64); }, identity => { identity.baseReleaseHash = changed.release.releaseHash; },
    identity => { identity.approved = true; },
  ]) {
    const identity = clone(archive.identity); mutate(identity);
    await assert.rejects(buildShortStorySetupV2(owner, plan.request, release, identity), /experience_setup_invalid/);
    await assert.rejects(decodeShortStorySetupV2(owner, plan, identity, retained), /experience_setup_invalid/);
  }
  assert.deepEqual(await decodeShortStorySetupV2(owner, plan, archive.identity, retained), plan);
});

pure("closed archived plan rejects rehashed event, origin, version and identity drift", async () => {
  const { archive, plan, retained } = await fixture();
  const mutations = [
    item => { item.version = 1; }, item => { item.version = 3; }, item => { item.private = "hidden"; },
    item => { item.outputBlockId = item.documentId; }, item => { item.deliverableId = item.outputBlockId; },
    item => { item.streamId = "creative:other"; }, item => { item.title = "Story"; }, item => { item.setup.extra = true; },
    item => { item.events.pop(); }, item => { item.events.push(clone(item.events[7])); },
    item => { [item.events[3], item.events[4]] = [item.events[4], item.events[3]]; },
    item => { item.events[3].payload.properties.text = "Changed source"; },
    item => { item.events[3].payload.properties.experience_value = "Changed typed source"; },
    item => { item.events[3].payload.properties.authority = "inferred"; },
    item => { item.events[3].payload.properties.extra = "hidden"; },
    item => { item.events[6].payload.type = "output"; }, item => { item.events[7].actor = "user"; },
    item => { item.events[7].payload.extra = "hidden"; }, item => { item.events[7].payload.scope = "project"; },
    item => { item.events[7].payload.properties.weight = 1; }, item => { item.events[7].payload.properties.authority = "authored"; },
    item => { item.events[7].payload.properties.output_plan_suggestions.plan = "fabricated"; },
    item => { item.events[7].payload.properties.output_spec.extra = true; },
    item => { item.events[7].payload.properties.output_spec.value_origins.interpretation_basis = { kind: "confirmed", text: "1 short story" }; },
    item => { item.events[7].payload.properties.output_spec.value_origins.label.kind = "authored"; },
    item => { item.events[7].payload.properties.output_spec.deliverables[0].quantity.value = 2; },
    item => { item.events[7].payload.properties.output_spec.deliverables[0].artifact_format.kind = "scene"; },
    item => { item.events[7].payload.properties.output_spec.deliverables[0].source_scope.kind = "project"; },
    item => { item.events[7].payload.properties.output_spec.deliverables[0].coverage.extra = true; },
    item => { item.events[7].payload.properties.output_spec.deliverables[0].value_origins.quantity.extra = true; },
  ];
  for (const mutate of mutations) {
    const candidate = clone(plan); mutate(candidate); await rehash(candidate);
    // Even a supplied matching digest cannot replace closed reconstruction.
    const forgedExpected = { ...retained, draftHash: candidate.draftHash };
    await assert.rejects(decodeShortStorySetupV2(owner, candidate, archive.identity, forgedExpected), /experience_setup_invalid/);
  }
  const substitutions = { intentId: "d4187696-5ae9-4a2d-8a9b-b5f6531b5e96", draftId: "experience-draft-" + "0".repeat(64),
    draftHash: "sha256:" + "0".repeat(64), projectId: plan.documentId, documentId: plan.projectId, setupHash: "sha256:" + "0".repeat(64) };
  for (const [key, value] of Object.entries(substitutions)) {
    const wrong = clone(retained); wrong[key] = value;
    await assert.rejects(decodeShortStorySetupV2(owner, plan, archive.identity, wrong), /experience_setup_invalid/);
  }
  await assert.rejects(decodeShortStorySetupV2(owner, plan, archive.identity, { ...retained, trusted: true }), /experience_setup_invalid/);
});

pure("retained decode survives registry and subtype drift while fresh construction rejects it", async () => {
  const { archive, plan, release, retained } = await fixture();
  const prior = fixtureCatalog.copy["short_story.character"];
  try {
    fixtureCatalog.copy["short_story.character"] = "Protagonist";
    const changed = await registeredExperience("short-story"); assert.notEqual(changed.releaseHash, release.releaseHash);
    assert.deepEqual(await decodeShortStorySetupV2(owner, plan, archive.identity, retained), plan);
    await assert.rejects(buildShortStorySetupV2(owner, plan.request, release, archive.identity), /experience_setup_invalid/);
  } finally { fixtureCatalog.copy["short_story.character"] = prior; }
  const subject = BLOCK_TYPES.find(item => item.type === "subject");
  const subtype = subject.subtypes[0];
  try {
    subject.subtypes[0] = "Future default";
    assert.deepEqual(await decodeShortStorySetupV2(owner, plan, archive.identity, retained), plan);
    await assert.rejects(buildShortStorySetupV2(owner, plan.request, release, archive.identity), /experience_setup_invalid/);
  } finally { subject.subtypes[0] = subtype; }
  assert.deepEqual(await buildShortStorySetupV2(owner, plan.request, release, archive.identity), plan);
});

pure("receipt decoder binds exact complete sequence and original Document without commit claims", async () => {
  const { archive, plan, retained } = await fixture();
  const receipt = receiptFor(plan);
  const decoded = await decodeShortStorySetupV2Receipt(owner, plan, receipt, archive.identity, retained);
  assert.deepEqual(decoded, receipt); frozen(decoded);
  const laterHead = clone(receipt); laterHead.head += 9;
  assert.deepEqual(await decodeShortStorySetupV2Receipt(owner, plan, laterHead, archive.identity, retained), laterHead);
  const mutations = [
    item => { item.status = "partial"; }, item => { item.generation = "ready"; }, item => { item.extra = true; },
    item => { item.projectId = plan.documentId; }, item => { item.documentId = plan.projectId; },
    item => { item.draftId += "x"; }, item => { item.draftHash = storyGolden.draftHash; }, item => { item.documentRoute += "?new=true"; },
    item => { item.rejected = [{ error: "partial" }]; }, item => { item.head = 27; }, item => { item.head = 28.5; },
    item => { item.appended.pop(); }, item => { item.appended.push(clone(item.appended[7])); },
    item => { item.appended.reverse(); }, item => { item.appended[1].eventId = item.appended[0].eventId; },
    item => { item.appended[1].eventId = "not-an-id"; }, item => { item.appended.forEach((event, index) => { event.sequence = index; }); },
    item => { item.appended[1].sequence = 23; }, item => { item.appended.forEach((event, index) => { event.sequence = 21.5 + index; }); item.head = 29; },
    item => { item.appended[1].actor = "system"; }, item => { item.appended[1].streamId = "creative:other"; },
    item => { item.appended[1].clientId = "web:other"; }, item => { item.appended[1].correlationId += "other"; },
    item => { item.appended[1].schemaVersion = 2; }, item => { item.appended[1].causationId = item.appended[0].eventId; },
    item => { item.appended[1].compensatesEventId = item.appended[0].eventId; },
    item => { item.appended[1].occurredAt = "2026-09-02T12:00:00Z"; }, item => { item.appended[1].recordedAt = "2026-02-30T12:00:00.000Z"; },
    item => { item.appended[1].type = "BlockCreated"; }, item => { item.appended[1].extra = true; },
    item => { delete item.appended[1].causationId; }, item => { item.appended[7].payload.properties.text = "Another story"; },
  ];
  for (const mutate of mutations) {
    const candidate = clone(receipt); mutate(candidate);
    await assert.rejects(decodeShortStorySetupV2Receipt(owner, plan, candidate, archive.identity, retained), /experience_setup_invalid/);
  }
  await assert.rejects(decodeShortStorySetupV2Receipt("another-owner", plan, receipt, archive.identity, retained), /experience_setup_invalid/);
});

pure("literal V2 receipt keys reject alternate decimal spellings and every V1 graft", async () => {
  const { archive, plan, retained } = await fixture();
  for (const key of [
    "experience-intake:v2:" + draftId + ":01", "experience-intake:v2:" + draftId + ":+1", "experience-intake:v2:" + draftId + ":1e0",
    "experience-intake:v2:" + draftId + ": 1", "experience-intake:v2:" + draftId + ":1 ", "experience-intake:v2:" + draftId + ":1:suffix",
    " experience-intake:v2:" + draftId + ":1", "experience-intake:v1:" + draftId + ":1", "experience-intake:v3:" + draftId + ":1",
  ]) {
    const receipt = receiptFor(plan); receipt.appended[1].payload.client_event_id = key;
    await assert.rejects(decodeShortStorySetupV2Receipt(owner, plan, receipt, archive.identity, retained), /experience_setup_invalid/);
  }
  const zeroPadded = receiptFor(plan); zeroPadded.appended[0].payload.client_event_id = "experience-intake:v2:" + draftId + ":00";
  await assert.rejects(decodeShortStorySetupV2Receipt(owner, plan, zeroPadded, archive.identity, retained), /experience_setup_invalid/);
  const v1 = await buildExperiencePlan(owner, plan.request, plan.release);
  await assert.rejects(decodeShortStorySetupV2(owner, v1, archive.identity, retained), /experience_setup_invalid/);
  const allV1 = receiptFor(plan); allV1.appended.forEach((event, index) => { event.payload.client_event_id = receiptPrefix(plan.draftId) + index; });
  await assert.rejects(decodeShortStorySetupV2Receipt(owner, plan, allV1, archive.identity, retained), /experience_setup_invalid/);
});

pure("descriptor quarantine prevents getters, live Proxy rereads and post-call mutation", async () => {
  const { release, archive, plan, retained } = await fixture();
  let gets = 0;
  const request = new Proxy(clone(storyGolden.request), { get() { gets++; return { private: "unvalidated" }; } });
  const fromProxy = await buildShortStorySetupV2(owner, request, release, archive.identity);
  assert.deepEqual(fromProxy, plan); assert.equal(gets, 0);
  const accessor = clone(storyGolden.request);
  Object.defineProperty(accessor.values.character, "value", { enumerable: true, get() { gets++; return "unvalidated"; } });
  await assert.rejects(buildShortStorySetupV2(owner, accessor, release, archive.identity), /experience_setup_invalid/);
  const badReceipt = receiptFor(plan);
  Object.defineProperty(badReceipt.appended[0], "occurredAt", { enumerable: true, get() { gets++; return "2026-09-02T12:00:00.000Z"; } });
  await assert.rejects(decodeShortStorySetupV2Receipt(owner, plan, badReceipt, archive.identity, retained), /experience_setup_invalid/);
  assert.equal(gets, 0);
  const mutableRequest = clone(storyGolden.request), mutableRelease = clone(release), mutableIdentity = clone(archive.identity);
  const pending = buildShortStorySetupV2(owner, mutableRequest, mutableRelease, mutableIdentity);
  mutableRequest.values.character.value = "changed after call"; mutableRelease.output.label = "changed"; mutableIdentity.setupHash = "changed";
  assert.deepEqual(await pending, plan);
  const mutablePlan = clone(plan), mutableReceipt = receiptFor(plan), mutableExpected = clone(retained), mutableApproved = clone(archive.identity);
  const pendingReceipt = decodeShortStorySetupV2Receipt(owner, mutablePlan, mutableReceipt, mutableApproved, mutableExpected);
  mutablePlan.events[3].payload.properties.text = "changed"; mutableReceipt.appended[0].actor = "system"; mutableExpected.draftHash = "changed"; mutableApproved.setupHash = "changed";
  assert.deepEqual(await pendingReceipt, receiptFor(plan));
  const cycle = clone(storyGolden.request); cycle.self = cycle;
  const symbol = clone(storyGolden.request); symbol[Symbol("private")] = true;
  const method = clone(storyGolden.request); method.toJSON = () => storyGolden.request;
  const prototype = Object.assign(Object.create({ private: true }), clone(storyGolden.request));
  const sparse = clone(plan); sparse.events = new Array(8);
  for (const candidate of [cycle, symbol, method, prototype]) await assert.rejects(buildShortStorySetupV2(owner, candidate, release, archive.identity), /experience_setup_invalid/);
  await assert.rejects(decodeShortStorySetupV2(owner, sparse, archive.identity, retained), /experience_setup_invalid/);
});

pure("protocol preserves raw V1 bytes and requires explicit exact V2 envelopes", async () => {
  const { archive, plan } = await fixture();
  assert.deepEqual(archive.identity, SHORT_STORY_SETUP_V2_ARCHIVED_IDENTITY, "observed archived pin must match unchanged descriptor, not activation");
  assert.deepEqual(EXPERIENCE_SETUP_ACTIVATION, { shortStoryV2: false }); frozen(EXPERIENCE_SETUP_ACTIVATION);
  for (const row of v1Golden) {
    const original = clone(row.request), prepared = readExperiencePrepare(original);
    assert.equal(prepared.version, 1); frozen(prepared);
    assert.equal(JSON.stringify(experiencePrepareBody(prepared)), JSON.stringify(original));
    const active = activeExperienceAdmission(await registeredExperience(row.id));
    assert.equal(active.planVersion, 1); assert.equal(active.baseReleaseHash, row.releaseHash);
    assert.equal(experienceAdmissionsEqual(experiencePrepareAdmission(prepared), active), true);
  }
  assert.equal(activeExperienceAdmission(null), null);
  const wire = { version: 2, request: clone(plan.request), setup: clone(archive.identity) };
  const prepared = readExperiencePrepare(wire); frozen(prepared);
  assert.deepEqual(experiencePrepareBody(prepared), wire);
  const v2Admission = { planVersion: 2, experienceId: "short-story", setup: archive.identity };
  assert.deepEqual(readExperienceAdmission(v2Admission), v2Admission);
  assert.equal(experienceAdmissionsEqual(experiencePrepareAdmission(prepared), v2Admission), true);
  assert.equal(experienceAdmissionsEqual(experiencePlanAdmission(plan), v2Admission), true);
  assert.equal(experienceAdmissionsEqual(experiencePrepareAdmission(readExperiencePrepare(plan.request)), v2Admission), false, "same base hash is not setup equality");
  assert.equal(experienceAdmissionsEqual(null, null), false); assert.equal(experienceAdmissionsEqual(v2Admission, null), false);
  assert.equal(experienceAdmissionsEqual(v2Admission, { ...v2Admission, setup: { ...archive.identity, setupHash: "sha256:" + "0".repeat(64) } }), false);
  assert.equal(readExperienceAdmission(null), null);
  assert.throws(() => readExperienceAdmission({ ...v2Admission, extra: true }), /experience_protocol_invalid/);
  assert.throws(() => readExperiencePrepare({ version: 1, request: plan.request }), /experience_protocol_invalid/);
  for (const mutate of [
    value => { value.version = 3; }, value => { value.extra = true; }, value => { delete value.setup; },
    value => { value.request.extra = true; }, value => { value.request.experienceId = "image"; },
    value => { value.request.releaseHash = "sha256:" + "0".repeat(64); }, value => { value.setup.version = 3; },
    value => { value.setup.extra = true; }, value => { value.setup.setupHash = "sha256:" + "0".repeat(64); },
    value => { value.request.values.character.private = true; }, value => { value.request.values.character.provenance = "confirmed"; },
    value => { value.request.values.character.value = { field: { nested: "not-an-experience-value" } }; },
  ]) {
    const candidate = clone(wire); mutate(candidate); assert.throws(() => readExperiencePrepare(candidate), /experience_protocol_invalid/);
  }
  assert.deepEqual(experienceCommitBody(readExperienceCommit({ draftHash: "changed" })), { draftHash: "changed" }, "legacy V1 stale hash remains a string, not malformed V2");
  const originalCommit = { draftHash: storyGolden.draftHash };
  assert.equal(JSON.stringify(experienceCommitBody(readExperienceCommit(originalCommit))), JSON.stringify(originalCommit));
  const v2Commit = { version: 2, draftHash: plan.draftHash, setup: archive.identity };
  assert.deepEqual(experienceCommitBody(readExperienceCommit(v2Commit)), v2Commit);
  for (const candidate of [
    { version: 1, ...originalCommit }, { version: 3, ...originalCommit }, { ...v2Commit, extra: true },
    { draftHash: plan.draftHash, setup: archive.identity }, { version: 2, draftHash: plan.draftHash },
    { ...v2Commit, setup: { ...archive.identity, setupHash: "sha256:" + "0".repeat(64) } },
  ]) assert.throws(() => readExperienceCommit(candidate), /experience_protocol_invalid/);
});

pure("prepared receipt checker is synchronous over decoded frozen original and exact complete core", async () => {
  const { archive, plan, retained } = await fixture();
  const checker = await prepareShortStorySetupV2ReceiptChecker(owner, plan, archive.identity, retained);
  frozen(checker.plan); assert.equal(Object.isFrozen(checker), true);
  assert.notEqual(checker.plan, plan); assert.deepEqual(checker.plan, plan);
  const receipt = receiptFor(plan);
  const { draftId: _draft, draftHash: _hash, generation: _generation, documentRoute: _route, ...core } = receipt;
  const checked = checker.check(receipt), completed = checker.complete(core);
  assert.equal(checked instanceof Promise, false); assert.equal(completed instanceof Promise, false);
  assert.deepEqual(checked, receipt); assert.deepEqual(completed, receipt); frozen(checked); frozen(completed);
  assert.equal(checker.acceptCompleted(core), true);
  assert.deepEqual(completed, await decodeShortStorySetupV2Receipt(owner, plan, receipt, archive.identity, retained));
  for (const mutate of [
    value => { value.status = "unknown"; }, value => { delete value.status; }, value => { value.extra = true; },
    value => { value.appended.pop(); }, value => { value.appended[1].causationId = value.appended[0].eventId; },
    value => { value.appended[0].payload.client_event_id += "suffix"; }, value => { value.projectId = plan.documentId; },
  ]) {
    const candidate = clone(core); mutate(candidate);
    assert.equal(checker.acceptCompleted(candidate), false);
    assert.throws(() => checker.complete(candidate), /experience_setup_invalid/);
  }
  const original = checker.complete(core); core.appended[0].actor = "system";
  assert.equal(original.appended[0].actor, "user", "publication is an owned frozen snapshot");
  assert.equal(checker.acceptCompleted(core), false);
});

pure("each asynchronous input boundary is captured independently before its first await", async () => {
  const { archive, plan, retained, release } = await fixture();
  const mutations = {
    plan: value => { value.events[3].payload.properties.text = "changed after call"; },
    approved: value => { value.setupHash = "sha256:" + "0".repeat(64); },
    expected: value => { value.draftHash = "sha256:" + "0".repeat(64); },
  };
  for (const [key, mutate] of Object.entries(mutations)) {
    const args = { plan: clone(plan), approved: clone(archive.identity), expected: clone(retained) };
    const pending = prepareShortStorySetupV2ReceiptChecker(owner, args.plan, args.approved, args.expected);
    mutate(args[key]);
    const checker = await pending;
    assert.deepEqual(checker.plan, plan, key);
    assert.deepEqual(checker.check(receiptFor(plan)), receiptFor(plan), key);
  }
  for (const key of ["plan", "receipt", "approved", "expected"]) {
    const args = { plan: clone(plan), receipt: receiptFor(plan), approved: clone(archive.identity), expected: clone(retained) };
    const pending = decodeShortStorySetupV2Receipt(owner, args.plan, args.receipt, args.approved, args.expected);
    if (key === "receipt") args.receipt.appended[0].actor = "system"; else mutations[key](args[key]);
    assert.deepEqual(await pending, receiptFor(plan), key);
  }
  for (const key of ["request", "release", "approved"]) {
    const args = { request: clone(plan.request), release: clone(release), approved: clone(archive.identity) };
    const pending = buildShortStorySetupV2(owner, args.request, args.release, args.approved);
    if (key === "request") args.request.values.character.value = "changed after call";
    else if (key === "release") args.release.output.label = "changed after call";
    else mutations.approved(args.approved);
    assert.deepEqual(await pending, plan, key);
  }
  const archiveInput = clone(release), archivePending = shortStorySetupV2Archive(archiveInput);
  archiveInput.output.label = "changed after call";
  assert.deepEqual((await archivePending).identity, archive.identity);
});

pure("protocol and prepared receipt boundary never execute live getters or Proxy get traps", async () => {
  const { archive, plan, retained } = await fixture();
  let gets = 0;
  const trap = value => new Proxy(value, { get() { gets++; return { private: "unvalidated" }; } });
  const wire = { version: 2, request: clone(plan.request), setup: clone(archive.identity) };
  assert.deepEqual(readExperiencePrepare(trap(clone(wire))), readExperiencePrepare(wire));
  const commit = { version: 2, draftHash: plan.draftHash, setup: archive.identity };
  assert.deepEqual(readExperienceCommit(trap(clone(commit))), readExperienceCommit(commit));
  const checker = await prepareShortStorySetupV2ReceiptChecker(owner, trap(clone(plan)), trap(clone(archive.identity)), trap(clone(retained)));
  assert.deepEqual(checker.check(trap(receiptFor(plan))), receiptFor(plan));
  assert.equal(gets, 0);
  const accessorWire = clone(wire);
  Object.defineProperty(accessorWire.setup, "setupHash", { enumerable: true, get() { gets++; return archive.identity.setupHash; } });
  assert.throws(() => readExperiencePrepare(accessorWire), /experience_protocol_invalid/);
  const accessorCommit = clone(commit);
  Object.defineProperty(accessorCommit, "draftHash", { enumerable: true, get() { gets++; return plan.draftHash; } });
  assert.throws(() => readExperienceCommit(accessorCommit), /experience_protocol_invalid/);
  for (const key of ["plan", "approved", "expected"]) {
    const args = { plan: clone(plan), approved: clone(archive.identity), expected: clone(retained) };
    const property = key === "approved" ? "setupHash" : "draftHash";
    Object.defineProperty(args[key], property, { enumerable: true, get() { gets++; return "sha256:" + "0".repeat(64); } });
    await assert.rejects(prepareShortStorySetupV2ReceiptChecker(owner, args.plan, args.approved, args.expected), /experience_setup_invalid/);
  }
  const accessorReceipt = receiptFor(plan);
  Object.defineProperty(accessorReceipt.appended[0], "occurredAt", { enumerable: true, get() { gets++; return "2026-09-02T12:00:00.000Z"; } });
  assert.throws(() => checker.check(accessorReceipt), /experience_setup_invalid/);
  const { draftId: _draft, draftHash: _hash, generation: _generation, documentRoute: _route, ...core } = receiptFor(plan);
  Object.defineProperty(core, "head", { enumerable: true, get() { gets++; return 28; } });
  assert.equal(checker.acceptCompleted(core), false); assert.throws(() => checker.complete(core), /experience_setup_invalid/);
  assert.equal(gets, 0);
});


pure("descriptor capture bounds are isolated from recipe, hash and identity validation", async () => {
  const chain = count => { let value = 0; for (let index = 0; index < count; index++) value = [value]; return value; };
  const binary = depth => depth === 0 ? 0 : [binary(depth - 1), binary(depth - 1)];
  assert.deepEqual(captureExperienceIntakeJson(chain(16)), chain(16));
  assert.throws(() => captureExperienceIntakeJson(chain(17)), /experience_setup_invalid/);
  const tree = binary(12); // 8191 nodes; nesting stays below depth16.
  assert.deepEqual(captureExperienceIntakeJson([tree]), [tree]); // 8192 nodes.
  assert.throws(() => captureExperienceIntakeJson([tree, 0]), /experience_setup_invalid/); // 8193.
  assert.equal(captureExperienceIntakeJson(Array(64).fill(0)).length, 64);
  assert.throws(() => captureExperienceIntakeJson(Array(65).fill(0)), /experience_setup_invalid/);
  const object = count => Object.fromEntries(Array.from({ length: count }, (_, index) => ["k" + index, 0]));
  assert.equal(Object.keys(captureExperienceIntakeJson(object(64))).length, 64);
  assert.throws(() => captureExperienceIntakeJson(object(65)), /experience_setup_invalid/);
  assert.deepEqual(captureExperienceIntakeJson({ ["k".repeat(128)]: 0 }), { ["k".repeat(128)]: 0 });
  assert.throws(() => captureExperienceIntakeJson({ ["k".repeat(129)]: 0 }), /experience_setup_invalid/);
  assert.equal(captureExperienceIntakeJson("x".repeat(8192)).length, 8192);
  assert.throws(() => captureExperienceIntakeJson("x".repeat(8193)), /experience_setup_invalid/);
  // This is the capture's conservative encoded-byte accounting, not a promise
  // that every JSON text of exactly262144 bytes is accepted. Every other bound
  // remains satisfied; escaping NUL charges six bytes per code unit plus quotes.
  const byteNearLimit = [...Array(5).fill("\u0000".repeat(8192)), "\u0000".repeat(2727)];
  assert.equal(8 + 5 * (6 * 8192 + 2) + (6 * 2727 + 2), 262142);
  assert.deepEqual(captureExperienceIntakeJson(byteNearLimit), byteNearLimit);
  byteNearLimit[5] += "\u0000"; // 262148 conservatively counted bytes, nodes7/depth1.
  assert.throws(() => captureExperienceIntakeJson(byteNearLimit), /experience_setup_invalid/);
});
