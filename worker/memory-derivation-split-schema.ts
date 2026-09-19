/** Atomic reference-only subdivision. No completion or provider authority. */
export const DERIVATION_SPLIT_COLUMNS = ['parent_job_id','left_job_id','right_job_id','lease_token','split_sequence','finance_id','parent_json','references_json'] as const;
export const memoryDerivationSplitSchemaProfile = {
  "source": "0051_memory_derivation_split",
  "names": [
    "memory_derivation_split_apply",
    "memory_derivation_split_commands",
    "memory_derivation_split_insert",
    "memory_derivation_split_update"
  ],
  "tables": [
    "memory_derivation_split_commands"
  ],
  "count": 4,
  "digest": "sha256:7f4ef6b519f3227b73c67cd1f5c6e790cf946edcdc54128800a4d238f75d6792"
} as const;
export const memoryDerivationSplitJobDigest = 'sha256:5f23296d7535af4064358586eb2bfaf07181906fdd0bde12b1cb5ecf00cbb5ea';
