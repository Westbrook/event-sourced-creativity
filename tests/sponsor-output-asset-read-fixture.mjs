import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,installImageTransport,BASE} from './sponsor-driver-fixture.mjs';
import {png} from './sponsor-native-fixture.mjs';
import {snapshot as presentationSnapshot,outputFor,flexible} from './output-presentation-fixtures.mjs';

const [{driveSponsoredImage},{handleOutputRequirements},{outputDocumentExecutionBridge},
  {readWorkspaceEvents,streamHead,appendAuditEvent},{captureSceneSourceVersion},{canonicalJson,digest},
  {SCENE_SOURCE_GENERATION_TABLES},{SCENE_SOURCE_GENERATION_TRIGGERS},
  {SPONSOR_READ_POLICY_SCHEMA,readSponsorReadPolicy},{SPONSOR_READ_ATTEMPT_SCHEMA},{SPONSOR_NATIVE_IMAGE_READ_INDEXES},{parseOutputRequirement},{handleDocumentJobs}]=await Promise.all([
  import('../worker/experience-sponsor-driver.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/output-document-execution.ts'),import('../worker/runtime.ts'),
  import('../worker/scene-source-generation.ts'),import('../src/experiences/compiler.ts'),
  import('../db/scene-source-generation-tables.ts'),import('../db/scene-source-generations.ts'),
  import('../worker/experience-sponsor-read-policy.ts'),import('../worker/experience-sponsor-read-attempts.ts'),
  import('../worker/experience-sponsor-native-image-read.ts'),
  import('../src/model/output-requirements.ts'),
  import('../worker/document-jobs-api.ts'),
]);

export const hash=value=>createHash('sha256').update(value).digest('hex');
export const readPolicy=()=>({version:1,windowMs:60_000,
  operations:Object.fromEntries(['image-status','image-result','image-media'].map(operation=>[operation,{maximumBytes:32_000_000,deadlineMs:10_000}])),
  actor:{maximumRequestsPerWindow:100,maximumBytesPerWindow:3_200_000_000},
  campaign:{maximumRequestsPerWindow:200,maximumBytesPerWindow:6_400_000_000}});
