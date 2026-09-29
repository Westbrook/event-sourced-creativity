import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {promiseHooks} from 'node:v8';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {fixture,snapshot,noWrites,assertUnpaid,alterQuote,template,actor,imports} from './sponsor-video-native-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {exportSynthetic,install,rowsSnapshot} from './helpers/model3d-workerd-snapshot.mjs';
const [{describeSponsorVideoAdmission,readSponsorVideoTemplateEvidence},contract,{digest}]=await Promise.all([
  import('../worker/experience-sponsor-video-evidence.ts'),import('../worker/experience-sponsor-video-contract.ts'),import('../src/experiences/compiler.ts'),
]);
after(()=>imports.deregister());
async function actualEvidence(f){const described=await describeSponsorVideoAdmission(f.trusted,f.command);return {described,actual:await readSponsorVideoTemplateEvidence(f.trusted,f.command,described.recipe)};}
function assertCustodyTrace(f,start){
  assert.deepEqual(f.io.media.slice(start),['head','head','get','head'],'The actual native original-custody read must not be bypassed or repeated');
}
// Intercept only the leaf's final complete source/quote/principal proof batch.
// Every real native SQL statement executes before acknowledgment fault injection.
const isFinalVideoProof=statements=>statements.some(statement=>statement.sql.includes('captured WHERE terms_digest=? AND expires_at=? AND private_json=?'));
const afterMicrotasks=(count,callback)=>{const advance=remaining=>queueMicrotask(()=>remaining===1?callback():advance(remaining-1));advance(count);};

for(const mode of ['sparse','missing-success','false-success','null-current','undefined-entry','inherited-index','accessor-index','accessor-success','accessor-current'])test(`successor final acknowledgment refuses ${mode} after genuine native SQL`,async t=>{
  const f=await fixture(t),batch=f.DB.batch.bind(f.DB),before=snapshot(f),assertReadOnly=noWrites(f);let reached=false;
  let accessorsRead=0;
  f.DB.batch=async statements=>{const actual=await batch(statements);if(!isFinalVideoProof(statements))return actual;reached=true;
    if(mode==='sparse')return new Array(actual.length);
    if(mode==='missing-success')return actual.map(({success:ignored,...entry})=>{void ignored;return entry;});
    if(mode==='false-success')return actual.map(entry=>({...entry,success:false}));
    if(mode==='null-current')return actual.map(entry=>({...entry,results:[{current:null}]}));
    if(mode==='inherited-index')return Object.setPrototypeOf(new Array(actual.length),actual);
    if(mode==='accessor-index'){const rows=[...actual];Object.defineProperty(rows,0,{get(){accessorsRead++;return actual[0];}});return rows;}
    if(mode==='accessor-success'){const rows=actual.map(entry=>({...entry}));Object.defineProperty(rows[0],'success',{get(){accessorsRead++;return true;}});return rows;}
    if(mode==='accessor-current'){const rows=actual.map(entry=>({...entry,results:[{current:1}]}));Object.defineProperty(rows[0].results[0],'current',{get(){accessorsRead++;return 1;}});return rows;}
    return actual.map((entry,index)=>index?entry:undefined);
  };
  await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command));assert.equal(reached,true);
  assert.equal(accessorsRead,0);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

for(const api of ['describe','template'])for(const race of ['source-after-inner-proof','abort-before-public-projection'])
test(`successor public ${api} return refuses ${race}`,async t=>{
  const f=await fixture(t),recipe=(await describeSponsorVideoAdmission(f.trusted,f.command)).recipe;
  const controller=new AbortController();f.trusted.request=new Request(f.request,{signal:controller.signal});
  const batch=f.DB.batch.bind(f.DB),before=snapshot(f),assertReadOnly=noWrites(f);let reached=false,mutated=false,operation,settled=false,settledBeforeMutation;
  // A .then observer runs later than promise settlement; V8's hook measures
  // the exact public Promise instead of treating its observer as the boundary.
  const stop=promiseHooks.createHook({settled(promise){if(promise===operation)settled=true;}});t.after(stop);
  f.DB.batch=async statements=>{const actual=await batch(statements);if(isFinalVideoProof(statements)){
    reached=true;afterMicrotasks(race==='source-after-inner-proof'?4:6,()=>{mutated=true;settledBeforeMutation=settled;
      if(race==='source-after-inner-proof')f.trusted.context.snapshot.facts.find(fact=>typeof fact.properties.text==='string').properties.text+=' retired';
      else controller.abort(new Error('synthetic-final-handoff-abort'));
    });
  }return actual;};
  operation=api==='describe'?describeSponsorVideoAdmission(f.trusted,f.command):readSponsorVideoTemplateEvidence(f.trusted,f.command,recipe);
  const outcome=await operation.then(value=>({value}),error=>({error}));
  assert.equal(reached,true);assert.equal(mutated,true);assert.equal(settledBeforeMutation,false,'Mutation must precede the actual public promise settlement');
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  assert.ok(outcome.error,'The public API must reject an operation retired before its actual promise settlement');
  assert.match(outcome.error.message,/sponsor_|output_|experience_|video_/);
});

