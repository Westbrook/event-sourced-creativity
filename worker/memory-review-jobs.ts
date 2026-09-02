import { createMemoryScopeGraph, memoryScopeGrant, memoryTime } from "../src/model/scoped-memory.ts";
import { planMemoryReview, type MemoryReviewPlan } from "./memory-shadow.ts";
import { MemorySourceAdapter, type MemoryIdentity } from "./memory-source-adapter.ts";
import { MemoryShadowStore } from "./memory-store.ts";
import { deriveMemoryReview, MEMORY_REVIEW_RECIPE, type MemoryReviewDeriver } from "./memory-review-recipe.ts";
import { MemoryBoundaryError, memoryAssert, memoryCanonical, memoryGuardQuery, memoryGuardsCurrent,
  type MemoryDatabase, type MemoryPublicationCoordination, type MemorySqlGuard } from "./memory-sql.ts";

const SCOPE = "actor_user_id=? AND custodian_id=? AND scope_id=? AND recipe_version=?";
const ACTIVE = "status IN ('queued','running','retry')";
type Schedule = { actor_user_id:string; custodian_id:string; scope_id:string; recipe_version:string; time_zone:string;
  review_enabled:number; revision:number; registered_at:string; last_admitted_at:string|null; last_local_day:string|null;
  next_maintenance_at:string };
type ScopeRow = Pick<Schedule,"actor_user_id"|"custodian_id"|"scope_id"|"recipe_version">;
type Job = ScopeRow & { job_id:string; plan_json:string; local_day:string; schedule_revision:number;
  status:"queued"|"running"|"retry"|"completed"|"cancelled"|"failed"; attempts:number; max_attempts:number; available_at:string;
  admitted_at:string; updated_at:string; finished_at:string|null; lease_token:string|null; lease_expires_at:string|null; failure_code:string|null };
type LeaseState = { job:Job; startedAt:string };
export type MemoryReviewLease = Readonly<{ kind:"issued-memory-review-lease" }>;
export type MemoryJobResult = { status:string; jobId?:string };
export type MemoryRunReceipt = { runId:string; registeredScopes:number; maintenanceErased:number; maintenanceDeferred:number;
  admitted:number; completed:number; deferred:number; failed:number };
const requestOf = (row:ScopeRow): MemoryIdentity => ({ actorUserId:row.actor_user_id,custodianId:row.custodian_id,targetScopeId:row.scope_id });
const scopeBindings = (identity:MemoryIdentity,recipe:string) => [identity.actorUserId,identity.custodianId,identity.targetScopeId,recipe];
const rowBindings = (row:ScopeRow) => scopeBindings(requestOf(row),row.recipe_version);
const readPlan = (job:Job): MemoryReviewPlan => {
  try {
    const plan = JSON.parse(job.plan_json) as MemoryReviewPlan;
    memoryAssert(plan.id===job.job_id && plan.actorUserId===job.actor_user_id && plan.custodianId===job.custodian_id
      && plan.scopeId===job.scope_id && plan.recipeVersion===job.recipe_version,"invalid-stored-memory-job");return plan;
  } catch { throw new MemoryBoundaryError("invalid-stored-memory-job"); }
};
function night(now:string,requestedZone:string) {
  let timeZone=requestedZone;
  try { new Intl.DateTimeFormat("en-US",{timeZone}).format(new Date(now)); } catch { timeZone="UTC"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",hourCycle:"h23"})
    .formatToParts(new Date(now)).map((part) => [part.type,part.value]));
  return { timeZone,localDay:`${parts.year}-${parts.month}-${parts.day}`,open:Number(parts.hour)>=1 && Number(parts.hour)<5,
    // A new admission cannot outlive the checked minute (including the 05:00 boundary).
    before:new Date(Math.floor(memoryTime(now)/60_000)*60_000+60_000).toISOString() };
}

/**
 * Disconnected, synthetic-only durable orchestration. Registration does not grant
 * consent. No HTTP hooks, provider calls, deployed trigger or implicit migration.
 */
