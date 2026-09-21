import { publicEventPayload } from "./event-privacy.ts";
import type { EventRow } from "./event-write-primitives.ts";

/** Generic event feeds are not qualified Memory readers. Marked generated
 * events retain only routing/provenance metadata here, even before expiry
 * maintenance and after a faulty restore. Lease-bound Memory endpoints read
 * their own exact canonical records; authored edits use a different marker. */
export function serializeEvent(row: Record<string, unknown>): EventRow {
  const publicPayload=JSON.parse(String(row.payload)) as Record<string,unknown>;
  const marked=row.type==='AssistantReasoned'&&Object.hasOwn(publicPayload,'memory_origin_version');
  // Preserve the existing operational header, including negative-provenance
  // references needed by scope rebuilding. Those identifiers are not hydrated
  // Memory bytes; ordinary content readers independently exclude their bodies.
  const payload=marked?publicEventPayload(String(row.event_id),publicPayload,true).payload
    :JSON.parse(typeof row.private_json==='string'?row.private_json:String(row.payload)) as Record<string,unknown>;
  return { eventId: String(row.event_id), streamId: String(row.stream_id), sequence: Number(row.sequence), occurredAt: String(row.occurred_at), recordedAt: String(row.recorded_at), actor: String(row.actor), clientId: String(row.client_id), correlationId: String(row.correlation_id), causationId: row.causation_id ? String(row.causation_id) : null, compensatesEventId: row.compensates_event_id ? String(row.compensates_event_id) : null, schemaVersion: Number(row.schema_version), type: String(row.type), payload };
}