for(const api of ['describe','template'])test(`successor public ${api} already-settled result is not invalidated by a later abort`,async t=>{
  const f=await fixture(t),recipe=(await describeSponsorVideoAdmission(f.trusted,f.command)).recipe,controller=new AbortController();
  f.trusted.request=new Request(f.request,{signal:controller.signal});const batch=f.DB.batch.bind(f.DB),before=snapshot(f),assertReadOnly=noWrites(f);
  let operation,settled=false,reached=false,settledBeforeAbort;
  const stop=promiseHooks.createHook({settled(promise){if(promise===operation)settled=true;}});t.after(stop);
  f.DB.batch=async statements=>{const actual=await batch(statements);if(isFinalVideoProof(statements))afterMicrotasks(7,()=>{
    reached=true;settledBeforeAbort=settled;controller.abort(new Error('synthetic-after-public-settlement'));
  });return actual;};
  operation=api==='describe'?describeSponsorVideoAdmission(f.trusted,f.command):readSponsorVideoTemplateEvidence(f.trusted,f.command,recipe);
  const result=await operation;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reached,true);assert.equal(settledBeforeAbort,true);assert.equal(result.recipe.maximumTokens,152000);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('successor delivered R2 body is cancelled when lifetime retires between delivery validation and await resumption',async t=>{
  const f=await fixture(t),controller=new AbortController();f.trusted.request=new Request(f.request,{signal:controller.signal});
  const get=f.env.MEDIA.get,clock=Date.now,before=snapshot(f),assertReadOnly=noWrites(f);
  let delivered=false,queued=false,aborted=false,cancelled=0,acquired=0,body;
  f.env.MEDIA.get=async key=>{const object=await get(key);body=new ReadableStream({cancel(){cancelled++;}},{highWaterMark:0});
    const acquire=body.getReader.bind(body);body.getReader=(...args)=>{acquired++;return acquire(...args);};delivered=true;return {...object,body};};
  Date.now=()=>{const value=clock();if(delivered&&!queued){queued=true;queueMicrotask(()=>{aborted=true;controller.abort(new Error('synthetic-delivered-body-retirement'));});}return value;};
  try{await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_video_read_interrupted/);}finally{Date.now=clock;}
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(delivered,true);assert.equal(queued,true);assert.equal(aborted,true);assert.equal(acquired,0,'Retirement occurs before reader acquisition');
  assert.equal(body.locked,false);assert.equal(cancelled,1,'Every delivered but unacquired body belongs to the retiring operation');
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('successor late GET fulfillment after rejection receives one nonblocking cancellation without an unhandled rejection',async t=>{
  const f=await fixture(t),controller=new AbortController();f.trusted.request=new Request(f.request,{signal:controller.signal});
  const get=f.env.MEDIA.get,before=snapshot(f),assertReadOnly=noWrites(f),unhandled=[],observe=reason=>unhandled.push(reason);
  process.on('unhandledRejection',observe);t.after(()=>process.off('unhandledRejection',observe));
  let deliver,startedResolve,retired=false,cancelled=0,acquired=0;
  const started=new Promise(resolve=>{startedResolve=resolve;});
  f.env.MEDIA.get=async key=>{const object=await get(key),body=new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}},{highWaterMark:0});
    const acquire=body.getReader.bind(body);body.getReader=(...args)=>{acquired++;return acquire(...args);};
    return new Promise(resolve=>{deliver=()=>resolve({...object,body});startedResolve();});};
  const pending=describeSponsorVideoAdmission(f.trusted,f.command);await started;controller.abort(new Error('synthetic-before-delivery'));
  await assert.rejects(pending,/sponsor_video_read_interrupted/);retired=true;deliver();
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(retired,true);assert.equal(acquired,0);assert.equal(cancelled,1);assert.deepEqual(unhandled,[]);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('successor metadata failure before reader acquisition cancels its delivered R2 body',async t=>{
  const f=await fixture(t),get=f.env.MEDIA.get,before=snapshot(f),assertReadOnly=noWrites(f);let cancelled=0,acquired=0;
  f.env.MEDIA.get=async key=>{const object=await get(key),body=new ReadableStream({cancel(){cancelled++;}},{highWaterMark:0});
    const acquire=body.getReader.bind(body);body.getReader=(...args)=>{acquired++;return acquire(...args);};
    return {...object,body,writeHttpMetadata(){throw Error('synthetic-metadata-failure');}};};
  await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/synthetic-metadata-failure/);
  assert.equal(acquired,0);assert.equal(cancelled,1);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

for(const [frame,frameSize] of [['landscape','1280x720'],['portrait','720x1280']])test(`actual canonical Video ${frame} intake, SAVE, CONFIRM and quote yield read-only native sponsorship evidence`,async t=>{
  const f=await fixture(t,{frame}),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  t.after(()=>limits.restore());const assertReadOnly=noWrites(f),start=f.io.media.length,readBytes=f.io.bytesRead;
  const described=await describeSponsorVideoAdmission(f.trusted,f.command);assertCustodyTrace(f,start);
  assert.equal(f.io.bytesRead-readBytes,f.bytes.length);
  const second=f.io.media.length,actual=await readSponsorVideoTemplateEvidence(f.trusted,f.command,described.recipe);assertCustodyTrace(f,second);
  assert.equal(await contract.matchSponsorVideoTemplate(template(described.recipe),actual),true);
  assert.deepEqual(described.recipe.calls,{parsing:0,planning:1,render:1,repair:0});assert.equal(described.recipe.maximumTokens,152000);
  assert.deepEqual([described.recipe.outputCount,described.recipe.durationMs,described.recipe.width,described.recipe.height],[1,4000,0,0]);
  assert.equal(described.actorUserId,actor);assert.equal(described.ownerUserId,actor);assert.deepEqual(described.orderedAssetDigests,[`sha256:${f.reference.sha256}`]);
  assert.equal(actual.offered.settings.payload.outputVideo.frameSize,frameSize);
  assert.deepEqual(actual.offered.settings.calls.map(call=>call.stage),['planning:0:initial','video:initial']);
  assert.equal(actual.offered.settings.payload.videoAudioMode,'silent');assert.equal(actual.offered.settings.payload.videoResolution,'480p');
  assert.equal(actual.recipe.routeDigest,await digest(actual.offered));assert.equal(actual.recipe.settingsDigest,await digest(actual.offered.settings));
  assert.ok(Object.isFrozen(actual.offered.settings.payload));assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);limits.assertVerified();
  t.diagnostic(JSON.stringify({strictLocalSqlStatements:limits.records.length,maximumBindings:Math.max(...limits.boundCounts),maximumSqlBytes:Math.max(...limits.records.map(r=>Buffer.byteLength(r.sql))),
    nativeImageReads:2,nativeImageBytes:f.io.bytesRead-readBytes,network:f.io.network,assets:f.io.assets,detached:f.io.detached}));
});

test('closed Video template refuses added authority, changed stages, costs, formats and unsafe grammar',async t=>{
  const f=await fixture(t),{described,actual}=await actualEvidence(f),base=template(described.recipe);
  for(const mutate of [x=>x.version=7,x=>x.family='guest-video@1',x=>x.outputCount=2,x=>x.durationMs=8000,x=>x.width=854,x=>x.maximumCalls=3,
    x=>x.maximumTokens=256000,x=>x.maximumInputTokens++,x=>x.maximumOutputTokens++,x=>x.maximumMicrousd++,x=>x.plannerModel='gpt-5.6-sol',
    x=>x.videoModel='other',x=>x.frameSizes.reverse(),x=>x.maximumReferenceBytes++,x=>x.maximumResultBytes++,x=>x.referenceMimeTypes.push('image/gif'),
    x=>x.adapterVersion='1.0.0',x=>x.promptAdapterVersion='0.0.0',x=>x.cachePolicy='automatic',x=>x.reasoningEffort='high',x=>x.payerUserId='claimed']){
    const changed=structuredClone(base);mutate(changed);assert.throws(()=>contract.readSponsorVideoCampaignTemplate(changed),/sponsor_video_contract_invalid/);
  }
  let accessed=0;const unsafe={...base};Object.defineProperty(unsafe,'family',{enumerable:true,get(){accessed++;return base.family;}});
  assert.throws(()=>contract.readSponsorVideoCampaignTemplate(unsafe));assert.equal(accessed,0);
  for(const mutate of [x=>x.recipe.calls.repair=1,x=>x.recipe.width=1280,x=>x.recipe.maximumTokens=64000,x=>x.offered.settings.payload.videoSeconds=8,
    x=>x.offered.settings.payload.videoAudioMode='generated',x=>x.offered.settings.calls.reverse(),x=>x.offered.settings.calls[0].maximumInputTokens++,
    x=>x.offered.settings.original.sourceDigest='f'.repeat(64),x=>x.offered.settings.extra=true]){
    const changed=structuredClone(actual);mutate(changed);assert.equal(await contract.matchSponsorVideoTemplate(base,changed),false);
  }
  const capturedTemplate=structuredClone(base),capturedActual=structuredClone(actual),pending=contract.matchSponsorVideoTemplate(capturedTemplate,capturedActual);
  capturedTemplate.maximumCalls=4;capturedActual.offered.settings.payload.videoSeconds=6;
  assert.equal(await pending,true);assert.equal(await contract.matchSponsorVideoTemplate(capturedTemplate,capturedActual),false);
  await assert.rejects(readSponsorVideoTemplateEvidence(f.trusted,f.command,{...described.recipe,maximumTokens:151999}),/sponsor_native_envelope_mismatch/);assertUnpaid(f);
});

test('re-digested native quote tampering cannot replace original source, attempt, model, price or planner bytes',async t=>{
  const mutations=[q=>q.operationAttempts[Object.keys(q.operationAttempts)[0]].ordinal=1,q=>q.operationAttempts[Object.keys(q.operationAttempts)[0]].previousSlotId='old-slot',
    q=>q.targets[0].settings.original.requestId='video-'+'f'.repeat(64),q=>q.targets[0].settings.original.actorUserId='foreign',
    q=>q.targets[0].settings.payload.outputVideo.reference.sha256='f'.repeat(64),q=>q.targets[0].settings.payload.outputVideoPlanner.requestDigest='f'.repeat(64),
    q=>q.targets[0].settings.calls[0].maximumMicrousd++,q=>q.targets[0].settings.calls[1].maximumMicrousd++,q=>q.targets[0].settings.calls[1].model='other'];
  for(const mutate of mutations){const f=await fixture(t);await alterQuote(f,mutate);const before=snapshot(f),assertReadOnly=noWrites(f);
    await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_|output_video_/);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);}
});

