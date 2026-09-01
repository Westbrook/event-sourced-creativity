import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import ts from "typescript";
import { artifactApprovalMatches, artifactDeliveryState } from "../src/model/artifact-delivery.ts";
import { artifactFocusRoute, artifactFocusOptionsFromRoute } from "../src/model/routes.ts";
import { artifactExactContentGuard } from "../worker/artifact-review.ts";
import { sourceRightsDispatchGuard } from "../worker/context-package-rights.ts";
import { documentArtifactRevision } from "../src/model/document-artifacts.ts";
import { creativeActionSourceRevision } from "../src/model/workspace-intelligence.ts";
import { ARTIFACT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/artifact-delivery-messages.ts";
import { createSceneStoreHost, readWorkspaceEvents, financial } from "./helpers/event-source-retirement-fixture.mjs";

const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,"0")).join("");
const bytes = JSON.stringify({ content_markdown:"Exact approved output", items:[] });
const hash = await digest(bytes), otherHash = await digest(bytes+" ");
const event = (sequence,type,payload={},actor="worker:renderer") => ({
  eventId:"event-"+sequence,sequence,type,payload,actor,occurredAt:"2026-08-27T10:00:00.000Z",
  streamId:"creative:author",recordedAt:"2026-08-27T10:00:00.000Z",clientId:"test",correlationId:"test",
  causationId:null,compensatesEventId:null,schemaVersion:1,
});
const artifact = { id:"artifact",documentId:"document",sourceEventId:"event-2",sequence:2,kind:"slides",
  title:"Exact result",contentRef:"content",items:[],settings:{},itemCount:1 };
const blocks = [{id:"direction",documentId:"document",projectId:"project",scope:"document",type:"direction",
  handle:"direction/one",properties:{text:"Explain the approved result",weight:1},sourceEvents:["source-1"],removed:false}];
const exact = {artifact_id:artifact.id,document_id:artifact.documentId,project_id:"project",artifact_revision:0,content_sha256:hash};
const base = [
  event(1,"DocumentRenderRequested",{...exact,source_block_versions:[{block_id:"direction",version:1}]},"user:author"),
  event(2,"DocumentRenderCompleted",{...exact,artifact_kind:"slides",content_ref:"content",requested_by_user_id:"author",source_block_versions:[{block_id:"direction",version:1}]}),
];
const requested = event(3,"ArtifactReviewRequested",{...exact,assigned_reviewer_user_id:"reviewer"},"user:author");
const approved = event(4,"ArtifactApproved",exact,"user:reviewer");
const history = [...base,requested,approved];
const access = {actorUserId:"author",canRead:true,canAuthor:true,canReview:true,shared:true};

test("only an independent assigned approval for the actual revision and bytes is current",()=>{
  assert.equal(artifactApprovalMatches(artifact,history,0,hash),true);
  for(const changes of [
    {events:[...base,{...requested,payload:{...requested.payload,assigned_reviewer_user_id:"other"}},approved]},
    {events:[...base,requested,{...approved,actor:"user:author"}]},
    {events:[...base,{...requested,actor:"user:reviewer"},approved]},
    {events:[...base,approved]},
    {events:[...base,requested,{...approved,payload:{...exact,document_id:"other"}}]},
    {events:[...base,requested,{...approved,payload:{...exact,content_sha256:otherHash}}]},
    {revision:1},{hash:otherHash},
  ])assert.equal(artifactApprovalMatches(artifact,changes.events??history,changes.revision??0,changes.hash??hash),false,JSON.stringify(changes));
  const edited=[...base,event(3,"DocumentArtifactEdited",{artifact_id:"artifact",edited_by_user_id:"reviewer"},"user:reviewer"),
    event(4,"ArtifactReviewRequested",{...requested.payload,artifact_revision:1},"user:author"),
    event(5,"ArtifactApproved",{...exact,artifact_revision:1},"user:reviewer")];
  assert.equal(artifactApprovalMatches(artifact,edited,1,hash),false,"an output contributor cannot approve a later revision");
});

