/** Synthetic test-only original Outputs Video donor for the sharing Notes path.
 * The legacy donor remains unchanged and still demonstrates metadata refusal.
 * This independent factory uses the repository's synthetic four-second video
 * or a frozen editable Baseline black-video variant. Fixture metadata cleanup
 * precedes every provider result envelope, storage object, or native
 * completion receipt is constructed. Production never transforms these bytes.
 * Native verification, retention, storage, and strict sharing qualification are
 * the real implementations; no remote request or provider call is performed.
 */
import assert from 'node:assert/strict';
import {finishVideoFixtureJob as terminal} from '../output-video-completion-fixture.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {registerOutputSourceImports,outputTestDatabase} from '../output-execution-test-helpers.mjs';
import {createStoryboardJobTable,insertStoryboardJob} from '../output-storyboard-job-schema.mjs';
const sourceImports=registerOutputSourceImports();
let createVideoOutputContract,parseDocumentArtifactContent,prepareVideoPlannerRequest,captureOutputVideoAttempt,outputVideoMediaPrice,captureVideoPlannerEnvelope,retainOutputVideoRequestCheckpoint,retainOutputVideoMediaEnvelope,retainOutputVideoPlannerEnvelope,readOpenAITextUsage,priceCurrentOpenAITextUsage,storeGeneratedMedia,verifyOutputVideoCompletion,readOutputVideoCompletion,ensureSchema,appendEvents,makeEvent,ensureOutputRequirementsSchema,readNativeRetainedMediaCustody,videoPolicy,readRetainedOutputVideo,qualifySelectedOutputShareVideo;
try {
 ({createVideoOutputContract}=await import('../../src/model/output-video-contract.ts'));
 ({parseDocumentArtifactContent}=await import('../../src/model/document-artifacts.ts'));
 ({prepareVideoPlannerRequest}=await import('../../worker/openai-adapter.ts'));
 ({captureOutputVideoAttempt,outputVideoMediaPrice}=await import('../../worker/output-video-execution.ts'));
 ({captureVideoPlannerEnvelope}=await import('../../worker/output-video-planner-envelope.ts'));
 ({retainOutputVideoRequestCheckpoint,retainOutputVideoMediaEnvelope,retainOutputVideoPlannerEnvelope}=await import('../../worker/output-video-checkpoint.ts'));
 ({readOpenAITextUsage,priceCurrentOpenAITextUsage}=await import('../../worker/openai-text-cost.ts'));
 ({storeGeneratedMedia}=await import('../../worker/media-api.ts'));
 ({verifyOutputVideoCompletion,readOutputVideoCompletion}=await import('../../worker/output-video-completion.ts'));
 ({ensureSchema, appendEvents, makeEvent}=await import('../../worker/runtime.ts'));
 ({ensureOutputRequirementsSchema}=await import('../../worker/output-requirements-ledger.ts'));
 ({readNativeRetainedMediaCustody}=await import('../../worker/native-retained-media-custody.ts'));
 ({SELECTED_OUTPUT_SHARE_VIDEO_POLICY: videoPolicy}=await import('../../src/model/selected-output-share-video.ts'));
 ({readRetainedOutputVideo}=await import('../../worker/output-video-retained.ts'));
 ({qualifySelectedOutputShareVideo}=await import('../../src/model/selected-output-share-video.ts'));
} finally { sourceImports.deregister(); }
const OWNER='owner', PROJECT='project', EMAIL='owner@example.test';
const hash=raw=>createHash('sha256').update(raw).digest('hex');

const dataView = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const join = (...parts) => { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };
function box(type, data) { const result = new Uint8Array(data.length + 8); dataView(result).setUint32(0, result.length); result.set(new TextEncoder().encode(type), 4); result.set(data, 8); return result; }
function boxes(bytes, start = 0, end = bytes.length) {
 const result = []; let at = start;
 while (at < end) { const length = dataView(bytes).getUint32(at); assert.ok(length >= 8 && at + length <= end); result.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), start: at, data: at + 8, end: at + length }); at += length; }
 assert.equal(at, end); return result;
}
function locate(bytes, path) {
 let list = boxes(bytes), found; const types = path.split('/');
 for (let index = 0; index < types.length; index++) { const type = types[index]; found = list.find(value => value.type === type); assert.ok(found, path); if (index < types.length - 1) list = boxes(bytes, found.data + (type === 'stsd' ? 8 : type === 'avc1' ? 78 : 0), found.end); }
 return found;
}
const stbl = 'moov/trak/mdia/minf/stbl';
/** Derive only from the committed synthetic black-video donor. This is fixture
 * construction before native original evidence exists, not a runtime sanitizer.
 * Keep all encoded picture NALs, configuration, presentation timing and dimensions
 * unchanged; remove the donor's descriptive boxes, compressor name and SEI. */