test('native reader refuses wrong or retired principal and unsupported ownership without paid side effects',async t=>{
  const changes=[f=>f.trusted.scope.ownerUserId='foreign',f=>f.trusted.scope.contextId='context',f=>f.trusted.principal.fictional=true,
    f=>f.trusted.principal.billingUserId='foreign',f=>f.trusted.env.FORMA_PILOT_COHORT_ID='cohort',
    f=>f.sqlite.prepare("UPDATE users SET consent_version=0 WHERE user_id=?").run(actor),
    f=>f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(actor)];
  for(const change of changes){const f=await fixture(t);change(f);const before=snapshot(f),assertReadOnly=noWrites(f);
    await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_/);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);}
});

test('current principal and exact private source remain required after the actual image read',async t=>{
  for(const mode of ['principal','private-source','head']){
    const f=await fixture(t);let changed=false,afterMutation;
    f.afterGet=()=>{if(changed)return;changed=true;
      if(mode==='principal')f.sqlite.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run(new Date(Date.now()+60000).toISOString(),actor);
      else if(mode==='private-source')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=replace(private_json,'Slow camera push.','Fast camera push.') WHERE document_id=?").run(f.documentId);
      else f.trusted.ownerHead++;
      afterMutation=snapshot(f);
    };
    const assertReadOnly=noWrites(f);await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_|output_|experience_|video_/);
    assert.equal(changed,true);assert.deepEqual(snapshot(f),afterMutation);assertReadOnly();assertUnpaid(f);
  }
});

