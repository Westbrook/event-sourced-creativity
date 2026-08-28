import assert from"node:assert/strict";
import test from"node:test";
import{mediaFixture,settle,sceneIdle,receiptReady,receiptComponent,invoke,action,enabled,createButton}from"./helpers/media-private-retirement-fixture.mjs";

for(const deny of[false,true])test("actual held Scene actor-input source retirement "+(deny?"denied":"healthy"),async t=>{
 const x=await mediaFixture(t),{h,f,id}=x;
 assert.equal(h.store.constructor.name,"FormaStore");assert.equal(Object.hasOwn(h.store,"loadActorDocumentGenerationReceipt"),false);
 await f.host.openJobById(id);await receiptReady(f);const initial=receiptComponent(f);assert.ok(initial?.inspection);
 const receipt=JSON.stringify(initial.inspection);assert.ok(receipt.includes("The keeper checks the harbor."),"actual original private input body is displayed");
 const principal=JSON.stringify(h.store.session.get());
 if(deny)await x.retire();await settle(f);
 assert.equal(JSON.stringify(h.store.session.get()),principal);

 x.noMutation();
 if(deny)assert.equal(Boolean(receiptComponent(f)?.inspection),false,"source403 retires actor-private inputs without changing the real session");
 else assert.ok(receiptComponent(f)?.inspection);
});

for(const deny of[false,true])test("actual late held Scene actor-input response "+(deny?"retirement-restoration":"healthy"),async t=>{
 const x=await mediaFixture(t),{h,f,id}=x,entered=Promise.withResolvers(),gate=Promise.withResolvers(),prior=h.intercept;
 h.intercept=async request=>{
   if(!request.url.endsWith("/private-receipt"))return prior?.(request);
   const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);
   const body=await response.clone().json();response.json=()=>{entered.resolve(body);return gate.promise;};return response;
 };
 const opening=f.host.openJobById(id),body=await entered.promise;
 if(deny){await x.retire();await x.recovered();}
 gate.resolve(body);await opening;await settle(f);x.noMutation();
 if(deny)assert.equal(Boolean(receiptComponent(f)?.inspection),false,"a pre-retirement private response cannot publish after source restoration");
 else assert.ok(JSON.stringify(receiptComponent(f)?.inspection).includes("The keeper checks the harbor."));
});

for(const deny of[false,true])test("actual Scene private composer and late original cost response "+(deny?"retirement-restoration":"healthy"),async t=>{
 const x=await mediaFixture(t),{h,f,id}=x,secret="PRIVATE composer audience must retire",entered=Promise.withResolvers(),gate=Promise.withResolvers(),prior=h.intercept;
 await f.openScene();await f.fill("audience",secret);
 let held=false;h.intercept=async request=>{
  if(held||request.url!=="/api/document-jobs"||request.body?.payload?.sceneCostPreview!==true)return prior?.(request);
  held=true;assert.equal(request.body.payload.sceneRequestId,id);
  const response=await h.worker.request(request.url,request.init);assert.equal(response.status,200);
  const body=await response.clone().json();response.json=()=>{entered.resolve(body);return gate.promise;};return response;
 };
 await invoke(f,action(f,"scene.cost.inspect")??action(f,"scene.cost.check"));const body=await entered.promise;
 if(deny){await x.retire();await x.recovered();}
 gate.resolve(body);if(!deny)await sceneIdle(f);await settle(f);x.noMutation(true);
 const privatePresent=f.renderer.ownNodes(f.host,"input").some(node=>node.value===secret);
 assert.equal(privatePresent,!deny,"restoration never revives the old source-bound composer input");
 if(deny){
  await f.openScene();await f.check();x.noMutation(true);
  const requests=h.requests.filter(r=>r.url==="/api/document-jobs"&&r.body?.payload?.sceneCostPreview);
  assert.ok(requests.length>=3);assert.ok(requests.every(r=>r.body.payload.sceneRequestId===id),"original dispatched/unknown handle is not replaced");
  assert.equal(action(f,"scene.cost.new"),undefined);assert.equal(enabled(createButton(f)),false);
 }
});
