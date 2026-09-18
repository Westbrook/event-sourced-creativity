import type { DemandTrace, ProjectionJob, ProjectionSource, ProjectionStage } from "./projection-types.ts";

type Workload = "light" | "typical" | "heavy";
type MutableSource = { -readonly [Key in keyof ProjectionSource]: ProjectionSource[Key] };

/**
 * Authored demand, not observed user percentiles, production schedules, measured
 * token usage, or evidence that the requested processing stages are implemented.
 *
 * Each source version represents one fictional document revision. Embedding
 * units are authored chunk counts, not token counts derived from the separate
 * 20-day semantic fixture. Other units are one night-review batch, one
 * conversation-summary batch, one profile-update batch, or one incremental
 * recall request. None of these units includes benchmark answer/grading calls.
 *
 * Assumptions, in light / typical / heavy order:
 * - 8 / 16 / 22 explicitly selected active days in September 2026.
 * - 4 / 12 / 24 existing documents in the first eligible backfill snapshot.
 * - 2–4 / 4–6 / 8–10 chunks per backfill document.
 * - The second active day contains only revisits and recall requests.
 * - Later active days revise 1 / 2 / 3 documents, at 1–3 / 3–5 / 6–8 chunks.
 * - One review batch per active night; chat summaries on the first active day
 *   and two of every three later edit days; profiles on the first active day
 *   and every fifth active-day index. These are modeled demand assumptions.
 * - 3–5 / 12–14 / 30–32 incremental recall requests per active day.
 * - One document is withdrawn on an inactive day and is never restored.
 *
 * No price, cap, queue policy, usefulness score, real content, actor, or native
 * application authority is supplied or inferred here. Larger workloads are not
 * constructed to force a particular outcome at the comparison caps.
 */
const SETTINGS = {
  light: {
    activeDays: [1, 4, 7, 10, 15, 20, 25, 30],
    documentCount: 4, backfillChunks: 2, revisionsPerEditDay: 1,
    changedChunks: 1, recallRequests: 3, withdrawalDay: 3,
  },
  typical: {
    activeDays: [1, 2, 4, 5, 7, 9, 10, 12, 14, 16, 18, 20, 22, 24, 27, 30],
    documentCount: 12, backfillChunks: 4, revisionsPerEditDay: 2,
    changedChunks: 3, recallRequests: 12, withdrawalDay: 3,
  },
  heavy: {
    activeDays: [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24, 27, 30],
    documentCount: 24, backfillChunks: 8, revisionsPerEditDay: 3,
    changedChunks: 6, recallRequests: 30, withdrawalDay: 5,
  },
} as const;

/** Returns a fresh, deeply frozen trace; no mutable singleton state is exposed. */
export function syntheticDemandTrace(workload: Workload): DemandTrace {
  if (workload !== "light" && workload !== "typical" && workload !== "heavy") {
    throw new TypeError("Unknown authored synthetic workload.");
  }
  const settings = SETTINGS[workload];
  const activeDays = Array.from({ length: 30 }, (_, index) =>
    (settings.activeDays as readonly number[]).includes(index + 1));
  const sources: MutableSource[] = [];
  const jobs: ProjectionJob[] = [];
  const currentVersions: MutableSource[] = [];
  const revisions = Array.from({ length: settings.documentCount }, () => 1);
  let jobOrdinal = 0;
  let editOrdinal = 0;

  const source = (documentIndex: number, revision: number, day: number): MutableSource => ({
    versionId: `synthetic:${workload}:document:${String(documentIndex + 1).padStart(2, "0")}:v:${revision}`,
    createdDay: day,
    invalidatedDay: null,
    invalidationReason: null,
  });
  const addJob = (
    day: number, stage: ProjectionStage, units: number,
    sourceVersions: readonly string[], expiresDay: number | null = null,
  ): void => {
    jobOrdinal += 1;
    jobs.push({
      id: `synthetic:${workload}:day:${String(day).padStart(2, "0")}:job:${String(jobOrdinal).padStart(3, "0")}`,
      day, stage, units, sourceVersions: [...sourceVersions], expiresDay,
    });
  };

  // Day 1 is the beginning-of-month snapshot of pre-existing eligible material,
  // not a claim that all of those documents were authored on that day.
  for (let documentIndex = 0; documentIndex < settings.documentCount; documentIndex += 1) {
    const initial = source(documentIndex, 1, 1);
    if (documentIndex === 1) {
      initial.invalidatedDay = settings.withdrawalDay;
      initial.invalidationReason = "withdrawn";
    }
    sources.push(initial);
    currentVersions.push(initial);
  }
  const editableDocuments = Array.from({ length: settings.documentCount }, (_, index) => index)
    .filter((index) => index !== 1);

  settings.activeDays.forEach((day, activeIndex) => {
    const changedToday: MutableSource[] = [];
    if (activeIndex === 0) {
      currentVersions.forEach((version, index) => {
        addJob(day, "backfill_embedding", settings.backfillChunks + index % 3, [version.versionId]);
      });
    } else if (activeIndex >= 2) {
      // The withdrawn document has no successor. Revisions replace a specific
      // existing source version at the beginning of their creation day.
      for (let changeIndex = 0; changeIndex < settings.revisionsPerEditDay; changeIndex += 1) {
        const documentIndex = editableDocuments[editOrdinal % editableDocuments.length];
        editOrdinal += 1;
        const previous = currentVersions[documentIndex];
        previous.invalidatedDay = day;
        previous.invalidationReason = "superseded";
        revisions[documentIndex] += 1;
        const next = source(documentIndex, revisions[documentIndex], day);
        sources.push(next);
        currentVersions[documentIndex] = next;
        changedToday.push(next);
        addJob(day, "changed_embedding", settings.changedChunks + (activeIndex + changeIndex) % 3, [next.versionId]);
      }
    }

    const currentEligible = currentVersions.filter((version) =>
      version.createdDay <= day && (version.invalidatedDay === null || day < version.invalidatedDay));
    // Edited sources precede ordinary context, and every batch is explicitly
    // source-bound. This is a bounded demand set, not a native retrieval policy.
    const context = [...new Set([...changedToday, ...currentEligible].map((version) => version.versionId))].slice(0, 16);
    addJob(day, "night_review", 1, context);
    if (activeIndex === 0 || (activeIndex >= 2 && activeIndex % 3 !== 1)) {
      addJob(day, "conversation_summary", 1, context);
    }
    if (activeIndex === 0 || (activeIndex >= 2 && activeIndex % 5 === 0)) {
      addJob(day, "profile_update", 1, context);
    }
    // Recall requests remain individually admissible, rather than creating an
    // artificial all-or-nothing daily cost cliff. A missed recall is not
    // automatically converted into a future user query.
    for (let recallIndex = 0; recallIndex < settings.recallRequests + activeIndex % 3; recallIndex += 1) {
      addJob(day, "recall_increment", 1, context, day + 1);
    }
  });

  const frozenSources = Object.freeze(sources.map((version) => Object.freeze(version)));
  const frozenJobs = Object.freeze(jobs.map((job) => Object.freeze({
    ...job, sourceVersions: Object.freeze([...job.sourceVersions]),
  })));
  return Object.freeze({
    version: "synthetic:memory-demand-2026-09-v1",
    workload,
    period: "2026-09",
    activeDays: Object.freeze(activeDays),
    sources: frozenSources,
    jobs: frozenJobs,
  });
}
