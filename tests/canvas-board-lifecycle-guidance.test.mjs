import assert from "node:assert/strict";
import test from "node:test";
import { options, BOARD, classed, drain, reached, dialogs, activate, cards, priority, boardPage } from "./helpers/board-lifecycle-navigation-fixture.mjs";
for(const origin of["canvas","desk"])test("actual "+origin+" Document guidance retains healthy exact saved-work opening",options,async t=>{
  const f=await boardPage(t,{origin}),before=JSON.stringify(f.store.events.get()),rows=cards(f);assert.ok(rows.length>0);
  // Healthy existing saved artifact remains inspectable on either policy; it
  // is not called a canonical requirement acceptance or a delivered output.
  activate(f,rows[0].button);await reached(f,()=>dialogs(f).some(row=>classed(row,"document-artifact-view")||classed(row,"canvas-artifact-viewer")),"the actual exact saved artifact viewer opens");
  const artifact=f.store.projection.get().libraryArtifacts.find(value=>value.id==="saved-scene-story");assert.ok(artifact);
  const view=f.components().find(value=>value.tag==="forma-document-artifacts"&&value.querySelector(".document-artifact-view")?.open);
  if(view)assert.equal(view.documentId,f.documentId);
  assert.equal(JSON.stringify(f.store.events.get()),before);await f.sourceUnchanged();
});
for(const origin of["canvas","desk"])test("actual "+origin+" source blocker outranks saved work and opens the exact Document source",options,async t=>{
  const f=await boardPage(t,{origin,mode:"source"}),{action,button}=priority(f,t,"source-block"),before=JSON.stringify(f.store.events.get());
  assert.equal(action.target.blockId,"scene-reuse-direction");activate(f,button);
  await reached(f,()=>f.native.document.activeElement?.getAttribute("data-block-id")==="scene-reuse-direction","exact real Document source article arrival");
  assert.equal(f.canvas.isConnected,false);assert.equal(f.store.projection.get().documentId,f.documentId);
  assert.equal(JSON.stringify(f.store.events.get()),before);assert.equal(dialogs(f).length,0);await f.sourceUnchanged();
});
for(const origin of["canvas","desk"])for(const mode of["document-job","board-job"])
test("actual "+origin+" keeps "+mode+" original uncertainty ahead of unrelated saved work",options,async t=>{
  const f=await boardPage(t,{origin,mode}),original=f.store.documentJobs.get().find(value=>value.jobId===f.jobId);assert.ok(original);
  if(mode==="board-job")assert.equal(original.canvasId,BOARD);
  const{action,button}=priority(f,t,"job");assert.equal(action.id,"check-original-job");assert.equal(action.target.jobId,f.jobId);
  const route=f.store.route.get();activate(f,button);
  await reached(f,()=>dialogs(f).some(row=>classed(row,"generation-input-dialog")),"the same original's actual input inspector opens locally");
  assert.ok(f.canvas.isConnected);assert.equal(f.store.route.get(),route);
  const inspector=f.components().find(value=>value.tag==="forma-generation-input-dialog"&&value.open);assert.ok(inspector?.inspection);
  assert.equal(inspector.inspection.receipt.job.job_id,f.jobId);assert.equal(inspector.inspection.receipt.job.document_id,f.documentId);
  const close=f.find("button",row=>row.owner===inspector&&row.attributes["aria-label"]==="Close generation inputs");
  f.native.emit("keydown",close.port);await drain(f,2);assert.ok(inspector.open,"normal post-open input outlives the disposed gesture lease");
  await f.act(close);assert.equal(inspector.open,false);await f.sourceUnchanged();
});

