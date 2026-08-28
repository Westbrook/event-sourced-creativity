import type { OutputConfirmationOptions, OutputRequirementRow, OutputRequirementsSnapshot } from "../model/output-delivery-contract.ts";
import type { OutputCountPolicy, OutputQuantity, OutputQuantityUnit } from "../model/output-requirements.ts";
import { outputScopeAmendmentReasonIssue } from "../model/output-scope-amendment.ts";
import { compileOutputPlan, type OutputPlan } from "../model/output-plan.ts";

export type OutputPlanningSnapshot = Pick<OutputRequirementsSnapshot, "documentId" | "projectId" | "scope" | "revision" | "requirementRevision" | "sourceRevision" | "requirements" | "confirmedPlan" | "permissions">;
export type OutputPlanCountField = { kind: "unresolved" | "exact" | "flexible"; exact: string; min: string; max: string; aim: string };
export type OutputPlanProposalDraft = {
  options: OutputConfirmationOptions;
  amendmentReason: string;
  /** Raw fields survive invalid edits, refresh, conflict, closing, and re-opening. */
  countFields: Record<string, { quantity: OutputQuantity; field: OutputPlanCountField }>;
};
export type OutputPlanProposalBase = {
  scopeKey: string;
  semanticKey: string;
  ownerRevision: string;
  documentId: string;
  requirementRevision: string;
  sourceRevision: string;
  requirements: OutputRequirementRow[];
  options: OutputConfirmationOptions;
};
export type OutputPlanProposalState = {
  base: OutputPlanProposalBase;
  latest: OutputPlanProposalBase;
  draft: OutputPlanProposalDraft;
  dirty: boolean;
  editVersion: number;
  acknowledgment: { semanticKey: string; editVersion: number } | null;
};
export type OutputPlanConfirmationCapture = {
  expectedRevision: string;
  semanticKey: string;
  editVersion: number;
  options: OutputConfirmationOptions;
  amendmentReason: string;
};

const copy = <T>(value: T): T => structuredClone(value);
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function rowIds(row: OutputRequirementRow): string[] {
  return [row.blockId, ...(row.spec ? [row.spec.id, ...row.spec.deliverables.flatMap((group) => [group.id, ...(group.format_variants ?? []).map((variant) => variant.id), ...(group.series?.members ?? []).map((member) => member.id)])] : [])];
}

/** Confirmed choices are authoritative until a newer saved requirement proposal exists. */
export function outputSavedPlanningOptions(snapshot: OutputPlanningSnapshot): OutputConfirmationOptions {
  const confirmed = snapshot.confirmedPlan?.confirmationOptions ?? {};
  if (snapshot.confirmedPlan?.requirementsDigest === snapshot.requirementRevision) return copy(confirmed);
  const count_policies: Record<string, OutputCountPolicy> = {};
  const suggested_counts: Record<string, number> = {};
  const ids = new Set(snapshot.requirements.flatMap(rowIds));
  for (const row of snapshot.requirements) {
    const owned = rowIds(row);
    const belongs = (key: string) => owned.some((id) => key === id || key.startsWith(`${id}:`));
    const proposal = row.planSuggestions;
    // Missing legacy proposals may inherit the confirmed choice. An explicit empty proposal clears it.
    for (const [key, value] of Object.entries(proposal?.count_policies ?? (proposal ? {} : confirmed.count_policies ?? {}))) if (belongs(key)) count_policies[key] = copy(value);
    for (const [key, value] of Object.entries(proposal?.suggested_counts ?? (proposal ? {} : confirmed.suggested_counts ?? {}))) if (belongs(key)) suggested_counts[key] = value;
  }
  const currentPlan = compileOutputPlan(snapshot.requirements.flatMap((row) => row.spec ? [row.spec] : []), {
    document_id: snapshot.documentId, source_revision: snapshot.sourceRevision,
    requirement_revision: snapshot.requirementRevision, count_policies, suggested_counts,
  });
  const optional = new Map(currentPlan.obligations.filter((row) => !row.required).map((row) => [row.id, row]));
  const optionalIds = new Set([...optional.values()].flatMap((row) => [row.id, row.deliverable_id, row.requirement_id]).filter((id) => ids.has(id)));
  const selected = new Set((confirmed.selected_optional_ids ?? []).filter((id) => optionalIds.has(id)));
  // A target filter can commit an optional obligation without an explicit optional ID.
  // Retain that whole obligation after a Save, but never infer a new parent or sibling choice.
  for (const previous of snapshot.confirmedPlan?.plan?.obligations ?? []) {
    if (previous.required || !previous.selected || !optionalIds.has(previous.id)) continue;
    const current = optional.get(previous.id);
    if (current && current.requirement_id === previous.requirement_id && current.deliverable_id === previous.deliverable_id
      && current.variant_id === previous.variant_id && current.member_id === previous.member_id
      && current.media_kind === previous.media_kind && current.quantity.unit === previous.quantity.unit) selected.add(current.id);
  }
  return { selected_optional_ids: [...selected], count_policies, suggested_counts };
}

