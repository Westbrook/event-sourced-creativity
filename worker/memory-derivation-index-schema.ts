/** Source-free native result index lifecycle; not remote indexing authority. */
export const DERIVATION_INDEX_COLUMNS=['job_id','operation','generation','updated_at','expires_at'] as const;
export const memoryDerivationIndexSchemaProfile = {
  "source": "0054_memory_derivation_index_intents",
  "names": [
    "idx_memory_derivation_index_pending",
    "memory_derivation_index_delete",
    "memory_derivation_index_erased",
    "memory_derivation_index_insert",
    "memory_derivation_index_intents",
    "memory_derivation_index_published",
    "memory_derivation_index_retired",
    "memory_derivation_index_update"
  ],
  "tables": [
    "memory_derivation_index_intents"
  ],
  "count": 8,
  "digest": "sha256:a647357077e927bab786f7f31a2ebcde473c3216b877ba5a5d54f16e8947c4d1"
} as const;
