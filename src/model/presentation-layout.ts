import type { DocumentArtifactDraftItem, SlidePresentation } from "./document-artifacts.ts";

/** One trusted logical artboard for browser presentation, capture, and editable export. */
export const PRESENTATION_CANVAS_WIDTH = 960 as const;
export const PRESENTATION_CANVAS_HEIGHT = 540 as const;
export const PRESENTATION_LAYOUT_VERSION = 1 as const;
export const PRESENTATION_MIN_READABLE_WIDTH = 560 as const;
export const PRESENTATION_MIN_READABLE_HEIGHT = 315 as const;

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
export type PresentationLayoutOverflowReason =
  | "long-title"
  | "long-body"
  | "long-quotation"
  | "many-bullets"
  | "long-bullet"
  | "many-data-points"
  | "long-data-label"
  | "many-citations"
  | "citation-excerpts";

export const PRESENTATION_LAYOUT_CAPACITIES = Object.freeze({
  titleCharacters: 84,
  bodyCharacters: 220,
  quoteCharacters: 360,
  bulletCount: 6,
  bulletCharacters: 110,
  dataPointCount: 8,
  dataLabelCharacters: 48,
  citationCount: 3,
  minimumBodyFontPx: 14,
  minimumLabelFontPx: 12,
});

/** Provider guidance is advisory: complete protected evidence always outranks copy budgets. */
export const PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS = [
  `Compose each visible slide for one ${PRESENTATION_CANVAS_WIDTH} × ${PRESENTATION_CANVAS_HEIGHT}px 16:9 artboard.`,
  `Aim for a title of at most ${PRESENTATION_LAYOUT_CAPACITIES.titleCharacters} characters,`,
  `a concise body of at most ${PRESENTATION_LAYOUT_CAPACITIES.bodyCharacters} characters,`,
  `at most ${PRESENTATION_LAYOUT_CAPACITIES.bulletCount} nonredundant bullets,`,
  `and visual labels of at most ${PRESENTATION_LAYOUT_CAPACITIES.dataLabelCharacters} characters when the source permits.`,
  `Reserve ${PRESENTATION_LAYOUT_CAPACITIES.minimumBodyFontPx}px body text and`,
  `${PRESENTATION_LAYOUT_CAPACITIES.minimumLabelFontPx}px source-label text without scrolling.`,
  "Keep citation labels and anchors concise while preserving every full authorized citation excerpt on the slide and in the complete semantic reading view.",
  "These are presentation targets, never permission to truncate or omit a protected quotation, attribution, source claim, exact value, chart row, authored slide, or source citation.",
  "When protected evidence exceeds a target, preserve the complete evidence and use the semantic layout's dense posture; never emit HTML, CSS, JavaScript, iframes, or arbitrary layout coordinates.",
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
  className: `presentation-slide--density-${PresentationLayoutDensity}`;
  /** The approved source is never mutated and no protected evidence is projected away. */
  visibleItem: DocumentArtifactDraftItem;
  overflow: {
    hasOverflow: boolean;
    readingModeRecommended: boolean;
    citationExcerpts: number;
    bulletCount: number;
    dataPointCount: number;
    reasons: PresentationLayoutOverflowReason[];
  };
};

/**
 * Classify display density without accepting provider-authored CSS, markup, or coordinates.
 * Protected quotations, chart rows, precision, bullets, identifiers, and source claims
 * always survive unchanged, including complete authorized citation excerpts on both
 * the composed slide and its complete semantic reading alternative.
 */
export function planSlideLayout(
  item: DocumentArtifactDraftItem,
  presentation?: SlidePresentation | null,
): PresentationLayoutPlan {
  const slide = item.slide;
  const citations = slide?.citations ?? [];
  const bullets = slide?.bullets ?? [];
  const data = slide?.visual.data ?? [];
  const reasons: PresentationLayoutOverflowReason[] = [];
  const citationExcerpts = citations.filter((citation) => citation.excerpt.trim()).length;

  if (item.title.length > PRESENTATION_LAYOUT_CAPACITIES.titleCharacters) reasons.push("long-title");
  if (item.body.length > PRESENTATION_LAYOUT_CAPACITIES.bodyCharacters) reasons.push("long-body");
  if ((slide?.quote?.text.length ?? 0) > PRESENTATION_LAYOUT_CAPACITIES.quoteCharacters) reasons.push("long-quotation");
  if (bullets.length > PRESENTATION_LAYOUT_CAPACITIES.bulletCount) reasons.push("many-bullets");
  if (bullets.some((bullet) => bullet.length > PRESENTATION_LAYOUT_CAPACITIES.bulletCharacters)) reasons.push("long-bullet");
  if (data.length > PRESENTATION_LAYOUT_CAPACITIES.dataPointCount) reasons.push("many-data-points");
  if (data.some((datum) => datum.label.length > PRESENTATION_LAYOUT_CAPACITIES.dataLabelCharacters)) reasons.push("long-data-label");
  if (citations.length > PRESENTATION_LAYOUT_CAPACITIES.citationCount) reasons.push("many-citations");
  if (citationExcerpts) reasons.push("citation-excerpts");

  const visibleItem: DocumentArtifactDraftItem = item;
  const contentReasons = reasons.filter((reason) => reason !== "citation-excerpts");
  const dense = contentReasons.length >= 2
    || bullets.length > PRESENTATION_LAYOUT_CAPACITIES.bulletCount
    || data.length > PRESENTATION_LAYOUT_CAPACITIES.dataPointCount
    || (slide?.quote?.text.length ?? 0) > PRESENTATION_LAYOUT_CAPACITIES.quoteCharacters;
  const density: PresentationLayoutDensity = dense
    ? "dense"
    : contentReasons.length || bullets.length >= 4 || data.length >= 6 || citations.length >= 2
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
    className: `presentation-slide--density-${density}`,
    visibleItem,
    overflow: {
      hasOverflow: reasons.length > 0,
      readingModeRecommended: dense || contentReasons.length > 0,
      citationExcerpts,
      bulletCount: bullets.length,
      dataPointCount: data.length,
      reasons,
    },
  };
}
