import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";
import {
  claimCostBudgetReservation,
  reconcileFailedBudgetReservations,
  reserveBudget,
  reserveCostBudget,
  settleBudget,
  settleInterruptedDocumentJobReservations,
} from "../worker/pilot-policy.ts";
import { hasUnresolvedProviderSubmission,hasUnsettledProviderSubmission,mergeProviderSubmissions,unresolvedProviderSubmissionSql,unsettledProviderSubmissionSql } from "../src/model/provider-submission.ts";

const owner="dev-local-creative";
const stream=`creative:${owner}`;

async function reservationFixture(artifactKind,submission,{kind="render_document"}={}){
  const sqlite=new DatabaseSync(":memory:");
  class Statement{
    constructor(sql,values=[]){this.sql=sql;this.values=values;}
    bind(...values){return new Statement(this.sql,values);}
    execute(kind){const statement=sqlite.prepare(this.sql);if(kind==="first")return statement.get(...this.values)??null;if(kind==="all")return{results:statement.all(...this.values),success:true,meta:{changes:0}};return{results:[],success:true,meta:{changes:Number(statement.run(...this.values).changes)}};}
    async first(){return this.execute("first");}
    async all(){return this.execute("all");}
    async run(){return this.execute("run");}
  }
  const DB={prepare(sql){return new Statement(sql);},async batch(statements){sqlite.exec("BEGIN");try{const result=statements.map((statement)=>statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql)?"all":"run"));sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  const env={DB,OPENAI_API_KEY:"reservation-test-key",OPENAI_MODEL:"gpt-5.6-terra",ASSETS:{fetch:async()=>new Response(null,{status:404})},MEDIA:{put:async()=>undefined,get:async()=>null}};
  assert.equal((await worker.fetch(new Request("http://localhost/api/session"),env,{waitUntil(){}})).status,200);
  sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await worker.fetch(new Request("http://localhost/api/events?after=0&limit=100&content=0"),env,{waitUntil(){}})).status,200);

  const jobId=`${artifactKind}-${submission}-job`;
  const correlation=`${jobId}:attempt:1`;
  const operation=kind==="preview"?"image-preview":kind==="generate"?"image-generation":`document-render:${artifactKind}`;
  const tokens=await reserveBudget(env,owner,56_000,{streamId:stream,correlationId:correlation,operation});
  assert.equal(tokens.ok,true);
  const costs=await reserveCostBudget(env,owner,1_000_000,{maximumMicrousd:1_000_000,allowUserOverage:false,streamId:stream,correlationId:correlation,operation,period:tokens.period});
  assert.equal(costs.ok,true);
  assert.equal(await claimCostBudgetReservation(env,owner,costs.reservationId),true);
  const request={artifactKind,productionMode:"manual",itemCount:1};
  const result={reservationId:tokens.reservationId,costReservationId:costs.reservationId,costReservationPeriod:tokens.period,costReservationMicrousd:costs.reservedMicrousd,[artifactKind==="storyboard"?"storyboardProviderSubmission":"audioProviderSubmission"]:submission,...(submission==="confirmed"?{providerJobId:"accepted-owned-fal-request"}:{})};
  const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobId,owner,stream,"doc-atmosphere",kind,"failed","document",correlation,1,JSON.stringify(request),JSON.stringify(result),"interrupted",1,now,now,now,null,null,new Date(Date.now()+86_400_000).toISOString(),now);

  const user={userId:owner,streamId:stream};
  const job={job_id:jobId,kind,stream_id:stream,document_id:"doc-atmosphere",correlation_id:correlation,request_json:JSON.stringify(request),result_json:JSON.stringify(result)};
  return{sqlite,env,user,job,tokens,costs};
}

test("unconfirmed and accepted storyboard frames retain both owner-scoped reservations during direct settlement and orphan reconciliation",async()=>{
  for(const submission of ["pending","confirmed"]){
    const {sqlite,env,user,job,tokens,costs}=await reservationFixture("storyboard",submission);
    const direct=await settleInterruptedDocumentJobReservations(env,user,job,{reason:"test_interrupted_storyboard"});
    assert.equal(direct.settled,false,`${submission} storyboard liability must not be guessed or settled`);
    const reconciled=await reconcileFailedBudgetReservations(env,user,Date.now()+86_400_000);
    assert.equal(reconciled.reservationCount,0);
    assert.equal(reconciled.costReservationCount,0);
    assert.equal(sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokens.reservationId).status,"active");
    assert.equal(sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costs.reservationId).status,"executing");
    assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE correlation_id=? AND type IN ('BudgetReleased','GenerationUsageRecorded')").get(job.correlation_id).count),0);
  }
});

const submission=(status,extra={})=>({clientRequestId:"paid-unit",provider:"fal",operation:"image",model:"ideogram/v4",status,...extra});
function genericCheckpoint(fixture,patch){
  const checkpoint=JSON.parse(fixture.job.result_json);
  delete checkpoint.storyboardProviderSubmission;delete checkpoint.audioProviderSubmission;delete checkpoint.providerJobId;
  Object.assign(checkpoint,patch);fixture.job.result_json=JSON.stringify(checkpoint);
  fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(fixture.job.result_json,fixture.job.job_id);
}

test("generic pending, accepted, unknown-cost and legacy image liabilities survive both reconciliation paths",async()=>{
  for(const kind of ["preview","generate"]){
    for(const state of ["pending","accepted","completed","legacy"]){
      const fixture=await reservationFixture("image",state,{kind});
      genericCheckpoint(fixture,state==="legacy"?{}:{providerSubmissionProtocol:1,providerSubmissions:{"paid-unit":submission(state)}});
      assert.equal((await settleInterruptedDocumentJobReservations(fixture.env,fixture.user,fixture.job,{reason:"test"})).settled,false);
      const result=await reconcileFailedBudgetReservations(fixture.env,fixture.user,Date.now()+86_400_000);
      assert.equal(result.reservationCount,0);assert.equal(result.costReservationCount,0);
      assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(fixture.tokens.reservationId).status,"active");
      assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.costs.reservationId).status,"executing");
    }
  }
});

