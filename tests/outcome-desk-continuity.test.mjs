import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { outcomeArrangementRevisions, previewOutcomeArrangement } from "../src/canvas/outcome-arrangements.ts";
import { OutcomeArrangementController, withOutcomeArrangementOperation } from "../src/state/outcome-desk-controller.ts";

const NOW = Date.parse("2026-08-27T10:00:00Z");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(setImmediate);
const until = async predicate => { for (let index=0;index<40;index++) { if (predicate()) return; await turn(); } assert.fail("Expected actual controller continuation did not settle"); };
const confirm = preview => ({ operationId:preview.operationId,previewId:preview.previewId,approvalHash:preview.approvalHash,confirmed:true });

async function fixture() {
  const event = (type,payload,index) => ({type,payload,eventId:"event-"+index,streamId:"fixture",sequence:index,actor:"user:actor-a",correlationId:"fixture",occurredAt:"2026-08-27T09:00:00Z"});
  const rows = [
    ["ProjectCreated",{project_id:"p",name:"In-memory controller race fixture"}],
    ["DocumentCreated",{project_id:"p",document_id:"doc",title:"Human source"}],
    ["BlockCreated",{project_id:"p",document_id:"doc",block_id:"direction",type:"direction",handle:"direction",position:"a",properties:{text:"Human draft stays canonical",authority:"authored"}}],
    ["CanvasCreated",{project_id:"p",canvas_id:"board",name:"Board",slug:"board"}],
    ["CanvasItemPlaced",{project_id:"p",canvas_id:"board",item_id:"card-a",source_kind:"document",source_id:"doc",frame:{x:10,y:20,w:330,h:220}}],
    ["CanvasItemPlaced",{project_id:"p",canvas_id:"board",item_id:"card-b",source_kind:"block",source_id:"direction",frame:{x:420,y:280,w:300,h:210}}],
  ];
  const events=rows.map(([type,payload],index)=>event(type,payload,index+1)), projection=foldEvents(events,Infinity,"doc","p"), canvas=foldCanvasEvents(events,"p","board",NOW);
  const revision=await outcomeArrangementRevisions(projection,canvas,["card-a","card-b"]);assert.equal(revision.ok,true);
  const f={epoch:"authority-a",actorId:"actor-a",stamp:0,contextCalls:0,refreshCalls:0,changes:0,ids:0,commands:[],remembered:[],receipts:new Map(),contextHook:null,postHook:null,refreshHook:null,changeHook:null,
    route:"/canvas/board/human-title?posture=outcomes&recipe=campaign#retained",scopeEnabled:true};
  f.scope=()=>f.scopeEnabled?{authorityKey:f.epoch,actorId:f.actorId,projectId:"p",canvasId:"board"}:null;
  f.current=()=>({canvas,events,authorityKey:f.epoch,actorId:f.actorId,siteId:f.actorId+":fixture",canRead:true,canArrange:true,atomicTransportAvailable:true,selectedItemIds:["card-a","card-b"],...revision.value});
  f.applied=preview=>({status:"applied",operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId,previewId:preview.previewId,approvalHash:preview.approvalHash,arrangementId:preview.arrangementId,requestHash:"d".repeat(64),providerCalls:0,maximumMicrousd:0,changesSemantics:false,itemCount:2,blockIds:[],relationCount:0});
  f.respond=async command=>{
    if(command.action==="preview"){
      const draft=previewOutcomeArrangement(f.current(),command);assert.equal(draft.ok,true);
      const preview={...draft.value.request,before:draft.value.before,after:draft.value.after,previewId:"preview-"+command.operationId,approvalHash:"a".repeat(64),arrangementId:"outcome-arrangement:"+"b".repeat(64),
        expiresAt:"2026-08-27T11:00:00Z",providerCalls:0,maximumMicrousd:0,maximumEvents:201,changesSemantics:false};
      f.receipts.set(command.operationId,preview);return {ok:true,status:200,body:{status:"review",preview}};
    }
    const preview=f.receipts.get(command.operationId);assert.ok(preview);
    if(command.action==="apply")return {ok:true,status:200,body:f.applied(preview)};
    if(command.action==="retrieve")return {ok:true,status:200,body:{status:"review",preview}};
    assert.equal(command.action,"dismiss");return {ok:true,status:200,body:{status:"dismissed",operationId:command.operationId,projectId:command.projectId,canvasId:command.canvasId}};
  };
  f.controller=new OutcomeArrangementController({
    scope:f.scope,stamp:()=>JSON.stringify([f.epoch,f.actorId,f.stamp]),
    context:async()=>{f.contextCalls++;return f.contextHook?f.contextHook():f.current();},
    post:async command=>{f.commands.push(command);return f.postHook?f.postHook(command):f.respond(command);},
    remember:identity=>{f.remembered.push({...identity});f.route=withOutcomeArrangementOperation(f.route,identity.operationId);},
    refresh:async()=>{f.refreshCalls++;if(f.refreshHook)return f.refreshHook();},
    changed:()=>{f.changes++;f.changeHook?.();},operationId:()=>"operation-"+(++f.ids),now:()=>NOW,
  });
  f.staleContext=async kind=>{
    f.stamp++;
    if(kind==="selection"){f.contextHook=async()=>null;return;}
    events.push(event("BlockPropertyEdited",{project_id:"p",document_id:"doc",block_id:"direction",property_path:"text",new_value:"A newly authored source revision"},events.length+1));
    const nextProjection=foldEvents(events,Infinity,"doc","p"),nextCanvas=foldCanvasEvents(events,"p","board",NOW);
    assert.equal(nextProjection.libraryBlocks.find(block=>block.id==="direction").properties.text,"A newly authored source revision");
    const nextRevision=await outcomeArrangementRevisions(nextProjection,nextCanvas,["card-a","card-b"]);assert.equal(nextRevision.ok,true);
    assert.notEqual(nextRevision.value.sourceRevision,revision.value.sourceRevision);
    f.contextHook=async()=>({...f.current(),canvas:nextCanvas,...nextRevision.value});
  };
  f.begin=name=>f.controller.start({recipeId:"campaign",name:name??"Human arrangement "+(f.ids+1)});
  f.assertUntouched=(snapshot)=>assert.deepEqual(f.controller.state,snapshot);
  return f;
}

