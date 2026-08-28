import { documentArtifactDefinition, isDocumentArtifactKind, type DocumentArtifactKind } from "./document-artifacts.ts";
import type { CreativeEvent, CreativeOutput } from "./events.ts";

export type OutputNamingKind = DocumentArtifactKind | "image";

export type OutputNamingCandidate = {
  id: string;
  sequence: number;
  kind?: OutputNamingKind;
  documentId?: string;
  title?: string | null;
  customTitle?: string | null;
  titleSource?: "generated" | "authored";
  summary?: string | null;
  sourceEventId?: string | null;
  createdAt?: string | null;
  settings?: Readonly<Record<string, unknown>> | null;
  sourceSurface?: string | null;
  quality?: string | null;
  purpose?: string | null;
  itemCount?: number | null;
  promptTechnique?: string | null;
  productionMode?: string | null;
};

type OutputNamingEvent = Pick<CreativeEvent, "eventId" | "occurredAt"> &
  Partial<Pick<CreativeEvent, "sequence" | "type" | "payload">>;

export type OutputNamingOptions = {
  events?: readonly OutputNamingEvent[];
  peers?: readonly OutputNamingCandidate[];
  locale?: string;
  timeZone?: string;
  includeTimestamp?: boolean;
  includeKind?: boolean;
  alwaysIncludeTake?: boolean;
  maxSummaryLength?: number;
  formatTake?: (take: number) => string;
  formatKind?: (kind: OutputNamingKind) => string;
  /** Optional project-list presentation; never an authority or routing identity. */
  scopedLabels?: { documents: readonly { id: string; title: string }[]; formatDocument: (number: number) => string; formatResult: (number: number) => string };
};

export type OutputPresentation = {
  id: string;
  title: string;
  label: string;
  secondaryLabel: string;
  kindLabel: string;
  description: string;
  intent: string;
  version: number;
  variantCount: number;
  ordinal: number;
  total: number;
  createdAt: string | null;
  sourceLabel: string;
  isCustomTitle: boolean;
  disambiguator: string;
  displayScope?: { key: string; title: string; documentTitle: string; qualifier: string; context: string; showDocument: boolean };
};

type Creation = { id: string; documentId: string; kind: OutputNamingKind; sequence: number; index: number };

const clean = (value: unknown) => typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/gu, " ") : "";
const key = (value: unknown) => clean(value).normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const kindOf = (candidate: OutputNamingCandidate): OutputNamingKind => candidate.kind && isDocumentArtifactKind(candidate.kind) ? candidate.kind : "image";
const groupOf = (documentId: string, kind: OutputNamingKind) => `${documentId}\u0000${kind}`;

const copyFor = (locale = "en") => {
  const language = locale.toLocaleLowerCase().split("-")[0];
  return language === "fr" ? {
    take: "Prise", image: "Image", draft: "Brouillon", finished: "Image finale", visual: "Scène visuelle", audio: "Scène audio",
    music: "Musique originale", narration: "Narration parlée", effects: "Effets sonores", workflow: "Parcours de production",
    assistant: "Assistant", canvas: "Tableau", managed: "Production structurée", for: "Pour", tone: "ton", style: "style",
    slide: "diapositive", slides: "diapositives", frame: "image", frames: "images", scene: "scène", scenes: "scènes",
  } : language === "ar" ? {
    take: "المحاولة", image: "صورة", draft: "مسودة", finished: "الصورة النهائية", visual: "مشهد مرئي", audio: "مشهد صوتي",
    music: "موسيقى أصلية", narration: "سرد صوتي", effects: "مؤثرات صوتية", workflow: "مسار الإنتاج",
    assistant: "المساعد", canvas: "لوحة العمل", managed: "إنتاج منظّم", for: "إلى", tone: "نبرة", style: "نمط",
    slide: "شريحة", slides: "شرائح", frame: "إطار", frames: "إطارات", scene: "مشهد", scenes: "مشاهد",
  } : language === "ja" ? {
    take: "テイク", image: "画像", draft: "下書き", finished: "完成画像", visual: "ビジュアルシーン", audio: "音声シーン",
    music: "オリジナル音楽", narration: "ナレーション", effects: "効果音", workflow: "制作フロー",
    assistant: "アシスタント", canvas: "キャンバス", managed: "構造化された制作", for: "対象", tone: "トーン", style: "スタイル",
    slide: "スライド", slides: "スライド", frame: "フレーム", frames: "フレーム", scene: "シーン", scenes: "シーン",
  } : {
    take: "Take", image: "Image", draft: "Working draft", finished: "Finished image", visual: "Visual scene", audio: "Audio scene",
    music: "Original music", narration: "Spoken narration", effects: "Sound effects", workflow: "Production path",
    assistant: "Assistant", canvas: "Canvas", managed: "Structured production", for: "For", tone: "tone", style: "style",
    slide: "slide", slides: "slides", frame: "frame", frames: "frames", scene: "scene", scenes: "scenes",
  };
};

