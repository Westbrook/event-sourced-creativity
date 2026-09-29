import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';

import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const sha=value=>createHash('sha256').update(value).digest('hex');
const [{handleSession,POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,GUEST_DB_NOW,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA},{approveGuestSponsorCampaign},
  {compileGuestSponsorApprovalProposal},{saveGuestImageRequirement,readGuestImageRequirement},
  {registeredExperience,initialValues},{canonicalJson,digest},{preflightOutputImageSlidesTarget},{sponsorImageTransport},
  {SPONSOR_INTAKE_READ_POLICY_SCHEMA},{SPONSOR_INTAKE_READ_APPROVAL_SCHEMA},{SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA,SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA:V2},{retireExpiredGuestImageOutput},{SPONSOR_NATIVE_IMAGE_READ_INDEXES}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-approval.ts'),import('../worker/experience-guest-sponsor-contract.ts'),import('../worker/experience-guest-image-output.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),
  import('../worker/experience-sponsor-intake-read-policy.ts'),import('../worker/experience-sponsor-intake-read-approval.ts'),import('../worker/experience-sponsor-intake-read-attempts.ts'),
  import('../worker/experience-guest-image-output-retirement.ts'),import('../worker/experience-sponsor-native-image-read.ts'),
]);
const origin='https://guest.example.invalid',payer='synthetic-image-payer',subject='A blue heron on a stone bridge';
const request=()=>new Request(`${origin}/unregistered-guest-image-output`,{method:'POST',headers:{origin}});
const payerHeaders={origin,'content-type':'application/json','oai-authenticated-user-id':payer,'oai-authenticated-user-email':`${payer}@example.invalid`};
const allRows=f=>{const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
  return {schema,contents:Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,f.sqlite.prepare(`SELECT * FROM "${row.name.replaceAll('"','""')}"`).all()]))};};

