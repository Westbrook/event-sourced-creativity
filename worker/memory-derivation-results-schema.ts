/** Private native proposals and targeted inverse indexes. */
export const DERIVATION_RESULT_TABLE_COLUMNS = {
  "memory_derivation_results": [
    "job_id",
    "finance_id",
    "state",
    "raw_json",
    "manifest_json",
    "output_sha256",
    "manifest_sha256",
    "dependency_count",
    "published_at",
    "expires_at",
    "retired_at"
  ],
  "memory_derivation_result_dependencies": [
    "job_id",
    "kind",
    "resource_id",
    "actor_user_id",
    "scope_key"
  ]
} as const;
export const memoryDerivationResultsSchemaProfile = {
  "source": "0047_memory_derivation_results",
  "names": [
    "idx_memory_derivation_result_expiry",
    "idx_memory_derivation_result_inverse",
    "memory_derivation_result_assistant_specialist_tasks_delete",
    "memory_derivation_result_assistant_specialist_tasks_insert",
    "memory_derivation_result_assistant_specialist_tasks_update",
    "memory_derivation_result_assistant_turns_delete",
    "memory_derivation_result_assistant_turns_insert",
    "memory_derivation_result_assistant_turns_update",
    "memory_derivation_result_consequential_executions_delete",
    "memory_derivation_result_consequential_executions_insert",
    "memory_derivation_result_consequential_executions_update",
    "memory_derivation_result_delete",
    "memory_derivation_result_dependencies",
    "memory_derivation_result_dependency_delete",
    "memory_derivation_result_dependency_insert",
    "memory_derivation_result_dependency_update",
    "memory_derivation_result_event_private_payloads_delete",
    "memory_derivation_result_event_private_payloads_insert",
    "memory_derivation_result_event_private_payloads_update",
    "memory_derivation_result_events_delete",
    "memory_derivation_result_events_insert",
    "memory_derivation_result_events_update",
    "memory_derivation_result_insert",
    "memory_derivation_result_private_content_delete",
    "memory_derivation_result_private_content_insert",
    "memory_derivation_result_private_content_retention_scopes_delete",
    "memory_derivation_result_private_content_retention_scopes_insert",
    "memory_derivation_result_private_content_retention_scopes_update",
    "memory_derivation_result_private_content_update",
    "memory_derivation_result_project_event_scopes_delete",
    "memory_derivation_result_project_event_scopes_insert",
    "memory_derivation_result_project_event_scopes_update",
    "memory_derivation_result_project_resource_scopes_delete",
    "memory_derivation_result_project_resource_scopes_insert",
    "memory_derivation_result_project_resource_scopes_update",
    "memory_derivation_result_retired",
    "memory_derivation_result_update",
    "memory_derivation_results",
    "memory_derivation_results_finance_id_unique"
  ],
  "tables": [
    "memory_derivation_results",
    "memory_derivation_result_dependencies"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_memory_derivation_result_dependencies_1",
    "sqlite_autoindex_memory_derivation_results_1"
  ],
  "count": 39,
  "digest": "sha256:928bf14ed905d8ef03e1fa76885aecd34cc2c903542b489e49044f1f853e76d6"
} as const;
