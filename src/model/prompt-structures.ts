import { normalizeSpatialScope } from "./spatial-scope.ts";
import { documentImageFormat, imageAspectRatioLabel, imageOrientationLabel } from "./image-format.ts";

export const PROMPT_TECHNIQUES = ["prose", "bullets", "json", "xml"] as const;
export type PromptTechnique = typeof PROMPT_TECHNIQUES[number];
export type PromptPreferenceScope = "document" | "collection" | "project" | "account";
export const IMAGE_PROMPT_MAX_CHARACTERS = 32_000;

export type BoundedPromptRepresentation = {
  prompt: string;
  originalLength: number;
  finalLength: number;
  compacted: boolean;
  fits: boolean;
  limit: number;
};

export const PROMPT_TECHNIQUE_DEFINITIONS: ReadonlyArray<{ id: PromptTechnique; label: string; shortLabel: string; description: string }> = [
  { id: "prose", label: "Prose", shortLabel: "Prose", description: "The current narrative prompt, with creative direction, constraints, and spatial instructions in paragraphs." },
  { id: "bullets", label: "Prose as bullets", shortLabel: "Bullets", description: "The same realities separated into readable, independently addressable instructions." },
  { id: "json", label: "Structured JSON", shortLabel: "JSON", description: "A stable machine-readable generation object with references, layout regions, and prompt settings." },
  { id: "xml", label: "XML node set", shortLabel: "XML", description: "A stable node hierarchy that preserves the same document decisions and relationships." },
];

export type PromptReferenceDescriptor = {
  blockId?: string;
  referenceId?: string;
  label?: string;
  mode?: string;
  mimeType?: string;
  source: "uploaded-reference" | "ideation-preview" | "locked-study";
};

type PromptBlobstruct = {
  kind: "attached_image";
  input_index: number;
  mime_type: string;
  label: string;
  source: string;
  block_id?: string;
  reference_id?: string;
};

type PromptRegion = {
  prompt: string;
  bbox?: { x0: number; x1: number; y0: number; y1: number };
  bbox_ref_image_index?: number;
  color_palette?: Array<{ b: number; g: number; r: number }>;
  corresponding_region_id?: number;
  label?: string;
  locked?: number;
  looseness?: number;
  parent?: string;
  point?: { x: number; y: number };
  prev_bbox?: { x0: number; x1: number; y0: number; y1: number };
  reference_images?: PromptBlobstruct[];
  region_type?: string;
  subject?: number;
};

type PromptLayout = { height?: number; overall_prompt?: string; regions?: PromptRegion[]; width?: number };

export type StructuredImagePrompt = {
  operation: string;
  prompt: string;
  aspect_ratio?: string;
  disable_search?: number;
  intermediate_image_steps?: number[];
  preview_interval_seconds?: number;
  reference_images?: Array<{ image?: PromptBlobstruct; layout?: PromptLayout; prompt?: string }>;
  resolution?: string;
  seed?: number;
  streaming?: number;
  style_embedding?: number[];
  use_reference_images?: number;
  user_edited_layout?: PromptLayout;
};

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown) => Array.isArray(value) ? value : [];
const clamp = (value: unknown, fallback = 0) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : fallback));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

export function normalizePromptTechnique(value: unknown): PromptTechnique {
  return PROMPT_TECHNIQUES.includes(value as PromptTechnique) ? value as PromptTechnique : "prose";
}

export function promptTechniqueDefinition(value: unknown) {
  const technique = normalizePromptTechnique(value);
  return PROMPT_TECHNIQUE_DEFINITIONS.find((item) => item.id === technique)!;
}

