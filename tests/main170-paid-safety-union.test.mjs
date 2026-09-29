import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, afterEach, beforeEach } from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-execution-test-helpers.mjs";
import { instrumentD1Contract } from "./output-d1-test-contract.mjs";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

const resolution=registerOutputSourceImports();
after(()=>resolution.deregister());
const [policy,runtime,consent,outputs,admission,{handleEvents},{handleWorkspaces}]=await Promise.all([
  import("../worker/pilot-policy.ts"),import("../worker/runtime.ts"),import("../worker/consequential-consent.ts"),
  import("../worker/output-requirements-ledger.ts"),import("../worker/output-admission-reads.ts"),
  import("../worker/events-api.ts"),import("../worker/workspaces-api.ts"),
]);
let savedFetch,networkCalls=0;
beforeEach(()=>{savedFetch=globalThis.fetch;networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw new Error("paid_safety_union_network_forbidden");};});
afterEach(()=>{globalThis.fetch=savedFetch;assert.equal(networkCalls,0,"ledger tests must never dispatch a provider");});
const proof={fixtures:0,queries:new Set(),maximumBindings:0,maximumSqlBytes:0};
after(()=>console.log(JSON.stringify({paidSafetyUnion:{fixtures:proof.fixtures,nativeDepth100Queries:proof.queries.size,maximumBindings:proof.maximumBindings,maximumSqlBytes:proof.maximumSqlBytes}})));
const json=body=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
const quoted=name=>'"'+name.replaceAll('"','""')+'"';
const insert=(f,table,row)=>{const entries=Object.entries(row);return f.sqlite.prepare("INSERT INTO "+quoted(table)+"("+entries.map(([key])=>quoted(key)).join(",")+") VALUES("+entries.map(()=>"?").join(",")+")").run(...entries.map(([,value])=>value));};
const row=(f,table,id,key="reservation_id")=>({...f.sqlite.prepare("SELECT * FROM "+quoted(table)+" WHERE "+quoted(key)+"=?").get(id)});
const financial=f=>Object.fromEntries(["budget_reservations","cost_budget_reservations","budget_counters","cost_budget_counters","project_budget_reservation_scopes","pilot_cost_reservation_scopes"].map(table=>[table,f.sqlite.prepare("SELECT * FROM "+quoted(table)+" ORDER BY rowid").all().map(value=>({...value}))]));
// Only settled replay / a blocked final release may refresh counter metadata; all reservation rows and accounting values must remain exact.
const withoutCounterRefresh=state=>Object.fromEntries(Object.entries(state).map(([table,rows])=>[table,table==="budget_counters"||table==="cost_budget_counters"?rows.map(({updated_at,...values})=>values):rows]));
const retained=f=>Object.fromEntries(["private_content","project_resource_scopes","private_content_retention_scopes","consequential_executions"].map(table=>[table,f.sqlite.prepare("SELECT * FROM "+quoted(table)+" ORDER BY rowid").all().map(value=>({...value}))]));

