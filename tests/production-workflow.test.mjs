import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { artifactReviewState } from "../src/model/context-health.ts";
import { DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";
import { foldEvents } from "../src/model/events.ts";
import {
  DOCUMENT_PRODUCTION_WORKFLOW_EVENT,
  moveProductionWorkflowStage,
  productionWorkflowIssues,
  productionWorkflowSceneConfiguration,
  productionWorkflows,
  productionWorkflowSourceIdentity,
  productionWorkflowSourcesForStage,
  productionWorkflowStageStates,
  recommendProductionWorkflow,
} from "../src/model/production-workflow.ts";
import { createSceneConfiguration, isSceneMedium, SCENE_MEDIA } from "../src/model/scene-configuration.ts";

function workflowDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  class Statement {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { return new Statement(this.sql, args); }
    execute(kind) {
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.args) ?? null;
      if (kind === "all") return { results: statement.all(...this.args), success: true, meta: { changes: 0 } };
      return { results: [], success: true, meta: { changes: Number(statement.run(...this.args).changes ?? 0) } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }
  return {
    sqlite,
    DB: {
      prepare(sql) { return new Statement(sql); },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const result = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql) ? "all" : "run"));
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}

const event = (sequence, type, payload, actor = "user") => ({
  eventId: `event-${sequence}`,
  streamId: "creative:owner",
  sequence,
  occurredAt: "2026-08-25T12:00:00.000Z",
  recordedAt: "2026-08-25T12:00:00.000Z",
  actor,
  clientId: "test",
  correlationId: "workflow-test",
  causationId: null,
  compensatesEventId: null,
  schemaVersion: 1,
  type,
  payload,
});

const foundation = () => [
  event(1, "ProjectCreated", { project_id: "project", name: "Project" }),
  event(2, "DocumentCreated", { project_id: "project", document_id: "document", title: "One document" }),
  event(3, "BlockCreated", { project_id: "project", document_id: "document", block_id: "direction", type: "direction", properties: { text: "A quiet and specific creative direction", weight: 1 } }),
];

const artifactEvent = (sequence, kind, id = kind) => event(sequence, "DocumentRenderCompleted", {
  artifact_id: id,
  artifact_kind: kind,
  document_id: "document",
  project_id: "project",
  title: `${kind} title`,
  summary: `${kind} summary`,
  content_ref: `content-${id}`,
  source_block_versions: [{ block_id: "direction", version: 1 }],
  item_count: 1,
  items: [{ id: `${id}-part`, title: "One beat" }],
}, "worker:renderer");

const artifactSource = (format, eventId, overrides = {}) => ({
  outputKind: "artifact",
  outputId: format,
  format,
  documentId: "document",
  sourceEventId: eventId,
  revision: 0,
  contentSha256: "a".repeat(64),
  approvalRequired: false,
  allowTextGuidance: false,
  ...overrides,
});

const workflow = (target, approvalRequired = false) => recommendProductionWorkflow({
  id: `workflow-${target}`,
  documentId: "document",
  projectId: "project",
  target,
  approvalRequired,
});

test("scene configurations distinguish both media and retain independently renderable alternatives", () => {
  assert.deepEqual(SCENE_MEDIA, ["visual", "audio"]);
  assert.equal(isSceneMedium("visual"), true);
  assert.equal(isSceneMedium("audio"), true);
  assert.equal(isSceneMedium("auto"), false);
  assert.equal(isSceneMedium("video"), false);

  assert.deepEqual(createSceneConfiguration("visual"), {
    medium: "visual",
    source: "manual",
    targetFormat: null,
    downstreamFormats: [],
    alternateMedium: "audio",
  });
  assert.deepEqual(createSceneConfiguration("audio", {
    source: "production-path",
    targetFormat: "audio",
    downstreamFormats: ["audio", "audio"],
  }), {
    medium: "audio",
    source: "production-path",
    targetFormat: "audio",
    downstreamFormats: ["audio"],
    alternateMedium: "visual",
  });
});

test("recommended scene stages automatically prepare for their ultimate production goal", () => {
  for (const target of ["audio", "video", "image", "storyboard", "scene"]) {
    const result = workflow(target);
    const stage = result.stages.find((candidate) => candidate.format === "scene");
    assert.equal(stage.sceneMedium, "auto", `${target} initializes scene interpretation automatically`);

    const configuration = productionWorkflowSceneConfiguration(result, stage.id);
    assert.equal(configuration.medium, target === "audio" ? "audio" : "visual", `${target} chooses its appropriate scene medium`);
    assert.equal(configuration.source, "production-path");
    assert.equal(configuration.targetFormat, target);
    assert.ok(configuration.downstreamFormats.includes(target));
    assert.equal(configuration.alternateMedium, target === "audio" ? "visual" : "audio");
  }
});

test("scene preparation follows only enabled transitive downstream handoffs and the final output", () => {
  const result = workflow("video");
  const stage = result.stages.find((candidate) => candidate.format === "scene");
  const storyboard = result.stages.find((candidate) => candidate.format === "storyboard");
  const soundtrack = result.stages.find((candidate) => candidate.format === "audio");

  assert.deepEqual(productionWorkflowSceneConfiguration(result, stage.id).downstreamFormats, ["video"]);
  storyboard.enabled = true;
  soundtrack.enabled = true;
  assert.deepEqual(productionWorkflowSceneConfiguration(result, stage.id), {
    medium: "visual",
    source: "production-path",
    targetFormat: "video",
    downstreamFormats: ["storyboard", "audio", "video"],
    alternateMedium: "audio",
  });

  storyboard.enabled = false;
  soundtrack.dependsOn = [storyboard.id];
  assert.deepEqual(productionWorkflowSceneConfiguration(result, stage.id).downstreamFormats, ["video"]);
});

