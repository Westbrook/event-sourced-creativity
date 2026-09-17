CREATE TABLE selected_output_shares(
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
    CHECK((minimized_at IS NULL AND owner_id IS NOT NULL AND owner_email IS NOT NULL AND intent_key IS NOT NULL AND project_id IS NOT NULL AND job_id IS NOT NULL AND completion_event_id IS NOT NULL AND selection_json IS NOT NULL AND review_title IS NOT NULL AND source_expires_at IS NOT NULL AND provenance_expires_at IS NOT NULL AND expires_at IS NOT NULL AND candidate_sha256 IS NOT NULL AND issuer_authority_sha256 IS NOT NULL AND created_at IS NOT NULL
      AND json_valid(selection_json) AND length(CAST(selection_json AS BLOB)) BETWEEN 1 AND 1024
      AND length(CAST(review_title AS BLOB)) BETWEEN 1 AND 512
      AND length(candidate_sha256)=64 AND candidate_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(issuer_authority_sha256)=64 AND issuer_authority_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(created_at)=24 AND length(source_expires_at)=24 AND length(provenance_expires_at)=24 AND length(expires_at)=24
      AND created_at<expires_at AND expires_at<=source_expires_at AND expires_at<=provenance_expires_at
      AND (issued_at IS NULL OR (issued_at>=created_at AND issued_at<expires_at))
      AND (revoked_at IS NULL OR revoked_at>=created_at))
      OR (minimized_at IS NOT NULL AND length(minimized_at)=24 AND revoked_at IS NOT NULL AND revoked_at<=minimized_at
        AND (issued_at IS NULL OR issued_at<=minimized_at) AND owner_id IS NULL AND owner_email IS NULL AND intent_key IS NULL AND project_id IS NULL AND job_id IS NULL AND completion_event_id IS NULL AND selection_json IS NULL AND review_title IS NULL AND source_expires_at IS NULL AND provenance_expires_at IS NULL AND expires_at IS NULL AND candidate_sha256 IS NULL AND issuer_authority_sha256 IS NULL AND created_at IS NULL))) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX selected_output_shares_owner ON selected_output_shares(owner_id,created_at);
--> statement-breakpoint
CREATE TRIGGER selected_output_share_immutable BEFORE UPDATE ON selected_output_shares
    WHEN NEW.share_id IS NOT OLD.share_id OR NEW.purpose IS NOT OLD.purpose OR NEW.replay_key IS NOT OLD.replay_key
      OR (OLD.minimized_at IS NOT NULL AND (NEW.minimized_at IS NOT OLD.minimized_at OR NEW.owner_id IS NOT OLD.owner_id OR NEW.owner_email IS NOT OLD.owner_email OR NEW.intent_key IS NOT OLD.intent_key OR NEW.project_id IS NOT OLD.project_id OR NEW.job_id IS NOT OLD.job_id OR NEW.completion_event_id IS NOT OLD.completion_event_id OR NEW.selection_json IS NOT OLD.selection_json OR NEW.review_title IS NOT OLD.review_title OR NEW.source_expires_at IS NOT OLD.source_expires_at OR NEW.provenance_expires_at IS NOT OLD.provenance_expires_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.candidate_sha256 IS NOT OLD.candidate_sha256 OR NEW.issuer_authority_sha256 IS NOT OLD.issuer_authority_sha256 OR NEW.created_at IS NOT OLD.created_at
        OR NEW.revoked_at IS NOT OLD.revoked_at OR NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash))
      OR (OLD.minimized_at IS NULL AND NEW.minimized_at IS NULL AND (NEW.owner_id IS NOT OLD.owner_id OR NEW.owner_email IS NOT OLD.owner_email OR NEW.intent_key IS NOT OLD.intent_key OR NEW.project_id IS NOT OLD.project_id OR NEW.job_id IS NOT OLD.job_id OR NEW.completion_event_id IS NOT OLD.completion_event_id OR NEW.selection_json IS NOT OLD.selection_json OR NEW.review_title IS NOT OLD.review_title OR NEW.source_expires_at IS NOT OLD.source_expires_at OR NEW.provenance_expires_at IS NOT OLD.provenance_expires_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.candidate_sha256 IS NOT OLD.candidate_sha256 OR NEW.issuer_authority_sha256 IS NOT OLD.issuer_authority_sha256 OR NEW.created_at IS NOT OLD.created_at))
      OR (OLD.minimized_at IS NULL AND NEW.minimized_at IS NOT NULL AND
        (NEW.minimized_at<OLD.created_at OR NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash
          OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NEW.minimized_at)))
      OR OLD.issued_at IS NOT NULL AND (NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash)
      OR OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.issued_at IS NOT OLD.issued_at OR NEW.token_hash IS NOT OLD.token_hash)
      OR NEW.token_hash IS NOT NULL AND EXISTS(SELECT 1 FROM selected_output_shares other
        WHERE other.share_id!=OLD.share_id AND other.token_hash=NEW.token_hash)
    BEGIN SELECT RAISE(ABORT,'selected_output_share_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER selected_output_share_no_delete BEFORE DELETE ON selected_output_shares
    BEGIN SELECT RAISE(ABORT,'selected_output_share_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER selected_output_share_no_replace BEFORE INSERT ON selected_output_shares
    WHEN NEW.minimized_at IS NOT NULL OR EXISTS(SELECT 1 FROM selected_output_shares old WHERE old.share_id=NEW.share_id
      OR old.replay_key=NEW.replay_key OR (old.owner_id=NEW.owner_id AND old.intent_key=NEW.intent_key)
      OR (NEW.token_hash IS NOT NULL AND old.token_hash=NEW.token_hash))
    BEGIN SELECT RAISE(ABORT,'selected_output_share_exists'); END;
