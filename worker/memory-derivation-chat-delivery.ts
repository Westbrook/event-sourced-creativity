import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryCanonical } from './memory-sql.ts';
import { AssistantContextReadWitness } from './assistant-context-source.ts';
import { captureLegacyConversationOriginalWindows, replayLegacyConversationOriginals, prepareLegacyConversationOriginalsCommit } from './events-api.ts';
import { liveMemoryAuthority, liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from './memory-live-authority.ts';
import { DERIVATION_CURSOR_COLUMNS } from './memory-derivation-job-schema.ts';
import { DERIVATION_PRODUCER_CURSOR_COLUMNS } from './memory-derivation-producer-schema.ts';
import { DERIVATION_GRANT_COLUMNS, derivationAssertion, derivationResults, derivationVerified, derivationChanged, derivationRowGuard,
  derivationQualificationGuard, memoryDerivationSchema, memoryDerivationEnabled, memoryDerivationBinding, memoryDerivationGrantShape, readDerivationQualification } from './memory-derivation-store.ts';
import { derivationExact, derivationInteger, derivationTime } from './memory-derivation-policy.ts';
import type { WorkerEnv } from './runtime.ts';

type Row=Record<string,unknown>;
const clock="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const fail=():never=>{throw Error('memory-chat-delivery-unavailable');};
/** Candidate pointer predicate only. No private body or source authority. This
 * keeps the existing maintenance pass from deleting another producer's queue. */
export function nativeChatStudioMemoryCandidates(e:LiveMemoryEnrollment){
  return {joins:'FROM events event',condition:`event.stream_id=? AND event.type='AssistantReasoned' AND event.actor='model:forma-chat'
    AND json_extract(event.payload,'$.document_id')=? AND json_extract(event.payload,'$.operation')='creative-chat'
    AND json_extract(event.payload,'$._private_ref')=event.event_id AND json_type(event.payload,'$.memory_origin_version') IS NULL`,
    bindings:[`creative:${e.owner_user_id}`,e.document_id]};
}

/** Independent reference delivery, not enrollment, a provider call, or completed
 * processing. One WHOLE original pair per purpose per invocation. The native
 * source proof is replayed around every write in the same atomic transaction.
 * Lost acknowledgements are resolved by the durable producer cursor next time. */
export async function registerNativeChatStudioDerivationBacklog(env:WorkerEnv,enrollment:LiveMemoryEnrollment){
  const empty={registeredPurposes:0,capacityPurposes:0};
  if(env.FORMA_MEMORY_SCHEDULING_ENABLED!=='true'||!memoryDerivationEnabled(env,enrollment.actor_user_id)
    ||!enrollment.learn_enabled||!enrollment.background_enabled)return empty;
  const settings=()=>memoryCanonical([memoryDerivationBinding(env),env.FORMA_MEMORY_ENABLED,env.FORMA_MEMORY_USER_IDS,
    env.FORMA_MEMORY_DERIVATION_ENABLED,env.FORMA_MEMORY_DERIVATION_USER_IDS,env.FORMA_MEMORY_SCHEDULING_ENABLED]);
  const configured=settings(),db=env.DB,e=structuredClone(enrollment),key=memoryCanonical(enrollment),schema=await memoryDerivationSchema(env);
  if(!schema.producersPresent)return empty;
  const current=()=>env.DB===db&&settings()===configured&&memoryCanonical(enrollment)===key&&env.FORMA_MEMORY_SCHEDULING_ENABLED==='true'&&memoryDerivationEnabled(env,e.actor_user_id);
  const a=await liveMemoryAuthority(env,e);if(!a||!current())return fail();
  const result=await db.prepare(`SELECT ${DERIVATION_GRANT_COLUMNS.join(',')} FROM memory_derivation_grants
    WHERE enrollment_id=? AND enrollment_revision=? AND revoked_at IS NULL AND background_enabled=1 AND expires_at>${clock} ORDER BY purpose LIMIT 4`)
    .bind(e.enrollment_id,e.revision).all<Row>();
  if(!current()||!derivationResults([result],1)||result.results.length>3||!result.results.every(memoryDerivationGrantShape))return fail();
  let registeredPurposes=0,capacityPurposes=0;
  for(const g of result.results){
    if(memoryCanonical([g.actor_user_id,g.owner_user_id,g.organization_id,g.project_access_id,g.project_id,g.document_id,g.permission_epoch])
      !==memoryCanonical([e.actor_user_id,e.owner_user_id,e.organization_id,e.project_access_id,e.project_id,e.document_id,e.permission_epoch]))return fail();
    const qualification=await readDerivationQualification(env,g.qualification_id);
    if(!qualification||qualification.row.terms_sha256!==g.terms_sha256||qualification.terms.purpose!==g.purpose||qualification.terms.monthlyCapMicroUsd!==g.monthly_cap_microusd)continue;
    const witness=new AssistantContextReadWitness<null>(env);
    const read=async(sql:string,bindings:(string|number|null)[])=>{
      const statement=db.prepare(sql).bind(...bindings),result=structuredClone(await statement.all<Row>());
      if(!current()||!derivationResults([result],1))return fail();witness.observe([statement],[result],[{sql,bindings}]);return result.results;
    };
    const metadata=await read(`SELECT
      (SELECT json_array(${DERIVATION_CURSOR_COLUMNS.join(',')}) FROM memory_derivation_cursors WHERE consent_id=?) AS creator,
      (SELECT json_array(${DERIVATION_PRODUCER_CURSOR_COLUMNS.join(',')}) FROM memory_derivation_producer_cursors WHERE consent_id=?) AS cursor,
      (SELECT COUNT(*) FROM memory_derivation_jobs j WHERE consent_id=? AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=j.job_id)) AS pending,
      (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS head`,[g.consent_id,g.consent_id,g.consent_id,a.binding.streamId]);
    if(metadata.length!==1)return fail();const meta=metadata[0]!;
    if(!derivationExact(meta,['creator','cursor','pending','head'])||!derivationInteger(meta.pending)||!derivationInteger(meta.head))return fail();
    if(Number(meta.pending)>=32){capacityPurposes++;continue;}
    const cursor=meta.cursor===null?null:JSON.parse(String(meta.cursor));
    if(cursor&&(!Array.isArray(cursor)||cursor.length!==5||cursor[0]!==g.consent_id||!derivationInteger(cursor[1],g.source_after_sequence)
      ||!derivationInteger(cursor[2],g.source_after_sequence,cursor[1])||!derivationInteger(cursor[3],0,Number.MAX_SAFE_INTEGER-1)||!derivationTime(cursor[4])))return fail();
    const after=cursor?Number(cursor[1]):g.source_after_sequence;
    const candidates=await read(`SELECT answer.event_id,answer.sequence,message.sequence AS user_sequence,
      (SELECT json_array(sequence,expires_at) FROM memory_live_sources WHERE enrollment_id=? AND event_id=answer.event_id) AS retained
      FROM events answer JOIN events message ON message.event_id=answer.causation_id AND message.stream_id=answer.stream_id
      WHERE answer.stream_id=? AND answer.type='AssistantReasoned' AND answer.actor='model:forma-chat' AND message.type='ChatMessageSent'
       AND message.actor=? AND json_extract(answer.payload,'$.document_id')=? AND json_extract(answer.payload,'$.operation')='creative-chat'
       AND json_extract(answer.payload,'$._private_ref')=answer.event_id AND json_type(answer.payload,'$.memory_origin_version') IS NULL
       AND answer.sequence>? AND answer.sequence<=? AND message.sequence>? AND message.recorded_at>=? AND answer.recorded_at>=?
       AND strftime('%Y-%m-%dT%H:%M:%fZ',message.recorded_at,'+'||?||' days')>${clock}
       AND strftime('%Y-%m-%dT%H:%M:%fZ',answer.recorded_at,'+'||?||' days')>${clock}
       AND json_extract(answer.payload,'$.content_expires_at')>${clock} AND json_extract(message.payload,'$.content_expires_at')>${clock}
      ORDER BY answer.sequence,answer.event_id LIMIT 1`,[e.enrollment_id,a.binding.streamId,e.organization_id===null?'user':`user:${e.actor_user_id}`,
        e.document_id,after,Number(meta.head),g.source_after_sequence,g.consented_at,g.consented_at,g.retention_days,g.retention_days]);
    if(!candidates.length)continue;
    const candidate=candidates[0]!;
    if(!derivationInteger(candidate.sequence,after+1,Number(meta.head))||!derivationInteger(candidate.user_sequence,g.source_after_sequence+1,Number(candidate.sequence)-1))return fail();
    const prepared={principal:a.principal,binding:a.binding,sourceHead:Number(meta.head)};
    const capture=await captureLegacyConversationOriginalWindows(env,prepared,[{afterSequence:Number(candidate.user_sequence)-1,throughSequence:Number(candidate.sequence)}]);
    const receipt=capture&&await replayLegacyConversationOriginals(env,prepared,capture);
    if(!capture||!receipt||receipt.originals.length!==2||!receipt.originals.some(value=>value.role==='assistant'&&value.eventId===candidate.event_id&&value.sequence===candidate.sequence)
      ||receipt.originals.some(value=>value.recordedAt<g.consented_at||value.sequence<=g.source_after_sequence))return fail();
    const now=new Date().toISOString(),ceiling=[e.expires_at,...receipt.originals.flatMap(value=>[value.expiresAt,
      new Date(Date.parse(value.recordedAt)+e.retention_days*86400000).toISOString()])].sort()[0]!;
    const retained=candidate.retained===null?null:JSON.parse(String(candidate.retained));
    if(retained&&(!Array.isArray(retained)||retained.length!==2||retained[0]!==candidate.sequence||!derivationTime(retained[1])||retained[1]>ceiling))return fail();
    const sourceExpires=retained?String(retained[1]):ceiling;
    const expires=[sourceExpires,g.expires_at,qualification.row.expires_at,...receipt.originals.map(value=>new Date(Date.parse(value.recordedAt)+g.retention_days*86400000).toISOString())].sort()[0]!;
    if(expires<=now)return fail();
    witness.before([receipt.validUntil,expires].sort()[0]!);witness.seal(null);
    const reads=witness.statements(),observed=structuredClone(await db.batch<Row>(reads));
    if(!reads.length||!derivationResults(observed,reads.length)||!witness.matches(observed))return fail();
    const budget={statements:reads.length,rows:observed.reduce((n,value)=>n+value.results.length,0),
      bytes:observed.reduce((n,value)=>n+value.results.reduce((total,row)=>total+new TextEncoder().encode(memoryCanonical(row)).byteLength,0),0)};
    const proof=await prepareLegacyConversationOriginalsCommit(env,prepared,[capture],budget);if(!proof||!current())return fail();
    const jobId=await memoryDigest(memoryCanonical(['native-chat-studio-delivery-v1',g.consent_id,g.purpose,after,Number(candidate.sequence)]));
    const guards=[schema.guard,a.guard,liveMemoryEnrollmentGuard(e,'learn'),derivationRowGuard('memory_derivation_grants',DERIVATION_GRANT_COLUMNS,g),derivationQualificationGuard(qualification.row)];
    const statements=[...guards.map(guard=>derivationAssertion(env,guard)),...witness.precommitStatements()];
    const writeIndices:number[]=[];
    const write=(statement:D1PreparedStatement)=>{statements.push(...proof.precommitStatements());writeIndices.push(statements.length);statements.push(statement,derivationAssertion(env,{condition:'changes()=1',bindings:[]}));};
    if(meta.creator===null)write(db.prepare(`INSERT INTO memory_derivation_cursors(${DERIVATION_CURSOR_COLUMNS.join(',')}) VALUES(?,?,?,?,?,0,?,?,?)`)
      .bind(g.consent_id,g.grant_id,g.revision,g.purpose,g.source_after_sequence,now,now,g.expires_at));
    if(!cursor)write(db.prepare(`INSERT INTO memory_derivation_producer_cursors(${DERIVATION_PRODUCER_CURSOR_COLUMNS.join(',')}) VALUES(?,?,?,0,?)`).bind(g.consent_id,after,after,now));
    if(!retained)write(db.prepare('INSERT INTO memory_live_sources(enrollment_id,event_id,sequence,expires_at) VALUES(?,?,?,?)')
      .bind(e.enrollment_id,String(candidate.event_id),Number(candidate.sequence),sourceExpires));
    write(db.prepare('INSERT INTO memory_derivation_producer_jobs(job_id,consent_id,after_sequence,through_sequence) VALUES(?,?,?,?)')
      .bind(jobId,g.consent_id,after,Number(candidate.sequence)));
    write(db.prepare(`INSERT INTO memory_derivation_jobs(job_id,consent_id,purpose,after_sequence,through_sequence,source_count,created_at,expires_at,state,lease_token,lease_expires_at,attempts,not_before,failure_code)
      VALUES(?,?,?,?,?,1,?,?,'waiting',NULL,NULL,0,?,NULL)`).bind(jobId,g.consent_id,g.purpose,after,Number(candidate.sequence),now,expires,now));
    write(db.prepare('INSERT INTO memory_derivation_job_sources(job_id,enrollment_id,event_id,sequence,expires_at) VALUES(?,?,?,?,?)')
      .bind(jobId,e.enrollment_id,String(candidate.event_id),Number(candidate.sequence),sourceExpires));
    write(db.prepare('UPDATE memory_derivation_producer_cursors SET registered_through_sequence=?,generation=generation+1,updated_at=? WHERE consent_id=? AND registered_through_sequence=? AND generation=?')
      .bind(Number(candidate.sequence),now,g.consent_id,after,cursor?Number(cursor[3]):0));
    statements.push(...proof.precommitStatements(),...guards.map(guard=>derivationAssertion(env,guard)));
    if(!proof.isCurrent()||!current())return fail();
    const written=structuredClone(await db.batch<Row>(statements));
    if(!proof.isCurrent()||!current()||!derivationResults(written,statements.length)||!written.every((value,index)=>writeIndices.includes(index)
      ?derivationChanged(value,1)
      :derivationVerified(value)||value.results.length===1&&derivationExact(value.results[0],['context_source_asserted'])&&value.results[0].context_source_asserted===1))return fail();
    registeredPurposes++;
  }
  return {registeredPurposes,capacityPurposes};
}
