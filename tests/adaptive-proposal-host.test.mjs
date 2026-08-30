import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import ts from "typescript";
import { adaptiveProposalOptions, buildAdaptiveProposalApplication } from "../src/model/adaptive-proposal-application.ts";
import { blockTypeDefinition, suggestedSubtype } from "../src/model/block-types.ts";
import { withCanvasView } from "../src/canvas/routes.ts";
import { documentContextBlockRoute, libraryFocusRoute } from "../src/model/routes.ts";
import { ADAPTIVE_PROPOSAL_MESSAGES } from "../src/components/design-system/locales/adaptive-proposal-messages.ts";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";

// Use the scoped actual-source loader from assistant-runtime.test.mjs. Keep
// production imports and every paid-flow assertion unchanged; remove the hook
// as soon as the real controller and its source dependencies have loaded.
const sourceRoot = new URL("../", import.meta.url).href;
const sourceResolution = registerHooks({ resolve(specifier, context, nextResolve) {
  const source = typeof context.parentURL === "string" && context.parentURL.startsWith(sourceRoot)
    && !context.parentURL.includes("/node_modules/");
  return nextResolve(source && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier)
    ? specifier + ".ts" : specifier, context);
} });
const { captureOutputNavigationFocus } = await import("../src/components/output-navigation-focus.ts");
const { AdaptiveProposalReviewController, adaptiveSelectionKey, canonicalAdaptiveSelection, createAdaptiveProposalReview } =
  await import("../src/components/adaptive-proposal-review.ts").finally(() => sourceResolution.deregister());

// Explicit lexical ports for the unchanged production methods evaluated below.
void{blockTypeDefinition,suggestedSubtype};

const structure={interpretation:"Original paid interpretation",active_decision:{type:"subject",label:"Next decision",prompt:"Choose an exact subject.",why:"Focus the work."},
  suggested_blocks:[{type:"subject",subtype:"Hero subject",label:"Original subject",instruction:"Keep every original word.",reason:"Make the intent concrete.",relationship_to:"Audience"},
    {type:"environment",subtype:"Interior",label:"Original setting",instruction:"Keep the setting grounded.",reason:"Connect context.",relationship_to:"Subject"}],hidden_until_later:["Lighting"]};