export function qualifiedVideoBytes() {
 const original = new Uint8Array(readFileSync(new URL('../fixtures/video-native-four-seconds.mp4', import.meta.url)));
 assert.equal(hash(original), '487c436909764b6d3e9c4d1f9953fbe439f6eb124a00b6f19b93bdd3f223c551');
 const source = locate(original, 'mdat'), sizes = locate(original, stbl + '/stsz');
 const offsets = locate(original, stbl + '/stco'), mapping = locate(original, stbl + '/stsc');
 const count = dataView(original).getUint32(sizes.data + 8);
 assert.equal(count, 96); assert.equal(dataView(original).getUint32(sizes.data + 4), 0);
 assert.equal(dataView(original).getUint32(offsets.data + 4), 1); assert.equal(dataView(original).getUint32(offsets.data + 8), source.data);
 assert.equal(dataView(original).getUint32(mapping.data + 4), 1); assert.equal(dataView(original).getUint32(mapping.data + 8), 1);
 assert.equal(dataView(original).getUint32(mapping.data + 12), count); assert.equal(dataView(original).getUint32(mapping.data + 16), 1);
 const samples = []; let cursor = source.data;
 for (let index = 0; index < count; index++) {
  const end = cursor + dataView(original).getUint32(sizes.data + 12 + index * 4), nals = []; assert.ok(end <= source.end);
  while (cursor < end) { const length = dataView(original).getUint32(cursor), next = cursor + 4 + length; assert.ok(length > 0 && next <= end); const type = original[cursor + 4] & 31; assert.ok([1, 5, 6].includes(type)); if (type !== 6) nals.push(original.slice(cursor, next)); cursor = next; }
  assert.equal(cursor, end); assert.ok(nals.length); samples.push(join(...nals));
 }
 assert.equal(cursor, source.end);
 function rebuild(start, end) {
  return join(...boxes(original, start, end).flatMap(item => {
   if (['udta', 'btrt'].includes(item.type)) return [];
   let data = original.slice(item.data, item.end);
   if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(item.type)) data = rebuild(item.data, item.end);
   if (item.type === 'stsd') data = join(data.slice(0, 8), rebuild(item.data + 8, item.end));
   if (item.type === 'avc1') { const header = data.slice(0, 78); header.fill(0, 42, 74); data = join(header, rebuild(item.data + 78, item.end)); }
   if (item.type === 'stsz') samples.forEach((sample, index) => dataView(data).setUint32(12 + index * 4, sample.length));
   if (item.type === 'mdat') data = join(...samples);
   return [box(item.type, data)];
  }));
 }
 const result = rebuild(0, original.length), resultOffsets = locate(result, stbl + '/stco'), media = locate(result, 'mdat');
 dataView(result).setUint32(resultOffsets.data + 8, media.data);
 assert.equal(hash(result), '15e2283c3684d154def555fa90cbd159404e204508b4b9fc74acb361c10f1c40'); return result;
}

/** Frozen separate synthetic Baseline AVC donor for actual prefix-edit controls.
 * Generated offline from FFmpeg color=black:s=854x480:r=24:d=4, libx264
 * baseline/level3/yuv420p/veryslow, bframes=0:ref=1:weightp=0:threads=1:
 * sliced-threads=0:slices=1:keyint=96:min-keyint=96:scenecut=0, faststart.
 * The same fixture-only metadata/SEI cleanup preserved all 96 encoded pictures.
 * No encoder, process or filesystem dependency is used when this export runs.
 * At the retained 1000 movie timescale use endSample48 for an exact two-second
 * actual trim; endSample95 has fractional movie ticks and correctly refuses. */
