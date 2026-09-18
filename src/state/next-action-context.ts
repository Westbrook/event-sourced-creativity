import { foldEvents } from "../model/events.ts";
import { scopedFormaActivity } from "../model/activity.ts";
import { assessCreativeContext } from "../model/context-health.ts";
import { artifactCurrentRightsBlockers } from "../model/artifact-delivery.ts";
import { artifactDeliveryFromFacts, artifactDeliveryFactsProof } from "../model/artifact-delivery-facts.ts";
import { documentArtifactRevision } from "../model/document-artifacts.ts";
import { captureOutputNavigation } from "../model/output-navigation.ts";
import type { CreativeCanonicalOutputFact, CreativeLifecycleFacts, CreativeWorkspaceFacts } from "../model/workspace-intelligence.ts";
import { outputContinuationChoices } from "../components/output-continuation.ts";
import { outputMissingNativeResults, outputOperationRecovery } from "../components/output-controller-recovery.ts";
import { outputSourceReadiness } from "../components/output-source-readiness.ts";
import type { FormaStore } from "./store.ts";

export type NextActionFactsOptions = {
  /** Opt in only after the host wires every additive exact target; no automatic consumer migration. */
  lifecycle?: boolean;
};

/** Read one already-owned resource. No ensure/fetch, document fan-out, synthetic snapshot or absence-as-zero. */
function currentOutputFacts(store: FormaStore, facts: CreativeWorkspaceFacts): CreativeLifecycleFacts["output"] {
  const requirementBlockIds = facts.blocks.filter(block => block.projectId === facts.projectId
    && block.documentId === facts.documentId && !block.removed && block.type === "output").map(block => block.id);
  const resource = store.outputRequirements.resource(facts.documentId), session = store.session.get();
  const candidate = resource.snapshot;
  const snapshot = !resource.accessLost && !resource.privateUnavailable && candidate
    && candidate.documentId === facts.documentId && candidate.projectId === facts.projectId
    && candidate.scope.actorUserId === session?.user.userId
    && candidate.scope.projectAccessId === (session?.projectContext?.projectAccessId ?? null) ? candidate : null;
  const state = !snapshot && resource.state === "ready" ? "unavailable" : resource.state;
  if (!snapshot) return { state, scopeKnown: null, requirementBlockIds, choices: [] };
  const read = { ...resource, snapshot }, jobs = facts.jobs ?? [], choices: CreativeCanonicalOutputFact[] = [];
  const sourceAllowed = outputSourceReadiness(snapshot).allowed;
  const add = (kind: "requirement" | "target" | "operation", id: string, title: string,
    urgency: CreativeCanonicalOutputFact["urgency"]) => {
    const reference = captureOutputNavigation(snapshot, facts.authorityKey, kind, id);
    if (!reference) return;
    // One next step per object. The existing exact controller retains all other choices.
    const choice = outputContinuationChoices({ read, authorizationScopeKey: facts.authorityKey, reference, jobs })[0];
    if (!choice) return;
    const currentUrgency = kind !== "operation" && !sourceAllowed ? "source"
      : choice.label.key === "output.delivery.actionReview" ? "review"
      : choice.label.key === "output.delivery.actionDownload" ? "delivery"
      : choice.section === "history" ? "original" : urgency;
    choices.push({ reference: choice.reference, section: choice.section, refresh: choice.refresh,
      urgency: currentUrgency, title, labelKey: choice.label.key, label: choice.label.fallback,
      reasonKey: choice.detail.key, reason: choice.detail.fallback });
  };
  // Keep original accounting/recovery visible even when a current read is incomplete.
  for (const grant of snapshot.grants) for (const operation of grant.operations) {
    if (outputOperationRecovery(operation, jobs.find(job => job.jobId === operation.jobId), facts.documentId).reason !== "available")
      add("operation", operation.id, operation.targetLabel ?? operation.targetId, "original");
  }
  if (resource.state === "ready") {
    const plan = snapshot.confirmedPlan;
    for (const row of snapshot.requirements) {
      if (!plan || row.status !== "valid" || plan.plan.unresolved_groups.some(group => group.requirement_id === row.blockId)
        || !plan.plan.targets.some(target => target.requirement_id === row.blockId))
        add("requirement", row.blockId, String(facts.blocks.find(block => block.id === row.blockId)?.properties.label
          ?? facts.blocks.find(block => block.id === row.blockId)?.handle ?? row.subtype), "owed");
    }
    // Run selection does not remove an owed target from the delivery assignment.
    if (plan) for (const target of plan.plan.targets) {
      for (const original of outputMissingNativeResults(snapshot, jobs, target))
        add("operation", original.slotId, target.label, "original");
      add("target", target.id, target.label, "owed");
    }
  }
  return { state, scopeKnown: resource.state === "ready" ? snapshot.summary?.scope_known ?? null : null, requirementBlockIds, choices };
}

