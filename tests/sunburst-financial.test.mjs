import test from 'node:test';
import assert from 'node:assert/strict';
import { F2_CELL, F2_STAGE_INVENTORY, F2_REVIEW_EXPIRES_AT, qualifySunburstFinancialCell as qualify, estimateUncachedSunburstReceipt as estimate } from '../evals/generation-reliability/sunburst-financial.mjs';
import { checkImageExperimentExposure as exposure } from '../worker/image-financial-qualification.ts';
import { hash } from '../evals/generation-reliability/core.mjs';
import { generateCreativeImage } from '../worker/openai-adapter.ts';

const input = prompt => ({ prompts: [{ id: 'synthetic-boundary', captureId: 'synthetic-test-only', prompt }], stageInventory: F2_STAGE_INVENTORY });
test('exact upper-byte boundary remains an estimate with no admission or invented charge', () => {
  const q = qualify(input('x'.repeat(32000)));
  assert.equal(q.promptEvidence[0].estimatedOutputTokens, 1372);
  assert.equal(q.components.imageGeneration.conservativeMicrousd, 262800);
  assert.equal(q.available, false); assert.equal(q.maximumCostMicrousd, null);
  assert.equal(q.limits.newDispatchAllowed, false); assert.equal(q.limits.authorizedAllowanceMicrousd, 0);
  assert.equal(q.limits.maximumUnreconciledExposureMicrousd, null);
  assert.equal(q.inheritedFinancialGate, false); assert.equal(q.providerEnforcedChargeCap, false);
  assert.equal(q.pricingEvidence.requestedAliasSnapshot, null);
  assert.ok(!q.gaps.some(g => /cache/.test(g)));
  assert.ok(Object.isFrozen(q.promptEvidence));
});
test('counts exact UTF-8, preserving authored bytes and invalidating changed identities', () => {
  const a = qualify(input('é'.repeat(16000))), b = qualify(input('e'.repeat(16000)));
  assert.equal(a.promptEvidence[0].utf8Bytes, 32000);
  assert.equal(a.promptEvidence[0].sha256, hash('é'.repeat(16000)));
  assert.notEqual(a.id, b.id);
  for (const prompt of ['', 'x'.repeat(32001), 'é'.repeat(16001), ' padded ', '\ud800']) {
    const q = qualify(input(prompt));
    assert.ok(q.gaps.includes('prompt_empty_noncanonical_or_over_byte_limit'));
    assert.equal(q.components.imageGeneration.conservativeMicrousd, null);
  }
});
test('rejects every excluded cell and changed wire presence', () => {
  for (const patch of [{ model:'gpt-image-2.5-flare' },{model:'gpt-image-2.5-sunburst-2026-09-08'},
    { endpoint:'/v1/responses' },{referenceCount:1}, ...[
      {quality:'medium'},{size:'1024x1536'},{stream:true},{stream:false},{partialImages:1},
      {moderation:'low'},{moderation:'auto'},{background:'transparent'},{outputFormat:'jpeg'},
    ].map(settings => ({settings:{...F2_CELL.settings,...settings}}))]) {
    const q = qualify({...input('Synthetic test'),cell:{...F2_CELL,...patch}});
    assert.ok(q.gaps.includes('outside_exact_f2_cell')); assert.equal(q.components.imageGeneration.conservativeMicrousd,null);
  }
});
test('stage identity, exact prompt captures and evidence expiry fail closed', () => {
  for (const patch of [{stageInventory:null},{stageInventory:[...F2_STAGE_INVENTORY,{stage:'planner',providerCalls:1}]},
    {now:F2_REVIEW_EXPIRES_AT},{now:'invalid'},{now:'2026-09-21T00:00:00Z'},
    {prompts:[]},{prompts:[{id:'x',prompt:'test'}]}]) {
    const q = qualify({...input('test'),...patch});
    assert.ok(q.gaps.length > 4); assert.equal(q.available,false);
  }
  const p = input('test').prompts[0];
  assert.ok(qualify({...input('test'),prompts:[p,p]}).gaps.includes('prompt_capture_identity_invalid'));
});
test('all-uncached observation estimate needs no invented cache split and never settles a charge', () => {
  const usage={textInputTokens:100,imageInputTokens:0,inputTokens:100,outputTokens:1372,totalTokens:1472};
  assert.deepEqual(estimate(usage),{conservativeMicrousd:41660,measuredChargeMicrousd:null,cachedTokenSplit:null,basis:'all_observed_input_uncached_upper_rate_only',version:'sunburst-financial-2026-09-22-v1'});
  for (const patch of [{imageInputTokens:1},{totalTokens:1473},{textInputTokens:undefined},{outputTokens:NaN},
    {inputTokens:-1},{outputTokens:0.5},{textInputTokens:Number.MAX_SAFE_INTEGER,inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:0,totalTokens:Number.MAX_SAFE_INTEGER}]) assert.equal(estimate({...usage,...patch}),null);
});
test('unknown F2 bounds cannot enter F exposure ledger, regardless of allowance or finite attempt count', () => {
  const q=qualify(input('test'));
  const ledger={maximumConcurrentInFlight:1,maximumUnreconciledMicrousd:262800,authorizedAllowanceMicrousd:1000000,settledMicrousd:0,inFlight:[],unreconciled:[]};
  assert.equal(exposure(ledger,{operationId:q.id,maximumMicrousd:q.maximumCostMicrousd}).reason,'unknown_exposure_stop_dispatch');
  assert.equal(exposure({...ledger,unreconciled:[{operationId:'original',maximumMicrousd:null}]},{operationId:'new',maximumMicrousd:262800}).reason,'unknown_exposure_stop_dispatch');
  assert.equal(exposure({...ledger,inFlight:[{operationId:'original',maximumMicrousd:262800}]},{operationId:'new',maximumMicrousd:1}).reason,'concurrency_limit');
});

