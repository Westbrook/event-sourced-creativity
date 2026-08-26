import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";
import { documentArtifactValidationIssues, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { appendAuditEvent } from "../worker/runtime.ts";

const workspaceRoot=new URL("../",import.meta.url).href;
const sourceResolution=registerHooks({resolve(specifier,context,nextResolve){
  const local=typeof context.parentURL==="string"&&context.parentURL.startsWith(workspaceRoot)&&!context.parentURL.includes("/node_modules/");
  return nextResolve(local&&specifier.startsWith(".")&&!/\.[a-z0-9]+$/iu.test(specifier)?`${specifier}.ts`:specifier,context);
}});
const {handleArtifactEdit}=await import("../worker/artifact-api.ts").finally(()=>sourceResolution.deregister());

const PROMISE="Your content. One context. Infinite paths to your target.";
const OWNER="dev-local-creative";
const DOCUMENT="doc-atmosphere";
const PROJECT="project-atmosphere";
const ARTIFACT="source-aware-pitch-deck";
const CONTENT="source-aware-pitch-content";
const INPUT="source-aware-pitch-input";
const SOURCE="source-aware-authored-pitch";
const MARKDOWN=`# Pitch context\n\n${PROMISE}`;

function testDatabase(){
  const sqlite=new DatabaseSync(":memory:");
  class Statement{
    constructor(sql,values=[]){this.sql=sql;this.values=values;}
    bind(...values){return new Statement(this.sql,values);}
    execute(kind){
      const prepared=sqlite.prepare(this.sql);
      if(kind==="first")return prepared.get(...this.values)??null;
      if(kind==="all")return{results:prepared.all(...this.values),success:true,meta:{changes:0}};
      const result=prepared.run(...this.values);
      return{results:[],success:true,meta:{changes:Number(result.changes??0)}};
    }
    async first(){return this.execute("first");}
    async all(){return this.execute("all");}
    async run(){return this.execute("run");}
  }
  return{sqlite,DB:{
    prepare(sql){return new Statement(sql);},
    async batch(statements){
      sqlite.exec("BEGIN");
      try{
        const results=statements.map((statement)=>statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql)?"all":"run"));
        sqlite.exec("COMMIT");
        return results;
      }catch(error){sqlite.exec("ROLLBACK");throw error;}
    },
  }};
}

function pitchFixtureContent({authorizeClosing=true}={}){
  const sourceText=Array.from({length:9},(_,index)=>index===0
    ?`Slide 1 — ${PROMISE}\nOpen with the exact authored promise.`
    :index===8
      ?`Slide 9 — Confident delivery\n${authorizeClosing?`Close with the exact promise: ${PROMISE} Call to action: Build the story once. Deliver it in the form your audience needs now.`:"Close with a different authorized recommendation."}`
      :`Slide ${index+1} — Independently authored chapter ${index+1}\nAdvance the distinct customer argument ${index+1}.`).join("\n");
  const snapshot={document:{id:DOCUMENT,title:"Pitch context"},facts:[{block_id:SOURCE,type:"direction",properties:{text:sourceText}}],relationships:[]};
  const emphasis=["Shared creative beginning","Gather meaningful context","Choose the medium","Adapt each expression","Respect individual attention","Keep durable decisions","Follow relevant paths","Protect human control","Reach the intended audience"];
  const output={
    title:"Pitch context",
    summary:"The opening promise resolves in the close.",
    content_markdown:MARKDOWN,
    presentation:{aspect_ratio:"16:9",theme:"Pitch context",footer_label:"Forma",style_preset:"editorial",mode:"light",palette:{background:"#ffffff",foreground:"#111111",accent:"#345678",muted:"#778899",surface:"#eeeeee"}},
    items:Array.from({length:9},(_,index)=>({
      title:index===0?PROMISE:index===8?"Confident delivery":`Authored chapter ${index+1}`,
      body:"",
      notes:"Keep the exact source-authored argument.",
      image_prompt:"Source-grounded creative direction.",
      context_group_ids:[],
      slide:{layout:index===0?"cover":index===8?"closing":"statement",kicker:`Decision ${index+1}`,bullets:[],source_ids:[SOURCE],source_order:index+1,visual:{kind:"hero-type",label:"Independent emphasis",value:emphasis[index],data:[]}},
    })),
  };
  const receipt={schema_version:1,artifact_id:ARTIFACT,artifact_kind:"slides",document_id:DOCUMENT,project_id:PROJECT,captured_at:new Date().toISOString(),request:{item_count:9,requested_slide_count:9,presentation_style:"editorial",presentation_fidelity:"faithful"},document_snapshot:snapshot};
  return{sourceText,snapshot,output,receipt};
}

