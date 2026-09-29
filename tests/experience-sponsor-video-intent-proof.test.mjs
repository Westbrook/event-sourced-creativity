import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {promiseHooks} from 'node:v8';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture,snapshot,noWrites,assertUnpaid,alterQuote,actor,post,imports} from './sponsor-video-native-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';
const [{readSponsorVideoIntentProof,requireSponsorVideoIntentProof},
  {loadOutputTrustedContext},{experienceOutputBinding,experienceOutputCommandKey,experienceOutputEnvelope,experienceOutputAuthorization},
  {scenePreparationCyclePrefix},{digest},{inheritRuntimeSchemaReadiness},{handleExperienceOutput},{outputDocumentExecutionBridge},{readExperienceOutputLineage}]=await Promise.all([
  import('../worker/experience-sponsor-video-intent-proof.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/experience-output-binding.ts'),import('../worker/experience-scene-renewal.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/runtime.ts'),import('../worker/experience-output-api.ts'),
  import('../worker/output-document-execution.ts'),import('../worker/experience-output-originals.ts'),
]);
after(()=>imports.deregister());
const denied=/sponsor_|experience_|output_|body_|content_type/u;
const evidenceDirectory='/private/tmp/forma-sponsored-video-intent-evidence-20260917';
const intentUrl=f=>`http://localhost/api/experiences/drafts/${f.plan.draftId}/output/authorize`;
const intentBody=f=>({draftHash:f.plan.draftHash,termsDigest:f.terms.termsDigest,maximumMicrousd:f.terms.maximumMicrousd,explicitAuthorization:true});
const makeRequest=(f,{body=intentBody(f),url=intentUrl(f),method='POST',headers={},raw,signal}={})=>new Request(url,{
  ...post(body),method,headers:{'content-type':'application/json',origin:'http://localhost','sec-fetch-site':'same-origin',...headers},
  ...(method==='GET'||method==='HEAD'?{body:undefined}:raw===undefined?{}:{body:raw}),...(signal?{signal}:{}),
});
async function intentFixture(t,options={}){
  const f=await fixture(t,options);f.body=intentBody(f);f.request=makeRequest(f);
  // Actual ordinary context acquisition happens before the dormant collector.
  // The request expresses intent; no Authorize/Run handler is invoked.
  f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
  f.binding=await experienceOutputBinding(f.plan);
  f.expectedEnvelope=await experienceOutputEnvelope(f.binding,'authorize',f.trusted.ownerHead,
    {...experienceOutputAuthorization(f.body,f.terms),preflightId:f.terms.id});
  f.commands=Object.fromEntries(f.sqlite.prepare('SELECT * FROM output_commands WHERE scope_key=? AND actor_user_id=?').all(f.trusted.scope.key,actor).map(row=>[row.action,row]));
  assert.deepEqual(Object.keys(f.commands).sort(),['confirm','preflight','save']);assertUnpaid(f);return f;
}
const requireProof=(witness,f,candidate)=>requireSponsorVideoIntentProof(witness,f.trusted,candidate);
const assertOriginalRead=(f,start)=>assert.deepEqual(f.io.media.slice(start),['head','head','get','head']);
const isFinalNativeProof=statements=>statements.some(statement=>statement.sql.includes('captured WHERE terms_digest=? AND expires_at=? AND private_json=?'));
const afterMicrotasks=(count,callback)=>{const next=left=>queueMicrotask(()=>left===1?callback():next(left-1));next(count);};
function commandCopy(f,key,action='confirm'){
  f.sqlite.prepare('INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at) SELECT scope_key,actor_user_id,?,request_digest,?,event_id,created_at FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?')
    .run(key,action,f.trusted.scope.key,actor,f.commands.confirm.command_key);
}

