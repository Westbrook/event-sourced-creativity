import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {GenerationActivity,generationCompletion,generationNoticeKey} from '../src/still/generation-activity.ts';
import {generationResult} from '../src/still/results.ts';
import {StillClient} from '../src/still/client.ts';

const job=(patch={})=>({jobId:'video',documentId:'doc',kind:'render_document',sourceSurface:'still',status:'running',attemptCount:1,result:{artifactKind:'video'},...patch});
const done=patch=>job({status:'completed',completedAt:'now',...patch});
test('only observed generations notify, once per terminal attempt; new attempts can notify again',()=>{
 const activity=new GenerationActivity();activity.observe([done()]);assert.deepEqual(activity.notices,[]);
 activity.observe([job()]);assert.equal(activity.hasActive,true);activity.observe([done()]);assert.equal(activity.hasActive,false);
 assert.deepEqual(activity.notices,[done()]);activity.observe([done()]);assert.equal(activity.notices.length,1);
 activity.consume(done());activity.observe([done()]);assert.deepEqual(activity.notices,[]);assert.equal(activity.hasSeen(done()),true);
 activity.observe([job({attemptCount:2})]);activity.observe([done({attemptCount:2})]);assert.equal(activity.notices.length,1);
});
test('clear, dismissal, acknowledgment, withdrawal, and non-generation lanes cannot leave stale notices',()=>{
 for(const patch of [{dismissedAt:'now'},{notifiedAt:'now'},{parentJobId:'parent'},{memoryMode:'recall'},{sourceSurface:'native-image'}]){
  const activity=new GenerationActivity();activity.observe([job(patch)]);activity.observe([done(patch)]);assert.deepEqual(activity.notices,[]);
 }
 const activity=new GenerationActivity();activity.observe([job()]);activity.observe([done()]);activity.observe([]);assert.deepEqual(activity.notices,[]);
 activity.observe([job()]);activity.clear();activity.observe([done()]);assert.deepEqual(activity.notices,[]);assert.equal(activity.hasActive,false);
});
test('completion wording distinguishes success, partial, failure and cancellation',()=>{
 assert.deepEqual(generationCompletion(done()),{message:'Your video is ready.',label:'View video',variant:'success'});
 assert.equal(generationCompletion(done({status:'partial'})).variant,'warning');
 assert.equal(generationCompletion(done({status:'failed',error:'Provider unavailable.'})).message,'Provider unavailable.');
 assert.equal(generationCompletion(done({status:'canceled'})).variant,'info');
});

const session={user:{userId:'owner',role:'creator',displayName:'Owner'},policy:{accepted:true},provider:{videoConfigured:true},permissionEpoch:'one'};
const json=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
async function network(handler,run){const saved=globalThis.fetch;globalThis.fetch=handler;try{await run();}finally{globalThis.fetch=saved;}}
test('authorized feed follows work to Projects and other documents without polluting their result lists or issuing writes',async()=>{
 for(const documentId of ['', 'other']){
  const c=new StillClient();c.session=structuredClone(session);c.position={...c.position,documentId:'doc',view:'document'};
  let rows=[job()],calls=[];
  await network(async(url,init)=>{calls.push(String(url));assert.equal(init.method,'GET');if(url==='/api/session?profile=still')return json(session);if(String(url).startsWith('/api/events'))return json({events:[],head:0,nextAfter:0,hasMore:false});return json({jobs:rows});},async()=>{
   await c.pollJobs();assert.equal(c.generationActivity.hasActive,true);
   c.position={...c.position,documentId,view:documentId?'document':'projects'};rows=[done()];await c.pollJobs();
   assert.deepEqual(c.jobs,[]);assert.equal(c.generationActivity.notices[0].jobId,'video');
   assert.ok(calls.includes(documentId?'/api/document-jobs?document=other':'/api/document-jobs?scope=active'));
   c.generationActivity.consume(done());await c.pollJobs();assert.deepEqual(c.generationActivity.notices,[]);
  });
 }
});
test('scope changes and stale page responses never publish a previous workspace completion',async()=>{
 const c=new StillClient();c.session=structuredClone(session);c.generationActivity.observe([job()]);
 await network(async()=>json({...session,permissionEpoch:'two'}),async()=>{await assert.rejects(c.pollJobs(),/workspace changed/i);});
 assert.equal(c.generationActivity.hasActive,false);assert.deepEqual(c.generationActivity.notices,[]);
 c.session=structuredClone(session);c.position.documentId='doc';c.generationActivity.observe([job()]);
 let release,started;const blocked=new Promise(resolve=>release=resolve),reading=new Promise(resolve=>started=resolve);
 await network(async url=>{if(url==='/api/session?profile=still')return json(session);started();await blocked;return json({jobs:[done()]});},async()=>{
  const pending=c.pollJobs();await reading;c.position.documentId='elsewhere';release();await pending;assert.deepEqual(c.generationActivity.notices,[]);
 });
});

