CREATE TABLE `budget_hold_dispositions` (
	`disposition_id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`job_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`token_reservation_id` text NOT NULL,
	`cost_reservation_id` text NOT NULL,
	`command_sha256` text NOT NULL,
	`record_sha256` text NOT NULL,
	`record_json` text NOT NULL,
	`event_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_hold_dispositions_token_reservation_id_unique` ON `budget_hold_dispositions` (`token_reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_hold_dispositions_cost_reservation_id_unique` ON `budget_hold_dispositions` (`cost_reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_hold_dispositions_event_id_unique` ON `budget_hold_dispositions` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hold_dispositions_job_attempt` ON `budget_hold_dispositions` (`job_id`,`correlation_id`);
--> statement-breakpoint
CREATE TRIGGER budget_hold_dispositions_no_update BEFORE UPDATE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER budget_hold_dispositions_no_delete BEFORE DELETE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER budget_hold_dispositions_no_replace BEFORE INSERT ON budget_hold_dispositions
    WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE disposition_id=NEW.disposition_id
      OR token_reservation_id=NEW.token_reservation_id OR cost_reservation_id=NEW.cost_reservation_id
      OR event_id=NEW.event_id OR (job_id=NEW.job_id AND correlation_id=NEW.correlation_id))
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_disposition_no_insert
      BEFORE INSERT ON budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE token_reservation_id=NEW.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_disposition_no_update
      BEFORE UPDATE ON budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE token_reservation_id IN(OLD.reservation_id,NEW.reservation_id))
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_disposition_no_delete
      BEFORE DELETE ON budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE token_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_disposition_no_insert
      BEFORE INSERT ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE cost_reservation_id=NEW.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_disposition_no_update
      BEFORE UPDATE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE cost_reservation_id IN(OLD.reservation_id,NEW.reservation_id))
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_disposition_no_delete
      BEFORE DELETE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE cost_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
