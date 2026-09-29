import assert from "node:assert/strict";
import { test } from "node:test";
import { paginateSceneLines, SCENE_PAGINATION_POLICY as policy } from "../src/model/scene-pagination.ts";

const literal = (count, prefix = "line") => Array.from({ length: count }, (_, index) => prefix + " " + index);
const heading = (lines = ["INT. HARBOR OFFICE · DUSK"]) => ({ role: "heading", sourceIndex: -1, lines });
const action = (sourceIndex, lines) => ({ role: "action", sourceIndex, lines });
const dialogue = (sourceIndex, speaker, lines, cueLines = [speaker], parentheticalLines = []) =>
  ({ role: "dialogue", sourceIndex, speaker, cueLines, parentheticalLines, lines });
const expectedAuthored = (groups) => groups.flatMap((group) => {
  const roles = group.role === "dialogue"
    ? [["cue", group.cueLines], ["parenthetical", group.parentheticalLines], ["dialogue", group.lines]]
    : [[group.role, group.lines]];
  return roles.flatMap(([role, lines]) => lines.map((text, lineIndex) => ({ role, sourceIndex: group.sourceIndex, lineIndex, text })));
});
const actualAuthored = (result) => result.pages.flatMap((page) => page.lines)
  .filter((line) => !line.derived).map(({ role, sourceIndex, lineIndex, text }) => ({ role, sourceIndex, lineIndex, text }));
const complete = (groups) => {
  const result = paginateSceneLines(groups);
  assert.notEqual(result.status, "unqualified");
  assert.deepEqual(actualAuthored(result), expectedAuthored(groups));
  assert.equal(result.sourceLineCount, expectedAuthored(groups).length);
  assert.equal(result.pageCount, result.pages.length);
  for (const [index, page] of result.pages.entries()) {
    assert.equal(page.pageNumber, index + 1);
    assert.ok(page.lines.length > 0);
    assert.ok(page.usedRows <= 40);
    assert.equal(page.usedRows, page.lines.at(-1).row + 1);
    let priorRow = -1;
    for (const line of page.lines) {
      assert.ok(line.row > priorRow && line.row >= 0 && line.row < 40);
      assert.equal(line.topPt, 72 + line.row * 16);
      assert.ok(line.topPt + 16 <= 792 - 72);
      assert.ok(line.leftPt >= 108 && line.leftPt + line.widthPt <= 612 - 72);
      priorRow = line.row;
    }
  }
  const used = result.pages.reduce((sum, page) => sum + page.usedRows, 0);
  assert.equal(used, result.sourceLineCount + result.derivedLineCount + result.gapRows);
  return result;
};

test("fixed Letter/DM Mono policy and deterministic complete geometry", () => {
  assert.deepEqual(
    [policy.pageWidthPt, policy.pageHeightPt, policy.marginTopPt, policy.marginBottomPt,
      policy.marginLeftPt, policy.marginRightPt, policy.usableHeightPt, policy.fontFamily,
      policy.fontSizePt, policy.lineHeightPt, policy.linesPerPage, policy.maximumQualifiedPages],
    [612, 792, 72, 72, 108, 72, 648, "DM Mono", 12, 16, 40, 2],
  );
  assert.equal(policy.qualification, "packing-only");
  const groups = [heading(), action(0, literal(3)), dialogue(1, "A", literal(2, "A")),
    dialogue(2, "B", literal(2, "B"), ["B · Noor"], ["(quietly)"])];
  const result = complete(groups);
  assert.equal(result.status, "packed");
  assert.deepEqual(result, paginateSceneLines(groups));
  const all = result.pages.flatMap((page) => page.lines);
  assert.deepEqual(all.filter((line) => line.role === "parenthetical").map((line) => [line.leftPt, line.widthPt]), [[252, 180]]);
  assert.ok(all.filter((line) => ["cue", "dialogue"].includes(line.role)).every((line) => line.leftPt === 216 && line.widthPt === 252));
});

