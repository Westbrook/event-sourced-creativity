import { artifactSourceVersions } from "../model/context-health.ts";
import { productionWorkflows, productionWorkflowStageStates } from "../model/production-workflow.ts";
import { artifactDeliveryState, artifactReviewBindingMatches } from "../model/artifact-delivery.ts";
import { documentArtifactRevision, type DocumentArtifact } from "../model/document-artifacts.ts";
import { nextActionFacts } from "./next-action-context.ts";
import type { FormaStore } from "./store.ts";

/** Shared read-only projection over the current project's existing artifact and permission evidence. */
export function artifactDeliveryFor(
  store: FormaStore, artifact: DocumentArtifact, contentSha256?: string | null, canvasId: string | null = null,
) {
  const facts = nextActionFacts(store, artifact.documentId, canvasId);
  const session = store.session.get(), context = session?.projectContext;
  const permissions = context?.permissions ?? session?.capabilities ?? [];
  const events = [...(facts.events ?? [])], blocks = [...facts.blocks], artifacts = [...facts.artifacts], outputs = [...facts.outputs];
  const workflowReviewNeeded = !context && facts.canRead && productionWorkflows(events, artifact.documentId, facts.projectId).some(workflow =>
    productionWorkflowStageStates(workflow, { blocks, libraryBlocks: blocks, artifacts, libraryArtifacts: artifacts, outputs, libraryOutputs: outputs }, events)
      .some(state => state.stage.enabled && state.artifact?.id === artifact.id && state.artifact.sourceEventId === artifact.sourceEventId
        && (state.stage.final ? workflow.approvalRequired : state.stage.approvalRequired || state.stage.source?.approvalRequired)
        && (state.status !== "approved" || contentSha256 !== undefined
          && !artifactReviewBindingMatches(artifact, events, documentArtifactRevision(events, artifact.id), contentSha256))));
  return artifactDeliveryState(artifact, blocks, events, {
    actorUserId: session?.user.userId ?? "",
    shared: Boolean(context),
    workflowReviewNeeded,
    independentApprovalRequired: Boolean(context && (context.managedPilot || artifactSourceVersions(artifact.id, [...(facts.events ?? [])]))),
    canRead: facts.canRead && facts.artifacts.some(candidate => candidate.id === artifact.id && candidate.sequence === artifact.sequence),
    canAuthor: facts.canAuthor,
    canReview: permissions.includes("project.review.approve"),
  }, contentSha256);
}
