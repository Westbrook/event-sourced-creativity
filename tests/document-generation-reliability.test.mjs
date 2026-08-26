import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";
import { documentArtifactValidationIssues, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { DOCUMENT_JOB_HEARTBEAT_MS, documentGenerationRevision, documentJobMaxAttempts, generationFailureGuidance } from "../src/model/document-jobs.ts";
import { claimCostBudgetReservation, loadPrivateContent, reconcileFailedBudgetReservations, reserveBudget, reserveCostBudget } from "../worker/pilot-policy.ts";
import { appendAuditEvent } from "../worker/runtime.ts";

const workspaceRoot=new URL("../",import.meta.url).href;
const sourceResolution=registerHooks({resolve(specifier,context,nextResolve){
  const workspaceSource=typeof context.parentURL==="string"&&context.parentURL.startsWith(workspaceRoot)&&!context.parentURL.includes("/node_modules/");
  return nextResolve(workspaceSource&&specifier.startsWith(".")&&!/\.[a-z0-9]+$/i.test(specifier)?`${specifier}.ts`:specifier,context);
}});
const [{cancelProjectActorJobs,handleDocumentJobs},{handleEvents}]=await Promise.all([import("../worker/document-jobs-api.ts"),import("../worker/events-api.ts")]).finally(()=>sourceResolution.deregister());

function reliabilityDatabase(){
  const sqlite=new DatabaseSync(":memory:");
  const controls={failDocumentRequestWrite:false,failedDocumentRequestWrites:0,beforeRun:null,bindingCalls:0};

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
    async first(){controls.bindingCalls+=1;return this.execute("first");}
    async all(){controls.bindingCalls+=1;return this.execute("all");}
    async run(){controls.bindingCalls+=1;if(controls.beforeRun)await controls.beforeRun(this);return this.execute("run");}
  }

  const DB={
    prepare(sql){return new Statement(sql);},
    async batch(statements){
      controls.bindingCalls+=1;
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
    get backgroundCount(){return background.length;},
    async runJob(job,headers={}){const response=await request(`/api/document-jobs/${job.jobId}/run`,{method:"POST",headers});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response;},
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

const INDEPENDENT_SLIDE_SCORES=[["Phone","39.75"],["Tablet","53.00"],["Small monitor","67.25"],["Large monitor","68.50"],["Adaptive/accessibility","58.75"],["Governed creative loop","79.50"]];
const INDEPENDENT_SLIDE_QUOTE="Every authored decision remains traceable, independently reviewable, and reusable across the complete presentation.";
const INDEPENDENT_SLIDE_TITLES=["RESPONSIVE ASSESSMENT","STAKEHOLDER EVIDENCE","SOURCE GOVERNANCE","DOCUMENT AUTHORSHIP","CONTEXT IMMUTABILITY","PROJECT AUTHORIZATION","REVIEWER ACCOUNTABILITY","RECEIPT TRANSPARENCY","RECOVERY GUARANTEES","ACCESSIBLE DELIVERY","EDITABLE HANDOFF","EXECUTIVE DECISION"];

async function seedIndependentPresentation(fixture,documentId="independent-slide-source-document",slideCount=12){
  const stream="creative:dev-local-creative",projectId="project-atmosphere";
  await appendAuditEvent(fixture.environment,stream,"user","DocumentCreated",{project_id:projectId,document_id:documentId,title:"Event-Sourced Conversational Experience — Executive Plan"});
  for(let index=0;index<slideCount;index+=1){
    const body=index===0?`${INDEPENDENT_SLIDE_SCORES.map(([label,value])=>`${label}: ${value}`).join("; ")}. Exact equal-weight average: 61.125. Rounded display value: 61.13.`:index===1?`“${INDEPENDENT_SLIDE_QUOTE}” — Product Owner`:`Independent evidence for ${INDEPENDENT_SLIDE_TITLES[index].toLowerCase()} preserves conversion ${index+10}.25%.`;
    await appendAuditEvent(fixture.environment,stream,"user","BlockCreated",{project_id:projectId,document_id:documentId,block_id:`PRIVATE_AUTHORED_SLIDE_${index+1}`,type:"direction",handle:`direction/independent-${index+1}`,position:`slide-${String(index+1).padStart(2,"0")}`,properties:{label:`Independently authored source ${index+1}`,text:`Slide ${index+1} — ${INDEPENDENT_SLIDE_TITLES[index]}\n${body}`,weight:1,authority:"authored"}});
  }
  for(const[label,type,text]of[["objective","direction","Preserve source evidence."],["audience","audience","Executive stakeholders."],["deliverable","format","Faithful Field Notes presentation."],["exclusion","exclusion","Unsupported fabricated claims."]])await appendAuditEvent(fixture.environment,stream,"user","BlockCreated",{project_id:projectId,document_id:documentId,block_id:`PRIVATE_${label.toUpperCase()}`,type,handle:`${type}/supporting-${label}`,position:`z-${label}`,properties:{label,text,weight:1,authority:"authored"}});
  return documentId;
}

function independentProviderResponse(requestBody){
  const request=JSON.parse(String(requestBody)),input=JSON.parse(request.input);
  const items=input.presentation_source.outline.map((source,index)=>{
    const alias=source.sourceAlias,score=index===0,quoted=index===1;
    return{title:source.title,body:source.content,notes:`${source.content}\n[Sources] Independently authored source ${index+1}`,image_prompt:`Source-grounded editable composition ${index+1}`,context_group_ids:[],slide:{layout:score?"scorecard":quoted?"quote":index===11?"closing":"statement",kicker:`Authored position ${index+1}`,bullets:[],quote:quoted?{text:INDEPENDENT_SLIDE_QUOTE,speaker:"Product Owner",role:"Product Owner",source_id:alias,citation:"Authored stakeholder evidence"}:null,citations:[{source_id:alias,label:`Independently authored source ${index+1}`,anchor:`Authored slide ${index+1}`,excerpt:source.title}],source_ids:[alias],section:null,source_order:index+1,visual:{kind:score?"scorecard":quoted?"quote":"hero-type",label:score?"Six independently assessed goals":quoted?"Product Owner":"Authorized authored evidence",value:score?"61.13":quoted?INDEPENDENT_SLIDE_QUOTE:`Decision ${index+1}`,exact_value:score?"61.125":null,display_value:score?"61.13":null,unit:score?"/100":null,data:score?INDEPENDENT_SLIDE_SCORES.map(([label,value])=>({label,value,weight:Number(value)/100,exact_value:value,display_value:value,source_ids:[alias]})):[]}}};
  });
  return{title:"Faithful event-sourced executive plan",summary:"Twelve independently authored and individually attributed slides.",content_markdown:items.map((item,index)=>`## ${index+1}. ${item.title}\n${item.body}`).join("\n\n"),presentation:{aspect_ratio:"16:9",theme:"Faithful event-sourced executive plan",footer_label:"Executive source evidence",style_preset:"field-notes",mode:"light",palette:{background:"#edf1ef",foreground:"#14211d",accent:"#287260",muted:"#586b64",surface:"#d9e3df"}},items};
}

function savedIndependentPresentationPlan(){
  const outline=INDEPENDENT_SLIDE_TITLES.map((title,index)=>({title,content:index===0?"Six independent criteria preserve the exact 61.125 assessment and rounded 61.13 executive decision.":index===1?"An attributed stakeholder statement supports independently reviewable product accountability.":`Independent evidence for ${title.toLowerCase()} preserves conversion ${index+10}.25%.`,sourceAlias:`PRIVATE_AUTHORED_SLIDE_${index+1}`}));
  const output=independentProviderResponse(JSON.stringify({input:JSON.stringify({presentation_source:{outline}})}));
  const parsed=parseDocumentArtifactContent(JSON.stringify(output));
  assert.ok(parsed);
  assert.deepEqual(documentArtifactValidationIssues("slides",parsed,{itemCount:12}),[]);
  return parsed;
}

const presentationAdmission=(documentId,requestKey="independent-twelve-faithful")=>({kind:"render_document",documentId,sourceSurface:"document",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestedSlideCount:12,presentationStyle:"field-notes",presentationFidelity:"faithful",requestKey}});

async function stalePresentationAttempt(fixture,job,{attemptCount=1,reserve=false,pending=false,paid=false,renewed=false}={}){
  const owner="dev-local-creative",stream=`creative:${owner}`,correlation=`${job.jobId}:attempt:${attemptCount}`,operation="document-render:slides";
  const checkpoint={...job.result,stage:pending?"submitting":"planning",progressMessage:"Preparing the approved presentation."};
  let token=null,cost=null;
  if(reserve){
    token=await reserveBudget(fixture.environment,owner,128_000,{streamId:stream,correlationId:correlation,operation});
    assert.equal(token.ok,true);
    cost=await reserveCostBudget(fixture.environment,owner,1_000_000,{reservationId:`${job.jobId}-cost`,maximumMicrousd:1_000_000,allowUserOverage:false,streamId:stream,correlationId:correlation,operation,period:token.period});
    assert.equal(cost.ok,true);
    assert.equal(await claimCostBudgetReservation(fixture.environment,owner,cost.reservationId),true);
    Object.assign(checkpoint,{reservationId:token.reservationId,costReservationId:cost.reservationId,costReservationPeriod:token.period,costReservationMicrousd:1_000_000});
  }
  if(pending)Object.assign(checkpoint,{presentationProviderSubmission:"pending",presentationProviderClientRequestId:`forma-slides-${crypto.randomUUID()}`,generationReceipt:{...checkpoint.generationReceipt,provider_request_status:"submission_unknown",source_transmission_status:"unknown",settled_cost_microusd:null,reservation_status:"executing"}});
  if(paid)Object.assign(checkpoint,{presentationProviderSubmission:"confirmed",plannerModel:"gpt-5.6-terra",plannerResponseId:"already-paid-presentation-response",plannerResponseIds:["already-paid-presentation-response"],plannerUsage:{inputTokens:1200,outputTokens:800,totalTokens:2000},generationReceipt:{...checkpoint.generationReceipt,provider_request_status:"submitted",source_transmission_status:"transmitted",actual_provider_call_count:1,reservation_status:"executing"}});
  const expired=new Date(Date.now()-120_000).toISOString();const expiresAt=renewed?new Date(Date.now()+75_000).toISOString():expired;
  fixture.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=?,correlation_id=?,started_at=?,lease_expires_at=?,updated_at=?,result_json=? WHERE job_id=?").run(attemptCount,correlation,expired,expiresAt,renewed?new Date().toISOString():expired,JSON.stringify(checkpoint),job.jobId);
  return{correlation,token,cost,checkpoint};
}

const flushExecution=async()=>{for(let index=0;index<8;index+=1)await new Promise(setImmediate);};

test("refuses immediate and racing cancellation of an unresolved paid Lyria submission",async()=>{
  for(const racing of [false,true]){
    const fixture=await reliabilityWorker();fixture.environment.FAL_KEY="lyria-reliability-key";addQueueBlocker(fixture);
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"audio",productionMode:"manual",itemCount:1,paidMediaConfirmed:true,requestKey:`lyria-pending-cancel-${racing}`}}));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const{job}=await accepted.json(),owner="dev-local-creative",stream=`creative:${owner}`,correlation=`${job.jobId}:attempt:1`,operation="document-render:audio";
    const tokens=await reserveBudget(fixture.environment,owner,24_000,{streamId:stream,correlationId:correlation,operation});assert.equal(tokens.ok,true);
    const costs=await reserveCostBudget(fixture.environment,owner,150_000,{reservationId:`${job.jobId}-audio-cost`,maximumMicrousd:150_000,allowUserOverage:false,streamId:stream,correlationId:correlation,operation,period:tokens.period});assert.equal(costs.ok,true);assert.equal(await claimCostBudgetReservation(fixture.environment,owner,costs.reservationId),true);
    const checkpoint={...job.result,stage:"submitting",reservationId:tokens.reservationId,costReservationId:costs.reservationId,costReservationPeriod:tokens.period,costReservationMicrousd:150_000,...(racing?{}:{audioProviderSubmission:"pending"}),generationReceipt:{...job.result.generationReceipt,provider_request_status:"submission_unknown",source_transmission_status:"unknown",settled_cost_microusd:null,reservation_status:"executing"}};
    const now=new Date().toISOString(),lease=new Date(Date.now()+75_000).toISOString();fixture.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,correlation_id=?,started_at=?,lease_expires_at=?,updated_at=?,result_json=? WHERE job_id=?").run(correlation,now,lease,now,JSON.stringify(checkpoint),job.jobId);
    let checkpointRaced=false;if(racing)fixture.controls.beforeRun=async(statement)=>{if(checkpointRaced||!statement.sql.startsWith("UPDATE document_jobs SET status=?,result_json=json_patch"))return;checkpointRaced=true;fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({...checkpoint,audioProviderSubmission:"pending"}),job.jobId);};
    try{
      const cancel=await fixture.request(`/api/document-jobs/${job.jobId}/cancel`,{method:"POST"});assert.equal(cancel.status,409,JSON.stringify(await cancel.clone().json()));assert.equal((await cancel.json()).error,"provider_submission_in_flight");if(racing)assert.equal(checkpointRaced,true);
      assert.equal(fixture.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(job.jobId).status,"running");
      assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokens.reservationId).status,"active");
      assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costs.reservationId).status,"executing");
    }finally{fixture.controls.beforeRun=null;}
  }
});

