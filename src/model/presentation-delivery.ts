import type { SlideCitation, SlideVisualData } from "./document-artifacts.ts";

/** Decisions supplied here must come from an authorized application surface. */
export type PresentationAudienceOptions = {
  authorizedPublicSourceIds?: ReadonlySet<string> | readonly string[];
  authorizedPrivateSourceIds?: ReadonlySet<string> | readonly string[];
  includePresenterNotes?: boolean;
  preserveSourceIds?: boolean;
};

type PresentationAudienceItemInput = {
  title: string;
  body: string;
  notes?: string;
  image_prompt?: string;
  imagePrompt?: string;
  context_group_ids?: string[];
  contextGroupIds?: string[];
  slide: SlideVisualData | null;
};

type PresentationAudienceArtifactInput = {
  items: readonly PresentationAudienceItemInput[];
};

const compact = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
const opaqueAlias = /(?:^|\s)(?:blk|clm|grp|context_group|decision|source|passage)_\d+(?:\s|$)/iu;
const opaqueAliasToken = /\b(?:blk|clm|grp|context_group|decision|source|passage)_\d+\b/giu;
const durableIdentifierToken = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu;
const structuralPosition = /^(?:(?:authored|source|context|presentation|deck|outline|original)\s+)?(?:slide|frame|scene|screen|step)\s*(?:#|no\.?\s*|number\s*)?\d+(?:\s*[-–—:]\s*.*)?$/iu;
const internalSource = /^(?:(?:an?|the)\s+)?(?:(?:internal|private|authored|authorized|approved|source|project|document|presentation|slide|context|creative|editorial|narrative|producer|production|adapter|generation|model|provider|message|direction|audience|format|exclusion)\s+)*(?:brief|source|sources|evidence|excerpt|outline|context|content|instructions?|directives?|notes?|prompt|prompts?|draft|artifact|document|presentation|deck|slide|copy|material|reference|references?|citation|citations?|strategy)(?:\s+\d+)?$/iu;
const explicitlyPrivateAttribution = /\b(?:private|internal|confidential|restricted|non[- ]?public|sensitive|secret|unpublished|embargo(?:ed)?|producer[- ]only|presenter[- ]only)\b/iu;
const externalAttribution = /(?:https?:\/\/|\bdoi\s*:|\b(?:research|study|studies|survey|surveys|benchmark|benchmarks|report|reports|journal|journals|university|universities|college|institute|foundation|association|society|agency|bureau|ministry|commission|council|court|tribunal|law|legal|regulation|regulatory|statute|directive|copyright|licensed?|licen[cs]ing|attribution|credit|photograph|photographer|interview|participant|stakeholder|analyst|publication|published|publisher|press|census|statistics|standard|standards|compliance|disclosure|filing|archive|museum|observatory)\b|[©®™])/iu;
const externalAnchor = /^(?:p(?:age)?s?\.?\s*\d|§\s*\d|art(?:icle)?\.?\s*\d|(?:fig(?:ure)?|table|appendix|exhibit|paragraph)\s*[a-z\d]|https?:\/\/|doi\s*:)/iu;
const publicAttribution = (value: unknown) => compact(compact(value).replace(opaqueAliasToken, "").replace(durableIdentifierToken, ""));

function hasSourceId(collection: ReadonlySet<string> | readonly string[] | undefined, sourceId: string) {
  if (!sourceId || !collection) return false;
  return collection instanceof Set ? collection.has(sourceId) : Array.from(collection).includes(sourceId);
}

function looksLikeNamedOrganization(value: string) {
  if (value.length < 5 || internalSource.test(value)) return false;
  const words = value.match(/\b(?:[A-Z][\p{L}\p{M}]+|[A-Z]{2,}(?:\.[A-Z]{1,})*)\b/gu) ?? [];
  return words.length >= 3 || words.length >= 2 && /\b(?:group|company|partners?|global|international|inc\.?|ltd\.?|corp\.?)\b/iu.test(value);
}

function audienceCitation(citation: SlideCitation, options: PresentationAudienceOptions): SlideCitation | null {
  const sourceId = compact(citation.sourceId);
  if (hasSourceId(options.authorizedPrivateSourceIds, sourceId)) return null;

  const trustedPublic = hasSourceId(options.authorizedPublicSourceIds, sourceId);
  const label = publicAttribution(citation.label);
  const anchor = publicAttribution(citation.anchor);

  if (!trustedPublic && (!label || structuralPosition.test(label) || opaqueAlias.test(label) || internalSource.test(label)
    || explicitlyPrivateAttribution.test(label) || explicitlyPrivateAttribution.test(anchor))) return null;
  if (!trustedPublic && !(externalAttribution.test(label) || externalAttribution.test(anchor) || externalAnchor.test(anchor) || looksLikeNamedOrganization(label))) return null;

  const safeLabel = label && !structuralPosition.test(label) && !opaqueAlias.test(label) && !internalSource.test(label) ? label : "";
  const safeAnchor = anchor && !structuralPosition.test(anchor) && !opaqueAlias.test(anchor) && !internalSource.test(anchor) ? anchor : "";
  if (!safeLabel && !safeAnchor) return null;

  return {
    ...(options.preserveSourceIds && sourceId ? { sourceId } : {}),
    label: safeLabel,
    anchor: safeAnchor && safeAnchor !== safeLabel ? safeAnchor : "",
    // Complete excerpts are private evidence, never audience delivery.
    excerpt: "",
  };
}

/** Project authorized public attribution without trusting provider visibility flags. */
export function presentationAudienceCitations(
  citations: readonly SlideCitation[] | null | undefined,
  options: PresentationAudienceOptions = {},
): SlideCitation[] {
  if (!citations?.length) return [];
  const seen = new Set<string>();
  return citations.flatMap((citation) => {
    const projected = audienceCitation(citation, options);
    if (!projected) return [];
    const identity = `${projected.label.toLocaleLowerCase()}\u0000${projected.anchor.toLocaleLowerCase()}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [projected];
  });
}

/** Create an immutable, recipient-safe slide without changing its canonical evidence. */
export function presentationAudienceItem<Item extends PresentationAudienceItemInput>(
  item: Item,
  options: PresentationAudienceOptions = {},
): Item {
  const projected = { ...item };
  if ("notes" in projected && !options.includePresenterNotes) projected.notes = "";
  if ("image_prompt" in projected) projected.image_prompt = "";
  if ("imagePrompt" in projected) projected.imagePrompt = "";
  if ("context_group_ids" in projected && !options.preserveSourceIds) projected.context_group_ids = [];
  if ("contextGroupIds" in projected && !options.preserveSourceIds) projected.contextGroupIds = [];

  if (!item.slide) return projected;

  const originalSlide = item.slide;
  const slide: SlideVisualData = {
    ...originalSlide,
    citations: presentationAudienceCitations(originalSlide.citations, options),
    ...(originalSlide.sourceIds && !options.preserveSourceIds ? { sourceIds: [] } : {}),
    visual: {
      ...originalSlide.visual,
      data: originalSlide.visual.data.map((datum) => ({
        ...datum,
        ...(datum.sourceIds && !options.preserveSourceIds ? { sourceIds: [] } : {}),
      })),
    },
  };

  if (originalSlide.quote) {
    const { sourceId, citation, ...quote } = originalSlide.quote;
    const publicCitation = citation
      ? presentationAudienceCitations([{ label: citation, anchor: "", excerpt: "", ...(sourceId ? { sourceId } : {}) }], options)[0]?.label
      : undefined;
    slide.quote = {
      ...quote,
      ...(options.preserveSourceIds && sourceId ? { sourceId } : {}),
      ...(publicCitation ? { citation: publicCitation } : {}),
    };
  }

  projected.slide = slide;
  return projected;
}

/** Exact-message guarantees inspect delivered copy, never attribution, notes, or evidence. */
export function presentationAudienceText(item: unknown): string {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const candidate = record(item);
  const slide = record(candidate.slide);
  const quote = record(slide.quote);
  const visual = record(slide.visual);
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const data = Array.isArray(visual.data) ? visual.data : [];

  return [
    candidate.title,
    candidate.body,
    slide.kicker,
    slide.section,
    ...bullets,
    quote.text,
    quote.speaker,
    quote.role,
    visual.label,
    visual.value,
    visual.exactValue ?? visual.exact_value,
    visual.displayValue ?? visual.display_value,
    visual.unit,
    ...data.flatMap((entry) => {
      const datum = record(entry);
      return [datum.label, datum.value, datum.exactValue ?? datum.exact_value, datum.displayValue ?? datum.display_value];
    }),
  ].map(compact).filter(Boolean).join("\n");
}

/** Produce a public artifact projection while leaving owner-visible evidence intact. */
export function presentationAudienceArtifact<Artifact extends PresentationAudienceArtifactInput>(
  artifact: Artifact,
  options: PresentationAudienceOptions = {},
): Artifact {
  return {
    ...artifact,
    items: artifact.items.map((item) => presentationAudienceItem(item, options)),
  } as Artifact;
}