test("each output kind has one exact review or export action without an optional sibling prerequisite",()=>{
  for(const kind of ["slides","short_story","scene","storyboard","video","audio"]){
    const current={...artifact,kind};
    assert.equal(artifactDeliveryState(current,blocks,base,access,hash).action,"assign");
    assert.equal(artifactDeliveryState(current,blocks,[...base,requested],{...access,actorUserId:"reviewer",canAuthor:false},hash).action,"review");
    const approvedState=artifactDeliveryState(current,blocks,history,access,hash);
    assert.equal(approvedState.action,"export");assert.equal(approvedState.releaseAllowed,true);
    const failedSibling=event(5,"DocumentRenderFailed",{artifact_id:"optional-audio",document_id:"document"});
    assert.deepEqual(artifactDeliveryState(current,blocks,[...history,failedSibling],access,hash),approvedState);
  }
});

test("source edits, revoked rights, output edits, lost access, and missing bytes invalidate release",()=>{
  assert.equal(artifactDeliveryState(artifact,blocks,history,access,hash).approved,true);
  const changed=[{...blocks[0],sourceEvents:["source-1","source-edit"]}];
  assert.equal(artifactDeliveryState(artifact,changed,history,access,hash).review.status,"stale");
  assert.equal(artifactDeliveryState(artifact,changed,history,access,hash).releaseAllowed,false);
  assert.equal(artifactDeliveryState(artifact,changed,history,access,hash).action,"sources");
  const revoked=[{...blocks[0],properties:{...blocks[0].properties,rights_revoked:true}}];
  assert.equal(artifactDeliveryState(artifact,revoked,history,access,hash).releaseAllowed,false);
  const changedOutput=[...history,event(5,"DocumentArtifactEdited",{...exact,revision:1},"user:author")];
  const revised=artifactDeliveryState(artifact,blocks,changedOutput,access,otherHash);
  assert.equal(revised.revision,1);assert.equal(revised.review.status,"draft");assert.equal(revised.approved,false);
  for(const current of [
    artifactDeliveryState(artifact,blocks,history,{...access,canRead:false},hash),
    artifactDeliveryState(artifact,blocks,history,access,null),
    artifactDeliveryState(artifact,blocks,history,access,otherHash),
  ]){assert.equal(current.approved,false);assert.equal(current.releaseAllowed,false);}
  assert.equal(artifactDeliveryState(artifact,blocks,history,access).releaseAllowed,false,"a list has not yet read the current private bytes");
  const changes=event(4,"ArtifactChangesRequested",{...exact,review_note:"Correct slide 1."},"user:reviewer");
  assert.equal(artifactDeliveryState(artifact,blocks,[...base,requested,changes],access,hash).action,"changes");
});

test("export acknowledgment, approval, and recipient delivery remain separate",()=>{
  const exported=event(5,"DocumentArtifactExported",{...exact,format:"application/pdf",export_class:"independently-approved"},"user:author");
  const state=artifactDeliveryState(artifact,blocks,[...history,exported],access,hash);
  assert.equal(state.approved,true);assert.equal(state.exportReceipt.eventId,exported.eventId);assert.equal(state.deliveryStatus,"unconfirmed");
  for(const payload of [
    {...exported.payload,artifact_revision:1},{...exported.payload,content_sha256:otherHash},
    {...exported.payload,artifact_id:"optional-sibling"},{...exported.payload,destination_kind:"soundtrack-companion"},
  ])assert.equal(artifactDeliveryState(artifact,blocks,[...history,{...exported,payload}],access,hash).exportReceipt,null);
});

test("legacy draft download is free, explicit, not approved, and still bounded by current rights and bytes",()=>{
  const legacy=base.map(row=>({...row,payload:{...row.payload,source_block_versions:undefined}}));
  const unmanaged={...access,independentApprovalRequired:false};
  const state=artifactDeliveryState(artifact,blocks,legacy,unmanaged,hash);
  assert.equal(state.review.status,"unverified");assert.equal(state.action,"exportDraft");assert.equal(state.releaseAllowed,true);assert.equal(state.approved,false);
  const exported=event(5,"DocumentArtifactExported",{...exact,export_class:"unreviewed-draft"},"user:author");
  const acknowledged=artifactDeliveryState(artifact,blocks,[...legacy,exported],unmanaged,hash);
  assert.ok(acknowledged.exportReceipt);assert.equal(acknowledged.approved,false);assert.equal(acknowledged.deliveryStatus,"unconfirmed");
  assert.equal(artifactDeliveryState(artifact,blocks,legacy,unmanaged,null).releaseAllowed,false);
  assert.equal(artifactDeliveryState(artifact,[{...blocks[0],properties:{...blocks[0].properties,rights_revoked:true}}],legacy,unmanaged,hash).releaseAllowed,false);
  assert.equal(artifactDeliveryState(artifact,blocks,legacy,access,hash).releaseAllowed,false,"the managed/source-versioned approval requirement cannot be bypassed");
});

