import type { Catalog, CompileResult, CompiledRelease, Definition, Interaction, Issue } from "./contracts.ts";

const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const renderers: Record<string, string> = { source: "role-source@1", spatial: "spatial-stage@1", relationship: "relationship-board@1", order: "ordered-evidence@1", profile: "profile-board@1", treatment: "scoped-treatment@1", proportion: "proportion-board@1" };
const viewers = new Set(["image.read-only@1", "short_story.read-only@1", "scene.read-only@1", "slides.read-only@1", "storyboard.read-only@1", "video.read-only@1", "audio.read-only@1", "model3d.read-only@1"]);
export const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
export const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => own(value, key));

/** Reject objects that cannot have arrived as bounded JSON; never invoke a getter or toJSON. */
export function jsonIssues(value: unknown): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, path: string, depth: number) => {
    if (++nodes > 4096 || depth > 12) { issues.push({ code: "definition_limit", path }); return; }
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") { if (item.length > 8192) issues.push({ code: "string_limit", path }); return; }
    if (typeof item === "number") { if (!Number.isFinite(item)) issues.push({ code: "invalid_number", path }); return; }
    if (typeof item !== "object" || (!Array.isArray(item) && !record(item))) { issues.push({ code: "invalid_json", path }); return; }
    if (seen.has(item)) { issues.push({ code: "cyclic_definition", path }); return; }
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) issues.push({ code: "invalid_key", path });
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      if (unsafeKeys.has(key) || !descriptor.enumerable || descriptor.get || descriptor.set || (Array.isArray(item) && !/^(0|[1-9]\d*)$/.test(key))) { issues.push({ code: "invalid_key", path: `${path}.${key}` }); continue; }
      visit(descriptor.value, `${path}.${key}`, depth + 1);
      if (nodes > 4096) break;
    }
    if (Array.isArray(item) && (item.length > 64 || Object.keys(item).length !== item.length)) issues.push({ code: "array_limit", path });
    seen.delete(item);
  };
  visit(value, "$", 0);
  return issues.slice(0, 64);
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("invalid_json");
  return encoded;
}
export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
const definitionKeys = ["schemaVersion", "id", "revision", "outputContractRef", "bindingPackRef", "essentialInteractionRef", "layout", "decisions", "viewerRef", "mobileProfileRef", "copySetRef"];
const decisionKeys = ["id", "interactionRef", "bindingSlot", "labelKey"];