test('Video actor-intent selected preflight command cannot name a different plan even with its real envelope digest recomputed',async t=>{
  const f=await intentFixture(t),row=f.commands.preflight;
  const stored=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(row.event_id);
  const body=JSON.parse(stored.private_json);assert.equal(body.output_command_envelope.planRevisionId,f.terms.planRevisionId);
  body.output_command_envelope.planRevisionId='foreign-confirmed-plan';
  const requestDigest=(await digest(body.output_command_envelope)).slice(7);
  f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),row.event_id);
  f.sqlite.prepare('UPDATE output_commands SET request_digest=? WHERE command_key=?').run(requestDigest,row.command_key);
  const before=snapshot(f),assertReadOnly=noWrites(f);
  await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent genuine unpaid renewal refuses a corrupted predecessor native operation identity',{timeout:30000},async t=>{
  // Both receipts are produced by real native preparation. The first is created
  // close to, but before, its genuine expiry; no durable receipt time is forged.
  const RealDate=Date,offset=14*60000+50000;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()-offset]));}static now(){return RealDate.now()-offset;}};
  let f;try{f=await intentFixture(t);}finally{globalThis.Date=RealDate;}
  const predecessor=f.terms,expiry=Date.parse(predecessor.targets[0].settings.original.expiresAt);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry-Date.now()+25)));
  const response=await handleExperienceOutput(new Request(intentUrl(f).replace('/authorize','/prepare'),post({draftHash:f.plan.draftHash,
    explicitRequirementsConfirmation:true,renewal:{predecessorPreflightId:predecessor.id,explicitRenewal:true}})),f.env,f.executionContext,outputDocumentExecutionBridge);
  assert.equal(response.status,200,await response.clone().text());const ready=await response.json();assert.notEqual(ready.preflight.id,predecessor.id);
  const row=f.sqlite.prepare('SELECT body.private_json FROM output_preflights p JOIN event_private_payloads body ON body.private_event_id=p.event_id WHERE p.preflight_id=?').get(ready.preflight.id);
  f.terms=JSON.parse(row.private_json).preflight;f.body=intentBody(f);f.request=makeRequest(f);
  f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
  const lineage=await readExperienceOutputLineage(f.trusted,f.binding);assert.ok(lineage.binding.preparationCycle);
  const childEnvelope=await experienceOutputEnvelope(lineage.binding,'authorize',f.trusted.ownerHead,{...experienceOutputAuthorization(f.body,f.terms),preflightId:f.terms.id});
  const witness=await readSponsorVideoIntentProof(f.trusted);assert.deepEqual((await requireProof(witness,f)).envelope,childEnvelope);
  assert.notEqual(childEnvelope.clientMutationId,f.expectedEnvelope.clientMutationId);assertUnpaid(f);
  const wrongId='video-'+'f'.repeat(64);assert.notEqual(predecessor.targets[0].settings.original.requestId,wrongId);
  await alterQuote(f,quote=>{quote.targets[0].settings.original.requestId=wrongId;});
  f.request=makeRequest(f);f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
  const before=snapshot(f),assertReadOnly=noWrites(f);await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

for(const frame of ['landscape','portrait'])test(`Video actor-intent ${frame} joins genuine POST, native envelope, original source and unpaid absence under strict SQL`,async t=>{
  const f=await intentFixture(t,{frame}),before=snapshot(f),start=f.io.media.length,bytes=f.io.bytesRead;
  const limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>limits.restore());const assertReadOnly=noWrites(f);
  const witness=await readSponsorVideoIntentProof(f.trusted),evidence=await requireProof(witness,f,f.expectedEnvelope);
  assert.deepEqual(Object.keys(witness),[]);assert.ok(Object.isFrozen(witness));assert.ok(Object.isFrozen(evidence));
  assert.deepEqual(evidence.requestBody,f.body);assert.deepEqual(evidence.envelope,f.expectedEnvelope);
  assert.equal(evidence.envelope.clientMutationId,await experienceOutputCommandKey(f.binding,'authorize'));
  assert.equal(evidence.envelopeDigest,await digest(f.expectedEnvelope));assert.equal(evidence.native.actorUserId,actor);
  assert.deepEqual(evidence.native.orderedAssetDigests,[`sha256:${f.reference.sha256}`]);assert.equal(evidence.native.recipe.maximumTokens,152000);
  assert.ok(evidence.expiresAtMs>Date.now());assert.ok(evidence.expiresAtMs<=Date.parse(f.terms.expiresAt));
  assertOriginalRead(f,start);assert.equal(f.io.bytesRead-bytes,f.bytes.length);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);limits.assertVerified();
  t.diagnostic(JSON.stringify({qualification:'ordinary context and synthetic native Video actor-intent only',strictSqlForms:limits.records.length,
    maximumBindings:Math.max(...limits.boundCounts),maximumSqlBytes:Math.max(...limits.records.map(row=>Buffer.byteLength(row.sql))),
    sourceHeads:3,sourceGets:1,sourceBytes:f.io.bytesRead-bytes,providerCalls:0,financialAdmission:false}));
});

