/** Exact historical diagnostics only. This presentation mapping grants no retry authority. */
export const GENERATION_PREPARATION_UNAVAILABLE = 'generation_preparation_unavailable';
const diagnostics = new Set(['memory_boundary_schema_unavailable', 'memory_boundary_database_changed', 'native_structured_origin_schema_unavailable', 'native_document_job_origin_schema_unavailable']);
export function generationPreparationUnavailable(code: unknown, message?: unknown) {
  return code === GENERATION_PREPARATION_UNAVAILABLE || typeof code === 'string' && diagnostics.has(code)
    || (code === 'operation_failed' || code === undefined || code === null) && typeof message === 'string' && diagnostics.has(message);
}
export const generationPreparationMessage = 'Forma could not prepare this generation because its storage service is unavailable. Check service readiness before making a new request. Changing the prompt will not repair this service problem.';
