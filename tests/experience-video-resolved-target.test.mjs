import assert from 'node:assert/strict';
import test from 'node:test';
import {createVideoOutputContract} from '../src/model/output-video-contract.ts';
import {compileOutputPlan} from '../src/model/output-plan.ts';
import {createExperienceOutputRecipe} from '../worker/experience-output-recipe.ts';
import {captureExperienceVideoTarget} from '../src/experiences/video-native-result.ts';
const source={draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)};
const reference={version:1,sourceProjectId:'original-project',sourceDocumentId:'original-document',sourceBlockId:'original-block',referenceId:'original-reference',sha256:'f'.repeat(64),permissionAttestation:'i-own-or-have-permission'};
function resolved(frameSize='1280x720'){
 const contract=createVideoOutputContract({source,reference,frameSize});assert(contract);
 const recipe=createExperienceOutputRecipe({output:'video',requirementId:'requirement',deliverableId:'deliverable',contract});
 const plan=compileOutputPlan([recipe.spec],{document_id:'doc',source_revision:'source',requirement_revision:'requirements'});
 assert.deepEqual(plan.issues,[]);assert.equal(plan.targets.length,1);return{contract,target:plan.targets[0]};
}
test('native Video display accepts the actual recipe-to-resolver exact four-second count policy',()=>{
 for(const frame of ['1280x720','720x1280']){const{contract,target}=resolved(frame);
  assert.deepEqual(target.count_policy,{kind:'exact',unit:'second',value:4});
  assert.deepEqual(captureExperienceVideoTarget(target,contract),contract);
 }
});
test('native Video display refuses absent, incompatible, or widened policy and identity',()=>{
 const{contract,target}=resolved();
 for(const count_policy of [null,undefined,{kind:'exact',unit:'second',value:3},{kind:'exact',unit:'second',value:5},{kind:'exact',unit:'video',value:4},{kind:'range',unit:'second',min:4,max:4},{kind:'exact',unit:'second',value:4,extra:true}]){
  assert.equal(captureExperienceVideoTarget({...target,count_policy},contract),null);
 }
 for(const mutate of [t=>{t.quantity.value=2;},t=>{t.content_quantity.value=5;},t=>{t.video_contract.source.draftHash='sha256:'+'0'.repeat(64);},t=>{t.video_contract.reference.referenceId='foreign';},t=>{t.source_scope={kind:'blocks',block_ids:['foreign']};},t=>{t.aspect_ratio={width:16,height:9};},t=>{t.audio_contract=null;}]){
  const changed=structuredClone(target);mutate(changed);assert.equal(captureExperienceVideoTarget(changed,contract),null);
 }
 let calls=0;const accessor=structuredClone(target);Object.defineProperty(accessor,'count_policy',{enumerable:true,get(){calls++;throw Error('getter');}});
 assert.equal(captureExperienceVideoTarget(accessor,contract),null);assert.equal(calls,0);
});