/** Recover the already-generated private direction title without another model request. */
export function imageOutputNamingCandidate(
  output: CreativeOutput,
  retainedContent: Readonly<Record<string, string>> = {},
  documentTitle = "",
): OutputNamingCandidate {
  let generatedTitle = "";
  const retained = output.contentRef ? retainedContent[output.contentRef] : "";
  if (retained) {
    try { generatedTitle = clean(record(JSON.parse(retained)).title); } catch { /* Expired or legacy direction content remains optional. */ }
  }
  const authored = output.titleSource === "authored" ? clean(output.title) : "";
  return {
    ...output,
    kind: "image",
    title: authored || clean(output.title) || generatedTitle || clean(documentTitle) || "Image",
    ...(authored ? { customTitle: authored } : {}),
  };
}

function historicalCreations(events: readonly OutputNamingEvent[]): Creation[] {
  const creations: Creation[] = [];
  for (const event of events) {
    if (!event.type || !Number.isSafeInteger(event.sequence)) continue;
    const payload = record(event.payload), documentId = clean(payload.document_id);
    if (!documentId) continue;
    if (event.type === "DocumentRenderCompleted" && isDocumentArtifactKind(payload.artifact_kind)) {
      const id = clean(payload.artifact_id);
      if (id) creations.push({ id, documentId, kind: payload.artifact_kind, sequence: event.sequence!, index: 0 });
      continue;
    }
    if (event.type !== "GenerationCompleted" && event.type !== "IdeationPreviewCompleted" || payload.report_space === "scout") continue;
    const ids = Array.isArray(payload.object_ids) ? payload.object_ids.map(clean).filter(Boolean) : [];
    if (!ids.length && clean(payload.object_id)) ids.push(clean(payload.object_id));
    for (const [index, id] of ids.entries()) creations.push({ id, documentId, kind: "image", sequence: event.sequence!, index });
  }
  return creations;
}

function boundedIntent(value: unknown, max = 72) {
  const sentence = clean(value).split(/(?<=[.!?])\s+/u)[0] ?? "";
  if (sentence.length <= max) return sentence;
  const shortened = sentence.slice(0, Math.max(12, max - 1));
  return `${shortened.replace(/\s+\S*$/u, "").trim() || shortened.trim()}…`;
}

