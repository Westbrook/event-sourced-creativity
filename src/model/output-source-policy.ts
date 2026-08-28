/** Output requirements are instructions about owed work, never corpus evidence. */
export function isOutputContextBlock(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  return [block.type, block.Type, block.role].some((kind) => typeof kind === "string" && kind.trim().toLowerCase() === "output");
}
