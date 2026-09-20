/** Exact additive native containment schema; structure does not confer access. */
export const projectContainmentSchemaProfile = {
  "source": "0058_project_containment",
  "names": [
    "idx_project_containment_parent",
    "project_containment",
    "project_containment_compensation",
    "project_containment_custody_delete",
    "project_containment_custody_insert",
    "project_containment_custody_update",
    "project_containment_declaration_update",
    "project_containment_insert",
    "project_containment_update"
  ],
  "tables": [
    "project_containment"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_project_containment_1"
  ],
  "count": 9,
  "digest": "sha256:b6feab6e2071920db3f17f9f3957db3d7793f76956269b44f8ae1f6d4842b138"
} as const;
