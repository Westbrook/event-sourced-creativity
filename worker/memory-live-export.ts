import { memoryEventAction } from "../src/model/memory-observations.ts";
import { liveMemoryAuthority, liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { LIVE_MEMORY_EVENT_TYPES, liveMemorySourceQuery } from "./memory-live-sources.ts";
import { liveMemoryEnabled } from "./memory-live-store.ts";
import { memoryAssert, memoryGuardQuery, type MemorySqlGuard } from "./memory-sql.ts";
import { nativeMemoryGrantDeadline, nativeMemoryPilotQuery, nativeMemoryPilotDeadline } from "./memory-native-deadlines.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { PilotUser } from "./pilot-policy.ts";
import { liveMemoryLifetimeProjection, liveMemorySourceDeadline } from "./memory-live-source-lifetime.ts";
import { nativeMemoryOriginSourceExclusion } from "./memory-native-origin.ts";

const SOURCE_LIMIT = 64;
const BYTE_LIMIT = 65_536;
const DAY = 86_400_000;
type ExportRow = { event_id:string; sequence:number; type:string; recorded_at:string; block_id:string|null; remembered_expires_at:string; lifetime_json:string };
type ExportSource = { eventId:string; sequence:number; type:string; blockId:string|null; recordedAt:string; retentionExpiresAt:string };
const boundedId = (value:unknown):value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
const instant = (value:unknown):number => typeof value === "string" ? Date.parse(value) : Number.NaN;
/** A reference export is a certified point-in-time disclosure, never a reusable access grant. */
export async function exportLiveMemory(env:WorkerEnv,input:LiveMemoryEnrollment,requestPrincipal:PilotUser):Promise<Response> {
  // Own the request before any asynchronous authority or source read.
  const { enrollment:e,principal } = structuredClone({enrollment:input,principal:requestPrincipal});
  const startedAt = Date.now();
  memoryAssert(principal&&!principal.fictional&&principal.authorizationSnapshot
    &&principal.userId===e.actor_user_id&&principal.access.permissionEpoch===e.permission_epoch,"memory-export-invalid-request-authority");
  const requestGrantDeadline = nativeMemoryGrantDeadline(principal,startedAt);
  memoryAssert(requestGrantDeadline!==undefined,"memory-export-invalid-request-authority");
  memoryAssert([e.enrollment_id,e.actor_user_id,e.owner_user_id,e.project_id,e.document_id,e.permission_epoch,e.policy_version].every(boundedId)
    && [e.organization_id,e.project_access_id].every(value => value === null || boundedId(value))
    && Number.isSafeInteger(e.revision) && e.revision > 0 && e.recall_enabled === 1
    && Number.isSafeInteger(e.retention_days) && e.retention_days >= 1 && e.retention_days <= 365
    && Number.isSafeInteger(e.cursor_sequence) && e.cursor_sequence >= 0
    && (e.cutoff_sequence === null || Number.isSafeInteger(e.cutoff_sequence) && e.cutoff_sequence >= e.cursor_sequence)
    && Number.isFinite(instant(e.enrolled_at)) && instant(e.enrolled_at) <= startedAt && instant(e.expires_at) > startedAt,
  "memory-export-enrollment-unavailable");
  memoryAssert(liveMemoryEnabled(env,e.actor_user_id),"memory-disabled");
  const authority = await liveMemoryAuthority(env,e);
  memoryAssert(authority,"memory-access-changed");
  const q = liveMemorySourceQuery(e,authority!);
  const originalGrantDeadline = nativeMemoryGrantDeadline(authority!.principal,startedAt);
  memoryAssert(originalGrantDeadline !== undefined,"memory-export-invalid-authority");
  const grantDeadline = Math.min(
    originalGrantDeadline === null ? Number.POSITIVE_INFINITY : instant(originalGrantDeadline),
    requestGrantDeadline === null ? Number.POSITIVE_INFINITY : instant(requestGrantDeadline));
  const configuredPilot = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
  const breakglass = (env.FORMA_ADMIN_EMAILS ?? "").split(",").some(value => value.trim().toLowerCase() === authority!.principal.email.toLowerCase());
  // Capture original cohort starts/ends; a later read must not erase a crossed transition.
  const pilot = configuredPilot && !breakglass ? nativeMemoryPilotQuery(configuredPilot) : null;
  const pilotQuery = pilot ? env.DB.prepare(pilot.sql).bind(...pilot.bindings)
    : env.DB.prepare("SELECT NULL AS cohort_id,NULL AS starts_at,NULL AS ends_at WHERE 0");
  const originTablePresent = Boolean(await env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins'").first());
  // Cursor and retention metadata must describe the SAME admitted snapshot as the rows.
  const enrollmentSnapshot:MemorySqlGuard = {
    condition:`EXISTS(SELECT 1 FROM memory_live_enrollments enrollment WHERE
      (enrollment.enrollment_id,enrollment.actor_user_id,enrollment.owner_user_id,enrollment.organization_id,enrollment.project_access_id,
       enrollment.project_id,enrollment.document_id,enrollment.revision,enrollment.permission_epoch,enrollment.policy_version,
       enrollment.recall_enabled,enrollment.retention_days,enrollment.enrolled_at,enrollment.expires_at,enrollment.cursor_sequence,enrollment.cutoff_sequence)
      IS (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?))
      AND (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins')=?`,
    bindings:[e.enrollment_id,e.actor_user_id,e.owner_user_id,e.organization_id,e.project_access_id,e.project_id,e.document_id,
      e.revision,e.permission_epoch,e.policy_version,e.recall_enabled,e.retention_days,e.enrolled_at,e.expires_at,e.cursor_sequence,e.cutoff_sequence,originTablePresent?1:0],
  };
  const guards = [authority!.guard,liveMemoryEnrollmentGuard(e,"recall"),enrollmentSnapshot];
  const sourceSql = `SELECT event.event_id,event.sequence,event.type,event.recorded_at,
      json_extract(event.payload,'$.block_id') AS block_id,remembered.expires_at AS remembered_expires_at,${liveMemoryLifetimeProjection()}
    ${q.joins} JOIN memory_live_sources remembered ON remembered.enrollment_id=?
      AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence
    WHERE ${q.condition} AND remembered.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND ${nativeMemoryOriginSourceExclusion(originTablePresent)}
      AND event.sequence<=? ORDER BY event.sequence DESC LIMIT ${SOURCE_LIMIT + 1}`;
  const sourceBindings = [...q.bindings.slice(0,6),e.enrollment_id,...q.bindings.slice(6),e.cursor_sequence];
  async function snapshot() {
    type PilotBoundary = {cohort_id:string;organization_id:string;status:string;starts_at:string;ends_at:string};
    const results = await env.DB.batch<ExportRow|{verified:number}|{checked_at:string}|PilotBoundary>([
      ...guards.map(guard => memoryGuardQuery(env.DB,guard)),
      env.DB.prepare(sourceSql).bind(...sourceBindings),
      pilotQuery,
      env.DB.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS checked_at"),
      ...guards.map(guard => memoryGuardQuery(env.DB,guard)),
    ]);
    memoryAssert(results.length === 9 && results.every(result => result.success)
      && [0,1,2,6,7,8].every(index => (results[index].results[0] as {verified:number})?.verified === 1),"memory-access-changed");
    const checkedAt = (results[5].results[0] as {checked_at:string})?.checked_at;
    const now = instant(checkedAt),rows = results[3].results as ExportRow[];
    memoryAssert(Number.isFinite(now) && now >= startedAt - 1_000 && now < instant(e.expires_at)
      && Array.isArray(rows) && rows.length <= SOURCE_LIMIT + 1,"memory-export-invalid-snapshot");
    const pilotRows = results[4].results as PilotBoundary[];
    memoryAssert(Array.isArray(pilotRows) && pilotRows.length <= 128,"memory-export-invalid-authority");
    memoryAssert(pilot !== null || pilotRows.length === 0,"memory-export-invalid-authority");
    const pilotDeadline = pilot ? nativeMemoryPilotDeadline(pilotRows,configuredPilot,now) : null;
    memoryAssert(pilotDeadline !== undefined,"memory-export-invalid-authority");
    const authorityDeadline = Math.min(grantDeadline,pilotDeadline === null ? Number.POSITIVE_INFINITY : instant(pilotDeadline));
    const pilotSnapshot = pilotRows.map(row => ({cohortId:row.cohort_id,organizationId:row.organization_id,status:row.status,
      startsAt:row.starts_at,endsAt:row.ends_at}));
    let sourceDeadline = instant(e.expires_at);
    const lifetimes:string[] = [];
    const ids = new Set<string>();let previous = Number.POSITIVE_INFINITY;
    const sources:ExportSource[] = rows.map(row => {
      memoryAssert(typeof row.lifetime_json === "string" && row.lifetime_json.length <= 4_096,"memory-export-invalid-source");
      const deadline = liveMemorySourceDeadline(row,e,now);
      memoryAssert(deadline !== null,"memory-export-invalid-source");
      sourceDeadline = Math.min(sourceDeadline,instant(deadline));lifetimes.push(row.lifetime_json);
      const recorded = instant(row.recorded_at),remembered = instant(row.remembered_expires_at);
      const expiry = Math.min(remembered,recorded + e.retention_days * DAY,instant(e.expires_at));
      memoryAssert(boundedId(row.event_id) && !ids.has(row.event_id) && Number.isSafeInteger(row.sequence)
        && row.sequence > 0 && row.sequence <= e.cursor_sequence && row.sequence < previous
        && (LIVE_MEMORY_EVENT_TYPES as readonly string[]).includes(row.type)
        && (row.block_id === null || boundedId(row.block_id)) && Number.isFinite(recorded)
        && recorded >= instant(e.enrolled_at) && recorded <= now && Number.isFinite(expiry) && expiry > now,
      "memory-export-invalid-source");
      ids.add(row.event_id);previous = row.sequence;
      return {eventId:row.event_id,sequence:row.sequence,type:row.type,blockId:row.block_id,
        recordedAt:new Date(recorded).toISOString(),retentionExpiresAt:new Date(expiry).toISOString()};
    });
    return {checkedAt:new Date(now).toISOString(),sources,lifetimes,pilotSnapshot,validUntil:Math.min(sourceDeadline,authorityDeadline)};
  }
  const captured = await snapshot();
  const signature = (value:Awaited<ReturnType<typeof snapshot>>) => JSON.stringify([value.sources,value.lifetimes,value.pilotSnapshot]);
  const sourceSnapshot = signature(captured);
  const selected = captured.sources.slice(0,SOURCE_LIMIT).reverse();
  const body = JSON.stringify({format:"forma-memory-reference-export-v1",capturedAt:captured.checkedAt,
    enrollment:{id:e.enrollment_id,revision:e.revision,policyVersion:e.policy_version,retentionDays:e.retention_days,expiresAt:e.expires_at},
    scope:{organizationId:e.organization_id,projectId:e.project_id,documentId:e.document_id},
    treatment:"untrusted-historical-evidence",method:"descriptive-source-references",
    deadlineSemantics:"retention-upper-bounds-not-an-access-lease",
    coverage:{since:new Date(Math.max(instant(e.enrolled_at),instant(captured.checkedAt) - e.retention_days * DAY)).toISOString(),
      throughSequence:e.cursor_sequence,remainingThroughSequence:e.cutoff_sequence,completeFromStart:false,bounded:true,
      sourceLimit:SOURCE_LIMIT,sourceCount:selected.length,moreEligibleSources:captured.sources.length > SOURCE_LIMIT},
    sources:selected.map(source => ({...source,action:source.type === "AssistantReasoned" ? "conversation" : memoryEventAction(source.type)})),
    includes:{prose:false,vectors:false,inferredPreferences:false,completeHistory:false},
  },null,2) + "\n";
  memoryAssert(new TextEncoder().encode(body).byteLength <= BYTE_LIMIT,"memory-export-too-large");
  const response = new Response(body,{headers:{"content-type":"application/json; charset=utf-8",
    "content-disposition":"attachment; filename=\"forma-memory-references.json\"","cache-control":"private, no-store",
    "vary":"Cookie, oai-authenticated-user-id, oai-authenticated-user-email","x-content-type-options":"nosniff"}});
  // Serialize first, then recheck native source eligibility and the current enrollment revision.
  // There is no asynchronous work after this final certification, and no mutation or persistence.
  const current = await snapshot();
  memoryAssert(signature(current) === sourceSnapshot && liveMemoryEnabled(env,e.actor_user_id)
    && Math.min(captured.validUntil,current.validUntil) > Date.now(),
  "memory-export-source-changed");
  return response;
}