test("late applied refresh failure cannot mark a newer same-scope review changed",async()=>{
  const f=await fixture();assert.equal(await f.begin(),true);const a=f.controller.state.preview,refresh=deferred();
  f.refreshHook=()=>refresh.promise;const apply=f.controller.apply(confirm(a));await until(()=>f.refreshCalls===1);
  assert.equal(f.controller.state.status,"applied");assert.equal(await f.begin("Second human arrangement"),true);
  const b=f.controller.state;refresh.reject(new Error("A refresh failed after B opened"));await apply;
  f.assertUntouched(b);assert.equal(f.controller.state.preview.operationId,"operation-2");
  f.refreshHook=null;assert.equal(await f.controller.apply(confirm(b.preview)),true);
  assert.equal(f.commands.filter(command=>command.action==="apply"&&command.operationId===a.operationId).length,1);
});

test("late applied refresh catch cannot release the busy state of a newer retrieval",async()=>{
  const f=await fixture();await f.begin();const preview=f.controller.state.preview,refresh=deferred(),read=deferred();
  f.refreshHook=()=>refresh.promise;const apply=f.controller.apply(confirm(preview));await until(()=>f.refreshCalls===1);
  f.postHook=command=>command.action==="retrieve"?read.promise:f.respond(command);
  const retrieve=f.controller.retrieve();await until(()=>f.commands.at(-1)?.action==="retrieve");
  const current=f.controller.state;assert.equal(current.busy,true);
  refresh.reject(new Error("Earlier refresh failure"));await apply;f.assertUntouched(current);
  read.resolve({ok:true,status:200,body:f.applied(preview)});f.refreshHook=null;await retrieve;
});

test("old revalidation cannot clear the exact review belonging to a new operation",async()=>{
  const f=await fixture();await f.begin();const gate=deferred();
  f.contextHook=()=>gate.promise;const old=f.controller.revalidate();
  await f.controller.dismiss();f.contextHook=null;assert.equal(await f.begin("New human arrangement"),true);
  const newer=f.controller.state;gate.resolve(f.current());assert.equal(await old,false);
  f.assertUntouched(newer);assert.equal(await f.controller.apply(confirm(newer.preview)),true);
});

