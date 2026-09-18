import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { createPilotSceneFixture, pendingCheckpoint, scenePilotProvider } from "./helpers/scene-pilot-fixture.mjs";
import { authorizedGenerationFailureRemediation, documentJobFailure, generationFailureGuidance } from "../src/model/document-jobs.ts";
import { isSceneSafeUnusedProof } from "../src/model/scene-cost-consent.ts";

const fixtureUrl=new URL("./scene-composer-recovery.test.mjs",import.meta.url);
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),tree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=tree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)
  ||ts.isExpressionStatement(node)&&ts.isBinaryExpression(node.expression)&&node.expression.left.getText(tree)==="fixtureModule"
  ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(tree)==="fixtureHook.deregister");
const fixtureModule=declarations.map(node=>node.getFullText(tree)).join("\n")
  +"\nexport { createSceneComposer, GenerationInputDialog, loadActual, action, enabled, createButton, invoke, settle, sceneIdle, sceneSubmitted, receiptReady, receiptComponent, closeReceipt, untilScene };\n";
const moduleUrl=new URL("./scene-policy-stop-guidance-fixture.mjs",import.meta.url).href;
const hook=registerHooks({resolve(specifier,context,next){return specifier===moduleUrl?{url:moduleUrl,shortCircuit:true}:next(specifier,context);},
  load(url,context,next){return url===moduleUrl?{format:"module",source:fixtureModule,shortCircuit:true}:next(url,context);}});
const {createSceneComposer,GenerationInputDialog,loadActual,action,enabled,createButton,invoke,settle,sceneIdle,sceneSubmitted,receiptReady,receiptComponent,closeReceipt,untilScene}=await import(moduleUrl);
hook.deregister();
const {localizeTemplateResult}=await loadActual("src/components/design-system/localized-template.ts");
const expected=[{"en":"Scene stopped at an application eligibility check","fr":"La scène a été arrêtée lors du contrôle d’éligibilité de l’application","ar":"توقف المشهد عند التحقق من أهلية التطبيق","ja":"アプリケーションの利用資格確認でシーンを停止しました","id":"system.auto.1jp4jox.49"},{"en":"Forma could not confirm current application eligibility, access, or spending limits before the next provider request. Review these settings with an authorized administrator. Earlier confirmed usage remains recorded; this stop does not clear uncertain charges or budget holds.","fr":"Forma n’a pas pu confirmer l’éligibilité, les accès ou les plafonds de dépenses actuels de l’application avant la requête fournisseur suivante. Examinez ces réglages avec une personne habilitée à administrer le projet. Les consommations déjà confirmées restent enregistrées ; cet arrêt n’efface ni les frais incertains ni les réservations budgétaires.","ar":"تعذّر على Forma التحقق من أهلية التطبيق الحالية أو صلاحيات الوصول أو حدود الإنفاق قبل طلب المزود التالي. راجع هذه الإعدادات مع مسؤول مخوّل. يظل الاستخدام السابق المؤكد مسجّلًا؛ ولا يزيل هذا التوقف الرسوم غير المحسومة أو حجوزات الميزانية.","ja":"次のプロバイダーリクエストの前に、Forma は現在のアプリケーション利用資格、アクセス権、または支出上限を確認できませんでした。権限のある管理者と設定を確認してください。以前の確認済み使用量は記録されたままです。この停止によって未確定の料金や予算の予約が解消されるわけではありません。","id":"system.auto.1u72lzg.275"},{"en":"Review application settings","fr":"Examiner les réglages de l’application","ar":"مراجعة إعدادات التطبيق","ja":"アプリケーション設定を確認","id":"system.auto.cmxkwk.27"},{"en":"Inspect original Scene inputs · free","fr":"Examiner les entrées de scène d’origine · gratuit","ar":"فحص مدخلات المشهد الأصلية · مجانًا","ja":"元のシーン入力を確認 · 無料","id":"system.auto.i85a3k.36"},{"en":"Application status","fr":"Statut de l’application","ar":"حالة التطبيق","ja":"アプリケーションのステータス","id":"system.auto.p3cosp.18"}];
const copy=(locale,index)=>expected[index][locale];
const paidRequests=h=>h.requests.filter(request=>request.url==="/api/document-jobs"&&request.body?.payload?.sceneCostConsent);
const decode=value=>value.replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&amp;","&").replaceAll("&quot;",'"').replaceAll("&#39;","'");
const text=value=>decode(value.replace(/<[^>]+>/gu,"")).trim();
const checkpoint=(worker,id)=>JSON.parse(worker.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(id).result_json);
const jobRow=(worker,id)=>worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id);
const controls=(f,body,tag)=>[...body.matchAll(new RegExp("<"+tag+"\\b([^>]*)>([\\s\\S]*?)<\\/"+tag+">","gu"))]
  .map(([,raw,body])=>({...f.renderer.attrs(raw),text:text(body)}));
