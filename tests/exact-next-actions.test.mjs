import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {creativeNextActions,creativeNextTargetAvailable,creativePreparationChoice,followCreativeNextTarget,requestedCreativeMedium} from "../src/model/workspace-intelligence.ts";
import {adaptiveRequestKey,adaptiveJobMatchesRequest} from "../src/model/adaptive-request.ts";
import {outputComparisonHistory} from "../src/model/output-comparison.ts";
import {foldEvents} from "../src/model/events.ts";
import {canvasDocumentTarget,documentJobMatchesSurface} from "../src/model/canvas-document-target.ts";
import {FORMA_NEXT_ACTION_MESSAGES} from "../src/components/design-system/locales/next-action-messages.ts";
const formats=["image","short_story","scene","slides","storyboard","video","audio"];
const block=(id="direction",properties={})=>({id,projectId:"p",documentId:"b",type:"direction",removed:false,scope:"document",canvasId:null,properties:{text:"A clear direction",weight:1,intent:"include",...properties},sourceEvents:["source-1"]});
const output=(id="image",extra={})=>({id,documentId:"b",canvasId:null,title:id,sequence:7,quality:"high",purpose:"final",discarded:false,promptFanId:null,provider:"test-provider",mediaUrl:`/api/media/${id}`,...extra});
const artifact=(id="deck",kind="slides",extra={})=>({id,documentId:"b",title:id,kind,sequence:8,...extra});
const job=(jobId="job",extra={})=>({jobId,documentId:"b",canvasId:null,kind:"render_document",sourceSurface:"document",status:"failed",requestedAt:"2026-08-27T01:00:00Z",dismissedAt:null,...extra});
const facts=(extra={})=>({projectId:"p",documentId:"b",canvasId:null,authorityKey:"actor:permission-1",canRead:true,canAuthor:true,canConfigure:true,blocks:[block()],outputs:[],artifacts:[],jobs:[],...extra});
const ports=(calls)=>Object.fromEntries(["context","configure","output","artifact","job","compare"].map((kind)=>[kind,(target)=>calls.push({kind,target})]));

test("exact next actions open each of the seven saved forms by identity without configuration or generation",async()=>{
  for(const format of formats){
    const state=facts(format==="image"?{outputs:[output("saved-image")]}:{artifacts:[artifact(`saved-${format}`,format)]}),action=creativeNextActions(state)[0],calls=[];
    assert.equal(action.id,"open-output");assert.equal(action.target.documentId,"b");
    assert.equal(await followCreativeNextTarget(action.target,()=>state,ports(calls)),true);
    assert.equal(calls.length,1);assert.equal(calls[0].kind,format==="image"?"output":"artifact");
    assert.equal(action.target.outputId??action.target.artifactId,`saved-${format}`);
  }
});

test("exact next actions prepare all seven explicit media without dispatch and leave ambiguous goals as a choice",async()=>{
  for(const format of formats){
    const state=facts({blocks:[block("format",{output_kind:format})]}),action=creativeNextActions(state)[0],calls=[];
    assert.equal(action.id,"configure-output");assert.equal(action.target.medium,format);
    assert.equal(await followCreativeNextTarget(action.target,()=>state,ports(calls)),true);assert.deepEqual(calls.map((call)=>call.kind),["configure"]);
  }
  const ambiguous=facts({blocks:[block("one",{output_kind:"slides"}),block("two",{output_kind:"video"})]});
  assert.equal(requestedCreativeMedium(ambiguous),null);assert.equal(creativeNextActions(ambiguous)[0].target.medium,null);
  assert.equal(requestedCreativeMedium(facts({blocks:[block("avoid",{output_kind:"audio",intent:"prohibit"})]})),null);
});

test("exact next actions prioritize existing nonimage work over optional failed siblings and remain useful to readers",async()=>{
  const state=facts({artifacts:[artifact()],jobs:[job("unavailable-audio",{result:{artifactKind:"audio"}})]});
  const actions=creativeNextActions(state);assert.equal(actions[0].target.artifactId,"deck");assert.ok(!actions.some((action)=>action.id==="read-draft"));
  const failed=actions.find((action)=>action.id==="inspect-job"),calls=[];assert.ok(failed);assert.equal(await followCreativeNextTarget(failed.target,()=>state,ports(calls)),true);assert.equal(calls[0].target.jobId,"unavailable-audio");
  const reader=creativeNextActions({...state,canAuthor:false,canConfigure:false});assert.equal(reader[0].target.artifactId,"deck");assert.ok(reader.every((action)=>!["context","configure"].includes(action.target.kind)));
  assert.deepEqual(creativeNextActions({...state,canRead:false}),[]);
});

