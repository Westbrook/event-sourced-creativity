import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{ensureOutputRequirementsSchema},{canonicalJson,digest},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign},
  {stableAudioTemplate},policy]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/output-requirements-ledger.ts'),import('../src/experiences/compiler.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),
  import('../worker/experience-sponsor-approval.ts'),import('./sponsor-audio-server-native-fixture.mjs'),
  import('../worker/experience-sponsor-audio-output-policy.ts')]);
let approval;
const family='canonical-audio-output-read@1',actor='fixture-audio-output-actor',payer='fixture-audio-output-payer';
const actorTwo='fixture-audio-output-actor-two';
const operations=['audio-output-state','audio-output-prepare','audio-output-review','audio-output-authorize'];
const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const headers=userId=>({'oai-authenticated-user-id':userId,'oai-authenticated-user-email':`${userId}@example.invalid`});
const request=(body,userId=payer,signal)=>new Request('http://localhost/__fixture/audio-output-contracts',{
  method:'POST',headers:{...headers(userId),'content-type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})});
const readRequest=signal=>new Request('http://localhost/__fixture/audio-output-contracts',{headers:headers(actor),...(signal?{signal}:{})});
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Audio output contracts forbid all network/provider egress');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const approvalTables=['experience_sponsor_audio_output_read_policies','experience_sponsor_audio_output_read_approvals'];
const nativeTables=['events','event_private_payloads','private_content','output_commands','output_preflights','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations','experience_sponsor_grants','experience_sponsor_consumptions','output_provider_calls'];
const snapshotFields=['user_id','role','consent_version','updated_at','permission_epoch','grants_json','organizations_json','projects_json','identity_policies_json','approved_canvas_requirements','email','display_name','consented_at'];
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM "${table}"`).all().map(row=>({...row}));
const snapshot=f=>({schema:f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all().map(row=>({...row})),
  contents:Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({name})=>[name,rows(f,name).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]))});
function outputPolicy(now=1780000000000){
  const allowance={maximumRequestsPerWindow:40,maximumBytesPerWindow:40_000_000,maximumQueriesPerWindow:20_000,maximumRowsPerWindow:1_000_000};
  return {version:1,family,purpose:'native-output-continuation',startsAtMs:now-60000,expiresAtMs:now+3600000,windowMs:60000,
    operations:Object.fromEntries(operations.map(name=>[name,{maximumBytes:1_000_000,deadlineMs:30000,maximumQueries:1000,maximumRows:10000}])),
    actor:{...allowance},campaign:{...allowance}};
}
function noNativeWork(f){
  const installed=new Set(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
  for(const table of nativeTables)if(installed.has(table))assert.deepEqual(rows(f,table),f.originalNativeRows?.[table]??[],table);
  assert.equal(f.media.size,0);assert.equal(f.mediaAttempts,0);assert.equal(networkAttempts,0);
}
async function addProjectName(f,projectName){
  const stamp='2020-01-01T00:00:00.000Z';f.privateProjectName=typeof projectName==='string'?projectName:'Private payer project — 水 and music';
  f.sqlite.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES('output-test-org','Fixture organization',?,'active',?,?)").run(payer,stamp,stamp);
  f.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES('output-test-member','output-test-org',?,'owner','active',?,?,?,?)").run(payer,payer,stamp,stamp,stamp);
  f.sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES('output-test-access','output-test-project','output-test-org',?,'active',?,?)").run(payer,stamp,stamp);
  const {appendAuditEvent}=await import('../worker/runtime.ts');
  const event=await appendAuditEvent(f.env,`creative:${payer}`,'user','ProjectCreated',{project_id:'output-test-project',name:f.privateProjectName});
  const saved=rows(f,'events').find(row=>row.event_id===event.eventId);assert.ok(saved);
  f.sqlite.prepare('INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(event.eventId,'output-test-access','output-test-org','output-test-project',payer,saved.stream_id,saved.sequence,1,payer,saved.recorded_at);
  const body=rows(f,'event_private_payloads').find(row=>row.private_event_id===event.eventId);assert.ok(body);assert.ok(body.private_json.includes(f.privateProjectName));
  f.privateProjectEventId=event.eventId;
}
async function fixture(t,{strict=false,approved=false,projectName=false,configurePolicy,extraActor=false}={}){
  approval??=await import('../worker/experience-sponsor-audio-output-approval.ts');
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  f.mediaAttempts=0;t.after(()=>assert.equal(f.mediaAttempts,0));
  for(const method of ['get','head','put','delete','list'])f.env.MEDIA[method]=()=>{f.mediaAttempts++;throw Error('Audio output contracts forbid media IO');};
  // Genuine native account/session setup and original V8 approval. No fake
  // principal or detached approval metadata is used to authorize new rows.
  for(const userId of [actor,payer,...(extraActor?[actorTwo]:[])]){
    assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headers(userId)}),f.env)).status,200);
    f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,userId);
  }
  await ensureOutputRequirementsSchema(f.env);
  for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,
    policy.SPONSOR_AUDIO_OUTPUT_READ_POLICY_SCHEMA,approval.SPONSOR_AUDIO_OUTPUT_READ_APPROVAL_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  if(projectName)await addProjectName(f,projectName);
  const now=Number(f.sqlite.prepare(`SELECT ${clock} AS now`).get().now),template=await stableAudioTemplate();
  const allowance={maximumOperations:20,maximumTextBytes:1_000_000,maximumOperationsPerWindow:20,maximumTextBytesPerWindow:1_000_000,maximumPendingGrants:2,maximumInflightJobs:1};
  const generationResources={version:1,startsAtMs:now-60000,expiresAtMs:now+3600000,windowMs:60000,maximumOperationTextBytes:64000,actor:{...allowance},campaign:{...allowance}};
  const generationProposal={policy:{version:8,family:'canonical-instrumental-cue@1',mode:'candidate',campaignId:'fixture-audio-output-campaign',
    policyVersion:'audio-output-contract-fixture@1',payerUserId:payer,audience:'canonical-principal',startsAtMs:generationResources.startsAtMs,
    expiresAtMs:generationResources.expiresAtMs,maximumGrantLifetimeMs:900000,maximumAdmissions:2,maximumMicrousd:template.maximumMicrousd*2,
    maximumAdmissionsPerActor:2,windowMs:60000,maximumAdmissionsPerWindow:2,maximumAdmissionsPerActorWindow:2,templates:[template],resources:generationResources},
    eligibleActorUserIds:[actor,...(extraActor?[actorTwo]:[])],issuerUserIds:[actor,...(extraActor?[actorTwo]:[])]};
  const compiled=await compileSponsorApprovalProposal(generationProposal);
  f.originalCommand={action:'approve-sponsor-campaign',approvalId:'fixture-audio-output-original-approval',proposal:generationProposal,
    confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:compiled.termsDigest};
  f.original=await approveSponsorCampaign(request(f.originalCommand),f.env);assert.equal(f.original.policy.version,8);
  const snapshotJson=rows(f,'experience_sponsor_approvals')[0].payer_authority_json;assert.equal(JSON.parse(snapshotJson).length,13);
  const {PRINCIPAL_WITH_ACCESS_SQL}=await import('../worker/access-policy.ts'),principal=f.sqlite.prepare(PRINCIPAL_WITH_ACCESS_SQL).get(payer);
  assert.deepEqual(JSON.parse(snapshotJson),snapshotFields.map(key=>principal[key]??null));f.originalPayerSnapshot=snapshotJson;
  const installed=new Set(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
  f.originalNativeRows=Object.fromEntries(nativeTables.filter(table=>installed.has(table)).map(table=>[table,rows(f,table)]));
  f.now=now;f.policy=outputPolicy(now);configurePolicy?.(f.policy);f.campaignId=f.original.policy.campaignId;
  f.proposal={version:1,family,campaignId:f.campaignId,sponsorPolicyDigest:f.original.policyDigest,readPolicy:f.policy};
  f.review=(proposal=f.proposal,userId=payer)=>approval.prepareSponsorAudioOutputReadApproval(request({action:'prepare-sponsor-audio-output-read-policy',proposal},userId),f.env);
  f.approve=async()=>{f.reviewed=await f.review();f.command={action:'approve-sponsor-audio-output-read-policy',approvalId:'fixture-audio-output-read-approval',
    proposal:f.proposal,reviewedTermsDigest:f.reviewed.termsDigest,confirmation:'APPROVE_SPONSOR_AUDIO_OUTPUT_READ_POLICY'};
    f.approved=await approval.approveSponsorAudioOutputReadPolicy(request(f.command),f.env);return f.approved;};
  f.read=()=>approval.readApprovedSponsorAudioOutputReadPolicy(readRequest(),f.env,f.campaignId,f.original.policyDigest);
  if(strict){f.limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>f.limits.restore());}
  if(approved)await f.approve();noNativeWork(f);return f;
}
async function unchanged(f,operation){const before=snapshot(f),result=await operation();assert.deepEqual(snapshot(f),before);return result;}
async function denied(f,operation){const before=snapshot(f);await assert.rejects(operation);assert.deepEqual(snapshot(f),before);}
function onlyApprovalRowsChanged(f,before){const after=snapshot(f);assert.deepEqual(after.schema,before.schema);
  for(const [table,value]of Object.entries(before.contents))if(!approvalTables.includes(table))assert.deepEqual(after.contents[table],value,table);
}
function verifyAssertions(f,value){for(const assertion of value.assertions)assert.equal(Number(f.sqlite.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).get(...assertion.bindings).current),1);}

// This independently versioned family allocates only finite native output IO.
// Its DTO and retained provenance are not a principal, native quote or grant.
test('Audio output policy has exact finite operations, immutable capture and stable digest',async()=>{
  const raw=outputPolicy(),value=policy.readSponsorAudioOutputReadPolicy(raw);
  assert.deepEqual([...policy.SPONSOR_AUDIO_OUTPUT_READ_OPERATIONS],operations);assert.deepEqual(value,raw);
  assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.actor));assert.ok(Object.isFrozen(value.operations));assert.ok(operations.every(name=>Object.isFrozen(value.operations[name])));
  raw.operations[operations[0]].maximumBytes=1;raw.actor.maximumRequestsPerWindow=1;
  assert.equal(value.operations[operations[0]].maximumBytes,1_000_000);assert.equal(value.actor.maximumRequestsPerWindow,40);
  const reordered=Object.fromEntries(Object.entries(outputPolicy()).reverse());assert.equal(await digest(value),await digest(policy.readSponsorAudioOutputReadPolicy(reordered)));
  for(const mutate of [p=>p.expiresAtMs++,p=>p.actor.maximumBytesPerWindow--,p=>p.operations['audio-output-review'].maximumRows--]){
    const changed=outputPolicy();mutate(changed);assert.notEqual(await digest(value),await digest(policy.readSponsorAudioOutputReadPolicy(changed)));
  }
});
const invalidPolicies={
  'foreign family':p=>p.family='canonical-audio-initial-intake@1','generation purpose':p=>p.purpose='generation','foreign version':p=>p.version=8,
  'implicit missing field':p=>delete p.actor.maximumQueriesPerWindow,'extra permission':p=>p.allowProvider=true,
  'missing operation':p=>delete p.operations['audio-output-authorize'],'extra Run operation':p=>p.operations['audio-run']={...p.operations['audio-output-state']},
  'private body payload':p=>p.operations['audio-output-review'].content='creative material','reversed lifetime':p=>p.expiresAtMs=p.startsAtMs,
  'negative start':p=>p.startsAtMs=-1,'overflow date':p=>p.expiresAtMs=8_000_000_000_001,'zero window':p=>p.windowMs=0,
  'fractional window':p=>p.windowMs=1.5,'oversized window':p=>p.windowMs=31_536_000_001,
  'unbounded bytes':p=>p.actor.maximumBytesPerWindow=Infinity,'NaN rows':p=>p.campaign.maximumRowsPerWindow=NaN,
  'actor request overflow':p=>p.actor.maximumRequestsPerWindow=p.campaign.maximumRequestsPerWindow+1,
  'actor byte overflow':p=>p.actor.maximumBytesPerWindow=p.campaign.maximumBytesPerWindow+1,
  'actor query overflow':p=>p.actor.maximumQueriesPerWindow=p.campaign.maximumQueriesPerWindow+1,
  'actor row overflow':p=>p.actor.maximumRowsPerWindow=p.campaign.maximumRowsPerWindow+1,
  'zero requests':p=>p.actor.maximumRequestsPerWindow=0,'zero operation bytes':p=>p.operations['audio-output-state'].maximumBytes=0,
  'operation above actor bytes':p=>p.operations['audio-output-prepare'].maximumBytes=p.actor.maximumBytesPerWindow+1,
  'operation above actor queries':p=>p.operations['audio-output-review'].maximumQueries=p.actor.maximumQueriesPerWindow+1,
  'operation above actor rows':p=>p.operations['audio-output-authorize'].maximumRows=p.actor.maximumRowsPerWindow+1,
  'deadline above ceiling':p=>p.operations['audio-output-review'].deadlineMs=30001,
  'deadline above lifetime':p=>p.expiresAtMs=p.startsAtMs+29999,
};
for(const [name,mutate]of Object.entries(invalidPolicies))test(`Audio output policy refuses ${name}`,()=>{
  const invalid=outputPolicy();mutate(invalid);assert.throws(()=>policy.readSponsorAudioOutputReadPolicy(invalid));
});
test('Audio output policy rejects active object behavior without invoking accessors',()=>{
  let invoked=0;const raw=outputPolicy();Object.defineProperty(raw.operations['audio-output-review'],'maximumRows',{enumerable:true,get(){invoked++;return 1;}});
  assert.throws(()=>policy.readSponsorAudioOutputReadPolicy(raw));assert.equal(invoked,0);
  const inherited=Object.assign(Object.create({hiddenPermission:true}),outputPolicy());assert.throws(()=>policy.readSponsorAudioOutputReadPolicy(inherited));
  const cyclic=outputPolicy();cyclic.actor.self=cyclic;assert.throws(()=>policy.readSponsorAudioOutputReadPolicy(cyclic));
  const symbol=outputPolicy();symbol[Symbol('permission')]=true;assert.throws(()=>policy.readSponsorAudioOutputReadPolicy(symbol));
});

test('Audio output approval uses the original V8 payer and preserves exact private-control replay under strict SQL limits',async t=>{
  const f=await fixture(t,{strict:true,projectName:true}),before=snapshot(f),review=await unchanged(f,()=>f.review());
  assert.equal(review.terms.payerUserId,payer);assert.equal(review.terms.originalApprovalId,f.originalCommand.approvalId);
  assert.equal(review.terms.originalTermsDigest,f.originalCommand.reviewedTermsDigest);assert.deepEqual(review.terms.proposal,f.proposal);
  assert.equal(review.readPolicyDigest,await digest(f.policy));assert.ok(f.originalPayerSnapshot.includes(f.privateProjectName));
  assert.equal(JSON.stringify(review).includes(f.privateProjectName),false);await f.approve();assert.equal(f.approved.replayed,false);
  assert.equal(JSON.stringify(f.approved).includes(f.privateProjectName),false);
  const savedReceipt=JSON.parse(rows(f,'experience_sponsor_audio_output_read_approvals')[0].review_receipt_json);
  assert.equal(savedReceipt.payerAuthorityJson,f.originalPayerSnapshot);assert.equal(await digest(savedReceipt),f.approved.reviewReceiptDigest);
  onlyApprovalRowsChanged(f,before);for(const table of approvalTables)assert.equal(rows(f,table).length,1);
  const replay=await unchanged(f,()=>approval.approveSponsorAudioOutputReadPolicy(request(f.command),f.env));
  assert.deepEqual({...replay,replayed:false},f.approved);assert.equal(replay.replayed,true);
  const retained=await unchanged(f,()=>f.read());assert.deepEqual(retained.policy,f.policy);assert.equal(retained.payerUserId,payer);
  assert.equal(retained.originalApprovalId,f.originalCommand.approvalId);assert.equal(retained.approvalId,f.command.approvalId);
  assert.equal(retained.readPolicyDigest,f.approved.readPolicyDigest);assert.equal(retained.reviewReceiptDigest,f.approved.reviewReceiptDigest);
  for(const key of ['controlBytes','controlQueries','controlRows'])assert.ok(retained[key]>0,key);verifyAssertions(f,retained);noNativeWork(f);f.limits.assertVerified();
  t.diagnostic(JSON.stringify({qualifiedQueries:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts),maxSqlBytes:Math.max(...f.limits.records.map(row=>row.statementBytes)),networkAttempts}));
});

test('Audio output approval refuses actor authority, unreviewed terms and incompatible retained identity',async t=>{
  const f=await fixture(t);await denied(f,()=>f.review(f.proposal,actor));await f.approve();
  for(const mutate of [c=>c.confirmation='APPROVE_SPONSOR_CAMPAIGN',c=>c.reviewedTermsDigest=`sha256:${'0'.repeat(64)}`,
    c=>c.approvalId='foreign-approval',c=>c.proposal.readPolicy.operations['audio-output-review'].maximumRows--,
    c=>c.proposal.sponsorPolicyDigest=`sha256:${'1'.repeat(64)}`,c=>c.proposal.payerUserId=actor,c=>c.proof={sql:'1',bindings:[]}]){
    const input=structuredClone(f.command);mutate(input);await denied(f,()=>approval.approveSponsorAudioOutputReadPolicy(request(input),f.env));
  }
  noNativeWork(f);
});

test('Audio output approval retains historical read terms after original generation revocation without fresh provision authority',async t=>{
  const f=await fixture(t,{approved:true});f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms').run();
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0').run();f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);
  const retained=await unchanged(f,()=>f.read());assert.deepEqual(retained.policy,f.policy);assert.equal(retained.payerUserId,payer);verifyAssertions(f,retained);
  await denied(f,()=>f.review());await denied(f,()=>approval.approveSponsorAudioOutputReadPolicy(request(f.command),f.env));noNativeWork(f);
});

for(const damage of ['missing trigger','extra index','partial approval family'])test(`Audio output approval refuses ${damage} without installing or repairing schema`,async t=>{
  const f=await fixture(t);
  if(damage==='missing trigger')f.sqlite.exec('DROP TRIGGER experience_sponsor_audio_output_read_policies_no_update');
  else if(damage==='extra index')f.sqlite.exec('CREATE INDEX fixture_extra_read_policy ON experience_sponsor_audio_output_read_policies(read_policy_digest)');
  else f.sqlite.exec('DROP TABLE experience_sponsor_audio_output_read_approvals');
  await denied(f,()=>f.review());noNativeWork(f);
});

test('Audio output approval atomically refuses a closing original-payer change after both native rows were written',async t=>{
  const f=await fixture(t);await f.review();let mutations=0,changedRows=0;
  // Observe actual execution inside the native batch transaction; keep the
  // assertion sink and both immutable approval families byte-for-byte intact.
  const restore=observeDatabase(f,sql=>{
    if(sql.includes('INSERT INTO main.experience_sponsor_audio_output_read_approvals')){
      const changed=f.sqlite.prepare('UPDATE users SET display_name=? WHERE user_id=?').run('changed-inside-transaction',payer);
      changedRows+=Number(changed.changes);mutations++;
    }
  });
  const before=snapshot(f);try{await assert.rejects(f.approve());}finally{restore();}
  assert.equal(mutations,1);assert.equal(changedRows,1);assert.deepEqual(snapshot(f),before);noNativeWork(f);
});

for(const ack of ['lost','sparse','contradictory'])test(`Audio output approval ${ack} acknowledgement recovers one immutable original pair`,async t=>{
  const f=await fixture(t),batch=f.env.DB.batch;let reached=0;
  f.env.DB.batch=async statements=>{const result=await batch.call(f.env.DB,statements);
    if(!reached&&statements.some(row=>row.sql.includes('INSERT INTO main.experience_sponsor_audio_output_read_approvals'))){reached++;
      if(ack==='lost')throw Error('fixture lost committed Audio output approval acknowledgement');
      if(ack==='sparse'){const sparse=[...result];delete sparse[0];return sparse;}
      return result.map((row,index)=>index?row:{...row,error:'contradictory native acknowledgement'});
    }return result;};
  try{await f.approve();}finally{f.env.DB.batch=batch;}assert.equal(reached,1);assert.equal(f.approved.replayed,true);
  for(const table of approvalTables)assert.equal(rows(f,table).length,1);verifyAssertions(f,await unchanged(f,()=>f.read()));noNativeWork(f);
});

function observeDatabase(f,observe){
  const prepare=f.DB.prepare;
  f.DB.prepare=function(sql){const wrap=statement=>{const bind=statement.bind,execute=statement.execute;
    statement.bind=function(...bindings){return wrap(bind.apply(this,bindings));};
    statement.execute=function(kind){const value=execute.call(this,kind);observe(sql,this.bindings,value,kind);return value;};return statement;};return wrap(prepare.call(this,sql));};
  return()=>{f.DB.prepare=prepare;};
}
// Match the actual bounded capture, not the final CASE/EXISTS proof. Native
// SQL runs inside the output envelope and one parameter-packer binding.
function principalCapture(sql,bindings){
  return sql.includes('AS value FROM (WITH native AS MATERIALIZED (')
    &&sql.includes(`SELECT ${snapshotFields.map(field=>`native.${field}`).join(',')} FROM native WHERE`)
    &&bindings.length===1&&JSON.parse(bindings[0]).includes(payer);
}
for(const field of ['role','updated_at','consented_at','permission'])test(`Audio output approval refuses changed-and-restored native payer ${field}`,async t=>{
  const f=await fixture(t),before=snapshot(f),original=field==='permission'?null:f.sqlite.prepare(`SELECT ${field} AS value FROM users WHERE user_id=?`).get(payer).value;
  let reads=0;const restore=observeDatabase(f,(sql,bindings)=>{
    if(!principalCapture(sql,bindings))return;reads++;
    if(reads===1){
      if(field==='permission')f.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,status,granted_by_user_id,created_at,updated_at) VALUES('output-temporary-grant',?,'self.usage.read','self','active',?,'2099-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')").run(payer,payer);
      else f.sqlite.prepare(`UPDATE users SET ${field}=? WHERE user_id=?`).run(field==='role'?'admin':'2099-01-01T00:00:00.000Z',payer);
    }else if(reads===2){
      if(field==='permission')f.sqlite.prepare("DELETE FROM capability_grants WHERE grant_id='output-temporary-grant'").run();
      else f.sqlite.prepare(`UPDATE users SET ${field}=? WHERE user_id=?`).run(original,payer);
    }
  });try{await assert.rejects(f.review(),/principal_changed/u);}finally{restore();}
  assert.equal(reads,2,'both genuine bounded principal snapshots were observed');assert.deepEqual(snapshot(f),before);noNativeWork(f);
});

for(const field of ['display_name','private project name'])test(`Audio output approval SQL gates oversized ${field} before native result transfer`,async t=>{
  const f=await fixture(t,{projectName:field==='private project name'}),oversized=field==='display_name'?'界'.repeat(1366):'界'.repeat(44000);
  if(field==='display_name')f.sqlite.prepare('UPDATE users SET display_name=? WHERE user_id=?').run(oversized,payer);
  else {
    f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify({project_id:'output-test-project',name:oversized}),f.privateProjectEventId);
    // The adverse body is fixture input; production must preserve that exact input.
    f.originalNativeRows.event_private_payloads=rows(f,'event_private_payloads');
  }
  const principalAcks=[],nativeAcks=[],restore=observeDatabase(f,(sql,bindings,result)=>{
    nativeAcks.push(result);if(principalCapture(sql,bindings))principalAcks.push(result);
  });try{await denied(f,()=>f.review());}finally{restore();}
  assert.equal(principalAcks.length,1);assert.equal(principalAcks[0].results.length,1);
  assert.equal(principalAcks[0].results[0].count,0);assert.deepEqual(JSON.parse(principalAcks[0].results[0].body),[]);
  assert.equal(nativeAcks.some(value=>JSON.stringify(value).includes(oversized)),false);noNativeWork(f);
});

function corruptOriginalSnapshot(f,value){
  const sql='UPDATE experience_sponsor_approvals SET payer_authority_json=? WHERE approval_id=?';
  assert.throws(()=>f.sqlite.prepare(sql).run(value,f.originalCommand.approvalId),/immutable/u);
  const triggers=f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='experience_sponsor_approvals'").all();
  // Explicit malformed retained-row fixture after genuine native approvals.
  // Restore every original guard before testing production provenance reads.
  for(const trigger of triggers)f.sqlite.exec(`DROP TRIGGER "${trigger.name}"`);
  try{f.sqlite.prepare(sql).run(value,f.originalCommand.approvalId);}finally{for(const trigger of triggers)f.sqlite.exec(trigger.sql);}
}
for(const fault of ['twelve fields','fourteen fields','non-array nested authority','foreign payer','noncanonical spacing','oversized snapshot'])test(`Audio output retained approval refuses original ${fault}`,async t=>{
  const f=await fixture(t,{approved:true}),original=JSON.parse(f.originalPayerSnapshot);let value;
  if(fault==='twelve fields')value=JSON.stringify(original.slice(0,12));
  else if(fault==='fourteen fields')value=JSON.stringify([...original,'extra']);
  else if(fault==='non-array nested authority'){original[7]='{}';value=JSON.stringify(original);}
  else if(fault==='foreign payer'){original[0]=actor;value=JSON.stringify(original);}
  else if(fault==='noncanonical spacing')value=JSON.stringify(original,null,2);
  else value='["'+'界'.repeat(44000)+'"]';
  corruptOriginalSnapshot(f,value);let returned=false;
  const restore=observeDatabase(f,(sql,bindings,result)=>{if(JSON.stringify(result).includes('界'.repeat(44000)))returned=true;});
  try{await denied(f,()=>f.read());}finally{restore();}
  if(fault==='oversized snapshot')assert.equal(returned,false,'BLOB byte gate withholds oversized stored authority before transfer');
});

test('Audio output read control counters include each actual query, batch statement and returned row',async t=>{
  const f=await fixture(t),bound=approval.createSponsorAudioOutputReadBoundary(readRequest(),f.env),before=snapshot(f);
  await bound.query('SELECT 1 AS value UNION ALL SELECT 2 AS value',[],['value'],2);
  assert.equal(bound.controlQueries,1);assert.equal(bound.controlRows,2);const firstBytes=bound.controlBytes;assert.ok(firstBytes>0);
  await bound.query('SELECT 3 AS value',[],['value']);
  assert.equal(bound.controlQueries,2);assert.equal(bound.controlRows,3);assert.ok(bound.controlBytes>firstBytes);
  await assert.rejects(()=>bound.batch([f.env.DB.prepare('SELECT 4 AS value')]),/control_invalid/u);
  assert.equal(bound.controlQueries,2);assert.equal(bound.controlRows,3);
  const statements=bound.assertions([{sql:'1',bindings:[]},{sql:'2 > 1',bindings:[]}]);
  assert.equal(statements.length,4,'each native assertion inserts then deletes its assertion sink');
  await bound.batch(statements);
  assert.equal(bound.controlQueries,6);assert.equal(bound.controlRows,7);assert.deepEqual(snapshot(f),before);noNativeWork(f);
});


for(const fault of ['nullable check','missing check','masking trigger'])test(`Audio output approval refuses malformed assertion sink ${fault}`,async t=>{
  const f=await fixture(t);
  if(fault==='masking trigger')f.sqlite.exec("CREATE TRIGGER fixture_mask_assertion BEFORE INSERT ON output_atomic_assertions BEGIN SELECT RAISE(IGNORE); END");
  else {f.sqlite.exec('DROP TABLE output_atomic_assertions');f.sqlite.exec(fault==='nullable check'
    ?'CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER CHECK(passed=1))'
    :'CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL)');}
  await denied(f,()=>f.review());await denied(f,()=>f.approve());noNativeWork(f);
});
for(const predicate of ['0','NULL'])test(`Audio output read boundary preserves false ${predicate} assertion rollback`,async t=>{
  const f=await fixture(t),bound=approval.createSponsorAudioOutputReadBoundary(readRequest(),f.env),before=snapshot(f);
  await assert.rejects(()=>bound.batch(bound.assertions([{sql:'1',bindings:[]},{sql:predicate,bindings:[]}])));
  assert.deepEqual(snapshot(f),before);noNativeWork(f);
});
for(const field of ['capabilities','streamId','fictional','billingUserId','projectExecution'])test(`Audio output principal refuses post-return ${field} mutation`,async t=>{
  const f=await fixture(t),bound=await approval.readSponsorAudioOutputPrincipal(readRequest(),f.env),before=snapshot(f);
  assert.equal(bound.principal.userId,actor);bound.assertCurrent();
  if(field==='capabilities'){assert.ok(Array.isArray(bound.principal.access.capabilities));bound.principal.access.capabilities=['foreign-permission'];}
  else bound.principal[field]=field==='fictional'?true:field==='projectExecution'?{}:'foreign-identity';
  assert.throws(()=>bound.assertCurrent(),/principal_changed/u);assert.deepEqual(snapshot(f),before);noNativeWork(f);
});


// A's immutable paired original receipt is produced by its actual storage writer.
// The native draft grammar supplies every digest/byte count. No private draft,
// context event, output SAVE, provider call, monetary hold or media is persisted.
async function originalIntake(f,actorUserId=actor){
  const [initialPolicy,initialApproval,storage,intake,{sponsorPrincipalDigest}]=await Promise.all([
    import('../worker/experience-sponsor-audio-intake-policy.ts'),import('../worker/experience-sponsor-audio-intake-approval.ts'),
    import('../worker/experience-sponsor-audio-intake-resources.ts'),import('../src/experiences/intake.ts'),
    import('../worker/experience-sponsor-admission.ts')]);
  if(!f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='experience_sponsor_audio_intake_policies'").get())
  for(const schema of [initialPolicy.SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA,initialApproval.SPONSOR_AUDIO_INTAKE_APPROVAL_SCHEMA,storage.SPONSOR_AUDIO_INTAKE_STORAGE_SCHEMA])
    for(const sql of schema)f.sqlite.exec(sql);
  const familyA='canonical-audio-initial-intake@1';
  const allowance={maximumOperations:4,maximumBytes:1_000_000,maximumOperationsPerWindow:4,maximumBytesPerWindow:1_000_000};
  const io={maximumRequestsPerWindow:20,maximumBytesPerWindow:20_000_000};
  const intakePolicy={version:1,family:familyA,purpose:'initial-context',storage:{startsAtMs:f.now-60000,expiresAtMs:f.now+3600000,windowMs:60000,
    maximumDraftBytes:65536,maximumEventBytes:65536,maximumOriginalBytes:131072,actor:{...allowance},campaign:{...allowance}},
    io:{windowMs:60000,operations:Object.fromEntries(['audio-intake-prepare','audio-intake-commit','audio-intake-draft','audio-intake-receipt'].map(name=>[name,{maximumBytes:1_000_000,deadlineMs:30000}])),actor:{...io},campaign:{...io}}};
  const proposal={version:1,family:familyA,campaignId:f.campaignId,sponsorPolicyDigest:f.original.policyDigest,intakePolicy};
  const review=await initialApproval.prepareSponsorAudioIntakeApproval(request({action:'prepare-sponsor-audio-intake-policy',proposal}),f.env);
  const approved=await initialApproval.approveSponsorAudioIntakePolicy(request({action:'approve-sponsor-audio-intake-policy',
    approvalId:'fixture-audio-output-intake-approval',proposal,confirmation:'APPROVE_SPONSOR_AUDIO_INTAKE_POLICY',reviewedTermsDigest:review.termsDigest}),f.env);
  const release=await intake.registeredExperience('audio'),values=intake.initialValues(release),intentId=randomUUID();
  values.direction={value:'A quiet original instrumental cue — 水',provenance:'authored'};
  const valid=await intake.validateIntakeRequest({experienceId:'audio',intentId,releaseHash:release.releaseHash,values});assert.ok(valid);
  const ordinary=await intake.buildExperiencePlan(actorUserId,valid.request,valid.release),receiptId=`sponsor-audio-intake-${(await digest([f.campaignId,actorUserId,intentId])).slice(7)}`;
  const {draftHash:discarded,...base}=ordinary;assert.ok(discarded);
  const marked={...base,sponsor_intake:{version:1,family:familyA,receiptId}},plan={...JSON.parse(canonicalJson(marked)),draftHash:await digest(marked)};
  const content=canonicalJson(plan),payloads=plan.events.map(event=>JSON.stringify(event.payload)),draftBytes=Buffer.byteLength(content),eventBytes=payloads.reduce((total,payload)=>total+Buffer.byteLength(payload),0);
  const actorRequest=new Request('http://localhost/__fixture/audio-output-original',{headers:headers(actorUserId)});
  const native=await approval.readSponsorAudioOutputPrincipal(actorRequest,f.env),sessionDigest=await sponsorPrincipalDigest(native.principal);
  assert.equal(native.principal.userId,actorUserId);native.assertCurrent();
  const input={policy:intakePolicy,receiptId,allocationId:`allocation-${intentId}`,campaignId:f.campaignId,sponsorPolicyDigest:f.original.policyDigest,
    intakePolicyDigest:await digest(intakePolicy),intakeApprovalId:approved.approvalId,actorUserId,sessionDigest,nativeIntentId:intentId,
    draftId:plan.draftId,projectId:plan.projectId,documentId:plan.documentId,draftHash:plan.draftHash,
    bodyDigest:await digest({action:'prepare-sponsored-audio-draft',campaignId:f.campaignId,request:valid.request}),contentDigest:await digest(content),
    sourceDigest:await digest(plan.events),eventPayloadDigest:await digest(payloads),eventCount:plan.events.length,draftBytes,eventBytes,totalBytes:draftBytes+eventBytes,
    expiresAt:new Date(f.now+900000).toISOString()};
  const prepared=await storage.prepareSponsorAudioIntakeStorage(input);
  await f.env.DB.batch(prepared.statements.map(({sql,bindings})=>f.env.DB.prepare(sql).bind(...bindings)));
  const stored=await storage.readStoredSponsorAudioIntake(actorRequest,f.env,{draftId:plan.draftId,actorUserId});
  assert.equal(stored.receipt.sessionDigest,sessionDigest);assert.equal(stored.receipt.eventCount,5);noNativeWork(f);
  return {plan,input,receipt:stored.receipt,initialApproval:approved};
}

let attempts;
const attemptTable='experience_sponsor_audio_output_read_attempts';
const operationPaths={
  'audio-output-state':draftId=>['GET',`/api/experiences/drafts/${draftId}/output`],
  'audio-output-prepare':draftId=>['POST',`/api/experiences/drafts/${draftId}/output/prepare`],
  'audio-output-review':draftId=>['GET',`/api/experiences/sponsor/audio/drafts/${draftId}/review`],
  'audio-output-authorize':draftId=>['POST',`/api/experiences/drafts/${draftId}/output/authorize`],
};
function outputRequest(draftId,operation='audio-output-state',{userId=actor,signal,suffix='',method}={}){
  const [nativeMethod,path]=operationPaths[operation](draftId),selectedMethod=method??nativeMethod;
  return new Request(`http://localhost${path}${suffix}`,{method:selectedMethod,headers:headers(userId),...(signal?{signal}:{}),
    ...(['POST','PUT'].includes(selectedMethod)?{body:'{}'}:{})});
}
function nativeAttemptMutationAcknowledgements(f){
  const columns='attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,actor_user_id,session_digest,draft_id,operation,maximum_bytes,maximum_queries,maximum_rows,admitted_at_ms,deadline_at_ms,charged_through_ms';
  const prefix=`WITH sponsor_intake_parameters AS (SELECT ? AS json) INSERT INTO main.${attemptTable}(${columns})\n      SELECT `;
  const prepare=f.DB.prepare;f.nativeAckCorrections=[];
  // The unchanged shared test adapter dispatches every WITH through .all(),
  // whose metadata hardcodes zero changes. This sole packed INSERT still runs
  // unchanged in actual SQLite; recover its actual immediate changes() value.
  // Never synthesize success or broaden production acknowledgement acceptance.
  f.DB.prepare=function(sql){const wrap=statement=>{const bind=statement.bind,execute=statement.execute;
    statement.bind=function(...bindings){return wrap(bind.apply(this,bindings));};
    statement.execute=function(kind){
      const value=execute.call(this,kind);
      if(kind==='all'&&sql.startsWith(prefix)){
        const changes=Number(f.sqlite.prepare('SELECT changes() AS changes').get().changes);
        f.nativeAckCorrections.push({before:value.meta.changes,actualChanges:changes});
        return {...value,meta:{...value.meta,changes}};
      }
      return value;
    };return statement;};return wrap(prepare.call(this,sql));};
}
async function attemptFixture(t,options={}){
  attempts??=await import('../worker/experience-sponsor-audio-output-attempts.ts');
  const f=await fixture(t,{...options,strict:false,approved:true});f.intake=await originalIntake(f);
  for(const sql of attempts.SPONSOR_AUDIO_OUTPUT_READ_ATTEMPTS_SCHEMA)f.sqlite.exec(sql);
  nativeAttemptMutationAcknowledgements(f);
  if(options.strict){f.limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>f.limits.restore());}
  f.makeRequest=(operation='audio-output-state',extra)=>outputRequest(f.intake.plan.draftId,operation,extra);
  f.reserve=(req,operation='audio-output-state')=>attempts.reserveSponsorAudioOutputReadAttempt(req,f.env,{operation,draftId:f.intake.plan.draftId});
  return f;
}

