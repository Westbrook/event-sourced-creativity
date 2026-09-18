CREATE TABLE `managed_video_reconciliations` (
	`reconciliation_id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`job_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`token_reservation_id` text NOT NULL,
	`cost_reservation_id` text NOT NULL,
	`command_sha256` text NOT NULL,
	`treatment_sha256` text NOT NULL,
	`record_sha256` text NOT NULL,
	`record_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_video_reconciliations_token_reservation_id_unique` ON `managed_video_reconciliations` (`token_reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_video_reconciliations_cost_reservation_id_unique` ON `managed_video_reconciliations` (`cost_reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_video_reconciliations_job_attempt` ON `managed_video_reconciliations` (`job_id`,`correlation_id`);

--> statement-breakpoint
CREATE TRIGGER managed_video_reconciliations_no_update BEFORE UPDATE ON managed_video_reconciliations
    BEGIN SELECT RAISE(ABORT,'video_reconciliations_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER managed_video_reconciliations_no_delete BEFORE DELETE ON managed_video_reconciliations
    BEGIN SELECT RAISE(ABORT,'video_reconciliations_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER managed_video_reconciliations_no_replace BEFORE INSERT ON managed_video_reconciliations
    WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE reconciliation_id=NEW.reconciliation_id
      OR token_reservation_id=NEW.token_reservation_id OR cost_reservation_id=NEW.cost_reservation_id
      OR (job_id=NEW.job_id AND correlation_id=NEW.correlation_id))
    BEGIN SELECT RAISE(ABORT,'video_reconciliations_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_video_reconciliation_no_insert
      BEFORE INSERT ON budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE token_reservation_id=NEW.reservation_id)
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_video_reconciliation_no_update
      BEFORE UPDATE ON budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE token_reservation_id IN(OLD.reservation_id,NEW.reservation_id))
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_video_reconciliation_no_delete
      BEFORE DELETE ON budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE token_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_video_reconciliation_no_insert
      BEFORE INSERT ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE cost_reservation_id=NEW.reservation_id)
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_video_reconciliation_no_update
      BEFORE UPDATE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE cost_reservation_id IN(OLD.reservation_id,NEW.reservation_id))
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_video_reconciliation_no_delete
      BEFORE DELETE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE cost_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
