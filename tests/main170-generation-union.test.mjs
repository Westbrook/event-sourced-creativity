import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { outputTestDatabase, registerOutputSourceImports } from "./output-execution-test-helpers.mjs";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { instrumentD1Contract } from "./output-d1-test-contract.mjs";
import { snapshot, outputFor, flexible } from "./output-presentation-fixtures.mjs";
import { saveDeck } from "./output-native-journey-test-helpers.mjs";
import { createPolicyStoppedSceneFixture } from "./helpers/scene-policy-stop-fixture.mjs";
const resolution=registerOutputSourceImports();
const [
  { default: worker }, { POLICY_VERSION }, { appendAuditEvent, streamHead },
  { generateDocumentArtifact, PRESENTATION_ADAPTER_VERSION },
]=await Promise.all([
  import("../worker/index.ts"),import("../worker/pilot-policy.ts"),import("../worker/runtime.ts"),
  import("../worker/openai-adapter.ts"),
]).finally(()=>resolution.deregister());

const sha=value=>createHash("sha256").update(value).digest("hex");
const post=body=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});

async function outputFixture(t,{shared=false}={}){
  const f=outputTestDatabase(),pending=[];
  Object.assign(f.env,{OPENAI_API_KEY:"memory-main170-union",OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"});
  const scope={headers:{}};
  const request=(path,options={})=>worker.fetch(new Request("http://localhost"+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),...scope.headers}}),f.env,{waitUntil(promise){pending.push(promise);}});
  assert.equal((await request("/api/session")).status,200);
  f.sqlite.prepare("UPDATE users SET consent_version=?").run(POLICY_VERSION);
  assert.equal((await request("/api/events")).status,200);
  while(pending.length)await Promise.all(pending.splice(0));
  const stream="creative:dev-local-creative",documentId="main170-union-document",projectId="project-atmosphere";
  await appendAuditEvent(f.env,stream,"user","DocumentCreated",{document_id:documentId,project_id:projectId,title:"Canonical union test source"});
  for(const[index,fact]of snapshot().facts.filter(fact=>String(fact.type).toLowerCase()!=="output").entries()){
    await appendAuditEvent(f.env,stream,"user","BlockCreated",{document_id:documentId,project_id:projectId,block_id:fact.block_id,type:fact.type,handle:fact.block_id,position:String(index),properties:{...fact.properties,weight:1,...(fact.intent?{intent:fact.intent}:{})}});
  }
  if(shared){
    const organization=await request("/api/workspaces",post({name:"Union fixture workspace"}));assert.equal(organization.status,201,await organization.clone().text());
    const organizationId=(await organization.json()).organizationId;
    const project=await request("/api/workspaces/"+organizationId+"/projects",post({projectId}));assert.equal(project.status,201,await project.clone().text());
    const projectAccessId=(await project.json()).projectAccessId;
    const context=await request("/api/workspaces/"+organizationId+"/projects/"+projectAccessId+"/context",{method:"POST"});assert.equal(context.status,200,await context.clone().text());
    scope.headers={cookie:context.headers.get("set-cookie").split(";")[0]};
    assert.equal((await request("/api/events")).status,200);
  }
  while(pending.length)await Promise.all(pending.splice(0));
  const d1=instrumentD1Contract(f),depth=enforceD1ExpressionDepth(f);
  t.after(async()=>{
    while(pending.length)await Promise.all(pending.splice(0));
    depth.assertVerified();assert.deepEqual(d1.violations,[]);assert.ok(d1.maximumBindings<=100);
    t.diagnostic(JSON.stringify({nativeDepth:100,queries:depth.records.length,maximumBindings:d1.maximumBindings,maximumFunctionArguments:d1.maximumFunctionArguments,maximumSqlBytes:d1.maximumSqlBytes}));
    depth.restore();f.sqlite.close();
  });
  let sequence=0;
  const send=async body=>request("/api/output-requirements",post({documentId,expectedRevision:"output:"+await streamHead(f.env,stream),clientMutationId:"union-command-"+(++sequence),...body}));
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  return{...f,documentId,request,send,ok};
}

