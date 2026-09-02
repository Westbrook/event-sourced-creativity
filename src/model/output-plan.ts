import { deriveOutputRequirementId, inspectOutputRequirement, isOutputRequirementId, outputRequirementInterpretationBasis, outputRequirementInterpretationNeedsReview, validateOutputCountPolicy, OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT, type OutputAspectRatio, type OutputCountPolicy, type OutputCoverage, type OutputDeliverable, type OutputIssue, type OutputMediaKind, type OutputQuantity, type OutputRequirementSpec, type OutputSourceScope } from "./output-requirements.ts";

export type OutputPlanOptions = {
  document_id: string;
  source_revision: string;
  requirement_revision: string;
  selected_optional_ids?: readonly string[];
  selected_target_ids?: readonly string[];
  count_policies?: Readonly<Record<string, OutputCountPolicy>>;
  suggested_counts?: Readonly<Record<string, number>>;
  max_targets?: number;
};
export type OutputPlanGroup = {
  id: string; requirement_id: string; label: string; media_kind: OutputMediaKind; required: boolean;
  obligation_ids: string[];
};
export type OutputPlanObligation = {
  id: string; requirement_id: string; deliverable_id: string; variant_id: string | null; member_id: string | null;
  label: string; media_kind: OutputMediaKind; required: boolean; selected: boolean; quantity: OutputQuantity;
  quantity_policy: OutputCountPolicy | null;
  target_ids: string[]; resolution: "resolved" | "unresolved";
};
export type OutputPlanTarget = {
  id: string; requirement_id: string; deliverable_id: string; obligation_id: string;
  variant_id: string | null; member_id: string | null; label: string; media_kind: OutputMediaKind;
  required: boolean; selected: boolean; ordinal: number;
  quantity: { kind: "exact"; unit: OutputQuantity["unit"]; value: 1 };
  aspect_ratio: OutputAspectRatio | null;
  source_scope: OutputSourceScope; coverage: OutputCoverage;
  content_quantity: OutputQuantity | null;
  count_policy: OutputCountPolicy | null;
  suggested_count: number | null;
  instruction_text: string;
  source_revision: string; requirement_revision: string;
  blocking_issues: OutputIssue[];
};
/** Compatibility alias for consumers that call a finite plan target an OutputTarget. */
export type OutputTarget = OutputPlanTarget;
export type OutputUnresolvedGroup = {
  id: string; requirement_id: string; deliverable_id: string | null; obligation_id: string | null;
  label: string; required: boolean; selected: boolean; issues: OutputIssue[];
};
export type OutputPlan = {
  schema_version: 1;
  document_id: string; source_revision: string; requirement_revision: string;
  groups: OutputPlanGroup[]; obligations: OutputPlanObligation[]; targets: OutputPlanTarget[];
  unresolved_groups: OutputUnresolvedGroup[]; issues: OutputIssue[];
};
/** Every dimension is independent. These must be projected from authoritative records, not provider claims. */
export type OutputTargetState = {
  target_id: string;
  execution: "not_started" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "uncertain";
  checks: "not_checked" | "running" | "passed" | "failed" | "unknown";
  review: "not_reviewed" | "pending" | "accepted" | "rejected" | "unknown";
  freshness: "current" | "stale" | "unknown";
  availability: "available" | "missing" | "inaccessible" | "unknown";
  capability: "supported" | "unsupported" | "unknown";
  export_available: boolean;
  source_revision: string;
  requirement_revision: string;
  result_id?: string;
};
export type OutputPlanAvailability = {
  state: "ready" | "loading" | "partial" | "unavailable" | "stale";
  source_revision?: string; requirement_revision?: string; reason?: string;
};
export type OutputPlanAction = {
  kind: "resolve" | "refresh" | "recover" | "check" | "review" | "create" | "download";
  target_id?: string; group_id?: string; label: string; reason: string;
};
export type OutputPlanSummary = {
  completion: "not_requested" | "unresolved" | "not_started" | "partial" | "complete" | "unknown";
  scope_known: boolean;
  required_groups: number; fulfilled_required_groups: number;
  required_obligations: number; optional_obligations: number; selected_optional_obligations: number;
  fulfilled_required_obligations: number; fulfilled_selected_optional_obligations: number;
  required_targets: number; optional_targets: number; selected_targets: number; fulfilled_targets: number;
  unresolved_required_groups: number; unresolved_selected_optional_groups: number;
  unknown_target_states: number;
  delivery_ready: boolean;
  headline: string;
  reasons: string[];
  next_actions: OutputPlanAction[];
};

