/** Authored output intent. These values do not grant permission, spend money, or accept results. */
export const OUTPUT_REQUIREMENTS_SCHEMA_VERSION = 1 as const;
/** Leave room for a finite target suffix within the server's 160-character opaque ID limit. */
export const OUTPUT_REQUIREMENT_ID_MAX_LENGTH = 148;
/** Shared with native editors and delivery manifests; never silently truncate authored labels. */
export const OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH = 240;
/** The longest supported finite ordinal adds a space and four digits to the unchanged authored label. */
export const OUTPUT_PLAN_TARGET_LABEL_MAX_LENGTH = OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH + 5;
/** Match portable scope capacity without deleting any row from an oversized saved assignment. */
export const OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT = 1024;
export type OutputMediaKind = "image" | "slides" | "audio" | "video" | "document" | "model3d" | "unknown";
export type OutputQuantityUnit = "presentation" | "slide" | "episode" | "video" | "image" | "second" | "document" | "model" | "member";
export type OutputQuantity =
  | { kind: "unknown"; unit: OutputQuantityUnit; reason?: string }
  | { kind: "exact"; unit: OutputQuantityUnit; value: number }
  | { kind: "range"; unit: OutputQuantityUnit; min: number; max: number };
export type OutputValueOrigin = { kind: "authored" | "interpreted" | "suggested" | "confirmed"; text?: string };
export type OutputSourceScope = { kind: "document" } | { kind: "blocks"; block_ids: string[] } | { kind: "unknown"; reason: string };
export type OutputCoverage = { kind: "document_context" } | { kind: "document_outline" } | { kind: "topics"; topics: string[] } | { kind: "unresolved"; description: string };
export type OutputAspectRatio = { width: number; height: number };
export type OutputFormatVariant = {
  id: string;
  label: string;
  required: boolean;
  aspect_ratio: OutputAspectRatio | null;
  quantity: OutputQuantity;
  placements: string[];
  original_text: string;
  value_origins: Record<string, OutputValueOrigin>;
};
export type OutputSeriesMember = {
  id: string;
  label: string;
  required: boolean;
  source_scope: OutputSourceScope;
  coverage: OutputCoverage;
  quantity: OutputQuantity;
  original_text: string;
  value_origins: Record<string, OutputValueOrigin>;
};
export type OutputSeries = { state: "unresolved" | "resolved"; members: OutputSeriesMember[]; description: string };
export type OutputDeliverable = {
  id: string;
  label: string;
  media_kind: OutputMediaKind;
  required: boolean;
  quantity: OutputQuantity;
  content_quantity?: OutputQuantity;
  source_scope: OutputSourceScope;
  coverage: OutputCoverage;
  format_variants?: OutputFormatVariant[];
  series?: OutputSeries;
  original_text: string;
  value_origins: Record<string, OutputValueOrigin>;
};
export type OutputRequirementSpec = {
  schema_version: 1;
  id: string;
  label: string;
  original_text: string;
  deliverables: OutputDeliverable[];
  value_origins: Record<string, OutputValueOrigin>;
};
/** A count decision is separate from the authored constraint and from per-attempt settings. */
export type OutputCountPolicy =
  | { kind: "exact"; unit: OutputQuantityUnit; value: number }
  | { kind: "flexible"; unit: OutputQuantityUnit; min: number; max: number; aim?: number };
export type OutputIssue = { code: string; path: string; message: string };
export type OutputRequirementInspection = { status: "valid" | "invalid" | "unsupported"; spec: OutputRequirementSpec | null; issues: OutputIssue[]; preserved: unknown };
export type OutputParseResult = { recognized: boolean; spec: OutputRequirementSpec | null; issues: OutputIssue[]; needs_confirmation: true };
export type OutputRequirementInput = { id: string; [key: string]: unknown };

const mediaKinds = new Set<OutputMediaKind>(["image", "slides", "audio", "video", "document", "model3d", "unknown"]);
const units = new Set<OutputQuantityUnit>(["presentation", "slide", "episode", "video", "image", "second", "document", "model", "member"]);
const originKinds = new Set(["authored", "interpreted", "suggested", "confirmed"]);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const issue = (code: string, path: string, message: string): OutputIssue => ({ code, path, message });
const authored = (text?: string): OutputValueOrigin => ({ kind: "authored", ...(text === undefined ? {} : { text }) });
const interpreted = (text?: string): OutputValueOrigin => ({ kind: "interpreted", ...(text === undefined ? {} : { text }) });
const unknownQuantity = (unit: OutputQuantityUnit, reason: string): OutputQuantity => ({ kind: "unknown", unit, reason });

export function isOutputRequirementId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,147}$/.test(value); }
export function isOutputRequirementLabel(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH && !/[\p{Cc}\p{Cf}]/u.test(value);
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: OutputIssue[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue("unsupported_field", `${path}.${key}`, "This field is not supported by requirement schema 1."));
}

function text(value: unknown, path: string, issues: OutputIssue[], allowEmpty = true) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) issues.push(issue("invalid_text", path, allowEmpty ? "Expected text." : "Expected nonempty text."));
}

