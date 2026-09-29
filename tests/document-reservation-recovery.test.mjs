import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { documentJobCanRecoverProviderRender } from "../src/model/document-jobs.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { interruptedDocumentJobUsage, recordedDocumentPlannerUsage } from "../worker/document-job-reservations.ts";
import {
  adoptLegacyCostReservation,
  claimCostBudgetReservation,
  costBudgetReservation,
  readBudgets,
  readCostBudgets,
  reconcileFailedBudgetReservations,
  releaseBudgetReservationsForCorrelation,
  releaseCostReservationsForCorrelation,
  reserveBudget,
  reserveCostBudget,
  settleBudget,
  settleCostBudget,
  settleInterruptedDocumentJobReservations,
  settleLegacyPresentationReservations,
} from "../worker/pilot-policy.ts";
import { appendAuditEvent, ensureSchema } from "../worker/runtime.ts";

function reconciliationDatabase() {
  const sqlite=new DatabaseSync(":memory:");

  class PreparedStatement {
    constructor(sql,values=[]) { this.sql=sql;this.values=values; }
    bind(...values) { return new PreparedStatement(this.sql,values); }
    execute(kind) {
      const statement=sqlite.prepare(this.sql);
      if(kind==="first")return statement.get(...this.values)??null;
      if(kind==="all")return{results:statement.all(...this.values),success:true,meta:{changes:0}};
      const result=statement.run(...this.values);
      return{results:[],success:true,meta:{changes:Number(result.changes??0)}};
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }

  const env={DB:{
    prepare(sql) { return new PreparedStatement(sql); },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result=statements.map((statement)=>statement.execute(/^\s*(?:SELECT|WITH)/i.test(statement.sql)?"all":"run"));
        sqlite.exec("COMMIT");
        return result;
      }catch(error){
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  }};
  return{sqlite,env};
}

async function interruptedVideoFixture({jobStatus="failed",jobCorrelation="paid-video:attempt:2"}={}) {
  const {sqlite,env}=reconciliationDatabase();
  await ensureSchema(env);
  const owner="owner";
  const stream=`creative:${owner}`;
  const correlation="paid-video:attempt:1";
  const operation="document-render:video";
  const agedAt=new Date(Date.now()-10*60_000).toISOString();
  const expiresAt=new Date(Date.now()+86_400_000).toISOString();
  const user={userId:owner,streamId:stream,billingUserId:owner};
  const token=await reserveBudget(env,owner,64_000,{streamId:stream,correlationId:correlation,operation});
  assert.equal(token.ok,true);
  const cost=await reserveCostBudget(env,owner,56_932_000,{
    reservationId:"cost-paid",maximumMicrousd:56_932_000,allowUserOverage:false,
    streamId:stream,correlationId:correlation,operation,period:token.period,
  });
  assert.equal(cost.ok,true);
  assert.equal(await claimCostBudgetReservation(env,owner,cost.reservationId),true);
  sqlite.prepare("UPDATE budget_reservations SET created_at=?,updated_at=? WHERE reservation_id=?").run(agedAt,agedAt,token.reservationId);
  sqlite.prepare("UPDATE cost_budget_reservations SET created_at=?,updated_at=? WHERE reservation_id=?").run(agedAt,agedAt,cost.reservationId);

  const checkpoint={
    artifactId:"artifact-paid",
    artifactKind:"video",
    reservationId:token.reservationId,
    costReservationId:cost.reservationId,
    costReservationMicrousd:56_932_000,
    costReservationPeriod:token.period,
    plannerModel:"gpt-5.6-terra",
    plannerResponseId:"planner-paid",
    plannerResponseIds:["planner-paid","planner-paid-page-two"],
    plannerUsage:{inputTokens:10_928,outputTokens:5_853,totalTokens:16_781},
    productionAnchor:{sceneId:"scene-004"},
    productionSceneReceipts:{"scene-004":{
      sceneId:"scene-004",status:"submitted",providerJobId:"fal-paid-scene",
      providerModel:"bytedance/seedance-2.0/reference-to-video",durationSeconds:15,
    }},
    recoverableProductionProviderRequest:true,
  };
  const request={artifactKind:"video",productionMode:"managed",paidMediaConfirmed:true,videoSeconds:15};
  sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("paid-video",owner,stream,"document-paid","render_document",jobStatus,"studio",jobCorrelation,1,JSON.stringify(request),JSON.stringify(checkpoint),jobStatus==="failed"?"cost_reservation_invalid_or_expired":null,2,agedAt,agedAt,jobStatus==="failed"?agedAt:null,jobStatus==="running"?expiresAt:null,null,expiresAt,agedAt);
  await appendAuditEvent(env,stream,"worker:policy","BudgetReserved",{
    operation,reservation_id:token.reservationId,cost_reservation_id:cost.reservationId,
    reserved_tokens:64_000,reserved_microusd:56_932_000,period:token.period,
  },correlation);
  return{sqlite,env,user,token,cost,checkpoint,request,correlation,agedAt};
}

async function integratedProductionWorker() {
  const worker=(await import("../dist/server/index.js")).default;
  const {sqlite,env}=reconciliationDatabase();
  const background=[];
  const environment={
    ...env,
    OPENAI_API_KEY:"test-only",
    FAL_KEY:"test-only",
    ASSETS:{fetch:async()=>new Response(null,{status:404})},
    MEDIA:{put:async()=>undefined,get:async()=>null},
  };
  const context={waitUntil(promise){
    const pending=Promise.resolve(promise);
    // Observe rejection immediately while retaining the original settlement.
    void pending.catch(()=>{});
    background.push(pending);
  }};
  const drainBackground=async()=>{
    const failures=[];
    while(background.length){
      const settled=await Promise.allSettled(background.splice(0));
      for(const result of settled)if(result.status==="rejected")failures.push(result.reason);
    }
    if(failures.length===1)throw failures[0];
    if(failures.length>1)throw new AggregateError(failures,"Integrated worker background failed");
  };
  const request=(path,init)=>worker.fetch(new Request(`http://localhost${path}`,init),environment,context);
  try{
    assert.equal((await request("/api/session")).status,200);
    sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
    assert.equal((await request("/api/events?after=0&limit=2000&content=0")).status,200);
    return{sqlite,environment,request,drainBackground};
  }catch(error){
    const failures=[error];
    try{await drainBackground();}catch(cleanupError){failures.push(cleanupError);}
    try{sqlite.close();}catch(cleanupError){failures.push(cleanupError);}
    if(failures.length===1)throw error;
    throw new AggregateError(failures,"Integrated worker setup and cleanup failed");
  }
}

async function integratedInterruptedRender(worker,{
  jobId,
  artifactKind="video",
  status="running",
  paidProvider=true,
  plannerUsage=true,
  cachedPlan=true,
  missingCostReservation=false,
  stale=true,
  productionMode="managed",
  owner="dev-local-creative",
  billingOwner=owner,
  stream=`creative:${owner}`,
}={}){
  const {sqlite,environment}=worker;
  const correlation=`${jobId}:attempt:1`;
  const operation=`document-render:${artifactKind}`;
  const agedAt=new Date(Date.now()-10*60_000).toISOString();
  const expiresAt=new Date(Date.now()+86_400_000).toISOString();
  const reservedTokens=artifactKind==="video"?64_000:32_000;
  const reservedMicrousd=artifactKind==="video"?56_932_000:1_000_000;
  const token=await reserveBudget(environment,billingOwner,reservedTokens,{streamId:stream,correlationId:correlation,operation});
  assert.equal(token.ok,true);
  const cost=missingCostReservation?null:await reserveCostBudget(environment,billingOwner,reservedMicrousd,{
    reservationId:`${jobId}-cost`,maximumMicrousd:reservedMicrousd,allowUserOverage:false,
    streamId:stream,correlationId:correlation,operation,period:token.period,
  });
  if(cost){
    assert.equal(cost.ok,true);
    assert.equal(await claimCostBudgetReservation(environment,billingOwner,cost.reservationId),true);
    sqlite.prepare("UPDATE cost_budget_reservations SET created_at=?,updated_at=? WHERE reservation_id=?").run(agedAt,agedAt,cost.reservationId);
  }
  sqlite.prepare("UPDATE budget_reservations SET created_at=?,updated_at=? WHERE reservation_id=?").run(agedAt,agedAt,token.reservationId);

  const sceneId=`${jobId}-scene`;
  const plan={title:"Harbor",summary:"A harbor wakes.",content_markdown:"A quiet harbor wakes beneath warm morning light.",presentation:null,
    items:[{title:"Opening",body:"A quiet harbor wakes.",notes:"Slow tracking shot.",image_prompt:"Morning harbor.",context_group_ids:[],slide:null}]};
  const checkpoint={
    artifactKind,artifactId:`${jobId}-artifact`,reservationId:token.reservationId,
    costReservationId:cost?.reservationId??`${jobId}-missing-cost`,costReservationMicrousd:reservedMicrousd,costReservationPeriod:token.period,
    ...(plannerUsage?{plannerModel:"gpt-5.6-terra",plannerResponseId:`${jobId}-planner`,
      plannerUsage:{inputTokens:10_928,outputTokens:5_853,totalTokens:16_781}}:{}),
    ...(cachedPlan?{artifactPlan:plan}:{}),
    ...(paidProvider?{
      productionAnchor:{sceneId},
      productionSceneReceipts:{[sceneId]:{sceneId,status:"submitted",providerJobId:`${jobId}-provider`,durationSeconds:15}},
      recoverableProductionProviderRequest:true,
    }:{}),
    ...(status==="failed"?{errorDetail:{code:"cost_reservation_invalid_or_expired",category:"provider",scope:"request",action:"edit_request",message:"Reservation mismatch.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:409}}:{}),
  };
  const payload={documentRevision:`${jobId}-revision`,requestKey:`${jobId}-request`,artifactKind,
    ...(artifactKind==="video"?{productionMode,paidMediaConfirmed:true,videoSeconds:15}:{}),snapshot:{facts:[]}};
  sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobId,owner,stream,"doc-atmosphere","render_document",status,"studio",correlation,1,JSON.stringify(payload),JSON.stringify(checkpoint),status==="failed"?"cost_reservation_invalid_or_expired":null,1,agedAt,agedAt,status==="failed"?agedAt:null,["running","committing"].includes(status)?stale?agedAt:expiresAt:null,null,expiresAt,stale?agedAt:new Date().toISOString());
  await appendAuditEvent(environment,stream,"worker:policy","BudgetReserved",{
    operation,reservation_id:token.reservationId,cost_reservation_id:cost?.reservationId??null,
    reserved_tokens:reservedTokens,reserved_microusd:cost?reservedMicrousd:0,period:token.period,
  },correlation);
  return{owner,billingOwner,stream,correlation,token,cost,checkpoint,payload,sceneId,plan,agedAt,expiresAt};
}

function addLiveQueueBlocker(sqlite,owner,stream){
  const now=new Date().toISOString();
  const expiresAt=new Date(Date.now()+86_400_000).toISOString();
  sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(`${owner}-live-blocker`,owner,stream,"doc-atmosphere","chat","running","studio",`${owner}-live-blocker:attempt:1`,1,"{}","{}",null,1,now,now,null,expiresAt,null,expiresAt,now);
}

function addRecoveryImpersonation(worker,userId="fictional-recovery"){
  const now=new Date().toISOString();
  const expiresAt=new Date(Date.now()+3_600_000).toISOString();
  const personaId=`${userId}-persona`;
  const impersonationId=`${userId}-impersonation`;
  worker.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(userId,`${userId}@example.test`,"Fictional creative","creator","pilot-2026-08-10",now,now,now);
  worker.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(personaId,`${userId}-replay`,"dev-local-creative",userId,`creative:${userId}`,"Fictional creative","ready",now,now);
  worker.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(impersonationId,"dev-local-creative",personaId,userId,`${userId}-replay`,"active",now,expiresAt);
  return{userId,cookie:`forma_impersonation=${impersonationId}`,headers:{cookie:`forma_impersonation=${impersonationId}`,"x-forma-impersonation-confirmation":"I understand, continue"}};
}

test("reconstructs documented planner, submitted-scene, and legacy-anchor charges exactly",()=>{
  const usage=interruptedDocumentJobUsage({
    plannerModel:"gpt-5.6-terra",
    plannerResponseId:"planner-paid",
    plannerUsage:{inputTokens:10_928,outputTokens:5_853,totalTokens:16_781},
    productionAnchor:{sceneId:"scene-004"},
    productionSceneReceipts:{"scene-004":{sceneId:"scene-004",status:"submitted",durationSeconds:15}},
  },{artifactKind:"video",videoSeconds:15});
  assert.equal(usage.totalTokens,16_781);
  assert.equal(usage.plannerCostMicrousd,92_092);
  assert.equal(usage.sceneCostMicrousd,4_536_000);
  assert.equal(usage.anchorCostMicrousd,500_000);
  assert.equal(usage.totalCostMicrousd,5_128_092);
});

test("retains exact image-anchor receipts and never bills prepaid production work twice",()=>{
  const checkpoint={
    plannerModel:"gpt-5.6-terra",
    plannerUsage:{inputTokens:100,outputTokens:20,totalTokens:120},
    productionAnchor:{usage:{inputTokens:60,outputTokens:15,totalTokens:75},costMicrousd:123_456},
    productionSceneReceipts:{"scene-one":{sceneId:"scene-one",status:"completed",durationSeconds:15,costMicrousd:4_536_000}},
  };
  const incurred=interruptedDocumentJobUsage(checkpoint,{artifactKind:"video"});
  assert.equal(incurred.totalTokens,195);
  assert.equal(incurred.anchorCostMicrousd,123_456);
  const prepaid=interruptedDocumentJobUsage({...checkpoint,productionPrepaidSceneIds:["scene-one"],productionPrepaidAnchor:true},{artifactKind:"video"},{plannerAlreadyRecorded:true});
  assert.equal(prepaid.totalTokens,0);
  assert.equal(prepaid.totalCostMicrousd,0);
});

test("generic planning receipts supersede a stale per-page aggregate after an interrupted repair",()=>{
  const planning=(id,input,output)=>({clientRequestId:id,provider:"openai",operation:"planning",model:"gpt-5.6-terra",status:"completed",providerRequestId:id,inputTokens:input,outputTokens:output,totalTokens:input+output,costMicrousd:input*2+output*12});
  const checkpoint={plannerModel:"gpt-5.6-terra",plannerResponseId:"first",plannerUsage:{inputTokens:1000,outputTokens:2000,totalTokens:3000},providerSubmissionProtocol:1,providerSubmissions:{first:planning("first",1000,1000),second:planning("second",1000,1000),repair:planning("repair",500,500)}};
  const usage=interruptedDocumentJobUsage(checkpoint,{artifactKind:"short_story"});
  assert.equal(usage.totalTokens,5000);assert.equal(usage.plannerCostMicrousd,35000);
  const remainder=interruptedDocumentJobUsage(checkpoint,{artifactKind:"short_story"},{plannerTokensAlreadyRecorded:true,plannerCostAlreadyRecordedMicrousd:30000});
  assert.equal(remainder.totalTokens,0);assert.equal(remainder.plannerCostMicrousd,5000);
});

test("planner token receipts, dollar receipts, and partially covered costs remain independent",()=>{
  const checkpoint={plannerModel:"gpt-5.6-terra",plannerResponseId:"planner-partial",
    plannerUsage:{inputTokens:10_928,outputTokens:5_853,totalTokens:16_781}};
  const full=interruptedDocumentJobUsage(checkpoint);
  const recorded=recordedDocumentPlannerUsage([{type:"GenerationUsageRecorded",payload:{planner_response_id:"planner-partial",
    planner_tokens:16_781,total_tokens:16_781,cost_microusd:50_000,planner_cost_microusd:50_000}}],"planner-partial",full.plannerCostMicrousd);
  assert.equal(recorded.tokensRecorded,true);
  assert.equal(recorded.costRecorded,false);
  assert.equal(recorded.recordedCostMicrousd,50_000);
  const remaining=interruptedDocumentJobUsage(checkpoint,{},
    {plannerTokensAlreadyRecorded:recorded.tokensRecorded,plannerCostAlreadyRecordedMicrousd:recorded.recordedCostMicrousd});
  assert.equal(remaining.totalTokens,0);
  assert.equal(remaining.plannerCostMicrousd,42_092);
});

test("generic orphan and correlation recovery cannot release native Memory paired holds",async()=>{
  const {sqlite,env}=reconciliationDatabase();
  try{
    await ensureSchema(env);
    const user={userId:"memory-owner",billingUserId:"memory-owner",streamId:"creative:memory-owner"};
    const agedAt=new Date(Date.now()-86_400_000).toISOString(),correlation="memory-shared-correlation",pairs=[];
    for(const purpose of ["rolling-summary","profile","suggestion"]){
      const operation=`memory-derivation:${purpose}`;
      const token=await reserveBudget(env,user.userId,100,{streamId:user.streamId,correlationId:correlation,operation});
      const cost=await reserveCostBudget(env,user.userId,1_000,{reservationId:`memory-cost-${purpose}`,maximumMicrousd:1_000,
        allowUserOverage:false,streamId:user.streamId,correlationId:correlation,operation,period:token.period});
      assert.equal(token.ok,true);assert.equal(cost.ok,true);
      if(purpose==="profile")assert.equal(await claimCostBudgetReservation(env,user.userId,cost.reservationId),true);
      sqlite.prepare("UPDATE budget_reservations SET created_at=?,updated_at=? WHERE reservation_id=?").run(agedAt,agedAt,token.reservationId);
      sqlite.prepare("UPDATE cost_budget_reservations SET created_at=?,updated_at=? WHERE reservation_id=?").run(agedAt,agedAt,cost.reservationId);
      pairs.push({token,cost,purpose});
    }
    assert.deepEqual(await reconcileFailedBudgetReservations(env,user),{releasedTokens:0,reservationCount:0,releasedMicrousd:0,costReservationCount:0});
    const ordinary=await reserveBudget(env,user.userId,50,{streamId:user.streamId,correlationId:correlation,operation:"image-generation"});
    assert.equal(ordinary.ok,true);
    assert.equal((await releaseBudgetReservationsForCorrelation(env,user,correlation,"ordinary_cancellation")).length,1);
    assert.equal(await releaseCostReservationsForCorrelation(env,user.userId,correlation,user.streamId),0);
    for(const {token,cost,purpose} of pairs){
      assert.equal(sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(token.reservationId).status,"active");
      assert.equal((await costBudgetReservation(env,user.userId,cost.reservationId)).status,purpose==="profile"?"executing":"active");
    }
    assert.equal((await readBudgets(env,user.userId)).user.reserved,300);
    assert.equal((await readCostBudgets(env,user.userId)).user.reservedMicrousd,3_000);
  }finally{sqlite.close();}
});

test("repairs a failed paid-render attempt without erasing planner or provider usage",async()=>{
  const {sqlite,env,user,token,cost}=await interruptedVideoFixture();
  const repaired=await reconcileFailedBudgetReservations(env,user);
  assert.equal(repaired.releasedTokens,47_219);
  assert.equal(repaired.releasedMicrousd,51_803_908);
  assert.equal(repaired.reservationCount,1);
  assert.equal(repaired.costReservationCount,1);

  assert.deepEqual({...sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE reservation_id=?").get(token.reservationId)},{status:"settled",used_tokens:16_781});
  assert.deepEqual({...sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(cost.reservationId)},{status:"settled",used_microusd:5_128_092});
  for(const scope of ["user","workspace"]){
    assert.deepEqual({...sqlite.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope=?").get(scope)},{used_tokens:16_781,reserved_tokens:0});
    assert.deepEqual({...sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope=?").get(scope)},{used_microusd:5_128_092,reserved_microusd:0});
  }
  const events=sqlite.prepare("SELECT type,payload FROM events WHERE stream_id=? ORDER BY sequence").all(user.streamId);
  assert.deepEqual(events.map((event)=>event.type),["BudgetReserved","GenerationUsageRecorded","BudgetReleased"]);
  assert.equal(JSON.parse(events[1].payload).planner_response_id,"planner-paid");
  assert.equal(JSON.parse(events[2].payload).released_microusd,51_803_908);

  assert.deepEqual(await reconcileFailedBudgetReservations(env,user),{releasedTokens:0,reservationCount:0,releasedMicrousd:0,costReservationCount:0});
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,3);
});

test("protects an active retry by its checkpointed reservation IDs despite correlation drift",async()=>{
  const {sqlite,env,user,token,cost}=await interruptedVideoFixture({jobStatus:"running"});
  assert.deepEqual(await reconcileFailedBudgetReservations(env,user),{releasedTokens:0,reservationCount:0,releasedMicrousd:0,costReservationCount:0});
  assert.equal(sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(token.reservationId).status,"active");
  assert.equal((await costBudgetReservation(env,user.userId,cost.reservationId)).status,"executing");
  assert.equal((await readBudgets(env,user.userId)).user.reserved,64_000);
  assert.equal((await readCostBudgets(env,user.userId)).user.reservedMicrousd,56_932_000);
});

test("independently repairs executing cost reservations after planner tokens were already settled",async()=>{
  const {sqlite,env,user,token,cost,correlation}=await interruptedVideoFixture();
  await settleBudget(env,user.userId,token.reservationId,16_781,"planner_usage_already_recorded");
  await appendAuditEvent(env,user.streamId,"worker:policy","GenerationUsageRecorded",{
    reservation_id:token.reservationId,cost_reservation_id:cost.reservationId,
    planner_response_id:"planner-paid",total_tokens:16_781,cost_microusd:92_092,
  },correlation);
  sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=used_microusd+92092").run();

  const repaired=await reconcileFailedBudgetReservations(env,user);
  assert.equal(repaired.costReservationCount,1);
  assert.equal(repaired.releasedMicrousd,51_896_000);
  assert.deepEqual({...sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user'").get()},{used_microusd:5_128_092,reserved_microusd:0});
  assert.equal((await costBudgetReservation(env,user.userId,cost.reservationId)).used_microusd,5_036_000);

  const recordedUsage=sqlite.prepare("SELECT correlation_id,payload FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' ORDER BY sequence").all(user.streamId);
  assert.equal(recordedUsage.length,2,"provider-only recovered charges must retain their own immutable usage receipt");
  const recoveredUsage=JSON.parse(recordedUsage[1].payload);
  assert.equal(recordedUsage[1].correlation_id,correlation);
  assert.equal(recoveredUsage.job_id,"paid-video");
  assert.equal(recoveredUsage.cost_reservation_id,cost.reservationId);
  assert.equal(recoveredUsage.total_tokens,0,"already-recorded planner tokens must never be charged a second time");
  assert.equal(recoveredUsage.planner_cost_microusd,0);
  assert.equal(recoveredUsage.video_cost_microusd,4_536_000);
  assert.equal(recoveredUsage.cost_microusd,5_036_000);
  assert.equal(recordedUsage.reduce((total,event)=>total+Number(JSON.parse(event.payload).cost_microusd??0),0),5_128_092,"analytics receipts must reconcile exactly to the settled account cost");
  assert.deepEqual(await reconcileFailedBudgetReservations(env,user),{releasedTokens:0,reservationCount:0,releasedMicrousd:0,costReservationCount:0});
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='GenerationUsageRecorded'").get().count,2,"a repeated recovery must not duplicate paid usage");
});

for(const tokenLedgerFirst of [true,false]){
  test(`interrupted planner accounting remains complete when the ${tokenLedgerFirst?"token":"dollar"} ledger settles first`,async()=>{
    const {sqlite,env,user,token,cost}=await interruptedVideoFixture();
    const job=sqlite.prepare("SELECT job_id,stream_id,document_id,correlation_id,request_json,result_json FROM document_jobs WHERE job_id=?").get("paid-video");
    const hiddenTable=tokenLedgerFirst?"cost_budget_reservations":"budget_reservations";
    const hiddenId=tokenLedgerFirst?cost.reservationId:token.reservationId;
    const restoredStatus=tokenLedgerFirst?"executing":"active";
    sqlite.prepare(`UPDATE ${hiddenTable} SET status='pending_repair' WHERE reservation_id=?`).run(hiddenId);
    const first=await settleInterruptedDocumentJobReservations(env,user,job,{reason:"first_independent_ledger"});
    assert.equal(first.settled,true);
    assert.equal(first.usedTokens,tokenLedgerFirst?16_781:0);
    assert.equal(first.usedMicrousd,tokenLedgerFirst?0:5_128_092);
    sqlite.prepare(`UPDATE ${hiddenTable} SET status=? WHERE reservation_id=?`).run(restoredStatus,hiddenId);
    const second=await settleInterruptedDocumentJobReservations(env,user,job,{reason:"second_independent_ledger"});
    assert.equal(second.settled,true);
    assert.equal(second.usedTokens,tokenLedgerFirst?0:16_781);
    assert.equal(second.usedMicrousd,tokenLedgerFirst?5_128_092:0);
    assert.equal((await readBudgets(env,user.userId)).user.used,16_781);
    assert.equal((await readCostBudgets(env,user.userId)).user.usedMicrousd,5_128_092);
    assert.equal((await readBudgets(env,user.userId)).user.reserved,0);
    assert.equal((await readCostBudgets(env,user.userId)).user.reservedMicrousd,0);
  });
}

test("receipt settlement never consumes another same-stream operation referenced by a corrupt checkpoint",async()=>{
  const {sqlite,env,user,token,cost,checkpoint,correlation}=await interruptedVideoFixture();
  const unrelatedTokens=await reserveBudget(env,user.userId,100,{streamId:user.streamId,correlationId:correlation,operation:"image-generation"});
  const unrelatedCost=await reserveCostBudget(env,user.userId,1_000,{reservationId:"unrelated-live-replay",maximumMicrousd:1_000,allowUserOverage:false,
    streamId:user.streamId,correlationId:correlation,operation:"live-replay"});
  assert.equal(unrelatedTokens.ok,true);
  assert.equal(unrelatedCost.ok,true);
  const corrupted={...checkpoint,reservationId:unrelatedTokens.reservationId,costReservationId:unrelatedCost.reservationId};
  sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(corrupted),"paid-video");
  const job=sqlite.prepare("SELECT job_id,stream_id,document_id,correlation_id,request_json,result_json FROM document_jobs WHERE job_id=?").get("paid-video");

  assert.equal((await settleInterruptedDocumentJobReservations(env,user,job,{reason:"corrupt_checkpoint"})).settled,false);
  for(const reservationId of [token.reservationId,unrelatedTokens.reservationId])assert.equal(sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(reservationId).status,"active");
  assert.equal((await costBudgetReservation(env,user.userId,cost.reservationId)).status,"executing");
  assert.equal((await costBudgetReservation(env,user.userId,unrelatedCost.reservationId)).status,"active");
});

test("never reconciles another effective stream or an unrelated live replay",async()=>{
  const {sqlite,env,user,token,cost,agedAt}=await interruptedVideoFixture();
  sqlite.prepare("UPDATE budget_reservations SET stream_id=? WHERE reservation_id=?").run("creative:another-persona",token.reservationId);
  sqlite.prepare("UPDATE cost_budget_reservations SET stream_id=? WHERE reservation_id=?").run("creative:another-persona",cost.reservationId);
  const replay=await reserveCostBudget(env,user.userId,500_000,{
    reservationId:"running-replay",maximumMicrousd:500_000,allowUserOverage:false,
    streamId:user.streamId,correlationId:"running-replay",operation:"live-replay",
  });
  assert.equal(replay.ok,true);
  sqlite.prepare("UPDATE cost_budget_reservations SET created_at=? WHERE reservation_id=?").run(agedAt,replay.reservationId);

  assert.deepEqual(await reconcileFailedBudgetReservations(env,user),{releasedTokens:0,reservationCount:0,releasedMicrousd:0,costReservationCount:0});
  assert.equal(sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(token.reservationId).status,"active");
  assert.equal((await costBudgetReservation(env,user.userId,cost.reservationId)).status,"executing");
  assert.equal((await costBudgetReservation(env,user.userId,replay.reservationId)).status,"active");
});

test("allows recovery of an internal reservation conflict without reopening a rejected provider request",()=>{
  const base={
    kind:"render_document",status:"failed",members:[],
    result:{artifactKind:"video",recoverableProductionProviderRequest:true,productionSceneReceipts:{"scene-one":{sceneId:"scene-one",status:"submitted",providerJobId:"fal-paid-scene"}}},
    errorDetail:{code:"cost_reservation_invalid_or_expired",category:"provider",scope:"request",action:"edit_request",message:"Internal reservation mismatch.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:409},
  };
  assert.equal(documentJobCanRecoverProviderRender(base),true);
  assert.equal(documentJobCanRecoverProviderRender({...base,errorDetail:{...base.errorDetail,code:"fal_422",category:"safety",httpStatus:422}}),false);
});

for(const cachedPlan of [true,false]){
  test(`planner-only interrupted recovery ${cachedPlan?"reuses the paid draft":"settles the paid response without purchasing a replacement"}`,async()=>{
    const worker=await integratedProductionWorker();
    const jobId=cachedPlan?"planner-cached":"planner-restarted";
    const fixture=await integratedInterruptedRender(worker,{jobId,artifactKind:"short_story",paidProvider:false,cachedPlan});
    const oldUsage=interruptedDocumentJobUsage(fixture.checkpoint,fixture.payload);
    const newPlannerUsage={inputTokens:100,outputTokens:50,totalTokens:150};
    const originalFetch=globalThis.fetch;
    const calls=[];
    globalThis.fetch=async(input,init={})=>{
      calls.push({url:String(input),method:String(init.method??"GET")});
      return Response.json({id:`${jobId}-new-planner`,model:"gpt-5.6-terra",output_text:JSON.stringify(fixture.plan),
        usage:{input_tokens:newPlannerUsage.inputTokens,output_tokens:newPlannerUsage.outputTokens,total_tokens:newPlannerUsage.totalTokens}});
    };
    try{
      // Explicit foreground recovery must precede observation, which terminalizes stale jobs.
      if(!cachedPlan){assert.equal((await worker.request("/api/document-jobs")).status,200);await worker.drainBackground();}
      assert.equal((await worker.request(`/api/document-jobs/${jobId}/run`,{method:"POST"})).status,200);
      assert.equal((await worker.request("/api/document-jobs")).status,200);await worker.drainBackground();
      const job=worker.sqlite.prepare("SELECT status,error_message FROM document_jobs WHERE job_id=?").get(jobId);
      assert.equal(job.status,cachedPlan?"completed":"failed",job.error_message??"planner recovery should finish");
      if(!cachedPlan)assert.equal(job.error_message,"provider_result_recovery_unavailable");
      assert.equal(calls.length,0,"a known paid response must never be repurchased after interruption");
      assert.deepEqual({...worker.sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE reservation_id=?").get(fixture.token.reservationId)},
        {status:"settled",used_tokens:oldUsage.totalTokens});
      assert.deepEqual({...worker.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId)},
        {status:"settled",used_microusd:oldUsage.totalCostMicrousd});
      const newToken=worker.sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE owner_id=? AND reservation_id<>?").get(fixture.owner,fixture.token.reservationId);
      const newCost=worker.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE owner_id=? AND reservation_id<>?").get(fixture.owner,fixture.cost.reservationId);
      assert.equal(newToken,undefined,"recovery retains the original token reservation");
      assert.equal(newCost,undefined,"recovery retains the original cost reservation");
      const oldReceipts=worker.sqlite.prepare("SELECT payload FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=?")
        .all(fixture.stream,fixture.checkpoint.plannerResponseId).map((event)=>JSON.parse(event.payload));
      assert.equal(oldReceipts.reduce((total,event)=>total+Number(event.total_tokens??0),0),oldUsage.totalTokens,"the interrupted planner response is billed exactly once");
      assert.equal(oldReceipts.reduce((total,event)=>total+Number(event.cost_microusd??0),0),oldUsage.totalCostMicrousd);
      assert.equal((await readBudgets(worker.environment,fixture.owner)).user.reserved,0);
      assert.equal((await readCostBudgets(worker.environment,fixture.owner)).user.reservedMicrousd,0);
      assert.equal((await readBudgets(worker.environment,fixture.owner)).user.used,oldUsage.totalTokens);
    }finally{globalThis.fetch=originalFetch;}
  });
}

for(const artifactKind of ["short_story","video"])test(`observation terminalizes a stale ${artifactKind} original without dispatch or a replacement`,async t=>{
  const worker=await integratedProductionWorker(),jobId="observed-original-"+artifactKind;
  t.after(async()=>{await worker.drainBackground();worker.sqlite.close();});
  const fixture=await integratedInterruptedRender(worker,{jobId,artifactKind,paidProvider:artifactKind==="video"});
  const usage=interruptedDocumentJobUsage(fixture.checkpoint,fixture.payload),calls=[];
  t.mock.method(globalThis,"fetch",async(...args)=>{calls.push(args);assert.fail("Observation cannot dispatch provider recovery");});
  assert.equal((await worker.request("/api/document-jobs")).status,200);await worker.drainBackground();
  const read=()=>worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(jobId);
  const stopped=read();assert.equal(stopped.status,"failed");assert.equal(stopped.error_message,"execution_interrupted");
  assert.equal(stopped.attempt_count,1);assert.equal(stopped.correlation_id,fixture.correlation);
  const checkpoint=JSON.parse(stopped.result_json);assert.deepEqual(checkpoint.artifactPlan,fixture.plan);
  assert.equal(checkpoint.plannerResponseId,fixture.checkpoint.plannerResponseId);
  if(artifactKind==="video")assert.deepEqual(checkpoint.productionSceneReceipts,fixture.checkpoint.productionSceneReceipts);
  assert.equal((await worker.request(`/api/document-jobs/${jobId}/run`,{method:"POST"})).status,200);
  assert.deepEqual(read(),stopped,"a terminal original cannot be restarted by /run");assert.deepEqual(calls,[]);
  assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS n FROM budget_reservations").get().n,1);
  assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,1);
  assert.equal((await readBudgets(worker.environment,fixture.owner)).user.reserved,0);
  assert.equal((await readCostBudgets(worker.environment,fixture.owner)).user.reservedMicrousd,0);
  assert.equal((await readBudgets(worker.environment,fixture.owner)).user.used,usage.totalTokens);
  assert.equal((await readCostBudgets(worker.environment,fixture.owner)).user.usedMicrousd,usage.totalCostMicrousd);
});

test("a stale committing render fails safely and releases both reservations without replaying provider work",async()=>{
  const worker=await integratedProductionWorker();
  const fixture=await integratedInterruptedRender(worker,{jobId:"stale-commit",status:"committing"});
  const originalFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("A committing attempt must never be replayed.");};
  try{
    assert.equal((await worker.request("/api/document-jobs")).status,200);
    await worker.drainBackground();
    assert.equal((await worker.request("/api/document-jobs/stale-commit/run",{method:"POST"})).status,200);
    const job=worker.sqlite.prepare("SELECT status,error_message FROM document_jobs WHERE job_id=?").get("stale-commit");
    assert.deepEqual({...job},{status:"failed",error_message:"execution_interrupted"});
    assert.equal(providerCalls,0);
    assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE status IN ('queued','running','committing')").get().count,0);
    assert.equal(worker.sqlite.prepare("SELECT used_tokens FROM budget_reservations WHERE reservation_id=?").get(fixture.token.reservationId).used_tokens,16_781);
    assert.equal(worker.sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId).used_microusd,5_128_092);
    assert.equal((await readBudgets(worker.environment,fixture.owner)).user.reserved,0);
    assert.equal((await readCostBudgets(worker.environment,fixture.owner)).user.reservedMicrousd,0);
  }finally{globalThis.fetch=originalFetch;}
});

test("cancellation preserves a provider receipt checkpointed immediately before the terminal update",async()=>{
  const worker=await integratedProductionWorker();
  const fixture=await integratedInterruptedRender(worker,{jobId:"cancel-racing-receipt",paidProvider:false,stale:false});
  const updatedCheckpoint={...fixture.checkpoint,productionAnchor:{sceneId:fixture.sceneId},
    productionSceneReceipts:{[fixture.sceneId]:{sceneId:fixture.sceneId,status:"submitted",providerJobId:"fal-racing-receipt",durationSeconds:15}}};
  const originalPrepare=worker.environment.DB.prepare.bind(worker.environment.DB);
  let checkpointInjected=false;
  worker.environment.DB.prepare=(sql)=>{
    const statement=originalPrepare(sql);
    if(!sql.startsWith("UPDATE document_jobs SET status=?,result_json=json_patch"))return statement;
    const originalBind=statement.bind.bind(statement);
    statement.bind=(...values)=>{
      const bound=originalBind(...values);
      const originalRun=bound.run.bind(bound);
      bound.run=async()=>{
        if(!checkpointInjected){
          worker.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(updatedCheckpoint),"cancel-racing-receipt");
          checkpointInjected=true;
        }
        return originalRun();
      };
      return bound;
    };
    return statement;
  };

  const response=await worker.request("/api/document-jobs/cancel-racing-receipt/cancel",{method:"POST"});
  assert.equal(response.status,200);
  assert.equal(checkpointInjected,true);
  const job=worker.sqlite.prepare("SELECT status,result_json FROM document_jobs WHERE job_id=?").get("cancel-racing-receipt");
  assert.equal(job.status,"canceled");
  assert.equal(JSON.parse(job.result_json).productionSceneReceipts[fixture.sceneId].providerJobId,"fal-racing-receipt");
  assert.equal(worker.sqlite.prepare("SELECT used_tokens FROM budget_reservations WHERE reservation_id=?").get(fixture.token.reservationId).used_tokens,16_781);
  assert.equal(worker.sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId).used_microusd,5_128_092);
  assert.equal((await readBudgets(worker.environment,fixture.owner)).user.reserved,0);
  assert.equal((await readCostBudgets(worker.environment,fixture.owner)).user.reservedMicrousd,0);
  await worker.drainBackground();
});

test("cancellation atomically freezes a submitted video when its provider identity races the terminal checkpoint",async()=>{
  for(const [label,anchor] of [["missing",undefined],["null",null],["false",false],["empty",""],["array",[]]]){
    const worker=await integratedProductionWorker();
    const jobId=`cancel-racing-unattributed-video-${label}`;
    const fixture=await integratedInterruptedRender(worker,{jobId,paidProvider:false,plannerUsage:false,cachedPlan:false,stale:false});
    const updatedCheckpoint={...fixture.checkpoint,...(anchor===undefined?{}:{productionAnchor:anchor}),
      generationReceipt:{provider_request_status:"submitted",source_transmission_status:"transmitted",settled_cost_microusd:null,reservation_status:"executing"}};
    const originalPrepare=worker.environment.DB.prepare.bind(worker.environment.DB);
    let checkpointInjected=false;
    worker.environment.DB.prepare=(sql)=>{
      const statement=originalPrepare(sql);
      if(!sql.startsWith("UPDATE document_jobs SET status=?,result_json=json_patch"))return statement;
      const originalBind=statement.bind.bind(statement);
      statement.bind=(...values)=>{
        const bound=originalBind(...values);
        const originalRun=bound.run.bind(bound);
        bound.run=async()=>{
          if(!checkpointInjected){
            worker.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(updatedCheckpoint),jobId);
            checkpointInjected=true;
          }
          return originalRun();
        };
        return bound;
      };
      return statement;
    };

    const response=await worker.request(`/api/document-jobs/${jobId}/cancel`,{method:"POST"});
    assert.equal(response.status,409,`${label}: ${JSON.stringify(await response.clone().json())}`);
    assert.equal((await response.json()).error,"provider_submission_in_flight",label);
    assert.equal(checkpointInjected,true,`${label}: the uncertain receipt appeared after ordinary preflight and before the authoritative SQL update`);
    const retained=worker.sqlite.prepare("SELECT status,result_json FROM document_jobs WHERE job_id=?").get(jobId);
    assert.equal(retained.status,"running",label);
    assert.equal(JSON.parse(retained.result_json).generationReceipt.provider_request_status,"submitted",label);
    assert.equal(worker.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(fixture.token.reservationId).status,"active",label);
    assert.equal(worker.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId).status,"executing",label);
  }
});

for(const missingCostReservation of [false,true]){
  test(`manual provider recovery ${missingCostReservation?"does not forgive an unaccounted provider charge":"reuses only genuinely settled provider charges"}`,async()=>{
    const worker=await integratedProductionWorker();
    const jobId=missingCostReservation?"manual-unpaid-provider":"manual-paid-provider";
    const fixture=await integratedInterruptedRender(worker,{jobId,status:"failed",missingCostReservation});
    addLiveQueueBlocker(worker.sqlite,fixture.owner,fixture.stream);
    const response=await worker.request(`/api/document-jobs/${jobId}/retry`,{method:"POST"});
    assert.equal(response.status,202,JSON.stringify(await response.clone().json()));
    const recovered=(await response.json()).job.result;
    assert.equal(recovered.productionSceneReceipts[fixture.sceneId].providerJobId,`${jobId}-provider`);
    assert.equal(Boolean(recovered.productionPrepaidSceneIds?.includes(fixture.sceneId)),!missingCostReservation);
    assert.equal(recovered.productionPrepaidAnchor===true,!missingCostReservation);
    if(fixture.cost)assert.equal(worker.sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId).used_microusd,5_128_092);
    await worker.drainBackground();
  });
}

test("manual recovery refuses to duplicate a partially settled provider charge",async()=>{
  const worker=await integratedProductionWorker();
  const jobId="manual-partial-provider";
  const fixture=await integratedInterruptedRender(worker,{jobId,status:"failed"});
  const partialReservationMicrousd=5_050_000;
  const reduction=56_932_000-partialReservationMicrousd;
  worker.sqlite.prepare("UPDATE cost_budget_reservations SET reserved_microusd=? WHERE reservation_id=?").run(partialReservationMicrousd,fixture.cost.reservationId);
  worker.sqlite.prepare("UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd-? WHERE period=?").run(reduction,fixture.token.period);
  worker.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?")
    .run(JSON.stringify({...fixture.checkpoint,costReservationMicrousd:partialReservationMicrousd}),jobId);

  const response=await worker.request(`/api/document-jobs/${jobId}/retry`,{method:"POST"});
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{
    error:"provider_charge_settlement_incomplete",
    message:"This provider request was only partially settled. Recovering it would charge the same provider work twice.",
    accountedProviderCostMicrousd:4_957_908,
    documentedProviderCostMicrousd:5_036_000,
  });
  assert.equal(worker.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(jobId).status,"failed");
  assert.equal(worker.sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId).used_microusd,partialReservationMicrousd);
  assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE owner_id=?").get(fixture.owner).count,1,"partial recovery must not create a second paid attempt");
  assert.equal((await readCostBudgets(worker.environment,fixture.owner)).user.reservedMicrousd,0);
});

