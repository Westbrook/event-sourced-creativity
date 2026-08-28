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
    const beforeFinancial=financialSnapshot(fixture),originalFetch=globalThis.fetch;
    let forbiddenCalls=0;
    globalThis.fetch=async()=>{forbiddenCalls++;throw new Error("Private receipt inspection must not contact a provider");};
    t.after(async()=>{
      globalThis.fetch=originalFetch;
      await fixture.drainBackground();
      depth.assertVerified();depth.restore();
      assert.equal(forbiddenCalls,0);
      assert.equal(financialSnapshot(fixture),beforeFinancial,"private reads/preservation do not reconcile or release reservations");
      fixture.sqlite.close();
    });
    return{...fixture,depth,beforeFinancial,metrics};
  }
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
