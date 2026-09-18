import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTOR_ID, EVALUATION_DAY, FACTS, FIXTURE_VERSION, QUESTIONS,
  factsAt, referenceFacts, scoreAnswer,
} from "../worker/memory-benchmark/fixtures.ts";

// This suite is entirely local, including its guard against accidental fetches.
globalThis.fetch = async () => { throw new Error("Network forbidden in synthetic fixture tests."); };

const q = (id) => {
  const value = QUESTIONS.find((question) => question.id === id);
  assert.ok(value, `question exists: ${id}`);
  return value;
};
const answer = (text, ids = [], abstain = false) => ({ answer: text, factIds: ids, abstain });

test("corpus is bounded, diverse, immutable, and has exactly 50 day-20 questions", () => {
  assert.equal(FIXTURE_VERSION, "synthetic-memory-2026-09-v1");
  assert.equal(EVALUATION_DAY, 20);
  assert.equal(FACTS.length, 64);
  assert.equal(QUESTIONS.length, 50);
  assert.equal(new Set(FACTS.map(({ id }) => id)).size, FACTS.length);
  assert.equal(new Set(QUESTIONS.map(({ id }) => id)).size, QUESTIONS.length);
  assert.deepEqual([...new Set(FACTS.map(({ day }) => day))].sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual(new Set(FACTS.map(({ kind }) => kind)), new Set(["chat", "document", "block", "action"]));
  assert.deepEqual(new Set(FACTS.map(({ scopeId }) => scopeId.split(":")[0])), new Set(["global", "org", "project", "document", "block"]));
  assert.equal(QUESTIONS.filter(({ mustAbstain }) => mustAbstain).length, 8);
  assert.ok(Object.isFrozen(FACTS));
  assert.ok(Object.isFrozen(QUESTIONS));
  assert.ok(FACTS.every(Object.isFrozen));
  assert.ok(QUESTIONS.every((item) => Object.isFrozen(item) && Object.isFrozen(item.allowedScopeIds)));
});

test("all question evidence references exist and required evidence is accessible at evaluation", () => {
  const allIds = new Set(FACTS.map(({ id }) => id));
  for (const question of QUESTIONS) {
    assert.equal(question.actorId, ACTOR_ID);
    assert.ok(question.allowedScopeIds.includes(question.preferredScopeId));
    const eligible = new Set(factsAt(20, question.actorId, question.allowedScopeIds).map(({ id }) => id));
    assert.ok(question.forbiddenFactIds.length > 0, question.id);
    for (const id of [...question.requiredFactIds, ...question.forbiddenFactIds]) assert.ok(allIds.has(id), `${question.id}: ${id}`);
    for (const id of question.requiredFactIds) {
      assert.ok(eligible.has(id), `${question.id} required: ${id}`);
      assert.ok(!question.forbiddenFactIds.includes(id), `${question.id} contradictory key: ${id}`);
    }
  }
});

test("factsAt applies exact actor and scope access without hierarchy inference", () => {
  const project = factsAt(20, ACTOR_ID, ["project:harbor"]);
  assert.ok(project.length > 0);
  assert.ok(project.every(({ actorId, scopeId }) => actorId === ACTOR_ID && scopeId === "project:harbor"));
  assert.ok(!project.some(({ id }) => id === "f50" || id === "f23" || id === "f53"));
  assert.deepEqual(factsAt(20, ACTOR_ID, []), []);
  assert.deepEqual(factsAt(20, ACTOR_ID, ["project:harbor-extra"]), []);
  assert.deepEqual(factsAt(20, "synthetic:alex-extra"), []);
  assert.deepEqual(factsAt(20, "synthetic:blair", ["project:harbor"]).map(({ id }) => id), ["f50"]);
  assert.ok(factsAt(20, ACTOR_ID, ["project:grove"]).some(({ id }) => id === "f53"));
});

test("factsAt respects creation, correction, deletion, and inclusive withdrawal boundaries", () => {
  assert.ok(factsAt(13, ACTOR_ID).some(({ id }) => id === "f02"));
  assert.ok(!factsAt(13, ACTOR_ID).some(({ id }) => id === "f03"));
  assert.ok(!factsAt(14, ACTOR_ID).some(({ id }) => id === "f02"));
  assert.ok(factsAt(14, ACTOR_ID).some(({ id }) => id === "f03"));
  assert.ok(factsAt(17, ACTOR_ID).some(({ id }) => id === "f47"));
  assert.ok(!factsAt(18, ACTOR_ID).some(({ id }) => id === "f47"));
  assert.ok(factsAt(18, ACTOR_ID).some(({ id }) => id === "f49"));
  assert.ok(!factsAt(19, ACTOR_ID).some(({ id }) => id === "f49"));
  assert.ok(!factsAt(19, ACTOR_ID).some(({ id }) => id === "f44"));
  for (const invalid of [0, 21, -1, 1.5, NaN, Infinity]) assert.throws(() => factsAt(invalid, ACTOR_ID), RangeError);
});

test("reference retrieval is deterministic, capped, and access-first for every question", () => {
  for (const question of QUESTIONS) {
    const selected = referenceFacts(question);
    const eligible = new Set(factsAt(20, question.actorId, question.allowedScopeIds).map(({ id }) => id));
    assert.ok(selected.length <= 8, question.id);
    assert.ok(selected.every(({ id }) => eligible.has(id)), question.id);
    assert.deepEqual(selected, referenceFacts(question));
    assert.equal(new Set(selected.map(({ id }) => id)).size, selected.length);
  }
  assert.ok(referenceFacts(q("q13")).some(({ id }) => id === "f16"));
  assert.ok(!referenceFacts(q("q13")).some(({ id }) => id === "f50" || id === "f53"));
});

test("reference retrieval does not consult answer keys and prefers explicit scope on a lexical tie", () => {
  const question = q("q14");
  assert.deepEqual(referenceFacts(question), referenceFacts({ ...question, requiredFactIds: ["f50"], forbiddenFactIds: FACTS.map(({ id }) => id) }));
  const matched = referenceFacts(question);
  const preferredIndex = matched.findIndex(({ id }) => id === "f17");
  const broaderIndex = matched.findIndex(({ id }) => id === "f64");
  assert.ok(preferredIndex >= 0);
  assert.ok(broaderIndex < 0 || preferredIndex < broaderIndex);
  assert.deepEqual(referenceFacts({ ...question, allowedScopeIds: [] }), []);
});

test("valid source citations alone do not pass an incorrect answer", () => {
  const score = scoreAnswer(q("q13"), answer("The owner is Robin.", ["f16"]));
  assert.equal(score.requiredEvidenceRecall, 1);
  assert.equal(score.citationValid, true);
  assert.equal(score.answerTextCorrect, false);
  assert.equal(score.textReviewNeeded, true);
  assert.equal(score.passed, false);
});

test("correct text without required evidence does not pass", () => {
  const score = scoreAnswer(q("q13"), answer("Mina owns Harbor."));
  assert.equal(score.requiredEvidenceRecall, 0);
  assert.equal(score.answerTextCorrect, true);
  assert.equal(score.passed, false);
});

test("correct text and valid evidence pass, and duplicate citations do not inflate recall", () => {
  const score = scoreAnswer(q("q41"), answer("The ceiling is 240 dollars; the risk is scanner battery depletion.", ["f57", "f57"]));
  assert.equal(score.requiredEvidenceRecall, 0.5);
  assert.equal(score.answerTextCorrect, true);
  assert.equal(score.passed, false);
  const complete = scoreAnswer(q("q41"), answer("The ceiling is 240 dollars; the risk is scanner battery depletion.", ["f57", "f58", "f58"]));
  assert.equal(complete.requiredEvidenceRecall, 1);
  assert.equal(complete.passed, true);
});

test("unknown citations are invalid and inaccessible known citations are also forbidden", () => {
  const score = scoreAnswer(q("q13"), answer("Mina owns Harbor.", ["f16", "missing-id", "f50", "f53", "f14", "f50"]));
  assert.deepEqual(score.invalidEvidenceIds, ["missing-id", "f50", "f53", "f14"]);
  assert.deepEqual(score.forbiddenEvidenceIds, ["f50", "f53", "f14"]);
  assert.equal(score.requiredEvidenceRecall, 1);
  assert.equal(score.citationValid, false);
  assert.equal(score.passed, false);
});

test("explicitly wrong-scope provenance fails even when the source is otherwise accessible", () => {
  const score = scoreAnswer(q("q14"), answer("Use a checklist.", ["f17", "f64"]));
  assert.deepEqual(score.invalidEvidenceIds, []);
  assert.deepEqual(score.forbiddenEvidenceIds, ["f64"]);
  assert.equal(score.passed, false);
});

test("abstention flag is scored separately from evidence and answer text", () => {
  const valid = scoreAnswer(q("q48"), answer("I cannot identify Grove's owner from Harbor's context.", [], true));
  assert.equal(valid.requiredEvidenceRecall, null);
  assert.equal(valid.abstentionCorrect, true);
  assert.equal(valid.answerTextCorrect, true);
  assert.equal(valid.passed, true);
  assert.equal(scoreAnswer(q("q48"), answer("I cannot identify Grove's owner from Harbor's context.")).abstentionCorrect, false);
  assert.equal(scoreAnswer(q("q13"), answer("Mina owns Harbor.", ["f16"], true)).abstentionCorrect, false);
  assert.equal(scoreAnswer(q("q48"), answer("", [], true)).passed, false);
});

test("deleted or another actor's content cannot be disclosed behind an abstention flag", () => {
  const deleted = scoreAnswer(q("q44"), answer("I cannot access the deleted scratch note, but it said porcelain.", [], true));
  assert.deepEqual(deleted.forbiddenTextMatches, ["porcelain"]);
  assert.equal(deleted.answerTextCorrect, false);
  assert.equal(deleted.passed, false);
  const otherActor = scoreAnswer(q("q47"), answer("I cannot access Blair's private notes, but the owner is Taro.", ["f50"], true));
  assert.deepEqual(otherActor.forbiddenEvidenceIds, ["f50"]);
  assert.deepEqual(otherActor.forbiddenTextMatches, ["Taro"]);
  assert.equal(otherActor.passed, false);
  const uncited = scoreAnswer(q("q01"), answer("Use two sentences followed by a next step; Taro owns Harbor.", ["f01"]));
  assert.deepEqual(uncited.forbiddenTextMatches, ["Taro"]);
  assert.equal(uncited.passed, false);
});

test("exposure does not establish reading completion or inferred preference", () => {
  const reading = scoreAnswer(q("q49"), answer("A scroll event does not establish reading completion.", ["f43"], true));
  const preference = scoreAnswer(q("q50"), answer("I cannot infer a preference from focus returns.", ["f42"], true));
  assert.equal(reading.passed, true);
  assert.equal(preference.passed, true);
  const invented = scoreAnswer(q("q49"), answer("You completed reading because you scrolled.", ["f43"]));
  assert.equal(invented.requiredEvidenceRecall, 1);
  assert.equal(invented.abstentionCorrect, false);
  assert.equal(invented.answerTextCorrect, false);
  assert.equal(invented.passed, false);
  const overclaimed = scoreAnswer(q("q35"), answer("You opened the brief four times and understood it.", ["f41"]));
  assert.equal(overclaimed.textReviewNeeded, true);
  assert.equal(overclaimed.passed, false);
});

test("a correct set of checklist keywords in the wrong order does not pass", () => {
  const reversed = scoreAnswer(q("q31"), answer("Confirm borrower, scan item, verify shelf.", ["f36"]));
  assert.equal(reversed.requiredEvidenceRecall, 1);
  assert.equal(reversed.answerTextCorrect, false);
  assert.equal(reversed.passed, false);
});

test("local negations and competing revisions are not counted as automatic text correctness", () => {
  const negated = scoreAnswer(q("q13"), answer("The owner is not Mina.", ["f16"]));
  assert.equal(negated.answerTextCorrect, false);
  assert.equal(negated.textReviewNeeded, true);
  assert.equal(negated.passed, false);
  const contrast = scoreAnswer(q("q12"), answer("October 19, not October 12.", ["f15"]));
  assert.equal(contrast.answerTextCorrect, true);
  assert.equal(contrast.textReviewNeeded, true);
  assert.equal(contrast.passed, false);
});

test("stale revision text is caught when an otherwise correct answer omits stale citations", () => {
  const cases = [
    ["q01", "Use two sentences followed by a next step; use 12-hour time.", "12-hour"],
    ["q09", "An owner and a next step; use violet for the organization.", "violet"],
    ["q13", "Mina owns Harbor; launch on October 12.", "October 12"],
    ["q20", "Harbor pilot brief; cite checkout-audit-v1.csv.", "checkout-audit-v1.csv"],
    ["q26", "Use a manual checkout sheet; deliver the notice by email.", "email"],
  ];
  for (const [id, text, stale] of cases) {
    const question = q(id);
    const score = scoreAnswer(question, answer(text, [...question.requiredFactIds]));
    assert.equal(score.requiredEvidenceRecall, 1, id);
    assert.equal(score.citationValid, true, id);
    assert.ok(score.staleTextMatches.includes(stale), id);
    assert.equal(score.textReviewNeeded, true, id);
    assert.equal(score.passed, false, id);
  }
});

test("unknown or modified question rubrics require text review instead of borrowed accuracy", () => {
  const score = scoreAnswer({ ...q("q13"), text: "Who owns a different pilot?" }, answer("Mina.", ["f16"]));
  assert.equal(score.answerTextCorrect, null);
  assert.equal(score.textReviewNeeded, true);
  assert.equal(score.passed, false);
});

test("all 50 deterministic reference answers can be scored without any provider", () => {
  const examples = [
    "Use two sentences followed by a next step.", "Use 24-hour format.", "Use metric units.",
    "Ask for confirmation before sharing.", "Use navy.", "A FieldNote.",
    "Redact personal contact details.", "UTC.", "An owner and a next step.",
    "Library inventory checkouts.", "Keyboard-first.", "October 19.", "Mina.", "A checklist.",
    "No external calendar sync.", "Duplicate checkouts.", "Confirmation is required.", "Six librarians.",
    "48 hours before the start.", "Harbor pilot brief.", "Under 90 seconds.", "Under 5 percent.",
    "Short headers.", "checkout-audit-v2.csv.", "A signed-in announcement.", "A manual checkout sheet.",
    "Oren.", "Weekday mornings.", "Alt text.", "Text labels.",
    "Verify shelf, scan item, confirm borrower.", "Borrower confirmation.", "Offline mode is unavailable.",
    "Reconnect and retry; there is no silent offline queue.", "Opened four times.", "Three focus returns.",
    "Scrolled to 80 percent.", "Changed the title twice.", "Accepted median checkout time.",
    "Dismissed auto-confirm borrower.", "240 dollars; scanner battery depletion.",
    "Pause for any duplicate checkout; keyboard focus must be visible; two people review.",
    "I cannot find the lease price in accessible evidence.", "I cannot recover the deleted scratch note.",
    "I cannot recover the deleted archive codename.", "I cannot access the revoked review date.",
    "I cannot access Blair's private notes.", "I cannot identify Grove's owner from Harbor's context.",
    "A scroll event does not establish reading completion.", "I cannot infer a preference from focus returns.",
  ];
  assert.equal(examples.length, QUESTIONS.length);
  for (const [index, question] of QUESTIONS.entries()) {
    const score = scoreAnswer(question, answer(examples[index], [...question.requiredFactIds], question.mustAbstain));
    assert.equal(score.passed, true, `${question.id}: ${JSON.stringify(score)}`);
  }
});

test("fetch is forbidden in this exact-file suite", async () => {
  await assert.rejects(() => fetch("https://example.invalid"), /Network forbidden/);
});
