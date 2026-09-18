-- PENDING: not journaled, installed, or approved for hosted deployment.
-- Extends exact 0032 only: reference-only ledgers may have zero declarations.
-- Submit EVERY statement below in ONE atomic D1 batch (or one SQLite transaction).
-- Never execute as individually committed statements. The caller must stop and roll
-- back on any failure. No transaction commands, writable_schema, FK disabling, or
-- runtime auto-migration are used. Local workerd tests do not qualify hosted tooling.
-- Existing rows/rowids and all other constraints/indexes/FKs are preserved exactly;
-- unknown target schemas, dependencies, triggers, and staging collisions fail closed.
CREATE TABLE main."__memory_conversation_capture_guard"(token TEXT PRIMARY KEY NOT NULL);
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN ((SELECT foreign_keys FROM pragma_foreign_keys)=1 AND (SELECT defer_foreign_keys FROM pragma_defer_foreign_keys)=0 AND (SELECT ignore_check_constraints FROM pragma_ignore_check_constraints)=0 AND (SELECT legacy_alter_table FROM pragma_legacy_alter_table)=0 AND NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)) THEN 'caller-settings' ELSE NULL END;
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN (NOT EXISTS(SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(tbl_name) IN('memory_structured_conversation_heads','memory_structured_conversation_revisions') EXCEPT SELECT * FROM (VALUES ('index','idx_memory_structured_heads_cleanup','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_cleanup` ON `memory_structured_conversation_heads` (`state`,`expires_at`,`ledger_id`)'),('index','idx_memory_structured_heads_enrollment','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_enrollment` ON `memory_structured_conversation_heads` (`enrollment_id`,`state`)'),('index','idx_memory_structured_heads_organization','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_organization` ON `memory_structured_conversation_heads` (`organization_id`,`actor_user_id`)'),('index','idx_memory_structured_heads_personal','memory_structured_conversation_heads','CREATE UNIQUE INDEX `idx_memory_structured_heads_personal` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`project_id`,`document_id`) WHERE organization_id IS NULL'),('index','idx_memory_structured_heads_shared','memory_structured_conversation_heads','CREATE UNIQUE INDEX `idx_memory_structured_heads_shared` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`organization_id`,`project_access_id`,`project_id`,`document_id`) WHERE organization_id IS NOT NULL'),('index','idx_memory_structured_revisions_body','memory_structured_conversation_revisions','CREATE UNIQUE INDEX `idx_memory_structured_revisions_body` ON `memory_structured_conversation_revisions` (`body_ref`)'),('index','idx_memory_structured_revisions_expiry','memory_structured_conversation_revisions','CREATE INDEX `idx_memory_structured_revisions_expiry` ON `memory_structured_conversation_revisions` (`expires_at`,`ledger_id`,`revision`)'),('table','memory_structured_conversation_heads','memory_structured_conversation_heads','CREATE TABLE `memory_structured_conversation_heads` (
	`ledger_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`enrollment_id` text,
	`enrollment_revision` integer,
	`permission_epoch` text,
	`policy_version` text,
	`storage_revision` integer NOT NULL,
	`current_body_ref` text,
	`current_body_hash` text,
	`annotation_count` integer,
	`coverage_after_sequence` integer,
	`coverage_through_sequence` integer,
	`state` text NOT NULL,
	`first_terminal_at` text,
	`cleanup_turn` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "memory_structured_heads_key" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB ''*[^0-9a-f]*''),
	CONSTRAINT "memory_structured_heads_scope" CHECK(length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))),
	CONSTRAINT "memory_structured_heads_counters" CHECK(typeof(storage_revision)=''integer'' AND storage_revision BETWEEN 1 AND 9007199254740991 AND typeof(cleanup_turn)=''integer'' AND cleanup_turn BETWEEN 0 AND 3 AND (state!=''retired'' OR cleanup_turn=0)),
	CONSTRAINT "memory_structured_heads_times" CHECK(length(created_at)>0 AND created_at<=updated_at AND (first_terminal_at IS NULL OR (created_at<=first_terminal_at AND first_terminal_at<=updated_at))),
	CONSTRAINT "memory_structured_heads_state" CHECK((state=''active'' AND first_terminal_at IS NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND current_body_ref IS NOT NULL AND current_body_hash IS NOT NULL AND annotation_count IS NOT NULL AND coverage_after_sequence IS NOT NULL AND coverage_through_sequence IS NOT NULL AND expires_at IS NOT NULL) OR (state IN(''retiring'',''retired'') AND first_terminal_at IS NOT NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND current_body_ref IS NULL AND current_body_hash IS NULL AND annotation_count IS NULL AND coverage_after_sequence IS NULL AND coverage_through_sequence IS NULL AND expires_at IS NULL)),
	CONSTRAINT "memory_structured_heads_active" CHECK(state!=''active'' OR (storage_revision BETWEEN 1 AND 64 AND length(enrollment_id)>0 AND typeof(enrollment_revision)=''integer'' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND length(permission_epoch)>0 AND length(policy_version)>0 AND length(current_body_ref)>0 AND length(current_body_hash)=64 AND current_body_hash NOT GLOB ''*[^0-9a-f]*'' AND typeof(annotation_count)=''integer'' AND annotation_count BETWEEN 1 AND 256 AND typeof(coverage_after_sequence)=''integer'' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)=''integer'' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence AND created_at<expires_at))
)'),('table','memory_structured_conversation_revisions','memory_structured_conversation_revisions','CREATE TABLE `memory_structured_conversation_revisions` (
	`ledger_id` text NOT NULL,
	`revision` integer NOT NULL,
	`predecessor_revision` integer NOT NULL,
	`predecessor_hash` text,
	`body_ref` text NOT NULL,
	`body_hash` text NOT NULL,
	`schema_version` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`annotation_count` integer NOT NULL,
	`coverage_after_sequence` integer NOT NULL,
	`coverage_through_sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`ledger_id`, `revision`),
	FOREIGN KEY (`ledger_id`) REFERENCES `memory_structured_conversation_heads`(`ledger_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_structured_revisions_version" CHECK(typeof(schema_version)=''integer'' AND schema_version=1 AND recipe_version=''native-declared-ledger-v1''),
	CONSTRAINT "memory_structured_revisions_identity" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB ''*[^0-9a-f]*'' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB ''*[^0-9a-f]*''),
	CONSTRAINT "memory_structured_revisions_chain" CHECK(typeof(revision)=''integer'' AND revision BETWEEN 1 AND 64 AND typeof(predecessor_revision)=''integer'' AND ((revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (revision>1 AND predecessor_revision=revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB ''*[^0-9a-f]*''))),
	CONSTRAINT "memory_structured_revisions_bounds" CHECK(typeof(annotation_count)=''integer'' AND annotation_count BETWEEN 1 AND 256 AND typeof(coverage_after_sequence)=''integer'' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)=''integer'' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence),
	CONSTRAINT "memory_structured_revisions_times" CHECK(length(created_at)>0 AND created_at<expires_at)
)'),('index','sqlite_autoindex_memory_structured_conversation_heads_1','memory_structured_conversation_heads',NULL),('index','sqlite_autoindex_memory_structured_conversation_revisions_1','memory_structured_conversation_revisions',NULL))) AND NOT EXISTS(SELECT * FROM (VALUES ('index','idx_memory_structured_heads_cleanup','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_cleanup` ON `memory_structured_conversation_heads` (`state`,`expires_at`,`ledger_id`)'),('index','idx_memory_structured_heads_enrollment','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_enrollment` ON `memory_structured_conversation_heads` (`enrollment_id`,`state`)'),('index','idx_memory_structured_heads_organization','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_organization` ON `memory_structured_conversation_heads` (`organization_id`,`actor_user_id`)'),('index','idx_memory_structured_heads_personal','memory_structured_conversation_heads','CREATE UNIQUE INDEX `idx_memory_structured_heads_personal` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`project_id`,`document_id`) WHERE organization_id IS NULL'),('index','idx_memory_structured_heads_shared','memory_structured_conversation_heads','CREATE UNIQUE INDEX `idx_memory_structured_heads_shared` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`organization_id`,`project_access_id`,`project_id`,`document_id`) WHERE organization_id IS NOT NULL'),('index','idx_memory_structured_revisions_body','memory_structured_conversation_revisions','CREATE UNIQUE INDEX `idx_memory_structured_revisions_body` ON `memory_structured_conversation_revisions` (`body_ref`)'),('index','idx_memory_structured_revisions_expiry','memory_structured_conversation_revisions','CREATE INDEX `idx_memory_structured_revisions_expiry` ON `memory_structured_conversation_revisions` (`expires_at`,`ledger_id`,`revision`)'),('table','memory_structured_conversation_heads','memory_structured_conversation_heads','CREATE TABLE `memory_structured_conversation_heads` (
	`ledger_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`enrollment_id` text,
	`enrollment_revision` integer,
	`permission_epoch` text,
	`policy_version` text,
	`storage_revision` integer NOT NULL,
	`current_body_ref` text,
	`current_body_hash` text,
	`annotation_count` integer,
	`coverage_after_sequence` integer,
	`coverage_through_sequence` integer,
	`state` text NOT NULL,
	`first_terminal_at` text,
	`cleanup_turn` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "memory_structured_heads_key" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB ''*[^0-9a-f]*''),
	CONSTRAINT "memory_structured_heads_scope" CHECK(length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))),
	CONSTRAINT "memory_structured_heads_counters" CHECK(typeof(storage_revision)=''integer'' AND storage_revision BETWEEN 1 AND 9007199254740991 AND typeof(cleanup_turn)=''integer'' AND cleanup_turn BETWEEN 0 AND 3 AND (state!=''retired'' OR cleanup_turn=0)),
	CONSTRAINT "memory_structured_heads_times" CHECK(length(created_at)>0 AND created_at<=updated_at AND (first_terminal_at IS NULL OR (created_at<=first_terminal_at AND first_terminal_at<=updated_at))),
	CONSTRAINT "memory_structured_heads_state" CHECK((state=''active'' AND first_terminal_at IS NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND current_body_ref IS NOT NULL AND current_body_hash IS NOT NULL AND annotation_count IS NOT NULL AND coverage_after_sequence IS NOT NULL AND coverage_through_sequence IS NOT NULL AND expires_at IS NOT NULL) OR (state IN(''retiring'',''retired'') AND first_terminal_at IS NOT NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND current_body_ref IS NULL AND current_body_hash IS NULL AND annotation_count IS NULL AND coverage_after_sequence IS NULL AND coverage_through_sequence IS NULL AND expires_at IS NULL)),
	CONSTRAINT "memory_structured_heads_active" CHECK(state!=''active'' OR (storage_revision BETWEEN 1 AND 64 AND length(enrollment_id)>0 AND typeof(enrollment_revision)=''integer'' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND length(permission_epoch)>0 AND length(policy_version)>0 AND length(current_body_ref)>0 AND length(current_body_hash)=64 AND current_body_hash NOT GLOB ''*[^0-9a-f]*'' AND typeof(annotation_count)=''integer'' AND annotation_count BETWEEN 1 AND 256 AND typeof(coverage_after_sequence)=''integer'' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)=''integer'' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence AND created_at<expires_at))
)'),('table','memory_structured_conversation_revisions','memory_structured_conversation_revisions','CREATE TABLE `memory_structured_conversation_revisions` (
	`ledger_id` text NOT NULL,
	`revision` integer NOT NULL,
	`predecessor_revision` integer NOT NULL,
	`predecessor_hash` text,
	`body_ref` text NOT NULL,
	`body_hash` text NOT NULL,
	`schema_version` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`annotation_count` integer NOT NULL,
	`coverage_after_sequence` integer NOT NULL,
	`coverage_through_sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`ledger_id`, `revision`),
	FOREIGN KEY (`ledger_id`) REFERENCES `memory_structured_conversation_heads`(`ledger_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_structured_revisions_version" CHECK(typeof(schema_version)=''integer'' AND schema_version=1 AND recipe_version=''native-declared-ledger-v1''),
	CONSTRAINT "memory_structured_revisions_identity" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB ''*[^0-9a-f]*'' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB ''*[^0-9a-f]*''),
	CONSTRAINT "memory_structured_revisions_chain" CHECK(typeof(revision)=''integer'' AND revision BETWEEN 1 AND 64 AND typeof(predecessor_revision)=''integer'' AND ((revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (revision>1 AND predecessor_revision=revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB ''*[^0-9a-f]*''))),
	CONSTRAINT "memory_structured_revisions_bounds" CHECK(typeof(annotation_count)=''integer'' AND annotation_count BETWEEN 1 AND 256 AND typeof(coverage_after_sequence)=''integer'' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)=''integer'' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence),
	CONSTRAINT "memory_structured_revisions_times" CHECK(length(created_at)>0 AND created_at<expires_at)
)'),('index','sqlite_autoindex_memory_structured_conversation_heads_1','memory_structured_conversation_heads',NULL),('index','sqlite_autoindex_memory_structured_conversation_revisions_1','memory_structured_conversation_revisions',NULL)) EXCEPT SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(tbl_name) IN('memory_structured_conversation_heads','memory_structured_conversation_revisions'))) THEN 'exact-original-0032' ELSE NULL END;
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN (NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name) NOT IN('memory_structured_conversation_heads','memory_structured_conversation_revisions') AND (instr(lower(sql),'memory_structured_conversation_heads')>0 OR instr(lower(sql),'memory_structured_conversation_revisions')>0)) AND NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE name<>'__memory_conversation_capture_guard' AND (instr(lower(sql),'__memory_conversation_capture_heads')>0 OR lower(name)='__memory_conversation_capture_heads' OR instr(lower(sql),'__memory_conversation_capture_revisions')>0 OR lower(name)='__memory_conversation_capture_revisions' OR instr(lower(sql),'__memory_conversation_capture_guard')>0 OR lower(name)='__memory_conversation_capture_guard'))) THEN 'no-unknown-dependents' ELSE NULL END;
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN (NOT EXISTS(SELECT child.name,fk.[table],fk.seq,fk.[from],fk.[to],fk.on_update,fk.on_delete,fk.[match] FROM main.sqlite_schema child,pragma_foreign_key_list(child.name,'main') fk WHERE child.type='table' AND instr(lower(child.sql),'references')>0 AND lower(fk.[table]) IN('memory_structured_conversation_heads','memory_structured_conversation_revisions') EXCEPT SELECT * FROM (VALUES ('memory_structured_conversation_revisions','memory_structured_conversation_heads',0,'ledger_id','ledger_id','NO ACTION','NO ACTION','NONE'))) AND NOT EXISTS(SELECT * FROM (VALUES ('memory_structured_conversation_revisions','memory_structured_conversation_heads',0,'ledger_id','ledger_id','NO ACTION','NO ACTION','NONE')) EXCEPT SELECT child.name,fk.[table],fk.seq,fk.[from],fk.[to],fk.on_update,fk.on_delete,fk.[match] FROM main.sqlite_schema child,pragma_foreign_key_list(child.name,'main') fk WHERE child.type='table' AND instr(lower(child.sql),'references')>0 AND lower(fk.[table]) IN('memory_structured_conversation_heads','memory_structured_conversation_revisions')) AND (SELECT COUNT(*) FROM (SELECT child.name,fk.[table],fk.seq,fk.[from],fk.[to],fk.on_update,fk.on_delete,fk.[match] FROM main.sqlite_schema child,pragma_foreign_key_list(child.name,'main') fk WHERE child.type='table' AND instr(lower(child.sql),'references')>0 AND lower(fk.[table]) IN('memory_structured_conversation_heads','memory_structured_conversation_revisions')))=1) THEN 'exact-inbound-keys' ELSE NULL END;
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN (NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)) THEN 'foreign-keys-before' ELSE NULL END;
--> statement-breakpoint
CREATE TABLE main."__memory_conversation_capture_heads" AS SELECT rowid AS original_rowid,* FROM main."memory_structured_conversation_heads";
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN ((SELECT COUNT(*) FROM main."memory_structured_conversation_heads")=(SELECT COUNT(*) FROM main."__memory_conversation_capture_heads") AND NOT EXISTS(SELECT typeof("rowid"),"rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("actor_user_id"),"actor_user_id" COLLATE BINARY,typeof("owner_user_id"),"owner_user_id" COLLATE BINARY,typeof("organization_id"),"organization_id" COLLATE BINARY,typeof("project_access_id"),"project_access_id" COLLATE BINARY,typeof("project_id"),"project_id" COLLATE BINARY,typeof("document_id"),"document_id" COLLATE BINARY,typeof("enrollment_id"),"enrollment_id" COLLATE BINARY,typeof("enrollment_revision"),"enrollment_revision" COLLATE BINARY,typeof("permission_epoch"),"permission_epoch" COLLATE BINARY,typeof("policy_version"),"policy_version" COLLATE BINARY,typeof("storage_revision"),"storage_revision" COLLATE BINARY,typeof("current_body_ref"),"current_body_ref" COLLATE BINARY,typeof("current_body_hash"),"current_body_hash" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("state"),"state" COLLATE BINARY,typeof("first_terminal_at"),"first_terminal_at" COLLATE BINARY,typeof("cleanup_turn"),"cleanup_turn" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("updated_at"),"updated_at" COLLATE BINARY FROM main."memory_structured_conversation_heads" EXCEPT SELECT typeof("original_rowid"),"original_rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("actor_user_id"),"actor_user_id" COLLATE BINARY,typeof("owner_user_id"),"owner_user_id" COLLATE BINARY,typeof("organization_id"),"organization_id" COLLATE BINARY,typeof("project_access_id"),"project_access_id" COLLATE BINARY,typeof("project_id"),"project_id" COLLATE BINARY,typeof("document_id"),"document_id" COLLATE BINARY,typeof("enrollment_id"),"enrollment_id" COLLATE BINARY,typeof("enrollment_revision"),"enrollment_revision" COLLATE BINARY,typeof("permission_epoch"),"permission_epoch" COLLATE BINARY,typeof("policy_version"),"policy_version" COLLATE BINARY,typeof("storage_revision"),"storage_revision" COLLATE BINARY,typeof("current_body_ref"),"current_body_ref" COLLATE BINARY,typeof("current_body_hash"),"current_body_hash" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("state"),"state" COLLATE BINARY,typeof("first_terminal_at"),"first_terminal_at" COLLATE BINARY,typeof("cleanup_turn"),"cleanup_turn" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("updated_at"),"updated_at" COLLATE BINARY FROM main."__memory_conversation_capture_heads") AND NOT EXISTS(SELECT typeof("original_rowid"),"original_rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("actor_user_id"),"actor_user_id" COLLATE BINARY,typeof("owner_user_id"),"owner_user_id" COLLATE BINARY,typeof("organization_id"),"organization_id" COLLATE BINARY,typeof("project_access_id"),"project_access_id" COLLATE BINARY,typeof("project_id"),"project_id" COLLATE BINARY,typeof("document_id"),"document_id" COLLATE BINARY,typeof("enrollment_id"),"enrollment_id" COLLATE BINARY,typeof("enrollment_revision"),"enrollment_revision" COLLATE BINARY,typeof("permission_epoch"),"permission_epoch" COLLATE BINARY,typeof("policy_version"),"policy_version" COLLATE BINARY,typeof("storage_revision"),"storage_revision" COLLATE BINARY,typeof("current_body_ref"),"current_body_ref" COLLATE BINARY,typeof("current_body_hash"),"current_body_hash" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("state"),"state" COLLATE BINARY,typeof("first_terminal_at"),"first_terminal_at" COLLATE BINARY,typeof("cleanup_turn"),"cleanup_turn" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("updated_at"),"updated_at" COLLATE BINARY FROM main."__memory_conversation_capture_heads" EXCEPT SELECT typeof("rowid"),"rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("actor_user_id"),"actor_user_id" COLLATE BINARY,typeof("owner_user_id"),"owner_user_id" COLLATE BINARY,typeof("organization_id"),"organization_id" COLLATE BINARY,typeof("project_access_id"),"project_access_id" COLLATE BINARY,typeof("project_id"),"project_id" COLLATE BINARY,typeof("document_id"),"document_id" COLLATE BINARY,typeof("enrollment_id"),"enrollment_id" COLLATE BINARY,typeof("enrollment_revision"),"enrollment_revision" COLLATE BINARY,typeof("permission_epoch"),"permission_epoch" COLLATE BINARY,typeof("policy_version"),"policy_version" COLLATE BINARY,typeof("storage_revision"),"storage_revision" COLLATE BINARY,typeof("current_body_ref"),"current_body_ref" COLLATE BINARY,typeof("current_body_hash"),"current_body_hash" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("state"),"state" COLLATE BINARY,typeof("first_terminal_at"),"first_terminal_at" COLLATE BINARY,typeof("cleanup_turn"),"cleanup_turn" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("updated_at"),"updated_at" COLLATE BINARY FROM main."memory_structured_conversation_heads")) THEN 'staged-memory_structured_conversation_heads' ELSE NULL END;
--> statement-breakpoint
CREATE TABLE main."__memory_conversation_capture_revisions" AS SELECT rowid AS original_rowid,* FROM main."memory_structured_conversation_revisions";
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN ((SELECT COUNT(*) FROM main."memory_structured_conversation_revisions")=(SELECT COUNT(*) FROM main."__memory_conversation_capture_revisions") AND NOT EXISTS(SELECT typeof("rowid"),"rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("revision"),"revision" COLLATE BINARY,typeof("predecessor_revision"),"predecessor_revision" COLLATE BINARY,typeof("predecessor_hash"),"predecessor_hash" COLLATE BINARY,typeof("body_ref"),"body_ref" COLLATE BINARY,typeof("body_hash"),"body_hash" COLLATE BINARY,typeof("schema_version"),"schema_version" COLLATE BINARY,typeof("recipe_version"),"recipe_version" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY FROM main."memory_structured_conversation_revisions" EXCEPT SELECT typeof("original_rowid"),"original_rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("revision"),"revision" COLLATE BINARY,typeof("predecessor_revision"),"predecessor_revision" COLLATE BINARY,typeof("predecessor_hash"),"predecessor_hash" COLLATE BINARY,typeof("body_ref"),"body_ref" COLLATE BINARY,typeof("body_hash"),"body_hash" COLLATE BINARY,typeof("schema_version"),"schema_version" COLLATE BINARY,typeof("recipe_version"),"recipe_version" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY FROM main."__memory_conversation_capture_revisions") AND NOT EXISTS(SELECT typeof("original_rowid"),"original_rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("revision"),"revision" COLLATE BINARY,typeof("predecessor_revision"),"predecessor_revision" COLLATE BINARY,typeof("predecessor_hash"),"predecessor_hash" COLLATE BINARY,typeof("body_ref"),"body_ref" COLLATE BINARY,typeof("body_hash"),"body_hash" COLLATE BINARY,typeof("schema_version"),"schema_version" COLLATE BINARY,typeof("recipe_version"),"recipe_version" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY FROM main."__memory_conversation_capture_revisions" EXCEPT SELECT typeof("rowid"),"rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("revision"),"revision" COLLATE BINARY,typeof("predecessor_revision"),"predecessor_revision" COLLATE BINARY,typeof("predecessor_hash"),"predecessor_hash" COLLATE BINARY,typeof("body_ref"),"body_ref" COLLATE BINARY,typeof("body_hash"),"body_hash" COLLATE BINARY,typeof("schema_version"),"schema_version" COLLATE BINARY,typeof("recipe_version"),"recipe_version" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY FROM main."memory_structured_conversation_revisions")) THEN 'staged-memory_structured_conversation_revisions' ELSE NULL END;
--> statement-breakpoint
DROP TABLE main."memory_structured_conversation_revisions";
--> statement-breakpoint
DROP TABLE main."memory_structured_conversation_heads";
--> statement-breakpoint
CREATE TABLE `memory_structured_conversation_heads` (
	`ledger_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`enrollment_id` text,
	`enrollment_revision` integer,
	`permission_epoch` text,
	`policy_version` text,
	`storage_revision` integer NOT NULL,
	`current_body_ref` text,
	`current_body_hash` text,
	`annotation_count` integer,
	`coverage_after_sequence` integer,
	`coverage_through_sequence` integer,
	`state` text NOT NULL,
	`first_terminal_at` text,
	`cleanup_turn` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "memory_structured_heads_key" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_structured_heads_scope" CHECK(length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))),
	CONSTRAINT "memory_structured_heads_counters" CHECK(typeof(storage_revision)='integer' AND storage_revision BETWEEN 1 AND 9007199254740991 AND typeof(cleanup_turn)='integer' AND cleanup_turn BETWEEN 0 AND 3 AND (state!='retired' OR cleanup_turn=0)),
	CONSTRAINT "memory_structured_heads_times" CHECK(length(created_at)>0 AND created_at<=updated_at AND (first_terminal_at IS NULL OR (created_at<=first_terminal_at AND first_terminal_at<=updated_at))),
	CONSTRAINT "memory_structured_heads_state" CHECK((state='active' AND first_terminal_at IS NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND current_body_ref IS NOT NULL AND current_body_hash IS NOT NULL AND annotation_count IS NOT NULL AND coverage_after_sequence IS NOT NULL AND coverage_through_sequence IS NOT NULL AND expires_at IS NOT NULL) OR (state IN('retiring','retired') AND first_terminal_at IS NOT NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND current_body_ref IS NULL AND current_body_hash IS NULL AND annotation_count IS NULL AND coverage_after_sequence IS NULL AND coverage_through_sequence IS NULL AND expires_at IS NULL)),
	CONSTRAINT "memory_structured_heads_active" CHECK(state!='active' OR (storage_revision BETWEEN 1 AND 64 AND length(enrollment_id)>0 AND typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND length(permission_epoch)>0 AND length(policy_version)>0 AND length(current_body_ref)>0 AND length(current_body_hash)=64 AND current_body_hash NOT GLOB '*[^0-9a-f]*' AND typeof(annotation_count)='integer' AND annotation_count BETWEEN 0 AND 256 AND typeof(coverage_after_sequence)='integer' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)='integer' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence AND created_at<expires_at))
);
--> statement-breakpoint
INSERT INTO main."memory_structured_conversation_heads"(rowid,"ledger_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","enrollment_id","enrollment_revision","permission_epoch","policy_version","storage_revision","current_body_ref","current_body_hash","annotation_count","coverage_after_sequence","coverage_through_sequence","state","first_terminal_at","cleanup_turn","expires_at","created_at","updated_at") SELECT original_rowid,"ledger_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","enrollment_id","enrollment_revision","permission_epoch","policy_version","storage_revision","current_body_ref","current_body_hash","annotation_count","coverage_after_sequence","coverage_through_sequence","state","first_terminal_at","cleanup_turn","expires_at","created_at","updated_at" FROM main."__memory_conversation_capture_heads";
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN ((SELECT COUNT(*) FROM main."memory_structured_conversation_heads")=(SELECT COUNT(*) FROM main."__memory_conversation_capture_heads") AND NOT EXISTS(SELECT typeof("rowid"),"rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("actor_user_id"),"actor_user_id" COLLATE BINARY,typeof("owner_user_id"),"owner_user_id" COLLATE BINARY,typeof("organization_id"),"organization_id" COLLATE BINARY,typeof("project_access_id"),"project_access_id" COLLATE BINARY,typeof("project_id"),"project_id" COLLATE BINARY,typeof("document_id"),"document_id" COLLATE BINARY,typeof("enrollment_id"),"enrollment_id" COLLATE BINARY,typeof("enrollment_revision"),"enrollment_revision" COLLATE BINARY,typeof("permission_epoch"),"permission_epoch" COLLATE BINARY,typeof("policy_version"),"policy_version" COLLATE BINARY,typeof("storage_revision"),"storage_revision" COLLATE BINARY,typeof("current_body_ref"),"current_body_ref" COLLATE BINARY,typeof("current_body_hash"),"current_body_hash" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("state"),"state" COLLATE BINARY,typeof("first_terminal_at"),"first_terminal_at" COLLATE BINARY,typeof("cleanup_turn"),"cleanup_turn" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("updated_at"),"updated_at" COLLATE BINARY FROM main."memory_structured_conversation_heads" EXCEPT SELECT typeof("original_rowid"),"original_rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("actor_user_id"),"actor_user_id" COLLATE BINARY,typeof("owner_user_id"),"owner_user_id" COLLATE BINARY,typeof("organization_id"),"organization_id" COLLATE BINARY,typeof("project_access_id"),"project_access_id" COLLATE BINARY,typeof("project_id"),"project_id" COLLATE BINARY,typeof("document_id"),"document_id" COLLATE BINARY,typeof("enrollment_id"),"enrollment_id" COLLATE BINARY,typeof("enrollment_revision"),"enrollment_revision" COLLATE BINARY,typeof("permission_epoch"),"permission_epoch" COLLATE BINARY,typeof("policy_version"),"policy_version" COLLATE BINARY,typeof("storage_revision"),"storage_revision" COLLATE BINARY,typeof("current_body_ref"),"current_body_ref" COLLATE BINARY,typeof("current_body_hash"),"current_body_hash" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("state"),"state" COLLATE BINARY,typeof("first_terminal_at"),"first_terminal_at" COLLATE BINARY,typeof("cleanup_turn"),"cleanup_turn" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("updated_at"),"updated_at" COLLATE BINARY FROM main."__memory_conversation_capture_heads") AND NOT EXISTS(SELECT typeof("original_rowid"),"original_rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("actor_user_id"),"actor_user_id" COLLATE BINARY,typeof("owner_user_id"),"owner_user_id" COLLATE BINARY,typeof("organization_id"),"organization_id" COLLATE BINARY,typeof("project_access_id"),"project_access_id" COLLATE BINARY,typeof("project_id"),"project_id" COLLATE BINARY,typeof("document_id"),"document_id" COLLATE BINARY,typeof("enrollment_id"),"enrollment_id" COLLATE BINARY,typeof("enrollment_revision"),"enrollment_revision" COLLATE BINARY,typeof("permission_epoch"),"permission_epoch" COLLATE BINARY,typeof("policy_version"),"policy_version" COLLATE BINARY,typeof("storage_revision"),"storage_revision" COLLATE BINARY,typeof("current_body_ref"),"current_body_ref" COLLATE BINARY,typeof("current_body_hash"),"current_body_hash" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("state"),"state" COLLATE BINARY,typeof("first_terminal_at"),"first_terminal_at" COLLATE BINARY,typeof("cleanup_turn"),"cleanup_turn" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("updated_at"),"updated_at" COLLATE BINARY FROM main."__memory_conversation_capture_heads" EXCEPT SELECT typeof("rowid"),"rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("actor_user_id"),"actor_user_id" COLLATE BINARY,typeof("owner_user_id"),"owner_user_id" COLLATE BINARY,typeof("organization_id"),"organization_id" COLLATE BINARY,typeof("project_access_id"),"project_access_id" COLLATE BINARY,typeof("project_id"),"project_id" COLLATE BINARY,typeof("document_id"),"document_id" COLLATE BINARY,typeof("enrollment_id"),"enrollment_id" COLLATE BINARY,typeof("enrollment_revision"),"enrollment_revision" COLLATE BINARY,typeof("permission_epoch"),"permission_epoch" COLLATE BINARY,typeof("policy_version"),"policy_version" COLLATE BINARY,typeof("storage_revision"),"storage_revision" COLLATE BINARY,typeof("current_body_ref"),"current_body_ref" COLLATE BINARY,typeof("current_body_hash"),"current_body_hash" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("state"),"state" COLLATE BINARY,typeof("first_terminal_at"),"first_terminal_at" COLLATE BINARY,typeof("cleanup_turn"),"cleanup_turn" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("updated_at"),"updated_at" COLLATE BINARY FROM main."memory_structured_conversation_heads")) THEN 'restored-memory_structured_conversation_heads' ELSE NULL END;
--> statement-breakpoint
CREATE TABLE `memory_structured_conversation_revisions` (
	`ledger_id` text NOT NULL,
	`revision` integer NOT NULL,
	`predecessor_revision` integer NOT NULL,
	`predecessor_hash` text,
	`body_ref` text NOT NULL,
	`body_hash` text NOT NULL,
	`schema_version` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`annotation_count` integer NOT NULL,
	`coverage_after_sequence` integer NOT NULL,
	`coverage_through_sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`ledger_id`, `revision`),
	FOREIGN KEY (`ledger_id`) REFERENCES `memory_structured_conversation_heads`(`ledger_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_structured_revisions_version" CHECK(typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-declared-ledger-v1'),
	CONSTRAINT "memory_structured_revisions_identity" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_structured_revisions_chain" CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 64 AND typeof(predecessor_revision)='integer' AND ((revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (revision>1 AND predecessor_revision=revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT "memory_structured_revisions_bounds" CHECK(typeof(annotation_count)='integer' AND annotation_count BETWEEN 0 AND 256 AND typeof(coverage_after_sequence)='integer' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)='integer' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence),
	CONSTRAINT "memory_structured_revisions_times" CHECK(length(created_at)>0 AND created_at<expires_at)
);
--> statement-breakpoint
INSERT INTO main."memory_structured_conversation_revisions"(rowid,"ledger_id","revision","predecessor_revision","predecessor_hash","body_ref","body_hash","schema_version","recipe_version","annotation_count","coverage_after_sequence","coverage_through_sequence","created_at","expires_at") SELECT original_rowid,"ledger_id","revision","predecessor_revision","predecessor_hash","body_ref","body_hash","schema_version","recipe_version","annotation_count","coverage_after_sequence","coverage_through_sequence","created_at","expires_at" FROM main."__memory_conversation_capture_revisions";
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN ((SELECT COUNT(*) FROM main."memory_structured_conversation_revisions")=(SELECT COUNT(*) FROM main."__memory_conversation_capture_revisions") AND NOT EXISTS(SELECT typeof("rowid"),"rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("revision"),"revision" COLLATE BINARY,typeof("predecessor_revision"),"predecessor_revision" COLLATE BINARY,typeof("predecessor_hash"),"predecessor_hash" COLLATE BINARY,typeof("body_ref"),"body_ref" COLLATE BINARY,typeof("body_hash"),"body_hash" COLLATE BINARY,typeof("schema_version"),"schema_version" COLLATE BINARY,typeof("recipe_version"),"recipe_version" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY FROM main."memory_structured_conversation_revisions" EXCEPT SELECT typeof("original_rowid"),"original_rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("revision"),"revision" COLLATE BINARY,typeof("predecessor_revision"),"predecessor_revision" COLLATE BINARY,typeof("predecessor_hash"),"predecessor_hash" COLLATE BINARY,typeof("body_ref"),"body_ref" COLLATE BINARY,typeof("body_hash"),"body_hash" COLLATE BINARY,typeof("schema_version"),"schema_version" COLLATE BINARY,typeof("recipe_version"),"recipe_version" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY FROM main."__memory_conversation_capture_revisions") AND NOT EXISTS(SELECT typeof("original_rowid"),"original_rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("revision"),"revision" COLLATE BINARY,typeof("predecessor_revision"),"predecessor_revision" COLLATE BINARY,typeof("predecessor_hash"),"predecessor_hash" COLLATE BINARY,typeof("body_ref"),"body_ref" COLLATE BINARY,typeof("body_hash"),"body_hash" COLLATE BINARY,typeof("schema_version"),"schema_version" COLLATE BINARY,typeof("recipe_version"),"recipe_version" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY FROM main."__memory_conversation_capture_revisions" EXCEPT SELECT typeof("rowid"),"rowid" COLLATE BINARY,typeof("ledger_id"),"ledger_id" COLLATE BINARY,typeof("revision"),"revision" COLLATE BINARY,typeof("predecessor_revision"),"predecessor_revision" COLLATE BINARY,typeof("predecessor_hash"),"predecessor_hash" COLLATE BINARY,typeof("body_ref"),"body_ref" COLLATE BINARY,typeof("body_hash"),"body_hash" COLLATE BINARY,typeof("schema_version"),"schema_version" COLLATE BINARY,typeof("recipe_version"),"recipe_version" COLLATE BINARY,typeof("annotation_count"),"annotation_count" COLLATE BINARY,typeof("coverage_after_sequence"),"coverage_after_sequence" COLLATE BINARY,typeof("coverage_through_sequence"),"coverage_through_sequence" COLLATE BINARY,typeof("created_at"),"created_at" COLLATE BINARY,typeof("expires_at"),"expires_at" COLLATE BINARY FROM main."memory_structured_conversation_revisions")) THEN 'restored-memory_structured_conversation_revisions' ELSE NULL END;
--> statement-breakpoint
CREATE INDEX `idx_memory_structured_heads_cleanup` ON `memory_structured_conversation_heads` (`state`,`expires_at`,`ledger_id`);
--> statement-breakpoint
CREATE INDEX `idx_memory_structured_heads_enrollment` ON `memory_structured_conversation_heads` (`enrollment_id`,`state`);
--> statement-breakpoint
CREATE INDEX `idx_memory_structured_heads_organization` ON `memory_structured_conversation_heads` (`organization_id`,`actor_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_heads_personal` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`project_id`,`document_id`) WHERE organization_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_heads_shared` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`organization_id`,`project_access_id`,`project_id`,`document_id`) WHERE organization_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_revisions_body` ON `memory_structured_conversation_revisions` (`body_ref`);
--> statement-breakpoint
CREATE INDEX `idx_memory_structured_revisions_expiry` ON `memory_structured_conversation_revisions` (`expires_at`,`ledger_id`,`revision`);
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN (NOT EXISTS(SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(tbl_name) IN('memory_structured_conversation_heads','memory_structured_conversation_revisions') EXCEPT SELECT * FROM (VALUES ('index','idx_memory_structured_heads_cleanup','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_cleanup` ON `memory_structured_conversation_heads` (`state`,`expires_at`,`ledger_id`)'),('index','idx_memory_structured_heads_enrollment','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_enrollment` ON `memory_structured_conversation_heads` (`enrollment_id`,`state`)'),('index','idx_memory_structured_heads_organization','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_organization` ON `memory_structured_conversation_heads` (`organization_id`,`actor_user_id`)'),('index','idx_memory_structured_heads_personal','memory_structured_conversation_heads','CREATE UNIQUE INDEX `idx_memory_structured_heads_personal` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`project_id`,`document_id`) WHERE organization_id IS NULL'),('index','idx_memory_structured_heads_shared','memory_structured_conversation_heads','CREATE UNIQUE INDEX `idx_memory_structured_heads_shared` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`organization_id`,`project_access_id`,`project_id`,`document_id`) WHERE organization_id IS NOT NULL'),('index','idx_memory_structured_revisions_body','memory_structured_conversation_revisions','CREATE UNIQUE INDEX `idx_memory_structured_revisions_body` ON `memory_structured_conversation_revisions` (`body_ref`)'),('index','idx_memory_structured_revisions_expiry','memory_structured_conversation_revisions','CREATE INDEX `idx_memory_structured_revisions_expiry` ON `memory_structured_conversation_revisions` (`expires_at`,`ledger_id`,`revision`)'),('table','memory_structured_conversation_heads','memory_structured_conversation_heads','CREATE TABLE `memory_structured_conversation_heads` (
	`ledger_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`enrollment_id` text,
	`enrollment_revision` integer,
	`permission_epoch` text,
	`policy_version` text,
	`storage_revision` integer NOT NULL,
	`current_body_ref` text,
	`current_body_hash` text,
	`annotation_count` integer,
	`coverage_after_sequence` integer,
	`coverage_through_sequence` integer,
	`state` text NOT NULL,
	`first_terminal_at` text,
	`cleanup_turn` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "memory_structured_heads_key" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB ''*[^0-9a-f]*''),
	CONSTRAINT "memory_structured_heads_scope" CHECK(length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))),
	CONSTRAINT "memory_structured_heads_counters" CHECK(typeof(storage_revision)=''integer'' AND storage_revision BETWEEN 1 AND 9007199254740991 AND typeof(cleanup_turn)=''integer'' AND cleanup_turn BETWEEN 0 AND 3 AND (state!=''retired'' OR cleanup_turn=0)),
	CONSTRAINT "memory_structured_heads_times" CHECK(length(created_at)>0 AND created_at<=updated_at AND (first_terminal_at IS NULL OR (created_at<=first_terminal_at AND first_terminal_at<=updated_at))),
	CONSTRAINT "memory_structured_heads_state" CHECK((state=''active'' AND first_terminal_at IS NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND current_body_ref IS NOT NULL AND current_body_hash IS NOT NULL AND annotation_count IS NOT NULL AND coverage_after_sequence IS NOT NULL AND coverage_through_sequence IS NOT NULL AND expires_at IS NOT NULL) OR (state IN(''retiring'',''retired'') AND first_terminal_at IS NOT NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND current_body_ref IS NULL AND current_body_hash IS NULL AND annotation_count IS NULL AND coverage_after_sequence IS NULL AND coverage_through_sequence IS NULL AND expires_at IS NULL)),
	CONSTRAINT "memory_structured_heads_active" CHECK(state!=''active'' OR (storage_revision BETWEEN 1 AND 64 AND length(enrollment_id)>0 AND typeof(enrollment_revision)=''integer'' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND length(permission_epoch)>0 AND length(policy_version)>0 AND length(current_body_ref)>0 AND length(current_body_hash)=64 AND current_body_hash NOT GLOB ''*[^0-9a-f]*'' AND typeof(annotation_count)=''integer'' AND annotation_count BETWEEN 0 AND 256 AND typeof(coverage_after_sequence)=''integer'' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)=''integer'' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence AND created_at<expires_at))
)'),('table','memory_structured_conversation_revisions','memory_structured_conversation_revisions','CREATE TABLE `memory_structured_conversation_revisions` (
	`ledger_id` text NOT NULL,
	`revision` integer NOT NULL,
	`predecessor_revision` integer NOT NULL,
	`predecessor_hash` text,
	`body_ref` text NOT NULL,
	`body_hash` text NOT NULL,
	`schema_version` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`annotation_count` integer NOT NULL,
	`coverage_after_sequence` integer NOT NULL,
	`coverage_through_sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`ledger_id`, `revision`),
	FOREIGN KEY (`ledger_id`) REFERENCES `memory_structured_conversation_heads`(`ledger_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_structured_revisions_version" CHECK(typeof(schema_version)=''integer'' AND schema_version=1 AND recipe_version=''native-declared-ledger-v1''),
	CONSTRAINT "memory_structured_revisions_identity" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB ''*[^0-9a-f]*'' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB ''*[^0-9a-f]*''),
	CONSTRAINT "memory_structured_revisions_chain" CHECK(typeof(revision)=''integer'' AND revision BETWEEN 1 AND 64 AND typeof(predecessor_revision)=''integer'' AND ((revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (revision>1 AND predecessor_revision=revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB ''*[^0-9a-f]*''))),
	CONSTRAINT "memory_structured_revisions_bounds" CHECK(typeof(annotation_count)=''integer'' AND annotation_count BETWEEN 0 AND 256 AND typeof(coverage_after_sequence)=''integer'' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)=''integer'' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence),
	CONSTRAINT "memory_structured_revisions_times" CHECK(length(created_at)>0 AND created_at<expires_at)
)'),('index','sqlite_autoindex_memory_structured_conversation_heads_1','memory_structured_conversation_heads',NULL),('index','sqlite_autoindex_memory_structured_conversation_revisions_1','memory_structured_conversation_revisions',NULL))) AND NOT EXISTS(SELECT * FROM (VALUES ('index','idx_memory_structured_heads_cleanup','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_cleanup` ON `memory_structured_conversation_heads` (`state`,`expires_at`,`ledger_id`)'),('index','idx_memory_structured_heads_enrollment','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_enrollment` ON `memory_structured_conversation_heads` (`enrollment_id`,`state`)'),('index','idx_memory_structured_heads_organization','memory_structured_conversation_heads','CREATE INDEX `idx_memory_structured_heads_organization` ON `memory_structured_conversation_heads` (`organization_id`,`actor_user_id`)'),('index','idx_memory_structured_heads_personal','memory_structured_conversation_heads','CREATE UNIQUE INDEX `idx_memory_structured_heads_personal` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`project_id`,`document_id`) WHERE organization_id IS NULL'),('index','idx_memory_structured_heads_shared','memory_structured_conversation_heads','CREATE UNIQUE INDEX `idx_memory_structured_heads_shared` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`organization_id`,`project_access_id`,`project_id`,`document_id`) WHERE organization_id IS NOT NULL'),('index','idx_memory_structured_revisions_body','memory_structured_conversation_revisions','CREATE UNIQUE INDEX `idx_memory_structured_revisions_body` ON `memory_structured_conversation_revisions` (`body_ref`)'),('index','idx_memory_structured_revisions_expiry','memory_structured_conversation_revisions','CREATE INDEX `idx_memory_structured_revisions_expiry` ON `memory_structured_conversation_revisions` (`expires_at`,`ledger_id`,`revision`)'),('table','memory_structured_conversation_heads','memory_structured_conversation_heads','CREATE TABLE `memory_structured_conversation_heads` (
	`ledger_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`enrollment_id` text,
	`enrollment_revision` integer,
	`permission_epoch` text,
	`policy_version` text,
	`storage_revision` integer NOT NULL,
	`current_body_ref` text,
	`current_body_hash` text,
	`annotation_count` integer,
	`coverage_after_sequence` integer,
	`coverage_through_sequence` integer,
	`state` text NOT NULL,
	`first_terminal_at` text,
	`cleanup_turn` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "memory_structured_heads_key" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB ''*[^0-9a-f]*''),
	CONSTRAINT "memory_structured_heads_scope" CHECK(length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))),
	CONSTRAINT "memory_structured_heads_counters" CHECK(typeof(storage_revision)=''integer'' AND storage_revision BETWEEN 1 AND 9007199254740991 AND typeof(cleanup_turn)=''integer'' AND cleanup_turn BETWEEN 0 AND 3 AND (state!=''retired'' OR cleanup_turn=0)),
	CONSTRAINT "memory_structured_heads_times" CHECK(length(created_at)>0 AND created_at<=updated_at AND (first_terminal_at IS NULL OR (created_at<=first_terminal_at AND first_terminal_at<=updated_at))),
	CONSTRAINT "memory_structured_heads_state" CHECK((state=''active'' AND first_terminal_at IS NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND current_body_ref IS NOT NULL AND current_body_hash IS NOT NULL AND annotation_count IS NOT NULL AND coverage_after_sequence IS NOT NULL AND coverage_through_sequence IS NOT NULL AND expires_at IS NOT NULL) OR (state IN(''retiring'',''retired'') AND first_terminal_at IS NOT NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND current_body_ref IS NULL AND current_body_hash IS NULL AND annotation_count IS NULL AND coverage_after_sequence IS NULL AND coverage_through_sequence IS NULL AND expires_at IS NULL)),
	CONSTRAINT "memory_structured_heads_active" CHECK(state!=''active'' OR (storage_revision BETWEEN 1 AND 64 AND length(enrollment_id)>0 AND typeof(enrollment_revision)=''integer'' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND length(permission_epoch)>0 AND length(policy_version)>0 AND length(current_body_ref)>0 AND length(current_body_hash)=64 AND current_body_hash NOT GLOB ''*[^0-9a-f]*'' AND typeof(annotation_count)=''integer'' AND annotation_count BETWEEN 0 AND 256 AND typeof(coverage_after_sequence)=''integer'' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)=''integer'' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence AND created_at<expires_at))
)'),('table','memory_structured_conversation_revisions','memory_structured_conversation_revisions','CREATE TABLE `memory_structured_conversation_revisions` (
	`ledger_id` text NOT NULL,
	`revision` integer NOT NULL,
	`predecessor_revision` integer NOT NULL,
	`predecessor_hash` text,
	`body_ref` text NOT NULL,
	`body_hash` text NOT NULL,
	`schema_version` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`annotation_count` integer NOT NULL,
	`coverage_after_sequence` integer NOT NULL,
	`coverage_through_sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`ledger_id`, `revision`),
	FOREIGN KEY (`ledger_id`) REFERENCES `memory_structured_conversation_heads`(`ledger_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_structured_revisions_version" CHECK(typeof(schema_version)=''integer'' AND schema_version=1 AND recipe_version=''native-declared-ledger-v1''),
	CONSTRAINT "memory_structured_revisions_identity" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB ''*[^0-9a-f]*'' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB ''*[^0-9a-f]*''),
	CONSTRAINT "memory_structured_revisions_chain" CHECK(typeof(revision)=''integer'' AND revision BETWEEN 1 AND 64 AND typeof(predecessor_revision)=''integer'' AND ((revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (revision>1 AND predecessor_revision=revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB ''*[^0-9a-f]*''))),
	CONSTRAINT "memory_structured_revisions_bounds" CHECK(typeof(annotation_count)=''integer'' AND annotation_count BETWEEN 0 AND 256 AND typeof(coverage_after_sequence)=''integer'' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)=''integer'' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence),
	CONSTRAINT "memory_structured_revisions_times" CHECK(length(created_at)>0 AND created_at<expires_at)
)'),('index','sqlite_autoindex_memory_structured_conversation_heads_1','memory_structured_conversation_heads',NULL),('index','sqlite_autoindex_memory_structured_conversation_revisions_1','memory_structured_conversation_revisions',NULL)) EXCEPT SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(tbl_name) IN('memory_structured_conversation_heads','memory_structured_conversation_revisions'))) THEN 'exact-reference-capable-schema' ELSE NULL END;
--> statement-breakpoint
INSERT INTO main."__memory_conversation_capture_guard"(token) SELECT CASE WHEN (NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)) THEN 'foreign-keys-after' ELSE NULL END;
--> statement-breakpoint
DROP TABLE main."__memory_conversation_capture_heads";
--> statement-breakpoint
DROP TABLE main."__memory_conversation_capture_revisions";
--> statement-breakpoint
DROP TABLE main."__memory_conversation_capture_guard";