function label(value: unknown, path: string, issues: OutputIssue[]) {
  if (typeof value !== "string") { issues.push(issue("invalid_label_type", path, "A label must be text.")); return; }
  if (!value.trim()) issues.push(issue("label_required", path, "A nonempty label is required."));
  if (value.length > OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH) issues.push(issue("label_too_long", path, `Use a label of at most ${OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH} characters. The full original text remains preserved.`));
  if (/[\p{Cc}\p{Cf}]/u.test(value)) issues.push(issue("label_control_characters", path, "A label cannot contain control or formatting characters."));
}

function positive(value: unknown, unit: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER && (unit === "second" || Number.isSafeInteger(value));
}

function quantity(value: unknown, path: string, issues: OutputIssue[]) {
  if (!object(value)) { issues.push(issue("invalid_quantity", path, "Specify an unknown, exact, or ranged quantity with a unit.")); return; }
  if (!units.has(value.unit as OutputQuantityUnit)) issues.push(issue("invalid_unit", `${path}.unit`, "The quantity unit is not supported."));
  if (value.kind === "unknown") {
    keys(value, ["kind", "unit", "reason"], path, issues);
    if (value.reason !== undefined) text(value.reason, `${path}.reason`, issues);
  } else if (value.kind === "exact") {
    keys(value, ["kind", "unit", "value"], path, issues);
    if (!positive(value.value, value.unit)) issues.push(issue("invalid_quantity", `${path}.value`, "An exact quantity must be positive; counts must be whole numbers."));
  } else if (value.kind === "range") {
    keys(value, ["kind", "unit", "min", "max"], path, issues);
    if (!positive(value.min, value.unit) || !positive(value.max, value.unit) || Number(value.min) > Number(value.max)) issues.push(issue("invalid_quantity_range", path, "A range must have positive ordered bounds; counts must be whole numbers."));
  } else issues.push(issue("invalid_quantity_kind", `${path}.kind`, "Expected unknown, exact, or range."));
}

function sourceScope(value: unknown, path: string, issues: OutputIssue[]) {
  if (!object(value)) { issues.push(issue("invalid_source_scope", path, "An explicit source scope is required; missing scope must not broaden access.")); return; }
  if (value.kind === "document") keys(value, ["kind"], path, issues);
  else if (value.kind === "blocks") {
    keys(value, ["kind", "block_ids"], path, issues);
    stringList(value.block_ids, `${path}.block_ids`, issues, false);
  } else if (value.kind === "unknown") {
    keys(value, ["kind", "reason"], path, issues);
    text(value.reason, `${path}.reason`, issues, false);
  } else issues.push(issue("invalid_source_scope", path, "Source scope must be document, blocks, or explicitly unknown."));
}

function coverage(value: unknown, path: string, issues: OutputIssue[]) {
  if (!object(value)) { issues.push(issue("invalid_coverage", path, "Coverage must be explicit, including when it is unresolved.")); return; }
  if (value.kind === "document_context" || value.kind === "document_outline") keys(value, ["kind"], path, issues);
  else if (value.kind === "topics") {
    keys(value, ["kind", "topics"], path, issues);
    stringList(value.topics, `${path}.topics`, issues, false);
  } else if (value.kind === "unresolved") {
    keys(value, ["kind", "description"], path, issues);
    text(value.description, `${path}.description`, issues, false);
  } else issues.push(issue("invalid_coverage", path, "Coverage must use the Document's creative context, describe a Document outline, name topics, or retain an unresolved decision."));
}

function stringList(value: unknown, path: string, issues: OutputIssue[], allowEmpty = true) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.some((entry) => !nonempty(entry))) {
    issues.push(issue("invalid_string_list", path, allowEmpty ? "Expected a list of nonempty text values." : "Expected at least one nonempty text value."));
    return;
  }
  if (new Set(value).size !== value.length) issues.push(issue("duplicate_value", path, "Repeated values are not allowed."));
}

function origins(value: unknown, path: string, issues: OutputIssue[]) {
  if (!object(value)) { issues.push(issue("invalid_value_origins", path, "Value origins must be retained.")); return; }
  for (const [key, origin] of Object.entries(value)) {
    if (!key.trim() || !object(origin) || !originKinds.has(String(origin.kind))) {
      issues.push(issue("invalid_value_origin", `${path}.${key}`, "Expected an authored, interpreted, suggested, or confirmed origin."));
      continue;
    }
    keys(origin, ["kind", "text"], `${path}.${key}`, issues);
    if (origin.text !== undefined) text(origin.text, `${path}.${key}.text`, issues);
    if (key === "interpretation_basis" && (!["interpreted", "confirmed"].includes(String(origin.kind)) || typeof origin.text !== "string")) issues.push(issue("invalid_interpretation_basis", `${path}.${key}`, "An interpretation basis must retain its exact wording with an interpreted or explicitly confirmed origin."));
  }
}

function identity(value: unknown, path: string, issues: OutputIssue[], ids: Set<string>) {
  if (!isOutputRequirementId(value)) { issues.push(issue("invalid_id", path, "Use a stable opaque identity of at most 148 ASCII letters, numbers, periods, underscores, colons, or hyphens, beginning with a letter or number.")); return; }
  if (ids.has(value)) issues.push(issue("duplicate_id", path, "Every requirement, deliverable, variant, and member needs a distinct identity."));
  ids.add(value);
}

function ratio(value: unknown, path: string, issues: OutputIssue[]) {
  if (value === null) return;
  if (!object(value)) { issues.push(issue("invalid_aspect_ratio", path, "Use an exact ratio or null while it is unresolved.")); return; }
  keys(value, ["width", "height"], path, issues);
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || Number(value.width) <= 0 || Number(value.height) <= 0) issues.push(issue("invalid_aspect_ratio", path, "Aspect ratios use two positive whole numbers."));
}

