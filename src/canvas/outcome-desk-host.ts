import type { OutputResultRow } from "../model/output-delivery-contract.ts";
import { captureOutputNavigation, outputNavigationMatches, type OutputNavigationReference, type OutputNavigationSection } from "../model/output-navigation.ts";
import { outputCompletedNativeChoices, outputOperationRecovery, outputReusableAcceptanceChoices } from "../components/output-controller-recovery.ts";
import { outputDeliveryReadiness, outputNativeReadiness, outputSourceReadiness } from "../components/output-source-readiness.ts";
import type { ArtifactDeliveryIntent, artifactDeliveryState } from "../model/artifact-delivery.ts";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactRevision, type DocumentArtifact } from "../model/document-artifacts.ts";
import {
  creativeActionSourceRevision, creativeNextActions, creativeNextTargetAvailable, creativePreparationChoice,
  type CreativeActionScope, type CreativeNextAction, type CreativeNextTarget,
} from "../model/workspace-intelligence.ts";
import { outcomeDeskKey, outcomeDeskOutputRead, outcomeDeskOutputSnapshot, projectOutcomeDesk, type OutcomeDeskAction, type OutcomeDeskInput, type OutcomeDeskRow } from "../model/outcome-desk.ts";

type Delivery = ReturnType<typeof artifactDeliveryState>;
export type OutcomeDeskTarget = { kind: "canonical-output"; reference: OutputNavigationReference; section: OutputNavigationSection; refresh: boolean }
  | { kind: "next"; action: CreativeNextAction } | {
  kind: "delivery"; artifactId: string; sequence: number; revision: number;
  sourceEventId: string; contentRef: string | null; intent: ArtifactDeliveryIntent; proof: string;
};
export type OutcomeDeskHostPorts = {
  localize: (id: string, fallback: string) => string;
  delivery: (artifact: DocumentArtifact) => Delivery;
};
const scopeFor = (input: OutcomeDeskInput): CreativeActionScope => ({
  projectId: input.facts.projectId, documentId: input.facts.documentId,
  canvasId: input.facts.canvasId ?? null, authorityKey: input.facts.authorityKey,
});
const deliveryProof = (delivery: Delivery) => JSON.stringify({
  revision: delivery.revision, review: delivery.review, approved: delivery.approved, canRead: delivery.canRead,
  action: delivery.action, intent: delivery.intent, rightsBlockIds: delivery.rightsBlockIds,
  independentEligible: delivery.independentEligible, contentSha256: delivery.contentSha256,
  assignedReviewerId: delivery.assignedReviewerId,
});
function wrap(row: OutcomeDeskRow, input: OutcomeDeskInput, action: CreativeNextAction, ports: OutcomeDeskHostPorts,
  copyId: string = action.id): OutcomeDeskAction<OutcomeDeskTarget> {
  return { key: row.key + ":" + action.id + ":" + JSON.stringify(action.target), subject: row.reference,
    scope: scopeFor(input), sourceRevision: creativeActionSourceRevision(input.facts), effect: "open-existing-executor",
    label: ports.localize("next.exact." + copyId + ".label", action.label),
    detail: ports.localize("next.exact." + copyId + ".reason", action.reason), target: { kind: "next", action } };
}
function deliveryAction(row: OutcomeDeskRow, input: OutcomeDeskInput, artifact: DocumentArtifact, ports: OutcomeDeskHostPorts): OutcomeDeskAction<OutcomeDeskTarget> {
  const delivery = ports.delivery(artifact), proof = deliveryProof(delivery);
  return { key: row.key + ":delivery:" + artifact.id + ":" + proof, subject: row.reference,
    scope: scopeFor(input), sourceRevision: creativeActionSourceRevision(input.facts), effect: "open-existing-executor",
    label: ports.localize("artifact.delivery.action." + delivery.action, delivery.action),
    detail: ports.localize("next.exact.open-output.reason", "Inspect this exact saved output without starting another generation."),
    target: { kind: "delivery", artifactId: artifact.id, sequence: artifact.sequence,
      revision: documentArtifactRevision(input.facts.events ?? [], artifact.id), sourceEventId: artifact.sourceEventId,
      contentRef: artifact.contentRef ?? null, intent: delivery.intent, proof } };
}


