import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCreativeImage } from '../worker/openai-adapter.ts';
import { generateFalCreativeImage } from '../worker/fal-image-adapter.ts';
import { authorizeImageSafetyDelivery } from '../worker/image-safety-acknowledgement.ts';
import { documentJobCanAcknowledgeSafety } from '../src/model/document-jobs.ts';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { appendAuditEvent, readWorkspaceEvents } from '../worker/runtime.ts';

const flagged=()=>Response.json({id:'moderation-fixture',model:'omni-moderation-latest',results:[{flagged:true,categories:{violence:true},category_scores:{violence:.91}}]});
const env={OPENAI_API_KEY:'test-only',FAL_KEY:'test-only'};

for(const [name,generate] of [['OpenAI',generateCreativeImage],['Fal',generateFalCreativeImage]])test(`${name}: default stops; one explicit acknowledgment delivers the exact prompt, never disables provider safety`,async()=>{
  const saved=globalThis.fetch,paid=[];
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith('/moderations'))return flagged();
    paid.push(JSON.parse(init.body));
    return Response.json({error:{message:'Rejected by the safety system.',code:'content_policy_violation'}},{status:400});
  };
  try{
    const snapshot={facts:[]},direction={title:'A reviewed scene',scene:'A quiet landscape'};
    let failure;
    await assert.rejects(generate(env,'owner',snapshot,direction),error=>{failure=error;return error.detail.code==='safety_preflight_flagged';});
    assert.equal(paid.length,0);
    // Advisory readiness consent and raw JSON cannot authorize the provider boundary.
    await assert.rejects(generate(env,'owner',snapshot,direction,{preflightAcknowledged:true}),error=>error.detail.code==='safety_preflight_flagged');
    await assert.rejects(generate(env,'owner',snapshot,direction,{safetyAcknowledgement:{acknowledged:true}}),error=>error.detail.code==='safety_acknowledgement_stale');
    const approval=authorizeImageSafetyDelivery(failure.preparedPrompt,failure.detail.safetyInputDigest);
    await assert.rejects(generate(env,'owner',snapshot,{title:'Different planner wording'},{safetyAcknowledgement:approval}),error=>error.detail.category==='safety'&&error.detail.code!=='safety_preflight_flagged');
    assert.equal(paid.length,1);assert.equal(paid[0].prompt,failure.preparedPrompt);
    if(name==='Fal')assert.equal(paid[0].enable_safety_checker,true);
    await assert.rejects(generate(env,'owner',snapshot,direction,{safetyAcknowledgement:approval}),error=>error.detail.code==='safety_acknowledgement_stale');
    const stale=authorizeImageSafetyDelivery(failure.preparedPrompt,failure.detail.safetyInputDigest);
    await assert.rejects(generate(env,'owner',{facts:[{text:'Changed'}]},direction,{safetyAcknowledgement:stale}),error=>error.detail.code==='safety_acknowledgement_stale');
    const reference={source:'uploaded-reference',referenceId:'same-id',bytes:new TextEncoder().encode('original pixels'),mimeType:'image/png'};
    let referenceFailure;
    await assert.rejects(generate(env,'owner',snapshot,direction,{references:[reference]}),error=>{referenceFailure=error;return error.detail.code==='safety_preflight_flagged';});
    const referenceApproval=authorizeImageSafetyDelivery(referenceFailure.preparedPrompt,referenceFailure.detail.safetyInputDigest);
    await assert.rejects(generate(env,'owner',snapshot,direction,{references:[{...reference,bytes:new TextEncoder().encode('changed pixels')}],safetyAcknowledgement:referenceApproval}),error=>error.detail.code==='safety_acknowledgement_stale');
    assert.equal(paid.length,1);
  }finally{globalThis.fetch=saved;}
});

