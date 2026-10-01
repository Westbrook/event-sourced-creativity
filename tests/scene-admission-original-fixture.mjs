import assert from 'node:assert/strict';

import test from 'node:test';

import {registerOutputSourceImports,outputTestDatabase} from './output-server-test-helpers.mjs';

import {readLocalMigrations} from '../scripts/lib/local-migrations.mjs';

const imports=registerOutputSourceImports();

test.after(()=>imports.deregister());

const {ensureSchema}=await import('../worker/runtime.ts');

const {POLICY_VERSION}=await import('../worker/policy-version.ts');

const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/event-write-primitives.ts');

const {handleExperienceIntake}=await import('../worker/experience-intake-api.ts');

const {handleExperienceOutput}=await import('../worker/experience-output-api.ts');

const {registeredExperience,initialValues}=await import('../src/experiences/intake.ts');

const {outputDocumentExecutionBridge}=await import('../worker/output-document-execution.ts');


// Actual source/SQLite and
// actual bridge; no remote transport, production data, or admission replacement.
export async function fixture(t,{renewals=0,history=0}={}){
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());
 const realFetch=globalThis.fetch;let network=0;
 globalThis.fetch=()=>{network++;throw Error('No provider transport in admission test');};
 t.after(()=>{globalThis.fetch=realFetch;assert.equal(network,0);});
 t.mock.timers.enable({apis:['Date'],now:Date.now()});t.after(()=>t.mock.timers.reset());
 const clock=outputTestDatabase();t.after(()=>clock.sqlite.close());
 for(const name of ['strftime','julianday','datetime'])f.sqlite.function(name,{varargs:true},(...args)=>
  clock.sqlite.prepare(`SELECT ${name}(${args.map(()=>'?').join(',')}) AS value`)
   .get(...args.map(value=>value==='now'?new Date().toISOString():value)).value);
 await ensureSchema(f.env);
 for(const migration of readLocalMigrations(new URL('../drizzle/',import.meta.url)).filter(x=>x.tag==='0038_scene_source_generations'))
  for(const sql of migration.sql.split('--> statement-breakpoint'))if(sql.trim())f.sqlite.exec(sql);
 const owner='dev-local-creative',now=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
  .run(owner,'qualification@invalid','Local qualification',POLICY_VERSION,now,now,now);
 if(history){
  const insert=f.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${Array(17).fill('?').join(',')})`);
  f.sqlite.exec('BEGIN');try{for(let i=1;i<=history;i++)insert.run(...eventWriteBindings(makeEvent('creative:'+owner,i,'user:'+owner,'fixture','earlier-activity','DocumentOpened',{document_id:'earlier-document',project_id:'earlier-project',padding:'x'.repeat(3500)})));f.sqlite.exec('COMMIT');}catch(e){f.sqlite.exec('ROLLBACK');throw e;}
 }
 f.env.OPENAI_API_KEY='qualification-not-a-provider-key';f.env.OPENAI_MODEL='gpt-5.6-terra';
 const post=(path,body)=>new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const release=await registeredExperience('scene'),intent={intentId:'00000000-0000-4000-8000-000000000093',experienceId:'scene',releaseHash:release.releaseHash,
  values:{...initialValues(release),...Object.fromEntries(Object.entries({characterA:'Mara',goalA:'Repair a bicycle',characterB:'Eli',goalB:'Keep a gift secret',location:'A bicycle workshop',secret:'The new wheel is a gift'}).map(([key,value])=>[key,{value,provenance:'authored'}]))}};
 let response=await handleExperienceIntake(post('/api/experiences/drafts',intent),f.env);assert.equal(response.status,200,await response.clone().text());
 const {plan}=await response.json();f.plan=plan;
 response=await handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash}),f.env);assert.equal(response.status,200,await response.clone().text());
 const execution={waitUntil(){throw Error('No background execution');}},path=`/api/experiences/drafts/${plan.draftId}/output`;
 f.send=(action,body)=>handleExperienceOutput(action?post(path+'/'+action,body):new Request('http://localhost'+path),f.env,execution,outputDocumentExecutionBridge);
 const ready=async body=>{const result=await f.send('prepare',body);assert.equal(result.status,200,await result.clone().text());return result.json();};
 f.ready=await ready({draftHash:plan.draftHash,explicitRequirementsConfirmation:true});assert.equal(f.ready.permitted.authorize,true);
 for(let i=0;i<renewals;i++){
  t.mock.timers.setTime(Date.parse(f.ready.sceneCostPreview.expiresAt)+1);
  const expired=await(await f.send()).json();assert.equal(expired.permitted.renewPreparation,true);
  f.ready=await ready({draftHash:plan.draftHash,explicitRequirementsConfirmation:true,renewal:{predecessorPreflightId:expired.preflight.id,explicitRenewal:true}});
 }
 f.body={draftHash:plan.draftHash,termsDigest:f.ready.preflight.termsDigest,maximumMicrousd:f.ready.preflight.maximumMicrousd,
  explicitAuthorization:true,sceneCostConsent:{...f.ready.sceneCostPreview,confirmed:true}};
 f.empty=()=>{for(const table of ['document_jobs','output_execution_grants','output_operation_slots','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);};
 const batch=f.DB.batch.bind(f.DB);f.proofs=0;f.reductions=0;
 f.DB.batch=async statements=>{
  if(statements[0]?.sql.includes('WITH source AS NOT MATERIALIZED')&&statements[0].sql.includes('COUNT(*) AS count'))f.reductions++;
  const last=statements.at(-1),proof=statements.length>0&&statements.every(q=>q.sql.startsWith('SELECT CASE WHEN ('))
   &&last.bindings.length===1&&last.bindings[0]===f.ready.sceneCostPreview.expiresAt;
  if(proof)f.proofs++;
  await f.beforeBatch?.(statements,proof);
  const result=await batch(statements);
  return f.afterBatch?await f.afterBatch(result,statements,proof):result;
 };
 return f;
}
export default { fixture };