export class MemoryReviewJobs {
  private readonly db:MemoryDatabase;
  private readonly adapter:MemorySourceAdapter;
  private readonly store:MemoryShadowStore;
  private readonly issued = new WeakMap<MemoryReviewLease,LeaseState>();
  private readonly leaseMs:number;
  private readonly maxAttempts:number;
  private readonly retryMs:number;
  private readonly maintenanceMs:number;
  private readonly derive:MemoryReviewDeriver;

  constructor(adapter:MemorySourceAdapter,store:MemoryShadowStore,options:{leaseMs?:number;maxAttempts?:number;retryMs?:number;maintenanceMs?:number;derive?:MemoryReviewDeriver}={}) {
    memoryAssert(store.sourceAdapter===adapter,"memory-job-adapter-mismatch");
    this.db=adapter.database;this.adapter=adapter;this.store=store;
    this.leaseMs=options.leaseMs??60_000;this.maxAttempts=options.maxAttempts??3;this.retryMs=options.retryMs??60_000;
    this.maintenanceMs=options.maintenanceMs??3_600_000;this.derive=options.derive??deriveMemoryReview;
    memoryAssert(Number.isSafeInteger(this.leaseMs)&&this.leaseMs>=1_000&&this.leaseMs<=300_000
      && Number.isSafeInteger(this.maxAttempts)&&this.maxAttempts>=1&&this.maxAttempts<=5
      && Number.isSafeInteger(this.retryMs)&&this.retryMs>=1_000&&this.retryMs<=3_600_000
      && Number.isSafeInteger(this.maintenanceMs)&&this.maintenanceMs>=1_000&&this.maintenanceMs<=86_400_000,"invalid-memory-job-limits");
  }
  private schemaGuard():MemorySqlGuard { return {condition:"EXISTS(SELECT 1 FROM memory_shadow_job_schema WHERE version=1 AND isolation='synthetic-only') AND EXISTS(SELECT 1 FROM memory_shadow_schema WHERE version=1 AND isolation='synthetic-only')",bindings:[]}; }
  private timeGuard(now=this.adapter.now(),before=new Date(memoryTime(now)+60_000).toISOString()):MemorySqlGuard { return this.adapter.transactionTimeGuard(now,before); }
  private scheduleGuard(row:ScopeRow & {revision:number},enabled=false):MemorySqlGuard {
    return {condition:`EXISTS(SELECT 1 FROM memory_shadow_schedules WHERE ${SCOPE} AND revision=?${enabled?" AND review_enabled=1":""})`,bindings:[...rowBindings(row),row.revision]};
  }
  private jobGuard(job:Job):MemorySqlGuard {
    return {condition:`EXISTS(SELECT 1 FROM memory_shadow_jobs WHERE ${SCOPE} AND job_id=? AND plan_json=? AND status=? AND attempts=? AND max_attempts=? AND lease_token IS ? AND lease_expires_at IS ? AND available_at=?)`,
      bindings:[...rowBindings(job),job.job_id,job.plan_json,job.status,job.attempts,job.max_attempts,job.lease_token,job.lease_expires_at,job.available_at]};
  }
  private leaseState(lease:MemoryReviewLease):LeaseState {
    const state=this.issued.get(lease);memoryAssert(state,"unissued-memory-review-lease");return state!;
  }
  private async schema():Promise<void> { memoryAssert(await memoryGuardsCurrent(this.db,[this.schemaGuard()]),"unsupported-memory-job-schema"); }
  private async schedule(identity:MemoryIdentity,recipe=MEMORY_REVIEW_RECIPE):Promise<Schedule|null> {
    await this.schema();return this.db.prepare(`SELECT * FROM memory_shadow_schedules WHERE ${SCOPE}`).bind(...scopeBindings(identity,recipe)).first<Schedule>();
  }
  private async active(row:Schedule):Promise<Job|null> {
    return this.db.prepare(`SELECT * FROM memory_shadow_jobs WHERE ${SCOPE} AND ${ACTIVE}`).bind(...rowBindings(row)).first<Job>();
  }
  private async exact(job:ScopeRow & {job_id:string}):Promise<Job|null> {
    return this.db.prepare(`SELECT * FROM memory_shadow_jobs WHERE ${SCOPE} AND job_id=?`).bind(...rowBindings(job),job.job_id).first<Job>();
  }
  private async atomic(before:readonly MemorySqlGuard[],writes:readonly {statement:D1PreparedStatement;one?:boolean}[],after:readonly MemorySqlGuard[]=[]):Promise<void> {
    const statements:D1PreparedStatement[]=[],ids:string[]=[];
    const guard=(value:MemorySqlGuard)=>{
      memoryGuardQuery(this.db,value);const id=crypto.randomUUID();ids.push(id);
      statements.push(this.db.prepare(`INSERT INTO memory_shadow_atomic_guards(guard_id,verified) SELECT ?,CASE WHEN (${value.condition}) THEN 1 ELSE 0 END`).bind(id,...value.bindings));
    };
    guard(this.schemaGuard());before.forEach(guard);
    for(const write of writes){statements.push(write.statement);if(write.one)guard({condition:"changes()=1",bindings:[]});}
    after.forEach(guard);
    for(const id of ids)statements.push(this.db.prepare("DELETE FROM memory_shadow_atomic_guards WHERE guard_id=?").bind(id));
    try {
      const results=await this.db.batch(statements);memoryAssert(results.length===statements.length&&results.every((row)=>row.success),"memory-job-write-unconfirmed");
    } catch {throw new MemoryBoundaryError("memory-job-write-rejected");}
  }