for(const [kind,shared] of [['generate',false],['preview',false],['generate',true]])test(`real ${kind} job (${shared?'shared':'personal'}): polling never forces delivery; explicit acknowledgment is exact-attempt and single-use`,async()=>{
  const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;let paid=0,plans=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith('/moderations'))return flagged();
    if(String(url).includes('/models'))return Response.json({data:[{id:'gpt-image-2'},{id:'gpt-image-2-sunburst'},{id:'gpt-5.6-terra'}]});
    if(String(url).endsWith('/responses'))return Response.json({id:`plan-${++plans}`,model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Harbor',scene:'The keeper checks the harbor.',rationale:'Authored scene',palette:[],next_moves:[]}),usage:{input_tokens:1,output_tokens:1,total_tokens:2}});
    if(String(url).includes('/images/')){paid++;return Response.json({error:{code:'content_policy_violation',message:'Rejected by the safety system.'}},{status:400});}
    throw Error('Unexpected external request: '+url);
  };
  try{
    const id='explicit-safety-job',now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString();
    const payload={snapshot:f.payload.snapshot,sourceBlockVersions:f.payload.sourceBlockVersions,documentRevision:f.payload.documentRevision,promptTechnique:'prose',preflightAcknowledged:true};
    f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,requested_at,expires_at,updated_at)
      VALUES(?,?,?,?,?,'failed','still',?,1,?,'{}',?,?,?)`).run(id,f.owner,f.streamId,f.documentId,kind,id,JSON.stringify(payload),now,expires,now);
    if(f.sharing){
      const s=f.sharing;
      const event=await appendAuditEvent(f.env,f.streamId,`user:${f.owner}`,'ProjectDocumentJobQueued',{job_id:id,document_id:f.documentId,project_id:f.projectId,organization_id:s.organizationId,project_access_id:s.projectAccessId,history_owner_user_id:f.owner,actor_user_id:f.owner,kind});
      f.sqlite.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'job',?,?,?,?,'actor_private',?,?,?)`).run(s.projectAccessId,id,s.organizationId,f.projectId,f.owner,event.eventId,f.owner,now);
    }
    f.sqlite.prepare("UPDATE document_jobs SET status='queued' WHERE job_id=?").run(id);
    const first=await f.run(id);assert.equal(first.body.job.status,'failed',JSON.stringify(first.body));
    assert.equal(first.body.job.errorDetail.code,'safety_preflight_flagged',JSON.stringify(first.body));
    assert.equal(first.body.job.safetyDeliveryAvailable,true);assert.equal(paid,0);
    await f.request(`/api/document-jobs/${id}`);await f.run(id);assert.equal(paid,0);
    const route=`/api/document-jobs/${id}/acknowledge-safety`;
    assert.equal((await f.request(route,f.json({}))).status,409);
    assert.equal((await f.request(route,f.json(null))).status,409);
    assert.equal((await f.request('/api/document-jobs/someone-elses-job/acknowledge-safety',f.json({acknowledged:true,attemptCount:1}))).status,404);
    assert.equal((await f.request(route,f.json({acknowledged:true,attemptCount:0}))).status,409);
    const accepted=await f.request(route,f.json({acknowledged:true,attemptCount:1}));
    assert.equal(accepted.status,202,await accepted.clone().text());
    assert.equal((await f.request(route,f.json({acknowledged:true,attemptCount:1}))).status,409);
    const second=await f.run(id);await f.drainBackground();
    assert.equal(paid,1,JSON.stringify(second.body));
    assert.equal(second.body.job.attemptCount,2);
    assert.equal(second.body.job.safetyDeliveryAvailable,false);
    assert.equal(second.body.job.errorDetail.category,'safety');
    await f.run(id);assert.equal(paid,1);
    assert.equal((await f.request(route,f.json({acknowledged:true,attemptCount:2}))).status,409);
    const acknowledgments=(await readWorkspaceEvents(f.env,f.streamId)).filter(event=>event.type==='GenerationRiskAcknowledged');
    assert.equal(acknowledgments.filter(event=>event.payload.forced_model_delivery===true).length,1,JSON.stringify(acknowledgments));
  }finally{await f.drainBackground();globalThis.fetch=saved;f.close();}
});

test('both clients show the action only for the server-offered exact preflight failure',()=>{
  const eligible={kind:'generate',status:'failed',safetyDeliveryAvailable:true,errorDetail:{code:'safety_preflight_flagged'}};
  assert.equal(documentJobCanAcknowledgeSafety(eligible),true);
  for(const change of [{status:'queued'},{safetyDeliveryAvailable:false},{kind:'render_document'},{errorDetail:{code:'content_policy_violation'}}])assert.equal(documentJobCanAcknowledgeSafety({...eligible,...change}),false);
});

test('Still builds recovery controls without submitting; only clicking the acknowledgment delivers',async()=>{
  const {readFileSync}=await import('node:fs'),{default:ts}=await import('typescript');
  const source=ts.createSourceFile('app.ts',readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  const app=source.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='StillApp');
  const method=app.members.find(node=>node.name?.getText(source)==='generationRecoveryActions');
  const code=ts.transpileModule(`function controls() ${method.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const controls=new Function('generationFormat','FORMATS',`${code};return controls;`)(()=> 'image',{image:'Image'});
  const job={jobId:'reviewed'},calls=[];
  const actions=controls.call({isInlineGeneration:()=>false,selectedGeneration:()=>job,canAcknowledgeSafety:()=>true,acknowledgeSafety:actual=>calls.push(actual),canGenerateAgain:()=>true});
  assert.deepEqual(calls,[]);assert.equal(actions[0].label,'I understand the risks');
  actions[0].run();assert.deepEqual(calls,[job]);
});
