import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PROJECTION_STAGES } from "../worker/memory-benchmark/projection-types.ts";
import { compareMonthlyCaps, projectMonthlyDemand } from "../worker/memory-benchmark/projection.ts";
import { syntheticDemandTrace } from "../worker/memory-benchmark/workloads.ts";

globalThis.fetch = async () => { throw new Error("Network forbidden in demand projection tests."); };
let sequence = 0;
const job = (stage = "night_review", day = 1, extra = {}) => ({
  id: `synthetic:job-${sequence++}`, stage, day, units: 1, sourceVersions: [], expiresDay: null, ...extra,
});
const source = (versionId = "synthetic:source-v1", extra = {}) => ({
  versionId, createdDay: 1, invalidatedDay: null, invalidationReason: null, ...extra,
});
const trace = (jobs = [], extra = {}) => ({
  version: "synthetic:test-v1", workload: "test", period: "2026-09",
  activeDays: Array.from({ length: 30 }, (_, index) => jobs.some((item) => item.day === index + 1)),
  sources: [], jobs, ...extra,
});
const prices = (expected = 10, maximum = expected) => Object.fromEntries(PROJECTION_STAGES.map((stage) => [stage, {
  assumptionId: `synthetic:${stage.replaceAll("_", "-")}-v1`, basis: "hypothetical",
  expectedMicroUsdPerUnit: expected, maximumMicroUsdPerUnit: maximum,
}]));
const options = (extra = {}) => ({ monthlyCapMicroUsd: 100, availableAiMicroUsd: 100,
  backfill: "include", infrastructureEstimateMicroUsd: null, ...extra });
const run = (input, costs = prices(), settings = options()) => projectMonthlyDemand(input, costs, settings);

test("all inactive days produce no review charge, backlog or invented evidence", () => {
  const result = run(trace());
  assert.equal(result.spentMicroUsd, 0);
  assert.equal(result.inactiveNightsSkipped, 30);
  assert.equal(result.firstBudgetBlockedDay, null);
  assert.equal(result.capExhaustedDay, null);
  assert.equal(result.maximumBacklogAgeDays, 0);
  assert.equal(result.days.length, 30);
  for (const key of ["measuredProviderUsage", "measuredLatency", "quality", "recommendedMonthlyCap"]) assert.equal(result[key], null);
  assert.equal(result.productionQualified, false);
  assert.equal(result.mayAuthorizeExecution, false);
  assert.equal(result.basis, "hypothetical-demand-only");
});

test("exact-cap admission and integer conservation", () => {
  const result = run(trace([job(), job()]), prices(50));
  assert.equal(result.spentMicroUsd, 100);
  assert.equal(result.remainingMicroUsd, 0);
  assert.equal(result.capExhaustedDay, 1);
  assert.equal(result.firstBudgetBlockedDay, null);
  assert.equal(result.byStage.night_review.completedJobs, 2);
  assert.equal(result.jobs.reduce((sum, item) => sum + item.spentMicroUsd, 0), result.spentMicroUsd);
});

test("maximum reservation blocks even if the expected price fits", () => {
  const result = run(trace([job()]), prices(10, 101));
  assert.equal(result.spentMicroUsd, 0);
  assert.equal(result.remainingMicroUsd, 100);
  assert.equal(result.firstBudgetBlockedDay, 1);
  assert.equal(result.capExhaustedDay, null);
  assert.equal(result.endBacklogAgeDays, 29);
});

test("successful hypothetical settlement releases the difference without rounding", () => {
  const result = run(trace([job(), job()]), prices(20, 80));
  assert.equal(result.spentMicroUsd, 40);
  assert.equal(result.byStage.night_review.completedJobs, 2);
  assert.equal(result.remainingMicroUsd, 60);
});

test("assumed stricter remaining allowance limits each comparison", () => {
  const result = run(trace([job()]), prices(51), options({ availableAiMicroUsd: 50 }));
  assert.equal(result.effectiveCapMicroUsd, 50);
  assert.equal(result.spentMicroUsd, 0);
  assert.equal(result.remainingMicroUsd, 50);
  const comparisons = compareMonthlyCaps(trace([job()]), prices(51), {
    availableAiMicroUsd: 50, backfill: "include", infrastructureEstimateMicroUsd: null,
  });
  assert.deepEqual(comparisons.map((item) => item.monthlyCapMicroUsd), [1_000_000, 3_000_000, 5_000_000]);
  assert.ok(comparisons.every((item) => item.effectiveCapMicroUsd === 50 && item.recommendedMonthlyCap === null));
});

