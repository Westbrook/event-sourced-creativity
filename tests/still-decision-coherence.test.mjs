import test from 'node:test';
import assert from 'node:assert/strict';
import {finalNextBest} from '../src/still/decision-coherence.ts';
import {DecisionBudget,decisionUsage,decisionProviderSummary} from '../src/still/decision-budget.ts';

const nomination={status:'Answered',quality:'valid',choice:'compose',confidence:.9,probabilities:{compose:.8,none:.2}};

test('final nomination cannot reinstate an action omitted by the final menu',()=>{
 const result=finalNextBest(nomination,['add-context','use-in']);
 assert.equal(result.status,'Invalidated');assert.match(result.reason,/outside the final selected menu/);
 assert.equal(nomination.status,'Answered','The original provider judgment remains immutable evidence');
 assert.equal(finalNextBest(nomination,['compose','use-in']),nomination);
});

test('later evidence invalidates the original nomination and abstention without a new provider call',()=>{
 for(const answer of [nomination,{...nomination,choice:'none'}]){
  const result=finalNextBest(answer,['compose'],'Idea benefit evidence arrived after nomination');
  assert.equal(result.status,'Invalidated');assert.match(result.reason,/Idea benefit evidence/);
 }
 assert.equal(finalNextBest(undefined,[]),undefined);
});

test('the shared budget counts preparation and propagates caller and stream cancellation',()=>{
 const now=Date.now;
 try{
  Date.now=()=>1000;const controller=new AbortController(),budget=new DecisionBudget(500,1000,controller.signal);
  assert.equal(budget.remaining(),500);assert.equal(budget.reason(),undefined);
  const signal=budget.signal(6000);controller.abort();assert.equal(signal.aborted,true);assert.equal(budget.reason(),'cancelled');
  const stream=new DecisionBudget(1000);stream.cancel();assert.equal(stream.signal(100).aborted,true);
  const expired=new DecisionBudget(500,500);assert.equal(expired.remaining(),0);assert.equal(expired.reason(),'latency_budget');
 }finally{Date.now=now;}
});

test('provider accounting retains finite numeric usage and all resolved pass models',()=>{
 const usage=decisionUsage({input_tokens:100,output_tokens:20,total_tokens:120,credential:'secret',negative:-1,nan:NaN,infinite:Infinity,nested:{token:2},'invalid key':4});
 assert.deepEqual(usage,{input_tokens:100,output_tokens:20,total_tokens:120});
 assert.equal(decisionUsage(null),undefined);
 const result=decisionProviderSummary([{id:'assessment',status:'answered',model:'resolved-a',elapsedMs:100,usage},{id:'ideas',status:'answered',model:'resolved-b',elapsedMs:50,usage:{input_tokens:5}},{id:'repair',status:'skipped',elapsedMs:0}]);
 assert.deepEqual(result.resolvedModels,['resolved-a','resolved-b']);assert.equal(result.usage.input_tokens,105);assert.equal(result.passes.length,3);assert.equal(result.requestedModel,'jev-latest');
 assert.ok(!JSON.stringify(result).includes('secret'));
});