test("keeps a faithful twelve-block presentation inside its live hosted execution request and checkpoints provider submission before dispatch",async()=>{
  const fixture=await reliabilityWorker();
  const documentId=await seedIndependentPresentation(fixture);
  await fixture.drainBackground();
  const accepted=await fixture.request("/api/document-jobs",json(presentationAdmission(documentId)));
  assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
  const {job}=await accepted.json();
  assert.equal(job.result.generationReceipt.authored_slide_count,12);
  assert.equal(job.result.generationReceipt.provider_request_status,"not_submitted");
  assert.equal(fixture.backgroundCount,0,"a presentation must never be claimed by response-detached waitUntil work");

  const entered=Promise.withResolvers();const release=Promise.withResolvers();const previousFetch=globalThis.fetch;
  const providerRequests=[];const providerRequestIds=[];let responseResolved=false;
  globalThis.fetch=async(url,init={})=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerRequests.push(JSON.parse(String(init.body)));
    providerRequestIds.push(new Headers(init.headers).get("X-Client-Request-Id"));
    entered.resolve();
    await release.promise;
    return Response.json({id:"faithful-twelve-block-provider-response",model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
  };
  try{
    const execution=fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"}).then((response)=>{responseResolved=true;return response;});
    await entered.promise;
    assert.equal(responseResolved,false,"the HTTP execution request must remain open while provider work is active");
    assert.equal(providerRequests.length,1);

    const active=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
    assert.equal(active.presentationProviderSubmission,"pending");
    assert.match(active.presentationProviderClientRequestId,/^forma-slides-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(active.presentationProviderClientRequestId,providerRequestIds[0],"the exact provider support identifier must be durable before its request is submitted");
    assert.equal(active.generationReceipt.provider_request_status,"submission_unknown");
    assert.equal(active.generationReceipt.source_transmission_status,"unknown");
    assert.equal(active.generationReceipt.settled_cost_microusd,null);

    const polled=await fixture.request(`/api/document-jobs/${job.jobId}`);
    assert.equal(polled.status,200);
    assert.equal((await polled.json()).job.status,"running");
    const competing=await fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});
    assert.equal(competing.status,202,"a competing recovery must not invalidate the live lease");
    assert.equal(providerRequests.length,1);

    const cancel=await fixture.request(`/api/document-jobs/${job.jobId}/cancel`,{method:"POST"});
    assert.equal(cancel.status,409);
    assert.equal((await cancel.json()).error,"provider_submission_in_flight");

    release.resolve();
    const response=await execution;
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const completed=(await response.json()).job;
    assert.equal(completed.status,"completed");
    assert.equal(completed.attemptCount,1);
    assert.equal(completed.result.generationReceipt.authored_slide_count,12);
    assert.equal(completed.result.generationReceipt.actual_slide_count,12);
    assert.equal(completed.result.generationReceipt.provider_request_status,"completed");
    assert.equal(completed.result.generationReceipt.source_transmission_status,"transmitted");
    assert.equal(completed.result.generationReceipt.settled_cost_microusd,12_000);
    assert.equal(providerRequests.length,1);
    assert.doesNotMatch(JSON.stringify(providerRequests[0]),/PRIVATE_AUTHORED_SLIDE_|PRIVATE_OBJECTIVE|PRIVATE_AUDIENCE|PRIVATE_DELIVERABLE|PRIVATE_EXCLUSION/);

    const rendered=JSON.parse(fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).payload);
    assert.equal(rendered.item_count,12);
    const artifact=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(rendered.content_ref).content);
    assert.equal(artifact.presentation.stylePreset,"field-notes");
    assert.deepEqual(artifact.items.map((item)=>item.slide.sourceIds[0]),Array.from({length:12},(_,index)=>`PRIVATE_AUTHORED_SLIDE_${index+1}`));
    assert.equal(artifact.items[0].slide.visual.exactValue,"61.125");
    assert.equal(artifact.items[0].slide.visual.displayValue,"61.13");
    assert.equal(artifact.items[1].slide.quote.text,INDEPENDENT_SLIDE_QUOTE);
  }finally{release.resolve();globalThis.fetch=previousFetch;}
});

test("recovers an expired pre-provider presentation lease once without duplicating provider submission",async()=>{
  const fixture=await reliabilityWorker();const documentId=await seedIndependentPresentation(fixture,"pre-provider-recovery-document");
  const admission=await fixture.request("/api/document-jobs",json(presentationAdmission(documentId,"pre-provider-lease-recovery")));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();
  await stalePresentationAttempt(fixture,job);

  const entered=Promise.withResolvers(),release=Promise.withResolvers(),previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(_url,init={})=>{providerCalls+=1;entered.resolve();await release.promise;return Response.json({id:"recovered-presentation-response",model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});};
  try{
    const primary=fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});
    await entered.promise;
    const duplicate=await fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});
    assert.equal(duplicate.status,202);
    assert.equal(providerCalls,1);
    release.resolve();
    const completed=await primary;
    assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));
    const recovered=(await completed.json()).job;
    assert.equal(recovered.status,"completed");
    assert.equal(recovered.attemptCount,2);
    assert.equal(recovered.result.generationReceipt.provider_request_status,"completed");
    assert.equal(recovered.result.generationReceipt.source_transmission_status,"transmitted");
    assert.equal(recovered.result.generationReceipt.settled_cost_microusd,12_000);
    assert.equal(providerCalls,1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='JobAttemptInterrupted' AND json_extract(payload,'$.job_id')=?").get(job.jobId).count,1);
  }finally{release.resolve();globalThis.fetch=previousFetch;}
});

test("renews the foreground presentation heartbeat while a legitimate provider request remains open",async(context)=>{
  const fixture=await reliabilityWorker();const documentId=await seedIndependentPresentation(fixture,"heartbeat-presentation-document");
  const admission=await fixture.request("/api/document-jobs",json(presentationAdmission(documentId,"foreground-heartbeat")));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();
  context.mock.timers.enable({apis:["Date","setTimeout"],now:Date.now()});
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(_url,init={})=>{providerCalls+=1;entered.resolve();await release.promise;return Response.json({id:"heartbeat-presentation-response",model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});};
  try{
    const execution=fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});
    await entered.promise;
    const before=fixture.sqlite.prepare("SELECT lease_expires_at,updated_at,attempt_count FROM document_jobs WHERE job_id=?").get(job.jobId);
    context.mock.timers.tick(DOCUMENT_JOB_HEARTBEAT_MS);
    await flushExecution();
    const renewed=fixture.sqlite.prepare("SELECT lease_expires_at,updated_at,attempt_count FROM document_jobs WHERE job_id=?").get(job.jobId);
    assert.ok(Date.parse(renewed.lease_expires_at)>Date.parse(before.lease_expires_at));
    assert.ok(Date.parse(renewed.updated_at)>Date.parse(before.updated_at));
    assert.equal(renewed.attempt_count,1);
    const competing=await fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});
    assert.equal(competing.status,202);
    assert.equal(providerCalls,1);
    release.resolve();
    const completed=await execution;
    assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));
    assert.equal((await completed.json()).job.status,"completed");
    assert.equal(providerCalls,1);
  }finally{release.resolve();globalThis.fetch=previousFetch;context.mock.timers.reset();}
});

test("keeps a long-running twelve-block presentation and repeated lease renewals below the hosted subrequest ceiling",async(context)=>{
  const fixture=await reliabilityWorker();const documentId=await seedIndependentPresentation(fixture,"subrequest-headroom-presentation-document");
  const admission=await fixture.request("/api/document-jobs",json(presentationAdmission(documentId,"foreground-hosted-subrequest-headroom")));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const before=fixture.controls.bindingCalls;
  context.mock.timers.enable({apis:["Date","setTimeout"],now:Date.now()});
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),previousFetch=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async(_url,init={})=>{providerCalls+=1;entered.resolve();await release.promise;return Response.json({id:"subrequest-headroom-presentation-response",model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});};
  try{
    const execution=fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});await entered.promise;
    for(let renewal=0;renewal<4;renewal+=1){context.mock.timers.tick(DOCUMENT_JOB_HEARTBEAT_MS);await flushExecution();}
    release.resolve();const completed=await execution;
    assert.equal(completed.status,200,JSON.stringify(await completed.clone().json()));
    assert.equal((await completed.json()).job.status,"completed");
    const databaseSubrequests=fixture.controls.bindingCalls-before;
    assert.ok(databaseSubrequests+providerCalls<50,`${databaseSubrequests} D1 binding calls and ${providerCalls} paid-provider request must retain headroom below Cloudflare's 50-subrequest free-tier ceiling`);
    assert.equal(providerCalls,1);
  }finally{release.resolve();globalThis.fetch=previousFetch;context.mock.timers.reset();}
});

test("fails promptly after exhausted pre-provider recovery with truthful no-contact, no-transmission, and zero-cost receipts",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"exhausted-pre-provider-recovery"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();
  const attempt=await stalePresentationAttempt(fixture,job,{attemptCount:documentJobMaxAttempts("render_document"),reserve:true});
  const previousFetch=globalThis.fetch;let providerCalls=0;globalThis.fetch=async()=>{providerCalls+=1;throw new Error("An exhausted internal worker must not contact a provider.");};
  try{
    const response=await fixture.runJob(job);
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"execution_interrupted");
    assert.equal(failed.attemptCount,documentJobMaxAttempts("render_document"));
    assert.equal(failed.result.generationReceipt.provider_request_status,"not_submitted");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"not_transmitted");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,0);
    assert.equal(failed.result.generationReceipt.reservation_status,"released");
    assert.equal(failed.result.generationReceipt.failure_stage,"planning");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId).status,"released");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId).status,"released");
    assert.equal(providerCalls,0);
    const guidance=generationFailureGuidance(failed.errorDetail,failed.error,failed);
    assert.match(guidance.title,/generation worker/i);
    assert.doesNotMatch(guidance.title,/provider connection/i);
  }finally{globalThis.fetch=previousFetch;}
});

