import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";
import { documentArtifactValidationIssues, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { DOCUMENT_JOB_HEARTBEAT_MS, documentGenerationRevision, documentJobCanRecoverProviderRender, documentJobMaxAttempts, generationFailureGuidance } from "../src/model/document-jobs.ts";
import { claimCostBudgetReservation, loadPrivateContent, reconcileFailedBudgetReservations, reserveBudget, reserveCostBudget } from "../worker/pilot-policy.ts";
import { appendAuditEvent } from "../worker/runtime.ts";
import { isSceneCostPreview } from "../src/model/scene-cost-consent.ts";

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

/** Exercise the real free inspection and one approved durable request; no execution authority is mocked. */
async function approvedReliabilityScene(fixture,input){
  assert.equal(input.kind,"render_document");assert.equal(input.payload.artifactKind,"scene");assert.equal(input.payload.productionMode,"manual");
  const sceneRequestId="reliability-scene-"+crypto.randomUUID();
  const counts=()=>Object.fromEntries(["document_jobs","budget_reservations","cost_budget_reservations"].map(table=>[table,fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM "+table).get().count]));
  const before=counts();
  const inspection=await fixture.request("/api/document-jobs",json({...input,payload:{...input.payload,sceneRequestId,sceneCostPreview:true}}));
  assert.equal(inspection.status,200,await inspection.clone().text());
  const inspected=await inspection.json(),preview=inspected.sceneCostPreview;
  assert.ok(isSceneCostPreview(preview));assert.equal(preview.requestId,sceneRequestId);assert.equal(preview.documentId,input.documentId);
  assert.equal(preview.model,fixture.environment.OPENAI_MODEL);assert.equal(preview.productionMode,input.payload.productionMode);
  assert.equal(preview.providerCallCount,1);assert.equal(preview.maximumProviderCallCount,2);assert.equal(preview.maximumMicrousd,1_000_000);
  assert.equal(inspected.providerCalls,0);assert.equal(inspected.reservations,0);assert.deepEqual(counts(),before);
  const accepted=await fixture.request("/api/document-jobs",json({...input,payload:{...input.payload,sceneRequestId,sceneCostConsent:{...preview,confirmed:true}}}));
  assert.equal(accepted.status,202,await accepted.clone().text());
  const {job}=await accepted.clone().json();assert.equal(job.jobId,sceneRequestId);
  const original=JSON.parse(fixture.sqlite.prepare("SELECT request_json FROM document_jobs WHERE job_id=?").get(job.jobId).request_json);
  assert.deepEqual(original.sceneCostConsent,{...preview,confirmed:true});
  assert.equal(job.result.generationReceipt.maximum_authorized_cost_microusd,preview.maximumMicrousd);
  assert.equal(job.result.generationReceipt.maximum_provider_call_count,preview.maximumProviderCallCount);
  return accepted;
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
  output.items[1].notes+=`\n“${INDEPENDENT_SLIDE_QUOTE}” — Product Owner`;
  output.content_markdown+=`\n\n“${INDEPENDENT_SLIDE_QUOTE}” — Product Owner`;
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

test("both audio admission routes reject invalid raw aliases and immutable input before provider contact",async()=>{
  const fixture=await reliabilityWorker();fixture.environment.FAL_KEY="test-existing-fal-key";
  await fixture.drainBackground();
  const previousFetch=globalThis.fetch,contacts=[];
  globalThis.fetch=async(...args)=>{contacts.push(args);throw new Error("Provider must not be contacted");};
  try{
    for(const [audioProfile,code] of [
      [123,"audio_profile_invalid"],
      [{goal:123},"audio_goal_unsupported"],
      [{audioGoal:false},"audio_goal_unsupported"],
      [{role:["voice"]},"audio_role_unsupported"],
      [{audioGoal:"unknown"},"audio_goal_unsupported"],
      [{goal:"sound_effects",duration_seconds:1.5},"audio_duration_invalid"],
      [{goal:"narration",speaker_count:1.5},"audio_speaker_count_invalid"],
      [{goal:"narration",transcript:"界".repeat(2_400)},"audio_input_budget_exceeded"],
    ]){
      const payload={artifactKind:"audio",productionMode:"manual",itemCount:1,paidMediaConfirmed:true,audioProfile};
      const queued=await handleDocumentJobs(new Request("http://localhost/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload})),fixture.environment);
      assert.equal(queued.status,422,JSON.stringify(await queued.clone().json()));
      assert.equal((await queued.json()).error,code);
      const direct=await handleEvents(new Request("http://localhost/api/events",json({...payload,action:"render_document",documentId:"doc-atmosphere",sourceSurface:"document"})),fixture.environment);
      assert.equal(direct.status,422,JSON.stringify(await direct.clone().json()));
      assert.equal((await direct.json()).error,code);
    }
    assert.equal(contacts.length,0);
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockCreated",{
      project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"required-voice-direction",type:"direction",handle:"direction/voice",position:"z-audio-required",
      properties:{text:"a".repeat(4_001),required:true,weight:1,authority:"authored"},
    });
    const payload={artifactKind:"audio",productionMode:"manual",itemCount:1,paidMediaConfirmed:true,audioProfile:{goal:"narration"}};
    const direct=await handleEvents(new Request("http://localhost/api/events",json({...payload,action:"render_document",documentId:"doc-atmosphere",sourceSurface:"document"})),fixture.environment);
    assert.equal(direct.status,422,JSON.stringify(await direct.clone().json()));
    assert.equal((await direct.json()).error,"audio_style_instructions_too_long");
    const queued=await handleDocumentJobs(new Request("http://localhost/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload})),fixture.environment);
    assert.equal(queued.status,422,JSON.stringify(await queued.clone().json()));
    assert.equal((await queued.json()).error,"audio_style_instructions_too_long");
    assert.equal(contacts.length,0);
  }finally{globalThis.fetch=previousFetch;}
});

for(const narration of [false,true]){
test(`paid ${narration?"historical narration":"music"} recovery reuses its plan and provider request with zero additional settlement`,async()=>{
  const fixture=await reliabilityWorker();fixture.environment.FAL_KEY="test-existing-fal-key";
  const previousFetch=globalThis.fetch,calls=[],stored=[];
  const providerModel=narration?"fal-ai/gemini-3.1-flash-tts":"fal-ai/lyria3/pro";
  const providerCost=narration?125_000:80_000, expectedCost=62_042+providerCost;
  let failDownload=true;
  fixture.environment.MEDIA.put=async(key,bytes,options)=>{stored.push({key,bytes,options});};
  const plan={title:"Original retained score",summary:"An original instrumental piano and cello composition.",content_markdown:"Create an original instrumental score moving from restraint to quiet resolution.",presentation:null,items:[{title:"Complete arrangement",body:"Original felt piano and soft cello develop a restrained resolving motif.",notes:"No voices or artist imitation.",image_prompt:"",slide:null,context_group_ids:[]}]};
  if(narration){plan.content_markdown="a".repeat(2_499)+"🎵";plan.items[0].notes="Original clear narration.";}
  globalThis.fetch=async(value,init={})=>{
    const url=String(value),method=init.method??"GET";calls.push({url,method});
    if(url==="https://api.openai.com/v1/moderations")return Response.json({id:"audio-recovery-moderation",results:[{flagged:false,categories:{}}]});
    if(url==="https://api.openai.com/v1/responses")return Response.json({id:"paid-audio-plan",model:"gpt-5.6-terra",output_text:JSON.stringify(plan),usage:{input_tokens:8101,output_tokens:3820,total_tokens:11921}});
    if(url===`https://queue.fal.run/${providerModel}`&&method==="POST")return Response.json({request_id:"paid-audio-edge-result"});
    if(url.endsWith("/paid-audio-edge-result/status?logs=1"))return Response.json({status:"COMPLETED"});
    if(url.endsWith("/paid-audio-edge-result"))return Response.json({audio:{url:"https://fal.media/paid-audio-edge.mp3",content_type:"audio/mpeg",file_size:3}});
    if(url==="https://fal.media/paid-audio-edge.mp3"){
      assert.equal(init.redirect,"manual");assert.equal(init.headers,undefined);
      if(failDownload)throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
      return new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}});
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  try{
    await fixture.drainBackground();
    const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"audio",productionMode:"manual",itemCount:1,paidMediaConfirmed:true,...(narration?{audioProfile:{goal:"narration"}}:{}),requestKey:"paid-audio-edge-recovery"}}));
    assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
    const {job}=await admission.json();
    const failed=(await(await fixture.runJob(job)).json()).job;
    assert.equal(failed.status,"failed");assert.equal(failed.errorDetail.code,"provider_network_failed");
    assert.equal(failed.result.generationReceipt.settled_cost_microusd,expectedCost);
    const original=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
    assert.equal(original.providerJobId,"paid-audio-edge-result");
    assert.ok(original.artifactPlan);assert.equal(original.audioInputReceipt.model,providerModel);
    if(narration){
      // Simulate a paid pre-upgrade receipt: the same 2,500 billable characters
      // exceed today's UTF-8 policy, and the saved quote predates the new capacity.
      original.artifactPlan.content_markdown="界".repeat(2_499)+"🎵";
      original.audioInputReceipt.submitted_prompt=original.artifactPlan.content_markdown;
      original.audioInputReceipt.parameters.provider_parameters.style_instructions="x".repeat(4_100);
      original.audioInputReceipt.parameters.published_cost_microusd=250_000;
      original.audioEstimatedCostMicrousd=250_000;
      fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(original),job.jobId);
    }
    const originalCostId=original.costReservationId;
    assert.deepEqual({...fixture.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(originalCostId)},{status:"settled",used_microusd:expectedCost});
    const originalPosts=calls.filter(call=>call.method==="POST"&&call.url!=="https://api.openai.com/v1/moderations").length;
    assert.equal(originalPosts,2);

    const retry=await fixture.request(`/api/document-jobs/${job.jobId}/retry`,{method:"POST"});
    assert.equal(retry.status,202,JSON.stringify(await retry.clone().json()));
    const resumed=(await retry.json()).job;assert.equal(resumed.jobId,job.jobId);
    const recovery=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
    assert.equal(recovery.providerJobId,"paid-audio-edge-result");
    assert.equal(recovery.prepaidProviderCostMicrousd,providerCost);
    failDownload=false;
    const completed=(await(await fixture.runJob(resumed)).json()).job;
    assert.equal(completed.status,"completed",JSON.stringify(completed.errorDetail));
    assert.equal(completed.result.generationReceipt.settled_cost_microusd,0);
    assert.equal(calls.filter(call=>call.method==="POST"&&call.url!=="https://api.openai.com/v1/moderations").length,originalPosts);
    assert.equal(stored.length,1);
    const artifacts=fixture.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted'").all();
    assert.equal(artifacts.length,1);
    const artifact=JSON.parse(artifacts[0].payload);assert.equal(artifact.artifact_kind,"audio");assert.ok(artifact._private_ref);
    const privateArtifact=fixture.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=? AND redacted_at IS NULL").get(artifact._private_ref,"dev-local-creative");
    assert.ok(privateArtifact);
    assert.equal(JSON.parse(privateArtifact.private_json).media_url,`/api/media/${encodeURIComponent(stored[0].key)}`);
    assert.equal(artifact.media_url,undefined);
    assert.equal(stored[0].options.customMetadata.providerJobId,"paid-audio-edge-result");
    assert.equal(stored[0].options.httpMetadata.contentType,"audio/mpeg");
    assert.deepEqual({...fixture.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(originalCostId)},{status:"settled",used_microusd:expectedCost});
    assert.equal(fixture.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM cost_budget_reservations").get().cost,expectedCost);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN ('active','executing')").get().count,0);
    await fixture.runJob(resumed);
    assert.equal(calls.filter(call=>call.method==="POST"&&call.url!=="https://api.openai.com/v1/moderations").length,originalPosts);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted'").get().count,1);
  }finally{globalThis.fetch=previousFetch;}
});
}

