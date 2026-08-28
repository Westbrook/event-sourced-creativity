
import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createCalmFullPage, fullPageTree, STUDY_SHAPED_TYPES } from "./helpers/calm-full-page-fixture.mjs";

// Data-URL fixture frames are labels, not megabytes of copied fixture source.
const test=(name,run)=>nativeTest(name,async context=>{try{return await run(context);}catch(error){if(typeof error?.stack==="string")error.stack=error.stack.replace(new RegExp("data:text/javascript;base64,[A-Za-z0-9+/=]+","gu"),"full-class-fixture");throw error;}});
const rendered=(tree,tag,predicate=()=>true)=>tree.visible(tag).filter(predicate);
const byClass=name=>node=>String(node.attributes.class??"").split(/\s+/u).includes(name);
const byChoice=value=>node=>node.attributes["data-choice-value"]===value;
const nodeWithin=(node,ancestor)=>{for(let current=node;current;current=current.parent)if(ancestor(current))return true;return false;};
const job=(f,index,status="running",kind="render_document")=>({
 jobId:"synthetic-job-"+index,documentId:f.store.projection.get().documentId,kind,status,sourceSurface:"document",requestedSequence:1,documentRevision:"synthetic-only",requestKey:"synthetic-key-"+index,sourcePreviewId:null,productionMode:"manual",promptTechnique:"prose",promptFanId:null,parentJobId:null,fanKind:null,members:[],result:kind==="render_document"?{artifactKind:index%2?"slides":"short_story"}:null,error:status==="failed"?"Synthetic stopped test job":null,errorDetail:null,moderationPromptRef:null,dismissedAt:null,attemptCount:1,requestedAt:"2026-08-27T00:00:00Z",startedAt:"2026-08-27T00:00:01Z",completedAt:status==="failed"?"2026-08-27T00:00:02Z":null,notifiedAt:null,leaseExpiresAt:null,updatedAt:"2026-08-27T00:00:02Z",stage:status,progressMessage:"Synthetic task status"
});
async function full(t,options){
 const previous=globalThis.fetch;let external=0;
 globalThis.fetch=async()=>{external++;throw new Error("External/provider calls are forbidden in full-page evidence");};
 let fixture;try{fixture=await createCalmFullPage(t,options);}catch(error){globalThis.fetch=previous;throw error;}
 t.after(()=>{globalThis.fetch=previous;assert.equal(external,0,"no external or provider calls");});
 return fixture;
}
function resting(f){
 const tree=f.tree(),counts=tree.controls();
 assert.ok(counts.button<=80,"synthetic resting full hierarchy keeps original <=80 button requirement: "+counts.button);
 assert.ok(counts.select<=6,"synthetic resting full hierarchy keeps original <=6 select requirement: "+counts.select);
 assert.equal(tree.visible("dialog").length,0);
 assert.equal(tree.nodes.filter(node=>node.attributes.role==="dialog"&&!node.hiddenBy).length,0,"non-native dialog panels also closed");
 assert.ok(tree.nodes.filter(node=>Object.hasOwn(node.attributes,"popover")&&node.attributes.role!=="status").every(node=>!f.renderer.openPopovers.has(node.attributes.id)),"account, workspace and action popovers are closed; status-only toast may be present");
 assert.equal(tree.nodes.find(node=>node.attributes.id==="document-context-panel").hiddenBy,null);
 assert.equal(tree.nodes.find(node=>node.attributes.id==="document-results-panel").hiddenBy,"document-results-panel");
 assert.equal(tree.nodes.find(node=>node.attributes.id==="document-workbench-inspector").hiddenBy,"document-workbench-inspector");
 assert.equal(tree.nodes.find(byClass("studio-grid")).attributes["data-workbench-mode"],"write");
 assert.equal(tree.nodes.find(byClass("studio-grid")).attributes["data-inspector-open"],"false");
 assert.equal(rendered(tree,"select",node=>node.owner.tag==="forma-ui-language-picker").length,1,"actual imperative native language picker counted");
 return counts;
}

