import type { DocumentArtifactDraftItem, SlideCitation, SlidePresentation } from "./document-artifacts.ts";
import { presentationAudienceCitations } from "./presentation-delivery.ts";

/** One trusted logical artboard for browser presentation, capture, and editable export. */
export const PRESENTATION_CANVAS_WIDTH = 960 as const;
export const PRESENTATION_CANVAS_HEIGHT = 540 as const;
export const PRESENTATION_LAYOUT_VERSION = 1 as const;
export const PRESENTATION_MIN_READABLE_WIDTH = 560 as const;
export const PRESENTATION_MIN_READABLE_HEIGHT = 315 as const;
/** Every protected visual surface is measured identically in live viewers and PDF exports. */
export const PRESENTATION_VISUAL_FIT_SELECTOR = [
  ".presentation-slide",
  ".presentation-slide-body",
  ".presentation-slide-body > section",
  ".presentation-slide-body > aside",
  ".presentation-slide__footnotes",
  ".presentation-slide__matrix",
  ".presentation-slide__table",
  ".presentation-visual-bars",
  ".presentation-visual-timeline",
  ".presentation-visual-diagram",
  ".presentation-visual-fields",
  ".presentation-slide__quote-card",
  ".presentation-slide__data-list",
  ".presentation-slide__scorecard-summary",
].join(",");

export const presentationRequiresReadingPosture = (width: number, height: number) =>
  width > 0 && height > 0 && (
    width < PRESENTATION_MIN_READABLE_WIDTH || height < PRESENTATION_MIN_READABLE_HEIGHT
  );

type PresentationEvidenceCitation = {
  sourceId?: string;
  label: string;
  anchor: string;
  excerpt: string;
};

/** Resolve every approved citation for an already-authorized source without exposing its ID. */
export const authorizedPresentationCitations = <Citation extends PresentationEvidenceCitation>(
  citations: readonly Citation[],
  authorizedReference: string,
  authorizedLabel: string,
): Citation[] => citations.filter((citation) =>
  citation.sourceId === authorizedReference || !citation.sourceId && citation.label === authorizedLabel,
);

export type PresentationLayoutDensity = "comfortable" | "compact" | "dense";
export type PresentationCitationPlacement = "inline" | "full-width";
export type PresentationLayoutOverflowReason =
  | "long-title"
  | "long-body"
  | "long-quotation"
  | "many-bullets"
  | "long-bullet"
  | "many-data-points"
  | "long-data-label"
  | "long-data-value"
  | "dense-narrative"
  | "dense-visual"
  | "many-citations"
  | "long-citation-excerpt"
  | "citation-excerpts";

export const PRESENTATION_LAYOUT_CAPACITIES = Object.freeze({
  titleCharacters: 84,
  bodyCharacters: 220,
  quoteCharacters: 360,
  bulletCount: 6,
  bulletCharacters: 110,
  dataPointCount: 8,
  dataLabelCharacters: 48,
  dataValueCharacters: 48,
  citationCount: 3,
  citationExcerptCharacters: 160,
  narrativeCharacters: 360,
  visualCharacters: 340,
  minimumBodyFontPx: 14,
  minimumLabelFontPx: 12,
});

