import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cleanActionObservation, ACTION_RETENTION_MS } from '../src/still/action-outcomes.ts';
import { createStillActionOutcomesHandler } from '../worker/still-action-outcomes-api.ts';
import { actionRetentionUntil, createStillDecisionReceipt, decisionReceiptBody, readStillActionContext, sweepStillActionOutcomes, stillActionPrivacyDefinitions } from '../worker/still-action-outcomes.ts';
import { CREATION_SCHEMA_STATEMENTS } from '../worker/creation-store.ts';
import { STILL_ACTION_OUTCOMES_SCHEMA } from '../worker/still-action-outcomes-schema.ts';
const scope={projectId:'project',documentId:'document'};
function harness(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0074_still_action_outcomes.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../drizzle/0075_still_user_settings.sql',import.meta.url),'utf8'));
 db.exec("CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT);CREATE TABLE events(event_id TEXT,stream_id TEXT,actor TEXT,type TEXT,recorded_at TEXT,correlation_id TEXT,payload TEXT);CREATE TABLE document_jobs(job_id TEXT,owner_id TEXT,document_id TEXT,status TEXT,correlation_id TEXT,stream_id TEXT,requested_at TEXT,expires_at TEXT,request_json TEXT);");
 for(const sql of CREATION_SCHEMA_STATEMENTS)db.exec(sql);
 db.exec("CREATE TABLE organization_projects(project_id TEXT,owner_user_id TEXT,project_access_id TEXT,organization_id TEXT,status TEXT);CREATE TABLE project_resource_scopes(project_access_id TEXT,resource_kind TEXT,resource_id TEXT,owner_user_id TEXT,organization_id TEXT,project_id TEXT);CREATE TABLE project_event_scopes(project_access_id TEXT,owner_user_id TEXT,project_id TEXT,organization_id TEXT,event_id TEXT,actor_user_id TEXT);CREATE TABLE organizations(organization_id TEXT,status TEXT);CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,owner_user_id TEXT,status TEXT);CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT,revoked_at TEXT,accepted_at TEXT);");
 const controls={beforeRun:null,afterRead:null};
 const env={DB:{prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){const value=db.prepare(sql).get(...args)??null;await controls.afterRead?.(sql,args,value);return value;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){await controls.beforeRun?.(sql,args);return /^\s*(SELECT|WITH)\b/i.test(sql)?{success:true,results:db.prepare(sql).all(...args),meta:{changes:0}}:{success:true,results:[],meta:db.prepare(sql).run(...args)};}};},async batch(statements){db.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.run());db.exec('COMMIT');return rows;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const user={userId:'owner',streamId:'creative:owner'},projection={projects:[{id:'project'}],documents:[{id:'document',projectId:'project'}],blocks:[]};
 const handle=createStillActionOutcomesHandler(async request=>request.headers.get('test-user')==='denied'?Response.json({error:'denied'},{status:403}):{user:request.headers.get('test-user')==='other'?{userId:'other',streamId:'creative:other'}:user,projection});
 const call=(path,method='GET',body,userId='owner')=>handle(new Request('https://still.test/api/still/'+path,{method,headers:{origin:'https://still.test','test-user':userId},...(body?{body:JSON.stringify(body)}:{})}),env);
 let directDecisionId;
 const opt=async(selectedScope=scope)=>{const response=await call('action-context','PUT',{scope:selectedScope,enabled:true});directDecisionId=(await response.clone().json()).directDecisionId;return response;};
 const receipt=()=>createStillDecisionReceipt(env,user,{position:scope,stateFingerprint:'a'.repeat(64),policy:'test',head:0,response:{source:'jev',model:'test',candidateIds:['compose','add-context'],actions:[{id:'compose'}],nextBest:{choice:'compose'},provider:{usage:{total_tokens:14}}}});
 const observe=body=>call('action-observations','POST',{scope,surface:'document',source:'direct',decisionId:directDecisionId,...body});
 return{db,env,user,call,opt,receipt,observe,controls};
}
test('optional goals remain private and independent of account history; completion, clear and scope isolation work',async()=>{
 const h=harness();await h.call('action-context','PUT',{scope,enabled:false});const save=await h.call('goal','PUT',{scope,text:'Fictional goal',criteria:['Clear motive'],remember:true});assert.equal(save.status,200);const {goal}=await save.json();
 assert.ok(goal.id);assert.equal((await readStillActionContext(h.env,h.user,scope)).enabled,false);
 assert.equal((await readStillActionContext(h.env,h.user,scope)).goal.text,'Fictional goal');
 assert.equal((await readStillActionContext(h.env,{userId:'other'},scope)).goal,undefined);
 assert.equal((await readStillActionContext(h.env,h.user,{projectId:'other',documentId:'other'})).goal,undefined);
 assert.equal((await h.call('goal','POST',{scope,id:goal.id,status:'completed'})).status,200);
 assert.equal((await readStillActionContext(h.env,h.user,scope)).goal,undefined);
 await h.call('goal','DELETE',{scope});assert.equal(h.db.prepare('SELECT content FROM private_content').get().content,'');
 assert.equal((await h.call('goal','PUT',{scope,text:'x',criteria:[],remember:false})).status,400);
 assert.equal((await h.call('goal','PUT',{scope,text:'x',criteria:[],remember:true},'denied')).status,403);
});
test('receipts require an authorized current recording window and strip creative state and provider prose',async()=>{
 const h=harness();assert.equal(await h.receipt(),undefined);assert.equal((await readStillActionContext(h.env,h.user,scope)).enabled,true);const receipt=await h.receipt();assert.ok(receipt.decisionId);
 const body=JSON.parse(h.db.prepare('SELECT body FROM still_action_receipts WHERE decision_id=?').get(receipt.decisionId).body);assert.equal(body.usage.total_tokens,14);assert.deepEqual(body.finalActionIds,['compose']);
 const safe=decisionReceiptBody({stateFingerprint:'a'.repeat(64),policy:'v',head:0,response:{prompt:'PRIVATE',state:{body:'PRIVATE'},model:'model',provider:{usage:{total_tokens:2,body:'PRIVATE'}}}},'id','now','later');assert.ok(!JSON.stringify(safe).includes('PRIVATE'));
 await h.call('action-context','PUT',{scope,enabled:false});assert.equal(await h.receipt(),undefined);assert.equal(h.db.prepare('SELECT count(*) n FROM still_action_receipts').get().n,0);
});
test('exposure, selection and invocation are separate; candidate and actor checks cannot be forged',async()=>{
 const h=harness();await h.opt();const {decisionId}=await h.receipt();
 assert.equal((await h.observe({id:'selection',kind:'selection',source:'toolbar',decisionId,actionId:'compose'})).status,409);
 assert.equal((await h.observe({id:'foreign',kind:'exposure',source:'toolbar',decisionId:'not-owned',displayedActionIds:['compose']})).status,409);
 assert.equal((await h.observe({id:'exposure',kind:'exposure',source:'toolbar',decisionId,displayedActionIds:['compose']})).status,201);
 assert.equal((await h.observe({id:'selection',kind:'selection',source:'toolbar',decisionId,actionId:'compose',parentId:'exposure'})).status,201);
 assert.equal((await h.observe({id:'invocation',kind:'invocation',source:'toolbar',decisionId,actionId:'compose',parentId:'selection'})).status,201);
 assert.equal((await h.observe({id:'cancel',kind:'cancellation',source:'toolbar',decisionId,actionId:'compose',parentId:'invocation'})).status,201);
 const other=await h.call('action-observations','POST',{scope,id:'foreign-user',kind:'exposure',surface:'document',source:'toolbar',decisionId,displayedActionIds:['compose']},'other');assert.equal(other.status,409);
 assert.equal(h.db.prepare('SELECT count(*) n FROM events').get().n,0);
});
test('direct operations require verified committed evidence; another owner or old event cannot become an outcome',async()=>{
 const h=harness();await h.opt();assert.equal((await h.observe({id:'invoke',kind:'invocation',actionId:'compose'})).status,201);
 assert.equal((await h.observe({id:'missing',kind:'commit',actionId:'compose',parentId:'invoke',eventIds:['unknown']})).status,409);
 const at=new Date().toISOString();
 h.db.prepare("UPDATE still_action_observations SET body=json_set(body,'$.recordedAt',?),created_at=? WHERE observation_id='invoke'").run(new Date(Date.now()+5000).toISOString(),new Date(Date.now()+5000).toISOString());
 h.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('foreign','creative:other','user:other','BlockCreated',at,'corr',JSON.stringify({document_id:'document',project_id:'project'}));
 h.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('historical','creative:owner','user','BlockCreated',new Date(Date.now()-60_000).toISOString(),'old-corr',JSON.stringify({document_id:'document',project_id:'project'}));
 assert.equal((await h.observe({id:'prior',kind:'commit',actionId:'compose',parentId:'invoke',eventIds:['historical']})).status,409);
 assert.equal((await h.observe({id:'wrong',kind:'commit',actionId:'compose',parentId:'invoke',eventIds:['foreign']})).status,409);
 h.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('committed','creative:owner','user','BlockCreated',at,'corr',JSON.stringify({document_id:'document',project_id:'project'}));
 const response=await h.observe({id:'commit',kind:'commit',actionId:'compose',parentId:'invoke',eventIds:['committed']});assert.equal(response.status,201);const {observation}=await response.json();assert.deepEqual(observation.evidence.eventTypes,['BlockCreated']);assert.equal(observation.evidence.authority,'server-verified-references');assert.equal(observation.quality,undefined);
 assert.equal((await h.observe({id:'commit',kind:'commit',actionId:'compose',parentId:'invoke',eventIds:['committed']})).status,200);
});
test('retention and explicit deletion remove derived evidence without changing creative head',async()=>{
 const h=harness();await h.opt();await h.receipt();await h.observe({id:'invoke',kind:'invocation',actionId:'compose'});await h.call('goal','PUT',{scope,text:'Erase this',criteria:[],remember:true});
 const old=new Date(Date.now()-1).toISOString();for(const table of ['still_action_preferences','still_action_receipts','still_action_observations','still_action_goals'])h.db.prepare(`UPDATE ${table} SET expires_at=?`).run(old);h.db.prepare('UPDATE private_content SET expires_at=?').run(old);
 await sweepStillActionOutcomes(h.env);assert.equal((await readStillActionContext(h.env,h.user,scope)).observations.length,0);assert.equal(h.db.prepare('SELECT content FROM private_content').get().content,'');
 await h.opt();await h.receipt();const erased=await h.call('action-context','DELETE',{scope});assert.equal((await erased.json()).enabled,true);assert.equal(h.db.prepare('SELECT count(*) n FROM still_action_preferences').get().n,1);assert.equal(h.db.prepare('SELECT count(*) n FROM still_action_observations').get().n,0);
 assert.equal((await stillActionPrivacyDefinitions(h.env,'owner')).length,4);
});
test('bounds reject passive attention, invalid shapes, unknown actions and excessive feedback expiry',()=>{
 const input={id:'id',scope,surface:'document',source:'direct',kind:'feedback',actionId:'compose',feedback:'helpful'};
 assert.ok(cleanActionObservation(input,['compose']));assert.equal(cleanActionObservation({...input,kind:'hover'},['compose']),undefined);assert.equal(cleanActionObservation({...input,actionId:'fabricated'},['compose']),undefined);
 assert.equal(cleanActionObservation({...input,feedbackExpiresAt:new Date(Date.now()+ACTION_RETENTION_MS+60000).toISOString()},['compose']),undefined);
 assert.equal(cleanActionObservation({...input,scope:{documentId:'document'}},['compose']),undefined);
 assert.equal(cleanActionObservation({...input,kind:'invocation',feedback:'Authored private material'},['compose']),undefined);
});
test('migration and bootstrap share identical additive schema',()=>{
 const migrated=new DatabaseSync(':memory:'),bootstrapped=new DatabaseSync(':memory:');migrated.exec(readFileSync(new URL('../drizzle/0074_still_action_outcomes.sql',import.meta.url),'utf8'));migrated.exec(readFileSync(new URL('../drizzle/0075_still_user_settings.sql',import.meta.url),'utf8'));for(const sql of STILL_ACTION_OUTCOMES_SCHEMA)bootstrapped.exec(sql);
 const objects=db=>db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();assert.deepEqual(objects(migrated),objects(bootstrapped));
 bootstrapped.exec("CREATE TABLE events(id TEXT PRIMARY KEY);INSERT INTO events VALUES('creative-head');");for(const sql of STILL_ACTION_OUTCOMES_SCHEMA)bootstrapped.exec(sql);
 for(const table of ['still_action_preferences','still_action_receipts','still_action_observations','still_action_goals'])assert.equal(bootstrapped.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
 assert.deepEqual(bootstrapped.prepare('SELECT id FROM events').all().map(r=>r.id),['creative-head']);migrated.close();bootstrapped.close();
});
test('direct windows limit new invocation while preserving delayed commits from a long form',async()=>{
 const h=harness();await h.opt();assert.equal((await h.observe({id:'invoke',kind:'invocation',actionId:'compose'})).status,201);
 h.db.prepare("UPDATE still_action_receipts SET body=json_set(body,'$.contextWindowExpiresAt',?)").run(new Date(Date.now()-1000).toISOString());
 assert.equal((await h.observe({id:'new-invoke',kind:'invocation',actionId:'compose'})).status,409);
 h.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('late-result','creative:owner','user','BlockCreated',new Date().toISOString(),'corr',JSON.stringify({document_id:'document',project_id:'project'}));
 assert.equal((await h.observe({id:'long-form-commit',kind:'commit',actionId:'compose',parentId:'invoke',eventIds:['late-result']})).status,201);
});
test('active corrections survive exposure traffic and disclose separate retrieval coverage',async()=>{
 const h=harness();await h.opt();await h.observe({id:'correction',kind:'feedback',actionId:'compose',feedback:'not-useful-now',feedbackScope:'document'});
 const {decisionId}=await h.receipt();for(let i=0;i<45;i++)await h.observe({id:'exposure-'+i,kind:'exposure',source:'toolbar',decisionId,displayedActionIds:['compose']});
 const context=await readStillActionContext(h.env,h.user,scope,undefined,true);assert.equal(context.observations[0].id,'correction');assert.equal(context.observations.length,1);assert.equal(context.coverage.feedback.returned,1);
});
test('retention is clamped to stricter deployment policy and goal criteria share the contract',async()=>{
 const h=harness();h.env.FORMA_RETENTION_DAYS='7';await h.opt();const now=Date.now(),row=h.db.prepare('SELECT expires_at FROM still_action_preferences').get();assert.ok(Date.parse(row.expires_at)<=now+7*86_400_000);
 const saved=await h.call('goal','PUT',{scope,text:'Short retention',criteria:['a'],remember:true});assert.equal(saved.status,200);assert.ok(Date.parse((await saved.json()).goal.expiresAt)<=Date.now()+7*86_400_000);
 assert.equal((await h.call('goal','PUT',{scope,text:'Too many',criteria:Array(6).fill('criterion'),remember:true})).status,400);
});
test('stricter organization retention also bounds a private goal for a shared target',async()=>{
 const h=harness();h.env.FORMA_RETENTION_DAYS='14';h.db.exec("CREATE TABLE organization_retention_policies(organization_id TEXT,transient_days INTEGER);INSERT INTO organization_retention_policies VALUES('org',3)");
 const now=Date.now(),expiresAt=await actionRetentionUntil(h.env,{organizationId:'org'},now);assert.equal(Date.parse(expiresAt)-now,3*86_400_000);
});
test('delivery receipts preserve shared assessment provenance instead of multiplying provider usage',()=>{
 const input={stateFingerprint:'a'.repeat(64),policy:'v',head:0,response:{source:'jev',assessmentId:'one-assessment',model:'model',provider:{usage:{total_tokens:12}},cache:{status:'miss'}}};
 const first=decisionReceiptBody(input,'first','now','later'),shared=decisionReceiptBody({...input,response:{...input.response,cache:{status:'shared'}}},'second','now','later');
 assert.equal(first.assessmentId,shared.assessmentId);assert.equal(first.cache,'miss');assert.equal(shared.cache,'shared');assert.equal(shared.usageBasis,'original-assessment-not-per-delivery');
 assert.equal(decisionReceiptBody({...input,response:{...input.response,nextBest:{choice:'compose',status:'Invalidated'},paletteActions:[{id:'compose'}],resolvedAction:'compose'}},'third','now','later').nextBest.choice,null);
});
test('actual interactive exposure retains bounded presentation timing and primary identity only',()=>{
 const base={id:'view',scope,surface:'document',source:'toolbar',kind:'exposure',decisionId:'decision',displayedActionIds:['compose'],primaryActionId:'compose',interactiveLatencyMs:432};
 const row=cleanActionObservation(base,['compose']);assert.equal(row.interactiveLatencyMs,432);assert.equal(row.primaryActionId,'compose');
 for(const latency of [-1,1.5,Infinity,300001])assert.equal(cleanActionObservation({...base,interactiveLatencyMs:latency},['compose']),undefined);
 assert.equal(cleanActionObservation({...base,primaryActionId:'add-context'},['compose','add-context']),undefined);
 assert.equal(cleanActionObservation({...base,kind:'invocation',actionId:'compose'},['compose']),undefined);
});

const workflow=(overrides={})=>({version:'still-workflow-v1',instanceId:'draft',stage:'final-review',transition:'final-review',status:'confirmed',target:{kind:'creation-draft',id:'draft',revision:'1'},draftRevision:1,occurredAt:new Date().toISOString(),...overrides});
const outcome=(overrides={})=>{const now=new Date().toISOString();return {version:'still-outcome-v1',outcomeId:'outcome',revision:1,type:'completed-job',status:'pending',target:{kind:'document',id:'document',revision:'document-revision'},occurredAt:now,horizonStartedAt:now,horizonMs:60_000,...overrides};};
function retainedDraft(h,actor='owner'){
 const now=new Date().toISOString(),expires=new Date(Date.now()+86_400_000).toISOString(),contentId='draft-content-'+actor;
 h.db.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)').run(contentId,actor,'creation-draft',JSON.stringify({id:'draft',revision:1}),now,expires);
 h.db.prepare("INSERT INTO creation_drafts(draft_id,actor_user_id,scope_key,destination_json,revision,state,content_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,1,'active',?,?,?,?)").run('draft',actor,'personal:'+actor,JSON.stringify({entryKind:'idea',...scope}),contentId,expires,now,now);
 h.db.prepare('INSERT INTO creation_draft_content_versions VALUES(?,?,?,?)').run('draft',1,contentId,actor);
 return {now,expires};
}
function retainedOperation(h,{actor='owner',state='applied',revision=1}={}){
 const {now,expires}=retainedDraft(h,actor),receipt={schemaVersion:1,operationId:'creation-operation',previewId:'creation-operation',approvalHash:'a'.repeat(64),idMap:{},created:[],uses:[],status:'committed',projectId:'project',primaryDocumentId:'document'};
 h.db.prepare("INSERT INTO creation_operations(operation_id,draft_id,actor_user_id,scope_key,draft_revision,kind,state,request_hash,approval_hash,receipt_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,'commit',?,?,?,?,?,?,?)").run('creation-operation','draft',actor,'personal:'+actor,revision,state,'request-hash',receipt.approvalHash,state==='applied'?JSON.stringify(receipt):null,expires,now,now);
 return receipt;
}
async function status(response,expected){assert.equal(response.status,expected,await response.clone().text());return response.json();}