test('Video actor-intent refuses missing or changed deliberate consent and malformed Request bodies',async t=>{
  const changes=[body=>delete body.explicitAuthorization,body=>body.explicitAuthorization=false,body=>body.explicitAuthorization='true',
    body=>body.maximumMicrousd++,body=>body.termsDigest='f'.repeat(64),body=>body.draftHash='sha256:'+'f'.repeat(64),
    body=>body.payerUserId='claimed-sponsor',body=>body.clientMutationId='invented-key',body=>body.audioCostConsent={explicitAuthorization:true},body=>body.sceneCostConsent={explicitAuthorization:true}];
  for(const change of changes){const f=await intentFixture(t),body=structuredClone(f.body);change(body);f.trusted.request=makeRequest(f,{body});
    const before=snapshot(f),assertReadOnly=noWrites(f);await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);
    assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);}
  for(const raw of ['{','null','[]',' '.repeat(32769)]){const f=await intentFixture(t);f.trusted.request=makeRequest(f,{raw});
    const before=snapshot(f),assertReadOnly=noWrites(f);await assert.rejects(readSponsorVideoIntentProof(f.trusted));
    assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);}
});

test('Video actor-intent prepared paidMediaConfirmed never substitutes for deliberate Request consent',async t=>{
  for(const mode of ['missing','false']){const f=await intentFixture(t);assert.equal(f.terms.targets[0].settings.payload.paidMediaConfirmed,true);
    const body=structuredClone(f.body);if(mode==='missing')delete body.explicitAuthorization;else body.explicitAuthorization=false;
    f.trusted.request=makeRequest(f,{body});const before=snapshot(f),assertReadOnly=noWrites(f),start=f.io.media.length;
    await assert.rejects(readSponsorVideoIntentProof(f.trusted),/sponsor_video_intent_approval_required/);
    assert.equal(f.io.media.length,start);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

test('Video actor-intent held witness expires at the original Video preparation deadline even when retained quote expiry is later',async t=>{
  const f=await intentFixture(t),originalExpiry=Date.parse(f.terms.targets[0].settings.original.expiresAt);
  await alterQuote(f,quote=>{quote.expiresAt=new Date(originalExpiry+60000).toISOString();});
  const row=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(f.commands.preflight.event_id);
  f.terms=JSON.parse(row.private_json).preflight;f.body=intentBody(f);f.request=makeRequest(f);
  f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
  const clock=Date.now;let now=originalExpiry-20000;Date.now=()=>now;
  const before=snapshot(f),assertReadOnly=noWrites(f);
  try{
    const witness=await readSponsorVideoIntentProof(f.trusted),evidence=await requireProof(witness,f);
    assert.equal(evidence.expiresAtMs,originalExpiry);assert.ok(Date.parse(f.terms.expiresAt)>originalExpiry);
    now=originalExpiry;await assert.rejects(async()=>requireProof(witness,f),/sponsor_video_intent_expired/);
  }finally{Date.now=clock;}
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent known local active-context deadline bounds witness use even when absent from sourceAssertions',async t=>{
  const f=await intentFixture(t),deadline=Date.now()+20000;
  // Contract case: inject a known deadline into the already trusted local
  // context. This does not claim the unchanged fixture sourced it from D1.
  const fact=f.trusted.context.snapshot.facts.find(value=>value.active!==false&&typeof value.properties.text==='string');assert.ok(fact);
  fact.properties.rights_expires_at=new Date(deadline).toISOString();
  assert.ok(f.trusted.sourceAssertions.every(assertion=>assertion.deadlineMs!==deadline));
  const before=snapshot(f),assertReadOnly=noWrites(f),witness=await readSponsorVideoIntentProof(f.trusted),evidence=await requireProof(witness,f);
  assert.equal(evidence.expiresAtMs,deadline);
  const clock=Date.now;Date.now=()=>deadline;
  try{await assert.rejects(async()=>requireProof(witness,f),/sponsor_video_intent_expired/);}finally{Date.now=clock;}
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent consumed Request body is rejected before any collector SQL or media read',async t=>{
  const f=await intentFixture(t);await f.trusted.request.text();assert.equal(f.trusted.request.bodyUsed,true);
  const before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f),prepare=f.DB.prepare.bind(f.DB);let reads=0;
  f.DB.prepare=sql=>{reads++;return prepare(sql);};
  await assert.rejects(readSponsorVideoIntentProof(f.trusted),/sponsor_video_intent_request_invalid/);
  assert.equal(reads,0);assert.equal(f.io.media.length,start);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent aborting a stalled Request body cancels its reader before any DB or original-image read',async t=>{
  const f=await intentFixture(t),controller=new AbortController();let startedResolve,cancelled=0;
  const started=new Promise(resolve=>{startedResolve=resolve;}),body=new ReadableStream({pull(){startedResolve();},cancel(){cancelled++;}},{highWaterMark:0});
  f.trusted.request=new Request(intentUrl(f),{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body,duplex:'half',signal:controller.signal});
  const before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f),prepare=f.DB.prepare.bind(f.DB);let reads=0;
  f.DB.prepare=sql=>{reads++;return prepare(sql);};
  const pending=readSponsorVideoIntentProof(f.trusted);await started;controller.abort(new Error('synthetic-stalled-intent-body'));
  await assert.rejects(pending,/sponsor_video_intent_|body_cancelled/);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,1);assert.equal(body.locked,false);assert.equal(reads,0);assert.equal(f.io.media.length,start);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent retirement at an owned preparation await prevents the next owned principal read',async t=>{
  for(const mode of ['abort','source','request-header']){const f=await intentFixture(t),controller=new AbortController();f.trusted.request=makeRequest(f,{signal:controller.signal});
    const before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f),prepare=f.DB.prepare.bind(f.DB),trace=[];let reached=false;
    f.DB.prepare=sql=>{trace.push(sql);const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{
      const bound=bind(...values),first=bound.first.bind(bound);bound.first=async()=>{const result=await first();
        if(sql.startsWith('SELECT 1 AS sponsored FROM private_content')){reached=true;
          if(mode==='abort')controller.abort(new Error('synthetic-preparation-boundary'));
          else if(mode==='source')f.trusted.context.snapshot.facts.find(value=>typeof value.properties.text==='string').properties.text+=' changed';
          else f.trusted.request.headers.set('origin','https://changed.invalid');
        }return result;};return bound;};return statement;};
    await assert.rejects(readSponsorVideoIntentProof(f.trusted),/sponsor_video_intent_/);
    assert.equal(reached,true);assert.equal(trace.some(sql=>sql.includes('FROM (SELECT * FROM users WHERE user_id=?) principal')),false);
    assert.equal(f.io.media.length,start);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

for(const mode of ['source','request','headers','database'])test(`Video actor-intent public settlement retains original ${mode} currentness across the native handoff`,async t=>{
  const f=await intentFixture(t),before=snapshot(f),assertReadOnly=noWrites(f),batch=f.DB.batch.bind(f.DB);let operation,settled=false,reached=false,settledBeforeMutation;
  const stop=promiseHooks.createHook({settled(promise){if(promise===operation)settled=true;}});t.after(stop);
  f.DB.batch=async statements=>{const rows=await batch(statements);if(isFinalNativeProof(statements))afterMicrotasks(7,()=>{
    reached=true;settledBeforeMutation=settled;
    if(mode==='source')f.trusted.context.snapshot.facts.find(value=>typeof value.properties.text==='string').properties.text+=' changed';
    else if(mode==='request')f.trusted.request=makeRequest(f);else if(mode==='headers')f.trusted.request.headers.set('origin','https://changed.invalid');
    else f.env.DB={...f.env.DB};
  });return rows;};
  operation=readSponsorVideoIntentProof(f.trusted);const outcome=await operation.then(value=>({value}),error=>({error}));
  assert.equal(reached,true);assert.equal(settledBeforeMutation,false,'The hook measures actual public Promise settlement, not a later observer');
  assert.ok(outcome.error,'Changed original caller state must not yield an intent witness');assert.match(outcome.error.message,/sponsor_video_intent_/);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent source change after actual public settlement retires later witness use without changing the settled promise',async t=>{
  const f=await intentFixture(t),before=snapshot(f),assertReadOnly=noWrites(f);let operation,reached=false;
  const stop=promiseHooks.createHook({settled(promise){if(promise===operation)queueMicrotask(()=>{
    reached=true;f.trusted.context.snapshot.facts.find(value=>typeof value.properties.text==='string').properties.text+=' changed after settlement';
  });}});t.after(stop);
  operation=readSponsorVideoIntentProof(f.trusted);const witness=await operation;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reached,true);assert.deepEqual(Object.keys(witness),[]);await assert.rejects(async()=>requireProof(witness,f),/sponsor_video_intent_changed/);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent rejects wrong action, draft, URL grammar, method and cross-origin transport',async t=>{
  const changes=[f=>({url:intentUrl(f).replace('/authorize','/run')}),f=>({url:intentUrl(f).replace(f.plan.draftId,'experience-draft-'+'f'.repeat(64))}),
    f=>({url:intentUrl(f)+'?duplicate=1'}),f=>({url:intentUrl(f)+'/'}),()=>({url:'http://localhost/api/output-requirements'}),()=>({method:'GET'}),()=>({method:'PATCH'}),
    ()=>({headers:{origin:'https://foreign.invalid'}}),()=>({headers:{'sec-fetch-site':'cross-site'}}),()=>({headers:{'content-type':'text/plain'}})];
  for(const change of changes){const f=await intentFixture(t);f.trusted.request=makeRequest(f,change(f));const before=snapshot(f),assertReadOnly=noWrites(f);
    await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);}
});

