import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import {
  openGallery, currentArtifact, currentHash, currentDelivery, currentReview,
  nodes, text, click, settle, promote, reviewControl, disabled, loadActual,
} from "./helpers/artifact-review-host.mjs";
import { storePrivateContent } from "../worker/pilot-policy.ts";
import { storeGeneratedMedia } from "../worker/media-api.ts";
import { appendAuditEvent } from "../worker/runtime.ts";
import { documentArtifactValidationIssues, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { wav, png, mp4 } from "./output-asset-fixtures.mjs";

// Actual complete viewer + Store + routed Worker + in-memory SQLite. New correctly
// typed retained outputs are fixture setup, NOT a provider generation/completion
// claim. Valid binary fixtures enter the existing server storage helper. No
// existing story/output bytes are converted, mutated or approved by fixture fiat.
// Native DOM ports do not download/play these assets or claim browser/AT coverage.
const portUrl=new URL("./event-source-retirement-continuations.test.mjs",import.meta.url);
const portSource=fs.readFileSync(portUrl,"utf8"),portTree=ts.createSourceFile(portUrl.pathname,portSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const bucketDeclaration=portTree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="retainActualUploadedMedia");
assert.ok(bucketDeclaration);
const {retainActualUploadedMedia}=await import("data:text/javascript;base64,"+Buffer.from(bucketDeclaration.getFullText(portTree)+"\nexport {retainActualUploadedMedia};").toString("base64"));

// Re-export only the existing fixture frame and actual reviewer setup, keeping
// every helper/production method intact. Seed all retained records before the
// full Store's ordinary content=1 bootstrap, not into a content=0 delta.
const hostUrl=new URL("./helpers/artifact-review-host.mjs",import.meta.url);
const hostSource=fs.readFileSync(hostUrl,"utf8"),hostVirtual=hostUrl.href+"?media-title-retained-setup";
const hostHook=registerHooks({load(url,context,next){return url===hostVirtual
 ?{format:"module",source:hostSource+"\nexport {fixture,shareWithIndependentReviewer};\n",shortCircuit:true}:next(url,context);}});
const {fixture:createFrame,shareWithIndependentReviewer}=await import(hostVirtual).finally(()=>hostHook.deregister());
const {localizeTemplateResult}=await loadActual("src/components/design-system/localized-template.ts");

const profiles=[
  {id:"audio-direct",kind:"audio",count:1,mime:"audio/wav",bytes:wav,direct:true,archive:false},
  {id:"video-direct",kind:"video",count:1,mime:"video/mp4",bytes:mp4,direct:true,archive:false},
  {id:"video-archive",kind:"video",count:2,mime:"video/mp4",bytes:mp4,direct:true,archive:true},
  {id:"storyboard-archive",kind:"storyboard",count:2,mime:"image/png",bytes:png,direct:false,archive:true},
];
const financialTables=["document_jobs","budget_reservations","cost_budget_reservations","cost_budget_counters"];
const finance=worker=>Object.fromEntries(financialTables.map(table=>[table,worker.sqlite.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()]));
const exactContentRows=worker=>worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all();
const reviews=request=>request.body?.events?.some(event=>["ArtifactReviewRequested","ArtifactApproved"].includes(event.type));
const exports=request=>request.body?.events?.some(event=>event.type==="DocumentArtifactExported");

async function mediaHost(t,{locale="en",profile,shared=false}){
 const worker=await createSceneCostFixture(1,"visual",{depth:true});
 const priorRows=exactContentRows(worker),priorHistory=worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all(),beforeFinance=finance(worker);
 const bucket=retainActualUploadedMedia({worker}),artifactId="retained-media-"+profile.id;
 const storedMedia=[];
 for(let index=0;index<profile.count;index++){
  const bytes=profile.bytes(),media=await storeGeneratedMedia(worker.env,worker.owner,artifactId+"-"+index,bytes,"retained-copy-fixture",profile.mime,{source:"synthetic-retained-fixture",provider:"simulation"});
  assert.deepEqual(bucket.get(media.key).bytes,bytes);assert.equal(bucket.get(media.key).customMetadata.ownerId,worker.owner);
  storedMedia.push(media);
 }
 const bodies=["A quiet harbor opens as the keeper checks the tide.","Mara closes the brass lantern and walks toward the lighthouse."];
 const draft={title:"Retained "+profile.kind+" fixture",summary:"Synthetic retained media for presentation-copy verification.",
  content_markdown:bodies.slice(0,profile.count).join("\n\n"),presentation:null,
  items:Array.from({length:profile.count},(_,index)=>({title:index?"Lighthouse":"Harbor",body:bodies[index],notes:"Preserve the retained source direction.",image_prompt:"A fixture image, not a generation request.",context_group_ids:[],slide:null}))};
 assert.deepEqual(documentArtifactValidationIssues(profile.kind,parseDocumentArtifactContent(JSON.stringify(draft)),{itemCount:profile.count}),[]);
 const content=JSON.stringify(draft),stored=await storePrivateContent(worker.env,worker.owner,"document-artifact",content);
 const completion=await appendAuditEvent(worker.env,worker.streamId,"worker:renderer","DocumentRenderCompleted",{
  project_id:worker.projectId,document_id:worker.documentId,artifact_id:artifactId,artifact_kind:profile.kind,
  title:draft.title,summary:draft.summary,content_ref:stored.contentId,item_count:profile.count,
  source_block_versions:[{block_id:"scene-reuse-direction",version:1}],requested_by_user_id:worker.owner,
  items:draft.items.map((item,index)=>({id:artifactId+"-item-"+index,title:item.title,media_url:storedMedia[index].url,media_type:profile.mime,
    ...(profile.kind==="storyboard"?{width:3,height:2}:{})})),
  media_url:profile.direct?storedMedia[0].url:null,media_type:profile.direct?profile.mime:null,
  provider:"simulation",model_id:"retained-copy-fixture",simulation:true,source_surface:"document",
 });

 assert.deepEqual(finance(worker),beforeFinance,"retained media setup never creates generation or financial usage");
 const sharing=shared?await shareWithIndependentReviewer(worker):null;
 const h=await createSceneStoreHost({workerFixture:worker,shared});h.store.patchUi({instrumentation:false});
 const pending=new Set(),replies=[];
 h.transport=async request=>{const task=worker.request(request.url,request.init);pending.add(task);try{
  const response=await task;replies.push({request,status:response.status,body:await response.clone().json()});return response;
 }finally{pending.delete(task);}};
 t.mock.method(globalThis,"fetch",async(url,init)=>{assert.ok(String(url).startsWith("/api/"),"no provider or external call");return h.fetch(url,init);});
 const f=createFrame("create",{locale});f.store=h.store;f.host.store=h.store;f.host.documentId=worker.documentId;f.host.launcherOnly=false;
 f.reviewReplies=replies;f.artifactId=artifactId;f.state.documentId=worker.documentId;
 const render=f.renderer.value;f.renderer.value=function(value,...rest){return render.call(this,localizeTemplateResult(value,f.i18n),...rest);};f.draw();
 const initialCounts=worker.counts();
 t.after(async()=>{await settle(f,()=>pending.size===0,"all actual application responses finish");
  assert.deepEqual(worker.counts(),initialCounts,"the media-title check never admits generation or reserves budget");
  f.host.isConnected=false;f.host.disconnectedCallback();
  for(const{instance}of f.renderer.instances.values())if(instance.isConnected){instance.isConnected=false;instance.disconnectedCallback();}
  f.i18n.hostDisconnected();await h.close();
 });
 const switchActor=async role=>{assert.ok(sharing);worker.setScopedHeaders(role==="reviewer"?sharing.reviewerHeaders:sharing.ownerHeaders);
  const response=await worker.request("/api/session");assert.equal(response.status,200);h.store.session.set(await response.json());await h.store.refreshEvents();f.draw();};
 const artifact=currentArtifact(f);assert.ok(artifact);assert.equal(artifact.kind,profile.kind);
 assert.equal(artifact.sourceEventId,completion.eventId);assert.equal(artifact.contentRef,stored.contentId);
 assert.equal(h.store.content.get()[artifact.contentRef],content,"ordinary actual content=1 bootstrap supplies exact retained bytes");
 assert.equal(artifact.itemCount,profile.count);assert.equal(artifact.items.length,profile.count);
 assert.equal(artifact.mediaUrl,profile.direct?storedMedia[0].url:null);
 for(let index=0;index<profile.count;index++)assert.equal(artifact.items[index].mediaUrl,storedMedia[index].url);
 for(const row of priorRows)assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.content_id),row,"all preexisting retained content is untouched");
 for(const row of priorHistory)assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id),row,"all original story/history rows remain exact");
 assert.ok(finance(worker).cost_budget_counters.every(row=>row.reserved_microusd===0&&row.used_microusd===0),"ordinary account/workspace initialization has no reserved or spent money");
 return{f,h,worker,replies,sharing,switchActor,profile,bucket,storedMedia,content,contentId:stored.contentId,beforeFinance:finance(worker),
  frozenPrivate:exactContentRows(worker),frozenMedia:structuredClone([...bucket]),originalHash:currentHash(f),priorHistory};
}
function mediaControls(f){
 const all=nodes(f,"button");
 return{direct:all.find(node=>node.handlers.click?.toString().includes("#downloadMedia(artifact)")),
  archive:all.find(node=>node.handlers.click?.toString().includes("#downloadMediaArchive(artifact)"))};
}
function originalMediaUnchanged(x){
 const{f,h,worker}=x;
 assert.deepEqual(exactContentRows(worker),x.frozenPrivate,"retained content/custody rows are byte-exact");
 assert.deepEqual([...x.bucket],x.frozenMedia,"existing server-custodied fixture media bytes/metadata are unchanged");
 for(const row of x.priorHistory)assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id),row,"original story history remains byte-exact");
 assert.equal(currentHash(f),x.originalHash);
 assert.deepEqual(finance(worker),x.beforeFinance);
 assert.equal(h.requests.filter(exports).length,0,"this title check never exports");
 assert.ok(h.requests.every(row=>row.init.method!=="POST"||row.url==="/api/events"&&reviews(row)),"only actual explicit review actions, never generation/media work");
}
async function approveExactMedia(x){
 const {f,h,worker,sharing,switchActor}=x;
 await openGallery(f);await promote(f);
 assert.equal(currentDelivery(f).approved,false);assert.equal(currentDelivery(f).releaseAllowed,false);
 const selected=nodes(f,"select").find(node=>node.handlers.change?.toString().includes("#selectedReviewerId"));
 assert.ok(selected);assert.equal(selected.value,sharing.reviewer);assert.equal(reviewControl(f,"ArtifactApproved"),undefined);
 click(f,reviewControl(f,"ArtifactReviewRequested"));await settle(f,()=>currentReview(f).status==="in-review");
 const requested=x.replies.findLast(row=>row.request.body?.events?.some(event=>event.type==="ArtifactReviewRequested"));
 assert.equal(requested?.status,200);assert.equal(requested.body.appended.length,1);
 const receipt=requested.body.appended[0];assert.equal(receipt.actor,"user:"+worker.owner);
 assert.equal(receipt.payload.artifact_id,f.artifactId);assert.equal(receipt.payload.document_id,worker.documentId);
 assert.equal(receipt.payload.assigned_reviewer_user_id,sharing.reviewer);assert.equal(receipt.payload.artifact_revision,0);
 assert.equal(receipt.payload.content_sha256,x.originalHash);
 await switchActor("reviewer");await openGallery(f);await promote(f);
 assert.equal(currentDelivery(f).action,"review");click(f,reviewControl(f,"ArtifactApproved"));
 await settle(f,()=>currentDelivery(f).approved);
 const approved=x.replies.findLast(row=>row.request.body?.events?.some(event=>event.type==="ArtifactApproved"));
 assert.equal(approved?.status,200);assert.equal(approved.body.appended.length,1);
 const acknowledgment=approved.body.appended[0];assert.equal(acknowledgment.actor,"user:"+sharing.reviewer);
 assert.equal(acknowledgment.payload.artifact_id,f.artifactId);assert.equal(acknowledgment.payload.document_id,worker.documentId);
 assert.equal(acknowledgment.payload.artifact_revision,0);assert.equal(acknowledgment.payload.content_sha256,x.originalHash);
 for(const row of[receipt,acknowledgment])assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(row.eventId).n,1);
 assert.equal(h.requests.filter(row=>row.init.method==="POST").length,2);
 return{receipt,acknowledgment};
}
async function revokeMediaSource(x){
 await appendAuditEvent(x.worker.env,x.worker.streamId,"user:"+x.worker.owner,"ChipEdited",{
  project_id:x.worker.projectId,document_id:x.worker.documentId,block_id:"scene-reuse-direction",property:"rights_revoked",new_value:true,
 });
 await x.h.store.refreshEvents();x.f.draw();
 assert.deepEqual(currentDelivery(x.f).rightsBlockIds,["scene-reuse-direction"]);assert.equal(currentDelivery(x.f).releaseAllowed,false);
}
for(const locale of["en","fr","ar","ja"])for(const profile of profiles)for(const scenario of["personal","shared-approved","shared-unapproved","personal-revoked"]){
 test("actual media export title "+locale+"/"+profile.id+"/"+scenario,async t=>{
  const x=await mediaHost(t,{locale,profile,shared:scenario.startsWith("shared")}),{f,h}=x;
  if(scenario==="shared-approved")await approveExactMedia(x);
  else{if(scenario==="personal-revoked")await revokeMediaSource(x);await openGallery(f);}
  const state=currentDelivery(f),history=structuredClone(h.store.events.get()),controls=mediaControls(f);
  const approved=scenario==="shared-approved",allowed=scenario==="personal"||approved;
  assert.equal(state.approved,approved);assert.equal(state.releaseAllowed,allowed);assert.equal(state.exportReceipt,null);
  assert.equal(Boolean(controls.direct),profile.direct);assert.equal(Boolean(controls.archive),profile.archive);
  for(const[branch,control]of Object.entries(controls))if(control){
   assert.equal(disabled(control),!allowed,branch+" exact release gate");
   assert.equal(control.attributes.title,allowed?approved?f.i18n.system("Download the approved media"):f.i18n.t("projects.downloadMedia","Download media"):scenario==="personal-revoked"?f.i18n.t("artifact.delivery.currentSourcesBlocked","Export is blocked now: the inputs changed or their rights are no longer current."):f.i18n.system("Independent approval is required before export"),
    "an enabled personal media control must not invent independent approval");
   if(allowed&&!approved)assert.notEqual(control.attributes.title,f.i18n.system("Download the approved media"));
   const visible=text(f,control);assert.ok(visible.length);
   if(branch==="direct")assert.equal(visible,profile.kind==="audio"?f.i18n.t("audio.output.download","Download audio"):profile.count>1?f.i18n.system("Download first scene"):f.i18n.system("Download media"));
   else assert.equal(visible,f.i18n.t("projects.downloadMedia","Download media")+" · "+f.i18n.number(profile.count)+" "+f.i18n.system(profile.kind==="storyboard"?"frames":"scenes"));
  }
  assert.deepEqual(h.store.events.get(),history);
  originalMediaUnchanged(x);
 });
}