test("manual scene overrides preserve downstream provenance and take precedence over automatic inference", () => {
  const result = workflow("audio");
  const stage = result.stages.find((candidate) => candidate.format === "scene");

  stage.sceneMedium = "visual";
  assert.deepEqual(productionWorkflowSceneConfiguration(result, stage.id), {
    medium: "visual",
    source: "manual",
    targetFormat: "audio",
    downstreamFormats: ["audio"],
    alternateMedium: "audio",
  });
  assert.deepEqual(productionWorkflowSceneConfiguration(result, stage.id, "audio"), {
    medium: "audio",
    source: "manual",
    targetFormat: "audio",
    downstreamFormats: ["audio"],
    alternateMedium: "visual",
  });
  assert.equal(productionWorkflowSceneConfiguration(result, "missing"), null);
  assert.equal(productionWorkflowSceneConfiguration(result, result.stages.at(-1).id), null);
});

test("legacy scene stages remain valid while unsupported or misplaced scene modes fail closed", () => {
  const legacy = workflow("audio");
  const scene = legacy.stages.find((stage) => stage.format === "scene");
  delete scene.sceneMedium;

  assert.deepEqual(productionWorkflowIssues(legacy), []);
  assert.equal(productionWorkflowSceneConfiguration(legacy, scene.id).medium, "audio");

  const invalid = structuredClone(legacy);
  invalid.stages.find((stage) => stage.format === "scene").sceneMedium = "soundtrack";
  assert.ok(productionWorkflowIssues(invalid).includes("workflow_scene_medium_invalid"));

  const misplaced = structuredClone(legacy);
  misplaced.stages.find((stage) => stage.format !== "scene").sceneMedium = "visual";
  assert.ok(productionWorkflowIssues(misplaced).includes("workflow_scene_medium_invalid"));
});

test("changing a final scene medium invalidates the prior completion until its exact alternate finishes", () => {
  const result = workflow("scene");
  const stage = result.stages.at(-1);
  const rows = [...foundation(), event(4, "DocumentRenderCompleted", {
    artifact_id: "visual-scene",
    artifact_kind: "scene",
    document_id: "document",
    project_id: "project",
    title: "Visual scene",
    summary: "A cinematic interpretation",
    source_block_versions: [{ block_id: "direction", version: 1 }],
    item_count: 1,
    items: [],
    workflow_id: result.id,
    workflow_stage_id: stage.id,
    settings: { scene_medium: "visual" },
  }, "worker:renderer")];

  let states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.at(-1).status, "complete");
  assert.equal(states.at(-1).artifact.id, "visual-scene");

  stage.sceneMedium = "audio";
  states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.at(-1).status, "ready");
  assert.equal(states.at(-1).artifact, null);

  rows.push(event(5, "DocumentRenderCompleted", {
    artifact_id: "audio-scene",
    artifact_kind: "scene",
    document_id: "document",
    project_id: "project",
    title: "Audio scene",
    summary: "A sonic interpretation of the same context",
    source_block_versions: [{ block_id: "direction", version: 1 }],
    item_count: 1,
    items: [],
    workflow_id: result.id,
    workflow_stage_id: stage.id,
    settings: { scene_medium: "audio" },
  }, "worker:renderer"));

  states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.at(-1).status, "complete");
  assert.equal(states.at(-1).artifact.id, "audio-scene");
});

test("an incompatible intermediate scene stays stale until an output in the downstream medium is selected", () => {
  const result = workflow("audio");
  const stage = result.stages.find((candidate) => candidate.format === "scene");
  stage.enabled = true;
  stage.source = artifactSource("scene", "event-4", { outputId: "visual-scene" });

  const visual = artifactEvent(4, "scene", "visual-scene");
  visual.payload.settings = { scene_medium: "visual" };
  const rows = [...foundation(), visual];
  let states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);

  assert.equal(states.find((candidate) => candidate.stage.id === stage.id).status, "stale");
  assert.equal(states.at(-1).status, "blocked");
  assert.deepEqual(productionWorkflowSourcesForStage(result, result.stages.at(-1).id, states), []);

  const sonic = artifactEvent(5, "scene", "audio-scene");
  sonic.payload.settings = { scene_medium: "audio" };
  rows.push(sonic);
  stage.source = artifactSource("scene", "event-5", { outputId: "audio-scene" });
  states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);

  assert.equal(states.find((candidate) => candidate.stage.id === stage.id).status, "selected");
  assert.equal(states.at(-1).status, "ready");
  assert.deepEqual(productionWorkflowSourcesForStage(result, result.stages.at(-1).id, states), [stage.source]);
});

test("legacy unconfigured scenes remain compatible with visual production paths and final completions", () => {
  const visualPath = workflow("video");
  const scene = visualPath.stages.find((stage) => stage.format === "scene");
  scene.enabled = true;
  scene.source = artifactSource("scene", "event-4", { outputId: "legacy-scene" });
  const intermediateRows = [...foundation(), artifactEvent(4, "scene", "legacy-scene")];
  const intermediate = productionWorkflowStageStates(
    visualPath,
    foldEvents(intermediateRows, Number.POSITIVE_INFINITY, "document"),
    intermediateRows,
  );

  assert.equal(intermediate.find((stage) => stage.stage.id === scene.id).status, "selected");
  assert.equal(intermediate.at(-1).status, "ready");

  const finalPath = workflow("scene");
  const completion = artifactEvent(4, "scene", "legacy-final-scene");
  completion.payload.workflow_id = finalPath.id;
  completion.payload.workflow_stage_id = finalPath.stages.at(-1).id;
  const finalRows = [...foundation(), completion];
  const final = productionWorkflowStageStates(finalPath, foldEvents(finalRows, Number.POSITIVE_INFINITY, "document"), finalRows);

  assert.equal(final.at(-1).status, "complete");
  assert.equal(final.at(-1).artifact.id, "legacy-final-scene");
});

