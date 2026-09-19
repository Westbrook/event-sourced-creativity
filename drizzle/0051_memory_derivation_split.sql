CREATE TABLE `memory_derivation_split_commands` (
	`parent_job_id` text PRIMARY KEY NOT NULL,
	`left_job_id` text NOT NULL,
	`right_job_id` text NOT NULL,
	`lease_token` text NOT NULL,
	`split_sequence` integer NOT NULL,
	`finance_id` text NOT NULL,
	`parent_json` text NOT NULL,
	`references_json` text NOT NULL,
	CONSTRAINT "memory_derivation_split_bounds" CHECK(length(parent_job_id)=64 AND length(left_job_id)=64 AND length(right_job_id)=64 AND parent_job_id!=left_job_id AND parent_job_id!=right_job_id AND left_job_id!=right_job_id AND length(lease_token)=36 AND length(finance_id)=64 AND typeof(split_sequence)='integer' AND split_sequence>0 AND json_valid(parent_json) AND json_valid(references_json) AND length(parent_json)<=4096 AND length(references_json)<=65536)
);


--> statement-breakpoint
DROP TRIGGER memory_derivation_job_insert;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_job_insert BEFORE INSERT ON memory_derivation_jobs WHEN EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=NEW.job_id OR (consent_id,after_sequence)=(NEW.consent_id,NEW.after_sequence)) OR NEW.state!='waiting' OR NEW.attempts!=0 OR NEW.failure_code IS NOT NULL OR NEW.not_before!=NEW.created_at OR NOT EXISTS(SELECT 1 FROM memory_derivation_cursors c JOIN memory_derivation_grants g ON (g.grant_id,g.revision,g.consent_id)=(c.grant_id,c.grant_revision,c.consent_id) WHERE (c.consent_id,c.purpose)=(NEW.consent_id,NEW.purpose) AND (c.registered_through_sequence=NEW.after_sequence OR EXISTS(
 SELECT 1 FROM memory_derivation_split_commands split WHERE NEW.job_id IN(split.left_job_id,split.right_job_id)
 AND NEW.consent_id=json_extract(split.parent_json,'$[1]') AND NEW.purpose=json_extract(split.parent_json,'$[2]')
 AND NEW.after_sequence=CASE WHEN NEW.job_id=split.left_job_id THEN json_extract(split.parent_json,'$[3]') ELSE split.split_sequence END
 AND NEW.through_sequence=CASE WHEN NEW.job_id=split.left_job_id THEN split.split_sequence ELSE json_extract(split.parent_json,'$[4]') END
 AND NEW.created_at=json_extract(split.parent_json,'$[6]') AND NEW.expires_at=json_extract(split.parent_json,'$[7]')
 AND NEW.source_count=(SELECT COUNT(*) FROM json_each(split.references_json) WHERE
  json_extract(value,'$[3]')>NEW.after_sequence AND json_extract(value,'$[3]')<=NEW.through_sequence))) AND NEW.expires_at<=c.expires_at AND g.revoked_at IS NULL AND g.background_enabled=1 AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) BEGIN SELECT RAISE(ABORT,'memory_derivation_job_insert'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_split_insert BEFORE INSERT ON memory_derivation_split_commands
WHEN EXISTS(SELECT 1 FROM memory_derivation_split_commands)
 OR NEW.parent_json IS NOT (SELECT json_array(job_id,consent_id,purpose,after_sequence,through_sequence,source_count,created_at,expires_at,state,lease_token,lease_expires_at,attempts,not_before,failure_code) FROM memory_derivation_jobs WHERE job_id=NEW.parent_job_id)
 OR NEW.references_json IS NOT (SELECT json_group_array(json_array(job_id,enrollment_id,event_id,sequence,expires_at)) FROM (SELECT job_id,enrollment_id,event_id,sequence,expires_at FROM memory_derivation_job_sources WHERE job_id=NEW.parent_job_id ORDER BY sequence,event_id))
 OR json_array_length(NEW.references_json)!=json_extract(NEW.parent_json,'$[5]') OR json_extract(NEW.parent_json,'$[5]')<2
 OR NEW.split_sequence IS NOT (SELECT json_extract(value,'$[3]') FROM json_each(NEW.references_json) WHERE key=CAST(json_extract(NEW.parent_json,'$[5]')/2 AS INTEGER)-1)
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
  WHERE j.job_id=NEW.parent_job_id AND j.state='leased' AND j.lease_token=NEW.lease_token
  AND j.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND j.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND g.revoked_at IS NULL AND g.background_enabled=1
  AND (SELECT COUNT(*) FROM memory_derivation_jobs pending WHERE pending.consent_id=j.consent_id
    AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=pending.job_id))<160)
 OR EXISTS(SELECT 1 FROM memory_derivation_job_finance WHERE job_id=NEW.parent_job_id)
 OR EXISTS(SELECT 1 FROM memory_derivation_finance WHERE finance_id=NEW.finance_id)
 OR EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id IN(NEW.finance_id||':tokens',NEW.finance_id||':usd'))
 OR EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id IN(NEW.finance_id||':tokens',NEW.finance_id||':usd'))
 OR EXISTS(SELECT 1 FROM memory_derivation_completions WHERE job_id=NEW.parent_job_id)
 OR EXISTS(SELECT 1 FROM memory_derivation_results WHERE job_id=NEW.parent_job_id)
 OR EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id IN(NEW.left_job_id,NEW.right_job_id))