async function originalSourceAudioFixture({shared=false,muted=false,repair=false,legacyPlannerScalar=repair}={}){
  const fixture=await reliabilityWorker();fixture.environment.FAL_KEY="existing-audio-recovery-test-key";
  await fixture.drainBackground();
  await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","PreferenceAuthored",{preference_id:"original-audio-preference",axis:"style",value:"Original restrained material texture",polarity:"affirm"});
  if(muted)await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:"inactive-original-audio-source",type:"direction",handle:"direction/inactive",position:"z-inactive",properties:{text:"Inactive at the original purchase",weight:0,active:false,authority:"authored"}});
  let scopedHeaders={},organizationId=null,projectAccessId=null,contextId=null;
  if(shared){
    const workspace=await fixture.request("/api/workspaces",json({name:"Original audio recovery workspace"}));assert.equal(workspace.status,201);organizationId=(await workspace.json()).organizationId;
    const project=await fixture.request(`/api/workspaces/${organizationId}/projects`,json({projectId:"project-atmosphere"}));assert.equal(project.status,201);projectAccessId=(await project.json()).projectAccessId;
    const opened=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST"});assert.equal(opened.status,200);
    scopedHeaders={cookie:opened.headers.get("set-cookie").split(";")[0]};
    contextId=fixture.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE project_access_id=? AND principal_user_id='dev-local-creative' AND revoked_at IS NULL").get(projectAccessId).context_id;
  }
  const jobRequest=(path,init={})=>fixture.request(path,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),...scopedHeaders}});
  const runJob=async job=>{const response=await jobRequest(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response;};
  const calls=[],stored=[],deleted=[],previousFetch=globalThis.fetch;
  let failDownload=true,afterDownload=null,plannerCalls=0;
  const plan={title:"The original paid score",summary:"A restrained original instrumental composition.",content_markdown:"An original piano and cello score resolves into quiet clarity.",presentation:null,items:[{title:"Original arrangement",body:"Original felt piano and soft cello develop a resolving motif.",notes:"No voices or artist imitation.",image_prompt:"",slide:null,context_group_ids:[]}]};
  fixture.environment.MEDIA.put=async(key,bytes,options)=>stored.push({key,bytes,options});
  fixture.environment.MEDIA.delete=async key=>deleted.push(key);
  globalThis.fetch=async(value,init={})=>{
    const url=String(value),method=init.method??"GET";calls.push({url,method});
    if(url==="https://api.openai.com/v1/moderations")return Response.json({id:"original-source-moderation",results:[{flagged:false,categories:{}}]});
    if(url==="https://api.openai.com/v1/responses"){
      plannerCalls+=1;
      if(repair&&plannerCalls===1)return Response.json({id:"original-source-initial-plan",model:"gpt-5.6-terra",output_text:JSON.stringify({...plan,items:plan.items.map(item=>({...item,context_group_ids:["not-an-authorized-context-alias"]}))}),usage:{input_tokens:4000,output_tokens:1800,total_tokens:5800}});
      return Response.json({id:"original-source-paid-plan",model:"gpt-5.6-terra",output_text:JSON.stringify(plan),usage:repair?{input_tokens:4101,output_tokens:2020,total_tokens:6121}:{input_tokens:8101,output_tokens:3820,total_tokens:11921}});
    }
    if(url==="https://queue.fal.run/fal-ai/lyria3/pro"&&method==="POST")return Response.json({request_id:"original-source-paid-audio"});
    if(url.endsWith("/original-source-paid-audio/status?logs=1"))return Response.json({request_id:"original-source-paid-audio",status:"COMPLETED"});
    if(url.endsWith("/original-source-paid-audio"))return Response.json({request_id:"original-source-paid-audio",audio:{url:"https://fal.media/original-source-score.mp3",content_type:"audio/mpeg",file_size:3}});
    if(url==="https://fal.media/original-source-score.mp3"){
      if(failDownload)throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
      if(afterDownload)await afterDownload();
      return new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}});
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  try{
    const admitted=await jobRequest("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"audio",productionMode:"manual",itemCount:1,paidMediaConfirmed:true,requestKey:"original-source-audio-recovery"}}));
    assert.equal(admitted.status,202,JSON.stringify(await admitted.clone().json()));
    const {job}=await admitted.json();
    const failed=(await(await runJob(job)).json()).job;
    assert.equal(failed.errorDetail.code,"provider_network_failed");
    const originalRow=fixture.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(job.jobId);
    const original=JSON.parse(originalRow.result_json),request=JSON.parse(originalRow.request_json);
    const observedPlannerResponseId=original.plannerResponseId;
    if(repair&&legacyPlannerScalar){
      // Reproduce the released v158 first-ID checkpoint, retaining both real
      // mocked response receipts and the immutable final-ID usage unchanged.
      original.plannerResponseId=original.plannerInput.validation.provider_response_ids[0];
      fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(original),job.jobId);
    }
    const originalInput=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(original.generationReceipt.input_ref).content);
    const originalCostId=original.costReservationId;
    const firstFact=originalInput.document_snapshot.facts.find(fact=>fact.type==="direction");assert.ok(firstFact);
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:firstFact.block_id,property_path:"text",new_value:"A newer creative direction must remain intact after recovering the original paid recording."});
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","DocumentRenamed",{project_id:"project-atmosphere",document_id:"doc-atmosphere",new_title:"New title after the original audio purchase"});
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","PreferenceRevoked",{preference_id:"original-audio-preference"});
    await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","PreferenceAuthored",{preference_id:"new-audio-preference",axis:"style",value:"A later preference is not the recording source",polarity:"affirm"});
    const retry=await jobRequest(`/api/document-jobs/${job.jobId}/retry`,{method:"POST"});
    assert.equal(retry.status,202,JSON.stringify(await retry.clone().json()));
    const changed=(await(await runJob((await retry.json()).job)).json()).job;
    assert.equal(changed.errorDetail.code,"context_source_version_mismatch",JSON.stringify(changed));
    assert.equal(documentJobCanRecoverProviderRender(changed),!shared,"native eligibility still requires the actual confirmed provider identity, not a derived flag");
    const listed=(await(await jobRequest("/api/document-jobs")).json()).jobs.find(candidate=>candidate.jobId===job.jobId);assert.ok(listed);
    assert.equal(documentJobCanRecoverProviderRender(listed),!shared,"the Activity listing retains the same confirmed-provider eligibility");
    assert.equal(generationFailureGuidance(listed.errorDetail,listed.error??"",listed).retryAllowed,!shared,"Activity's second guidance gate must agree with the confirmed provider eligibility");
    assert.equal(calls.filter(call=>call.method==="POST"&&call.url!=="https://api.openai.com/v1/moderations").length,repair?3:2);
    failDownload=false;
    return {...fixture,request:jobRequest,runJob,unscopedRequest:fixture.request,organizationId,projectAccessId,contextId,job,original,originalInput,originalCostId,originalRequest:request,observedPlannerResponseId,calls,stored,deleted,firstFact,restore:()=>{globalThis.fetch=previousFetch;},afterDownload:callback=>{afterDownload=callback;}};
  }catch(error){globalThis.fetch=previousFetch;throw error;}
}