function formattedDate(value: string | null, locale: string, timeZone?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try { return new Intl.DateTimeFormat(locale, { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(value)); }
  catch { return new Intl.DateTimeFormat("en", options).format(new Date(value)); }
}

function semanticDetails(candidate: OutputNamingCandidate, locale: string, title: string, maximum: number) {
  const settings = record(candidate.settings), audioProfile = record(settings.audio_profile), copy = copyFor(locale);
  const kind = kindOf(candidate), details: string[] = [];
  if (kind === "scene") {
    const configuration = record(settings.scene_configuration);
    const medium = settings.scene_medium ?? configuration.medium;
    if (medium === "visual" || medium === "audio") details.push(medium === "audio" ? copy.audio : copy.visual);
  }
  if (kind === "audio") {
    const goal = clean(settings.audio_goal ?? audioProfile.goal);
    if (/narrat|spoken|speech|voice/u.test(goal)) details.push(copy.narration);
    else if (/effect/u.test(goal)) details.push(copy.effects);
    else if (/music|score/u.test(goal)) details.push(copy.music);
  }
  if (kind === "audio" || kind === "video") {
    const duration = Number(settings.duration_seconds ?? settings.video_seconds ?? audioProfile.duration_seconds);
    if (Number.isFinite(duration) && duration > 0) details.push(`${new Intl.NumberFormat(locale).format(duration)} s`);
  }
  if (kind === "slides") {
    const style = clean(settings.presentation_style ?? settings.style_preset);
    if (style && style !== "document") details.push(`${style.replace(/[-_]/gu, " ")} ${copy.style}`);
  }
  if (kind === "image") {
    details.push(candidate.purpose === "ideate" || candidate.quality === "low" ? copy.draft : copy.finished);
    const technique = clean(candidate.promptTechnique);
    if (technique && technique !== "prose") details.push(technique.toLocaleUpperCase() === technique ? technique : `${technique[0]!.toLocaleUpperCase(locale)}${technique.slice(1)}`);
  }
  const audience = clean(settings.audience);
  if (audience && !/^(?:general|everyone|anyone|unspecified)$/iu.test(audience)) details.push(`${copy.for} ${audience}`);
  const tone = clean(settings.tone);
  if (tone && !/^(?:general|default|document[- ]derived)$/iu.test(tone)) details.push(`${tone} ${copy.tone}`);
  const count = Number(candidate.itemCount ?? settings.item_count);
  if (Number.isSafeInteger(count) && count > 1 && ["slides", "storyboard", "video"].includes(kind)) {
    const unit = kind === "slides" ? count === 1 ? copy.slide : copy.slides : kind === "storyboard" ? count === 1 ? copy.frame : copy.frames : count === 1 ? copy.scene : copy.scenes;
    details.push(`${new Intl.NumberFormat(locale).format(count)} ${unit}`);
  }
  const intent = boundedIntent(candidate.summary, maximum);
  if (intent && key(intent) !== key(title) && details.length < 2) details.push(intent);
  const distinct = [...new Map(details.filter((value) => key(value) !== key(title)).map((value) => [key(value), value])).values()].slice(0, 2);
  const source = clean(candidate.sourceSurface);
  const sourceLabel = source.startsWith("workflow:") ? copy.workflow
    : /assistant|chat/iu.test(source) ? copy.assistant
      : /canvas/iu.test(source) ? copy.canvas
        : candidate.productionMode === "managed" || settings.production_mode === "managed" ? copy.managed : "";
  return { details: distinct, intent, sourceLabel };
}

type ScopedOutputDisplay = NonNullable<OutputPresentation["displayScope"]>;
type DisplayLabel = { key: string; label: string };

// Compare presentation only. Authored titles and exact object identities are never rewritten.
const displayCollisionKey = (value: string) => value.replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const scopedOutputKey = (candidate: OutputNamingCandidate) => JSON.stringify([candidate.documentId ?? "", kindOf(candidate), candidate.id]);
const outputTitle = (value: OutputPresentation) => value.disambiguator ? value.disambiguator + " — " + value.title : value.title;

function qualifyDisplayCollisions(rows: readonly DisplayLabel[], format: (number: number) => string) {
  const unique = [...new Map(rows.map(row => [row.key, row])).values()];
  const groups = new Map<string, DisplayLabel[]>();
  for (const row of unique) { const key = displayCollisionKey(row.label); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const ranks = new Map<string, number>();
  for (const group of groups.values()) [...group].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    .forEach((row, index) => ranks.set(row.key, index + 1));
  const qualifiers = new Map<string, string>();
  const label = (row: DisplayLabel) => row.label + (qualifiers.has(row.key) ? " · " + qualifiers.get(row.key) : "");
  // A composed qualifier can itself equal another authored name. Recheck the
  // final text, adding a qualifier only to newly colliding exact identities.
  for (let remaining = unique.length; remaining > 0; remaining--) {
    const composed = new Map<string, DisplayLabel[]>();
    for (const row of unique) { const key = displayCollisionKey(label(row)); composed.set(key, [...(composed.get(key) ?? []), row]); }
    const next = [...composed.values()].filter(group => group.length > 1).flat().filter(row => !qualifiers.has(row.key));
    if (!next.length) break;
    for (const row of next) qualifiers.set(row.key, format(ranks.get(row.key)!));
  }
  return new Map(unique.map(row => [row.key, { label: label(row), qualifier: qualifiers.get(row.key) ?? "" }]));
}

function scopedOutputPresentations(candidates: readonly OutputNamingCandidate[], presentations: OutputPresentation[], options: OutputNamingOptions): OutputPresentation[] {
  const scope = options.scopedLabels!;
  const documents = new Set(scope.documents.map(document => document.id));
  const peers = [...new Map([...(options.peers ?? candidates).filter(candidate => documents.has(candidate.documentId ?? "")), ...candidates]
    .map(candidate => [scopedOutputKey(candidate), candidate])).values()];
  const described = describeOutputs(peers, { ...options, peers, scopedLabels: undefined });
  const documentLabels = qualifyDisplayCollisions(scope.documents.map(document => ({ key: document.id, label: document.title })), scope.formatDocument);
  const titles = new Map<string, number>();
  const rows = peers.map((candidate, index) => {
    const key = scopedOutputKey(candidate), title = outputTitle(described[index]!);
    titles.set(displayCollisionKey(title), (titles.get(displayCollisionKey(title)) ?? 0) + 1);
    const documentTitle = documentLabels.get(candidate.documentId ?? "")?.label ?? candidate.documentId ?? "";
    return { key, title, documentTitle, label: [title, documentTitle].filter(Boolean).join(" · ") };
  });
  const labels = qualifyDisplayCollisions(rows, scope.formatResult), isolate = (value: string) => "\u2068" + value + "\u2069";
  const scoped = new Map<string, ScopedOutputDisplay>(rows.map(row => {
    const qualifier = labels.get(row.key)?.qualifier ?? "";
    return [row.key, { key: row.key, title: row.title, documentTitle: row.documentTitle, qualifier,
      context: [row.title, row.documentTitle, qualifier].filter(Boolean).map(isolate).join(" · "),
      showDocument: (titles.get(displayCollisionKey(row.title)) ?? 0) > 1 || Boolean(qualifier) }];
  }));
  return presentations.map((presentation, index) => ({ ...presentation, displayScope: scoped.get(scopedOutputKey(candidates[index]!))! }));
}

/** Describe immutable generation takes without confusing them with edited-content revisions. */
export function describeOutputs(candidates: readonly OutputNamingCandidate[], options: OutputNamingOptions = {}): OutputPresentation[] {
  const locale = options.locale || "en", copy = copyFor(locale), peers = options.peers ?? candidates;
  const events = options.events ?? [], eventDates = new Map(events.map((event) => [event.eventId, event.occurredAt]));
  const creations = new Map<string, Creation>();
  const add = (creation: Creation, historical = false) => {
    const identifier = `${groupOf(creation.documentId, creation.kind)}\u0000${creation.id}`;
    const previous = creations.get(identifier);
    if (!previous || historical && (creation.sequence < previous.sequence || creation.sequence === previous.sequence && creation.index < previous.index)) creations.set(identifier, creation);
  };
  for (const creation of historicalCreations(events)) add(creation, true);
  for (const peer of peers) add({ id: peer.id, documentId: peer.documentId ?? "", kind: kindOf(peer), sequence: peer.sequence, index: 0 });
  for (const candidate of candidates) add({ id: candidate.id, documentId: candidate.documentId ?? "", kind: kindOf(candidate), sequence: candidate.sequence, index: 0 });

  const populations = new Map<string, Creation[]>();
  for (const creation of creations.values()) {
    const group = groupOf(creation.documentId, creation.kind);
    populations.set(group, [...(populations.get(group) ?? []), creation]);
  }
  for (const entries of populations.values()) entries.sort((left, right) => left.sequence - right.sequence || left.index - right.index || left.id.localeCompare(right.id));

  const presentations = candidates.map((candidate) => {
    const kind = kindOf(candidate), documentId = candidate.documentId ?? "";
    const kindLabel = options.formatKind?.(kind) ?? (kind === "image" ? copy.image : documentArtifactDefinition(kind).label);
    const authored = clean(candidate.customTitle) || (candidate.titleSource === "authored" ? clean(candidate.title) : "");
    const title = authored || clean(candidate.title) || kindLabel;
    const population = populations.get(groupOf(documentId, kind)) ?? [];
    const ordinal = Math.max(1, population.findIndex((entry) => entry.id === candidate.id) + 1), total = Math.max(1, population.length);
    const take = options.formatTake?.(ordinal) ?? `${copy.take} ${new Intl.NumberFormat(locale).format(ordinal)}`;
    const sameTitleCount = peers.filter((peer) => (peer.documentId ?? "") === documentId && kindOf(peer) === kind && key(peer.customTitle ?? peer.title ?? kindLabel) === key(title)).length;
    const disambiguator = total > 1 || options.alwaysIncludeTake ? take : "";
    const createdAt = clean(candidate.createdAt) || eventDates.get(candidate.sourceEventId ?? "") || null;
    const { details, intent, sourceLabel } = semanticDetails(candidate, locale, title, options.maxSummaryLength ?? 72);
    const secondary = [options.includeKind ? kindLabel : "", ...details, options.includeTimestamp ? formattedDate(createdAt, locale, options.timeZone) : "", sourceLabel]
      .filter((value, index, values) => Boolean(value) && values.findIndex((other) => key(other) === key(value)) === index);
    const secondaryLabel = secondary.join(" · ");
    const identity = disambiguator ? `${disambiguator} — ${title}` : title;
    return {
      id: candidate.id,
      title,
      label: `${identity}${secondaryLabel ? ` · ${secondaryLabel}` : ""}`,
      secondaryLabel,
      kindLabel,
      description: [kindLabel, intent].filter(Boolean).join(" · "),
      intent,
      version: ordinal,
      variantCount: Math.max(1, sameTitleCount),
      ordinal,
      total,
      createdAt,
      sourceLabel,
      isCustomTitle: Boolean(authored),
      disambiguator,
    };
  });
  return options.scopedLabels ? scopedOutputPresentations(candidates, presentations, options) : presentations;
}

export function describeOutput(candidate: OutputNamingCandidate, peers: readonly OutputNamingCandidate[], options: OutputNamingOptions = {}): OutputPresentation {
  return describeOutputs([candidate], { ...options, peers })[0]!;
}

export function outputDisplayName(candidate: OutputNamingCandidate, peers: readonly OutputNamingCandidate[], options: OutputNamingOptions = {}) {
  return describeOutput(candidate, peers, options).label;
}
