
import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createCalmFullPage, fullPageTree, STUDY_SHAPED_TYPES } from "./helpers/calm-full-page-fixture.mjs";
import { certifyActualOutputFixtureResumeReads } from "./helpers/output-reachability-fixture.mjs";

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
 let fixture;try{fixture=await createCalmFullPage(t,options);fixture.isReadOnlyResume=await certifyActualOutputFixtureResumeReads(fixture);}catch(error){globalThis.fetch=previous;throw error;}
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
 assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST"&&!f.isReadOnlyResume(request)).length,0);
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

// Independent literal oracles for the optional Phase8 entry-copy supplement.
// Existing actual full-page fixtures and every prior matrix assertion remain intact.
const quickEditEntryCopy=Object.freeze({
 en:{detail:"Free local rules, no model: add one decision, or enter the literal word warmer or cooler for a palette you choose. Review the proposal, then approve to apply it.",placeholder:"Write one new decision, or enter warmer or cooler for a chosen palette…"},
 fr:{detail:"Règles locales gratuites, sans modèle : ajoutez une décision ou saisissez le mot anglais warmer ou cooler pour une palette de votre choix. Examinez la proposition, puis approuvez-la pour l’appliquer.",placeholder:"Rédigez une nouvelle décision, ou saisissez warmer ou cooler pour la palette choisie…"},
 ar:{detail:"قواعد محلية مجانية، بلا نموذج: أضف قرارًا واحدًا، أو اكتب حرفيًا \u2068warmer\u2069 أو \u2068cooler\u2069 للوحة ألوان تختارها. راجع الاقتراح، ثم وافق عليه لتطبيقه.",placeholder:"اكتب قرارًا جديدًا واحدًا، أو \u2068warmer\u2069 أو \u2068cooler\u2069 للوحة الألوان المختارة…"},
 ja:{detail:"無料のローカルルールで、モデルは使いません。決定事項を1つ追加するか、選んだパレットに対して英単語 warmer または cooler をそのまま入力します。提案を確認し、別途承認して適用します。",placeholder:"新しい決定事項を1つ、または選んだパレットに warmer か cooler を入力…"},
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
  if(!reader){
   const expected=quickEditEntryCopy[locale],source=f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]);
   assert.equal(f.i18n.t("assistant.mode.quickEditDetail"),expected.detail);
   assert.equal(f.i18n.t("assistant.mode.quickEditPlaceholder"),expected.placeholder);
   for(const value of [expected.detail,expected.placeholder]){
    assert.match(value,/\bwarmer\b/u);assert.match(value,/\bcooler\b/u);
    if(locale==="ar"){assert.ok(value.includes("\u2068warmer\u2069"));assert.ok(value.includes("\u2068cooler\u2069"));
     assert.equal((value.match(/\u2068/gu)??[]).length,2);assert.equal((value.match(/\u2069/gu)??[]).length,2);}
   }
   if(assistant){
    // The actual host opens with an absolute, private GET. Route only that
    // exact current fixture request through the existing RAM Worker transport.
    const denied=globalThis.fetch,reads=[];
    globalThis.fetch=(input,init={})=>{
     const url=new URL(String(input),"https://fixture.invalid");
     if(url.origin!=="https://fixture.invalid"||url.pathname!=="/api/assistant"||(init.method??"GET")!=="GET")return denied(input,init);
     assert.equal(url.searchParams.get("route"),f.store.route.get());assert.equal(url.searchParams.get("projectId"),f.store.projection.get().projectId);
     const reading=f.storeHost.fetch(url.pathname+url.search,init).then(response=>{assert.equal(response.status,200,"actual scoped assistant read");return response;});
     reads.push(reading);return reading;
    };
    try{
     await f.act(f.find("button",byClass("forma-assistant-launcher")));await Promise.all(reads);await f.settle();assert.ok(reads.length>0);
     const panel=f.components().find(component=>component.tag==="forma-assistant-panel");assert.ok(panel);
     const field=()=>f.find("textarea",node=>node.owner.tag==="forma-ui-conversation-composer"&&byClass("forma-assistant-input")(node));
     const submit=()=>f.find("button",node=>node.owner===field().owner);
     const modes=()=>rendered(f.tree(),"button",node=>node.owner===panel&&byClass("forma-assistant-mode")(node)).map(node=>node.text);
     const mode=label=>f.find("button",node=>node.owner===panel&&byClass("forma-assistant-mode")(node)&&node.text===label);
     const view=()=>({label:field().attributes["aria-label"],placeholder:field().attributes.placeholder,submit:submit().attributes["aria-label"],
      detail:rendered(f.tree(),"p",node=>node.owner===panel&&byClass("forma-assistant-mode-detail")(node)).map(node=>node.text)});
     const labels=modes(),quick=f.i18n.t("assistant.mode.quickEdit"),ordinary=labels.filter(label=>label!==quick),saved=[];
     assert.ok(labels.includes(quick));assert.ok(ordinary.length>0);
     for(const label of ordinary){
      await f.act(mode(label));const current=view(),draft="  "+label+" — Ask draft أزرق 日本語\nkeep this line  ";
      const input=field();input.port.value=draft;await f.act(input,"input");saved.push({label,view:current,draft});
     }
     await f.act(mode(quick));assert.equal(field().properties.value,"","scope is shown before the first quick-edit instruction");
     assert.deepEqual(view(),{label:quick,placeholder:expected.placeholder,submit:f.i18n.t("assistant.mode.quickEditSubmit"),detail:[expected.detail]});
     const quickDraft="  One local decision — قرار 日本語\nkeep this line  ",input=field();input.port.value=quickDraft;await f.act(input,"input");
     for(const prior of saved){await f.act(mode(prior.label));assert.equal(field().properties.value,prior.draft);assert.deepEqual(view(),prior.view,"other mode copy and accessible labels are unchanged");}
     await f.act(mode(quick));assert.equal(field().properties.value,quickDraft);assert.deepEqual(modes(),labels);
    }finally{globalThis.fetch=denied;}
   }else{
    const field=()=>f.find("textarea",node=>node.owner.tag==="forma-workspace"&&node.attributes.id==="creative-command");
    const quick=()=>f.find("button",node=>node.owner.tag==="forma-workspace"&&node.text==="Quick edit");
    const placeholder=field().attributes.placeholder,draft="  Shared Ask field — أزرق 日本語\nkeep this line  ";
    assert.equal(field().properties.value,"");assert.equal(quick().attributes.title,expected.detail,"localized scope is on the existing fallback title before input");
    const input=field();input.port.value=draft;await f.act(input,"input");f.store.notify();await f.settle();
    assert.equal(field().properties.value,draft);assert.equal(field().attributes.placeholder,placeholder,"the shared Ask field is not relabeled as quick-edit-only");
    assert.equal(quick().attributes.title,expected.detail);assert.equal(Object.hasOwn(quick().attributes,"disabled"),false);
   }
   assert.deepEqual(f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]),source);
   assert.equal(f.storeHost.requests.filter(request=>(request.init.method??"GET")!=="GET"&&!f.isReadOnlyResume(request)).length,0,"copy inspection and draft changes neither submit nor buy");
  }
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
  assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST"&&!f.isReadOnlyResume(request)).length,0,"configuration did not create, quote, execute or buy");
 });
}

