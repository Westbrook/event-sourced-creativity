CREATE TABLE `delivery_experience_maintenance_bindings` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`proposal_event_id` text NOT NULL,
	`binding_hash` text NOT NULL,
	`subject_hash` text NOT NULL,
	`experience_id` text NOT NULL,
	`channel` text NOT NULL,
	`release_hash` text NOT NULL,
	`source_hash` text NOT NULL,
	`build_hash` text NOT NULL,
	`evaluation_hash` text NOT NULL,
	`binding_json` text NOT NULL,
	`expected_head_revision` integer NOT NULL,
	`expected_head_event_id` text,
	`created_at` text NOT NULL,
	CONSTRAINT "delivery_experience_maintenance_bindings_channel" CHECK("delivery_experience_maintenance_bindings"."channel"='managed-fixture'),
	CONSTRAINT "delivery_experience_maintenance_bindings_head_revision" CHECK(typeof("delivery_experience_maintenance_bindings"."expected_head_revision")='integer' AND "delivery_experience_maintenance_bindings"."expected_head_revision">=0),
	CONSTRAINT "delivery_experience_maintenance_bindings_head_event" CHECK(("delivery_experience_maintenance_bindings"."expected_head_revision"=0 AND "delivery_experience_maintenance_bindings"."expected_head_event_id" IS NULL) OR ("delivery_experience_maintenance_bindings"."expected_head_revision">0 AND "delivery_experience_maintenance_bindings"."expected_head_event_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_delivery_experience_maintenance_bindings_experience_channel_created` ON `delivery_experience_maintenance_bindings` (`experience_id`,`channel`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_experience_maintenance_bindings_proposal_event_id_unique` ON `delivery_experience_maintenance_bindings` (`proposal_event_id`);--> statement-breakpoint
CREATE TABLE `experience_maintenance_heads` (
	`subject_hash` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`channel` text NOT NULL,
	`material_selection_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`adoption_event_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`binding_hash` text NOT NULL,
	`baseline_observation_hash` text NOT NULL,
	`profile_ref` text NOT NULL,
	`profile_hash` text NOT NULL,
	`inventory_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "experience_maintenance_heads_channel" CHECK("experience_maintenance_heads"."channel"='managed-fixture'),
	CONSTRAINT "experience_maintenance_heads_revision" CHECK(typeof("experience_maintenance_heads"."revision")='integer' AND "experience_maintenance_heads"."revision">0),
	CONSTRAINT "experience_maintenance_heads_profile" CHECK("experience_maintenance_heads"."profile_ref"='model3d.code-declarations@1')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experience_maintenance_heads_adoption_event_id_unique` ON `experience_maintenance_heads` (`adoption_event_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS delivery_experience_maintenance_bindings_block_replace BEFORE INSERT ON delivery_experience_maintenance_bindings WHEN EXISTS(SELECT 1 FROM delivery_experience_maintenance_bindings WHERE decision_id=NEW.decision_id OR proposal_event_id=NEW.proposal_event_id) BEGIN SELECT RAISE(ABORT,'experience maintenance bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS delivery_experience_maintenance_bindings_block_update BEFORE UPDATE ON delivery_experience_maintenance_bindings BEGIN SELECT RAISE(ABORT,'experience maintenance bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS delivery_experience_maintenance_bindings_block_delete BEFORE DELETE ON delivery_experience_maintenance_bindings BEGIN SELECT RAISE(ABORT,'experience maintenance bindings are immutable'); END;
