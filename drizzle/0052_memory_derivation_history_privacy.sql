-- Rolling windows retain direct original dependencies, not prior model bodies.
-- Erasing a remembered reference must retire downstream windows immediately.
CREATE TRIGGER memory_derivation_history_source_delete BEFORE DELETE ON memory_live_sources
BEGIN
 UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,
 retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state IN('staging','active') AND job_id IN(
  SELECT d.job_id FROM memory_derivation_result_dependencies d JOIN memory_derivation_jobs j ON j.job_id=d.job_id
  JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
  WHERE d.kind='event' AND d.resource_id=OLD.event_id AND g.enrollment_id=OLD.enrollment_id);
END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_history_source_update BEFORE UPDATE ON memory_live_sources
WHEN NEW.enrollment_id IS NOT OLD.enrollment_id OR NEW.event_id IS NOT OLD.event_id OR NEW.sequence IS NOT OLD.sequence OR NEW.expires_at IS NOT OLD.expires_at
BEGIN
 UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,
 retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state IN('staging','active') AND job_id IN(
  SELECT d.job_id FROM memory_derivation_result_dependencies d JOIN memory_derivation_jobs j ON j.job_id=d.job_id
  JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
  WHERE d.kind='event' AND ((d.resource_id=OLD.event_id AND g.enrollment_id=OLD.enrollment_id)
   OR (d.resource_id=NEW.event_id AND g.enrollment_id=NEW.enrollment_id)));
END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_history_source_replace BEFORE INSERT ON memory_live_sources
WHEN EXISTS(SELECT 1 FROM memory_live_sources WHERE enrollment_id=NEW.enrollment_id AND event_id=NEW.event_id)
BEGIN
 UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,
 retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state IN('staging','active') AND job_id IN(
  SELECT d.job_id FROM memory_derivation_result_dependencies d JOIN memory_derivation_jobs j ON j.job_id=d.job_id
  JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
  WHERE d.kind='event' AND d.resource_id=NEW.event_id AND g.enrollment_id=NEW.enrollment_id);
END;
