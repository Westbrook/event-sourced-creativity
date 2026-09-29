// Actual compiler and proposal helpers; synthetic snapshots establish no server or billing authority.
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url)));
const source = (path) => import(pathToFileURL(resolve(root, path)).href);
const [{ compileOutputPlan }, { inspectOutputRequirement }, planning] = await Promise.all([
  source("src/model/output-plan.ts"), source("src/model/output-requirements.ts"), source("src/components/output-plan-proposal-state.ts"),
]);
const { outputSavedPlanningOptions, observeOutputPlanProposal, editOutputPlanProposal, outputPlanProposalConflicts, captureOutputPlanConfirmation } = planning;
const scope = "author:document-a:session-1";
const text = "Two required images, two optional images already owed, and one optional image left off.";
const group = (id, required, count) => ({ id, label: id, media_kind: "image", required,
  quantity: { kind: "exact", unit: "image", value: count }, source_scope: { kind: "document" },
  coverage: { kind: "document_context" }, original_text: text, value_origins: {} });
const compile = (snapshot, options) => compileOutputPlan(snapshot.requirements.flatMap((row) => row.spec ? [row.spec] : []), {
  document_id: snapshot.documentId, source_revision: snapshot.sourceRevision,
  requirement_revision: snapshot.requirementRevision, ...options,
});
const obligation = (plan, id) => plan.obligations.find((row) => row.id === id);
const owed = (plan) => plan.obligations.filter((row) => row.required || row.selected).map((row) => ({ id: row.id, targets: row.target_ids }));
function confirmFixture(snapshot, options) {
  const plan = compile(snapshot, options);
  assert.deepEqual(plan.issues, []);
  snapshot.confirmedPlan = { id: "plan-1", revisionId: "confirmed-1", revision: 1, confirmedAt: "2026-08-27T12:00:00.000Z",
    requirementsDigest: snapshot.requirementRevision, sourceDigest: snapshot.sourceRevision, confirmationOptions: structuredClone(options), plan, targetContractDigests: {} };
  return snapshot;
}
function fixture(options = { selected_target_ids: ["required-images:target:1", "owed-optional-images:target:1"], selected_optional_ids: [] }) {
  const spec = { schema_version: 1, id: "selection-requirement", label: "My assignment", original_text: text,
    value_origins: { interpretation_basis: { kind: "confirmed", text } },
    deliverables: [group("required-images", true, 2), group("owed-optional-images", false, 2), group("optional-off", false, 1)] };
  assert.equal(inspectOutputRequirement(spec).status, "valid");
  return confirmFixture({ documentId: "document-a", projectId: "project-a", revision: "head-1", sourceRevision: "source-1", requirementRevision: "requirements-1",
    scope: { kind: "personal", organizationId: null, projectAccessId: null, actorUserId: "synthetic-author" },
    permissions: { canAuthor: true, canRequest: true, canReview: true, canDownload: true, independentReview: false },
    requirements: [{ blockId: spec.id, subtype: spec.label, content: text, locked: false, status: "valid", spec, preserved: structuredClone(spec), issues: [], planSuggestions: {} }],
    grants: [{ id: "retained-grant", planRevisionId: "confirmed-1", status: "authorized" }],
  }, options);
}
function saved(before, edit = () => {}) {
  const next = structuredClone(before);
  next.revision = "head-2"; next.requirementRevision = "requirements-2";
  edit(next.requirements[0].spec, next);
  assert.equal(inspectOutputRequirement(next.requirements[0].spec).status, "valid");
  next.requirements[0].content = next.requirements[0].spec.original_text;
  next.requirements[0].preserved = structuredClone(next.requirements[0].spec);
  return next;
}

test("unrelated label Save retains the whole optional obligation selected only by one old target", () => {
  const old = fixture(), next = saved(old, (spec) => { spec.deliverables[0].label = "Corrected required label"; });
  const before = structuredClone(next), options = outputSavedPlanningOptions(next), preview = compile(next, options);
  assert.deepEqual(options.selected_optional_ids, ["owed-optional-images"]);
  assert.equal(options.selected_target_ids, undefined);
  assert.deepEqual(owed(preview), owed(old.confirmedPlan.plan));
  assert.equal(preview.targets.filter((row) => row.selected).length, 4);
  assert.equal(obligation(preview, "optional-off").selected, false);
  assert.deepEqual(preview.issues, []);
  assert.deepEqual(next, before, "saved requirements, old confirmation, and grants remain untouched");
  options.selected_optional_ids.length = 0;
  assert.deepEqual(next, before, "returned options are independent of the snapshot");
});

