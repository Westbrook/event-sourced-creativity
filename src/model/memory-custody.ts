/** A consent constraint only. Native authorization must resolve custody independently. */
export const MEMORY_WRITE_CONTRACT = "memory-settings-custody-v1" as const;

export type MemoryCustody = Readonly<{ kind: "personal" }> | Readonly<{
  kind: "organization"; organizationId: string; projectAccessId: string; ownerUserId: string;
}>;
export type ResolvedMemoryCustody = {
  organizationId: string; projectAccessId: string; ownerUserId: string;
} | null;

/** Copies exact JSON fields; never normalizes an identity or infers missing custody. */
export function parseMemoryCustody(value: unknown): MemoryCustody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const captured = new Map<PropertyKey, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    captured.set(key, descriptor.value);
  }
  const kind = captured.get("kind");
  const fields = kind === "personal" ? ["kind"]
    : kind === "organization" ? ["kind", "organizationId", "projectAccessId", "ownerUserId"] : null;
  if (!fields || captured.size !== fields.length || fields.some(key => !captured.has(key))) return null;
  if (kind === "personal") return Object.freeze({ kind: "personal" });
  const organizationId = captured.get("organizationId"), projectAccessId = captured.get("projectAccessId"), ownerUserId = captured.get("ownerUserId");
  if (typeof organizationId !== "string" || !organizationId || typeof projectAccessId !== "string" || !projectAccessId
    || typeof ownerUserId !== "string" || !ownerUserId) return null;
  return Object.freeze({ kind: "organization", organizationId, projectAccessId, ownerUserId });
}

/** Matching this constraint does not replace native access or transactional admission. */
export function memoryCustodyMatches(expected: MemoryCustody, resolved: ResolvedMemoryCustody): boolean {
  return expected.kind === "personal" ? resolved === null
    : resolved !== null && expected.organizationId === resolved.organizationId
      && expected.projectAccessId === resolved.projectAccessId && expected.ownerUserId === resolved.ownerUserId;
}
