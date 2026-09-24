import type { DocumentArtifactKind } from "./document-artifacts.ts";

export type DocumentOutputIntentBlock = {
  type: string;
  subtype?: string;
  properties: Record<string, unknown>;
  removed?: boolean;
  active?: boolean;
};

/** Output preferences do not make a Document exclusive to one medium. */
export const OUTPUT_KINDS = ["image", "short_story", "scene", "slides", "storyboard", "video", "audio", "model3d"] as const;
export type OutputKind = "image" | DocumentArtifactKind;
export const OUTPUT_KIND_LABELS: Readonly<Record<OutputKind, string>> = {
  image: "Image", short_story: "Short story", scene: "Scene", slides: "Slides",
  storyboard: "Storyboard", video: "Video", audio: "Audio", model3d: "3D model",
};
export const isOutputKind = (value: unknown): value is OutputKind =>
  typeof value === "string" && (OUTPUT_KINDS as readonly string[]).includes(value);

const negativePreference = (properties: Record<string, unknown>) =>
  [properties.intent, properties.effect, properties.authority].some(value =>
    /^(?:avoid|prohibit(?:ed)?|exclude(?:d)?|exclusion|negative|forbid(?:den)?|deny|denied|reject(?:ed)?)$/iu.test(String(value ?? "").trim()));

const preferenceHeading = /^Preferred outputs?:\s*([^\n]*)(?:\n|$)/iu;
function visiblePreferenceKinds(text: string): OutputKind[] | null {
  const match = preferenceHeading.exec(text.trim());
  if (!match) return null;
  const names = match[1]!.replace(/\.$/u, "").split(/\s*(?:,|\band\b|&)\s*/iu).filter(Boolean);
  const kinds = names.map(name => OUTPUT_KINDS.find(kind =>
    OUTPUT_KIND_LABELS[kind].toLowerCase() === name.toLowerCase() || kind === name.toLowerCase()));
  return kinds.length && kinds.every(isOutputKind) ? [...new Set(kinds)] : null;
}

export type FormatOutputPreferenceValidation = { valid: boolean; kinds: OutputKind[]; issues: string[] };

/**
 * The explicit visible preference line and protected values form one decision.
 * Arbitrary prose is never inferred into preferences. An edited/translated line
 * that cannot be decoded needs explicit reconciliation before it can be saved.
 */
export function validateFormatOutputPreferences(block: DocumentOutputIntentBlock): FormatOutputPreferenceValidation {
  const p = block.properties;
  if (!Object.hasOwn(p, "preferred_output_kinds")) return { valid: true, kinds: [], issues: [] };
  const issues: string[] = [];
  if (block.type.toLowerCase() !== "format" || (p.subtype ?? block.subtype) !== "Channel" || p.intent !== "prefer")
    issues.push("Output preferences require a Format Idea with Channel subtype and prefer intent.");
  const raw = p.preferred_output_kinds;
  const kinds = Array.isArray(raw) && raw.every(isOutputKind) ? [...new Set(raw)] : [];
  if (!Array.isArray(raw) || !raw.length || kinds.length !== raw.length)
    issues.push("Choose one or more distinct supported Output kinds.");
  const visible = visiblePreferenceKinds(String(p.text ?? ""));
  if (!visible || visible.length !== kinds.length || visible.some(kind => !kinds.includes(kind)))
    issues.push("Reconcile the visible Output preferences with the selected Output kinds before saving.");
  return { valid: issues.length === 0, kinds, issues };
}

/** Explicitly confirmed choices rewrite only the preference line, preserving other authored constraints. */
export function reconcileFormatOutputPreferences(
  block: DocumentOutputIntentBlock, text: string, confirmedKinds: readonly OutputKind[],
): DocumentOutputIntentBlock {
  if (!confirmedKinds.length || !confirmedKinds.every(isOutputKind)) throw new Error("Choose supported Output kinds.");
  const kinds = [...new Set(confirmedKinds)];
  const remaining = text.trim().replace(preferenceHeading, "").trim();
  const body = `Preferred outputs: ${kinds.map(kind => OUTPUT_KIND_LABELS[kind]).join(" and ")}${remaining ? `\n\n${remaining}` : ""}`;
  return { ...block, type: "format", subtype: "Channel", properties: {
    ...block.properties, subtype: "Channel", intent: "prefer", text: body, preferred_output_kinds: kinds,
  } };
}

/** Sole source of preference truth; title/prose inference remains a separate weak legacy suggestion. */
export function preferredDocumentOutputKinds(blocks: readonly DocumentOutputIntentBlock[]): OutputKind[] {
  const result = new Set<OutputKind>();
  for (const block of blocks) {
    if (block.removed || block.active === false || block.properties.active === false
      || Number(block.properties.weight ?? .5) <= 0 || negativePreference(block.properties)) continue;
    const parsed = validateFormatOutputPreferences(block);
    if (parsed.valid) for (const kind of parsed.kinds) result.add(kind);
  }
  return [...result];
}

export function documentOutputPreferenceSummary(blocks: readonly DocumentOutputIntentBlock[]): string {
  const kinds = preferredDocumentOutputKinds(blocks);
  return kinds.length ? `Prefers ${kinds.map(kind => OUTPUT_KIND_LABELS[kind]).join(", ")}` : "";
}

