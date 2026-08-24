import type { CreativeDocument, CreativeProjection } from "./events.ts";
import type { DocumentJob } from "./document-jobs.ts";
import type { AssignedReviewTask, PilotSession, ProjectNotification } from "../state/store.ts";

export type FormaActivitySnapshot = {
  documents: CreativeDocument[];
  notifications: ProjectNotification[];
  reviews: AssignedReviewTask[];
  jobs: DocumentJob[];
};

/** A navigation surface may only combine information already authorized for its exact scope. */
export function scopedFormaActivity(
  session: PilotSession | null,
  projection: Pick<CreativeProjection, "projectId" | "documents" | "libraryArtifacts">,
  notifications: ProjectNotification[],
  reviews: AssignedReviewTask[],
  jobs: DocumentJob[],
): FormaActivitySnapshot {
  if (!session) return { documents: [], notifications: [], reviews: [], jobs: [] };

  const context = session.projectContext;
  const personallyAssigned = !context && !session.impersonation ? reviews.filter((review) => review.status === "pending" && (session.projects ?? []).some((project) =>
    project.organizationId === review.organizationId
    && project.projectAccessId === review.projectAccessId
    && project.projectId === review.projectId,
  )) : [];
  if (!projection.projectId) return { documents: [], notifications: [], reviews: personallyAssigned, jobs: [] };
  if (context && context.projectId !== projection.projectId) return { documents: [], notifications: [], reviews: [], jobs: [] };

  const documents = projection.documents.filter((document) => !document.removed && document.projectId === projection.projectId);
  const documentIds = new Set(documents.map((document) => document.id));
  const artifactIds = new Set(projection.libraryArtifacts.filter((artifact) => documentIds.has(artifact.documentId)).map((artifact) => artifact.id));
  const projectNotifications = context ? notifications.filter((notification) =>
    (!notification.documentId || documentIds.has(notification.documentId))
    && (!notification.artifactId || artifactIds.has(notification.artifactId)),
  ) : [];

  const assignedReviews = context ? reviews.filter((review) =>
      review.status === "pending"
      && review.organizationId === context.organizationId
      && review.projectAccessId === context.projectAccessId
      && review.projectId === context.projectId
      && documentIds.has(review.documentId)
      && context.permissions.includes("project.review.approve")
    ) : personallyAssigned;

  const privateJobs = !context || context.permissions.includes("project.output.request")
    ? jobs.filter((job) => documentIds.has(job.documentId))
    : [];

  return { documents, notifications: projectNotifications, reviews: assignedReviews, jobs: privateJobs };
}

export function formaActivityUnread(snapshot: FormaActivitySnapshot) {
  const assignedArtifactIds=new Set(snapshot.reviews.map((review)=>review.artifactId));
  return snapshot.notifications.filter((notification)=>!notification.readAt&&!(notification.artifactId&&assignedArtifactIds.has(notification.artifactId)&&["review_requested","review_due"].includes(notification.kind)));
}

export function formaActivityAttention(snapshot: FormaActivitySnapshot) {
  const unread = formaActivityUnread(snapshot).length;
  const failures = snapshot.jobs.filter((job) => ["failed", "partial"].includes(job.status) && !job.dismissedAt).length;
  return snapshot.reviews.length + unread + failures;
}