function failureCard(f){
  const cards=[...f.host.markup.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gu)];
  const card=cards.find(([,raw])=>String(f.renderer.attrs(raw).attributes.class??"").split(/\s+/u).includes("document-artifact-failure-card"));
  assert.ok(card,"the actual document failure card renders");
  const body=card[2];
  return{body,title:text(body.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/u)?.[1]??""),summary:text(body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/u)?.[1]??""),
    buttons:controls(f,body,"button"),links:controls(f,body,"a"),visible:text(body)};
}
function automaticLocale(f){
  const render=f.renderer.value;
  f.renderer.value=function(value,...rest){return render.call(this,localizeTemplateResult(value,f.i18n),...rest);};
  f.renderer.registry["forma-generation-input-dialog"]=GenerationInputDialog;f.host.launcherOnly=false;f.draw();
}
async function pilotStatus(worker,status){
  const response=await worker.asOwner("/api/workspaces/"+worker.sharing.organizationId+"/pilot",{...worker.json({status}),method:"PATCH"});
  assert.equal(response.status,200,await response.clone().text());
}
async function recertifySession(h){
  const response=await h.worker.request("/api/session");assert.equal(response.status,200);
  h.store.session.set(await response.json());await h.store.refreshEvents();
}
async function policyComposer(t,{locale="en",mode="managed",medium="visual",afterPaid=false,unknown=false,member=false,shared=true}={}){
  const worker=await createPilotSceneFixture({count:mode==="manual"?1:9,medium,mode,member,pilot:shared,shared});
  const calls=scenePilotProvider(t,{badFirst:afterPaid,uncertainAt:unknown?1:0});
  const h=await createSceneStoreHost({medium,shared,workerFixture:worker});t.after(()=>h.close());
  const f=await createSceneComposer(t,{locale,storeHost:h,workflow:mode==="managed",medium});automaticLocale(f);
  const reads=[];
  h.intercept=async request=>{
    if(request.url!=="/api/document-jobs"||request.body?.payload?.sceneCostPreview!==true)return;
    const response=await worker.request(request.url,request.init);reads.push({request,body:await response.clone().json()});return response;
  };
  await f.openScene({mode,selectedMedium:medium});await f.check();assert.equal(enabled(createButton(f)),true);
  await f.submit();await untilScene(()=>worker.counts().document_jobs===1);await sceneSubmitted(f);
  const id=paidRequests(h)[0].body.payload.sceneRequestId,seen=new Set();let paused=false;
  worker.controls.beforeRun=async statement=>{
    const pending=pendingCheckpoint(statement);if(!pending||paused||unknown)return;
    for(const entry of pending.entries)if(entry.status==="pending")seen.add(entry.clientRequestId);
    if(seen.size!==(afterPaid?2:1))return;
    paused=true;if(shared)worker.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(worker.cohort.cohortId);
    else worker.sqlite.prepare("UPDATE budget_counters SET hard_limit_tokens=1 WHERE scope='user' AND scope_id=?").run(worker.actorUserId);
  };
  const response=await worker.request("/api/document-jobs/"+encodeURIComponent(id)+"/run",worker.json({})),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.job.status,"failed",JSON.stringify(body.job.errorDetail));
  assert.equal(paused,!unknown);assert.equal(calls.length,unknown||afterPaid?1:0);
  await h.store.syncDocumentJobs();await settle(f);
  const job=h.store.documentJobs.get().find(job=>job.jobId===id);assert.ok(job);assert.equal(job.status,"failed");
  return{worker,h,f,id,job,runJob:body.job,calls,reads,mode,medium};
}
async function inspectFailure(f,card){
  const primary=card.buttons.find(button=>button.attributes.class==="button primary compact");
  assert.ok(primary,"the current primary action exists");
  await invoke(f,primary);await receiptReady(f);
  const component=receiptComponent(f);assert.ok(component?.inspection);
  return component;
}
function nodeText(markup,node){
  const start=markup.indexOf(node.full);assert.notEqual(start,-1,"the real control belongs to the current component");
  const bodyStart=start+node.full.length,end=markup.indexOf("</"+node.tag+">",bodyStart);assert.notEqual(end,-1);
  return text(markup.slice(bodyStart,end));
}
async function copyReceiptEvidence(f,component,inspection){
  const button=f.renderer.ownNodes(component,"button").find(node=>nodeText(component.markup,node)===f.i18n.system("Copy receipt"));
  assert.ok(button,"the existing localized Copy receipt control is present");
  await button.handlers.click.call(component,{target:button,currentTarget:button});
  assert.equal(f.clipboard.at(-1),JSON.stringify(inspection.receipt,null,2),"the activated copy control preserves the exact receipt JSON");
}
function receiptFacts(f,component){
  return Object.fromEntries([...component.markup.matchAll(/<div><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/gu)].map(([,label,value])=>[text(label),text(value)]));
}
const shape={code:"scene_paid_authority_changed",category:"access",scope:"project",action:"check_project",httpStatus:403,retryable:false,retryAfterMs:null,requestId:null};

