-- Generated fresh-install v3 study / v2 authoring candidate. NOT registered or deployed.
-- Historical SQL and all 41 released / 31 held migrations are unchanged.
CREATE TABLE authoring_study_commits (
 preview_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE REFERENCES authoring_study_configurations(proposal_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), intent_id TEXT NOT NULL UNIQUE,
 operation TEXT NOT NULL CHECK(operation='generation-supplied-study-approval'), version INTEGER NOT NULL CHECK(version IN(1,2)),
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
 financial_policy_id TEXT, lifecycle_reservation_id TEXT UNIQUE,
 pair_artifact_verified_hash TEXT,
 pair_head_reads INTEGER NOT NULL DEFAULT 0 CHECK(pair_head_reads BETWEEN 0 AND 4),
 pair_yield_to TEXT REFERENCES generation_study_operations(operation_id) DEFERRABLE INITIALLY DEFERRED CHECK(pair_yield_to IS NULL OR pair_yield_to!=operation_id)
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

CREATE UNIQUE INDEX generation_study_one_outstanding ON generation_study_operations(owner_id) WHERE status!='completed' AND pair_yield_to IS NULL;

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
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.cost_reservation_id!=NEW.reservation_id AND COALESCE(o.lifecycle_reservation_id,'')!=NEW.reservation_id AND NOT EXISTS(SELECT 1 FROM generation_study_pair_transfers x JOIN generation_study_pair_eligible e ON e.pair_id=x.pair_id JOIN generation_study_operations t ON t.operation_id=x.treatment_id WHERE x.owner_id=NEW.owner_id AND x.baseline_id=o.operation_id AND t.owner_id=NEW.owner_id AND t.status IN('reserved','paused','running') AND NEW.correlation_id=t.operation_id AND NEW.period=x.period AND NEW.stream_id=x.stream_id AND NEW.workspace_id='forma' AND ((NEW.reservation_id=t.cost_reservation_id AND NEW.operation='generation-study' AND NEW.reserved_microusd=x.treatment_cost) OR (NEW.reservation_id=t.lifecycle_reservation_id AND NEW.operation='study-lifecycle-provision' AND NEW.reserved_microusd=x.treatment_lifecycle))))
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;

CREATE TRIGGER generation_study_external_tokens BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.token_reservation_id!=NEW.reservation_id AND NOT EXISTS(SELECT 1 FROM generation_study_pair_transfers x JOIN generation_study_pair_eligible e ON e.pair_id=x.pair_id JOIN generation_study_operations t ON t.operation_id=x.treatment_id WHERE x.owner_id=NEW.owner_id AND x.baseline_id=o.operation_id AND t.owner_id=NEW.owner_id AND t.status IN('reserved','paused','running') AND NEW.correlation_id=t.operation_id AND NEW.period=x.period AND NEW.stream_id=x.stream_id AND NEW.reservation_id=t.token_reservation_id AND NEW.operation='generation-study' AND NEW.reserved_tokens=x.treatment_tokens))
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;

CREATE TRIGGER generation_study_financial_grant_identity BEFORE UPDATE ON generation_study_financial_grants
 WHEN NEW.grant_id IS NOT OLD.grant_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.policy_json IS NOT OLD.policy_json OR NEW.expires_at IS NOT OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END;

CREATE TRIGGER generation_study_financial_grant_no_delete BEFORE DELETE ON generation_study_financial_grants BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END;

CREATE TRIGGER generation_study_grant_identity BEFORE UPDATE ON generation_study_grants
 WHEN NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.plan_id!=OLD.plan_id OR NEW.runtime_hash!=OLD.runtime_hash OR NEW.source_ref!=OLD.source_ref OR NEW.direction_ref!=OLD.direction_ref OR NEW.source_hash!=OLD.source_hash OR NEW.direction_hash!=OLD.direction_hash OR NEW.authority_version!=OLD.authority_version OR NEW.allowance_microusd!=OLD.allowance_microusd OR NEW.token_allowance!=OLD.token_allowance OR NEW.expires_at!=OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_new_authority_version_required'); END;

