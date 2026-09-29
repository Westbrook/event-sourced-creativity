import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {fixture,request,rows,snapshot,changes,batchHook,addLease,insert,payer,time} from './helpers/guest-image-stage-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{GUEST_IMAGE_SAVE_CLAIM_SCHEMA},{issueGuestClaimSession},
  {inspectGuestImageStageInventory}]=await Promise.all([
  import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-guest-image-claim-inventory.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-image-stage-inventory.ts')]);

// Keep genuine stage construction and the original source eraser independent
// of this new retirement path. No provider, fixture expiry rewrite or fabricated
// successful stage is needed to reach any of the three retained states.
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{preflightGuestImage},
  {retireExpiredGuestImageSource},{retireExpiredUnclaimedGuestImageStages}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts'),
  import('../worker/experience-guest-source-retirement.ts'),import('../worker/experience-guest-image-stage-retirement.ts')]);
const states=['confirmed','preflight-claimed-unknown','quoted'];
const reservation=statements=>statements.some(statement=>/^INSERT INTO experience_sponsor_driver_stages\(/u.test(statement.sql));
const retirement=statements=>statements.some(statement=>/^\s*UPDATE event_private_payloads\b/u.test(statement.sql));
const canonicalTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&new Date(value).toISOString()===value;
async function stageFixture(t,state='confirmed',options={}){
  const f=await fixture(t,{draftLifetimeMs:1500,...options}),review=await prepareGuestImageConfirmation(request(),f.env,f.input);
  f.confirmed=await confirmGuestImageRequirement(request(),f.env,{...f.input,reviewedRequirementDigest:review.reviewedRequirementDigest,explicitRequirementsConfirmation:true});
  if(state==='preflight-claimed-unknown'){
    const done=batchHook(f,reservation,()=>{throw Error('fixture lost native reservation acknowledgement');});
    try{await assert.rejects(preflightGuestImage(request(),f.env,f.input),/fixture lost native reservation acknowledgement/u);}finally{done();}
  }else if(state==='quoted')f.quoted=await preflightGuestImage(request(),f.env,f.input);
  f.state=state;f.tailIds=[f.saved.eventId,f.confirmed.eventId,...(f.quoted?[f.quoted.eventId]:[])];
  f.retire=(input={sessionId:f.session.sessionId},env=f.env)=>retireExpiredUnclaimedGuestImageStages(env,input);
  f.retireSource=()=>retireExpiredGuestImageSource(f.env,{sessionId:f.session.sessionId});
  assert.equal(rows(f,'events').length,f.committed.head+f.tailIds.length);
  assert.equal(rows(f,'experience_sponsor_resource_receipts').length,state==='confirmed'?2:3);
  assert.equal(rows(f,'output_preflights').length,state==='quoted'?1:0);
  return f;
}
async function due(f){const start=performance.now();while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).due){assert.ok(performance.now()-start<10000,'original native database expiry');await delay(10);}}
const body=(f,id)=>rows(f,'event_private_payloads').find(row=>row.private_event_id===id);
function onlyTailChanges(f,before){
  const after=snapshot(f);assert.deepEqual(after.schema,before.schema);
  for(const [table,prior]of Object.entries(before.contents)){
    if(table!=='event_private_payloads')assert.deepEqual(after.contents[table],prior,table);
    else{assert.equal(after.contents[table].length,prior.length);for(const current of after.contents[table]){const original=prior.find(row=>row.private_event_id===current.private_event_id);assert.ok(original);
      if(f.tailIds.includes(current.private_event_id))assert.deepEqual({...current,private_json:original.private_json,redacted_at:original.redacted_at},{...original});else assert.deepEqual(current,original);}}
  }
}
function assertRetired(f,result,{replayed}={}){
  assert.deepEqual(Object.keys(result).sort(),['status','scope','sessionId','documentId','stageState','stageHead','tails','replayed'].sort());
  assert.equal(result.status,'retired');assert.equal(result.scope,'unclaimed-original-image-stage-private-bodies');
  assert.equal(result.sessionId,f.session.sessionId);assert.equal(result.documentId,f.session.documentId);assert.equal(result.stageState,f.state);
  assert.equal(result.stageHead,f.committed.head+f.tailIds.length);assert.deepEqual(result.tails.map(row=>row.eventId),f.tailIds);
  assert.ok(Object.isFrozen(result));assert.equal(typeof result.replayed,'boolean');if(replayed!==undefined)assert.equal(result.replayed,replayed);
  for(const tail of result.tails){assert.deepEqual(Object.keys(tail).sort(),['eventId','redactedAt','replayed'].sort());assert.ok(canonicalTime(tail.redactedAt));assert.equal(typeof tail.replayed,'boolean');
    const stored=body(f,tail.eventId);assert.equal(stored.private_json,'');assert.equal(stored.redacted_at,tail.redactedAt);}
  for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'private_json','SELECT'])assert.equal(JSON.stringify(result).includes(secret),false);
}
async function denied(f,pattern){const before=snapshot(f);await assert.rejects(f.retire(),pattern);assert.deepEqual(snapshot(f),before);}
function sourceErased(f){const source=rows(f,'private_content').find(row=>row.content_id===f.prepared.plan.draftId);assert.equal(source.content,'');assert.ok(canonicalTime(source.redacted_at));for(const id of f.committed.eventIds){assert.equal(body(f,id).private_json,'');assert.ok(canonicalTime(body(f,id).redacted_at));}}
function noQuoteConstruction(f){let calls=0;for(const name of ['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_IMAGE_MODEL','FAL_KEY','FAL_IMAGE_MODEL'])Object.defineProperty(f.env,name,{configurable:true,get(){calls++;throw Error('retirement cannot inspect provider configuration');}});return()=>assert.equal(calls,0,'retirement cannot reconstruct or repurchase a quote');}
function mutationHook(f,predicate,action){
  const prepare=f.DB.prepare;let hits=0;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...bindings){const bound=bind.apply(this,bindings),execute=bound.execute;
      bound.execute=function(kind){if(!hits&&predicate(sql)){hits++;action();}return execute.call(this,kind);};return bound;};return statement;};
  return()=>{f.DB.prepare=prepare;assert.equal(hits,1,'actual native mutation seam reached');};
}
function nativeHold(f){
  insert(f,'budget_reservations',{reservation_id:'retained-stage-tokens',owner_id:payer,stream_id:'creative:foreign',correlation_id:'foreign-job',operation:'image',period:'2026-09',reserved_tokens:100,used_tokens:3,status:'active',created_at:time,updated_at:time});
  insert(f,'cost_budget_reservations',{reservation_id:'retained-stage-cost',owner_id:payer,workspace_id:'forma',stream_id:'creative:foreign',correlation_id:'foreign-job',operation:'image',period:'2026-09',reserved_microusd:1234,used_microusd:4,status:'executing',created_at:time,updated_at:time});
}
async function custodyBoundary(f,kind){
  for(const sql of [...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA,...GUEST_IMAGE_SAVE_CLAIM_SCHEMA])f.sqlite.exec(sql);
  const foreign=await issueGuestClaimSession(request(),f.env,f.terms.policyId);
  const lineage=session=>JSON.stringify({sessionId:session.sessionId,guestSubject:session.guestSubject,projectId:session.projectId,documentId:session.documentId});
  const adoption=session=>({session_id:session.sessionId,destination_user_id:'foreign-destination',lease_id:`negative-${session.sessionId}`,request_id:'negative-request',manifest_digest:'negative-manifest',lineage_json:lineage(session),lineage_digest:'negative-lineage',created_at_ms:1});
  // Adverse custody rows exercise independent exclusions. A genuine foreign
  // session keeps native foreign keys on; no successful claim is fabricated.
  insert(f,'experience_guest_context_adoptions',adoption(foreign));
  const before=snapshot(f);await inspectGuestImageStageInventory(request(),f.env,{proof:f.proof});assert.deepEqual(snapshot(f),before);
  if(kind==='context adoption')insert(f,'experience_guest_context_adoptions',adoption(f.session));
  else if(kind==='image claim')insert(f,'experience_guest_image_claims',{...adoption(foreign),context_lineage_digest:'negative-context',lineage_json:lineage(f.session)});
  else insert(f,'experience_guest_plan_custodies',{session_id:foreign.sessionId,destination_user_id:'foreign-destination',draft_id:f.prepared.plan.draftId,content_id:'foreign-content',draft_hash:'negative-hash',content_digest:'negative-content',lineage_digest:'negative-lineage',created_at:time,expires_at:'2020-01-02T00:00:00.000Z'});
  assert.deepEqual(rows(f,'experience_guest_claim_leases'),[]);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}

