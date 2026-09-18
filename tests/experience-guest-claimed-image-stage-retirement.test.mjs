import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {fixture,request,rows,snapshot,changes,batchHook,insert,origin,payer,time} from './helpers/guest-image-stage-fixture.mjs';
registerOutputSourceImports();
const [{retireExpiredClaimedGuestImageStage},{GUEST_IMAGE_STAGE_CUSTODY_SCHEMA}]=await Promise.all([
  import('../worker/experience-guest-claimed-image-stage-retirement.ts'),import('../worker/experience-guest-image-stage-custody.ts')]);

// These read stubs exercise refusal only. The separate native cases below
// construct completed custody through the actual writer, never a seeded map.
const schema=GUEST_IMAGE_STAGE_CUSTODY_SCHEMA.map(sql=>{
  const match=/^CREATE (TABLE|TRIGGER) ([a-z_]+)/u.exec(sql);
  const table=match[1]==='TABLE'?match[2]:match[2]==='experience_guest_image_stage_content_identity'?'private_content'
    :match[2].startsWith('experience_guest_image_stage_custodies_')?'experience_guest_image_stage_custodies':'experience_guest_image_stage_copies';
  return {type:match[1].toLowerCase(),name:match[2],table,sql};
}).sort((a,b)=>a.name.localeCompare(b.name));
function reads(responses){
  const statements=[];let mutation=0,step=0;
  const env={DB:{prepare(sql){
    assert.match(sql,/^SELECT /u,'refusal remains read-only');statements.push(sql);
    const statement={bind(){return statement;},async first(){const value=responses[step++];return typeof value==='function'?value(env):value;},
      async all(){throw Error('unexpected collection read');},async run(){mutation++;throw Error('mutation forbidden');}};
    return statement;
  },async batch(){mutation++;throw Error('mutation forbidden');}}};
  return {env,statements,verify(){assert.equal(mutation,0);assert.equal(step,responses.length,'only expected refusal reads');}};
}
test('claimed-stage cleanup accepts only a session selector and rejects caller-defined authority before DB access',async()=>{
  let touches=0;const env=new Proxy({},{get(){touches++;throw Error('DB must remain untouched');}});
  for(const input of [null,{},[],{sessionId:''},{sessionId:'valid-session',sourceHead:3},{sessionId:'valid-session',tails:[]},
    {sessionId:'valid-session',ownerId:'owner'},{sessionId:'valid-session',expiresAt:'2000-01-01T00:00:00.000Z'},
    {sessionId:'valid-session',proof:{sql:'1',bindings:[]}}])await assert.rejects(retireExpiredClaimedGuestImageStage(env,input));
  assert.equal(touches,0);
});
for(const kind of ['missing','partial','changed'])test(`${kind} immutable stage schema refuses cleanup without native writes`,async()=>{
  const observed=kind==='missing'?[]:kind==='partial'?schema.slice(1):schema.map((row,index)=>index?row:{...row,sql:row.sql+' changed'});
  const f=reads([{snapshot:JSON.stringify(observed)}]);await assert.rejects(retireExpiredClaimedGuestImageStage(f.env,{sessionId:'valid-session'}));f.verify();
});
test('absent completed stage mapping never falls back to source, N1 or live custody',async()=>{
  const f=reads([{snapshot:JSON.stringify(schema)},null,null]);
  await assert.rejects(retireExpiredClaimedGuestImageStage(f.env,{sessionId:'valid-session'}));f.verify();
  assert.equal(f.statements.some(sql=>/FROM experience_guest_sources|FROM experience_guest_image_claims|FROM users/u.test(sql)),false);
});
test('a present malformed mapping cannot become an absent or partial cleanup success',async()=>{
  const f=reads([{snapshot:JSON.stringify(schema)},{lineage_json:'{}'}]);
  await assert.rejects(retireExpiredClaimedGuestImageStage(f.env,{sessionId:'valid-session'}));f.verify();
});
test('DB replacement after the schema await aborts without a follow-up read or write',async()=>{
  const f=reads([env=>{env.DB={prepare(){throw Error('replacement must not be queried');}};return {snapshot:JSON.stringify(schema)};}]);
  await assert.rejects(retireExpiredClaimedGuestImageStage(f.env,{sessionId:'valid-session'}));f.verify();
});

