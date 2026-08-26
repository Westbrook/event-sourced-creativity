/**
 * A local, privacy-preserving source contract for authored presentations.
 * Durable block/group identifiers are deliberately retained only in the local
 * contract; `providerFacingPresentationSourceContract` exposes opaque aliases.
 */

import { combinedContextGroups } from "./combined-context.ts";
import { presentationAudienceText } from "./presentation-delivery.ts";

export type PresentationSourceInput = string | readonly unknown[] | Record<string, unknown>;

export type PresentationSourceAlias = {
  alias: string;
  sourceId: string;
  sourceKind: "block" | "claim" | "context-group";
  blockId?: string;
  contextGroupIds: string[];
  label: string;
};

export type PresentationSourceSlide = {
  number: number;
  order: number;
  index: number;
  title: string;
  content: string;
  text: string;
  sourceBlockId: string | null;
  sourceAlias: string | null;
  contextGroupIds: string[];
  section: string | null;
};

export type PresentationSourceSection = {
  title: string;
  slideNumbers: number[];
  sourceBlockIds: string[];
};

export type PresentationSourceOutline = {
  authoredSlideCount: number | null;
  slides: PresentationSourceSlide[];
  sections: PresentationSourceSection[];
  sourceText: string;
};

export type ProtectedPresentationFact = {
  id: string;
  label: string;
  value: string;
  exactValue?: string;
  displayValue?: string;
  precision: "exact" | "display" | "source";
  unit: string;
  sourceBlockId: string | null;
  sourceAlias: string | null;
  slideNumber: number | null;
};

export type ProtectedPresentationQuote = {
  id: string;
  text: string;
  speaker: string;
  role: string;
  sourceBlockId: string | null;
  sourceAlias: string | null;
  slideNumber: number | null;
};

export type ProtectedPresentationMessagePlacement = "opening" | "closing" | "authored";

export type ProtectedPresentationMessage = {
  id: string;
  text: string;
  placement: ProtectedPresentationMessagePlacement;
  sourceBlockId: string | null;
  sourceAlias: string | null;
  slideNumber: number;
};

export type ProtectedPresentationTerminology = {
  label: string;
  terms: string[];
  sourceBlockId: string | null;
  sourceAlias: string | null;
};

export type ProtectedPresentationRoadmap = {
  label: string;
  value: string;
  minimumWeeks: number;
  maximumWeeks: number;
  sourceBlockId: string | null;
  sourceAlias: string | null;
  slideNumber: number | null;
};

export type PresentationStyleContract = {
  preset: "gallery" | "editorial" | "nocturne" | "field-notes" | null;
  mode: "light" | "dark" | null;
  typography: string | null;
  palette: string[];
  direction: string | null;
  authored: boolean;
};

export type PresentationSourceOptions = {
  requestedSlideCount?: number;
  itemCount?: number;
  contextGroups?: readonly unknown[];
  sourceAliases?: readonly PresentationSourceAlias[];
  stylePreset?: string;
  presentationStyle?: string;
  fidelity?: "faithful" | "creative";
};

export type PresentationSourceContract = {
  schemaVersion: 1;
  outline: PresentationSourceOutline;
  numberedOutline: PresentationSourceSlide[];
  authoredSlideCount: number | null;
  requestedSlideCount: number | null;
  predictedSlideCount: number | null;
  slideCountMismatch: boolean;
  protectedFacts: ProtectedPresentationFact[];
  protectedQuotes: ProtectedPresentationQuote[];
  protectedMessages: ProtectedPresentationMessage[];
  protectedTerminology: ProtectedPresentationTerminology[];
  roadmaps: ProtectedPresentationRoadmap[];
  style: PresentationStyleContract;
  sources: PresentationSourceAlias[];
  fidelity: "faithful" | "creative";
};

export type PresentationSourceResolution = {
  sourceIds: string[];
  blockIds: string[];
  contextGroupIds: string[];
  sourceAliases: string[];
  unknownReferences: string[];
  valid: boolean;
};

export type PresentationSourceCoverageIssue = {
  code: string;
  path: string;
  message: string;
};

export type PresentationSourceCoverageOptions = {
  pageStart?: number;
  pageSize?: number;
  requireEverySlideSource?: boolean;
  requireAllProtectedContent?: boolean;
};

export type PresentationSourceResolutionOptions = {
  /** Only trusted, already-canonicalized application output may enable this. */
  allowDurableIds?: boolean;
};

type AuthoredProtectedMessage = {
  text: string;
  placements: ProtectedPresentationMessagePlacement[];
};

type SourceBlock = {
  id: string | null;
  text: string;
  label: string;
  contextGroupIds: string[];
  protectedMessages: AuthoredProtectedMessage[];
};

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const compact = (value: unknown) => clean(value).replace(/\s+/gu, " ");
const unique = (values: Iterable<string>) => [...new Set([...values].map(clean).filter(Boolean))];
const sourceKey = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
const citationEvidenceKey = (value: string) => value.normalize("NFKC").toLocaleLowerCase()
  .replace(/(?<![\p{L}\p{N}])[−-](?=\d)/gu," negativesign ")
  .replace(/(?<![\p{L}\p{N}])\+(?=\d)/gu," positivesign ")
  .replace(/(?<=\d)\.(?=\d)/gu, " decimaldot ")
  .replace(/(?<=\d),(?=\d)/gu, " decimalcomma ")
  .replace(/%/gu, " percentunit ")
  .replace(/[\p{P}\p{S}]+/gu, " ")
  .replace(/\s+/gu, " ").trim();
const stylePresets = new Set(["gallery", "editorial", "nocturne", "field-notes"]);
const negativeSourceIntents = new Set(["avoid", "prohibit", "exclude", "must_not_include", "exclusion", "forbid"]);
const englishAudienceWords = new Set(["the", "and", "with", "for", "from", "that", "this", "these", "each", "every", "your", "their", "are", "is", "of", "to", "in", "on", "user", "project", "product", "slide", "slides", "weeks"]);
const frenchAudienceWords = new Set(["le", "la", "les", "un", "une", "des", "du", "de", "dans", "avec", "pour", "sur", "est", "sont", "et", "vous", "votre", "nous", "notre", "cette", "ces", "plus", "projet", "présentation", "équipe", "semaine", "semaines"]);

/** Keep presentation audience language separate from the application's chrome. */
export function inferPresentationAudienceLocale(source: string, fallback = "en", requested?: string): string {
  const supported = (value: string) => {
    try {
      const locale = Intl.getCanonicalLocales(value || "en")[0] ?? "en";
      return /^(?:en|fr|ar|ja)(?:-|$)/iu.test(locale) ? locale : "en";
    } catch { return "en"; }
  };
  if (requested?.trim()) return supported(requested);
  const content = clean(source);
  if (!content) return supported(fallback);
  const arabic = (content.match(/\p{Script=Arabic}/gu) ?? []).length;
  const japanese = (content.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? []).length;
  const latin = (content.match(/\p{Script=Latin}/gu) ?? []).length;
  if (arabic >= 4 && arabic > Math.max(japanese, latin / 3)) return "ar";
  if (japanese >= 4 && japanese > Math.max(arabic, latin / 3)) return "ja";
  const words = content.toLocaleLowerCase().match(/[\p{Script=Latin}]+/gu) ?? [];
  const english = words.reduce((score, word) => score + Number(englishAudienceWords.has(word)), 0);
  const french = words.reduce((score, word) => score + Number(frenchAudienceWords.has(word)), 0) + (content.match(/[àâçéèêëîïôûùüÿœæ]/giu) ?? []).length;
  if (french >= 2 && french > english) return "fr";
  if (english >= 2 && english >= french) return "en";
  return latin >= 12 && !/^(?:en|fr)(?:-|$)/iu.test(fallback) ? "en" : supported(fallback);
}

function sourceBlockText(value: Record<string, unknown>) {
  const properties = asRecord(value.properties);
  const nested = asRecord(properties.content);
  const candidates = [
    properties.text, properties.instruction, properties.description, properties.exact_text,
    properties.markdown, properties.body, typeof properties.content === "string" ? properties.content : "",
    nested.text, nested.markdown, value.text, value.instruction, value.description,
    value.body, value.markdown, typeof value.content === "string" ? value.content : "",
  ].map(clean).filter(Boolean);
  if (!candidates.length && typeof properties.value === "string") candidates.push(clean(properties.value));
  const selected: string[] = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => existing === candidate || existing.includes(candidate))) continue;
    const contained = selected.findIndex((existing) => candidate.includes(existing));
    if (contained >= 0) selected.splice(contained, 1, candidate);
    else selected.push(candidate);
  }
  return selected.join("\n").replace(/\r\n?/gu, "\n");
}

