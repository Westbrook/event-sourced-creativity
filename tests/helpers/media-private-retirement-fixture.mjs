import fs from "node:fs";
import {registerHooks} from "node:module";
import assert from "node:assert/strict";

// Full production component classes, full Store and actual Worker/in-memory SQLite.
// Only native rendering/event ports and delayed transport delivery are synthetic.
// Provider requests are mocked during setup; external calls are prohibited thereafter.
const url=file=>new URL("../../"+file,import.meta.url).href;

const ts=(await import(url("node_modules/typescript/lib/typescript.js"))).default;
const fixtureUrl=new URL(url("tests/scene-policy-stop-guidance.test.mjs"));
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),fixtureTree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=fixtureTree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)
 ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(fixtureTree)==="hook.deregister");
const moduleSource=declarations.map(node=>node.getFullText(fixtureTree)).join("\n")+"\nexport {createPilotSceneFixture,createSceneStoreHost,policyComposer,createSceneComposer,GenerationInputDialog,loadActual,action,enabled,createButton,invoke,settle,sceneIdle,sceneSubmitted,receiptReady,receiptComponent,closeReceipt,untilScene};\n";
const moduleUrl=new URL("./media-private-retirement-scene-fixture.mjs",fixtureUrl).href;
const fixtureHook=registerHooks({resolve(specifier,context,next){return specifier===moduleUrl?{url:moduleUrl,shortCircuit:true}:next(specifier,context);},load(specifier,context,next){return specifier===moduleUrl?{format:"module",source:moduleSource,shortCircuit:true}:next(specifier,context);}});
const{createPilotSceneFixture,createSceneStoreHost,policyComposer,createSceneComposer,loadActual,action,enabled,createButton,invoke,settle,sceneIdle,receiptReady,receiptComponent,untilScene}=await import(moduleUrl);fixtureHook.deregister();
const financialTables=["document_jobs","budget_reservations","cost_budget_reservations","budget_counters","cost_budget_counters","project_budget_reservation_scopes","pilot_cost_reservation_scopes"];
const money=worker=>({...Object.fromEntries(financialTables.map(table=>[table,worker.sqlite.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()])),generationLedger:worker.sqlite.prepare("SELECT * FROM events WHERE type IN ('BudgetReserved','BudgetReleased','GenerationUsageRecorded') ORDER BY stream_id,sequence").all()});
async function mediaFixture(t,options={}){
 const x=await policyComposer(t,{member:true,unknown:true,...options}),{h,worker,f,id}=x;
 const membership=worker.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(worker.sharing.projectAccessId,worker.actorUserId);assert.ok(membership);
 const nativeDispatch=h.window.dispatchEvent;
 h.window.dispatchEvent=function(event){const value=nativeDispatch.call(this,event);for(const listener of [...(f.listeners.get(event.type)??[])])listener(event);return value;};
 t.after(()=>{h.window.dispatchEvent=nativeDispatch;});
 t.mock.method(globalThis,"fetch",async(input,init={})=>{assert.ok(String(input).startsWith("/api/"),"No provider or external call after the genuine unknown fixture");return h.fetch(input,init);});
 const original=money(worker),calls=x.calls.length,posts=h.requests.filter(r=>r.init.method==="POST").length;
 assert.equal(worker.cost()[0].status,"executing");assert.ok(worker.cost()[0].reserved_microusd>0);assert.equal(worker.cost()[0].used_microusd,0);
 assert.equal(worker.tokens()[0].status,"active");assert.equal(x.calls.length,1);
 const restore=()=>worker.sqlite.prepare("UPDATE project_memberships SET status='active',updated_at=? WHERE membership_id=?").run(new Date().toISOString(),membership.membership_id);
 const revoke=()=>worker.sqlite.prepare("UPDATE project_memberships SET status='revoked',updated_at=? WHERE membership_id=?").run(new Date().toISOString(),membership.membership_id);
 const retire=async()=>{revoke();const response=await worker.request("/api/events?after=0&limit=2000&content=0");assert.equal(response.status,403);try{await h.store.refreshEvents();}catch(error){assert.match(error.message,/403/);} };
 const recovered=async()=>{restore();await h.store.refreshEvents();};
 const noMutation=(allowOriginalInspection=false)=>{assert.deepEqual(money(worker),original);assert.equal(x.calls.length,calls);const extra=h.requests.filter(r=>r.init.method==="POST").slice(posts);if(allowOriginalInspection)assert.ok(extra.every(r=>r.url==="/api/document-jobs"&&r.body?.payload?.sceneCostPreview===true&&r.body.payload.sceneRequestId===id&&!r.body.payload.sceneCostConsent),"only an explicit free inspection of the exact existing Scene request");else assert.deepEqual(extra,[]);};
 return{...x,original,callsBefore:calls,retire,recovered,revoke,restore,noMutation};
}

