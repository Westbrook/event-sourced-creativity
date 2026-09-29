import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceAdvisoryInputs } from '../src/model/source-advisory.ts';
import { moderateGenerationSnapshot } from '../worker/openai-moderation.ts';
import { generationReview, issueAffectsBlock, issueBlockSummary } from '../src/still/generation-review.ts';

// Independent copy of Production 540 wire construction: exact equivalence is a
// safety-policy constraint, including disabled facts and character truncation.
function originalInputs(snapshot) {
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
  const mapped = facts.map(fact => {
    if (!fact || typeof fact !== 'object') return '';
    const p = fact.properties && typeof fact.properties === 'object' ? fact.properties : {};
    return [fact.type, fact.role, fact.intent, fact.effect, fact.handle, p.text, p.instruction, p.value, p.label, p.description].filter(Boolean).join(' · ').slice(0,6000);
  }).filter(Boolean);
  return [JSON.stringify(snapshot).slice(0,28000), ...mapped.slice(0,24)];
}
const fact = (id,text) => ({block_id:id,properties:{text}});
const clear = {flagged:false,categories:{violence:false,hate:false},category_scores:{violence:0.1,hate:0.2}};
const flagged = category => ({flagged:true,categories:{[category]:true},category_scores:{[category]:0.9}});
const snapshot = {facts:[fact('a','A blue mug'),fact('b','A green lamp')]};
async function run(value,results) {
  const old=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json({model:'returned-fixture-model',results},{headers:{'x-request-id':'fixture-original'}});};
  try {const receipt=await moderateGenerationSnapshot({OPENAI_API_KEY:'offline-only'},value);assert.equal(calls.length,1);assert.deepEqual(calls[0].body.input,originalInputs(value));assert.equal(calls[0].body.model,'omni-moderation-latest');return receipt;} finally {globalThis.fetch=old;}
}
for (const [name,results,ids,categories] of [
  ['snapshot clear/item flagged',[clear,flagged('hate'),clear],['a'],['hate']],
  ['snapshot flagged/items clear',[flagged('violence'),clear,clear],[],['violence']],
  ['different categories',[flagged('violence'),flagged('hate'),flagged('sexual')],['a','b'],['hate','sexual','violence']],
]) test('N5 attribution: '+name,async()=>{
  const r=await run(snapshot,results);assert.equal(r.flagged,true);assert.deepEqual(r.blockIds,ids);assert.deepEqual(r.categories,categories);
  assert.equal(r.requestId,'fixture-original');assert.equal(r.model,'returned-fixture-model');assert.equal(r.probeCount,1);
  const issue={id:'context-safety',label:'Source advisory',summary:r.categories.join(', '),status:'warning',severity:'warning',blockIds:r.blockIds,sourceVerdicts:r.sourceVerdicts};
  const review=generationReview(428,{error:'generation_preflight_review_required',readiness:{probes:[issue]}});assert.equal(review.key,'preflightAcknowledged');
  snapshot.facts.forEach((f,i)=>{assert.equal(issueAffectsBlock(issue,f),results[i+1].flagged);assert.equal(r.sourceVerdicts[i+1].blockId,f.block_id);assert.equal(r.sourceVerdicts[i+1].flagged,results[i+1].flagged);});
  if(ids.includes('a')) {assert.match(issueBlockSummary(issue,'a'),/flagged: hate/);assert.doesNotMatch(issueBlockSummary(issue,'a'),/violence/);}
  if(ids.includes('b')) {assert.match(issueBlockSummary(issue,'b'),/flagged: sexual/);assert.doesNotMatch(issueBlockSummary(issue,'b'),/hate|violence/);}
  assert.equal(generationReview(409,{error:'generation_preflight_blocked',readiness:{probes:[issue]}}).key,null);
});
test('N5 attribution: omitted facts keep original indices; metadata-only and disabled facts remain submitted',async()=>{
  const value={facts:[null,{},false,{block_id:'only-id'},fact('a','text'),{block_id:'off',type:'direction',enabled:false,excluded:true,properties:{text:''}},fact('', 'idless')]};
  const {input,mapping}=sourceAdvisoryInputs(value);assert.deepEqual(input,originalInputs(value));assert.deepEqual(mapping.map(x=>x.sourceIndex),[null,4,5,6]);assert.deepEqual(mapping.map(x=>x.blockId),[null,'a','off',null]);
  const r=await run(value,[clear,clear,flagged('hate'),flagged('violence')]);assert.deepEqual(r.blockIds,['off']);assert.equal(r.sourceVerdicts[3].blockId,null);
});
test('N5 attribution: UTF-16 truncation, 24 nonempty facts and excluded projection fields preserve exact wire',()=>{
  const value={title:'😀'.repeat(16000),facts:[{},...Array.from({length:27},(_,i)=>({...fact(String(i),'😀'.repeat(4000)),role:'subject',intent:'fixture',effect:'effect',handle:'handle',properties:{text:'😀'.repeat(4000),instruction:'instruction',value:42,label:'label',description:'description',unselected:'not in isolated input'}}))]};
  const {input,mapping}=sourceAdvisoryInputs(value);assert.deepEqual(input,originalInputs(value));assert.equal(input.length,25);assert.equal(input[0].length,28000);assert.equal(input[1].length,6000);assert.ok(mapping.every(x=>x.truncated));assert.equal(mapping.at(-1).sourceIndex,24);assert.throws(()=>JSON.parse(input[0]));
  assert.equal(input.slice(1).some(x=>x.includes('not in isolated input')),false);
  const projected=sourceAdvisoryInputs({facts:[{type:'kind',role:'r',intent:'i',effect:'e',handle:'h',properties:{text:'t',instruction:'n',value:42,label:'l',description:'d',ignored:'z'}}]});assert.equal(projected.input[1],'kind · r · i · e · h · t · n · 42 · l · d');
});
test('N5 attribution: absent scores and empty flagged category map stay unknown',async()=>{
  const r=await run({facts:[fact('a','fixture')]},[clear,{flagged:true,categories:{}}]);assert.equal(r.sourceVerdicts[1].scores,null);assert.deepEqual(r.sourceVerdicts[1].categories,[]);assert.equal(r.scores.violence,0.1);
  assert.match(issueBlockSummary({id:'context-safety',sourceVerdicts:r.sourceVerdicts},'a'),/category unavailable/);
});
test('N5 attribution: legacy per-item categories are explicitly unknown; non-advisory issue unchanged',()=>{
  assert.match(issueBlockSummary({id:'context-safety',summary:'violence',blockIds:['a']},'a'),/individual categories were not recorded/);
  assert.doesNotMatch(issueBlockSummary({id:'context-safety',summary:'violence',blockIds:['a']},'a'),/violence/);
  assert.equal(issueBlockSummary({id:'reference',summary:'Reference expired'},'a'),'Reference expired');
  const app=readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8');assert.match(app,/issueBlockSummary\(i,\s*[^)]+\)/,'actual Still rendering uses the item-specific presenter');
});
for(const [name,results] of [['missing',undefined],['too few',[clear]],['too many',[clear,clear,clear,clear]],['bad item',[clear,{flagged:'false',categories:{}},clear]]])test('N5 attribution rejects '+name+' verdicts',async()=>{
  await assert.rejects(run(snapshot,results),error=>error.detail.code==='moderation_response_invalid');
});