function blockGroups(value: Record<string, unknown>) {
  const properties = asRecord(value.properties);
  const memberships = Array.isArray(properties.combined_context_memberships)
    ? properties.combined_context_memberships
    : properties.combined_context ? [properties.combined_context] : [];
  return unique([
    ...(Array.isArray(properties.context_group_ids) ? properties.context_group_ids : []),
    ...(Array.isArray(value.contextGroupIds) ? value.contextGroupIds : []),
    ...(Array.isArray(value.context_group_ids) ? value.context_group_ids : []),
    ...memberships.map((membership) => {
      const member = asRecord(membership);
      return clean(member.context_set_id ?? member.contextSetId);
    }),
    ...(clean(properties.context_set_id) ? [clean(properties.context_set_id)] : []),
  ].map(clean));
}

function sourceBlocks(input: PresentationSourceInput): SourceBlock[] {
  if (typeof input === "string") return input.trim() ? [{ id: null, text: input.replace(/\r\n?/gu, "\n"), label: "Authored source", contextGroupIds: [], protectedMessages: [] }] : [];
  const root = Array.isArray(input) ? {} : asRecord(input);
  const authoritativeGroups = new Map<string, string[]>();
  if (!Array.isArray(input) && Array.isArray(root.facts)) {
    for (const group of combinedContextGroups(root)) for (const member of group.members) {
      authoritativeGroups.set(member.blockId, [...(authoritativeGroups.get(member.blockId) ?? []), group.id]);
    }
  }
  const values = Array.isArray(input) ? input
    : Array.isArray(root.facts) ? root.facts
      : Array.isArray(root.blocks) ? root.blocks
        : Array.isArray(root.claims) ? root.claims
          : root.snapshot && typeof root.snapshot === "object" ? sourceBlocks(asRecord(root.snapshot))
            : [root];
  return values.flatMap((candidate, index): SourceBlock[] => {
    const block = asRecord(candidate);
    const properties = asRecord(block.properties);
    if (block.removed === true || block.deleted === true || block.active === false || properties.active === false || properties.weight !== undefined && !(Number(properties.weight) > 0) || clean(block.status).toLowerCase() === "inactive") return [];
    if ([block.intent, block.effect, block.polarity, block.type, block.role, properties.intent, properties.effect, properties.polarity, properties.type, properties.role]
      .some((value) => negativeSourceIntents.has(clean(value).toLowerCase()))) return [];
    const text = sourceBlockText(block);
    if (!text) return [];
    const id = clean(block.block_id ?? block.blockId ?? block.id ?? properties.block_id) || null;
    const label = compact(properties.label ?? block.label ?? block.handle ?? block.type ?? block.role) || `Authored source ${index + 1}`;
    const exactPlacements = (Array.isArray(properties.exact_placements) ? properties.exact_placements : [])
      .flatMap((placement): ProtectedPresentationMessagePlacement[] => placement === "opening" || placement === "closing" || placement === "authored" ? [placement] : []);
    const exactText = clean(properties.exact_text ?? properties.protected_phrase);
    const protectedMessages: AuthoredProtectedMessage[] = [
      ...(exactText ? [{ text: exactText, placements: exactPlacements }] : []),
      ...(Array.isArray(properties.protected_phrases) ? properties.protected_phrases : []).flatMap((candidate): AuthoredProtectedMessage[] => {
        const phrase = asRecord(candidate);
        const value = clean(phrase.text);
        if (!value) return [];
        const placement = clean(phrase.placement);
        const placements: ProtectedPresentationMessagePlacement[] = placement === "opening_and_closing" ? ["opening", "closing"]
          : placement === "opening" || placement === "closing" || placement === "authored" ? [placement] : exactPlacements;
        return [{ text: value, placements }];
      }),
    ];
    return [{ id, text, label, contextGroupIds: unique([...blockGroups(block), ...(id ? authoritativeGroups.get(id) ?? [] : [])]), protectedMessages }];
  });
}

