/** Standalone synthetic benchmark contracts. No production content reader is accepted. */
export type BenchmarkModel = "gpt-5.6-luna" | "gpt-5.6-terra";
export type BenchmarkArm = "none" | "reference" | "luna" | "terra";
export interface SyntheticFact {
  id: string;
  actorId: string;
  scopeId: string;
  day: number;
  text: string;
  kind: "chat" | "document" | "block" | "action";
  /** A later revision or withdrawal removes this fact from subsequent processing. */
  withdrawnDay?: number;
}
export interface SyntheticQuestion {
  id: string;
  actorId: string;
  allowedScopeIds: readonly string[];
  preferredScopeId: string;
  text: string;
  requiredFactIds: readonly string[];
  forbiddenFactIds: readonly string[];
  mustAbstain: boolean;
  category: string;
}
export interface MemoryEntry { factIds: string[]; text: string }
export interface BenchmarkAnswer { answer: string; factIds: string[]; abstain: boolean }
/** Cost is computed from verified token usage and the qualified pricebook, not an invoice receipt. */
export interface BenchmarkUsage { inputTokens: number; outputTokens: number; cachedInputTokens?: number; microUsd: number }
export interface BenchmarkResult {
  kind: "review" | "embedding" | "answer";
  usage: BenchmarkUsage;
  providerId: string | null;
  model: string;
  entries?: MemoryEntry[];
  vectors?: number[][];
  answer?: BenchmarkAnswer;
}
export interface BenchmarkOperation {
  id: string;
  ordinal: number;
  kind: BenchmarkResult["kind"];
  model: BenchmarkModel | "text-embedding-3-small";
  instructions: string;
  input: string | string[];
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumMicroUsd: number;
  allowedFactIds: readonly string[];
  dimensions?: number;
}