test('Video actor-intent witness is opaque and bound to the exact trusted object, Request and full native envelope',async t=>{
  const f=await intentFixture(t),before=snapshot(f),assertReadOnly=noWrites(f),witness=await readSponsorVideoIntentProof(f.trusted);
  for(const fake of [{},structuredClone(witness),{...witness},null])await assert.rejects(async()=>requireProof(fake,f),denied);
  await assert.rejects(async()=>requireSponsorVideoIntentProof(witness,{...f.trusted}),denied);
  for(const change of [value=>value.explicitAuthorization=false,value=>value.maximumMicrousd++,value=>value.preflightId='other',
    value=>value.expectedRevision='output:0',value=>value.clientMutationId='invented',value=>value.experienceBinding.requestHash='sha256:'+'f'.repeat(64),
    value=>delete value.experienceBinding,value=>value.extra=true]){const candidate=structuredClone(f.expectedEnvelope);change(candidate);await assert.rejects(async()=>requireProof(witness,f,candidate),denied);}
  const exact=f.trusted.request;f.trusted.request=makeRequest(f);await assert.rejects(async()=>requireProof(witness,f),denied);f.trusted.request=exact;
  assert.deepEqual((await requireProof(witness,f)).envelope,f.expectedEnvelope);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent refuses changed canonical principal or unsupported ownership before evidence is returned',async t=>{
  const changes=[f=>f.trusted.scope.ownerUserId='foreign',f=>f.trusted.scope.contextId='context',f=>f.trusted.principal.fictional=true,
    f=>f.trusted.principal.billingUserId='foreign',f=>f.sqlite.prepare('UPDATE users SET consent_version=0 WHERE user_id=?').run(actor),
    f=>f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(actor),
    f=>f.trusted.request=makeRequest(f,{headers:{'oai-authenticated-user-id':'foreign','oai-authenticated-user-email':'foreign@example.invalid'}})];
  for(const change of changes){const f=await intentFixture(t);change(f);const before=snapshot(f),assertReadOnly=noWrites(f);
    await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);}
});

