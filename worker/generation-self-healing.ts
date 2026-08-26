import type { DocumentArtifactKind, DocumentArtifactValidationIssue } from "../src/model/document-artifacts.ts";

const MAX_RECORDED_ISSUES_PER_STAGE = 128;
const SAFE_ISSUE_CODE = /^[a-z][a-z0-9_]{0,95}$/u;
const SAFE_ADAPTER_IDENTIFIER = /^[A-Za-z][A-Za-z0-9._-]{0,95}$/u;
const SAFE_ADAPTER_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const SAFE_ISSUE_ROOTS = new Set(["items", "presentation", "content_markdown", "title", "summary"]);
const SAFE_ISSUE_FIELDS = new Set([
  "title", "body", "notes", "image_prompt", "context_group_ids", "slide", "layout", "kicker", "bullets",
  "visual", "kind", "label", "value", "data", "weight", "exact_value", "display_value", "exactValue",
  "displayValue", "unit", "quote", "text", "speaker", "role", "citations", "citation", "section",
  "source_ids", "sourceIds", "source_order", "sourceOrder", "presentation", "footer_label", "style_preset",
  "theme", "mode", "palette", "background", "foreground", "accent", "muted", "surface",
]);

export type GenerationValidationStage = "initial" | "repair" | "review" | "assembly";

export type GenerationValidationObservation = {
  stage: GenerationValidationStage;
  issues: readonly DocumentArtifactValidationIssue[];
  pageIndex?: number;
  providerAttempt?: number;
};

export type GenerationValidationStageReceipt = {
  stage: GenerationValidationStage;
  issue_count: number;
  issues: Array<{ code: string; path: string }>;
  page_index?: number;
  provider_attempt?: number;
};

export type GenerationAdapterReconciliationReceipt = {
  required: boolean;
  status: "pending" | "not_required";
  artifact_kind: DocumentArtifactKind;
  adapter_id: string;
  adapter_version: string | null;
  issue_codes: string[];
  issue_frequencies: Record<string, number>;
  issue_fingerprints: string[];
  issue_count: number;
  failed_stage_count: number;
  self_healed: boolean;
  final_issue_count: number;
};

function safeIssue(issue: DocumentArtifactValidationIssue): { code: string; path: string } {
  const code = SAFE_ISSUE_CODE.test(issue.code) ? issue.code : "generation_validation_failed";
  const segments = typeof issue.path === "string" ? issue.path.split(".") : [];
  const path = issue.path === "$" || issue.path.length <= 256
    && SAFE_ISSUE_ROOTS.has(segments[0] ?? "")
    && segments.slice(1).every((segment) => /^\d+$/u.test(segment) || SAFE_ISSUE_FIELDS.has(segment))
    ? issue.path
    : "$";
  // Authored output, source IDs, provider diagnostics, and issue prose never enter
  // reconciliation evidence. Codes and structural field paths are sufficient.
  return { code, path };
}

function safeAdapterIdentifier(value: string | undefined, fallback: string): string {
  return value && SAFE_ADAPTER_IDENTIFIER.test(value) ? value : fallback;
}

function safeAdapterVersion(value: string | undefined): string {
  return value && SAFE_ADAPTER_VERSION.test(value) ? value : "unknown";
}

function validIndex(value: number | undefined, minimum: number): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= minimum && value <= 1_000_000;
}