test("final scene completion accepts event-level medium only when durable settings omit it", () => {
  const result = workflow("scene");
  const stage = result.stages.at(-1);
  stage.sceneMedium = "audio";
  const completion = artifactEvent(4, "scene", "event-level-audio");
  completion.payload.workflow_id = result.id;
  completion.payload.workflow_stage_id = stage.id;
  completion.payload.scene_medium = "audio";
  const rows = [...foundation(), completion];

  let states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.at(-1).status, "complete");

  completion.payload.settings = { scene_medium: "visual" };
  states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.at(-1).status, "ready", "durable settings take precedence over a conflicting event-level medium");
});

test("every deliverable receives one final target and only relevant optional prerequisite formats", () => {
  for (const format of DOCUMENT_ARTIFACT_KINDS) {
    const result = workflow(format);
    assert.deepEqual(productionWorkflowIssues(result), [], format);
    assert.equal(result.stages.filter((stage) => stage.final).length, 1, format);
    assert.equal(result.stages.at(-1).format, format);
    assert.ok(result.stages.slice(0, -1).every((stage) => stage.optional));
  }
  assert.deepEqual(workflow("short_story").stages.map((stage) => stage.format), ["short_story"]);
  assert.deepEqual(workflow("scene").stages.map((stage) => stage.format), ["short_story", "scene"]);
  assert.deepEqual(workflow("video").stages.map((stage) => stage.format), ["short_story", "scene", "image", "storyboard", "audio", "video"]);
  assert.ok(workflow("storyboard").stages.some((stage) => stage.format === "image"));
  assert.ok(workflow("slides").stages.some((stage) => stage.format === "image"));
  assert.ok(workflow("audio").stages.some((stage) => stage.format === "scene"));
  const image = recommendProductionWorkflow({ id: "image-path", documentId: "document", projectId: "project", target: "image" });
  assert.deepEqual(image.stages.map((stage) => stage.format), ["short_story", "scene", "storyboard", "audio", "image"]);
});

test("video soundtrack and storyboard are independent branches from scene direction", () => {
  const result = workflow("video");
  const scene = result.stages.find((stage) => stage.format === "scene");
  const storyboard = result.stages.find((stage) => stage.format === "storyboard");
  const audio = result.stages.find((stage) => stage.format === "audio");
  assert.ok(storyboard.dependsOn.includes(scene.id));
  assert.ok(audio.dependsOn.includes(scene.id));
  assert.ok(!audio.dependsOn.includes(storyboard.id));
});

test("invalid, duplicated, backward, cross-document, and multiple-final stages fail closed", () => {
  const result = workflow("video");
  const duplicate = structuredClone(result);
  duplicate.stages[1].id = duplicate.stages[0].id;
  assert.ok(productionWorkflowIssues(duplicate).includes("workflow_stage_identity_invalid"));
  const backwards = structuredClone(result);
  backwards.stages[0].dependsOn = [backwards.stages[1].id];
  assert.ok(productionWorkflowIssues(backwards).includes("workflow_dependency_invalid"));
  const foreign = structuredClone(result);
  foreign.stages[0].source = artifactSource("short_story", "event-4", { documentId: "foreign" });
  assert.ok(productionWorkflowIssues(foreign).includes("workflow_source_scope_invalid"));
  const twoFinals = structuredClone(result);
  twoFinals.stages[0].final = true;
  assert.ok(productionWorkflowIssues(twoFinals).includes("workflow_final_output_invalid"));
});

test("document-owned full-snapshot workflow events survive replay without authoring new blocks", () => {
  const result = workflow("storyboard");
  const rows = [...foundation(), event(4, DOCUMENT_PRODUCTION_WORKFLOW_EVENT, {
    workflow_id: result.id,
    document_id: result.documentId,
    project_id: result.projectId,
    workflow: result,
  })];
  assert.deepEqual(productionWorkflows(rows, "document", "project"), [result]);
  assert.equal(foldEvents(rows, Number.POSITIVE_INFINITY, "document").blocks.length, 1);
  assert.deepEqual(productionWorkflows(rows, "another-document", "project"), []);
  assert.deepEqual(productionWorkflows(rows, "document", "another-project"), []);
});