test("freezes both reservations and blocks duplicate submission when an interrupted provider request cannot be confirmed",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"uncertain-provider-submission"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();
  const attempt=await stalePresentationAttempt(fixture,job,{reserve:true,pending:true});
  const previousFetch=globalThis.fetch;let providerCalls=0;globalThis.fetch=async()=>{providerCalls+=1;throw new Error("An uncertain paid submission must never be repeated automatically.");};
  try{
    const response=await fixture.runJob(job);
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"provider_submission_uncertain");
    assert.equal(failed.errorDetail.requestId,attempt.checkpoint.presentationProviderClientRequestId);
    assert.match(failed.errorDetail.message,new RegExp(attempt.checkpoint.presentationProviderClientRequestId));
    assert.equal(failed.result.presentationProviderClientRequestId,attempt.checkpoint.presentationProviderClientRequestId);
    assert.equal(failed.attemptCount,1);
    assert.equal(failed.result.generationReceipt.provider_request_status,"submission_unknown");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"unknown");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,null);
    assert.equal(failed.result.generationReceipt.reservation_status,"executing");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId).status,"active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId).status,"executing");
    const aged=new Date(Date.now()-600_000).toISOString();
    fixture.sqlite.prepare("UPDATE budget_reservations SET created_at=? WHERE reservation_id=?").run(aged,attempt.token.reservationId);
    fixture.sqlite.prepare("UPDATE cost_budget_reservations SET created_at=? WHERE reservation_id=?").run(aged,attempt.cost.reservationId);
    assert.deepEqual(await reconcileFailedBudgetReservations(fixture.environment,{userId:"dev-local-creative",streamId:"creative:dev-local-creative"}),{releasedTokens:0,reservationCount:0,releasedMicrousd:0,costReservationCount:0});
    assert.equal(providerCalls,0);
    const guidance=generationFailureGuidance(failed.errorDetail,failed.error,failed);
    assert.match(guidance.summary,/duplicate charge/i);
    assert.equal(guidance.retryAllowed,false);
    const foreignHeaders={"oai-authenticated-user-id":"other-presentation-author","oai-authenticated-user-email":"other-presentation-author@example.test"};
    assert.equal((await fixture.request("/api/session",{headers:foreignHeaders})).status,200);
    const foreign=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${job.jobId}`,{headers:foreignHeaders}),fixture.environment,job.jobId);
    assert.equal(foreign.status,404,"another authenticated creator must not learn an owner-private provider request identifier");
    assert.doesNotMatch(await foreign.text(),new RegExp(attempt.checkpoint.presentationProviderClientRequestId));
  }finally{globalThis.fetch=previousFetch;}
});

test("redacts expired uncertain presentation inputs without ever releasing their unresolved provider reservations",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"expired-uncertain-provider-submission"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const attempt=await stalePresentationAttempt(fixture,job,{reserve:true,pending:true});
  const failed=await fixture.runJob(job);assert.equal((await failed.json()).job.status,"failed");
  const retained=fixture.sqlite.prepare("SELECT request_json,result_json FROM document_jobs WHERE job_id=?").get(job.jobId);
  const privateRequest={...JSON.parse(retained.request_json),snapshot:{sensitive:"EXPIRED PRIVATE SOURCE TEXT"}};
  const previous=JSON.parse(retained.result_json);
  const privateResult={...previous,plannerModel:"gpt-5.6-terra",plannerResponseId:"verified-prior-presentation-response",plannerResponseIds:["verified-prior-presentation-response"],plannerUsage:{inputTokens:1200,outputTokens:800,totalTokens:2000},plannerInput:{prompt:"EXPIRED PRIVATE PLANNER PROMPT"},artifactPlan:{body:"EXPIRED PRIVATE PRESENTATION DRAFT"},generationReceipt:{...previous.generationReceipt,source_transmission_status:"transmitted",settled_cost_microusd:12_000,actual_provider_call_count:1}};
  const aged=new Date(Date.now()-600_000).toISOString();
  fixture.sqlite.prepare("UPDATE document_jobs SET request_json=?,result_json=?,expires_at=? WHERE job_id=?").run(JSON.stringify(privateRequest),JSON.stringify(privateResult),aged,job.jobId);
  fixture.sqlite.prepare("UPDATE budget_reservations SET created_at=? WHERE reservation_id=?").run(aged,attempt.token.reservationId);
  fixture.sqlite.prepare("UPDATE cost_budget_reservations SET created_at=? WHERE reservation_id=?").run(aged,attempt.cost.reservationId);

  const retried=await fixture.request(`/api/document-jobs/${job.jobId}/retry`,{method:"POST"});
  assert.equal(retried.status,409,JSON.stringify(await retried.clone().json()));
  const redacted=fixture.sqlite.prepare("SELECT request_json,result_json,updated_at FROM document_jobs WHERE job_id=?").get(job.jobId);
  assert.deepEqual(JSON.parse(redacted.request_json),{artifactKind:"slides"});
  assert.deepEqual(JSON.parse(redacted.result_json),{presentationProviderSubmission:"pending",presentationProviderClientRequestId:attempt.checkpoint.presentationProviderClientRequestId,reservationId:attempt.token.reservationId,costReservationId:attempt.cost.reservationId,generationReceipt:{provider_request_status:"submission_unknown",source_transmission_status:"transmitted",settled_cost_microusd:12_000,reservation_status:"executing",actual_provider_call_count:1},plannerModel:"gpt-5.6-terra",plannerResponseId:"verified-prior-presentation-response",plannerResponseIds:["verified-prior-presentation-response"],plannerUsage:{inputTokens:1200,outputTokens:800,totalTokens:2000},costReservationPeriod:attempt.token.period,costReservationMicrousd:1_000_000});
  assert.doesNotMatch(`${redacted.request_json} ${redacted.result_json}`,/EXPIRED PRIVATE SOURCE TEXT|EXPIRED PRIVATE PLANNER PROMPT|EXPIRED PRIVATE PRESENTATION DRAFT/);

  const subsequent=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"post-expiry-uncertain-reservation-guard"}}));
  assert.equal(subsequent.status,202,JSON.stringify(await subsequent.clone().json()));
  assert.equal(fixture.sqlite.prepare("SELECT updated_at FROM document_jobs WHERE job_id=?").get(job.jobId).updated_at,redacted.updated_at,"an already-redacted accounting tombstone must not be rewritten on every admission");
  assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId).status,"active");
  assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId).status,"executing");
  assert.deepEqual(await reconcileFailedBudgetReservations(fixture.environment,{userId:"dev-local-creative",streamId:"creative:dev-local-creative"}),{releasedTokens:0,reservationCount:0,releasedMicrousd:0,costReservationCount:0});
});

test("settles an already-paid presentation response once and refuses to restart planning without its saved draft",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"paid-planner-without-draft"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const attempt=await stalePresentationAttempt(fixture,job,{reserve:true,paid:true});
  const previousFetch=globalThis.fetch;let providerCalls=0;globalThis.fetch=async()=>{providerCalls+=1;throw new Error("Paid planning must not be submitted twice.");};
  try{
    const response=await fixture.runJob(job);
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"presentation_recovery_unavailable");
    assert.equal(failed.attemptCount,1);
    assert.equal(failed.result.generationReceipt.provider_request_status,"submitted");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"transmitted");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,12_000);
    assert.equal(failed.result.generationReceipt.failure_stage,"planning");
    assert.equal(fixture.sqlite.prepare("SELECT status,used_tokens FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId).used_tokens,2000);
    assert.equal(fixture.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId).used_microusd,12_000);
    assert.equal(providerCalls,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("resumes a durably saved paid presentation draft with its original reservations and no second provider submission",async()=>{
  const fixture=await reliabilityWorker();const documentId=await seedIndependentPresentation(fixture,"saved-paid-presentation-recovery-document");
  const admission=await fixture.request("/api/document-jobs",json(presentationAdmission(documentId,"saved-paid-presentation-recovery")));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const attempt=await stalePresentationAttempt(fixture,job,{reserve:true,paid:true});
  const checkpoint={...attempt.checkpoint,artifactPlan:savedIndependentPresentationPlan()};
  fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),job.jobId);
  const previousFetch=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("A complete paid presentation draft must never submit its planner request twice.");};
  try{
    const response=await fixture.runJob(job);const completed=(await response.json()).job;
    assert.equal(completed.status,"completed");
    assert.equal(completed.attemptCount,2);
    assert.equal(completed.result.generationReceipt.provider_request_status,"completed");
    assert.equal(completed.result.generationReceipt.source_transmission_status,"transmitted");
    assert.equal(completed.result.generationReceipt.settled_cost_microusd,12_000);
    assert.equal(completed.result.generationReceipt.actual_provider_call_count,1);
    const token=fixture.sqlite.prepare("SELECT reservation_id,status,used_tokens,correlation_id FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId);
    assert.equal(token.status,"settled");
    assert.equal(token.used_tokens,2000);
    assert.equal(token.correlation_id,`${job.jobId}:attempt:2`);
    const cost=fixture.sqlite.prepare("SELECT reservation_id,status,used_microusd,correlation_id FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId);
    assert.equal(cost.status,"settled");
    assert.equal(cost.used_microusd,12_000);
    assert.equal(cost.correlation_id,`${job.jobId}:attempt:2`);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE correlation_id LIKE ?").get(`${job.jobId}:attempt:%`).count,1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE correlation_id LIKE ?").get(`${job.jobId}:attempt:%`).count,1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=?").get("already-paid-presentation-response").count,1);
    assert.equal(providerCalls,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("does not invalidate a heartbeat renewed between stale inspection and terminal recovery",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"stale-heartbeat-race"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const attempt=await stalePresentationAttempt(fixture,job,{attemptCount:documentJobMaxAttempts("render_document"),reserve:true});
  let renewed=false;
  fixture.controls.beforeRun=async(statement)=>{
    if(renewed||!statement.sql.startsWith("UPDATE document_jobs SET status='failed',error_message=?"))return;
    renewed=true;
    fixture.sqlite.prepare("UPDATE document_jobs SET lease_expires_at=?,updated_at=? WHERE job_id=?").run(new Date(Date.now()+75_000).toISOString(),new Date().toISOString(),job.jobId);
  };
  try{
    const response=await fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});
    assert.equal(response.status,202,JSON.stringify(await response.clone().json()));
    assert.equal(renewed,true);
    const retained=(await response.json()).job;
    assert.equal(retained.status,"running");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId).status,"active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId).status,"executing");
  }finally{fixture.controls.beforeRun=null;}
});

test("preserves an authoritative presentation completion committed during stale recovery before advancing unrelated work",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"authoritative-terminal-completion-race"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const attempt=await stalePresentationAttempt(fixture,job);
  fixture.sqlite.prepare("UPDATE document_jobs SET status='committing' WHERE job_id=?").run(job.jobId);
  const now=new Date().toISOString(),expires=new Date(Date.now()+86_400_000).toISOString();
  fixture.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("after-authoritative-completion","dev-local-creative","creative:dev-local-creative","doc-atmosphere","extract_reference","queued","test","after-authoritative-completion",1,"{}","{}",null,0,now,null,null,null,null,expires,now);
  let injected=false;const previousFetch=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("An authoritative completed presentation must never be submitted again.");};
  fixture.controls.beforeRun=async(statement)=>{
    if(injected||!statement.sql.startsWith("UPDATE document_jobs SET status='failed',error_message=?"))return;
    injected=true;
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","worker:renderer","DocumentRenderCompleted",{artifact_id:"already-completed-presentation",artifact_kind:"slides",document_id:"doc-atmosphere",item_count:12,provider:"openai",model_id:"gpt-5.6-terra"},attempt.correlation);
  };
  try{
    const scheduled=await fixture.request("/api/document-jobs/after-authoritative-completion/run",{method:"POST"});
    assert.equal(scheduled.status,202,JSON.stringify(await scheduled.clone().json()));
    await fixture.drainBackground();
    assert.equal(injected,true,"the authoritative terminal event arrives after stale inspection but before its conditional failure write");
    const retained=fixture.sqlite.prepare("SELECT status,error_message,result_json FROM document_jobs WHERE job_id=?").get(job.jobId);
    assert.equal(retained.status,"completed");
    assert.equal(retained.error_message,null);
    assert.equal(JSON.parse(retained.result_json).generationReceipt.provider_request_status,"completed");
    assert.equal(providerCalls,0);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get("after-authoritative-completion").status,"failed","the unrelated operation still advances after authoritative reconciliation");
  }finally{fixture.controls.beforeRun=null;globalThis.fetch=previousFetch;}
});

test("reconciles a racing uncertain-provider terminal event without reopening its paid submission or reservations",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"authoritative-terminal-failure-race"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const attempt=await stalePresentationAttempt(fixture,job,{reserve:true,pending:true});
  let injected=false;
  fixture.controls.beforeRun=async(statement)=>{
    if(injected||!statement.sql.startsWith("UPDATE document_jobs SET status='failed',error_message=?"))return;
    injected=true;
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","worker:renderer","DocumentRenderFailed",{artifact_id:"ambiguous-presentation",artifact_kind:"slides",document_id:"doc-atmosphere",provider_charge_status:"unconfirmed",error_code:"provider_network_failed",error_category:"network",error_scope:"network",error_action:"retry",error_message:"The provider receipt never returned.",retryable:true,http_status:null},attempt.correlation);
  };
  try{
    const response=await fixture.runJob(job);const failed=(await response.json()).job;
    assert.equal(injected,true);
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"provider_network_failed");
    assert.equal(failed.result.generationReceipt.provider_request_status,"submission_unknown");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"unknown");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,null);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId).status,"active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId).status,"executing");
  }finally{fixture.controls.beforeRun=null;}
});

test("never releases an uncertain presentation reservation when project revocation races its provider checkpoint",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"revocation-provider-checkpoint-race"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const attempt=await stalePresentationAttempt(fixture,job,{reserve:true});
  const organizationId="provider-checkpoint-organization",projectAccessId="provider-checkpoint-project";
  fixture.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(projectAccessId,"job",job.jobId,organizationId,"project-atmosphere","dev-local-creative","actor_private",null,"dev-local-creative",new Date().toISOString());
  let injected=false;
  fixture.controls.beforeRun=async(statement)=>{
    if(injected||!statement.sql.startsWith("UPDATE document_jobs SET status='canceled',result_json=json_patch"))return;
    injected=true;
    const checkpoint={...attempt.checkpoint,presentationProviderSubmission:"pending",generationReceipt:{...attempt.checkpoint.generationReceipt,provider_request_status:"submission_unknown",source_transmission_status:"unknown",settled_cost_microusd:null,reservation_status:"executing"}};
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),job.jobId);
  };
  try{
    await cancelProjectActorJobs(fixture.environment,{userId:"revocation-operator",streamId:"creative:revocation-operator",role:"admin",email:"operator@example.test",displayName:"Operator",consentVersion:"pilot-2026-08-10",consentedAt:null,access:{}},{organizationId,projectAccessId,actorUserId:"dev-local-creative"});
    assert.equal(injected,true);
    const canceled=fixture.sqlite.prepare("SELECT status,result_json FROM document_jobs WHERE job_id=?").get(job.jobId);
    assert.equal(canceled.status,"canceled");
    assert.equal(JSON.parse(canceled.result_json).presentationProviderSubmission,"pending");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId).status,"active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId).status,"executing");
  }finally{fixture.controls.beforeRun=null;}
});

test("does not let an abandoned queued presentation starve later unrelated document operations",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"abandoned-slide-queue-lane"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();
  const now=new Date(Date.now()+100).toISOString(),expires=new Date(Date.now()+86_400_000).toISOString();
  fixture.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("later-independent-extraction","dev-local-creative","creative:dev-local-creative","doc-atmosphere","extract_reference","queued","test","later-independent-extraction",1,"{}","{}",null,0,now,null,null,null,null,expires,now);
  const scheduled=await fixture.request("/api/document-jobs/later-independent-extraction/run",{method:"POST"});
  assert.equal(scheduled.status,202,JSON.stringify(await scheduled.clone().json()));
  await fixture.drainBackground();
  assert.equal(fixture.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get("later-independent-extraction").status,"failed","the later operation must execute, even when its deliberately invalid fixture request fails validation");
  assert.equal(fixture.sqlite.prepare("SELECT status,attempt_count FROM document_jobs WHERE job_id=?").get(job.jobId).status,"queued");
  assert.equal(fixture.sqlite.prepare("SELECT attempt_count FROM document_jobs WHERE job_id=?").get(job.jobId).attempt_count,0);
});

test("terminalizes an abandoned expired presentation lease before advancing unrelated queued work",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"abandoned-running-slide-lane"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const attempt=await stalePresentationAttempt(fixture,job,{reserve:true});
  const now=new Date().toISOString(),expires=new Date(Date.now()+86_400_000).toISOString();
  fixture.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("after-expired-presentation","dev-local-creative","creative:dev-local-creative","doc-atmosphere","extract_reference","queued","test","after-expired-presentation",1,"{}","{}",null,0,now,null,null,null,null,expires,now);
  const scheduled=await fixture.request("/api/document-jobs/after-expired-presentation/run",{method:"POST"});
  assert.equal(scheduled.status,202,JSON.stringify(await scheduled.clone().json()));
  await fixture.drainBackground();

  const interrupted=fixture.sqlite.prepare("SELECT status,error_message,result_json FROM document_jobs WHERE job_id=?").get(job.jobId);
  assert.equal(interrupted.status,"failed");
  assert.equal(interrupted.error_message,"execution_interrupted");
  assert.equal(JSON.parse(interrupted.result_json).generationReceipt.provider_request_status,"not_submitted");
  assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(attempt.token.reservationId).status,"released");
  assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(attempt.cost.reservationId).status,"released");
  assert.equal(fixture.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get("after-expired-presentation").status,"failed","the unrelated operation progressed after bounded stale-job cleanup");
});

test("preserves an ambiguous paid-provider transport failure without releasing reservations or submitting again",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"provider-transport-uncertainty"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const previousFetch=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new TypeError("fetch failed before the provider receipt returned");};
  try{
    const response=await fixture.runJob(job);
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.category,"network");
    assert.equal(failed.result.generationReceipt.provider_request_status,"submission_unknown");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"unknown");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,null);
    assert.equal(failed.result.generationReceipt.reservation_status,"executing");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status='executing'").get().count,1);
    assert.equal(providerCalls,1);
    const repeated=await fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});
    assert.equal(repeated.status,200);
    assert.equal((await repeated.json()).job.status,"failed");
    assert.equal(providerCalls,1);
    assert.equal(generationFailureGuidance(failed.errorDetail,failed.error,failed).retryAllowed,false);
  }finally{globalThis.fetch=previousFetch;}
});

test("records a confirmed provider rejection distinctly from uncertain submission and releases unused reservations",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"confirmed-provider-rejection"}}));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();const previousFetch=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;return Response.json({error:{code:"provider_request_invalid",message:"Invalid presentation request settings."}},{status:422});};
  try{
    const response=await fixture.runJob(job);
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.httpStatus,422);
    assert.equal(failed.errorDetail.category,"provider");
    assert.equal(failed.result.generationReceipt.provider_request_status,"submitted");
    assert.equal(failed.result.generationReceipt.source_transmission_status,"transmitted");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,0);
    assert.equal(failed.result.generationReceipt.reservation_status,"released");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
    assert.equal(providerCalls,1);
    const guidance=generationFailureGuidance(failed.errorDetail,failed.error,failed);
    assert.match(guidance.title,/provider rejected/i);
    assert.equal(guidance.retryAllowed,false);
  }finally{globalThis.fetch=previousFetch;}
});

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

test("both slideshow admission boundaries reject six slides for seven isolated authored chapters before any paid work",async()=>{
  const fixture=await reliabilityWorker();
  const documentId="seven-independent-authored-presentation-chapters";
  await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","DocumentCreated",{project_id:"project-atmosphere",document_id:documentId,title:"Seven independently isolated chapters"});
  const targets=["first slide","Slide 2","Slide 3","Slide 4","Slide 5","Slide 6","last slide"];
  for(let index=0;index<7;index+=1)await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockCreated",{project_id:"project-atmosphere",document_id:documentId,block_id:`isolated-chapter-${index+1}`,type:"message",handle:`message/isolated-${index+1}`,position:`chapter-${index+1}`,properties:{label:`Independent source ${index+1}`,text:`Approved and independently isolated decision ${index+1}.`,weight:1,authority:"authored",combined_context_memberships:[{context_set_id:`isolated-context-${index+1}`,name:`Isolated chapter ${index+1}`,target:targets[index],role:"slide_chapter",application:"isolate",member_order:0}]}});
  const baselineEvents=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const baselinePrivate=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count;
  const original=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("An impossible chapter assignment must not contact a provider.");};
  try{
    for(const mode of ["manual","managed"])for(const boundary of ["jobs","events"]){
      const payload={artifactKind:"slides",productionMode:mode,itemCount:6,requestedSlideCount:6,budgetAcknowledged:true};
      const rejected=boundary==="jobs"?await handleDocumentJobs(new Request("http://localhost/api/document-jobs",json({kind:"render_document",documentId,payload})),fixture.environment,""):await handleEvents(new Request("http://localhost/api/events",json({action:"render_document",documentId,...payload})),fixture.environment);
      assert.equal(rejected.status,409,`${boundary}/${mode}: ${JSON.stringify(await rejected.clone().json())}`);
      const detail=await rejected.json();assert.equal(detail.error,"presentation_slide_count_conflict");assert.equal(detail.sourceMinimumSlideCount,7);
    }
    assert.equal(providerCalls,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,baselineEvents);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,baselinePrivate);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,0);
  }finally{globalThis.fetch=original;}
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
    {presentationProviderSubmission:"pending"},
    {presentationProviderSubmission:"confirmed"},
    {presentationProviderClientRequestId:"forma-slides-forged-provider-trace"},
    {presentationCandidates:[{contentRef:"untrusted-provider-response"}]},
    {presentationRecoveryOnly:true},
    {recoverablePresentationCandidate:true},
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
    await fixture.runJob(job,scoped);

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
    await fixture.runJob(job);

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
    await fixture.runJob(job);

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
    await fixture.runJob(job);

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
    await fixture.runJob(job);

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

test("all document media reject unpriced planning before source transmission or provider spending",async()=>{
  const fixture=await reliabilityWorker();
  fixture.environment.OPENAI_MODEL="unpriced-document-model";
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("An unpriced document planner must never receive authored source context.");};

  try{
    const response=await handleEvents(new Request("http://localhost/api/events",json({
      action:"render_document",
      documentId:"doc-atmosphere",
      artifactKind:"scene",
      productionMode:"manual",
      itemCount:1,
      requestKey:"unpriced-cross-media-planner",
    })),fixture.environment);
    const failed=await response.json();

    assert.equal(response.status,429,JSON.stringify(failed));
    assert.equal(failed.error,"document_model_pricing_unavailable");
    assert.equal(providerCalls,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("an oversized cross-media repair stops before another provider call and settles only its original planning usage",async()=>{
  const fixture=await reliabilityWorker();
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    if(providerCalls>1)throw new Error("A repair exceeding the approved document token ceiling must not reach the provider.");
    return Response.json({
      id:"already-paid-oversized-scene-draft",
      model:"gpt-5.6-terra",
      output_text:JSON.stringify({
        title:"",
        summary:"An invalid initial narrative plan.",
        content_markdown:"",
        items:[{title:"Unfinished scene",body:"x".repeat(45_000),notes:"",image_prompt:"",context_group_ids:[]}],
      }),
      usage:{input_tokens:100,output_tokens:50,total_tokens:150},
    });
  };

  try{
    const response=await handleEvents(new Request("http://localhost/api/events",json({
      action:"render_document",
      documentId:"doc-atmosphere",
      artifactKind:"scene",
      productionMode:"manual",
      itemCount:1,
      requestKey:"oversized-cross-media-repair",
    })),fixture.environment);
    const failed=await response.json();

    assert.equal(response.status,429,JSON.stringify(failed));
    assert.equal(failed.error,"document_token_cap_reached");
    assert.equal(providerCalls,1,"the initial response is retained but its unsafe repair is never purchased");
    const reservation=fixture.sqlite.prepare("SELECT reserved_tokens,used_tokens,status FROM budget_reservations WHERE operation='document-render:scene'").get();
    assert.deepEqual({...reservation},{reserved_tokens:32_000,used_tokens:150,status:"settled"});
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("storyboard repair cannot consume tokens reserved for downstream frame generation",async()=>{
  const fixture=await reliabilityWorker();
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    if(providerCalls>1)throw new Error("A storyboard repair cannot spend the token reserve belonging to its image frame.");
    return Response.json({
      id:"already-paid-oversized-storyboard-draft",
      model:"gpt-5.6-terra",
      output_text:JSON.stringify({
        title:"",
        summary:"An invalid storyboard plan requiring bounded review.",
        content_markdown:"",
        items:[{title:"Unfinished storyboard frame",body:"x".repeat(33_000),notes:"",image_prompt:"A visually distinct opening frame.",context_group_ids:[]}],
      }),
      usage:{input_tokens:100,output_tokens:50,total_tokens:150},
    });
  };

  try{
    const response=await handleEvents(new Request("http://localhost/api/events",json({
      action:"render_document",
      documentId:"doc-atmosphere",
      artifactKind:"storyboard",
      productionMode:"manual",
      itemCount:1,
      paidMediaConfirmed:true,
      requestKey:"storyboard-planning-token-headroom",
    })),fixture.environment);
    const failed=await response.json();

    assert.equal(response.status,429,JSON.stringify(failed));
    assert.equal(failed.error,"document_token_cap_reached");
    assert.equal(providerCalls,1,"the downstream frame reserve must not authorize an extra planning request");
    const reservation=fixture.sqlite.prepare("SELECT reserved_tokens,used_tokens,status FROM budget_reservations WHERE operation='document-render:storyboard'").get();
    assert.deepEqual({...reservation},{reserved_tokens:56_000,used_tokens:150,status:"settled"});
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("settles every metered initial and bounded-repair response when source-fidelity validation fails",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  const previousFetch=globalThis.fetch;
  let providerCalls=0;let activeJobId="";const providerRequestIds=[];
  globalThis.fetch=async(url,init={})=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    const clientRequestId=new Headers(init.headers).get("X-Client-Request-Id");
    assert.match(clientRequestId,/^forma-slides-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    const pending=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(activeJobId).result_json);
    assert.equal(pending.presentationProviderSubmission,"pending");
    assert.equal(pending.presentationProviderClientRequestId,clientRequestId,"each initial or bounded-repair provider attempt requires its own durable pre-submit support reference");
    providerRequestIds.push(clientRequestId);
    return Response.json({id:`paid-validation-response-${providerCalls}`,model:"gpt-5.6-terra",output_text:"{}",usage:{input_tokens:120,output_tokens:45,total_tokens:165}});
  };
  try{
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",sourceSurface:"document",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"paid-fidelity-failure-regression"}}));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();
    activeJobId=job.jobId;
    await fixture.runJob(job);

    assert.equal(providerCalls,2,"exactly one initial response and one bounded repair may be paid");
    assert.equal(new Set(providerRequestIds).size,2,"a bounded repair must have a distinct provider support reference from its initial attempt");
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

    const candidateRequest=(suffix,init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${job.jobId}/presentation-candidates${suffix}`,init),fixture.environment,`${job.jobId}/presentation-candidates${suffix}`);
    const listed=await candidateRequest("");
    assert.equal(listed.status,200,JSON.stringify(await listed.clone().json()));
    assert.match(listed.headers.get("cache-control")??"",/private, no-store/u);
    const listing=await listed.json();
    assert.equal(listing.jobId,job.jobId);
    assert.equal(listing.documentId,"doc-atmosphere");
    assert.equal(listing.candidates.length,2);
    assert.deepEqual(listing.candidates.map((candidate)=>candidate.stage),["initial","repair"]);
    assert.deepEqual(listing.candidates.map((candidate)=>candidate.providerAttempt),[1,2]);
    assert.ok(listing.candidates.every((candidate)=>candidate.generatedSlideCount===0&&candidate.complete===false));
    assert.ok(listing.candidates.every((candidate)=>candidate.issues.some((issue)=>issue.code==="invalid_json"&&issue.category==="structure"&&issue.blocking)));
    assert.ok(listing.candidates.every((candidate)=>candidate.settledCostMicrousd===1560&&candidate.providerCalls===2));
    assert.doesNotMatch(JSON.stringify(listing),/output_text|contentRef|source_snapshot_sha256|compiled_snapshot_sha256|source-outline/u);

    const detailed=await candidateRequest("/paid-validation-response-2");
    assert.equal(detailed.status,200,JSON.stringify(await detailed.clone().json()));
    const detail=(await detailed.json()).candidate;
    assert.equal(detail.stage,"repair");
    assert.deepEqual(detail.slides,[]);
    assert.equal(detail.complete,false);
    assert.equal(providerCalls,2,"reviewing rejected paid responses must never contact a provider");

    const originalResult=fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json;
    const racedResponseBefore=fixture.sqlite.prepare("SELECT content,expires_at FROM private_content WHERE kind='provider-response' AND json_extract(content,'$.response_id')=?").get("paid-validation-response-1");
    const originalPreservationPrepare=fixture.environment.DB.prepare.bind(fixture.environment.DB);
    let checkpointPreservationRace=false;
    fixture.environment.DB.prepare=(sql)=>{
      if(!checkpointPreservationRace&&sql.includes("AS presentation_preservation_verified")){
        checkpointPreservationRace=true;
        fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({...JSON.parse(originalResult),privatePreservationRace:true}),job.jobId);
      }
      return originalPreservationPrepare(sql);
    };
    try{
      const racedPreservation=await candidateRequest("/paid-validation-response-1/preserve",{method:"POST"});
      assert.equal(checkpointPreservationRace,true,"preservation must detect a checkpoint changed after evidence inspection");
      assert.equal(racedPreservation.status,404);
      const racedResponseAfter=fixture.sqlite.prepare("SELECT content,expires_at FROM private_content WHERE kind='provider-response' AND json_extract(content,'$.response_id')=?").get("paid-validation-response-1");
      assert.deepEqual(racedResponseAfter,racedResponseBefore,"a stale checkpoint must roll back every private evidence mutation");
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='PresentationCandidatePreserved' AND json_extract(payload,'$.provider_response_id')=?").get("paid-validation-response-1").count,0);
      assert.equal(providerCalls,2);
    }finally{
      fixture.environment.DB.prepare=originalPreservationPrepare;
      fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(originalResult,job.jobId);
    }

    const preserved=await candidateRequest("/paid-validation-response-2/preserve",{method:"POST"});
    assert.equal(preserved.status,200,JSON.stringify(await preserved.clone().json()));
    const preservation=(await preserved.json()).candidate;
    assert.equal(preservation.retentionClass,"governed-evidence");
    assert.ok(Date.parse(preservation.expiresAt)>Date.parse(listing.candidates[1].expiresAt));
    const preservedContent=fixture.sqlite.prepare("SELECT kind,content,expires_at FROM private_content WHERE kind='provider-response' AND json_extract(content,'$.response_id')=?").get("paid-validation-response-2");
    assert.equal(preservedContent.kind,"provider-response","preservation must not expose provider output through ordinary content hydration");
    assert.equal(preservedContent.expires_at,preservation.expiresAt);
    assert.ok(JSON.parse(preservedContent.content).preserved_at);
    const repeated=await candidateRequest("/paid-validation-response-2/preserve",{method:"POST"});
    assert.equal(repeated.status,200);
    assert.equal((await repeated.json()).candidate.expiresAt,preservation.expiresAt,"repeated preservation must not renew the retention clock");
    assert.equal(providerCalls,2,"explicit preservation must never contact a provider");

    const expiredJobCheckpoint=fixture.sqlite.prepare("SELECT expires_at FROM document_jobs WHERE job_id=?").get(job.jobId).expires_at;
    fixture.sqlite.prepare("UPDATE document_jobs SET request_json='{}',result_json=NULL,expires_at=? WHERE job_id=?").run("2000-01-01T00:00:00.000Z",job.jobId);
    const historical=await candidateRequest("/paid-validation-response-2");
    assert.equal(historical.status,200,"explicitly preserved drafts remain discoverable after transient job metadata expires");
    const historicalCandidate=(await historical.json()).candidate;
    assert.equal(historicalCandidate.retentionClass,"governed-evidence");
    assert.equal(historicalCandidate.settledCostMicrousd,1560,"the immutable usage event preserves exact settled cost after transient receipts expire");
    const rediscovered=await handleDocumentJobs(new Request("http://localhost/api/document-jobs/presentation-candidates?document=doc-atmosphere"),fixture.environment,"presentation-candidates");
    assert.equal(rediscovered.status,200,JSON.stringify(await rediscovered.clone().json()));
    const preservedJobs=(await rediscovered.json()).jobs;
    assert.equal(preservedJobs.length,1);
    assert.equal(preservedJobs[0].jobId,job.jobId);
    assert.deepEqual(preservedJobs[0].candidates.map((candidate)=>candidate.responseId),["paid-validation-response-2"]);
    assert.equal(preservedJobs[0].candidates[0].settledCostMicrousd,1560);
    const ordinaryJobs=await handleDocumentJobs(new Request("http://localhost/api/document-jobs?document=doc-atmosphere"),fixture.environment,"");
    assert.equal(ordinaryJobs.status,200,JSON.stringify(await ordinaryJobs.clone().json()));
    assert.ok(!(await ordinaryJobs.json()).jobs.some((candidate)=>candidate.jobId===job.jobId),"preserved evidence must not resurrect expired jobs or private candidates in ordinary job serialization");
    assert.equal(providerCalls,2);
    fixture.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run(expiredJobCheckpoint,job.jobId);
  }finally{globalThis.fetch=previousFetch;}
});

