import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
import { compileSqliteExpressionDepth, enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { legacyArtifactExactBatchGuard, legacyNativeEvidenceSql } from "./helpers/exact-delivery-depth-oracle.mjs";

// Reuse the actual Worker SQLite transaction fixture, without running unrelated provider tests.
const fixtureUrl = new URL("./exact-delivery-worker-fixture.mjs", import.meta.url).href;
const completeFixture = readFileSync(new URL("./assistant-runtime.test.mjs", import.meta.url), "utf8");
let fixtureSource = completeFixture.split("const adaptiveRegressionRequest =")[0];
assert.ok(fixtureSource.includes("async function sharedProjectFixture"));
fixtureSource = 'import { AsyncLocalStorage } from "node:async_hooks";\nconst localAudit = new AsyncLocalStorage();\n' + fixtureSource;
fixtureSource = fixtureSource.replace("bind(...values) { assert.ok(values.length <= 100);", 'bind(...values) { const audit=localAudit.getStore();if(audit){audit.valueBytes=Math.max(audit.valueBytes??0,...values.filter(value=>typeof value==="string").map(value=>new TextEncoder().encode(value).byteLength));assert.ok(audit.valueBytes<=2000000,"D1 bound value limit");}if(audit&&values.length>audit.binds){audit.binds=values.length;audit.bindSql=this.sql.replace(/\\s+/gu," ").slice(0,180);} assert.ok(values.length <= 100);');
fixtureSource = fixtureSource.replace("    execute(kind) {\n", '    execute(kind) {\n      const audit=localAudit.getStore(),bytes=new TextEncoder().encode(this.sql).length;if(audit){audit.queries++;if(bytes>audit.bytes){audit.bytes=bytes;audit.sizeSql=this.sql.replace(/\\s+/gu," ").slice(0,180);}assert.ok(audit.queries<=1000,"D1 request query limit");}assert.ok(bytes<=100000,"D1 SQL text limit");\n');
fixtureSource += '\nexport {fixture,sharedProjectFixture,json};\nexport async function measured(run){const metrics={queries:0,binds:0,bytes:0};const result=await localAudit.run(metrics,run);return{result,metrics};}\n';
const fixtureSyntax=ts.createSourceFile("assistant-runtime.test.mjs",completeFixture,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const seedNode=fixtureSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="appendFixtureEvents");assert.ok(seedNode);
fixtureSource=fixtureSource.replace(seedNode.getText(fixtureSyntax),`function appendFixtureEvents(sqlite,stream,entries){
 let sequence=Number(sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(stream).n);
 const insert=sqlite.prepare("INSERT INTO event_write_stage("+fixtureRuntime.EVENT_WRITE_COLUMNS+") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 for(const[type,payload]of entries){const event=fixtureRuntime.makeEvent(stream,++sequence,"user:"+stream.slice("creative:".length),"trusted-delivery-fixture",crypto.randomUUID(),type,payload);insert.run(...fixtureRuntime.eventWriteBindings(event));}
}`);
fixtureSource+='\nconst fixtureRuntime=await import("../worker/runtime.ts");\n';

for(const name of["seedAdaptiveRightsDeadline","seedAdaptiveSeparateProjectGoverned","consequentialDbClock"]){
  const node=fixtureSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,"Existing runtime helper "+name);fixtureSource+="\n"+node.getText(fixtureSyntax);
}
const sourceBody=fixtureSyntax.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>item.name.getText(fixtureSyntax)==="adaptiveConsentBody"));
assert.ok(sourceBody);fixtureSource+="\n"+sourceBody.getText(fixtureSyntax)+"\nexport{seedAdaptiveRightsDeadline,seedAdaptiveSeparateProjectGoverned,consequentialDbClock};\n";
const hook = registerHooks({
  resolve(specifier, context, next) { if (specifier === fixtureUrl) return { url: fixtureUrl, shortCircuit: true }; return next(specifier, context); },
  load(url, context, next) { if (url === fixtureUrl) return { format: "module", source: fixtureSource, shortCircuit: true }; return next(url, context); },
});
const { sharedProjectFixture, json, measured, seedAdaptiveRightsDeadline, seedAdaptiveSeparateProjectGoverned, consequentialDbClock } = await import(fixtureUrl).finally(() => hook.deregister());
const runtime = await import("../worker/runtime.ts");
const { synchronizeProjectScope } = await import("../worker/project-access.ts");