for(const state of states)for(const order of ['source-first','tail-first'])test(`${state} ${order} cleanup retires exactly original tails and replays without mutation`,async t=>{
  const f=await stageFixture(t,state,{memory:order==='source-first'});nativeHold(f);await due(f);
  const noQuote=noQuoteConstruction(f);if(order==='source-first'){await f.retireSource();sourceErased(f);}
  const before=snapshot(f),result=await f.retire();assertRetired(f,result,{replayed:false});onlyTailChanges(f,before);noQuote();
  assert.ok(result.tails.every(row=>!row.replayed));for(const tail of result.tails)assert.ok(tail.redactedAt>=rows(f,'experience_guest_sources')[0].expires_at);
  if(order==='tail-first'){for(const id of f.committed.eventIds)assert.notEqual(body(f,id).private_json,'');await f.retireSource();sourceErased(f);}
  const retired=snapshot(f),count=changes(f),replay=await f.retire();assertRetired(f,replay,{replayed:true});assert.ok(replay.tails.every(row=>row.replayed));
  assert.deepEqual(replay.tails.map(row=>row.redactedAt),result.tails.map(row=>row.redactedAt));assert.deepEqual(snapshot(f),retired);assert.equal(changes(f),count);noQuote();
  assert.equal(rows(f,'experience_sponsor_resource_receipts').length,state==='confirmed'?2:3);assert.equal(rows(f,'output_preflights').length,state==='quoted'?1:0);
});