export async function responseJson(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const readTables=new Set(['experience_sponsor_read_policies','experience_sponsor_read_attempts']);
const snapshot=f=>({tables:Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .filter(row=>!readTables.has(row.name)).map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM ${quote(name)}`).all().map(row=>canonicalJson(row)).sort()])),
  media:[...f.media].map(([key,item])=>({key,hash:hash(item.bytes),metadata:structuredClone(item.metadata),contentType:item.contentType}))
    .sort((left,right)=>left.key.localeCompare(right.key)),providers:f.transport.counts()});

async function nativeAsset(f,assetId,documentId=f.documentId){
  const row=f.sqlite.prepare('SELECT * FROM output_assets WHERE asset_id=? AND document_id=?').get(assetId,documentId);assert.ok(row);
  const events=await readWorkspaceEvents(f.env,f.stream),event=events.find(value=>value.eventId===row.created_event_id);assert.ok(event);
  assert.equal(event.type,'OutputAssetAdopted');assert.equal(event.payload.asset_id,assetId);
  const privateRow=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(event.eventId);assert.ok(privateRow);
  assert.equal(privateRow.owner_id,f.actor);assert.equal(privateRow.document_id,documentId);assert.equal(privateRow.redacted_at,null);
  const asset=event.payload.asset,origin=asset.origin,retained=f.media.get(row.storage_key);assert.ok(retained);
  const bytes=retained.bytes.slice();assert.equal(hash(bytes),row.content_sha256);assert.equal(bytes.byteLength,row.byte_length);
  assert.equal(asset.inspection.sha256,row.content_sha256);assert.equal(asset.inspection.byteLength,row.byte_length);
  return {assetId,row,event,privateRow,asset,origin,bytes,sha256:row.content_sha256,key:row.storage_key};
}

async function nativeSlides(f,t){
  // This optional compatibility case intentionally changes the Document source
  // for its ordinary Slides result. It is not a first-Image freshness fixture.
  const projectId=f.confirmed.snapshot.projectId,source=presentationSnapshot();
  await appendAuditEvent(f.env,f.stream,'user','BlockRemoved',{document_id:f.documentId,project_id:projectId,block_id:f.sourceBlockId});
  const facts=source.facts.filter(fact=>String(fact.type).toLowerCase()!=='output');
  for(const [index,fact] of facts.entries())await appendAuditEvent(f.env,f.stream,'user','BlockCreated',{
    document_id:f.documentId,project_id:projectId,block_id:fact.block_id,type:fact.type,handle:fact.block_id,position:String(index),
    properties:{...fact.properties,weight:1,...(fact.intent?{intent:fact.intent}:{})}});
  const parsed=parseOutputRequirement({id:'ordinary-native-slides-output',type:'Output',subtype:'Executive summary',content:'1 slideshow with 5-15 slides'});
  assert.ok(parsed.spec);const deck=parsed.spec.deliverables.find(value=>value.media_kind==='slides');assert.ok(deck);
  await responseJson(await f.send({action:'save',blockId:parsed.spec.id,spec:parsed.spec}));
  const confirmed=await responseJson(await f.send({action:'confirm',options:{count_policies:{[deck.id]:flexible},suggested_counts:{[deck.id]:8}}}));
  const target=confirmed.snapshot.confirmedPlan.plan.targets.find(value=>value.media_kind==='slides');assert.ok(target);
  assert.equal(target.blocking_issues.length,0);const planRevisionId=confirmed.command.planRevisionId;
  const preflight=await responseJson(await f.send({action:'preflight',planRevisionId,targetIds:[target.id]})),terms=preflight.command.preflight;
  assert.ok(terms.targets.every(value=>value.available),JSON.stringify(terms));
  const authorized=await responseJson(await f.send({action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,
    maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true}));
  const grantId=authorized.command.grantId,slot=f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE grant_id=?').get(grantId);assert.ok(slot);
  const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants WHERE grant_id=?').get(grantId);assert.equal(grant.actor_user_id,f.actor);
  assert.equal(grant.payer_user_id,f.actor);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM experience_sponsor_consumptions WHERE job_id=?').get(slot.job_id).n,0);
  const calls=[];
  const transport=t.mock.method(globalThis,'fetch',async(url,request)=>{
    assert.equal(String(url),'https://api.openai.com/v1/responses');calls.push(JSON.parse(request.body));
    return Response.json({id:'ordinary-native-slides-fixture',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),
      usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
  });
  try{
    await responseJson(await f.send({action:'run',grantId}));
    const response=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${slot.job_id}/run`,{method:'POST',headers:f.actorHeaders}),f.env,`${slot.job_id}/run`);
    assert.equal(response.status,200,await response.clone().text());
  }finally{transport.mock.restore();}
  assert.equal(calls.length,1);const job=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(slot.job_id);
  assert.equal(job.status,'completed',JSON.stringify(job));
  const bound=await responseJson(await f.send({action:'bind',planRevisionId,targetId:target.id,nativeJobId:job.job_id}));
  const result=bound.snapshot.results.find(value=>value.id===bound.command.resultId);assert.ok(result);assert.equal(result.checksStatus,'passed');
  const asset=await nativeAsset(f,result.assetId);assert.equal(asset.origin.kind,'native_job');assert.equal(asset.origin.jobId,job.job_id);
  assert.equal(asset.row.media_kind,'slides');assert.equal(asset.asset.inspection.facts.slideCount,9);
  return {...asset,jobId:job.job_id,job,slot,grant,planRevisionId,targetId:target.id,bound,boundResult:result,providerCalls:calls.length};
}

/** Actual sponsored Image execution and native result adoption, using the
 * existing intercepted provider transport and owned RAM media. Bind and optional
 * ordinary upload go through the production HTTP handler and execution bridge;
 * no asset, origin, result or adoption-event rows are invented. All setup writes
 * finish before read sentinels begin. Policy terms and dormant indexes are
 * explicit disposable fixture preparation, not production activation. */
