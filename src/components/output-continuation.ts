import type { DocumentJob } from "../model/document-jobs.ts";
import type { OutputRequirementsSnapshot, OutputResultRow } from "../model/output-delivery-contract.ts";
import { captureOutputNavigation, outputNavigationMatches, type OutputNavigationReference, type OutputNavigationSection } from "../model/output-navigation.ts";
import type { OutputPlanResource } from "../state/output-requirements-client.ts";
import { outputCompletedNativeChoices, outputOperationRecovery, outputReusableAcceptanceChoices } from "./output-controller-recovery.ts";
import { outputDeliveryReadiness, outputNativeReadiness, outputSourceReadiness } from "./output-source-readiness.ts";

export type OutputContinuationLabelKey =
  | "output.delivery.refresh" | "output.delivery.actionCheck" | "output.delivery.actionRecover"
  | "output.delivery.actionReview" | "output.delivery.actionDownload" | "output.delivery.useExistingWork"
  | "output.delivery.actionCreate" | "output.delivery.adoptTitle";
export type OutputContinuationDetailKey =
  | "output.delivery.scopeUnknown" | "output.delivery.wholeScope" | "output.delivery.retainedProviderDisclosure"
  | "output.delivery.inspectionCaveat" | "output.delivery.stopDoesNotErase" | "output.delivery.checkFile"
  | "output.delivery.checkRun" | "output.delivery.adoptDetail";
export type OutputContinuationCopy<Key extends string> = { readonly key: Key; readonly fallback: string };
export type OutputContinuationChoice = {
  readonly section: OutputNavigationSection;
  readonly reference: OutputNavigationReference;
  readonly refresh: boolean;
  readonly label: OutputContinuationCopy<OutputContinuationLabelKey>;
  readonly detail: OutputContinuationCopy<OutputContinuationDetailKey>;
};
export type OutputContinuationRead = Readonly<Pick<OutputPlanResource<OutputRequirementsSnapshot>,
  "state" | "snapshot" | "accessLost" | "privateUnavailable">>;
export type OutputContinuationInput = {
  /** Existing current authorized cache; not raw HTTP or a fabricated saved snapshot. */
  readonly read: OutputContinuationRead | null;
  readonly authorizationScopeKey: string;
  readonly reference: OutputNavigationReference | null;
  readonly jobs?: readonly DocumentJob[];
};

/**
 * Navigation/configuration choices only, never permission to execute, approve or
 * release. The caller supplies the existing authorized read and independently
 * current scope key. An empty result does not mean the document owes no work.
 */
