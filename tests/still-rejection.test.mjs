import test from 'node:test';
import assert from 'node:assert/strict';
import {foldEvents} from '../src/model/events.ts';
import {generationDecisionContext,canInspectRejection} from '../src/still/generation-decision.ts';
import {eligibleActions,questionsFor,buildDecisionState,evaluateActions} from '../src/still/decisions.ts';
import {paletteActions} from '../src/still/finder.ts';
import {parseStillRoute,stillPath,stillRouteProblem} from '../src/still/routes.ts';
import {stillPageTitle} from '../src/still/page-title.ts';
import {StillClient} from '../src/still/client.ts';
import {documentGenerationInputInspection} from '../src/model/generation-inputs.ts';
const job={jobId:'job',documentId:'doc',kind:'generate',status:'failed',members:[],attemptCount:1,requestedAt:'2026-09-21T12:00:00Z',result:{generationReceipt:{input_ref:'receipt',provider:'openai',model:'gpt-image-2',provider_request_status:'submitted'}},moderationPromptRef:'prompt',errorDetail:{code:'moderation_blocked',category:'safety',message:'Rejected',requestId:'req_example'}};
const pos={view:'generation',projectId:'project',documentId:'doc',outputId:'job',blockId:'',intent:'',recentActions:[],generation:generationDecisionContext(job)};
const p={...foldEvents([]),projectId:'project',documentId:'doc',projects:[{id:'project',name:'Study'}],documents:[{id:'doc',projectId:'project',title:'Portrait'}],blocks:[{id:'idea',type:'subject',properties:{text:'A portrait'}}]};
const abilities={author:true,generate:true,projectCreate:true,formats:['image']};
test('inspect rejection is always searchable for rejected attempts independently of Jev selection',()=>{
 const candidates=eligibleActions(p,pos,abilities);
 assert.equal(paletteActions('inspect rejection',candidates,{rankedIds:['context'],passedOverIds:[]})[0].id,'inspect-rejection');
 assert.ok(questionsFor(candidates,pos)['use_inspect-rejection']);
 assert.ok(eligibleActions(p,pos,{...abilities,author:false,generate:false}).some(a=>a.id==='inspect-rejection'));
 for(const patch of [{status:'running'},{status:'completed'},{errorDetail:{code:'network_error',category:'network'}}])assert.equal(canInspectRejection({...job,...patch}),false);
 assert.ok(!eligibleActions(p,{...pos,generation:{...pos.generation,documentId:'other'}},abilities).some(a=>a.id==='inspect-rejection'));
});
test('inspection has a reloadable history title and ordinary Jev-ranked eligible actions',()=>{
 const route=parseStillRoute('/still/project/project/document/doc/generation/job/rejection?developer');
 assert.equal(route.view,'rejection');assert.equal(stillPath(route),'/still/project/project/document/doc/generation/job/rejection');assert.equal(stillRouteProblem(route,p),'');
 assert.equal(stillPageTitle(stillPath(route),p,[job]),'Inspect rejection · Portrait · Still');
 const position={...pos,view:'rejection'},candidates=eligibleActions(p,position,abilities),ids=candidates.map(a=>a.id);
 for(const id of ['generate-again','view-output','create','context','add-context','clarify'])assert.ok(ids.includes(id),id);
 assert.ok(!ids.includes('inspect-rejection'));
 const questions=questionsFor(candidates,position);assert.ok(questions['use_generate-again']);assert.ok(questions['next_best_action'].criteria['view-output']);
 const high=id=>({[`use_${id}`]:{type:'score',score:3,confidence:1}});
 assert.equal(evaluateActions(candidates,position,high('view-output')).selected[0].id,'view-output');
 assert.equal(evaluateActions(candidates,position,high('generate-again')).selected[0].id,'generate-again');
 assert.equal(candidates.find(a=>a.id==='generate-again').label,'Retry dangerously');
});
const session={user:{userId:'user',role:'creator'},policy:{accepted:true},provider:{plannerConfigured:true}};
function mockClient(handler){const saved=globalThis.fetch;const c=new StillClient();c.session=session;c.position={...pos,view:'rejection'};const paths=[];globalThis.fetch=async(path,init)=>{paths.push(String(path));assert.equal(init.method,'GET');if(path==='/api/session?profile=still')return Response.json(session);return handler(String(path));};return {c,paths,restore:()=>globalThis.fetch=saved};}
test('inspection hydrates original inputs without dispatching work or adding private data to client caches',async()=>{
 const input={job_id:'job',document_id:'doc',document_snapshot:{facts:[{text:'Original idea'}]}};
 const f=mockClient(path=>path.includes('/api/document-jobs/')?Response.json({job}):Response.json({content:path.includes('contentId=prompt')?{prompt:'Original prompt'}:{receipt:JSON.stringify(input)}}));
 try{
  await f.c.pollJobs();assert.ok(!f.paths.some(path=>path.includes('?document=')));assert.equal(f.c.jobsLoaded,true);
  const value=await f.c.inspectGeneration('job','doc');assert.deepEqual(f.c.content,{});
  const inspection=documentGenerationInputInspection(value.job,[],value.content);assert.equal(inspection.prompt,'Original prompt');assert.equal(inspection.receipt.frozen_inputs[0].document_snapshot.facts[0].text,'Original idea');
  assert.ok(f.paths.filter(path=>path.includes('/api/document-jobs/')).every(path=>path.endsWith('?inspection=1')));
 }finally{f.restore();}
});
test('inspection rejects a mismatched job and late responses after navigation',async()=>{
 const f=mockClient(()=>Response.json({job:{...job,documentId:'other'}}));
 try{await assert.rejects(f.c.inspectGeneration('job','doc'),/unavailable/);}finally{f.restore();}
 let release,started;const held=new Promise(resolve=>release=resolve),reading=new Promise(resolve=>started=resolve);
 const g=mockClient(async()=>{started();await held;return Response.json({job});});
 try{const pending=g.c.inspectGeneration('job','doc');await reading;g.c.position.outputId='different';release();await assert.rejects(pending,/Inspection changed/);}finally{release();g.restore();}
});
test('expired prompt evidence is explicitly unavailable, never replaced with the current document',async()=>{
 const f=mockClient(path=>path.includes('/api/document-jobs/')?Response.json({job}):Response.json({content:{}}));
 try{f.c.content={prompt:'Cached old secret'};const value=await f.c.inspectGeneration('job','doc');assert.deepEqual(value.content,{});assert.ok(value.unavailable.length);assert.equal(documentGenerationInputInspection(value.job,[],value.content).prompt,'');}finally{f.restore();}
});