  /** Trusted scope registry for a later trigger. Pausing reviews never removes cleanup discovery. */
  async register(identity:MemoryIdentity,options:{timeZone?:string;enabled?:boolean}={}):Promise<MemoryJobResult> {
    if(this.adapter.mode==="off")return {status:"disabled"};
    const request=structuredClone(identity),policy=await this.adapter.policySnapshot(request);memoryAssert(policy,"memory-disabled");
    const graph=createMemoryScopeGraph(policy!.scopes),now=this.adapter.now(),window=night(now,options.timeZone??"UTC"),enabled=options.enabled!==false;
    const old=await this.schedule(request);
    memoryAssert(old || memoryScopeGrant(policy!.access,graph,request.targetScopeId,"learn")
      || memoryScopeGrant(policy!.access,graph,request.targetScopeId,"recall"),"memory-registration-access-denied");
    memoryAssert(!enabled || memoryScopeGrant({...policy!.access,now},graph,request.targetScopeId,"learn"),"memory-registration-learning-denied");
    const clock=this.timeGuard(now),guards=[policy!.guard,clock];
    if(old && old.time_zone===window.timeZone && old.review_enabled===Number(enabled)){
      memoryAssert(await memoryGuardsCurrent(this.db,[...guards,this.scheduleGuard(old)]),"stale-memory-registration");return {status:"existing"};
    }
    const writes:Array<{statement:D1PreparedStatement;one?:boolean}>=[];
    if(old){
      guards.push(this.scheduleGuard(old));
      writes.push({statement:this.db.prepare(`UPDATE memory_shadow_schedules SET time_zone=?,review_enabled=?,revision=revision+1 WHERE ${SCOPE} AND revision=?`)
        .bind(window.timeZone,Number(enabled),...rowBindings(old),old.revision),one:true});
      writes.push({statement:this.db.prepare(`UPDATE memory_shadow_jobs SET status='cancelled',lease_token=NULL,lease_expires_at=NULL,finished_at=?,updated_at=?,failure_code='schedule-changed' WHERE ${SCOPE} AND ${ACTIVE}`)
        .bind(now,now,...rowBindings(old))});
    }else{
      guards.push({condition:"(SELECT COUNT(*) FROM memory_shadow_schedules)<32",bindings:[]});
      writes.push({statement:this.db.prepare("INSERT INTO memory_shadow_schedules(actor_user_id,custodian_id,scope_id,recipe_version,time_zone,review_enabled,revision,registered_at,next_maintenance_at) VALUES(?,?,?,?,?,?,1,?,?)")
        .bind(...scopeBindings(request,MEMORY_REVIEW_RECIPE),window.timeZone,Number(enabled),now,now),one:true});
    }
    await this.atomic(guards,writes,[policy!.guard,clock]);return {status:old?"updated":"registered"};
  }