const issue = (code: string, path: string, message: string): OutputIssue => ({ code, path, message });
const validIdentity = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const copy = <T>(value: T): T => structuredClone(value);
const allIds = (spec: OutputRequirementSpec) => [spec.id, ...spec.deliverables.flatMap((entry) => [entry.id, ...(entry.format_variants ?? []).map((item) => item.id), ...(entry.series?.members ?? []).map((item) => item.id)])];

function policyFor(options: OutputPlanOptions, subjectId: string, deliverableId: string, unit: OutputQuantity["unit"]): OutputCountPolicy | null {
  const keys = [`${subjectId}:${unit}`, subjectId, `${deliverableId}:${unit}`, deliverableId];
  for (const key of keys) {
    const policy = options.count_policies?.[key];
    if (policy && policy.unit === unit) return copy(policy);
  }
  return null;
}

function finiteCount(quantity: OutputQuantity, policy: OutputCountPolicy | null, path: string): { count: number | null; issues: OutputIssue[] } {
  if (policy) {
    const issues = validateOutputCountPolicy(quantity, policy).map((entry) => ({ ...entry, path: `${path}.${entry.path}` }));
    if (issues.length) return { count: null, issues };
    if (policy.kind === "exact") return { count: policy.value, issues: [] };
    return { count: null, issues: [issue("finite_members_required", path, "Choose an exact finite number of finished deliverables. Flexible content length does not create an implicit expansion contract.")] };
  }
  return quantity.kind === "exact" ? { count: quantity.value, issues: [] } : { count: null, issues: [issue("quantity_unresolved", path, quantity.kind === "unknown" ? quantity.reason ?? "Agree the number of finished deliverables." : "Choose a count within the authored range before creating individual targets.")] };
}