/** Preserve privacy-safe validation failures even when bounded automatic repair succeeds. */
export function generationValidationReceipt(
  kind: DocumentArtifactKind,
  observations: readonly GenerationValidationObservation[],
  options: {
    adapterId?: string;
    adapterVersion?: string;
    finalIssues?: readonly DocumentArtifactValidationIssue[];
  } = {},
): {
  validation_history: GenerationValidationStageReceipt[];
  adapter_reconciliation: GenerationAdapterReconciliationReceipt;
} {
  const validationHistory: GenerationValidationStageReceipt[] = observations.map((observation) => ({
    stage: observation.stage,
    issue_count: observation.issues.length,
    issues: observation.issues.slice(0, MAX_RECORDED_ISSUES_PER_STAGE).map(safeIssue),
    ...(validIndex(observation.pageIndex, 0) ? { page_index: observation.pageIndex } : {}),
    ...(validIndex(observation.providerAttempt, 1) ? { provider_attempt: observation.providerAttempt } : {}),
  }));
  const recordedIssues = validationHistory.flatMap((observation) => observation.issues);
  const frequencies = new Map<string, number>();
  for (const issue of recordedIssues) frequencies.set(issue.code, (frequencies.get(issue.code) ?? 0) + 1);
  const issueCodes = [...frequencies.keys()].sort();
  const finalIssueCount = options.finalIssues?.length ?? observations.at(-1)?.issues.length ?? 0;
  const failedStageCount = validationHistory.filter((observation) => observation.issue_count > 0).length;
  const required = failedStageCount > 0;

  return {
    validation_history: validationHistory,
    adapter_reconciliation: {
      required,
      // A successful repair resolves the artifact, not the underlying adapter defect.
      status: required ? "pending" : "not_required",
      artifact_kind: kind,
      adapter_id: safeAdapterIdentifier(options.adapterId, "document-artifact"),
      adapter_version: options.adapterVersion ? safeAdapterVersion(options.adapterVersion) : null,
      issue_codes: issueCodes,
      issue_frequencies: Object.fromEntries(issueCodes.map((code) => [code, frequencies.get(code) ?? 0])),
      issue_fingerprints: [...new Set(recordedIssues.map((issue) => `${issue.code}@${issue.path}`))].sort(),
      issue_count: validationHistory.reduce((count, observation) => count + observation.issue_count, 0),
      failed_stage_count: failedStageCount,
      self_healed: required && finalIssueCount === 0,
      final_issue_count: finalIssueCount,
    },
  };
}

/** Select only affected pages; unlocalized artifact failures require reviewing every page once. */
export function generationRepairPages(
  issues: readonly DocumentArtifactValidationIssue[],
  options: { pageCount: number; pageSize: number },
): number[] {
  if (!issues.length || !Number.isSafeInteger(options.pageCount) || options.pageCount < 1
    || !Number.isSafeInteger(options.pageSize) || options.pageSize < 1) return [];

  const affected = new Set<number>();
  for (const issue of issues) {
    const match = /^items\.(\d+)(?:\.|$)/u.exec(issue.path);
    if (!match) return Array.from({ length: options.pageCount }, (_, index) => index);
    const itemIndex = Number(match[1]);
    const pageIndex = Math.floor(itemIndex / options.pageSize);
    if (!Number.isSafeInteger(itemIndex) || pageIndex >= options.pageCount) {
      return Array.from({ length: options.pageCount }, (_, index) => index);
    }
    affected.add(pageIndex);
  }
  return [...affected].sort((left, right) => left - right);
}

/** Expose only safe operational scalars so repaired defects remain discoverable after private evidence expires. */
export function generationReconciliationEventFields(value: unknown): Record<string, string | number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const receipt = value as Partial<GenerationAdapterReconciliationReceipt>;
  if (receipt.required !== true || receipt.status !== "pending") return {};
  const issueCode = Array.isArray(receipt.issue_codes)
    ? receipt.issue_codes.find((code) => typeof code === "string" && SAFE_ISSUE_CODE.test(code))
    : undefined;
  if (!issueCode) return {};
  const count = (input: unknown) => typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? Math.min(input, 1_000_000)
    : 0;

  return {
    adapter_id: safeAdapterIdentifier(receipt.adapter_id, "document-artifact"),
    ...(receipt.adapter_version
      ? { adapter_version: safeAdapterVersion(receipt.adapter_version) }
      : {}),
    adapter_reconciliation_status: "pending",
    adapter_issue_kind: issueCode,
    adapter_issue_count: count(receipt.issue_count),
    adapter_failed_stage_count: count(receipt.failed_stage_count),
    adapter_final_issue_count: count(receipt.final_issue_count),
    adapter_repair_status: receipt.self_healed === true ? "self_healed" : "unresolved",
  };
}

/** Preserve terminal validation incidents even when no successful generation receipt can be returned. */
export function generationFailureReconciliationEventFields(
  kind: DocumentArtifactKind,
  issues: readonly (DocumentArtifactValidationIssue & { stage?: "initial" | "repair" })[] | undefined,
  options: { adapterId?: string; adapterVersion?: string } = {},
): Record<string, string | number> {
  if (!issues?.length) return {};
  const initial = issues.filter((issue) => issue.stage !== "repair");
  const repaired = issues.filter((issue) => issue.stage === "repair");
  const observations: GenerationValidationObservation[] = [
    ...(initial.length ? [{ stage: "initial" as const, issues: initial }] : []),
    ...(repaired.length ? [{ stage: "repair" as const, issues: repaired }] : []),
  ];
  const receipt = generationValidationReceipt(kind, observations, {
    ...options,
    finalIssues: repaired.length ? repaired : initial,
  });
  return generationReconciliationEventFields(receipt.adapter_reconciliation);
}
