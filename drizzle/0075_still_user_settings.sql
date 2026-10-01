-- Durable account preferences are separate from expiring diagnostic evidence.
CREATE TABLE IF NOT EXISTS still_user_settings (owner_id TEXT PRIMARY KEY NOT NULL,suggestion_history_enabled INTEGER NOT NULL CHECK(suggestion_history_enabled IN (0,1)),updated_at TEXT NOT NULL);