test('semantic workflow reports preserve occurrence, causal late delivery, idempotency and diagnostic separation',async()=>{
 const h=harness();await h.opt();const started=workflow({stage:'draft',transition:'entered'});
 await status(await h.observe({id:'start',kind:'workflow',actionId:'compose',workflow:started}),201);
 const child={id:'help',kind:'workflow',actionId:'compose',parentId:'start',workflow:workflow({transition:'help-opened',occurredAt:started.occurredAt})};
 const result=await status(await h.observe(child),201);assert.equal(result.observation.interpretation,'diagnostic-client-report');assert.equal(result.observation.workflow.occurredAt,started.occurredAt);
 assert.equal((await status(await h.observe(child),200)).replayed,true);
 await status(await h.observe({...child,workflow:{...child.workflow,transition:'backtracked'}}),409);
 await status(await h.observe({...child,id:'foreign-chain',workflow:{...child.workflow,instanceId:'other-draft',target:{kind:'creation-draft',id:'other-draft',revision:'1'}}}),409);
 await status(await h.observe({...child,id:'child-first',parentId:'not-delivered'}),409);
 assert.equal((await readStillActionContext(h.env,h.user,scope,undefined,true)).observations.length,0);
 assert.equal(h.db.prepare('SELECT count(*) n FROM events').get().n,0);
});

