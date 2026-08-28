import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeOutputPlanProposal, captureOutputPlanConfirmation, captureOutputPlanProposalBase,
  discardOutputPlanProposal, editOutputPlanCountField, editOutputPlanProposal, observeOutputPlanProposal,
  outputPlanConfirmationCanClose, outputPlanCountField, outputPlanFocusMayRestore,
  outputPlanProposalCanReapply, outputPlanProposalConflicts, outputPlanProposalHasInvalidFields,
  outputSavedPlanningOptions, readOutputPlanCountField, reapplyOutputPlanProposal, resolveOutputPlanningCountPolicy,
} from "../src/components/output-plan-proposal-state.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";

const scope = "synthetic-author:document-a:epoch-1";
const quantity = { kind: "range", unit: "slide", min: 5, max: 15 };
const clone = (value) => structuredClone(value);
function snapshot({ value = 8, key = "deck", kind = "flexible", revision = "head-1", requirementRevision = "requirements-1", sourceRevision = "source-1" } = {}) {
  const text = "An executive summary: one slideshow with 5–15 slides.";
  const spec = { schema_version: 1, id: "requirement-a", label: "Synthetic summary", original_text: text,
    value_origins: { interpretation_basis: { kind: "confirmed", text } }, deliverables: [{
      id: "deck", label: "Synthetic deck", media_kind: "slides", required: true,
      quantity: { kind: "exact", unit: "presentation", value: 1 }, content_quantity: clone(quantity),
      source_scope: { kind: "document" }, coverage: { kind: "document_outline" }, original_text: text, value_origins: {},
    }] };
  const policy = kind === "exact" ? { kind, unit: "slide", value } : { kind, unit: "slide", min: 5, max: 15, aim: value };
  return { documentId: "document-a", projectId: "project-a", scope: { kind: "personal", organizationId: null, projectAccessId: null, actorUserId: "synthetic-author" },
    revision, requirementRevision, sourceRevision,
    requirements: [{ blockId: "requirement-a", subtype: "Executive summary", content: text, locked: false, status: "valid", spec, preserved: null, issues: [], planSuggestions: { count_policies: { [key]: policy }, suggested_counts: kind === "flexible" ? { deck: value } : {} } }],
    confirmedPlan: null, permissions: { canAuthor: true, canRequest: true, canReview: true, canDownload: true, independentReview: false } };
}
const initial = (data = snapshot()) => observeOutputPlanProposal(null, data, scope);
const exactField = (value, aim = "") => ({ kind: "exact", exact: String(value), min: "5", max: "15", aim });
const editExact = (state, value, aim = "") => editOutputPlanCountField(state, "deck", quantity, exactField(value, aim));
const compile = (data, options) => compileOutputPlan(data.requirements.map((row) => row.spec), { document_id: data.documentId, source_revision: data.sourceRevision, requirement_revision: data.requirementRevision, ...options });

test("confirmation captures reject invalid raw amendment text before trimming or immutable commitment", () => {
  const data = snapshot();
  for (const raw of ["\ufeff", "Reason\u202e", "Reason\u200d", "Reason\u0000", "x".repeat(2001)]) {
    const state = editOutputPlanProposal(initial(data), { amendmentReason: raw });
    const refreshed = observeOutputPlanProposal(state, { ...data, revision: "unrelated-new-head" }, scope);
    assert.equal(refreshed.draft.amendmentReason, raw);
    assert.equal(captureOutputPlanConfirmation(refreshed, { ...data, revision: "unrelated-new-head" }, scope), null);
    assert.equal(state.draft.amendmentReason, raw);
  }
});

test("valid nonblank amendment captures retain exact spaces, tabs, and line breaks", () => {
  const data = snapshot();
  for (const raw of ["  Recipient-safe reason.\n\tKeep this wording.  ", "x".repeat(2000), "😀".repeat(1000)]) {
    const state = editOutputPlanProposal(initial(data), { amendmentReason: raw });
    assert.equal(captureOutputPlanConfirmation(state, data, scope).amendmentReason, raw);
  }
  const blank = editOutputPlanProposal(initial(data), { amendmentReason: " \t\r\n " });
  assert.equal(captureOutputPlanConfirmation(blank, data, scope).amendmentReason, "", "optional blank text may be absent only after validation");
});

test("a clean session hydrates a newer same-ID proposal, including qualified exact 11", () => {
  const old = snapshot();
  const latest = snapshot({ value: 11, key: "deck:slide", kind: "exact", revision: "head-2", requirementRevision: "requirements-2" });
  const state = observeOutputPlanProposal(initial(old), latest, scope);
  assert.equal(state.dirty, false);
  assert.equal(outputPlanCountField(state.draft.options, "deck", "deck", quantity).exact, "11");
  assert.equal(compile(latest, state.draft.options).targets[0].count_policy.value, 11);
  assert.equal(captureOutputPlanConfirmation(state, latest, scope).expectedRevision, "head-2");
});

