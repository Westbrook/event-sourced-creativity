import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { html } from "lit";
import { snapshot as outputSnapshot, deferred } from "./output-ui-source-harness.mjs";
import { createSceneStoreHost, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { documentContextBlockRoute, withDocumentInRoute } from "../src/model/routes.ts";
import { calmFullPageNativePorts as navigationPorts, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

// Reuse complete production components and LocaleController with existing native
// ports. Omit only fixture test registration; no production method is replaced.
// Deterministic component/Store evidence, not a browser or AT certificate.
const fixtureUrl=new URL("./presentation-guidance-accessibility.test.mjs",import.meta.url);
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),tree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let fixtureModule=tree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isClassDeclaration(node)||ts.isFunctionDeclaration(node)
  ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(tree)==="registerHooks").map(node=>node.getFullText(tree)).join("\n");
fixtureModule=fixtureModule.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu,(_match,prefix,_quote,specifier)=>prefix+JSON.stringify(specifier.startsWith(".")?new URL(specifier,fixtureUrl).href:specifier.startsWith("node:")?specifier:import.meta.resolve(specifier)));
fixtureModule=fixtureModule.replaceAll('import.meta.resolve("vite")',JSON.stringify(import.meta.resolve("vite"))).replaceAll("import.meta.url",JSON.stringify(fixtureUrl.href));
fixtureModule=fixtureModule.replace("await import(specifier)", "await import(specifier===\"lit/directives/live.js\"?"+JSON.stringify(import.meta.resolve("lit/directives/live.js"))+":specifier)");
fixtureModule+="\nexport {fixture,loadActual,ElementPort,documentPort,windowPort};\n";
const {fixture}=await import("data:text/javascript;base64,"+Buffer.from(fixtureModule).toString("base64"));
// Keep the old explicitly finite Store/facts factory; use the already shared
// native renderer/IDL for the newly required real Shell admission parent.
const {loadActual,ElementPort,documentPort,windowPort}=navigationPorts;
const {FormaShell}=await loadActual("src/components/forma-shell.ts");
const {ContextIntelligence}=await loadActual("src/components/context-intelligence.ts");
const {FormaOutputRequirements}=await loadActual("src/components/forma-output-requirements.ts");
const {FormaOutputRequirementCard}=await loadActual("src/components/forma-output-requirement-card.ts");
const endpointError="output_requirement_endpoint_required";
const noProviders=t=>t.mock.method(globalThis,"fetch",async()=>assert.fail("No external API or provider is allowed"));
const plain=value=>String(value).replace(/<[^>]+>/gu,"").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&amp;","&").trim();
function buttons(f,owner){
  return [...(owner.markup??"").matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)].map(([,raw,text])=>{
    const value=f.renderer.attrs(raw),textContent=plain(text),node=f.renderer.ownNodes(owner,"button").find(candidate=>candidate.handlers.click===value.handlers.click&&candidate.attributes["aria-label"]===value.attributes["aria-label"]);
    if(node){node.textContent=textContent;node.disabled=Object.hasOwn(node.attributes,"disabled");node.getClientRects=()=>f.visibleCard?[{}]:[];}
    return{...value,textContent,node};
  });
}
function retainedReview(projectId,documentId,blockId){
  const proposal={id:"proposal-one",type:"direction",subtype:"Creative direction",label:"Saved direction",text:"One owned image.",sourceExcerpt:"One owned image.",participants:[],addendum:false};
  return{previewId:"original-preview",approvalHash:"a".repeat(64),sourceHash:"b".repeat(64),projectId,documentId,canvasId:null,blockId,
    events:[],changes:[],blockCount:1,relationCount:0,expiresAt:"2099-09-01T00:00:00.000Z",
    review:{sourceText:"One owned image.",proposals:[{key:"original-execution:proposal-one",executionId:"original-execution",proposalId:"proposal-one",decomposition:proposal}],
      selections:[{executionId:"original-execution",bindingHash:"c".repeat(64),proposalId:"proposal-one"}]}};
}
async function handoffFixture(t,{locale="en",error=endpointError,refusalAt="apply",blockType="output",shellMain=false}={}){
  noProviders(t);
  const baseCleanups=[],nativeCleanups=[];
  const f=fixture({after:cleanup=>baseCleanups.push(cleanup)},{locale,facts:[{id:"requirement-A",type:blockType,text:"One owned image."}]});
  f.host.isConnected=false;f.host.disconnectedCallback();f.trace.length=0;f.frames=[];f.opened=[];f.patches=[];f.visibleCard=true;f.otherDialog=false;f.navigationGate=null;f.shellMain=shellMain;
  Object.assign(f,{resizeTargets:new Map(),timers:new Map(),storage:new Map(),timerSequence:0});
  t.after(async()=>{
    navigationPorts.bindFixture(f);
    for(const {instance}of f.renderer.instances.values())if(instance.isConnected){instance.isConnected=false;instance.disconnectedCallback();}
    f.host.isConnected=false;
    if(f.shell){f.shell.isConnected=false;f.shell.disconnectedCallback();}
    f.publishNavigationState?.();
    // Deliver only already queued native frames after retirement so their own
    // original guards can finish; no result, focus target or action is supplied.
    for(let count=0;f.frames.length&&count<32;count++){f.frames.shift()();await Promise.resolve();}
    assert.equal(f.frames.length,0,"retired continuation cleanup remains bounded");
    if(f.shell){documentPort.body.children=documentPort.body.children.filter(node=>node!==f.shell);f.shell.parentElement=null;}
    f.host.parentElement=null;
    for(const cleanup of [...nativeCleanups].reverse())await cleanup();
    for(const cleanup of baseCleanups)await cleanup();
  });
  navigationPorts.bindFixture(f);
  f.state.route=documentContextBlockRoute("A","Author-owned document","");f.state.author=true;f.store.route={get:()=>f.state.route};
  const session=f.store.session.get;f.store.session.get=()=>({...session(),capabilities:[...(f.state.canRead?["project.read"]:[]),...(f.state.author?["project.author"]:[])]});
  const subscribers=new Set(),publish=()=>{for(const subscriber of [...subscribers])subscriber();};
  f.publishNavigationState=publish;
  assert.equal(f.store.subscribe,undefined,"the old finite Store has no prior subscription port to replace");
  f.store.subscribe=listener=>{subscribers.add(listener);return()=>subscribers.delete(listener);};
  f.store.patchUi=patch=>{f.patches.push(patch);Object.assign(f.store.ui,patch);publish();};
  // This is still the existing mocked Store navigation boundary, not a real
  // Store/Worker approval or navigation receipt. Forward the actual Shell hook
  // immediately before this port publishes its original route; never supply
  // an always-current admission. The separate actual Store case stays below.
  f.navigationFocus=null;
  f.store.openDocument=async(documentId,destination,surface,options={})=>{
    if(options.current&&!options.current()||options.focus&&!options.focus.current())return false;
    if(options.onOriginHandoff&&!options.onOriginHandoff())return false;
    f.opened.push({documentId,destination,surface});f.state.route=destination;f.state.documentId=documentId;
    f.navigationFocus=options.focus?{route:destination,focus:options.focus}:null;publish();
    return f.navigationGate?f.navigationGate.promise:true;
  };
  f.store.captureWorkspaceNavigationFocus=(route,expected)=>{
    const owner=f.navigationFocus;
    return owner&&owner.route===route&&(!expected||owner.focus===expected)?{focus:owner.focus,
      routeCurrent:()=>f.navigationFocus===owner&&f.state.route===route,
      current:()=>f.navigationFocus===owner&&f.state.route===route&&owner.focus.current()}:null;
  };
  f.store.outputRequirementCommand=async()=>assert.fail("No save, confirm, approve, grant, or generate");
  f.store.refreshEvents=async()=>assert.fail("A refused application cannot refresh authored state");
  const model=outputSnapshot("A");model.projectId="p";model.scope.actorUserId="owner";f.output=model;
  f.store.outputRequirements={retainedWrite:()=>null,resource:()=>({state:"ready",snapshot:f.output,error:null}),ensure:async()=>({state:"ready",snapshot:f.output,error:null})};
  f.preview=retainedReview("p","A","requirement-A");
  f.reply=async body=>body.action===refusalAt?Response.json({error,blockId:"requirement-A",status:"not-applied",message:"RAW_PRIVATE_BACKEND_MESSAGE"},{status:409})
    :body.action==="resume"?Response.json({status:"review",preview:f.preview}):assert.fail("Unexpected action "+body.action);
  f.store.guardedFetch=async(url,init)=>{assert.equal(url,"/api/context/apply","No analysis/provider route");const body=JSON.parse(init.body);f.state.requests.push({url,body});return f.reply(body);};
  f.block=f.store.projection.get().libraryBlocks.find(block=>block.id==="requirement-A");
  class HandoffPage extends ElementPort{render(){const content=html`<forma-context-intelligence .block=${this.fixture.block} surface="library"></forma-context-intelligence><forma-output-requirements .documentId=${this.fixture.output.documentId} .blockId=${"requirement-A"}></forma-output-requirements>`;return this.fixture.shellMain?html`<main id="main-content" tabindex="-1">${content}</main><button type="button" data-image-focus-outside>Another current action</button>`:content;}}
  f.renderer=new navigationPorts.RendererPort(f,{"forma-context-intelligence":ContextIntelligence,"forma-output-requirements":FormaOutputRequirements,"forma-output-requirement-card":FormaOutputRequirementCard});
  f.shell=new FormaShell();f.shell.tag="forma-shell";f.shell.attributes={};f.shell.isConnected=true;
  f.host=new HandoffPage();f.host.tag="handoff-page";f.host.attributes={};f.host.isConnected=true;f.host.parentElement=f.shell;
  documentPort.body.append(f.shell);
  // Existing selectorNavigationParent precedent: the complete actual Shell
  // is an admission parent, while this declared two-component unit subtree
  // alone is rendered. No production render/current/navigateFrom is replaced.
  f.tree=()=>fullPageTree(f);
  const raf=new Map();let rafId=0;
  t.mock.method(windowPort,"requestAnimationFrame",callback=>{
    const id=++rafId,deliver=()=>{raf.delete(id);return callback();};raf.set(id,deliver);f.frames.push(deliver);return id;
  });
  t.mock.method(windowPort,"cancelAnimationFrame",id=>{const callback=raf.get(id),index=f.frames.indexOf(callback);if(index>=0)f.frames.splice(index,1);raf.delete(id);});
  t.mock.method(documentPort,"querySelectorAll",selector=>f.renderer.query(null,selector));
  t.mock.method(documentPort,"querySelector",selector=>selector==="dialog[open]"&&f.otherDialog?{open:true}:f.renderer.query(null,selector)[0]??null);
  // Original trace observations are native bases installed BEFORE the shared
  // focus wrapper. Queries never replace or stack over that live wrapper.
  const collect=f.renderer.collect.bind(f.renderer);
  f.renderer.collect=(markup,owner)=>{const start=f.renderer.nodes.length;collect(markup,owner);
    for(const node of f.renderer.nodes.slice(start).filter(node=>node.tag==="button")){
      node.scrollIntoView=()=>f.trace.push("scroll:"+owner.snapshot?.requirementId);
      node.focus=()=>f.trace.push("native-focus:"+owner.snapshot?.requirementId+":"+node.textContent);
    }
  };
  const query=f.renderer.query.bind(f.renderer);
  f.renderer.query=(owner,selector)=>{
    if(selector===".output-requirement-header button"&&owner?.tag==="forma-output-requirement-card"){
      const header=owner.markup?.match(/<header class="output-requirement-header">([\s\S]*?)<\/header>/u)?.[1]??"";
      const handlers=[...header.matchAll(/<button\b([^>]*)>/gu)].map(([,raw])=>f.renderer.attrs(raw).handlers.click);
      return buttons(f,owner).filter(button=>handlers.includes(button.handlers.click)).map(button=>button.node).filter(Boolean);
    }return query(owner,selector);
  };
  f.native=installOutputNavigationFocusNative({after:cleanup=>nativeCleanups.push(cleanup)},f,navigationPorts);
  f.draw=()=>{
    navigationPorts.bindFixture(f);publish();
    const result=f.renderer.draw(f.host);f.context=f.renderer.component("forma-context-intelligence","requirement-A");
    f.card=[...f.renderer.instances.values()].map(record=>record.instance).find(instance=>instance.tag==="forma-output-requirement-card");
    if(f.card){f.card.getClientRects=()=>f.visibleCard?[{}]:[];if(!f.card.handoffFixtureReady){f.card.handoffFixtureReady=true;f.card.willUpdate(new Map([["snapshot",undefined]]));}buttons(f,f.card);}return result;
  };
  f.draw();f.contextButtons=()=>buttons(f,f.context);
  f.action=label=>{const button=f.contextButtons().find(value=>value.textContent===label);assert.ok(button,"Actual button "+label);return()=>button.handlers.click.call(f.context,{currentTarget:button.node,preventDefault(){},stopPropagation(){}});};
  f.click=async label=>{await f.action(label)();await f.flush();};
  f.begin=async()=>{
    // Phase4 readers/authors without generation capability inspect the same
    // retained review through the real free recovery entry.
    const inspect=f.contextButtons().some(button=>button.attributes["data-context-review-action"]==="inspect");
    await f.click(f.i18n.t(inspect?"context.controls.inspectReview":"context.intelligence.decompose"));await f.flush();
  };
  f.reject=async()=>{await f.begin();if(refusalAt==="apply"){await f.click(f.i18n.t("context.changes.confirm"));await f.flush();}};
  f.drain=async()=>{for(let count=0;f.frames.length&&count<32;count++){f.frames.shift()();await f.flush();}assert.equal(f.frames.length,0,"Bounded focus polling");};
  f.noWork=()=>{assert.equal(f.state.requests.some(request=>request.url!=="/api/context/apply"),false);assert.equal(f.trace.some(item=>/event:forma-output-(?:edit|review-plan|save|show-plan)/u.test(item)),false);};
  f.shell.connectedCallback();await f.drain();
  assert.ok(f.shell instanceof FormaShell);assert.strictEqual(f.context.closest("forma-shell"),f.shell);
  assert.ok(ElementPort.hasStoreIdentity(f.shell,f.store)&&ElementPort.hasStoreIdentity(f.context,f.store));
  assert.equal(f.shell.contains(f.context),true);assert.deepEqual(f.shell.querySelectorAll("forma-context-intelligence"),[f.context]);
  assert.equal(f.shell.querySelectorAll("forma-output-requirements").length,1);
  assert.equal(f.shell.querySelectorAll("forma-library").length,0,"explicit reduced unit composition, not a full Library/sibling-departure proof");
  assert.equal(f.frames.length,0);assert.equal(f.opened.length,0);assert.equal(f.patches.length,0);
  return f;
}

