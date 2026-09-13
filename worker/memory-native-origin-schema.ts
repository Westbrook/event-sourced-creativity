import type { WorkerEnv } from "./runtime.ts";

export const NATIVE_MEMORY_ORIGIN_LIMITS = { dependencies: 128, segments: 8, segmentMembers: 8,
  answerBytes: 65_536, consumedBytes: 16_384, metadataBytes: 131_072, excerptBytes: 512 } as const;

const bytes = (value: string) => new TextEncoder().encode(value);
const invalid = (): never => { throw new Error("native_memory_origin_invalid"); };

function canonical(value: unknown, depth = 0): unknown {
  if (depth > 20) return invalid();
  if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string") {
    if (!value.isWellFormed() || bytes(value).length > NATIVE_MEMORY_ORIGIN_LIMITS.answerBytes) return invalid();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) return invalid();
    return value.map(item => canonical(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort(); if (keys.length > 64) return invalid();
    return Object.fromEntries(keys.map(key => [key, canonical((value as Record<string, unknown>)[key], depth + 1)]));
  }
  return invalid();
}
export function nativeMemoryCanonical(value: unknown): string {
  const text = JSON.stringify(canonical(value));
  if (bytes(text).length > NATIVE_MEMORY_ORIGIN_LIMITS.metadataBytes) return invalid();
  return text;
}
async function hash(value: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", value as BufferSource);
  return Array.from(new Uint8Array(result), item => item.toString(16).padStart(2, "0")).join("");
}
export async function nativeMemoryFingerprint(value: unknown): Promise<string> {
  const owned = bytes(nativeMemoryCanonical(value)); return hash(owned);
}

const structuredOriginSchemaNames = "'memory_structured_answer_origins','memory_structured_answer_originals','memory_structured_answer_ledger_revisions'";
const structuredOriginSchemaExpression = `(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql))
  FROM(SELECT type,name,tbl_name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS sql
    FROM sqlite_schema WHERE tbl_name IN(${structuredOriginSchemaNames}) ORDER BY name LIMIT 64))`;
const structuredOriginSchemaHash = "ff2850772729b5650c41f4eda69cef6a6e3f2944782d0c9e5b5c1ffd5616d30c";
/** Exact normal additive 0033 schema or witnessed total absence. No installation,
 * compatibility rewrite, partial-schema cleanup skip or metadata authority. */
export async function nativeStructuredOriginSchema(env: WorkerEnv): Promise<{
  present: boolean; guard: {condition: string; bindings: (string | number | null)[]};
}> {
  const db = env.DB;
  const result = structuredClone(await db.prepare(`SELECT ${structuredOriginSchemaExpression} AS schema_json`).all<Record<string, unknown>>());
  if (env.DB !== db) throw new Error("native_structured_origin_schema_database_changed");
  if (result.success !== true || (result as typeof result & {error?: unknown}).error !== undefined || !Array.isArray(result.results) || result.results.length !== 1)
    throw new Error("native_structured_origin_schema_unavailable");
  const json = result.results[0].schema_json;
  if (typeof json !== "string" || bytes(json).length > 65536) throw new Error("native_structured_origin_schema_unavailable");
  let rows: unknown;
  try { rows = JSON.parse(json); } catch { throw new Error("native_structured_origin_schema_unavailable"); }
  if (!Array.isArray(rows)) throw new Error("native_structured_origin_schema_unavailable");
  if (rows.length !== 0) {
    if (rows.length !== 34) throw new Error("native_structured_origin_schema_unavailable");
    const fingerprint = await nativeMemoryFingerprint(rows);
    if (env.DB !== db) throw new Error("native_structured_origin_schema_database_changed");
    if (fingerprint !== structuredOriginSchemaHash) throw new Error("native_structured_origin_schema_unavailable");
  }
  if (env.DB !== db) throw new Error("native_structured_origin_schema_database_changed");
  return {present: rows.length === 34, guard: {condition: `${structuredOriginSchemaExpression} IS ?`, bindings: [json]}};
}

export { bytes, invalid, hash };
