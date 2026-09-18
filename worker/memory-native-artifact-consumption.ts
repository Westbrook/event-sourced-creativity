import { AUTHORING_EVENT_COLUMNS } from "./authoring-event-proof.ts";
import { eventWriteBindings, serializeEvent, type WorkerEnv } from "./runtime.ts";
import { preparePersonalArtifactViewSource } from "./memory-artifact-view.ts";
import type { LiveMemoryAuthority, LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { NativeMemoryContextObserver } from "./memory-live-context.ts";
import type { MemorySqlGuard } from "./memory-sql.ts";
import { memoryCanonical } from "./memory-sql.ts";

const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const browserKeys = ["artifact_id", "artifact_kind", "project_id", "document_id", "artifact_revision", "content_sha256", "source_surface"];
const receiptKeys = [...browserKeys, "artifact_source_event_id", "artifact_content_ref", "observed_source_expires_at", "capture_version"].sort();
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export type NativeArtifactConsumptionSource = {
  eventId: string; sequence: number; recordedAt: string; validUntil: string;
  target: { kind: "artifact"; documentId: string; artifactId: string; artifactKind: string; revision: number; contentSha256: string };
};

/** Candidate/cleanup predicate only. It is NOT a body hash or source-authority
 * certificate. Publication and consumption additionally verify retained bytes
 * with preparePersonalArtifactViewSource and replay its exact native guards. */
export function nativeArtifactMemoryCandidates(e: LiveMemoryEnrollment) {
  const personal = e.organization_id === null && e.project_access_id === null && e.actor_user_id === e.owner_user_id;
  const payload = "secret.private_json";
  return { joins: "FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id",
    condition: `${personal ? "1" : "0"} AND event.type='DocumentArtifactViewed' AND event.stream_id=? AND event.actor=?
      AND (secret.owner_id,secret.project_id,secret.document_id,secret.redacted_at) IS (?,?,?,NULL)
      AND event.compensates_event_id IS NULL AND event.event_id NOT LIKE 'optimistic:%' AND event.client_id NOT LIKE '%optimistic%'
      AND secret.created_at=event.recorded_at AND json_valid(${payload}) AND json_valid(event.payload)
      AND json_extract(event.payload,'$._private_ref')=event.event_id
      AND json_extract(${payload},'$.capture_version')='personal-artifact-view-v2'
      AND json_extract(${payload},'$.project_id')=? AND json_extract(${payload},'$.document_id')=?
      AND event.recorded_at>=? AND event.recorded_at<=${clock}
      AND strftime('%Y-%m-%dT%H:%M:%fZ',event.recorded_at,'+'||?||' days')>${clock}
      AND json_extract(${payload},'$.observed_source_expires_at')>${clock}
      AND EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=json_extract(${payload},'$.artifact_content_ref')
        AND body.owner_id=? AND body.kind='document-artifact' AND body.redacted_at IS NULL AND body.expires_at>${clock})
      AND NOT EXISTS(SELECT 1 FROM events negative WHERE negative.compensates_event_id IN(event.event_id,json_extract(${payload},'$.artifact_source_event_id')))
      AND NOT EXISTS(SELECT 1 FROM project_event_scopes governed WHERE governed.event_id=event.event_id)`,
    bindings: [`creative:${e.owner_user_id}`, `user:${e.actor_user_id}`, e.owner_user_id, e.project_id, e.document_id,
      e.project_id, e.document_id, e.enrolled_at, e.retention_days, e.owner_user_id] };
}

/** Bounded genuine personal observations only. No synthetic backfill of old
 * receipt lifetimes and no historical-revision fallback. A current source that
 * cannot be recertified is omitted with explicit unavailable coverage. */
export async function captureNativeArtifactConsumption(env: WorkerEnv, e: LiveMemoryEnrollment, authority: LiveMemoryAuthority,
  range: { after: number; through: number; remembered: boolean }, observer?: NativeMemoryContextObserver) {
  const db = env.DB, key = memoryCanonical({ e, authority, range }), candidates = nativeArtifactMemoryCandidates(e);
  if (!Number.isSafeInteger(range.after) || range.after < 0 || !Number.isSafeInteger(range.through) || range.through < range.after
    || range.remembered && range.through > e.cursor_sequence) throw new Error("artifact_memory_range_invalid");
  const remembered = range.remembered ? "JOIN memory_live_sources remembered ON remembered.event_id=event.event_id AND remembered.sequence=event.sequence AND remembered.enrollment_id=?" : "";
  const columns = [...AUTHORING_EVENT_COLUMNS, "owner_id", "project_id", "document_id", "private_json", "private_created_at", "redacted_at", ...(range.remembered ? ["remembered_until"] : [])].sort();
  const query = { sql: `SELECT ${AUTHORING_EVENT_COLUMNS.map(name=>`event.${name}`).join(",")},secret.owner_id,secret.project_id,secret.document_id,secret.private_json,
      secret.created_at AS private_created_at,secret.redacted_at${range.remembered ? ",remembered.expires_at AS remembered_until" : ""}
    ${candidates.joins} ${remembered} WHERE ${candidates.condition} AND event.sequence>? AND event.sequence<=?
    ${range.remembered ? `AND remembered.expires_at>${clock}` : ""} ORDER BY event.sequence ${range.remembered ? "DESC" : "ASC"} LIMIT 33`,
  bindings: [...(range.remembered ? [e.enrollment_id] : []), ...candidates.bindings, range.after, range.through] };
  const statement = db.prepare(query.sql).bind(...query.bindings), result = structuredClone(await statement.all<Record<string, unknown>>());
  const current = () => env.DB === db && memoryCanonical({ e, authority, range }) === key;
  if (!current() || result.success !== true || "error" in result && result.error !== undefined || !Array.isArray(result.results)
    || result.results.length > 33 || result.results.some(row => !row || Object.keys(row).sort().join(",") !== columns.join(","))
    || new Set(result.results.map(row => row.event_id)).size !== result.results.length) throw new Error("artifact_memory_read_unavailable");
  const sources: NativeArtifactConsumptionSource[] = [], guards: MemorySqlGuard[] = [];
  const bindings = new Map<string, Awaited<ReturnType<typeof preparePersonalArtifactViewSource>>>();
  let retainedBytes = 0, throughSequence = range.through, truncated = result.results.length > 32;
  if (!range.remembered && result.results.length > 32) throughSequence = Number(result.results[32].sequence) - 1;
  for (const row of result.results.slice(0, 32)) {
    const event = serializeEvent(row), payload = event.payload;
    if (Object.keys(payload).sort().join(",") !== receiptKeys.join(",") || payload.capture_version !== "personal-artifact-view-v2"
      || event.type !== "DocumentArtifactViewed" || event.actor !== `user:${e.actor_user_id}` || event.streamId !== `creative:${e.owner_user_id}`
      || event.compensatesEventId !== null || !timestamp(event.recordedAt) || !timestamp(event.occurredAt)
      || Date.parse(event.occurredAt) > Date.now() || !timestamp(payload.observed_source_expires_at)
      || !Number.isSafeInteger(event.sequence) || event.sequence <= range.after || event.sequence > range.through
      || JSON.stringify(eventWriteBindings(event)) !== JSON.stringify([...AUTHORING_EVENT_COLUMNS.map(name => row[name]), row.owner_id, row.project_id, row.document_id, row.private_json]))
      throw new Error("artifact_memory_receipt_invalid");
    if (typeof payload.source_surface !== "string" || !/^[a-z][a-z-]{0,47}-artifact-gallery$/u.test(payload.source_surface)) throw new Error("artifact_memory_receipt_invalid");
    const input = Object.fromEntries(browserKeys.map(key => [key, payload[key]]));
    // Gallery placement is observation metadata, not a distinct retained source.
    const identity = memoryCanonical(Object.fromEntries(browserKeys.filter(key=>key!=="source_surface").map(key=>[key,payload[key]])));
    let certified = bindings.get(identity);
    if (!certified) {
      if (bindings.size >= 4) {
        truncated = true;
        if (!range.remembered) { throughSequence = event.sequence - 1; break; }
        continue;
      }
      certified = await preparePersonalArtifactViewSource(env, authority.principal, input); bindings.set(identity, certified);
      if (!current()) throw new Error("artifact_memory_source_changed");
      if (!(certified instanceof Response)) {
        if (retainedBytes + certified.bodyBytes > 1_500_000) {
          truncated = true;
          if (!range.remembered) { throughSequence = event.sequence - 1; break; }
          bindings.set(identity, new Response(null, {status:413})); continue;
        }
        retainedBytes += certified.bodyBytes;
        guards.push({ condition: certified.source.sql, bindings: certified.source.bindings });
      }
    }
    if (certified instanceof Response) continue;
    if (certified.payload.artifact_source_event_id !== payload.artifact_source_event_id
      || certified.payload.artifact_content_ref !== payload.artifact_content_ref) continue;
    const until = Math.min(Date.parse(e.expires_at), Date.parse(event.recordedAt) + e.retention_days * 86_400_000,
      Date.parse(payload.observed_source_expires_at), Date.parse(certified.payload.observed_source_expires_at),
      range.remembered && timestamp(row.remembered_until) ? Date.parse(row.remembered_until) : Infinity);
    if (!Number.isFinite(until) || until <= Date.now() || range.remembered && !timestamp(row.remembered_until)) continue;
    sources.push({ eventId: event.eventId, sequence: event.sequence, recordedAt: event.recordedAt, validUntil: new Date(until).toISOString(),
      target: { kind: "artifact", documentId: e.document_id, artifactId: certified.payload.artifact_id,
        artifactKind: certified.payload.artifact_kind, revision: Number(certified.payload.artifact_revision), contentSha256: certified.payload.content_sha256 } });
  }
  // Freeze even the empty/omitted selection. Newly appearing or withdrawn native
  // rows cannot silently change the reported coverage during final delivery.
  const exact = { condition: `(SELECT json_group_array(json(value)) FROM (SELECT json_object(${columns.map(name => `'${name}',"${name}"`).join(",")}) AS value FROM (${query.sql})))=?`,
    bindings: [...query.bindings, JSON.stringify(result.results.map(row => Object.fromEntries(columns.map(key => [key, row[key]]))))] };
  if (!result.results.length) {
    exact.condition = `(SELECT COUNT(*) FROM (${query.sql}))=0`; exact.bindings = query.bindings;
  }
  if (!current()) throw new Error("artifact_memory_source_changed");
  if (observer) { observer.observe([statement], [result], [query]); guards.forEach(guard => observer.require({ sql: guard.condition, bindings: [...guard.bindings] })); }
  return { sources, guards: [exact, ...guards], candidateCount: Math.min(result.results.length, 32), throughSequence,
    unavailableSourceCount: Math.min(result.results.length, 32) - sources.length, truncated };
}
