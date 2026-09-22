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
 status TEXT NOT NULL CHECK(status IN('reserved','intent','received','hold')),
 provider_request_id TEXT, receipt_hash TEXT, response_id TEXT, returned_model TEXT, usage_json TEXT, http_status INTEGER,
 outcome TEXT, reason TEXT, private_bytes INTEGER NOT NULL DEFAULT 0, private_writes INTEGER NOT NULL DEFAULT 0,
 original_reads INTEGER NOT NULL DEFAULT 0, cleanup_attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
-- No completion/release yet: F3 settlement/provision integration is separately reviewable.
CREATE UNIQUE INDEX generation_preparation_one_payer ON generation_preparation_operations(owner_id);
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
 OR OLD.status!='reserved' AND NEW.status='reserved' OR OLD.status IN('received','hold') AND NEW.status='intent'
 OR OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS NOT OLD.provider_request_id
 OR OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash
 OR OLD.response_id IS NOT NULL AND NEW.response_id IS NOT OLD.response_id
 OR OLD.usage_json IS NOT NULL AND NEW.usage_json IS NOT OLD.usage_json
 OR NEW.private_bytes<OLD.private_bytes OR NEW.private_writes<OLD.private_writes OR NEW.original_reads<OLD.original_reads OR NEW.cleanup_attempts<OLD.cleanup_attempts
 BEGIN SELECT RAISE(ABORT,'preparation_immutable_purchase'); END;
CREATE TRIGGER generation_preparation_evidence_no_update BEFORE UPDATE ON generation_preparation_evidence BEGIN SELECT RAISE(ABORT,'preparation_immutable_evidence'); END;
CREATE TRIGGER generation_preparation_evidence_no_delete BEFORE DELETE ON generation_preparation_evidence BEGIN SELECT RAISE(ABORT,'preparation_immutable_evidence'); END;
CREATE TRIGGER generation_preparation_external_cost BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.owner_id=NEW.owner_id AND o.cost_reservation_id!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'preparation_outstanding_exposure'); END;
CREATE TRIGGER generation_preparation_external_tokens BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.owner_id=NEW.owner_id AND o.token_reservation_id!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'preparation_outstanding_exposure'); END;
-- Until explicit F3 original-billing/provision adapter is qualified, even zero release remains closed.
CREATE TRIGGER generation_preparation_cost_hold BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE cost_reservation_id=OLD.reservation_id)
 AND (NEW.status NOT IN('active','authorizing','executing') OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period)
 BEGIN SELECT RAISE(ABORT,'preparation_reconciliation_uninstalled'); END;
CREATE TRIGGER generation_preparation_token_hold BEFORE UPDATE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE token_reservation_id=OLD.reservation_id)
 AND (NEW.status NOT IN('active','authorizing') OR NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period)
 BEGIN SELECT RAISE(ABORT,'preparation_reconciliation_uninstalled'); END;
CREATE TRIGGER generation_preparation_cost_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE cost_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'preparation_original_only'); END;
CREATE TRIGGER generation_preparation_token_no_delete BEFORE DELETE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE token_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'preparation_original_only'); END;
