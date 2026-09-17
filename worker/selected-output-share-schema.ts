/** Importing this schema installs nothing and grants no public access. Terminal
 * hashes are operational replay tombstones, not a claim of anonymous erasure. */
export const SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS = Object.freeze([
  "owner_id", "owner_email", "intent_key", "project_id", "job_id", "completion_event_id", "selection_json", "review_title",
  "source_expires_at", "provenance_expires_at", "expires_at", "candidate_sha256", "issuer_authority_sha256", "created_at",
] as const);
const identityColumns = ["share_id", "purpose", "replay_key"];
const privateChanged = SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS.map(column => `NEW.${column} IS NOT OLD.${column}`).join(" OR ");
const privatePresent = SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS.map(column => `${column} IS NOT NULL`).join(" AND ");
const privateAbsent = SELECTED_OUTPUT_SHARE_PRIVATE_COLUMNS.map(column => `${column} IS NULL`).join(" AND ");

export const SELECTED_OUTPUT_SHARE_SCHEMA = Object.freeze([
  `CREATE TABLE selected_output_shares(
    share_id TEXT PRIMARY KEY NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose='selected-output-read-v1'),
    replay_key TEXT UNIQUE NOT NULL CHECK(length(replay_key)=64 AND replay_key NOT GLOB '*[^0-9a-f]*'),
    owner_id TEXT,owner_email TEXT,intent_key TEXT,
    project_id TEXT,job_id TEXT,completion_event_id TEXT,
    selection_json TEXT,review_title TEXT,
    source_expires_at TEXT,provenance_expires_at TEXT,expires_at TEXT,
    candidate_sha256 TEXT,issuer_authority_sha256 TEXT,created_at TEXT,
    token_hash TEXT UNIQUE,issued_at TEXT,revoked_at TEXT,minimized_at TEXT,
    UNIQUE(owner_id,intent_key),
    CHECK((token_hash IS NULL AND issued_at IS NULL) OR (token_hash IS NOT NULL AND issued_at IS NOT NULL
      AND length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*' AND length(issued_at)=24)),
    CHECK(revoked_at IS NULL OR length(revoked_at)=24),
    CHECK((minimized_at IS NULL AND ${privatePresent}
      AND json_valid(selection_json) AND length(CAST(selection_json AS BLOB)) BETWEEN 1 AND 1024
      AND length(CAST(review_title AS BLOB)) BETWEEN 1 AND 512
      AND length(candidate_sha256)=64 AND candidate_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(issuer_authority_sha256)=64 AND issuer_authority_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(created_at)=24 AND length(source_expires_at)=24 AND length(provenance_expires_at)=24 AND length(expires_at)=24
      AND created_at<expires_at AND expires_at<=source_expires_at AND expires_at<=provenance_expires_at
      AND (issued_at IS NULL OR (issued_at>=created_at AND issued_at<expires_at))
      AND (revoked_at IS NULL OR revoked_at>=created_at))
      OR (minimized_at IS NOT NULL AND length(minimized_at)=24 AND revoked_at IS NOT NULL AND revoked_at<=minimized_at
        AND (issued_at IS NULL OR issued_at<=minimized_at) AND ${privateAbsent}))) WITHOUT ROWID`,
  `CREATE INDEX selected_output_shares_owner ON selected_output_shares(owner_id,created_at)`,
  `CREATE TRIGGER selected_output_share_immutable BEFORE UPDATE ON selected_output_shares
    WHEN ${identityColumns.map(column => `NEW.${column} IS NOT OLD.${column}`).join(" OR ")}
      OR (OLD.minimized_at IS NOT NULL AND (NEW.minimized_at IS NOT OLD.minimized_at OR ${privateChanged}
        OR NEW.revoked_at IS NOT OLD.revoked_at OR NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash))
      OR (OLD.minimized_at IS NULL AND NEW.minimized_at IS NULL AND (${privateChanged}))
      OR (OLD.minimized_at IS NULL AND NEW.minimized_at IS NOT NULL AND
        (NEW.minimized_at<OLD.created_at OR NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash
          OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NEW.minimized_at)))
      OR OLD.issued_at IS NOT NULL AND (NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash)
      OR OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash)
      OR NEW.token_hash IS NOT NULL AND EXISTS(SELECT 1 FROM selected_output_shares other
        WHERE other.share_id!=OLD.share_id AND other.token_hash=NEW.token_hash)
    BEGIN SELECT RAISE(ABORT,'selected_output_share_immutable'); END`,
  `CREATE TRIGGER selected_output_share_no_delete BEFORE DELETE ON selected_output_shares
    BEGIN SELECT RAISE(ABORT,'selected_output_share_immutable'); END`,
  `CREATE TRIGGER selected_output_share_no_replace BEFORE INSERT ON selected_output_shares
    WHEN NEW.minimized_at IS NOT NULL OR EXISTS(SELECT 1 FROM selected_output_shares old WHERE old.share_id=NEW.share_id
      OR old.replay_key=NEW.replay_key OR (old.owner_id=NEW.owner_id AND old.intent_key=NEW.intent_key)
      OR (NEW.token_hash IS NOT NULL AND old.token_hash=NEW.token_hash))
    BEGIN SELECT RAISE(ABORT,'selected_output_share_exists'); END`,
]);