/** Provider guidance protects complete provenance without treating it as audience delivery. */
export const PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS = [
  `Compose each visible slide for one ${PRESENTATION_CANVAS_WIDTH} × ${PRESENTATION_CANVAS_HEIGHT}px 16:9 artboard.`,
  `Aim for a title of at most ${PRESENTATION_LAYOUT_CAPACITIES.titleCharacters} characters,`,
  `a concise body of at most ${PRESENTATION_LAYOUT_CAPACITIES.bodyCharacters} characters,`,
  `at most ${PRESENTATION_LAYOUT_CAPACITIES.bulletCount} nonredundant bullets,`,
  `and visual labels of at most ${PRESENTATION_LAYOUT_CAPACITIES.dataLabelCharacters} characters when the source permits.`,
  `Reserve ${PRESENTATION_LAYOUT_CAPACITIES.minimumBodyFontPx}px body text and`,
  `${PRESENTATION_LAYOUT_CAPACITIES.minimumLabelFontPx}px source-label text without scrolling.`,
  "Budget only audience-facing title, body, bullets, chart labels and values, protected exact messages, and intentionally published source attribution together; avoid redundant editorial copy.",
  "Preserve all complete authorized citation excerpts in structured source provenance and authorized evidence inspection, but never place full source excerpts, internal source labels, slide-number anchors, or adapter instructions on the audience artboard.",
  "Show a concise public attribution only when required for licensing, published research, quotations, or compliance; producer metadata and duplicate source passages remain backstage.",
  "These are presentation targets, never permission to truncate or omit a protected quotation, attribution, source claim, exact value, chart row, authored slide, or source citation.",
  "When protected audience-facing evidence exceeds a target, preserve the complete delivery and use the semantic layout's dense posture; never emit HTML, CSS, JavaScript, iframes, or arbitrary layout coordinates.",
].join(" ");

export type PresentationLayoutPlan = {
  version: typeof PRESENTATION_LAYOUT_VERSION;
  canvas: {
    width: typeof PRESENTATION_CANVAS_WIDTH;
    height: typeof PRESENTATION_CANVAS_HEIGHT;
    aspectRatio: "16:9";
  };
  safeArea: { inline: number; block: number };
  capacities: typeof PRESENTATION_LAYOUT_CAPACITIES;
  density: PresentationLayoutDensity;
  citationPlacement: PresentationCitationPlacement;
  className: `presentation-slide--density-${PresentationLayoutDensity}`;
  /** The approved source is never mutated; its complete private evidence remains inspectable. */
  visibleItem: DocumentArtifactDraftItem;
  /** Only concise, intentionally public attributions belong on the audience artboard. */
  audienceCitations: SlideCitation[];
  overflow: {
    hasOverflow: boolean;
    readingModeRecommended: boolean;
    citationExcerpts: number;
    citationCharacters: number;
    narrativeCharacters: number;
    visualCharacters: number;
    bulletCount: number;
    dataPointCount: number;
    reasons: PresentationLayoutOverflowReason[];
  };
};

/**
 * Classify display density without accepting provider-authored CSS, markup, or coordinates.
 * Protected quotations, chart rows, precision, bullets, and source claims survive unchanged.
 * Complete authorized citation excerpts remain on the immutable canonical item, while
 * only compact audience-approved attribution contributes to visual layout density.
 */
