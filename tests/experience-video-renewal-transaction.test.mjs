import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {registerOutputSourceImports,outputTestDatabase} from './output-server-test-helpers.mjs';

// Actual intake/renewal/native confirmation/preflight/source readers and SQLite
// transactions. Synthetic local media only; no source/auth/SQL port replacement.
const imports=registerOutputSourceImports();
let forbidden=0;
const previousFetch=globalThis.fetch;
globalThis.fetch=()=>{forbidden++;throw Error('No network in unpaid Video renewal fixture');};
test.after(()=>{imports.deregister();globalThis.fetch=previousFetch;assert.equal(forbidden,0);});
const runtime=await import('../worker/runtime.ts');
const {handleExperienceIntake}=await import('../worker/experience-intake-api.ts');
const {handleExperienceOutput}=await import('../worker/experience-output-api.ts');
const {registeredExperience}=await import('../src/experiences/intake.ts');
const {preflightOutputVideoTarget}=await import('../worker/output-video-preflight.ts');
const {readVideoExecutionOffer}=await import('../src/model/output-video-offer.ts');
const execution={waitUntil(){forbidden++;throw Error('No background execution');}};
const owner='dev-local-creative',stream=`creative:${owner}`;
const financial=['output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'];
async function fixture(t){
  const s=outputTestDatabase();t.after(()=>s.sqlite.close());await runtime.ensureSchema(s.env);
  const now=new Date().toISOString();
  s.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(owner,'creative@local.forma','Local creative',now,now,now);
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');
  const sha=createHash('sha256').update(bytes).digest('hex'),key=`u-${Buffer.from(owner).toString('hex')}/still.png`,url='/api/media/'+key;
  await s.env.MEDIA.put(key,bytes,{customMetadata:{ownerId:owner,sha256:sha},httpMetadata:{contentType:'image/png'}});
  const properties={reference_id:'reference',source_content_hash:sha,media_url:url,media_type:'image/png',pixel_reference_mode:'preserve_style',weight:1,rights_class:'owned'};
  const events=[['ProjectCreated',{project_id:'source-project',name:'Source'}],['DocumentCreated',{project_id:'source-project',document_id:'source-document',title:'Source'}],
    ['BlockCreated',{project_id:'source-project',document_id:'source-document',block_id:'source-block',scope:'document',type:'reference',handle:'reference/still',position:'a0',properties}],
    ['ReferenceIngested',{reference_id:'reference',source_ref:url,content_hash:sha,rights_class:'owned'}],['RightsAsserted',{reference_id:'reference',rights_class:'owned'}]];
  await runtime.appendEvents(s.env,events.map(([type,payload])=>runtime.makeEvent(stream,0,`user:${owner}`,'test','source',type,payload)));
  const release=await registeredExperience('video');
  const intent={experienceId:'video',intentId:'00000000-0000-4000-8000-000000000092',releaseHash:release.releaseHash,
    values:{motion:{value:'Slow camera push. Keep the teapot stationary.',provenance:'authored'},frame:{value:'landscape',provenance:'authored'}},
    reference:{version:1,sourceProjectId:'source-project',sourceDocumentId:'source-document',sourceBlockId:'source-block',referenceId:'reference',sha256:sha,permissionAttestation:'i-own-or-have-permission'}};
  const post=(path,body)=>new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  let response=await handleExperienceIntake(post('/api/experiences/drafts',intent),s.env);
  assert.equal(response.status,200,await response.clone().text());s.plan=(await response.json()).plan;
  response=await handleExperienceIntake(post(`/api/experiences/drafts/${s.plan.draftId}/commit`,{draftHash:s.plan.draftHash}),s.env);
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');
  s.path=`/api/experiences/drafts/${s.plan.draftId}/output`;
  s.send=body=>handleExperienceOutput(body?post(s.path+'/prepare',body):new Request('http://localhost'+s.path),s.env,execution,s.bridge);
  const RealDate=Date,old=Date.now()-1_200_000;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[old]));}static now(){return old;}};
  try {response=await s.send({draftHash:s.plan.draftHash,explicitRequirementsConfirmation:true});assert.equal(response.status,200,await response.clone().text());}
  finally{globalThis.Date=RealDate;}
  s.expired=await (await s.send()).json();assert.equal(s.expired.permitted.renewPreparation,true);
  s.body={draftHash:s.plan.draftHash,explicitRequirementsConfirmation:true,renewal:{predecessorPreflightId:s.expired.preflight.id,explicitRenewal:true}};
  s.env.OPENAI_API_KEY='fixture-no-network';s.env.FAL_KEY='fixture-no-network';
  const forbiddenBridge=()=>{forbidden++;throw Error('Unpaid renewal cannot admit or execute');};
  s.bridge={preflight:preflightOutputVideoTarget,prepareAdmission:forbiddenBridge,dispatch:forbiddenBridge,resolveResult:forbiddenBridge,cleanupExpiredOrRevoked:forbiddenBridge};
  s.unpaid=()=>{for(const table of financial)assert.equal(s.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);assert.equal(s.media.size,1);};
  return s;
}

