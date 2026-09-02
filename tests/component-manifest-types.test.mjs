import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { portableManifestType } from "../scripts/lib/component-manifest-types.mjs";

test("manifest type imports are independent of the checkout location", () => {
  const expected = 'import("./src/model/workspace-intelligence").CreativeActionScope & { kind: "configure" }';
  for (const root of ["/work/first", "/another checkout/second"]) {
    const input = `import(${JSON.stringify(root + "/src/model/workspace-intelligence")}).CreativeActionScope & { kind: "configure" }`;
    assert.equal(portableManifestType(input, root), expected);
  }
});

test("manifest type imports preserve escaped path characters", () => {
  const root = '/work/a"quoted checkout';
  const input = `import(${JSON.stringify(root + '/src/a"module')}).Value`;
  assert.equal(portableManifestType(input, root), `import(${JSON.stringify('./src/a"module')}).Value`);
});

test("manifest type imports support Windows compiler paths", () => {
  const root = "C:\\work\\forma";
  assert.equal(portableManifestType(`import(${JSON.stringify(root + "\\src\\model")}).Value`, root), 'import("./src/model").Value');
  assert.equal(portableManifestType('import("C:/work/forma/src/model").Value', root), 'import("./src/model").Value');
});

test("manifest types normalize every local import without changing the type contract", () => {
  assert.equal(portableManifestType('import("/work/app/src/a").A | import("/work/app/src/b").B', "/work/app/"),
    'import("./src/a").A | import("./src/b").B');
});

test("manifest types do not reinterpret package imports or sibling directory prefixes", () => {
  for (const text of ['import("lit").TemplateResult', 'import("./relative").Value', 'import("/work/app-other/src/a").Value', '"/work/app/src/a" | null', 'unknown']) {
    assert.equal(portableManifestType(text, "/work/app"), text);
  }
});

test("import-shaped literal text is not a type import", () => {
  const typeWithLiteralKey = "{ " + JSON.stringify('import("/work/app/src/a")') + ": boolean }";
  for (const text of ['`import("/work/app/src/a")${number}`', '\'import("/work/app/src/a")\'', typeWithLiteralKey]) {
    assert.equal(portableManifestType(text, "/work/app"), text);
  }
});

test("real imports inside template substitutions are still portable", () => {
  assert.equal(portableManifestType('`prefix${import("/work/app/src/a").Value}`', "/work/app"),
    '`prefix${import("./src/a").Value}`');
});

test("compiler string escapes use TypeScript parsing rather than JSON decoding", () => {
  assert.equal(portableManifestType('import("/work/a\\vroot/src/a").Value', "/work/a\vroot"), 'import("./src/a").Value');
  assert.equal(portableManifestType("import('/work/app/src/a').Value", "/work/app"), 'import("./src/a").Value');
});

test("generated component manifests expose no absolute type imports and remain identical", () => {
  const canonical = readFileSync(new URL("../custom-elements.json", import.meta.url), "utf8");
  assert.equal(readFileSync(new URL("../public/custom-elements.json", import.meta.url), "utf8"), canonical);
  let checked = 0;
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (typeof value.text === "string") {
      assert.doesNotMatch(value.text, /\bimport\("(?:\/|[A-Za-z]:)/u);
      checked += 1;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(JSON.parse(canonical));
  assert.ok(checked > 100, "check the actual generated component type inventory");
});
