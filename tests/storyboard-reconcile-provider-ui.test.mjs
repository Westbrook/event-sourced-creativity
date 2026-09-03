import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [store,artifacts]=await Promise.all([
  readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
  readFile(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8"),
]);

test("uncertain storyboard receipts expose a localized owner-only status check without offering duplicate paid generation",()=>{
  assert.match(artifacts,/const reconciliationEligible=Boolean\(session&&!session\.impersonation&&\(!session\.projectContext\|\|session\.projectContext\.ownerUserId===session\.user\.userId\)&&job\.status==="failed"&&kind==="storyboard"&&job\.result\?\.storyboardProviderSubmission==="pending"&&!job\.result\.providerJobId\)/);
  assert.match(artifacts,/reconciliationEligible\?html`<button[^>]*@click=\$\{\(\)=>void this\.#reconcileProviderReceipt\(job\.jobId\)\}/);
  assert.match(artifacts,/this\.i18n\.system\("Checking…"\):this\.i18n\.system\("Refresh provider status"\)/);
  assert.match(artifacts,/async #reconcileProviderReceipt\(jobId:string\)\{if\(this\.#reconcilingProviderJobId\)return;/);
  assert.match(artifacts,/\?disabled=\$\{Boolean\(this\.#reconcilingProviderJobId\)\}/);
});

test("receipt reconciliation accepts only a same-document confirmed owner receipt and requires a separate deliberate recovery",()=>{
  const start=store.indexOf("  async reconcileDocumentProviderReceipt(jobId:string){");
  const end=store.indexOf("  async recoverDocumentRender(jobId:string){",start);
  assert.ok(start>=0&&end>start);
  const action=store.slice(start,end);
  assert.match(action,/original\.result\?\.artifactKind!=="storyboard"\|\|original\.result\.storyboardProviderSubmission!=="pending"\|\|original\.result\.providerJobId/);
  assert.match(action,/guardedFetch\(`\/api\/document-jobs\/\$\{encodeURIComponent\(jobId\)\}\/reconcile-provider`,\{method:"POST"\}/);
  assert.match(action,/body\.reconciledProviderRequest!==true/);
  assert.match(action,/body\.job\.jobId!==jobId\|\|body\.job\.documentId!==original\.documentId/);
  assert.match(action,/body\.job\.result\.storyboardProviderSubmission!=="confirmed"/);
  assert.match(action,/\["pending","submitted","unknown"\]\.includes\(providerJobId\.toLowerCase\(\)\)/);
  assert.doesNotMatch(action,/\/retry|\/run|recoverDocumentRender|renderDocumentArtifact/,"finding a receipt cannot secretly submit or recover paid work");
});

test("owner-facing provider diagnostics allow only bounded HTTP statuses and explicitly safe transport classifications",()=>{
  const start=store.indexOf("  async reconcileDocumentProviderReceipt(jobId:string){");
  const end=store.indexOf("  async recoverDocumentRender(jobId:string){",start);
  const action=store.slice(start,end);
  assert.match(action,/body\.error==="provider_receipt_lookup_failed"/);
  assert.match(action,/Number\.isSafeInteger\(body\.providerStatus\).*>=400.*<=599/);
  assert.match(action,/\["TypeError","AbortError","DOMException","Error"\]\.includes\(body\.providerErrorClass\)/);
  assert.match(action,/body\.providerErrorCode==="string"&&\/\^\[A-Z\]\[A-Z0-9_\]\{0,63\}\$\/u\.test\(body\.providerErrorCode\)/);
  assert.doesNotMatch(action,/body\.(?:providerUrl|providerMessage|providerPrompt|providerHeaders|providerKey)/,"raw provider locations, messages, prompts, credentials, and headers never enter an owner notification");
});


// The legacy Slides sibling is tested through the full production Store, with
// in-memory HTTP envelopes only. These tests do not certify backend settlement.
const {createSceneStoreHost,sceneDeferred}=await import("./helpers/scene-cost-store-host.mjs");
const {documentJobCanCheckSavedPresentationReceipt,savedPresentationReceiptCheckResponse,savedPresentationReceiptCheckMessage}=await import("../src/model/presentation-receipt-check.ts");
const savedSlideJob=(documentId,patch={})=>({jobId:"saved-slide-receipt",documentId,kind:"render_document",status:"failed",sourceSurface:"document",requestedSequence:1,documentRevision:"original-revision",requestKey:"original-slides",sourcePreviewId:null,productionMode:"manual",promptTechnique:"prose",promptFanId:null,parentJobId:null,fanKind:null,members:[],result:{artifactKind:"slides",generationReceipt:{settled_cost_microusd:null}},error:"presentation_validation_failed",errorDetail:null,moderationPromptRef:null,dismissedAt:null,attemptCount:1,requestedAt:"2026-09-02T10:00:00Z",startedAt:"2026-09-02T10:00:01Z",completedAt:"2026-09-02T10:00:02Z",notifiedAt:null,leaseExpiresAt:null,updatedAt:"2026-09-02T10:00:02Z",stage:"failed",progressMessage:"",...patch});
const savedReceiptBody=(job,status="known")=>({job:{...structuredClone(job),updatedAt:"2026-09-02T10:01:00Z"},reconciliation:{jobId:job.jobId,documentId:job.documentId,status,...(status==="operator_required"?{reason:"retained_usage_incomplete"}:{}),providerRequestsSubmitted:0}});
async function savedReceiptHost(t,options={}){
  t.mock.method(globalThis,"fetch",async()=>assert.fail("Receipt checks cannot call providers or external hosts"));
  const h=await createSceneStoreHost(options);t.after(()=>h.close());
  const job=savedSlideJob(h.worker.documentId);h.store.documentJobs.set([job]);
  const target="/api/document-jobs/"+encodeURIComponent(job.jobId)+"/reconcile-provider";
  return{h,job,target};
}

test("legacy Slides receipt eligibility excludes active work and Output-bound jobs, not non-owner project actors",()=>{
  const job=savedSlideJob("document");
  for(const status of["failed","canceled","partial"])assert.equal(documentJobCanCheckSavedPresentationReceipt({...job,status}),true);
  for(const patch of[{status:"queued"},{status:"running"},{status:"completed"},{kind:"generate"},{sourceSurface:"outputs"},{result:{artifactKind:"audio"}}])assert.equal(documentJobCanCheckSavedPresentationReceipt({...job,...patch}),false);
});

test("legacy Slides response requires exact original identity and an explicit zero-provider-call certificate",()=>{
  const job=savedSlideJob("document"),body=savedReceiptBody(job);
  assert.equal(savedPresentationReceiptCheckResponse(job,body).status,"known");
  const variants=[value=>value.job.jobId="other",value=>value.job.documentId="other",value=>value.job.requestKey="other",value=>value.job.requestedAt="other",value=>value.job.documentRevision="other",value=>value.job.status="completed",value=>value.job.updatedAt="2026-09-01T00:00:00Z",value=>value.job.attemptCount=2,value=>value.job.sourceSurface="outputs",value=>value.reconciliation.jobId="other",value=>value.reconciliation.documentId="other",value=>value.reconciliation.status="recovered",value=>value.reconciliation.providerRequestsSubmitted=1,value=>value.reconciliation.providerRequestsSubmitted="0",value=>delete value.reconciliation.providerRequestsSubmitted];
  for(const mutate of variants){const candidate=structuredClone(body);mutate(candidate);assert.equal(savedPresentationReceiptCheckResponse(job,candidate),null);}
});

for(const shared of[false,true])test("actual Store checks a legacy Slides receipt without starting generation, including a non-owner project actor "+shared,async t=>{
  const {h,job,target}=await savedReceiptHost(t,{shared});
  if(shared)h.setSession({projectContext:{...h.store.session.get().projectContext,ownerUserId:"different-project-owner"}});
  const before=h.worker.counts(),budgets=JSON.stringify([h.store.session.get().budgets,h.store.session.get().costBudgets]),content=h.store.content.get();
  const body=savedReceiptBody(job);body.job.result.generationReceipt={settled_cost_microusd:4200};
  h.intercept=async request=>{assert.equal(request.url,target);assert.equal(request.init.method,"POST");return Response.json(body);};
  assert.equal(await h.store.checkSavedPresentationReceipt(job.jobId),"known");
  assert.equal(h.store.documentJobs.get()[0].result.generationReceipt.settled_cost_microusd,4200);
  assert.equal(h.store.documentJobs.get()[0].status,"failed");assert.equal(h.requests.length,1);assert.deepEqual(h.worker.counts(),before);
  assert.equal(JSON.stringify([h.store.session.get().budgets,h.store.session.get().costBudgets]),budgets);assert.equal(h.store.content.get(),content);
  assert.match(h.store.ui.toast,/No new generation/);assert.doesNotMatch(h.store.ui.toast,/Paid once|refund|\$0/);
});

test("operator-required receipt check preserves original job, caches and unknown usage instead of zeroing them",async t=>{
  const {h,job,target}=await savedReceiptHost(t),before=h.store.documentJobs.get(),content=h.store.content.get(),counts=h.worker.counts();
  const body=savedReceiptBody(job,"operator_required");body.job.result={artifactKind:"slides",generationReceipt:{settled_cost_microusd:0},privateExtra:"DO_NOT_PUBLISH"};body.reconciliation.reason="PRIVATE_DIAGNOSTIC";
  h.intercept=async request=>{assert.equal(request.url,target);return Response.json(body);};
  assert.equal(await h.store.checkSavedPresentationReceipt(job.jobId),"operator_required");
  assert.equal(h.store.documentJobs.get(),before);assert.equal(h.store.content.get(),content);assert.deepEqual(h.worker.counts(),counts);assert.equal(h.requests.length,1);
  assert.equal(h.store.documentJobs.get()[0].result.generationReceipt.settled_cost_microusd,null);
  assert.equal(h.store.ui.toast,savedPresentationReceiptCheckMessage("operator_required"));assert.doesNotMatch(h.store.ui.toast,/PRIVATE_DIAGNOSTIC|DO_NOT_PUBLISH|\$0/);
});

test("invalid or denied saved-receipt replies use a safe application message and never rewrite original work",async t=>{
  const {h,job,target}=await savedReceiptHost(t),before=h.store.documentJobs.get();
  for(const variant of["identity","provider","denied","malformed"]){
    const body=savedReceiptBody(job);body.error="PRIVATE_PROVIDER_KEY_AND_PROMPT";
    if(variant==="identity")body.reconciliation.jobId="foreign";
    if(variant==="provider")body.reconciliation.providerRequestsSubmitted=1;
    h.intercept=async request=>{assert.equal(request.url,target);return variant==="malformed"?new Response("not json",{status:200}):Response.json(body,{status:variant==="denied"?403:200});};
    assert.equal(await h.store.checkSavedPresentationReceipt(job.jobId),"unavailable");assert.equal(h.store.documentJobs.get(),before);
    assert.equal(h.store.ui.toast,savedPresentationReceiptCheckMessage("unavailable"));assert.doesNotMatch(h.store.ui.toast,/PRIVATE_PROVIDER_KEY_AND_PROMPT|provider failed|\$0/);
  }
});

for(const change of["authority","session-ABA","source-retired-restored","newer-job","caller-closed"])test("late saved receipt is withheld after "+change,async t=>{
  const {h,job,target}=await savedReceiptHost(t),entered=sceneDeferred(),release=sceneDeferred();let callerCurrent=true;
  h.intercept=async request=>{if(request.url===target)return{ok:true,json(){entered.resolve();return release.promise;}};return undefined;};
  const pending=h.store.checkSavedPresentationReceipt(job.jobId,{current:()=>callerCurrent});await entered.promise;
  if(change==="authority")h.setSession({permissionEpoch:"new-epoch"});
  if(change==="session-ABA"){
    const session=h.store.session.get();let read=0;
    h.intercept=async request=>request.url==="/api/session"?Response.json(++read===1?{...session,permissionEpoch:"temporary-other-epoch"}:session):undefined;
    await h.store.refreshSession();await h.store.refreshSession();
  }
  if(change==="newer-job")h.store.documentJobs.set([{...job,updatedAt:"2026-09-02T10:05:00Z",result:{artifactKind:"slides",newer:true}}]);
  if(change==="caller-closed")callerCurrent=false;
  if(change==="source-retired-restored"){
    h.intercept=async request=>request.url.startsWith("/api/events?")?Response.json({error:"denied"},{status:403}):undefined;
    await assert.rejects(h.store.refreshEvents());h.intercept=null;await h.store.refreshEvents();
  }
  const before=h.store.documentJobs.get(),content=h.store.content.get(),notice=h.store.ui.toast;
  release.resolve(savedReceiptBody(job));assert.equal(await pending,null);
  assert.equal(h.store.documentJobs.get(),before);assert.equal(h.store.content.get(),content);assert.equal(h.store.ui.toast,notice);
  assert.equal(h.requests.filter(request=>request.init.method==="POST").length,1);
});

test("a newer same-job receipt check owns status publication even when an older reply arrives last",async t=>{
  const {h,job,target}=await savedReceiptHost(t),entered=sceneDeferred(),release=sceneDeferred();let count=0;
  h.intercept=async request=>{assert.equal(request.url,target);if(++count===1)return{ok:true,json(){entered.resolve();return release.promise;}};return Response.json(savedReceiptBody(job,"operator_required"));};
  const older=h.store.checkSavedPresentationReceipt(job.jobId);await entered.promise;
  assert.equal(await h.store.checkSavedPresentationReceipt(job.jobId),"operator_required");const before=h.store.documentJobs.get(),notice=h.store.ui.toast;
  release.resolve(savedReceiptBody(job));assert.equal(await older,null);assert.equal(h.store.documentJobs.get(),before);assert.equal(h.store.ui.toast,notice);
});