test('actual Video HTTP renewal preserves original intake and produces one fresh unpaid source-bound quote',async t=>{
  const s=await fixture(t),old=s.sqlite.prepare('SELECT * FROM output_commands ORDER BY command_key').all();
  const retained=s.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(s.plan.draftId);
  const before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  const response=await s.send(s.body);assert.equal(response.status,200,await response.clone().text());const renewed=await response.json();
  assert.equal(renewed.documentId,s.plan.documentId);assert.equal(renewed.draftId,s.plan.draftId);
  assert.notEqual(renewed.plan.revisionId,s.expired.plan.revisionId);assert.notEqual(renewed.preflight.id,s.expired.preflight.id);
  assert.equal(renewed.permitted.authorize,true);assert.equal(renewed.permitted.run,false);
  const offer=readVideoExecutionOffer(renewed.preflight.targets[0]);assert.ok(offer);
  assert.equal(offer.original.draftId,s.plan.draftId);assert.ok(Date.parse(offer.original.expiresAt)>Date.now());
  assert.deepEqual(s.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(s.plan.draftId),retained);
  for(const row of old)assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_commands WHERE command_key=?').get(row.command_key),row);
  const replay=await s.send(s.body);assert.equal(replay.status,200,await replay.clone().text());assert.equal((await replay.json()).preflight.id,renewed.preflight.id);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before+1);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,2);
  s.unpaid();
});

test('late Video authorization evidence without head change blocks renewal atomically',async t=>{
  const s=await fixture(t),batch=s.DB.batch.bind(s.DB);let raced=false;
  const before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  s.DB.batch=async statements=>{
    if(!raced&&statements.some(q=>/^INSERT INTO output_commands\b/u.test(q.sql.trim()))){raced=true;
      s.sqlite.prepare("INSERT INTO output_commands SELECT scope_key,actor_user_id,'late-video-authorize',request_digest,'authorize',event_id,created_at FROM output_commands WHERE action='confirm' LIMIT 1").run();}
    return batch(statements);
  };
  const response=await s.send(s.body);assert.equal(raced,true);assert.notEqual(response.status,200);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before);s.unpaid();
});

test('interrupted child preflight resumes the same Video confirmation without repeating Save',async t=>{
  const s=await fixture(t),preflight=s.bridge.preflight;let interrupted=false;
  const before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  s.bridge.preflight=async (...args)=>{if(!interrupted){interrupted=true;throw Error('Simulated interruption before preflight');}return preflight(...args);};
  const first=await s.send(s.body);assert.notEqual(first.status,200);assert.equal(interrupted,true);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before+1);
  const retry=await s.send(s.body);assert.equal(retry.status,200,await retry.clone().text());
  const ready=await retry.json();assert.equal(ready.permitted.authorize,true);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before+1);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='save'").get().n,1);s.unpaid();
});