test("synthetic14 full Shell, real Creative route and all emitted descendants settle at 718/16 Write posture",async t=>{
 const f=await full(t),tree=f.tree();
 assert.deepEqual(f.posture,{viewportWidth:790,viewportHeight:882,studioWidth:718,rootFontSize:16,kind:"functional-native-ports-not-CSS"});
 assert.deepEqual(f.store.projection.get().blocks.map(block=>block.type),STUDY_SHAPED_TYPES);
 for(const tag of ["forma-creative-application","forma-workspace","forma-project-rail","forma-studio-mode-nav","forma-ui-language-picker","forma-generation-actions","forma-document-artifacts","forma-attention-observer"])assert.ok(f.components().some(component=>component.tag===tag),tag+" is an actual instance");
 assert.equal(f.components().filter(component=>component.tag==="forma-context-block").length,14);
 assert.equal(f.components().find(component=>component.tag==="forma-document-artifacts").launcherOnly,false,"not the old launcher-only fixture");
 assert.equal(tree.visible("input").filter(node=>node.attributes.type==="radio"&&node.owner.tag==="forma-context-block").length,14);
 const counts=resting(f);assert.deepEqual(counts,{button:25,select:1});
 assert.equal(tree.nodes.filter(node=>node.tag==="button").length,38,"raw DOM includes hidden contributors, once per element");
 assert.equal(tree.nodes.filter(node=>node.tag==="select").length,2);
 assert.equal(tree.visible("button").filter(node=>Object.hasOwn(node.attributes,"disabled")).length,4,"disabled controls are not subtracted");
 assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST").length,0);
 t.diagnostic("Synthetic full hierarchy:25B/1S structurally visible;38B/2S emitted. Functional 718px studio/16px root ports, not browser geometry or the production study.");
});

test("visibility negatives reject omitted nested components and expose actual hidden Results/closed details contributors",async t=>{
 const f=await full(t),original=f.tree(),results=original.nodes.find(node=>node.attributes.id==="document-results-panel");
 const hiddenToken=f.renderer.markup.match(/<section id="document-results-panel"[^>]*\?hidden=__bound_\d+__/u)?.[0];assert.ok(hiddenToken);
 const flattened=fullPageTree(f,f.renderer.markup.replace(hiddenToken,hiddenToken.replace(/\?hidden=__bound_\d+__/u,"")));
 assert.ok(flattened.controls().button>original.controls().button,"removing actual ancestor guard increases count");
 assert.equal(flattened.nodes.filter(node=>node.tag==="select"&&nodeWithin(node,candidate=>candidate.attributes.id===results.attributes.id)&&!node.hiddenBy).length,0,"closed production-path details still hide their select");
 assert.throws(()=>fullPageTree(f,f.renderer.markup.replace(/data-fixture-component=__bound_\d+__/u,"")),/full hierarchy includes actual/u,"a dropped renderer is not silently accepted");
 const controls=original.visible("button");assert.ok(controls.some(node=>node.owner.tag==="forma-shell"));assert.ok(controls.some(node=>node.owner.tag==="forma-project-rail"));assert.ok(controls.some(node=>node.owner.tag==="forma-generation-actions"));
});

for(const locale of ["en","fr","ar","ja"])for(const reader of [false,true])for(const assistant of [false,true]){
 test("full hierarchy contribution matrix "+JSON.stringify({locale,reader,assistant}),async t=>{
  const f=await full(t,{locale,reader,assistant});const counts=resting(f),tree=f.tree();
  assert.equal(f.components().some(component=>component.tag==="forma-assistant-panel"),assistant);
  assert.equal(tree.visible("button").filter(node=>node.owner.tag==="forma-assistant-panel").length,assistant?1:0,"closed assistant contributes its real launcher only");
  assert.equal(tree.nodes.filter(byClass("composer-dock")).length,reader||assistant?0:1);
  assert.equal(tree.visible("button").filter(node=>node.attributes.title==="Rename document").length,reader?0:1);
  assert.equal(tree.visible("button").filter(node=>byClass("context-set-trigger")(node)).length,reader?0:1);
  assert.equal(tree.visible("button").filter(node=>Object.hasOwn(node.attributes,"data-workbench-pane")).length,3);
  t.diagnostic("Synthetic "+locale+(reader?" reader":" author")+(assistant?" assistant":" fallback")+" "+JSON.stringify(counts));
 });
}

