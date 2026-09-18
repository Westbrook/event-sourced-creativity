import { publicEventPayload } from "./event-privacy.ts";

export type EventRow = {
  eventId: string; streamId: string; sequence: number; occurredAt: string; recordedAt: string;
  actor: string; clientId: string; correlationId: string; causationId: string | null;
  compensatesEventId: string | null; schemaVersion: number; type: string; payload: Record<string, unknown>;
};

export const uuidV7 = () => {
  const time = Date.now().toString(16).padStart(12, "0");
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const variant = ((bytes[4] & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hex.slice(0, 3)}-${variant}${hex.slice(5, 7)}-${hex.slice(7, 19)}`;
};

export const EVENT_WRITE_STAGE_TRIGGER_SQL = `CREATE TRIGGER IF NOT EXISTS event_write_stage_after_insert AFTER INSERT ON event_write_stage BEGIN
  SELECT CASE WHEN NEW.stream_id LIKE 'creative:%' AND NEW.owner_id<>substr(NEW.stream_id,10) THEN RAISE(ABORT,'event_owner_mismatch') END;
  INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload)
    VALUES(NEW.event_id,NEW.stream_id,NEW.sequence,NEW.occurred_at,NEW.recorded_at,NEW.actor,NEW.client_id,NEW.correlation_id,NEW.causation_id,NEW.compensates_event_id,NEW.schema_version,NEW.type,NEW.payload);
  INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at)
    SELECT NEW.event_id,NEW.owner_id,NEW.project_id,NEW.document_id,NEW.private_json,NEW.recorded_at,NULL WHERE NEW.private_json IS NOT NULL;
  DELETE FROM event_write_stage WHERE event_id=NEW.event_id;
END`;

export function makeEvent(streamId: string, sequence: number, actor: string, clientId: string, correlationId: string, type: string, payload: Record<string, unknown>, options: { causationId?: string | null; compensatesEventId?: string | null } = {}): EventRow {
  const now = new Date().toISOString();
  return { eventId: uuidV7(), streamId, sequence, occurredAt: now, recordedAt: now, actor, clientId, correlationId, causationId: options.causationId ?? null, compensatesEventId: options.compensatesEventId ?? null, schemaVersion: 1, type, payload };
}

export const EVENT_WRITE_COLUMNS = "event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload,owner_id,project_id,document_id,private_json";

export function eventWriteBindings(event: EventRow): Array<string | number | null> {
  // Envelope every event, not only today's known authored types. Otherwise a
  // newly introduced or historically overlooked event can strand customer
  // text in immutable history while privacy controls report complete erasure.
  const split = publicEventPayload(event.eventId, event.payload, true);
  const owner = event.streamId.startsWith("creative:") ? event.streamId.slice("creative:".length) : event.streamId;
  return [event.eventId,event.streamId,event.sequence,event.occurredAt,event.recordedAt,event.actor,event.clientId,event.correlationId,event.causationId,event.compensatesEventId,event.schemaVersion,event.type,JSON.stringify(split.payload),owner,String(event.payload.project_id??"")||null,String(event.payload.document_id??"")||null,split.privateJson];
}
