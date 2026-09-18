export const DERIVATION_COMPLETION_COLUMNS = {"memory_derivation_completions":["job_id","outcome","completed_at"],"memory_derivation_completion_cursors":["consent_id","through_sequence","generation","updated_at"]} as const;
export const memoryDerivationCompletionSchemaProfile = {
  "source": "0049_memory_derivation_completion",
  "names": [
    "memory_derivation_completion_cursor_delete",
    "memory_derivation_completion_cursor_insert",
    "memory_derivation_completion_cursor_update",
    "memory_derivation_completion_cursors",
    "memory_derivation_completion_delete",
    "memory_derivation_completion_insert",
    "memory_derivation_completion_update",
    "memory_derivation_completions"
  ],
  "tables": [
    "memory_derivation_completions",
    "memory_derivation_completion_cursors"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_memory_derivation_completion_cursors_1",
    "sqlite_autoindex_memory_derivation_completions_1"
  ],
  "count": 8,
  "digest": "sha256:58ceacf40b8af6efd7046ff7f3baeb4dbcc9dbecbc56bb883ea0f2a83f3b7016"
} as const;