function sectionBefore(text: string, offset: number, fallback: string | null) {
  const before = text.slice(0, offset);
  const heading = [...before.matchAll(/(?:^|\n)\s{0,3}#{1,6}\s+([^\n]+)/gu)].at(-1)?.[1];
  if (heading && !/^slide\s+\d/iu.test(heading.trim())) return compact(heading.replace(/[*_`]/gu, ""));
  const section = [...before.matchAll(/\b(?:SLIDESHOW\s+[\p{L}\d]+\s*[—–:-]\s*|(?:SECTION|CHAPTER|PART)\s+[\p{L}\d]+\s*[—–:-]\s*)([^\n.]{3,180}?)(?:\s*,?\s*SLIDES\s+\d+\s*[—–-]\s*\d+)?(?=\.|\n|$)/giu)].at(-1)?.[1];
  const chapter = [...before.matchAll(/(?:^|\n|\.\s+)([\p{Lu}\d][\p{Lu}\d\s/&,'’()-]{2,120}?)\s*[—–-]\s*SLIDES\s+\d+\s*[—–-]\s*\d+(?=\.|\n|$)/gu)].at(-1)?.[1];
  return section ? compact(section.replace(/\s*,?\s*SLIDES\s+\d+\s*[—–-]\s*\d+\s*$/iu, "")) : chapter ? compact(chapter) : fallback;
}

function headingTitle(content: string) {
  const firstLine = content.split("\n", 1)[0]?.trim() ?? "";
  const sentenceBoundary = firstLine.search(/[.!?](?=\s+[\p{Lu}“"([])/u);
  const colon = firstLine.indexOf(":");
  if (colon >= 2 && colon <= 130 && (sentenceBoundary < 0 || colon < sentenceBoundary)) {
    const title = compact(firstLine.slice(0, colon).replace(/^\*{1,2}|\*{1,2}$/gu, ""));
    // An uppercase authored heading followed by a colon introduces slide prose.
    // Mixed-case headings such as “Opportunity: trustworthy production” retain
    // their substantive colon; prose after an earlier sentence is never a title.
    if (title && /\p{Lu}/u.test(title) && !/\p{Ll}/u.test(title)) return title;
  }
  if (content.includes("\n")) {
    const heading = compact(firstLine.replace(/^\*{1,2}|\*{1,2}$/gu, ""));
    const followingSentence = sentenceBoundary >= 0 ? firstLine.slice(sentenceBoundary + 1).trim() : "";
    const inlineBody = /^(?:this|these|those|it|they|we|our|evidence|speaker\s+notes?|source\s+notes?|supporting\s+evidence)\b/iu.test(followingSentence);
    // A physical line break explicitly separates the authored heading from its
    // body. Preserve deliberate multi-sentence taglines and final punctuation;
    // prose attached to an inline heading retains the historical title split.
    if (heading && heading.length <= 180 && !inlineBody) return heading;
  }
  const sentence = sentenceBoundary >= 0 ? firstLine.slice(0, sentenceBoundary)
    : firstLine.replace(/[.!?]+$/u, "");
  return compact(sentence.replace(/^\*{1,2}|\*{1,2}$/gu, "")).slice(0, 180);
}

type HeadingMatch = { offset: number; end: number; number: number };

function headingMatches(text: string) {
  const explicit: HeadingMatch[] = [];
  const headings = /\bslide\s*#?\s*(\d{1,3})(?:\s+of\s+\d{1,3})?\s*(?:[—–:.-]\s*|(?=\n))/giu;
  for (const match of text.matchAll(headings)) {
    const number = Number(match[1]);
    if (number > 0) explicit.push({ offset: match.index, end: match.index + match[0].length, number });
  }
  if (explicit.length) return explicit;
  const numbered = [...text.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?(\d{1,3})[.)]\s+([^\n]+)/gu)]
    .map((match) => ({ offset: match.index + (match[0].startsWith("\n") ? 1 : 0), end: match.index + match[0].indexOf(match[2]!), number: Number(match[1]) }))
    .filter((match) => match.number > 0);
  return numbered.length >= 2 && /\b(?:slide(?:show)?|presentation|deck|slide-by-slide)\b/iu.test(text) ? numbered : [];
}

export function inferPresentationSourceOutline(input: PresentationSourceInput): PresentationSourceOutline {
  const blocks = sourceBlocks(input);
  const slides: PresentationSourceSlide[] = [];
  const seen = new Set<number>();
  for (const block of blocks) {
    const matches = headingMatches(block.text);
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]!;
      if (seen.has(match.number)) continue;
      const content = block.text.slice(match.end, matches[index + 1]?.offset ?? block.text.length).trim().replace(/[\s.]+$/u, (ending) => ending.includes(".") ? "." : "");
      const title = headingTitle(content) || `Slide ${match.number}`;
      const section = sectionBefore(block.text, match.offset, null);
      slides.push({ number: match.number, order: match.number, index: slides.length, title, content, text: content, sourceBlockId: block.id, sourceAlias: null, contextGroupIds: [...block.contextGroupIds], section });
      seen.add(match.number);
    }
  }
  slides.sort((left, right) => left.number - right.number || left.index - right.index);
  slides.forEach((slide, index) => { slide.index = index; slide.order = index + 1; });
  const sections: PresentationSourceSection[] = [];
  for (const slide of slides) {
    if (!slide.section) continue;
    const previous = sections.at(-1);
    if (previous && previous.title === slide.section) {
      previous.slideNumbers.push(slide.number);
      if (slide.sourceBlockId && !previous.sourceBlockIds.includes(slide.sourceBlockId)) previous.sourceBlockIds.push(slide.sourceBlockId);
    } else sections.push({ title: slide.section, slideNumbers: [slide.number], sourceBlockIds: slide.sourceBlockId ? [slide.sourceBlockId] : [] });
  }
  return { authoredSlideCount: slides.length || null, slides, sections, sourceText: blocks.map((block) => block.text).join("\n\n") };
}

function preset(value: unknown): PresentationStyleContract["preset"] {
  const normalized = clean(value).toLowerCase().replace(/[_ ]+/gu, "-");
  return stylePresets.has(normalized) ? normalized as NonNullable<PresentationStyleContract["preset"]> : null;
}

export function inferPresentationStyleContract(input: PresentationSourceInput, options: Pick<PresentationSourceOptions, "stylePreset" | "presentationStyle"> = {}): PresentationStyleContract {
  const text = typeof input === "string" ? input : inferPresentationSourceOutline(input).sourceText;
  const root = typeof input === "string" || Array.isArray(input) ? {} : asRecord(input);
  const constraints = (Array.isArray(root.standing_constraints) ? root.standing_constraints : []).map(asRecord)
    .filter((constraint) => !clean(constraint.authority) || clean(constraint.authority).toLowerCase() === "authored")
    .filter((constraint) => !/^(?:avoid|prohibit|exclude|negative|forbid)$/iu.test(clean(constraint.polarity ?? constraint.intent)));
  const palettePreference = constraints.find((constraint) => /^(?:palette|color|colour|style|brand|visual_system)$/iu.test(clean(constraint.axis)));
  const explicit = preset(options.stylePreset ?? options.presentationStyle);
  const requested = text.match(/\b(?:style|theme|treatment|preset)\s*[:=]\s*["“]?\s*(gallery|editorial|nocturne|field[ -]notes)\b/iu)?.[1];
  const inferred = explicit ?? preset(requested);
  const typography = text.match(/\b(?:typography|typeface|font(?: family)?)\s*[:=]\s*([^\n,.;]{2,70})/iu)?.[1]?.trim() ?? null;
  const palette = unique([...text.matchAll(/#[\da-f]{6}\b/giu)].map((match) => match[0].toLowerCase()));
  const direction = text.match(/\b(?:brand|art|visual|creative|design|style)\s+(?:direction|system|treatment)\s*[:=]\s*([^\n.]{5,220})/iu)?.[1]?.trim()
    ?? (palettePreference ? `${clean(palettePreference.axis)}: ${clean(palettePreference.value)}` : null);
  const mode = inferred === "nocturne" ? "dark" : inferred ? "light" : /\b(?:dark|nocturne)\s+(?:theme|mode|treatment)\b/iu.test(text) ? "dark" : /\b(?:light|white)\s+(?:theme|mode|treatment)\b/iu.test(text) ? "light" : null;
  return { preset: inferred, mode, typography, palette, direction, authored: Boolean(requested || typography || palette.length || direction || mode && !explicit) };
}

function buildSourceAliases(input: PresentationSourceInput, options: PresentationSourceOptions, blocks: SourceBlock[]) {
  const result: PresentationSourceAlias[] = [];
  const seen = new Set<string>();
  const usedAliases = new Set<string>();
  const authorizedBlocks = new Set(blocks.flatMap((block) => block.id ? [block.id] : []));
  const authorizedGroups = new Set(blocks.flatMap((block) => block.contextGroupIds));
  const root = typeof input === "string" || Array.isArray(input) ? {} : asRecord(input);
  const rootClaims = Array.isArray(root.claims) ? root.claims.map(asRecord) : [];
  const authorizedClaims = new Map(rootClaims.flatMap((claim): Array<[string, string]> => {
    const claimId = clean(claim.id ?? claim.claim_id);
    const blockId = clean(claim.blockId ?? claim.block_id);
    return claimId && authorizedBlocks.has(blockId) ? [[claimId, blockId]] : [];
  }));
  const groupDetails = new Map<string, { label: string }>();
  const authoritativeFacts = Array.isArray(input) ? input : Array.isArray(root.facts) ? root.facts : Array.isArray(root.blocks) ? root.blocks : [];
  for (const candidate of authoritativeFacts) {
    const fact = asRecord(candidate);
    const blockId = clean(fact.block_id ?? fact.blockId ?? fact.id ?? asRecord(fact.properties).block_id);
    if (!authorizedBlocks.has(blockId)) continue;
    const properties = asRecord(fact.properties);
    const memberships = Array.isArray(properties.combined_context_memberships)
      ? properties.combined_context_memberships
      : properties.combined_context ? [properties.combined_context] : [];
    for (const membership of memberships) {
      const group = asRecord(membership);
      const id = clean(group.context_set_id ?? group.contextSetId ?? group.id);
      if (authorizedGroups.has(id)) groupDetails.set(id, { label: compact(group.name ?? group.label ?? group.target) || "Authorized context group" });
    }
  }
  for (const candidate of [...(Array.isArray(root.context_groups) ? root.context_groups : []), ...(Array.isArray(root.contextGroups) ? root.contextGroups : [])]) {
    const group = asRecord(candidate);
    const id = clean(group.id ?? group.context_set_id ?? group.contextSetId);
    if (authorizedGroups.has(id) && !groupDetails.has(id)) groupDetails.set(id, { label: compact(group.name ?? group.label ?? group.target) || "Authorized context group" });
  }
  const append = (entry: PresentationSourceAlias) => {
    const alias = clean(entry.alias);
    const sourceId = clean(entry.sourceId);
    const key = `${entry.sourceKind}\u0000${sourceId}`;
    const expectedPrefix = entry.sourceKind === "block" ? "blk" : entry.sourceKind === "context-group" ? "grp" : entry.sourceKind === "claim" ? "clm" : "";
    const authorized = entry.sourceKind === "block" ? authorizedBlocks.has(sourceId) && (!entry.blockId || entry.blockId === sourceId)
      : entry.sourceKind === "context-group" ? authorizedGroups.has(sourceId)
        : entry.sourceKind === "claim" ? authorizedClaims.get(sourceId) === clean(entry.blockId)
          : false;
    if (!authorized || !new RegExp(`^${expectedPrefix}_\\d{3,}$`, "u").test(alias) || seen.has(key) || usedAliases.has(alias)) return;
    seen.add(key);
    usedAliases.add(alias);
    const trustedLabel = entry.sourceKind === "block" ? blocks.find((block) => block.id === sourceId)?.label
      : entry.sourceKind === "context-group" ? groupDetails.get(sourceId)?.label
        : rootClaims.find((claim) => clean(claim.id ?? claim.claim_id) === sourceId && authorizedClaims.get(sourceId) === clean(claim.blockId ?? claim.block_id))?.label;
    result.push({ ...entry, alias, sourceId, blockId: clean(entry.blockId) || undefined, contextGroupIds: unique(entry.contextGroupIds ?? []).filter((id) => authorizedGroups.has(id)), label: compact(trustedLabel) || (entry.sourceKind === "context-group" ? "Authorized context group" : entry.sourceKind === "claim" ? "Authored claim" : "Authored source") });
  };
  for (const entry of options.sourceAliases ?? []) append(entry);
  let blockIndex = result.filter((entry) => entry.sourceKind === "block").length;
  for (const block of blocks) if (block.id && !seen.has(`block\u0000${block.id}`)) {
    do { blockIndex += 1; } while (usedAliases.has(`blk_${String(blockIndex).padStart(3, "0")}`));
    append({ alias: `blk_${String(blockIndex).padStart(3, "0")}`, sourceId: block.id, sourceKind: "block", blockId: block.id, contextGroupIds: [...block.contextGroupIds], label: block.label });
  }
  let groupIndex = result.filter((entry) => entry.sourceKind === "context-group").length;
  for (const groupId of authorizedGroups) if (!seen.has(`context-group\u0000${groupId}`)) {
    do { groupIndex += 1; } while (usedAliases.has(`grp_${String(groupIndex).padStart(3, "0")}`));
    append({ alias: `grp_${String(groupIndex).padStart(3, "0")}`, sourceId: groupId, sourceKind: "context-group", contextGroupIds: [groupId], label: groupDetails.get(groupId)?.label ?? "Authorized context group" });
  }
  let claimIndex = result.filter((entry) => entry.sourceKind === "claim").length;
  for (const claim of rootClaims) {
    const id = clean(claim.id ?? claim.claim_id);
    if (!authorizedClaims.has(id) || seen.has(`claim\u0000${id}`)) continue;
    do { claimIndex += 1; } while (usedAliases.has(`clm_${String(claimIndex).padStart(3, "0")}`));
    append({ alias: `clm_${String(claimIndex).padStart(3, "0")}`, sourceId: id, sourceKind: "claim", blockId: clean(claim.blockId ?? claim.block_id) || undefined, contextGroupIds: blockGroups(claim), label: compact(claim.label ?? claim.type ?? claim.text) || "Authored claim" });
  }
  return result;
}

const scoreLabels: Array<{ label: string; pattern: RegExp }> = [
  { label: "Phone", pattern: /\b(?:smart\s*)?phone\b/iu },
  { label: "Tablet", pattern: /\btablet\b/iu },
  { label: "Small monitor", pattern: /\bsmall\s+(?:monitor|display|screen)\b/iu },
  { label: "Large monitor", pattern: /\blarge\s+(?:monitor|display|screen)\b/iu },
  { label: "Adaptive/accessibility", pattern: /\badaptive\s*(?:\/|and\s+)?\s*accessibility\b|\baccessibility\s*\/\s*design.system\b/iu },
  { label: "Governed creative loop", pattern: /\bgoverned\s+(?:creative\s+)?(?:loop|review|creation)\b|\bdurable\s+context\b|\bcreative\s+loop\b/iu },
];

function scoreRow(text: string, label: { label: string; pattern: RegExp }): string | null {
  for (const line of text.split("\n")) {
    if (!label.pattern.test(line)) continue;
    if (line.includes("|")) {
      const cells = line.split("|").map((cell) => cell.replace(/\*\*/gu, "").trim()).filter(Boolean);
      if (cells.length >= 2 && label.pattern.test(cells[0] ?? "")) {
        const trailing = cells.at(-1)?.match(/^(-?\d+(?:\.\d+)?)\s*(?:\/\s*100|%)?$/u)?.[1];
        if (trailing && trailing.includes(".")) return trailing;
      }
    }
    const match = line.match(new RegExp(`(?:${label.pattern.source})[^\\n;,|]{0,140}?\\b(\\d{1,3}\\.\\d{2,6})\\b`, "iu"));
    if (match?.[1]) return match[1];
  }
  const match = text.match(new RegExp(`(?:${label.pattern.source})[^\\n;|]{0,140}?\\b(\\d{1,3}\\.\\d{2,6})\\b`, "iu"));
  return match?.[1] ?? null;
}

/** Speaker notes and Markdown may omit a score, but must never relabel one they state. */
export function protectedPresentationScoreContradictions(text:string,contract:PresentationSourceContract){
  return contract.protectedFacts.filter((fact)=>fact.precision==="source").flatMap((fact)=>{
    const definition=scoreLabels.find((candidate)=>candidate.label===fact.label);
    if(!definition)return[];
    const expression=new RegExp(`(?:${definition.pattern.source})[^\\n;,|]{0,140}?\\b(\\d{1,3}\\.\\d{2,6})\\b`,"giu");
    const observed=[...new Set([...text.matchAll(expression)].map((match)=>match[1]!).concat(scoreRow(text,definition)??[]))];
    return observed.filter((value)=>value!==fact.value).map((value)=>({label:fact.label,expected:fact.value,observed:value}));
  });
}

function decimalMean(values: string[]) {
  if (!values.length) return null;
  const precision = Math.max(...values.map((value) => value.split(".")[1]?.length ?? 0));
  const scale = BigInt(10 ** precision);
  const total = values.reduce((sum, value) => {
    const [whole, fractional = ""] = value.split(".");
    return sum + BigInt(whole ?? "0") * scale + BigInt(fractional.padEnd(precision, "0") || "0");
  }, 0n);
  const divisor = BigInt(values.length);
  const whole = total / (scale * divisor);
  let remainder = total % (scale * divisor);
  const decimals: string[] = [];
  for (let index = 0; remainder && index < 12; index += 1) {
    remainder *= 10n;
    decimals.push(String(remainder / (scale * divisor)));
    remainder %= scale * divisor;
  }
  return decimals.length ? `${whole}.${decimals.join("")}` : String(whole);
}

function roundDecimal(value: string, places: number) {
  const [whole = "0", decimals = ""] = value.split(".");
  const digits = decimals.padEnd(places + 1, "0");
  const retained = BigInt(`${whole}${digits.slice(0, places)}` || "0") + (Number(digits[places] ?? "0") >= 5 ? 1n : 0n);
  const result = String(retained).padStart(places + 1, "0");
  return `${result.slice(0, -places)}.${result.slice(-places)}`;
}

function slideForSource(outline: PresentationSourceOutline, blockId: string | null, needle: string) {
  if (!needle) return null;
  return outline.slides.find((slide) => (!blockId || slide.sourceBlockId === blockId) && slide.content.includes(needle))?.number ?? null;
}

function sourceAliasFor(sources: PresentationSourceAlias[], blockId: string | null) {
  return blockId ? sources.find((source) => source.sourceKind === "block" && source.sourceId === blockId)?.alias ?? null : null;
}

function extractProtectedFacts(blocks: SourceBlock[], outline: PresentationSourceOutline, sources: PresentationSourceAlias[]) {
  const result: ProtectedPresentationFact[] = [];
  for (const definition of scoreLabels) {
    for (const block of blocks) {
      const value = scoreRow(block.text, definition);
      if (!value) continue;
      result.push({ id: `fact_${String(result.length + 1).padStart(3, "0")}`, label: definition.label, value, precision: "source", unit: "/100", sourceBlockId: block.id, sourceAlias: sourceAliasFor(sources, block.id), slideNumber: slideForSource(outline, block.id, value) });
      break;
    }
  }
  const sourceText = blocks.map((block) => block.text).join("\n");
  const exactMatch = sourceText.match(/\b(?:exact|unrounded|precise|arithmetic(?:\s+mean)?|equal[- ]weight(?:ed)?(?:\s+(?:mean|average))?)\b[^\n.;]{0,85}?\b(\d{1,3}\.\d{3,8})\b/iu)?.[1]
    ?? sourceText.match(/\b(\d{1,3}\.\d{3,8})\b[^\n.;]{0,65}\b(?:exact|unrounded|precise)\b/iu)?.[1];
  const computed = result.length === 6 ? decimalMean(result.map((fact) => fact.value)) : null;
  const exact = exactMatch ?? computed;
  const displayMatch = sourceText.match(/\b(?:display(?:ed)?|rounded|reported)\b[^\n;]{0,75}?\b(\d{1,3}\.\d{1,2})\b/iu)?.[1]
    ?? sourceText.match(/\b(\d{1,3}\.\d{1,2})\b[^\n;]{0,65}\b(?:display(?:ed)?|rounded|reported)\b/iu)?.[1];
  const display = displayMatch ?? (exact ? roundDecimal(exact, 2) : null);
  if (exact && display) {
    const block = blocks.find((candidate) => candidate.text.includes(exact) || candidate.text.includes(display)) ?? blocks.find((candidate) => scoreLabels.some((definition) => definition.pattern.test(candidate.text))) ?? null;
    const association = { sourceBlockId: block?.id ?? null, sourceAlias: sourceAliasFor(sources, block?.id ?? null) };
    result.push({ id: `fact_${String(result.length + 1).padStart(3, "0")}`, label: "Exact equal-weight average", value: exact, exactValue: exact, displayValue: display, precision: "exact", unit: "/100", ...association, slideNumber: slideForSource(outline, block?.id ?? null, exact) });
    result.push({ id: `fact_${String(result.length + 1).padStart(3, "0")}`, label: "Rounded display average", value: display, exactValue: exact, displayValue: display, precision: "display", unit: "/100", ...association, slideNumber: slideForSource(outline, block?.id ?? null, display) });
  }
  return result;
}

function roleBefore(text: string, offset: number) {
  const heading = [...text.slice(0, offset).matchAll(/(?:^|\n)\s*#{2,6}\s+([^\n]+)/gu)].at(-1)?.[1]?.replace(/[*_`]/gu, "").trim();
  return heading && /\b(?:owner|researcher|designer|engineer|officer|user|reviewer|stakeholder|lead|director|manager)\b/iu.test(heading) ? heading : "";
}

function attributedSpeaker(value: string) {
  const cleaned = compact(value.replace(/^\*{1,2}|\*{1,2}$/gu, "").replace(/\s+role\s+agent\s*$/iu, ""));
  const parts = cleaned.split(/\s*,\s*/u);
  return { speaker: parts.length > 1 ? parts[0]! : cleaned, role: parts.length > 1 ? parts.slice(1).join(", ") : cleaned };
}

function extractProtectedQuotes(blocks: SourceBlock[], outline: PresentationSourceOutline, sources: PresentationSourceAlias[]) {
  const result: ProtectedPresentationQuote[] = [];
  const seen = new Set<string>();
  const expressions = [/“([^”]{12,4000})”/gu, /(?<![\p{L}\p{N}])"([^"\n]{12,4000})"/gu];
  for (const block of blocks) for (const expression of expressions) for (const match of block.text.matchAll(expression)) {
    const text = match[1]!;
    const following = block.text.slice(match.index + match[0].length, match.index + match[0].length + 160);
    const trailing = following.match(/^\s*(?:—|–|--|-)\s*(?:\*{1,2})?([^\n.;:!?]{2,90}?)(?:\*{1,2})?(?=\s*(?:[.;!?]|\n|$|\bSlide\s+\d))/iu)?.[1];
    const role = trailing ?? roleBefore(block.text, match.index);
    if (!role) continue;
    const attribution = attributedSpeaker(role);
    if (!attribution.role || !/\p{L}/u.test(attribution.role)) continue;
    const key = `${text}\u0000${sourceKey(attribution.role)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ id: `quote_${String(result.length + 1).padStart(3, "0")}`, text, ...attribution, sourceBlockId: block.id, sourceAlias: sourceAliasFor(sources, block.id), slideNumber: slideForSource(outline, block.id, text) });
  }
  return result;
}

function authoredProtectedMessageDirectives(block: SourceBlock): AuthoredProtectedMessage[] {
  const result = [...block.protectedMessages];
  const directives = /\b(open|start|begin|close|end|finish|conclude|preserve|retain|keep|repeat|include|use|render|show|display)\b[^:\n]{0,110}\b(exact(?:ly)?|verbatim|word[ -]for[ -]word|unchanged)\b[^:\n]{0,55}\s*[:：]\s*(?:“([^”\n]{4,500})”|"([^"\n]{4,500})"|([^\n]{4,500}))/giu;
  for (const match of block.text.matchAll(directives)) {
    const value = clean(match[3] ?? match[4] ?? match[5])
      .replace(/\s+(?=slide\s+#?\s*\d{1,3}\s*[—–:.-]).*$/iu, "")
      .replace(/\s+(?=(?:call\s+to\s+action|cta|speaker\s+notes?|visual\s+direction|production\s+notes?|supporting\s+evidence)\s*:).*$/iu, "")
      .trim();
    if (!value || !/\p{L}/u.test(value)) continue;
    const verb = clean(match[1]).toLocaleLowerCase();
    const placements: ProtectedPresentationMessagePlacement[] = /^(?:open|start|begin)$/u.test(verb) ? ["opening"]
      : /^(?:close|end|finish|conclude)$/u.test(verb) ? ["closing"] : [];
    result.push({ text: value, placements });
  }
  return result;
}

function extractProtectedMessages(blocks: SourceBlock[], outline: PresentationSourceOutline, sources: PresentationSourceAlias[], plannedSlideCount: number | null): ProtectedPresentationMessage[] {
  const result: ProtectedPresentationMessage[] = [];
  const seen = new Set<string>();
  if (!outline.slides.length) {
    const slideCount = plannedSlideCount && plannedSlideCount > 0 ? plannedSlideCount : 1;
    for (const block of blocks) for (const authored of authoredProtectedMessageDirectives(block)) {
      const message = clean(authored.text);
      if (message.length < 4 || message.length > 500 || !block.text.includes(message)) continue;
      const placements = authored.placements.length ? authored.placements : ["opening"] satisfies ProtectedPresentationMessagePlacement[];
      for (const placement of placements) {
        if (placement === "authored") continue;
        const slideNumber = placement === "closing" ? slideCount : 1;
        const key = `${slideNumber}\u0000${message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          id: `message_${String(result.length + 1).padStart(3, "0")}`,
          text: message,
          placement,
          sourceBlockId: block.id,
          sourceAlias: sourceAliasFor(sources, block.id),
          slideNumber,
        });
      }
    }
    return result.sort((left, right) => left.slideNumber - right.slideNumber || left.text.localeCompare(right.text));
  }
  const opening = outline.slides[0]!;
  const closing = outline.slides.at(-1)!;
  for (const block of blocks) for (const authored of authoredProtectedMessageDirectives(block)) {
    const message = clean(authored.text);
    if (message.length < 4 || message.length > 500) continue;
    const authoredSlides = outline.slides.filter((slide) => slide.content.includes(message));
    const requested = new Set(authored.placements);
    const candidates = requested.size
      ? outline.slides.filter((slide) => requested.has(slide.number === opening.number ? "opening" : slide.number === closing.number ? "closing" : "authored"))
      : authoredSlides;
    // An explicitly repeated opening/closing promise is one authored message
    // with two independently protected audience-facing placements.
    if (opening.number !== closing.number && opening.content.includes(message) && closing.content.includes(message)) {
      if (!candidates.includes(opening)) candidates.push(opening);
      if (!candidates.includes(closing)) candidates.push(closing);
    }
    for (const slide of candidates) {
      if (!slide.content.includes(message)) continue;
      const placement = slide.number === opening.number ? "opening" : slide.number === closing.number ? "closing" : "authored";
      const key = `${slide.number}\u0000${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        id: `message_${String(result.length + 1).padStart(3, "0")}`,
        text: message,
        placement,
        sourceBlockId: slide.sourceBlockId,
        sourceAlias: sourceAliasFor(sources, slide.sourceBlockId),
        slideNumber: slide.number,
      });
    }
  }
  return result.sort((left, right) => left.slideNumber - right.slideNumber || left.text.localeCompare(right.text));
}

function extractProtectedTerminology(blocks: SourceBlock[], sources: PresentationSourceAlias[]) {
  const patterns = [
    { label: "Product destinations", terms: ["Projects", "Work", "Explore", "Activity", "Deliver"] },
    { label: "Working mode families", terms: ["Write", "Shape", "Present"] },
  ];
  const families = patterns.flatMap((pattern): ProtectedPresentationTerminology[] => {
    const joined = new RegExp(pattern.terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s*(?:/|→|>|,|\\||·|and)\\s*"), "iu");
    const block = blocks.find((candidate) => joined.test(candidate.text));
    return block ? [{ label: pattern.label, terms: [...pattern.terms], sourceBlockId: block.id, sourceAlias: sourceAliasFor(sources, block.id) }] : [];
  });
  const postureTerms = ["Phone", "Tablet", "Small/snapped monitor", "Large monitor"];
  const posturePattern = (term: string) => term === "Small/snapped monitor"
    ? /\b(?:small(?:\s*\/\s*snapped|\s+or\s+snapped|\s*[-–]\s*snapped)?\s+monitors?|snapped\s+(?:small\s+)?monitors?)\b/iu
    : new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}s?\\b`, "iu");
  const authored = blocks.map((block) => block.text).join("\n");
  if (postureTerms.every((term) => posturePattern(term).test(authored))) {
    const block = blocks.find((candidate) => postureTerms.every((term) => posturePattern(term).test(candidate.text)))
      ?? blocks.find((candidate) => posturePattern("Small/snapped monitor").test(candidate.text));
    if (block) families.push({ label: "Device postures", terms: postureTerms, sourceBlockId: block.id, sourceAlias: sourceAliasFor(sources, block.id) });
  }
  return families;
}