test("a stale validation finally cannot clear a newer in-flight check for the same preview",async()=>{
  const f=await fixture();await f.begin();const older=deferred(),newer=deferred();
  f.contextHook=()=>older.promise;const first=f.controller.revalidate();
  f.stamp++;f.contextHook=()=>newer.promise;const second=f.controller.revalidate(),calls=f.contextCalls;
  older.resolve(f.current());assert.equal(await first,false);
  const duplicate=f.controller.revalidate();
  assert.equal(f.contextCalls,calls,"one check per current owner and stamp; old finally must not erase it");
  newer.resolve(f.current());assert.equal(await second,true);assert.equal(await duplicate,false);
});

test("current revalidation failures fail closed without an unhandled rejected promise",async()=>{
  const f=await fixture();await f.begin();f.contextHook=()=>Promise.reject(new Error("Local context unavailable"));
  assert.equal(await f.controller.revalidate(),false);assert.equal(f.controller.state.issue,"unavailable");
  assert.equal(await f.controller.apply(confirm(f.controller.state.preview)),false);
  assert.equal(f.commands.filter(command=>command.action==="apply").length,0);
});

test("a late failed Apply preflight cannot overwrite the newer operation after Cancel",async()=>{
  const f=await fixture();await f.begin();const a=f.controller.state.preview,gate=deferred();
  f.contextHook=()=>gate.promise;const old=f.controller.apply(confirm(a));
  assert.equal(await f.controller.dismiss(),true);f.contextHook=null;assert.equal(await f.begin("New intent"),true);
  const newer=f.controller.state;gate.reject(new Error("A context no longer available"));assert.equal(await old,false);
  f.assertUntouched(newer);assert.equal(f.commands.filter(command=>command.action==="apply").length,0);
});

test("a late successful Apply preflight cannot send the old confirmation after Cancel",async()=>{
  const f=await fixture();await f.begin();const a=f.controller.state.preview,gate=deferred();
  f.contextHook=()=>gate.promise;const old=f.controller.apply(confirm(a));
  assert.equal(await f.controller.dismiss(),true);f.contextHook=null;await f.begin("New intent");
  const newer=f.controller.state;gate.resolve(f.current());assert.equal(await old,false);f.assertUntouched(newer);
  assert.equal(f.commands.filter(command=>command.action==="apply").length,0);
});

for(const failure of ["applying","response-lost"])for(const next of ["apply","dismiss"])test("server-proven exact review after "+failure+" permits only a new human "+next+" on the same receipt",async()=>{
  const f=await fixture();await f.begin();const preview=f.controller.state.preview;
  f.postHook=command=>{if(command.action!=="apply")return f.respond(command);if(failure==="response-lost")throw new Error("Lost response");return {ok:true,status:202,body:{status:"applying",operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId}};};
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(f.controller.state.submitted,true);
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(await f.controller.dismiss(),false);assert.equal(await f.begin(),false);
  assert.equal(await f.controller.retrieve(),true);
  assert.equal(f.controller.state.submitted,false,"authoritative matching review is proof of no committed group, not active work");
  assert.equal(f.controller.state.issue,null);assert.equal(f.controller.state.preview.previewId,preview.previewId);
  assert.equal(f.commands.filter(command=>command.action==="apply").length,1,"retrieval never automatically applies");
  f.postHook=null;
  assert.equal(await (next==="apply"?f.controller.apply(confirm(preview)):f.controller.dismiss()),true);
  assert.equal(f.ids,1);assert.ok(f.commands.every(command=>command.operationId===preview.operationId));
});

test("malformed or substituted server reviews never unlock a submitted intent or replace its receipt",async()=>{
  for(const mutate of [
    p=>({...p,previewId:"other-preview"}),p=>({...p,approvalHash:"f".repeat(64)}),p=>({...p,arrangementId:"outcome-arrangement:"+"c".repeat(64)}),
    p=>({...p,operationId:"other-operation"}),p=>({...p,projectId:"other-project"}),p=>({...p,expectedSourceRevision:"sha256:"+"f".repeat(64)}),
    p=>({...p,name:"Substituted authored name"}),p=>({...p,selectedItemIds:[...p.selectedItemIds].reverse()}),
    p=>({...p,after:p.after.map((frame,index)=>index?frame:{...frame,x:frame.x+10})}),p=>({...p,providerCalls:1}),
    p=>({...p,maximumMicrousd:1}),p=>({...p,maximumEvents:202}),p=>({...p,changesSemantics:true}),p=>({...p,expiresAt:"invalid"}),
  ]){
    const f=await fixture();await f.begin();const original=f.controller.state.preview;
    f.postHook=command=>command.action==="apply"?Promise.reject(new Error("Uncertain")):{ok:true,status:200,body:{status:"review",preview:mutate(original)}};
    await f.controller.apply(confirm(original));await f.controller.retrieve();
    assert.equal(f.controller.state.submitted,true);assert.deepEqual(f.controller.state.preview,original);
    assert.equal(await f.controller.apply(confirm(original)),false);assert.equal(await f.controller.dismiss(),false);
    assert.equal(f.commands.filter(command=>command.action==="apply").length,1);assert.equal(f.ids,1);
  }
});

