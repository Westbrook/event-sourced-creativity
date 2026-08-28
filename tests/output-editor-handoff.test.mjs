import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { html } from "lit";
import { snapshot as outputSnapshot, deferred } from "./output-ui-source-harness.mjs";
import { createSceneStoreHost, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { documentContextBlockRoute } from "../src/model/routes.ts";

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
const {fixture,loadActual,ElementPort,documentPort,windowPort}=await import("data:text/javascript;base64,"+Buffer.from(fixtureModule).toString("base64"));
Object.defineProperty(ElementPort.prototype,"ownerDocument",{get:()=>documentPort,configurable:true});
documentPort.addEventListener=(...args)=>windowPort.addEventListener(...args);
documentPort.removeEventListener=(...args)=>windowPort.removeEventListener(...args);
const {ContextIntelligence}=await loadActual("src/components/context-intelligence.ts");
const {FormaOutputRequirements}=await loadActual("src/components/forma-output-requirements.ts");
const {FormaOutputRequirementCard}=await loadActual("src/components/forma-output-requirement-card.ts");
const endpointError="output_requirement_endpoint_required";
const noProviders=t=>t.mock.method(globalThis,"fetch",async()=>assert.fail("No external API or provider is allowed"));
const plain=value=>String(value).replace(/<[^>]+>/gu,"").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&amp;","&").trim();
function buttons(f,owner){
  return [...(owner.markup??"").matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)].map(([,raw,text])=>{
    const value=f.renderer.attrs(raw),textContent=plain(text),node=f.renderer.ownNodes(owner,"button").find(candidate=>candidate.handlers.click===value.handlers.click&&candidate.attributes["aria-label"]===value.attributes["aria-label"]);
    if(node){node.textContent=textContent;node.disabled=Object.hasOwn(node.attributes,"disabled");node.getClientRects=()=>f.visibleCard?[{}]:[];
      node.scrollIntoView=()=>f.trace.push("scroll:"+owner.snapshot?.requirementId);node.focus=()=>f.trace.push("native-focus:"+owner.snapshot?.requirementId+":"+textContent);}
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
async function handoffFixture(t,{locale="en",error=endpointError,refusalAt="apply",blockType="output"}={}){
  noProviders(t);
  const f=fixture(t,{locale,facts:[{id:"requirement-A",type:blockType,text:"One owned image."}]});
  f.host.disconnectedCallback();f.trace.length=0;f.frames=[];f.opened=[];f.patches=[];f.visibleCard=true;f.otherDialog=false;f.navigationGate=null;
  f.state.route=documentContextBlockRoute("A","Author-owned document","");f.state.author=true;f.store.route={get:()=>f.state.route};
  const session=f.store.session.get;f.store.session.get=()=>({...session(),capabilities:[...(f.state.canRead?["project.read"]:[]),...(f.state.author?["project.author"]:[])]});
  f.store.patchUi=patch=>{f.patches.push(patch);Object.assign(f.store.ui,patch);};
  // This existing mocked Store port now carries the same transient focus owner.
  // The actual Store/full-page tests below exercise the production implementation.
  f.navigationFocus=null;
  f.store.openDocument=async(documentId,destination,surface,options={})=>{
    if(options.current&&!options.current()||options.focus&&!options.focus.current())return false;
    f.opened.push({documentId,destination,surface});f.state.route=destination;f.state.documentId=documentId;
    f.navigationFocus=options.focus?{route:destination,focus:options.focus}:null;
    return f.navigationGate?f.navigationGate.promise:true;
  };
  f.store.captureWorkspaceNavigationFocus=(route,expected)=>{
    const owner=f.navigationFocus;
    return owner&&owner.route===route&&(!expected||owner.focus===expected)?{focus:owner.focus,current:()=>f.navigationFocus===owner&&f.state.route===route&&owner.focus.current()}:null;
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
  class HandoffPage extends ElementPort{render(){return html`<forma-context-intelligence .block=${this.fixture.block} surface="library"></forma-context-intelligence><forma-output-requirements .documentId=${this.fixture.output.documentId} .blockId=${"requirement-A"}></forma-output-requirements>`;}}
  f.renderer.registry={"forma-context-intelligence":ContextIntelligence,"forma-output-requirements":FormaOutputRequirements,"forma-output-requirement-card":FormaOutputRequirementCard};
  f.host=new HandoffPage();f.host.isConnected=true;
  windowPort.requestAnimationFrame=callback=>{f.frames.push(callback);return f.frames.length;};
  documentPort.querySelectorAll=selector=>f.renderer.query(null,selector);
  documentPort.querySelector=selector=>selector==="dialog[open]"&&f.otherDialog?{open:true}:f.renderer.query(null,selector)[0]??null;
  const query=f.renderer.query.bind(f.renderer);
  f.renderer.query=(owner,selector)=>{
    if(selector===".output-requirement-header button"&&owner?.tag==="forma-output-requirement-card"){
      const header=owner.markup?.match(/<header class="output-requirement-header">([\s\S]*?)<\/header>/u)?.[1]??"";
      const handlers=[...header.matchAll(/<button\b([^>]*)>/gu)].map(([,raw])=>f.renderer.attrs(raw).handlers.click);
      return buttons(f,owner).filter(button=>handlers.includes(button.handlers.click)).map(button=>button.node).filter(Boolean);
    }return query(owner,selector);
  };
  const draw=f.draw;f.draw=()=>{
    const result=draw();f.context=f.renderer.component("forma-context-intelligence","requirement-A");
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
  f.store=h.store;f.host.store=h.store;f.context.store=h.store;f.block=h.store.projection.get().libraryBlocks.find(block=>block.id==="requirement-A");f.context.block=f.block;
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
