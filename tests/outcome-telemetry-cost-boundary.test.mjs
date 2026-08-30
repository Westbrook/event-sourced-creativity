import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { FORMA_OUTCOME_MESSAGES } from "../src/components/design-system/locales/outcome-messages.ts";

// Reuse the existing complete Analytics/Account/Workspace class fixture and real
// report model. Only its documented DOM, transport, cache and locale ports are
// synthetic. This is presentation evidence, not real Store/Worker authorization,
// provider spend, an invoice, physical browser/AT, delivery or scheduler proof.
const fixtureUrl = new URL("./outcome-telemetry-host.test.mjs", import.meta.url);
const fixtureSource = readFileSync(fixtureUrl, "utf8");
const fixtureTree = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstCase = fixtureTree.statements.find(ts.isForOfStatement);
assert.ok(firstCase);
const fixtureModule = fixtureUrl.href + "?cost-label-boundary";
const fixtureHook = registerHooks({ load(url, context, next) {
  return url === fixtureModule ? { format: "module", source: fixtureSource.slice(0, firstCase.getStart(fixtureTree))
    + "\nexport {fixture,report,event,live};\n", shortCircuit: true } : next(url, context);
} });
const { fixture, report, event, live } = await import(fixtureModule).finally(() => fixtureHook.deregister());
const expectedLabels = {
  "en": "Event cost · recorded + estimated",
  "fr": "Coût des événements · enregistré + estimé",
  "ar": "تكلفة الأحداث · مسجّلة وتقديرية",
  "ja": "イベント費用（記録額＋推計額）"
};
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function leadingMetric(markup) {
  const start = markup.indexOf('<section class="analytics-overview"');
  assert.ok(start >= 0, "the complete current host renders its existing leading overview");
  const end = markup.indexOf("</section>", start);
  assert.ok(end > start);
  const overview = markup.slice(start, end);
  const metrics = [...overview.matchAll(/<forma-ui-metric \.label=([\s\S]*?) \.value=([\s\S]*?) \.detail=([\s\S]*?)><\/forma-ui-metric>/gu)];
  assert.equal(metrics.length, 4, "no metric or UI surface is added");
  assert.ok(end < markup.indexOf('class="analytics-evidence outcome-telemetry"'),
    "the qualified label is visible before the existing closed disclosure");
  return { label: metrics[3][1], value: metrics[3][2], detail: metrics[3][3], overview };
}
function example(kind) {
  const recorded = event("explicit-recorded", "GenerationUsageRecorded", { cost_microusd: 1_250_000, input_tokens: 9_000_000 });
  const zero = event("explicit-zero", "GenerationUsageRecorded", { cost_microusd: 0, input_tokens: 9_000_000 });
  const legacy = event("legacy-estimate", "GenerationUsageRecorded", { input_tokens: 1000, output_tokens: 200 });
  const evidence = live();
  if (kind === "mixed") return { source: report([recorded, zero, legacy], evidence), total: 1_264_000, known: 2, unknown: 1, recorded: 1_250_000 };
  if (kind === "recorded") return { source: report([recorded], evidence), total: 1_250_000, known: 1, unknown: 0, recorded: 1_250_000 };
  if (kind === "legacy") return { source: report([legacy], evidence), total: 14_000, known: 0, unknown: 1, recorded: 0 };
  assert.equal(kind, "zero-unknown-hold");
  evidence.finance.heldMicrousd = null;
  evidence.finance.periods[0].heldMicrousd = null;
  evidence.finance.periods[0].unclassifiedCount = 1;
  return { source: report([zero], evidence), total: 0, known: 1, unknown: 0, recorded: 0 };
}
for (const locale of ["en", "fr", "ar", "ja"]) {
  for (const kind of ["mixed", "recorded", "legacy", "zero-unknown-hold"])
  test("leading analytics cost is qualified without changing amounts " + locale + "/" + kind, async () => {
    const f = fixture(locale), x = example(kind), before = structuredClone(x.source);
    // Compute through the unchanged real model, including legacy 1000*8+200*30.
    assert.equal(x.source.totals.costMicrousd, x.total);
    assert.equal(x.source.cost.totalMicrousd, x.total);
    assert.equal(x.source.source.exactCostReceipts, x.known);
    assert.equal(x.source.source.estimatedCostReceipts, x.unknown);
    assert.equal(x.source.outcomes.usage.recordedCostReceiptCount, x.known);
    assert.equal(x.source.outcomes.usage.unpricedReceiptCount, x.unknown);
    assert.equal(x.source.outcomes.usage.recordedMicrousd, x.recorded);
    assert.equal(x.source.outcomes.usage.providerInvoiceReconciled, null);
    assert.equal(x.source.outcomes.live.finance.settledMicrousd, 17);
    assert.equal(x.source.outcomes.live.finance.heldMicrousd, kind === "zero-unknown-hold" ? null : 24_000);
    await f.load(x.source);
    const markup = f.analytics.render(), metric = leadingMetric(markup);
    assert.equal(metric.label, expectedLabels[locale], "the leading label itself identifies recorded-plus-estimated event cost");
    assert.ok(markup.includes('<div class="analytics-cost-summary"><div><forma-ui-metric .label=' + expectedLabels[locale] + ' .value=' + metric.value + ' .detail='),
      "secondary economics total reuses the same qualified label and unchanged amount");
    assert.equal(FORMA_OUTCOME_MESSAGES[locale]["outcome.eventCost"], expectedLabels[locale]);
    assert.equal(metric.value, new Intl.NumberFormat(locale, { style: "currency", currency: "USD",
      minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x.total / 1_000_000));
    assert.equal(metric.detail, x.source.totals.activeMinutes + " active minutes observed", "the existing detail and amount are not replaced");
    const disclosure = f.helpers.outcomeTelemetryDisclosure(x.source.outcomes, f.i18n, true);
    assert.ok(markup.includes(disclosure));
    assert.match(disclosure, /^<details[^>]*>\s*<summary>/u);
    assert.doesNotMatch(disclosure.match(/^<details[^>]*>/u)[0], /\bopen(?:=|\s|>)/u, "no automatic disclosure opening");
    for (const key of ["outcome.recordedUsage", "outcome.financeScope", "outcome.held", "outcome.settled",
      "outcome.ledgerDetail", "outcome.noInvoice", "outcome.notDelivery"])
      assert.ok(disclosure.includes(FORMA_OUTCOME_MESSAGES[locale][key]), key);
    if (kind === "legacy") assert.ok(disclosure.includes(FORMA_OUTCOME_MESSAGES[locale]["outcome.noExplicitUsage"]));
    if (kind === "zero-unknown-hold") {
      assert.ok(disclosure.includes(FORMA_OUTCOME_MESSAGES[locale]["outcome.unknownAmount"]));
      assert.ok(disclosure.includes(f.helpers.outcomeMoney(0, f.i18n)));
    }
    assert.deepEqual(x.source, before, "rendering changes no report, event, hold or settled amount");
    assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 1); assert.equal(f.clears.length, 0);
    assert.equal(f.writes[0].report, x.source);
  });
  test("qualified cost copy does not bypass existing admin denial " + locale, async () => {
    const f = fixture(locale);
    f.session.set({ ...f.session.get(), user: { userId: "actor-a", role: "creator" } });
    await f.analytics.loadForTest();
    assert.equal(f.calls.length, 0);
    assert.equal(f.analytics.stateForTest().report, null);
    const markup = f.analytics.render();
    assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES[locale]["outcome.accessUnavailable"]));
    assert.equal(markup.includes('class="analytics-overview"'), false);
    assert.equal(markup.includes('class="analytics-evidence outcome-telemetry"'), false);
    assert.equal(f.writes.length, 0);
  });
}
test("boundary document matches the actual safe analytics cache version", () => {
  const worker = read("../worker/analytics-api.ts"), doc = read("../docs/outcome-telemetry-boundary.md");
  assert.match(worker, /type DurableAnalyticsSource=\{schema:2;outcomeBindings:2;/u);
  assert.match(worker, /source\.outcomeBindings!==2/u);
  assert.match(worker, /schema:2,outcomeBindings:2/u);
  assert.ok(doc.includes("\u0060outcomeBindings:2\u0060"));
  assert.equal(doc.includes("outcomeBindings:1"), false);
  assert.ok(doc.includes("nine-field cache rows"));
});
test("boundary document names the existing read-only Analytics and both Settings integrations", () => {
  const doc = read("../docs/outcome-telemetry-boundary.md");
  assert.ok(read("../src/components/forma-analytics.ts").includes("outcomeTelemetryDisclosure(report.outcomes"));
  assert.ok(read("../src/components/forma-account-settings.ts").includes("personalUsageReceiptDisclosure(events"));
  assert.ok(read("../src/components/forma-workspace-settings.ts").includes("outcomeSchedulerEvidence(report.scheduler"));
  assert.equal(doc.includes("This draft intentionally changes no presentation component."), false);
  for (const host of ["forma-analytics", "forma-account-settings", "forma-workspace-settings"])
    assert.ok(doc.includes("\u0060" + host + "\u0060"), host);
  for (const fact of ["report.totals.costMicrousd", "token-based estimates", "explicit-only usage amount",
    "account hold", "settled ledger total", "invoice total"])
    assert.ok(doc.includes(fact), fact);
});