for(const operation of operations)test(`Audio output attempt genuine ${operation} reserves and consumes one finite metadata budget`,async t=>{
  const f=await attemptFixture(t,{strict:operation==='audio-output-state'}),req=f.makeRequest(operation),before=snapshot(f);
  const attempt=await f.reserve(req,operation);assert.ok(Object.isFrozen(attempt));assert.equal(req.bodyUsed,false);
  assert.equal(rows(f,attemptTable).length,1);assert.deepEqual(f.nativeAckCorrections,[{before:0,actualChanges:1}]);const charged=rows(f,attemptTable)[0];
  const budget=await attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env);
  assert.ok(Object.isFrozen(budget));assert.equal(req.bodyUsed,false);
  const view=await attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env);
  assert.equal(view.operation,operation);assert.equal(view.principal.userId,actor);
  assert.equal(view.draftId,f.intake.plan.draftId);assert.deepEqual(view.original,f.intake.receipt);assert.deepEqual(view.policy,f.policy);
  assert.deepEqual({...view.receipt},charged);assert.equal(charged.session_digest,f.intake.input.sessionDigest);
  for(const [column,key]of [['maximum_bytes','maximumBytes'],['maximum_queries','maximumQueries'],['maximum_rows','maximumRows']])
    assert.equal(charged[column],f.policy.operations[operation][key]);
  assert.equal(charged.charged_through_ms,charged.deadline_at_ms+f.policy.windowMs);
  const remaining=view.remaining();
  for(const key of ['bytes','queries','rows'])assert.ok(remaining[key]>0&&Number.isSafeInteger(remaining[key]),key);
  view.account({bytes:31,queries:2,rows:3});const later=view.remaining();
  assert.deepEqual(later,{bytes:remaining.bytes-31,queries:remaining.queries-2,rows:remaining.rows-3});
  assert.deepEqual(rows(f,attemptTable),[charged],'later IO consumes the reserved finite budget without refund or fresh purchase');
  await assert.rejects(()=>attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env));
  await attempts.retireSponsorAudioOutputReadBudget(budget,req,f.env);
  await assert.rejects(async()=>attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env));
  const after=snapshot(f);assert.deepEqual(after.schema,before.schema);
  for(const [table,value]of Object.entries(before.contents))if(table!==attemptTable)assert.deepEqual(after.contents[table],value,table);
  noNativeWork(f);f.limits?.assertVerified();
  if(f.limits)t.diagnostic(JSON.stringify({qualifiedQueries:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts),maxSqlBytes:Math.max(...f.limits.records.map(row=>row.statementBytes)),networkAttempts,mediaAttempts:f.mediaAttempts}));
});

