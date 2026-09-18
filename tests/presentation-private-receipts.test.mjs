import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { after, test } from "node:test";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { presentationCandidateAccounting, presentationCandidateOriginalValidation } from "../src/model/presentation-candidates.ts";

// Reuse the existing SQLite/identity/generation fixture, but exercise the actual
// source Worker router: no dist substitute, provider network, or repository writes.
const workspaceURL = new URL("../", import.meta.url);
const fixtureURL = new URL("./__presentation_private_receipts_fixture.mjs", import.meta.url);
const reliabilitySource = readFileSync(new URL("./document-generation-reliability.test.mjs", import.meta.url), "utf8");
const fixtureEnd = reliabilitySource.indexOf('test("both audio admission routes');
assert.ok(fixtureEnd > 0);
const fixtureSource = reliabilitySource.slice(0, fixtureEnd)
  .replace('import worker from "../dist/server/index.js";', 'import worker from "../worker/index.ts";')
  + "\nexport {reliabilityWorker,json,seedIndependentPresentation,independentProviderResponse,presentationAdmission};\n";
const fixtureHooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === fixtureURL.href) return { url: fixtureURL.href, shortCircuit: true };
    const local = context.parentURL?.startsWith(workspaceURL.href) && !context.parentURL.includes("/node_modules/");
    return next(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context);
  },
  load(url, context, next) {
    if (url === fixtureURL.href) return { format: "module", source: fixtureSource, shortCircuit: true };
    return next(url, context);
  },
});
const helpers = await import(fixtureURL.href);
after(() => fixtureHooks.deregister());