test("original-source audio recovery proves the legacy receipt, preserves newer edits, and adds no charge",async()=>{
  const fixture=await originalSourceAudioFixture();
  try{
    const reservations=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all();
    const tokenReservations=fixture.sqlite.prepare("SELECT * FROM budget_reservations ORDER BY reservation_id").all();
    const authored=fixture.sqlite.prepare("SELECT * FROM events WHERE actor='user' ORDER BY sequence").all();
    const previousCount=fixture.calls.length;
    const recovered=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});
    assert.equal(recovered.status,200,JSON.stringify(await recovered.clone().json()));
    const result=await recovered.json();assert.equal(result.job.status,"completed");assert.equal(result.recoveredOriginalSource,true);
    assert.equal(result.job.result.generationReceipt.settled_cost_microusd,142_042);
    assert.equal(result.job.result.generationReceipt.incremental_cost_microusd,0);
    assert.equal(result.job.result.recovery.original_source_revision,fixture.originalRequest.documentRevision);
    assert.equal(result.job.result.recovery.original_source_snapshot_sha256,fixture.original.generationReceipt.source_snapshot_sha256);
    assert.equal(fixture.calls.length-previousCount,3);
    assert.ok(fixture.calls.slice(previousCount).every(call=>call.method==="GET"));
    assert.equal(fixture.calls.filter(call=>call.method==="POST"&&call.url!=="https://api.openai.com/v1/moderations").length,2);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),reservations);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM budget_reservations ORDER BY reservation_id").all(),tokenReservations);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM events WHERE actor='user' ORDER BY sequence").all(),authored);
    const completed=fixture.sqlite.prepare("SELECT event.payload,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.type='DocumentRenderCompleted'").all();
    assert.equal(completed.length,1);
    const artifact=JSON.parse(completed[0].private_json),publicArtifact=JSON.parse(completed[0].payload);
    assert.equal(publicArtifact.media_url,undefined);assert.equal(artifact.provider_job_id,"original-source-paid-audio");
    assert.deepEqual(artifact.source_block_versions,fixture.originalInput.source_block_versions);
    assert.equal(artifact.settings.settled_cost_microusd,142_042);assert.equal(artifact.settings.incremental_cost_microusd,0);
    assert.equal(fixture.stored.length,1);assert.equal(fixture.deleted.length,0);
    assert.ok(fixture.stored[0].key.includes(`${fixture.original.artifactId}-recovery-`));
    assert.equal(fixture.stored[0].options.customMetadata.artifactId,fixture.original.artifactId);
    const input=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(artifact.input_ref).content);
    assert.deepEqual(input.original_document_snapshot,fixture.originalInput.document_snapshot);
    assert.deepEqual(input.source_block_versions,fixture.originalInput.source_block_versions);
    assert.notEqual(input.document_snapshot.document.title,"New title after the original audio purchase");
    assert.deepEqual(input.document_snapshot.standing_constraints.map(preference=>preference.preference_id),["original-audio-preference"]);
    assert.equal(input.accounting.settled_cost_microusd,142_042);assert.equal(input.accounting.incremental_cost_microusd,0);
    const finalCalls=fixture.calls.length;
    const repeated=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(repeated.status,200);
    await fixture.runJob(fixture.job);
    assert.equal(fixture.calls.length,finalCalls);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted'").get().count,1);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),reservations);
  }finally{fixture.restore();}
});

test("original-source audio recovery verifies the final repaired planner against both paid receipts",async()=>{
  const fixture=await originalSourceAudioFixture({repair:true});
  try{
    assert.equal(fixture.original.plannerResponseId,"original-source-initial-plan");
    assert.deepEqual(fixture.original.plannerInput.validation.provider_response_ids,["original-source-initial-plan","original-source-paid-plan"]);
    assert.equal(fixture.original.plannerInput.validation.repair_response_id,"original-source-paid-plan");
    const usage=JSON.parse(fixture.sqlite.prepare("SELECT secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.type='GenerationUsageRecorded' AND event.correlation_id=?").get(`${fixture.job.jobId}:attempt:1`).private_json);
    assert.equal(usage.planner_response_id,"original-source-paid-plan");assert.equal(usage.cost_microusd,142_042);
    const before=fixture.calls.length,reservations=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all();
    const response=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).job.result.plannerResponseId,"original-source-paid-plan");
    assert.equal(fixture.calls.length-before,3);assert.ok(fixture.calls.slice(before).every(call=>call.method==="GET"));
    assert.equal(fixture.calls.filter(call=>call.method==="POST"&&call.url!=="https://api.openai.com/v1/moderations").length,3);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),reservations);
    const completed=JSON.parse(fixture.sqlite.prepare("SELECT secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.type='DocumentRenderCompleted'").get().private_json);
    assert.equal(completed.planner_response_id,"original-source-paid-plan");
    const saved=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(completed.input_ref).content);
    assert.equal(saved.planner.response_id,"original-source-paid-plan");assert.equal(saved.planner.legacy_checkpoint_response_id,"original-source-initial-plan");
    assert.equal(saved.accounting.incremental_cost_microusd,0);
  }finally{fixture.restore();}
});

test("original-source audio recovery retains the selected repaired planner through later progress and retry",async()=>{
  const fixture=await originalSourceAudioFixture({repair:true,legacyPlannerScalar:false});
  try{
    assert.equal(fixture.observedPlannerResponseId,"original-source-paid-plan");
    const current=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).result_json);
    assert.equal(current.plannerResponseId,"original-source-paid-plan");
    assert.deepEqual(current.plannerResponseIds,["original-source-initial-plan","original-source-paid-plan"]);
    const before=fixture.calls.length,response=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).job.result.plannerResponseId,"original-source-paid-plan");
    assert.equal(fixture.calls.length-before,3);assert.ok(fixture.calls.slice(before).every(call=>call.method==="GET"));
  }finally{fixture.restore();}
});

test("original-source audio recovery reports a provider retrieval refusal without logging its private body",async()=>{
  const fixture=await originalSourceAudioFixture(),previousFetch=globalThis.fetch,previousError=console.error,logged=[];
  try{
    const reservations=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all();
    globalThis.fetch=async(value,init)=>String(value).endsWith("/original-source-paid-audio/status?logs=1")?Response.json({detail:"private-provider-body-never-log"},{status:404}):previousFetch(value,init);
    console.error=(...args)=>logged.push(args);
    const response=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});
    assert.equal(response.status,409);
    const diagnostic=logged.find(args=>args[0]==="audio_original_source_recovery_unavailable")?.[1];assert.ok(diagnostic);
    assert.equal(diagnostic.phase,"retrieving-original-recording");assert.equal(diagnostic.providerHttpStatus,404);
    assert.equal(JSON.stringify(logged).includes("private-provider-body-never-log"),false);
    assert.equal(JSON.stringify(logged).includes(fixture.original.audioInputReceipt.submitted_prompt),false);
    assert.equal(fixture.stored.length,0);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),reservations);
  }finally{console.error=previousError;fixture.restore();}
});

test("original-source audio recovery guidance never substitutes a hint for confirmed provider identity",()=>{
  const detail={code:"context_source_version_mismatch",category:"provider",scope:"request",action:"edit_request",message:"Source changed",retryable:false,retryAfterMs:null,requestId:null,httpStatus:409};
  const base={kind:"render_document",status:"failed",stage:"failed",result:{artifactKind:"audio",audioProviderSubmission:"confirmed",providerJobId:"original-audio-id"},errorDetail:detail};
  assert.equal(generationFailureGuidance(detail,"",base).retryAllowed,true);
  assert.match(generationFailureGuidance(detail,"",base).summary,/original source/);
  for(const patch of [{providerJobId:null,originalSourceAudioRecoveryAvailable:true},{providerJobId:"pending"},{audioProviderSubmission:"pending"}]){
    const job={...base,result:{...base.result,...patch}};
    assert.equal(documentJobCanRecoverProviderRender(job),false);assert.equal(generationFailureGuidance(detail,"",job).retryAllowed,false);
  }
  const safety={...detail,category:"safety",httpStatus:422};
  assert.equal(documentJobCanRecoverProviderRender({...base,errorDetail:safety}),false);
  assert.equal(generationFailureGuidance(safety,"",base).retryAllowed,false);
});