for(const fault of ['wrong operation','wrong method','query','fragment','foreign actor','foreign draft'])test(`Audio output attempt refuses ${fault} before reservation`,async t=>{
  const f=await attemptFixture(t);let req=f.makeRequest(),operation='audio-output-state';
  if(fault==='wrong operation')operation='audio-output-prepare';
  else if(fault==='wrong method')req=f.makeRequest('audio-output-state',{method:'POST'});
  else if(fault==='query')req=f.makeRequest('audio-output-state',{suffix:'?replay=1'});
  else if(fault==='fragment')req=f.makeRequest('audio-output-state',{suffix:'#copy'});
  else if(fault==='foreign actor')req=f.makeRequest('audio-output-state',{userId:payer});
  else req=outputRequest(`experience-draft-${'a'.repeat(64)}`);
  await denied(f,()=>f.reserve(req,operation));assert.equal(rows(f,attemptTable).length,0);noNativeWork(f);
});
for(const dimension of ['Requests','Bytes','Queries','Rows'])test(`Audio output attempt conserves its configured ${dimension.toLowerCase()} ceiling`,async t=>{
  const f=await attemptFixture(t,{configurePolicy:p=>{
    const cap=dimension==='Requests'?1:p.operations['audio-output-state'][`maximum${dimension}`];
    p.actor[`maximum${dimension}PerWindow`]=cap;p.campaign[`maximum${dimension}PerWindow`]=cap;
  }}),req=f.makeRequest();await f.reserve(req);const before=snapshot(f);
  await assert.rejects(()=>f.reserve(f.makeRequest()));assert.equal(rows(f,attemptTable).length,1);assert.deepEqual(snapshot(f),before);noNativeWork(f);
});
for(const fault of ['copied attempt','other Request','other environment','other database','concurrent take'])test(`Audio output attempt preserves single-use identity against ${fault}`,async t=>{
  const f=await attemptFixture(t),req=f.makeRequest(),attempt=await f.reserve(req),before=snapshot(f);
  if(fault==='concurrent take'){
    const results=await Promise.allSettled([attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env),attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
    await attempts.retireSponsorAudioOutputReadBudget(results.find(result=>result.status==='fulfilled').value,req,f.env);
  }else{
    const candidate=fault==='copied attempt'?{...attempt}:attempt,otherReq=fault==='other Request'?req.clone():req,
      otherEnv=fault==='other environment'?{...f.env}:f.env,originalDB=f.env.DB;
    if(fault==='other database')f.env.DB={...originalDB};
    try{await assert.rejects(()=>attempts.takeSponsorAudioOutputReadAttempt(candidate,otherReq,otherEnv));}finally{f.env.DB=originalDB;}
  }
  assert.deepEqual(snapshot(f),before);noNativeWork(f);
});


test('Audio output principal supports a genuine large private authorization snapshot',async t=>{
  const name='Private long project 水 '.repeat(500),f=await fixture(t,{projectName:name,strict:true});
  assert.ok(Buffer.byteLength(f.originalPayerSnapshot)>8192);await f.approve();
  const saved=JSON.parse(rows(f,'experience_sponsor_audio_output_read_approvals')[0].review_receipt_json);
  assert.equal(saved.payerAuthorityJson,f.originalPayerSnapshot);assert.equal(JSON.stringify(f.approved).includes(name),false);
  const native=await approval.readSponsorAudioOutputPrincipal(request({}),f.env);
  assert.equal(native.principalSnapshotJson,f.originalPayerSnapshot);native.assertCurrent();noNativeWork(f);f.limits.assertVerified();
});
test('Audio output principal currentness rejects post-return accessor without invoking it',async t=>{
  const f=await fixture(t),native=await approval.readSponsorAudioOutputPrincipal(readRequest(),f.env);let invoked=0;
  Object.defineProperty(native.principal,'billingUserId',{enumerable:true,configurable:true,get(){invoked++;return payer;}});
  assert.throws(()=>native.assertCurrent());assert.equal(invoked,0);noNativeWork(f);
});

for(const ack of ['lost','sparse','contradictory','accessor'])test(`Audio output attempt ${ack} acknowledgement retains its full charge without a usable brand`,async t=>{
  const f=await attemptFixture(t,{configurePolicy:p=>{p.actor.maximumRequestsPerWindow=1;p.campaign.maximumRequestsPerWindow=1;}}),req=f.makeRequest(),nativeBatch=f.env.DB.batch;
  let reached=0,invoked=0;
  f.env.DB.batch=async statements=>{
    const result=await nativeBatch.call(f.env.DB,statements);
    if(!reached&&statements.some(statement=>statement.sql.includes(`INSERT INTO main.${attemptTable}`))){
      reached++;
      if(ack==='lost')throw Error('fixture loses committed output-read accounting acknowledgement');
      if(ack==='sparse'){const changed=[...result];delete changed[0];return changed;}
      if(ack==='contradictory')return result.map((row,index)=>index?row:{...row,error:'contradictory'});
      const changed=[...result];Object.defineProperty(changed,'0',{enumerable:true,get(){invoked++;return result[0];}});return changed;
    }
    return result;
  };
  try{await assert.rejects(()=>f.reserve(req));}finally{f.env.DB.batch=nativeBatch;}
  assert.equal(reached,1);assert.equal(invoked,0);const charged=rows(f,attemptTable);assert.equal(charged.length,1);
  assert.equal(charged[0].maximum_bytes,f.policy.operations['audio-output-state'].maximumBytes);
  await denied(f,()=>f.reserve(req));await denied(f,()=>f.reserve(f.makeRequest()));assert.deepEqual(rows(f,attemptTable),charged);noNativeWork(f);
});
for(const dimension of ['bytes','queries','rows'])test(`Audio output budget irreversibly closes at its remaining ${dimension} limit`,async t=>{
  const f=await attemptFixture(t),req=f.makeRequest(),attempt=await f.reserve(req),budget=await attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env),
    view=attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env),before=snapshot(f),remaining=view.remaining();
  assert.ok(view.usage[dimension]>0,'control work has already consumed the original budget');
  view.account({bytes:0,queries:0,rows:0,[dimension]:remaining[dimension]});assert.equal(view.remaining()[dimension],0);
  assert.throws(()=>view.account({bytes:0,queries:0,rows:0,[dimension]:1}));
  assert.throws(()=>view.current());await assert.rejects(async()=>attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env));
  assert.deepEqual(snapshot(f),before);noNativeWork(f);
});
test('Audio output budget preserves response UTF-8 bytes, same POST body consumption and one lifetime',async t=>{
  const f=await attemptFixture(t),req=f.makeRequest('audio-output-prepare'),attempt=await f.reserve(req,'audio-output-prepare'),
    budget=await attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env),view=attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env),before=snapshot(f);
  const room=view.remaining(),deadline=view.monotonicDeadline,serialized=JSON.stringify({text:'水 — موسيقى 🎵'});
  view.accountResponse(serialized);assert.equal(view.remaining().bytes,room.bytes-Buffer.byteLength(serialized));
  assert.deepEqual(await req.json(),{});assert.equal(req.bodyUsed,true);view.current();
  assert.equal(view.monotonicDeadline,deadline);await view.wait(async()=>undefined);assert.equal(view.monotonicDeadline,deadline);
  await attempts.retireSponsorAudioOutputReadBudget(budget,req,f.env);assert.throws(()=>view.remaining());assert.deepEqual(snapshot(f),before);noNativeWork(f);
});
for(const phase of ['before reserve','before take'])test(`Audio output attempt refuses a consumed POST body ${phase}`,async t=>{
  const f=await attemptFixture(t),req=f.makeRequest('audio-output-prepare');
  if(phase==='before reserve'){await req.text();await denied(f,()=>f.reserve(req,'audio-output-prepare'));assert.equal(rows(f,attemptTable).length,0);}
  else {const attempt=await f.reserve(req,'audio-output-prepare');await req.text();await denied(f,()=>attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env));assert.equal(rows(f,attemptTable).length,1);}
  noNativeWork(f);
});
for(const fault of ['native actor changed','request headers changed','aborted signal'])test(`Audio output attempt refuses ${fault} before take without refund`,async t=>{
  const f=await attemptFixture(t),controller=new AbortController(),req=f.makeRequest('audio-output-state',{signal:controller.signal}),attempt=await f.reserve(req);
  if(fault==='native actor changed')f.sqlite.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run('2099-01-01T00:00:00.000Z',actor);
  else if(fault==='request headers changed')req.headers.set('x-fixture-mutated','yes');else controller.abort();
  await denied(f,()=>attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env));assert.equal(rows(f,attemptTable).length,1);noNativeWork(f);
});
test('Audio output budget uses a short original deadline and retains charge through deadline plus window',async t=>{
  const f=await attemptFixture(t,{configurePolicy:p=>{for(const limit of Object.values(p.operations))limit.deadlineMs=300;
    p.windowMs=350;p.actor.maximumRequestsPerWindow=1;p.campaign.maximumRequestsPerWindow=1;}}),req=f.makeRequest(),
    started=performance.now(),attempt=await f.reserve(req),budget=await attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env),
    view=attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env),original=rows(f,attemptTable)[0],before=snapshot(f),deadline=view.monotonicDeadline;
  assert.ok(deadline<=started+305);assert.equal(view.receipt.deadline_at_ms-view.receipt.admitted_at_ms,300);
  assert.equal(view.receipt.charged_through_ms-view.receipt.deadline_at_ms,350);
  await new Promise(resolve=>setTimeout(resolve,Math.max(1,original.deadline_at_ms-Date.now()+25)));
  assert.throws(()=>view.current());
  const during=Number(f.sqlite.prepare(`SELECT ${clock} AS now`).get().now);
  assert.ok(during>original.deadline_at_ms&&during<original.charged_through_ms);
  await denied(f,()=>f.reserve(f.makeRequest()));assert.deepEqual(snapshot(f),before);
  await new Promise(resolve=>setTimeout(resolve,Math.max(1,original.charged_through_ms-Date.now()+25)));
  assert.ok(Number(f.sqlite.prepare(`SELECT ${clock} AS now`).get().now)>original.charged_through_ms);
  await f.reserve(f.makeRequest());const charged=rows(f,attemptTable);
  assert.equal(charged.length,2);assert.deepEqual(charged.find(row=>row.attempt_id===original.attempt_id),original);
  assert.ok(charged.find(row=>row.attempt_id!==original.attempt_id).admitted_at_ms>original.charged_through_ms);noNativeWork(f);
});