function outputAction(row: OutcomeDeskRow, input: OutcomeDeskInput, ports: OutcomeDeskHostPorts, section: OutputNavigationSection,
  label: string, fallback: string, detailKey: string, detail: string, reference = row.navigation!, refresh = false): OutcomeDeskAction<OutcomeDeskTarget> {
  return { key: row.key + ":output:" + section + ":" + label + ":" + JSON.stringify(reference), subject: row.reference,
    scope: scopeFor(input), sourceRevision: creativeActionSourceRevision(input.facts), effect: "open-existing-executor",
    label: ports.localize(label, fallback), detail: ports.localize(detailKey, detail),
    target: { kind: "canonical-output", reference, section, refresh } };
}
/** Guidance opens the existing controller; it never turns a summary action into permission to execute. */
function canonicalOutputActions(row: OutcomeDeskRow, input: OutcomeDeskInput, ports: OutcomeDeskHostPorts): readonly OutcomeDeskAction<OutcomeDeskTarget>[] {
  const snapshot = outcomeDeskOutputSnapshot(input), reference = row.navigation;
  if (!reference) return [];
  if (row.retained) return [outputAction(row, input, ports, "inspect", "output.delivery.refresh", "Refresh outputs",
    "output.delivery.scopeUnknown", "Delivery scope is unknown. Refresh before acting.", reference, true)];
  if (!snapshot) return [];
  const inspect = () => outputAction(row, input, ports, "inspect", "output.delivery.actionCheck", "Check retained work and current requirements",
    "output.delivery.wholeScope", "Progress covers the entire confirmed plan, including unselected, unresolved, and currently unavailable work.");
  if (row.object.kind === "requirement") return [inspect()];
  if (row.object.kind === "operation") return [outputAction(row, input, ports, "inspect", "output.delivery.actionRecover",
    "Review the previous attempt and recovery options", "output.delivery.retainedProviderDisclosure",
    "Review the recorded provider and source transfer")];
  const plan = snapshot.confirmedPlan, target = plan?.plan.targets.find(value => value.id === reference.targetId);
  if (!target) return [];
  const currentResult = (result: OutputResultRow) => {
    const asset = snapshot.assets.find(value => value.id === result.assetId);
    return Boolean(outputDeliveryReadiness(snapshot).allowed && result.planRevisionId === plan?.revisionId
      && result.targetContractDigest === plan?.targetContractDigests?.[target.id] && result.sourceDigest === snapshot.sourceRevision
      && asset?.available && asset.sha256 === result.sha256 && asset.inspection.status === "inspected"
      && asset.inspection.sha256 === result.sha256 && !target.blocking_issues.length);
  };
  const review = (result: OutputResultRow) => {
    const asset = snapshot.assets.find(value => value.id === result.assetId);
    return currentResult(result) && snapshot.permissions.canReview && result.reviewAllowed === true && !result.independentReviewBlocked
      && !(snapshot.permissions.independentReview && (result.createdByUserId === snapshot.scope.actorUserId || asset?.createdByUserId === snapshot.scope.actorUserId));
  };
  if (row.object.kind === "result") return [review(row.object.value)
    ? outputAction(row, input, ports, "inspect", "output.delivery.actionReview", "Review the exact file",
      "output.delivery.inspectionCaveat", "These are bounded structural and header checks, not proof of decoding, playback, meaningful content, source coverage, accessibility, or rights. Review the exact file before accepting it.")
    : inspect()];
  const state = snapshot.targetStates.find(value => value.target_id === target.id);
  const result = state?.result_id ? snapshot.results.find(value => value.id === state.result_id && value.targetId === target.id && value.planRevisionId === plan?.revisionId) : null;
  const actions: OutcomeDeskAction<OutcomeDeskTarget>[] = [];
  const operations = snapshot.grants.flatMap(grant => grant.operations).filter(operation => operation.targetId === target.id);
  const jobs = input.output?.jobs ?? [];
  if (operations.some(operation => outputOperationRecovery(operation, jobs.find(job => job.jobId === operation.jobId), snapshot.documentId).reason !== "available"))
    actions.push(outputAction(row, input, ports, "history", "output.delivery.actionRecover", "Review the previous attempt and recovery options",
      "output.delivery.stopDoesNotErase", "Stopping does not remove the target or erase provider charges already incurred."));
  if (result && currentResult(result) && result.review === "approved" && result.acceptanceId && state?.review === "accepted") {
    const accepted = captureOutputNavigation(snapshot, reference.authorizationScopeKey, "result", result.id);
    if (accepted) actions.push(outputAction(row, input, ports, "inspect", "output.delivery.actionDownload", "Review accepted work for delivery",
      "output.delivery.inspectionCaveat", "These are bounded structural and header checks, not proof of decoding, playback, meaningful content, source coverage, accessibility, or rights. Review the exact file before accepting it.", accepted));
  }
  if ((!result || !currentResult(result)) && snapshot.permissions.canAuthor && outputDeliveryReadiness(snapshot).allowed && !target.blocking_issues.length
    && (outputReusableAcceptanceChoices(snapshot, target).length || outputCompletedNativeChoices(snapshot, jobs, target).length
      || snapshot.assets.some(asset => asset.available && asset.inspection.status === "inspected" && asset.mediaKind === target.media_kind)))
    actions.push(outputAction(row, input, ports, "existing", "output.delivery.useExistingWork", "Use a completed result or an owned file",
      "output.delivery.checkFile", "Check file against target"));
  if (result && result.review === "pending" && review(result)) {
    const exactResult = captureOutputNavigation(snapshot, reference.authorizationScopeKey, "result", result.id);
    if (exactResult) actions.push(outputAction(row, input, ports, "inspect", "output.delivery.actionReview", "Review the exact file",
      "output.delivery.inspectionCaveat", "These are bounded structural and header checks, not proof of decoding, playback, meaningful content, source coverage, accessibility, or rights. Review the exact file before accepting it.", exactResult));
  }
  const native = snapshot.permissions.canRequest && snapshot.capabilities.nativeGeneration && outputNativeReadiness(snapshot).allowed
    && target.selected && !target.blocking_issues.length && ["image", "slides"].includes(target.media_kind) && state?.capability !== "unsupported";
  if (native) actions.push(outputAction(row, input, ports, "native", "output.delivery.actionCreate", "Review how to create this output",
    "output.delivery.checkRun", "Check availability and cost · no generation"));
  if (snapshot.permissions.canAuthor && snapshot.capabilities.ownedFileAdoption && outputSourceReadiness(snapshot).allowed)
    actions.push(outputAction(row, input, ports, "owned", "output.delivery.adoptTitle", "Use a file you own",
      "output.delivery.adoptDetail", "Upload a finished file. Forma inspects the bytes; matching, content review, current rights, and acceptance are separate steps."));
  if (!actions.length || !actions.some(action => action.target.kind === "canonical-output" && action.target.section === "inspect")) actions.push(inspect());
  return actions;
}