const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{preflightGuestImage},
  {inspectGuestImageStageClaimInventory},{claimGuestImageStages},{GUEST_IMAGE_SAVE_CLAIM_SCHEMA},
  {GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{POLICY_VERSION},
  {retireExpiredGuestImageSource},{handleWorkspaces},{handleEvents},{handleOutputRequirements}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts'),
  import('../worker/experience-guest-image-stage-claim-inventory.ts'),import('../worker/experience-guest-image-stage-claim.ts'),
  import('../worker/experience-guest-image-claim-inventory.ts'),import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-plan-custody.ts'),import('../worker/policy-version.ts'),
  import('../worker/experience-guest-source-retirement.ts'),import('../worker/workspaces-api.ts'),
  import('../worker/events-api.ts'),import('../worker/output-requirements-api.ts')]);
const owner='synthetic-stage-retirement-owner',other='synthetic-stage-retirement-other';
const states=['confirmed','preflight-claimed-unknown','quoted'];
const canonicalHeaders=(extra={})=>({origin,'oai-authenticated-user-id':owner,'oai-authenticated-user-email':`${owner}@example.invalid`,...extra});
const canonicalRequest=()=>new Request(`${origin}/unregistered-stage-claim`,{method:'POST',headers:canonicalHeaders()});
const reservation=statements=>statements.some(statement=>/^INSERT INTO experience_sponsor_driver_stages\(/u.test(statement.sql));
const retirement=statements=>statements.some(statement=>/^\s*UPDATE event_private_payloads\b/u.test(statement.sql));
const body=(f,id)=>f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(id);
const stamp=f=>f.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS value").get().value;
const canonicalTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&new Date(value).toISOString()===value;

async function claimedFixture(t,state='quoted',options={}){
  const f=await fixture(t,{draftLifetimeMs:4000,...options});
  const review=await prepareGuestImageConfirmation(request(),f.env,f.input);
  f.confirmed=await confirmGuestImageRequirement(request(),f.env,{...f.input,reviewedRequirementDigest:review.reviewedRequirementDigest,explicitRequirementsConfirmation:true});
  if(state==='quoted')f.quoted=await preflightGuestImage(request(),f.env,f.input);
  else if(state==='preflight-claimed-unknown'){
    const done=batchHook(f,reservation,()=>{throw Error('native fixture lost construction acknowledgement');});
    try{await assert.rejects(preflightGuestImage(request(),f.env,f.input),/native fixture lost construction acknowledgement/u);}finally{done();}
  }
  for(const sql of [...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA,...GUEST_IMAGE_SAVE_CLAIM_SCHEMA,...GUEST_IMAGE_STAGE_CUSTODY_SCHEMA])f.sqlite.exec(sql);
  for(const actor of [owner,other])insert(f,'users',{user_id:actor,email:`${actor}@example.invalid`,display_name:actor,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
  f.env.FORMA_RETENTION_DAYS='2';f.state=state;f.tailIds=[f.saved.eventId,f.confirmed.eventId,...(f.quoted?[f.quoted.eventId]:[])];
  const inventory=await inspectGuestImageStageClaimInventory(canonicalRequest(),f.env,{proof:f.proof});
  f.claimInput={sessionId:f.session.sessionId,requestId:'native-stage-retirement-claim',approvedManifestDigest:inventory.manifestDigest,proof:f.proof};
  f.claimed=await claimGuestImageStages(canonicalRequest(),f.env,f.claimInput);
  assert.equal(f.claimed.status,'image-stage-history-claimed');assert.equal(f.claimed.stageState,state);assert.equal(f.claimed.historyRetention,'retained');
  assert.equal(f.claimed.generationAvailable,false);assert.equal(f.claimed.miniAppClaimComplete,false);
  f.mapping=rows(f,'experience_guest_image_stage_custodies').find(row=>row.session_id===f.session.sessionId);assert.ok(f.mapping);
  f.lineage=JSON.parse(f.mapping.lineage_json);f.copies=rows(f,'experience_guest_image_stage_copies').filter(row=>row.session_id===f.session.sessionId);
  assert.deepEqual(f.copies.map(row=>row.role).sort(),(state==='confirmed'?['confirmation']:state==='quoted'?['confirmation','construction','quote']:['confirmation','construction']).sort());
  f.canonicalEvents=rows(f,'events').filter(row=>row.stream_id===`creative:${owner}`).sort((a,b)=>a.sequence-b.sequence);
  assert.equal(f.canonicalEvents.length,f.committed.head+1,'canonical prefix and SAVE only');
  assert.ok(f.canonicalEvents.every(row=>![...f.committed.eventIds,...f.tailIds].includes(row.event_id)));
  f.canonicalSaveId=f.canonicalEvents.at(-1).event_id;
  for(const copy of f.copies){const stored=rows(f,'private_content').find(row=>row.content_id===copy.content_id);assert.equal(stored.owner_id,owner);assert.equal(stored.kind,'guest-image-stage-history');assert.notEqual(stored.content,'');assert.ok(stored.expires_at>f.prepared.expiresAt);}
  f.retire=(input={sessionId:f.session.sessionId},env=f.env)=>retireExpiredClaimedGuestImageStage(env,input);
  f.retireSource=()=>retireExpiredGuestImageSource(f.env,{sessionId:f.session.sessionId});
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);return f;
}
async function due(f){const start=performance.now();while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).due){assert.ok(performance.now()-start<10000,'original native database expiry');await delay(10);}}
function onlyTailChanges(f,before){
  const after=snapshot(f);assert.deepEqual(after.schema,before.schema);
  for(const [table,prior]of Object.entries(before.contents)){
    if(table!=='event_private_payloads')assert.deepEqual(after.contents[table],prior,table);
    else{assert.equal(after.contents[table].length,prior.length);for(const current of after.contents[table]){const old=prior.find(row=>row.private_event_id===current.private_event_id);assert.ok(old);
      if(f.tailIds.includes(current.private_event_id))assert.deepEqual({...current,private_json:old.private_json,redacted_at:old.redacted_at},{...old});else assert.deepEqual(current,old);}}
  }
}
function assertRetired(f,result,{replayed}={}){
  assert.deepEqual(Object.keys(result).sort(),['status','scope','sessionId','documentId','stageState','stageHead','tails','replayed'].sort());
  assert.equal(result.status,'retired');assert.equal(result.scope,'claimed-original-image-stage-private-bodies');assert.equal(result.sessionId,f.session.sessionId);
  assert.equal(result.documentId,f.session.documentId);assert.equal(result.stageState,f.state);assert.equal(result.stageHead,f.committed.head+f.tailIds.length);
  assert.ok(Object.isFrozen(result));assert.deepEqual(result.tails.map(row=>row.eventId),f.tailIds);if(replayed!==undefined)assert.equal(result.replayed,replayed);
  for(const tail of result.tails){assert.deepEqual(Object.keys(tail).sort(),['eventId','redactedAt','replayed'].sort());assert.ok(canonicalTime(tail.redactedAt));assert.equal(typeof tail.replayed,'boolean');assert.equal(body(f,tail.eventId).private_json,'');assert.equal(body(f,tail.eventId).redacted_at,tail.redactedAt);}
  for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'private_json','SELECT'])assert.equal(JSON.stringify(result).includes(secret),false);
}
function sourceErased(f){const draft=rows(f,'private_content').find(row=>row.content_id===f.prepared.plan.draftId);assert.equal(draft.content,'');assert.ok(canonicalTime(draft.redacted_at));for(const id of f.committed.eventIds){assert.equal(body(f,id).private_json,'');assert.ok(canonicalTime(body(f,id).redacted_at));}}
function canonicalCopies(f){const ids=new Set(f.canonicalEvents.map(row=>row.event_id));return {
  events:rows(f,'events').filter(row=>row.stream_id===`creative:${owner}`),bodies:rows(f,'event_private_payloads').filter(row=>ids.has(row.private_event_id)),
  commands:rows(f,'output_commands').filter(row=>row.actor_user_id===owner),receipts:rows(f,'event_client_receipts').filter(row=>row.stream_id===`creative:${owner}`),
  content:rows(f,'private_content').filter(row=>row.owner_id===owner),adoption:rows(f,'experience_guest_context_adoptions'),save:rows(f,'experience_guest_image_claims'),
  stages:rows(f,'experience_guest_image_stage_custodies'),copies:rows(f,'experience_guest_image_stage_copies'),plans:rows(f,'experience_guest_plan_custodies'),
};}
function noQuoteConstruction(f){let calls=0;for(const name of ['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_IMAGE_MODEL','FAL_KEY','FAL_IMAGE_MODEL'])Object.defineProperty(f.env,name,{configurable:true,get(){calls++;throw Error('cleanup cannot inspect provider configuration');}});return()=>assert.equal(calls,0);}
function nativeHold(f){
  insert(f,'budget_reservations',{reservation_id:'retained-claimed-stage-tokens',owner_id:payer,stream_id:'creative:foreign',correlation_id:'foreign-job',operation:'image',period:'2026-09',reserved_tokens:100,used_tokens:3,status:'active',created_at:time,updated_at:time});
  insert(f,'cost_budget_reservations',{reservation_id:'retained-claimed-stage-cost',owner_id:payer,workspace_id:'forma',stream_id:'creative:foreign',correlation_id:'foreign-job',operation:'image',period:'2026-09',reserved_microusd:1234,used_microusd:4,status:'executing',created_at:time,updated_at:time});
}
async function denied(f){const before=snapshot(f);await assert.rejects(f.retire());assert.deepEqual(snapshot(f),before);}
function mutationHook(f,predicate,action){
  const prepare=f.DB.prepare;let hits=0;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...bindings){const bound=bind.apply(this,bindings),execute=bound.execute;
      bound.execute=function(kind){if(!hits&&predicate(sql)){hits++;action();}return execute.call(this,kind);};return bound;};return statement;};
  return()=>{f.DB.prepare=prepare;assert.equal(hits,1,'actual native mutation seam reached');};
}
function corruptImmutable(f,table,sql,...bindings){
  const triggers=f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").all(table);
  assert.throws(()=>f.sqlite.prepare(sql).run(...bindings),/immutable|append.only/u,'native writer history rejects the adverse rewrite');
  // Negative-only storage corruption after a genuine completed claim. Restore
  // the complete schema so refusal must inspect the contradictory original row.
  for(const trigger of triggers)f.sqlite.exec(`DROP TRIGGER "${trigger.name}"`);
  try{f.sqlite.prepare(sql).run(...bindings);}finally{for(const trigger of triggers)f.sqlite.exec(trigger.sql);}
}

