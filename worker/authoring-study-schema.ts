// Generated from the optional SQL by scripts/check-authoring-study-schema.mjs. Never installs a schema.
export const AUTHORING_STUDY_SCHEMA = [
  {
    "type": "trigger",
    "name": "authoring_study_commit_no_delete",
    "tbl_name": "authoring_study_commits",
    "sql": "CREATE TRIGGER authoring_study_commit_no_delete BEFORE DELETE ON authoring_study_commits BEGIN SELECT RAISE(ABORT,'authoring_study_receipt_immutable'); END"
  },
  {
    "type": "trigger",
    "name": "authoring_study_commit_no_update",
    "tbl_name": "authoring_study_commits",
    "sql": "CREATE TRIGGER authoring_study_commit_no_update BEFORE UPDATE ON authoring_study_commits BEGIN SELECT RAISE(ABORT,'authoring_study_receipt_immutable'); END"
  },
  {
    "type": "table",
    "name": "authoring_study_commits",
    "tbl_name": "authoring_study_commits",
    "sql": "CREATE TABLE authoring_study_commits (\n preview_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE REFERENCES authoring_study_configurations(proposal_id),\n owner_id TEXT NOT NULL REFERENCES users(user_id), intent_id TEXT NOT NULL UNIQUE,\n operation TEXT NOT NULL CHECK(operation='generation-supplied-study-approval'), version INTEGER NOT NULL CHECK(version=1),\n display_hash TEXT NOT NULL, configuration_hash TEXT NOT NULL, principal_hash TEXT NOT NULL,\n plan_id TEXT NOT NULL, grant_id TEXT NOT NULL UNIQUE REFERENCES generation_study_grants(grant_id),\n review_id TEXT NOT NULL UNIQUE REFERENCES generation_study_supplied_reviews(review_id),\n baseline_operation TEXT NOT NULL UNIQUE, treatment_operation TEXT NOT NULL UNIQUE,\n evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),\n expires_at TEXT NOT NULL, verified INTEGER NOT NULL CHECK(verified=1), created_at TEXT NOT NULL\n)"
  },
  {
    "type": "trigger",
    "name": "authoring_study_configuration_identity",
    "tbl_name": "authoring_study_configurations",
    "sql": "CREATE TRIGGER authoring_study_configuration_identity BEFORE UPDATE ON authoring_study_configurations\n WHEN NEW.proposal_id IS NOT OLD.proposal_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.configuration_hash IS NOT OLD.configuration_hash OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status='revoked'\n BEGIN SELECT RAISE(ABORT,'authoring_study_configuration_immutable'); END"
  },
  {
    "type": "trigger",
    "name": "authoring_study_configuration_no_delete",
    "tbl_name": "authoring_study_configurations",
    "sql": "CREATE TRIGGER authoring_study_configuration_no_delete BEFORE DELETE ON authoring_study_configurations BEGIN SELECT RAISE(ABORT,'authoring_study_configuration_immutable'); END"
  },
  {
    "type": "table",
    "name": "authoring_study_configurations",
    "tbl_name": "authoring_study_configurations",
    "sql": "CREATE TABLE authoring_study_configurations (\n proposal_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id),\n configuration_hash TEXT NOT NULL, expires_at TEXT NOT NULL,\n status TEXT NOT NULL CHECK(status IN('active','revoked'))\n)"
  },
  {
    "type": "table",
    "name": "authoring_study_evidence",
    "tbl_name": "authoring_study_evidence",
    "sql": "CREATE TABLE authoring_study_evidence (\n evidence_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES authoring_study_configurations(proposal_id),\n owner_id TEXT NOT NULL REFERENCES users(user_id), kind TEXT NOT NULL CHECK(kind IN('account','rate','liability','settlement','lifecycle','deletion','bound')),\n content_ref TEXT NOT NULL UNIQUE, content_hash TEXT NOT NULL,\n authority_id TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('verified','revoked'))\n)"
  },
  {
    "type": "trigger",
    "name": "authoring_study_evidence_identity",
    "tbl_name": "authoring_study_evidence",
    "sql": "CREATE TRIGGER authoring_study_evidence_identity BEFORE UPDATE ON authoring_study_evidence\n WHEN NEW.evidence_id IS NOT OLD.evidence_id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind OR NEW.content_ref IS NOT OLD.content_ref OR NEW.content_hash IS NOT OLD.content_hash OR NEW.authority_id IS NOT OLD.authority_id OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status='revoked'\n BEGIN SELECT RAISE(ABORT,'authoring_study_evidence_immutable'); END"
  },
  {
    "type": "trigger",
    "name": "authoring_study_evidence_no_delete",
    "tbl_name": "authoring_study_evidence",
    "sql": "CREATE TRIGGER authoring_study_evidence_no_delete BEFORE DELETE ON authoring_study_evidence BEGIN SELECT RAISE(ABORT,'authoring_study_evidence_immutable'); END"
  }
] as const;
