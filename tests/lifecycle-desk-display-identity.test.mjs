// Selected-Document Desk display regression. Actual resolver, pure Desk host,
// shared renderer and native choice-card code; finite read-safe DTO/native ports.
// No Store/Worker authority, private-input read, provider, geometry or AT claim.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
import { outcomeDeskHostActions, outcomeDeskPreparationActions } from "../src/canvas/outcome-desk-host.ts";

const fixtureUrl = new URL("./lifecycle-next-action-presentation.test.mjs", import.meta.url);
const existing = await readFile(fixtureUrl, "utf8");
const boundary = '\ntest("lifecycle fallback catalog uses one existing owner and complete equal four-locale keys"';
assert.equal(existing.split(boundary).length, 2, "reuse the current complete renderer declarations before its original cases");
let prefix = existing.slice(0, existing.indexOf(boundary));
prefix = prefix.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu, (_match, start, _quote, specifier) =>
  start + JSON.stringify(specifier.startsWith(".") ? new URL(specifier, fixtureUrl).href
    : specifier.startsWith("node:") ? specifier : import.meta.resolve(specifier)));
prefix = prefix.replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
const { renderer, cards, facts, job, artifact, review, input, freeze, renderNextActionCards, renderOutcomeDesk, deskPorts } = await import(
  "data:text/javascript;base64," + Buffer.from(prefix + "\nexport { renderer, cards, facts, job, artifact, review, input, freeze, renderNextActionCards, renderOutcomeDesk, deskPorts };\n").toString("base64"),
);