test('concurrent Video renewal attempts converge on one confirmation and preflight',async t=>{
  const s=await fixture(t),before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  const attempts=await Promise.all([s.send(s.body),s.send(s.body)]);
  assert.ok(attempts.some(response=>response.status===200));
  const replay=await s.send(s.body);assert.equal(replay.status,200,await replay.clone().text());
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before+1);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE command_key LIKE 'video-cycle-v1:%' AND action='preflight'").get().n,1);s.unpaid();
});

test('longer browser wait cannot authorize an expired fresh Video quote',async t=>{
  const s=await fixture(t),prepared=await s.send(s.body);assert.equal(prepared.status,200,await prepared.clone().text());
  const fresh=await prepared.json(),RealDate=Date,future=Date.parse(fresh.preflight.expiresAt)+1;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[future]));}static now(){return future;}};
  try {
    const response=await handleExperienceOutput(new Request('http://localhost'+s.path+'/authorize',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({draftHash:s.plan.draftHash,termsDigest:fresh.preflight.termsDigest,maximumMicrousd:fresh.preflight.maximumMicrousd,explicitAuthorization:true})}),s.env,execution,s.bridge);
    assert.notEqual(response.status,200);s.unpaid();
  } finally {globalThis.Date=RealDate;}
});

test('actual Video fold tolerates operational events; same-value source edit emits only fixed log category',async t=>{
  const s=await fixture(t);
  await runtime.appendEvents(s.env,[
    ['ContextCompiled',{document_id:s.plan.documentId,context_hash:'synthetic-context',snapshot:{facts:[]}}],
    ['DocumentRenderRequested',{document_id:s.plan.documentId,artifact_id:'synthetic-job-artifact',artifact_kind:'video'}],
    ['DocumentRenderFailed',{document_id:s.plan.documentId,artifact_id:'synthetic-job-artifact',artifact_kind:'video',reason:'provider_submission_uncertain'}],
  ].map(([type,payload])=>runtime.makeEvent(stream,0,'worker:renderer','test','original-run-regression',type,payload)));
  const unchanged=await s.send();assert.equal(unchanged.status,200,await unchanged.clone().text());
  const block=s.plan.events.find(event=>event.type==='BlockCreated');assert.ok(block);
  await runtime.appendEvents(s.env,[runtime.makeEvent(stream,0,'user','test','same-value-edit','BlockPropertyEdited',{
    document_id:s.plan.documentId,project_id:s.plan.projectId,block_id:block.payload.block_id,
    property_path:'text',old_value:block.payload.properties.text,new_value:block.payload.properties.text,
  })]);
  const warnings=[],warn=console.warn;console.warn=(...args)=>warnings.push(args);
  let response;try{response=await s.send();}finally{console.warn=warn;}
  assert.equal(response.status,409);
  const body=await response.json();assert.equal(body.error,'experience_output_source_changed');
  assert.deepEqual(warnings.filter(args=>args[0]==='experience_output_source_mismatch'),[
    ['experience_output_source_mismatch',{category:'provenance'}],
  ]);
  assert.equal(JSON.stringify(body).includes('provenance'),false,'Category is log-only, not a new public field');
  s.unpaid();
});

for(const mutation of ['retention','source-private-body','rights-private-body','ingestion-private-body'])test(`late ${mutation} change fences Video renewal atomically`,async t=>{
  const s=await fixture(t),batch=s.DB.batch.bind(s.DB);let raced=false;
  const before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  s.DB.batch=async statements=>{
    if(!raced&&statements.some(q=>/^INSERT INTO output_commands\b/u.test(q.sql.trim()))){raced=true;
      if(mutation==='retention')s.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(new Date(Date.now()+60_000).toISOString(),s.plan.draftId);
      else {
        const type=mutation==='rights-private-body'?'RightsAsserted':mutation==='ingestion-private-body'?'ReferenceIngested':'BlockCreated';
        const rows=s.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.rights_class','restricted') WHERE private_event_id IN(SELECT event_id FROM events WHERE type=?)").run(type);
        assert.ok(rows.changes>0);
      }
    }
    return batch(statements);
  };
  const response=await s.send(s.body);assert.equal(raced,true);assert.notEqual(response.status,200);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before);s.unpaid();
});
