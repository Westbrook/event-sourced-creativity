CREATE TABLE `memory_recall_boundaries` (
	`enrollment_id` text PRIMARY KEY NOT NULL,
	`enrollment_revision` integer NOT NULL,
	`boundary` text NOT NULL,
	`revision` text NOT NULL,
	`consented_at` text NOT NULL,
	FOREIGN KEY (`enrollment_id`) REFERENCES `memory_live_enrollments`(`enrollment_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_recall_boundary_kind" CHECK(boundary IN('document','project','project-tree','partition')),
	CONSTRAINT "memory_recall_boundary_parent" CHECK(typeof(enrollment_revision)='integer' AND enrollment_revision>=1),
	CONSTRAINT "memory_recall_boundary_revision" CHECK(length(revision)=36),
	CONSTRAINT "memory_recall_boundary_time" CHECK(length(consented_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',consented_at) IS consented_at)
);

--> statement-breakpoint
CREATE TRIGGER memory_recall_boundaries_parent_change AFTER UPDATE ON memory_live_enrollments
WHEN NEW.revision IS NOT OLD.revision OR NEW.actor_user_id IS NOT OLD.actor_user_id
 OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.organization_id IS NOT OLD.organization_id
 OR NEW.project_access_id IS NOT OLD.project_access_id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.document_id IS NOT OLD.document_id OR NEW.permission_epoch IS NOT OLD.permission_epoch
 OR NEW.policy_version IS NOT OLD.policy_version OR NEW.recall_enabled IS NOT OLD.recall_enabled
 OR NEW.learn_enabled IS NOT OLD.learn_enabled OR NEW.expires_at IS NOT OLD.expires_at
 OR NEW.failure_code IN('forgotten','erased','access-changed','revoked')
BEGIN DELETE FROM memory_recall_boundaries WHERE enrollment_id=OLD.enrollment_id; END;
