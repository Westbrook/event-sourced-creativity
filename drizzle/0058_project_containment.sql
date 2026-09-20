CREATE TABLE `project_containment` (
	`owner_user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`declaration_ref` text NOT NULL,
	`parent_project_id` text,
	`parent_declaration_ref` text,
	`organization_id` text,
	`revision` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_user_id`, `project_id`),
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`declaration_ref`) REFERENCES `events`(`event_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_declaration_ref`) REFERENCES `events`(`event_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`organization_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_containment_parent_pair" CHECK(("project_containment"."parent_project_id" IS NULL) = ("project_containment"."parent_declaration_ref" IS NULL)),
	CONSTRAINT "project_containment_no_self" CHECK("project_containment"."parent_project_id" IS NULL OR "project_containment"."parent_project_id" <> "project_containment"."project_id")
);
--> statement-breakpoint
CREATE INDEX `idx_project_containment_parent` ON `project_containment` (`owner_user_id`,`parent_project_id`);
--> statement-breakpoint
CREATE TRIGGER project_containment_insert AFTER INSERT ON project_containment BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM project_containment WHERE owner_user_id=NEW.owner_user_id)>256 THEN RAISE(ABORT,'project_containment_capacity') END;
 SELECT CASE WHEN EXISTS(WITH RECURSIVE ancestry(project_id,parent_id,depth) AS (
   SELECT project_id,parent_project_id,1 FROM project_containment WHERE owner_user_id=NEW.owner_user_id
   UNION ALL SELECT parent.project_id,parent.parent_project_id,ancestry.depth+1
     FROM ancestry JOIN project_containment parent ON parent.owner_user_id=NEW.owner_user_id AND parent.project_id=ancestry.parent_id WHERE ancestry.depth<16
 ) SELECT 1 FROM ancestry WHERE depth=16 AND parent_id IS NOT NULL) THEN RAISE(ABORT,'project_containment_cycle_or_depth') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM events child WHERE child.event_id=NEW.declaration_ref AND child.stream_id='creative:'||NEW.owner_user_id
   AND child.type='ProjectCreated' AND json_extract(child.payload,'$.project_id')=NEW.project_id)
   OR NEW.parent_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM events parent WHERE parent.event_id=NEW.parent_declaration_ref
   AND parent.stream_id='creative:'||NEW.owner_user_id AND parent.type='ProjectCreated' AND json_extract(parent.payload,'$.project_id')=NEW.parent_project_id)
   THEN RAISE(ABORT,'project_containment_declaration') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM events compensation WHERE compensation.stream_id='creative:'||NEW.owner_user_id
   AND compensation.compensates_event_id IN(NEW.declaration_ref,NEW.parent_declaration_ref)) THEN RAISE(ABORT,'project_containment_compensated') END;
 SELECT CASE WHEN NEW.organization_id IS NULL AND EXISTS(SELECT 1 FROM organization_projects p WHERE p.owner_user_id=NEW.owner_user_id
   AND p.project_id IN(NEW.project_id,NEW.parent_project_id)) OR NEW.organization_id IS NOT NULL AND (
   NOT EXISTS(SELECT 1 FROM organization_projects p WHERE p.owner_user_id=NEW.owner_user_id AND p.project_id=NEW.project_id AND p.organization_id=NEW.organization_id AND p.status='active')
   OR NEW.parent_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_projects p WHERE p.owner_user_id=NEW.owner_user_id
     AND p.project_id=NEW.parent_project_id AND p.organization_id=NEW.organization_id AND p.status='active'))
   THEN RAISE(ABORT,'project_containment_custody') END;
END;