test('an active original source cannot be retired under a forward process clock or revoked payer',async t=>{
  const f=await stageFixture(t,'quoted',{draftLifetimeMs:60000});f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
  t.mock.method(Date,'now',()=>8_000_000_000_000);await denied(f,/not_due/u);
});

test('due historical cleanup requires neither live payer nor production approval or guest-policy eligibility',async t=>{
  const f=await stageFixture(t,'quoted');
  f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');
  f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}',policy_digest='changed'");
  f.sqlite.exec("UPDATE experience_sponsor_resource_policies SET enabled=0,limits_json='{}',limits_digest='changed'");f.sqlite.exec('DELETE FROM users');
  await due(f);t.mock.method(Date,'now',()=>0);const before=snapshot(f),noQuote=noQuoteConstruction(f);assertRetired(f,await f.retire());onlyTailChanges(f,before);noQuote();
});

const partialTailSets={'no-tail':[],save:['save'],confirmation:['confirmation'],'save-and-confirmation':['save','confirmation'],quote:['quote'],
  'save-and-quote':['save','quote'],'confirmation-and-quote':['confirmation','quote'],'all-tails':['save','confirmation','quote']};
for(const erased of ['draft','prefix',...Object.keys(partialTailSets)])test(`partial ${erased} tombstones preserve their timestamps while other due tails retire`,async t=>{
  const f=await stageFixture(t,'quoted');await due(f);const stamp=f.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS value").get().value;
  if(erased==='draft')f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(stamp,f.prepared.plan.draftId);
  const ids=erased==='prefix'?[f.committed.eventIds[0]]:(partialTailSets[erased]??[]).map(kind=>({save:f.saved.eventId,confirmation:f.confirmed.eventId,quote:f.quoted.eventId})[kind]);
  for(const id of ids)f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(stamp,id);
  const before=snapshot(f),result=await f.retire();assertRetired(f,result);onlyTailChanges(f,before);
  for(const id of ids)assert.equal(body(f,id).redacted_at,stamp);
  for(const tail of result.tails)assert.equal(tail.replayed,ids.includes(tail.eventId));
});

for(const invalid of ['nonempty','invalid-time','wrong-owner'])test(`a ${invalid} tail tombstone cannot authorize cleanup`,async t=>{
  const f=await stageFixture(t,'quoted');await due(f);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=?,redacted_at=?,owner_id=? WHERE private_event_id=?")
    .run(invalid==='nonempty'?'{}':'',invalid==='invalid-time'?'yesterday':new Date().toISOString(),invalid==='wrong-owner'?'foreign-owner':f.session.guestSubject,f.confirmed.eventId);
  await denied(f);
});

for(const expired of [false,true])test(`${expired?'expired':'active'} custody lease is outside unclaimed stage retirement`,async t=>{
  const f=await stageFixture(t,'confirmed');addLease(f,expired);await due(f);await denied(f);
});
for(const kind of ['context adoption','image claim','plan custody mapping'])test(`${kind} independently excludes stage retirement without any lease`,async t=>{
  const f=await stageFixture(t,'quoted');await custodyBoundary(f,kind);await due(f);await denied(f);
});