const {storePrivateContent}=await import("../worker/pilot-policy.ts");
const body=async(response,status=200)=>{const payload=await response.json();assert.equal(response.status,status,JSON.stringify(payload));return payload;};
const projectId="project-atmosphere",documentId="delivery-document",ownerId="assistant-owner",stream="creative:"+ownerId;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("");
const traces=[];
async function deliveryFixture({reference=false,blocks=1,governed=null}={}){
 const state=await sharedProjectFixture(),background=[],depth=enforceD1ExpressionDepth(state);
 const reviewerMembership=state.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(state.projectAccessId,"assistant-viewer").membership_id;
 await body(await state.request("/api/workspaces/"+state.organizationId+"/projects/"+state.projectAccessId+"/members/"+reviewerMembership,{method:"PATCH",headers:{...state.owner,"content-type":"application/json"},body:JSON.stringify({reviewAccess:true})}));
 const seed=async entries=>{
  const head=Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(stream).n);
  const events=entries.map(([type,payload],i)=>runtime.makeEvent(stream,head+i+1,"user:"+ownerId,"delivery-fixture",crypto.randomUUID(),type,{...payload,project_id:projectId}));
  await state.env.DB.batch(events.map(event=>runtime.insertEvent(state.env,event)));
  await synchronizeProjectScope(state.env,{organizationId:state.organizationId,projectAccessId:state.projectAccessId,projectId,ownerUserId:ownerId});
  return events;
 };
 const referenceId="delivery-reference",deadline=new Date(Date.now()+30_000).toISOString();
 let origin=null;
 if(governed){
  if(governed==="same-project"){
   await seed([["DocumentCreated",{document_id:"delivery-upstream-document",title:"Private governed source"}],
    ["BlockCreated",{document_id:"delivery-upstream-document",block_id:"delivery-upstream-source",type:"message",handle:"Licensed private source",position:"a",properties:{text:"PRIVATE_UPSTREAM_DELIVERY_SOURCE",rights_class:"owned_or_licensed",license_expires_at:deadline}}]]);
   await seedAdaptiveRightsDeadline(state,"governed-upstream",deadline,new Date(Date.now()+300_000).toISOString(),{documentId:"delivery-upstream-document",blockId:"delivery-upstream-source"});
   origin={sourceOwner:ownerId,sourceStream:stream,sourceProjectId:projectId,sourceProjectAccessId:state.projectAccessId,sourceDocumentId:"delivery-upstream-document",sourceBlockId:"delivery-upstream-source",packageId:"adaptive-rights-package",versionId:"adaptive-rights-version"};
  }else origin=await seedAdaptiveSeparateProjectGoverned(state,{sameOwner:governed==="same-owner"});
  const row=state.sqlite.prepare("SELECT * FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?").get(origin.sourceStream,origin.sourceBlockId);
  assert.ok(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(row.event_id),"actual event writer retained upstream private payload");
  origin.sourceEventId=row.event_id;
 }
 await seed([["DocumentCreated",{document_id:documentId,title:"Exact delivery"}],
  ...(reference?[["ReferenceIngested",{document_id:documentId,reference_id:referenceId,source_type:"text",source_ref:"",rights_class:"owned_or_licensed"}],
   ["RightsAsserted",{document_id:documentId,reference_id:referenceId,rights_class:"owned_or_licensed",license_expires_at:deadline}]]:[]),
  ...Array.from({length:blocks},(_,index)=>["BlockCreated",{document_id:documentId,block_id:index?"delivery-source-"+index:"delivery-source",type:reference?"reference":"message",handle:"message/source-"+index,position:"a"+index,properties:{text:"PRIVATE_NATIVE_DELIVERY_SOURCE "+index+" · café 👩🏽‍🎨",weight:1,authority:"authored",...(reference?{reference_id:referenceId,rights_class:"owned_or_licensed"}:{}),...(governed?{organization_context_package_id:origin.packageId,organization_context_package_version_id:origin.versionId,rights_class:"owned_or_licensed"}:{})}}])]);
 const content=JSON.stringify({content_markdown:"Exact approved output",items:[{id:"slide-a",title:"Exact",body:"Approved output bytes",notes:""}]}),contentSha256=await digest(content);
 const stored=await storePrivateContent(state.env,ownerId,"document-artifact",content);
 const artifactId="delivery-artifact",versions=Array.from({length:blocks},(_,index)=>({block_id:index?"delivery-source-"+index:"delivery-source",version:1}));
 await seed([["DocumentRenderRequested",{artifact_id:artifactId,document_id:documentId,artifact_kind:"slides",source_block_versions:versions}],
  ["DocumentRenderCompleted",{artifact_id:artifactId,document_id:documentId,artifact_kind:"slides",title:"Exact approved output",content_ref:stored.contentId,item_count:1,source_block_versions:versions,requested_by_user_id:ownerId}]]);
 const exact={project_id:projectId,document_id:documentId,artifact_id:artifactId,source_block_versions:versions,artifact_revision:0,content_sha256:contentSha256};
 const send=async(type,extra={},identity=type==="ArtifactApproved"||type==="ArtifactChangesRequested"?state.viewer:state.owner)=>{
  const run=await measured(async()=>{const response=await state.request("/api/events",json({action:"append",event:{type,payload:{...exact,...extra}}},identity));await state.drainBackground();return response;});
  traces.push({type,status:run.result.status,...run.metrics});return run.result;
 };
 const fault=callback=>{
  const batch=state.env.DB.batch;
  state.env.DB.batch=async statements=>{
   if(callback&&statements.some(statement=>/INSERT INTO event_write_stage/u.test(statement.sql)&&statement.values.some(value=>["ArtifactReviewRequested","ArtifactApproved","ArtifactChangesRequested","DocumentArtifactExported","ObjectExported"].includes(value)))){const current=callback;callback=null;await current(statements);}
   return batch(statements);
  };return()=>{state.env.DB.batch=batch;};
 };
 const counts=()=>({events:state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=?").get(stream).n,
  reviewed:state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type IN('ArtifactReviewRequested','ArtifactApproved','ArtifactChangesRequested','DocumentArtifactExported')").get(stream).n,
  index:state.sqlite.prepare("SELECT last_owner_sequence AS n FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId).n,
  tasks:state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_review_tasks").get().n,
  taskState:JSON.stringify(state.sqlite.prepare("SELECT task_id,status,resolved_at,resolved_by_user_id FROM project_review_tasks ORDER BY task_id").all()),
  notifications:state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_notifications").get().n});
 const batch=async(events,identity=state.owner)=>{
  const run=await measured(async()=>{const response=await state.request("/api/events",json({action:"batch",events},identity));await state.drainBackground();return response;});
  traces.push({type:"batch:"+events.length,status:run.result.status,...run.metrics});return run.result;
 };
 const anotherArtifact=async id=>{await seed([["DocumentRenderRequested",{artifact_id:id,document_id:documentId,artifact_kind:"slides",source_block_versions:versions}],
  ["DocumentRenderCompleted",{artifact_id:id,document_id:documentId,artifact_kind:"slides",title:id,content_ref:stored.contentId,item_count:1,source_block_versions:versions,requested_by_user_id:ownerId}]]);return{...exact,artifact_id:id};};
 return{...state,send,batch,seed,fault,counts,anotherArtifact,origin,contentId:stored.contentId,content,contentSha256,exact,deadline,artifactId,
  async close(){try{await state.drainBackground();while(background.length)await Promise.all(background.splice(0));depth.assertVerified();}finally{depth.restore();state.sqlite.close();}}};
}

test("exact delivery backend: independent assigned reviewer approves exact Unicode-rich source and exports",async()=>{
 const state=await deliveryFixture({blocks:100});
 try{
  const before=state.counts();
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));
  await body(await state.send("ArtifactApproved"));
  const exported=await body(await state.send("DocumentArtifactExported",{format:"application/pdf"}));
  assert.equal(exported.appended[0].payload.export_class,"independently-approved");
  assert.equal(exported.appended[0].payload.content_sha256,state.contentSha256);
  assert.equal(state.counts().reviewed,before.reviewed+3);
  assert.equal(state.sqlite.prepare("SELECT role FROM project_memberships WHERE project_access_id=? AND user_id='assistant-viewer'").get(state.projectAccessId).role,"viewer");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n,0);
 }finally{await state.close();}
});
const artifactFaults=["artifact-erasure","artifact-expiry","artifact-content","artifact-owner","artifact-custody","content-custody",
 "source-erasure","source-content","source-owner","source-custody","source-scope","source-resource","document-resource",
 "reference-expiry","invalid-reference-deadline","assigned-grant-expiry","session-expiry","session-revocation","reviewer-membership","author-consent"];