test("manual single-video recovery recognizes an already-paid provider ID retained only in its failure event",async()=>{
  const worker=await integratedProductionWorker();
  const jobId="manual-event-only-provider";
  const fixture=await integratedInterruptedRender(worker,{jobId,status:"failed",paidProvider:false,productionMode:"manual"});
  const providerCostMicrousd=4_536_000;
  const plannerCostMicrousd=92_092;
  await settleBudget(worker.environment,fixture.owner,fixture.token.reservationId,16_781);
  await settleCostBudget(worker.environment,fixture.owner,fixture.cost.reservationId,providerCostMicrousd+plannerCostMicrousd);
  await appendAuditEvent(worker.environment,fixture.stream,"worker:renderer","DocumentRenderFailed",{
    artifact_id:fixture.checkpoint.artifactId,artifact_kind:"video",provider_job_id:"fal-event-only-provider",
  },fixture.correlation);
  await appendAuditEvent(worker.environment,fixture.stream,"worker:policy","GenerationUsageRecorded",{
    reservation_id:fixture.token.reservationId,cost_reservation_id:fixture.cost.reservationId,
    planner_response_id:fixture.checkpoint.plannerResponseId,total_tokens:16_781,cost_microusd:providerCostMicrousd+plannerCostMicrousd,
  },fixture.correlation);
  addLiveQueueBlocker(worker.sqlite,fixture.owner,fixture.stream);

  const response=await worker.request(`/api/document-jobs/${jobId}/retry`,{method:"POST"});
  assert.equal(response.status,202,JSON.stringify(await response.clone().json()));
  const recovered=(await response.json()).job.result;
  assert.equal(recovered.providerJobId,"fal-event-only-provider");
  assert.equal(recovered.prepaidProviderCostMicrousd,providerCostMicrousd,"the existing Fal request must never be billed twice");
  await worker.drainBackground();
});

