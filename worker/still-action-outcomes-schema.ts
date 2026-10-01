/** Additive schema shared by bootstrap and the retained migration. */
export const STILL_ACTION_OUTCOMES_SCHEMA = [
 `CREATE TABLE IF NOT EXISTS still_user_settings (owner_id TEXT PRIMARY KEY NOT NULL,suggestion_history_enabled INTEGER NOT NULL CHECK(suggestion_history_enabled IN (0,1)),updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS still_action_preferences (owner_id TEXT NOT NULL,scope_key TEXT NOT NULL,epoch TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(owner_id,scope_key))`,
 `CREATE TABLE IF NOT EXISTS still_action_receipts (decision_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,scope_key TEXT NOT NULL,consent_epoch TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=32768))`,
 `CREATE INDEX IF NOT EXISTS idx_still_action_receipts_scope ON still_action_receipts(owner_id,scope_key,created_at)`,
 `CREATE TABLE IF NOT EXISTS still_action_observations (observation_id TEXT NOT NULL,owner_id TEXT NOT NULL,scope_key TEXT NOT NULL,consent_epoch TEXT NOT NULL,decision_id TEXT,parent_id TEXT,kind TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=16384),PRIMARY KEY(owner_id,observation_id))`,
 `CREATE INDEX IF NOT EXISTS idx_still_action_observations_scope ON still_action_observations(owner_id,scope_key,created_at)`,
 `CREATE TABLE IF NOT EXISTS still_action_goals (goal_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,scope_key TEXT NOT NULL,content_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')),created_at TEXT NOT NULL,expires_at TEXT NOT NULL)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS idx_still_action_goals_active ON still_action_goals(owner_id,scope_key) WHERE status='active'`,
 `CREATE INDEX IF NOT EXISTS idx_still_action_goals_expiry ON still_action_goals(expires_at)`,
] as const;
