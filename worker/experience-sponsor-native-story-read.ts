import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { identifySponsorStoryRead, requireSponsorStoryReadAuthority, type SponsorStoryReadAuthority } from "./experience-sponsor-story-read.ts";
import { reserveSponsorStoryIoAttempt, takeSponsorStoryIoAttempt } from "./experience-sponsor-story-io-attempts.ts";
import { SponsorStoryReadBudget, sponsorNativeStoryFinalSql, sponsorStoryReadEnvironment, sponsorStoryResponseBody } from "./experience-sponsor-story-read-budget.ts";
import { hostedIdentity, type NativeRetainedIdentity } from "./native-retained-text-custody.ts";
import type { RetainedStorySelection } from "../src/model/retained-short-story.ts";
import type { NativeStoryHandle } from "../src/model/native-short-story-generation.ts";
import type { WorkerEnv } from "./runtime.ts";

type Assertion = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;
type Lookup = Readonly<{ selection: RetainedStorySelection }> | Readonly<{ handle: NativeStoryHandle }>;
type Row = Record<string, unknown>;
declare const nativeStoryBrand: unique symbol;
export type SponsorNativeStoryRead = Readonly<{ [nativeStoryBrand]: true }>;
type State = {
  request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; identity: NativeRetainedIdentity;
  method: string; url: string; cookie: string; cohort: WorkerEnv["FORMA_PILOT_COHORT_ID"];
  admins: WorkerEnv["FORMA_ADMIN_EMAILS"]; deadline: number; controlBytes: number; assertions: Assertion[];
  authority?: SponsorStoryReadAuthority; completionId?: string; documentId?: string; artifactId?: string;
  budget?: SponsorStoryReadBudget; adapter?: ReturnType<typeof sponsorStoryReadEnvironment>;
  finalizationStarted: boolean; finalized: boolean; responseTaken: boolean;
};
const states = new WeakMap<SponsorNativeStoryRead, State>();
const encoder = new TextEncoder();
const fail = (code = "unavailable"): never => { throw new SponsorEntitlementError(`sponsor_story_native_${code}`); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const textCell = (column: string, alias: string, maximum = 240) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum} THEN ${column} END AS ${alias}`;
const field = (column: string, path: string, maximum = 65_536) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum}
  THEN CASE WHEN json_valid(${column}) THEN json_extract(${column},'$.${path}') END END`;
const artifactExpression = field("payload", "artifact_id");
const nativeObjects = ["document_jobs", "output_commands", "output_plan_revisions", "output_plan_targets", "output_preflights",
  "output_execution_grants", "output_operation_slots", "output_operation_routes", "output_provider_calls", "output_assets",
  "output_native_storage_writes", "output_asset_storage_writes", "output_results", "output_target_acceptances",
  "output_plan_fulfillments", "output_delivery_manifests", "output_durable_jobs", "output_durable_owner_immutable"];
const nativeObjectSql = nativeObjects.filter(name => name !== "document_jobs").map(name => `'${name}'`).join(",");
function finalAcknowledged(value: unknown, count: number) {
  if (!Array.isArray(value) || value.length !== count) return false;
  for (let index = 0; index < count; index++) {
    if (!Object.hasOwn(value, index)) return false;
    const item = value[index] as D1Result<Row> | undefined;
    if (!item || typeof item !== "object" || Array.isArray(item) || !Object.hasOwn(item, "success") || item.success !== true
      || !Object.hasOwn(item, "results") || !Array.isArray(item.results) || item.results.length !== 1 || !Object.hasOwn(item.results, 0)) return false;
    const row = item.results[0], key = index === 0 ? "admitted" : "current";
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 1
      || !Object.hasOwn(row, key) || row[key] !== 1) return false;
  }
  return true;
}

/** Dormant prerequisites only. No initializer, route or read installs them. */
export const SPONSOR_NATIVE_STORY_READ_INDEXES = Object.freeze([
  Object.freeze({ name: "idx_sponsor_story_artifact_lookup", sql: `CREATE INDEX idx_sponsor_story_artifact_lookup ON events(stream_id,${artifactExpression}) WHERE type='DocumentRenderCompleted'` }),
  Object.freeze({ name: "idx_sponsor_story_actor_history", sql: "CREATE INDEX idx_sponsor_story_actor_history ON experience_sponsor_consumptions(actor_user_id,job_id)" }),
  Object.freeze({ name: "idx_sponsor_story_outcome_lookup", sql: "CREATE INDEX idx_sponsor_story_outcome_lookup ON output_operation_slots(outcome_event_id,job_id) WHERE outcome_event_id IS NOT NULL" }),
]);

