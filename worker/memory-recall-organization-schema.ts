/** Exact optional organization recall extension; no implicit consent. */
export const memoryRecallOrganizationSchemaProfile = {
  "source": "0065_memory_recall_organization_ranges",
  "names": [
    "memory_recall_organization_ranges",
    "memory_recall_organization_ranges_boundary",
    "memory_recall_organization_ranges_immutable",
    "memory_recall_organization_ranges_insert",
    "memory_recall_organization_ranges_retire"
  ],
  "tables": [
    "memory_recall_organization_ranges"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_memory_recall_organization_ranges_1"
  ],
  "count": 5,
  "digest": "sha256:701ff8e01c2aa3dd3a4fc1473f4c5c0facec07b380b47b643fe48b9d60971e0f"
} as const;