const mutateAudioCheckpoint=(fixture,change)=>{
  const checkpoint=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).result_json);change(checkpoint);
  fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),fixture.job.jobId);
};
const mutateAudioInput=(fixture,change)=>{
  const id=fixture.original.generationReceipt.input_ref,input=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(id).content);change(input);
  fixture.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(input),id);
};
const mutateAudioPrivateEvent=(fixture,type,change)=>{
  const event=fixture.sqlite.prepare("SELECT event.event_id,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.type=? AND event.correlation_id=?").get(type,`${fixture.job.jobId}:attempt:1`);
  const payload=JSON.parse(event.private_json);change(payload);
  fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(payload),event.event_id);
};
const repairedAudioFailures=[
  ["unmarked repair",result=>{result.plannerInput.validation.repair_attempted=false;}],
  ["unrelated scalar",result=>{result.plannerResponseId="foreign-initial-response";}],
  ["unrelated final receipt",result=>{result.plannerInput.validation.repair_response_id="foreign-final-response";}],
  ["reordered attempts",result=>{result.plannerResponseIds.reverse();}],
  ["missing attempt",result=>{result.plannerInput.validation.provider_response_ids.pop();}],
  ["missing original issue",result=>{result.plannerInput.validation.initial_issues=[];}],
  ["failed repair",result=>{result.plannerInput.validation.repair_issues=[{code:"still-invalid"}];}],
  ["unconfirmed planning",result=>{Object.values(result.providerSubmissions)[1].status="accepted";}],
  ["missing planning receipt",result=>{delete result.providerSubmissions[Object.keys(result.providerSubmissions)[1]];}],
  ["wrong planning model",result=>{Object.values(result.providerSubmissions)[1].model="gpt-foreign-model";}],
  ["wrong planning provider",result=>{Object.values(result.providerSubmissions)[1].provider="fal";}],
  ["missing recorded cost",result=>{delete Object.values(result.providerSubmissions)[1].costMicrousd;}],
  ["wrong recorded cost",result=>{Object.values(result.providerSubmissions)[1].costMicrousd+=1;}],
  ["wrong token accounting",result=>{Object.values(result.providerSubmissions)[1].inputTokens+=1;}],
  ["wrong checkpoint aggregate",result=>{result.plannerUsage.inputTokens+=1;}],
];
for(const[label,mutate]of repairedAudioFailures)test(`original-source audio recovery rejects repaired-plan ${label} before provider access`,async()=>{
  const fixture=await originalSourceAudioFixture({repair:true});
  try{
    mutateAudioCheckpoint(fixture,mutate);
    const before=fixture.calls.length,reservations=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all();
    const response=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});
    assert.equal(response.status,409,JSON.stringify(await response.clone().json()));
    assert.equal(fixture.calls.length,before);assert.equal(fixture.stored.length,0);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),reservations);
  }finally{fixture.restore();}
});
const audioRecoveryFailures=[
  ["missing provider identity",fixture=>mutateAudioCheckpoint(fixture,result=>{delete result.providerJobId;})],
  ["contradictory receipt identity",fixture=>mutateAudioCheckpoint(fixture,result=>{result.audioInputReceipt.provider_job_id="another-request";})],
  ["contradictory receipt model",fixture=>mutateAudioCheckpoint(fixture,result=>{result.audioInputReceipt.model="fal-ai/stable-audio";})],
  ["foreign same-host queue path",fixture=>mutateAudioCheckpoint(fixture,result=>{result.providerStatusUrl="https://queue.fal.run/fal-ai/lyria3/requests/foreign/status";})],
  ["unconfirmed paid submission",fixture=>mutateAudioCheckpoint(fixture,result=>{result.audioProviderSubmission="pending";})],
  ["missing paid plan",fixture=>mutateAudioCheckpoint(fixture,result=>{delete result.artifactPlan;})],
  ["source hash mismatch",fixture=>mutateAudioCheckpoint(fixture,result=>{result.generationReceipt.source_snapshot_sha256="a".repeat(64);})],
  ["private source contents changed",fixture=>mutateAudioInput(fixture,input=>{input.document_snapshot.facts[0].properties.text="Tampered historical source";})],
  ["private source versions changed",fixture=>mutateAudioInput(fixture,input=>{input.source_block_versions[0].version+=1;})],
  ["private source wrong job",fixture=>mutateAudioInput(fixture,input=>{input.job_id="foreign-job";})],
  ["private source wrong document",fixture=>mutateAudioInput(fixture,input=>{input.document_id="foreign-document";})],
  ["private source expired",fixture=>fixture.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z",fixture.original.generationReceipt.input_ref)],
  ["private source redacted",fixture=>fixture.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),fixture.original.generationReceipt.input_ref)],
  ["private source foreign owner",fixture=>fixture.sqlite.prepare("UPDATE private_content SET owner_id=? WHERE content_id=?").run("foreign-owner",fixture.original.generationReceipt.input_ref)],
  ["job retention expired",fixture=>fixture.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run("2000-01-01T00:00:00.000Z",fixture.job.jobId)],
  ["foreign job owner",fixture=>fixture.sqlite.prepare("UPDATE document_jobs SET owner_id=? WHERE job_id=?").run("foreign-owner",fixture.job.jobId)],
  ["original usage provider changed",fixture=>mutateAudioPrivateEvent(fixture,"GenerationUsageRecorded",payload=>{payload.provider_job_id="foreign-provider";})],
  ["original request consent missing",fixture=>mutateAudioPrivateEvent(fixture,"DocumentRenderRequested",payload=>{payload.paid_media_confirmed=false;})],
  ["original request project changed",fixture=>mutateAudioPrivateEvent(fixture,"DocumentRenderRequested",payload=>{payload.project_id="foreign-project";})],
  ["original request versions changed",fixture=>mutateAudioPrivateEvent(fixture,"DocumentRenderRequested",payload=>{payload.source_block_versions[0].version+=1;})],
  ["original paid event envelope redacted",fixture=>fixture.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id IN(SELECT event_id FROM events WHERE type='GenerationUsageRecorded' AND correlation_id=?)").run(new Date().toISOString(),`${fixture.job.jobId}:attempt:1`)],
  ["original paid event envelope foreign owner",fixture=>fixture.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign-owner' WHERE private_event_id IN(SELECT event_id FROM events WHERE type='DocumentRenderFailed' AND correlation_id=?)").run(`${fixture.job.jobId}:attempt:1`)],
  ["original authored source envelope redacted",fixture=>fixture.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),fixture.firstFact.source_event_refs[0])],
  ["original charge missing",fixture=>fixture.sqlite.prepare("DELETE FROM cost_budget_reservations WHERE reservation_id=?").run(fixture.originalCostId)],
  ["original charge not settled",fixture=>fixture.sqlite.prepare("UPDATE cost_budget_reservations SET status='released' WHERE reservation_id=?").run(fixture.originalCostId)],
  ["original charge undercovered",fixture=>fixture.sqlite.prepare("UPDATE cost_budget_reservations SET used_microusd=1 WHERE reservation_id=?").run(fixture.originalCostId)],
  ["original charge foreign owner",fixture=>fixture.sqlite.prepare("UPDATE cost_budget_reservations SET owner_id='foreign-owner' WHERE reservation_id=?").run(fixture.originalCostId)],
  ["original charge foreign correlation",fixture=>fixture.sqlite.prepare("UPDATE cost_budget_reservations SET correlation_id='foreign-job:attempt:1' WHERE reservation_id=?").run(fixture.originalCostId)],
  ["current source removed",fixture=>appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockRemoved",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:fixture.firstFact.block_id})],
  ["current source disabled",fixture=>appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:fixture.firstFact.block_id,property_path:"active",new_value:false})],
  ["current source rights revoked",fixture=>appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:fixture.firstFact.block_id,property_path:"rights_revoked",new_value:true})],
  ["current source license expired",fixture=>appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:fixture.firstFact.block_id,property_path:"rights_expires_at",new_value:"2000-01-01T00:00:00.000Z"})],
];
for(const[label,mutate]of audioRecoveryFailures)test(`original-source audio recovery rejects ${label} before provider access`,async()=>{
  const fixture=await originalSourceAudioFixture();
  try{
    await mutate(fixture);
    const calls=fixture.calls.length,reservations=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all();
    const rejected=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({skipValidation:true,providerVerified:true,recoverOriginalSource:true})});
    assert.ok((label==="job retention expired"?[404,409,428]:[404,409]).includes(rejected.status),JSON.stringify(await rejected.clone().json()));
    assert.equal(fixture.calls.length,calls,"invalid evidence must not reach even a provider GET");
    assert.equal(fixture.stored.length,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted'").get().count,0);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),reservations);
  }finally{fixture.restore();}
});

for(const damage of ["provider_mismatch","redacted_envelope","malformed_envelope"])test(`original-source audio recovery diagnoses ${damage} without exposing private evidence or permitting recovery`,async()=>{
  const fixture=await originalSourceAudioFixture(),logged=[],previousError=console.error;
  try{
    if(damage==="provider_mismatch")mutateAudioPrivateEvent(fixture,"GenerationUsageRecorded",payload=>{payload.provider_job_id="private-mismatched-provider-never-log";});
    else if(damage==="redacted_envelope")fixture.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id IN(SELECT event_id FROM events WHERE type='GenerationUsageRecorded' AND correlation_id=?)").run(new Date().toISOString(),`${fixture.job.jobId}:attempt:1`);
    else fixture.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id IN(SELECT event_id FROM events WHERE type='GenerationUsageRecorded' AND correlation_id=?)").run("{malformed-private-evidence",`${fixture.job.jobId}:attempt:1`);
    const beforeCalls=fixture.calls.length,beforeReservations=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all();
    console.error=(...args)=>logged.push(args);
    const response=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});
    assert.equal(response.status,409);assert.equal((await response.json()).reason,"original_paid_event_chain_missing");
    const diagnostic=logged.find(args=>args[0]==="audio_original_source_recovery_chain_diagnostic")?.[1];assert.ok(diagnostic);
    assert.equal(diagnostic.counts.find(row=>row.type==="GenerationUsageRecorded").event_count,1);
    const usage=diagnostic.candidates.find(row=>row.type==="GenerationUsageRecorded");
    if(damage==="provider_mismatch"){assert.equal(usage.checks.length,1);assert.equal(usage.checks[0].provider,false);assert.equal(usage.checks[0].linkedUsage,true);}
    else {assert.equal(usage.checks.length,0);assert.equal(diagnostic.counts.find(row=>row.type==="GenerationUsageRecorded").retained_json_count,0);}
    const serialized=JSON.stringify(logged);
    for(const privateValue of ["private-mismatched-provider-never-log","malformed-private-evidence",fixture.original.plannerResponseId,fixture.original.providerJobId,fixture.original.audioInputReceipt.submitted_prompt,fixture.originalInput.document_snapshot.facts[0].properties.text])if(privateValue)assert.equal(serialized.includes(privateValue),false);
    assert.equal(fixture.calls.length,beforeCalls);assert.equal(fixture.stored.length,0);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),beforeReservations);
  }finally{console.error=previousError;fixture.restore();}
});