test("an already proven applied receipt cannot regress to review while its earlier refresh is pending",async()=>{
  const f=await fixture();await f.begin();const preview=f.controller.state.preview,refresh=deferred();
  f.refreshHook=()=>refresh.promise;const apply=f.controller.apply(confirm(preview));await until(()=>f.refreshCalls===1);
  await f.controller.retrieve();assert.equal(f.controller.state.status,"applied");assert.equal(f.controller.state.submitted,true);
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(await f.controller.dismiss(),false);
  refresh.resolve();await apply;assert.equal(f.commands.filter(command=>command.action==="apply").length,1);
});

test("a current applying response and HTTP uncertainty remain retrieval-only",async()=>{
  const f=await fixture();await f.begin();const preview=f.controller.state.preview;
  f.postHook=command=>({ok:true,status:202,body:{status:"applying",operationId:command.operationId,projectId:command.projectId,canvasId:command.canvasId}});
  await f.controller.apply(confirm(preview));await f.controller.retrieve();
  assert.equal(f.controller.state.submitted,true);assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(await f.controller.dismiss(),false);
  assert.equal(await f.begin(),false);assert.equal(f.ids,1);assert.equal(f.commands.filter(command=>command.action==="apply").length,1);
  f.postHook=()=>Promise.reject(new Error("Read unavailable"));await f.controller.retrieve();
  assert.equal(f.controller.state.status,"uncertain");assert.equal(f.controller.state.submitted,true);
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(await f.controller.dismiss(),false);
});

test("late preview arrival under a different authority conceals source and preserves the original handle",async()=>{
  const f=await fixture(),post=deferred();f.postHook=()=>post.promise;const pending=f.begin("Private original name");
  await until(()=>f.commands.length===1);const command=f.commands[0],route=f.route;
  f.epoch="authority-b";f.actorId="actor-b";const response=await f.respond(command);post.resolve(response);
  assert.equal(await pending,false);assert.equal(f.controller.state.preview,null);assert.equal(f.controller.state.status,"unavailable");
  assert.equal(f.route,route);assert.equal(f.remembered.length,1);assert.equal(f.commands.length,1);
});

test("authority change during the initial context read allocates and posts no operation",async()=>{
  const f=await fixture(),context=deferred();f.contextHook=()=>context.promise;const pending=f.begin();
  f.epoch="authority-b";f.actorId="actor-b";context.resolve(f.current());assert.equal(await pending,false);
  assert.equal(f.ids,0);assert.equal(f.commands.length,0);assert.equal(f.remembered.length,0);
  f.contextHook=null;assert.equal(await f.begin("Current actor"),true);
});


for(const change of ["source","selection"])test("authenticated identical no-commit review permits human Cancel but not stale "+change+" Apply",async()=>{
  const f=await fixture();await f.begin();const original=f.controller.state.preview;
  f.postHook=command=>command.action==="apply"?Promise.reject(new Error("Apply response lost")):f.respond(command);
  await f.controller.apply(confirm(original));assert.equal(f.controller.state.submitted,true);await f.staleContext(change);
  assert.equal(await f.controller.retrieve(),true);assert.equal(f.controller.state.submitted,false);
  assert.deepEqual(f.controller.state.preview,original);assert.equal(f.controller.state.issue,"changed");
  assert.equal(await f.controller.apply(confirm(original)),false);assert.equal(f.commands.filter(command=>command.action==="apply").length,1);
  assert.equal(await f.controller.dismiss(),true);assert.equal(f.commands.at(-1).previewId,original.previewId);assert.equal(f.commands.at(-1).approvalHash,original.approvalHash);
  assert.equal(f.ids,1);assert.equal(f.commands.filter(command=>command.action==="dismiss").length,1);
});

