import assert from "node:assert/strict";
import nativeTest from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
const test=(name,run)=>nativeTest(name,async t=>{try{return await run(t);}catch(error){if(typeof error?.stack==="string")error.stack=error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu,"full-class-fixture");throw error;}});
import { createOutputReachabilityPage, withinOutput } from "./helpers/output-reachability-fixture.mjs";
import { FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import { outputSourceReadiness } from "../src/components/output-source-readiness.ts";
import { outputOperationSupportReceipt } from "../src/components/output-operation-support-receipt.ts";
const postcss=createRequire(import.meta.resolve("vite"))("postcss");
const cssText=fs.readFileSync(new URL("../src/components/forma-output-requirements.css",import.meta.url),"utf8");
const sheet=postcss.parse(cssText);
const classIs=name=>node=>String(node.attributes.class??"").split(/\s+/u).includes(name);
const within=(node,predicate)=>{for(let current=node;current;current=current.parent)if(predicate(current))return true;return false;};
const disabled=node=>Object.hasOwn(node.attributes,"disabled");
function summaryContract(tree){
 const summaries=tree.nodes.filter(node=>node.tag==="summary"&&withinOutput(node));
 assert.ok(summaries.length,"actual inline summaries must reach the rendered tree");
 const rules=[];sheet.walkRules(rule=>{if(rule.selector==="forma-output-requirements summary")rules.push(rule);});
 assert.equal(rules.length,1,"one scoped reachability rule covers controller and child summaries");
 const declarations=Object.fromEntries(rules[0].nodes.filter(node=>node.type==="decl").map(node=>[node.prop,node.value]));
 assert.equal(declarations["min-block-size"],"var(--forma-control-min-size,2.75rem)");
 assert.equal(declarations["min-inline-size"],"var(--forma-control-min-size,2.75rem)");
 assert.equal(declarations["max-inline-size"],"100%");
 assert.equal(declarations["overflow-wrap"],"anywhere");
 assert.equal(declarations["padding-inline"],".5rem");
 assert.equal(declarations["box-sizing"],"border-box");
 for(const forbidden of ["position","display","height","block-size","max-height","max-block-size","visibility"])assert.equal(declarations[forbidden],undefined,"no fixed-size, overlay or hiding workaround");
 const focus=[];sheet.walkRules(rule=>{if(rule.selector==="forma-output-requirements summary:focus-visible")focus.push(rule);});
 assert.equal(focus.length,1);
 assert.ok(focus[0].nodes.some(node=>node.prop==="outline"&&node.value.includes("Highlight")));
 for(const summary of summaries){
   assert.equal(summary.parent.tag,"details");assert.ok(summary.text.trim());
   assert.equal(summary.attributes.role,undefined);assert.equal(summary.attributes.popovertarget,undefined);
   assert.equal(summary.parent.attributes.popover,undefined);
 }
 return summaries;
}

for(const state of ["unconfirmed","confirmed","multi-target","unknown","reviewer","read-only"])for(const surface of ["document","deliver"])for(const locale of ["en","fr","ar","ja"])test("full Output hierarchy "+JSON.stringify({state,surface,locale}),async t=>{
 const f=await createOutputReachabilityPage(t,{state,surface,locale});
 const tree=f.tree(),controllers=f.outputControllers(),cards=f.outputCards(),documents=surface==="document"?FIXTURE_DOCUMENT_IDS.slice(0,1):FIXTURE_DOCUMENT_IDS;
 assert.ok(f.components().some(c=>c.tag==="forma-shell"));
 assert.ok(f.components().some(c=>c.tag==="forma-creative-application"));
 assert.ok(f.components().some(c=>c.tag===(surface==="document"?"forma-workspace":"forma-deliver")));
 assert.equal(controllers.filter(c=>!c.blockId).length,documents.length);
 assert.equal(cards.length,documents.length,"actual child cards render once for each included document");
 for(const id of documents){
   const snapshot=f.outputSnapshot(id);assert.ok(snapshot);
   assert.equal(f.store.outputRequirements.resource(id).state,"ready");
   const rendered=tree.nodes.filter(node=>node.attributes["data-output-target"]&&node.owner.documentId===id);
   assert.deepEqual(rendered.map(node=>node.attributes["data-output-target"]).sort(),(snapshot.confirmedPlan?.plan.targets??[]).map(target=>target.id).sort(),"every target is actually rendered");
   if(state==="unconfirmed")assert.equal(snapshot.confirmedPlan,null);
   if(state==="multi-target")assert.ok(rendered.length>1);
   if(state==="unknown")assert.equal(outputSourceReadiness(snapshot).allowed,false);
 }
 summaryContract(tree);
 const forms=tree.visible("form").filter(withinOutput);
 if(state==="reviewer"||state==="read-only"){
   assert.equal(forms.filter(classIs("output-requirement-form")).length,0,"read-only roles do not gain an editor");
   assert.equal(tree.visible("input").filter(node=>withinOutput(node)&&node.attributes.type==="file").length,0);
   assert.ok(cards.every(card=>card.snapshot.canEdit===false&&card.snapshot.canReviewPlan===false));
   const run=tree.visible("button").filter(node=>withinOutput(node)&&within(node,classIs("output-execution"))&&node.attributes.type==="submit");
   assert.ok(run.length);assert.ok(run.every(disabled));
   const review=forms.filter(classIs("output-result-review"));
   assert.equal(review.length,state==="reviewer"?documents.length:0);
   if(state==="reviewer")assert.equal(tree.visible("button").filter(node=>withinOutput(node)&&node.attributes.value==="approve"&&!disabled(node)).length,documents.length);
 }
 if(state==="unknown"){
   const exports=tree.visible("button").filter(node=>withinOutput(node)&&within(node,classIs("output-export"))&&node.attributes.type==="submit");
   assert.ok(exports.length);assert.ok(exports.every(disabled),"unknown source checks cannot imply delivery readiness");
 }
 assert.equal(tree.nodes.filter(node=>withinOutput(node)&&Object.hasOwn(node.attributes,"popover")).length,0,"genuine inline work is not turned into a menu");
 assert.ok(tree.nodes.filter(node=>node.tag==="forma-output-requirement-card").every(node=>node.component&&node.children.some(child=>typeof child!=="string")));
 assert.equal(f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request)).length,0);
 t.diagnostic(JSON.stringify({state,surface,locale,page:tree.controls(),output:f.outputControls(),targets:tree.nodes.filter(node=>node.attributes["data-output-target"]).length}));
});


