/** A retained completion is a head marker, never permission to read a body.
 * Include legacy stored rows while retaining newer completed identities after
 * physical result cleanup. Automatic consumers must not fall back merely because
 * the newest private body disappeared. Explicit history remains separate.
 * The caller must include its certified derivation-schema and inventory guards. */
export function nativeDerivationHeadRelation(completionPresent:boolean){
 return completionPresent
  ? "(SELECT job_id FROM memory_derivation_results UNION SELECT job_id FROM memory_derivation_completions WHERE outcome='stored')"
  : 'memory_derivation_results';
}
