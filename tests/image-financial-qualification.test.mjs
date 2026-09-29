import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyImageExperimentFinancials as qualify, priceQualifiedImageUsage as price, checkImageExperimentExposure as check } from '../worker/image-financial-qualification.ts';
import { hasQualifiedReplayImageEstimate } from '../worker/replay-cost.ts';
const cell=(patch={})=>({model:'gpt-image-2.5-sunburst',endpoint:'/v1/images/generations',referenceCount:0,settings:{quality:'high',size:'1536x1024'},...patch});
test('registered rates do not qualify Flare consumption, snapshots, refs or Replay',()=>{
 const sun=qualify(cell(),1000);assert.equal(sun.components.noReferenceOutput.state,'estimated');assert.equal(sun.available,false);assert.equal(sun.maximumCostMicrousd,null);
 for(const c of [cell({model:'gpt-image-2.5-flare'}),cell({model:'gpt-image-2.5-sunburst-2026-09-08'}),cell({referenceCount:1,endpoint:'/v1/images/edits'}),cell({settings:{quality:'low',size:'1536x1024'}})]){
  const q=qualify(c,1000);assert.equal(q.ratesRegistered,true);assert.equal(q.available,false);assert.equal(q.components.noReferenceOutput.state,'unavailable');
 }
 for(const OPENAI_IMAGE_MODEL of ['gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare'])assert.equal(hasQualifiedReplayImageEstimate({OPENAI_IMAGE_MODEL}),false);
});
test('all end-to-end components retain independent qualification gaps',()=>{
 const q=qualify(cell({endpoint:'/v1/responses',referenceCount:1,settings:{stream:true,partialImages:2}}),1000);
 for(const name of ['referenceInput','cachedInput','partialImages','orchestration'])assert.equal(q.components[name].state,'unavailable');
});
test('cached tokens are subsets and partial billing never silently double-counts',()=>{
 const u={textInputTokens:100,imageInputTokens:200,outputTokens:1000,cachedTextInputTokens:20,cachedImageInputTokens:50,deliveredPartialImages:2,partialTokensInOutput:'included'};
 assert.equal(price(cell().model,u).costMicrousd,31725);
 assert.equal(price(cell().model,{...u,partialTokensInOutput:'excluded'}).costMicrousd,37725);
 assert.equal(price(cell().model,{...u,partialTokensInOutput:'unknown'}),null);
 for(const patch of [{cachedImageInputTokens:201},{textInputTokens:NaN},{outputTokens:-1},{deliveredPartialImages:4},{cachedTextInputTokens:undefined}])assert.equal(price(cell().model,{...u,...patch}),null);
});
const ledger=()=>({maximumConcurrentInFlight:1,maximumUnreconciledMicrousd:500,authorizedAllowanceMicrousd:1000,settledMicrousd:200,inFlight:[],unreconciled:[]});
test('exposure admits bounded serial estimate, stops unknown/concurrent/duplicate/over-limit operations',()=>{
 const next={operationId:'new',maximumMicrousd:100};assert.equal(check(ledger(),next).allowed,true);
 assert.equal(check(ledger(),{...next,maximumMicrousd:null}).reason,'unknown_exposure_stop_dispatch');
 assert.equal(check({...ledger(),unreconciled:[{operationId:'old',maximumMicrousd:null}]},next).reason,'unknown_exposure_stop_dispatch');
 assert.equal(check({...ledger(),inFlight:[{operationId:'old',maximumMicrousd:100}]},next).reason,'concurrency_limit');
 assert.equal(check({...ledger(),unreconciled:[next]},next).reason,'original_operation_requires_reconciliation');
 assert.equal(check({...ledger(),maximumConcurrentInFlight:3,inFlight:[{operationId:'old',maximumMicrousd:450}]},next).reason,'unreconciled_exposure_limit');
 assert.equal(check({...ledger(),settledMicrousd:950},next).reason,'authorized_allowance_exceeded');
 assert.equal(check({...ledger(),maximumConcurrentInFlight:0},next).reason,'invalid_limits');
});
