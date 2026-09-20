export const memoryDerivationConsumerSchemaProfile = {
  "source": "0061_memory_derivation_consumers",
  "names": [
    "idx_memory_derivation_consumer_content_origin",
    "idx_memory_derivation_consumer_context",
    "idx_memory_derivation_consumer_execution",
    "idx_memory_derivation_consumer_source",
    "idx_memory_derivation_consumer_turn",
    "memory_derivation_consumer_content_delete",
    "memory_derivation_consumer_content_expiry",
    "memory_derivation_consumer_content_insert",
    "memory_derivation_consumer_content_update",
    "memory_derivation_consumer_contents",
    "memory_derivation_consumer_context_delete",
    "memory_derivation_consumer_context_update",
    "memory_derivation_consumer_delete",
    "memory_derivation_consumer_insert",
    "memory_derivation_consumer_parent_delete",
    "memory_derivation_consumer_parent_update",
    "memory_derivation_consumer_result_delete",
    "memory_derivation_consumer_result_update",
    "memory_derivation_consumer_retired",
    "memory_derivation_consumer_update",
    "memory_derivation_consumers"
  ],
  "tables": [
    "memory_derivation_consumer_contents",
    "memory_derivation_consumers"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_memory_derivation_consumer_contents_1",
    "sqlite_autoindex_memory_derivation_consumers_1"
  ],
  "count": 21,
  "digest": "sha256:264f1faf2fe893e0f5dbb09b304beff629783983938d2c39a12eab4d597558d0"
} as const;
