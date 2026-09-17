import type { WorkerEnv } from "./runtime.ts";
import { SELECTED_OUTPUT_SHARE_SCHEMA } from "./selected-output-share-schema.ts";

export type SelectedOutputShareSchemaState = "absent" | "ready" | "unavailable";
type SchemaAssertion = { sql: string; bindings: string[] };

const expected = SELECTED_OUTPUT_SHARE_SCHEMA.map(sql => {
  const match = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z_][a-z0-9_]*)(?:\s|\()/u.exec(sql);
  if (!match) throw new Error("selected_output_share_schema_definition_invalid");
  return { type: match[1]!.toLowerCase(), name: match[2]!, tbl_name: "selected_output_shares", sql };
});
const expectedJson = JSON.stringify(expected);
// The source-owned names are fixed identifiers, never supplied by a request.
const scope = `lower(tbl_name)='selected_output_shares' OR lower(name) IN(${expected.map(row => `'${row.name}'`).join(",")})`;
const noShadow = `NOT EXISTS(SELECT 1 FROM temp.sqlite_schema WHERE ${scope})`;
const absent = `NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE ${scope}) AND ${noShadow}`;
const ready = `(WITH expected AS(SELECT value FROM json_each(?)), actual AS(
  SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE (${scope}) AND sql IS NOT NULL)
  SELECT (SELECT count(*) FROM actual)=(SELECT count(*) FROM expected)
    AND NOT EXISTS(SELECT 1 FROM expected WHERE NOT EXISTS(SELECT 1 FROM actual
      WHERE actual.type=json_extract(expected.value,'$.type') AND actual.name=json_extract(expected.value,'$.name')
        AND actual.tbl_name=json_extract(expected.value,'$.tbl_name') AND actual.sql=json_extract(expected.value,'$.sql')))
    AND ${noShadow})`;

/** A same-statement schema guard, not source authority or permission to publish.
 * Exact table SQL pins CHECK/UNIQUE/WITHOUT ROWID; all named indexes and triggers
 * must match too. SQLite-owned implicit index names are intentionally not pinned.
 * No caller may replace this guard with an earlier readiness observation. */
export function selectedOutputShareSchemaAssertion(state: "ready" | "absent" = "ready"): SchemaAssertion {
  return state === "ready" ? { sql: ready, bindings: [expectedJson] } : { sql: absent, bindings: [] };
}

const own = (value: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
};

/** Fresh, read-only migration readiness. A missing or partial installation never
 * causes DDL, ordinary schema initialization, network access or a cached success. */
export async function selectedOutputShareSchemaState(env: Pick<WorkerEnv, "DB">): Promise<SelectedOutputShareSchemaState> {
  const db = env.DB;
  try {
    const result: unknown = await db.prepare(`SELECT CASE WHEN ${ready} THEN 'ready' WHEN ${absent} THEN 'absent' ELSE 'unavailable' END AS state`)
      .bind(expectedJson).all<Record<string, unknown>>();
    if (env.DB !== db || !result || typeof result !== "object" || Array.isArray(result)
      || own(result, "success") !== true || own(result, "error") !== undefined) return "unavailable";
    const error = Object.getOwnPropertyDescriptor(result, "error");
    if (error && !Object.hasOwn(error, "value")) return "unavailable";
    const rows = own(result, "results");
    if (!Array.isArray(rows) || rows.length !== 1) return "unavailable";
    const row = own(rows, 0);
    if (!row || typeof row !== "object" || Array.isArray(row) || Reflect.ownKeys(row).length !== 1) return "unavailable";
    const state = own(row, "state");
    return state === "ready" || state === "absent" ? state : "unavailable";
  } catch { return "unavailable"; }
}
