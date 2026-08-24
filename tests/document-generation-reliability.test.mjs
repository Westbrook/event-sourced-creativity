import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";
import { generationFailureGuidance } from "../src/model/document-jobs.ts";
import { appendAuditEvent } from "../worker/runtime.ts";

function reliabilityDatabase(){
  const sqlite=new DatabaseSync(":memory:");
  const controls={failDocumentRequestWrite:false,failedDocumentRequestWrites:0};

  class Statement{
    constructor(sql,values=[]){this.sql=sql;this.values=values;}
    bind(...values){assert.ok(values.length<=100,"Cloudflare D1 bind limit must remain respected");return new Statement(this.sql,values);}
    execute(kind){
      const prepared=sqlite.prepare(this.sql);
      if(kind==="first")return prepared.get(...this.values)??null;
      if(kind==="all")return{results:prepared.all(...this.values),success:true,meta:{changes:0}};
      const result=prepared.run(...this.values);
      return{results:[],success:true,meta:{changes:Number(result.changes??0)}};
    }
    async first(){return this.execute("first");}
    async all(){return this.execute("all");}
    async run(){return this.execute("run");}
  }

  const DB={
    prepare(sql){return new Statement(sql);},
    async batch(statements){
      if(controls.failDocumentRequestWrite&&statements.some((statement)=>/INSERT INTO event_write_stage/i.test(statement.sql)&&statement.values[11]==="DocumentRenderRequested")){
        controls.failDocumentRequestWrite=false;
        controls.failedDocumentRequestWrites+=1;
        throw new Error("D1_ERROR: UNIQUE constraint failed: events.event_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)");
      }
      sqlite.exec("BEGIN");
      try{
        const results=statements.map((statement)=>statement.execute(/^\s*(?:SELECT|WITH)/i.test(statement.sql)?"all":"run"));
        sqlite.exec("COMMIT");
        return results;
      }catch(error){sqlite.exec("ROLLBACK");throw error;}
    },
  };
  return{sqlite,DB,controls};
}

async function reliabilityWorker(){
  const database=reliabilityDatabase();
  const background=[];
  const environment={DB:database.DB,OPENAI_API_KEY:"reliability-test-key",OPENAI_MODEL:"gpt-5.6-terra",ASSETS:{fetch:async()=>new Response(null,{status:404})},MEDIA:{put:async()=>undefined,get:async()=>null}};
  const context={waitUntil(promise){background.push(promise);}};
  const request=(path,init)=>worker.fetch(new Request(`http://localhost${path}`,init),environment,context);
  assert.equal((await request("/api/session")).status,200);
  database.sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await request("/api/events?after=0&limit=2000&content=0")).status,200);
  return{
    ...database,environment,request,
    async drainBackground(){while(background.length)await Promise.all(background.splice(0));},
  };
}

function json(body,headers={}){
  return{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)};
}

async function authoredOutline(fixture,count=12,owner="dev-local-creative"){
  const text=Array.from({length:count},(_,index)=>`Slide ${index+1} — Authored narrative ${index+1}\nProtect this exact source statement and its attributed evidence.`).join("\n\n");
  await appendAuditEvent(fixture.environment,`creative:${owner}`,"user","BlockCreated",{
    project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:`source-outline-${count}`,type:"direction",handle:"direction/executive-outline",
    position:"z-reliability-outline",properties:{text,weight:1,authority:"authored"},
  });
  return text;
}

function addQueueBlocker(fixture,owner="dev-local-creative"){
  const now=new Date().toISOString();
  const future=new Date(Date.now()+3_600_000).toISOString();
  const jobId=`${owner}-reliability-blocker`;
  fixture.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobId,owner,`creative:${owner}`,"doc-atmosphere","chat","running","test",`${jobId}:attempt:1`,1,"{}","{}",null,1,now,now,null,future,null,future,now);
  return jobId;
}

