/** Independent Chat Studio delivery under the existing native purpose grant. */
export const DERIVATION_PRODUCER_CURSOR_COLUMNS=['consent_id','registered_through_sequence','completed_through_sequence','generation','updated_at'] as const;
export const DERIVATION_PRODUCER_JOB_COLUMNS=['job_id','consent_id','after_sequence','through_sequence'] as const;
export const memoryDerivationProducerSchemaProfile = {
  "source": "0053_memory_derivation_producers",
  "names": [
    "memory_derivation_producer_cursor_delete",
    "memory_derivation_producer_cursor_insert",
    "memory_derivation_producer_cursor_update",
    "memory_derivation_producer_cursors",
    "memory_derivation_producer_job_delete",
    "memory_derivation_producer_job_insert",
    "memory_derivation_producer_job_update",
    "memory_derivation_producer_jobs",
    "memory_derivation_producer_split"
  ],
  "tables": [
    "memory_derivation_producer_cursors",
    "memory_derivation_producer_jobs"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_memory_derivation_producer_cursors_1",
    "sqlite_autoindex_memory_derivation_producer_jobs_1",
    "sqlite_autoindex_memory_derivation_producer_jobs_2"
  ],
  "count": 9,
  "digest": "sha256:8384cea5e9b0cec84ca11778f414160c73bfcccab5cc58ac0b7c581e47182639"
} as const;
export const memoryDerivationProducerJobDigest = 'sha256:5eadb65e7efb460b2388eafbe533eea4d570020901660420e2ff5499b29ed66d';
export const memoryDerivationProducerCompletionDigest = 'sha256:48e41a0c04a76c88a8474d6d02b2872186476bade97e73ef8e314e16064b53d2';