/** A changed owner event head alone does not change the planning contract. */
export function captureOutputPlanProposalBase(snapshot: OutputPlanningSnapshot, scopeKey: string): OutputPlanProposalBase {
  const options = outputSavedPlanningOptions(snapshot);
  const semanticKey = stable({ scopeKey, documentId: snapshot.documentId, projectId: snapshot.projectId, scope: snapshot.scope,
    requirementRevision: snapshot.requirementRevision, sourceRevision: snapshot.sourceRevision,
    requirements: snapshot.requirements.map((row) => ({ blockId: row.blockId, subtype: row.subtype, content: row.content, locked: row.locked, status: row.status, spec: row.spec, preserved: row.preserved, planSuggestions: row.planSuggestions })),
    confirmedPlan: snapshot.confirmedPlan ? { revisionId: snapshot.confirmedPlan.revisionId, options: snapshot.confirmedPlan.confirmationOptions } : null,
    canAuthor: snapshot.permissions.canAuthor, options });
  return { scopeKey, semanticKey, ownerRevision: snapshot.revision, documentId: snapshot.documentId, requirementRevision: snapshot.requirementRevision, sourceRevision: snapshot.sourceRevision, requirements: copy(snapshot.requirements), options };
}
function fresh(base: OutputPlanProposalBase, editVersion = 0): OutputPlanProposalState {
  return { base, latest: base, draft: { options: copy(base.options), amendmentReason: "", countFields: {} }, dirty: false, editVersion, acknowledgment: null };
}
export function observeOutputPlanProposal(state: OutputPlanProposalState | null, snapshot: OutputPlanningSnapshot, scopeKey: string): OutputPlanProposalState {
  const latest = captureOutputPlanProposalBase(snapshot, scopeKey);
  if (!state || state.base.scopeKey !== scopeKey || state.base.documentId !== snapshot.documentId) return fresh(latest);
  if (!state.dirty) return fresh(latest, state.editVersion);
  if (state.base.semanticKey === latest.semanticKey) return { ...state, base: latest, latest, acknowledgment: null };
  return { ...state, latest, acknowledgment: state.acknowledgment?.semanticKey === latest.semanticKey ? state.acknowledgment : null };
}
export function outputPlanProposalConflicts(state: OutputPlanProposalState): boolean { return state.base.semanticKey !== state.latest.semanticKey; }
export function editOutputPlanProposal(state: OutputPlanProposalState, patch: Partial<OutputPlanProposalDraft>): OutputPlanProposalState {
  return { ...state, draft: { ...state.draft, ...copy(patch) }, dirty: true, editVersion: state.editVersion + 1, acknowledgment: null };
}