test('confirmed creation finalization and reconciliation bind exact retained actor, operation and draft revision',async()=>{
 const h=harness();await h.opt();retainedOperation(h);
 const initial={id:'finalized',kind:'workflow',actionId:'compose',workflow:workflow({transition:'finalize',operationId:'creation-operation'})};
 const response=await status(await h.observe(initial),201);assert.equal(response.observation.evidence.operationStatus,'applied');assert.equal(response.observation.evidence.approvalHash,'a'.repeat(64));
 await status(await h.observe({...initial,id:'wrong-revision',workflow:{...initial.workflow,draftRevision:2,target:{...initial.workflow.target,revision:'2'}}}),409);
 await status(await h.observe({...initial,id:'missing-operation',workflow:{...initial.workflow,operationId:'missing'}}),409);
 await status(await h.observe({id:'reconcile',kind:'workflow',actionId:'compose',parentId:'finalized',workflow:workflow({transition:'reconciled',status:'reconciled',operationId:'creation-operation'})}),201);
 const other=harness();await other.opt();retainedOperation(other,{actor:'other'});await status(await other.observe(initial),409);
 const pending=harness();await pending.opt();retainedOperation(pending,{state:'review'});await status(await pending.observe(initial),409);
});

test('job admission, completion and reported file retrieval are distinct exact-revision observations',async()=>{
 const h=harness();await h.opt();await h.observe({id:'invoke',kind:'invocation',actionId:'compose'});
 const now=new Date().toISOString(),expires=new Date(Date.now()+120_000).toISOString();
 h.db.prepare('INSERT INTO document_jobs VALUES(?,?,?,?,?,?,?,?,?)').run('job','owner','document','running','corr','creative:owner',now,expires,JSON.stringify({documentRevision:'document-revision'}));
 const base={id:'job-pending',kind:'outcome',actionId:'compose',parentId:'invoke',jobId:'job',outcome:outcome()};
 await status(await h.observe(base),201);
 const completed={...base,id:'job-completed',outcome:{...base.outcome,revision:2,supersedesId:'job-pending',status:'observed'}};
 await status(await h.observe(completed),409);
 h.db.prepare("UPDATE document_jobs SET status='completed' WHERE job_id='job'").run();
 const observed=await status(await h.observe(completed),201);assert.equal(observed.observation.interpretation,'verified-operation');assert.equal(observed.observation.evidence.jobStatus,'completed');assert.ok(observed.observation.expiresAt<=expires);
 await status(await h.observe({...base,id:'different-revision',outcome:outcome({outcomeId:'other',target:{kind:'document',id:'document',revision:'wrong'}})}),409);
 await status(await h.observe({...base,id:'not-file',outcome:outcome({outcomeId:'file',type:'file-retrieved',status:'observed'})}),409);
 h.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('export-event','creative:owner','user','DocumentArtifactExported',now,'export',JSON.stringify({document_id:'document',artifact_id:'artifact',artifact_revision:3}));
 await status(await h.observe({id:'export-commit',kind:'commit',actionId:'compose',parentId:'invoke',eventIds:['export-event']}),201);
 const retrieved={id:'file',kind:'outcome',actionId:'compose',parentId:'export-commit',eventIds:['export-event'],outcome:outcome({outcomeId:'file',type:'file-retrieved',status:'observed',target:{kind:'artifact',id:'artifact',revision:'3'}})};
 const file=await status(await h.observe(retrieved),201);assert.equal(file.observation.interpretation,'diagnostic-client-report');assert.equal(file.observation.assessment,undefined);
 await status(await h.observe({...retrieved,id:'wrong-file',outcome:{...retrieved.outcome,outcomeId:'wrong-file',target:{...retrieved.outcome.target,revision:'4'}}}),409);
});