test("an exact independently approved artifact unlocks its dependent stage without document conversion", () => {
  const result = workflow("scene", true);
  result.stages[0].enabled = true;
  result.stages[0].source = artifactSource("short_story", "event-4", { approvalRequired: true });
  const contentSha256 = createHash("sha256").update(JSON.stringify({ content_markdown: "Exact source under independent review", items: [] })).digest("hex");
  result.stages[0].source.contentSha256 = contentSha256;
  const exact = { artifact_id: "short_story", document_id: "document", artifact_revision: 0, content_sha256: contentSha256 };
  const rows = [...foundation(), artifactEvent(4, "short_story")];
  let projection = foldEvents(rows, Number.POSITIVE_INFINITY, "document");
  let states = productionWorkflowStageStates(result, projection, rows);
  assert.equal(states[0].status, "needs-review");
  assert.equal(states[1].status, "blocked");
  rows.push(event(5, "ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: "independent-reviewer" }, "user:owner"));
  projection = foldEvents(rows, Number.POSITIVE_INFINITY, "document");
  states = productionWorkflowStageStates(result, projection, rows);
  assert.equal(states[0].status, "in-review");
  rows.push(event(6, "ArtifactApproved", exact, "user:independent-reviewer"));
  projection = foldEvents(rows, Number.POSITIVE_INFINITY, "document");
  states = productionWorkflowStageStates(result, projection, rows);
  assert.equal(states[0].status, "approved");
  assert.equal(states[1].status, "ready");
  assert.deepEqual(productionWorkflowSourcesForStage(result, result.stages[1].id, states), [result.stages[0].source]);
  assert.equal(projection.blocks.length, 1);
  assert.equal(artifactReviewState(projection.artifacts[0], projection.blocks, rows).status, "approved");
});

test("edited upstream revisions become stale and transitively block all enabled descendants", () => {
  const result = workflow("video", true);
  result.stages[0].enabled = true;
  result.stages.find((stage) => stage.format === "scene").enabled = true;
  result.stages[0].source = artifactSource("short_story", "event-4", { approvalRequired: true });
  const contentSha256 = createHash("sha256").update(JSON.stringify({ content_markdown: "The exact approved upstream output", items: [] })).digest("hex");
  result.stages[0].source.contentSha256 = contentSha256;
  const exact = { artifact_id: "short_story", document_id: "document", artifact_revision: 0, content_sha256: contentSha256 };
  const rows = [...foundation(), artifactEvent(4, "short_story"),
    event(5, "ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: "independent-reviewer" }, "user:owner"),
    event(6, "ArtifactApproved", exact, "user:independent-reviewer")];
  let states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states[0].status, "approved");
  rows.push(event(7, "DocumentArtifactEdited", { artifact_id: "short_story", document_id: "document" }));
  states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states[0].status, "stale");
  assert.equal(states.find((stage) => stage.stage.format === "scene").status, "blocked");
  assert.equal(states.at(-1).status, "blocked");
});

test("a generated image is honestly selected, never artifact-approved", () => {
  const result = workflow("slides", true);
  result.stages[0].enabled = false;
  const image = result.stages.find((stage) => stage.format === "image");
  image.enabled = true;
  image.source = {
    outputKind: "image",
    outputId: "image-one",
    format: "image",
    documentId: "document",
    sourceEventId: "event-4",
    revision: 0,
    approvalRequired: false,
    allowTextGuidance: false,
  };
  const rows = [...foundation(), event(4, "GenerationCompleted", {
    document_id: "document", project_id: "project", generation_id: "image-generation", object_ids: ["image-one"], media_url: "/api/media/image.jpg", media_type: "image/jpeg",
  }, "worker:generator")];
  const states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.find((stage) => stage.stage.format === "image").status, "selected");
  assert.equal(states.at(-1).status, "ready");
});

test("a completed intermediate image never counts as visual approval before explicit selection", () => {
  const result = workflow("slides", true);
  const stage = result.stages.find((candidate) => candidate.format === "image");
  stage.enabled = true;
  const rows = [...foundation(), event(4, "GenerationCompleted", {
    document_id: "document", project_id: "project", generation_id: "stage-generation", object_ids: ["stage-image"],
    media_url: "/api/media/stage-image.jpg", media_type: "image/jpeg", workflow_id: result.id, workflow_stage_id: stage.id,
  }, "worker:generator")];
  let states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.find((candidate) => candidate.stage.id === stage.id).status, "missing");
  assert.equal(states.at(-1).status, "blocked");
  stage.source = {
    outputKind: "image", outputId: "stage-image", format: "image", documentId: "document", sourceEventId: "event-4",
    revision: 0, approvalRequired: false, allowTextGuidance: false,
  };
  states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.find((candidate) => candidate.stage.id === stage.id).status, "selected");
  assert.equal(states.at(-1).status, "ready");
});

test("skipped optional stages never block a direct final deliverable", () => {
  const result = workflow("video", true);
  result.stages.slice(0, -1).forEach((stage) => { stage.enabled = false; });
  const rows = foundation();
  const states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.ok(states.slice(0, -1).every((stage) => stage.status === "skipped"));
  assert.equal(states.at(-1).status, "ready");
  assert.deepEqual(productionWorkflowSourcesForStage(result, result.stages.at(-1).id, states), []);
});

test("recommended optional stages are opt-in, so the unmodified direct video path remains ready", () => {
  const result = workflow("video", true);
  const rows = foundation();
  const states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.ok(states.slice(0, -1).every((stage) => stage.status === "skipped"));
  assert.equal(states.at(-1).status, "ready");
});

test("malformed stored workflow snapshots are ignored without breaking document rendering", () => {
  const rows = [...foundation(), event(4, DOCUMENT_PRODUCTION_WORKFLOW_EVENT, {
    workflow_id: "bad",
    document_id: "document",
    project_id: "project",
    workflow: { id: "bad", documentId: "document", projectId: "project", target: "video", stages: [{ id: "bad" }] },
  })];
  assert.doesNotThrow(() => productionWorkflows(rows, "document", "project"));
  assert.deepEqual(productionWorkflows(rows, "document", "project"), []);
});

test("the exact final completion is correlated by workflow and stage rather than output format", () => {
  const result = workflow("scene");
  const rows = [...foundation(), event(4, "DocumentRenderCompleted", {
    artifact_id: "unrelated-scene", artifact_kind: "scene", document_id: "document", project_id: "project",
    title: "Unrelated", summary: "Another workflow", source_block_versions: [{ block_id: "direction", version: 1 }],
    item_count: 1, items: [], workflow_id: "different", workflow_stage_id: "scene-final",
  }, "worker:renderer")];
  let states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.at(-1).status, "ready");
  rows.push(event(5, "DocumentRenderCompleted", {
    artifact_id: "exact-scene", artifact_kind: "scene", document_id: "document", project_id: "project",
    title: "Final deliverable", summary: "The one final output", source_block_versions: [{ block_id: "direction", version: 1 }],
    item_count: 1, items: [], workflow_id: result.id, workflow_stage_id: "scene-final",
  }, "worker:renderer"));
  states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.at(-1).status, "complete");
  assert.equal(states.at(-1).artifact.id, "exact-scene");
});