test("populated audio, two combined memberships and nested contexts stay complete while collapsed; opening counts real controls",async t=>{
 const f=await full(t);
 f.patchProperties(13,{media_url:"/api/media/synthetic-audio",label:"Synthetic rights-confirmed score",transcript:"Synthetic complete transcript, not study content.",rights_confirmed:true,audio_cues:[{start_seconds:0,end_seconds:4,target_kind:"scene",target_id:"opening",label:"Opening",emotional_intent:"calm"},{start_seconds:4,end_seconds:8,target_kind:"slide",target_id:"2",label:"Reveal",emotional_intent:"bright"}],combined_context_memberships:[{context_set_id:"synthetic-group-a",name:"Synthetic score",role:"sequence",target:"Opening",application:"ordered",relativity:0.7,member_order:0},{context_set_id:"synthetic-group-b",name:"Synthetic motion",role:"custom",target:"Reveal",application:"isolate",relativity:0.8,member_order:1}]});
 f.appendEvent("BlockRelationAdded",{relation_id:"synthetic-nested-0",from_block_id:"synthetic-0",to_block_id:"synthetic-11",kind:"context_contains",properties:{member_order:0}});
 f.appendEvent("BlockRelationAdded",{relation_id:"synthetic-nested-1",from_block_id:"synthetic-11",to_block_id:"synthetic-12",kind:"context_contains",properties:{member_order:0}});
 await f.settle();const collapsed=resting(f);
 assert.equal(f.store.projection.get().blocks.length,14);assert.equal(f.components().filter(component=>component.tag==="forma-context-block").length,12,"nested decisions are not duplicated as root hosts");
 assert.equal(f.tree().nodes.filter(node=>node.attributes["data-block-id"]).length,14,"all14 decision summaries remain");
 assert.equal(f.tree().visible("audio").length,1,"native audio is separate from authored B/S count");
 assert.match(f.tree().root.text,/Synthetic complete transcript/u);
 await f.act(f.find("input",node=>node.owner.tag==="forma-context-block"&&node.owner.block.id==="synthetic-13"&&node.attributes.type==="radio"),"change");
 await f.act(f.find("button",node=>node.owner.tag==="forma-context-block"&&node.owner.block.id==="synthetic-13"&&byClass("context-controls-toggle")(node)));
 const opened=f.tree();assert.equal(opened.visible("select").filter(node=>node.owner.tag==="forma-context-block").length,9,"2core+1vocal+2cue+4membership selects are not omitted");
 assert.ok(opened.controls().button>collapsed.button);assert.ok(opened.controls().select>6,"expanded editor is deliberately not mislabeled resting posture");
 assert.ok(f.components().some(component=>component.tag==="forma-context-intelligence"));
 await f.act(f.find("button",node=>node.owner.tag==="forma-context-block"&&byClass("context-controls-toggle")(node)));
 assert.deepEqual(resting(f),{button:collapsed.button+1,select:collapsed.select},"selected closed decision keeps one explicit reopen control");
 await f.act(f.find("input",node=>node.owner.tag==="forma-context-block"&&node.owner.block.id==="synthetic-0"&&node.attributes.type==="radio"),"change");
 await f.act(f.find("button",node=>node.owner.tag==="forma-context-block"&&node.owner.block.id==="synthetic-0"&&byClass("context-controls-toggle")(node)));
 const nested=f.tree();assert.equal(nested.visible("li").filter(node=>node.attributes.role==="treeitem").length,2,"actual recursive child editor branches rendered");
 assert.ok(nested.visible("button").filter(node=>nodeWithin(node,byClass("context-tree"))).length>=14,"nested controls and intelligence were not replaced with summary markup");
 assert.equal(nested.nodes.filter(node=>node.tag==="select"&&nodeWithin(node,byClass("context-composition-settings"))).length,2,"actual group settings exist even while their details are closed");
});

