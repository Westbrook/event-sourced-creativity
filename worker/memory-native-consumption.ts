import { DOCUMENT_VIEWS } from "../src/model/document-view-signals.ts";
import { reduceConsumptionEpisodes } from "./memory-consumption.ts";
import { nativeMemoryDescriptor, nativeMemoryTimestamp, type NativeMemoryQuery, type NativeMemorySqlValue } from "./memory-native-deadlines.ts";
import type { ConsumptionAuthority, ConsumptionObservation, ConsumptionProjection, ConsumptionSource } from "./memory-consumption-types.ts";
import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";

type Enrollment = Pick<LiveMemoryEnrollment, "enrollment_id" | "actor_user_id" | "owner_user_id" | "organization_id"
  | "project_access_id" | "project_id" | "document_id" | "permission_epoch" | "policy_version" | "revision"
  | "cursor_sequence" | "enrolled_at" | "expires_at" | "retention_days">;
/** Trusted in-process liveMemorySourceQuery output, never request-controlled SQL. */
type SourceQuery = { joins: string; condition: string; bindings: NativeMemorySqlValue[] };
type Row = Record<string, unknown>;
const ENROLLMENT = ["enrollment_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id",
  "project_id", "document_id", "permission_epoch", "policy_version", "revision", "cursor_sequence", "enrolled_at", "expires_at", "retention_days"] as const;
const SOURCE = ["eventId", "sequence", "type", "blockId", "recordedAt", "validUntil"] as const;
const PAYLOAD = ["document_id", "project_id", "view", "focused", "route_family", "source_surface"] as const;
const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const bound = (name: string) => `json_extract(binding.value,'$.${name}')`;
const views = new Set<string>(DOCUMENT_VIEWS);
function assert(condition: unknown): asserts condition { if (!condition) throw new Error("native_consumption_invalid"); }
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && value.isWellFormed();
const timestamp = (value: unknown): number => { const time = nativeMemoryTimestamp(value); assert(time !== null); return time; };

/** Copy only own data fields. Accessor values are never evaluated. */
function record(input: unknown, fields: readonly string[], exact = true, nativeRow = false): Row {
  assert(input !== null && typeof input === "object" && (Object.getPrototypeOf(input) === Object.prototype
    || nativeRow && Object.getPrototypeOf(input) === null));
  if (exact) { const keys = Reflect.ownKeys(input); assert(keys.length === fields.length && keys.every(key => typeof key === "string" && fields.includes(key))); }
  const result: Row = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    assert(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
    result[field] = descriptor.value;
  }
  return result;
}
function array(input: unknown, max: number): unknown[] {
  assert(Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype);
  const descriptor = Object.getOwnPropertyDescriptor(input, "length");
  assert(descriptor && Object.hasOwn(descriptor, "value"));
  const size: unknown = descriptor.value;
  assert(typeof size === "number" && Number.isSafeInteger(size) && size >= 0 && size <= max);
  assert(Reflect.ownKeys(input).length === size + 1);
  const result: unknown[] = [];
  for (let index = 0; index < size; index++) {
    const item = Object.getOwnPropertyDescriptor(input, String(index));
    assert(item && Object.hasOwn(item, "value") && item.enumerable);
    result.push(item.value);
  }
  return result;
}
function selection(original: Enrollment, sources: readonly ConsumptionSource[]) {
  // Full native enrollments have additional fields; none are read or inherited.
  const row = record(original, ENROLLMENT, false);
  for (const name of ["enrollment_id", "actor_user_id", "owner_user_id", "project_id", "document_id", "permission_epoch"]) assert(id(row[name]));
  assert(row.policy_version === "personal-memory-v2");
  for (const name of ["revision", "retention_days", "cursor_sequence"]) assert(typeof row[name] === "number"
    && Number.isSafeInteger(row[name]) && row[name] >= (name === "cursor_sequence" ? 0 : 1));
  assert(Number(row.retention_days) <= 365 && timestamp(row.enrolled_at) < timestamp(row.expires_at));
  assert(row.organization_id === null && row.project_access_id === null && row.actor_user_id === row.owner_user_id
    || id(row.organization_id) && id(row.project_access_id));
  const e = row as Enrollment;
  const ids = new Set<string>(), sequences = new Set<number>();
  const refs = array(sources, 64).map(value => {
    const item = record(value, SOURCE);
    assert(id(item.eventId) && id(item.type) && (item.blockId === null || id(item.blockId)));
    assert(typeof item.sequence === "number" && Number.isSafeInteger(item.sequence) && item.sequence > 0 && item.sequence <= e.cursor_sequence);
    assert(timestamp(item.recordedAt) < timestamp(item.validUntil) && !ids.has(item.eventId) && !sequences.has(item.sequence));
    ids.add(item.eventId); sequences.add(item.sequence); return item as ConsumptionSource;
  });
  return { e, refs };
}