for(const locale of["en","fr","ar","ja"])test("Output handoff "+locale+": explicit click reaches the same native Edit button",async t=>{
  const f=await handoffFixture(t,{locale}),before=structuredClone(f.state.events),review=structuredClone(f.preview);await f.reject();
  assert.equal(f.opened.length,0);assert.equal(f.patches.length,0);assert.equal(f.frames.length,0);f.noWork();
  assert.equal(f.context.markup.includes(endpointError),false);assert.equal(f.context.markup.includes("RAW_PRIVATE_BACKEND_MESSAGE"),false);
  const label=f.i18n.t("output.requirement.edit");assert.notEqual(label,"output.requirement.edit");assert.ok(f.contextButtons().some(button=>button.textContent===label));
  assert.equal(f.contextButtons().some(button=>button.textContent===f.i18n.t("context.changes.preview")),false);
  const card=f.card;assert.ok(buttons(f,card).some(button=>button.textContent===label));
  await f.click(label);assert.deepEqual(f.opened,[{documentId:"A",destination:documentContextBlockRoute("A","Author-owned document","requirement-A"),surface:"library"}]);
  await f.drain();assert.equal(f.card,card);assert.deepEqual(f.patches,[{focusBlockId:"requirement-A"}]);assert.deepEqual(f.state.events,before);f.noWork();
  assert.ok(f.trace.includes("native-focus:requirement-A:"+label));assert.equal(f.context.markup.includes("<dialog"),false);
  assert.deepEqual(f.state.requests.map(request=>request.body.action),["resume","apply"]);assert.equal(f.state.requests[1].body.approvalHash,review.approvalHash);assert.equal(f.state.requests[1].body.previewId,review.previewId);assert.deepEqual(f.preview,review);
  const actualEdit=buttons(f,card).find(button=>button.textContent===label);actualEdit.handlers.click.call(card,{currentTarget:actualEdit.node});await f.flush();
  assert.ok(f.trace.includes("event:forma-output-edit"),"Only native human click opens the editor");assert.ok(card.markup.includes("output-requirement-form"));assert.deepEqual(f.state.events,before);
});
for(const change of["authorization","route","document","project","removed","locked","type","block-id","read-permission","author-permission","disconnected","new-review"])test("Output handoff stale "+change+": old control has no effect",async t=>{
  const f=await handoffFixture(t);await f.reject();const click=f.action(f.i18n.t("output.requirement.edit"));
  if(change==="authorization")f.state.authorization="another-actor";
  if(change==="route")f.state.route="/library";
  if(change==="document"){f.state.events.push({...f.state.events.at(-1),eventId:"document-B-created",sequence:f.state.events.length+1,type:"DocumentCreated",payload:{project_id:"p",document_id:"B",title:"Another current document"}});f.state.documentId="B";}
  if(change==="project"){const get=f.store.projection.get;f.store.projection.get=()=>({...get(),projectId:"another-project"});}
  if(["removed","locked","type"].includes(change)){const get=f.store.projection.get;f.store.projection.get=()=>({...get(),libraryBlocks:get().libraryBlocks.map(block=>({...block,...(change==="type"?{type:"direction"}:{[change]:true})}))});}
  if(change==="block-id")f.context.block={...f.block,id:"another-output"};
  if(change==="read-permission")f.state.canRead=false;
  if(change==="author-permission")f.state.author=false;
  if(change==="disconnected")f.context.isConnected=false;
  if(change==="new-review"){await f.click(f.i18n.t("action.cancel"));await f.begin();}
  const before=f.trace.slice();await click();await Promise.resolve();assert.deepEqual(f.opened,[]);assert.deepEqual(f.patches,[]);assert.deepEqual(f.trace,before);f.noWork();
});
for(const change of["authorization","route","new-review","new-dialog"])test("Output handoff delayed navigation "+change+": completion cannot focus or close newer work",async t=>{
  const f=await handoffFixture(t);await f.reject();f.navigationGate=deferred();await f.click(f.i18n.t("output.requirement.edit"));
  if(change==="authorization")f.state.authorization="new-authorization";
  if(change==="route")f.state.route="/library";
  if(change==="new-review")await f.begin();
  if(change==="new-dialog")f.otherDialog=true;
  const before=f.trace.slice();f.navigationGate.resolve(true);await f.flush();await f.drain();assert.deepEqual(f.patches,[]);assert.deepEqual(f.trace.filter(item=>/^(close:|native-focus:)/u.test(item)),before.filter(item=>/^(close:|native-focus:)/u.test(item)));if(change==="new-review")assert.ok(f.context.markup.includes("<dialog"));assert.equal(f.opened.length,1);f.noWork();
});
for(const change of["authorization","route","new-review"])test("Output handoff delayed refusal "+change+": stale response creates no handoff",async t=>{
  const f=await handoffFixture(t),gate=deferred(),reply=f.reply;await f.begin();f.reply=body=>body.action==="apply"?gate.promise:reply(body);await f.click(f.i18n.t("context.changes.confirm"));
  if(change==="authorization")f.state.authorization="another-actor";
  if(change==="route")f.state.route="/library";
  if(change==="new-review"){f.context.isConnected=false;f.renderer.instances.clear();f.draw();await f.begin();}
  gate.resolve(Response.json({error:endpointError,blockId:"requirement-A",status:"not-applied"},{status:409}));await f.flush();
  assert.equal(f.contextButtons().some(button=>button.textContent===f.i18n.t("output.requirement.edit")),false);assert.deepEqual(f.opened,[]);assert.deepEqual(f.patches,[]);f.noWork();
});
for(const change of["wrong-card-actor","wrong-card-document","wrong-card-project","wrong-card-id","read-only-card","hidden-card","other-button-only"])test("Output handoff native target "+change+": no wrong or non-edit focus",async t=>{
  const f=await handoffFixture(t);await f.reject();await f.click(f.i18n.t("output.requirement.edit"));const original=f.card.snapshot;
  if(change==="wrong-card-actor")f.card.snapshot={...original,scope:{...original.scope,authorizationScopeKey:"other"}};
  if(change==="wrong-card-document")f.card.snapshot={...original,scope:{...original.scope,documentId:"B"}};
  if(change==="wrong-card-project")f.card.snapshot={...original,scope:{...original.scope,projectId:"other"}};
  if(change==="wrong-card-id")f.card.snapshot={...original,requirementId:"another"};
  if(change==="read-only-card")f.card.readOnlyReason="No longer editable";
  if(change==="hidden-card")f.visibleCard=false;
  if(change==="other-button-only"){const query=f.card.querySelectorAll.bind(f.card);f.card.querySelectorAll=selector=>query(selector).filter(button=>button.textContent!==f.i18n.t("output.requirement.edit"));}
  // Hold this deliberately stale native snapshot; no production method substitution.
  for(let count=0;f.frames.length&&count<32;count++)f.frames.shift()();assert.equal(f.frames.length,0);
  assert.equal(f.trace.some(item=>item.startsWith("native-focus:")),false);f.noWork();
});
for(const error of["context_changes_unavailable","context_changes_source_protected","participant_reference_required"])test("Output handoff unrelated "+error+": generic recovery stays unchanged",async t=>{
  const f=await handoffFixture(t,{error});await f.reject();assert.equal(f.contextButtons().some(button=>button.textContent===f.i18n.t("output.requirement.edit")),false);
  assert.ok(f.contextButtons().some(button=>button.textContent===f.i18n.t("context.changes.preview")));assert.equal(f.context.markup.includes(error),false);assert.deepEqual(f.opened,[]);f.noWork();
});
for(const mismatch of["non-output","wrong-refusal-block","missing-refusal-block"])test("Output handoff "+mismatch+": error cannot redirect another source",async t=>{
  const f=await handoffFixture(t,{blockType:mismatch==="non-output"?"direction":"output"}),reply=f.reply;
  if(mismatch!=="non-output")f.reply=body=>body.action==="apply"?Response.json({error:endpointError,...(mismatch==="wrong-refusal-block"?{blockId:"another-output"}:{}),status:"not-applied"},{status:409}):reply(body);
  await f.reject();assert.equal(f.contextButtons().some(button=>button.textContent===f.i18n.t("output.requirement.edit")),false);assert.deepEqual(f.opened,[]);f.noWork();
});
test("Output handoff repeated click reuses one navigation and never opens the editor automatically",async t=>{
  const f=await handoffFixture(t);await f.reject();const click=f.action(f.i18n.t("output.requirement.edit"));await click();await click();await f.flush();await f.drain();assert.equal(f.opened.length,1);f.noWork();
});
test("Output handoff actual Store.openDocument retains the document identity with zero authored or paid writes",async t=>{
  const f=await handoffFixture(t),h=await createSceneStoreHost({count:1});t.after(()=>h.close());
  const source=h.store.events.get(),projectId=h.worker.projectId,documentId=h.worker.documentId;
  h.store.events.set([...source,{eventId:"in-memory-existing-output",streamId:h.worker.streamId,sequence:h.store.head.get()+1,actor:"user:"+h.worker.owner,correlationId:"fixture",occurredAt:"2026-08-27T00:00:00Z",type:"BlockCreated",payload:{project_id:projectId,document_id:documentId,block_id:"requirement-A",type:"output",handle:"output/existing",position:"z",properties:{text:"One owned image.",weight:1}}}]);
  f.store=h.store;f.host.store=h.store;f.context.store=h.store;f.shell.store=h.store;f.block=h.store.projection.get().libraryBlocks.find(block=>block.id==="requirement-A");f.context.block=f.block;
  f.preview=retainedReview(projectId,documentId,"requirement-A");f.output.projectId=projectId;f.output.documentId=documentId;
  h.store.outputRequirements.resource=()=>({state:"ready",snapshot:f.output,error:null});h.store.outputRequirements.ensure=async()=>h.store.outputRequirements.resource();
  const previous=Object.getOwnPropertyDescriptor(globalThis,"history");Object.defineProperty(globalThis,"history",{configurable:true,value:{pushState(_state,_title,route){const url=new URL(route,"http://localhost");Object.assign(h.location,{pathname:url.pathname,search:url.search,hash:url.hash});},replaceState(_state,_title,route){this.pushState(_state,_title,route);}}});t.after(()=>previous?Object.defineProperty(globalThis,"history",previous):delete globalThis.history);
  const open=h.store.openDocument.bind(h.store);t.mock.method(h.store,"openDocument",async(...args)=>{f.opened.push(args);return open(...args);});
  const patch=h.store.patchUi.bind(h.store);t.mock.method(h.store,"patchUi",value=>{f.patches.push(value);return patch(value);});
  t.mock.method(h.store,"guardedFetch",async(url,init)=>{assert.equal(url,"/api/context/apply");const body=JSON.parse(init.body);f.state.requests.push({url,body});return f.reply(body);});
  f.draw();await f.reject();const before=h.store.events.get().map(event=>event.eventId),counts=h.worker.counts(),requests=h.requests.length;
  await f.click(f.i18n.t("output.requirement.edit"));await untilScene(()=>f.frames.length>0);await f.drain();
  assert.equal(f.opened.length,1);assert.equal(h.store.route.get(),documentContextBlockRoute(documentId,h.store.projection.get().documentTitle,"requirement-A"));assert.equal(h.store.ui.focusBlockId,"requirement-A");
  assert.deepEqual(h.store.events.get().map(event=>event.eventId),before);assert.deepEqual(h.worker.counts(),counts);assert.equal(h.requests.length,requests);f.noWork();
});