test("changing an exact upstream output invalidates a previously completed final deliverable", () => {
  const result = workflow("scene");
  const oldSource = artifactSource("short_story", "event-4", { outputId: "old-story" });
  const newSource = artifactSource("short_story", "event-5", { outputId: "new-story", contentSha256: "b".repeat(64) });
  result.stages[0].enabled = true;
  result.stages[0].source = oldSource;
  const rows = [
    ...foundation(),
    artifactEvent(4, "short_story", "old-story"),
    artifactEvent(5, "short_story", "new-story"),
    event(6, "DocumentRenderCompleted", {
      artifact_id: "finished-scene", artifact_kind: "scene", document_id: "document", project_id: "project",
      title: "Former final", summary: "Uses the former source", source_block_versions: [{ block_id: "direction", version: 1 }],
      item_count: 1, items: [], workflow_id: result.id, workflow_stage_id: "scene-final", workflow_sources: [oldSource],
    }, "worker:renderer"),
  ];
  let states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states.at(-1).status, "complete");
  result.stages[0].source = newSource;
  states = productionWorkflowStageStates(result, foldEvents(rows, Number.POSITIVE_INFINITY, "document"), rows);
  assert.equal(states[0].status, "selected");
  assert.equal(states.at(-1).status, "ready");
  assert.equal(states.at(-1).artifact, null);
});

test("editing an approved upstream output expires downstream approval in every artifact viewer", () => {
  const source = artifactSource("short_story", "event-4", { approvalRequired: true });
  const rows = [
    ...foundation(),
    artifactEvent(4, "short_story"),
    event(5, "ArtifactApproved", { artifact_id: "short_story", document_id: "document" }, "user:reviewer"),
    event(6, "DocumentRenderCompleted", {
      artifact_id: "approved-scene", artifact_kind: "scene", document_id: "document", project_id: "project",
      title: "Approved scene", summary: "Uses an approved story", source_block_versions: [{ block_id: "direction", version: 1 }],
      item_count: 1, items: [], settings: { production_workflow: { id: "workflow-scene", stage_id: "scene-final", sources: [source] } },
    }, "worker:renderer"),
    event(7, "ArtifactApproved", { artifact_id: "approved-scene", document_id: "document" }, "user:reviewer"),
  ];
  let projection = foldEvents(rows, Number.POSITIVE_INFINITY, "document");
  let final = projection.artifacts.find((artifact) => artifact.id === "approved-scene");
  assert.equal(artifactReviewState(final, projection.blocks, rows).status, "approved");
  rows.push(event(8, "DocumentArtifactEdited", { artifact_id: "short_story", document_id: "document" }));
  projection = foldEvents(rows, Number.POSITIVE_INFINITY, "document");
  final = projection.artifacts.find((artifact) => artifact.id === "approved-scene");
  const downstream = artifactReviewState(final, projection.blocks, rows);
  assert.equal(downstream.status, "stale");
  assert.ok(downstream.changedBlockIds.includes("output:short_story"));
});

test("independent stages can be reordered, but the final target and dependency order are protected", () => {
  const result = workflow("video");
  const image = result.stages.find((stage) => stage.format === "image");
  const reordered = moveProductionWorkflowStage(result, image.id, -1);
  assert.equal(reordered.stages[1].format, "image");
  assert.deepEqual(productionWorkflowIssues(reordered), []);
  const story = result.stages.find((stage) => stage.format === "short_story");
  assert.equal(moveProductionWorkflowStage(result, story.id, 1), result);
  assert.equal(moveProductionWorkflowStage(result, result.stages.at(-1).id, -1), result);
});

test("exact source identity changes when source revision, digest, or explicit audio guidance changes", () => {
  const initial = artifactSource("short_story", "event-4");
  assert.notDeepEqual(productionWorkflowSourceIdentity([initial]), productionWorkflowSourceIdentity([{ ...initial, revision: 1 }]));
  assert.notDeepEqual(productionWorkflowSourceIdentity([initial]), productionWorkflowSourceIdentity([{ ...initial, contentSha256: "b".repeat(64) }]));
  assert.notDeepEqual(productionWorkflowSourceIdentity([initial]), productionWorkflowSourceIdentity([{ ...initial, allowTextGuidance: true }]));
});