test("backfill can be included or explicitly excluded without disappearing from demand", () => {
  const input = trace([job("backfill_embedding", 1, { sourceVersions: ["synthetic:source-v1"] }), job()], { sources: [source()] });
  const included = run(input);
  const excluded = run(input, prices(), options({ backfill: "exclude" }));
  assert.equal(included.backfillMicroUsd, 10);
  assert.equal(included.recurringTotalMicroUsd, 10);
  assert.equal(excluded.backfillMicroUsd, 0);
  assert.equal(excluded.recurringTotalMicroUsd, 10);
  assert.equal(excluded.byStage.backfill_embedding.demandJobs, 1);
  assert.equal(excluded.byStage.backfill_embedding.excludedBackfillJobs, 1);
});

test("inactive nights do not drain FIFO; an invalidated head releases later work only on the next active night", () => {
  const input = trace([
    job("changed_embedding", 1, { units: 20, sourceVersions: ["synthetic:source-v1"] }),
    job("night_review", 1), job("night_review", 4),
  ], { sources: [source("synthetic:source-v1", { invalidatedDay: 2, invalidationReason: "withdrawn" })] });
  const result = run(input);
  assert.equal(result.days[1].active, false);
  assert.equal(result.days[1].completedJobs, 0);
  assert.equal(result.jobs[0].disposition, "ineligible");
  assert.equal(result.jobs[1].completedDay, 4);
  assert.equal(result.jobs[2].completedDay, 4);
  assert.equal(result.days[2].oldestPendingAgeDays, 2);
  assert.equal(result.maximumBacklogAgeDays, 3);
  assert.equal(result.endBacklogAgeDays, 0);
});

test("oversized FIFO head can starve affordable later work; unspent balance is not exhaustion", () => {
  const result = run(trace([job("night_review", 1, { units: 11 }), job("profile_update", 2)]));
  assert.equal(result.spentMicroUsd, 0);
  assert.deepEqual(result.jobs.map((item) => item.disposition), ["deferred", "deferred"]);
  assert.equal(result.firstBudgetBlockedDay, 1);
  assert.equal(result.capExhaustedDay, null);
  assert.equal(result.maximumBacklogAgeDays, 29);
});

test("recall has explicit first priority; insufficient recall is skipped, never put in a later queue", () => {
  const result = run(trace([job(), job("recall_increment", 1), job("recall_increment", 2)]), prices(60));
  assert.equal(result.jobs[1].completedDay, 1);
  assert.equal(result.jobs[0].disposition, "deferred");
  assert.equal(result.jobs[2].disposition, "skipped_recall");
  assert.equal(result.byStage.recall_increment.skippedRecallJobs, 1);
  assert.equal(result.spentMicroUsd, 60);
  assert.equal(result.days[29].pendingJobs, 1);
});

test("zero cap does not postpone inactive-day source withdrawal or expiry", () => {
  const input = trace([
    job("changed_embedding", 1, { sourceVersions: ["synthetic:source-v1"] }),
    job("night_review", 1, { expiresDay: 3 }),
  ], { sources: [source("synthetic:source-v1", { invalidatedDay: 2, invalidationReason: "withdrawn" })] });
  const result = run(input, prices(), options({ monthlyCapMicroUsd: 0 }));
  assert.equal(result.spentMicroUsd, 0);
  assert.deepEqual(result.jobs.map((item) => item.disposition), ["ineligible", "ineligible"]);
  assert.deepEqual(result.jobs.map((item) => item.ineligibleReason), ["withdrawn", "expired"]);
  assert.equal(result.days[1].pendingJobs, 1);
  assert.equal(result.days[2].pendingJobs, 0);
});

