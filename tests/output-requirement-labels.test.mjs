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

async function cardFixture(spec, { locale = "en", open = true, canEdit = true } = {}) {
  assert.ok(Object.hasOwn(FORMA_OUTPUT_REQUIREMENT_MESSAGES, locale), "The fixture uses a real requirement catalog");
  const source = await readFile(resolve(root, "src/components/forma-output-requirement-card.ts"), "utf8");
  const parsed = ts.createSourceFile("card.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = parsed.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "FormaOutputRequirementCard");
  assert.ok(declaration);
  const executable = ts.transpileModule(declaration.getText(parsed).replace(/^export\s+/u, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: false } }).outputText;
  const events = [];
  class Base {
    i18n = { locale, messages: {}, direction: locale === "ar" ? "rtl" : "ltr", number: String, plural: (_key, value, one, other) => Number(value) === 1 ? one : other };
    updateComplete = Promise.resolve();
    requestUpdate() {}
    querySelector() { return null; }
    closest() { return null; }
    dispatchEvent(event) { events.push(event); return true; }
  }
  // Preserve the original label-case defaults. New format, removal and comparison
  // labels always come from the real selected catalog, without English overrides.
  const messages = { ...FORMA_OUTPUT_REQUIREMENT_MESSAGES[locale], ...(locale === "en" ? {
    "output.requirement.labelLimitHelp": "Names can contain up to {max} characters. Original wording is preserved separately.",
    "output.requirement.error.labelLimit": "Use a name of at most {max} characters without control or formatting characters.",
    "output.requirement.invalidLabelsPreserved": "Saved names need correction; all wording and decisions are preserved.",
  } : {}) };
  let nextId = 0;
  const globals = { FormaPresentationalElement: Base, html: template, nothing: null, noChange: Symbol("no-change"), live: (value) => value,
    repeat: (rows, _key, render) => [...rows].map(render), nextFormaId: (prefix) => `${prefix}-${++nextId}`, formaLocaleFamily: () => locale,
    FORMA_OUTPUT_REQUIREMENT_MESSAGES: { ...FORMA_OUTPUT_REQUIREMENT_MESSAGES, [locale]: messages }, InputEvent: class FixtureInputEvent {},
    // The new format cases cover document/image only; this legacy port does not qualify 3D choices.
    MEDIA: ["unknown", "image", "slides", "audio", "video", "document"],
    scopeKey: (scope, id) => JSON.stringify([scope.authorizationScopeKey, scope.projectId, scope.documentId, id]),
    ...requirements, ...editor,
  };
  const Card = new Function(...Object.keys(globals), `${executable}; return FormaOutputRequirementCard;`)(...Object.values(globals));
  const card = new Card();
  card.resourceState = "ready";
  card.snapshot = { scope: { projectId: "project", documentId: "document", authorizationScopeKey: "actor:project" }, requirementId: spec.id, revision: "1", label: spec.label, originalText: spec.original_text, spec,
    canEdit, canReviewPlan: true, sourceOptions: [], planSuggestions: { countPolicies: {}, suggestedCounts: {} },
    summary: { headline: "Needs correction", detail: "Original scope retained", overall: "unknown", requiredRemaining: null, unresolvedGroups: null, selectedResultFiles: null },
  };
  card.willUpdate(new Map([["snapshot", null]]));
  if (open) {
    assert.equal(canEdit, true, "Read-only fixtures never invoke the opening handler");
    handler(card.render(), "click", "#open").call(card, { currentTarget: null });
  }
  return { card, events, copy: (key) => FORMA_OUTPUT_REQUIREMENT_MESSAGES[locale][`output.requirement.${key}`] };
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


const normalizeControl = value => String(value).replace(/[\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();

/** Locate the actual bound button by its own accessible label, not a private method name. */
function boundButton(value, label) {
  const matches = [];
  for (const node of templates(value)) for (let index = 0; index < node.values.length; index++) {
    if (typeof node.values[index] !== "function" || !node.strings[index].trimEnd().endsWith("@click=")) continue;
    let start = index;
    while (start >= 0 && !node.strings[start].includes("<button")) start--;
    if (start < 0) continue;
    const indexes = Array.from({ length: index - start + 1 }, (_, offset) => start + offset);
    const labelIndex = indexes.find(position => node.strings[position].trimEnd().endsWith("aria-label="));
    if (labelIndex === undefined) continue;
    const actual = normalizeControl(node.values[labelIndex]), expected = normalizeControl(label);
    if (actual !== expected && !actual.startsWith(`${expected} · `)) continue;
    const disabledIndex = indexes.find(position => node.strings[position].trimEnd().endsWith("?disabled="));
    matches.push({ invoke: node.values[index], disabled: disabledIndex !== undefined && Boolean(node.values[disabledIndex]) });
  }
  assert.equal(matches.length, 1, `One actual bound button: ${label}`);
  return matches[0];
}
function click(fixture, key) {
  const button = boundButton(fixture.card.render(), fixture.copy(key));
  assert.equal(button.disabled, false, `${key} must be enabled before its actual handler is invoked`);
  button.invoke.call(fixture.card, { currentTarget: null });
}
/** Read the named control's own disabled binding before invoking its actual input/change handler. */
function enabledField(value, name) {
  const matches = templates(value).filter(node => binding(node, "name") === name);
  assert.equal(matches.length, 1, `One actual named field: ${name}`);
  assert.equal(binding(matches[0], "?disabled"), false, `${name} must be enabled before its actual handler is invoked`);
  return matches[0];
}
function submit(fixture) {
  const rendered = fixture.card.render(), buttons = [];
  for (const node of templates(rendered)) {
    // Dynamic values remain indexes: only the actual opening tag determines the
    // control type and which disabled binding belongs to that same button.
    const markup = node.strings.map((part, index) => part + (index < node.values.length ? `__forma_binding_${index}__` : "")).join("");
    for (const [tag] of markup.matchAll(/<button\b[^>]*>/gu)) {
      if (!/\btype="submit"/u.test(tag)) continue;
      const disabled = /\?disabled=__forma_binding_(\d+)__/u.exec(tag);
      assert.ok(disabled, "The actual submit button has its own disabled binding");
      buttons.push(node.values[Number(disabled[1])]);
    }
  }
  assert.deepEqual(buttons, [false], "One actual submit button is enabled before the form handler is invoked");
  const before = fixture.events.filter(event => event.type === "forma-output-save").length;
  handler(rendered, "submit", "#submit").call(fixture.card, { preventDefault() {}, stopPropagation() {} });
  const saves = fixture.events.filter(event => event.type === "forma-output-save");
  assert.equal(saves.length, before + 1, "Only the explicit form submission emits the save intent");
  assert.ok(fixture.events.every(event => ["forma-output-edit", "forma-output-save"].includes(event.type)), "The card remains an edit/save intent-only port");
  return saves.at(-1).detail.draft;
}
function formatRows(fixture) {
  return templates(fixture.card.render()).filter(node => node.strings[0] === "<p><b>" && node.values[0] === fixture.copy("artifactFormat"));
}
function expectRetainedFormat(fixture) {
  const rows = formatRows(fixture);
  assert.ok(rows.length > 0, "The actual summary/editor template includes the format row");
  for (const row of rows) assert.deepEqual(row.values, [fixture.copy("artifactFormat"), fixture.copy("artifactFormat.short_story")]);
}
function removalComparisons(fixture) {
  return templates(fixture.card.render()).filter(node => node.strings[0].includes('class="output-requirement-subrow"')
    && node.values[1] === fixture.copy("changeField.artifactFormat") && node.values[2] === fixture.copy("changeKind.removed"));
}
function mediumRemovalWarnings(fixture) {
  return templates(fixture.card.render()).filter(node => node.strings[0] === "<p>" && node.values[0] === fixture.copy("artifactFormatRemoval"));
}
function expectRemovalComparison(fixture) {
  const rows = removalComparisons(fixture);
  assert.equal(rows.length, 1, "The actual comparison contains one explicit format removal");
  assert.equal(rows[0].values[0], fixture.card.snapshot.spec.deliverables[0].label, "The removed format belongs to the retained deliverable");
  assert.deepEqual(rows[0].values.slice(1), [fixture.copy("changeField.artifactFormat"), fixture.copy("changeKind.removed"),
    fixture.copy("comparisonBefore"), fixture.copy("artifactFormat.short_story"), fixture.copy("comparisonAfter"), fixture.copy("comparisonAbsent")]);
  assert.equal(rows[0].values.some(value => typeof value === "string" && value.includes("short_story")), false, "The visible comparison uses labels, not raw format JSON");
}
function storyRequirement() {
  return requirements.confirmOutputRequirementInterpretation({
    schema_version: 1, id: "format-requirement", label: "Narrative", original_text: "A narrative about a cartographer.", value_origins: {},
    deliverables: [{ id: "format-deliverable", label: "The map", media_kind: "document", artifact_format: { kind: "short_story", version: 1 },
      required: true, quantity: { kind: "exact", unit: "document", value: 1 }, source_scope: { kind: "document" }, coverage: { kind: "document_context" },
      original_text: "A narrative about a cartographer.", value_origins: { artifact_format: { kind: "confirmed" }, coverage: { kind: "authored" } } }],
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test(`actual ${locale} read-only summary retains the explicit format without opening or saving`, async () => {
    const spec = storyRequirement(), before = structuredClone(spec);
    const fixture = await cardFixture(spec, { locale, open: false, canEdit: false });
    assert.equal(fixture.card.snapshot.canEdit, false);
    assert.equal(fixture.card.hasOpenDraft, false);
    expectRetainedFormat(fixture);
    assert.equal(templates(fixture.card.render()).some(node => node.strings.some(part => part.includes("<form "))), false);
    assert.deepEqual(fixture.events, []);
    const generic = structuredClone(spec); delete generic.deliverables[0].artifact_format;
    generic.deliverables[0].label = fixture.copy("artifactFormat.short_story");
    const ordinary = await cardFixture(generic, { locale, open: false, canEdit: false });
    assert.equal(formatRows(ordinary).length, 0, "A story-like authored label does not infer a qualifier");
    assert.equal(ordinary.card.hasOpenDraft, false);
    assert.deepEqual(ordinary.events, []);
    assert.deepEqual(spec, before);
  });

  test(`actual ${locale} ordinary edits and wording-confirmation handlers retain the format`, async () => {
    const spec = storyRequirement(), before = structuredClone(spec), fixture = await cardFixture(spec, { locale });
    handler(enabledField(fixture.card.render(), "format-deliverable:label"), "input").call(fixture.card, { currentTarget: { value: "The revised map" } });
    expectRetainedFormat(fixture);
    const wording = `${spec.original_text} Revised wording.`;
    handler(enabledField(fixture.card.render(), "originalText"), "input").call(fixture.card, { currentTarget: { value: wording } });
    click(fixture, "keepRequirementsUpdateWording");
    expectRetainedFormat(fixture);
    const retainedRows = templates(fixture.card.render()).filter(node => node.strings[0].includes('class="output-requirement-subrow"')
      && node.values[1] === fixture.copy("changeField.artifactFormat") && node.values.length === 3);
    assert.equal(retainedRows.length, 1, "The retained-decision review includes the specific format");
    assert.deepEqual(retainedRows[0].values, ["The revised map", fixture.copy("changeField.artifactFormat"), fixture.copy("artifactFormat.short_story")]);
    assert.equal(boundButton(fixture.card.render(), fixture.copy("acceptRetainedInterpretation")).disabled, true);
    const review = enabledField(fixture.card.render(), "interpretation-reviewed");
    assert.equal(binding(review, ".checked"), false);
    handler(review, "change").call(fixture.card, { currentTarget: { checked: true } });
    const checkedReview = templates(fixture.card.render()).find(node => binding(node, "name") === "interpretation-reviewed");
    assert.equal(binding(checkedReview, ".checked"), true);
    click(fixture, "acceptRetainedInterpretation");
    assert.equal(fixture.events.filter(event => event.type === "forma-output-save").length, 0);
    const saved = submit(fixture);
    assert.equal(saved.original_text, wording);
    assert.equal(saved.deliverables[0].label, "The revised map");
    assert.deepEqual(saved.deliverables[0].artifact_format, before.deliverables[0].artifact_format);
    assert.deepEqual(saved.deliverables[0].value_origins.artifact_format, before.deliverables[0].value_origins.artifact_format);
    assert.equal(Object.hasOwn(saved.deliverables[0].value_origins, "format_variants"), false, "Materialization does not invent format-variant authorship");
    assert.equal(requirements.outputRequirementInterpretationNeedsReview(saved), false);
    assert.deepEqual(spec, before);
  });

  for (const decision of ["keepProposal", "replaceProposal"]) test(`actual ${locale} reparse discloses format removal before ${decision}`, async () => {
    const spec = storyRequirement(), before = structuredClone(spec), fixture = await cardFixture(spec, { locale });
    click(fixture, "parseProposal");
    expectRemovalComparison(fixture);
    expectRetainedFormat(fixture);
    assert.equal(fixture.events.filter(event => event.type === "forma-output-save").length, 0);
    assert.equal(boundButton(fixture.card.render(), fixture.copy("keepProposal")).disabled, false);
    assert.equal(boundButton(fixture.card.render(), fixture.copy("replaceProposal")).disabled, false);
    click(fixture, decision);
    assert.equal(removalComparisons(fixture).length, 0, "The actual removal comparison closes immediately after the local decision");
    assert.equal(fixture.events.filter(event => event.type === "forma-output-save").length, 0, "Keep and Replace are local decisions, not saves");
    const groupIds = templates(fixture.card.render()).map(node => binding(node, "data-output-deliverable")).filter(id => id !== undefined);
    assert.equal(groupIds.length, 1);
    if (decision === "keepProposal") {
      expectRetainedFormat(fixture);
      assert.equal(groupIds[0], "format-deliverable");
      assert.equal(binding(field(fixture.card.render(), `${groupIds[0]}:medium`), ".value"), "document");
    } else {
      assert.equal(formatRows(fixture).length, 0);
      assert.notEqual(groupIds[0], "format-deliverable", "The parser proposes a new unresolved row, not a document-kind replacement");
      assert.equal(binding(field(fixture.card.render(), `${groupIds[0]}:medium`), ".value"), "unknown");
    }
    const saved = submit(fixture);
    assert.equal(saved.deliverables[0].id, groupIds[0], "The explicit save belongs to the actual rendered proposal row");
    if (decision === "keepProposal") {
      assert.deepEqual(saved.deliverables[0].artifact_format, before.deliverables[0].artifact_format);
      assert.deepEqual(saved.deliverables[0].value_origins.artifact_format, before.deliverables[0].value_origins.artifact_format);
    } else assert.equal(saved.deliverables.some(group => Object.hasOwn(group, "artifact_format")), false);
    assert.deepEqual(spec, before);
  });

  test(`actual ${locale} medium confirmation alone clears the qualifier and records removal provenance`, async () => {
    const spec = storyRequirement(), before = structuredClone(spec), fixture = await cardFixture(spec, { locale });
    const change = () => handler(enabledField(fixture.card.render(), "format-deliverable:medium"), "change").call(fixture.card, { currentTarget: { value: "image" } });
    const assertPending = () => {
      assert.equal(binding(field(fixture.card.render(), "format-deliverable:medium"), ".value"), "document");
      expectRetainedFormat(fixture);
      const removal = mediumRemovalWarnings(fixture);
      assert.equal(removal.length, 1);
      assert.deepEqual(removal[0].values, [fixture.copy("artifactFormatRemoval"), fixture.copy("artifactFormat.short_story")]);
      assert.equal(fixture.events.filter(event => event.type === "forma-output-save").length, 0);
    };
    change(); assertPending();
    click(fixture, "keepProposal");
    assert.equal(mediumRemovalWarnings(fixture).length, 0, "Cancel closes the actual removal warning before another change");
    assert.equal(binding(field(fixture.card.render(), "format-deliverable:medium"), ".value"), "document");
    expectRetainedFormat(fixture);
    change(); assertPending();
    click(fixture, "changeMedium");
    assert.equal(mediumRemovalWarnings(fixture).length, 0, "Confirm closes the actual removal warning");
    assert.equal(binding(field(fixture.card.render(), "format-deliverable:medium"), ".value"), "image");
    assert.equal(formatRows(fixture).length, 0);
    assert.equal(fixture.events.filter(event => event.type === "forma-output-save").length, 0);
    const saved = submit(fixture), group = saved.deliverables[0];
    assert.equal(group.media_kind, "image");
    assert.equal(Object.hasOwn(group, "artifact_format"), false);
    assert.deepEqual(group.value_origins.artifact_format, { kind: "authored" });
    assert.deepEqual(group.value_origins.coverage, before.deliverables[0].value_origins.coverage);
    assert.deepEqual(spec, before);
  });
}


for (const qualified of [true, false]) test(`actual ordinary label save preserves ${qualified ? "short-story" : "generic-document"} provenance without invented format variants`, async () => {
  const spec = storyRequirement();
  if (!qualified) {
    delete spec.deliverables[0].artifact_format;
    delete spec.deliverables[0].value_origins.artifact_format;
  }
  const before = structuredClone(spec), fixture = await cardFixture(spec);
  handler(enabledField(fixture.card.render(), "format-deliverable:label"), "input").call(fixture.card, { currentTarget: { value: "Updated title" } });
  assert.equal(binding(field(fixture.card.render(), "format-deliverable:label"), ".value"), "Updated title");
  assert.equal(fixture.events.filter(event => event.type === "forma-output-save").length, 0);
  const saved = submit(fixture), group = saved.deliverables[0];
  assert.equal(group.label, "Updated title");
  assert.equal(Object.hasOwn(group.value_origins, "format_variants"), false);
  assert.deepEqual(group.value_origins, { ...before.deliverables[0].value_origins, label: { kind: "authored" } });
  if (qualified) assert.deepEqual(group.artifact_format, before.deliverables[0].artifact_format);
  else assert.equal(Object.hasOwn(group, "artifact_format"), false);
  assert.deepEqual(spec, before);
});
