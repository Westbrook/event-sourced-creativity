/** Optional, exact cross-owner edges and permanent private-use retirement. */
export const organizationProjectNestingSchemaProfile = {
  "source": "0066_organization_project_nesting",
  "names": [
    "idx_organization_project_nesting_org",
    "organization_project_nesting",
    "organization_project_nesting_compensation",
    "organization_project_nesting_custody_delete",
    "organization_project_nesting_custody_insert",
    "organization_project_nesting_custody_update",
    "organization_project_nesting_declaration",
    "organization_project_nesting_immutable",
    "organization_project_nesting_insert",
    "organization_project_nesting_local_delete",
    "organization_project_nesting_local_insert",
    "organization_project_nesting_local_update",
    "organization_project_nesting_migration_delete",
    "organization_project_nesting_migration_update",
    "organization_project_nesting_retire"
  ],
  "tables": [
    "organization_project_nesting"
  ],
  "automaticIndexes": [
    "sqlite_autoindex_organization_project_nesting_1"
  ],
  "count": 15,
  "digest": "sha256:7a286b7e00e6995e8e8d0a1b5542122a4da0defa581fce322721d1ee93aacadc"
} as const;
