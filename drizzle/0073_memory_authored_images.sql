CREATE TABLE `memory_authored_image_receipts` (
	`content_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`media_key` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`retired_at` text,
	CONSTRAINT "memory_authored_image_state" CHECK(state IN('active','retired')),
	CONSTRAINT "memory_authored_image_created" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
	CONSTRAINT "memory_authored_image_retirement" CHECK((state='active' AND retired_at IS NULL) OR (state='retired' AND retired_at>=created_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_authored_image_receipts_event_id_unique` ON `memory_authored_image_receipts` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_authored_image_receipts_media_key_unique` ON `memory_authored_image_receipts` (`media_key`);--> statement-breakpoint
-- Authored work is independent of private Memory lifetimes. Only erasure of
-- this accepted body or its native event retires the byte-custody receipt.
CREATE TRIGGER memory_authored_image_receipt_insert BEFORE INSERT ON memory_authored_image_receipts
WHEN EXISTS(SELECT 1 FROM memory_authored_image_receipts WHERE content_id=NEW.content_id OR event_id=NEW.event_id OR media_key=NEW.media_key)
 OR NOT EXISTS(SELECT 1 FROM private_content c JOIN event_private_payloads p ON p.owner_id=c.owner_id AND p.private_event_id=NEW.event_id
 JOIN events e ON e.event_id=p.private_event_id AND e.stream_id='creative:'||c.owner_id
 WHERE c.content_id=NEW.content_id AND c.owner_id=NEW.owner_id AND c.kind='authored-memory-image' AND c.redacted_at IS NULL AND p.redacted_at IS NULL
 AND json_extract(p.private_json,'$.output_ref')=c.content_id AND json_extract(c.content,'$.key')=NEW.media_key
 AND e.type='GenerationCompleted' AND json_extract(e.payload,'$.memory_image_acceptance_version')=1 AND NEW.state='active')
BEGIN SELECT RAISE(ABORT,'memory_authored_image_acceptance_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_authored_image_receipt_update BEFORE UPDATE ON memory_authored_image_receipts
WHEN OLD.state<>'active' OR NEW.state<>'retired'
 OR (NEW.content_id,NEW.event_id,NEW.owner_id,NEW.media_key,NEW.created_at) IS NOT (OLD.content_id,OLD.event_id,OLD.owner_id,OLD.media_key,OLD.created_at)
BEGIN SELECT RAISE(ABORT,'memory_authored_image_receipt_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_authored_image_receipt_delete BEFORE DELETE ON memory_authored_image_receipts
BEGIN SELECT RAISE(ABORT,'memory_authored_image_tombstone_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_authored_image_body_update BEFORE UPDATE ON private_content
WHEN EXISTS(SELECT 1 FROM memory_authored_image_receipts r WHERE r.content_id=OLD.content_id)
 AND NEW.redacted_at IS NULL AND (OLD.redacted_at IS NOT NULL OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind
 OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at OR json_remove(NEW.content,'$.projected') IS NOT json_remove(OLD.content,'$.projected')
 OR EXISTS(SELECT 1 FROM memory_authored_image_receipts r WHERE r.content_id=OLD.content_id AND r.state<>'active'))
BEGIN SELECT RAISE(ABORT,'memory_authored_image_body_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_authored_image_body_insert BEFORE INSERT ON private_content
WHEN EXISTS(SELECT 1 FROM memory_authored_image_receipts r WHERE r.content_id=NEW.content_id)
BEGIN SELECT RAISE(ABORT,'memory_authored_image_restore_denied'); END;
--> statement-breakpoint
CREATE TRIGGER memory_authored_image_body_retire AFTER UPDATE ON private_content
WHEN NEW.redacted_at IS NOT NULL
BEGIN UPDATE memory_authored_image_receipts SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE content_id=OLD.content_id AND state='active'; END;
--> statement-breakpoint
CREATE TRIGGER memory_authored_image_body_delete BEFORE DELETE ON private_content
BEGIN UPDATE memory_authored_image_receipts SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE content_id=OLD.content_id AND state='active'; END;
--> statement-breakpoint
CREATE TRIGGER memory_authored_image_event_retire AFTER UPDATE ON event_private_payloads
WHEN NEW.redacted_at IS NOT NULL OR NEW.private_json IS NOT OLD.private_json OR NEW.owner_id IS NOT OLD.owner_id
BEGIN UPDATE memory_authored_image_receipts SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE event_id=OLD.private_event_id AND state='active'; END;
--> statement-breakpoint
CREATE TRIGGER memory_authored_image_event_delete BEFORE DELETE ON event_private_payloads
BEGIN UPDATE memory_authored_image_receipts SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE event_id=OLD.private_event_id AND state='active'; END;