--> statement-breakpoint
CREATE TRIGGER project_containment_update AFTER UPDATE ON project_containment BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM project_containment WHERE owner_user_id=NEW.owner_user_id)>256 THEN RAISE(ABORT,'project_containment_capacity') END;
 SELECT CASE WHEN EXISTS(WITH RECURSIVE ancestry(project_id,parent_id,depth) AS (
   SELECT project_id,parent_project_id,1 FROM project_containment WHERE owner_user_id=NEW.owner_user_id
   UNION ALL SELECT parent.project_id,parent.parent_project_id,ancestry.depth+1
     FROM ancestry JOIN project_containment parent ON parent.owner_user_id=NEW.owner_user_id AND parent.project_id=ancestry.parent_id WHERE ancestry.depth<16
 ) SELECT 1 FROM ancestry WHERE depth=16 AND parent_id IS NOT NULL) THEN RAISE(ABORT,'project_containment_cycle_or_depth') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM events child WHERE child.event_id=NEW.declaration_ref AND child.stream_id='creative:'||NEW.owner_user_id
   AND child.type='ProjectCreated' AND json_extract(child.payload,'$.project_id')=NEW.project_id)
   OR NEW.parent_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM events parent WHERE parent.event_id=NEW.parent_declaration_ref
   AND parent.stream_id='creative:'||NEW.owner_user_id AND parent.type='ProjectCreated' AND json_extract(parent.payload,'$.project_id')=NEW.parent_project_id)
   THEN RAISE(ABORT,'project_containment_declaration') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM events compensation WHERE compensation.stream_id='creative:'||NEW.owner_user_id
   AND compensation.compensates_event_id IN(NEW.declaration_ref,NEW.parent_declaration_ref)) THEN RAISE(ABORT,'project_containment_compensated') END;
 SELECT CASE WHEN NEW.organization_id IS NULL AND EXISTS(SELECT 1 FROM organization_projects p WHERE p.owner_user_id=NEW.owner_user_id
   AND p.project_id IN(NEW.project_id,NEW.parent_project_id)) OR NEW.organization_id IS NOT NULL AND (
   NOT EXISTS(SELECT 1 FROM organization_projects p WHERE p.owner_user_id=NEW.owner_user_id AND p.project_id=NEW.project_id AND p.organization_id=NEW.organization_id AND p.status='active')
   OR NEW.parent_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_projects p WHERE p.owner_user_id=NEW.owner_user_id
     AND p.project_id=NEW.parent_project_id AND p.organization_id=NEW.organization_id AND p.status='active'))
   THEN RAISE(ABORT,'project_containment_custody') END;
END;

--> statement-breakpoint
CREATE TRIGGER project_containment_custody_insert AFTER INSERT ON organization_projects BEGIN
 DELETE FROM project_containment WHERE owner_user_id=NEW.owner_user_id AND (project_id=NEW.project_id OR parent_project_id=NEW.project_id);
END;

--> statement-breakpoint
CREATE TRIGGER project_containment_custody_update AFTER UPDATE ON organization_projects
WHEN (OLD.owner_user_id,OLD.project_id,OLD.organization_id,OLD.project_access_id,OLD.status) IS NOT (NEW.owner_user_id,NEW.project_id,NEW.organization_id,NEW.project_access_id,NEW.status) BEGIN
 DELETE FROM project_containment WHERE (owner_user_id=OLD.owner_user_id AND (project_id=OLD.project_id OR parent_project_id=OLD.project_id)) OR (owner_user_id=NEW.owner_user_id AND (project_id=NEW.project_id OR parent_project_id=NEW.project_id));
END;

--> statement-breakpoint
CREATE TRIGGER project_containment_custody_delete AFTER DELETE ON organization_projects BEGIN
 DELETE FROM project_containment WHERE owner_user_id=OLD.owner_user_id AND (project_id=OLD.project_id OR parent_project_id=OLD.project_id);
END;

--> statement-breakpoint
CREATE TRIGGER project_containment_declaration_update AFTER UPDATE ON events BEGIN
 DELETE FROM project_containment WHERE declaration_ref=OLD.event_id OR parent_declaration_ref=OLD.event_id;
END;
--> statement-breakpoint
CREATE TRIGGER project_containment_compensation AFTER INSERT ON events WHEN NEW.compensates_event_id IS NOT NULL BEGIN
 DELETE FROM project_containment WHERE declaration_ref=NEW.compensates_event_id OR parent_declaration_ref=NEW.compensates_event_id;
END;
