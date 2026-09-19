CREATE TABLE `memory_derivation_index_intents` (
 `job_id` text PRIMARY KEY NOT NULL,
 `operation` text NOT NULL,
 `generation` integer NOT NULL,
 `updated_at` text NOT NULL,
 `expires_at` text,
 CONSTRAINT "memory_index_id" CHECK(length(job_id)=64 AND job_id NOT GLOB '*[^0-9a-f]*'),
 CONSTRAINT "memory_index_state" CHECK((operation='upsert' AND generation=1 AND expires_at IS NOT NULL) OR (operation='delete' AND generation=2 AND expires_at IS NULL)),
 CONSTRAINT "memory_index_time" CHECK(length(updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at AND (expires_at IS NULL OR length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND updated_at<expires_at))
);
--> statement-breakpoint
CREATE INDEX idx_memory_derivation_index_pending ON memory_derivation_index_intents(operation,job_id);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_index_insert BEFORE INSERT ON memory_derivation_index_intents
WHEN EXISTS(SELECT 1 FROM memory_derivation_index_intents WHERE job_id=NEW.job_id)
 OR NEW.operation!='upsert' OR NEW.generation!=1
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_results r WHERE r.job_id=NEW.job_id AND r.state='active'
  AND r.expires_at=NEW.expires_at AND r.published_at<=NEW.updated_at AND NEW.updated_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'memory_index_original_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_index_update BEFORE UPDATE ON memory_derivation_index_intents
WHEN NEW.job_id IS NOT OLD.job_id OR OLD.operation!='upsert' OR NEW.operation!='delete'
 OR NEW.generation!=2 OR NEW.expires_at IS NOT NULL OR NEW.updated_at<OLD.updated_at
 OR NEW.updated_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR EXISTS(SELECT 1 FROM memory_derivation_results WHERE job_id=OLD.job_id AND state='active' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'memory_index_terminal'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_index_delete BEFORE DELETE ON memory_derivation_index_intents
BEGIN SELECT RAISE(ABORT,'memory_index_tombstone_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_index_published AFTER UPDATE OF state ON memory_derivation_results WHEN OLD.state='staging' AND NEW.state='active'
BEGIN INSERT INTO memory_derivation_index_intents(job_id,operation,generation,updated_at,expires_at)
 VALUES(NEW.job_id,'upsert',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.expires_at); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_index_retired AFTER UPDATE OF state ON memory_derivation_results WHEN NEW.state='withdrawn'
BEGIN UPDATE memory_derivation_index_intents SET operation='delete',generation=2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),expires_at=NULL
 WHERE job_id=NEW.job_id AND operation='upsert'; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_index_erased AFTER DELETE ON memory_derivation_results
BEGIN UPDATE memory_derivation_index_intents SET operation='delete',generation=2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),expires_at=NULL
 WHERE job_id=OLD.job_id AND operation='upsert'; END;
