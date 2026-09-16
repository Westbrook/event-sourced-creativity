import assert from 'node:assert/strict';
import {videoEvidenceFixture} from './output-video-completion-fixture.mjs';
import {outputTestDatabase} from './output-execution-test-helpers.mjs';
const {ensureSchema,appendAuditEvent}=await import('../worker/runtime.ts');
const {ensureOutputRequirementsSchema,outputSlotFromRow}=await import('../worker/output-requirements-ledger.ts');
const {prepareBudgetReservation,prepareCostBudgetReservation}=await import('../worker/pilot-policy.ts');
const {executeOutputVideoRecovery}=await import('../worker/output-video-recovery.ts');

/** Real runtime/output DDL and event writer. Only original admission and the
 * current-source assertion are explicit fixture setup, not HTTP acceptance. */
export async function videoRecoveryFixture({published=false,referenceSha256}={}){
 const original=await videoEvidenceFixture({referenceSha256}),f=outputTestDatabase();
 await ensureSchema(f.env);await ensureOutputRequirementsSchema(f.env);
 const now=new Date().toISOString(),insert=(table,row)=>{const cols=new Set(f.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));const entries=Object.entries(row).filter(([key])=>cols.has(key));return f.sqlite.prepare(`INSERT INTO ${table}(${entries.map(([k])=>k).join(',')}) VALUES(${entries.map(()=>'?').join(',')})`).run(...entries.map(([,v])=>v));};
 insert('users',{user_id:'owner',email:'owner@example.test',display_name:'Owner',role:'creator',created_at:now,updated_at:now});
 const anchor=await appendAuditEvent(f.env,'creative:owner','user','DocumentCreated',{document_id:'doc',project_id:'project',title:'Pan'});
 const reference={scopeKey:'scope',grantId:'grant',slotId:'slot',planRevisionId:'plan',targetId:'target',targetContractDigest:'target-contract',sourceDigest:'source'};
 original.cp.outputExecution=reference;
 const mediaId=original.mediaAttempt.clientRequestId;
 original.cp.providerSubmissions[mediaId].inputTokens=0;original.cp.providerSubmissions[mediaId].outputTokens=0;
 if(!published){original.cp.outputVideoMediaEnvelopes=original.cp.outputVideoMediaEnvelopes.slice(0,1);delete original.cp.outputVideoMediaResult;original.cp.providerSubmissions[mediaId].status='accepted';delete original.cp.providerSubmissions[mediaId].costMicrousd;}
 original.persist();original.sqlite.exec("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL WHERE provider='fal'");
 const settings={...original.settings,artifactKind:'video',productionMode:'manual',itemCount:1};
 original.job.request_json=JSON.stringify(settings);original.sqlite.prepare("UPDATE document_jobs SET request_json=?,source_surface='outputs'").run(original.job.request_json);
 await original.finish('failed');
 for(const row of original.sqlite.prepare('SELECT * FROM private_content').all())insert('private_content',row);
 const job={...original.sqlite.prepare('SELECT * FROM document_jobs').get(),output_slot_id:'slot'};insert('document_jobs',job);
 const context={streamId:job.stream_id,correlationId:job.correlation_id,operation:'document-render:video',period:now.slice(0,7)};
 const token=await prepareBudgetReservation(f.env,'owner',152000,{...context,reservationId:'token:video'}),cost=await prepareCostBudgetReservation(f.env,'owner',600000,{...context,reservationId:'cost:video',maximumMicrousd:600000,allowUserOverage:false});assert(token.ok&&cost.ok);
 await f.env.DB.batch([...token.statements,...cost.statements]);
 insert('output_plan_revisions',{scope_key:'scope',scope_kind:'personal',owner_user_id:'owner',project_id:'project',document_id:'doc',plan_revision_id:'plan',plan_id:'plan',revision:1,confirmed_event_id:anchor.eventId,requirements_digest:'requirements',source_digest:'source',resolver_version:'fixture',source_head:1,target_count:1,created_at:now});
 insert('output_plan_targets',{scope_key:'scope',plan_revision_id:'plan',target_id:'target',target_contract_digest:'target-contract',media_kind:'video',required:1,selected:1,ordinal:0});
 insert('output_preflights',{scope_key:'scope',preflight_id:'preflight',plan_revision_id:'plan',actor_user_id:'owner',terms_digest:'terms',event_id:anchor.eventId,expires_at:job.expires_at,created_at:now});
 insert('output_execution_grants',{scope_key:'scope',grant_id:'grant',plan_revision_id:'plan',actor_user_id:'owner',payer_user_id:'owner',preflight_id:'preflight',authorization_event_id:anchor.eventId,maximum_microusd:600000,maximum_calls:2,status:'active',expires_at:job.expires_at,created_at:now});
 insert('output_operation_slots',{scope_key:'scope',slot_id:'slot',grant_id:'grant',plan_revision_id:'plan',target_id:'target',target_contract_digest:'target-contract',source_digest:'source',provider:'fal',model:original.mediaAttempt.model,route_digest:'route',job_id:'job',cost_reservation_id:cost.reservationId,token_reservation_id:token.reservationId,maximum_microusd:600000,maximum_calls:2,maximum_tokens:152000,status:'uncertain',created_at:now,updated_at:now});
 for(const row of original.sqlite.prepare('SELECT * FROM output_provider_calls').all()){
  insert('output_operation_routes',{scope_key:'scope',slot_id:'slot',stage_key:row.stage_key,provider:row.provider,model:row.model,maximum_calls:1});
  insert('output_provider_calls',{...row,reserved_microusd:row.provider==='fal'?538020:1000,created_at:now});
 }
 if(published)for(const [key,value] of original.media)f.media.set(key,value);
 const scope={...original.scope,projectId:'project',organizationId:null,projectAccessId:null,contextId:null};
 const slot=outputSlotFromRow('scope',f.sqlite.prepare('SELECT * FROM output_operation_slots').get()),binding={scope,slot,retentionPolicy:null};
 const assertions=[{sql:'1=1',bindings:[],deadlineMs:Date.now()+45000}];
 const user={userId:'owner',billingUserId:'owner',streamId:'creative:owner'};
 const run=(signal)=>executeOutputVideoRecovery({...f.env,FAL_KEY:'offline-test-key'},user,{...f.sqlite.prepare('SELECT * FROM document_jobs').get(),output_slot_id:'slot'},binding,{assertions,signal});
 return {...f,original,job,scope,slot,binding,user,assertions,run,settings,close(){f.sqlite.close();original.sqlite.close();}};
}
