-- Explicit cross-owner organization edges. No grants, enrollment or backfill.
CREATE TABLE organization_project_nesting (
 owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 declaration_ref TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
 parent_owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 parent_project_id TEXT NOT NULL,
 parent_declaration_ref TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
 organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
 revision TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_user_id,project_id),
 CHECK(owner_user_id<>parent_owner_user_id)
);
--> statement-breakpoint
CREATE INDEX idx_organization_project_nesting_org ON organization_project_nesting(organization_id);
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_insert AFTER INSERT ON organization_project_nesting BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM organization_project_nesting WHERE organization_id=NEW.organization_id)>256 THEN RAISE(ABORT,'organization_nesting_capacity') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM project_containment WHERE owner_user_id=NEW.owner_user_id AND project_id=NEW.project_id AND parent_project_id IS NOT NULL) THEN RAISE(ABORT,'organization_nesting_duplicate_parent') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM events c JOIN events p ON p.event_id=NEW.parent_declaration_ref
  WHERE c.event_id=NEW.declaration_ref AND c.type='ProjectCreated' AND c.stream_id='creative:'||NEW.owner_user_id AND json_extract(c.payload,'$.project_id')=NEW.project_id
  AND p.type='ProjectCreated' AND p.stream_id='creative:'||NEW.parent_owner_user_id AND json_extract(p.payload,'$.project_id')=NEW.parent_project_id)
  OR EXISTS(SELECT 1 FROM events WHERE compensates_event_id IN(NEW.declaration_ref,NEW.parent_declaration_ref)) THEN RAISE(ABORT,'organization_nesting_declaration') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM organization_projects c JOIN organization_projects p ON p.organization_id=c.organization_id
  JOIN project_migration_states cm ON cm.project_access_id=c.project_access_id AND cm.organization_id=c.organization_id AND cm.owner_user_id=c.owner_user_id AND cm.status='active'
  JOIN project_migration_states pm ON pm.project_access_id=p.project_access_id AND pm.organization_id=p.organization_id AND pm.owner_user_id=p.owner_user_id AND pm.status='active'
  WHERE c.owner_user_id=NEW.owner_user_id AND c.project_id=NEW.project_id AND c.organization_id=NEW.organization_id AND c.status='active'
  AND p.owner_user_id=NEW.parent_owner_user_id AND p.project_id=NEW.parent_project_id AND p.status='active') THEN RAISE(ABORT,'organization_nesting_custody') END;
 SELECT CASE WHEN EXISTS(WITH RECURSIVE edges(owner,id,parent_owner,parent_id) AS (
 SELECT owner_user_id,project_id,owner_user_id,parent_project_id FROM project_containment WHERE organization_id=NEW.organization_id AND parent_project_id IS NOT NULL
 UNION ALL SELECT owner_user_id,project_id,parent_owner_user_id,parent_project_id FROM organization_project_nesting WHERE organization_id=NEW.organization_id),
 ancestry(owner,id,parent_owner,parent_id,depth) AS (
 SELECT owner,id,parent_owner,parent_id,1 FROM edges
 UNION ALL SELECT e.owner,e.id,e.parent_owner,e.parent_id,a.depth+1 FROM ancestry a JOIN edges e ON e.owner=a.parent_owner AND e.id=a.parent_id WHERE a.depth<16)
 SELECT 1 FROM ancestry WHERE depth=16) THEN RAISE(ABORT,'organization_nesting_cycle_or_depth') END;
 UPDATE memory_derivation_contexts SET state='dismissed' WHERE state='accepted' AND source_enrollment_id<>target_enrollment_id AND source_enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE organization_id=NEW.organization_id);
