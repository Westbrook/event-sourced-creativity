import type { ApplicationId } from "./applications";

export type WorkspaceTransitionIdentity = {
  user: { userId: string };
  canvas: { access: boolean };
  projectContext?: { organizationId: string; projectAccessId: string };
};

/** A fresh server session must preserve identity and the exact active project scope. */
export function workspaceTransitionAuthorized(
  current: WorkspaceTransitionIdentity | null | undefined,
  candidate: WorkspaceTransitionIdentity | null | undefined,
  destination: ApplicationId,
) {
  if (!current || !candidate || current.user.userId !== candidate.user.userId) return false;
  if (current.projectContext?.organizationId !== candidate.projectContext?.organizationId) return false;
  if (current.projectContext?.projectAccessId !== candidate.projectContext?.projectAccessId) return false;
  if (destination === "canvas") return candidate.canvas.access;
  return destination === "creative";
}