test("normalizes the reproduced historical D1 event collision without rewriting failed job history",async()=>{
  const fixture=await reliabilityWorker();
  const now=new Date().toISOString();
  const expiresAt=new Date(Date.now()+86_400_000).toISOString();
  const technical="D1_ERROR: UNIQUE constraint failed: events.event_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)";
  const historical={
    artifactKind:"slides",stage:"failed",progressMessage:"The provider connection ended before an image was returned.",
    errorDetail:{code:technical,category:"server",scope:"provider",action:"retry",message:technical,retryable:true,retryAfterMs:null,requestId:null,httpStatus:500},
  };
  fixture.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("historical-local-persistence","dev-local-creative","creative:dev-local-creative","doc-atmosphere","render_document","failed","document","historical-local-persistence:attempt:1",1,JSON.stringify({artifactKind:"slides",itemCount:12}),JSON.stringify(historical),technical,1,now,now,now,null,null,expiresAt,now);

  const response=await fixture.request("/api/document-jobs/historical-local-persistence");
  assert.equal(response.status,200);
  const {job}=await response.json();
  assert.equal(job.errorDetail.code,"local_persistence_failed");
  assert.equal(job.errorDetail.category,"server");
  assert.equal(job.errorDetail.scope,"unknown");
  assert.equal(job.errorDetail.retryable,false);
  assert.equal(job.errorDetail.httpStatus,null,"a local HTTP response is not an external-provider HTTP receipt");
  assert.match(job.progressMessage,/local database or event-store write failed/i);
  assert.doesNotMatch(job.progressMessage,/provider connection|image was returned/i);
  const guidance=generationFailureGuidance(job.errorDetail,job.error);
  assert.equal(guidance.retryAllowed,false);
  assert.doesNotMatch(`${guidance.title} ${guidance.summary}`,/reasonable to retry|provider connection was interrupted/i);
  const preserved=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
  assert.deepEqual(preserved.errorDetail,historical.errorDetail,"legacy failures must be presented accurately without rewriting user history");
});

test("records actor-private source receipts, coherent managed call exposure, and atomic active-request idempotency",async()=>{
  const fixture=await reliabilityWorker();
  const outline=await authoredOutline(fixture,12);
  addQueueBlocker(fixture);
  const managed={kind:"render_document",documentId:"doc-atmosphere",sourceSurface:"document",payload:{
    artifactKind:"slides",productionMode:"managed",itemCount:23,requestedSlideCount:23,
    requestKey:"executive-managed-23",audience:"Executive decision-makers",tone:"Preserve all protected evidence",
    presentationStyle:"editorial",presentationFidelity:"faithful",
  }};
  const [first,second]=await Promise.all([fixture.request("/api/document-jobs",json(managed)),fixture.request("/api/document-jobs",json(managed))]);
  assert.equal(first.status,202,JSON.stringify(await first.clone().json()));
  assert.equal(second.status,202,JSON.stringify(await second.clone().json()));
  const firstBody=await first.json();
  const secondBody=await second.json();
  assert.equal(firstBody.job.jobId,secondBody.job.jobId,"concurrent identical paid submissions must share one active job");
  assert.equal(Number(firstBody.reused===true)+Number(secondBody.reused===true),1);
  const receipt=firstBody.job.result.generationReceipt;
  assert.equal(receipt.provider,"openai");
  assert.equal(receipt.model,"gpt-5.6-terra");
  assert.equal(receipt.requested_slide_count,23);
  assert.equal(receipt.authored_slide_count,12);
  assert.equal(receipt.predicted_slide_count,23);
  assert.equal(receipt.slide_count_mismatch,true);
  assert.equal(receipt.batch_count,3);
  assert.equal(receipt.minimum_provider_call_count,3);
  assert.equal(receipt.maximum_provider_call_count,12);
  assert.equal(receipt.reservation_microusd,3_000_000);
  assert.equal(receipt.settled_cost_microusd,0);
  assert.equal(receipt.reservation_is_provider_hard_cap,false);
  assert.equal(receipt.reservation_is_application_hard_cap,true);
  assert.equal(receipt.maximum_authorized_cost_microusd,3_000_000);
  assert.equal(receipt.provider_request_status,"not_submitted");
  assert.equal(receipt.source_transmission_status,"not_transmitted");
  assert.equal(receipt.settings.presentation_style,"editorial");
  assert.equal(receipt.settings.presentation_fidelity,"faithful");
  assert.match(receipt.source_snapshot_sha256,/^[a-f\d]{64}$/);

  const stored=fixture.sqlite.prepare("SELECT owner_id,kind,content FROM private_content WHERE content_id=?").get(receipt.input_ref);
  assert.equal(stored.owner_id,"dev-local-creative");
  assert.equal(stored.kind,"document-artifact-input");
  const privateReceipt=JSON.parse(stored.content);
  assert.equal(privateReceipt.job_id,firstBody.job.jobId);
  assert.equal(privateReceipt.request.predicted_slide_count,23);
  assert.equal(privateReceipt.planner.request_status,"not_submitted");
  assert.ok(privateReceipt.document_snapshot.facts.some((fact)=>fact.properties.text===outline));
  assert.doesNotMatch(JSON.stringify(receipt),/Protect this exact source statement|source-outline-12/,"list-visible metadata cannot contain raw source text or block identifiers");

  fixture.sqlite.prepare("UPDATE document_jobs SET status='completed',completed_at=?,notified_at=? WHERE job_id=?").run(new Date().toISOString(),new Date().toISOString(),firstBody.job.jobId);
  const regenerated=await fixture.request("/api/document-jobs",json(managed));
  assert.equal(regenerated.status,202,JSON.stringify(await regenerated.clone().json()));
  const regeneratedBody=await regenerated.json();
  assert.notEqual(regeneratedBody.job.jobId,firstBody.job.jobId,"intentional regeneration after completion must remain available");
  assert.equal(regeneratedBody.reused??false,false);
});

