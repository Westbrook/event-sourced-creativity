export type PreparationCheck = 'response_shape' | 'unexpected_object' | 'missing_family' | 'digest_mismatch' | 'missing_dependency' | 'isolation_profile_unqualified' | 'database_changed';
/** The stable message preserves existing fail-closed callers; details stay internal. */
export class GenerationPreparationError extends Error {
  constructor(readonly preparationCheck: PreparationCheck, readonly schemaFingerprint: string | null = null) {
    super('memory_boundary_schema_unavailable');this.name='GenerationPreparationError';
  }
}
export function preparationFailureDiagnostic(detail: {code:string;diagnosticCode?:string;diagnosticCheck?:PreparationCheck;schemaFingerprint?:string}, correlationId:string) {
  if(detail.code!=='generation_preparation_unavailable')return null;
  return {event:detail.code,contract:'generation-preparation-v1',origin:'application',phase:'storage_preparation',responsibleActor:'service_operator',
    correlationId:/^[a-f0-9-]{36}(?::attempt:\d+)?$/u.test(correlationId)?correlationId:null,
    diagnosticCode:detail.diagnosticCode??'generation_preparation_unavailable',check:detail.diagnosticCheck??'unknown',
    schemaFingerprint:detail.schemaFingerprint??null,deploymentVersion:null,observedAt:new Date().toISOString()};
}
export function logPreparationFailure(detail: Parameters<typeof preparationFailureDiagnostic>[0],correlationId:string){
  const diagnostic=preparationFailureDiagnostic(detail,correlationId);if(diagnostic)console.warn(JSON.stringify(diagnostic));
}
