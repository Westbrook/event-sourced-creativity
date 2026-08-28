// Executes the actual card class in an isolated template-binding harness.
// This is not browser, screen-reader, localization, or server-authority evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as requirements from "../src/model/output-requirements.ts";
import * as editor from "../src/components/output-requirement-editor.ts";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES } from "../src/components/design-system/locales/output-requirement-messages.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(resolve(process.env.FORMA_OUTPUT_DEPENDENCY_ROOT || root, "package.json"))("typescript");
const template = (strings, ...values) => ({ strings: [...strings], values });
const templates = (value) => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(templates) : Array.isArray(value.strings) && Array.isArray(value.values) ? [value, ...value.values.flatMap(templates)] : [];
function binding(value, name) {
  const index = value.values.findIndex((_item, i) => value.strings[i].trimEnd().endsWith(`${name}=`));
  return index < 0 ? undefined : value.values[index];
}
function handler(value, event, method) {
  for (const node of templates(value)) for (let index = 0; index < node.values.length; index++) {
    const candidate = node.values[index];
    if (typeof candidate === "function" && node.strings[index].trimEnd().endsWith(`@${event}=`) && (!method || candidate.name === method)) return candidate;
  }
  assert.fail(`Missing actual ${event} handler ${method ?? ""}`);
}
function field(value, name) {
  const result = templates(value).find((node) => binding(node, "name") === name && binding(node, ".value") !== undefined);
  assert.ok(result, `Actual native field ${name} must be rendered`);
  return result;
}

async function cardFixture(spec) {
  const source = await readFile(resolve(root, "src/components/forma-output-requirement-card.ts"), "utf8");
  const parsed = ts.createSourceFile("card.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = parsed.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "FormaOutputRequirementCard");
  assert.ok(declaration);
  const executable = ts.transpileModule(declaration.getText(parsed).replace(/^export\s+/u, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: false } }).outputText;
  const events = [];
  class Base {
    i18n = { locale: "en", messages: {}, direction: "ltr", number: String, plural: (_key, value, one, other) => Number(value) === 1 ? one : other };
    updateComplete = Promise.resolve();
    requestUpdate() {}
    querySelector() { return null; }
    closest() { return null; }
    dispatchEvent(event) { events.push(event); return true; }
  }
  // Copy is supplied independently of the production catalog to keep this test
  // focused on validation, retained values, and event behavior. Catalog tests run separately.
  const messages = { ...FORMA_OUTPUT_REQUIREMENT_MESSAGES.en,
    "output.requirement.labelLimitHelp": "Names can contain up to {max} characters. Original wording is preserved separately.",
    "output.requirement.error.labelLimit": "Use a name of at most {max} characters without control or formatting characters.",
    "output.requirement.invalidLabelsPreserved": "Saved names need correction; all wording and decisions are preserved.",
  };
  let nextId = 0;
  const globals = { FormaPresentationalElement: Base, html: template, nothing: null, noChange: Symbol("no-change"), live: (value) => value,
    repeat: (rows, _key, render) => [...rows].map(render), nextFormaId: (prefix) => `${prefix}-${++nextId}`, formaLocaleFamily: () => "en",
    FORMA_OUTPUT_REQUIREMENT_MESSAGES: { en: messages }, InputEvent: class FixtureInputEvent {},
    MEDIA: ["unknown", "image", "slides", "audio", "video", "document"],
    scopeKey: (scope, id) => JSON.stringify([scope.authorizationScopeKey, scope.projectId, scope.documentId, id]),
    ...requirements, ...editor,
  };
  const Card = new Function(...Object.keys(globals), `${executable}; return FormaOutputRequirementCard;`)(...Object.values(globals));
  const card = new Card();
  card.resourceState = "ready";
  card.snapshot = { scope: { projectId: "project", documentId: "document", authorizationScopeKey: "actor:project" }, requirementId: spec.id, revision: "1", label: spec.label, originalText: spec.original_text, spec,
    canEdit: true, canReviewPlan: true, sourceOptions: [], planSuggestions: { countPolicies: {}, suggestedCounts: {} },
    summary: { headline: "Needs correction", detail: "Original scope retained", overall: "unknown", requiredRemaining: null, unresolvedGroups: null, selectedResultFiles: null },
  };
  card.willUpdate(new Map([["snapshot", null]]));
  handler(card.render(), "click", "#open").call(card, { currentTarget: null });
  return { card, events };
}

test("the actual card retains oversized labels and all nested decisions until corrected", async () => {
  const prose = 'Output images at "1:1" carousels, "4:5" feeds. ' + "Keep the original explanation. ".repeat(20);
  const spec = requirements.parseOutputRequirement({ id: "label-fixture", type: "output", subtype: "Social media image", content: prose }).spec;
  spec.label = "R".repeat(241); spec.deliverables[0].label = "D".repeat(241);
  spec.deliverables[0].format_variants[0].label = "F".repeat(241);
  for (const row of spec.deliverables[0].format_variants) row.quantity = { kind: "exact", unit: "image", value: 1 };
  const before = structuredClone(spec), { card, events } = await cardFixture(spec);
  const keys = ["packageLabel", `${spec.deliverables[0].id}:label`, `${spec.deliverables[0].format_variants[0].id}:label`];
  for (const key of keys) {
    const input = field(card.render(), key);
    assert.equal(binding(input, ".value").length, 241, "maxlength must not truncate an imported value");
    assert.equal(binding(input, "maxlength"), requirements.OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH);
    assert.equal(binding(input, "aria-invalid"), "true");
  }
  const original = field(card.render(), "originalText");
  assert.equal(binding(original, ".value"), prose);
  assert.equal(binding(original, "maxlength"), null, "label limits must not become a prose cap");
  const event = { preventDefault() {}, stopPropagation() {} };
  handler(card.render(), "submit", "#submit").call(card, event);
  assert.equal(events.filter((entry) => entry.type === "forma-output-save").length, 0, "invalid labels must be rejected before a save intent");
  for (const [index, key] of keys.entries()) handler(field(card.render(), key), "input").call(card, { currentTarget: { value: `Corrected ${index + 1}` } });
  for (const key of keys) assert.equal(binding(field(card.render(), key), "aria-invalid"), "false");
  handler(card.render(), "submit", "#submit").call(card, event);
  const saved = events.find((entry) => entry.type === "forma-output-save");
  assert.ok(saved);
  assert.equal(saved.detail.draft.original_text, prose);
  assert.deepEqual(saved.detail.draft.deliverables.map((entry) => entry.id), before.deliverables.map((entry) => entry.id));
  assert.deepEqual(saved.detail.draft.deliverables[0].format_variants.map((entry) => [entry.id, entry.quantity, entry.aspect_ratio]), before.deliverables[0].format_variants.map((entry) => [entry.id, entry.quantity, entry.aspect_ratio]));
  assert.equal(requirements.inspectOutputRequirement(saved.detail.draft).status, "valid");
  assert.deepEqual(spec, before);
});
