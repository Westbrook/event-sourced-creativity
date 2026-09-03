// Actual shape predicate only. No Store, transport, receipt method or native fixture runs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { outputRequirementEditableDraft, readOutputArtifactFormat } from "../src/model/output-requirements.ts";
import { compileOutputPlan, initialOutputTargetState, summarizeOutputPlan } from "../src/model/output-plan.ts";

const source = await readFile(new URL("../src/state/store.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const matches = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "outputSnapshotRenderable");
assert.equal(matches.length, 1, "extract exactly the actual uniquely named shape predicate");
const declaration = matches[0];
const imports = parsed.statements.filter(node => ts.isImportDeclaration(node)
  && /\/output-requirements(?:\.ts)?$/u.test(node.moduleSpecifier.text));
assert.equal(imports.length, 1);
const imported = imports[0].importClause?.namedBindings;
assert.ok(imported && ts.isNamedImports(imported));
for (const name of ["outputRequirementEditableDraft", "readOutputArtifactFormat"])
  assert.ok(imported.elements.some(element => element.name.text === name && !element.propertyName), name);

// Fail on an unexpected value dependency instead of supplying a permissive stub.
const bound = new Set(["outputSnapshotRenderable"]), referenced = new Set();
function bindings(name) {
  if (ts.isIdentifier(name)) bound.add(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
    for (const item of name.elements) if (ts.isBindingElement(item)) bindings(item.name);
}
function visit(node) {
  if (ts.isTypeNode(node)) return;
  if (ts.isVariableDeclaration(node) || ts.isParameter(node)) bindings(node.name);
  if (ts.isIdentifier(node)) {
    const parent = node.parent;
    const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node
      || ts.isPropertyAssignment(parent) && parent.name === node;
    if (!propertyName) referenced.add(node.text);
  }
  ts.forEachChild(node, visit);
}
visit(declaration);
assert.deepEqual([...referenced].filter(name => !bound.has(name)).sort(),
  ["Array", "Boolean", "Number", "Object", "outputRequirementEditableDraft", "readOutputArtifactFormat", "undefined"].sort());
const compiled = ts.transpileModule(declaration.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
});
assert.deepEqual((compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
const accepts = new Function("outputRequirementEditableDraft", "readOutputArtifactFormat",
  `${compiled.outputText}; return outputSnapshotRenderable;`)(outputRequirementEditableDraft, readOutputArtifactFormat);

function snapshot(qualified = true) {
  const spec = { schema_version: 1, id: "story", label: "Story", original_text: "One story.",
    deliverables: [{ id: "story-item", label: "Story", media_kind: "document", required: true,
      ...(qualified ? { artifact_format: { kind: "short_story", version: 1 } } : {}),
      quantity: { kind: "exact", unit: "document", value: 1 }, source_scope: { kind: "document" },
      coverage: { kind: "document_context" }, original_text: "One story.", value_origins: {} }],
    value_origins: { interpretation_basis: { kind: "confirmed", text: "One story." } } };
  const plan = compileOutputPlan([spec], { document_id: "doc", source_revision: "source", requirement_revision: "requirements" });
  const states = plan.targets.map(target => initialOutputTargetState(target));
  return { schemaVersion: 1, documentId: "doc", projectId: "project", revision: "revision",
    requirementRevision: "requirements", sourceRevision: "source",
    scope: { kind: "personal", actorUserId: "actor", organizationId: null, projectAccessId: null },
    permissions: { canAuthor: false, canRequest: false, canReview: false, canDownload: false, independentReview: false },
    capabilities: { nativeGeneration: false, ownedFileAdoption: false, supportedFileExtensions: [], limitations: [] },
    requirements: [{ blockId: "story", subtype: "Document", content: spec.original_text,
      locked: false, status: "valid", spec, issues: [] }],
    confirmedPlan: { id: "plan", revisionId: "plan-1", confirmedAt: "2026-09-02T00:00:00.000Z",
      requirementsDigest: "requirements-digest", sourceDigest: "source-digest", revision: 1, plan },
    targetStates: states, summary: summarizeOutputPlan(plan, states), assets: [], results: [], grants: [] };
}
const records = value => [value.requirements[0].spec.deliverables[0],
  ...value.confirmedPlan.plan.groups, ...value.confirmedPlan.plan.obligations, ...value.confirmedPlan.plan.targets];
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test("actual retained shape guard accepts explicit format without changing input or legacy absence", () => {
  for (const qualified of [false, true]) {
    const value = snapshot(qualified), before = structuredClone(value), bytes = JSON.stringify(value);
    assert.equal(accepts(freeze(value)), true);
    assert.deepEqual(value, before); assert.equal(JSON.stringify(value), bytes);
    assert.ok(records(value).every(row => Object.hasOwn(row, "artifact_format") === qualified));
    assert.equal(value.capabilities.nativeGeneration, false);
  }
});

for (const location of ["groups", "obligations", "targets"]) {
  test(`actual retained shape guard rejects non-data or hidden ${location} format without invoking accessors`, () => {
    const value = snapshot(), entry = value.confirmedPlan.plan[location][0];
    let calls = 0;
    const get = () => { calls++; return { kind: "short_story", version: 1 }; };
    Object.defineProperty(entry, "artifact_format", { enumerable: true, configurable: true, get });
    // Do not clone, freeze via Object.values, or serialize this accessor fixture.
    assert.equal(accepts(value), false);
    assert.equal(calls, 0);
    assert.equal(Object.getOwnPropertyDescriptor(entry, "artifact_format").get, get);

    const hidden = snapshot(), hiddenEntry = hidden.confirmedPlan.plan[location][0];
    Object.defineProperty(hiddenEntry, "artifact_format", { enumerable: false, configurable: true, value: { kind: "short_story", version: 1 } });
    assert.equal(accepts(hidden), false);
    assert.equal(Object.getOwnPropertyDescriptor(hiddenEntry, "artifact_format").enumerable, false);
  });

  test(`actual retained shape guard rejects every present-invalid ${location} format independently`, () => {
    for (const format of [undefined, null, "short_story", [], {}, { kind: "short_story" }, { version: 1 },
      { kind: "short_story", version: "1" }, { kind: "short_story", version: 2 }, { kind: "scene", version: 1 },
      { kind: "short_story", version: 1, provider: "unreviewed" }]) {
      const value = snapshot(); value.confirmedPlan.plan[location][0].artifact_format = format;
      const before = structuredClone(value);
      assert.equal(accepts(freeze(value)), false, `${location}: ${JSON.stringify(format)}`);
      assert.deepEqual(value, before);
    }
    for (const medium of ["image", "slides", "audio", "video", "model3d", "unknown"]) {
      const value = snapshot(); value.confirmedPlan.plan[location][0].media_kind = medium;
      const before = structuredClone(value);
      assert.equal(accepts(freeze(value)), false, `${location}: ${medium}`); assert.deepEqual(value, before);
    }
  });
}

test("actual retained requirement rows use the same strict reader, including present null and undefined", () => {
  for (const format of [undefined, null, { kind: "short_story", version: 2 }, { kind: "short_story", version: 1, extra: true }]) {
    const value = snapshot(); value.requirements[0].spec.deliverables[0].artifact_format = format;
    const before = structuredClone(value);
    assert.equal(accepts(freeze(value)), false); assert.deepEqual(value, before);
  }
});
