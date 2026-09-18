/** Stable private IDs remain paired with their dedicated content kind. */
export function privateContentIdentityAllowed(kind: string, identity: { contentId: string }): boolean {
  if (kind === "guest-image-stage-history") return /^guest-image-stage-history-[a-f0-9]{64}$/u.test(identity.contentId);
  if (kind === "guest-image-result-history") return /^guest-image-result-history-[a-f0-9]{64}$/u.test(identity.contentId);
  if (kind === "authoring-preview") return /^copy-preview-[a-f0-9]{64}$/u.test(identity.contentId)
    || /^canvas-arrangement-preview-[a-f0-9]{64}$/u.test(identity.contentId);
  return kind === "experience-draft" && /^experience-draft-[a-f0-9]{64}$/u.test(identity.contentId);
}