BEGIN SELECT RAISE(ABORT,'memory_derivation_split_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_split_update BEFORE UPDATE ON memory_derivation_split_commands
BEGIN SELECT RAISE(ABORT,'memory_derivation_split_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_split_apply AFTER INSERT ON memory_derivation_split_commands
BEGIN
 DELETE FROM memory_derivation_jobs WHERE job_id=NEW.parent_job_id;
 INSERT INTO memory_derivation_jobs(job_id,consent_id,purpose,after_sequence,through_sequence,source_count,created_at,expires_at,state,lease_token,lease_expires_at,attempts,not_before,failure_code)
 VALUES(NEW.left_job_id,json_extract(NEW.parent_json,'$[1]'),json_extract(NEW.parent_json,'$[2]'),json_extract(NEW.parent_json,'$[3]'),NEW.split_sequence,CAST(json_extract(NEW.parent_json,'$[5]')/2 AS INTEGER),json_extract(NEW.parent_json,'$[6]'),json_extract(NEW.parent_json,'$[7]'),'waiting',NULL,NULL,0,json_extract(NEW.parent_json,'$[6]'),NULL);
 INSERT INTO memory_derivation_jobs(job_id,consent_id,purpose,after_sequence,through_sequence,source_count,created_at,expires_at,state,lease_token,lease_expires_at,attempts,not_before,failure_code)
 VALUES(NEW.right_job_id,json_extract(NEW.parent_json,'$[1]'),json_extract(NEW.parent_json,'$[2]'),NEW.split_sequence,json_extract(NEW.parent_json,'$[4]'),json_extract(NEW.parent_json,'$[5]')-CAST(json_extract(NEW.parent_json,'$[5]')/2 AS INTEGER),json_extract(NEW.parent_json,'$[6]'),json_extract(NEW.parent_json,'$[7]'),'waiting',NULL,NULL,0,json_extract(NEW.parent_json,'$[6]'),NULL);
 INSERT INTO memory_derivation_job_sources(job_id,enrollment_id,event_id,sequence,expires_at)
 SELECT CASE WHEN json_extract(value,'$[3]')<=NEW.split_sequence THEN NEW.left_job_id ELSE NEW.right_job_id END,json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]') FROM json_each(NEW.references_json);
 DELETE FROM memory_derivation_split_commands WHERE parent_job_id=NEW.parent_job_id;
END;
