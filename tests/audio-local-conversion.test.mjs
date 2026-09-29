import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AUDIO_LOCAL_CONVERSION_MEDIA_TYPE, AUDIO_LOCAL_CONVERSION_WIRE_MAX_BYTES, parseAudioLocalConversion,
  parseAudioTrimOperationRequest, audioTrimOperationFingerprintInput, encodeAudioConversionSource, readAudioConversionWire } from "../src/model/audio-local-conversion.ts";
import { encodeBrowserPcm16, prepareLocalAudioConversion } from "../src/model/audio-local-conversion-browser.ts";
import { inspectPcmWav, trimPcmWav } from "../src/model/audio-container.ts";
import { parseAudioMediaRevision } from "../src/model/document-artifacts.ts";
const sha = value => createHash("sha256").update(value).digest("hex");
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const bytes = encodeBrowserPcm16([Float32Array.from([-.5, 0, .5, 1, -1, .25, -.25, 0])], 8000);
  const conversion = parseAudioLocalConversion({method:"browser-decode-pcm16-v1",provenance:"client-local",sourceMediaType:"audio/mpeg",
    sourceByteLength:834,decodedMediaSha256:sha(bytes),decodedByteLength:bytes.length,sampleRate:8000,channels:1,frameCount:8});
  const trimmed = trimPcmWav(bytes,2,6);
  const operation = {expectedRevision:0,expectedContentSha256:"a".repeat(64),audioTrim:{
    sourceMediaSha256:"b".repeat(64),sourceFrameCount:8,startFrame:2,endFrame:6,resultMediaSha256:sha(trimmed.bytes),conversion}};
  return {bytes,conversion,operation,trimmed};
}
const wire = value => new Request("https://forma.invalid/api/document-artifacts/doc/artifact", {
  method:"PATCH",headers:{"content-type":AUDIO_LOCAL_CONVERSION_MEDIA_TYPE},body:JSON.stringify(value)});
