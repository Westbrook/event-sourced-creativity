import { isDraftId } from "../src/experiences/intake.ts";
import { SPONSOR_AUDIO_INTAKE_RECEIPT_COLUMNS, SPONSOR_AUDIO_INTAKE_STORAGE_SCHEMA } from "./experience-sponsor-audio-intake-resources.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Every nonordinary result refuses ordinary access. Family labels are negative
 * classification only, never payer, private-read, storage or native authority. */
export type SponsorAudioIntakeClassification =
  | Readonly<{ kind: "ordinary"; guard: BudgetReservationGuard }>
  | Readonly<{ kind: "sponsored" | "story-sponsored" | "audio-sponsored" | "unavailable" }>;

type Binding = string | number | null;
type Row = Record<string, Binding>;
type Current = () => void;
const unavailable = Object.freeze({ kind: "unavailable" as const });
const imageTable = "experience_sponsor_intakes", storyTable = "experience_sponsor_story_intakes";
const audioTable = "experience_sponsor_audio_intakes", allocationTable = "experience_sponsor_audio_intake_allocations";
const fail = (): never => { throw new Error("sponsor_audio_intake_classification_unavailable"); };
const encoder = new TextEncoder(), metadataLimit = 65_536;
// Preserve the existing Image refusal for every present marker, including JSON
// null, false and unknown families. Invalid ordinary JSON alone is not a marker.
const marker = "CASE WHEN json_valid(content) THEN json_type(content,'$.sponsor_intake') IS NOT NULL ELSE 0 END";

function catalog(table: string, prefix?: string, related: readonly string[] = []) {
  const selection = `${prefix ? `lower(name) GLOB '${prefix}*'` : `lower(name)='${table}'`}
    OR lower(tbl_name) IN(${[table, ...related].map(name => `'${name}'`).join(",")})`;
  // LIMIT detects catalog overflow; it is not a bound on catalog scan work.
  // The complete escaped aggregate is bounded inside SQLite before transport.
  return `WITH objects AS MATERIALIZED (
      SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE ${selection}
      ORDER BY type COLLATE BINARY,name COLLATE BINARY LIMIT 65), packed AS (
      SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN typeof(type)='text' AND length(CAST(type AS BLOB))<=16
        AND typeof(name)='text' AND length(CAST(name AS BLOB))<=200 AND typeof(tbl_name)='text' AND length(CAST(tbl_name AS BLOB))<=200
        AND (sql IS NULL OR typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768) THEN 0 ELSE 1 END),0) AS invalid,
        json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',sql)) AS snapshot FROM objects)
    SELECT CASE WHEN total<=64 AND invalid=0 AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS schema_snapshot FROM packed`;
}
function indexedShape(table: string, primaryDraft: boolean, withoutRowid: boolean, key = "draft_id") {
  return `EXISTS(SELECT 1 FROM pragma_table_list('${table}') WHERE schema='main' AND name='${table}' AND type='table'
      AND wr=${withoutRowid ? 1 : 0} AND ncol BETWEEN 1 AND 64)
    AND (SELECT COUNT(*) FROM pragma_table_xinfo('${table}','main')) BETWEEN 1 AND 64
    AND EXISTS(SELECT 1 FROM pragma_table_xinfo('${table}','main') WHERE name='${key}' AND upper(type)='TEXT'
      AND "notnull"=1 AND ${primaryDraft ? 'pk=1' : 'pk=0'} AND hidden=0)
    ${primaryDraft ? `AND (SELECT COUNT(*) FROM pragma_table_xinfo('${table}','main') WHERE pk<>0)=1` : ''}
    AND (SELECT COUNT(*) FROM pragma_index_list('${table}','main')) BETWEEN 1 AND 32
    AND EXISTS(SELECT 1 FROM pragma_index_list('${table}','main') idx WHERE idx.origin='${primaryDraft ? 'pk' : 'u'}'
      AND idx."unique"=1 AND idx.partial=0
      AND (SELECT COUNT(*) FROM pragma_index_xinfo(idx.name,'main') WHERE "key"=1)=1
      AND EXISTS(SELECT 1 FROM pragma_index_xinfo(idx.name,'main') WHERE "key"=1 AND name='${key}'
        AND cid>=0 AND "desc"=0 AND coll='BINARY'))`;
}
// Retain Image's existing sidecar/marker boundary: its unrelated temporary
// assertion table alone is not evidence of draft custody. Story already treats
// partial declarations across its intake namespace as unavailable.
const imageCatalog = catalog(imageTable), storyCatalog = catalog(storyTable, "experience_sponsor_story_intake");
const audioCatalog = catalog(audioTable, "experience_sponsor_audio_intake", [allocationTable]);
const privateCatalog = catalog("private_content"), privateShape = `(${indexedShape("private_content", true, false, "content_id")})
  AND EXISTS(SELECT 1 FROM pragma_table_xinfo('private_content','main') WHERE name='content' AND upper(type)='TEXT' AND "notnull"=1 AND hidden=0)`;