test("heading stays with the first two available action lines; boundary gaps are omitted", () => {
  const groups = [heading(literal(37, "heading")), action(0, literal(4, "action"))];
  const result = complete(groups);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].usedRows, 40);
  assert.deepEqual(result.pages[0].lines.filter((line) => line.role === "action").map((line) => line.lineIndex), [0, 1]);
  assert.deepEqual(result.pages[1].lines.map((line) => [line.lineIndex, line.row]), [[2, 0], [3, 1]]);
  assert.equal(result.gapRows, 1);
  const single = complete([heading(literal(38)), action(0, [""])]);
  assert.equal(single.pageCount, 1);
  assert.equal(single.pages[0].usedRows, 40);
});

test("wrapped cues/parentheticals keep two dialogue lines and continuations are separately derived", () => {
  const cue = ["A ·  Amélie", "  عبد النور 👩🏽‍🚀"];
  const parenthetical = ["(in a low", "  voice)"];
  const groups = [heading(), action(0, literal(34)), dialogue(1, "A", literal(70, "speech"), cue, parenthetical)];
  const result = complete(groups);
  assert.equal(result.status, "too-long");
  assert.equal(result.pages[0].lines.some((line) => line.sourceIndex === 1), false);
  const initial = result.pages[1].lines;
  assert.deepEqual(initial.slice(0, 6).map((line) => line.role), ["cue", "cue", "parenthetical", "parenthetical", "dialogue", "dialogue"]);
  const continued = result.pages[2].lines;
  assert.deepEqual(continued.slice(0, 5).map((line) => line.role), ["cue", "cue", "continuation", "dialogue", "dialogue"]);
  assert.deepEqual(continued.slice(0, 2).map((line) => [line.text, line.lineIndex, line.derived]), [[cue[0], 0, true], [cue[1], 1, true]]);
  assert.equal(continued[2].text, "(CONT'D)");
  assert.equal(continued[2].lineIndex, null);
  assert.equal(continued[2].derived, true);
  assert.equal(continued[3].lineIndex, 36);
  assert.equal(result.pages.flatMap((page) => page.lines).filter((line) => line.role === "parenthetical").length, 2);
  assert.deepEqual(groups[2].lines, literal(70, "speech"));
});

test("exact two pages fit; a third page is explicit and complete, never clipped", () => {
  const fit = complete([heading(), action(0, literal(78))]);
  assert.equal(fit.status, "packed");
  assert.equal(fit.pageCount, 2);
  assert.deepEqual(fit.pages.map((page) => page.usedRows), [40, 40]);
  const tooLong = complete([heading(), action(0, literal(79))]);
  assert.equal(tooLong.status, "too-long");
  assert.equal(tooLong.pageCount, 3);
  assert.equal(tooLong.pages[2].lines[0].text, "line 78");
  assert.deepEqual(tooLong.pages.map((page) => page.usedRows), [40, 40, 1]);
  assert.deepEqual(tooLong.groups, [heading(), action(0, literal(79))]);
});

test("literal empty/Unicode/whitespace lines and private immutable snapshots survive", () => {
  const groups = [heading(["INT.  غرفة · 夜"]), action(0, ["", "  e\u0301 👩🏽‍🚀  ", "<script>literal</script>"]),
    dialogue(1, "B", [" ", "", "عَرَبِيّ 日本語"], ["B · 李  "], ["(  )"])];
  const result = complete(groups);
  const before = actualAuthored(result);
  groups[1].lines[1] = "changed";
  groups[2].cueLines.push("changed");
  assert.deepEqual(actualAuthored(result), before);
  assert.equal(result.groups[1].lines[1], "  e\u0301 👩🏽‍🚀  ");
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.pages) && Object.isFrozen(result.groups));
  assert.ok(Object.isFrozen(result.pages[0]) && Object.isFrozen(result.pages[0].lines) && Object.isFrozen(result.pages[0].lines[0]));
  assert.ok(Object.isFrozen(result.groups[2].cueLines));
  assert.throws(() => { result.pages[0].lines[0].text = "changed"; }, TypeError);
});

