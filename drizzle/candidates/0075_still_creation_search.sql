CREATE TABLE IF NOT EXISTS creation_search_partitions(partition_key TEXT PRIMARY KEY,custody TEXT NOT NULL,project_id TEXT NOT NULL,owner_id TEXT NOT NULL,project_access_id TEXT,content_version TEXT NOT NULL DEFAULT '',index_version INTEGER NOT NULL DEFAULT 0,expected INTEGER,backfill_cursor TEXT NOT NULL DEFAULT '',backfill_complete INTEGER NOT NULL DEFAULT 0,invalidated INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_search_partition_owner ON creation_search_partitions(owner_id,project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_search_partition_access ON creation_search_partitions(project_access_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_search_records(partition_key TEXT NOT NULL,source_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('project','document','idea')),revision TEXT NOT NULL,content_hash TEXT NOT NULL,content_id TEXT NOT NULL,source_version TEXT NOT NULL,semantic_model TEXT,semantic_revision TEXT,tombstone INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(partition_key,source_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_search_source_version ON creation_search_records(partition_key,source_version,tombstone);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_search_terms(partition_key TEXT NOT NULL,term_hash TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(partition_key,term_hash,source_id));
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_events_insert AFTER INSERT ON events BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id=NEW.stream_id; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_secrets_insert AFTER INSERT ON event_private_payloads BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id IN(SELECT stream_id FROM events WHERE event_id=NEW.private_event_id); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_resources_insert AFTER INSERT ON project_resource_scopes BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=NEW.project_access_id AND NEW.resource_kind<>'content'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_project_events_insert AFTER INSERT ON project_event_scopes BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=NEW.project_access_id; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_events_update AFTER UPDATE ON events BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id=OLD.stream_id; UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id=NEW.stream_id; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_secrets_update AFTER UPDATE ON event_private_payloads BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id IN(SELECT stream_id FROM events WHERE event_id=OLD.private_event_id); UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id IN(SELECT stream_id FROM events WHERE event_id=NEW.private_event_id); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_resources_update AFTER UPDATE ON project_resource_scopes BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=OLD.project_access_id AND OLD.resource_kind<>'content'; UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=NEW.project_access_id AND NEW.resource_kind<>'content'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_project_events_update AFTER UPDATE ON project_event_scopes BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=OLD.project_access_id; UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=NEW.project_access_id; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_events_delete AFTER DELETE ON events BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id=OLD.stream_id; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_secrets_delete AFTER DELETE ON event_private_payloads BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id IN(SELECT stream_id FROM events WHERE event_id=OLD.private_event_id); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_resources_delete AFTER DELETE ON project_resource_scopes BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=OLD.project_access_id AND OLD.resource_kind<>'content'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_search_project_events_delete AFTER DELETE ON project_event_scopes BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=OLD.project_access_id; END;
