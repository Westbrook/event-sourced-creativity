-- H4 offline optional schema. Not a migration; no installer or product route.
CREATE TABLE generation_preparation_grants (
 grant_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), plan_id TEXT NOT NULL,
 source_ref TEXT NOT NULL, source_hash TEXT NOT NULL, source_provenance_json TEXT NOT NULL,
 config_json TEXT NOT NULL, runtime_hash TEXT NOT NULL, policy_json TEXT NOT NULL,
 token_allowance INTEGER NOT NULL CHECK(token_allowance>0), authority_version TEXT NOT NULL,
 expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')), stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN(0,1))
);
CREATE TABLE generation_preparation_operations (
 operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), grant_id TEXT NOT NULL REFERENCES generation_preparation_grants(grant_id),
 plan_id TEXT NOT NULL, request_hash TEXT NOT NULL, scope_hash TEXT NOT NULL,
 token_reservation_id TEXT NOT NULL UNIQUE, cost_reservation_id TEXT NOT NULL UNIQUE,
 financial_policy_id TEXT NOT NULL, lifecycle_reservation_id TEXT UNIQUE, measured_microusd INTEGER, measured_tokens INTEGER,
 status TEXT NOT NULL CHECK(status IN('reserved','intent','received','hold','completed')),
 provider_request_id TEXT, receipt_hash TEXT, response_id TEXT, returned_model TEXT, usage_json TEXT, http_status INTEGER,
 outcome TEXT, direction_hash TEXT, custody_failed INTEGER NOT NULL DEFAULT 0 CHECK(custody_failed IN(0,1)), reason TEXT, private_bytes INTEGER NOT NULL DEFAULT 0, private_writes INTEGER NOT NULL DEFAULT 0,
 original_reads INTEGER NOT NULL DEFAULT 0, cleanup_attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
-- F4 completion is qualified by original settlement, retained content and funded lifecycle.
CREATE UNIQUE INDEX generation_preparation_one_payer ON generation_preparation_operations(owner_id) WHERE status IN('reserved','intent','received');
-- Completed obligations may become held again while a later original is outstanding.
-- Admission, not a uniqueness exception, decides whether another purchase can start.
CREATE TRIGGER generation_preparation_admission BEFORE INSERT ON generation_preparation_operations
 WHEN NEW.status!='reserved' OR EXISTS(SELECT 1 FROM generation_preparation_operations WHERE owner_id=NEW.owner_id AND status!='completed')
 OR EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'preparation_outstanding_exposure'); END;
CREATE TABLE generation_preparation_evidence (
 operation_id TEXT NOT NULL REFERENCES generation_preparation_operations(operation_id),slot TEXT NOT NULL CHECK(slot IN('source','request','response')),
 content_ref TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(operation_id,slot)
);
CREATE TRIGGER generation_preparation_grant_identity BEFORE UPDATE ON generation_preparation_grants
 WHEN NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.plan_id!=OLD.plan_id OR NEW.source_ref!=OLD.source_ref OR NEW.source_hash!=OLD.source_hash OR NEW.source_provenance_json!=OLD.source_provenance_json OR NEW.config_json!=OLD.config_json OR NEW.runtime_hash!=OLD.runtime_hash OR NEW.policy_json!=OLD.policy_json OR NEW.token_allowance!=OLD.token_allowance OR NEW.authority_version!=OLD.authority_version OR NEW.expires_at!=OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'preparation_immutable_grant'); END;