test("rejects invalid, conflicting, and over-limit slide counts before source receipts, reservations, or provider calls",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  const initialPrivate=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count;
  const cases=[
    [{productionMode:"manual",itemCount:13},400,"presentation_slide_count_invalid",12],
    [{productionMode:"managed",itemCount:101},400,"presentation_slide_count_invalid",100],
    [{productionMode:"managed",itemCount:0},400,"presentation_slide_count_invalid",100],
    [{productionMode:"managed",itemCount:2.5},400,"presentation_slide_count_invalid",100],
    [{productionMode:"managed",itemCount:23,requestedSlideCount:22},409,"presentation_slide_count_conflict",null],
  ];
  for(const [options,status,code,maximum] of cases){
    const response=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",...options}}));
    assert.equal(response.status,status,JSON.stringify(await response.clone().json()));
    const body=await response.json();
    assert.equal(body.error,code);
    if(maximum!==null)assert.equal(body.supported.maximum,maximum);
  }
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE kind='render_document'").get().count,0);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,0);
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,initialPrivate);
});

test("rejects source-free slideshow requests at both admission boundaries without reserving, writing, or contacting a provider",async()=>{
  const fixture=await reliabilityWorker();
  const documentId="empty-authorized-presentation-document";
  await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","DocumentCreated",{project_id:"project-atmosphere",document_id:documentId,title:"An empty presentation source"});
  const initialEvents=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const initialPrivate=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count;
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("Source-free requests must never contact a provider.");};
  try{
    const payload={artifactKind:"slides",productionMode:"manual",itemCount:1,budgetAcknowledged:true,snapshot:{}};
    for(const [path,body] of [["/api/events",{action:"render_document",documentId,...payload}],["/api/document-jobs",{kind:"render_document",documentId,payload}]]){
      const rejected=await fixture.request(path,json(body));
      assert.equal(rejected.status,422,JSON.stringify(await rejected.clone().json()));
      assert.equal((await rejected.json()).error,"presentation_authorized_source_required");
    }
    assert.equal(providerCalls,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,initialEvents);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,initialPrivate);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("rejects user-supplied slideshow recovery plans, provider receipts, and reservation state at both public admission boundaries",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  const initialEvents=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const initialPrivate=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count;
  const payload={artifactKind:"slides",productionMode:"manual",itemCount:12,budgetAcknowledged:true};
  const forgedStates=[
    {artifactPlan:{title:"Untrusted cached presentation",items:[]},plannerUsage:{inputTokens:200_000,outputTokens:100_000,totalTokens:300_000},plannerResponseId:"untrusted-provider-response"},
    {reservationId:"untrusted-token-reservation",productionSceneReceipts:{}},
    {costReservationId:"untrusted-cost-reservation",costReservationMicrousd:10_000_000},
    {providerJobId:"untrusted-provider-job",videoInputReceipt:{}},
    {productionPlan:{maximumProviderCallCount:0},productionAnchor:{}},
    {artifactId:"untrusted-artifact",renderedItems:[]},
  ];
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("User-supplied recovery state must never contact a provider.");};
  try{
    for(const state of forgedStates){
      const submitted={...payload,...state};
      for(const [path,request] of [["/api/document-jobs",{kind:"render_document",documentId:"doc-atmosphere",payload:submitted}],["/api/events",{action:"render_document",documentId:"doc-atmosphere",...submitted}]]){
        const rejected=await fixture.request(path,json(request));
        assert.equal(rejected.status,400,JSON.stringify(await rejected.clone().json()));
        assert.equal((await rejected.json()).error,"presentation_recovery_state_server_owned");
      }
    }
    assert.equal(providerCalls,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE kind='render_document'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,initialEvents,"untrusted recovery state cannot manufacture generation or billing history");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,initialPrivate);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("enforces organization slideshow token caps before admission and truthfully settles bounded repair usage",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  const workspace=await fixture.request("/api/workspaces",json({name:"Slideshow token hard-cap enforcement"}));
  assert.equal(workspace.status,201,JSON.stringify(await workspace.clone().json()));
  const organizationId=(await workspace.json()).organizationId;
  const registered=await fixture.request(`/api/workspaces/${organizationId}/projects`,json({projectId:"project-atmosphere"}));
  assert.equal(registered.status,201,JSON.stringify(await registered.clone().json()));
  const projectAccessId=(await registered.json()).projectAccessId;
  const opened=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST"});
  assert.equal(opened.status,200,JSON.stringify(await opened.clone().json()));
  const scoped={cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};
  const policy=fixture.sqlite.prepare("UPDATE budget_scope_policies SET token_limit=? WHERE scope='workspace' AND scope_id=? AND organization_id=?");
  const payload={artifactKind:"slides",productionMode:"manual",itemCount:12,budgetAcknowledged:true,requestKey:"organization-slideshow-token-cap"};
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    const outputTokens=providerCalls===1?7_000:7_099;
    return Response.json({id:`token-cap-response-${providerCalls}`,model:"gpt-5.6-terra",output_text:"{}",usage:{input_tokens:9_000,output_tokens:outputTokens,total_tokens:9_000+outputTokens}});
  };
  try{
    for(const limit of [32_000,127_999]){
      assert.equal(Number(policy.run(limit,organizationId,organizationId).changes),1);
      for(const [path,request] of [["/api/document-jobs",{kind:"render_document",documentId:"doc-atmosphere",payload}],["/api/events",{action:"render_document",documentId:"doc-atmosphere",...payload}]]){
        const denied=await fixture.request(path,json(request,path==="/api/document-jobs"?scoped:{}));
        assert.equal(denied.status,429,JSON.stringify(await denied.clone().json()));
        assert.equal((await denied.json()).error,"budget_hard_cap_reached");
      }
      assert.equal(providerCalls,0,"a near-cap organization must never transmit source material");
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE kind='render_document'").get().count,0);
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,0);
    }

    assert.equal(Number(policy.run(128_000,organizationId,organizationId).changes),1);
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload},scoped));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();
    await fixture.drainBackground();

    assert.equal(providerCalls,2,"one initial response and one bounded source repair remain available");
    const reservation=fixture.sqlite.prepare("SELECT reserved_tokens,used_tokens,status FROM budget_reservations WHERE correlation_id=?").get(`${job.jobId}:attempt:1`);
    assert.equal(reservation.reserved_tokens,128_000);
    assert.equal(reservation.used_tokens,32_099,"truthful settlement never clips or discards paid provider tokens");
    assert.equal(reservation.status,"settled");
    const scopedBudget=fixture.sqlite.prepare("SELECT used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters WHERE scope='workspace' AND scope_id=?").get(organizationId);
    assert.deepEqual({...scopedBudget},{used_tokens:32_099,reserved_tokens:0,hard_limit_tokens:128_000});
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_counters WHERE used_tokens+reserved_tokens>hard_limit_tokens").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("rejects an oversized slideshow provider request before source transmission or monthly token overspend",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockCreated",{
    project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"oversized-slideshow-source",type:"direction",handle:"direction/oversized-authorized-source",
    position:"z-token-limit-source",properties:{text:`Authorized presentation source context: ${"meaningful source evidence ".repeat(5_000)}`,weight:1,authority:"authored"},
  });
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("An oversized slideshow must not contact its provider.");};
  try{
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"oversized-slideshow-token-bound"}}));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();
    await fixture.drainBackground();

    assert.equal(providerCalls,0);
    const response=await fixture.request(`/api/document-jobs/${job.jobId}`);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"presentation_token_cap_reached");
    assert.equal(failed.errorDetail.retryable,false);
    assert.equal(failed.result.generationReceipt.source_transmission_status,"not_transmitted");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_counters WHERE used_tokens+reserved_tokens>hard_limit_tokens").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("blocks an oversized bounded repair while truthfully settling its already-paid initial slideshow response",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    if(providerCalls!==1)throw new Error("A repair beyond the reserved token ceiling must not reach the provider.");
    return Response.json({id:"already-paid-oversized-draft",model:"gpt-5.6-terra",output_text:JSON.stringify({title:"Oversized provider draft",body:"a".repeat(125_000)}),usage:{input_tokens:9_000,output_tokens:7_000,total_tokens:16_000}});
  };
  try{
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"oversized-bounded-repair-token-cap"}}));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();
    await fixture.drainBackground();

    assert.equal(providerCalls,1,"the already-paid initial response is preserved but its unsafe repair is never submitted");
    const response=await fixture.request(`/api/document-jobs/${job.jobId}`);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"presentation_token_cap_reached");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"transmitted");
    assert.equal(failed.result.generationReceipt.actual_provider_call_count,1);
    assert.ok(failed.result.generationReceipt.settled_cost_microusd>0,"a failed bounded repair cannot erase an already-paid initial request");
    const reservation=fixture.sqlite.prepare("SELECT reserved_tokens,used_tokens,status FROM budget_reservations WHERE correlation_id=?").get(`${job.jobId}:attempt:1`);
    assert.deepEqual({...reservation},{reserved_tokens:128_000,used_tokens:16_000,status:"settled"});
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_counters WHERE used_tokens+reserved_tokens>hard_limit_tokens").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("captures a truthful failed receipt and releases both reservations when local persistence fails before OpenAI",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  fixture.controls.failDocumentRequestWrite=true;
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("A local event persistence failure must never contact the provider.");};
  try{
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",sourceSurface:"document",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"persistence-regression"}}));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();
    const captured=fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(job.result.generationReceipt.input_ref);
    assert.ok(captured,"the complete actor-private source receipt must survive even if no generation event commits");
    await fixture.drainBackground();

    assert.equal(fixture.controls.failedDocumentRequestWrites,1);
    assert.equal(providerCalls,0);
    const detail=await fixture.request(`/api/document-jobs/${job.jobId}`);
    assert.equal(detail.status,200);
    const failed=(await detail.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"local_persistence_failed");
    assert.equal(failed.errorDetail.retryable,false);
    assert.equal(failed.errorDetail.httpStatus,null);
    assert.equal(failed.result.generationReceipt.provider_request_status,"not_submitted");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"not_transmitted");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,0);
    assert.equal(failed.result.generationReceipt.failure_stage,"local_persistence");
    assert.notEqual(failed.result.generationReceipt.reservation_status,"active");
    assert.notEqual(failed.result.generationReceipt.reservation_status,"executing");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderRequested' AND correlation_id=?").get(`${job.jobId}:attempt:1`).count,0,"the failed staged write must not fabricate a provider request event");
    assert.equal(generationFailureGuidance(failed.errorDetail).retryAllowed,false);
  }finally{globalThis.fetch=previousFetch;}
});