  async admit(identity:MemoryIdentity):Promise<MemoryJobResult> {
    if(this.adapter.mode==="off")return {status:"disabled"};
    const request=structuredClone(identity),row=await this.schedule(request);
    if(!row)return {status:"unregistered"};if(!row.review_enabled)return {status:"paused"};
    const existing=await this.active(row);if(existing)return {status:"existing",jobId:existing.job_id};
    const now=this.adapter.now(),window=night(now,row.time_zone);
    memoryAssert(memoryTime(now)>=memoryTime(row.registered_at),"memory-clock-rewind");
    if(!window.open)return {status:"outside-window"};
    if(row.last_local_day===window.localDay || row.last_admitted_at && memoryTime(now)-memoryTime(row.last_admitted_at)<20*3_600_000)return {status:"throttled"};
    let capture;
    try {capture=await this.store.capture(request,row.recipe_version);}catch(error){if(error instanceof MemoryBoundaryError)return {status:"blocked"};throw error;}
    memoryAssert(capture,"memory-disabled");const evidence=this.store.evidence(capture!);
    const decision=await planMemoryReview({mode:"shadow",...evidence,processed:evidence.inventory.from,recipeVersion:row.recipe_version,timeZone:window.timeZone});
    if(decision.status!=="planned")return {status:decision.status};
    const plan=decision.plan!,previous=await this.exact({...row,job_id:plan.id});
    if(previous){
      memoryAssert(previous.plan_json===memoryCanonical(plan),"conflicting-memory-job-plan");
      if(["queued","running","retry"].includes(previous.status))return {status:"existing",jobId:previous.job_id};
      // Pausing does not consume the remaining budget of an unchanged plan.
      // Other terminal plans stay terminal; retries never reset attempt limits.
      if(previous.status!=="cancelled"||previous.failure_code!=="schedule-changed"||previous.attempts>=previous.max_attempts)
        return {status:previous.status,jobId:previous.job_id};
    }
    const deadline=Math.min(memoryTime(window.before),memoryTime(evidence.access.enrollmentExpiresAt),
      ...plan.sources.flatMap((ref)=>[memoryTime(evidence.sources.get(JSON.stringify([ref.custodianId,ref.id]))!.expiresAt),
        memoryTime(ref.happenedAt)+evidence.access.retentionDays*86_400_000,
        memoryTime(memoryScopeGrant(evidence.access,evidence.graph,ref.scopeId,"learn")?.expiresAt)]),
      memoryTime(memoryScopeGrant(evidence.access,evidence.graph,request.targetScopeId,"learn")?.expiresAt));
    memoryAssert(Number.isFinite(deadline)&&deadline>memoryTime(now),"expired-memory-job-admission");
    const clock=this.timeGuard(now,new Date(deadline).toISOString()),guard=this.scheduleGuard(row,true);
    const admission=previous?this.db.prepare(`UPDATE memory_shadow_jobs SET local_day=?,schedule_revision=?,status='queued',available_at=?,updated_at=?,finished_at=NULL,failure_code=NULL WHERE ${SCOPE} AND job_id=?`)
      .bind(window.localDay,row.revision,now,now,...rowBindings(row),plan.id)
      :this.db.prepare(`INSERT INTO memory_shadow_jobs(actor_user_id,custodian_id,scope_id,recipe_version,job_id,plan_json,local_day,schedule_revision,max_attempts,status,available_at,admitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?)`)
        .bind(...rowBindings(row),plan.id,memoryCanonical(plan),window.localDay,row.revision,this.maxAttempts,now,now,now);
    const writes=[{statement:admission,one:true},
    {statement:this.db.prepare(`UPDATE memory_shadow_schedules SET last_admitted_at=?,last_local_day=? WHERE ${SCOPE} AND revision=? AND review_enabled=1`)
      .bind(now,window.localDay,...rowBindings(row),row.revision),one:true}];
    try {await this.atomic([...this.store.transactionGuards(capture!),guard,clock,...(previous?[this.jobGuard(previous)]:[])],writes,[...this.store.transactionGuards(capture!),guard,clock]);}
    catch(error){const raced=await this.active(row);if(raced?.job_id===plan.id&&raced.plan_json===memoryCanonical(plan))return {status:"existing",jobId:plan.id};throw error;}
    return {status:"admitted",jobId:plan.id};
  }