async function fixture(t,{shared=false}={}){
  const f=outputTestDatabase(),owner="dev-local-creative",streamId="creative:"+owner,projectId="project-atmosphere",documentId="paid-safety-union";
  assert.equal((await policy.handleSession(new Request("http://localhost/api/session"),f.env)).status,200);
  f.sqlite.prepare("UPDATE users SET consent_version=?").run(policy.POLICY_VERSION);
  f.sqlite.exec(readFileSync(new URL("../drizzle/0020_assistant_runtime_tables.sql",import.meta.url),"utf8"));
  assert.equal((await handleEvents(new Request("http://localhost/api/events"),f.env)).status,200);
  await runtime.appendAuditEvent(f.env,streamId,"user","DocumentCreated",{project_id:projectId,document_id:documentId,title:"Existing bounded work"});
  let headers={},projectScope=null,contextId=null;
  if(shared){
    const send=(path,body)=>handleWorkspaces(new Request("http://localhost/api/workspaces"+(path.length?"/"+path.join("/"):""),body?json(body):{method:"POST"}),f.env,path);
    const organization=await send([],{name:"Paid safety union"});assert.equal(organization.status,201,await organization.clone().text());const organizationId=(await organization.json()).organizationId;
    const attached=await send([organizationId,"projects"],{projectId});assert.equal(attached.status,201,await attached.clone().text());const projectAccessId=(await attached.json()).projectAccessId;
    const selected=await send([organizationId,"projects",projectAccessId,"context"]);assert.equal(selected.status,200,await selected.clone().text());
    headers={cookie:selected.headers.get("set-cookie").split(";")[0]};contextId=decodeURIComponent(headers.cookie.split("=").slice(1).join("="));
    projectScope={organizationId,projectAccessId,projectId,ownerUserId:owner,actorUserId:owner};
    assert.equal((await handleEvents(new Request("http://localhost/api/events",{headers}),f.env)).status,200);
  }
  const contract=instrumentD1Contract(f),depth=enforceD1ExpressionDepth(f);
  await outputs.ensureOutputRequirementsSchema(f.env);
  const auth=await policy.requireUser(new Request("http://localhost/api/session",{headers}),f.env,"viewer",{account:"principal"});assert.equal(auth.response,null);assert.ok(auth.user.authorizationSnapshot);
  Object.assign(f,{owner,streamId,projectId,documentId,headers,projectScope,contextId,user:auth.user,contract,depth});
  f.scope={kind:shared?"project":"personal",key:shared?"project:"+projectScope.projectAccessId+":"+documentId:"personal:"+owner+":"+projectId+":"+documentId,ownerUserId:owner,actorUserId:owner,projectId,documentId,organizationId:projectScope?.organizationId??null,projectAccessId:projectScope?.projectAccessId??null,contextId};
  t.after(()=>{depth.assertVerified();assert.deepEqual(contract.violations,[]);proof.fixtures++;for(const value of depth.records)proof.queries.add(value.sql);proof.maximumBindings=Math.max(proof.maximumBindings,contract.maximumBindings);proof.maximumSqlBytes=Math.max(proof.maximumSqlBytes,contract.maximumSqlBytes);depth.restore();f.sqlite.close();});
  return f;
}
const binding=(f,operation="context-analysis",extra={})=>({version:"paid-safety-union-v1",intentHash:operation,operation,actorUserId:f.owner,permissionEpoch:f.user.access.permissionEpoch??"",streamId:f.streamId,projectId:f.projectId,documentId:f.documentId,canvasId:null,blockId:"",sourceHash:"original-source",period:new Date().toISOString().slice(0,7),scope:f.projectScope,contextSessionId:f.contextId,pilotCohortId:null,steps:[{name:"plan",provider:"openai",model:"gpt-5.6-luna",inputTokens:800,outputTokens:200,maximumMicrousd:2000,toolCalls:0}],publicQuery:"",request:{original:true},...extra});
const head=f=>Number(f.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(f.streamId).n);
const authority=f=>consent.executionAdmissionGuard(f.user,binding(f),head(f),true);
const reads=f=>admission.createOutputAdmissionReads({request:new Request("http://localhost/api/output-requirements"),env:f.env,documentId:f.documentId,actorUserId:f.owner,billingUserId:f.owner,organizationId:f.projectScope?.organizationId??null,projectAccessId:f.projectScope?.projectAccessId??null});
const options=(f,id,extra={})=>({reservationId:id,streamId:f.streamId,correlationId:id,operation:"context-analysis:plan:gpt-5.6-luna",...(f.projectScope?{projectScope:f.projectScope}:{}),...extra});
async function pair(f,id,{operation="document-render:scene",guard,createdAt=new Date(Date.now()-600_000).toISOString(),period,...rest}={}){
  const tokenId=id+":tokens",costId=id+":usd",common=options(f,id,{correlationId:id,operation,createdAt,...(period?{period}:{}),...(guard?{reservationGuard:guard}:{}),...rest});
  assert.equal((await policy.reserveBudget(f.env,f.owner,1000,{...common,reservationId:tokenId})).ok,true);
  assert.equal((await policy.reserveCostBudget(f.env,f.owner,2000,{...common,reservationId:costId,maximumMicrousd:2000,allowUserOverage:false})).ok,true);
  return{tokenId,costId,id,operation,common};
}
function interceptBatch(f,predicate,action){
  const original=f.env.DB.batch;let fired=false;
  f.env.DB.batch=async function(statements){if(!fired&&predicate(statements)){fired=true;action();}return original.call(this,statements);};
  return()=>{f.env.DB.batch=original;assert.equal(fired,true,"the real mutation boundary was reached");};
}