for(const fault of artifactFaults)test("exact delivery backend: "+fault+" at mutation leaves no event, review task, notification or index advance",async()=>{
 const state=await deliveryFixture({reference:fault.includes("reference")});let clock,restore;
 try{
  const before=state.counts(),source=state.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='delivery-source'").get(stream).event_id;
  if(fault.endsWith("expiry"))clock=consequentialDbClock(state);
  if(fault==="assigned-grant-expiry")state.sqlite.prepare("UPDATE capability_grants SET expires_at=? WHERE user_id='assistant-viewer' AND capability='project.review.approve'").run(state.deadline);
  if(fault==="artifact-expiry")state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(state.deadline,state.contentId);
  if(fault==="session-expiry")state.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE principal_user_id=?").run(state.deadline,ownerId);
  restore=state.fault(()=>{
   if(fault==="artifact-erasure")state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),state.contentId);
   if(fault==="artifact-content")state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(state.content+" ",state.contentId);
   if(fault==="artifact-owner")state.sqlite.prepare("UPDATE private_content SET owner_id='assistant-viewer' WHERE content_id=?").run(state.contentId);
   if(fault==="artifact-custody")state.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='artifact' AND resource_id=?").run(state.artifactId);
   if(fault==="content-custody")state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(state.contentId);
   if(fault==="source-erasure")state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),source);
   if(fault==="source-content")state.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text','Changed private text without head') WHERE private_event_id=?").run(source);
   if(fault==="source-owner")state.sqlite.prepare("UPDATE event_private_payloads SET owner_id='assistant-viewer' WHERE private_event_id=?").run(source);
   if(fault==="source-custody")state.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(source);
   if(fault==="source-scope")state.sqlite.prepare("UPDATE project_event_scopes SET project_id='other-project' WHERE event_id=?").run(source);
   if(fault==="source-resource")state.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='block' AND resource_id='delivery-source'").run();
   if(fault==="document-resource")state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='document' AND resource_id=?").run(documentId);
   if(fault==="invalid-reference-deadline")state.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.license_expires_at','not-a-deadline') WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='RightsAsserted' AND json_extract(payload,'$.reference_id')='delivery-reference')").run(stream);
   if(fault==="session-revocation")state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id=?").run(new Date().toISOString(),ownerId);
   if(fault==="reviewer-membership")state.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id='assistant-viewer' AND project_access_id=?").run(new Date().toISOString(),state.projectAccessId);
   if(fault==="author-consent")state.sqlite.prepare("UPDATE users SET consent_version='withdrawn' WHERE user_id=?").run(ownerId);
   if(clock)clock.set(new Date(Date.parse(state.deadline)+1).toISOString());
  });
  const response=await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"});
  assert.equal(response.status,409,JSON.stringify(await response.clone().json()));assert.deepEqual(state.counts(),before);
 }finally{restore?.();clock?.close();await state.close();}
});
for(const fault of["source-erasure","source-owner","source-resource","reference-expiry"])test("exact delivery backend: unavailable "+fault+" before preflight cannot validate a public fallback",async()=>{
 const state=await deliveryFixture({reference:fault==="reference-expiry"});
 try{
  const before=state.counts();
  if(fault==="source-erasure")state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='delivery-source')").run(new Date().toISOString(),stream);
  if(fault==="source-owner")state.sqlite.prepare("UPDATE event_private_payloads SET owner_id='assistant-viewer' WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='delivery-source')").run(stream);
  if(fault==="source-resource")state.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='block' AND resource_id='delivery-source'").run();
  if(fault==="reference-expiry")state.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.license_expires_at',?) WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='RightsAsserted' AND json_extract(payload,'$.reference_id')='delivery-reference')").run(new Date(Date.now()-1000).toISOString(),stream);
  const response=await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"});
  assert.ok(response.status===409||response.status===403,JSON.stringify(await response.clone().json()));assert.deepEqual(state.counts(),before);
 }finally{await state.close();}
});
test("exact delivery backend: two approvals in one batch cannot leave the first approval or task resolved",async()=>{
 const state=await deliveryFixture();
 try{
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));
  const before=state.counts(),event={type:"ArtifactApproved",payload:{...state.exact}};
  const response=await state.batch([event,{...event,payload:{...event.payload}}],state.viewer);
  assert.equal(response.status,409);assert.deepEqual(state.counts(),before);
  await body(await state.send("ArtifactApproved"));
 }finally{await state.close();}
});
test("exact delivery backend: concurrent decisions have one canonical winner",async()=>{
 const state=await deliveryFixture();
 try{
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));const before=state.counts();
  const results=await Promise.all([state.send("ArtifactApproved"),state.send("ArtifactChangesRequested",{review_note:"Use the approved sentence."})]);
  assert.equal(results.filter(result=>result.status===200).length,1);assert.ok(results.every(result=>[200,403,409].includes(result.status)));assert.equal(state.counts().reviewed,before.reviewed+1);
  assert.notEqual(JSON.parse(state.counts().taskState)[0].status,"pending");
 }finally{await state.close();}
});
test("exact delivery backend: a lost approval response remains a single readable canonical review",async()=>{
 const state=await deliveryFixture();
 try{
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));await state.send("ArtifactApproved");
  const before=state.counts(),retry=await state.send("ArtifactApproved");assert.ok([403,409].includes(retry.status));assert.deepEqual(state.counts(),before);
  const run=await measured(async()=>{const response=await state.request("/api/events?after=0&limit=5000&content=0",{headers:state.viewer});await state.drainBackground();return response;});
  const events=await body(run.result);assert.equal(events.events.filter(event=>event.type==="ArtifactApproved"&&event.payload.artifact_id===state.artifactId).length,1);
  traces.push({type:"review-recovery-GET",status:run.result.status,...run.metrics});assert.deepEqual(state.counts(),before);
 }finally{await state.close();}
});
for(const field of["content_sha256","artifact_revision","document_id"])test("exact delivery backend: exact "+field+" mismatch rejects release without writes",async()=>{
 const state=await deliveryFixture();
 try{
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));await body(await state.send("ArtifactApproved"));
  const before=state.counts(),response=await state.send("DocumentArtifactExported",{[field]:field==="artifact_revision"?1:field==="document_id"?"doc-atmosphere":"0".repeat(64)});
  assert.ok(response.status===403||response.status===409,JSON.stringify(await response.clone().json()));assert.deepEqual(state.counts(),before);
 }finally{await state.close();}
});
for(const governed of["same-project","same-owner","different-owner"])test("exact delivery backend: current "+governed+" governed source remains independently reviewable",async()=>{
 const state=await deliveryFixture({governed});
 try{
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));await body(await state.send("ArtifactApproved"));
  await body(await state.send("DocumentArtifactExported",{format:"application/pdf"}));
 }finally{await state.close();}
});
for(const fault of["private-erasure","private-owner","event-custody","resource-custody","package-erasure"])test("exact delivery backend: governed upstream "+fault+" without target head change blocks review",async()=>{
 const state=await deliveryFixture({governed:"different-owner"});let restore;
 try{
  const before=state.counts();
  restore=state.fault(()=>{
   if(fault==="private-erasure")state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),state.origin.sourceEventId);
   if(fault==="private-owner")state.sqlite.prepare("UPDATE event_private_payloads SET owner_id='assistant-viewer' WHERE private_event_id=?").run(state.origin.sourceEventId);
   if(fault==="event-custody")state.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(state.origin.sourceEventId);
   if(fault==="resource-custody")state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='block' AND resource_id=? AND project_access_id=?").run(state.origin.sourceBlockId,state.origin.sourceProjectAccessId);
   if(fault==="package-erasure")state.sqlite.prepare("UPDATE organization_context_package_contents SET redacted_at=?,content_json='' WHERE version_id=?").run(new Date().toISOString(),state.origin.versionId);
  });
  const response=await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"});assert.equal(response.status,409);assert.deepEqual(state.counts(),before);
 }finally{restore?.();await state.close();}
});
test("exact delivery backend: 50 native exact assignments fit D1 and generic 51 stays rejected",async()=>{
 const state=await deliveryFixture({blocks:100});
 try{
  const entries=[state.exact];for(let i=1;i<50;i++)entries.push(await state.anotherArtifact("delivery-artifact-"+i));
  const events=entries.map(payload=>({type:"ArtifactReviewRequested",payload:{...payload,assigned_reviewer_user_id:"assistant-viewer"}})),before=state.counts();
  const response=await state.batch(events);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.equal(state.counts().reviewed,before.reviewed+50);const after=state.counts();
  assert.equal((await state.batch([...events,events[0]])).status,400);assert.deepEqual(state.counts(),after);
 }finally{await state.close();}
});
test("exact delivery backend: cold schema checks and background work stay inside one D1 invocation",async()=>{
 const state=await deliveryFixture({blocks:100});
 try{
  state.env.DB={prepare:state.env.DB.prepare,batch:state.env.DB.batch};
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));
 }finally{await state.close();}
});