/** Exact human selection. Recommendations retain the existing resolver's receipt/reuse priority. */
export function outcomeDeskHostActions(input: OutcomeDeskInput, selectedKey: string, ports: OutcomeDeskHostPorts): readonly OutcomeDeskAction<OutcomeDeskTarget>[] {
  const row = projectOutcomeDesk(input, selectedKey).selected;
  if (!row) return [];
  if (row.navigation) return canonicalOutputActions(row, input, ports);
  const scope = scopeFor(input), { object } = row;
  if (object.kind === "artifact") return [deliveryAction(row, input, object.value, ports)];
  if (object.kind === "document") return creativeNextActions(input.facts).map((action) => {
    if (action.target.kind === "artifact") {
      const target = action.target, artifact = input.facts.artifacts.find((value) => value.id === target.artifactId);
      return artifact ? deliveryAction(row, input, artifact, ports) : wrap(row, input, action, ports);
    }
    return wrap(row, input, action, ports);
  });
  if (object.kind !== "output" && object.kind !== "job") return [];
  const target: CreativeNextTarget = object.kind === "output" ? { ...scope, kind: "output", outputId: object.value.id }
    : { ...scope, kind: "job", jobId: object.value.jobId };
  const failed = object.kind === "job" && ["failed", "partial"].includes(object.value.status);
  const terminal = object.kind === "job" && ["completed", "canceled"].includes(object.value.status);
  return [wrap(row, input, {
    id: object.kind === "output" ? "open-output" : failed || terminal ? "inspect-job" : "check-job", target,
    label: object.kind === "output" ? "Open saved result" : terminal ? "Inspect this request"
      : failed ? "Inspect the previous attempt" : "Check this work in progress",
    reason: object.kind === "output" ? "Inspect this exact saved output without starting another generation."
      : terminal ? "View the original request and any retained results. No new work is started."
        : failed ? "Review retained evidence and partial work. Independent outputs can continue." : "Open the existing request. A new request is not needed to check progress.",
    title: "", priority: 90, evidence: 1,
  }, ports, terminal ? "inspect-terminal-job" : undefined)];
}
export function outcomeDeskHostActionAvailable(action: OutcomeDeskAction<OutcomeDeskTarget>, current: OutcomeDeskInput, ports: OutcomeDeskHostPorts): boolean {
  if (action.target.kind === "canonical-output") {
    const snapshot = action.target.refresh ? outcomeDeskOutputRead(current) : outcomeDeskOutputSnapshot(current);
    if (!outputNavigationMatches(action.target.reference, snapshot, current.facts.authorityKey)) return false;
    return outcomeDeskHostActions(current, outcomeDeskKey(action.subject), ports).some(candidate => candidate.key === action.key);
  }
  if (action.target.kind === "next") return creativeNextTargetAvailable(action.target.action.target, current.facts);
  const target = action.target, artifact = current.facts.artifacts.find((value) => value.id === target.artifactId);
  return Boolean(artifact && artifact.sourceEventId === target.sourceEventId && (artifact.contentRef ?? null) === target.contentRef
    && creativeNextTargetAvailable({ ...action.scope, kind: "artifact", artifactId: target.artifactId, sequence: target.sequence, revision: target.revision }, current.facts)
    && ports.delivery(artifact).canRead && deliveryProof(ports.delivery(artifact)) === target.proof);
}
/** Expert choices are one disclosure + one exact preparation handoff. No paid executor is called here. */
export function outcomeDeskPreparationActions(input: OutcomeDeskInput, selectedKey: string, ports: OutcomeDeskHostPorts): readonly OutcomeDeskAction<OutcomeDeskTarget>[] {
  const row = projectOutcomeDesk(input, selectedKey).selected;
  if (!row || row.navigation) return [];
  const scope = scopeFor(input), sourceRevision = creativeActionSourceRevision(input.facts);
  const seed: Extract<CreativeNextTarget, { kind: "configure" }> = { ...scope, kind: "configure", medium: null, sourceRevision };
  return (["image", ...DOCUMENT_ARTIFACT_KINDS] as const).flatMap((medium) => {
    const target = creativePreparationChoice(seed, medium, input.facts);
    if (!target) return [];
    const action = wrap(row, input, { id: "configure-output", label: "Prepare an output",
      reason: "Choose and review this document’s output settings. Nothing is generated yet.",
      title: medium, priority: 0, evidence: 0, target }, ports);
    return [{ ...action, label: ports.localize("artifact." + medium + ".label", medium) }];
  });
}