test("same-row proposal changes are detected even if an upstream digest is accidentally unchanged", () => {
  const latest = snapshot({ value: 11, kind: "exact", revision: "head-2" });
  const state = observeOutputPlanProposal(editExact(initial(), 12), latest, scope);
  assert.equal(outputPlanProposalConflicts(state), true);
  assert.equal(captureOutputPlanConfirmation(state, latest, scope), null);
});

test("two sessions cannot silently overwrite a collaborator's saved exact-11 policy", () => {
  const shared = snapshot();
  const sessionA = editExact(initial(shared), 11);
  const sessionB = editExact(initial(shared), 12);
  const aRequest = captureOutputPlanConfirmation(sessionA, shared, scope);
  assert.equal(aRequest.options.count_policies["deck:slide"].value, 11);
  const savedA = snapshot({ value: 11, key: "deck:slide", kind: "exact", revision: "head-2", requirementRevision: "requirements-2" });
  const bAfterRefresh = observeOutputPlanProposal(sessionB, savedA, scope);
  assert.equal(bAfterRefresh.draft.options.count_policies["deck:slide"].value, 12);
  assert.equal(bAfterRefresh.latest.options.count_policies["deck:slide"].value, 11);
  assert.equal(captureOutputPlanConfirmation(bAfterRefresh, savedA, scope), null);
  assert.equal(reapplyOutputPlanProposal(bAfterRefresh), null);
  const acknowledged = acknowledgeOutputPlanProposal(bAfterRefresh, true);
  const staged = reapplyOutputPlanProposal(acknowledged);
  assert.ok(staged);
  assert.equal(staged.dirty, true);
  assert.equal(captureOutputPlanConfirmation(staged, savedA, scope).expectedRevision, "head-2");
  assert.equal(captureOutputPlanConfirmation(staged, savedA, scope).options.count_policies["deck:slide"].value, 12);
});

test("a newer semantic base is rejected at submit even before the observer ran", () => {
  const state = editExact(initial(), 11);
  assert.equal(captureOutputPlanConfirmation(state, snapshot({ revision: "head-2", sourceRevision: "source-2" }), scope), null);
  assert.equal(captureOutputPlanConfirmation(state, snapshot({ value: 12, kind: "exact", revision: "head-2" }), scope), null);
});

test("an unrelated owner head may refresh CAS without rebasing local choices", () => {
  const state = editExact(initial(), 11);
  const latest = snapshot({ revision: "head-for-unrelated-event" });
  const next = observeOutputPlanProposal(state, latest, scope);
  assert.equal(outputPlanProposalConflicts(next), false);
  assert.deepEqual(next.draft, state.draft);
  assert.equal(next.base.ownerRevision, latest.revision);
  assert.equal(captureOutputPlanConfirmation(state, latest, scope).expectedRevision, latest.revision);
});

test("source changes preserve raw fields, amendment reason, and optional selection", () => {
  let state = editExact(initial(), "", "8");
  state = editOutputPlanProposal(state, { amendmentReason: "Keep the intended scope.", options: { ...state.draft.options, selected_optional_ids: ["optional-a"] } });
  const draft = clone(state.draft);
  state = observeOutputPlanProposal(state, snapshot({ revision: "head-2", sourceRevision: "source-2" }), scope);
  assert.deepEqual(state.draft, draft);
  assert.equal(outputPlanProposalConflicts(state), true);
  assert.equal(outputPlanProposalHasInvalidFields(state), true);
});

test("acknowledgment is tied to the exact latest source and draft edit version", () => {
  let state = observeOutputPlanProposal(editExact(initial(), 11), snapshot({ revision: "head-2", sourceRevision: "source-2" }), scope);
  state = acknowledgeOutputPlanProposal(state, true);
  assert.equal(outputPlanProposalCanReapply(state), true);
  assert.equal(outputPlanProposalCanReapply(editExact(state, 12)), false);
  assert.equal(outputPlanProposalCanReapply(observeOutputPlanProposal(state, snapshot({ revision: "head-3", sourceRevision: "source-3" }), scope)), false);
  assert.equal(outputPlanProposalCanReapply(observeOutputPlanProposal(state, snapshot({ revision: "head-3", sourceRevision: "source-2" }), scope)), true);
});

