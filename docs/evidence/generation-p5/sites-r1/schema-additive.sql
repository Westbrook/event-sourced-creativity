-- P5 Sites additive final schema candidate. NOT a registered migration.
-- Requires no existing generation_study_* or authoring_study_* objects.
-- Execute via approved atomic D1 procedure only after full dependency preflight.
-- No user/evidence/grant/consent/financial row is created. Never apply fixture upgrade SQL.
CREATE TABLE authoring_study_commits (
 preview_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE REFERENCES authoring_study_configurations(proposal_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), intent_id TEXT NOT NULL UNIQUE,
 operation TEXT NOT NULL CHECK(operation='generation-supplied-study-approval'), version INTEGER NOT NULL CHECK(version=1),
 display_hash TEXT NOT NULL, configuration_hash TEXT NOT NULL, principal_hash TEXT NOT NULL,
 plan_id TEXT NOT NULL, grant_id TEXT NOT NULL UNIQUE REFERENCES generation_study_grants(grant_id),
 review_id TEXT NOT NULL UNIQUE REFERENCES generation_study_supplied_reviews(review_id),
 baseline_operation TEXT NOT NULL UNIQUE, treatment_operation TEXT NOT NULL UNIQUE,
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
 expires_at TEXT NOT NULL, verified INTEGER NOT NULL CHECK(verified=1), created_at TEXT NOT NULL
);

CREATE TABLE authoring_study_configurations (
 proposal_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id),
 configuration_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('active','revoked'))
);

CREATE TABLE authoring_study_evidence (
 evidence_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES authoring_study_configurations(proposal_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), kind TEXT NOT NULL CHECK(kind IN('account','rate','liability','settlement','lifecycle','deletion','bound')),
 content_ref TEXT NOT NULL UNIQUE, content_hash TEXT NOT NULL,
 authority_id TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('verified','revoked'))
);

CREATE TABLE generation_study_assertions (passed INTEGER NOT NULL CHECK(passed=1));

CREATE TABLE generation_study_charges (
 operation_id TEXT PRIMARY KEY REFERENCES generation_study_operations(operation_id), provider_request_id TEXT NOT NULL,
 receipt_hash TEXT NOT NULL, measured_microusd INTEGER NOT NULL CHECK(measured_microusd>=0), measured_tokens INTEGER NOT NULL CHECK(measured_tokens>=0),
 authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,
 scope_hash TEXT NOT NULL, residual_exposure_microusd INTEGER CHECK(residual_exposure_microusd IS NULL OR residual_exposure_microusd>=0)
);

CREATE TABLE generation_study_evidence (
 operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id), slot TEXT NOT NULL,
 content_ref TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(operation_id,slot)
);

CREATE TABLE generation_study_financial_grants (
 grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id), operation_id TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES users(user_id), policy_id TEXT NOT NULL, policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
 expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')),
 PRIMARY KEY(grant_id,operation_id)
);

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

CREATE TABLE generation_study_stages (
 operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id),
 stage TEXT NOT NULL CHECK(stage IN('advisory','moderation','image','storage')),
 status TEXT NOT NULL CHECK(status IN('intent','received','complete')),
 request_hash TEXT NOT NULL, receipt_hash TEXT, PRIMARY KEY(operation_id,stage)
);

CREATE TABLE generation_study_supplied_observations (
 operation_id TEXT PRIMARY KEY REFERENCES generation_study_operations(operation_id),
 review_id TEXT NOT NULL REFERENCES generation_study_supplied_reviews(review_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), principal_hash TEXT NOT NULL,
 artifact_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, protocol TEXT NOT NULL,
 safety TEXT NOT NULL CHECK(safety IN('clear','unsafe')),
 fidelity TEXT NOT NULL CHECK(fidelity IN('pass','expected-failure')), finding TEXT NOT NULL,
 evidence_ref TEXT NOT NULL, resume INTEGER NOT NULL CHECK(resume IN(0,1)), recorded_at TEXT NOT NULL
);

CREATE TABLE generation_study_supplied_reviews (
 review_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL UNIQUE REFERENCES generation_study_grants(grant_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), principal_hash TEXT NOT NULL,
 binding_json TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('authorized','revoked')),
 hard_stop TEXT
);

CREATE UNIQUE INDEX generation_study_one_outstanding ON generation_study_operations(owner_id) WHERE status!='completed';

