import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {generationFormat} from '../src/still/results.ts';

const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
const methods=['generationCheckKey','selectedGeneration','canGenerateAgain','refreshGenerationStatus','generateAgain','generationRecoveryActions','renderGenerationStatusDock','run'];
const code=ts.transpileModule(`class Recovery {${app.members.filter(n=>methods.includes(n.name?.getText(source))).map(n=>n.getText(source)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const Recovery=new Function('generationFormat','FORMATS',`${code};return Recovery;`)(generationFormat,{video:'Video',image:'Image'});
function fixture(status='failed') {
 const view=new Recovery();
 const calls=[];
 Object.assign(view,{busy:false,composing:false,changed:()=>{},begin:mode=>calls.push(['begin',mode]),startGeneration:format=>{assert.equal(view.generation,null);calls.push(['generate',format]);},client:{scopeKey:'owner',epoch:1,position:{view:'generation',documentId:'doc',outputId:'job'},abilities:{generate:true,formats:['video']},jobs:[{jobId:'job',documentId:'doc',status,kind:'render_document',result:{artifactKind:'video'}}],pollJobs:async()=>calls.push(['poll']),refresh:async()=>calls.push(['refresh'])}});
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
test('toolbar separates primary fresh generation from secondary read-only refresh',()=>{
 const {view,calls}=fixture();const actions=view.generationRecoveryActions();
 assert.equal(actions[0].label,'Generate new video');assert.equal(actions[0].variant,'primary');
 assert.equal(actions[1].label,'Refresh status');assert.equal(actions[1].variant,'secondary');
 view.generation={attempted:true,providerModel:'old-model'};actions[0].run();
 assert.deepEqual(calls,[['begin','generate'],['generate','video']]);
 view.pageActionLimit=2;view.compactDock=options=>options;assert.deepEqual(view.renderGenerationStatusDock().map(a=>a.id),actions.map(a=>a.id));
});
test('fresh action rechecks selected job, capability, uncertain requests and busy state',()=>{
 for(const change of [v=>v.client.position.outputId='other',v=>v.client.abilities.generate=false,v=>v.client.abilities.formats=[],v=>v.client.pendingGeneration={},v=>v.client.hasUnconfirmedWrite=true,v=>v.busy=true,v=>v.directGeneration=true,v=>v.client.jobs[0].status='running']){
  const {view,calls}=fixture();const action=view.generationRecoveryActions()[0];change(view);action.run();assert.deepEqual(calls,[]);
 }
 for(const status of ['running','queued','committing','completed','partial']){const {view}=fixture(status);assert.equal(view.generationRecoveryActions().some(a=>a.id==='ui:generate-new'),false);}
});