async function suspendRefusedOutput(f,via){
 if(via==="collapse")f.context.suspendControls();
 else if(via==="escape"){
  const dialog=f.renderer.ownNodes(f.context,"dialog").find(node=>node.handlers.cancel);assert.ok(dialog);
  let prevented=false;dialog.handlers.cancel.call(f.context,{currentTarget:dialog,preventDefault(){prevented=true;}});assert.equal(prevented,true);
 }else{
  const close=f.contextButtons().find(button=>button.attributes["aria-label"]===f.i18n.t("action.close"));assert.ok(close);
  close.handlers.click.call(f.context,{currentTarget:close.node});
 }
 await f.flush();assert.equal(f.context.markup.includes("<dialog"),false,"the actual review is suspended");
}
for(const via of ["escape","close","collapse"])test("Phase4 suspended Output refusal retains its exact current handoff after "+via,async t=>{
 const f=await handoffFixture(t);await f.reject();
 const edit=f.i18n.t("output.requirement.edit"),oldClick=f.action(edit),requests=f.state.requests.length;
 await suspendRefusedOutput(f,via);await oldClick();assert.equal(f.opened.length,0,"closed controls cannot navigate");
 await f.begin();
 assert.ok(f.contextButtons().some(button=>button.textContent===edit),"same owned suspended review retains its exact explicit handoff");
 assert.equal(f.contextButtons().some(button=>button.textContent===f.i18n.t("context.changes.preview")),false);
 assert.equal(f.state.requests.length,requests,"reopening does not repeat resume or apply");
 await oldClick();assert.equal(f.opened.length,0,"the old rendered action is not revived when a new dialog opens");
 await f.click(edit);await f.drain();assert.equal(f.opened.length,1);assert.equal(f.patches.length,1);f.noWork();
});