export function planSlideLayout(
  item: DocumentArtifactDraftItem,
  presentation?: SlidePresentation | null,
): PresentationLayoutPlan {
  const slide = item.slide;
  const audienceCitations = presentationAudienceCitations(slide?.citations);
  const bullets = slide?.bullets ?? [];
  const data = slide?.visual.data ?? [];
  const reasons: PresentationLayoutOverflowReason[] = [];
  const citationExcerpts = audienceCitations.filter((citation) => citation.excerpt.trim()).length;
  const citationCharacters = audienceCitations.reduce((total, citation) =>
    total + citation.label.length + citation.anchor.length + citation.excerpt.length, 0);
  const narrativeCharacters = item.title.length + item.body.length
    + bullets.reduce((total, bullet) => total + bullet.length, 0)
    + (slide?.quote?.text.length ?? 0);
  const visualCharacters = (slide?.visual.label.length ?? 0) + (slide?.visual.value.length ?? 0)
    + data.reduce((total, datum) => total + datum.label.length
      + (datum.displayValue ?? datum.value).length + (datum.exactValue?.length ?? 0), 0);

  if (item.title.length > PRESENTATION_LAYOUT_CAPACITIES.titleCharacters) reasons.push("long-title");
  if (item.body.length > PRESENTATION_LAYOUT_CAPACITIES.bodyCharacters) reasons.push("long-body");
  if ((slide?.quote?.text.length ?? 0) > PRESENTATION_LAYOUT_CAPACITIES.quoteCharacters) reasons.push("long-quotation");
  if (bullets.length > PRESENTATION_LAYOUT_CAPACITIES.bulletCount) reasons.push("many-bullets");
  if (bullets.some((bullet) => bullet.length > PRESENTATION_LAYOUT_CAPACITIES.bulletCharacters)) reasons.push("long-bullet");
  if (data.length > PRESENTATION_LAYOUT_CAPACITIES.dataPointCount) reasons.push("many-data-points");
  if (data.some((datum) => datum.label.length > PRESENTATION_LAYOUT_CAPACITIES.dataLabelCharacters)) reasons.push("long-data-label");
  if (data.some((datum) => (datum.displayValue ?? datum.value).length > PRESENTATION_LAYOUT_CAPACITIES.dataValueCharacters)) reasons.push("long-data-value");
  if (narrativeCharacters > PRESENTATION_LAYOUT_CAPACITIES.narrativeCharacters) reasons.push("dense-narrative");
  if (visualCharacters > PRESENTATION_LAYOUT_CAPACITIES.visualCharacters) reasons.push("dense-visual");
  if (audienceCitations.length > PRESENTATION_LAYOUT_CAPACITIES.citationCount) reasons.push("many-citations");
  if (audienceCitations.some((citation) => citation.excerpt.length > PRESENTATION_LAYOUT_CAPACITIES.citationExcerptCharacters)) reasons.push("long-citation-excerpt");
  if (citationExcerpts) reasons.push("citation-excerpts");

  const visibleItem: DocumentArtifactDraftItem = item;
  const contentReasons = reasons.filter((reason) => reason !== "citation-excerpts");
  const citationPlacement: PresentationCitationPlacement = citationCharacters > PRESENTATION_LAYOUT_CAPACITIES.citationExcerptCharacters
    || citationCharacters > 0 && narrativeCharacters + citationCharacters > PRESENTATION_LAYOUT_CAPACITIES.narrativeCharacters
    ? "full-width"
    : "inline";
  const dense = contentReasons.length >= 2
    || narrativeCharacters > PRESENTATION_LAYOUT_CAPACITIES.narrativeCharacters
    || visualCharacters > PRESENTATION_LAYOUT_CAPACITIES.visualCharacters
    || bullets.some((bullet) => bullet.length > PRESENTATION_LAYOUT_CAPACITIES.bulletCharacters)
    || bullets.length > PRESENTATION_LAYOUT_CAPACITIES.bulletCount
    || data.length > PRESENTATION_LAYOUT_CAPACITIES.dataPointCount
    || (slide?.quote?.text.length ?? 0) > PRESENTATION_LAYOUT_CAPACITIES.quoteCharacters;
  const density: PresentationLayoutDensity = dense
    ? "dense"
    : contentReasons.length || bullets.length >= 4 || data.length >= 6 || audienceCitations.length >= 2
      ? "compact"
      : "comfortable";

  return {
    version: PRESENTATION_LAYOUT_VERSION,
    canvas: {
      width: PRESENTATION_CANVAS_WIDTH,
      height: PRESENTATION_CANVAS_HEIGHT,
      aspectRatio: "16:9",
    },
    safeArea: { inline: presentation?.stylePreset === "editorial" ? 48 : 40, block: 32 },
    capacities: PRESENTATION_LAYOUT_CAPACITIES,
    density,
    citationPlacement,
    className: `presentation-slide--density-${density}`,
    visibleItem,
    audienceCitations,
    overflow: {
      hasOverflow: reasons.length > 0,
      readingModeRecommended: dense || contentReasons.length > 0,
      citationExcerpts,
      citationCharacters,
      narrativeCharacters,
      visualCharacters,
      bulletCount: bullets.length,
      dataPointCount: data.length,
      reasons,
    },
  };
}
