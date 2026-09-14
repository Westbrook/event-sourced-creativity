// Exact generated table definitions. Tests bind these to the immutable migration.
export const SCENE_SOURCE_GENERATION_TABLES = [
  {
    "name": "scene_source_epoch",
    "type": "table",
    "sql": "CREATE TABLE `scene_source_epoch` (\n\t`singleton` integer PRIMARY KEY NOT NULL,\n\t`schema_version` integer NOT NULL,\n\t`instance_nonce` text NOT NULL,\n\t`generation` integer NOT NULL,\n\tCONSTRAINT \"scene_source_epoch_singleton\" CHECK(\"scene_source_epoch\".\"singleton\"=1),\n\tCONSTRAINT \"scene_source_epoch_version\" CHECK(\"scene_source_epoch\".\"schema_version\"=1),\n\tCONSTRAINT \"scene_source_epoch_nonce\" CHECK(length(\"scene_source_epoch\".\"instance_nonce\")=32 AND \"scene_source_epoch\".\"instance_nonce\" NOT GLOB '*[^0-9a-f]*'),\n\tCONSTRAINT \"scene_source_epoch_generation\" CHECK(typeof(\"scene_source_epoch\".\"generation\")='integer' AND \"scene_source_epoch\".\"generation\" BETWEEN 1 AND 9007199254740991)\n)"
  },
  {
    "name": "scene_source_generations",
    "type": "table",
    "sql": "CREATE TABLE `scene_source_generations` (\n\t`scope_kind` text NOT NULL,\n\t`scope_key` text NOT NULL,\n\t`generation` integer NOT NULL,\n\tPRIMARY KEY(`scope_kind`, `scope_key`),\n\tCONSTRAINT \"scene_source_generation_kind\" CHECK(\"scene_source_generations\".\"scope_kind\" IN ('stream','project')),\n\tCONSTRAINT \"scene_source_generation_value\" CHECK(typeof(\"scene_source_generations\".\"generation\")='integer' AND \"scene_source_generations\".\"generation\" BETWEEN 1 AND 9007199254740991)\n)"
  }
] as const;