for(const via of ["escape","close","collapse"])test("Phase4 late exact Output refusal stays owned while suspended by "+via,async t=>{
 const f=await handoffFixture(t),gate=deferred(),reply=f.reply;await f.begin();
 f.reply=body=>body.action==="apply"?gate.promise:reply(body);
 await f.click(f.i18n.t("context.changes.confirm"));await suspendRefusedOutput(f,via);
 const requests=f.state.requests.length;
 gate.resolve(Response.json({error:endpointError,blockId:"requirement-A",status:"not-applied"},{status:409}));await f.flush();
 assert.equal(f.context.markup.includes("<dialog"),false);assert.equal(f.opened.length,0);assert.equal(f.patches.length,0);
 await f.begin();const edit=f.i18n.t("output.requirement.edit");
 assert.ok(f.contextButtons().some(button=>button.textContent===edit),"the exact late refusal is retained without reopening the dialog");
 assert.equal(f.state.requests.length,requests);await f.click(edit);await f.drain();assert.equal(f.opened.length,1);f.noWork();
});
for(const change of ["authorization","route","project","removed","locked","type","read-permission","author-permission"])test("Phase4 suspended Output handoff never revives after "+change+" changes and returns",async t=>{
 const f=await handoffFixture(t);await f.reject();const edit=f.i18n.t("output.requirement.edit"),old=f.action(edit);await suspendRefusedOutput(f,"collapse");
 const authorization=f.state.authorization,route=f.state.route,get=f.store.projection.get,canRead=f.state.canRead,author=f.state.author;
 if(change==="authorization")f.state.authorization="new-authorization";
 if(change==="route")f.state.route="/library";
 if(change==="project")f.store.projection.get=()=>({...get(),projectId:"other-project"});
 if(["removed","locked","type"].includes(change))f.store.projection.get=()=>({...get(),libraryBlocks:get().libraryBlocks.map(block=>({...block,...(change==="type"?{type:"direction"}:{[change]:true})}))});
 if(change==="read-permission")f.state.canRead=false;
 if(change==="author-permission")f.state.author=false;
 await f.flush();
 f.state.authorization=authorization;f.state.route=route;f.store.projection.get=get;f.state.canRead=canRead;f.state.author=author;await f.flush();
 await f.begin();assert.equal(f.contextButtons().some(button=>button.textContent===edit),false,"restored authority does not recreate the old refusal");
 await old();await f.drain();assert.equal(f.opened.length,0);assert.equal(f.patches.length,0);f.noWork();
});
test("Phase4 explicit Cancel discards the Output handoff and starts a fresh saved-review check",async t=>{
 const f=await handoffFixture(t);await f.reject();const old=f.action(f.i18n.t("output.requirement.edit")),requests=f.state.requests.length;
 await f.click(f.i18n.t("action.cancel"));await f.begin();
 assert.equal(f.contextButtons().some(button=>button.textContent===f.i18n.t("output.requirement.edit")),false);
 assert.equal(f.state.requests.length,requests+1);assert.equal(f.state.requests.at(-1).body.action,"resume");
 await old();assert.equal(f.opened.length,0);f.noWork();
});