test('Video actor-intent rejects missing, damaged and orphaned stage indexes without admitting work',async t=>{
  const changes=[f=>f.sqlite.prepare('DELETE FROM output_commands WHERE command_key=?').run(f.commands.preflight.command_key),
    f=>f.sqlite.prepare('DELETE FROM output_commands WHERE command_key=?').run(f.commands.confirm.command_key),
    f=>f.sqlite.prepare('UPDATE output_commands SET request_digest=? WHERE command_key=?').run('f'.repeat(64),f.commands.save.command_key),
    f=>f.sqlite.prepare("UPDATE output_commands SET action='run' WHERE command_key=?").run(f.commands.preflight.command_key),
    f=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(f.commands.confirm.event_id),
    f=>commandCopy(f,scenePreparationCyclePrefix(f.plan.draftId,'video')+'f'.repeat(64)+':confirm'),
    f=>commandCopy(f,f.expectedEnvelope.clientMutationId.replace(':authorize',':unknown')),
    f=>commandCopy(f,f.expectedEnvelope.clientMutationId,'authorize'),f=>commandCopy(f,'late-video-authorize','authorize')];
  for(const change of changes){const f=await intentFixture(t);change(f);const before=snapshot(f),assertReadOnly=noWrites(f);
    await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);}
});

