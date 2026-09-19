-- Additive native approval inverses. No backfill, enrollment, source copies or remote work.
CREATE TRIGGER memory_derivation_reuse_receipt_insert BEFORE INSERT ON authoring_commits
WHEN EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=NEW.preview_id)
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=NEW.preview_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_reuse_receipt_update BEFORE UPDATE ON authoring_commits
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=OLD.preview_id); UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=NEW.preview_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_reuse_receipt_delete BEFORE DELETE ON authoring_commits
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(SELECT job_id FROM memory_derivation_result_dependencies WHERE kind='content' AND resource_id=OLD.preview_id); END;
