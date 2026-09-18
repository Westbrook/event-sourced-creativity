import type { WorkerEnv } from "../runtime.ts";
import type { BudgetReservationGuard } from "../pilot-policy.ts";

/** Exact reviewed schema; availability is not qualification or a spending grant. */
export const memoryBenchmarkSchemaProfile = {
  "source": "native-memory-benchmark-v1",
  "names": [
    "memory_benchmark_assertions",
    "memory_benchmark_experiment_immutable",
    "memory_benchmark_experiment_no_delete",
    "memory_benchmark_experiment_no_replace",
    "memory_benchmark_experiments",
    "memory_benchmark_native_assertions",
    "memory_benchmark_native_cost_no_delete",
    "memory_benchmark_native_cost_no_late_reserve",
    "memory_benchmark_native_cost_no_replace",
    "memory_benchmark_native_cost_settlement",
    "memory_benchmark_native_dispatch",
    "memory_benchmark_native_disposition_no_delete",
    "memory_benchmark_native_disposition_no_replace",
    "memory_benchmark_native_disposition_no_update",
    "memory_benchmark_native_disposition_no_usage",
    "memory_benchmark_native_disposition_proof",
    "memory_benchmark_native_dispositions",
    "memory_benchmark_native_grant_immutable",
    "memory_benchmark_native_grant_no_delete",
    "memory_benchmark_native_grant_no_replace",
    "memory_benchmark_native_grants",
    "memory_benchmark_native_operation_immutable",
    "memory_benchmark_native_operation_no_delete",
    "memory_benchmark_native_operation_no_replace",
    "memory_benchmark_native_operations",
    "memory_benchmark_native_qualifications",
    "memory_benchmark_native_token_no_delete",
    "memory_benchmark_native_token_no_late_reserve",
    "memory_benchmark_native_token_no_replace",
    "memory_benchmark_native_token_settlement",
    "memory_benchmark_one_outstanding_operation",
    "memory_benchmark_operation_immutable",
    "memory_benchmark_operation_no_delete",
    "memory_benchmark_operation_no_preexisting_purge",
    "memory_benchmark_operation_no_replace",
    "memory_benchmark_operations"
  ],
  "tables": [
    "memory_benchmark_assertions",
    "memory_benchmark_experiments",
    "memory_benchmark_native_assertions",
    "memory_benchmark_native_dispositions",
    "memory_benchmark_native_grants",
    "memory_benchmark_native_operations",
    "memory_benchmark_native_qualifications",
    "memory_benchmark_operations"
  ],
  "digest": "sha256:3d53a342d5dc79f03d802a8ed2abaf41a31adfe27b5f1face7cf647a873c2ec2",
  "count": 36
} as const;

const query = `SELECT type,name,tbl_name,sql FROM main.sqlite_schema
  WHERE lower(name) GLOB 'memory_benchmark_*' OR lower(tbl_name) GLOB 'memory_benchmark_*'
  ORDER BY name,type`;
const ddl = (value: string) => value.trim().replace(/;$/u, "")
  .replace(/^CREATE (TABLE|INDEX|UNIQUE INDEX|TRIGGER) IF NOT EXISTS /u, "CREATE $1 ");

/** Capture the complete family and bind it into every subsequent write guard.
 * Never cache across requests, create schema, or accept table presence alone. */
export async function nativeBenchmarkSchemaGuard(env: WorkerEnv): Promise<BudgetReservationGuard | null> {
  const db = env.DB;
  const result = await db.prepare(query + " LIMIT 97").all<Record<string, unknown>>();
  if (env.DB !== db || !result || result.success !== true || "error" in result
    || !Array.isArray(result.results) || result.results.length > 96) return null;
  const names = new Set<string>(memoryBenchmarkSchemaProfile.names);
  const tables = new Set<string>(memoryBenchmarkSchemaProfile.tables);
  const seen = new Set<string>(), rows: Record<string, unknown>[] = [], explicit: Record<string, unknown>[] = [];
  for (const row of result.results) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "name,sql,tbl_name,type"
      || typeof row.name !== "string" || typeof row.tbl_name !== "string" || typeof row.type !== "string"
      || seen.has(row.name) || !["table", "index", "trigger"].includes(row.type)) return null;
    seen.add(row.name);
    if (row.sql === null) {
      if (row.type !== "index" || !tables.has(row.tbl_name) || !row.name.startsWith(`sqlite_autoindex_${row.tbl_name}_`)
        || !/^\d+$/u.test(row.name.slice(`sqlite_autoindex_${row.tbl_name}_`.length))) return null;
    } else {
      if (!names.has(row.name) || typeof row.sql !== "string" || row.sql.length > 32768) return null;
      explicit.push({ type: row.type, name: row.name, table: row.tbl_name, sql: ddl(row.sql) });
    }
    rows.push({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql });
  }
  // These four string fields are emitted in canonical key order. Do not pull
  // the Experience compiler or its UI/source graph into the benchmark runner.
  const encoded = JSON.stringify(explicit.map(row => ({ name: row.name, sql: row.sql, table: row.table, type: row.type })));
  const fingerprint = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded))),
    byte => byte.toString(16).padStart(2, "0")).join("")}`;
  if (explicit.length !== memoryBenchmarkSchemaProfile.count || fingerprint !== memoryBenchmarkSchemaProfile.digest || env.DB !== db) return null;
  // Keep the SQL-produced JSON key order; the digest's canonical order above is
  // independent. The raw snapshot also detects later automatic-index drift.
  const snapshot = JSON.stringify(rows);
  const budgetQuery = `SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE type='trigger'
    AND lower(tbl_name) IN('budget_reservations','cost_budget_reservations') ORDER BY name,type`;
  const budget = await db.prepare(`SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) AS snapshot,
    count(*) AS count FROM (${budgetQuery} LIMIT 97)`).first<{ snapshot: string; count: number }>();
  if (env.DB !== db || !budget || typeof budget.snapshot !== 'string' || !Number.isSafeInteger(budget.count)
    || budget.count > 96 || budget.snapshot.length > 262144) return null;
  const watched = JSON.stringify(memoryBenchmarkSchemaProfile.tables), allowed = JSON.stringify(memoryBenchmarkSchemaProfile.names);
  const guard = { sql: `(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${query}))=?
    AND (SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${budgetQuery}))=?
    AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema dependency WHERE dependency.type IN('view','trigger')
      AND EXISTS(SELECT 1 FROM json_each(?) watched WHERE instr(lower(dependency.sql),watched.value)>0)
      AND dependency.name NOT IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema child,pragma_foreign_key_list(child.name,'main') fk
      WHERE child.type='table' AND instr(lower(child.sql),'references')>0
      AND lower(fk.[table]) IN(SELECT value FROM json_each(?)) AND child.name NOT IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)`, bindings: [snapshot, budget.snapshot, watched, allowed, watched, watched] };
  const current = await db.prepare("SELECT 1 AS current WHERE " + guard.sql).bind(...guard.bindings).first<{ current: number }>();
  return env.DB === db && current?.current === 1 ? guard : null;
}
