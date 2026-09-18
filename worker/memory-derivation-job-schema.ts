/** Exact additive profile. Reference delivery is not content or provider authority. */
export const DERIVATION_CURSOR_COLUMNS = ["consent_id", "grant_id", "grant_revision", "purpose", "registered_through_sequence", "generation", "created_at", "updated_at", "expires_at"] as const;
export const DERIVATION_JOB_COLUMNS = ["job_id", "consent_id", "purpose", "after_sequence", "through_sequence", "source_count", "created_at", "expires_at", "state", "lease_token", "lease_expires_at", "attempts", "not_before", "failure_code"] as const;
export const DERIVATION_JOB_SOURCE_COLUMNS = ["job_id", "enrollment_id", "event_id", "sequence", "expires_at"] as const;
export const memoryDerivationJobSchemaProfile = {
  "source": "0044_memory_derivation_reference_jobs",
  "names": [
    "idx_memory_derivation_cursor_expiry",
    "idx_memory_derivation_job_consent",
    "idx_memory_derivation_job_due",
    "idx_memory_derivation_job_interval",
    "idx_memory_derivation_source_inverse",
    "idx_memory_derivation_source_sequence",
    "memory_derivation_cursor_delete",
    "memory_derivation_cursor_insert",
    "memory_derivation_cursor_update",
    "memory_derivation_cursors",
    "memory_derivation_dependency_deleted",
    "memory_derivation_job_insert",
    "memory_derivation_job_sources",
    "memory_derivation_job_update",
    "memory_derivation_jobs",
    "memory_derivation_jobs_revoked",
    "memory_derivation_source_changed",
    "memory_derivation_source_delete",
    "memory_derivation_source_immutable",
    "memory_derivation_source_insert"
  ],
  "tables": [
    "memory_derivation_cursors",
    "memory_derivation_job_sources",
    "memory_derivation_jobs"
  ],
  "count": 20,
  "digest": "sha256:9ac7e8504750d522331122657e72a4bd9f58f2202b650f3c484470d074d006dd"
} as const;
