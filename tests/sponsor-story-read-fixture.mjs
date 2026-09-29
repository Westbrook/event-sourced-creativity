import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture as driverFixture,transport,actor,payer,stream,post} from './sponsor-story-driver-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const [{driveSponsoredStory},{loadOutputTrustedContext},{runDocumentJob},{handleRetainedStoryRead},
  {retainedStoryRequestPath},{nativeStoryCompletionPath},{handleArtifactEdit},{appendAuditEvent}]=await Promise.all([
  import('../worker/experience-sponsor-story-driver.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/document-jobs-api.ts'),import('../worker/retained-story-api.ts'),
  import('../src/model/retained-short-story.ts'),import('../src/model/native-short-story-generation.ts'),
  import('../worker/artifact-api.ts'),import('../worker/runtime.ts'),
]);
export {actor,payer,stream,handleRetainedStoryRead};
export const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
export const defaultIoPolicy=()=>({version:1,family:'canonical-short-story-io@1',purpose:'selected-result',windowMs:60_000,
  operations:{'short-story-status':{maximumBytes:2_097_152,deadlineMs:30_000},'short-story-result':{maximumBytes:2_097_152,deadlineMs:30_000}},
  actor:{maximumRequestsPerWindow:50,maximumBytesPerWindow:104_857_600},campaign:{maximumRequestsPerWindow:100,maximumBytesPerWindow:209_715_200}});
