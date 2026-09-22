import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {generationFormat,generationActive} from '../src/still/results.ts';
import {ApiError} from '../src/still/client.ts';
import {generationReview} from '../src/still/generation-review.ts';
import {canContinueReview} from '../src/still/notifications.ts';
import {documentJobCanAcknowledgeSafety} from '../src/model/document-jobs.ts';

const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
const methods=['canAcknowledgeSafety','acknowledgeSafety','generationCheckKey','isInlineGeneration','selectedGeneration','canGenerateAgain','refreshGenerationStatus','generateAgain','generationRecoveryActions','renderGenerationStatusDock','renderInlineGeneration','toolbarStatus','renderBusyDock','startGeneration','generate','run'];
const code=ts.transpileModule(`class Recovery {${app.members.filter(n=>methods.includes(n.name?.getText(source))).map(n=>n.getText(source)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const html=(parts,...values)=>parts.reduce((s,p,i)=>s+p+(Array.isArray(values[i])?values[i].join(''):values[i]??''),'');
const Recovery=new Function('documentJobCanAcknowledgeSafety','generationFormat','generationActive','FORMATS','ApiError','generationReview','canContinueReview','html','nothing',`${code};return Recovery;`)(documentJobCanAcknowledgeSafety,generationFormat,generationActive,{video:'Video',image:'Image'},ApiError,generationReview,canContinueReview,html,'');
function fixture(status='failed') {
 const view=new Recovery();
 const calls=[];
 Object.assign(view,{busy:false,composing:false,decide:()=>{},changed:()=>{},begin:mode=>calls.push(['begin',mode]),startGeneration:format=>{assert.equal(view.generation,null);calls.push(['generate',format]);},client:{scopeKey:'owner',epoch:1,position:{recentActions:[],view:'generation',documentId:'doc',outputId:'job'},abilities:{generate:true,formats:['video']},jobs:[{jobId:'job',documentId:'doc',status,kind:'render_document',result:{artifactKind:'video'}}],pollJobs:async()=>calls.push(['poll']),refresh:async()=>calls.push(['refresh'])}});
 return {view,calls};
}
test('status refresh reads only, confirms no new generation, and does not repeat provider error',async()=>{
 for(const [status,copy] of [['failed','still failed'],['running','still in progress'],['completed','complete'],['canceled','canceled'],['partial','partially complete']]){
  const {view,calls}=fixture(status);await view.refreshGenerationStatus();
  assert.deepEqual(calls,[['poll'],['refresh']]);assert.match(view.generationCheck.message,new RegExp(copy));assert.match(view.generationCheck.message,/No new generation was started/);assert.equal(view.busy,false);
 }
});
test('failed or stale refresh never claims a successful check',async()=>{
 const {view}=fixture();view.client.pollJobs=async()=>{throw new Error('offline');};await view.refreshGenerationStatus();
 assert.equal(view.generationCheck.message,'Couldn’t refresh status. No new generation was started.');
 view.client.pollJobs=async()=>{view.client.position.outputId='other';};await view.refreshGenerationStatus();
 assert.notEqual(view.generationCheck.key,view.generationCheckKey());
});
test('only explicit inline reviews use a deterministic primary generation control',()=>{
 const {view,calls}=fixture();const actions=view.generationRecoveryActions();
 assert.equal(actions.some(a=>a.id==='ui:generate-new'),false);
 assert.equal(actions[0].label,'Refresh status');assert.equal(actions[0].variant,'secondary');
 view.generation={attempted:true,providerModel:'old-model'};view.generateAgain('job');
 assert.deepEqual(calls,[['generate','video']]);assert.equal(view.isInlineGeneration(),true);
 view.pageActionLimit=2;view.toolbarLimit=2;view.compactDock=options=>options;assert.equal(view.renderGenerationStatusDock()[0].id,'ui:continue-generation');
});

function executionFixture() {
 const {view,calls}=fixture();delete view.startGeneration;
 Object.assign(view,{draftSignature:()=>'',querySelector:()=>null,updateComplete:Promise.resolve(),navigate:(page,ids)=>{calls.push(['navigate',page,ids.outputId]);view.inlineGenerationKey='';}});
 view.client.prepareGeneration=format=>({format,documentId:'doc',requestId:'new-request'});
 return {view,calls};
}
test('accepted generation keeps only useful navigation and one toolbar progress status',()=>{
 const {view}=fixture('running');
 const actions=view.generationRecoveryActions();assert.deepEqual(actions.map(a=>a.id),['document','results','ui:palette']);
 view.button=label=>label;view.paletteButton=()=> 'Palette';view.pageActionLimit=5;
 const output=view.renderGenerationStatusDock();assert.match(output,/Generating video/);assert.equal(output.split('role="status"').length-1,1);assert.doesNotMatch(output,/Refresh status|Preparing/);
});
test('preparation stays inline and acceptance navigates once directly to the new job',async()=>{
 const {view,calls}=executionFixture();let accept,count=0;
 view.client.generate=()=>{count++;return new Promise(resolve=>{accept=resolve;});};
 const pending=view.generateAgain('job');
 assert.equal(view.client.position.outputId,'job');assert.equal(view.mode,undefined);assert.equal(view.renderInlineGeneration(),'');assert.match(view.renderGenerationStatusDock(),/Preparing video/);assert.doesNotMatch(view.renderGenerationStatusDock(),/<en-button/);assert.deepEqual(calls,[]);
 await view.generateAgain('job');assert.equal(count,1);
 accept({jobId:'new-job'});await pending;
 assert.deepEqual(calls,[['navigate','generation','new-job']]);
});
test('budget review stays inline, requires explicit consent, and retains the same request',async()=>{
 const {view,calls}=executionFixture();let count=0;let request;
 view.client.generate=async draft=>{count++;request??=draft;assert.equal(draft,request);if(count===1)throw new ApiError(428,{error:'generation_budget_acknowledgement_required',message:'Review budget usage.'});assert.equal(draft.acknowledgements.budgetAcknowledged,true);return{jobId:'approved-job'};};
 await view.generateAgain('job');assert.deepEqual(calls,[]);assert.match(view.renderInlineGeneration(),/Review budget usage/);
 const action=view.generationRecoveryActions()[0];assert.equal(action.label,'Acknowledge & send');assert.equal(count,1);
 await view.run(()=>view.generate());assert.deepEqual(calls,[['navigate','generation','approved-job']]);
});
test('blocked and uncertain requests remain on the old page without buying another attempt',async()=>{
 const {view,calls}=executionFixture();let count=0;
 view.client.generate=async()=>{count++;throw new ApiError(409,{error:'generation_preflight_blocked'});};
 await view.generateAgain('job');assert.equal(view.generationRecoveryActions()[0].disabled,true);assert.match(view.renderInlineGeneration(),/Generation blocked/);
 await view.run(()=>view.generate());assert.equal(count,1);assert.deepEqual(calls,[]);
 view.generationGate=null;view.client.generate=async draft=>{draft.attempted=true;throw new Error('Generation check unconfirmed.');};
 await view.run(()=>view.generate());assert.equal(view.generationRecoveryActions()[0].label,'Check request');assert.match(view.renderInlineGeneration(),/Generation check unconfirmed/);assert.deepEqual(calls,[]);
});
test('a late accepted request does not redirect after the user leaves the original page',async()=>{
 const {view,calls}=executionFixture();let accept;
 view.client.generate=()=>new Promise(resolve=>{accept=resolve;});const pending=view.generateAgain('job');
 view.client.position.outputId='other';accept({jobId:'new-job'});await pending;assert.deepEqual(calls,[]);assert.equal(view.renderInlineGeneration(),'');
});
test('fresh action rechecks selected job, capability, uncertain requests and busy state',()=>{
 for(const change of [v=>v.client.position.outputId='other',v=>v.client.abilities.generate=false,v=>v.client.abilities.formats=[],v=>v.client.pendingGeneration={},v=>v.client.hasUnconfirmedWrite=true,v=>v.busy=true,v=>v.directGeneration=true,v=>v.client.jobs[0].status='running']){
  const {view,calls}=fixture();const action=()=>view.generateAgain('job');change(view);action();assert.deepEqual(calls,[]);
 }
 for(const status of ['running','queued','committing','completed','partial']){const {view}=fixture(status);assert.equal(view.generationRecoveryActions().some(a=>a.id==='ui:generate-new'),false);}
});
