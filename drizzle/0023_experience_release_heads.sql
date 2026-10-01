CREATE TABLE IF NOT EXISTS `delivery_experience_bindings` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`proposal_event_id` text NOT NULL,
	`binding_hash` text NOT NULL,
	`experience_id` text NOT NULL,
	`channel` text NOT NULL,
	`operation` text NOT NULL,
	`release_hash` text NOT NULL,
	`source_hash` text NOT NULL,
	`build_hash` text NOT NULL,
	`evaluation_hash` text NOT NULL,
	`expected_head_revision` integer NOT NULL,
	`expected_head_event_id` text,
	`rollback_event_id` text,
	`created_at` text NOT NULL,
	CONSTRAINT "delivery_experience_bindings_channel" CHECK("delivery_experience_bindings"."channel"='managed-fixture'),
	CONSTRAINT "delivery_experience_bindings_operation" CHECK("delivery_experience_bindings"."operation" IN('publish','rollback')),
	CONSTRAINT "delivery_experience_bindings_head_revision" CHECK(typeof("delivery_experience_bindings"."expected_head_revision")='integer' AND "delivery_experience_bindings"."expected_head_revision">=0),
	CONSTRAINT "delivery_experience_bindings_head_event" CHECK(("delivery_experience_bindings"."expected_head_revision"=0 AND "delivery_experience_bindings"."expected_head_event_id" IS NULL) OR ("delivery_experience_bindings"."expected_head_revision">0 AND "delivery_experience_bindings"."expected_head_event_id" IS NOT NULL)),
	CONSTRAINT "delivery_experience_bindings_rollback_event" CHECK(("delivery_experience_bindings"."operation"='publish' AND "delivery_experience_bindings"."rollback_event_id" IS NULL) OR ("delivery_experience_bindings"."operation"='rollback' AND "delivery_experience_bindings"."rollback_event_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_experience_bindings_experience_channel_created` ON `delivery_experience_bindings` (`experience_id`,`channel`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `delivery_experience_bindings_proposal_event_id_unique` ON `delivery_experience_bindings` (`proposal_event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `experience_release_heads` (
	`experience_id` text NOT NULL,
	`channel` text NOT NULL,
	`revision` integer NOT NULL,
	`publication_event_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`binding_hash` text NOT NULL,
	`release_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`experience_id`, `channel`),
	CONSTRAINT "experience_release_heads_channel" CHECK("experience_release_heads"."channel"='managed-fixture'),
	CONSTRAINT "experience_release_heads_revision" CHECK(typeof("experience_release_heads"."revision")='integer' AND "experience_release_heads"."revision">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `experience_release_heads_publication_event_id_unique` ON `experience_release_heads` (`publication_event_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS delivery_experience_bindings_block_replace BEFORE INSERT ON delivery_experience_bindings WHEN EXISTS(SELECT 1 FROM delivery_experience_bindings WHERE decision_id=NEW.decision_id OR proposal_event_id=NEW.proposal_event_id) BEGIN SELECT RAISE(ABORT,'experience bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS delivery_experience_bindings_block_update BEFORE UPDATE ON delivery_experience_bindings BEGIN SELECT RAISE(ABORT,'experience bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS delivery_experience_bindings_block_delete BEFORE DELETE ON delivery_experience_bindings BEGIN SELECT RAISE(ABORT,'experience bindings are immutable'); END;
