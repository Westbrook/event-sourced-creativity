import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
});
