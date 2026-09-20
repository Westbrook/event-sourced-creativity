import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generationDecisionContext} from '../src/still/generation-decision.ts';
import {ACTIONS,eligibleActions,evaluateEligibility,selectActions,buildDecisionState,questionsFor,POLICY_VERSION} from '../src/still/decisions.ts';
import {presentToolbar} from '../src/still/presentation.ts';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {foldEvents} from '../src/model/events.ts';

const failed={jobId:'job',documentId:'doc',kind:'render_document',status:'failed',members:[],attemptCount:1,result:{artifactKind:'slides',providerResponse:'PRIVATE'},errorDetail:{code:'provider_submission_uncertain',category:'network',message:'PRIVATE',retryable:false}};
const position={projectId:'project',documentId:'doc',outputId:'job',blockId:'',view:'generation',intent:'',recentActions:[],generation:generationDecisionContext(failed)};
const abilities={generate:true,author:true,projectCreate:true,formats:['slides']};
const projection={...foldEvents([]),documents:[{id:'doc',projectId:'project'}],blocks:[{id:'idea',properties:{text:'An idea'}}]};
test('uncertain jobs offer explicit new work without treating status reads as recovery',()=>{
 const candidates=eligibleActions(projection,position,abilities),ids=candidates.map(a=>a.id);
 assert.ok(ids.includes('generate-again'));assert.ok(ids.includes('refresh-generation'));
 assert.equal(candidates.find(a=>a.id==='generate-again').label,'Generate new presentation');
 assert.equal(position.generation.mayDuplicateCharge,true);
 assert.match(position.generation.refreshEffect,/does not reconcile/);assert.doesNotMatch(JSON.stringify(position.generation),/PRIVATE/);
 assert.equal(selectActions(candidates,position)[0].id,'context');
 assert.ok(questionsFor(candidates,position)['use_generate-again']);
 assert.ok(!eligibleActions(projection,{...position,view:'document'},abilities).some(a=>a.id==='generate-again'));
 assert.ok(!eligibleActions(projection,position,{...abilities,generate:false}).some(a=>a.id==='generate-again'));
 assert.ok(evaluateEligibility(projection,{...position,generation:{...position.generation,documentId:'other'}},abilities).find(a=>a.action.id==='generate-again').reason);
});
test('running and acknowledgement states cannot offer a replacement purchase',()=>{
 for(const job of [{...failed,status:'running'},{...failed,kind:'generate',safetyDeliveryAvailable:true,errorDetail:{code:'safety_preflight_flagged'}}]) {
  const pos={...position,generation:generationDecisionContext(job)};
  assert.ok(!eligibleActions(projection,pos,abilities).some(a=>a.id==='generate-again'));
 }
 const running={...position,generation:generationDecisionContext({...failed,status:'running'})};
 assert.ok(!eligibleActions(projection,running,abilities).some(a=>a.id==='refresh-generation'));
});
test('a strong Jev rating never promotes an uncertain new purchase, and More has no primary',()=>{
 const scores={'generate-again':{score:3,confidence:1,usefulProbability:1},context:{score:1,confidence:.9,usefulProbability:.2}};
 const rows=presentToolbar(Object.keys(scores),scores,{view:'generation',secondaryOnly:['generate-again']});
 assert.equal(rows['generate-again'].variant,'secondary');assert.match(rows['generate-again'].reason,/paid request/);
 assert.ok(Object.values(presentToolbar(Object.keys(scores),scores,{more:true})).every(x=>x.variant==='secondary'));
});

