import assert from"node:assert/strict";
import test from"node:test";
import{presentationFixture,settle,untilScene,invoke}from"./helpers/media-private-retirement-fixture.mjs";

for(const deny of[false,true])test("actual private rejected presentation "+(deny?"retirement-restoration":"healthy"),async t=>{
 const x=await presentationFixture(t),{f}=x;await x.open();assert.ok(f.visible().includes("PRIVATE_REJECTED_SUMMARY"));
 if(deny){await x.retire();await x.recovered();}await settle(f);x.noMutation();
 assert.equal(f.visible().includes("PRIVATE_REJECTED_TITLE"),!deny,"old candidate/detail bytes are retired");
});

for(const boundary of["listing","detail","preserve"])for(const deny of[false,true])test("actual private presentation late "+boundary+" "+(deny?"retirement-restoration":"healthy"),async t=>{
 const x=await presentationFixture(t),{h,f,worker,id}=x,entered=Promise.withResolvers(),gate=Promise.withResolvers(),prior=h.intercept;
 const rootPath="/api/document-jobs/"+id+"/presentation-candidates",detailPath=rootPath+"/source-retirement-draft-1";
 if(boundary==="preserve")await x.open();
 let held=false;h.intercept=async request=>{
  const target=boundary==="listing"?rootPath:boundary==="detail"?detailPath:detailPath+"/preserve";
  if(held||request.url!==target)return prior?.(request);held=true;
  const response=await worker.request(request.url,request.init);assert.equal(response.status,200,await response.clone().text());
  const body=await response.clone().json();response.json=()=>{entered.resolve(body);return gate.promise;};return response;
 };
 if(boundary==="preserve")await f.click(f.i18n.t("presentation.draft.preserve"));
 else await f.click(f.i18n.t("presentation.draft.review"));
 const body=await entered.promise,readCount=h.requests.length;if(boundary==="preserve")x.acknowledgePreservation(body.candidate);
 if(deny){await x.retire();await x.recovered();}
 gate.resolve(body);await settle(f);x.noMutation(boundary==="preserve");
 if(!deny)await untilScene(()=>{f.draw();return f.visible().includes("PRIVATE_REJECTED_TITLE");});
 assert.equal(f.visible().includes("PRIVATE_REJECTED_TITLE"),!deny,"a late private response never restores retired candidate bytes");
 if(deny&&boundary==="listing")assert.equal(h.requests.slice(readCount).filter(r=>r.url===detailPath).length,0,"old listing cannot launch automatic preferred-detail selection");
 if(deny&&boundary==="preserve"){
  f.host.jobs=[];await settle(f);
  assert.ok(f.buttons().some(button=>button.text===f.i18n.t("presentation.draft.review")),"the exact original job reference survives its acknowledged preserve response");
  assert.equal(f.trace.some(value=>value==="toast:"+f.i18n.t("presentation.draft.preservedNotice")),false,"no private success continuation after retirement");
 }
});