function draftPlan(state: OutputPlanProposalState): OutputPlan {
  return compileOutputPlan(state.base.requirements.flatMap((row) => row.spec ? [row.spec] : []), {
    document_id: state.base.documentId, source_revision: state.base.sourceRevision,
    requirement_revision: state.base.requirementRevision, ...state.draft.options,
  });
}
function optionalObligations(plan: OutputPlan, id: string) {
  return plan.obligations.filter((obligation) => !obligation.required
    && [obligation.id, obligation.deliverable_id, obligation.requirement_id].includes(id));
}
/** Read the effective compiled choice, including optional work included by a target filter or parent. */
export function outputPlanOptionalChoice(plan: OutputPlan, id: string): { checked: boolean; mixed: boolean } {
  const affected = optionalObligations(plan, id), selected = affected.filter((obligation) => obligation.selected).length;
  return { checked: affected.length > 0 && selected === affected.length, mixed: selected > 0 && selected < affected.length };
}
/** Explicit local representation change only. The owed denominator and unrelated draft fields stay intact. */
export function includeOutputPlanCommittedTargets(state: OutputPlanProposalState): OutputPlanProposalState | null {
  if (state.draft.options.selected_target_ids === undefined || outputPlanProposalConflicts(state)) return null;
  const plan = draftPlan(state), options = copy(state.draft.options), owners = new Set(state.base.requirements.flatMap(rowIds));
  const selected = new Set(options.selected_optional_ids ?? []);
  for (const obligation of plan.obligations) {
    if (!obligation.required && obligation.selected && owners.has(obligation.id)) selected.add(obligation.id);
  }
  options.selected_optional_ids = [...selected];
  delete options.selected_target_ids;
  return editOutputPlanProposal(state, { options });
}
/** A direct optional choice changes only its affected obligations, not sibling commitments inherited from a parent. */
export function editOutputPlanOptionalChoice(state: OutputPlanProposalState, id: string, checked: boolean): OutputPlanProposalState | null {
  if (state.draft.options.selected_target_ids !== undefined) return null;
  const plan = draftPlan(state), affected = new Set(optionalObligations(plan, id).map((obligation) => obligation.id));
  if (!affected.size) return null;
  const owners = new Set(state.base.requirements.flatMap(rowIds)), options = copy(state.draft.options);
  // Keep unrelated and invalid draft IDs; this action must not silently repair or discard another choice.
  const selected = new Set((options.selected_optional_ids ?? []).filter((candidate) => !optionalObligations(plan, candidate).length));
  for (const obligation of plan.obligations) {
    if (obligation.required || !(affected.has(obligation.id) ? checked : obligation.selected)) continue;
    const selectionId = owners.has(obligation.id) ? obligation.id : obligation.deliverable_id;
    if (owners.has(selectionId)) selected.add(selectionId);
  }
  options.selected_optional_ids = [...selected];
  return editOutputPlanProposal(state, { options });
}
export function discardOutputPlanProposal(state: OutputPlanProposalState): OutputPlanProposalState { return fresh(state.latest, state.editVersion + 1); }
export function acknowledgeOutputPlanProposal(state: OutputPlanProposalState, checked: boolean): OutputPlanProposalState {
  return { ...state, acknowledgment: checked && outputPlanProposalConflicts(state) ? { semanticKey: state.latest.semanticKey, editVersion: state.editVersion } : null };
}
export function outputPlanProposalCanReapply(state: OutputPlanProposalState): boolean {
  return outputPlanProposalConflicts(state) && state.acknowledgment?.semanticKey === state.latest.semanticKey && state.acknowledgment.editVersion === state.editVersion;
}
/** Reapplication stages local choices only; it never overwrites source/specs or dispatches work. */
export function reapplyOutputPlanProposal(state: OutputPlanProposalState): OutputPlanProposalState | null {
  return outputPlanProposalCanReapply(state) ? { ...state, base: state.latest, editVersion: state.editVersion + 1, acknowledgment: null } : null;
}
export function outputPlanProposalHasInvalidFields(state: OutputPlanProposalState): boolean {
  const quantities = new Map<string, OutputQuantity>();
  for (const row of state.base.requirements) for (const group of row.spec?.deliverables ?? []) {
    quantities.set(`${group.id}:${group.quantity.unit}`, group.quantity);
    if (group.content_quantity) quantities.set(`${group.id}:${group.content_quantity.unit}`, group.content_quantity);
    for (const child of [...(group.format_variants ?? []), ...(group.series?.members ?? [])]) {
      quantities.set(`${child.id}:${child.quantity.unit}`, child.quantity);
      if (group.content_quantity) quantities.set(`${child.id}:${group.content_quantity.unit}`, group.content_quantity);
    }
  }
  return Object.entries(state.draft.countFields).some(([key, { field }]) => {
    const quantity = quantities.get(key);
    return !quantity || readOutputPlanCountField(quantity, field).invalid;
  });
}
export function captureOutputPlanConfirmation(state: OutputPlanProposalState, snapshot: OutputPlanningSnapshot, scopeKey: string): OutputPlanConfirmationCapture | null {
  const current = captureOutputPlanProposalBase(snapshot, scopeKey);
  if (outputPlanProposalConflicts(state) || current.semanticKey !== state.base.semanticKey || outputPlanProposalHasInvalidFields(state)
    || outputScopeAmendmentReasonIssue(state.draft.amendmentReason) || !snapshot.permissions.canAuthor) return null;
  return { expectedRevision: current.ownerRevision, semanticKey: current.semanticKey, editVersion: state.editVersion, options: copy(state.draft.options),
    amendmentReason: state.draft.amendmentReason.trim() ? state.draft.amendmentReason : "" };
}
export function outputPlanConfirmationCanClose(state: OutputPlanProposalState, capture: OutputPlanConfirmationCapture): boolean {
  return state.editVersion === capture.editVersion;
}