export function nativeMemoryConsumptionSchemaQuery(): NativeMemoryQuery {
  return nativeMemoryDescriptor("SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN(" +
    "'events','event_private_payloads','memory_live_sources','memory_live_enrollments','project_event_scopes'))=5 THEN 1 ELSE 0 END AS ready", []);
}

/**
 * Reference-only navigation bridge. This query must be enclosed by the existing
 * native principal/document admission checks. Replay its exact rows, including
 * the all-stream negative-edge anti-join, before final delivery. No caller or
 * resource authorization is conferred by this descriptor alone.
 */
export function nativeMemoryConsumptionQuery(original: Enrollment, originalQuery: SourceQuery, sources: readonly ConsumptionSource[]): NativeMemoryQuery {
  const { e, refs } = selection(original, sources);
  const q = record(originalQuery, ["joins", "condition", "bindings"]);
  assert(typeof q.joins === "string" && q.joins.length > 0 && q.joins.length <= 90_000
    && typeof q.condition === "string" && q.condition.length > 0 && q.condition.length <= 90_000);
  const bindings = array(q.bindings, 97).map(value => {
    assert(value === null || typeof value === "string" && value.length <= 131_072
      || typeof value === "number" && Number.isSafeInteger(value));
    return value as NativeMemorySqlValue;
  });
  const raw = "(CASE WHEN json_valid(secret.private_json) THEN secret.private_json ELSE '{}' END)";
  const publicRaw = "(CASE WHEN json_valid(event.payload) THEN event.payload ELSE '{}' END)";
  const clean = (json: string) => ["simulation", "synthetic", "origin.synthetic"].map(field =>
    `COALESCE(json_extract(${json},'$.${field}'),0)=0`).concat(["mock_data_source", "replay_session_id", "fictional_user_id", "canvas_id", "context_set_id", "report_space"].map(field =>
    `json_extract(${json},'$.${field}') IS NULL`)).join(" AND ");
  const actorMetadata = (json: string) => `(json_type(${json},'$.actor_user_id') IS NULL OR
    json_type(${json},'$.actor_user_id')='text' AND json_extract(${json},'$.actor_user_id')=${bound("actor_user_id")})`;
  // Keep native eligibility and exact observation checks in separate expression
  // trees. Concatenating both predicates exceeds D1's depth-100 ceiling.
  const sql = `WITH binding AS (SELECT ? AS value), selection AS (SELECT value FROM json_each(?)),
    native_eligible AS MATERIALIZED (SELECT event.event_id,event.sequence ${q.joins} WHERE ${q.condition})
    SELECT event.event_id,event.sequence,event.type,event.recorded_at,
      json_extract(event.payload,'$.block_id') AS block_id,remembered.expires_at AS remembered_until,
      json_object(${PAYLOAD.map(name => `'${name}',json_extract(${raw},'$.${name}')`).join(",")}) AS payload_json
    FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    JOIN native_eligible eligible ON eligible.event_id=event.event_id AND eligible.sequence=event.sequence JOIN binding JOIN selection
    JOIN memory_live_sources remembered ON remembered.enrollment_id=${bound("enrollment_id")}
      AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence
    WHERE event.type='DocumentViewVisited'
      AND event.stream_id='creative:'||${bound("owner_user_id")}
      AND (event.actor='user:'||${bound("actor_user_id")} OR ${bound("organization_id")} IS NULL AND event.actor='user')
      AND event.event_id NOT LIKE 'optimistic:%' AND event.client_id NOT LIKE '%optimistic%'
      AND event.event_id=json_extract(selection.value,'$.eventId') AND event.sequence=json_extract(selection.value,'$.sequence')
      AND event.type=json_extract(selection.value,'$.type') AND event.recorded_at=json_extract(selection.value,'$.recordedAt')
      AND json_extract(event.payload,'$.block_id') IS json_extract(selection.value,'$.blockId')
      AND json_extract(selection.value,'$.blockId') IS NULL
      AND json_extract(selection.value,'$.validUntil')>${clock}
      AND event.sequence<=${bound("cursor_sequence")} AND event.recorded_at>=${bound("enrolled_at")} AND event.recorded_at<=${clock}
      AND remembered.expires_at>${clock} AND strftime('%Y-%m-%dT%H:%M:%fZ',event.recorded_at,'+'||${bound("retention_days")}||' days')>${clock}
      AND (SELECT COUNT(*) FROM memory_live_sources other WHERE other.enrollment_id=remembered.enrollment_id AND other.event_id=event.event_id)=1
      AND EXISTS(SELECT 1 FROM memory_live_enrollments enrollment WHERE
        (${ENROLLMENT.map(name => `enrollment.${name}`).join(",")},enrollment.recall_enabled)
          IS (${ENROLLMENT.map(bound).join(",")},1) AND enrollment.expires_at>${clock})
      AND (${bound("organization_id")} IS NULL AND NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id)
        OR ${bound("organization_id")} IS NOT NULL AND (SELECT COUNT(*) FROM project_event_scopes custody WHERE custody.event_id=event.event_id)=1
        AND EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id
          AND (custody.source_stream_id,custody.source_sequence,custody.organization_id,custody.project_access_id,custody.project_id,custody.owner_user_id,custody.actor_user_id)
            IS (event.stream_id,event.sequence,${["organization_id", "project_access_id", "project_id", "owner_user_id", "actor_user_id"].map(bound).join(",")})))
      AND json_extract(event.payload,'$._private_ref')=event.event_id
      AND (secret.owner_id,secret.project_id,secret.document_id,secret.redacted_at)
        IS (${bound("owner_user_id")},${bound("project_id")},${bound("document_id")},NULL)
      AND length(CAST(secret.private_json AS BLOB))<=16384 AND length(CAST(event.payload AS BLOB))<=16384 AND json_type(${raw})='object'
      AND NOT EXISTS(SELECT 1 FROM json_tree(${raw}) WHERE parent IS NOT NULL GROUP BY parent,key HAVING COUNT(*)>1)
      AND NOT EXISTS(SELECT 1 FROM json_tree(${publicRaw}) WHERE parent IS NOT NULL GROUP BY parent,key HAVING COUNT(*)>1)
      AND json_extract(event.payload,'$.document_id')=${bound("document_id")}
      AND json_extract(${raw},'$.document_id')=${bound("document_id")}
      AND (json_type(${raw},'$.project_id')='null' OR json_type(${raw},'$.project_id')='text' AND json_extract(${raw},'$.project_id')=${bound("project_id")})
      AND json_extract(event.payload,'$.project_id') IS json_extract(${raw},'$.project_id')
      AND json_extract(${raw},'$.block_id') IS NULL
      AND json_type(${raw},'$.focused') IN('true','false')
      AND json_extract(${raw},'$.route_family')='document'
      AND json_extract(${raw},'$.source_surface')='document-view-navigation'
      AND (json_type(${publicRaw},'$.focused') IS NULL OR json_type(${publicRaw},'$.focused') IN('true','false')
        AND json_extract(${publicRaw},'$.focused')=json_extract(${raw},'$.focused'))
      AND (json_type(${publicRaw},'$.route_family') IS NULL OR json_extract(${publicRaw},'$.route_family')='document')
      AND json_extract(${raw},'$.view') IN(${[...views].map(view => `'${view}'`).join(",")})
      AND json_extract(event.payload,'$.view')=json_extract(${raw},'$.view')
      AND json_extract(event.payload,'$.source_surface')=json_extract(${raw},'$.source_surface')
      AND ${actorMetadata(raw)} AND ${actorMetadata(publicRaw)} AND ${clean(raw)} AND ${clean(publicRaw)}
      AND event.compensates_event_id IS NULL
      AND event.event_id NOT IN(SELECT negative.compensates_event_id FROM events negative WHERE negative.stream_id='creative:'||(SELECT json_extract(value,'$.owner_user_id') FROM binding) AND negative.compensates_event_id IS NOT NULL)
    ORDER BY event.sequence LIMIT 65`;
  // Prefix CTE bindings preserve q's own JOIN/WHERE order without assumptions.
  return nativeMemoryDescriptor(sql, [JSON.stringify(e), JSON.stringify(refs), ...bindings]);
}

