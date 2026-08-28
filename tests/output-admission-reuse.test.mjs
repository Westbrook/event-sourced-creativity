import assert from 'node:assert/strict';
import test from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [
 {handleSession,POLICY_VERSION}, {handleEvents}, {handleWorkspaces}, {handleOutputRequirements},
 {outputDocumentExecutionBridge,outputExactImageRender}, {appendAuditEvent,streamHead}, {parseOutputRequirement},
]=await Promise.all([
 import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/workspaces-api.ts'),
 import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
 import('../worker/runtime.ts'),import('../src/model/output-requirements.ts'),
]);

const BASE='/api/output-requirements';
const init=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const stream='creative:dev-local-creative';
async function fixture(facts=[{block_id:'orchard',type:'message',properties:{text:'Protect the mature pear orchard.'}}],{shared=false}={}){
 const f=outputTestDatabase();Object.assign(f.env,{OPENAI_API_KEY:'transport-test-only',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
 assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
 f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
 assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
 const documentId='native-output-fixture';
 await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Community stewardship'});
 for(const [index,fact]of facts.entries())await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:fact.block_id,type:fact.type,handle:fact.block_id,position:String(index),properties:{...fact.properties,weight:1,...(fact.intent?{intent:fact.intent}:{})}});
 let command=0;let headers={},organizationId=null,projectAccessId=null,contextId=null;
 const workspace=async(path,body)=>handleWorkspaces(new Request(`http://localhost/api/workspaces${path.length?'/'+path.join('/'):''}`,body?init(body):{method:'POST'}),f.env,path);
 if(shared){
  const created=await workspace([],{name:'Native Output shared fixture'});assert.equal(created.status,201,JSON.stringify(await created.clone().json()));organizationId=(await created.json()).organizationId;
  const attached=await workspace([organizationId,'projects'],{projectId:'project-atmosphere'});assert.equal(attached.status,201,JSON.stringify(await attached.clone().json()));projectAccessId=(await attached.json()).projectAccessId;
  const opened=await workspace([organizationId,'projects',projectAccessId,'context']);assert.equal(opened.status,200,JSON.stringify(await opened.clone().json()));
  headers={cookie:opened.headers.get('set-cookie').split(';')[0]};contextId=decodeURIComponent(headers.cookie.split('=').slice(1).join('='));
  const loaded=await handleEvents(new Request('http://localhost/api/events',{headers}),f.env);assert.equal(loaded.status,200,'the client loads its canonical shared history after opening a context');
 }

 const executionContext={waitUntil(){throw new Error('Paid output must use the existing foreground runner, not detached waitUntil');}};
 const request=async(path=BASE,body)=>handleOutputRequirements(new Request(`http://localhost${path}${body?'':`${path.includes('?')?'&':'?'}documentId=${documentId}`}`,{...(body?init(body):{}),headers:{...(body?{'content-type':'application/json'}:{}),...headers}}),f.env,path.split('?')[0],executionContext,outputDocumentExecutionBridge);
 const send=async(body,key)=>request(BASE,{documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:key??`native-command-${++command}`,...body});
 const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
 return {...f,documentId,request,send,ok,headers,organizationId,projectAccessId,contextId};
}
function meter(f) {
 const metrics={d1:0,r2:0,provider:0,queries:new Map()};
 const db=f.env.DB;
 const note=sql=>{metrics.d1++;const clean=sql.replace(/\s+/g,' ').slice(0,110);metrics.queries.set(clean,(metrics.queries.get(clean)??0)+1);};
 const wrapped=new WeakMap();
 const statement=(raw,sql)=>{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return(...args)=>statement(target.bind(...args),sql);if(['first','all','run','raw'].includes(key))return(...args)=>{note(sql);return target[key](...args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});wrapped.set(proxy,raw);return proxy;};
 f.env.DB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>statement(target.prepare(sql),sql);if(key==='batch')return inputs=>{note('BATCH '+inputs.filter(x=>!/output_atomic_assertions/.test(x.sql??'')).map(x=>x.sql?.replace(/\s+/g,' ').slice(0,65)).join('|'));return target.batch(inputs.map(x=>wrapped.get(x)??x));};return Reflect.get(target,key,target);}});
 const media=f.env.MEDIA;
 f.env.MEDIA=new Proxy(media,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{metrics.r2++;return value.apply(target,args);};}});
 const reset=()=>{metrics.d1=0;metrics.r2=0;metrics.provider=0;metrics.queries.clear();};
 const profile=async(label,action)=>{reset();const result=await action();console.log(JSON.stringify({label,d1:metrics.d1,r2:metrics.r2,provider:metrics.provider,topD1:[...metrics.queries].sort((a,b)=>b[1]-a[1])}));return result;};
 return{metrics,profile};
}
const {createOutputAdmissionReads,assertOutputAdmissionRequest,assertOutputAdmissionActor,assertOutputAdmissionBudget,readOutputAdmissionValue}=await import('../worker/output-admission-reads.ts');
const {prepareOutputDocumentJob}=await import('../worker/document-jobs-api.ts');
const {prepareBudgetReservation,prepareCostBudgetReservation}=await import('../worker/pilot-policy.ts');
const {preflightGeneration}=await import('../worker/generation-readiness.ts');

