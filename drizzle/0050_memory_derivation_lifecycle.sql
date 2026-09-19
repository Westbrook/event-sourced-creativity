-- Additive privacy inverses only. No backfill, enrollment, source-body copies,
-- accounting mutation, or runtime DDL. Containment never grants access.
CREATE TRIGGER memory_derivation_lifecycle_event_insert BEFORE INSERT ON events
WHEN NEW.compensates_event_id IS NOT NULL OR NEW.type IN('BlockCreated','BlockRehomed','BlockRemoved','BlockRestored','DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored','DocumentRenderCompleted','DocumentArtifactEdited')
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(
  SELECT d.job_id FROM memory_derivation_result_dependencies d JOIN events source ON source.event_id=d.resource_id
    WHERE d.kind='event' AND source.stream_id=NEW.stream_id AND (
      source.event_id=NEW.compensates_event_id
      OR NEW.type IN('BlockCreated','BlockRehomed','BlockRemoved','BlockRestored')
        AND json_extract(source.payload,'$.block_id')=json_extract(NEW.payload,'$.block_id')
      OR NEW.type IN('DocumentRenderCompleted','DocumentArtifactEdited')
        AND json_extract(source.payload,'$.artifact_id')=json_extract(NEW.payload,'$.artifact_id'))
  UNION SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
    WHERE NEW.type IN('DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored')
      AND NEW.stream_id='creative:'||g.owner_user_id AND json_extract(NEW.payload,'$.document_id')=g.document_id
); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_lifecycle_resource_insert BEFORE INSERT ON project_resource_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(
    SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
      WHERE NEW.resource_kind='document' AND (NEW.owner_user_id,NEW.resource_id)=(g.owner_user_id,g.document_id)
    UNION SELECT d.job_id FROM memory_derivation_result_dependencies d JOIN events source ON source.event_id=d.resource_id
      WHERE d.kind='event' AND source.stream_id='creative:'||NEW.owner_user_id AND (
        NEW.resource_kind='block' AND json_extract(source.payload,'$.block_id')=NEW.resource_id
        OR NEW.resource_kind='artifact' AND json_extract(source.payload,'$.artifact_id')=NEW.resource_id)
); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_lifecycle_resource_update BEFORE UPDATE ON project_resource_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(
    SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
      WHERE OLD.resource_kind='document' AND (OLD.owner_user_id,OLD.resource_id)=(g.owner_user_id,g.document_id)
    UNION SELECT d.job_id FROM memory_derivation_result_dependencies d JOIN events source ON source.event_id=d.resource_id
      WHERE d.kind='event' AND source.stream_id='creative:'||OLD.owner_user_id AND (
        OLD.resource_kind='block' AND json_extract(source.payload,'$.block_id')=OLD.resource_id
        OR OLD.resource_kind='artifact' AND json_extract(source.payload,'$.artifact_id')=OLD.resource_id)
    UNION SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
      WHERE NEW.resource_kind='document' AND (NEW.owner_user_id,NEW.resource_id)=(g.owner_user_id,g.document_id)
    UNION SELECT d.job_id FROM memory_derivation_result_dependencies d JOIN events source ON source.event_id=d.resource_id
      WHERE d.kind='event' AND source.stream_id='creative:'||NEW.owner_user_id AND (
        NEW.resource_kind='block' AND json_extract(source.payload,'$.block_id')=NEW.resource_id
        OR NEW.resource_kind='artifact' AND json_extract(source.payload,'$.artifact_id')=NEW.resource_id)
); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_lifecycle_resource_delete BEFORE DELETE ON project_resource_scopes
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state IN('staging','active') AND job_id IN(
    SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
      WHERE OLD.resource_kind='document' AND (OLD.owner_user_id,OLD.resource_id)=(g.owner_user_id,g.document_id)
    UNION SELECT d.job_id FROM memory_derivation_result_dependencies d JOIN events source ON source.event_id=d.resource_id
      WHERE d.kind='event' AND source.stream_id='creative:'||OLD.owner_user_id AND (
        OLD.resource_kind='block' AND json_extract(source.payload,'$.block_id')=OLD.resource_id
        OR OLD.resource_kind='artifact' AND json_extract(source.payload,'$.artifact_id')=OLD.resource_id)
); END;