async function fixture(options={}){
  const database=testDatabase();
  const environment={DB:database.DB,ASSETS:{fetch:async()=>new Response(null,{status:404})},MEDIA:{}};
  const background=[];
  const request=(path,init)=>worker.fetch(new Request(`http://localhost${path}`,init),environment,{waitUntil(promise){background.push(promise);}});
  assert.equal((await request("/api/session")).status,200);
  database.sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await request("/api/events?after=0&limit=2000&content=0")).status,200);
  const seeded=pitchFixtureContent(options);
  const now=new Date().toISOString();
  const expires="9999-12-31T23:59:59.999Z";
  const privateContent=database.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)");
  privateContent.run(CONTENT,OWNER,"document-artifact",JSON.stringify(seeded.output),now,expires);
  privateContent.run(INPUT,OWNER,"document-artifact-input",JSON.stringify(seeded.receipt),now,expires);
  await appendAuditEvent(environment,`creative:${OWNER}`,"user","BlockCreated",{project_id:PROJECT,document_id:DOCUMENT,block_id:SOURCE,type:"direction",handle:"direction/source-aware-pitch",position:"z-source-aware",properties:{text:seeded.sourceText,weight:1,authority:"authored"}});
  await appendAuditEvent(environment,`creative:${OWNER}`,"worker:renderer","DocumentRenderCompleted",{
    artifact_id:ARTIFACT,artifact_kind:"slides",document_id:DOCUMENT,project_id:PROJECT,title:seeded.output.title,summary:seeded.output.summary,
    content_ref:CONTENT,input_ref:INPUT,item_count:9,items:seeded.output.items,presentation:seeded.output.presentation,requested_by_user_id:options.generatingUserId??OWNER,
  });
  const edit=(body=PROMISE,headers={},expectedRevision=0)=>handleArtifactEdit(new Request(`http://localhost/api/artifacts/${ARTIFACT}`,{
    method:"PATCH",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({markdown:MARKDOWN,expectedRevision,items:[{index:8,body}]}),
  }),environment,ARTIFACT);
  return{...database,environment,request,edit,...seeded};
}

async function governedFixture(){
  const state=await fixture();
  const json=(body,headers={})=>({method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
  const organization=await state.request("/api/workspaces",json({name:"Source-aware governed presentation"}));
  assert.equal(organization.status,201,JSON.stringify(await organization.clone().json()));
  const organizationId=(await organization.json()).organizationId;
  const registered=await state.request(`/api/workspaces/${organizationId}/projects`,json({projectId:PROJECT}));
  assert.equal(registered.status,201,JSON.stringify(await registered.clone().json()));
  const projectAccessId=(await registered.json()).projectAccessId;
  const open=async(headers={})=>{
    const response=await state.request(`/api/workspaces/${organizationId}/projects/${projectAccessId}/context`,{method:"POST",headers});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    return{...headers,cookie:response.headers.get("set-cookie")?.split(";")[0]??""};
  };
  const ownerHeaders=await open();
  const evidence=state.sqlite.prepare("SELECT visibility,actor_user_id FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").get(projectAccessId,INPUT);
  assert.equal(evidence.visibility,"actor_private");
  assert.equal(evidence.actor_user_id,OWNER);
  const now=new Date().toISOString();
  state.sqlite.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) VALUES(?,?,?,?,?,'governed-evidence',1,?,?)")
    .run(INPUT,organizationId,projectAccessId,PROJECT,OWNER,"9999-12-31T23:59:59.999Z",now);
  return{...state,organizationId,projectAccessId,ownerHeaders,open,json};
}

test("persists an exact source-authorized opening-to-closing pitch correction through immutable review-aware revision history",async()=>{
  const state=await fixture();
  const initial=parseDocumentArtifactContent(JSON.stringify(state.output));
  const corrected=structuredClone(initial);
  corrected.items[8].body=PROMISE;
  assert.equal(documentArtifactValidationIssues("slides",corrected,{itemCount:9}).some((issue)=>issue.code==="duplicate_deck_copy"),true,"generic validation rejects the exact authored opening and closing promise");
  assert.deepEqual(documentArtifactValidationIssues("slides",corrected,{itemCount:9,sourceContract:buildPresentationSourceContract(state.snapshot,{itemCount:9}),requireSourceGrounding:true,requireAllProtectedContent:true}),[]);

  const before=state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited'").get().count;
  const response=await state.edit();
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const result=await response.json();
  assert.equal(result.revision,1);
  assert.equal(result.appended.at(-1)?.type,"DocumentArtifactEdited");
  assert.equal(result.appended.at(-1)?.payload.edited_by_user_id,OWNER);
  const retained=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content);
  assert.equal(retained.items[0].title,PROMISE);
  assert.equal(retained.items[8].body,PROMISE);
  assert.deepEqual(JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(INPUT).content).document_snapshot,state.snapshot,"human revision never changes its original authorized context");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited'").get().count,before+1);
  assert.deepEqual(state.sqlite.prepare("SELECT revision FROM artifact_revisions WHERE artifact_id=? ORDER BY revision").all(ARTIFACT).map((row)=>row.revision),[0,1]);

  const removal=await state.edit("",{},1);
  assert.equal(removal.status,400,JSON.stringify(await removal.clone().json()));
  assert.equal((await removal.json()).issues.some((issue)=>["missing_protected_message","misplaced_protected_message"].includes(issue.code)),true,"an approved correction cannot later remove the required audience-visible closing promise");
  assert.equal(JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content).items[8].body,PROMISE);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited'").get().count,before+1,"a rejected edit never changes revision or audit history");
});