for(const target of["artifact","document"])for(const fault of["artifact-erasure","native-erasure"])test("exact delivery backend: legacy "+target+" export rechecks "+fault+" at mutation",async()=>{
 const state=await deliveryFixture();let restore;
 try{
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));await body(await state.send("ArtifactApproved"));
  const before=state.counts();restore=state.fault(()=>{
   if(fault==="artifact-erasure")state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),state.contentId);
   else state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='delivery-source')").run(new Date().toISOString(),stream);
  });
  const response=await state.send("ObjectExported",{artifact_id:undefined,artifact_revision:undefined,content_sha256:undefined,object_id:target==="artifact"?state.artifactId:documentId});
  assert.equal(response.status,409,JSON.stringify(await response.clone().json()));assert.deepEqual(state.counts(),before);
 }finally{restore?.();await state.close();}
});

test("exact delivery backend: legacy whole-document export guards every current artifact with one packed statement",async()=>{
 const state=await deliveryFixture();
 try{
  const exacts=[state.exact];for(let i=1;i<10;i++)exacts.push(await state.anotherArtifact("delivery-extra-"+i));
  await body(await state.batch(exacts.map(payload=>({type:"ArtifactReviewRequested",payload:{...payload,assigned_reviewer_user_id:"assistant-viewer"}}))));
  await body(await state.batch(exacts.map(payload=>({type:"ArtifactApproved",payload})),state.viewer));
  await body(await state.send("ObjectExported",{artifact_id:undefined,artifact_revision:undefined,content_sha256:undefined,object_id:documentId}));
  const before=state.counts();state.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='artifact' AND resource_id='delivery-extra-9'").run();
  const response=await state.send("ObjectExported",{artifact_id:undefined,artifact_revision:undefined,content_sha256:undefined,object_id:documentId});
  assert.ok([403,409].includes(response.status));assert.deepEqual(state.counts(),before);
 }finally{await state.close();}
});
for(const delta of[-1,0,1])test("exact delivery backend: database-time native rights deadline "+delta+"ms is strict",async()=>{
 const state=await deliveryFixture({reference:true}),clock=consequentialDbClock(state);let restore;
 try{
  const before=state.counts();restore=state.fault(()=>clock.set(new Date(Date.parse(state.deadline)+delta).toISOString()));
  const response=await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"});
  assert.equal(response.status,delta<0?200:409,JSON.stringify(await response.clone().json()));
  if(delta>=0)assert.deepEqual(state.counts(),before);
 }finally{restore?.();clock.close();await state.close();}
});
for(const operation of["ArtifactApproved","DocumentArtifactExported"])for(const mutation of["grant-expiry","source-erasure","session-expiry"])test("exact delivery backend: "+operation+" rechecks "+mutation+" at its own mutation",async()=>{
 const state=await deliveryFixture();let clock,restore;
 try{
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));
  if(operation==="DocumentArtifactExported")await body(await state.send("ArtifactApproved"));
  const actor=operation==="ArtifactApproved"?"assistant-viewer":ownerId,before=state.counts();
  if(mutation!=="source-erasure")clock=consequentialDbClock(state);
  if(mutation==="grant-expiry")state.sqlite.prepare("UPDATE capability_grants SET expires_at=? WHERE user_id='assistant-viewer' AND capability='project.review.approve'").run(state.deadline);
  if(mutation==="session-expiry")state.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE principal_user_id=?").run(state.deadline,actor);
  restore=state.fault(()=>{
   if(mutation==="source-erasure")state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='delivery-source')").run(new Date().toISOString(),stream);
   else clock.set(new Date(Date.parse(state.deadline)+1).toISOString());
  });
  const response=await state.send(operation);
  if(operation==="DocumentArtifactExported"&&mutation==="grant-expiry")assert.equal(response.status,200,"a valid independent historical approval does not confer ongoing reviewer authorship requirements on its current reader");
  else{assert.equal(response.status,409,JSON.stringify(await response.clone().json()));assert.deepEqual(state.counts(),before);}
 }finally{restore?.();clock?.close();await state.close();}
});

