import {
  PROJECTION_STAGES,
  type DemandTrace, type ProjectionOptions, type ProjectedJob, type StageEstimates,
  type ProjectionStage, type StageProjection, type ProjectionSource, type ProjectionJob, type StageEstimate,
} from "./projection-types.ts";

export const PROJECTION_VERSION = "synthetic:memory-demand-projection-v1";
export const COMPARISON_CAPS_MICRO_USD = Object.freeze([1_000_000, 3_000_000, 5_000_000]);

const ID = /^synthetic:[a-z0-9][a-z0-9:-]{0,95}$/;
const STAGES = new Set<string>(PROJECTION_STAGES);
function requireValue(ok: unknown): asserts ok {
  if (!ok) throw new TypeError("Invalid synthetic projection input.");
}
function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
  const actual = Reflect.ownKeys(value);
  requireValue(actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key)));
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
  }
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  requireValue(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}
function id(value: unknown): asserts value is string { requireValue(typeof value === "string" && ID.test(value)); }
function arrayWithin(value: unknown, maximum: number): boolean { return Array.isArray(value) && value.length <= maximum; }
function add(a: number, b: number): number { const sum = a + b; integer(sum); return sum; }
function multiply(a: number, b: number): number { const product = a * b; integer(product); return product; }

/** Copy own data descriptors once; no getter, iterator or later original read. */
function ownRecord<T>(value: unknown, keys: readonly string[]): T {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
  const actual = Reflect.ownKeys(value);
  requireValue(actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key)));
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
    Object.defineProperty(captured, key, { value: descriptor.value, enumerable: true });
  }
  return Object.freeze(captured) as T;
}

