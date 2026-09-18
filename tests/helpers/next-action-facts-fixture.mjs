import { foldEvents } from "../../src/model/events.ts";
import { recommendProductionWorkflow, DOCUMENT_PRODUCTION_WORKFLOW_EVENT } from "../../src/model/production-workflow.ts";

// Finite read-only Store ports around the actual fold and facts adapter. This is
// not FormaStore, a Worker, an authority check, a draft owner or a browser fixture.
export const FACT_HASH = "a".repeat(64);
export const factEvent = (sequence, type, payload, actor = "user:owner") => ({
  eventId: "fixture-event-" + sequence, streamId: "creative:owner", sequence,
  occurredAt: "2026-08-27T00:00:00.000Z", recordedAt: "2026-08-27T00:00:00.000Z",
  actor, clientId: "facts-fixture", correlationId: "facts-fixture", causationId: null,
  compensatesEventId: null, schemaVersion: 1, type, payload,
});
export function createNextActionFactsPort({
  projectId = "p", documentId = "d", kind = "slides", shared = false, actorUserId = shared ? "reviewer" : "owner",
  review = "none", workflowReview = false, rightsRevoked = false, outputRows = [], legacy = false,
} = {}) {
  const events = [], calls = [];
  const add = (type, payload, actor) => {
    const event = factEvent(events.length + 1, type, payload, actor); events.push(event); return event;
  };
  add("ProjectCreated", { project_id: projectId, name: "Current project" });
  add("DocumentCreated", { project_id: projectId, document_id: documentId, title: "Current document" });
  add("DocumentCreated", { project_id: projectId, document_id: "other-document", title: "Other loaded document" });
  add("BlockCreated", { project_id: projectId, document_id: documentId, block_id: "direction", type: "direction",
    scope: "document", handle: "Current direction", properties: { text: "A clear direction", weight: 1,
      ...(rightsRevoked ? { rights_revoked: true } : {}) } });
  for (const row of outputRows) add("BlockCreated", { project_id: projectId, document_id: documentId,
    block_id: row.blockId, type: "output", scope: "document", handle: "Output " + row.blockId,
    properties: { label: row.subtype, subtype: row.subtype, text: row.content, output_spec: row.spec, weight: 1 } });
  const workflow = workflowReview && kind ? recommendProductionWorkflow({
    id: "workflow", documentId, projectId, target: kind, approvalRequired: true,
  }) : null;
  if (workflow) add(DOCUMENT_PRODUCTION_WORKFLOW_EVENT, { workflow_id: workflow.id,
    document_id: documentId, project_id: projectId, target_kind: kind, workflow });
  const sourceVersions = foldEvents(events, Infinity, documentId, projectId).blocks
    .map(block => ({ block_id: block.id, version: block.sourceEvents.length }));
  const exact = { project_id: projectId, document_id: documentId, artifact_id: "artifact",
    artifact_revision: 0, content_sha256: FACT_HASH };
  if (kind) {
    add("DocumentRenderRequested", { ...exact, artifact_kind: kind, ...(legacy ? {} : { source_block_versions: sourceVersions }) });
    add("DocumentRenderCompleted", { ...exact, artifact_kind: kind, title: "Exact saved " + kind,
      content_ref: "private-original-content", requested_by_user_id: "owner", provider: "retained-provider",
      item_count: 1, items: [], ...(legacy ? {} : { source_block_versions: sourceVersions }),
      ...(workflow ? { workflow_id: workflow.id, workflow_stage_id: kind + "-final", workflow_sources: [] } : {}) }, "worker:renderer");
    if (review !== "none") add("ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: "reviewer" });
    if (review === "approved") add("ArtifactApproved", exact, "user:reviewer");
    if (review === "changes") add("ArtifactChangesRequested", { ...exact, review_note: "Correct the exact result" }, "user:reviewer");
  }
  const permissions = ["project.read", "project.author", "project.output.request", "project.review.approve"];
  const state = {
    events, projectId, documentId, actorUserId, authorityKey: "current-scope", generation: 7, sourceActive: true,
    sourceCaptures: 0, session: { user: { userId: actorUserId, role: "creator" }, capabilities: permissions,
      projects: [], ...(shared ? { projectContext: { organizationId: "org", projectAccessId: "access",
        projectId, ownerUserId: "owner", role: "editor", permissions, managedPilot: false } } : {}) },
    reviews: [], jobs: [], notifications: [], read: { state: "loading", snapshot: null, error: null },
  };
  const projection = () => foldEvents(state.events, Infinity, state.documentId, state.projectId);
  const store = {
    session: { get: () => state.session }, projection: { get: projection },
    eventView: { get: () => state.events }, asOf: { get: () => Infinity },
    canvasProjection: { get: () => ({ selectedCanvasId: "board", canvases: [{ id: "board", projectId: state.projectId }] }) },
    projectNotifications: { get: () => state.notifications }, reviewInbox: { get: () => state.reviews },
    documentJobs: { get: () => state.jobs },
    captureAuthorizationScope: () => state.session ? { key: state.authorityKey, shared: Boolean(state.session.projectContext) } : null,
    captureSourceOwnership: () => {
      state.sourceCaptures++; return state.session ? { generation: state.generation, authorization: store.captureAuthorizationScope() } : null;
    },
    sourceOwnershipActive: source => Boolean(state.sourceActive && source && source.generation === state.generation
      && source.authorization.key === state.authorityKey && state.session),
    outputRequirements: {
      resource: id => { calls.push({ type: "resource", documentId: id }); return state.read; },
      ensure: () => { throw new Error("facts must not start a read"); },
      command: () => { throw new Error("facts must not issue a command"); },
    },
    guardedFetch: () => { throw new Error("facts must not fetch"); },
    append: () => { throw new Error("facts must not author"); },
  };
  const artifact = () => projection().artifacts.find(value => value.id === "artifact");
  const reviewTask = (extra = {}) => ({ id: "task", organizationId: "org", organizationName: "Organization",
    projectAccessId: "access", projectId: state.projectId, projectName: "Current project",
    documentId: state.documentId, documentTitle: "Current document", artifactId: "artifact",
    artifactTitle: "Exact saved " + kind, artifactKind: kind, revision: 0, contentSha256: FACT_HASH,
    status: "pending", dueAt: null, createdAt: "2026-08-27T00:00:00Z", requestedByUserId: "owner", requestedByName: "Owner", ...extra });
  return { state, store, calls, projection, artifact, reviewTask, add };
}
