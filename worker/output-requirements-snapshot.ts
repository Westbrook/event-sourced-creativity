import type { CreativeProjection } from "../src/model/events.ts";
import type { OutputRequirementsSnapshot } from "../src/model/output-delivery-contract.ts";
import type { OutputTrustedContext, OutputExecutionBridge } from "./output-requirements-api.ts";
import { summarizeOutputPlan, type OutputTargetState } from "../src/model/output-plan.ts";
import { outputScopeAmendmentReasonIssue } from "../src/model/output-scope-amendment.ts";
import { hasCapability } from "./principal-request-core.ts";
import { idPattern, record } from "./output-disclosure-proof.ts";
import { readOutputModel } from "./output-read-model-producer.ts";
import { outputExtractedSourceReferences } from "./output-source-evidence-capacity.ts";
import { OUTPUT_OWNED_SOURCE_OBJECT_CAPACITY, OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY, OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT } from "./output-trusted-context.ts";
import { outputRevision } from "./output-revision.ts";

function outputSourceNames(blocks: CreativeProjection["blocks"]) {
  const sources: Array<{ blockId: string; label: string }> = [];
  let sourcesComplete = blocks.length <= 32;
  for (const block of blocks.slice(0, 32)) {
    if (!idPattern.test(block.id)) { sourcesComplete = false; continue; }
    const authored = [block.properties.label, block.properties.title, block.handle].find((value) => typeof value === "string" && value.trim());
    const display = (typeof authored === "string" ? authored : "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
    const characters = [...display];
    if (characters.length > 120) sourcesComplete = false;
    sources.push({ blockId: block.id, label: characters.slice(0, 120).join("") });
  }
  return { sources, sourcesComplete };
}
function sourceCapacityDisclosure(trusted: OutputTrustedContext): OutputRequirementsSnapshot["sourceVerification"]["capacity"] {
  return { referenceCount: trusted.sourceEvidence.referenceCount, distinctObjectCount: trusted.sourceEvidence.distinctObjectCount,
    countsComplete: trusted.sourceEvidence.countsComplete, ownedReadLimit: OUTPUT_OWNED_SOURCE_OBJECT_CAPACITY, nativeLimit: OUTPUT_NATIVE_SOURCE_OBJECT_CAPACITY,
    ...outputSourceNames(outputExtractedSourceReferences(trusted.projection.blocks)) };
}
function sourceGovernanceDisclosure(trusted: OutputTrustedContext): OutputRequirementsSnapshot["sourceVerification"]["governance"] {
  if (trusted.scope.kind !== "project") return undefined;
  const fields = ["organization_context_package_id", "organization_context_package_version_id", "organization_context_package_binding_id", "organization_context_source_block_id"];
  const blocks = trusted.projection.blocks.filter((block) => fields.some((field) => block.properties[field] !== undefined && block.properties[field] !== null && block.properties[field] !== ""));
  // Names come only from the current authorized Document projection, never the
  // live origin rows traversed by the governance proof.
  return { captureBatchLimit: OUTPUT_GOVERNANCE_CAPTURE_BATCH_LIMIT, ...outputSourceNames(blocks) };
}

function retainedOutputAmendments(trusted: OutputTrustedContext) {
  return trusted.events.filter((event) => event.type === "OutputPlanConfirmed" && event.payload.document_id === trusted.scope.documentId && event.payload.project_id === trusted.scope.projectId && event.payload.scope_amendment !== undefined);
}

async function buildSnapshot(trusted: OutputTrustedContext, bridge?: OutputExecutionBridge): Promise<OutputRequirementsSnapshot> {
  const model = await readOutputModel(trusted);
  const { confirmedPlan, assets, grants } = model;
  const retainedAmendments = retainedOutputAmendments(trusted);
  const historyProblems = retainedAmendments.some((event) => outputScopeAmendmentReasonIssue(record(event.payload.scope_amendment).reason, { required: true })) ? ["output_scope_history_reason_unverified"] : [];
  const qualifyPackageSummary = (summary: NonNullable<OutputRequirementsSnapshot["summary"]>): NonNullable<OutputRequirementsSnapshot["summary"]> => historyProblems.length ? {
    ...summary, delivery_ready: false,
    ...(summary.completion === "complete" ? { completion: "unknown", headline: "The retained amendment history needs investigation before packaging." } : {}),
  } : summary;
  const sourceVerification: OutputRequirementsSnapshot["sourceVerification"] = { status: trusted.sourceProblems.length ? "unavailable" : "verified", reasonCodes: [...new Set(trusted.sourceProblems)], capacity: sourceCapacityDisclosure(trusted), governance: sourceGovernanceDisclosure(trusted) };
  const results = model.results.map((result) => ({ ...result, reviewAllowed: result.reviewAllowed && model.complete && sourceVerification.status === "verified" }));
  const memberships = confirmedPlan ? model.fulfillments.get(confirmedPlan.revisionId) : undefined;
  const targetStates: OutputTargetState[] = [];
  for (const target of confirmedPlan?.plan.targets ?? []) {
    const selectedAcceptance = memberships?.get(target.id);
    const fulfillment = selectedAcceptance ? { acceptance_id: selectedAcceptance } : null;
    const accepted = fulfillment ? results.find((candidate) => candidate.acceptanceId === fulfillment.acceptance_id && candidate.review === "approved" && candidate.targetContractDigest === confirmedPlan!.targetContractDigests[target.id]) : undefined;
    const candidate = accepted ?? results.find((result) => result.targetId === target.id && result.planRevisionId === confirmedPlan!.revisionId);
    const asset = candidate && assets.find((value) => value.id === candidate.assetId && value.sha256 === candidate.sha256 && value.available);
    const slot = grants.flatMap((grant) => grant.operations).find((operation) => operation.targetId === target.id);
    const freshness = confirmedPlan!.sourceDigest === trusted.sourceDigest && confirmedPlan!.requirementsDigest === trusted.requirementsDigest && !trusted.sourceProblems.length && (!candidate || candidate.sourceDigest === trusted.sourceDigest) ? "current" : "stale";
    // A GET does not claim bytes were freshly downloaded or content was reviewed; release rechecks both.
    const availability = !model.complete ? "unknown" : asset ? "available" : candidate ? "missing" : "unknown";
    const execution: OutputTargetState["execution"] = candidate ? "succeeded" : slot && ["queued", "running", "succeeded", "failed", "cancelled", "uncertain"].includes(slot.status) ? slot.status as OutputTargetState["execution"] : "not_started";
    targetStates.push({ target_id: target.id, execution, checks: candidate ? candidate.checksStatus === "passed" ? "passed" : candidate.checksStatus === "failed" ? "failed" : "unknown" : "not_checked",
      review: accepted ? "accepted" : candidate?.review === "changes_requested" ? "rejected" : candidate ? "pending" : "not_reviewed", freshness, availability,
      capability: asset ? "supported" : "unknown", export_available: Boolean(model.complete && accepted && asset && freshness === "current"), source_revision: trusted.sourceDigest, requirement_revision: trusted.requirementsDigest, ...(candidate ? { result_id: candidate.id } : {}) });
  }
  const capScope = trusted.projectContext ? { organizationId: trusted.projectContext.organizationId, projectAccessId: trusted.projectContext.projectAccessId } : undefined;
  const canAuthor = trusted.projectContext ? hasCapability(trusted.principal, "project.author", capScope) : ["creator", "admin"].includes(trusted.principal.role), canReview = trusted.projectContext ? hasCapability(trusted.principal, "project.review.approve", capScope) : canAuthor;
  const availability = { state: !model.complete ? "unavailable" as const : confirmedPlan?.requirementsDigest === trusted.requirementsDigest && confirmedPlan?.sourceDigest === trusted.sourceDigest && !trusted.sourceProblems.length ? "ready" as const : "stale" as const, source_revision: trusted.sourceDigest, requirement_revision: trusted.requirementsDigest };
  const requirementSummaries: OutputRequirementsSnapshot["requirementSummaries"] = {};
  const requirementFileCounts: OutputRequirementsSnapshot["requirementFileCounts"] = {};
  if (confirmedPlan) for (const requirement of trusted.requirements) {
    const filtered = { ...confirmedPlan.plan, groups: confirmedPlan.plan.groups.filter((group) => group.requirement_id === requirement.blockId), obligations: confirmedPlan.plan.obligations.filter((obligation) => obligation.requirement_id === requirement.blockId), targets: confirmedPlan.plan.targets.filter((target) => target.requirement_id === requirement.blockId), unresolved_groups: confirmedPlan.plan.unresolved_groups.filter((group) => group.requirement_id === requirement.blockId) };
    requirementSummaries[requirement.blockId] = qualifyPackageSummary(summarizeOutputPlan(filtered, targetStates.filter((state) => filtered.targets.some((target) => target.id === state.target_id)), availability));
    const acceptedFiles = new Set(targetStates.filter((state) => state.export_available && filtered.targets.some((target) => target.id === state.target_id)).map((state) => results.find((result) => result.id === state.result_id)?.assetId).filter((id): id is string => Boolean(id)));
    requirementFileCounts[requirement.blockId] = requirementSummaries[requirement.blockId].scope_known ? acceptedFiles.size : null;
  }
  for (const requirement of trusted.requirements) if (!(requirement.blockId in requirementFileCounts)) requirementFileCounts[requirement.blockId] = null;
  const scopeAmendments: OutputRequirementsSnapshot["scopeAmendments"] = retainedAmendments.map((event) => {
    const amendment = record(event.payload.scope_amendment);
    return { eventId: event.eventId, previousPlanRevisionId: String(amendment.previous_plan_revision_id ?? ""), planRevisionId: String(event.payload.plan_revision_id ?? ""), actorUserId: String(event.payload.actor_user_id ?? ""), occurredAt: event.occurredAt, reason: String(amendment.reason ?? ""), withdrawnTargetIds: Array.isArray(amendment.withdrawn_target_ids) ? amendment.withdrawn_target_ids.map(String) : [], withdrawnObligationIds: Array.isArray(amendment.withdrawn_obligation_ids) ? amendment.withdrawn_obligation_ids.map(String) : [] };
  });
  return { schemaVersion: 1, documentId: trusted.scope.documentId, projectId: trusted.scope.projectId,
    scope: { kind: trusted.scope.kind, organizationId: trusted.scope.organizationId, projectAccessId: trusted.scope.projectAccessId, actorUserId: trusted.scope.actorUserId },
    revision: outputRevision(trusted.ownerHead), requirementRevision: trusted.requirementsDigest, sourceRevision: trusted.sourceDigest, sourceVerification, requirements: trusted.requirements, confirmedPlan, targetStates,
    summary: confirmedPlan ? qualifyPackageSummary(summarizeOutputPlan(confirmedPlan.plan, targetStates, availability)) : null, requirementSummaries, requirementFileCounts, scopeAmendments,
    assets, results, grants, permissions: { canAuthor: model.complete && canAuthor, canRequest: model.complete && (trusted.projectContext ? hasCapability(trusted.principal, "project.output.request", capScope) : canAuthor), canReview: model.complete && canReview, canDownload: model.complete && (trusted.projectContext ? hasCapability(trusted.principal, "project.read", capScope) : true), independentReview: trusted.scope.kind === "project" },
    capabilities: { nativeGeneration: model.complete && Boolean(bridge), ownedFileAdoption: model.complete, supportedFileExtensions: ["png", "jpg", "wav", "mp3", "mp4", "pptx", "glb", "md"], limitations: ["Stored source and target versions are checked conservatively against the full Document.", "File inspection checks structure and measured properties; human content and rights review remains required.", ...trusted.sourceProblems, ...model.reasonCodes, ...historyProblems, ...(!bridge ? ["Native generation has no installed execution bridge."] : [])], limitationCodes: ["output_full_document_recheck", "output_inspection_requires_human_review", ...trusted.sourceProblems, ...model.reasonCodes, ...historyProblems, ...(!bridge ? ["output_native_execution_unavailable"] : [])] } };
}

export { buildSnapshot, retainedOutputAmendments };
