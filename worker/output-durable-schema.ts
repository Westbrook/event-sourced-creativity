/** Dormant schema candidate. No bootstrap, migration journal or route imports it.
 * Install explicitly only after selecting and qualifying a delivery runtime. */
export const OUTPUT_DURABLE_SCHEMA = [
  `CREATE TABLE output_durable_jobs(
    job_id TEXT PRIMARY KEY NOT NULL,scope_key TEXT NOT NULL,slot_id TEXT NOT NULL,grant_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,stream_id TEXT NOT NULL,document_id TEXT NOT NULL,run_event_id TEXT NOT NULL,
    route_digest TEXT NOT NULL,source_digest TEXT NOT NULL,target_contract_digest TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN('queued','generating','awaiting_provider','retaining','ready','uncertain','failed','cancel_requested','cancelled')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0),
    lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK(typeof(lease_epoch)='integer' AND lease_epoch>=0),
    lease_token TEXT,lease_expires_at TEXT,next_attempt_at TEXT NOT NULL,
    delivery_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(delivery_count)='integer' AND delivery_count>=0),
    read_failures INTEGER NOT NULL DEFAULT 0 CHECK(typeof(read_failures)='integer' AND read_failures>=0),
    last_error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(scope_key,slot_id),
    FOREIGN KEY(job_id) REFERENCES document_jobs(job_id),
    FOREIGN KEY(scope_key,slot_id) REFERENCES output_operation_slots(scope_key,slot_id),
    FOREIGN KEY(scope_key,grant_id) REFERENCES output_execution_grants(scope_key,grant_id),
    FOREIGN KEY(run_event_id) REFERENCES events(event_id),
    CHECK((lease_token IS NULL AND lease_expires_at IS NULL) OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)))`,
  `CREATE INDEX idx_output_durable_due ON output_durable_jobs(next_attempt_at,job_id)
    WHERE phase IN('queued','generating','awaiting_provider','retaining','cancel_requested')`,
  `CREATE TRIGGER output_durable_identity_immutable BEFORE UPDATE ON output_durable_jobs
    WHEN NEW.job_id IS NOT OLD.job_id OR NEW.scope_key IS NOT OLD.scope_key OR NEW.slot_id IS NOT OLD.slot_id
      OR NEW.grant_id IS NOT OLD.grant_id OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.stream_id IS NOT OLD.stream_id
      OR NEW.document_id IS NOT OLD.document_id OR NEW.run_event_id IS NOT OLD.run_event_id
      OR NEW.route_digest IS NOT OLD.route_digest OR NEW.source_digest IS NOT OLD.source_digest
      OR NEW.target_contract_digest IS NOT OLD.target_contract_digest OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT,'output_durable_identity_immutable'); END`,
  `CREATE TRIGGER output_durable_owner_immutable BEFORE UPDATE OF request_json ON document_jobs
    WHEN json_type(OLD.request_json,'$.outputDurable') IS NOT NULL
      AND (json_type(NEW.request_json,'$.outputDurable') IS NOT json_type(OLD.request_json,'$.outputDurable')
        OR json_extract(NEW.request_json,'$.outputDurable') IS NOT json_extract(OLD.request_json,'$.outputDurable'))
      AND NOT (json_type(NEW.request_json,'$.outputDurable') IS 'integer' AND json_extract(NEW.request_json,'$.outputDurable') IS 1
        AND (json_type(OLD.request_json,'$.outputDurable') IS NOT 'integer' OR json_extract(OLD.request_json,'$.outputDurable') IS NOT 1))
    BEGIN SELECT RAISE(ABORT,'output_durable_owner_immutable'); END`,
] as const;

export const OUTPUT_DURABLE_SCHEMA_NAMES = ["output_durable_jobs", "idx_output_durable_due", "output_durable_identity_immutable", "output_durable_owner_immutable"] as const;
