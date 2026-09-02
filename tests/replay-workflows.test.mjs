import assert from "node:assert/strict";
import test from "node:test";
import { CREATIVE_STUDY_DEFINITIONS } from "../src/model/replay-development.ts";
import { summarizeIntentTrajectories } from "../src/model/intent-trajectories.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { buildNothingToSomethingWorkflow, DEFAULT_REPLAY_WORK_PRODUCTS, REPLAY_OUTPUT_KINDS, replayContextFingerprint, reverseEngineerWorkProduct } from "../src/model/replay-workflows.ts";
import { SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";

const labels = { image: "Visual anchor", short_story: "Narrative", scene: "Screen scene", slides: "Presentation", storyboard: "Shot sequence", video: "Motion treatment", audio: "Original soundtrack" };

test("replay rejects 3D models until durable model fixtures are supported", () => {
  const product = { kind: "model3d", title: "A ceramic lantern" };
  assert.equal(REPLAY_OUTPUT_KINDS.includes("model3d"), false);
  assert.throws(() => reverseEngineerWorkProduct(product), /replay_output_kind_unsupported/);
  assert.throws(() => buildNothingToSomethingWorkflow([product]), /replay_output_kind_unsupported/);
});

function productsFor(kind, additions = {}) {
  return [kind, ...REPLAY_OUTPUT_KINDS.filter((candidate) => candidate !== kind)].map((candidate, index) => ({
    kind: candidate,
    title: `Mars greenhouse launch · ${labels[candidate]}`,
    audience: DEFAULT_REPLAY_WORK_PRODUCTS.find((product) => product.kind === candidate).audience,
    purpose: `Explain the Mars greenhouse launch as a ${labels[candidate].toLowerCase()}.`,
    ...(index === 0 ? { subject: "A botanist protecting the first Martian seedlings", setting: "a pressurized greenhouse on Mars", lighting: "red dawn through frosted glass", palette: ["#bb3311", "#237a49"], constraints: ["No visible oceans"], ...additions } : {}),
  }));
}

test("reconstructs every submitted format from its exact reviewed work product", () => {
  for (const kind of REPLAY_OUTPUT_KINDS) {
    const secret = `PRIVATE ARTIFACT BODY ${kind}`;
    const stream = buildNothingToSomethingWorkflow(productsFor(kind, { content: secret }), { artifactFirst: true });
    const source = stream.find((item) => kind === "image" ? item.type === "GenerationCompleted" : item.type === "DocumentRenderCompleted" && item.payload.artifact_kind === kind);
    const input = stream.find((item) => item.type === "BlockCreated" && item.payload.properties?.input_mode === "full_output");
    const derived = stream.find((item) => item.type === "GenerationCompleted" && item.sequence > input.sequence);
    const relevantKeys = new Set(["workflow-causal-integrity", "purpose-built-outputs", "one-context-many-outputs", "artifact-first-reconstruction", "output-consumption", "terminal-creative-outcome"]);
    const relevant = evaluateReplayCoverage(stream, SCENARIO_EVENT_TYPES).checks.filter((item) => relevantKeys.has(item.key));

    assert.ok(source && input && derived, kind);
    assert.equal(kind === "image" ? input.payload.properties.source_output_id : input.payload.properties.source_artifact_id, kind === "image" ? source.payload.object_id : source.payload.artifact_id, kind);
    assert.notEqual(source.payload.context_fingerprint, derived.payload.context_fingerprint, kind);
    assert.equal(relevant.every((item) => item.passed), true, `${kind}: ${JSON.stringify(relevant.filter((item) => !item.passed))}`);
    assert.equal(JSON.stringify(stream).includes(secret), false, kind);
    assert.equal(stream.some((item) => item.type === "RightsAsserted"), false, kind);
    assert.equal(summarizeIntentTrajectories(stream).unfinished.length, 0, kind);
    if (kind === "audio") {
      assert.match(source.payload.media_url, /\.mp3$/);
      assert.equal(source.payload.media_type, "audio/mpeg");
      assert.equal(stream.find((item) => item.type === "DocumentArtifactViewed" && item.payload.artifact_kind === "audio")?.payload.viewer_kind, "media");
      assert.equal(stream.find((item) => item.type === "DocumentArtifactExported" && item.payload.artifact_kind === "audio")?.payload.format, "audio/mpeg");
      assert.equal(input.payload.type, "audio");
      assert.equal(input.payload.properties.inform_generation, false);
      assert.equal(input.payload.properties.include_in_output, false);
      assert.equal(input.payload.properties.allow_provider_audio_transfer, false);
    }
  }
});

test("requires every shared reference permission before any output can run", () => {
  const products = productsFor("image");
  products[1].reference = { label: "A reference introduced by the narrative team", rightsConfirmed: false };
  const denied = buildNothingToSomethingWorkflow(products, { artifactFirst: true, providerBacked: true, includeSharing: true });
  const formalized = denied.find((item) => item.type === "ContextSetFormalized");

  assert.equal(denied.filter((item) => item.type === "ReferenceIngested").length, 1);
  assert.equal(denied.some((item) => item.type === "RightsAsserted"), false);
  assert.equal(denied.filter((item) => item.type === "GenerationBlockedBeforeProvider").length, REPLAY_OUTPUT_KINDS.length);
  assert.equal(denied.some((item) => /^(GenerationCompleted|DocumentRenderCompleted)$/.test(item.type)), false);
  assert.equal(denied.some((item) => /^(ShareLinkCreated|ShareLinkRevoked)$/.test(item.type)), false);
  assert.ok(denied.find((item) => item.type === "ReferenceIngested").sequence < formalized.sequence);

  products[1].reference.rightsConfirmed = true;
  const approved = buildNothingToSomethingWorkflow(products, { artifactFirst: true, providerBacked: true });
  const rights = approved.find((item) => item.type === "RightsAsserted");
  const approvedContext = approved.find((item) => item.type === "ContextSetFormalized");
  assert.ok(rights.sequence < approvedContext.sequence);
  assert.ok(approved.some((item) => item.type === "GenerationCompleted"));
  assert.ok(approved.some((item) => item.type === "DocumentRenderCompleted"));
  for (const kind of ["video", "audio"]) {
    const request = approved.find((item) => item.type === "DocumentRenderRequested" && item.payload.artifact_kind === kind);
    assert.equal(request.payload.paid_media_confirmed, false);
    assert.equal(request.payload.approval_required, true);
    assert.equal(approved.some((item) => item.type === "DocumentRenderCompleted" && item.payload.artifact_kind === kind), false);
    assert.ok(approved.some((item) => item.type === "DocumentRenderFailed" && item.payload[`${kind}_mock_boundary`] === true));
  }
});

test("merges compatible secondary context before formalization and rejects contradictory decisions", () => {
  const products = [
    { kind: "image", title: "Mars launch", audience: "art director", purpose: "Establish the visual world." },
    { kind: "scene", title: "Greenhouse scene", audience: "director", purpose: "Show the launch decision.", subject: "An astronaut", setting: "Mars greenhouse", palette: ["#ff4400"], constraints: ["No oceans"] },
  ];
  const stream = buildNothingToSomethingWorkflow(products);
  const compiled = stream.find((item) => item.type === "ContextCompiled");
  const facts = compiled.payload.compiled_snapshot.facts;
  assert.ok(facts.some((fact) => fact.type === "subject" && fact.value === "An astronaut"));
  assert.ok(facts.some((fact) => fact.type === "environment" && fact.value === "Mars greenhouse"));
  assert.ok(facts.some((fact) => fact.type === "palette" && fact.value.includes("#ff4400")));
  assert.ok(compiled.payload.compiled_snapshot.standing_constraints.includes("No oceans"));

  assert.throws(() => buildNothingToSomethingWorkflow([{ ...products[0], subject: "A botanist" }, products[1]]), /replay_work_products_require_shared_context/);
});

test("carries all seven locked focused studies into every shared-context output", () => {
  const studies = CREATIVE_STUDY_DEFINITIONS.map((definition) => definition.kind);
  const stream = buildNothingToSomethingWorkflow(productsFor("slides"), { artifactFirst: true, focusedStudies: studies });
  const compiled = stream.filter((item) => item.type === "ContextCompiled" && item.payload.context_revision === "context-revision-1");
  assert.ok(compiled.length);
  for (const kind of studies) {
    assert.ok(stream.some((item) => item.type === "BlockLocked" && item.payload.development_stage_kind === kind), kind);
    assert.ok(compiled.every((item) => item.payload.source_block_versions.some((version) => version.block_id.endsWith(`-study-${kind}`))), kind);
    assert.ok(compiled.every((item) => item.payload.compiled_snapshot.locked_studies.some((study) => study.study_kind === kind)), kind);
  }
});

test("marks reconstructed evidence as hypothetical and fingerprints context canonically", () => {
  const recipe = reverseEngineerWorkProduct({ kind: "slides", title: "Mars greenhouse launch" });
  assert.equal(recipe.inferredContext[0].evidence, "finished title");
  assert.equal(recipe.inferredContext[0].confidence, .58);
  assert.ok(recipe.inferredContext.every((fact) => fact.authority === "inferred" && fact.requiresConfirmation));
  assert.equal(recipe.safeguards.originalArtifactPreserved, true);
  assert.equal(recipe.safeguards.noProviderCalls, true);
  assert.equal(recipe.alternatives.length, 3);
  assert.equal(new Set(recipe.alternatives.map((alternative) => alternative.entryStep.id)).size, 3);
  assert.equal(new Set(recipe.alternatives.map((alternative) => alternative.steps.join("|"))).size, 3);
  for (const alternative of recipe.alternatives) {
    assert.equal(alternative.steps[1], alternative.entryStep.id);
    assert.ok(alternative.steps.indexOf("approve-paid-work") < alternative.steps.indexOf("make-the-output"));
  }

  const first = [{ block_id: "b", authority: "authored", version: 1 }, { block_id: "a", authority: "authored", version: 2 }];
  const second = [{ version: 2, block_id: "a", authority: "authored" }, { authority: "authored", version: 1, block_id: "b" }];
  assert.equal(replayContextFingerprint(first), replayContextFingerprint(second));
});

test("fails reconstruction when a matching reviewed source crosses a private scope", () => {
  const stream = buildNothingToSomethingWorkflow(productsFor("slides"), { artifactFirst: true });
  const source = stream.find((item) => item.type === "DocumentRenderCompleted" && item.payload.artifact_kind === "slides");
  const stolen = stream.map((item) => item.eventId === source.eventId ? { ...item, streamId: "creative:other-owner", payload: { ...item.payload, project_id: "private-project", document_id: "private-document", workflow_id: "private-workflow" } } : item);
  const reconstruction = evaluateReplayCoverage(stolen, SCENARIO_EVENT_TYPES).checks.find((item) => item.key === "artifact-first-reconstruction");
  assert.equal(reconstruction.passed, false);
});

test("models bounded trusted sharing without admitting public share events or leaking tokens", () => {
  const stream = buildNothingToSomethingWorkflow(productsFor("slides"), { artifactFirst: true, includeSharing: true });
  const created = stream.find((item) => item.type === "ShareLinkCreated");
  const revoked = stream.find((item) => item.type === "ShareLinkRevoked");
  const sharing = evaluateReplayCoverage(stream, SCENARIO_EVENT_TYPES).checks.find((item) => item.key === "bounded-sharing");
  assert.equal(sharing.passed, true);
  assert.equal(created.payload.resource_id, created.payload.document_id);
  assert.equal(created.payload.access, "read-only");
  assert.equal(created.payload.media_count, 8);
  assert.equal(revoked.payload.share_id, created.payload.share_id);
  assert.ok(revoked.sequence > created.sequence);
  assert.equal(Object.keys(created.payload).some((key) => /token|url|secret/i.test(key)), false);
  assert.equal(SCENARIO_EVENT_TYPES.includes("ShareLinkCreated"), false);

  const leaked = stream.map((item) => item.type === "ShareLinkCreated" ? { ...item, payload: { ...item.payload, share_token: "PRIVATE TOKEN" } } : item);
  assert.equal(evaluateReplayCoverage(leaked, SCENARIO_EVENT_TYPES).checks.find((item) => item.key === "bounded-sharing")?.passed, false);
  for (const injected of [{ metadata: { share_token: "PRIVATE TOKEN" } }, { redirect: "https://public.example/share/PRIVATE_TOKEN" }, { expires_at: "2099-01-01T00:00:00.000Z" }, { expires_at: "2000-01-01T00:00:00.000Z" }]) {
    const unsafe = stream.map((item) => item.type === "ShareLinkCreated" ? { ...item, payload: { ...item.payload, ...injected } } : item);
    assert.equal(evaluateReplayCoverage(unsafe, SCENARIO_EVENT_TYPES).checks.find((item) => item.key === "bounded-sharing")?.passed, false, JSON.stringify(injected));
  }
});