test("discard loads the latest saved choices and clears only the local planning draft", () => {
  const latest = snapshot({ value: 11, key: "deck:slide", kind: "exact", revision: "head-2", requirementRevision: "requirements-2" });
  const dirty = editOutputPlanProposal(editExact(initial(), 12), { amendmentReason: "Local amendment" });
  const state = discardOutputPlanProposal(observeOutputPlanProposal(dirty, latest, scope));
  assert.equal(state.dirty, false);
  assert.deepEqual(state.draft.options, outputSavedPlanningOptions(latest));
  assert.deepEqual(state.draft.countFields, {});
  assert.equal(state.draft.amendmentReason, "");
  assert.equal(state.base.requirements[0].spec.original_text, latest.requirements[0].spec.original_text);
});

test("requirement membership and count changes trigger conflict without mutating either snapshot", () => {
  const latest = snapshot({ revision: "head-2" });
  latest.requirements[0].spec.deliverables[0].content_quantity.max = 10;
  latest.requirements[0].spec.deliverables[0].coverage = { kind: "topics", topics: ["Changed source section"] };
  const before = clone(latest);
  const state = observeOutputPlanProposal(editExact(initial(), 11), latest, scope);
  assert.equal(outputPlanProposalConflicts(state), true);
  const staged = reapplyOutputPlanProposal(acknowledgeOutputPlanProposal(state, true));
  assert.equal(outputPlanProposalHasInvalidFields(staged), true, "retained raw 11 must be validated against the new upper bound 10");
  assert.equal(captureOutputPlanConfirmation(staged, latest, scope), null);
  assert.deepEqual(latest, before);
});

test("qualified exact 11 takes precedence over a conflicting plain flexible policy", () => {
  const options = { count_policies: { deck: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 }, "deck:slide": { kind: "exact", unit: "slide", value: 11 } }, suggested_counts: { deck: 8 } };
  const field = outputPlanCountField(options, "deck", "deck", quantity);
  assert.equal(field.kind, "exact"); assert.equal(field.exact, "11"); assert.equal(field.aim, "8");
  const result = compile(snapshot(), options).targets[0];
  assert.equal(result.count_policy.value, 11);
  assert.equal(result.suggested_count, 8, "the separate aim is not rewritten to the accepted count");
});

test("editing a qualified exact policy replaces the effective alias, not an ignored plain key", () => {
  const data = snapshot({ value: 11, key: "deck:slide", kind: "exact" });
  data.requirements[0].planSuggestions.count_policies.deck = { kind: "exact", unit: "presentation", value: 1 };
  const next = editOutputPlanCountField(initial(data), "deck", quantity, { kind: "flexible", exact: "11", min: "5", max: "15", aim: "8" });
  const policies = next.draft.options.count_policies;
  assert.deepEqual(policies.deck, { kind: "exact", unit: "presentation", value: 1 }, "unrelated physical-file policy survives");
  assert.deepEqual(policies["deck:slide"], { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 });
  assert.equal(compile(data, next.draft.options).targets[0].count_policy.kind, "flexible");
});

test("same-unit plain aliases are removed while unrelated unit-qualified policies survive", () => {
  const state = initial();
  state.draft.options.count_policies["deck:presentation"] = { kind: "exact", unit: "presentation", value: 1 };
  const next = editExact(state, 11);
  assert.equal(next.draft.options.count_policies.deck, undefined);
  assert.equal(next.draft.options.count_policies["deck:presentation"].value, 1);
  assert.equal(next.draft.options.count_policies["deck:slide"].value, 11);
});

test("policy resolution matches subject/parent and unit precedence in the domain", () => {
  const options = { count_policies: { "child:slide": { kind: "exact", unit: "slide", value: 7 }, child: { kind: "exact", unit: "slide", value: 9 }, "deck:slide": { kind: "exact", unit: "slide", value: 11 }, deck: { kind: "exact", unit: "slide", value: 12 } } };
  assert.equal(resolveOutputPlanningCountPolicy(options, "child", "deck", "slide").policy.value, 7);
  delete options.count_policies["child:slide"];
  assert.equal(resolveOutputPlanningCountPolicy(options, "child", "deck", "slide").policy.value, 9);
  options.count_policies.child.unit = "presentation";
  assert.equal(resolveOutputPlanningCountPolicy(options, "child", "deck", "slide").policy.value, 11);
});

test("blank or invalid exact input is retained and cannot confirm the last valid policy", () => {
  for (const raw of ["", "0", "-1", "11.5", "1e1", "no", "１６"]) {
    const data = snapshot({ value: 11, key: "deck:slide", kind: "exact" });
    const state = editExact(initial(data), raw);
    assert.equal(state.draft.countFields["deck:slide"].field.exact, raw);
    assert.equal(state.draft.options.count_policies["deck:slide"].value, 11);
    assert.equal(outputPlanProposalHasInvalidFields(state), true);
    assert.equal(captureOutputPlanConfirmation(state, data, scope), null);
  }
});

