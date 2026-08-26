import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { artifactReviewState } from "../src/model/context-health.ts";
import { foldEvents } from "../src/model/events.ts";
import {
  productionWorkflowRecordedSources,
  productionWorkflowSourceIdentity,
  productionWorkflowSourcesForStage,
  productionWorkflowStageStates,
  recommendProductionWorkflow,
} from "../src/model/production-workflow.ts";

const event = (sequence, type, payload, actor = "user") => ({
  eventId: `event-${sequence}`,
  streamId: "creative:owner",
  sequence,
  occurredAt: "2026-08-26T12:00:00.000Z",
  recordedAt: "2026-08-26T12:00:00.000Z",
  actor,
  clientId: "workflow-source-freshness",
  correlationId: "workflow-source-freshness",
  causationId: null,
  compensatesEventId: null,
  schemaVersion: 1,
  type,
  payload,
});

const foundation = () => [
  event(1, "ProjectCreated", { project_id: "project", name: "Project" }),
  event(2, "DocumentCreated", { project_id: "project", document_id: "document", title: "One document" }),
  event(3, "BlockCreated", {
    project_id: "project", document_id: "document", block_id: "direction", type: "direction",
    properties: { text: "A quiet and specific creative direction", weight: 1 },
  }),
];

const artifactEvent = (sequence, kind, id, extras = {}) => event(sequence, "DocumentRenderCompleted", {
  artifact_id: id,
  artifact_kind: kind,
  document_id: "document",
  project_id: "project",
  title: `${id} title`,
  summary: `${id} summary`,
  content_ref: `content-${id}`,
  source_block_versions: [{ block_id: "direction", version: 1 }],
  item_count: 1,
  items: [{ id: `${id}-part`, title: "One beat" }],
  ...extras,
}, "worker:renderer");

const artifactSource = (format, outputId, sequence, overrides = {}) => ({
  outputKind: "artifact",
  outputId,
  format,
  documentId: "document",
  sourceEventId: `event-${sequence}`,
  revision: 0,
  contentSha256: "a".repeat(64),
  approvalRequired: false,
  allowTextGuidance: false,
  ...overrides,
});

const videoWorkflow = () => recommendProductionWorkflow({
  id: "workflow-video-freshness",
  documentId: "document",
  projectId: "project",
  target: "video",
});

const statesFor = (workflow, events) => productionWorkflowStageStates(
  workflow,
  foldEvents(events, Number.POSITIVE_INFINITY, "document"),
  events,
);

