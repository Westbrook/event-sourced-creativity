import { artifactReviewState, assessCreativeContext } from "./context-health.ts";
import { documentArtifactRevision, type DocumentArtifact } from "./document-artifacts.ts";
import type { CreativeBlock, CreativeEvent } from "./events.ts";

export type ArtifactDeliveryIntent = "inspect" | "review" | "export";
export type ArtifactDeliveryAccess = {
  actorUserId: string;
  canRead: boolean;
  canAuthor: boolean;
  canReview: boolean;
  shared: boolean;
  independentApprovalRequired?: boolean;
  workflowReviewNeeded?: boolean;
};
export type ArtifactDeliveryAction = "inspect" | "assign" | "review" | "reviewPersonal" | "changes" | "sources" | "export" | "exportPersonal" | "exportDraft";

const actorId = (actor: string) => actor.startsWith("user:") ? actor.slice(5) : "";
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
type ArtifactIdentity = Pick<DocumentArtifact, "id" | "documentId" | "sequence">;

/** Read existing review events only. This is not another approval or delivery store. */
export function artifactReviewParticipants(artifact: ArtifactIdentity, events: readonly CreativeEvent[]) {
  const completed = [...events].reverse().find(event => event.type === "DocumentRenderCompleted"
    && String(event.payload.artifact_id ?? "") === artifact.id && String(event.payload.document_id ?? "") === artifact.documentId);
  const rendered = [...events].reverse().find(event => event.type === "DocumentRenderRequested"
    && String(event.payload.artifact_id ?? "") === artifact.id);
  const reviews = events.filter(event => ["ArtifactReviewRequested", "ArtifactApproved", "ArtifactChangesRequested", "DocumentArtifactEdited"].includes(event.type)
    && String(event.payload.artifact_id ?? "") === artifact.id && event.sequence > artifact.sequence);
  const requested = [...reviews].reverse().find(event => event.type === "ArtifactReviewRequested");
  const contributors = new Set([
    String(completed?.payload.requested_by_user_id ?? actorId(rendered?.actor ?? "")),
    ...reviews.filter(event => event.type === "DocumentArtifactEdited")
      .flatMap(event => [actorId(event.actor), String(event.payload.edited_by_user_id ?? "")]),
  ].filter(Boolean));
  return { completed, requested, latest: reviews.at(-1), contributors };
}

/** Paired recorded review binding, not an independent-approval or private-byte authorization. */
export function artifactReviewBindingMatches(
  artifact: ArtifactIdentity, events: readonly CreativeEvent[], revision: number, contentSha256: unknown,
): boolean {
  if (!Number.isSafeInteger(revision) || revision < 0 || !sha256(contentSha256)) return false;
  const { completed, requested, latest } = artifactReviewParticipants(artifact, events);
  if (!completed || latest?.type !== "ArtifactApproved" || !requested || requested.sequence >= latest.sequence
    || ![requested, latest].every(event => event.actor === "user" || Boolean(actorId(event.actor)))) return false;
  return [requested, latest].every(event => String(event.payload.document_id ?? "") === artifact.documentId
    && event.payload.artifact_revision === revision && event.payload.content_sha256 === contentSha256);
}

/** An approval authorizes precisely the reviewed bytes, never replacement content at the same ID. */
export function artifactApprovalMatches(
  artifact: ArtifactIdentity, events: readonly CreativeEvent[], revision: number, contentSha256: string,
): boolean {
  if (!Number.isSafeInteger(revision) || revision < 0 || !sha256(contentSha256)) return false;
  const { completed, requested, latest, contributors } = artifactReviewParticipants(artifact, events);
  if (!completed || latest?.type !== "ArtifactApproved" || !requested || requested.sequence >= latest.sequence) return false;
  const reviewer = actorId(latest.actor);
  if (!reviewer || contributors.has(reviewer) || reviewer === actorId(requested.actor)
    || String(requested.payload.assigned_reviewer_user_id ?? "") !== reviewer) return false;
  return [requested, latest].every(event => String(event.payload.document_id ?? "") === artifact.documentId
    && event.payload.artifact_revision === revision && event.payload.content_sha256 === contentSha256);
}

