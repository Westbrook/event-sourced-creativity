import type { DocumentArtifact } from "../model/document-artifacts.ts";
import { artifactDeliveryFromFacts } from "../model/artifact-delivery-facts.ts";
import { nextActionFacts } from "./next-action-context.ts";
import type { FormaStore } from "./store.ts";

/** Shared read-only projection over the current project's existing artifact and permission evidence. */
export function artifactDeliveryFor(
  store: FormaStore, artifact: DocumentArtifact, contentSha256?: string | null, canvasId: string | null = null,
) {
  // Base facts only: deriving a delivery never recursively asks for lifecycle candidates.
  const facts = nextActionFacts(store, artifact.documentId, canvasId);
  const session = store.session.get(), context = session?.projectContext;
  const permissions = context?.permissions ?? session?.capabilities ?? [];
  return artifactDeliveryFromFacts(facts, artifact, {
    actorUserId: session?.user.userId ?? "", shared: Boolean(context), managedPilot: Boolean(context?.managedPilot),
    canReview: permissions.includes("project.review.approve"),
  }, contentSha256);
}