const wireObject = f => ({operation:f.operation,convertedAudioSource:encodeAudioConversionSource(f.bytes)});
const original = () => {const bytes=new Uint8Array(417*2);for(let offset=0;offset<bytes.length;offset+=417)bytes.set([0xff,0xfb,0x90,0],offset);return bytes;};
const bounded = (promise,ms=500) => {let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("control timed out")),ms);})]).finally(()=>clearTimeout(timer));};
test("ordinary trim fingerprints remain byte-compatible; converted requests retain only exact closed descriptors", () => {
  const f=fixture(),old=plain(f.operation);delete old.audioTrim.conversion;
  assert.equal(audioTrimOperationFingerprintInput(old),JSON.stringify(old));
  assert.deepEqual(parseAudioTrimOperationRequest(f.operation),f.operation);
  assert(!audioTrimOperationFingerprintInput(f.operation).includes("convertedAudioSource"));
  const invalid=[{...f.conversion,provenance:"server-certified"},{...f.conversion,frameCount:9},{...f.conversion,channels:3},
    {...f.conversion,sourceByteLength:26*1024*1024},{...f.conversion,decodedMediaSha256:"A".repeat(64)},{...f.conversion,extra:true},null];
  for(const value of invalid)assert.equal(parseAudioLocalConversion(value),null);
  let read=false;const accessor={...f.conversion};Object.defineProperty(accessor,"frameCount",{enumerable:true,get(){read=true;return 8;}});
  assert.equal(parseAudioLocalConversion(accessor),null);assert.equal(read,false);
  const mismatch=plain(f.operation);mismatch.audioTrim.sourceFrameCount=9;assert.equal(parseAudioTrimOperationRequest(mismatch),null);
});
test("canonical PCM frame bytes and client-local revision are distinct from legacy server-derived trim",()=>{
  const f=fixture();assert.deepEqual(inspectPcmWav(f.bytes),{sampleRate:8000,channels:1,bitsPerSample:16,frameCount:8,durationSeconds:.001});
  assert.deepEqual([...f.trimmed.bytes.slice(44)],[...f.bytes.slice(48,56)]);
  const revision={schemaVersion:1,operation:"client-converted-trim",conversion:f.conversion,
    media:{url:"/api/media/owner%2Fedit.wav",mediaType:"audio/wav",sha256:sha(f.trimmed.bytes),byteLength:f.trimmed.bytes.length},
    source:{url:"/api/media/owner%2Foriginal.mp3",sha256:"b".repeat(64),frameCount:8,revision:0,contentSha256:"a".repeat(64)},
    sampleRate:8000,channels:1,bitsPerSample:16,frameCount:4,durationSeconds:.0005,startFrame:2,endFrame:6};
  assert.deepEqual(parseAudioMediaRevision(revision),revision);
  assert.equal(parseAudioMediaRevision({...revision,operation:"trim"}),null);
  const missing={...revision};delete missing.conversion;assert.equal(parseAudioMediaRevision(missing),null);
  assert.equal(parseAudioMediaRevision({...revision,conversion:{...f.conversion,frameCount:7}}),null);
  assert.throws(()=>encodeBrowserPcm16([Float32Array.of(NaN)],8000),/invalid/);
  assert.throws(()=>encodeBrowserPcm16([Float32Array.of(0),Float32Array.of(0),Float32Array.of(0)],8000),/unsupported/);
});
test("private converted wire reads exact PCM while retained request has no bytes",async()=>{
  const f=fixture(),result=await readAudioConversionWire(wire(wireObject(f)));
  assert(result);assert.deepEqual(result.bytes,f.bytes);assert.deepEqual(result.request,f.operation);
  assert(!JSON.stringify(result.request).includes("convertedAudioSource"));
  result.bytes.fill(0);assert.notEqual(sha(f.bytes),sha(result.bytes));
});
test("wire rejects MIME, invalid UTF8, length mismatches, base64 substitutions, sparse descriptor and oversized declaration",async()=>{
  const f=fixture(),value=wireObject(f);
  for(const change of [{...value,other:1},{...value,convertedAudioSource:value.convertedAudioSource+"="},
    {...value,operation:{...f.operation,audioTrim:{...f.operation.audioTrim,conversion:null}}}])
    assert.equal(await readAudioConversionWire(wire(change)),null);
  assert.equal(await readAudioConversionWire(new Request("https://forma.invalid",{method:"PATCH",body:JSON.stringify(value),headers:{"content-type":"application/json"}})),null);
  assert.equal(await readAudioConversionWire(new Request("https://forma.invalid",{method:"PATCH",body:Uint8Array.of(0xc3,0x28),headers:{"content-type":AUDIO_LOCAL_CONVERSION_MEDIA_TYPE}})),null);
  for(const length of ["1","-1",String(AUDIO_LOCAL_CONVERSION_WIRE_MAX_BYTES+1)])assert.equal(await readAudioConversionWire(new Request("https://forma.invalid",{method:"PATCH",body:"{}",headers:{"content-type":AUDIO_LOCAL_CONVERSION_MEDIA_TYPE,"content-length":length}})),null);
});
test("observed wire overflow rejects promptly despite a stalled or rejecting stream cancellation and releases lock",async()=>{
  for(const cancel of [()=>new Promise(()=>{}),()=>Promise.reject(Error("cancel refused"))]){
    let cancellations=0;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(AUDIO_LOCAL_CONVERSION_WIRE_MAX_BYTES+1));},cancel(){cancellations++;return cancel();}});
    assert.equal(await bounded(readAudioConversionWire(new Request("https://forma.invalid",{method:"PATCH",headers:{"content-type":AUDIO_LOCAL_CONVERSION_MEDIA_TYPE},body,duplex:"half"}))),null);
    assert.equal(cancellations,1);assert.equal(body.locked,false);
  }
});
test("explicit browser preparation snapshots original, binds native PCM hash and never saves or plays",async t=>{
  const previous=globalThis.AudioContext;let closes=0,decodes=0;
  globalThis.AudioContext=class{decodeAudioData(bytes){decodes++;assert.equal(sha(new Uint8Array(bytes)),sha(original()));return Promise.resolve({numberOfChannels:1,length:8,sampleRate:8000,getChannelData:()=>new Float32Array(8)});}close(){closes++;return Promise.resolve();}};
  t.after(()=>{globalThis.AudioContext=previous;});
  const bytes=original(),hash=sha(bytes),pending=prepareLocalAudioConversion(bytes,hash,{signal:new AbortController().signal,current:()=>true});bytes.fill(1);
  const result=await pending;assert.equal(decodes,1);assert.equal(closes,1);
  assert.equal(result.conversion.provenance,"client-local");assert.equal(result.conversion.sourceByteLength,834);assert.equal(result.conversion.decodedMediaSha256,sha(result.bytes));
  assert.equal(inspectPcmWav(result.bytes).frameCount,8);assert(Object.isFrozen(result)&&Object.isFrozen(result.conversion));assert.equal(bytes[0],1);
});
test("withdrawal during native decode rejects promptly, observes late result and never regains conversion",async t=>{
  const previous=globalThis.AudioContext,abort=new AbortController();let release,entered,closes=0;
  const decoding=new Promise(resolve=>{entered=resolve;});
  globalThis.AudioContext=class{decodeAudioData(){entered();return new Promise(resolve=>{release=resolve;});}close(){closes++;return new Promise(()=>{});}};
  t.after(()=>{globalThis.AudioContext=previous;});const bytes=original();
  const pending=prepareLocalAudioConversion(bytes,sha(bytes),{signal:abort.signal,current:()=>true});await decoding;abort.abort();
  await assert.rejects(bounded(pending),/retired/);assert.equal(closes,1);
  let sampled=0;release({numberOfChannels:1,length:8,sampleRate:8000,getChannelData(){sampled++;return new Float32Array(8);}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sampled,0);
});
test("source withdrawal after raw hash prevents native decoder allocation; invalid decoded channels fail",async t=>{
  const previous=globalThis.AudioContext;let contexts=0,checks=0;
  globalThis.AudioContext=class{constructor(){contexts++;}decodeAudioData(){return Promise.resolve({numberOfChannels:3,length:8,sampleRate:8000});}close(){return Promise.reject(Error("closed"));}};
  t.after(()=>{globalThis.AudioContext=previous;});const bytes=original();
  await assert.rejects(prepareLocalAudioConversion(bytes,sha(bytes),{signal:new AbortController().signal,current:()=>++checks===1}),/retired/);assert.equal(contexts,0);
  await assert.rejects(prepareLocalAudioConversion(bytes,sha(bytes),{signal:new AbortController().signal,current:()=>true}),/unsupported/);assert.equal(contexts,1);
});
