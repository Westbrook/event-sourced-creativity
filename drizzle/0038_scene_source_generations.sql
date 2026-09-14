CREATE TABLE `scene_source_epoch` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`instance_nonce` text NOT NULL,
	`generation` integer NOT NULL,
	CONSTRAINT "scene_source_epoch_singleton" CHECK("scene_source_epoch"."singleton"=1),
	CONSTRAINT "scene_source_epoch_version" CHECK("scene_source_epoch"."schema_version"=1),
	CONSTRAINT "scene_source_epoch_nonce" CHECK(length("scene_source_epoch"."instance_nonce")=32 AND "scene_source_epoch"."instance_nonce" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "scene_source_epoch_generation" CHECK(typeof("scene_source_epoch"."generation")='integer' AND "scene_source_epoch"."generation" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `scene_source_generations` (
	`scope_kind` text NOT NULL,
	`scope_key` text NOT NULL,
	`generation` integer NOT NULL,
	PRIMARY KEY(`scope_kind`, `scope_key`),
	CONSTRAINT "scene_source_generation_kind" CHECK("scene_source_generations"."scope_kind" IN ('stream','project')),
	CONSTRAINT "scene_source_generation_value" CHECK(typeof("scene_source_generations"."generation")='integer' AND "scene_source_generations"."generation" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TRIGGER scene_source_generations_insert_guard BEFORE INSERT ON scene_source_generations
    WHEN NEW.generation IS NOT 1 OR EXISTS(SELECT 1 FROM scene_source_generations WHERE (scope_kind=NEW.scope_kind AND scope_key=NEW.scope_key) OR rowid=NEW.rowid)
    BEGIN SELECT RAISE(ABORT,'scene_source_generation_reset'); END;
--> statement-breakpoint
CREATE TRIGGER scene_source_generations_update_guard BEFORE UPDATE ON scene_source_generations
    WHEN NEW.scope_kind IS NOT OLD.scope_kind OR NEW.scope_key IS NOT OLD.scope_key OR NEW.rowid IS NOT OLD.rowid
      OR NOT (NEW.generation IS OLD.generation+1 AND OLD.generation<9007199254740991 OR OLD.generation=9007199254740991 AND NEW.generation IS OLD.generation)
    BEGIN SELECT RAISE(ABORT,'scene_source_generation_reset'); END;
--> statement-breakpoint
CREATE TRIGGER scene_source_generations_delete_guard BEFORE DELETE ON scene_source_generations
    BEGIN SELECT RAISE(ABORT,'scene_source_generation_reset'); END;
--> statement-breakpoint
CREATE TRIGGER scene_source_epoch_insert_guard BEFORE INSERT ON scene_source_epoch
    WHEN NEW.singleton IS NOT 1 OR NEW.schema_version IS NOT 1 OR NEW.generation IS NOT 1 OR EXISTS(SELECT 1 FROM scene_source_epoch)
    BEGIN SELECT RAISE(ABORT,'scene_source_epoch_reset'); END;
--> statement-breakpoint
CREATE TRIGGER scene_source_epoch_update_guard BEFORE UPDATE ON scene_source_epoch
    WHEN NEW.singleton IS NOT OLD.singleton OR NEW.schema_version IS NOT OLD.schema_version OR NEW.instance_nonce IS NOT OLD.instance_nonce
      OR NOT (NEW.generation IS OLD.generation+1 AND OLD.generation<9007199254740991 OR OLD.generation=9007199254740991 AND NEW.generation IS OLD.generation)
    BEGIN SELECT RAISE(ABORT,'scene_source_epoch_reset'); END;
--> statement-breakpoint
CREATE TRIGGER scene_source_epoch_delete_guard BEFORE DELETE ON scene_source_epoch
    BEGIN SELECT RAISE(ABORT,'scene_source_epoch_reset'); END;
--> statement-breakpoint
CREATE TRIGGER scene_source_events_insert
    BEFORE INSERT ON events BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT NEW.stream_id AS scope_key UNION SELECT stream_id AS scope_key FROM events
      WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT NEW.event_id AS event_id UNION SELECT event_id FROM events WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT NEW.stream_id AS scope_key UNION SELECT stream_id AS scope_key FROM events
      WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT NEW.event_id AS event_id UNION SELECT event_id FROM events WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
--> statement-breakpoint
CREATE TRIGGER scene_source_events_update
    BEFORE UPDATE ON events BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT OLD.stream_id AS scope_key UNION SELECT NEW.stream_id AS scope_key UNION SELECT stream_id AS scope_key FROM events
      WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT OLD.event_id AS event_id UNION SELECT NEW.event_id AS event_id UNION SELECT event_id FROM events WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT OLD.stream_id AS scope_key UNION SELECT NEW.stream_id AS scope_key UNION SELECT stream_id AS scope_key FROM events
      WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT OLD.event_id AS event_id UNION SELECT NEW.event_id AS event_id UNION SELECT event_id FROM events WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
--> statement-breakpoint
CREATE TRIGGER scene_source_events_delete
    BEFORE DELETE ON events BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT OLD.stream_id AS scope_key) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT OLD.event_id AS event_id));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT OLD.stream_id AS scope_key) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT OLD.event_id AS event_id)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
