/** Native event-backed private controls. No model authority or enrollment. */
export const DERIVATION_OBSERVATION_CONTROL_COLUMNS = ["control_id","enrollment_id","actor_user_id","purpose","scope_key","lineage_id","claim_key","source_event_ref","revision","action","correction_text","created_at","updated_at","expires_at"] as const;
export const memoryDerivationObservationControlSchemaProfile = {
  "source": "0057_memory_derivation_observation_controls",
  "names": [
    "idx_memory_derivation_observation_control_expiry",
    "idx_memory_derivation_observation_control_lineage",
    "idx_memory_derivation_observation_control_source",
    "memory_derivation_observation_control_compensated",
    "memory_derivation_observation_control_custody_delete",
    "memory_derivation_observation_control_custody_insert",
    "memory_derivation_observation_control_custody_update",
    "memory_derivation_observation_control_delete_results",
    "memory_derivation_observation_control_insert",
    "memory_derivation_observation_control_insert_results",
    "memory_derivation_observation_control_parent_update",
    "memory_derivation_observation_control_private_delete",
    "memory_derivation_observation_control_private_update",
    "memory_derivation_observation_control_remembered_delete",
    "memory_derivation_observation_control_remembered_update",
    "memory_derivation_observation_control_source_update",
    "memory_derivation_observation_control_update",
    "memory_derivation_observation_control_update_results",
    "memory_derivation_observation_controls"
  ],
  "tables": [
    "memory_derivation_observation_controls"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_memory_derivation_observation_controls_1"
  ],
  "count": 19,
  "digest": "sha256:75f9f4aff57d7e761a771a490de35f64aedbc32490e45739317079b093255e8d"
} as const;
