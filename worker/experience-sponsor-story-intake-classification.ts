import { isDraftId } from "../src/experiences/intake.ts";
import { classifySponsorIntakeDraft } from "./experience-sponsor-intake-classification.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Every nonordinary result refuses ordinary intake. In particular, sponsored
 * preserves the existing unknown-family marker refusal, not Image authority. */
export type SponsorStoryIntakeClassification =
  | Readonly<{ kind: "ordinary"; guard: BudgetReservationGuard }>
  | Readonly<{ kind: "sponsored" | "story-sponsored" | "unavailable" }>;

type Binding = string | number | null;
type Row = Record<string, unknown>;
const unavailable = Object.freeze({ kind: "unavailable" as const });
const table = "experience_sponsor_story_intakes";
const fail = (): never => { throw new Error("sponsor_story_intake_classification_unavailable"); };
const encoder = new TextEncoder();
const metadataLimit = 65_536;

// A future storage owner defines the rest of the immutable receipt. This leaf
// recognizes only its source-free lookup structure, never receipt authority.
const shape = `EXISTS(SELECT 1 FROM pragma_table_list('${table}')
    WHERE schema='main' AND name='${table}' AND type='table' AND wr=1 AND ncol BETWEEN 1 AND 64)
  AND (SELECT COUNT(*) FROM pragma_table_xinfo('${table}','main')) BETWEEN 1 AND 64
  AND EXISTS(SELECT 1 FROM pragma_table_xinfo('${table}','main')
    WHERE name='draft_id' AND upper(type)='TEXT' AND "notnull"=1 AND pk=1 AND hidden=0)
  AND (SELECT COUNT(*) FROM pragma_table_xinfo('${table}','main') WHERE pk<>0)=1
  AND (SELECT COUNT(*) FROM pragma_index_list('${table}','main')) BETWEEN 1 AND 32
  AND (SELECT COUNT(*) FROM pragma_index_list('${table}','main') WHERE origin='pk')=1
  AND EXISTS(SELECT 1 FROM pragma_index_list('${table}','main') pk
    WHERE pk.origin='pk' AND pk."unique"=1 AND pk.partial=0
      AND (SELECT COUNT(*) FROM pragma_index_xinfo(pk.name,'main') WHERE "key"=1)=1
      AND EXISTS(SELECT 1 FROM pragma_index_xinfo(pk.name,'main')
        WHERE "key"=1 AND name='draft_id' AND cid>=0 AND "desc"=0 AND coll='BINARY'))`;

// Bound the complete escaped metadata aggregate in SQLite before transport.
// LIMIT 65 detects overflow; it is not presented as a bound on catalog work.
const catalogQuery = `WITH objects AS MATERIALIZED (
    SELECT type,name,tbl_name,sql FROM main.sqlite_schema
    WHERE lower(name) GLOB 'experience_sponsor_story_intake*' OR lower(tbl_name)='${table}'
    ORDER BY type,name LIMIT 65), packed AS (
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN typeof(type)='text' AND length(CAST(type AS BLOB))<=16
        AND typeof(name)='text' AND length(CAST(name AS BLOB))<=200
        AND typeof(tbl_name)='text' AND length(CAST(tbl_name AS BLOB))<=200
        AND (sql IS NULL OR typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768)
        THEN 0 ELSE 1 END),0) AS invalid,
      json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',sql)) AS snapshot
    FROM objects)
  SELECT CASE WHEN total<=64 AND invalid=0 AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS schema_snapshot FROM packed`;
const storyLookup = `SELECT 1 AS sponsored FROM main.${table} WHERE draft_id COLLATE BINARY=? LIMIT 1`;

// These are the unchanged imported classifier's three read shapes. The narrow
// wrapper adds lifetime/acknowledgment checks without replacing its predicates.
const imageCatalog = "SELECT type,sql FROM sqlite_master WHERE lower(name)=? AND type IN('table','view')";
const imageLookup = "SELECT 1 AS sponsored FROM experience_sponsor_intakes WHERE draft_id=? LIMIT 1";
const imageMarker = "SELECT 1 AS sponsored FROM private_content WHERE content_id=? AND (CASE WHEN json_valid(content) THEN json_type(content,'$.sponsor_intake') IS NOT NULL ELSE 0 END) LIMIT 1";

function data(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== "object") return fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) return fail();
  return descriptor.value;
}
function exactRow(value: unknown, keys: readonly string[]): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Reflect.ownKeys(value).length !== keys.length) return fail();
  const copy = Object.create(null) as Row;
  for (const key of keys) {
    const cell = data(value, key);
    if (cell !== null && typeof cell !== "string" && (typeof cell !== "number" || !Number.isFinite(cell))) return fail();
    copy[key] = cell;
  }
  return copy;
}
function rows(value: unknown, fields: readonly string[], maximum: number): Row[] {
  if (data(value, "success") !== true) return fail();
  const result = data(value, "results");
  if (!Array.isArray(result) || result.length > maximum) return fail();
  const retained: Row[] = [];
  for (let index = 0; index < result.length; index += 1) retained.push(exactRow(data(result, index), fields));
  return retained;
}

/** Dormant negative composition only. No body, receipt, payer, read capability,
 * schema installation or mutation is exposed. Later native consumers must use
 * the complete returned ordinary guard at every protected final boundary. */