test("exact next actions fail closed after source, target, permission, project, document or board changes",async()=>{
  const state=facts({artifacts:[artifact()],outputs:[output()]}),saved=creativeNextActions(state)[0],configure=creativeNextActions(state).find((action)=>action.id==="configure-output");
  for(const changed of [{authorityKey:"other"},{projectId:"other"},{documentId:"other"},{canvasId:"other"},{canRead:false},{artifacts:[]}]){
    const calls=[];assert.equal(await followCreativeNextTarget(saved.target,()=>({...state,...changed}),ports(calls)),false);assert.equal(calls.length,0);
  }
  assert.equal(creativeNextTargetAvailable(saved.target,{...state,artifacts:[artifact("deck","slides",{sequence:9})]}),false);
  assert.equal(creativeNextTargetAvailable(configure.target,{...state,blocks:[block("direction",{text:"Changed wording"})]}),false);
  assert.equal(creativeNextTargetAvailable(configure.target,{...state,canConfigure:false}),false);
});

test("exact next actions never alias another document or board job and preserve partial jobs as inspection",()=>{
  const state=facts({canvasId:"board-b",jobs:[job("wrong-document",{documentId:"a",canvasId:"board-b"}),job("wrong-board",{canvasId:"board-a"}),job("saved-partial",{canvasId:"board-b",sourceSurface:"canvas",status:"partial",result:{artifactKind:"storyboard",completedCount:5,itemCount:8}})]});
  const actions=creativeNextActions(state),inspect=actions.find((action)=>action.id==="inspect-job");
  assert.equal(inspect.target.jobId,"saved-partial");assert.equal(inspect.target.canvasId,"board-b");assert.ok(!actions.some((action)=>action.target.kind==="artifact"));
  assert.equal(creativeNextTargetAvailable({...inspect.target,jobId:"wrong-board"},state),false);
  assert.equal(creativeNextTargetAvailable({...inspect.target,jobId:"wrong-document"},state),false);
  assert.equal(creativeNextTargetAvailable(inspect.target,{...state,canvasId:"board-a"}),false);
});

test("exact next actions comparisons retain both selected IDs and never substitute a missing image or a fan member",()=>{
  const state=facts({outputs:[output("old",{sequence:2}),output("new",{sequence:4}),output("fan",{promptFanId:"fan",standalone:false,sequence:8})]});
  const compare=creativeNextActions(state).find((action)=>action.id==="compare-images");assert.deepEqual(compare.target.outputIds,["new","old"]);
  assert.equal(creativeNextTargetAvailable(compare.target,{...state,outputs:[output("new"),output("replacement")]}),false);
  assert.equal(creativeNextTargetAvailable({...compare.target,outputIds:["new","new"]},state),false);
});

test("exact next actions do not label simulated or missing image media as saved results",()=>{
  const state=facts({outputs:[output("simulated",{provider:"simulation"}),output("missing",{mediaUrl:null})]});
  assert.deepEqual(creativeNextActions(state).map((action)=>action.id),["configure-output"]);
});

test("exact Canvas destination follows one selected document, demands choices for ambiguity, and rejects stale choices",()=>{
  const projection={projectId:"p",documents:[{id:"a",projectId:"p"},{id:"b",projectId:"p"},{id:"foreign",projectId:"q"}],libraryOutputs:[output()],libraryArtifacts:[artifact()],libraryBlocks:[block()]};
  const canvas={projectId:"p",selectedCanvasId:"board",canvases:[{id:"board",projectId:"p"}],contextSets:[],items:[{id:"a-card",sourceKind:"document",sourceId:"a"},{id:"b-card",sourceKind:"document",sourceId:"b"}]};
  assert.equal(canvasDocumentTarget(projection,canvas,["b-card"]),"b");assert.equal(canvasDocumentTarget(projection,canvas,["a-card","b-card"]),"");assert.equal(canvasDocumentTarget(projection,canvas),"");
  assert.equal(canvasDocumentTarget(projection,canvas,[],"b"),"b");assert.equal(canvasDocumentTarget(projection,canvas,[],"gone"),"");assert.equal(canvasDocumentTarget(projection,canvas,[],"foreign"),"");
  assert.equal(canvasDocumentTarget(projection,{...canvas,items:[]}),"");assert.equal(canvasDocumentTarget(projection,{...canvas,projectId:"other"},["b-card"]),"");
  assert.equal(canvasDocumentTarget(projection,{...canvas,items:[{id:"image-card",sourceKind:"output",sourceId:"image"}]},["image-card"]),"b");
});