const factLabel = (fact: Record<string, unknown>) => {
  const properties = record(fact.properties);
  return String(properties.text ?? properties.label ?? fact.handle ?? fact.type ?? "decision");
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function buildSpatialPromptDirectives(snapshot: Record<string, unknown>) {
  const facts = list(snapshot.facts).map(record);
  const subjectFor = (id: string) => factLabel(facts.find((fact) => String(fact.block_id ?? "") === id) ?? {});
  return facts.map((fact) => {
    const properties = record(fact.properties); const scope = normalizeSpatialScope(properties.spatial_scope); const decision = `${String(fact.role ?? fact.type ?? "decision")} “${factLabel(fact)}”`;
    if (fact.active === false) return `- Do not apply ${decision}; this block is inactive and is included only for provenance.`;
    let target = "across the entire image";
    if (scope.kind === "region") target = scope.region === "custom" ? `in the implied area described as “${scope.instruction || "custom area"}”` : `in the ${scope.region} area`;
    if (scope.kind === "aabb" && scope.aabb) target = `inside the document-relative rectangle at left ${percent(scope.aabb.x)}, top ${percent(scope.aabb.y)}, width ${percent(scope.aabb.width)}, height ${percent(scope.aabb.height)}`;
    if (scope.kind === "subject") target = `${scope.subject_relation?.replaceAll("-", " ")} the subject “${subjectFor(scope.subject_block_id ?? "")}”`;
    if (scope.kind === "path") target = `inside the document-relative clipping path ${JSON.stringify(scope.path ?? [])}`;
    if (scope.polarity === "outside" && scope.kind !== "document") target = `everywhere outside ${target.replace(/^inside /, "").replace(/^in /, "")}`;
    return `- Apply ${decision} ${target}; use a ${scope.falloff} transition with ${percent(scope.feather)} feather. Intent: ${String(fact.intent ?? "include")}; influence: ${percent(Number(properties.weight ?? .5))}.`;
  });
}

export function buildReferencePromptDirectives(references: PromptReferenceDescriptor[]) {
  if (!references.length) return "No source-image pixels are attached. Use only the compiled text context.";
  return references.map((reference, index) => {
    if (reference.source === "ideation-preview") return `- Image ${index + 1} is the selected working draft. Refine it into the requested result while preserving the creative progress it represents.`;
    if (reference.source === "locked-study") return `- Image ${index + 1} is an accepted ${reference.label || "creative study"}. Preserve its established identity and defining decisions while composing the larger image.`;
    const policies: Record<string, string> = {
      preserve_composition: "Preserve the reference image's composition and spatial organization while applying the document's other decisions.",
      preserve_subject: "Preserve the identity and recognizable features of its subject while applying the document's other decisions.",
      preserve_style: "Use its visual style and material language without copying unrelated content.",
      inspiration: "Use it as visual inspiration while allowing the document to determine the result.",
    };
    return `- Image ${index + 1}, “${reference.label || reference.referenceId || reference.blockId || "uploaded reference"}”, is an opted-in uploaded reference. ${policies[String(reference.mode ?? "inspiration")] ?? policies.inspiration}`;
  }).join("\n");
}

function activeCreativeContext(snapshot: Record<string, unknown>) {
  const activeFacts = list(snapshot.facts).map(record).filter((fact) => fact.active !== false).map((fact) => ({
    block_id: fact.block_id, type: fact.type, role: fact.role, intent: fact.intent, effect: fact.effect, handle: fact.handle,
    authority: fact.authority, properties: fact.properties,
  }));
  const activeIds = new Set(activeFacts.map((fact) => String(fact.block_id ?? "")));
  const relationships = list(snapshot.relationships).map(record).filter((relation) => activeIds.has(String(relation.from_block_id ?? "")) && activeIds.has(String(relation.to_block_id ?? ""))).map((relation) => ({
    relation_id: relation.relation_id, from_block_id: relation.from_block_id, to_block_id: relation.to_block_id, kind: relation.kind, properties: relation.properties,
  }));
  return { facts: activeFacts, relationships, pins: list(snapshot.pins), standing_constraints: list(snapshot.standing_constraints), document: snapshot.document };
}

export function buildProsePrompt(snapshot: Record<string, unknown>, direction: Record<string, unknown>, references: PromptReferenceDescriptor[] = []) {
  const spatialDirectives = buildSpatialPromptDirectives(snapshot); const imageFormat = documentImageFormat(snapshot).format;
  return [
    `Create one polished ${imageOrientationLabel(imageFormat)} image that realizes the supplied creative direction.`,
    `Output frame: ${imageFormat.dimensions.width} × ${imageFormat.dimensions.height} pixels at ${imageAspectRatioLabel(imageFormat)}. Treat the ratio and intended production dimensions as binding document constraints.`,
    "Use every active block field in the document context as binding art direction, including subtype, influence, intent, reference-derived findings, spatial scope, and typed relationships. Ignore blocks marked active false. A relationship says how the target block supports the source block—for example, subject_reference pixels describe the subject while style_reference pixels guide treatment. Preserve the intended subject, environment, composition, lighting, style, material, mood, and palette relationships.",
    "Any fact with intent avoid or prohibit, effect must_not_include, or role exclusion is a negative constraint. Never promote that content into a subject, theme, focal point, text, or visual motif.",
    "Spatial scopes are document-normalized. Apply each decision only to its stated target. Inside/outside polarity, hard/soft/contextual falloff, feather, subject relationships, rectangles, and custom paths are requirements—not metadata or suggestions.",
    "Do not add typography, logos, watermarks, UI chrome, captions, borders, contact sheets, or explanatory annotations unless the authored context explicitly requires them.",
    `Attached source-image policy:\n${buildReferencePromptDirectives(references)}`,
    `Spatial application map:\n${spatialDirectives.length ? spatialDirectives.join("\n") : "- No active block decisions were supplied."}`,
    `Creative direction:\n${JSON.stringify(direction)}`,
    `Active creative context:\n${JSON.stringify(activeCreativeContext(snapshot))}`,
  ].join("\n\n");
}

export function buildBulletPrompt(snapshot: Record<string, unknown>, direction: Record<string, unknown>, references: PromptReferenceDescriptor[] = []) {
  const context = activeCreativeContext(snapshot); const facts = context.facts.map(record); const relationships = context.relationships.map(record); const imageFormat = documentImageFormat(snapshot).format;
  const factLines = facts.map((fact, index) => {
    const properties = record(fact.properties); const scope = normalizeSpatialScope(properties.spatial_scope);
    const propertyLines=Object.entries(properties).filter(([key])=>key!=="spatial_scope"&&key!=="weight").map(([key,value])=>`  - ${key.replaceAll("_"," ")}: ${typeof value==="string"?value:JSON.stringify(value)}`);
    return [`- Decision ${index + 1} — ${String(fact.role ?? fact.type ?? "decision")}: ${factLabel(fact)}. Intent: ${String(fact.intent ?? "include")}. Effect: ${String(fact.effect ?? "include")}. Influence: ${percent(Number(properties.weight ?? .5))}. Authority: ${String(fact.authority ?? "authored")}. Applies to: ${scope.kind === "document" ? "the whole image" : buildSpatialPromptDirectives({ facts: [fact] })[0].replace(/^- Apply .*? (across|inside|in|everywhere|around|behind|in front of)/, "$1")}`,...propertyLines].join("\n");
  });
  const relationshipLines = relationships.map((relation, index) => `- Relationship ${index + 1}: ${String(relation.from_block_id)} is connected to ${String(relation.to_block_id)} as ${String(relation.kind ?? "visual evidence")}. Treat the target as support for the source, not as a competing subject.`);
  const constraintLines = list(context.standing_constraints).map(record).map((constraint, index) => `- Standing constraint ${index + 1}: ${String(constraint.axis ?? "preference")} ${String(constraint.polarity ?? "")}: ${String(constraint.value ?? "")}.`);
  return [
    "Create one polished image from the following independently addressable instructions.",
    "Global requirements:",
    `- Output frame: ${imageFormat.dimensions.width} × ${imageFormat.dimensions.height} pixels at ${imageAspectRatioLabel(imageFormat)}. Preserve this framing throughout generation.`,
    "- Honor every active instruction, its role, intent, influence, relationships, and local application area.",
    "- Treat avoid, prohibit, must_not_include, and exclusion instructions only as negative constraints.",
    "- Do not add typography, logos, watermarks, UI, borders, contact sheets, captions, or annotations unless explicitly requested.",
    "Creative direction:",
    ...Object.entries(direction).map(([key, value]) => `- ${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join("; ") : String(value)}`),
    "Document decisions:", ...(factLines.length ? factLines : ["- No active document decisions were supplied."]),
    "Relationships:", ...(relationshipLines.length ? relationshipLines : ["- No typed block relationships were supplied."]),
    "Standing constraints:", ...(constraintLines.length ? constraintLines : ["- No standing constraints were supplied."]),
    "Attached source images:", ...buildReferencePromptDirectives(references).split("\n"),
  ].join("\n");
}

const parseColor = (value: unknown) => {
  const hex = String(value).trim().replace(/^#/, ""); if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16) };
};

const scopeBox = (scope: ReturnType<typeof normalizeSpatialScope>) => {
  if (scope.kind === "aabb" && scope.aabb) return { x0: round(scope.aabb.x), x1: round(scope.aabb.x + scope.aabb.width), y0: round(scope.aabb.y), y1: round(scope.aabb.y + scope.aabb.height) };
  const regionBoxes: Record<string, [number, number, number, number]> = { left: [0, 0, .5, 1], right: [.5, 0, 1, 1], top: [0, 0, 1, .5], bottom: [0, .5, 1, 1], center: [.25, .25, .75, .75], foreground: [0, .55, 1, 1], background: [0, 0, 1, .55], edges: [0, 0, 1, 1] };
  if (scope.kind === "region" && scope.region && regionBoxes[scope.region]) { const [x0, y0, x1, y1] = regionBoxes[scope.region]; return { x0, x1, y0, y1 }; }
  if (scope.kind === "path" && scope.path?.length) { const xs = scope.path.map((point) => point.x); const ys = scope.path.map((point) => point.y); return { x0: round(Math.min(...xs)), x1: round(Math.max(...xs)), y0: round(Math.min(...ys)), y1: round(Math.max(...ys)) }; }
  return undefined;
};

function attachedBlob(reference: PromptReferenceDescriptor, index: number): PromptBlobstruct {
  return { kind: "attached_image", input_index: index, mime_type: reference.mimeType || "image/*", label: reference.label || reference.referenceId || reference.blockId || `Reference ${index + 1}`, source: reference.source, ...(reference.blockId ? { block_id: reference.blockId } : {}), ...(reference.referenceId ? { reference_id: reference.referenceId } : {}) };
}

export function buildStructuredPrompt(snapshot: Record<string, unknown>, direction: Record<string, unknown>, references: PromptReferenceDescriptor[] = [], options: { size?: string; quality?: string; partialImages?: number } = {}): StructuredImagePrompt {
  const targetFormat = documentImageFormat(snapshot).format; const width = targetFormat.dimensions.width; const height = targetFormat.dimensions.height; const facts = list(snapshot.facts).map(record).filter((fact) => fact.active !== false); const blobs = references.map(attachedBlob);
  const regions = facts.map((fact, index): PromptRegion => {
    const properties = record(fact.properties); const scope = normalizeSpatialScope(properties.spatial_scope); const bbox = scopeBox(scope); const colors = list(properties.colors).map(parseColor).filter((color): color is NonNullable<typeof color> => Boolean(color)); const referenceIndexes = references.map((reference, referenceIndex) => reference.blockId === String(fact.block_id ?? "") ? referenceIndex : -1).filter((referenceIndex) => referenceIndex >= 0);
    const path = scope.kind === "path" ? ` Clipping path: ${JSON.stringify(scope.path ?? [])}.` : "";
    const additionalProperties=Object.fromEntries(Object.entries(properties).filter(([key])=>!["text","label","subtype","weight","spatial_scope","colors"].includes(key)));
    const subtype=properties.subtype?` Subtype ${String(properties.subtype)}.`:"";const additional=Object.keys(additionalProperties).length?` Additional properties: ${JSON.stringify(additionalProperties)}.`:"";
    return {
      prompt: `${String(fact.role ?? fact.type ?? "decision")}: ${factLabel(fact)}.${subtype} Intent ${String(fact.intent ?? "include")}; effect ${String(fact.effect ?? "include")}; influence ${percent(Number(properties.weight ?? .5))}; ${scope.polarity} ${scope.kind} scope with ${scope.falloff} falloff and ${percent(scope.feather)} feather.${path}${additional}`,
      ...(bbox ? { bbox, prev_bbox: bbox, point: { x: round((bbox.x0 + bbox.x1) / 2), y: round((bbox.y0 + bbox.y1) / 2) } } : {}),
      ...(referenceIndexes.length ? { bbox_ref_image_index: referenceIndexes[0], reference_images: referenceIndexes.map((referenceIndex) => blobs[referenceIndex]) } : {}),
      ...(colors.length ? { color_palette: colors } : {}), corresponding_region_id: index, label: String(fact.handle ?? `${fact.type ?? "decision"}-${index + 1}`), locked: fact.locked ? 1 : 0,
      looseness: round(1 - clamp(properties.weight, .5)), ...(scope.kind === "subject" && scope.subject_block_id ? { parent: scope.subject_block_id } : {}), region_type: scope.kind === "document" ? "global" : scope.kind, subject: String(fact.type ?? fact.role) === "subject" ? 1 : 0,
    };
  });
  const context=activeCreativeContext(snapshot);const relationships=context.relationships.map(record).map((relation)=>`${String(relation.from_block_id)} ${String(relation.kind??"relates to")} ${String(relation.to_block_id)}${Object.keys(record(relation.properties)).length?` with ${JSON.stringify(relation.properties)}`:""}`).join("; ");const constraints=context.standing_constraints.map(record).map((constraint)=>`${String(constraint.axis??"preference")} ${String(constraint.polarity??"")} ${String(constraint.value??"")}`).join("; ");const pins=context.pins.map(String).join(", ");
  const prompt = `Create one polished image. ${Object.entries(direction).map(([key, value]) => `${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(". ")}. Typed relationships: ${relationships||"none"}. Standing constraints: ${constraints||"none"}. Pinned evidence: ${pins||"none"}. Honor negative intent, typed relationships, local regions, and reference-image policy.`;
  const layout: PromptLayout = { width: Number.isFinite(width) ? width : undefined, height: Number.isFinite(height) ? height : undefined, overall_prompt: `${prompt} Coordinates are document-normalized from 0 to 1.`, regions };
  return {
    operation: "generate_image", prompt, aspect_ratio: imageAspectRatioLabel(targetFormat),
    disable_search: 1, ...(options.partialImages ? { intermediate_image_steps: Array.from({ length: options.partialImages }, (_, index) => index + 1), preview_interval_seconds: 2 } : {}),
    reference_images: references.map((reference, index) => ({ image: blobs[index], prompt: buildReferencePromptDirectives([reference]).replace(/^- /, "") })), resolution: `${width}x${height}`,
    streaming: options.partialImages ? 1 : 0, use_reference_images: references.length ? 1 : 0, user_edited_layout: layout,
  };
}

const xmlEscape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const xmlName = (value: string) => value.replaceAll("_", "-");
function xmlNodes(value: unknown, key: string, depth: number): string[] {
  const pad = "  ".repeat(depth); const name = xmlName(key);
  if (Array.isArray(value)) return value.length ? [`${pad}<${name}>`, ...value.flatMap((item, index) => typeof item === "object" && item !== null ? [`${pad}  <item index="${index}">`, ...Object.entries(item as Record<string, unknown>).flatMap(([childKey, child]) => xmlNodes(child, childKey, depth + 2)), `${pad}  </item>`] : [`${pad}  <item index="${index}">${xmlEscape(item)}</item>`]), `${pad}</${name}>`] : [`${pad}<${name} />`];
  if (value && typeof value === "object") return [`${pad}<${name}>`, ...Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) => xmlNodes(child, childKey, depth + 1)), `${pad}</${name}>`];
  if (value === undefined) return [];
  return [`${pad}<${name}>${xmlEscape(value)}</${name}>`];
}

export function buildXmlPrompt(snapshot: Record<string, unknown>, direction: Record<string, unknown>, references: PromptReferenceDescriptor[] = [], options: { size?: string; quality?: string; partialImages?: number } = {}) {
  const structured = buildStructuredPrompt(snapshot, direction, references, options);
  const context = activeCreativeContext(snapshot);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<image-generation-prompt schema-version="1">',
    ...Object.entries(structured).flatMap(([key, value]) => xmlNodes(value, key, 1)),
    ...xmlNodes(context.relationships, "document_relationships", 1),
    ...xmlNodes(context.standing_constraints, "standing_constraints", 1),
    '</image-generation-prompt>',
  ].join("\n");
}

export function buildPromptRepresentation(technique: PromptTechnique, snapshot: Record<string, unknown>, direction: Record<string, unknown>, references: PromptReferenceDescriptor[] = [], options: { size?: string; quality?: string; partialImages?: number } = {}) {
  if (technique === "bullets") return buildBulletPrompt(snapshot, direction, references);
  if (technique === "json") return JSON.stringify(buildStructuredPrompt(snapshot, direction, references, options), null, 2);
  if (technique === "xml") return buildXmlPrompt(snapshot, direction, references, options);
  return buildProsePrompt(snapshot, direction, references);
}

const compactPromptWhitespace=(technique:PromptTechnique,prompt:string)=>technique==="json"?JSON.stringify(JSON.parse(prompt)):technique==="xml"?prompt.replace(/>\s+</g,"><"):prompt;
const fitString=(value:string,limit:number)=>value.length<=limit?value:`${value.slice(0,Math.max(0,limit-38))}…[${value.length-limit} characters compacted]`;
const fitPromptValue=(value:unknown,stringLimit:number):unknown=>{
  if(typeof value==="string")return fitString(value,stringLimit);
  if(Array.isArray(value))return value.map((item)=>fitPromptValue(item,stringLimit));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,fitPromptValue(item,stringLimit)]));
  return value;
};

/**
 * Prepare an Image API prompt without letting presentation whitespace or a few
 * unusually verbose fields turn a valid creative document into a provider
 * validation failure. Every key and array member is retained; only oversized
 * string leaves are explicitly marked and shortened as a last resort.
 */
export function buildBoundedPromptRepresentation(technique:PromptTechnique,snapshot:Record<string,unknown>,direction:Record<string,unknown>,references:PromptReferenceDescriptor[]=[],options:{size?:string;quality?:string;partialImages?:number}={},limit=IMAGE_PROMPT_MAX_CHARACTERS):BoundedPromptRepresentation{
  const original=buildPromptRepresentation(technique,snapshot,direction,references,options);const originalLength=original.length;
  if(originalLength<=limit)return{prompt:original,originalLength,finalLength:originalLength,compacted:false,fits:true,limit};
  const whitespaceCompacted=compactPromptWhitespace(technique,original);
  if(whitespaceCompacted.length<=limit)return{prompt:whitespaceCompacted,originalLength,finalLength:whitespaceCompacted.length,compacted:true,fits:true,limit};
  let candidate=whitespaceCompacted;
  for(const stringLimit of [2048,1024,512,256,128,64]){
    candidate=compactPromptWhitespace(technique,buildPromptRepresentation(technique,fitPromptValue(snapshot,stringLimit) as Record<string,unknown>,fitPromptValue(direction,stringLimit) as Record<string,unknown>,fitPromptValue(references,stringLimit) as PromptReferenceDescriptor[],options));
    if(candidate.length<=limit)return{prompt:candidate,originalLength,finalLength:candidate.length,compacted:true,fits:true,limit};
  }
  return{prompt:candidate,originalLength,finalLength:candidate.length,compacted:true,fits:false,limit};
}

export function effectivePromptPreference(preferences: Array<Record<string, unknown>>, context: { documentId: string; collectionIds: string[]; projectId: string; accountId?: string }) {
  const candidates = preferences.filter((preference) => preference.preference_kind === "prompt_technique" && !preference.revoked).filter((preference) => {
    const scope = String(preference.scope); const scopeId = String(preference.scope_id ?? "");
    return scope === "document" ? scopeId === context.documentId : scope === "collection" ? context.collectionIds.includes(scopeId) : scope === "project" ? scopeId === context.projectId : scope === "account";
  });
  const rank: Record<string, number> = { account: 1, project: 2, collection: 3, document: 4 };
  const selected = candidates.sort((left, right) => (rank[String(right.scope)] ?? 0) - (rank[String(left.scope)] ?? 0) || Number(right.authored_sequence ?? 0) - Number(left.authored_sequence ?? 0))[0];
  return { technique: normalizePromptTechnique(selected?.technique), preference: selected ?? null };
}
