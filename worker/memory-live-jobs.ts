import { registerNativeChatStudioDerivationBacklog, nativeChatStudioMemoryCandidates } from "./memory-derivation-chat-delivery.ts";
import { prepareNativeDerivationDelivery, registerNativeDerivationBacklog } from "./memory-derivation-jobs.ts";
import { createLiveMemoryMaintenanceAttempt, liveMemoryAuthority, liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { liveMemorySourceQuery } from "./memory-live-sources.ts";
import { liveMemoryEnabled, liveMemorySchemaReady, memoryAtomic, memorySqlAssertion, revokeLiveMemoryCounted, retireDeniedLiveMemoryCounted, liveMemoryOriginDependencyWithdrawalStatements, structuredConversationLedgerSchema } from "./memory-live-store.ts";
import { memoryGuardsCurrent, type MemorySqlGuard } from "./memory-sql.ts";
import type { WorkerEnv } from "./runtime.ts";
import { liveConversationPublication, liveConversationMarkPublished, liveConversationPrune, liveConversationTrim } from "./memory-live-conversation.ts";
import { publishCompletedConversationReferences, type CompletedConversationCaptureResult } from "./memory-completed-turns.ts";
import { prepareLiveMemoryCheckpoint } from "./memory-live-checkpoints.ts";
import { captureNativeArtifactConsumption, nativeArtifactMemoryCandidates } from "./memory-native-artifact-consumption.ts";

export const LIVE_MEMORY_PAGE_SIZE=128;
export const LIVE_MEMORY_RUNNING_LIMIT=8;
const pruneRuns=(env:WorkerEnv)=>env.DB.prepare("DELETE FROM memory_live_runs WHERE status!='running' AND run_id IN(SELECT run_id FROM memory_live_runs WHERE status!='running' ORDER BY started_at DESC,run_id DESC LIMIT -1 OFFSET 128)");
export function liveMemoryNight(now:string,timeZone:string) {
  const fields=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",hourCycle:"h23"})
    .formatToParts(new Date(now)).map(part=>[part.type,part.value]));
  return {day:`${fields.year}-${fields.month}-${fields.day}`,open:Number(fields.hour)>=1&&Number(fields.hour)<5};
}
/** Late invocations catch up the most recent night; a fixed hourly rotation cannot strand daytime scopes. */
export function liveMemoryReviewDay(now:string,timeZone:string,enrolledAt:string) {
  const parts=(value:string)=>Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",hourCycle:"h23"})
    .formatToParts(new Date(value)).map(part=>[part.type,part.value]));
  const current=parts(now),enrolled=parts(enrolledAt),today=`${current.year}-${current.month}-${current.day}`;
  const day=Number(current.hour)<1?new Date(Date.parse(today+"T12:00:00Z")-86_400_000).toISOString().slice(0,10):today;
  const enrolledDay=`${enrolled.year}-${enrolled.month}-${enrolled.day}`;
  return {day,due:enrolledDay<day || enrolledDay===day&&Number(enrolled.hour)<5};
}
const at=(now:string,ms:number)=>new Date(Date.parse(now)+ms).toISOString();
const leaseGuard=(e:LiveMemoryEnrollment):MemorySqlGuard=>({condition:`EXISTS(SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=? AND revision=?
  AND lease_token=? AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND cursor_sequence=? AND cutoff_sequence IS ?)`,
  bindings:[e.enrollment_id,e.revision,e.lease_token,e.cursor_sequence,e.cutoff_sequence]});