test("exact revision routes preserve Canvas ownership and reject incomplete or ambiguous identities",()=>{
  const options={expectedRevision:0,expectedContentSha256:hash,intent:"review"};
  const route=artifactFocusRoute("artifact/one","An output",options,"/canvas/library");
  assert.ok(route.startsWith("/canvas/library/artifact/artifact%2Fone/"));
  assert.deepEqual(artifactFocusOptionsFromRoute(route),options);
  assert.equal(artifactFocusOptionsFromRoute("/library/artifact/current"),null);
  for(const query of ["revision=0","intent=review","revision=-1&intent=review","revision=1.5&intent=review",
    "revision=9007199254740992&intent=review","revision=0&intent=approve","revision=0&intent=review&sha256=bad",
    "revision=0&intent=review&revision=1","revision=0&intent=review&intent=export"])
    assert.equal(artifactFocusOptionsFromRoute("/library/artifact/a?"+query),"invalid",query);
});

function migrationTableSchema(filename, table) {
  const statements=readFileSync(new URL("../drizzle/"+filename,import.meta.url),"utf8").split("--> statement-breakpoint").map(value=>value.trim()).filter(Boolean);
  const quoted="`"+table+"`";
  const definition=statements.find(value=>value.startsWith("CREATE TABLE "+quoted+" (")||value.startsWith("CREATE TABLE IF NOT EXISTS "+quoted+" ("));
  assert.ok(definition,"the fixture loads the committed schema for "+table);
  return[definition,...statements.filter(value=>/^CREATE (?:(?:UNIQUE )?INDEX|TRIGGER)\b/u.test(value)&&value.includes(" ON "+quoted))].join("\n");
}
const eventCustodySchema=[
  migrationTableSchema("0000_lively_owl.sql","events"),
  migrationTableSchema("0015_true_lila_cheney.sql","event_private_payloads"),
  migrationTableSchema("0013_long_midnight.sql","project_event_scopes"),
].join("\n");
const fixtureRecordedAt="2026-08-27T10:00:00.000Z";
function insertFixtureEvent(db,streamId,sequence,type,payload,eventId="fixture:"+streamId+":"+sequence) {
  db.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(eventId,streamId,sequence,fixtureRecordedAt,fixtureRecordedAt,"user:"+streamId.slice("creative:".length),"test","test",type,payload);
  return{eventId,sequence,type,payload};
}