for(const shared of [false,true])test(`server verifies job evidence and changes (${shared?'shared':'personal'})`,async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;let calls=0;
 try {
  for(const file of ['0038_scene_source_generations.sql','0041_still_decision_cache.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  f.env.JEV_API_KEY='fixture';globalThis.fetch=async()=>{calls++;return Response.json({model:'fixture',answers:{use_context:{type:'score',score:3,confidence:.95,probabilities:{0:0,1:0,2:0,3:1}}}});};
  const now=new Date().toISOString(),id=crypto.randomUUID(),result=JSON.stringify({artifactKind:'slides',errorDetail:failed.errorDetail});
  f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,requested_at,expires_at,updated_at) VALUES(?,?,?,?,'render_document','failed','still',?,1,?,?, ?,?,?)`).run(id,f.owner,f.streamId,f.documentId,id,JSON.stringify({artifactKind:'slides'}),result,now,new Date(Date.now()+86400000).toISOString(),now);
  if(shared){
   const a=f.sharing,event=await appendAuditEvent(f.env,f.streamId,`user:${f.owner}`,'ProjectDocumentJobQueued',{job_id:id,document_id:f.documentId,project_id:f.projectId,organization_id:a.organizationId,project_access_id:a.projectAccessId,history_owner_user_id:f.owner,actor_user_id:f.owner,kind:'render_document'});
   f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'job',?,?,?,?,'actor_private',?,?,?)").run(a.projectAccessId,id,a.organizationId,f.projectId,f.owner,event.eventId,f.owner,now);
  }
  const input={...position,projectId:f.projectId,documentId:f.documentId,outputId:id,developer:true,generation:{status:'completed',acceptance:'confirmed'}};
  const response=await f.request('/api/still/decision',f.json(input));assert.equal(response.status,200,await response.clone().text());
  const first=await response.json();const evidence=first.diagnostics.exchange.request.state.generation;
  assert.equal(evidence.status,'failed');assert.equal(evidence.acceptance,'unknown');assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE/);assert.equal(first.policy,POLICY_VERSION);
  const warm=await (await f.request('/api/still/decision',f.json(input))).json();assert.equal(warm.cache.status,'hit');const before=calls;
  f.sqlite.prepare("UPDATE document_jobs SET status='canceled',result_json=? WHERE job_id=?").run(JSON.stringify({artifactKind:'slides'}),id);
  const changed=await (await f.request('/api/still/decision',f.json(input))).json();assert.ok(calls>before);assert.equal(changed.diagnostics.exchange.request.state.generation.status,'canceled');
  const denied=await f.request('/api/still/decision',f.json({...input,outputId:'not-owned'}));assert.notEqual(denied.status,200);
 } finally {globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('generation pages render the shared ranked toolbar and More alternatives',async()=>{
 const {default:ts}=await import('typescript');
 const {nextToolbarActions}=await import('../src/still/finder.ts');
 const {generationActive,generationStatus,stillResults}=await import('../src/still/results.ts');
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
 const method=app.members.find(n=>n.name?.getText(source)==='renderDock');
 const code=ts.transpileModule(`function renderDock()${method.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const html=(parts,...values)=>parts.reduce((s,p,i)=>s+p+(Array.isArray(values[i])?values[i].join(''):values[i]??''),'');
 const render=new Function('html','nothing','generationActive','generationStatus','stillResults','nextToolbarActions','presentToolbar',code+';return renderDock;')(html,'',generationActive,generationStatus,stillResults,nextToolbarActions,presentToolbar);
 const candidates=eligibleActions(projection,position,abilities);
 const view={client:{projection,position,session:{policy:{accepted:true}},jobs:[failed],events:[]},pageActionLimit:5,toolbarLimit:5,firstDockLimit:5,currentRouteProblem:()=>false,isInlineGeneration:()=>false,canAcknowledgeSafety:()=>false,candidates:()=>candidates,suggestions:selectActions(candidates,position),rankedActions:candidates,toolbarStatus:()=>'',toolbarSuggestions:xs=>xs.map(x=>`<button>${x.label}</button>`),button:label=>`<button>${label}</button>`,paletteButton:()=>'<button>Palette</button>',selectedGeneration:()=>failed,renderGenerationStatusDock:()=>assert.fail('Normal job page must use shared actions')};
 const first=render.call(view);assert.match(first,/More/);assert.doesNotMatch(first,/Palette/);assert.ok((first.match(/<button>/g)??[]).length<=5);
 view.moreOpen=true;const more=render.call(view);assert.match(more,/Back/);assert.match(more,/Palette/);assert.ok((more.match(/<button>/g)??[]).length<=5);
});

test('generation evidence in the request snapshot does not make the response stale',async()=>{
 const {default:ts}=await import('typescript');
 const {evaluateActions,POLICY_VERSION}=await import('../src/still/decisions.ts');
 const {responseDisposition}=await import('../src/still/diagnostics.ts');
 const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
 const method=app.members.find(n=>n.name?.getText(source)==='decide');
 const code=ts.transpileModule(`function decide(bypass=false)${method.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let scheduled;const document={activeElement:null},window={setTimeout:fn=>{scheduled=fn;return 0;}};
 const run=new Function('selectActions','evaluateActions','presentActions','responseDisposition','window','document','ApiError',code+';return decide;')(selectActions,evaluateActions,()=>({}),responseDisposition,window,document,Error);
 const candidates=eligibleActions(projection,position,abilities),received=[];
 const view={decisionTicket:0,client:{projection,position:{...position,generation:undefined},head:4,session:{policy:{accepted:true}}},currentRouteProblem:()=>false,isInlineGeneration:()=>false,canAcknowledgeSafety:()=>false,selectedGeneration:()=>failed,decisionPosition:()=>position,candidates:()=>candidates,changed(){},interactionScope:()=>'',diagnosticScope:()=>'',querySelector:()=>null,decisionBody:()=>position,requestDecision:async()=>({source:'jev',head:4,policy:POLICY_VERSION,actions:[{id:'context'}]}),recordDecision:(_r,disposition)=>received.push(disposition)};
 run.call(view);await scheduled();assert.deepEqual(received,['Applied']);assert.equal(view.decisionSource,'jev');
 view.dockTouched=false;run.call(view);view.client.head=5;await scheduled();assert.equal(received.at(-1),'Ignored: event head changed');
});
