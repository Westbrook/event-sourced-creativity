import { isBlockKind } from "./block-types.ts";
import { CHARACTER_FIELD_SECTIONS } from "./character-context.ts";
import { isContextCompositionRelation } from "./combined-context.ts";
import { model3dPromptLength, RODIN_MAX_IMAGE_REFERENCES, RODIN_PROMPT_MAX_CHARS } from "./model3d.ts";
import { promptFactIsActive, providerFacingCreativeContext } from "./prompt-policy.ts";

export const MODEL3D_PROMPT_ADAPTER_VERSION = "document-to-rodin-v2.5-2026-09-05";

export type Model3dDocumentAdaptation = {
  prompt: string;
  valid: boolean;
  adapterVersion: string;
  includedBlockIds: string[];
  omittedBlockIds: string[];
  issues: Array<{ code: string; message: string; blockIds: string[] }>;
  suggestions: Array<{ code: string; message: string; blockTypes: string[] }>;
  promptCharacters: number;
};

type Data = Record<string, unknown>;
type Fact = { id: string; type: string; intent: string; properties: Data; required: boolean; negative: boolean };
type Clause = { text: string; blockIds: string[]; required: boolean; priority: number; order: number };
const record = (value: unknown): Data => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const unique = (values: readonly string[]) => [...new Set(values.filter(Boolean))];
const negative = (value: unknown) => typeof value === "string" && /^(?:avoid|prohibit|exclude|exclusion|must_not_include|forbid|negative)$/iu.test(value);
const semanticFields = [
  "label", "text", "instruction", "description", "value", "exact_text", "subject", "shape", "geometry",
  "scale", "dimensions", "proportions", "materials", "material", "texture", "finish", "colors", "palette",
  "style", "wardrobe", "pose", "posture", "expression", "environment", "composition", "motion",
  "camera_direction", "camera", "lens", "lighting", "brand_name", "font_family", "font_weight",
  "safe_area", "accessibility", "contrast", "minimum_contrast", "mood", "emotional_arc", "narrative_purpose",
] as const;
// Only typed creative values are read. Source manifests, receipts, media metadata,
// arbitrary objects and unknown character-profile fields never become prompt JSON.
const structuredFields = ["name", "text", "description", "value", "hex", "color", "material", "texture", "finish", "width", "height", "length", "depth", "x", "y", "z", "unit", "units", "top", "right", "bottom", "left"] as const;
const sourceLocation = /(?:\b(?:https?|file|s3|gs|r2|blob|data):[^\s<>"')\]]+|\/api\/(?:media|content|private-content)\/[^\s<>"')\]]+)/giu;
const priorityFor = (type: string) => ["direction", "material", "palette", "style", "scale", "action", "environment", "composition", "reference", "model3d"].indexOf(type);
const issueMessages = {
  model3d_document_reference_count_invalid: "Choose up to five image references before adapting this document.",
  model3d_document_context_invalid: "The document context could not be read. Refresh the document before generating.",
  model3d_document_required_context_missing: "A required document block has no usable 3D description. Add its authored details before generating.",
  model3d_document_required_context_too_long: "The subject and required document context exceed Rodin’s 1,024-character limit. Shorten the identified blocks before generating.",
  model3d_document_scope_unavailable: "A document instruction has an unavailable target or unsupported scope. Repair its context relationship before generating.",
  model3d_document_prompt_empty: "Add a description to the document or select an image reference before generating a 3D model.",
} as const;

/** Deterministic adaptation of an already-authorized Document snapshot; performs no I/O. */
export function adaptDocumentToModel3d(snapshot: Record<string, unknown>, options: { referenceCount?: number } = {}): Model3dDocumentAdaptation {
  const issues: Model3dDocumentAdaptation["issues"] = [];
  const suggestions: Model3dDocumentAdaptation["suggestions"] = [];
  const addIssue = (code: keyof typeof issueMessages, blockIds: string[] = []) => {
    const ids = unique(blockIds);
    if (!issues.some(issue => issue.code === code && issue.blockIds.join("\0") === ids.join("\0"))) issues.push({ code, message: issueMessages[code], blockIds: ids });
  };
  let removedSourceLocation = false;
  const clean = (value: unknown): string => {
    if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value)) && typeof value !== "boolean") return "";
    return String(value).replace(sourceLocation, () => { removedSourceLocation = true; return "[source omitted]"; }).replace(/\s+/gu, " ").trim();
  };
  const meaningful = (value: string) => Boolean(value.replaceAll("[source omitted]", "").replace(/[\s\p{P}]/gu, ""));
  const scalar = (value: unknown) => {
    const text = clean(value);
    return meaningful(text) ? text : "";
  };
  const values = (value: unknown, depth = 0): { text: string; unsupported: boolean } => {
    if (value === undefined || value === null || value === "") return { text: "", unsupported: false };
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return { text: scalar(value), unsupported: false };
    if (depth > 2) return { text: "", unsupported: true };
    if (Array.isArray(value)) {
      const parts = value.map(item => values(item, depth + 1));
      return { text: unique(parts.map(part => part.text)).join(", "), unsupported: parts.some(part => part.unsupported) };
    }
    const data = record(value);
    const parts = structuredFields.filter(key => Object.hasOwn(data, key)).map(key => {
      const part = values(data[key], depth + 1);
      return { ...part, text: part.text ? key.replaceAll("_", " ") + ": " + part.text : "" };
    });
    return { text: parts.map(part => part.text).filter(Boolean).join(", "), unsupported: !parts.length || parts.some(part => part.unsupported) };
  };
  const description = (fact: Fact) => {
    const properties = record(providerFacingCreativeContext(fact.properties));
    const pieces: string[] = [];
    let unsupported = false;
    for (const field of semanticFields) {
      // A filename or saved asset label alone is not a new authored subject.
      if (field === "label" && ["reference", "model3d", "audio", "sketch"].includes(fact.type)) continue;
      const part = values(properties[field]);
      unsupported ||= part.unsupported;
      if (part.text) pieces.push(["label", "text", "instruction", "description", "value"].includes(field) ? part.text : field.replaceAll("_", " ") + ": " + part.text);
    }
    const profile = record(properties.character_profile);
    for (const section of CHARACTER_FIELD_SECTIONS) for (const field of section.fields) {
      const raw = record(profile[section.id])[field.id];
      if (raw === undefined || raw === null || raw === "") continue;
      if (typeof raw !== "string") { unsupported = true; continue; }
      const text = scalar(raw);
      if (text) pieces.push(field.label + ": " + text);
    }
    return { text: unique(pieces).join("; "), unsupported };
  };
  const source = record(snapshot), rawFacts = source.facts;
  if (source !== snapshot) addIssue("model3d_document_context_invalid");
  if (rawFacts !== undefined && !Array.isArray(rawFacts)) addIssue("model3d_document_context_invalid");
  const facts: Fact[] = [];
  const seenIds = new Set<string>();
  for (const candidate of Array.isArray(rawFacts) ? rawFacts : []) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) { addIssue("model3d_document_context_invalid"); continue; }
    const data = record(candidate), properties = record(data.properties);
    if (!promptFactIsActive(data)) continue;
    const id = typeof data.block_id === "string" ? data.block_id : "";
    if (id && seenIds.has(id)) { addIssue("model3d_document_context_invalid", [id]); continue; }
    if (id) seenIds.add(id);
    const type = typeof data.type === "string" ? data.type : typeof data.role === "string" ? data.role : "";
    // Canonical snapshots use must_not_include for both Avoid and Never.
    // Preserve the authored intent; the derived effect is a legacy fallback.
    const explicitIntent = [data.intent, properties.intent].find(value => typeof value === "string" && /^(?:include|prefer|avoid|prohibit|exclude|forbid|must_not_include|negative)$/iu.test(value));
    const intent = String(explicitIntent ?? [data.effect, properties.effect, properties.polarity].find(negative) ?? "include").toLowerCase();
    const isNegative = type === "exclusion" || negative(intent);
    const required = type === "subject" || isNegative || data.locked === true || data.required === true || data.authority === "locked"
      || properties.locked === true || properties.required === true || properties.authority === "locked";
    facts.push({ id, type, intent, properties, required, negative: isNegative });
  }
  const byId = new Map(facts.filter(fact => fact.id).map(fact => [fact.id, fact]));
  const descriptions = new Map(facts.map(fact => [fact, description(fact)]));
  const relations = (Array.isArray(source.relationships) ? source.relationships : []).map(record);
  const parents = new Map<string, Data[]>();
  for (const relation of relations) {
    if (relation.removed === true || relation.active === false || !isContextCompositionRelation(relation.kind)) continue;
    const id = String(relation.to_block_id ?? "");
    const incoming = parents.get(id);
    if (incoming) incoming.push(relation);
    else parents.set(id, [relation]);
  }
  const targetLabel = (fact: Fact) => {
    const group = record(fact.properties.context_group);
    return scalar(group.target) || scalar(group.name) || scalar(fact.properties.label)
      || scalar(fact.properties.subject) || scalar(fact.properties.text) || scalar(fact.properties.description);
  };
  const scopeFor = (fact: Fact) => {
    const labels: string[] = [], blockIds = [fact.id];
    let invalid = false;
    const membership = (input: Data, fallbackTarget = "", order?: unknown) => {
      const target = scalar(input.target) || scalar(input.name) || fallbackTarget;
      if (!target) { invalid = true; return; }
      const application = input.application ?? "isolate";
      if (!["isolate", "co_locate", "ordered", "recur"].includes(String(application))) { invalid = true; return; }
      const rawOrder = order ?? input.member_order ?? input.memberOrder ?? 0;
      if (application === "ordered" && (!Number.isSafeInteger(rawOrder) || Number(rawOrder) < 0)) { invalid = true; return; }
      labels.push('only for "' + target + '"' + (application === "ordered" ? ", ordered member " + (Number(rawOrder) + 1)
        : application === "co_locate" ? ", keep together" : application === "recur" ? ", recur together" : ""));
    };
    const properties = fact.properties;
    const direct = Array.isArray(properties.combined_context_memberships) ? properties.combined_context_memberships
      : properties.combined_context ? [properties.combined_context] : [];
    for (const raw of direct) membership(record(raw));
    if (!direct.length && properties.context_set_id && (properties.copied_as_context_set === true || properties.reference_set_kind === "storyboard")) {
      membership({ name: properties.context_set_name ?? properties.storyboard_title, application: properties.reference_set_kind === "storyboard" ? "ordered" : "isolate" },
        "", properties.reference_set_kind === "storyboard" ? Number(properties.storyboard_frame_index ?? 1) - 1 : 0);
    }
    // Expand each reachable node once, in the original depth-first order. A
    // converging DAG can have exponentially many paths but only finitely many
    // distinct edges. Apply every edge's membership before skipping a finished
    // ancestor so different member orders retain their first-seen meaning.
    const visitState = new Map<string, "active" | "finished">();
    const pending: Array<{ child: string; nextEdge: number }> = [];
    if (fact.id) {
      visitState.set(fact.id, "active");
      pending.push({ child: fact.id, nextEdge: 0 });
    }
    while (pending.length) {
      const frame = pending[pending.length - 1]!;
      const incoming = parents.get(frame.child) ?? [];
      if (frame.nextEdge === incoming.length) {
        visitState.set(frame.child, "finished");
        pending.pop();
        continue;
      }
      const relation = incoming[frame.nextEdge++]!;
      const parentId = String(relation.from_block_id ?? ""), parent = byId.get(parentId);
      if (!parent || visitState.get(parentId) === "active") { invalid = true; continue; }
      blockIds.push(parentId);
      const group = record(parent.properties.context_group), relationship = record(relation.properties);
      membership(group, targetLabel(parent), relationship.member_order ?? relationship.order);
      if (visitState.has(parentId)) continue;
      visitState.set(parentId, "active");
      pending.push({ child: parentId, nextEdge: 0 });
    }
    const participants = [
      ...(Array.isArray(properties.block_references) ? properties.block_references.map(record) : []),
      ...relations.filter(relation => relation.kind === "action_participant" && relation.from_block_id === fact.id && relation.active !== false && relation.removed !== true)
        .map(relation => ({ block_id: relation.to_block_id, role: record(relation.properties).participant_role })),
    ];
    for (const participant of participants) {
      const role = participant.role;
      if (!["actor", "target", "recipient", "instrument", "location", "counterparty"].includes(String(role))) { invalid = true; continue; }
      const target = byId.get(String(participant.block_id ?? "")), label = target && targetLabel(target);
      if (!target || !label) { invalid = true; continue; }
      blockIds.push(target.id);
      labels.push(String(role) + ': "' + label + '"');
    }
    const spatial = record(properties.spatial_scope), kind = spatial.kind;
    if (kind !== undefined && kind !== "document") {
      const polarity = spatial.polarity === "outside" ? "outside" : "inside";
      const coordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
      if (kind === "subject") {
        const target = byId.get(String(spatial.subject_block_id ?? "")), label = target && targetLabel(target);
        const relation = spatial.subject_relation ?? "around";
        if (!target || !label || !["inside", "around", "in-front-of", "behind"].includes(String(relation))) invalid = true;
        else { blockIds.push(target.id); labels.push(polarity + ' the area ' + String(relation).replaceAll("-", " ") + ' "' + label + '"'); }
      } else if (kind === "region") {
        const region = spatial.region === "custom" ? scalar(spatial.instruction) : ["left", "right", "top", "bottom", "center", "foreground", "background", "edges"].includes(String(spatial.region)) ? String(spatial.region) : "";
        if (!region) invalid = true;
        else labels.push(polarity + " the " + region + " region");
      } else if (kind === "aabb") {
        const box = record(spatial.aabb);
        if (!["x", "y", "width", "height"].every(key => coordinate(box[key]))) invalid = true;
        else labels.push(polarity + " document-normalized rectangle (" + ["x", "y", "width", "height"].map(key => key + "=" + box[key]).join(", ") + ")");
      } else if (kind === "path") {
        const points = Array.isArray(spatial.path) ? spatial.path.map(record) : [];
        if (points.length < 3 || points.some(point => !coordinate(point.x) || !coordinate(point.y))) invalid = true;
        else labels.push(polarity + " document-normalized path (" + points.map(point => point.x + "," + point.y).join("; ") + ")");
      } else invalid = true;
      if (spatial.falloff !== undefined) {
        if (!["hard", "soft", "contextual"].includes(String(spatial.falloff))) invalid = true;
        else labels.push(String(spatial.falloff) + " boundary");
      }
      if (spatial.feather !== undefined) {
        if (!coordinate(spatial.feather)) invalid = true;
        else if (spatial.feather) labels.push("feather " + spatial.feather);
      }
    }
    return { text: unique(labels).join("; "), blockIds: unique(blockIds), invalid };
  };
  const clauses: Clause[] = [];
  let omittedUnsupportedContext = false;
  const hasSubject = facts.some(fact => fact.type === "subject" && !fact.negative && descriptions.get(fact)?.text);
  for (const [order, fact] of facts.entries()) {
    const described = descriptions.get(fact)!;
    const required = fact.required || !hasSubject && fact.type === "direction" && !fact.negative;
    if (!isBlockKind(fact.type) || !described.text || described.unsupported) {
      if (required) addIssue("model3d_document_required_context_missing", [fact.id]);
      else if (described.text || described.unsupported) omittedUnsupportedContext = true;
      continue;
    }
    const scope = scopeFor(fact);
    if (scope.invalid) { addIssue("model3d_document_scope_unavailable", [fact.id]); continue; }
    const rank = priorityFor(fact.type);
    const prefix = fact.negative ? /^(?:prohibit|forbid|must_not_include)$/iu.test(fact.intent) ? "Never include " : "Avoid "
      : fact.intent === "prefer" ? "Prefer " : "";
    clauses.push({ text: prefix + fact.type + (scope.text ? " [" + scope.text + "]" : "") + ": " + described.text,
      blockIds: scope.blockIds, required, priority: rank < 0 ? 20 : rank, order });
  }
  for (const [index, raw] of (Array.isArray(source.standing_constraints) ? source.standing_constraints : []).entries()) {
    const constraint = record(raw);
    if (constraint.active === false || constraint.removed === true || constraint.weight === 0) continue;
    const direction = values(constraint.value ?? constraint.text), axis = scalar(constraint.axis);
    if (!direction.text || direction.unsupported) { addIssue("model3d_document_required_context_missing"); continue; }
    clauses.push({ text: (negative(constraint.polarity) ? /^(?:prohibit|forbid|must_not_include)$/iu.test(String(constraint.polarity)) ? "Never include " : "Avoid " : "Require ") + (axis ? axis + ": " : "") + direction.text,
      blockIds: [], required: true, priority: 0, order: facts.length + index });
  }
  const referenceCount = options.referenceCount ?? 0;
  if (!Number.isSafeInteger(referenceCount) || referenceCount < 0 || referenceCount > RODIN_MAX_IMAGE_REFERENCES) addIssue("model3d_document_reference_count_invalid");
  const required = clauses.filter(clause => clause.required);
  const chosen = new Set(required);
  const joined = (items: readonly Clause[]) => [...items].sort((left, right) => left.order - right.order).map(clause => clause.text).join("\n");
  if (model3dPromptLength(joined(required)) > RODIN_PROMPT_MAX_CHARS) {
    addIssue("model3d_document_required_context_too_long", required.flatMap(clause => clause.blockIds));
  } else {
    for (const clause of clauses.filter(clause => !clause.required).sort((left, right) => left.priority - right.priority || left.order - right.order)) {
      if (model3dPromptLength(joined([...chosen, clause])) <= RODIN_PROMPT_MAX_CHARS) chosen.add(clause);
    }
  }
  const prompt = joined([...chosen]);
  if (!prompt && !(Number.isSafeInteger(referenceCount) && referenceCount > 0 && referenceCount <= RODIN_MAX_IMAGE_REFERENCES)) addIssue("model3d_document_prompt_empty");
  const included = new Set([...chosen].flatMap(clause => clause.blockIds));
  const includedBlockIds = facts.map(fact => fact.id).filter(id => id && included.has(id));
  const omittedBlockIds = facts.map(fact => fact.id).filter(id => id && !included.has(id));
  const suggest = (code: string, message: string, blockTypes: string[]) => suggestions.push({ code, message, blockTypes });
  if (!hasSubject) suggest("model3d_suggest_subject", "A Subject block can clarify the object or character to model.", ["subject"]);
  if (!facts.some(fact => fact.type === "material" && !fact.negative && descriptions.get(fact)?.text)) suggest("model3d_suggest_material", "A Material block can clarify surfaces, textures, and finish.", ["material"]);
  if (!facts.some(fact => fact.type === "scale" && !fact.negative && descriptions.get(fact)?.text)) suggest("model3d_suggest_scale", "A Scale block can clarify proportions and relative size.", ["scale"]);
  if (referenceCount === 0) suggest("model3d_suggest_reference_view", "A reference image or saved 3D view can clarify the intended shape and appearance.", ["reference", "model3d"]);
  if (omittedUnsupportedContext || clauses.some(clause => !clause.required && !chosen.has(clause))) suggest("model3d_document_optional_context_omitted", "Some optional document context is not included in the 3D prompt. Review the prepared description before generating.", []);
  if (facts.some(fact => ["audio", "motion"].includes(fact.type) && descriptions.get(fact)?.text)) suggest("model3d_static_context_only", "3D models represent a still object or pose. Audio and motion descriptions provide context; sound and animation are not generated.", ["subject", "action"]);
  if (removedSourceLocation) suggest("model3d_document_source_links_omitted", "Source links and private media locations are omitted from the 3D description. Describe their useful details in a context block.", ["reference"]);
  return { prompt, valid: issues.length === 0, adapterVersion: MODEL3D_PROMPT_ADAPTER_VERSION, includedBlockIds, omittedBlockIds, issues, suggestions, promptCharacters: model3dPromptLength(prompt) };
}

/** The reviewed provenance contains no prompt body, source URLs, or mutable arrays. */
export function model3dAdaptationReceipt(result: Model3dDocumentAdaptation) {
  return { adapterVersion: result.adapterVersion, includedBlockIds: [...result.includedBlockIds], omittedBlockIds: [...result.omittedBlockIds] };
}