const marker = `COALESCE((SELECT CASE WHEN typeof(authorization.private_json)='text' AND length(CAST(authorization.private_json AS BLOB))<=131072
  THEN CASE WHEN json_valid(authorization.private_json) THEN CASE WHEN json_type(authorization.private_json,'$.output_command_envelope.sponsor_entitlement') IS NOT NULL THEN 1 ELSE 0 END ELSE -1 END ELSE -1 END
  FROM event_private_payloads authorization WHERE authorization.private_event_id=execution.authorization_event_id
    AND authorization.owner_id=plan.owner_user_id AND authorization.document_id=plan.document_id
    AND authorization.project_id=plan.project_id AND authorization.redacted_at IS NULL),-1)`;
const joins = `LEFT JOIN output_operation_slots slot ON slot.job_id=job.job_id
  LEFT JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
  LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id`;
const columns = ["job_id", "owner_id", "stream_id", "document_id", "correlation_id", "kind", "source_surface"].map(name => textCell(`job.${name}`, name))
  .concat([textCell("slot.scope_key", "scope_key"), textCell("slot.slot_id", "slot_id"), textCell("slot.grant_id", "grant_id"),
    textCell("slot.outcome_event_id", "outcome_event_id"), textCell("execution.actor_user_id", "actor_user_id"),
    textCell("execution.payer_user_id", "payer_user_id"), textCell("execution.context_id", "context_id"),
    textCell("plan.project_id", "project_id"), textCell("plan.scope_kind", "scope_kind"), `${marker} AS sponsor_marker`,
    "CASE WHEN job.job_id IS NULL THEN 0 ELSE 1 END AS has_job", "CASE WHEN slot.job_id IS NULL THEN 0 ELSE 1 END AS has_slot"]);
const columnNames = ["job_id", "owner_id", "stream_id", "document_id", "correlation_id", "kind", "source_surface",
  "scope_key", "slot_id", "grant_id", "outcome_event_id", "actor_user_id", "payer_user_id", "context_id", "project_id", "scope_kind", "sponsor_marker", "has_job", "has_slot"];

function current(state: State) {
  const identity = hostedIdentity(state.request);
  if (state.request.method !== state.method || state.request.url !== state.url
    || (state.request.headers.get("cookie") ?? "") !== state.cookie || !identity
    || identity.userId !== state.identity.userId || identity.email !== state.identity.email
    || state.env.DB !== state.db || state.env.FORMA_PILOT_COHORT_ID !== state.cohort || state.env.FORMA_ADMIN_EMAILS !== state.admins
    || state.request.signal.aborted || performance.now() >= state.deadline) fail("context_changed");
}
function stateFor(context: SponsorNativeStoryRead, request: Request, env: WorkerEnv) {
  const state = states.get(context);
  if (!state || state.request !== request || state.env !== env) return fail("context_invalid");
  current(state); return state;
}
async function wait<T>(state: State, work: () => Promise<T>) {
  const life = new SponsorStoryReadBudget(0, state.deadline, state.request.signal, () => current(state));
  return life.wait(work);
}
async function all(state: State, sql: string, bindings: readonly (string | number | null)[] = []) {
  const rows = await wait(state, () => state.db.prepare(sql).bind(...bindings).all<Row>());
  const size = encoder.encode(JSON.stringify(rows)).byteLength;
  state.controlBytes += size;
  if (!rows.success || rows.results.length > 32 || size > 262_144 || state.controlBytes > 2_000_000) return fail("control_capacity");
  return rows.results;
}
function copied(assertion: Assertion): Assertion {
  return Object.freeze({ sql: assertion.sql, bindings: Object.freeze([...assertion.bindings]) });
}
/** Exact bounded control snapshots are SQL witnesses too. They never contain
 * authored source, job request/result bodies or native content. */