test("a newly selected visual scene invalidates a direct-context storyboard without changing its authored document", () => {
  const workflow = videoWorkflow();
  const scene = workflow.stages.find((stage) => stage.format === "scene");
  const storyboard = workflow.stages.find((stage) => stage.format === "storyboard");
  const previousStoryboard = artifactSource("storyboard", "direct-storyboard", 4);
  const firstScene = artifactSource("scene", "visual-scene", 5, { contentSha256: "b".repeat(64) });
  storyboard.enabled = true;
  storyboard.source = previousStoryboard;
  const events = [
    ...foundation(),
    artifactEvent(4, "storyboard", "direct-storyboard"),
    artifactEvent(5, "scene", "visual-scene", { settings: { scene_medium: "visual" } }),
  ];

  let projection = foldEvents(events, Number.POSITIVE_INFINITY, "document");
  let states = productionWorkflowStageStates(workflow, projection, events);
  assert.equal(states.find((state) => state.stage.id === storyboard.id).status, "selected");
  assert.equal(states.at(-1).status, "ready", "outputs remain reusable without enabled upstream handoffs");

  scene.enabled = true;
  scene.source = firstScene;
  states = productionWorkflowStageStates(workflow, projection, events);
  let storyboardState = states.find((state) => state.stage.id === storyboard.id);
  assert.equal(states.find((state) => state.stage.id === scene.id).status, "selected");
  assert.equal(storyboardState.status, "stale");
  assert.equal(storyboardState.inputFreshness, "changed");
  assert.equal(storyboardState.actionable, true);
  assert.equal(storyboardState.artifact.id, "direct-storyboard", "the prior result remains available for review");
  assert.equal(artifactReviewState(storyboardState.artifact, projection.libraryBlocks, events).status, "draft",
    "workflow-input freshness is a secondary gate distinct from unchanged document-block freshness");
  assert.deepEqual(productionWorkflowSourcesForStage(workflow, storyboard.id, states), [firstScene]);
  assert.equal(states.at(-1).status, "blocked");

  storyboard.source = null;
  states = statesFor(workflow, events);
  storyboardState = states.find((state) => state.stage.id === storyboard.id);
  assert.equal(storyboardState.status, "missing", "clearing the outdated selection passes existing worker admission gates");
  assert.equal(storyboardState.inputFreshness, null);
  assert.equal(storyboardState.actionable, true);
  assert.deepEqual(productionWorkflowSourcesForStage(workflow, storyboard.id, states), [firstScene]);
  assert.equal(states.at(-1).status, "blocked");

  events.push(artifactEvent(6, "storyboard", "scene-grounded-storyboard", {
    workflow_id: workflow.id,
    workflow_stage_id: storyboard.id,
    workflow_sources: [firstScene],
    settings: { production_workflow: { id: workflow.id, stage_id: storyboard.id, sources: [firstScene] } },
  }));
  storyboard.source = artifactSource("storyboard", "scene-grounded-storyboard", 6, {
    contentSha256: "c".repeat(64),
  });
  projection = foldEvents(events, Number.POSITIVE_INFINITY, "document");
  states = productionWorkflowStageStates(workflow, projection, events);
  storyboardState = states.find((state) => state.stage.id === storyboard.id);
  assert.equal(storyboardState.status, "selected");
  assert.equal(storyboardState.inputFreshness, "current");
  assert.equal(storyboardState.artifact.id, "scene-grounded-storyboard");
  assert.equal(states.at(-1).status, "ready");

  events.push(artifactEvent(7, "scene", "replacement-visual-scene", { settings: { scene_medium: "visual" } }));
  const replacementScene = artifactSource("scene", "replacement-visual-scene", 7, {
    contentSha256: "d".repeat(64),
  });
  scene.source = replacementScene;
  projection = foldEvents(events, Number.POSITIVE_INFINITY, "document");
  states = productionWorkflowStageStates(workflow, projection, events);
  storyboardState = states.find((state) => state.stage.id === storyboard.id);
  assert.equal(storyboardState.status, "stale");
  assert.equal(storyboardState.inputFreshness, "changed");
  assert.equal(artifactReviewState(storyboardState.artifact, projection.libraryBlocks, events).status, "draft",
    "switching the selected production path does not alter the original output's global document freshness");
  assert.deepEqual(productionWorkflowSourcesForStage(workflow, storyboard.id, states), [replacementScene]);
  assert.equal(states.at(-1).status, "blocked");

  scene.source = firstScene;
  states = statesFor(workflow, events);
  assert.equal(states.find((state) => state.stage.id === storyboard.id).inputFreshness, "current");
  assert.equal(states.find((state) => state.stage.id === storyboard.id).status, "selected");
  assert.equal(states.at(-1).status, "ready", "restoring the exact original source restores valid lineage");
});

test("intermediate freshness accepts lineage retained on the completion event or durable artifact settings", () => {
  for (const location of ["event", "settings"]) {
    const workflow = videoWorkflow();
    const scene = workflow.stages.find((stage) => stage.format === "scene");
    const storyboard = workflow.stages.find((stage) => stage.format === "storyboard");
    const selectedScene = artifactSource("scene", "scene-lineage", 4);
    scene.enabled = true;
    scene.source = selectedScene;
    storyboard.enabled = true;
    storyboard.source = artifactSource("storyboard", "storyboard-lineage", 5);
    const extras = location === "event"
      ? { workflow_sources: [selectedScene] }
      : { settings: { production_workflow: { id: workflow.id, stage_id: storyboard.id, sources: [selectedScene] } } };
    const events = [
      ...foundation(),
      artifactEvent(4, "scene", "scene-lineage", { settings: { scene_medium: "visual" } }),
      artifactEvent(5, "storyboard", "storyboard-lineage", {
        workflow_id: workflow.id,
        workflow_stage_id: storyboard.id,
        ...extras,
      }),
    ];
    const states = statesFor(workflow, events);
    const storyboardState = states.find((state) => state.stage.id === storyboard.id);
    assert.equal(storyboardState.inputFreshness, "current", location);
    assert.equal(storyboardState.status, "selected", location);
    assert.equal(states.at(-1).status, "ready", location);
  }
});

test("production source identity treats revision and retained-content digest as distinct inputs", () => {
  const original = artifactSource("scene", "same-scene", 4);
  const editedRevision = { ...original, revision: 1 };
  const changedDigest = { ...original, contentSha256: "f".repeat(64) };
  assert.notDeepEqual(productionWorkflowSourceIdentity([original]), productionWorkflowSourceIdentity([editedRevision]));
  assert.notDeepEqual(productionWorkflowSourceIdentity([original]), productionWorkflowSourceIdentity([changedDigest]));
  assert.equal(productionWorkflowSourceIdentity([editedRevision])[0].revision, 1);
  assert.equal(productionWorkflowSourceIdentity([changedDigest])[0].contentSha256, "f".repeat(64));
});

