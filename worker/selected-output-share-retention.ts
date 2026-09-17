import type { WorkerEnv } from "./runtime.ts";
import { SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS } from "./selected-output-share-schema.ts";
import { selectedOutputShareSchemaAssertion, selectedOutputShareSchemaState } from "./selected-output-share-readiness.ts";

type RetentionEnv = Pick<WorkerEnv, "DB">;
type Binding = string | number | null;
type Query = { sql: string; bindings: Binding[] };
type Row = Record<string, Binding>;
const table = "main.selected_output_shares";
const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const privateAbsent = SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS.map(column => `${column} IS NULL`).join(" AND ");
const minimize = `${SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS.map(column => `${column}=NULL`).join(",")},minimized_at=${clock},revoked_at=COALESCE(revoked_at,${clock})`;
const eligible = "minimized_at IS NULL AND (expires_at<=? OR revoked_at<=?)";
const oldest = "CASE WHEN revoked_at IS NULL OR expires_at<revoked_at THEN expires_at ELSE revoked_at END";
const selectedColumns = ["share_id", "purpose", "replay_key", "token_hash", "issued_at", "revoked_at", "expires_at", "minimized_at", "oldest"];

function unavailable(): never { throw new Error("selected_output_share_retention_unavailable"); }
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function own(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !Object.hasOwn(descriptor, "value")) unavailable();
  return descriptor?.value;
}
function dense(value: unknown, length: number): value is unknown[] {
  return Array.isArray(value) && own(value, "length") === length && Reflect.ownKeys(value).length === length + 1
    && Array.from({ length }, (_, index) => Object.hasOwn(value, index)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, index)!, "value")).every(Boolean);
}
function rows(result: unknown, columns: readonly string[], maximum: number): Row[] {
  if (!record(result) || own(result, "success") !== true || own(result, "error") !== undefined) unavailable();
  const values = own(result, "results");
  if (!Array.isArray(values) || values.length > maximum || !dense(values, values.length)) unavailable();
  return values.map(value => {
    if (!record(value) || Reflect.ownKeys(value).length !== columns.length) unavailable();
    return Object.fromEntries(columns.map(column => {
      const field = own(value, column);
      if (field !== null && typeof field !== "string" && typeof field !== "number") unavailable();
      return [column, field];
    }));
  });
}
function assertion(condition: string, bindings: Binding[] = []): Query {
  return { sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json('selected_output_share_retention_unavailable') END AS verified`, bindings };
}
function schemaAssertion(state: "ready" | "absent"): Query {
  const query = selectedOutputShareSchemaAssertion(state);
  return assertion(query.sql, query.bindings);
}
function compile(db: RetentionEnv["DB"], query: Query): D1PreparedStatement {
  return db.prepare(query.sql).bind(...query.bindings);
}
function freeze(queries: Query[]): void {
  for (const query of queries) { Object.freeze(query.bindings); Object.freeze(query); }
  Object.freeze(queries);
}
function acknowledged(results: unknown, length: number, writeIndex = -1, changes = 0): boolean {
  try {
    if (!dense(results, length)) return false;
    for (let index = 0; index < length; index++) {
      const result = own(results, index);
      const values = rows(result, index === writeIndex ? [] : ["verified"], index === writeIndex ? 0 : 1);
      if (index !== writeIndex && (values.length !== 1 || values[0].verified !== 1)) return false;
      const meta = own(result as object, "meta");
      if (!record(meta) || own(meta, "changes") !== (index === writeIndex ? changes : 0)) return false;
    }
    return true;
  } catch { return false; }
}
async function verify(db: RetentionEnv["DB"], query: Query): Promise<void> {
  if (!acknowledged([await compile(db, query).all()], 1)) unavailable();
}
async function state(env: RetentionEnv, db: RetentionEnv["DB"]): Promise<"ready" | "absent"> {
  const current = await selectedOutputShareSchemaState(env);
  if (env.DB !== db || current === "unavailable") unavailable();
  return current;
}
function candidate(now: string): Query {
  return { sql: `SELECT ${selectedColumns.filter(column => column !== "oldest").join(",")},${oldest} AS oldest FROM ${table}
    WHERE ${eligible} ORDER BY oldest,share_id LIMIT 1`, bindings: [now, now] };
}

/** The confirmed erasure caller supplies the owner. This plan retires only this
 * dedicated table and must join the caller's existing erasure batch; it grants
 * no access, initializes no schema, and never removes replay/token tombstones. */
export async function preparePersonalSelectedOutputShareErasure(env: RetentionEnv, ownerId: string, now: string): Promise<{
  installed: boolean; statements: D1PreparedStatement[]; terminalAssertions: D1PreparedStatement[];
  acknowledge(results: readonly unknown[]): { minimizedCount: number } | null;
}> {
  const db = env.DB;
  if (typeof ownerId !== "string" || !ownerId || !ownerId.isWellFormed() || !timestamp(now)) unavailable();
  const current = await state(env, db), queries: Query[] = [schemaAssertion(current)], terminal: Query[] = [];
  let count = 0, writeIndex = -1;
  if (current === "ready") {
    const schema = selectedOutputShareSchemaAssertion();
    const result = rows(await db.prepare(`SELECT count(*) AS count,CASE WHEN (${schema.sql}) THEN 1
      ELSE json('selected_output_share_retention_unavailable') END AS verified FROM ${table} WHERE owner_id=?`)
      .bind(...schema.bindings, ownerId).all(), ["count", "verified"], 1);
    if (result.length !== 1 || result[0].verified !== 1 || typeof result[0].count !== "number"
      || !Number.isSafeInteger(result[0].count) || result[0].count < 0) unavailable();
    count = result[0].count;
    queries.push(assertion(`(SELECT count(*) FROM ${table} WHERE owner_id=?)=? AND ${clock}>=?`, [ownerId, count, now]));
    writeIndex = queries.length;
    queries.push({ sql: `UPDATE ${table} SET ${minimize} WHERE owner_id=? AND minimized_at IS NULL`, bindings: [ownerId] });
    queries.push(assertion("changes()=?", [count]));
    terminal.push(assertion(`NOT EXISTS(SELECT 1 FROM ${table} WHERE owner_id=?)`, [ownerId]));
  }
  terminal.push(schemaAssertion(current));
  if (env.DB !== db) unavailable();
  const statements = queries.map(query => compile(db, query)), terminalAssertions = terminal.map(query => compile(db, query));
  Object.freeze(statements); Object.freeze(terminalAssertions);
  let consumed = false;
  return Object.freeze({ installed: current === "ready", statements, terminalAssertions, acknowledge(results: readonly unknown[]) {
    if (consumed) return null; consumed = true;
    return env.DB === db && acknowledged(results, statements.length + terminalAssertions.length, writeIndex, count)
      ? { minimizedCount: count } : null;
  } });
}

/** One real eligible row is one existing runtime allowance unit. Expiry and
 * prior revocation are the only eligibility clocks: live candidates acquire no
 * invented cleanup lifetime. The caller commits this frozen plan atomically. */
export async function prepareSelectedOutputShareRetentionStep(env: RetentionEnv, input: { now: string }): Promise<null | {
  statements: Query[]; workUnits: 1; oldest: string; selectionKey: string; assertionIndexes: number[];
  acknowledge(results: readonly unknown[]): boolean;
}> {
  const db = env.DB, now = input.now;
  if (!timestamp(now)) unavailable();
  const current = await state(env, db);
  if (current === "absent") {
    await verify(db, schemaAssertion("absent"));
    if (env.DB !== db || input.now !== now) unavailable();
    return null;
  }
  const selection = candidate(now), selected = rows(await compile(db, selection).all(), selectedColumns, 1);
  if (!selected.length) {
    const schema = selectedOutputShareSchemaAssertion();
    await verify(db, assertion(`(${schema.sql}) AND NOT EXISTS(SELECT 1 FROM ${table} WHERE ${eligible})`, [...schema.bindings, now, now]));
    if (env.DB !== db || input.now !== now) unavailable();
    return null;
  }
  const row = selected[0];
  if (typeof row.share_id !== "string" || !row.share_id || row.share_id.length > 240 || !row.share_id.isWellFormed()
    || row.purpose !== "selected-output-read-v1" || typeof row.replay_key !== "string" || !/^[0-9a-f]{64}$/u.test(row.replay_key)
    || row.token_hash !== null && (typeof row.token_hash !== "string" || !/^[0-9a-f]{64}$/u.test(row.token_hash))
    || row.issued_at !== null && !timestamp(row.issued_at) || row.revoked_at !== null && !timestamp(row.revoked_at)
    || row.minimized_at !== null || !timestamp(row.expires_at) || !timestamp(row.oldest) || row.oldest > now) unavailable();
  const statements: Query[] = [schemaAssertion("ready"), assertion(`${clock}>=?`, [now])];
  statements.push(assertion(`EXISTS(SELECT 1 FROM (${selection.sql}) selected WHERE ${selectedColumns.map(column => `selected.${column} IS ?`).join(" AND ")})`,
    [...selection.bindings, ...selectedColumns.map(column => row[column])]));
  const writeIndex = statements.length;
  statements.push({ sql: `UPDATE ${table} SET ${minimize} WHERE share_id=? AND ${eligible}`, bindings: [row.share_id, now, now] });
  statements.push(assertion("changes()=1"));
  statements.push(assertion(`EXISTS(SELECT 1 FROM ${table} WHERE share_id=? AND purpose=? AND replay_key=? AND token_hash IS ? AND issued_at IS ?
    AND ${privateAbsent} AND minimized_at>=? AND minimized_at<=${clock}
    AND revoked_at IS ${row.revoked_at === null ? "minimized_at" : "?"})`,
  [row.share_id, row.purpose, row.replay_key, row.token_hash, row.issued_at, now, ...(row.revoked_at === null ? [] : [row.revoked_at])]));
  statements.push(schemaAssertion("ready"));
  if (env.DB !== db || input.now !== now) unavailable();
  const assertionIndexes = statements.map((_, index) => index).filter(index => index !== writeIndex);
  freeze(statements); Object.freeze(assertionIndexes);
  let consumed = false;
  return Object.freeze({ statements, workUnits: 1 as const, oldest: row.oldest, selectionKey: row.share_id, assertionIndexes,
    acknowledge(results: readonly unknown[]) {
      if (consumed) return false; consumed = true;
      return env.DB === db && input.now === now && acknowledged(results, statements.length, writeIndex, 1);
    } });
}

/** Eligible real rows, excluding minimized tombstones and still-live shares. */
export async function selectedOutputShareRetentionBacklog(env: RetentionEnv, input: { now: string }): Promise<{ count: number; oldest: string | null }> {
  const db = env.DB, now = input.now;
  if (!timestamp(now)) unavailable();
  const current = await state(env, db);
  if (current === "absent") {
    await verify(db, schemaAssertion("absent"));
    if (env.DB !== db || input.now !== now) unavailable();
    return { count: 0, oldest: null };
  }
  const schema = selectedOutputShareSchemaAssertion();
  const result = rows(await db.prepare(`SELECT count(*) AS count,min(${oldest}) AS oldest,CASE WHEN (${schema.sql}) AND ${clock}>=?
    THEN 1 ELSE json('selected_output_share_retention_unavailable') END AS verified FROM ${table} WHERE ${eligible}`)
    .bind(...schema.bindings, now, now, now).all(), ["count", "oldest", "verified"], 1);
  if (env.DB !== db || input.now !== now || result.length !== 1 || result[0].verified !== 1) unavailable();
  const row = result[0];
  if (typeof row.count !== "number" || !Number.isSafeInteger(row.count) || row.count < 0
    || (row.count === 0 ? row.oldest !== null : !timestamp(row.oldest) || row.oldest > now)) unavailable();
  return { count: row.count, oldest: row.oldest as string | null };
}
