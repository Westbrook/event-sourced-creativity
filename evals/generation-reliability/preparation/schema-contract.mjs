// Generated from the optional SQL; no runtime installation.
export const schemaRows=[
  {
    "type": "trigger",
    "name": "generation_preparation_admission",
    "tbl_name": "generation_preparation_operations",
    "sql": "CREATE TRIGGER generation_preparation_admission BEFORE INSERT ON generation_preparation_operations\n WHEN NEW.status!='reserved' OR EXISTS(SELECT 1 FROM generation_preparation_operations WHERE owner_id=NEW.owner_id AND status!='completed')\n OR EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE owner_id=NEW.owner_id)\n BEGIN SELECT RAISE(ABORT,'preparation_outstanding_exposure'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_charge_no_delete",
    "tbl_name": "generation_preparation_charges",
    "sql": "CREATE TRIGGER generation_preparation_charge_no_delete BEFORE DELETE ON generation_preparation_charges BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_charge'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_charge_no_update",
    "tbl_name": "generation_preparation_charges",
    "sql": "CREATE TRIGGER generation_preparation_charge_no_update BEFORE UPDATE ON generation_preparation_charges BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_charge'); END"
  },
  {
    "type": "table",
    "name": "generation_preparation_charges",
    "tbl_name": "generation_preparation_charges",
    "sql": "CREATE TABLE generation_preparation_charges (\n operation_id TEXT PRIMARY KEY REFERENCES generation_preparation_operations(operation_id), provider_request_id TEXT NOT NULL,\n receipt_hash TEXT NOT NULL, measured_microusd INTEGER NOT NULL CHECK(measured_microusd>=0), measured_tokens INTEGER NOT NULL CHECK(measured_tokens>=0),\n authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,\n scope_hash TEXT NOT NULL, residual_exposure_microusd INTEGER CHECK(residual_exposure_microusd IS NULL OR residual_exposure_microusd>=0)\n)"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_completed_guard",
    "tbl_name": "generation_preparation_operations",
    "sql": "CREATE TRIGGER generation_preparation_completed_guard BEFORE UPDATE ON generation_preparation_operations\n WHEN NEW.status='completed' AND (NOT EXISTS(\n SELECT 1 FROM generation_preparation_charges c\n JOIN generation_preparation_reconciliations r USING(operation_id)\n JOIN budget_reservations t ON t.reservation_id=NEW.token_reservation_id\n JOIN cost_budget_reservations d ON d.reservation_id=NEW.cost_reservation_id\n WHERE c.operation_id=NEW.operation_id AND c.provider_request_id=NEW.provider_request_id AND c.receipt_hash=NEW.receipt_hash AND c.scope_hash=NEW.scope_hash\n AND r.policy_id=NEW.financial_policy_id AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=NEW.operation_id)\n AND r.provider_settled=1 AND r.remaining_uncertainty_microusd=0\n AND t.status IN('settled','released') AND d.status IN('settled','released')\n AND t.used_tokens=r.incurred_tokens AND d.used_microusd=r.incurred_microusd\n AND NEW.measured_tokens=t.used_tokens AND NEW.measured_microusd=d.used_microusd\n AND t.used_tokens<=t.reserved_tokens AND d.used_microusd<=d.reserved_microusd)\n OR EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE operation_id=NEW.operation_id))\n BEGIN SELECT RAISE(ABORT,'preparation_completion_unqualified'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_cost_hold",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_cost_hold BEFORE UPDATE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.cost_reservation_id=OLD.reservation_id)\n AND (NEW.reservation_id IS NOT OLD.reservation_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.stream_id IS NOT OLD.stream_id OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.operation IS NOT OLD.operation OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR\n (NEW.status NOT IN('active','authorizing','executing') AND NOT EXISTS(SELECT 1 FROM generation_preparation_operations o JOIN generation_preparation_charges c USING(operation_id)\n WHERE o.cost_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_microusd=NEW.used_microusd) OR EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.remaining_uncertainty_microusd=0 AND r.incurred_microusd=NEW.used_microusd AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=o.operation_id))))))\n BEGIN SELECT RAISE(ABORT,'generation_preparation_original_charge_required'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_cost_no_delete",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_cost_no_delete BEFORE DELETE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE cost_reservation_id=OLD.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_purchase'); END"
  },
  {
    "type": "table",
    "name": "generation_preparation_evidence",
    "tbl_name": "generation_preparation_evidence",
    "sql": "CREATE TABLE generation_preparation_evidence (\n operation_id TEXT NOT NULL REFERENCES generation_preparation_operations(operation_id),slot TEXT NOT NULL CHECK(slot IN('source','request','response')),\n content_ref TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(operation_id,slot)\n)"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_evidence_no_delete",
    "tbl_name": "generation_preparation_evidence",
    "sql": "CREATE TRIGGER generation_preparation_evidence_no_delete BEFORE DELETE ON generation_preparation_evidence BEGIN SELECT RAISE(ABORT,'preparation_immutable_evidence'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_evidence_no_update",
    "tbl_name": "generation_preparation_evidence",
    "sql": "CREATE TRIGGER generation_preparation_evidence_no_update BEFORE UPDATE ON generation_preparation_evidence BEGIN SELECT RAISE(ABORT,'preparation_immutable_evidence'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_external_cost",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_external_cost BEFORE INSERT ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.cost_reservation_id!=NEW.reservation_id AND COALESCE(o.lifecycle_reservation_id,'')!=NEW.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_preparation_outstanding_exposure'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_external_tokens",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_external_tokens BEFORE INSERT ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.token_reservation_id!=NEW.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_preparation_outstanding_exposure'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_grant_identity",
    "tbl_name": "generation_preparation_grants",
    "sql": "CREATE TRIGGER generation_preparation_grant_identity BEFORE UPDATE ON generation_preparation_grants\n WHEN NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.plan_id!=OLD.plan_id OR NEW.source_ref!=OLD.source_ref OR NEW.source_hash!=OLD.source_hash OR NEW.source_provenance_json!=OLD.source_provenance_json OR NEW.config_json!=OLD.config_json OR NEW.runtime_hash!=OLD.runtime_hash OR NEW.policy_json!=OLD.policy_json OR NEW.token_allowance!=OLD.token_allowance OR NEW.authority_version!=OLD.authority_version OR NEW.expires_at!=OLD.expires_at\n BEGIN SELECT RAISE(ABORT,'preparation_immutable_grant'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_grant_no_delete",
    "tbl_name": "generation_preparation_grants",
    "sql": "CREATE TRIGGER generation_preparation_grant_no_delete BEFORE DELETE ON generation_preparation_grants BEGIN SELECT RAISE(ABORT,'preparation_immutable_grant'); END"
  },
  {
    "type": "table",
    "name": "generation_preparation_grants",
    "tbl_name": "generation_preparation_grants",
    "sql": "CREATE TABLE generation_preparation_grants (\n grant_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), plan_id TEXT NOT NULL,\n source_ref TEXT NOT NULL, source_hash TEXT NOT NULL, source_provenance_json TEXT NOT NULL,\n config_json TEXT NOT NULL, runtime_hash TEXT NOT NULL, policy_json TEXT NOT NULL,\n token_allowance INTEGER NOT NULL CHECK(token_allowance>0), authority_version TEXT NOT NULL,\n expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')), stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN(0,1))\n)"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_lifecycle_cost_hold",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_lifecycle_cost_hold BEFORE INSERT ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE owner_id=NEW.owner_id)\n BEGIN SELECT RAISE(ABORT,'generation_preparation_lifecycle_exposure'); END"
  },
  {
    "type": "view",
    "name": "generation_preparation_lifecycle_holds",
    "tbl_name": "generation_preparation_lifecycle_holds",
    "sql": "CREATE VIEW generation_preparation_lifecycle_holds AS\n SELECT o.owner_id,o.operation_id FROM generation_preparation_operations o\n JOIN generation_preparation_reconciliations r ON r.operation_id=o.operation_id\n AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=o.operation_id)\n WHERE o.financial_policy_id IS NOT NULL AND\n (r.policy_id!=o.financial_policy_id OR NOT EXISTS(SELECT 1 FROM generation_preparation_grants g WHERE g.grant_id=o.grant_id AND g.owner_id=o.owner_id AND json_extract(g.policy_json,'$.id')=r.policy_id AND json_extract(g.policy_json,'$.lifecycle.scope')=r.lifecycle_scope AND json_extract(g.policy_json,'$.lifecycle.liabilityOwner')=r.liability_owner AND json_extract(g.policy_json,'$.lifecycle.through')=r.lifecycle_through AND json_extract(g.policy_json,'$.lifecycle.maximumMicrousd')>=r.lifecycle_microusd) OR r.provider_settled!=1 OR r.remaining_uncertainty_microusd IS NOT 0 OR\n (r.lifecycle_closed=1 AND (r.lifecycle_microusd!=0 OR r.lifecycle_incurred_microusd IS NULL OR r.lifecycle_incurred_microusd>COALESCE((SELECT reserved_microusd FROM cost_budget_reservations WHERE reservation_id=o.lifecycle_reservation_id),0))) OR\n (r.lifecycle_closed=0 AND (r.lifecycle_through<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(\n SELECT 1 FROM cost_budget_reservations c WHERE c.reservation_id=o.lifecycle_reservation_id AND c.owner_id=o.owner_id AND c.status='active' AND c.reserved_microusd>=r.lifecycle_microusd))))"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_lifecycle_no_delete",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_lifecycle_no_delete BEFORE DELETE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE lifecycle_reservation_id=OLD.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_provision'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_lifecycle_settlement",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_lifecycle_settlement BEFORE UPDATE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE lifecycle_reservation_id=OLD.reservation_id)\n AND (NEW.reservation_id!=OLD.reservation_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.stream_id!=OLD.stream_id OR NEW.correlation_id!=OLD.correlation_id OR NEW.operation!=OLD.operation OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR\n (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_preparation_operations o JOIN generation_preparation_reconciliations r USING(operation_id)\n WHERE o.lifecycle_reservation_id=OLD.reservation_id AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=o.operation_id)\n AND r.lifecycle_closed=1 AND r.lifecycle_microusd=0 AND r.remaining_uncertainty_microusd=0 AND r.provider_settled=1 AND r.lifecycle_incurred_microusd=NEW.used_microusd)))\n BEGIN SELECT RAISE(ABORT,'generation_preparation_verified_lifecycle_closure_required'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_lifecycle_token_hold",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_lifecycle_token_hold BEFORE INSERT ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_lifecycle_holds WHERE owner_id=NEW.owner_id)\n BEGIN SELECT RAISE(ABORT,'generation_preparation_lifecycle_exposure'); END"
  },
  {
    "type": "index",
    "name": "generation_preparation_one_payer",
    "tbl_name": "generation_preparation_operations",
    "sql": "CREATE UNIQUE INDEX generation_preparation_one_payer ON generation_preparation_operations(owner_id) WHERE status IN('reserved','intent','received')"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_operation_identity",
    "tbl_name": "generation_preparation_operations",
    "sql": "CREATE TRIGGER generation_preparation_operation_identity BEFORE UPDATE ON generation_preparation_operations\n WHEN NEW.operation_id!=OLD.operation_id OR NEW.owner_id!=OLD.owner_id OR NEW.grant_id!=OLD.grant_id OR NEW.plan_id!=OLD.plan_id OR NEW.request_hash!=OLD.request_hash OR NEW.scope_hash!=OLD.scope_hash OR NEW.token_reservation_id!=OLD.token_reservation_id OR NEW.cost_reservation_id!=OLD.cost_reservation_id OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at\n OR NEW.financial_policy_id IS NOT OLD.financial_policy_id OR NEW.lifecycle_reservation_id IS NOT OLD.lifecycle_reservation_id\n OR OLD.status!='reserved' AND NEW.status='reserved' OR OLD.status IN('received','hold','completed') AND NEW.status='intent'\n OR OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS NOT OLD.provider_request_id\n OR OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash\n OR OLD.response_id IS NOT NULL AND NEW.response_id IS NOT OLD.response_id\n OR OLD.outcome IS NOT NULL AND NEW.outcome IS NOT OLD.outcome\n OR OLD.direction_hash IS NOT NULL AND NEW.direction_hash IS NOT OLD.direction_hash\n OR OLD.usage_json IS NOT NULL AND NEW.usage_json IS NOT OLD.usage_json\n OR NEW.custody_failed<OLD.custody_failed\n OR NEW.private_bytes<OLD.private_bytes OR NEW.private_writes<OLD.private_writes OR NEW.original_reads<OLD.original_reads OR NEW.cleanup_attempts<OLD.cleanup_attempts\n BEGIN SELECT RAISE(ABORT,'preparation_immutable_purchase'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_operation_no_delete",
    "tbl_name": "generation_preparation_operations",
    "sql": "CREATE TRIGGER generation_preparation_operation_no_delete BEFORE DELETE ON generation_preparation_operations BEGIN SELECT RAISE(ABORT,'preparation_original_only'); END"
  },
  {
    "type": "table",
    "name": "generation_preparation_operations",
    "tbl_name": "generation_preparation_operations",
    "sql": "CREATE TABLE generation_preparation_operations (\n operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), grant_id TEXT NOT NULL REFERENCES generation_preparation_grants(grant_id),\n plan_id TEXT NOT NULL, request_hash TEXT NOT NULL, scope_hash TEXT NOT NULL,\n token_reservation_id TEXT NOT NULL UNIQUE, cost_reservation_id TEXT NOT NULL UNIQUE,\n financial_policy_id TEXT NOT NULL, lifecycle_reservation_id TEXT UNIQUE, measured_microusd INTEGER, measured_tokens INTEGER,\n status TEXT NOT NULL CHECK(status IN('reserved','intent','received','hold','completed')),\n provider_request_id TEXT, receipt_hash TEXT, response_id TEXT, returned_model TEXT, usage_json TEXT, http_status INTEGER,\n outcome TEXT, direction_hash TEXT, custody_failed INTEGER NOT NULL DEFAULT 0 CHECK(custody_failed IN(0,1)), reason TEXT, private_bytes INTEGER NOT NULL DEFAULT 0, private_writes INTEGER NOT NULL DEFAULT 0,\n original_reads INTEGER NOT NULL DEFAULT 0, cleanup_attempts INTEGER NOT NULL DEFAULT 0,\n created_at TEXT NOT NULL, expires_at TEXT NOT NULL\n)"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_reconciliation_chain",
    "tbl_name": "generation_preparation_reconciliations",
    "sql": "CREATE TRIGGER generation_preparation_reconciliation_chain BEFORE INSERT ON generation_preparation_reconciliations\n WHEN NEW.sequence!=COALESCE((SELECT MAX(sequence)+1 FROM generation_preparation_reconciliations WHERE operation_id=NEW.operation_id),1)\n OR NEW.previous_id IS NOT (SELECT evidence_id FROM generation_preparation_reconciliations WHERE operation_id=NEW.operation_id ORDER BY sequence DESC LIMIT 1)\n BEGIN SELECT RAISE(ABORT,'generation_preparation_reconciliation_chain'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_reconciliation_finality",
    "tbl_name": "generation_preparation_reconciliations",
    "sql": "CREATE TRIGGER generation_preparation_reconciliation_finality BEFORE INSERT ON generation_preparation_reconciliations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=NEW.operation_id AND (NEW.incurred_microusd<r.incurred_microusd OR NEW.incurred_tokens<r.incurred_tokens))\n OR EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.provider_settled=1\n AND (NEW.provider_settled!=1 OR NEW.incurred_microusd!=r.incurred_microusd OR NEW.incurred_tokens!=r.incurred_tokens))\n OR EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.lifecycle_closed=1\n AND (NEW.lifecycle_closed!=1 OR NEW.lifecycle_incurred_microusd IS NOT r.lifecycle_incurred_microusd))\n BEGIN SELECT RAISE(ABORT,'generation_preparation_settled_amount_immutable'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_reconciliation_no_delete",
    "tbl_name": "generation_preparation_reconciliations",
    "sql": "CREATE TRIGGER generation_preparation_reconciliation_no_delete BEFORE DELETE ON generation_preparation_reconciliations BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_reconciliation'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_reconciliation_no_update",
    "tbl_name": "generation_preparation_reconciliations",
    "sql": "CREATE TRIGGER generation_preparation_reconciliation_no_update BEFORE UPDATE ON generation_preparation_reconciliations BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_reconciliation'); END"
  },
  {
    "type": "table",
    "name": "generation_preparation_reconciliations",
    "tbl_name": "generation_preparation_reconciliations",
    "sql": "CREATE TABLE generation_preparation_reconciliations (\n evidence_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES generation_preparation_charges(operation_id),\n sequence INTEGER NOT NULL CHECK(sequence>0), previous_id TEXT REFERENCES generation_preparation_reconciliations(evidence_id),\n original_charge_hash TEXT NOT NULL, policy_id TEXT NOT NULL, evidence_kind TEXT NOT NULL CHECK(evidence_kind='verified-incurred-charge'),\n authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,\n provider_settled INTEGER NOT NULL CHECK(provider_settled IN(0,1)),\n incurred_microusd INTEGER NOT NULL CHECK(incurred_microusd>=0), incurred_tokens INTEGER NOT NULL CHECK(incurred_tokens>=0),\n remaining_uncertainty_microusd INTEGER CHECK(remaining_uncertainty_microusd IS NULL OR remaining_uncertainty_microusd>=0),\n lifecycle_microusd INTEGER NOT NULL CHECK(lifecycle_microusd>=0), lifecycle_scope TEXT NOT NULL,\n liability_owner TEXT NOT NULL, lifecycle_through TEXT NOT NULL, lifecycle_evidence_ref TEXT NOT NULL,\n lifecycle_closed INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_closed IN(0,1)), lifecycle_incurred_microusd INTEGER,\n UNIQUE(operation_id,sequence)\n)"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_token_hold",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_token_hold BEFORE UPDATE ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.token_reservation_id=OLD.reservation_id)\n AND (NEW.reservation_id IS NOT OLD.reservation_id OR NEW.stream_id IS NOT OLD.stream_id OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.operation IS NOT OLD.operation OR NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR\n (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_preparation_operations o JOIN generation_preparation_charges c USING(operation_id)\n WHERE o.token_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_tokens=NEW.used_tokens) OR EXISTS(SELECT 1 FROM generation_preparation_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.remaining_uncertainty_microusd=0 AND r.incurred_tokens=NEW.used_tokens AND r.sequence=(SELECT MAX(sequence) FROM generation_preparation_reconciliations WHERE operation_id=o.operation_id))))))\n BEGIN SELECT RAISE(ABORT,'generation_preparation_original_usage_required'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_token_no_delete",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_token_no_delete BEFORE DELETE ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE token_reservation_id=OLD.reservation_id)\n BEGIN SELECT RAISE(ABORT,'generation_preparation_immutable_purchase'); END"
  }
];
