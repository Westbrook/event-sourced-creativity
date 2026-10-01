CREATE TABLE `memory_document_profile_grants` (
	`grant_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`permission_epoch` text NOT NULL,
	`policy_version` text NOT NULL,
	`recipe_version` text NOT NULL,
	`revision` integer NOT NULL,
	`enrollment_id` text NOT NULL,
	`enrollment_revision` integer NOT NULL,
	`infer_enabled` integer NOT NULL,
	`inspect_enabled` integer NOT NULL,
	`background_enabled` integer NOT NULL,
	`source_after_sequence` integer NOT NULL,
	`consented_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`retention_days` integer NOT NULL,
	`revoked_at` text,
	CONSTRAINT "memory_document_profile_grants_check_1" CHECK(policy_version='document-profile-v1' AND recipe_version='native-document-palette-choice-v1'),
	CONSTRAINT "memory_document_profile_grants_check_2" CHECK((organization_id IS NULL)=(project_access_id IS NULL)),
	CONSTRAINT "memory_document_profile_grants_check_3" CHECK(organization_id IS NOT NULL OR owner_user_id=actor_user_id),
	CONSTRAINT "memory_document_profile_grants_check_4" CHECK(revision BETWEEN 1 AND 9007199254740991 AND enrollment_revision BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "memory_document_profile_grants_check_5" CHECK(revoked_at IS NOT NULL OR revision<9007199254740991),
	CONSTRAINT "memory_document_profile_grants_check_6" CHECK(source_after_sequence BETWEEN 0 AND 9007199254740991 AND retention_days BETWEEN 1 AND 365),
	CONSTRAINT "memory_document_profile_grants_check_7" CHECK(infer_enabled IN(0,1) AND inspect_enabled IN(0,1) AND background_enabled IN(0,1)),
	CONSTRAINT "memory_document_profile_grants_check_8" CHECK(revoked_at IS NULL AND consented_at<expires_at
    OR revoked_at IS NOT NULL AND infer_enabled=0 AND inspect_enabled=0 AND background_enabled=0)
);
--> statement-breakpoint
CREATE INDEX `idx_document_profile_grants_actor` ON `memory_document_profile_grants` (`actor_user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `idx_document_profile_grants_enrollment` ON `memory_document_profile_grants` (`enrollment_id`,`enrollment_revision`);--> statement-breakpoint
CREATE INDEX `idx_document_profile_grants_organization` ON `memory_document_profile_grants` (`organization_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `memory_document_profile_suppressions` (
	`grant_id` text NOT NULL,
	`grant_revision` integer NOT NULL,
	`claim_key` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`grant_id`, `grant_revision`, `claim_key`),
	CONSTRAINT "memory_document_profile_suppressions_check_1" CHECK(grant_revision BETWEEN 1 AND 9007199254740991 AND revision BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "memory_document_profile_suppressions_check_2" CHECK(state IN('active','revoked')),
	CONSTRAINT "memory_document_profile_suppressions_check_3" CHECK(state='revoked' OR created_at<expires_at)
);