test("exact Canvas progress cannot mark a different board or the document adaptive surface as visible",()=>{
  const planning=job("planning-b",{kind:"structure_adaptive",canvasId:"board-b",sourceSurface:"canvas",status:"completed"});
  assert.equal(documentJobMatchesSurface(planning,{documentId:"b",canvasId:"board-b"}),true);
  for(const surface of [{documentId:"b",canvasId:"board-a"},{documentId:"a",canvasId:"board-b"},{documentId:"b",canvasId:null,documentView:"adaptive"}])assert.equal(documentJobMatchesSurface(planning,surface),false);
  assert.equal(documentJobMatchesSurface({...planning,canvasId:null},{documentId:"b",canvasId:"board-b"}),false);
});

test("exact next-action consumers share guarded dispatch and explicit four-language labels",()=>{
  for(const path of ["../src/components/forma-workspace.ts","../src/canvas/canvas-application.ts"]){const source=readFileSync(new URL(path,import.meta.url),"utf8");assert.match(source,/followCreativeNextTarget\(action.target/);assert.match(source,/nextActionFacts\(this.store/);assert.doesNotMatch(source,/action\.id==="(?:make-draft|refine-image|resume-intent)"/);}
  const assistant=readFileSync(new URL("../src/components/forma-creative-assistant.ts",import.meta.url),"utf8");assert.doesNotMatch(assistant,/surface\.canvasId \? projection\.documents\[0\]/);
  const keys=Object.keys(FORMA_NEXT_ACTION_MESSAGES.en);for(const locale of ["fr","ar","ja"])assert.deepEqual(Object.keys(FORMA_NEXT_ACTION_MESSAGES[locale]),keys);
});

test("format choice retains its original authority, document and source across a second click",async()=>{
  const original=facts(),target=creativeNextActions(original)[0].target;
  for(const change of [{documentId:"a"},{projectId:"q"},{authorityKey:"changed"},{blocks:[block("direction",{text:"New source"})]},{canConfigure:false}])assert.equal(creativePreparationChoice(target,"slides",{...original,...change}),null);
  assert.equal(creativePreparationChoice(target,"slides",original).documentId,"b");
  assert.equal(creativePreparationChoice(null,"slides",original),null);
  assert.equal(await followCreativeNextTarget(target,()=>original,{...ports([]),configure:()=>false}),false);
});

test("stale explicit Canvas selections never fall through to a different available document",()=>{
  const projection={projectId:"p",documents:[{id:"a",projectId:"p"},{id:"b",projectId:"p"}],libraryOutputs:[],libraryArtifacts:[],libraryBlocks:[]};
  const canvas={projectId:"p",selectedCanvasId:"board",canvases:[{id:"board",projectId:"p"}],contextSets:[],items:[{id:"a-card",sourceKind:"document",sourceId:"a"},{id:"b-card",sourceKind:"document",sourceId:"b"}]};
  const removedCard={...canvas,items:canvas.items.slice(0,1)},removedDocument={...projection,documents:projection.documents.slice(0,1)};
  assert.equal(canvasDocumentTarget(projection,removedCard,["b-card"],"a"),"");
  assert.equal(canvasDocumentTarget(removedDocument,canvas,["b-card"]),"");
  assert.equal(canvasDocumentTarget(removedDocument,canvas,["a-card","b-card"]),"");
  assert.equal(canvasDocumentTarget(projection,removedCard,[],"a"),"a");
});

test("adaptive request identity differentiates board, prompt and locale and validates before a returned job is adopted",async()=>{
  const request={projectId:"p",documentId:"b",canvasId:"board-b",sourceSurface:"canvas",projectScope:true,locale:"en",prompt:"A clear direction"};
  const key=await adaptiveRequestKey(request);
  assert.equal(await adaptiveRequestKey({...request,prompt:`  ${request.prompt} `}),key);
  for(const change of [{canvasId:"board-a"},{prompt:"Another direction"},{locale:"fr"},{projectScope:false},{documentId:"a"}])assert.notEqual(await adaptiveRequestKey({...request,...change}),key);
  const expected={...request,requestKey:key},accepted=job("exact",{kind:"structure_adaptive",canvasId:"board-b",sourceSurface:"canvas",requestKey:key});
  assert.equal(adaptiveJobMatchesRequest(accepted,expected),true);
  for(const change of [{canvasId:"board-a"},{requestKey:"forged"},{kind:"chat"},{documentId:"a"},{sourceSurface:"document"}])assert.equal(adaptiveJobMatchesRequest({...accepted,...change},expected),false);
  const source=readFileSync(new URL("../src/state/store.ts",import.meta.url),"utf8");assert.ok(source.indexOf("!adaptiveJobMatchesRequest(body.job")<source.indexOf("const jobs=[body.job"));
});

const comparisonEvents=(preview=false)=>[
  ["ProjectCreated",{project_id:"p",name:"Project"}],
  ["DocumentCreated",{project_id:"p",document_id:"a",title:"Unrelated"}],
  ["DocumentCreated",{project_id:"p",document_id:"b",title:"Compared"}],
  ["BlockCreated",{project_id:"p",document_id:"b",block_id:"color-b",type:"direction",properties:{text:"blue"}}],
  ["DocumentOpened",{project_id:"p",document_id:"a"}],
  [preview?"IdeationPreviewCompleted":"GenerationCompleted",{project_id:"p",document_id:"b",generation_id:"old-gen",object_id:"old",object_ids:["old"],provider:"test",media_url:"/api/media/old"}],
  ["BlockPropertyEdited",{project_id:"p",document_id:"b",block_id:"color-b",property_path:"text",old_value:"blue",new_value:"green"}],
  ["GenerationCompleted",{project_id:"p",document_id:"b",generation_id:"new-gen",object_ids:["new"],provider:"test",media_url:"/api/media/new"}],
].map(([type,payload],index)=>({eventId:`receipt-${index}`,streamId:"stream",sequence:index+1,type,payload,actor:"user",occurredAt:"2026-08-27T00:00:00Z"}));

test("comparison resolves exact full and preview receipts with interleaved document history and no fallback",()=>{
  for(const preview of [false,true]){
    const events=comparisonEvents(preview),outputs=foldEvents(events,Infinity,"b","p").outputs;
    const comparison=outputComparisonHistory([...events].reverse(),outputs,{projectId:"p",documentId:"b"});
    assert.equal(comparison.available,true);assert.equal(comparison.diff.length,1);assert.deepEqual(comparison.outputs.map((out)=>out.id),["old","new"]);
    assert.equal(comparison.diff[0].before.properties.text,"blue");assert.equal(comparison.diff[0].after.properties.text,"green");
    for(const bad of [events.filter((event)=>event.eventId!=="receipt-5"),[...events,events[5]],events.map((event)=>event.eventId==="receipt-5"?{...event,payload:{...event.payload,document_id:"a"}}:event)])assert.equal(outputComparisonHistory(bad,outputs,{projectId:"p",documentId:"b"}).available,false);
  }
});

test("comparison ties retain honest result labels and never claim identical provider inputs",()=>{
  const events=comparisonEvents();events[5].payload.object_ids=["old","twin"];const outputs=foldEvents(events,6,"b","p").outputs;
  const comparison=outputComparisonHistory(events,outputs,{projectId:"p",documentId:"b"});assert.equal(comparison.available,true);assert.equal(comparison.tied,true);assert.deepEqual(comparison.diff,[]);
  const source=readFileSync(new URL("../src/components/forma-workspace.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/isolates image-model variation|rightSeq - 3|before generating the current result/);
  assert.match(source,/documentId=\$\{p.documentId\}/);
  assert.match(source,/next-output-viewer/);assert.doesNotMatch(source,/output:\(target\)=>this.store.setRoute/);
  assert.match(source,/canAuthor&&canGenerate\?html`<section class="document-result-generation"/);
  const cards=readFileSync(new URL("../src/components/next-action-cards.css",import.meta.url),"utf8");assert.doesNotMatch(cards,/small\{display:none/);
});