test("fails closed for an unpriced slideshow model before provider submission and releases its complete reservation",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  fixture.environment.OPENAI_MODEL="unpriced-presentation-model";
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("An unpriced model must never receive authorized source text.");};
  try{
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"unpriced-slideshow-model"}}));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();
    assert.equal(job.result.generationReceipt.reservation_is_application_hard_cap,true);
    assert.equal(job.result.generationReceipt.maximum_authorized_cost_microusd,1_000_000);
    await fixture.drainBackground();

    const response=await fixture.request(`/api/document-jobs/${job.jobId}`);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"presentation_model_pricing_unavailable");
    assert.equal(providerCalls,0);
    assert.equal(failed.result.generationReceipt.provider_request_status,"not_submitted");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"not_transmitted");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("settles every metered initial and bounded-repair response when source-fidelity validation fails",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    return Response.json({id:`paid-validation-response-${providerCalls}`,model:"gpt-5.6-terra",output_text:"{}",usage:{input_tokens:120,output_tokens:45,total_tokens:165}});
  };
  try{
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",sourceSurface:"document",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"paid-fidelity-failure-regression"}}));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();
    await fixture.drainBackground();

    assert.equal(providerCalls,2,"exactly one initial response and one bounded repair may be paid");
    const response=await fixture.request(`/api/document-jobs/${job.jobId}`);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.result.plannerUsage.totalTokens,330,"already-checkpointed responses cannot be charged twice");
    assert.deepEqual(failed.result.plannerResponseIds,["paid-validation-response-1","paid-validation-response-2"]);
    const receipt=failed.result.generationReceipt;
    assert.equal(receipt.provider,"openai");
    assert.equal(receipt.model,"gpt-5.6-terra");
    assert.equal(receipt.provider_request_status,"submitted");
    assert.equal(receipt.source_transmission_status,"transmitted");
    assert.equal(receipt.actual_provider_call_count,2);
    assert.equal(receipt.settled_cost_microusd,1560,"240 input tokens and 90 output tokens use the configured model rates");
    assert.equal(receipt.reservation_status,"settled");

    const token=fixture.sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE correlation_id=?").get(`${job.jobId}:attempt:1`);
    assert.equal(token.status,"settled");
    assert.equal(token.used_tokens,330);
    const cost=fixture.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE correlation_id=?").get(`${job.jobId}:attempt:1`);
    assert.equal(cost.status,"settled");
    assert.equal(cost.used_microusd,1560);
    const usage=fixture.sqlite.prepare("SELECT payload FROM events WHERE type='GenerationUsageRecorded' AND correlation_id=?").get(`${job.jobId}:attempt:1`);
    const recorded=JSON.parse(usage.payload);
    assert.equal(recorded.total_tokens,330);
    assert.equal(recorded.cost_microusd,1560);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("scoped project job surfaces recursively redact actor-private generation receipts and raw source metadata",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  addQueueBlocker(fixture);
  const workspace=await fixture.request("/api/workspaces",json({name:"Generation receipt isolation"}));
  assert.equal(workspace.status,201,JSON.stringify(await workspace.clone().json()));
  const organizationId=(await workspace.json()).organizationId;
  const registered=await fixture.request(`/api/workspaces/${organizationId}/projects`,json({projectId:"project-atmosphere"}));
  assert.equal(registered.status,201,JSON.stringify(await registered.clone().json()));
  const projectAccessId=(await registered.json()).projectAccessId;
  const opened=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST"});
  assert.equal(opened.status,200,JSON.stringify(await opened.clone().json()));
  const scoped={cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};
  const queued=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,audience:"PRIVATE AUDIENCE",tone:"PRIVATE TONE",requestKey:"scoped-receipt"}},scoped));
  assert.equal(queued.status,202,JSON.stringify(await queued.clone().json()));
  const queuedBody=await queued.json();
  assert.equal(queuedBody.job.result.generationReceipt,undefined);

  const retained=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(queuedBody.job.jobId).result_json);
  assert.equal(retained.generationReceipt.settings.audience,"PRIVATE AUDIENCE");
  assert.ok(retained.generationReceipt.input_ref);
  const nested={...retained,nested:{generationReceipt:retained.generationReceipt,input_ref:"nested-secret-ref",source_snapshot_sha256:"nested-secret-hash",settings:{audience:"NESTED PRIVATE AUDIENCE",tone:"NESTED PRIVATE TONE"}}};
  fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(nested),queuedBody.job.jobId);

  for(const path of ["/api/document-jobs",`/api/document-jobs/${queuedBody.job.jobId}`]){
    const response=await fixture.request(path,{headers:scoped});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const body=await response.text();
    assert.doesNotMatch(body,/generationReceipt|generation_receipt|input_ref|nested-secret-ref|nested-secret-hash|PRIVATE AUDIENCE|PRIVATE TONE|source_snapshot_sha256/);
  }

  const privatePath=`/api/document-jobs/${queuedBody.job.jobId}/private-receipt`;
  const inspected=await fixture.request(privatePath,{headers:scoped});
  assert.equal(inspected.status,200,JSON.stringify(await inspected.clone().json()));
  assert.equal(inspected.headers.get("cache-control"),"private, no-store");
  const inspectedBody=await inspected.json();
  assert.equal(inspectedBody.job.jobId,queuedBody.job.jobId);
  assert.equal(inspectedBody.job.result.generationReceipt.settings.audience,"PRIVATE AUDIENCE");
  assert.deepEqual(Object.keys(inspectedBody.content),[retained.generationReceipt.input_ref]);
  const privateInput=JSON.parse(inspectedBody.content[retained.generationReceipt.input_ref]);
  assert.equal(privateInput.job_id,queuedBody.job.jobId);
  assert.equal(privateInput.document_id,"doc-atmosphere");

  const retainedRow=fixture.sqlite.prepare("SELECT classification FROM private_content_retention_scopes WHERE content_id=?").get(retained.generationReceipt.input_ref);
  fixture.sqlite.prepare("UPDATE private_content_retention_scopes SET classification='untrusted' WHERE content_id=?").run(retained.generationReceipt.input_ref);
  const wrongClassification=await fixture.request(privatePath,{headers:scoped});
  assert.equal(wrongClassification.status,404);
  assert.doesNotMatch(await wrongClassification.text(),/PRIVATE AUDIENCE|PRIVATE TONE/);
  fixture.sqlite.prepare("UPDATE private_content_retention_scopes SET classification=? WHERE content_id=?").run(retainedRow.classification,retained.generationReceipt.input_ref);

  const contextId=fixture.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE principal_user_id=? AND project_access_id=? AND revoked_at IS NULL").get("dev-local-creative",projectAccessId).context_id;
  const originalPrepare=fixture.environment.DB.prepare.bind(fixture.environment.DB);
  let intercepted=false;
  fixture.environment.DB.prepare=(sql)=>{
    if(sql.includes("JOIN private_content_retention_scopes retention")&&!intercepted){
      intercepted=true;
      fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),contextId);
    }
    return originalPrepare(sql);
  };
  try{
    const revoked=await fixture.request(privatePath,{headers:scoped});
    assert.equal(intercepted,true,"the live project session is revoked after admission but before the atomic private-content read");
    assert.equal(revoked.status,404);
    assert.doesNotMatch(await revoked.text(),/PRIVATE AUDIENCE|PRIVATE TONE/);
  }finally{fixture.environment.DB.prepare=originalPrepare;}
});
