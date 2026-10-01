import { memoryTimestamp } from "./memory-lifetime.ts";

export const MEMORY_SAVED_OUTPUTS_VERSION = "native-saved-outputs-v1";
export const MEMORY_SAVED_OUTPUTS_MAX_BYTES = 16_384;
export type MemorySavedOutputSource = { eventId: string; type: string; recordedAt: string; validUntil: string };
export type MemorySavedOutput = {
  sourceIndexes: number[]; origin: "native-generated-output"; independentEvidence: false; generatedAt: string;
};
export type MemorySavedOutputs = {
  version: typeof MEMORY_SAVED_OUTPUTS_VERSION; treatment: "descriptive-output-retention"; inferredPreferences: false;
  coverage: { selectedSourceCount: number; selectedRetentionActionCount: number; certifiedOutputCount: number;
    completeHistory: false; bounded: true; nativeImageJobsOnly: true };
  outputs: MemorySavedOutput[];
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const dense = (value: readonly unknown[]) => Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index));
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && value.trim() === value && value.isWellFormed();
const retentionAction = (type: string) => ["ObjectSaved", "ObjectPinned", "ObjectExported"].includes(type);

/** Validate descriptive groups against the enclosing certified source window.
 * This does not independently certify a native job or grant new read authority. */
export function parseMemorySavedOutputs(value: unknown, sources: readonly MemorySavedOutputSource[],
  lifetime: { checkedAt: string; validUntil: string }): MemorySavedOutputs | null {
  try {
    if (!object(value) || !exact(value, ["version", "treatment", "inferredPreferences", "coverage", "outputs"])
      || value.version !== MEMORY_SAVED_OUTPUTS_VERSION || value.treatment !== "descriptive-output-retention" || value.inferredPreferences !== false
      || new TextEncoder().encode(JSON.stringify(value)).byteLength > MEMORY_SAVED_OUTPUTS_MAX_BYTES) return null;
    const checked = memoryTimestamp(lifetime?.checkedAt), until = memoryTimestamp(lifetime?.validUntil);
    if (checked === null || until === null || until <= checked || until - checked > 60_000
      || !Array.isArray(sources) || sources.length > 64 || !dense(sources)
      || sources.some(source => !source || !id(source.eventId) || !id(source.type)
        || memoryTimestamp(source.recordedAt) === null || memoryTimestamp(source.recordedAt)! > checked
        || memoryTimestamp(source.validUntil) === null || memoryTimestamp(source.validUntil)! < until)
      || new Set(sources.map(source => source.eventId)).size !== sources.length) return null;
    const selectedRetentionActionCount = sources.filter(source => retentionAction(source.type)).length, coverage = value.coverage;
    if (!object(coverage) || !exact(coverage, ["selectedSourceCount", "selectedRetentionActionCount", "certifiedOutputCount", "completeHistory", "bounded", "nativeImageJobsOnly"])
      || coverage.selectedSourceCount !== sources.length || coverage.selectedRetentionActionCount !== selectedRetentionActionCount
      || coverage.completeHistory !== false || coverage.bounded !== true || coverage.nativeImageJobsOnly !== true
      || !Array.isArray(value.outputs) || !dense(value.outputs) || value.outputs.length > 64
      || coverage.certifiedOutputCount !== value.outputs.length || value.outputs.length === 0 && selectedRetentionActionCount !== 0) return null;
    const references = new Set<number>(), outputs: MemorySavedOutput[] = [];
    let previousGroup = -1;
    for (const item of value.outputs) {
      if (!object(item) || !exact(item, ["sourceIndexes", "origin", "independentEvidence", "generatedAt"])
        || item.origin !== "native-generated-output" || item.independentEvidence !== false
        || !Array.isArray(item.sourceIndexes) || !dense(item.sourceIndexes) || item.sourceIndexes.length < 1 || item.sourceIndexes.length > 64
        || memoryTimestamp(item.generatedAt) === null) return null;
      const indices: number[] = [];
      let previous = -1;
      for (const position of item.sourceIndexes) {
        if (!Number.isSafeInteger(position) || position <= previous || position < 0 || position >= sources.length
          || references.has(position) || !retentionAction(sources[position].type)
          || memoryTimestamp(item.generatedAt)! > memoryTimestamp(sources[position].recordedAt)!) return null;
        previous = position; references.add(position); indices.push(position);
      }
      if (indices[0] <= previousGroup) return null;
      previousGroup = indices[0];
      outputs.push({ sourceIndexes: indices, origin: "native-generated-output", independentEvidence: false, generatedAt: item.generatedAt as string });
    }
    return { version: MEMORY_SAVED_OUTPUTS_VERSION, treatment: "descriptive-output-retention", inferredPreferences: false,
      coverage: { selectedSourceCount: sources.length, selectedRetentionActionCount, certifiedOutputCount: outputs.length,
        completeHistory: false, bounded: true, nativeImageJobsOnly: true }, outputs };
  } catch { return null; }
}
