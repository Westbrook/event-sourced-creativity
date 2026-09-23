import type { CreativeEvent } from '../src/model/events.ts';
import { publicEventPayload } from './event-privacy.ts';
import { legacyPublicPayloadExpression } from './event-privacy-migration.ts';

type Row = Record<string, unknown>;
const fields = ['document', 'project'] as const;
// Missing, explicit null and empty text are deliberately distinct. None proves
// subject membership. No value, subject ID or rejected body leaves this query.
const fieldState = (body: string, field: string, expected: string) => `CASE
 WHEN json_type(${body},'$.${field}_id') IS NULL THEN 'missing'
 WHEN json_type(${body},'$.${field}_id')='null' THEN 'null'
 WHEN json_type(${body},'$.${field}_id')<>'text' THEN 'invalid'
 WHEN json_extract(${body},'$.${field}_id')='' THEN 'empty'
 WHEN json_extract(${body},'$.${field}_id')=${expected} THEN 'matches' ELSE 'different' END`;

/** Called only for server-resolved rejected references after the custody gates.
 * Both actual producer projections are checked independently: compatibility
 * does not identify which writer ran, or authenticate historical membership. */
export function scopeObservationQuery(event: CreativeEvent, owner: string, document: string, project: string, before: number, maxCell: number) {
  const payload = JSON.stringify(event.payload);
  const publicPayload = JSON.stringify(publicEventPayload(event.eventId, event.payload, true).payload);
  const metadata = ['sequence','type','occurred_at','recorded_at','actor','client_id','correlation_id','causation_id','compensates_event_id','schema_version'];
  return {
    sql: `WITH expected(document_id,project_id,private_json,public_json) AS (VALUES(?,?,?,?))
 SELECT ${metadata.map(k => `event.${k} IS ?`).join(' AND ')} AS event_identity_matches,
 json(secret.private_json)=json(expected.private_json) AS private_body_matches_history,
 json(event.payload)=json(expected.public_json) AS writer_envelope_matches,
 json(event.payload)=json(${legacyPublicPayloadExpression('secret.private_json','event.event_id')}) AS migration_envelope_matches,
 ${fields.flatMap(f => [
      `${fieldState('secret.private_json',f,`expected.${f}_id`)} AS ${f}_payload`,
      `${fieldState('event.payload',f,`expected.${f}_id`)} AS ${f}_public`,
      `CASE WHEN secret.${f}_id IS NULL THEN 'null' WHEN secret.${f}_id='' THEN 'empty' WHEN secret.${f}_id=expected.${f}_id THEN 'matches' ELSE 'different' END AS ${f}_sidecar`,
      // These are the writer's normalization and the migration's extraction,
      // respectively. Invalid types are never classified as genuine absence.
      `(secret.${f}_id IS NULLIF(CAST(json_extract(secret.private_json,'$.${f}_id') AS TEXT),'') OR secret.${f}_id IS CAST(json_extract(secret.private_json,'$.${f}_id') AS TEXT)) AS ${f}_sidecar_matches_payload`,
    ]).join(',\n')}
 FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id CROSS JOIN expected
 WHERE event.event_id=? AND event.stream_id=? AND event.sequence<? AND secret.owner_id=? AND secret.redacted_at IS NULL
 AND length(CAST(event.payload AS BLOB))<=${maxCell} AND length(CAST(secret.private_json AS BLOB))<=${maxCell}
 AND json_valid(event.payload) AND json_valid(secret.private_json)
 AND NOT EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event.event_id) LIMIT 1`,
    bindings: [document,project,payload,publicPayload,event.sequence,event.type,event.occurredAt,event.recordedAt,event.actor,event.clientId,event.correlationId,event.causationId,event.compensatesEventId,event.schemaVersion,event.eventId,event.streamId,before,owner],
  };
}

export function classifyScopeObservation(row: Row | null, type: string) {
  if (!row) return { classification: 'unavailable', membershipProven: false };
  const envelopeMatches = row.writer_envelope_matches === 1 || row.migration_envelope_matches === 1;
  const integrityMatches = row.event_identity_matches === 1 && row.private_body_matches_history === 1;
  const scopes = Object.fromEntries(fields.map(f => [f, { payload: row[f+'_payload'], public: row[f+'_public'], sidecar: row[f+'_sidecar'], sidecarMatchesPayload: row[f+'_sidecar_matches_payload'] === 1 }]));
  const inconsistent = !envelopeMatches || !integrityMatches || fields.some(f => row[f+'_sidecar_matches_payload'] !== 1 || row[f+'_payload'] === 'invalid');
  const conflict = fields.some(f => row[f+'_payload'] === 'different');
  const absent = fields.some(f => row[f+'_payload'] === 'missing' || row[f+'_payload'] === 'null');
  // Empty strings and other event types remain unresolved rather than becoming
  // historical membership candidates. Admission is unchanged for every class.
  const supported = ['BlockPropertyEdited','DocumentRenamed'].includes(type);
  const classification = inconsistent ? 'inconsistent_producer_envelope' : conflict ? 'explicit_conflicting_scope'
    : supported && absent && fields.every(f => ['missing','null','matches'].includes(String(row[f+'_payload']))) ? 'absent_scope_metadata' : 'unresolved_scope';
  return { classification, scopes, eventIdentityMatches: row.event_identity_matches === 1, privateBodyMatchesHistory: row.private_body_matches_history === 1,
    envelope: { writerCompatible: row.writer_envelope_matches === 1, migrationCompatible: row.migration_envelope_matches === 1, producerAttribution: 'not_established' }, membershipProven: false };
}
