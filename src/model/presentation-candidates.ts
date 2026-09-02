import { generationExecutionSummary } from "./generation-execution-evidence.ts";
import { hasUnresolvedProviderSubmission, hasUnsettledProviderSubmission, providerSubmissions } from "./provider-submission.ts";
import type { SlideCountPolicy } from "./presentation-count-policy.ts";
import type { DocumentArtifactDraftItem, DocumentArtifactValidationIssue, SlidePresentation, SlideVisualData } from "./document-artifacts.ts";

export type PresentationCandidateIssueCategory =
  | "source-integrity"
  | "authorization"
  | "safety"
  | "rights"
  | "structure"
  | "presentation-preference";

export type PresentationCandidateValidationIssue = {
  code: string;
  path: string;
  message: string;
  category: PresentationCandidateIssueCategory;
  blocking: boolean;
  overridable: boolean;
  pageIndex: number;
  pageCount: number;
  globalSlideIndex: number | null;
  providerAttempt: number;
  stage: "initial" | "repair";
};

export type PresentationCandidateSummary = {
  responseId: string;
  jobId: string;
  documentId: string;
  model: string;
  capturedAt: string;
  expiresAt: string;
  retentionClass: "transient-private" | "governed-evidence";
  stage: "initial" | "repair";
  providerAttempt: number;
  pageIndex: number;
  pageCount: number;
  globalStartIndex: number;
  generatedSlideCount: number;
  requestedSlideCount: number | null;
  slideCountPolicy?: SlideCountPolicy;
  plannedSlideCount: number;
  providerBatchCount: number;
  providerCalls: number;
  settledCostMicrousd: number | null;
  complete: boolean;
  reviewOnlyReason?: "historical-validation-rejection" | "validation-provenance-unavailable";
  missingContextGroupLabels: string[];
  issues: PresentationCandidateValidationIssue[];
};

export type PresentationCandidateSlide = {
  title: string;
  body: string;
  notes: string;
  groupLabels: string[];
  slide: SlideVisualData | null;
};

export type PresentationCandidateCitationCheck = {
  slideIndex: number;
  citationIndex: number;
  sourceLabel: string;
  excerpt: string;
  excerptTruncated: boolean;
  sourceStatus: "authorized" | "unauthorized" | "unassigned" | "missing";
  excerptStatus: "grounded" | "ungrounded" | "empty" | "unresolved";
  anchorStatus: "valid" | "incorrect";
  passages: Array<{ content: string; truncated: boolean }>;
};

export type PresentationCandidateDetail = PresentationCandidateSummary & {
  title: string;
  summary: string;
  presentation: SlidePresentation | null;
  slides: PresentationCandidateSlide[];
  citationChecks?: PresentationCandidateCitationCheck[];
  accounting?: PresentationCandidateAccounting;
  revision?: { token: string; fields: PresentationCandidateEdit[] };
  normalizationChanges: Array<{ path: string; originalValue: string; normalizedValue: string; reason: string }>;
};

export type PresentationCandidateList = {
  jobId: string;
  documentId: string;
  candidates: PresentationCandidateSummary[];
};

export type PreservedPresentationCandidateJobs = {
  documentId: string;
  jobs: PresentationCandidateList[];
};

/** A compiler upgrade does not authorize accepting a previously rejected paid response. */
export function historicalPresentationValidationRejection(checkpoint: Record<string, unknown>, adapterVersion: string): boolean {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const receipt = record(checkpoint.generationReceipt);
  if (receipt.presentation_adapter_version === adapterVersion) return false;
  const detail = record(checkpoint.errorDetail);
  const rejectionCodes = new Set(["source_fidelity_validation_failed", "provider_returned_incomplete_document_artifact"]);
  return receipt.failure_stage === "source_fidelity_validation"
    || rejectionCodes.has(String(receipt.failure_code ?? ""))
    || rejectionCodes.has(String(detail.code ?? ""))
    || Array.isArray(detail.validationIssues) && detail.validationIssues.length > 0;
}