test('native original image denies changed hash, owner, MIME, oversized metadata and removal',async t=>{
  for(const mutate of [v=>v.bytes[0]^=1,v=>v.metadata.ownerId='foreign',v=>v.metadata.sha256='f'.repeat(64),v=>v.contentType='image/gif']){
    const f=await fixture(t);mutate(f.media.get(f.key));const before=snapshot(f),assertReadOnly=noWrites(f);
    await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_|output_|experience_|video_|media_|owned_image_/);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
  for(const mode of ['oversized','missing']){const f=await fixture(t),head=f.env.MEDIA.head;f.env.MEDIA.head=async key=>{const value=await head(key);return mode==='missing'?null:{...value,size:31457281};};
    const before=snapshot(f),assertReadOnly=noWrites(f),start=f.io.media.length;
    await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_|output_|experience_|video_|media_|owned_image_/);
    assert.equal(f.io.media.slice(start).includes('get'),false);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

test('bounded source-body reader refuses oversized, truncated, empty, non-byte and over-fragmented bodies',async t=>{
  for(const mode of ['oversized','truncated','empty','non-byte','fragmented']){
    const f=await fixture(t),get=f.env.MEDIA.get;let cancelled=false;
    f.env.MEDIA.get=async key=>{const value=await get(key);let count=0;return {...value,...(mode==='fragmented'?{size:65536}:{}),body:new ReadableStream({
      pull(controller){
        if(mode==='oversized')controller.enqueue(new Uint8Array(f.bytes.length+1));
        else if(mode==='truncated'){controller.enqueue(f.bytes.slice(0,-1));controller.close();}
        else if(mode==='empty')controller.enqueue(new Uint8Array());
        else if(mode==='non-byte')controller.enqueue('not bytes');
        else if(count++<65536)controller.enqueue(new Uint8Array([1]));else controller.close();
      },cancel(){cancelled=true;}})};};
    const before=snapshot(f),assertReadOnly=noWrites(f);
    await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_video_media_byte_limit/);
    if(mode!=='truncated'&&mode!=='fragmented')assert.equal(cancelled,true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  }
});

test('one actual 30-second lifetime retires a stalled source stream and cancels its reader',async t=>{
  const f=await fixture(t),get=f.env.MEDIA.get;let reached=false,cancelled=false;
  f.env.MEDIA.get=async key=>{const value=await get(key);return {...value,body:new ReadableStream({pull(){reached=true;},cancel(){cancelled=true;}})};};
  const before=snapshot(f),assertReadOnly=noWrites(f),started=performance.now();
  await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_video_read_interrupted/);
  const elapsed=performance.now()-started;assert.ok(elapsed>=29500&&elapsed<40000,String(elapsed));
  // Cancellation runs in the internal reader's finally after the owner loses
  // the lifetime race; observing the next microtask does not extend its limit.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reached,true);assert.equal(cancelled,true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  t.diagnostic(JSON.stringify({actualReadDeadlineMilliseconds:Math.round(elapsed),nativeImageGets:1,cancelled}));
});

test('caller abort during original body read retires the evidence owner without DB or media writes',async t=>{
  const f=await fixture(t),controller=new AbortController();f.trusted.request=new Request(f.request,{signal:controller.signal});
  const get=f.env.MEDIA.get;let reached=false,cancelled=false;
  f.env.MEDIA.get=async key=>{const value=await get(key);return {...value,body:new ReadableStream({pull(){reached=true;controller.abort(new Error('synthetic-video-read-aborted'));},cancel(){cancelled=true;}})};};
  const before=snapshot(f),assertReadOnly=noWrites(f);
  await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_|output_|experience_|video_|aborted/);
  assert.equal(reached,true);assert.equal(cancelled,true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('an already-aborted evidence owner makes no SQL or media call and has no unhandled rejection',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort(new Error('synthetic-pre-aborted'));
  f.trusted.request=new Request(f.request,{signal:controller.signal});const before=snapshot(f),start=f.io.media.length,prepare=f.DB.prepare.bind(f.DB);let reads=0;
  f.DB.prepare=sql=>{reads++;return prepare(sql);};const unhandled=[],observe=reason=>unhandled.push(reason);
  process.on('unhandledRejection',observe);t.after(()=>process.off('unhandledRejection',observe));
  await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_video_read_interrupted/);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(unhandled,[]);assert.equal(reads,0);assert.equal(f.io.media.length,start);
  assert.deepEqual(snapshot(f),before);assertUnpaid(f);
});

test('an abort after the first owned SQL await prevents every later private read',async t=>{
  const f=await fixture(t),controller=new AbortController();f.trusted.request=new Request(f.request,{signal:controller.signal});
  const prepare=f.DB.prepare.bind(f.DB),before=snapshot(f),start=f.io.media.length;let reads=0;
  f.DB.prepare=sql=>{reads++;const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{
    const bound=bind(...values),first=bound.first.bind(bound);bound.first=async()=>{const result=await first();controller.abort(new Error('synthetic-sql-abort'));return result;};return bound;};return statement;};
  await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_video_read_interrupted/);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);assert.equal(f.io.media.length,start);assert.deepEqual(snapshot(f),before);assertUnpaid(f);
});

