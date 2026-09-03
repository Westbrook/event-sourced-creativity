-- Preserve existing Output plans, execution grants, assets and acceptances while widening their CHECK predicates.
-- D1 executes this migration in one transaction; foreign keys remain enabled.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE __output_plan_targets_model3d(
    scope_key TEXT NOT NULL,plan_revision_id TEXT NOT NULL,target_id TEXT NOT NULL,target_contract_digest TEXT NOT NULL,
    media_kind TEXT NOT NULL CHECK(media_kind IN('image','slides','audio','video','document','model3d','unknown')),
    required INTEGER NOT NULL CHECK(required IN(0,1)),selected INTEGER NOT NULL CHECK(selected IN(0,1)),ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0),
    PRIMARY KEY(scope_key,plan_revision_id,target_id),
    FOREIGN KEY(scope_key,plan_revision_id) REFERENCES output_plan_revisions(scope_key,plan_revision_id));
--> statement-breakpoint
INSERT INTO __output_plan_targets_model3d(rowid,scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal) SELECT rowid,scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal FROM output_plan_targets;
--> statement-breakpoint
DROP TABLE output_plan_targets;
--> statement-breakpoint
ALTER TABLE __output_plan_targets_model3d RENAME TO output_plan_targets;
--> statement-breakpoint
CREATE TABLE __output_assets_model3d(
    scope_key TEXT NOT NULL,asset_id TEXT NOT NULL,document_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,created_by_user_id TEXT NOT NULL,
    source_digest TEXT NOT NULL,storage_key TEXT NOT NULL,content_sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL CHECK(typeof(byte_length)='integer' AND byte_length>0),
    mime_type TEXT NOT NULL,media_kind TEXT NOT NULL CHECK(media_kind IN('image','slides','audio','video','document','model3d')),
    created_event_id TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT,
    PRIMARY KEY(scope_key,asset_id),FOREIGN KEY(created_event_id) REFERENCES events(event_id));
--> statement-breakpoint
INSERT INTO __output_assets_model3d(rowid,scope_key,asset_id,document_id,owner_user_id,created_by_user_id,source_digest,storage_key,content_sha256,byte_length,mime_type,media_kind,created_event_id,created_at,redacted_at) SELECT rowid,scope_key,asset_id,document_id,owner_user_id,created_by_user_id,source_digest,storage_key,content_sha256,byte_length,mime_type,media_kind,created_event_id,created_at,redacted_at FROM output_assets;
--> statement-breakpoint
DROP TABLE output_assets;
--> statement-breakpoint
ALTER TABLE __output_assets_model3d RENAME TO output_assets;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_output_assets_unique_1 ON output_assets(storage_key);
--> statement-breakpoint
CREATE TABLE __output_asset_storage_writes_model3d(
    scope_key TEXT NOT NULL,asset_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,
    organization_id TEXT,project_access_id TEXT,project_id TEXT NOT NULL,document_id TEXT NOT NULL,context_id TEXT,
    command_key TEXT NOT NULL,request_digest TEXT NOT NULL,source_digest TEXT NOT NULL,
    storage_key TEXT NOT NULL,content_sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL CHECK(typeof(byte_length)='integer' AND byte_length>0 AND byte_length<=67108864),
    status TEXT NOT NULL CHECK(status IN('writing','written','cleanup_pending','deleted')),write_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(write_acknowledged IN(0,1)),
    publication_event_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    PRIMARY KEY(scope_key,asset_id),
    FOREIGN KEY(publication_event_id) REFERENCES events(event_id),
    CHECK((organization_id IS NULL AND project_access_id IS NULL AND context_id IS NULL) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND context_id IS NOT NULL)));
--> statement-breakpoint
INSERT INTO __output_asset_storage_writes_model3d(rowid,scope_key,asset_id,owner_user_id,actor_user_id,organization_id,project_access_id,project_id,document_id,context_id,command_key,request_digest,source_digest,storage_key,content_sha256,byte_length,status,write_acknowledged,publication_event_id,created_at,updated_at) SELECT rowid,scope_key,asset_id,owner_user_id,actor_user_id,organization_id,project_access_id,project_id,document_id,context_id,command_key,request_digest,source_digest,storage_key,content_sha256,byte_length,status,write_acknowledged,publication_event_id,created_at,updated_at FROM output_asset_storage_writes;
--> statement-breakpoint
DROP TABLE output_asset_storage_writes;
--> statement-breakpoint
ALTER TABLE __output_asset_storage_writes_model3d RENAME TO output_asset_storage_writes;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_output_asset_storage_writes_unique_1 ON output_asset_storage_writes(scope_key,actor_user_id,command_key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_output_asset_storage_writes_unique_2 ON output_asset_storage_writes(storage_key);
--> statement-breakpoint
INSERT INTO output_atomic_assertions(token,passed) SELECT 'output-model3d-schema-foreign-keys',CASE WHEN NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check WHERE [table] LIKE 'output_%') THEN 1 ELSE 0 END;
--> statement-breakpoint
DELETE FROM output_atomic_assertions WHERE token='output-model3d-schema-foreign-keys';
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
