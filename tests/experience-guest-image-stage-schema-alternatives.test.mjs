import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture as nativeFixture,rows,snapshot,changes,unchangedExcept,request,GUEST_DB_NOW} from './helpers/guest-image-stage-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{preflightGuestImage,readGuestImagePreflight},
  {SPONSOR_INTAKE_READ_POLICY_SCHEMA},{SPONSOR_INTAKE_READ_APPROVAL_SCHEMA},
  {SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA:V1,SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA:V2}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts'),
  import('../worker/experience-sponsor-intake-read-policy.ts'),import('../worker/experience-sponsor-intake-read-approval.ts'),
  import('../worker/experience-sponsor-intake-read-attempts.ts')]);
const attemptTable='experience_sponsor_intake_read_attempts';
const allowed=['events','event_private_payloads','output_commands','output_plan_revisions','output_plan_targets','output_preflights',
  'experience_sponsor_resource_receipts','experience_sponsor_driver_intents','experience_sponsor_driver_stages'];
const review=f=>prepareGuestImageConfirmation(request(),f.env,f.input);
const confirm=(f,prepared)=>confirmGuestImageRequirement(request(),f.env,{...f.input,reviewedRequirementDigest:prepared.reviewedRequirementDigest,explicitRequirementsConfirmation:true});
const preflight=f=>preflightGuestImage(request(),f.env,f.input);
const readQuote=f=>readGuestImagePreflight(request(),f.env,f.input);
async function fixture(t,schema=V2,{memory=false}={}){
  const f=await nativeFixture(t,{saved:false,memory});
  for(const sql of [...SPONSOR_INTAKE_READ_POLICY_SCHEMA,...SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,...schema])f.sqlite.exec(sql);
  f.saved=await f.save();assert.equal(f.saved.status,'saved','accepted firstSAVE must succeed before the new stage is exercised');
  return f;
}
function replaceAttempts(f,schema){f.sqlite.exec(`DROP TABLE ${attemptTable}`);for(const sql of schema)f.sqlite.exec(sql);}
async function complete(f){
  const prepared=await review(f),confirmed=await confirm(f,prepared),quoted=await preflight(f);
  assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.replayed,false);assert.equal(confirmed.revision,f.committed.head+2);
  assert.equal(quoted.status,'quoted');assert.equal(quoted.replayed,false);assert.equal(quoted.revision,f.committed.head+3);
  assert.equal(quoted.planRevisionId,confirmed.planRevisionId);assert.equal(rows(f,'output_commands').length,3);assert.equal(rows(f,'output_preflights').length,1);
  assert.equal(rows(f,'experience_sponsor_resource_receipts').length,3);assert.equal(rows(f,'experience_sponsor_driver_stages').length,1);
  const after=snapshot(f),count=changes(f);
  assert.deepEqual(await confirm(f,prepared),{...confirmed,replayed:true});assert.deepEqual(await preflight(f),{...quoted,replayed:true});assert.deepEqual(await readQuote(f),{...quoted,replayed:true});
  assert.deepEqual(snapshot(f),after);assert.equal(changes(f),count,'exact replay never writes or recharges');
  for(const key of ['admissionCommitted','generationAvailable','custodyTransferred'])assert.equal(quoted[key],false);
  return {prepared,confirmed,quoted};
}
for(const [name,schema]of [['absent',[]],['V1',V1],['V2',V2]])test(`${name} whole native family permits actual guest SAVE-confirm-preflight and exact replay`,async t=>{
  const f=await fixture(t,schema,{memory:name==='V2'}),before=snapshot(f);
  t.diagnostic(`First SAVE passed at N+1 with ${name} schema before stage review.`);
  const limits=name==='V2'?enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}}):null;
  try{await complete(f);unchangedExcept(f,before,allowed);if(schema.length)assert.deepEqual(rows(f,attemptTable),[]);
    if(limits){limits.assertVerified();t.diagnostic(JSON.stringify({queries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));}
  }finally{limits?.restore();}
});

