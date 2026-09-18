import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { authorizationQuery, eventCte, nativeRetainedSourceFinalGuard, personalContentGuard,
  type NativeRetainedIdentity } from "./native-retained-text-custody.ts";
import type { WorkerEnv } from "./runtime.ts";

type Assertion = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
type Row = Record<string, unknown>;
type Cell = Readonly<{ name: string; kind: "text" | "integer"; nullable?: boolean }>;
type Query = Readonly<{ sql: string; cells: readonly Cell[]; maximumRows: number;
  bindings: readonly unknown[]; orderBy?: string; final?: boolean }>;
const encoder = new TextEncoder();
const ENVELOPE_BYTES = 16_384;
const fail = (code: string): never => { throw new SponsorEntitlementError(`sponsor_story_read_${code}`); };
const text = (name: string, nullable = false): Cell => ({ name, kind: "text", nullable });
const integer = (name: string): Cell => ({ name, kind: "integer" });
const dense = (value: unknown, length: number): value is unknown[] => {
  if (!Array.isArray(value) || value.length !== length) return false;
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(value, index) || value[index] === undefined) return false;
  }
  return true;
};
function acknowledged(value: unknown, count: number): value is D1Result<Row>[] {
  if (!dense(value, count)) return false;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || !Object.hasOwn(item, "success") || (item as D1Result<Row>).success !== true
      || !Object.hasOwn(item, "results")) return false;
    const rows = (item as D1Result<Row>).results;
    if (!Array.isArray(rows) || !dense(rows, rows.length)) return false;
  }
  return true;
}
function scalar(row: unknown, name: "admitted" | "current") {
  return row !== null && typeof row === "object" && !Array.isArray(row)
    && Object.keys(row).length === 1 && Object.hasOwn(row, name) && (row as Row)[name] === 1;
}

/** One finite attempt covers control, native reads, final receipts and response.
 * Await factories are guarded before dispatch as well as after completion. */
export class SponsorStoryReadBudget {
  private used = 0;
  private queries = 0;
  readonly maximumBytes: number;
  readonly monotonicDeadline: number;
  readonly signal: AbortSignal;
  private readonly current: () => void;
  constructor(maximumBytes: number, monotonicDeadline: number, signal: AbortSignal, current: () => void) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || !Number.isFinite(monotonicDeadline)) fail("budget_invalid");
    this.maximumBytes = maximumBytes; this.monotonicDeadline = monotonicDeadline;
    this.signal = signal; this.current = current;
  }
  check() {
    this.current();
    if (this.signal.aborted || performance.now() >= this.monotonicDeadline) fail("deadline");
  }
  get remainingBytes() { this.check(); return this.maximumBytes - this.used; }
  expect(size: number) {
    this.check();
    if (!Number.isSafeInteger(size) || size < 0 || size > this.maximumBytes - this.used) fail("byte_capacity");
  }
  spend(size: number) { this.expect(size); this.used += size; }
  account(value: unknown) { this.spend(encoder.encode(JSON.stringify(value)).byteLength); }
  count(size: number) { this.check(); this.queries += size; if (this.queries > 128) fail("query_capacity"); }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const value = await Promise.race([work(), new Promise<never>((_, reject) => {
        abort = () => reject(new SponsorEntitlementError("sponsor_story_read_deadline"));
        timer = setTimeout(abort, Math.max(1, this.monotonicDeadline - performance.now()));
        this.signal.addEventListener("abort", abort, { once: true });
        if (this.signal.aborted) abort();
      })]);
      this.check(); return value;
    } finally { clearTimeout(timer); if (abort) this.signal.removeEventListener("abort", abort); }
  }
}

/** The selected Story has no completion-job or media variants. This is the
 * exact existing native source/auth/history proof, generated from trusted code. */
export function sponsorNativeStoryFinalSql(env: WorkerEnv, identity: NativeRetainedIdentity) {
  return `WITH ${authorizationQuery(env, identity).cte},${eventCte},expected_events AS (SELECT value FROM json_each(?))
    SELECT 1 AS admitted FROM private_content WHERE ${nativeRetainedSourceFinalGuard()}`;
}

function metrics(query: Query) {
  const valid = query.cells.map(cell => {
    const type = cell.kind === "text" ? `typeof(${cell.name})='text'`
      : `(typeof(${cell.name})='integer' AND ${cell.name} BETWEEN 0 AND 9007199254740991)`;
    return cell.nullable ? `(${cell.name} IS NULL OR ${type})` : type;
  }).join(" AND ");
  const object = `json_object(${query.cells.flatMap(cell => [`'${cell.name}'`, cell.name]).join(",")})`;
  // This is the complete escaped row-object array size, not the raw text sum.
  // Nothing from candidate crosses the D1 boundary until the aggregate fits.
  return `SELECT COUNT(*) AS count,CASE WHEN COUNT(*)<=${query.maximumRows}
    AND COALESCE(MIN(CASE WHEN ${valid} THEN 1 ELSE 0 END),1)=1 THEN 1 ELSE 0 END AS valid,
    2+COALESCE(SUM(length(CAST(${object} AS BLOB))+1),0)-CASE WHEN COUNT(*)>0 THEN 1 ELSE 0 END AS bytes FROM candidate`;
}

/** Closed adapter for the three actual selected-Story read queries. No raw SQL
 * pattern fallback, caller-supplied query descriptor, write, or media operation. */
