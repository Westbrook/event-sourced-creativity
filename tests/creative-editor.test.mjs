import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";
import { blockEffectFor, blockIntentFor } from "../src/model/block-types.ts";

test("keeps Creative Editor role and intent independent through generation", async () => {
  const [editor, store, adapter, styles] = await Promise.all([
    readFile(new URL("../src/components/forma-creative-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/openai-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /intent: this\.#newIntent/);
  assert.match(editor, /semantic_role: "negative_constraint"/);
  assert.match(editor, /Must not include:/);
  assert.match(editor, /negative .* constraint/);
  assert.match(editor, /How strongly should this guardrail apply/);
  assert.match(editor, /Role in the plan/);
  assert.match(editor, /Intent/);
  assert.match(editor, /#openCreate\(tool\.type, tool\.intent\)/);
  assert.match(store, /type: b\.type/);
  assert.match(store, /intent: blockIntentFor\(b\.type, b\.properties\)/);
  assert.match(store, /effect: blockEffectFor\(b\.type, b\.properties\)/);
  assert.match(adapter, /effect is must_not_include/);
  assert.match(adapter, /intent is avoid or prohibit/);
  assert.match(adapter, /apply the prohibition to its named role/);
  assert.match(styles, /\.creative-editor-item\.negative-constraint/);
  assert.match(editor, /previewOutdated/);
  assert.match(editor, /Plan changed since this image/);
  assert.match(editor, /Update image/);
  assert.match(editor, /\?selected=\$\{item\.type === this\.#newType\}/);
  assert.match(editor, /property_path: "type"/);
  assert.match(editor, /property_path: "intent"/);
  const properties = { text: "people under 20 years old", intent: "avoid" };
  assert.equal(blockIntentFor("subject", properties), "avoid");
  assert.equal(blockEffectFor("subject", properties), "must_not_include");
  assert.equal(blockEffectFor("exclusion", {}), "must_not_include");
});

test("replays an Avoid intent without erasing the Subject role", () => {
  const base = { streamId: "s", occurredAt: "2026-08-11T12:00:00.000Z", recordedAt: "2026-08-11T12:00:00.000Z", actor: "user", clientId: "web:test", correlationId: "c", causationId: null, compensatesEventId: null, schemaVersion: 1 };
  const projection = foldEvents([
    { ...base, eventId: "e1", sequence: 1, type: "DocumentCreated", payload: { document_id: "d", title: "Study" } },
    { ...base, eventId: "e2", sequence: 2, type: "BlockCreated", payload: { block_id: "b", document_id: "d", type: "subject", handle: "subject/people-under-20", position: "a0", properties: { text: "people under 20 years old" } } },
    { ...base, eventId: "e3", sequence: 3, type: "BlockPropertyEdited", payload: { block_id: "b", property_path: "intent", old_value: "include", new_value: "avoid" } },
  ]);
  assert.equal(projection.blocks[0].type, "subject");
  assert.equal(projection.blocks[0].properties.intent, "avoid");
  assert.equal(projection.blocks[0].properties.text, "people under 20 years old");
});