test("blank aim stays absent, with no invented eight or zero", () => {
  const value = readOutputPlanCountField(quantity, { kind: "flexible", exact: "", min: "5", max: "15", aim: "" });
  assert.deepEqual(value, { policy: { kind: "flexible", unit: "slide", min: 5, max: 15 }, suggestedCount: null, invalid: false });
});

test("fractional seconds are valid but fractional slide counts are not", () => {
  const field = { kind: "flexible", exact: "", min: "5.5", max: "14.5", aim: "8.5" };
  assert.equal(readOutputPlanCountField({ ...quantity, unit: "second" }, field).invalid, false);
  assert.equal(readOutputPlanCountField(quantity, field).invalid, true);
  assert.equal(readOutputPlanCountField(quantity, { ...field, min: "5", max: "15", aim: "16" }).invalid, true);
});

test("explicit empty saved proposals clear an older policy rather than inheriting it", () => {
  const data = snapshot();
  data.confirmedPlan = { revisionId: "confirmed-1", requirementsDigest: "older-requirements", confirmationOptions: { count_policies: { "deck:slide": { kind: "exact", unit: "slide", value: 11 } } } };
  data.requirements[0].planSuggestions = {};
  assert.deepEqual(outputSavedPlanningOptions(data).count_policies, {});
});

test("a current confirmed plan retains its confirmed qualified choice", () => {
  const data = snapshot();
  data.confirmedPlan = { revisionId: "confirmed-1", requirementsDigest: data.requirementRevision, confirmationOptions: { count_policies: { "deck:slide": { kind: "exact", unit: "slide", value: 11 } } } };
  assert.equal(outputSavedPlanningOptions(data).count_policies["deck:slide"].value, 11);
});

test("a newer confirmed-plan choice is a semantic change even with unchanged source/requirements", () => {
  const data = snapshot();
  const edited = editExact(initial(data), 12);
  data.confirmedPlan = { revisionId: "confirmed-2", requirementsDigest: data.requirementRevision, confirmationOptions: { count_policies: { "deck:slide": { kind: "exact", unit: "slide", value: 11 } } } };
  const state = observeOutputPlanProposal(edited, data, scope);
  assert.equal(outputPlanProposalConflicts(state), true);
  assert.equal(state.latest.options.count_policies["deck:slide"].value, 11);
});

test("captured confirmation is immutable and a reply cannot close newer local edits", () => {
  const data = snapshot();
  const state = editExact(initial(data), 11);
  const captured = captureOutputPlanConfirmation(state, data, scope);
  const later = editExact(state, 12);
  assert.equal(captured.options.count_policies["deck:slide"].value, 11);
  assert.equal(outputPlanConfirmationCanClose(state, captured), true);
  assert.equal(outputPlanConfirmationCanClose(later, captured), false);
});

test("scope replacement clears another view's local planning draft and author loss blocks confirmation", () => {
  const data = snapshot();
  const state = editExact(initial(data), 11);
  assert.equal(captureOutputPlanConfirmation(state, data, "another-session"), null);
  assert.equal(observeOutputPlanProposal(state, data, "another-session").dirty, false);
  data.permissions.canAuthor = false;
  assert.equal(captureOutputPlanConfirmation(state, data, scope), null);
});

test("semantic comparison is insensitive to object property order, but sensitive to source/structure", () => {
  const a = snapshot(); const b = clone(a);
  b.requirements[0].planSuggestions.count_policies.deck = { aim: 8, max: 15, min: 5, unit: "slide", kind: "flexible" };
  assert.equal(captureOutputPlanProposalBase(a, scope).semanticKey, captureOutputPlanProposalBase(b, scope).semanticKey);
  b.requirements[0].locked = true;
  assert.notEqual(captureOutputPlanProposalBase(a, scope).semanticKey, captureOutputPlanProposalBase(b, scope).semanticKey);
});

test("focus may return only to a connected opener in the same Document/session/view epoch", () => {
  assert.equal(outputPlanFocusMayRestore("scope:doc:1", "scope:doc:1", true), true);
  assert.equal(outputPlanFocusMayRestore("scope:doc:1", "scope:doc:1", false), false);
  assert.equal(outputPlanFocusMayRestore("scope:doc:1", "scope:other:1", true), false);
  assert.equal(outputPlanFocusMayRestore("scope:doc:1", "scope:doc:2", true), false);
});
