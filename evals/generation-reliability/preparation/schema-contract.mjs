// Generated offline from the uninstalled preparation schema.
export const schemaRows=[
  {
    "type": "trigger",
    "name": "generation_preparation_cost_hold",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_cost_hold BEFORE UPDATE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE cost_reservation_id=OLD.reservation_id)\n AND (NEW.status NOT IN('active','authorizing','executing') OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period)\n BEGIN SELECT RAISE(ABORT,'preparation_reconciliation_uninstalled'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_cost_no_delete",
    "tbl_name": "cost_budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_cost_no_delete BEFORE DELETE ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE cost_reservation_id=OLD.reservation_id)\n BEGIN SELECT RAISE(ABORT,'preparation_original_only'); END"
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
    "sql": "CREATE TRIGGER generation_preparation_external_cost BEFORE INSERT ON cost_budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.owner_id=NEW.owner_id AND o.cost_reservation_id!=NEW.reservation_id)\n BEGIN SELECT RAISE(ABORT,'preparation_outstanding_exposure'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_external_tokens",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_external_tokens BEFORE INSERT ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations o WHERE o.owner_id=NEW.owner_id AND o.token_reservation_id!=NEW.reservation_id)\n BEGIN SELECT RAISE(ABORT,'preparation_outstanding_exposure'); END"
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
    "type": "index",
    "name": "generation_preparation_one_payer",
    "tbl_name": "generation_preparation_operations",
    "sql": "CREATE UNIQUE INDEX generation_preparation_one_payer ON generation_preparation_operations(owner_id)"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_operation_identity",
    "tbl_name": "generation_preparation_operations",
    "sql": "CREATE TRIGGER generation_preparation_operation_identity BEFORE UPDATE ON generation_preparation_operations\n WHEN NEW.operation_id!=OLD.operation_id OR NEW.owner_id!=OLD.owner_id OR NEW.grant_id!=OLD.grant_id OR NEW.plan_id!=OLD.plan_id OR NEW.request_hash!=OLD.request_hash OR NEW.scope_hash!=OLD.scope_hash OR NEW.token_reservation_id!=OLD.token_reservation_id OR NEW.cost_reservation_id!=OLD.cost_reservation_id OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at\n OR OLD.status!='reserved' AND NEW.status='reserved' OR OLD.status IN('received','hold') AND NEW.status='intent'\n OR OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS NOT OLD.provider_request_id\n OR OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash\n OR OLD.response_id IS NOT NULL AND NEW.response_id IS NOT OLD.response_id\n OR OLD.usage_json IS NOT NULL AND NEW.usage_json IS NOT OLD.usage_json\n OR NEW.private_bytes<OLD.private_bytes OR NEW.private_writes<OLD.private_writes OR NEW.original_reads<OLD.original_reads OR NEW.cleanup_attempts<OLD.cleanup_attempts\n BEGIN SELECT RAISE(ABORT,'preparation_immutable_purchase'); END"
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
    "sql": "CREATE TABLE generation_preparation_operations (\n operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), grant_id TEXT NOT NULL REFERENCES generation_preparation_grants(grant_id),\n plan_id TEXT NOT NULL, request_hash TEXT NOT NULL, scope_hash TEXT NOT NULL,\n token_reservation_id TEXT NOT NULL UNIQUE, cost_reservation_id TEXT NOT NULL UNIQUE,\n status TEXT NOT NULL CHECK(status IN('reserved','intent','received','hold')),\n provider_request_id TEXT, receipt_hash TEXT, response_id TEXT, returned_model TEXT, usage_json TEXT, http_status INTEGER,\n outcome TEXT, reason TEXT, private_bytes INTEGER NOT NULL DEFAULT 0, private_writes INTEGER NOT NULL DEFAULT 0,\n original_reads INTEGER NOT NULL DEFAULT 0, cleanup_attempts INTEGER NOT NULL DEFAULT 0,\n created_at TEXT NOT NULL, expires_at TEXT NOT NULL\n)"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_token_hold",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_token_hold BEFORE UPDATE ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE token_reservation_id=OLD.reservation_id)\n AND (NEW.status NOT IN('active','authorizing') OR NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period)\n BEGIN SELECT RAISE(ABORT,'preparation_reconciliation_uninstalled'); END"
  },
  {
    "type": "trigger",
    "name": "generation_preparation_token_no_delete",
    "tbl_name": "budget_reservations",
    "sql": "CREATE TRIGGER generation_preparation_token_no_delete BEFORE DELETE ON budget_reservations\n WHEN EXISTS(SELECT 1 FROM generation_preparation_operations WHERE token_reservation_id=OLD.reservation_id)\n BEGIN SELECT RAISE(ABORT,'preparation_original_only'); END"
  }
];
