CREATE TABLE memory_document_job_origin_retirement_progress (
  origin_id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  evidence_json TEXT NOT NULL CHECK (typeof(evidence_json) = 'text' AND length(CAST(evidence_json AS BLOB)) BETWEEN 1 AND 524288 AND json_valid(evidence_json)),
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  selector_count INTEGER NOT NULL CHECK (selector_count BETWEEN 1 AND 513),
  selector_cursor INTEGER NOT NULL CHECK (selector_cursor BETWEEN 0 AND selector_count),
  phase TEXT NOT NULL CHECK (phase IN ('answer','manifest','selectors','answer-delete','manifest-delete','finalize')),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 517),
  answer_redacted_at TEXT,
  manifest_redacted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at AND length(created_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at AND length(updated_at) = 24 AND updated_at >= created_at,0)),
  CHECK (COALESCE((phase = 'answer' AND revision = 0 AND selector_cursor = 0 AND answer_redacted_at IS NULL AND manifest_redacted_at IS NULL)
    OR (phase = 'manifest' AND revision = 1 AND selector_cursor = 0 AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NULL)
    OR (phase = 'selectors' AND revision = 2 + selector_cursor AND selector_cursor < selector_count AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NOT NULL)
    OR (phase = 'answer-delete' AND revision = 2 + selector_count AND selector_cursor = selector_count AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NOT NULL)
    OR (phase = 'manifest-delete' AND revision = 3 + selector_count AND selector_cursor = selector_count AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NOT NULL)
    OR (phase = 'finalize' AND revision = 4 + selector_count AND selector_cursor = selector_count AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NOT NULL),0)),
  CHECK (answer_redacted_at IS NULL OR COALESCE(length(answer_redacted_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ',answer_redacted_at) IS answer_redacted_at
    AND answer_redacted_at BETWEEN created_at AND updated_at,0)),
  CHECK (manifest_redacted_at IS NULL OR COALESCE(length(manifest_redacted_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ',manifest_redacted_at) IS manifest_redacted_at
    AND manifest_redacted_at BETWEEN answer_redacted_at AND updated_at,0))
);
--> statement-breakpoint
CREATE TRIGGER memory_document_job_origin_retirement_insert BEFORE INSERT ON memory_document_job_origin_retirement_progress
WHEN NEW.phase IS NOT 'answer' OR NEW.revision IS NOT 0 OR NEW.selector_cursor IS NOT 0 OR NEW.answer_redacted_at IS NOT NULL
  OR NEW.manifest_redacted_at IS NOT NULL OR NEW.created_at IS NOT NEW.updated_at
  OR NOT EXISTS(SELECT 1 FROM memory_document_job_answer_origins WHERE origin_id=NEW.origin_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'memory_document_job_retirement_initialization_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER memory_document_job_origin_retirement_update BEFORE UPDATE ON memory_document_job_origin_retirement_progress
WHEN NEW.origin_id IS NOT OLD.origin_id OR NEW.schema_version IS NOT OLD.schema_version OR NEW.evidence_json IS NOT OLD.evidence_json
  OR NEW.evidence_sha256 IS NOT OLD.evidence_sha256 OR NEW.selector_count IS NOT OLD.selector_count OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision IS NOT OLD.revision+1 OR NEW.updated_at<OLD.updated_at
  OR NOT COALESCE((OLD.phase='answer' AND NEW.phase='manifest' AND NEW.selector_cursor=0 AND NEW.answer_redacted_at=NEW.updated_at AND NEW.manifest_redacted_at IS NULL)
    OR (OLD.phase='manifest' AND NEW.phase='selectors' AND NEW.selector_cursor=0 AND NEW.answer_redacted_at IS OLD.answer_redacted_at AND NEW.manifest_redacted_at=NEW.updated_at)
    OR (OLD.phase='selectors' AND NEW.selector_cursor=OLD.selector_cursor+1 AND NEW.phase=CASE WHEN NEW.selector_cursor=OLD.selector_count THEN 'answer-delete' ELSE 'selectors' END
      AND NEW.answer_redacted_at IS OLD.answer_redacted_at AND NEW.manifest_redacted_at IS OLD.manifest_redacted_at)
    OR (OLD.phase='answer-delete' AND NEW.phase='manifest-delete' AND NEW.selector_cursor=OLD.selector_cursor
      AND NEW.answer_redacted_at IS OLD.answer_redacted_at AND NEW.manifest_redacted_at IS OLD.manifest_redacted_at)
    OR (OLD.phase='manifest-delete' AND NEW.phase='finalize' AND NEW.selector_cursor=OLD.selector_cursor
      AND NEW.answer_redacted_at IS OLD.answer_redacted_at AND NEW.manifest_redacted_at IS OLD.manifest_redacted_at),0)
BEGIN SELECT RAISE(ABORT,'memory_document_job_retirement_progress_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER memory_document_job_origin_retirement_delete BEFORE DELETE ON memory_document_job_origin_retirement_progress
WHEN OLD.phase IS NOT 'finalize' OR NOT EXISTS(SELECT 1 FROM memory_document_job_answer_origins origin WHERE origin.origin_id=OLD.origin_id
  AND origin.status='minimized' AND NOT EXISTS(SELECT 1 FROM memory_document_job_origin_dependencies WHERE origin_id=origin.origin_id)
  AND NOT EXISTS(SELECT 1 FROM private_content WHERE content_id IN(origin.answer_content_id,origin.manifest_content_ref))
  AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(origin.answer_content_id,origin.manifest_content_ref))
  AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id IN(origin.answer_content_id,origin.manifest_content_ref)))
BEGIN SELECT RAISE(ABORT,'memory_document_job_retirement_finalization_invalid'); END;