function roadmapLabelBefore(text: string, offset: number) {
  const preceding = text.slice(Math.max(0, offset - 95), offset);
  const phase = [...preceding.matchAll(/\b(first|initial|pilot|release|foundation|phase\s*1|full|complete|comprehensive|program|phase\s*2)\b/giu)].at(-1)?.[1];
  if (!phase) return "Delivery milestone";
  return /^(?:first|initial|pilot|release|foundation|phase\s*1)$/iu.test(phase) ? "First release" : "Full program";
}

function extractRoadmaps(blocks: SourceBlock[], outline: PresentationSourceOutline, sources: PresentationSourceAlias[]) {
  const result: ProtectedPresentationRoadmap[] = [];
  const seen = new Set<string>();
  for (const block of blocks) for (const match of block.text.matchAll(/\b(\d{1,2})\s*[—–-]\s*(\d{1,2})\s*(?:weeks?|wks?)\b/giu)) {
    const minimumWeeks = Number(match[1]);
    const maximumWeeks = Number(match[2]);
    if (!minimumWeeks || maximumWeeks < minimumWeeks || maximumWeeks > 104) continue;
    const key = `${minimumWeeks}-${maximumWeeks}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = roadmapLabelBefore(block.text, match.index);
    result.push({ label, value: `${minimumWeeks}–${maximumWeeks} weeks`, minimumWeeks, maximumWeeks, sourceBlockId: block.id, sourceAlias: sourceAliasFor(sources, block.id), slideNumber: slideForSource(outline, block.id, match[0]) });
  }
  return result;
}

export function buildPresentationSourceContract(input: PresentationSourceInput, options: PresentationSourceOptions = {}): PresentationSourceContract {
  const blocks = sourceBlocks(input);
  const sources = buildSourceAliases(input, options, blocks);
  const outline = inferPresentationSourceOutline(input);
  for (const slide of outline.slides) slide.sourceAlias = sourceAliasFor(sources, slide.sourceBlockId);
  const requestedRaw = Number(options.requestedSlideCount ?? options.itemCount ?? 0);
  const requestedSlideCount = Number.isSafeInteger(requestedRaw) && requestedRaw > 0 && requestedRaw <= 100 ? requestedRaw : null;
  return {
    schemaVersion: 1,
    outline,
    numberedOutline: outline.slides,
    authoredSlideCount: outline.authoredSlideCount,
    requestedSlideCount,
    predictedSlideCount: requestedSlideCount ?? outline.authoredSlideCount,
    slideCountMismatch: requestedSlideCount !== null && outline.authoredSlideCount !== null && requestedSlideCount !== outline.authoredSlideCount,
    protectedFacts: extractProtectedFacts(blocks, outline, sources),
    protectedQuotes: extractProtectedQuotes(blocks, outline, sources),
    protectedMessages: extractProtectedMessages(blocks, outline, sources, requestedSlideCount ?? outline.authoredSlideCount),
    protectedTerminology: extractProtectedTerminology(blocks, sources),
    roadmaps: extractRoadmaps(blocks, outline, sources),
    style: inferPresentationStyleContract(input, options),
    sources,
    fidelity: options.fidelity === "creative" ? "creative" : "faithful",
  };
}

export const extractPresentationSourceContract = buildPresentationSourceContract;

const omitSourceBlockId = <T extends { sourceBlockId: string | null }>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== "sourceBlockId")) as Omit<T, "sourceBlockId">;

/** Serialize only source-safe prose and short-lived aliases to external providers. */
export function providerFacingPresentationSourceContract(contract: PresentationSourceContract) {
  const groupAliasById = new Map(contract.sources.filter((source) => source.sourceKind === "context-group").map((source) => [source.sourceId, source.alias]));
  return {
    schemaVersion: contract.schemaVersion,
    authoredSlideCount: contract.authoredSlideCount,
    requestedSlideCount: contract.requestedSlideCount,
    predictedSlideCount: contract.predictedSlideCount,
    slideCountMismatch: contract.slideCountMismatch,
    fidelity: contract.fidelity,
    outline: contract.numberedOutline.map((slide) => ({ number: slide.number, order: slide.order, title: slide.title, content: slide.content, section: slide.section, sourceAlias: slide.sourceAlias, contextGroupAliases: slide.contextGroupIds.flatMap((id) => { const alias = groupAliasById.get(id); return alias ? [alias] : []; }) })),
    sections: contract.outline.sections.map((section) => ({ title: section.title, slideNumbers: [...section.slideNumbers] })),
    protectedFacts: contract.protectedFacts.map(omitSourceBlockId),
    protectedQuotes: contract.protectedQuotes.map(omitSourceBlockId),
    protectedMessages: contract.protectedMessages.map(omitSourceBlockId),
    protectedTerminology: contract.protectedTerminology.map(omitSourceBlockId),
    roadmaps: contract.roadmaps.map(omitSourceBlockId),
    style: contract.style,
    sources: contract.sources.map((source) => ({ alias: source.alias, sourceKind: source.sourceKind, label: source.label, contextGroupAliases: source.contextGroupIds.flatMap((id) => { const alias = groupAliasById.get(id); return alias ? [alias] : []; }) })),
  };
}

/** Resolve provider aliases locally; invented references remain explicit validation failures. */
export function resolvePresentationSourceReferences(references: readonly unknown[], input: PresentationSourceContract | readonly PresentationSourceAlias[], options: PresentationSourceResolutionOptions = {}): PresentationSourceResolution {
  const sources: readonly PresentationSourceAlias[] = "sources" in input ? input.sources : input;
  const byReference = new Map<string, PresentationSourceAlias>();
  const groups = sources.filter((source) => source.sourceKind === "context-group");
  for (const source of sources) {
    byReference.set(source.alias, source);
    if (options.allowDurableIds === true) byReference.set(source.sourceId, source);
  }
  groups.forEach((group, index) => {
    byReference.set(`context_group_${index + 1}`, group);
    byReference.set(`context-group-${index + 1}`, group);
  });
  const sourceIds = new Set<string>();
  const blockIds = new Set<string>();
  const contextGroupIds = new Set<string>();
  const sourceAliases = new Set<string>();
  const unknownReferences = new Set<string>();
  for (const candidate of references) {
    const reference = clean(candidate);
    if (!reference) continue;
    const source = byReference.get(reference);
    if (!source) { unknownReferences.add(reference); continue; }
    sourceIds.add(source.sourceId);
    sourceAliases.add(source.alias);
    if (source.sourceKind === "block") blockIds.add(source.sourceId);
    if (source.blockId) blockIds.add(source.blockId);
    if (source.sourceKind === "context-group") contextGroupIds.add(source.sourceId);
    for (const id of source.contextGroupIds) contextGroupIds.add(id);
  }
  return { sourceIds: [...sourceIds], blockIds: [...blockIds], contextGroupIds: [...contextGroupIds], sourceAliases: [...sourceAliases], unknownReferences: [...unknownReferences], valid: unknownReferences.size === 0 && sourceIds.size > 0 };
}

function visibleSlideText(item: Record<string, unknown>) {
  return presentationAudienceText(item);
}

function referenceValues(item: Record<string, unknown>) {
  const slide = asRecord(item.slide);
  const visual = asRecord(slide.visual);
  const quote = asRecord(slide.quote ?? visual.quote);
  const citations = Array.isArray(slide.citations) ? slide.citations.map(asRecord) : [];
  const data = Array.isArray(visual.data) ? visual.data.map(asRecord) : [];
  return unique([
    ...(Array.isArray(item.context_group_ids) ? item.context_group_ids : []),
    ...(Array.isArray(item.contextGroupIds) ? item.contextGroupIds : []),
    ...(Array.isArray(slide.sourceIds) ? slide.sourceIds : []),
    ...(Array.isArray(slide.source_ids) ? slide.source_ids : []),
    quote.sourceId, quote.source_id,
    ...citations.flatMap((citation) => [citation.sourceId, citation.source_id]),
    ...data.flatMap((datum) => [...(Array.isArray(datum.sourceIds) ? datum.sourceIds : []), ...(Array.isArray(datum.source_ids) ? datum.source_ids : [])]),
  ].map(clean));
}

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function containsNumber(text: string, value: string) {
  return new RegExp(`(?<![\\d.])${escaped(value)}(?!\\d|\\.\\d)`, "u").test(text);
}

function relatedSlideIndex(outline: PresentationSourceSlide[], slideNumber: number | null, sourceBlockId: string | null, pageStart: number, length: number) {
  const authored = slideNumber ? outline.findIndex((slide) => slide.number === slideNumber)
    : sourceBlockId ? outline.findIndex((slide) => slide.sourceBlockId === sourceBlockId) : 0;
  const relative = authored < 0 ? 0 : authored - pageStart;
  return Math.max(0, Math.min(Math.max(0, length - 1), relative));
}

/**
 * Promote a missing final promise only when both its opening and final authored
 * slides independently authorize the exact same audience-visible wording.
 * Internal citations are evidence, never a substitute for delivered content.
 */
export function repairProtectedPresentationMessages<T>(values: readonly T[], contract: PresentationSourceContract, options: { pageStart?: number } = {}): T[] {
  const result = [...values];
  const pageStart = Math.max(0, Math.floor(Number(options.pageStart ?? 0)));
  const opening = contract.numberedOutline[0];
  if (!opening) return result;

  for (const message of contract.protectedMessages) {
    if (message.placement !== "closing") continue;
    const authoredIndex = contract.numberedOutline.findIndex((slide) => slide.number === message.slideNumber);
    const index = authoredIndex - pageStart;
    if (index < 0 || index >= result.length) continue;
    const authored = contract.numberedOutline[authoredIndex];
    const item = asRecord(result[index]);
    if (!authored || !authored.content.includes(message.text) || visibleSlideText(item).includes(message.text)) continue;

    const openingIndex = contract.numberedOutline.findIndex((slide) => slide.number === opening.number) - pageStart;
    const openingItem = openingIndex >= 0 && openingIndex < result.length ? asRecord(result[openingIndex]) : null;
    const assigned = asRecord(item.slide);
    const citations = Array.isArray(assigned.citations) ? assigned.citations.map(asRecord) : [];
    const references = [
      ...(Array.isArray(assigned.sourceIds) ? assigned.sourceIds : []),
      ...(Array.isArray(assigned.source_ids) ? assigned.source_ids : []),
      ...citations.map((citation) => citation.sourceId ?? citation.source_id),
    ].map(clean).filter(Boolean);
    const resolved = resolvePresentationSourceReferences(references, contract, { allowDurableIds: true });
    if (message.sourceBlockId && !resolved.blockIds.includes(message.sourceBlockId)) continue;
    const openingDelivered = Boolean(openingItem && opening.content.includes(message.text) && visibleSlideText(openingItem).includes(message.text));
    const assignedEvidence = citations.some((citation) => {
      const excerpt = clean(citation.excerpt);
      if (!excerpt.includes(message.text) || !authored.content.includes(excerpt)) return false;
      const anchored = clean(citation.anchor).match(/\b(?:authored\s+)?slide\s+(\d+)\b/iu)?.[1];
      if (anchored && Number(anchored) !== authored.number) return false;
      const reference = clean(citation.sourceId ?? citation.source_id);
      if (!reference || !message.sourceBlockId) return true;
      return resolvePresentationSourceReferences([reference], contract, { allowDurableIds: true }).blockIds.includes(message.sourceBlockId);
    });
    if (!openingDelivered && !assignedEvidence) continue;

    const body = clean(item.body);
    result[index] = { ...item, body: body ? `${message.text}\n\n${body}` : message.text } as T;
  }

  return result;
}

/**
 * Validate visible, attributed evidence. Page-scoped callers validate authored
 * scenes for that page; complete-deck callers additionally protect every fact,
 * stakeholder quotation, term family, roadmap, and semantic precision label.
 */
export function validatePresentationSourceCoverage(values: readonly unknown[], contract: PresentationSourceContract, options: PresentationSourceCoverageOptions = {}): PresentationSourceCoverageIssue[] {
  const items = values.map(asRecord);
  const pageStart = Math.max(0, Math.floor(Number(options.pageStart ?? 0)));
  const pageSize = Math.max(0, Math.floor(Number(options.pageSize ?? items.length)));
  const globalExpected = contract.numberedOutline.filter((slide) => slide.number > pageStart && slide.number <= pageStart + pageSize);
  const expected = globalExpected.length ? globalExpected : contract.numberedOutline.slice(pageStart, pageStart + pageSize);
  const complete = options.requireAllProtectedContent ?? (pageStart === 0 && (!contract.authoredSlideCount || items.length >= contract.authoredSlideCount));
  const requireGrounding = options.requireEverySlideSource ?? false;
  const issues: PresentationSourceCoverageIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const visible = items.map(visibleSlideText);
  const visibleDeck = visible.join("\n");
  const exactFact = contract.protectedFacts.find((fact) => fact.precision === "exact");

  const requiredCount = contract.requestedSlideCount ?? contract.predictedSlideCount ?? contract.authoredSlideCount;
  if (complete && requiredCount !== null && items.length !== requiredCount) add("slide_count_mismatch", "items", `The planned presentation contains ${requiredCount} slides, but the generated deck contains ${items.length}.`);

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const references = referenceValues(item);
    if (contract.sources.length && references.length) {
      const resolution = resolvePresentationSourceReferences(references, contract, { allowDurableIds: true });
      resolution.unknownReferences.forEach(() => add("unknown_source_reference", `items.${index}.slide.sourceIds`, `Slide ${pageStart + index + 1} refers to an unauthorized or invented source reference.`));
      if (requireGrounding && !resolution.sourceIds.length) add("missing_slide_source", `items.${index}.slide.sourceIds`, `Slide ${pageStart + index + 1} has no authorized source attribution.`);
      const expectedSource = expected[index]?.sourceBlockId;
      if (expectedSource) {
        const expectedGroups = contract.sources.find((source) => source.sourceKind === "block" && source.sourceId === expectedSource)?.contextGroupIds ?? [];
        const matchesExpectedBlock = resolution.blockIds.includes(expectedSource);
        const matchesExpectedGroup = resolution.contextGroupIds.some((groupId) => expectedGroups.includes(groupId));
        if (!matchesExpectedBlock && !matchesExpectedGroup) add("incorrect_slide_source", `items.${index}.slide.sourceIds`, `Slide ${pageStart + index + 1} is not attributed to its authored outline source.`);
      }
    } else if (requireGrounding) add("missing_slide_source", `items.${index}.slide.sourceIds`, `Slide ${pageStart + index + 1} has no authorized source attribution.`);

    const slide = asRecord(item.slide);
    const citations = Array.isArray(slide.citations) ? slide.citations.map(asRecord) : [];
    const expectedSource = expected[index]?.sourceBlockId;
    const expectedGroups = expectedSource ? contract.sources.find((source) => source.sourceKind === "block" && source.sourceId === expectedSource)?.contextGroupIds ?? [] : [];
    const matchesAuthoredSource = (references:readonly unknown[]) => {
      if(!expectedSource)return true;
      const resolution=resolvePresentationSourceReferences(references,contract,{allowDurableIds:true});
      return resolution.blockIds.includes(expectedSource)||resolution.contextGroupIds.some((groupId)=>expectedGroups.includes(groupId));
    };
    for (const [citationIndex, citation] of citations.entries()) {
      const sourceReference = clean(citation.sourceId ?? citation.source_id);
      if (sourceReference && !matchesAuthoredSource([sourceReference])) add("incorrect_citation_source", `items.${index}.slide.citations.${citationIndex}.sourceId`, `A citation on slide ${pageStart + index + 1} is not attributed to that slide's authored source.`);
      const anchoredSlide=clean(citation.anchor).match(/\b(?:authored\s+)?slide\s+(\d+)\b/iu)?.[1];
      if(anchoredSlide&&expected[index]?.number&&Number(anchoredSlide)!==expected[index]!.number)add("incorrect_citation_anchor",`items.${index}.slide.citations.${citationIndex}.anchor`,`A citation on slide ${pageStart+index+1} identifies a different authored slide.`);
      const excerpt = clean(citation.excerpt), authoredContent = clean(expected[index]?.content);
      if (excerpt && authoredContent) {
        const excerptKey = citationEvidenceKey(excerpt), authoredKey = citationEvidenceKey(authoredContent);
        if (excerptKey && !` ${authoredKey} `.includes(` ${excerptKey} `)) add("ungrounded_citation_excerpt", `items.${index}.slide.citations.${citationIndex}.excerpt`, `A citation on slide ${pageStart + index + 1} does not quote its authored source.`);
      }
    }

    const visual = asRecord(slide.visual);
    const quote=asRecord(slide.quote??visual.quote),quoteSource=clean(quote.sourceId??quote.source_id);
    if(quoteSource&&!matchesAuthoredSource([quoteSource]))add("incorrect_quote_source",`items.${index}.slide.quote.sourceId`,`A stakeholder quotation on slide ${pageStart+index+1} is not attributed to its authored source.`);
    const visualData=Array.isArray(visual.data)?visual.data.map(asRecord):[];
    for(const [datumIndex,datum] of visualData.entries()){
      const references=[...(Array.isArray(datum.sourceIds)?datum.sourceIds:[]),...(Array.isArray(datum.source_ids)?datum.source_ids:[])];
      if(references.length&&!references.every((reference)=>matchesAuthoredSource([reference])))add("incorrect_visual_source",`items.${index}.slide.visual.data.${datumIndex}.sourceIds`,`A visual data point on slide ${pageStart+index+1} is not attributed to its authored source.`);
    }
    const exact = clean(visual.exactValue ?? visual.exact_value);
    const display = clean(visual.displayValue ?? visual.display_value);
    // Precision fields describe their own visual; roadmap durations and other
    // independent metrics must never be mistaken for the overall score.
    const averageVisual = exactFact && (
      expected[index]?.number === exactFact.slideNumber
      || [exact, display].some((value) => Boolean(value) && (value === exactFact.exactValue || value === exactFact.displayValue))
      || /\b(?:overall|equal[- ]weight(?:ed)?|arithmetic|average|mean|composite|aggregate)\b/iu.test(`${clean(visual.label)} ${clean(visual.value)}`)
    );
    if (averageVisual && exact && exact !== exactFact.exactValue) add("incorrect_exact_value", `items.${index}.slide.visual.exactValue`, `The exact value must remain ${exactFact.exactValue}, not ${exact}.`);
    if (averageVisual && display && display !== exactFact.displayValue) add("incorrect_display_value", `items.${index}.slide.visual.displayValue`, `The rounded display value must remain ${exactFact.displayValue}, not ${display}.`);
    if (exactFact?.exactValue && exactFact.displayValue && exactFact.exactValue !== exactFact.displayValue) {
      const reversedExact = new RegExp(`\\b(?:exact|unrounded|precise)\\b[^\\d\\n]{0,50}\\b${escaped(exactFact.displayValue)}\\b`, "iu");
      const reversedDisplay = new RegExp(`\\b(?:display(?:ed)?|rounded)\\b[^\\d\\n]{0,50}\\b${escaped(exactFact.exactValue)}\\b`, "iu");
      if (reversedExact.test(visible[index] ?? "") || reversedDisplay.test(visible[index] ?? "")) add("reversed_numeric_precision", `items.${index}.slide.visual`, `Slide ${pageStart + index + 1} reverses the exact ${exactFact.exactValue} and rounded display ${exactFact.displayValue} meanings.`);
    }
  }

  for (const message of contract.protectedMessages) {
    const authoredIndex = contract.numberedOutline.length ? contract.numberedOutline.findIndex((slide) => slide.number === message.slideNumber) : message.slideNumber - 1;
    const index = authoredIndex - pageStart;
    if (index < 0 || index >= items.length) continue;
    if (!(visible[index] ?? "").includes(message.text)) {
      const elsewhere = visible.some((content, position) => position !== index && content.includes(message.text));
      add(elsewhere ? "misplaced_protected_message" : "missing_protected_message", `items.${index}.body`, `The exact authored ${message.placement} message must appear in audience-facing content on slide ${message.slideNumber}.`);
    }
  }

  if (!complete) return issues;

  for (const fact of contract.protectedFacts) if (!containsNumber(visibleDeck, fact.value)) {
    const index = relatedSlideIndex(contract.numberedOutline, fact.slideNumber, fact.sourceBlockId, pageStart, items.length);
    add("missing_protected_fact", `items.${index}.slide.visual`, `The protected ${fact.label} value ${fact.value} is missing from the visible presentation.`);
  }

  const scores = contract.protectedFacts.filter((fact) => fact.precision === "source");
  if (scores.length >= 2) {
    for (const fact of scores) {
      const definition = scoreLabels.find((candidate) => candidate.label === fact.label);
      const observed = definition ? scoreRow(visibleDeck, definition) : null;
      if (observed && observed !== fact.value) {
        const index = relatedSlideIndex(contract.numberedOutline, fact.slideNumber, fact.sourceBlockId, pageStart, items.length);
        add("mislabeled_protected_fact", `items.${index}.slide.visual`, `The protected ${fact.label} assessment must remain ${fact.value}, not ${observed}.`);
      }
    }
    const scoreSlide = items.findIndex((item) => {
      const visual = asRecord(asRecord(item.slide).visual);
      const kind = clean(visual.kind).toLowerCase();
      return ["bars", "scorecard", "matrix", "comparison"].includes(kind) && scores.filter((fact) => containsNumber(visibleSlideText(item), fact.value)).length >= 2;
    });
    if (scoreSlide >= 0) {
      const visual = asRecord(asRecord(items[scoreSlide]!.slide).visual);
      const data = Array.isArray(visual.data) ? visual.data as unknown[] : [];
      for (const fact of scores) {
        const matchedIndex = data.findIndex((candidate) => {
          const datum = asRecord(candidate);
          return containsNumber(clean(datum.value ?? datum.exactValue ?? datum.displayValue), fact.value)
            && scoreLabels.find((definition) => definition.label === fact.label)?.pattern.test(clean(datum.label));
        });
        if (matchedIndex < 0) add("missing_scorecard_datum", `items.${scoreSlide}.slide.visual.data`, `The scorecard omits the protected ${fact.label} value ${fact.value}.`);
        else if (["scorecard", "bars"].includes(clean(visual.kind).toLowerCase()) && fact.unit === "/100") {
          const weight = Number(asRecord(data[matchedIndex]).weight);
          if (Number.isFinite(weight) && Math.abs(weight - Number(fact.value) / 100) > 1e-6) add("inconsistent_scorecard_weight", `items.${scoreSlide}.slide.visual.data.${matchedIndex}.weight`, `The protected ${fact.label} assessment bar must represent ${fact.value}/100.`);
        }
      }
    }
  }

  for (const quote of contract.protectedQuotes) {
    const quoteIndex = visible.findIndex((content) => content.includes(quote.text));
    const index = quoteIndex < 0 ? relatedSlideIndex(contract.numberedOutline, quote.slideNumber, quote.sourceBlockId, pageStart, items.length) : quoteIndex;
    if (quoteIndex < 0) add("missing_protected_quote", `items.${index}.slide.quote.text`, `The complete ${quote.role} stakeholder quotation is missing or truncated.`);
    else {
      const attributed = asRecord(asRecord(items[quoteIndex]!.slide).quote);
      const explicitQuote = clean(attributed.text) === quote.text;
      const namedSpeaker = sourceKey(quote.speaker) !== sourceKey(quote.role);
      const namedPrefix = namedSpeaker ? `(?:${escaped(quote.speaker)}\\s*,\\s*)?` : "";
      const expectedAttribution = new RegExp(`${escaped(quote.text)}[”"\\s]*[—–-]\\s*(?:\\*\\*)?${namedPrefix}${escaped(quote.role)}\\b`, "u");
      const quoteVisual = asRecord(asRecord(items[quoteIndex]!.slide).visual);
      const attributedVisual = clean(quoteVisual.value).includes(quote.text) && clean(quoteVisual.label) === quote.role;
      const correctRole = explicitQuote ? clean(attributed.role) === quote.role : attributedVisual || expectedAttribution.test(visible[quoteIndex] ?? "");
      if (!correctRole) add(visible[quoteIndex]?.includes(quote.role) ? "incorrect_quote_attribution" : "missing_quote_attribution", `items.${quoteIndex}.slide.quote.role`, `The complete ${quote.role} stakeholder quotation must retain its own correct role attribution.`);
      if (namedSpeaker) {
        const expectedSpeaker = new RegExp(`${escaped(quote.text)}[”"\\s]*[—–-]\\s*(?:\\*\\*)?${escaped(quote.speaker)}(?:\\s*,|\\b)`, "u");
        const correctSpeaker = explicitQuote ? clean(attributed.speaker) === quote.speaker : expectedSpeaker.test(visible[quoteIndex] ?? "");
        if (!correctSpeaker) add("incorrect_quote_speaker", `items.${quoteIndex}.slide.quote.speaker`, `The complete ${quote.role} stakeholder quotation must retain its named speaker, ${quote.speaker}.`);
      }
    }
  }

  for (const family of contract.protectedTerminology) for (const term of family.terms) if (!(family.label === "Device postures" && term === "Small/snapped monitor"
    ? /\b(?:small(?:\s*\/\s*snapped|\s+or\s+snapped|\s*[-–]\s*snapped)?\s+monitors?|snapped\s+(?:small\s+)?monitors?)\b/iu
    : new RegExp(`\\b${escaped(term)}\\b`, "iu")).test(visibleDeck)) {
    const index = relatedSlideIndex(contract.numberedOutline, null, family.sourceBlockId, pageStart, items.length);
    add("missing_protected_terminology", `items.${index}.body`, `The protected ${family.label.toLowerCase()} term “${term}” is missing.`);
  }

  for (const roadmap of contract.roadmaps) {
    const milestone = new RegExp(`\\b${roadmap.minimumWeeks}\\s*[—–-]\\s*${roadmap.maximumWeeks}\\s*(?:weeks?|wks?)\\b`, "iu");
    const index = relatedSlideIndex(contract.numberedOutline, roadmap.slideNumber, roadmap.sourceBlockId, pageStart, items.length);
    if (!milestone.test(visibleDeck)) add("missing_roadmap_milestone", `items.${index}.body`, `The protected ${roadmap.label.toLowerCase()} milestone ${roadmap.value} is missing.`);
    else if (roadmap.slideNumber!==null&&index>=0&&index<visible.length&&!milestone.test(visible[index]??""))add("misplaced_roadmap_milestone",`items.${index}.body`,`The protected ${roadmap.label.toLowerCase()} milestone ${roadmap.value} must remain on its authored roadmap slide.`);
    else if (roadmap.label !== "Delivery milestone") {
      const content = roadmap.slideNumber !== null && index >= 0 && index < visible.length ? visible[index]! : visibleDeck;
      const matches = [...content.matchAll(new RegExp(milestone.source, "giu"))];
      if (!matches.some((match) => roadmapLabelBefore(content, match.index) === roadmap.label)) add("incorrect_roadmap_phase", `items.${index}.body`, `The protected ${roadmap.value} milestone must retain its ${roadmap.label.toLowerCase()} phase.`);
    }
  }

  return issues;
}