function variant(value: unknown, path: string, issues: OutputIssue[], ids: Set<string>) {
  if (!object(value)) { issues.push(issue("invalid_variant", path, "Expected a format variant.")); return; }
  keys(value, ["id", "label", "required", "aspect_ratio", "quantity", "placements", "original_text", "value_origins"], path, issues);
  identity(value.id, `${path}.id`, issues, ids);
  label(value.label, `${path}.label`, issues);
  if (typeof value.required !== "boolean") issues.push(issue("invalid_requiredness", `${path}.required`, "Requiredness must be explicit."));
  ratio(value.aspect_ratio, `${path}.aspect_ratio`, issues);
  quantity(value.quantity, `${path}.quantity`, issues);
  stringList(value.placements, `${path}.placements`, issues);
  text(value.original_text, `${path}.original_text`, issues);
  origins(value.value_origins, `${path}.value_origins`, issues);
}

function member(value: unknown, path: string, issues: OutputIssue[], ids: Set<string>) {
  if (!object(value)) { issues.push(issue("invalid_series_member", path, "Expected an explicit series member.")); return; }
  keys(value, ["id", "label", "required", "source_scope", "coverage", "quantity", "original_text", "value_origins"], path, issues);
  identity(value.id, `${path}.id`, issues, ids);
  label(value.label, `${path}.label`, issues);
  if (typeof value.required !== "boolean") issues.push(issue("invalid_requiredness", `${path}.required`, "Requiredness must be explicit."));
  sourceScope(value.source_scope, `${path}.source_scope`, issues);
  coverage(value.coverage, `${path}.coverage`, issues);
  quantity(value.quantity, `${path}.quantity`, issues);
  text(value.original_text, `${path}.original_text`, issues);
  origins(value.value_origins, `${path}.value_origins`, issues);
}

function deliverable(value: unknown, path: string, issues: OutputIssue[], ids: Set<string>) {
  if (!object(value)) { issues.push(issue("invalid_deliverable", path, "Expected a deliverable.")); return; }
  keys(value, ["id", "label", "media_kind", "required", "quantity", "content_quantity", "source_scope", "coverage", "format_variants", "series", "original_text", "value_origins"], path, issues);
  identity(value.id, `${path}.id`, issues, ids);
  label(value.label, `${path}.label`, issues);
  if (!mediaKinds.has(value.media_kind as OutputMediaKind)) issues.push(issue("invalid_media_kind", `${path}.media_kind`, "This media kind is not supported."));
  if (typeof value.required !== "boolean") issues.push(issue("invalid_requiredness", `${path}.required`, "Requiredness must be explicit."));
  quantity(value.quantity, `${path}.quantity`, issues);
  if (value.content_quantity !== undefined) quantity(value.content_quantity, `${path}.content_quantity`, issues);
  sourceScope(value.source_scope, `${path}.source_scope`, issues);
  coverage(value.coverage, `${path}.coverage`, issues);
  text(value.original_text, `${path}.original_text`, issues);
  origins(value.value_origins, `${path}.value_origins`, issues);
  if (value.format_variants !== undefined) {
    if (!Array.isArray(value.format_variants)) issues.push(issue("invalid_variants", `${path}.format_variants`, "Expected a list of format variants."));
    else value.format_variants.forEach((entry, index) => variant(entry, `${path}.format_variants[${index}]`, issues, ids));
  }
  if (value.series !== undefined) {
    if (!object(value.series)) issues.push(issue("invalid_series", `${path}.series`, "Expected a series with explicit membership state."));
    else {
      keys(value.series, ["state", "members", "description"], `${path}.series`, issues);
      if (!["unresolved", "resolved"].includes(String(value.series.state))) issues.push(issue("invalid_series_state", `${path}.series.state`, "Series membership is either unresolved or resolved."));
      text(value.series.description, `${path}.series.description`, issues);
      if (!Array.isArray(value.series.members)) issues.push(issue("invalid_series_members", `${path}.series.members`, "Expected a list of series members."));
      else {
        if (value.series.state === "resolved" && !value.series.members.length) issues.push(issue("empty_resolved_series", `${path}.series.members`, "An empty series does not fulfill a requested series."));
        value.series.members.forEach((entry, index) => member(entry, `${path}.series.members[${index}]`, issues, ids));
      }
    }
  }
  if (Array.isArray(value.format_variants) && value.format_variants.length && object(value.series)) issues.push(issue("unsupported_series_variants", path, "Schema 1 does not implicitly cross-multiply series members and format variants; use explicit deliverables."));
  if (value.required === true && Array.isArray(value.format_variants) && value.format_variants.length && value.format_variants.every((entry) => object(entry) && entry.required === false)) issues.push(issue("required_group_without_required_member", `${path}.format_variants`, "A required group needs required members; optional choices alone cannot fulfill an unspecified obligation."));
  if (value.required === true && object(value.series) && value.series.state === "resolved" && Array.isArray(value.series.members) && value.series.members.length && value.series.members.every((entry) => object(entry) && entry.required === false)) issues.push(issue("required_group_without_required_member", `${path}.series.members`, "A required series needs required members; optional choices alone cannot fulfill an unspecified obligation."));
  const expectedUnits: Partial<Record<OutputMediaKind, OutputQuantityUnit>> = { image: "image", slides: "presentation", audio: "episode", video: "video", document: "document", model3d: "model" };
  const expected = expectedUnits[value.media_kind as OutputMediaKind];
  if (expected && object(value.quantity) && value.quantity.unit !== expected) issues.push(issue("media_quantity_unit_mismatch", `${path}.quantity.unit`, `This deliverable uses ${expected} quantities.`));
  if (value.media_kind === "slides" && object(value.content_quantity) && value.content_quantity.unit !== "slide") issues.push(issue("content_quantity_unit_mismatch", `${path}.content_quantity.unit`, "Presentation content is counted in slides."));
  if (["audio", "video"].includes(String(value.media_kind)) && object(value.content_quantity) && value.content_quantity.unit !== "second") issues.push(issue("content_quantity_unit_mismatch", `${path}.content_quantity.unit`, "Audio and video duration is measured in seconds."));
  if (expected && Array.isArray(value.format_variants)) for (const [index, entry] of value.format_variants.entries()) if (object(entry) && object(entry.quantity) && entry.quantity.unit !== expected) issues.push(issue("variant_quantity_unit_mismatch", `${path}.format_variants[${index}].quantity.unit`, `This format variant uses ${expected} quantities.`));
  if (expected && object(value.series) && Array.isArray(value.series.members)) for (const [index, entry] of value.series.members.entries()) if (object(entry) && object(entry.quantity) && entry.quantity.unit !== expected) issues.push(issue("member_quantity_unit_mismatch", `${path}.series.members[${index}].quantity.unit`, `This series member uses ${expected} quantities.`));
}