async function fixture(t,attempts=V2,{draftLifetimeMs=120000}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  // Match the accepted fixture adapter for the native WITH...INSERT resource
  // debit. This only reports real SQLite changes; no authority is substituted.
  const nativeBatch=f.DB.batch;f.DB.batch=statements=>nativeBatch.call(f.DB,statements.map(statement=>{
    if(/WITH[\s\S]*INSERT INTO experience_sponsor_resource_receipts/u.test(statement.sql)){
      const execute=statement.execute;statement.execute=function(kind){return execute.call(this,kind==='all'?'run':kind);};
    }return statement;
  }));
  let forbidden=0;const sentinel=()=>{forbidden++;throw Error('provider/network/media forbidden');};
  t.mock.method(globalThis,'fetch',sentinel);for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,sentinel);
  t.after(()=>assert.equal(forbidden,0));
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:payerHeaders}),f.env)).status,200);
  f.sqlite.prepare("UPDATE users SET consent_version=?,role='creator' WHERE user_id=?").run(POLICY_VERSION,payer);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA,
    ...SPONSOR_INTAKE_READ_POLICY_SCHEMA,...SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,...attempts])f.sqlite.exec(sql);
  Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:now-60000,expiresAtMs:now+600000,
    sessionLifetimeMs:300000,leaseLifetimeMs:60000,maximumSessions:5,maximumLeaseAcquisitions:3});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(request(),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:subject,provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const sourcePolicy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,
    maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(sourcePolicy.policyId,await digest(sourcePolicy),canonicalJson(sourcePolicy),`sha256:${'c'.repeat(64)}`);
  const proof={sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken};
  const prepared=await prepareGuestImageSource(request(),f.env,{proof,policyId:sourcePolicy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}});
  const committed=await commitGuestImageSource(request(),f.env,{proof,draftHash:prepared.plan.draftHash});
  const offered=await preflightOutputImageSlidesTarget({env:f.env,target:{id:'synthetic-template',selected:true,blocking_issues:[],media_kind:'image',source_scope:{kind:'document'},
    aspect_ratio:{width:1,height:1},instruction_text:'Show a pear orchard',label:'Synthetic template',coverage:{kind:'document_outline'}},
    context:{snapshot:{facts:[{type:'subject',properties:{text:'A pear orchard'}}]}}});
  assert.equal(offered.available,true);const settings=offered.settings,payload=settings.payload;
  const template={version:2,appId:'image',recipeVersion:`image@${release.definition.revision}`,releaseDigest:release.releaseHash,outputKind:'image',inputMode:'text-only',
    outputCount:1,durationMs:0,width:1024,height:1024,route:offered.route,maximumCalls:offered.maximumCalls,maximumTokens:offered.maximumTokens,maximumMicrousd:offered.maximumMicrousd,
    calls:structuredClone(settings.calls),settings:{kind:settings.kind,productionMode:payload.productionMode,budgetAcknowledged:payload.budgetAcknowledged,
      preflightAcknowledged:payload.preflightAcknowledged,imageRender:structuredClone(settings.imageRender),imageBudget:structuredClone(settings.imageBudget),executionPolicy:structuredClone(settings.executionPolicy)},
    transport:await sponsorImageTransport(f.env)};
  const allowance={maximumOperations:100,maximumTextBytes:1000000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1000000,maximumPendingGrants:10,maximumInflightJobs:1};
  const resources={version:1,startsAtMs:now-60000,expiresAtMs:now+60000,windowMs:60000,maximumOperationTextBytes:65536,campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
  const policy={version:3,mode:'candidate',campaignId:'synthetic-guest-campaign',policyVersion:'synthetic-guest@1',payerUserId:payer,audience:'guest-session',
    startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:30000,maximumAdmissions:10,
    maximumMicrousd:Math.max(1000000,template.maximumMicrousd*10),maximumAdmissionsPerActor:5,windowMs:60000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,
    templates:[template],resources,guestAdmission:{protocol:'guest-image-source@1',origin,sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),
      sourcePolicyId:sourcePolicy.policyId,sourcePolicyDigest:await digest(sourcePolicy),releaseHash:release.releaseHash}};
  const proposal={version:1,purpose:'guest-sponsored-image',issuerProtocol:'guest-image-source@1',policy},compiled=await compileGuestSponsorApprovalProposal(proposal);
  const command={version:1,action:'approve-guest-sponsor-campaign',approvalId:'synthetic-image-approval',proposal,reviewedTermsDigest:compiled.termsDigest,confirmation:'APPROVE_GUEST_SPONSOR_CAMPAIGN'};
  assert.equal((await approveGuestSponsorCampaign(new Request(`${origin}/unregistered-guest-approval`,{method:'POST',headers:payerHeaders,body:JSON.stringify(command)}),f.env)).status,'approved');
  const input={proof,campaignId:policy.campaignId,policyDigest:compiled.policyDigest,draftHash:prepared.plan.draftHash};
  return {...f,session,committed,prepared,policy,compiled,proof,save:()=>saveGuestImageRequirement(request(),f.env,input),read:()=>readGuestImageRequirement(request(),f.env,input),retire:()=>retireExpiredGuestImageOutput(f.env,{sessionId:session.sessionId})};
}

const attemptTable='experience_sponsor_intake_read_attempts';
const schemas=[['V1',SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA],['V2',V2],['absent',[]]];
const limitsFor=f=>enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
function diagnoseLimits(t,limits){limits.assertVerified();t.diagnostic(JSON.stringify({queries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));}
function replaceAttempts(f,schema){f.sqlite.exec(`DROP TABLE ${attemptTable}`);for(const sql of schema)f.sqlite.exec(sql);}
async function expire(f){const start=performance.now();while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).due){assert.ok(performance.now()-start<5000,'real native database expiry');await delay(10);}}
async function savedAndReopened(f){const saved=await f.save();assert.equal(saved.status,'saved');assert.equal(saved.documentId,f.session.documentId);assert.equal(saved.revision,f.committed.head+1);
  for(const key of ['planConfirmed','admissionCommitted','generationAvailable','custodyTransferred'])assert.equal(saved[key],false);
  const after=allRows(f);assert.deepEqual(await f.save(),{...saved,replayed:true});assert.deepEqual(await f.read(),{...saved,replayed:true});assert.deepEqual(allRows(f),after,'replay and reopen do not mutate');return saved;}
