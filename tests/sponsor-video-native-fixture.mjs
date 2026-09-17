import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';

// This fixture imports real modules and executes native canonical intake,
// SAVE, CONFIRM and preflight. Only the disposable R2 image is synthetic.
const imports=registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{appendEvents,makeEvent,streamHead},
  {loadOutputTrustedContext,outputDigest},{handleExperienceIntake},{handleExperienceOutput},
  {registeredExperience},{outputDocumentExecutionBridge},{VIDEO_OUTPUT_POLICY},{VIDEO_ADAPTER_CONTRACT},
  {OUTPUT_VIDEO_EXECUTION_POLICY},{OUTPUT_VIDEO_TRANSPORT,outputVideoMediaPrice},
  {VIDEO_PLANNER_MODEL},{OPENAI_TEXT_PRICING_VERSION,estimateOpenAITextCallMaximumMicrousd}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/experience-intake-api.ts'),import('../worker/experience-output-api.ts'),
  import('../src/experiences/intake.ts'),import('../worker/output-document-execution.ts'),
  import('../src/model/output-video-contract.ts'),import('../src/model/video-adapter.ts'),
  import('../src/model/output-execution-policy.ts'),import('../worker/output-video-execution.ts'),
  import('../worker/output-video-planner.ts'),import('../worker/openai-text-cost.ts'),
]);
const actor='dev-local-creative',stream=`creative:${actor}`,path='/api/output-requirements';
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tableRows=f=>f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]);
const snapshot=f=>({rows:tableRows(f),changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,
  schema:f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
  media:[...f.media].map(([key,value])=>({key,sha256:sha(value.bytes),metadata:structuredClone(value.metadata),contentType:value.contentType}))});

