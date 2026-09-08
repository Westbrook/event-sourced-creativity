-- Idempotent administrative schema only. Does not release reservations.
-- Apply only through the Site owner’s reviewed database migration procedure.
CREATE TABLE IF NOT EXISTS budget_hold_dispositions (
    disposition_id TEXT PRIMARY KEY NOT NULL, operator_id TEXT NOT NULL,
    job_id TEXT NOT NULL, correlation_id TEXT NOT NULL,
    token_reservation_id TEXT NOT NULL UNIQUE, cost_reservation_id TEXT NOT NULL UNIQUE,
    command_sha256 TEXT NOT NULL, record_sha256 TEXT NOT NULL, record_json TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
    UNIQUE(job_id,correlation_id));

CREATE TRIGGER IF NOT EXISTS budget_hold_dispositions_no_update BEFORE UPDATE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END;

CREATE TRIGGER IF NOT EXISTS budget_hold_dispositions_no_delete BEFORE DELETE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END;

CREATE TRIGGER IF NOT EXISTS budget_reservations_disposition_no_update
      BEFORE UPDATE ON budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE token_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;

CREATE TRIGGER IF NOT EXISTS budget_reservations_disposition_no_delete
      BEFORE DELETE ON budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE token_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;

CREATE TRIGGER IF NOT EXISTS cost_budget_reservations_disposition_no_update
      BEFORE UPDATE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE cost_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;

CREATE TRIGGER IF NOT EXISTS cost_budget_reservations_disposition_no_delete
      BEFORE DELETE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE cost_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
