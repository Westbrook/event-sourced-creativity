CREATE TABLE `memory_derivation_result_dependencies` (
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`scope_key` text NOT NULL,
	PRIMARY KEY(`job_id`, `kind`, `resource_id`, `actor_user_id`, `scope_key`),
	FOREIGN KEY (`job_id`) REFERENCES `memory_derivation_results`(`job_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_derivation_result_dependency" CHECK(kind IN('event','content','turn','task') AND length(resource_id) BETWEEN 1 AND 240 AND ((kind='turn' AND length(actor_user_id) BETWEEN 1 AND 240 AND length(scope_key) BETWEEN 1 AND 8192) OR (kind!='turn' AND actor_user_id='' AND scope_key='')))
);

--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_result_inverse` ON `memory_derivation_result_dependencies` (`kind`,`resource_id`,`actor_user_id`,`scope_key`,`job_id`);
--> statement-breakpoint
CREATE TABLE `memory_derivation_results` (
	`job_id` text PRIMARY KEY NOT NULL,
	`finance_id` text NOT NULL,
	`state` text NOT NULL,
	`raw_json` text,
	`manifest_json` text,
	`output_sha256` text,
	`manifest_sha256` text,
	`dependency_count` integer NOT NULL,
	`published_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`retired_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `memory_derivation_jobs`(`job_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finance_id`) REFERENCES `memory_derivation_finance`(`finance_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_derivation_result_state" CHECK(state IN('staging','active','withdrawn') AND typeof(dependency_count)='integer' AND dependency_count BETWEEN 1 AND 2048),
	CONSTRAINT "memory_derivation_result_body" CHECK((state IN('staging','active') AND raw_json IS NOT NULL AND manifest_json IS NOT NULL AND output_sha256 IS NOT NULL AND manifest_sha256 IS NOT NULL AND json_valid(raw_json) AND json_valid(manifest_json) AND length(CAST(raw_json AS BLOB))<=65536 AND length(CAST(manifest_json AS BLOB))<=262144 AND length(output_sha256)=64 AND output_sha256 NOT GLOB '*[^0-9a-f]*' AND length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*' AND retired_at IS NULL) OR (state='withdrawn' AND raw_json IS NULL AND manifest_json IS NULL AND output_sha256 IS NULL AND manifest_sha256 IS NULL AND retired_at IS NOT NULL)),
	CONSTRAINT "memory_derivation_result_time" CHECK(length(published_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',published_at) IS published_at AND length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND published_at<expires_at AND (retired_at IS NULL OR length(retired_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',retired_at) IS retired_at AND retired_at>=published_at))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `memory_derivation_results_finance_id_unique` ON `memory_derivation_results` (`finance_id`);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_result_expiry` ON `memory_derivation_results` (`state`,`expires_at`,`job_id`);

--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_insert BEFORE INSERT ON memory_derivation_results
WHEN NEW.state!='staging' OR EXISTS(SELECT 1 FROM memory_derivation_results WHERE job_id=NEW.job_id OR finance_id=NEW.finance_id)
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_jobs j JOIN memory_derivation_job_finance link ON link.job_id=j.job_id
  JOIN memory_derivation_finance f ON f.finance_id=link.finance_id JOIN memory_derivation_usage u ON u.finance_id=f.finance_id
  WHERE j.job_id=NEW.job_id AND link.finance_id=NEW.finance_id AND j.state='leased' AND f.admission_closed_at IS NULL
   AND j.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NEW.expires_at<=j.expires_at)
 OR json_extract(NEW.manifest_json,'$.jobId') IS NOT NEW.job_id OR json_extract(NEW.manifest_json,'$.expiresAt') IS NOT NEW.expires_at
 OR json_extract(NEW.manifest_json,'$.version') IS NOT 'native-memory-manifest-v1'
 OR NEW.published_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN SELECT RAISE(ABORT,'memory_result_admission_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_update BEFORE UPDATE ON memory_derivation_results
WHEN NEW.job_id IS NOT OLD.job_id OR NEW.finance_id IS NOT OLD.finance_id OR NEW.dependency_count IS NOT OLD.dependency_count
 OR NEW.published_at IS NOT OLD.published_at OR NEW.expires_at IS NOT OLD.expires_at
 OR NOT ((OLD.state='staging' AND NEW.state='active' AND NEW.raw_json IS OLD.raw_json AND NEW.manifest_json IS OLD.manifest_json
  AND NEW.output_sha256 IS OLD.output_sha256 AND NEW.manifest_sha256 IS OLD.manifest_sha256 AND NEW.retired_at IS NULL
  AND NEW.dependency_count=(SELECT COUNT(*) FROM memory_derivation_result_dependencies WHERE job_id=OLD.job_id))
 OR (OLD.state IN('staging','active') AND NEW.state='withdrawn' AND NEW.raw_json IS NULL AND NEW.manifest_json IS NULL
  AND NEW.output_sha256 IS NULL AND NEW.manifest_sha256 IS NULL AND NEW.retired_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'memory_result_cannot_rewrite'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_delete BEFORE DELETE ON memory_derivation_results
WHEN EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=OLD.job_id)
BEGIN SELECT RAISE(ABORT,'memory_result_tombstone_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_retired AFTER UPDATE OF state ON memory_derivation_results WHEN NEW.state='withdrawn'
BEGIN DELETE FROM memory_derivation_result_dependencies WHERE job_id=OLD.job_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_dependency_insert BEFORE INSERT ON memory_derivation_result_dependencies
WHEN EXISTS(SELECT 1 FROM memory_derivation_result_dependencies WHERE (job_id,kind,resource_id,actor_user_id,scope_key)=(NEW.job_id,NEW.kind,NEW.resource_id,NEW.actor_user_id,NEW.scope_key))
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_results r WHERE r.job_id=NEW.job_id AND r.state='staging'
 AND (SELECT COUNT(*) FROM memory_derivation_result_dependencies WHERE job_id=r.job_id)<r.dependency_count)
BEGIN SELECT RAISE(ABORT,'memory_result_dependency_closed'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_dependency_update BEFORE UPDATE ON memory_derivation_result_dependencies
BEGIN SELECT RAISE(ABORT,'memory_result_dependency_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_dependency_delete AFTER DELETE ON memory_derivation_result_dependencies
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE job_id=OLD.job_id AND state='active'; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_events_insert BEFORE INSERT ON events
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='event' AND resource_id=NEW.event_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_events_update BEFORE UPDATE ON events
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='event' AND resource_id=OLD.event_id) OR (kind='event' AND resource_id=NEW.event_id)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_events_delete BEFORE DELETE ON events
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='event' AND resource_id=OLD.event_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_event_private_payloads_insert BEFORE INSERT ON event_private_payloads
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='event' AND resource_id=NEW.private_event_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_event_private_payloads_update BEFORE UPDATE ON event_private_payloads
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='event' AND resource_id=OLD.private_event_id) OR (kind='event' AND resource_id=NEW.private_event_id)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_event_private_payloads_delete BEFORE DELETE ON event_private_payloads
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='event' AND resource_id=OLD.private_event_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_project_event_scopes_insert BEFORE INSERT ON project_event_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='event' AND resource_id=NEW.event_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_project_event_scopes_update BEFORE UPDATE ON project_event_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='event' AND resource_id=OLD.event_id) OR (kind='event' AND resource_id=NEW.event_id)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_project_event_scopes_delete BEFORE DELETE ON project_event_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='event' AND resource_id=OLD.event_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_private_content_insert BEFORE INSERT ON private_content
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=NEW.content_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_private_content_update BEFORE UPDATE ON private_content
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='content' AND resource_id=OLD.content_id) OR (kind='content' AND resource_id=NEW.content_id)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_private_content_delete BEFORE DELETE ON private_content
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=OLD.content_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_private_content_retention_scopes_insert BEFORE INSERT ON private_content_retention_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=NEW.content_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_private_content_retention_scopes_update BEFORE UPDATE ON private_content_retention_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='content' AND resource_id=OLD.content_id) OR (kind='content' AND resource_id=NEW.content_id)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_private_content_retention_scopes_delete BEFORE DELETE ON private_content_retention_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=OLD.content_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_project_resource_scopes_insert BEFORE INSERT ON project_resource_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=NEW.resource_id AND NEW.resource_kind='content'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_project_resource_scopes_update BEFORE UPDATE ON project_resource_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='content' AND resource_id=OLD.resource_id AND OLD.resource_kind='content') OR (kind='content' AND resource_id=NEW.resource_id AND NEW.resource_kind='content')); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_project_resource_scopes_delete BEFORE DELETE ON project_resource_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=OLD.resource_id AND OLD.resource_kind='content'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_assistant_turns_insert BEFORE INSERT ON assistant_turns
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='turn' AND resource_id=NEW.turn_id AND actor_user_id=NEW.actor_user_id AND scope_key=NEW.scope_key); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_assistant_turns_update BEFORE UPDATE ON assistant_turns
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='turn' AND resource_id=OLD.turn_id AND actor_user_id=OLD.actor_user_id AND scope_key=OLD.scope_key) OR (kind='turn' AND resource_id=NEW.turn_id AND actor_user_id=NEW.actor_user_id AND scope_key=NEW.scope_key)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_assistant_turns_delete BEFORE DELETE ON assistant_turns
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='turn' AND resource_id=OLD.turn_id AND actor_user_id=OLD.actor_user_id AND scope_key=OLD.scope_key); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_assistant_specialist_tasks_insert BEFORE INSERT ON assistant_specialist_tasks
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='task' AND resource_id=NEW.task_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_assistant_specialist_tasks_update BEFORE UPDATE ON assistant_specialist_tasks
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='task' AND resource_id=OLD.task_id) OR (kind='task' AND resource_id=NEW.task_id)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_assistant_specialist_tasks_delete BEFORE DELETE ON assistant_specialist_tasks
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='task' AND resource_id=OLD.task_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_consequential_executions_insert BEFORE INSERT ON consequential_executions
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='task' AND resource_id=NEW.execution_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_consequential_executions_update BEFORE UPDATE ON consequential_executions
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE (kind='task' AND resource_id=OLD.execution_id) OR (kind='task' AND resource_id=NEW.execution_id)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_result_consequential_executions_delete BEFORE DELETE ON consequential_executions
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='task' AND resource_id=OLD.execution_id); END;
