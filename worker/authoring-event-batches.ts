import type { BudgetReservationGuard } from "./pilot-policy.ts";
import { AUTHORING_SIDECAR_COLUMNS, authoringEventProof, authoringJsonChunks, authoringSidecarProof, combineAuthoringGuards } from "./authoring-event-proof.ts";
export { authoringJsonChunks, combineAuthoringGuards } from "./authoring-event-proof.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, type EventRow, type WorkerEnv } from "./runtime.ts";

// Keep each JSON binding below D1's 2 MB value limit. All chunks are statements in ONE DB.batch().
const JSON_BYTES = 1_900_000;
const ROWS_PER_STATEMENT = 128;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

const columns = EVENT_WRITE_COLUMNS.split(",");

/** Build only; the caller owns the single event/sidecar/receipt transaction. */
export function prepareAuthoringEventBatch(
  env: WorkerEnv, events: readonly EventRow[], expectedHead: number, admission: BudgetReservationGuard,
) {
  if (!events.length || events.length > 512) throw new Error("invalid_authoring_operation");
  const stream = events[0]!.streamId;
  if (events.some((event, index) => event.streamId !== stream || event.sequence !== expectedHead + index + 1)) {
    throw new Error("authoring_source_stale");
  }
  const rows = events.map(eventWriteBindings);
  const statements: D1PreparedStatement[] = [];
  let offset = 0;
  for (let first = 0; first < rows.length;) {
    const row = rows[first]!, serialized = JSON.stringify(row);
    if (byteLength(serialized) + 2 > JSON_BYTES) {
      // A single large existing payload need not be JSON-escaped into another large binding.
      if (row.some((value) => typeof value === "string" && byteLength(value) > 2_000_000)) throw new Error("authoring_payload_too_large");
      statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS})
        SELECT ${columns.map(() => "?").join(",")} WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (${admission.sql})`)
        .bind(...row, stream, expectedHead + offset, ...admission.bindings));
      first++; offset++; continue;
    }
    const group: typeof rows = [], parts: string[] = [];
    let bytes = 2;
    while (first < rows.length && group.length < ROWS_PER_STATEMENT) {
      const next = JSON.stringify(rows[first]), size = byteLength(next);
      if (size + 2 > JSON_BYTES || group.length && bytes + size + 1 > JSON_BYTES) break;
      group.push(rows[first]!); parts.push(next); bytes += size + 1; first++;
    }
    const json = "[" + parts.join(",") + "]";
    // MATERIALIZED freezes admission before trigger-backed row insertion advances the stream.
    // The receipt rechecks admission and every expected canonical/private row at transaction end.
    statements.push(env.DB.prepare(`WITH authoring_admission AS MATERIALIZED(
        SELECT 1 AS allowed WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (${admission.sql})
      )
      INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS})
      SELECT ${columns.map((_, index) => `json_extract(incoming.value,'$[${index}]')`).join(",")}
      FROM authoring_admission CROSS JOIN json_each(?) incoming ORDER BY CAST(incoming.key AS INTEGER)`)
      .bind(stream, expectedHead + offset, ...admission.bindings, json));
    offset += group.length;
  }
  return { statements, proof: authoringEventProof(events) };
}

const sidecarTables = {
  project_event_scopes: {
    columns: AUTHORING_SIDECAR_COLUMNS.project_event_scopes,
    eventIndex: 0,
  },
  project_resource_scopes: {
    columns: AUTHORING_SIDECAR_COLUMNS.project_resource_scopes,
    eventIndex: 7,
  },
} as const;

/** All sidecar values come from the same validated event list. Missing rows fail the final CHECK. */
export function prepareAuthoringSidecarBatch(
  env: WorkerEnv, table: keyof typeof sidecarTables, rows: readonly (readonly (string | number | null)[])[],
) {
  const schema = sidecarTables[table], statements: D1PreparedStatement[] = [];
  for (const json of authoringJsonChunks(rows)) {
    statements.push(env.DB.prepare(`INSERT INTO ${table}(${schema.columns.join(",")})
      SELECT ${schema.columns.map((_, index) => `json_extract(incoming.value,'$[${index}]')`).join(",")}
      FROM json_each(?) incoming WHERE EXISTS(SELECT 1 FROM events event WHERE event.event_id=json_extract(incoming.value,'$[${schema.eventIndex}]'))`)
      .bind(json));
  }
  return { statements, proof: authoringSidecarProof(table,rows) };
}

/** Repeated references to one media object retain the last source event, exactly as ordered single updates do. */
export function prepareAuthoringMediaBatch(
  env: WorkerEnv, updates: readonly (readonly [eventId: string, projectAccessId: string, organizationId: string, key: string])[],
) {
  const latest = new Map(updates.map((row) => [JSON.stringify(row.slice(1)), row]));
  const statements: D1PreparedStatement[] = [], proofs: BudgetReservationGuard[] = [];
  const matches = (alias: string) => `resource.project_access_id=json_extract(${alias}.value,'$[1]')
    AND resource.organization_id=json_extract(${alias}.value,'$[2]') AND resource.resource_kind='media'
    AND resource.resource_id=json_extract(${alias}.value,'$[3]')`;
  for (const json of authoringJsonChunks([...latest.values()])) {
    statements.push(env.DB.prepare(`UPDATE project_resource_scopes AS resource
      SET source_event_id=(SELECT json_extract(incoming.value,'$[0]') FROM json_each(?) incoming WHERE ${matches("incoming")} LIMIT 1)
      WHERE EXISTS(SELECT 1 FROM json_each(?) incoming JOIN events event ON event.event_id=json_extract(incoming.value,'$[0]') WHERE ${matches("incoming")})`)
      .bind(json, json));
    proofs.push({
      sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM project_resource_scopes resource
        WHERE ${matches("expected")} AND resource.source_event_id=json_extract(expected.value,'$[0]')))`,
      bindings: [json],
    });
  }
  return { statements, proof: combineAuthoringGuards(...proofs) };
}
