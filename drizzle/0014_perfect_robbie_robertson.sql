CREATE INDEX IF NOT EXISTS `idx_document_jobs_stream_status_requested` ON `document_jobs` (`stream_id`,`status`,`requested_at`,`job_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_document_jobs_stream_correlation` ON `document_jobs` (`stream_id`,`correlation_id`,`job_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_resource_scopes_owner_kind_actor` ON `project_resource_scopes` (`owner_user_id`,`resource_kind`,`resource_id`,`actor_user_id`);