test("rejects a managed authored-slide count conflict before creating jobs, reserving funds, or contacting a provider",async()=>{
  const fixture=await reliabilityWorker();
  await authoredOutline(fixture,12);
  const originalFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("No provider request may run before count acceptance.");};
  try{
    const beforeJobs=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count;
    const beforeReservations=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count;
    const payload={kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"managed",itemCount:4,requestedSlideCount:4,requestKey:"reject-managed-outline-count-conflict"}};
    const response=await handleDocumentJobs(new Request("http://localhost/api/document-jobs",json(payload)),fixture.environment,"");
    assert.equal(response.status,409,JSON.stringify(await response.clone().json()));
    const rejected=await response.json();
    assert.equal(rejected.error,"presentation_slide_count_conflict");
    assert.equal(rejected.authoredSlideCount,12);
    assert.equal(rejected.requestedSlideCount,4);
    assert.equal(rejected.plannedSlideCount,12);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,beforeJobs);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,beforeReservations);
    assert.equal(providerCalls,0);
  }finally{globalThis.fetch=originalFetch;}
});

test("invalid paid presentation alternatives retain visible drafts and safe per-attempt rejection diagnostics without promotion",async()=>{
  const fixture=await reliabilityWorker();
  const documentId=await seedIndependentPresentation(fixture,"private-rejected-slide-alternatives");
  const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url,init={})=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    const draft=independentProviderResponse(init.body);
    if(providerCalls===1)draft.items[2].slide.source_ids=["blk_999"];
    else draft.items[3].context_group_ids=["context_group_999"];
    return Response.json({id:`rejected-visible-alternative-${providerCalls}`,model:"gpt-5.6-terra",output_text:JSON.stringify(draft),usage:{input_tokens:800,output_tokens:400,total_tokens:1200}});
  };
  try{
    const accepted=await requestSourceJob("",json(presentationAdmission(documentId,"private-rejected-slide-alternatives")));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const{job}=await accepted.json();
    const failed=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
    assert.equal(failed.status,200,JSON.stringify(await failed.clone().json()));
    const failedJob=(await failed.json()).job;
    assert.equal(failedJob.status,"failed");
    assert.equal(failedJob.result.recoverablePresentationCandidate,undefined,"source-invalid paid alternatives must never advertise a guaranteed free recovery");
    assert.ok(failedJob.errorDetail.validationIssues.some((issue)=>issue.code==="unknown_source_reference"&&issue.stage==="initial"&&issue.globalSlideIndex===3),JSON.stringify(failedJob.errorDetail.validationIssues));
    assert.ok(failedJob.errorDetail.validationIssues.some((issue)=>issue.code==="unknown_context_group_reference"&&issue.stage==="repair"&&issue.globalSlideIndex===4));
    assert.ok(failedJob.errorDetail.validationIssues.every((issue)=>issue.blocking&&issue.pageIndex===0&&issue.pageCount===1));
    const publicFailure=fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderFailed' AND json_extract(payload,'$.document_id')=?").get(documentId);
    assert.ok(publicFailure);
    assert.ok(JSON.parse(publicFailure.payload).validation_issues.some((issue)=>issue.stage==="initial"));
    assert.ok(JSON.parse(publicFailure.payload).validation_issues.some((issue)=>issue.stage==="repair"));
    assert.doesNotMatch(JSON.stringify(failedJob.errorDetail),/PRIVATE_AUTHORED_SLIDE_|blk_999|context_group_999|output_text|source_snapshot_sha256/u);
    assert.doesNotMatch(publicFailure.payload,/PRIVATE_AUTHORED_SLIDE_|blk_999|context_group_999|output_text|source_snapshot_sha256/u,"shared failure events retain actionable codes without revealing source evidence");
    assert.equal(providerCalls,2);

    const listed=await requestSourceJob(`${job.jobId}/presentation-candidates`);
    assert.equal(listed.status,200,JSON.stringify(await listed.clone().json()));
    const candidates=(await listed.json()).candidates;
    assert.equal(candidates.length,2);
    assert.ok(candidates[0].issues.some((issue)=>issue.code==="unknown_source_reference"&&issue.category==="authorization"));
    assert.ok(candidates[1].issues.some((issue)=>issue.code==="unknown_context_group_reference"&&issue.category==="authorization"));
    assert.ok(candidates.every((candidate)=>candidate.generatedSlideCount===12&&!candidate.complete));

    const detailed=await requestSourceJob(`${job.jobId}/presentation-candidates/rejected-visible-alternative-1`);
    assert.equal(detailed.status,200,JSON.stringify(await detailed.clone().json()));
    const text=await detailed.text();
    const detail=JSON.parse(text).candidate;
    assert.equal(detail.slides.length,12);
    assert.equal(detail.slides[0].title,"RESPONSIVE ASSESSMENT");
    assert.doesNotMatch(text,/PRIVATE_AUTHORED_SLIDE_|blk_999|context_group_999|"(?:sourceIds|source_id|source_ids|image_prompt|content_markdown|output_text)"\s*:/u);

    const foreignHeaders={"oai-authenticated-user-id":"other-presentation-author","oai-authenticated-user-email":"other-presentation-author@example.test"};
    assert.equal((await fixture.request("/api/session",{headers:foreignHeaders})).status,200);
    fixture.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","other-presentation-author");
    for(const[extension,method]of[["","GET"],["/rejected-visible-alternative-1","GET"],["/rejected-visible-alternative-1/preserve","POST"]]){
      const privatePath=`${job.jobId}/presentation-candidates${extension}`;
      const foreign=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${privatePath}`,{method,headers:foreignHeaders}),fixture.environment,privatePath);
      assert.equal(foreign.status,404,`${method} ${extension||"listing"} must remain isolated from another authenticated creator`);
      assert.doesNotMatch(await foreign.text(),/RESPONSIVE ASSESSMENT|PRIVATE_AUTHORED_SLIDE_/u);
    }

    const retainedCandidate=fixture.sqlite.prepare("SELECT content_id,expires_at FROM private_content WHERE kind='provider-response' AND json_extract(content,'$.response_id')=?").get("rejected-visible-alternative-1");
    fixture.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z",retainedCandidate.content_id);
    const expired=await requestSourceJob(`${job.jobId}/presentation-candidates/rejected-visible-alternative-1`);
    assert.equal(expired.status,404,"expired rejected provider responses must never remain reviewable");
    assert.doesNotMatch(await expired.text(),/RESPONSIVE ASSESSMENT|PRIVATE_AUTHORED_SLIDE_/u);
    fixture.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(retainedCandidate.expires_at,retainedCandidate.content_id);

    const impossiblePromotion=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
    assert.equal(impossiblePromotion.status,409,"source-invalid rejected alternatives cannot be promoted");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).count,0);
    assert.equal(providerCalls,2,"candidate review and blocked promotion never issue another provider request");
  }finally{globalThis.fetch=previousFetch;}
});

test("recovers a privately retained paid slideshow without a second provider request or additional charge",async()=>{
  const fixture=await reliabilityWorker();
  const documentId=await seedIndependentPresentation(fixture);
  const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url,init={})=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    return Response.json({id:`privately-retained-response-${providerCalls}`,model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
  };
  try{
    const accepted=await requestSourceJob("",json(presentationAdmission(documentId,"private-response-zero-provider-recovery")));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();
    fixture.sqlite.exec("CREATE TRIGGER fail_presentation_artifact_persistence BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_local_presentation_persistence_failure'); END");
    const failedResponse=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
    assert.equal(failedResponse.status,200,JSON.stringify(await failedResponse.clone().json()));
    const failed=(await failedResponse.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(providerCalls,1);
    assert.equal(failed.result.recoverablePresentationCandidate,true);
    assert.equal(failed.result.presentationCandidates,undefined,"opaque recovery references never reach job projections");
    const privateRows=fixture.sqlite.prepare("SELECT content_id,content FROM private_content WHERE owner_id=? AND kind='provider-response'").all("dev-local-creative");
    assert.equal(privateRows.length,1);
    assert.ok(JSON.parse(privateRows[0].content).output_text.includes(INDEPENDENT_SLIDE_TITLES[0]));
    const priorSettledCost=Number(failed.result.generationReceipt.settled_cost_microusd);
    assert.ok(priorSettledCost>0);
    const beforeReservations=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count;
    const beforeCounters=fixture.sqlite.prepare("SELECT scope,scope_id,used_microusd,reserved_microusd FROM cost_budget_counters ORDER BY scope,scope_id").all();
    fixture.sqlite.exec("DROP TRIGGER fail_presentation_artifact_persistence");

    fixture.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run("dev-local-creative");
    const unconsented=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
    assert.equal(unconsented.status,428,"personal paid-response recovery still requires current creator consent");
    assert.equal(providerCalls,1);
    fixture.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","dev-local-creative");

    const originalCheckpoint=fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json;
    const originalEnvelope=privateRows[0].content;
    const forgedEnvelope=JSON.parse(originalEnvelope);
    const forgedOutput=JSON.parse(forgedEnvelope.output_text);
    forgedOutput.items[0].slide.source_ids=["blk_999"];
    forgedEnvelope.output_text=JSON.stringify(forgedOutput);
    const forgedHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(forgedEnvelope.output_text))),value=>value.toString(16).padStart(2,"0")).join("");
    forgedEnvelope.content_sha256=forgedHash;
    const forgedCheckpoint=JSON.parse(originalCheckpoint);
    forgedCheckpoint.presentationCandidates[0].candidateBytes=new TextEncoder().encode(forgedEnvelope.output_text).byteLength;
    forgedCheckpoint.presentationCandidates[0].contentSha256=forgedHash;
    fixture.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(forgedEnvelope),privateRows[0].content_id);
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(forgedCheckpoint),job.jobId);
    const unauthorized=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
    assert.equal(unauthorized.status,409,"recovery still rejects an invented source alias");
    assert.equal(providerCalls,1,"invalid saved evidence never falls back to a paid provider call");
    fixture.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(originalEnvelope,privateRows[0].content_id);
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(originalCheckpoint,job.jobId);

    const beforeRecoveryArtifacts=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact' AND redacted_at IS NULL").get().count;
    const beforeRecoveryInputs=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact-input' AND redacted_at IS NULL").get().count;
    fixture.sqlite.exec("CREATE TRIGGER fail_recovered_presentation_commit BEFORE UPDATE ON document_jobs WHEN NEW.status='completed' AND OLD.status='committing' AND json_extract(OLD.result_json,'$.presentationRecoveryOnly')=1 BEGIN SELECT RAISE(FAIL,'forced_atomic_presentation_commit_failure'); END");
    const atomicFailure=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
    assert.equal(atomicFailure.status,409,"an interrupted recovery rolls back both presentation completion and zero-cost usage events");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE json_extract(payload,'$.operation')='document-render:slides:recovery'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(job.jobId).status,"failed");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact' AND redacted_at IS NULL").get().count,beforeRecoveryArtifacts,"a failed commit must not leave an unreferenced durable slideshow behind");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact-input' AND redacted_at IS NULL").get().count,beforeRecoveryInputs,"a failed commit must not leave a second private generation receipt behind");
    assert.equal(providerCalls,1,"a failed local commit never resubmits paid provider work");
    fixture.sqlite.exec("DROP TRIGGER fail_recovered_presentation_commit");

    const recoveredResponse=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
    assert.equal(recoveredResponse.status,200,JSON.stringify(await recoveredResponse.clone().json()));
    const recovered=(await recoveredResponse.json()).job;
    assert.equal(recovered.status,"completed");
    assert.equal(recovered.result.generationReceipt.settled_cost_microusd,priorSettledCost);
    assert.equal(recovered.result.generationReceipt.actual_provider_call_count,1);
    assert.equal(providerCalls,1,"replaying saved provider output never submits another paid request");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,beforeReservations);
    assert.deepEqual(fixture.sqlite.prepare("SELECT scope,scope_id,used_microusd,reserved_microusd FROM cost_budget_counters ORDER BY scope,scope_id").all(),beforeCounters);
    const rendered=fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId);
    assert.ok(rendered);
    assert.equal(JSON.parse(rendered.payload).item_count,12);
    assert.equal(recovered.result.generationReceipt.recovered_without_provider_request,true);

    const repeated=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
    assert.equal(repeated.status,200,JSON.stringify(await repeated.clone().json()));
    assert.equal(providerCalls,1,"a repeated recovery is idempotent");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).count,1);
  }finally{globalThis.fetch=previousFetch;}
});

test("recertifies source-authored recurring file-format evidence and recovers its paid slideshow without another provider request",async()=>{
  for(const value of [".doc/.ppt/.mov/.mp3/.psd","scattered .doc/.ppt/.mov/.mp3/.psd files"]){
    const fixture=await reliabilityWorker();
    const variant=value.startsWith("scattered")?"storyboard":"formats";
    const documentId=await seedIndependentPresentation(fixture,`historical-source-evidence-recovery-${variant}`,6);
    const scoreEvidence=`${INDEPENDENT_SLIDE_SCORES.map(([label,score])=>`${label}: ${score}`).join("; ")}. Exact equal-weight average: 61.125. Rounded display value: 61.13.`;
    for(const[index,text]of[[1,`Slide 1 — ${INDEPENDENT_SLIDE_TITLES[0]}\nPreviously one story required fragmented .doc · .ppt · .mov · .mp3 · .psd handoffs.`],[3,`Slide 3 — ${INDEPENDENT_SLIDE_TITLES[2]}\n${scoreEvidence}`],[5,`Slide 5 — ${INDEPENDENT_SLIDE_TITLES[4]}\nIndependent evidence for context immutability preserves conversion 14.25%. Visual storyboard beats: scattered .doc/.ppt/.mov/.mp3/.psd files; one coherent Forma context; infinite delivery paths.`]]){
      await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{
        project_id:"project-atmosphere",document_id:documentId,block_id:`PRIVATE_AUTHORED_SLIDE_${index}`,
        property_path:"text",new_value:text,
      });
    }
    const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
    const previousFetch=globalThis.fetch;
    let providerCalls=0;
    globalThis.fetch=async(url,init={})=>{
      assert.equal(String(url),"https://api.openai.com/v1/responses");
      providerCalls+=1;
      const output=independentProviderResponse(init.body);
      const opening=output.items[0],scored=output.items[2],scoreAlias=scored.slide.source_ids[0];
      const protectedScorecard={...opening.slide.visual,data:opening.slide.visual.data.map((datum)=>({...datum,source_ids:[scoreAlias]}))};
      opening.body="Legacy handoffs forced one story through disconnected communication mediums.";
      opening.slide.layout="cover";
      opening.slide.visual={kind:"hero-type",label:"Legacy format fragmentation",value:".doc · .ppt · .mov · .mp3 · .psd",data:[]};
      scored.slide.layout="scorecard";
      scored.slide.visual=protectedScorecard;
      const item=output.items[4],alias=item.slide.source_ids[0];
      item.body="Authorized editorial transition preserves conversion 14.25%.";
      item.slide.layout="comparison";
      item.slide.visual={kind:"comparison",label:"Storyboard transition",value:"",data:[
        {label:"Fragmented handoffs",value,weight:1,source_ids:[alias]},
        {label:"Unified delivery",value:"one coherent Forma context",weight:.8,source_ids:[alias]},
      ]};
      output.content_markdown=output.items.map((entry,index)=>`## ${index+1}. ${entry.title}\n${entry.body}`).join("\n\n");
      return Response.json({id:`historical-source-evidence-response-${variant}-${providerCalls}`,model:"gpt-5.6-terra",output_text:JSON.stringify(output),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
    };
    try{
      const admission=presentationAdmission(documentId,`historical-source-evidence-recovery-${variant}`);
      Object.assign(admission.payload,{itemCount:6,requestedSlideCount:6});
      const accepted=await requestSourceJob("",json(admission));
      assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
      const{job}=await accepted.json();
      fixture.sqlite.exec("CREATE TRIGGER fail_source_evidence_persistence BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_source_evidence_persistence_failure'); END");
      const failedResponse=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
      assert.equal(failedResponse.status,200,JSON.stringify(await failedResponse.clone().json()));
      const failed=(await failedResponse.json()).job;
      assert.equal(failed.status,"failed");
      assert.equal(providerCalls,1,"source-authored recurring file-format evidence must not trigger a paid repair request");
      assert.equal(failed.result.recoverablePresentationCandidate,true);
      const settledCost=failed.result.generationReceipt.settled_cost_microusd;
      fixture.sqlite.exec("DROP TRIGGER fail_source_evidence_persistence");

      const staleCheckpoint=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
      staleCheckpoint.recoverablePresentationCandidate=false;
      staleCheckpoint.presentationCandidates=staleCheckpoint.presentationCandidates.map((candidate)=>({...candidate,locallyRecoverable:false}));
      fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(staleCheckpoint),job.jobId);

      const reassessed=await requestSourceJob();
      assert.equal(reassessed.status,200,JSON.stringify(await reassessed.clone().json()));
      const visible=(await reassessed.json()).jobs.find((candidate)=>candidate.jobId===job.jobId);
      assert.equal(visible.result.recoverablePresentationCandidate,true,"historically rejected source-authored visual evidence must be recertified by current validation");
      assert.equal(providerCalls,1,"dynamic candidate certification must not issue another paid provider request");

      const candidates=await requestSourceJob(`${job.jobId}/presentation-candidates`);
      assert.equal(candidates.status,200,JSON.stringify(await candidates.clone().json()));
      assert.equal((await candidates.json()).candidates[0].complete,true,"the exact retained source-authored candidate must be independently certified");

      const recoveredResponse=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
      assert.equal(recoveredResponse.status,200,JSON.stringify(await recoveredResponse.clone().json()));
      const recovered=(await recoveredResponse.json()).job;
      assert.equal(recovered.status,"completed");
      assert.equal(recovered.result.generationReceipt.settled_cost_microusd,settledCost);
      assert.equal(recovered.result.generationReceipt.recovered_without_provider_request,true);
      assert.equal(providerCalls,1,"recovering recurring authored evidence must not create a second provider submission");

      const draft=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE kind='document-artifact' AND redacted_at IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1").get().content);
      assert.equal(draft.items[4].slide.visual.data[0].value,value,"source-authored file-format evidence must remain completely verbatim");
      assert.ok(draft.items[4].slide.visual.data[0].sourceIds.includes("PRIVATE_AUTHORED_SLIDE_5"),"the recovered visual row must retain its exact authorized authored source");
      assert.equal(draft.items[0].slide.visual.value,".doc · .ppt · .mov · .mp3 · .psd","the earlier source-authored format list must also remain verbatim");
      assert.equal(draft.items[2].slide.visual.exactValue,"61.125","cosmetic evidence allowances must never modify protected exact scores");
      assert.equal(draft.items[2].slide.visual.displayValue,"61.13","cosmetic evidence allowances must never modify protected rounded scores");
      assert.equal(draft.items[1].slide.quote.text,INDEPENDENT_SLIDE_QUOTE,"protected stakeholder quotations must remain verbatim");
    }finally{globalThis.fetch=previousFetch;}
  }
});