for(const race of ["source_deleted","input_expired","consent_revoked"])test(`original-source audio recovery stops when ${race} during retrieval`,async()=>{
  const fixture=await originalSourceAudioFixture();
  try{
    const checkpoint=fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).result_json;
    fixture.afterDownload(async()=>{
      if(race==="source_deleted")await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockRemoved",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:fixture.firstFact.block_id});
      if(race==="input_expired")fixture.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z",fixture.original.generationReceipt.input_ref);
      if(race==="consent_revoked")fixture.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id='dev-local-creative'").run();
    });
    const rejected=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(rejected.status,409);
    assert.equal(fixture.stored.length,0);
    const restored=fixture.sqlite.prepare("SELECT status,result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId);
    assert.equal(restored.status,"failed");assert.equal(restored.result_json,checkpoint);
    assert.equal(fixture.calls.filter(call=>call.method==="POST"&&call.url!=="https://api.openai.com/v1/moderations").length,2);
    assert.equal(fixture.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM cost_budget_reservations").get().cost,142_042);
  }finally{fixture.restore();}
});

test("original-source audio recovery atomically rolls back zero-row completion and removes only attempt staging",async()=>{
  const fixture=await originalSourceAudioFixture();
  try{
    const checkpoint=fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).result_json;
    fixture.sqlite.exec("CREATE TRIGGER ignore_audio_recovery_commit BEFORE UPDATE ON document_jobs WHEN NEW.status='completed' AND NEW.correlation_id LIKE '%:audio-recovery:%' BEGIN SELECT RAISE(IGNORE); END");
    const rejected=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(rejected.status,409);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='GenerationUsageRecorded' AND correlation_id LIKE '%:audio-recovery:%'").get().count,0);
    assert.equal(fixture.stored.length,1);assert.deepEqual(fixture.deleted,[fixture.stored[0].key]);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content WHERE kind='document-artifact' AND redacted_at IS NULL").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).result_json,checkpoint);
    assert.equal(fixture.sqlite.prepare("SELECT redacted_at FROM private_content WHERE content_id=?").get(fixture.original.generationReceipt.input_ref).redacted_at,null);
    fixture.sqlite.exec("DROP TRIGGER ignore_audio_recovery_commit");
    const retry=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(retry.status,200,JSON.stringify(await retry.clone().json()));
    assert.equal(fixture.stored.length,2);assert.notEqual(fixture.stored[0].key,fixture.stored[1].key);assert.equal(fixture.deleted.length,1);
    assert.equal(fixture.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM cost_budget_reservations").get().cost,142_042);
  }finally{fixture.restore();}
});

test("original-source audio recovery enforces single-writer claim during concurrent retries",async()=>{
  const fixture=await originalSourceAudioFixture();
  try{
    let release;const blocked=new Promise(resolve=>{release=resolve;});let entered;const downloading=new Promise(resolve=>{entered=resolve;});
    fixture.afterDownload(async()=>{entered();await blocked;});
    const first=fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});await downloading;
    const second=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(second.status,409);
    release();assert.equal((await first).status,200);
    assert.equal(fixture.stored.length,1);assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted'").get().count,1);
    assert.equal(fixture.calls.filter(call=>call.method==="POST"&&call.url!=="https://api.openai.com/v1/moderations").length,2);
  }finally{fixture.restore();}
});

test("original-source audio recovery preserves original active lineage separately from admitted inactive sources",async()=>{
  const fixture=await originalSourceAudioFixture({muted:true});
  try{
    const recovered=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(recovered.status,200,JSON.stringify(await recovered.clone().json()));
    const artifact=JSON.parse(fixture.sqlite.prepare("SELECT secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.type='DocumentRenderCompleted'").get().private_json);
    assert.equal(artifact.source_block_versions.some(source=>source.block_id==="inactive-original-audio-source"),false);
    const input=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(artifact.input_ref).content);
    assert.equal(input.admitted_source_block_versions.some(source=>source.block_id==="inactive-original-audio-source"),true);
    assert.deepEqual(input.source_block_versions,artifact.source_block_versions);
    assert.deepEqual(input.original_document_snapshot,fixture.originalInput.document_snapshot);
  }finally{fixture.restore();}
});

test("original-source audio recovery retains GET-only routing after an interrupted verified attempt",async()=>{
  const fixture=await originalSourceAudioFixture();
  try{
    fixture.afterDownload(async()=>{
      const checkpoint=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).result_json);
      assert.equal(checkpoint.audioOriginalSourceRecovery.version,1);
      checkpoint.errorDetail={code:"execution_interrupted",category:"server",scope:"unknown",action:"contact_support",message:"Worker interrupted",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null};
      fixture.sqlite.prepare("UPDATE document_jobs SET status='failed',result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),fixture.job.jobId);
    });
    const interrupted=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(interrupted.status,409);
    fixture.afterDownload(null);
    const count=fixture.calls.length;
    const recovered=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(recovered.status,200,JSON.stringify(await recovered.clone().json()));
    assert.ok(fixture.calls.slice(count).every(call=>call.method==="GET"));assert.equal(fixture.calls.length-count,3);
    assert.equal(fixture.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM cost_budget_reservations").get().cost,142_042);
  }finally{fixture.restore();}
});

test("original-source audio recovery re-proves both repaired planner receipts after interruption",async()=>{
  const fixture=await originalSourceAudioFixture({repair:true});
  try{
    const reservations=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all();
    fixture.afterDownload(async()=>{
      const checkpoint=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).result_json);
      assert.equal(checkpoint.plannerResponseId,"original-source-initial-plan");
      checkpoint.errorDetail={code:"execution_interrupted",category:"server",scope:"unknown",action:"contact_support",message:"Worker interrupted",retryable:false,retryAfterMs:null,requestId:null,httpStatus:null};
      fixture.sqlite.prepare("UPDATE document_jobs SET status='failed',result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),fixture.job.jobId);
    });
    const interrupted=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(interrupted.status,409);
    fixture.afterDownload(null);
    const retained=fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).result_json;
    assert.equal(JSON.parse(retained).plannerResponseId,"original-source-initial-plan");
    mutateAudioCheckpoint(fixture,result=>{result.plannerInput.validation.repair_response_id="unverified-repair-after-interruption";});
    const count=fixture.calls.length,rejected=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});
    assert.equal(rejected.status,409);assert.equal(fixture.calls.length,count);
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(retained,fixture.job.jobId);
    const recovered=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(recovered.status,200,JSON.stringify(await recovered.clone().json()));
    assert.equal((await recovered.json()).job.result.plannerResponseId,"original-source-paid-plan");
    assert.equal(fixture.calls.length-count,3);assert.ok(fixture.calls.slice(count).every(call=>call.method==="GET"));
    const completed=JSON.parse(fixture.sqlite.prepare("SELECT secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.type='DocumentRenderCompleted'").get().private_json);
    const saved=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(completed.input_ref).content);
    assert.equal(saved.planner.response_id,"original-source-paid-plan");assert.equal(saved.planner.legacy_checkpoint_response_id,"original-source-initial-plan");
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),reservations);
  }finally{fixture.restore();}
});

for(const ignoredType of ["DocumentRenderCompleted","GenerationUsageRecorded"])test(`original-source audio recovery rolls back when ${ignoredType} is not inserted`,async()=>{
  const fixture=await originalSourceAudioFixture();
  try{
    fixture.sqlite.exec(`CREATE TRIGGER ignore_original_audio_event BEFORE INSERT ON event_write_stage WHEN NEW.type='${ignoredType}' AND NEW.correlation_id LIKE '%:audio-recovery:%' BEGIN SELECT RAISE(IGNORE); END`);
    const rejected=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(rejected.status,409);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE correlation_id LIKE '%:audio-recovery:%'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(fixture.job.jobId).status,"failed");
    assert.deepEqual(fixture.deleted,[fixture.stored[0].key]);
  }finally{fixture.restore();}
});

