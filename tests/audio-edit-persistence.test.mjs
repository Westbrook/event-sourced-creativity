import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleArtifactEdit, handleNativeRetainedOutputRead, nativeRetainedOutputRequestPath, runtime, mediaApi, model, audio, foldEvents, worker;
try {
  ({handleArtifactEdit} = await import("../worker/artifact-api.ts"));
  ({handleNativeRetainedOutputRead} = await import("../worker/retained-story-api.ts"));
  ({nativeRetainedOutputRequestPath} = await import("../src/model/native-retained-output.ts"));
  runtime = await import("../worker/runtime.ts");
  mediaApi = await import("../worker/media-api.ts");
  model = await import("../src/model/document-artifacts.ts");
  audio = await import("../src/model/audio-container.ts");
  ({foldEvents} = await import("../src/model/events.ts"));
  ({default:worker} = await import("../worker/index.ts"));
} finally { imports.deregister(); }
const hash = value => createHash("sha256").update(value).digest("hex");
const OWNER="audio-trim-owner", EMAIL="audio-trim-owner@example.test", DOCUMENT="audio-trim-document", PROJECT="audio-trim-project", ARTIFACT="audio-trim-artifact", CONTENT="audio-trim-content";
const headers={"oai-authenticated-user-id":OWNER,"oai-authenticated-user-email":EMAIL};
const json=value=>({method:"PATCH",headers:{...headers,"content-type":"application/json","origin":"https://forma.test"},body:JSON.stringify(value)});
function nonSilentWav() {
  const frames=32, rate=8000, channels=2, bytes=new Uint8Array(44+frames*channels*2), view=new DataView(bytes.buffer), ascii=(at,value)=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
  ascii(0,"RIFF");view.setUint32(4,bytes.length-8,true);ascii(8,"WAVEfmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);ascii(36,"data");view.setUint32(40,frames*channels*2,true);
  for(let frame=0;frame<frames;frame++){view.setInt16(44+frame*4,(frame+1)*317,true);view.setInt16(46+frame*4,-(frame+1)*509,true);}return bytes;
}
async function fixture(t, {sourceBytes=nonSilentWav()}={}) {
  const state=outputTestDatabase(), background=[];await runtime.ensureSchema(state.env);const now=new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(OWNER,EMAIL,EMAIL.split("@")[0],"creator","pilot-2026-08-10",now,now,now);
  const streamId=`creative:${OWNER}`;
  await runtime.appendAuditEvent(state.env,streamId,"user","ProjectCreated",{project_id:PROJECT,name:"Audio trim controls"});
  await runtime.appendAuditEvent(state.env,streamId,"user","DocumentCreated",{project_id:PROJECT,document_id:DOCUMENT,title:"Audio trim source"});
  const originalBytes=sourceBytes, media=await mediaApi.storeGeneratedMedia(state.env,OWNER,ARTIFACT,originalBytes,"synthetic-pcm-fixture","audio/wav",{source:"synthetic-retained-fixture"});
  const raw=JSON.stringify(model.parseDocumentArtifactContent(JSON.stringify({title:"Harbor clip",summary:"Deterministic non-silent PCM fixture",content_markdown:"Original accompanying notes remain unchanged.",presentation:null,items:[{title:"Harbor notes",body:"These notes are not a newly generated transcript.",notes:"Synthetic non-silent samples; no human listening claim.",image_prompt:"",slide:null}]})));
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)").run(CONTENT,OWNER,"document-artifact",raw,now,"2099-01-01T00:00:00.000Z");
  const completion=await runtime.appendAuditEvent(state.env,streamId,"worker:renderer","DocumentRenderCompleted",{project_id:PROJECT,document_id:DOCUMENT,artifact_id:ARTIFACT,artifact_kind:"audio",requested_by_user_id:OWNER,title:"Harbor clip",content_ref:CONTENT,input_ref:"audio-trim-original-input",item_count:1,items:[{id:"audio-trim-part",title:"Harbor notes"}],media_url:media.url,media_type:"audio/wav",settings:{audio_role:"voice",lyrics:"Original retained lyrics",source_media_sha256:hash(originalBytes),duration_seconds:32/8000,duration_basis:"media-container",duration_media_url:media.url,duration_media_sha256:hash(originalBytes)}});
  const initialCompletion=state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(completion.eventId).private_json;
  const currentRaw=()=>state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content;
  const events=()=>runtime.readWorkspaceEvents(state.env,streamId);
  const revision=()=>state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND type='DocumentArtifactEdited'").get(streamId).count;
  const requestFor=(startFrame=4,endFrame=20,bytes=originalBytes,expectedRevision=0,sourceRaw=raw)=>({expectedRevision,expectedContentSha256:hash(sourceRaw),audioTrim:{sourceMediaSha256:hash(bytes),sourceFrameCount:audio.inspectPcmWav(bytes).frameCount,startFrame,endFrame,resultMediaSha256:hash(audio.trimPcmWav(bytes,startFrame,endFrame).bytes)}});
  const edit=(input=requestFor())=>handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}`,json(input)),state.env,ARTIFACT);
  const restore=(selected,expectedRevision)=>handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}/revisions/${selected}/restore`,{...json({expectedRevision}),method:"POST"}),state.env,ARTIFACT,["revisions",String(selected),"restore"]);
  const native=()=>handleNativeRetainedOutputRead(new Request(`https://forma.test${nativeRetainedOutputRequestPath({output:"audio",selection:{documentId:DOCUMENT,artifactId:ARTIFACT,revision:revision(),contentSha256:hash(currentRaw())}})}`,{headers}),state.env);
  let closed=false;
  const result={...state,owner:OWNER,documentId:DOCUMENT,projectId:PROJECT,streamId,requestId:"audio-trim-local",payload:{},contentRef:CONTENT,content:raw,media,originalBytes,raw,completion,initialCompletion,currentRaw,events,revision,requestFor,edit,restore,native,
    request:(path,init={})=>{assert.match(path,/^\/api\/(?:session|events|artifacts)(?:[/?]|$)/u);return worker.fetch(new Request("https://forma.test"+path,{...init,headers:{...headers,...Object.fromEntries(new Headers(init.headers))}}),state.env,{waitUntil:p=>background.push(p)});},
    close(){if(closed)return;closed=true;try{state.sqlite.close();}finally{state.media.clear();}}};
  t.after(async()=>{
    let failure;
    try{while(background.length)await Promise.all(background.splice(0));}
    catch(error){failure={error};}
    finally{try{result.close();}catch(error){failure={error:failure?new AggregateError([failure.error,error],"Audio fixture cleanup failed",{cause:failure.error}):error};}}
    if(failure)throw failure.error;
  });
  return result;
}

