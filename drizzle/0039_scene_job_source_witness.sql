ALTER TABLE document_jobs ADD COLUMN scene_source_version_json TEXT;
--> statement-breakpoint
ALTER TABLE document_jobs ADD COLUMN scene_source_protocol INTEGER NOT NULL DEFAULT 0 CHECK(scene_source_protocol IN(0,1));