/** All consumers use the same authorized canonical projection; no surface-local output store. */
export function nextActionFacts(
  store: FormaStore, documentId: string, canvasId: string | null = null, options: NextActionFactsOptions = {},
): CreativeWorkspaceFacts {
  const session = store.session.get(), current = store.projection.get(), authorization = store.captureAuthorizationScope(), context = session?.projectContext;
  const document = current.documents.find(item => item.id === documentId && item.projectId === current.projectId);
  const board = store.canvasProjection.get();
  const source = options.lifecycle ? store.captureSourceOwnership() : null;
  const scopeValid = Boolean(session && authorization && document && (!context || context.projectId === current.projectId)
    && (!canvasId || board.selectedCanvasId === canvasId && board.canvases.some(item => item.id === canvasId && item.projectId === current.projectId))
    && (!options.lifecycle || !document.removed && store.sourceOwnershipActive(source)));
  const permissions = context?.permissions ?? session?.capabilities ?? [];
  const canRead = scopeValid && permissions.includes("project.read");
  const canAuthor = canRead && permissions.includes("project.author") && (!context || ["owner", "editor"].includes(context.role));
  const projection = foldEvents(store.eventView.get(), store.asOf.get(), documentId, current.projectId);
  const activity = scopedFormaActivity(session, current, store.projectNotifications.get(), store.reviewInbox.get(), store.documentJobs.get());
  const facts: CreativeWorkspaceFacts = {
    projectId: current.projectId, documentId, canvasId, authorityKey: authorization?.key ?? "", canRead, canAuthor,
    canConfigure: canAuthor && permissions.includes("project.output.request"), blocks: canRead ? projection.blocks : [],
    outputs: canRead ? projection.outputs : [], artifacts: canRead ? projection.artifacts : [],
    jobs: canRead ? activity.jobs : [], events: canRead ? store.eventView.get() : [],
    ...(options.lifecycle && source ? { sourceGeneration: source.generation } : {}),
  };
  if (!options.lifecycle || !canRead) return facts;
  const events = [...(facts.events ?? [])], blocks = [...facts.blocks];
  const rights = artifactCurrentRightsBlockers(blocks, events);
  const sourceIssues = assessCreativeContext({ blocks }, events).issues
    .filter(issue => issue.severity === "blocking" && issue.id.startsWith("source-")).flatMap(issue => issue.blockIds);
  const sourceBlockIds = [...new Set([...rights, ...sourceIssues])].filter(id => blocks.some(block => block.id === id && !block.removed));
  const deliveries = facts.artifacts.filter(artifact => artifact.documentId === documentId && artifact.provider !== "simulation").flatMap(artifact => {
    const delivery = artifactDeliveryFromFacts(facts, artifact, { actorUserId: session?.user.userId ?? "",
      shared: Boolean(context), managedPilot: Boolean(context?.managedPilot), canReview: permissions.includes("project.review.approve") });
    return delivery.canRead ? [{ artifactId: artifact.id, sequence: artifact.sequence, revision: delivery.revision,
      sourceEventId: artifact.sourceEventId, contentRef: artifact.contentRef ?? null, action: delivery.action, intent: delivery.intent,
      proof: artifactDeliveryFactsProof(delivery), title: artifact.title, reviewStatus: delivery.review.status }] : [];
  });
  // The personal cross-project inbox remains in Activity. Do not import another
  // selected workspace's private review into this document's recommendations.
  const reviews = activity.reviews.filter(review => context && review.projectId === facts.projectId
    && review.documentId === documentId && review.organizationId === context.organizationId
    && review.projectAccessId === context.projectAccessId && review.status === "pending"
    && !deliveries.some(row => row.artifactId === review.artifactId && ["stale", "changes-requested"].includes(row.reviewStatus))
    && facts.artifacts.some(artifact => artifact.id === review.artifactId
      && documentArtifactRevision(events, artifact.id) === review.revision))
    .map(review => ({ reviewId: review.id, organizationId: review.organizationId, projectAccessId: review.projectAccessId,
      artifactId: review.artifactId, revision: review.revision, contentSha256: review.contentSha256,
      title: review.artifactTitle, createdAt: review.createdAt }));
  return { ...facts, lifecycle: { sourceBlockIds, reviews, deliveries, output: currentOutputFacts(store, facts) } };
}