  async claim(identity:MemoryIdentity):Promise<MemoryReviewLease|MemoryJobResult> {
    if(this.adapter.mode==="off")return {status:"disabled"};
    const request=structuredClone(identity),row=await this.schedule(request);if(!row)return {status:"unregistered"};
    const job=await this.active(row);if(!job)return {status:"idle"};
    const now=this.adapter.now(),clock=this.timeGuard(now);
    if(!row.review_enabled||row.revision!==job.schedule_revision)return {status:"paused",jobId:job.job_id};
    if(job.status==="running"&&memoryTime(job.lease_expires_at)>memoryTime(now))return {status:"busy",jobId:job.job_id};
    if(memoryTime(job.available_at)>memoryTime(now))return {status:"backoff",jobId:job.job_id};
    const policy=await this.adapter.policySnapshot(request);memoryAssert(policy,"memory-disabled");
    const allowed=memoryScopeGrant({...policy!.access,now},createMemoryScopeGraph(policy!.scopes),request.targetScopeId,"learn");
    if(!allowed||job.attempts>=job.max_attempts){
      const status=allowed?"failed":"cancelled",code=allowed?"attempt-limit":"policy-disabled";
      await this.atomic([this.jobGuard(job),this.scheduleGuard(row),policy!.guard,clock],[{statement:this.db.prepare(`UPDATE memory_shadow_jobs SET status=?,failure_code=?,finished_at=?,updated_at=?,lease_token=NULL,lease_expires_at=NULL WHERE ${SCOPE} AND job_id=?`)
        .bind(status,code,now,now,...rowBindings(job),job.job_id),one:true}],[policy!.guard,clock]);return {status,jobId:job.job_id};
    }
    const token=crypto.randomUUID(),expiresAt=new Date(memoryTime(now)+this.leaseMs).toISOString();
    try {await this.atomic([this.jobGuard(job),this.scheduleGuard(row,true),policy!.guard,clock],[{statement:this.db.prepare(`UPDATE memory_shadow_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=?,failure_code=NULL WHERE ${SCOPE} AND job_id=?`)
      .bind(token,expiresAt,now,...rowBindings(job),job.job_id),one:true}],[policy!.guard,this.timeGuard(now,expiresAt)]);}
    catch(error){const current=await this.exact(job);if(current?.lease_token!==job.lease_token||current?.attempts!==job.attempts)return {status:"busy",jobId:job.job_id};throw error;}
    const lease:MemoryReviewLease=Object.freeze({kind:"issued-memory-review-lease"});
    this.issued.set(lease,{job:{...job,status:"running",attempts:job.attempts+1,lease_token:token,lease_expires_at:expiresAt,updated_at:now},startedAt:now});return lease;
  }

  async renew(lease:MemoryReviewLease):Promise<void> {
    const state=this.leaseState(lease),job=state.job,now=this.adapter.now();
    const before=this.timeGuard(now,job.lease_expires_at!),expiresAt=new Date(Math.min(memoryTime(now)+this.leaseMs,memoryTime(state.startedAt)+5*this.leaseMs)).toISOString();
    memoryAssert(memoryTime(expiresAt)>memoryTime(now),"memory-review-renewal-limit");
    await this.atomic([this.jobGuard(job),before],[{statement:this.db.prepare(`UPDATE memory_shadow_jobs SET lease_expires_at=?,updated_at=? WHERE ${SCOPE} AND job_id=? AND status='running' AND lease_token=?`)
      .bind(expiresAt,now,...rowBindings(job),job.job_id,job.lease_token),one:true}],[before]);
    state.job={...job,lease_expires_at:expiresAt,updated_at:now};
  }

