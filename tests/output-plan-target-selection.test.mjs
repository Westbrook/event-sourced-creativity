// Actual compiler, proposal helpers, and controller bodies. Store/DOM are synthetic;
// these tests establish UI and plan semantics, not server or billing authority.
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url)));
const source = (path) => import(pathToFileURL(resolve(root, path)).href);
const [domain, planning, harness, requirements] = await Promise.all([
  source("src/model/output-plan.ts"), source("src/components/output-plan-proposal-state.ts"),
  source("tests/output-ui-source-harness.mjs"), source("src/model/output-requirements.ts"),
]);
const { binding, controllerFixture, deferred, eventHandlers, handler, loadController, region, submitEvent, templates } = harness;
const tagged = (part, key) => part.values.some((value) => typeof value === "string" && value.includes(`output.delivery.${key}`));
const attributes = (part, key) => part.values.filter((value, index) => part.strings[index].trimEnd().endsWith(`${key}=`));
const scope = "fixture-actor:project:1\u0000doc-a";

function configure(snapshot) {
  const text = "Two required images, two optional images already agreed, and one optional image left off.";
  const group = (id, label, required, count) => ({ id, label, media_kind: "image", required,
    quantity: { kind: "exact", unit: "image", value: count }, source_scope: { kind: "document" },
    coverage: { kind: "document_context" }, original_text: text, value_origins: {} });
  const spec = { schema_version: 1, id: "selection-requirement", label: "Synthetic scoped selection", original_text: text,
    value_origins: { interpretation_basis: { kind: "confirmed", text } }, deliverables: [
      group("required-images", "Required images", true, 2), group("owed-optional-images", "Already owed optional images", false, 2),
      group("optional-off", "Optional work left off", false, 1),
    ] };
  assert.equal(requirements.inspectOutputRequirement(spec).status, "valid");
  const options = { selected_target_ids: ["required-images:target:1", "owed-optional-images:target:1"], selected_optional_ids: [],
    count_policies: { "required-images:image": { kind: "exact", unit: "image", value: 2 } } };
  snapshot.requirements = [{ blockId: spec.id, subtype: spec.label, content: text, locked: false, status: "valid", spec, preserved: structuredClone(spec), issues: [], planSuggestions: {} }];
  const plan = domain.compileOutputPlan([spec], { document_id: snapshot.documentId, source_revision: snapshot.sourceRevision,
    requirement_revision: snapshot.requirementRevision, ...options });
  assert.equal(plan.issues.length, 0); assert.ok(plan.targets.every((target) => target.blocking_issues.length === 0));
  snapshot.confirmedPlan = { ...snapshot.confirmedPlan, revisionId: "filtered-plan", confirmationOptions: options, plan,
    targetContractDigests: Object.fromEntries(plan.targets.map((target) => [target.id, `synthetic-contract-${target.id}`])) };
  snapshot.assets = []; snapshot.results = [];
  snapshot.summary = domain.summarizeOutputPlan(plan, [], { state: "ready", source_revision: snapshot.sourceRevision, requirement_revision: snapshot.requirementRevision });
  snapshot.requirementSummaries = { [spec.id]: snapshot.summary };
  return snapshot;
}
const compile = (snapshot, options) => domain.compileOutputPlan(snapshot.requirements.map((row) => row.spec), {
  document_id: snapshot.documentId, source_revision: snapshot.sourceRevision, requirement_revision: snapshot.requirementRevision, ...options,
});
const owed = (plan) => plan.obligations.filter((row) => row.required || row.selected).map((row) => ({ id: row.id, required: row.required, targets: [...row.target_ids] }));