async function imageGrantInput(f,count=2){
 const spec=parseOutputRequirement({id:'reuse-output',type:'Output',subtype:'Social media image',content:'Output images at aspect ratio "1:1".'}).spec;assert.ok(spec);
 spec.deliverables[0].quantity={kind:'exact',unit:'image',value:count};spec.deliverables[0].coverage={kind:'document_outline'};spec.deliverables[0].format_variants[0].quantity={kind:'exact',unit:'image',value:count};
 await f.ok(await f.send({action:'save',blockId:spec.id,spec}));
 const confirmed=await f.ok(await f.send({action:'confirm'}));
 const targetIds=confirmed.snapshot.confirmedPlan.plan.targets.map(target=>target.id);assert.equal(targetIds.length,count);
 const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:confirmed.command.planRevisionId,targetIds}));
 const terms=preflight.command.preflight;
 return {documentId:f.documentId,expectedRevision:preflight.snapshot.revision,clientMutationId:'reuse-authorize',action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
}
function noAdmission(f){
 for(const table of['document_jobs','output_execution_grants','output_operation_slots','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
 for(const [table,column]of[['budget_counters','reserved_tokens'],['cost_budget_counters','reserved_microusd']])assert.equal(f.sqlite.prepare(`SELECT COALESCE(SUM(${column}),0) AS n FROM ${table}`).get().n,0,table);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN('OutputExecutionAuthorized','OutputOperationJobQueued','ProjectDocumentJobQueued')").get().n,0);
}
function interceptGrantCommit(f,intercept){
 const batch=f.DB.batch.bind(f.DB);let injected=false;
 f.DB.batch=async statements=>{
  if(!injected&&statements.some(statement=>/^INSERT INTO output_execution_grants/.test(statement.sql))){injected=true;await intercept(statements);}
  return batch(statements);
 };
 return()=>assert.equal(injected,true,'grant commit interception executed');
}

test('Output admission preparation reads are confined to one request, actor, payer, Document, project, database and budget period',async context=>{
 const f=outputTestDatabase();context.after(()=>f.sqlite.close());
 const request=new Request('http://localhost/authorization');
 const identity={request,env:f.env,documentId:'document-a',actorUserId:'actor-a',billingUserId:'payer-a',organizationId:null,projectAccessId:null};
 const scope=createOutputAdmissionReads(identity);let calls=0;
 const read=()=>Promise.resolve(++calls);
 assert.equal(await readOutputAdmissionValue(scope,'provider-health',read),1);
 assert.equal(await readOutputAdmissionValue(scope,'provider-health',read),1);
 const second=createOutputAdmissionReads(identity);assert.equal(await readOutputAdmissionValue(second,'provider-health',read),2);
 assert.throws(()=>readOutputAdmissionValue({},'provider-health',read),/scope_invalid/);
 assertOutputAdmissionRequest(scope,request,f.env,'document-a');
 for(const args of[[new Request(request),f.env,'document-a'],[request,{...f.env},'document-a'],[request,f.env,'document-b']])assert.throws(()=>assertOutputAdmissionRequest(scope,...args),/scope_mismatch/);
 assert.throws(()=>assertOutputAdmissionActor(scope,f.env,'actor-b',null,null),/scope_mismatch/);
 assert.throws(()=>assertOutputAdmissionActor(scope,f.env,'actor-a','org','project'),/scope_mismatch/);
 assert.throws(()=>assertOutputAdmissionActor(scope,f.env,'actor-a',null,null,'document-b'),/scope_mismatch/);
 const period=new Date().toISOString().slice(0,7);assertOutputAdmissionBudget(scope,f.env,'payer-a',period);
 assert.throws(()=>assertOutputAdmissionBudget(scope,f.env,'payer-b',period),/scope_mismatch/);
 assert.throws(()=>assertOutputAdmissionBudget(scope,f.env,'payer-a','1900-01'),/scope_mismatch/);
 assert.throws(()=>assertOutputAdmissionBudget(scope,f.env,'payer-a',period,{organizationId:'org',projectAccessId:'project',actorUserId:'actor-a'}),/scope_mismatch/);
});

test('admission read reuse cannot enable network, persistence, shared caching or audit writes in canonical readiness',async context=>{
 const f=outputTestDatabase();context.after(()=>f.sqlite.close());
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('admission_network_forbidden');});
 const request=new Request('http://localhost/authorization'),userId='actor-a';
 const reads=createOutputAdmissionReads({request,env:f.env,documentId:'document-a',actorUserId:userId,billingUserId:userId,organizationId:null,projectAccessId:null});
 const local={outputAdmissionReads:reads,allowProviderCalls:false,persist:false,appendEvents:false,allowCache:false};
 for(const key of['allowProviderCalls','persist','appendEvents','allowCache']){
  await assert.rejects(preflightGeneration(f.env,{userId},{documentId:'document-a'},{...local,[key]:true}),/output_admission_readiness_must_be_local/);
 }
});