  private coordination(lease:MemoryReviewLease):MemoryPublicationCoordination {
    const job=this.leaseState(lease).job,now=this.adapter.now(),clock=this.timeGuard(now,job.lease_expires_at!);
    const schedule={...job,revision:job.schedule_revision};
    return {database:this.db,expiresAt:job.lease_expires_at!,guards:[this.schemaGuard(),this.scheduleGuard(schedule,true),this.jobGuard(job),clock],
      completion:this.db.prepare(`UPDATE memory_shadow_jobs SET status='completed',lease_token=NULL,lease_expires_at=NULL,updated_at=?,finished_at=?,failure_code=NULL WHERE ${SCOPE} AND job_id=? AND status='running' AND lease_token=? AND (${clock.condition})`)
        .bind(now,now,...rowBindings(job),job.job_id,job.lease_token,...clock.bindings)};
  }
  private async reconcile(lease:MemoryReviewLease):Promise<boolean> {
    const job=this.leaseState(lease).job;
    const receipt=await this.db.prepare("SELECT plan_json FROM memory_shadow_reviews WHERE actor_user_id=? AND custodian_id=? AND review_id=?")
      .bind(job.actor_user_id,job.custodian_id,job.job_id).first<{plan_json:string}>();
    if(!receipt)return false;memoryAssert(receipt.plan_json===job.plan_json,"conflicting-memory-job-receipt");
    const current=await this.exact(job);if(current?.status==="completed")return true;
    const coordination=this.coordination(lease),receiptGuard:MemorySqlGuard={condition:"EXISTS(SELECT 1 FROM memory_shadow_reviews WHERE actor_user_id=? AND custodian_id=? AND review_id=? AND plan_json=?)",
      bindings:[job.actor_user_id,job.custodian_id,job.job_id,job.plan_json]};
    await this.atomic([...coordination.guards,receiptGuard],[{statement:coordination.completion,one:true}],[receiptGuard,this.timeGuard(this.adapter.now(),coordination.expiresAt)]);return true;
  }
  private async fail(lease:MemoryReviewLease,code:"source-unavailable"|"stale-plan"|"worker-failed"):Promise<MemoryJobResult> {
    const job=this.leaseState(lease).job,now=this.adapter.now(),clock=this.timeGuard(now,job.lease_expires_at!);
    const status=code==="stale-plan"?"cancelled":job.attempts>=job.max_attempts?"failed":"retry";
    const available=new Date(memoryTime(now)+Math.min(3_600_000,this.retryMs*2**(job.attempts-1))).toISOString();
    await this.atomic([this.jobGuard(job),clock],[{statement:this.db.prepare(`UPDATE memory_shadow_jobs SET status=?,failure_code=?,available_at=?,updated_at=?,finished_at=?,lease_token=NULL,lease_expires_at=NULL WHERE ${SCOPE} AND job_id=?`)
      .bind(status,code,available,now,status==="retry"?null:now,...rowBindings(job),job.job_id),one:true}],[clock]);return {status,jobId:job.job_id};
  }

  async execute(lease:MemoryReviewLease):Promise<MemoryJobResult> {
    const state=this.leaseState(lease),job=state.job;
    try {
      if(await this.reconcile(lease))return {status:"completed",jobId:job.job_id};
      memoryAssert(await memoryGuardsCurrent(this.db,this.coordination(lease).guards),"stale-memory-review-lease");
      const plan=readPlan(job),capture=await this.store.capture(requestOf(job),job.recipe_version,"learn",plan.through);memoryAssert(capture,"memory-disabled");
      const evidence=this.store.evidence(capture!);
      const resume=await planMemoryReview({mode:"shadow",...evidence,processed:evidence.inventory.from,recipeVersion:job.recipe_version,timeZone:"UTC",pending:plan});
      if(resume.status!=="resume")return await this.fail(lease,"stale-plan");
      const output=await this.derive({store:this.store,capture:capture!,plan});
      await this.store.publish({capture:capture!,plan,records:output.records,segments:output.segments,coordination:this.coordination(lease)});
      memoryAssert(await this.reconcile(lease),"missing-memory-review-completion");return {status:"completed",jobId:job.job_id};
    } catch(error) {
      const current=await this.exact(job);
      if(current?.status==="completed"&&current.plan_json===job.plan_json)return {status:"completed",jobId:job.job_id};
      if(current?.lease_token!==state.job.lease_token||memoryTime(state.job.lease_expires_at)<=memoryTime(this.adapter.now()))return {status:"lease-lost",jobId:job.job_id};
      return this.fail(lease,error instanceof MemoryBoundaryError?"source-unavailable":"worker-failed");
    }
  }