for(const shared of[false,true])test("paid union: prepared reservations remain free until guarded atomic admission "+shared,async t=>{
  const f=await fixture(t,{shared}),guard=authority(f),outputAdmissionReads=reads(f),common=options(f,"prepared",{reservationGuard:guard,outputAdmissionReads});
  const tokens=await policy.prepareBudgetReservation(f.env,f.owner,1000,{...common,reservationId:"prepared-tokens"});
  const cost=await policy.prepareCostBudgetReservation(f.env,f.owner,2000,{...common,reservationId:"prepared-usd",maximumMicrousd:2000,allowUserOverage:false});
  assert.equal(tokens.ok,true);assert.equal(cost.ok,true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM budget_reservations").get().n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM cost_budget_reservations").get().n,0);
  await f.env.DB.batch([...tokens.statements,...cost.statements,...outputs.outputAssertionStatements(f.env,guard)]);
  assert.equal(row(f,"budget_reservations","prepared-tokens").reserved_tokens,1000);
  assert.equal(row(f,"cost_budget_reservations","prepared-usd").reserved_microusd,2000);
});
for(const shared of[false,true])test("paid union: prepared source or session revocation denies both holds despite cached Output reads "+shared,async t=>{
  const f=await fixture(t,{shared}),guard=authority(f),outputAdmissionReads=reads(f),common=options(f,"denied",{reservationGuard:guard,outputAdmissionReads});
  const tokens=await policy.prepareBudgetReservation(f.env,f.owner,1000,{...common,reservationId:"denied-tokens"});
  const cost=await policy.prepareCostBudgetReservation(f.env,f.owner,2000,{...common,reservationId:"denied-usd",maximumMicrousd:2000,allowUserOverage:false});
  assert.equal(tokens.ok,true);assert.equal(cost.ok,true);const before=financial(f);
  if(shared)f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.contextId);
  else await runtime.appendAuditEvent(f.env,f.streamId,"user","BlockCreated",{project_id:f.projectId,document_id:f.documentId,block_id:"changed-source",type:"message",properties:{text:"Human revision"},position:"z"});
  await assert.rejects(f.env.DB.batch([...tokens.statements,...cost.statements,...outputs.outputAssertionStatements(f.env,guard)]),/CHECK constraint failed/u);
  assert.deepEqual(financial(f),before);
});
for(const kind of["tokens","cost"])for(const shared of[false,true])test("paid union: "+kind+" facade checks a live guard on first admission and idempotent reuse "+shared,async t=>{
  const f=await fixture(t,{shared}),id="facade-"+kind,guard=authority(f);
  const invoke=g=>kind==="tokens"?policy.reserveBudget(f.env,f.owner,1000,options(f,id,{reservationGuard:g})):policy.reserveCostBudget(f.env,f.owner,2000,{...options(f,id,{reservationGuard:g}),maximumMicrousd:2000,allowUserOverage:false});
  assert.deepEqual(await invoke({sql:"0",bindings:[]}),{ok:false,scope:"authorization"});
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM "+(kind==="tokens"?"budget_reservations":"cost_budget_reservations")).get().n,0);
  assert.equal((await invoke(guard)).ok,true);const before=financial(f);
  assert.equal((await invoke(guard)).reused,true);assert.deepEqual(financial(f),before);
  assert.deepEqual(await invoke({sql:"0",bindings:[]}),{ok:false,scope:"authorization"});assert.deepEqual(financial(f),before);
});