test("recovers a privately retained title-and-question slideshow without weakening source validation or paying again",async()=>{
  for(const variant of ["row-values","row-labels"]){
    const fixture=await reliabilityWorker();
    const documentId=await seedIndependentPresentation(fixture,`historical-opening-recovery-${variant}`);
    const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
    const previousFetch=globalThis.fetch;
    let providerCalls=0;
    globalThis.fetch=async(url,init={})=>{
      assert.equal(String(url),"https://api.openai.com/v1/responses");
      providerCalls+=1;
      const output=independentProviderResponse(init.body);
      const item=output.items[2],alias=item.slide.source_ids[0],body=item.body;
      item.slide.layout=variant==="row-values"?"comparison":"architecture";
      item.slide.visual={kind:item.slide.layout,label:"Authored opening concepts",value:"",data:variant==="row-values"
        ?[{label:"Title",value:item.title,weight:1,source_ids:[alias]},{label:"Question",value:body,weight:.8,source_ids:[alias]}]
        :[{label:item.title,value:item.title,weight:1,source_ids:[alias]},{label:body,value:body,weight:.8,source_ids:[alias]}]};
      return Response.json({id:`historical-opening-response-${variant}`,model:"gpt-5.6-terra",output_text:JSON.stringify(output),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
    };
    try{
      const accepted=await requestSourceJob("",json(presentationAdmission(documentId,`historical-opening-recovery-${variant}`)));
      assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
      const{job}=await accepted.json();
      fixture.sqlite.exec("CREATE TRIGGER fail_historical_opening_persistence BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_historical_opening_persistence_failure'); END");
      const failedResponse=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
      assert.equal(failedResponse.status,200,JSON.stringify(await failedResponse.clone().json()));
      const failed=(await failedResponse.json()).job;
      assert.equal(failed.status,"failed");
      assert.equal(failed.result.recoverablePresentationCandidate,true);
      assert.equal(providerCalls,1,"cosmetic normalization avoids an additional paid repair attempt");
      const settledCost=failed.result.generationReceipt.settled_cost_microusd;
      fixture.sqlite.exec("DROP TRIGGER fail_historical_opening_persistence");

      const staleCheckpoint=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
      staleCheckpoint.recoverablePresentationCandidate=false;
      staleCheckpoint.presentationCandidates=staleCheckpoint.presentationCandidates.map((candidate)=>({...candidate,locallyRecoverable:false}));
      fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(staleCheckpoint),job.jobId);
      const reassessed=await requestSourceJob();
      assert.equal(reassessed.status,200,JSON.stringify(await reassessed.clone().json()));
      assert.equal((await reassessed.json()).jobs.find((candidate)=>candidate.jobId===job.jobId).result.recoverablePresentationCandidate,true,"current validators must reassess retained paid drafts without trusting obsolete historical checkpoint flags");
      assert.equal(providerCalls,1,"dynamic recovery certification must not contact a provider");

      const recoveredResponse=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
      assert.equal(recoveredResponse.status,200,JSON.stringify(await recoveredResponse.clone().json()));
      const recovered=(await recoveredResponse.json()).job;
      assert.equal(recovered.status,"completed");
      assert.equal(recovered.result.generationReceipt.settled_cost_microusd,settledCost);
      assert.equal(recovered.result.generationReceipt.recovered_without_provider_request,true);
      assert.equal(providerCalls,1,`${variant}: the retained response is recovered without another provider request`);
      const completed=JSON.parse(fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).payload);
      assert.equal(completed.item_count,12);
      const recoveredDraft=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE kind='document-artifact' AND redacted_at IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1").get().content);
      assert.ok(recoveredDraft.items[2].slide.sourceIds.includes("PRIVATE_AUTHORED_SLIDE_3"));
      assert.equal(recoveredDraft.items[2].slide.visual.kind,variant==="row-values"?"architecture":"hero-type");
    }finally{globalThis.fetch=previousFetch;}
  }
});