test("impossible keeps and malformed measurements refuse without returning a partial document", () => {
  const cases = [
    [[heading(literal(38)), action(0, ["one", "two"])], "heading-keep-too-tall"],
    [[heading(), action(0, ["one"]), dialogue(1, "A", ["one", "two"], ["A"], literal(38))], "dialogue-keep-too-tall"],
    [[heading(), action(0, ["one"]), dialogue(1, "A", literal(4), literal(38), [])], "dialogue-keep-too-tall"],
    [[heading(), action(2, ["one"])], "invalid-measurement"],
    [[heading(), action(0, ["one\ntwo"])], "invalid-measurement"],
    [[heading(), action(0, [])], "invalid-measurement"],
    [[heading(), action(0, ["one"]), dialogue(1, "C", ["one"])], "invalid-measurement"],
    [[heading(), action(0, new Array(2))], "invalid-measurement"],
    [[heading(), action(0, ["x".repeat(policy.maximumLineCodeUnits + 1)])], "invalid-measurement"],
    [[heading(), ...Array.from({ length: 129 }, (_, index) => action(index, ["one"]))], "invalid-measurement"],
  ];
  for (const [groups, reason] of cases) {
    const result = paginateSceneLines(groups);
    assert.equal(result.status, "unqualified");
    assert.equal(result.reason, reason);
    assert.deepEqual(result.pages, []);
  }
  // A tall cue is valid when the actual remaining body fits; do not reject a
  // continuation that never occurs or invent a second authored line.
  assert.equal(complete([heading(), action(0, ["one"]), dialogue(1, "A", ["one"], literal(39))]).status, "packed");
  const oneRemaining = complete([heading(), action(0, ["one"]), dialogue(1, "A", literal(3), literal(38))]);
  assert.equal(oneRemaining.pages.at(-1).lines.at(-1).lineIndex, 2);
});

test("rejects caller-controlled array iterators, getters, sparse or nonplain inputs without invoking them", () => {
  let iteratorCalls = 0, getterCalls = 0;
  const fresh = () => [heading(), action(0, ["literal"]), dialogue(1, "A", ["speech"], ["A · Name"], [])];
  const badArrays = () => [
    Object.assign(["literal"], {
      [Symbol.iterator]: function* () { iteratorCalls += 1; yield "substituted"; yield "extra"; },
    }),
    Object.defineProperty(["literal"], "0", {
      enumerable: true, configurable: true,
      get() { getterCalls += 1; throw new Error("indexed getter must not run"); },
    }),
    new Array(1),
    new (class extends Array {})("literal"),
    Object.assign(["literal"], { extra: "not a measured line" }),
    Object.defineProperty(["literal"], "hidden", { value: true }),
    Object.assign(["literal"], { [Symbol("extra")]: true }),
  ];
  const refused = (groups) => {
    const result = paginateSceneLines(groups);
    assert.equal(result.status, "unqualified");
    assert.equal(result.reason, "invalid-measurement");
    assert.deepEqual(result.pages, []);
  };
  for (const field of ["lines", "cueLines", "parentheticalLines"]) {
    for (const array of badArrays()) {
      const groups = fresh();
      groups[2][field] = array;
      refused(groups);
    }
  }
  const outer = fresh();
  outer[Symbol.iterator] = function* () { iteratorCalls += 1; yield heading(); };
  refused(outer);
  const outerGetter = fresh();
  Object.defineProperty(outerGetter, "1", {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; throw new Error("outer getter must not run"); },
  });
  refused(outerGetter);
  const groupGetter = fresh();
  Object.defineProperty(groupGetter[1], "lines", {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; throw new Error("group getter must not run"); },
  });
  refused(groupGetter);
  assert.equal(iteratorCalls, 0);
  assert.equal(getterCalls, 0);
  const normal = complete(fresh());
  assert.equal(normal.status, "packed");
  assert.deepEqual(normal.pages[0].lines.map((line) => line.row), [0, 2, 4, 5]);
});