async function processScope(env:WorkerEnv,e:LiveMemoryEnrollment,now:string,erased:(count:number)=>void,
  captureResult:(result:CompletedConversationCaptureResult)=>void) {
  if(Date.parse(e.expires_at)<=Date.parse(now) || !e.learn_enabled&&!e.recall_enabled){
    const result=await revokeLiveMemoryCounted(env,e,"expired-or-disabled");if(!result.revoked)throw new Error("memory-revocation-raced");
    erased(result.erased);return 0;
  }
  const authority=await liveMemoryAuthority(env,e);
  if(!authority||!await memoryGuardsCurrent(env.DB,[authority.guard])){
    // A nullable read or failed positive guard is not destructive authority.
    // Resolve fresh evidence; restored access skips this attempt, unavailable
    // evidence remains a failure, and only certified denial may retire data.
    const attempt=createLiveMemoryMaintenanceAttempt(env),decision=await attempt.resolve(e);
    if(decision.status==="unavailable")throw new Error("memory-maintenance-unavailable");
    if(decision.status==="current")return 0;
    const result=await retireDeniedLiveMemoryCounted(env,e,attempt,decision.certificate);
    erased(result.erased);return 0;
  }
  const q=liveMemorySourceQuery(e,authority),policy=liveMemoryEnrollmentGuard(e);
  const artifactCandidates=nativeArtifactMemoryCandidates(e),chatCandidates=nativeChatStudioMemoryCandidates(e);
  const cleanup=liveConversationPrune(e.enrollment_id,e.revision),trim=liveConversationTrim(e.enrollment_id);
  const originMaintenance=await liveMemoryOriginDependencyWithdrawalStatements(env,
    {enrollmentId:e.enrollment_id,currentRevision:e.revision},"source-unavailable",now);
  // Remove unavailable references even when learning is paused. No private bodies are hydrated.
  // A CTE keeps the exact source predicate out of nested DELETE/EXISTS expressions (D1 depth <=100).
  const maintenance=await memoryAtomic(env,[authority.guard,policy],[...originMaintenance.beforeMutation,env.DB.prepare(`WITH tracked AS (
    SELECT event_id,sequence FROM memory_live_sources WHERE enrollment_id=?), eligible AS (
    SELECT event.event_id ${q.joins} JOIN tracked candidate ON candidate.event_id=event.event_id AND candidate.sequence=event.sequence WHERE ${q.condition}
    UNION SELECT event.event_id ${artifactCandidates.joins} JOIN tracked candidate ON candidate.event_id=event.event_id AND candidate.sequence=event.sequence
      WHERE ${artifactCandidates.condition}
    UNION SELECT event.event_id ${chatCandidates.joins} JOIN tracked candidate ON candidate.event_id=event.event_id AND candidate.sequence=event.sequence
      WHERE ${chatCandidates.condition})
    DELETE FROM memory_live_sources
    WHERE enrollment_id=? AND event_id IN(SELECT expired.event_id FROM memory_live_sources expired
      WHERE expired.enrollment_id=? AND (expired.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        OR expired.event_id NOT IN(SELECT event_id FROM eligible)) LIMIT 128)`)
    .bind(e.enrollment_id,...q.bindings,...artifactCandidates.bindings,...chatCandidates.bindings,e.enrollment_id,e.enrollment_id),env.DB.prepare("SELECT changes() AS erased"),
    env.DB.prepare(cleanup.sql).bind(...cleanup.bindings),env.DB.prepare(trim.sql).bind(...trim.bindings),...originMaintenance.afterMutation]);
  // Cleanup is already committed, even if later capture or bookkeeping fails.
  erased(Number((maintenance[originMaintenance.beforeMutation.length+1]?.results[0] as {erased:number}|undefined)?.erased??0));
  // Queue delivery has its own durable consent cursor. Catch up even when the
  // extractive night/page was already acknowledged or its checkpoint expired.
  await registerNativeDerivationBacklog(env,e,now);
  await registerNativeChatStudioDerivationBacklog(env,e);
  const night=liveMemoryReviewDay(now,e.time_zone,e.enrolled_at);
  const continueJob=e.cutoff_sequence!==null;
  if(!liveMemoryEnabled(env,e.actor_user_id)||!e.learn_enabled||!e.background_enabled||!continueJob&&(!night.due||e.last_local_day===night.day
    || e.last_admitted_at!==null&&Date.parse(now)-Date.parse(e.last_admitted_at)<20*3_600_000)){
    await env.DB.prepare(`UPDATE memory_live_enrollments SET next_due_at=?,lease_token=NULL,lease_expires_at=NULL
      WHERE enrollment_id=? AND revision=? AND lease_token IS ?
      AND (lease_expires_at IS NULL OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(at(now,3_600_000),e.enrollment_id,e.revision,e.lease_token).run();return 0;
  }
  if(e.lease_token&&Date.parse(e.lease_expires_at??"")>Date.parse(now))return 0;
  if(e.attempts>=3){
    const parked=await env.DB.prepare("UPDATE memory_live_enrollments SET cutoff_sequence=NULL,lease_token=NULL,lease_expires_at=NULL,attempts=0,failure_code='attempt-limit',next_due_at=? WHERE enrollment_id=? AND revision=? AND lease_token IS ?")
      .bind(at(now,86_400_000),e.enrollment_id,e.revision,e.lease_token).run();
    // Parking is bounded failure recovery, not successful refresh. Outer bookkeeping preserves the future due time.
    throw new Error(Number(parked.meta.changes??0)===1?"memory-attempt-limit":"memory-attempt-limit-raced");
  }
  const head=continueJob?e.cutoff_sequence!:(await env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(`creative:${e.owner_user_id}`).first<{head:number}>())!.head;
  let referenceCapture=false,captureSchemaUnavailable=false;
  if(e.recall_enabled===1)try{referenceCapture=(await structuredConversationLedgerSchema(env)).referenceCapture;}
  catch{captureSchemaUnavailable=true;captureResult({status:"unavailable"});}
  // Installing the explicit candidate can make already-reviewed native turns
  // eligible for first capture. The extractive cursor is not a ledger cursor.
  if(head<=e.cursor_sequence&&!referenceCapture){
    await env.DB.prepare(`UPDATE memory_live_enrollments SET next_due_at=?${captureSchemaUnavailable?",failure_code='conversation-schema-unavailable'":""}
      WHERE enrollment_id=? AND revision=? AND lease_token IS NULL`).bind(at(now,3_600_000),e.enrollment_id,e.revision).run();return 0;
  }
  if(head<e.cursor_sequence)throw new Error("memory-source-head-regressed");
  const token=crypto.randomUUID(),expires=at(now,60_000),clock:MemorySqlGuard={condition:"julianday('now')>=julianday(?) AND julianday('now')<julianday(?)",bindings:[now,expires]};
  const acquired=await memoryAtomic(env,[authority.guard,liveMemoryEnrollmentGuard(e,"learn"),clock],[env.DB.prepare(`UPDATE memory_live_enrollments SET lease_token=?,lease_expires_at=?,attempts=attempts+1,
    cutoff_sequence=?,last_local_day=?,last_admitted_at=?,next_due_at=? WHERE enrollment_id=? AND revision=? AND cursor_sequence=?
    AND cutoff_sequence IS ? AND last_local_day IS ? AND lease_token IS ? AND (lease_expires_at IS NULL OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .bind(token,expires,head,continueJob?e.last_local_day:night.day,continueJob?e.last_admitted_at:now,expires,e.enrollment_id,e.revision,e.cursor_sequence,e.cutoff_sequence,e.last_local_day,e.lease_token)]);
  if(Number(acquired[0]?.meta.changes??0)!==1)return 0;
  const leased={...e,lease_token:token,lease_expires_at:expires,cutoff_sequence:head},lease=leaseGuard(leased);
  try {
    let conversationFailure:string|null=captureSchemaUnavailable?"conversation-schema-unavailable":null;
    if(referenceCapture){
      // Capture the actual full post-lease enrollment, not a guessed derivative
      // with stale last-admitted/attempt fields. Append reasserts every field.
      const current=await env.DB.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=? AND revision=? AND lease_token=?")
        .bind(e.enrollment_id,e.revision,token).first<LiveMemoryEnrollment>();
      if(!current)throw new Error("memory-conversation-enrollment-unavailable");
      const captured=await publishCompletedConversationReferences(env,current,head);captureResult(captured);
      // A separate bounded producer must not stall existing extractive learning.
      // Its ledger has no cursor exemption: the next eligible review retries from
      // original native sources even if this legacy source cursor has advanced.
      if(captured.status==="unavailable"||captured.status==="capacity")conversationFailure="conversation-"+captured.status;
    }
    const page=await env.DB.prepare("SELECT sequence FROM events WHERE stream_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?")
      .bind(`creative:${e.owner_user_id}`,e.cursor_sequence,head,LIVE_MEMORY_PAGE_SIZE).all<{sequence:number}>();
    const pageThrough=page.results.at(-1)?.sequence??head;
    const artifactViews=await captureNativeArtifactConsumption(env,e,authority,{after:e.cursor_sequence,through:pageThrough,remembered:false});
    const through=artifactViews.throughSequence,done=through>=head;
    const conversation=liveConversationPublication(e,q,through,now);
    const conversationMarked=liveConversationMarkPublished(e,through);
    // Maintenance already committed. Publication needs a fresh full-header
    // snapshot, never the inverse prepared for that earlier transaction.
    const originPublication=await liveMemoryOriginDependencyWithdrawalStatements(env,
      {enrollmentId:e.enrollment_id,currentRevision:e.revision},"source-unavailable",now);
    const checkpoint=await prepareLiveMemoryCheckpoint(env,e,through,now);
    const delivery=await prepareNativeDerivationDelivery(env,e,through,now);
    // Selection and publication occur in the SAME database transaction. Only references cross the boundary.
    const publication:D1PreparedStatement[]=[
      ...originPublication.beforeMutation,
      env.DB.prepare(`INSERT OR IGNORE INTO memory_live_sources(enrollment_id,event_id,sequence,expires_at)
        SELECT ?,event.event_id,event.sequence,MIN(?,strftime('%Y-%m-%dT%H:%M:%fZ',event.recorded_at,'+'||?||' days'))
        ${q.joins} WHERE ${q.condition} AND event.sequence>? AND event.sequence<=?`)
        .bind(e.enrollment_id,e.expires_at,e.retention_days,...q.bindings,e.cursor_sequence,through),
      ...artifactViews.sources.map(source=>env.DB.prepare(`INSERT INTO memory_live_sources(enrollment_id,event_id,sequence,expires_at)
        VALUES(?,?,?,?) ON CONFLICT(enrollment_id,event_id) DO UPDATE SET expires_at=MIN(memory_live_sources.expires_at,excluded.expires_at)
        WHERE memory_live_sources.sequence=excluded.sequence`).bind(e.enrollment_id,source.eventId,source.sequence,source.validUntil)),
      ...(artifactViews.sources.length?[memorySqlAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
        SELECT 1 FROM memory_live_sources retained WHERE retained.enrollment_id=? AND retained.event_id=json_extract(expected.value,'$.eventId')
          AND retained.sequence=json_extract(expected.value,'$.sequence') AND retained.expires_at<=json_extract(expected.value,'$.validUntil')
          AND retained.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
        bindings:[JSON.stringify(artifactViews.sources.map(({eventId,sequence,validUntil})=>({eventId,sequence,validUntil}))),e.enrollment_id]})]:[]),
      env.DB.prepare(conversation.sql).bind(...conversation.bindings),
      env.DB.prepare(conversationMarked.sql).bind(...conversationMarked.bindings),
      env.DB.prepare(trim.sql).bind(...trim.bindings),
      // A cap-evicted segment invalidates every origin that required its exact
      // membership, even though some individual references remain remembered.
      ...originPublication.afterMutation,
      ...checkpoint.writes,
    ];
    const deliveryOffset=publication.length;
    publication.push(...delivery.statements,
      env.DB.prepare(`UPDATE memory_live_enrollments SET cursor_sequence=?,cutoff_sequence=?,lease_token=NULL,lease_expires_at=NULL,
        attempts=0,failure_code=?,next_due_at=? WHERE enrollment_id=? AND revision=? AND lease_token=?`)
        .bind(through,done?null:head,conversationFailure,at(now,done?3_600_000:60_000),e.enrollment_id,e.revision,token),
      memorySqlAssertion(env,{condition:"changes()=1",bindings:[]}),
    );
    const writes=await memoryAtomic(env,[authority.guard,liveMemoryEnrollmentGuard(e,"learn"),lease,checkpoint.guard,...artifactViews.guards],publication,
      [authority.guard,liveMemoryEnrollmentGuard(e,"learn"),clock,checkpoint.guard,...artifactViews.guards]);
    if(!delivery.acknowledge(writes.slice(deliveryOffset,deliveryOffset+delivery.statements.length)))throw new Error("memory-derivation-delivery-unconfirmed");
    return Number(writes[originPublication.beforeMutation.length]?.meta.changes??0)+artifactViews.sources.length;
  } catch {
    await env.DB.prepare("UPDATE memory_live_enrollments SET lease_token=NULL,lease_expires_at=NULL,next_due_at=?,failure_code='review-failed' WHERE enrollment_id=? AND revision=? AND lease_token=?")
      .bind(at(now,60_000*Math.min(8,2**e.attempts)),e.enrollment_id,e.revision,token).run();
    throw new Error("memory-review-failed");
  }
}

