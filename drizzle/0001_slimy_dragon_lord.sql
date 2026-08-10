CREATE INDEX `idx_events_stream_actor` ON `events` (`stream_id`,`actor`);--> statement-breakpoint
PRAGMA optimize;