for(const state of states)for(const order of ['source-first','tail-first'])test(`native ${state} ${order} cleanup preserves canonical private history and original payer receipts`,async t=>{
  const f=await claimedFixture(t,state,{memory:order==='source-first'});nativeHold(f);const canonicalBefore=canonicalCopies(f);await due(f);
  const noQuote=noQuoteConstruction(f);if(order==='source-first'){await f.retireSource();sourceErased(f);}
  const before=snapshot(f),result=await f.retire();assertRetired(f,result,{replayed:false});onlyTailChanges(f,before);noQuote();
  assert.ok(result.tails.every(row=>!row.replayed&&row.redactedAt>=f.prepared.expiresAt));assert.deepEqual(canonicalCopies(f),canonicalBefore);
  if(order==='tail-first'){for(const id of f.committed.eventIds)assert.notEqual(body(f,id).private_json,'');await f.retireSource();sourceErased(f);}
  const retired=snapshot(f),count=changes(f),replay=await f.retire();assertRetired(f,replay,{replayed:true});assert.ok(replay.tails.every(row=>row.replayed));
  assert.deepEqual(replay.tails.map(row=>row.redactedAt),result.tails.map(row=>row.redactedAt));assert.deepEqual(snapshot(f),retired);assert.equal(changes(f),count);
  assert.deepEqual(canonicalCopies(f),canonicalBefore);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,state==='confirmed'?2:3);assert.equal(rows(f,'output_preflights').length,state==='quoted'?1:0);noQuote();
});
test('native claimed source must reach its original database deadline before tail retirement',async t=>{
  const f=await claimedFixture(t,'confirmed',{draftLifetimeMs:60000});t.mock.method(Date,'now',()=>8_000_000_000_000);await denied(f);
});
for(const state of states){
  const roles=state==='quoted'?['save','confirmation','quote']:['save','confirmation'];
  for(let mask=0;mask<2**roles.length;mask++){
    const partial=roles.filter((_,index)=>mask&(1<<index));
    test(`native ${state} complete tombstone subset ${partial.join('+')||'none'} preserves prior timestamps`,async t=>{
      const f=await claimedFixture(t,state);await due(f);const when=stamp(f),ids=partial.map(role=>({save:f.saved.eventId,confirmation:f.confirmed.eventId,quote:f.quoted?.eventId})[role]);
      for(const id of ids)f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(when,id);
      const before=snapshot(f),count=changes(f),result=await f.retire();assertRetired(f,result,{replayed:partial.length>0});onlyTailChanges(f,before);
      for(const tail of result.tails){assert.equal(tail.replayed,ids.includes(tail.eventId));if(ids.includes(tail.eventId))assert.equal(tail.redactedAt,when);}
      if(partial.length===roles.length)assert.equal(changes(f),count,'fully retired native stage is read-only');
    });
  }
}
for(const lost of ['lost','sparse'])test(`native ${lost} cleanup acknowledgement is recovered by exact read without a second mutation`,async t=>{
  const f=await claimedFixture(t);await due(f);const before=snapshot(f),done=batchHook(f,retirement,result=>{if(lost==='lost')throw Error('fixture lost cleanup acknowledgement');const copy=[...result];delete copy[0];return copy;});
  let result;try{result=await f.retire();}finally{done();}assertRetired(f,result,{replayed:true});assert.ok(result.tails.every(row=>row.replayed));onlyTailChanges(f,before);
});
test('native canonical prefix, SAVE and private-history tombstones do not postpone original guest cleanup',async t=>{
  const f=await claimedFixture(t);await due(f);await f.retireSource();sourceErased(f);const when=stamp(f);
  for(const event of f.canonicalEvents)f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(when,event.event_id);
  for(const copy of f.copies)f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(when,copy.content_id);
  const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanges(f,before);
});