export async function sponsorOutputAssetReadFixture(t,{policy=readPolicy(),indexes=true,indexDefinitions=[],ordinary=false,secondSponsored=false,ordinaryNativeSlides=false,...nativeOptions}={}){
  const transport=installImageTransport(t),f=await fixture(t,nativeOptions);
  f.transport=transport;
  // Read the actual confirmed plan while this Document still has no sponsored
  // result. After execution, the read guard deliberately withholds whole-Doc
  // snapshots; bind obtains its current revision from the native stream head.
  const snapshotRequest=new Request(`http://localhost${BASE}?documentId=${encodeURIComponent(f.documentId)}`,{headers:f.actorHeaders});
  const beforeGeneration=await responseJson(await handleOutputRequirements(snapshotRequest,f.env,BASE,f.context,outputDocumentExecutionBridge));
  assert.equal(beforeGeneration.confirmedPlan.revisionId,f.planRevisionId);
  const driverResult=await driveSponsoredImage(f.request(),f.env,f.context);assert.equal(driverResult.status,'completed');
  assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
  const jobs=f.sqlite.prepare('SELECT * FROM document_jobs WHERE owner_id=? AND document_id=?').all(f.actor,f.documentId);
  assert.equal(jobs.length,1);const job=jobs[0],jobId=job.job_id;assert.equal(job.status,'completed');
  const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE job_id=?').get(jobId);assert.equal(slot.status,'succeeded');
  const consumption=f.sqlite.prepare('SELECT * FROM experience_sponsor_consumptions WHERE job_id=?').get(jobId);assert.ok(consumption);
  const issuance=f.sqlite.prepare('SELECT * FROM experience_sponsor_issuances WHERE grant_id=?').get(consumption.grant_id);assert.ok(issuance);
  assert.equal(consumption.actor_user_id,f.actor);assert.equal(consumption.campaign_id,f.campaignId);
  const events=await readWorkspaceEvents(f.env,f.stream),completions=events.filter(event=>event.type==='GenerationCompleted'
    &&event.correlationId===job.correlation_id&&event.payload.document_id===f.documentId);
  assert.equal(completions.length,1);const completionEvent=completions[0],completedPayload=completionEvent.payload;
  assert.equal(slot.outcome_event_id,completionEvent.eventId);assert.equal(completedPayload.simulation,false);
  const originalKey=decodeURIComponent(completedPayload.media_url.slice('/api/media/'.length));
  const originalBytes=f.media.get(originalKey).bytes.slice();

  const bound=await responseJson(await f.send({action:'bind',
    planRevisionId:f.planRevisionId,targetId:f.targetId,nativeJobId:jobId}));
  const boundResult=bound.snapshot.results.find(result=>result.id===bound.command.resultId);assert.ok(boundResult);
  assert.equal(boundResult.checksStatus,'passed');assert.equal(boundResult.review,'pending');
  const adopted=await nativeAsset(f,boundResult.assetId);
  assert.equal(adopted.origin.kind,'native_job');assert.equal(adopted.origin.jobId,jobId);
  assert.equal(adopted.origin.slotId,slot.slot_id);assert.equal(adopted.origin.completionEventId,completionEvent.eventId);
  assert.deepEqual(adopted.bytes,originalBytes);
  let otherSponsored=null;
  if(secondSponsored){
    // A completed target refuses a fresh generation intent. Use another real
    // Document in the same actor stream, leaving the first source unchanged.
    const documentId=`${f.documentId}-second`,projectId=beforeGeneration.projectId,sourceBlockId=`source-${documentId}`;
    await appendAuditEvent(f.env,f.stream,'user','DocumentCreated',{document_id:documentId,project_id:projectId,title:'Second native sponsored asset fixture'});
    await appendAuditEvent(f.env,f.stream,'user','BlockCreated',{document_id:documentId,project_id:projectId,block_id:sourceBlockId,
      type:'subject',handle:sourceBlockId,position:'0',properties:{text:'A second pear orchard beside a stone wall',weight:1}});
    const parsed=parseOutputRequirement({id:`output-${documentId}`,type:'Output',subtype:'Social media image',content:'1 image at aspect ratio "1:1"'});
    assert.ok(parsed.spec);const deliverable=parsed.spec.deliverables.find(value=>value.media_kind==='image');assert.ok(deliverable);
    deliverable.quantity={kind:'exact',unit:'image',value:1};deliverable.coverage={kind:'document_outline'};
    deliverable.format_variants.forEach(value=>{value.quantity={kind:'exact',unit:'image',value:1};value.required=true;});
    await responseJson(await f.send({action:'save',documentId,blockId:parsed.spec.id,spec:parsed.spec}));
    const confirmed=await responseJson(await f.send({action:'confirm',documentId}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
    const planRevisionId=confirmed.command.planRevisionId,targetId=confirmed.snapshot.confirmedPlan.plan.targets[0].id;
    const secondDriverResult=await driveSponsoredImage(f.request({documentId,planRevisionId,targetId,intentKey:'driver-intent-2'}),f.env,f.context);
    assert.equal(secondDriverResult.status,'completed');assert.notEqual(secondDriverResult.jobId,jobId);
    const secondJob=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND document_id=?')
      .get(secondDriverResult.jobId,f.actor,documentId);assert.ok(secondJob);assert.equal(secondJob.status,'completed');
    const secondSlot=f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE job_id=?').get(secondJob.job_id);assert.equal(secondSlot.status,'succeeded');
    const secondConsumption=f.sqlite.prepare('SELECT * FROM experience_sponsor_consumptions WHERE job_id=?').get(secondJob.job_id);assert.ok(secondConsumption);
    assert.equal(secondConsumption.actor_user_id,f.actor);assert.equal(secondConsumption.campaign_id,f.campaignId);
    const secondBound=await responseJson(await f.send({action:'bind',documentId,planRevisionId,targetId,nativeJobId:secondJob.job_id}));
    const secondResult=secondBound.snapshot.results.find(result=>result.id===secondBound.command.resultId);assert.ok(secondResult);
    assert.equal(secondResult.checksStatus,'passed');assert.equal(secondResult.review,'pending');
    const secondAsset=await nativeAsset(f,secondResult.assetId,documentId);
    assert.equal(secondAsset.origin.kind,'native_job');assert.equal(secondAsset.origin.jobId,secondJob.job_id);
    assert.equal(secondAsset.origin.slotId,secondSlot.slot_id);assert.equal(secondAsset.origin.completionEventId,secondSlot.outcome_event_id);
    assert.notEqual(secondAsset.assetId,adopted.assetId);assert.notEqual(secondAsset.key,adopted.key);
    otherSponsored={...secondAsset,documentId,planRevisionId,targetId,jobId:secondJob.job_id,job:secondJob,slot:secondSlot,consumption:secondConsumption,
      driverResult:secondDriverResult,bound:secondBound,boundResult:secondResult};
  }
  const generations=secondSponsored?2:1;
  assert.deepEqual(transport.counts(),{plannerCalls:generations,imageCalls:generations,safetyCalls:generations});
  let ordinaryAsset=null;
  if(ordinary){
    const bytes=png(1024,1024,93),path=`${BASE}/assets`,request=new Request(`http://localhost${path}?documentId=${encodeURIComponent(f.documentId)}`,{
      method:'POST',headers:{...f.actorHeaders,'content-type':'image/png','x-output-rights-confirmed':'true',
        'x-output-expected-revision':`output:${await streamHead(f.env,f.stream)}`,'x-output-client-mutation-id':'ordinary-output-asset-read-fixture',
        'x-output-filename':encodeURIComponent('ordinary-owned.png')},body:bytes});
    const uploaded=await responseJson(await handleOutputRequirements(request,f.env,path,f.context,outputDocumentExecutionBridge));
    ordinaryAsset=await nativeAsset(f,uploaded.command.assetId);
    assert.equal(ordinaryAsset.origin.kind,'owned_upload');assert.equal(ordinaryAsset.origin.rightsAttestedBy,f.actor);
    assert.deepEqual(ordinaryAsset.bytes,new Uint8Array(bytes));assert.notEqual(ordinaryAsset.sha256,adopted.sha256);
  }
  const slides=ordinaryNativeSlides?await nativeSlides(f,t):null;
  for(const definition of [...SCENE_SOURCE_GENERATION_TABLES,...SCENE_SOURCE_GENERATION_TRIGGERS]){
    const retained=f.sqlite.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(definition.name);
    if(retained)assert.equal(retained.sql,definition.sql);else f.sqlite.exec(definition.sql);
  }
  await captureSceneSourceVersion(f.env,{streamId:f.stream});
  for(const schema of [SPONSOR_READ_POLICY_SCHEMA,SPONSOR_READ_ATTEMPT_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  if(indexes)for(const index of [...SPONSOR_NATIVE_IMAGE_READ_INDEXES,...indexDefinitions])f.sqlite.exec(typeof index==='string'?index:index.sql);
  const installReadPolicy=async terms=>{
    const checked=readSponsorReadPolicy(terms),policyJson=canonicalJson(checked),readPolicyDigest=await digest(checked),sponsorPolicyDigest=issuance.policy_digest;
    const reviewReceiptDigest=await digest({fixture:'sponsor-read-policy',campaignId:f.campaignId,sponsorPolicyDigest,readPolicyDigest});
    f.sqlite.prepare('INSERT INTO experience_sponsor_read_policies(campaign_id,sponsor_policy_digest,read_policy_digest,policy_json,review_receipt_digest) VALUES(?,?,?,?,?)')
      .run(f.campaignId,sponsorPolicyDigest,readPolicyDigest,policyJson,reviewReceiptDigest);
    return {policy:checked,policyJson,sponsorPolicyDigest,readPolicyDigest,reviewReceiptDigest};
  };
  if(policy)await installReadPolicy(policy);

  const io={get:0,head:0,put:0,delete:0,list:0,fetch:0,history:0};
  const get=f.env.MEDIA.get.bind(f.env.MEDIA),head=f.env.MEDIA.head.bind(f.env.MEDIA),prepare=f.DB.prepare.bind(f.DB);
  f.env.MEDIA.get=async key=>{io.get++;await f.beforeMediaGet?.(key);const object=await get(key);return f.transformMedia?f.transformMedia(object,key):object;};
  f.env.MEDIA.head=async key=>{io.head++;return head(key);};
  for(const operation of ['put','delete','list'])f.env.MEDIA[operation]=()=>{io[operation]++;throw Error('Output asset reads cannot write/list media');};
  t.mock.method(globalThis,'fetch',()=>{io.fetch++;throw Error('Output asset read fixture forbids network');});
  f.DB.prepare=sql=>{if(sql.includes('page AS MATERIALIZED')||sql.includes('AS witness FROM artifact_revisions')||sql.startsWith('SELECT content,expires_at FROM private_content'))io.history++;return prepare(sql);};
  const readRequest=(assetId=adopted.assetId,{headers={},signal,documentId=f.documentId}={})=>new Request(`http://localhost${BASE}/assets/${encodeURIComponent(assetId)}?documentId=${encodeURIComponent(documentId)}`,
    {headers:{...f.actorHeaders,...headers},...(signal?{signal}:{})});
  Object.assign(f,{driverResult,job,jobId,slot,consumption,issuance,sponsorPolicyDigest:issuance.policy_digest,completionEvent,completedPayload,
    originalKey,originalBytes,beforeGeneration,bound,boundResult,adopted,otherSponsored,ordinary:ordinaryAsset,ordinaryNativeSlides:slides,assetId:adopted.assetId,assetRow:adopted.row,
    assetEvent:adopted.event,assetPrivate:adopted.privateRow,origin:adopted.origin,assetBytes:adopted.bytes,assetSha256:adopted.sha256,
    installReadPolicy,io,indexDefinitions,readRequest,snapshotNativeState:()=>snapshot(f),
    attempts:()=>f.sqlite.prepare('SELECT * FROM experience_sponsor_read_attempts ORDER BY admitted_at_ms,attempt_id').all(),
    assertNoIoWrites:()=>{for(const name of ['put','delete','list','fetch'])assert.equal(io[name],0,name);},
  });
  f.readAsset=(assetId=adopted.assetId,options={})=>handleOutputRequirements(readRequest(assetId,options),f.env,`${BASE}/assets/${encodeURIComponent(assetId)}`,f.context,outputDocumentExecutionBridge);
  f.assertReadOnly=before=>{f.assertNoIoWrites();assert.deepEqual(snapshot(f),before);};
  return f;
}
