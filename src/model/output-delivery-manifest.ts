import type { OutputPlan } from "./output-plan.ts";
import { isOutputScopeAmendmentReason } from "./output-scope-amendment.ts";
import { OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH, OUTPUT_PLAN_TARGET_LABEL_MAX_LENGTH, OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT } from "./output-requirements.ts";

/** Portable obligation metadata only. Source prose and generation instructions never belong here. */
export type OutputDeliveryStatus = "complete" | "partial" | "unknown";
export type OutputDeliveryCompletionStatus = OutputDeliveryStatus | "complete_for_amended_scope";
export type OutputDeliveryScopeAmendmentInput = {
  id: string; previousPlanRevisionId: string; planRevisionId: string;
  occurredAt: string; reason: string; actorRole: "authorized_author" | "unknown";
  withdrawnObligations: Array<{ id: string; label: string }>;
  withdrawnTargets: Array<{ id: string; label: string }>;
};
export type OutputDeliveryScopeAmendment = Omit<OutputDeliveryScopeAmendmentInput, "withdrawnObligations" | "withdrawnTargets"> & {
  withdrawnObligations: Array<{ id: string; label: string; disposition: "withdrawn_from_previous_scope" }>;
  withdrawnTargets: Array<{ id: string; label: string; disposition: "withdrawn_from_previous_scope" }>;
};
export type OutputDeliveryScopeHistoryInput = {
  scopeHistoryComplete?: boolean;
  scopeAmendments?: OutputDeliveryScopeAmendmentInput[];
};
export type OutputDeliveryScopeHistoryManifest = {
  currentScopeStatus: OutputDeliveryStatus;
  deliveryStatus: OutputDeliveryCompletionStatus;
  scopeHistoryComplete: boolean;
  scopeAmendments: OutputDeliveryScopeAmendment[];
  completionQualification: "complete_for_current_scope" | "complete_for_amended_scope" | "current_scope_complete_history_unknown"
    | "partial_for_current_scope" | "partial_for_amended_scope" | "partial_scope_history_unknown" | "scope_completion_unknown";
  completionExplanation: string;
};
export type OutputDeliveryScopeGroup = { id: string; requirementId: string; label: string; required: boolean; obligationIds: string[] };
export type OutputDeliveryScopeObligation = {
  id: string; requirementId: string; deliverableId: string; label: string;
  required: boolean; selected: boolean; resolution: "resolved" | "unresolved"; targetIds: string[];
};
export type OutputDeliveryScopeTarget = { id: string; obligationId: string; label: string; reasonCodes: string[] };
export type OutputDeliveryScopeUnresolved = {
  id: string; requirementId: string; deliverableId: string | null; obligationId: string | null;
  label: string; required: boolean; selected: boolean; reasonCodes: string[];
};
export type OutputDeliveryScopeInput = {
  status: OutputDeliveryStatus; inventoryComplete: boolean; reasonCodes: string[];
  groups: OutputDeliveryScopeGroup[]; obligations: OutputDeliveryScopeObligation[];
  targets: OutputDeliveryScopeTarget[]; unresolvedGroups: OutputDeliveryScopeUnresolved[];
};
type ObligationState = "fulfilled" | "missing" | "unresolved" | "optional_off" | "unknown";
type TargetState = "included" | "missing" | "optional_off" | "unknown";
export type OutputDeliveryScopeManifest = Omit<OutputDeliveryScopeInput, "groups" | "obligations" | "targets" | "unresolvedGroups"> & {
  reasons: string[];
  groups: Array<OutputDeliveryScopeGroup & { deliveryState: ObligationState }>;
  obligations: Array<OutputDeliveryScopeObligation & { deliveryState: ObligationState }>;
  targets: Array<OutputDeliveryScopeTarget & { deliveryState: TargetState; reasons: string[] }>;
  unresolvedGroups: Array<OutputDeliveryScopeUnresolved & { deliveryState: "unresolved" | "optional_off"; reasons: string[] }>;
};
export type OutputDeliveryMissingWork = {
  kind: "missing_target" | "unresolved_group" | "empty_required_group" | "scope_unknown" | "scope_issue";
  id: string | null; requirementId: string | null; deliverableId: string | null; obligationId: string | null; targetId: string | null;
  label: string; required: boolean; selected: boolean; reasonCodes: string[]; reasons: string[];
};
export type OutputDeliveryScopeSummary = {
  inventoryComplete: boolean; requiredGroups: number; fulfilledRequiredGroups: number;
  requiredObligations: number; fulfilledRequiredObligations: number;
  selectedOptionalObligations: number; fulfilledSelectedOptionalObligations: number; optionalOffObligations: number;
  owedTargets: number; includedOwedTargets: number; missingOwedTargets: number;
  unresolvedRequiredGroups: number; unresolvedSelectedOptionalGroups: number;
};
export const MAX_OUTPUT_DELIVERY_SCOPE_ITEMS = OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT;
export const MAX_OUTPUT_DELIVERY_SCOPE_AMENDMENTS = 64;
export const MAX_OUTPUT_DELIVERY_WITHDRAWN_ITEMS = 4096;
const identity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u.test(value);
function requireValue(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
function id(value: unknown): string { requireValue(identity(value), "invalid_output_delivery_scope_id"); return value; }
function nullableId(value: unknown): string | null { return value === null ? null : id(value); }
function label(value: unknown, maximum = OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH): string {
  requireValue(typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(value), "invalid_output_delivery_scope_label");
  return value;
}
function flag(value: unknown): boolean { requireValue(typeof value === "boolean", "invalid_output_delivery_scope_flag"); return value; }
function ids(value: unknown): string[] {
  requireValue(Array.isArray(value) && value.length <= MAX_OUTPUT_DELIVERY_SCOPE_ITEMS, "invalid_output_delivery_scope_membership");
  const result = value.map(id); requireValue(new Set(result).size === result.length, "duplicate_output_delivery_scope_membership"); return result;
}
function codes(value: unknown): string[] {
  requireValue(Array.isArray(value) && value.length <= 32 && value.every(item => typeof item === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(item)), "invalid_output_delivery_reason_code");
  return [...new Set(value as string[])];
}
function rows<T>(input: unknown, convert: (value: Record<string, unknown>) => T & { id: string }): Array<T & { id: string }> {
  requireValue(Array.isArray(input) && input.length <= MAX_OUTPUT_DELIVERY_SCOPE_ITEMS, "invalid_output_delivery_scope_inventory");
  const result = input.map(value => { requireValue(value && typeof value === "object" && !Array.isArray(value), "invalid_output_delivery_scope_row"); return convert(value); });
  requireValue(new Set(result.map(value => value.id)).size === result.length, "duplicate_output_delivery_scope_id"); return result;
}

/** Fixed explanations avoid exporting freeform issue messages or source excerpts. */
export function outputDeliveryReason(code: string): string {
  const messages: Record<string, string> = {
    scope_not_supplied: "The full assignment inventory was not supplied; completion is unknown.",
    scope_unverified: "The full current assignment or its completion status has not been verified.",
    not_included_in_delivery: "No accepted file for this owed target is included in this delivery package.",
    optional_not_selected: "This optional work was not selected and is not owed in this delivery.",
    required_group_has_no_owed_members: "This required group has no agreed owed members; its scope must be resolved.",
    quantity_unresolved: "Agree a finite number of finished deliverables.",
    finite_members_required: "Resolve the finite membership before treating this group as complete.",
    series_membership_unresolved: "The series membership and number of videos have not been agreed.",
    coverage_unresolved: "Required content coverage still needs an explicit decision.",
    source_scope_unresolved: "The authorized source scope still needs an explicit decision.",
    content_count_policy_unresolved: "The permitted content length or count policy has not been confirmed.",
    aspect_ratio_unresolved: "The exact output aspect ratio still needs confirmation.",
    media_kind_unresolved: "The required media format has not been confirmed.",
    deliverables_unresolved: "The requested deliverables have not been enumerated.",
    no_finite_target: "This obligation has no finite production target yet.",
    target_limit_exceeded: "The requested finite work exceeds the current plan limit.",
    plan_inventory_limit_exceeded: "The full assignment inventory exceeds the current delivery metadata limit. No work has been removed; reduce or split the agreed scope explicitly before delivery.",
    not_accepted: "A current accepted result is not available for this target.",
    file_unavailable: "The accepted file is not currently available for delivery.",
    checks_failed: "Required file checks have not passed.",
    review_required: "An authorized reviewer has not accepted this result.",
    state_unknown: "The current result state has not been verified.",
    capability_unsupported: "The selected production method cannot yet fulfill this target.",
  };
  return messages[code] ?? `A plan decision remains unresolved (${code}).`;
}
const reasons = (values: readonly string[]) => values.map(outputDeliveryReason);

/** Whitelist complete plan membership without copying source/coverage prose. */
export function outputDeliveryScopeForPlan(
  plan: Pick<OutputPlan, "groups" | "obligations" | "targets" | "unresolved_groups" | "issues">,
  options: { status: OutputDeliveryStatus; inventoryComplete: boolean; includedTargetIds: readonly string[]; reasonCodes?: readonly string[] },
): OutputDeliveryScopeInput {
  const included = new Set(options.includedTargetIds);
  return {
    status: options.status, inventoryComplete: options.inventoryComplete, reasonCodes: [...(options.reasonCodes ?? plan.issues.map(issue => issue.code))],
    groups: plan.groups.map(group => ({ id: group.id, requirementId: group.requirement_id, label: group.label, required: group.required, obligationIds: [...group.obligation_ids] })),
    obligations: plan.obligations.map(obligation => ({ id: obligation.id, requirementId: obligation.requirement_id, deliverableId: obligation.deliverable_id, label: obligation.label, required: obligation.required, selected: obligation.selected, resolution: obligation.resolution, targetIds: [...obligation.target_ids] })),
    targets: plan.targets.map(target => ({ id: target.id, obligationId: target.obligation_id, label: target.label, reasonCodes: included.has(target.id) ? [] : [...new Set([...target.blocking_issues.map(issue => issue.code), "not_included_in_delivery"])] })),
    unresolvedGroups: plan.unresolved_groups.map(group => ({ id: group.id, requirementId: group.requirement_id, deliverableId: group.deliverable_id, obligationId: group.obligation_id, label: group.label, required: group.required, selected: group.selected, reasonCodes: group.issues.length ? [...new Set(group.issues.map(issue => issue.code))] : ["no_finite_target"] })),
  };
}

/** Validate internal consistency. Only the server can prove this is the whole authoritative plan. */
export function evaluateOutputDeliveryScope(input: OutputDeliveryScopeInput | undefined, includedTargetIds: readonly string[]): {
  deliveryStatus: OutputDeliveryStatus; scope: OutputDeliveryScopeManifest; summary: OutputDeliveryScopeSummary; missingWork: OutputDeliveryMissingWork[];
} {
  const raw = input ?? { status: "unknown", inventoryComplete: false, reasonCodes: ["scope_not_supplied"], groups: [], obligations: [], targets: [], unresolvedGroups: [] };
  requireValue(raw && ["complete", "partial", "unknown"].includes(raw.status), "invalid_output_delivery_scope_status");
  const inventoryComplete = flag(raw.inventoryComplete);
  requireValue(inventoryComplete || raw.status === "unknown", "output_delivery_incomplete_scope_claim");
  const reasonCodes = codes(raw.reasonCodes);
  if (raw.status === "unknown" && !reasonCodes.length) reasonCodes.push("scope_unverified");
  const groups: OutputDeliveryScopeGroup[] = rows(raw.groups, row => ({ id: id(row.id), requirementId: id(row.requirementId), label: label(row.label), required: flag(row.required), obligationIds: ids(row.obligationIds) }));
  const obligations: OutputDeliveryScopeObligation[] = rows(raw.obligations, row => {
    requireValue(row.resolution === "resolved" || row.resolution === "unresolved", "invalid_output_delivery_scope_resolution");
    return { id: id(row.id), requirementId: id(row.requirementId), deliverableId: id(row.deliverableId), label: label(row.label), required: flag(row.required), selected: flag(row.selected), resolution: row.resolution, targetIds: ids(row.targetIds) };
  });
  const targets: OutputDeliveryScopeTarget[] = rows(raw.targets, row => ({ id: id(row.id), obligationId: id(row.obligationId), label: label(row.label, OUTPUT_PLAN_TARGET_LABEL_MAX_LENGTH), reasonCodes: codes(row.reasonCodes) }));
  const unresolved: OutputDeliveryScopeUnresolved[] = rows(raw.unresolvedGroups, row => ({ id: id(row.id), requirementId: id(row.requirementId), deliverableId: nullableId(row.deliverableId), obligationId: nullableId(row.obligationId), label: label(row.label), required: flag(row.required), selected: flag(row.selected), reasonCodes: codes(row.reasonCodes) }));
  const groupById = new Map(groups.map(group => [group.id, group])), obligationById = new Map(obligations.map(obligation => [obligation.id, obligation])), targetById = new Map(targets.map(target => [target.id, target]));
  const included = new Set(ids([...includedTargetIds]));
  const owed = (entry: { required: boolean; selected: boolean }) => entry.required || entry.selected;
  for (const group of groups) for (const obligationId of group.obligationIds) {
    const obligation = obligationById.get(obligationId);
    requireValue(obligation && obligation.deliverableId === group.id && obligation.requirementId === group.requirementId, "output_delivery_scope_membership_mismatch");
  }
  for (const obligation of obligations) {
    const group = groupById.get(obligation.deliverableId);
    requireValue(group && group.obligationIds.includes(obligation.id) && group.requirementId === obligation.requirementId && (!obligation.required || group.required), "output_delivery_scope_membership_mismatch");
    requireValue(obligation.resolution !== "resolved" || obligation.targetIds.length > 0, "output_delivery_resolved_obligation_without_targets");
    for (const targetId of obligation.targetIds) requireValue(targetById.get(targetId)?.obligationId === obligation.id, "output_delivery_scope_membership_mismatch");
    requireValue(obligation.resolution !== "unresolved" || unresolved.some(group => group.obligationId === obligation.id), "output_delivery_missing_unresolved_descriptor");
  }
  for (const target of targets) requireValue(obligationById.get(target.obligationId)?.targetIds.includes(target.id), "output_delivery_scope_membership_mismatch");
  for (const group of unresolved) {
    requireValue(group.reasonCodes.length > 0, "output_delivery_missing_unresolved_reason");
    if (group.deliverableId !== null) requireValue(groupById.get(group.deliverableId)?.requirementId === group.requirementId, "output_delivery_scope_membership_mismatch");
    if (group.obligationId !== null) {
      const obligation = obligationById.get(group.obligationId);
      requireValue(obligation && obligation.resolution === "unresolved" && obligation.requirementId === group.requirementId && obligation.deliverableId === group.deliverableId && obligation.required === group.required && obligation.selected === group.selected, "output_delivery_scope_membership_mismatch");
    }
  }
  for (const targetId of included) {
    const target = targetById.get(targetId);
    if (!target && !inventoryComplete) continue;
    requireValue(target, "output_delivery_scope_target_mismatch");
    const obligation = obligationById.get(target.obligationId)!;
    requireValue(owed(obligation), "output_delivery_target_not_owed");
    requireValue(obligation.resolution === "resolved" && !target.reasonCodes.length, "output_delivery_unresolved_target_included");
  }
  const targetRows: OutputDeliveryScopeManifest["targets"] = targets.map(target => {
    const obligation = obligationById.get(target.obligationId)!;
    const state: TargetState = !owed(obligation) ? "optional_off" : included.has(target.id) ? "included" : inventoryComplete ? "missing" : "unknown";
    const reasonCodes = state === "optional_off" ? ["optional_not_selected"] : state === "included" ? [] : target.reasonCodes.length ? target.reasonCodes : ["not_included_in_delivery"];
    return { ...target, reasonCodes, deliveryState: state, reasons: reasons(reasonCodes) };
  });
  const obligationRows: OutputDeliveryScopeManifest["obligations"] = obligations.map(obligation => ({ ...obligation, deliveryState: !owed(obligation) ? "optional_off" : obligation.resolution === "unresolved" ? "unresolved" : obligation.targetIds.every(target => included.has(target)) ? "fulfilled" : inventoryComplete ? "missing" : "unknown" }));
  const obligationState = new Map(obligationRows.map(obligation => [obligation.id, obligation.deliveryState]));
  const unresolvedRows: OutputDeliveryScopeManifest["unresolvedGroups"] = unresolved.map(group => ({ ...group, deliveryState: owed(group) ? "unresolved" : "optional_off", reasons: reasons(owed(group) ? group.reasonCodes : ["optional_not_selected"]) }));
  const groupRows: OutputDeliveryScopeManifest["groups"] = groups.map(group => {
    const members = group.obligationIds.map(id => obligationById.get(id)!).filter(owed);
    const hasUnresolved = unresolved.some(entry => entry.deliverableId === group.id && owed(entry));
    const state: ObligationState = !group.required && !members.length ? "optional_off" : hasUnresolved ? "unresolved" : members.length && members.every(member => obligationState.get(member.id) === "fulfilled") ? "fulfilled" : inventoryComplete ? "missing" : "unknown";
    return { ...group, deliveryState: state };
  });
  const missingWork: OutputDeliveryMissingWork[] = [];
  if (!inventoryComplete || raw.status === "unknown") missingWork.push({ kind: "scope_unknown", id: null, requirementId: null, deliverableId: null, obligationId: null, targetId: null, label: "Assignment scope or completion is not verified", required: true, selected: true, reasonCodes: reasonCodes.length ? reasonCodes : ["scope_unverified"], reasons: reasons(reasonCodes.length ? reasonCodes : ["scope_unverified"]) });
  else if (reasonCodes.length) missingWork.push({ kind: "scope_issue", id: null, requirementId: null, deliverableId: null, obligationId: null, targetId: null, label: "Plan decisions remain", required: true, selected: true, reasonCodes, reasons: reasons(reasonCodes) });
  for (const target of targetRows.filter(target => target.deliveryState === "missing" || target.deliveryState === "unknown")) {
    const obligation = obligationById.get(target.obligationId)!;
    missingWork.push({ kind: "missing_target", id: target.id, requirementId: obligation.requirementId, deliverableId: obligation.deliverableId, obligationId: obligation.id, targetId: target.id, label: target.label, required: obligation.required, selected: obligation.selected, reasonCodes: target.reasonCodes, reasons: target.reasons });
  }
  for (const group of unresolvedRows.filter(group => group.deliveryState === "unresolved")) missingWork.push({ kind: "unresolved_group", id: group.id, requirementId: group.requirementId, deliverableId: group.deliverableId, obligationId: group.obligationId, targetId: null, label: group.label, required: group.required, selected: group.selected, reasonCodes: group.reasonCodes, reasons: group.reasons });
  for (const group of groups.filter(group => group.required && !group.obligationIds.some(id => owed(obligationById.get(id)!)))) missingWork.push({ kind: "empty_required_group", id: group.id, requirementId: group.requirementId, deliverableId: group.id, obligationId: null, targetId: null, label: group.label, required: true, selected: true, reasonCodes: ["required_group_has_no_owed_members"], reasons: reasons(["required_group_has_no_owed_members"]) });
  const required = obligationRows.filter(row => row.required), optionalSelected = obligationRows.filter(row => !row.required && row.selected), owedTargets = targetRows.filter(row => owed(obligationById.get(row.obligationId)!));
  const summary: OutputDeliveryScopeSummary = {
    inventoryComplete, requiredGroups: groupRows.filter(row => row.required).length, fulfilledRequiredGroups: groupRows.filter(row => row.required && row.deliveryState === "fulfilled").length,
    requiredObligations: required.length, fulfilledRequiredObligations: required.filter(row => row.deliveryState === "fulfilled").length,
    selectedOptionalObligations: optionalSelected.length, fulfilledSelectedOptionalObligations: optionalSelected.filter(row => row.deliveryState === "fulfilled").length,
    optionalOffObligations: obligationRows.filter(row => row.deliveryState === "optional_off").length, owedTargets: owedTargets.length,
    includedOwedTargets: owedTargets.filter(row => row.deliveryState === "included").length, missingOwedTargets: owedTargets.filter(row => row.deliveryState !== "included").length,
    unresolvedRequiredGroups: unresolvedRows.filter(row => row.required).length, unresolvedSelectedOptionalGroups: unresolvedRows.filter(row => !row.required && row.selected).length,
  };
  const complete = inventoryComplete && required.length + optionalSelected.length > 0 && missingWork.length === 0 && summary.fulfilledRequiredGroups === summary.requiredGroups;
  requireValue(raw.status === "unknown" || raw.status === (complete ? "complete" : "partial"), "output_delivery_scope_status_mismatch");
  return { deliveryStatus: raw.status, scope: { status: raw.status, inventoryComplete, reasonCodes, reasons: reasons(reasonCodes), groups: groupRows, obligations: obligationRows, targets: targetRows, unresolvedGroups: unresolvedRows }, summary, missingWork };
}

/**
 * Preserve only portable scope decisions. The server must verify the complete
 * ancestry and the withdrawn inventory against each prior authorized plan.
 * Locally consistent amendment records do not establish that ancestry.
 */
export function evaluateOutputDeliveryHistory(
  input: OutputDeliveryScopeHistoryInput,
  currentScopeStatus: OutputDeliveryStatus,
  createdAt: string,
  planRevision: string,
): OutputDeliveryScopeHistoryManifest {
  requireValue(input.scopeHistoryComplete === undefined || typeof input.scopeHistoryComplete === "boolean", "invalid_output_delivery_scope_history_flag");
  const scopeHistoryComplete = input.scopeHistoryComplete === true;
  const raw = input.scopeAmendments === undefined ? [] : input.scopeAmendments;
  requireValue(Array.isArray(raw) && raw.length <= MAX_OUTPUT_DELIVERY_SCOPE_AMENDMENTS, "invalid_output_delivery_scope_amendments");
  const eventIds = new Set<string>(), previousRefs = new Set<string>(), destinationRefs = new Set<string>();
  let previousTime = -Infinity, previousDestination: string | undefined, withdrawnItems = 0;
  const scopeAmendments: OutputDeliveryScopeAmendment[] = raw.map(row => {
    requireValue(row && typeof row === "object" && !Array.isArray(row), "invalid_output_delivery_scope_amendment");
    const amendmentId = id(row.id), previousPlanRevisionId = id(row.previousPlanRevisionId), planRevisionId = id(row.planRevisionId);
    requireValue(!eventIds.has(amendmentId) && previousPlanRevisionId !== planRevisionId && !previousRefs.has(previousPlanRevisionId)
      && !previousRefs.has(planRevisionId) && !destinationRefs.has(planRevisionId)
      && (!destinationRefs.has(previousPlanRevisionId) || previousPlanRevisionId === previousDestination)
      && previousPlanRevisionId !== planRevision, "output_delivery_scope_history_conflict");
    requireValue(typeof row.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.occurredAt)
      && Number.isFinite(Date.parse(row.occurredAt)) && new Date(row.occurredAt).toISOString() === row.occurredAt
      && Date.parse(row.occurredAt) >= previousTime && Date.parse(row.occurredAt) <= Date.parse(createdAt), "invalid_output_delivery_scope_amendment_date");
    requireValue(isOutputScopeAmendmentReason(row.reason, { required: true }), "invalid_output_delivery_scope_amendment_reason");
    requireValue(row.actorRole === "authorized_author" || row.actorRole === "unknown", "invalid_output_delivery_scope_amendment_actor_role");
    const withdraw = (values: unknown, maximum: number) => rows(values, value => ({ id: id(value.id), label: label(value.label, maximum), disposition: "withdrawn_from_previous_scope" as const }));
    const withdrawnObligations = withdraw(row.withdrawnObligations, OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH);
    const withdrawnTargets = withdraw(row.withdrawnTargets, OUTPUT_PLAN_TARGET_LABEL_MAX_LENGTH);
    const itemCount = withdrawnObligations.length + withdrawnTargets.length;
    requireValue(itemCount > 0, "output_delivery_empty_scope_amendment");
    withdrawnItems += itemCount;
    requireValue(withdrawnItems <= MAX_OUTPUT_DELIVERY_WITHDRAWN_ITEMS, "output_delivery_scope_history_too_large");
    eventIds.add(amendmentId); previousRefs.add(previousPlanRevisionId); destinationRefs.add(planRevisionId);
    previousTime = Date.parse(row.occurredAt); previousDestination = planRevisionId;
    return { id: amendmentId, previousPlanRevisionId, planRevisionId, occurredAt: row.occurredAt, reason: row.reason, actorRole: row.actorRole, withdrawnObligations, withdrawnTargets };
  });
  const amended = scopeAmendments.length > 0;
  let deliveryStatus: OutputDeliveryCompletionStatus = currentScopeStatus;
  let completionQualification: OutputDeliveryScopeHistoryManifest["completionQualification"];
  let completionExplanation: string;
  if (currentScopeStatus === "complete") {
    if (!scopeHistoryComplete) {
      deliveryStatus = "unknown"; completionQualification = "current_scope_complete_history_unknown";
      completionExplanation = "The current scope is complete, but its scope history is unverified; this package cannot claim unqualified completion. Known withdrawals, if any, are not counted as completion.";
    } else if (amended) {
      deliveryStatus = "complete_for_amended_scope"; completionQualification = "complete_for_amended_scope";
      completionExplanation = "Complete for amended scope only. The current owed work is covered and the scope withdrawals are retained. Withdrawal is not evidence of completion; withdrawn work is not counted as completed.";
    } else {
      completionQualification = "complete_for_current_scope";
      completionExplanation = "Complete for the current verified scope. The whole package covers the owed assignment and no scope withdrawals are recorded.";
    }
  } else if (currentScopeStatus === "partial") {
    completionQualification = !scopeHistoryComplete ? "partial_scope_history_unknown" : amended ? "partial_for_amended_scope" : "partial_for_current_scope";
    completionExplanation = "Partial delivery: current owed work remains."
      + (!scopeHistoryComplete ? " Scope history is unverified." : amended ? " This is an amended scope." : "")
      + (amended ? " Recorded withdrawals are retained and are not counted as completion." : "");
  } else {
    completionQualification = "scope_completion_unknown";
    completionExplanation = "Completion is unknown: the full current assignment or its status is not verified."
      + (!scopeHistoryComplete ? " Scope history is also unverified." : "")
      + (amended ? " Recorded withdrawals are retained and are not counted as completion." : "");
  }
  return { currentScopeStatus, deliveryStatus, scopeHistoryComplete, scopeAmendments, completionQualification, completionExplanation };
}
