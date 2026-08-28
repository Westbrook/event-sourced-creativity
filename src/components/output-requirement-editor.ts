import type { OutputCountPolicy, OutputMediaKind, OutputQuantity, OutputQuantityUnit, OutputRequirementSpec } from "../model/output-requirements.ts";

/** Transient text is deliberately separate from the canonical numeric contract. */
export type OutputQuantityDraft = {
  kind: "unknown" | "exact" | "range";
  unit: OutputQuantityUnit;
  exact: string;
  min: string;
  max: string;
};
export type OutputDraftIssue = "positiveInteger" | "positiveNumber" | "rangeIncomplete" | "rangeOrder" | "outsideRange";

export function outputQuantityToDraft(quantity: OutputQuantity): OutputQuantityDraft {
  return {
    kind: quantity.kind,
    unit: quantity.unit,
    exact: quantity.kind === "exact" ? String(quantity.value) : "",
    min: quantity.kind === "range" ? String(quantity.min) : "",
    max: quantity.kind === "range" ? String(quantity.max) : "",
  };
}

/** Blank is not zero. Invalid text is rejected without changing the field text. */
export function parseOutputDraftInteger(text: string): number | null {
  if (!/^[1-9]\d*$/u.test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function readOutputQuantityDraft(draft: OutputQuantityDraft): { quantity: OutputQuantity | null; issue: OutputDraftIssue | null } {
  const unknown: OutputQuantity = { kind: "unknown", unit: draft.unit };
  const parse = draft.unit === "second" ? (text: string): number | null => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text.trim())) return null;
    const value = Number(text.trim());
    return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
  } : parseOutputDraftInteger;
  const numericIssue = draft.unit === "second" ? "positiveNumber" : "positiveInteger";
  if (draft.kind === "unknown") return { quantity: unknown, issue: null };
  if (draft.kind === "exact") {
    if (!draft.exact.trim()) return { quantity: unknown, issue: null };
    const value = parse(draft.exact);
    return value === null ? { quantity: null, issue: numericIssue } : { quantity: { kind: "exact", unit: draft.unit, value }, issue: null };
  }
  if (!draft.min.trim() && !draft.max.trim()) return { quantity: unknown, issue: null };
  if (!draft.min.trim() || !draft.max.trim()) return { quantity: null, issue: "rangeIncomplete" };
  const min = parse(draft.min);
  const max = parse(draft.max);
  if (min === null || max === null) return { quantity: null, issue: numericIssue };
  if (min > max) return { quantity: null, issue: "rangeOrder" };
  return { quantity: { kind: "range", unit: draft.unit, min, max }, issue: null };
}

export type OutputCountPolicyDraft = { kind: "flexible" | "exact"; aim: string; exact: string };

/** A planning aim never replaces the authored range. Exactness is a deliberate choice. */
export function readOutputCountPolicyDraft(authored: OutputQuantity, draft: OutputCountPolicyDraft): {
  policy: OutputCountPolicy | null;
  suggestedCount: number | null;
  issue: OutputDraftIssue | null;
} {
  if (authored.kind === "unknown") return { policy: null, suggestedCount: null, issue: null };
  const min = authored.kind === "range" ? authored.min : authored.value;
  const max = authored.kind === "range" ? authored.max : authored.value;
  const text = draft.kind === "exact" ? draft.exact : draft.aim;
  if (!text.trim() && draft.kind === "flexible") return {
    policy: { kind: "flexible", unit: authored.unit, min, max }, suggestedCount: null, issue: null,
  };
  const value = parseOutputDraftInteger(text);
  if (value === null) return { policy: null, suggestedCount: null, issue: "positiveInteger" };
  if (value < min || value > max) return { policy: null, suggestedCount: null, issue: "outsideRange" };
  return draft.kind === "exact"
    ? { policy: { kind: "exact", unit: authored.unit, value }, suggestedCount: value, issue: null }
    : { policy: { kind: "flexible", unit: authored.unit, min, max, aim: value }, suggestedCount: value, issue: null };
}

