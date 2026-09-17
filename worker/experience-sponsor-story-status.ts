import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { requireSponsorStoryReadAuthority, type SponsorStoryReadAuthority } from "./experience-sponsor-story-read.ts";
import { takeSponsorStoryIoAttempt, type SponsorStoryIoAttempt } from "./experience-sponsor-story-io-attempts.ts";
import { SponsorStoryReadBudget, sponsorStoryReadEnvironment, sponsorStoryResponseBody } from "./experience-sponsor-story-read-budget.ts";
import { eventColumns, eventCte, eventSnapshot, hostedIdentity, opaque, readNativeRetainedPrincipal, record, selectNative,
  type EventRow } from "./native-retained-text-custody.ts";
import type { WorkerEnv } from "./runtime.ts";

type Row = Record<string, unknown>;
type Status = "queued" | "running" | "committing" | "completed" | "partial" | "failed" | "canceled";
export type SponsorStoryStatus = Readonly<{ jobId: string; documentId: string; status: Status; updatedAt: string;
  remainingBytes: number; monotonicDeadline: number }>;
type ResponseState = { request: Request; env: WorkerEnv; budget: SponsorStoryReadBudget; taken: boolean };
const responses = new WeakMap<SponsorStoryStatus, ResponseState>();
const fail = (code: string): never => { throw new SponsorEntitlementError(`sponsor_story_status_${code}`); };
const ENVELOPE_BYTES = 16_384;
const statuses: readonly unknown[] = ["queued", "running", "committing", "completed", "partial", "failed", "canceled"];

// Closed metadata only. No job request/result, event private_json, authored
// content or provider response is projected or used to infer recovery.
const statusQuery = `SELECT job.status,job.updated_at,job.expires_at,slot.status AS slot_status,execution.status AS grant_status,
  slot.outcome_event_id,
  (SELECT COUNT(*) FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id) AS calls,
  (SELECT COUNT(*) FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id
    AND calls.stage_key='planning:0:initial' AND calls.provider=slot.provider AND calls.model=slot.model
    AND calls.status='settled' AND typeof(calls.used_microusd)='integer' AND calls.used_microusd>=0
    AND calls.used_microusd<=calls.reserved_microusd AND calls.reserved_microusd<=slot.maximum_microusd) AS settled_calls,
  EXISTS(SELECT 1 FROM events completed WHERE completed.event_id=slot.outcome_event_id
    AND completed.stream_id=job.stream_id AND completed.correlation_id=job.correlation_id
    AND completed.type='DocumentRenderCompleted') AS completed_event
  FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
  JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
  WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=?
    AND slot.scope_key=? AND slot.slot_id=? AND job.kind='render_document' AND job.source_surface='outputs'
    AND typeof(job.status)='text' AND length(CAST(job.status AS BLOB))<=32
    AND typeof(job.updated_at)='text' AND length(CAST(job.updated_at AS BLOB))=24
    AND typeof(job.expires_at)='text' AND length(CAST(job.expires_at AS BLOB))=24
    AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND typeof(slot.status)='text' AND length(CAST(slot.status AS BLOB))<=32
    AND typeof(execution.status)='text' AND length(CAST(execution.status AS BLOB))<=32
    AND (slot.outcome_event_id IS NULL OR typeof(slot.outcome_event_id)='text' AND length(CAST(slot.outcome_event_id AS BLOB))<=200)`;
const statusColumns = ["status", "updated_at", "expires_at", "slot_status", "grant_status", "outcome_event_id", "calls", "settled_calls", "completed_event"];
const statusSnapshotSql = `WITH status_candidate AS MATERIALIZED (${statusQuery}), status_snapshot AS (
  SELECT json_group_array(json_object(${statusColumns.flatMap(name => [`'${name}'`, name]).join(",")})) AS snapshot FROM status_candidate)
  SELECT CASE WHEN length(CAST(snapshot AS BLOB))<=4096 THEN snapshot END AS snapshot FROM status_snapshot`;

