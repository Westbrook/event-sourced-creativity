import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";
import {
  claimCostBudgetReservation,
  reconcileFailedBudgetReservations,
  reserveBudget,
  reserveCostBudget,
  settleInterruptedDocumentJobReservations,
} from "../worker/pilot-policy.ts";

const owner="dev-local-creative";
const stream=`creative:${owner}`;

async function reservationFixture(artifactKind,submission){
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
  const operation=`document-render:${artifactKind}`;
  const tokens=await reserveBudget(env,owner,56_000,{streamId:stream,correlationId:correlation,operation});
  assert.equal(tokens.ok,true);
  const costs=await reserveCostBudget(env,owner,1_000_000,{maximumMicrousd:1_000_000,allowUserOverage:false,streamId:stream,correlationId:correlation,operation,period:tokens.period});
  assert.equal(costs.ok,true);
  assert.equal(await claimCostBudgetReservation(env,owner,costs.reservationId),true);
  const request={artifactKind,productionMode:"manual",itemCount:1};
  const result={reservationId:tokens.reservationId,costReservationId:costs.reservationId,costReservationPeriod:tokens.period,costReservationMicrousd:costs.reservedMicrousd,[artifactKind==="storyboard"?"storyboardProviderSubmission":"audioProviderSubmission"]:submission,...(submission==="confirmed"?{providerJobId:"accepted-owned-fal-request"}:{})};
  const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobId,owner,stream,"doc-atmosphere","render_document","failed","document",correlation,1,JSON.stringify(request),JSON.stringify(result),"interrupted",1,now,now,now,null,null,new Date(Date.now()+86_400_000).toISOString(),now);

  const user={userId:owner,streamId:stream};
  const job={job_id:jobId,stream_id:stream,document_id:"doc-atmosphere",correlation_id:correlation,request_json:JSON.stringify(request),result_json:JSON.stringify(result)};
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