const authorizationIssue = /(?:unknown|unauthorized|incorrect_(?:slide|visual|citation|quote)_source|incorrect_context_group|source_grounding|source_reference)/u;
const integrityIssue = /(?:source|citation|protected|precision|scorecard|numeric|quote|roadmap|outline|context_group|exact_value|display_value)/u;
const preferenceIssue = /(?:style_mismatch|duplicate_(?:slide|deck)_copy|duplicate_opening_slide|continuity_drift)/u;

const issueMessage = (code: string): string => ({
  invalid_json: "The generated response did not contain a complete presentation object.",
  missing_content: "The presentation is missing its complete readable content.",
  wrong_item_count: "The generated slide count does not match the approved presentation plan.",
  slide_count_mismatch: "The generated slide count does not match the approved presentation plan.",
  missing_context_group: "A required Combined Context chapter is absent from this presentation.",
  unknown_context_group: "The response referenced a Combined Context chapter outside the approved presentation.",
  unknown_context_group_reference: "The response referenced a Combined Context alias that was not approved for this request.",
  split_context_group: "A required Combined Context chapter was reopened outside its contiguous slide range.",
  incorrect_context_group_assignment: "A slide includes Combined Context assigned to a different presentation chapter.",
  unknown_source_reference: "The response referenced source evidence that was not authorized for this request.",
  incorrect_slide_source: "A slide includes evidence assigned to a different authorized presentation chapter.",
  incorrect_visual_source: "A slide visual includes evidence assigned to a different authorized presentation chapter.",
  incorrect_citation_source: "A citation does not identify evidence permitted for this slide. Review the source assignment separately from its quoted excerpt.",
  incorrect_citation_anchor: "A citation's slide anchor does not match its resolved evidence passage. Review the cited passage and anchor separately.",
  ungrounded_citation_excerpt: "A citation excerpt does not match a contiguous quotation in its resolved source passage. Review the cited passage and exact wording; this finding alone does not establish invented wording.",
  missing_citation_excerpt: "A citation needs a nonempty quotation from its cited evidence passage.",
  incorrect_quote_source: "A stakeholder quotation does not identify evidence permitted for this slide.",
  ungrounded_quote_text: "A displayed quotation does not match a contiguous quotation in its resolved source passage.",
  unverified_quote_attribution: "A quotation's speaker or role is not verified by its cited source passage. Preserve the source attribution without inventing an identity.",
  missing_source_grounding: "A slide does not identify its required authorized source evidence.",
  missing_slide_source: "A slide does not identify its required authorized source evidence.",
  ambiguous_presentation_output: "Select one presentation output and give sibling output specifications separate headings.",
  ambiguous_presentation_context_group: "A presentation context group also includes or describes a sibling output. Separate the output assignments before generating.",
  ambiguous_presentation_source_mode: "The source mixes an output outline with authored slide prose. Identify its intended source mode before generating.",
  ambiguous_presentation_slide_number: "The selected presentation repeats a slide number. Give every slide a unique numbered position.",
  unresolved_outline_evidence: "An outline slide has coverage instructions but no resolved supporting research. Assign its evidence explicitly or make the coverage terms more specific.",
  unassigned_required_presentation_source: "Mandatory research has no assigned slide coverage. Assign it explicitly; required evidence cannot be dropped.",
  incorrect_outline_title: "A slide must retain its parsed outline title without adding authoring directions.",
  missing_outline_evidence: "An outline slide needs a grounded citation to its assigned supporting research. Output instructions are not supporting evidence.",
  missing_outline_coverage: "A slide does not visibly cover a required part of the output outline. Citation excerpts and speaker notes do not satisfy visible coverage.",
  missing_outline_number: "A slide omits a numerical claim required by its output instructions.",
  unsupported_outline_number: "A slide contains a numerical value or unit not supported by its assigned evidence and output requirements.",
  incorrect_outline_numeric_context: "A slide assigns a source number to a different claim or measurement. Preserve the value, label, and unit together.",
  missing_required_presentation_evidence: "Mandatory supporting research is not covered in audience-facing slide content. A source assignment or citation alone does not satisfy required evidence coverage.",
  missing_outline_qualifier: "A slide omits a required qualification from its output instructions, such as whether a claim is proposed or unverified.",
  incorrect_outline_polarity: "A slide reverses a required limitation or exclusion. Preserve the meaning of the output instruction, including what must not be claimed.",
  missing_footer_label: "The presentation is missing its document-derived footer label.",
  missing_title: "A slide is missing its required title.",
  missing_slide: "A slide is missing its structured visual content.",
  incomplete_visual: "A slide visual is missing the meaningful source-authored value or evidence required for its visual type.",
  missing_visible_claim: "A slide does not contain a visible, source-grounded claim.",
  duplicate_slide_copy: "A slide repeats visible copy that should provide distinct information.",
  duplicate_deck_copy: "The presentation repeats visible copy across multiple slides.",
  presentation_style_mismatch: "The presentation does not use the explicitly selected visual style.",
}[code] ?? "The generated presentation does not satisfy an approved structural or source-integrity requirement.");