for(const shared of[false,true])test("paid union: prepared and legacy private writes retain separate guards, scope, publications and hidden kinds "+shared,async t=>{
  const f=await fixture(t,{shared}),guard=authority(f),outputAdmissionReads=reads(f),before=retained(f);
  const prepared=await policy.preparePrivateContent(f.env,f.owner,"execution-consent",'{"original":"日本語"}',f.projectScope??undefined,outputAdmissionReads,guard);
  assert.equal(prepared.requiredInserts,shared?3:1);assert.deepEqual(retained(f),before);
  await f.env.DB.batch([...prepared.statements,...outputs.outputAssertionStatements(f.env,guard)]);
  const saved=row(f,"private_content",prepared.contentId,"content_id");assert.equal(saved.kind,"execution-consent");assert.equal(saved.content,'{"original":"日本語"}');
  assert.ok(Date.parse(saved.expires_at)-Date.parse(saved.created_at)>300*86_400_000);
  assert.deepEqual(await policy.loadPrivateContent(f.env,f.owner,"all",f.projectScope??undefined),{});
  const published=await policy.storePrivateContent(f.env,f.owner,"context-proposal",'{"accepted":true}',f.projectScope??undefined,guard,stored=>[
    f.env.DB.prepare("INSERT INTO assistant_action_commits(commit_id,verified,created_at) SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND content=?)")
      .bind(stored.contentId,new Date().toISOString(),stored.contentId,f.owner,'{"accepted":true}'),
  ]);
  assert.ok(f.sqlite.prepare("SELECT 1 FROM assistant_action_commits WHERE commit_id=?").get(published.contentId));
  assert.deepEqual(await policy.loadPrivateContent(f.env,f.owner,"all",f.projectScope??undefined),{});
});
for(const shared of[false,true])test("paid union: denied prepared or legacy private write cannot publish a pointer "+shared,async t=>{
  const f=await fixture(t,{shared}),deny={sql:"0",bindings:[]},before=retained(f);
  const prepared=await policy.preparePrivateContent(f.env,f.owner,"provider-response","PRIVATE raw",f.projectScope??undefined,reads(f),deny);
  const results=await f.env.DB.batch(prepared.statements);assert.equal(results[0].meta.changes,0);assert.deepEqual(retained(f),before);
  await assert.rejects(policy.storePrivateContent(f.env,f.owner,"provider-response","PRIVATE raw",f.projectScope??undefined,deny,stored=>[
    f.env.DB.prepare("INSERT INTO assistant_action_commits(commit_id,verified,created_at) SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)").bind(stored.contentId,new Date().toISOString(),stored.contentId,f.owner),
  ]),/project_private_content_access_revoked/u);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM assistant_action_commits").get().n,0);assert.deepEqual(retained(f),before);
});
test("paid union: publication failure is not reported as stored success and admissionReads is not a SQL-guard position",async t=>{
  const f=await fixture(t),guard=authority(f);
  await assert.rejects(policy.storePrivateContent(f.env,f.owner,"context-proposal","PRIVATE",undefined,guard,()=>[
    f.env.DB.prepare("INSERT INTO assistant_action_commits(commit_id,verified,created_at) SELECT 'absent',1,'now' WHERE 0"),
  ]),/private_content_publication_unavailable/u);
  await assert.rejects(policy.preparePrivateContent(f.env,f.owner,"prompt","PRIVATE",undefined,guard),/output_admission_read_scope_invalid/u);
  const token=reads(f);await assert.rejects(policy.prepareBudgetReservation(f.env,"foreign",1000,{outputAdmissionReads:token}),/output_admission_read_scope_mismatch/u);
});