test("a regressed retrieval cannot release a new pending human Apply after verified lease recovery",async()=>{
  const f=await fixture();await f.begin();const preview=f.controller.state.preview;
  f.postHook=command=>command.action==="apply"?{ok:true,status:202,body:{status:"applying",operationId:command.operationId,projectId:command.projectId,canvasId:command.canvasId}}:f.respond(command);
  await f.controller.apply(confirm(preview));let newer;
  f.changeHook=()=>{if(f.controller.state.status==="review"&&!f.controller.state.submitted&&!f.controller.state.busy){f.changeHook=null;newer=f.controller.apply(confirm(preview));}};
  const old=f.controller.retrieve();await until(()=>Boolean(newer));await newer;await old;
  assert.equal(f.controller.state.status,"applying");assert.equal(f.controller.state.submitted,true);
  assert.equal(f.commands.filter(command=>command.action==="apply").length,2,"one original and one new explicit human confirmation only");
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(await f.controller.dismiss(),false);
});

test("an outer response catch cannot release a newer preflight started by the actual publication callback",async()=>{
  const f=await fixture();await f.begin();const preview=f.controller.state.preview,gate=deferred();let next;
  f.changeHook=()=>{if(f.controller.state.status==="applied"){f.changeHook=null;f.contextHook=()=>gate.promise;next=f.begin("Newer explicit human request");throw new Error("Injected view publication failure after B began");}};
  await f.controller.apply(confirm(preview));assert.ok(next);assert.equal(f.controller.state.busy,true);assert.equal(f.controller.state.status,"applied");
  f.contextHook=null;gate.resolve(f.current());assert.equal(await next,true);assert.equal(f.controller.state.preview.operationId,"operation-2");
});

test("retrieving a different operation cannot inherit another operation's proven applied state",async()=>{
  const f=await fixture();await f.begin();const first=f.controller.state.preview;await f.controller.apply(confirm(first));
  const response=await f.respond({...first,operationId:"operation-other",action:"preview",name:"Different existing human request"});
  const gate=deferred();f.postHook=()=>gate.promise;
  const current=f.controller.retrieve({operationId:"operation-other",projectId:"p",canvasId:"board"});
  assert.equal(f.controller.state.status,"uncertain");assert.equal(f.controller.state.submitted,false);assert.equal(f.controller.state.preview,null);
  gate.resolve(response);assert.equal(await current,true);assert.equal(f.controller.state.preview.operationId,"operation-other");
  assert.equal(f.ids,1,"reading another exact handle must not allocate a local replacement");
});

test("scope replacement at a publication boundary prevents transport without leaving busy stuck",async()=>{
  const f=await fixture();f.changeHook=()=>{if(f.controller.state.status==="requesting"){f.changeHook=null;f.epoch="authority-b";}};
  assert.equal(await f.begin(),false);assert.equal(f.commands.length,0);assert.equal(f.controller.state.busy,false);assert.equal(f.controller.state.preview,null);
  assert.equal(f.remembered.length,1,"keep the allocated opaque recovery handle; do not create another operation");
});


// Phase7 R4: renewed read authority recovers the same free atomic intent only.
async function lostArrangement(mode="lost"){
  const f=await fixture();assert.equal(await f.begin("Original private arrangement"),true);const preview=f.controller.state.preview;
  f.postHook=command=>{
    if(command.action!=="apply")return f.respond(command);
    if(mode==="lost")throw new Error("Injected lost HTTP response; no canonical commit inferred");
    return{ok:true,status:202,body:{status:"applying",operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId}};
  };
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(f.controller.state.submitted,true);assert.equal(f.controller.state.busy,false);
  f.postHook=null;return{f,preview};
}
for(const mode of ["lost","applying"])for(const reader of [false,true])test("R4 renewed "+(reader?"reader":"author")+" can retrieve and Cancel the original "+mode+" intent",async()=>{
  const{f,preview}=await lostArrangement(mode),route=f.route;f.epoch="current-renewed-epoch";
  if(reader)f.contextHook=async()=>({...f.current(),canArrange:false});
  assert.equal(f.controller.state.preview,null);assert.equal(await f.controller.retrieve(),true);
  assert.equal(f.controller.state.submitted,false);assert.deepEqual(f.controller.state.preview,preview);
  assert.equal(f.controller.state.issue,reader?"unavailable":null);
  if(reader)assert.equal(await f.controller.apply(confirm(preview)),false);
  assert.equal(await f.controller.dismiss(),true);
  assert.deepEqual(f.commands.filter(command=>command.action==="retrieve").map(command=>[command.operationId,command.projectId,command.canvasId]),[[preview.operationId,preview.projectId,preview.canvasId]]);
  assert.equal(f.commands.filter(command=>command.action==="apply").length,1);assert.equal(f.commands.at(-1).previewId,preview.previewId);assert.equal(f.commands.at(-1).approvalHash,preview.approvalHash);
  assert.equal(f.ids,1);assert.equal(f.route,route);
});

