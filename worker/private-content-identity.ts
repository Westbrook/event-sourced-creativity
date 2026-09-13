/** Stable private IDs remain paired with their dedicated content kind. */
export function privateContentIdentityAllowed(kind: string, identity: { contentId: string }): boolean {
  if (kind === "authoring-preview") return /^copy-preview-[a-f0-9]{64}$/u.test(identity.contentId)
    || /^canvas-arrangement-preview-[a-f0-9]{64}$/u.test(identity.contentId);
  return kind === "experience-draft" && /^experience-draft-[a-f0-9]{64}$/u.test(identity.contentId);
}