for(const surface of ["document","deliver"])for(const locale of ["en","ar"])test("native inline disclosure keeps source and instances on "+surface+" in "+locale,async t=>{
 const f=await createOutputReachabilityPage(t,{surface,locale,state:"confirmed"}),tree=f.tree();
 const details=tree.nodes.find(node=>classIs("output-requirement-provenance")(node)&&!node.hiddenBy);assert.ok(details);
 const summary=details.children.find(node=>typeof node!=="string"&&node.tag==="summary");assert.ok(summary);
 const instances=[...f.outputControllers(),...f.outputCards()],events=JSON.stringify(f.store.events.get()),snapshots=JSON.stringify(FIXTURE_DOCUMENT_IDS.map(id=>f.adapter.snapshot(id))),requests=f.outputRequests.length;
 const opened=f.toggleSummary(summary);
 assert.equal(opened.nodes.find(node=>node.port===details.port).open,true);
 assert.ok(opened.nodes.some(node=>node.tag==="code"&&!node.hiddenBy&&within(node,classIs("output-requirement-provenance"))));
 const closed=f.toggleSummary(opened.nodes.find(node=>node.tag==="summary"&&node.parent.port===details.port));
 assert.equal(closed.nodes.find(node=>node.port===details.port).open,false);
 assert.deepEqual([...f.outputControllers(),...f.outputCards()],instances,"details default does not unmount the controller or child");
 assert.ok(instances.every(instance=>instance.isConnected));assert.equal(JSON.stringify(f.store.events.get()),events);
 assert.equal(JSON.stringify(FIXTURE_DOCUMENT_IDS.map(id=>f.adapter.snapshot(id))),snapshots);
 assert.equal(f.outputRequests.length,requests,"opening evidence does not submit authoring or cost work");
});

for(const surface of ["document","deliver"])test("unavailable Output transport stays explicit on "+surface,async t=>{
 const f=await createOutputReachabilityPage(t,{surface,unavailable:true}),documents=surface==="document"?FIXTURE_DOCUMENT_IDS.slice(0,1):FIXTURE_DOCUMENT_IDS;
 for(const id of documents){assert.equal(f.store.outputRequirements.resource(id).state,"unavailable");assert.equal(f.outputSnapshot(id),null);}
 assert.ok(f.outputControllers().length,"actual controller, not a placeholder port");
 assert.equal(f.outputCards().length,0,"the actual unknown-response branch does not fabricate requirement cards");
 assert.equal(f.outputTree().filter(node=>node.attributes["data-output-target"]).length,0);
 assert.ok(f.outputTree().some(node=>node.attributes.role==="alert"&&!node.hiddenBy));
 assert.equal(f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request)).length,0);
});

