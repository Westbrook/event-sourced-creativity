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
  settledCostMicrousd: number;
  complete: boolean;
  reviewOnlyReason?: "historical-validation-rejection";
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
