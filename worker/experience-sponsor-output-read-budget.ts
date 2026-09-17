import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { SponsorNativeImageReadBudget } from "./experience-sponsor-native-image-budget.ts";
import type { WorkerEnv } from "./runtime.ts";

type Row = Record<string, unknown>;
type Cell = { name: string; kind: "text" | "integer"; nullable?: boolean };
type Query = { sql: string; cells: Cell[]; maximumRows: number; bindings: unknown[]; orderBy?: string; valid?: string; scalarProof?: boolean };
type Metrics = { count: number; valid: number; bytes: number };
const fail = (code: string): never => { throw new SponsorEntitlementError(`sponsor_output_read_${code}`); };
const encoder = new TextEncoder();
const ENVELOPE_BYTES = 16_384;
const METADATA_BYTES = 65_536;
const text = (name: string, nullable = false): Cell => ({ name, kind: "text", nullable });
const integer = (name: string): Cell => ({ name, kind: "integer" });
const eventCells = ["event_id", "stream_id", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "type", "payload"].map(name => text(name))
  .concat([text("causation_id", true), text("compensates_event_id", true), text("private_json", true), integer("sequence"), integer("schema_version")]);
const assetCells = ["scope_key", "asset_id", "document_id", "owner_user_id", "created_by_user_id", "source_digest", "storage_key", "content_sha256", "mime_type", "media_kind", "created_event_id", "created_at"]
  .map(name => text(name)).concat([text("redacted_at", true), integer("byte_length")]);
const HEAD = "SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?";
const PAGE = "SELECT * FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?";
const SOURCES = "SELECT private_event_id,private_json,project_id,document_id FROM event_private_payloads WHERE owner_id=? AND private_event_id IN(SELECT value FROM json_each(?)) AND redacted_at IS NULL";
const GOVERNED = "SELECT 1 AS present FROM organization_projects WHERE owner_user_id=? AND project_id=? LIMIT 1";
const ASSET = "SELECT * FROM output_assets WHERE scope_key=? AND asset_id=? AND document_id=? AND owner_user_id=? AND redacted_at IS NULL";
const PRIVATE = "SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=? AND redacted_at IS NULL";

function scalarProof(sql: string): boolean {
  const prefix = "SELECT CASE WHEN (", suffix = ") THEN 1 ELSE 0 END AS current";
  if (!sql.startsWith(prefix) || !sql.endsWith(suffix) || /;|--|\/\*/u.test(sql) || encoder.encode(sql).length > 100_000) return false;
  const expression = sql.slice(prefix.length, -suffix.length);
  let depth = 1, quoted = false;
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index];
    if (character === "'") { if (quoted && expression[index + 1] === "'") { index++; continue; } quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === '"' || character === "`" || character === "[") return false;
    if (character === "(") depth++;
    else if (character === ")" && --depth < 1) return false;
  }
  // The outer condition must close only at the fixed suffix. This prevents a
  // second selected column/CASE from masquerading as a bounded scalar proof.
  return !quoted && depth === 1;
}

function classify(sql: string): Query {
  if (sql === HEAD) return { sql, cells: [integer("head")], maximumRows: 1, bindings: [] };
  if (sql === PAGE) return {
    sql: sql.replace("SELECT *", `SELECT ${eventCells.map(cell => cell.name === "private_json" ? "secret.private_json AS private_json" : `events.${cell.name} AS ${cell.name}`).join(",")},CASE WHEN secret.private_event_id IS NULL OR typeof(secret.private_json)='text' THEN 1 ELSE 0 END AS private_body_valid`),
    cells: eventCells, maximumRows: 5_000, bindings: [], orderBy: "sequence ASC", valid: "private_body_valid=1",
  };
  if (sql === SOURCES) return { sql, cells: [text("private_event_id"), text("private_json"), text("project_id", true), text("document_id", true)], maximumRows: 10_000, bindings: [] };
  if (sql === GOVERNED) return { sql, cells: [integer("present")], maximumRows: 1, bindings: [] };
  if (sql === ASSET) return { sql: `${sql.replace("SELECT *", `SELECT ${assetCells.map(cell => cell.name).join(",")}`)} LIMIT 2`, cells: assetCells, maximumRows: 1, bindings: [] };
  if (sql === PRIVATE) return { sql: `${sql} LIMIT 2`, cells: [text("private_json")], maximumRows: 1, bindings: [] };
  // Native proof statements expose one scalar and retain their original SQL.
  // Only internal call sites construct these; this is not a user query API.
  if (scalarProof(sql))
    return { sql, cells: [integer("current")], maximumRows: 1, bindings: [], scalarProof: true };
  return fail("query_unbounded");
}