const malformed=[
  ...V2.slice(1).map((sql,index)=>[`missing ${/^CREATE (?:INDEX|TRIGGER) ([a-z_]+)/u.exec(sql)[1]}`,V2.filter((_,at)=>at!==index+1)]),
  ['table-only family',[V2[0]]],
  ['unapproved combined operation set',V2.map((sql,index)=>index===0?sql.replace("'image-output-confirmation'","'image-output-confirmation','unreviewed-operation'"):sql)],
  ['changed immutable trigger',V2.map(sql=>sql.includes('BEFORE UPDATE')?sql.replace("SELECT RAISE(ABORT,'sponsor_intake_read_attempt_immutable')",'SELECT 1'):sql)],
  ['changed native index',V2.map(sql=>sql.startsWith('CREATE INDEX experience_sponsor_intake_read_campaign_window ')?sql.replace('(campaign_id,charged_through_ms)','(charged_through_ms,campaign_id)'):sql)],
  ['unknown explicit index',[...V2,`CREATE INDEX unreviewed_stage_attempt_index ON ${attemptTable}(resource_key)`]],
];
for(const [name,schema]of malformed)test(`stage review rejects ${name} after a genuine SAVE without repair`,async t=>{
  const f=await fixture(t);replaceAttempts(f,schema);const before=snapshot(f),count=changes(f);
  await assert.rejects(review(f),/image_output_schema_unavailable/u);assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);
  assert.equal(rows(f,'output_plan_revisions').length,0);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);
});
test('a complete V2 optional family cannot replace the required native driver schema',async t=>{
  const f=await fixture(t);f.sqlite.exec('DROP TABLE experience_sponsor_driver_stages; DROP TABLE experience_sponsor_driver_intents');
  const before=snapshot(f);await assert.rejects(review(f),/image_output_schema_unavailable/u);assert.deepEqual(snapshot(f),before);
});
test('a quoted V2 family with a missing native trigger cannot disclose its retained original quote',async t=>{
  const f=await fixture(t);await complete(f);f.sqlite.exec('DROP TRIGGER experience_sponsor_intake_read_attempts_no_delete');const before=snapshot(f);
  await assert.rejects(preflight(f),/image_output_schema_unavailable/u);await assert.rejects(readQuote(f),/image_output_schema_unavailable/u);assert.deepEqual(snapshot(f),before);
});

function insertAttempt(f,association){
  // Adversarial retained rows, never a fabricated read approval or new ability.
  // Native FK and immutable constraints remain enabled and are checked below.
  const readDigest=`sha256:${'e'.repeat(64)}`,now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now-10000;
  f.sqlite.prepare('INSERT INTO experience_sponsor_intake_read_policies VALUES(?,?,?,?,?)').run(f.policy.campaignId,f.compiled.policyDigest,readDigest,'{}',`sha256:${'f'.repeat(64)}`);
  f.sqlite.prepare(`INSERT INTO ${attemptTable} VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('synthetic-stage-confirmation-attempt',f.policy.campaignId,f.compiled.policyDigest,readDigest,
    association==='actor'?f.session.guestSubject:'unrelated-native-actor',association==='draft'?`draft:${f.prepared.plan.draftId}`:'draft:unrelated-retained-draft',
    'image-output-confirmation',1024,now,now+1000,now+2000);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}
for(const association of ['actor','draft'])test(`V2 attempt linked by ${association} remains excluded before a preflight claim`,async t=>{
  const f=await fixture(t),prepared=await review(f);await confirm(f,prepared);insertAttempt(f,association);
  const before=snapshot(f),count=changes(f);await assert.rejects(preflight(f),/image_output_/u);await assert.rejects(readQuote(f),/image_output_/u);
  assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,2);assert.equal(rows(f,'experience_sponsor_driver_stages').length,0);
});
test('an unrelated V2 attempt remains unchanged while the exact native guest stages succeed',async t=>{
  const f=await fixture(t);insertAttempt(f,'unrelated');const before=snapshot(f);await complete(f);unchangedExcept(f,before,allowed);
  assert.deepEqual(rows(f,attemptTable),before.contents[attemptTable]);assert.deepEqual(rows(f,'experience_sponsor_intake_read_policies'),before.contents.experience_sponsor_intake_read_policies);
});

function beforeBatch(f,predicate,action){const batch=f.DB.batch;let hits=0;f.DB.batch=async function(statements){if(predicate(statements)){hits++;if(hits===1)action();}return batch.call(this,statements);};
  return()=>{f.DB.batch=batch;assert.equal(hits,1,'exactly one native stage mutation attempted');};}
for(const phase of ['confirmation','preflight claim'])test(`a complete V1-to-V2 switch after ${phase} schema capture fails the raw-snapshot proof`,async t=>{
  const f=await fixture(t,V1),prepared=await review(f);if(phase==='preflight claim')await confirm(f,prepared);
  let changed;const predicate=statements=>statements.some(statement=>phase==='confirmation'?/^INSERT INTO output_plan_revisions\(/u.test(statement.sql):/^INSERT INTO experience_sponsor_driver_stages\(/u.test(statement.sql));
  const restore=beforeBatch(f,predicate,()=>{replaceAttempts(f,V2);changed=snapshot(f);});
  try{await assert.rejects(phase==='confirmation'?confirm(f,prepared):preflight(f),/CHECK constraint failed/u);}finally{restore();}
  assert.deepEqual(snapshot(f),changed,'the external valid schema switch persists, but the old captured stage makes no writes');
  if(phase==='confirmation')await confirm(f,await review(f));const quote=await preflight(f);assert.equal(quote.status,'quoted');assert.equal(quote.replayed,false);
});