test("R4 failed renewed retrieval hides old private data and preserves uncertainty through an explicit same-ID retry",async()=>{
  const{f,preview}=await lostArrangement(),read=deferred(),route=f.route;f.epoch="renewed-reader";f.contextHook=async()=>({...f.current(),canArrange:false});
  f.postHook=command=>command.action==="retrieve"?read.promise:f.respond(command);
  const pending=f.controller.retrieve();await until(()=>f.commands.at(-1)?.action==="retrieve");
  assert.equal(f.controller.state.preview,null);assert.equal(f.controller.state.submitted,true);assert.equal(f.controller.state.busy,true);
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(await f.controller.dismiss(),false);assert.equal(await f.controller.retrieve(),false);
  assert.equal(JSON.stringify(f.controller.state).includes(preview.name),false);
  read.reject(new Error("Renewed read HTTP unavailable"));assert.equal(await pending,false);
  assert.equal(f.controller.state.preview,null);assert.equal(f.controller.state.status,"uncertain");assert.equal(f.controller.state.submitted,true);
  assert.equal(await f.begin("Must not replace unresolved intent"),false);assert.equal(f.route,route);assert.equal(f.ids,1);
  f.postHook=null;assert.equal(await f.controller.retrieve(),true);assert.equal(await f.controller.dismiss(),true);
  assert.equal(f.commands.filter(command=>command.action==="retrieve").length,2);assert.equal(f.commands.filter(command=>command.action==="apply").length,1);
});

test("R4 malformed renewed review cannot erase the original receipt fingerprint or unlock Cancel",async()=>{
  const{f,preview}=await lostArrangement(),route=f.route;f.epoch="renewed-reader";f.contextHook=async()=>({...f.current(),canArrange:false});
  const mutations=[
    p=>({...p,operationId:"substitute-operation"}),p=>({...p,projectId:"substitute-project"}),p=>({...p,canvasId:"substitute-board"}),
    p=>({...p,previewId:"substitute-preview"}),p=>({...p,approvalHash:"f".repeat(64)}),p=>({...p,arrangementId:"outcome-arrangement:"+"c".repeat(64)}),
    p=>({...p,name:"Private name substituted by stale response"}),p=>({...p,recipeId:"film-continuity"}),p=>({...p,expectedSourceRevision:"sha256:"+"f".repeat(64)}),
    p=>({...p,expectedLayoutRevision:"sha256:"+"e".repeat(64)}),p=>({...p,selectedItemIds:[...p.selectedItemIds].reverse()}),
    p=>({...p,before:p.before.map((frame,index)=>index?frame:{...frame,x:frame.x+10})}),
    p=>({...p,after:p.after.map((frame,index)=>index?frame:{...frame,y:frame.y+20})}),
    p=>({...p,maximumMicrousd:1}),p=>({...p,providerCalls:1}),p=>({...p,changesSemantics:true}),p=>({...p,expiresAt:"not-a-date"}),
  ];
  for(const mutate of mutations){
    f.postHook=async command=>{assert.equal(command.action,"retrieve");return{ok:true,status:200,body:{status:"review",preview:mutate(preview)}};};
    assert.equal(await f.controller.retrieve(),false);assert.equal(f.controller.state.preview,null);assert.equal(f.controller.state.submitted,true);
    assert.equal(await f.controller.dismiss(),false);assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(f.route,route);assert.equal(f.ids,1);
  }
  f.postHook=null;assert.equal(await f.controller.retrieve(),true);assert.deepEqual(f.controller.state.preview,preview);assert.equal(await f.controller.dismiss(),true);
  assert.equal(f.commands.filter(command=>command.action==="apply").length,1);assert.equal(f.commands.filter(command=>command.action==="preview").length,1);
});