test('quality assessments require explicit final review, exact saved revision and stated goal criteria; corrections append',async()=>{
 const h=harness();await h.opt();retainedDraft(h);
 const {goal}=await status(await h.call('goal','PUT',{scope,text:'Fictional success criteria',criteria:['Clear motive'],remember:true}),200);
 const review=workflow();await status(await h.observe({id:'review',kind:'workflow',actionId:'compose',workflow:review}),201);
 const base={id:'quality',kind:'assessment',actionId:'compose',parentId:'review',assessment:{version:'still-quality-assessment-v1',assessmentId:'quality-series',revision:1,target:review.target,workflowInstanceId:'draft',goalId:goal.id,criteria:[{index:0,result:'met'}],acceptance:'accepted',occurredAt:review.occurredAt,horizonStartedAt:review.occurredAt,horizonMs:60_000}};
 const first=await status(await h.observe(base),201);assert.equal(first.observation.interpretation,'explicit-user-report');
 const correction={...base,id:'quality-correction',assessment:{...base.assessment,revision:2,supersedesId:'quality',acceptance:'needs-work',criteria:[{index:0,result:'not-met'}]}};
 await status(await h.observe(correction),201);assert.equal(h.db.prepare("SELECT count(*) n FROM still_action_observations WHERE kind='assessment'").get().n,2);
 await status(await h.observe({...correction,id:'fork'}),409);
 await status(await h.observe({...base,id:'unreviewed',parentId:undefined,assessment:{...base.assessment,assessmentId:'unreviewed'}}),409);
 await status(await h.observe({...base,id:'wrong-target',assessment:{...base.assessment,assessmentId:'wrong-target',target:{...review.target,revision:'2'}}}),409);
 await status(await h.observe({...base,id:'wrong-criteria',assessment:{...base.assessment,assessmentId:'wrong-criteria',criteria:[{index:1,result:'met'}]}}),409);
 h.db.prepare("UPDATE private_content SET content='',redacted_at=? WHERE kind='creation-draft'").run(new Date().toISOString());
 const revoked={...correction,id:'quality-revoked',assessment:{...correction.assessment,revision:3,supersedesId:'quality-correction',acceptance:'revoked',criteria:[]}};
 await status(await h.observe(revoked),201);assert.equal((await readStillActionContext(h.env,h.user,scope,undefined,true)).observations.length,0);
 await h.call('action-context','PUT',{scope,enabled:false});await status(await h.observe({...base,id:'post-optout'}),409);
 await h.opt();await status(await h.observe({...base,id:'new-epoch'}),409);
});