const ids = ["01990298-0123-7000-8000-00000000000a", "01990298-0123-7000-8000-00000000000b"];
const options = { concurrency: false, timeout: 30_000 };
const normalized = value => value.replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const board = "board-exact";
function scenarioFacts(scenario) {
  if (scenario === "reviews") return facts({ canvasId: board }, { reviews: ids.map((id, index) => ({
    ...review(), reviewId: id, artifactId: "artifact-" + id, title: index ? "Release notes" : "Annual summary",
  })) });
  if (scenario === "deliveries") {
    const artifacts = ids.map((id, index) => ({ ...artifact(), id, title: "Monthly briefing", sequence: index + 4, sourceEventId: "event-" + id }));
    return facts({ canvasId: board, artifacts }, { deliveries: artifacts.map(item => ({
      artifactId: item.id, sequence: item.sequence, revision: 0, sourceEventId: item.sourceEventId,
      contentRef: item.contentRef, action: "changes", intent: "review", proof: "exact-display-proof-" + item.id,
      title: item.title, reviewStatus: "changes-requested",
    })) });
  }
  const unknown = scenario === "unknown-jobs";
  return facts({ canvasId: board, jobs: ids.map((jobId, index) => job({
    artifactKind: unknown || !index ? "slides" : "audio",
    ...(unknown ? { generationReceipt: { provider_request_status: "submission_unknown" } } : {}),
  }, { jobId, canvasId: board, sourceSurface: "canvas", status: unknown ? "failed" : "running",
    requestedAt: unknown || !index ? "2026-08-27T10:00:00.000Z" : "2026-08-27T10:05:00.000Z" })) });
}
function deskTree(f, locale, current, selectedKey, candidates, render) {
  return f.draw(() => renderOutcomeDesk({ instanceId: "shared-display", canvasReturnFocusId: "canvas-heading", locale,
    route: "/canvas/" + board + "/board?posture=outcomes", current, selectedKey,
    recipeId: null, candidates, dismissedKeys: [] }, render));
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("C Desk display " + locale + " exact selected job and Other ways stay unchanged", options, t => {
    const f = renderer(t, locale), state = freeze(scenarioFacts("progress-jobs")), before = JSON.stringify(state), current = input(state), opened = [];
    let reads = 0;
    t.mock.method(globalThis, "fetch", async () => { reads += 1; throw Error("Display must not fetch"); });
    const p = deskPorts(f, current, value => opened.push(value));
    p.host.displayLocale = f.i18n;
    const selectedKey = "job:" + ids[0], candidates = outcomeDeskHostActions(current, selectedKey, p.host);
    assert.equal(candidates.length, 1); assert.equal(candidates[0].target.kind, "next");
    assert.equal(candidates[0].target.action.target.jobId, ids[0]);
    const shown = cards(deskTree(f, locale, current, selectedKey, candidates, p.render));
    assert.equal(shown.length, 1);
    assert.equal(shown[0].label, f.i18n.t("next.exact.check-job.label"));
    assert.equal(shown[0].reason, f.i18n.t("next.exact.check-job.reason"));
    shown[0].button.handlers.click.call(shown[0].button.owner, { currentTarget: shown[0].button.port, target: shown[0].button.port });
    assert.equal(opened[0], candidates[0]); assert.equal(opened[0].target, candidates[0].target);
    const preparations = outcomeDeskPreparationActions(current, selectedKey, p.host);
    const formats = ["image", "short_story", "scene", "slides", "storyboard", "video", "audio"];
    assert.deepEqual(preparations.map(value => value.target.action.target.medium), formats);
    assert.deepEqual(preparations.map(value => value.label), formats.map(format => f.i18n.t("artifact." + format + ".label", format)));
    assert.ok(preparations.every(value => value.subject.kind === "job" && value.subject.id === ids[0]));
    assert.equal(reads, 0); assert.equal(JSON.stringify(state), before);
  });

  for (const scenario of ["progress-jobs", "unknown-jobs", "reviews", "deliveries"])
    test("C Desk display " + locale + " document " + scenario, options, t => {
      const f = renderer(t, locale), state = freeze(scenarioFacts(scenario)), before = JSON.stringify(state), current = input(state), opened = [];
      let reads = 0;
      t.mock.method(globalThis, "fetch", async () => { reads += 1; throw Error("Display must not fetch private input"); });
      const p = deskPorts(f, current, value => opened.push(value));
      p.host.displayLocale = f.i18n;
      const actions = creativeNextActions(state), selectedKey = "document:" + state.documentId;
      const candidates = outcomeDeskHostActions(current, selectedKey, p.host);
      assert.equal(candidates.length, actions.length); assert.ok(candidates.length <= 3);
      for (let index = 0; index < actions.length; index++) {
        assert.equal(candidates[index].target.kind, "next"); assert.deepEqual(candidates[index].target.action, actions[index]);
        assert.equal(candidates[index].key, selectedKey + ":" + actions[index].id + ":" + JSON.stringify(actions[index].target));
        assert.equal(candidates[index].subject.kind, "document"); assert.equal(candidates[index].subject.id, state.documentId);
        assert.equal(candidates[index].detail, f.i18n.t(actions[index].reasonKey ?? "next.exact." + actions[index].id + ".reason", actions[index].reason));
        assert.equal(p.render.available(candidates[index], current), true);
      }
      const direct = cards(f.draw(() => renderNextActionCards(actions, f.i18n, () => assert.fail("rendering cannot execute"))));
      const shown = cards(deskTree(f, locale, current, selectedKey, candidates, p.render));
      assert.equal(shown.length, actions.length);
      assert.deepEqual(shown.map(value => value.node.attributes["data-primary"]), actions.map((_value, index) => String(index === 0)));
      for (let index = 0; index < shown.length; index++) {
        const row = shown[index];
        assert.equal(row.button.attributes["data-choice-value"], candidates[index].key);
        row.button.handlers.click.call(row.button.owner, { currentTarget: row.button.port, target: row.button.port });
        assert.equal(opened.at(-1), candidates[index]); assert.equal(opened.at(-1).target, candidates[index].target);
      }
      assert.equal(reads, 0); assert.equal(JSON.stringify(state), before);
      const subjectKind = scenario === "reviews" ? "assigned-review" : scenario === "deliveries" ? "artifact-delivery" : "job";
      const selected = actions.flatMap((action, index) => action.target.kind === subjectKind ? [{ action, row: shown[index], direct: direct[index] }] : []);
      assert.equal(selected.length, 2);
      console.log(JSON.stringify({ kind: "current-document-desk-display", locale, scenario,
        labels: selected.map(value => normalized(value.row.label)), nativeNames: selected.map(value => normalized(value.row.button.text)),
        exactTargets: selected.map(value => value.action.target), exactCallbacks: true, reads, factsUnchanged: true, totalCards: shown.length }));
      // These are the intended baseline failures, after all exact-action and no-read assertions.
      assert.equal(new Set(selected.map(value => normalized(value.row.label))).size, 2, "different current originals need distinct visible choices");
      assert.equal(new Set(selected.map(value => normalized(value.row.button.text))).size, 2, "native names must expose the same distinction");
      assert.deepEqual(shown.map(value => value.label), direct.map(value => value.label), "Document-level Desk shares the complete display labels");
      for (const { action, row } of selected) {
        if (action.target.kind === "job") {
          const item = state.jobs.find(value => value.jobId === action.target.jobId);
          assert.ok(normalized(row.label).includes(f.i18n.t("artifact." + item.result.artifactKind + ".label")));
        } else assert.ok(normalized(row.label).includes(action.title), "exact authored titles remain visible");
        for (const id of ids) assert.equal(row.label.includes(id), false, "opaque IDs are not the default label");
      }
      const reversed = freeze({ ...state, jobs: [...state.jobs].reverse(),
        lifecycle: { ...state.lifecycle, reviews: [...state.lifecycle.reviews].reverse(), deliveries: [...state.lifecycle.deliveries].reverse() } });
      const remapped = outcomeDeskHostActions(input(reversed), selectedKey, p.host);
      assert.deepEqual(new Map(remapped.map(value => [value.key, value.label])), new Map(candidates.map(value => [value.key, value.label])),
        "stable exact-identity qualifiers do not depend on incoming list order");
    });
}