test("a completed source becomes ineligible at withdrawal without refunding historical cost", () => {
  const result = run(trace([job("changed_embedding", 1, { sourceVersions: ["synthetic:source-v1"] })], {
    sources: [source("synthetic:source-v1", { invalidatedDay: 2, invalidationReason: "withdrawn" })],
  }));
  assert.equal(result.jobs[0].completedDay, 1);
  assert.equal(result.jobs[0].eligibleAtEnd, false);
  assert.equal(result.jobs[0].ineligibleReason, "withdrawn");
  assert.equal(result.jobs[0].disposition, "modeled_complete");
  assert.equal(result.spentMicroUsd, 10);
  assert.equal(result.remainingMicroUsd, 90);
});

test("superseded queued versions are canceled before same-day admission of the replacement", () => {
  const costs = prices(); costs.changed_embedding.maximumMicroUsdPerUnit = 60;
  const input = trace([
    job("changed_embedding", 1, { units: 2, sourceVersions: ["synthetic:source-v1"] }),
    job("changed_embedding", 2, { sourceVersions: ["synthetic:source-v2"] }),
  ], { sources: [source("synthetic:source-v1", { invalidatedDay: 2, invalidationReason: "superseded" }),
    source("synthetic:source-v2", { createdDay: 2 })] });
  const result = run(input, costs);
  assert.equal(result.jobs[0].ineligibleReason, "superseded");
  assert.equal(result.jobs[0].completedDay, null);
  assert.equal(result.jobs[1].completedDay, 2);
  assert.equal(result.spentMicroUsd, 10);
});

test("same-day withdrawal cannot be admitted and future withdrawal is not applied early", () => {
  const input = trace([job("changed_embedding", 1, { sourceVersions: ["synthetic:source-v1"] })], {
    sources: [source("synthetic:source-v1", { invalidatedDay: 1, invalidationReason: "withdrawn" })],
  });
  assert.equal(run(input).spentMicroUsd, 0);
  input.sources[0].invalidatedDay = 30;
  assert.equal(run(input).jobs[0].completedDay, 1);
});

test("an aggregate's single invalid dependency cancels the whole job rather than silently reciting other sources", () => {
  const input = trace([job("night_review", 1, { sourceVersions: ["synthetic:source-v1", "synthetic:source-v2"] })], {
    sources: [source("synthetic:source-v1", { invalidatedDay: 1, invalidationReason: "withdrawn" }), source("synthetic:source-v2")],
  });
  assert.equal(run(input).jobs[0].disposition, "ineligible");
});

test("unmeasured stages are explicit omissions, not free work or a quality result", () => {
  const costs = prices(); costs.profile_update = null; costs.conversation_summary = null;
  const result = run(trace([job("profile_update"), job("conversation_summary"), job()]), costs);
  assert.deepEqual(result.unmodeledStages, ["conversation_summary", "profile_update"]);
  assert.equal(result.byStage.profile_update.hypotheticalDemandMicroUsd, null);
  assert.equal(result.byStage.profile_update.unmodeledJobs, 1);
  assert.equal(result.jobs[2].completedDay, 1);
  assert.equal(result.spentMicroUsd, 10);
  assert.equal(result.allTraceStagesEstimated, false);
  assert.equal(result.quality, null);
});

test("unknown-cost work is still subject to immediate withdrawal", () => {
  const costs = prices(); costs.profile_update = null;
  const input = trace([job("profile_update", 1, { sourceVersions: ["synthetic:source-v1"] })], {
    sources: [source("synthetic:source-v1", { invalidatedDay: 2, invalidationReason: "withdrawn" })],
  });
  const result = run(input, costs);
  assert.equal(result.jobs[0].disposition, "ineligible");
  assert.equal(result.jobs[0].eligibleAtEnd, false);
  assert.deepEqual(result.unmodeledStages, ["profile_update"]);
});

test("first ineligibility reason is retained when later invalidation follows expiry", () => {
  const input = trace([job("night_review", 1, { sourceVersions: ["synthetic:source-v1"], expiresDay: 2 })], {
    sources: [source("synthetic:source-v1", { invalidatedDay: 3, invalidationReason: "withdrawn" })],
  });
  assert.equal(run(input).jobs[0].ineligibleReason, "expired");
});

