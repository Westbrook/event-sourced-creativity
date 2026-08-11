import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";

test("keeps Creative Editor exclusions negative from authoring through generation", async () => {
  const [editor, store, adapter, styles] = await Promise.all([
    readFile(new URL("../src/components/forma-creative-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/openai-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /semantic_role: "negative_constraint"/);
  assert.match(editor, /Must not include:/);
  assert.match(editor, /negative constraint/);
  assert.match(editor, /How strictly should it be excluded/);
  assert.match(editor, /Prefer avoiding/);
  assert.match(editor, /Never include/);
  assert.match(store, /type: b\.type/);
  assert.match(store, /effect: b\.type === "exclusion" \? "must_not_include"/);
  assert.match(adapter, /must_not_include is a negative constraint/);
  assert.match(adapter, /must not become the subject/);
  assert.match(styles, /\.creative-editor-item\.negative-constraint/);
  assert.match(editor, /previewOutdated/);
  assert.match(editor, /Plan changed since this preview/);
  assert.match(editor, /Update preview/);
  assert.match(editor, /Role in the plan/);
  assert.match(editor, /\?selected=\$\{item\.type === this\.#newType\}/);
  assert.match(editor, /property_path: "type"/);
});

test("replays correction of a misclassified Subject into an Avoid guardrail", () => {
  const base = { streamId: "s", occurredAt: "2026-08-11T12:00:00.000Z", recordedAt: "2026-08-11T12:00:00.000Z", actor: "user", clientId: "web:test", correlationId: "c", causationId: null, compensatesEventId: null, schemaVersion: 1 };
  const projection = foldEvents([
    { ...base, eventId: "e1", sequence: 1, type: "DocumentCreated", payload: { document_id: "d", title: "Study" } },
    { ...base, eventId: "e2", sequence: 2, type: "BlockCreated", payload: { block_id: "b", document_id: "d", type: "subject", handle: "subject/people-under-20", position: "a0", properties: { text: "people under 20 years old" } } },
    { ...base, eventId: "e3", sequence: 3, type: "BlockPropertyEdited", payload: { block_id: "b", property_path: "type", old_value: "subject", new_value: "exclusion" } },
  ]);
  assert.equal(projection.blocks[0].type, "exclusion");
  assert.equal(projection.blocks[0].properties.text, "people under 20 years old");
});