for(const locale of ["en","fr","ar","ja"])for(const member of [false,true])for(const afterPaid of [false,true])
test("Scene policy stop "+locale+"/"+(member?"member/":"owner/")+(afterPaid?"earlier-paid":"first-attempt")+": actual failure guidance and receipt distinguish application eligibility",async t=>{
  const {worker,h,f,id,job,runJob,calls,reads}=await policyComposer(t,{locale,afterPaid,member});
  const card=failureCard(f);
  assert.equal(card.title,copy(locale,0));
  assert.equal(card.summary,copy(locale,1),"guidance keeps prior usage and uncertain holds explicit");
  assert.equal(card.buttons.filter(button=>button.attributes.class==="button primary compact").length,1);
  assert.equal(card.buttons.find(button=>button.attributes.class==="button primary compact")?.text,copy(locale,3),"free original inspection is primary");
  assert.equal(card.buttons.some(button=>button.text===f.i18n.system("Review & change request")),false,"prompt editing is not a policy remedy");
  assert.ok(card.visible.includes(copy(locale,4)+": 403"));assert.equal(card.visible.includes(f.i18n.system("Provider status")+": 403"),false);
  assert.deepEqual(Object.fromEntries(Object.keys(shape).map(key=>[key,documentJobFailure(job)[key]])),shape);
  assert.equal(Object.hasOwn(runJob.result??{},"generationReceipt"),false,"shared run responses do not expose the private receipt");
  assert.equal(Object.hasOwn(job.result??{},"generationReceipt"),false,"shared feeds do not expose the private receipt");
  assert.deepEqual(card.links.map(link=>({href:link.attributes.href,label:link.text,class:link.attributes.class})),member?[]:[
    {href:"/settings/workspaces/"+encodeURIComponent(worker.sharing.organizationId)+"/usage",label:copy(locale,2),class:"button secondary compact"},
  ],"only the current exact organization owner receives its existing Usage destination");
  if(member)assert.ok(card.visible.includes(f.i18n.t("generation.contactAdministrator")),"ordinary members receive actionable administrator guidance, not a privileged link");
  const before=worker.counts(),paid=paidRequests(h).length,providerCalls=calls.length,original=jobRow(worker,id);
  const component=await inspectFailure(f,card),inspection=structuredClone(component.inspection),accounting=inspection.receipt.generation_receipt,facts=receiptFacts(f,component);
  assert.equal(inspection.receipt.job.job_id,id);
  assert.equal(accounting.actual_provider_call_count,afterPaid?1:0);
  assert.equal(accounting.source_transmission_status,afterPaid?"transmitted":"not_transmitted");
  assert.equal(accounting.provider_request_status,afterPaid?"submitted":"not_submitted");
  assert.equal(accounting.settled_cost_microusd,afterPaid?1400:0);
  assert.equal(facts[f.i18n.system("Recorded provider calls")],f.i18n.number(afterPaid?1:0));
  assert.equal(facts[f.i18n.system("Source transmission")],f.i18n.system(afterPaid?"transmitted":"not transmitted"));
  const textarea=f.renderer.ownNodes(component,"textarea").find(node=>node.attributes.class==="generation-input-receipt");
  assert.equal(textarea.value,JSON.stringify(inspection.receipt,null,2),"the display never reprices or rewrites the private receipt");
  await copyReceiptEvidence(f,component,inspection);
  assert.deepEqual(worker.counts(),before);assert.deepEqual(jobRow(worker,id),original);
  assert.equal(calls.length,providerCalls);assert.equal(paidRequests(h).length,paid,"inspection is not another approval");
  await closeReceipt(f);await pilotStatus(worker,"active");await recertifySession(h);
  await f.openScene();await f.check();const retained=reads.at(-1).body;
  assert.equal(retained.job.jobId,id);
  assert.equal(Boolean(action(f,"scene.cost.new")),!afterPaid,"earlier paid work never qualifies as safely unused");
  if(afterPaid){assert.equal(retained.sceneCostExisting.safeUnused,null);assert.equal(worker.cost()[0].used_microusd,1400);}
  else{assert.equal(retained.sceneCostExisting.safeUnused.reason,"policy-stopped-before-dispatch");assert.ok(isSceneSafeUnusedProof(retained.sceneCostExisting.safeUnused));}
  assert.equal(paidRequests(h).length,paid);assert.equal(calls.length,providerCalls);
});