function ownArray<T>(value: unknown, maximum: number): readonly T[] {
  requireValue(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  requireValue(lengthDescriptor && Object.hasOwn(lengthDescriptor, "value") && !lengthDescriptor.enumerable);
  const length: unknown = lengthDescriptor.value;
  integer(length, 0, maximum);
  const keys = Reflect.ownKeys(value);
  requireValue(keys.length === length + 1 && keys.every((key) => key === "length"
    || (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length)));
  const captured = new Array<T>(length);
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireValue(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
    Object.defineProperty(captured, index, { value: descriptor.value, enumerable: true });
  }
  return Object.freeze(captured);
}

function snapshotInputs(traceInput: DemandTrace, estimatesInput: StageEstimates, optionsInput: ProjectionOptions) {
  const head = ownRecord<DemandTrace>(traceInput, ["version", "workload", "period", "activeDays", "sources", "jobs"]);
  const trace: DemandTrace = {
    ...head,
    activeDays: ownArray<boolean>(head.activeDays, 30),
    sources: ownArray<ProjectionSource>(head.sources, 10_000).map((source) =>
      ownRecord<ProjectionSource>(source, ["versionId", "createdDay", "invalidatedDay", "invalidationReason"])),
    jobs: ownArray<ProjectionJob>(head.jobs, 10_000).map((job) => {
      const captured = ownRecord<ProjectionJob>(job, ["id", "day", "stage", "units", "sourceVersions", "expiresDay"]);
      return { ...captured, sourceVersions: ownArray<string>(captured.sourceVersions, 16) };
    }),
  };
  const prices = ownRecord<StageEstimates>(estimatesInput, PROJECTION_STAGES);
  const estimates = {} as StageEstimates;
  for (const stage of PROJECTION_STAGES) estimates[stage] = prices[stage] === null ? null
    : ownRecord<StageEstimate>(prices[stage], ["assumptionId", "basis", "expectedMicroUsdPerUnit", "maximumMicroUsdPerUnit"]);
  const options = ownRecord<ProjectionOptions>(optionsInput,
    ["monthlyCapMicroUsd", "availableAiMicroUsd", "backfill", "infrastructureEstimateMicroUsd"]);
  validate(trace, estimates, options);
  return { trace, estimates, options };
}

/** Validate a bounded, content-free fixture. This is not a production-data ingestion API. */
function validate(trace: DemandTrace, estimates: StageEstimates, options: ProjectionOptions): void {
  record(trace, ["version", "workload", "period", "activeDays", "sources", "jobs"]);
  id(trace.version);
  requireValue(["light", "typical", "heavy", "test"].includes(trace.workload) && trace.period === "2026-09");
  requireValue(Array.isArray(trace.activeDays) && trace.activeDays.length === 30
    && Array.from(trace.activeDays).every((day) => typeof day === "boolean"));
  requireValue(arrayWithin(trace.sources, 10_000));
  const sources = new Map<string, DemandTrace["sources"][number]>();
  for (const source of trace.sources) {
    record(source, ["versionId", "createdDay", "invalidatedDay", "invalidationReason"]);
    id(source.versionId); integer(source.createdDay, 1, 30);
    requireValue(!sources.has(source.versionId));
    if (source.invalidatedDay === null) requireValue(source.invalidationReason === null);
    else {
      integer(source.invalidatedDay, source.createdDay, 30);
      requireValue(source.invalidationReason === "superseded" || source.invalidationReason === "withdrawn");
    }
    sources.set(source.versionId, source);
  }
  record(estimates, PROJECTION_STAGES);
  for (const stage of PROJECTION_STAGES) {
    const estimate = estimates[stage];
    if (estimate === null) continue;
    record(estimate, ["assumptionId", "basis", "expectedMicroUsdPerUnit", "maximumMicroUsdPerUnit"]);
    id(estimate.assumptionId); requireValue(estimate.basis === "hypothetical");
    integer(estimate.expectedMicroUsdPerUnit); integer(estimate.maximumMicroUsdPerUnit);
    requireValue(estimate.expectedMicroUsdPerUnit <= estimate.maximumMicroUsdPerUnit);
  }
  requireValue(arrayWithin(trace.jobs, 10_000));
  const jobIds = new Set<string>(); const embeddedVersions = new Set<string>();
  let expectedTotal = 0; let maximumTotal = 0; let totalUnits = 0;
  for (const job of trace.jobs) {
    record(job, ["id", "day", "stage", "units", "sourceVersions", "expiresDay"]);
    id(job.id); integer(job.day, 1, 30); integer(job.units, 1, 1_000_000);
    requireValue(!jobIds.has(job.id) && STAGES.has(job.stage) && trace.activeDays[job.day - 1]);
    jobIds.add(job.id); totalUnits = add(totalUnits, job.units);
    requireValue(Array.isArray(job.sourceVersions) && job.sourceVersions.length <= 16
      && new Set(job.sourceVersions).size === job.sourceVersions.length);
    if (job.expiresDay !== null) integer(job.expiresDay, job.day + 1, 31);
    const embedding = job.stage === "backfill_embedding" || job.stage === "changed_embedding";
    requireValue(!embedding || job.sourceVersions.length > 0);
    for (const version of job.sourceVersions) {
      id(version);
      const source = sources.get(version);
      requireValue(source && source.createdDay <= job.day);
      if (embedding) { requireValue(!embeddedVersions.has(version)); embeddedVersions.add(version); }
    }
    const estimate = estimates[job.stage];
    if (estimate !== null) {
      expectedTotal = add(expectedTotal, multiply(job.units, estimate.expectedMicroUsdPerUnit));
      maximumTotal = add(maximumTotal, multiply(job.units, estimate.maximumMicroUsdPerUnit));
    }
  }
  record(options, ["monthlyCapMicroUsd", "availableAiMicroUsd", "backfill", "infrastructureEstimateMicroUsd"]);
  integer(options.monthlyCapMicroUsd); integer(options.availableAiMicroUsd);
  requireValue(options.backfill === "include" || options.backfill === "exclude");
  if (options.infrastructureEstimateMicroUsd !== null) {
    integer(options.infrastructureEstimateMicroUsd);
    add(expectedTotal, options.infrastructureEstimateMicroUsd);
  }
}

/**
 * Offline sensitivity calculation only. Whole-job FIFO, recall-first, active-night
 * service and instantaneous successful settlement are explicit illustrative policies.
 * No provider, environment, clock, database or native authority is consulted.
 */
export function projectMonthlyDemand(trace: DemandTrace, estimates: StageEstimates, options: ProjectionOptions) {
  const captured = snapshotInputs(trace, estimates, options);
  return calculate(captured.trace, captured.estimates, captured.options);
}

function calculate(trace: DemandTrace, estimates: StageEstimates, options: ProjectionOptions) {
  const effectiveCap = Math.min(options.monthlyCapMicroUsd, options.availableAiMicroUsd);
  const sourceMap = new Map(trace.sources.map((source) => [source.versionId, source]));
  const jobs: ProjectedJob[] = trace.jobs.map((job) => ({
    id: job.id, stage: job.stage, units: job.units, day: job.day,
    disposition: job.stage === "backfill_embedding" && options.backfill === "exclude" ? "excluded_backfill"
      : estimates[job.stage] === null ? "unmodeled" : "deferred",
    completedDay: null, spentMicroUsd: 0, eligibleAtEnd: true, ineligibleReason: null,
  }));
  const order = trace.jobs.map((job, index) => ({ job, index })).sort((a, b) => a.job.day - b.job.day || a.index - b.index);
  let spent = 0; let firstBudgetBlockedDay: number | null = null; let capExhaustedDay: number | null = null;
  let maximumBacklogAgeDays = 0;
  const days: { day: number; active: boolean; spentMicroUsd: number; remainingMicroUsd: number;
    completedJobs: number; pendingJobs: number; oldestPendingAgeDays: number; unmodeledJobs: number }[] = [];

  const attempt = (index: number, day: number): boolean => {
    const job = trace.jobs[index]; const projected = jobs[index]; const estimate = estimates[job.stage];
    requireValue(estimate !== null);
    if (multiply(job.units, estimate.maximumMicroUsdPerUnit) > effectiveCap - spent) {
      firstBudgetBlockedDay ??= day;
      if (effectiveCap === spent) capExhaustedDay ??= day;
      return false;
    }
    const cost = multiply(job.units, estimate.expectedMicroUsdPerUnit);
    spent = add(spent, cost); projected.spentMicroUsd = cost;
    projected.disposition = "modeled_complete"; projected.completedDay = day;
    if (effectiveCap === spent) capExhaustedDay ??= day;
    return true;
  };

  for (let day = 1; day <= 30; day++) {
    const spentBefore = spent;
    // Include waiting time up to completion/cancellation, not just end-of-day snapshots.
    for (const job of jobs) if (job.day <= day && job.disposition === "deferred") {
      maximumBacklogAgeDays = Math.max(maximumBacklogAgeDays, day - job.day);
    }
    // Revocation/expiry happens even on inactive days and with a zero budget.
    for (const { job, index } of order) {
      if (job.day > day) break;
      const projected = jobs[index];
      if (!projected.eligibleAtEnd) continue;
      const invalidated = job.sourceVersions.map((version) => sourceMap.get(version)!)
        .filter((source) => source.invalidatedDay !== null && source.invalidatedDay <= day)
        .sort((a, b) => a.invalidatedDay! - b.invalidatedDay! || a.versionId.localeCompare(b.versionId))[0];
      const reason = invalidated?.invalidationReason ?? (job.expiresDay !== null && job.expiresDay <= day ? "expired" : null);
      if (reason !== null) {
        projected.eligibleAtEnd = false; projected.ineligibleReason = reason;
        if (projected.disposition === "deferred" || projected.disposition === "unmodeled") projected.disposition = "ineligible";
      }
    }
    if (trace.activeDays[day - 1]) {
      // Recall requests are not replayed later. Full baseline answer costs are outside this model.
      for (const { job, index } of order) {
        if (job.day > day) break;
        if (job.day === day && job.stage === "recall_increment" && jobs[index].disposition === "deferred"
          && !attempt(index, day)) jobs[index].disposition = "skipped_recall";
      }
      // Unknown-cost stages are explicitly unmodeled, not silently free FIFO jobs.
      for (const { job, index } of order) {
        if (job.day > day) break;
        if (job.stage !== "recall_increment" && jobs[index].disposition === "deferred" && !attempt(index, day)) break;
      }
    }
    const pending = jobs.filter((job) => job.day <= day && job.disposition === "deferred");
    const age = pending.reduce((maximum, job) => Math.max(maximum, day - job.day), 0);
    maximumBacklogAgeDays = Math.max(maximumBacklogAgeDays, age);
    days.push({ day, active: trace.activeDays[day - 1], spentMicroUsd: spent - spentBefore,
      remainingMicroUsd: effectiveCap - spent, completedJobs: jobs.filter((job) => job.completedDay === day).length,
      pendingJobs: pending.length, oldestPendingAgeDays: age,
      unmodeledJobs: jobs.filter((job) => job.day <= day && job.disposition === "unmodeled").length });
  }
  const byStage = {} as Record<ProjectionStage, StageProjection>;
  for (const stage of PROJECTION_STAGES) {
    const selected = jobs.filter((job) => job.stage === stage);
    const demandUnits = selected.reduce((sum, job) => add(sum, job.units), 0);
    const estimate = estimates[stage];
    const completed = selected.filter((job) => job.disposition === "modeled_complete");
    const deferred = selected.filter((job) => job.disposition === "deferred");
    byStage[stage] = {
      demandJobs: selected.length, demandUnits,
      hypotheticalDemandMicroUsd: estimate === null ? null : multiply(demandUnits, estimate.expectedMicroUsdPerUnit),
      spentMicroUsd: selected.reduce((sum, job) => add(sum, job.spentMicroUsd), 0),
      completedJobs: completed.length, completedUnits: completed.reduce((sum, job) => add(sum, job.units), 0),
      deferredJobs: deferred.length, deferredUnits: deferred.reduce((sum, job) => add(sum, job.units), 0),
      skippedRecallJobs: selected.filter((job) => job.disposition === "skipped_recall").length,
      ineligibleJobs: selected.filter((job) => job.disposition === "ineligible").length,
      unmodeledJobs: selected.filter((job) => job.disposition === "unmodeled").length,
      excludedBackfillJobs: selected.filter((job) => job.disposition === "excluded_backfill").length,
    };
  }
  const unmodeledStages = PROJECTION_STAGES.filter((stage) => estimates[stage] === null && byStage[stage].demandJobs > 0
    && !(stage === "backfill_embedding" && options.backfill === "exclude"));
  return {
    projectionVersion: PROJECTION_VERSION, traceVersion: trace.version, workload: trace.workload,
    period: trace.period, basis: "hypothetical-demand-only" as const,
    monthlyCapMicroUsd: options.monthlyCapMicroUsd, assumedAvailableAiMicroUsd: options.availableAiMicroUsd,
    effectiveCapMicroUsd: effectiveCap, spentMicroUsd: spent, remainingMicroUsd: effectiveCap - spent,
    backfillPolicy: options.backfill, backfillMicroUsd: byStage.backfill_embedding.spentMicroUsd,
    recurringBackgroundMicroUsd: spent - byStage.backfill_embedding.spentMicroUsd - byStage.recall_increment.spentMicroUsd,
    recallIncrementMicroUsd: byStage.recall_increment.spentMicroUsd,
    recurringTotalMicroUsd: spent - byStage.backfill_embedding.spentMicroUsd,
    infrastructureEstimateMicroUsd: options.infrastructureEstimateMicroUsd,
    modeledCostSubtotalMicroUsd: options.infrastructureEstimateMicroUsd === null ? null : add(spent, options.infrastructureEstimateMicroUsd),
    unmodeledStages, allTraceStagesEstimated: unmodeledStages.length === 0,
    infrastructureModeled: options.infrastructureEstimateMicroUsd !== null,
    costAssumptions: PROJECTION_STAGES.map((stage) => ({ stage, estimate: estimates[stage] === null ? null : { ...estimates[stage] } })),
    firstBudgetBlockedDay, capExhaustedDay, maximumBacklogAgeDays,
    endBacklogAgeDays: days[29].oldestPendingAgeDays,
    inactiveNightsSkipped: trace.activeDays.filter((active) => !active).length,
    byStage, days, jobs,
    measuredProviderUsage: null, measuredLatency: null, quality: null, recommendedMonthlyCap: null,
    productionQualified: false, mayAuthorizeExecution: false,
    limitations: [
      "Authored demand and hypothetical unit prices, not observed users, percentiles or provider receipts.",
      "Instant successful settlement is assumed. Reservations use maximum prices; spend uses expected prices. Failures, retries and invoice reconciliation are not modeled.",
      "Recall first, then whole background jobs in chronological/input-order FIFO on active nights only. Oversized heads can starve later work and leave unused balance.",
      "Unknown-cost stages are omitted from service and separately disclosed. Stage dependencies, quality, capacity and latency are not qualified by completed job counts.",
      "Ineligible source versions and expired work cannot be admitted. Invalidating completed work never refunds its historical cost. No native access policy is implemented here.",
      "Recall units cover only incremental memory query/context cost, not ordinary answering. Benchmark answer/grading costs are excluded.",
      "The period is September 2026 UTC. No rollover, budget reset, later-month service or automatic enrollment is simulated.",
      "Infrastructure is separate from the assumed AI allowance. Subtotals do not establish full production cost or useful work delivered.",
    ],
  };
}

export function compareMonthlyCaps(trace: DemandTrace, estimates: StageEstimates,
  options: Omit<ProjectionOptions, "monthlyCapMicroUsd">) {
  const settings = ownRecord<Omit<ProjectionOptions, "monthlyCapMicroUsd">>(options,
    ["availableAiMicroUsd", "backfill", "infrastructureEstimateMicroUsd"]);
  const captured = snapshotInputs(trace, estimates, { ...settings, monthlyCapMicroUsd: COMPARISON_CAPS_MICRO_USD[0] });
  return COMPARISON_CAPS_MICRO_USD.map((monthlyCapMicroUsd) => calculate(captured.trace, captured.estimates,
    { ...captured.options, monthlyCapMicroUsd }));
}
