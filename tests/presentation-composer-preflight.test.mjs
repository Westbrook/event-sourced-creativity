import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { html, nothing } from "lit";
import ts from "typescript";
import { buildManagedProductionPlan, MAX_MANAGED_PRESENTATION_SLIDES, minimumPresentationSlideCount } from "../src/model/managed-production.ts";
import { buildPresentationSourceContract, inferPresentationSourceOutline } from "../src/model/presentation-source.ts";
import { formatPresentationSourceIssue, formatPresentationSourceIssues } from "../src/components/presentation-source-guidance.ts";

const source = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
const syntax = ts.createSourceFile("document-artifacts.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const component = syntax.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === "DocumentArtifacts");
const method = (name) => {
  const value = component.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText(syntax) === name);
  assert.ok(value, `the actual ${name} composer method must remain available`);
  return value.body.getText(syntax).slice(1, -1);
};
const locale = {
  t(_id, fallback, values = {}) { return fallback.replace(/\{([^}]+)\}/g, (match, key) => String(values[key] ?? match)); },
  system(fallback, values) { return this.t("", fallback, values); },
  number(value) { return String(value); },
};

function bindPreflight(body, suffix = "") {
  return new Function("buildPresentationSourceContract", "inferPresentationSourceOutline", "buildManagedProductionPlan", "minimumPresentationSlideCount", "MAX_MANAGED_PRESENTATION_SLIDES", "formatPresentationSourceIssue", "formatPresentationSourceIssues", stripTypeScriptTypes(`
    function actualPreflight() {
      const references = { items: [] };
      const authoredSlideCount = inferPresentationSourceOutline(this.presentationPlanningSnapshot()).authoredSlideCount;
      ${body.replaceAll("this.#", "this.")}
      ${suffix}
    }
  `) + "\nreturn actualPreflight;")(
    buildPresentationSourceContract, inferPresentationSourceOutline, buildManagedProductionPlan, minimumPresentationSlideCount, MAX_MANAGED_PRESENTATION_SLIDES, formatPresentationSourceIssue, formatPresentationSourceIssues,
  );
}

const dialogBody = method("#createDialogTemplate");
const planningStart = dialogBody.indexOf("    const planningSnapshot=");
const planningEnd = dialogBody.indexOf("    const managedEstimate=", planningStart);
assert.ok(planningStart >= 0 && planningEnd > planningStart);
const planning = bindPreflight(dialogBody.slice(planningStart, planningEnd), "return { sourceContract, planningError, managedPlan };");
const createBody = method("#create");
const firstPaidAction = createBody.indexOf("    const paid=");
assert.ok(firstPaidAction > 0);
const permitsSubmission = bindPreflight(createBody.slice(0, firstPaidAction), "return true;");

function fixture({ research = true, manuscript = false } = {}) {
  return { facts: [
    ...(research ? [
      { block_id: "orchard-research", type: "message", properties: { text: "Orchard yield reached 12.50% with drip irrigation." } },
      { block_id: "archive-research", type: "message", properties: { text: "Archive retrieval covers 28 catalog records." } },
    ] : []),
    { block_id: "output-directions", type: manuscript ? "direction" : "format", properties: { text: manuscript
      ? "Presentation manuscript\nSlide 1: Orchard harvest\nOrchard yield reached 12.50% with drip irrigation.\nSlide 2: Archive retrieval\nArchive retrieval covers 28 catalog records."
      : "Presentation outline\nSlide 1: Orchard harvest. Explain orchard yield and drip irrigation.\nSlide 2: Archive retrieval. Describe archive retrieval and catalog records.\n\nScene requirements\nSCENE_ONLY_MARKER\nSlide 3: A prop inside the fictional Scene." } },
  ], relationships: [] };
}

function harness(snapshot, mode, count = 2) {
  const messages = [];
  return { kind: "slides", productionMode: mode, itemCount: count, messages, presentationPlanningSnapshot: () => snapshot, store: { toast(message) { messages.push(message); } }, i18n: locale };
}