test('late observed outcomes and right censoring retain declared horizon without extending retention',async()=>{
 const h=harness();await h.opt();await h.observe({id:'invoke',kind:'invocation',actionId:'compose'});
 const preference=h.db.prepare('SELECT created_at FROM still_action_preferences').get().created_at,started=new Date(Date.parse(preference)-1000).toISOString();
 const base={id:'late-pending',kind:'outcome',actionId:'compose',parentId:'invoke',outcome:outcome({horizonStartedAt:started,horizonMs:1,status:'pending'})};
 const pending=await status(await h.observe(base),201);assert.equal(pending.observation.late,true);
 const censored={...base,id:'censored',outcome:{...base.outcome,revision:2,supersedesId:'late-pending',status:'censored'}};
 const result=await status(await h.observe(censored),201);assert.ok(result.observation.expiresAt<=new Date(Date.parse(started)+ACTION_RETENTION_MS).toISOString());
 await status(await h.observe({...base,id:'future-censor',outcome:outcome({outcomeId:'future',status:'censored',horizonMs:60_000})}),400);
 const context=await readStillActionContext(h.env,h.user,scope);assert.equal(context.observations.find(row=>row.id==='censored').outcome.status,'censored');
});


test('clearing a remembered goal erases its assessment derivatives while preserving unrelated diagnostic history',async()=>{
 const h=harness();await h.opt();retainedDraft(h);
 const {goal}=await status(await h.call('goal','PUT',{scope,text:'Private goal to clear',criteria:['Specific criterion'],remember:true}),200);
 const review=workflow();await status(await h.observe({id:'review-erase',kind:'workflow',actionId:'compose',workflow:review}),201);
 await status(await h.observe({id:'assessment-erase',kind:'assessment',actionId:'compose',parentId:'review-erase',assessment:{version:'still-quality-assessment-v1',assessmentId:'erase-series',revision:1,target:review.target,workflowInstanceId:'draft',goalId:goal.id,criteria:[{index:0,result:'met'}],acceptance:'accepted',occurredAt:review.occurredAt,horizonStartedAt:review.occurredAt,horizonMs:60_000}}),201);
 await status(await h.call('goal','DELETE',{scope,id:goal.id}),200);
 assert.equal(h.db.prepare("SELECT count(*) n FROM still_action_observations WHERE kind='assessment'").get().n,0);
 assert.equal(h.db.prepare("SELECT count(*) n FROM still_action_observations WHERE kind='workflow'").get().n,1);
 assert.equal(h.db.prepare("SELECT content FROM private_content WHERE kind='still-goal'").get().content,'');
});