async function signed(f,operation){
  const b=binding(f,operation),sourceHead=head(f),quote=await consent.quoteConsequentialExecution(f.env,f.user,b,{humanReviewed:true},sourceHead,1_000_000);
  assert.equal((await consent.claimConsequentialExecution(f.env,f.user,b,quote.executionId,quote.bindingHash,sourceHead)).reused,false);
  await consent.reserveConsequentialSteps(f.env,f.user,b,quote.executionId,consent.executionAdmissionGuard(f.user,b,sourceHead,true));
  await consent.beginConsequentialStep(f.env,f.user,b,quote.executionId,0,sourceHead);
  return{binding:b,quote,sourceHead,tokenId:quote.executionId+":tokens:0",costId:quote.executionId+":usd:0"};
}
for(const operation of["assistant-specialist","adaptive-structure","context-analysis"])test("paid union: actual signed "+operation+" keeps unknown exposure through Stop and orphan reconciliation",async t=>{
  const f=await fixture(t),s=await signed(f,operation);const before=financial(f);
  await consent.failConsequentialExecution(f.env,f.owner,s.quote.executionId,"explicit-stop");
  f.sqlite.prepare("UPDATE budget_reservations SET created_at='2020-01-01T00:00:00.000Z'").run();
  f.sqlite.prepare("UPDATE cost_budget_reservations SET created_at='2020-01-01T00:00:00.000Z'").run();
  const held=financial(f);await policy.reconcileFailedBudgetReservations(f.env,f.user);assert.deepEqual(financial(f),held);
  assert.equal(row(f,"budget_reservations",s.tokenId).status,"active");assert.equal(row(f,"cost_budget_reservations",s.costId).status,"executing");
  assert.equal(before.cost_budget_reservations[0].reserved_microusd,2000);
  await consent.settleConsequentialStep(f.env,f.owner,s.quote.executionId,0,123,560,"retained-verified-response");
  const paid=financial(f);await consent.settleConsequentialStep(f.env,f.owner,s.quote.executionId,0,123,560,"retained-verified-response");assert.deepEqual(withoutCounterRefresh(financial(f)),withoutCounterRefresh(paid));
  assert.equal(row(f,"cost_budget_reservations",s.costId).used_microusd,560);
});
test("paid union: legacy assistant/adaptive and step-only analysis orphans remain held beside a proven ordinary orphan",async t=>{
  const f=await fixture(t),holds=[];
  for(const[operation,correlationId]of[["assistant:page-guidance:gpt-5.6-luna","old-assistant"],["assistant-specialist:proposal:gpt-5.6-sol","old-specialist"],["provider-operation","assistant:lost-task"],["provider-operation","assistant-specialist:lost-task"],["adaptive-structure","lost-adaptive"],["context-analysis:plan:gpt-5.6-luna","analysis"]]){
    const p=await pair(f,correlationId,{operation});holds.push(p);
    if(correlationId==="analysis")insert(f,"consequential_execution_steps",{execution_id:"lost-analysis-row",step_index:0,token_reservation_id:p.tokenId,cost_reservation_id:p.costId,maximum_tokens:1000,maximum_microusd:2000,status:"uncertain",provider_request_id:null,verified_tokens:null,verified_microusd:null,updated_at:new Date().toISOString()});
  }
  const ordinary=await pair(f,"ordinary",{operation:"ordinary-free-compiler"}),before=holds.map(p=>row(f,"budget_reservations",p.tokenId));
  await policy.reconcileFailedBudgetReservations(f.env,f.user);
  assert.deepEqual(holds.map(p=>row(f,"budget_reservations",p.tokenId)),before);
  assert.equal(row(f,"budget_reservations",ordinary.tokenId).status,"released");
});
test("paid union: every retained consequential step boundary or usage field protects an orphan token",async t=>{
  const f=await fixture(t),protectedRows=[];
  for(const[index,evidence]of[
    ...["reserved","submitting","uncertain","usage-recorded","settled"].map(status=>({status})),
    {status:"unknown",verified_tokens:0},{status:"unknown",verified_microusd:0},{status:"unknown",provider_request_id:"retained-provider-id"},
  ].entries()){
    const p=await pair(f,"step-evidence-"+index,{operation:"context-analysis:retained"});protectedRows.push(p.tokenId);
    insert(f,"consequential_execution_steps",{execution_id:"orphan-"+index,step_index:0,token_reservation_id:p.tokenId,cost_reservation_id:p.costId,maximum_tokens:1000,maximum_microusd:2000,provider_request_id:null,verified_tokens:null,verified_microusd:null,updated_at:new Date().toISOString(),...evidence});
  }
  const before=financial(f);await policy.reconcileFailedBudgetReservations(f.env,f.user);assert.deepEqual(financial(f),before);
  for(const id of protectedRows)assert.equal(row(f,"budget_reservations",id).status,"active");
});
for(const kind of["tokens","cost"])test("paid union: facade "+kind+" reservation sees session revocation at its actual INSERT boundary",async t=>{
  const f=await fixture(t,{shared:true}),guard=authority(f),id="late-denied-"+kind;
  const table=kind==="tokens"?"budget_reservations":"cost_budget_reservations",pattern=new RegExp("^INSERT OR IGNORE INTO "+table);
  const restore=interceptBatch(f,list=>list.some(s=>pattern.test(String(s.sql).trimStart())),()=>f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.contextId));
  try{const result=kind==="tokens"?await policy.reserveBudget(f.env,f.owner,1000,options(f,id,{reservationGuard:guard})):await policy.reserveCostBudget(f.env,f.owner,2000,{...options(f,id,{reservationGuard:guard}),maximumMicrousd:2000,allowUserOverage:false});assert.deepEqual(result,{ok:false,scope:"authorization"});}finally{restore();}
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM "+table).get().n,0);
  for(const counter of["budget_counters","cost_budget_counters"]){const suffix=counter==="budget_counters"?"tokens":"microusd";assert.equal(f.sqlite.prepare("SELECT COALESCE(SUM(reserved_"+suffix+"),0) n FROM "+counter).get().n,0);}
});