test("infrastructure is separate from AI allowance, with missing costs remaining null", () => {
  const input = trace([job("recall_increment", 1, { units: 3 })]);
  const unmeasured = run(input);
  assert.equal(unmeasured.modeledCostSubtotalMicroUsd, null);
  const estimated = run(input, prices(), options({ infrastructureEstimateMicroUsd: 1_000 }));
  assert.equal(estimated.spentMicroUsd, 30);
  assert.equal(estimated.modeledCostSubtotalMicroUsd, 1_030);
  assert.equal(estimated.remainingMicroUsd, 70);
  assert.equal(estimated.byStage.recall_increment.completedUnits, 3);
  assert.equal(estimated.recommendedMonthlyCap, null);
});

test("fractional microdollars are rejected; callers must supply an explicit whole-microdollar estimate", () => {
  const costs = prices(); costs.night_review.expectedMicroUsdPerUnit = 0.01;
  assert.throws(() => run(trace([job()]), costs), /Invalid synthetic projection input/);
});

test("zero is a deliberate hypothetical estimate, distinct from null", () => {
  const result = run(trace([job()]), prices(0), options({ monthlyCapMicroUsd: 0 }));
  assert.equal(result.jobs[0].disposition, "modeled_complete");
  assert.equal(result.byStage.night_review.hypotheticalDemandMicroUsd, 0);
  assert.deepEqual(result.unmodeledStages, []);
});

test("output is deterministic and mutation-independent from input or earlier results", () => {
  const input = trace([job(), job("recall_increment", 2)]); const costs = prices(); const settings = options();
  const before = JSON.stringify({ input, costs, settings }); const first = run(input, costs, settings);
  assert.deepEqual(first, run(input, costs, settings));
  assert.equal(JSON.stringify({ input, costs, settings }), before);
  first.costAssumptions[0].estimate.expectedMicroUsdPerUnit = 999;
  first.jobs[0].spentMicroUsd = 999;
  assert.equal(JSON.stringify({ input, costs, settings }), before);
  assert.equal(run(input, costs, settings).spentMicroUsd, 20);
});

test("all caps may admit all demand without inventing a preferred cap or changing demand", () => {
  const input = trace([job(), job("recall_increment", 2)]);
  const results = compareMonthlyCaps(input, prices(), { availableAiMicroUsd: 10_000_000, backfill: "include", infrastructureEstimateMicroUsd: null });
  assert.ok(results.every((result) => result.spentMicroUsd === 20 && result.jobs.length === 2 && result.recommendedMonthlyCap === null));
});

test("queue ordering is stable by day and then authored input order", () => {
  const result = run(trace([job("profile_update", 2), job("night_review", 1, { units: 11 })]));
  assert.equal(result.spentMicroUsd, 0);
  assert.ok(result.jobs.every((item) => item.disposition === "deferred"));
});

