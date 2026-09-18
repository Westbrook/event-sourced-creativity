CREATE TABLE `memory_derivation_grants` (
	`consent_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`enrollment_revision` integer NOT NULL,
	`permission_epoch` text NOT NULL,
	`policy_version` text NOT NULL,
	`purpose` text NOT NULL,
	`qualification_id` text NOT NULL,
	`terms_sha256` text NOT NULL,
	`payer_user_id` text NOT NULL,
	`monthly_cap_microusd` integer NOT NULL,
	`source_after_sequence` integer NOT NULL,
	`retention_days` integer NOT NULL,
	`background_enabled` integer NOT NULL,
	`consented_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	PRIMARY KEY(`grant_id`, `revision`),
	FOREIGN KEY (`enrollment_id`) REFERENCES `memory_live_enrollments`(`enrollment_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`qualification_id`) REFERENCES `memory_derivation_qualifications`(`qualification_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_derivation_grant_scope" CHECK(length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND payer_user_id=actor_user_id AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))),
	CONSTRAINT "memory_derivation_grant_identity" CHECK(length(consent_id)=36 AND length(grant_id)=64 AND grant_id NOT GLOB '*[^0-9a-f]*' AND length(terms_sha256)=64 AND terms_sha256 NOT GLOB '*[^0-9a-f]*' AND policy_version='personal-memory-derivation-v1' AND purpose IN('rolling-summary','profile','suggestion')),
	CONSTRAINT "memory_derivation_grant_bounds" CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991 AND typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(source_after_sequence)='integer' AND source_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(monthly_cap_microusd)='integer' AND monthly_cap_microusd BETWEEN 1 AND 1000000000 AND typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 365 AND background_enabled IN(0,1)),
	CONSTRAINT "memory_derivation_grant_time" CHECK(length(consented_at)=24 AND length(expires_at)=24 AND consented_at<expires_at AND (revoked_at IS NULL OR length(revoked_at)=24 AND revoked_at>=consented_at))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_derivation_grant_active` ON `memory_derivation_grants` (`grant_id`) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_grant_actor` ON `memory_derivation_grants` (`actor_user_id`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_grant_parent` ON `memory_derivation_grants` (`enrollment_id`,`enrollment_revision`);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_grant_organization` ON `memory_derivation_grants` (`organization_id`,`actor_user_id`);
--> statement-breakpoint
CREATE TABLE `memory_derivation_qualifications` (
	`qualification_id` text PRIMARY KEY NOT NULL,
	`source_sha256` text NOT NULL,
	`origin` text NOT NULL,
	`deployment_id` text NOT NULL,
	`terms_json` text NOT NULL,
	`terms_sha256` text NOT NULL,
	`status` text NOT NULL,
	`qualified_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "memory_derivation_qualification_hash" CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*' AND length(terms_sha256)=64 AND terms_sha256 NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_derivation_qualification_terms" CHECK(json_valid(terms_json) AND json_type(terms_json)='object' AND length(CAST(terms_json AS BLOB)) BETWEEN 1 AND 8192),
	CONSTRAINT "memory_derivation_qualification_state" CHECK(status IN('qualified','withdrawn') AND length(qualified_at)=24 AND length(expires_at)=24 AND qualified_at<expires_at)
);

--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_qualification_current` ON `memory_derivation_qualifications` (`source_sha256`,`status`,`expires_at`);

--> statement-breakpoint
CREATE TRIGGER memory_derivation_qualification_immutable BEFORE UPDATE ON memory_derivation_qualifications WHEN OLD.status!='qualified' OR NEW.status!='withdrawn' OR OLD.qualification_id IS NOT NEW.qualification_id OR OLD.source_sha256 IS NOT NEW.source_sha256 OR OLD.origin IS NOT NEW.origin OR OLD.deployment_id IS NOT NEW.deployment_id OR OLD.terms_json IS NOT NEW.terms_json OR OLD.terms_sha256 IS NOT NEW.terms_sha256 OR OLD.qualified_at IS NOT NEW.qualified_at OR OLD.expires_at IS NOT NEW.expires_at BEGIN SELECT RAISE(ABORT,'memory_derivation_qualification_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_grant_immutable BEFORE UPDATE ON memory_derivation_grants WHEN OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR OLD.consent_id IS NOT NEW.consent_id OR OLD.grant_id IS NOT NEW.grant_id OR OLD.revision IS NOT NEW.revision OR OLD.actor_user_id IS NOT NEW.actor_user_id OR OLD.owner_user_id IS NOT NEW.owner_user_id OR OLD.organization_id IS NOT NEW.organization_id OR OLD.project_access_id IS NOT NEW.project_access_id OR OLD.project_id IS NOT NEW.project_id OR OLD.document_id IS NOT NEW.document_id OR OLD.enrollment_id IS NOT NEW.enrollment_id OR OLD.enrollment_revision IS NOT NEW.enrollment_revision OR OLD.permission_epoch IS NOT NEW.permission_epoch OR OLD.policy_version IS NOT NEW.policy_version OR OLD.purpose IS NOT NEW.purpose OR OLD.qualification_id IS NOT NEW.qualification_id OR OLD.terms_sha256 IS NOT NEW.terms_sha256 OR OLD.payer_user_id IS NOT NEW.payer_user_id OR OLD.monthly_cap_microusd IS NOT NEW.monthly_cap_microusd OR OLD.source_after_sequence IS NOT NEW.source_after_sequence OR OLD.retention_days IS NOT NEW.retention_days OR OLD.background_enabled IS NOT NEW.background_enabled OR OLD.consented_at IS NOT NEW.consented_at OR OLD.expires_at IS NOT NEW.expires_at BEGIN SELECT RAISE(ABORT,'memory_derivation_grant_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_grant_parent_changed AFTER UPDATE OF actor_user_id,owner_user_id,organization_id,project_access_id,project_id,document_id,permission_epoch,policy_version,revision,learn_enabled,recall_enabled,background_enabled,retention_days,enrolled_at,expires_at ON memory_live_enrollments WHEN OLD.actor_user_id IS NOT NEW.actor_user_id OR OLD.owner_user_id IS NOT NEW.owner_user_id OR OLD.organization_id IS NOT NEW.organization_id OR OLD.project_access_id IS NOT NEW.project_access_id OR OLD.project_id IS NOT NEW.project_id OR OLD.document_id IS NOT NEW.document_id OR OLD.permission_epoch IS NOT NEW.permission_epoch OR OLD.policy_version IS NOT NEW.policy_version OR OLD.revision IS NOT NEW.revision OR OLD.learn_enabled IS NOT NEW.learn_enabled OR OLD.recall_enabled IS NOT NEW.recall_enabled OR OLD.background_enabled IS NOT NEW.background_enabled OR OLD.retention_days IS NOT NEW.retention_days OR OLD.enrolled_at IS NOT NEW.enrolled_at OR OLD.expires_at IS NOT NEW.expires_at BEGIN UPDATE memory_derivation_grants SET revoked_at=MAX(consented_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE enrollment_id=OLD.enrollment_id AND revoked_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_grant_qualification_withdrawn AFTER UPDATE OF status ON memory_derivation_qualifications WHEN NEW.status='withdrawn' BEGIN UPDATE memory_derivation_grants SET revoked_at=MAX(consented_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE qualification_id=OLD.qualification_id AND revoked_at IS NULL; END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_qualification_no_replace BEFORE INSERT ON memory_derivation_qualifications WHEN EXISTS(SELECT 1 FROM memory_derivation_qualifications WHERE qualification_id=NEW.qualification_id) BEGIN SELECT RAISE(ABORT,'memory_derivation_qualification_no_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_grant_no_replace BEFORE INSERT ON memory_derivation_grants WHEN EXISTS(SELECT 1 FROM memory_derivation_grants WHERE grant_id=NEW.grant_id AND (revision=NEW.revision OR revoked_at IS NULL AND NEW.revoked_at IS NULL)) BEGIN SELECT RAISE(ABORT,'memory_derivation_grant_no_replace'); END;