for(const shared of[false,true])test("paid union: the claimed Scene hold remains exact without adding its own amount twice "+shared,async t=>{
  const f=await fixture(t,{shared}),p=await pair(f,"scene",{operation:"document-render:scene"});assert.equal(await policy.claimCostBudgetReservation(f.env,f.owner,p.costId),true);
  const before=financial(f),claimed={actorUserId:f.owner,streamId:f.streamId,correlationId:p.id,period:new Date().toISOString().slice(0,7),tokenReservationId:p.tokenId,costReservationId:p.costId,reservedTokens:1000,reservedMicrousd:2000,projectScope:f.projectScope,pilotCohortId:null};
  const check=async claim=>{const guard=policy.claimedSceneBudgetGuard(f.env,claim);return Boolean(await f.env.DB.prepare("SELECT 1 AS allowed WHERE "+guard.sql).bind(...guard.bindings).first());};
  assert.equal(await check(claimed),true);assert.equal(await check({...claimed,correlationId:"different"}),false);assert.deepEqual(financial(f),before);
  f.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='user' AND scope_id=?").run(f.owner);
  assert.equal(await check(claimed),false);
});

async function outputSlot(f,id,{status="pending",expired=false,period,receipt=true}={}){
  const p=await pair(f,id,{operation:"document-render:slides",period});
  assert.equal(await policy.claimCostBudgetReservation(f.env,f.owner,p.costId),true);
  const now=new Date().toISOString(),expires=expired?"2000-01-01T00:00:00.000Z":"2099-01-01T00:00:00.000Z";
  const event=await runtime.appendAuditEvent(f.env,f.streamId,"user:"+f.owner,"OutputExecutionAuthorized",{project_id:f.projectId,document_id:f.documentId,grant_id:id},id);
  const common={scope_key:f.scope.key},planId=id+"-plan",target=id+"-target",preflight=id+"-preflight",slotId=id+"-slot",stage="planning:document",client=id+"-client";
  insert(f,"output_plan_revisions",{...common,scope_kind:f.scope.kind,owner_user_id:f.owner,project_id:f.projectId,document_id:f.documentId,organization_id:f.scope.organizationId,project_access_id:f.scope.projectAccessId,plan_revision_id:planId,plan_id:f.documentId,revision:Number(f.sqlite.prepare("SELECT COUNT(*) n FROM output_plan_revisions").get().n)+1,confirmed_event_id:event.eventId,requirements_digest:id+"-requirements",source_digest:id+"-source",resolver_version:"fixture-v1",source_head:head(f),target_count:1,created_at:now});
  insert(f,"output_plan_targets",{...common,plan_revision_id:planId,target_id:target,target_contract_digest:id+"-contract",media_kind:"slides",required:1,selected:1,ordinal:0});
  insert(f,"output_preflights",{...common,preflight_id:preflight,plan_revision_id:planId,actor_user_id:f.owner,terms_digest:id+"-terms",event_id:event.eventId,expires_at:expires,created_at:now});
  insert(f,"output_execution_grants",{...common,grant_id:id,plan_revision_id:planId,actor_user_id:f.owner,payer_user_id:f.owner,context_id:f.contextId,preflight_id:preflight,authorization_event_id:event.eventId,maximum_microusd:2000,maximum_calls:2,status:"active",expires_at:expires,created_at:now});
  insert(f,"output_operation_slots",{...common,slot_id:slotId,grant_id:id,plan_revision_id:planId,target_id:target,target_contract_digest:id+"-contract",source_digest:id+"-source",provider:"openai",model:"gpt-5.6-luna",route_digest:id+"-route",job_id:id,cost_reservation_id:p.costId,token_reservation_id:p.tokenId,maximum_microusd:2000,maximum_calls:2,maximum_tokens:1000,attempt_ordinal:0,previous_slot_id:null,status:status==="none"?"authorized":"uncertain",outcome_event_id:null,created_at:now,updated_at:now});
  insert(f,"output_operation_routes",{...common,slot_id:slotId,stage_key:stage,provider:"openai",model:"gpt-5.6-luna",maximum_calls:2});
  const financialReceipt={clientRequestId:client,provider:"openai",operation:"planning",model:"gpt-5.6-luna",status:status==="settled"?"completed":status==="rejected"?"rejected":"pending",...(status==="settled"?{providerRequestId:id+"-response",costMicrousd:560,inputTokens:100,outputTokens:23,totalTokens:123}:{})};
  if(status!=="none")insert(f,"output_provider_calls",{...common,slot_id:slotId,call_key:id+"-call",client_request_id:client,request_digest:id+"-request",stage_key:stage,provider:"openai",model:"gpt-5.6-luna",reserved_microusd:2000,used_microusd:status==="settled"?560:status==="rejected"?0:null,status,provider_response_id:status==="settled"?id+"-response":null,created_at:now,settled_at:["settled","rejected"].includes(status)?now:null});
  insert(f,"document_jobs",{job_id:id,owner_id:f.owner,stream_id:f.streamId,document_id:f.documentId,kind:"render_document",status:status==="none"?"queued":"failed",source_surface:"document",correlation_id:id,requested_sequence:head(f),request_json:JSON.stringify({artifactKind:"slides"}),result_json:JSON.stringify({reservationId:p.tokenId,costReservationId:p.costId,...(receipt&&status!=="none"?{providerSubmissions:{[client]:financialReceipt}}:{})}),error_message:null,attempt_count:status==="none"?0:1,requested_at:now,started_at:null,completed_at:status==="none"?null:now,lease_expires_at:null,notified_at:null,expires_at:expires,updated_at:now});
  if(status==="none")f.sqlite.prepare("UPDATE cost_budget_reservations SET status='active' WHERE reservation_id=?").run(p.costId);
  return{...p,slotId,client,financialReceipt};
}
for(const status of["pending","uncertain"])for(const shared of[false,true])test("paid union: Output "+status+" exposure survives all generic release paths "+shared,async t=>{
  const f=await fixture(t,{shared}),p=await outputSlot(f,"output-"+status,{status}),before=financial(f);
  assert.equal((await policy.releaseBudget(f.env,f.owner,p.tokenId)).settled,false);
  assert.equal((await policy.releaseCostBudget(f.env,f.owner,p.costId)).settled,false);
  assert.equal((await policy.settleDocumentGenerationBudgets(f.env,f.owner,{reservationId:p.tokenId,costReservationId:p.costId})).status,"uncertain");
  await policy.reconcileFailedBudgetReservations(f.env,f.user);
  assert.deepEqual(financial(f),before);
});
for(const shared of[false,true])test("paid union: exact Output financial evidence settles once while historical assistant and Scene holds stay untouched "+shared,async t=>{
  const f=await fixture(t,{shared}),old=await pair(f,"old-assistant",{operation:"assistant-specialist:proposal:gpt-5.6-sol"}),scene=await pair(f,"pending-scene",{operation:"document-render:scene"}),p=await outputSlot(f,"known",{status:"settled",period:"2025-12"});
  const protectedRows=[row(f,"cost_budget_reservations",old.costId),row(f,"cost_budget_reservations",scene.costId)];
  const settled=await policy.settleDocumentGenerationBudgets(f.env,f.owner,{reservationId:p.tokenId,costReservationId:p.costId,usedTokens:123,usedMicrousd:560});
  assert.equal(settled.settled,true);const after=financial(f);
  assert.equal((await policy.settleDocumentGenerationBudgets(f.env,f.owner,{reservationId:p.tokenId,costReservationId:p.costId})).settled,false);assert.deepEqual(financial(f),after);
  assert.equal(row(f,"budget_reservations",p.tokenId).used_tokens,123);assert.equal(row(f,"cost_budget_reservations",p.costId).period,"2025-12");
  assert.deepEqual([row(f,"cost_budget_reservations",old.costId),row(f,"cost_budget_reservations",scene.costId)],protectedRows);
});
for(const invalid of["missing-usage","wrong-model","wrong-response","wrong-owner","wrong-pair","client-amount"])test("paid union: Output settlement rejects "+invalid+" without guessing a zero charge",async t=>{
  const f=await fixture(t),p=await outputSlot(f,"invalid",{status:"settled",receipt:invalid!=="missing-usage"});
  if(invalid==="wrong-model"||invalid==="wrong-response"){const saved=row(f,"document_jobs",p.id,"job_id"),value=JSON.parse(saved.result_json),receipt=value.providerSubmissions[p.client];if(invalid==="wrong-model")receipt.model="gpt-5.6-sol";else receipt.providerRequestId="foreign-response";f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(value),p.id);}
  const before=financial(f),run=()=>policy.settleDocumentGenerationBudgets(f.env,invalid==="wrong-owner"?"foreign":f.owner,{reservationId:invalid==="wrong-pair"?"foreign-token":p.tokenId,costReservationId:p.costId,...(invalid==="client-amount"?{usedMicrousd:0}:{})});
  if(["wrong-owner","wrong-pair","client-amount"].includes(invalid))await assert.rejects(run(),/output_(?:admitted_reservations_missing|provider_usage_mismatch)/u);else assert.equal((await run()).status,"uncertain");
  assert.deepEqual(financial(f),before);
});
test("paid union: a pending call racing generic token or cost release wins the final SQL fence",async t=>{
  const f=await fixture(t);
  for(const kind of["tokens","cost"]){
    const p=await outputSlot(f,"race-"+kind,{status:"none"}),before=financial(f);
    const restore=interceptBatch(f,statements=>statements.some(s=>new RegExp("^UPDATE "+(kind==="tokens"?"budget_counters":"cost_budget_counters")).test(s.sql??"")),()=>{
      insert(f,"output_provider_calls",{scope_key:f.scope.key,slot_id:p.slotId,call_key:"raced-call-"+kind,client_request_id:"raced-client-"+kind,request_digest:"raced-request",stage_key:"planning:document",provider:"openai",model:"gpt-5.6-luna",reserved_microusd:2000,used_microusd:null,status:"pending",provider_response_id:null,created_at:new Date().toISOString(),settled_at:null});
    });
    try{const result=kind==="tokens"?await policy.releaseBudget(f.env,f.owner,p.tokenId):await policy.releaseCostBudget(f.env,f.owner,p.costId);assert.equal(result.settled,false);}finally{restore();}
    assert.deepEqual(withoutCounterRefresh(financial(f)),withoutCounterRefresh(before));
  }
});
test("paid union: a racing exact financial receipt mismatch rolls back both Output settlements",async t=>{
  const f=await fixture(t),p=await outputSlot(f,"changed-proof",{status:"settled"}),before=financial(f);
  const restore=interceptBatch(f,list=>list.some(s=>String(s.sql).startsWith("UPDATE budget_counters")),()=>{
    const value=JSON.parse(row(f,"document_jobs",p.id,"job_id").result_json);value.providerSubmissions[p.client].totalTokens=124;
    f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(value),p.id);
  });
  try{await assert.rejects(policy.settleDocumentGenerationBudgets(f.env,f.owner,{reservationId:p.tokenId,costReservationId:p.costId}),/CHECK constraint failed/u);}finally{restore();}
  assert.deepEqual(financial(f),before);
});
test("paid union: expired unused Output drains its original pair but not a submitted sibling",async t=>{
  const f=await fixture(t),unused=await outputSlot(f,"expired-unused",{status:"none",expired:true}),pending=await outputSlot(f,"expired-pending",{status:"pending",expired:true}),pendingBefore=[row(f,"budget_reservations",pending.tokenId),row(f,"cost_budget_reservations",pending.costId)];
  await policy.reconcileFailedBudgetReservations(f.env,f.user);
  assert.equal(row(f,"budget_reservations",unused.tokenId).status,"released");assert.equal(row(f,"cost_budget_reservations",unused.costId).status,"released");
  assert.deepEqual([row(f,"budget_reservations",pending.tokenId),row(f,"cost_budget_reservations",pending.costId)],pendingBefore);
});