test("original-source audio recovery protects shared-project receipts without weakening provider eligibility",async()=>{
  const fixture=await originalSourceAudioFixture({shared:true});
  try{
    const unscoped=await fixture.unscopedRequest(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(unscoped.status,404);
    const recovered=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(recovered.status,200,JSON.stringify(await recovered.clone().json()));
    const serialized=await recovered.text();
    assert.doesNotMatch(serialized,/original_input_ref|recovered_input_ref|original_source_snapshot_sha256|original_request_event_id|original_failure_event_id|original_usage_event_id|provider_job_id|original-source-paid-audio|audioOriginalSourceRecovery/);
    const result=JSON.parse(serialized);assert.equal(result.job.result.recovery.current_edits_preserved,true);assert.equal(result.job.result.recovery.new_generation_requests,0);
    for(const path of ["/api/document-jobs",`/api/document-jobs/${fixture.job.jobId}`]){
      const response=await fixture.request(path);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/original_input_ref|recovered_input_ref|original_source_snapshot_sha256|original-source-paid-audio|audioOriginalSourceRecovery/);
    }
    const recoveredInput=fixture.sqlite.prepare("SELECT content_id FROM private_content WHERE kind='document-artifact-input' AND json_extract(content,'$.recovery.mode')='original-source-provider-verified'").get();
    assert.ok(recoveredInput);
    assert.deepEqual({...fixture.sqlite.prepare("SELECT visibility,actor_user_id FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(recoveredInput.content_id)},{visibility:"actor_private",actor_user_id:"dev-local-creative"});
  }finally{fixture.restore();}
});

for(const race of ["session","membership","retention_classification"])test(`original-source audio recovery rejects shared ${race} revocation during retrieval`,async()=>{
  const fixture=await originalSourceAudioFixture({shared:true});
  try{
    fixture.afterDownload(()=>{
      if(race==="session")fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),fixture.contextId);
      if(race==="membership")fixture.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id='dev-local-creative'").run(new Date().toISOString(),fixture.organizationId);
      if(race==="retention_classification")fixture.sqlite.prepare("UPDATE private_content_retention_scopes SET classification='untrusted' WHERE content_id=?").run(fixture.original.generationReceipt.input_ref);
    });
    const rejected=await fixture.request(`/api/document-jobs/${fixture.job.jobId}/retry`,{method:"POST"});assert.equal(rejected.status,409,JSON.stringify(await rejected.clone().json()));
    assert.equal(fixture.stored.length,0);assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted'").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM cost_budget_reservations").get().cost,142_042);
  }finally{fixture.restore();}
});

for(const form of ["preview","generate","short_story","scene","storyboard","audio","video"]){
  test(`${form} keeps paid planning in the live request and records its boundary before dispatch`,async()=>{
    const fixture=await reliabilityWorker();fixture.environment.FAL_KEY="test-existing-fal-key";
    const previousFetch=globalThis.fetch;
    globalThis.fetch=async(url)=>{assert.equal(String(url),"https://api.openai.com/v1/moderations");return Response.json({id:"test-moderation",results:[{flagged:false,categories:{}}]});};
    await fixture.drainBackground();
    const kind=form==="preview"||form==="generate"?form:"render_document";
    const admission={kind,documentId:"doc-atmosphere",payload:{...(kind==="render_document"?{artifactKind:form,productionMode:"manual",itemCount:1,paidMediaConfirmed:true}:{}),requestKey:`foreground-${form}`}};
    const accepted=form==="scene"?await approvedReliabilityScene(fixture,admission):await fixture.request("/api/document-jobs",json(admission));
    assert.equal(accepted.status,202,JSON.stringify(await accepted.clone().json()));
    const {job}=await accepted.json();assert.equal(fixture.backgroundCount,0);
    const entered=Promise.withResolvers(),release=Promise.withResolvers();
    let calls=0,resolved=false,execution;
    globalThis.fetch=async(url)=>{
      assert.equal(String(url),"https://api.openai.com/v1/responses");calls+=1;
      const checkpoint=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
      assert.equal(checkpoint.providerSubmissionProtocol,1);
      assert.equal(Object.values(checkpoint.providerSubmissions)[0].status,"pending");
      entered.resolve();await release.promise;
      return Response.json({error:{message:"Verified original submission rejection",code:"invalid_request"}},{status:422});
    };
    try{
      execution=fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"}).then(response=>{resolved=true;return response;});
      await Promise.race([entered.promise,execution.then(async response=>{throw new Error(`provider was never reached: ${JSON.stringify(await response.clone().json())}`);})]);
      assert.equal(resolved,false);assert.equal(calls,1);
      assert.equal((await fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"})).status,202);
      assert.equal(calls,1);
      release.resolve();const completed=await execution;assert.equal(completed.status,200);
      const failed=(await completed.json()).job;assert.equal(failed.status,"failed");
      assert.equal(failed.result.generationReceipt.settled_cost_microusd,0);
      assert.equal(failed.result.generationReceipt.source_transmission_status,"transmitted");
    }finally{release.resolve();if(execution)await execution;globalThis.fetch=previousFetch;}
  });
}

for(const outcome of ["network","server","malformed"]){
  test(`non-slide ${outcome} uncertainty retains both ledgers and never purchases a retry`,async()=>{
    const fixture=await reliabilityWorker();
    const admission=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"short_story",productionMode:"manual",itemCount:1,requestKey:`uncertain-${outcome}`}}));
    assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));const{job}=await admission.json();
    const previousFetch=globalThis.fetch;let calls=0;
    globalThis.fetch=async()=>{calls+=1;if(outcome==="network")throw new TypeError("Connection lost after dispatch");return outcome==="server"?new Response("upstream unavailable",{status:503}):new Response("not a usable provider receipt",{status:200});};
    try{
      const failed=(await(await fixture.runJob(job)).json()).job;
      assert.equal(failed.status,"failed");assert.equal(failed.errorDetail.code,"provider_submission_uncertain");
      assert.equal(failed.result.generationReceipt.provider_request_status,"submission_unknown");
      assert.equal(failed.result.generationReceipt.settled_cost_microusd,null);
      assert.equal(failed.result.generationReceipt.reservation_status,"executing");
      assert.equal((await fixture.request(`/api/document-jobs/${job.jobId}/retry`,{method:"POST"})).status,409);
      await fixture.runJob(job);
      await reconcileFailedBudgetReservations(fixture.environment,{userId:"dev-local-creative",streamId:"creative:dev-local-creative"},Date.now()+86_400_000);
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,1);
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status='executing'").get().count,1);
      assert.equal(calls,1);
    }finally{globalThis.fetch=previousFetch;}
  });
}

test("generic paid evidence alone blocks racing cancellation and survives private-input expiration",async()=>{
  for(const mode of ["immediate","racing","expired"]){
    const fixture=await reliabilityWorker();
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"short_story",itemCount:1,requestKey:`generic-${mode}`}}));
    assert.equal(accepted.status,202);const{job}=await accepted.json();
    const owner="dev-local-creative",stream=`creative:${owner}`,correlation=`${job.jobId}:attempt:1`,operation="document-render:short_story";
    const tokens=await reserveBudget(fixture.environment,owner,32_000,{streamId:stream,correlationId:correlation,operation});assert.equal(tokens.ok,true);
    const costs=await reserveCostBudget(fixture.environment,owner,1_000_000,{maximumMicrousd:1_000_000,allowUserOverage:false,streamId:stream,correlationId:correlation,operation,period:tokens.period});assert.equal(costs.ok,true);await claimCostBudgetReservation(fixture.environment,owner,costs.reservationId);
    const pending={"pending-unit":{clientRequestId:"pending-unit",provider:"openai",operation:"planning",model:"gpt-5.6-terra",status:"pending",candidateRaw:"PRIVATE_MAP_SENTINEL"}};
    const checkpoint={...job.result,providerSubmissionProtocol:1,providerSubmissions:mode==="racing"?{}:pending,reservationId:tokens.reservationId,costReservationId:costs.reservationId,costReservationPeriod:tokens.period,costReservationMicrousd:1_000_000,candidateRaw:"PRIVATE_DRAFT_SENTINEL"};
    const now=new Date().toISOString(),past=new Date(Date.now()-120_000).toISOString(),future=new Date(Date.now()+75_000).toISOString();
    fixture.sqlite.prepare("UPDATE document_jobs SET status=?,attempt_count=1,correlation_id=?,started_at=?,lease_expires_at=?,expires_at=?,updated_at=?,result_json=? WHERE job_id=?").run(mode==="expired"?"failed":"running",correlation,now,mode==="expired"?null:future,mode==="expired"?past:future,now,JSON.stringify(checkpoint),job.jobId);
    if(mode==="racing")fixture.controls.beforeRun=async(statement)=>{if(statement.sql.startsWith("UPDATE document_jobs SET status=?,result_json=json_patch")){fixture.controls.beforeRun=null;fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({...checkpoint,providerSubmissions:pending}),job.jobId);}};
    if(mode!=="expired")assert.equal((await fixture.request(`/api/document-jobs/${job.jobId}/cancel`,{method:"POST"})).status,409);
    else{
      assert.equal((await fixture.request(`/api/document-jobs/${job.jobId}/retry`,{method:"POST"})).status,409);
      const expired=fixture.sqlite.prepare("SELECT request_json,result_json FROM document_jobs WHERE job_id=?").get(job.jobId);
      assert.doesNotMatch(expired.result_json,/PRIVATE_(?:MAP|DRAFT)_SENTINEL/);
      assert.equal(JSON.parse(expired.result_json).providerSubmissions["pending-unit"].clientRequestId,"pending-unit");
      assert.deepEqual(JSON.parse(expired.request_json),{artifactKind:"short_story"});
    }
    await reconcileFailedBudgetReservations(fixture.environment,{userId:owner,streamId:stream},Date.now()+86_400_000);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(tokens.reservationId).status,"active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costs.reservationId).status,"executing");
  }
});