test("explicit target-filter reset preserves the whole required and target-only optional denominator", async () => {
  const f = await controllerFixture(), snapshot = configure(f.snapshots.get("doc-a"));
  let state = planning.observeOutputPlanProposal(null, snapshot, scope);
  const before = compile(snapshot, state.draft.options);
  assert.equal(before.targets.find((target) => target.id === "required-images:target:2").selected, false);
  assert.equal(before.targets.find((target) => target.id === "required-images:target:2").required, true);
  assert.equal(before.obligations.find((row) => row.id === "owed-optional-images").selected, true);
  assert.equal(before.targets.find((target) => target.id === "owed-optional-images:target:2").selected, false);
  assert.deepEqual(state.draft.options.selected_optional_ids, []);
  const raw = "Keep this invalid local reason\u200d";
  state = planning.editOutputPlanProposal(state, { amendmentReason: raw,
    countFields: { "unfinished:image": { quantity: { kind: "exact", unit: "image", value: 2 }, field: { kind: "exact", exact: "2e", min: "", max: "", aim: "" } } } });
  const original = structuredClone(state), staged = planning.includeOutputPlanCommittedTargets(state);
  assert.ok(staged); assert.equal(staged.draft.options.selected_target_ids, undefined);
  assert.deepEqual(staged.draft.options.selected_optional_ids, ["owed-optional-images"]);
  assert.deepEqual(staged.draft.options.count_policies, original.draft.options.count_policies);
  assert.deepEqual(staged.draft.countFields, original.draft.countFields); assert.equal(staged.draft.amendmentReason, raw);
  const after = compile(snapshot, staged.draft.options);
  assert.deepEqual(owed(after), owed(before));
  assert.equal(after.targets.filter((target) => target.selected).length, 4);
  assert.equal(after.targets.find((target) => target.id === "optional-off:target:1").selected, false);
  assert.deepEqual(planning.outputPlanOptionalChoice(before, "owed-optional-images"), { checked: true, mixed: false });
  assert.deepEqual(planning.outputPlanOptionalChoice(after, "owed-optional-images"), { checked: true, mixed: false });
  assert.deepEqual(planning.outputPlanOptionalChoice(after, "optional-off"), { checked: false, mixed: false });
  assert.equal(planning.captureOutputPlanConfirmation(staged, snapshot, scope), null, "selection normalization does not erase invalid fields to force confirmation");
  assert.deepEqual(state, original); assert.equal(f.requests.length, 0);
});

test("filter reset is never automatic and refuses a conflicted draft", async () => {
  const f = await controllerFixture(), snapshot = configure(f.snapshots.get("doc-a"));
  const state = planning.observeOutputPlanProposal(null, snapshot, scope);
  assert.deepEqual(state.draft.options.selected_target_ids, snapshot.confirmedPlan.confirmationOptions.selected_target_ids);
  assert.equal(planning.editOutputPlanOptionalChoice(state, "optional-off", true), null, "a target filter must be reviewed before optional checkbox edits");
  const dirty = planning.editOutputPlanProposal(state, { amendmentReason: "Keep the reviewed scope." });
  const changed = structuredClone(snapshot); changed.sourceRevision = "source-changed";
  const conflict = planning.observeOutputPlanProposal(dirty, changed, scope);
  assert.equal(planning.includeOutputPlanCommittedTargets(conflict), null);
  assert.deepEqual(conflict.draft.options.selected_target_ids, state.draft.options.selected_target_ids);
});

test("optional choice readback and edits preserve an inherited sibling commitment", async () => {
  const f = await controllerFixture(), snapshot = configure(f.snapshots.get("doc-a"));
  const spec = snapshot.requirements[0].spec;
  spec.deliverables = [{ ...spec.deliverables[1], id: "optional-parent", quantity: { kind: "exact", unit: "image", value: 1 }, format_variants: [
    { id: "optional-a", label: "Optional format A", required: false, quantity: { kind: "exact", unit: "image", value: 1 }, aspect_ratio: { width: 1, height: 1 }, placements: [], original_text: "Optional square format.", value_origins: {} },
    { id: "optional-b", label: "Optional format B", required: false, quantity: { kind: "exact", unit: "image", value: 1 }, aspect_ratio: { width: 4, height: 5 }, placements: [], original_text: "Optional portrait format.", value_origins: {} },
  ] }];
  snapshot.confirmedPlan.confirmationOptions = { selected_optional_ids: ["optional-parent"] };
  assert.equal(requirements.inspectOutputRequirement(spec).status, "valid");
  let state = planning.observeOutputPlanProposal(null, snapshot, scope), plan = compile(snapshot, state.draft.options);
  assert.equal(plan.issues.length, 0);
  assert.deepEqual(planning.outputPlanOptionalChoice(plan, "optional-a"), { checked: true, mixed: false });
  state = planning.editOutputPlanOptionalChoice(state, "optional-a", false); assert.ok(state);
  plan = compile(snapshot, state.draft.options);
  assert.equal(plan.obligations.find((row) => row.id === "optional-a").selected, false);
  assert.equal(plan.obligations.find((row) => row.id === "optional-b").selected, true);
  assert.deepEqual(planning.outputPlanOptionalChoice(plan, "optional-parent"), { checked: false, mixed: true });
  assert.deepEqual(planning.outputPlanOptionalChoice(plan, "optional-b"), { checked: true, mixed: false });
});