test("known planner and otherwise unattached image receipts settle once even after token-only settlement",async()=>{
  for(const tokensAlreadySettled of [false,true]){
    const fixture=await reservationFixture("image","completed",{kind:"generate"});
    genericCheckpoint(fixture,{providerSubmissionProtocol:1,plannerModel:"gpt-5.6-terra",plannerResponseId:"paid-plan",plannerUsage:{inputTokens:1200,outputTokens:800,totalTokens:2000},providerSubmissions:{
      "paid-plan":{clientRequestId:"paid-plan",provider:"openai",operation:"planning",model:"gpt-5.6-terra",status:"completed",providerRequestId:"response-plan",costMicrousd:12000,inputTokens:1200,outputTokens:800,totalTokens:2000},
      "paid-unit":submission("completed",{providerRequestId:"accepted-image",costMicrousd:45000}),
    }});
    if(tokensAlreadySettled)await settleBudget(fixture.env,owner,fixture.tokens.reservationId,2000,"test-previous-token-settlement");
    const result=await settleInterruptedDocumentJobReservations(fixture.env,fixture.user,fixture.job,{reason:"test"});
    assert.equal(result.settled,true);assert.equal(result.usedMicrousd,57000);
    assert.equal((await settleInterruptedDocumentJobReservations(fixture.env,fixture.user,fixture.job,{reason:"test-again"})).settled,false);
    await reconcileFailedBudgetReservations(fixture.env,fixture.user,Date.now()+86_400_000);
    assert.equal(fixture.sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(fixture.costs.reservationId).used_microusd,57000);
    assert.equal(fixture.sqlite.prepare("SELECT used_tokens FROM budget_reservations WHERE reservation_id=?").get(fixture.tokens.reservationId).used_tokens,2000);
  }
});

test("verified rejected image submission releases only its unused reservation",async()=>{
  const fixture=await reservationFixture("image","rejected",{kind:"generate"});
  genericCheckpoint(fixture,{providerSubmissionProtocol:1,providerSubmissions:{"paid-unit":submission("rejected",{costMicrousd:0})}});
  const result=await settleInterruptedDocumentJobReservations(fixture.env,fixture.user,fixture.job,{reason:"test-rejected"});
  assert.equal(result.settled,true);assert.equal(result.usedMicrousd,0);assert.equal(result.usedTokens,0);
});

test("generic JS and SQL guards agree and fail closed on malformed checkpoints",()=>{
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("CREATE TABLE evidence(value TEXT)");
  const entries=[undefined,"malformed",null,[],{"paid-unit":submission("pending")},{"paid-unit":submission("accepted")},{"paid-unit":submission("completed")},{"paid-unit":submission("completed",{costMicrousd:45000})},{"paid-unit":submission("rejected",{costMicrousd:0})},{"paid-unit":submission("unexpected")},{"paid-unit":"malformed"}];
  for(const entry of entries){
    const checkpoint={providerSubmissionProtocol:1,...(entry===undefined?{}:{providerSubmissions:entry})};
    sqlite.prepare("INSERT INTO evidence VALUES(?)").run(JSON.stringify(checkpoint));
    const result=sqlite.prepare(`SELECT ${unresolvedProviderSubmissionSql("evidence.value")} AS uncertain,${unsettledProviderSubmissionSql("evidence.value")} AS held FROM evidence ORDER BY rowid DESC LIMIT 1`).get();
    assert.equal(Boolean(result.uncertain),hasUnresolvedProviderSubmission(checkpoint),JSON.stringify(checkpoint));
    assert.equal(Boolean(result.held),hasUnsettledProviderSubmission(checkpoint),JSON.stringify(checkpoint));
  }
  const completed={"paid-unit":submission("completed",{providerRequestId:"original-provider-id",costMicrousd:45000,unitId:"frame:1"})};
  assert.equal(mergeProviderSubmissions(completed,{"paid-unit":submission("pending")})["paid-unit"].status,"completed");
  assert.throws(()=>mergeProviderSubmissions(completed,{"paid-unit":submission("completed",{providerRequestId:"different-id",costMicrousd:1})}),/identity_changed/);
  assert.throws(()=>mergeProviderSubmissions(completed,{"paid-unit":submission("completed",{providerRequestId:"original-provider-id",costMicrousd:1})}),/cost_changed/);
});

test("confirmed pre-acceptance rejection and stored storyboard frames retain ordinary reservation cleanup",async()=>{
  for(const submission of ["rejected","cleared"]){
    const {sqlite,env,user,tokens,costs}=await reservationFixture("storyboard",submission);
    const reconciled=await reconcileFailedBudgetReservations(env,user,Date.now()+86_400_000);
    assert.equal(reconciled.reservationCount,1);
    assert.equal(reconciled.costReservationCount,1);
    assert.equal(sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokens.reservationId).status,"released");
    assert.equal(sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costs.reservationId).status,"released");
  }
});

test("orphan reconciliation also preserves an unresolved owner-scoped Lyria submission",async()=>{
  const {sqlite,env,user,tokens,costs}=await reservationFixture("audio","pending");
  const reconciled=await reconcileFailedBudgetReservations(env,user,Date.now()+86_400_000);
  assert.equal(reconciled.reservationCount,0);
  assert.equal(reconciled.costReservationCount,0);
  assert.equal(sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokens.reservationId).status,"active");
  assert.equal(sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costs.reservationId).status,"executing");
});
