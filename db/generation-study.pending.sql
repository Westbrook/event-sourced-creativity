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
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 financial_policy_id TEXT, lifecycle_reservation_id TEXT UNIQUE
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
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.cost_reservation_id!=NEW.reservation_id AND COALESCE(o.lifecycle_reservation_id,'')!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;
CREATE TRIGGER generation_study_external_tokens BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.token_reservation_id!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;
-- Existing release/reconciliation helpers cannot silently erase an uncertain original purchase.
CREATE TRIGGER generation_study_cost_settlement BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.cost_reservation_id=OLD.reservation_id)
 AND (NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing','executing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)
 WHERE o.cost_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_microusd=NEW.used_microusd) OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.incurred_microusd=NEW.used_microusd AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id))))))
 BEGIN SELECT RAISE(ABORT,'generation_study_original_charge_required'); END;
CREATE TRIGGER generation_study_token_settlement BEFORE UPDATE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.token_reservation_id=OLD.reservation_id)
 AND (NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)
 WHERE o.token_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_tokens=NEW.used_tokens) OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.incurred_tokens=NEW.used_tokens AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id))))))
 BEGIN SELECT RAISE(ABORT,'generation_study_original_usage_required'); END;
CREATE TRIGGER generation_study_cost_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE cost_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
CREATE TRIGGER generation_study_token_no_delete BEFORE DELETE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE token_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
CREATE TRIGGER generation_study_operation_no_delete BEFORE DELETE ON generation_study_operations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
CREATE TRIGGER generation_study_operation_identity BEFORE UPDATE ON generation_study_operations
 WHEN NEW.operation_id!=OLD.operation_id OR NEW.owner_id!=OLD.owner_id OR NEW.grant_id!=OLD.grant_id OR NEW.plan_id!=OLD.plan_id OR NEW.trial_id!=OLD.trial_id OR NEW.request_hash!=OLD.request_hash OR NEW.token_reservation_id!=OLD.token_reservation_id OR NEW.cost_reservation_id!=OLD.cost_reservation_id OR NEW.expires_at!=OLD.expires_at OR NEW.financial_policy_id IS NOT OLD.financial_policy_id OR NEW.lifecycle_reservation_id IS NOT OLD.lifecycle_reservation_id
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_identity'); END;
CREATE TRIGGER generation_study_grant_identity BEFORE UPDATE ON generation_study_grants
 WHEN NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.plan_id!=OLD.plan_id OR NEW.runtime_hash!=OLD.runtime_hash OR NEW.source_ref!=OLD.source_ref OR NEW.direction_ref!=OLD.direction_ref OR NEW.source_hash!=OLD.source_hash OR NEW.direction_hash!=OLD.direction_hash OR NEW.authority_version!=OLD.authority_version OR NEW.allowance_microusd!=OLD.allowance_microusd OR NEW.token_allowance!=OLD.token_allowance OR NEW.expires_at!=OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_new_authority_version_required'); END;
CREATE TRIGGER generation_study_charge_no_update BEFORE UPDATE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END;
CREATE TRIGGER generation_study_charge_no_delete BEFORE DELETE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END;

-- F3 v1: server-owned financial authority, separate from F2 bounded qualification.
-- No request ingestion endpoint, installed migration, or real grant is supplied.
CREATE TABLE generation_study_financial_grants (
 grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id), operation_id TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES users(user_id), policy_id TEXT NOT NULL, policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
 expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')),
 PRIMARY KEY(grant_id,operation_id)
);
CREATE TRIGGER generation_study_financial_grant_identity BEFORE UPDATE ON generation_study_financial_grants
 WHEN NEW.grant_id IS NOT OLD.grant_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.policy_json IS NOT OLD.policy_json OR NEW.expires_at IS NOT OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END;
CREATE TRIGGER generation_study_financial_grant_no_delete BEFORE DELETE ON generation_study_financial_grants BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END;
-- Each event is a cumulative verified assessment of the SAME immutable receipt, not an additive charge.
CREATE TABLE generation_study_reconciliations (
 evidence_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES generation_study_charges(operation_id),
 sequence INTEGER NOT NULL CHECK(sequence>0), previous_id TEXT REFERENCES generation_study_reconciliations(evidence_id),
 original_charge_hash TEXT NOT NULL, policy_id TEXT NOT NULL, evidence_kind TEXT NOT NULL CHECK(evidence_kind='verified-incurred-charge'),
 authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,
 provider_settled INTEGER NOT NULL CHECK(provider_settled IN(0,1)),
 incurred_microusd INTEGER NOT NULL CHECK(incurred_microusd>=0), incurred_tokens INTEGER NOT NULL CHECK(incurred_tokens>=0),
 remaining_uncertainty_microusd INTEGER CHECK(remaining_uncertainty_microusd IS NULL OR remaining_uncertainty_microusd>=0),
 lifecycle_microusd INTEGER NOT NULL CHECK(lifecycle_microusd>=0), lifecycle_scope TEXT NOT NULL,
 liability_owner TEXT NOT NULL, lifecycle_through TEXT NOT NULL, lifecycle_evidence_ref TEXT NOT NULL,
 lifecycle_closed INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_closed IN(0,1)), lifecycle_incurred_microusd INTEGER,
 UNIQUE(operation_id,sequence)
);
CREATE TRIGGER generation_study_reconciliation_chain BEFORE INSERT ON generation_study_reconciliations
 WHEN NEW.sequence!=COALESCE((SELECT MAX(sequence)+1 FROM generation_study_reconciliations WHERE operation_id=NEW.operation_id),1)
 OR NEW.previous_id IS NOT (SELECT evidence_id FROM generation_study_reconciliations WHERE operation_id=NEW.operation_id ORDER BY sequence DESC LIMIT 1)
 BEGIN SELECT RAISE(ABORT,'generation_study_reconciliation_chain'); END;
