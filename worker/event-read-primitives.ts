import type { EventRow } from "./event-write-primitives.ts";

export function serializeEvent(row: Record<string, unknown>): EventRow {
  return { eventId: String(row.event_id), streamId: String(row.stream_id), sequence: Number(row.sequence), occurredAt: String(row.occurred_at), recordedAt: String(row.recorded_at), actor: String(row.actor), clientId: String(row.client_id), correlationId: String(row.correlation_id), causationId: row.causation_id ? String(row.causation_id) : null, compensatesEventId: row.compensates_event_id ? String(row.compensates_event_id) : null, schemaVersion: Number(row.schema_version), type: String(row.type), payload: JSON.parse(typeof row.private_json==="string"?row.private_json:String(row.payload)) as Record<string, unknown> };
}