const reliabilityUrl=new URL(url("tests/document-generation-reliability.test.mjs")),reliabilityText=fs.readFileSync(reliabilityUrl,"utf8"),reliabilityTree=ts.createSourceFile(reliabilityUrl.pathname,reliabilityText,ts.ScriptTarget.Latest,true);
const fixtureNames=new Set(["INDEPENDENT_SLIDE_SCORES","INDEPENDENT_SLIDE_QUOTE","INDEPENDENT_SLIDE_TITLES","seedIndependentPresentation","independentProviderResponse","presentationAdmission"]);
const fixtureParts=reliabilityTree.statements.filter(node=>ts.isFunctionDeclaration(node)?fixtureNames.has(node.name?.text):ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>fixtureNames.has(d.name.getText(reliabilityTree))));
const presentationFixtureSource='import {appendAuditEvent} from '+JSON.stringify(url("worker/runtime.ts"))+';\n'+fixtureParts.map(node=>node.getFullText(reliabilityTree)).join("\n")+"\nexport {seedIndependentPresentation,independentProviderResponse,presentationAdmission};";
const {seedIndependentPresentation,independentProviderResponse,presentationAdmission}=await import("data:text/javascript;base64,"+Buffer.from(presentationFixtureSource).toString("base64"));
async function presentationFixture(t,{locale="en"}={}){
 const worker=await createPilotSceneFixture({count:1,pilot:false,member:true,shared:true});
 const documentId=await seedIndependentPresentation({environment:worker.env},"retained-private-presentation");
 assert.equal((await worker.request("/api/events?after=0&limit=2000&content=0")).status,200);
 const calls=[];
 t.mock.method(globalThis,"fetch",async(input,init)=>{
  assert.equal(String(input),"https://api.openai.com/v1/responses");calls.push(JSON.parse(init.body));
  if(calls.length===2)throw new TypeError("In-memory lost provider repair response");
  assert.equal(calls.length,1,"no unbounded provider repair");
  const output=independentProviderResponse(init.body);output.title="PRIVATE_REJECTED_TITLE";output.summary="PRIVATE_REJECTED_SUMMARY";
  output.items[0].slide.citations[0].excerpt="PRIVATE unsupported quotation that never appeared in the source";
  return Response.json({id:"source-retirement-draft-1",model:"gpt-5.6-terra",output_text:JSON.stringify(output),usage:{input_tokens:120,output_tokens:45,total_tokens:165}});
 });
 const admission=await worker.request("/api/document-jobs",worker.json(presentationAdmission(documentId,"media-source-"+crypto.randomUUID())));assert.equal(admission.status,202,await admission.clone().text());
 const job=(await admission.json()).job;
 const response=await worker.request("/api/document-jobs/"+job.jobId+"/run",worker.json({})),result=await response.json();
 assert.equal(response.status,200);assert.equal(result.job.status,"failed",JSON.stringify(result));assert.equal(calls.length,2);
 const h=await createSceneStoreHost({workerFixture:{...worker,documentId,requestId:job.jobId,payload:{...worker.payload,workflowId:"",workflowStageId:"",workflowSources:[]}}});t.after(()=>h.close());
 h.store.documentJobs.set([result.job]);h.store.ui.instrumentation=false;
 const f=await createSceneComposer(t,{locale,storeHost:h});f.host.disconnectedCallback();f.host.isConnected=false;
 const {PresentationRejectedDrafts}=await loadActual("src/components/presentation-rejected-drafts.ts");
 const host=new PresentationRejectedDrafts();host.store=h.store;host.i18n=f.i18n;host.documentId=documentId;host.jobs=[result.job];host.isConnected=true;f.host=host;host.connectedCallback();f.draw();
 const nativeDispatch=h.window.dispatchEvent;h.window.dispatchEvent=function(event){const value=nativeDispatch.call(this,event);for(const listener of[...(f.listeners.get(event.type)??[])])listener(event);return value;};t.after(()=>{h.window.dispatchEvent=nativeDispatch;});
 t.mock.method(globalThis,"fetch",async(input,init={})=>{assert.ok(String(input).startsWith("/api/"),"No provider/external call after retained presentation setup");return h.fetch(input,init);});
 await settle(f);
 const membership=worker.sqlite.prepare("SELECT membership_id FROM project_memberships WHERE project_access_id=? AND user_id=?").get(worker.sharing.projectAccessId,worker.actorUserId);assert.ok(membership);
 const original=money(worker),posts=h.requests.filter(r=>r.init.method==="POST").length;let expectedJobRows=original.document_jobs;
 const cost=worker.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE correlation_id=?").get(job.jobId+":attempt:1");assert.equal(cost.status,"executing");assert.ok(cost.reserved_microusd>0);
 const checkpoint=JSON.parse(worker.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(job.jobId).result_json);assert.equal(checkpoint.generationReceipt.provider_request_status,"submission_unknown");
 const setMembership=status=>worker.sqlite.prepare("UPDATE project_memberships SET status=?,updated_at=? WHERE membership_id=?").run(status,new Date().toISOString(),membership.membership_id);
 const retire=async()=>{setMembership("revoked");assert.equal((await worker.request("/api/events?after=0&limit=2000&content=0")).status,403);try{await h.store.refreshEvents();}catch(error){assert.match(error.message,/403/);}};
 const recovered=async()=>{setMembership("active");await h.store.refreshEvents();};
 const acknowledgePreservation=candidate=>{
  assert.equal(candidate.jobId,job.jobId);assert.equal(candidate.responseId,"source-retirement-draft-1");assert.equal(candidate.retentionClass,"governed-evidence");
  const after=money(worker);for(const table of financialTables.filter(table=>table!=="document_jobs"))assert.deepEqual(after[table],original[table],table+" accounting is unchanged by explicit private preservation");
  assert.equal(after.document_jobs.length,original.document_jobs.length);
  const beforeRow=original.document_jobs.find(row=>row.job_id===job.jobId),afterRow=after.document_jobs.find(row=>row.job_id===job.jobId);
  assert.deepEqual({...afterRow,result_json:beforeRow.result_json,updated_at:beforeRow.updated_at},{...beforeRow},"all other original job fields remain exact");
  const expected=JSON.parse(beforeRow.result_json),actual=JSON.parse(afterRow.result_json);
  expected.presentationCandidates=expected.presentationCandidates.map(entry=>entry.responseId===candidate.responseId?{...entry,contentExpiresAt:candidate.expiresAt,retentionClass:"governed-evidence"}:entry);
  assert.deepEqual(actual,expected,"only the exact candidate's acknowledged retention fields change; raw submission/receipt/usage stays exact");
  expectedJobRows=after.document_jobs;
 };
 const noMutation=(allowPreserve=false)=>{assert.deepEqual(money(worker),{...original,document_jobs:expectedJobRows});assert.equal(calls.length,2);const extra=h.requests.filter(r=>r.init.method==="POST").slice(posts);if(allowPreserve){assert.equal(extra.length,1);assert.equal(extra[0].url,"/api/document-jobs/"+job.jobId+"/presentation-candidates/source-retirement-draft-1/preserve");}else assert.deepEqual(extra,[]);};
 const open=async()=>{await f.click(f.i18n.t("presentation.draft.review"));await untilScene(()=>{f.draw();return f.visible().includes("PRIVATE_REJECTED_TITLE");});};
 return{worker,h,f,job:result.job,id:job.jobId,documentId,retire,recovered,noMutation,acknowledgePreservation,open,calls};
}