/** Diagnostics may appear in shared job metadata, so provider prose and source identifiers are never reused. */
export function safePresentationCandidateIssues(
  issues: readonly DocumentArtifactValidationIssue[],
  metadata: { pageIndex: number; pageCount: number; globalStartIndex: number; providerAttempt: number; stage: "initial" | "repair" },
): PresentationCandidateValidationIssue[] {
  return issues.map((issue) => {
    const code = /^[a-z][a-z0-9_]{0,79}$/u.test(issue.code) ? issue.code : "presentation_validation_failed";
    const path = /^(?:\$|(?:items(?:\.\d+)?|presentation(?:_source)?|content_markdown)(?:\.[a-z_]+|\.(?:sourceId|sourceIds|sourceOrder|evidencePassageIds|exactValue|displayValue)|\.\d+)*)$/u.test(issue.path)
      ? issue.path
      : "$";
    const position = /^items\.(\d+)(?:\.|$)/u.exec(path);
    const category: PresentationCandidateIssueCategory = /(?:rights|license|copyright)/u.test(code)
      ? "rights"
      : /(?:safety|moderation)/u.test(code)
        ? "safety"
        : authorizationIssue.test(code)
          ? "authorization"
          : integrityIssue.test(code)
            ? "source-integrity"
            : preferenceIssue.test(code)
              ? "presentation-preference"
              : "structure";
    return {
      code,
      path,
      message: issueMessage(code),
      category,
      blocking: true,
      overridable: category === "presentation-preference",
      pageIndex: metadata.pageIndex,
      pageCount: metadata.pageCount,
      globalSlideIndex: position ? metadata.globalStartIndex + Number(position[1]) + 1 : null,
      providerAttempt: metadata.providerAttempt,
      stage: metadata.stage,
    };
  });
}

/** Convert an actor-private candidate to inert visible copy without durable references, prompts, or URLs. */
export function sanitizePresentationCandidateText(value: unknown, privateReferences: readonly string[] = []): string {
  const initial = typeof value === "string" ? value : "";
  const references = [...new Set(privateReferences.filter(Boolean))].sort((left, right) => right.length - left.length);
  const scrubbed = references.reduce((copy, reference) => copy.replaceAll(reference, "[private source]"), initial)
    .replace(/\b(?:blk|grp|clm|context_group|decision)_\d+\b/giu, "[private source]")
    .replace(/\b[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}\b/giu, "[private source]");
  return /^(?:https?:|data:|javascript:|blob:)/iu.test(scrubbed.trim()) ? "" : scrubbed;
}

/** Private review only: omit passage identifiers and bound display text without changing validation. */
export function sanitizePresentationCitationChecks(
  checks: ReadonlyArray<Omit<PresentationCandidateCitationCheck, "excerptTruncated" | "passages"> & { passages: ReadonlyArray<{ content: string }> }>,
  privateReferences: readonly string[] = [],
): PresentationCandidateCitationCheck[] {
  const display = (value: string) => {
    const text = sanitizePresentationCandidateText(value, privateReferences);
    return { content: text.slice(0, 12_000), truncated: text.length > 12_000 };
  };
  return checks.map((check) => {
    const excerpt = display(check.excerpt);
    return {
      slideIndex: check.slideIndex,
      citationIndex: check.citationIndex,
      sourceLabel: sanitizePresentationCandidateText(check.sourceLabel, privateReferences),
      excerpt: excerpt.content,
      excerptTruncated: excerpt.truncated,
      sourceStatus: check.sourceStatus,
      excerptStatus: check.excerptStatus,
      anchorStatus: check.anchorStatus,
      passages: check.passages.map((passage) => display(passage.content)),
    };
  });
}

