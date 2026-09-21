/** Exact optional private aggregate references; no inferred prose. */
export const memoryDerivationProfileContextSchemaProfile = {
  "source": "0068_memory_derivation_profile_contexts",
  "names": [
    "idx_memory_derivation_profile_context_job",
    "memory_derivation_profile_context_boundary_delete",
    "memory_derivation_profile_context_boundary_update",
    "memory_derivation_profile_context_delete",
    "memory_derivation_profile_context_enrollment_update",
    "memory_derivation_profile_context_insert",
    "memory_derivation_profile_context_replaced",
    "memory_derivation_profile_context_result_delete",
    "memory_derivation_profile_context_result_update",
    "memory_derivation_profile_context_update",
    "memory_derivation_profile_contexts"
  ],
  "tables": [
    "memory_derivation_profile_contexts"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_memory_derivation_profile_contexts_1",
    "sqlite_autoindex_memory_derivation_profile_contexts_2"
  ],
  "count": 11,
  "digest": "sha256:59e4ac119ab9b3a730b12ed0b0135845d997ebca54f4571b1cad2e2062d968c3"
} as const;
export const memoryProfileContextBoundarySchemaProfile = {
  "source": "0068_memory_derivation_profile_contexts",
  "names": [
    "memory_derivation_profile_context_boundary_delete",
    "memory_derivation_profile_context_boundary_update"
  ],
  "tables": [],
  "automaticIndexes": [],
  "count": 2,
  "digest": "sha256:50358abea8d1e10874939238a31c68cb9ae25a23a5d48f64620c76f38d4e6f2f"
} as const;