export function outputMediaQuantityUnit(kind: OutputMediaKind): OutputQuantityUnit {
  if (kind === "slides") return "presentation";
  if (kind === "audio") return "episode";
  if (kind === "video") return "video";
  if (kind === "image") return "image";
  if (kind === "document") return "document";
  return "member";
}

export function outputDraftLines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

/** An earlier successful request must not dismiss edits made after that request. */
export function outputSaveReplyCanCloseDraft(replyId: string | undefined, pendingId: string | undefined, currentEditVersion: number, submittedEditVersion: number | undefined): boolean {
  return !!replyId && replyId === pendingId && submittedEditVersion !== undefined && currentEditVersion === submittedEditVersion;
}

/** Reorder by stable identity; indexes never become durable member identifiers. */
export function moveOutputDraftRow<T extends { id: string }>(rows: readonly T[], id: string, direction: -1 | 1): T[] {
  const index = rows.findIndex((row) => row.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return [...rows];
  const next = [...rows];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

export type OutputInterpretationPlanning = {
  countPolicies: Record<string, OutputCountPolicy>;
  suggestedCounts: Record<string, number>;
};
export type OutputInterpretationField = "group" | "identity" | "label" | "medium" | "required" | "quantity" | "contentQuantity" | "source" | "coverage" | "instructions" | "formats" | "ratio" | "placements" | "series" | "members" | "countPolicy" | "suggestedCount" | "draftText";
export type OutputInterpretationDecision = {
  key: string; ownerId: string; label: string; field: OutputInterpretationField; value: unknown;
};
export type OutputInterpretationChange = Omit<OutputInterpretationDecision, "value"> & {
  kind: "added" | "removed" | "changed"; before: unknown; after: unknown;
};

/** Persisted structure is not disposable merely because this edit session is new. */
export function outputReinterpretationNeedsConfirmation(spec: OutputRequirementSpec, structuredDirty: boolean): boolean {
  return structuredDirty || spec.deliverables.length > 0;
}

/** Every potentially overwritten author decision has a stable, comparable row. */
export function outputInterpretationDecisions(spec: OutputRequirementSpec, planning: OutputInterpretationPlanning): OutputInterpretationDecision[] {
  const rows: OutputInterpretationDecision[] = [];
  const add = (ownerId: string, label: string, field: OutputInterpretationField, value: unknown) => rows.push({ key: JSON.stringify([ownerId, field]), ownerId, label, field, value });
  const owners = new Map<string, string>([[spec.id, spec.label]]);
  add(spec.id, spec.label, "label", spec.label);
  add(spec.id, spec.label, "instructions", spec.original_text);
  add(spec.id, spec.label, "group", spec.deliverables.map((value) => ({ id: value.id, label: value.label })));
  for (const group of spec.deliverables) {
    owners.set(group.id, group.label);
    add(group.id, group.label, "identity", group.id);
    add(group.id, group.label, "label", group.label);
    add(group.id, group.label, "medium", group.media_kind);
    add(group.id, group.label, "required", group.required);
    add(group.id, group.label, "quantity", group.quantity);
    add(group.id, group.label, "contentQuantity", group.content_quantity ?? null);
    add(group.id, group.label, "source", group.source_scope);
    add(group.id, group.label, "coverage", group.coverage);
    add(group.id, group.label, "instructions", group.original_text);
    add(group.id, group.label, "formats", (group.format_variants ?? []).map((value) => ({ id: value.id, label: value.label })));
    for (const variant of group.format_variants ?? []) {
      owners.set(variant.id, variant.label);
      add(variant.id, variant.label, "identity", variant.id);
      add(variant.id, variant.label, "label", variant.label);
      add(variant.id, variant.label, "required", variant.required);
      add(variant.id, variant.label, "ratio", variant.aspect_ratio);
      add(variant.id, variant.label, "quantity", variant.quantity);
      add(variant.id, variant.label, "placements", variant.placements);
      add(variant.id, variant.label, "instructions", variant.original_text);
    }
    add(group.id, group.label, "series", group.series ? { state: group.series.state, description: group.series.description } : null);
    add(group.id, group.label, "members", (group.series?.members ?? []).map((value) => ({ id: value.id, label: value.label })));
    for (const member of group.series?.members ?? []) {
      owners.set(member.id, member.label);
      add(member.id, member.label, "identity", member.id);
      add(member.id, member.label, "label", member.label);
      add(member.id, member.label, "required", member.required);
      add(member.id, member.label, "quantity", member.quantity);
      add(member.id, member.label, "source", member.source_scope);
      add(member.id, member.label, "coverage", member.coverage);
      add(member.id, member.label, "instructions", member.original_text);
    }
  }
  const ownerForKey = (key: string) => [...owners.keys()].sort((left, right) => right.length - left.length).find((id) => key === id || key.startsWith(`${id}:`));
  for (const [key, value] of Object.entries(planning.countPolicies)) {
    const owner = ownerForKey(key);
    if (owner) rows.push({ key: JSON.stringify([key, "countPolicy"]), ownerId: owner, label: owners.get(owner)!, field: "countPolicy", value });
  }
  for (const [key, value] of Object.entries(planning.suggestedCounts)) {
    const owner = ownerForKey(key);
    if (owner) rows.push({ key: JSON.stringify([key, "suggestedCount"]), ownerId: owner, label: owners.get(owner)!, field: "suggestedCount", value });
  }
  return rows;
}

/** Canonical object-key order is not a decision; ordered arrays and stable IDs are. */
function interpretationValueKey(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => interpretationValueKey(entry)));
  if (value && typeof value === "object") return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, interpretationValueKey(entry)]));
  return JSON.stringify(value) ?? "undefined";
}

