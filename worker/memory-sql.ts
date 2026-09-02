/** Server-owned SQL predicates, never SQL or authorization supplied by a browser. */
export type MemorySqlGuard = { condition: string; bindings: readonly (string | number | null)[] };
export type MemoryDatabase = Pick<D1Database, "prepare" | "batch">;

export class MemoryBoundaryError extends Error {
  constructor(code: string) { super(code); this.name = "MemoryBoundaryError"; }
}

export const memoryAssert = (condition: unknown, code: string): void => {
  if (!condition) throw new MemoryBoundaryError(code);
};

export function memoryGuardQuery(db: MemoryDatabase, guard: MemorySqlGuard): D1PreparedStatement {
  memoryAssert(guard.bindings.length <= 100 && !guard.condition.includes(";"), "invalid-server-memory-guard");
  return db.prepare(`SELECT CASE WHEN (${guard.condition}) THEN 1 ELSE 0 END AS verified`).bind(...guard.bindings);
}

/** Read-only checks share one database snapshot. No raw SQL/bindings appear in errors. */
export async function memoryGuardsCurrent(db: MemoryDatabase, guards: readonly MemorySqlGuard[]): Promise<boolean> {
  if (!guards.length) return false;
  try {
    const results = await db.batch<{ verified: number }>(guards.map((guard) => memoryGuardQuery(db, guard)));
    return results.length === guards.length && results.every((result) => result.success && result.results[0]?.verified === 1);
  } catch { throw new MemoryBoundaryError("memory-source-check-failed"); }
}

export const memoryCursorJson = (cursor: Readonly<Record<string, number>>) => JSON.stringify(Object.entries(cursor).sort(([left], [right]) => left.localeCompare(right)));
