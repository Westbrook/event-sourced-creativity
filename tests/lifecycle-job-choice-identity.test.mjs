// Shared lifecycle original-job choice regression. Actual current resolver,
// renderer and native choice-card code; finite read-safe DTO/native ports only.
// No Store/Worker authority, private-input read, provider, geometry or AT claim.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";

const fixtureUrl = new URL("./lifecycle-next-action-presentation.test.mjs", import.meta.url);
const existing = await readFile(fixtureUrl, "utf8");
const boundary = '\ntest("lifecycle fallback catalog uses one existing owner and complete equal four-locale keys"';
assert.equal(existing.split(boundary).length, 2, "reuse the current complete renderer declarations before its original cases");
let prefix = existing.slice(0, existing.indexOf(boundary));
prefix = prefix.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu, (_match, start, _quote, specifier) =>
  start + JSON.stringify(specifier.startsWith(".") ? new URL(specifier, fixtureUrl).href
    : specifier.startsWith("node:") ? specifier : import.meta.resolve(specifier)));
prefix = prefix.replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
const { renderer, cards, facts, job, freeze, renderNextActionCards } = await import(
  "data:text/javascript;base64," + Buffer.from(prefix + "\nexport { renderer, cards, facts, job, freeze, renderNextActionCards };\n").toString("base64"),
);

const originalIds = ["01990298-0123-7000-8000-00000000000a", "01990298-0123-7000-8000-00000000000b"];
const options = { concurrency: false, timeout: 30_000 };
const normalized = value => value.replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();

function jobsFor(scenario) {
  if (scenario === "unknown-pair") return originalIds.map(jobId => job({
    artifactKind: "slides", generationReceipt: { provider_request_status: "submission_unknown" },
  }, { jobId, requestedAt: "2026-08-27T10:00:00.000Z" }));
  const running = originalIds.map((jobId, index) => job({ artifactKind: index ? "audio" : "slides" }, {
    jobId, status: "running", requestedAt: index ? "2026-08-27T10:05:00.000Z" : "2026-08-27T10:00:00.000Z",
  }));
  return scenario === "singleton" ? running.slice(0, 1) : running;
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const scenario of ["singleton", "progress-pair", "unknown-pair"])
  test("C exact original job choice " + locale + " " + scenario, options, t => {
    const f = renderer(t, locale), jobs = jobsFor(scenario), state = freeze(facts({ jobs })), before = JSON.stringify(state);
    let reads = 0;
    t.mock.method(globalThis, "fetch", async () => { reads += 1; throw Error("Naming must not read private job input or any network"); });
    const actions = creativeNextActions(state), selected = [];
    const shown = cards(f.draw(() => renderNextActionCards(actions, f.i18n, action => selected.push(action))));
    const original = actions.flatMap((action, index) => action.target.kind === "job" ? [{ action, row: shown[index] }] : []);
    assert.equal(original.length, jobs.length);
    assert.ok(actions.length <= 3);
    assert.equal(shown.filter(row => row.node.attributes["data-primary"] === "true").length, 1);
    assert.deepEqual(new Set(original.map(value => value.action.target.jobId)), new Set(jobs.map(value => value.jobId)));
    assert.deepEqual(original.map(value => value.action.target.continuation), jobs.map(() => scenario === "unknown-pair" ? "unknown" : "progress"));
    // Exercise the unchanged native choice-card handler before the desired
    // naming assertion. A label defect must not be called a wrong-ID dispatch.
    for (const { action, row } of original) {
      row.button.handlers.click.call(row.button.owner, { currentTarget: row.button.port, target: row.button.port });
      assert.equal(selected.at(-1), action);
      assert.equal(selected.at(-1).target, action.target);
      assert.equal(Object.hasOwn(row.button.attributes, "aria-label"), false, "native name is the visible label plus explanation");
    }
    assert.deepEqual(selected.map(action => action.target.jobId), original.map(value => value.action.target.jobId));
    assert.equal(reads, 0); assert.equal(JSON.stringify(state), before);
    const names = original.map(({ row }) => ({ label: normalized(row.label), full: normalized(row.button.text), reason: normalized(row.reason) }));
    console.log(JSON.stringify({ kind: "current-lifecycle-job-choice", locale, scenario, targetIds: original.map(value => value.action.target.jobId),
      names, exactTargetCallbacks: true, reads, factsUnchanged: true, primaryCount: 1, totalCards: shown.length }));
    if (scenario === "singleton") {
      assert.equal(names[0].label, f.i18n.t("next.exact.check-job.label"), "one unambiguous job preserves the compact existing action");
    } else {
      assert.equal(new Set(names.map(value => value.label)).size, jobs.length,
        "different current originals need distinguishable visible labels, not identical generic continuation text");
      assert.equal(new Set(names.map(value => value.full)).size, jobs.length,
        "the native button names must expose the same distinction");
      for (const { action, row } of original) {
        const item = jobs.find(value => value.jobId === action.target.jobId);
        assert.ok(normalized(row.label).includes(f.i18n.t("artifact." + item.result.artifactKind + ".label")),
          "use the already-visible exact format as human context; do not reveal a hidden prompt");
      }
    }
    for (const name of names) for (const id of originalIds) assert.equal(name.label.includes(id), false,
      "complete opaque request IDs are not the default visible naming solution");
  });