export function compareOutputInterpretations(before: OutputRequirementSpec, after: OutputRequirementSpec, beforePlanning: OutputInterpretationPlanning, afterPlanning: OutputInterpretationPlanning): OutputInterpretationChange[] {
  const previous = new Map(outputInterpretationDecisions(before, beforePlanning).map((row) => [row.key, row]));
  const next = new Map(outputInterpretationDecisions(after, afterPlanning).map((row) => [row.key, row]));
  const changes: OutputInterpretationChange[] = [];
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(key), proposed = next.get(key);
    if (old && proposed && interpretationValueKey(old.value) === interpretationValueKey(proposed.value)) continue;
    const identity = proposed ?? old!;
    changes.push({ key, ownerId: identity.ownerId, label: identity.label, field: identity.field, kind: !old ? "added" : !proposed ? "removed" : "changed", before: old?.value, after: proposed?.value });
  }
  return changes;
}

/** Reinterpretation keeps planning choices only when their exact authored quantity survives. */
export function retainOutputInterpretationPlanning(before: OutputRequirementSpec, after: OutputRequirementSpec, planning: OutputInterpretationPlanning): OutputInterpretationPlanning {
  const quantities = (spec: OutputRequirementSpec) => {
    const map = new Map<string, unknown>();
    for (const group of spec.deliverables) {
      map.set(group.id, group.content_quantity ?? group.quantity);
      map.set(`${group.id}:${group.quantity.unit}`, group.quantity);
      if (group.content_quantity) map.set(`${group.id}:${group.content_quantity.unit}`, group.content_quantity);
      for (const variant of group.format_variants ?? []) { map.set(variant.id, variant.quantity); map.set(`${variant.id}:${variant.quantity.unit}`, variant.quantity); }
      for (const member of group.series?.members ?? []) { map.set(member.id, member.quantity); map.set(`${member.id}:${member.quantity.unit}`, member.quantity); }
    }
    return map;
  };
  const old = quantities(before), proposed = quantities(after);
  const retained = (key: string) => old.has(key) && proposed.has(key) && interpretationValueKey(old.get(key)) === interpretationValueKey(proposed.get(key));
  return {
    countPolicies: structuredClone(Object.fromEntries(Object.entries(planning.countPolicies).filter(([key]) => retained(key)))),
    suggestedCounts: Object.fromEntries(Object.entries(planning.suggestedCounts).filter(([key]) => retained(key))),
  };
}