const originalHash="a".repeat(64),bindingHash="b".repeat(64),approvalHash="c".repeat(64),currentHash="d".repeat(64);
const scope=canvasId=>({key:"authority-a",owner:"owner-a",actorUserId:"actor-a",projectId:"project-a",documentId:"doc-a",canvasId,canAuthor:true});
const nativeBlock=(id,extra={})=>({id,projectId:"project-a",documentId:"doc-a",canvasId:"",scope:"document",type:"subject",handle:"subject/"+id,position:"a",removed:false,locked:false,sourceEvents:[],properties:{text:"Existing authored text",label:id,subtype:"Hero subject",authority:"authored",weight:.75},...extra});
const projection=canvasId=>({projectId:"project-a",documentId:"doc-a",projectName:"Project",documentTitle:"Document",documents:[{id:"doc-a",projectId:"project-a",title:"Document"}],
  blocks:[],libraryBlocks:[nativeBlock("first-subject",canvasId?{canvasId,documentId:"",scope:"canvas"}:{}),nativeBlock("second-subject",canvasId?{canvasId,documentId:"",scope:"canvas"}:{})],libraryBlockRelations:[],blockRelations:[],membership:{},outputs:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(setImmediate);
function fixture({canvasId=null,readable=true,canAuthor=true}={}){
  const state={scope:{...scope(canvasId),canAuthor},source:{executionId:"paid-original",bindingHash:readable?bindingHash:null,structure:readable?structuredClone(structure):null,readable,withdrawalRevision:0},projection:projection(canvasId),refreshes:0,changes:0,reads:[],refreshError:false};
  const calls=[],pending=[],waiters=[];
  // Finite single-source model port, not a Store/Worker authority certificate.
  // Reuse its existing withdrawal value and the existing branded ownership port.
  const sourceOwner={captureAuthorizationScope:()=>state.scope?{key:JSON.stringify([state.scope.key,state.scope.owner]),shared:false}:null};
  sourceOwner.authorizationScopeActive=value=>Boolean(value&&value.key===sourceOwner.captureAuthorizationScope()?.key);
  installSourceOwnershipPort(sourceOwner);
  const ports={scope:()=>state.scope,source:id=>!id||id===state.source.executionId?state.source:null,projection:()=>state.projection,
    captureRead:()=>{const source=sourceOwner.captureSourceOwnership();return sourceOwner.sourceOwnershipActive(source)
      ?Object.freeze({revision:state.source.withdrawalRevision,current:()=>sourceOwner.sourceOwnershipActive(source)}):null;},
    readOriginal:async id=>{state.reads.push(id);state.source={...state.source,bindingHash,structure:structuredClone(structure),readable:true};},
    request:body=>{const gate=deferred(),call={body:structuredClone(body),gate};calls.push(call);if(waiters.length)waiters.shift()(call);else pending.push(call);return gate.promise;},
    refresh:async()=>{state.refreshes++;if(state.refreshError)throw new Error("refresh failed");},changed:()=>state.changes++};
  const controller=new AdaptiveProposalReviewController(ports);
  return{controller,state,calls,ports,take:()=>pending.length?Promise.resolve(pending.shift()):new Promise(resolve=>waiters.push(resolve)),
    async reply(call,body,status=200,json=async()=>body){call.gate.resolve({ok:status>=200&&status<300,status,json});await turn();},
    async lose(call){call.gate.reject(new TypeError("Connection lost"));await turn();}};
}
async function previewFor(f,selections,id="preview-a"){
  const source=f.state.scope;let next=0;
  const planned=buildAdaptiveProposalApplication({projection:f.state.projection,documentId:source.documentId,canvasId:source.canvasId,structure,executionId:"paid-original",bindingHash,selections,createId:()=>id+"-object-"+(++next)});
  return{previewId:id,approvalHash,sourceHash:currentHash,projectId:source.projectId,documentId:source.documentId,canvasId:source.canvasId,blockId:"",
    events:planned.events,changes:planned.changes,blockCount:selections.length,relationCount:0,expiresAt:"2099-01-01T00:00:00.000Z",
    adaptiveReview:{executionId:"paid-original",bindingHash,selectionKey:await adaptiveSelectionKey(source,"paid-original",bindingHash,selections),
      originalSourceHash:originalHash,currentSourceHash:currentHash,sourceChanged:true,selections:structuredClone(selections),interpretation:structure.interpretation,
      originalSuggestions:adaptiveProposalOptions(structure).filter(item=>selections.some(selection=>selection.proposalId===item.proposalId))}};
}
function receiptFor(preview,extra={}){
  const blockIds=preview.changes.filter(item=>item.kind==="create"||item.kind==="edit").map(item=>item.targetId),canvasItemIds=preview.changes.filter(item=>item.kind==="place").map(item=>item.targetId);
  return{status:"applied",previewId:preview.previewId,approvalHash:preview.approvalHash,executionId:preview.adaptiveReview.executionId,bindingHash:preview.adaptiveReview.bindingHash,
    selectionKey:preview.adaptiveReview.selectionKey,blockIds,canvasItemIds,relationCount:0,idempotent:true,...extra};
}
async function saved(f,ids=["/suggested_blocks/0"]){
  f.controller.open("paid-original",ids,f.state.scope.canvasId?{x:-120,y:340,w:300,h:210}:undefined);
  const work=f.controller.request("preview"),call=await f.take(),preview=await previewFor(f,call.body.selections);
  await f.reply(call,{status:"review",preview,noPayment:true});await work;assert.equal(f.controller.phase,"review");return preview;
}
function syntax(path){return ts.createSourceFile(path,readFileSync(new URL("../"+path,import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);}
const docSyntax=syntax("src/components/forma-studio-editor-alternatives.ts"),canvasSyntax=syntax("src/canvas/canvas-application.ts"),storeSyntax=syntax("src/state/store.ts"),dialogSyntax=syntax("src/components/adaptive-proposal-dialog.ts"),rendererSyntax=syntax("src/components/authoring-preview.ts");
function member(tree,owner,name){
  const declaration=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===owner),node=declaration?.members.find(item=>item.name?.getText(tree)===name);
  assert.ok(node,owner+"."+name);return node.getText(tree).replace(/^protected override /,"").replace(/^override /,"");
}
function entry(f,surface){
  const store={projection:{get:()=>f.state.projection},head:{get:()=>0},appendBatch:async()=>{throw new Error("GENERIC_PARTIAL_APPEND");},outputBlockTextEvents:()=>{throw new Error("GUESS_FIRST_TARGET");},canvasProjection:{get:()=>({selectedCanvasId:f.state.scope.canvasId,items:[]})}};
  const proposed=f.controller,HTMLElement=class{},ownerDocument={activeElement:null};let remembered=0;
  const code=surface==="document"?
    '(class {store=store;ownerDocument=ownerDocument;#proposalReview=proposed;#activeType="";#custom="";#rememberProposalOpener(){remembered++;}requestUpdate(){}commit(...args){return this.#commit(...args);}'+member(docSyntax,"FormaAdaptivePath","#commit")+'})':
    '(class {store=store;ownerDocument=ownerDocument;#proposalReview=proposed;#proposalOpener;#canEditCanvas(){return true;}#insertionPoint(){return{x:-120,y:340};}#createNativeBlock(){throw new Error("GENERIC_CANVAS_APPEND");}use(id,ids){return this.#useSuggestion(id,ids);}'+member(canvasSyntax,"CanvasApplication","#useSuggestion")+'})';
  const makeSlug=value=>value;void{proposed,HTMLElement,ownerDocument,makeSlug};const Probe=eval(stripTypeScriptTypes(code));
  return{host:new Probe(),store,remembered:()=>remembered};
}
// These older handler probes keep their original scope/reply boundaries. Add
// only the newly required actual private members, shared focus implementation,
// branded source port, and committed result records from their real model preview.
function canvasResultDependencies(){
  return member(canvasSyntax,"CanvasApplication","#proposalResultNavigation")
    +member(canvasSyntax,"CanvasApplication","#currentProposalResultNavigation");
}
function receiptCanvasItem(preview,id,position){
  const rows=preview.events.filter(event=>event.type==="CanvasItemPlaced"&&event.payload.item_id===id);
  assert.equal(rows.length,1,"exact existing model-produced placement");
  const value=rows[0].payload;
  return{id,sourceKind:value.source_kind,sourceId:value.source_id,projectId:value.project_id,canvasId:value.canvas_id,...position};
}
function canvasResultPorts(f,store,preview){
  store.captureAuthorizationScope=()=>{const value=f.ports.scope();return value?{key:JSON.stringify([value.key,value.owner,value.actorUserId,
    value.projectId,value.documentId,value.canvasId,value.canAuthor]),shared:false}:null;};
  store.authorizationScopeActive=scope=>Boolean(scope&&store.captureAuthorizationScope()?.key===scope.key);
  installSourceOwnershipPort(store);
  const subscribers=new Set();
  store.subscribe=listener=>{subscribers.add(listener);return()=>subscribers.delete(listener);};
  store.notify=()=>{subscribers.forEach(listener=>listener());};
  for(const event of preview.events.filter(value=>value.type==="BlockCreated")){
    const value=event.payload;
    if(!f.state.projection.libraryBlocks.some(block=>block.id===value.block_id))f.state.projection.libraryBlocks.push(nativeBlock(value.block_id,
      {projectId:value.project_id,documentId:value.document_id??"",canvasId:value.canvas_id??"",scope:value.scope,
        type:value.type,handle:value.handle,position:value.position,properties:structuredClone(value.properties)}));
  }
  return nativeFocusPorts();
}
// Same native focus port for result navigation and the older plain close hosts.
function nativeFocusPorts(){
  const listeners=new Map(),document={activeElement:null,body:{isConnected:true},documentElement:{isConnected:true},
    addEventListener(type,handler){listeners.set(type,[...(listeners.get(type)??[]),handler]);},
    removeEventListener(type,handler){listeners.set(type,(listeners.get(type)??[]).filter(value=>value!==handler));}};
  return{document,target(callback){return{isConnected:true,focus(){document.activeElement=this;
    for(const listener of listeners.get("focusin")??[])listener({target:this});callback();}};}};
}

function render(f,locale="en"){
  const handlers=[],nothing=Symbol("nothing"),item=value=>Array.isArray(value)?value.map(item).join(""):typeof value==="function"?"__handler_"+(handlers.push(value)-1)+"__":value===nothing?"":String(value??"");
  const html=(parts,...values)=>parts.reduce((value,part,index)=>value+part+(index<values.length?item(values[index]):""),"");
  const i18n={t:key=>ADAPTIVE_PROPOSAL_MESSAGES[locale][key]??key,number:String,system:value=>value};
  const functionCode=(tree,name)=>tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(tree).replace(/^export /,"");
  const renderAuthoringPreview=eval(stripTypeScriptTypes("("+functionCode(rendererSyntax,"renderAuthoringPreview")+")"));
  void{html,renderAuthoringPreview};const renderAdaptiveProposalDialog=eval(stripTypeScriptTypes("("+functionCode(dialogSyntax,"renderAdaptiveProposalDialog")+")"));
  const dialogNode={open:true},opened=[],markup=String(renderAdaptiveProposalDialog(f.controller,i18n,{id:"review-title",dialog:()=>dialogNode,close:()=>f.controller.close(),open:(kind,id)=>opened.push([kind,id])}));
  const buttons=[...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([,attrs,label])=>({label,disabled:/\?disabled=true\b/.test(attrs),click:handlers[Number(attrs.match(/@click=__handler_(\d+)__/)?.[1])]}));
  return{markup,buttons,opened,dialogNode,handlers,nativeClose:handlers[Number(markup.match(/@close=__handler_(\d+)__/)?.[1])]};
}

// The actual paid entry methods are evaluated with in-memory ports, not substitutes.
// A partial-success append port must never be reached by either paid path.
for(const surface of["document","canvas"])test(surface+" actual paid host: generic partial append cannot accept a suggestion",async()=>{
  const f=fixture({canvasId:surface==="canvas"?"board-a":null}),host=entry(f,surface).host;
  if(surface==="document")await host.commit("subject","provider text","Hero subject",{executionId:"paid-original",proposalIds:["/suggested_blocks/0","/suggested_blocks/1"]});
  else await host.use("paid-original",["/suggested_blocks/0","/suggested_blocks/1"]);
  assert.equal(f.calls.length,0);assert.equal(f.controller.visible,true);
  const starting=f.controller.request("preview"),call=await f.take();
  assert.equal(call.body.action,"preview");assert.equal(call.body.executionId,"paid-original");assert.equal(call.body.bindingHash,bindingHash);
  assert.deepEqual(call.body.selections.map(item=>item.proposalId),["/suggested_blocks/0","/suggested_blocks/1"]);
  assert.ok(call.body.selections.every(item=>!item.targetBlockId));assert.equal(call.body.events,undefined);
  if(surface==="canvas")assert.deepEqual(call.body.selections.map(item=>item.placement),[{x:-120,y:340,w:300,h:210},{x:-96,y:364,w:300,h:210}]);
  const preview=await previewFor(f,call.body.selections);await f.reply(call,{status:"review",preview});await starting;
  assert.equal(f.controller.canApply,true);const applying=f.controller.request("apply"),apply=await f.take();
  assert.deepEqual(apply.body,{action:"apply",projectId:"project-a",documentId:"doc-a",canvasId:f.state.scope.canvasId,previewId:preview.previewId,approvalHash});
  await f.reply(apply,receiptFor(preview));await applying;assert.equal(f.controller.phase,"applied");assert.equal(f.state.refreshes,1);
});
test("missing private binding requires only the explicit original free read",async()=>{
  const f=fixture({readable:false});f.controller.open("paid-original",["/active_decision"]);
  assert.equal(f.controller.canPreview,false);await f.controller.request("preview");assert.equal(f.calls.length,0);
  assert.ok(render(f).buttons.some(button=>button.label.includes("Retrieve this original proposal")&&!button.disabled));
  await f.controller.retrieveOriginal();assert.deepEqual(f.state.reads,["paid-original"]);assert.equal(f.controller.canPreview,true);assert.equal(f.calls.length,0);
});
test("target selection is native, explicit and never first same-type; exact whitespace survives",async()=>{
  const f=fixture();f.state.projection.libraryBlocks.push(nativeBlock("other-document",{documentId:"doc-b"}),nativeBlock("protected",{locked:true}),nativeBlock("output",{properties:{source_artifact_id:"artifact"}}));
  f.controller.open("paid-original",["/suggested_blocks/0"]);assert.deepEqual(f.controller.targets("/suggested_blocks/0").map(item=>item.id),["first-subject","second-subject"]);
  assert.equal(f.controller.selections()[0].targetBlockId,undefined);
  f.controller.update("/suggested_blocks/0","targetBlockId","second-subject");f.controller.update("/suggested_blocks/0","text","  Human answer.\nComplete ending.  ");
  const pending=f.controller.request("preview"),call=await f.take();assert.equal(call.body.selections[0].targetBlockId,"second-subject");assert.equal(call.body.selections[0].edit.text,"  Human answer.\nComplete ending.  ");
  const preview=await previewFor(f,call.body.selections);assert.ok(preview.events.every(event=>event.payload.block_id==="second-subject"));
  await f.reply(call,{status:"review",preview});await pending;
});
test("Canvas placement is reviewed, editable, and removed only for an explicitly chosen native edit",()=>{
  const f=fixture({canvasId:"board-a"});f.controller.open("paid-original",["/suggested_blocks/0"],{x:-1,y:2,w:300,h:210});
  f.controller.update("/suggested_blocks/0","x","417.5");f.controller.update("/suggested_blocks/0","h","360");
  assert.deepEqual(f.controller.selections()[0].placement,{x:417.5,y:2,w:300,h:360});
  assert.match(render(f).markup,/Review placement on this board/);f.controller.update("/suggested_blocks/0","targetBlockId","second-subject");assert.equal(f.controller.selections()[0].placement,undefined);
  f.controller.update("/suggested_blocks/0","targetBlockId","");assert.equal(f.controller.selections()[0].placement.x,417.5);
});
test("lost apply response keeps exact handle and own draft across close/reopen; Check only retrieves",async()=>{
  const f=fixture();f.controller.open("paid-original",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","text","  Keep my draft.\n  ");
  const preparing=f.controller.request("preview"),first=await f.take(),preview=await previewFor(f,first.body.selections);await f.reply(first,{status:"review",preview});await preparing;
  const applying=f.controller.request("apply"),call=await f.take();f.controller.close();await f.lose(call);await applying;
  assert.equal(f.controller.uncertain,true);assert.deepEqual(f.controller.handle,{previewId:preview.previewId,approvalHash});
  f.controller.open("different-paid",["/active_decision"]);assert.equal(f.controller.executionId,"paid-original");assert.equal(f.controller.drafts[0].edit.text,"  Keep my draft.\n  ");
  await f.controller.request("apply");await f.controller.request("preview");f.controller.update("/suggested_blocks/0","text","wrong retry");assert.equal(f.calls.length,2);
  const checking=f.controller.resume(),check=await f.take();assert.equal(check.body.action,"retrieve");assert.equal(check.body.previewId,preview.previewId);assert.equal(check.body.approvalHash,approvalHash);
  f.state.refreshError=true;await f.reply(check,receiptFor(preview));await checking;
  assert.equal(f.controller.phase,"applied");assert.equal(f.controller.refreshFailed,true);assert.ok(f.controller.receipt);assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,false);
});
test("partial or malformed apply receipts are not acceptance and cannot be repeated",async()=>{
  const f=fixture(),preview=await saved(f),work=f.controller.request("apply"),call=await f.take();
  await f.reply(call,{status:"applied",appended:[preview.events[0]],previewId:preview.previewId,approvalHash});await work;
  assert.equal(f.controller.phase,"uncertain");assert.equal(f.controller.receipt,null);assert.equal(f.state.refreshes,0);assert.equal(f.controller.canApply,false);
  const checking=f.controller.resume(),check=await f.take();await f.reply(check,receiptFor(preview));await checking;assert.equal(f.controller.phase,"applied");
});
test("lost preview response uses resume and refuses a different paid selection",async()=>{
  const f=fixture();f.controller.open("paid-original",["/suggested_blocks/0"]);const starting=f.controller.request("preview"),call=await f.take();await f.lose(call);await starting;
  assert.equal(f.controller.handle,null);assert.equal(f.controller.uncertain,true);
  const checking=f.controller.resume(),resume=await f.take();assert.deepEqual(resume.body,{action:"resume",projectId:"project-a",documentId:"doc-a",canvasId:null});
  const other=await previewFor(f,[{proposalId:"/active_decision"}]);await f.reply(resume,{status:"not-applied",preview:other,readOnly:true});await checking;
  assert.equal(f.controller.canApply,false);assert.equal(f.controller.preview,null);assert.equal(f.controller.uncertain,true);
});
test("fresh host resumes retained human edits without a new paid operation",async()=>{
  const f=fixture(),preview=await previewFor(f,[{proposalId:"/suggested_blocks/0",targetBlockId:"second-subject",edit:{text:"  Retained edit.\n"}}]);
  const checking=f.controller.resume(),resume=await f.take();await f.reply(resume,{status:"not-applied",preview,stale:false,readOnly:true,noPayment:true});await checking;
  assert.equal(f.controller.executionId,"paid-original");assert.equal(f.controller.bindingHash,bindingHash);assert.equal(f.controller.drafts[0].targetBlockId,"second-subject");assert.equal(f.controller.drafts[0].edit.text,"  Retained edit.\n");
  assert.equal(f.controller.canApply,true);assert.equal(f.calls.length,1);
  const markup=render(f).markup;assert.match(markup,/Original and current source revisions/);assert.ok(markup.includes(originalHash)&&markup.includes(currentHash));assert.match(markup,/source changed after the paid proposal/);
});
test("cancel before preview, close and explicit dismiss never append or apply",async()=>{
  const f=fixture();f.controller.open("paid-original",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","text","Own draft");f.controller.close();assert.equal(f.calls.length,0);
  f.controller.open("paid-original",["/suggested_blocks/0"]);assert.equal(f.controller.drafts[0].edit.text,"Own draft");
  const preparing=f.controller.request("preview"),call=await f.take(),preview=await previewFor(f,call.body.selections);await f.reply(call,{status:"review",preview});await preparing;
  const dismissing=f.controller.request("dismiss"),dismiss=await f.take();assert.deepEqual(dismiss.body,{action:"dismiss",projectId:"project-a",documentId:"doc-a",canvasId:null,previewId:preview.previewId,approvalHash});
  await f.reply(dismiss,{status:"dismissed"});await dismissing;assert.equal(f.controller.visible,false);assert.equal(f.controller.handle,null);assert.equal(f.state.refreshes,0);assert.equal(f.controller.drafts[0].edit.text,"Own draft");
});
for(const timing of["headers","json"])test("current permission withdrawal during "+timing+" cannot revive private review",async()=>{
  const f=fixture();f.controller.open("paid-original",["/active_decision"]);const starting=f.controller.request("preview"),call=await f.take(),preview=await previewFor(f,call.body.selections),json=deferred();
  if(timing==="headers")f.state.scope={...f.state.scope,key:"authority-b",canAuthor:false};
  await f.reply(call,{status:"review",preview},200,async()=>{if(timing==="json"){await json.promise;}return{status:"review",preview};});
  if(timing==="json"){f.state.scope={...f.state.scope,key:"authority-b",canAuthor:false};json.resolve();}
  await starting;f.controller.synchronize();assert.equal(f.controller.preview,null);assert.deepEqual(f.controller.originals,[]);assert.equal(f.controller.canApply,false);assert.doesNotMatch(render(f).markup,/Original paid interpretation|Choose an exact subject/);
});
test("newer private withdrawal beats late JSON while retaining only locally authored edits",async()=>{
  const f=fixture();f.controller.open("paid-original",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","text","My unsaved exact words");
  const preparing=f.controller.request("preview"),call=await f.take(),preview=await previewFor(f,call.body.selections),json=deferred();
  await f.reply(call,{status:"review",preview},200,async()=>{await json.promise;return{status:"review",preview};});
  f.state.source={...f.state.source,readable:false,bindingHash:null,structure:null,withdrawalRevision:9};json.resolve();await preparing;
  assert.equal(f.controller.preview,null);assert.deepEqual(f.controller.originals,[]);assert.equal(f.controller.drafts[0].edit.text,"My unsaved exact words");assert.equal(f.controller.canApply,false);
});
test("403 with unreadable body clears recovered private edits but keeps exact receipt handle",async()=>{
  const f=fixture(),preview=await previewFor(f,[{proposalId:"/suggested_blocks/0",edit:{text:"Private recovered edit"}}]);
  const recovering=f.controller.resume(),resume=await f.take();await f.reply(resume,{status:"not-applied",preview,stale:false,readOnly:true});await recovering;
  const checking=f.controller.resume(),check=await f.take();let parsed=false;await f.reply(check,{},403,async()=>{parsed=true;throw new Error("bad JSON");});await checking;
  assert.equal(parsed,false);assert.deepEqual(f.controller.originals,[]);assert.equal(f.controller.preview,null);assert.equal(f.controller.drafts[0].edit,undefined);assert.deepEqual(f.controller.handle,{previewId:preview.previewId,approvalHash});
});
test("source edits reject apply, retain the draft and require a fresh free preview",async()=>{
  const f=fixture();await saved(f);const applying=f.controller.request("apply"),call=await f.take();await f.reply(call,{status:"not-applied",error:"authoring_preview_stale"},409);await applying;
  assert.equal(f.controller.stale,true);assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,true);assert.equal(f.state.refreshes,0);
  const preparing=f.controller.request("preview"),fresh=await f.take();assert.equal(fresh.body.executionId,"paid-original");assert.equal(fresh.body.bindingHash,bindingHash);assert.deepEqual(fresh.body.selections,[{proposalId:"/suggested_blocks/0"}]);
  const preview=await previewFor(f,fresh.body.selections,"preview-b");await f.reply(fresh,{status:"review",preview});await preparing;assert.equal(f.controller.handle.previewId,"preview-b");assert.equal(f.controller.canApply,true);
});
test("a certified expired lease offers only explicit same-preview retry",async()=>{
  const f=fixture(),preview=await saved(f),applying=f.controller.request("apply"),call=await f.take();await f.reply(call,{status:"applying",previewId:preview.previewId},202);await applying;
  const checking=f.controller.resume(),check=await f.take();await f.reply(check,{status:"applying",preview,stale:false,leaseExpired:true,retryable:true,readOnly:true});await checking;
  assert.equal(f.calls.length,3);assert.equal(f.controller.canPreview,false);assert.equal(f.controller.canApply,true);
  const retrying=f.controller.request("apply"),retry=await f.take();assert.deepEqual(retry.body,call.body);await f.reply(retry,receiptFor(preview));await retrying;assert.equal(f.controller.phase,"applied");
});
test("receipt discovery after private preview expiry is exact, paginated and never autochooses",async()=>{
  const f=fixture({canAuthor:false});f.controller.open("paid-original",["/suggested_blocks/0"]);
  const a=receiptFor(await previewFor(f,[{proposalId:"/suggested_blocks/0"}],"preview-a"),{createdAt:"2026-08-27T12:00:00Z",dismissed:false});
  const b=receiptFor(await previewFor(f,[{proposalId:"/suggested_blocks/0",edit:{text:"A different private selection"}}],"preview-b"),{createdAt:"2026-08-27T12:00:01Z",dismissed:false});
  const discovering=f.controller.discoverReceipts(),request=await f.take();assert.deepEqual(request.body,{action:"resume",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:"paid-original",bindingHash});
  await f.reply(request,{status:"receipts",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:"paid-original",bindingHash,receipts:[a,b],nextCursor:"opaque-next",pageSize:20,readOnly:true,canApply:false,noPayment:true});await discovering;
  assert.equal(f.controller.phase,"receipts");assert.equal(f.controller.handle,null);assert.equal(f.controller.receipt,null);assert.equal(f.controller.canApply,false);assert.equal(f.calls.length,1);
  const rendered=render(f);assert.equal(rendered.buttons.filter(button=>button.label.includes("Read this receipt")).length,2);assert.doesNotMatch(rendered.markup,/A different private selection/);
  const reading=f.controller.chooseReceipt(f.controller.receipts[1]),read=await f.take();assert.equal(read.body.action,"retrieve");assert.equal(read.body.previewId,"preview-b");
  await f.reply(read,b);await reading;assert.equal(f.controller.receipt.previewId,"preview-b");assert.equal(f.controller.canApply,false);
});
test("a returned canonical receipt for a different destination/selection is rejected",async()=>{
  const f=fixture();await saved(f);const other=await previewFor({...f,state:{...f.state,scope:{...f.state.scope,documentId:"doc-b"}}},[{proposalId:"/suggested_blocks/0"}],"preview-other");
  const applying=f.controller.request("apply"),call=await f.take();await f.reply(call,receiptFor(other));await applying;
  assert.equal(f.controller.receipt,null);assert.equal(f.state.refreshes,0);assert.equal(f.controller.uncertain,true);
});
test("editing a saved draft then retrieving cannot approve the old preview under new text",async()=>{
  const f=fixture(),preview=await saved(f);f.controller.update("/suggested_blocks/0","text","Different human draft");
  const checking=f.controller.resume(),check=await f.take();await f.reply(check,{status:"not-applied",preview,stale:false,readOnly:true});await checking;
  assert.equal(f.controller.drafts[0].edit.text,"Different human draft");assert.equal(f.controller.dirty,true);assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,true);
});
test("shared renderer exposes native dialog, source proof, exact events and four-language messages",async()=>{
  const f=fixture();await saved(f);const markup=render(f).markup;
  assert.match(markup,/<dialog class="modal context-intelligence-dialog adaptive-proposal-dialog"/);assert.match(markup,/aria-labelledby=review-title/);assert.match(markup,/context-change-preview/);assert.match(markup,/BlockCreated/);
  assert.match(markup,/Create a new decision/);assert.match(markup,/Original and current source revisions/);assert.match(markup,/not independent approval or delivery/);
  const keys=Object.keys(ADAPTIVE_PROPOSAL_MESSAGES.en);for(const locale of["fr","ar","ja"])assert.deepEqual(Object.keys(ADAPTIVE_PROPOSAL_MESSAGES[locale]),keys);
  assert.match(readFileSync(new URL("../src/components/adaptive-proposal-dialog.css",import.meta.url),"utf8"),/min-block-size:44px/);
});

function custodyStore(){
  let authorization="auth-a",reader=true;const jobs=[],proofs=new Map(),selected=new Map(),session={user:{userId:"actor-a"}},current=projection(null);
  // SIMULATED private-cache/source-owner seed for this reduced accessor host.
  // This is not a Worker quote, generic-feed admission, or native receipt proof.
  // Full Store/Worker/native controls are covered in the separate original-source proof.
  const owners=new WeakSet(),source=Object.freeze({authorization:Object.freeze({key:authorization,shared:false}),generation:1});owners.add(source);
  const details=new(class extends Map{
    set(id,input){
      const {quote,...result}=input.result??{},revision=proofs.get(id)?.detailRevision??0;
      const job={...input,result:{...result,executionId:id,bindingHash:quote?.bindingHash,sourceHash:quote?.sourceHash,
        requestKey:input.requestKey,planningReviewAvailable:true}};
      const identity={jobId:input.jobId,planningExecutionId:input.planningExecutionId,kind:input.kind,documentId:input.documentId,
        canvasId:input.canvasId??null,sourceSurface:input.sourceSurface,requestKey:input.requestKey,
        planningLocale:input.planningLocale,planningProjectScope:input.planningProjectScope};
      return super.set(id,{...job,adaptiveOriginalProof:Object.freeze({source,quote:Object.freeze({...quote}),
        structure:structuredClone(result.structure),identity:Object.freeze(identity),readRevision:revision,certifiedRevision:revision})});
    }
  })();
  void{reader,session};const Probe=eval(stripTypeScriptTypes('(class {session={get:()=>session};projection={get:()=>current};documentJobs={get:()=>jobs};canvasProjection={get:()=>({selectedCanvasId:"board-a"})};#jobDetails=details;#planningRecoveryIdentities=proofs;#adaptiveStructureJobIds=selected;#canReadProjectJobs(){return reader;}#authorizationScope(){return authorization;}sourceOwnershipActive(value){return Boolean(value&&owners.has(value)&&value.authorization.key===authorization&&value.generation===1);}'+member(storeSyntax,"FormaStore","adaptiveProposalSource")+'})'));
  const host=new Probe(),identity={jobId:"paid-original",planningExecutionId:"paid-original",kind:"structure_adaptive",documentId:"doc-a",canvasId:null,sourceSurface:"adaptive",requestKey:"request-a",planningLocale:"en",planningProjectScope:false};
  const quote={executionId:"paid-original",bindingHash,sourceHash:"c".repeat(64),operation:"adaptive-structure",status:"completed",projectId:"project-a",documentId:"doc-a",canvasId:null};
  const job={...identity,status:"completed",result:{quote,structure}};
  selected.set("doc-a","paid-original");proofs.set("paid-original",{authorization,identity,revision:3,detailRevision:3,withdrawalRevision:0});jobs.push({...job,result:{planningReviewAvailable:true}});details.set("paid-original",job);
  return{host,jobs,details,proofs,selected,job,current,setAuthorization:value=>{authorization=value;},setReader:value=>{reader=value;}};
}
test("actual store accessor preserves exact private proof across a refreshed general feed without guessing",()=>{
  const f=custodyStore();let source=f.host.adaptiveProposalSource();assert.equal(source.executionId,"paid-original");assert.equal(source.bindingHash,bindingHash);
  f.jobs.splice(0,f.jobs.length,{...f.job,result:{planningReviewAvailable:true}});source=f.host.adaptiveProposalSource();assert.equal(source.bindingHash,bindingHash);
  f.selected.set("doc-a","another-paid");assert.equal(f.host.adaptiveProposalSource(),null);assert.equal(f.host.adaptiveProposalSource("doc-a",null,"paid-original").executionId,"paid-original");
  assert.equal(f.host.adaptiveProposalSource("doc-b"),null);assert.equal(f.host.adaptiveProposalSource("doc-a","other-board","paid-original"),null);
});
test("actual store accessor fences newer withdrawal, mismatched paid binding and current authority",()=>{
  const f=custodyStore();f.jobs[0]={...f.job,result:{planningReviewAvailable:false}};
  assert.equal(f.host.adaptiveProposalSource().readable,false);assert.equal(f.host.adaptiveProposalSource().structure,null);
  f.jobs[0]={...f.job,result:{planningReviewAvailable:true}};f.proofs.get("paid-original").withdrawalRevision=4;assert.equal(f.host.adaptiveProposalSource().readable,false);
  f.proofs.get("paid-original").detailRevision=5;f.details.set("paid-original",{...f.job,result:{...f.job.result,quote:{...f.job.result.quote,documentId:"doc-other"}}});assert.equal(f.host.adaptiveProposalSource().readable,false);
  f.setAuthorization("new-actor");assert.equal(f.host.adaptiveProposalSource(),null);f.setAuthorization("auth-a");f.setReader(false);assert.equal(f.host.adaptiveProposalSource(),null);
});
test("actual Canvas factory settles native writes and rechecks destination before sending",async()=>{
  const ready=deferred(),state={documentId:"doc-a",canvasId:"board-a",authorization:"auth-a"},calls=[],session={user:{userId:"actor-a"},audience:"creative",capabilities:["project.read","project.author","project.canvas.use"],canvas:{access:true},policy:{accepted:true}};
  const store={captureAuthorizationScope:()=>({key:state.authorization,shared:false}),authorizationScopeActive:scope=>scope.key===state.authorization,session:{get:()=>session},projection:{get:()=>projection("board-a")},canvasProjection:{get:()=>({selectedCanvasId:state.canvasId})},canvasPlanningDocumentId:()=>state.documentId,
    adaptiveProposalSource:()=>null,loadDocumentJobDetail:async()=>{},refreshEvents:async()=>{},guardedFetch:async(...args)=>{calls.push(args);return{};}};
  const controller=createAdaptiveProposalReview(store,()=>({...state}),()=>{},()=>"Review",()=>ready.promise);
  const pending=controller.ports.request({action:"preview",projectId:"project-a",documentId:"doc-a",canvasId:"board-a"});
  state.canvasId="board-b";ready.resolve(true);await assert.rejects(pending,/scope_changed/);assert.equal(calls.length,0);
});
test("actual Document result handler opens only the exact receipt-owned native block",async()=>{
  const f=fixture(),preview=await saved(f);const applying=f.controller.request("apply"),call=await f.take();await f.reply(call,receiptFor(preview));await applying;
  const id=f.controller.receipt.blockIds[0];f.state.projection.libraryBlocks.push(nativeBlock(id));const routes=[],proposed=f.controller,store={projection:{get:()=>f.state.projection},setRoute:route=>routes.push(route),toast:()=>{}};
  void{proposed,store};const Probe=eval(stripTypeScriptTypes('(class {store=store;#proposalReview=proposed;i18n={t:x=>x};#closeProposalReview(){}open(kind,id){this.#openProposalResult(kind,id);}'+member(docSyntax,"FormaAdaptivePath","#openProposalResult")+'})'));
  const host=new Probe();host.open("block","unrelated");assert.deepEqual(routes,[]);host.open("block",id);assert.deepEqual(routes,[documentContextBlockRoute("doc-a","Document",id)]);
  f.state.scope={...f.state.scope,key:"withdrawn"};host.open("block",id);assert.equal(routes.length,1);
});
test("actual paid button bindings preserve immutable IDs in both Document renderers and Canvas",()=>{
  for(const name of["render","legacyRender"]){
    const source=member(docSyntax,"FormaAdaptivePath",name);assert.match(source,/proposalIds:\["\/suggested_blocks\/"\+proposalIndex\]/);
    assert.doesNotMatch(source,/#commit\(suggestion\.type,\s*suggestion\.instruction,\s*suggestion\.subtype\)\}/);
  }
  const dock=member(canvasSyntax,"CanvasApplication","#intentDock");assert.match(dock,/#useSuggestion\(suggestion\.id,\["\/active_decision"\]\)/);
  assert.match(dock,/#useSuggestion\(suggestion\.id,\["\/suggested_blocks\/"\+proposalIndex\]\)/);
  assert.doesNotMatch(member(canvasSyntax,"CanvasApplication","#useSuggestion"),/#createNativeBlock|#commit|appendBatch/);
});

test("changing destinations preserves the original uncertain handle and own draft without a retry queue",async()=>{
  const f=fixture();f.controller.open("paid-original",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","text","Original user draft");
  const preparing=f.controller.request("preview"),first=await f.take(),preview=await previewFor(f,first.body.selections);await f.reply(first,{status:"review",preview});await preparing;
  const applying=f.controller.request("apply"),apply=await f.take();await f.lose(apply);await applying;
  const originalScope=f.state.scope;f.state.scope={...originalScope,key:"authority-b",owner:"owner-b",documentId:"doc-b"};f.controller.synchronize();
  f.controller.open("different-paid",["/active_decision"]);assert.equal(f.controller.executionId,"different-paid");assert.equal(f.controller.handle,null);assert.equal(f.calls.length,2);
  f.state.scope={...originalScope,key:"refreshed-authority-a"};f.controller.open("paid-original",["/suggested_blocks/0"]);
  assert.equal(f.controller.executionId,"paid-original");assert.deepEqual(f.controller.handle,{previewId:preview.previewId,approvalHash});assert.equal(f.controller.drafts[0].edit.text,"Original user draft");assert.equal(f.controller.uncertain,true);
  const checking=f.controller.resume(),read=await f.take();assert.equal(read.body.action,"retrieve");assert.equal(read.body.documentId,"doc-a");assert.equal(read.body.previewId,preview.previewId);
  await f.reply(read,receiptFor(preview));await checking;assert.equal(f.controller.phase,"applied");
});
test("a preview with exact top-level scope but a different event destination cannot be approved",async()=>{
  const f=fixture();f.controller.open("paid-original",["/suggested_blocks/0"]);const preparing=f.controller.request("preview"),call=await f.take(),preview=await previewFor(f,call.body.selections);
  preview.events[0].payload.document_id="wrong-document";await f.reply(call,{status:"review",preview});await preparing;
  assert.equal(f.controller.preview,null);assert.equal(f.controller.canApply,false);assert.equal(f.state.refreshes,0);
});
test("a refreshed receipt page remains an explicit choice and preserves its exact cursor",async()=>{
  const f=fixture();f.controller.open("paid-original",["/active_decision"]);
  const receipt=receiptFor(await previewFor(f,[{proposalId:"/active_decision"}]),{createdAt:"2026-08-27T12:00:00Z",dismissed:true});
  const page={status:"receipts",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:"paid-original",bindingHash,receipts:[receipt],nextCursor:"exact-page-2",pageSize:20,readOnly:true,canApply:false};
  const first=f.controller.discoverReceipts(),request=await f.take();await f.reply(request,page);await first;
  const next=f.controller.discoverReceipts(f.controller.nextCursor),nextRequest=await f.take();assert.equal(nextRequest.body.cursor,"exact-page-2");
  await f.reply(nextRequest,{...page,nextCursor:null,receipts:[]});await next;assert.equal(f.controller.receipt,null);assert.equal(f.controller.handle,null);assert.equal(f.controller.phase,"receipts");
});

test("actual Canvas result handler opens the chosen item or native block without a first-item guess",async()=>{
  const f=fixture({canvasId:"board-a"}),preview=await saved(f,["/suggested_blocks/0","/suggested_blocks/1"]),applying=f.controller.request("apply"),call=await f.take();await f.reply(call,receiptFor(preview));await applying;
  const itemIds=f.controller.receipt.canvasItemIds,blockIds=f.controller.receipt.blockIds,items=itemIds.map((id,index)=>receiptCanvasItem(preview,id,{x:index*600,y:index*300}));
  blockIds.forEach(id=>f.state.projection.libraryBlocks.push(nativeBlock(id,{scope:"canvas",canvasId:"board-a",documentId:""})));
  let activeRoute="/canvas/board-a/board";const routes=[],focus=[],proposed=f.controller,CSS={escape:value=>value},store={projection:{get:()=>f.state.projection},canvasProjection:{get:()=>({selectedCanvasId:"board-a",items})},route:{get:()=>activeRoute},toast:()=>{}};
  const native=canvasResultPorts(f,store,preview);
  void{proposed,CSS,store,native,captureOutputNavigationFocus};const Probe=eval(stripTypeScriptTypes('(class {isConnected=true;ownerDocument=native.document;store=store;#proposalReview=proposed;#selected=new Set();#cameraX=0;#cameraY=0;i18n={t:x=>x};updateComplete=Promise.resolve();#closeProposalReview(){proposed.close();}#go(route){activeRoute=route;routes.push(route);}requestUpdate(){}querySelector(selector){if(selector==="dialog[open]")return null;return native.target(()=>focus.push(selector));}open(kind,id){this.#openProposalResult(kind,id);}get selected(){return [...this.#selected];}'+canvasResultDependencies()+member(canvasSyntax,"CanvasApplication","#openProposalResult")+'})'));
  const host=new Probe();host.open("canvas-item","not-in-receipt");assert.deepEqual(routes,[]);host.open("canvas-item",itemIds[1]);await turn();
  assert.deepEqual(host.selected,[itemIds[1]]);assert.equal(routes[0],withCanvasView("/canvas/board-a/board","spatial"));assert.ok(focus[0].includes(itemIds[1]));
  host.open("block",blockIds[1]);assert.equal(routes[1],libraryFocusRoute("block",blockIds[1],blockIds[1],"/canvas/library"));
});
test("actual rendered Preview and Apply controls execute only their respective exact contracts",async()=>{
  const f=fixture();await entry(f,"document").host.commit("subject","ignored","Hero subject",{executionId:"paid-original",proposalIds:["/suggested_blocks/0"]});
  const before=render(f),previewButton=before.buttons.find(button=>button.label==="Preview exact changes · free");assert.ok(previewButton);
  const pending=previewButton.click(),call=await f.take();assert.equal(call.body.action,"preview");assert.equal(f.state.refreshes,0);
  const preview=await previewFor(f,call.body.selections);await f.reply(call,{status:"review",preview});await pending;
  const approved=render(f),applyButton=approved.buttons.find(button=>button.label==="Apply these exact changes");assert.ok(applyButton&&!applyButton.disabled);
  const saving=applyButton.click(),apply=await f.take();assert.equal(apply.body.action,"apply");assert.equal(apply.body.previewId,preview.previewId);assert.equal(apply.body.selections,undefined);
  await f.reply(apply,receiptFor(preview));await saving;assert.equal(f.controller.phase,"applied");
});
test("manual authored answers still use the existing non-paid handler",async()=>{
  const f=fixture(),e=entry(f,"document"),events=[];f.state.projection.blocks=f.state.projection.libraryBlocks;e.store.outputBlockTextEvents=(id,text)=>[{type:"BlockPropertyEdited",payload:{block_id:id,new_value:text}}];
  e.store.appendBatch=async batch=>{events.push(...batch);return batch;};e.store.toast=()=>{};
  await e.host.commit("subject"," My manual answer ","Hero subject");
  assert.equal(f.controller.visible,false);assert.equal(f.calls.length,0);assert.ok(events.some(event=>event.payload.new_value==="My manual answer"));
});

test("late close from an old proposal dialog cannot dismiss a reopened review",async()=>{
  const f=fixture();await saved(f);const old=render(f),id=f.controller.presentationId;
  f.controller.close();f.controller.reopen();assert.ok(f.controller.presentationId>id);
  old.dialogNode.open=false;old.nativeClose({type:"close",currentTarget:old.dialogNode});assert.equal(f.controller.visible,true);
  const current=render(f);current.nativeClose({type:"close",currentTarget:current.dialogNode});assert.equal(f.controller.visible,true);
  current.dialogNode.open=false;current.nativeClose({type:"close",currentTarget:current.dialogNode});assert.equal(f.controller.visible,false);
});

test("invalid human draft cannot send a preview or become an uncertain application",async()=>{
  const f=fixture();f.controller.open("paid-original",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","text","  ");
  await f.controller.request("preview");assert.equal(f.calls.length,0);assert.equal(f.controller.uncertain,false);assert.equal(f.controller.notice,"adaptive.changes.invalid");
});
test("client selection identity matches the actual server canonical-consent implementation",async()=>{
  const tree=syntax("worker/consequential-consent.ts"),functionCode=name=>tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(tree).replace(/^export /,"");
  const canonicalConsent=eval(stripTypeScriptTypes("("+functionCode("canonicalConsent")+")")),consentHash=eval(stripTypeScriptTypes("("+functionCode("consentHash")+")"));
  const current=scope("board-a"),selections=[{proposalId:"/suggested_blocks/0",edit:{label:"原文",text:"  كامل \n"},placement:{x:-34.5,y:22,w:300,h:210}}];
  const payload={version:"human-adaptive-proposal-v1",actor:current.actorUserId,projectId:current.projectId,documentId:current.documentId,canvasId:current.canvasId,executionId:"paid-original",bindingHash,selections};
  assert.equal(canonicalAdaptiveSelection(payload),canonicalConsent(payload));assert.equal(await adaptiveSelectionKey(current,"paid-original",bindingHash,selections),await consentHash(payload));
});

for(const change of["none","reopened","scope","disconnected"])test("actual shared close focus remains owned after "+change,async()=>{
  const f=fixture();f.controller.open("paid-original",["/active_decision"]);const done=deferred(),focused=[],attrs=new Map(),native=nativeFocusPorts(),opener={...native.target(()=>focused.push("opener")),getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key)};
  const host={isConnected:true,ownerDocument:native.document,updateComplete:done.promise,querySelector:selector=>selector===".adaptive-proposal-dialog"?{close(){}}:null};
  const code=dialogSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="closeAdaptiveProposalDialog").getText(dialogSyntax).replace(/^export /,""),closeAdaptiveProposalDialog=eval(stripTypeScriptTypes("("+code+")"));
  closeAdaptiveProposalDialog(host,f.controller,opener,()=>null);
  if(change==="reopened")f.controller.reopen();if(change==="scope")f.state.scope={...f.state.scope,key:"new-authority"};if(change==="disconnected")host.isConnected=false;
  done.resolve();await turn();assert.equal(focused.length,change==="none"?1:0);assert.equal(attrs.has("tabindex"),false);
});

test("fresh host with all private sources absent can explicitly discover and select destination receipts without a paid binding",async()=>{
  const f=fixture({readable:false,canAuthor:false}),recovering=f.controller.resume(),resume=await f.take();await f.reply(resume,{status:"none",noPayment:true});await recovering;
  assert.equal(f.controller.executionId,"");assert.equal(f.controller.bindingHash,"");
  const control=render(f).buttons.find(button=>button.label==="Find saved receipts in this destination");assert.ok(control&&!control.disabled);
  const discovering=control.click(),request=await f.take();assert.deepEqual(request.body,{action:"receipts",projectId:"project-a",documentId:"doc-a",canvasId:null});
  const first=receiptFor(await previewFor(f,[{proposalId:"/active_decision"}],"receipt-first"),{createdAt:"2026-08-27T12:00:00Z",dismissed:false});
  const second={...first,previewId:"receipt-second",executionId:"different-paid-plan",bindingHash:"e".repeat(64),selectionKey:"f".repeat(64),blockIds:["different-native-id"]};
  await f.reply(request,{status:"receipts",discovery:"destination",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:null,bindingHash:null,receipts:[first,second],nextCursor:"destination-next",pageSize:20,readOnly:true,canApply:false,noPayment:true});await discovering;
  assert.equal(f.controller.handle,null);assert.equal(f.controller.canApply,false);assert.equal(f.controller.receiptDiscovery,"destination");assert.equal(f.calls.length,2);
  const nextButton=render(f).buttons.find(button=>button.label==="Next receipts"),paging=nextButton.click(),next=await f.take();
  assert.deepEqual(next.body,{action:"receipts",projectId:"project-a",documentId:"doc-a",canvasId:null,cursor:"destination-next"});
  await f.reply(next,{status:"receipts",discovery:"destination",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:null,bindingHash:null,receipts:[second],nextCursor:null,pageSize:20,readOnly:true,canApply:false});await paging;
  const selecting=f.controller.chooseReceipt(f.controller.receipts[0]),chosen=await f.take();assert.deepEqual(chosen.body,{action:"retrieve",projectId:"project-a",documentId:"doc-a",canvasId:null,previewId:"receipt-second",approvalHash});
  await f.reply(chosen,second);await selecting;assert.equal(f.controller.phase,"applied");assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,false);assert.deepEqual(f.controller.receipt.blockIds,["different-native-id"]);
});
test("destination receipt metadata never opens an editable private preview",async()=>{
  const f=fixture({readable:false}),recovering=f.controller.resume(),resume=await f.take();await f.reply(resume,{status:"none"});await recovering;
  const preview=await previewFor(f,[{proposalId:"/active_decision"}]),receipt=receiptFor(preview,{createdAt:"2026-08-27T12:00:00Z",dismissed:false});
  const discovering=f.controller.discoverDestinationReceipts(),request=await f.take();await f.reply(request,{status:"receipts",discovery:"destination",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:null,bindingHash:null,receipts:[receipt],nextCursor:null,pageSize:20,readOnly:true,canApply:false});await discovering;
  const selecting=f.controller.chooseReceipt(f.controller.receipts[0]),read=await f.take();await f.reply(read,{status:"not-applied",preview,stale:false});await selecting;
  assert.equal(f.controller.preview,null);assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,false);assert.equal(f.controller.canDismiss,false);
});
test("certified expired stale lease permits only exact explicit dismissal before a fresh review",async()=>{
  const f=fixture(),preview=await saved(f),applying=f.controller.request("apply"),call=await f.take();await f.reply(call,{status:"applying",previewId:preview.previewId},202);await applying;
  const checking=f.controller.resume(),check=await f.take();await f.reply(check,{status:"applying",preview,stale:true,leaseExpired:true,retryable:false,readOnly:true});await checking;
  assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,false);assert.equal(f.controller.canDismiss,true);assert.equal(f.calls.length,3);
  const dismissing=f.controller.request("dismiss"),dismiss=await f.take();assert.deepEqual(dismiss.body,{action:"dismiss",projectId:"project-a",documentId:"doc-a",canvasId:null,previewId:preview.previewId,approvalHash});
  await f.reply(dismiss,{status:"dismissed"});await dismissing;assert.equal(f.controller.handle,null);assert.equal(f.controller.uncertain,false);assert.equal(f.controller.canPreview,true);
});
test("a raced completion during explicit dismissal remains applied, never falsely discarded",async()=>{
  const f=fixture(),preview=await saved(f),dismissing=f.controller.request("dismiss"),dismiss=await f.take();await f.reply(dismiss,receiptFor(preview));await dismissing;
  assert.equal(f.controller.phase,"applied");assert.equal(f.controller.visible,true);assert.ok(f.controller.receipt);assert.equal(f.controller.canApply,false);assert.equal(f.controller.canDismiss,false);
});


test("actual store exposes surviving exact job metadata only for receipt identity after private erasure",()=>{
  const f=custodyStore();f.jobs[0]={...f.job,result:{bindingHash,planningReviewAvailable:false,resultUnavailable:true}};f.details.clear();f.proofs.get("paid-original").withdrawalRevision=4;
  assert.deepEqual(f.host.adaptiveProposalSource(),{executionId:"paid-original",bindingHash,structure:null,readable:false,withdrawalRevision:4});
  f.jobs[0]={...f.jobs[0],result:{bindingHash:"not-a-hash",planningReviewAvailable:false}};assert.equal(f.host.adaptiveProposalSource().bindingHash,null);
  f.jobs[0]={...f.job,result:{bindingHash:"e".repeat(64),planningReviewAvailable:true}};f.details.set("paid-original",f.job);f.proofs.get("paid-original").detailRevision=5;
  assert.equal(f.host.adaptiveProposalSource().readable,false);assert.equal(f.host.adaptiveProposalSource().structure,null);assert.equal(f.host.adaptiveProposalSource().bindingHash,"e".repeat(64));
  f.setAuthorization("other-actor");assert.equal(f.host.adaptiveProposalSource(),null);f.setAuthorization("auth-a");f.setReader(false);assert.equal(f.host.adaptiveProposalSource(),null);
});
test("actual metadata accessor rejects mismatched source identity and never falls back to a cached different job",()=>{
  for(const field of["planningExecutionId","documentId","canvasId","sourceSurface","requestKey","planningLocale","planningProjectScope"]){
    const f=custodyStore();f.jobs[0]={...f.job,result:{bindingHash,planningReviewAvailable:false},[field]:field==="planningProjectScope"?true:"other-value"};
    assert.equal(f.host.adaptiveProposalSource(),null,field);
  }
  const f=custodyStore();f.jobs[0]={...f.job,result:{bindingHash,planningReviewAvailable:true}};f.details.set("paid-original",{...f.job,jobId:"different-paid"});
  assert.equal(f.host.adaptiveProposalSource().readable,false);assert.equal(f.host.adaptiveProposalSource().bindingHash,bindingHash);
  f.jobs.length=0;assert.equal(f.host.adaptiveProposalSource().bindingHash,null);assert.equal(f.host.adaptiveProposalSource().readable,false);
});
test("metadata-only selected plan reuses exact pair receipt lookup without restoring private edits or preview authority",async()=>{
  const f=fixture({readable:false});f.state.source.bindingHash=bindingHash;f.controller.open("paid-original",["/active_decision"]);
  assert.equal(f.controller.bindingHash,bindingHash);assert.equal(f.controller.notice,"adaptive.changes.metadataOnly");assert.equal(f.controller.canPreview,false);assert.equal(f.controller.canApply,false);
  assert.ok(render(f).buttons.some(button=>button.label==="Find receipts for this paid proposal"));
  const recovery=f.controller.resume(),read=await f.take();assert.deepEqual(read.body,{action:"resume",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:"paid-original",bindingHash});
  const receipt=receiptFor(await previewFor(f,[{proposalId:"/active_decision"}]),{createdAt:"2026-08-27T12:00:00Z",dismissed:false});
  await f.reply(read,{status:"receipts",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:"paid-original",bindingHash,receipts:[receipt],nextCursor:null,pageSize:20,readOnly:true,canApply:false});await recovery;
  assert.equal(f.controller.handle,null);assert.equal(f.controller.canPreview,false);assert.equal(f.controller.originals.length,0);assert.deepEqual(f.state.reads,[]);
  const selected=f.controller.chooseReceipt(f.controller.receipts[0]),chosen=await f.take();assert.equal(chosen.body.action,"retrieve");await f.reply(chosen,receipt);await selected;
  assert.equal(f.controller.phase,"applied");assert.equal(f.controller.canApply,false);assert.equal(f.calls.length,2);
});
test("fresh metadata-only host uses the selected exact job, never a latest private plan guess",async()=>{
  const f=fixture({readable:false});f.state.source.bindingHash=bindingHash;
  const recovery=f.controller.resume(),read=await f.take();assert.deepEqual(read.body,{action:"resume",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:"paid-original",bindingHash});
  await f.reply(read,{status:"receipts",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:"paid-original",bindingHash,receipts:[],nextCursor:null,pageSize:20,readOnly:true,canApply:false});await recovery;
  assert.equal(f.controller.canPreview,false);assert.equal(f.controller.originals.length,0);assert.equal(f.controller.receipt,null);assert.deepEqual(f.state.reads,[]);
});
for(const changed of["withdrawal","binding"])test("metadata receipt body is fenced by current "+changed+" evidence",async()=>{
  const f=fixture({readable:false});f.state.source.bindingHash=bindingHash;f.controller.open("paid-original",["/active_decision"]);
  const recovering=f.controller.discoverReceipts(),read=await f.take(),body=deferred();
  await f.reply(read,{},200,()=>body.promise);
  if(changed==="withdrawal")f.state.source.withdrawalRevision=2;else f.state.source.bindingHash="e".repeat(64);
  body.resolve({status:"receipts",projectId:"project-a",documentId:"doc-a",canvasId:null,executionId:"paid-original",bindingHash,receipts:[],nextCursor:null,pageSize:20,readOnly:true,canApply:false});await recovering;
  assert.equal(f.controller.phase,"unavailable");assert.deepEqual(f.controller.receipts,[]);assert.equal(f.controller.canApply,false);
});
test("lost explicit dismissal retains the same handle until a read-only dismissed outcome is verified",async()=>{
  const f=fixture();f.controller.open("paid-original",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","text","Keep this user draft");
  const preparing=f.controller.request("preview"),prepare=await f.take(),preview=await previewFor(f,prepare.body.selections);await f.reply(prepare,{status:"review",preview});await preparing;
  const dismissing=f.controller.request("dismiss"),dismiss=await f.take();await f.lose(dismiss);await dismissing;
  assert.equal(f.controller.uncertain,true);assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,false);assert.deepEqual(f.controller.handle,{previewId:preview.previewId,approvalHash});
  f.controller.close();f.controller.reopen();const checking=f.controller.resume(),check=await f.take();assert.deepEqual(check.body,{action:"retrieve",projectId:"project-a",documentId:"doc-a",canvasId:null,previewId:preview.previewId,approvalHash});
  await f.reply(check,{status:"not-applied",preview,stale:false,readOnly:true,dismissed:true});await checking;
  assert.equal(f.controller.handle,null);assert.equal(f.controller.preview,null);assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,true);assert.equal(f.controller.notice,"adaptive.changes.dismissed");assert.equal(f.controller.drafts[0].edit.text,"Keep this user draft");
});

test("fresh legacy resume cannot auto-select an arbitrary latest applied receipt",async()=>{
  const f=fixture(),preview=await previewFor(f,[{proposalId:"/active_decision"}]),recovering=f.controller.resume(),read=await f.take();
  assert.equal(read.body.action,"resume");assert.equal(read.body.executionId,undefined);await f.reply(read,receiptFor(preview));await recovering;
  assert.equal(f.controller.receipt,null);assert.equal(f.controller.handle,null);assert.equal(f.controller.canApply,false);assert.equal(f.state.refreshes,0);
  assert.equal(f.controller.notice,"adaptive.changes.receiptDiscoveryRequired");assert.ok(render(f).buttons.some(button=>button.label==="Find saved receipts in this destination"));
});
test("a receipt-discovery response can never silently become a single applied selection",async()=>{
  const f=fixture({readable:false}),recovering=f.controller.resume(),read=await f.take();await f.reply(read,{status:"none"});await recovering;
  const finding=f.controller.discoverDestinationReceipts(),find=await f.take();await f.reply(find,receiptFor(await previewFor(f,[{proposalId:"/active_decision"}])));await finding;
  assert.equal(f.controller.receipt,null);assert.equal(f.controller.handle,null);assert.equal(f.controller.canApply,false);assert.equal(f.state.refreshes,0);
});

test("Canvas review preserves create placement while editing an explicit native target",async()=>{
  const f=fixture({canvasId:"board-a"});f.controller.open("paid-original",["/suggested_blocks/0"],{x:-120,y:340,w:300,h:210});f.controller.update("/suggested_blocks/0","targetBlockId","second-subject");
  const preparing=f.controller.request("preview"),read=await f.take(),preview=await previewFor(f,read.body.selections);await f.reply(read,{status:"review",preview});await preparing;
  assert.equal(f.controller.selections()[0].placement,undefined);f.controller.update("/suggested_blocks/0","targetBlockId","");
  assert.deepEqual(f.controller.selections()[0].placement,{x:-120,y:340,w:300,h:210});assert.equal(f.controller.canApply,false);assert.ok(render(f).markup.includes("Review placement on this board"));
});
test("a recovered Canvas edit offers visible editable placement only after explicitly choosing Create",async()=>{
  const f=fixture({canvasId:"board-a"}),preview=await previewFor(f,[{proposalId:"/suggested_blocks/0",targetBlockId:"second-subject"}]),resuming=f.controller.resume(),read=await f.take();
  await f.reply(read,{status:"not-applied",preview,stale:false,readOnly:true});await resuming;assert.equal(f.controller.selections()[0].placement,undefined);
  f.controller.update("/suggested_blocks/0","targetBlockId","");assert.deepEqual(f.controller.selections()[0].placement,{x:0,y:0,w:300,h:210});assert.equal(f.controller.canApply,false);assert.equal(f.controller.canPreview,true);
  assert.ok(render(f).markup.includes("Review placement on this board"));assert.equal(f.calls.length,1);
});

test("human target and placement drafts survive a board change even without edited text or a saved preview",()=>{
  const f=fixture({canvasId:"board-a"});f.controller.open("paid-original",["/suggested_blocks/0","/suggested_blocks/1"],{x:10,y:20,w:300,h:210});
  f.controller.update("/suggested_blocks/0","targetBlockId","second-subject");f.controller.update("/suggested_blocks/1","x","88");
  const originalScope=f.state.scope;f.state.scope={...originalScope,owner:"owner-b",key:"authority-b",canvasId:"board-b"};f.controller.open("other-paid",["/active_decision"],{x:0,y:0,w:300,h:210});
  f.state.scope={...originalScope,key:"authority-a-refreshed"};f.controller.open("paid-original",["/suggested_blocks/0","/suggested_blocks/1"],{x:200,y:300,w:300,h:210});
  assert.equal(f.controller.selections()[0].targetBlockId,"second-subject");assert.equal(f.controller.selections()[1].placement.x,88);assert.equal(f.controller.dirty,true);assert.equal(f.controller.canPreview,true);assert.equal(f.calls.length,0);
});

for(const ending of["resolve","reject"])test("PREFLIGHT paid late A refresh "+ending+" cannot alter new B",async()=>{
 const f=fixture(),preview=await saved(f),refresh=deferred();f.ports.refresh=()=>refresh.promise;
 const applying=f.controller.request("apply"),call=await f.take();await f.reply(call,receiptFor(preview));assert.equal(f.controller.phase,"applied");assert.equal(f.controller.busy,true);
 f.state.scope={...f.state.scope,key:"authority-b",owner:"owner-b",documentId:"doc-b"};f.state.source={...f.state.source,executionId:"paid-b",bindingHash:"e".repeat(64)};
 f.controller.open("paid-b",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","text","B OWN DRAFT");
 const before=JSON.stringify({phase:f.controller.phase,notice:f.controller.notice,visible:f.controller.visible,busy:f.controller.busy,executionId:f.controller.executionId,drafts:f.controller.drafts,handle:f.controller.handle});
 if(ending==="resolve")refresh.resolve();else refresh.reject(new Error("A refresh failed"));await applying;
 assert.equal(JSON.stringify({phase:f.controller.phase,notice:f.controller.notice,visible:f.controller.visible,busy:f.controller.busy,executionId:f.controller.executionId,drafts:f.controller.drafts,handle:f.controller.handle}),before);assert.equal(f.calls.length,2);
});
for(const step of["headers","json"])test("PREFLIGHT paid late A dismissal after "+step+" cannot close B",async()=>{
 const f=fixture();await saved(f);const dismissing=f.controller.request("dismiss"),call=await f.take(),body=deferred();
 if(step==="json")await f.reply(call,{},200,()=>body.promise);
 f.state.scope={...f.state.scope,key:"authority-b",owner:"owner-b",documentId:"doc-b"};f.state.source={...f.state.source,executionId:"paid-b",bindingHash:"e".repeat(64)};
 f.controller.open("paid-b",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","text","B OWN DRAFT");
 if(step==="json")body.resolve({status:"dismissed"});else await f.reply(call,{status:"dismissed"});await dismissing;
 assert.equal(f.controller.visible,true);assert.equal(f.controller.executionId,"paid-b");assert.equal(f.controller.drafts[0].edit.text,"B OWN DRAFT");assert.equal(f.controller.handle,null);
});
test("PREFLIGHT paid lost Apply plus exact not-applied review allows only explicit same-handle Apply",async()=>{
 const f=fixture(),preview=await saved(f),applying=f.controller.request("apply"),call=await f.take();await f.lose(call);await applying;
 const checking=f.controller.resume(),read=await f.take();await f.reply(read,{status:"not-applied",preview,stale:false,readOnly:true});await checking;
 assert.equal(f.controller.canApply,true);assert.equal(f.controller.uncertain,false);assert.equal(f.calls.length,3);
 const retry=f.controller.request("apply"),write=await f.take();assert.deepEqual(write.body,{action:"apply",projectId:"project-a",documentId:"doc-a",canvasId:null,previewId:preview.previewId,approvalHash});
 await f.reply(write,receiptFor(preview));await retry;assert.equal(f.controller.phase,"applied");assert.equal(f.calls.filter(item=>item.body.action==="preview").length,1);
});
function renderPreflightWithNode(f,dialogNode){
 const handlers=[],nothing=Symbol("nothing"),item=value=>Array.isArray(value)?value.map(item).join(""):typeof value==="function"?"__handler_"+(handlers.push(value)-1)+"__":value===nothing?"":String(value??"");
 const html=(parts,...values)=>parts.reduce((value,part,index)=>value+part+(index<values.length?item(values[index]):""),"");
 const i18n={t:key=>ADAPTIVE_PROPOSAL_MESSAGES.en[key]??key,number:String,system:value=>value};
 const functionCode=(tree,name)=>tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(tree).replace(/^export /,"");
 const renderAuthoringPreview=eval(stripTypeScriptTypes("("+functionCode(rendererSyntax,"renderAuthoringPreview")+")"));
 void{html,renderAuthoringPreview};const renderAdaptiveProposalDialog=eval(stripTypeScriptTypes("("+functionCode(dialogSyntax,"renderAdaptiveProposalDialog")+")"));
 const markup=String(renderAdaptiveProposalDialog(f.controller,i18n,{id:"preflight-title",dialog:()=>dialogNode,close:()=>f.controller.close(),open(){}}));
 return handlers[Number(markup.match(/@close=__handler_(\d+)__/)?.[1])];
}
for(const listener of["captured-A","current-B"])test("PREFLIGHT paid native queued close A through "+listener+" cannot close reopened B",()=>{
 const f=fixture(),node={open:true};f.controller.open("paid-original",["/active_decision"]);const a=renderPreflightWithNode(f,node);
 f.controller.close();node.open=false;f.state.source={...f.state.source,executionId:"paid-b"};f.controller.open("paid-b",["/suggested_blocks/0"]);node.open=true;const b=renderPreflightWithNode(f,node);
 (listener==="captured-A"?a:b)({type:"close",currentTarget:node});assert.equal(f.controller.visible,true);assert.equal(f.controller.executionId,"paid-b");
});
for(const change of["none","authority","new-review","disconnect"])test("PREFLIGHT paid Canvas deferred result focus is canceled after "+change,async()=>{
 const f=fixture({canvasId:"board-a"}),preview=await saved(f),applying=f.controller.request("apply"),call=await f.take();await f.reply(call,receiptFor(preview));await applying;
 const itemId=f.controller.receipt.canvasItemIds[0],items=[receiptCanvasItem(preview,itemId,{x:10,y:20})],done=deferred(),focus=[],routes=[],proposed=f.controller,CSS={escape:value=>value};let activeRoute="/canvas/board-a/board";
 const store={projection:{get:()=>f.state.projection},canvasProjection:{get:()=>({selectedCanvasId:"board-a",items})},route:{get:()=>activeRoute},toast(){}};
  const native=canvasResultPorts(f,store,preview);
 void{proposed,CSS,store,routes,native,captureOutputNavigationFocus};const Probe=eval(stripTypeScriptTypes('(class {isConnected=true;ownerDocument=native.document;store=store;#proposalReview=proposed;#selected=new Set();#cameraX=0;#cameraY=0;i18n={t:x=>x};updateComplete=done.promise;#closeProposalReview(){proposed.close();}#go(route){activeRoute=route;routes.push(route);}requestUpdate(){}querySelector(selector){if(selector==="dialog[open]")return null;return native.target(()=>focus.push({selector,key:f.state.scope.key,presentation:proposed.presentationId,visible:proposed.visible}));}open(kind,id){this.#openProposalResult(kind,id);}'+canvasResultDependencies()+member(canvasSyntax,"CanvasApplication","#openProposalResult")+'})'));
 const host=new Probe();host.open("canvas-item",itemId);assert.equal(focus.length,0);
 if(change==="authority"){f.state.scope={...f.state.scope,key:"withdrawn"};f.controller.synchronize();}
 if(change==="new-review"){f.state.source={...f.state.source,executionId:"paid-b"};f.controller.open("paid-b",["/active_decision"]);}
 if(change==="disconnect")host.isConnected=false;
 done.resolve();await turn();if(change==="none"){assert.equal(focus.length,1);assert.ok(focus[0].selector.includes(itemId));}else assert.deepEqual(focus,[],"The actual queued continuation must not focus under a later owner/presentation/lifecycle");
});

for(const change of["none","route"])test("PREFLIGHT complete paid Canvas result handoff "+change+" preserves deferred focus ownership",async()=>{
 const f=fixture({canvasId:"board-a"}),preview=await saved(f),applying=f.controller.request("apply"),call=await f.take();await f.reply(call,receiptFor(preview));await applying;
 const itemId=f.controller.receipt.canvasItemIds[0],items=[receiptCanvasItem(preview,itemId,{x:10,y:20})],done=deferred(),focus=[],proposed=f.controller,CSS={escape:value=>value};let route="/canvas/board-a/board";
 const attrs=new Map(),opener={isConnected:true,getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key),focus:()=>focus.push("opener")};
 const dialog={open:true,close(){this.open=false;}},store={projection:{get:()=>f.state.projection},canvasProjection:{get:()=>({selectedCanvasId:"board-a",items})},route:{get:()=>route},toast(){}};
  const native=canvasResultPorts(f,store,preview);
 const functionCode=dialogSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="closeAdaptiveProposalDialog").getText(dialogSyntax).replace(/^export /,"");
 const closeAdaptiveProposalDialog=eval(stripTypeScriptTypes("("+functionCode+")"));
 void{proposed,CSS,opener,dialog,store,closeAdaptiveProposalDialog,native,captureOutputNavigationFocus};const Probe=eval(stripTypeScriptTypes('(class {isConnected=true;ownerDocument=native.document;store=store;#proposalReview=proposed;#proposalOpener=opener;#selected=new Set();#cameraX=0;#cameraY=0;i18n={t:x=>x};updateComplete=done.promise;#go(next){route=next;}requestUpdate(){}querySelector(selector){if(selector===".adaptive-proposal-dialog")return dialog;if(selector==="dialog[open]")return dialog.open?dialog:null;return native.target(()=>focus.push("item"));}open(kind,id){this.#openProposalResult(kind,id);}'+canvasResultDependencies()+member(canvasSyntax,"CanvasApplication","#closeProposalReview")+member(canvasSyntax,"CanvasApplication","#openProposalResult")+'})'));
 const host=new Probe();host.open("canvas-item",itemId);if(change==="route")route="/canvas/library";done.resolve();await turn();
 if(change==="none")assert.equal(focus.at(-1),"item");else assert.deepEqual(focus,[],"Neither old result focus nor its shared-close opener callback owns the changed route");
});

for(const change of["none","route","authority","receipt","new-presentation","disconnect","other-dialog"])test("PREFLIGHT composed Canvas normal close after "+change+" keeps exact focus ownership",async()=>{
 const f=fixture({canvasId:"board-a"}),preview=await saved(f),applying=f.controller.request("apply"),call=await f.take();await f.reply(call,receiptFor(preview));await applying;
 const done=deferred(),focus=[],attrs=new Map(),proposed=f.controller,native=nativeFocusPorts();let route="/canvas/board-a/board",otherDialog=false;
 const opener={...native.target(()=>focus.push("opener")),getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key)};
 const dialog={close(){}},store={route:{get:()=>route}};
 const functionCode=dialogSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="closeAdaptiveProposalDialog").getText(dialogSyntax).replace(/^export /,"");
 const closeAdaptiveProposalDialog=eval(stripTypeScriptTypes("("+functionCode+")"));
 void{proposed,opener,dialog,store,closeAdaptiveProposalDialog,otherDialog,native};const Probe=eval(stripTypeScriptTypes('(class {isConnected=true;ownerDocument=native.document;store=store;#proposalReview=proposed;#proposalOpener=opener;updateComplete=done.promise;querySelector(selector){if(selector===".adaptive-proposal-dialog")return dialog;if(selector==="dialog[open]")return otherDialog?{}:null;return null;}close(){this.#closeProposalReview();}'+canvasResultDependencies()+member(canvasSyntax,"CanvasApplication","#closeProposalReview")+'})'));
 const host=new Probe();host.close();
 if(change==="route")route="/canvas/library";if(change==="authority")f.state.scope={...f.state.scope,key:"withdrawn"};
 if(change==="receipt"){const old=f.controller.receipt,checking=f.controller.request("retrieve"),read=await f.take();await f.reply(read,receiptFor(preview));await checking;assert.notEqual(f.controller.receipt,old);}
 if(change==="new-presentation")f.controller.reopen();if(change==="disconnect")host.isConnected=false;if(change==="other-dialog")otherDialog=true;
 done.resolve();await turn();assert.deepEqual(focus,change==="none"?["opener"]:[]);assert.equal(attrs.has("tabindex"),false);
});

for(const ending of["resolve","reject"])test("PREFLIGHT paid late A refresh "+ending+" preserves B's in-flight operation lock",async()=>{
 const f=fixture(),preview=await saved(f),refresh=deferred();f.ports.refresh=()=>refresh.promise;
 const applying=f.controller.request("apply"),apply=await f.take();await f.reply(apply,receiptFor(preview));
 f.state.scope={...f.state.scope,key:"authority-b",owner:"owner-b",documentId:"doc-b"};f.state.source={...f.state.source,executionId:"paid-b",bindingHash:"e".repeat(64)};
 f.controller.open("paid-b",["/suggested_blocks/0"]);const preparingB=f.controller.request("preview"),readB=await f.take();assert.equal(f.controller.busy,true);
 if(ending==="resolve")refresh.resolve();else refresh.reject(Error("old A refresh failed"));await applying;
 assert.equal(f.controller.busy,true);assert.equal(f.controller.executionId,"paid-b");assert.equal(f.controller.canEdit,false);assert.equal(f.calls.length,3);
 await f.lose(readB);await preparingB;assert.equal(f.controller.executionId,"paid-b");
});

// Existing actual controller and production dialog/preview renderer, with the
// existing finite transport/model/receipt ports. The typed409 below is a
// simulated contract envelope, NOT proof that the real Worker can certify it.
// No complete DOM, physical input, AT, canonical commit or provider claim.
for(const locale of["en","fr","ar","ja"])test("localized no-change dialog permits deliberate correction and separate Apply "+locale,async()=>{
  const f=fixture(),controller=f.controller,copy=ADAPTIVE_PROPOSAL_MESSAGES[locale],proposalId="/suggested_blocks/0";
  assert.ok(Object.hasOwn(copy,"adaptive.changes.noChanges"),"current real locale contains the dedicated guidance");
  if(locale!=="en")assert.notEqual(copy["adaptive.changes.noChanges"],ADAPTIVE_PROPOSAL_MESSAGES.en["adaptive.changes.noChanges"]);
  controller.open("paid-original",[proposalId]);
  const target=controller.targets(proposalId).find(block=>block.id==="second-subject");assert.ok(target);
  controller.update(proposalId,"targetBlockId",target.id);
  for(const key of["label","text","subtype"])controller.update(proposalId,key,target.properties[key]);
  const selections=structuredClone(controller.selections()),sourceBefore=JSON.stringify(f.state.projection);
  const button=(rendered,key)=>{const matches=rendered.buttons.filter(item=>item.label===copy[key]);assert.equal(matches.length,1,key);assert.equal(matches[0].disabled,false,key);return matches[0];};
  const input=rendered=>{const attrs=rendered.markup.match(/<textarea\b([^>]*)>/u)?.[1];assert.ok(attrs,"one current production draft textarea");assert.match(attrs,/\?disabled=false(?:\s|$)/u);const index=attrs.match(/@input=__handler_(\d+)__/u)?.[1];assert.ok(index);assert.equal(typeof rendered.handlers[Number(index)],"function");return{attrs,change:rendered.handlers[Number(index)]};};
  const preparing=button(render(f,locale),"adaptive.changes.preview").click(),call=await f.take();
  assert.deepEqual(call.body.selections,selections);assert.equal(call.body.action,"preview");
  assert.match(render(f,locale).markup,/<textarea\b[^>]*\?disabled=true\b/u,"pending preparation remains read-only");
  const selectionKey=await adaptiveSelectionKey(f.state.scope,"paid-original",bindingHash,selections);
  await f.reply(call,{error:"adaptive_changes_no_changes",status:"preview-not-created",selectionKey,noPayment:true,noAutomaticRetry:true},409);await preparing;
  assert.equal(controller.phase,"draft");assert.equal(controller.uncertain,false);assert.equal(controller.canEdit,true);assert.equal(controller.canPreview,true);
  assert.equal(controller.handle,null);assert.equal(controller.preview,null);assert.equal(controller.canApply,false);
  assert.deepEqual(controller.selections(),selections);assert.equal(controller.executionId,"paid-original");assert.equal(controller.bindingHash,bindingHash);
  let rendered=render(f,locale);
  assert.match(rendered.markup,/<dialog\b[^>]*aria-labelledby=review-title/u);
  assert.ok(rendered.markup.includes(">"+copy["adaptive.changes.title"]+"</h2>"));
  assert.ok(rendered.markup.includes('<p role="status">'+copy["adaptive.changes.noChanges"]+"</p>"));
  assert.ok(!rendered.markup.includes(copy["adaptive.changes.checkRequired"]));
  assert.ok(rendered.markup.includes(copy["adaptive.changes.text"]+"<textarea"));
  assert.ok(input(rendered).attrs.includes(".value="+target.properties.text));
  button(rendered,"adaptive.changes.preview");
  assert.ok(!rendered.buttons.some(item=>item.label===copy["adaptive.changes.apply"]||item.label===copy["adaptive.changes.check"]));
  controller.close();assert.ok(!render(f,locale).markup.includes("<dialog"));controller.open("paid-original",[proposalId]);
  rendered=render(f,locale);assert.ok(rendered.markup.includes('<p role="status">'+copy["adaptive.changes.noChanges"]+"</p>"));
  const correction="  "+locale+" · تعديل / 日本語 — nouvelle intention\n  ";
  input(rendered).change({target:{value:correction}});
  assert.equal(controller.selections()[0].edit.text,correction);assert.equal(controller.selections()[0].targetBlockId,target.id);
  rendered=render(f,locale);assert.ok(input(rendered).attrs.includes(".value="+correction));
  assert.deepEqual(f.calls.map(item=>item.body.action),["preview"],"render, Close/reopen and input never prepare or apply automatically");
  assert.equal(f.state.refreshes,0);assert.deepEqual(f.state.reads,[]);
  const correcting=button(rendered,"adaptive.changes.preview").click(),next=await f.take();
  assert.equal(next.body.action,"preview");assert.equal(next.body.executionId,"paid-original");assert.equal(next.body.bindingHash,bindingHash);
  assert.equal(next.body.selections[0].targetBlockId,target.id);assert.equal(next.body.selections[0].edit.text,correction);
  const preview=await previewFor(f,next.body.selections,"preview-no-change-"+locale);
  await f.reply(next,{status:"review",preview,noPayment:true});await correcting;
  assert.equal(controller.phase,"review");assert.equal(controller.canApply,true);
  assert.deepEqual(f.calls.map(item=>item.body.action),["preview","preview"],"the new free preview is not Apply");
  const applying=button(render(f,locale),"adaptive.changes.apply").click(),apply=await f.take();
  assert.deepEqual(apply.body,{action:"apply",projectId:"project-a",documentId:"doc-a",canvasId:null,previewId:preview.previewId,approvalHash:preview.approvalHash});
  await f.reply(apply,receiptFor(preview));await applying;
  assert.equal(controller.phase,"applied");assert.equal(controller.canApply,false);assert.equal(controller.canEdit,false);
  assert.deepEqual(controller.receipt.blockIds,[target.id]);assert.equal(f.state.refreshes,1);
  assert.deepEqual(f.calls.map(item=>item.body.action),["preview","preview","apply"]);assert.deepEqual(f.state.reads,[]);
  assert.equal(JSON.stringify(f.state.projection),sourceBefore,"this finite renderer test never mutates its source model");
});

// Finite contract negatives, not Worker certification. Reuse this file's
// existing actual controller and simulated transport/source/model ports.
const targetRefusalCodes=["adaptive_changes_target_unavailable","adaptive_changes_target_protected"];
const targetRefusalEnvelope=async(f,call,error)=>({error,status:"preview-not-created",
  selectionKey:await adaptiveSelectionKey(f.state.scope,call.body.executionId,call.body.bindingHash,call.body.selections),noPayment:true,noAutomaticRetry:true});
for(const error of targetRefusalCodes){
  for(const fault of["wrong-key","array-error","nearby-error","missing-noPayment","extra-field"])test("synthetic target-refusal contract "+error+"/"+fault+" cannot release uncertainty",async()=>{
    const f=fixture(),c=f.controller;c.open("paid-original",["/suggested_blocks/0"]);
    c.update("/suggested_blocks/0","targetBlockId","second-subject");const selected=structuredClone(c.selections());
    const pending=c.request("preview"),call=await f.take(),body=await targetRefusalEnvelope(f,call,error);
    if(fault==="wrong-key")body.selectionKey="0".repeat(64);
    else if(fault==="array-error")body.error=[error];
    else if(fault==="nearby-error")body.error=error+"_later";
    else if(fault==="missing-noPayment")delete body.noPayment;
    else body.preview={privateText:"SYNTHETIC_INVALID_FIELD"};
    await f.reply(call,body,409);await pending;
    assert.equal(c.uncertain,true);assert.equal(c.canEdit,false);assert.equal(c.canPreview,false);assert.equal(c.canApply,false);
    assert.equal(c.handle,null);assert.equal(c.preview,null);assert.deepEqual(c.selections(),selected);
    assert.notEqual(c.notice,"adaptive.changes.targetRefused");assert.deepEqual(f.calls.map(row=>row.body.action),["preview"]);
  });
  for(const action of["apply","retrieve","resume"])test("synthetic target-refusal envelope on "+action+"/"+error+" is never preparation permission",async()=>{
    const f=fixture(),c=f.controller,preview=await saved(f),handle={previewId:preview.previewId,approvalHash:preview.approvalHash};
    const pending=c.request(action),call=await f.take();
    await f.reply(call,{error,status:"preview-not-created",selectionKey:preview.adaptiveReview.selectionKey,noPayment:true,noAutomaticRetry:true},409);await pending;
    assert.equal(c.uncertain,true);assert.equal(c.canEdit,false);assert.equal(c.canPreview,false);assert.equal(c.canApply,false);
    assert.deepEqual(c.handle,handle);assert.notEqual(c.notice,"adaptive.changes.targetRefused");
    assert.deepEqual(f.calls.map(row=>row.body.action),["preview",action]);
  });
  for(const interruption of["suspend","source-withdrawal"])test("synthetic current target-refusal reply cannot revive "+interruption+"/"+error,async()=>{
    const f=fixture(),c=f.controller;c.open("paid-original",["/suggested_blocks/0"]);
    c.update("/suggested_blocks/0","targetBlockId","second-subject");const pending=c.request("preview"),call=await f.take();
    const body=await targetRefusalEnvelope(f,call,error);
    if(interruption==="suspend")c.suspend();else{f.state.source={...f.state.source,withdrawalRevision:f.state.source.withdrawalRevision+1};c.synchronize();}
    await f.reply(call,body,409);await pending;
    assert.equal(c.uncertain,true);assert.equal(c.canEdit,false);assert.equal(c.canPreview,false);assert.equal(c.canApply,false);
    assert.equal(c.handle,null);assert.equal(c.preview,null);assert.notEqual(c.notice,"adaptive.changes.targetRefused");
    assert.deepEqual(f.calls.map(row=>row.body.action),["preview"]);
  });
  test("synthetic lost "+error+" response leaves the same original unknown through a real controller Check:none",async()=>{
    const f=fixture(),c=f.controller;c.open("paid-original",["/suggested_blocks/0"]);
    c.update("/suggested_blocks/0","targetBlockId","second-subject");const selected=structuredClone(c.selections());
    const pending=c.request("preview"),call=await f.take();await f.lose(call);await pending;
    assert.equal(c.uncertain,true);assert.equal(c.handle,null);assert.equal(c.canEdit,false);
    const checking=c.resume(),read=await f.take();assert.equal(read.body.action,"resume");await f.reply(read,{status:"none",noPayment:true});await checking;
    c.close();c.open("paid-original",["/suggested_blocks/0"]);
    assert.equal(c.uncertain,true);assert.equal(c.canEdit,false);assert.equal(c.canPreview,false);assert.equal(c.canApply,false);
    assert.deepEqual(c.selections(),selected);assert.equal(c.executionId,"paid-original");assert.equal(c.bindingHash,bindingHash);
    assert.deepEqual(f.calls.map(row=>row.body.action),["preview","resume"]);
  });
}

// Finite Output-identity renderer controls: actual public controller/template,
// simulated source projection, no Worker or browser selectedness certificate.
for(const locale of["en","fr","ar","ja"])test("finite emitted Output target selectedness "+locale+" survives until deliberate Create",()=>{
  const f=fixture(),source=structuredClone(f.state.source.structure);
  source.suggested_blocks[0]={...source.suggested_blocks[0],type:"output",subtype:"Custom deliverables",label:"An authored Output",instruction:"Output exactly one image at 1:1."};
  f.state.source.structure=source;
  const target=f.state.projection.libraryBlocks[1];target.type="output";target.properties={...target.properties,subtype:"Custom deliverables",text:"Original Output instructions"};
  const projectionBefore=JSON.stringify(f.state.projection),c=f.controller,proposalId="/suggested_blocks/0";
  c.open("paid-original",[proposalId]);c.update(proposalId,"targetBlockId",target.id);c.update(proposalId,"text","  Retained human Output wording.  ");
  const retained=structuredClone(c.selections());assert.equal(c.outputTargetId(proposalId),target.id);assert.equal(c.canPreview,false);assert.equal(c.canApply,false);
  const emitted=()=>{
    const rendered=render(f,locale),select=[...rendered.markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gu)][0];assert.ok(select);
    const entries=[...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gu)].map(([,attrs,label])=>{
      const selected=/\.selected=(true|false)\b/u.exec(attrs);assert.ok(selected,"each option emits a selected property");
      return{value:/\bvalue=(?:"([^"]*)"|([^\s>]+))/u.exec(attrs)?.slice(1).find(value=>value!==undefined),selected:selected[1]==="true",disabled:/\bdisabled\b/u.test(attrs),label};
    });
    return{rendered,select,entries};
  };
  let view=emitted();assert.equal(view.entries.length,2);assert.deepEqual(view.entries.filter(option=>option.selected).map(option=>option.value),[target.id]);
  const selected=view.entries.find(option=>option.value===target.id);assert.equal(selected.disabled,true);assert.equal(selected.label,ADAPTIVE_PROPOSAL_MESSAGES[locale]["adaptive.changes.outputTarget"]+" · "+target.id);
  assert.equal(view.entries.some(option=>option.label.includes(ADAPTIVE_PROPOSAL_MESSAGES[locale]["adaptive.changes.unavailableTarget"])),false,"the existing Output-specific branch retains precedence");
  assert.deepEqual(c.selections(),retained);assert.equal(f.calls.length,0);
  const handler=view.rendered.handlers[Number(/@change=__handler_(\d+)__/u.exec(view.select[1])?.[1])];assert.equal(typeof handler,"function");
  handler({target:{value:""}});view=emitted();
  assert.deepEqual(view.entries.filter(option=>option.selected).map(option=>option.value),[""]);assert.equal(view.entries.some(option=>option.value===target.id),false);
  assert.equal(c.selections()[0].targetBlockId,undefined);assert.equal(c.selections()[0].edit.text,retained[0].edit.text);assert.equal(c.canPreview,true);assert.equal(c.canApply,false);
  assert.equal(c.executionId,"paid-original");assert.equal(c.bindingHash,bindingHash);assert.equal(f.calls.length,0,"the rendered target-change handler creates no Preview or Apply");
  assert.equal(JSON.stringify(f.state.projection),projectionBefore);
});