export async function compileExperience(raw: unknown, catalog: Catalog): Promise<CompileResult> {
  const initial = jsonIssues(raw);
  if (initial.length) return { ok: false, issues: initial };
  raw = structuredClone(raw);
  catalog = structuredClone(catalog);
  if (catalog.version !== "forma-experience-fixture@1" || catalog.qualification !== "fixture") return { ok: false, issues: [{ code: "catalog_qualification", path: "$" }] };
  if (new TextEncoder().encode(canonicalJson(raw)).length > 16384) return { ok: false, issues: [{ code: "definition_limit", path: "$" }] };
  if (!record(raw) || !exactKeys(raw, definitionKeys)) return { ok: false, issues: [{ code: "definition_shape", path: "$" }] };
  const issues: Issue[] = [];
  const add = (code: string, path: string) => issues.push({ code, path });
  if (raw.schemaVersion !== 1 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1) add("definition_version", "$.revision");
  if (typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(raw.id)) add("definition_id", "$.id");
  if (raw.layout !== "stage-and-controls" && raw.layout !== "stacked-stage") add("layout_unavailable", "$.layout");
  if (raw.mobileProfileRef !== "touch.standard@1") add("mobile_contract_required", "$.mobileProfileRef");
  if (raw.copySetRef !== "functional.en@1") add("copy_unavailable", "$.copySetRef");
  const output = typeof raw.outputContractRef === "string" && own(catalog.outputs, raw.outputContractRef) ? catalog.outputs[raw.outputContractRef] : undefined;
  if (!output) add("output_unavailable", "$.outputContractRef");
  if (!Array.isArray(raw.decisions) || raw.decisions.length < 2 || raw.decisions.length > 12) add("decisions_required", "$.decisions");
  if (issues.length || !output) return { ok: false, issues };
  if (raw.bindingPackRef !== output.bindingPackRef) add("binding_pack_mismatch", "$.bindingPackRef");
  if (raw.essentialInteractionRef !== output.essentialInteractionRef) add("essential_interaction_required", "$.essentialInteractionRef");
  if (raw.viewerRef !== output.viewerRef) add("read_only_viewer_required", "$.viewerRef");
  if (!viewers.has(output.viewerRef) || output.viewerRef !== `${output.output}.read-only@1`) add("viewer_unavailable", "$.viewerRef");
  const ids = new Set<string>();
  const slots = new Set<string>();
  const dependencies: Record<string, string> = {};
  const resolved: Record<string, Interaction> = {};
  const copy: Record<string, string> = {};
  for (const [index, item] of (raw.decisions as unknown[]).entries()) {
    const path = `$.decisions.${index}`;
    if (!record(item) || !exactKeys(item, decisionKeys) || decisionKeys.some(key => typeof item[key] !== "string")) { add("decision_shape", path); continue; }
    const { id, interactionRef, bindingSlot, labelKey } = item as Record<string, string>;
    if (!/^[a-z][a-zA-Z0-9-]{0,63}$/.test(id) || ids.has(id)) add("decision_id", `${path}.id`);
    ids.add(id);
    if (slots.has(bindingSlot)) add("duplicate_binding", `${path}.bindingSlot`);
    slots.add(bindingSlot);
    const binding = output.bindings.find(binding => binding.slot === bindingSlot && binding.decisionId === id && binding.interactionRef === interactionRef && binding.target === output.output);
    if (!binding) add("binding_mismatch", path);
    if (!own(catalog.interactions, interactionRef)) { add("interaction_unavailable", `${path}.interactionRef`); continue; }
    const interaction = catalog.interactions[interactionRef];
    if (!own(renderers, interaction.kind) || renderers[interaction.kind] !== interaction.renderer) add("renderer_unavailable", path);
    if (interaction.id !== interactionRef || interaction.version !== 1 || valueIssues(interaction.defaultValue, interaction, path, false).length) add("interaction_default_invalid", path);
    if (!interaction.feedback || !interaction.renderer) add("interaction_feedback_required", path);
    if (!own(catalog.copy, labelKey) || labelKey !== `${output.output}.${id}`) add("copy_unavailable", `${path}.labelKey`);
    else copy[labelKey] = catalog.copy[labelKey];
    resolved[id] = interaction;
    dependencies[interactionRef] = await digest(interaction);
  }
  if (slots.size !== output.bindings.length || output.bindings.some(binding => !slots.has(binding.slot))) add("required_binding_missing", "$.decisions");
  if (!Object.values(resolved).some(item => item.id === output.essentialInteractionRef)) add("essential_interaction_required", "$.decisions");
  if (issues.length) return { ok: false, issues };
  dependencies[output.id] = await digest(output);
  dependencies[output.bindingPackRef] = await digest(output.bindings);
  dependencies[output.viewerRef] = await digest({ viewer: output.viewerRef, mode: "read-only", handoff: "controller-only" });
  dependencies["touch.standard@1"] = await digest({ minTarget: 44, minInputText: 16, minWidth: 320, tapAlternative: true, gestureOwnership: "local", noAutoplay: true });
  dependencies["functional.en@1"] = await digest(copy);
  const definition = structuredClone(raw) as Definition;
  const definitionHash = await digest(definition);
  const releaseHash = await digest({ compiler: "forma-experience-compiler@1", catalog: catalog.version, qualification: catalog.qualification, definitionHash, dependencies });
  return { ok: true, release: freeze({ schemaVersion: 1, qualification: "fixture", definition, output: structuredClone(output), interactions: structuredClone(resolved), copy, definitionHash, releaseHash, dependencies }) };
}

export function valueIssues(value: unknown, interaction: Interaction, path: string, complete: boolean): Issue[] {
  if (jsonIssues(value).length) return [{ code: "invalid_value", path }];
  const fail = (code = "invalid_value") => [{ code, path }];
  if (interaction.options) return typeof value === "string" && interaction.options.some(option => option.value === value) ? [] : fail("choice_unavailable");
  if (interaction.kind === "source") {
    if (typeof value !== "string" || value.length > interaction.maxLength) return fail("text_limit");
    return complete && interaction.required && !value.trim() ? fail("required") : [];
  }
  if (interaction.kind === "order") {
    if (!Array.isArray(value) || value.length !== 3) return fail("order_shape");
    const ids = new Set<string>();
    for (const item of value) {
      if (!record(item) || !exactKeys(item, ["id", "text"]) || typeof item.id !== "string" || !["e1", "e2", "e3"].includes(item.id) || ids.has(item.id) || typeof item.text !== "string" || item.text.length > interaction.maxLength) return fail("order_shape");
      ids.add(item.id);
      if (complete && !item.text.trim()) return fail("required");
    }
    return [];
  }
  const fieldIds = interaction.fields?.map(field => field.id) ?? [];
  if (!record(value) || !exactKeys(value, fieldIds)) return fail("field_shape");
  for (const id of fieldIds) {
    const item = value[id];
    if (interaction.kind === "relationship") {
      if (typeof item !== "string" || item.length > interaction.maxLength) return fail("text_limit");
      if (complete && !item.trim()) return fail("required");
    } else if (typeof item !== "number" || !Number.isSafeInteger(item) || item < interaction.minimum! || item > interaction.maximum!) return fail("range_limit");
  }
  return [];
}

export function sameRelease(a: CompiledRelease, b: CompiledRelease) { return a.releaseHash === b.releaseHash; }