test('real shared adapter preserves frozen prompt bytes, moderation omission and the two-call stage inventory', async () => {
  const requests=[]; const original=globalThis.fetch; const prompt='Synthetic original adult portrait.\nPalette: indigo, ivory.';
  globalThis.fetch=async (url,init) => {
    const body=JSON.parse(init.body); requests.push({url,body});
    if(url==='https://api.openai.com/v1/moderations') return Response.json({results:[{flagged:false,categories:{violence:false}}]});
    assert.equal(url,'https://api.openai.com/v1/images/generations');
    return Response.json({data:[{b64_json:btoa('synthetic-bytes-not-an-image')}],usage:{input_tokens:100,output_tokens:1372,total_tokens:1472,input_tokens_details:{text_tokens:100,image_tokens:0}}});
  };
  try {
    await generateCreativeImage({OPENAI_API_KEY:'mock-only'},'synthetic-user',{}, {},{preparedPrompt:prompt,quality:'high',size:'1536x1024',outputFormat:'png'});
    assert.equal(requests.length,2); assert.equal(requests[0].body.input[0].text,prompt);
    const body=requests[1].body;
    assert.equal(body.prompt,prompt); assert.equal(body.model,F2_CELL.model); assert.equal(body.n,1);
    assert.equal(body.quality,'high'); assert.equal(body.size,'1536x1024'); assert.equal(body.output_format,'png');
    for(const name of ['moderation','stream','partial_images','image','background','output_compression']) assert.ok(!(name in body));
  } finally { globalThis.fetch=original; }
});
test('real moderation unknown/flagged outcomes stop before the paid image call', async () => {
  const original=globalThis.fetch;
  try {
    for(const body of [{results:[]},{results:[{flagged:true,categories:{violence:true}}]}]) {
      let calls=0; globalThis.fetch=async url => { calls++; assert.equal(url,'https://api.openai.com/v1/moderations'); return Response.json(body); };
      await assert.rejects(()=>generateCreativeImage({OPENAI_API_KEY:'mock-only'},'synthetic-user',{}, {},{preparedPrompt:'Synthetic boundary'}));
      assert.equal(calls,1);
    }
  } finally {globalThis.fetch=original;}
});
test('real shared image submission never retries uncertain, server-error or post-purchase storage failures', async () => {
  const original=globalThis.fetch;
  try {
    for(const mode of ['timeout','server','storage']) {
      let paid=0; const receipts=[];
      globalThis.fetch=async url => {
        if(url==='https://api.openai.com/v1/moderations')return Response.json({results:[{flagged:false,categories:{violence:false}}]});
        assert.equal(url,'https://api.openai.com/v1/images/generations'); paid++;
        if(mode==='timeout')throw new Error('synthetic ambiguous transport');
        if(mode==='server')return Response.json({error:{message:'synthetic failure'}},{status:503});
        return Response.json({data:[{b64_json:btoa('synthetic')}],usage:{input_tokens:100,output_tokens:10000,total_tokens:10100,input_tokens_details:{text_tokens:100,image_tokens:0}}});
      };
      await assert.rejects(()=>generateCreativeImage({OPENAI_API_KEY:'mock-only'},'synthetic-user',{}, {},{
        preparedPrompt:'Synthetic boundary',onProviderSubmission:async receipt=>{receipts.push(receipt);throw Error('synthetic accounting persistence failure');},
      }));
      assert.equal(paid,1);
      if(mode==='storage')assert.equal(receipts[0].costMicrousd,300500); // Preserve full overrun, never clamp to allowance.
    }
  } finally {globalThis.fetch=original;}
});
