import type { WorkerEnv } from "./runtime.ts";
import { nativeMemoryFingerprint } from "./memory-native-origin-schema.ts";

const schemaNames = "'memory_document_job_answer_origins','memory_document_job_origin_dependencies'";
const schemaExpression = `(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql))
  FROM(SELECT type,name,tbl_name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS sql
    FROM sqlite_schema WHERE tbl_name IN(${schemaNames}) ORDER BY name LIMIT 64))`;
// Source-derived from additive 0034. Runtime qualification must establish this
// exact sqlite_schema fingerprint; no compatibility rewrite or installation.
const schemaHash = "1478ba9179bae3863d36aff46ed6dd073de0d0f7dd3d189711af1e13627b93e8";

/** Exact job-native schema or witnessed total absence. This is a schema guard,
 * not enrollment, source authority, a publication receipt or permission to read.
 * A partial/changed schema denies ordinary fallback and dedicated operations.
 * Absence is not cached and must still hold in the eventual guarded operation. */
export async function nativeDocumentJobOriginSchema(env: WorkerEnv): Promise<{
  present: boolean; guard: {condition: string; bindings: (string | number | null)[]};
}> {
  const db = env.DB;
  return qualifyNativeDocumentJobOriginSchema(env,db,await nativeDocumentJobOriginSchemaRead(db).all<Record<string,unknown>>());
}

export const nativeDocumentJobOriginSchemaRead=(db:WorkerEnv["DB"])=>db.prepare(`SELECT ${schemaExpression} AS schema_json`);

/** Qualifies one captured observation; its exact SQL witness still guards use. */
export async function qualifyNativeDocumentJobOriginSchema(env:WorkerEnv,db:WorkerEnv["DB"],observation:unknown):Promise<{
  present:boolean;guard:{condition:string;bindings:(string|number|null)[]};
}> {
  const result=structuredClone(observation) as D1Result<Record<string,unknown>>;
  if (env.DB !== db) throw new Error("native_document_job_origin_schema_database_changed");
  if (!result || result.success !== true || (result as typeof result & {error?: unknown}).error !== undefined || !Array.isArray(result.results)
    || result.results.length !== 1 || !Object.hasOwn(result.results, 0))
    throw new Error("native_document_job_origin_schema_unavailable");
  const row = result.results[0];
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 1 || !Object.hasOwn(row, "schema_json"))
    throw new Error("native_document_job_origin_schema_unavailable");
  const json = row.schema_json;
  if (typeof json !== "string" || !json.isWellFormed() || new TextEncoder().encode(json).byteLength > 65536)
    throw new Error("native_document_job_origin_schema_unavailable");
  let rows: unknown;
  try { rows = JSON.parse(json); } catch { throw new Error("native_document_job_origin_schema_unavailable"); }
  if (!Array.isArray(rows)) throw new Error("native_document_job_origin_schema_unavailable");
  if (rows.length !== 0) {
    if (rows.length !== 16) throw new Error("native_document_job_origin_schema_unavailable");
    const fingerprint = await nativeMemoryFingerprint(rows);
    if (env.DB !== db) throw new Error("native_document_job_origin_schema_database_changed");
    if (fingerprint !== schemaHash) throw new Error("native_document_job_origin_schema_unavailable");
  }
  if (env.DB !== db) throw new Error("native_document_job_origin_schema_database_changed");
  return {present: rows.length === 16, guard: {condition: `${schemaExpression} IS ?`, bindings: [json]}};
}