function currentDocument(rows: EventRow[], documentId: string, projectId: string, ownerId: string) {
  const decoded = rows.map(row => ({ row, payload: record(JSON.parse(row.payload)) ?? fail("history_invalid") }));
  const documents = decoded.filter(({ row, payload }) => ["DocumentCreated", "DocumentForked"].includes(row.type) && payload.document_id === documentId);
  if (documents.length !== 1 || documents[0]!.payload.project_id !== projectId) return fail("document_unavailable");
  const selected = [documents[0]!]; let removed = false;
  for (const entry of decoded.filter(({ row, payload }) => ["DocumentRemoved", "DocumentRestored"].includes(row.type) && payload.document_id === documentId)) {
    if (entry.row.sequence <= documents[0]!.row.sequence || entry.payload.project_id !== undefined && entry.payload.project_id !== projectId)
      return fail("document_unavailable");
    removed = entry.row.type === "DocumentRemoved"; selected.push(entry);
  }
  if (removed) return fail("document_unavailable");
  for (const { row, payload } of selected) {
    if (row.project_scoped || row.secret_redacted !== null) return fail("document_unavailable");
    if (payload._private_ref !== undefined) {
      if (payload._private_ref !== row.event_id || row.secret_id !== row.event_id || row.secret_owner !== ownerId
        || row.secret_document !== documentId || row.secret_project !== projectId) return fail("document_unavailable");
    } else if (row.secret_id !== null) return fail("document_unavailable");
  }
  return decoded;
}

/** Dormant passive status leaf. Importing it enables no route or schema and
 * never starts, resumes, settles or repairs a generation. The attempt includes
 * the actual prior core/IO control bytes; every further read shares its budget. */