async function governCanonicalProject(f){
  const workspace=(path,value)=>handleWorkspaces(new Request(`${origin}/api/workspaces/${path.join('/')}`,{method:'POST',headers:canonicalHeaders(value?{'content-type':'application/json'}:{}),...(value?{body:JSON.stringify(value)}:{})}),f.env,path);
  const created=await workspace([],{name:'Claimed stage canonical workspace'}),createdBody=await created.json();assert.equal(created.status,201,JSON.stringify(createdBody));const {organizationId}=createdBody;
  const attached=await workspace([organizationId,'projects'],{projectId:f.session.projectId}),attachedBody=await attached.json();assert.equal(attached.status,201,JSON.stringify(attachedBody));const {projectAccessId}=attachedBody;
  const opened=await workspace([organizationId,'projects',projectAccessId,'context']);assert.equal(opened.status,200,await opened.clone().text());const cookie=opened.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const refreshed=await handleEvents(new Request(`${origin}/api/events`,{headers:canonicalHeaders({cookie})}),f.env);assert.equal(refreshed.status,200,await refreshed.clone().text());
  const output=async value=>{const base='/api/output-requirements',path=value?base:`${base}?documentId=${encodeURIComponent(f.session.documentId)}`,response=await handleOutputRequirements(new Request(`${origin}${path}`,{method:value?'POST':'GET',headers:canonicalHeaders({cookie,...(value?{'content-type':'application/json'}:{})}),...(value?{body:JSON.stringify(value)}:{})}),f.env,base,{waitUntil(){assert.fail('unexpected background/provider work');}}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const initial=await output(),spec=structuredClone(initial.requirements.find(row=>row.blockId===f.saved.requirementId).spec);spec.label='Governed canonical stage Image';
  await output({action:'save',documentId:f.session.documentId,blockId:f.saved.requirementId,spec,clientMutationId:'governed-canonical-stage-save',expectedRevision:initial.revision});const saved=await output();
  await output({action:'confirm',documentId:f.session.documentId,clientMutationId:'governed-canonical-stage-confirm',expectedRevision:saved.revision});
  const plan=rows(f,'output_plan_revisions').find(row=>row.scope_key===`project:${organizationId}:${projectAccessId}`);assert.ok(plan);assert.equal(plan.owner_user_id,owner);assert.equal(plan.document_id,f.session.documentId);assert.equal(plan.project_id,f.session.projectId);
  assert.equal(plan.scope_kind,'project');assert.equal(plan.organization_id,organizationId);assert.equal(plan.project_access_id,projectAccessId);assert.equal([...f.committed.eventIds,...f.tailIds].includes(plan.confirmed_event_id),false);
  return plan;
}
test('actual governed destination Project SAVE and confirm preserve due original stage cleanup',async t=>{
  const f=await claimedFixture(t),plan=await governCanonicalProject(f);await due(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanges(f,before);
  assert.deepEqual(rows(f,'output_plan_revisions').find(row=>row.plan_revision_id===plan.plan_revision_id),plan);
});
test('native canonical prefix and SAVE scope tuples reject each contradictory enrollment field',async t=>{
  const f=await claimedFixture(t);await governCanonicalProject(f);await due(f);const checked=[];
  const targets=[f.canonicalEvents.find(event=>event.type==='DocumentCreated'),f.canonicalEvents.at(-1)];
  for(const event of targets){
    assert.ok(event);const original=f.sqlite.prepare('SELECT * FROM project_event_scopes WHERE event_id=?').get(event.event_id);assert.ok(original,'native governed import created the scope');
    const mutations=[['owner_user_id',other],['actor_user_id',other],['project_id','contradictory-project'],['organization_id','contradictory-org'],
      ['project_access_id','contradictory-access'],['source_stream_id',`creative:${other}`],['source_sequence',event.sequence+1],['project_sequence',0],
      ['created_at',new Date(Date.parse(event.recorded_at)-1).toISOString()],['created_at',new Date(Date.parse(stamp(f))+60000).toISOString()],['created_at','invalid-native-time']];
    for(const [column,value]of mutations){
      f.sqlite.prepare(`UPDATE project_event_scopes SET ${column}=? WHERE event_id=?`).run(value,event.event_id);
      await denied(f);f.sqlite.prepare(`UPDATE project_event_scopes SET ${column}=? WHERE event_id=?`).run(original[column],event.event_id);
      assert.deepEqual(f.sqlite.prepare('SELECT * FROM project_event_scopes WHERE event_id=?').get(event.event_id),original);checked.push(`${event.type}:${column}`);
    }
  }
  assert.equal(checked.length,22);t.diagnostic(JSON.stringify({refusedNativeScopeContradictions:checked}));
  const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanges(f,before);
});
test('foreign destination in a real completed SAVE mapping refuses every original-tail mutation',async t=>{
  const f=await claimedFixture(t);corruptImmutable(f,'experience_guest_image_claims','UPDATE experience_guest_image_claims SET destination_user_id=? WHERE session_id=?',other,f.session.sessionId);await due(f);await denied(f);
});
test('foreign Project scope directly attached to an original confirmation refuses cleanup',async t=>{
  const f=await claimedFixture(t);insert(f,'project_event_scopes',{event_id:f.confirmed.eventId,project_access_id:'foreign-access',organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:other,source_stream_id:`creative:${f.session.guestSubject}`,source_sequence:f.committed.head+2,project_sequence:1,actor_user_id:other,created_at:time});
  await due(f);await denied(f);
});
test('foreign Project scope attached to the canonical SAVE refuses original-tail cleanup',async t=>{
  const f=await claimedFixture(t);await due(f);const canonical=f.canonicalEvents.at(-1);
  insert(f,'project_event_scopes',{event_id:canonical.event_id,project_access_id:'foreign-canonical-access',organization_id:'foreign-canonical-org',project_id:'foreign-canonical-project',owner_user_id:other,source_stream_id:`creative:${owner}`,source_sequence:canonical.sequence,project_sequence:1,actor_user_id:other,created_at:time});
  await denied(f);
});
test('late canonical SAVE scope drift rolls back every original-tail tombstone',async t=>{
  const f=await claimedFixture(t);await due(f);const before=snapshot(f),canonical=f.canonicalEvents.at(-1);
  const done=mutationHook(f,sql=>/^\s*UPDATE event_private_payloads\b/u.test(sql),()=>{
    insert(f,'project_event_scopes',{event_id:canonical.event_id,project_access_id:'late-foreign-access',organization_id:'late-foreign-org',project_id:'late-foreign-project',owner_user_id:other,source_stream_id:`creative:${owner}`,source_sequence:canonical.sequence,project_sequence:1,actor_user_id:other,created_at:time});
  });
  try{await assert.rejects(f.retire());}finally{done();}assert.deepEqual(snapshot(f),before);
});
test('late original confirmation command drift rolls back the entire native cleanup batch',async t=>{
  const f=await claimedFixture(t);await due(f);const before=snapshot(f),done=mutationHook(f,sql=>/^\s*UPDATE event_private_payloads\b/u.test(sql),()=>{
    f.sqlite.prepare("UPDATE output_commands SET request_digest='changed-during-cleanup' WHERE actor_user_id=? AND action='confirm'").run(f.session.guestSubject);
  });
  try{await assert.rejects(f.retire());}finally{done();}assert.deepEqual(snapshot(f),before);
});
test('external quote-index drift is preserved while stale original-tail cleanup refuses',async t=>{
  const f=await claimedFixture(t);await due(f);let changed;
  const done=batchHook(f,retirement,()=>{f.sqlite.prepare("UPDATE output_preflights SET terms_digest='external-quote-change' WHERE actor_user_id=?").run(f.session.guestSubject);changed=snapshot(f);},{after:false});
  try{await assert.rejects(f.retire());}finally{done();}assert.deepEqual(snapshot(f),changed);
});
