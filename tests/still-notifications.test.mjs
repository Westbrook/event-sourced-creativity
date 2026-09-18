import test from 'node:test';
import assert from 'node:assert/strict';
import { failureNotification, canContinueReview } from '../src/still/notifications.ts';
import { generationReview } from '../src/still/generation-review.ts';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { StillClient } from '../src/still/client.ts';

test('generation status renders terminal errors only once and replaces stale progress',async()=>{
 const {readFileSync}=await import('node:fs'),{default:ts}=await import('typescript');
 const {generationFormat,generationActive,generationStatus,generationPreview}=await import('../src/still/results.ts');
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
 const method=app.members.find(n=>n.name?.getText(source)==='renderGeneration');
 const code=ts.transpileModule(`function renderGeneration() ${method.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const html=(parts,...values)=>parts.reduce((out,part,i)=>out+part+(values[i]??''),'');
 const render=new Function('html','nothing','generationFormat','generationActive','generationStatus','generationPreview','FORMATS',`${code};return renderGeneration;`)(html,'',generationFormat,generationActive,generationStatus,generationPreview,{video:'Video'});
 const message='At least one reference image or video is required.';
 for(const progressMessage of [message,'Submitting…']){
  const job={jobId:'failed',documentId:'doc',kind:'render_document',status:'failed',progressMessage,result:{artifactKind:'video'},error:message,errorDetail:{message}};
  const output=render.call({client:{projection:{documentId:'doc',documentTitle:'Scene',blocks:[]},position:{outputId:'failed'},jobs:[job],events:[]},canGenerateAgain:()=>true,generationCheckKey:()=>'',button:()=>assert.fail('Recovery controls belong in the toolbar')});
  assert.equal(output.split(message).length-1,1);assert.equal(output.includes('Submitting…'),false);assert.equal(output.split('role="status"').length-1,1);
 }
});

test('safety failures lead to context review; only acknowledgeable admission warnings offer Continue',()=>{
 const job={jobId:'failure',attemptCount:1,kind:'generate',errorDetail:{category:'safety',action:'edit_request',code:'safety_preflight_flagged',message:'Review the prompt.'}};
 assert.equal(failureNotification(job).action,'context');
 assert.equal(canContinueReview(generationReview(409,{error:'generation_preflight_blocked'})),false);
 assert.equal(canContinueReview(generationReview(428,{error:'generation_preflight_review_required'})),true);
 assert.equal(canContinueReview(generationReview(428,{error:'generation_budget_acknowledgement_required'})),true);
 assert.equal(canContinueReview(null),false);
 const transient={...job,errorDetail:{category:'network',action:'retry',code:'provider_network_error',message:'Unavailable.'}};
 assert.equal(failureNotification(transient).action,'generation');
 assert.notEqual(failureNotification(job).key,failureNotification({...job,attemptCount:2}).key);
});

test('dismissing a failed generation persists existing dismissal metadata without retrying or changing its failure',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith('/'),'No provider calls');return f.request(url,init);};
 try {
  const now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString(),id='toast-failure';
  f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,requested_at,completed_at,expires_at,updated_at)
   VALUES(?,?,?,?,'generate','failed','still',?,1,'{}',?,?,?,?,?)`).run(id,f.owner,f.streamId,f.documentId,id,JSON.stringify({stage:'failed',errorDetail:{code:'safety_preflight_flagged',category:'safety',action:'edit_request',message:'Review context.',retryable:false}}),now,now,expires,now);
  const client=new StillClient();await client.load();client.position={...client.position,documentId:f.documentId,projectId:f.projectId,view:'document'};await client.pollJobs();
  const job=client.jobs.find(j=>j.jobId===id);assert.ok(job);const before=f.counts();
  await client.dismissJob(job);assert.ok(client.jobs.find(j=>j.jobId===id).dismissedAt);
  await client.pollJobs();assert.ok(client.jobs.find(j=>j.jobId===id).dismissedAt);
  const row=f.sqlite.prepare('SELECT status,attempt_count,result_json FROM document_jobs WHERE job_id=?').get(id);
  assert.equal(row.status,'failed');assert.equal(row.attempt_count,0);assert.equal(JSON.parse(row.result_json).errorDetail.code,'safety_preflight_flagged');
  assert.deepEqual(f.counts(),before);
 } finally {globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('Review generation opens the original job even without generation permission and never starts a fresh request',async()=>{
 const {readFileSync}=await import('node:fs'),{default:ts}=await import('typescript');
 const {generationFormat}=await import('../src/still/results.ts');
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
 const method=app.members.find(n=>n.name?.getText(source)==='renderNotifications');
 const code=ts.transpileModule(`function renderNotifications(failed) ${method.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const render=new Function('html','nothing','failureNotification','canContinueReview','generationFormat',`${code};return renderNotifications;`)(()=>null,null,failureNotification,canContinueReview,generationFormat);
 for(const formats of [[],['image','video']])for(const job of [{kind:'generate'},{kind:'render_document',result:{artifactKind:'video'}}]){
  const failed={...job,jobId:'original-failed-job',documentId:'original-document',status:'failed',attemptCount:1,errorDetail:{category:'network',action:'retry',code:'provider_network_error',message:'Unavailable.'}};
  let review;const navigations=[];
  const app={client:{abilities:{formats}},notification:(_key,_message,_tone,actions)=>{review=actions[0];},navigate:(view,ids)=>navigations.push({view,ids}),choose:()=>assert.fail('Review must not choose a new format'),startGeneration:()=>assert.fail('Review must not start generation')};
  render.call(app,failed);assert.equal(review.label,'Review generation');review.run();
  assert.deepEqual(navigations,[{view:'generation',ids:{outputId:failed.jobId}}]);
 }
});
