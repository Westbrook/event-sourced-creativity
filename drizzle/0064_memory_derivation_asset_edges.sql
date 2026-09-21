CREATE TABLE `memory_derivation_asset_edges` (
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`state` text NOT NULL,
	`retired_at` text,
	PRIMARY KEY(`source_kind`, `source_id`, `target_kind`, `target_id`),
	CONSTRAINT "memory_asset_kinds" CHECK(source_kind IN('consumer','content','event') AND target_kind IN('content','event') AND (source_kind<>target_kind OR source_id<>target_id)),
	CONSTRAINT "memory_asset_identity" CHECK(length(source_id) BETWEEN 1 AND 240 AND length(target_id) BETWEEN 1 AND 240 AND length(owner_user_id) BETWEEN 1 AND 240),
	CONSTRAINT "memory_asset_state" CHECK((state='active' AND retired_at IS NULL) OR (state='retired' AND retired_at IS NOT NULL)),
	CONSTRAINT "memory_asset_time" CHECK(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at AND length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND expires_at>created_at AND (retired_at IS NULL OR length(retired_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',retired_at) IS retired_at AND retired_at>=created_at))
);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_asset_target` ON `memory_derivation_asset_edges` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_asset_expiry` ON `memory_derivation_asset_edges` (`state`,`expires_at`);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_insert BEFORE INSERT ON memory_derivation_asset_edges
WHEN NEW.state<>'active' OR NEW.created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE (source_kind,source_id,target_kind,target_id)=(NEW.source_kind,NEW.source_id,NEW.target_kind,NEW.target_id))
 OR EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE (target_kind,target_id)=(NEW.target_kind,NEW.target_id)
   AND (state<>'active' OR owner_user_id<>NEW.owner_user_id OR expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 OR EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE (source_kind,source_id)=(NEW.target_kind,NEW.target_id))
 OR (SELECT COUNT(*) FROM memory_derivation_asset_edges WHERE (target_kind,target_id)=(NEW.target_kind,NEW.target_id))>=16
 OR (NEW.source_kind='consumer' AND NOT EXISTS(SELECT 1 FROM memory_derivation_consumers WHERE origin_id=NEW.source_id
   AND actor_user_id=NEW.owner_user_id AND state='active' AND expires_at>=NEW.expires_at))
 OR (NEW.source_kind<>'consumer' AND (NOT EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE (target_kind,target_id)=(NEW.source_kind,NEW.source_id))
   OR EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE (target_kind,target_id)=(NEW.source_kind,NEW.source_id)
     AND (state<>'active' OR owner_user_id<>NEW.owner_user_id OR expires_at<NEW.expires_at))))
 OR (NEW.target_kind='content' AND NOT EXISTS(SELECT 1 FROM private_content WHERE content_id=NEW.target_id
   AND owner_id=NEW.owner_user_id AND kind IN('execution-consent','provider-response','context-proposal','chat-assistant')
   AND redacted_at IS NULL AND expires_at>=NEW.expires_at))
 OR (NEW.target_kind='event' AND NOT EXISTS(SELECT 1 FROM event_private_payloads secret JOIN events event ON event.event_id=secret.private_event_id
   WHERE secret.private_event_id=NEW.target_id AND secret.owner_id=NEW.owner_user_id AND secret.redacted_at IS NULL
   AND event.stream_id='creative:'||NEW.owner_user_id AND event.type='AssistantReasoned'
   AND json_type(event.payload,'$.memory_origin_version')='integer' AND json_extract(event.payload,'$.memory_origin_version') IN(1,2,3)
   AND json_extract(event.payload,'$._private_ref')=event.event_id))
 OR EXISTS(WITH RECURSIVE ancestors(kind,id) AS(SELECT NEW.source_kind,NEW.source_id UNION
   SELECT edge.source_kind,edge.source_id FROM memory_derivation_asset_edges edge JOIN ancestors
     ON (edge.target_kind,edge.target_id)=(ancestors.kind,ancestors.id) LIMIT 66)
   SELECT COUNT(*) FROM ancestors HAVING COUNT(*)>64 OR MAX(kind=NEW.target_kind AND id=NEW.target_id)=1)
 OR EXISTS(WITH RECURSIVE ancestors(kind,id) AS(SELECT NEW.source_kind,NEW.source_id UNION
   SELECT edge.source_kind,edge.source_id FROM memory_derivation_asset_edges edge JOIN ancestors
     ON (edge.target_kind,edge.target_id)=(ancestors.kind,ancestors.id) LIMIT 66),
   descendants(root,kind,id) AS(SELECT id,kind,id FROM ancestors WHERE kind='consumer' UNION
     SELECT descendants.root,edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
       ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id) LIMIT 16449)
   SELECT root FROM descendants GROUP BY root HAVING COUNT(*)>=257)