test("wording-only Save retains owed scope without removing interpretation review", () => {
  const next = saved(fixture(), (spec) => { spec.original_text += " Corrected wording."; });
  const before = structuredClone(next), options = outputSavedPlanningOptions(next), preview = compile(next, options);
  assert.equal(obligation(preview, "owed-optional-images").selected, true);
  assert.equal(obligation(preview, "owed-optional-images").target_ids.length, 2);
  assert.ok(preview.targets.every((row) => row.blocking_issues.some((issue) => issue.code === "interpretation_review_required")));
  assert.equal(obligation(preview, "optional-off").selected, false);
  assert.deepEqual(next, before);
});

test("new and previously off optional work are never enabled by an inferred parent selection", () => {
  const next = saved(fixture(), (spec) => { spec.deliverables.push(group("new-optional", false, 1)); });
  const options = outputSavedPlanningOptions(next), preview = compile(next, options);
  assert.deepEqual(options.selected_optional_ids, ["owed-optional-images"]);
  assert.equal(obligation(preview, "owed-optional-images").selected, true);
  for (const id of ["optional-off", "new-optional"]) assert.equal(obligation(preview, id).selected, false);
  assert.deepEqual(preview.issues, []);
});

for (const explicit of [false, true]) {
  for (const change of ["removed", "required"]) {
    test(`${change} optional identity is filtered from both ${explicit ? "explicit and effective" : "target-only effective"} choices`, () => {
      const old = fixture({ selected_target_ids: ["owed-optional-images:target:1"], selected_optional_ids: explicit ? ["owed-optional-images"] : [] });
      const next = saved(old, (spec) => {
        if (change === "removed") spec.deliverables = spec.deliverables.filter((row) => row.id !== "owed-optional-images");
        else spec.deliverables.find((row) => row.id === "owed-optional-images").required = true;
      });
      const options = outputSavedPlanningOptions(next), preview = compile(next, options);
      assert.deepEqual(options.selected_optional_ids, []);
      assert.equal(obligation(preview, "optional-off").selected, false);
      assert.equal(change === "removed" ? obligation(preview, "owed-optional-images") : obligation(preview, "owed-optional-images").required, change === "removed" ? undefined : true);
      assert.deepEqual(preview.issues, []);
    });
  }
}

test("old explicit optional choices and compatible effective commitments are united without duplicates", () => {
  const old = fixture({ selected_target_ids: ["owed-optional-images:target:1"], selected_optional_ids: ["optional-off", "optional-off"] });
  const next = saved(old), options = outputSavedPlanningOptions(next), preview = compile(next, options);
  assert.deepEqual(options.selected_optional_ids, ["optional-off", "owed-optional-images"]);
  assert.deepEqual(owed(preview), owed(old.confirmedPlan.plan));
  assert.deepEqual(preview.issues, []);
});

for (const kind of ["format", "series"]) {
  test(`an inferred ${kind} child survives by identity without enabling its siblings or parent`, () => {
    const old = fixture(), parent = group("optional-parent", false, 1);
    const child = (id) => ({ id, label: id, required: true, quantity: { kind: "exact", unit: "image", value: 1 }, original_text: text, value_origins: {},
      ...(kind === "format" ? { aspect_ratio: { width: 1, height: 1 }, placements: [] } : { source_scope: { kind: "document" }, coverage: { kind: "document_context" } }) });
    if (kind === "format") parent.format_variants = [child("owed-child"), child("off-child")];
    else parent.series = { state: "resolved", description: "Agreed image series", members: [child("owed-child"), child("off-child")] };
    old.requirements[0].spec.deliverables = [parent];
    assert.equal(inspectOutputRequirement(old.requirements[0].spec).status, "valid");
    confirmFixture(old, { selected_target_ids: ["owed-child:target:1"], selected_optional_ids: [] });
    const next = saved(old, (spec) => {
      const children = kind === "format" ? spec.deliverables[0].format_variants : spec.deliverables[0].series.members;
      children[0].label = "A corrected child label";
      children.push(child("new-child"));
    });
    const options = outputSavedPlanningOptions(next), preview = compile(next, options);
    assert.deepEqual(options.selected_optional_ids, ["owed-child"]);
    assert.equal(obligation(preview, "owed-child").selected, true);
    for (const id of ["off-child", "new-child"]) assert.equal(obligation(preview, id).selected, false);
    assert.deepEqual(preview.issues, []);
  });
}