test("recovers paid presentations from the legacy source compiler without accepting changed authored evidence",async()=>{
  const sha256=async(value)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,"0")).join("");
  for(const variant of ["valid","legacy-member-order","foreign-chapter","changed-source","changed-membership","changed-relation","forged-revision","forged-source-hash"]){
    const fixture=await reliabilityWorker();
    const documentId=await seedIndependentPresentation(fixture,`legacy-source-recovery-${variant}`,6);
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockRelationAdded",{
      project_id:"project-atmosphere",document_id:documentId,relation_id:`legacy-relation-${variant}`,
      from_block_id:"PRIVATE_AUTHORED_SLIDE_1",to_block_id:"PRIVATE_AUTHORED_SLIDE_2",
      kind:"supports",properties:{weight:.7},
    });
    for(let index=0;index<6;index+=1)await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{
      project_id:"project-atmosphere",document_id:documentId,block_id:`PRIVATE_AUTHORED_SLIDE_${index+1}`,
      property_path:"combined_context_memberships",new_value:[{context_set_id:`legacy-chapter-${index+1}`,
        name:`Authorized chapter ${index+1}`,target:index===0?"first slide":index===5?"last slide":`Slide ${index+1}`,
        role:"slide_chapter",application:"isolate",member_order:0}],
    });
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{
      project_id:"project-atmosphere",document_id:documentId,block_id:"PRIVATE_OBJECTIVE",
      property_path:"combined_context_memberships",new_value:[{context_set_id:"legacy-chapter-1",
        name:"Authorized chapter 1",target:"first slide",role:"slide_chapter",application:"isolate",member_order:1}],
    });
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockRelationAdded",{
      project_id:"project-atmosphere",document_id:documentId,relation_id:`legacy-membership-${variant}`,
      from_block_id:"PRIVATE_AUTHORED_SLIDE_1",to_block_id:"PRIVATE_OBJECTIVE",kind:"combined_context_member",
      properties:{context_set_id:"legacy-chapter-1",member_order:1,semantic_isolation:true},
    });
    const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
    const previousFetch=globalThis.fetch;
    let providerCalls=0;
    globalThis.fetch=async(_url,init={})=>{
      providerCalls+=1;
      const request=JSON.parse(init.body),input=JSON.parse(request.input),output=independentProviderResponse(init.body);
      output.items=output.items.map((item,index)=>{
        const scene=input.production.assigned_scenes[index],alias=scene.source_keys[0];
        item.context_group_ids=scene.context_keys;
        item.slide.source_ids=scene.source_keys;
        item.slide.citations=item.slide.citations.map(citation=>({...citation,source_id:alias}));
        if(item.slide.quote)item.slide.quote.source_id=alias;
        item.slide.visual.data=item.slide.visual.data.map(value=>({...value,source_ids:[alias]}));
        return item;
      });
      return Response.json({id:`legacy-source-response-${variant}`,model:"gpt-5.6-terra",output_text:JSON.stringify(output),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
    };
    try{
      const admission=presentationAdmission(documentId,`legacy-source-recovery-${variant}`);
      Object.assign(admission.payload,{productionMode:"managed",itemCount:6,requestedSlideCount:6});
      const accepted=await requestSourceJob("",json(admission));
      assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
      const{job}=await accepted.json();
      fixture.sqlite.exec("CREATE TRIGGER fail_legacy_source_persistence BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_legacy_source_persistence_failure'); END");
      const failed=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
      assert.equal((await failed.json()).job.status,"failed");
      fixture.sqlite.exec("DROP TRIGGER fail_legacy_source_persistence");

      const persisted=fixture.sqlite.prepare("SELECT request_json,result_json FROM document_jobs WHERE job_id=?").get(job.jobId);
      const request=JSON.parse(persisted.request_json);
      const checkpoint=JSON.parse(persisted.result_json);
      const originalSource=fixture.sqlite.prepare("SELECT content_id,content FROM private_content WHERE kind='document-artifact-input' AND json_extract(content,'$.job_id')=?").get(job.jobId);
      const receipt=JSON.parse(originalSource.content);
      const response=fixture.sqlite.prepare("SELECT content_id,content FROM private_content WHERE kind='provider-response' AND json_extract(content,'$.job_id')=?").get(job.jobId);
      const envelope=JSON.parse(response.content);
      const {context_groups,...legacySnapshot}=request.snapshot;
      assert.equal(context_groups.length,6,"the current compiler materializes all six isolated, source-bound chapters");
      const legacyHash=await sha256(legacySnapshot);
      const legacyRevision=documentGenerationRevision({snapshot:legacySnapshot,sourceBlockVersions:request.sourceBlockVersions,documentId});
      const modernCompiled={...request.snapshot,document:{id:documentId,title:"Event-Sourced Conversational Experience — Executive Plan"}};
      assert.equal(await sha256(modernCompiled),envelope.compiled_snapshot_sha256,"the fixture must reproduce the exact retained provider source");
      const legacyCompiled={...legacySnapshot,document:modernCompiled.document};
      const legacyCompiledHash=await sha256(legacyCompiled);

      request.snapshot=legacySnapshot;
      request.documentRevision=variant==="forged-revision"?"rev-forged":legacyRevision;
      checkpoint.generationReceipt.source_snapshot_sha256=variant==="forged-source-hash"?"0".repeat(64):legacyHash;
      checkpoint.presentationCandidates=checkpoint.presentationCandidates.map(candidate=>({
        ...candidate,documentRevision:legacyRevision,sourceSnapshotSha256:legacyHash,compiledSnapshotSha256:legacyCompiledHash,
      }));
      if(variant==="legacy-member-order"){
        assert.ok(checkpoint.productionPlan.scenes[0].sourceBlockIds.length>1);
        checkpoint.productionPlan.scenes[0].sourceBlockIds.reverse();
      }
      if(variant==="foreign-chapter")checkpoint.productionPlan.scenes[0].sourceBlockIds.push("PRIVATE_AUTHORED_SLIDE_2");
      receipt.document_snapshot=legacySnapshot;
      receipt.source.snapshot_sha256=legacyHash;
      Object.assign(envelope,{document_revision:legacyRevision,source_snapshot_sha256:legacyHash,compiled_snapshot_sha256:legacyCompiledHash});
      fixture.sqlite.prepare("UPDATE document_jobs SET request_json=?,result_json=? WHERE job_id=?")
        .run(JSON.stringify(request),JSON.stringify(checkpoint),job.jobId);
      fixture.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?")
        .run(JSON.stringify(receipt),originalSource.content_id);
      fixture.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?")
        .run(JSON.stringify(envelope),response.content_id);

      if(variant==="changed-source")await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{
        project_id:"project-atmosphere",document_id:documentId,block_id:"PRIVATE_AUTHORED_SLIDE_1",
        property_path:"text",new_value:"A genuinely different authored decision must remain protected.",
      });
      if(variant==="changed-membership")await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{
        project_id:"project-atmosphere",document_id:documentId,block_id:"PRIVATE_AUTHORED_SLIDE_1",
        property_path:"combined_context_memberships",new_value:[{context_set_id:"legacy-chapter-1",
          name:"A different chapter authorization",target:"last slide",role:"slide_chapter",application:"isolate",member_order:0}],
      });
      if(variant==="changed-relation")await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockRelationRemoved",{
        project_id:"project-atmosphere",document_id:documentId,relation_id:`legacy-relation-${variant}`,
      });

      const recovered=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
      if(variant==="valid"||variant==="legacy-member-order"){
        assert.equal(recovered.status,200,JSON.stringify(await recovered.clone().json()));
        const completed=(await recovered.json()).job;
        assert.equal(completed.status,"completed");
        assert.equal(completed.result.generationReceipt.source_snapshot_sha256,legacyHash);
        assert.equal(completed.result.generationReceipt.actual_provider_call_count,1);
        assert.equal(completed.result.generationReceipt.recovered_without_provider_request,true);
      }else{
        assert.equal(recovered.status,409,`${variant}: ${JSON.stringify(await recovered.clone().json())}`);
        assert.equal((await recovered.json()).error,variant==="foreign-chapter"?"presentation_recovery_unavailable":"presentation_recovery_source_changed");
        assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).count,0);
      }
      assert.equal(providerCalls,1,`${variant}: reviewing historical evidence never invokes a provider`);
    }finally{globalThis.fetch=previousFetch;}
  }
});

test("an identical paid slideshow retry automatically recovers its retained complete response before reserving or spending again",async()=>{
  const fixture=await reliabilityWorker();
  const documentId=await seedIndependentPresentation(fixture,"identical-paid-recovery");
  const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
  const admission=presentationAdmission(documentId,"identical-paid-recovery");
  const previousFetch=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async(_url,init={})=>{providerCalls+=1;return Response.json({id:`identical-paid-response-${providerCalls}`,model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});};
  try{
    const accepted=await requestSourceJob("",json(admission));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const{job}=await accepted.json();
    fixture.sqlite.exec("CREATE TRIGGER fail_identical_paid_persistence BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_identical_paid_persistence_failure'); END");
    const failedResponse=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
    assert.equal((await failedResponse.json()).job.status,"failed");
    fixture.sqlite.exec("DROP TRIGGER fail_identical_paid_persistence");
    const checkpoint=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
    checkpoint.recoverablePresentationCandidate=false;checkpoint.presentationCandidates=checkpoint.presentationCandidates.map((candidate)=>({...candidate,locallyRecoverable:false}));
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),job.jobId);
    const beforeJobs=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count;
    const beforeReservations=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count;
    const settledCost=checkpoint.generationReceipt.settled_cost_microusd;
    const repeated=await requestSourceJob("",json(admission));
    assert.equal(repeated.status,200,JSON.stringify(await repeated.clone().json()));
    const recovered=await repeated.json();
    assert.equal(recovered.reused,true);assert.equal(recovered.recovered,true);assert.equal(recovered.job.jobId,job.jobId);assert.equal(recovered.job.status,"completed");
    assert.equal(recovered.job.result.generationReceipt.settled_cost_microusd,settledCost);
    assert.equal(recovered.job.result.generationReceipt.actual_provider_call_count,1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count,beforeJobs);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,beforeReservations);
    assert.equal(providerCalls,1,"the identical retry must recover before another source receipt, reservation, or paid provider request");
  }finally{globalThis.fetch=previousFetch;}
});

