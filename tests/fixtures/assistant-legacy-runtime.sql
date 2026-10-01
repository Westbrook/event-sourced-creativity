-- Frozen pre-0021 assistant runtime schema from the 0019 baseline.
CREATE TABLE IF NOT EXISTS assistant_turns (turn_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, scope_key TEXT NOT NULL, organization_id TEXT, project_access_id TEXT, project_id TEXT, document_id TEXT, route_family TEXT NOT NULL, user_content_ref TEXT NOT NULL, assistant_content_ref TEXT NOT NULL, proposal_json TEXT, permission_epoch TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT NOT NULL, PRIMARY KEY(actor_user_id,scope_key,turn_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_turns_actor_scope ON assistant_turns(actor_user_id,scope_key,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_action_proposals (proposal_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,scope_key TEXT NOT NULL,turn_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,project_id TEXT NOT NULL,document_id TEXT NOT NULL,action_kind TEXT NOT NULL,action_content_ref TEXT NOT NULL,source_versions_json TEXT NOT NULL,expected_head INTEGER NOT NULL,permission_epoch TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,resolved_at TEXT);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_proposals_actor_scope ON assistant_action_proposals(actor_user_id,scope_key,status,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_action_commits(commit_id TEXT PRIMARY KEY NOT NULL,verified INTEGER NOT NULL CHECK(verified=1),created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_specialist_tasks(task_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,scope_key TEXT NOT NULL,turn_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,project_id TEXT,document_id TEXT,route_family TEXT NOT NULL,task_kind TEXT NOT NULL,selected_model TEXT NOT NULL,token_reservation_id TEXT NOT NULL,cost_reservation_id TEXT NOT NULL,estimated_microusd INTEGER NOT NULL,maximum_input_tokens INTEGER NOT NULL,maximum_output_tokens INTEGER NOT NULL,locale TEXT NOT NULL,permission_epoch TEXT NOT NULL,status TEXT NOT NULL,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,lease_expires_at TEXT,provider_submitted INTEGER NOT NULL DEFAULT 0,UNIQUE(actor_user_id,scope_key,turn_id,task_kind));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_tasks_actor_scope ON assistant_specialist_tasks(actor_user_id,scope_key,status,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_billing_reconciliations(reconciliation_id TEXT PRIMARY KEY NOT NULL,task_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,reviewer_user_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,evidence_classification TEXT NOT NULL CHECK(evidence_classification='verified-no-provider-charge'),occurred_at TEXT NOT NULL,UNIQUE(task_id,reviewer_user_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assistant_billing_reconciliations_actor_scope ON assistant_billing_reconciliations(actor_user_id,organization_id,project_access_id,occurred_at);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS assistant_billing_reconciliation_block_update BEFORE UPDATE ON assistant_billing_reconciliations BEGIN SELECT RAISE(ABORT,'assistant billing audit is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS assistant_billing_reconciliation_block_delete BEFORE DELETE ON assistant_billing_reconciliations BEGIN SELECT RAISE(ABORT,'assistant billing audit is append-only'); END;