CREATE TRIGGER generation_study_reconciliation_finality BEFORE INSERT ON generation_study_reconciliations
 WHEN EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND (NEW.incurred_microusd<r.incurred_microusd OR NEW.incurred_tokens<r.incurred_tokens))
 OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.provider_settled=1
 AND (NEW.provider_settled!=1 OR NEW.incurred_microusd!=r.incurred_microusd OR NEW.incurred_tokens!=r.incurred_tokens))
 OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.lifecycle_closed=1
 AND (NEW.lifecycle_closed!=1 OR NEW.lifecycle_incurred_microusd IS NOT r.lifecycle_incurred_microusd))
 BEGIN SELECT RAISE(ABORT,'generation_study_settled_amount_immutable'); END;
CREATE TRIGGER generation_study_reconciliation_no_update BEFORE UPDATE ON generation_study_reconciliations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_reconciliation'); END;
CREATE TRIGGER generation_study_reconciliation_no_delete BEFORE DELETE ON generation_study_reconciliations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_reconciliation'); END;
-- Funds remain in native cost counters even after operational completion, including across periods.
-- Only verified lifecycle closure can settle them; ordinary release helpers cannot fabricate zero.
CREATE TRIGGER generation_study_lifecycle_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE lifecycle_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_provision'); END;
CREATE TRIGGER generation_study_lifecycle_settlement BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE lifecycle_reservation_id=OLD.reservation_id)
 AND (NEW.reservation_id!=OLD.reservation_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.stream_id!=OLD.stream_id OR NEW.correlation_id!=OLD.correlation_id OR NEW.operation!=OLD.operation OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_reconciliations r USING(operation_id)
 WHERE o.lifecycle_reservation_id=OLD.reservation_id AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id)
 AND r.lifecycle_closed=1 AND r.lifecycle_microusd=0 AND r.remaining_uncertainty_microusd=0 AND r.provider_settled=1 AND r.lifecycle_incurred_microusd=NEW.used_microusd)))
 BEGIN SELECT RAISE(ABORT,'generation_study_verified_lifecycle_closure_required'); END;
-- An expired or newly uncertain provision blocks every new payer purchase even if the artifact was usable.
CREATE VIEW generation_study_lifecycle_holds AS
 SELECT o.owner_id,o.operation_id FROM generation_study_operations o
 JOIN generation_study_reconciliations r ON r.operation_id=o.operation_id
 AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id)
 WHERE o.financial_policy_id IS NOT NULL AND
 (r.policy_id!=o.financial_policy_id OR NOT EXISTS(SELECT 1 FROM generation_study_financial_grants g WHERE g.grant_id=o.grant_id AND g.operation_id=o.operation_id AND g.owner_id=o.owner_id AND g.policy_id=r.policy_id AND json_extract(g.policy_json,'$.lifecycle.scope')=r.lifecycle_scope AND json_extract(g.policy_json,'$.lifecycle.liabilityOwner')=r.liability_owner AND json_extract(g.policy_json,'$.lifecycle.through')=r.lifecycle_through AND json_extract(g.policy_json,'$.lifecycle.maximumMicrousd')>=r.lifecycle_microusd) OR r.provider_settled!=1 OR r.remaining_uncertainty_microusd IS NOT 0 OR
 (r.lifecycle_closed=1 AND (r.lifecycle_microusd!=0 OR r.lifecycle_incurred_microusd IS NULL OR r.lifecycle_incurred_microusd>COALESCE((SELECT reserved_microusd FROM cost_budget_reservations WHERE reservation_id=o.lifecycle_reservation_id),0))) OR
 (r.lifecycle_closed=0 AND (r.lifecycle_through<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM cost_budget_reservations c WHERE c.reservation_id=o.lifecycle_reservation_id AND c.owner_id=o.owner_id AND c.status='active' AND c.reserved_microusd>=r.lifecycle_microusd))));
CREATE TRIGGER generation_study_lifecycle_cost_hold BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_lifecycle_exposure'); END;
CREATE TRIGGER generation_study_lifecycle_token_hold BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_lifecycle_exposure'); END;
