import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { imageAdapterCacheMatches, retainedCandidateBaseline } from '../scripts/image-adapter-eval-cache.mjs';

const bytes=Buffer.from('retained Image 2 pixels');
const expected={caseId:'retained-case',canonicalPromptHash:'canonical',providerPromptHash:'canonical',bytes};
const receipt={status:'completed',provider:'openai',model:'gpt-image-2',adapterId:'openai-image',adapterVersion:'v5',canonicalPromptHash:'canonical',providerPromptHash:'canonical',contentHash:createHash('sha256').update(bytes).digest('hex'),costMicrousd:120000,imageFile:'retained.png'};

test('candidate cycle retains its exact Image 2 evidence after the generation default changes to Sunburst',()=>{
  const reused=retainedCandidateBaseline(receipt,expected);
  assert.equal(reused.model,'gpt-image-2');assert.equal(reused.contentHash,receipt.contentHash);
  assert.equal(reused.costMicrousd,120000);assert.equal(reused.newImageCostMicrousd,0);assert.equal(reused.baselineReused,true);
  assert.equal(receipt.baselineReused,undefined);
});

test('candidate cycle refuses changed model, prompt, adapter, incomplete receipt or missing/corrupt pixels instead of regenerating',()=>{
  for(const changed of [{model:'gpt-image-2.5-sunburst'},{canonicalPromptHash:'changed'},{providerPromptHash:'changed'},{adapterVersion:'changed'},{provider:'fal'},{status:'failed'},{contentHash:'changed'}]){
    assert.throws(()=>retainedCandidateBaseline({...receipt,...changed},expected),/candidate_baseline_invalid:retained-case/);
  }
  assert.throws(()=>retainedCandidateBaseline(receipt,{...expected,bytes:Buffer.from('replaced pixels')}),/candidate_baseline_invalid/);
  assert.throws(()=>retainedCandidateBaseline(undefined,expected),/candidate_baseline_invalid/);
});

test('legacy failed candidate receipt retains the explicit retry gate without claiming model identity for completed pixels',()=>{
  const failed={status:'failed',adapterId:'fal-ideogram-v4',adapterVersion:'v52',canonicalPromptHash:'canonical',providerPromptHash:'adapted'};
  const expected={...failed,model:'ideogram/v4/fast'};
  assert.equal(imageAdapterCacheMatches(failed,expected),true);
  assert.equal(imageAdapterCacheMatches({...failed,status:'completed'},expected),false);
  assert.equal(imageAdapterCacheMatches({...failed,providerPromptHash:'changed'},expected),false);
  assert.equal(imageAdapterCacheMatches({...failed,model:'different'},expected),false);
  assert.equal(imageAdapterCacheMatches({...receipt,model:'gpt-image-2'},{...receipt,model:'gpt-image-2.5-sunburst'}),false);
});
