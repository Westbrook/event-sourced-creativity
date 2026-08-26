import type { DocumentArtifactKind } from "./document-artifacts.ts";

export type DocumentOutputIntentBlock = {
  type: string;
  properties: Record<string, unknown>;
  removed?: boolean;
};

const mediumPatterns: ReadonlyArray<readonly [DocumentArtifactKind, RegExp]> = [
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
