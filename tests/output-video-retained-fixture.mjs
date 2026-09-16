import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {videoEvidenceFixture} from './output-video-completion-fixture.mjs';
const {readRetainedOutputVideo}=await import('../worker/output-video-retained.ts');
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function videoRetainedFixture(){
 const f=await videoEvidenceFixture();f.sqlite.exec(`ALTER TABLE output_operation_slots ADD COLUMN plan_revision_id TEXT DEFAULT 'plan';
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
 const {receipt}=await f.verify();await f.finish('completed',{appendedEventIds:['completion']});
 const body={schema_version:1,artifact_id:f.artifactId,artifact_kind:'video',document_id:'doc',project_id:'project',output_video:receipt,request:{item_count:1,production_mode:'manual',source_surface:'outputs'},planner:{provider:'openai',response_id:receipt.plannerResponseId}};
 const rawContent=JSON.stringify(f.artifact),rawInput=JSON.stringify(body);
 f.sqlite.prepare("INSERT INTO private_content VALUES('input','owner','document-artifact-input',?,?,?,NULL)").run(rawInput,new Date().toISOString(),f.job.expires_at);
 const payload={document_id:'doc',project_id:'project',artifact_id:f.artifactId,artifact_kind:'video',requested_by_user_id:'owner',content_ref:'content',input_ref:'input',source_surface:'outputs',item_count:1,items:[{id:f.artifactId+'-item-1',media_url:receipt.media.mediaUrl,media_type:receipt.media.mediaType}],media_url:receipt.media.mediaUrl,media_type:receipt.media.mediaType,provider:'fal',model_id:receipt.media.model,provider_job_id:receipt.media.providerRequestId,settings:{source_media_sha256:receipt.media.sha256,item_count:1,production_mode:'manual',output_video:receipt,video_content_sha256:hash(rawContent),video_input_sha256:hash(rawInput)}};
 f.sqlite.prepare("INSERT INTO output_native_storage_writes VALUES('scope','slot',?,?,'written',1,'completion')").run(f.stored.key,receipt.media.sha256);
 const input={ownerId:'owner',completionId:'completion',documentId:'doc',projectId:'project',artifactId:f.artifactId,contentId:'content',inputId:'input',rawContent,contentExpiresAt:f.job.expires_at,completionRaw:JSON.stringify(payload)};
 const readEnv={...f.env,DB:{prepare(sql){assert.match(sql,/^\s*(SELECT|WITH)\b/u);return f.env.DB.prepare(sql);},batch(){throw Error('retained write');}}};
 return {...f,input,payload,read:()=>readRetainedOutputVideo(readEnv,input)};
}
