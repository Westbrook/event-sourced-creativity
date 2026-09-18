import assert from "node:assert/strict";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-execution-test-helpers.mjs";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { instrumentD1Contract } from "./output-d1-test-contract.mjs";
import { snapshot, outputFor } from "./output-presentation-fixtures.mjs";
import { saveDeck } from "./output-native-journey-test-helpers.mjs";
import { parseOutputRequirement } from "../src/model/output-requirements.ts";
import { png } from "./output-asset-fixtures.mjs";
const resolution=registerOutputSourceImports();
const [
  { default: worker }, { POLICY_VERSION }, { appendAuditEvent, streamHead },
]=await Promise.all([
  import("../worker/index.ts"),import("../worker/pilot-policy.ts"),import("../worker/runtime.ts"),
]).finally(()=>resolution.deregister());

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
  return{...f,documentId,request,send,ok,setHeaders(headers){scope.headers={...headers};}};
}



async function saveImages(f){
 const parsed=parseOutputRequirement({id:"output-image-timing",type:"Output",subtype:"Social media image",content:'Output images at aspect ratios "1:1" square, "4:5" feed, and "16:9" optionally.'}),spec=parsed.spec;assert.ok(spec);
 const image=spec.deliverables.find(d=>d.media_kind==="image");assert.ok(image);
 image.quantity={kind:"exact",unit:"image",value:1};image.coverage={kind:"document_outline"};
 image.format_variants.forEach((variant,index)=>{variant.quantity={kind:"exact",unit:"image",value:1};variant.required=index<2;});
 await f.ok(await f.send({action:"save",blockId:spec.id,spec}));
 const confirmation=await f.ok(await f.send({action:"confirm"}));
 const target=confirmation.snapshot.confirmedPlan.plan.targets.find(target=>target.required&&target.media_kind==="image");
 assert.ok(target);assert.equal(target.blocking_issues.length,0);
 return {planId:confirmation.command.planRevisionId,targetId:target.id};
}

