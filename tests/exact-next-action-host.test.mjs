import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {creativeNextActions,creativeNextTargetAvailable,creativePreparationChoice,creativePreparationTargetAvailable,followCreativeNextTarget,retainCreativePreparation} from "../src/model/workspace-intelligence.ts";
import {VIDEO_ADAPTER_CONTRACT} from "../src/model/video-adapter.ts";
import {outputComparisonHistory} from "../src/model/output-comparison.ts";
import {foldEvents,outputQualityLabel} from "../src/model/events.ts";
import {documentArtifactRevision} from "../src/model/document-artifacts.ts";

const source=readFileSync(new URL("../src/components/forma-workspace.ts",import.meta.url),"utf8");
const start=source.indexOf("  async #followNextAction("),end=source.indexOf("  #formatChoiceDialog()",start);
assert.ok(start>=0&&end>start,"Production method boundaries changed");
const methods=source.slice(start,end);
const makeFacts=(documentId="A",outputs=[])=>({projectId:"p",documentId,canvasId:null,authorityKey:"actor:scope",canRead:true,canAuthor:true,canConfigure:true,artifacts:[],outputs,jobs:[],blocks:[{id:`direction-${documentId}`,projectId:"p",documentId,type:"direction",scope:"document",canvasId:null,removed:false,sourceEvents:["event-1"],properties:{text:"An authored direction",weight:1,intent:"include"}}]});
const savedImage={id:"saved-image",documentId:"A",canvasId:null,title:"Existing image",sequence:7,quality:"high",purpose:"final",discarded:false,promptFanId:null,provider:"test-provider",mediaUrl:"/api/media/saved-image"};

// Production host methods and target guards, deterministic DOM/render ports.
// This is an in-memory host test, not native browser or provider evidence.
function warm(facts=makeFacts(),onViewerUpdate=()=>{}){
  const trace=[],routes=[],state={facts};
  class HTMLElement{isConnected=true;getClientRects(){return[{}];}focus(){trace.push("focus:opener");}}
  const document={activeElement:new HTMLElement()},nextActionFacts=()=>state.facts;
  const fakeStore={projection:{get:()=>state.facts},toast:()=>trace.push("toast:unavailable"),setRoute:route=>routes.push(route),patchUi:()=>{throw new Error("Unexpected UI operation");}};
  const imageViewer={output:null,isConnected:true,get updateComplete(){return Promise.resolve().then(()=>{trace.push("viewer-updated");onViewerUpdate(state);});},openImageViewer(){trace.push("viewer-open:"+this.output?.id);}};
  const Probe=eval(stripTypeScriptTypes(`(class {
    #formatChoiceOpen=false;#formatReturnFocus=null;#formatTarget=null;#nextOutputTarget=null;#workbenchPane="write";
    store=fakeStore;i18n={t:(_key,fallback)=>fallback};
    requestUpdate(){trace.push("update-request");}
    get updateComplete(){return Promise.resolve().then(()=>trace.push("updated"));}
    #selectWorkbenchPane(pane){this.#workbenchPane=pane;trace.push("pane:"+pane);this.requestUpdate();}
    querySelector(selector){
      if(selector===".next-format-dialog")return{close:()=>trace.push("chooser-close")};
      if(selector.startsWith("[data-workbench-pane="))return{focus:()=>trace.push("focus:"+this.#workbenchPane)};
      if(selector==="forma-document-artifacts")return{openRender:(medium,documentId)=>trace.push("config:"+medium+":"+documentId)};
      if(selector==="forma-generation-actions")return{openConfiguration:()=>trace.push("config:image:"+state.facts.documentId)};
      if(selector===".next-output-viewer"){imageViewer.output=state.facts.outputs.find(output=>output.id===this.#nextOutputTarget?.outputId);return imageViewer;}
      throw new Error("Unexpected selector "+selector);
    }
    openContextComposer(){throw new Error("Unexpected context action");}
    prepare(target){return this.#prepareFormat(target);}choose(medium){return this.#chooseFormat(medium);}cancel(){return this.#closeFormatChoice();}follow(action){return this.#followNextAction(action);}
    ${methods}
  })`));
  return{host:new Probe(),state,trace,routes,document,target:()=>creativeNextActions(state.facts).find(action=>action.id==="configure-output").target};
}