/** Callable by the platform's authenticated scheduled event, never a browser or unauthenticated HTTP trigger. */
export async function runLiveMemoryScheduled(env:WorkerEnv) {
  // Availability and enrollment do not authorize scheduled memory work.
  if(env.FORMA_MEMORY_SCHEDULING_ENABLED!=="true")return {status:"scheduling-disabled"};
  if(!await liveMemorySchemaReady(env,true))return {status:"schema-unavailable"};
  const now=new Date().toISOString(),runId=crypto.randomUUID();
  // Recover abandoned receipts BEFORE admitting new work. Finalization failures cannot grow the running set without bound.
  const admitted=await env.DB.batch([
    env.DB.prepare("UPDATE memory_live_runs SET status='interrupted',finished_at=? WHERE status='running' AND started_at<?").bind(now,at(now,-900_000)),
    pruneRuns(env),
    env.DB.prepare(`INSERT INTO memory_live_runs(run_id,trigger_kind,status,started_at)
      SELECT ?,'scheduled','running',? WHERE (SELECT COUNT(*) FROM(SELECT 1 FROM memory_live_runs WHERE status='running' LIMIT ?))<?`)
      .bind(runId,now,LIVE_MEMORY_RUNNING_LIMIT,LIVE_MEMORY_RUNNING_LIMIT),
  ]);
  if(Number(admitted[2]?.meta.changes??0)!==1)return {status:"deferred",reason:"running-receipt-capacity"};
  let processed=0,erased=0,failed=0,scopes=0;
  const conversationCaptures:CompletedConversationCaptureResult[]=[];
  // One due scope bounds this subsystem's work; the host must also budget other scheduled subsystems.
  // Late nights are caught up, not dropped. Host cadence/capacity must be qualified for timely delivery.
  try{
    const due=await env.DB.prepare("SELECT * FROM memory_live_enrollments WHERE next_due_at<=? ORDER BY next_due_at,enrollment_id LIMIT 1").bind(now).all<LiveMemoryEnrollment>();
    scopes=due.results.length;
    for(const scope of due.results){try{
      const captureStart=conversationCaptures.length;
      processed+=await processScope(env,scope,now,count=>{erased+=count;},result=>conversationCaptures.push(result));
      if(conversationCaptures.slice(captureStart).some(result=>result.status==="unavailable"||result.status==="capacity"))failed++;
    }catch{
      failed++;
      // Even failed bookkeeping must not bypass the run receipt finalization attempt.
      try{await env.DB.prepare("UPDATE memory_live_enrollments SET next_due_at=? WHERE enrollment_id=? AND revision=? AND next_due_at<=?")
        .bind(at(now,60_000),scope.enrollment_id,scope.revision,now).run();}catch{ /* The run stays partial; its next invocation rechecks native authority. */ }
    }}
  }catch{failed++;}
  const finished=await env.DB.batch([
    env.DB.prepare("UPDATE memory_live_runs SET status=?,finished_at=?,scopes=?,processed=?,erased=?,failed=? WHERE run_id=? AND status='running'")
      .bind(failed?"partial":"completed",new Date().toISOString(),scopes,processed,erased,failed,runId),
    pruneRuns(env),
  ]);
  if(Number(finished[0]?.meta.changes??0)!==1)throw new Error("memory-run-finalization-unconfirmed");
  return {status:failed?"partial":"completed",runId,scopes,processed,erased,failed,...(conversationCaptures.length?{conversationCaptures}:{})};
}
