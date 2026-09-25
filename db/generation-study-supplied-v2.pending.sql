-- Optional P2 extension AFTER generation-study.pending.sql in an EMPTY local fixture.
-- Not a migration or runtime installer. The v1 schema contract remains unchanged.
-- Fail before DDL when any v1 authority/purchase exists; never migrate a live journal here.
INSERT INTO generation_study_assertions(passed) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM generation_study_grants) AND NOT EXISTS(SELECT 1 FROM generation_study_operations) AND NOT EXISTS(SELECT 1 FROM generation_study_stages) THEN 1 ELSE 0 END;
DELETE FROM generation_study_assertions;
DROP TABLE generation_study_stages;
CREATE TABLE generation_study_stages (
 operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id),
 stage TEXT NOT NULL CHECK(stage IN('advisory','moderation','image','storage')),
 status TEXT NOT NULL CHECK(status IN('intent','received','complete')),
 request_hash TEXT NOT NULL, receipt_hash TEXT, PRIMARY KEY(operation_id,stage)
);
-- Entered by an existing trusted review authority, never request-supplied booleans.
-- All immutable bindings live in canonical binding_json; revocation is terminal.
CREATE TABLE generation_study_supplied_reviews (
 review_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL UNIQUE REFERENCES generation_study_grants(grant_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), principal_hash TEXT NOT NULL,
 binding_json TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('authorized','revoked')),
 hard_stop TEXT
);
CREATE TRIGGER generation_study_supplied_review_identity BEFORE UPDATE ON generation_study_supplied_reviews
 WHEN NEW.review_id!=OLD.review_id OR NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.principal_hash!=OLD.principal_hash OR NEW.binding_json!=OLD.binding_json OR NEW.expires_at!=OLD.expires_at OR (OLD.status='revoked' AND NEW.status!='revoked') OR (OLD.hard_stop IS NOT NULL AND NEW.hard_stop IS NOT OLD.hard_stop)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_review'); END;
CREATE TRIGGER generation_study_supplied_review_no_delete BEFORE DELETE ON generation_study_supplied_reviews BEGIN SELECT RAISE(ABORT,'generation_study_immutable_review'); END;
CREATE TABLE generation_study_supplied_observations (
 operation_id TEXT PRIMARY KEY REFERENCES generation_study_operations(operation_id),
 review_id TEXT NOT NULL REFERENCES generation_study_supplied_reviews(review_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), principal_hash TEXT NOT NULL,
 artifact_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, protocol TEXT NOT NULL,
 safety TEXT NOT NULL CHECK(safety IN('clear','unsafe')),
 fidelity TEXT NOT NULL CHECK(fidelity IN('pass','expected-failure')), finding TEXT NOT NULL,
 evidence_ref TEXT NOT NULL, resume INTEGER NOT NULL CHECK(resume IN(0,1)), recorded_at TEXT NOT NULL
);
CREATE TRIGGER generation_study_supplied_observation_no_update BEFORE UPDATE ON generation_study_supplied_observations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_observation'); END;
CREATE TRIGGER generation_study_supplied_observation_no_delete BEFORE DELETE ON generation_study_supplied_observations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_observation'); END;
-- Durable intent cannot be erased or rebound to manufacture a new slot.
CREATE TRIGGER generation_study_supplied_stage_no_delete BEFORE DELETE ON generation_study_stages BEGIN SELECT RAISE(ABORT,'generation_study_immutable_intent'); END;
CREATE TRIGGER generation_study_supplied_stage_identity BEFORE UPDATE ON generation_study_stages
 WHEN NEW.operation_id!=OLD.operation_id OR NEW.stage!=OLD.stage OR NEW.request_hash!=OLD.request_hash OR (OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash) OR (OLD.status='received' AND NEW.status='intent') OR (OLD.status='complete' AND NEW.status!='complete')
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_intent'); END;

CREATE TRIGGER generation_study_supplied_grant_revocation BEFORE UPDATE ON generation_study_grants
 WHEN OLD.status='revoked' AND NEW.status!='revoked' AND EXISTS(SELECT 1 FROM generation_study_supplied_reviews WHERE grant_id=OLD.grant_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_supplied_revocation_terminal'); END;