/** Keep this ordering identical to output-plan.policyFor; a plain key must not mask a qualified key. */
export function resolveOutputPlanningCountPolicy(options: OutputConfirmationOptions, subjectId: string, deliverableId: string, unit: OutputQuantityUnit): { key: string; policy: OutputCountPolicy } | null {
  for (const key of [`${subjectId}:${unit}`, subjectId, `${deliverableId}:${unit}`, deliverableId]) {
    const policy = options.count_policies?.[key];
    if (policy?.unit === unit) return { key, policy: copy(policy) };
  }
  return null;
}
export function outputPlanCountField(options: OutputConfirmationOptions, subjectId: string, deliverableId: string, quantity: OutputQuantity): OutputPlanCountField {
  const policy = resolveOutputPlanningCountPolicy(options, subjectId, deliverableId, quantity.unit)?.policy;
  const aim = options.suggested_counts?.[subjectId] ?? options.suggested_counts?.[deliverableId] ?? (policy?.kind === "flexible" ? policy.aim : undefined);
  return { kind: policy?.kind ?? "unresolved", exact: policy?.kind === "exact" ? String(policy.value) : "", min: policy?.kind === "flexible" ? String(policy.min) : quantity.kind === "range" ? String(quantity.min) : "", max: policy?.kind === "flexible" ? String(policy.max) : quantity.kind === "range" ? String(quantity.max) : "", aim: aim === undefined ? "" : String(aim) };
}
function numeric(text: string, unit: OutputQuantityUnit): number | null {
  if (!(unit === "second" ? /^(?:0|[1-9]\d*)(?:\.\d+)?$/u : /^[1-9]\d*$/u).test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER && (unit === "second" || Number.isSafeInteger(value)) ? value : null;
}
export function readOutputPlanCountField(quantity: OutputQuantity, field: OutputPlanCountField): { policy: OutputCountPolicy | null; suggestedCount: number | null; invalid: boolean } {
  const fail = { policy: null, suggestedCount: null, invalid: true };
  const within = (value: number) => {
    if (quantity.kind === "unknown") return true;
    return quantity.kind === "exact" ? value === quantity.value : value >= quantity.min && value <= quantity.max;
  };
  const aim = field.aim.trim() ? numeric(field.aim, quantity.unit) : null;
  if (field.aim.trim() && (aim === null || !within(aim))) return fail;
  if (field.kind === "unresolved") return { policy: null, suggestedCount: aim, invalid: false };
  if (field.kind === "exact") {
    const value = numeric(field.exact, quantity.unit);
    return value === null || !within(value) ? fail : { policy: { kind: "exact", unit: quantity.unit, value }, suggestedCount: aim, invalid: false };
  }
  const min = numeric(field.min, quantity.unit), max = numeric(field.max, quantity.unit);
  if (min === null || max === null || min > max || !within(min) || !within(max) || aim !== null && (aim < min || aim > max)) return fail;
  return { policy: { kind: "flexible", unit: quantity.unit, min, max, ...(aim === null ? {} : { aim }) }, suggestedCount: aim, invalid: false };
}
export function editOutputPlanCountField(state: OutputPlanProposalState, subjectId: string, quantity: OutputQuantity, field: OutputPlanCountField): OutputPlanProposalState {
  const read = readOutputPlanCountField(quantity, field);
  const options = copy(state.draft.options);
  if (!read.invalid) {
    const policies = { ...options.count_policies };
    // Replace the effective qualified alias and any same-unit plain alias, while retaining other units.
    delete policies[`${subjectId}:${quantity.unit}`];
    if (policies[subjectId]?.unit === quantity.unit) delete policies[subjectId];
    if (read.policy) policies[`${subjectId}:${quantity.unit}`] = read.policy;
    const suggested = { ...options.suggested_counts };
    if (read.suggestedCount === null) delete suggested[subjectId]; else suggested[subjectId] = read.suggestedCount;
    options.count_policies = policies;
    options.suggested_counts = suggested;
  }
  return editOutputPlanProposal(state, { options, countFields: { ...state.draft.countFields, [`${subjectId}:${quantity.unit}`]: { quantity: copy(quantity), field: copy(field) } } });
}

/** Focus restoration is scoped to the opening view, never a replacement Document or session. */
export function outputPlanFocusMayRestore(openingViewKey: string, currentViewKey: string, openerConnected: boolean): boolean {
  return openerConnected && openingViewKey === currentViewKey;
}