/** This compiles obligations and finite work only. A confirmed plan is not an execution grant. */
export function compileOutputPlan(specs: readonly OutputRequirementSpec[], options: OutputPlanOptions): OutputPlan {
  const plan: OutputPlan = { schema_version: 1, document_id: options.document_id, source_revision: options.source_revision, requirement_revision: options.requirement_revision, groups: [], obligations: [], targets: [], unresolved_groups: [], issues: [] };
  for (const key of ["document_id", "source_revision", "requirement_revision"] as const) if (!validIdentity(options[key])) plan.issues.push(issue("missing_plan_identity", key, "A current Document and source/requirement revision are required."));
  const maxTargets = options.max_targets === undefined ? 1000 : options.max_targets;
  if (!Number.isSafeInteger(maxTargets) || maxTargets < 1 || maxTargets > 1000) plan.issues.push(issue("invalid_target_limit", "max_targets", "The finite target limit must be a whole number between 1 and 1000."));
  const targetLimit = Number.isSafeInteger(maxTargets) && maxTargets > 0 && maxTargets <= 1000 ? maxTargets : 1000;
  const inspections = specs.map((spec) => inspectOutputRequirement(spec));
  const interpretationIssues = new Map(inspections.flatMap((inspection) => {
    const spec = inspection.spec;
    if (!spec || !outputRequirementInterpretationNeedsReview(spec)) return [];
    return [[spec.id, issue("interpretation_review_required", `${spec.id}.value_origins.interpretation_basis`, outputRequirementInterpretationBasis(spec) === null
      ? "This saved requirement has no known interpretation basis. Review the retained decisions and explicitly keep them, or confirm a new interpretation, before production."
      : "The wording changed while the earlier decisions were retained. Review both and explicitly keep the displayed decisions, or confirm a new interpretation, before production.")] as const];
  }));
  const contentUnits = new Map(inspections.flatMap((inspection) => inspection.spec?.deliverables.map((entry) => [entry.id, entry.content_quantity?.unit] as const) ?? []));
  const owners = new Map<string, number>();
  const conflicts = new Set<number>();
  for (const [index, inspection] of inspections.entries()) if (inspection.spec) for (const id of allIds(inspection.spec)) {
    const previousOwner = owners.get(id);
    if (previousOwner !== undefined && previousOwner !== index) { conflicts.add(index); conflicts.add(previousOwner); }
    else owners.set(id, index);
  }
  const selectedOptional = new Set(options.selected_optional_ids ?? []);
  const selectedTargets = options.selected_target_ids === undefined ? null : new Set(options.selected_target_ids);
  for (const id of selectedOptional) if (!owners.has(id)) plan.issues.push(issue("unknown_optional_selection", "selected_optional_ids", `The selected optional identity ${id} is not in this requirement revision.`));
  const unresolved = (requirementId: string, deliverableId: string | null, obligationId: string | null, label: string, required: boolean, selected: boolean, issues: OutputIssue[]) => {
    plan.unresolved_groups.push({ id: deriveOutputRequirementId(obligationId ?? deliverableId ?? requirementId, "unresolved"), requirement_id: requirementId, deliverable_id: deliverableId, obligation_id: obligationId, label, required, selected, issues });
  };

  const compileObligation = (spec: OutputRequirementSpec, entry: OutputDeliverable, row: {
    id: string; variant_id?: string; member_id?: string; label: string; required: boolean; quantity: OutputQuantity;
    aspect_ratio?: OutputAspectRatio | null; source_scope?: OutputSourceScope; coverage?: OutputCoverage; instruction_text: string;
    extra_issues?: OutputIssue[];
  }) => {
    const required = entry.required && row.required;
    const optionalIncluded = !required && [spec.id, entry.id, row.id].some((id) => selectedOptional.has(id));
    const selected = required || optionalIncluded;
    const quantityPolicy = policyFor(options, row.id, entry.id, row.quantity.unit);
    const obligation: OutputPlanObligation = { id: row.id, requirement_id: spec.id, deliverable_id: entry.id, variant_id: row.variant_id ?? null, member_id: row.member_id ?? null, label: row.label, media_kind: entry.media_kind, required, selected, quantity: copy(row.quantity), quantity_policy: copy(quantityPolicy ?? (row.quantity.kind === "exact" ? { kind: "exact", unit: row.quantity.unit, value: row.quantity.value } : null)), target_ids: [], resolution: "unresolved" };
    plan.obligations.push(obligation);
    plan.groups.find((group) => group.id === entry.id)!.obligation_ids.push(row.id);
    const quantityResolution = finiteCount(row.quantity, quantityPolicy, `${row.id}.quantity`);
    const blocking = [...quantityResolution.issues, ...(row.extra_issues ?? [])];
    const interpretationIssue = interpretationIssues.get(spec.id);
    if (interpretationIssue) blocking.push(interpretationIssue);
    const source = row.source_scope ?? entry.source_scope, coverage = row.coverage ?? entry.coverage;
    if (entry.media_kind === "unknown") blocking.push(issue("media_kind_unresolved", `${row.id}.media_kind`, "Choose the requested media before creating work."));
    if (source.kind === "unknown") blocking.push(issue("source_scope_unresolved", `${row.id}.source_scope`, source.reason));
    if (coverage.kind === "unresolved") blocking.push(issue("coverage_unresolved", `${row.id}.coverage`, coverage.description));
    if (row.variant_id && !row.aspect_ratio) blocking.push(issue("aspect_ratio_unresolved", `${row.id}.aspect_ratio`, "Resolve the exact format before production."));
    let contentPolicy: OutputCountPolicy | null = null;
    const contentQuantity = entry.content_quantity ?? null;
    if (contentQuantity) {
      contentPolicy = policyFor(options, row.id, entry.id, contentQuantity.unit);
      if (!contentPolicy && contentQuantity.kind === "exact") contentPolicy = { kind: "exact", unit: contentQuantity.unit, value: contentQuantity.value };
      if (contentPolicy) blocking.push(...validateOutputCountPolicy(contentQuantity, contentPolicy).map((value) => ({ ...value, path: `${row.id}.content_quantity.${value.path}` })));
      else blocking.push(issue("content_count_policy_unresolved", `${row.id}.content_quantity`, contentQuantity.kind === "unknown" ? contentQuantity.reason ?? "Agree the content length before production." : "Accept bounded flexibility or choose an exact count within the authored range."));
    }
    const suggestion = options.suggested_counts?.[row.id] ?? options.suggested_counts?.[entry.id] ?? null;
    const validSuggestion = suggestion !== null && contentQuantity !== null && Number.isFinite(suggestion) && suggestion > 0 && (contentQuantity.unit === "second" || Number.isSafeInteger(suggestion)) && (contentQuantity.kind === "unknown" || contentQuantity.kind === "exact" && suggestion === contentQuantity.value || contentQuantity.kind === "range" && suggestion >= contentQuantity.min && suggestion <= contentQuantity.max);
    if (suggestion !== null && !validSuggestion) plan.issues.push(issue("invalid_count_suggestion", `${row.id}.suggested_count`, "The suggestion must respect the authored content constraint. It does not change that constraint."));
    const count = quantityResolution.count;
    if (count !== null && (!Number.isSafeInteger(count) || count < 1 || count + plan.targets.length > targetLimit)) blocking.push(issue("target_limit_exceeded", `${row.id}.quantity`, `The plan must stay within ${targetLimit} explicitly enumerated targets.`));
    if (count !== null && Number.isSafeInteger(count) && count > 0 && count + plan.targets.length <= targetLimit && !(row.extra_issues ?? []).some((entry) => entry.code === "series_membership_unresolved")) {
      for (let ordinal = 1; ordinal <= count; ordinal++) {
        const targetId = `${row.id}:target:${ordinal}`;
        const chosenByTarget = selectedTargets?.has(targetId) ?? false;
        const targetSelected = selectedTargets === null ? selected : chosenByTarget;
        if (!required && chosenByTarget) obligation.selected = true;
        const target: OutputPlanTarget = { id: targetId, requirement_id: spec.id, deliverable_id: entry.id, obligation_id: row.id, variant_id: row.variant_id ?? null, member_id: row.member_id ?? null, label: count === 1 ? row.label : `${row.label} ${ordinal}`, media_kind: entry.media_kind, required, selected: targetSelected, ordinal, quantity: { kind: "exact", unit: row.quantity.unit, value: 1 }, aspect_ratio: copy(row.aspect_ratio ?? null), source_scope: copy(source), coverage: copy(coverage), content_quantity: copy(contentQuantity), count_policy: copy(contentPolicy), suggested_count: validSuggestion ? suggestion : null, instruction_text: row.instruction_text, source_revision: options.source_revision, requirement_revision: options.requirement_revision, blocking_issues: copy(blocking) };
        plan.targets.push(target);
        obligation.target_ids.push(targetId);
      }
    }
    obligation.resolution = blocking.length || !obligation.target_ids.length ? "unresolved" : "resolved";
    if (obligation.resolution === "unresolved") unresolved(spec.id, entry.id, row.id, row.label, required, obligation.selected, blocking.length ? blocking : [issue("no_finite_target", row.id, "Agree finite work for this obligation.")]);
  };

  for (const [index, inspection] of inspections.entries()) {
    const spec = inspection.spec;
    if (!spec || conflicts.has(index)) {
      const raw = specs[index] as unknown as Record<string, unknown>;
      const id = isOutputRequirementId(raw?.id) ? raw.id : `unreadable-requirement-${index + 1}`;
      const errors = conflicts.has(index) ? [issue("duplicate_scope_identity", id, "Requirement identities conflict across this Document. Resolve the conflict before interpreting or executing this plan.")] : inspection.issues;
      plan.issues.push(...errors);
      unresolved(id, null, null, "Requirement needs attention", true, true, errors);
      continue;
    }
    if (!spec.deliverables.length) {
      const interpretationIssue = interpretationIssues.get(spec.id);
      unresolved(spec.id, null, null, spec.label, true, true, [issue("deliverables_unresolved", spec.id, "Describe the requested deliverables. An empty interpretation does not satisfy the request."), ...(interpretationIssue ? [interpretationIssue] : [])]);
      continue;
    }
    for (const entry of spec.deliverables) {
      plan.groups.push({ id: entry.id, requirement_id: spec.id, label: entry.label, media_kind: entry.media_kind, required: entry.required, obligation_ids: [] });
      if (entry.series && entry.series.state === "unresolved") {
        compileObligation(spec, entry, { id: deriveOutputRequirementId(entry.id, "membership"), label: entry.label, required: true, quantity: { kind: "unknown", unit: entry.quantity.unit, reason: entry.series.description }, instruction_text: entry.original_text, extra_issues: [issue("series_membership_unresolved", `${entry.id}.series`, entry.series.description)] });
      } else if (entry.series) {
        for (const member of entry.series.members) compileObligation(spec, entry, { id: member.id, member_id: member.id, label: member.label, required: member.required, quantity: member.quantity, source_scope: member.source_scope, coverage: member.coverage, instruction_text: member.original_text });
      } else if (entry.format_variants?.length) {
        for (const variant of entry.format_variants) compileObligation(spec, entry, { id: variant.id, variant_id: variant.id, label: variant.label, required: variant.required, quantity: variant.quantity, aspect_ratio: variant.aspect_ratio, instruction_text: variant.original_text });
      } else compileObligation(spec, entry, { id: entry.id, label: entry.label, required: true, quantity: entry.quantity, instruction_text: entry.original_text });
    }
  }
  if (selectedTargets) for (const id of selectedTargets) if (!plan.targets.some((entry) => entry.id === id)) plan.issues.push(issue("unknown_target_selection", "selected_target_ids", `The selected target ${id} is not a finite target in this revision.`));
  const recognizedPolicyKeys = new Set<string>();
  for (const entry of plan.obligations) for (const id of [entry.id, entry.deliverable_id]) {
    recognizedPolicyKeys.add(id);
    for (const unit of ["presentation", "slide", "episode", "video", "image", "second", "document", "model", "member"]) recognizedPolicyKeys.add(`${id}:${unit}`);
  }
  for (const [key, policy] of Object.entries(options.count_policies ?? {})) {
    if (!recognizedPolicyKeys.has(key)) plan.issues.push(issue("unknown_count_policy_target", `count_policies.${key}`, "This count decision refers to an item outside the compiled requirement revision."));
    else if (!policy || typeof policy !== "object" || !["exact", "flexible"].includes(policy.kind)) plan.issues.push(issue("invalid_count_policy", `count_policies.${key}`, "Expected an exact or flexible count policy."));
    else {
      const entries = plan.obligations.filter((entry) => key === entry.id || key === entry.deliverable_id || key.startsWith(`${entry.id}:`) || key.startsWith(`${entry.deliverable_id}:`));
      const expectedUnits = entries.flatMap((entry) => [entry.quantity.unit, contentUnits.get(entry.deliverable_id)]);
      if (!expectedUnits.includes(policy.unit)) plan.issues.push(issue("count_policy_unit_mismatch", `count_policies.${key}`, "This policy's unit does not apply to its target."));
    }
  }
  for (const [name, rows] of [["groups", plan.groups], ["obligations", plan.obligations], ["targets", plan.targets], ["unresolved_groups", plan.unresolved_groups]] as const) {
    if (rows.length > OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT) plan.issues.push(issue("plan_inventory_limit_exceeded", name, `This assignment contains ${rows.length} ${name}, exceeding the current ${OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT}-row portable scope limit. Every row is retained; review the assignment before confirmation.`));
    if (new Set(rows.map((row) => row.id)).size !== rows.length) plan.issues.push(issue("duplicate_plan_identity", name, "A derived planning identity conflicts with another row. Preserve the draft and resolve the identity conflict before confirmation."));
  }
  return plan;
}