END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_immutable BEFORE UPDATE ON organization_project_nesting BEGIN SELECT RAISE(ABORT,'organization_nesting_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_retire AFTER DELETE ON organization_project_nesting BEGIN UPDATE memory_derivation_contexts SET state='dismissed' WHERE state='accepted' AND source_enrollment_id<>target_enrollment_id AND source_enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE organization_id=OLD.organization_id); END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_local_insert AFTER INSERT ON project_containment BEGIN
 DELETE FROM organization_project_nesting WHERE owner_user_id=NEW.owner_user_id AND project_id=NEW.project_id;
 SELECT CASE WHEN EXISTS(WITH RECURSIVE edges(owner,id,parent_owner,parent_id) AS (
 SELECT owner_user_id,project_id,owner_user_id,parent_project_id FROM project_containment WHERE organization_id=NEW.organization_id AND parent_project_id IS NOT NULL
 UNION ALL SELECT owner_user_id,project_id,parent_owner_user_id,parent_project_id FROM organization_project_nesting WHERE organization_id=NEW.organization_id),
 ancestry(owner,id,parent_owner,parent_id,depth) AS (
 SELECT owner,id,parent_owner,parent_id,1 FROM edges
 UNION ALL SELECT e.owner,e.id,e.parent_owner,e.parent_id,a.depth+1 FROM ancestry a JOIN edges e ON e.owner=a.parent_owner AND e.id=a.parent_id WHERE a.depth<16)
 SELECT 1 FROM ancestry WHERE depth=16) THEN RAISE(ABORT,'organization_nesting_cycle_or_depth') END;
 UPDATE memory_derivation_contexts SET state='dismissed' WHERE state='accepted' AND source_enrollment_id<>target_enrollment_id AND source_enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE organization_id=NEW.organization_id);
 END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_local_update AFTER UPDATE ON project_containment BEGIN
 DELETE FROM organization_project_nesting WHERE owner_user_id=NEW.owner_user_id AND project_id=NEW.project_id;
 SELECT CASE WHEN EXISTS(WITH RECURSIVE edges(owner,id,parent_owner,parent_id) AS (
 SELECT owner_user_id,project_id,owner_user_id,parent_project_id FROM project_containment WHERE organization_id=NEW.organization_id AND parent_project_id IS NOT NULL
 UNION ALL SELECT owner_user_id,project_id,parent_owner_user_id,parent_project_id FROM organization_project_nesting WHERE organization_id=NEW.organization_id),
 ancestry(owner,id,parent_owner,parent_id,depth) AS (
 SELECT owner,id,parent_owner,parent_id,1 FROM edges
 UNION ALL SELECT e.owner,e.id,e.parent_owner,e.parent_id,a.depth+1 FROM ancestry a JOIN edges e ON e.owner=a.parent_owner AND e.id=a.parent_id WHERE a.depth<16)
 SELECT 1 FROM ancestry WHERE depth=16) THEN RAISE(ABORT,'organization_nesting_cycle_or_depth') END;
 UPDATE memory_derivation_contexts SET state='dismissed' WHERE state='accepted' AND source_enrollment_id<>target_enrollment_id AND source_enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE organization_id=NEW.organization_id);
 END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_custody_insert AFTER INSERT ON organization_projects BEGIN DELETE FROM organization_project_nesting WHERE (owner_user_id=NEW.owner_user_id AND project_id=NEW.project_id OR parent_owner_user_id=NEW.owner_user_id AND parent_project_id=NEW.project_id); END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_custody_update AFTER UPDATE ON organization_projects WHEN (OLD.owner_user_id,OLD.project_id,OLD.organization_id,OLD.project_access_id,OLD.status) IS NOT (NEW.owner_user_id,NEW.project_id,NEW.organization_id,NEW.project_access_id,NEW.status) BEGIN DELETE FROM organization_project_nesting WHERE (owner_user_id=OLD.owner_user_id AND project_id=OLD.project_id OR parent_owner_user_id=OLD.owner_user_id AND parent_project_id=OLD.project_id) OR (owner_user_id=NEW.owner_user_id AND project_id=NEW.project_id OR parent_owner_user_id=NEW.owner_user_id AND parent_project_id=NEW.project_id); END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_custody_delete AFTER DELETE ON organization_projects BEGIN DELETE FROM organization_project_nesting WHERE (owner_user_id=OLD.owner_user_id AND project_id=OLD.project_id OR parent_owner_user_id=OLD.owner_user_id AND parent_project_id=OLD.project_id); END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_declaration AFTER UPDATE ON events BEGIN DELETE FROM organization_project_nesting WHERE declaration_ref=OLD.event_id OR parent_declaration_ref=OLD.event_id; END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_compensation AFTER INSERT ON events WHEN NEW.compensates_event_id IS NOT NULL BEGIN DELETE FROM organization_project_nesting WHERE declaration_ref=NEW.compensates_event_id OR parent_declaration_ref=NEW.compensates_event_id; END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_local_delete AFTER DELETE ON project_containment BEGIN
 UPDATE memory_derivation_contexts SET state='dismissed' WHERE state='accepted' AND source_enrollment_id<>target_enrollment_id AND source_enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE organization_id=OLD.organization_id);
END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_migration_update AFTER UPDATE ON project_migration_states
WHEN (OLD.organization_id,OLD.owner_user_id,OLD.project_access_id,OLD.status) IS NOT (NEW.organization_id,NEW.owner_user_id,NEW.project_access_id,NEW.status) BEGIN
 DELETE FROM organization_project_nesting WHERE organization_id IN(OLD.organization_id,NEW.organization_id);
END;
--> statement-breakpoint
CREATE TRIGGER organization_project_nesting_migration_delete AFTER DELETE ON project_migration_states BEGIN
 DELETE FROM organization_project_nesting WHERE organization_id=OLD.organization_id;
END;