/** Unknown versions are preserved without interpretation; invalid v1 values are never executable. */
export function inspectOutputRequirement(value: unknown): OutputRequirementInspection {
  const issues: OutputIssue[] = [];
  if (!object(value)) return { status: "invalid", spec: null, issues: [issue("invalid_requirement", "$", "Expected an Output requirement object.")], preserved: value };
  if (typeof value.schema_version === "number" && Number.isSafeInteger(value.schema_version) && value.schema_version > OUTPUT_REQUIREMENTS_SCHEMA_VERSION) return { status: "unsupported", spec: null, issues: [issue("unsupported_schema_version", "$.schema_version", "This requirement was saved with a newer schema. Keep it unchanged and update Forma before interpreting it.")], preserved: value };
  if (value.schema_version !== OUTPUT_REQUIREMENTS_SCHEMA_VERSION) issues.push(issue("invalid_schema_version", "$.schema_version", "Requirement schema 1 is required."));
  keys(value, ["schema_version", "id", "label", "original_text", "deliverables", "value_origins"], "$", issues);
  const ids = new Set<string>();
  identity(value.id, "$.id", issues, ids);
  label(value.label, "$.label", issues);
  text(value.original_text, "$.original_text", issues);
  origins(value.value_origins, "$.value_origins", issues);
  if (!Array.isArray(value.deliverables)) issues.push(issue("invalid_deliverables", "$.deliverables", "Expected a list of requested deliverables."));
  else value.deliverables.forEach((entry, index) => deliverable(entry, `$.deliverables[${index}]`, issues, ids));
  return { status: issues.length ? "invalid" : "valid", spec: issues.length ? null : value as OutputRequirementSpec, issues, preserved: value };
}

/** Preserve an otherwise structurally valid draft for correction; this must never be used to authorize or compile it. */
export function outputRequirementEditableDraft(value: unknown): OutputRequirementSpec | null {
  const inspected = inspectOutputRequirement(value);
  if (inspected.status === "valid") return structuredClone(inspected.spec!);
  const editableLabelIssues = new Set(["label_required", "label_too_long", "label_control_characters"]);
  return inspected.status === "invalid" && inspected.issues.length > 0 && inspected.issues.every((entry) => editableLabelIssues.has(entry.code))
    ? structuredClone(value as OutputRequirementSpec) : null;
}

/** Reserved schema-1 metadata: the wording against which the retained structure was interpreted or reviewed. */
export function outputRequirementInterpretationBasis(spec: OutputRequirementSpec): string | null {
  if (spec.schema_version !== OUTPUT_REQUIREMENTS_SCHEMA_VERSION) return null;
  const basis = spec.value_origins?.interpretation_basis;
  return basis && (basis.kind === "interpreted" || basis.kind === "confirmed") && typeof basis.text === "string" ? basis.text : null;
}

/** Missing legacy metadata is unknown, not permission to trust an inferred correspondence. */
export function outputRequirementInterpretationNeedsReview(spec: OutputRequirementSpec): boolean {
  const basis = outputRequirementInterpretationBasis(spec);
  return basis === null || basis !== spec.original_text;
}

/** A wording-only edit preserves every decision and identity. It never acknowledges a semantic change. */
export function outputRequirementWithWording(spec: OutputRequirementSpec, wording: string): OutputRequirementSpec {
  if (inspectOutputRequirement(spec).status !== "valid" || typeof wording !== "string") throw new Error("Wording edits require a supported valid requirement and text wording.");
  const next = structuredClone(spec);
  next.original_text = wording;
  return next;
}