CREATE TRIGGER generation_study_lifecycle_cost_hold BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id AND NOT EXISTS(SELECT 1 FROM generation_study_pair_transfers x JOIN generation_study_pair_eligible e ON e.pair_id=x.pair_id JOIN generation_study_operations t ON t.operation_id=x.treatment_id WHERE x.owner_id=NEW.owner_id AND x.baseline_id=generation_study_lifecycle_holds.operation_id AND t.owner_id=NEW.owner_id AND t.status IN('reserved','paused','running') AND NEW.correlation_id=t.operation_id AND NEW.period=x.period AND NEW.stream_id=x.stream_id AND NEW.workspace_id='forma' AND ((NEW.reservation_id=t.cost_reservation_id AND NEW.operation='generation-study' AND NEW.reserved_microusd=x.treatment_cost) OR (NEW.reservation_id=t.lifecycle_reservation_id AND NEW.operation='study-lifecycle-provision' AND NEW.reserved_microusd=x.treatment_lifecycle))))
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
 WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id AND NOT EXISTS(SELECT 1 FROM generation_study_pair_transfers x JOIN generation_study_pair_eligible e ON e.pair_id=x.pair_id JOIN generation_study_operations t ON t.operation_id=x.treatment_id WHERE x.owner_id=NEW.owner_id AND x.baseline_id=generation_study_lifecycle_holds.operation_id AND t.owner_id=NEW.owner_id AND t.status IN('reserved','paused','running') AND NEW.correlation_id=t.operation_id AND NEW.period=x.period AND NEW.stream_id=x.stream_id AND NEW.reservation_id=t.token_reservation_id AND NEW.operation='generation-study' AND NEW.reserved_tokens=x.treatment_tokens))
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