test("warm chooser retains A and rejects selection after switching to B",async()=>{
  const f=warm();await f.host.prepare(f.target());f.trace.length=0;f.state.facts=makeFacts("B");await f.host.choose("slides");assert.ok(!f.trace.some(event=>event.startsWith("config:")));assert.ok(f.trace.includes("toast:unavailable"));assert.deepEqual(f.routes,[]);
});
test("cancel closes and finishes updating before restoring opener focus",async()=>{
  const f=warm();await f.host.prepare(f.target());f.trace.length=0;const pending=f.host.cancel();assert.deepEqual(f.trace,["chooser-close","update-request"]);await pending;assert.deepEqual(f.trace,["chooser-close","update-request","updated","focus:opener"]);
});
test("cancel falls back to the current pane when the opener is disconnected",async()=>{
  const f=warm();await f.host.prepare(f.target());f.document.activeElement.isConnected=false;f.trace.length=0;await f.host.cancel();assert.deepEqual(f.trace,["chooser-close","update-request","updated","focus:write"]);
});
test("format selection focuses Result before opening exact configuration",async()=>{
  for(const medium of ["slides","image"]){const f=warm();await f.host.prepare(f.target());f.trace.length=0;await f.host.choose(medium);assert.deepEqual(f.trace,["chooser-close","update-request","updated","pane:result","update-request","updated","focus:result",`config:${medium}:A`]);assert.deepEqual(f.routes,[]);}
});
test("saved image opens locally by exact ID without changing route",async()=>{
  const f=warm(makeFacts("A",[savedImage]));await f.host.follow(creativeNextActions(f.state.facts)[0]);assert.deepEqual(f.routes,[]);assert.deepEqual(f.trace,["update-request","updated","viewer-updated","viewer-open:saved-image"]);
});
test("image opening fails closed after authority changes during viewer update",async()=>{
  const f=warm(makeFacts("A",[savedImage]),state=>{state.facts={...state.facts,authorityKey:"revoked-scope",canRead:false};});await f.host.follow(creativeNextActions(f.state.facts)[0]);assert.ok(!f.trace.includes("viewer-open:saved-image"));assert.deepEqual(f.routes,[]);assert.ok(f.trace.includes("toast:unavailable"));
});