function addRequestingMemberFixture(){
async function useRequestingMember(f,deadline,role="editor"){
 const project=f.sqlite.prepare("SELECT * FROM organization_projects WHERE project_id='project-atmosphere'").get();
 const actor="dispatch-member",identity={"oai-authenticated-user-id":actor,"oai-authenticated-user-email":"dispatch-member@example.test"};
 f.setHeaders(identity);assert.equal((await f.request("/api/session")).status,200);
 const now=new Date().toISOString();
 f.sqlite.prepare("UPDATE users SET role='creator',consent_version=? WHERE user_id=?").run(POLICY_VERSION,actor);
 const insert=(table,value)=>f.sqlite.prepare(`INSERT INTO ${table}(${Object.keys(value).join(",")}) VALUES(${Object.keys(value).map(()=>"?").join(",")})`).run(...Object.values(value));
 insert("organization_memberships",{membership_id:"dispatch-member-org",organization_id:project.organization_id,user_id:actor,role:"member",status:"active",invited_by_user_id:"dev-local-creative",accepted_at:now,revoked_at:null,created_at:now,updated_at:now});
 insert("project_memberships",{membership_id:"dispatch-member-project",project_access_id:project.project_access_id,organization_id:project.organization_id,project_id:project.project_id,user_id:actor,role,status:"active",granted_by_user_id:"dev-local-creative",created_at:now,updated_at:now,revoked_at:null});
 insert("capability_grants",{grant_id:"dispatch-member-request",user_id:actor,capability:"project.output.request",scope_type:"project",organization_id:project.organization_id,project_access_id:project.project_access_id,project_id:project.project_id,status:"active",granted_by_user_id:"dev-local-creative",created_at:now,updated_at:now,expires_at:new Date(deadline).toISOString(),revoked_at:null});
 const opened=await f.request("/api/workspaces/"+project.organization_id+"/projects/"+project.project_access_id+"/context",{method:"POST"});assert.equal(opened.status,200,await opened.clone().text());
 f.setHeaders({...identity,cookie:opened.headers.get("set-cookie").split(";")[0]});
 assert.equal((await f.request("/api/events")).status,200);
}
return useRequestingMember;
}
const useRequestingMember=addRequestingMemberFixture();
function outputDeadlineExpandedTests(){
const digestText=async value=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))).toString("hex");
async function addGovernedDeadline(f,deadline){
 const scope=f.sqlite.prepare("SELECT * FROM organization_projects WHERE project_id='project-atmosphere'").get();
 assert.ok(scope);
 const owner="dev-local-creative",now=new Date().toISOString(),originDoc="dispatch-origin",sourceBlock="dispatch-origin-source",target="dispatch-governed",properties={text:"Keep the institutionally authored direction."};
 await appendAuditEvent(f.env,"creative:"+owner,"user","DocumentCreated",{document_id:originDoc,project_id:scope.project_id,title:"Retained source"});
 await appendAuditEvent(f.env,"creative:"+owner,"user","BlockCreated",{document_id:originDoc,project_id:scope.project_id,block_id:sourceBlock,scope:"document",type:"direction",position:"origin",properties});
 const insert=(table,record)=>f.sqlite.prepare(`INSERT INTO ${table}(${Object.keys(record).join(",")}) VALUES(${Object.keys(record).map(()=>"?").join(",")})`).run(...Object.values(record));
 const packageId="dispatch-package",versionId=packageId+"-version",bindingId=packageId+"-binding",memberHash=await digestText(JSON.stringify(properties)),rightsExpiresAt=new Date(deadline).toISOString();
 const raw=JSON.stringify({schema:1,organizationId:scope.organization_id,sourceProjectAccessId:scope.project_access_id,sourceDocumentId:originDoc,
  blocks:[{sourceBlockId:sourceBlock,type:"direction",properties,contentSha256:memberHash,rightsExpiresAt}],relations:[]});
 insert("organization_context_packages",{package_id:packageId,organization_id:scope.organization_id,name:"Retained direction",status:"active",created_by_user_id:owner,created_at:now,updated_at:now});
 insert("organization_context_package_versions",{version_id:versionId,package_id:packageId,organization_id:scope.organization_id,version:1,content_sha256:await digestText(raw),source_project_access_id:scope.project_access_id,source_document_id:originDoc,status:"draft",created_by_user_id:owner,approved_by_user_id:owner,published_at:now,created_at:now});
 insert("organization_context_package_contents",{version_id:versionId,organization_id:scope.organization_id,content_json:raw,created_at:now});
 insert("organization_context_package_sources",{version_id:versionId,organization_id:scope.organization_id,source_project_access_id:scope.project_access_id,source_block_id:sourceBlock,source_kind:"direction",content_sha256:memberHash,rights_expires_at:rightsExpiresAt,position:0});
 f.sqlite.prepare("UPDATE organization_context_package_versions SET status='published' WHERE version_id=?").run(versionId);
 insert("project_context_package_bindings",{binding_id:bindingId,organization_id:scope.organization_id,project_access_id:scope.project_access_id,project_id:scope.project_id,document_id:f.documentId,package_id:packageId,version_id:versionId,update_mode:"pinned",status:"active",created_by_user_id:owner,created_at:now,updated_at:now});
 insert("project_context_package_members",{binding_id:bindingId,organization_id:scope.organization_id,source_block_id:sourceBlock,target_block_id:target,content_sha256:memberHash});
 await appendAuditEvent(f.env,"creative:"+owner,"user","BlockCreated",{document_id:f.documentId,project_id:scope.project_id,block_id:target,scope:"document",type:"direction",position:"governed",properties:{...properties,organization_context_package_id:packageId,organization_context_package_version_id:versionId,organization_context_package_binding_id:bindingId,organization_context_source_block_id:sourceBlock}});
 assert.equal((await f.request("/api/events")).status,200);
}
const cases=[];
for(const target of["direction","image","slides","slides-repair"])for(const lifetime of["license","rights","source","grant","session","lease","period","governance","member"])for(const expire of[false,true])cases.push({target,lifetime,expire});
for(const {target,lifetime,expire}of cases)test(`Output final deadline ${target}/${lifetime}/cross=${expire}`,async t=>{
 const RealDate=globalThis.Date;let offset=0,deadline=RealDate.now()+120_000;
 if(lifetime==="period"){const current=new RealDate();deadline=RealDate.UTC(current.getUTCFullYear(),current.getUTCMonth()+1,1);offset=deadline-120_000-RealDate.now();}
 t.mock.property(globalThis,"Date",class extends RealDate{constructor(...values){super(...(values.length?values:[RealDate.now()+offset]));}static now(){return RealDate.now()+offset;}});
 const calls=[],trace=[];let armed=false,crossed=false,selectedFetch=false,matches=0,priorCalls=null,beforeHold=null,beforeHealth=null,pendingId=null;
 const isDeck=target.startsWith("slides"),repair=target==="slides-repair";
 t.mock.method(globalThis,"fetch",async(url,request)=>{
  const endpoint=new URL(String(url)).pathname,plannerIndex=calls.filter(call=>call.endpoint==="/v1/responses").length;
  const selected=target==="image"?endpoint==="/v1/images/generations":endpoint==="/v1/responses"&&(!repair||plannerIndex===1);
  calls.push({endpoint,expired:Date.now()>=deadline,clientId:new Headers(request.headers).get("X-Client-Request-Id"),raw:request.body});
  if(selected){selectedFetch=true;trace.push({stage:"fetch",expired:Date.now()>=deadline});if(expire)throw new TypeError("mock boundary: no network");}
  if(endpoint==="/v1/responses"){const value=isDeck?outputFor():{title:"Sheltered orchard",rationale:"Protect mature roots",scene:"Pear trees beside a sheltered orchard path",palette:["green","ochre"],next_moves:["Review tree spacing"]};
   return Response.json({id:"memory-plan-"+plannerIndex,model:"gpt-5.6-terra",output_text:JSON.stringify(repair&&plannerIndex===0?{...value,items:[]}:value),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
  }
  if(endpoint==="/v1/moderations")return Response.json({id:"memory-safety",model:"omni-moderation-latest",results:[{flagged:false,categories:{}}]});
  assert.equal(endpoint,"/v1/images/generations");
  const [width,height]=JSON.parse(request.body).size.split("x").map(Number);
  return Response.json({created:1,data:[{b64_json:Buffer.from(png({width,height})).toString("base64")}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}},{headers:{"x-request-id":"memory-image"}});
 });
 const shared=lifetime==="session"||lifetime==="governance"||lifetime==="member",f=await outputFixture(t,{shared});
 if(lifetime==="session"){deadline=Date.parse(f.sqlite.prepare("SELECT expires_at FROM project_context_sessions WHERE revoked_at IS NULL").get().expires_at);offset=deadline-120_000-RealDate.now();}
 if(["license","rights","source"].includes(lifetime)){
  await appendAuditEvent(f.env,"creative:dev-local-creative","user","BlockPropertyEdited",{document_id:f.documentId,project_id:"project-atmosphere",block_id:"source-0",property_path:lifetime+"_expires_at",new_value:new RealDate(deadline).toISOString()});
 }
 if(lifetime==="governance")await addGovernedDeadline(f,deadline);
 const plan=isDeck?await saveDeck(f):await saveImages(f);
 if(lifetime==="member"){await useRequestingMember(f,deadline);deadline=Date.parse(f.sqlite.prepare("SELECT expires_at FROM project_context_sessions WHERE principal_user_id='dispatch-member' AND revoked_at IS NULL").get().expires_at);offset=deadline-120_000-RealDate.now();}
 const preflight=await f.ok(await f.send({action:"preflight",planRevisionId:plan.planId,targetIds:[plan.targetId]})),terms=preflight.command.preflight;
 assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
 const accepted=await f.ok(await f.send({action:"authorize",preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true}));
 const slot=f.sqlite.prepare("SELECT * FROM output_operation_slots").get();
 if(lifetime==="grant"){deadline=Date.parse(f.sqlite.prepare("SELECT expires_at FROM output_execution_grants").get().expires_at);offset=deadline-120_000-RealDate.now();}
 await f.ok(await f.send({action:"run",grantId:accepted.command.grantId}));
 const original=f.env.DB;
 f.env.DB=new Proxy(original,{get(object,key){
  if(key==="batch")return async statements=>{
   let entry=null;
   for(const stmt of statements)if(/UPDATE document_jobs SET/u.test(stmt.sql??"")&&/result_json/u.test(stmt.sql??"")){
    for(const binding of stmt.bindings??stmt.values??[]){
     if(typeof binding!=="string"||binding[0]!=="{")continue;let value;try{value=JSON.parse(binding);}catch{continue;}
     for(const candidate of Object.values(value.providerSubmissions??{}))if(candidate.status==="pending"&&candidate.operation===(target==="image"?"image":"planning")&&(!repair||candidate.unitId==="planning:0:repair"))entry=candidate;
    }
   }
   const results=await object.batch(statements);
   if(armed&&entry&&!crossed){
    matches++;pendingId=entry.clientRequestId;
    if(lifetime==="lease")deadline=Date.parse(f.sqlite.prepare("SELECT lease_expires_at FROM document_jobs WHERE job_id=?").get(slot.job_id).lease_expires_at);
    priorCalls=f.sqlite.prepare("SELECT * FROM output_provider_calls WHERE status='settled' ORDER BY call_key").all();
    beforeHealth=f.sqlite.prepare("SELECT * FROM provider_health ORDER BY scope_key").all();
    beforeHold=f.sqlite.prepare("SELECT reservation_id,owner_id,stream_id,correlation_id,period,reserved_microusd,used_microusd,status FROM cost_budget_reservations").all();
    trace.push({stage:"guarded-pending-return",current:Date.now()<deadline,guards:statements.filter(stmt=>/output_atomic_assertions/u.test(stmt.sql??"")).length});
    if(expire)queueMicrotask(()=>{offset=deadline-RealDate.now()+1;crossed=true;trace.push({stage:"deadline-crossed",after:Date.now()>=deadline});});
   }
   return results;
  };
  const value=Reflect.get(object,key,object);return typeof value==="function"?value.bind(object):value;
 }});
 armed=true;
 const response=await f.request("/api/document-jobs/"+slot.job_id+"/run",post({})),result=await response.json();
 const raw=f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(slot.job_id),checkpoint=JSON.parse(raw.result_json);
 t.diagnostic(JSON.stringify({target,lifetime,expire,status:response.status,jobStatus:result.job?.status,error:result.job?.result?.errorDetail?.code??result.error,paidMockCalls:calls.filter(call=>call.endpoint!=="/v1/moderations").length,matches,trace}));
 assert.equal(response.status,200,JSON.stringify(result));assert.equal(matches,1,"observe exactly the targeted canonical pending receipt");
 assert.equal(trace.find(entry=>entry.stage==="guarded-pending-return").current,true);
 assert.ok(pendingId);
 const call=f.sqlite.prepare("SELECT * FROM output_provider_calls WHERE client_request_id=?").get(pendingId);
 assert.equal(call.call_key,target==="image"?"image:initial":target==="direction"?"planning:initial":repair?"planning:0:repair":"planning:0:initial");
 assert.match(call.request_digest,/^[a-f0-9]{64}$/u);
 if(expire){
  assert.equal(crossed,true);assert.equal(selectedFetch,false,"deadline crossing after SQL must stop the actual provider fetch");assert.equal(calls.some(call=>call.expired),false);
  assert.equal(result.job.status,"failed");
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM provider_health ORDER BY scope_key").all(),beforeHealth,"a local deadline is not provider-health failure");
  assert.equal(result.job.result.errorDetail.code,"output_execution_deadline_expired");assert.equal(result.job.result.errorDetail.httpStatus,403);assert.equal(result.job.result.errorDetail.retryable,false);
  assert.equal(result.job.result.errorDetail.action,"check_project");assert.doesNotMatch(result.job.result.errorDetail.message,/provider rejected|not charged|no charge/iu);
  assert.equal(call.status,"pending","local expiry does not claim provider rejection or zero-charge proof");
  assert.equal(checkpoint.providerSubmissions[pendingId].status,"pending");
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM output_provider_calls WHERE status='settled' ORDER BY call_key").all(),priorCalls,"earlier verified calls remain exact");
  assert.deepEqual(f.sqlite.prepare("SELECT reservation_id,owner_id,stream_id,correlation_id,period,reserved_microusd,used_microusd,status FROM cost_budget_reservations").all(),beforeHold,"original allowance stays held");
  assert.equal(priorCalls.length,target==="image"||repair?1:0);
  if(priorCalls.length){assert.equal(priorCalls[0].used_microusd,1200);assert.equal(checkpoint.plannerUsage.totalTokens,200);}
 }else{
  assert.equal(result.job.status,"completed",JSON.stringify(result));assert.equal(calls.some(call=>call.expired),false);
  const observed=calls.find(request=>request.clientId===pendingId);assert.ok(observed,"unchanged original request identity reaches provider boundary");
  if(isDeck||target==="direction")assert.equal(call.request_digest,await digestText(observed.raw));
  else{const body=JSON.parse(observed.raw);assert.equal(call.request_digest,await digestText(JSON.stringify({model:body.model,prompt:body.prompt,size:body.size,quality:body.quality,outputFormat:body.output_format,references:[]})));}
 }
 assert.equal(JSON.stringify(result).includes("deadlineMs"),false,"internal deadline proof is never serialized");
 offset=0;
});
}
outputDeadlineExpandedTests();

function outputDeadlineNegativeTests(){
async function admittedOutput(f,target){
 const plan=target==="image"||target==="direction"?await saveImages(f):await saveDeck(f);
 const preflight=await f.ok(await f.send({action:"preflight",planRevisionId:plan.planId,targetIds:[plan.targetId]})),terms=preflight.command.preflight;
 const accepted=await f.ok(await f.send({action:"authorize",preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true}));
 const slot=f.sqlite.prepare("SELECT * FROM output_operation_slots").get();
 await f.ok(await f.send({action:"run",grantId:accepted.command.grantId}));
 return slot;
}
test("Output deadline does not turn a viewer's explicit request grant into paid authority",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("viewer must not transmit");});
 const f=await outputFixture(t,{shared:true}),plan=await saveDeck(f);
 await useRequestingMember(f,Date.now()+120_000,"viewer");
 const response=await f.send({action:"preflight",planRevisionId:plan.planId,targetIds:[plan.targetId],deadlineMs:Number.MAX_SAFE_INTEGER,dispatchStop:{code:"output_execution_deadline_expired"}});
 assert.equal(response.status,403);assert.equal((await response.json()).error,"output_action_not_authorized");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,0);assert.equal(calls,0);
});
for(const target of["direction","image","slides"])test("Output exact pending SQL still rejects withdrawn source/authority before "+target,async t=>{
 let planner=0,image=0,safety=0;
 t.mock.method(globalThis,"fetch",async(url)=>{
  const endpoint=new URL(String(url)).pathname;
  if(endpoint==="/v1/responses"){planner++;assert.equal(target,"image","only the earlier image direction may be sent");return Response.json({id:"prior-direction",model:"gpt-5.6-terra",output_text:JSON.stringify({title:"Sheltered orchard",rationale:"Protect mature roots",scene:"Pear trees beside a sheltered orchard path",palette:["green"],next_moves:["Review tree spacing"]}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});}
  if(endpoint==="/v1/moderations"){safety++;return Response.json({id:"prior-safety",model:"omni-moderation-latest",results:[{flagged:false,categories:{}}]});}
  image++;throw new Error("withdrawn work must not transmit");
 });
 const f=await outputFixture(t),slot=await admittedOutput(f,target),original=f.env.DB;let withdrawn=false;
 f.env.DB=new Proxy(original,{get(object,key){
  if(key==="batch")return async statements=>{
   const pending=statements.some(stmt=>/UPDATE document_jobs SET.*result_json/u.test(stmt.sql??"")&&(stmt.bindings??[]).some(binding=>{
    if(typeof binding!=="string"||binding[0]!=="{")return false;try{return Object.values(JSON.parse(binding).providerSubmissions??{}).some(receipt=>receipt.status==="pending"&&receipt.operation===(target==="image"?"image":"planning"));}catch{return false;}
   }));
   if(pending&&!withdrawn){withdrawn=true;
    if(target==="slides")await appendAuditEvent(f.env,"creative:dev-local-creative","user","BlockPropertyEdited",{document_id:f.documentId,project_id:"project-atmosphere",block_id:"source-0",property_path:"text",new_value:"The source author changed this decision before dispatch."});
    else f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run();
   }
   return object.batch(statements);
  };
  const value=Reflect.get(object,key,object);return typeof value==="function"?value.bind(object):value;
 }});
 const response=await f.request("/api/document-jobs/"+slot.job_id+"/run",post({})),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.job.status,"failed");assert.equal(withdrawn,true);
 assert.equal(image,0);assert.equal(planner,target==="image"?1:0);assert.equal(safety,target==="image"?1:0);
 assert.notEqual(body.job.result.errorDetail.code,"output_execution_deadline_expired","only the exact synchronous deadline witness gets that local cause");
 const call=f.sqlite.prepare("SELECT * FROM output_provider_calls WHERE status='pending'").get();assert.ok(call);
 const held=f.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=?").get(slot.cost_reservation_id);
 assert.equal(held.status,"executing");assert.equal(held.reserved_microusd,slot.maximum_microusd);
});
test("a provider's forged local-stop code remains a real provider rejection, not the server deadline witness",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({error:{code:"output_execution_deadline_expired",message:"Synthetic provider response, not a server dispatch decision."}},{status:422});});
 const f=await outputFixture(t),slot=await admittedOutput(f,"slides");
 const response=await f.request("/api/document-jobs/"+slot.job_id+"/run",post({})),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.job.status,"failed");assert.equal(calls,1);
 assert.equal(body.job.result.errorDetail.httpStatus,422);assert.notEqual(body.job.result.errorDetail.category,"access");
 assert.equal(f.sqlite.prepare("SELECT status FROM output_provider_calls").get().status,"rejected");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_provider_calls").get().n,1);
});
test("a lost provider response keeps the original pending call and hold without a local-stop certificate",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw new TypeError("Synthetic response loss after the mock fetch boundary");});
 const f=await outputFixture(t),slot=await admittedOutput(f,"slides");
 const response=await f.request("/api/document-jobs/"+slot.job_id+"/run",post({})),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.job.status,"failed");assert.equal(calls,1);
 assert.notEqual(body.job.result.errorDetail.code,"output_execution_deadline_expired");
 assert.equal(f.sqlite.prepare("SELECT status FROM output_provider_calls").get().status,"pending");
 const held=f.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=?").get(slot.cost_reservation_id);
 assert.equal(held.status,"executing");assert.equal(held.reserved_microusd,slot.maximum_microusd);
 await f.request("/api/document-jobs/"+slot.job_id+"/run",post({}));
 assert.equal(calls,1,"read/re-drive never purchases a replacement for an unknown request");
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n,1);
});
}
outputDeadlineNegativeTests();