test("actual private draft normal Close retains its exact original reference through source retirement",async t=>{
 const x=await presentationFixture(t),{f,h}=x;await x.open();
 const before=h.requests.length;
 await invoke(f,f.buttons().find(button=>button.attributes["aria-label"]===f.i18n.t("action.close","Close")));await settle(f);
 await x.retire();await x.recovered();f.host.jobs=[];await settle(f);
 x.noMutation();
 assert.ok(f.buttons().some(button=>button.text===f.i18n.t("presentation.draft.review")),"normal private close must not discard the sole original job/document pair");
 assert.equal(f.visible().includes("PRIVATE_REJECTED_TITLE"),false);
 assert.equal(h.requests.slice(before).some(r=>r.url.includes("/presentation-candidates")),false,"no automatic reinspection/selection");
 await x.open();x.noMutation();assert.equal(h.requests.at(-1).url,"/api/document-jobs/"+x.id+"/presentation-candidates/source-retirement-draft-1","explicit inspection remains on the exact original job");
});
test("actual private preservation acknowledgment cannot recreate references after explicit privacy erase",async t=>{
 const x=await presentationFixture(t),{f,h,worker}=x;await x.open();
 const entered=Promise.withResolvers(),gate=Promise.withResolvers(),freshDiscovery=Promise.withResolvers(),prior=h.intercept;let discoveryBody;
 h.intercept=async request=>{
  if(request.url.startsWith("/api/document-jobs/presentation-candidates?document=")){
   const response=await worker.request(request.url,request.init);assert.equal(response.status,200);
   discoveryBody=await response.clone().json();response.json=()=>freshDiscovery.promise;return response;
  }
  if(!request.url.endsWith("/source-retirement-draft-1/preserve"))return prior?.(request);
  const response=await worker.request(request.url,request.init);assert.equal(response.status,200);const body=await response.clone().json();
  response.json=()=>{entered.resolve(body);return gate.promise;};return response;
 };
 await f.click(f.i18n.t("presentation.draft.preserve"));const body=await entered.promise;x.acknowledgePreservation(body.candidate);
 h.window.dispatchEvent(new Event("forma-authorization-changed"));f.host.jobs=[];await settle(f);
 gate.resolve(body);await settle(f);x.noMutation(true);
 assert.equal(f.buttons().some(button=>button.text===f.i18n.t("presentation.draft.review")),false,"explicit privacy erase remains separate from source retirement");
 assert.equal(f.visible().includes("PRIVATE_REJECTED_TITLE"),false);
 await x.retire();freshDiscovery.resolve(discoveryBody);await settle(f);x.noMutation(true);
});

for(const erase of[false,true])test("actual preserved-job discovery "+(erase?"cannot cross explicit privacy erase":"survives a newer private opening"),async t=>{
 const x=await presentationFixture(t),{h,f,worker,id,documentId}=x;await x.open();
 await f.click(f.i18n.t("presentation.draft.preserve"));await untilScene(()=>{f.draw();return f.buttons().some(b=>b.text===f.i18n.t("presentation.draft.preserved"));});
 const response=await worker.request("/api/document-jobs/"+id+"/presentation-candidates/source-retirement-draft-1");assert.equal(response.status,200);
 const preserved=(await response.json()).candidate;x.acknowledgePreservation(preserved);
 const first=f.host,Reader=first.constructor;first.disconnectedCallback();first.isConnected=false;
 const entered=Promise.withResolvers(),gate=Promise.withResolvers(),prior=h.intercept,freshReads=[];let held=false;
 h.intercept=async request=>{
  if(!request.url.startsWith("/api/document-jobs/presentation-candidates?document="))return prior?.(request);
  const result=await worker.request(request.url,request.init);assert.equal(result.status,200);const body=await result.clone().json();assert.equal(body.jobs[0].jobId,id);
  if(held){const fresh=Promise.withResolvers();freshReads.push(()=>fresh.resolve(body));result.json=()=>fresh.promise;return result;}
  held=true;result.json=()=>{entered.resolve(body);return gate.promise;};return result;
 };
 const reader=new Reader();reader.store=h.store;reader.i18n=f.i18n;reader.documentId=documentId;reader.jobs=[x.job];reader.isConnected=true;f.host=reader;reader.connectedCallback();f.draw();
 const listing=await entered.promise;await x.open();
 if(erase)h.window.dispatchEvent(new Event("forma-authorization-changed"));
 gate.resolve(listing);await settle(f);
 reader.jobs=[];await settle(f);x.noMutation(true);
 assert.equal(f.buttons().some(b=>b.text===f.i18n.t("presentation.draft.review")),!erase,"private opening is not a new reference owner; explicit privacy erase is");
 if(erase){await x.retire();for(const release of freshReads)release();await settle(f);x.noMutation(true);}
});
