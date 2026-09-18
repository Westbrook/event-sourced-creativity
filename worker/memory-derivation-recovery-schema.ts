/** Scan position only; never semantic completion or provider authority. */
export const DERIVATION_RECOVERY_COLUMNS = ['singleton','after_finance_id','generation','updated_at'] as const;
export const memoryDerivationRecoverySchemaProfile = {
  "source": "0046_memory_derivation_recovery_cursor",
  "names": [
    "memory_derivation_recovery_cursor",
    "memory_derivation_recovery_delete",
    "memory_derivation_recovery_insert",
    "memory_derivation_recovery_update"
  ],
  "tables": [
    "memory_derivation_recovery_cursor"
  ],
  "automaticIndexes": [],
  "count": 4,
  "digest": "sha256:4e94c1535e33cd59d34a4a3da40d1b048926f427843c467df717b6fa744b72e7"
} as const;
