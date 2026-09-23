import test from 'node:test';
import assert from 'node:assert/strict';
import { moderateGenerationSnapshot } from '../worker/openai-moderation.ts';
for(const flagged of [false,true])for(const failAt of ['request','response','both'])test(`advisory ${flagged?'flagged':'clear'} survives ${failAt} capture failure`,async()=>{
 const old=globalThis.fetch,calls=[],phases=[],errors=[];
 const snapshot={facts:[{block_id:'b',type:'direction',properties:{text:'Unchanged fixture'}}]};
 globalThis.fetch=async(url,init)=>{calls.push({url,body:init.body});const input=JSON.parse(init.body).input;return Response.json({model:'omni-moderation-latest',id:'r',results:input.map(()=>({flagged,categories:{violence:flagged},category_scores:{violence:flagged?1:0}}))});};
 try{
   const baseline=await moderateGenerationSnapshot({OPENAI_API_KEY:'mock'},snapshot);const baselineBody=calls[0].body;
   const observed=await moderateGenerationSnapshot({OPENAI_API_KEY:'mock'},snapshot,undefined,{onEvidence:async e=>{phases.push(e.phase);if(e.phase===failAt||failAt==='both')throw Error('mock retention failure');},onCaptureError:()=>errors.push('capture-incomplete')});
   assert.equal(calls.length,2);assert.equal(calls[1].body,baselineBody);assert.deepEqual(phases,['request','response']);assert.equal(errors.length,failAt==='both'?2:1);
   for(const key of ['flagged','categories','blockIds','model','probeCount','coverage'])assert.deepEqual(observed[key],baseline[key]);assert.equal(observed.flagged,flagged);
 }finally{globalThis.fetch=old;}
});