/** Preferred available choices first; unavailable preferences remain visible, with every alternative retained. */
export function preferredOutputChoices(blocks: readonly DocumentOutputIntentBlock[], availableKinds: readonly OutputKind[]) {
  const preferred = preferredDocumentOutputKinds(blocks), available = [...new Set(availableKinds.filter(isOutputKind))];
  return [...preferred.filter(kind => available.includes(kind)), ...available.filter(kind => !preferred.includes(kind)),
    ...preferred.filter(kind => !available.includes(kind))].map(kind => ({
    kind, label: `${OUTPUT_KIND_LABELS[kind]}${!available.includes(kind) ? " · Unavailable" : ""}`,
    preferred: preferred.includes(kind), available: available.includes(kind),
  }));
}

const mediumPatterns: ReadonlyArray<readonly [DocumentArtifactKind, RegExp]> = [
  ["model3d", /\b(?:model3d|(?:text|image)[\s-]*to[\s-]*3[\s-]*d|(?:3[\s-]*d|three[\s-]+dimensional)[\s-]+(?:models?|assets?|mesh(?:es)?|objects?))\b/iu],
  ["storyboard", /\b(?:story\s*board|shot\s*list|frame\s*sequence|visual\s*sequence)\b/iu],
  ["slides", /\b(?:slide\s*deck|slide\s*show|slideshow|power\s*point|keynote|presentation|pitch\s*deck|slides?|deck)\b/iu],
  ["video", /\b(?:video|film|motion\s*(?:piece|graphic|design|treatment)|animation|cinematic|reel|movie)\b/iu],
  ["audio", /\b(?:audio|podcast|soundtrack|music|song|spoken\s*word|voice\s*over)\b/iu],
  ["scene", /\b(?:screenplay|film\s*scene|scripted\s*scene|dramatic\s*scene|script|scene)\b/iu],
  ["short_story", /\b(?:short\s*story|written\s*story|written\s*narrative|written\s*document|prose|article|essay|blog\s*post|white\s*paper|brief(?:ing)?|memo(?:randum)?|report|proposal|e\s*-?\s*mail|manuscript|text)\b/iu],
];

function inferTextMedium(text: string, allowPitchFallback = true): DocumentArtifactKind | null {
  let candidate: { kind: DocumentArtifactKind; index: number } | null = null;

  for (const [kind, pattern] of mediumPatterns) {
    const match = pattern.exec(text);
    if (match && (!candidate || match.index < candidate.index)) candidate = { kind, index: match.index };
  }

  return candidate?.kind ?? (allowPitchFallback && /\bpitch(?:ing)?\b/iu.test(text) ? "slides" : null);
}

function readableValues(properties: Record<string, unknown>): string {
  return [
    properties.output_kind,
    properties.outputKind,
    properties.artifact_kind,
    properties.artifactKind,
    properties.medium,
    properties.format,
    properties.output_format,
    properties.outputFormat,
    properties.delivery_format,
    properties.deliveryFormat,
    properties.requested_medium,
    properties.requestedMedium,
    properties.deliverable,
    properties.label,
    properties.text,
    properties.summary,
    properties.description,
    properties.content,
  ].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join("\n");
}

/** Infer an editable output suggestion from currently active authored intent only. */
export function inferDocumentArtifactKind(
  blocks: readonly DocumentOutputIntentBlock[],
  documentTitle = "",
): DocumentArtifactKind | null {
  let selected: { kind: DocumentArtifactKind; priority: number } | null = null;

  for (const block of blocks) {
    if (block.removed || block.properties.active === false || Number(block.properties.weight ?? .5) <= 0) continue;

    const type = block.type.trim().toLowerCase();
    if (["exclusion", "boundary", "constraint", "audience"].includes(type)) continue;

    const label = String(block.properties.label ?? "").trim().toLowerCase();
    const negativeIntent = [block.properties.intent, block.properties.effect, block.properties.authority]
      .some((value) => /^(?:avoid|prohibit(?:ed)?|exclude(?:d)?|exclusion|negative|forbid(?:den)?|deny|denied|reject(?:ed)?)$/iu.test(String(value ?? "").trim()));
    if (negativeIntent || ["exclusion", "boundary", "constraint"].includes(label)) continue;

    const priority = type === "format" || type === "deliverable" || label === "format" || label === "deliverable"
      ? 400
      : type === "direction" || type === "objective" || label === "direction" || label === "objective"
        ? 300
        : type === "message" || type === "text" || label === "message"
          ? 100
          : 0;
    if (!priority || selected && selected.priority >= priority) continue;

    const text = readableValues(block.properties);
    const explicitKind = inferTextMedium(text, false);
    const visualOnly = /\b(?:images?|photos?|photographs?|posters?|illustrations?|headshots?|portraits?|png|jpe?g|svg|webp|visual\s*assets?|cover\s*art)\b/iu.test(text)
      || Boolean(block.properties.image_format ?? block.properties.imageFormat);
    if (!explicitKind && visualOnly && priority >= 300) return null;

    const kind = explicitKind ?? inferTextMedium(text);
    if (kind) selected = { kind, priority };
  }

  if (selected && selected.priority > 200) return selected.kind;
  return inferTextMedium(documentTitle) ?? selected?.kind ?? null;
}
