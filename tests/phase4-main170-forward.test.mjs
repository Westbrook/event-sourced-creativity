import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createCalmFullPage } from "./helpers/calm-full-page-fixture.mjs";
import { createOutputReachabilityPage, certifyActualOutputFixtureResumeReads } from "./helpers/output-reachability-fixture.mjs";
import { FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import { libraryBlockEditorRoute, libraryFocusRoute } from "../src/model/routes.ts";

const test=(name,run)=>nativeTest(name,async t=>{try{return await run(t);}catch(error){if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");throw error;}});
const classIs=name=>node=>String(node.attributes.class??"").split(/\s+/u).includes(name);
const within=(node,predicate)=>{for(let current=node;current;current=current.parent)if(predicate(current))return true;return false;};

// Full real Shell and descendants. These are deterministic DOM/HTTP ports,
// not browser geometry, assistive-technology or server-authority certification.
test("full-page settlement joins the actual mounted empty Output read once",async t=>{
 const savedFetch=globalThis.fetch;let external=0;globalThis.fetch=async()=>{external++;throw Error("No external/provider transport in the full-page settlement fixture");};
 t.after(()=>{globalThis.fetch=savedFetch;assert.equal(external,0);});
 const f=await createCalmFullPage(t),id=f.store.projection.get().documentId;
 const output=f.components().find(component=>component.tag==="forma-output-requirements"&&component.documentId===id);assert.ok(output);
 assert.equal(f.store.outputRequirements.resource(id).state,"ready","loading chrome cannot masquerade as settled page evidence");
 assert.equal(f.store.outputRequirements.resource(id).snapshot.requirements.length,0);
 const reads=f.storeHost.requests.filter(request=>request.url==="/api/output-requirements?documentId="+encodeURIComponent(id));
 assert.equal(reads.length,1,"joining the existing client read does not create a duplicate request");
 assert.equal(reads[0].init.method??"GET","GET");
 const readOnlyResume=await certifyActualOutputFixtureResumeReads(f);
 assert.equal(f.storeHost.requests.filter(readOnlyResume).length,1,"Phase 8 mounts the existing free resume once");
 assert.equal(f.storeHost.requests.filter(request=>(request.init.method??"GET")!=="GET"&&!readOnlyResume(request)).length,0);
 assert.equal(f.tree().visible("button").filter(node=>node.owner===output).length,0);
 assert.equal(output.isConnected,true,"the actual empty controller stays mounted");
});

for(const state of ["unconfirmed","confirmed","reviewer","read-only"])for(const locale of ["en","ar"])test("main170 Output keeps its real controller outside calm generic disclosure "+JSON.stringify({state,locale}),async t=>{
 const f=await createOutputReachabilityPage(t,{state,locale}),id=FIXTURE_DOCUMENT_IDS[0];
 const row=f.outputSnapshot(id).requirements[0];
 const context=f.components().find(component=>component.tag==="forma-context-block"&&component.block?.id===row.blockId);assert.ok(context);
 const output=f.outputControllers().find(component=>component.documentId===id&&component.blockId===row.blockId);assert.ok(output);
 const tree=f.tree(),root=tree.nodes.find(node=>node.component===context);assert.ok(root);
 assert.ok(tree.nodes.some(node=>node.component===output&&node.parent===root),"the Output child is a direct real renderer, not a collapsed generic summary");
 assert.equal(f.tree().nodes.filter(node=>node.owner===context&&classIs("context-controls-toggle")(node)).length,0);
 const card=f.outputCards().find(component=>component.snapshot.requirementId===row.blockId);assert.ok(card);
 assert.ok(f.tree().nodes.some(node=>node.component===card&&within(node,parent=>parent.component===output)));
 let editing=false;
 if(state==="confirmed"||state==="unconfirmed"){
   await f.act(f.find("button",node=>node.owner===card&&node.text===f.i18n.t("output.requirement.edit")));
   editing=true;assert.ok(f.tree().visible("form").some(node=>node.owner===card&&classIs("output-requirement-form")(node)));
 }
 const snapshot=JSON.stringify(f.outputSnapshot(id)),events=f.store.events.get();
 const choose=f.find("input",node=>node.owner.tag==="forma-context-block"&&node.owner.block.id==="synthetic-0"&&node.attributes.type==="radio");
 await f.act(choose,"change");
 assert.equal(f.store.ui.focusBlockId,"synthetic-0");
 assert.equal(f.outputControllers().find(component=>component.blockId===row.blockId),output);
 assert.equal(f.outputCards().find(component=>component.snapshot.requirementId===row.blockId),card);
 assert.ok(output.isConnected&&card.isConnected);
 if(editing)assert.ok(f.tree().visible("form").some(node=>node.owner===card&&classIs("output-requirement-form")(node)),"another decision's selection does not unmount this Output draft");
 assert.ok(f.tree().visible("button").some(node=>node.owner.block?.id==="synthetic-0"&&classIs("context-controls-toggle")(node)),"ordinary calm controls remain reachable");
 assert.equal(JSON.stringify(f.outputSnapshot(id)),snapshot);assert.equal(f.store.events.get(),events);
 assert.equal(f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request)).length,0);
});

for(const state of ["confirmed","read-only"])for(const locale of ["en","ar"])test("main170 document-owned Output remains inspection-only in the actual Library route "+JSON.stringify({state,locale}),async t=>{
 const f=await createOutputReachabilityPage(t,{state,locale}),id=FIXTURE_DOCUMENT_IDS[0],row=f.outputSnapshot(id).requirements[0];
 f.store.route.set(libraryBlockEditorRoute(row.blockId,f.store.route.get()));await f.settle();
 assert.ok(f.components().some(component=>component.tag==="forma-library"));
 const editor=f.components().find(component=>component.tag==="forma-library-block-editor");assert.ok(editor);
 const output=f.outputControllers().find(component=>component.documentId===id&&component.blockId===row.blockId);assert.ok(output);
 assert.equal(output.inspectionOnly,true,"main170's dedicated Library inspection precedes the generic read-only branch");
 const card=f.outputCards().find(component=>component.snapshot.requirementId===row.blockId);assert.ok(card);
 assert.equal(card.snapshot.canEdit,false);assert.equal(card.snapshot.canReviewPlan,false);
 assert.equal(f.tree().visible("form").filter(node=>node.owner===card||node.owner===output).length,0);
 assert.equal(f.tree().visible("button").filter(node=>node.owner===card&&node.text===f.i18n.t("output.requirement.edit")).length,0);
 assert.deepEqual(f.tree().visible("button").filter(node=>node.owner===editor).map(node=>node.text).sort(),[f.i18n.system("Back to Library"),f.i18n.system("Open Document")].sort(),"only the existing inspection navigation is offered in every locale");
 assert.equal(f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request)).length,0);
});