--> statement-breakpoint
CREATE TRIGGER scene_source_event_private_payloads_insert
    BEFORE INSERT ON event_private_payloads BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT stream_id AS scope_key FROM events WHERE event_id=NEW.private_event_id UNION SELECT event.stream_id AS scope_key FROM event_private_payloads conflicting JOIN events event ON event.event_id=conflicting.private_event_id
       WHERE conflicting.private_event_id=NEW.private_event_id OR conflicting.rowid=NEW.rowid) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT NEW.private_event_id AS event_id UNION SELECT private_event_id AS event_id FROM event_private_payloads WHERE private_event_id=NEW.private_event_id OR rowid=NEW.rowid));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT stream_id AS scope_key FROM events WHERE event_id=NEW.private_event_id UNION SELECT event.stream_id AS scope_key FROM event_private_payloads conflicting JOIN events event ON event.event_id=conflicting.private_event_id
       WHERE conflicting.private_event_id=NEW.private_event_id OR conflicting.rowid=NEW.rowid) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT NEW.private_event_id AS event_id UNION SELECT private_event_id AS event_id FROM event_private_payloads WHERE private_event_id=NEW.private_event_id OR rowid=NEW.rowid)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
--> statement-breakpoint
CREATE TRIGGER scene_source_event_private_payloads_update
    BEFORE UPDATE ON event_private_payloads BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT stream_id AS scope_key FROM events WHERE event_id=OLD.private_event_id UNION SELECT stream_id AS scope_key FROM events WHERE event_id=NEW.private_event_id UNION SELECT event.stream_id AS scope_key FROM event_private_payloads conflicting JOIN events event ON event.event_id=conflicting.private_event_id
       WHERE conflicting.private_event_id=NEW.private_event_id OR conflicting.rowid=NEW.rowid) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT OLD.private_event_id AS event_id UNION SELECT NEW.private_event_id AS event_id UNION SELECT private_event_id AS event_id FROM event_private_payloads WHERE private_event_id=NEW.private_event_id OR rowid=NEW.rowid));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT stream_id AS scope_key FROM events WHERE event_id=OLD.private_event_id UNION SELECT stream_id AS scope_key FROM events WHERE event_id=NEW.private_event_id UNION SELECT event.stream_id AS scope_key FROM event_private_payloads conflicting JOIN events event ON event.event_id=conflicting.private_event_id
       WHERE conflicting.private_event_id=NEW.private_event_id OR conflicting.rowid=NEW.rowid) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT OLD.private_event_id AS event_id UNION SELECT NEW.private_event_id AS event_id UNION SELECT private_event_id AS event_id FROM event_private_payloads WHERE private_event_id=NEW.private_event_id OR rowid=NEW.rowid)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
--> statement-breakpoint
CREATE TRIGGER scene_source_event_private_payloads_delete
    BEFORE DELETE ON event_private_payloads BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT stream_id AS scope_key FROM events WHERE event_id=OLD.private_event_id) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT OLD.private_event_id AS event_id));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'stream' AS scope_kind,scope_key FROM (SELECT stream_id AS scope_key FROM events WHERE event_id=OLD.private_event_id) UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (SELECT OLD.private_event_id AS event_id)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
--> statement-breakpoint
CREATE TRIGGER scene_source_project_event_scopes_insert
    BEFORE INSERT ON project_event_scopes BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'project' AS scope_kind,scope_key FROM (SELECT NEW.project_access_id AS scope_key UNION SELECT project_access_id AS scope_key FROM project_event_scopes
      WHERE event_id=NEW.event_id OR (project_access_id=NEW.project_access_id AND project_sequence=NEW.project_sequence) OR rowid=NEW.rowid));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'project' AS scope_kind,scope_key FROM (SELECT NEW.project_access_id AS scope_key UNION SELECT project_access_id AS scope_key FROM project_event_scopes
      WHERE event_id=NEW.event_id OR (project_access_id=NEW.project_access_id AND project_sequence=NEW.project_sequence) OR rowid=NEW.rowid)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
--> statement-breakpoint
CREATE TRIGGER scene_source_project_event_scopes_update
    BEFORE UPDATE ON project_event_scopes BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'project' AS scope_kind,scope_key FROM (SELECT OLD.project_access_id AS scope_key UNION SELECT NEW.project_access_id AS scope_key UNION SELECT project_access_id AS scope_key FROM project_event_scopes
      WHERE event_id=NEW.event_id OR (project_access_id=NEW.project_access_id AND project_sequence=NEW.project_sequence) OR rowid=NEW.rowid));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'project' AS scope_kind,scope_key FROM (SELECT OLD.project_access_id AS scope_key UNION SELECT NEW.project_access_id AS scope_key UNION SELECT project_access_id AS scope_key FROM project_event_scopes
      WHERE event_id=NEW.event_id OR (project_access_id=NEW.project_access_id AND project_sequence=NEW.project_sequence) OR rowid=NEW.rowid)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
--> statement-breakpoint
CREATE TRIGGER scene_source_project_event_scopes_delete
    BEFORE DELETE ON project_event_scopes BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<9007199254740991 THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (SELECT 'project' AS scope_kind,scope_key FROM (SELECT OLD.project_access_id AS scope_key));
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (SELECT 'project' AS scope_kind,scope_key FROM (SELECT OLD.project_access_id AS scope_key)) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END;
