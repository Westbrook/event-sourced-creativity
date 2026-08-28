import assert from"node:assert/strict";
import test from"node:test";
import{mediaFixture,presentationFixture,settle,receiptReady,receiptComponent,action,enabled,createButton}from"./helpers/media-private-retirement-fixture.mjs";

for(const locale of["en","fr","ar","ja"])test("actual "+locale+" Scene retirement preserves original held request without private bytes",async t=>{
 const x=await mediaFixture(t,{locale}),{h,f,id}=x;
 await f.host.openJobById(id);await receiptReady(f);assert.ok(receiptComponent(f)?.inspection);
 await x.retire();await x.recovered();await settle(f);assert.equal(Boolean(receiptComponent(f)?.inspection),false);
 await f.openScene();await f.check();x.noMutation(true);
 const request=h.requests.filter(r=>r.body?.payload?.sceneCostPreview).at(-1);
 assert.equal(request.body.payload.sceneRequestId,id);assert.equal(action(f,"scene.cost.new"),undefined);assert.equal(enabled(createButton(f)),false);
});
for(const locale of["en","fr","ar","ja"])test("actual "+locale+" rejected private presentation retires while retaining the original held job",async t=>{
 const x=await presentationFixture(t,{locale}),{f,h,id}=x;await x.open();const before=h.requests.length;
 await x.retire();await x.recovered();f.host.jobs=[];await settle(f);
 assert.equal(f.visible().includes("PRIVATE_REJECTED_TITLE"),false);assert.equal(f.visible().includes("PRIVATE_REJECTED_SUMMARY"),false);
 assert.equal(h.requests.slice(before).some(r=>r.url.includes("/presentation-candidates")),false);
 await x.open();x.noMutation();assert.equal(h.requests.at(-1).url,"/api/document-jobs/"+id+"/presentation-candidates/source-retirement-draft-1");
});