CREATE VIEW generation_study_lifecycle_holds AS
 SELECT o.owner_id,o.operation_id FROM generation_study_operations o
 JOIN generation_study_reconciliations r ON r.operation_id=o.operation_id
 AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id)
 WHERE o.financial_policy_id IS NOT NULL AND
 (r.policy_id!=o.financial_policy_id OR NOT EXISTS(SELECT 1 FROM generation_study_financial_grants g WHERE g.grant_id=o.grant_id AND g.operation_id=o.operation_id AND g.owner_id=o.owner_id AND g.policy_id=r.policy_id AND json_extract(g.policy_json,'$.lifecycle.scope')=r.lifecycle_scope AND json_extract(g.policy_json,'$.lifecycle.liabilityOwner')=r.liability_owner AND json_extract(g.policy_json,'$.lifecycle.through')=r.lifecycle_through AND json_extract(g.policy_json,'$.lifecycle.maximumMicrousd')>=r.lifecycle_microusd) OR r.provider_settled!=1 OR r.remaining_uncertainty_microusd IS NOT 0 OR
 (r.lifecycle_closed=1 AND (r.lifecycle_microusd!=0 OR r.lifecycle_incurred_microusd IS NULL OR r.lifecycle_incurred_microusd>COALESCE((SELECT reserved_microusd FROM cost_budget_reservations WHERE reservation_id=o.lifecycle_reservation_id),0))) OR
 (r.lifecycle_closed=0 AND (r.lifecycle_through<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM cost_budget_reservations c WHERE c.reservation_id=o.lifecycle_reservation_id AND c.owner_id=o.owner_id AND c.status='active' AND c.reserved_microusd>=r.lifecycle_microusd))));

CREATE TRIGGER authoring_study_commit_no_delete BEFORE DELETE ON authoring_study_commits BEGIN SELECT RAISE(ABORT,'authoring_study_receipt_immutable'); END;

CREATE TRIGGER authoring_study_commit_no_update BEFORE UPDATE ON authoring_study_commits BEGIN SELECT RAISE(ABORT,'authoring_study_receipt_immutable'); END;

CREATE TRIGGER authoring_study_configuration_identity BEFORE UPDATE ON authoring_study_configurations
 WHEN NEW.proposal_id IS NOT OLD.proposal_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.configuration_hash IS NOT OLD.configuration_hash OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status='revoked'
 BEGIN SELECT RAISE(ABORT,'authoring_study_configuration_immutable'); END;

CREATE TRIGGER authoring_study_configuration_no_delete BEFORE DELETE ON authoring_study_configurations BEGIN SELECT RAISE(ABORT,'authoring_study_configuration_immutable'); END;

CREATE TRIGGER authoring_study_evidence_identity BEFORE UPDATE ON authoring_study_evidence
 WHEN NEW.evidence_id IS NOT OLD.evidence_id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind OR NEW.content_ref IS NOT OLD.content_ref OR NEW.content_hash IS NOT OLD.content_hash OR NEW.authority_id IS NOT OLD.authority_id OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status='revoked'
 BEGIN SELECT RAISE(ABORT,'authoring_study_evidence_immutable'); END;

CREATE TRIGGER authoring_study_evidence_no_delete BEFORE DELETE ON authoring_study_evidence BEGIN SELECT RAISE(ABORT,'authoring_study_evidence_immutable'); END;

CREATE TRIGGER generation_study_charge_no_delete BEFORE DELETE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END;

CREATE TRIGGER generation_study_charge_no_update BEFORE UPDATE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END;

CREATE TRIGGER generation_study_cost_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE cost_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;

CREATE TRIGGER generation_study_cost_settlement BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.cost_reservation_id=OLD.reservation_id)
 AND (NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing','executing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)
 WHERE o.cost_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_microusd=NEW.used_microusd) OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.incurred_microusd=NEW.used_microusd AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id))))))
 BEGIN SELECT RAISE(ABORT,'generation_study_original_charge_required'); END;

CREATE TRIGGER generation_study_external_cost BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.cost_reservation_id!=NEW.reservation_id AND COALESCE(o.lifecycle_reservation_id,'')!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;

CREATE TRIGGER generation_study_external_tokens BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.token_reservation_id!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;

CREATE TRIGGER generation_study_financial_grant_identity BEFORE UPDATE ON generation_study_financial_grants
 WHEN NEW.grant_id IS NOT OLD.grant_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.policy_json IS NOT OLD.policy_json OR NEW.expires_at IS NOT OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END;

CREATE TRIGGER generation_study_financial_grant_no_delete BEFORE DELETE ON generation_study_financial_grants BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END;