export function qualifiedEditableVideoBytes() {
 const bytes=new Uint8Array(Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAQwbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAD6AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA7x0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAA1YAAAHgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAA+gAAAAAAABAAAAAAM0bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAwABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAC321pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAp9zdGJsAAAAp3N0c2QAAAAAAAAAAQAAAJdhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAA1YB4ABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBQsAe/+EAGWdCwB7aA2D3m8BEAAADAAQAAAMAwDxYuoABAAVozg8sgAAAABBwYXNwAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAAYAAAAgAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAYAAAAAEAAAGUc3RzegAAAAAAAAAAAAAAYAAABM0AAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAAAsAAAALAAAACwAAABRzdGNvAAAAAAAAAAEAAARgAAAACGZyZWUAAAjqbWRhdAAABMlliIQM8mKAALC999999999999999999999999999999999999999999999999999999dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeAAAAAB0GaIDPADKsAAAAHQZpAM8AMqwAAAAdBmmAzwAyrAAAAB0GagDPADKsAAAAHQZqgM8AMqwAAAAdBmsAzwAyrAAAAB0Ga4DPADKsAAAAHQZsAM8AMqwAAAAdBmyAzwAyrAAAAB0GbQDPADKsAAAAHQZtgM8AMqwAAAAdBm4AzwAyrAAAAB0GboDPADKsAAAAHQZvAM8AMqwAAAAdBm+AzwAyrAAAAB0GaADPADKsAAAAHQZogM8AMqwAAAAdBmkAzwAyrAAAAB0GaYDPADKsAAAAHQZqAM8AMqwAAAAdBmqAzwAyrAAAAB0GawDPADKsAAAAHQZrgM8AMqwAAAAdBmwAzwAyrAAAAB0GbIDPADKsAAAAHQZtAM8AMqwAAAAdBm2AzwAyrAAAAB0GbgDPADKsAAAAHQZugM8AMqwAAAAdBm8AzwAyrAAAAB0Gb4DPADKsAAAAHQZoAM8AMqwAAAAdBmiAzwAyrAAAAB0GaQDPADKsAAAAHQZpgM8AMqwAAAAdBmoAzwAyrAAAAB0GaoDPADKsAAAAHQZrAM8AMqwAAAAdBmuAzwAyrAAAAB0GbADPADKsAAAAHQZsgM8AMqwAAAAdBm0AzwAyrAAAAB0GbYDPADKsAAAAHQZuAM8AMqwAAAAdBm6AzwAyrAAAAB0GbwDPADKsAAAAHQZvgM8AMqwAAAAdBmgAzwAyrAAAAB0GaIDPADKsAAAAHQZpAM8AMqwAAAAdBmmAzwAyrAAAAB0GagDPADKsAAAAHQZqgM8AMqwAAAAdBmsAzwAyrAAAAB0Ga4DPADKsAAAAHQZsAM8AMqwAAAAdBmyAzwAyrAAAAB0GbQDPADKsAAAAHQZtgM8AMqwAAAAdBm4AzwAyrAAAAB0GboDPADKsAAAAHQZvAM8AMqwAAAAdBm+AzwAyrAAAAB0GaADPADKsAAAAHQZogM8AMqwAAAAdBmkAzwAyrAAAAB0GaYDPADKsAAAAHQZqAM8AMqwAAAAdBmqAzwAyrAAAAB0GawDPADKsAAAAHQZrgM8AMqwAAAAdBmwAzwAyrAAAAB0GbIDPADKsAAAAHQZtAM8AMqwAAAAdBm2AzwAyrAAAAB0GbgDPADKsAAAAHQZugM8AMqwAAAAdBm8AzwAyrAAAAB0Gb4DPADKsAAAAHQZoAM8AMqwAAAAdBmiAzwAyrAAAAB0GaQDPADKsAAAAHQZpgM8AMqwAAAAdBmoAzwAyrAAAAB0GaoDPADKsAAAAHQZrAM8AMqwAAAAdBmuAzwAyrAAAAB0GbADPADKsAAAAHQZsgM8AMqwAAAAdBm0AzwAyrAAAAB0GbYDPADKsAAAAHQZuAM8AMqwAAAAdBm6AzwAyrAAAAB0GbwC/ADKsAAAAHQZvgK8AMqw==', 'base64'));
 assert.equal(hash(bytes),'ef4f381d5c337aa0546eb399dd228cc15cae7076a842d499b2055abc27110376'); return bytes;
}

async function qualifiedVideoEvidenceFixture({referenceSha256="f".repeat(64),editable=false}={}){
 const f=outputTestDatabase();f.sqlite.exec(`CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1));
 CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT NOT NULL,created_at TEXT,expires_at TEXT,redacted_at TEXT);
 CREATE TABLE private_content_retention_scopes(content_id TEXT PRIMARY KEY,organization_id TEXT,project_access_id TEXT,project_id TEXT,actor_user_id TEXT,classification TEXT,policy_version INTEGER,assigned_expires_at TEXT,created_at TEXT);
 CREATE TABLE organization_projects(owner_user_id TEXT,project_id TEXT);
 CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);
 CREATE TABLE events(event_id TEXT,stream_id TEXT,type TEXT,payload TEXT,correlation_id TEXT,sequence INTEGER);
 CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,route_digest TEXT,grant_id TEXT,source_digest TEXT,status TEXT,outcome_event_id TEXT,updated_at TEXT);
 CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,status TEXT);
 CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,client_request_id TEXT,request_digest TEXT,status TEXT,provider_response_id TEXT,used_microusd INTEGER);`);
 createStoryboardJobTable(f.sqlite);
 const contract=createVideoOutputContract({source:{draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)},reference:{version:1,sourceProjectId:'p',sourceDocumentId:'d',sourceBlockId:'b',referenceId:'r',sha256:referenceSha256,permissionAttestation:'i-own-or-have-permission'},frameSize:'1280x720'});
 const rawPlan={title:'Pan',summary:'A still subject.',content_markdown:'One four-second silent pan.',items:[{title:'Pan',body:'The camera moves across the still subject.',notes:'Silent',image_prompt:'Original subject.',context_group_ids:[]}]};
 const artifact=parseDocumentArtifactContent(JSON.stringify(rawPlan));
 const planner=await prepareVideoPlannerRequest({},'owner',{documentTitle:'Pan',snapshot:{facts:[]},options:{productionMode:'manual',itemCount:1,videoSeconds:4,videoSize:'1280x720',videoAudioMode:'silent'}},contract);
 const mediaAttempt=await captureOutputVideoAttempt(contract,JSON.stringify({prompt:rawPlan.content_markdown,aspect_ratio:'16:9',duration:4,resolution:'480p',generate_audio:false,end_user_id:'a'.repeat(64),image_urls:['https://fal.media/original-still.png']}),'forma-video-media-original');
 const future=new Date(Date.now()+60000).toISOString(),scope={kind:'personal',key:'scope',actorUserId:'owner',ownerUserId:'owner',documentId:'doc'},slot={scopeKey:'scope',slotId:'slot',jobId:'job',routeDigest:'route',grantId:'grant',sourceDigest:'source',attemptOrdinal:0,previousSlotId:null,targetId:'target',planRevisionId:'plan',targetContractDigest:'target-contract'};
 const settings={outputVideo:contract,outputVideoPlanner:{contract,requestDigest:planner.requestDigest,maximumInputTokens:planner.maximumInputTokens}};
 const job={job_id:'job',owner_id:'owner',stream_id:'creative:owner',document_id:'doc',correlation_id:'corr',output_slot_id:'slot',attempt_count:1,kind:'render_document',status:'running',lease_expires_at:future,expires_at:future,result_json:'{}',request_json:JSON.stringify({artifactKind:'video',...settings})};
 insertStoryboardJob(f.sqlite,job);f.sqlite.prepare('INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?,NULL,NULL)').run('scope','slot','job','route','grant','source','running');
 f.sqlite.exec("INSERT INTO output_execution_grants VALUES('scope','grant','active')");
 for(const a of [planner.attempt,mediaAttempt])f.sqlite.prepare('INSERT INTO output_provider_calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('scope','slot',a.logicalCallKey,a.logicalCallKey,a===mediaAttempt?'fal':'openai',a.model,a.clientRequestId,a.requestDigest,'pending',null,null);
 const controller=new AbortController(),lease={signal:controller.signal,deadlineMs:Date.now()+30000,assertCurrent(){controller.signal.throwIfAborted();if(Date.now()>=this.deadlineMs)throw Error('lease expired');}};
 await retainOutputVideoRequestCheckpoint(f.env,scope,slot,job,planner.attempt,lease);
 const response={id:'resp_video_original',model:planner.attempt.model,status:'completed',service_tier:'default',output:[{id:'msg_original',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(rawPlan)}]}],usage:{input_tokens:100,output_tokens:30,total_tokens:130,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
 await retainOutputVideoPlannerEnvelope(f.env,scope,slot,job,await captureVideoPlannerEnvelope(Response.json(response),{clientRequestId:planner.attempt.clientRequestId,requestDigest:planner.requestDigest,model:planner.attempt.model}),lease);
 await retainOutputVideoRequestCheckpoint(f.env,scope,slot,job,mediaAttempt,lease);
 const bytes=editable?qualifiedEditableVideoBytes():qualifiedVideoBytes(),providerId='video_original',base='https://queue.fal.run/bytedance/seedance-2.0/requests/'+providerId;
 const envelopes=[['submission',{request_id:providerId},'https://queue.fal.run/'+mediaAttempt.model],['status',{request_id:providerId,status:'COMPLETED'},base+'/status'],['result',{request_id:providerId,video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:bytes.length}},base]];
 for(const [phase,body,requestUrl] of envelopes){const raw=Buffer.from(JSON.stringify(body));await retainOutputVideoMediaEnvelope(f.env,scope,slot,job,{schemaVersion:1,phase,clientRequestId:mediaAttempt.clientRequestId,requestDigest:mediaAttempt.requestDigest,providerRequestId:phase==='submission'?null:providerId,requestUrl,httpStatus:200,headers:[['content-type','application/json'],['x-fal-request-id',providerId]],decodedByteLength:raw.length,decodedBodySha256:hash(raw),decodedBodyBase64:raw.toString('base64')},lease);}
 const artifactId='artifact-original',stored=await storeGeneratedMedia(f.env,'owner',artifactId,bytes,mediaAttempt.model,'video/mp4',{artifactRole:'document-video',provider:'fal',providerJobId:providerId,providerRequestId:providerId,providerSubmissionId:mediaAttempt.clientRequestId,outputVideoRequestDigest:mediaAttempt.requestDigest});
 const plannerCost=priceCurrentOpenAITextUsage(response.model,readOpenAITextUsage(response.usage,{cachePolicy:'disabled-explicit'}),'default').totalMicrousd;
 const cp={...JSON.parse(job.result_json),artifactId,artifactPlan:artifact,plannerResponseId:response.id,providerSubmissionProtocol:1,providerSubmissions:{[planner.attempt.clientRequestId]:{clientRequestId:planner.attempt.clientRequestId,provider:'openai',operation:'planning',model:response.model,status:'completed',providerRequestId:response.id,costMicrousd:plannerCost,inputTokens:100,outputTokens:30,totalTokens:130},[mediaAttempt.clientRequestId]:{clientRequestId:mediaAttempt.clientRequestId,provider:'fal',operation:'video',model:mediaAttempt.model,status:'completed',providerRequestId:providerId,costMicrousd:outputVideoMediaPrice().maximumMicrousd,totalTokens:0}},outputVideoMediaResult:{artifactId,mediaUrl:stored.url,mediaType:'video/mp4',sha256:stored.contentHash,byteLength:bytes.length,clientRequestId:mediaAttempt.clientRequestId,providerRequestId:providerId,model:mediaAttempt.model,requestDigest:mediaAttempt.requestDigest}};
 function persist(){job.result_json=JSON.stringify(cp);f.sqlite.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=?').run(job.result_json,job.job_id);}
 persist();for(const receipt of Object.values(cp.providerSubmissions))f.sqlite.prepare("UPDATE output_provider_calls SET status='settled',provider_response_id=?,used_microusd=? WHERE client_request_id=?").run(receipt.providerRequestId,receipt.costMicrousd,receipt.clientRequestId);
 const verify=()=>verifyOutputVideoCompletion(f.env,scope,slot,job,settings,artifactId,artifact,lease),read=()=>readOutputVideoCompletion(f.env,scope,slot,job,settings,artifactId,artifact,lease);
 async function finish(status='completed',summary={}) {await terminal(f.env,job,status,{artifactId,artifactKind:'video',stage:status,...summary},status==='completed'?null:'cancelled');Object.assign(job,f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(job.job_id));}
 return {...f,contract,scope,slot,job,settings,artifact,artifactId,planner,mediaAttempt,cp,bytes,stored,lease,controller,persist,verify,read,finish};
}

export async function qualifiedVideoRetainedFixture(options={}){
 const f=await qualifiedVideoEvidenceFixture(options);f.sqlite.exec(`ALTER TABLE output_operation_slots ADD COLUMN plan_revision_id TEXT DEFAULT 'plan';
 ALTER TABLE output_operation_slots ADD COLUMN target_id TEXT DEFAULT 'target';
 ALTER TABLE output_operation_slots ADD COLUMN target_contract_digest TEXT DEFAULT 'target-contract';
 ALTER TABLE output_operation_slots ADD COLUMN attempt_ordinal INTEGER DEFAULT 0;
 ALTER TABLE output_operation_slots ADD COLUMN previous_slot_id TEXT;
 ALTER TABLE output_execution_grants ADD COLUMN actor_user_id TEXT DEFAULT 'owner';
 ALTER TABLE output_execution_grants ADD COLUMN context_id TEXT;
 ALTER TABLE output_execution_grants ADD COLUMN expires_at TEXT DEFAULT '2000-01-01T00:00:00.000Z';
 CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,owner_user_id TEXT,document_id TEXT,project_id TEXT,organization_id TEXT,project_access_id TEXT,scope_kind TEXT);
 CREATE TABLE output_native_storage_writes(scope_key TEXT,slot_id TEXT,storage_key TEXT,content_sha256 TEXT,status TEXT,write_acknowledged INTEGER,publication_event_id TEXT);
 INSERT INTO output_plan_revisions VALUES('scope','plan','owner','doc','project',NULL,NULL,'personal');
 INSERT INTO events VALUES('completion','creative:owner','DocumentRenderCompleted','{}','corr',1);`);
 const reference={scopeKey:'scope',grantId:'grant',slotId:'slot',planRevisionId:'plan',targetId:'target',targetContractDigest:'target-contract',sourceDigest:'source'};
 // Actual admission writes the reference to result_json only.
 f.cp.outputExecution=reference;f.persist();f.job.request_json=JSON.stringify({...f.settings,artifactKind:'video',productionMode:'manual',itemCount:1});
 f.sqlite.prepare('UPDATE document_jobs SET request_json=?').run(f.job.request_json);
 const {receipt}=await f.verify();
 const qualification=await qualifySelectedOutputShareVideo(f.bytes,{sha256:receipt.media.sha256,byteLength:f.bytes.length,width:receipt.media.width,height:receipt.media.height,durationSeconds:receipt.media.durationSeconds});
 assert.equal(qualification.status,'qualified',JSON.stringify(qualification));await f.finish('completed',{appendedEventIds:['completion']});
 const body={schema_version:1,artifact_id:f.artifactId,artifact_kind:'video',document_id:'doc',project_id:'project',output_video:receipt,request:{item_count:1,production_mode:'manual',source_surface:'outputs'},planner:{provider:'openai',response_id:receipt.plannerResponseId}};
 const rawContent=JSON.stringify(f.artifact),rawInput=JSON.stringify(body);
 f.sqlite.prepare("INSERT INTO private_content VALUES('input','owner','document-artifact-input',?,?,?,NULL)").run(rawInput,new Date().toISOString(),f.job.expires_at);
 const payload={document_id:'doc',project_id:'project',artifact_id:f.artifactId,artifact_kind:'video',requested_by_user_id:'owner',content_ref:'content',input_ref:'input',source_surface:'outputs',item_count:1,items:[{id:f.artifactId+'-item-1',media_url:receipt.media.mediaUrl,media_type:receipt.media.mediaType}],media_url:receipt.media.mediaUrl,media_type:receipt.media.mediaType,provider:'fal',model_id:receipt.media.model,provider_job_id:receipt.media.providerRequestId,settings:{source_media_sha256:receipt.media.sha256,item_count:1,production_mode:'manual',output_video:receipt,video_content_sha256:hash(rawContent),video_input_sha256:hash(rawInput)}};
 f.sqlite.prepare("INSERT INTO output_native_storage_writes VALUES('scope','slot',?,?,'written',1,'completion')").run(f.stored.key,receipt.media.sha256);
 const input={ownerId:'owner',completionId:'completion',documentId:'doc',projectId:'project',artifactId:f.artifactId,contentId:'content',inputId:'input',rawContent,contentExpiresAt:f.job.expires_at,completionRaw:JSON.stringify(payload)};
 const readEnv={...f.env,DB:{prepare(sql){assert.match(sql,/^\s*(SELECT|WITH)\b/u);return f.env.DB.prepare(sql);},batch(){throw Error('retained write');}}};
 return {...f,input,payload,qualification,read:()=>readRetainedOutputVideo(readEnv,input)};
}

/** Same actual-schema authorization and native reader boundary as the original
 * media authority fixture, with the independently constructed qualified donor. */
export async function qualifiedOriginalOutputsVideoFixture(t, options = {}) {
  const output = "video";
  const g = outputTestDatabase(), now = new Date().toISOString();
  let donor, expectedBytes;
  t.after(() => { donor?.sqlite.close(); g.sqlite.close(); });
  await ensureSchema(g.env); await ensureOutputRequirementsSchema(g.env);
  const insert = (table, row) => {
    const keys = Object.keys(row);
    g.sqlite.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...Object.values(row));
  };
  insert("users", { user_id: OWNER, email: EMAIL, display_name: "Synthetic media owner", role: "creator",
    consent_version: "pilot-2026-08-10", consented_at: now, created_at: now, updated_at: now });
  let documentId, artifactId, rawContent, payload, job, reference, expiry, mediaHash, model, maximumMicrousd, maximumCalls, requirementsDigest;
  const rows = {};
  {
    donor = await qualifiedVideoRetainedFixture({editable:options.editable===true});
    expectedBytes = new Uint8Array(donor.bytes);
    // The old reduced donor uses "corr". Re-observe the actual completed receipt
    // with the production attempt correlation before constructing private events.
    donor.job.correlation_id = `${donor.job.job_id}:attempt:1`;
    donor.sqlite.prepare("UPDATE document_jobs SET correlation_id=?").run(donor.job.correlation_id);
    const observed = await readOutputVideoCompletion(donor.env, donor.scope, donor.slot, donor.job, donor.settings,
      donor.artifactId, donor.artifact, donor.lease);
    donor.payload.settings.output_video = observed.receipt;
    const input = JSON.parse(donor.sqlite.prepare("SELECT content FROM private_content WHERE content_id='input'").get().content);
    input.output_video = observed.receipt;
    const rawInput = JSON.stringify(input);
    donor.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id='input'").run(rawInput);
    donor.payload.settings.video_input_sha256 = hash(rawInput);
    documentId = "doc"; artifactId = donor.artifactId; rawContent = donor.input.rawContent; payload = donor.payload;
    job = { ...donor.sqlite.prepare("SELECT * FROM document_jobs").get() };
    reference = JSON.parse(job.result_json).outputExecution;
    expiry = job.expires_at; mediaHash = hash(donor.bytes); model = donor.mediaAttempt.model;
    maximumMicrousd = 2210000; maximumCalls = 2; requirementsDigest = "fixture-requirements";
    for (const table of ["output_provider_calls", "output_native_storage_writes", "private_content"])
      rows[table] = donor.sqlite.prepare(`SELECT * FROM ${table}`).all();
  }
  const stream = `creative:${OWNER}`, correlation = `${job.job_id}:attempt:1`, routeDigest = donor.slot.routeDigest, termsDigest = "fixture-native-terms";
  const append = async (type, body, actor = `user:${OWNER}`, client = "server:output-requirements", corr = "fixture-authorize") => {
    const event = makeEvent(stream, 0, actor, client, corr, type, { document_id: documentId, project_id: PROJECT, ...body });
    await appendEvents(g.env, [event]); return event;
  };
  await append("DocumentCreated", { title: "Synthetic original media" });
  const confirmed = await append("OutputPlanConfirmed", { plan_revision_id: reference.planRevisionId, source_digest: reference.sourceDigest });
  const preflight = await append("OutputPreflightCompleted", { preflight_id: "preflight", plan_revision_id: reference.planRevisionId });
  const authorization = await append("OutputExecutionAuthorized", { actor_user_id: OWNER, grant_id: reference.grantId,
    plan_revision_id: reference.planRevisionId, preflight_id: "preflight", source_digest: reference.sourceDigest,
    maximum_microusd: maximumMicrousd, maximum_calls: maximumCalls,
    authorized_targets: [{ target_id: reference.targetId, operation_slot_id: reference.slotId, job_id: job.job_id, route_digest: routeDigest }],
    output_command_envelope: { action: "authorize", documentId, clientMutationId: "fixture-authorize", preflightId: "preflight",
      termsDigest, maximumMicrousd, explicitAuthorization: true, expectedRevision: `output:${preflight.sequence}` } });
  const completed = await append("DocumentRenderCompleted", { ...payload, ...options.completionPayload }, "worker:renderer", options.completionClientId ?? "server:document-job:render_document", correlation);
  const result = { ...JSON.parse(job.result_json), appendedEventIds: [completed.eventId] };
  Object.assign(job, { status: "completed", source_surface: "outputs", correlation_id: correlation, requested_sequence: authorization.sequence,
    requested_at: now, started_at: now, completed_at: now, error_message: null, attempt_count: 1,
    expires_at: expiry, updated_at: now, result_json: JSON.stringify(result) });
  delete job.output_slot_id;
  insert("output_plan_revisions", { scope_key: reference.scopeKey, scope_kind: "personal", owner_user_id: OWNER, project_id: PROJECT, document_id: documentId,
    plan_revision_id: reference.planRevisionId, plan_id: "fixture-plan", revision: 1, confirmed_event_id: confirmed.eventId, requirements_digest: requirementsDigest,
    source_digest: reference.sourceDigest, resolver_version: "synthetic-native", source_head: confirmed.sequence, target_count: 1, created_at: now });
  insert("output_plan_targets", { scope_key: reference.scopeKey, plan_revision_id: reference.planRevisionId, target_id: reference.targetId,
    target_contract_digest: reference.targetContractDigest, media_kind: output, required: 1, selected: 1, ordinal: 0 });
  insert("output_preflights", { scope_key: reference.scopeKey, preflight_id: "preflight", plan_revision_id: reference.planRevisionId,
    actor_user_id: OWNER, terms_digest: termsDigest, event_id: preflight.eventId, expires_at: expiry, created_at: now });
  insert("output_execution_grants", { scope_key: reference.scopeKey, grant_id: reference.grantId, plan_revision_id: reference.planRevisionId,
    actor_user_id: OWNER, payer_user_id: OWNER, preflight_id: "preflight", authorization_event_id: authorization.eventId,
    maximum_microusd: maximumMicrousd, maximum_calls: maximumCalls, status: "completed", expires_at: expiry, created_at: now });
  insert("output_operation_slots", { scope_key: reference.scopeKey, slot_id: reference.slotId, grant_id: reference.grantId,
    plan_revision_id: reference.planRevisionId, target_id: reference.targetId, target_contract_digest: reference.targetContractDigest,
    source_digest: reference.sourceDigest, provider: "fal", model, route_digest: routeDigest, job_id: job.job_id,
    cost_reservation_id: "fixture-cost", token_reservation_id: "fixture-tokens", maximum_microusd: maximumMicrousd,
    maximum_calls: maximumCalls, maximum_tokens: 100000, status: "succeeded",
    outcome_event_id: completed.eventId, created_at: now, updated_at: now });
  for (const call of rows.output_provider_calls) {
    insert("output_operation_routes", { scope_key: reference.scopeKey, slot_id: reference.slotId,
      stage_key: call.stage_key, provider: call.provider, model: call.model, maximum_calls: 1 });
    insert("output_provider_calls", { reserved_microusd: maximumMicrousd, created_at: now, settled_at: now, ...call });
  }
  for (const row of rows.output_native_storage_writes) insert("output_native_storage_writes", { ...row, publication_event_id: completed.eventId, created_at: now, updated_at: now });
  for (const row of rows.private_content) insert("private_content", row);
  insert("private_content", { content_id: "content", owner_id: OWNER, kind: "document-artifact", content: rawContent, created_at: now, expires_at: expiry, redacted_at: null });
  insert("document_jobs", job);
  assert.equal(g.sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.deepEqual(g.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  const stats = { gets: 0, heads: 0, writes: 0 }, statements = []; let beforeRead = null;
  const env = { ...g.env, DB: { prepare(sql) {
    assert.match(sql, /^\s*(?:SELECT|WITH)\b/u); assert.ok(Buffer.byteLength(sql) <= 100000);
    const wrap = bindings => ({ bind(...values) { assert.ok(values.length <= 100); return wrap(values); },
      async first() { statements.push({ sql, bindings: [...bindings] }); await beforeRead?.(sql, bindings); return g.DB.prepare(sql).bind(...bindings).first(); },
      async all() { statements.push({ sql, bindings: [...bindings] }); await beforeRead?.(sql, bindings); return g.DB.prepare(sql).bind(...bindings).all(); },
      run() { stats.writes++; throw Error("authority must not write"); } });
    return wrap([]);
  }, batch() { stats.writes++; throw Error("authority must not write"); } }, MEDIA: {
    async get(key) { stats.gets++; return donor.env.MEDIA.get(key); },
    head() { stats.heads++; throw Error("unexpected media head"); }, put() { stats.writes++; throw Error("unexpected media write"); }, delete() { stats.writes++; throw Error("unexpected media delete"); },
  } };
  const identity = { userId: OWNER, email: EMAIL, source: "openai-workspace" }, controller = new AbortController();
  const selection = { output, documentId, artifactId, revision: 0, contentSha256: hash(rawContent), mediaSha256: mediaHash, policy: videoPolicy };
  return { ...g, env, identity, selection, stats, statements, completed, authorization, reference, jobId: job.job_id, controller,
    expectedBytes: new Uint8Array(expectedBytes), originalRaw: rawContent, originalUrl: payload.media_url, expiry,
    appendSynthetic: append,
    read: (selected = selection) => readNativeRetainedMediaCustody(env, identity, selected, controller.signal), insert,
    changes: () => g.sqlite.prepare("SELECT total_changes() AS n").get().n,
    setBeforeRead(fn) { beforeRead = fn; },
    mutateJob(column, change) { const row = g.sqlite.prepare(`SELECT ${column} AS value FROM document_jobs WHERE job_id=?`).get(job.job_id);
      const value = JSON.parse(row.value); change(value); g.sqlite.prepare(`UPDATE document_jobs SET ${column}=? WHERE job_id=?`).run(JSON.stringify(value), job.job_id); },
    mutateAuthorization(change) { const value = JSON.parse(g.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(authorization.eventId).private_json);
      change(value); g.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(value), authorization.eventId); },
  };
}