for(const surface of ["document","deliver"])test("retained uncertain operation receipt is not hidden or remounted by disclosure on "+surface,async t=>{
 const f=await createOutputReachabilityPage(t,{surface,state:"uncertain-receipt"}),before=JSON.stringify(FIXTURE_DOCUMENT_IDS.map(id=>f.adapter.snapshot(id))),instances=f.outputControllers();
 const tree=f.tree(),receipts=tree.nodes.filter(node=>classIs("output-operation-receipt")(node)&&!node.hiddenBy);
 assert.equal(receipts.length,surface==="document"?1:FIXTURE_DOCUMENT_IDS.length);
 for(const receipt of receipts){
   assert.equal(receipt.open,true,"recovery receipt remains initially disclosed");
   const snapshot=f.outputSnapshot(receipt.owner.documentId),grant=snapshot.grants[0],slot=grant.operations[0];
   const manual=tree.visible("textarea").find(node=>within(node,candidate=>candidate===receipt));assert.ok(manual);
   assert.ok(Object.hasOwn(manual.attributes,"readonly"));
   assert.ok(manual.port.value.includes(JSON.stringify(slot.jobId)),"this exact document's existing operation remains inspectable in the real readonly field");
   assert.equal(manual.port.value,outputOperationSupportReceipt(snapshot,grant.id,slot.id,f.store.documentJobs.get()));
 }
 const provenance=tree.nodes.find(node=>classIs("output-requirement-provenance")(node)&&!node.hiddenBy);
 f.toggleSummary(provenance.children.find(node=>typeof node!=="string"&&node.tag==="summary"));
 assert.deepEqual(f.outputControllers(),instances);
 assert.equal(JSON.stringify(FIXTURE_DOCUMENT_IDS.map(id=>f.adapter.snapshot(id))),before);
 assert.equal(f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request)).length,0);
 assert.ok(receipts.every(receipt=>f.tree().nodes.find(node=>node.port===receipt.port).open));
});

for(const surface of ["document","deliver"])for(const locale of ["en","fr","ar","ja"])test("real Output child editor is expanded and counted on "+surface+" in "+locale,async t=>{
 const f=await createOutputReachabilityPage(t,{state:"confirmed",surface,locale}),card=f.outputCards()[0],before=f.outputControls();
 const edit=f.find("button",node=>node.owner===card&&node.text===f.i18n.t("output.requirement.edit"));
 await f.act(edit);
 const form=f.tree().visible("form").find(node=>node.owner===card&&classIs("output-requirement-form")(node));assert.ok(form,"actual child form expanded");
 const fields=f.tree().visible("textarea").filter(node=>node.owner===card);
 assert.ok(fields.length);assert.ok(fields.some(node=>node.attributes.name==="originalText"&&node.port.value===card.snapshot.originalText),"real live() value is preserved");
 assert.ok(f.outputControls().textarea>before.textarea);
 summaryContract(f.tree());
 assert.equal(f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request)).length,0);
 t.diagnostic("Expanded child editor: "+JSON.stringify(f.outputControls())+"; all fields counted, not a stub or collapsed-only claim.");
});

test("full hierarchy detects an omitted Output child definition instead of accepting a quiet page",async t=>{
 const f=await createOutputReachabilityPage(t),markup=f.renderer.markup;
 const missing=markup.replace(/(<forma-output-requirement-card[^>]*?) data-fixture-component=__bound_\d+__/u,"$1");
 assert.notEqual(missing,markup);
 const {fullPageTree}=await import("./helpers/calm-full-page-fixture.mjs");
 assert.throws(()=>fullPageTree(f,missing),/full hierarchy includes actual forma-output-requirement-card/u);
});

test("summary reachability keeps logical, scalable target and focus rules only",()=>{
 const selectors=[];sheet.walkRules(rule=>{if(rule.selector.startsWith("forma-output-requirements summary"))selectors.push(rule.selector);});
 assert.deepEqual(selectors,["forma-output-requirements summary","forma-output-requirements summary:focus-visible"]);
 for(const rootPx of [16,20,32])assert.ok(2.75*rootPx>=44,"user root-font scaling preserves the target floor");
 assert.doesNotMatch(cssText,/position\s*:\s*(?:absolute|fixed)|overflow\s*:\s*(?:hidden|clip)/u);
});