test('Audio output attempt rejects selector accessors without invoking them or touching the database',async t=>{
  const f=await attemptFixture(t),req=f.makeRequest(),raw={operation:'audio-output-state',draftId:f.intake.plan.draftId};let invoked=0,dispatched=0;
  Object.defineProperty(raw,'operation',{enumerable:true,get(){invoked++;return 'audio-output-state';}});
  const prepare=f.DB.prepare;f.DB.prepare=function(sql){dispatched++;return prepare.call(this,sql);};
  try{await denied(f,()=>attempts.reserveSponsorAudioOutputReadAttempt(req,f.env,raw));}finally{f.DB.prepare=prepare;}
  assert.equal(invoked,0);assert.equal(dispatched,0);assert.equal(rows(f,attemptTable).length,0);noNativeWork(f);
});
test('Audio output budget stays retired after observed principal mutation is restored',async t=>{
  const f=await attemptFixture(t),req=f.makeRequest(),attempt=await f.reserve(req),budget=await attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env),
    view=attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env),before=snapshot(f),original=view.principal.access.capabilities;
  view.principal.access.capabilities=['foreign-permission'];assert.throws(()=>view.current());
  view.principal.access.capabilities=original;assert.throws(()=>view.current());
  assert.throws(()=>attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env));assert.deepEqual(snapshot(f),before);noNativeWork(f);
});