test("stale claim and terminal recovery cannot overwrite a racing paid checkpoint",async()=>{
  for(const mode of ["claim","fail"]){
    const fixture=await reliabilityWorker();
    const accepted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"short_story",itemCount:1,requestKey:`race-${mode}`}}));
    assert.equal(accepted.status,202);const{job}=await accepted.json();
    const owner="dev-local-creative",stream=`creative:${owner}`,correlation=`${job.jobId}:attempt:1`,operation="document-render:short_story";
    const tokens=await reserveBudget(fixture.environment,owner,32_000,{streamId:stream,correlationId:correlation,operation});assert.equal(tokens.ok,true);
    const costs=await reserveCostBudget(fixture.environment,owner,1_000_000,{maximumMicrousd:1_000_000,allowUserOverage:false,streamId:stream,correlationId:correlation,operation,period:tokens.period});assert.equal(costs.ok,true);await claimCostBudgetReservation(fixture.environment,owner,costs.reservationId);
    const entry=(id)=>({clientRequestId:id,provider:"openai",operation:"planning",model:"gpt-5.6-terra",status:"pending"});
    const checkpoint={...job.result,providerSubmissionProtocol:1,providerSubmissions:mode==="fail"?{original:entry("original")}: {},reservationId:tokens.reservationId,costReservationId:costs.reservationId,costReservationPeriod:tokens.period,costReservationMicrousd:1_000_000};
    const old=new Date(Date.now()-120_000).toISOString();
    fixture.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,correlation_id=?,started_at=?,lease_expires_at=?,updated_at=?,result_json=? WHERE job_id=?").run(correlation,old,old,old,JSON.stringify(checkpoint),job.jobId);
    let raced=false;
    fixture.controls.beforeRun=async(statement)=>{
      const prefix=mode==="claim"?"UPDATE document_jobs SET status='running',attempt_count=attempt_count+1":"UPDATE document_jobs SET status='failed',error_message=";
      if(raced||!statement.sql.startsWith(prefix))return;raced=true;
      fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({...checkpoint,providerSubmissions:{...checkpoint.providerSubmissions,racing:entry("racing")}}),job.jobId);
    };
    const previousFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls+=1;throw new Error("No new provider call is authorized by a stale snapshot");};
    try{
      assert.equal((await fixture.request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"})).status,202);
      assert.equal(raced,true);const row=fixture.sqlite.prepare("SELECT status,attempt_count,result_json FROM document_jobs WHERE job_id=?").get(job.jobId);
      assert.equal(row.status,"running");assert.equal(row.attempt_count,1);assert.equal(JSON.parse(row.result_json).providerSubmissions.racing.status,"pending");
      fixture.controls.beforeRun=null;assert.equal((await fixture.runJob(job)).status,200);
      assert.equal(calls,0);assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(costs.reservationId).status,"executing");
    }finally{fixture.controls.beforeRun=null;globalThis.fetch=previousFetch;}
  }
});

test("missing planner or image usage holds the original budget; failed media storage settles known work",async()=>{
  for(const scenario of ["planning-missing","planning-empty","image-missing","image-empty","storage"]){
    const fixture=await reliabilityWorker();const previousFetch=globalThis.fetch;let paidCalls=0;
    const direction={title:"A quiet creative desk",rationale:"One clear decision",scene:"Blank cards arranged around a calm work surface",palette:["#ffffff","#eeeeee","#333333"],next_moves:["Review the direction","Choose the next action"]};
    globalThis.fetch=async(url)=>{
      if(String(url).endsWith("/moderations"))return Response.json({id:"test-moderation",results:[{flagged:false,categories:{}}]});
      paidCalls+=1;
      if(String(url).endsWith("/responses"))return Response.json({id:"test-paid-direction",model:"gpt-5.6-terra",output_text:JSON.stringify(direction),...(scenario==="planning-missing"?{}:{usage:scenario==="planning-empty"?{}:{input_tokens:1200,output_tokens:800,total_tokens:2000}})});
      assert.equal(String(url),"https://api.openai.com/v1/images/generations");
      return Response.json({data:[{b64_json:Buffer.from("test-image").toString("base64")}],...(scenario==="image-missing"?{}:{usage:scenario==="image-empty"?{}:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{text_tokens:100,image_tokens:0}}})},{headers:{"x-request-id":"test-paid-image"}});
    };
    if(scenario==="storage")fixture.environment.MEDIA.put=async()=>{throw new Error("test_media_storage_failure");};
    try{
      const admitted=await fixture.request("/api/document-jobs",json({kind:"generate",documentId:"doc-atmosphere",payload:{requestKey:`accounting-${scenario}`}}));assert.equal(admitted.status,202);const{job}=await admitted.json();
      const result=(await(await fixture.runJob(job)).json()).job;assert.equal(result.status,"failed");
      if(scenario==="storage"){
        assert.ok(result.result.generationReceipt.settled_cost_microusd>12000);
        assert.equal(result.result.generationReceipt.reservation_status,"settled");
      }else{
        assert.equal(result.errorDetail.code,"provider_usage_receipt_missing");
        assert.equal(result.result.generationReceipt.settled_cost_microusd,null);
        assert.equal(result.result.generationReceipt.reservation_status,"executing");
      }
      const callsBeforeRetry=paidCalls;await fixture.runJob(job);assert.equal(paidCalls,callsBeforeRetry);
    }finally{globalThis.fetch=previousFetch;}
  }
});

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
    assert.equal(completed.status,"completed",JSON.stringify(completed.errorDetail));
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

test("paid draft recovery preserves an authorized closing repeat and refuses unrelated repeated copy without resubmission",async(context)=>{
  const promise="Your content. One context. Infinite paths to your target.";
  let providerCalls=0;
  context.mock.method(globalThis,"fetch",async()=>{providerCalls++;throw new Error("Saved paid drafts must not trigger another provider request.");});
  for(const invalid of [false,true]){
    const fixture=await reliabilityWorker();
    const documentId=await seedIndependentPresentation(fixture,`saved-pitch-repeat-${invalid}`);
    const scores=`${INDEPENDENT_SLIDE_SCORES.map(([label,value])=>`${label}: ${value}`).join("; ")}. Exact equal-weight average: 61.125. Rounded display value: 61.13.`;
    for(const[index,text]of[[1,`Slide 1 — ${promise}\n${scores}`],[12,`Slide 12 — ${INDEPENDENT_SLIDE_TITLES[11]}\nIndependent evidence for executive decision preserves conversion 21.25%. Close with the exact promise: ${promise}`]]){
      await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockPropertyEdited",{project_id:"project-atmosphere",document_id:documentId,block_id:`PRIVATE_AUTHORED_SLIDE_${index}`,property_path:"text",new_value:text});
    }
    const admission=await fixture.request("/api/document-jobs",json(presentationAdmission(documentId,`saved-pitch-repeat-${invalid}`)));
    assert.equal(admission.status,202,JSON.stringify(await admission.clone().json()));
    const{job}=await admission.json(),attempt=await stalePresentationAttempt(fixture,job,{reserve:true,paid:true});
    const draft=savedIndependentPresentationPlan();
    draft.items[0].title=promise;
    draft.items[0].slide.citations[0].excerpt=promise;
    draft.items[11].slide.bullets=[draft.items[11].body];
    draft.items[11].body=promise;
    draft.content_markdown+=`\n\n${promise}`;
    if(invalid){draft.items[10].slide.bullets=[draft.items[10].body];draft.items[10].body=promise;}
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({...attempt.checkpoint,artifactPlan:draft}),job.jobId);
    const response=await fixture.runJob(job),actual=(await response.json()).job;
    assert.equal(actual.status,invalid?"failed":"completed",JSON.stringify(actual.errorDetail));
    if(invalid)assert.equal(actual.errorDetail.code,"presentation_recovery_unavailable");
    else assert.equal(actual.result.generationReceipt.actual_provider_call_count,1);
    assert.equal(providerCalls,0);
  }
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
    [{productionMode:"manual",itemCount:16},400,"presentation_slide_count_invalid",15],
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

test("unresolved output-outline evidence is rejected at both admission boundaries before reservations or job writes",async()=>{
  const fixture=await reliabilityWorker();
  const documentId="isolated-unresolved-output-outline";
  await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","DocumentCreated",{project_id:"project-atmosphere",document_id:documentId,title:"Isolated outline preflight test"});
  await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockCreated",{
    project_id:"project-atmosphere",document_id:documentId,block_id:"isolated-outline-only",type:"format",handle:"format/isolated-outline",position:"outline-1",
    properties:{text:"Presentation outline\nSlide 1: Orchard yield. Explain orchard yield and drip irrigation.\nSlide 2: Archive retrieval. Describe archive retrieval and catalog records.",weight:1,authority:"authored"},
  });
  const baselineEvents=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const baselinePrivate=fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count;
  const original=globalThis.fetch;let providerCalls=0;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("Unresolved source scope must stop before provider contact.");};
  try{
    for(const mode of ["manual","managed"])for(const boundary of ["jobs","events"]){
      const payload={artifactKind:"slides",productionMode:mode,itemCount:2,requestedSlideCount:2,budgetAcknowledged:true};
      const rejected=boundary==="jobs"?await handleDocumentJobs(new Request("http://localhost/api/document-jobs",json({kind:"render_document",documentId,payload})),fixture.environment,""):await handleEvents(new Request("http://localhost/api/events",json({action:"render_document",documentId,...payload})),fixture.environment);
      assert.equal(rejected.status,422,`${boundary}/${mode}: ${JSON.stringify(await rejected.clone().json())}`);
      const detail=await rejected.json();assert.equal(detail.error,"presentation_source_contract_invalid");
      assert.ok(detail.issues.some((issue)=>issue.code==="unresolved_outline_evidence"));
    }
    assert.equal(providerCalls,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count,baselineEvents);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM private_content").get().count,baselinePrivate);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE document_id=?").get(documentId).count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations").get().count,0);
  }finally{globalThis.fetch=original;}
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
    const accepted=await approvedReliabilityScene(fixture,{kind:"render_document",documentId:"doc-atmosphere",payload:{
      artifactKind:"scene",productionMode:"manual",itemCount:1,requestKey:"unpriced-cross-media-planner",
    }});
    const {job}=await accepted.json();
    const response=await fixture.runJob(job),failed=(await response.json()).job;

    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.httpStatus,429,JSON.stringify(failed));
    assert.equal(failed.errorDetail.code,"document_model_pricing_unavailable");
    assert.equal(providerCalls,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM cost_budget_reservations WHERE status IN('active','executing')").get().count,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

for(const artifactKind of ["short_story","storyboard"]){
  test(`a complete multi-decision ${artifactKind} brief fits its reserved planning slice above the old 32k threshold`,async()=>{
    const fixture=await reliabilityWorker();
    for(let index=0;index<13;index+=1)await appendAuditEvent(fixture.environment,"creative:dev-local-creative","user","BlockCreated",{project_id:"project-atmosphere",document_id:"doc-atmosphere",block_id:`rich-source-${index}`,type:"direction",handle:`direction/rich-${index}`,position:`z-rich-${index}`,properties:{text:`Distinct authored decision ${index}: ${"Keep human decisions, evidence, and consent visible throughout this creative journey. ".repeat(24)}`,weight:1,authority:"authored"}});
    const previousFetch=globalThis.fetch;let calls=0;
    globalThis.fetch=async(url,init={})=>{
      assert.equal(String(url),"https://api.openai.com/v1/responses");calls+=1;
      const request=JSON.parse(init.body);
      const maximumInputTokens=new TextEncoder().encode(init.body).byteLength+4096;
      assert.ok(maximumInputTokens+request.max_output_tokens>32_000);
      assert.ok(maximumInputTokens+request.max_output_tokens<128_000);
      const token=fixture.sqlite.prepare("SELECT reserved_tokens FROM budget_reservations WHERE status='active'").get();
      const cost=fixture.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_reservations WHERE status='executing'").get();
      assert.equal(token.reserved_tokens,artifactKind==="storyboard"?320_000:128_000);
      assert.equal(cost.reserved_microusd,artifactKind==="storyboard"?9_000_000:1_000_000,"the approved dollar ceiling is unchanged");
      return Response.json({error:{code:"invalid_request",message:"Definitive test rejection"}},{status:422});
    };
    try{
      const admitted=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind,productionMode:"manual",itemCount:artifactKind==="storyboard"?8:1,paidMediaConfirmed:true,requestKey:`rich-${artifactKind}`}}));
      assert.equal(admitted.status,202,await admitted.clone().text());
      const{job}=await admitted.json();const failed=(await(await fixture.runJob(job)).json()).job;
      assert.equal(calls,1);
      assert.notEqual(failed.errorDetail.code,"document_token_cap_reached");
      assert.equal(failed.result.generationReceipt.settled_cost_microusd,0);
    }finally{globalThis.fetch=previousFetch;}
  });
}