for(const locale of ["en","ar"])test("standalone Library Output renders the actual read-only card without a document controller in "+locale,async t=>{
 const f=await createOutputReachabilityPage(t,{locale,state:"confirmed"}),row=f.outputSnapshot().requirements[0],id="synthetic-library-output";
 f.appendEvent("BlockCreated",{scope:"library",document_id:"",block_id:id,type:"output",handle:"output/synthetic-library",properties:{text:row.content,subtype:row.subtype,output_spec:{...row.spec,id}}});
 assert.equal(f.store.projection.get().libraryBlocks.find(block=>block.id===id).scope,"library");
 f.store.route.set(libraryBlockEditorRoute(id,f.store.route.get()));await f.settle();
 const editor=f.components().find(component=>component.tag==="forma-library-block-editor");assert.ok(editor);
 const card=f.outputCards().find(component=>component.snapshot.requirementId===id);assert.ok(card);
 assert.equal(card.snapshot.canEdit,false);assert.equal(card.snapshot.canReviewPlan,false);
 assert.equal(card.snapshot.originalText,row.content);assert.equal(card.snapshot.spec.id,id);
 assert.equal(f.outputControllers().length,0,"no fabricated Document authority is introduced for a standalone requirement");
 assert.equal(f.tree().visible("form").filter(node=>within(node,parent=>parent.component===editor)).length,0,"the standalone requirement is read-only; the outer Library search form remains legitimate");
 assert.equal(f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request)).length,0);
});

for(const locale of ["en","fr","ar","ja"])test("explicit read-only Library focus keeps author-owned Output inspection-only in "+locale,async t=>{
 const f=await createOutputReachabilityPage(t,{state:"confirmed",locale}),id=FIXTURE_DOCUMENT_IDS[0],row=f.outputSnapshot(id).requirements[0];
 assert.equal(f.outputSnapshot(id).permissions.canAuthor,true,"inspection intent is distinct from account authority");
 f.store.route.set(libraryFocusRoute("block",row.blockId,row.content));await f.settle();
 const context=f.components().find(component=>component.tag==="forma-context-block"&&component.block?.id===row.blockId);assert.ok(context);
 assert.equal(context.readOnly,true,"the actual Library focus caller requests inspection");
 const output=f.outputControllers().find(component=>component.documentId===id&&component.blockId===row.blockId);assert.ok(output);
 assert.equal(output.inspectionOnly,true,"the original controller must honor the explicit inspection-only host");
 const card=f.outputCards().find(component=>component.snapshot.requirementId===row.blockId);assert.ok(card);
 assert.equal(card.snapshot.canEdit,false);assert.equal(card.snapshot.canReviewPlan,false);
 assert.equal(f.tree().visible("form").filter(node=>node.owner===card||node.owner===output).length,0);
 assert.equal(f.tree().visible("button").filter(node=>node.owner===card&&node.text===f.i18n.t("output.requirement.edit")).length,0);
 assert.equal(f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request)).length,0);
});
