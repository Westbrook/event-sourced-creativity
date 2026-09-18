import assert from "node:assert/strict";
import test from "node:test";
import { projectNativeRetainedOutput, validateNativeRetainedOutputDto, parseNativeRetainedOutputRoute, nativeRetainedOutputRequestPath, parseNativeRetainedOutputRequestUrl } from "../src/model/native-retained-output.ts";
const selected={documentId:"document-a",artifactId:"audio-a",revision:0,contentSha256:"a".repeat(64)};
const target={output:"audio",selection:selected},expiry="2099-01-01T00:00:00.000Z";
const raw={title:"  Exact 音声\r\n",content_markdown:"\ufeff  Literal <script> & صوت\n\nSecond line.  ",items:[]};
const url="/api/media/u-owner%2Fgenerated%2Faudio.wav";
const receipt=()=>({artifact_kind:"audio",input_ref:"input-a",media_url:url,media_type:"audio/wav",settings:{source_media_sha256:"b".repeat(64),audio_role:"voice",lyrics:"  ملاحظة\n",audio_synthid_watermarked:true,duration_seconds:3,duration_basis:"media-container",duration_media_url:url,duration_media_sha256:"b".repeat(64)}});
const project=(r=receipt())=>projectNativeRetainedOutput(target,raw,expiry,null,{audioReceipt:r});
test("Audio native route and DTO bind the literal format and complete exact selection",()=>{
 const route=`/make/audio?document=document-a&artifact=audio-a&revision=0&sha256=${selected.contentSha256}`;
 assert.deepEqual(parseNativeRetainedOutputRoute(route),target);
 assert.deepEqual(parseNativeRetainedOutputRequestUrl("https://forma.test"+nativeRetainedOutputRequestPath(target)),target);
 const value=project();assert.ok(value);assert.equal(value.title,raw.title);assert.equal(value.content.content_markdown,raw.content_markdown);
 assert.equal(value.content.lyrics,receipt().settings.lyrics);assert.equal(value.content.inputRef,"input-a");assert.deepEqual(value.content.timing,{seconds:3,basis:"measured"});
 assert.deepEqual(validateNativeRetainedOutputDto(value,target),value);assert.ok(Object.isFrozen(value.content.media));
 for(const output of ["scene","slides","storyboard","model3d"])assert.equal(validateNativeRetainedOutputDto(value,{...target,output}),null);
 for(const key of Object.keys(selected))assert.equal(validateNativeRetainedOutputDto(value,{...target,selection:{...selected,[key]:key==="revision"?1:key==="contentSha256"?"c".repeat(64):"other"}}),null);
 for(const alternate of [route+"&revision=0",route+"#",route.replace("/audio?","/audio/?"),route.replace("/audio?","/Audio?"),route+"&input=other"])
 assert.equal(parseNativeRetainedOutputRoute(alternate),null);
});
test("Audio requires selected private media rather than a raw plan or arbitrary URL",()=>{
 assert.equal(projectNativeRetainedOutput(target,raw,expiry),null);
 for(const change of [r=>r.artifact_kind="scene",r=>r.input_ref="../other",r=>r.media_url="https://elsewhere.invalid/audio.wav",r=>r.media_url="/api/shared/token/audio",r=>r.media_url=url+"?x=1",r=>r.media_url=url.replace("audio.wav","%2E%2E%2Faudio.wav"),r=>r.media_type="Audio/WAV",r=>r.settings.source_media_sha256="b",r=>r.settings.audio_role="anything",r=>r.settings.audio_synthid_watermarked="yes"]){const r=receipt();change(r);assert.equal(project(r),null);}
 const r=receipt();r.media_url=null;r.media_type=null;r.settings.source_media_sha256=null;const missing=project(r);assert.ok(missing);assert.equal(missing.content.media,null);assert.equal(missing.content.timing,null);
});
test("Audio preserves timing basis and discards mismatched derived timing without inventing a runtime",()=>{
 for(const [change,timing] of [[r=>r.settings.duration_media_sha256="c".repeat(64),null],[r=>r.settings.duration_media_url=url+"changed",null],[r=>{r.settings.duration_seconds=null;r.settings.estimated_duration_seconds=4;r.settings.duration_basis="estimate";},{seconds:4,basis:"estimate"}],[r=>delete r.settings.duration_basis,{seconds:3,basis:"recorded"}]]){const r=receipt();change(r);assert.deepEqual(project(r).content.timing,timing);}
});
test("Audio closed metadata and DTO reject accessors and surplus fields without invoking them",()=>{
 let reads=0;const options={};Object.defineProperty(options,"audioReceipt",{enumerable:true,get(){reads++;return receipt();}});
 assert.equal(projectNativeRetainedOutput(target,raw,expiry,null,options),null);
 const r=receipt();Object.defineProperty(r.settings,"source_media_sha256",{enumerable:true,get(){reads++;return "b".repeat(64);}});assert.equal(project(r),null);
 const dto=project();assert.ok(dto);assert.equal(validateNativeRetainedOutputDto({...dto,content:{...dto.content,waveformEditable:true}},target),null);
 assert.equal(validateNativeRetainedOutputDto({...dto,content:{...dto.content,media:{...dto.content.media,extra:1}}},target),null);assert.equal(reads,0);
});
