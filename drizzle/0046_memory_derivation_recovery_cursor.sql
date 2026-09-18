CREATE TABLE `memory_derivation_recovery_cursor` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`after_finance_id` text,
	`generation` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`after_finance_id`) REFERENCES `memory_derivation_finance`(`finance_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_derivation_recovery_singleton" CHECK("memory_derivation_recovery_cursor"."singleton"=1),
	CONSTRAINT "memory_derivation_recovery_generation" CHECK(typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "memory_derivation_recovery_time" CHECK(length(updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at)
);

--> statement-breakpoint
CREATE TRIGGER memory_derivation_recovery_insert BEFORE INSERT ON memory_derivation_recovery_cursor
WHEN EXISTS(SELECT 1 FROM memory_derivation_recovery_cursor) OR NEW.generation!=0 OR NEW.after_finance_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'memory_recovery_initial_cursor_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_recovery_update BEFORE UPDATE ON memory_derivation_recovery_cursor
WHEN NEW.singleton IS NOT OLD.singleton OR NEW.generation!=OLD.generation+1 OR NEW.updated_at<OLD.updated_at
BEGIN SELECT RAISE(ABORT,'memory_recovery_cursor_compare_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_recovery_delete BEFORE DELETE ON memory_derivation_recovery_cursor
BEGIN SELECT RAISE(ABORT,'memory_recovery_cursor_cannot_reset'); END;
