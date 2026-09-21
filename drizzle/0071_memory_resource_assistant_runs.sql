-- Native private resource assistant executions. No authored artifact linkage.
-- Context ID is deliberately retained after source erasure as negative ancestry.
CREATE TABLE memory_resource_assistant_runs (
 execution_id text PRIMARY KEY NOT NULL REFERENCES consequential_executions(execution_id) ON DELETE CASCADE,
 actor_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 context_id text NOT NULL CHECK(length(context_id)=36),
 resource_key text NOT NULL CHECK(json_valid(resource_key) AND json_array_length(resource_key)=7 AND json_extract(resource_key,'$[0]')='memory-resource-v1'),
 snapshot_sha256 text NOT NULL CHECK(length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^a-f0-9]*'),
 state text NOT NULL CHECK(state IN('active','retired')),
 created_at text NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
 expires_at text NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND expires_at>created_at),
 retired_at text,
 CHECK((state='active' AND retired_at IS NULL) OR (state='retired' AND retired_at>=created_at))
);
--> statement-breakpoint
CREATE INDEX idx_memory_resource_assistant_context ON memory_resource_assistant_runs(context_id,state);
--> statement-breakpoint
CREATE TABLE memory_resource_assistant_contents (
 content_id text PRIMARY KEY NOT NULL,
 execution_id text NOT NULL REFERENCES memory_resource_assistant_runs(execution_id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN('consent','response','result')),
 UNIQUE(execution_id,role)
);
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_run_insert BEFORE INSERT ON memory_resource_assistant_runs
WHEN EXISTS(SELECT 1 FROM memory_resource_assistant_runs WHERE execution_id=NEW.execution_id)
 OR NOT EXISTS(SELECT 1 FROM memory_resource_contexts c JOIN consequential_executions e ON e.execution_id=NEW.execution_id
  WHERE c.context_id=NEW.context_id AND c.actor_user_id=NEW.actor_user_id AND c.state='active' AND c.snapshot_sha256=NEW.snapshot_sha256 AND json_extract(c.snapshot_json,'$.resourceKey')=NEW.resource_key
   AND e.actor_user_id=NEW.actor_user_id AND e.operation='assistant-specialist' AND e.status='quoted'
   AND NEW.state='active' AND NEW.expires_at<=c.expires_at AND NEW.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'resource_assistant_origin_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_run_immutable BEFORE UPDATE ON memory_resource_assistant_runs
WHEN OLD.state<>'active' OR NEW.state<>'retired'
 OR (NEW.execution_id,NEW.actor_user_id,NEW.context_id,NEW.resource_key,NEW.snapshot_sha256,NEW.created_at,NEW.expires_at)
 IS NOT (OLD.execution_id,OLD.actor_user_id,OLD.context_id,OLD.resource_key,OLD.snapshot_sha256,OLD.created_at,OLD.expires_at)
BEGIN SELECT RAISE(ABORT,'resource_assistant_origin_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_content_insert BEFORE INSERT ON memory_resource_assistant_contents
WHEN EXISTS(SELECT 1 FROM memory_resource_assistant_contents WHERE content_id=NEW.content_id)
 OR NOT EXISTS(SELECT 1 FROM memory_resource_assistant_runs run JOIN private_content content ON content.content_id=NEW.content_id
  JOIN memory_resource_contexts context ON context.context_id=run.context_id
  WHERE run.execution_id=NEW.execution_id AND run.state='active' AND run.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND context.state='active' AND context.actor_user_id=run.actor_user_id AND context.snapshot_sha256=run.snapshot_sha256
   AND content.owner_id=run.actor_user_id AND content.redacted_at IS NULL AND content.expires_at<=run.expires_at
   AND content.kind=CASE NEW.role WHEN 'consent' THEN 'execution-consent' WHEN 'response' THEN 'provider-response' WHEN 'result' THEN 'context-proposal' END)
BEGIN SELECT RAISE(ABORT,'resource_assistant_private_content_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_content_immutable BEFORE UPDATE ON memory_resource_assistant_contents
BEGIN SELECT RAISE(ABORT,'resource_assistant_content_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_context_retirement BEFORE UPDATE ON memory_resource_contexts
WHEN NEW.state<>'active'
BEGIN
 UPDATE memory_resource_assistant_runs SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE context_id=OLD.context_id AND state='active';
END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_context_deletion BEFORE DELETE ON memory_resource_contexts
BEGIN
 UPDATE memory_resource_assistant_runs SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE context_id=OLD.context_id AND state='active';
END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_run_retirement AFTER UPDATE ON memory_resource_assistant_runs
WHEN NEW.state='retired'
BEGIN
 UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE content_id IN(SELECT content_id FROM memory_resource_assistant_contents WHERE execution_id=NEW.execution_id);
END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_run_deletion BEFORE DELETE ON memory_resource_assistant_runs
BEGIN
 UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE content_id IN(SELECT content_id FROM memory_resource_assistant_contents WHERE execution_id=OLD.execution_id);
END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_content_restore BEFORE UPDATE ON private_content
WHEN NEW.redacted_at IS NULL AND EXISTS(SELECT 1 FROM memory_resource_assistant_contents link JOIN memory_resource_assistant_runs run ON run.execution_id=link.execution_id
 WHERE link.content_id=NEW.content_id AND (run.state<>'active' OR run.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
BEGIN SELECT RAISE(ABORT,'resource_assistant_content_retired'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_assistant_content_reinsert BEFORE INSERT ON private_content
WHEN NEW.redacted_at IS NULL AND EXISTS(SELECT 1 FROM memory_resource_assistant_contents link JOIN memory_resource_assistant_runs run ON run.execution_id=link.execution_id
 WHERE link.content_id=NEW.content_id AND (run.state<>'active' OR run.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
BEGIN SELECT RAISE(ABORT,'resource_assistant_content_retired'); END;