// Native Image integration: reuse the existing Output handoff fixture above.
// These finite ports assert ownership and receipts, not browser focus or saved-provider custody.
import * as imageNative from "./helpers/native-image-launcher-fixture.mjs";
const {NativeImageHost}=await loadActual("src/components/native-image-host.ts");
const imageStartupSlots=["component-load","document-sync","history","private-hydration","initial-visible-job-read"];

function nativeLauncherTemplate(env){
  const values=[...imageNative.templates(env.nativeHost?env.nativeHost.render(env.origin):env.f.shell.renderNativeImage(env.origin))].filter(value=>value.strings.join("").includes('class="native-image-launcher"'));
  assert.equal(values.length,1,"one actual Host-owned launcher template");return values[0];
}
function nativeRefs(template){return template.values.filter(value=>imageNative.isDirectiveResult(value)&&typeof value.values[0]==="function").map(value=>value.values[0]);}
function nativeDismiss(host){
  const handlers=[...imageNative.templates(host.renderStatus())].flatMap(template=>template.values.filter((_value,index)=>template.strings[index].endsWith("@click=")));
  assert.ok(handlers.length<=1,"the actual Host has at most one status acknowledgment");return handlers[0]??null;
}
function mountNativeLauncher(env){
  const template=nativeLauncherTemplate(env),refs=nativeRefs(template);
  assert.equal(refs.length,1);
  // Recommit the SAME native root. Giving I5 a replacement root intentionally
  // retires its opening, and is not a way to refresh this fixture's controls.
  const owner=env.mounted??={region:imageNative.plainElement("SECTION"),buttons:[0,1,2].map(()=>imageNative.plainElement("BUTTON"))};
  for(const button of owner.buttons)owner.region.children.add(button);
  refs[0](owner.region);
  const disabled=template.values.filter((_value,index)=>template.strings[index].endsWith("?disabled="));
  owner.buttons[0].disabled=disabled[0];owner.buttons[1].disabled=disabled[1];
  owner.clicks=template.values.filter((_value,index)=>template.strings[index].endsWith("@click="));assert.equal(owner.clicks.length,3);
  return owner;
}
function mountNativeImage(env){
  const owner=mountNativeLauncher(env),images=[...imageNative.templates(nativeLauncherTemplate(env))].filter(value=>value.strings.join("").includes("<img"));
  assert.equal(images.length,1,"one actual I3 image after the exact I1 match");
  const template=images[0],refs=nativeRefs(template);assert.equal(refs.length,4);
  const region=imageNative.plainElement("SECTION"),image=imageNative.plainElement("IMG"),status=imageNative.plainElement("P"),action=imageNative.plainElement("BUTTON");
  owner.region.children.add(region);for(const element of[image,status,action])region.children.add(element);
  [region,image,status,action].forEach((element,index)=>refs[index](element));
  const index=template.strings.findIndex(part=>part.endsWith("@click="));assert.notEqual(index,-1);
  return env.image={owner,region,image,status,action,refs,loaded:image.listener("load"),activate:template.values[index]};
}
async function nativeImageShellFixture(t,{actualStore=false,directHost=false,sameRouteFocus=false}={}){
  const fixtureCleanups=[];let env;
  t.after(async()=>{
    try{
      if(env){
        env.cleanupFailure.enabled=false;env.releasePending?.();env.startupGate.resolve();
        // Let the already-invoked navigation publish its commit/refusal before
        // deciding whether this fixture still owns an accepted startup.
        await new Promise(setImmediate);
        if(env.mode==="accept"&&env.commits.length)await env.waitForStartup("fixture joins admitted startup before native teardown");
        env.nativeHost?.disconnect();
      }
    }finally{for(const cleanup of fixtureCleanups)await cleanup();}
  });
  const f=await handoffFixture({mock:t.mock,after:cleanup=>fixtureCleanups.push(cleanup)},{shellMain:sameRouteFocus});env={f,origin:f.context,trace:[],submissions:[],reads:[],navigations:[],finishes:[],commits:[],present:true,
    sourceSubscribers:new Set(),viewSubscribers:new Set(),sourceDisposals:0,cleanupFailure:{enabled:false,reason:undefined},startupGate:deferred(),mode:"accept",navigationFailure:undefined};
  if(actualStore){
    const h=await createSceneStoreHost({count:1});env.actual=h;t.after(()=>h.close());
    env.priorStoreTimers=new Set(h.timers.keys());env.deliveredStoreFrames=[];
    const documentId=h.worker.documentId,projectId=h.worker.projectId,events=h.store.events.get();
    h.store.events.set([...events,{eventId:"native-image-existing-output",streamId:h.worker.streamId,sequence:h.store.head.get()+1,actor:"user:"+h.worker.owner,correlationId:"fixture",occurredAt:"2026-08-27T00:00:00Z",type:"BlockCreated",payload:{project_id:projectId,document_id:documentId,block_id:"requirement-A",type:"output",handle:"output/existing",position:"z",properties:{text:"One owned image.",weight:1}}}]);
    f.store=h.store;f.host.store=h.store;f.context.store=h.store;f.shell.store=h.store;
    f.block=h.store.projection.get().libraryBlocks.find(block=>block.id==="requirement-A");f.context.block=f.block;
    f.output.projectId=projectId;f.output.documentId=documentId;
    h.store.outputRequirements.resource=()=>({state:"ready",snapshot:f.output,error:null});h.store.outputRequirements.ensure=async()=>h.store.outputRequirements.resource();
    // The existing Store host has already supplied its real session/events.
    // The hidden document deliberately selects its existing passive policy.
    h.store.loading.set(false);
    if(sameRouteFocus)h.store.route.set(withDocumentInRoute("/",documentId,h.store.projection.get().documentTitle));
    const previous=Object.getOwnPropertyDescriptor(globalThis,"history");Object.defineProperty(globalThis,"history",{configurable:true,value:{pushState(_state,_title,route){const url=new URL(route,"http://localhost");Object.assign(h.location,{pathname:url.pathname,search:url.search,hash:url.hash});},replaceState(_state,_title,route){this.pushState(_state,_title,route);}}});
    t.after(()=>previous?Object.defineProperty(globalThis,"history",previous):delete globalThis.history);
    const priorCancel=Object.getOwnPropertyDescriptor(globalThis,"cancelAnimationFrame");Object.defineProperty(globalThis,"cancelAnimationFrame",{configurable:true,value:id=>h.window.clearTimeout(id)});
    t.after(()=>priorCancel?Object.defineProperty(globalThis,"cancelAnimationFrame",priorCancel):delete globalThis.cancelAnimationFrame);
    // Bridge only the two existing native Window ports. The real Store event,
    // including its exact commit receipt, reaches the real Shell listener.
    const dispatch=h.window.dispatchEvent.bind(h.window);
    t.mock.method(h.window,"dispatchEvent",event=>{
      if(event.type==="forma-route-changed"&&event.detail?.nativeImageStartup)env.commits.push({startup:event.detail.nativeImageStartup,receipt:event.detail.nativeImageCommit});
      const returned=dispatch(event);for(const listener of [...(f.listeners.get(event.type)??[])])listener(event);return returned;
    });
    f.draw();
    env.value=imageNative.evidence(documentId);
    Object.assign(env.value.setup,{documentRevision:h.store.documentGenerationRevision(),requestKey:h.store.documentGenerationRequestKey("generate",null,"prose")});
    Object.assign(env.value.job,env.value.setup);env.value.handle=imageNative.captureNativeImageHandle(env.value.job,env.value.setup);assert.ok(env.value.handle);
  }else{
    env.value=imageNative.evidence("A");
    f.store.captureNativeImageLifetime=setup=>{
      const source=f.store.captureSourceOwnership(),route=f.store.route.get();let active=true;
      return Object.freeze({current:()=>active&&f.store.sourceOwnershipActive(source)&&f.store.route.get()===route&&f.state.documentId===setup.documentId,
        subscribe(listener){env.sourceSubscribers.add(listener);return()=>{env.trace.push("source-unsubscribe");env.sourceSubscribers.delete(listener);if(env.cleanupFailure.enabled)throw env.cleanupFailure.reason;};},
        dispose(){env.trace.push("source-dispose");active=false;env.sourceDisposals++;}});
    };
    f.store.finishNativeImageStartup=(startup,reason)=>{env.finishes.push({startup,reason});};
  }
  env.presentation=Object.freeze({current:()=>env.present&&env.origin.isConnected&&f.shell.contains(env.origin),
    subscribe(listener){env.viewSubscribers.add(listener);return()=>{env.trace.push("view-unsubscribe");env.viewSubscribers.delete(listener);};}});
  env.waitForStartup=message=>untilScene(()=>{
    if(env.actual&&env.commits.length){
      assert.equal(env.commits.length,1,"this native Store fixture owns only destination A");
      const h=env.actual;assert.equal(h.store.route.get(),env.commits[0].receipt.path);
      // The Store helper's RAF is a manual delay16 native timer. Deliver only
      // new frames of this committed A; leave pre-existing/passive timers alone.
      const frames=[...h.timers].filter(([id,task])=>!env.priorStoreTimers.has(id)&&task.delay===16);
      for(const[id,task]of frames){
        const current=h.timers.get(id);
        // An earlier genuine frame may cancel a later captured frame. Never
        // deliver that canceled callback or silently consume a replacement.
        if(current!==task){assert.equal(current,undefined,"only an actually canceled frame may disappear");continue;}
        h.timers.delete(id);env.deliveredStoreFrames.push(id);task.callback();
      }
    }
    return env.available();
  },message);
  // Explicit generation/inspection ports: real I1/I2/I3/I5 and Host behavior,
  // but no paid dispatch or pretend saved provider output is exercised here.
  const submit=(setup,controls)=>{env.submissions.push({setup,controls});return Promise.resolve({disposition:"acknowledged",handle:env.value.handle,reused:false});};
  const inspect=(handle,controls)=>{env.reads.push({handle,controls});return Promise.resolve({status:"data",data:env.value.data});};
  if(actualStore){t.mock.method(f.store,"submitNativeImage",submit);t.mock.method(f.store,"inspectNativeImage",inspect);}
  else{f.store.submitNativeImage=submit;f.store.inspectNativeImage=inspect;}
  const open=f.store.openDocument.bind(f.store);
  t.mock.method(f.store,"openDocument",async(documentId,path,surface,options={})=>{
    if(surface!=="native-image")return open(documentId,path,surface,options);
    const call={documentId,path,surface,options};env.navigations.push(call);
    if(env.mode==="cancel")return false;
    if(env.mode==="throw")throw env.navigationFailure;
    const handoff=options.onOriginHandoff;
    const opened=await open(documentId,path,surface,{...options,onOriginHandoff:()=>{
      const accepted=handoff?.();env.trace.push("handoff:"+accepted);
      if(accepted)assert.equal(options.current(),true,"accepted destination survives synchronous source presentation retirement");
      return accepted;
    }});
    if(opened&&!actualStore){
      // This remains the declared mocked Store boundary, not route-write or
      // producer evidence. Only the separate actual Store test makes those claims.
      const startup=options.nativeImageStartup,receipt=Object.freeze({intent:startup.id,path});env.commits.push({startup,receipt});startup.commit(receipt);
      startup.start("component-load",()=>env.startupGate.promise);
      for(const slot of imageStartupSlots.slice(1))startup.unnecessary(slot,"finite-store-boundary");
      env.afterCommit?.(call);
    }
    return opened;
  });
  env.toasts=[];t.mock.method(f.store,"toast",(...args)=>{env.toasts.push(args);});
  if(directHost){
    const messages=Object.freeze({}),locale=Object.freeze({locale:"en",messages,direction:"ltr"});
    env.nativeHost=new NativeImageHost({store:()=>f.store,locale:()=>locale,text:(key,fallback)=>messages[key]??fallback,changed:()=>env.changed?.(),navigate:(...args)=>{assert.ok(env.navigate,"this direct Host fixture explicitly supplies its navigation port");return env.navigate(...args);}});
  }
  env.available=()=>env.nativeHost?env.nativeHost.available:f.shell.nativeImageAvailable;
  env.opening=env.nativeHost?env.nativeHost.open(env.origin,env.value.setup,env.presentation):f.shell.openNativeImage(env.origin,env.value.setup,env.presentation);assert.ok(env.opening,"the actual Host admits the current Image presentation");
  env.mounted=mountNativeLauncher(env);
  env.match=async()=>{
    const submissions=env.submissions.length,reads=env.reads.length;
    let mounted=mountNativeLauncher(env);assert.equal(mounted.buttons[0].disabled,false);mounted.clicks[0](imageNative.portEvent(mounted.buttons[0]));
    assert.equal(env.submissions.length,submissions+1);await untilScene(env.available,"original Create settlement owned by the Host");
    mounted=mountNativeLauncher(env);assert.equal(mounted.buttons[1].disabled,false);mounted.clicks[1](imageNative.portEvent(mounted.buttons[1]));
    assert.equal(env.reads.length,reads+1);await untilScene(env.available,"original Check settlement owned by the Host");
    const image=mountNativeImage(env);assert.equal(image.action.disabled,true);imageNative.loadPort(image);assert.equal(image.action.disabled,false);return image;
  };
  env.edit=()=>{assert.ok(env.image);if(env.actual&&env.navigations.length===0&&env.commits.length===0)env.priorStoreTimers=new Set(env.actual.timers.keys());env.image.activate(imageNative.portEvent(env.image.action));};
  return env;
}