test("impersonated cancellation requires confirmation and settles only the effective stream",async()=>{
  const worker=await integratedProductionWorker();
  const impersonation=addRecoveryImpersonation(worker);
  const fixture=await integratedInterruptedRender(worker,{jobId:"impersonated-provider",owner:impersonation.userId,billingOwner:"dev-local-creative",stale:false});
  const principalToken=await reserveBudget(worker.environment,"dev-local-creative",100,{streamId:"creative:dev-local-creative",correlationId:"principal-render",operation:"document-render:short_story"});
  const principalCost=await reserveCostBudget(worker.environment,"dev-local-creative",1_000,{reservationId:"principal-render-cost",maximumMicrousd:1_000,allowUserOverage:false,streamId:"creative:dev-local-creative",correlationId:"principal-render",operation:"document-render:short_story"});
  const replayCost=await reserveCostBudget(worker.environment,"dev-local-creative",500,{reservationId:"principal-live-replay",maximumMicrousd:500,allowUserOverage:false,streamId:"creative:dev-local-creative",correlationId:"principal-live-replay",operation:"live-replay"});
  assert.equal(principalToken.ok,true);
  assert.equal(principalCost.ok,true);
  assert.equal(replayCost.ok,true);

  const unconfirmed=await worker.request("/api/document-jobs/impersonated-provider/cancel",{method:"POST",headers:{cookie:impersonation.cookie}});
  assert.equal(unconfirmed.status,428);
  assert.equal(worker.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get("impersonated-provider").status,"running");
  assert.equal(worker.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId).status,"executing");

  const confirmed=await worker.request("/api/document-jobs/impersonated-provider/cancel",{
    method:"POST",headers:impersonation.headers,
  });
  assert.equal(confirmed.status,200,JSON.stringify(await confirmed.clone().json()));
  assert.equal(worker.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId).used_microusd,5_128_092);
  assert.equal(worker.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(principalToken.reservationId).status,"active");
  assert.equal(worker.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(principalCost.reservationId).status,"active");
  assert.equal(worker.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(replayCost.reservationId).status,"active");
  assert.equal((await readBudgets(worker.environment,"dev-local-creative")).user.reserved,100);
  assert.equal((await readCostBudgets(worker.environment,"dev-local-creative")).user.reservedMicrousd,1_500);
  await worker.drainBackground();
});

