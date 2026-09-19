/** Additive immediate source/custody retirement. Identity never grants access. */
export const memoryDerivationHistorySchemaProfile = {
  "source": "0052_memory_derivation_history_privacy",
  "names": [
    "memory_derivation_history_source_delete",
    "memory_derivation_history_source_replace",
    "memory_derivation_history_source_update"
  ],
  "tables": [],
  "automaticIndexes": [],
  "count": 3,
  "digest": "sha256:4c307a2f92bb0aef4301102d08a10164024e52ecc3f9c09103fbe196fe27b75c"
} as const;