-- Input to the offline fresh-install compiler, not a migration or upgrade.
CREATE TABLE generation_study_pair_transfers (
 pair_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id),
 plan_id TEXT NOT NULL, review_id TEXT NOT NULL REFERENCES generation_study_supplied_reviews(review_id), preview_id TEXT NOT NULL REFERENCES authoring_study_commits(preview_id),
 baseline_id TEXT NOT NULL UNIQUE REFERENCES generation_study_operations(operation_id),
 treatment_id TEXT NOT NULL UNIQUE REFERENCES generation_study_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 baseline_token_id TEXT NOT NULL, baseline_cost_id TEXT NOT NULL, baseline_lifecycle_id TEXT NOT NULL, treatment_token_id TEXT NOT NULL, treatment_cost_id TEXT NOT NULL, treatment_lifecycle_id TEXT NOT NULL,
 baseline_policy TEXT NOT NULL, treatment_policy TEXT NOT NULL, pair_json TEXT NOT NULL CHECK(json_valid(pair_json)),
 provider_request_id TEXT NOT NULL, artifact_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, evidence_set_hash TEXT NOT NULL,
 stream_id TEXT NOT NULL, period TEXT NOT NULL, baseline_cost INTEGER NOT NULL, baseline_lifecycle INTEGER NOT NULL, baseline_tokens INTEGER NOT NULL,
 treatment_cost INTEGER NOT NULL, treatment_lifecycle INTEGER NOT NULL, treatment_tokens INTEGER NOT NULL,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, CHECK(baseline_id!=treatment_id),
 CHECK(baseline_cost>0 AND baseline_lifecycle>0 AND baseline_tokens>0 AND treatment_cost>0 AND treatment_lifecycle>0 AND treatment_tokens>0)
);
CREATE VIEW generation_study_pair_eligible AS
 SELECT json_extract(bf.policy_json,'$.pair.id') AS pair_id,o.owner_id,o.grant_id,o.plan_id,r.review_id,a.preview_id,o.operation_id AS baseline_id,
 tf.operation_id AS treatment_id,bf.policy_id AS baseline_policy,tf.policy_id AS treatment_policy,json_extract(bf.policy_json,'$.pair') AS pair_json,
 o.provider_request_id,o.artifact_hash,o.receipt_hash,o.expires_at,o.token_reservation_id AS baseline_token_id,o.cost_reservation_id AS baseline_cost_id,o.lifecycle_reservation_id AS baseline_lifecycle_id,
 json_extract(tf.policy_json,'$.pair.arms[1].tokenReservationId') AS treatment_token_id,json_extract(tf.policy_json,'$.pair.arms[1].costReservationId') AS treatment_cost_id,json_extract(tf.policy_json,'$.pair.arms[1].lifecycleReservationId') AS treatment_lifecycle_id,
 json_extract(bf.policy_json,'$.reservationMicrousd') AS baseline_cost,json_extract(bf.policy_json,'$.lifecycleReserveMicrousd') AS baseline_lifecycle,
 json_extract(bf.policy_json,'$.pair.arms[0].tokens') AS baseline_tokens,
 json_extract(tf.policy_json,'$.reservationMicrousd') AS treatment_cost,json_extract(tf.policy_json,'$.lifecycleReserveMicrousd') AS treatment_lifecycle,
 json_extract(tf.policy_json,'$.pair.arms[1].tokens') AS treatment_tokens
 FROM generation_study_operations o
 JOIN generation_study_grants g ON g.grant_id=o.grant_id AND g.owner_id=o.owner_id AND g.plan_id=o.plan_id
 JOIN generation_study_financial_grants bf ON bf.grant_id=g.grant_id AND bf.operation_id=o.operation_id AND bf.owner_id=o.owner_id AND bf.policy_id=o.financial_policy_id
 JOIN generation_study_financial_grants tf ON tf.grant_id=g.grant_id AND tf.owner_id=o.owner_id AND tf.operation_id=json_extract(bf.policy_json,'$.pair.arms[1].operationId')
 JOIN generation_study_supplied_reviews r ON r.grant_id=g.grant_id AND r.owner_id=o.owner_id
 JOIN generation_study_supplied_observations v ON v.operation_id=o.operation_id AND v.review_id=r.review_id AND v.owner_id=o.owner_id AND v.principal_hash=r.principal_hash
 JOIN authoring_study_commits a ON a.grant_id=g.grant_id AND a.review_id=r.review_id AND a.owner_id=o.owner_id AND a.plan_id=o.plan_id AND a.principal_hash=r.principal_hash AND a.baseline_operation=o.operation_id AND a.treatment_operation=tf.operation_id
 JOIN authoring_study_configurations cfg ON cfg.proposal_id=a.proposal_id AND cfg.owner_id=o.owner_id AND cfg.configuration_hash=a.configuration_hash
 JOIN budget_reservations bt ON bt.reservation_id=o.token_reservation_id AND bt.owner_id=o.owner_id
 JOIN cost_budget_reservations bc ON bc.reservation_id=o.cost_reservation_id AND bc.owner_id=o.owner_id
 JOIN cost_budget_reservations bl ON bl.reservation_id=o.lifecycle_reservation_id AND bl.owner_id=o.owner_id
 LEFT JOIN generation_study_operations t ON t.operation_id=tf.operation_id
 WHERE (((((g.authority_version='authoring-study-v2' AND a.version=2 AND a.verified=1 AND cfg.status='active')
 AND ((g.status='authorized' AND g.stopped=0 AND bf.status='authorized' AND tf.status='authorized' AND r.status='authorized' AND r.hard_stop IS NULL)
 AND (o.status='hold' AND o.reason='original_charge_unreconciled' AND o.trial_id='baseline')))
 AND (((o.pair_yield_to IS NULL OR o.pair_yield_to=tf.operation_id))
 AND ((o.pair_artifact_verified_hash=o.artifact_hash AND o.provider_request_id IS NOT NULL AND o.artifact_ref IS NOT NULL AND o.artifact_hash=v.artifact_hash AND o.receipt_hash=v.receipt_hash AND o.private_writes=9)
 AND (json_valid(o.usage_json) AND json_type(o.usage_json,'$.input_tokens')='integer' AND json_type(o.usage_json,'$.output_tokens')='integer' AND json_type(o.usage_json,'$.total_tokens')='integer'))))
 AND (((json_extract(o.usage_json,'$.total_tokens')<=bt.reserved_tokens)
 AND ((v.safety='clear' AND v.fidelity IN('pass','expected-failure') AND v.protocol='p2-human-between-arm-v1' AND v.resume=1)
 AND ((SELECT COUNT(*) FROM generation_study_stages s WHERE s.operation_id=o.operation_id AND ((s.stage IN('advisory','moderation') AND s.status='complete') OR (s.stage='image' AND s.status='received' AND s.receipt_hash=o.receipt_hash) OR (s.stage='storage' AND s.status='complete' AND s.receipt_hash=o.artifact_hash)))=4)))
 AND ((((SELECT COUNT(*) FROM generation_study_evidence e JOIN private_content p ON p.content_id=e.content_ref WHERE e.operation_id=o.operation_id AND p.owner_id=o.owner_id AND p.redacted_at IS NULL AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))=9)
 AND (bf.expires_at=o.expires_at AND tf.expires_at=o.expires_at AND g.expires_at=o.expires_at AND r.expires_at=o.expires_at AND a.expires_at=o.expires_at AND cfg.expires_at=o.expires_at AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 AND ((json_extract(bf.policy_json,'$.version')='generation-financial-policy-v2' AND json_extract(tf.policy_json,'$.version')='generation-financial-policy-v2')
 AND (json_extract(bf.policy_json,'$.pair')=json_extract(tf.policy_json,'$.pair'))))))
 AND ((((json_extract(bf.policy_json,'$.pair.ownerId')=o.owner_id AND json_extract(bf.policy_json,'$.pair.grantId')=g.grant_id AND json_extract(bf.policy_json,'$.pair.planId')=o.plan_id AND json_extract(bf.policy_json,'$.pair.proposalId')=a.proposal_id)
 AND ((json_extract(bf.policy_json,'$.pair.arms[0].operationId')=o.operation_id AND json_extract(bf.policy_json,'$.pair.arms[0].tokenReservationId')=o.token_reservation_id AND json_extract(bf.policy_json,'$.pair.arms[0].costReservationId')=o.cost_reservation_id AND json_extract(bf.policy_json,'$.pair.arms[0].lifecycleReservationId')=o.lifecycle_reservation_id)
 AND (json_extract(bf.policy_json,'$.pairAcceptance.decision')='ALLOW_EXACT_TREATMENT_WITH_BASELINE_UNSETTLED' AND json_extract(tf.policy_json,'$.pairAcceptance.decision')='ALLOW_EXACT_TREATMENT_WITH_BASELINE_UNSETTLED')))
 AND ((bt.status='active' AND bc.status='active' AND bl.status='active')
 AND ((bt.reserved_tokens=json_extract(bf.policy_json,'$.pair.arms[0].tokens') AND bc.reserved_microusd=json_extract(bf.policy_json,'$.reservationMicrousd') AND bl.reserved_microusd=json_extract(bf.policy_json,'$.lifecycleReserveMicrousd'))
 AND (json_extract(bf.policy_json,'$.lifecycle.through')>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_extract(tf.policy_json,'$.lifecycle.through')>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))
 AND (((NOT EXISTS(SELECT 1 FROM generation_study_operations other WHERE other.owner_id=o.owner_id AND other.status!='completed' AND other.operation_id NOT IN(o.operation_id,tf.operation_id)))
 AND ((NOT EXISTS(SELECT 1 FROM budget_reservations q WHERE q.owner_id=o.owner_id AND q.status IN('authorizing','active') AND q.reservation_id!=o.token_reservation_id AND (t.operation_id IS NULL OR q.reservation_id!=t.token_reservation_id)))
 AND (NOT EXISTS(SELECT 1 FROM cost_budget_reservations q WHERE q.owner_id=o.owner_id AND q.status NOT IN('settled','released') AND q.reservation_id NOT IN(o.cost_reservation_id,o.lifecycle_reservation_id) AND (t.operation_id IS NULL OR q.reservation_id NOT IN(t.cost_reservation_id,t.lifecycle_reservation_id))))))
 AND (((NOT EXISTS(SELECT 1 FROM output_provider_calls c JOIN output_execution_grants g ON g.scope_key=c.scope_key AND g.grant_id=(SELECT grant_id FROM output_operation_slots s WHERE s.scope_key=c.scope_key AND s.slot_id=c.slot_id) WHERE g.payer_user_id=o.owner_id AND c.status NOT IN('settled','rejected')))
 AND (NOT EXISTS(SELECT 1 FROM document_jobs j WHERE j.owner_id=o.owner_id AND (j.status IN('queued','running','committing') OR json_extract(j.result_json,'$.providerSubmissionLegacyUncertain')=1 OR json_extract(j.result_json,'$.model3dProviderSubmission')='pending' OR EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(j.result_json,'$.providerSubmissions'),'{}')) WHERE (json_extract(value,'$.status') IS NULL OR json_extract(value,'$.status') NOT IN('completed','rejected') OR json_extract(value,'$.accountingState')='unknown' OR json_extract(value,'$.status')='completed' AND COALESCE(json_type(value,'$.costMicrousd'),'missing') NOT IN('integer','real')))))))
 AND ((NOT EXISTS(SELECT 1 FROM consequential_execution_steps s JOIN consequential_executions e USING(execution_id) WHERE e.actor_user_id=o.owner_id AND s.status NOT IN('settled','not-submitted')))
 AND (NOT EXISTS(SELECT 1 FROM generation_study_reconciliations q WHERE q.operation_id=o.operation_id AND (q.policy_id!=o.financial_policy_id OR q.provider_settled!=0 OR q.lifecycle_closed!=0 OR q.incurred_microusd>bc.reserved_microusd OR q.incurred_tokens>bt.reserved_tokens OR q.lifecycle_microusd>bl.reserved_microusd OR q.lifecycle_through!=json_extract(bf.policy_json,'$.lifecycle.through') OR q.lifecycle_scope!=json_extract(bf.policy_json,'$.lifecycle.scope') OR q.liability_owner!=o.owner_id))))))));