for(const [name,attempts] of schemas)test(`${name} complete family: native SAVE replay and reopen succeed`,async t=>{
  const f=await fixture(t,attempts),before=allRows(f),limits=limitsFor(f);
  t.diagnostic(JSON.stringify({schemaFamily:name,attemptSchemaSha256:sha(JSON.stringify(attempts)),attemptObjects:attempts.length}));
  try{await savedAndReopened(f);const after=allRows(f);assert.deepEqual(after.schema,before.schema);
    for(const [table,value] of Object.entries(before.contents))if(!['events','event_private_payloads','output_commands','experience_sponsor_resource_receipts'].includes(table))assert.deepEqual(after.contents[table],value,table);
    assert.equal(after.contents.events.length,before.contents.events.length+1);assert.equal(after.contents.output_commands.length,1);assert.equal(after.contents.experience_sponsor_resource_receipts.length,1);
    if(attempts.length)assert.deepEqual(after.contents[attemptTable],[]);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);diagnoseLimits(t,limits);
  }catch(error){if(!f.sqlite.prepare('SELECT 1 FROM output_commands').get())assert.deepEqual(allRows(f),before,'rejected SAVE causes no partial writes');throw error;}finally{limits.restore();}
});
function onlyTailChanged(f,before,saved,result){const after=allRows(f);assert.deepEqual(after.schema,before.schema);
  for(const [table,prior]of Object.entries(before.contents)){
    if(table!=='event_private_payloads')assert.deepEqual(after.contents[table],prior,table);
    else{assert.equal(after.contents[table].length,prior.length);for(const row of after.contents[table]){const old=prior.find(item=>item.private_event_id===row.private_event_id);
      assert.ok(old);if(row.private_event_id===saved.eventId){assert.equal(row.private_json,'');assert.equal(row.redacted_at,result.redactedAt);assert.deepEqual({...row,private_json:old.private_json,redacted_at:old.redacted_at},{...old});}else assert.deepEqual(row,old);}}
  }
  assert.equal(result.status,'retired');assert.equal(result.scope,'first-save-private-body');assert.equal(result.eventId,saved.eventId);
  assert.match(result.redactedAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u);
}
for(const [name,attempts]of schemas)test(`${name} complete family: exact due SAVE tail retirement succeeds`,async t=>{
  const f=await fixture(t,attempts,{draftLifetimeMs:1000}),saved=await f.save();await expire(f);const before=allRows(f),limits=limitsFor(f);
  try{let result;try{result=await f.retire();}catch(error){assert.deepEqual(allRows(f),before,'rejected retirement causes no partial writes');throw error;}
    onlyTailChanged(f,before,saved,result);
    const after=allRows(f);assert.deepEqual(await f.retire(),{...result,replayed:true});assert.deepEqual(allRows(f),after);diagnoseLimits(t,limits);
  }finally{limits.restore();}
});

const actorIndex=SPONSOR_NATIVE_IMAGE_READ_INDEXES.filter(index=>index.name==='idx_sponsor_image_actor_history');
assert.equal(actorIndex.length,1);
for(const [name,attempts]of schemas)test(`${name} accepts the complete exact native actor-history index for SAVE and retirement`,async t=>{
  const f=await fixture(t,attempts,{draftLifetimeMs:1000});f.sqlite.exec(actorIndex[0].sql);const saved=await savedAndReopened(f);await expire(f);const before=allRows(f);
  onlyTailChanged(f,before,saved,await f.retire());
});

const changedSchemas=[
  ...V2.slice(1).map((sql,index)=>[`missing ${/^CREATE (?:INDEX|TRIGGER) ([a-z_]+)/u.exec(sql)[1]}`,V2.filter((_,at)=>at!==index+1)]),
  ['table-only family',[V2[0]]],
  ['unknown operation',V2.map((sql,index)=>index===0?sql.replace("'image-output-confirmation'","'image-output-confirmation','unreviewed-operation'"):sql)],
  ['weak update trigger',V2.map(sql=>sql.includes('BEFORE UPDATE')?sql.replace("SELECT RAISE(ABORT,'sponsor_intake_read_attempt_immutable')",'SELECT 1'):sql)],
  ['changed campaign index',V2.map(sql=>sql.startsWith('CREATE INDEX experience_sponsor_intake_read_campaign_window ')?sql.replace('(campaign_id,charged_through_ms)','(charged_through_ms,campaign_id)'):sql)],
  ['extra explicit object',[...V2,`CREATE INDEX unreviewed_guest_attempt_index ON ${attemptTable}(resource_key)`]],
];
async function deniedUnchanged(f,operation){const before=allRows(f);await assert.rejects(operation(),/unavailable/u);assert.deepEqual(allRows(f),before,'reject without state changes');}
for(const [name,schema]of changedSchemas){
  test(`${name} refuses SAVE`,async t=>{const f=await fixture(t,schema);await deniedUnchanged(f,f.save);});
  test(`${name} refuses retirement`,async t=>{const f=await fixture(t,V2,{draftLifetimeMs:1000});await f.save();replaceAttempts(f,schema);await expire(f);await deniedUnchanged(f,f.retire);});
}
for(const operation of ['save','retire'])test(`changed native actor-history index refuses ${operation}`,async t=>{
  const f=await fixture(t,V2,{draftLifetimeMs:operation==='retire'?1000:120000});if(operation==='retire')await f.save();
  assert.ok(actorIndex[0].sql.includes('(actor_user_id,job_id)'));f.sqlite.exec(actorIndex[0].sql.replace('(actor_user_id,job_id)','(job_id,actor_user_id)'));
  if(operation==='retire')await expire(f);await deniedUnchanged(f,f[operation]);
});