test("impersonated cancellation never releases a principal reservation sharing the same correlation",async()=>{
  const worker=await integratedProductionWorker();
  const impersonation=addRecoveryImpersonation(worker,"fictional-correlation");
  const fixture=await integratedInterruptedRender(worker,{jobId:"colliding-correlation",owner:impersonation.userId,
    billingOwner:"dev-local-creative",paidProvider:false,plannerUsage:false,cachedPlan:false,stale:false});
  const principalToken=await reserveBudget(worker.environment,"dev-local-creative",100,{streamId:"creative:dev-local-creative",correlationId:fixture.correlation,operation:"document-render:video"});
  const principalCost=await reserveCostBudget(worker.environment,"dev-local-creative",1_000,{reservationId:"colliding-principal-cost",maximumMicrousd:1_000,
    allowUserOverage:false,streamId:"creative:dev-local-creative",correlationId:fixture.correlation,operation:"document-render:video"});
  assert.equal(principalToken.ok,true);
  assert.equal(principalCost.ok,true);

  const response=await worker.request(`/api/document-jobs/${"colliding-correlation"}/cancel`,{method:"POST",headers:impersonation.headers});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.equal(worker.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(fixture.token.reservationId).status,"released");
  assert.equal(worker.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.cost.reservationId).status,"released");
  assert.equal(worker.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(principalToken.reservationId).status,"active");
  assert.equal(worker.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(principalCost.reservationId).status,"active");
  await worker.drainBackground();
});

test("impersonated manual recovery never treats a principal's settled provider reservation as its own",async()=>{
  const worker=await integratedProductionWorker();
  const impersonation=addRecoveryImpersonation(worker,"fictional-prepaid");
  const fixture=await integratedInterruptedRender(worker,{jobId:"fictional-prepaid-provider",status:"failed",owner:impersonation.userId,
    billingOwner:"dev-local-creative",missingCostReservation:true});
  const principalCost=await reserveCostBudget(worker.environment,"dev-local-creative",6_000_000,{reservationId:"principal-settled-provider",maximumMicrousd:6_000_000,
    allowUserOverage:false,streamId:"creative:dev-local-creative",correlationId:fixture.correlation,operation:"document-render:video",period:fixture.token.period});
  assert.equal(principalCost.ok,true);
  await settleCostBudget(worker.environment,"dev-local-creative",principalCost.reservationId,5_036_000);
  const crossStreamCheckpoint={...fixture.checkpoint,costReservationId:principalCost.reservationId};
  worker.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(crossStreamCheckpoint),"fictional-prepaid-provider");
  addLiveQueueBlocker(worker.sqlite,fixture.owner,fixture.stream);

  const response=await worker.request("/api/document-jobs/fictional-prepaid-provider/retry",{method:"POST",headers:impersonation.headers});
  assert.equal(response.status,202,JSON.stringify(await response.clone().json()));
  const recovered=(await response.json()).job.result;
  assert.equal(recovered.productionSceneReceipts[fixture.sceneId].providerJobId,"fictional-prepaid-provider-provider");
  assert.equal(recovered.productionPrepaidSceneIds?.includes(fixture.sceneId)??false,false);
  assert.notEqual(recovered.productionPrepaidAnchor,true);
  assert.deepEqual({...worker.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(principalCost.reservationId)},
    {status:"settled",used_microusd:5_036_000});
  await worker.drainBackground();
});