const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
const methods=['generationIsVisible','reconcileGenerationNotices','renderGenerationCompletions','openGenerationNotice'];
const code=ts.transpileModule(`class View {${app.members.filter(n=>methods.includes(n.name?.getText(source))).map(n=>n.getText(source)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const View=new Function('generationResult','generationCompletion','generationNoticeKey',`${code};return View;`)(generationResult,generationCompletion,generationNoticeKey);
function viewFixture(){
 const view=new View(),toasts=[],navigations=[];const activity=new GenerationActivity();activity.observe([job()]);activity.observe([done()]);
 Object.assign(view,{loading:false,mode:'',client:{generationActivity:activity,historyComplete:true,position:{view:'projects',documentId:'',outputId:''},projection:{documentId:'doc',artifacts:[{id:'result',documentId:'doc'}],outputs:[],documents:[{id:'doc',projectId:'correct-project'}]},events:[]},preventsRouteChange:()=>false,run:work=>work(),navigate:(page,ids)=>navigations.push({page,ids}),notification:(key,message,variant,actions,dismiss,documentId)=>toasts.push({key,message,variant,actions,dismiss,documentId})});
 return{view,toasts,navigations,activity};
}
test('off-page completion opens its exact project/document/job, never generates or diverts through Document',async()=>{
 const {view,toasts,navigations,activity}=viewFixture();view.renderGenerationCompletions();assert.equal(toasts.length,1);assert.equal(toasts[0].documentId,'doc');
 await view.openGenerationNotice(done());assert.deepEqual(navigations,[{page:'generation',ids:{projectId:'correct-project',documentId:'doc',outputId:'video'}}]);assert.deepEqual(activity.notices,[]);
});
test('visible generation/result suppresses completion; unfinished edits prevent toast navigation',async()=>{
 const {view,toasts,navigations}=viewFixture();view.client.position={view:'generation',documentId:'doc',outputId:'video'};view.renderGenerationCompletions();assert.equal(toasts.length,0);
 view.client.position={view:'artifact',documentId:'doc',outputId:'result'};assert.equal(view.generationIsVisible(done({result:{artifactKind:'video',artifactId:'result'}})),true);
 view.client.position={view:'projects',documentId:'',outputId:''};view.preventsRouteChange=()=>true;view.renderGenerationCompletions();assert.equal(toasts[0].actions[0].disabled,true);await view.openGenerationNotice(done());assert.deepEqual(navigations,[]);
});
test('a completion already seen on its generation page does not reappear after leaving',()=>{
 const {view,toasts,activity}=viewFixture();view.client.position={view:'generation',documentId:'doc',outputId:'video'};
 view.reconcileGenerationNotices();assert.equal(activity.hasSeen(done()),true);
 view.client.position={view:'projects',documentId:'',outputId:''};activity.observe([done()]);view.renderGenerationCompletions();assert.equal(toasts.length,0);
});
test('header and finished-result strip no longer render transient generation progress',()=>{
 const render=app.members.find(n=>n.name?.getText(source)==='render').getText(source);
 assert.doesNotMatch(render,/working-status|feedback-strip|progressMessage/);
 const status=app.members.find(n=>n.name?.getText(source)==='renderGeneration').getText(source);
 assert.doesNotMatch(status,/job.progressMessage/);
});