/** Rights failures remain blockers even when a legacy output lacks an exact source manifest. */
export function artifactCurrentRightsBlockers(blocks: CreativeBlock[], events: CreativeEvent[]) {
  return [...new Set(assessCreativeContext({ blocks }, events).issues
    .filter(issue => issue.severity === "blocking" && /^(decision-rights-|source-(rights-|revoked-|invalid-|expired-))/.test(issue.id))
    .flatMap(issue => issue.blockIds))];
}

/** Source freshness remains authoritative; export acknowledgments never establish recipient delivery. */
export function artifactDeliveryState(
  artifact: DocumentArtifact, blocks: CreativeBlock[], events: CreativeEvent[], access: ArtifactDeliveryAccess,
  contentSha256?: string | null,
) {
  const review = artifactReviewState(artifact, blocks, events);
  const approvalRequired = access.independentApprovalRequired ?? access.shared;
  const revision = documentArtifactRevision(events, artifact.id);
  const rightsBlockIds = artifactCurrentRightsBlockers(blocks.filter(block => block.documentId === artifact.documentId), events);
  const { requested, latest, contributors } = artifactReviewParticipants(artifact, events);
  const recordedHash = sha256(latest?.payload.content_sha256) && latest?.payload.artifact_revision === revision
    ? latest.payload.content_sha256 : null;
  const approved = access.canRead && !rightsBlockIds.length && review.status === "approved" && Boolean(recordedHash
    && artifactApprovalMatches(artifact, events, revision, recordedHash)
    && (contentSha256 === undefined || contentSha256 === recordedHash));
  const personalReviewNeeded = !access.shared && access.workflowReviewNeeded === true;
  const independentEligible = Boolean(access.actorUserId && !contributors.has(access.actorUserId)
    && actorId(requested?.actor ?? "") !== access.actorUserId
    && String(requested?.payload.assigned_reviewer_user_id ?? "") === access.actorUserId);
  const exports = [...events].reverse().filter(event => event.type === "DocumentArtifactExported"
    && String(event.payload.artifact_id ?? "") === artifact.id && String(event.payload.document_id ?? "") === artifact.documentId
    && event.payload.artifact_revision === revision && sha256(event.payload.content_sha256)
    && event.payload.destination_kind !== "soundtrack-companion");
  const exactHash = contentSha256 ?? recordedHash ?? (exports[0]?.payload.content_sha256 as string | undefined) ?? null;
  const exportReceipt = access.canRead && exactHash && (approvalRequired ? approved : true)
    && !["stale", "changes-requested"].includes(review.status)
    ? exports.find(event => event.payload.content_sha256 === exactHash
      && (!access.shared || approvalRequired || event.payload.export_class === "unreviewed-draft")
      && event.sequence > (approvalRequired ? latest?.sequence ?? artifact.sequence : artifact.sequence)) ?? null : null;
  // Missing retained content is a known blocker. An omitted hash means a list has not opened the bytes yet.
  const releaseAllowed = access.canRead && !rightsBlockIds.length && sha256(contentSha256)
    && (!approvalRequired || approved);
  const action: ArtifactDeliveryAction = !access.canRead || contentSha256 === null ? "inspect"
    : review.status === "stale" || rightsBlockIds.length ? "sources"
    : review.status === "changes-requested" ? "changes"
    : personalReviewNeeded && review.status === "unverified" ? "inspect"
    : personalReviewNeeded ? access.canAuthor || access.canReview ? "reviewPersonal" : "inspect"
    : !approvalRequired ? access.shared ? "exportDraft" : "exportPersonal"
    : approved ? "export"
    : review.status === "in-review" && access.canReview && independentEligible ? "review"
    : access.canAuthor && !["unverified", "stale"].includes(review.status) ? "assign" : "inspect";
  const intent: ArtifactDeliveryIntent = ["export", "exportPersonal", "exportDraft"].includes(action) ? "export"
    : ["assign", "review", "reviewPersonal", "changes", "sources"].includes(action) ? "review" : "inspect";
  return { artifactId: artifact.id, documentId: artifact.documentId, revision, review, approved, workflowReviewNeeded: access.workflowReviewNeeded === true, canRead: access.canRead,
    independentEligible, rightsBlockIds, assignedReviewerId: String(requested?.payload.assigned_reviewer_user_id ?? ""),
    contentSha256: exactHash, releaseAllowed, action, intent, exportReceipt,
    deliveryStatus: "unconfirmed" as const };
}