test("R4 wrong actor, active board, project, operation and absent read scope cannot request another recovery",async()=>{
  for(const change of [
    (f,p)=>{f.epoch="different-actor-epoch";f.actorId="different-actor";return p;},
    (f,p)=>{f.actorId="different-actor";return p;},
    (f,p)=>{f.controller.ports.scope=()=>({authorityKey:f.epoch,actorId:f.actorId,projectId:"p",canvasId:"other-board"});return p;},
    (_f,p)=>({...p,canvasId:"other-board"}),(_f,p)=>({...p,projectId:"other-project"}),(_f,p)=>({...p,operationId:"other-operation"}),
    (f,p)=>{f.scopeEnabled=false;return p;},
  ]){
    const{f,preview}=await lostArrangement(),before=f.commands.length,route=f.route;
    const target=change(f,{operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId});
    assert.equal(await f.controller.retrieve(target),false);assert.equal(f.commands.length,before);assert.equal(f.controller.state.submitted,true);
    assert.equal(f.route,route);assert.equal(f.ids,1);
  }
});

test("R4 renewed authority waits for an active HTTP request, then retrieves without a second Apply",async()=>{
  const f=await fixture();await f.begin();const preview=f.controller.state.preview,post=deferred();
  f.postHook=command=>command.action==="apply"?post.promise:f.respond(command);
  const applying=f.controller.apply(confirm(preview));await until(()=>f.commands.at(-1)?.action==="apply");
  f.epoch="renewed-during-HTTP";f.contextHook=async()=>({...f.current(),canArrange:false});
  assert.equal(await f.controller.retrieve(),false);assert.equal(f.controller.state.busy,true);
  post.reject(new Error("Original HTTP resolved with uncertainty"));await applying;assert.equal(f.controller.state.busy,false);
  assert.equal(await f.controller.retrieve(),true);assert.equal(await f.controller.dismiss(),true);
  assert.equal(f.commands.filter(command=>command.action==="retrieve").length,1);assert.equal(f.commands.filter(command=>command.action==="apply").length,1);assert.equal(f.ids,1);
});

test("R4 applying and failed reads across repeated epochs remain read-only until exact review is authenticated",async()=>{
  const{f,preview}=await lostArrangement();f.epoch="renewed-1";f.contextHook=async()=>({...f.current(),canArrange:false});
  f.postHook=command=>({ok:true,status:202,body:{status:"applying",operationId:command.operationId,projectId:command.projectId,canvasId:command.canvasId}});
  assert.equal(await f.controller.retrieve(),false);assert.equal(f.controller.state.status,"applying");assert.equal(f.controller.state.submitted,true);assert.equal(f.controller.state.preview,null);
  assert.equal(await f.controller.dismiss(),false);assert.equal(await f.controller.apply(confirm(preview)),false);
  f.epoch="renewed-2";f.postHook=async()=>({ok:false,status:403,body:{error:"Current server read grant unavailable"}});
  assert.equal(await f.controller.retrieve(),false);assert.equal(f.controller.state.submitted,true);assert.equal(f.controller.state.preview,null);
  f.epoch="renewed-3";f.postHook=null;assert.equal(await f.controller.retrieve(),true);assert.equal(await f.controller.dismiss(),true);
  assert.equal(f.commands.filter(command=>command.action==="apply").length,1);assert.equal(f.ids,1);
});

for(const changed of ["source","selection"])test("R4 renewed current author can Cancel but cannot Apply a stale "+changed+" descriptor",async()=>{
  const{f,preview}=await lostArrangement();f.epoch="renewed-author";await f.staleContext(changed);
  assert.equal(await f.controller.retrieve(),true);assert.equal(f.controller.state.submitted,false);assert.equal(f.controller.state.issue,"changed");
  assert.deepEqual(f.controller.state.preview,preview);assert.equal(await f.controller.apply(confirm(preview)),false);
  assert.equal(await f.controller.dismiss(),true);assert.equal(f.commands.filter(command=>command.action==="apply").length,1);assert.equal(f.ids,1);
});

