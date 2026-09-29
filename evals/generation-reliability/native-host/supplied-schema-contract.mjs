// Generated from the optional SQL; no runtime installation.
export const schemaRows=[
  {
    "type": "table",
    "name": "generation_study_assertions",
    "tbl_name": "generation_study_assertions",
    "sql": "CREATE TABLE generation_study_assertions (passed INTEGER NOT NULL CHECK(passed=1))"
  },
  {
    "type": "trigger",
    "name": "generation_study_charge_no_delete",
    "tbl_name": "generation_study_charges",
    "sql": "CREATE TRIGGER generation_study_charge_no_delete BEFORE DELETE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_charge_no_update",
    "tbl_name": "generation_study_charges",
    "sql": "CREATE TRIGGER generation_study_charge_no_update BEFORE UPDATE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END"
  },
  {
    "type": "table",
    "name": "generation_study_charges",
    "tbl_name": "generation_study_charges",
    "sql": "CREATE TABLE generation_study_charges (\n operation_id TEXT PRIMARY KEY REFERENCES generation_study_operations(operation_id), provider_request_id TEXT NOT NULL,\n receipt_hash TEXT NOT NULL, measured_microusd INTEGER NOT NULL CHECK(measured_microusd>=0), measured_tokens INTEGER NOT NULL CHECK(measured_tokens>=0),\n authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,\n scope_hash TEXT NOT NULL, residual_exposure_microusd INTEGER CHECK(residual_exposure_microusd IS NULL OR residual_exposure_microusd>=0)\n)"
  },
  {
    "type": "trigger",
    "name": "generation_study_cost_no_delete",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_study_cost_no_delete BEFORE DELETE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE cost_reservation_id=OLD.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_cost_settlement",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_study_cost_settlement BEFORE UPDATE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.cost_reservation_id=OLD.reservation_id)\n AND (NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR\n (NEW.status NOT IN('active','authorizing','executing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)\n WHERE o.cost_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_microusd=NEW.used_microusd) OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.incurred_microusd=NEW.used_microusd AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id))))))\n BEGIN SELECT RAISE(ABORT,'generation_study_original_charge_required'); END"
  },
  {
    "type": "table",
    "name": "generation_study_evidence",
    "tbl_name": "generation_study_evidence",
    "sql": "CREATE TABLE generation_study_evidence (\n operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id), slot TEXT NOT NULL,\n content_ref TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(operation_id,slot)\n)"
  },
  {
    "type": "trigger",
    "name": "generation_study_external_cost",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_study_external_cost BEFORE INSERT ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.cost_reservation_id!=NEW.reservation_id AND COALESCE(o.lifecycle_reservation_id,'')!=NEW.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_external_tokens",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_study_external_tokens BEFORE INSERT ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.token_reservation_id!=NEW.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_financial_grant_identity",
    "tbl_name": "generation_study_financial_grants",
    "sql": "CREATE TRIGGER generation_study_financial_grant_identity BEFORE UPDATE ON generation_study_financial_grants\n WHEN NEW.grant_id IS NOT OLD.grant_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.policy_json IS NOT OLD.policy_json OR NEW.expires_at IS NOT OLD.expires_at\n BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_financial_grant_no_delete",
    "tbl_name": "generation_study_financial_grants",
    "sql": "CREATE TRIGGER generation_study_financial_grant_no_delete BEFORE DELETE ON generation_study_financial_grants BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END"
  },
  {
    "type": "table",
    "name": "generation_study_financial_grants",
    "tbl_name": "generation_study_financial_grants",
    "sql": "CREATE TABLE generation_study_financial_grants (\n grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id), operation_id TEXT NOT NULL,\n owner_id TEXT NOT NULL REFERENCES users(user_id), policy_id TEXT NOT NULL, policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),\n expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')),\n PRIMARY KEY(grant_id,operation_id)\n)"
  },
  {
    "type": "trigger",
    "name": "generation_study_grant_identity",
    "tbl_name": "generation_study_grants",
    "sql": "CREATE TRIGGER generation_study_grant_identity BEFORE UPDATE ON generation_study_grants\n WHEN NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.plan_id!=OLD.plan_id OR NEW.runtime_hash!=OLD.runtime_hash OR NEW.source_ref!=OLD.source_ref OR NEW.direction_ref!=OLD.direction_ref OR NEW.source_hash!=OLD.source_hash OR NEW.direction_hash!=OLD.direction_hash OR NEW.authority_version!=OLD.authority_version OR NEW.allowance_microusd!=OLD.allowance_microusd OR NEW.token_allowance!=OLD.token_allowance OR NEW.expires_at!=OLD.expires_at\n BEGIN SELECT RAISE(ABORT,'generation_study_new_authority_version_required'); END"
  },
  {
    "type": "table",
    "name": "generation_study_grants",
    "tbl_name": "generation_study_grants",
    "sql": "CREATE TABLE generation_study_grants (\n grant_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id),\n plan_id TEXT NOT NULL, runtime_hash TEXT NOT NULL, source_ref TEXT NOT NULL, direction_ref TEXT NOT NULL,\n source_hash TEXT NOT NULL, direction_hash TEXT NOT NULL, authority_version TEXT NOT NULL,\n allowance_microusd INTEGER NOT NULL CHECK(allowance_microusd>0), token_allowance INTEGER NOT NULL CHECK(token_allowance>0),\n expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')), stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN(0,1))\n)"
  },
  {
    "type": "trigger",
    "name": "generation_study_lifecycle_cost_hold",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_study_lifecycle_cost_hold BEFORE INSERT ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id)\n BEGIN SELECT RAISE(ABORT,'generation_study_lifecycle_exposure'); END"
  },
  {
    "type": "view",
    "name": "generation_study_lifecycle_holds",
    "tbl_name": "generation_study_lifecycle_holds",
    "sql": "CREATE VIEW generation_study_lifecycle_holds AS\n SELECT o.owner_id,o.operation_id FROM generation_study_operations o\n JOIN generation_study_reconciliations r ON r.operation_id=o.operation_id\n AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id)\n WHERE o.financial_policy_id IS NOT NULL AND\n (r.policy_id!=o.financial_policy_id OR NOT EXISTS(SELECT 1 FROM generation_study_financial_grants g WHERE g.grant_id=o.grant_id AND g.operation_id=o.operation_id AND g.owner_id=o.owner_id AND g.policy_id=r.policy_id AND json_extract(g.policy_json,'$.lifecycle.scope')=r.lifecycle_scope AND json_extract(g.policy_json,'$.lifecycle.liabilityOwner')=r.liability_owner AND json_extract(g.policy_json,'$.lifecycle.through')=r.lifecycle_through AND json_extract(g.policy_json,'$.lifecycle.maximumMicrousd')>=r.lifecycle_microusd) OR r.provider_settled!=1 OR r.remaining_uncertainty_microusd IS NOT 0 OR\n (r.lifecycle_closed=1 AND (r.lifecycle_microusd!=0 OR r.lifecycle_incurred_microusd IS NULL OR r.lifecycle_incurred_microusd>COALESCE((SELECT reserved_microusd FROM cost_budget_reservations WHERE reservation_id=o.lifecycle_reservation_id),0))) OR\n (r.lifecycle_closed=0 AND (r.lifecycle_through<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(\n SELECT 1 FROM cost_budget_reservations c WHERE c.reservation_id=o.lifecycle_reservation_id AND c.owner_id=o.owner_id AND c.status='active' AND c.reserved_microusd>=r.lifecycle_microusd))))"
  },
  {
    "type": "trigger",
    "name": "generation_study_lifecycle_no_delete",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_study_lifecycle_no_delete BEFORE DELETE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE lifecycle_reservation_id=OLD.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_study_immutable_provision'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_lifecycle_settlement",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_study_lifecycle_settlement BEFORE UPDATE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE lifecycle_reservation_id=OLD.reservation_id)\n AND (NEW.reservation_id!=OLD.reservation_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.stream_id!=OLD.stream_id OR NEW.correlation_id!=OLD.correlation_id OR NEW.operation!=OLD.operation OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR\n (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_reconciliations r USING(operation_id)\n WHERE o.lifecycle_reservation_id=OLD.reservation_id AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id)\n AND r.lifecycle_closed=1 AND r.lifecycle_microusd=0 AND r.remaining_uncertainty_microusd=0 AND r.provider_settled=1 AND r.lifecycle_incurred_microusd=NEW.used_microusd)))\n BEGIN SELECT RAISE(ABORT,'generation_study_verified_lifecycle_closure_required'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_lifecycle_token_hold",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_study_lifecycle_token_hold BEFORE INSERT ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id)\n BEGIN SELECT RAISE(ABORT,'generation_study_lifecycle_exposure'); END"
  },
  {
    "type": "index",
    "name": "generation_study_one_outstanding",
    "tbl_name": "generation_study_operations",
    "sql": "CREATE UNIQUE INDEX generation_study_one_outstanding ON generation_study_operations(owner_id) WHERE status!='completed'"
  },
  {
    "type": "trigger",
    "name": "generation_study_operation_identity",
    "tbl_name": "generation_study_operations",
    "sql": "CREATE TRIGGER generation_study_operation_identity BEFORE UPDATE ON generation_study_operations\n WHEN NEW.operation_id!=OLD.operation_id OR NEW.owner_id!=OLD.owner_id OR NEW.grant_id!=OLD.grant_id OR NEW.plan_id!=OLD.plan_id OR NEW.trial_id!=OLD.trial_id OR NEW.request_hash!=OLD.request_hash OR NEW.token_reservation_id!=OLD.token_reservation_id OR NEW.cost_reservation_id!=OLD.cost_reservation_id OR NEW.expires_at!=OLD.expires_at OR NEW.financial_policy_id IS NOT OLD.financial_policy_id OR NEW.lifecycle_reservation_id IS NOT OLD.lifecycle_reservation_id\n BEGIN SELECT RAISE(ABORT,'generation_study_immutable_identity'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_operation_no_delete",
    "tbl_name": "generation_study_operations",
    "sql": "CREATE TRIGGER generation_study_operation_no_delete BEFORE DELETE ON generation_study_operations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END"
  },
  {
    "type": "table",
    "name": "generation_study_operations",
    "tbl_name": "generation_study_operations",
    "sql": "CREATE TABLE generation_study_operations (\n operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id),\n plan_id TEXT NOT NULL, trial_id TEXT NOT NULL, request_hash TEXT NOT NULL,\n token_reservation_id TEXT NOT NULL UNIQUE, cost_reservation_id TEXT NOT NULL UNIQUE,\n status TEXT NOT NULL CHECK(status IN('reserved','paused','running','hold','completed')), reason TEXT,\n provider_request_id TEXT, receipt_hash TEXT, usage_json TEXT, measured_microusd INTEGER, measured_tokens INTEGER,\n artifact_ref TEXT, artifact_hash TEXT, private_bytes INTEGER NOT NULL DEFAULT 0, private_writes INTEGER NOT NULL DEFAULT 0,\n artifact_reads INTEGER NOT NULL DEFAULT 0, cleanup_attempts INTEGER NOT NULL DEFAULT 0,\n created_at TEXT NOT NULL, expires_at TEXT NOT NULL,\n financial_policy_id TEXT, lifecycle_reservation_id TEXT UNIQUE\n)"
  },
  {
    "type": "trigger",
    "name": "generation_study_reconciliation_chain",
    "tbl_name": "generation_study_reconciliations",
    "sql": "CREATE TRIGGER generation_study_reconciliation_chain BEFORE INSERT ON generation_study_reconciliations\n WHEN NEW.sequence!=COALESCE((SELECT MAX(sequence)+1 FROM generation_study_reconciliations WHERE operation_id=NEW.operation_id),1)\n OR NEW.previous_id IS NOT (SELECT evidence_id FROM generation_study_reconciliations WHERE operation_id=NEW.operation_id ORDER BY sequence DESC LIMIT 1)\n BEGIN SELECT RAISE(ABORT,'generation_study_reconciliation_chain'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_reconciliation_finality",
    "tbl_name": "generation_study_reconciliations",
    "sql": "CREATE TRIGGER generation_study_reconciliation_finality BEFORE INSERT ON generation_study_reconciliations\n WHEN EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND (NEW.incurred_microusd<r.incurred_microusd OR NEW.incurred_tokens<r.incurred_tokens))\n OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.provider_settled=1\n AND (NEW.provider_settled!=1 OR NEW.incurred_microusd!=r.incurred_microusd OR NEW.incurred_tokens!=r.incurred_tokens))\n OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.lifecycle_closed=1\n AND (NEW.lifecycle_closed!=1 OR NEW.lifecycle_incurred_microusd IS NOT r.lifecycle_incurred_microusd))\n BEGIN SELECT RAISE(ABORT,'generation_study_settled_amount_immutable'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_reconciliation_no_delete",
    "tbl_name": "generation_study_reconciliations",
    "sql": "CREATE TRIGGER generation_study_reconciliation_no_delete BEFORE DELETE ON generation_study_reconciliations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_reconciliation'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_reconciliation_no_update",
    "tbl_name": "generation_study_reconciliations",
    "sql": "CREATE TRIGGER generation_study_reconciliation_no_update BEFORE UPDATE ON generation_study_reconciliations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_reconciliation'); END"
  },
  {
    "type": "table",
    "name": "generation_study_reconciliations",
    "tbl_name": "generation_study_reconciliations",
    "sql": "CREATE TABLE generation_study_reconciliations (\n evidence_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES generation_study_charges(operation_id),\n sequence INTEGER NOT NULL CHECK(sequence>0), previous_id TEXT REFERENCES generation_study_reconciliations(evidence_id),\n original_charge_hash TEXT NOT NULL, policy_id TEXT NOT NULL, evidence_kind TEXT NOT NULL CHECK(evidence_kind='verified-incurred-charge'),\n authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,\n provider_settled INTEGER NOT NULL CHECK(provider_settled IN(0,1)),\n incurred_microusd INTEGER NOT NULL CHECK(incurred_microusd>=0), incurred_tokens INTEGER NOT NULL CHECK(incurred_tokens>=0),\n remaining_uncertainty_microusd INTEGER CHECK(remaining_uncertainty_microusd IS NULL OR remaining_uncertainty_microusd>=0),\n lifecycle_microusd INTEGER NOT NULL CHECK(lifecycle_microusd>=0), lifecycle_scope TEXT NOT NULL,\n liability_owner TEXT NOT NULL, lifecycle_through TEXT NOT NULL, lifecycle_evidence_ref TEXT NOT NULL,\n lifecycle_closed INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_closed IN(0,1)), lifecycle_incurred_microusd INTEGER,\n UNIQUE(operation_id,sequence)\n)"
  },
  {
    "type": "table",
    "name": "generation_study_stages",
    "tbl_name": "generation_study_stages",
    "sql": "CREATE TABLE generation_study_stages (\n operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id),\n stage TEXT NOT NULL CHECK(stage IN('advisory','moderation','image','storage')),\n status TEXT NOT NULL CHECK(status IN('intent','received','complete')),\n request_hash TEXT NOT NULL, receipt_hash TEXT, PRIMARY KEY(operation_id,stage)\n)"
  },
  {
    "type": "trigger",
    "name": "generation_study_supplied_grant_revocation",
    "tbl_name": "generation_study_grants",
    "sql": "CREATE TRIGGER generation_study_supplied_grant_revocation BEFORE UPDATE ON generation_study_grants\n WHEN OLD.status='revoked' AND NEW.status!='revoked' AND EXISTS(SELECT 1 FROM generation_study_supplied_reviews WHERE grant_id=OLD.grant_id)\n BEGIN SELECT RAISE(ABORT,'generation_study_supplied_revocation_terminal'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_supplied_observation_no_delete",
    "tbl_name": "generation_study_supplied_observations",
    "sql": "CREATE TRIGGER generation_study_supplied_observation_no_delete BEFORE DELETE ON generation_study_supplied_observations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_observation'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_supplied_observation_no_update",
    "tbl_name": "generation_study_supplied_observations",
    "sql": "CREATE TRIGGER generation_study_supplied_observation_no_update BEFORE UPDATE ON generation_study_supplied_observations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_observation'); END"
  },
  {
    "type": "table",
    "name": "generation_study_supplied_observations",
    "tbl_name": "generation_study_supplied_observations",
    "sql": "CREATE TABLE generation_study_supplied_observations (\n operation_id TEXT PRIMARY KEY REFERENCES generation_study_operations(operation_id),\n review_id TEXT NOT NULL REFERENCES generation_study_supplied_reviews(review_id),\n owner_id TEXT NOT NULL REFERENCES users(user_id), principal_hash TEXT NOT NULL,\n artifact_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, protocol TEXT NOT NULL,\n safety TEXT NOT NULL CHECK(safety IN('clear','unsafe')),\n fidelity TEXT NOT NULL CHECK(fidelity IN('pass','expected-failure')), finding TEXT NOT NULL,\n evidence_ref TEXT NOT NULL, resume INTEGER NOT NULL CHECK(resume IN(0,1)), recorded_at TEXT NOT NULL\n)"
  },
  {
    "type": "trigger",
    "name": "generation_study_supplied_review_identity",
    "tbl_name": "generation_study_supplied_reviews",
    "sql": "CREATE TRIGGER generation_study_supplied_review_identity BEFORE UPDATE ON generation_study_supplied_reviews\n WHEN NEW.review_id!=OLD.review_id OR NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.principal_hash!=OLD.principal_hash OR NEW.binding_json!=OLD.binding_json OR NEW.expires_at!=OLD.expires_at OR (OLD.status='revoked' AND NEW.status!='revoked') OR (OLD.hard_stop IS NOT NULL AND NEW.hard_stop IS NOT OLD.hard_stop)\n BEGIN SELECT RAISE(ABORT,'generation_study_immutable_review'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_supplied_review_no_delete",
    "tbl_name": "generation_study_supplied_reviews",
    "sql": "CREATE TRIGGER generation_study_supplied_review_no_delete BEFORE DELETE ON generation_study_supplied_reviews BEGIN SELECT RAISE(ABORT,'generation_study_immutable_review'); END"
  },
  {
    "type": "table",
    "name": "generation_study_supplied_reviews",
    "tbl_name": "generation_study_supplied_reviews",
    "sql": "CREATE TABLE generation_study_supplied_reviews (\n review_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL UNIQUE REFERENCES generation_study_grants(grant_id),\n owner_id TEXT NOT NULL REFERENCES users(user_id), principal_hash TEXT NOT NULL,\n binding_json TEXT NOT NULL, expires_at TEXT NOT NULL,\n status TEXT NOT NULL CHECK(status IN('authorized','revoked')),\n hard_stop TEXT\n)"
  },
  {
    "type": "trigger",
    "name": "generation_study_supplied_stage_identity",
    "tbl_name": "generation_study_stages",
    "sql": "CREATE TRIGGER generation_study_supplied_stage_identity BEFORE UPDATE ON generation_study_stages\n WHEN NEW.operation_id!=OLD.operation_id OR NEW.stage!=OLD.stage OR NEW.request_hash!=OLD.request_hash OR (OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash) OR (OLD.status='received' AND NEW.status='intent') OR (OLD.status='complete' AND NEW.status!='complete')\n BEGIN SELECT RAISE(ABORT,'generation_study_immutable_intent'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_supplied_stage_no_delete",
    "tbl_name": "generation_study_stages",
    "sql": "CREATE TRIGGER generation_study_supplied_stage_no_delete BEFORE DELETE ON generation_study_stages BEGIN SELECT RAISE(ABORT,'generation_study_immutable_intent'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_token_no_delete",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_study_token_no_delete BEFORE DELETE ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE token_reservation_id=OLD.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END"
  },
  {
    "type": "trigger",
    "name": "generation_study_token_settlement",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_study_token_settlement BEFORE UPDATE ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.token_reservation_id=OLD.reservation_id)\n AND (NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR\n (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)\n WHERE o.token_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_tokens=NEW.used_tokens) OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.incurred_tokens=NEW.used_tokens AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id))))))\n BEGIN SELECT RAISE(ABORT,'generation_study_original_usage_required'); END"
  }
];