const imageShape = indexedShape(imageTable, false, false), storyShape = indexedShape(storyTable, true, true);
const audioShape = `(${indexedShape(audioTable, true, true)}) AND (${indexedShape(allocationTable, false, true)})`;
// Audio pairs have a concrete immutable storage owner. Match its exact tables,
// explicit indexes and triggers, in addition to the actual indexed key shape.
// Importing dormant DDL does not execute or install it.
const audioObjects = SPONSOR_AUDIO_INTAKE_STORAGE_SCHEMA.map(sql => {
  const found = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z0-9_]+)/u.exec(sql);
  if (!found) return fail();
  return [found[1]!.toLowerCase(), found[2]!, sql] as const;
}).sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const audioSchemaSnapshot = JSON.stringify(audioObjects);
const audioSchemaQuery = `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema WHERE tbl_name IN('${allocationTable}','${audioTable}') AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT ${audioObjects.length + 1}), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT CASE WHEN total=${audioObjects.length} AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
const audioSchemaGuard = `EXISTS(SELECT 1 FROM (${audioSchemaQuery}) WHERE snapshot=?)`;

function own(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== "object") return fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return fail();
  return descriptor.value;
}
function exactRow(value: unknown, fields: readonly string[]): Row {
  if (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).length !== fields.length) return fail();
  const copied = Object.create(null) as Row;
  for (const field of fields) {
    const cell = own(value, field);
    if (cell !== null && typeof cell !== "string" && (typeof cell !== "number" || !Number.isFinite(cell))) return fail();
    copied[field] = cell;
  }
  return copied;
}
/** Bound the complete data-only D1 acknowledgement, including metadata. Never
 * invoke a getter/toJSON or treat inherited, sparse or error ACKs as evidence. */
function captureAcknowledgement(value: unknown): Record<string, unknown> {
  let nodes = 0, bytes = 0;
  const seen = new Set<object>();
  const capture = (item: unknown, depth: number): unknown => {
    if (++nodes > 4096 || depth > 8) return fail();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : fail();
    if (typeof item === "string") {
      if (item.length > 131_072) return fail();
      bytes += encoder.encode(item).byteLength; return bytes <= 131_072 ? item : fail();
    }
    if (!item || typeof item !== "object" || seen.has(item)) return fail();
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return fail();
    seen.add(item);
    if (Array.isArray(item)) {
      const length = Object.getOwnPropertyDescriptor(item, "length")?.value;
      if (!Number.isSafeInteger(length) || length > 1024 || Reflect.ownKeys(item).length !== length + 1) return fail();
      const copied = Array.from({ length }, (_, index) => capture(own(item, index), depth + 1));
      seen.delete(item); return copied;
    }
    const copied: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== "string" || key.length > 131_072 || ["__proto__", "prototype", "constructor"].includes(key)) return fail();
      bytes += encoder.encode(key).byteLength;
      if (bytes > 131_072) return fail();
      const cell = own(item, key);
      // D1 may explicitly own error:undefined; every other undefined is invalid.
      if (depth === 0 && key === "error" && cell === undefined) continue;
      copied[key] = capture(cell, depth + 1);
    }
    seen.delete(item); return copied;
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const error = Object.getOwnPropertyDescriptor(value, "error");
  if (error ? !Object.hasOwn(error, "value") || error.value !== undefined : "error" in value) return fail();
  const copied = capture(value, 0) as Record<string, unknown>;
  if (encoder.encode(JSON.stringify(copied)).byteLength > 131_072) return fail();
  return copied;
}

/** Source-free negative classifier only. No private body or receipt is returned,
 * no schema is installed, and no family capability is created. Future ordinary
 * consumers must retain the entire guard at their protected final boundary. */
export async function classifySponsorAudioIntakeDraft(request: Request, env: WorkerEnv, draftId: string): Promise<SponsorAudioIntakeClassification> {
  try {
    if (typeof draftId !== "string" || !isDraftId(draftId)) return unavailable;
    const database = env.DB, signal = Object.getOwnPropertyDescriptor(Request.prototype, "signal")!.get!.call(request) as AbortSignal;
    const method = request.method, url = request.url, headers = JSON.stringify([...request.headers]);
    const cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS, started = performance.now(), deadline = started + 30_000;
    if (!Number.isFinite(started) || encoder.encode(headers).byteLength > 32_768) return unavailable;
    const current: Current = () => {
      const now = performance.now();
      if (env.DB !== database || request.method !== method || request.url !== url || request.signal !== signal
        || Object.getOwnPropertyDescriptor(Request.prototype, "signal")!.get!.call(request) !== signal
        || Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!.call(signal) !== false
        || JSON.stringify([...request.headers]) !== headers || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins
        || !Number.isFinite(now) || now < started || now >= deadline) fail();
    };
    const wait = async <T>(work: () => Promise<T>): Promise<T> => {
      current(); let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
      try {
        const result = await Promise.race([work(), new Promise<never>((_, reject) => {
          cancel = () => reject(new Error("sponsor_audio_intake_classification_unavailable"));
          signal.addEventListener("abort", cancel, { once: true });
          if (Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!.call(signal)) cancel();
          timer = setTimeout(cancel, Math.max(0, deadline - performance.now()));
        })]); current(); return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (cancel) signal.removeEventListener("abort", cancel);
        current();
      }
    };
    const query = async (sql: string, bindings: readonly Binding[], fields: readonly string[], maximum = 1): Promise<Row[]> => {
      current(); const statement = database.prepare(sql).bind(...bindings); current();
      const ack = captureAcknowledgement(await wait(() => statement.all<Record<string, unknown>>())); current();
      if (ack.success !== true || !Array.isArray(ack.results) || ack.results.length > maximum) return fail();
      const rows = ack.results.map(value => exactRow(value, fields));
      if (encoder.encode(JSON.stringify(rows)).byteLength > metadataLimit) return fail();
      current(); return rows;
    };
    const schema = async (sql: string, tables: readonly string[]) => {
      const rows = await query(sql, [], ["schema_snapshot"]); current();
      const snapshot = rows[0]?.schema_snapshot;
      if (typeof snapshot !== "string") return fail();
      const objects: unknown = JSON.parse(snapshot);
      if (!Array.isArray(objects) || objects.length > 64) return fail();
      const found = new Set<string>();
      for (const raw of objects) {
        const object = exactRow(raw, ["type", "name", "table", "sql"]);
        if (typeof object.name !== "string" || typeof object.table !== "string" || typeof object.type !== "string"
          || object.sql !== null && typeof object.sql !== "string") return fail();
        const name = object.name;
        const matching = tables.find(table => name.toLowerCase() === table);
        if (matching) {
          if (found.has(matching) || object.name !== matching || object.table !== matching || object.type !== "table" || typeof object.sql !== "string") return fail();
          found.add(matching);
        }
      }
      if (!found.size && objects.length || found.size && found.size !== tables.length) return fail();
      current(); return { present: found.size > 0, guard: { sql: `EXISTS(SELECT 1 FROM (${sql}) WHERE schema_snapshot=?)`, bindings: [snapshot] } as BudgetReservationGuard };
    };
    const exists = async (table: string) => {
      const rows = await query(`SELECT 1 AS sponsored FROM main.${table} WHERE draft_id COLLATE BINARY=? LIMIT 1`, [draftId], ["sponsored"]); current();
      if (rows.length && rows[0]?.sponsored !== 1) return fail();
      return rows.length === 1;
    };
    const guardParts: BudgetReservationGuard[] = [];
    let image = false, story = false, audio = false;
    for (const [table, catalogSql, shape] of [[imageTable, imageCatalog, imageShape], [storyTable, storyCatalog, storyShape]] as const) {
      const found = await schema(catalogSql, [table]); current();
      guardParts.push(found.guard);
      if (found.present) {
        const supported = await query(`SELECT CASE WHEN (${shape}) THEN 1 ELSE 0 END AS supported`, [], ["supported"]); current();
        if (supported[0]?.supported !== 1) return unavailable;
        const present = await exists(table); current();
        if (table === imageTable) image = present; else story = present;
        guardParts.push({ sql: `(${shape}) AND NOT EXISTS(SELECT 1 FROM main.${table} WHERE draft_id COLLATE BINARY=?)`, bindings: [draftId] });
      }
    }
    const found = await schema(audioCatalog, [audioTable, allocationTable]); current();
    guardParts.push(found.guard);
    if (found.present) {
      const supported = await query(`SELECT CASE WHEN ((${audioShape}) AND (${audioSchemaGuard})) THEN 1 ELSE 0 END AS supported`, [audioSchemaSnapshot], ["supported"]); current();
      if (supported[0]?.supported !== 1) return unavailable;
      const receipt = await exists(audioTable); current();
      const allocation = await exists(allocationTable); current();
      if (receipt !== allocation) return unavailable;
      if (receipt) {
        const paired = await query(`SELECT 1 AS paired FROM main.${audioTable} receipt JOIN main.${allocationTable} allocation
          ON allocation.allocation_id=receipt.allocation_id AND ${SPONSOR_AUDIO_INTAKE_RECEIPT_COLUMNS.map(column => `allocation.${column}=receipt.${column}`).join(" AND ")}
          WHERE receipt.draft_id COLLATE BINARY=? LIMIT 1`, [draftId], ["paired"]); current();
        if (paired[0]?.paired !== 1) return unavailable;
        audio = true;
      }
      guardParts.push({ sql: `(${audioShape}) AND (${audioSchemaGuard})
        AND NOT EXISTS(SELECT 1 FROM main.${audioTable} WHERE draft_id COLLATE BINARY=?)
        AND NOT EXISTS(SELECT 1 FROM main.${allocationTable} WHERE draft_id COLLATE BINARY=?)`, bindings: [audioSchemaSnapshot, draftId, draftId] });
    }
    const privateSchema = await schema(privateCatalog, ["private_content"]); current();
    if (!privateSchema.present) return unavailable;
    const privateSupported = await query(`SELECT CASE WHEN (${privateShape}) THEN 1 ELSE 0 END AS supported`, [], ["supported"]); current();
    if (privateSupported[0]?.supported !== 1) return unavailable;
    guardParts.push(privateSchema.guard, { sql: privateShape, bindings: [] });
    // Only the indexed marker predicate is transported; SQLite parses the stored
    // body. This metadata boundary does not claim finite native private-read IO.
    const marked = await query(`SELECT 1 AS sponsored FROM main.private_content WHERE content_id COLLATE BINARY=? AND (${marker}) LIMIT 1`, [draftId], ["sponsored"]); current();
    if (marked.length && marked[0]?.sponsored !== 1) return unavailable;
    if (Number(image) + Number(story) + Number(audio) > 1) return unavailable;
    if (audio || story || image || marked.length) {
      current(); return Object.freeze({ kind: audio ? "audio-sponsored" : story ? "story-sponsored" : "sponsored" });
    }
    guardParts.push({ sql: `NOT EXISTS(SELECT 1 FROM main.private_content WHERE content_id COLLATE BINARY=? AND (${marker}))`, bindings: [draftId] });
    const guard: BudgetReservationGuard = { sql: guardParts.map(part => `(${part.sql})`).join(" AND "), bindings: guardParts.flatMap(part => part.bindings) };
    const proof = await query(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS current`, guard.bindings, ["current"]); current();
    if (proof[0]?.current !== 1) return unavailable;
    Object.freeze(guard.bindings); Object.freeze(guard); current(); return Object.freeze({ kind: "ordinary", guard });
  } catch { return unavailable; }
}