test("the bundled worker resumes a submitted scene without a duplicate provider request or stranded reservations",async()=>{
  const {sqlite,environment,request,drainBackground}=await integratedProductionWorker();
  const owner="dev-local-creative";
  const stream=`creative:${owner}`;
  const jobId="integration-paid-video";
  const correlation=`${jobId}:attempt:1`;
  const operation="document-render:video";
  const agedAt=new Date(Date.now()-10*60_000).toISOString();
  const expiresAt=new Date(Date.now()+86_400_000).toISOString();
  const action="A quiet harbor wakes beneath warm morning light.";
  await appendAuditEvent(environment,stream,"user","ReferenceIngested",{project_id:"project-atmosphere",document_id:"doc-atmosphere",reference_id:"recovery-shot-reference",source_type:"licensed-fixture",rights_class:"owned"});
  await appendAuditEvent(environment,stream,"user","RightsAsserted",{project_id:"project-atmosphere",reference_id:"recovery-shot-reference",rights_class:"owned_or_licensed"});
  await appendAuditEvent(environment,stream,"user","BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"shot-one",type:"reference",handle:"reference/recovery-shot",position:"z-recovery",properties:{reference_id:"recovery-shot-reference",text:action,storyboard_frame_index:1,source_artifact_id:"board-one",storyboard_shot_title:"Opening",storyboard_shot_direction:action,weight:1,authority:"authored"}});
  const snapshot={facts:[{block_id:"shot-one",type:"reference",properties:{text:action,storyboard_frame_index:1,source_artifact_id:"board-one",storyboard_shot_title:"Opening",storyboard_shot_direction:action}}]};
  const productionPlan=buildManagedProductionPlan("video",snapshot,{preferredSceneSeconds:15});
  const scene=productionPlan.scenes[0];
  const token=await reserveBudget(environment,owner,64_000,{streamId:stream,correlationId:correlation,operation});
  const cost=await reserveCostBudget(environment,owner,56_932_000,{
    reservationId:"integration-cost",maximumMicrousd:56_932_000,allowUserOverage:false,
    streamId:stream,correlationId:correlation,operation,period:token.period,
  });
  assert.equal(token.ok,true);
  assert.equal(cost.ok,true);
  assert.equal(await claimCostBudgetReservation(environment,owner,cost.reservationId),true);
  const providerJobId="fal-paid-scene";
  const providerRoot=`https://queue.fal.run/bytedance/seedance-2.0/requests/${providerJobId}`;
  const checkpoint={
    artifactKind:"video",artifactId:"integration-artifact",reservationId:token.reservationId,
    costReservationId:cost.reservationId,costReservationMicrousd:56_932_000,costReservationPeriod:token.period,
    plannerModel:"gpt-5.6-terra",plannerResponseId:"integration-planner",
    plannerUsage:{inputTokens:10_928,outputTokens:5_853,totalTokens:16_781},
    productionPlan,productionAnchor:{sceneId:scene.id},
    artifactPlan:{title:"Harbor",summary:"A harbor wakes.",content_markdown:action,presentation:null,
      items:[{title:"Opening",body:action,notes:"Slow tracking shot.",image_prompt:action,context_group_ids:[],slide:null}]},
    productionSceneReceipts:{[scene.id]:{
      sceneId:scene.id,narrativeOrder:1,generationOrder:1,status:"submitted",providerJobId,
      providerModel:"bytedance/seedance-2.0/reference-to-video",providerStatusUrl:`${providerRoot}/status`,
      providerResponseUrl:providerRoot,providerCancelUrl:`${providerRoot}/cancel`,durationSeconds:scene.durationSeconds,
      referenceIds:[],dependsOn:[],startBoundaryGuidanceId:null,endBoundaryGuidanceId:null,
      videoInputReceipt:{provider:"fal",model:"bytedance/seedance-2.0/reference-to-video",submitted_prompt:action,
        parameters:{duration:scene.durationSeconds,resolution:"720p",aspect_ratio:"16:9",generate_audio:false},reference_inputs:[],used_reference_pixels:false},
    }},recoverableProductionProviderRequest:true,
  };
  const payload={documentRevision:"revision-one",requestKey:"render-video",artifactKind:"video",productionMode:"managed",paidMediaConfirmed:true,snapshot};
  sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobId,owner,stream,"doc-atmosphere","render_document","running","studio",correlation,1,JSON.stringify(payload),JSON.stringify(checkpoint),null,1,agedAt,agedAt,null,agedAt,null,expiresAt,agedAt);

  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);
    calls.push({url,method:String(init.method??"GET")});
    if(url.startsWith(`${providerRoot}/status`))return Response.json({request_id:providerJobId,status:"COMPLETED"});
    if(url===providerRoot)return Response.json({video:{url:"https://v3b.fal.media/files/test/recovered.mp4",content_type:"video/mp4"}});
    if(url==="https://v3b.fal.media/files/test/recovered.mp4")return new Response(Uint8Array.from([0,1,2,3]),{headers:{"content-type":"video/mp4"}});
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try{
    // Resume the retained original in the explicit foreground request.
    // List observation intentionally terminalizes stale foreground work.
    assert.equal((await request(`/api/document-jobs/${jobId}/run`,{method:"POST"})).status,200);
    assert.equal((await request("/api/document-jobs")).status,200);await drainBackground();
    const job=sqlite.prepare("SELECT status,correlation_id,error_message FROM document_jobs WHERE job_id=?").get(jobId);
    assert.equal(job.status,"completed",job.error_message??"recovered job should finish");
    assert.equal(job.correlation_id,`${jobId}:attempt:2`);
    assert.equal(calls.some((call)=>call.method==="POST"),false,"recovery must reuse the paid provider request and cached plan");
    assert.equal(sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE reservation_id=?").get(token.reservationId).status,"settled");
    assert.equal(sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(cost.reservationId).status,"settled");
    assert.equal((await readBudgets(environment,owner)).user.reserved,0);
    assert.equal((await readCostBudgets(environment,owner)).user.reservedMicrousd,0);
    assert.equal((await readBudgets(environment,owner)).user.used,16_781);
    assert.equal((await readCostBudgets(environment,owner)).user.usedMicrousd,92_092+scene.durationSeconds*302_400+500_000);
  }finally{globalThis.fetch=originalFetch;}
});

async function legacySlidesSettlementFixture(){
  const {sqlite,env}=reconciliationDatabase();await ensureSchema(env);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='budget_hold_dispositions'").get().n,0,"runtime initialization must not create the administrative schema");
  sqlite.exec(await readFile(new URL("../db/operations/budget-hold-dispositions.sql",import.meta.url),"utf8"));
  const user={userId:"slides-owner",streamId:"creative:slides-owner"},jobId="paid-slides",correlation=jobId+":attempt:1",operation="document-render:slides",now=new Date().toISOString();
  const token=await reserveBudget(env,user.userId,1000,{streamId:user.streamId,correlationId:correlation,operation});assert.equal(token.ok,true);
  const cost=await reserveCostBudget(env,user.userId,1000,{reservationId:"slides-cost",maximumMicrousd:1000,allowUserOverage:false,streamId:user.streamId,correlationId:correlation,operation,period:token.period});assert.equal(cost.ok,true);
  assert.equal(await claimCostBudgetReservation(env,user.userId,cost.reservationId),true);
  const call=(id,model,input,output,costMicrousd)=>({clientRequestId:id,provider:"openai",operation:"planning",model,unitId:"planning:0:"+id,status:"completed",providerRequestId:"response-"+id,inputTokens:input,outputTokens:output,totalTokens:input+output,costMicrousd});
  const checkpoint={artifactKind:"slides",reservationId:token.reservationId,costReservationId:cost.reservationId,costReservationPeriod:token.period,
    providerSubmissionProtocol:1,providerSubmissions:{initial:call("initial","gpt-5.6-terra",100,40,990),repair:call("repair","gpt-5.6-sol",70,30,1234)},
    presentationProviderSubmission:"confirmed",presentationProviderClientRequestId:"repair",plannerModel:"gpt-5.6-terra",plannerResponseId:"response-repair",plannerResponseIds:["response-initial","response-repair"],
    generationReceipt:{version:1,provider_request_status:"submitted",actual_provider_call_count:2}};
  sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobId,user.userId,user.streamId,"slides-document","render_document","failed","studio",correlation,1,JSON.stringify({artifactKind:"slides",itemCount:6}),JSON.stringify(checkpoint),"execution_interrupted",1,now,now,now,null,null,new Date(Date.now()+86400000).toISOString(),now);
  await appendAuditEvent(env,user.streamId,"worker:policy","BudgetReserved",{operation,reservation_id:token.reservationId,cost_reservation_id:cost.reservationId,reserved_tokens:1000,reserved_microusd:1000,period:token.period},correlation);
  const job=()=>sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(jobId);
  const save=(value)=>sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(value),jobId);
  const usages=()=>sqlite.prepare("SELECT payload FROM events WHERE type='GenerationUsageRecorded' ORDER BY sequence").all().map(row=>JSON.parse(row.payload));
  const snapshot=()=>JSON.stringify({tokens:sqlite.prepare("SELECT * FROM budget_reservations").all(),cost:sqlite.prepare("SELECT * FROM cost_budget_reservations").all(),tokenCounters:sqlite.prepare("SELECT * FROM budget_counters ORDER BY scope,scope_id").all(),costCounters:sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id").all(),events:sqlite.prepare("SELECT * FROM events ORDER BY sequence").all()});
  return{sqlite,env,user,token,cost,checkpoint,correlation,job,save,usages,snapshot};
}

test("legacy slide reconciliation settles immutable per-call prices without clipping or repricing",async()=>{
  const f=await legacySlidesSettlementFixture();
  const result=await settleLegacyPresentationReservations(f.env,f.user,f.job());
  assert.equal(result.status,"known");assert.equal(result.settled,true);assert.equal(result.usedTokens,240);assert.equal(result.usedMicrousd,2224,"actual paid cost may exceed the original hold");
  for(const scope of ["user","workspace"]){
    assert.deepEqual({...f.sqlite.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope=?").get(scope)},{used_tokens:240,reserved_tokens:0});
    assert.deepEqual({...f.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope=?").get(scope)},{used_microusd:2224,reserved_microusd:0});
  }
  const usage=f.usages();assert.equal(usage.length,1);assert.equal(usage[0].input_tokens,170);assert.equal(usage[0].output_tokens,70);assert.equal(usage[0].cost_microusd,2224);
  const before=f.snapshot();assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).settled,false);assert.equal(f.snapshot(),before);
});

for(const paidInitial of [true,false])test("legacy slide reconciliation accepts exact definitive rejection with "+(paidInitial?"paid initial work":"no paid work"),async()=>{
  const f=await legacySlidesSettlementFixture(),rejected={clientRequestId:"repair",provider:"openai",operation:"planning",model:"gpt-5.6-sol",unitId:"planning:0:repair",status:"rejected",costMicrousd:0};
  f.checkpoint.providerSubmissions=paidInitial?{initial:f.checkpoint.providerSubmissions.initial,repair:rejected}:{repair:rejected};
  f.checkpoint.plannerResponseId=paidInitial?"response-initial":null;f.checkpoint.plannerResponseIds=paidInitial?["response-initial"]:[];f.checkpoint.generationReceipt.actual_provider_call_count=paidInitial?2:1;f.save(f.checkpoint);
  const result=await settleLegacyPresentationReservations(f.env,f.user,f.job());assert.equal(result.status,"known");assert.equal(result.usedTokens,paidInitial?140:0);assert.equal(result.usedMicrousd,paidInitial?990:0);
  assert.equal((await readCostBudgets(f.env,f.user.userId)).user.reservedMicrousd,0);assert.equal(f.usages().length,paidInitial?1:0);
});

for(const previousCost of [0,1000])test("legacy slide reconciliation repairs an already-settled audit gap of "+(2224-previousCost)+" microusd without touching counters",async()=>{
  const f=await legacySlidesSettlementFixture();
  await settleBudget(f.env,f.user.userId,f.token.reservationId,240);await settleCostBudget(f.env,f.user.userId,f.cost.reservationId,2224);
  if(previousCost)await appendAuditEvent(f.env,f.user.streamId,"worker:policy","GenerationUsageRecorded",{document_id:"slides-document",reservation_id:f.token.reservationId,cost_reservation_id:f.cost.reservationId,total_tokens:240,cost_microusd:previousCost},f.correlation);
  const ledger=()=>JSON.stringify({tokens:f.sqlite.prepare("SELECT * FROM budget_reservations").all(),cost:f.sqlite.prepare("SELECT * FROM cost_budget_reservations").all(),tokenCounters:f.sqlite.prepare("SELECT * FROM budget_counters").all(),costCounters:f.sqlite.prepare("SELECT * FROM cost_budget_counters").all()});
  const before=ledger(),result=await settleLegacyPresentationReservations(f.env,f.user,f.job());
  assert.equal(result.status,"known");assert.equal(result.settled,false);assert.equal(result.auditRepaired,true);assert.equal(ledger(),before);
  assert.equal(f.usages().reduce((sum,value)=>sum+value.total_tokens,0),240);assert.equal(f.usages().reduce((sum,value)=>sum+value.cost_microusd,0),2224);
  const after=f.snapshot();assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).auditRepaired,false);assert.equal(f.snapshot(),after);
});

for(const tokenFirst of [true,false])test("legacy slide reconciliation finishes the other ledger after "+(tokenFirst?"tokens":"dollars")+" settled first",async()=>{
  const f=await legacySlidesSettlementFixture();
  if(tokenFirst)await settleBudget(f.env,f.user.userId,f.token.reservationId,240);else await settleCostBudget(f.env,f.user.userId,f.cost.reservationId,2224);
  const result=await settleLegacyPresentationReservations(f.env,f.user,f.job());assert.equal(result.status,"known");assert.equal(result.settled,true);
  assert.equal((await readBudgets(f.env,f.user.userId)).user.used,240);assert.equal((await readCostBudgets(f.env,f.user.userId)).user.usedMicrousd,2224);
  assert.equal(f.usages().length,1);assert.equal(f.usages()[0].total_tokens,240);assert.equal(f.usages()[0].cost_microusd,2224);
});

test("legacy slide reconciliation leaves unresolved, mismatched and invalid call evidence untouched",async()=>{
  const cases=[
    ["pending repair",c=>{c.providerSubmissions.repair.status="pending";}],
    ["legacy pending repair",c=>{delete c.providerSubmissions.repair;c.presentationProviderSubmission="pending";}],
    ["different current client",c=>{c.presentationProviderClientRequestId="unrecorded-repair";}],
    ["unidentified legacy uncertainty",c=>{delete c.presentationProviderClientRequestId;c.generationReceipt.provider_request_status="submission_unknown";}],
    ["legacy uncertain flag",c=>{c.providerSubmissionLegacyUncertain=true;}],
    ["invalid generic map",c=>{c.providerSubmissions=[];}],
    ["missing cost",c=>{delete c.providerSubmissions.repair.costMicrousd;}],
    ["inconsistent tokens",c=>{c.providerSubmissions.repair.totalTokens=99;}],
    ["fractional cost",c=>{c.providerSubmissions.repair.costMicrousd=0.5;}],
    ["duplicate response",c=>{c.providerSubmissions.repair.providerRequestId="response-initial";}],
    ["other operation",c=>{c.providerSubmissions.repair.operation="image";}],
    ["aggregate records another response",c=>{c.plannerUsage={inputTokens:180,outputTokens:70,totalTokens:250};}],
    ["request count records another call",c=>{c.plannerInput={provider_request_count:3};}],
  ];
  for(const [name,change] of cases){const f=await legacySlidesSettlementFixture();change(f.checkpoint);f.save(f.checkpoint);const before=f.snapshot();assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).status,"uncertain",name);assert.equal(f.snapshot(),before,name);}
});