function metrics(query: Query): string {
  const valid = query.cells.map(cell => {
    const typed = cell.kind === "text" ? `typeof(${cell.name})='text'` : `(typeof(${cell.name})='integer' AND ${cell.name} BETWEEN 0 AND 9007199254740991)`;
    return cell.nullable ? `(${cell.name} IS NULL OR ${typed})` : `(${typed})`;
  }).concat(query.valid ? [query.valid] : []).join(" AND ");
  // SQLite text length stops at NUL; byte length of its BLOB representation
  // does not. Six is the worst JSON escaping expansion per UTF-8 byte.
  const bytes = query.cells.map(cell => `${cell.name.length + 5}+CASE WHEN ${cell.name} IS NULL THEN 4 ${cell.kind === "text" ? `ELSE 2+6*length(CAST(${cell.name} AS BLOB))` : "ELSE 24"} END`).join("+");
  return `SELECT COUNT(*) AS count,CASE WHEN COUNT(*)<=${query.maximumRows} AND COALESCE(MIN(CASE WHEN ${valid} THEN 1 ELSE 0 END),1)=1 THEN 1 ELSE 0 END AS valid,COALESCE(SUM(2+${bytes}),0)+2 AS bytes FROM candidate`;
}

/** A closed, metered environment for the existing personal Outputs asset
 * reader. It preserves the complete native context, private-source capture,
 * byte inspection and final custody proof. It grants no new authority. */
