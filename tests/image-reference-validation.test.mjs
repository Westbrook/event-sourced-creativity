import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateImageReferenceStageLimits as validate, captureImageReferenceEvidence as capture, inspectReferenceDimensions as inspect, IMAGE_REFERENCE_MAX_BYTES as MAX } from '../worker/image-reference-validation.ts';
// Synthetic headers exercise container-fact extraction, not pixel/decode validity.
const png=()=>{const b=new Uint8Array(33); b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(8,13);b.set(new TextEncoder().encode('IHDR'),12);v.setUint32(16,64);v.setUint32(20,32);return b;};
const ref=(id='r1')=>({bytes:png(),mimeType:'image/png',referenceId:id,semanticRole:'preserve composition',source:'synthetic-fixture'});
test('tightest stage bytes boundary: below/equal/above 20 MB and 50 MB',()=>{
 for(const n of [MAX-1,MAX])assert.equal(validate([{bytes:new Uint8Array(n),mimeType:'image/png'}]).length,1);
 for(const n of [MAX+1,49_999_999,50_000_000])assert.throws(()=>validate([{bytes:new Uint8Array(n),mimeType:'image/png'}]),/reference_moderation_size_exceeded/);
 assert.throws(()=>validate([{bytes:new Uint8Array(),mimeType:'image/png'}]),/empty/);
 assert.throws(()=>validate([{bytes:png(),mimeType:'image/gif'}]),/type_unsupported/);
 assert.throws(()=>validate(Array.from({length:17},()=>ref())),/count_exceeded/);
});
test('whole selection is validated before any mocked moderation/submission; never omit invalid ref',()=>{
 let calls=0;const refs=[ref(),{...ref('r2'),bytes:new Uint8Array(MAX+1)}];
 const dispatch=()=>{validate(refs); for(const r of refs){void r;calls++;}};
 assert.throws(dispatch,/size_exceeded/); assert.equal(calls,0);assert.equal(refs.length,2);
});
test('no/single/multiple reference manifests bind exact bytes, order, roles and dimensions',async()=>{
 assert.deepEqual(await capture([]),[]);
 const inputs=[ref('r1'),{...ref('r2'),semanticRole:'preserve palette'}];
 for(const count of [1,2]){
  const result=await capture(inputs.slice(0,count));assert.equal(result.length,count);
  for(let i=0;i<count;i++){assert.equal(result[i].order,i);assert.equal(result[i].referenceId,inputs[i].referenceId);assert.equal(result[i].sha256,createHash('sha256').update(inputs[i].bytes).digest('hex'));assert.equal(result[i].byteLength,33);assert.deepEqual(result[i].dimensions,{width:64,height:32,basis:'container-header'});assert.equal(result[i].semanticRole,inputs[i].semanticRole);}
 }
 assert.equal((await capture([...inputs].reverse()))[0].referenceId,'r2');
 await assert.rejects(capture([{...ref(),semanticRole:''}]),/identity_role_required/);
});
test('all inputs are snapshotted before asynchronous hashing',async()=>{
 const refs=[ref(),ref('r2')],expected=createHash('sha256').update(refs[1].bytes).digest('hex');
 const pending=capture(refs);refs[1].bytes.fill(0);refs[1].semanticRole='changed';
 const result=await pending;assert.equal(result[1].sha256,expected);assert.equal(result[1].semanticRole,'preserve composition');
});
test('MIME mismatch and missing dimensions fail closed, JPEG and WebP headers supported',()=>{
 assert.throws(()=>inspect(png(),'image/jpeg'),/dimensions_unverified/);
 assert.throws(()=>inspect(new Uint8Array([1]),'image/png'),/dimensions_unverified/);
 const jpg=new Uint8Array([255,216,255,192,0,8,8,0,32,0,64,1]);assert.equal(inspect(jpg,'image/jpeg').width,64);
 const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'));new DataView(webp.buffer).setUint32(4,22,true);webp.set(new TextEncoder().encode('WEBPVP8X'),8);new DataView(webp.buffer).setUint32(16,10,true);webp[24]=63;webp[27]=31;assert.equal(inspect(webp,'image/webp').height,32);
});
