import { eventWriteBindings, type EventRow } from "./event-write-primitives.ts";
import { OutputConflictError, type OutputSqlAssertion } from "./output-command-core.ts";

export const MODEL3D_REFERENCE_HEAD_SQL = "COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?";
const fail = (): never => { throw new OutputConflictError("output_model3d_publication_changed", 409); };
type Original = Readonly<{ jobId: string; ownerId: string; streamId: string; correlationId: string }>;

/** Request-local evidence from the actual event writer, never an HTTP receipt.
 * The writer publishes request/budget first, then rechecks the owned reference.
 * Only the final completed/usage pair advances that rechecked source head.
 * Original custody, source, consent, expiry, job and grant assertions stay intact. */
export function model3dPublicationHead(original: Original) {
  const owner = { ...original };
  let captured: Readonly<{ oldHead: number; newHead: number; rows: string }> | null = null;
  return {
    hasPublication: () => captured !== null,
    capture(events: readonly EventRow[], completionJson: string | undefined) {
      if (completionJson === undefined) return; // Unsuccessful render behavior is unchanged.
      if (owner.streamId !== `creative:${owner.ownerId}` || !owner.jobId || !owner.correlationId
        || events.length !== 2 || new Set(events.map(event => event.eventId)).size !== 2) fail();
      const types = ["DocumentRenderCompleted", "GenerationUsageRecorded"];
      const actors = ["worker:renderer", "worker:policy"];
      const oldHead = events[0]!.sequence - 1;
      if (!Number.isSafeInteger(oldHead) || oldHead < 0 || !Number.isSafeInteger(oldHead + 2)
        || events.some((event, index) => event.streamId !== owner.streamId || event.correlationId !== owner.correlationId
          || event.sequence !== oldHead + index + 1 || event.type !== types[index]
          || event.actor !== actors[index] || event.clientId !== "server:document-job:render_document"
          || event.compensatesEventId !== null)) fail();
      const completed = events[0]!, settings = completed.payload.settings as Record<string, unknown> | undefined;
      if (completed.payload.artifact_kind !== "model3d" || completed.payload.source_surface !== "outputs"
        || completed.payload.requested_by_user_id !== owner.ownerId || !settings
        || settings.production_mode !== "manual" || JSON.stringify(settings.output_model3d) !== completionJson) fail();
      const completion = JSON.parse(completionJson) as Record<string, unknown>;
      if (completion.jobId !== owner.jobId || completion.actorUserId !== owner.ownerId
        || completion.documentId !== completed.payload.document_id || completion.artifactId !== completed.payload.artifact_id) fail();
      // Two fixed-width tuples keep SQL bindings below D1's cap. Strings are
      // copied now so later mutation of the writer's EventRows grants nothing.
      const rows = JSON.stringify(events.map(eventWriteBindings));
      if (new TextEncoder().encode(rows).byteLength > 1_000_000) fail();
      const next = Object.freeze({ oldHead, newHead: oldHead + 2, rows });
      if (captured && (captured.oldHead !== next.oldHead || captured.newHead !== next.newHead || captured.rows !== next.rows)) fail();
      captured ??= next;
    },
    assertions(assertions: readonly OutputSqlAssertion[]): OutputSqlAssertion[] {
      const witness = captured;
      if (!witness) return [...assertions];
      return assertions.map(assertion => {
        if (assertion.sql !== MODEL3D_REFERENCE_HEAD_SQL) return assertion;
        const bindings = assertion.bindings;
        if (!bindings || bindings.length !== 2 || bindings[0] !== owner.streamId
          || bindings[1] !== witness.oldHead) return fail();
        return { ...assertion, sql: `(${MODEL3D_REFERENCE_HEAD_SQL}) OR (
          COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?
          AND (SELECT COUNT(*) FROM events WHERE stream_id=? AND sequence>?)=2
          AND (SELECT COUNT(*) FROM json_each(?) expected
            JOIN events stored ON stored.event_id=json_extract(expected.value,'$[0]')
              AND stored.stream_id=json_extract(expected.value,'$[1]') AND stored.sequence=json_extract(expected.value,'$[2]')
              AND stored.occurred_at=json_extract(expected.value,'$[3]') AND stored.recorded_at=json_extract(expected.value,'$[4]')
              AND stored.actor=json_extract(expected.value,'$[5]') AND stored.client_id=json_extract(expected.value,'$[6]')
              AND stored.correlation_id=json_extract(expected.value,'$[7]') AND stored.causation_id IS json_extract(expected.value,'$[8]')
              AND stored.compensates_event_id IS json_extract(expected.value,'$[9]') AND stored.schema_version=json_extract(expected.value,'$[10]')
              AND stored.type=json_extract(expected.value,'$[11]') AND stored.payload=json_extract(expected.value,'$[12]')
            LEFT JOIN event_private_payloads body ON body.private_event_id=stored.event_id
            WHERE (json_extract(expected.value,'$[16]') IS NULL AND body.private_event_id IS NULL)
              OR (json_extract(expected.value,'$[16]') IS NOT NULL AND body.owner_id=json_extract(expected.value,'$[13]')
                AND body.project_id IS json_extract(expected.value,'$[14]') AND body.document_id IS json_extract(expected.value,'$[15]')
                AND body.private_json=json_extract(expected.value,'$[16]') AND body.created_at=stored.recorded_at AND body.redacted_at IS NULL))=2
        )`, bindings: [...bindings, owner.streamId, witness.newHead, owner.streamId, witness.oldHead, witness.rows] };
      });
    },
  };
}