test("the real worker rejects forged inputs and completes a non-mutating, source-grounded production stage", async () => {
  const root = new URL("../", import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const local = typeof context.parentURL === "string" && context.parentURL.startsWith(root) && !context.parentURL.includes("/node_modules/");
      return next(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? `${specifier}.ts` : specifier, context);
    },
  });
  const { default: worker } = await import("../worker/index.ts").finally(() => hooks.deregister());
  const { sqlite, DB } = workflowDatabase();
  const background = [];
  const env = { DB, OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-5.6-terra", ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, MEDIA: {} };
  const request = (path, body) => worker.fetch(new Request(`http://localhost${path}`, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : {}), env, { waitUntil(promise) { background.push(promise); } });

  await request("/api/session");
  sqlite.prepare("UPDATE users SET consent_version='pilot-2026-08-10'").run();
  const initial = await (await request("/api/events?after=0&limit=1000&content=0")).json();
  const document = foldEvents(initial.events, Number.POSITIVE_INFINITY, "doc-atmosphere", "project-atmosphere");
  const sourceVersions = document.blocks.map((block) => ({ block_id: block.id, version: block.sourceEvents.length }));
  const owner = "dev-local-creative", stream = `creative:${owner}`, now = new Date().toISOString();
  const sourceDocument = {
    title: "Approved production source", summary: "Original narrative", content_markdown: "UNIQUE_WORKFLOW_NARRATIVE_48291",
    presentation: null, items: [{ title: "The entrance", body: "UNIQUE_WORKFLOW_NARRATIVE_48291", notes: "", image_prompt: "", context_group_ids: [], slide: null }],
  };
  const content = JSON.stringify(sourceDocument);
  sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run("workflow-story-content", owner, "document-artifact", content, now, "9999-12-31T23:59:59.999Z");
  const sequence = Number(sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(stream).head) + 1;
  sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("workflow-story-event", stream, sequence, now, now, "worker:renderer", "test", "workflow-test", null, null, 1, "DocumentRenderCompleted", JSON.stringify({
      project_id: document.projectId, document_id: document.documentId, artifact_id: "workflow-source-story", artifact_kind: "short_story",
      title: sourceDocument.title, summary: sourceDocument.summary, item_count: 1, items: [{ id: "beat", title: "The entrance" }],
      content_ref: "workflow-story-content", source_block_versions: sourceVersions,
    }));

  const production = recommendProductionWorkflow({ id: "workflow-live", documentId: document.documentId, projectId: document.projectId, target: "scene" });
  const step = production.stages[0];
  step.enabled = true;
  step.source = {
    outputKind: "artifact", outputId: "workflow-source-story", format: "short_story", documentId: document.documentId,
    sourceEventId: "workflow-story-event", revision: 0, contentSha256: createHash("sha256").update(content).digest("hex"),
    approvalRequired: false, allowTextGuidance: false,
  };
  const configured = await request("/api/events", { action: "append", event: { type: DOCUMENT_PRODUCTION_WORKFLOW_EVENT, payload: {
    workflow_id: production.id, document_id: production.documentId, project_id: production.projectId, target_kind: production.target, workflow: production,
  } } });
  assert.equal(configured.status, 200);
  const admission = {
    kind: "render_document", documentId: document.documentId, sourceSurface: `workflow:${production.id}:scene-final`,
    payload: { artifactKind: "scene", sceneRequestId: "workflow-e2e-scene-request", productionMode: "manual", itemCount: 1, requestKey: "workflow-e2e", workflowId: production.id, workflowStageId: "scene-final", workflowSources: [step.source] },
  };
  const rejected = await request("/api/document-jobs", { ...admission, payload: {
    ...admission.payload, sceneCostPreview: true, workflowSources: [{ ...step.source, media_url: "/api/media/private" }],
  } });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "workflow_source_untrusted");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count), 0);
  const invalidSceneMedium = await request("/api/document-jobs", {
    kind: "render_document", documentId: document.documentId,
    payload: { artifactKind: "scene", productionMode: "manual", sceneMedium: "radio" },
  });
  assert.equal(invalidSceneMedium.status, 400);
  assert.equal((await invalidSceneMedium.json()).error, "scene_medium_invalid");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count), 0);

  const imageWorkflow = recommendProductionWorkflow({ id: "workflow-image-live", documentId: document.documentId, projectId: document.projectId, target: "image" });
  imageWorkflow.stages[0].enabled = true;
  imageWorkflow.stages[0].source = step.source;
  assert.equal((await request("/api/events", { action: "append", event: { type: DOCUMENT_PRODUCTION_WORKFLOW_EVENT, payload: {
    workflow_id: imageWorkflow.id, document_id: imageWorkflow.documentId, project_id: imageWorkflow.projectId, target_kind: "image", workflow: imageWorkflow,
  } } })).status, 200);

  const providerRequests = [];
  const moderationRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const requestBody = JSON.parse(String(init.body));
    if (String(url).includes("/moderations")) {
      moderationRequests.push(requestBody);
      return Response.json({ model: "omni-moderation-latest", results: [{ flagged: true, categories: { violence: true }, category_scores: { violence: 0.95 } }] });
    }
    providerRequests.push(requestBody);
    return Response.json({
      id: `response-workflow-e2e-${providerRequests.length}`, model: "gpt-5.6-terra", usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
      output_text: JSON.stringify({ title: "Finished scene", summary: "One cinematic moment", content_markdown: "INT. QUIET ROOM - DUSK.", presentation: null,
        items: [{ title: "Entrance", body: "INT. QUIET ROOM. Enter.", notes: "Quiet.", image_prompt: "", context_group_ids: [], slide: null }] }),
    });
  };
  try {
    const risk = await request("/api/generation-readiness", {
      kind: "generate", documentId: document.documentId, requestKey: "workflow-image-risk", workflowId: imageWorkflow.id,
      workflowStageId: "image-final", workflowSources: [step.source],
    });
    assert.equal(risk.status, 200);
    assert.equal((await risk.json()).readiness.status, "review");
    assert.equal(moderationRequests.length, 1);
    assert.match(JSON.stringify(moderationRequests[0]), /UNIQUE_WORKFLOW_NARRATIVE_48291/);
    assert.doesNotMatch(JSON.stringify(moderationRequests[0]), /workflow-story-content/);
    const unacknowledged = await request("/api/document-jobs", {
      kind: "generate", documentId: document.documentId, sourceSurface: `workflow:${imageWorkflow.id}:image-final`,
      payload: { requestKey: "workflow-image-risk", workflowId: imageWorkflow.id, workflowStageId: "image-final", workflowSources: [step.source] },
    });
    assert.equal(unacknowledged.status, 428);
    assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count), 0);

    const confirmScene = async (candidate) => {
      const inspection = await request("/api/document-jobs", { ...candidate, payload: { ...candidate.payload, sceneCostPreview: true } });
      assert.equal(inspection.status, 200, await inspection.clone().text());
      const inspected = await inspection.json();
      assert.equal(inspected.providerCalls, 0); assert.equal(inspected.reservations, 0);
      return { ...candidate, payload: { ...candidate.payload, sceneCostConsent: { ...inspected.sceneCostPreview, confirmed: true } } };
    };
    const response = await request("/api/document-jobs", await confirmScene(admission));
    assert.equal(response.status, 202);
    const { job } = await response.json();
    const persisted = JSON.parse(sqlite.prepare("SELECT request_json FROM document_jobs WHERE job_id=?").get(job.jobId).request_json);
    assert.ok(persisted.snapshot.facts.every((fact) => !String(fact.block_id).startsWith("workflow:")));
    assert.deepEqual(persisted.sceneConfiguration, {
      medium: "visual", source: "production-path", targetFormat: "scene", downstreamFormats: ["scene"], alternateMedium: "audio",
    });
    assert.equal(persisted.sceneMedium, "visual");
    assert.equal(job.result.generationReceipt.settings.scene_medium, "visual");
    const authoredSnapshotHash = job.result.generationReceipt.source_snapshot_sha256;
    assert.equal((await request(`/api/document-jobs/${job.jobId}/run`, {})).status, 200);
    while (background.length) await Promise.all(background.splice(0));
    assert.equal(sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(job.jobId).status, "completed");
    assert.equal(providerRequests.length, 1);
    assert.match(JSON.stringify(providerRequests[0]), /UNIQUE_WORKFLOW_NARRATIVE_48291/);
    assert.doesNotMatch(JSON.stringify(providerRequests[0]), /workflow-story-content/);
    assert.equal(JSON.parse(providerRequests[0].input).scene_configuration.medium, "visual");

    const events = (await (await request("/api/events?after=0&limit=1000&content=0")).json()).events;
    const completed = events.find((entry) => entry.type === "DocumentRenderCompleted" && entry.payload.workflow_id === production.id);
    assert.equal(completed.payload.workflow_stage_id, "scene-final");
    assert.equal(completed.payload.scene_medium, "visual");
    assert.equal(completed.payload.settings.scene_medium, "visual");
    assert.equal(completed.payload.settings.scene_configuration.alternateMedium, "audio");
    assert.match(completed.payload.settings.scene_context_fingerprint, /^[a-f0-9]{64}$/u);
    const finalDocument = foldEvents(events, Number.POSITIVE_INFINITY, document.documentId, document.projectId);
    assert.equal(finalDocument.blocks.length, document.blocks.length);
    assert.equal(productionWorkflowStageStates(production, finalDocument, events).at(-1).status, "complete");

    const sonicProduction = recommendProductionWorkflow({
      id: "workflow-audio-live", documentId: document.documentId, projectId: document.projectId, target: "audio",
    });
    const sonicStory = sonicProduction.stages.find((stage) => stage.format === "short_story");
    sonicStory.enabled = true;
    sonicStory.source = step.source;
    const sonicScene = sonicProduction.stages.find((stage) => stage.format === "scene");
    sonicScene.enabled = true;
    const sonicConfigured = await request("/api/events", {
      action: "append", event: { type: DOCUMENT_PRODUCTION_WORKFLOW_EVENT, payload: {
        workflow_id: sonicProduction.id, document_id: document.documentId, project_id: document.projectId,
        target_kind: sonicProduction.target, workflow: sonicProduction,
      } },
    });
    assert.equal(sonicConfigured.status, 200);

    const sonicResponse = await request("/api/document-jobs", await confirmScene({
      kind: "render_document", documentId: document.documentId, sourceSurface: `workflow:${sonicProduction.id}:${sonicScene.id}`,
      payload: {
        artifactKind: "scene", sceneRequestId: "workflow-audio-scene-request", productionMode: "manual", itemCount: 1, requestKey: "workflow-audio-e2e",
        sceneMedium: "visual", workflowId: sonicProduction.id, workflowStageId: sonicScene.id, workflowSources: [step.source],
      },
    }));
    assert.equal(sonicResponse.status, 202);
    const { job: sonicJob } = await sonicResponse.json();
    const sonicPersisted = JSON.parse(sqlite.prepare("SELECT request_json FROM document_jobs WHERE job_id=?").get(sonicJob.jobId).request_json);
    assert.equal(sonicPersisted.sceneMedium, "audio", "the authoritative downstream goal overrides an untrusted visual request");
    assert.deepEqual(sonicPersisted.sceneConfiguration, {
      medium: "audio", source: "production-path", targetFormat: "audio", downstreamFormats: ["audio"], alternateMedium: "visual",
    });
    assert.equal(sonicJob.result.generationReceipt.settings.scene_medium, "audio");
    assert.equal(sonicJob.result.generationReceipt.source_snapshot_sha256, authoredSnapshotHash, "both scene variants retain the same authored source context");

    assert.equal((await request(`/api/document-jobs/${sonicJob.jobId}/run`, {})).status, 200);
    while (background.length) await Promise.all(background.splice(0));
    assert.equal(sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(sonicJob.jobId).status, "completed");
    assert.equal(providerRequests.length, 2);
    const sonicProviderInput = JSON.parse(providerRequests[1].input);
    assert.equal(sonicProviderInput.scene_configuration.medium, "audio");
    assert.equal(sonicProviderInput.scene_configuration.alternate_medium, "visual");
    assert.equal(sonicProviderInput.scene_configuration.alternate_rendering.preserve_authored_context, true);
    assert.match(JSON.stringify(sonicProviderInput.creative_context), /UNIQUE_WORKFLOW_NARRATIVE_48291/);
    assert.doesNotMatch(JSON.stringify(sonicProviderInput), /workflow-story-content/);

    const sonicEvents = (await (await request("/api/events?after=0&limit=1000&content=0")).json()).events;
    const sonicCompleted = sonicEvents.find((entry) => entry.type === "DocumentRenderCompleted" && entry.payload.workflow_id === sonicProduction.id);
    assert.equal(sonicCompleted.payload.scene_medium, "audio");
    assert.equal(sonicCompleted.payload.settings.scene_medium, "audio");
    assert.equal(sonicCompleted.payload.settings.scene_configuration.targetFormat, "audio");
    assert.equal(sonicCompleted.payload.settings.scene_configuration.alternateMedium, "visual");
    assert.match(sonicCompleted.payload.settings.scene_context_fingerprint, /^[a-f0-9]{64}$/u);

    const sonicRetained = JSON.parse(sqlite.prepare("SELECT content FROM private_content WHERE content_id=?")
      .get(sonicCompleted.payload.input_ref).content);
    assert.equal(sonicRetained.request.scene_medium, "audio");
    assert.equal(sonicRetained.request.scene_configuration.alternateMedium, "visual");
    assert.equal(sonicRetained.request.scene_context_continuity.source_snapshot_sha256,
      sonicCompleted.payload.settings.scene_context_fingerprint);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workflow ownership, safety, responsive layout, and localization stay integrated with Forma", async () => {
  const [ui, styles, store, events, jobs, projectAccess, english, french, arabic, japanese] = await Promise.all([
    "../src/components/document-artifacts.ts",
    "../src/styles.css",
    "../src/state/store.ts",
    "../worker/events-api.ts",
    "../worker/document-jobs-api.ts",
    "../worker/project-access.ts",
    "../src/components/design-system/localization.ts",
    "../src/components/design-system/locales/fr.ts",
    "../src/components/design-system/locales/ar.ts",
    "../src/components/design-system/locales/ja.ts",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  assert.match(ui, /production-workflow/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /productionWorkflowStageStates/);
  assert.match(ui, /productionWorkflowSceneConfiguration/);
  assert.match(ui, /<ol class="production-workflow-stages"/);
  assert.match(ui, /<fieldset class="artifact-scene-medium"/);
  assert.match(ui, /production-workflow-scene-medium/);
  assert.match(ui, /sceneMedium:sceneConfiguration\.medium/);
  assert.match(ui, /scene_configuration\.alternateMedium|sceneConfiguration\.alternateMedium/);
  assert.match(ui, /allowTextGuidance/);
  assert.match(ui, /#bindCompletedWorkflowStage\(\).*?event\.type==="DocumentRenderCompleted"/s);
  assert.match(ui, /stage\.format!=="image"&&!stage\.source/);
  assert.match(ui, /#prepareRetry\(kind,job\)/);
  assert.match(styles, /\.production-workflow/);
  assert.match(styles, /\.production-workflow-stage/);
  assert.match(styles, /\.artifact-scene-medium\s*\{/);
  assert.match(styles, /\.artifact-scene-medium\s*>\s*label\s*>\s*input\[type="radio"\]/);
  assert.match(store, /workflowSources/);
  assert.match(store, /sceneRequestId/);
  assert.match(store, /sceneCostRequestHash/);
  assert.match(store, /captureSceneCostSource/);
  assert.match(store, /sceneCostApprovalMatches/);
  assert.match(events, /DocumentProductionWorkflowConfigured/);
  assert.match(events, /scene_context_fingerprint/);
  assert.match(jobs, /resolveProductionWorkflowContext/);
  assert.match(jobs, /sceneConfigurationFromRequest/);
  assert.match(projectAccess, /DocumentProductionWorkflowConfigured/);
  for (const catalog of [english, french, arabic, japanese]) {
    assert.match(catalog, /"workflow\.heading"/);
    for (const medium of ["auto", "visual", "audio"]) assert.match(catalog, new RegExp(`"scene\\.medium\\.${medium}"`));
    for (const medium of ["visual", "audio"]) assert.match(catalog, new RegExp(`"scene\\.variant\\.${medium}"`));
  }
});

test("workflow guarantees retain their natural height when compact and mobile footers stack", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const footer = styles.match(/^\.production-workflow-footer\s*\{([^}]*)\}/m)?.[1] ?? "";
  const guarantee = styles.match(/^\.production-workflow-footer\s*>\s*small\s*\{([^}]*)\}/m)?.[1] ?? "";
  const compactFooter = styles.match(/^\.production-workflow--compact\s+\.production-workflow-footer\s*\{([^}]*)\}/m)?.[1] ?? "";
  const mobileRules = styles.match(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
  const mobileFooter = mobileRules.match(/^\s*\.production-workflow-footer\s*\{([^}]*)\}/m)?.[1] ?? "";

  assert.match(footer, /display:\s*flex/);
  assert.match(guarantee, /min-inline-size:\s*0/);
  assert.match(guarantee, /flex:\s*1\s+1\s+auto/);
  assert.match(guarantee, /overflow-wrap:\s*break-word/);
  assert.doesNotMatch(guarantee, /flex(?:-basis)?:[^;]*\b\d+(?:\.\d+)?(?:rem|em|px|vh|vb|%)/);
  assert.doesNotMatch(guarantee, /overflow-wrap:\s*anywhere/);
  assert.match(compactFooter, /flex-direction:\s*column/);
  assert.match(mobileFooter, /flex-direction:\s*column/);
  assert.match(styles, /^\.production-workflow--compact\s+\.production-workflow-footer\s*>\s*\.button\s*\{[^}]*inline-size:\s*100%/m);
  assert.match(mobileRules, /^\s*\.production-workflow-footer\s*>\s*\.button\s*\{[^}]*inline-size:\s*100%/m);
});