/** An authoritative caller can use this only after establishing that no existing result/job applies. */
export function initialOutputTargetState(target: OutputPlanTarget, capability: OutputTargetState["capability"] = "unknown"): OutputTargetState {
  return { target_id: target.id, execution: "not_started", checks: "not_checked", review: "not_reviewed", freshness: "current", availability: "missing", capability, export_available: false, source_revision: target.source_revision, requirement_revision: target.requirement_revision };
}

/** A shared projection of fulfillment, not an authorization check or proof of measured media. */
export function summarizeOutputPlan(plan: OutputPlan, states: readonly OutputTargetState[] = [], availability: OutputPlanAvailability = { state: "ready" }): OutputPlanSummary {
  const revisionMatches = (availability.source_revision === undefined || availability.source_revision === plan.source_revision) && (availability.requirement_revision === undefined || availability.requirement_revision === plan.requirement_revision);
  const statesById = new Map<string, OutputTargetState>();
  const duplicateStateIds = new Set<string>();
  for (const state of states) {
    if (statesById.has(state.target_id)) duplicateStateIds.add(state.target_id);
    statesById.set(state.target_id, state);
  }
  const scopeKnown = availability.state === "ready" && revisionMatches && !plan.issues.length && !duplicateStateIds.size;
  const reasons = plan.issues.map((entry) => entry.message);
  if (availability.state !== "ready") reasons.push(availability.reason ?? "The complete, current assignment is not available. Visible rows are not the full denominator.");
  if (!revisionMatches) reasons.push("The visible state belongs to a different source or requirement revision. Refresh before acting.");
  if (duplicateStateIds.size) reasons.push("Conflicting target states must be refreshed before determining completion.");
  const fulfilled = new Set<string>();
  let unknownStates = 0;
  const actions: OutputPlanAction[] = [];
  for (const target of plan.targets) {
    const state = statesById.get(target.id);
    if (!state || duplicateStateIds.has(target.id)) { unknownStates++; continue; }
    const current = state.freshness === "current" && state.source_revision === target.source_revision && state.requirement_revision === target.requirement_revision;
    const ready = !target.blocking_issues.length && current && state.checks === "passed" && state.review === "accepted" && state.availability === "available" && state.export_available === true && validIdentity(state.result_id);
    if (ready) fulfilled.add(target.id);
    const owed = target.required || plan.obligations.find((entry) => entry.id === target.obligation_id)?.selected;
    if (!scopeKnown || !owed) continue;
    if (target.blocking_issues.length) continue;
    if (!current) actions.push({ kind: "check", target_id: target.id, label: "Recheck stored work", reason: "Keep historical work; verify its current source and requirement bindings before release." });
    else if (state.execution === "uncertain") actions.push({ kind: "recover", target_id: target.id, label: "Reconcile the previous attempt", reason: "Provider acceptance or cost is uncertain. Do not submit another paid attempt yet." });
    else if (state.availability === "available" && state.checks !== "passed") actions.push({ kind: "check", target_id: target.id, label: "Check stored result", reason: "Verify the existing file before considering regeneration." });
    else if (state.availability === "available" && state.checks === "passed" && state.review !== "accepted") actions.push({ kind: "review", target_id: target.id, label: "Review result", reason: "Successful generation and automated checks do not replace required acceptance." });
    else if (ready) actions.push({ kind: "download", target_id: target.id, label: "Review delivery", reason: "This result satisfies the projected checks. The server must still verify current access and release authority." });
    else if (state.availability === "inaccessible" || state.availability === "unknown" || state.availability === "available" && !state.export_available) actions.push({ kind: "recover", target_id: target.id, label: "Resolve file availability", reason: "An inaccessible file or missing export cannot be counted as delivered." });
    else if (["failed", "cancelled"].includes(state.execution)) actions.push({ kind: "recover", target_id: target.id, label: "Review recovery options", reason: "Check retained work and the prior operation before authorizing any new paid work." });
    else if (state.capability === "unsupported") actions.push({ kind: "resolve", target_id: target.id, label: "Choose a supported fulfillment route", reason: "The requested obligation remains owed; unsupported generation does not fulfill or remove it." });
    else if (state.capability === "unknown") actions.push({ kind: "check", target_id: target.id, label: "Check production capability", reason: "Confirm that a route can satisfy the target before preparing execution." });
    else if (state.execution === "not_started" && !target.selected) actions.push({ kind: "resolve", target_id: target.id, label: "Plan remaining required work", reason: "This obligation remains owed but is not selected for this run. Decide when and how to fulfill it; no work is dispatched by this view." });
    else if (state.execution === "not_started") actions.push({ kind: "create", target_id: target.id, label: "Review creation", reason: "Review the finite work, source transmission, route, calls, and spending authorization before dispatch." });
  }
  const obligationFulfilled = (entry: OutputPlanObligation) => entry.resolution === "resolved" && entry.target_ids.length > 0 && entry.target_ids.every((id) => fulfilled.has(id));
  const required = plan.obligations.filter((entry) => entry.required), optional = plan.obligations.filter((entry) => !entry.required), includedOptional = optional.filter((entry) => entry.selected);
  const fulfilledRequired = required.filter(obligationFulfilled).length, fulfilledOptional = includedOptional.filter(obligationFulfilled).length;
  const requiredGroups = plan.groups.filter((entry) => entry.required);
  const fulfilledGroups = requiredGroups.filter((group) => {
    const owed = plan.obligations.filter((entry) => group.obligation_ids.includes(entry.id) && (entry.required || entry.selected));
    return owed.length > 0 && owed.every(obligationFulfilled);
  }).length;
  const unresolvedRequired = plan.unresolved_groups.filter((entry) => entry.required), unresolvedOptional = plan.unresolved_groups.filter((entry) => !entry.required && entry.selected);
  for (const group of [...unresolvedRequired, ...unresolvedOptional]) {
    reasons.push(...group.issues.map((entry) => entry.message));
    if (scopeKnown) actions.unshift({ kind: "resolve", group_id: group.id, label: "Resolve output plan", reason: group.issues.map((entry) => entry.message).join(" ") });
  }
  const hasRequest = plan.groups.length > 0 || plan.unresolved_groups.length > 0;
  const complete = hasRequest && scopeKnown && required.length + includedOptional.length > 0 && fulfilledRequired === required.length && fulfilledOptional === includedOptional.length && fulfilledGroups === requiredGroups.length && unresolvedRequired.length === 0 && unresolvedOptional.length === 0;
  const anyWork = states.some((state) => plan.targets.some((target) => target.id === state.target_id) && (state.execution !== "not_started" || state.availability === "available"));
  let completion: OutputPlanSummary["completion"] = !hasRequest ? "not_requested" : complete ? "complete" : unresolvedRequired.length + unresolvedOptional.length ? "unresolved" : anyWork ? "partial" : "not_started";
  const missingOwedState = plan.targets.some((target) => (target.required || plan.obligations.find((entry) => entry.id === target.obligation_id)?.selected) && !statesById.has(target.id));
  if (!scopeKnown || missingOwedState && !unresolvedRequired.length && !unresolvedOptional.length) completion = "unknown";
  if (unknownStates) reasons.push(`${unknownStates} finite target${unknownStates === 1 ? " has" : "s have"} no available state; do not infer that no prior work exists.`);
  if (!scopeKnown || missingOwedState && !unresolvedRequired.length && !unresolvedOptional.length) actions.splice(0, actions.length, { kind: "refresh", label: "Refresh complete output state", reason: "Get the complete current assignment and target state before taking consequential action." });
  const headlines: Record<OutputPlanSummary["completion"], string> = { not_requested: "No outputs requested", unresolved: "Output decisions remain", not_started: "Work has not started", partial: "Assignment partly fulfilled", complete: "Assignment ready for delivery review", unknown: "Completion is not yet known" };
  return { completion, scope_known: scopeKnown, required_groups: requiredGroups.length, fulfilled_required_groups: fulfilledGroups, required_obligations: required.length, optional_obligations: optional.length, selected_optional_obligations: includedOptional.length, fulfilled_required_obligations: fulfilledRequired, fulfilled_selected_optional_obligations: fulfilledOptional, required_targets: plan.targets.filter((entry) => entry.required).length, optional_targets: plan.targets.filter((entry) => !entry.required).length, selected_targets: plan.targets.filter((entry) => entry.selected).length, fulfilled_targets: fulfilled.size, unresolved_required_groups: unresolvedRequired.length, unresolved_selected_optional_groups: unresolvedOptional.length, unknown_target_states: unknownStates, delivery_ready: complete, headline: headlines[completion], reasons: [...new Set(reasons)], next_actions: actions };
}