test('root-scoped creation receipts and assessments follow current custody after the draft creates a project',async()=>{
 const h=harness();await h.opt({});retainedOperation(h);
 h.db.prepare('UPDATE creation_drafts SET destination_json=?').run(JSON.stringify({entryKind:'project'}));
 const {goal}=await status(await h.call('goal','PUT',{scope:{},text:'Criteria for a new project',criteria:['Clear purpose'],remember:true}),200);
 const review=workflow();await status(await h.observe({scope:{},id:'root-review',kind:'workflow',actionId:'compose',workflow:review}),201);
 const assessment={scope:{},id:'root-assessment',kind:'assessment',actionId:'compose',parentId:'root-review',assessment:{version:'still-quality-assessment-v1',assessmentId:'root-quality',revision:1,target:review.target,workflowInstanceId:'draft',goalId:goal.id,criteria:[{index:0,result:'met'}],acceptance:'accepted',occurredAt:review.occurredAt,horizonStartedAt:review.occurredAt,horizonMs:60_000}};
 await status(await h.observe(assessment),201);
 h.db.prepare("UPDATE creation_drafts SET state='applied',operation_id='creation-operation'").run();
 const report={scope:{},id:'root-finalized',kind:'workflow',actionId:'compose',workflow:workflow({transition:'finalize',operationId:'creation-operation'})};
 await status(await h.observe(report),201);
 const visible=await readStillActionContext(h.env,h.user,{});assert.equal(visible.observations.length,3);
 // Migrate the formerly personal target into unavailable organization custody.
 // Root authorization still succeeds; exact target authorization must not.
 h.db.prepare('INSERT INTO organization_projects VALUES(?,?,?,?,?)').run('project','owner','access','organization','inactive');
 await status(await h.observe(report),409);await status(await h.observe(assessment),409);
 const withheld=await readStillActionContext(h.env,h.user,{});assert.deepEqual(withheld.observations.map(row=>row.id),['root-review']);assert.equal(withheld.coverage.withheld,2);assert.match(withheld.coverage.interpretation,/unknown/);
 assert.equal(h.db.prepare("SELECT count(*) n FROM still_action_observations WHERE observation_id IN('root-finalized','root-assessment')").get().n,2,'Authorization changes do not rewrite historical evidence');
});