/** Convert an actor-private candidate to inert visible copy without durable references, prompts, or URLs. */
export function sanitizePresentationCandidateSlides(
  items: readonly DocumentArtifactDraftItem[],
  groupLabels: ReadonlyMap<string, string>,
  privateReferences: readonly string[] = [],
): PresentationCandidateSlide[] {
  const safeText = (value: unknown) => sanitizePresentationCandidateText(value, privateReferences);
  return items.map((item) => ({
    title: safeText(item.title),
    body: safeText(item.body),
    notes: safeText(item.notes),
    groupLabels: (item.context_group_ids ?? []).flatMap((id) => groupLabels.has(id) ? [safeText(groupLabels.get(id))] : []),
    slide: item.slide ? {
      layout: item.slide.layout,
      kicker: safeText(item.slide.kicker),
      bullets: item.slide.bullets.map(safeText),
      ...(item.slide.section ? { section: safeText(item.slide.section) } : {}),
      ...(item.slide.sourceOrder ? { sourceOrder: item.slide.sourceOrder } : {}),
      ...(item.slide.quote ? { quote: {
        text: safeText(item.slide.quote.text),
        speaker: safeText(item.slide.quote.speaker),
        role: safeText(item.slide.quote.role),
        ...(item.slide.quote.citation ? { citation: safeText(item.slide.quote.citation) } : {}),
      } } : {}),
      ...(item.slide.citations?.length ? { citations: item.slide.citations.map((citation) => ({
        label: safeText(citation.label),
        anchor: safeText(citation.anchor),
        excerpt: safeText(citation.excerpt),
      })) } : {}),
      visual: {
        kind: item.slide.visual.kind,
        label: safeText(item.slide.visual.label),
        value: safeText(item.slide.visual.value),
        ...(item.slide.visual.exactValue ? { exactValue: safeText(item.slide.visual.exactValue) } : {}),
        ...(item.slide.visual.displayValue ? { displayValue: safeText(item.slide.visual.displayValue) } : {}),
        ...(item.slide.visual.unit ? { unit: safeText(item.slide.visual.unit) } : {}),
        data: item.slide.visual.data.map((datum) => ({
          label: safeText(datum.label),
          value: safeText(datum.value),
          weight: datum.weight,
          ...(datum.exactValue ? { exactValue: safeText(datum.exactValue) } : {}),
          ...(datum.displayValue ? { displayValue: safeText(datum.displayValue) } : {}),
        })),
      },
    } : null,
  }));
}

export type PresentationCandidateAccounting = {
  /** Verified charge only: a final total when complete, otherwise the settled portion so far. */
  settled_cost_microusd: number | null;
  settled_cost_complete: boolean;
  /** Current outstanding hold, never the original reservation allocation. */
  reservation_microusd: number | null;
  reservation_status: "active" | "executing" | "settled" | "released" | "unknown";
  actual_provider_call_count: number | null;
  attempted_provider_call_count: number | null;
  unresolved_provider_call_count: number | null;
  provider_submission_uncertain: boolean;
};

const candidateRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const candidateCount = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const candidateText = (value: unknown) => typeof value === "string" && value ? value : null;

/** Project original receipts without reconciling, releasing a hold, or repricing historical usage.
 * The worker supplies only exact actor/job-owned ledger rows and immutable usage receipts. */