for(const surface of ["document","deliver"])for(const locale of ["en","fr","ar","ja"])test("real plan review remains an expanded inline form on "+surface+" in "+locale,async t=>{
 const f=await createOutputReachabilityPage(t,{state:"unconfirmed",surface,locale}),controller=f.outputControllers().find(value=>!value.blockId&&value.documentId===FIXTURE_DOCUMENT_IDS[0]);
 const button=f.find("button",node=>node.owner===controller&&node.text===f.i18n.t("output.delivery.reviewPlan"));
 const snapshot=JSON.stringify(f.outputSnapshot()),requests=f.outputRequests.length;
 await f.act(button);
 const tree=f.tree(),review=tree.nodes.find(node=>node.owner===controller&&classIs("output-plan-review")(node)&&!node.hiddenBy);assert.ok(review);
 assert.ok(tree.visible("form").some(node=>within(node,candidate=>candidate===review)),"the real plan form, not a collapsed placeholder");
 assert.ok(tree.visible("select").some(node=>within(node,candidate=>candidate===review)),"all planning controls are expanded and counted");
 assert.equal(review.attributes.popover,undefined);assert.equal(review.attributes.role,undefined);
 summaryContract(tree);
 assert.equal(JSON.stringify(f.outputSnapshot()),snapshot);assert.equal(f.outputRequests.length,requests,"review disclosure neither saves nor requests cost");
 t.diagnostic("Expanded plan review: "+JSON.stringify(f.outputControls()));
});

for(const surface of ["document","deliver"])test("native disclosure retains the real uncertain free-command identity on "+surface,async t=>{
 const f=await createOutputReachabilityPage(t,{state:"confirmed",surface});
 const controller=f.outputControllers().find(value=>!value.blockId&&value.documentId===FIXTURE_DOCUMENT_IDS[0]);
 await f.act(f.find("button",node=>node.owner===controller&&node.text===f.i18n.t("output.delivery.reviewPlan")));
 const form=()=>f.tree().visible("form").find(node=>node.owner===controller&&within(node,classIs("output-plan-review")));
 assert.ok(form());
 const originalPlanRevision=f.outputSnapshot(controller.documentId).confirmedPlan.revisionId;
 const commands=[],responses=[],fetchFixture=f.adapter.fetch;let loseResponse=true;
 f.adapter.fetch=async(path,init={})=>{
   const response=await fetchFixture(path,init);
   if(init.method==="POST"&&JSON.parse(init.body).action==="confirm"){
     commands.push(JSON.parse(init.body));responses.push(await response.clone().json());
     if(loseResponse){loseResponse=false;throw Error("SYNTHETIC free confirmation committed; its reply was lost");}
   }
   return response;
 };
 await f.act(form(),"submit");
 assert.equal(commands.length,1);assert.notEqual(f.adapter.snapshot(controller.documentId).confirmedPlan.revisionId,originalPlanRevision);
 assert.equal(f.outputSnapshot(controller.documentId).confirmedPlan.revisionId,originalPlanRevision,"real client retains the old snapshot after a lost reply");
 assert.ok(f.tree().visible("form").some(node=>node.owner===controller&&within(node,classIs("output-plan-review"))),"uncertain review remains mounted");
 const instances=[...f.outputControllers(),...f.outputCards()];
 const provenance=f.tree().nodes.find(node=>node.owner.documentId===controller.documentId&&classIs("output-requirement-provenance")(node)&&!node.hiddenBy);assert.ok(provenance);
 const opened=f.toggleSummary(provenance.children.find(node=>typeof node!=="string"&&node.tag==="summary"));
 f.toggleSummary(opened.nodes.find(node=>node.tag==="summary"&&node.parent.port===provenance.port));
 assert.deepEqual([...f.outputControllers(),...f.outputCards()],instances);
 assert.ok(instances.every(instance=>instance.isConnected));
 await f.act(form(),"submit");
 assert.equal(commands.length,2);assert.deepEqual(commands[1],commands[0],"the actual private uncertainCommand survives native disclosure; exact mutation ID and revision are reused");
 assert.equal(responses[1].replayed,true,"the actual domain fixture returns its original saved receipt");
 assert.equal(f.outputSnapshot(controller.documentId).confirmedPlan.revisionId,responses[0].snapshot.confirmedPlan.revisionId);
 const writes=f.outputRequests.filter(request=>request.method!=="GET"&&!f.isReadOnlyResume(request));
 assert.equal(writes.length,2);assert.ok(writes.every(request=>JSON.parse(request.body).action==="confirm"),"only the two explicit free confirmation attempts occurred; no preflight, grant or paid run");
});