test('Video actor-intent final joint proof refuses late receipt, exact private bytes, root index and paid-intent absence changes',async t=>{
  const changes=[f=>f.sqlite.prepare('UPDATE output_commands SET request_digest=? WHERE command_key=?').run('f'.repeat(64),f.commands.confirm.command_key),
    f=>f.sqlite.prepare("UPDATE output_commands SET created_at='changed-index-time' WHERE command_key=?").run(f.commands.save.command_key),
    f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json=private_json||' ' WHERE private_event_id=?").run(f.commands.save.event_id),
    f=>f.sqlite.prepare("UPDATE event_private_payloads SET document_id='other' WHERE private_event_id=?").run(f.commands.preflight.event_id),
    f=>f.sqlite.prepare('DELETE FROM output_commands WHERE command_key=?').run(f.commands.confirm.command_key),
    f=>commandCopy(f,scenePreparationCyclePrefix(f.plan.draftId,'video')+'f'.repeat(64)+':confirm'),
    f=>commandCopy(f,f.expectedEnvelope.clientMutationId.replace(':authorize',':unknown')),
    f=>commandCopy(f,'late-video-authorize','authorize')];
  for(const change of changes){const f=await intentFixture(t);let reached=false,afterMutation;f.afterGet=()=>{if(reached)return;reached=true;change(f);afterMutation=snapshot(f);};
    const assertReadOnly=noWrites(f);await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);assert.equal(reached,true);
    assert.deepEqual(snapshot(f),afterMutation);assertReadOnly();assertUnpaid(f);}
});