export function presentationCandidateAccounting(checkpoint: Record<string, unknown>, evidence: {
  reservations: readonly Record<string, unknown>[];
  usage: readonly Record<string, unknown>[];
  responseIds: readonly string[];
  minimumAttempt: number;
  preserved: readonly Record<string, unknown>[];
}): PresentationCandidateAccounting {
  const receipt = candidateRecord(generationExecutionSummary(checkpoint));
  const submissions = providerSubmissions(checkpoint);
  const pending = submissions.filter(entry => entry.status === "pending");
  const originalReceipt = candidateRecord(checkpoint.generationReceipt);
  const hasCurrentCalls = submissions.length > 0 || hasUnresolvedProviderSubmission(checkpoint)
    || checkpoint.presentationProviderSubmission === "pending" || checkpoint.presentationProviderSubmission === "confirmed"
    || ["submitted", "completed", "not_submitted", "submission_unknown"].includes(String(originalReceipt.provider_request_status));
  const preserved = evidence.preserved.filter(value => value.schema_version === 1).map(value => candidateRecord(value.accounting));
  const previousCount = (field: string) => preserved.reduce<number | null>((maximum, value) => {
    const count = candidateCount(value[field]);
    return count === null ? maximum : Math.max(maximum ?? 0, count);
  }, null);
  const confirmed = new Set(evidence.responseIds);
  for (const id of Array.isArray(checkpoint.plannerResponseIds) ? checkpoint.plannerResponseIds : []) if (candidateText(id)) confirmed.add(String(id));
  if (candidateText(checkpoint.plannerResponseId)) confirmed.add(String(checkpoint.plannerResponseId));
  for (const submission of submissions) if (submission.status !== "pending" && candidateText(submission.providerRequestId)) confirmed.add(String(submission.providerRequestId));
  const currentCount = candidateCount(receipt.actual_provider_call_count);
  const actual = confirmed.size || currentCount !== null || previousCount("actual_provider_call_count") !== null
    ? Math.max(confirmed.size, currentCount ?? 0, previousCount("actual_provider_call_count") ?? 0) : null;
  const legacyPending = checkpoint.presentationProviderSubmission === "pending" && !pending.some(entry => entry.operation === "planning");
  const currentUncertain = hasUnresolvedProviderSubmission(checkpoint) || legacyPending
    || receipt.provider_submission_uncertain === true || receipt.provider_request_status === "submission_unknown";
  const savedUncertain = preserved.some(value => value.provider_submission_uncertain !== false);
  const uncertain = hasCurrentCalls ? currentUncertain : !preserved.length || savedUncertain;
  const pendingCount = candidateCount(receipt.unresolved_provider_call_count);
  const unresolved = hasCurrentCalls
    ? currentUncertain ? pending.length || legacyPending ? Math.max(pending.length + (legacyPending ? 1 : 0), pendingCount ?? 0) : pendingCount && pendingCount > 0 ? pendingCount : null : 0
    : preserved.length && !preserved.some(value => candidateCount(value.unresolved_provider_call_count) === null)
      ? previousCount("unresolved_provider_call_count") : null;
  const attempted = actual !== null && unresolved !== null
    ? Math.max(actual + unresolved, evidence.minimumAttempt, previousCount("attempted_provider_call_count") ?? 0) : null;

  let invalid = false;
  const reservations = new Map<string, Record<string, unknown>>();
  for (const row of evidence.reservations) {
    const id = candidateText(row.reservation_id);
    if (!id || reservations.has(id) || candidateCount(row.used_microusd) === null || candidateCount(row.reserved_microusd) === null
      || !["active", "executing", "settled", "released"].includes(String(row.status))) { invalid = true; continue; }
    reservations.set(id, row);
  }
  const charges = new Map<string, number>();
  let explicitZero = false;
  for (const row of evidence.usage) {
    const cost = candidateCount(row.cost_microusd);
    const id = candidateText(row.cost_reservation_id);
    if (cost === null || !id) { invalid = true; continue; }
    charges.set(id, (charges.get(id) ?? 0) + cost);
    if (cost === 0) explicitZero = true;
  }
  for (const [id, row] of reservations) {
    if (row.status === "settled") { charges.set(id, Number(row.used_microusd)); explicitZero ||= row.used_microusd === 0; }
  }
  const amount = [...charges.values()].reduce((total, charge) => total + charge, 0);
  if (!Number.isSafeInteger(amount)) invalid = true;
  const held = [...reservations.values()].filter(row => row.status === "active" || row.status === "executing");
  const holdAmount = held.reduce((total, row) => total + Number(row.reserved_microusd), 0);
  const status = invalid || !reservations.size ? "unknown"
    : held.some(row => row.status === "executing") ? "executing" : held.length ? "active"
      : [...reservations.values()].some(row => row.status === "settled") ? "settled" : "released";
  const settled = !Number.isSafeInteger(amount) ? null : amount > 0 ? amount : explicitZero && !uncertain && !held.length ? 0 : null;
  const complete = settled !== null && !invalid && reservations.size > 0 && !held.length && !uncertain
    && unresolved === 0 && attempted !== null && !hasUnsettledProviderSubmission(checkpoint)
    && (hasCurrentCalls || preserved.some(value => value.settled_cost_complete === true));
  return {
    settled_cost_microusd: settled, settled_cost_complete: complete,
    reservation_microusd: status === "unknown" || !Number.isSafeInteger(holdAmount) ? null : holdAmount,
    reservation_status: status, actual_provider_call_count: actual, attempted_provider_call_count: attempted,
    unresolved_provider_call_count: unresolved, provider_submission_uncertain: uncertain,
  };
}

