import { principalHasCapability, type PrincipalAccess } from "./access-policy.ts";
import { requirePlatformAssistantPrincipal } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

export const OUTPUT_SCHEMA_PREFLIGHT_PATH = "/api/portfolio/engineering/schema-preflight";
const headers = { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email, cf-access-authenticated-user-email" };
const tables = ["output_plan_targets", "output_assets", "output_asset_storage_writes", "output_atomic_assertions", "output_operation_slots", "output_results", "output_plan_fulfillments"] as const;
const reserved = ["__output_plan_targets_model3d", "__output_assets_model3d", "__output_asset_storage_writes_model3d", "__output_model3d_migration_guard"];
const names = [...tables, ...reserved].map(name => `'${name}'`).join(",");
const watched = [tables[0], tables[1], tables[2], ...reserved].map(name => `'${name}'`).join(",");
const maximumRows = 1000;

// Fixed metadata queries only. There is no caller-supplied SQL, table, filter,
// or application-row projection. Overflow fails closed rather than certifying
// a truncated inventory. These reads do not certify the hosted migration runner.
export const OUTPUT_SCHEMA_PREFLIGHT_QUERIES = [
  { id: "settings", sql: `SELECT NULL AS sqlite_version,
    (SELECT foreign_keys FROM pragma_foreign_keys) AS foreign_keys,
    (SELECT defer_foreign_keys FROM pragma_defer_foreign_keys) AS defer_foreign_keys,
    (SELECT ignore_check_constraints FROM pragma_ignore_check_constraints) AS ignore_check_constraints,
    (SELECT legacy_alter_table FROM pragma_legacy_alter_table) AS legacy_alter_table,
    (SELECT count(*) FROM temp.sqlite_schema) AS temp_object_count` },
  { id: "catalog", sql: `SELECT type,name,tbl_name,sql FROM main.sqlite_schema
    WHERE lower(name) IN (${names}) OR lower(tbl_name) IN (${names})
    ORDER BY tbl_name COLLATE BINARY,type COLLATE BINARY,name COLLATE BINARY LIMIT 1001` },
  { id: "inboundKeys", sql: `SELECT child.name AS child_table,child.sql AS child_declaration,
    fk.id,fk.seq,fk.[table] AS parent_table,fk.[from] AS child_column,fk.[to] AS parent_column,
    fk.on_update,fk.on_delete,fk.[match]
    FROM main.sqlite_schema AS child,pragma_foreign_key_list(child.name,'main') AS fk
    WHERE child.type='table' AND instr(lower(child.sql),'references')>0 AND lower(fk.[table]) IN (${watched})
    ORDER BY child.name COLLATE BINARY,fk.id,fk.seq LIMIT 1001` },
  { id: "viewsAndTriggers", sql: `SELECT type,name,tbl_name,sql FROM main.sqlite_schema
    WHERE type IN ('view','trigger') ORDER BY type COLLATE BINARY,name COLLATE BINARY LIMIT 1001` },
  { id: "foreignKeyHealth", sql: "SELECT CAST(count(*) AS TEXT) AS foreign_key_violation_count FROM pragma_foreign_key_check" },
  ...tables.map(table => ({ id: table, sql: `SELECT '${table}' AS table_name,CAST(count(*) AS TEXT) AS row_count FROM main."${table}"` })),
  { id: "reservedReferences", sql: `SELECT CAST(count(*) AS TEXT) AS row_count FROM main.sqlite_schema WHERE ${reserved.map(name => `instr(lower(coalesce(sql,'')),'${name}')>0`).join(" OR ")}` },
  { id: "legacyAssertion", sql: "SELECT CAST(count(*) AS TEXT) AS row_count FROM output_atomic_assertions WHERE token='output-model3d-schema-foreign-keys'" },
] as const;

export function canReadOutputSchemaPreflight(access: PrincipalAccess): boolean {
  return principalHasCapability(access, "platform.identity.manage")
    && principalHasCapability(access, "engineering.diagnostics.read");
}

export async function readOutputSchemaPreflight(db: D1Database) {
  const results = await db.batch(OUTPUT_SCHEMA_PREFLIGHT_QUERIES.map(query => db.prepare(query.sql)));
  if (results.length !== OUTPUT_SCHEMA_PREFLIGHT_QUERIES.length || results.some(result => !result.success || !Array.isArray(result.results))) {
    throw new Error("schema_preflight_incomplete");
  }
  if (results.some(result => result.results.length > maximumRows)) throw new Error("schema_preflight_too_large");
  for (const [index, query] of OUTPUT_SCHEMA_PREFLIGHT_QUERIES.entries()) {
    if (["catalog", "inboundKeys", "viewsAndTriggers"].includes(query.id)) continue;
    const rows = results[index]!.results as Record<string, unknown>[];
    if (rows.length !== 1) throw new Error("schema_preflight_incomplete");
    if (query.id === "settings") {
      if (rows[0]!.sqlite_version !== null || !["foreign_keys", "defer_foreign_keys", "ignore_check_constraints", "legacy_alter_table", "temp_object_count"].every(key => Number.isSafeInteger(rows[0]![key]) && Number(rows[0]![key]) >= 0)) throw new Error("schema_preflight_incomplete");
    } else {
      const count = rows[0]![query.id === "foreignKeyHealth" ? "foreign_key_violation_count" : "row_count"];
      if (typeof count !== "string" || !/^(?:0|[1-9]\d*)$/u.test(count)) throw new Error("schema_preflight_incomplete");
      if (tables.some(table => table === query.id) && rows[0]!.table_name !== query.id) throw new Error("schema_preflight_incomplete");
    }
  }
  const snapshot = { contract: "forma.output-schema-preflight.v1", capturedAt: new Date().toISOString(), complete: true,
    execution: { api: "D1Database.batch", metadataOnly: true, hostedMigrationCertified: false,
      engineVersion: "unavailable: D1 does not authorize sqlite_version()" },
    groups: Object.fromEntries(OUTPUT_SCHEMA_PREFLIGHT_QUERIES.map((query, index) => [query.id, results[index]!.results])) };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 512_000) throw new Error("schema_preflight_too_large");
  return snapshot;
}

export async function handleOutputSchemaPreflight(request: Request, env: WorkerEnv): Promise<Response> {
  const refuse = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, allow: "GET" } });
  if (new URL(request.url).search) return refuse("schema_preflight_parameters_not_supported", 400);
  // Reject ambiguous account contexts before inherited startup/authentication.
  if (/(?:^|;\s*)(?:forma_impersonation|forma_project_context)=/.test(request.headers.get("cookie") ?? "")) {
    return refuse("return_to_principal_before_internal_access", 409);
  }
  const authorization = await requirePlatformAssistantPrincipal(request, env);
  if (authorization.response || !authorization.principal) {
    const response = authorization.response ?? refuse("authentication_required", 401);
    const privateHeaders = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers)) privateHeaders.set(name, value);
    return new Response(response.body, { status: response.status, headers: privateHeaders });
  }
  if (!canReadOutputSchemaPreflight(authorization.principal.access)) return refuse("access_denied", 403);
  try {
    return Response.json(await readOutputSchemaPreflight(env.DB), { headers });
  } catch {
    // Never return database errors, query text, partial inventories or row data.
    return refuse("schema_preflight_unavailable", 503);
  }
}
