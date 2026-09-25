-- Fresh R1 schema, no Sites import or pgvector dependency.
ALTER TABLE pilot.principals ADD COLUMN email text;
ALTER TABLE pilot.principals ADD COLUMN display_name text;
ALTER TABLE pilot.principals ADD COLUMN role text NOT NULL DEFAULT 'creator' CHECK(role IN('creator','viewer'));
ALTER TABLE pilot.principals ADD COLUMN consented_at timestamptz;
CREATE UNIQUE INDEX pilot_principal_email ON pilot.principals(lower(email));
CREATE TABLE pilot.admissions(email text PRIMARY KEY,role text NOT NULL CHECK(role IN('creator','viewer')),disabled_at timestamptz);
CREATE TABLE pilot.core_resources(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES pilot.workspaces,project_id text NOT NULL,kind text NOT NULL CHECK(kind IN('project','document','idea')),deleted_at timestamptz);
CREATE TABLE pilot.core_grants(project_id text REFERENCES pilot.core_resources,principal_id text REFERENCES pilot.principals,role text NOT NULL CHECK(role IN('editor','viewer')),revoked_at timestamptz,PRIMARY KEY(project_id,principal_id));
CREATE TABLE pilot.core_events(event_id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES pilot.workspaces,project_id text NOT NULL,sequence bigint NOT NULL,type text NOT NULL,public_payload jsonb NOT NULL,body bytea NOT NULL,actor text NOT NULL,client_id text NOT NULL,operation_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workspace_id,sequence));
CREATE TABLE pilot.core_drafts(draft_id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES pilot.workspaces,actor_id text NOT NULL REFERENCES pilot.principals,project_id text,revision integer NOT NULL,body bytea NOT NULL,state text NOT NULL DEFAULT 'active');
CREATE TABLE pilot.core_operations(operation_id text PRIMARY KEY,draft_id text,workspace_id text NOT NULL REFERENCES pilot.workspaces,actor_id text NOT NULL REFERENCES pilot.principals,project_id text,request_hash text NOT NULL,state text NOT NULL,body bytea NOT NULL);