test("legacy slide reconciliation does not consume another attempt, scope or operation",async()=>{
  for(const [field,value] of [["correlation_id","paid-slides:attempt:2"],["operation","document-render:audio"],["stream_id","creative:another-owner"],["period","1900-01"]]){
    const f=await legacySlidesSettlementFixture();f.sqlite.prepare("UPDATE cost_budget_reservations SET "+field+"=?").run(value);const before=f.snapshot();
    assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).status,"conflict");assert.equal(f.snapshot(),before);
  }
  const f=await legacySlidesSettlementFixture(),before=f.snapshot();assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job(),{assertions:[{sql:"0"}]})).status,"conflict");assert.equal(f.snapshot(),before);
});

test("legacy slide reconciliation does not recharge when positive audit usage conflicts with an active ledger",async()=>{
  const f=await legacySlidesSettlementFixture();await appendAuditEvent(f.env,f.user.streamId,"worker:policy","GenerationUsageRecorded",{document_id:"slides-document",reservation_id:f.token.reservationId,cost_reservation_id:f.cost.reservationId,total_tokens:240,cost_microusd:2224},f.correlation);
  const before=f.snapshot();assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).status,"conflict");assert.equal(f.snapshot(),before);
});

test("legacy slide reconciliation rolls back silent audit or counter no-ops",async()=>{
  for(const trigger of ["CREATE TRIGGER reject_reconciliation BEFORE INSERT ON events WHEN NEW.type='GenerationUsageRecorded' BEGIN SELECT RAISE(IGNORE); END", "CREATE TRIGGER reject_reconciliation BEFORE UPDATE ON cost_budget_counters WHEN NEW.scope='user' BEGIN SELECT RAISE(IGNORE); END"]){
    const f=await legacySlidesSettlementFixture();f.sqlite.exec(trigger);const before=f.snapshot();
    assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).status,"conflict");assert.equal(f.snapshot(),before,"the entire settlement must roll back");
    f.sqlite.exec("DROP TRIGGER reject_reconciliation");assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).status,"known");assert.equal(f.usages().length,1);
  }
});

for(const auditOnly of [false,true])test("concurrent legacy slide reconciliation "+(auditOnly?"repairs settled audit gaps":"settles and audits")+" exactly once",async()=>{
  const f=await legacySlidesSettlementFixture(),row=f.job();
  if(auditOnly){await settleBudget(f.env,f.user.userId,f.token.reservationId,240);await settleCostBudget(f.env,f.user.userId,f.cost.reservationId,2224);}
  const results=await Promise.all([settleLegacyPresentationReservations(f.env,f.user,row),settleLegacyPresentationReservations(f.env,f.user,row)]);
  assert.deepEqual(results.map(value=>value.status),["known","known"]);assert.equal(results.filter(value=>auditOnly?value.auditRepaired:value.settled).length,1);assert.equal(f.usages().length,1);
  assert.equal((await readBudgets(f.env,f.user.userId)).user.used,240);assert.equal((await readCostBudgets(f.env,f.user.userId)).user.usedMicrousd,2224);
});

test("legacy slide reconciliation recognizes a committed transaction after losing its acknowledgement",async()=>{
  const f=await legacySlidesSettlementFixture(),batch=f.env.DB.batch.bind(f.env.DB);let lost=false;
  f.env.DB.batch=async(statements)=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql.startsWith("INSERT INTO output_atomic_assertions"))){lost=true;throw new Error("lost_settlement_ack");}return result;};
  assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).status,"known");assert.equal(lost,true);assert.equal(f.usages().length,1);
  const before=f.snapshot();assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).settled,false);assert.equal(f.snapshot(),before);
});

test("legacy slide reconciliation cannot settle over a concurrently persisted pending repair",async()=>{
  const f=await legacySlidesSettlementFixture(),batch=f.env.DB.batch.bind(f.env.DB),row=f.job(),before=f.snapshot();let raced=false;
  f.env.DB.batch=async(statements)=>{if(!raced&&statements.some(statement=>statement.sql.startsWith("INSERT INTO output_atomic_assertions"))){raced=true;f.checkpoint.presentationProviderSubmission="pending";f.checkpoint.presentationProviderClientRequestId="later-repair";f.save(f.checkpoint);}return batch(statements);};
  assert.equal((await settleLegacyPresentationReservations(f.env,f.user,row)).status,"conflict");assert.equal(raced,true);assert.equal(f.snapshot(),before);
  assert.equal(JSON.parse(f.job().result_json).presentationProviderClientRequestId,"later-repair");
});

async function assertBundledOutputReconciliationHistory(context,present){
  const failures=[];
  let fixture;
  let fetchCalls=0;
  const owner="dev-local-creative",stream="creative:dev-local-creative",actor="user:dev-local-creative";
  const historySql="SELECT EXISTS(SELECT 1 FROM events WHERE type='OutputExecutionAuthorized' AND (stream_id=? OR actor=?)) AS present";
  const tables=["output_execution_grants","output_operation_slots","document_jobs","budget_reservations","cost_budget_reservations","output_provider_calls","output_native_storage_writes"];
  const emptyOutputRows=()=>{
    for(const table of tables){
      const exists=fixture.sqlite.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if(exists)assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM "+table).get().count,0,table);
      // Absence is valid: do not initialize output schema in the no-history branch.
    }
  };
  const collect=async action=>{try{await action();}catch(error){failures.push(error);}};
  try{
    context.mock.method(globalThis,"fetch",async()=>{
      fetchCalls++;
      throw new Error("bundled_output_reconciliation_network_forbidden");
    });
    fixture=await integratedProductionWorker();
    await fixture.drainBackground();
    emptyOutputRows();
    assert.equal(fixture.sqlite.prepare(historySql).get(stream,actor).present,0);
    if(present){
      // A synthetic history marker, not a grant or provider authorization.
      await appendAuditEvent(fixture.environment,stream,actor,"OutputExecutionAuthorized",{
        grant_id:"f-historical-linkage-only",scope_kind:"personal",
        owner_user_id:owner,actor_user_id:owner,fixture_only:true,
      },"f-output-reconciliation-history");
    }
    assert.equal(fixture.sqlite.prepare(historySql).get(stream,actor).present,Number(present));
    const beforeConsent=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND type='ConsentAccepted'").get(stream).count;
    const witnesses=[
      {name:"known-receipt",kind:"first",prefix:"SELECT slot.scope_key,slot.slot_id,slot.grant_id,slot.token_reservation_id,slot.cost_reservation_id,slot.updated_at, job.job_id,job.kind,job.owner_id,job.stream_id,job.document_id,job.status,job.correlation_id,",count:0},
      {name:"expired-grant",kind:"all",prefix:"SELECT grant_row.scope_key,grant_row.grant_id,grant_row.actor_user_id,grant_row.context_id,grant_row.payer_user_id, plan.scope_kind,plan.owner_user_id,plan.project_id,plan.document_id,plan.organization_id,plan.project_access_id FROM output_execution_grants grant_row JOIN output_plan_revisions plan ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id WHERE (grant_row.payer_user_id=? OR (plan.scope_kind='personal' AND grant_row.payer_user_id<>grant_row.actor_user_id)) AND grant_row.actor_user_id=? AND grant_row.expires_at<=?",count:0},
      {name:"native-storage",kind:"run",prefix:"WITH retained_fal_grants AS MATERIALIZED (",count:0},
    ];
    const prototype=Object.getPrototypeOf(fixture.environment.DB.prepare("SELECT 1"));
    const execute=prototype.execute;
    context.mock.method(prototype,"execute",function(kind){
      const sql=this.sql.replace(/\s+/gu," ").trim();
      const witness=witnesses.find(candidate=>sql.startsWith(candidate.prefix));
      if(witness)assert.equal(kind,witness.kind,witness.name+" execution kind");
      const result=Reflect.apply(execute,this,[kind]);
      if(witness)witness.count++;
      return result;
    });
    const response=await fixture.request("/api/session",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"accept_terms",ownershipConfirmed:true,providerProcessingConfirmed:true}),
    });
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.user?.userId,owner);
    assert.equal(body.audience,"creative");
    assert.equal(body.policy?.accepted,true);
    assert.ok(Array.isArray(body.capabilities));
    await fixture.drainBackground();
    assert.deepEqual(witnesses.map(({name,count})=>[name,count]),witnesses.map(({name})=>[name,Number(present)]));
    assert.equal(fixture.sqlite.prepare(historySql).get(stream,actor).present,Number(present));
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND type='ConsentAccepted'").get(stream).count,beforeConsent+1);
    emptyOutputRows();
  }catch(error){failures.push(error);}
  finally{
    if(fixture){
      await collect(()=>fixture.drainBackground());
      await collect(emptyOutputRows);
      await collect(()=>fixture.sqlite.close());
    }
    await collect(()=>assert.equal(fetchCalls,0,"no fetch during setup, request, or background cleanup"));
    await collect(()=>context.mock.restoreAll());
  }
  if(failures.length===1)throw failures[0];
  if(failures.length>1)throw new AggregateError(failures,"Bundled output reconciliation regression and cleanup failed");
}