CREATE TRIGGER generation_study_grant_identity BEFORE UPDATE ON generation_study_grants
 WHEN NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.plan_id!=OLD.plan_id OR NEW.runtime_hash!=OLD.runtime_hash OR NEW.source_ref!=OLD.source_ref OR NEW.direction_ref!=OLD.direction_ref OR NEW.source_hash!=OLD.source_hash OR NEW.direction_hash!=OLD.direction_hash OR NEW.authority_version!=OLD.authority_version OR NEW.allowance_microusd!=OLD.allowance_microusd OR NEW.token_allowance!=OLD.token_allowance OR NEW.expires_at!=OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_new_authority_version_required'); END;

CREATE TRIGGER generation_study_lifecycle_cost_hold BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_lifecycle_exposure'); END;

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

CREATE TRIGGER generation_study_lifecycle_token_hold BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_lifecycle_exposure'); END;

CREATE TRIGGER generation_study_operation_identity BEFORE UPDATE ON generation_study_operations
 WHEN NEW.operation_id!=OLD.operation_id OR NEW.owner_id!=OLD.owner_id OR NEW.grant_id!=OLD.grant_id OR NEW.plan_id!=OLD.plan_id OR NEW.trial_id!=OLD.trial_id OR NEW.request_hash!=OLD.request_hash OR NEW.token_reservation_id!=OLD.token_reservation_id OR NEW.cost_reservation_id!=OLD.cost_reservation_id OR NEW.expires_at!=OLD.expires_at OR NEW.financial_policy_id IS NOT OLD.financial_policy_id OR NEW.lifecycle_reservation_id IS NOT OLD.lifecycle_reservation_id
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_identity'); END;

CREATE TRIGGER generation_study_operation_no_delete BEFORE DELETE ON generation_study_operations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;

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

CREATE TRIGGER generation_study_reconciliation_no_delete BEFORE DELETE ON generation_study_reconciliations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_reconciliation'); END;

CREATE TRIGGER generation_study_reconciliation_no_update BEFORE UPDATE ON generation_study_reconciliations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_reconciliation'); END;

CREATE TRIGGER generation_study_supplied_grant_revocation BEFORE UPDATE ON generation_study_grants
 WHEN OLD.status='revoked' AND NEW.status!='revoked' AND EXISTS(SELECT 1 FROM generation_study_supplied_reviews WHERE grant_id=OLD.grant_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_supplied_revocation_terminal'); END;

CREATE TRIGGER generation_study_supplied_observation_no_delete BEFORE DELETE ON generation_study_supplied_observations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_observation'); END;

CREATE TRIGGER generation_study_supplied_observation_no_update BEFORE UPDATE ON generation_study_supplied_observations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_observation'); END;

CREATE TRIGGER generation_study_supplied_review_identity BEFORE UPDATE ON generation_study_supplied_reviews
 WHEN NEW.review_id!=OLD.review_id OR NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.principal_hash!=OLD.principal_hash OR NEW.binding_json!=OLD.binding_json OR NEW.expires_at!=OLD.expires_at OR (OLD.status='revoked' AND NEW.status!='revoked') OR (OLD.hard_stop IS NOT NULL AND NEW.hard_stop IS NOT OLD.hard_stop)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_review'); END;

CREATE TRIGGER generation_study_supplied_review_no_delete BEFORE DELETE ON generation_study_supplied_reviews BEGIN SELECT RAISE(ABORT,'generation_study_immutable_review'); END;

CREATE TRIGGER generation_study_supplied_stage_identity BEFORE UPDATE ON generation_study_stages
 WHEN NEW.operation_id!=OLD.operation_id OR NEW.stage!=OLD.stage OR NEW.request_hash!=OLD.request_hash OR (OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash) OR (OLD.status='received' AND NEW.status='intent') OR (OLD.status='complete' AND NEW.status!='complete')
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_intent'); END;

CREATE TRIGGER generation_study_supplied_stage_no_delete BEFORE DELETE ON generation_study_stages BEGIN SELECT RAISE(ABORT,'generation_study_immutable_intent'); END;

CREATE TRIGGER generation_study_token_no_delete BEFORE DELETE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE token_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;

CREATE TRIGGER generation_study_token_settlement BEFORE UPDATE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.token_reservation_id=OLD.reservation_id)
 AND (NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)
 WHERE o.token_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_tokens=NEW.used_tokens) OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.incurred_tokens=NEW.used_tokens AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id))))))
 BEGIN SELECT RAISE(ABORT,'generation_study_original_usage_required'); END;