test("Native Image Shell accepted same-Document Edit retires only its source while admitted startup remains owned",async t=>{
  const env=await nativeImageShellFixture(t);await env.match();const old=env.image.activate;env.edit();
  await untilScene(()=>env.commits.length===1,"the declared Store boundary returns its exact commit");
  const {startup,receipt}=env.commits[0];assert.strictEqual(receipt.intent,startup.id);assert.equal(receipt.path,env.navigations[0].path);
  assert.equal(env.navigations[0].documentId,"A");assert.equal(env.sourceDisposals,1);assert.equal(env.image.image.isConnected,false);
  assert.equal(env.f.shell.nativeImageAvailable,false,"pending original startup still occupies its custodian");
  env.present=false;env.f.shell.retireNativeImage(env.origin,env.presentation);old(imageNative.portEvent(env.image.action));
  assert.equal(env.navigations.length,1);assert.equal(env.finishes.length,0,"source retirement does not withdraw destination startup");
  env.startupGate.resolve();await untilScene(()=>env.f.shell.nativeImageAvailable,"original startup settlement releases its exact occupancy");
  assert.equal(env.f.store.route.get(),receipt.path);assert.equal(env.submissions.length,1);assert.equal(env.reads.length,1);assert.deepEqual(env.toasts,[]);
});

