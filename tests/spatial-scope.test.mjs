import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";
import { buildScenario, explainReplayEvent } from "../src/model/scenarios.ts";
import { formatSpatialPath, normalizeSpatialScope, parseSpatialPath, spatialScopeLabel } from "../src/model/spatial-scope.ts";

test("normalizes document, fuzzy, rectangular, subject-relative, and clipping-path targets", () => {
  assert.equal(normalizeSpatialScope(undefined).kind, "document");
  assert.equal(spatialScopeLabel({ kind: "region", region: "custom", instruction: "the quiet area on the right" }), "the quiet area on the right");
  const box = normalizeSpatialScope({ kind: "aabb", aabb: { x: -.2, y: .1, width: 1.4, height: .5 }, feather: 2 });
  assert.deepEqual(box.aabb, { x: 0, y: .1, width: 1, height: .5 });
  assert.equal(box.feather, 1);
  const subject = normalizeSpatialScope({ kind: "subject", subject_block_id: "block-subject", subject_relation: "behind" });
  assert.equal(subject.subject_block_id, "block-subject");
  assert.equal(spatialScopeLabel(subject, "lead figure"), "behind lead figure");
  const path = parseSpatialPath("10,20 90,20 70,80");
  assert.equal(path.length, 3);
  assert.equal(formatSpatialPath(path), "10,20 90,20 70,80");
});

test("replays spatial scope as ordinary durable block state", () => {
  const base = {
    eventId: "event-1", streamId: "stream-1", sequence: 1, occurredAt: "2026-08-11T12:00:00.000Z", recordedAt: "2026-08-11T12:00:00.000Z", actor: "user", clientId: "web:test", correlationId: "corr-1", causationId: null, compensatesEventId: null, schemaVersion: 1,
  };
  const events = [
    { ...base, type: "DocumentCreated", payload: { document_id: "doc-1", title: "Spatial study" } },
    { ...base, eventId: "event-2", sequence: 2, type: "BlockCreated", payload: { block_id: "block-1", document_id: "doc-1", type: "lighting", handle: "lighting/edge", position: "a0", properties: { text: "Hold the right edge in warm light" } } },
    { ...base, eventId: "event-3", sequence: 3, type: "BlockPropertyEdited", payload: { block_id: "block-1", property_path: "spatial_scope", old_value: normalizeSpatialScope(undefined), new_value: normalizeSpatialScope({ kind: "region", region: "right", falloff: "contextual", feather: .2 }) } },
  ];
  const projection = foldEvents(events);
  assert.equal(projection.blocks[0].properties.spatial_scope.kind, "region");
  assert.equal(projection.blocks[0].properties.spatial_scope.region, "right");
});

test("offers the same durable targeting capability through every document lens", async () => {
  const [scopeModel, scopeEditor, contextBlock, boardAndGuided, layersAndAdaptive, creativeEditor, store] = await Promise.all([
    readFile(new URL("../src/model/spatial-scope.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/spatial-scope-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/context-block.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-studio-alternatives.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-studio-editor-alternatives.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-creative-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
  ]);
  for (const method of ["document", "region", "aabb", "subject", "path"]) assert.match(scopeEditor, new RegExp(`id: "${method}"`));
  assert.match(scopeModel, /coordinate_space/);
  for (const property of ["spatial_scope", "feather", "falloff", "polarity", "subject_block_id"]) assert.match(scopeEditor, new RegExp(property));
  assert.match(contextBlock, /surface=\$\{this\.surface\}/);
  assert.match(boardAndGuided, /surface="board"/); assert.match(boardAndGuided, /surface="guided"/);
  assert.match(layersAndAdaptive, /surface="layers"/); assert.match(layersAndAdaptive, /surface="adaptive"/);
  assert.match(creativeEditor, /surface="editor"/);
  assert.match(store, /spatial_scope: normalizeSpatialScope/);
});

test("the replay laboratory demonstrates every spatial target and explains a targeting edit specifically", () => {
  const events = buildScenario("document-evolution", 1000);
  const kinds = new Set(events.filter((event) => event.type === "BlockCreated").map((event) => event.payload.properties?.spatial_scope?.kind));
  assert.deepEqual(kinds, new Set(["document", "region", "aabb", "subject", "path"]));
  const edit = events.find((event) => event.type === "BlockPropertyEdited" && event.payload.property_path === "spatial_scope");
  assert.ok(edit);
  const story = explainReplayEvent(edit);
  assert.match(story.action, /specific part/);
  assert.match(story.trigger, /Affects control/);
  assert.match(story.value, /normalized region/);
  const compile = events.find((event) => event.type === "ContextCompiled");
  assert.ok(compile?.payload.compiled_snapshot.spatial_targets.length >= 2);
});