test("finite typed Output refusal emits one disabled selected identity despite an older eligible projection",async()=>{
  const f=fixture(),c=f.controller,proposalId="/suggested_blocks/0",target="second-subject";
  c.open("paid-original",[proposalId]);c.update(proposalId,"targetBlockId",target);c.update(proposalId,"text","  Keep the human target draft.  ");
  const retained=structuredClone(c.selections()),projectionBefore=JSON.stringify(f.state.projection);
  const previewing=c.request("preview"),call=await f.take();assert.equal(call.body.action,"preview");assert.equal(call.body.selections[0].targetBlockId,target);
  // Existing positive endpoint-specific finite contract; not a Worker reply
  // certificate or a claim that the projection itself changed type.
  await f.reply(call,{status:"not-applied",error:"output_requirement_endpoint_required",blockId:target},409);await previewing;
  assert.equal(c.outputTargetId(proposalId),target);assert.equal(c.targets(proposalId).some(block=>block.id===target),true);
  assert.equal(c.canPreview,false);assert.equal(c.canApply,false);assert.deepEqual(c.selections(),retained);
  const rendered=render(f),select=[...rendered.markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gu)][0];assert.ok(select);
  const entries=[...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gu)].map(([,attrs,label])=>({
    value:/\bvalue=(?:"([^"]*)"|([^\s>]+))/u.exec(attrs)?.slice(1).find(value=>value!==undefined),
    selected:/\.selected=true\b/u.test(attrs),disabled:/\bdisabled\b/u.test(attrs),label}));
  assert.deepEqual(entries.map(option=>option.value),["",target,"first-subject"],"only the duplicate ordinary option is excluded at rendering; Create and other eligible targets remain");
  assert.deepEqual(entries.filter(option=>option.selected).map(option=>option.value),[target]);
  const matches=entries.filter(option=>option.value===target);assert.equal(matches.length,1);assert.equal(matches[0].disabled,true);
  assert.equal(matches[0].label,ADAPTIVE_PROPOSAL_MESSAGES.en["adaptive.changes.outputTarget"]+" · "+target);
  assert.deepEqual(f.calls.map(row=>row.body.action),["preview"]);assert.equal(c.handle,null);assert.equal(c.preview,null);assert.equal(c.receipt,null);
  const handler=rendered.handlers[Number(/@change=__handler_(\d+)__/u.exec(select[1])?.[1])];assert.equal(typeof handler,"function");handler({target:{value:""}});
  assert.equal(c.selections()[0].targetBlockId,undefined);assert.equal(c.selections()[0].edit.text,retained[0].edit.text);assert.equal(c.canPreview,true);assert.equal(c.canApply,false);
  assert.equal(c.executionId,"paid-original");assert.equal(c.bindingHash,bindingHash);assert.deepEqual(f.calls.map(row=>row.body.action),["preview"]);
  assert.equal(JSON.stringify(f.state.projection),projectionBefore);
});