test("exact delivery backend: cold 100-package / 100-decision source proof stays within actual D1 query, binding and byte limits",async()=>{
 const state=await deliveryFixture();
 try{
  const entries=[],deadline=new Date(Date.now()+300_000).toISOString(),now=new Date().toISOString(),versions=[{block_id:"delivery-source",version:4}];
  for(let index=0;index<100;index++){
   const packageId="delivery-cost-package-"+index,versionId="delivery-cost-version-"+index,sourceDocumentId="delivery-cost-source-document-"+index,sourceBlockId="delivery-cost-source-block-"+index;
   const properties={text:"Licensed governed source "+index,rights_class:"owned_or_licensed",license_expires_at:deadline};
   entries.push(["DocumentCreated",{document_id:sourceDocumentId,title:"Independent source "+index}],
    ["BlockCreated",{document_id:sourceDocumentId,block_id:sourceBlockId,type:"message",handle:"source-"+index,position:"a",properties}]);
   const snapshot={schema:1,organizationId:state.organizationId,sourceProjectAccessId:state.projectAccessId,sourceDocumentId,blocks:[{sourceBlockId,type:"message",properties,rightsExpiresAt:deadline}]},content=JSON.stringify(snapshot),sha=await digest(content);
   state.sqlite.prepare("INSERT INTO organization_context_packages(package_id,organization_id,name,description,status,created_by_user_id,created_at,updated_at)VALUES(?,?,'License','','active',?,?,?)").run(packageId,state.organizationId,ownerId,now,now);
   state.sqlite.prepare("INSERT INTO organization_context_package_versions(version_id,package_id,organization_id,version,content_sha256,source_project_access_id,source_document_id,status,created_by_user_id,approved_by_user_id,published_at,created_at,redacted_at)VALUES(?,?,?,1,?,?,?,'published',?,'assistant-viewer',?,?,NULL)").run(versionId,packageId,state.organizationId,sha,state.projectAccessId,sourceDocumentId,ownerId,now,now);
   state.sqlite.prepare("INSERT INTO organization_context_package_contents(version_id,organization_id,content_json,created_at,redacted_at)VALUES(?,?,?,?,NULL)").run(versionId,state.organizationId,content,now);
   state.sqlite.prepare("INSERT INTO organization_context_package_sources(version_id,organization_id,source_project_access_id,source_block_id,source_kind,content_sha256,rights_expires_at,position)VALUES(?,?,?,?,'message',?,?,0)").run(versionId,state.organizationId,state.projectAccessId,sourceBlockId,sha,deadline);
   const local={organization_context_package_id:packageId,organization_context_package_version_id:versionId,rights_class:"owned_or_licensed"};
   if(index===0)for(const[property_path,new_value]of Object.entries(local))entries.push(["BlockPropertyEdited",{document_id:documentId,block_id:"delivery-source",property_path,new_value}]);
   else{
    const blockId="delivery-cost-local-"+index;entries.push(["BlockCreated",{document_id:documentId,block_id:blockId,type:"message",handle:"package-"+index,position:"b"+index,properties:{text:"Adopted source "+index,weight:1,...local}}]);versions.push({block_id:blockId,version:1});
   }
  }
  await state.seed(entries);const artifactId="delivery-cost-artifact";
  await state.seed([["DocumentRenderRequested",{artifact_id:artifactId,document_id:documentId,artifact_kind:"slides",source_block_versions:versions}],
   ["DocumentRenderCompleted",{artifact_id:artifactId,document_id:documentId,artifact_kind:"slides",title:"100 governed source proof",content_ref:state.contentId,item_count:1,source_block_versions:versions,requested_by_user_id:ownerId}]]);
  state.env.DB={prepare:state.env.DB.prepare,batch:state.env.DB.batch};
  await body(await state.send("ArtifactReviewRequested",{artifact_id:artifactId,source_block_versions:versions,assigned_reviewer_user_id:"assistant-viewer"}));
  const peak=traces.at(-1);assert.ok(peak.queries<900,JSON.stringify(peak));assert.ok(peak.binds<=100);assert.ok(peak.bytes<=100000);assert.ok(peak.valueBytes<=2000000);
 }finally{await state.close();}
});