function contentFixture(){
  const db=new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT,content TEXT,redacted_at TEXT,expires_at TEXT);
    CREATE TABLE project_resource_scopes(project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,resource_kind TEXT,resource_id TEXT,visibility TEXT);`);
  db.exec(eventCustodySchema);
  db.prepare("INSERT INTO private_content VALUES(?,?,?,?,NULL,?)").run("content","author","document-artifact",bytes,"9999-12-31T23:59:59.999Z");
  for(const [kind,id] of [["artifact","artifact"],["content","content"]])
    db.prepare("INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?)").run("access","organization","project","author",kind,id,"collaborative_output");
  const context={projectAccessId:"access",organizationId:"organization",projectId:"project",ownerUserId:"author"};
  const binding={contentId:"content",content:bytes,revision:0,rightsGuard:{sql:"1",bindings:[]},rightsValidUntil:null};
  const permitted=(proof=binding)=>{const guard=artifactExactContentGuard(context,"artifact",proof);return Boolean(db.prepare("SELECT 1 AS permitted WHERE 1"+guard.sql).get(...guard.bindings)?.permitted);};
  return{db,context,binding,permitted};
}

test("review/export commit uses the current retained bytes, revision, custody, and live expiry",()=>{
  for(const mutate of [
    f=>f.db.prepare("UPDATE private_content SET content=?").run(bytes+" "),
    f=>f.db.exec("UPDATE private_content SET redacted_at='2026-08-27T00:00:00.000Z'"),
    f=>f.db.exec("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z'"),
    f=>f.db.exec("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='content'"),
    f=>f.db.exec("UPDATE project_resource_scopes SET project_id='other' WHERE resource_kind='artifact'"),
    f=>insertFixtureEvent(f.db,"creative:author",1,"DocumentArtifactEdited",JSON.stringify({artifact_id:"artifact"})),
    f=>{f.binding.rightsValidUntil="2020-01-01T00:00:00.000Z";},
  ]){
    const f=contentFixture();assert.equal(f.permitted(),true);mutate(f);assert.equal(f.permitted(),false);
    const guard=artifactExactContentGuard(f.context,"artifact",f.binding);
    const result=f.db.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload) SELECT 'conditional-approval','creative:author',2,'2026-08-27T10:00:00.000Z','2026-08-27T10:00:00.000Z','user:reviewer','test','test','ArtifactApproved','{}' WHERE 1"+guard.sql).run(...guard.bindings);
    assert.equal(Number(result.changes),0,"a rejected proof records no approval");f.db.close();
  }
});

function adoptedSourceFixture(){
  const f=contentFixture();
  f.db.exec(`CREATE TABLE organizations(organization_id TEXT,status TEXT);
    CREATE TABLE organization_projects(project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,status TEXT);
    CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,owner_user_id TEXT,status TEXT,last_owner_sequence INTEGER);
    CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT,accepted_at TEXT,revoked_at TEXT);
    CREATE TABLE organization_context_packages(package_id TEXT,organization_id TEXT,status TEXT);
    CREATE TABLE organization_context_package_versions(version_id TEXT,package_id TEXT,organization_id TEXT,status TEXT,redacted_at TEXT,content_sha256 TEXT);
    CREATE TABLE organization_context_package_contents(version_id TEXT,organization_id TEXT,redacted_at TEXT,content_json TEXT);
    INSERT INTO organizations VALUES('organization','active');
    INSERT INTO organization_projects VALUES('origin-access','organization','origin-project','origin-owner','active');
    INSERT INTO project_migration_states VALUES('origin-access','organization','origin-owner','active',1);
    INSERT INTO organization_memberships VALUES('organization','origin-owner','active','2026-01-01',NULL);`);
  const eventId="origin-rights-1",privateOwner="origin-owner";
  const privateJson=JSON.stringify({project_id:"origin-project",document_id:"origin-document",reference_id:"origin-reference",rights_class:"owned",rights_note:"Exact retained source licence — محفوظ"});
  const payload=JSON.stringify({project_id:"origin-project",document_id:"origin-document",reference_id:"origin-reference",rights_class:"owned",_private_ref:eventId});
  const sourceEvent=insertFixtureEvent(f.db,"creative:origin-owner",1,"RightsAsserted",payload,eventId);
  f.db.prepare("INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at) VALUES(?,?,?,?,?,?)")
    .run(eventId,privateOwner,"origin-project","origin-document",privateJson,fixtureRecordedAt);
  f.db.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(eventId,"origin-access","organization","origin-project",privateOwner,"creative:origin-owner",1,1,privateOwner,fixtureRecordedAt);
  const resources=[{kind:"document",id:"origin-document"},{kind:"reference",id:"origin-reference"}];
  for(const resource of resources)f.db.prepare("INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?)")
    .run("origin-access","organization","origin-project",privateOwner,resource.kind,resource.id,"collaborative_output");
  f.binding.rightsGuard=sourceRightsDispatchGuard({dispatchDependencies:[{kind:"source",organizationId:"organization",
    projectAccessId:"origin-access",projectId:"origin-project",ownerUserId:"origin-owner",sourceHead:1,indexedHead:1,
    events:[{...sourceEvent,privateJson,privateOwner}],resources}]});
  return f;
}

test("an adopted source revocation after reading also fails the actual rights dependency guard",()=>{
  const f=adoptedSourceFixture();
  assert.equal(f.permitted(),true);
  insertFixtureEvent(f.db,"creative:origin-owner",2,"RightsAsserted","{}");
  assert.equal(f.permitted(),false,"a changed original source cannot release an already-read downstream output");f.db.close();
});

const componentSource=readFileSync(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8");
const storeSource=readFileSync(new URL("../src/state/store.ts",import.meta.url),"utf8");
function actualClassMembers(source,className,names){
  const tree=ts.createSourceFile(className+".ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const owner=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===className);
  assert.ok(owner,"the fixture reads the actual "+className+" class");
  return names.map(name=>{
    const member=owner.members.find(node=>node.name?.getText(tree)===name);
    assert.ok(member,"the fixture retains actual "+className+"."+name);
    return member.getText(tree);
  }).join("\n");
}
const sourceOwnershipMembers=actualClassMembers(storeSource,"FormaStore",[
  "#sourceGeneration","#sourceRetired","#sourceOwners","captureSourceOwnership","sourceOwnershipScopeActive",
  "#sourceExpiryValid","#sourceDeadlineCurrent","sourceOwnershipActive",
]);
const SourceOwnership=eval(stripTypeScriptTypes("(class {"+sourceOwnershipMembers+"})"));
const privateSourceMembers=actualClassMembers(componentSource,"DocumentArtifacts",["#privateSourceRevision","#privateSourceCurrent"]);
const between=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);};
const openingMethods=between(componentSource,"  async openArtifactById(","  // Exact read-only job")
  +between(componentSource,"  async #openArtifact(","  async #create(")
  +between(componentSource,"  async #artifactBinding(","  async #download(")+"\n"+privateSourceMembers;
// Production methods remain verbatim; only their former lexical eval inputs
// become explicit dependencies visible to both the harness and static analysis.
const fixtureClass=(source,bindings)=>new Function(...Object.keys(bindings),'"use strict"; return '+stripTypeScriptTypes(source)+";")(...Object.values(bindings));
function viewerFixture(){
  const trace=[],state={bytes,events:[...base],active:true,documentId:"document",beforeUpdate:()=>{}};
  class HTMLElement{isConnected=true;focus(){trace.push("focus");}}
  const document={activeElement:new HTMLElement()};
  const dialog={open:false,close(){this.open=false;},setAttribute(){},addEventListener(){}};
  const ensureModalDialog=target=>{target.open=true;trace.push("modal");};
  const store=Object.assign(new SourceOwnership(),{captureAuthorizationScope:()=>({key:"authority",shared:true}),authorizationScopeActive:()=>state.active,
    projection:{get:()=>({libraryArtifacts:[artifact]})},events:{get:()=>state.events},content:{get:()=>({content:state.bytes})},
    session:{get:()=>({projectContext:{permissions:["project.read","project.review.approve"]}})},ui:{instrumentation:false},ensurePrivateContent:async()=>null});
  const declared=new Set(["openArtifact","artifactBinding","targetDocumentId","revealWorkbenchPane","viewDialog","showArtifactIntent","privateSourceRevision","privateSourceCurrent"]);
  const fields=[...new Set([...openingMethods.matchAll(/#([A-Za-z][A-Za-z0-9_]*)/g)].map(match=>match[1]))].filter(name=>!declared.has(name));
  const Probe=fixtureClass(`(class {
    ${fields.map(name=>"#"+name+"=null;").join("\n")}
    store=store;documentId="document";isConnected=true;
    get updateComplete(){return Promise.resolve().then(()=>state.beforeUpdate());}requestUpdate(){}
    #targetDocumentId(){return this.documentId;}async #revealWorkbenchPane(){}
    #viewDialog(){return dialog;}async #showArtifactIntent(_artifact,intent){trace.push("intent:"+intent);}
    current(){return this.#viewerCurrent?.();}
    ${openingMethods}
  })`,{state,trace,dialog,store,document,HTMLElement,ensureModalDialog,documentArtifactRevision});
  return{host:new Probe(),state,trace,dialog};
}

test("the real viewer opening transaction refuses another revision or hash without opening a dialog",async()=>{
  for(const options of [{expectedRevision:1},{expectedRevision:0,expectedContentSha256:otherHash,intent:"review"}]){
    const f=viewerFixture();assert.equal(await f.host.openArtifactById("artifact",options),false);assert.equal(f.dialog.open,false);assert.deepEqual(f.trace,[]);
  }
  const f=viewerFixture();
  assert.equal(await f.host.openArtifactById("artifact",{expectedRevision:0,expectedContentSha256:hash,intent:"review"}),true);
  assert.deepEqual(f.trace,["modal","intent:review"]);
});

test("a successful exact opening keeps authorized Save/Restore editable but loses authority immediately",async()=>{
  const f=viewerFixture();let board="board-a";
  assert.equal(await f.host.openArtifactById("artifact",{expectedContentSha256:hash,current:()=>board==="board-a"}),true);
  f.state.events.push(event(3,"DocumentArtifactEdited",{artifact_id:"artifact"},"user:author"));f.state.bytes=bytes+" edited";
  assert.equal(f.host.current(),true,"a valid open editing session must not be frozen to the prior bytes");
  board="board-b";assert.equal(f.host.current(),false);
  board="board-a";f.state.active=false;assert.equal(f.host.current(),false);
});


// Focused exact-task handoff with the existing complete production Store.
// Assignment/session HTTP, load, route commit and notice remain simulated.
// This is NOT a Worker-issued cookie, generation-race, Source-load or browser
// certificate; those use the separate actual assigned-review action fixture.
async function assignmentFixture(t,change=()=>{}){
  let external=0,h=null,closePromise=null,verify=async()=>{};
  const restores=[],originalFetch=globalThis.fetch;
  const blockedFetch=async()=>{external++;assert.fail("No external/provider transport in the focused assignment fixture");};
  globalThis.fetch=blockedFetch;
  const close=()=>{
    if(!closePromise)closePromise=(async()=>{
      try{await verify();}
      finally{
        try{for(const restore of restores.reverse())restore();if(h)await h.close();}
        finally{if(globalThis.fetch===blockedFetch)globalThis.fetch=originalFetch;}
      }
    })();
    return closePromise;
  };
  t.after(()=>closePromise?closePromise.catch(()=>undefined):close()); // Join once; do not repeat an already reported close failure.
  h=await createSceneStoreHost({count:1,exposeSceneTestAccessors:false});const host=h.store;
  const canonical=await readWorkspaceEvents(h.worker.env,h.worker.streamId),money=financial(h.worker);
  const original={open:host.openAssignedReview,selection:host.beginProjectContextSelection,
    refresh:host.refreshSession,inbox:host.syncReviewInbox,source:host.captureSourceOwnership,guardedFetch:host.guardedFetch};
  const task={id:"assignment",status:"pending",organizationId:"organization",projectAccessId:"access",projectId:"project",
    documentId:"document",artifactId:"artifact",artifactTitle:"Exact result",revision:0,contentSha256:hash};
  const state={tasks:[task],calls:[],routes:[],http:[],loadEntered:false};
  const initial={...host.session.get(),user:{...host.session.get().user,userId:"reviewer"},
    projectContext:undefined,impersonation:null,policy:{version:"fixture",accepted:true}};
  host.session.set(initial);host.route.set("/activity?document=document");host.reviewInbox.set(state.tasks);
  Object.defineProperty(state,"session",{enumerable:true,get:()=>host.session.get(),set:value=>{host.session.set(value);}});
  const requestStart=h.requests.length,pending=new Set();let selected=false;
  h.transport=request=>{
    const operation=(async()=>{
      const method=request.init.method??"GET",row={url:request.url,method,phase:state.loadEntered?"post-load":"pre-load"};
      state.http.push(row); // Complete, non-deduplicated simulated HTTP trace.
      if(request.url==="/api/workspaces/organization/projects/access/context"&&method==="POST"){
        assert.equal(request.init.credentials,"same-origin");assert.equal(selected,false);
        selected=true;state.calls.push("context");return Response.json({});
      }
      assert.equal(method,"GET","No additional command is admitted by this finite port");
      if(request.url==="/api/session"){
        assert.equal(selected,true);
        return Response.json({...initial,projectContext:{organizationId:"organization",projectAccessId:"access",projectId:"project",
          ownerUserId:"author",expiresAt:"9999-12-31T23:59:59.999Z",permissions:["project.read","project.review.approve"]}});
      }
      if(request.url==="/api/project-notifications")return Response.json({notifications:[]});
      if(request.url==="/api/workspaces/organization/context-packages")return Response.json({packages:[]});
      if(request.url==="/api/workspaces/reviews"){
        // Preserve the former test's explicit post-load assignment-read trace.
        // Automatic applySession reads remain visible above, not deduplicated
        // into that trace or mistaken for the later exact-task decision.
        if(state.loadEntered)state.calls.push("assignments");
        return Response.json({tasks:state.tasks});
      }
      assert.fail("Unexpected simulated assignment endpoint: "+method+" "+request.url);
    })();
    pending.add(operation);void operation.then(()=>pending.delete(operation),()=>pending.delete(operation));return operation;
  };
  // These are the old mini-host's explicit I/O seams, not ownership guards.
  // In particular refreshSession, applySession, selection, reconciliation,
  // syncReviewInbox and every private cookie/Source field are actual Store code.
  const port=(name,value)=>{
    const previous=Object.getOwnPropertyDescriptor(host,name);
    Object.defineProperty(host,name,{configurable:true,writable:true,value});
    restores.push(()=>{if(previous)Object.defineProperty(host,name,previous);else delete host[name];});
  };
  port("load",async()=>{state.loadEntered=true;await change(state);});
  port("setRoute",route=>state.routes.push(route));
  port("toast",()=>state.calls.push("notice"));
  verify=async()=>{
      await Promise.allSettled([...pending]);await new Promise(setImmediate);await h.worker.drainBackground();
      assert.equal(host.openAssignedReview,original.open);assert.equal(host.beginProjectContextSelection,original.selection);
      assert.equal(host.refreshSession,original.refresh);assert.equal(host.syncReviewInbox,original.inbox);
      assert.equal(host.captureSourceOwnership,original.source);assert.equal(host.guardedFetch,original.guardedFetch);
      assert.equal(external,0);assert.deepEqual(await readWorkspaceEvents(h.worker.env,h.worker.streamId),canonical);
      assert.deepEqual(financial(h.worker),money);
      assert.equal(globalThis.fetch,blockedFetch,"This fixture still owns its single external transport guard");
      assert.deepEqual(h.requests.slice(requestStart).map(request=>({url:request.url,method:request.init.method??"GET"})),
        state.http.map(({url,method})=>({url,method})),
        "Every actual Store request reaches the strict finite port; no reusable host short-circuit substitutes a job response");
      assert.equal(state.http.filter(row=>row.url==="/api/session").length,selected?1:0,
        "The actual session method uses one simulated current response; no private generation is stamped by the fixture");
      if(state.loadEntered)assert.equal(state.http.filter(row=>row.url==="/api/workspaces/reviews"&&row.phase==="pre-load").length,1,
        "The real applySession automatic inbox request is recorded separately from the post-load handoff");
      t.diagnostic("ARTIFACT_EXACT_ASSIGNMENT_FINITE_IO "+JSON.stringify({http:state.http,explicitHandoffTrace:state.calls,
        completeActualStore:true,assignmentResponsesSimulated:true,loadAndRouteSimulated:true,workerIssuedCookie:false,
        cookieGenerationCertification:false,canonicalAndFinancialRowsUnchanged:true}));
  };
  return{host,state,task,close};
}
test("assigned-review handoff retains its exact task revision and hash after current project authorization",{concurrency:false},async t=>{
  const f=await assignmentFixture(t);try{assert.equal(await f.host.openAssignedReview(f.task),true);
  assert.deepEqual(artifactFocusOptionsFromRoute(f.state.routes[0]),{expectedRevision:0,expectedContentSha256:hash,intent:"review"});
  assert.deepEqual(f.state.calls,["context","assignments"]);
  }finally{await f.close();}
});
test("a changed or revoked assignment never opens a different output revision",{concurrency:false},async t=>{
  for(const mutate of [
    state=>{state.tasks=[{...state.tasks[0],revision:1}];},
    state=>{state.tasks=[{...state.tasks[0],contentSha256:otherHash}];},
    state=>{state.tasks=[];},
    state=>{state.session.projectContext.permissions=[];},
    state=>{state.session.projectContext.projectAccessId="other";},
    state=>{state.session.user.userId="other";},
  ]){const f=await assignmentFixture(t,mutate);try{assert.equal(await f.host.openAssignedReview(f.task),false);assert.deepEqual(f.state.routes,[]);}finally{await f.close();}}
  const invalid=await assignmentFixture(t);try{assert.equal(await invalid.host.openAssignedReview({...invalid.task,contentSha256:"missing"}),false);assert.deepEqual(invalid.state.calls,[]);}finally{await invalid.close();}
});

const canvasSource=readFileSync(new URL("../src/canvas/canvas-application.ts",import.meta.url),"utf8");
const canvasMethod=between(canvasSource,"  async #openArtifactDelivery(","  #closeCanvasArtifact(");
function canvasFixture(change=()=>{}){
  const state={canvasId:"board-a",active:true,events:[...history],blocks:structuredClone(blocks),opens:[]};
  const store={captureAuthorizationScope:()=>({key:"authority"}),authorizationScopeActive:()=>state.active,
    canvasProjection:{get:()=>({selectedCanvasId:state.canvasId})},events:{get:()=>state.events},toast:()=>{}};
  const nextActionFacts=()=>({projectId:"project",documentId:"document",canvasId:state.canvasId,canRead:state.active,authorityKey:"authority",artifacts:[artifact],blocks:state.blocks});
  const artifactDeliveryFor=()=>artifactDeliveryState(artifact,state.blocks,state.events,access);
  const Probe=fixtureClass(`(class {
    store=store;i18n={t:(_id,fallback)=>fallback};get updateComplete(){return Promise.resolve().then(()=>change(state));}
    #closeCanvasArtifact(){}querySelector(){return{openArtifactById:async(id,options)=>{state.opens.push({id,options});return true;}};}
    open(){return this.#openArtifactDelivery(artifact);}
    ${canvasMethod}
  })`,{state,change,store,artifact,nextActionFacts,artifactDeliveryFor,documentArtifactRevision,creativeActionSourceRevision});
  return{host:new Probe(),state};
}
test("Canvas keeps its exact board/source guard while routing to the existing artifact executor",async()=>{
  const allowed=canvasFixture();assert.equal(await allowed.host.open(),true);assert.equal(allowed.state.opens.length,1);
  const opened=allowed.state.opens[0];assert.equal(opened.id,"artifact");assert.equal(opened.options.expectedRevision,0);assert.equal(opened.options.expectedContentSha256,hash);assert.equal(opened.options.intent,"export");
  allowed.state.blocks[0].sourceEvents.push("later-edit");
  assert.equal(opened.options.current("opening"),false);assert.equal(opened.options.current("editing"),true);
  allowed.state.canvasId="board-b";assert.equal(opened.options.current("editing"),false);
  for(const change of [state=>{state.canvasId="board-b";},state=>{state.active=false;},state=>{state.blocks[0].sourceEvents.push("change");}]){
    const denied=canvasFixture(change);assert.equal(await denied.host.open(),false);assert.deepEqual(denied.state.opens,[]);
  }
});

test("delivery copy covers four languages without calling an export a verified delivery",()=>{
  for(const [locale,messages] of Object.entries(ARTIFACT_DELIVERY_MESSAGES)){
    assert.deepEqual(Object.keys(messages),Object.keys(ARTIFACT_DELIVERY_MESSAGES.en),locale);
    for(const value of Object.values(messages))assert.ok(value.trim(),locale);
  }
  assert.match(ARTIFACT_DELIVERY_MESSAGES.en["artifact.delivery.action.exportDraft"],/unreviewed draft/);
  assert.match(ARTIFACT_DELIVERY_MESSAGES.en["artifact.delivery.notDelivered"],/does not confirm/);
});