function noWrites(f){
  const prepare=f.DB.prepare.bind(f.DB);let attempted=0;
  f.DB.prepare=sql=>{if(!/^\s*SELECT\b/iu.test(sql)){attempted++;throw Error('Evidence attempted non-read SQL');}return prepare(sql);};
  return ()=>assert.equal(attempted,0,'No SQL write attempt, including no-op SQL, may occur during evidence reads');
}
function assertUnpaid(f){
  for(const name of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,0,name);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'experience_sponsor_%'").get().n,0);
  assert.equal(f.io.network,0);assert.equal(f.io.assets,0);assert.equal(f.io.detached,0);
}
async function fixture(t,{frame='landscape',configuration={},motion='Slow camera push. Keep the subject stationary.'}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  const io={network:0,assets:0,detached:0,media:[],bytesRead:0};
  t.mock.method(globalThis,'fetch',()=>{io.network++;throw Error('No network in dormant Video evidence qualification');});
  Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra',FAL_KEY:'synthetic-presence-no-egress'},configuration);
  f.env.ASSETS.fetch=()=>{io.assets++;throw Error('No asset fetch');};
  assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  const bytes=new Uint8Array(png),contentHash=sha(bytes),key=`u-${Buffer.from(actor).toString('hex')}/sponsor-video-synthetic.png`,url='/api/media/'+key;
  await f.env.MEDIA.put(key,bytes,{customMetadata:{ownerId:actor,sha256:contentHash},httpMetadata:{contentType:'image/png'}});
  // Track exact operations without HEAD implicitly issuing an extra GET.
  const object=()=>{const value=f.media.get(key);return value?{size:value.bytes.length,customMetadata:structuredClone(value.metadata),httpEtag:'test-etag',
    writeHttpMetadata(headers){headers.set('content-type',value.contentType);}}:null;};
  f.env.MEDIA.head=async requested=>{assert.equal(requested,key);io.media.push('head');await f.afterHead?.();return object();};
  f.env.MEDIA.get=async requested=>{assert.equal(requested,key);io.media.push('get');await f.afterGet?.();const value=f.media.get(key),metadata=object();return value?{...metadata,
    body:new ReadableStream({start(controller){const copy=value.bytes.slice();io.bytesRead+=copy.length;controller.enqueue(copy);controller.close();}})}:null;};
  for(const method of ['put','delete','list'])f.env.MEDIA[method]=()=>{io.media.push(method);throw Error(`No media ${method} after synthetic setup`);};
  const reference={version:1,sourceProjectId:'source-project',sourceDocumentId:'source-document',sourceBlockId:'source-block',referenceId:'reference',sha256:contentHash,permissionAttestation:'i-own-or-have-permission'};
  const properties={reference_id:reference.referenceId,source_content_hash:contentHash,media_url:url,media_type:'image/png',pixel_reference_mode:'preserve_style',weight:1,rights_class:'owned'};
  const sourceEvents=[['ProjectCreated',{project_id:reference.sourceProjectId,name:'Synthetic source'}],
    ['DocumentCreated',{project_id:reference.sourceProjectId,document_id:reference.sourceDocumentId,title:'Synthetic source'}],
    ['BlockCreated',{project_id:reference.sourceProjectId,document_id:reference.sourceDocumentId,block_id:reference.sourceBlockId,scope:'document',type:'reference',handle:'reference/still',position:'a0',properties}],
    ['ReferenceIngested',{reference_id:reference.referenceId,source_ref:url,content_hash:contentHash,rights_class:'owned'}],['RightsAsserted',{reference_id:reference.referenceId,rights_class:'owned'}]];
  await appendEvents(f.env,sourceEvents.map(([type,payload])=>makeEvent(stream,0,`user:${actor}`,'test','source',type,payload)));
  const release=await registeredExperience('video');assert.ok(release);
  const intent={experienceId:'video',intentId:'00000000-0000-4000-8000-000000000096',releaseHash:release.releaseHash,
    values:{motion:{value:motion,provenance:'authored'},frame:{value:frame,provenance:'authored'}},reference};
  let response=await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intent)),f.env);
  assert.equal(response.status,200,await response.clone().text());const {plan}=await response.json();
  response=await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/commit`,post({draftHash:plan.draftHash})),f.env);
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');
  const executionContext={waitUntil(){io.detached++;throw Error('No detached work');}};
  response=await handleExperienceOutput(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/output/prepare`,post({draftHash:plan.draftHash,explicitRequirementsConfirmation:true})),f.env,executionContext,outputDocumentExecutionBridge);
  assert.equal(response.status,200,await response.clone().text());const ready=await response.json();assert.ok(ready.preflight,JSON.stringify(ready));
  const row=f.sqlite.prepare('SELECT p.*,body.private_json FROM output_preflights p JOIN event_private_payloads body ON body.private_event_id=p.event_id').get();assert.ok(row);
  const terms=JSON.parse(row.private_json).preflight;
  const command={documentId:plan.documentId,action:'authorize',expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:'video-sponsored-authorize',
    preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const request=new Request(`http://localhost${path}`,post(command)),trusted=await loadOutputTrustedContext(request,f.env,plan.documentId,'request');assert.ok(!(trusted instanceof Response));
  Object.assign(f,{io,bytes,key,url,reference,plan,documentId:plan.documentId,projectId:plan.projectId,terms,command,request,trusted,executionContext});
  assertUnpaid(f);return f;
}
async function alterQuote(f,change){
  const row=f.sqlite.prepare('SELECT event_id FROM output_preflights WHERE preflight_id=?').get(f.command.preflightId);
  const original=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(row.event_id).private_json;
  const body=JSON.parse(original);change(body.preflight);const {termsDigest:ignored,...rest}=body.preflight;void ignored;
  body.preflight.termsDigest=await outputDigest(rest);f.command.termsDigest=body.preflight.termsDigest;
  f.sqlite.prepare('UPDATE output_preflights SET terms_digest=?,expires_at=? WHERE event_id=?').run(body.preflight.termsDigest,body.preflight.expiresAt,row.event_id);
  f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),row.event_id);
  return {eventId:row.event_id,original};
}
function template(recipe){return {version:1,family:'canonical-owned-still-video@1',appId:'video',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,
  outputKind:'video',inputMode:'authorized-document-one-owned-still',outputCount:1,durationMs:4000,width:0,height:0,
  route:'document-video-owned-still-four-seconds-manual-v1',maximumCalls:2,maximumTokens:152000,maximumInputTokens:61000,maximumOutputTokens:3000,
  maximumMicrousd:estimateOpenAITextCallMaximumMicrousd(VIDEO_PLANNER_MODEL,61000,3000)+outputVideoMediaPrice().maximumMicrousd,
  plannerModel:VIDEO_PLANNER_MODEL,videoModel:OUTPUT_VIDEO_TRANSPORT.model,transport:structuredClone(OUTPUT_VIDEO_TRANSPORT),contract:VIDEO_OUTPUT_POLICY,frameSizes:['1280x720','720x1280'],
  maximumReferenceBytes:VIDEO_ADAPTER_CONTRACT.maxReferenceBytes,maximumResultBytes:OUTPUT_VIDEO_TRANSPORT.maximumResultBytes,
  referenceMimeTypes:['image/png','image/jpeg','image/webp'],pricingVersion:OPENAI_TEXT_PRICING_VERSION,videoPricingVersion:outputVideoMediaPrice().pricingVersion,
  adapterVersion:VIDEO_ADAPTER_CONTRACT.adapterVersion,promptAdapterVersion:VIDEO_ADAPTER_CONTRACT.promptAdapterVersion,
  cachePolicy:'disabled-explicit',reasoningEffort:'low',executionPolicy:OUTPUT_VIDEO_EXECUTION_POLICY};}
export {fixture,snapshot,noWrites,assertUnpaid,alterQuote,template,actor,stream,post,imports};