function insertConfirmationAttempt(f,association){
  // Adversarial retained sidecar data, not a fabricated read approval. The
  // exact native FK and immutable schema apply; these rows grant no authority.
  const readDigest=`sha256:${'e'.repeat(64)}`,now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now-10000;
  f.sqlite.prepare('INSERT INTO experience_sponsor_intake_read_policies VALUES(?,?,?,?,?)')
    .run(f.policy.campaignId,f.compiled.policyDigest,readDigest,'{}',`sha256:${'f'.repeat(64)}`);
  f.sqlite.prepare(`INSERT INTO ${attemptTable} VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('synthetic-confirmation',f.policy.campaignId,f.compiled.policyDigest,readDigest,
    association==='actor'?f.session.guestSubject:'unrelated-native-actor',association==='draft'?`draft:${f.prepared.plan.draftId}`:'draft:unrelated-retained-draft',
    'image-output-confirmation',1024,now,now+1000,now+2000);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}
for(const association of ['actor','draft','unrelated']){
  test(`V2 confirmation attempt ${association} association is classified independently for SAVE`,async t=>{
    const f=await fixture(t);insertConfirmationAttempt(f,association);const prior=f.sqlite.prepare(`SELECT * FROM ${attemptTable}`).all();
    if(association==='unrelated')await savedAndReopened(f);else await deniedUnchanged(f,f.save);
    assert.deepEqual(f.sqlite.prepare(`SELECT * FROM ${attemptTable}`).all(),prior);
  });
  test(`V2 confirmation attempt ${association} association is classified independently for retirement`,async t=>{
    const f=await fixture(t,V2,{draftLifetimeMs:1000}),saved=await f.save();insertConfirmationAttempt(f,association);await expire(f);
    if(association==='unrelated'){const before=allRows(f);onlyTailChanged(f,before,saved,await f.retire());}else await deniedUnchanged(f,f.retire);
  });
}

function beforeMutationBatch(f,kind,action){const nativeBatch=f.DB.batch;let reached=0;f.DB.batch=async function(statements){
  const matches=statements.some(statement=>kind==='save'?/INSERT INTO output_commands\(/u.test(statement.sql):/^UPDATE event_private_payloads SET private_json=''/u.test(statement.sql));
  if(matches&&reached++===0)action();return nativeBatch.call(this,statements);
};return()=>{f.DB.batch=nativeBatch;assert.equal(reached,1,'one native mutation batch was reached');};}
test('late V1-to-V2 schema switch refuses pending SAVE, then fresh V2 SAVE succeeds',async t=>{
  const f=await fixture(t,SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA);let changed;
  const restore=beforeMutationBatch(f,'save',()=>{replaceAttempts(f,V2);changed=allRows(f);});
  try{await assert.rejects(f.save());}finally{restore();}
  assert.deepEqual(allRows(f),changed,'schema switch remains but no SAVE mutation commits');await savedAndReopened(f);
});
test('late V1-to-V2 schema switch refuses pending retirement, then fresh V2 retirement succeeds',async t=>{
  const f=await fixture(t,SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA,{draftLifetimeMs:1000}),saved=await f.save();await expire(f);let changed;
  const restore=beforeMutationBatch(f,'retire',()=>{replaceAttempts(f,V2);changed=allRows(f);});
  try{await assert.rejects(f.retire());}finally{restore();}
  assert.deepEqual(allRows(f),changed,'schema switch remains but no tombstone commits');const before=allRows(f);onlyTailChanged(f,before,saved,await f.retire());
});