test("recovers a complete managed slideshow only with its original chapter-specific authorization",async()=>{
  for(const foreignSource of [false,true]){
    const fixture=await reliabilityWorker();
    const documentId=await seedIndependentPresentation(fixture,`managed-private-recovery-${foreignSource}`,6);
    const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
    const previousFetch=globalThis.fetch;
    let providerCalls=0;
    globalThis.fetch=async(url,init={})=>{
      assert.equal(String(url),"https://api.openai.com/v1/responses");
      providerCalls+=1;
      const output=independentProviderResponse(init.body);
      if(foreignSource)output.items[0].slide.source_ids.push("blk_002");
      return Response.json({id:`managed-private-response-${foreignSource}-${providerCalls}`,model:"gpt-5.6-terra",output_text:JSON.stringify(output),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
    };
    try{
      const admission=presentationAdmission(documentId,`managed-private-recovery-${foreignSource}`);
      Object.assign(admission.payload,{productionMode:"managed",itemCount:6,requestedSlideCount:6});
      const accepted=await requestSourceJob("",json(admission));
      assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
      const{job}=await accepted.json();
      if(!foreignSource)fixture.sqlite.exec("CREATE TRIGGER fail_managed_presentation_persistence BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_managed_presentation_persistence_failure'); END");
      const failedResponse=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
      assert.equal(failedResponse.status,200,JSON.stringify(await failedResponse.clone().json()));
      const failed=(await failedResponse.json()).job;
      assert.equal(failed.status,"failed");

      if(foreignSource){
        assert.equal(failed.result.recoverablePresentationCandidate,undefined,"a globally valid alias from the wrong managed chapter is not recoverable");
        assert.ok(failed.errorDetail.validationIssues.some((issue)=>issue.code==="incorrect_slide_source"));
        const checkpoint=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
        checkpoint.recoverablePresentationCandidate=true;
        fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),job.jobId);
        const blocked=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
        assert.equal(blocked.status,409,"legacy overbroad recoverability flags cannot bypass chapter-specific source authorization");
        assert.equal(providerCalls,2,"rejected candidate promotion never starts another paid provider request");
        assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).count,0);
      }else{
        assert.equal(failed.result.recoverablePresentationCandidate,true);
        const settledCost=failed.result.generationReceipt.settled_cost_microusd;
        fixture.sqlite.exec("DROP TRIGGER fail_managed_presentation_persistence");
        const recoveredResponse=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
        assert.equal(recoveredResponse.status,200,JSON.stringify(await recoveredResponse.clone().json()));
        const recovered=(await recoveredResponse.json()).job;
        assert.equal(recovered.status,"completed");
        assert.equal(recovered.result.generationReceipt.settled_cost_microusd,settledCost);
        assert.equal(recovered.result.generationReceipt.recovered_without_provider_request,true);
        assert.equal(providerCalls,1);
        const completed=JSON.parse(fixture.sqlite.prepare("SELECT secret.private_json AS payload FROM events completed JOIN event_private_payloads secret ON secret.private_event_id=completed.event_id WHERE completed.type='DocumentRenderCompleted' AND json_extract(completed.payload,'$.document_id')=?").get(documentId).payload);
        assert.equal(completed.item_count,6);
        assert.equal(completed.settings.production_mode,"managed");
        assert.equal(completed.settings.production_team.id,"presentation-editorial-team");
        assert.equal(completed.settings.production_system.format,"slides");
        assert.ok(completed.settings.production_quality);
        assert.deepEqual(completed.items.map((item)=>item.narrative_order),[1,2,3,4,5,6]);
        assert.ok(completed.items.every((item)=>item.scene_id&&item.generation_order>0));
        const recoveredReceipt=fixture.sqlite.prepare("SELECT content FROM private_content WHERE kind='document-artifact-input' AND json_extract(content,'$.planner.recovered_without_provider_request')=1 ORDER BY created_at DESC,rowid DESC LIMIT 1").get();
        const recoveredInput=JSON.parse(recoveredReceipt.content);
        assert.equal(recoveredInput.request.production_mode,"managed");
        assert.equal(recoveredInput.production.team.id,"presentation-editorial-team");
        assert.equal(recoveredInput.production.system.format,"slides");
        assert.ok(recoveredInput.production.work_units.length>0);
        assert.equal(recoveredInput.production.plan.scenes.length,6);
      }
    }finally{globalThis.fetch=previousFetch;}
  }
});

test("settles a paid slideshow request truthfully when private provider-response capture fails",async()=>{
  const fixture=await reliabilityWorker();
  const documentId=await seedIndependentPresentation(fixture,"provider-response-capture-failure-document");
  const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url,init={})=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    return Response.json({id:"paid-response-private-capture-failed",model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
  };
  try{
    const accepted=await requestSourceJob("",json(presentationAdmission(documentId,"private-provider-response-capture-failure")));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const{job}=await accepted.json();
    fixture.sqlite.exec("CREATE TRIGGER fail_private_provider_response_capture BEFORE INSERT ON private_content WHEN NEW.kind='provider-response' BEGIN SELECT RAISE(FAIL,'forced_private_provider_response_capture_failure'); END");
    const response=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(providerCalls,1,"a failed private checkpoint must not duplicate the original provider request");
    assert.equal(failed.result.generationReceipt.actual_provider_call_count,1);
    assert.equal(failed.result.generationReceipt.provider_request_status,"submitted");
    assert.ok(failed.result.generationReceipt.settled_cost_microusd>0,"the already-paid model response remains truthfully charged");
    assert.equal(failed.result.recoverablePresentationCandidate,undefined,"a missing retained response must never advertise free recovery");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='provider-response'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
    const reservation=fixture.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE correlation_id=?").get(`${job.jobId}:attempt:1`);
    assert.equal(reservation.status,"settled");
    assert.equal(reservation.used_microusd,failed.result.generationReceipt.settled_cost_microusd);
    const usage=fixture.sqlite.prepare("SELECT payload FROM events WHERE type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=?").get("paid-response-private-capture-failed");
    assert.ok(usage,"the failed request retains an auditable paid-provider usage event");
    assert.equal(JSON.parse(usage.payload).total_tokens,2000);
  }finally{globalThis.fetch=previousFetch;}
});

test("recovers a project owner's actor-private slideshow only while its selected project session remains active",async()=>{
  const fixture=await reliabilityWorker();
  const documentId=await seedIndependentPresentation(fixture,"project-owner-private-response-recovery-document");
  const workspace=await fixture.request("/api/workspaces",json({name:"Project owner private presentation recovery"}));
  assert.equal(workspace.status,201,JSON.stringify(await workspace.clone().json()));
  const organizationId=(await workspace.json()).organizationId;
  const registered=await fixture.request(`/api/workspaces/${organizationId}/projects`,json({projectId:"project-atmosphere"}));
  assert.equal(registered.status,201,JSON.stringify(await registered.clone().json()));
  const projectAccessId=(await registered.json()).projectAccessId;
  const opened=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST"});
  assert.equal(opened.status,200,JSON.stringify(await opened.clone().json()));
  const scoped={cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};
  const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),...scoped}}),fixture.environment,path);
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(url,init={})=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    providerCalls+=1;
    return Response.json({id:"project-owner-privately-retained-response",model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
  };
  try{
    const accepted=await requestSourceJob("",json(presentationAdmission(documentId,"project-owner-private-provider-response-recovery")));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const{job}=await accepted.json();
    fixture.sqlite.exec("CREATE TRIGGER fail_project_owner_presentation_artifact BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_project_owner_presentation_artifact_failure'); END");
    const failedResponse=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
    assert.equal(failedResponse.status,200,JSON.stringify(await failedResponse.clone().json()));
    const failed=(await failedResponse.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.result.recoverablePresentationCandidate,true);
    assert.equal(failed.result.generationReceipt,undefined,"project projections never expose the owner's private request receipt");
    assert.equal(providerCalls,1);
    fixture.sqlite.exec("DROP TRIGGER fail_project_owner_presentation_artifact");

    const privateResponse=fixture.sqlite.prepare("SELECT content_id FROM private_content WHERE owner_id=? AND kind='provider-response'").get("dev-local-creative");
    assert.ok(privateResponse);
    assert.equal(fixture.sqlite.prepare("SELECT visibility FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=? AND project_access_id=?").get(privateResponse.content_id,projectAccessId).visibility,"actor_private");
    const visible=await requestSourceJob(job.jobId);
    assert.equal(visible.status,200,JSON.stringify(await visible.clone().json()));
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=? AND project_access_id=?").get(privateResponse.content_id,projectAccessId).count,1,"project synchronization must preserve an owner's retained actor-private provider response");

    const reviewed=await requestSourceJob(`${job.jobId}/presentation-candidates`);
    assert.equal(reviewed.status,200,JSON.stringify(await reviewed.clone().json()));
    const reviewList=await reviewed.json();
    assert.equal(reviewList.candidates.length,1);
    assert.equal(reviewList.candidates[0].complete,true,"the valid paid response remains reviewable separately from its failed local persistence");
    const inspected=await requestSourceJob(`${job.jobId}/presentation-candidates/project-owner-privately-retained-response`);
    assert.equal(inspected.status,200,JSON.stringify(await inspected.clone().json()));
    const inspectionText=await inspected.text();
    assert.match(inspectionText,/RESPONSIVE ASSESSMENT/u);
    assert.doesNotMatch(inspectionText,/PRIVATE_AUTHORED_SLIDE_|sourceIds|source_id|context_group_ids|image_prompt|content_markdown|output_text/u,"actor-private rendered drafts must not expose opaque source references or provider prompts");
    const unscoped=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${job.jobId}/presentation-candidates/project-owner-privately-retained-response`),fixture.environment,`${job.jobId}/presentation-candidates/project-owner-privately-retained-response`);
    assert.equal(unscoped.status,404,"omitting the selected project context must not bypass actor-private project containment");

    const contextId=fixture.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE principal_user_id=? AND project_access_id=? AND revoked_at IS NULL").get("dev-local-creative",projectAccessId).context_id;
    const originalCandidatePrepare=fixture.environment.DB.prepare.bind(fixture.environment.DB);
    let candidateReadRevoked=false;
    fixture.environment.DB.prepare=(sql)=>{
      if(!candidateReadRevoked&&sql.includes("JOIN project_resource_scopes evidence")&&sql.includes("JOIN project_context_sessions selection")){
        candidateReadRevoked=true;
        fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),contextId);
      }
      return originalCandidatePrepare(sql);
    };
    try{
      const revokedDuringRead=await requestSourceJob(`${job.jobId}/presentation-candidates/project-owner-privately-retained-response`);
      assert.equal(candidateReadRevoked,true,"review must recheck the selected session inside the guarded evidence query");
      assert.equal(revokedDuringRead.status,404);
      assert.doesNotMatch(await revokedDuringRead.text(),/RESPONSIVE ASSESSMENT|PRIVATE_AUTHORED_SLIDE_/u);
      assert.equal(providerCalls,1);
    }finally{
      fixture.environment.DB.prepare=originalCandidatePrepare;
      fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(contextId);
    }

    const originalProjectContent=fixture.sqlite.prepare("SELECT content,expires_at FROM private_content WHERE content_id=?").get(privateResponse.content_id);
    const originalProjectRetention=fixture.sqlite.prepare("SELECT classification,assigned_expires_at FROM private_content_retention_scopes WHERE content_id=?").get(privateResponse.content_id);
    const originalProjectCheckpoint=fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json;
    const originalProjectPreservationPrepare=fixture.environment.DB.prepare.bind(fixture.environment.DB);
    let preservationSessionRevoked=false;
    fixture.environment.DB.prepare=(sql)=>{
      if(!preservationSessionRevoked&&sql.includes("AS presentation_preservation_verified")){
        preservationSessionRevoked=true;
        fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),contextId);
      }
      return originalProjectPreservationPrepare(sql);
    };
    try{
      const revokedDuringPreservation=await requestSourceJob(`${job.jobId}/presentation-candidates/project-owner-privately-retained-response/preserve`,{method:"POST"});
      assert.equal(preservationSessionRevoked,true,"preservation must recheck project authorization at its atomic commit");
      assert.equal(revokedDuringPreservation.status,404);
      assert.deepEqual(fixture.sqlite.prepare("SELECT content,expires_at FROM private_content WHERE content_id=?").get(privateResponse.content_id),originalProjectContent);
      assert.deepEqual(fixture.sqlite.prepare("SELECT classification,assigned_expires_at FROM private_content_retention_scopes WHERE content_id=?").get(privateResponse.content_id),originalProjectRetention);
      assert.equal(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json,originalProjectCheckpoint);
      assert.equal(providerCalls,1,"failed project preservation cannot initiate a provider request");
    }finally{
      fixture.environment.DB.prepare=originalProjectPreservationPrepare;
      fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(contextId);
    }

    const preservedDraft=await requestSourceJob(`${job.jobId}/presentation-candidates/project-owner-privately-retained-response/preserve`,{method:"POST"});
    assert.equal(preservedDraft.status,200,JSON.stringify(await preservedDraft.clone().json()));
    const governed=(await preservedDraft.json()).candidate;
    assert.equal(governed.retentionClass,"governed-evidence");
    const retention=fixture.sqlite.prepare("SELECT classification,assigned_expires_at FROM private_content_retention_scopes WHERE content_id=?").get(privateResponse.content_id);
    assert.equal(retention.classification,"governed-evidence");
    assert.equal(retention.assigned_expires_at,governed.expiresAt);
    assert.equal(fixture.sqlite.prepare("SELECT kind,expires_at FROM private_content WHERE content_id=?").get(privateResponse.content_id).kind,"provider-response");

    const originalHistoricalJob=fixture.sqlite.prepare("SELECT request_json,result_json,expires_at FROM document_jobs WHERE job_id=?").get(job.jobId);
    fixture.sqlite.prepare("UPDATE document_jobs SET request_json='{}',result_json=NULL,expires_at=? WHERE job_id=?").run("2000-01-01T00:00:00.000Z",job.jobId);
    const preservedProjectListing=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/presentation-candidates?document=${encodeURIComponent(documentId)}`,{headers:scoped}),fixture.environment,"presentation-candidates");
    assert.equal(preservedProjectListing.status,200,JSON.stringify(await preservedProjectListing.clone().json()));
    const rediscoveredProject=(await preservedProjectListing.json()).jobs;
    assert.equal(rediscoveredProject.length,1);
    assert.equal(rediscoveredProject[0].jobId,job.jobId);
    assert.equal(rediscoveredProject[0].candidates[0].responseId,"project-owner-privately-retained-response");
    assert.ok(rediscoveredProject[0].candidates[0].settledCostMicrousd>0,"project evidence retains its exact settled cost after private job checkpoints expire");
    const historicalProjectDetail=await requestSourceJob(`${job.jobId}/presentation-candidates/project-owner-privately-retained-response`);
    assert.equal(historicalProjectDetail.status,200,JSON.stringify(await historicalProjectDetail.clone().json()));
    fixture.sqlite.prepare("UPDATE document_jobs SET request_json=?,result_json=?,expires_at=? WHERE job_id=?").run(originalHistoricalJob.request_json,originalHistoricalJob.result_json,originalHistoricalJob.expires_at,job.jobId);

    const collaboratorHeaders={"oai-authenticated-user-id":"project-presentation-collaborator","oai-authenticated-user-email":"project-presentation-collaborator@example.test"};
    assert.equal((await fixture.request("/api/session",{headers:collaboratorHeaders})).status,200);
    fixture.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","project-presentation-collaborator");
    const invited=await fixture.request(`/api/workspaces/${organizationId}/members`,json({email:"project-presentation-collaborator@example.test",role:"member"}));
    assert.equal(invited.status,201,JSON.stringify(await invited.clone().json()));
    const invitation=await invited.json();
    const acceptedInvitation=await fixture.request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,json({token:new URL(invitation.invitationUrl).searchParams.get("token")},collaboratorHeaders));
    assert.equal(acceptedInvitation.status,200,JSON.stringify(await acceptedInvitation.clone().json()));
    const teammate=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`,json({userId:"project-presentation-collaborator",role:"editor"}));
    assert.equal(teammate.status,201,JSON.stringify(await teammate.clone().json()));
    const teammateContext=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers:collaboratorHeaders});
    assert.equal(teammateContext.status,200,JSON.stringify(await teammateContext.clone().json()));
    const teammateScope={...collaboratorHeaders,cookie:teammateContext.headers.get("set-cookie")?.split(";")[0]??""};
    const teammateSession=await fixture.request("/api/session",{headers:teammateScope});
    assert.equal(teammateSession.status,200);
    assert.ok((await teammateSession.json()).projectContext.permissions.includes("project.output.request"),"the collaborator has genuine access to this same shared project and document");
    for(const[extension,method]of[["","GET"],["/project-owner-privately-retained-response","GET"],["/project-owner-privately-retained-response/preserve","POST"]]){
      const privatePath=`${job.jobId}/presentation-candidates${extension}`;
      const collaboratorAttempt=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${privatePath}`,{method,headers:teammateScope}),fixture.environment,privatePath);
      assert.equal(collaboratorAttempt.status,404,`a legitimate project editor cannot ${method} another actor's presentation evidence`);
      assert.doesNotMatch(await collaboratorAttempt.text(),/RESPONSIVE ASSESSMENT|PRIVATE_AUTHORED_SLIDE_/u);
    }
    const collaboratorRecovery=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${job.jobId}/recover`,{method:"POST",headers:teammateScope}),fixture.environment,`${job.jobId}/recover`);
    assert.equal(collaboratorRecovery.status,404,"a legitimate project editor cannot replay another actor's privately retained paid provider response");
    const collaboratorDiscovery=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/presentation-candidates?document=${encodeURIComponent(documentId)}`,{headers:teammateScope}),fixture.environment,"presentation-candidates");
    assert.equal(collaboratorDiscovery.status,200,JSON.stringify(await collaboratorDiscovery.clone().json()));
    assert.deepEqual((await collaboratorDiscovery.json()).jobs,[],"governed owner evidence cannot appear in a teammate's private discovery feed");
    assert.equal(providerCalls,1,"inspecting and preserving actor-private project evidence cannot initiate paid work");

    fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),contextId);
    const deniedReview=await requestSourceJob(`${job.jobId}/presentation-candidates/project-owner-privately-retained-response`);
    assert.ok([401,403,404].includes(deniedReview.status),"revoking the active project session immediately revokes draft review");
    assert.doesNotMatch(await deniedReview.text(),/RESPONSIVE ASSESSMENT|PRIVATE_AUTHORED_SLIDE_/u);
    fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(contextId);
    const originalPrepare=fixture.environment.DB.prepare.bind(fixture.environment.DB);
    const beforeInterruptedProjectArtifacts=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact' AND redacted_at IS NULL").get().count;
    const beforeInterruptedProjectInputs=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact-input' AND redacted_at IS NULL").get().count;
    let intercepted=false;
    fixture.environment.DB.prepare=(sql)=>{
      if(!intercepted&&sql.startsWith("INSERT INTO event_write_stage")&&sql.includes("project_context_sessions selection")){
        intercepted=true;
        fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),contextId);
      }
      return originalPrepare(sql);
    };
    try{
      const revoked=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
      assert.equal(intercepted,true,"the selected project session is revoked after recovery preparation but before its guarded commit");
      assert.equal(revoked.status,409);
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).count,0);
      assert.equal(fixture.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(job.jobId).status,"failed");
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact' AND redacted_at IS NULL").get().count,beforeInterruptedProjectArtifacts,"revoking a selected project session must not expose an uncommitted recovered slideshow");
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact-input' AND redacted_at IS NULL").get().count,beforeInterruptedProjectInputs,"revoking a selected project session must not retain a second readable generation receipt");
      assert.equal(providerCalls,1,"revocation never triggers another provider call");
    }finally{fixture.environment.DB.prepare=originalPrepare;}

    fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(contextId);
    const recoveredResponse=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
    assert.equal(recoveredResponse.status,200,JSON.stringify(await recoveredResponse.clone().json()));
    const recovered=(await recoveredResponse.json()).job;
    assert.equal(recovered.status,"completed");
    assert.equal(recovered.result.generationReceipt,undefined);
    assert.equal(providerCalls,1,"the original project-scoped provider response is replayed without further spend");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).count,1);
  }finally{globalThis.fetch=previousFetch;}
});