async function controllerReview() {
  const f = await controllerFixture(), current = configure(f.snapshots.get("doc-a"));
  const opener = { isConnected: true, disabled: false, focus() {} };
  const focuses = { preview: 0 };
  class Base {
    constructor() { this.store = f.store; this.isConnected = true; this.i18n = f.controller.i18n; this.updateComplete = Promise.resolve(); }
    requestUpdate() {} connectedCallback() {} disconnectedCallback() {}
    querySelector(selector) { return selector === "[data-output-selection-preview]" ? { focus() { focuses.preview++; } } : null; }
  }
  const Controller = await loadController(Base, { compileOutputPlan: domain.compileOutputPlan, document: { activeElement: null }, HTMLElement: class {} });
  const controller = new Controller(); controller.documentId = current.documentId; controller.surface = "deliver"; controller.willUpdate(new Map());
  f.controller = controller;
  const open = () => eventHandlers(controller.render(), "click").find((callback) => callback.toString().includes("#openPlan(event.currentTarget)"))({ currentTarget: opener });
  open(); await controller.updateComplete;
  const review = () => region(controller.render(), 'class="output-plan-review"');
  const reset = () => templates(review()).find((part) => tagged(part, "planIncludeCommittedTargets"));
  return { ...f, current, review, reset, open, focuses };
}
const runRows = (f) => templates(region(f.controller.render(), 'class="output-execution"')).filter((part) => part.strings.some((text) => text.includes('<label><input class="output-run-target" data-output-run-target=')) && part.strings.some((text) => text.includes(' type="checkbox"')) && part.strings.some((text) => text.includes('<span dir="auto">')));

test("actual compiled required and already-owed optional exclusions have accurate author and viewer guidance", async () => {
  for (const canAuthor of [true, false]) {
    const f = await controllerReview(); f.current.permissions.canAuthor = canAuthor; f.controller.willUpdate(new Map());
    const rows = runRows(f);
    for (const label of ["Required images 2", "Already owed optional images 2"]) {
      const row = rows.find((part) => part.values.includes(label)); assert.ok(row);
      assert.equal(binding(row, ".checked"), false); assert.equal(binding(row, "?disabled"), true);
      assert.ok(JSON.stringify(row).includes(canAuthor ? "output.delivery.owedTargetNeedsPlan" : "output.delivery.owedTargetNeedsAuthor"));
      assert.ok(!JSON.stringify(row).includes("output.delivery.optionalTargetNeeds"));
    }
    const off = rows.find((part) => part.values.includes("Optional work left off"));
    assert.ok(JSON.stringify(off).includes(canAuthor ? "output.delivery.optionalTargetNeedsPlan" : "output.delivery.optionalTargetNeedsAuthor"));
    assert.equal(f.requests.length, 0);
  }
});