/** The stored provider verdict is independent of a future adapter's current reassessment. */
export function presentationCandidateOriginalValidation(checkpoint: Record<string, unknown>, locallyRecoverable: boolean) {
  const receipt = candidateRecord(checkpoint.generationReceipt), detail = candidateRecord(checkpoint.errorDetail);
  const codes = new Set(["source_fidelity_validation_failed", "provider_returned_incomplete_document_artifact"]);
  const rejected = receipt.failure_stage === "source_fidelity_validation" || codes.has(String(receipt.failure_code ?? ""))
    || codes.has(String(detail.code ?? "")) || Array.isArray(detail.validationIssues) && detail.validationIssues.length > 0;
  // The exact checkpoint candidate records the original source/shape assessment before local persistence.
  // An explicit original rejection always outranks that earlier positive flag.
  const accepted = locallyRecoverable;
  return { schema_version: 1 as const, adapter_version: candidateText(receipt.presentation_adapter_version),
    outcome: rejected ? "rejected" as const : accepted ? "accepted" as const : "unconfirmed" as const };
}

export type PresentationCandidateEdit = { path: string; value: string };
export type PresentationCandidateRevisionRequest = {
  revisionToken: string;
  idempotencyKey: string;
  confirmed: true;
  edits: PresentationCandidateEdit[];
};
export type PresentationCandidateRevisionResult = {
  jobId: string; documentId: string; responseId: string; artifactId: string;
  providerCalls: 0; incrementalCostMicrousd: 0; approval: "unapproved"; reused: boolean;
};

const revisionFieldPath = /^items\.(?:0|[1-9]\d*)\.(?:title|body|slide\.(?:kicker|bullets\.(?:0|[1-9]\d*)|visual\.(?:label|value|data\.(?:0|[1-9]\d*)\.(?:label|value))))$/u;
const revisionRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Catalog only existing visible string leaves. This is not the sanitized preview round-tripped as an artifact. */
export function presentationCandidateEditableFields(raw: string, privateReferences: readonly string[] = []): PresentationCandidateEdit[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const root = revisionRecord(parsed), fields: PresentationCandidateEdit[] = [];
  if (!root || !Array.isArray(root.items)) return fields;
  const add = (path: string, value: unknown) => {
    if (typeof value === "string" && value.length <= 8_000
      && sanitizePresentationCandidateText(value, privateReferences) === value) fields.push({ path, value });
  };
  root.items.forEach((value, index) => {
    const item = revisionRecord(value); if (!item) return;
    const prefix = `items.${index}`;
    add(`${prefix}.title`, item.title); add(`${prefix}.body`, item.body);
    const slide = revisionRecord(item.slide); if (!slide) return;
    add(`${prefix}.slide.kicker`, slide.kicker);
    if (Array.isArray(slide.bullets)) slide.bullets.forEach((bullet, i) => add(`${prefix}.slide.bullets.${i}`, bullet));
    const visual = revisionRecord(slide.visual); if (!visual) return;
    add(`${prefix}.slide.visual.label`, visual.label); add(`${prefix}.slide.visual.value`, visual.value);
    if (Array.isArray(visual.data)) visual.data.forEach((datum, i) => {
      const row = revisionRecord(datum); if (!row) return;
      add(`${prefix}.slide.visual.data.${i}.label`, row.label); add(`${prefix}.slide.visual.data.${i}.value`, row.value);
    });
  });
  return fields.length <= 512 ? fields : [];
}