test('Audio output attempt actor ceiling spans genuine current actor sessions',async t=>{
  const f=await attemptFixture(t,{configurePolicy:p=>{p.actor.maximumRequestsPerWindow=1;}});
  await f.reserve(f.makeRequest());
  f.sqlite.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run('2099-01-01T00:00:00.000Z',actor);
  const successor=await originalIntake(f);assert.notEqual(successor.input.sessionDigest,f.intake.input.sessionDigest);
  const req=outputRequest(successor.plan.draftId),before=snapshot(f);
  await assert.rejects(()=>attempts.reserveSponsorAudioOutputReadAttempt(req,f.env,{operation:'audio-output-state',draftId:successor.plan.draftId}));
  assert.equal(rows(f,attemptTable).length,1);assert.deepEqual(snapshot(f),before);noNativeWork(f);
});
test('Audio output attempt campaign ceiling aggregates distinct genuine actors',async t=>{
  const f=await attemptFixture(t,{extraActor:true,configurePolicy:p=>{p.actor.maximumRequestsPerWindow=2;p.campaign.maximumRequestsPerWindow=2;}});
  await f.reserve(f.makeRequest());const other=await originalIntake(f,actorTwo);
  const reserveOther=()=>attempts.reserveSponsorAudioOutputReadAttempt(outputRequest(other.plan.draftId,'audio-output-state',{userId:actorTwo}),f.env,{operation:'audio-output-state',draftId:other.plan.draftId});
  await reserveOther();const charged=rows(f,attemptTable);assert.equal(charged.length,2);
  assert.deepEqual(new Set(charged.map(row=>row.actor_user_id)),new Set([actor,actorTwo]));
  await denied(f,reserveOther);assert.deepEqual(rows(f,attemptTable),charged);noNativeWork(f);
});


