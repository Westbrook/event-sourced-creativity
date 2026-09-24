import type { WorkerEnv } from './runtime.ts';
import { CreationProviderError } from './creation-provider-http.ts';

// Exact schema witness is part of the atomic admission predicate. Partial/mismatched
// installations must not admit a call when counters would not be consumed.
const CONSUME_TRIGGER_SQL=`CREATE TRIGGER creation_qualification_consume AFTER INSERT ON creation_qualification_attempts
BEGIN
  UPDATE creation_qualification_limits SET
    used_calls=used_calls+1,used_input_units=used_input_units+NEW.input_units,
    used_output_tokens=used_output_tokens+NEW.output_tokens,used_nano_usd=used_nano_usd+NEW.cost_nano_usd
  WHERE run_id=NEW.run_id AND provider IN('*',NEW.provider)
    AND (scope='full' OR (NEW.phase='canary' AND scope='canary'));
END`;

export type QualificationProvider = 'openai:embeddings' | 'openai:organizer' | 'jev';
/** Qualification-only admission. No schema installation, credentials, content, or refunds.
 * A reservation is spent even when dispatch crashes or the response is lost. Hosting and
 * scheduler spend must receive a separate allocation; this guards only creation providers. */
export async function reserveCreationQualificationAttempt(env:WorkerEnv,provider:QualificationProvider,model:string,body:string,outputTokens=0):Promise<string|undefined>{
  const runId=env.STILL_CREATION_QUALIFICATION_RUN_ID;
  if(runId===undefined)return;
  if(!runId.trim()||runId.length>160||!Number.isSafeInteger(outputTokens)||outputTokens<0)throw new CreationProviderError('qualification_budget_configuration',0,true);
  const inputBytes=new TextEncoder().encode(body).length,attemptId=crypto.randomUUID();
  try{
    // One atomic write serializes overlap. The trigger consumes ALL matching limits in
    // the same transaction; failures roll back the insert, never partially admit a call.
    const result=await env.DB.prepare(`INSERT INTO creation_qualification_attempts
      (attempt_id,run_id,provider,model,phase,input_units,output_tokens,cost_nano_usd,created_at)
      SELECT ?,r.run_id,?, ?,r.phase,?*p.input_units_per_byte,?,
        ?*p.input_units_per_byte*p.input_nano_usd_per_unit+?*p.output_nano_usd_per_token,unixepoch()
      FROM creation_qualification_runs r JOIN creation_qualification_limits p
        ON p.run_id=r.run_id AND p.scope='full' AND p.provider=?
      WHERE r.run_id=? AND r.authorized=1 AND r.starts_at<=unixepoch() AND r.expires_at>unixepoch()
        AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='creation_qualification_consume' AND sql=?)
        AND p.model=? AND ?>0 AND ?<=p.max_input_bytes_per_call AND ?<=p.max_output_tokens_per_call
        AND (SELECT count(*) FROM creation_qualification_limits l WHERE l.run_id=r.run_id
          AND l.provider IN('*',p.provider) AND (l.scope='full' OR (r.phase='canary' AND l.scope='canary')))=CASE WHEN r.phase='canary' THEN 4 ELSE 2 END
        AND NOT EXISTS(SELECT 1 FROM creation_qualification_limits l WHERE l.run_id=r.run_id
          AND l.provider IN('*',p.provider) AND (l.scope='full' OR (r.phase='canary' AND l.scope='canary'))
          AND (l.used_calls+1>l.max_calls OR l.used_input_units+?*p.input_units_per_byte>l.max_input_units
            OR l.used_output_tokens+?>l.max_output_tokens
            OR l.used_nano_usd+?*p.input_units_per_byte*p.input_nano_usd_per_unit+?*p.output_nano_usd_per_token>l.max_nano_usd
            OR (l.provider<>'*' AND (l.model<>p.model OR ? > l.max_input_bytes_per_call OR ? > l.max_output_tokens_per_call
              OR l.input_units_per_byte<>p.input_units_per_byte OR l.input_nano_usd_per_unit<>p.input_nano_usd_per_unit OR l.output_nano_usd_per_token<>p.output_nano_usd_per_token))))
      RETURNING attempt_id,(SELECT expires_at FROM creation_qualification_runs WHERE run_id=creation_qualification_attempts.run_id) AS expires_at`)
      .bind(attemptId,provider,model,inputBytes,outputTokens,inputBytes,outputTokens,provider,runId,CONSUME_TRIGGER_SQL,model,inputBytes,inputBytes,outputTokens,inputBytes,outputTokens,inputBytes,outputTokens,inputBytes,outputTokens).first<{attempt_id:string;expires_at:number}>();
    if(result?.attempt_id!==attemptId||result.expires_at*1000<=Date.now())throw new CreationProviderError('qualification_budget_unavailable_or_exhausted',0,true);
    return attemptId;
  }catch(error){
    if(error instanceof CreationProviderError)throw error;
    // Includes absent schema, invalid rates, uncertain D1 outcome. Never fall through to fetch.
    throw new CreationProviderError('qualification_budget_unavailable',0,true);
  }
}
/** Remote inference can fan out invisibly; it has no enforceable per-dispatch contract here. */
export function denyUnmeteredQualificationService(env:WorkerEnv){
  if(env.STILL_CREATION_QUALIFICATION_RUN_ID!==undefined)throw new CreationProviderError('qualification_service_metering_unavailable',0,true);
}