test("refuses foreign, expired, redacted, forged, or mismatched source receipts without weakening generic revision validation",async()=>{
  const mutations={
    "foreign receipt owner":(state)=>state.sqlite.prepare("UPDATE private_content SET owner_id=? WHERE content_id=?").run("another-user",INPUT),
    "expired evidence":(state)=>state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z",INPUT),
    "redacted evidence":(state)=>state.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),INPUT),
    "wrong content kind":(state)=>state.sqlite.prepare("UPDATE private_content SET kind='prompt' WHERE content_id=?").run(INPUT),
    "foreign artifact identity":(state)=>updateReceipt(state,(receipt)=>{receipt.artifact_id="foreign-artifact";}),
    "foreign document identity":(state)=>updateReceipt(state,(receipt)=>{receipt.document_id="foreign-document";}),
    "foreign project identity":(state)=>updateReceipt(state,(receipt)=>{receipt.project_id="foreign-project";}),
    "non-slide receipt":(state)=>updateReceipt(state,(receipt)=>{receipt.artifact_kind="storyboard";}),
    "unsupported receipt schema":(state)=>updateReceipt(state,(receipt)=>{receipt.schema_version=2;}),
    "mismatched item count":(state)=>updateReceipt(state,(receipt)=>{receipt.request.item_count=8;}),
    "mismatched requested count":(state)=>updateReceipt(state,(receipt)=>{receipt.request.requested_slide_count=8;}),
    "foreign snapshot document":(state)=>updateReceipt(state,(receipt)=>{receipt.document_snapshot.document.id="foreign-document";}),
    "invalid JSON receipt":(state)=>state.sqlite.prepare("UPDATE private_content SET content='{' WHERE content_id=?").run(INPUT),
  };
  for(const[label,mutate] of Object.entries(mutations)){
    const state=await fixture();
    mutate(state);
    const response=await state.edit();
    assert.equal(response.status,400,`${label}: ${JSON.stringify(await response.clone().json())}`);
    const rejected=await response.json();
    assert.equal(rejected.error,"invalid_artifact_revision",label);
    assert.equal(rejected.issues.some((issue)=>issue.code==="duplicate_deck_copy"),true,label);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited'").get().count,0,label);
    assert.equal(JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content).items[8].body,"",label);
  }

  const foreignGenerator=await fixture({generatingUserId:"another-user"});
  const rejected=await foreignGenerator.edit();
  assert.equal(rejected.status,400,JSON.stringify(await rejected.clone().json()));
  assert.equal((await rejected.json()).issues.some((issue)=>issue.code==="duplicate_deck_copy"),true,"another generator's actor-private receipt can never authorize the current actor's edits");
  assert.equal(foreignGenerator.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited'").get().count,0);
});

test("never uses another authored slide or an unapproved closing claim to authorize repetition",async()=>{
  const state=await fixture({authorizeClosing:false});
  const response=await state.edit();
  assert.equal(response.status,400,JSON.stringify(await response.clone().json()));
  const rejected=await response.json();
  assert.equal(rejected.error,"invalid_artifact_revision");
  assert.equal(rejected.issues.some((issue)=>issue.code==="duplicate_deck_copy"),true,"the opening alone cannot authorize an unauthored closing phrase");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited'").get().count,0);
});