CREATE TRIGGER generation_study_pair_transfer_admission BEFORE INSERT ON generation_study_pair_transfers
 WHEN NOT EXISTS(SELECT 1 FROM generation_study_pair_eligible e WHERE e.pair_id=NEW.pair_id AND e.owner_id=NEW.owner_id AND e.grant_id=NEW.grant_id AND e.plan_id=NEW.plan_id AND e.review_id=NEW.review_id AND e.preview_id=NEW.preview_id AND e.baseline_id=NEW.baseline_id AND e.treatment_id=NEW.treatment_id AND e.baseline_token_id=NEW.baseline_token_id AND e.baseline_cost_id=NEW.baseline_cost_id AND e.baseline_lifecycle_id=NEW.baseline_lifecycle_id AND e.treatment_token_id=NEW.treatment_token_id AND e.treatment_cost_id=NEW.treatment_cost_id AND e.treatment_lifecycle_id=NEW.treatment_lifecycle_id AND e.baseline_policy=NEW.baseline_policy AND e.treatment_policy=NEW.treatment_policy AND e.pair_json=NEW.pair_json AND e.provider_request_id=NEW.provider_request_id AND e.artifact_hash=NEW.artifact_hash AND e.receipt_hash=NEW.receipt_hash AND e.expires_at=NEW.expires_at AND e.baseline_cost=NEW.baseline_cost AND e.baseline_lifecycle=NEW.baseline_lifecycle AND e.baseline_tokens=NEW.baseline_tokens AND e.treatment_cost=NEW.treatment_cost AND e.treatment_lifecycle=NEW.treatment_lifecycle AND e.treatment_tokens=NEW.treatment_tokens)
 OR EXISTS(SELECT 1 FROM generation_study_operations WHERE operation_id=NEW.treatment_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_pair_transfer_denied'); END;
CREATE TRIGGER generation_study_pair_transfer_identity BEFORE UPDATE ON generation_study_pair_transfers BEGIN SELECT RAISE(ABORT,'generation_study_pair_transfer_immutable'); END;
CREATE TRIGGER generation_study_pair_transfer_no_delete BEFORE DELETE ON generation_study_pair_transfers BEGIN SELECT RAISE(ABORT,'generation_study_pair_transfer_immutable'); END;
CREATE TRIGGER generation_study_pair_yield_guard BEFORE UPDATE OF pair_yield_to ON generation_study_operations
 WHEN NEW.pair_yield_to IS NOT OLD.pair_yield_to AND (OLD.pair_yield_to IS NOT NULL OR NEW.pair_yield_to IS NULL OR NOT EXISTS(SELECT 1 FROM generation_study_pair_transfers x JOIN generation_study_pair_eligible e USING(pair_id) WHERE x.baseline_id=OLD.operation_id AND x.treatment_id=NEW.pair_yield_to AND x.owner_id=OLD.owner_id))
 BEGIN SELECT RAISE(ABORT,'generation_study_pair_yield_denied'); END;
CREATE TRIGGER generation_study_pair_operation_admission BEFORE INSERT ON generation_study_operations
 WHEN NEW.pair_yield_to IS NOT NULL OR NEW.pair_artifact_verified_hash IS NOT NULL OR NEW.pair_head_reads!=0 OR EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND NOT EXISTS(SELECT 1 FROM generation_study_pair_transfers x JOIN generation_study_pair_eligible e USING(pair_id) WHERE x.baseline_id=o.operation_id AND o.pair_yield_to=NEW.operation_id AND x.treatment_id=NEW.operation_id AND x.owner_id=NEW.owner_id AND x.grant_id=NEW.grant_id AND x.plan_id=NEW.plan_id AND NEW.trial_id='treatment' AND NEW.token_reservation_id=x.treatment_token_id AND NEW.cost_reservation_id=x.treatment_cost_id AND NEW.lifecycle_reservation_id=x.treatment_lifecycle_id AND NEW.financial_policy_id=x.treatment_policy AND NEW.status='reserved' AND NEW.expires_at=x.expires_at))
 BEGIN SELECT RAISE(ABORT,'generation_study_pair_operation_denied'); END;

CREATE TRIGGER generation_study_pair_artifact_verification BEFORE UPDATE OF pair_artifact_verified_hash ON generation_study_operations
 WHEN NEW.pair_artifact_verified_hash IS NOT OLD.pair_artifact_verified_hash AND (OLD.pair_artifact_verified_hash IS NOT NULL OR NEW.pair_artifact_verified_hash IS NOT NEW.artifact_hash OR NEW.artifact_reads<1)
 BEGIN SELECT RAISE(ABORT,'generation_study_original_artifact_required'); END;

CREATE TRIGGER generation_study_pair_head_monotonic BEFORE UPDATE OF pair_head_reads ON generation_study_operations
 WHEN NEW.pair_head_reads!=OLD.pair_head_reads+1 OR NEW.trial_id!='baseline'
 BEGIN SELECT RAISE(ABORT,'generation_study_pair_head_limit'); END;
