/** Explicit private user controls; never model-authored declarations. */
export const DERIVATION_USER_CONTROL_COLUMNS = ["control_id","enrollment_id","actor_user_id","purpose","scope_key","lineage_id","claim_key","source_content_ref","revision","action","correction_text","created_at","updated_at","expires_at"] as const;
export const memoryDerivationUserControlSchemaProfile = {
  "source": "0048_memory_derivation_user_controls",
  "names": [
    "idx_memory_derivation_user_control_expiry",
    "idx_memory_derivation_user_control_lineage",
    "idx_memory_derivation_user_control_source",
    "memory_derivation_user_control_delete_results",
    "memory_derivation_user_control_insert",
    "memory_derivation_user_control_insert_results",
    "memory_derivation_user_control_parent_update",
    "memory_derivation_user_control_source_update",
    "memory_derivation_user_control_update",
    "memory_derivation_user_control_update_results",
    "memory_derivation_user_controls"
  ],
  "tables": [
    "memory_derivation_user_controls"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_memory_derivation_user_controls_1"
  ],
  "count": 11,
  "digest": "sha256:183701ad23e07022b19f1ed0972ea6205ccc6cabc9c745a4b19c92c4e8f43115"
} as const;
