/** Detached candidate schema. Importing this installs nothing and grants no
 * public access. A single reviewed candidate can issue at most one read token. */
const immutableColumns = ["share_id", "purpose", "owner_id", "owner_email", "intent_key", "project_id", "job_id",
  "completion_event_id", "selection_json", "review_title", "source_expires_at", "provenance_expires_at", "expires_at",
  "candidate_sha256", "issuer_authority_sha256", "created_at"];

export const SELECTED_OUTPUT_SHARE_SCHEMA = Object.freeze([
  `CREATE TABLE selected_output_shares(
    share_id TEXT PRIMARY KEY NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose='selected-output-read-v1'),
    owner_id TEXT NOT NULL,owner_email TEXT NOT NULL,intent_key TEXT NOT NULL,
    project_id TEXT NOT NULL,job_id TEXT NOT NULL,completion_event_id TEXT NOT NULL,
    selection_json TEXT NOT NULL CHECK(json_valid(selection_json) AND length(CAST(selection_json AS BLOB)) BETWEEN 1 AND 1024),
    review_title TEXT NOT NULL CHECK(length(CAST(review_title AS BLOB)) BETWEEN 1 AND 512),
    source_expires_at TEXT NOT NULL,provenance_expires_at TEXT NOT NULL,expires_at TEXT NOT NULL,
    candidate_sha256 TEXT NOT NULL CHECK(length(candidate_sha256)=64 AND candidate_sha256 NOT GLOB '*[^0-9a-f]*'),
    issuer_authority_sha256 TEXT NOT NULL CHECK(length(issuer_authority_sha256)=64 AND issuer_authority_sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at TEXT NOT NULL,token_hash TEXT UNIQUE,issued_at TEXT,revoked_at TEXT,
    UNIQUE(owner_id,intent_key),
    CHECK(length(created_at)=24 AND length(source_expires_at)=24 AND length(provenance_expires_at)=24 AND length(expires_at)=24),
    CHECK(created_at<expires_at AND expires_at<=source_expires_at AND expires_at<=provenance_expires_at),
    CHECK((token_hash IS NULL AND issued_at IS NULL) OR (token_hash IS NOT NULL AND issued_at IS NOT NULL
      AND length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*' AND length(issued_at)=24 AND issued_at>=created_at AND issued_at<expires_at)),
    CHECK(revoked_at IS NULL OR (length(revoked_at)=24 AND revoked_at>=created_at))) WITHOUT ROWID`,
  `CREATE INDEX selected_output_shares_owner ON selected_output_shares(owner_id,created_at)`,
  `CREATE TRIGGER selected_output_share_immutable BEFORE UPDATE ON selected_output_shares
    WHEN ${immutableColumns.map(column => `NEW.${column} IS NOT OLD.${column}`).join(" OR ")}
      OR OLD.issued_at IS NOT NULL AND (NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash)
      OR OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash)
      OR NEW.token_hash IS NOT NULL AND EXISTS(SELECT 1 FROM selected_output_shares other
        WHERE other.share_id!=OLD.share_id AND other.token_hash=NEW.token_hash)
    BEGIN SELECT RAISE(ABORT,'selected_output_share_immutable'); END`,
  `CREATE TRIGGER selected_output_share_no_delete BEFORE DELETE ON selected_output_shares
    BEGIN SELECT RAISE(ABORT,'selected_output_share_immutable'); END`,
  `CREATE TRIGGER selected_output_share_no_replace BEFORE INSERT ON selected_output_shares
    WHEN EXISTS(SELECT 1 FROM selected_output_shares old WHERE old.share_id=NEW.share_id
      OR (old.owner_id=NEW.owner_id AND old.intent_key=NEW.intent_key)
      OR (NEW.token_hash IS NOT NULL AND old.token_hash=NEW.token_hash))
    BEGIN SELECT RAISE(ABORT,'selected_output_share_exists'); END`,
]);
