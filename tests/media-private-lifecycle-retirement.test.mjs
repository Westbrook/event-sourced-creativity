import assert from"node:assert/strict";
import test from"node:test";
import{presentationFixture,mediaFixture,settle,receiptComponent,receiptReady}from"./helpers/media-private-retirement-fixture.mjs";

for(const boundary of["disconnect","hidden","pending-disconnect"])test("actual retained private draft "+boundary+" keeps only its original reference",async t=>{
 const x=await presentationFixture(t),{f,h,worker,id}=x,host=f.host,entered=Promise.withResolvers(),gate=Promise.withResolvers(),prior=h.intercept;
 let body;
 if(boundary==="pending-disconnect"){
  h.intercept=async request=>{
   if(request.url!=="/api/document-jobs/"+id+"/presentation-candidates")return prior?.(request);
   const response=await worker.request(request.url,request.init);assert.equal(response.status,200);const content=await response.clone().json();
   response.json=()=>{entered.resolve(content);return gate.promise;};return response;
  };
  await f.click(f.i18n.t("presentation.draft.review"));body=await entered.promise;
 }else await x.open();
 const before=h.requests.length;
 if(boundary==="hidden")host.hidden=true;
 else{host.disconnectedCallback();host.isConnected=false;}
 await x.retire();await x.recovered();
 host.jobs=[];
 if(boundary==="hidden")host.hidden=false;
 else{host.isConnected=true;host.connectedCallback();}
 if(body)gate.resolve(body);await settle(f);x.noMutation();
 assert.ok(f.buttons().some(button=>button.text===f.i18n.t("presentation.draft.review")),"same real component retains the exact original job/document reference");
 assert.equal(f.visible().includes("PRIVATE_REJECTED_TITLE"),false);
 assert.equal(h.requests.slice(before).some(r=>r.url.includes("/presentation-candidates")),false,"retirement/reconnection is not automatic inspection or candidate selection");
 h.intercept=prior;await x.open();x.noMutation();assert.equal(h.requests.at(-1).url,"/api/document-jobs/"+id+"/presentation-candidates/source-retirement-draft-1");
});
test("actual source retirement notification rejects foreign and unbranded ownership",async t=>{
 const x=await mediaFixture(t),{f,h,id}=x;await f.host.openJobById(id);await receiptReady(f);
 const before=JSON.stringify(receiptComponent(f).inspection),source=h.store.captureSourceOwnership();
 const other=new h.store.constructor();other.session.set(h.store.session.get());
 for(const token of[{...source},other.captureSourceOwnership()]){
  assert.equal(h.store.sourceOwnershipScopeActive(token),false);
  const event=new Event("forma-event-source-retired");Object.defineProperty(event,"detail",{value:{source:token,generation:source.generation+1,status:403}});
  h.window.dispatchEvent(event);await settle(f);
  assert.equal(JSON.stringify(receiptComponent(f).inspection),before,"an unowned notification cannot erase current private presentation");
 }
 x.noMutation();
});
