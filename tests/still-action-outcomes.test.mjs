import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cleanActionObservation, ACTION_RETENTION_MS } from '../src/still/action-outcomes.ts';
import { createStillActionOutcomesHandler } from '../worker/still-action-outcomes-api.ts';
import { actionRetentionUntil, createStillDecisionReceipt, decisionReceiptBody, readStillActionContext, sweepStillActionOutcomes, stillActionPrivacyDefinitions } from '../worker/still-action-outcomes.ts';
import { STILL_ACTION_OUTCOMES_SCHEMA } from '../worker/still-action-outcomes-schema.ts';
const scope={projectId:'project',documentId:'document'};
function harness(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0074_still_action_outcomes.sql',import.meta.url),'utf8'));
 db.exec("CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT);CREATE TABLE events(event_id TEXT,stream_id TEXT,actor TEXT,type TEXT,recorded_at TEXT,correlation_id TEXT,payload TEXT);CREATE TABLE document_jobs(job_id TEXT,owner_id TEXT,document_id TEXT,status TEXT,correlation_id TEXT,stream_id TEXT,requested_at TEXT,expires_at TEXT);");
 const env={DB:{prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:db.prepare(sql).run(...args)};}};},async batch(statements){db.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.run());db.exec('COMMIT');return rows;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const user={userId:'owner',streamId:'creative:owner'},projection={projects:[{id:'project'}],documents:[{id:'document',projectId:'project'}],blocks:[]};
 const handle=createStillActionOutcomesHandler(async request=>request.headers.get('test-user')==='denied'?Response.json({error:'denied'},{status:403}):{user:request.headers.get('test-user')==='other'?{userId:'other',streamId:'creative:other'}:user,projection});
 const call=(path,method='GET',body,userId='owner')=>handle(new Request('https://still.test/api/still/'+path,{method,headers:{origin:'https://still.test','test-user':userId},...(body?{body:JSON.stringify(body)}:{})}),env);
 let directDecisionId;
 const opt=async()=>{const response=await call('action-context','PUT',{scope,enabled:true});directDecisionId=(await response.clone().json()).directDecisionId;return response;};
 const receipt=()=>createStillDecisionReceipt(env,user,{position:scope,stateFingerprint:'a'.repeat(64),policy:'test',head:0,response:{source:'jev',model:'test',candidateIds:['compose','add-context'],actions:[{id:'compose'}],nextBest:{choice:'compose'},provider:{usage:{total_tokens:14}}}});
 const observe=body=>call('action-observations','POST',{scope,surface:'document',source:'direct',decisionId:directDecisionId,...body});
 return{db,env,user,call,opt,receipt,observe};
}
test('optional goals remain private and independent of opt-in; completion, clear and scope isolation work',async()=>{
 const h=harness();const save=await h.call('goal','PUT',{scope,text:'Fictional goal',criteria:['Clear motive'],remember:true});assert.equal(save.status,200);const {goal}=await save.json();
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
test('receipts require explicit current consent and strip creative state and provider prose',async()=>{
 const h=harness();assert.equal(await h.receipt(),undefined);await h.opt();const receipt=await h.receipt();assert.ok(receipt.decisionId);
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
 await h.opt();await h.receipt();await h.call('action-context','DELETE',{scope});assert.equal(h.db.prepare('SELECT count(*) n FROM still_action_preferences').get().n,0);
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
 const migrated=new DatabaseSync(':memory:'),bootstrapped=new DatabaseSync(':memory:');migrated.exec(readFileSync(new URL('../drizzle/0074_still_action_outcomes.sql',import.meta.url),'utf8'));for(const sql of STILL_ACTION_OUTCOMES_SCHEMA)bootstrapped.exec(sql);
 const objects=db=>db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();assert.deepEqual(objects(migrated),objects(bootstrapped));
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