test('closed retirement input refuses caller identities, tails, quotes and deadlines without schema changes',async t=>{
  const f=await stageFixture(t,'confirmed');await due(f);
  for(const input of [{},{sessionId:'not-a-native-session'},{sessionId:f.session.sessionId,ownerUserId:payer},
    {sessionId:f.session.sessionId,eventIds:f.tailIds},{sessionId:f.session.sessionId,stageState:'quoted'},
    {sessionId:f.session.sessionId,expiresAt:time},{sessionId:f.session.sessionId,proof:f.proof}]){
    const before=snapshot(f);await assert.rejects(f.retire(input));assert.deepEqual(snapshot(f),before);
  }
});

for(const kind of ['lost','sparse','false','truncated'])test(`${kind} retirement acknowledgement recovers original tombstones with one mutation`,async t=>{
  const f=await stageFixture(t,'quoted');await due(f);const before=snapshot(f),done=batchHook(f,retirement,result=>{
    if(kind==='lost')throw Error('fixture lost retirement acknowledgement');if(kind==='truncated')return result.slice(0,-1);
    if(kind==='sparse'){const copy=[...result];delete copy[0];return copy;}return result.map((row,index)=>index?row:{...row,success:false});
  });
  let result;try{result=await f.retire();}finally{done();}assertRetired(f,result,{replayed:true});onlyTailChanges(f,before);
  const retired=snapshot(f),count=changes(f);assertRetired(f,await f.retire(),{replayed:true});assert.deepEqual(snapshot(f),retired);assert.equal(changes(f),count);
});

for(const changed of ['command','private-owner'])test(`late ${changed} drift inside retirement rolls back every tombstone`,async t=>{
  const f=await stageFixture(t,'quoted');await due(f);const before=snapshot(f);
  const done=mutationHook(f,sql=>/^\s*UPDATE event_private_payloads\b/u.test(sql),()=>{
    if(changed==='command')f.sqlite.exec("UPDATE output_commands SET request_digest='changed-during-batch' WHERE action='confirm'");
    else f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id=?").run(f.confirmed.eventId);
  });
  try{await assert.rejects(f.retire());}finally{done();}assert.deepEqual(snapshot(f),before);
});

test('an external sidecar change survives while stale cleanup is refused',async t=>{
  const f=await stageFixture(t,'quoted');await due(f);let changed;
  const done=batchHook(f,retirement,()=>{f.sqlite.exec("UPDATE output_preflights SET terms_digest='external-change'");changed=snapshot(f);},{after:false});
  try{await assert.rejects(f.retire());}finally{done();}assert.deepEqual(snapshot(f),changed);
});

test('partial Memory or tail-linked Memory refuses cleanup instead of erasing native provenance',async t=>{
  const partial=await stageFixture(t,'confirmed');partial.sqlite.exec('CREATE TABLE memory_structured_answer_origins(origin_id TEXT PRIMARY KEY)');await due(partial);await denied(partial);
  const f=await stageFixture(t,'quoted',{memory:true});insert(f,'memory_document_job_answer_origins',{origin_id:'stage-retention-memory',schema_version:1,recipe_version:'native-document-job-answer-origin-v1',job_id:'foreign-job',actor_user_id:'foreign-actor',scope_key:'["","","foreign-project","foreign-document"]',turn_id:'foreign-turn',user_event_id:f.quoted.eventId,user_content_id:'foreign-user-body',answer_event_id:'foreign-answer',answer_content_id:'foreign-answer-body',manifest_content_ref:'foreign-manifest',status:'minimized',withdrawn_at:time,withdrawal_reason:'erased'});
  await due(f);await denied(f);
});

test('source-only and N+1 first SAVE remain outside the later-stage retirement contract',async t=>{
  for(const saved of [false,true]){const f=await fixture(t,{saved,draftLifetimeMs:1000});await due(f);const before=snapshot(f);await assert.rejects(retireExpiredUnclaimedGuestImageStages(f.env,{sessionId:f.session.sessionId}));assert.deepEqual(snapshot(f),before);}
});

test('due quoted cleanup with complete Memory fits deployment SQL limits',async t=>{
  const f=await stageFixture(t,'quoted',{memory:true});await due(f);const before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{assertRetired(f,await f.retire());onlyTailChanges(f,before);limits.assertVerified();t.diagnostic(JSON.stringify({qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));}finally{limits.restore();}
});