export function sponsorOutputAssetReadEnvironment(env: WorkerEnv, budget: SponsorNativeImageReadBudget, asset: { storageKey: string; byteLength: number }): WorkerEnv {
  if (typeof asset.storageKey !== "string" || !asset.storageKey || encoder.encode(asset.storageKey).length > 1_024
    || !Number.isSafeInteger(asset.byteLength) || asset.byteLength <= 0) return fail("asset_invalid");
  const capturedAsset = Object.freeze({ ...asset });
  const statements = new WeakMap<D1PreparedStatement, Query>();
  const measure = (result: unknown, maximum: number) => {
    const bytes = encoder.encode(JSON.stringify(result)).byteLength;
    if (bytes > maximum) return fail("result_unbounded");
    budget.spend(bytes);
  };
  const metricValue = (raw: unknown): Metrics => {
    const row = raw as Partial<Metrics> | null;
    if (!row || row.valid !== 1 || !Number.isSafeInteger(row.count) || Number(row.count) < 0 || !Number.isSafeInteger(row.bytes) || Number(row.bytes) < 2)
      return fail("row_invalid");
    return row as Metrics;
  };
  const run = async (queries: Query[]): Promise<D1Result<Row>[]> => {
    budget.check();
    if (queries.length > 128) return fail("query_capacity");
    if (!queries.length) return [];
    // This first phase returns only numeric aggregate metadata. No raw body is
    // dispatched until its worst-case serialized size fits the shared budget.
    const measured = queries.filter(query => !query.scalarProof), sizesByQuery = new Map<Query, number>();
    if (measured.length) {
      const preflightMaximum = measured.length * ENVELOPE_BYTES;
      budget.expect(preflightMaximum);
      const preflight = await budget.wait(env.DB.batch<Row>(measured.map(query => env.DB.prepare(`WITH candidate AS MATERIALIZED (${query.sql}) ${metrics(query)}`).bind(...query.bindings))));
      measure(preflight, preflightMaximum);
      if (preflight.length !== measured.length || preflight.some(item => item.success === false || item.results.length !== 1)) return fail("row_invalid");
      measured.forEach((query, index) => sizesByQuery.set(query, metricValue(preflight[index].results[0]).bytes));
    }
    // The exact native CASE form can only return one integer 0/1. Its fixed
    // allowance needs no nested body-size wrapper, which would consume D1
    // expression depth without bounding any additional creative content.
    const sizes = queries.map(query => query.scalarProof ? 32 : sizesByQuery.get(query)!);
    const maximum = sizes.reduce((sum, bytes, index) => sum + bytes + ENVELOPE_BYTES * (queries[index].scalarProof ? 1 : 2), 0);
    budget.expect(maximum);
    const actual: D1PreparedStatement[] = [], positions: number[] = [];
    queries.forEach((query, index) => {
      positions.push(actual.length);
      if (query.scalarProof) { actual.push(env.DB.prepare(query.sql).bind(...query.bindings)); return; }
      const metric = metrics(query), cte = `WITH candidate AS MATERIALIZED (${query.sql}), bounds AS MATERIALIZED (${metric})`;
      actual.push(env.DB.prepare(`${cte} SELECT * FROM bounds`).bind(...query.bindings));
      // The condition is evaluated over the same materialized rows as this
      // body query. Growth after preflight cannot transfer a larger body.
      actual.push(env.DB.prepare(`${cte} SELECT ${query.cells.map(cell => cell.name).join(",")} FROM candidate
        WHERE (SELECT valid=1 AND bytes<=${sizes[index]} FROM bounds)${query.orderBy ? ` ORDER BY ${query.orderBy}` : ""}`).bind(...query.bindings));
    });
    const result = await budget.wait(env.DB.batch<Row>(actual));
    measure(result, maximum);
    if (result.length !== actual.length || result.some(item => item.success === false)) return fail("row_invalid");
    return queries.map((query, index) => {
      const position = positions[index];
      if (query.scalarProof) {
        const proof = result[position];
        if (proof.results.length !== 1 || Object.keys(proof.results[0]).length !== 1
          || ![0, 1].includes(Number(proof.results[0]?.current)) || typeof proof.results[0]?.current !== "number") return fail("row_invalid");
        return proof;
      }
      const checked = metricValue(result[position].results[0]), body = result[position + 1];
      if (result[position].results.length !== 1 || checked.bytes > sizes[index] || body.results.length !== checked.count) return fail("row_changed");
      return body;
    });
  };
  const wrap = (query: Query): D1PreparedStatement => {
    const statement = {
      bind(...bindings: unknown[]) {
        if (bindings.length > 100 || bindings.some(value => value !== null && typeof value !== "string" && typeof value !== "number"
          || typeof value === "string" && encoder.encode(value).length > 2_000_000 || typeof value === "number" && !Number.isFinite(value))) return fail("bindings_invalid");
        return wrap({ ...query, bindings });
      },
      async first<T>(column?: string) {
        if (column !== undefined) return fail("query_unbounded");
        return (await run([query]))[0].results[0] as T ?? null;
      },
      async all<T>() { return (await run([query]))[0] as D1Result<T>; },
      run() { return fail("query_unbounded"); },
      raw() { return fail("query_unbounded"); },
    } as D1PreparedStatement;
    statements.set(statement, query); return statement;
  };
  const DB = {
    prepare(sql: string) { budget.check(); return wrap(classify(sql)); },
    batch<T>(items: D1PreparedStatement[]) { return run(items.map(item => statements.get(item) ?? fail("query_unbounded"))) as Promise<D1Result<T>[]>; },
    exec() { return fail("query_unbounded"); },
    dump() { return fail("query_unbounded"); },
  } as WorkerEnv["DB"];
  let heads = 0, gets = 0;
  const descriptor = (object: NonNullable<Awaited<ReturnType<WorkerEnv["MEDIA"]["head"]>>>) => {
    if (!Number.isSafeInteger(object.size) || Number(object.size) < 0) return fail("media_descriptor");
    const headers = new Headers(); object.writeHttpMetadata(headers);
    if (typeof object.httpEtag !== "string" || object.customMetadata !== undefined && (object.customMetadata === null
      || typeof object.customMetadata !== "object" || Array.isArray(object.customMetadata) || Object.values(object.customMetadata).some(value => typeof value !== "string"))) return fail("media_descriptor");
    const data = { size: object.size, customMetadata: object.customMetadata ?? {}, httpEtag: object.httpEtag, headers: [...headers] };
    measure(data, METADATA_BYTES);
    return { size: object.size, customMetadata: Object.freeze({ ...data.customMetadata }), httpEtag: data.httpEtag,
      writeHttpMetadata(target: Headers) { for (const [key, value] of data.headers) target.set(key, value); } };
  };
  const MEDIA = {
    async head(key: string) {
      budget.check();
      if (++heads > 8 || typeof key !== "string" || !key || encoder.encode(key).length > 1_024) return fail("media_scope");
      budget.expect(METADATA_BYTES);
      if (typeof env.MEDIA.head !== "function") return fail("media_scope");
      const object = await budget.wait(env.MEDIA.head(key));
      if (!object) { budget.spend(4); return null; }
      return descriptor(object);
    },
    async get(key: string, options?: unknown) {
      budget.check();
      if (key !== capturedAsset.storageKey || options !== undefined || ++gets > 1) return fail("media_scope");
      budget.expect(METADATA_BYTES + capturedAsset.byteLength);
      const pending = env.MEDIA.get(key);
      let object: Awaited<ReturnType<WorkerEnv["MEDIA"]["get"]>>;
      try { object = await budget.wait(pending); }
      catch (error) {
        // The binding cannot be aborted. Release a late body even when the
        // request has already stopped waiting for the original GET.
        void pending.then(value => { if (value && 'body' in value) return value.body.cancel(); }).catch(() => undefined);
        throw error;
      }
      if (!object) { budget.spend(4); return null; }
      if (!('body' in object) || object.size !== capturedAsset.byteLength) {
        if ('body' in object) void object.body.cancel().catch(() => undefined);
        return fail("media_descriptor");
      }
      let metadata: ReturnType<typeof descriptor>;
      try { metadata = descriptor(object); budget.spend(capturedAsset.byteLength); }
      catch (error) { void object.body.cancel().catch(() => undefined); throw error; }
      const reader = object.body.getReader();
      // Reserve the exact descriptor before pulling. The body may not produce
      // any more bytes, and every pending pull shares the original deadline.
      let transferred = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await budget.wait(reader.read());
            if (chunk.done) {
              if (transferred !== capturedAsset.byteLength) return fail("media_length");
              controller.close(); return;
            }
            if (!(chunk.value instanceof Uint8Array) || transferred + chunk.value.byteLength > capturedAsset.byteLength) return fail("media_length");
            transferred += chunk.value.byteLength; controller.enqueue(chunk.value);
          } catch (error) { void reader.cancel().catch(() => undefined); controller.error(error); }
        },
        cancel() { void reader.cancel().catch(() => undefined); },
      }, { highWaterMark: 0 });
      return { ...metadata, body };
    },
    put() { return fail("media_scope"); }, delete() { return fail("media_scope"); }, list() { return fail("media_scope"); },
    createMultipartUpload() { return fail("media_scope"); }, resumeMultipartUpload() { return fail("media_scope"); },
  } as unknown as WorkerEnv["MEDIA"];
  return { ...env, DB, MEDIA };
}