/** Strict patches preserve source assignments, quotations, citation provenance, numeric precision and item/layout identity. */
export function applyPresentationCandidateEdits(raw: string, edits: unknown, privateReferences: readonly string[] = []): { raw: string; changedPaths: string[] } | null {
  if (!Array.isArray(edits) || edits.length > 128 || new TextEncoder().encode(JSON.stringify(edits)).byteLength > 64 * 1024) return null;
  const allowed = new Map(presentationCandidateEditableFields(raw, privateReferences).map(field => [field.path, field.value]));
  if (!allowed.size) return null;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  const seen = new Set<string>(), changedPaths: string[] = [];
  for (const edit of edits) {
    const entry = revisionRecord(edit);
    if (!entry || Object.keys(entry).some(key => key !== "path" && key !== "value")
      || typeof entry.path !== "string" || !revisionFieldPath.test(entry.path) || !allowed.has(entry.path) || seen.has(entry.path)
      || typeof entry.value !== "string" || entry.value.length > 8_000
      || sanitizePresentationCandidateText(entry.value, privateReferences) !== entry.value) return null;
    seen.add(entry.path);
    const parts = entry.path.split("."), key = parts.pop()!;
    let target: unknown = parsed;
    for (const part of parts) {
      if (!target || typeof target !== "object" || !Object.hasOwn(target, part)) return null;
      target = (target as Record<string, unknown>)[part];
    }
    if (!target || typeof target !== "object" || !Object.hasOwn(target, key) || typeof (target as Record<string, unknown>)[key] !== "string") return null;
    if (allowed.get(entry.path) !== entry.value) changedPaths.push(entry.path);
    (target as Record<string, unknown>)[key] = entry.value;
  }
  return { raw: JSON.stringify(parsed), changedPaths: changedPaths.sort() };
}

/** Markdown follows the resulting audience-facing slides, never stale rejected provider prose. */
export function presentationCandidateRevisionMarkdown(output: { title: string; items: DocumentArtifactDraftItem[] }): string {
  return [`# ${output.title}`, ...output.items.map((item, index) => {
    const slide = item.slide, visual = slide?.visual, quote = slide?.quote;
    return [
      `## ${index + 1}. ${item.title}`, ...(slide?.kicker ? [slide.kicker] : []), item.body,
      ...(quote?.text ? [`> ${quote.text} — ${[quote.speaker, quote.role].filter((value, i, all) => value && all.indexOf(value) === i).join(", ")}`] : []),
      ...(slide?.bullets ?? []).map(value => `- ${value}`),
      ...(visual?.value && visual.value !== quote?.text ? [visual.label ? `${visual.label}: ${visual.value}` : visual.value] : visual?.label ? [visual.label] : []),
      ...(visual?.exactValue ? [`Exact value: ${visual.exactValue}${visual.unit ? ` ${visual.unit}` : ""}`] : []),
      ...(visual?.displayValue ? [`Displayed value: ${visual.displayValue}${visual.unit ? ` ${visual.unit}` : ""}`] : []),
      ...(visual?.data ?? []).map(datum => `- ${datum.label}: ${datum.displayValue || datum.value}${datum.exactValue && datum.exactValue !== (datum.displayValue || datum.value) ? ` (exact: ${datum.exactValue})` : ""}`),
      ...(item.notes ? [item.notes] : []),
    ].filter(Boolean).join("\n");
  })].join("\n\n");
}
