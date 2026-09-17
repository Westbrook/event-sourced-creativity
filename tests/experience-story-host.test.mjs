import assert from 'node:assert/strict';
import test from 'node:test';
import{readFileSync}from'node:fs';
import{stripTypeScriptTypes}from'node:module';
import{SHORT_STORY_NARRATIVE_CONTRACT as contract}from'../src/model/output-narrative-contract.ts';
import{compileOutputPlan}from'../src/model/output-plan.ts';
import{createExperienceOutputRecipe,matchExperienceOutputRecipeTarget}from'../worker/experience-output-recipe.ts';
import{preflightOutputNarrativeTarget}from'../worker/output-narrative-preflight.ts';
import{outputTerms}from'../src/experiences/output-terms.ts';
import{decodeExperienceBinding}from'../src/experiences/output-binding-client.ts';
import{parseExperienceHostRoute}from'../src/experiences/host-route.ts';
import{isExperienceStoryTarget}from'../src/experiences/story-result.ts';
const scope={documentId:'doc',sourceRevision:'source',requirementRevision:'req'};
const recipe=()=>createExperienceOutputRecipe({output:'short_story',requirementId:'story-r',deliverableId:'story-d',contract});
const plan=()=>compileOutputPlan([recipe().spec],{document_id:scope.documentId,source_revision:scope.sourceRevision,requirement_revision:scope.requirementRevision});
async function offer(){const p=plan(),target=await preflightOutputNarrativeTarget({target:p.targets[0],env:{OPENAI_API_KEY:'unusable-presence-marker'},context:{snapshot:{facts:[{type:'subject',instruction:'Character',active:true}]}}}),now=Date.now();return{now,id:'offer',planRevisionId:'plan',termsDigest:'terms',sourceDigest:'source',requirementsDigest:'req',targets:[target],maximumMicrousd:target.maximumMicrousd,maximumCalls:1,createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),operationAttempts:{[target.targetId]:{ordinal:0,previousSlotId:null}}};}