test("current shared author notifications and synthetic jobs count by actual branch, foreign scope and reader jobs stay excluded",async t=>{
 const f=await full(t);
 const session=f.store.session.get(),projectId=f.store.projection.get().projectId,documentId=f.store.projection.get().documentId;
 f.store.session.set({...session,projectContext:{organizationId:"synthetic-org",projectAccessId:"synthetic-access",projectId,ownerUserId:session.user.userId,role:"editor",permissions:["project.read","project.author","project.output.request"],expiresAt:new Date(Date.now()+3600_000).toISOString()}});
 f.store.projectNotifications.set(Array.from({length:7},(_,i)=>({id:"synthetic-note-"+i,kind:"changes_requested",artifactId:null,documentId:i===6?"foreign-document":documentId,message:"Synthetic notification "+i,createdAt:"2026-08-27T00:00:00Z",readAt:i===5?"2026-08-27T00:00:01Z":null})));
 f.store.documentJobs.set([job(f,0),job(f,1),job(f,2,"failed"),job(f,3,"running","preview"),{...job(f,4),documentId:"foreign-document"}]);
 await f.settle();resting(f);const tree=f.tree();
 assert.equal(tree.visible("button").filter(node=>nodeWithin(node,byClass("project-followup-actions"))).length,4);
 const artifactControls=tree.nodes.filter(node=>node.tag==="button"&&node.owner.tag==="forma-document-artifacts");assert.ok(artifactControls.length>5);
 assert.ok(artifactControls.every(node=>node.hiddenBy==="document-results-panel"),"mounted job/result descendants are zero in narrow Write");
 assert.ok(tree.visible("button").some(node=>node.owner.tag==="forma-generation-actions"&&/queue/i.test(String(node.attributes.title??"")+" "+node.text)),"active image queue is a visible fallback contributor");
 await f.act(f.find("button",node=>node.attributes["data-workbench-pane"]==="result"));
 assert.ok(f.tree().visible("button").some(node=>node.text==="Stop"));
 assert.ok(f.tree().visible("button").some(node=>node.text==="Inspect inputs"));
 f.store.session.set({...f.store.session.get(),projectContext:{...f.store.session.get().projectContext,role:"viewer",permissions:["project.read"]}});
 await f.settle();assert.equal(f.tree().visible("button").filter(node=>["Stop","Create output","Inspect inputs"].includes(node.text)).length,0);
});

for(const medium of ["image","short_story","scene","slides","storyboard","video","audio"]){
 test("two rendered preparation choices reach the exact "+medium+" executor without submission",async t=>{
  const f=await full(t),original=f.store.projection.get(),actor=f.store.session.get().user.userId,blocks=original.blocks.map(block=>[block.id,block.properties.text]);
  const choices=[];
  const launch=f.find("button",byChoice("configure-output"));choices.push(launch.attributes["data-choice-value"]);await f.act(launch);
  const chooser=f.tree().visible("dialog").find(byClass("next-format-dialog"));assert.ok(chooser);
  assert.deepEqual(f.tree().visible("button").filter(node=>nodeWithin(node,byClass("next-format-dialog"))&&node.owner.tag==="forma-ui-choice-card").map(node=>node.attributes["data-choice-value"]),["image","short_story","scene","slides","storyboard","video","audio"],"all actual format entries retained");
  const format=f.find("button",byChoice(medium));choices.push(format.attributes["data-choice-value"]);await f.act(format);
  assert.equal(choices.length,2,"navigation choices end at executor preparation, not automatic execution");
  const dialogs=f.tree().visible("dialog");
  assert.equal(dialogs.length,1);assert.equal(dialogs[0].owner.tag,medium==="image"?"forma-generation-actions":"forma-document-artifacts");
  assert.ok(byClass(medium==="image"?"generation-details-dialog":"document-artifact-create")(dialogs[0]));
  assert.equal(f.store.projection.get().documentId,original.documentId);assert.equal(f.store.session.get().user.userId,actor);
  assert.deepEqual(f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]),blocks);
  if(medium!=="image")assert.equal(dialogs[0].owner.documentId,original.documentId);
  assert.ok(f.tree().visible("button").some(node=>nodeWithin(node,byClass(medium==="image"?"generation-details-dialog":"document-artifact-create"))&&((medium!=="image"&&(node.attributes.type??"submit")==="submit")||medium==="image"&&/^Generate full/u.test(node.text))),"actual final action retained");
  assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST").length,0,"configuration did not create, quote, execute or buy");
 });
}

