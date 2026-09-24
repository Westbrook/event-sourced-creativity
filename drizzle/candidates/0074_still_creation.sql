-- Actor-private Still creation drafts and retained operations (v19).
CREATE TABLE IF NOT EXISTS creation_drafts (
    draft_id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT NOT NULL, scope_key TEXT NOT NULL,
    destination_json TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
    state TEXT NOT NULL CHECK(state IN('active','discarded','applied')), content_id TEXT,
    expires_at TEXT NOT NULL, operation_id TEXT, receipt_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 1 CHECK(verified=1), CHECK(state<>'active' OR content_id IS NOT NULL));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_draft_content_versions (draft_id TEXT NOT NULL, revision INTEGER NOT NULL, content_id TEXT UNIQUE NOT NULL, actor_user_id TEXT NOT NULL, PRIMARY KEY(draft_id,revision));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_drafts_actor_scope ON creation_drafts(actor_user_id,scope_key,expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_operations (
    operation_id TEXT PRIMARY KEY NOT NULL, draft_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, scope_key TEXT NOT NULL,
    draft_revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN('interpretation','commit')),
    state TEXT NOT NULL CHECK(state IN('prepared','executing','review','applied','failed')),
    request_hash TEXT NOT NULL, content_id TEXT, approval_hash TEXT, receipt_json TEXT, error_code TEXT,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 1 CHECK(verified=1));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_operations_draft ON creation_operations(actor_user_id,scope_key,draft_id,draft_revision);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_write_assertions (assertion_id TEXT PRIMARY KEY NOT NULL, verified INTEGER NOT NULL CHECK(verified=1));
