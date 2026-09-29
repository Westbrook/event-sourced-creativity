import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { syntheticDemandTrace } from "../worker/memory-benchmark/workloads.ts";

const WORKLOADS = ["light", "typical", "heavy"];
const STAGES = [
  "backfill_embedding", "changed_embedding", "night_review", "conversation_summary", "profile_update", "recall_increment",
];
const ID = /^synthetic:[a-z0-9][a-z0-9:-]{0,95}$/;
const sourceKey = (versionId) => versionId.replace(/:v:\d+$/, "");
const stageUnits = (trace) => Object.fromEntries(STAGES.map((stage) => [
  stage, trace.jobs.filter((job) => job.stage === stage).reduce((sum, job) => sum + job.units, 0),
]));

for (const workload of WORKLOADS) {
  test(`${workload}: stable 30-day synthetic metadata, ordered valid jobs, and source binding`, () => {
    const trace = syntheticDemandTrace(workload);
    assert.equal(trace.period, "2026-09");
    assert.equal(trace.workload, workload);
    assert.match(trace.version, ID);
    assert.equal(trace.activeDays.length, 30);
    assert.ok(trace.activeDays.every((active) => typeof active === "boolean"));
    assert.deepEqual(Object.keys(trace).sort(), ["activeDays", "jobs", "period", "sources", "version", "workload"]);
    const sources = new Map(trace.sources.map((version) => [version.versionId, version]));
    assert.equal(sources.size, trace.sources.length);
    for (const version of trace.sources) {
      assert.match(version.versionId, ID);
      assert.deepEqual(Object.keys(version).sort(), ["createdDay", "invalidatedDay", "invalidationReason", "versionId"]);
      assert.ok(Number.isInteger(version.createdDay) && version.createdDay >= 1 && version.createdDay <= 30);
      if (version.invalidatedDay === null) {
        assert.equal(version.invalidationReason, null);
      } else {
        assert.ok(Number.isInteger(version.invalidatedDay) && version.invalidatedDay > version.createdDay && version.invalidatedDay <= 30);
        assert.ok(["superseded", "withdrawn"].includes(version.invalidationReason));
      }
    }
    assert.equal(new Set(trace.jobs.map((job) => job.id)).size, trace.jobs.length);
    assert.deepEqual([...new Set(trace.jobs.map((job) => job.stage))].sort(), [...STAGES].sort());
    let previousDay = 0;
    let previousStage = -1;
    for (const job of trace.jobs) {
      assert.match(job.id, ID);
      assert.deepEqual(Object.keys(job).sort(), ["day", "expiresDay", "id", "sourceVersions", "stage", "units"]);
      assert.ok(job.day >= previousDay);
      assert.equal(trace.activeDays[job.day - 1], true);
      assert.ok(Number.isSafeInteger(job.units) && job.units > 0);
      assert.ok(job.sourceVersions.length > 0 && job.sourceVersions.length <= 16);
      assert.equal(new Set(job.sourceVersions).size, job.sourceVersions.length);
      assert.ok(job.expiresDay === null || (Number.isInteger(job.expiresDay) && job.expiresDay > job.day && job.expiresDay <= 31));
      const stageIndex = STAGES.indexOf(job.stage);
      assert.ok(stageIndex >= 0);
      if (job.day === previousDay) assert.ok(stageIndex >= previousStage);
      previousDay = job.day;
      previousStage = stageIndex;
      for (const versionId of job.sourceVersions) {
        const version = sources.get(versionId);
        assert.ok(version);
        assert.ok(version.createdDay <= job.day);
        assert.ok(version.invalidatedDay === null || job.day < version.invalidatedDay);
      }
    }
  });

  test(`${workload}: active nights, revisits-only day, and recall deadlines do not create re-embeddings`, () => {
    const trace = syntheticDemandTrace(workload);
    const activeDayNumbers = trace.activeDays.flatMap((active, index) => active ? [index + 1] : []);
    assert.deepEqual(trace.jobs.filter((job) => job.stage === "night_review").map((job) => job.day), activeDayNumbers);
    assert.ok(trace.jobs.filter((job) => job.stage === "night_review").every((job) => job.units === 1));
    const revisitDay = activeDayNumbers[1];
    assert.deepEqual([...new Set(trace.jobs.filter((job) => job.day === revisitDay).map((job) => job.stage))], ["night_review", "recall_increment"]);
    assert.equal(trace.sources.filter((version) => version.createdDay === revisitDay).length, 0);
    assert.deepEqual([...new Set(trace.jobs.filter((job) => job.stage === "recall_increment").map((job) => job.day))], activeDayNumbers);
    assert.ok(trace.jobs.filter((job) => job.stage === "recall_increment").every((job) => job.units === 1 && job.expiresDay === job.day + 1));
    assert.ok(trace.jobs.filter((job) => job.stage !== "recall_increment").every((job) => job.expiresDay === null));

    const embeddings = trace.jobs.filter((job) => job.stage.endsWith("_embedding"));
    assert.ok(embeddings.every((job) => job.sourceVersions.length === 1));
    const embeddedVersions = embeddings.flatMap((job) => job.sourceVersions);
    assert.equal(new Set(embeddedVersions).size, embeddedVersions.length);
    assert.deepEqual([...embeddedVersions].sort(), trace.sources.map((version) => version.versionId).sort());
    assert.ok(trace.jobs.filter((job) => job.stage === "backfill_embedding").every((job) => job.day === activeDayNumbers[0]));
  });

  test(`${workload}: supersession is version-specific and inactive-day withdrawal is immediate and final`, () => {
    const trace = syntheticDemandTrace(workload);
    const withdrawn = trace.sources.filter((version) => version.invalidationReason === "withdrawn");
    assert.equal(withdrawn.length, 1);
    assert.equal(trace.activeDays[withdrawn[0].invalidatedDay - 1], false);
    assert.equal(trace.sources.filter((version) => sourceKey(version.versionId) === sourceKey(withdrawn[0].versionId)).length, 1);
    assert.ok(trace.sources.some((version) => version.invalidationReason === "superseded"));
    for (const version of trace.sources) {
      if (version.invalidationReason === "superseded") {
        const revision = Number(version.versionId.match(/:v:(\d+)$/)[1]);
        const successor = trace.sources.find((candidate) => candidate.versionId === `${sourceKey(version.versionId)}:v:${revision + 1}`);
        assert.ok(successor);
        assert.equal(successor.createdDay, version.invalidatedDay);
      }
      if (version.invalidatedDay !== null) {
        assert.ok(trace.jobs.filter((job) => job.day >= version.invalidatedDay).every((job) => !job.sourceVersions.includes(version.versionId)));
      }
    }
  });

  test(`${workload}: fresh deterministic traces are deeply frozen and cannot contaminate later callers`, () => {
    const trace = syntheticDemandTrace(workload);
    const another = syntheticDemandTrace(workload);
    assert.deepEqual(another, trace);
    assert.notEqual(another, trace);
    assert.notEqual(another.sources[0], trace.sources[0]);
    for (const value of [trace, trace.activeDays, trace.sources, trace.jobs, ...trace.sources, ...trace.jobs, ...trace.jobs.map((job) => job.sourceVersions)]) {
      assert.equal(Object.isFrozen(value), true);
    }
    assert.throws(() => { trace.activeDays[0] = false; }, TypeError);
    assert.throws(() => { trace.sources[0].invalidatedDay = 1; }, TypeError);
    assert.throws(() => { trace.jobs[0].units = 999999; }, TypeError);
    assert.throws(() => { trace.jobs[0].sourceVersions.push("synthetic:injected"); }, TypeError);
    assert.deepEqual(syntheticDemandTrace(workload), another);
  });
}