test("pending local quick edit uses actual Workspace and Store once; its review relocates without duplication when assistant enabled",async t=>{
 const f=await full(t),before=f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]);
 f.storeHost.intercept=request=>{
  if(request.url!=="/api/events"||request.body?.action!=="propose")return;
  assert.equal(request.body.events.length,1);assert.equal(request.body.events[0].payload.document_id,f.store.projection.get().documentId);
  const sequence=f.store.head.get()+1;
  return Response.json({appended:[{eventId:"synthetic-proposal",streamId:f.storeHost.worker.streamId,sequence,occurredAt:"2026-08-27T00:00:00Z",actor:"model:forma-chat",correlationId:"synthetic-full-page",type:"MutationProposed",payload:{content_ref:"synthetic-private-proposal",proposed_events:request.body.events,expected_sequence:request.body.expectedSequence}}],head:sequence});
 };
 const input=f.find("textarea",node=>node.attributes.id==="creative-command");input.port.value="Use softer shadows";await f.act(input,"input");
 await f.act(f.find("button",node=>node.text==="Quick edit"));
 assert.equal(f.storeHost.requests.filter(request=>request.body?.action==="propose").length,1);
 assert.deepEqual(f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]),before,"pending proposal did not apply its change");
 assert.equal(f.tree().nodes.filter(byClass("proposal-preview")).length,1);
 assert.equal(f.tree().visible("button").filter(node=>["Decline","Accept change"].includes(node.text)).length,2);
 resting(f);
 f.store.session.set({...f.store.session.get(),assistant:{enabled:true,phase:"read-only",capabilities:["project.assistant.read"]}});
 await f.settle();
 assert.equal(f.tree().nodes.filter(byClass("proposal-preview")).length,1);
 assert.equal(f.tree().nodes.filter(byClass("composer-dock")).length,0);
 assert.equal(f.tree().nodes.filter(byClass("document-quick-edit-review")).length,1);
 assert.equal(f.tree().visible("button").filter(node=>["Decline","Accept change"].includes(node.text)).length,2);
 assert.deepEqual(f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]),before);
 assert.equal(f.storeHost.requests.filter(request=>request.url==="/api/document-jobs"&&request.init.method==="POST").length,0);
 resting(f);
});

test("all14 study-shaped decisions reach their actual controls in two rendered choices without changing source",async t=>{
 const f=await full(t),before=f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]);
 for(const [id,text]of before){
  await f.act(f.find("input",node=>node.owner.tag==="forma-context-block"&&node.owner.block.id===id&&node.attributes.type==="radio"),"change");
  const toggle=f.find("button",node=>node.owner.tag==="forma-context-block"&&node.owner.block.id===id&&byClass("context-controls-toggle")(node));
  assert.equal(toggle.attributes["aria-expanded"],"false");await f.act(toggle);
  const tree=f.tree(),panel=tree.nodes.find(node=>byClass("context-controls-panel")(node)&&node.owner.block?.id===id);assert.ok(panel);assert.equal(panel.hiddenBy,null);
  assert.equal(tree.nodes.filter(node=>byClass("context-controls-panel")(node)&&!node.hiddenBy).length,1);
  assert.ok(tree.visible("select").some(node=>node.owner.block?.id===id&&/intent/u.test(String(node.attributes["aria-label"]??""))),"actual per-decision intent executor for "+id);
  assert.equal(f.store.projection.get().blocks.find(block=>block.id===id).properties.text,text);
  await f.act(f.find("button",node=>node.owner.tag==="forma-context-block"&&node.owner.block.id===id&&byClass("context-controls-toggle")(node)));
  resting(f);
 }
 assert.deepEqual(f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]),before);
 assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST").length,0);
});

for(const withdrawal of ["source","reader"]){
 test("old rendered preparation choice cannot retarget after "+withdrawal+" withdrawal",async t=>{
  const f=await full(t);await f.act(f.find("button",byChoice("configure-output")));const oldChoice=f.find("button",byChoice("short_story"));
  if(withdrawal==="source")f.patchProperties(0,{text:"Synthetic changed exact source after the chooser opened"});
  else{const session=f.store.session.get();f.store.session.set({...session,projectContext:{organizationId:"synthetic-org",projectAccessId:"synthetic-access",projectId:f.store.projection.get().projectId,ownerUserId:session.user.userId,role:"viewer",permissions:["project.read"],expiresAt:new Date(Date.now()+3600_000).toISOString()}});}
  await f.settle();await f.act(oldChoice);
  assert.equal(f.tree().visible("dialog").filter(byClass("document-artifact-create")).length,0);
  assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST").length,0,"stale preparation never submitted");
 });
}