test("Native Image Shell committed A cannot overwrite synchronous navigation B when A startup settles",async t=>{
  const env=await nativeImageShellFixture(t);await env.match();const routeB=documentContextBlockRoute("B","Document B","");let reentry;
  env.afterCommit=()=>{reentry=env.f.shell.navigateFrom(env.origin,options=>env.f.store.openDocument("B",routeB,"fixture-reentry",options));};
  env.edit();await untilScene(()=>env.commits.length===1&&reentry!==undefined,"B entered during the original A navigation callback");
  assert.equal(await reentry,true);assert.equal(env.f.store.route.get(),routeB);assert.notEqual(env.commits[0].receipt.path,routeB);
  env.startupGate.resolve();await untilScene(()=>env.f.shell.nativeImageAvailable,"A's genuine original startup completes independently");
  assert.equal(env.f.store.route.get(),routeB);assert.equal(env.navigations.length,1);assert.equal(env.submissions.length,1);assert.equal(env.reads.length,1);assert.deepEqual(env.toasts,[]);
});


// Actual Shell lifecycle and actual Store startup event, inside the existing
// explicitly reduced unit subtree. The main and outside button are declared
// native focus ports; this does not certify a full Shell render or browser focus.
for(const withdrawal of ["current","focus-moved","source-owner-replaced"])test("Native Image Shell same accessible route focuses only its current startup / "+withdrawal,async t=>{
  const env=await nativeImageShellFixture(t,{actualStore:true,sameRouteFocus:true}),{f}=env,h=env.actual;
  const route=h.store.route.get();
  assert.equal(route,withDocumentInRoute("/",env.value.setup.documentId,h.store.projection.get().documentTitle));
  assert.equal(h.store.loading.get(),false);assert.equal(h.store.routeDataReady(),true);
  // Deliver the real public Lit lifecycle once before Edit. Its unchanged
  // route key must already exist; a first-ever route announcement is no proof.
  f.shell.updated();await f.shell.updateComplete;
  await env.match();
  // The existing I3 plainElement has no native focus IDL. Supply only its
  // inert base method; the shared native port records and owns the real call.
  env.image.action.focus=()=>{};
  f.native.focus(env.image.action);
  assert.equal(f.native.document.activeElement===env.image.action,true);
  const source=h.store.captureSourceOwnership();assert.ok(source&&h.store.sourceOwnershipActive(source));
  const beforeFocus=f.native.nativeFocus.length;
  env.edit();
  await untilScene(()=>env.commits.length===1,"real same-path Image startup dispatch reaches its owning Shell");
  assert.equal(env.commits[0].receipt.path,route);assert.equal(h.store.route.get(),route);
  assert.equal(env.image.image.isConnected,false,"the actual inline Image presentation retired at handoff");
  assert.equal(env.navigations.length,1);assert.equal(env.submissions.length,1);assert.equal(env.reads.length,1);
  let outside;
  if(withdrawal==="focus-moved"){
    outside=f.renderer.ownNodes(f.host,"button").find(node=>Object.hasOwn(node.attributes,"data-image-focus-outside"));
    assert.ok(outside?.isConnected);f.native.focus(outside);
  }else if(withdrawal==="source-owner-replaced"){
    const session=h.store.session.get();h.store.session.set({...session,permissionEpoch:"same-route-image-source-replaced"});
    assert.equal(h.store.sourceOwnershipActive(source),false,"the real Store source authorization owner changed");
  }
  const afterWithdrawal=f.native.nativeFocus.length;
  f.shell.updated();await f.shell.updateComplete;await Promise.resolve();
  const main=f.shell.querySelector("#main-content");assert.ok(main?.isConnected);
  if(withdrawal==="current"){
    const focused=f.native.nativeFocus.slice(beforeFocus);
    assert.equal(focused.length,1,"one owned startup request focuses its existing route destination");
    assert.equal(focused[0].node===main,true);assert.equal(f.native.document.activeElement===main,true);
    assert.deepEqual(focused[0].args,[{preventScroll:true}]);
  }else{
    assert.equal(f.native.nativeFocus.length,afterWithdrawal,"retired ownership cannot add a focus call");
    assert.equal(f.native.document.activeElement===main,false);
    if(outside)assert.equal(f.native.document.activeElement===outside,true);
  }
  f.shell.updated();await f.shell.updateComplete;await Promise.resolve();
  assert.equal(f.native.nativeFocus.length,withdrawal==="current"?beforeFocus+1:afterWithdrawal,"later same-key updates cannot renew a consumed or retired focus request");
});
