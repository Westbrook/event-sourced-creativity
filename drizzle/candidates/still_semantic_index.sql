CREATE TABLE IF NOT EXISTS creation_index_block_routes(partition_key TEXT NOT NULL,generation INTEGER NOT NULL,block_id TEXT NOT NULL,project_id TEXT NOT NULL,safe_foreign INTEGER NOT NULL,created INTEGER NOT NULL,removed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(partition_key,generation,block_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_replay_skeletons(partition_key TEXT NOT NULL,generation INTEGER NOT NULL,entity_id TEXT NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(partition_key,generation,entity_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_enrollments(custody TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,policy_epoch TEXT NOT NULL,expires INTEGER NOT NULL,daily_token_limit INTEGER NOT NULL CHECK(daily_token_limit>0));
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_enrollment_inserted AFTER INSERT ON creation_index_enrollments BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE custody=NEW.custody; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_enrollment_changed AFTER UPDATE ON creation_index_enrollments BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE custody=NEW.custody OR custody=OLD.custody; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_enrollment_deleted AFTER DELETE ON creation_index_enrollments BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE custody=OLD.custody; END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_fences(id INTEGER NOT NULL CHECK(id=1));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_work(job_key TEXT PRIMARY KEY,kind TEXT NOT NULL,partition_key TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 0,cursor TEXT NOT NULL DEFAULT '',priority INTEGER NOT NULL DEFAULT 5,due INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'ready',error_class TEXT,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL DEFAULT(unixepoch()),touched INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_index_due ON creation_index_work(state,due,priority,touched);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_discovery(scope_key TEXT PRIMARY KEY,generation INTEGER NOT NULL DEFAULT 1,cursor TEXT NOT NULL DEFAULT '',touched INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_projection(partition_key TEXT NOT NULL,generation INTEGER NOT NULL,entity_id TEXT NOT NULL,kind TEXT NOT NULL,content_id TEXT NOT NULL,PRIMARY KEY(partition_key,generation,entity_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_index_private_kind ON private_content(kind,content_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_index_projection_content ON creation_index_projection(content_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_index_record_content ON creation_search_records(content_id,tombstone);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_sources(partition_key TEXT NOT NULL,source_id TEXT NOT NULL,generation INTEGER NOT NULL,revision TEXT NOT NULL,representation TEXT NOT NULL,expected INTEGER,completed INTEGER NOT NULL DEFAULT 0,cursor INTEGER NOT NULL DEFAULT 0,published INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL,PRIMARY KEY(partition_key,source_id,representation));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_objects(object_key TEXT PRIMARY KEY,partition_key TEXT NOT NULL,generation INTEGER NOT NULL,source_id TEXT NOT NULL,revision TEXT NOT NULL,representation TEXT NOT NULL,checksum TEXT NOT NULL,byte_count INTEGER NOT NULL,passages_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'intent',lease_token TEXT NOT NULL,write_until INTEGER NOT NULL,expires INTEGER NOT NULL,erase_due INTEGER,erased_at INTEGER);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_members(object_key TEXT NOT NULL,source_id TEXT NOT NULL,revision TEXT NOT NULL,vector_offset INTEGER NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,PRIMARY KEY(object_key,vector_offset));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_index_members_source ON creation_index_members(source_id,object_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_index_objects_partition ON creation_index_objects(partition_key,generation,source_id,state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creation_index_objects_erasure ON creation_index_objects(state,erase_due,write_until);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_runs(run_id TEXT PRIMARY KEY,trigger_kind TEXT NOT NULL,deployment TEXT NOT NULL,started INTEGER NOT NULL,ended INTEGER,outcome TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0,retried INTEGER NOT NULL DEFAULT 0,held INTEGER NOT NULL DEFAULT 0,bytes INTEGER NOT NULL DEFAULT 0,tokens INTEGER NOT NULL DEFAULT 0,provider_attempts INTEGER NOT NULL DEFAULT 0,error_class TEXT);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_index_attempts(attempt_id TEXT PRIMARY KEY,job_key TEXT NOT NULL,lease_token TEXT NOT NULL,custody TEXT NOT NULL,token_reservation INTEGER NOT NULL,reserved INTEGER NOT NULL,finished INTEGER,tokens INTEGER,outcome TEXT NOT NULL DEFAULT 'uncertain');
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_admit_events_insert AFTER INSERT ON events WHEN substr(NEW.stream_id,1,9)='creative:' AND (substr(NEW.type,1,5)='Block' OR substr(NEW.type,1,8)='Document' OR substr(NEW.type,1,7)='Project') AND NEW.type NOT IN('ProjectOpened','DocumentOpened') BEGIN INSERT INTO creation_index_discovery(scope_key) VALUES(NEW.stream_id) ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_projects_insert AFTER INSERT ON organization_projects BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_memberships_insert AFTER INSERT ON organization_memberships BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_project_memberships_insert AFTER INSERT ON project_memberships BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_project_migration_states_insert AFTER INSERT ON project_migration_states BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organizations_insert AFTER INSERT ON organizations BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_capability_grants_insert AFTER INSERT ON capability_grants BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_security_policies_insert AFTER INSERT ON organization_security_policies BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_identity_bindings_insert AFTER INSERT ON organization_identity_bindings BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_retention_policies_insert AFTER INSERT ON organization_retention_policies BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_admit_events_update AFTER UPDATE ON events WHEN substr(NEW.stream_id,1,9)='creative:' AND (substr(NEW.type,1,5)='Block' OR substr(NEW.type,1,8)='Document' OR substr(NEW.type,1,7)='Project') AND NEW.type NOT IN('ProjectOpened','DocumentOpened') BEGIN INSERT INTO creation_index_discovery(scope_key) VALUES(NEW.stream_id) ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_projects_update AFTER UPDATE ON organization_projects BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_memberships_update AFTER UPDATE ON organization_memberships BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_project_memberships_update AFTER UPDATE ON project_memberships BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_project_migration_states_update AFTER UPDATE ON project_migration_states BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organizations_update AFTER UPDATE ON organizations BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_capability_grants_update AFTER UPDATE ON capability_grants BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_security_policies_update AFTER UPDATE ON organization_security_policies BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_identity_bindings_update AFTER UPDATE ON organization_identity_bindings BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_retention_policies_update AFTER UPDATE ON organization_retention_policies BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_admit_events_delete AFTER DELETE ON events WHEN substr(OLD.stream_id,1,9)='creative:' AND (substr(OLD.type,1,5)='Block' OR substr(OLD.type,1,8)='Document' OR substr(OLD.type,1,7)='Project') AND OLD.type NOT IN('ProjectOpened','DocumentOpened') BEGIN INSERT INTO creation_index_discovery(scope_key) VALUES(OLD.stream_id) ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_projects_delete AFTER DELETE ON organization_projects BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_memberships_delete AFTER DELETE ON organization_memberships BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_project_memberships_delete AFTER DELETE ON project_memberships BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_project_migration_states_delete AFTER DELETE ON project_migration_states BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organizations_delete AFTER DELETE ON organizations BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_capability_grants_delete AFTER DELETE ON capability_grants BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_security_policies_delete AFTER DELETE ON organization_security_policies BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_identity_bindings_delete AFTER DELETE ON organization_identity_bindings BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_policy_organization_retention_policies_delete AFTER DELETE ON organization_retention_policies BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1; INSERT INTO creation_index_discovery(scope_key) VALUES('*') ON CONFLICT(scope_key) DO UPDATE SET generation=generation+1,cursor='',touched=0; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_owner_changed AFTER UPDATE OF role,email,consent_version,consented_at ON users WHEN NEW.role IS NOT OLD.role OR NEW.email IS NOT OLD.email OR NEW.consent_version IS NOT OLD.consent_version OR NEW.consented_at IS NOT OLD.consented_at BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE owner_id=NEW.user_id; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_owner_deleted AFTER DELETE ON users BEGIN UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE owner_id=OLD.user_id; END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS creation_index_partition_changed;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_partition_changed AFTER UPDATE OF index_version ON creation_search_partitions WHEN NEW.index_version<>OLD.index_version BEGIN INSERT INTO creation_index_work(job_key,kind,partition_key,generation,priority) VALUES('projection:'||NEW.partition_key,'projection',NEW.partition_key,NEW.index_version,5) ON CONFLICT(job_key) DO UPDATE SET generation=excluded.generation,cursor='',state='ready',due=0,attempts=0,error_class=NULL,lease_token=NULL,lease_until=0; UPDATE creation_index_objects SET state='retired',erase_due=MIN(COALESCE(erase_due,unixepoch()+900),unixepoch()+900) WHERE partition_key=NEW.partition_key AND state<>'erased'; UPDATE creation_index_sources SET published=0 WHERE partition_key=NEW.partition_key; UPDATE creation_index_work SET state='done',lease_token=NULL,lease_until=0,error_class='generation_superseded' WHERE partition_key=NEW.partition_key AND generation<>NEW.index_version; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_index_partition_insert AFTER INSERT ON creation_search_partitions BEGIN INSERT OR IGNORE INTO creation_index_work(job_key,kind,partition_key,generation,priority) VALUES('projection:'||NEW.partition_key,'projection',NEW.partition_key,NEW.index_version,5); END;