async function snapshot(state: State, sql: string, names: readonly string[], bindings: readonly (string | number | null)[]) {
  // json_object has a 32-argument qualification limit; build small objects and
  // merge them into one stable object instead of enlarging the function call.
  let object = `json_object(${names.slice(0, 12).flatMap(name => [`'${name}'`, name]).join(",")})`;
  for (let start = 12; start < names.length; start += 12) {
    object = `json_set(${object},${names.slice(start, start + 12).flatMap(name => [`'$.${name}'`, name]).join(",")})`;
  }
  const query = `WITH candidate AS MATERIALIZED (${sql}), serialized AS (
    SELECT json_group_array(json(${object})) AS snapshot FROM candidate)
    SELECT CASE WHEN length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM serialized`;
  const raw = (await all(state, query, bindings))[0]?.snapshot;
  if (typeof raw !== "string" || encoder.encode(raw).byteLength > 65_536) return fail("classification_unbounded");
  const rows = JSON.parse(raw) as Row[];
  if (!Array.isArray(rows) || rows.length > 2) return fail("classification_ambiguous");
  state.assertions.push(copied({ sql: `EXISTS(SELECT 1 FROM (${query}) WHERE CAST(snapshot AS BLOB)=CAST(? AS BLOB))`, bindings: [...bindings, raw] }));
  return rows;
}

/** Classify before principal/history/body reads. Positive ordinary evidence is
 * retained as a negative sponsorship witness through final native disclosure. */
