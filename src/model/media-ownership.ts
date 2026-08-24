/**
 * Object keys must identify exactly one account. Character replacement is not
 * injective: for example, `team:a` and `team/a` both become `team-a`.
 */
export function ownerMediaNamespace(ownerId: string): string {
  const bytes = new TextEncoder().encode(ownerId);
  return `u-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Existing objects remain readable only after their exact object owner is checked. */
export function legacyOwnerMediaNamespace(ownerId: string): string {
  return ownerId.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function ownerMediaNamespaces(ownerId: string): string[] {
  return [...new Set([ownerMediaNamespace(ownerId), legacyOwnerMediaNamespace(ownerId)])];
}

export function mediaKeyMatchesOwnerNamespace(key: string, ownerId: string): boolean {
  return ownerMediaNamespaces(ownerId).some((namespace) => key.startsWith(`${namespace}/`));
}