test('history defaults on after authorization and account opt-out survives expiry, scope changes and erasure',async()=>{
 const h=harness(),otherScope={projectId:'project',documentId:'other-document'};
 const first=await h.call('action-context?'+new URLSearchParams(scope));assert.equal(first.status,200);const initial=await first.json();assert.equal(initial.enabled,true);assert.ok(initial.directDecisionId);
 assert.equal(h.db.prepare('SELECT count(*) n FROM still_user_settings').get().n,0,'Default does not manufacture an explicit account choice');
 const firstEpoch=h.db.prepare('SELECT epoch FROM still_action_preferences').get().epoch;
 assert.ok(Date.parse(initial.expiresAt)<=Date.now()+ACTION_RETENTION_MS);
 h.db.prepare('UPDATE still_action_preferences SET expires_at=?').run(new Date(Date.now()-1).toISOString());
 const renewed=await readStillActionContext(h.env,h.user,scope);assert.equal(renewed.enabled,true);assert.notEqual(h.db.prepare('SELECT epoch FROM still_action_preferences').get().epoch,firstEpoch);
 await h.opt();await h.observe({id:'first-scope',kind:'invocation',actionId:'compose'});
 await h.opt(otherScope);await h.call('action-observations','POST',{scope:otherScope,id:'second-scope',kind:'invocation',actionId:'compose',source:'direct',surface:'document',decisionId:(await h.call('action-context?'+new URLSearchParams(otherScope)).then(r=>r.json())).directDecisionId});
 const goals=[];for(const selectedScope of [scope,otherScope])goals.push((await h.call('goal','PUT',{scope:selectedScope,text:'Keep my optional goal',criteria:[],remember:true}).then(r=>r.json())).goal.id);
 const otherContext=await h.call('action-context?'+new URLSearchParams(scope),'GET',undefined,'other').then(r=>r.json());assert.equal(otherContext.enabled,true);
 const otherBefore=h.db.prepare("SELECT * FROM still_action_preferences WHERE owner_id='other'").all();
 const off=await h.call('action-context','PUT',{scope,enabled:false});assert.equal((await off.json()).enabled,false);
 for(const table of ['still_action_preferences','still_action_receipts','still_action_observations'])assert.equal(h.db.prepare(`SELECT count(*) n FROM ${table} WHERE owner_id='owner'`).get().n,0);
 assert.deepEqual(h.db.prepare("SELECT goal_id FROM still_action_goals WHERE owner_id='owner'").all().map(row=>row.goal_id).sort(),goals.sort());
 h.db.prepare('UPDATE still_user_settings SET updated_at=?').run('2000-01-01T00:00:00.000Z');await sweepStillActionOutcomes(h.env);
 for(const selectedScope of [scope,otherScope,{}])assert.equal((await readStillActionContext(h.env,h.user,selectedScope)).enabled,false);
 assert.equal((await h.call('action-context','DELETE',{scope}).then(r=>r.json())).enabled,false,'Scope erasure preserves account opt-out');
 assert.equal(h.db.prepare("SELECT suggestion_history_enabled FROM still_user_settings WHERE owner_id='owner'").get().suggestion_history_enabled,0);
 assert.deepEqual(h.db.prepare("SELECT * FROM still_action_preferences WHERE owner_id='other'").all(),otherBefore);
 for(const definition of await stillActionPrivacyDefinitions(h.env,'owner'))await h.env.DB.prepare(definition.set+' WHERE '+definition.where).bind(...definition.bindings).run();
 assert.equal((await readStillActionContext(h.env,h.user,scope)).enabled,false,'Personal evidence erasure also preserves durable opt-out');
 assert.equal((await h.call('action-context','PUT',{scope,enabled:true}).then(r=>r.json())).enabled,true);
 assert.equal((await readStillActionContext(h.env,h.user,otherScope)).enabled,true);
});

