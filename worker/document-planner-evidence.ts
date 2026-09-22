import type { WorkerEnv } from './runtime.ts';
import type { ProjectExecutionScope } from './pilot-policy.ts';
import { storePrivateContent } from './private-content-storage.ts';
import { privateGenerationEvidenceObserver } from './provider-submission.ts';
import { providerSubmissions } from '../src/model/provider-submission.ts';
import type { GenerationEvidenceObserver } from '../src/model/generation-outcome-evidence.ts';
import { outputAssertionStatements } from './output-requirements-ledger.ts';

type Identity = { jobId:string; ownerId:string; streamId:string; correlationId:string };
type Row = { request_json:string; result_json:string; expires_at:string; lease_expires_at:string; attempt_count:number };
/** Called only by the authenticated event executor. IDs/hashes identify the
 * original paid call; current owner/job/lease and private-store policy grant custody.
 * Native Output and Memory retain their own specialized custody contracts. */
export function documentPlannerEvidenceObserver(env:WorkerEnv, identity:Identity, checkpoint:Record<string,unknown>,
  progress:Parameters<typeof privateGenerationEvidenceObserver>[2], scope?:ProjectExecutionScope):GenerationEvidenceObserver {
  const db=env.DB;
  return privateGenerationEvidenceObserver(async evidence=>{
    if(env.DB!==db)throw Error('document_evidence_database_changed');
    const row=await db.prepare(`SELECT request_json,result_json,expires_at,lease_expires_at,attempt_count FROM document_jobs
      WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND kind='render_document' AND status='running'
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=document_jobs.job_id)`)
      .bind(identity.jobId,identity.ownerId,identity.streamId,identity.correlationId).first<Row>();
    if(env.DB!==db)throw Error('document_evidence_database_changed');
    if(!row)throw Error('document_evidence_custody_unavailable');
    const prior=providerSubmissions(JSON.parse(row.result_json??'{}')).find(call=>call.clientRequestId===evidence.evidenceId);
    if(!prior||prior.provider!=='openai'||prior.operation!=='planning'||prior.requestDigest!==evidence.operation.requestSha256
      ||prior.model!==evidence.operation.requestedAlias)throw Error('document_evidence_original_call_required');
    const serialized=JSON.stringify(evidence);
    if(new TextEncoder().encode(serialized).byteLength>2_200_000)throw Error('document_evidence_too_large');
    const guard={sql:`EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=?
      AND kind='render_document' AND status='running' AND request_json=? AND result_json=? AND attempt_count=?
      AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND lease_expires_at=? AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=document_jobs.job_id))`,
      bindings:[identity.jobId,identity.ownerId,identity.streamId,identity.correlationId,row.request_json,row.result_json,row.attempt_count,row.expires_at,row.lease_expires_at]};
    const expiry=row.expires_at;
    const stored=await storePrivateContent(env,identity.ownerId,'provider-output',serialized,scope,guard,content=>[
      ...outputAssertionStatements(env,guard),
      db.prepare('UPDATE private_content SET expires_at=MIN(expires_at,?) WHERE content_id=? AND owner_id=?').bind(expiry,content.contentId,identity.ownerId),
      ...outputAssertionStatements(env,{sql:'changes()=1'}),
    ],undefined,()=>{if(env.DB!==db)throw Error('document_evidence_database_changed');return [];});
    if(env.DB!==db)throw Error('document_evidence_database_changed');
    return {ref:stored.contentId,expiresAt:stored.expiresAt<expiry?stored.expiresAt:expiry};
  },checkpoint,progress);
}
