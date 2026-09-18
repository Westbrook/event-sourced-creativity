import assert from 'node:assert/strict';
import test from 'node:test';
import {outputTestDatabase} from './output-server-test-helpers.mjs';
import {readLocalMigrations} from '../scripts/lib/local-migrations.mjs';
import {ensureSchema} from '../worker/runtime.ts';
import {POLICY_VERSION} from '../worker/policy-version.ts';
import {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS} from '../worker/event-write-primitives.ts';
import {handleExperienceIntake} from '../worker/experience-intake-api.ts';
import {handleExperienceOutput} from '../worker/experience-output-api.ts';
import {registeredExperience,initialValues} from '../src/experiences/intake.ts';
import {outputDocumentExecutionBridge} from '../worker/output-document-execution.ts';
import {runDocumentJob} from '../worker/document-jobs-api.ts';
import {requireUser} from '../worker/pilot-policy.ts';

// Qualification only: actual intake, preparation, admission, Run, claim and
// execution code and its initial-source entry point. No network traffic or
// production data is permitted; the real bridge is not replaced.
for(const fault of [null,'admission','run','execution','missing-before-claim','changed-before-claim','large-history','malformed-recovery-row'])
test(`actual original Scene HTTP continuity: ${fault??'complete first-dispatch path'}`,async t=>{
  const f=outputTestDatabase(':memory:');t.after(()=>f.sqlite.close());
  const originalFetch=globalThis.fetch;let attemptedNetwork=0;
  globalThis.fetch=async()=>{attemptedNetwork++;throw new Error('scene_qualification_transport_stopped');};
  t.after(()=>{globalThis.fetch=originalFetch;});
  await ensureSchema(f.env);
  for(const migration of readLocalMigrations(new URL('../drizzle/',import.meta.url)).filter(x=>x.tag==='0038_scene_source_generations'))
    for(const sql of migration.sql.split('--> statement-breakpoint'))if(sql.trim())f.sqlite.exec(sql);
  const owner='dev-local-creative',now=new Date().toISOString();
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
    .run(owner,'qualification@invalid','Local qualification',POLICY_VERSION,now,now,now);
  if(fault==='large-history'){
    const statement=f.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${Array(17).fill('?').join(',')})`);
    f.sqlite.exec('BEGIN');try{for(let i=1;i<=5000;i++)statement.run(...eventWriteBindings(makeEvent('creative:'+owner,i,'user:'+owner,'fixture','earlier-activity','DocumentOpened',{document_id:'earlier-document',project_id:'earlier-project',padding:'x'.repeat(3500)})));f.sqlite.exec('COMMIT');}catch(e){f.sqlite.exec('ROLLBACK');throw e;}
  }
  f.env.OPENAI_API_KEY='qualification-not-a-provider-key';f.env.OPENAI_MODEL='gpt-5.6-terra';
  const realBatch=f.env.DB.batch;let injected=false;
  f.env.DB.batch=async statements=>{const results=await realBatch(statements);
    if(fault==='malformed-recovery-row'&&injected)statements.forEach((statement,index)=>{if(statement.sql.includes('SELECT 1 AS present FROM events stored'))results[index].results=[{}];});
    if(['admission','run','execution','malformed-recovery-row'].includes(fault)&&!injected){
      const retained=f.sqlite.prepare('SELECT scene_source_version_json FROM document_jobs WHERE scene_source_version_json IS NOT NULL LIMIT 1').get();
      if(retained&&JSON.parse(retained.scene_source_version_json).phase===(fault==='malformed-recovery-row'?'execution':fault)){injected=true;throw new Error('qualification_lost_ack');}
    }return results;};
  const post=(path,body)=>new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const release=await registeredExperience('scene'),intent={intentId:'00000000-0000-4000-8000-000000000093',experienceId:'scene',releaseHash:release.releaseHash,
    values:{...initialValues(release),...Object.fromEntries(Object.entries({characterA:'Mara',goalA:'Repair a bicycle',characterB:'Eli',goalB:'Keep a gift secret',location:'A bicycle workshop',secret:'The new wheel is a gift'}).map(([key,value])=>[key,{value,provenance:'authored'}]))}};
  const saved=await handleExperienceIntake(post('/api/experiences/drafts',intent),f.env);assert.equal(saved.status,200,await saved.clone().text());
  const {plan}=await saved.json();
  const committed=await handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash}),f.env);
  assert.equal(committed.status,200,await committed.clone().text());
  const bridge=outputDocumentExecutionBridge;
  const execution={waitUntil(){throw new Error('unexpected_background_work');}},path=`/api/experiences/drafts/${plan.draftId}/output`;
  const send=async(action,body)=>{const response=await handleExperienceOutput(post(path+'/'+action,body),f.env,execution,bridge);
    assert.equal(response.status,200,await response.clone().text());return response.json();};
  const prepared=await send('prepare',{draftHash:plan.draftHash,explicitRequirementsConfirmation:true});
  assert.equal(prepared.permitted.authorize,true);assert.ok(prepared.sceneCostPreview);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_jobs').get().n,0);
  const admitted=await send('authorize',{draftHash:plan.draftHash,termsDigest:prepared.preflight.termsDigest,maximumMicrousd:prepared.preflight.maximumMicrousd,
    explicitAuthorization:true,sceneCostConsent:{...prepared.sceneCostPreview,confirmed:true}});
  const admissionRow=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.ok(admissionRow);
  const admission=JSON.parse(admissionRow.scene_source_version_json);assert.equal(admission.phase,'admission');
  assert.equal(admitted.permitted.run,true);
  await send('run',{draftHash:plan.draftHash,grantId:admitted.original.grantId,explicitRun:true});
  const runRow=f.sqlite.prepare('SELECT * FROM document_jobs').get(),run=JSON.parse(runRow.scene_source_version_json);
  assert.equal(run.phase,'run');assert.deepEqual(run.predecessor,admission.successor);assert.equal(run.correlationId,runRow.job_id);
  assert.equal(attemptedNetwork,0);
  const auth=await requireUser(new Request('http://localhost/api/session'),f.env,'creator');assert.ok(auth.user);
  if(fault==='missing-before-claim'||fault==='changed-before-claim'){
    if(fault==='missing-before-claim')f.sqlite.prepare('UPDATE document_jobs SET scene_source_version_json=NULL').run();
    else f.sqlite.prepare('UPDATE event_private_payloads SET private_json=private_json WHERE private_event_id=(SELECT event_id FROM events LIMIT 1)').run();
    await assert.rejects(runDocumentJob(f.env,auth.user,runRow.job_id));
    assert.equal(attemptedNetwork,0);assert.equal(f.sqlite.prepare('SELECT attempt_count FROM document_jobs').get().attempt_count,0);return;
  }
  await runDocumentJob(f.env,auth.user,runRow.job_id);
  const after=f.sqlite.prepare('SELECT * FROM document_jobs').get(),receipt=JSON.parse(after.scene_source_version_json);
  if(fault==='malformed-recovery-row'){assert.equal(injected,true);assert.equal(attemptedNetwork,0);assert.equal(after.status,'failed');return;}
  assert.equal(after.attempt_count,1);assert.equal(receipt.correlationId,runRow.job_id+':attempt:1');
  assert.equal(receipt.phase,'execution',JSON.stringify({status:after.status,error:after.error_message,result:after.result_json}));
  assert.ok(receipt.successor.streamGeneration>run.successor.streamGeneration);
  assert.equal(attemptedNetwork,1,'one intercepted original dispatch; no actual provider transport or retry');
  if(['admission','run','execution'].includes(fault))assert.equal(injected,true,'requested lost-ACK boundary was actually exercised');
});
