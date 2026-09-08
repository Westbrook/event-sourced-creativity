import type { PilotUser } from "./pilot-policy.ts";

export type NativeMemorySqlValue = string | number | null;
type Value = NativeMemorySqlValue;
export type NativeMemoryQuery = { sql: string; bindings: Value[]; role: "exact" };
type Row = Record<string, unknown>;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240;

export const nativeMemoryTimestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value ? at : null;
};
export const nativeMemoryDescriptor = (sql: string, bindings: readonly Value[]): NativeMemoryQuery => {
  if (bindings.length > 99 || sql.length > 90_000 || bindings.some(value =>
    value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value)))) {
    throw new Error("native_memory_query_limit");
  }
  return { sql, bindings: [...bindings], role: "exact" };
};

/** Capture the ORIGINAL authenticated grant deadlines before another await.
 * The exact admission guard binds raw grants even if capability/identity filtering
 * excludes a row from access.grants. The native query excludes already-expired
 * rows, so an expired captured row rejects this stale request, not future fresh ones.
 * undefined is invalid; null is a valid absence of expiring grants. */
export function nativeMemoryGrantDeadline(principal: Pick<PilotUser, "access" | "authorizationSnapshot">, at: number): string | null | undefined {
  if (!Number.isFinite(at) || !Array.isArray(principal.access?.grants)
    || typeof principal.authorizationSnapshot?.grants !== "string") return undefined;
  let raw: unknown;
  try { raw = JSON.parse(principal.authorizationSnapshot.grants); } catch { return undefined; }
  if (!Array.isArray(raw)) return undefined;
  const deadlines: number[] = [];
  for (const grants of [raw, principal.access.grants]) {
    for (const grant of grants) {
      if (!grant || typeof grant !== "object" || Array.isArray(grant)) return undefined;
      if (grant.expiresAt === null) continue;
      const expiry = nativeMemoryTimestamp(grant.expiresAt);
      if (expiry === null || expiry <= at) return undefined;
      deadlines.push(expiry);
    }
  }
  return deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null;
}

/** All relevant scheduled pilot boundaries, not merely the next still-future row.
 * The exact raw rows are certified again before the assistant response. */
export function nativeMemoryPilotQuery(configured: string): NativeMemoryQuery {
  return nativeMemoryDescriptor("SELECT cohort_id,organization_id,status,starts_at,ends_at FROM pilot_cohorts" +
    " WHERE cohort_id=? OR (organization_id=(SELECT organization_id FROM pilot_cohorts WHERE cohort_id=?)" +
    " AND status IN('active','paused')) ORDER BY cohort_id LIMIT 129", [configured, configured]);
}

export function nativeMemoryPilotDeadline(rows: readonly Row[], configured: string, at: number): string | null | undefined {
  if (!Number.isFinite(at) || rows.length === 0 || rows.length > 128) return undefined;
  const selected = rows.filter(row => row.cohort_id === configured);
  if (selected.length !== 1 || !id(selected[0].organization_id)) return undefined;
  const deadlines: number[] = [], seen = new Set<string>();
  for (const row of rows) {
    const start = nativeMemoryTimestamp(row.starts_at), end = nativeMemoryTimestamp(row.ends_at);
    if (!id(row.cohort_id) || seen.has(row.cohort_id) || row.organization_id !== selected[0].organization_id
      || start === null || end === null || start >= end
      || row.cohort_id !== configured && row.status !== "active" && row.status !== "paused") return undefined;
    seen.add(row.cohort_id);
    if (start > at) deadlines.push(start);
    if (end > at) deadlines.push(end);
  }
  return deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null;
}