/** Call only after an explicit author review of the displayed retained decisions; this is not execution or result approval. */
export function confirmOutputRequirementInterpretation(spec: OutputRequirementSpec): OutputRequirementSpec {
  if (inspectOutputRequirement(spec).status !== "valid") throw new Error("Only a supported valid requirement can receive an interpretation acknowledgement.");
  const next = structuredClone(spec);
  next.value_origins.interpretation_basis = { kind: "confirmed", text: next.original_text };
  return next;
}

function gcd(left: number, right: number): number { return right === 0 ? left : gcd(right, left % right); }

/** Decimal ratios remain exact: 1.91:1 is 191:100, never a rounded render size. */
export function parseOutputAspectRatio(value: string): OutputAspectRatio | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const decimalPlaces = Math.max((match[1].split(".")[1] ?? "").length, (match[2].split(".")[1] ?? "").length);
  if (decimalPlaces > 9) return null;
  const scale = 10 ** decimalPlaces;
  const width = Number(match[1]) * scale, height = Number(match[2]) * scale;
  const roundedWidth = Math.round(width), roundedHeight = Math.round(height);
  if (!Number.isSafeInteger(roundedWidth) || !Number.isSafeInteger(roundedHeight) || roundedWidth <= 0 || roundedHeight <= 0 || Math.abs(width - roundedWidth) > 0.00001 || Math.abs(height - roundedHeight) > 0.00001) return null;
  const divisor = gcd(roundedWidth, roundedHeight);
  return { width: roundedWidth / divisor, height: roundedHeight / divisor };
}

export function formatOutputAspectRatio(value: OutputAspectRatio): string {
  const divisor = gcd(value.width, value.height);
  return `${value.width / divisor}:${value.height / divisor}`;
}

export function isOutputContextType(value: unknown): boolean { return typeof value === "string" && value.trim().toLowerCase() === "output"; }

/** Output instructions are not automatically supporting facts, even with mixed case imports. */
export function partitionOutputContext<T extends { type?: unknown; removed?: boolean }>(blocks: readonly T[]): { facts: T[]; instructions: T[] } {
  const facts: T[] = [], instructions: T[] = [];
  for (const block of blocks) if (!block.removed) (isOutputContextType(block.type) ? instructions : facts).push(block);
  return { facts, instructions };
}

function inputValue(input: OutputRequirementInput, name: string, issues: OutputIssue[]): unknown {
  const values = Object.entries(input).filter(([key]) => key.toLowerCase() === name);
  if (values.length > 1 && values.some(([, value]) => value !== values[0][1])) issues.push(issue("conflicting_import_keys", name, `The import contains conflicting ${name} values.`));
  return values[0]?.[1];
}

function boundedGeneratedId(base: string): string {
  if (base.length <= OUTPUT_REQUIREMENT_ID_MAX_LENGTH) return base;
  // This suffix avoids accidental identity truncation collisions; it is not an authorization digest.
  let hash = 14695981039346656037n;
  for (let index = 0; index < base.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(base.charCodeAt(index))) * 1099511628211n);
  return `${base.slice(0, 130)}:${hash.toString(16).padStart(16, "0")}`;
}