export async function classifySponsorStoryIntakeDraft(request: Request, env: WorkerEnv,
  draftId: string): Promise<SponsorStoryIntakeClassification> {
  try {
    if (typeof draftId !== "string" || !isDraftId(draftId)) return unavailable;
    const database = env.DB, method = request.method, url = request.url, signal = request.signal;
    const headers = JSON.stringify([...request.headers]);
    const cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
    const deadline = performance.now() + 30_000;
    if (encoder.encode(headers).byteLength > 32_768) return unavailable;
    const current = () => {
      if (env.DB !== database || request.method !== method || request.url !== url || request.signal !== signal
        || signal.aborted || JSON.stringify([...request.headers]) !== headers
        || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins
        || performance.now() >= deadline) fail();
    };
    const wait = async <T>(work: () => Promise<T>): Promise<T> => {
      current();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel: (() => void) | undefined;
      try {
        return await Promise.race([work(), new Promise<never>((_, reject) => {
          cancel = () => reject(new Error("sponsor_story_intake_classification_unavailable"));
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) cancel();
          timer = setTimeout(cancel, Math.max(0, deadline - performance.now()));
        })]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (cancel) signal.removeEventListener("abort", cancel);
        current();
      }
    };
    const query = async (sql: string, bindings: readonly Binding[], fields: readonly string[], maximum = 1) => {
      const raw = await wait(() => database.prepare(sql).bind(...bindings).all<Row>());
      const result = rows(raw, fields, maximum);
      // The imported Image schema read is forwarded unchanged. Its existing
      // metadata is checked here before the classifier can retain or expose it.
      if (encoder.encode(JSON.stringify(result)).byteLength > metadataLimit) fail();
      return result;
    };
    const imageFirst = async (sql: string, bindings: readonly Binding[]) => {
      if (bindings.length !== 1 || bindings[0] !== (sql === imageCatalog ? "experience_sponsor_intakes" : draftId)
        || ![imageCatalog, imageLookup, imageMarker].includes(sql)) return fail();
      const selected = await query(sql, bindings, sql === imageCatalog ? ["type", "sql"] : ["sponsored"]);
      if (!selected.length) return null;
      const row = selected[0]!;
      if (sql === imageCatalog) {
        if (typeof row.type !== "string" || row.type.length > 16
          || row.sql !== null && (typeof row.sql !== "string" || encoder.encode(row.sql).byteLength > 32_768)) fail();
      } else if (row.sponsored !== 1) fail();
      return row;
    };
    const imageStatement = (sql: string, bindings: readonly Binding[] = []): D1PreparedStatement => ({
      bind(...values: Binding[]) { current(); return imageStatement(sql, [...values]); },
      first(column?: string) { current(); if (column !== undefined) return fail(); return imageFirst(sql, bindings); },
    } as unknown as D1PreparedStatement);
    const imageDb = { prepare(sql: string) { current(); return imageStatement(sql); } } as D1Database;
    const image = await wait(() => classifySponsorIntakeDraft({ ...env, DB: imageDb }, draftId));
    if (image.kind === "unavailable") return unavailable;

    const catalogRows = await query(catalogQuery, [], ["schema_snapshot"]);
    const snapshot = catalogRows[0]?.schema_snapshot;
    if (typeof snapshot !== "string") return unavailable;
    const objects: unknown = JSON.parse(snapshot);
    if (!Array.isArray(objects) || objects.length > 64) return unavailable;
    let present = false;
    for (let index = 0; index < objects.length; index += 1) {
      const object = exactRow(data(objects, index), ["type", "name", "table", "sql"]);
      if (typeof object.name !== "string" || typeof object.table !== "string" || typeof object.type !== "string"
        || object.sql !== null && typeof object.sql !== "string") return unavailable;
      if (object.name.toLowerCase() === table) {
        if (present || object.name !== table || object.table !== table || object.type !== "table" || typeof object.sql !== "string") return unavailable;
        present = true;
      }
    }
    if (!present && objects.length) return unavailable;
    const snapshotGuard = `EXISTS(SELECT 1 FROM (${catalogQuery}) WHERE schema_snapshot=?)`;
    let storyGuard: BudgetReservationGuard = { sql: snapshotGuard, bindings: [snapshot] };
    if (present) {
      const supported = await query(`SELECT CASE WHEN (${shape}) THEN 1 ELSE 0 END AS supported`, [], ["supported"]);
      if (supported[0]?.supported !== 1) return unavailable;
      const story = await query(storyLookup, [draftId], ["sponsored"]);
      if (story.length && story[0]?.sponsored !== 1) return unavailable;
      if (story.length) {
        if (image.kind === "sponsored") {
          const imageSchema = await imageFirst(imageCatalog, ["experience_sponsor_intakes"]);
          if (imageSchema && (imageSchema.type !== "table" || typeof imageSchema.sql !== "string")) return unavailable;
          if (imageSchema && await imageFirst(imageLookup, [draftId])) return unavailable;
        }
        current(); return Object.freeze({ kind: "story-sponsored" });
      }
      storyGuard = { sql: `(${snapshotGuard}) AND (${shape}) AND NOT EXISTS(SELECT 1 FROM main.${table} WHERE draft_id COLLATE BINARY=?)`,
        bindings: [snapshot, draftId] };
    }
    if (image.kind === "sponsored") { current(); return Object.freeze({ kind: "sponsored" }); }
    // Preserve the imported negative predicate and ordered vector verbatim.
    const guard: BudgetReservationGuard = {
      sql: `(${image.guard.sql}) AND (${storyGuard.sql})`,
      bindings: [...image.guard.bindings, ...storyGuard.bindings],
    };
    const proof = await query(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS current`, guard.bindings, ["current"]);
    if (proof[0]?.current !== 1) return unavailable;
    current(); Object.freeze(guard.bindings); Object.freeze(guard);
    return Object.freeze({ kind: "ordinary", guard });
  } catch { return unavailable; }
}