test("bundled output reconciliation skips the producer with no authorization history",async context=>{
  await assertBundledOutputReconciliationHistory(context,false);
});

test("bundled output reconciliation reaches the producer with authorization history",async context=>{
  await assertBundledOutputReconciliationHistory(context,true);
});

import { applyHoldDisposition, previewHoldDisposition, HOLD_ACKNOWLEDGEMENT } from "../worker/budget-hold-dispositions.ts";
import { verifyHoldDisposition } from "../worker/budget-hold-verification.ts";
import { handleHoldDispositions } from "../worker/budget-hold-api.ts";
import { requireExistingHoldAdministrator, releaseBudget, releaseCostBudget, POLICY_VERSION } from "../worker/pilot-policy.ts";
import { presentationCandidateAccounting } from "../src/model/presentation-candidates.ts";

async function administrativeHoldFixture() {
  const f=await legacySlidesSettlementFixture();
  const now=new Date().toISOString();
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'admin',?,?,?,?)")
    .run(f.user.userId,"hold-admin@example.test","Hold admin",POLICY_VERSION,now,now,now);
  f.env.FORMA_HOLD_DISPOSITION_ENABLED="true";
  f.save({...f.checkpoint,presentationProviderSubmission:"pending",generationReceipt:{provider_request_status:"submission_unknown"}});
  f.headers={origin:"https://forma.test","content-type":"application/json","oai-authenticated-user-id":f.user.userId,"oai-authenticated-user-email":"hold-admin@example.test"};
  f.request=(body,extra={})=>new Request("https://forma.test/api/admin/budget-hold-dispositions",{method:"POST",headers:{...f.headers,...extra},body:JSON.stringify(body)});
  f.user=(await requireExistingHoldAdministrator(f.request({}),f.env)).user;
  const preview=await previewHoldDisposition(f.env,f.user,f.job().job_id);
  f.command={dispositionId:"hold-test-1",jobId:f.job().job_id,previewSha256:preview.previewSha256,approvalRef:"test-fixture-approval",supportRef:"test-fixture-support",
    reason:"Synthetic test: provider cannot resolve historical billing",evidenceSha256:"e".repeat(64),acknowledgement:HOLD_ACKNOWLEDGEMENT};
  f.fullSnapshot=()=>JSON.stringify({finance:f.snapshot(),holds:f.sqlite.prepare("SELECT * FROM budget_hold_dispositions").all(),job:f.job()});
  return f;
}

function denyWrites(env) {
  return {...env,DB:{prepare(sql){assert.match(sql,/^\s*SELECT\b/i,"follow-up must issue SELECT only");return env.DB.prepare(sql);},batch(statements){return env.DB.batch(statements);}}};
}