for (const workload of ["light", "typical", "heavy"]) test(`${workload}: all three cap projections conserve money, demand and source eligibility`, () => {
  const input = syntheticDemandTrace(workload);
  // Deliberately toy unit prices, not a forecast or a claimed provider pricebook.
  const costs = prices(1_000, 1_200); costs.profile_update = null; costs.conversation_summary = null;
  const results = compareMonthlyCaps(input, costs, {
    availableAiMicroUsd: 10_000_000, backfill: "include", infrastructureEstimateMicroUsd: null,
  });
  const sources = new Map(input.sources.map((item) => [item.versionId, item]));
  for (const result of results) {
    assert.equal(result.jobs.length, input.jobs.length);
    assert.equal(result.spentMicroUsd + result.remainingMicroUsd, result.effectiveCapMicroUsd);
    assert.equal(result.days.reduce((sum, item) => sum + item.spentMicroUsd, 0), result.spentMicroUsd);
    assert.equal(Object.values(result.byStage).reduce((sum, item) => sum + item.spentMicroUsd, 0), result.spentMicroUsd);
    assert.equal(result.backfillMicroUsd + result.recurringBackgroundMicroUsd + result.recallIncrementMicroUsd, result.spentMicroUsd);
    assert.equal(result.recurringBackgroundMicroUsd + result.recallIncrementMicroUsd, result.recurringTotalMicroUsd);
    assert.deepEqual(result.unmodeledStages, ["conversation_summary", "profile_update"]);
    assert.equal(result.measuredProviderUsage, null);
    assert.equal(result.recommendedMonthlyCap, null);
    for (const day of result.days) {
      if (!day.active) assert.equal(day.spentMicroUsd, 0);
      assert.ok(day.remainingMicroUsd >= 0);
    }
    for (let index = 0; index < result.jobs.length; index++) {
      const output = result.jobs[index]; const original = input.jobs[index];
      if (output.completedDay === null) { assert.equal(output.spentMicroUsd, 0); continue; }
      assert.ok(input.activeDays[output.completedDay - 1]);
      assert.ok(output.completedDay >= original.day);
      if (original.stage === "recall_increment") assert.equal(output.completedDay, original.day);
      for (const version of original.sourceVersions) {
        const source = sources.get(version);
        assert.ok(source.createdDay <= output.completedDay);
        assert.ok(source.invalidatedDay === null || output.completedDay < source.invalidatedDay);
      }
      if (original.expiresDay !== null) assert.ok(output.completedDay < original.expiresDay);
    }
    for (const stage of PROJECTION_STAGES) {
      const row = result.byStage[stage];
      assert.equal(row.demandJobs, row.completedJobs + row.deferredJobs + row.skippedRecallJobs
        + row.ineligibleJobs + row.unmodeledJobs + row.excludedBackfillJobs);
      assert.equal(row.demandJobs, input.jobs.filter((item) => item.stage === stage).length);
    }
  }
  assert.deepEqual(results.map((result) => Object.values(result.byStage).map((row) => row.demandUnits)),
    Array.from({ length: 3 }, () => Object.values(results[0].byStage).map((row) => row.demandUnits)));
});

const invalidMutations = {
  "negative cap": (_t, _p, o) => { o.monthlyCapMicroUsd = -1; },
  "NaN allowance": (_t, _p, o) => { o.availableAiMicroUsd = NaN; },
  "infinite cost": (_t, p) => { p.night_review.expectedMicroUsdPerUnit = Infinity; },
  "unsafe cost": (_t, p) => { p.night_review.maximumMicroUsdPerUnit = Number.MAX_SAFE_INTEGER + 1; },
  "underreservation": (_t, p) => { p.night_review.maximumMicroUsdPerUnit = 9; },
  "pretend measured price": (_t, p) => { p.night_review.basis = "measured"; },
  "unversioned price": (_t, p) => { p.night_review.assumptionId = ""; },
  "missing stage": (_t, p) => { delete p.profile_update; },
  "benchmark grader costs": (_t, p) => { p.grading = { ...p.night_review }; },
  "raw content": (t) => { t.jobs[0].text = "not permitted"; },
  "real user identifier": (t) => { t.jobs[0].id = "actual-user-123"; },
  "wrong month": (t) => { t.period = "2026-10"; },
  "short month": (t) => { t.activeDays.pop(); },
  "sparse calendar": (t) => { delete t.activeDays[2]; },
  "nonboolean calendar": (t) => { t.activeDays[2] = 1; },
  "inactive-day job": (t) => { t.activeDays[0] = false; },
  "day zero": (t) => { t.jobs[0].day = 0; },
  "day thirty-one": (t) => { t.jobs[0].day = 31; },
  "unknown stage": (t) => { t.jobs[0].stage = "grading"; },
  "zero units": (t) => { t.jobs[0].units = 0; },
  "oversize units": (t) => { t.jobs[0].units = 1_000_001; },
  "duplicate job": (t) => { t.jobs.push({ ...t.jobs[0] }); },
  "unknown source": (t) => { t.jobs[0].sourceVersions = ["synthetic:missing"]; },
  "same-day expiry": (t) => { t.jobs[0].expiresDay = 1; },
  "expiry beyond period": (t) => { t.jobs[0].expiresDay = 32; },
  "price product overflow": (t, p) => { t.jobs[0].units = 2; p.night_review = { ...p.night_review, expectedMicroUsdPerUnit: Number.MAX_SAFE_INTEGER, maximumMicroUsdPerUnit: Number.MAX_SAFE_INTEGER }; },
  "demand sum overflow": (t, p) => { t.jobs.push(job()); p.night_review = { ...p.night_review, expectedMicroUsdPerUnit: Number.MAX_SAFE_INTEGER, maximumMicroUsdPerUnit: Number.MAX_SAFE_INTEGER }; },
  "infra subtotal overflow": (_t, _p, o) => { o.infrastructureEstimateMicroUsd = Number.MAX_SAFE_INTEGER; },
  "prototype instead of plain record": (t) => { Object.setPrototypeOf(t.jobs[0], { text: "hidden" }); },
};
for (const [name, mutate] of Object.entries(invalidMutations)) test(`rejects ${name}`, () => {
  const input = trace([job()]); const costs = prices(); const settings = options();
  mutate(input, costs, settings);
  assert.throws(() => run(input, costs, settings), /Invalid synthetic projection input/);
});