for(const locale of ["en","fr","ar","ja"])for(const afterPaid of [false,true])
test("Scene policy stop "+locale+"/personal/"+(afterPaid?"earlier-paid":"first-attempt")+": returned run, detail and copied input preserve actual provider counts",async t=>{
  const {worker,h,f,id,job,runJob,calls}=await policyComposer(t,{locale,afterPaid,shared:false});
  const response=await worker.request("/api/document-jobs/"+encodeURIComponent(id)),body=await response.json();assert.equal(response.status,200);
  const original=jobRow(worker,id),raw=checkpoint(worker,id),actual=afterPaid?1:0,settled=afterPaid?1400:0;
  assert.equal(calls.length,actual);
  assert.equal(Object.values(raw.providerSubmissions).filter(entry=>entry.status==="rejected").length,1,"the raw local-stop checkpoint is retained, not rewritten as a provider call");
  for(const [surface,projected]of [["run",runJob],["detail",body.job],["feed",job]]){
    const receipt=projected.result.generationReceipt;
    assert.equal(Object.hasOwn(projected.result,"scenePolicyStopSummary"),false,surface+" does not expose the internal server certificate");
    assert.equal(receipt.actual_provider_call_count,actual,surface+" excludes the trusted local stop from actual provider calls");
    assert.equal(receipt.source_transmission_status,afterPaid?"transmitted":"not_transmitted",surface+" retains earlier source transmission");
    assert.equal(receipt.provider_request_status,afterPaid?"submitted":"not_submitted",surface+" distinguishes local stop from submission");
    assert.equal(receipt.settled_cost_microusd,settled,surface+" retains exactly the original verified settled charge");
    assert.equal(Object.hasOwn(receipt,"scenePolicyStopSummary"),false,"internal certification markers are not copied into receipt data");
  }
  assert.equal(raw.generationReceipt.actual_provider_call_count,actual);assert.equal(raw.generationReceipt.settled_cost_microusd,settled);
  const card=failureCard(f);assert.equal(card.title,copy(locale,0));assert.equal(card.summary,copy(locale,1));
  assert.equal(card.buttons.find(button=>button.attributes.class==="button primary compact")?.text,copy(locale,3));
  assert.equal(card.buttons.some(button=>button.text===f.i18n.system("Review & change request")),false);
  const principal=h.store.session.get(),href=principal.capabilities.includes("platform.policy.manage")?"/operations":"/settings";
  assert.ok(principal.capabilities.includes("platform.policy.manage")||principal.capabilities.includes("self.usage.read"));
  assert.deepEqual(card.links.map(link=>({href:link.attributes.href,label:link.text,class:link.attributes.class})),[{href,label:copy(locale,2),class:"button secondary compact"}]);
  const before=worker.counts(),component=await inspectFailure(f,card),inspection=structuredClone(component.inspection),receipt=inspection.receipt.generation_receipt,facts=receiptFacts(f,component);
  assert.equal(inspection.receipt.job.job_id,id);assert.equal(receipt.actual_provider_call_count,actual);
  assert.equal(receipt.source_transmission_status,afterPaid?"transmitted":"not_transmitted");
  assert.equal(receipt.provider_request_status,afterPaid?"submitted":"not_submitted");
  assert.equal(receipt.settled_cost_microusd,settled);
  assert.equal(facts[f.i18n.system("Recorded provider calls")],f.i18n.number(actual));
  assert.equal(facts[f.i18n.system("Source transmission")],f.i18n.system(afterPaid?"transmitted":"not transmitted"));
  assert.equal(facts[f.i18n.system("Settled cost")],"$"+(settled/1_000_000).toFixed(6));
  await copyReceiptEvidence(f,component,inspection);
  assert.equal(JSON.parse(f.clipboard.at(-1)).generation_receipt.actual_provider_call_count,actual);
  assert.deepEqual(component.inspection,inspection,"rendering and copying never repair data in the client");
  assert.deepEqual(worker.counts(),before);assert.deepEqual(jobRow(worker,id),original);
  assert.equal(calls.length,actual);assert.equal(paidRequests(h).length,1);
});

