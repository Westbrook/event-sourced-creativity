import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseAudioTrimOperationRequest, audioTrimOperationFingerprintInput, encodeAudioConversionSource, AUDIO_LOCAL_CONVERSION_MEDIA_TYPE, parseAudioLocalConversion } from "../src/model/audio-local-conversion.ts";
import { encodeBrowserPcm16 } from "../src/model/audio-local-conversion-browser.ts";
import { inspectPcmWav, PCM_WAV_EDIT_MAX_BYTES, trimPcmWav } from "../src/model/audio-container.ts";
import { parseDocumentArtifactContent, parseAudioMediaRevision, documentArtifactRevision } from "../src/model/document-artifacts.ts";
const require=createRequire(process.env.FORMA_SOURCE_ROOT?process.env.FORMA_SOURCE_ROOT+"/package.json":new URL("../package.json",import.meta.url));
const ts=require("typescript"),source=readFileSync(new URL("../src/state/store.ts",import.meta.url),"utf8");
const ast=ts.createSourceFile("store.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const parent=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaStore");assert(parent);
const names=["reviseDocumentArtifact","#validatedAudioTrimSave","checkAudioTrimOperation"];
const members=names.map(name=>{const found=parent.members.find(node=>node.name?.getText(ast)===name&&node.body);assert(found,name);return found.getText(ast).replaceAll("this.#","this._").replace(/^async #/,"async _");});
const moduleText=ts.transpileModule("class Harness {"+members.join("\n")+"}",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const bindings={parseAudioTrimOperationRequest,audioTrimOperationFingerprintInput,encodeAudioConversionSource,AUDIO_LOCAL_CONVERSION_MEDIA_TYPE,inspectPcmWav,PCM_WAV_EDIT_MAX_BYTES,parseDocumentArtifactContent,parseAudioMediaRevision,documentArtifactRevision};
const Harness=Function(...Object.keys(bindings),moduleText+";return Harness;")(...Object.values(bindings));
const sha=value=>createHash("sha256").update(value).digest("hex"),cell=value=>({get:()=>value,set:next=>{value=next;}});
function fixture(){
 const pcm=encodeBrowserPcm16([new Float32Array(8000)],8000),trim=trimPcmWav(pcm,1000,7000);
 const sourceRaw=JSON.stringify(parseDocumentArtifactContent(JSON.stringify({title:"Owned Audio",content_markdown:"Original notes",items:[]})));
 const conversion=parseAudioLocalConversion({method:"browser-decode-pcm16-v1",provenance:"client-local",sourceMediaType:"audio/mpeg",sourceByteLength:834,decodedMediaSha256:sha(pcm),decodedByteLength:pcm.length,sampleRate:8000,channels:1,frameCount:8000});
 const input={expectedRevision:0,expectedContentSha256:sha(sourceRaw),audioTrim:{sourceMediaSha256:"b".repeat(64),sourceFrameCount:8000,startFrame:1000,endFrame:7000,resultMediaSha256:sha(trim.bytes),conversion}};
 const artifact={id:"audio-one",kind:"audio",documentId:"document-one",contentRef:"content-one",mediaUrl:"/api/media/owner%2Foriginal.mp3",mediaType:"audio/mpeg",settings:{source_media_sha256:"b".repeat(64)}};
 const store=new Harness(),owner={},authorization={},observation={source:owner,paused:false,pending:true,receipt:{observationId:"one",owner},attempted:false};
 store.projection=cell({projectId:"project-one",libraryArtifacts:[artifact]});store.content=cell({[artifact.contentRef]:sourceRaw});store.events=cell([]);store.route=cell("/document/document-one/audio");store.session=cell({user:{userId:"owner"}});
 store.busy=cell("");store.notify=()=>{};store.captureSourceOwnership=()=>owner;store.active=true;store.sourceOwnershipActive=value=>value===owner&&store.active;store.sourceOwnershipScopeActive=store.sourceOwnershipActive;
 store._activeAuthorizationScope=()=>authorization;store._scopeStillActive=value=>value===authorization&&store.active;store._assertAuthorizationScope=value=>{assert(store._scopeStillActive(value));};
 store._admitEventWrite=async()=>({admitted:true,observation});store._finishEventWrite=(_value,patch)=>{observation.pending=false;observation.finished=patch;};
 store._eventWriteObservations=new Map([["one",observation]]);store._appendPipeline=Promise.resolve();store._sourceContent=value=>value;
 store._validateEventWriteBody=result=>({complete:true,appended:result.appended,committed:result.appended,rejected:[],rejectedIndices:[],head:result.head});
 store._mergeConfirmed=events=>{store.events.set(events);};store.releaseEventWriteAcknowledgment=()=>{};
 const revision=parseAudioMediaRevision({schemaVersion:1,operation:"client-converted-trim",conversion,
  media:{url:"/api/media/owner%2Ftrim.wav",mediaType:"audio/wav",sha256:sha(trim.bytes),byteLength:trim.bytes.length},
  source:{url:artifact.mediaUrl,sha256:input.audioTrim.sourceMediaSha256,frameCount:8000,revision:0,contentSha256:sha(sourceRaw)},startFrame:1000,endFrame:7000,sampleRate:8000,channels:1,bitsPerSample:16,frameCount:6000,durationSeconds:.75});
 const raw=JSON.stringify({...JSON.parse(sourceRaw),audio_revision:revision}),event={type:"DocumentArtifactEdited",payload:{artifact_id:artifact.id,document_id:artifact.documentId,project_id:"project-one",content_ref:artifact.contentRef,revision:1,audio_revision:revision,content_sha256:sha(raw),audio_trim_request_sha256:sha(JSON.stringify(input))}};
 const result={appended:[event],head:1,revision:1,content:{[artifact.contentRef]:raw}},calls=[];
 return{store,pcm,input,observation,result,calls,artifact,sourceRaw};
}
test("actual Store save sends one snapshotted private PCM wire; unknown result retains descriptor and Check uses GET only",async()=>{
 const f=fixture();let release;f.store._appendPipeline=new Promise(resolve=>{release=resolve;});
 f.store.guardedFetch=async(path,init,_description,controls)=>{assert(controls.current());controls.onDispatch?.();f.calls.push({path,init});
  if(init.method==="PATCH")throw Error("lost response");return Response.json(f.result);};
 const pending=f.store.reviseDocumentArtifact(f.artifact.id,f.input,f.pcm);
 // Wait for the actual admitted operation to enter the append queue.
 while(!f.observation.audioTrim)await new Promise(resolve=>setImmediate(resolve));
 const originalHash=sha(f.pcm);f.pcm.fill(7);release();
 const unknown=await pending;assert.deepEqual(unknown,{status:"unconfirmed",code:"unconfirmed"});assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].init.headers["content-type"],AUDIO_LOCAL_CONVERSION_MEDIA_TYPE);
 const sent=JSON.parse(f.calls[0].init.body);assert.equal(sha(Buffer.from(sent.convertedAudioSource,"base64")),originalHash);assert.deepEqual(sent.operation,f.input);
 assert(!JSON.stringify(f.observation.audioTrim).includes("convertedAudioSource"));
 const checked=await f.store.checkAudioTrimOperation(f.artifact.id,f.input);assert.equal(checked.status,"saved");
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].init.method,"GET");assert.equal(f.calls[1].init.body,undefined);
 assert.equal(new URL(f.calls[1].path,"http://localhost").searchParams.get("audioTrimOperation"),sha(JSON.stringify(f.input)));
});
test("actual Store current-source fence refuses queued conversion after route withdrawal with zero transport",async()=>{
 const f=fixture();let release;f.store._appendPipeline=new Promise(resolve=>{release=resolve;});f.store.guardedFetch=async()=>{throw Error("transport must not run");};
 const pending=f.store.reviseDocumentArtifact(f.artifact.id,f.input,f.pcm);while(!f.observation.audioTrim)await new Promise(resolve=>setImmediate(resolve));
 f.store.route.set("/document/elsewhere/audio");release();assert.deepEqual(await pending,{status:"retired",code:"retired"});
 assert.equal(f.observation.attempted,false);assert.equal(f.store.content.get()[f.artifact.contentRef],f.sourceRaw);
});
test("actual Store ACK verifier rejects changed provenance and late Check authority withdrawal without publishing",async()=>{
 const f=fixture();f.observation.pending=false;f.observation.audioTrim={artifactId:f.artifact.id,request:f.input,contentRef:f.artifact.contentRef,documentId:f.artifact.documentId,projectId:"project-one",sourceMediaUrl:f.artifact.mediaUrl,sourceRaw:f.sourceRaw,sourceRevision:0};
 const malformed=structuredClone(f.result),body=JSON.parse(malformed.content[f.artifact.contentRef]);body.audio_revision.conversion.sourceByteLength++;
 malformed.content[f.artifact.contentRef]=JSON.stringify(body);malformed.appended[0].payload.audio_revision=body.audio_revision;malformed.appended[0].payload.content_sha256=sha(malformed.content[f.artifact.contentRef]);
 assert.equal(await f.store._validatedAudioTrimSave(f.observation.audioTrim,malformed,malformed.appended),null);
 f.store.guardedFetch=async(_path,init)=>{assert.equal(init.method,"GET");return{ok:true,status:200,json:async()=>{f.store.active=false;return f.result;}};};
 assert.deepEqual(await f.store.checkAudioTrimOperation(f.artifact.id,f.input),{status:"retired",code:"retired"});
 assert.equal(f.store.content.get()[f.artifact.contentRef],f.sourceRaw);assert.deepEqual(f.store.events.get(),[]);
});