test('story recipe matches only its exact confirmed document target; Image/Slides are not a fallback',()=>{
 const compiled=plan();assert.equal(recipe().nativeReadiness,'eligible_for_existing_preflight');assert.equal(matchExperienceOutputRecipeTarget(recipe(),compiled,scope),compiled.targets[0]);assert.equal(compiled.targets[0].media_kind,'document');assert.equal(isExperienceStoryTarget(compiled.targets[0]),true);
 for(const change of [p=>p.targets[0].media_kind='short_story',p=>p.targets[0].narrative_contract.wordRange.max=801,p=>delete p.targets[0].narrative_contract,p=>p.targets[0].source_revision='other']){const p=structuredClone(compiled);change(p);assert.equal(matchExperienceOutputRecipeTarget(recipe(),p,scope),null);}
 assert.throws(()=>createExperienceOutputRecipe({output:'scene',requirementId:'r',deliverableId:'d'}));
});
test('story terms disclose the exact one-call contract without Slides or repair fallback',async()=>{
 const f=await offer(),options={now:f.now,output:'short_story',targetId:f.targets[0].targetId},shown=outputTerms(f,options);assert.equal(shown.available,true);assert.equal(shown.targets.length,1);assert.equal(shown.targets[0].calls.length,1);
 const rows=Object.fromEntries(shown.targets[0].rows.map(r=>[r.label,r.value]));assert.equal(rows.Output,'1 story · 600–800 words');assert.equal(rows.Language,'English');assert.equal(rows['Generation calls'],'1 initial · No automatic repair');
 for(const mutate of [f=>f.maximumCalls=2,f=>f.targets[0].maximumCalls=2,f=>f.targets[0].settings.calls.push({...f.targets[0].settings.calls[0]}),f=>f.targets[0].settings.calls[0].stage='planning:0:repair',f=>f.targets[0].settings.payload.outputNarrative.contract.language='ja',f=>f.targets[0].settings.payload.outputNarrative.maximumOutputTokens=6001,f=>f.targets[0].route='document-slides-manual-v1',f=>f.targets[0].settings.payload.artifactKind='slides',f=>f.targets[0].settings.payload.outputNarrative.model='other']){const changed=structuredClone(f);mutate(changed);assert.equal(outputTerms(changed,options).available,false);}
});
test('story binding decoding remains passive and cannot acquire Fal result recovery',()=>{
 const identity={draftId:'draft',draftHash:'draftHash',releaseHash:'release',documentId:'doc',projectId:'project',output:'short_story',actorUserId:'owner'},state={...identity,version:1,sourceSurface:'outputs',status:'absent',disposition:'never_admitted',current:{custody:'verified',source:'verified',sourceDigest:'source',requirementsDigest:'req'},stage:null,plan:null,preflight:null,grant:null,original:null,permitted:{prepare:true,authorize:false,run:false,resumeRun:false}};
 assert.equal(decodeExperienceBinding(state,identity).output,'short_story');assert.equal(decodeExperienceBinding({...state,permitted:{...state.permitted,recoverResult:true}},identity),null);assert.equal(decodeExperienceBinding({...state,output:'slides'},identity),null);
 assert.equal(parseExperienceHostRoute('/document/doc?experience=scene&experience-draft=experience-draft-'+'a'.repeat(64)).output,'scene');
});
test('actual host source join uses explicit story contract and does not weaken exact source/target checks',()=>{
 const src=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8'),begin=src.indexOf('  #snapshotMatches('),end=src.indexOf('  #candidate(',begin);
 const method=stripTypeScriptTypes(src.slice(begin,end).replace('#snapshotMatches','function snapshotMatches').replaceAll('this.#binding','this.binding'));
 const check=new Function('isExperienceStoryTarget','bindingJson',method+';return snapshotMatches;')(isExperienceStoryTarget,JSON.stringify);
 const target=plan().targets[0],grant={id:'grant'},state={output:'short_story',documentId:'doc',projectId:'project',original:{grantId:'grant'},plan:{sourceDigest:'source',requirementsDigest:'req',revisionId:'plan',targetId:target.id,targetContractDigest:'contract'},grant};
 const snapshot={documentId:'doc',projectId:'project',scope:{kind:'personal',actorUserId:'owner'},sourceVerification:{status:'verified'},permissions:{canRequest:true},sourceRevision:'source',requirementRevision:'req',confirmedPlan:{revisionId:'plan',sourceDigest:'source',requirementsDigest:'req',targetContractDigests:{[target.id]:'contract'},plan:{targets:[target]}},grants:[grant]};
 const context={binding:{ownerId:'owner'},store:{outputRequirements:{resource:()=>({state:'ready',snapshot})}}};assert.equal(check.call(context,state),true);snapshot.sourceRevision='changed';assert.equal(check.call(context,state),false);snapshot.sourceRevision='source';delete snapshot.confirmedPlan.plan.targets[0].narrative_contract;assert.equal(check.call(context,state),false);
});

test('actual story read branch captures exact selection and rejects stale or expired async completion',async()=>{
 const src=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8'),begin=src.indexOf('        } else if (candidate.output === "short_story") {'),end=src.indexOf('\n        } else {',begin);
 let branch=src.slice(begin,end+10).replace('} else if (candidate.output === "short_story") {','{').replaceAll('this.#reader','this.reader').replaceAll('this.#result','this.result').replaceAll('this.#status','this.status').replaceAll('this.#resultReadStage','this.resultReadStage');
 branch=branch.replace('import("../model/retained-short-story-client.ts")','Promise.resolve(clientModule)').replace('import("./native-retained-story.ts")','Promise.resolve(rendererModule)');
 const run=new Function('clientModule','rendererModule','verifyExperienceStoryRead','return async function(candidate,state,hash,raw,selected,operation,lease){'+stripTypeScriptTypes('async function check(){'+branch+'}').slice('async function check(){'.length,-1)+'}');
 for(const mode of ['stale','expired']){
  let live=true,release;const pending=new Promise(resolve=>{release=resolve}),expected={documentId:'doc',artifactId:'artifact',revision:0,contentSha256:'a'.repeat(64)},candidate={output:'short_story',artifactId:'artifact',narrative:{wordCount:600}},story={selection:expected,expiresAt:new Date(Date.now()+60000).toISOString()};let observed;
  const client={readRetainedShortStory:async(selection,controls)=>{observed={selection,controls};return story;}},render={renderNativeRetainedStory(){}};
  const execute=run(client,render,async()=>{await pending;return true;});const context={ownerDocument:{location:{origin:'https://forma.test'}}};
  const attempt=execute.call(context,candidate,{documentId:'doc'},expected.contentSha256,'retained body',()=>live,{wait:p=>p},{});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(observed.selection,expected);assert.equal(observed.controls.current(),true);
  if(mode==='stale')live=false;else story.expiresAt=new Date(Date.now()-1).toISOString();release();await assert.rejects(attempt,/unavailable/);assert.equal(context.result,undefined);
 }
});