  /** An actual explicit invocation is recorded; this does not install a hosted timer. */
  async tick(trigger:"manual"|"synthetic-scheduled"="manual"):Promise<MemoryRunReceipt|null> {
    if(this.adapter.mode==="off")return null;
    memoryAssert(trigger==="manual"||trigger==="synthetic-scheduled","invalid-memory-run-trigger");await this.schema();
    const now=this.adapter.now(),rows=await this.db.prepare("SELECT * FROM memory_shadow_schedules ORDER BY actor_user_id,custodian_id,scope_id,recipe_version LIMIT 33").all<Schedule>();
    memoryAssert(rows.success&&rows.results.length<=32,"memory-schedule-capacity");
    const result:MemoryRunReceipt={runId:crypto.randomUUID(),registeredScopes:rows.results.length,maintenanceErased:0,maintenanceDeferred:0,admitted:0,completed:0,deferred:0,failed:0};
    const startClock=this.timeGuard(now);
    await this.atomic([startClock],[{statement:this.db.prepare("INSERT INTO memory_shadow_review_runs(run_id,trigger_kind,started_at,status,registered_scopes) VALUES(?,?,?,'running',?)")
      .bind(result.runId,trigger,now,result.registeredScopes),one:true}],[startClock]);
    try {
      // Complete the bounded cleanup phase for EVERY registered scope before any
      // potentially slow learning job. Disabled learning stays discoverable here.
      for(const row of rows.results){
        if(memoryTime(row.next_maintenance_at)>memoryTime(this.adapter.now()))continue;
        let status="error",erased=0;
        try {const clean=await this.store.maintain(requestOf(row));erased=clean.erased;status=clean.sourceReview==="deferred"?"deferred":"complete";}
        catch {status="error";}
        result.maintenanceErased+=erased;
        try {
          const checked=this.adapter.now(),next=new Date(memoryTime(checked)+(status==="complete"?this.maintenanceMs:this.retryMs)).toISOString();
          const clock=this.timeGuard(checked);
          await this.atomic([this.scheduleGuard(row),clock],[{statement:this.db.prepare(`UPDATE memory_shadow_schedules SET last_maintenance_at=?,next_maintenance_at=?,maintenance_status=?,maintenance_erased=? WHERE ${SCOPE} AND revision=?`)
            .bind(checked,next,status,erased,...rowBindings(row),row.revision),one:true}],[clock]);
        } catch {
          // A concurrent registration change (or receipt-write failure) must not
          // prevent cleanup of the remaining scopes. Leave this scope due.
          status="error";
        }
        if(status!=="complete")result.maintenanceDeferred++;
      }
      for(const row of rows.results){
        try {
          const admission=await this.admit(requestOf(row));if(admission.status==="admitted")result.admitted++;
          const claimed=await this.claim(requestOf(row));
          const outcome="kind" in claimed?await this.execute(claimed):claimed;
          if(outcome.status==="completed")result.completed++;
          else if(outcome.status==="failed"||outcome.status==="cancelled")result.failed++;
          else if(["busy","retry","backoff","lease-lost"].includes(outcome.status)||admission.status==="blocked")result.deferred++;
        }catch {result.deferred++;}
      }
      const finished=this.adapter.now(),finishClock=this.timeGuard(finished);
      memoryAssert(memoryTime(finished)>=memoryTime(now),"memory-clock-rewind");
      await this.atomic([finishClock],[{statement:this.db.prepare("UPDATE memory_shadow_review_runs SET status='completed',finished_at=?,maintenance_erased=?,maintenance_deferred=?,admitted=?,completed=?,deferred=?,failed=? WHERE run_id=? AND status='running'")
        .bind(finished,result.maintenanceErased,result.maintenanceDeferred,result.admitted,result.completed,result.deferred,result.failed,result.runId),one:true},
      {statement:this.db.prepare("DELETE FROM memory_shadow_review_runs WHERE status!='running' AND run_id NOT IN (SELECT run_id FROM memory_shadow_review_runs WHERE status!='running' ORDER BY started_at DESC,run_id DESC LIMIT 128)")}],[finishClock]);
      return result;
    }catch(error){
      await this.db.prepare("UPDATE memory_shadow_review_runs SET status='error',finished_at=? WHERE run_id=? AND status='running'").bind(this.adapter.now(),result.runId).run();throw error;
    }
  }
}