test('one, two, four and sixteen target authorizations have constant binding work and retain every exact reservation and job',async context=>{
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('admission_network_forbidden');});
 for(const shared of[false,true]){
  const counts=[];
  for(const count of[1,2,4,16]){
   const f=await fixture([{block_id:'orchard',type:'message',properties:{text:'Protect mature pear trees beside a sheltered orchard path.'}}],{shared});
   try{
    const m=meter(f),body=await imageGrantInput(f,count);m.metrics.d1=0;m.metrics.r2=0;
    const response=await f.request(BASE,body);const value=await f.ok(response);counts.push(m.metrics.d1);assert.ok(m.metrics.d1<=40,`${shared?'shared':'personal'} ${count}: ${m.metrics.d1}`);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,count);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_operation_slots').get().n,count);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM budget_reservations').get().n,count);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n,count);
    assert.equal(f.sqlite.prepare('SELECT SUM(reserved_microusd) AS amount FROM cost_budget_reservations').get().amount,body.maximumMicrousd);
    const before=f.sqlite.prepare('SELECT SUM(reserved_microusd) AS amount FROM cost_budget_counters').get().amount;
    const replay=await f.ok(await f.request(BASE,body));assert.equal(replay.replayed,true);assert.equal(replay.command.grantId,value.command.grantId);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,count);
    assert.equal(f.sqlite.prepare('SELECT SUM(reserved_microusd) AS amount FROM cost_budget_counters').get().amount,before);
   }finally{f.sqlite.close();}
  }
  assert.equal(new Set(counts).size,1,`selected target count must not multiply common reads: ${counts}`);
 }
});

test('each target still passes the canonical validator when preparation reads are reused',async context=>{
 const f=await fixture([{block_id:'orchard',type:'message',properties:{text:'Protect the pear orchard.'}}]);context.after(()=>f.sqlite.close());
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('admission_network_forbidden');});
 const request=new Request('http://localhost/api/output-requirements');
 const reads=createOutputAdmissionReads({request,env:f.env,documentId:f.documentId,actorUserId:'dev-local-creative',billingUserId:'dev-local-creative',organizationId:null,projectAccessId:null});
 const settings={productionMode:'manual',budgetAcknowledged:true,preflightAcknowledged:true};
 const render=outputExactImageRender({width:1,height:1});assert.ok(render);
 const preparation={readScope:reads,jobId:'first-checked-job',outputExecution:{scopeKey:'test-scope',slotId:'test-slot',grantId:'test-grant'},maximumMicrousd:1_000_000,maximumTokens:128_000,maximumCalls:2,outputImageRender:render,compile:()=>settings};
 const first=await prepareOutputDocumentJob(request,f.env,{documentId:f.documentId,kind:'generate',payload:settings},preparation);assert.ok(!(first instanceof Response));
 const second=await prepareOutputDocumentJob(request,f.env,{documentId:f.documentId,kind:'generate',payload:settings},{...preparation,jobId:'second-rejected-job',outputImageRender:{...render,size:'999999x1'}});
 assert.ok(second instanceof Response);assert.equal(second.status,409);assert.equal((await second.json()).error,'generation_preflight_blocked');
 noAdmission(f);
});