CREATE TRIGGER generation_preparation_grant_no_delete BEFORE DELETE ON generation_preparation_grants BEGIN SELECT RAISE(ABORT,'preparation_immutable_grant'); END;
CREATE TRIGGER generation_preparation_operation_no_delete BEFORE DELETE ON generation_preparation_operations BEGIN SELECT RAISE(ABORT,'preparation_original_only'); END;
CREATE TRIGGER generation_preparation_operation_identity BEFORE UPDATE ON generation_preparation_operations
 WHEN NEW.operation_id!=OLD.operation_id OR NEW.owner_id!=OLD.owner_id OR NEW.grant_id!=OLD.grant_id OR NEW.plan_id!=OLD.plan_id OR NEW.request_hash!=OLD.request_hash OR NEW.scope_hash!=OLD.scope_hash OR NEW.token_reservation_id!=OLD.token_reservation_id OR NEW.cost_reservation_id!=OLD.cost_reservation_id OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at
 OR NEW.financial_policy_id IS NOT OLD.financial_policy_id OR NEW.lifecycle_reservation_id IS NOT OLD.lifecycle_reservation_id
 OR OLD.status!='reserved' AND NEW.status='reserved' OR OLD.status IN('received','hold','completed') AND NEW.status='intent'
 OR OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS NOT OLD.provider_request_id
 OR OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash
 OR OLD.response_id IS NOT NULL AND NEW.response_id IS NOT OLD.response_id
 OR OLD.outcome IS NOT NULL AND NEW.outcome IS NOT OLD.outcome
 OR OLD.direction_hash IS NOT NULL AND NEW.direction_hash IS NOT OLD.direction_hash
 OR OLD.usage_json IS NOT NULL AND NEW.usage_json IS NOT OLD.usage_json
 OR NEW.custody_failed<OLD.custody_failed
 OR NEW.private_bytes<OLD.private_bytes OR NEW.private_writes<OLD.private_writes OR NEW.original_reads<OLD.original_reads OR NEW.cleanup_attempts<OLD.cleanup_attempts
 BEGIN SELECT RAISE(ABORT,'preparation_immutable_purchase'); END;
CREATE TRIGGER generation_preparation_evidence_no_update BEFORE UPDATE ON generation_preparation_evidence BEGIN SELECT RAISE(ABORT,'preparation_immutable_evidence'); END;
CREATE TRIGGER generation_preparation_evidence_no_delete BEFORE DELETE ON generation_preparation_evidence BEGIN SELECT RAISE(ABORT,'preparation_immutable_evidence'); END;
CREATE TABLE generation_preparation_charges (
 operation_id TEXT PRIMARY KEY REFERENCES generation_preparation_operations(operation_id), provider_request_id TEXT NOT NULL,
 receipt_hash TEXT NOT NULL, measured_microusd INTEGER NOT NULL CHECK(measured_microusd>=0), measured_tokens INTEGER NOT NULL CHECK(measured_tokens>=0),
 authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,
 scope_hash TEXT NOT NULL, residual_exposure_microusd INTEGER CHECK(residual_exposure_microusd IS NULL OR residual_exposure_microusd>=0)
);
CREATE TRIGGER generation_preparation_external_cost BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.cost_reservation_id!=NEW.reservation_id AND COALESCE(o.lifecycle_reservation_id,'')!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_preparation_outstanding_exposure'); END;
CREATE TRIGGER generation_preparation_external_tokens BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.token_reservation_id!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_preparation_outstanding_exposure'); END;
-- Existing release/reconciliation helpers cannot silently erase an uncertain original purchase.
CREATE TRIGGER generation_preparation_cost_hold BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.cost_reservation_id=OLD.reservation_id)
 AND (NEW.reservation_id IS NOT OLD.reservation_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.stream_id IS NOT OLD.stream_id OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.operation IS NOT OLD.operation OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing','executing') AND NOT EXISTS(SELECT 1 FROM generation_preparation_operations o JOIN generation_preparation_charges c USING(operation_id)
 WHERE o.cost_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_microusd=NEW.used_microusd) OR EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.remaining_uncertainty_microusd=0 AND r.incurred_microusd=NEW.used_microusd AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=o.operation_id))))))
 BEGIN SELECT RAISE(ABORT,'generation_preparation_original_charge_required'); END;