test("declared malformed or contradictory production lineage fails closed", () => {
  const scene = artifactSource("scene", "valid-scene", 4);
  const alternate = { ...scene, contentSha256: "b".repeat(64) };
  const validDurable = { id: "workflow-video-freshness", stage_id: "storyboard-4", sources: [scene] };
  const cases = [
    ["null event sources", { workflow_sources: null }],
    ["object event sources", { workflow_sources: {} }],
    ["null source member", { workflow_sources: [null] }],
    ["malformed workflow container", { settings: { production_workflow: "invalid" } }],
    ["null durable sources", { settings: { production_workflow: { ...validDurable, sources: null } } }],
    ["missing durable sources", { settings: { production_workflow: { id: validDurable.id, stage_id: validDurable.stage_id } } }],
    ["private media injection", { workflow_sources: [{ ...scene, media_url: "/api/media/private" }] }],
    ["provider permission injection", { workflow_sources: [{ ...scene, allow_provider_audio_transfer: true }] }],
    ["invalid digest", { workflow_sources: [{ ...scene, contentSha256: "bad" }] }],
    ["negative revision", { workflow_sources: [{ ...scene, revision: -1 }] }],
    ["foreign document", { workflow_sources: [{ ...scene, documentId: "foreign-document" }] }],
    ["audio guidance on scene", { workflow_sources: [{ ...scene, allowTextGuidance: true }] }],
    ["duplicate sources", { workflow_sources: [scene, scene] }],
    ["conflicting event and durable sources", {
      workflow_sources: [scene], settings: { production_workflow: { ...validDurable, sources: [alternate] } },
    }],
    ["conflicting workflow identity", {
      workflow_id: "another-workflow", workflow_sources: [scene], settings: { production_workflow: validDurable },
    }],
    ["conflicting stage identity", {
      workflow_stage_id: "another-stage", workflow_sources: [scene], settings: { production_workflow: validDurable },
    }],
  ];
  for (const [label, extras] of cases) {
    assert.equal(productionWorkflowRecordedSources(artifactEvent(5, "storyboard", "malformed-board", extras)), null, label);
  }
  assert.deepEqual(productionWorkflowRecordedSources(artifactEvent(5, "storyboard", "legacy-board")), [],
    "undeclared legacy lineage remains compatible");
  assert.deepEqual(productionWorkflowRecordedSources(artifactEvent(5, "storyboard", "valid-board", {
    workflow_sources: [scene], settings: { production_workflow: validDurable },
  })), [scene]);
});

test("final completion accepts durable-only lineage but rejects malformed or contradictory provenance", () => {
  const workflow = recommendProductionWorkflow({
    id: "workflow-final-lineage", documentId: "document", projectId: "project", target: "scene",
  });
  const story = workflow.stages.find((stage) => stage.format === "short_story");
  const final = workflow.stages.at(-1);
  const source = artifactSource("short_story", "upstream-story", 4);
  story.enabled = true;
  story.source = source;
  const completion = artifactEvent(5, "scene", "finished-scene", {
    workflow_id: workflow.id,
    workflow_stage_id: final.id,
    settings: { scene_medium: "visual", production_workflow: { id: workflow.id, stage_id: final.id, sources: [source] } },
  });
  const events = [...foundation(), artifactEvent(4, "short_story", "upstream-story"), completion];
  let finalState = statesFor(workflow, events).at(-1);
  assert.equal(finalState.status, "complete", "durable-only lineage proves the exact final completion");
  assert.equal(finalState.artifact.id, "finished-scene");

  completion.payload.workflow_sources = null;
  finalState = statesFor(workflow, events).at(-1);
  assert.equal(finalState.status, "ready", "malformed event copy cannot fall back to durable lineage");
  assert.equal(finalState.artifact, null);

  completion.payload.workflow_sources = [source];
  completion.payload.settings.production_workflow.sources = [{ ...source, contentSha256: "b".repeat(64) }];
  finalState = statesFor(workflow, events).at(-1);
  assert.equal(finalState.status, "ready", "conflicting event and durable receipts cannot complete production");
  assert.equal(finalState.artifact, null);
});