for(const mode of ["manual","managed"])for(const medium of ["visual","audio"])
test("Scene policy continuation fr/"+mode+"/"+medium+": reactivation requires explicit New, free current quote and separate Create",async t=>{
  const {worker,h,f,id,calls,reads}=await policyComposer(t,{locale:"fr",mode,medium});
  const original=jobRow(worker,id);assert.equal(worker.cost()[0].status,"released");assert.equal(worker.cost()[0].used_microusd,0);
  assert.equal(worker.tokens()[0].status,"released");assert.equal(worker.tokens()[0].used_tokens,0);
  await pilotStatus(worker,"active");await recertifySession(h);
  await f.openScene({mode,selectedMedium:medium});await f.check();
  const offered=action(f,"scene.cost.new"),proof=reads.at(-1).body.sceneCostExisting.safeUnused;
  assert.ok(offered);assert.ok(isSceneSafeUnusedProof(proof));assert.equal(proof.reason,"policy-stopped-before-dispatch");
  assert.equal(proof.requestId,id);assert.equal(enabled(createButton(f)),false);
  const readCount=reads.length,counts=worker.counts();await invoke(f,offered);
  await untilScene(()=>reads.length===readCount+2);await sceneIdle(f);
  assert.equal(reads[readCount].request.body.payload.sceneRequestId,id,"explicit New first recertifies the exact original");
  assert.ok(isSceneSafeUnusedProof(reads[readCount].body.sceneCostExisting.safeUnused));
  const fresh=reads.at(-1),newId=fresh.request.body.payload.sceneRequestId;assert.notEqual(newId,id);
  assert.equal(fresh.request.body.payload.productionMode,mode);assert.equal(fresh.request.body.payload.sceneMedium,medium);
  assert.equal(fresh.request.body.payload.itemCount,undefined,"automatic requested count remains automatic");
  assert.equal(fresh.body.sceneCostPreview.requestId,newId);assert.equal(enabled(createButton(f)),true);
  assert.deepEqual(worker.counts(),counts);assert.equal(calls.length,0);assert.equal(paidRequests(h).length,1);
  assert.deepEqual(jobRow(worker,id),original,"reactivation and free inspection leave the original immutable");
  await f.submit();await untilScene(()=>worker.counts().document_jobs===2);await sceneSubmitted(f);
  assert.equal(paidRequests(h).length,2);assert.equal(paidRequests(h)[1].body.payload.sceneRequestId,newId);
  assert.equal(paidRequests(h)[1].body.payload.sceneCostConsent.confirmed,true);assert.equal(Object.hasOwn(paidRequests(h)[1].body.payload,"safeUnused"),false);
  worker.controls.beforeRun=null;
  const response=await worker.request("/api/document-jobs/"+encodeURIComponent(newId)+"/run",worker.json({})),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.job.status,"completed",JSON.stringify(body.job.errorDetail));
  assert.equal(calls.length,fresh.body.sceneCostPreview.providerCallCount);assert.deepEqual(jobRow(worker,id),original);
});

for(const medium of ["visual","audio"])test("Scene policy continuation "+medium+": a lost provider response and retained hold never become unused after reactivation",async t=>{
  const {worker,h,f,id,calls,reads}=await policyComposer(t,{locale:"fr",medium,unknown:true});
  const original=jobRow(worker,id),before=worker.cost();
  assert.equal(before[0].status,"executing");assert.equal(checkpoint(worker,id).generationReceipt.provider_request_status,"submission_unknown");
  await pilotStatus(worker,"paused");await pilotStatus(worker,"active");await recertifySession(h);
  await f.openScene();await f.check();assert.equal(reads.at(-1).body.job.jobId,id);
  assert.equal(reads.at(-1).body.sceneCostExisting.safeUnused,null);assert.equal(action(f,"scene.cost.new"),undefined);
  assert.equal(enabled(createButton(f)),false);assert.equal(paidRequests(h).length,1);assert.equal(calls.length,1);
  assert.deepEqual(worker.cost(),before);assert.deepEqual(jobRow(worker,id),original);
});

