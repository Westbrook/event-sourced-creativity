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

/** Native SQL only. The event reference is normalized to the internal original
 * reference column for metadata/revision reads; neither reference leaves HTTP.
 * This does not make an event an original quotation or grant source access. */
export function derivationControlRelation(observationsPresent:boolean){
  if(!observationsPresent)return 'memory_derivation_user_controls';
  const projected=DERIVATION_USER_CONTROL_COLUMNS.map(key=>key==='source_content_ref'?'source_event_ref AS source_content_ref':key).join(',');
  return `(SELECT ${DERIVATION_USER_CONTROL_COLUMNS.join(',')} FROM memory_derivation_user_controls UNION ALL SELECT ${projected} FROM memory_derivation_observation_controls)`;
}