test("permits the original project author to correct governed slides using only their exactly scoped actor-private receipt",async()=>{
  const state=await governedFixture();
  const response=await state.edit(PROMISE,state.ownerHeaders);
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const revised=await response.json();
  assert.equal(revised.revision,1);
  assert.equal(revised.appended.at(-1)?.type,"DocumentArtifactEdited");
  assert.equal(JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content).items[8].body,PROMISE);
  const retained=state.sqlite.prepare("SELECT revision,organization_id,project_access_id FROM artifact_revisions WHERE artifact_id=? ORDER BY revision").all(ARTIFACT);
  assert.deepEqual(retained.map((row)=>row.revision),[0,1]);
  assert.equal(retained.every((row)=>row.organization_id===state.organizationId&&row.project_access_id===state.projectAccessId),true);
});

test("rejects foreign project tenancy, public evidence visibility, different private actors, and untrusted evidence classification",async()=>{
  const mutations={
    "foreign evidence organization":(state)=>state.sqlite.prepare("UPDATE project_resource_scopes SET organization_id=? WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").run("foreign-organization",state.projectAccessId,INPUT),
    "foreign evidence project":(state)=>state.sqlite.prepare("UPDATE project_resource_scopes SET project_id=? WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").run("foreign-project",state.projectAccessId,INPUT),
    "collaborative evidence exposure":(state)=>state.sqlite.prepare("UPDATE project_resource_scopes SET visibility='collaborative_output' WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").run(state.projectAccessId,INPUT),
    "different evidence actor":(state)=>state.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id=? WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").run("another-project-editor",state.projectAccessId,INPUT),
    "foreign retention organization":(state)=>state.sqlite.prepare("UPDATE private_content_retention_scopes SET organization_id=? WHERE content_id=?").run("foreign-organization",INPUT),
    "foreign retention project":(state)=>state.sqlite.prepare("UPDATE private_content_retention_scopes SET project_id=? WHERE content_id=?").run("foreign-project",INPUT),
    "different retention actor":(state)=>state.sqlite.prepare("UPDATE private_content_retention_scopes SET actor_user_id=? WHERE content_id=?").run("another-project-editor",INPUT),
    "untrusted retention classification":(state)=>state.sqlite.prepare("UPDATE private_content_retention_scopes SET classification='transient-private' WHERE content_id=?").run(INPUT),
    "missing retention classification":(state)=>state.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(INPUT),
  };
  for(const[label,mutate] of Object.entries(mutations)){
    const state=await governedFixture();
    mutate(state);
    const response=await state.edit(PROMISE,state.ownerHeaders);
    assert.equal(response.status,400,`${label}: ${JSON.stringify(await response.clone().json())}`);
    assert.equal((await response.json()).issues.some((issue)=>issue.code==="duplicate_deck_copy"),true,label);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited'").get().count,0,label);
  }
});

test("never lets another authorized project editor consume the generating author's actor-private source receipt",async()=>{
  const state=await governedFixture();
  const identity={"oai-authenticated-user-id":"source-aware-other-editor","oai-authenticated-user-email":"source-aware-other-editor@example.test"};
  assert.equal((await state.request("/api/session",{headers:identity})).status,200);
  state.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run("pilot-2026-08-10","source-aware-other-editor");
  const invited=await state.request(`/api/workspaces/${state.organizationId}/members`,state.json({email:"source-aware-other-editor@example.test",role:"member"}));
  assert.equal(invited.status,201,JSON.stringify(await invited.clone().json()));
  const invitation=await invited.json();
  const accepted=await state.request(`/api/workspaces/${state.organizationId}/invitations/${invitation.invitationId}/accept`,state.json({token:new URL(invitation.invitationUrl).searchParams.get("token")},identity));
  assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
  const membership=await state.request(`/api/workspaces/${state.organizationId}/projects/${state.projectAccessId}/members`,state.json({userId:"source-aware-other-editor",role:"editor"}));
  assert.equal(membership.status,201,JSON.stringify(await membership.clone().json()));
  const editorHeaders=await state.open(identity);
  const response=await state.edit(PROMISE,editorHeaders);
  assert.equal(response.status,400,JSON.stringify(await response.clone().json()));
  const rejected=await response.json();
  assert.equal(rejected.error,"invalid_artifact_revision");
  assert.equal(rejected.issues.some((issue)=>issue.code==="duplicate_deck_copy"),true,"editor permissions do not grant access to another actor's generation inputs");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited'").get().count,0);
});

function updateReceipt(state,edit){
  const receipt=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(INPUT).content);
  edit(receipt);
  state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(receipt),INPUT);
}