test("the larger planning reservation still blocks execution when the monthly token balance cannot cover it",async()=>{
  const fixture=await reliabilityWorker();
  const changed=fixture.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens-100000 WHERE scope='user' AND scope_id='dev-local-creative'").run();
  assert.equal(changed.changes,1);
  const response=await fixture.request("/api/document-jobs",json({kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"short_story",itemCount:1,requestKey:"monthly-planning-limit"}}));
  assert.equal(response.status,202,await response.clone().text());
  const{job}=await response.json();const previousFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error("Insufficient monthly tokens cannot authorize a provider request");};
  try{
    const failed=(await(await fixture.runJob(job)).json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.code,"budget_hard_cap_reached");
    assert.equal(failed.errorDetail.scope,"user");
    assert.equal(calls,0);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM budget_reservations WHERE status='active'").get().count,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("a planning dollar ceiling remains authoritative even with unused reserved tokens",async()=>{
  const fixture=await reliabilityWorker();fixture.environment.OPENAI_MODEL="gpt-5.6-sol";
  const previousFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls+=1;assert.equal(calls,1);return Response.json({id:"metered-expensive-plan",model:"gpt-5.6-sol",output_text:"{}",usage:{input_tokens:40000,output_tokens:23000,total_tokens:63000}});};
  try{
    const accepted=await approvedReliabilityScene(fixture,{kind:"render_document",documentId:"doc-atmosphere",payload:{artifactKind:"scene",productionMode:"manual",itemCount:1,requestKey:"unchanged-dollar-ceiling"}});
    const {job}=await accepted.json();const response=await fixture.runJob(job),failed=(await response.json()).job;
    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.httpStatus,429,JSON.stringify(failed));
    assert.equal(failed.errorDetail.code,"document_spend_cap_reached");
    assert.equal(calls,1);
    assert.equal(fixture.sqlite.prepare("SELECT used_microusd FROM cost_budget_reservations WHERE operation='document-render:scene'").get().used_microusd,890_000);
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
        items:[{title:"Unfinished scene",body:"x".repeat(135_000),notes:"",image_prompt:"",context_group_ids:[]}],
      }),
      usage:{input_tokens:100,output_tokens:50,total_tokens:150},
    });
  };

  try{
    const accepted=await approvedReliabilityScene(fixture,{kind:"render_document",documentId:"doc-atmosphere",payload:{
      artifactKind:"scene",productionMode:"manual",itemCount:1,requestKey:"oversized-cross-media-repair",
    }});
    const {job}=await accepted.json();
    const response=await fixture.runJob(job),failed=(await response.json()).job;

    assert.equal(failed.status,"failed");
    assert.equal(failed.errorDetail.httpStatus,429,JSON.stringify(failed));
    assert.equal(failed.errorDetail.code,"document_token_cap_reached");
    assert.equal(providerCalls,1,"the initial response is retained but its unsafe repair is never purchased");
    const reservation=fixture.sqlite.prepare("SELECT reserved_tokens,used_tokens,status FROM budget_reservations WHERE operation='document-render:scene'").get();
    assert.deepEqual({...reservation},{reserved_tokens:128_000,used_tokens:150,status:"settled"});
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
        items:[{title:"Unfinished storyboard frame",body:"x".repeat(128_000),notes:"",image_prompt:"A visually distinct opening frame.",context_group_ids:[]}],
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
    assert.deepEqual({...reservation},{reserved_tokens:152_000,used_tokens:150,status:"settled"});
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
    assert.ok(candidates.every((candidate)=>!Object.hasOwn(candidate,"citationChecks")),"private citation excerpts and passages never enter listing summaries");

    const detailed=await requestSourceJob(`${job.jobId}/presentation-candidates/rejected-visible-alternative-1`);
    assert.equal(detailed.status,200,JSON.stringify(await detailed.clone().json()));
    const text=await detailed.text();
    const detail=JSON.parse(text).candidate;
    assert.equal(detail.slides.length,12);
    assert.equal(detail.slides[0].title,"RESPONSIVE ASSESSMENT");
    assert.ok(detail.citationChecks.length>0,"the authorized private detail explains citation grounding against frozen source passages");
    assert.ok(detail.citationChecks.every((check)=>check.passages.every((passage)=>!Object.hasOwn(passage,"id"))),"private passage identifiers never become display text");
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

test("an adapter upgrade cannot promote a historically rejected paid presentation or rewrite its receipt",async()=>{
  const fixture=await reliabilityWorker();
  const documentId=await seedIndependentPresentation(fixture,"historical-rejection-review-only");
  const requestSourceJob=(path="",init={})=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs${path?`/${path}`:""}`,init),fixture.environment,path);
  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async(_url,init={})=>{
    providerCalls+=1;
    return Response.json({id:"historical-review-only-response",model:"gpt-5.6-terra",output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
  };
  try{
    const admitted=await requestSourceJob("",json(presentationAdmission(documentId,"historical-rejection-review-only")));
    assert.equal(admitted.status,202,JSON.stringify(await admitted.clone().json()));
    const{job}=await admitted.json();
    fixture.sqlite.exec("CREATE TRIGGER fail_review_only_persistence BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_review_only_persistence_failure'); END");
    const failedResponse=await requestSourceJob(`${job.jobId}/run`,{method:"POST"});
    const failed=(await failedResponse.json()).job;
    assert.equal(failed.status,"failed");
    fixture.sqlite.exec("DROP TRIGGER fail_review_only_persistence");
    const current=JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);
    assert.equal(current.recoverablePresentationCandidate,true,"the synthetic response passes current validation, so the historical guard is exercised");
    for(const version of ["2026-08-26-source-aware-render-v4",undefined]){
      const checkpoint=structuredClone(current);
      checkpoint.generationReceipt.presentation_adapter_version=version;
      checkpoint.generationReceipt.failure_stage="source_fidelity_validation";
      checkpoint.generationReceipt.failure_code="source_fidelity_validation_failed";
      checkpoint.errorDetail={...checkpoint.errorDetail,code:"source_fidelity_validation_failed"};
      // This stale true flag must not override the historical validation rejection.
      checkpoint.recoverablePresentationCandidate=true;
      const original=JSON.stringify(checkpoint);
      fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(original,job.jobId);
      const listed=await requestSourceJob();
      assert.equal(listed.status,200);
      assert.notEqual((await listed.json()).jobs.find((entry)=>entry.jobId===job.jobId).result.recoverablePresentationCandidate,true);
      const alternatives=await requestSourceJob(`${job.jobId}/presentation-candidates`);
      assert.equal(alternatives.status,200);
      const candidates=(await alternatives.json()).candidates;
      assert.equal(candidates.length,1);
      assert.equal(candidates[0].complete,false);
      assert.equal(candidates[0].reviewOnlyReason,"historical-validation-rejection");
      assert.equal(candidates[0].issues.length,0,"passing current checks must not erase the previous rejection");
      const recovery=await requestSourceJob(`${job.jobId}/recover`,{method:"POST"});
      assert.equal(recovery.status,409);
      assert.equal((await recovery.json()).reason,"historical_validation_rejection");
      const retained=fixture.sqlite.prepare("SELECT result_json,status FROM document_jobs WHERE job_id=?").get(job.jobId);
      assert.equal(retained.status,"failed");
      assert.equal(retained.result_json,original,"review and blocked recovery do not migrate immutable failure accounting");
      assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(documentId).count,0);
    }
    assert.equal(providerCalls,1,"reviewing and blocking recovery never submit another provider request");
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