export {mediaFixture,presentationFixture,settle,sceneIdle,receiptReady,receiptComponent,untilScene,invoke,action,enabled,createButton};

async function presentationFullShellFixture(t,options={}){
 const x=await presentationFixture(t,options),{h}=x;
 const original={events:h.store.events.get(),content:h.store.content.get(),head:h.store.head.get(),session:h.store.session.get()};
 x.f.host.disconnectedCallback();x.f.host.isConnected=false;
 const {createCalmFullPage}=await import("./calm-full-page-fixture.mjs");
 const full=await createCalmFullPage(t,{locale:options.locale??"en",storeHost:h});
 // The reusable layout fixture's synthetic layout data is not source authority.
 // Restore the actual Worker-backed snapshot and signed session before the audited gesture.
 h.store.events.set(original.events);h.store.content.set(original.content);h.store.head.set(original.head);h.store.session.set(original.session);
 h.store.route.set("/document/"+x.documentId+"/retirement-proof");
 const dispatch=h.window.dispatchEvent;
 h.window.dispatchEvent=function(event){const result=dispatch.call(this,event);for(const handler of[...(full.listeners.get(event.type)??[])])handler(event);return result;};
 t.after(()=>{h.window.dispatchEvent=dispatch;});await full.settle();
 assert.equal(h.store.session.get(),original.session);assert.deepEqual(h.store.events.get(),original.events);
 const results=async()=>{const selected=full.find("button",node=>node.attributes["data-workbench-pane"]==="result");await full.act(selected);};
 const owner=()=>full.components().find(component=>component.tag==="forma-presentation-rejected-drafts");
 const open=async()=>{await results();const control=full.find("button",node=>node.text===full.i18n.t("presentation.draft.review"));await full.act(control);await untilScene(()=>{full.draw();return full.renderer.markup.includes("PRIVATE_REJECTED_TITLE");});};
 x.noMutation();return{...x,full,owner,open,results};
}

export {presentationFullShellFixture};