test("the fixed scenarios document stage-specific demand without forcing a cap outcome", () => {
  const expected = {
    light: { active: 8, backfill_embedding: 11, changed_embedding: 12, night_review: 8, conversation_summary: 5, profile_update: 2, recall_increment: 31 },
    typical: { active: 16, backfill_embedding: 60, changed_embedding: 111, night_review: 16, conversation_summary: 11, profile_update: 4, recall_increment: 207 },
    heavy: { active: 22, backfill_embedding: 216, changed_embedding: 420, night_review: 22, conversation_summary: 15, profile_update: 5, recall_increment: 681 },
  };
  for (const workload of WORKLOADS) {
    const trace = syntheticDemandTrace(workload);
    assert.deepEqual({ active: trace.activeDays.filter(Boolean).length, ...stageUnits(trace) }, expected[workload]);
    assert.ok(trace.jobs.filter((job) => ["conversation_summary", "profile_update"].includes(job.stage)).every((job) => job.units === 1));
  }
});

test("only the fixed authored workload selector is accepted", () => {
  for (const value of ["test", "", "Light", "synthetic:custom", null, undefined, 1, {}, ["light"]]) {
    assert.throws(() => syntheticDemandTrace(value), { name: "TypeError", message: "Unknown authored synthetic workload." });
  }
  let coerced = false;
  assert.throws(() => syntheticDemandTrace({ toString() { coerced = true; return "light"; } }), TypeError);
  assert.equal(coerced, false);
});

test("the workload module has only a type-only contract import and no runtime integration hooks", async () => {
  const source = await readFile(new URL("../worker/memory-benchmark/workloads.ts", import.meta.url), "utf8");
  const imports = source.match(/^import[^;]+;/gm) ?? [];
  assert.equal(imports.length, 1);
  assert.match(imports[0], /^import type \{[^}]+\} from "\.\/projection-types\.ts";$/);
  const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(executable, /\b(?:fetch|require|process|globalThis|eval|Function|Worker|XMLHttpRequest)\b|\bimport\s*\(/);
  assert.doesNotMatch(executable, /https?:|OPENAI|D1Database|R2Bucket|microUsd|monthlyCap|priceOperation/);
});