export function outputContinuationChoices(input: OutputContinuationInput): readonly OutputContinuationChoice[] {
  const read = input.read, snapshot = read?.snapshot, reference = input.reference;
  if (!read || read.accessLost || read.privateUnavailable || !snapshot || !reference
    || !outputNavigationMatches(reference, snapshot, input.authorizationScopeKey)) return [];
  const action = (section: OutputNavigationSection, label: OutputContinuationLabelKey, fallback: string,
    detailKey: OutputContinuationDetailKey, detail: string, exact: OutputNavigationReference = reference, refresh = false): OutputContinuationChoice => ({
    section, reference: exact, refresh, label: { key: label, fallback }, detail: { key: detailKey, fallback: detail },
  });
  // Only original operations have retained navigation while a read is not ready.
  if (read.state !== "ready") return reference.kind === "operation"
    ? [action("inspect", "output.delivery.refresh", "Refresh outputs",
      "output.delivery.scopeUnknown", "Delivery scope is unknown. Refresh before acting.", reference, true)] : [];
  const inspect = () => action("inspect", "output.delivery.actionCheck", "Check retained work and current requirements",
    "output.delivery.wholeScope", "Progress covers the entire confirmed plan, including unselected, unresolved, and currently unavailable work.");
  if (reference.kind === "requirement") return [inspect()];
  if (reference.kind === "operation") return [action("inspect", "output.delivery.actionRecover",
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
  if (reference.kind === "result") {
    const result = snapshot.results.find(value => value.id === reference.resultId && value.planRevisionId === plan?.revisionId);
    if (!result) return [];
    return [review(result)
    ? action("inspect", "output.delivery.actionReview", "Review the exact file",
      "output.delivery.inspectionCaveat", "These are bounded structural and header checks, not proof of decoding, playback, meaningful content, source coverage, accessibility, or rights. Review the exact file before accepting it.")
    : inspect()];
  }
  const state = snapshot.targetStates.find(value => value.target_id === target.id);
  const result = state?.result_id ? snapshot.results.find(value => value.id === state.result_id && value.targetId === target.id && value.planRevisionId === plan?.revisionId) : null;
  const actions: OutputContinuationChoice[] = [];
  const operations = snapshot.grants.flatMap(grant => grant.operations).filter(operation => operation.targetId === target.id);
  const jobs = input.jobs ?? [];
  if (operations.some(operation => outputOperationRecovery(operation, jobs.find(job => job.jobId === operation.jobId), snapshot.documentId).reason !== "available"))
    actions.push(action("history", "output.delivery.actionRecover", "Review the previous attempt and recovery options",
      "output.delivery.stopDoesNotErase", "Stopping does not remove the target or erase provider charges already incurred."));
  if (result && currentResult(result) && result.review === "approved" && result.acceptanceId && state?.review === "accepted") {
    const accepted = captureOutputNavigation(snapshot, reference.authorizationScopeKey, "result", result.id);
    if (accepted) actions.push(action("inspect", "output.delivery.actionDownload", "Review accepted work for delivery",
      "output.delivery.inspectionCaveat", "These are bounded structural and header checks, not proof of decoding, playback, meaningful content, source coverage, accessibility, or rights. Review the exact file before accepting it.", accepted));
  }
  if ((!result || !currentResult(result)) && snapshot.permissions.canAuthor && outputDeliveryReadiness(snapshot).allowed && !target.blocking_issues.length
    && (outputReusableAcceptanceChoices(snapshot, target).length || outputCompletedNativeChoices(snapshot, jobs, target).length
      || snapshot.assets.some(asset => asset.available && asset.inspection.status === "inspected" && asset.mediaKind === target.media_kind)))
    actions.push(action("existing", "output.delivery.useExistingWork", "Use a completed result or an owned file",
      "output.delivery.checkFile", "Check file against target"));
  if (result && result.review === "pending" && review(result)) {
    const exactResult = captureOutputNavigation(snapshot, reference.authorizationScopeKey, "result", result.id);
    if (exactResult) actions.push(action("inspect", "output.delivery.actionReview", "Review the exact file",
      "output.delivery.inspectionCaveat", "These are bounded structural and header checks, not proof of decoding, playback, meaningful content, source coverage, accessibility, or rights. Review the exact file before accepting it.", exactResult));
  }
  const native = snapshot.permissions.canRequest && snapshot.capabilities.nativeGeneration && outputNativeReadiness(snapshot).allowed
    && target.selected && !target.blocking_issues.length && ["image", "slides", "model3d"].includes(target.media_kind) && state?.capability !== "unsupported";
  if (native) actions.push(action("native", "output.delivery.actionCreate", "Review how to create this output",
    "output.delivery.checkRun", "Check availability and cost · no generation"));
  if (snapshot.permissions.canAuthor && snapshot.capabilities.ownedFileAdoption && outputSourceReadiness(snapshot).allowed)
    actions.push(action("owned", "output.delivery.adoptTitle", "Use a file you own",
      "output.delivery.adoptDetail", "Upload a finished file. Forma inspects the bytes; matching, content review, current rights, and acceptance are separate steps."));
  if (!actions.length || !actions.some(action => action.section === "inspect")) actions.push(inspect());
  return actions;
}