export function sponsorStoryReadEnvironment(env: WorkerEnv, identity: NativeRetainedIdentity, budget: SponsorStoryReadBudget) {
  const database = env.DB;
  const statements = new WeakMap<D1PreparedStatement, Query>();
  const principal = `WITH ${authorizationQuery(env, identity).cte} SELECT auth_json FROM authorized`;
  const history = `WITH ${eventCte} SELECT * FROM event_rows ORDER BY sequence`;
  const content = `SELECT content,expires_at FROM private_content WHERE ${personalContentGuard()}`;
  const final = sponsorNativeStoryFinalSql(env, identity);
  const classify = (sql: string): Query => {
    if (sql === principal) return { sql, cells: [text("auth_json")], maximumRows: 1, bindings: [] };
    if (sql === history) return { sql, cells: [text("event_id"), integer("sequence"), text("type"), text("payload"),
      text("secret_id", true), text("secret_owner", true), text("secret_document", true), text("secret_project", true),
      text("secret_redacted", true), integer("project_scoped")], maximumRows: 512, bindings: [], orderBy: "sequence" };
    if (sql === content) return { sql, cells: [text("content"), text("expires_at")], maximumRows: 1, bindings: [] };
    if (sql === final) return { sql, cells: [integer("admitted")], maximumRows: 1, bindings: [], final: true };
    return fail("query_unbounded");
  };
  const run = async (query: Query): Promise<D1Result<Row>> => {
    if (query.final) return fail("final_siblings_required");
    budget.check(); budget.count(2); budget.expect(2 * ENVELOPE_BYTES);
    const maximum = budget.remainingBytes - 2 * ENVELOPE_BYTES;
    const cte = `WITH candidate AS MATERIALIZED (${query.sql}), bounds AS MATERIALIZED (${metrics(query)})`;
    const results = await budget.wait(() => database.batch<Row>([
      database.prepare(`${cte} SELECT count,valid,bytes FROM bounds`).bind(...query.bindings),
      database.prepare(`${cte} SELECT ${query.cells.map(cell => cell.name).join(",")} FROM candidate
        WHERE (SELECT valid=1 AND bytes<=${maximum} FROM bounds)${query.orderBy ? ` ORDER BY ${query.orderBy}` : ""}`).bind(...query.bindings),
    ]));
    budget.account(results);
    if (!acknowledged(results, 2) || results[0]!.results.length !== 1) return fail("result_invalid");
    const measured = results[0]!.results[0]!;
    if (!measured || typeof measured !== "object" || Array.isArray(measured)
      || !["count", "valid", "bytes"].every(name => Object.hasOwn(measured, name)) || Object.keys(measured).length !== 3
      || measured.valid !== 1 || !Number.isSafeInteger(measured.count) || Number(measured.count) < 0
      || !Number.isSafeInteger(measured.bytes) || Number(measured.bytes) < 2
      || Number(measured.bytes) > maximum || results[1]!.results.length !== measured.count) return fail("byte_capacity");
    const rawBytes = encoder.encode(JSON.stringify(results[1]!.results)).byteLength;
    if (rawBytes > Number(measured.bytes)) return fail("result_changed");
    return results[1]!;
  };
  const wrap = (query: Query): D1PreparedStatement => {
    const statement = {
      bind(...bindings: unknown[]) {
        budget.check();
        if (bindings.length > 100 || bindings.some(value => value !== null && typeof value !== "string" && typeof value !== "number"
          || typeof value === "string" && encoder.encode(value).length > 2_000_000
          || typeof value === "number" && !Number.isFinite(value))) return fail("bindings_invalid");
        return wrap({ ...query, bindings });
      },
      async first<T>(column?: string) {
        if (column !== undefined) return fail("query_unbounded");
        return (await run(query)).results[0] as T ?? null;
      },
      async all<T>() { return await run(query) as D1Result<T>; },
      run() { return fail("query_unbounded"); }, raw() { return fail("query_unbounded"); },
    } as D1PreparedStatement;
    statements.set(statement, query); return statement;
  };
  const DB = { prepare(sql: string) { budget.check(); return wrap(classify(sql)); },
    batch() { return fail("query_unbounded"); }, exec() { return fail("query_unbounded"); },
    dump() { return fail("query_unbounded"); } } as unknown as WorkerEnv["DB"];
  return {
    env: { ...env, DB },
    async finish(statement: D1PreparedStatement, assertions: readonly Assertion[]) {
      budget.check();
      const query = statements.get(statement);
      if (!query?.final || assertions.length < 1 || assertions.length > 64) return fail("final_invalid");
      budget.count(assertions.length + 1); budget.expect((assertions.length + 1) * ENVELOPE_BYTES);
      const results = await budget.wait(() => database.batch<Row>([
        database.prepare(query.sql).bind(...query.bindings),
        ...assertions.map(assertion => database.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).bind(...assertion.bindings)),
      ]));
      budget.account(results);
      if (!acknowledged(results, assertions.length + 1)) return fail("final_changed");
      for (let index = 0; index < results.length; index++) {
        const rows = results[index]!.results;
        if (rows.length !== 1 || !scalar(rows[0], index === 0 ? "admitted" : "current")) return fail("final_changed");
      }
      return { admitted: 1 };
    },
  };
}

/** No response pull renews the attempt or reads again from native storage. */
export function sponsorStoryResponseBody(serialized: string, budget: SponsorStoryReadBudget) {
  const value = encoder.encode(serialized); budget.spend(value.byteLength);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        budget.check();
        if (offset === value.byteLength) { value.fill(0); controller.close(); return; }
        const end = Math.min(value.byteLength, offset + 65_536);
        controller.enqueue(value.slice(offset, end)); offset = end;
      } catch (error) { value.fill(0); controller.error(error); }
    },
    cancel() { value.fill(0); },
  }, { highWaterMark: 0 });
}