test("Scene application eligibility guidance requires the full typed current Scene failure, not a generic 403 or message",()=>{
  const detail={...shape,message:"PRIVATE_PROVIDER_TEXT scene_paid_authority_changed"},job={kind:"render_document",status:"failed",stage:"failed",result:{artifactKind:"scene"}};
  const guidance=generationFailureGuidance(detail,"",job);assert.equal(guidance.applicationEligibility,true);assert.equal(guidance.retryAllowed,false);
  assert.equal(guidance.title,copy("en",0));assert.equal(guidance.summary,copy("en",1));assert.equal(guidance.summary.includes(detail.message),false);
  for(const receipt of [{settled_cost_microusd:0,reservation_status:"released"},{settled_cost_microusd:1400,reservation_status:"settled"},{settled_cost_microusd:null,reservation_status:"executing",provider_request_status:"submission_unknown"}]){
    const scoped={...job,result:{...job.result,generationReceipt:receipt}},before=structuredClone(scoped);
    assert.deepEqual(generationFailureGuidance(detail,"",scoped),guidance,"guidance never derives a free or released claim from receipt absence or amount");assert.deepEqual(scoped,before);
  }
  for(const change of [{code:"provider_access_denied"},{category:"provider"},{scope:"model"},{action:"retry"},{httpStatus:401},{retryable:true},{requestId:"provider-request"},{retryAfterMs:1000}]){
    assert.equal(generationFailureGuidance({...detail,...change},"",job).applicationEligibility,undefined,JSON.stringify(change));
  }
  for(const kind of ["audio","video","slides","short_story"])assert.equal(generationFailureGuidance(detail,"",{...job,result:{artifactKind:kind}}).applicationEligibility,undefined);
  assert.equal(generationFailureGuidance(null,"scene_paid_authority_changed",job).applicationEligibility,undefined);
  assert.equal(generationFailureGuidance(detail,"",{...job,status:"running"}).applicationEligibility,undefined);
});

test("Scene application remedies use exact current organization or self authority, without changing provider remediation",()=>{
  const guidance=generationFailureGuidance({...shape,message:"safe fallback"},"",{kind:"render_document",status:"failed",stage:"failed",result:{artifactKind:"scene"}});
  const personal={capabilities:["self.usage.read"]},platform={capabilities:["platform.policy.manage"]};
  assert.deepEqual(authorizedGenerationFailureRemediation(guidance,personal),{href:"/settings",label:copy("en",2),external:false});
  assert.deepEqual(authorizedGenerationFailureRemediation(guidance,platform),{href:"/operations",label:copy("en",2),external:false});
  for(const role of ["owner","administrator"]){
    const shared={capabilities:["project.read"],projectContext:{organizationId:"current/org"},organizations:[{organizationId:"current/org",role}]};
    assert.deepEqual(authorizedGenerationFailureRemediation(guidance,shared),{href:"/settings/workspaces/current%2Forg/usage",label:copy("en",2),external:false});
    assert.equal(authorizedGenerationFailureRemediation(guidance,{...shared,impersonation:{active:true}}),null);
    assert.equal(authorizedGenerationFailureRemediation(guidance,{...shared,projectContext:{organizationId:"different"}}),null);
  }
  for(const principal of [null,{capabilities:[]},{capabilities:["platform.provider.configure"]},{capabilities:["platform.policy.manage"],projectContext:{organizationId:"current"},organizations:[{organizationId:"current",role:"member"}]},{capabilities:["self.usage.read"],projectContext:{organizationId:"current"},organizations:[]}]){
    assert.equal(authorizedGenerationFailureRemediation(guidance,principal),null);
  }
  assert.equal(authorizedGenerationFailureRemediation({...guidance,actionUrl:"https://platform.openai.com/api-keys"},platform),null);
  const provider=generationFailureGuidance({...shape,code:"provider_key_invalid",category:"authentication",scope:"account",action:"check_credentials"},"",{kind:"generate",status:"failed",stage:"failed",result:{}});
  assert.equal(authorizedGenerationFailureRemediation(provider,platform),null,"policy authority is not provider-key authority");
  assert.equal(authorizedGenerationFailureRemediation(provider,{capabilities:["platform.provider.configure"]})?.href,"https://platform.openai.com/api-keys");
});