test("personal activity issue notes persist privately without leaking into events or ordinary content hydration",async()=>{
  const fixture=await reliabilityWorker();
  const now=new Date().toISOString(),expires=new Date(Date.now()+3_600_000).toISOString();
  const jobId="personal-private-activity-issue";
  fixture.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobId,"dev-local-creative","creative:dev-local-creative","doc-atmosphere","render_document","failed","activity",jobId,1,"{}","{}","source_fidelity_validation_failed",1,now,now,now,null,null,expires,now);
  const requestNotes=(init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/notes`,init),fixture.environment,`${jobId}/notes`);

  const empty=await requestNotes();assert.equal(empty.status,200,JSON.stringify(await empty.clone().json()));
  assert.deepEqual((await empty.json()).notes,[]);
  const wrongOrigin=await requestNotes(json({body:"cross-origin secret"},{origin:"https://attacker.example"}));
  assert.equal(wrongOrigin.status,403);
  const missing=await requestNotes(json({body:"   "}));assert.equal(missing.status,400);
  const oversized=await requestNotes(json({body:"a".repeat(2_001)}));assert.equal(oversized.status,400);

  const prose="PRIVATE ISSUE NOTE: verify the source-grounded quarterly figure before asking for help.";
  const saved=await requestNotes(json({body:`  ${prose}  `}));
  assert.equal(saved.status,201,JSON.stringify(await saved.clone().json()));
  assert.equal(saved.headers.get("cache-control"),"private, no-store");
  assert.equal((await saved.json()).note.body,prose);
  const note=fixture.sqlite.prepare("SELECT owner_id,kind,content,expires_at FROM private_content WHERE kind='activity-issue-note'").get();
  assert.equal(note.owner_id,"dev-local-creative");
  assert.equal(JSON.parse(note.content).body,prose);
  assert.ok(new Date(note.expires_at).getTime()>Date.now()+300*86_400_000,"private issue notes use governed evidence retention");
  const audit=fixture.sqlite.prepare("SELECT actor,payload,correlation_id FROM events WHERE type='ActivityIssueNoted'").get();
  assert.equal(audit.actor,"user:dev-local-creative");
  assert.equal(audit.correlation_id,jobId);
  assert.doesNotMatch(audit.payload,/PRIVATE ISSUE NOTE|quarterly figure/u);
  assert.doesNotMatch(JSON.stringify(await loadPrivateContent(fixture.environment,"dev-local-creative")),/PRIVATE ISSUE NOTE/u);

  const listed=await requestNotes();assert.equal(listed.status,200);
  assert.deepEqual((await listed.json()).notes.map(({body})=>body),[prose]);
  const stranger={"oai-authenticated-user-id":"private-note-stranger","oai-authenticated-user-email":"private-note-stranger@example.test"};
  assert.equal((await fixture.request("/api/session",{headers:stranger})).status,200);
  fixture.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","private-note-stranger");
  for(const init of [{headers:stranger},json({body:"unauthorized"},stranger)]){
    const denied=await requestNotes(init);assert.equal(denied.status,404);assert.doesNotMatch(await denied.text(),/PRIVATE ISSUE NOTE/u);
  }
  fixture.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run("2000-01-01T00:00:00.000Z",jobId);
  assert.equal((await requestNotes()).status,404,"expired issues cannot reopen previously retained private notes");
});

test("shared activity issue notes survive project synchronization and remain isolated from collaborators and revoked sessions",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);addQueueBlocker(fixture);
  const workspace=await fixture.request("/api/workspaces",json({name:"Activity issue-note isolation"}));
  assert.equal(workspace.status,201,JSON.stringify(await workspace.clone().json()));const organizationId=(await workspace.json()).organizationId;
  const registered=await fixture.request(`/api/workspaces/${organizationId}/projects`,json({projectId:"project-atmosphere"}));
  assert.equal(registered.status,201,JSON.stringify(await registered.clone().json()));const projectAccessId=(await registered.json()).projectAccessId;
  const opened=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST"});
  assert.equal(opened.status,200,JSON.stringify(await opened.clone().json()));const scoped={cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};
  const queued=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"private-activity-note"}},scoped));
  assert.equal(queued.status,202,JSON.stringify(await queued.clone().json()));const ownerJob=(await queued.json()).job;
  fixture.sqlite.prepare("UPDATE document_jobs SET status='failed',completed_at=?,updated_at=? WHERE job_id=?").run(new Date().toISOString(),new Date().toISOString(),ownerJob.jobId);
  const sourceNotes=(jobId,init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/notes`,init),fixture.environment,`${jobId}/notes`);
  const ownerProse="OWNER ONLY: evaluate the confidential quarterly source claim.";
  const ownerSaved=await sourceNotes(ownerJob.jobId,json({body:ownerProse},scoped));
  assert.equal(ownerSaved.status,201,JSON.stringify(await ownerSaved.clone().json()));
  const ownerEvent=fixture.sqlite.prepare("SELECT payload FROM events WHERE type='ActivityIssueNoted' AND correlation_id=?").get(ownerJob.jobId);
  assert.doesNotMatch(ownerEvent.payload,/OWNER ONLY|quarterly source/u);
  const ownerReference=JSON.parse(ownerEvent.payload).note_ref;
  const governed=fixture.sqlite.prepare("SELECT classification,actor_user_id FROM private_content_retention_scopes WHERE content_id=?").get(ownerReference);
  assert.equal(governed.classification,"governed-evidence");assert.equal(governed.actor_user_id,"dev-local-creative");
  const scope=fixture.sqlite.prepare("SELECT visibility,actor_user_id,owner_user_id FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ownerReference);
  assert.equal(scope.visibility,"actor_private");assert.equal(scope.actor_user_id,"dev-local-creative");

  const sharedHistory=await handleEvents(new Request("http://localhost/api/events?after=0&limit=2000&content=1",{headers:scoped}),fixture.environment);
  assert.equal(sharedHistory.status,200,JSON.stringify(await sharedHistory.clone().json()));
  assert.doesNotMatch(await sharedHistory.text(),/OWNER ONLY|quarterly source/u,"shared activity and hydration never reveal private note prose");
  const survived=await sourceNotes(ownerJob.jobId,{headers:scoped});
  assert.equal(survived.status,200,JSON.stringify(await survived.clone().json()));
  assert.equal((await survived.json()).notes[0].body,ownerProse,"actor-private notes survive project-manifest synchronization");
  const execution={organizationId,projectAccessId,projectId:"project-atmosphere",ownerUserId:"dev-local-creative",actorUserId:"dev-local-creative"};
  assert.doesNotMatch(JSON.stringify(await loadPrivateContent(fixture.environment,"dev-local-creative","all",execution)),/OWNER ONLY/u);

  const collaboratorHeaders={"oai-authenticated-user-id":"project-note-collaborator","oai-authenticated-user-email":"project-note-collaborator@example.test"};
  assert.equal((await fixture.request("/api/session",{headers:collaboratorHeaders})).status,200);
  fixture.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","project-note-collaborator");
  const invited=await fixture.request(`/api/workspaces/${organizationId}/members`,json({email:"project-note-collaborator@example.test",role:"member"}));
  assert.equal(invited.status,201,JSON.stringify(await invited.clone().json()));const invitation=await invited.json();
  const accepted=await fixture.request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,json({token:new URL(invitation.invitationUrl).searchParams.get("token")},collaboratorHeaders));
  assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
  const added=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/members`,json({userId:"project-note-collaborator",role:"editor"}));
  assert.equal(added.status,201,JSON.stringify(await added.clone().json()));
  const teammateOpened=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers:collaboratorHeaders});
  assert.equal(teammateOpened.status,200,JSON.stringify(await teammateOpened.clone().json()));
  const teammate={...collaboratorHeaders,cookie:teammateOpened.headers.get("set-cookie")?.split(";")[0]??""};
  for(const init of [{headers:teammate},json({body:"unauthorized collaborator note"},teammate)]){
    const denied=await sourceNotes(ownerJob.jobId,init);assert.equal(denied.status,404);assert.doesNotMatch(await denied.text(),/OWNER ONLY/u);
  }

  const contextId=fixture.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE principal_user_id=? AND project_access_id=? AND revoked_at IS NULL").get("dev-local-creative",projectAccessId).context_id;
  const originalPrepare=fixture.environment.DB.prepare.bind(fixture.environment.DB);let intercepted=false;
  fixture.environment.DB.prepare=(sql)=>{
    if(!intercepted&&sql.includes("FROM events event INDEXED BY idx_events_correlation")&&sql.includes("activity-issue-note")){
      intercepted=true;fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),contextId);
    }
    return originalPrepare(sql);
  };
  try{
    const revoked=await sourceNotes(ownerJob.jobId,{headers:scoped});
    assert.equal(intercepted,true,"the exact project session is revoked after admission but before private-note retrieval");
    assert.doesNotMatch(await revoked.text(),/OWNER ONLY|quarterly source/u);
  }finally{fixture.environment.DB.prepare=originalPrepare;}
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

test("shows stale project presentation recovery without exposing actor-private receipts and preserves truthful terminal inspection",async()=>{
  const fixture=await reliabilityWorker();await authoredOutline(fixture,12);
  const workspace=await fixture.request("/api/workspaces",json({name:"Project presentation recovery isolation"}));
  assert.equal(workspace.status,201,JSON.stringify(await workspace.clone().json()));
  const organizationId=(await workspace.json()).organizationId;
  const registered=await fixture.request(`/api/workspaces/${organizationId}/projects`,json({projectId:"project-atmosphere"}));
  assert.equal(registered.status,201,JSON.stringify(await registered.clone().json()));
  const projectAccessId=(await registered.json()).projectAccessId;
  const opened=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST"});
  assert.equal(opened.status,200,JSON.stringify(await opened.clone().json()));
  const scoped={cookie:opened.headers.get("set-cookie")?.split(";")[0]??""};
  const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"slides",productionMode:"manual",itemCount:12,requestKey:"scoped-presentation-stale-recovery"}},scoped));
  assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
  const {job}=await admission.json();
  const durable=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
  await stalePresentationAttempt(fixture,{...job,result:durable},{attemptCount:documentJobMaxAttempts("render_document")});

  for(const path of["/api/document-jobs",`/api/document-jobs/${job.jobId}`]){
    const response=await fixture.request(path,{headers:scoped});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const body=await response.json();const visible=path==="/api/document-jobs"?body.jobs.find((candidate)=>candidate.jobId===job.jobId):body.job;
    assert.equal(visible.stage,"recovering");
    assert.equal(visible.result.generationReceipt,undefined);
  }

  const execution=await fixture.runJob(job,scoped);const failed=(await execution.json()).job;
  assert.equal(failed.status,"failed");
  assert.equal(failed.errorDetail.code,"execution_interrupted");
  assert.equal(failed.result.generationReceipt,undefined);
  assert.doesNotMatch(generationFailureGuidance(failed.errorDetail,failed.error,failed).title,/provider connection/i);

  const inspected=await fixture.request(`/api/document-jobs/${job.jobId}/private-receipt`,{headers:scoped});
  assert.equal(inspected.status,200,JSON.stringify(await inspected.clone().json()));
  const receipt=(await inspected.json()).job.result.generationReceipt;
  assert.equal(receipt.provider_request_status,"not_submitted");
  assert.equal(receipt.source_transmission_status,"not_transmitted");
  assert.equal(receipt.settled_cost_microusd,0);
});