export async function resolveSponsorStoryStatus(authority: SponsorStoryReadAuthority, attempt: SponsorStoryIoAttempt,
  request: Request, env: WorkerEnv, additionalControlBytes = 0): Promise<SponsorStoryStatus> {
  const facts = requireSponsorStoryReadAuthority(authority, request, env), database = env.DB;
  const ticket = await takeSponsorStoryIoAttempt(attempt, authority, request, env);
  if (ticket.operation !== "short-story-status") return fail("operation_invalid");
  const current = () => { requireSponsorStoryReadAuthority(authority, request, env); if (env.DB !== database) fail("authority_changed"); };
  const budget = new SponsorStoryReadBudget(ticket.maximumBytes, ticket.monotonicDeadline, request.signal, current);
  budget.spend(ticket.controlBytes);
  // Trusted dispatch may add its actual source-free classification bytes. It
  // cannot replace or reduce the authority/IO charge already carried above.
  budget.spend(additionalControlBytes);
  const identity = hostedIdentity(request);
  if (!identity || identity.userId !== facts.actorUserId) return fail("authority_changed");
  const nativeEnv = sponsorStoryReadEnvironment(env, identity, budget).env;
  const principal = await readNativeRetainedPrincipal(nativeEnv, identity);
  budget.check();
  const history = await nativeEnv.DB.prepare(`WITH ${eventCte} SELECT * FROM event_rows ORDER BY sequence`).bind(facts.streamId).all<EventRow>();
  budget.check();
  const rows = history.results, snapshot = eventSnapshot(rows);
  const decoded = currentDocument(rows, facts.documentId, facts.projectId, facts.actorUserId);
  const bindings = [facts.jobId, facts.actorUserId, facts.streamId, facts.documentId, facts.correlationId, facts.scopeKey, facts.slotId];
  budget.count(1); budget.expect(ENVELOPE_BYTES);
  const metadata = await budget.wait(() => database.prepare(statusSnapshotSql).bind(...bindings).all<Row>());
  budget.account(metadata);
  const raw = metadata.results[0]?.snapshot;
  if (metadata.success !== true || metadata.results.length !== 1 || typeof raw !== "string") return fail("original_unavailable");
  const jobs: unknown = JSON.parse(raw);
  if (!Array.isArray(jobs) || jobs.length !== 1) return fail("original_unavailable");
  const job = record(jobs[0]);
  if (!job || !statuses.includes(job.status) || typeof job.updated_at !== "string" || !Number.isFinite(Date.parse(job.updated_at))
    || typeof job.expires_at !== "string" || !Number.isFinite(Date.parse(job.expires_at)) || job.outcome_event_id !== facts.outcomeEventId
    || !["authorized", "queued", "running", "succeeded", "failed", "cancelled", "unavailable", "uncertain"].includes(String(job.slot_status))
    || !["authorized", "active", "completed", "revoked", "exceeded"].includes(String(job.grant_status))
    || !Number.isSafeInteger(job.calls) || Number(job.calls) < 0 || Number(job.calls) > 1
    || !Number.isSafeInteger(job.settled_calls) || Number(job.settled_calls) < 0 || Number(job.settled_calls) > Number(job.calls)) return fail("original_unavailable");
  if (job.status === "completed") {
    if (job.slot_status !== "succeeded" || job.grant_status !== "completed" || job.calls !== 1 || job.settled_calls !== 1
      || job.completed_event !== 1 || typeof job.outcome_event_id !== "string") return fail("completion_unconfirmed");
    const completed = decoded.find(({ row }) => row.event_id === job.outcome_event_id);
    const artifactId = completed?.payload.artifact_id;
    if (!completed || typeof artifactId !== "string" || !opaque.test(artifactId)) return fail("completion_unconfirmed");
    const edits = decoded.filter(({ row, payload }) => row.type === "DocumentArtifactEdited" && payload.artifact_id === artifactId);
    const native = selectNative(rows, { documentId: facts.documentId, artifactId, revision: edits.length,
      ...(edits.length ? { contentSha256: String(edits.at(-1)!.payload.content_sha256) } : {}) }, facts.actorUserId, job.outcome_event_id);
    if (native.projectId !== facts.projectId) return fail("completion_unconfirmed");
  }
  const comparisons = eventColumns.map((name, index) => `actual.${name} IS NOT json_extract(expected.value,'$[${index}]')`).join(" OR ");
  const nativeFinal = { sql: `WITH ${principal.auth.cte},${eventCte},expected_events AS (SELECT value FROM json_each(?))
    SELECT CASE WHEN EXISTS(SELECT 1 FROM authorized WHERE CAST(auth_json AS BLOB)=CAST(? AS BLOB))
      AND (SELECT COUNT(*) FROM event_rows)=(SELECT COUNT(*) FROM expected_events)
      AND NOT EXISTS(SELECT 1 FROM expected_events expected LEFT JOIN event_rows actual
        ON actual.event_id=json_extract(expected.value,'$[0]') WHERE actual.event_id IS NULL OR ${comparisons}) THEN 1 ELSE 0 END AS current`,
    bindings: [...principal.auth.bindings, facts.streamId, snapshot, principal.principal.auth_json] };
  const assertions = [...ticket.assertions, { sql: `EXISTS(SELECT 1 FROM (${statusSnapshotSql}) WHERE CAST(snapshot AS BLOB)=CAST(? AS BLOB))`, bindings: [...bindings, raw] }];
  if (assertions.length > 64) return fail("proof_capacity");
  budget.count(assertions.length + 1); budget.expect((assertions.length + 1) * ENVELOPE_BYTES);
  const final = await budget.wait(() => database.batch<Row>([
    database.prepare(nativeFinal.sql).bind(...nativeFinal.bindings),
    ...assertions.map(assertion => database.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).bind(...(assertion.bindings ?? []))),
  ]));
  // No awaits after this exact final transaction. Response construction retains
  // this same opaque budget; exposed numeric facts cannot mint another one.
  budget.account(final);
  if (!Array.isArray(final) || final.length !== assertions.length + 1 || Array.from({ length: assertions.length + 1 }, (_, index) => index)
    .some(index => {
      if (!Object.hasOwn(final, index)) return true;
      const result = final[index];
      if (!record(result) || !Object.hasOwn(result, "success") || result.success !== true || !Object.hasOwn(result, "results")
        || !Array.isArray(result.results) || result.results.length !== 1 || !Object.hasOwn(result.results, 0)) return true;
      const row = result.results[0];
      return !record(row) || Object.keys(row).length !== 1 || !Object.hasOwn(row, "current") || row.current !== 1;
    }))
    return fail("final_changed");
  const result = Object.freeze({ jobId: facts.jobId, documentId: facts.documentId, status: job.status as Status,
    updatedAt: job.updated_at, remainingBytes: budget.remainingBytes, monotonicDeadline: budget.monotonicDeadline });
  responses.set(result, { request, env, budget, taken: false }); return result;
}

/** Closed, single-use response serializer. Caller chooses only the existing
 * singular/plural envelope, and must call synchronously after resolution. */
export function sponsorStoryStatusResponse(status: SponsorStoryStatus, request: Request, env: WorkerEnv, shape: "job" | "jobs"): BodyInit {
  const state = responses.get(status);
  if (!state || state.request !== request || state.env !== env || state.taken || !["job", "jobs"].includes(shape)) return fail("response_invalid");
  state.taken = true; state.budget.check();
  const job = { jobId: status.jobId, documentId: status.documentId, kind: "render_document", sourceSurface: "outputs",
    status: status.status, updatedAt: status.updatedAt, result: null,
    sponsoredRead: { version: 1, operation: "short-story-status", passive: true } };
  return sponsorStoryResponseBody(JSON.stringify(shape === "job" ? { job } : { jobs: [job] }), state.budget);
}