for(const shared of[false,true])test("main170 union: routed Output deck preserves native binding/observer and exact approval, shared="+shared,async t=>{
  const requests=[];
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");requests.push({body:JSON.parse(options.body),clientRequestId:new Headers(options.headers).get("X-Client-Request-Id"),raw:options.body});
    return Response.json({id:"main170-union-deck",model:"gpt-5.6-terra",output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
  });
  const f=await outputFixture(t,{shared}),plan=await saveDeck(f);
  const preflight=await f.ok(await f.send({action:"preflight",planRevisionId:plan.planId,targetIds:[plan.targetId]})),terms=preflight.command.preflight;
  assert.equal(requests.length,0);
  const accepted=await f.ok(await f.send({action:"authorize",preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true}));
  const slot=f.sqlite.prepare("SELECT * FROM output_operation_slots").get();
  assert.equal(requests.length,0);assert.equal(slot.status,"authorized");
  const beforeStart=await f.request("/api/document-jobs/"+slot.job_id+"/run",post({}));
  assert.equal(beforeStart.status,202);assert.equal(requests.length,0,"job drive cannot invent Output Start");
  await f.ok(await f.send({action:"run",grantId:accepted.command.grantId}));
  const executed=await f.request("/api/document-jobs/"+slot.job_id+"/run",post({}));
  assert.equal(executed.status,200,await executed.clone().text());
  const job=(await executed.json()).job;
  assert.equal(job.status,"completed",JSON.stringify(job));assert.equal(requests.length,1);
  const raw=f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(slot.job_id),checkpoint=JSON.parse(raw.result_json);
  assert.equal(raw.source_surface,"outputs");assert.equal(raw.attempt_count,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_provider_calls").get().n,1);
  assert.equal(f.sqlite.prepare("SELECT status FROM output_operation_slots").get().status,"succeeded");
  const entry=Object.values(checkpoint.providerSubmissions)[0];
  assert.equal(entry.unitId,"planning:0:initial");assert.equal(entry.status,"completed");
  assert.equal(entry.clientRequestId,requests[0].clientRequestId);
  const call=f.sqlite.prepare("SELECT * FROM output_provider_calls").get();
  assert.equal(call.call_key,"planning:0:initial");assert.equal(call.request_digest,sha(requests[0].raw));
  assert.equal(requests[0].body.text.format.schema.properties.items.minItems,5);
  assert.equal(requests[0].body.text.format.schema.properties.items.maxItems,15);
  const input=JSON.parse(requests[0].body.input);
  assert.equal(input.presentation_source.slideCountPolicy.kind,"flexible");
  assert.doesNotMatch(JSON.stringify(input.creative_context),/podcast|TikTok|slideshow with/u);
  assert.doesNotMatch(input.output_requirements.instructions,/podcast|TikTok/u);
  assert.equal(checkpoint.generationReceipt.presentation_adapter_version,PRESENTATION_ADAPTER_VERSION);
  assert.match(PRESENTATION_ADAPTER_VERSION,/v6$/u,"accepted source/anchor reconciliation stays in force");
  const bound=await f.ok(await f.send({action:"bind",planRevisionId:plan.planId,targetId:plan.targetId,nativeJobId:slot.job_id}));
  assert.equal(bound.snapshot.results[0].checksStatus,"passed");assert.equal(bound.snapshot.results[0].review,"pending","generation is not review/approval");
  await f.request("/api/document-jobs/"+slot.job_id+"/run",post({}));assert.equal(requests.length,1,"same job retrieval never purchases a replacement");
});

for(const mode of["manual","managed"])for(const medium of["visual","audio"])test("main170 union: Scene "+mode+"/"+medium+" retains exact server-only local-stop receipt and fresh free recovery",async t=>{
  let actualCalls=0;t.mock.method(globalThis,"fetch",async()=>{actualCalls++;throw new Error("pre-dispatch policy stop must not transmit");});
  const f=await createPolicyStoppedSceneFixture({mode,medium,count:9,shared:false,pilot:false,mutate:state=>state.sqlite.prepare("UPDATE budget_counters SET hard_limit_tokens=1 WHERE scope='user'").run()});
  t.after(()=>f.close());
  assert.equal(actualCalls,0);
  const checkpoint=f.checkpoint(),entries=Object.values(checkpoint.providerSubmissions);
  assert.equal(entries.length,1);assert.deepEqual(Object.keys(entries[0]).sort(),["clientRequestId","costMicrousd","model","operation","provider","status"].sort());
  assert.equal(entries[0].status,"rejected");assert.equal(entries[0].costMicrousd,0);
  assert.equal(f.stopped.body.job.result.errorDetail.code,"scene_paid_authority_changed");
  assert.equal(f.stopped.body.job.result.generationReceipt.actual_provider_call_count,0);
  assert.equal(f.stopped.body.job.result.generationReceipt.source_transmission_status,"not_transmitted");
  assert.equal(f.stopped.body.job.result.scenePolicyStopSummary,undefined,"the private historical certificate is not public");
  assert.equal(f.cost()[0].status,"released");assert.equal(f.cost()[0].used_microusd,0);
  assert.equal(f.tokens()[0].status,"released");assert.equal(f.tokens()[0].used_tokens,0);
  const before=f.controls.writes.length,inspected=await f.preview();
  assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));
  assert.equal(inspected.body.sceneCostExisting.requestId,f.requestId);
  assert.equal(inspected.body.sceneCostExisting.safeUnused.reason,"policy-stopped-before-dispatch");
  assert.equal(f.controls.writes.length,before,"new Output initialization must not turn free Scene inspection into a write");
  assert.equal(actualCalls,0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);
});

test("main170 union: manual Slides use both main logical-call proof and accepted synchronous dispatch hook",async t=>{
  const observed=[],preflights=[],submissions=[];
  let raw="";
  t.mock.method(globalThis,"fetch",async(url,options)=>{assert.equal(String(url),"https://api.openai.com/v1/responses");observed.push("fetch");raw=options.body;return Response.json({id:"union-direct-response",model:"gpt-5.6-terra",output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
  const result=await generateDocumentArtifact({OPENAI_API_KEY:"in-memory-adapter",OPENAI_MODEL:"gpt-5.6-terra"},"union-actor","slides",{documentTitle:"Exact source",snapshot:snapshot(),options:{itemCount:8,slideCountPolicy:flexible,
    outputTargetInstructions:"Produce only the selected executive Slides target.",
    onBeforeProviderAttempt:async attempt=>{observed.push("preflight");preflights.push(attempt);},
    onProviderSubmission:async receipt=>{observed.push(receipt.status);submissions.push(receipt);await Promise.resolve();},
    onBeforeProviderDispatch:()=>{observed.push("dispatch");assert.deepEqual(observed,["preflight","pending","dispatch"]);},
  }});
  assert.equal(result.output.items.length,9);assert.deepEqual(observed.slice(0,4),["preflight","pending","dispatch","fetch"]);
  assert.equal(preflights.length,1);assert.equal(preflights[0].requestDigest,sha(raw));assert.equal(preflights[0].logicalCallKey,"planning:0:initial");
  assert.ok(submissions.every(entry=>entry.clientRequestId===preflights[0].clientRequestId&&entry.unitId==="planning:0:initial"));
  assert.equal(submissions.at(-1).status,"completed");
});