export async function beginSponsorNativeStoryRead(request: Request, env: WorkerEnv, identity: NativeRetainedIdentity, lookup: Lookup): Promise<SponsorNativeStoryRead> {
  const context = Object.freeze({}) as SponsorNativeStoryRead;
  const state: State = { request, env, db: env.DB, identity: Object.freeze({ ...identity }), method: request.method,
    url: request.url, cookie: request.headers.get("cookie") ?? "", cohort: env.FORMA_PILOT_COHORT_ID,
    admins: env.FORMA_ADMIN_EMAILS, deadline: performance.now() + 30_000, controlBytes: 0, assertions: [], finalizationStarted: false, finalized: false, responseTaken: false };
  states.set(context, state); current(state);
  if (request.method !== "GET" || !id(identity.userId)) return fail("selection_invalid");
  const tables = await all(state, `SELECT name FROM sqlite_schema WHERE type='table'
    AND name IN('document_jobs','output_operation_slots','output_execution_grants','output_plan_revisions','experience_sponsor_consumptions') ORDER BY name LIMIT 5`);
  const names = new Set(tables.map(row => row.name));
  const schemaSql = `SELECT name FROM sqlite_schema WHERE type='table'
    AND name IN('document_jobs','output_operation_slots','output_execution_grants','output_plan_revisions','experience_sponsor_consumptions') ORDER BY name LIMIT 5`;
  const tableNames = [...names].map(String);
  state.assertions.push(copied({ sql: `(SELECT json_group_array(name) FROM (${schemaSql}))=?`, bindings: [JSON.stringify(tableNames)] }));
  if (!names.has("output_operation_slots") && !names.has("output_execution_grants")) {
    const absent = `NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE lower(name) GLOB 'experience_sponsor_*' OR lower(tbl_name) GLOB 'experience_sponsor_*'
      OR lower(name) GLOB 'idx_sponsor_story_*' OR lower(name) IN(${nativeObjectSql}) OR lower(tbl_name) IN(${nativeObjectSql}))`;
    const rows = await all(state, `SELECT CASE WHEN ${absent} THEN 1 ELSE 0 END AS ordinary`);
    if (rows[0]?.ordinary !== 1) return fail("configuration");
    state.assertions.push(copied({ sql: absent, bindings: [] })); return context;
  }
  if (!["document_jobs", "output_operation_slots", "output_execution_grants", "output_plan_revisions"].every(name => names.has(name))) return fail("configuration");
  const sponsorObjects = (await all(state, "SELECT 1 AS present FROM sqlite_schema WHERE lower(name) GLOB 'experience_sponsor_*' OR lower(tbl_name) GLOB 'experience_sponsor_*' LIMIT 1")).length > 0;
  if (!sponsorObjects) state.assertions.push(copied({ sql: "NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE lower(name) GLOB 'experience_sponsor_*' OR lower(tbl_name) GLOB 'experience_sponsor_*')", bindings: [] }));
  const consumed = names.has("experience_sponsor_consumptions")
    ? "EXISTS(SELECT 1 FROM experience_sponsor_consumptions used WHERE used.job_id=job.job_id)" : "0";
  let actorConsumed = false;
  if (names.has("experience_sponsor_consumptions")) {
    const nonempty = await all(state, "SELECT 1 AS present FROM experience_sponsor_consumptions LIMIT 1");
    if (nonempty.length) {
      await requireIndex(state, 1);
      const query = "EXISTS(SELECT 1 FROM experience_sponsor_consumptions INDEXED BY idx_sponsor_story_actor_history WHERE actor_user_id=? LIMIT 1)";
      const row = (await all(state, `SELECT CASE WHEN ${query} THEN 1 ELSE 0 END AS present`, [identity.userId]))[0];
      actorConsumed = row?.present === 1;
      if (!actorConsumed) state.assertions.push(copied({ sql: `NOT (${query})`, bindings: [identity.userId] }));
    } else state.assertions.push(copied({ sql: "NOT EXISTS(SELECT 1 FROM experience_sponsor_consumptions LIMIT 1)", bindings: [] }));
  }
  const streamId = `creative:${identity.userId}`;
  const eventColumns = [textCell("event.event_id", "event_id"), textCell("event.stream_id", "event_stream"),
    textCell("event.correlation_id", "event_correlation"), textCell(field("event.payload", "artifact_id"), "artifact_id"),
    textCell(field("event.payload", "document_id"), "event_document"), textCell(field("event.payload", "artifact_kind"), "artifact_kind")];
  let query: string, bindings: string[], selectedNames: string[];
  if ("handle" in lookup) {
    query = `SELECT ${columns.join(",")},${consumed} AS consumed FROM document_jobs job ${joins}
      WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? LIMIT 2`;
    bindings = [lookup.handle.jobId, identity.userId, streamId, lookup.handle.documentId]; selectedNames = [...columnNames, "consumed"];
  } else {
    const index = SPONSOR_NATIVE_STORY_READ_INDEXES[0]!;
    const definition = await all(state, "SELECT CASE WHEN length(CAST(sql AS BLOB))<=4096 THEN sql END AS sql FROM sqlite_schema WHERE type='index' AND name=? LIMIT 1", [index.name]);
    if (definition.length && definition[0]?.sql !== index.sql) return fail("configuration");
    if (definition.length) await requireIndex(state, 0);
    let originalConsumption = "0";
    if (actorConsumed) {
      await requireIndex(state, 2);
      originalConsumption = `EXISTS(SELECT 1 FROM output_operation_slots original_slot INDEXED BY idx_sponsor_story_outcome_lookup
        JOIN experience_sponsor_consumptions original_used ON original_used.job_id=original_slot.job_id
        WHERE original_slot.outcome_event_id=event.event_id)`;
    }
    // Old ordinary installations need no dormant index. Their bounded indexed
    // fallback visits at most the native reader's 512 completion events; an
    // unrelated count of Jobs cannot change an otherwise valid native read.
    const prefix = definition.length ? "" : `WITH selected_events AS MATERIALIZED (
      SELECT event_id,stream_id,correlation_id,CASE WHEN typeof(payload)='text' AND length(CAST(payload AS BLOB))<=65536 THEN payload END AS payload
      FROM events INDEXED BY idx_events_stream_type WHERE stream_id=? AND type='DocumentRenderCompleted' LIMIT 513) `;
    const from = definition.length ? "events event INDEXED BY idx_sponsor_story_artifact_lookup" : "selected_events event";
    query = `${prefix}SELECT ${columns.join(",")},${eventColumns.join(",")},(${consumed} OR ${originalConsumption}) AS consumed
      FROM ${from}
      LEFT JOIN document_jobs job INDEXED BY idx_document_jobs_stream_correlation
        ON job.stream_id=event.stream_id AND job.correlation_id=event.correlation_id ${joins}
      WHERE event.stream_id=? ${definition.length ? "AND event.type='DocumentRenderCompleted'" : "AND (SELECT COUNT(*) FROM selected_events)<=512"}
        AND ${artifactExpression.replaceAll("payload", "event.payload") }=? LIMIT 2`;
    bindings = [streamId, lookup.selection.artifactId];
    if (!definition.length) bindings.unshift(streamId);
    selectedNames = [...columnNames, "event_id", "event_stream", "event_correlation", "artifact_id", "event_document", "artifact_kind", "consumed"];
  }
  const rows = await snapshot(state, query, selectedNames, bindings);
  if (rows.length !== 1) return fail("classification_ambiguous");
  const row = rows[0]!;
  if ("selection" in lookup && (row.event_document !== lookup.selection.documentId || row.artifact_kind !== "short_story"
    || row.artifact_id !== lookup.selection.artifactId || !id(row.event_id))) return fail();
  const ordinary = row.consumed === 0 && (row.has_job === 1 && row.sponsor_marker === 0
    || row.has_slot === 0 && row.sponsor_marker === -1 && (row.has_job === 1 || !sponsorObjects));
  if (ordinary) return context;
  if ("handle" in lookup) return fail("legacy_completion_unavailable");
  if (!id(row.job_id) || row.owner_id !== identity.userId || row.stream_id !== streamId || row.document_id !== lookup.selection.documentId
    || row.kind !== "render_document" || row.event_stream !== streamId || row.event_correlation !== row.correlation_id
    || row.outcome_event_id !== row.event_id || row.scope_kind !== "personal" || row.context_id !== null) return fail();
  const authority = await wait(state, () => identifySponsorStoryRead(request, env, { jobId: row.job_id as string }));
  const facts = requireSponsorStoryReadAuthority(authority, request, env);
  if (facts.actorUserId !== identity.userId || facts.documentId !== row.document_id || facts.projectId !== row.project_id
    || facts.streamId !== streamId || facts.correlationId !== row.correlation_id || facts.scopeKey !== row.scope_key
    || facts.slotId !== row.slot_id || facts.outcomeEventId !== row.event_id) return fail("original_changed");
  const attempt = await wait(state, () => reserveSponsorStoryIoAttempt(authority, request, env, "short-story-result"));
  const ticket = await wait(state, () => takeSponsorStoryIoAttempt(attempt, authority, request, env));
  state.deadline = Math.min(state.deadline, ticket.monotonicDeadline);
  state.authority = authority; state.completionId = String(row.event_id); state.documentId = lookup.selection.documentId;
  state.artifactId = lookup.selection.artifactId;
  state.assertions.push(...ticket.assertions.map(copied));
  state.budget = new SponsorStoryReadBudget(ticket.maximumBytes, state.deadline, request.signal, () => current(state));
  state.budget.spend(state.controlBytes + ticket.controlBytes);
  state.adapter = sponsorStoryReadEnvironment(env, identity, state.budget);
  return context;
}

