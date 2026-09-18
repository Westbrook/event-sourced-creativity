import type { WorkerEnv } from "./runtime.ts";
import { nativeMemoryFingerprint } from "./memory-native-origin.ts";

const schemaNames = "'memory_document_job_origin_retirement_progress'";
const schemaExpression = `(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql))
  FROM(SELECT type,name,tbl_name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS sql
    FROM sqlite_schema WHERE tbl_name IN(${schemaNames}) ORDER BY name LIMIT 64))`;
// Source-derived from the owned unnumbered schema.sql proposal. Runtime qualification must establish this
// exact sqlite_schema fingerprint; no compatibility rewrite or installation.
const schemaHash = "ef5b2a629cbd7691673828876a0f1173ffc12ca64a4d63645913c5a8116770be";

/** Exact retirement-progress schema or witnessed total absence. This is a schema guard,
 * not enrollment, source authority, a publication receipt, cleanup proof or permission to read.
 * A partial/changed schema denies ordinary fallback and dedicated operations.
 * Absence is not cached and must still hold in the eventual guarded operation. */
export async function nativeDocumentJobOriginRetirementSchema(env: WorkerEnv): Promise<{
  present: boolean; guard: {condition: string; bindings: (string | number | null)[]};
}> {
  const db = env.DB;
  const result = structuredClone(await db.prepare(`SELECT ${schemaExpression} AS schema_json`).all<Record<string, unknown>>());
  if (env.DB !== db) throw new Error("native_document_job_origin_retirement_schema_database_changed");
  if (!result || result.success !== true || (result as typeof result & {error?: unknown}).error !== undefined || !Array.isArray(result.results)
    || result.results.length !== 1 || !Object.hasOwn(result.results, 0))
    throw new Error("native_document_job_origin_retirement_schema_unavailable");
  const row = result.results[0];
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 1 || !Object.hasOwn(row, "schema_json"))
    throw new Error("native_document_job_origin_retirement_schema_unavailable");
  const json = row.schema_json;
  if (typeof json !== "string" || !json.isWellFormed() || new TextEncoder().encode(json).byteLength > 65536)
    throw new Error("native_document_job_origin_retirement_schema_unavailable");
  let rows: unknown;
  try { rows = JSON.parse(json); } catch { throw new Error("native_document_job_origin_retirement_schema_unavailable"); }
  if (!Array.isArray(rows)) throw new Error("native_document_job_origin_retirement_schema_unavailable");
  if (rows.length !== 0) {
    if (rows.length !== 5) throw new Error("native_document_job_origin_retirement_schema_unavailable");
    const fingerprint = await nativeMemoryFingerprint(rows);
    if (env.DB !== db) throw new Error("native_document_job_origin_retirement_schema_database_changed");
    if (fingerprint !== schemaHash) throw new Error("native_document_job_origin_retirement_schema_unavailable");
  }
  if (env.DB !== db) throw new Error("native_document_job_origin_retirement_schema_database_changed");
  return {present: rows.length === 5, guard: {condition: `${schemaExpression} IS ?`, bindings: [json]}};
}
