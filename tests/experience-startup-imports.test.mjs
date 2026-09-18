import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import test from "node:test";
import ts from "typescript";
import { referenceCompositionMediaUrl } from "../src/model/reference-composition-media-url.ts";
import { referenceCompositionMediaUrl as publicMediaUrl } from "../src/model/reference-composition.ts";

const root = new URL("../", import.meta.url);

// Follow only eager runtime imports after TypeScript erases type-only bindings.
// Dynamic imports belong to the later activated app, outside setup startup.
async function startupGraph() {
  const local = new Set(), packages = new Set();
  async function visit(url) {
    const path = url.href.slice(root.href.length);
    if (local.has(path)) return;
    assert.ok(url.href.startsWith(root.href), "A startup import must stay within the checkout");
    local.add(path);
    if (extname(url.pathname) === ".css") return;
    const raw = await readFile(url, "utf8");
    const emitted = ts.transpileModule(raw, { compilerOptions: {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true,
    } }).outputText;
    const source = ts.createSourceFile(path, emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const node of source.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
      assert.ok(ts.isStringLiteral(node.moduleSpecifier));
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith(".")) { packages.add(specifier); continue; }
      const next = new URL(specifier, url);
      if (!extname(next.pathname)) next.pathname += ".ts";
      await visit(next);
    }
  }
  await visit(new URL("src/experiences/entry.ts", root));
  return { local, packages };
}

test("setup retains its locale and validation modules without eagerly importing the full artifact graph", async () => {
  const { local, packages } = await startupGraph();
  assert.ok(local.has("src/model/reference-composition-media-url.ts"));
  assert.ok(local.has("src/experiences/display-locale.ts"));
  assert.ok(local.has("src/experiences/display-messages.ts"));
  for (const path of [
    "src/model/reference-composition.ts", "src/model/context-health.ts",
    "src/model/document-artifacts.ts", "src/model/audio.ts", "src/model/model3d.ts",
  ]) assert.ok(!local.has(path), `${path} must not enter the eager setup graph`);
  assert.ok(![...packages].some(name => name === "three" || name.startsWith("three/")));
});

test("the public composition API retains the same private-media route validator", () => {
  assert.equal(publicMediaUrl, referenceCompositionMediaUrl);
  for (const [input, expected] of [
    ["/api/media/user/path.png", "/api/media/user%2Fpath.png"],
    ["/api/media/user%2fpath.png", "/api/media/user%2Fpath.png"],
    ["/api/media/caf%C3%A9.png", "/api/media/caf%C3%A9.png"],
    ["/api/media/" + "a".repeat(2048), "/api/media/" + "a".repeat(2048)],
    ["/api/media/" + "a".repeat(2049), null],
    [null, null], [undefined, null], [12, null], [{}, null],
    ["https://example.test/image.png", null], ["//example.test/image.png", null],
    ["/api/media/", null], ["/api/media/../secret", null], ["/api/media/%2e%2e%2fsecret", null],
    ["/api/media/a/./b", null], ["/api/media/%5csecret", null], ["/api/media/%00secret", null],
    ["/api/media/a?redirect=other", null], ["/api/media/a#fragment", null], ["/api/media/a b", null],
    ["/api/media/%not-encoded", null],
  ]) assert.equal(referenceCompositionMediaUrl(input), expected, String(input));
});