const financialTables=['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls'];
export const finances=f=>Object.fromEntries(financialTables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
export const attempts=f=>f.sqlite.prepare('SELECT * FROM experience_sponsor_story_io_attempts ORDER BY attempt_id').all();
export const nativeQuery={principal:sql=>sql.includes('SELECT auth_json FROM authorized'),history:sql=>sql.includes('SELECT * FROM event_rows ORDER BY sequence'),
  content:sql=>sql.includes('SELECT content,expires_at FROM private_content'),final:sql=>sql.includes('SELECT 1 AS admitted FROM private_content')};

/** Instrument the existing local DB object without supplying replacement rows.
 * Hooks run around its real statement or transaction and preserve execute/bind.
 * The observer starts after synthetic generation and actual IO approval. */
export function observe(f){
  const db=f.env.DB,prepare=db.prepare,batch=db.batch,trace=[];
  const observer={trace,before:null,after:null,clear(){trace.length=0;},restore(){db.prepare=prepare;db.batch=batch;f.env.DB=db;}};
  db.prepare=function(sql){
    const wrap=statement=>{
      const bind=statement.bind;statement.bind=function(...values){return wrap(bind.apply(this,values));};
      for(const method of ['first','all','run']){
        const invoke=statement[method];statement[method]=async function(...args){
          const entry={kind:method,sql,bindings:[...this.bindings]};trace.push(entry);
          if(observer.before)await observer.before(entry);
          const value=await invoke.apply(this,args);entry.result=value;
          if(observer.after)await observer.after(entry,value);return value;
        };
      }
      return statement;
    };
    return wrap(prepare.call(this,sql));
  };
  db.batch=async function(statements){
    const entry={kind:'batch',statements:statements.map(statement=>({sql:statement.sql,bindings:[...statement.bindings]}))};trace.push(entry);
    if(observer.before)await observer.before(entry);
    const result=await batch.call(this,statements);entry.result=result;
    if(observer.after)await observer.after(entry,result);return result;
  };
  return observer;
}
export const statements=observer=>observer.trace.flatMap(entry=>entry.statements??[entry]);

/** Real payer-reviewed IO allocation, independent of the original generation
 * approval. All identities, allocation rows and financial rows are disposable. */
export async function approveIo(f,{ioPolicy=f.ioPolicy,approvalId='fixture-story-result-io-approval'}={}){
  const {prepareSponsorStoryIoApproval,approveSponsorStoryIoPolicy}=await import('../worker/experience-sponsor-story-io-approval.ts');
  const proposal={version:1,family:'canonical-short-story-io@1',campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,ioPolicy};
  const prepared=await prepareSponsorStoryIoApproval(new Request('http://localhost/__fixture/story-io-prepare',post({action:'prepare-sponsor-story-io-policy',proposal},f.payerHeaders)),f.env);
  const approval=await approveSponsorStoryIoPolicy(new Request('http://localhost/__fixture/story-io-approve',post({action:'approve-sponsor-story-io-policy',approvalId,proposal,
    reviewedTermsDigest:prepared.termsDigest,confirmation:'APPROVE_SPONSOR_STORY_IO_POLICY'},f.payerHeaders)),f.env);
  Object.assign(f,{ioPolicy,ioProposal:proposal,ioPrepared:prepared,ioApproval:approval});return approval;
}

/** Native confirmed Story -> actual C foreground driver -> original slot
 * completion -> exact retained JSON. No prebuilt completion, grant or IO row.
 * The ordinary comparator uses the same native preflight/run with actor funds. */
export async function fixture(t,{approved=true,ioPolicy=defaultIoPolicy(),ordinary=false,strict=false}={}){
  const calls=transport(t),f=await driverFixture(t);
  if(ordinary){
    const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:f.planRevisionId,targetIds:[f.targetId]}));
    const quote=preflight.command.preflight;
    await f.ok(await f.send({action:'authorize',preflightId:quote.id,termsDigest:quote.termsDigest,maximumMicrousd:quote.maximumMicrousd,explicitAuthorization:true}));
    const grant=f.sqlite.prepare('SELECT grant_id FROM output_execution_grants').get();assert.ok(grant);
    await f.ok(await f.send({action:'run',grantId:grant.grant_id}));
    const trusted=await loadOutputTrustedContext(f.request(),f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
    const job=f.sqlite.prepare('SELECT job_id FROM document_jobs').get();assert.ok(job);
    assert.equal((await runDocumentJob(f.env,trusted.principal,job.job_id)).status,'completed');
  }else assert.equal((await driveSponsoredStory(f.request(),f.env,f.context)).status,'completed');
  assert.equal(calls.length,1);
  const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();assert.ok(slot?.outcome_event_id);
  const completion=f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(slot.outcome_event_id);assert.equal(completion.type,'DocumentRenderCompleted');
  const privateCompletion=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(completion.event_id);assert.ok(privateCompletion);
  const payload=JSON.parse(privateCompletion.private_json),job=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(slot.job_id);
  assert.equal(payload.document_id,f.documentId);assert.equal(payload.requested_by_user_id,actor);assert.equal(payload.artifact_kind,'short_story');
  const artifactId=payload.artifact_id,contentId=payload.content_ref;
  const raw=()=>f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=? AND owner_id=?').get(contentId,actor).content;
  const revision=()=>f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type='DocumentArtifactEdited' AND json_extract(payload,'$.artifact_id')=?").get(stream,artifactId).n;
  const selection=(selectedRevision=revision())=>({documentId:f.documentId,artifactId,revision:selectedRevision,contentSha256:hash(raw())});
  const readRequest=(selected=selection(),{headers={},method='GET',signal}={})=>new Request(`https://forma.test${retainedStoryRequestPath(selected)}`,
    {method,headers:{...f.actorHeaders,...headers},...(signal?{signal}:{})});
  const legacyRequest=({headers={},signal}={})=>new Request(`https://forma.test${nativeStoryCompletionPath({documentId:f.documentId,jobId:job.job_id})}`,
    {headers:{...f.actorHeaders,...headers},...(signal?{signal}:{})});
  const read=(selected=selection(),options)=>handleRetainedStoryRead(readRequest(selected,options),f.env);
  const edit=async(markdown,expectedRevision=revision())=>{
    const response=await handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${artifactId}`,{method:'PATCH',
      headers:{...f.actorHeaders,'content-type':'application/json',origin:'https://forma.test'},body:JSON.stringify({markdown,expectedRevision})}),f.env,artifactId);
    assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const append=(type,body)=>appendAuditEvent(f.env,stream,'user',type,{document_id:f.documentId,project_id:payload.project_id,...body});
  Object.assign(f,{calls,ordinary,slot,job,jobId:job.job_id,sponsorPolicyDigest:f.compiled.policyDigest,completion,privateCompletion,payload,
    artifactId,contentId,raw,revision,selection,readRequest,legacyRequest,read,edit,append,ioPolicy});
  const [{SPONSOR_NATIVE_STORY_READ_INDEXES},{SPONSOR_STORY_IO_POLICY_SCHEMA},{SPONSOR_STORY_IO_APPROVAL_SCHEMA},{SPONSOR_STORY_IO_ATTEMPT_SCHEMA}]=await Promise.all([
    import('../worker/experience-sponsor-native-story-read.ts'),import('../worker/experience-sponsor-story-io-policy.ts'),
    import('../worker/experience-sponsor-story-io-approval.ts'),import('../worker/experience-sponsor-story-io-attempts.ts'),
  ]);
  for(const index of SPONSOR_NATIVE_STORY_READ_INDEXES)f.sqlite.exec(index.sql);
  for(const schema of [SPONSOR_STORY_IO_POLICY_SCHEMA,SPONSOR_STORY_IO_APPROVAL_SCHEMA,SPONSOR_STORY_IO_ATTEMPT_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  if(strict){f.limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>f.limits.restore());}
  f.approveIo=options=>approveIo(f,options);if(approved&&!ordinary)await f.approveIo();
  f.observer=observe(f);t.after(()=>f.observer.restore());return f;
}