/** Bound derived planning identities without rewriting the author's persisted aggregate or child identities. */
export function deriveOutputRequirementId(parentId: string, suffix: string): string {
  if (!isOutputRequirementId(parentId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(suffix)) throw new Error("A derived Output identity requires a valid opaque parent and suffix.");
  return boundedGeneratedId(`${parentId}:${suffix}`);
}

function allocateId(base: string, used: Set<string>, forbidden: Set<string> = new Set()): string {
  let candidate = boundedGeneratedId(base), suffix = 2;
  while (used.has(candidate) || forbidden.has(candidate)) candidate = boundedGeneratedId(`${base}:${suffix++}`);
  used.add(candidate);
  return candidate;
}

function matchIdentity<T extends { id: string }>(base: string, candidates: readonly T[], used: Set<string>, issues: OutputIssue[], path: string, priorIds: Set<string>): string {
  if (candidates.length === 1 && !used.has(candidates[0].id)) { used.add(candidates[0].id); return candidates[0].id; }
  if (candidates.length > 1) {
    issues.push(issue("ambiguous_identity", path, "More than one prior item could match. Review this new identity; no prior fulfillment is transferred."));
    return allocateId(`${base}:new`, used, priorIds);
  }
  return allocateId(base, used, priorIds);
}

const singularCount = (value: string | undefined): number | null => value === undefined ? null : value.toLowerCase() === "one" ? 1 : Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

function parsedSlides(textValue: string): OutputQuantity {
  const ranged = textValue.match(/\b(\d+)\s*(?:[-–—]|to)\s*(\d+)\s+slides?\b/i);
  if (ranged) return { kind: "range", unit: "slide", min: Number(ranged[1]), max: Number(ranged[2]) };
  const exact = textValue.match(/\b(\d+)\s+slides?\b/i);
  return exact ? { kind: "exact", unit: "slide", value: Number(exact[1]) } : unknownQuantity("slide", "Agree a slide count or an acceptable range.");
}

function parsedDuration(textValue: string): OutputQuantity {
  const exact = textValue.match(/\b(\d+(?:\.\d+)?)\s*[- ]?\s*(seconds?|minutes?)\b/i);
  if (!exact) return unknownQuantity("second", "Agree the duration before production.");
  return { kind: "exact", unit: "second", value: Number(exact[1]) * (/^minute/i.test(exact[2]) ? 60 : 1) };
}

function mediaClause(content: string, expression: RegExp): string {
  return content.split(/\s*,\s*(?=(?:one|\d+|a series|and (?:one|\d+|a series))\b)/i).find((part) => expression.test(part))?.trim() ?? content;
}

/** A deterministic proposal for common intake. The retained prose remains the author's source of intent. */
export function parseOutputRequirement(input: OutputRequirementInput, previous?: OutputRequirementSpec): OutputParseResult {
  const issues: OutputIssue[] = [];
  const type = inputValue(input, "type", issues);
  if (type !== undefined && !isOutputContextType(type)) return { recognized: false, spec: null, issues: [issue("not_output_context", "type", "This import is not an Output context."), ...issues], needs_confirmation: true };
  const subtype = inputValue(input, "subtype", issues);
  const rawContent = inputValue(input, "content", issues);
  if (!isOutputRequirementId(input.id) || typeof rawContent !== "string" || (subtype !== undefined && typeof subtype !== "string") || issues.length) return { recognized: false, spec: null, issues: [...issues, issue("invalid_import", "$", "Provide a safe opaque identity of at most 148 characters, text Content, and an optional text Subtype.")], needs_confirmation: true };
  const content = rawContent;
  const label = typeof subtype === "string" && subtype.trim() ? subtype.trim() : "Requested outputs";
  const prior = previous && previous.id === input.id && inspectOutputRequirement(previous).status === "valid" ? previous : undefined;
  const used = new Set<string>([input.id]);
  const priorIds = new Set<string>(prior ? [prior.id, ...prior.deliverables.flatMap((entry) => [entry.id, ...(entry.format_variants ?? []).map((item) => item.id), ...(entry.series?.members ?? []).map((item) => item.id)])] : []);
  const deliverables: OutputDeliverable[] = [];
  const make = (kind: OutputMediaKind, key: string, title: string, clause: string, series = false): OutputDeliverable => {
    const candidates = prior?.deliverables.filter((entry) => entry.media_kind === kind && Boolean(entry.series) === series) ?? [];
    const id = matchIdentity(`${input.id}:deliverable:${key}`, candidates, used, issues, `deliverables.${key}`, priorIds);
    const unit: OutputQuantityUnit = kind === "image" ? "image" : kind === "slides" ? "presentation" : kind === "audio" ? "episode" : kind === "video" ? "video" : kind === "document" ? "document" : kind === "model3d" ? "model" : "member";
    return { id, label: title, media_kind: kind, required: true, quantity: unknownQuantity(unit, "Agree how many finished deliverables are required."), source_scope: { kind: "document" }, coverage: { kind: "unresolved", description: "Confirm which Document content this deliverable should cover." }, original_text: clause, value_origins: { media_kind: interpreted(clause), required: interpreted(clause), quantity: interpreted(), source_scope: interpreted("Use the complete Document as the initial evidence scope; Output instructions are separate."), coverage: interpreted() } };
  };
  const imageRequest = /social\s+media\s+images?/i.test(label) || /^\s*output\s+images?\b/i.test(content);
  const videoRequest = /social\s+media\s+videos?/i.test(label) || /^\s*output\s+videos?\b/i.test(content);
  const modelRequest = /\b(?:3d|three[ -]dimensional)\s+models?\b/i.test(label) || /^\s*(?:output|create|generate|make|deliver|export)\s+(?:(?:one|a|an|\d+(?:\s*(?:[-–—]|to)\s*\d+)?)[ ]+)?(?:3d|three[ -]dimensional)\s+models?\b/i.test(content);
  const executiveRequest = /executive\s+summary/i.test(label) || /\b(?:slideshow|slide\s+show|presentation|deck)\b/i.test(content) && /\b(?:podcast|episode|series)\b/i.test(content);
  if (modelRequest) {
    const entry = make("model3d", "model3d", "3D models", content);
    const ranged = content.match(/\b(\d+)\s*(?:[-–—]|to)\s*(\d+)\s+(?:3d|three[ -]dimensional)\s+models?\b/i);
    const exact = content.match(/\b(one|a|an|\d+)\s+(?:3d|three[ -]dimensional)\s+models?\b/i);
    const count = exact ? /^(?:a|an)$/i.test(exact[1]!) ? 1 : singularCount(exact[1]) : null;
    entry.quantity = ranged ? { kind: "range", unit: "model", min: Number(ranged[1]), max: Number(ranged[2]) } : count === null ? unknownQuantity("model", "Agree how many finished 3D models are required.") : { kind: "exact", unit: "model", value: count };
    entry.value_origins.quantity = ranged || exact ? authored((ranged ?? exact)![0]) : interpreted();
    entry.coverage = { kind: "document_context" };
    entry.value_origins.coverage = interpreted("Use the authorized Document's creative context. A saved model view is a separate image reference, not the original mesh.");
    deliverables.push(entry);
  } else if (imageRequest || videoRequest) {
    const kind = imageRequest ? "image" : "video", entry = make(kind, kind, imageRequest ? "Social media images" : "Social media videos", content);
    entry.coverage = { kind: "document_context" };
    entry.value_origins.coverage = interpreted("Use the authorized Document's creative context. This does not assert exhaustive topic coverage.");
    const matches = Array.from(content.matchAll(/(?<![\d.-])\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?/g));
    const previousEntry = prior?.deliverables.find((item) => item.id === entry.id);
    entry.format_variants = matches.map((match, index): OutputFormatVariant => {
      const aspect = parseOutputAspectRatio(match[0]);
      const end = matches[index + 1]?.index ?? content.length;
      const clause = content.slice(match.index, end).replace(/^["'“”]+|[\s,"'“”]+$/g, "").trim();
      const key = aspect ? formatOutputAspectRatio(aspect) : `unresolved-${index + 1}`;
      const candidates = previousEntry?.format_variants?.filter((item) => item.aspect_ratio && aspect && formatOutputAspectRatio(item.aspect_ratio) === key) ?? [];
      const id = matchIdentity(`${entry.id}:format:${key.replace(":", "x")}`, candidates, used, issues, `deliverables.${kind}.format_variants[${index}]`, priorIds);
      if (!aspect) issues.push(issue("unresolved_aspect_ratio", `deliverables.${kind}.format_variants[${index}]`, "The authored ratio could not be interpreted exactly."));
      const placementText = clause.slice(match[0].length).replace(/^[\s,"'“”]+/, "").replace(/^for\s+/i, "").trim();
      const required = !/\boptional(?:ly)?\b/i.test(clause);
      return { id, label: `${match[0].replace(/\s/g, "")} ${imageRequest ? "images" : "videos"}`, required, aspect_ratio: aspect, quantity: unknownQuantity(kind, imageRequest ? "Agree the image or carousel member count for this format." : "Agree the number of finished videos for this format."), placements: placementText ? [placementText] : [], original_text: clause, value_origins: { aspect_ratio: authored(match[0]), required: authored(required ? "Requested format" : "Optional format"), quantity: interpreted(), placements: authored(placementText) } };
    });
    if (!matches.length) issues.push(issue("unresolved_formats", "deliverables[0].format_variants", "No exact aspect ratios were found. Retain the prose and define format rows before production."));
    if (kind === "video") entry.content_quantity = parsedDuration(content);
    deliverables.push(entry);
  } else if (executiveRequest) {
    const deckMatch = content.match(/\b(?:(one|\d+)\s+)?(?:slideshow|slide\s+show|presentation|deck)\b/i);
    if (deckMatch) {
      const clause = mediaClause(content, /\b(?:slideshow|slide\s+show|presentation|deck)\b/i), entry = make("slides", "slides", "Slideshow", clause);
      const count = singularCount(deckMatch[1]);
      entry.quantity = count === null ? unknownQuantity("presentation", "Agree how many presentations are required.") : { kind: "exact", unit: "presentation", value: count };
      entry.content_quantity = parsedSlides(clause);
      entry.coverage = { kind: "document_outline" };
      entry.value_origins.quantity = count === null ? interpreted() : authored(deckMatch[0]);
      entry.value_origins.content_quantity = entry.content_quantity.kind === "unknown" ? interpreted() : authored(clause);
      entry.value_origins.coverage = interpreted("Executive summary of the Document");
      deliverables.push(entry);
    }
    const audioMatch = content.match(/\b(?:(one|\d+)\s+)?(?:podcast(?:\s+episode)?|episode)\b/i);
    if (audioMatch) {
      const clause = mediaClause(content, /\b(?:podcast|episode)\b/i), entry = make("audio", "audio", "Podcast episode", clause);
      const count = singularCount(audioMatch[1]);
      entry.quantity = count === null ? unknownQuantity("episode", "Agree how many episodes are required.") : { kind: "exact", unit: "episode", value: count };
      entry.content_quantity = parsedDuration(clause);
      entry.coverage = { kind: "document_outline" };
      entry.value_origins.quantity = count === null ? interpreted() : authored(audioMatch[0]);
      entry.value_origins.content_quantity = entry.content_quantity.kind === "unknown" ? interpreted() : authored(clause);
      entry.value_origins.coverage = interpreted("Outline the Document");
      deliverables.push(entry);
    }
    if (/\bseries\b[\s\S]*\bvideos?\b/i.test(content)) {
      const clause = mediaClause(content, /\bseries\b/i), entry = make("video", "video-series", "Short video series", clause, true);
      entry.series = { state: "unresolved", members: [], description: "Agree an ordered, finite list of topics and the source coverage for each video. Do not assume one video per context block or exhaustive coverage." };
      entry.content_quantity = unknownQuantity("second", "Agree a duration for each series member.");
      entry.coverage = { kind: "unresolved", description: "Which parts of the Document should the series cover, and what may be omitted?" };
      entry.value_origins.series = authored(clause);
      deliverables.push(entry);
    }
  }
  const recognized = deliverables.length > 0;
  if (!recognized && content.trim()) {
    deliverables.push(make("unknown", "unresolved", label, content));
    issues.push(issue("unrecognized_request", "deliverables[0]", "The wording is retained. Choose the requested media and quantities instead of guessing an execution route."));
  } else if (!content.trim()) issues.push(issue("empty_request", "original_text", "Describe the requested outputs before reviewing a plan."));
  const spec: OutputRequirementSpec = { schema_version: 1, id: input.id, label, original_text: content, deliverables, value_origins: { label: typeof subtype === "string" ? authored(subtype) : interpreted(), deliverables: interpreted(content), interpretation_basis: interpreted(content) } };
  const validation = inspectOutputRequirement(spec);
  return { recognized, spec, issues: [...issues, ...validation.issues], needs_confirmation: true };
}

/** Copy authored requirements only. There are no job, acceptance, or grant fields to inherit. */
export function copyOutputRequirement(spec: OutputRequirementSpec, newId: string): { spec: OutputRequirementSpec; idMap: Record<string, string> } {
  const inspection = inspectOutputRequirement(spec);
  if (inspection.status !== "valid") throw new Error("Only supported, valid requirements can be copied as editable schema 1 requirements.");
  if (!isOutputRequirementId(newId)) throw new Error("A distinct safe opaque copy identity of at most 148 characters is required.");
  const originalIds = new Set([spec.id, ...spec.deliverables.flatMap((entry) => [entry.id, ...(entry.format_variants ?? []).map((variant) => variant.id), ...(entry.series?.members ?? []).map((member) => member.id)])]);
  if (originalIds.has(newId)) throw new Error("A copy must have an identity distinct from every original item.");
  const cloned = structuredClone(spec), idMap: Record<string, string> = {};
  const used = new Set<string>();
  const remap = (id: string, proposed: string) => {
    const replacement = allocateId(proposed, used, originalIds);
    Object.defineProperty(idMap, id, { value: replacement, enumerable: true, configurable: true, writable: true });
    return replacement;
  };
  cloned.id = remap(spec.id, newId);
  for (const [index, entry] of cloned.deliverables.entries()) {
    entry.id = remap(entry.id, `${newId}:deliverable:${index + 1}`);
    for (const [variantIndex, variant] of (entry.format_variants ?? []).entries()) variant.id = remap(variant.id, `${entry.id}:format:${variantIndex + 1}`);
    for (const [memberIndex, member] of (entry.series?.members ?? []).entries()) member.id = remap(member.id, `${entry.id}:member:${memberIndex + 1}`);
  }
  return { spec: cloned, idMap };
}

/** Reject policy widening before dispatch; never loosen a policy after seeing an output. */
export function validateOutputCountPolicy(authoredQuantity: OutputQuantity, policy: OutputCountPolicy): OutputIssue[] {
  const issues: OutputIssue[] = [];
  quantity(authoredQuantity, "authored", issues);
  if (!object(policy)) return [...issues, issue("invalid_count_policy", "policy", "Choose an exact count or bounded flexibility.")];
  if (policy.unit !== authoredQuantity.unit) issues.push(issue("count_policy_unit_mismatch", "policy.unit", "The count policy must use the authored quantity's unit."));
  if (policy.kind === "exact") {
    keys(policy, ["kind", "unit", "value"], "policy", issues);
    if (!positive(policy.value, policy.unit)) issues.push(issue("invalid_count_policy", "policy.value", "An exact policy must use a positive valid count."));
  } else if (policy.kind === "flexible") {
    keys(policy, ["kind", "unit", "min", "max", "aim"], "policy", issues);
    if (!positive(policy.min, policy.unit) || !positive(policy.max, policy.unit) || policy.min > policy.max) issues.push(issue("invalid_count_policy", "policy", "Flexible counts require positive ordered bounds."));
    if (policy.aim !== undefined && (!positive(policy.aim, policy.unit) || policy.aim < policy.min || policy.aim > policy.max)) issues.push(issue("invalid_count_aim", "policy.aim", "The aim must lie within the accepted bounds."));
  } else issues.push(issue("invalid_count_policy", "policy.kind", "Choose exact or flexible."));
  if (issues.length) return issues;
  const lower = policy.kind === "exact" ? policy.value : policy.min, upper = policy.kind === "exact" ? policy.value : policy.max;
  if (authoredQuantity.kind === "exact" && (lower !== authoredQuantity.value || upper !== authoredQuantity.value)) issues.push(issue("count_policy_changes_authored_exact", "policy", "Changing an authored exact count requires an explicit requirement revision."));
  if (authoredQuantity.kind === "range" && (lower < authoredQuantity.min || upper > authoredQuantity.max)) issues.push(issue("count_policy_exceeds_authored_range", "policy", "Accepted discretion cannot exceed the authored range."));
  return issues;
}

export function outputCountSatisfies(actual: number, authoredQuantity: OutputQuantity, policy: OutputCountPolicy): boolean {
  if (!positive(actual, authoredQuantity.unit) || validateOutputCountPolicy(authoredQuantity, policy).length) return false;
  if (authoredQuantity.kind === "exact" && actual !== authoredQuantity.value) return false;
  if (authoredQuantity.kind === "range" && (actual < authoredQuantity.min || actual > authoredQuantity.max)) return false;
  return policy.kind === "exact" ? actual === policy.value : actual >= policy.min && actual <= policy.max;
}

/** Native count editing: an empty field is unknown, never zero; malformed input is rejected. */
export function parseOutputQuantityInput(value: string | null | undefined, unit: OutputQuantityUnit): OutputQuantity | null {
  if (!units.has(unit)) return null;
  if (value === null || value === undefined || value.trim() === "") return { kind: "unknown", unit };
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?))?$/i);
  if (!match) return null;
  const lower = Number(match[1]);
  if (!positive(lower, unit)) return null;
  if (match[2] === undefined) return { kind: "exact", unit, value: lower };
  const upper = Number(match[2]);
  return positive(upper, unit) && upper >= lower ? { kind: "range", unit, min: lower, max: upper } : null;
}