async function requireIndex(state: State, index: number) {
  const expected = SPONSOR_NATIVE_STORY_READ_INDEXES[index]!;
  const rows = await all(state, "SELECT CASE WHEN length(CAST(sql AS BLOB))<=4096 THEN sql END AS sql FROM sqlite_schema WHERE type='index' AND name=? LIMIT 1", [expected.name]);
  if (rows[0]?.sql !== expected.sql) return fail("configuration");
  state.assertions.push(copied({ sql: "EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name=? AND CAST(sql AS BLOB)=CAST(? AS BLOB))", bindings: [expected.name, expected.sql] }));
}

export function sponsorNativeStoryEnvironment(context: SponsorNativeStoryRead, request: Request, env: WorkerEnv) {
  const state = stateFor(context, request, env); return state.adapter?.env ?? env;
}
export function sponsorNativeStoryFinalQuery(context: SponsorNativeStoryRead, request: Request, env: WorkerEnv) {
  const state = stateFor(context, request, env); return state.adapter ? sponsorNativeStoryFinalSql(env, state.identity) : null;
}
export function assertSponsorNativeStorySelection(context: SponsorNativeStoryRead, request: Request, env: WorkerEnv,
  selection: { documentId: string; artifactId: string }, native: { completionId: string }) {
  const state = stateFor(context, request, env);
  if (state.authority && (selection.documentId !== state.documentId || selection.artifactId !== state.artifactId
    || native.completionId !== state.completionId)) return fail("selection_changed");
}
export async function finishSponsorNativeStoryRead(context: SponsorNativeStoryRead, request: Request, env: WorkerEnv,
  statement: D1PreparedStatement) {
  const state = stateFor(context, request, env);
  if (state.finalizationStarted) return fail("replay");
  state.finalizationStarted = true;
  if (state.adapter && state.authority) {
    const facts = requireSponsorStoryReadAuthority(state.authority, request, env);
    const result = await state.adapter.finish(statement, [...state.assertions, ...facts.assertions]);
    current(state); state.finalized = true; return result;
  }
  // Ordinary reads retain their exact original native query, plus a fresh
  // negative sponsorship/schema witness in the same transaction.
  const results = await wait(state, () => state.db.batch<Row>([statement, ...state.assertions.map(assertion =>
    state.db.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).bind(...assertion.bindings))]));
  if (!finalAcknowledged(results, state.assertions.length + 1)) return fail("ordinary_changed");
  state.finalized = true;
  return { admitted: 1 };
}
export function sponsorNativeStoryResponse(context: SponsorNativeStoryRead, request: Request, env: WorkerEnv, serialized: string): BodyInit {
  const state = stateFor(context, request, env);
  if (!state.finalized || state.responseTaken) return fail("replay");
  state.responseTaken = true;
  return state.budget ? sponsorStoryResponseBody(serialized, state.budget) : serialized;
}