test("actual PCM Save persists exact clip and native reopen while original bytes/history remain immutable",async t=>{
 const f=await fixture(t),input=f.requestFor(),expected=audio.trimPcmWav(f.originalBytes,4,20).bytes;
 const response=await f.edit(input);assert.equal(response.status,200,await response.clone().text());const ack=await response.json();assert.equal(ack.appended.length,1);assert.equal(ack.revision,1);assert.equal(f.revision(),1);
 const saved=model.parseDocumentArtifactContent(f.currentRaw());assert.equal(saved.content_markdown,model.parseDocumentArtifactContent(f.raw).content_markdown);assert.deepEqual(saved.items,model.parseDocumentArtifactContent(f.raw).items);
 assert.equal(saved.audio_revision.media.sha256,hash(expected));assert.equal(saved.audio_revision.durationSeconds,16/8000);assert.equal(saved.audio_revision.frameCount,16);assert.equal(saved.audio_revision.media.byteLength,expected.length);
 const key=decodeURIComponent(saved.audio_revision.media.url.slice("/api/media/".length));const bytes=new Uint8Array(await new Response((await f.env.MEDIA.get(key)).body).arrayBuffer());assert.deepEqual(bytes,expected);
 assert.deepEqual(new Uint8Array(await new Response((await f.env.MEDIA.get(f.media.key)).body).arrayBuffer()),f.originalBytes);assert.equal(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId).private_json,f.initialCompletion);
 const old=f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE artifact_id=? AND revision=0").get(ARTIFACT);assert.equal(old.content_json,f.raw);
 const projection=foldEvents(await f.events(),Infinity,DOCUMENT,PROJECT),artifact=projection.artifacts.find(value=>value.id===ARTIFACT);assert.equal(artifact.mediaUrl,saved.audio_revision.media.url);assert.equal(artifact.settings.source_media_sha256,hash(expected));
 const reopened=await f.native();assert.equal(reopened.status,200,await reopened.clone().text());const dto=await reopened.json();assert.deepEqual(dto.content.media,{url:saved.audio_revision.media.url,mediaType:"audio/wav",sha256:hash(expected)});assert.deepEqual(dto.content.timing,{seconds:16/8000,basis:"measured"});assert.equal(dto.content.lyrics,"Original retained lyrics");assert.equal(dto.content.inputRef,"audio-trim-original-input");
});
test("original and edited history restore create coherent new revisions without replacing media",async t=>{
 const f=await fixture(t);assert.equal((await f.edit()).status,200);const edited=f.currentRaw(),mediaCount=f.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get().n;
 assert.equal((await f.restore(0,1)).status,200);assert.equal(f.currentRaw(),f.raw);assert.equal(f.revision(),2);let dto=await (await f.native()).json();assert.equal(dto.content.media.url,f.media.url);
 let projected=foldEvents(await f.events(),Infinity,DOCUMENT,PROJECT).artifacts.find(value=>value.id===ARTIFACT);assert.equal(projected.mediaUrl,f.media.url);
 assert.equal((await f.restore(1,2)).status,200);assert.equal(f.currentRaw(),edited);assert.equal(f.revision(),3);dto=await (await f.native()).json();assert.equal(dto.content.media.url,JSON.parse(edited).audio_revision.media.url);
 projected=foldEvents(await f.events(),Infinity,DOCUMENT,PROJECT).artifacts.find(value=>value.id===ARTIFACT);assert.equal(projected.mediaUrl,JSON.parse(edited).audio_revision.media.url);assert.equal(mediaCount,2);assert.equal((await f.env.MEDIA.list()).objects.length,2);
});
test("D1 trigger-inclusive changes acknowledge the exact committed Audio Save and both history restores",async t=>{
 const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB),observed=[];
 f.env.DB.batch=async statements=>{
  if(!statements[0]?.sql.includes("INSERT INTO event_write_stage")||!statements[0]?.sql.includes("private_content"))return batch(statements);
  const originals=statements.map(statement=>statement.execute),metrics=[];observed.push(metrics);
  statements.forEach((statement,index)=>{statement.execute=function(kind){
   const before=f.sqlite.prepare("SELECT total_changes() AS n").get().n,result=originals[index].call(this,kind);
   const changes=f.sqlite.prepare("SELECT total_changes() AS n").get().n-before;
   metrics.push({success:result.success,directChanges:result.meta.changes,changes});return {...result,meta:{...result.meta,changes}};
  };});
  try{return await batch(statements);}finally{statements.forEach((statement,index)=>{statement.execute=originals[index];});}
 };
 const assertAck=async(response,revision,raw)=>{
  assert.equal(response.status,200,await response.clone().text());const ack=await response.json();
  assert.equal(ack.revision,revision);assert.equal(ack.appended.length,1);assert.equal(ack.content[CONTENT],raw);assert.equal(f.currentRaw(),raw);assert.equal(f.revision(),revision);
  const event=ack.appended[0],publicRow=f.sqlite.prepare("SELECT payload FROM events WHERE event_id=?").get(event.eventId);
  const privateRow=f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(event.eventId);
  assert.equal(JSON.parse(publicRow.payload).revision,revision);assert.deepEqual(JSON.parse(privateRow.private_json),event.payload);assert.equal(event.payload.content_sha256,hash(raw));
  const retained=f.sqlite.prepare("SELECT content_json,content_sha256 FROM artifact_revisions WHERE artifact_id=? AND revision=?").get(ARTIFACT,revision);
  assert.equal(retained.content_json,raw);assert.equal(retained.content_sha256,hash(raw));return ack;
 };
 const savedResponse=await f.edit(),saved=f.currentRaw(),savedAck=await assertAck(savedResponse,1,saved),audioRevision=JSON.parse(saved).audio_revision;
 assert.deepEqual(savedAck.appended[0].payload.audio_revision,audioRevision);assert.equal(audioRevision.media.sha256,f.requestFor().audioTrim.resultMediaSha256);
 const originalAck=await assertAck(await f.restore(0,1),2,f.raw);assert.equal(originalAck.appended[0].payload.audio_revision,null);
 const restoredAck=await assertAck(await f.restore(1,2),3,saved);assert.deepEqual(restoredAck.appended[0].payload.audio_revision,audioRevision);
 assert.equal(observed.length,3);for(const metrics of observed){assert.equal(metrics[0].directChanges,1);assert(metrics[0].changes>metrics[0].directChanges);assert(metrics.every(value=>value.success===true&&Number.isSafeInteger(value.changes)&&value.changes>0));}
 assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE artifact_id=? AND revision=0").get(ARTIFACT).content_json,f.raw);
 assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE artifact_id=? AND revision=1").get(ARTIFACT).content_json,saved);
 assert.equal(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId).private_json,f.initialCompletion);
 assert.deepEqual(new Uint8Array(await new Response((await f.env.MEDIA.get(f.media.key)).body).arrayBuffer()),f.originalBytes);assert.equal((await f.env.MEDIA.list()).objects.length,2);
 const reopened=await f.native();assert.equal(reopened.status,200,await reopened.clone().text());assert.equal((await reopened.json()).content.media.sha256,audioRevision.media.sha256);
});
test("incomplete or invalid Audio batch metadata never acknowledges or deletes a committed trim",async t=>{
 for(const fault of ["not-array","empty-array","missing-result","extra-result","hole","missing-meta","missing-changes","zero","fraction","nan","infinity","numeric-string","false-success","missing-success","unsafe-integer"])await t.test(fault,async child=>{
  const f=await fixture(child),batch=f.env.DB.batch.bind(f.env.DB);let intercepted=0;
  f.env.DB.batch=async statements=>{
   const results=await batch(statements);if(!statements[0]?.sql.includes("INSERT INTO event_write_stage")||!statements[0]?.sql.includes("private_content"))return results;
   intercepted++;if(fault==="not-array")return null;if(fault==="empty-array")return [];if(fault==="missing-result")return results.slice(1);if(fault==="extra-result")return [...results,results[0]];
   if(fault==="hole"){delete results[0];return results;}if(fault==="missing-meta"){delete results[0].meta;return results;}if(fault==="missing-changes"){delete results[0].meta.changes;return results;}
   if(fault==="false-success"){results[0].success=false;return results;}if(fault==="missing-success"){delete results[0].success;return results;}
   results[0].meta.changes={zero:0,fraction:0.5,nan:NaN,infinity:Infinity,"numeric-string":"1","unsafe-integer":Number.MAX_SAFE_INTEGER+1}[fault];return results;
  };
  const response=await f.edit();assert.equal(response.status,503,await response.clone().text());assert.equal((await response.json()).error,"audio_trim_unconfirmed");assert.equal(intercepted,1);assert.equal(f.revision(),1);
  const saved=JSON.parse(f.currentRaw()),key=decodeURIComponent(saved.audio_revision.media.url.slice("/api/media/".length));assert.equal(saved.audio_revision.media.sha256,f.requestFor().audioTrim.resultMediaSha256);
  assert.equal(hash(new Uint8Array(await new Response((await f.env.MEDIA.get(key)).body).arrayBuffer())),saved.audio_revision.media.sha256);assert.equal((await f.env.MEDIA.list()).objects.length,2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get().n,2);assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE artifact_id=? AND revision=0").get(ARTIFACT).content_json,f.raw);
 });
});
test("a committed Audio history restore with missing metadata remains unconfirmed and retains exact history",async t=>{
 const f=await fixture(t);assert.equal((await f.edit()).status,200);const edited=f.currentRaw(),batch=f.env.DB.batch.bind(f.env.DB);let intercepted=0;
 f.env.DB.batch=async statements=>{const results=await batch(statements);if(statements[0]?.sql.includes("INSERT INTO event_write_stage")&&statements[0]?.sql.includes("private_content")){intercepted++;delete results[0].meta;}return results;};
 const response=await f.restore(0,1);assert.equal(response.status,503,await response.clone().text());assert.equal((await response.json()).error,"audio_trim_unconfirmed");assert.equal(intercepted,1);assert.equal(f.revision(),2);assert.equal(f.currentRaw(),f.raw);
 const event=(await f.events()).filter(value=>value.type==="DocumentArtifactEdited").at(-1),privateRow=f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(event.eventId);
 assert.equal(event.payload.revision,2);assert.equal(event.payload.revision_action,"restore");assert.equal(event.payload.audio_revision,null);assert.equal(event.payload.content_sha256,hash(f.raw));assert.deepEqual(JSON.parse(privateRow.private_json),event.payload);
 for(const [revision,raw] of [[0,f.raw],[1,edited],[2,f.raw]]){const retained=f.sqlite.prepare("SELECT content_json,content_sha256 FROM artifact_revisions WHERE artifact_id=? AND revision=?").get(ARTIFACT,revision);assert.equal(retained.content_json,raw);assert.equal(retained.content_sha256,hash(raw));}
 assert.equal((await f.env.MEDIA.list()).objects.length,2);assert.deepEqual(new Uint8Array(await new Response((await f.env.MEDIA.get(f.media.key)).body).arrayBuffer()),f.originalBytes);
});
test("full interval is an exact no-op; invalid bounds, hashes and unavailable media do not write",async t=>{
 for(const fault of ["noop","fraction","empty","hash","frameCount","stale-content","foreign-owner","changed-media-hash"] )await t.test(fault,async child=>{
  const f=await fixture(child),input=f.requestFor();
  if(fault==="noop")Object.assign(input,f.requestFor(0,32));if(fault==="fraction")input.audioTrim.startFrame=4.5;if(fault==="empty")input.audioTrim.endFrame=4;
  if(fault==="hash")input.audioTrim.resultMediaSha256="a".repeat(64);if(fault==="frameCount")input.audioTrim.sourceFrameCount=33;if(fault==="stale-content")input.expectedContentSha256="c".repeat(64);
  if(fault==="foreign-owner"||fault==="changed-media-hash"){const object=await f.env.MEDIA.get(f.media.key),bytes=new Uint8Array(await new Response(object.body).arrayBuffer());if(fault==="changed-media-hash")bytes[20]=3;await f.env.MEDIA.put(f.media.key,bytes,{httpMetadata:{contentType:"audio/wav"},customMetadata:{...object.customMetadata,...(fault==="foreign-owner"?{ownerId:"foreign"}:{sha256:hash(bytes)})}});}
  const response=await f.edit(input);assert.equal(response.status===200,fault==="noop",await response.clone().text());if(fault==="noop"){const body=await response.json();assert.deepEqual(body.appended,[]);assert.equal(body.content[CONTENT],f.raw);}
  assert.equal(f.currentRaw(),f.raw);assert.equal(f.revision(),0);assert.equal((await f.env.MEDIA.list()).objects.length,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get().n,0);
 });
});
test("commit-time authority and source guards refuse a retired save and remove only its uncommitted staging object",async t=>{
 for(const fault of ["role","consent","source","head"])await t.test(fault,async child=>{
  const f=await fixture(child),batch=f.env.DB.batch.bind(f.env.DB);let intercepted=0;
  f.env.DB.batch=async statements=>{if(statements[0]?.sql.includes("INSERT INTO event_write_stage")&&statements[0]?.sql.includes("private_content")){intercepted++;
   if(fault==="role")f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);if(fault==="consent")f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(OWNER);
   if(fault==="source")f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(f.raw+" ",CONTENT);
   if(fault==="head")await runtime.appendAuditEvent({...f.env,DB:{...f.env.DB,batch}},f.streamId,"user","DocumentRenamed",{document_id:DOCUMENT,project_id:PROJECT,title:"Concurrent source action"});
  }return batch(statements);};
  const response=await f.edit();assert.equal(response.status,409,await response.clone().text());assert.equal(intercepted,1);assert.equal(f.revision(),0);assert.equal((await f.env.MEDIA.list()).objects.length,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get().n,0);
 });
});
test("lost DB ACK retains the possible commit and explicit exact-operation reconciliation creates nothing twice",async t=>{
 const f=await fixture(t),input=f.requestFor(),batch=f.env.DB.batch.bind(f.env.DB);let dropped=false;
 f.env.DB.batch=async statements=>{const result=await batch(statements);if(!dropped&&statements[0]?.sql.includes("INSERT INTO event_write_stage")&&statements[0]?.sql.includes("private_content")){dropped=true;throw new Error("Deliberately lost committed response");}return result;};
 const response=await f.edit(input);assert.equal(response.status,503);assert.equal(f.revision(),1);const raw=f.currentRaw(),event=(await f.events()).find(value=>value.type==="DocumentArtifactEdited"),objects=(await f.env.MEDIA.list()).objects;
 const changes=f.sqlite.prepare("SELECT total_changes() AS n").get().n;
 const checked=await handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}?audioTrimOperation=${hash(JSON.stringify(input))}&expectedRevision=0`,{headers}),f.env,ARTIFACT);
 assert.equal(checked.status,200,await checked.clone().text());assert.equal((await checked.json()).appended[0].eventId,event.eventId);assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n,changes,"Check is a read of the original save");
 const reconciled=await f.edit(input);assert.equal(reconciled.status,200,await reconciled.clone().text());const ack=await reconciled.json();assert.equal(ack.appended[0].eventId,event.eventId);assert.equal(ack.content[CONTENT],raw);assert.deepEqual((await f.env.MEDIA.list()).objects,objects);assert.equal(f.revision(),1);
 for(const fault of ["range","source","revision"]){const changed=structuredClone(input);if(fault==="range")changed.audioTrim.startFrame++;if(fault==="source")changed.audioTrim.sourceMediaSha256="e".repeat(64);if(fault==="revision")changed.expectedRevision=1;assert.equal((await f.edit(changed)).status,409);}
 assert.equal(f.revision(),1);assert.deepEqual((await f.env.MEDIA.list()).objects,objects);
});

test("actual Store publishes only exact trim ACK and never auto-repeats an uncertain save",async t=>{
 const {createSceneStoreHost}=await import("./helpers/scene-cost-store-host.mjs");
 for(const fault of ["none","missing-content","wrong-media","lost-response","retired"])await t.test(fault,async child=>{
  const f=await fixture(child),host=await createSceneStoreHost({workerFixture:f,exposeSceneTestAccessors:false});child.after(()=>host.close());const original=host.store.content.get()[CONTENT];
  host.intercept=async request=>{if(!request.url.startsWith("/api/artifacts/"))return undefined;const response=await f.request(request.url,request.init);if(fault==="lost-response")throw new Error("Original response lost");const body=await response.json();
   if(fault==="missing-content")delete body.content;if(fault==="wrong-media"){const content=JSON.parse(body.content[CONTENT]);content.audio_revision.media.sha256="f".repeat(64);body.content[CONTENT]=JSON.stringify(content);}if(fault==="retired")host.store.route.set("/projects");return Response.json(body,{status:response.status});};
  const outcome=await host.store.reviseDocumentArtifact(ARTIFACT,f.requestFor());assert.equal(outcome.status,fault==="none"?"saved":fault==="retired"?"retired":"unconfirmed",JSON.stringify(outcome));assert.equal(f.revision(),1);
  assert.equal(host.requests.filter(value=>value.url.startsWith("/api/artifacts/")&&value.init.method==="PATCH").length,1);
  assert.equal(host.store.content.get()[CONTENT]===original,fault!=="none");if(fault==="none"){const current=host.store.projection.get().libraryArtifacts.find(value=>value.id===ARTIFACT);assert.equal(current.mediaUrl,outcome.audioRevision.media.url);assert.equal(model.documentArtifactRevision(host.store.events.get(),ARTIFACT),1);}
 });
});

test("Store explicit Check observes its lost original ACK through one GET and publishes no second write",async t=>{
 const {createSceneStoreHost}=await import("./helpers/scene-cost-store-host.mjs"),f=await fixture(t),host=await createSceneStoreHost({workerFixture:f,exposeSceneTestAccessors:false});t.after(()=>host.close());
 const input=f.requestFor();let lost=false;
 host.intercept=async request=>{if(request.url.startsWith("/api/artifacts/")&&request.init.method==="PATCH"){const response=await f.request(request.url,request.init);assert.equal(response.status,200);lost=true;throw new Error("Transport lost the original ACK");}return undefined;};
 assert.equal((await host.store.reviseDocumentArtifact(ARTIFACT,input)).status,"unconfirmed");assert.equal(lost,true);assert.equal(f.revision(),1);const objects=(await f.env.MEDIA.list()).objects;
 const result=await host.store.checkAudioTrimOperation(ARTIFACT,input);assert.equal(result.status,"saved",JSON.stringify(result));assert.equal(model.documentArtifactRevision(host.store.events.get(),ARTIFACT),1);
 assert.equal(host.requests.filter(value=>value.url.startsWith("/api/artifacts/")&&value.init.method==="PATCH").length,1);
 assert.equal(host.requests.filter(value=>value.url.includes("audioTrimOperation=")&&value.init.method==="GET").length,1);assert.equal(f.revision(),1);assert.deepEqual((await f.env.MEDIA.list()).objects,objects);
});

test("Audio restore keeps commit-time principal and personal custody guards after retained-media reads",async t=>{
 for(const fault of ["role","consent","rescope"])await t.test(fault,async child=>{
  const f=await fixture(child);assert.equal((await f.edit()).status,200);assert.equal((await f.restore(0,1)).status,200);const before=f.currentRaw(),objects=(await f.env.MEDIA.list()).objects,batch=f.env.DB.batch.bind(f.env.DB);let intercepted=0;
  f.env.DB.batch=async statements=>{if(statements[0]?.sql.includes("INSERT INTO event_write_stage")&&statements[0]?.sql.includes("private_content")){intercepted++;
   if(fault==="role")f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);if(fault==="consent")f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(OWNER);
   if(fault==="rescope")f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,'artifact',?,?,?,?,?,?)").run("scope-during-restore",ARTIFACT,"organization-during-restore",PROJECT,OWNER,OWNER,new Date().toISOString());
  }return batch(statements);};
  const response=await f.restore(1,2);assert.equal(response.status,409,await response.clone().text());assert.equal(intercepted,1);assert.equal(f.revision(),2);assert.equal(f.currentRaw(),before);assert.deepEqual((await f.env.MEDIA.list()).objects,objects);
 });
});
test("bounded source read rejects an overlong observed stream without creating an edit",async t=>{
 const f=await fixture(t),get=f.env.MEDIA.get.bind(f.env.MEDIA);let canceled=0,reads=0;
 f.env.MEDIA.get=async key=>{const object=await get(key);if(!object)return object;return {...object,body:new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(f.originalBytes.length+1));},cancel(){canceled++;}})};};
 const response=await f.edit();assert.equal(response.status,404);assert.equal(f.revision(),0);assert.equal(f.currentRaw(),f.raw);assert.ok(canceled>=1);assert.ok(reads<=3);assert.equal((await f.env.MEDIA.list()).objects.length,1);
});
test("Check cannot infer non-commit from an absent operation and never submits the original save",async t=>{
 const {createSceneStoreHost}=await import("./helpers/scene-cost-store-host.mjs"),f=await fixture(t),host=await createSceneStoreHost({workerFixture:f,exposeSceneTestAccessors:false});t.after(()=>host.close());
 host.intercept=async request=>{if(request.url.startsWith("/api/artifacts/")&&request.init.method==="PATCH")throw new Error("Original delivery is unknown");return undefined;};
 const input=f.requestFor();assert.equal((await host.store.reviseDocumentArtifact(ARTIFACT,input)).status,"unconfirmed");assert.equal((await host.store.checkAudioTrimOperation(ARTIFACT,input)).status,"unconfirmed");
 assert.equal(f.revision(),0);assert.equal((await f.env.MEDIA.list()).objects.length,1);assert.equal(host.requests.filter(value=>value.url.startsWith("/api/artifacts/")&&value.init.method==="PATCH").length,1);
});

test("Worker rejects authoritative unsupported WAV encoding after exact source-byte/hash verification",async t=>{
 const sourceBytes=nonSilentWav();new DataView(sourceBytes.buffer).setUint16(20,3,true);
 const f=await fixture(t,{sourceBytes}),sourceHash=hash(sourceBytes),candidate=audio.trimPcmWav(nonSilentWav(),4,20).bytes;
 const input={expectedRevision:0,expectedContentSha256:hash(f.raw),audioTrim:{sourceMediaSha256:sourceHash,sourceFrameCount:32,startFrame:4,endFrame:20,resultMediaSha256:hash(candidate)}};
 const object=await f.env.MEDIA.get(f.media.key);assert.equal(object.customMetadata.sha256,sourceHash);assert.equal(JSON.parse(f.initialCompletion).settings.source_media_sha256,sourceHash);
 assert.equal(audio.inspectPcmWav(sourceBytes),null);assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()),sourceBytes);
 const response=await f.edit(input);assert.equal(response.status,400);assert.equal((await response.json()).error,"audio_trim_unsupported","Source digest passed; actual strict encoding parser refuses IEEE-float-tagged data");
 assert.equal(f.currentRaw(),f.raw);assert.equal(f.revision(),0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get().n,0);assert.equal((await f.env.MEDIA.list()).objects.length,1);
});

test("Audio historical expiry during retained-media await cannot be restored after its retention deadline",async t=>{
 const f=await fixture(t);assert.equal((await f.edit()).status,200);const edited=JSON.parse(f.currentRaw()),editedKey=decodeURIComponent(edited.audio_revision.media.url.slice("/api/media/".length));
 assert.equal((await f.restore(0,1)).status,200);const before=f.currentRaw(),objects=(await f.env.MEDIA.list()).objects,get=f.env.MEDIA.get.bind(f.env.MEDIA);let expiredDuringRead=false;
 f.env.MEDIA.get=async key=>{const object=await get(key);if(key===editedKey&&!expiredDuringRead){
   expiredDuringRead=true;const deadline=new Date(Date.now()+50).toISOString();
   f.sqlite.prepare("UPDATE artifact_revisions SET expires_at=? WHERE artifact_id=? AND revision=1").run(deadline,ARTIFACT);
   await new Promise(resolve=>setTimeout(resolve,100));
   assert.equal(f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS expired FROM artifact_revisions WHERE artifact_id=? AND revision=1").get(ARTIFACT).expired,1);
  }return object;};
 const response=await f.restore(1,2);assert.equal(expiredDuringRead,true);assert.equal(response.status,409,await response.clone().text());assert.equal(f.currentRaw(),before);assert.equal(f.revision(),2);assert.deepEqual((await f.env.MEDIA.list()).objects,objects);
});

test("full revision validation and size refusal happen before staging any edited media",async t=>{
 for(const fault of ["near-cap","invalid-title"])await t.test(fault,async child=>{
  const f=await fixture(child),body=JSON.parse(f.raw);body.summary="";
  if(fault==="near-cap")body.summary="x".repeat(999900-Buffer.byteLength(JSON.stringify(body)));else body.title="";
  const raw=JSON.stringify(body);f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw,CONTENT);
  if(fault==="near-cap"){assert.equal(Buffer.byteLength(raw),999900);assert.deepEqual(model.documentArtifactValidationIssues("audio",model.parseDocumentArtifactContent(raw),{itemCount:1}),[]);}
  let puts=0;const put=f.env.MEDIA.put.bind(f.env.MEDIA);f.env.MEDIA.put=async(...args)=>{puts++;return put(...args);};
  const response=await f.edit(f.requestFor(4,20,f.originalBytes,0,raw));assert.equal(response.status,400);assert.equal((await response.json()).error,fault==="near-cap"?"artifact_revision_too_large":"invalid_artifact_revision");
  assert.equal(puts,0);assert.equal(f.revision(),0);assert.equal(f.currentRaw(),raw);assert.equal((await f.env.MEDIA.list()).objects.length,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get().n,0);
 });
});

async function audioCancelWithin(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

test("native stream cancellation closes pending reads before underlying cancellation settles", { timeout: 4000 }, async () => {
  let releaseCancel;
  const cancelGate = new Promise(resolve => { releaseCancel = resolve; });
  const reader = new ReadableStream({ cancel() { return cancelGate; } }).getReader();
  const pendingRead = reader.read();
  let firstCancelSettled = false;
  const firstCancel = reader.cancel().then(() => { firstCancelSettled = true; });
  try {
    assert.deepEqual(await audioCancelWithin(pendingRead, 1000, "native pending read did not close"), { value: undefined, done: true });
    await audioCancelWithin(reader.cancel(), 1000, "second cancellation of closed stream did not settle");
    assert.equal(firstCancelSettled, false, "underlying cancellation remains explicitly held");
  } finally {
    releaseCancel();
    await audioCancelWithin(firstCancel, 1000, "released native cancellation did not settle");
    reader.releaseLock();
  }
});

test("overlong owned Audio source refusal does not await held underlying cancellation", { timeout: 4000 }, async t => {
  const f = await fixture(t);
  const get = f.env.MEDIA.get.bind(f.env.MEDIA);
  const objectsBefore = (await f.env.MEDIA.list()).objects;
  let releaseCancel, enteredCancel, cancelCalls = 0, reads = 0;
  const cancelGate = new Promise(resolve => { releaseCancel = resolve; });
  const cancelEntered = new Promise(resolve => { enteredCancel = resolve; });
  f.env.MEDIA.get = async key => {
    const object = await get(key);
    if (!object) return object;
    return { ...object, body: new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(f.originalBytes.length + 1)); },
      cancel() { cancelCalls++; enteredCancel(); return cancelGate; },
    }) };
  };
  // Convert both outcomes to a fulfilled observation before any deadline race.
  const operation = f.edit().then(response => ({ response }), error => ({ error }));
  let refusedBeforeCancelRelease = false;
  try {
    await audioCancelWithin(cancelEntered, 1000, "overlong source did not reach native cancellation");
    // This finite diagnostic window is not a production performance guarantee.
    // Baseline waits on the explicitly held gate and fails here; cleanup below releases it.
    const observed = await audioCancelWithin(operation, 250, "Audio refusal awaits underlying cancellation after clearing its timer");
    if (observed.error) throw observed.error;
    assert.equal(observed.response.status, 404);
    refusedBeforeCancelRelease = true;
  } finally {
    releaseCancel();
    const final = await audioCancelWithin(operation, 1000, "Audio operation did not settle after releasing cancellation");
    assert.ifError(final.error);
    assert.equal(final.response.status, 404);
    assert.equal(f.revision(), 0);
    assert.equal(f.currentRaw(), f.raw);
    assert.deepEqual((await f.env.MEDIA.list()).objects, objectsBefore);
    assert.equal(cancelCalls, 1);
    assert.ok(reads <= 3);
    t.diagnostic(JSON.stringify({ refusedBeforeCancelRelease, finalStatus: final.response.status,
      cancelCalls, reads, revision: f.revision(), retainedObjectCount: objectsBefore.length }));
  }
});