const privateReceiptFixture=async function privateReceiptFixture(helpers,{shared=false,valid=true,lostRepair=false}={}){
 const {reliabilityWorker,json,seedIndependentPresentation,independentProviderResponse,presentationAdmission}=helpers;
 const fixture=await reliabilityWorker();await fixture.drainBackground();
 fixture.sqlite.exec(readFileSync(new URL("../db/operations/budget-hold-dispositions.sql",import.meta.url),"utf8"));
 const documentId=await seedIndependentPresentation(fixture,"private-receipt-document");
 let headers={},project=null;
 if(shared){
   let response=await fixture.request("/api/workspaces",json({name:"Private receipt regression"}));
   if(response.status!==201)throw new Error(await response.text());
   const organizationId=(await response.json()).organizationId;
   response=await fixture.request(`/api/workspaces/${organizationId}/projects`,json({projectId:"project-atmosphere"}));
   if(response.status!==201)throw new Error(await response.text());
   const projectAccessId=(await response.json()).projectAccessId;
   response=await fixture.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST"});
   if(response.status!==200)throw new Error(await response.text());
   headers={cookie:response.headers.get("set-cookie").split(";")[0]};project={organizationId,projectAccessId};
 }
 const request=(path,init={})=>fixture.request(path,{...init,headers:{...headers,...Object.fromEntries(new Headers(init.headers))}});
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,init={})=>{
   if(String(url)!=="https://api.openai.com/v1/responses")throw new Error("Unexpected mocked provider");
   calls++;if(lostRepair&&calls===2)throw new Error("mock lost repair response");
   return Response.json({id:"private-receipt-"+calls,model:"gpt-5.6-terra",output_text:valid?JSON.stringify(independentProviderResponse(init.body)):"{}",usage:{input_tokens:120,output_tokens:45,total_tokens:165}});
 };
 let job;
 try{
   const response=await request("/api/document-jobs",json(presentationAdmission(documentId,"private-receipts")));
   if(response.status!==202)throw new Error(await response.text());
   job=(await response.json()).job;
   if(valid)fixture.sqlite.exec("CREATE TRIGGER private_receipt_persistence_control BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'synthetic_local_persistence_failure'); END");
   const failed=await request(`/api/document-jobs/${job.jobId}/run`,{method:"POST"});
   if(failed.status!==200)throw new Error(await failed.text());
   const failedJob=(await failed.json()).job;
   if(failedJob.status!=="failed")throw new Error(JSON.stringify(failedJob));
   if(valid)fixture.sqlite.exec("DROP TRIGGER private_receipt_persistence_control");
   await fixture.drainBackground();
 }finally{globalThis.fetch=originalFetch;}
 const detailPath=`/api/document-jobs/${job.jobId}/presentation-candidates/private-receipt-1`;
 return{...fixture,documentId,job,project,headers,request,detailPath,calls,
   readJob:()=>fixture.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(job.jobId),
   checkpoint:()=>JSON.parse(fixture.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json??"{}"),
   candidateRow:()=>fixture.sqlite.prepare("SELECT * FROM private_content WHERE kind='provider-response' AND json_extract(content,'$.response_id')='private-receipt-1'").get(),
   sourceRow:()=>fixture.sqlite.prepare("SELECT * FROM private_content WHERE kind='document-artifact-input' AND json_extract(content,'$.job_id')=?").get(job.jobId),
 };
};
await (async function registerPrivateReceiptTests(){
  const financialSnapshot=fixture=>JSON.stringify({
    costs:fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations ORDER BY reservation_id").all(),
    counters:fixture.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all(),
    tokens:fixture.sqlite.prepare("SELECT * FROM budget_reservations ORDER BY reservation_id").all(),
  });
  async function strictFixture(t,options={}){
    const fixture=await privateReceiptFixture(helpers,options);
    const metrics={maxBindings:0,maxSqlBytes:0},prepare=fixture.environment.DB.prepare;
    fixture.environment.DB.prepare=sql=>{
      metrics.maxSqlBytes=Math.max(metrics.maxSqlBytes,Buffer.byteLength(sql));
      assert.ok(Buffer.byteLength(sql)<=100_000,"D1 SQL text limit");
      const statement=prepare(sql),bind=statement.bind;
      statement.bind=function(...values){metrics.maxBindings=Math.max(metrics.maxBindings,values.length);return bind.call(this,...values);};
      return statement;
    };
    const depth=enforceD1ExpressionDepth({sqlite:fixture.sqlite,env:fixture.environment});
    const beforeFinancial=financialSnapshot(fixture),originalFetch=globalThis.fetch;let expectedFinancial=beforeFinancial;
    let forbiddenCalls=0;
    globalThis.fetch=async()=>{forbiddenCalls++;throw new Error("Private receipt inspection must not contact a provider");};
    t.after(async()=>{
      globalThis.fetch=originalFetch;
      await fixture.drainBackground();
      depth.assertVerified();depth.restore();
      assert.equal(forbiddenCalls,0);
      assert.equal(financialSnapshot(fixture),expectedFinancial,"private operations cannot change finances without exact settlement assertions");
      fixture.sqlite.close();
    });
    return{...fixture,depth,beforeFinancial,metrics,acceptVerifiedFinancialSnapshot(){expectedFinancial=financialSnapshot(fixture);}};
  }
  const [{retainPresentationCallResponse,retainLegacyPresentationFinancialReceipt},{paidProviderObserver},{priceCurrentOpenAITextUsage}]=await Promise.all([
    import("../worker/presentation-call-evidence.ts"),import("../worker/provider-submission.ts"),import("../worker/openai-text-cost.ts"),
  ]);
  const privateRows=fixture=>fixture.sqlite.prepare("SELECT * FROM private_content WHERE kind='provider-response' ORDER BY content_id").all();
  const publicationBatch=statements=>statements.some(statement=>statement.sql.includes("UPDATE document_jobs SET result_json=?")&&statement.sql.includes("result_json=? AND request_json=?"));
  const saveCheckpoint=(fixture,checkpoint)=>fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),fixture.job.jobId);
  async function pendingCallFixture(t,{status="running",shared=false,raw="Exact retained repair bytes: statement, source citation, and notes."}={}){
    const fixture=await strictFixture(t,{valid:false,lostRepair:true,shared}),row=fixture.readJob(),checkpoint=fixture.checkpoint();
    const pending=Object.values(checkpoint.providerSubmissions).filter(call=>call.status==="pending");assert.equal(pending.length,1);
    const usage={inputTokens:120,outputTokens:45,totalTokens:165,cachedInputTokens:0,cacheWriteTokens:0,reasoningTokens:10};
    const pricing=priceCurrentOpenAITextUsage(pending[0].model,usage);
    const call={...pending[0],status:"completed",providerRequestId:"private-receipt-2",inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,totalTokens:usage.totalTokens,
      cachedInputTokens:0,cacheWriteInputTokens:0,reasoningTokens:10,costMicrousd:pricing.totalMicrousd,textInputCostMicrousd:pricing.textInputMicrousd,textOutputCostMicrousd:pricing.textOutputMicrousd,
      pricingReceipt:pricing,usageCostBasis:pricing.costBasis,effectiveModel:pending[0].model,completionStatus:"completed",responseReceivedAt:new Date().toISOString(),validationStatus:"pending"};
    const contentSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))),value=>value.toString(16).padStart(2,"0")).join("");
    const original=checkpoint.presentationCandidates[0],{contentRef:_contentRef,contentExpiresAt:_contentExpiresAt,...metadata}=original;
    const candidate={...metadata,clientRequestId:call.clientRequestId,requestDigest:call.requestDigest,responseId:call.providerRequestId,model:call.model,usage:{inputTokens:120,outputTokens:45,totalTokens:165},
      candidateBytes:new TextEncoder().encode(raw).byteLength,candidateTruncated:false,contentSha256,capturedAt:call.responseReceivedAt,attemptStage:"repair",providerAttempt:2,locallyRecoverable:false};
    const envelope=JSON.stringify({...JSON.parse(fixture.candidateRow().content),schema_version:3,response_id:call.providerRequestId,model:call.model,call,usage:candidate.usage,content_sha256:contentSha256,output_text:raw,
      provider_attempt:2,attempt_stage:"repair",candidate_bytes:candidate.candidateBytes,candidate_truncated:false,completion_status:"completed",captured_at:call.responseReceivedAt});
    fixture.sqlite.prepare("UPDATE document_jobs SET status=?,completed_at=NULL,error_message=NULL,lease_expires_at=?,updated_at=? WHERE job_id=?")
      .run(status,new Date(Date.now()+75000).toISOString(),new Date().toISOString(),fixture.job.jobId);
    const identity={jobId:row.job_id,ownerId:row.owner_id,streamId:row.stream_id,correlationId:row.correlation_id};
    const projectScope=shared?{...fixture.project,projectId:"project-atmosphere",ownerUserId:row.owner_id,actorUserId:row.owner_id}:undefined;
    return{...fixture,identity,call,input:{documentId:row.document_id,envelope,candidate,call,projectScope},raw};
  }

  for(const shared of [false,true])test("private presentation call evidence: atomically publishes "+(shared?"shared":"personal")+" raw bytes, candidate and completed call",async t=>{
    const fixture=await pendingCallFixture(t,{shared}),originalBatch=fixture.environment.DB.batch,before=privateRows(fixture);let publications=0;
    fixture.environment.DB.batch=async statements=>{
      if(publicationBatch(statements)){
        publications++;assert.ok(statements.some(statement=>statement.sql.includes("INSERT INTO private_content")));
        assert.equal(fixture.checkpoint().providerSubmissions[fixture.call.clientRequestId].status,"pending");assert.equal(privateRows(fixture).length,before.length);
      }
      return originalBatch(statements);
    };
    const result=await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input),saved=fixture.checkpoint();
    assert.equal(publications,1);assert.equal(privateRows(fixture).length,before.length+1);
    const persisted=saved.providerSubmissions[fixture.call.clientRequestId];assert.equal(persisted.status,"completed");assert.equal(persisted.responseRef,result.candidate.contentRef);
    assert.equal(saved.presentationProviderSubmission,"confirmed");assert.equal(saved.presentationCandidates.filter(candidate=>candidate.clientRequestId===fixture.call.clientRequestId).length,1);
    const body=fixture.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(persisted.responseRef);assert.equal(body.content,fixture.input.envelope);
    assert.equal(JSON.parse(body.content).output_text,fixture.raw);assert.deepEqual(JSON.parse(body.content).call,fixture.call);
    if(shared)assert.equal(fixture.sqlite.prepare("SELECT project_access_id FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(body.content_id).project_access_id,fixture.project.projectAccessId);
  });

  test("private presentation call evidence: preserves empty incomplete-response evidence without inventing usable content",async t=>{
    const fixture=await pendingCallFixture(t,{raw:""});fixture.input.call={...fixture.call,completionStatus:"incomplete",incompleteReason:"max_output_tokens"};
    const envelope=JSON.parse(fixture.input.envelope);Object.assign(envelope,{call:fixture.input.call,completion_status:"incomplete",incomplete_reason:"max_output_tokens"});fixture.input.envelope=JSON.stringify(envelope);
    const saved=await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input),body=JSON.parse(fixture.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(saved.call.responseRef).content);
    assert.equal(body.output_text,"");assert.equal(body.completion_status,"incomplete");assert.equal(body.incomplete_reason,"max_output_tokens");assert.equal(body.call.costMicrousd,fixture.call.costMicrousd);
    assert.equal(saved.candidate.locallyRecoverable,false);
  });

  for(const shared of [false,true])test("private presentation call evidence: "+(shared?"shared":"personal")+" replay after a worker restart reuses the exact published response",async t=>{
    const fixture=await pendingCallFixture(t,{shared}),first=await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input),rows=JSON.stringify(privateRows(fixture)),checkpoint=fixture.readJob().result_json;
    const restarted=await import(new URL("../worker/presentation-call-evidence.ts",import.meta.url).href+"?private-receipt-restart="+crypto.randomUUID());
    const replay=await restarted.retainPresentationCallResponse(fixture.environment,fixture.identity,structuredClone(fixture.input));
    assert.deepEqual(replay.candidate,first.candidate);assert.equal(replay.call.responseRef,first.call.responseRef);assert.equal(JSON.stringify(privateRows(fixture)),rows);assert.equal(fixture.readJob().result_json,checkpoint);
  });

  test("private presentation call evidence: replay cannot reuse shared bytes after custody is revoked",async t=>{
    const fixture=await pendingCallFixture(t,{shared:true}),saved=await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input);
    fixture.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='another-actor' WHERE resource_kind='content' AND resource_id=?").run(saved.candidate.contentRef);
    const before=JSON.stringify(privateRows(fixture));await assert.rejects(retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input));assert.equal(JSON.stringify(privateRows(fixture)),before);
  });

  test("private presentation call evidence: recognizes committed raw and call publication after a lost acknowledgement",async t=>{
    const fixture=await pendingCallFixture(t),batch=fixture.environment.DB.batch,before=privateRows(fixture).length;let lost=false;
    fixture.environment.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&publicationBatch(statements)){lost=true;throw new Error("synthetic_publication_ack_lost");}return result;};
    const retained=await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input);assert.equal(lost,true);assert.equal(privateRows(fixture).length,before+1);
    const replay=await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input);assert.equal(replay.candidate.contentRef,retained.candidate.contentRef);assert.equal(privateRows(fixture).length,before+1);
  });

  test("private presentation call evidence: concurrent exact responses publish one private body and one call",async t=>{
    const fixture=await pendingCallFixture(t),before=privateRows(fixture).length;
    const results=await Promise.all([retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input),retainPresentationCallResponse(fixture.environment,fixture.identity,structuredClone(fixture.input))]);
    assert.equal(results[0].candidate.contentRef,results[1].candidate.contentRef);assert.equal(privateRows(fixture).length,before+1);
    assert.equal(fixture.checkpoint().presentationCandidates.filter(candidate=>candidate.clientRequestId===fixture.call.clientRequestId).length,1);
  });

  for(const changed of ["checkpoint","request","correlation"])test("private presentation call evidence: rolls back private bytes when "+changed+" changes before the publication CAS",async t=>{
    const fixture=await pendingCallFixture(t),batch=fixture.environment.DB.batch,before=JSON.stringify(privateRows(fixture));let raced=false;
    fixture.environment.DB.batch=async statements=>{
      if(!raced&&publicationBatch(statements)){
        raced=true;
        if(changed==="checkpoint")saveCheckpoint(fixture,{...fixture.checkpoint(),progressMessage:"newer execution checkpoint"});
        if(changed==="request")fixture.sqlite.prepare("UPDATE document_jobs SET request_json=json_set(request_json,'$.tone','newer request') WHERE job_id=?").run(fixture.job.jobId);
        if(changed==="correlation")fixture.sqlite.prepare("UPDATE document_jobs SET correlation_id=correlation_id||':newer' WHERE job_id=?").run(fixture.job.jobId);
      }
      return batch(statements);
    };
    await assert.rejects(retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input));assert.equal(raced,true);assert.equal(JSON.stringify(privateRows(fixture)),before);
    assert.equal(fixture.checkpoint().providerSubmissions[fixture.call.clientRequestId].status,"pending");
  });

  for(const target of ["job","body"])test("private presentation call evidence: silently ignored "+target+" writes abort the whole private publication",async t=>{
    const fixture=await pendingCallFixture(t),before=JSON.stringify(privateRows(fixture)),checkpoint=fixture.readJob().result_json;
    fixture.sqlite.exec(target==="job"?"CREATE TRIGGER reject_private_call_write BEFORE UPDATE OF result_json ON document_jobs WHEN NEW.status='running' AND json_extract(NEW.result_json,'$.presentationProviderSubmission')='confirmed' BEGIN SELECT RAISE(IGNORE); END":"CREATE TRIGGER reject_private_call_write BEFORE INSERT ON private_content WHEN NEW.kind='provider-response' BEGIN SELECT RAISE(IGNORE); END");
    await assert.rejects(retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input));assert.equal(JSON.stringify(privateRows(fixture)),before);assert.equal(fixture.readJob().result_json,checkpoint);
  });

  for(const field of ["costMicrousd","totalTokens","pricingReceipt"])test("private presentation call evidence: exact-response replay rejects altered "+field,async t=>{
    const fixture=await pendingCallFixture(t);await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input);
    const changed=structuredClone(fixture.input),before=fixture.readJob().result_json,rows=JSON.stringify(privateRows(fixture));
    if(field==="pricingReceipt")changed.call.pricingReceipt.ratesNanousdPerToken.input+=1;else changed.call[field]+=1;
    await assert.rejects(retainPresentationCallResponse(fixture.environment,fixture.identity,changed),/presentation_call|provider_submission/);
    assert.equal(fixture.readJob().result_json,before);assert.equal(JSON.stringify(privateRows(fixture)),rows);
  });

  for(const erased of ["redacted","expired","changed-bytes"])test("private presentation call evidence: replay never certifies "+erased+" private bytes as retained",async t=>{
    const fixture=await pendingCallFixture(t),saved=await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input);
    if(erased==="redacted")fixture.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(saved.candidate.contentRef);
    if(erased==="expired")fixture.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(saved.candidate.contentRef);
    if(erased==="changed-bytes")fixture.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(saved.candidate.contentRef);
    const before=JSON.stringify(privateRows(fixture));await assert.rejects(retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input));assert.equal(JSON.stringify(privateRows(fixture)),before,"replay must not restore erased or replaced content");
  });

  for(const status of ["failed","canceled"])test("private presentation call evidence: late "+status+" financial receipt is source-free and monotonic",async t=>{
    const fixture=await pendingCallFixture(t,{status}),checkpoint=fixture.checkpoint();
    const submissions=Object.fromEntries(Object.entries(checkpoint.providerSubmissions).map(([id,{responseRef,validationStatus,validationIssueCount,...call}])=>[id,call]));
    saveCheckpoint(fixture,{providerSubmissionProtocol:1,providerSubmissions:submissions,presentationProviderSubmission:"pending",presentationProviderClientRequestId:fixture.call.clientRequestId});
    fixture.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2000-01-01T00:00:00.000Z' WHERE owner_id=?").run(fixture.identity.ownerId);
    fixture.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(fixture.identity.ownerId);
    const before=JSON.stringify(privateRows(fixture)),incoming={...fixture.call,responseRef:"DO_NOT_RESTORE_PRIVATE_REF",rawResponse:"DO_NOT_RESTORE_SOURCE_TEXT",output_text:"DO_NOT_RESTORE_OUTPUT",validationStatus:"invalid",validationIssueCount:2};
    await retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,incoming);
    const saved=fixture.checkpoint(),call=saved.providerSubmissions[fixture.call.clientRequestId];assert.equal(call.status,"completed");assert.equal(call.costMicrousd,fixture.call.costMicrousd);assert.equal(call.requestDigest,fixture.call.requestDigest);
    assert.equal(fixture.readJob().status,status);assert.doesNotMatch(JSON.stringify(saved),/DO_NOT_RESTORE|responseRef|rawResponse|output_text|validationStatus|validationIssueCount/);
    const exact=fixture.readJob().result_json;await retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,incoming);await retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,{...fixture.call,status:"pending"});await retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,{...fixture.call,status:"accepted"});
    assert.equal(fixture.readJob().result_json,exact);assert.equal(JSON.stringify(privateRows(fixture)),before);
    await assert.rejects(retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,{...fixture.call,costMicrousd:fixture.call.costMicrousd+1}),/provider_submission_cost_changed/);
    await assert.rejects(retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,{...fixture.call,status:"uncertain"}),/provider_submission/);
    await assert.rejects(retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,{...fixture.call,clientRequestId:"not-admitted"}),/presentation_call_evidence_not_admitted/);
    await assert.rejects(retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input),/presentation_call_retention_unavailable/);
    assert.equal(fixture.readJob().result_json,exact);assert.equal(JSON.stringify(privateRows(fixture)),before);
  });

  test("private presentation call evidence: a restarted worker cannot buy another request while the exact repair is pending",async t=>{
    const fixture=await strictFixture(t,{valid:false,lostRepair:true}),before=fixture.checkpoint(),pending=Object.values(before.providerSubmissions).find(call=>call.status==="pending");assert.ok(pending);
    fixture.sqlite.prepare("UPDATE document_jobs SET status='running',completed_at=NULL,lease_expires_at='2000-01-01T00:00:00.000Z',updated_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(fixture.job.jobId);
    assert.equal((await fixture.request("/api/document-jobs/"+fixture.job.jobId+"/run",{method:"POST"})).status,200);
    assert.equal((await fixture.request("/api/document-jobs/"+fixture.job.jobId+"/retry",{method:"POST"})).status,409);
    const after=fixture.checkpoint();assert.deepEqual(after.providerSubmissions[pending.clientRequestId],pending);assert.equal(Object.keys(after.providerSubmissions).length,Object.keys(before.providerSubmissions).length);
    assert.equal(after.presentationProviderSubmission,"pending");assert.equal(fixture.readJob().status,"failed");
  });

  test("private presentation call evidence: a restarted observer rejects another client ID for an already-recorded logical unit",async t=>{
    const fixture=await strictFixture(t,{valid:false,lostRepair:true}),persisted=await fixture.environment.DB.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").bind(fixture.job.jobId).first(),checkpoint=JSON.parse(persisted.result_json);let progresses=0,observes=0;
    const observer=paidProviderObserver(structuredClone(checkpoint),async()=>{progresses++;},{},async()=>{observes++;},{presentation:true});
    for(const call of Object.values(checkpoint.providerSubmissions))await assert.rejects(observer({...call,status:"pending",clientRequestId:"replacement-"+call.clientRequestId}),/presentation_paid_call_already_recorded/);
    assert.equal(progresses,0);assert.equal(observes,0);
  });

  for(const status of ["pending","accepted"])test("private presentation call evidence: stale same-client "+status+" observation never reintroduces legacy uncertainty",async t=>{
    const fixture=await pendingCallFixture(t);await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input);
    const checkpoint=fixture.checkpoint(),patches=[];
    const observer=paidProviderObserver(checkpoint,async(_stage,_message,patch)=>{patches.push(patch);},{},undefined,{presentation:true});
    await observer({...fixture.call,status});
    assert.equal(checkpoint.providerSubmissions[fixture.call.clientRequestId].status,"completed");assert.equal(checkpoint.presentationProviderSubmission,"confirmed");
    assert.ok(patches.every(patch=>patch.presentationProviderSubmission!=="pending"));
  });

  test("private presentation call evidence: late completed initial observation never hides the current pending repair",async t=>{
    const fixture=await strictFixture(t,{valid:false,lostRepair:true}),checkpoint=fixture.checkpoint(),calls=Object.values(checkpoint.providerSubmissions),initial=calls.find(call=>call.status==="completed"),pending=calls.find(call=>call.status==="pending"),patches=[];
    assert.ok(initial);assert.ok(pending);assert.equal(checkpoint.presentationProviderClientRequestId,pending.clientRequestId);
    const observer=paidProviderObserver(checkpoint,async(_stage,_message,patch)=>{patches.push(patch);},{},undefined,{presentation:true});await observer(initial);
    assert.equal(checkpoint.providerSubmissions[pending.clientRequestId].status,"pending");assert.equal(checkpoint.presentationProviderSubmission,"pending");assert.equal(checkpoint.presentationProviderClientRequestId,pending.clientRequestId);
    assert.ok(patches.every(patch=>patch.presentationProviderSubmission==="pending"&&patch.presentationProviderClientRequestId===pending.clientRequestId));
    await retainLegacyPresentationFinancialReceipt(fixture.environment,{jobId:fixture.readJob().job_id,ownerId:fixture.readJob().owner_id,streamId:fixture.readJob().stream_id,correlationId:fixture.readJob().correlation_id},initial);
    assert.equal(fixture.checkpoint().presentationProviderSubmission,"pending");assert.equal(fixture.checkpoint().presentationProviderClientRequestId,pending.clientRequestId);
  });
  const reconcilePresentation=fixture=>fixture.request(`/api/document-jobs/${fixture.job.jobId}/reconcile-provider`,{method:"POST"});
  const reconciliationAudits=fixture=>fixture.sqlite.prepare("SELECT event_id,type,payload FROM events WHERE correlation_id=? AND type IN('GenerationUsageRecorded','BudgetReleased','PresentationProviderReceiptsReconciled') ORDER BY sequence").all(fixture.readJob().correlation_id);
  const routeFinancialSnapshot=fixture=>JSON.stringify({financial:JSON.parse(financialSnapshot(fixture)),tokenCounters:fixture.sqlite.prepare("SELECT * FROM budget_counters ORDER BY scope,scope_id,period").all()});
  const isSettlementBatch=statements=>statements.some(statement=>/^UPDATE budget_counters SET /u.test(statement.sql));
  const isReconciliationPublication=statements=>statements.some(statement=>statement.sql.includes("UPDATE document_jobs SET result_json=?,error_message=?,updated_at=?"));
  const routePrivateMarker="PRIVATE_RECONCILIATION_SOURCE_MUST_NOT_ESCAPE";
  const assertSourceFreeReconciliation=(response,payload)=>{
    assert.match(response.headers.get("cache-control")??"",/private/u);assert.match(response.headers.get("cache-control")??"",/no-store/u);
    const body=JSON.stringify(payload);assert.equal(body.includes(routePrivateMarker),false);assert.doesNotMatch(body,/Exact retained repair bytes|PRIVATE_AUTHORED_SLIDE|"(?:output_text|document_snapshot|providerSubmissions|presentationCandidates|sourceAliasMap)"\s*:/u);
    assert.equal(payload.reconciliation.providerRequestsSubmitted,0);
  };
  async function completeReconciliationFixture(t,{shared=false}={}){
    const fixture=await pendingCallFixture(t,{shared});await retainPresentationCallResponse(fixture.environment,fixture.identity,fixture.input);
    const checkpoint=fixture.checkpoint();checkpoint.presentationProviderSubmission="pending";
    saveCheckpoint(fixture,checkpoint);
    fixture.sqlite.prepare("UPDATE document_jobs SET status='failed',error_message='provider_submission_uncertain',completed_at=?,lease_expires_at=NULL WHERE job_id=?").run(new Date().toISOString(),fixture.job.jobId);
    const calls=Object.values(checkpoint.providerSubmissions),usedTokens=calls.reduce((total,call)=>total+call.totalTokens,0),usedMicrousd=calls.reduce((total,call)=>total+call.costMicrousd,0);
    assert.equal(calls.length,2);assert.ok(calls.every(call=>call.status==="completed"));
    assert.equal(reconciliationAudits(fixture).filter(event=>event.type==="GenerationUsageRecorded").length,0);
    return{...fixture,usedTokens,usedMicrousd};
  }
  const assertExactReconciliationAccounting=fixture=>{
    const checkpoint=fixture.checkpoint(),cost=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=?").get(checkpoint.costReservationId),token=fixture.sqlite.prepare("SELECT * FROM budget_reservations WHERE reservation_id=?").get(checkpoint.reservationId);
    assert.equal(cost.status,"settled");assert.equal(cost.used_microusd,fixture.usedMicrousd);assert.equal(token.status,"settled");assert.equal(token.used_tokens,fixture.usedTokens);
    const usage=reconciliationAudits(fixture).filter(event=>event.type==="GenerationUsageRecorded").map(event=>JSON.parse(event.payload));
    assert.equal(usage.length,1);assert.equal(usage[0].cost_microusd,fixture.usedMicrousd);assert.equal(usage[0].total_tokens,fixture.usedTokens);
    for(const row of fixture.sqlite.prepare("SELECT * FROM cost_budget_counters").all()){assert.equal(row.reserved_microusd,0);assert.equal(row.used_microusd,fixture.usedMicrousd);}
    for(const row of fixture.sqlite.prepare("SELECT * FROM budget_counters").all()){assert.equal(row.reserved_tokens,0);assert.equal(row.used_tokens,fixture.usedTokens);}
  };

  for(const variant of ["pending-repair","missing-repair","legacy-v2"])test("private presentation reconciliation route: retained initial plus "+variant+" stays operator-required without releasing its hold",async t=>{
    const fixture=await strictFixture(t,{valid:false,lostRepair:true}),checkpoint=fixture.checkpoint(),pending=Object.values(checkpoint.providerSubmissions).find(call=>call.status==="pending");assert.ok(pending);assert.ok(fixture.candidateRow());
    if(variant==="missing-repair")delete checkpoint.providerSubmissions[pending.clientRequestId];
    if(variant==="legacy-v2"){delete checkpoint.providerSubmissions;delete checkpoint.providerSubmissionProtocol;const envelope=JSON.parse(fixture.candidateRow().content);envelope.schema_version=2;delete envelope.call;fixture.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(envelope),fixture.candidateRow().content_id);}
    saveCheckpoint(fixture,checkpoint);const before=routeFinancialSnapshot(fixture),job=fixture.readJob().result_json,audits=JSON.stringify(reconciliationAudits(fixture)),raw=JSON.stringify(privateRows(fixture));
    const response=await reconcilePresentation(fixture);assert.equal(response.status,200,await response.clone().text());const payload=await response.json();assertSourceFreeReconciliation(response,payload);
    assert.equal(payload.reconciliation.status,"operator_required");assert.equal(payload.reconciliation.reservationRetained,true);assert.equal(payload.reconciliation.currentClientRequestId,pending.clientRequestId);
    assert.match(payload.reconciliation.operatorAction,/Do not resubmit an unknown request/u);assert.equal(payload.job.result.generationReceipt.provider_request_status,"submission_unknown");
    assert.equal(routeFinancialSnapshot(fixture),before);assert.equal(fixture.readJob().result_json,job);assert.equal(JSON.stringify(reconciliationAudits(fixture)),audits);assert.equal(JSON.stringify(privateRows(fixture)),raw);
  });

  for(const shared of [false,true])test("private presentation reconciliation route: "+(shared?"shared":"personal")+" exact completed calls settle and audit once across concurrent and repeated checks",async t=>{
    const fixture=await completeReconciliationFixture(t,{shared}),raw=JSON.stringify(privateRows(fixture));
    const responses=await Promise.all([reconcilePresentation(fixture),reconcilePresentation(fixture)]);
    for(const response of responses){assert.equal(response.status,200,await response.clone().text());const payload=await response.json();assertSourceFreeReconciliation(response,payload);assert.equal(payload.reconciliation.status,"known");assert.equal(payload.reconciliation.usedTokens,fixture.usedTokens);assert.equal(payload.reconciliation.usedMicrousd,fixture.usedMicrousd);assert.equal(payload.job.result.generationReceipt.provider_submission_uncertain,false);}
    assertExactReconciliationAccounting(fixture);assert.equal(reconciliationAudits(fixture).filter(event=>event.type==="BudgetReleased").length,1);assert.equal(reconciliationAudits(fixture).filter(event=>event.type==="PresentationProviderReceiptsReconciled").length,1);
    const settled=routeFinancialSnapshot(fixture),audits=JSON.stringify(reconciliationAudits(fixture)),checkpoint=fixture.readJob().result_json;
    const again=await reconcilePresentation(fixture);assert.equal(again.status,200,await again.clone().text());const payload=await again.json();assertSourceFreeReconciliation(again,payload);assert.equal(payload.reconciliation.settled,false);assert.equal(payload.reconciliation.auditRepaired,false);
    assert.equal(routeFinancialSnapshot(fixture),settled);assert.equal(JSON.stringify(reconciliationAudits(fixture)),audits);assert.equal(fixture.readJob().result_json,checkpoint);assert.equal(JSON.stringify(privateRows(fixture)),raw);
    fixture.acceptVerifiedFinancialSnapshot();
  });

  test("private presentation reconciliation route: exact settled ledgers repair a missing usage audit without another charge",async t=>{
    const fixture=await completeReconciliationFixture(t),checkpoint=fixture.checkpoint(),{settleBudget,settleCostBudget}=await import("../worker/pilot-policy.ts");
    await settleBudget(fixture.environment,fixture.identity.ownerId,checkpoint.reservationId,fixture.usedTokens);
    await settleCostBudget(fixture.environment,fixture.identity.ownerId,checkpoint.costReservationId,fixture.usedMicrousd);
    const before=routeFinancialSnapshot(fixture),response=await reconcilePresentation(fixture);assert.equal(response.status,200,await response.clone().text());const payload=await response.json();assertSourceFreeReconciliation(response,payload);
    assert.equal(payload.reconciliation.status,"known");assert.equal(payload.reconciliation.settled,false);assert.equal(payload.reconciliation.auditRepaired,true);assertExactReconciliationAccounting(fixture);assert.equal(routeFinancialSnapshot(fixture),before);
    const audits=JSON.stringify(reconciliationAudits(fixture)),again=await reconcilePresentation(fixture);assert.equal(again.status,200);assert.equal((await again.json()).reconciliation.auditRepaired,false);assert.equal(JSON.stringify(reconciliationAudits(fixture)),audits);assert.equal(routeFinancialSnapshot(fixture),before);
    fixture.acceptVerifiedFinancialSnapshot();
  });

  const reconciliationAuthorityChanges=[
    ["personal consent",false,fixture=>fixture.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(fixture.identity.ownerId)],
    ["personal job custody",false,fixture=>fixture.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES('changed-project','job',?,'changed-organization','project-atmosphere',?,'actor_private',NULL,?,?)").run(fixture.job.jobId,fixture.identity.ownerId,fixture.identity.ownerId,new Date().toISOString())],
    ["selected project session",true,fixture=>fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at='2000-01-01T00:00:00.000Z' WHERE principal_user_id=? AND project_access_id=?").run(fixture.identity.ownerId,fixture.project.projectAccessId)],
    ["current project",true,fixture=>fixture.sqlite.prepare("UPDATE organization_projects SET status='archived' WHERE project_access_id=?").run(fixture.project.projectAccessId)],
  ];
  for(const[label,shared,revoke]of reconciliationAuthorityChanges)test("private presentation reconciliation route: "+label+" changed at financial commit fails closed",async t=>{
    const fixture=await completeReconciliationFixture(t,{shared}),batch=fixture.environment.DB.batch,before=routeFinancialSnapshot(fixture),checkpoint=fixture.readJob().result_json,audits=JSON.stringify(reconciliationAudits(fixture));let raced=false;
    fixture.environment.DB.batch=async statements=>{if(!raced&&isSettlementBatch(statements)){raced=true;revoke(fixture);}return batch(statements);};
    const response=await reconcilePresentation(fixture);assert.equal(raced,true,"race must occur after admission, at the guarded accounting batch");assert.equal(response.status,403,await response.clone().text());assert.doesNotMatch(await response.text(),/PRIVATE_AUTHORED_SLIDE|providerSubmissions|output_text/u);
    assert.equal(routeFinancialSnapshot(fixture),before);assert.equal(fixture.readJob().result_json,checkpoint);assert.equal(JSON.stringify(reconciliationAudits(fixture)),audits);
  });

  test("private presentation reconciliation route: a running legacy job cannot be reconciled",async t=>{
    const fixture=await pendingCallFixture(t),before=routeFinancialSnapshot(fixture),response=await reconcilePresentation(fixture);assert.equal(response.status,409);assert.equal((await response.json()).error,"presentation_reconciliation_terminal_required");assert.equal(routeFinancialSnapshot(fixture),before);
  });

  test("private presentation reconciliation route: an Output-bound read is redirected to native reconciliation",async t=>{
    const fixture=await completeReconciliationFixture(t),prepare=fixture.environment.DB.prepare,before=routeFinancialSnapshot(fixture);let boundRead=false;
    // The native slot is an alias on readJob, not a document_jobs column. Inject
    // that read boundary without fabricating an execution grant in this fixture.
    fixture.environment.DB.prepare=sql=>{const statement=prepare(sql);if(sql.includes("AS output_slot_id FROM document_jobs WHERE job_id=? AND owner_id=?")){const bind=statement.bind;statement.bind=function(...values){const bound=bind.apply(this,values),first=bound.first;bound.first=async function(){const row=await first.call(this);if(row){boundRead=true;return{...row,output_slot_id:"existing-native-slot"};}return row;};return bound;};}return statement;};
    const response=await reconcilePresentation(fixture);assert.equal(boundRead,true);assert.equal(response.status,409);assert.equal((await response.json()).error,"output_receipt_reconciliation_required");assert.equal(routeFinancialSnapshot(fixture),before);
  });

  test("private presentation reconciliation route: shared operator responses exclude nested source content and private references",async t=>{
    const fixture=await strictFixture(t,{shared:true,valid:false,lostRepair:true}),checkpoint=fixture.checkpoint();
    Object.assign(checkpoint,{candidateRaw:routePrivateMarker,plannerInput:{...checkpoint.plannerInput,sourceSnapshot:routePrivateMarker},moderationPromptRef:routePrivateMarker,members:[{jobId:"private-child",prompt:routePrivateMarker,error:{message:routePrivateMarker},moderationPromptRef:routePrivateMarker}]});saveCheckpoint(fixture,checkpoint);
    const response=await reconcilePresentation(fixture);assert.equal(response.status,200,await response.clone().text());const payload=await response.json();assertSourceFreeReconciliation(response,payload);assert.equal(payload.reconciliation.status,"operator_required");assert.equal(payload.job.moderationPromptRef??null,null);assert.deepEqual(payload.job.members??[],[]);
  });

  test("private presentation reconciliation route: a lost receipt-publication acknowledgement is exact replay, not another settlement",async t=>{
    const fixture=await completeReconciliationFixture(t),batch=fixture.environment.DB.batch;let lost=false;
    fixture.environment.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&isReconciliationPublication(statements)){lost=true;throw new Error("synthetic_reconciliation_publication_ack_lost");}return result;};
    const response=await reconcilePresentation(fixture);assert.equal(response.status,200,await response.clone().text());const payload=await response.json();assertSourceFreeReconciliation(response,payload);assert.equal(payload.reconciliation.status,"known");assert.equal(lost,true);assertExactReconciliationAccounting(fixture);
    const before=routeFinancialSnapshot(fixture),audits=JSON.stringify(reconciliationAudits(fixture)),again=await reconcilePresentation(fixture);assert.equal(again.status,200);assert.equal((await again.json()).reconciliation.settled,false);assert.equal(routeFinancialSnapshot(fixture),before);assert.equal(JSON.stringify(reconciliationAudits(fixture)),audits);fixture.acceptVerifiedFinancialSnapshot();
  });

  const assertPrivateHeaders=response=>{
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.equal(response.headers.get("x-content-type-options"),"nosniff");
  };
  const readCandidate=async fixture=>{
    const response=await fixture.request(fixture.detailPath);assert.equal(response.status,200,await response.clone().text());
    assertPrivateHeaders(response);const body=await response.json();
    assert.doesNotMatch(JSON.stringify(body),/"(?:original_validation|preserved_accounting|accountingEvidence|source_content_id|source_receipt_sha256|content_sha256|source_content)"\s*:/u);
    return body.candidate;
  };
  const preserve=async fixture=>{
    const response=await fixture.request(fixture.detailPath+"/preserve",{method:"POST"});
    assert.equal(response.status,200,await response.clone().text());assertPrivateHeaders(response);return(await response.json()).candidate;
  };
  async function expireViaNativeCleanup(fixture){
    fixture.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(fixture.job.jobId);
    const response=await fixture.request("/api/document-jobs/"+fixture.job.jobId+"/retry",{method:"POST"});
    assert.equal(response.status,409,"an expired paid slideshow is not a new provider request");
    return fixture.readJob();
  }

  for(const shared of[false,true])test("private presentation receipts: live "+(shared?"shared":"personal")+" detail and preservation certify after auditing",async t=>{
    const fixture=await strictFixture(t,{shared}),trace=[],originalBatch=fixture.environment.DB.batch;
    fixture.environment.DB.batch=async statements=>{
      trace.push(...statements.map(statement=>statement.sql.includes("candidate_custody AS MATERIALIZED")?"private-final":
        statement.values?.[11]==="PresentationCandidateReviewed"?"review-audit":"other"));
      return originalBatch(statements);
    };
    const before=await readCandidate(fixture);
    assert.equal(before.complete,true);assert.equal(before.generatedSlideCount,12);
    assert.equal(before.accounting.settled_cost_microusd,780);
    assert.equal(before.accounting.settled_cost_complete,true);
    assert.equal(before.accounting.reservation_microusd,0);
    assert.equal(before.accounting.reservation_status,"settled");
    assert.equal(before.accounting.attempted_provider_call_count,1);
    assert.equal(before.citationChecks.flatMap(check=>check.passages).length,12);
    assert.ok(trace.indexOf("review-audit")>=0);
    assert.ok(trace.lastIndexOf("private-final")>trace.indexOf("review-audit"),"the final disclosure proof follows the audit await");
    const retained=await preserve(fixture),row=fixture.candidateRow(),envelope=JSON.parse(row.content);
    assert.equal(retained.complete,true);assert.equal(envelope.original_validation.outcome,"accepted");
    assert.equal(envelope.original_validation.source_content_id,fixture.sourceRow().content_id);
    assert.equal(envelope.preserved_accounting.accounting.settled_cost_complete,true);
    await preserve(fixture);
    assert.equal(fixture.candidateRow().content,row.content,"repeat preservation neither renews retention nor rewrites original evidence");
    assert.equal((await readCandidate(fixture)).complete,true);
    const list=await fixture.request("/api/document-jobs/"+fixture.job.jobId+"/presentation-candidates");
    assert.equal(list.status,200);assert.equal((await list.json()).candidates.length,1);
    const discovery=await fixture.request("/api/document-jobs/presentation-candidates?document="+fixture.documentId);
    assert.equal(discovery.status,200);assert.equal((await discovery.json()).jobs.length,1);
    const ordinary=await fixture.request("/api/document-jobs");
    assert.equal(ordinary.status,200);
    assert.doesNotMatch(await ordinary.text(),/"(?:original_validation|preserved_accounting|accountingEvidence|citationChecks|accounting)"\s*:/u);
    assert.ok(fixture.depth.records.some(record=>record.sql.includes("AS presentation_preservation_verified")));
    t.diagnostic(JSON.stringify({strictDepth:100,statements:fixture.depth.records.length,...fixture.metrics}));
  });

  const retentionPrivateMarker="PRIVATE_PRICE_TOMBSTONE_SOURCE_MUST_NOT_RETURN";
  const financialCallsWithoutPrivateRefs=checkpoint=>Object.fromEntries(Object.entries(checkpoint.providerSubmissions).map(([id,{responseRef,validationStatus,validationIssueCount,...financial}])=>[id,financial]));
  async function financialRetentionFixture(t,{completed=true}={}){
    const fixture=await pendingCallFixture(t),pricingReceipt=priceCurrentOpenAITextUsage(fixture.call.model,{...fixture.call.pricingReceipt.usage,reasoningTokens:null});
    const call={...fixture.call,pricingReceipt};delete call.reasoningTokens;
    const input={...fixture.input,call,envelope:JSON.stringify({...JSON.parse(fixture.input.envelope),call})};
    if(completed)await retainPresentationCallResponse(fixture.environment,fixture.identity,input);
    const checkpoint=fixture.checkpoint();Object.assign(checkpoint,{candidateRaw:retentionPrivateMarker,plannerInput:{...checkpoint.plannerInput,sourceSnapshot:retentionPrivateMarker},privateRetentionProbe:retentionPrivateMarker});
    saveCheckpoint(fixture,checkpoint);
    fixture.sqlite.prepare("UPDATE document_jobs SET status='failed',lease_expires_at=NULL,completed_at=?,request_json=json_set(request_json,'$.audience',?) WHERE job_id=?").run(new Date().toISOString(),retentionPrivateMarker,fixture.job.jobId);
    const expectedCalls=financialCallsWithoutPrivateRefs(checkpoint),{hasUnsettledProviderSubmission}=await import("../src/model/provider-submission.ts");
    assert.equal(hasUnsettledProviderSubmission(checkpoint),!completed);assert.equal(checkpoint.presentationProviderSubmission,completed?"confirmed":"pending");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(checkpoint.reservationId).status,"active");
    assert.equal(fixture.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(checkpoint.costReservationId).status,"executing");
    return{...fixture,call,input,expectedCalls};
  }
  const assertFrozenFinancialTombstone=(fixture,expectedCalls)=>{
    const checkpoint=fixture.checkpoint();assert.deepEqual(checkpoint.providerSubmissions,expectedCalls,"cleanup preserves every frozen financial field, including the complete pricing receipt");
    assert.deepEqual(JSON.parse(fixture.readJob().request_json),{artifactKind:"slides"});
    assert.equal(fixture.readJob().result_json.includes(retentionPrivateMarker),false);
    assert.doesNotMatch(fixture.readJob().result_json,/"(?:responseRef|contentRef|providerResponseRef|presentationCandidates|plannerInput|candidateRaw|source_snapshot_sha256|input_ref)"\s*:/u);
    for(const row of fixture.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE owner_id=? AND kind!='document-artifact'").all(fixture.identity.ownerId)){assert.equal(row.content,"");assert.ok(row.redacted_at);}
    for(const call of Object.values(checkpoint.providerSubmissions).filter(call=>call.status==="completed")){assert.ok(Object.hasOwn(call.pricingReceipt.usage,"reasoningTokens"));assert.equal(call.pricingReceipt.usage.reasoningTokens,null);}
    const repair=checkpoint.providerSubmissions[fixture.call.clientRequestId];
    if(repair.status==="completed"){assert.ok(Object.hasOwn(repair.pricingReceipt,"requestPolicy"));assert.equal(repair.pricingReceipt.requestPolicy,null);}
    return checkpoint;
  };
  const erasePersonalFinancialFixture=async fixture=>{
    const response=await fixture.request("/api/privacy/events",helpers.json({action:"erase-personal-authored-context",confirmation:"ERASE_MY_PERSONAL_AUTHORED_CONTEXT"}));
    assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const settleFrozenFinancialFixture=async fixture=>{
    const {settleLegacyPresentationReservations}=await import("../worker/pilot-policy.ts"),calls=Object.values(fixture.checkpoint().providerSubmissions);
    const settled=await settleLegacyPresentationReservations(fixture.environment,{userId:fixture.identity.ownerId,streamId:fixture.identity.streamId},fixture.readJob());
    assert.equal(settled.status,"known");assert.equal(settled.settled,true);
    assert.equal(settled.usedTokens,calls.reduce((total,call)=>total+call.totalTokens,0));assert.equal(settled.usedMicrousd,calls.reduce((total,call)=>total+call.costMicrousd,0));
    return financialSnapshot(fixture);
  };

  for(const cleanup of ["expiry","personal erasure"])test("private presentation financial tombstones: "+cleanup+" retains full frozen pricing after call completion but before settlement",async t=>{
    const fixture=await financialRetentionFixture(t),before=financialSnapshot(fixture);
    let protectedJob=null;
    if(cleanup==="personal erasure"){
      // A current document-custody row protects even a legacy job whose own
      // project job anchor is absent; personal erasure cannot adopt that scope.
      const row={...fixture.readJob(),job_id:"project-custody-control",document_id:"project-document-control"},columns=Object.keys(row);
      fixture.sqlite.prepare(`INSERT INTO document_jobs(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`).run(...Object.values(row));
      fixture.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES('retention-project','document',?,'retention-organization','retention-project',?,'actor_private',NULL,?,?)").run(row.document_id,fixture.identity.ownerId,fixture.identity.ownerId,new Date().toISOString());
      protectedJob=JSON.stringify(fixture.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(row.job_id));
    }
    if(cleanup==="expiry"){
      const {EXPIRED_DOCUMENT_JOB_REDACTION_SQL}=await import("../worker/document-jobs-api.ts"),{sweepExpiredPrivateContent}=await import("../worker/runtime.ts");
      fixture.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(fixture.job.jobId);
      fixture.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE owner_id=? AND kind!='document-artifact'").run(fixture.identity.ownerId);
      // Exercise the actual exported retention transition without allowing a
      // retry/admission handler to settle away this crash window first.
      await fixture.environment.DB.prepare(`UPDATE document_jobs SET ${EXPIRED_DOCUMENT_JOB_REDACTION_SQL} WHERE job_id=? AND expires_at<=?`).bind(fixture.job.jobId,new Date().toISOString()).run();
      assert.ok(await sweepExpiredPrivateContent(fixture.environment)>0);
      assertFrozenFinancialTombstone(fixture,fixture.expectedCalls);
      const once=fixture.readJob().result_json;
      await fixture.environment.DB.prepare(`UPDATE document_jobs SET ${EXPIRED_DOCUMENT_JOB_REDACTION_SQL} WHERE job_id=?`).bind(fixture.job.jobId).run();
      assert.equal(fixture.readJob().result_json,once,"repeat expiry is a tombstone replay, not another loss of pricing evidence");
    }else{
      // An older installation can have paid legacy jobs but no native Output
      // tables. No empty legacy-job update may be reported as a grant revocation.
      const tables=fixture.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'output_%' ORDER BY rowid DESC").all();assert.ok(tables.length>0);
      for(const{name}of tables){assert.match(name,/^output_[a-z0-9_]+$/u);assert.equal(fixture.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count,0);fixture.sqlite.exec(`DROP TABLE ${name}`);}
      const erased=await erasePersonalFinancialFixture(fixture);assert.ok(erased.erasedTemporaryContent>0);assert.equal(erased.revokedOutputGrantCount,0);assertFrozenFinancialTombstone(fixture,fixture.expectedCalls);
      const once=fixture.readJob().result_json;await erasePersonalFinancialFixture(fixture);assert.equal(fixture.readJob().result_json,once);
    }
    assert.equal(financialSnapshot(fixture),before,"receipt completion does not authorize retention to release an unsettled hold");
    if(protectedJob!==null){assert.equal(JSON.stringify(fixture.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id='project-custody-control'").get()),protectedJob,"personal erasure must leave current project custody unchanged");return;}
    const financiallySettled=await settleFrozenFinancialFixture(fixture),{EXPIRED_DOCUMENT_JOB_REDACTION_SQL}=await import("../worker/document-jobs-api.ts");
    await fixture.environment.DB.prepare(`UPDATE document_jobs SET ${EXPIRED_DOCUMENT_JOB_REDACTION_SQL} WHERE job_id=?`).bind(fixture.job.jobId).run();
    assert.equal(fixture.readJob().result_json,null,"fully settled financial evidence no longer extends private job retention");assert.equal(fixture.readJob().request_json,"{}");assert.equal(financialSnapshot(fixture),financiallySettled);
    fixture.acceptVerifiedFinancialSnapshot();
  });

  test("private presentation financial tombstones: late completion after erasure keeps its original tariff, nulls and amount across repeated updates",async t=>{
    const fixture=await financialRetentionFixture(t,{completed:false}),before=financialSnapshot(fixture);
    fixture.sqlite.prepare("UPDATE document_jobs SET status='running',completed_at=NULL,lease_expires_at=? WHERE job_id=?").run(new Date(Date.now()+75000).toISOString(),fixture.job.jobId);
    await erasePersonalFinancialFixture(fixture);assertFrozenFinancialTombstone(fixture,fixture.expectedCalls);assert.equal(fixture.readJob().status,"canceled");assert.equal(fixture.readJob().lease_expires_at,null);
    fixture.environment.OPENAI_MODEL="gpt-5.6-sol";
    const originalTariff=structuredClone(fixture.call.pricingReceipt),incoming={...fixture.call,responseRef:retentionPrivateMarker,rawResponse:retentionPrivateMarker,validationStatus:"invalid",validationIssueCount:1};
    await retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,incoming);
    const expected={...fixture.expectedCalls,...financialCallsWithoutPrivateRefs({providerSubmissions:{[fixture.call.clientRequestId]:fixture.call}})};assertFrozenFinancialTombstone(fixture,expected);
    assert.deepEqual(fixture.checkpoint().providerSubmissions[fixture.call.clientRequestId].pricingReceipt,originalTariff);assert.equal(fixture.checkpoint().providerSubmissions[fixture.call.clientRequestId].costMicrousd,fixture.call.costMicrousd);
    const once=fixture.readJob().result_json;await retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,incoming);assert.equal(fixture.readJob().result_json,once,"exact late financial replay preserves meaningful nested nulls");
    const repriced=structuredClone(incoming);repriced.pricingReceipt.ratesNanousdPerToken.input+=1;
    await assert.rejects(retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,repriced),/provider_submission_pricing_changed/u);
    await assert.rejects(retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,{...incoming,costMicrousd:incoming.costMicrousd+1}),/provider_submission_cost_changed/u);
    assert.equal(fixture.readJob().result_json,once);
    await erasePersonalFinancialFixture(fixture);assertFrozenFinancialTombstone(fixture,expected);
    await retainLegacyPresentationFinancialReceipt(fixture.environment,fixture.identity,incoming);assertFrozenFinancialTombstone(fixture,expected);
    assert.equal(financialSnapshot(fixture),before);
    const financiallySettled=await settleFrozenFinancialFixture(fixture);await erasePersonalFinancialFixture(fixture);
    assert.equal(fixture.readJob().result_json,null);assert.equal(fixture.readJob().request_json,"{}");assert.equal(financialSnapshot(fixture),financiallySettled);fixture.acceptVerifiedFinancialSnapshot();
  });
  const boundaryChanges=[
    ["principal revision",fixture=>{fixture.sqlite.prepare("UPDATE users SET updated_at='2099-01-01T00:00:00.000Z' WHERE user_id='dev-local-creative'").run();}],
    ["principal role",fixture=>{fixture.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id='dev-local-creative'").run();}],
    ["selected session",fixture=>{fixture.sqlite.prepare("UPDATE project_context_sessions SET revoked_at='2000-01-01T00:00:00.000Z' WHERE principal_user_id='dev-local-creative'").run();}],
    ["selected session expiry",fixture=>{fixture.sqlite.prepare("UPDATE project_context_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE principal_user_id='dev-local-creative'").run();}],
    ["source retention",fixture=>{fixture.sqlite.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(fixture.sourceRow().content_id);}],
    ["source custody",fixture=>{fixture.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='another-actor' WHERE resource_kind='content' AND resource_id=?").run(fixture.sourceRow().content_id);}],
    ["candidate erased",fixture=>{fixture.sqlite.prepare("UPDATE private_content SET redacted_at='2000-01-01T00:00:00.000Z',content='' WHERE content_id=?").run(fixture.candidateRow().content_id);}],
    ["source erased",fixture=>{fixture.sqlite.prepare("UPDATE private_content SET redacted_at='2000-01-01T00:00:00.000Z',content='' WHERE content_id=?").run(fixture.sourceRow().content_id);}],
    ["source expired",fixture=>{fixture.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(fixture.sourceRow().content_id);}],
    ["candidate byte change",fixture=>{fixture.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(fixture.candidateRow().content_id);}],
    ["source byte change",fixture=>{fixture.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(fixture.sourceRow().content_id);}],
    ["project archived",fixture=>{fixture.sqlite.prepare("UPDATE organization_projects SET status='archived' WHERE project_access_id=?").run(fixture.project.projectAccessId);}],
    ["checkpoint replaced",fixture=>{const checkpoint=fixture.checkpoint();checkpoint.generationReceipt.provider_request_status="submission_unknown";fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),fixture.job.jobId);}],
  ];
  for(const[label,change]of boundaryChanges)test("private presentation receipts: final live proof denies synthetic "+label,async t=>{
    const fixture=await strictFixture(t,{shared:true}),originalBatch=fixture.environment.DB.batch;
    let boundaryObserved=false;
    fixture.environment.DB.batch=async statements=>{
      if(!boundaryObserved&&statements.some(statement=>statement.sql.includes("SELECT candidate_custody.*"))){
        boundaryObserved=true;change(fixture);
      }
      return originalBatch(statements);
    };
    const response=await fixture.request(fixture.detailPath);
    assert.equal(boundaryObserved,true,"the actual Worker must perform a final private-read certification");
    assert.equal(response.status,404);assertPrivateHeaders(response);
    assert.doesNotMatch(await response.text(),/RESPONSIVE ASSESSMENT|STAKEHOLDER EVIDENCE|citationChecks|passages/u);
  });


  test("private presentation receipts: current accounting transition invalidates an earlier settled display",async t=>{
    const fixture=await strictFixture(t),originalBatch=fixture.environment.DB.batch;
    const original=fixture.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE correlation_id=?").get(fixture.readJob().correlation_id);
    let observed=false;
    fixture.environment.DB.batch=async statements=>{
      if(!observed&&statements.some(statement=>statement.sql.includes("SELECT candidate_custody.*"))){
        observed=true;fixture.sqlite.prepare("UPDATE cost_budget_reservations SET status='executing',used_microusd=0 WHERE reservation_id=?").run(original.reservation_id);
      }
      return originalBatch(statements);
    };
    try{
      const response=await fixture.request(fixture.detailPath);
      assert.equal(observed,true);assert.equal(response.status,404);
      const current=await readCandidate(fixture);
      assert.equal(current.accounting.settled_cost_complete,false);
      assert.equal(current.accounting.reservation_status,"executing");
      assert.equal(current.accounting.reservation_microusd,original.reserved_microusd);
    }finally{
      fixture.sqlite.prepare("UPDATE cost_budget_reservations SET status=?,used_microusd=? WHERE reservation_id=?")
        .run(original.status,original.used_microusd,original.reservation_id);
    }
  });

  test("private presentation receipts: preservation atomically rejects stale original source bytes",async t=>{
    const fixture=await strictFixture(t,{shared:true}),originalBatch=fixture.environment.DB.batch;
    const before=fixture.candidateRow(),checkpoint=fixture.readJob().result_json;
    let changed=false;
    fixture.environment.DB.batch=async statements=>{
      if(!changed&&statements.some(statement=>statement.sql.includes("AS presentation_preservation_verified"))){
        changed=true;fixture.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(fixture.sourceRow().content_id);
      }
      return originalBatch(statements);
    };
    const response=await fixture.request(fixture.detailPath+"/preserve",{method:"POST"});
    assert.equal(changed,true);assert.equal(response.status,404);
    assert.equal(fixture.candidateRow().content,before.content);
    assert.equal(fixture.candidateRow().expires_at,before.expires_at);
    assert.equal(fixture.readJob().result_json,checkpoint);
    assert.equal(fixture.sqlite.prepare("SELECT classification FROM private_content_retention_scopes WHERE content_id=?").get(before.content_id).classification,"transient-private");
  });

  test("private presentation receipts: unchanged exact evidence survives unrelated principal changes",async t=>{
    const fixture=await strictFixture(t,{shared:true}),originalBatch=fixture.environment.DB.batch;
    let seen=false;
    fixture.environment.DB.batch=async statements=>{
      if(!seen&&statements.some(statement=>statement.sql.includes("SELECT candidate_custody.*"))){
        seen=true;fixture.sqlite.prepare("UPDATE users SET updated_at='2000-01-01T00:00:00.000Z' WHERE user_id!='dev-local-creative'").run();
      }
      return originalBatch(statements);
    };
    assert.equal((await readCandidate(fixture)).complete,true);assert.equal(seen,true);
  });

  for(const version of["2026-08-26-source-aware-render-v4","historical-v1",undefined])test("private presentation receipts: original rejection survives native preservation and cleanup "+String(version),async t=>{
    const fixture=await strictFixture(t),checkpoint=fixture.checkpoint();
    checkpoint.generationReceipt.presentation_adapter_version=version;
    checkpoint.generationReceipt.failure_stage="source_fidelity_validation";
    checkpoint.generationReceipt.failure_code="source_fidelity_validation_failed";
    checkpoint.errorDetail={...checkpoint.errorDetail,code:"source_fidelity_validation_failed"};
    // Faithful legacy state: current parsing passes, but the retained historical job rejected it.
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),fixture.job.jobId);
    const before=await readCandidate(fixture);
    assert.equal(before.issues.length,0);assert.equal(before.complete,false);
    assert.equal(before.reviewOnlyReason,"historical-validation-rejection");
    await preserve(fixture);
    const original=JSON.parse(fixture.candidateRow().content).original_validation;
    assert.equal(original.outcome,"rejected");assert.equal(original.adapter_version,version??null);
    assert.equal((await expireViaNativeCleanup(fixture)).result_json,null);
    const afterCleanup=await readCandidate(fixture);
    assert.equal(afterCleanup.complete,false);assert.equal(afterCleanup.reviewOnlyReason,"historical-validation-rejection");
    assert.equal(afterCleanup.accounting.settled_cost_microusd,780);assert.equal(afterCleanup.accounting.settled_cost_complete,true);
    const response=await fixture.request("/api/document-jobs/presentation-candidates?document="+fixture.documentId);
    assert.equal(response.status,200);
    assert.equal((await response.json()).jobs[0].candidates[0].complete,false);
    await preserve(fixture);
    assert.deepEqual(JSON.parse(fixture.candidateRow().content).original_validation,original);
    const recovery=await fixture.request("/api/document-jobs/"+fixture.job.jobId+"/recover",{method:"POST"});
    assert.equal(recovery.status,409,"retained private review never promotes an expired/rejected result");
  });


  for(const variant of["exact-success","missing-validation-id","changed-original-source","explicit-rejection"])
  test("private presentation receipts: cached recovery flags cannot replace the exact original verdict "+variant,async t=>{
    const fixture=await strictFixture(t),checkpoint=fixture.checkpoint();
    checkpoint.recoverablePresentationCandidate=false;
    checkpoint.presentationCandidates=checkpoint.presentationCandidates.map(candidate=>({...candidate,locallyRecoverable:false}));
    if(variant==="missing-validation-id")checkpoint.plannerInput.validation.provider_response_ids=[];
    if(variant==="changed-original-source")checkpoint.generationReceipt.source_snapshot_sha256="different-original-source";
    if(variant==="explicit-rejection"){
      checkpoint.generationReceipt.failure_stage="source_fidelity_validation";
      checkpoint.generationReceipt.failure_code="source_fidelity_validation_failed";
    }
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),fixture.job.jobId);
    const candidate=await readCandidate(fixture);
    assert.equal(candidate.issues.length,0,"passing current parsing is deliberately not an original verdict");
    assert.equal(candidate.complete,variant==="exact-success");
    await preserve(fixture);
    const original=JSON.parse(fixture.candidateRow().content).original_validation;
    assert.equal(original.outcome,variant==="exact-success"?"accepted":variant==="explicit-rejection"?"rejected":"unconfirmed");
    await expireViaNativeCleanup(fixture);
    assert.equal((await readCandidate(fixture)).complete,variant==="exact-success");
  });


  test("private presentation receipts: later checkpoint success cannot override a preserved original rejection on recovery",async t=>{
    const fixture=await strictFixture(t),originalCheckpoint=fixture.checkpoint();
    const rejected=structuredClone(originalCheckpoint);
    rejected.generationReceipt.presentation_adapter_version="historical-v1";
    rejected.generationReceipt.failure_stage="source_fidelity_validation";
    rejected.generationReceipt.failure_code="source_fidelity_validation_failed";
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(rejected),fixture.job.jobId);
    await preserve(fixture);
    const afterPreserve=fixture.checkpoint(),original=JSON.parse(fixture.candidateRow().content).original_validation;
    // A later checkpoint may update eligibility metadata; it does not replace the preserved verdict.
    const later={...originalCheckpoint,presentationCandidates:afterPreserve.presentationCandidates};
    fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(later),fixture.job.jobId);
    const candidate=await readCandidate(fixture);
    assert.equal(candidate.complete,false);assert.equal(candidate.reviewOnlyReason,"historical-validation-rejection");
    const response=await fixture.request("/api/document-jobs/"+fixture.job.jobId+"/recover",{method:"POST"});
    assert.equal(response.status,409);assert.equal((await response.json()).reason,"historical_validation_rejection");
    assert.equal(fixture.readJob().status,"failed");
    assert.deepEqual(JSON.parse(fixture.candidateRow().content).original_validation,original);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted'").get().count,0);
  });

  test("private presentation receipts: accepted local-persistence evidence survives native cleanup",async t=>{
    const fixture=await strictFixture(t);
    assert.equal((await readCandidate(fixture)).complete,true);
    await preserve(fixture);
    const row=fixture.candidateRow();
    assert.equal((await expireViaNativeCleanup(fixture)).result_json,null);
    const candidate=await readCandidate(fixture);
    assert.equal(candidate.complete,true);assert.equal(candidate.reviewOnlyReason,undefined);
    assert.equal(candidate.accounting.settled_cost_complete,true);
    assert.equal(fixture.candidateRow().content,row.content);
  });

  test("private presentation receipts: live accepted local-persistence result remains recoverable without another charge",async t=>{
    const fixture=await strictFixture(t);
    await preserve(fixture);
    const response=await fixture.request("/api/document-jobs/"+fixture.job.jobId+"/recover",{method:"POST"});
    assert.equal(response.status,200,await response.clone().text());
    assert.equal((await response.json()).job.status,"completed");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.document_id')=?").get(fixture.documentId).count,1);
  });

  for(const corruption of["absent","wrong-source"])test("private presentation receipts: legacy "+corruption+" verdict never becomes an acceptance certificate",async t=>{
    const fixture=await strictFixture(t);await preserve(fixture);
    const row=fixture.candidateRow(),envelope=JSON.parse(row.content);
    if(corruption==="absent"){delete envelope.original_validation;delete envelope.preserved_accounting;}
    else envelope.original_validation.source_content_id="unmatched-original-source";
    fixture.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(envelope),row.content_id);
    assert.equal((await readCandidate(fixture)).complete,false,"missing/mismatched governed provenance is unconfirmed even while the transient checkpoint still exists");
    const recovery=await fixture.request("/api/document-jobs/"+fixture.job.jobId+"/recover",{method:"POST"});
    assert.equal(recovery.status,409);assert.equal((await recovery.json()).reason,"original_validation_provenance_unavailable");
    await expireViaNativeCleanup(fixture);
    const candidate=await readCandidate(fixture);
    assert.equal(candidate.complete,false);assert.equal(candidate.reviewOnlyReason,"validation-provenance-unavailable");
    assert.equal(candidate.settledCostMicrousd,780,"verified historical charges are not erased by missing verdict provenance");
  });

  for(const lostRepair of[false,true])test("private presentation receipts: "+(lostRepair?"lost bounded repair retains unknown settlement and its hold":"two confirmed paid responses retain their complete charge"),async t=>{
    const fixture=await strictFixture(t,{valid:false,lostRepair});
    assert.equal(fixture.calls,2);
    const candidate=await readCandidate(fixture),accounting=candidate.accounting;
    assert.equal(candidate.complete,false);assert.equal(candidate.providerAttempt,1);
    assert.equal(accounting.attempted_provider_call_count,2);
    assert.equal(accounting.actual_provider_call_count,lostRepair?1:2);
    assert.equal(accounting.unresolved_provider_call_count,lostRepair?1:0);
    assert.equal(accounting.provider_submission_uncertain,lostRepair);
    assert.equal(accounting.settled_cost_microusd,lostRepair?null:1560);
    assert.equal(accounting.settled_cost_complete,!lostRepair);
    assert.equal(accounting.reservation_microusd,lostRepair?1_000_000:0);
    assert.equal(accounting.reservation_status,lostRepair?"executing":"settled");
    assert.equal(candidate.settledCostMicrousd,lostRepair?null:1560);
    await preserve(fixture);
    await expireViaNativeCleanup(fixture);
    const retained=(await readCandidate(fixture)).accounting;
    assert.equal(retained.attempted_provider_call_count,2);
    assert.equal(retained.unresolved_provider_call_count,lostRepair?1:0);
    assert.equal(retained.settled_cost_complete,!lostRepair);
    assert.equal(retained.reservation_microusd,lostRepair?1_000_000:0);
  });

  test("private presentation receipts: router method, origin and selected-context fences remain native",async t=>{
    const fixture=await strictFixture(t,{shared:true});
    for(const[extension,method]of[["","POST"],["/preserve","GET"]]){
      const response=await fixture.request(fixture.detailPath+extension,{method});
      assert.equal(response.status,405);
    }
    const crossOrigin=await fixture.request(fixture.detailPath+"/preserve",{method:"POST",headers:{origin:"https://not-forma.example"}});
    assert.equal(crossOrigin.status,403);
    const noSelection=await fixture.request(fixture.detailPath,{headers:{cookie:""}});
    assert.equal(noSelection.status,404);
  });

  const emptyEvidence={reservations:[],usage:[],responseIds:["known-original-response"],minimumAttempt:1,preserved:[]};
  test("private presentation accounting: missing receipts are unknown, never a final free amount",()=>{
    const accounting=presentationCandidateAccounting({},emptyEvidence);
    assert.equal(accounting.settled_cost_microusd,null);assert.equal(accounting.settled_cost_complete,false);
    assert.equal(accounting.reservation_microusd,null);assert.equal(accounting.reservation_status,"unknown");
    assert.equal(accounting.attempted_provider_call_count,null);assert.equal(accounting.unresolved_provider_call_count,null);
    assert.equal(accounting.provider_submission_uncertain,true);
  });
  test("private presentation accounting: confirmed identities alone cannot prove every attempted call",()=>{
    const accounting=presentationCandidateAccounting({plannerResponseIds:["known-original-response"]},
      {...emptyEvidence,reservations:[{reservation_id:"original",status:"settled",reserved_microusd:1_000_000,used_microusd:500}]});
    assert.equal(accounting.settled_cost_microusd,500);assert.equal(accounting.settled_cost_complete,false);
    assert.equal(accounting.unresolved_provider_call_count,null);assert.equal(accounting.provider_submission_uncertain,true);
  });
  test("private presentation accounting: verified partial usage stays separate from unresolved held work",()=>{
    const checkpoint={presentationProviderSubmission:"pending",plannerResponseIds:["known-original-response"],
      generationReceipt:{provider_request_status:"submission_unknown",actual_provider_call_count:1,settled_cost_microusd:null}};
    const accounting=presentationCandidateAccounting(checkpoint,{...emptyEvidence,
      reservations:[{reservation_id:"held",status:"executing",reserved_microusd:1_000_000,used_microusd:0}],
      usage:[{cost_reservation_id:"earlier",cost_microusd:500}]});
    assert.equal(accounting.settled_cost_microusd,500);assert.equal(accounting.settled_cost_complete,false);
    assert.equal(accounting.reservation_microusd,1_000_000);assert.equal(accounting.attempted_provider_call_count,2);
    assert.equal(accounting.unresolved_provider_call_count,1);
  });
  for(const malformed of[null,"0",-1,Infinity,NaN])test("private presentation accounting: malformed charge "+String(malformed)+" cannot certify zero",()=>{
    const accounting=presentationCandidateAccounting({presentationProviderSubmission:"confirmed",plannerResponseIds:["known-original-response"]},
      {...emptyEvidence,reservations:[{reservation_id:"invalid",status:"settled",reserved_microusd:1_000_000,used_microusd:malformed}],
        usage:[{cost_reservation_id:"invalid",cost_microusd:malformed}]});
    assert.equal(accounting.settled_cost_microusd,null);assert.equal(accounting.settled_cost_complete,false);
    assert.equal(accounting.reservation_microusd,null);assert.equal(accounting.reservation_status,"unknown");
  });
  test("private presentation accounting: explicit settled zero is distinct from missing or reserved zero",()=>{
    const accounting=presentationCandidateAccounting({presentationProviderSubmission:"confirmed",plannerResponseIds:["known-original-response"]},
      {...emptyEvidence,reservations:[{reservation_id:"zero",status:"settled",reserved_microusd:1_000_000,used_microusd:0}]});
    assert.equal(accounting.settled_cost_microusd,0);assert.equal(accounting.settled_cost_complete,true);
    assert.equal(accounting.reservation_microusd,0);assert.equal(accounting.unresolved_provider_call_count,0);
  });
  test("private presentation provenance: original rejection dominates an earlier positive local flag",()=>{
    const checkpoint={generationReceipt:{presentation_adapter_version:"historical-v1",failure_stage:"source_fidelity_validation"}};
    assert.equal(presentationCandidateOriginalValidation(checkpoint,true).outcome,"rejected");
    assert.equal(presentationCandidateOriginalValidation({},false).outcome,"unconfirmed");
    assert.equal(presentationCandidateOriginalValidation({generationReceipt:{failure_stage:"application"}},true).outcome,"accepted");
  });
})();