test('actual story retirement clears private DOM synchronously and uses a fresh keyed subtree',()=>{
 const src=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8'),begin=src.indexOf('  #clearResult() {'),end=src.indexOf('  #storySync =',begin);
 const method=stripTypeScriptTypes(src.slice(begin,end).replace('#clearResult','function clearResult').replaceAll('this.#','this.'));
 const clear=new Function(method+';return clearResult;')(),trace=[],prose={text:'private prose',replaceChildren(){this.text='';trace.push('cleared');},remove(){trace.push('removed');}},context={retireSelectedShare(){trace.push('share-retired');},reader:{abort(){trace.push('aborted');}},result:{output:'short_story'},imageNode:undefined,querySelectorAll:selector=>selector.includes('.retained-story-reader')?[prose]:[]};
 clear.call(context);assert.equal(prose.text,'');assert.deepEqual(trace,['share-retired','aborted','cleared','removed']);assert.equal(context.result,undefined);assert.equal(context.reader,undefined);assert.match(src,/keyed\(result\.lease, result\.render\(result\.story/);
});

test('actual story provider-unavailable view reports zero transfer/cost without a Slides or not-configured claim',()=>{
 const src=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8'),begin=src.indexOf('    const unavailableProviderPreparation ='),end=src.indexOf('\n    const duplicateReviewStatus',begin);
 const check=new Function('available','state','target',src.slice(begin,end)+';return unavailableProviderPreparation;'),target={available:false,reasonCode:'output_narrative_provider_unavailable',transferCode:'output_transfer_none_owned_adoption',provider:null,model:null,route:null,maximumMicrousd:0,maximumCalls:0,maximumTokens:0},state={output:'short_story',status:'unavailable',disposition:'prepared',original:null,grant:null,permitted:{prepare:false,authorize:false,run:false,resumeRun:false},preflight:{targets:[target],maximumMicrousd:0,maximumCalls:0}};
 assert.equal(check(true,state,target),true);assert.equal(check(true,{...state,output:'slides'},target),false);assert.equal(check(true,state,{...target,maximumMicrousd:1}),false);assert.match(src,/reasonCode === "output_narrative_provider_unavailable" \? "Unavailable" : "Not configured"/);assert.match(src,/system\("Source transfer"\).*system\("None"\)/);
});

test('story privacy signals withdraw before deferred session publication; other output lifetimes are unchanged',()=>{
 const src=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8'),begin=src.indexOf('  #storySync ='),end=src.indexOf('  #visibility =',begin);
 const methods=src.slice(begin,end).replace('#storySync =','const sync =').replace('#storyWithdraw =','const withdraw =').replaceAll('this.#','this.');
 for(const output of ['short_story','image','slides']){
  const trace=[],context={binding:{selection:{output}},current:()=>false,clearResult:()=>trace.push('clear'),retire:()=>trace.push('retire'),requestUpdate:()=>trace.push('update')};
  const {sync,withdraw}=new Function(methods+';return {sync,withdraw};').call(context);sync();withdraw();assert.deepEqual(trace,output==='short_story'?['clear','retire','update']:[]);
 }
 for(const event of ['forma-authorization-changed','forma-event-source-retired']){assert.ok(src.includes('addEventListener("'+event+'", this.#storyWithdraw)'));assert.ok(src.includes('removeEventListener("'+event+'", this.#storyWithdraw)'));}
});

test('actual host resolves the story catalog slug while retaining its artifact selector',()=>{
 const src=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8'),argument=/registeredExperience\((selection\.output[^)]*)\)/.exec(src)[1],resolve=new Function('selection','return '+argument);
 assert.equal(resolve({output:'short_story'}),'short-story');assert.equal(resolve({output:'image'}),'image');assert.equal(resolve({output:'slides'}),'slides');
});