for(const currency of['cost','tokens'])test(`aggregate ${currency} exhaustion at the final transaction rolls back all selected children`,async context=>{
 const f=await fixture([{block_id:'orchard',type:'message',properties:{text:'Protect the pear orchard.'}}]);context.after(()=>f.sqlite.close());
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('admission_network_forbidden');});
 const body=await imageGrantInput(f,2);
 const intercepted=interceptGrantCommit(f,()=>{
  if(currency==='cost')f.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd-? WHERE scope='user'").run(Math.floor(body.maximumMicrousd*0.75));
  else f.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens-192000 WHERE scope='user'").run();
 });
 const response=await f.request(BASE,body);assert.equal(response.status,409,JSON.stringify(await response.clone().json()));intercepted();noAdmission(f);
});

for(const change of['consent','project-selection','private-source'])test(`reused admission reads do not bypass ${change} revocation at grant commit`,async context=>{
 const f=await fixture([{block_id:'orchard',type:'message',properties:{text:'Protect the pear orchard.'}}],{shared:change==='project-selection'});context.after(()=>f.sqlite.close());
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('admission_network_forbidden');});
 const body=await imageGrantInput(f,4);
 const intercepted=interceptGrantCommit(f,()=>{
  if(change==='consent')f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id='dev-local-creative'").run();
  else if(change==='project-selection')f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
  else f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text','Changed source') WHERE private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')='orchard')").run();
 });
 const response=await f.request(BASE,body);assert.equal(response.status,409,JSON.stringify(await response.clone().json()));intercepted();noAdmission(f);
});

test('a late prepared child insert failure rolls back the grant, all jobs and all financial reservations',async context=>{
 const f=await fixture([{block_id:'orchard',type:'message',properties:{text:'Protect the pear orchard.'}}]);context.after(()=>f.sqlite.close());
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('admission_network_forbidden');});
 const body=await imageGrantInput(f,4);
 f.sqlite.exec("CREATE TRIGGER fail_fourth_admission BEFORE INSERT ON document_jobs WHEN (SELECT COUNT(*) FROM document_jobs)=3 BEGIN SELECT RAISE(ABORT,'injected_last_child_insert_failure'); END;");
 const response=await f.request(BASE,body);assert.ok(response.status>=400);noAdmission(f);
});

test('request reuse does not change token or dollar reservation transaction SQL',async context=>{
 const f=await fixture();context.after(()=>f.sqlite.close());const userId='dev-local-creative',request=new Request('http://localhost/authorization');
 const reads=createOutputAdmissionReads({request,env:f.env,documentId:f.documentId,actorUserId:userId,billingUserId:userId,organizationId:null,projectAccessId:null});
 const tokenContext={streamId:stream,correlationId:'same-admission-job',reservationId:'same-token-id',operation:'image-generation',createdAt:'2026-08-01T00:00:00.000Z'};
 const oldToken=await prepareBudgetReservation(f.env,userId,128_000,tokenContext),newToken=await prepareBudgetReservation(f.env,userId,128_000,{...tokenContext,outputAdmissionReads:reads});
 assert.equal(oldToken.ok,true);assert.equal(newToken.ok,true);assert.deepEqual(newToken.statements.map(statement=>statement.sql),oldToken.statements.map(statement=>statement.sql));
 const costContext={streamId:stream,correlationId:'same-admission-job',reservationId:'same-cost-id',operation:'image-generation',period:oldToken.period,maximumMicrousd:1_000_000,allowUserOverage:false};
 const oldCost=await prepareCostBudgetReservation(f.env,userId,1_000_000,costContext),newCost=await prepareCostBudgetReservation(f.env,userId,1_000_000,{...costContext,outputAdmissionReads:reads});
 assert.equal(oldCost.ok,true);assert.equal(newCost.ok,true);assert.deepEqual(newCost.statements.map(statement=>statement.sql),oldCost.statements.map(statement=>statement.sql));
 noAdmission(f);
});
