
import assert from"node:assert/strict";
import test from"node:test";
import{presentationFullShellFixture}from"./helpers/media-private-retirement-fixture.mjs";

for(const deny of[false,true])test("actual full Shell private-draft reference "+(deny?"source retirement/remount":"healthy"),async t=>{
 const x=await presentationFullShellFixture(t),{h,full,id}=x;await x.open();
 const original=x.owner();assert.ok(original?.isConnected);const before=h.requests.length;
 if(deny){
  await x.retire();await full.settle();assert.equal(original.isConnected,false,"the real Shell removes the old component");
  assert.equal(full.renderer.markup.includes("PRIVATE_REJECTED_TITLE"),false);
  await x.recovered();await full.settle();
  assert.notEqual(x.owner(),original,"restoration instantiates a different private reader");
  assert.equal(full.renderer.markup.includes("PRIVATE_REJECTED_TITLE"),false,"no automatic private reopening");
  assert.equal(h.requests.slice(before).some(r=>r.url==="/api/document-jobs/"+id+"/presentation-candidates"),false,"no replacement inspection/submission");
  assert.ok(full.tree().nodes.some(node=>node.tag==="button"&&node.text===full.i18n.t("presentation.draft.review")),"the original private-draft reference remains reachable after parent replacement");
  await x.open();assert.equal(h.requests.at(-1).url,"/api/document-jobs/"+id+"/presentation-candidates/source-retirement-draft-1");
 }else assert.equal(x.owner(),original);
 x.noMutation();
});