test('Video actor-intent managed SAVE must name its actual native output block source event',async t=>{
  const f=await intentFixture(t),block=f.trusted.projection.libraryBlocks.find(value=>value.sourceEvents.includes(f.commands.save.event_id));assert.ok(block);
  block.sourceEvents=[f.commands.confirm.event_id];
  const before=snapshot(f),assertReadOnly=noWrites(f),start=f.io.media.length;
  await assert.rejects(readSponsorVideoIntentProof(f.trusted),/sponsor_video_intent_requirement_changed/);
  assert.equal(f.io.media.length,start);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('Video actor-intent final proof binds selected native plan and preflight indexes to their actual events',async t=>{
  const changes=[f=>f.sqlite.prepare('UPDATE output_plan_revisions SET confirmed_event_id=? WHERE plan_revision_id=?').run(f.commands.save.event_id,f.terms.planRevisionId),
    f=>f.sqlite.prepare('UPDATE output_preflights SET event_id=? WHERE preflight_id=?').run(f.commands.confirm.event_id,f.terms.id)];
  for(const change of changes){const f=await intentFixture(t);let reached=false,afterMutation;f.afterGet=()=>{if(reached)return;reached=true;change(f);afterMutation=snapshot(f);};
    const assertReadOnly=noWrites(f);await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);assert.equal(reached,true);
    assert.deepEqual(snapshot(f),afterMutation);assertReadOnly();assertUnpaid(f);}
});

test('Video actor-intent source and Request remain current through read and opaque-witness use',async t=>{
  for(const mode of ['source','request','database','abort']){const f=await intentFixture(t),controller=new AbortController();f.trusted.request=makeRequest(f,{signal:controller.signal});
    const before=snapshot(f),assertReadOnly=noWrites(f),witness=await readSponsorVideoIntentProof(f.trusted);
    if(mode==='source')f.trusted.context.snapshot.facts.find(value=>typeof value.properties.text==='string').properties.text+=' changed';
    else if(mode==='request')f.trusted.request=makeRequest(f);else if(mode==='database')f.env.DB={...f.env.DB};else controller.abort(new Error('intent-retired'));
    await assert.rejects(async()=>requireProof(witness,f),denied);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

test('Video actor-intent already-aborted and during-original-read cancellation issue no admission or writable SQL',async t=>{
  for(const mode of ['before','during-get']){const f=await intentFixture(t),controller=new AbortController();f.trusted.request=makeRequest(f,{signal:controller.signal});
    let reached=false;if(mode==='before')controller.abort(new Error('pre-aborted'));else f.afterGet=()=>{reached=true;controller.abort(new Error('source-read-aborted'));};
    const before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f);
    await assert.rejects(readSponsorVideoIntentProof(f.trusted),/sponsor_|body_|aborted/);if(mode==='before')assert.equal(f.io.media.length,start);else assert.equal(reached,true);
    assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

test('Video actor-intent actual native functions and final proof execute once against local workerd D1',{timeout:120000},async t=>{
  const originalFetch=globalThis.fetch,f=await intentFixture(t),exported=exportSynthetic(f.sqlite);t.mock.restoreAll();let outbound=0;
  t.mock.method(globalThis,'fetch',(...args)=>{const input=args[0],url=new URL(input instanceof Request?input.url:String(input));
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){outbound++;throw Error('network_forbidden');}return originalFetch(...args);});
  const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],
    script:'export default {fetch(){return new Response("synthetic Video actor-intent only")}}',outboundService(){outbound++;throw Error('network_forbidden');}});
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);const trace=[],statements=new WeakMap(),before=await rowsSnapshot(db,exported.tables);
    const capture=(sql,bindings)=>{assert.match(sql,/^\s*SELECT\b/iu);assert.ok(bindings.length<=100);assert.ok(Buffer.byteLength(sql)<=100000);return {sql,bindings};};
    const wrap=(sql,bindings=[])=>{const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
      for(const method of ['first','all','run'])statement[method]=async(...args)=>{trace.push(capture(sql,bindings));return original[method](...args);};
      statements.set(statement,{original,sql,bindings});return statement;};
    const guarded={prepare:sql=>wrap(sql),batch:async items=>{const entries=items.map(item=>statements.get(item));assert.ok(entries.every(Boolean));
      trace.push(...entries.map(({sql,bindings})=>capture(sql,bindings)));return db.batch(entries.map(value=>value.original));}};
    inheritRuntimeSchemaReadiness(f.DB,guarded);f.env.DB=guarded;f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
    const start=f.io.media.length,witness=await readSponsorVideoIntentProof(f.trusted),proof=await requireProof(witness,f,f.expectedEnvelope);
    assert.deepEqual(proof.envelope,f.expectedEnvelope);assertOriginalRead(f,start);assert.deepEqual(await rowsSnapshot(db,exported.tables),before);const positiveStatements=trace.length;
    // A fresh Request/context for the second collector; no prior body or witness
    // is reused as action intent. Withdraw exact retained SAVE bytes mid-read.
    f.request=makeRequest(f);f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
    let changed=false,afterMutation;f.afterGet=async()=>{if(changed)return;changed=true;
      await db.prepare("UPDATE event_private_payloads SET private_json=private_json||' ' WHERE private_event_id=?").bind(f.commands.save.event_id).run();afterMutation=await rowsSnapshot(db,exported.tables);};
    await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);assert.equal(changed,true);assert.deepEqual(await rowsSnapshot(db,exported.tables),afterMutation);
    for(const name of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first()).n,0,name);
    assert.equal(outbound,0);assertUnpaid(f);
    const evidence={engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted actual native functions against local workerd D1',success:true,localOnly:true,
      positiveStatements,totalStatements:trace.length,sqlForms:new Set(trace.map(row=>row.sql)).size,maximumBindings:Math.max(...trace.map(row=>row.bindings.length)),
      maximumSqlBytes:Math.max(...trace.map(row=>Buffer.byteLength(row.sql))),lateExactRetainedBodyMutationRefused:changed,providerCalls:0,outboundCalls:outbound,
      ordinaryAuthorizeRunInvocations:0,financialAdmission:false,finiteSponsoredPrivateIoClaim:false};
    await mkdir(evidenceDirectory,{recursive:true});await writeFile(process.env.FORMA_VIDEO_INTENT_D1_EVIDENCE_PATH??evidenceDirectory+'/native-intent-d1.json',JSON.stringify({evidence,trace},null,2)+'\n');
    t.diagnostic(JSON.stringify(evidence));
  }finally{await mf.dispose();}
});
