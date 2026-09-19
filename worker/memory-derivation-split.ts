import type { WorkerEnv } from './runtime.ts';
import { memoryCanonical } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { nativeDerivationLeaseInputs, nativeDerivationLeaseStatements, type NativeDerivationLease } from './memory-derivation-admission.ts';
import { DERIVATION_JOB_COLUMNS, DERIVATION_JOB_SOURCE_COLUMNS } from './memory-derivation-job-schema.ts';
import { derivationAssertion, derivationChanged, derivationResults, derivationVerified, memoryDerivationSchema } from './memory-derivation-store.ts';

/** Only native, unsubmitted capacity failures may enter here. A single command
 * atomically replaces the parent with two whole-reference ranges. Originals
 * are neither read nor truncated, financial rows are never deleted, and no
 * completion/registration cursor advances. Every child needs fresh admission.
 * An uncertain ACK is never followed by reuse of this lease or a provider call. */
export async function splitNativeDerivationJob(env: WorkerEnv, lease: NativeDerivationLease): Promise<'split'|'unchanged'|'uncertain'> {
  try {
    const db=env.DB, input=nativeDerivationLeaseInputs(env,lease), schema=await memoryDerivationSchema(env);
    if(!schema.splitPresent||input.references.length<2||env.DB!==db)return 'unchanged';
    const {job,references}=input, boundary=references[Math.floor(references.length/2)-1]!.sequence;
    const left=await memoryDigest(memoryCanonical(['native-memory-subwindow-v1',job.job_id,job.after_sequence,boundary]));
    const right=await memoryDigest(memoryCanonical(['native-memory-subwindow-v1',job.job_id,boundary,job.through_sequence]));
    const finance=await memoryDigest(memoryCanonical(['native-memory-finance-v1',job.job_id,job.lease_token]));
    const parent=JSON.stringify(DERIVATION_JOB_COLUMNS.map(key=>job[key]));
    const refs=JSON.stringify(references.map(row=>DERIVATION_JOB_SOURCE_COLUMNS.map(key=>row[key])));
    const children=[{...job,job_id:left,through_sequence:boundary,source_count:Math.floor(references.length/2)},
      {...job,job_id:right,after_sequence:boundary,source_count:references.length-Math.floor(references.length/2)}]
      .map(row=>({...row,state:'waiting',lease_token:null,lease_expires_at:null,attempts:0,not_before:job.created_at,failure_code:null}));
    const after=references.map(row=>({...row,job_id:row.sequence<=boundary?left:right}));
    const guards=nativeDerivationLeaseStatements(env,lease);
    const statements=[...guards,derivationAssertion(env,schema.guard),db.prepare(`INSERT INTO memory_derivation_split_commands
      (parent_job_id,left_job_id,right_job_id,lease_token,split_sequence,finance_id,parent_json,references_json) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(job.job_id,left,right,job.lease_token,boundary,finance,parent,refs),
      derivationAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM memory_derivation_split_commands)
        AND NOT EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=?)
        AND (SELECT json_group_array(json_array(${DERIVATION_JOB_COLUMNS.join(',')})) FROM
          (SELECT ${DERIVATION_JOB_COLUMNS.join(',')} FROM memory_derivation_jobs WHERE job_id IN(?,?) ORDER BY after_sequence))=?
        AND (SELECT json_group_array(json_array(${DERIVATION_JOB_SOURCE_COLUMNS.join(',')})) FROM
          (SELECT ${DERIVATION_JOB_SOURCE_COLUMNS.join(',')} FROM memory_derivation_job_sources WHERE job_id IN(?,?) ORDER BY sequence,event_id))=?`,
        bindings:[job.job_id,left,right,JSON.stringify(children.map(row=>DERIVATION_JOB_COLUMNS.map(key=>row[key]))),
          left,right,JSON.stringify(after.map(row=>DERIVATION_JOB_SOURCE_COLUMNS.map(key=>row[key])))]}),derivationAssertion(env,schema.guard)];
    if(env.DB!==db)return 'unchanged';
    const result=await db.batch<Record<string,unknown>>(statements);
    nativeDerivationLeaseInputs(env,lease); // Recheck configuration, DB and native proof deadline.
    const mutation=guards.length+1;
    if(env.DB!==db||!derivationResults(result,statements.length)
      ||!result.every((row,index)=>index===mutation?derivationChanged(row,1,4+references.length*2):derivationVerified(row)))return 'uncertain';
    return 'split';
  } catch { return 'uncertain'; }
}