for(const revoked of[false,true])test("exact delivery backend: mixed review batch "+(revoked?"cannot use stale changes-request permission":"retains separately authorized changes-request behavior"),async()=>{
 const state=await deliveryFixture();let restore;
 try{
  const membership=state.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id='assistant-viewer'").get(state.projectAccessId).membership_id;
  await body(await state.request("/api/workspaces/"+state.organizationId+"/projects/"+state.projectAccessId+"/members/"+membership,{method:"PATCH",headers:{...state.owner,"content-type":"application/json"},body:JSON.stringify({role:"editor"})}));
  const second=await state.anotherArtifact("delivery-new-assignment");
  await body(await state.send("ArtifactReviewRequested",{assigned_reviewer_user_id:"assistant-viewer"}));const before=state.counts();
  if(revoked)restore=state.fault(()=>state.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id='assistant-viewer' AND capability='project.review.approve'").run(new Date().toISOString()));
  const response=await state.batch([{type:"ArtifactChangesRequested",payload:{...state.exact,review_note:"Revise the exact output sentence."}},{type:"ArtifactReviewRequested",payload:second}],state.viewer);
  assert.equal(response.status,revoked?409:200,JSON.stringify(await response.clone().json()));
  if(revoked)assert.deepEqual(state.counts(),before);else assert.equal(state.counts().reviewed,before.reviewed+2);
 }finally{restore?.();await state.close();}
});

const {artifactSourceEvidenceGuard,artifactExactBatchGuard}=await import("../worker/artifact-review.ts");
const {readProjectSourceEvents}=await import("../worker/project-access.ts");

const evidenceScope=state=>({projectAccessId:state.projectAccessId,organizationId:state.organizationId,projectId,ownerUserId:ownerId});
const proofValue=(state,guard,prefix="")=>Boolean(state.sqlite.prepare("SELECT 1 AS retained WHERE "+prefix+guard.sql).get(...guard.bindings));
function withDepthRollback(state,mutate,check){
 state.sqlite.exec("SAVEPOINT exact_depth_truth");
 try{mutate();check();}finally{state.sqlite.exec("ROLLBACK TO exact_depth_truth");state.sqlite.exec("RELEASE exact_depth_truth");}
}
async function nativeEvidence(state){
 const scope=evidenceScope(state),events=await readProjectSourceEvents(state.env,scope);
 const proof=await artifactSourceEvidenceGuard(state.env,scope,documentId,events,[state.artifactId]);
 assert.ok(proof);return proof;
}

test("exact delivery depth: native byte/custody row predicates agree with frozen R2 including nullable fields",async()=>{
 const state=await deliveryFixture({reference:true});
 try{
  // Include a genuinely public source event, so absence of a private payload is also certified.
  const publicHead=Number(state.sqlite.prepare("SELECT MAX(sequence) AS n FROM events WHERE stream_id=?").get(stream).n);
  const publicSource=runtime.makeEvent(stream,publicHead+1,"user:"+ownerId,"legacy-public-fixture",crypto.randomUUID(),"BlockLocked",{project_id:projectId,document_id:documentId,block_id:"delivery-source",locked:true});
  const publicValues=runtime.eventWriteBindings(publicSource);publicValues[12]=JSON.stringify(publicSource.payload);publicValues[16]=null;
  state.sqlite.prepare("INSERT INTO event_write_stage("+runtime.EVENT_WRITE_COLUMNS+") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...publicValues);
  await synchronizeProjectScope(state.env,evidenceScope(state));
  const current=(await nativeEvidence(state)).guard,previous={sql:legacyNativeEvidenceSql,bindings:current.bindings};
  const check=(label,expected)=>{const before=proofValue(state,previous),after=proofValue(state,current);assert.equal(after,before,label+" old/new");assert.equal(after,expected,label);};
  check("unchanged Unicode source",true);
  const native=compileSqliteExpressionDepth(state.sqlite,"SELECT 1 AS retained WHERE "+current.sql,{bindings:current.bindings});
  assert.ok(native.ok,native.error);
  const negative=compileSqliteExpressionDepth(state.sqlite,"SELECT 1 AS retained WHERE "+previous.sql,{bindings:previous.bindings});
  assert.equal(negative.ok,false,"the old SQL is a real depth-100 negative control");assert.match(negative.error,/Expression tree is too large/);
  const source=state.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')='delivery-source'").get(stream).event_id;
  const snapshot=JSON.parse(current.bindings[0])[0],publicEvent=snapshot.events.find(event=>event.privateJson===null);
  assert.ok(publicEvent,"fixture includes absent private JSON and owner");
  const mutate=(label,sql,values)=>withDepthRollback(state,()=>state.sqlite.prepare(sql).run(...values),()=>check(label,false));
  // Events themselves remain append-only. Compare stale expected envelopes against those immutable rows.
  for(const[field,value]of[["eventId","different-event"],["sequence",999999],["type","DifferentEvent"],["actor","user:different-actor"],["clientId","different-client"],["correlationId","different-correlation"],["causationId","non-null-cause"],["compensatesEventId","non-null-compensation"],["payload",'{"public":"changed"}']]){
   const packet=JSON.parse(current.bindings[0]);packet[0].events.find(event=>event.eventId===source)[field]=value;
   const bindings=[JSON.stringify(packet)];assert.equal(proofValue(state,{...previous,bindings}),false,"old expected "+field);assert.equal(proofValue(state,{...current,bindings}),false,"current expected "+field);
  }
  for(const[field,value]of[["private_json",'{"properties":{"text":"changed café 👩🏽‍🎨"}}'],["owner_id","different-private-owner"],["redacted_at",new Date().toISOString()]])
   mutate("private "+field,"UPDATE event_private_payloads SET "+field+"=? WHERE private_event_id=?",[value,source]);
  mutate("private row missing","DELETE FROM event_private_payloads WHERE private_event_id=?",[source]);
  mutate("unexpected public-event private row","INSERT INTO event_private_payloads(private_event_id,owner_id,private_json,created_at) VALUES(?,?,?,?)",[publicEvent.eventId,ownerId,"{}",new Date().toISOString()]);
  for(const field of["project_access_id","organization_id","project_id","owner_user_id","source_stream_id","actor_user_id"])
   mutate("event custody "+field,"UPDATE project_event_scopes SET "+field+"=? WHERE event_id=?",["different-"+field,source]);
  mutate("event custody source_sequence","UPDATE project_event_scopes SET source_sequence=source_sequence+1 WHERE event_id=?",[source]);
  mutate("event custody absent","DELETE FROM project_event_scopes WHERE event_id=?",[source]);
  for(const field of["resource_kind","resource_id","project_access_id","organization_id","project_id","owner_user_id","visibility"])
   mutate("resource "+field,"UPDATE project_resource_scopes SET "+field+"=? WHERE resource_kind='block' AND resource_id='delivery-source'",["different-"+field]);
  mutate("resource absent","DELETE FROM project_resource_scopes WHERE resource_kind='block' AND resource_id='delivery-source'",[]);
  check("rollback restores every original byte",true);
 }finally{await state.close();}
});

test("exact delivery depth: materialized rights anti-join agrees with frozen R2 for exact bytes, revisions, deadlines and missing rights",async()=>{
 const state=await deliveryFixture();
 try{
  const proof=await nativeEvidence(state),scope=evidenceScope(state);
  const currentBinding={contentId:state.contentId,content:state.content,revision:0,rightsGuard:proof.guard,rightsValidUntil:null};
  const previousBinding={...currentBinding,rightsGuard:{sql:legacyNativeEvidenceSql,bindings:proof.guard.bindings}};
  const current=artifactExactBatchGuard(scope,new Map([[state.artifactId,currentBinding]]));
  const previous=legacyArtifactExactBatchGuard(scope,new Map([[state.artifactId,previousBinding]]));
  assert.ok(current&&previous);assert.deepEqual(current.bindings,previous.bindings);
  const check=(label,expected,guards=[previous,current])=>{const values=guards.map(guard=>proofValue(state,guard,"1"));assert.deepEqual(values,[expected,expected],label);};
  check("unchanged exact artifact",true);
  assert.ok(compileSqliteExpressionDepth(state.sqlite,"SELECT 1 AS retained WHERE 1"+current.sql,{bindings:current.bindings}).ok);
  const mutate=(label,sql,values)=>withDepthRollback(state,()=>state.sqlite.prepare(sql).run(...values),()=>check(label,false));
  for(const[field,value]of[["content","changed exact bytes"],["owner_id","different-owner"],["kind","different-kind"],["redacted_at",new Date().toISOString()],["expires_at","2000-01-01T00:00:00.000Z"]])
   mutate("retained "+field,"UPDATE private_content SET "+field+"=? WHERE content_id=?",[value,state.contentId]);
  for(const kind of["artifact","content"])for(const field of["resource_kind","resource_id","project_access_id","organization_id","project_id","owner_user_id","visibility"])
   mutate(kind+" resource "+field,"UPDATE project_resource_scopes SET "+field+"=? WHERE resource_kind=? AND resource_id=?",["different-"+field,kind,kind==="artifact"?state.artifactId:state.contentId]);
  const next=Number(state.sqlite.prepare("SELECT MAX(sequence) AS n FROM events WHERE stream_id=?").get(stream).n)+1;
  const edited=runtime.makeEvent(stream,next,"user:"+ownerId,"depth-oracle",crypto.randomUUID(),"DocumentArtifactEdited",{project_id:projectId,document_id:documentId,artifact_id:state.artifactId});
  mutate("one additional revision","INSERT INTO event_write_stage("+runtime.EVENT_WRITE_COLUMNS+") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",runtime.eventWriteBindings(edited));
  for(const [sql,bindings,expected]of[["1",[],true],["0",[],false],["NULL",[],false],["?",[1],true],["?",[0],false],["?",[null],false]]){
   const binding={...currentBinding,rightsGuard:{sql,bindings}};
   check("SQL rights truth "+sql+JSON.stringify(bindings),expected,[legacyArtifactExactBatchGuard(scope,new Map([[state.artifactId,binding]])),artifactExactBatchGuard(scope,new Map([[state.artifactId,binding]]))]);
  }
  for(const[label,mutatePacked,expected]of[
   ["unmatched rights index",packet=>{packet.artifacts[0].right=99;},false],
   ["null rights index",packet=>{packet.artifacts[0].right=null;},false],
   ["missing rights index",packet=>{delete packet.artifacts[0].right;},false],
   ["missing rights row",packet=>{packet.rights=[];},false],
   ["unknown rights kind",packet=>{packet.rights[0].kind=999;},false],
   ["unused unknown rights kind",packet=>{packet.rights.push({kind:999,bindings:[]});},true],
  ]){
   const packet=JSON.parse(current.bindings[0]);mutatePacked(packet);
   check(label,expected,[{...previous,bindings:[JSON.stringify(packet)]},{...current,bindings:[JSON.stringify(packet)]}]);
  }
  check("rollback restores exact artifact",true);
  const clock=consequentialDbClock(state),deadline="2099-01-01T00:00:00.000Z";
  try{
   const pair=[legacyArtifactExactBatchGuard(scope,new Map([[state.artifactId,{...previousBinding,rightsValidUntil:deadline}]])),artifactExactBatchGuard(scope,new Map([[state.artifactId,{...currentBinding,rightsValidUntil:deadline}]]))];
   for(const delta of[-1,0,1]){clock.set(new Date(Date.parse(deadline)+delta).toISOString());check("database deadline "+delta,delta<0,pair);}
  }finally{clock.close();}

 }finally{await state.close();}
});

for(const fault of["second-event","public-envelope","private-payload","event-custody","custody-sequence"])test("exact delivery depth: atomic full-write boundary rolls back "+fault+" suppression or corruption",async()=>{
 const state=await deliveryFixture();
 try{
  const second=await state.anotherArtifact("delivery-depth-second"),target=second.artifact_id;
  const counts=()=>({...state.counts(),privateRows:state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads").get().n,
   eventScopes:state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes").get().n,
   resources:state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes").get().n});
  const before=counts(),quoted="'"+target+"'";
  if(fault==="second-event")state.sqlite.exec("CREATE TRIGGER depth_fault BEFORE INSERT ON event_write_stage WHEN NEW.type='ArtifactReviewRequested' AND json_extract(NEW.payload,'$.artifact_id')="+quoted+" BEGIN SELECT RAISE(IGNORE); END");
  if(fault==="public-envelope")state.sqlite.exec("CREATE TRIGGER depth_fault AFTER INSERT ON events WHEN NEW.type='ArtifactReviewRequested' AND json_extract(NEW.payload,'$.artifact_id')="+quoted+" BEGIN UPDATE events SET client_id='corrupted-client' WHERE event_id=NEW.event_id; END");
  if(fault==="private-payload")state.sqlite.exec("CREATE TRIGGER depth_fault BEFORE INSERT ON event_private_payloads WHEN EXISTS(SELECT 1 FROM events event WHERE event.event_id=NEW.private_event_id AND event.type='ArtifactReviewRequested' AND json_extract(event.payload,'$.artifact_id')="+quoted+") BEGIN SELECT RAISE(IGNORE); END");
  if(fault==="event-custody")state.sqlite.exec("CREATE TRIGGER depth_fault BEFORE INSERT ON project_event_scopes WHEN EXISTS(SELECT 1 FROM events event WHERE event.event_id=NEW.event_id AND event.type='ArtifactReviewRequested' AND json_extract(event.payload,'$.artifact_id')="+quoted+") BEGIN SELECT RAISE(IGNORE); END");
  if(fault==="custody-sequence")state.sqlite.exec("CREATE TRIGGER depth_fault AFTER INSERT ON project_event_scopes WHEN EXISTS(SELECT 1 FROM events event WHERE event.event_id=NEW.event_id AND event.type='ArtifactReviewRequested' AND json_extract(event.payload,'$.artifact_id')="+quoted+") BEGIN UPDATE project_event_scopes SET source_sequence=source_sequence+1 WHERE event_id=NEW.event_id; END");
  const requests=[state.exact,second].map(payload=>({type:"ArtifactReviewRequested",payload:{...payload,assigned_reviewer_user_id:"assistant-viewer",review_note:"Retained private review instruction"}}));
  const result=await state.batch(requests);assert.equal(result.status,409,JSON.stringify(await result.clone().json()));assert.deepEqual(counts(),before);
  assert.match(state.controls.lastDatabaseError,fault==="public-envelope"?/events are append-only/:/NOT NULL constraint failed: project_migration_states.last_owner_sequence/);
 }finally{await state.close();}
});

test.after(()=>{const unique=new Map(traces.map(trace=>[JSON.stringify([trace.type,trace.status,trace.queries,trace.binds,trace.bytes]),trace]));for(const trace of unique.values())console.log("DELIVERY_D1 "+JSON.stringify(trace));});