test("label reuse and incompatible identity lineage cannot transfer an inferred commitment", () => {
  for (const change of ["identity", "requirement", "media"]) {
    const next = saved(fixture(), (spec) => {
      const row = spec.deliverables.find((row) => row.id === "owed-optional-images");
      if (change === "identity") row.id = "new-id-same-label";
      if (change === "requirement") spec.id = "new-requirement";
      if (change === "media") { row.media_kind = "video"; row.quantity.unit = "video"; }
    });
    const options = outputSavedPlanningOptions(next), preview = compile(next, options);
    assert.deepEqual(options.selected_optional_ids, []);
    assert.ok(preview.obligations.filter((row) => !row.required).every((row) => !row.selected));
  }
});

test("newer count proposals still win and explicit empty proposals never resurrect old counts", () => {
  for (const count of [null, 3]) {
    const old = fixture(), row = old.requirements[0];
    row.spec.deliverables[1].quantity = { kind: "unknown", unit: "image", reason: "Agree the number of images." };
    confirmFixture(old, { selected_target_ids: ["owed-optional-images:target:1"], selected_optional_ids: [], count_policies: { "owed-optional-images:image": { kind: "exact", unit: "image", value: 2 } } });
    const next = saved(old);
    next.requirements[0].planSuggestions = count === null ? {} : { count_policies: { "owed-optional-images:image": { kind: "exact", unit: "image", value: count } } };
    const before = structuredClone(next), options = outputSavedPlanningOptions(next), preview = compile(next, options);
    assert.equal(obligation(preview, "owed-optional-images").selected, true);
    if (count === null) {
      assert.deepEqual(options.count_policies, {});
      assert.equal(obligation(preview, "owed-optional-images").resolution, "unresolved");
      assert.equal(obligation(preview, "owed-optional-images").target_ids.length, 0);
    } else {
      assert.equal(options.count_policies["owed-optional-images:image"].value, count);
      assert.equal(obligation(preview, "owed-optional-images").target_ids.length, count);
    }
    assert.deepEqual(next, before);
  }
});

test("matching confirmed digest retains the exact filter and legacy missing plan stays safe", () => {
  const old = fixture(), before = structuredClone(old);
  const options = outputSavedPlanningOptions(old);
  assert.deepEqual(options, old.confirmedPlan.confirmationOptions);
  options.selected_target_ids.length = 0;
  assert.deepEqual(old, before);
  const legacy = saved(fixture({ selected_optional_ids: ["owed-optional-images"] }));
  delete legacy.confirmedPlan.plan;
  assert.deepEqual(outputSavedPlanningOptions(legacy).selected_optional_ids, ["owed-optional-images"]);
  const first = saved(fixture()); first.confirmedPlan = null;
  assert.deepEqual(outputSavedPlanningOptions(first).selected_optional_ids, []);
});

test("hydration remains a local proposal and dirty edits keep their reason, counts, and conflict", () => {
  const old = fixture(), next = saved(old), before = structuredClone(next);
  const clean = observeOutputPlanProposal(null, next, scope);
  assert.deepEqual(clean.draft.options.selected_optional_ids, ["owed-optional-images"]);
  assert.equal(clean.dirty, false);
  assert.deepEqual(next, before, "hydrating options does not confirm or modify grants");
  const raw = "Keep this invalid draft reason\u200d";
  const dirty = editOutputPlanProposal(observeOutputPlanProposal(null, old, scope), { amendmentReason: raw,
    countFields: { "required-images:image": { quantity: { kind: "exact", unit: "image", value: 2 }, field: { kind: "exact", exact: "2e", min: "", max: "", aim: "" } } } });
  const refreshed = observeOutputPlanProposal(dirty, next, scope);
  assert.deepEqual(refreshed.draft, dirty.draft);
  assert.equal(refreshed.draft.amendmentReason, raw);
  assert.equal(outputPlanProposalConflicts(refreshed), true);
  assert.equal(captureOutputPlanConfirmation(refreshed, next, scope), null);
  assert.deepEqual(next, before);
});