CREATE TRIGGER generation_preparation_token_hold BEFORE UPDATE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.token_reservation_id=OLD.reservation_id)
 AND (NEW.reservation_id IS NOT OLD.reservation_id OR NEW.stream_id IS NOT OLD.stream_id OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.operation IS NOT OLD.operation OR NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_preparation_operations o JOIN generation_preparation_charges c USING(operation_id)
 WHERE o.token_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_tokens=NEW.used_tokens) OR EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.remaining_uncertainty_microusd=0 AND r.incurred_tokens=NEW.used_tokens AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=o.operation_id))))))
 BEGIN SELECT RAISE(ABORT,'generation_preparation_original_usage_required'); END;
CREATE TRIGGER generation_preparation_cost_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE cost_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_purchase'); END;
CREATE TRIGGER generation_preparation_token_no_delete BEFORE DELETE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE token_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_purchase'); END;
CREATE TRIGGER generation_preparation_charge_no_update BEFORE UPDATE ON generation_preparation_charges BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_charge'); END;
CREATE TRIGGER generation_preparation_charge_no_delete BEFORE DELETE ON generation_preparation_charges BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_charge'); END;

CREATE TABLE generation_preparation_reconciliations (
 evidence_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES generation_preparation_charges(operation_id),
 sequence INTEGER NOT NULL CHECK(sequence>0), previous_id TEXT REFERENCES generation_preparation_reconciliations(evidence_id),
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
CREATE TRIGGER generation_preparation_reconciliation_chain BEFORE INSERT ON generation_preparation_reconciliations
 WHEN NEW.sequence!=COALESCE((SELECT MAX(sequence)+1 FROM generation_preparation_reconciliations WHERE operation_id=NEW.operation_id),1)
 OR NEW.previous_id IS NOT (SELECT evidence_id FROM generation_preparation_reconciliations WHERE operation_id=NEW.operation_id ORDER BY sequence DESC LIMIT 1)
 BEGIN SELECT RAISE(ABORT,'generation_preparation_reconciliation_chain'); END;
CREATE TRIGGER generation_preparation_reconciliation_finality BEFORE INSERT ON generation_preparation_reconciliations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=NEW.operation_id AND (NEW.incurred_microusd<r.incurred_microusd OR NEW.incurred_tokens<r.incurred_tokens))
 OR EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.provider_settled=1
 AND (NEW.provider_settled!=1 OR NEW.incurred_microusd!=r.incurred_microusd OR NEW.incurred_tokens!=r.incurred_tokens))
 OR EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.lifecycle_closed=1
 AND (NEW.lifecycle_closed!=1 OR NEW.lifecycle_incurred_microusd IS NOT r.lifecycle_incurred_microusd))
 BEGIN SELECT RAISE(ABORT,'generation_preparation_settled_amount_immutable'); END;
CREATE TRIGGER generation_preparation_reconciliation_no_update BEFORE UPDATE ON generation_preparation_reconciliations BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_reconciliation'); END;
CREATE TRIGGER generation_preparation_reconciliation_no_delete BEFORE DELETE ON generation_preparation_reconciliations BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_reconciliation'); END;
-- Funds remain in native cost counters even after operational completion, including across periods.
-- Only verified lifecycle closure can settle them; ordinary release helpers cannot fabricate zero.
CREATE TRIGGER generation_preparation_lifecycle_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE lifecycle_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_provision'); END;
CREATE TRIGGER generation_preparation_lifecycle_settlement BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE lifecycle_reservation_id=OLD.reservation_id)
 AND (NEW.reservation_id!=OLD.reservation_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.stream_id!=OLD.stream_id OR NEW.correlation_id!=OLD.correlation_id OR NEW.operation!=OLD.operation OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_preparation_operations o JOIN generation_preparation_reconciliations r USING(operation_id)
 WHERE o.lifecycle_reservation_id=OLD.reservation_id AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=o.operation_id)
 AND r.lifecycle_closed=1 AND r.lifecycle_microusd=0 AND r.remaining_uncertainty_microusd=0 AND r.provider_settled=1 AND r.lifecycle_incurred_microusd=NEW.used_microusd)))
 BEGIN SELECT RAISE(ABORT,'generation_preparation_verified_lifecycle_closure_required'); END;