test("administrative hold: atomic capacity release preserves unknown provider evidence and settled spending",async()=>{
  const f=await administrativeHoldFixture(),original=f.job().result_json;
  const result=await applyHoldDisposition(f.env,f.user,f.command);
  assert.equal(result.applied,true);
  const verified=await verifyHoldDisposition(denyWrites(f.env),f.user.userId,f.command.dispositionId);
  assert.equal(verified.verified,true,JSON.stringify(verified.checks));
  assert.equal(f.job().result_json,original);
  assert.equal(f.usages().length,0);
  for(const table of ["budget_counters","cost_budget_counters"]){
    const unit=table==="budget_counters"?"tokens":"microusd";
    for(const row of f.sqlite.prepare(`SELECT * FROM ${table}`).all())assert.deepEqual([row[`used_${unit}`],row[`reserved_${unit}`]],[0,0]);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BudgetHoldAdministrativelyReleased'").get().n,1);
  assert.throws(()=>f.sqlite.exec("UPDATE budget_hold_dispositions SET created_at='changed'"),/append_only/);
  assert.throws(()=>f.sqlite.exec("DELETE FROM budget_hold_dispositions"),/append_only/);
  for(const table of ["budget_reservations","cost_budget_reservations"]){
    assert.throws(()=>f.sqlite.exec(`UPDATE ${table} SET status='active'`),/requires_review/);
    assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`),/requires_review/);
  }
});

for(const recursiveTriggers of [0,1])test(`administrative hold: replacement writes cannot replace immutable records with recursive_triggers=${recursiveTriggers}`,async()=>{
  const f=await administrativeHoldFixture();
  try{
    f.sqlite.exec(`PRAGMA recursive_triggers=${recursiveTriggers}`);
    await applyHoldDisposition(f.env,f.user,f.command);
    const before=f.fullSnapshot();
    const replace=(table,row)=>{
      const columns=Object.keys(row);
      return f.sqlite.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...Object.values(row));
    };
    const original=f.sqlite.prepare("SELECT * FROM budget_hold_dispositions").get();
    // Exercise every unique-key collision, not only replacement of the primary key.
    for(const keys of [["disposition_id"],["token_reservation_id"],["cost_reservation_id"],["event_id"],["job_id","correlation_id"]]){
      const candidate={...original,disposition_id:"replacement-decision",token_reservation_id:"replacement-token",cost_reservation_id:"replacement-cost",event_id:"replacement-event",job_id:"replacement-job",correlation_id:"replacement-attempt"};
      for(const key of keys)candidate[key]=original[key];
      assert.throws(()=>replace("budget_hold_dispositions",candidate),/append_only/,keys.join(","));
      assert.equal(f.fullSnapshot(),before,keys.join(","));
    }
    for(const table of ["budget_reservations","cost_budget_reservations"]){
      const originalReservation=f.sqlite.prepare(`SELECT * FROM ${table}`).get();
      assert.throws(()=>replace(table,{...originalReservation,status:"active"}),/requires_review/,table);
      assert.equal(f.fullSnapshot(),before,table);
      const unrelatedId=`unrelated-${table}`;
      replace(table,{...originalReservation,reservation_id:unrelatedId,status:"released"});
      const beforeUpdate=f.fullSnapshot();
      assert.throws(()=>f.sqlite.prepare(`UPDATE OR REPLACE ${table} SET reservation_id=? WHERE reservation_id=?`).run(originalReservation.reservation_id,unrelatedId),/requires_review/,`${table} update replacement`);
      assert.equal(f.fullSnapshot(),beforeUpdate,`${table} update replacement`);
      f.sqlite.prepare(`DELETE FROM ${table} WHERE reservation_id=?`).run(unrelatedId);
      assert.equal(f.fullSnapshot(),before,`${table} synthetic unrelated row removed`);
    }
    assert.equal((await verifyHoldDisposition(denyWrites(f.env),f.user.userId,f.command.dispositionId)).verified,true);
  }finally{f.sqlite.close();}
});

test("administrative hold: exact duplicate and concurrent command cannot release twice",async()=>{
  const f=await administrativeHoldFixture();
  const result=await Promise.allSettled([applyHoldDisposition(f.env,f.user,f.command),applyHoldDisposition(f.env,f.user,f.command)]);
  assert.equal(result.filter(x=>x.status==="fulfilled"&&x.value.applied).length,1);
  const before=f.fullSnapshot();
  assert.equal((await applyHoldDisposition(f.env,f.user,{...f.command})).replayed,true);
  assert.equal(f.fullSnapshot(),before);
  await assert.rejects(()=>applyHoldDisposition(f.env,f.user,{...f.command,reason:"A changed replay is never the same decision"}));
  assert.equal(f.fullSnapshot(),before);
});

test("administrative hold: a lost commit acknowledgment is recognized by its exact durable receipt",async()=>{
  const f=await administrativeHoldFixture(),batch=f.env.DB.batch;
  f.env.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(s=>s.sql.startsWith("INSERT INTO budget_hold_dispositions")))throw Error("ack lost");return result;};
  const result=await applyHoldDisposition(f.env,f.user,f.command);
  assert.equal(result.replayed,true);
  assert.equal((await verifyHoldDisposition(f.env,f.user.userId,f.command.dispositionId)).verified,true);
});

test("administrative hold: disabled feature and missing explicit acknowledgement cannot mutate",async()=>{
  const f=await administrativeHoldFixture(),before=f.fullSnapshot();
  f.env.FORMA_HOLD_DISPOSITION_ENABLED=undefined;
  await assert.rejects(()=>applyHoldDisposition(f.env,f.user,f.command),/disabled/);
  f.env.FORMA_HOLD_DISPOSITION_ENABLED="true";
  await assert.rejects(()=>applyHoldDisposition(f.env,f.user,{...f.command,acknowledgement:"yes"}),/explicit_command/);
  assert.equal(f.fullSnapshot(),before);
});

test("administrative hold: stale preview and invalid scope fail without an adjustment",async()=>{
  for(const sql of [
    "UPDATE document_jobs SET result_json=json_set(result_json,'$.newReceipt','late')",
    "UPDATE budget_reservations SET correlation_id='different-attempt'",
    "UPDATE cost_budget_reservations SET period='2025-12'",
    "UPDATE budget_reservations SET owner_id='different-owner'",
    "UPDATE cost_budget_reservations SET stream_id='creative:another'",
    "UPDATE cost_budget_reservations SET operation='document-render:video'",
    "UPDATE cost_budget_reservations SET workspace_id='another-workspace'",
    "UPDATE document_jobs SET status='running'",
    "UPDATE cost_budget_counters SET reserved_microusd=999",
    "DELETE FROM budget_counters WHERE scope='workspace'",
    "UPDATE budget_counters SET reserved_tokens=1000.5",
    "INSERT INTO project_budget_reservation_scopes SELECT 'tokens',reservation_id,'org','project','slides-owner','org',created_at FROM budget_reservations",
  ]){
    const f=await administrativeHoldFixture();f.sqlite.exec(sql);const before=f.fullSnapshot();
    await assert.rejects(()=>applyHoldDisposition(f.env,f.user,f.command),undefined,sql);
    assert.equal(f.fullSnapshot(),before,sql);
  }
});

test("administrative hold: state and authority races inside the transaction abort the full batch",async()=>{
  for(const sql of [
    "UPDATE users SET role='creator'",
    "UPDATE users SET consent_version='revoked'",
    "UPDATE document_jobs SET result_json=json_set(result_json,'$.lateReceipt',1)",
    "UPDATE cost_budget_counters SET reserved_microusd=999",
    "INSERT INTO impersonation_sessions VALUES('session','slides-owner','persona','fictional','replay','active','2020-01-01','2099-01-01',NULL)",
  ]){
    const f=await administrativeHoldFixture(),batch=f.env.DB.batch;let raced=false,before;
    f.env.DB.batch=async statements=>{if(!raced&&statements.some(s=>s.sql.startsWith("INSERT INTO budget_hold_dispositions"))){raced=true;f.sqlite.exec(sql);before=f.fullSnapshot();}return batch(statements);};
    await assert.rejects(()=>applyHoldDisposition(f.env,f.user,f.command),/write_conflict/,sql);
    assert.equal(f.fullSnapshot(),before,sql);
  }
});

test("administrative hold: silent counter, reservation, and event failures roll back every change",async()=>{
  for(const [table,action] of [["cost_budget_counters","UPDATE"],["budget_reservations","UPDATE"],["events","INSERT"],["budget_hold_dispositions","INSERT"]]){
    const f=await administrativeHoldFixture(),before=f.fullSnapshot();
    f.sqlite.exec(`CREATE TRIGGER injected_noop BEFORE ${action} ON ${table} BEGIN SELECT RAISE(IGNORE); END`);
    await assert.rejects(()=>applyHoldDisposition(f.env,f.user,f.command),/write_conflict/);
    assert.equal(f.fullSnapshot(),before,table);
  }
});

test("administrative hold: later provider evidence cannot silently charge or reopen the original hold",async()=>{
  const f=await administrativeHoldFixture();await applyHoldDisposition(f.env,f.user,f.command);
  f.save(f.checkpoint);
  const stable=()=>JSON.stringify(JSON.parse(f.fullSnapshot()),(key,value)=>key==="finance"?JSON.parse(value,(k,v)=>k==="updated_at"?undefined:v):value);
  const before=stable();
  assert.equal((await settleLegacyPresentationReservations(f.env,f.user,f.job())).reason,"administrative_disposition_requires_review");
  assert.equal((await settleBudget(f.env,f.user.userId,f.token.reservationId,240,"late" )).settled,false);
  assert.equal((await settleCostBudget(f.env,f.user.userId,f.cost.reservationId,2224)).settled,false);
  await releaseBudget(f.env,f.user.userId,f.token.reservationId,"late");
  await releaseCostBudget(f.env,f.user.userId,f.cost.reservationId);
  await reconcileFailedBudgetReservations(f.env,f.user);
  assert.equal(stable(),before);
  const verified=await verifyHoldDisposition(f.env,f.user.userId,f.command.dispositionId);
  assert.equal(verified.transactionVerified,true);
  assert.equal(verified.checks.providerEvidenceUnchanged,false);
});

test("administrative hold: old reservation reconciliation skips an existing reviewed hold",async()=>{
  const f=await administrativeHoldFixture();await applyHoldDisposition(f.env,f.user,f.command);
  const before=f.fullSnapshot();
  await reconcileFailedBudgetReservations(f.env,f.user,Date.now()+10*60_000);
  assert.equal(f.fullSnapshot(),before);
  const held=f.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=?").get(f.cost.reservationId);
  await reserveCostBudget(f.env,f.user.userId,held.reserved_microusd,{streamId:f.user.streamId,correlationId:"unrelated-new-request",operation:"image-generation"});
  const withUnrelated=f.fullSnapshot();
  assert.equal(await adoptLegacyCostReservation(f.env,f.user.userId,{reservationId:held.reservation_id,amountMicrousd:held.reserved_microusd,period:held.period,streamId:held.stream_id,correlationId:held.correlation_id,operation:held.operation}),false);
  assert.equal(f.fullSnapshot(),withUnrelated);
});

test("administrative hold: follow-up allows unrelated later activity but detects counter drift",async()=>{
  const f=await administrativeHoldFixture();await applyHoldDisposition(f.env,f.user,f.command);
  await reserveBudget(f.env,f.user.userId,300,{streamId:f.user.streamId,correlationId:"unrelated",operation:"chat"});
  await reserveCostBudget(f.env,f.user.userId,400,{reservationId:"unrelated",maximumMicrousd:400,allowUserOverage:false,streamId:f.user.streamId,correlationId:"unrelated",operation:"chat"});
  assert.equal((await verifyHoldDisposition(denyWrites(f.env),f.user.userId,f.command.dispositionId)).verified,true);
  f.sqlite.exec("UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+1 WHERE scope='user'");
  const v=await verifyHoldDisposition(denyWrites(f.env),f.user.userId,f.command.dispositionId);
  assert.equal(v.transactionVerified,true);assert.equal(v.verified,false);assert.equal(v.checks.currentReservedProjection,false);
});

test("administrative hold: HTTP preview and follow-up are SELECT-only and scoped to the administrator",async()=>{
  const f=await administrativeHoldFixture();
  assert.equal((await handleHoldDispositions(f.request({action:"preview",jobId:f.job().job_id}),denyWrites(f.env))).status,200);
  assert.equal((await handleHoldDispositions(f.request({action:"apply",command:f.command}),f.env)).status,200);
  const url=`https://forma.test/api/admin/budget-hold-dispositions?dispositionId=${f.command.dispositionId}`;
  const get=(extra={})=>new Request(url,{headers:{...f.headers,...extra}});
  const before=f.fullSnapshot();
  const result=await handleHoldDispositions(get(),denyWrites(f.env));assert.equal(result.status,200);assert.equal((await result.json()).verified,true);
  assert.equal(f.fullSnapshot(),before);
  assert.equal((await handleHoldDispositions(get({cookie:"forma_impersonation=unknown"}),denyWrites(f.env))).status,409);
  assert.equal((await handleHoldDispositions(get({cookie:"forma_project_context=unknown"}),denyWrites(f.env))).status,409);
  f.sqlite.exec("UPDATE users SET role='creator'");
  assert.equal((await handleHoldDispositions(get(),denyWrites(f.env))).status,403);
});

test("administrative hold: HTTP rejects cross-origin, malformed, excessive and identity-forged requests",async()=>{
  const f=await administrativeHoldFixture(),before=f.fullSnapshot();
  for(const origin of ["https://attacker.test",""]){assert.equal((await handleHoldDispositions(f.request({action:"apply",command:f.command},{origin}),f.env)).status,403);}
  assert.equal((await handleHoldDispositions(f.request({action:"apply",command:{...f.command,operatorId:f.user.userId}}),f.env)).status,400);
  assert.equal((await handleHoldDispositions(f.request({action:"preview",jobId:"other-owner-job"}),f.env)).status,404);
  assert.equal((await handleHoldDispositions(f.request({action:"apply",command:{...f.command,reason:"x".repeat(9000)}}),f.env)).status,413);
  assert.equal(f.fullSnapshot(),before);
});

test("administrative hold: organization identity-policy revocation is checked at commit",async()=>{
  const f=await administrativeHoldFixture(),now=new Date().toISOString();
  f.sqlite.prepare("INSERT INTO organizations VALUES('hold-org','Synthetic org',?,'active',?,?)").run(f.user.userId,now,now);
  f.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES('hold-membership','hold-org',?,'owner','active',?,?,?,?)")
    .run(f.user.userId,f.user.userId,now,now,now);
  f.sqlite.prepare("INSERT INTO organization_security_policies(organization_id,updated_by_user_id,updated_at) VALUES('hold-org',?,?)").run(f.user.userId,now);
  f.user=(await requireExistingHoldAdministrator(f.request({}),f.env)).user;
  f.command.previewSha256=(await previewHoldDisposition(f.env,f.user,f.job().job_id)).previewSha256;
  const batch=f.env.DB.batch;let before,changed=false;
  f.env.DB.batch=async statements=>{
    if(!changed&&statements.some(s=>s.sql.startsWith("INSERT INTO budget_hold_dispositions"))){
      changed=true;f.sqlite.exec("UPDATE organization_security_policies SET require_mfa=1,version=version+1");before=f.fullSnapshot();
    }
    return batch(statements);
  };
  await assert.rejects(()=>applyHoldDisposition(f.env,f.user,f.command),/write_conflict/);
  assert.equal(f.fullSnapshot(),before);
});

test("administrative hold: candidate and account summaries distinguish released capacity from unknown billing",async()=>{
  const f=await administrativeHoldFixture();await applyHoldDisposition(f.env,f.user,f.command);
  const accounting=presentationCandidateAccounting(JSON.parse(f.job().result_json),{
    reservations:f.sqlite.prepare("SELECT * FROM cost_budget_reservations").all(),usage:[],responseIds:[],minimumAttempt:1,preserved:[],
  });
  assert.equal(accounting.reservation_status,"administratively_released");
  assert.equal(accounting.reservation_microusd,0);
  assert.equal(accounting.settled_cost_microusd,null);
  assert.equal(accounting.settled_cost_complete,false);
  assert.equal(accounting.provider_submission_uncertain,true);
  const {readOutcomeTelemetryLiveEvidence}=await import("../worker/outcome-telemetry.ts");
  const live=await readOutcomeTelemetryLiveEvidence(f.env,f.user);
  assert.equal(live.ok,true);
  assert.equal(live.evidence.finance.periods[0].releasedCount,1);
  assert.equal(live.evidence.finance.periods[0].unclassifiedCount,0);
  assert.equal(live.evidence.finance.heldMicrousd,0);
  assert.equal(live.evidence.finance.providerInvoiceReconciled,null);
});

test("administrative hold: full worker follow-up neither writes nor schedules cleanup or provider work",async()=>{
  const f=await administrativeHoldFixture();await applyHoldDisposition(f.env,f.user,f.command);
  const worker=(await import("../dist/server/index.js")).default;
  const noWrites=denyWrites(f.env),originalFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error("unexpected network request");};
  try{
    const result=await worker.fetch(new Request(`https://forma.test/api/admin/budget-hold-dispositions?dispositionId=${f.command.dispositionId}`,{headers:f.headers}),noWrites,
      {waitUntil(){throw Error("unexpected background work");}});
    assert.equal(result.status,200);
    assert.equal((await result.json()).verified,true);
  }finally{globalThis.fetch=originalFetch;}
});

test("administrative hold: a missing schema fails closed without creating it during verification",async()=>{
  const {env,sqlite}=reconciliationDatabase();
  const request=new Request("https://forma.test/api/admin/budget-hold-dispositions?dispositionId=hold-test-1",{headers:{"oai-authenticated-user-id":"owner","oai-authenticated-user-email":"owner@example.test"}});
  assert.equal((await handleHoldDispositions(request,denyWrites(env))).status,503);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema").get().n,0);
});

test("administrative hold: used-counter changes require review rather than passing silently",async()=>{
  for(const [table,unit] of [["budget_counters","tokens"],["cost_budget_counters","microusd"]]){
    const f=await administrativeHoldFixture();await applyHoldDisposition(f.env,f.user,f.command);
    f.sqlite.exec(`UPDATE ${table} SET used_${unit}=used_${unit}+1 WHERE scope='user'`);
    const v=await verifyHoldDisposition(denyWrites(f.env),f.user.userId,f.command.dispositionId);
    assert.equal(v.transactionVerified,true);assert.equal(v.verified,false);
    assert.deepEqual(v.requiresReview,["settledCountersUnchanged"]);
  }
});

test("administrative hold: follow-up revalidates exact live document and attempt metadata",async()=>{
  for(const column of ["document_id","correlation_id","status","attempt_count"]){
    const f=await administrativeHoldFixture();await applyHoldDisposition(f.env,f.user,f.command);
    f.sqlite.exec(`UPDATE document_jobs SET ${column}=${column==="attempt_count"?"attempt_count+1":"'changed'"}`);
    const v=await verifyHoldDisposition(denyWrites(f.env),f.user.userId,f.command.dispositionId);
    assert.equal(v.checks.providerEvidenceUnchanged,true,"JSON bytes alone do not prove the attempt binding");
    assert.equal(v.checks.liveJobBinding,false);assert.equal(v.verified,false);
  }
});

test("administrative hold: generated migration and idempotent reference verify all table, index and guard definitions",async()=>{
  const {holdSchemaProof}=await import("../worker/budget-hold-schema.ts");
  const reference=await readFile(new URL("../db/operations/budget-hold-dispositions.sql",import.meta.url),"utf8");
  const migration=await readFile(new URL("../drizzle/0036_budget_hold_dispositions.sql",import.meta.url),"utf8");
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE budget_reservations(reservation_id TEXT); CREATE TABLE cost_budget_reservations(reservation_id TEXT)");
  sqlite.exec(migration);sqlite.exec(reference);sqlite.exec(reference);
  const proof=holdSchemaProof();
  assert.equal(proof.bindings.length,28,"one table, four unique indexes and nine immutable guards are pinned");
  assert.equal(sqlite.prepare("SELECT 1 AS ready WHERE "+proof.sql).get(...proof.bindings).ready,1);sqlite.close();
});

test("administrative hold: missing immutable guards or unique indexes fail closed",async()=>{
  const {holdSchemaProof}=await import("../worker/budget-hold-schema.ts");
  const proof=holdSchemaProof();
  for(const name of proof.bindings.filter((_,index)=>index%2===0).filter(name=>name!=="budget_hold_dispositions")){
    const f=await administrativeHoldFixture(),before=f.fullSnapshot();
    try{
      const objectType=f.sqlite.prepare("SELECT type FROM sqlite_schema WHERE name=?").get(name).type;
      assert.ok(["index","trigger"].includes(objectType));
      f.sqlite.exec(`DROP ${objectType.toUpperCase()} ${name}`);
      await assert.rejects(()=>previewHoldDisposition(f.env,f.user,f.job().job_id),/schema_not_ready/,name);
      await assert.rejects(()=>applyHoldDisposition(f.env,f.user,f.command),/write_conflict/,name);
      assert.equal(f.fullSnapshot(),before,name);
    }finally{f.sqlite.close();}
  }
});

test("administrative hold: a same-named nonunique replacement index cannot satisfy the installed proof",async()=>{
  const {holdSchemaProof}=await import("../worker/budget-hold-schema.ts");
  const proof=holdSchemaProof();
  for(let index=0;index<proof.bindings.length;index+=2){
    const [name,sql]=proof.bindings.slice(index,index+2);
    if(!sql.startsWith("CREATE UNIQUE INDEX "))continue;
    const f=await administrativeHoldFixture(),before=f.fullSnapshot();
    try{
      f.sqlite.exec(`DROP INDEX ${name}`);
      f.sqlite.exec(sql.replace("CREATE UNIQUE INDEX ","CREATE INDEX "));
      await assert.rejects(()=>previewHoldDisposition(f.env,f.user,f.job().job_id),/schema_not_ready/,name);
      await assert.rejects(()=>applyHoldDisposition(f.env,f.user,f.command),/write_conflict/,name);
      assert.equal(f.fullSnapshot(),before,name);
    }finally{f.sqlite.close();}
  }
});