BEGIN SELECT RAISE(ABORT,'memory_asset_source_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_update BEFORE UPDATE ON memory_derivation_asset_edges
WHEN NEW.source_kind IS NOT OLD.source_kind OR NEW.source_id IS NOT OLD.source_id OR NEW.target_kind IS NOT OLD.target_kind
 OR NEW.target_id IS NOT OLD.target_id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR NOT((OLD.state='active' AND NEW.state='retired' AND NEW.retired_at IS NOT NULL)
   OR (OLD.state='retired' AND NEW.state='retired' AND NEW.retired_at IS OLD.retired_at))
BEGIN SELECT RAISE(ABORT,'memory_asset_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_delete BEFORE DELETE ON memory_derivation_asset_edges BEGIN SELECT RAISE(ABORT,'memory_asset_tombstone_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_retired AFTER UPDATE OF state ON memory_derivation_asset_edges
WHEN OLD.state='active' AND NEW.state='retired'
BEGIN
 UPDATE memory_derivation_asset_edges SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND (target_kind,target_id) IN(WITH RECURSIVE descendants(kind,id) AS(
   SELECT NEW.target_kind,NEW.target_id UNION SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
    ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT kind,id FROM descendants);
 UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,NEW.retired_at)
  WHERE content_id IN(WITH RECURSIVE descendants(kind,id) AS(SELECT NEW.target_kind,NEW.target_id UNION
 SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
 ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT id FROM descendants WHERE kind='content') AND redacted_at IS NULL;
 UPDATE event_private_payloads SET private_json='',redacted_at=COALESCE(redacted_at,NEW.retired_at)
  WHERE private_event_id IN(WITH RECURSIVE descendants(kind,id) AS(SELECT NEW.target_kind,NEW.target_id UNION
 SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
 ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT id FROM descendants WHERE kind='event') AND redacted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_consumer_retired AFTER UPDATE OF state ON memory_derivation_consumers
WHEN NEW.state='retired' AND OLD.state='active'
BEGIN UPDATE memory_derivation_asset_edges SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND (target_kind,target_id) IN(WITH RECURSIVE descendants(kind,id) AS(
   SELECT 'consumer',NEW.origin_id UNION SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
    ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT kind,id FROM descendants); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_consumer_content AFTER INSERT ON memory_derivation_consumer_contents
BEGIN INSERT INTO memory_derivation_asset_edges(source_kind,source_id,target_kind,target_id,owner_user_id,created_at,expires_at,state,retired_at)
 SELECT 'consumer',origin.origin_id,'content',NEW.content_id,origin.actor_user_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),MIN(origin.expires_at,content.expires_at),'active',NULL
 FROM memory_derivation_consumers origin JOIN private_content content ON content.content_id=NEW.content_id WHERE origin.origin_id=NEW.origin_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_content_restore BEFORE UPDATE ON private_content
WHEN EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='content' AND target_id=OLD.content_id)
 AND (NEW.content_id IS NOT OLD.content_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind
   OR NEW.expires_at>OLD.expires_at OR (NEW.content IS NOT OLD.content OR NEW.redacted_at IS NOT OLD.redacted_at)
      AND NOT(NEW.content='' AND NEW.redacted_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'memory_asset_restore_forbidden'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_content_changed AFTER UPDATE OF content_id,owner_id,kind,content,redacted_at,expires_at ON private_content
WHEN (NEW.content_id IS NOT OLD.content_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind OR NEW.content IS NOT OLD.content OR NEW.redacted_at IS NOT OLD.redacted_at OR NEW.expires_at<(SELECT MIN(expires_at) FROM memory_derivation_asset_edges WHERE target_kind='content' AND target_id=OLD.content_id AND state='active')) AND EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='content' AND target_id=OLD.content_id AND state='active')
BEGIN UPDATE memory_derivation_asset_edges SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND (target_kind,target_id) IN(WITH RECURSIVE descendants(kind,id) AS(
   SELECT 'content',OLD.content_id UNION SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
    ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT kind,id FROM descendants); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_content_removed BEFORE DELETE ON private_content
BEGIN UPDATE memory_derivation_asset_edges SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND (target_kind,target_id) IN(WITH RECURSIVE descendants(kind,id) AS(
   SELECT 'content',OLD.content_id UNION SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
    ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT kind,id FROM descendants); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_content_reinsert BEFORE INSERT ON private_content
WHEN EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='content' AND target_id=NEW.content_id)
BEGIN SELECT RAISE(ABORT,'memory_asset_restore_forbidden'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_payload_restore BEFORE UPDATE ON event_private_payloads
WHEN EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='event' AND target_id=OLD.private_event_id)
 AND (NEW.private_event_id IS NOT OLD.private_event_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.project_id IS NOT OLD.project_id OR NEW.document_id IS NOT OLD.document_id
   OR (NEW.private_json IS NOT OLD.private_json OR NEW.redacted_at IS NOT OLD.redacted_at) AND NOT(NEW.private_json='' AND NEW.redacted_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'memory_asset_restore_forbidden'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_payload_changed AFTER UPDATE OF private_event_id,owner_id,project_id,document_id,private_json,redacted_at ON event_private_payloads
WHEN (NEW.private_event_id IS NOT OLD.private_event_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.project_id IS NOT OLD.project_id OR NEW.document_id IS NOT OLD.document_id OR NEW.private_json IS NOT OLD.private_json OR NEW.redacted_at IS NOT OLD.redacted_at) AND EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='event' AND target_id=OLD.private_event_id AND state='active')
BEGIN UPDATE memory_derivation_asset_edges SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND (target_kind,target_id) IN(WITH RECURSIVE descendants(kind,id) AS(
   SELECT 'event',OLD.private_event_id UNION SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
    ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT kind,id FROM descendants); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_payload_removed BEFORE DELETE ON event_private_payloads
BEGIN UPDATE memory_derivation_asset_edges SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND (target_kind,target_id) IN(WITH RECURSIVE descendants(kind,id) AS(
   SELECT 'event',OLD.private_event_id UNION SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
    ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT kind,id FROM descendants); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_payload_reinsert BEFORE INSERT ON event_private_payloads
WHEN EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='event' AND target_id=NEW.private_event_id)
BEGIN SELECT RAISE(ABORT,'memory_asset_restore_forbidden'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_event_changed AFTER UPDATE ON events
WHEN (1) AND EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='event' AND target_id=OLD.event_id AND state='active')
BEGIN UPDATE memory_derivation_asset_edges SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND (target_kind,target_id) IN(WITH RECURSIVE descendants(kind,id) AS(
   SELECT 'event',OLD.event_id UNION SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
    ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT kind,id FROM descendants); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_event_removed BEFORE DELETE ON events
BEGIN UPDATE memory_derivation_asset_edges SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND (target_kind,target_id) IN(WITH RECURSIVE descendants(kind,id) AS(
   SELECT 'event',OLD.event_id UNION SELECT edge.target_kind,edge.target_id FROM memory_derivation_asset_edges edge JOIN descendants
    ON (edge.source_kind,edge.source_id)=(descendants.kind,descendants.id)) SELECT kind,id FROM descendants); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_event_reinsert BEFORE INSERT ON events
WHEN EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='event' AND target_id=NEW.event_id)
BEGIN SELECT RAISE(ABORT,'memory_asset_restore_forbidden'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_event_immutable BEFORE UPDATE ON events
WHEN EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE target_kind='event' AND target_id=OLD.event_id)
 AND (NEW.event_id IS NOT OLD.event_id OR NEW.payload IS NOT OLD.payload AND NEW.payload<>'{}')
BEGIN SELECT RAISE(ABORT,'memory_asset_event_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_event_inheritance AFTER INSERT ON event_private_payloads
WHEN NEW.redacted_at IS NULL AND json_valid(NEW.private_json)
 AND EXISTS(SELECT 1 FROM events WHERE event_id=NEW.private_event_id AND type='AssistantReasoned'
   AND json_type(payload,'$.memory_origin_version')='integer' AND json_extract(payload,'$.memory_origin_version') IN(1,2,3))
 AND EXISTS(SELECT 1 FROM memory_derivation_asset_edges WHERE owner_user_id=NEW.owner_id AND target_kind='event')
BEGIN
 INSERT INTO memory_derivation_asset_edges(source_kind,source_id,target_kind,target_id,owner_user_id,created_at,expires_at,state,retired_at)
 SELECT 'event',parent.event_id,'event',NEW.private_event_id,NEW.owner_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),MIN(edge.expires_at),'active',NULL
 FROM events child JOIN events parent ON parent.stream_id=child.stream_id AND parent.sequence<child.sequence
 JOIN memory_derivation_asset_edges edge ON edge.target_kind='event' AND edge.target_id=parent.event_id
 WHERE child.event_id=NEW.private_event_id AND (parent.event_id=child.compensates_event_id OR parent.event_id=child.causation_id
  OR parent.event_id=json_extract(NEW.private_json,'$.source_event_id')) GROUP BY parent.event_id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_asset_content_expiry AFTER INSERT ON memory_derivation_asset_edges
WHEN NEW.target_kind='content'
BEGIN
 UPDATE private_content SET expires_at=MIN(expires_at,NEW.expires_at) WHERE content_id=NEW.target_id;
 UPDATE private_content_retention_scopes SET assigned_expires_at=MIN(assigned_expires_at,NEW.expires_at) WHERE content_id=NEW.target_id;
END;
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_asset_owner` ON `memory_derivation_asset_edges` (`owner_user_id`,`target_kind`);
