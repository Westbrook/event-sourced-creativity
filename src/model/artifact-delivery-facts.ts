import { artifactSourceVersions } from "./context-health.ts";
import { productionWorkflows, productionWorkflowStageStates } from "./production-workflow.ts";
import { artifactDeliveryState, artifactReviewBindingMatches } from "./artifact-delivery.ts";
import { documentArtifactRevision, type DocumentArtifact } from "./document-artifacts.ts";
import type { CreativeWorkspaceFacts } from "./workspace-intelligence.ts";

export type ArtifactDeliveryFactAccess = {
  actorUserId: string; shared: boolean; managedPilot: boolean; canReview: boolean;
};

/** The existing delivery projection over already-authorized facts; no Store or next-action dependency at runtime. */
export function artifactDeliveryFromFacts(
  facts: CreativeWorkspaceFacts, artifact: DocumentArtifact, access: ArtifactDeliveryFactAccess,
  contentSha256?: string | null,
) {
  const events = [...(facts.events ?? [])], blocks = [...facts.blocks], artifacts = [...facts.artifacts], outputs = [...facts.outputs];
  const workflowReviewNeeded = !access.shared && facts.canRead && productionWorkflows(events, artifact.documentId, facts.projectId).some(workflow =>
    productionWorkflowStageStates(workflow, { blocks, libraryBlocks: blocks, artifacts, libraryArtifacts: artifacts, outputs, libraryOutputs: outputs }, events)
      .some(state => state.stage.enabled && state.artifact?.id === artifact.id && state.artifact.sourceEventId === artifact.sourceEventId
        && (state.stage.final ? workflow.approvalRequired : state.stage.approvalRequired || state.stage.source?.approvalRequired)
        && (state.status !== "approved" || contentSha256 !== undefined
          && !artifactReviewBindingMatches(artifact, events, documentArtifactRevision(events, artifact.id), contentSha256))));
  return artifactDeliveryState(artifact, blocks, events, {
    actorUserId: access.actorUserId,
    shared: access.shared,
    workflowReviewNeeded,
    independentApprovalRequired: Boolean(access.shared && (access.managedPilot || artifactSourceVersions(artifact.id, [...(facts.events ?? [])]))),
    canRead: facts.canRead && facts.artifacts.some(candidate => candidate.id === artifact.id && candidate.sequence === artifact.sequence),
    canAuthor: facts.canAuthor,
    canReview: access.canReview,
  }, contentSha256);
}

/** Same presentation proof used by the existing Desk, never a permission or byte certificate. */
export function artifactDeliveryFactsProof(delivery: ReturnType<typeof artifactDeliveryState>): string {
  return JSON.stringify({
    revision: delivery.revision, review: delivery.review, approved: delivery.approved, canRead: delivery.canRead,
    action: delivery.action, intent: delivery.intent, rightsBlockIds: delivery.rightsBlockIds,
    independentEligible: delivery.independentEligible, contentSha256: delivery.contentSha256,
    assignedReviewerId: delivery.assignedReviewerId,
  });
}