-- An expired or newly uncertain provision blocks every new payer purchase even if the artifact was usable.
CREATE VIEW generation_preparation_lifecycle_holds AS
 SELECT o.owner_id,o.operation_id FROM generation_preparation_operations o
 JOIN generation_preparation_reconciliations r ON r.operation_id=o.operation_id
 AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=o.operation_id)
 WHERE o.financial_policy_id IS NOT NULL AND
 (r.policy_id!=o.financial_policy_id OR NOT EXISTS(SELECT 1 FROM generation_preparation_grants g WHERE g.grant_id=o.grant_id AND g.owner_id=o.owner_id AND json_extract(g.policy_json,'$.id')=r.policy_id AND json_extract(g.policy_json,'$.lifecycle.scope')=r.lifecycle_scope AND json_extract(g.policy_json,'$.lifecycle.liabilityOwner')=r.liability_owner AND json_extract(g.policy_json,'$.lifecycle.through')=r.lifecycle_through AND json_extract(g.policy_json,'$.lifecycle.maximumMicrousd')>=r.lifecycle_microusd) OR r.provider_settled!=1 OR r.remaining_uncertainty_microusd IS NOT 0 OR
 (r.lifecycle_closed=1 AND (r.lifecycle_microusd!=0 OR r.lifecycle_incurred_microusd IS NULL OR r.lifecycle_incurred_microusd>COALESCE((SELECT reserved_microusd FROM cost_budget_reservations WHERE reservation_id=o.lifecycle_reservation_id),0))) OR
 (r.lifecycle_closed=0 AND (r.lifecycle_through<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM cost_budget_reservations c WHERE c.reservation_id=o.lifecycle_reservation_id AND c.owner_id=o.owner_id AND c.status='active' AND c.reserved_microusd>=r.lifecycle_microusd))));
CREATE TRIGGER generation_preparation_lifecycle_cost_hold BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'generation_preparation_lifecycle_exposure'); END;
CREATE TRIGGER generation_preparation_lifecycle_token_hold BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'generation_preparation_lifecycle_exposure'); END;
-- A status flag alone cannot exempt an unresolved original purchase from payer holds.
CREATE TRIGGER generation_preparation_completed_guard BEFORE UPDATE ON generation_preparation_operations
 WHEN NEW.status='completed' AND (NOT EXISTS(
 SELECT 1 FROM generation_preparation_charges c
 JOIN generation_preparation_reconciliations r USING(operation_id)
 JOIN budget_reservations t ON t.reservation_id=NEW.token_reservation_id
 JOIN cost_budget_reservations d ON d.reservation_id=NEW.cost_reservation_id
 WHERE c.operation_id=NEW.operation_id AND c.provider_request_id=NEW.provider_request_id AND c.receipt_hash=NEW.receipt_hash AND c.scope_hash=NEW.scope_hash
 AND r.policy_id=NEW.financial_policy_id AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=NEW.operation_id)
 AND r.provider_settled=1 AND r.remaining_uncertainty_microusd=0
 AND t.status IN('settled','released') AND d.status IN('settled','released')
 AND t.used_tokens=r.incurred_tokens AND d.used_microusd=r.incurred_microusd
 AND NEW.measured_tokens=t.used_tokens AND NEW.measured_microusd=d.used_microusd
 AND t.used_tokens<=t.reserved_tokens AND d.used_microusd<=d.reserved_microusd)
 OR EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE operation_id=NEW.operation_id))
 BEGIN SELECT RAISE(ABORT,'preparation_completion_unqualified'); END;