test("image checkpoints reject stale generation and draft previews while accepting exact visual-scene lineage", () => {
  const workflow = videoWorkflow();
  const scene = workflow.stages.find((stage) => stage.format === "scene");
  const image = workflow.stages.find((stage) => stage.format === "image");
  const selectedScene = artifactSource("scene", "image-source-scene", 4);
  scene.enabled = true;
  scene.source = selectedScene;
  image.enabled = true;
  image.dependsOn = [scene.id];
  const imageSource = (outputId, sequence) => ({
    outputKind: "image", outputId, format: "image", documentId: "document",
    sourceEventId: `event-${sequence}`, revision: 0,
    approvalRequired: false, allowTextGuidance: false,
  });
  const imageEvent = (sequence, type, outputId, extras = {}) => event(sequence, type, {
    document_id: "document", project_id: "project",
    generation_id: `generation-${outputId}`,
    object_id: outputId, object_ids: [outputId],
    media_url: `/api/media/${outputId}.png`, media_type: "image/png",
    ...extras,
  }, "worker:generator");
  const events = [
    ...foundation(),
    artifactEvent(4, "scene", "image-source-scene", { settings: { scene_medium: "visual" } }),
    imageEvent(5, "GenerationCompleted", "direct-context-image"),
  ];
  image.source = imageSource("direct-context-image", 5);
  let states = statesFor(workflow, events);
  let imageState = states.find((state) => state.stage.id === image.id);
  assert.equal(imageState.status, "stale");
  assert.equal(imageState.inputFreshness, "changed");
  assert.deepEqual(productionWorkflowSourcesForStage(workflow, image.id, states), [selectedScene]);
  assert.equal(states.at(-1).status, "blocked");

  events.push(imageEvent(6, "GenerationCompleted", "scene-grounded-image", {
    workflow_id: workflow.id, workflow_stage_id: image.id,
    workflow_sources: [selectedScene],
  }));
  image.source = imageSource("scene-grounded-image", 6);
  states = statesFor(workflow, events);
  imageState = states.find((state) => state.stage.id === image.id);
  assert.equal(imageState.status, "selected");
  assert.equal(imageState.inputFreshness, "current");
  assert.equal(states.at(-1).status, "ready");

  events.push(imageEvent(7, "IdeationPreviewCompleted", "draft-preview-image"));
  image.source = imageSource("draft-preview-image", 7);
  states = statesFor(workflow, events);
  imageState = states.find((state) => state.stage.id === image.id);
  assert.equal(imageState.status, "stale", "draft previews cannot bypass production-source freshness");
  assert.equal(imageState.inputFreshness, "changed");
  assert.equal(states.at(-1).status, "blocked");
});

test("an output with the wrong actual artifact kind cannot satisfy a production stage", () => {
  const workflow = videoWorkflow();
  const storyboard = workflow.stages.find((stage) => stage.format === "storyboard");
  storyboard.enabled = true;
  storyboard.source = artifactSource("storyboard", "not-a-storyboard", 4);
  const events = [
    ...foundation(),
    artifactEvent(4, "scene", "not-a-storyboard", { settings: { scene_medium: "visual" } }),
  ];
  const state = statesFor(workflow, events).find((candidate) => candidate.stage.id === storyboard.id);
  assert.equal(state.status, "stale");
  assert.notEqual(state.inputFreshness, "current");
  assert.equal(statesFor(workflow, events).at(-1).status, "blocked");
});

test("production-path regeneration stays explicit, preserves output freshness distinctions, and is localized", async () => {
  const [ui, ...catalogs] = await Promise.all([
    "../src/components/document-artifacts.ts",
    "../src/components/design-system/localization.ts",
    "../src/components/design-system/locales/fr.ts",
    "../src/components/design-system/locales/ar.ts",
    "../src/components/design-system/locales/ja.ts",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));

  assert.match(ui, /#regenerateWorkflowStage\(/u);
  assert.match(ui, /#restoreWorkflowRegeneration\(/u);
  assert.match(ui, /#pendingWorkflowRegeneration=null/u);
  assert.match(ui, /#autoBoundWorkflowEvents\.add\(event\.eventId\)/u);
  assert.match(ui, /#updateWorkflowStage\(workflow,stage\.id,\(current\)=>\(\{\.\.\.current,source:null\}\)\)/u);
  assert.match(ui, /productionWorkflowRecordedSources\(event\)/u);
  assert.match(ui, /requireCurrentInputs:true/u);
  assert.match(ui, /state\.inputFreshness==="changed"/u);
  assert.match(ui, /outdatedWorkflowOutputs\.has\(artifact\.id\)/u);
  assert.match(ui, /#launchWorkflowStage\(current,replacement\)/u);
  for (const catalog of catalogs) {
    for (const key of ["regenerate", "inputsChanged", "inputsChangedLabel"]) {
      assert.match(catalog, new RegExp(`"workflow\\.${key}"`), key);
    }
  }
});