test('scope erasure preserves account choice and other scopes while rejecting the old recording epoch',async()=>{
 const h=harness(),otherScope={projectId:'project',documentId:'other-document'};await h.opt();
 const before=await h.call('action-context?'+new URLSearchParams(scope)).then(r=>r.json());
 await h.observe({id:'old-invocation',kind:'invocation',actionId:'compose'});await h.call('goal','PUT',{scope,text:'Clear me',criteria:[],remember:true});
 await readStillActionContext(h.env,h.user,otherScope);const otherBefore=h.db.prepare('SELECT * FROM still_action_preferences WHERE scope_key!=?').all(JSON.stringify(['still-action-context-v1','','project','document','']));
 const erased=await h.call('action-context','DELETE',{scope}).then(r=>r.json());assert.equal(erased.enabled,true);assert.equal(erased.goal,undefined);assert.notEqual(erased.directDecisionId,before.directDecisionId);
 assert.equal(h.db.prepare('SELECT count(*) n FROM still_action_observations').get().n,0);assert.equal(h.db.prepare('SELECT content FROM private_content').get().content,'');
 assert.equal((await h.observe({id:'stale-invocation',kind:'invocation',actionId:'compose',decisionId:before.directDecisionId})).status,409);
 assert.equal((await h.observe({id:'fresh-invocation',kind:'invocation',actionId:'compose',decisionId:erased.directDecisionId})).status,201);
 assert.deepEqual(h.db.prepare('SELECT * FROM still_action_preferences WHERE scope_key!=?').all(JSON.stringify(['still-action-context-v1','','project','document',''])),otherBefore);
 assert.equal(h.db.prepare("SELECT suggestion_history_enabled FROM still_user_settings WHERE owner_id='owner'").get().suggestion_history_enabled,1);
});

test('recording inserts recheck account opt-out and current epoch atomically after earlier reads',async()=>{
 for(const kind of ['lease','receipt','observation']){
  const h=harness();if(kind!=='lease')await h.opt();
  const table=kind==='lease'?'still_action_preferences':kind==='receipt'?'still_action_receipts':'still_action_observations';
  const before=h.db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
  h.controls.beforeRun=async sql=>{if(!sql.startsWith(kind==='observation'?'INSERT OR IGNORE INTO '+table:'INSERT INTO '+table))return;h.controls.beforeRun=null;h.db.prepare('INSERT INTO still_user_settings VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET suggestion_history_enabled=0').run('owner',0,new Date().toISOString());};
  if(kind==='lease')assert.equal((await readStillActionContext(h.env,h.user,scope)).enabled,false);
  else if(kind==='receipt')assert.equal(await h.receipt(),undefined);
  else assert.equal((await h.observe({id:'raced-write',kind:'invocation',actionId:'compose'})).status,409);
  assert.equal(h.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,before);
 }
 for(const kind of ['receipt','observation']){
  const h=harness();await h.opt();
  h.controls.beforeRun=async sql=>{if(!sql.startsWith(kind==='observation'?'INSERT OR IGNORE INTO still_action_observations':'INSERT INTO still_action_receipts'))return;h.controls.beforeRun=null;await h.call('action-context','PUT',{scope,enabled:false});await h.opt();};
  if(kind==='receipt')assert.equal(await h.receipt(),undefined);else assert.equal((await h.observe({id:'old-epoch-write',kind:'invocation',actionId:'compose'})).status,409);
  assert.equal(h.db.prepare("SELECT count(*) n FROM still_action_observations WHERE observation_id='old-epoch-write'").get().n,0);
 }
});

test('unavailable account preference or retained context fails closed without blocking ordinary creative history',async()=>{
 for(const table of ['still_user_settings','still_action_goals']){
  const h=harness();await h.opt();h.db.exec('DROP TABLE '+table);
  const context=await readStillActionContext(h.env,h.user,scope);assert.equal(context.enabled,false);assert.equal(context.coverage.status,'unavailable');assert.deepEqual(context.observations,[]);
  assert.equal(h.db.prepare('SELECT count(*) n FROM events').get().n,0);
 }
});


test('retained goal delivery rechecks exact active private goal after concurrent erasure, completion or replacement',async()=>{
 for(const mutation of ['scope-erase','complete','replace','redact','expire']){
  const h=harness();await h.opt();
  const original=await h.call('goal','PUT',{scope,text:'Original goal',criteria:['Original criterion'],remember:true}).then(r=>r.json());
  h.controls.afterRead=async sql=>{
   if(!sql.startsWith('SELECT goal.goal_id'))return;h.controls.afterRead=null;
   if(mutation==='scope-erase')await h.call('action-context','DELETE',{scope});
   else if(mutation==='complete')await h.call('goal','POST',{scope,id:original.goal.id,status:'completed'});
   else if(mutation==='replace')await h.call('goal','PUT',{scope,text:'Replacement goal',criteria:[],remember:true});
   else if(mutation==='redact')h.db.prepare("UPDATE private_content SET content='',redacted_at=? WHERE kind='still-goal'").run(new Date().toISOString());
   else h.db.prepare("UPDATE private_content SET expires_at=? WHERE kind='still-goal'").run('2000-01-01T00:00:00.000Z');
  };
  const delivered=await readStillActionContext(h.env,h.user,scope);assert.equal(delivered.goal,undefined,mutation+' must not deliver the previous goal');
  if(mutation==='replace')assert.equal((await readStillActionContext(h.env,h.user,scope)).goal.text,'Replacement goal');
 }
});