const artifactSource=readFileSync(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8");
const generationSource=readFileSync(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8");
function configurationMember(text,from,to){const begin=text.indexOf(from),end=text.indexOf(to,begin+from.length);assert.ok(begin>=0&&end>begin,"Production configuration boundaries changed: "+from);return text.slice(begin,end).replaceAll("#","_");}
const artifactConfigurationMethods=[configurationMember(artifactSource,"  #closeViewerPopovers(","  #clearCreationDraft("),configurationMember(artifactSource,"  protected override willUpdate(","  protected override updated("),configurationMember(artifactSource,"  protected override updated(","  #bindCompletedWorkflowStage("),configurationMember(artifactSource,"  #openCreate=","  async #revealWorkbenchPane("),configurationMember(artifactSource,"  async #revealWorkbenchPane(","  async openRender("),configurationMember(artifactSource,"  async openRender(","  async openArtifactById(")].join("\n");
const imageConfigurationMethods=[configurationMember(generationSource,"  async openConfiguration(","  #budgetGuidance("),configurationMember(generationSource,"  protected override updated(","  override connectedCallback("),configurationMember(generationSource,"  #closeDetails(","  #closeFailures(")].join("\n");

// Execute production lifecycle methods before each mocked update resolves. A stale
// modal opening even transiently is a failure, not a success because it later closes.
function configurationHost(kind,{changeAt=0,change=null}={}){
  const state={facts:makeFacts(),required:true,route:"/document/A"},trace=[];let host,awaits=0;
  const document={documentElement:{dataset:{}}},window={clearTimeout(){}},nextActionFacts=()=>state.facts;
  const fetch=()=>assert.fail("Free configuration must not dispatch a request");
  const store=new Proxy({captureAuthorizationScope:()=>({key:state.facts.authorityKey}),route:{get:()=>state.route},session:{get:()=>({projectContext:null})},projection:{get:()=>state.facts},canvasProjection:{get:()=>({selectedCanvasId:state.facts.canvasId})},routeDataReady:()=>false},{get(target,key){assert.ok(key in target,"Unexpected configuration store operation: "+String(key));return target[key];}});
  const popovers=[{open:true,close(){this.open=false;trace.push("popover-close");}}];
  const dialog={open:false,close(){this.open=false;trace.push("close");}},ensureModalDialog=value=>{if(!value)return false;if(!value.open){value.open=true;trace.push("show:"+state.facts.documentId);}return true;};
  function invalidate(reason){
    if(reason==="document"){const previous=host.documentId;state.facts=makeFacts("B");host.documentId="B";host.willUpdate?.(new Map([["documentId",previous]]));}
    else if(reason==="source")state.facts={...state.facts,blocks:state.facts.blocks.map(block=>({...block,properties:{...block.properties,text:"Changed after the original choice"}}))};
    else if(reason==="authority")state.facts={...state.facts,authorityKey:"actor:new-permission-epoch"};
    else if(reason==="caller")state.required=false;else assert.fail("Unknown invalidation: "+reason);
  }
  async function tick(label){const at=++awaits;trace.push("await:"+label);await Promise.resolve();if(at===changeAt)invalidate(change);host.updated();return true;}
  const members=kind==="artifact"?artifactConfigurationMethods:imageConfigurationMethods;
  const Probe=eval(stripTypeScriptTypes(`(class extends Object {
    documentId="A";source="document";store=store;_configurationCurrent=null;_viewerCurrent=null;_createOpen=false;_activeId="";_viewerPopoverScope="";
    _kind="slides";_activeWorkflowStageId="";_detailsOpen=false;_queueOpen=false;_failuresOpen=false;_safetyDiagnosticOpen=false;_readinessTimer=0;_readinessSignature="";
    requestUpdate(){trace.push("request-update");}get updateComplete(){return tick("child");}_targetDocumentId(){return this.documentId;}
    _selectArtifactKind(value){this._kind=value;}_resetPresentationCount(){}_createDialog(){return dialog;}_viewDialog(){return null;}_bindCompletedWorkflowStage(){}
    querySelector(selector){return selector===".generation-details-dialog"?dialog:null;}
    querySelectorAll(selector){assert.equal(selector,"forma-ui-popover");return popovers;}
    closest(selector){assert.equal(selector,"forma-workspace");return{updateComplete:tick("workspace")};}
    dispatchEvent(event){trace.push("event:"+event.type);return true;}${members}
  })`));
  host=new Probe();return{host,state,trace,dialog,popovers,invalidate,open:()=>kind==="artifact"?host.openRender("slides","A",{current:()=>state.required}):host.openConfiguration(()=>state.required),steps:()=>awaits};
}
for(const kind of ["artifact","image"]){
  test("real "+kind+" configuration opens unchanged A only, through its updated auto-open path",async()=>{const f=configurationHost(kind);assert.equal(await f.open(),true);assert.equal(f.dialog.open,true);assert.deepEqual(f.trace.filter(event=>event.startsWith("show:")),["show:A"]);assert.equal(f.steps(),kind==="artifact"?3:1);});
  for(const reason of ["document","source","authority","caller"]){
    const checkpoints=kind==="artifact"?[[1,"initial child update"],[2,"workspace reveal"],[3,"create-dialog update"]]:[[1,"details-dialog update"]];
    for(const[changeAt,label]of checkpoints)test("real "+kind+" configuration rejects "+reason+" change at "+label+" before any modal opens",async()=>{const f=configurationHost(kind,{changeAt,change:reason});assert.equal(await f.open(),false);assert.equal(f.dialog.open,false);assert.deepEqual(f.trace.filter(event=>event.startsWith("show:")),[]);f.host.updated();assert.equal(f.dialog.open,false);assert.deepEqual(f.trace.filter(event=>event.startsWith("show:")),[]);});
    if(reason!=="source")test("real "+kind+" updated closes and does not reopen an already-visible configuration after "+reason+" changes",async()=>{const f=configurationHost(kind);assert.equal(await f.open(),true);f.trace.length=0;f.invalidate(reason);f.host.updated();f.host.updated();assert.equal(f.dialog.open,false);assert.deepEqual(f.trace.filter(event=>event.startsWith("show:")),[]);});
  }
  test("real "+kind+" configuration remains usable after a same-document settings edit without authorizing work",async()=>{const f=configurationHost(kind);assert.equal(await f.open(),true);f.trace.length=0;f.invalidate("source");f.host.updated();f.host.updated();assert.equal(f.dialog.open,true);assert.ok(!f.trace.includes("close"));assert.deepEqual(f.trace.filter(event=>event.startsWith("show:")),[]);f.invalidate("authority");f.host.updated();assert.equal(f.dialog.open,false);});
}
for(const change of ["document","authority","artifact","route"])test("real configuration popover lifecycle closes on "+change+" rebinding, not an unchanged update",()=>{
  const f=configurationHost("artifact");
  f.host._syncViewerPopovers();
  assert.equal(f.popovers[0].open,false);
  f.popovers[0].open=true;f.trace.length=0;
  f.host._syncViewerPopovers();
  assert.equal(f.popovers[0].open,true);assert.deepEqual(f.trace,[]);
  if(change==="document")f.host.documentId="B";
  else if(change==="authority")f.state.facts={...f.state.facts,authorityKey:"actor:changed-scope"};
  else if(change==="artifact")f.host._activeId="different-artifact";
  else f.state.route="/canvas/board";
  f.host._syncViewerPopovers();
  assert.equal(f.popovers[0].open,false);assert.deepEqual(f.trace,["popover-close"]);
});
for(const medium of ["slides","image"])test("warm chooser surfaces an unavailable result when the "+medium+" child handoff declines",async()=>{const f=warm(),lookup=f.host.querySelector.bind(f.host);f.host.querySelector=selector=>selector==="forma-document-artifacts"?{openRender:async()=>false}:selector==="forma-generation-actions"?{openConfiguration:async()=>false}:lookup(selector);await f.host.prepare(f.target());f.trace.length=0;await f.host.choose(medium);assert.ok(f.trace.includes("toast:unavailable"));assert.deepEqual(f.routes,[]);});

function artifactHost(changeOnUpdate=false){
  const trace=[],artifact={id:"saved",documentId:"A",sequence:2},job={jobId:"saved",documentId:"A",status:"running"};
  const host={documentId:"A",store:{captureAuthorizationScope:()=>({key:"authority"}),authorizationScopeActive:()=>true,projection:{get:()=>({libraryArtifacts:[artifact]})},documentJobs:{get:()=>[job]},events:{get:()=>[]},content:{get:()=>({})}},get updateComplete(){return Promise.resolve().then(()=>{if(changeOnUpdate)this.documentId="B";});},_targetDocumentId(){return this.documentId;},_revealWorkbenchPane:async()=>{},_openArtifact:async()=>trace.push("artifact"),_inspectRunningInputs:async()=>trace.push("job")};
  for(const name of ["openArtifactById","openJobById"]){const method=artifactSource.split("\n").find(line=>line.includes(`async ${name}(`));assert.ok(method);const generated=eval(stripTypeScriptTypes(`({${method.replaceAll("#","_")}})`));host[name]=generated[name];}
  return{host,trace};
}
test("same artifact host follows explicit document rebinding after artifact or job inspection",async()=>{
  assert.match(source,/forma-document-artifacts compact source="document" \.documentId=\$\{p.documentId\}/);
  for(const name of ["openArtifactById","openJobById"]){const f=artifactHost();await f.host[name]("saved");assert.equal(f.trace.length,1);f.host.documentId="B";assert.equal(f.host._targetDocumentId(),"B");}
});
test("artifact and job inspection reject a document switch during their host update",async()=>{
  const artifact=artifactHost(true);await assert.rejects(artifact.host.openArtifactById("saved"),/changed/);assert.deepEqual(artifact.trace,[]);
  const job=artifactHost(true);assert.equal(await job.host.openJobById("saved"),false);assert.deepEqual(job.trace,[]);
});

test("unavailable historical comparison renders the saved pair without a false zero-change finding",()=>{
  const begin=source.indexOf("  #comparison() {"),end=source.indexOf("  #inspector()",begin);assert.ok(begin>=0&&end>begin);
  const nothing="",icon=()=>"",seen=[];
  const flatten=value=>Array.isArray(value)?value.map(flatten).join(""):typeof value==="string"||typeof value==="number"?String(value):"";
  const html=(parts,...values)=>{seen.push(...values.filter(value=>value?.id));return parts.reduce((result,part,index)=>result+part+flatten(values[index]),"");};
  const projection={projectId:"p",documentId:"A",libraryOutputs:[savedImage,{...savedImage,id:"second"}]};
  const store={events:{get:()=>[]},projection:{get:()=>projection},ui:{comparisonOutputIds:"saved-image|second"}};
  const Probe=eval(stripTypeScriptTypes(`(class {store=store;i18n={t:(_id,fallback)=>fallback,system:value=>value};#comparisonChange(){throw new Error("No historical changes are available");}render(){return this.#comparison();}${source.slice(begin,end)}})`));
  const rendered=new Probe().render();assert.match(rendered,/Historical comparison evidence is unavailable/);assert.doesNotMatch(rendered,/<strong>0 changes/);assert.deepEqual(seen.map(output=>output.id),["saved-image","second"]);
});

// Exercise the private production viewer through its member lookup and render.
function actualArtifactViewerHost({boundary=null,change=null,unloaded=false,memberGate=null}={}){
  const event=(sequence,type,payload)=>({eventId:`artifact-event-${sequence}`,streamId:"stream",sequence,type,payload,actor:"user:owner",correlationId:"artifact",occurredAt:"2026-08-27T00:00:00Z"});
  const originalContent=JSON.stringify({content_markdown:"Saved body",items:[]});
  const state={events:[event(1,"ProjectCreated",{project_id:"p",name:"Project"}),event(2,"DocumentCreated",{document_id:"A",project_id:"p",title:"Document"}),event(3,"DocumentRenderCompleted",{document_id:"A",project_id:"p",artifact_id:"saved-artifact",artifact_kind:"slides",title:"Saved revision",content_ref:"private-body"})],content:unloaded?{}:{"private-body":originalContent},authorityKey:"authority-1",canRead:true,saveConflicts:false},trace=[];let updateReads=0,invalidated=false;
  const projection=()=>foldEvents(state.events,Infinity,"A","p"),original=projection().libraryArtifacts[0];
  const commitEdit=(markdown,extra={})=>{const revision=documentArtifactRevision(state.events,original.id)+1;state.events.push(event(state.events.length+1,"DocumentArtifactEdited",{project_id:"p",document_id:"A",artifact_id:original.id,content_ref:original.contentRef,revision,changed_fields:["content_markdown"],...extra}));state.content[original.contentRef]=JSON.stringify({content_markdown:markdown,items:[]});};
  const invalidate=()=>{if(invalidated)return;invalidated=true;trace.push("invalidate:"+change);if(change==="revision")commitEdit("Collaborator replacement");else if(change==="content")state.content[original.contentRef]="Unreceipted replacement";else if(change==="authorization"){state.authorityKey="authority-2";state.canRead=false;}else throw new Error("Unknown mutation "+change);};
  class HTMLElement{}const document={activeElement:null};
  const dialog={open:false,setAttribute(){},addEventListener(){},close(){if(this.open){this.open=false;trace.push("viewer-close");}}};
  const ensureModalDialog=element=>{assert.equal(element,dialog);if(!element.open){element.open=true;trace.push("viewer-open:"+original.id+":"+projection().libraryArtifacts[0].sequence);}};
  let enteredMembers;const membersEntered=new Promise(resolve=>enteredMembers=resolve);
  const fetch=async(url,options)=>{assert.equal(url,"/api/workspaces/org/projects/access/members");assert.equal(options.credentials,"same-origin");trace.push("members");enteredMembers();if(memberGate)await memberGate;if(boundary==="member-fetch")invalidate();return{ok:true,json:async()=>({members:[]})};};
  const host={documentId:"A",source:"document",_viewerCurrent:null,_configurationCurrent:null,_activeId:"",_savingEdit:false,store:{captureAuthorizationScope:()=>({key:state.authorityKey}),authorizationScopeActive:authorization=>Boolean(state.canRead&&authorization?.key===state.authorityKey),projection:{get:projection},content:{get:()=>state.content},ensurePrivateContent:async()=>{state.content[original.contentRef]=originalContent;},session:{get:()=>({user:{userId:"owner"},projectContext:{organizationId:"org",projectAccessId:"access",permissions:["project.author"]}})},events:{get:()=>state.events},ui:{instrumentation:false},reviseDocumentArtifact:async(id,input)=>{assert.equal(id,original.id);assert.equal(input.expectedRevision,documentArtifactRevision(state.events,id));if(state.saveConflicts)return false;commitEdit(input.markdown);host.updated();return true;},restoreDocumentArtifact:async(id,revision,expectedRevision)=>{assert.equal(id,original.id);assert.equal(expectedRevision,documentArtifactRevision(state.events,id));commitEdit("Restored original body",{restored_from_revision:revision,revision_action:"restore"});host.updated();return true;}},get updateComplete(){const ordinal=++updateReads;return Promise.resolve().then(()=>{if(boundary==="final-render"&&ordinal===2)invalidate();this.updated();});},_targetDocumentId(){return this.documentId;},_revealWorkbenchPane:async()=>{},_viewDialog:()=>dialog,_createDialog:()=>null,_bindCompletedWorkflowStage(){},querySelector:()=>null,requestUpdate(){},dispatchEvent(){},_content:()=>JSON.parse(state.content[original.contentRef]),_loadHistory:async()=>trace.push("history-refreshed")};
  const methods=["openArtifactById","#openArtifact","#saveArtifactEdit","#restoreRevision"].map(name=>{const method=artifactSource.split("\n").find(line=>line.includes("async "+name+"("));assert.ok(method);return method.replaceAll("#","_");});
  for(const name of ["#startArtifactEdit","#cancelArtifactEdit"]){const method=artifactSource.split("\n").find(line=>line.trimStart().startsWith(name+"("));assert.ok(method);methods.push(method.replaceAll("#","_"));}
  methods.push(configurationMember(artifactSource,"  protected override updated(","  #bindCompletedWorkflowStage(").replace("protected override ",""));Object.assign(host,eval(stripTypeScriptTypes("({"+methods.join(",\n")+"})")));
  return{host,state,trace,dialog,original,projection,commitEdit,membersEntered,updateReads:()=>updateReads};
}
test("actual artifact viewer opens its unchanged saved revision after member lookup and final render",async()=>{
  const f=actualArtifactViewerHost();assert.equal(await f.host.openArtifactById(f.original.id),true);assert.equal(f.dialog.open,true);assert.equal(f.updateReads(),2);assert.deepEqual(f.trace,["members","viewer-open:saved-artifact:3"]);
});
for(const boundary of ["member-fetch","final-render"])for(const change of ["revision","content","authorization"]){
  test("actual artifact viewer rejects "+change+" changes during "+boundary,async()=>{
    const f=actualArtifactViewerHost({boundary,change});assert.equal(await f.host.openArtifactById(f.original.id),false);assert.equal(f.dialog.open,false);assert.equal(f.trace.filter(item=>item==="members").length,1);assert.equal(f.trace.filter(item=>item==="invalidate:"+change).length,1);assert.ok(!f.trace.some(item=>item.startsWith("viewer-open:")));assert.equal(f.updateReads(),boundary==="member-fetch"?1:2);assert.equal(f.projection().libraryArtifacts[0].sequence,f.original.sequence);if(change==="revision")assert.equal(documentArtifactRevision(f.state.events,f.original.id),1);
  });
}
test("actual artifact viewer hydrates unchanged private content without generation",async()=>{const f=actualArtifactViewerHost({unloaded:true});assert.equal(await f.host.openArtifactById(f.original.id),true);assert.equal(f.dialog.open,true);assert.equal(f.host._content().content_markdown,"Saved body");});
test("real artifact edits invalidate a rendered next-action target while creation sequence is unchanged",()=>{const f=actualArtifactViewerHost(),facts=()=>({...makeFacts(),artifacts:f.projection().libraryArtifacts,events:f.state.events});const action=creativeNextActions(facts())[0];assert.equal(action.target.revision,0);f.commitEdit("Collaborator replacement");assert.equal(f.projection().libraryArtifacts[0].sequence,action.target.sequence);assert.equal(creativeNextTargetAvailable(action.target,facts()),false);});
test("successful own Save and Restore preserve the opened viewer and revision-bound editing",async()=>{const f=actualArtifactViewerHost();await f.host.openArtifactById(f.original.id);f.host._startArtifactEdit(f.original);f.host._editMarkdown="My saved correction";await f.host._saveArtifactEdit(f.original);assert.equal(f.dialog.open,true);assert.equal(f.host._editingId,"");assert.equal(f.host._content().content_markdown,"My saved correction");assert.equal(documentArtifactRevision(f.state.events,f.original.id),1);await f.host._restoreRevision(f.original,0);assert.equal(f.dialog.open,true);assert.equal(f.host._content().content_markdown,"Restored original body");assert.equal(documentArtifactRevision(f.state.events,f.original.id),2);assert.equal(f.state.events.at(-1).payload.restored_from_revision,0);assert.ok(f.trace.includes("history-refreshed"));f.state.canRead=false;f.host.updated();assert.equal(f.dialog.open,false);});
test("a conflicting Save preserves the unsaved correction in the opened viewer",async()=>{const f=actualArtifactViewerHost();await f.host.openArtifactById(f.original.id);f.host._startArtifactEdit(f.original);f.host._editMarkdown="Keep my unsaved correction";f.state.saveConflicts=true;await f.host._saveArtifactEdit(f.original);assert.equal(f.dialog.open,true);assert.equal(f.host._editingId,f.original.id);assert.equal(f.host._editMarkdown,"Keep my unsaved correction");assert.equal(documentArtifactRevision(f.state.events,f.original.id),0);});
test("background updates cannot expose an artifact editor before member lookup completes, and the first visible Save stays open",async()=>{
  let release;const memberGate=new Promise(resolve=>release=resolve),f=actualArtifactViewerHost({memberGate});const opening=f.host.openArtifactById(f.original.id);await f.membersEntered;
  f.host.updated();f.host.updated();assert.equal(f.dialog.open,false);assert.ok(!f.trace.some(item=>item.startsWith("viewer-open:")));
  release();assert.equal(await opening,true);assert.equal(f.dialog.open,true);f.host._startArtifactEdit(f.original);f.host._editMarkdown="First visible save";await f.host._saveArtifactEdit(f.original);assert.equal(f.dialog.open,true);assert.equal(f.host._content().content_markdown,"First visible save");assert.equal(documentArtifactRevision(f.state.events,f.original.id),1);
});
test("a collaborator edit during delayed member lookup and background rendering never exposes the stale viewer",async()=>{
  let release;const memberGate=new Promise(resolve=>release=resolve),f=actualArtifactViewerHost({memberGate});const opening=f.host.openArtifactById(f.original.id);await f.membersEntered;
  f.host.updated();f.commitEdit("Collaborator replaced this while opening");f.host.updated();release();assert.equal(await opening,false);assert.equal(f.dialog.open,false);assert.ok(!f.trace.some(item=>item.startsWith("viewer-open:")));
});