test("pending local quick edit uses actual Workspace and Store once; its review relocates without duplication when assistant enabled",async t=>{
 const f=await full(t),before=f.store.projection.get().blocks.map(block=>[block.id,block.properties.text]);
 // Phase 8 persists this exact free review through the existing authoring
 // route; the retired /api/events proposal synthesis cannot represent it.
 const worker=f.storeHost.worker,counts=()=>Object.fromEntries(["events","authoring_commits","document_jobs","budget_reservations","cost_budget_reservations"]
   .map(table=>[table,worker.sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get().n]));
 const originalCounts=counts();let reviewed=null;
 f.storeHost.transport=async request=>{
   const response=await worker.request(request.url,request.init);
   if(request.url==="/api/workspace/quick-edit"&&request.body?.action==="preview"){
     assert.equal(request.init.method,"POST");
     assert.equal(request.body.projectId,f.store.projection.get().projectId);assert.equal(request.body.documentId,f.store.projection.get().documentId);
     assert.equal(request.body.prompt,"Use softer shadows");assert.equal(request.body.targetBlockId,null);
     assert.equal(response.status,200);reviewed=await response.clone().json();assert.equal(reviewed.status,"not-applied");
   }
   return response;
 };
 const input=f.find("textarea",node=>node.attributes.id==="creative-command");input.port.value="Use softer shadows";await f.act(input,"input");
 await f.act(f.find("button",node=>node.text==="Quick edit"));
 for(let step=0;step<12&&!reviewed;step++)await f.settle();
 assert.ok(reviewed?.preview?.previewId,"the current actual Worker retained a durable review");
 assert.ok(worker.sqlite.prepare("SELECT content_id FROM private_content WHERE content_id=?").get(reviewed.preview.previewId));
 assert.equal(f.storeHost.requests.filter(request=>request.url==="/api/workspace/quick-edit"&&request.body?.action==="preview").length,1);
 assert.deepEqual(f.storeHost.requests.filter(request=>(request.init.method??"GET")!=="GET"&&!f.isReadOnlyResume(request))
   .map(request=>[request.url,request.body?.action]),[["/api/workspace/quick-edit","preview"]],"no apply, dismiss, legacy event proposal or purchase");
 assert.deepEqual(counts(),originalCounts,"a retained free preview does not write source, authoring commits, jobs or budgets");
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
 assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST"&&!f.isReadOnlyResume(request)).length,0);
});

for(const withdrawal of ["source","reader"]){
 test("old rendered preparation choice cannot retarget after "+withdrawal+" withdrawal",async t=>{
  const f=await full(t);await f.act(f.find("button",byChoice("configure-output")));const oldChoice=f.find("button",byChoice("short_story"));
  if(withdrawal==="source")f.patchProperties(0,{text:"Synthetic changed exact source after the chooser opened"});
  else{const session=f.store.session.get();f.store.session.set({...session,projectContext:{organizationId:"synthetic-org",projectAccessId:"synthetic-access",projectId:f.store.projection.get().projectId,ownerUserId:session.user.userId,role:"viewer",permissions:["project.read"],expiresAt:new Date(Date.now()+3600_000).toISOString()}});}
  await f.settle();await f.act(oldChoice);
  assert.equal(f.tree().visible("dialog").filter(byClass("document-artifact-create")).length,0);
  assert.equal(f.storeHost.requests.filter(request=>request.init.method==="POST"&&!f.isReadOnlyResume(request)).length,0,"stale preparation never submitted");
 });
}