test('caller inputs are captured synchronously before the first await and later source changes retire evidence',async t=>{
  const f=await fixture(t),before=snapshot(f),assertReadOnly=noWrites(f),original=f.command.maximumMicrousd;
  const pending=describeSponsorVideoAdmission(f.trusted,f.command);f.command.maximumMicrousd=original+1;
  const description=await pending;assert.equal(description.recipe.maximumMicrousd,original);
  await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_recipe_unsupported/);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
  const other=await fixture(t),otherBefore=snapshot(other),assertOtherReadOnly=noWrites(other);
  const originalText=other.trusted.context.snapshot.facts.find(fact=>typeof fact.properties.text==='string');assert.ok(originalText);
  const pendingSource=describeSponsorVideoAdmission(other.trusted,other.command);originalText.properties.text+=' changed';
  await assert.rejects(pendingSource,/sponsor_/);assert.deepEqual(snapshot(other),otherBefore);assertOtherReadOnly();assertUnpaid(other);
});

test('a transient caller-source change spanning native SQL and actual planner hashing cannot replace captured input',async t=>{
  const f=await fixture(t),{actual}=await actualEvidence(f),before=snapshot(f),assertReadOnly=noWrites(f);
  const fact=f.trusted.context.snapshot.facts.find(value=>typeof value.properties.text==='string'&&value.properties.text.includes('Slow camera push.'));assert.ok(fact);
  const originalText=fact.properties.text,changedText=originalText.replace('Slow camera push.','Fast camera push.');assert.equal(changedText.length,originalText.length);
  const batch=f.DB.batch.bind(f.DB),subtle=crypto.subtle,originalDigest=subtle.digest;let armed=false,restored=false,hashedCaptured=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!armed){armed=true;fact.properties.text=changedText;}return result;};
  subtle.digest=async function(algorithm,data){const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data),text=new TextDecoder().decode(bytes);
    if(armed&&!restored&&text.includes('"max_output_tokens":3000')&&text.includes('"name":"document_video"')){
      hashedCaptured=text.includes('Slow camera push.')&&!text.includes('Fast camera push.');restored=true;fact.properties.text=originalText;
    }
    return originalDigest.call(this,algorithm,data);
  };
  let result;
  try{result=await readSponsorVideoTemplateEvidence(f.trusted,f.command,actual.recipe);}finally{subtle.digest=originalDigest;fact.properties.text=originalText;}
  assert.equal(armed,true);assert.equal(restored,true,'Restore only after the actual Video planner wire has been prepared');assert.equal(hashedCaptured,true);
  assert.deepEqual(result,actual);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('deadline crossed during native SQL proof cannot return previously read original bytes',async t=>{
  const f=await fixture(t),batch=f.DB.batch.bind(f.DB),clock=Date.now,deadline=Date.now()+60000;let reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);reached=true;Date.now=()=>deadline;return result;};
  const before=snapshot(f),assertReadOnly=noWrites(f);
  try{await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_|output_|experience_|video_/);}finally{Date.now=clock;}
  assert.equal(reached,true);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('actual native Video evidence and late source refusal execute against local workerd D1',{timeout:120000},async t=>{
  const originalFetch=globalThis.fetch,f=await fixture(t),exported=exportSynthetic(f.sqlite);
  t.mock.restoreAll();let outbound=0;
  t.mock.method(globalThis,'fetch',(...args)=>{const input=args[0],url=new URL(input instanceof Request?input.url:String(input));
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){outbound++;throw Error('network_forbidden');}return originalFetch(...args);});
  const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
  const {inheritRuntimeSchemaReadiness}=await import('../worker/runtime.ts');
  const {loadOutputTrustedContext}=await import('../worker/output-requirements-api.ts');
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],
    script:'export default {fetch(){return new Response("synthetic Video leaf qualification only")}}',outboundService(){outbound++;throw Error('network_forbidden');}});
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);const before=await rowsSnapshot(db,exported.tables),trace=[],statements=new WeakMap();
    const capture=(sql,bindings)=>{assert.match(sql,/^\s*SELECT\b/iu,'Every actual evidence SQL statement must be read-only');
      assert.ok(bindings.length<=100);assert.ok(Buffer.byteLength(sql)<=100000);return {sql,bindings};};
    const wrap=(sql,bindings=[])=>{const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
      for(const method of ['first','all','run'])statement[method]=async(...args)=>{trace.push(capture(sql,bindings));return original[method](...args);};
      statements.set(statement,{original,sql,bindings});return statement;};
    const guarded={prepare:sql=>wrap(sql),batch:async items=>{const captured=items.map(item=>statements.get(item));assert.ok(captured.every(Boolean));
      trace.push(...captured.map(({sql,bindings})=>capture(sql,bindings)));return db.batch(captured.map(value=>value.original));}};
    inheritRuntimeSchemaReadiness(f.DB,guarded);f.env.DB=guarded;
    f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
    const readStart=f.io.media.length,described=await describeSponsorVideoAdmission(f.trusted,f.command);assertCustodyTrace(f,readStart);
    const nextStart=f.io.media.length,actual=await readSponsorVideoTemplateEvidence(f.trusted,f.command,described.recipe);assertCustodyTrace(f,nextStart);
    assert.equal(await contract.matchSponsorVideoTemplate(template(described.recipe),actual),true);
    assert.deepEqual(await rowsSnapshot(db,exported.tables),before);const positiveStatements=trace.length;
    let changed=false,afterWithdrawal;
    f.afterGet=async()=>{if(changed)return;changed=true;
      await db.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE document_id=? AND private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated')").bind(f.reference.sourceDocumentId).run();
      afterWithdrawal=await rowsSnapshot(db,exported.tables);
    };
    const negativeStart=f.io.media.length;await assert.rejects(describeSponsorVideoAdmission(f.trusted,f.command),/sponsor_|output_|experience_|video_|owned_image_/);
    assert.equal(changed,true);assert.deepEqual(await rowsSnapshot(db,exported.tables),afterWithdrawal);assert.equal(f.io.media.slice(negativeStart).filter(value=>value==='get').length,1);
    for(const name of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first()).n,0,name);
    assert.equal(outbound,0);assertUnpaid(f);
    const evidence={engine:'pinned Miniflare/workerd D1',applicationExecution:'Node-hosted actual native production modules against local workerd D1',localOnly:true,
      success:true,positiveStatements,totalStatements:trace.length,sqlShapes:new Set(trace.map(value=>value.sql)).size,
      maximumBindings:Math.max(...trace.map(value=>value.bindings.length)),maximumSqlBytes:Math.max(...trace.map(value=>Buffer.byteLength(value.sql))),
      lateOriginalSourceWithdrawalRefused:changed,sourceReads:3,providerCalls:0,outboundCalls:outbound,mediaWrites:0};
    await writeFile(process.env.FORMA_VIDEO_D1_EVIDENCE_PATH??'/private/tmp/forma-sponsored-video-leaf-evidence-20260917/native-d1.json',JSON.stringify({evidence,trace},null,2)+'\n');
    t.diagnostic(JSON.stringify(evidence));
  }finally{await mf.dispose();}
});