test("the explicit local remedy preserves owed optional work, shows effective controls and preview, then requires separate free confirmation", async () => {
  const f = await controllerReview(), before = structuredClone(f.current);
  const optionalField = templates(f.review()).find((part) => tagged(part, "optionalSelection"));
  assert.equal(binding(optionalField, "?disabled"), true);
  const optionalRows = templates(optionalField).filter((part) => part.strings.some((text) => text.includes('<label><input type="checkbox"')));
  const owedOption = optionalRows.find((part) => part.values.includes("Already owed optional images"));
  const offOption = optionalRows.find((part) => part.values.includes("Optional work left off"));
  assert.equal(binding(owedOption, ".checked"), true); assert.equal(binding(offOption, ".checked"), false);
  eventHandlers(owedOption, "change")[0]({ target: { checked: false } });
  assert.equal(binding(templates(templates(f.review()).find((part) => tagged(part, "optionalSelection"))).find((part) => part.values.includes("Already owed optional images")), ".checked"), true,
    "the explicit target filter cannot be bypassed by invoking a disabled optional control");
  assert.ok(JSON.stringify(region(f.review(), 'class="output-plan-target-selection"')).includes("preview: 2 of 5"));
  eventHandlers(f.reset(), "click")[0]();
  assert.equal(f.requests.length, 0); assert.deepEqual(f.current, before);
  assert.ok(JSON.stringify(region(f.review(), 'class="output-plan-target-selection"')).includes("preview: 4 of 5"));
  assert.ok(JSON.stringify(f.review()).includes("The work owed is unchanged"));
  assert.equal(runRows(f).filter((part) => binding(part, ".checked")).length, 2, "the current plan has not changed from the local preview action");
  const fieldAfter = templates(f.review()).find((part) => tagged(part, "optionalSelection"));
  assert.equal(binding(fieldAfter, "?disabled"), false);
  assert.equal(binding(templates(fieldAfter).find((part) => part.values.includes("Already owed optional images")), ".checked"), true);
  assert.equal(binding(templates(fieldAfter).find((part) => part.values.includes("Optional work left off")), ".checked"), false);
  f.store.outputRequirementCommand = async (command) => {
    f.requests.push(command); assert.equal(command.action, "confirm");
    const next = structuredClone(f.current), plan = compile(next, command.options);
    next.revision = "2"; next.confirmedPlan = { ...next.confirmedPlan, revisionId: "reviewed-plan", confirmationOptions: command.options, plan };
    f.snapshots.set("doc-a", next);
    return { status: "saved", body: { snapshot: next, command: { action: "confirm" } } };
  };
  await handler(f.review(), "submit", "#confirm").call(f.controller, submitEvent()); f.controller.willUpdate(new Map());
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].action, "confirm");
  assert.equal(f.requests[0].options.selected_target_ids, undefined);
  assert.deepEqual(owed(f.snapshots.get("doc-a").confirmedPlan.plan), owed(before.confirmedPlan.plan));
  assert.equal(runRows(f).filter((part) => binding(part, ".checked")).length, 4);
  assert.equal(f.snapshots.get("doc-a").grants.length, 0);
});

test("raw invalid reason, permission loss, and concurrent semantic changes cannot be bypassed by the filter-removal action", async () => {
  const invalid = await controllerReview(), raw = "Retain this draft\u202e";
  eventHandlers(region(invalid.review(), '<textarea rows="2"'), "input")[0]({ target: { value: raw } });
  eventHandlers(invalid.reset(), "click")[0]();
  assert.equal(binding(region(invalid.review(), '<textarea rows="2"'), ".value"), raw);
  await handler(invalid.review(), "submit", "#confirm").call(invalid.controller, submitEvent());
  assert.equal(invalid.requests.length, 0);
  for (const change of ["permission", "source"]) {
    const f = await controllerReview(), callback = eventHandlers(f.reset(), "click")[0];
    const current = structuredClone(f.current);
    if (change === "permission") current.permissions.canAuthor = false;
    else { current.sourceRevision = "source-new"; current.confirmedPlan.sourceDigest = "source-new"; }
    f.snapshots.set("doc-a", current); callback(); f.controller.willUpdate(new Map());
    assert.ok(f.reset(), "the old callback did not silently stage a reset on new authority or source");
    assert.equal(f.requests.length, 0);
    if (change === "permission") assert.equal(binding(f.reset(), "?disabled"), true);
  }
});

test("removing the local target filter focuses its persistent preview after the action button disappears", async () => {
  const f = await controllerReview(); eventHandlers(f.reset(), "click")[0]();
  await f.controller.updateComplete;
  assert.equal(f.reset(), undefined);
  assert.ok(region(f.review(), "data-output-selection-preview"));
  assert.equal(f.focuses.preview, 1);
  assert.equal(f.requests.length, 0);
});

for (const transition of ["cancel", "cancel-reopen", "document", "scope", "new-edit"]) {
  test(`a delayed selection-preview focus cannot outlive ${transition}`, async () => {
    const f = await controllerReview(), update = deferred(); f.controller.updateComplete = update.promise;
    eventHandlers(f.reset(), "click")[0]();
    if (transition.startsWith("cancel")) {
      eventHandlers(f.review(), "click").find((callback) => callback.toString().includes("#closePlan()"))();
      if (transition === "cancel-reopen") f.open();
    } else if (transition === "document") { f.controller.documentId = "doc-b"; f.controller.willUpdate(new Map()); }
    else if (transition === "scope") {
      f.store.captureAuthorizationScope = () => ({ key: "replacement-scope", shared: false }); f.controller.willUpdate(new Map());
    } else eventHandlers(region(f.review(), '<textarea rows="2"'), "input")[0]({ target: { value: "A newer local edit has focus." } });
    update.resolve(); await update.promise;
    assert.equal(f.focuses.preview, 0);
    assert.equal(f.requests.length, 0);
  });
}