for (const [name, mutate] of Object.entries({
  "duplicate source": (input) => { input.sources.push({ ...input.sources[0] }); },
  "future source": (input) => { input.sources[0].createdDay = 2; },
  "missing withdrawal reason": (input) => { input.sources[0].invalidatedDay = 2; },
  "reason without withdrawal": (input) => { input.sources[0].invalidationReason = "withdrawn"; },
  "unknown withdrawal reason": (input) => { input.sources[0].invalidatedDay = 2; input.sources[0].invalidationReason = "deleted-by-magic"; },
  "duplicate job source": (input) => { input.jobs[0].sourceVersions.push("synthetic:source-v1"); },
  "embedding without source": (input) => { input.jobs[0].sourceVersions = []; },
  "unchanged version re-embedding": (input) => { input.jobs.push(job("backfill_embedding", 1, { sourceVersions: ["synthetic:source-v1"] })); },
})) test(`rejects ${name}`, () => {
  const input = trace([job("changed_embedding", 1, { sourceVersions: ["synthetic:source-v1"] })], { sources: [source()] });
  mutate(input); assert.throws(() => run(input), /Invalid synthetic projection input/);
});

test("pure modules have no native, provider, environment, filesystem or network imports", () => {
  const root = new URL("../worker/memory-benchmark/", import.meta.url);
  for (const path of ["projection.ts", "projection-types.ts"]) {
    const text = readFileSync(new URL(path, root), "utf8");
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    assert.ok(imports.every((entry) => entry === "./projection-types.ts"));
    assert.doesNotMatch(text, /\b(?:fetch|process|Deno|Bun|require)\s*[.(]|\bimport\s*\(/);
  }
});

test("a changing monthly-cap getter is rejected without executing it", () => {
  const settings = options(); let reads = 0;
  Object.defineProperty(settings, "monthlyCapMicroUsd", { enumerable: true, get() { return ++reads === 1 ? 100 : -1; } });
  assert.throws(() => run(trace(), prices(), settings), /Invalid synthetic projection input/);
  assert.equal(reads, 0);
});

test("both entry points reject nested accessors without invoking their code", () => {
  const locations = [
    (t) => [t, "version"], (t) => [t.jobs[0], "units"], (t) => [t.sources[0], "createdDay"],
    (_t, p) => [p, "night_review"], (_t, p) => [p.night_review, "expectedMicroUsdPerUnit"],
    (_t, _p, o) => [o, "availableAiMicroUsd"],
  ];
  for (const locate of locations) for (const compare of [false, true]) {
    const input = trace([job()], { sources: [source()] }); const costs = prices(); const settings = options();
    if (compare) delete settings.monthlyCapMicroUsd;
    const [target, key] = locate(input, costs, settings); let reads = 0;
    Object.defineProperty(target, key, { enumerable: true, configurable: true, get() { reads++; throw new Error("Getter executed"); } });
    assert.throws(() => compare ? compareMonthlyCaps(input, costs, settings) : run(input, costs, settings), /Invalid synthetic projection input/);
    assert.equal(reads, 0);
  }
});

test("calendar slots inherited from Array.prototype are not own input", () => {
  const input = trace(); delete input.activeDays[2];
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "2");
  try {
    Object.defineProperty(Array.prototype, "2", { value: false, writable: true, configurable: true });
    assert.throws(() => run(input), /Invalid synthetic projection input/);
  } finally {
    if (original) Object.defineProperty(Array.prototype, "2", original);
    else delete Array.prototype[2];
  }
});

test("every array boundary rejects accessors, sparse/inherited slots and hidden or symbolic extras", () => {
  const locations = [(t) => t.activeDays, (t) => t.sources, (t) => t.jobs, (t) => t.jobs[0].sourceVersions];
  const mutations = [
    (a, hit) => Object.defineProperty(a, "0", { enumerable: true, get() { hit(); return 1; } }),
    (a) => { const inherited = Object.create(Array.prototype); Object.defineProperty(inherited, "0", { value: a[0] }); delete a[0]; Object.setPrototypeOf(a, inherited); },
    (a) => { delete a[0]; },
    (a) => Object.defineProperty(a, "0", { value: a[0], enumerable: false }),
    (a) => Object.defineProperty(a, "hidden", { value: "unexpected", enumerable: false }),
    (a) => { a[Symbol("unexpected")] = 1; },
  ];
  for (const locate of locations) for (const mutate of mutations) {
    const input = trace([job("changed_embedding", 1, { sourceVersions: ["synthetic:source-v1"] })], { sources: [source()] });
    let hits = 0; mutate(locate(input), () => hits++);
    assert.throws(() => run(input), /Invalid synthetic projection input/);
    assert.equal(hits, 0);
  }
});

test("every record boundary rejects symbol and non-enumerable extras and hidden declared fields", () => {
  const locations = [
    (t) => [t, "version"], (t) => [t.jobs[0], "units"], (t) => [t.sources[0], "createdDay"],
    (_t, p) => [p, "night_review"], (_t, p) => [p.night_review, "basis"],
    (_t, _p, o) => [o, "availableAiMicroUsd"],
  ];
  for (const locate of locations) for (const kind of ["symbol", "hidden-extra", "hidden-field"]) {
    const input = trace([job()], { sources: [source()] }); const costs = prices(); const settings = options();
    const [target, key] = locate(input, costs, settings);
    if (kind === "symbol") target[Symbol("unexpected")] = 1;
    else Object.defineProperty(target, kind === "hidden-extra" ? "unexpected" : key, { value: 1, enumerable: false });
    assert.throws(() => run(input, costs, settings), /Invalid synthetic projection input/);
  }
});

test("calculation reads only the validated snapshot, never the original cap again", () => {
  let reads = 0;
  const settings = new Proxy(options(), {
    get() { throw new Error("Original field read"); },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return key === "monthlyCapMicroUsd" ? { ...descriptor, value: ++reads === 1 ? 100 : -1 } : descriptor;
    },
  });
  const result = run(trace(), prices(), settings);
  assert.equal(reads, 1);
  assert.equal(result.effectiveCapMicroUsd, 100);
  assert.equal(result.remainingMicroUsd, 100);
});

test("three-cap comparison captures nested unit prices once for all scenarios", () => {
  const costs = prices(); let reads = 0;
  costs.night_review = new Proxy(costs.night_review, {
    get() { throw new Error("Original price read"); },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return key === "expectedMicroUsdPerUnit" ? { ...descriptor, value: ++reads === 1 ? 10 : -1 } : descriptor;
    },
  });
  const result = compareMonthlyCaps(trace([job()]), costs, { availableAiMicroUsd: 10_000_000,
    backfill: "include", infrastructureEstimateMicroUsd: null });
  assert.equal(reads, 1);
  assert.deepEqual(result.map((item) => item.spentMicroUsd), [10, 10, 10]);
});

test("oversized arrays are rejected before key enumeration or element reads", () => {
  const input = trace(); let enumerations = 0; let reads = 0;
  input.jobs = new Proxy(new Array(10_001), {
    ownKeys(target) { enumerations++; return Reflect.ownKeys(target); },
    get() { reads++; throw new Error("Original array read"); },
  });
  assert.throws(() => run(input), /Invalid synthetic projection input/);
  assert.equal(enumerations, 0);
  assert.equal(reads, 0);
});
