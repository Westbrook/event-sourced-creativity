import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ownerMediaNamespace } from '../src/model/media-ownership.ts';
import { originalGeneratedImageUrl as resolve } from '../src/model/generated-image-original-url.ts';

const source=await readFile(new URL('../worker/generated-image-api.ts',import.meta.url),'utf8');
const owner='owner-original',generation='original-generation',token='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const url=(who=owner,id=generation)=>'/api/media/'+encodeURIComponent(ownerMediaNamespace(who)+'/generated/'+id+'.png');
const recoveredUrl=url(owner,generation+'-recovery-'+token);
const event=()=>({clientId:'output-fal-recovery',actor:'worker:generator',payload:{generation_id:generation,media_url:recoveredUrl,recovered:true,provider:'fal',model_id:'ideogram/v4',source_surface:'outputs'}});

// Path-policy controls, not a generated image or live ownership proof.
test('normal generated image path remains exact and recovery path requires its actual producer',()=>{
  assert.equal(resolve(owner,{payload:{generation_id:generation,media_url:url()}}),url());
  assert.equal(resolve(owner,event()),recoveredUrl);
  assert.equal(resolve(owner,{payload:{generation_id:generation,media_url:recoveredUrl}}),null);
  const e=event();e.payload.media_url=url();assert.equal(resolve(owner,e),null);
});
test('recovery resolver rejects foreign owners/generations, edits, traversal, redirects and malformed tokens',()=>{
  for(const media_url of [url('other',generation+'-recovery-'+token),url(owner,'other-recovery-'+token),url(owner,'image-edit-'+token),
    recoveredUrl+'?token=x',recoveredUrl+'#fragment','https://example.com'+recoveredUrl,recoveredUrl.replace(token,'not-a-uuid'),
    recoveredUrl.replace('-4ccc-','-1ccc-'),recoveredUrl.replace('-8ddd-','-7ddd-'),recoveredUrl.replace('.png','.jpg'),url(owner,generation+'/../other')]){
    const e=event();e.payload.media_url=media_url;assert.equal(resolve(owner,e),null,media_url);
  }
  for(const patch of [{provider:'openai'},{model_id:'other'},{source_surface:'document'},{recovered:false},{generation_id:'../other'}]){
    const e=event();Object.assign(e.payload,patch);assert.equal(resolve(owner,e),null);
  }
  for(const patch of [{clientId:'other'},{actor:'user'}])assert.equal(resolve(owner,{...event(),...patch}),null);
});
test('private reader retains original event, hash, ownership and projection checks around path selection',()=>{
  assert.ok(source.includes('const originalUrl = originalGeneratedImageUrl(actor.userId,completed);'));
  for(const guard of ['aliases.length === 1','hash(p.source_content_hash)','originEnvelope.private_owner === actor.userId',
    'initialOutput[0]!.mediaUrl === originalUrl','await assertCurrent(env, current, life)','value.customMetadata.sha256 === expectedHash'])assert.ok(source.includes(guard),guard);
});