for (const mode of ["manual", "managed"]) {
  test(`${mode} Slides expose unresolved contract evidence before Create and block the submit handler`, () => {
    const state = harness(fixture({ research: false }), mode);
    const result = planning.call(state);
    assert.equal(result.sourceContract.sourceIssues.filter((issue) => issue.code === "unresolved_outline_evidence").length, 2);
    assert.match(result.planningError, /Slide 1 has coverage instructions but no resolved supporting research/);
    assert.match(result.planningError, /Slide 2 has coverage instructions but no resolved supporting research/);
    assert.equal(permitsSubmission.call(state), undefined);
    assert.deepEqual(state.messages, [result.planningError]);
  });

  test(`${mode} Slides block short-outline count changes while preserving authored manuscript expansion`, () => {
    const state = harness(fixture(), mode, 3);
    const result = planning.call(state);
    assert.ok(result.sourceContract.sourceIssues.some((issue) => issue.code === "outline_slide_count_conflict"));
    assert.match(result.planningError, /explicit coverage for every requested slide/);
    assert.equal(permitsSubmission.call(state), undefined);
    const authored = harness(fixture({ manuscript: true }), mode, 3);
    assert.equal(planning.call(authored).planningError, "");
    assert.equal(permitsSubmission.call(authored), true);
  });
}

test("composer uses the real shared contract for matched support, explicit groups, and sibling exclusion", () => {
  const snapshot = fixture();
  const result = planning.call(harness(snapshot, "manual"));
  assert.equal(result.planningError, "");
  assert.equal(result.sourceContract.authoredSlideCount, 2);
  assert.deepEqual(result.sourceContract.numberedOutline.map((slide) => slide.title), ["Orchard harvest", "Archive retrieval"]);
  assert.ok(result.sourceContract.numberedOutline.every((slide) => slide.evidenceAssignment === "matched"));
  assert.doesNotMatch(result.sourceContract.outline.sourceText, /SCENE_ONLY_MARKER|A prop/);
  for (const index of [0, 2]) snapshot.facts[index].properties.context_group_ids = ["explicit-sources"];
  const explicit = planning.call(harness(snapshot, "manual")).sourceContract;
  assert.ok(explicit.numberedOutline.every((slide) => slide.evidenceAssignment === "explicit"));
  assert.ok(explicit.numberedOutline.every((slide) => explicit.passages.filter((passage) => slide.evidencePassageIds.includes(passage.id)).every((passage) => passage.sourceBlockId === "orchard-research")));
});

function renderMarkup(value) {
  if (typeof value === "symbol" || value === undefined || value === null) return "";
  if (typeof value === "object" && value.strings && value.values) return value.strings.reduce((markup, chunk, index) => markup + chunk + renderMarkup(value.values[index]), "");
  return String(value);
}

test("short-outline explanation is localized, conditional, and retains the no-call warning and disabled Create gate", () => {
  const note = source.split("\n").find((line) => line.includes('class="video-provider-note artifact-presentation-outline-note"')).trim();
  const renderNote = new Function("sourceContract", "html", "nothing", "locale", `return ${note.slice(2, -1).replaceAll("this.i18n", "locale")};`);
  const outline = planning.call(harness(fixture(), "manual")).sourceContract;
  const text = renderMarkup(renderNote(outline, html, nothing, locale));
  for (const phrase of ["slide titles and coverage requirements", "Supporting research is assigned separately", "explicit source groups take priority", "before spending", "Scene and other output specifications are excluded"]) assert.ok(text.includes(phrase));
  const authored = planning.call(harness(fixture({ manuscript: true }), "manual")).sourceContract;
  assert.equal(renderMarkup(renderNote(authored, html, nothing, locale)), "");
  assert.match(source, /planningError\?html`[^\n]+presentation\.planning\.noProvider/);
  assert.match(source, /\?disabled=\$\{[^\n]+Boolean\(planningError\)/);
});