test("R4 old authority context is not current Apply proof after an authenticated renewed read",async()=>{
  const{f,preview}=await lostArrangement();f.epoch="renewed-author";
  f.contextHook=async()=>({...f.current(),authorityKey:"authority-a"});
  assert.equal(await f.controller.retrieve(),true);assert.equal(f.controller.state.submitted,false);assert.equal(f.controller.state.issue,"changed");
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(f.commands.filter(command=>command.action==="apply").length,1);
  f.contextHook=null;assert.equal(await f.controller.revalidate(),true);
  const fresh=f.controller.state.preview;assert.equal(f.controller.state.issue,null);
  assert.equal(await f.controller.apply(confirm(fresh)),true);
  assert.equal(f.commands.filter(command=>command.action==="apply").length,2);assert.ok(f.commands.every(command=>command.operationId===preview.operationId));assert.equal(f.ids,1);
});

test("R4 current applied receipt is bound to the retained opaque IDs/count without re-exposing old private preview",async()=>{
  const{f,preview}=await lostArrangement();f.epoch="renewed-reader";f.contextHook=async()=>({...f.current(),canArrange:false});
  for(const mutate of [
    body=>({...body,previewId:"other-preview"}),body=>({...body,approvalHash:"f".repeat(64)}),
    body=>({...body,arrangementId:"outcome-arrangement:"+"c".repeat(64)}),body=>({...body,itemCount:3}),
  ]){
    f.postHook=async()=>({ok:true,status:200,body:mutate(f.applied(preview))});
    assert.equal(await f.controller.retrieve(),false);assert.equal(f.controller.state.status,"uncertain");assert.equal(f.controller.state.submitted,true);assert.equal(f.controller.state.preview,null);
  }
  f.postHook=async()=>({ok:true,status:200,body:f.applied(preview)});
  assert.equal(await f.controller.retrieve(),true);assert.equal(f.controller.state.status,"applied");assert.equal(f.controller.state.preview,null);
  assert.equal(await f.controller.apply(confirm(preview)),false);assert.equal(await f.controller.dismiss(),false);
  f.postHook=async()=>({ok:true,status:200,body:{status:"review",preview}});await f.controller.retrieve();
  assert.equal(f.controller.state.status,"applied");assert.equal(f.controller.state.submitted,true);assert.equal(f.controller.state.preview,null);
});

test("R4 a response digest cannot publish after current read authority changes again",async()=>{
  const{f,preview}=await lostArrangement();f.epoch="renewed-reader";f.contextHook=async()=>({...f.current(),canArrange:false});
  const gate=deferred(),native=crypto.subtle.digest;let entered=false;
  crypto.subtle.digest=function(...args){if(!entered){entered=true;return gate.promise.then(()=>native.apply(this,args));}return native.apply(this,args);};
  try{
    const old=f.controller.retrieve();await until(()=>entered);assert.equal(f.controller.state.busy,true);assert.equal(f.controller.state.preview,null);
    f.epoch="newer-reader";assert.equal(await f.controller.retrieve(),false);
    gate.resolve();assert.equal(await old,false);assert.equal(f.controller.state.submitted,true);assert.equal(f.controller.state.preview,null);assert.equal(f.controller.state.busy,false);
  }finally{gate.resolve();crypto.subtle.digest=native;}
  assert.equal(await f.controller.retrieve(),true);assert.deepEqual(f.controller.state.preview,preview);assert.equal(await f.controller.dismiss(),true);assert.equal(f.ids,1);
});

test("R4 a stale validation digest cannot overwrite a newer operation's receipt fingerprint",async()=>{
  const f=await fixture();await f.begin();const gate=deferred(),native=crypto.subtle.digest;let entered=false;
  crypto.subtle.digest=function(...args){if(!entered){entered=true;return gate.promise.then(()=>native.apply(this,args));}return native.apply(this,args);};
  let current;
  try{
    const old=f.controller.revalidate();await until(()=>entered);assert.equal(await f.controller.dismiss(),true);assert.equal(await f.begin("New private intent"),true);
    current=f.controller.state.preview;const state=f.controller.state;gate.resolve();assert.equal(await old,false);assert.deepEqual(f.controller.state,state);
  }finally{gate.resolve();crypto.subtle.digest=native;}
  f.postHook=command=>command.action==="apply"?Promise.reject(new Error("New operation lost response")):f.respond(command);
  await f.controller.apply(confirm(current));f.epoch="new-epoch-for-new-intent";f.contextHook=async()=>({...f.current(),canArrange:false});
  assert.equal(await f.controller.retrieve(),true);assert.equal(f.controller.state.preview.operationId,current.operationId);assert.equal(await f.controller.dismiss(),true);
  assert.equal(f.ids,2);
});
