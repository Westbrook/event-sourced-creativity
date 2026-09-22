-- H3 optional schema. Offline fixtures only; no runtime installer or migration entry.
CREATE TABLE generation_study_grants (
 grant_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id),
 plan_id TEXT NOT NULL, runtime_hash TEXT NOT NULL, source_ref TEXT NOT NULL, direction_ref TEXT NOT NULL,
 source_hash TEXT NOT NULL, direction_hash TEXT NOT NULL, authority_version TEXT NOT NULL,
 allowance_microusd INTEGER NOT NULL CHECK(allowance_microusd>0), token_allowance INTEGER NOT NULL CHECK(token_allowance>0),
 expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')), stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN(0,1))
);
CREATE TABLE generation_study_operations (
 operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id),
 plan_id TEXT NOT NULL, trial_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 token_reservation_id TEXT NOT NULL UNIQUE, cost_reservation_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN('reserved','paused','running','hold','completed')), reason TEXT,
 provider_request_id TEXT, receipt_hash TEXT, usage_json TEXT, measured_microusd INTEGER, measured_tokens INTEGER,
 artifact_ref TEXT, artifact_hash TEXT, private_bytes INTEGER NOT NULL DEFAULT 0, private_writes INTEGER NOT NULL DEFAULT 0,
 artifact_reads INTEGER NOT NULL DEFAULT 0, cleanup_attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX generation_study_one_outstanding ON generation_study_operations(owner_id) WHERE status!='completed';
CREATE TABLE generation_study_stages (
 operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id), stage TEXT NOT NULL CHECK(stage IN('moderation','image','storage')),
 status TEXT NOT NULL CHECK(status IN('intent','received','complete')), request_hash TEXT NOT NULL, receipt_hash TEXT,
 PRIMARY KEY(operation_id,stage)
);
CREATE TABLE generation_study_evidence (
 operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id), slot TEXT NOT NULL,
 content_ref TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(operation_id,slot)
);
CREATE TABLE generation_study_charges (
 operation_id TEXT PRIMARY KEY REFERENCES generation_study_operations(operation_id), provider_request_id TEXT NOT NULL,
 receipt_hash TEXT NOT NULL, measured_microusd INTEGER NOT NULL CHECK(measured_microusd>=0), measured_tokens INTEGER NOT NULL CHECK(measured_tokens>=0),
 authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,
 scope_hash TEXT NOT NULL, residual_exposure_microusd INTEGER CHECK(residual_exposure_microusd IS NULL OR residual_exposure_microusd>=0)
);
CREATE TABLE generation_study_assertions (passed INTEGER NOT NULL CHECK(passed=1));
-- Any ordinary reservation in this SAME D1 domain sees H3 holds, including a changed period, grant, tab or manifest.
CREATE TRIGGER generation_study_external_cost BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.cost_reservation_id!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;
CREATE TRIGGER generation_study_external_tokens BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.token_reservation_id!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;
-- Existing release/reconciliation helpers cannot silently erase an uncertain original purchase.
CREATE TRIGGER generation_study_cost_settlement BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.cost_reservation_id=OLD.reservation_id)
 AND (NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing','executing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)
 WHERE o.cost_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND c.measured_microusd=NEW.used_microusd)))
 BEGIN SELECT RAISE(ABORT,'generation_study_original_charge_required'); END;
CREATE TRIGGER generation_study_token_settlement BEFORE UPDATE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.token_reservation_id=OLD.reservation_id)
 AND (NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)
 WHERE o.token_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND c.measured_tokens=NEW.used_tokens)))
 BEGIN SELECT RAISE(ABORT,'generation_study_original_usage_required'); END;
CREATE TRIGGER generation_study_cost_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE cost_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
CREATE TRIGGER generation_study_token_no_delete BEFORE DELETE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE token_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
CREATE TRIGGER generation_study_operation_no_delete BEFORE DELETE ON generation_study_operations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
CREATE TRIGGER generation_study_operation_identity BEFORE UPDATE ON generation_study_operations
 WHEN NEW.operation_id!=OLD.operation_id OR NEW.owner_id!=OLD.owner_id OR NEW.grant_id!=OLD.grant_id OR NEW.plan_id!=OLD.plan_id OR NEW.trial_id!=OLD.trial_id OR NEW.request_hash!=OLD.request_hash OR NEW.token_reservation_id!=OLD.token_reservation_id OR NEW.cost_reservation_id!=OLD.cost_reservation_id OR NEW.expires_at!=OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_identity'); END;
CREATE TRIGGER generation_study_grant_identity BEFORE UPDATE ON generation_study_grants
 WHEN NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.plan_id!=OLD.plan_id OR NEW.runtime_hash!=OLD.runtime_hash OR NEW.source_ref!=OLD.source_ref OR NEW.direction_ref!=OLD.direction_ref OR NEW.source_hash!=OLD.source_hash OR NEW.direction_hash!=OLD.direction_hash OR NEW.authority_version!=OLD.authority_version OR NEW.allowance_microusd!=OLD.allowance_microusd OR NEW.token_allowance!=OLD.token_allowance OR NEW.expires_at!=OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_new_authority_version_required'); END;
CREATE TRIGGER generation_study_charge_no_update BEFORE UPDATE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END;
CREATE TRIGGER generation_study_charge_no_delete BEFORE DELETE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END;