/** Consumes exact query rows, not browser-submitted evidence or auth assertions. */
export function nativeMemoryConsumptionValue(rows: readonly Row[], original: Enrollment, sources: readonly ConsumptionSource[],
  checkedAt: string, outerValidUntil: string): ConsumptionProjection | null {
  try {
    const { e, refs } = selection(original, sources), now = timestamp(checkedAt);
    const deadline = Math.min(timestamp(outerValidUntil), timestamp(e.expires_at));
    assert(deadline > now && timestamp(e.enrolled_at) <= now);
    const authority: ConsumptionAuthority = {
      enrollment_id: e.enrollment_id, actor_user_id: e.actor_user_id, owner_user_id: e.owner_user_id,
      organization_id: e.organization_id, project_access_id: e.project_access_id, project_id: e.project_id,
      document_id: e.document_id, permission_epoch: e.permission_epoch, revision: e.revision, cursor_sequence: e.cursor_sequence,
    };
    const observations: ConsumptionObservation[] = [], seen = new Set<string>();
    for (const originalRow of array(rows, 64)) {
      const row = record(originalRow, ["event_id", "sequence", "type", "recorded_at", "block_id", "remembered_until", "payload_json"], true, true);
      const source = refs.find(ref => ref.eventId === row.event_id);
      assert(source && !seen.has(source.eventId) && source.sequence === row.sequence && source.type === row.type
        && source.type === "DocumentViewVisited" && source.blockId === null && row.block_id === null && source.recordedAt === row.recorded_at);
      assert(typeof row.payload_json === "string" && row.payload_json.length <= 2048);
      const payload = record(JSON.parse(row.payload_json), PAYLOAD);
      // The exact SQL json_object output has this canonical field order and no
      // duplicate keys. Reject ambiguous/noncanonical substituted row text.
      assert(JSON.stringify(payload) === row.payload_json);
      // SQLite json_object represents the validated JSON boolean as 0/1.
      assert(payload.document_id === e.document_id && (payload.project_id === null || payload.project_id === e.project_id)
        && typeof payload.view === "string" && views.has(payload.view) && (payload.focused === 0 || payload.focused === 1)
        && payload.route_family === "document" && payload.source_surface === "document-view-navigation");
      const recorded = timestamp(source.recordedAt);
      assert(recorded >= timestamp(e.enrolled_at) && recorded <= now);
      const until = Math.min(deadline, timestamp(source.validUntil), timestamp(row.remembered_until), recorded + e.retention_days * 86_400_000);
      assert(until > now);
      source.validUntil = new Date(until).toISOString();
      seen.add(source.eventId);
      observations.push({ source: { eventId: source.eventId, sequence: source.sequence }, authority: { ...authority },
        kind: "visit", episodeId: null, resourceRevision: null, copiedFrom: null });
    }
    return reduceConsumptionEpisodes({ authority, checkedAt, validUntil: new Date(deadline).toISOString(), sources: refs,
      observations, compensations: [], withdrawnSources: [], provenance: null });
  } catch { return null; }
}