for(const phase of ['not yet started','already expired'])test(`Audio output attempt refuses an approved read policy ${phase} without reservation`,async t=>{
  const f=await attemptFixture(t,{configurePolicy:p=>{if(phase==='not yet started'){p.startsAtMs=Date.now()+60000;p.expiresAtMs=p.startsAtMs+60000;}
    else {p.expiresAtMs=Date.now()-10000;p.startsAtMs=p.expiresAtMs-60000;}}});
  assert.deepEqual((await f.read()).policy,f.policy,'historical terms remain readable independently of admission');
  await denied(f,()=>f.reserve(f.makeRequest()));assert.equal(rows(f,attemptTable).length,0);noNativeWork(f);
});
test('Audio output attempt preserves historical original payer provenance after generation revocation',async t=>{
  const f=await attemptFixture(t);f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms').run();
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0').run();f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);
  const req=f.makeRequest(),attempt=await f.reserve(req),budget=await attempts.takeSponsorAudioOutputReadAttempt(attempt,req,f.env),view=attempts.requireSponsorAudioOutputReadBudget(budget,req,f.env);
  assert.deepEqual(view.original,f.intake.receipt);assert.equal(view.receipt.campaign_id,f.campaignId);assert.equal(rows(f,attemptTable).length,1);
  await attempts.retireSponsorAudioOutputReadBudget(budget,req,f.env);noNativeWork(f);
});
