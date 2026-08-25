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
  requestedSlideCount: number;
  plannedSlideCount: number;
  providerBatchCount: number;
  providerCalls: number;
  settledCostMicrousd: number;
  complete: boolean;
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

export type PresentationCandidateDetail = PresentationCandidateSummary & {
  title: string;
  summary: string;
  presentation: SlidePresentation | null;
  slides: PresentationCandidateSlide[];
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
  missing_source_grounding: "A slide does not identify its required authorized source evidence.",
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
    const path = /^(?:\$|(?:items(?:\.\d+)?|presentation|content_markdown)(?:\.[a-z_]+|\.\d+)*)$/u.test(issue.path)
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
