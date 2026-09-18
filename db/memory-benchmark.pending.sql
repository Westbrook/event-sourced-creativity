-- Detached benchmark schema. This is NOT an assigned production migration.
-- A database admits one immutable experiment and at most US$10 in lifetime spend.
CREATE TABLE memory_benchmark_experiments (
  experiment_id TEXT PRIMARY KEY,
  singleton INTEGER NOT NULL UNIQUE DEFAULT 1 CHECK (singleton = 1),
  plan_hash TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  payer_id TEXT NOT NULL,
  period TEXT NOT NULL,
  maximum_micro_usd INTEGER NOT NULL DEFAULT 10000000 CHECK (maximum_micro_usd = 10000000),
  spent_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (typeof(spent_micro_usd) = 'integer' AND spent_micro_usd >= 0),
  reserved_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_micro_usd) = 'integer' AND reserved_micro_usd >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'halted', 'complete')),
  next_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (typeof(next_ordinal) = 'integer' AND next_ordinal >= 0),
  expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
  halt_reason TEXT,
  CHECK (spent_micro_usd + reserved_micro_usd <= maximum_micro_usd),
  CHECK (expires_at > created_at AND expires_at - created_at <= 86400000),
  CHECK (status != 'complete' OR reserved_micro_usd = 0)
);

CREATE TABLE memory_benchmark_operations (
  experiment_id TEXT NOT NULL REFERENCES memory_benchmark_experiments(experiment_id),
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal >= 0),
  reservation_token TEXT NOT NULL UNIQUE,
  dispatch_claimed_at INTEGER CHECK (dispatch_claimed_at IS NULL OR (typeof(dispatch_claimed_at) = 'integer' AND dispatch_claimed_at >= created_at)),
  dispatch_claim_token TEXT UNIQUE,
  maximum_micro_usd INTEGER NOT NULL CHECK (typeof(maximum_micro_usd) = 'integer' AND maximum_micro_usd > 0 AND maximum_micro_usd <= 10000000),
  actual_micro_usd INTEGER CHECK (actual_micro_usd IS NULL OR (typeof(actual_micro_usd) = 'integer' AND actual_micro_usd >= 0 AND actual_micro_usd <= maximum_micro_usd)),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'settled', 'uncertain')),
  result_json TEXT,
  payload_purged_at INTEGER CHECK (payload_purged_at IS NULL OR (typeof(payload_purged_at) = 'integer' AND payload_purged_at >= created_at)),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
  PRIMARY KEY (experiment_id, operation_id),
  UNIQUE (experiment_id, ordinal),
  CHECK ((dispatch_claimed_at IS NULL AND dispatch_claim_token IS NULL)
    OR (dispatch_claimed_at IS NOT NULL AND dispatch_claim_token IS NOT NULL AND length(dispatch_claim_token)=36)),
  CHECK ((state = 'settled' AND dispatch_claimed_at IS NOT NULL AND actual_micro_usd IS NOT NULL AND ((result_json IS NOT NULL AND payload_purged_at IS NULL
    AND length(CAST(result_json AS BLOB)) <= 1048576 AND json_valid(result_json)
    AND json_type(result_json) IN ('object', 'array')) OR (result_json IS NULL AND payload_purged_at IS NOT NULL)))
    OR (state != 'settled' AND actual_micro_usd IS NULL AND result_json IS NULL AND payload_purged_at IS NULL))
);

CREATE UNIQUE INDEX memory_benchmark_one_outstanding_operation
  ON memory_benchmark_operations(experiment_id) WHERE state IN ('reserved', 'uncertain');

-- Failed assertions abort the D1 batch transaction, including earlier writes.
-- Successful transactions empty this table; it never contains user content.
CREATE TABLE memory_benchmark_assertions (
  passed INTEGER NOT NULL CHECK (passed = 1)
);

CREATE TRIGGER memory_benchmark_experiment_immutable BEFORE UPDATE ON memory_benchmark_experiments
WHEN NEW.experiment_id != OLD.experiment_id OR NEW.singleton != OLD.singleton
  OR NEW.plan_hash != OLD.plan_hash OR NEW.principal_id != OLD.principal_id
  OR NEW.payer_id != OLD.payer_id OR NEW.period != OLD.period
  OR NEW.maximum_micro_usd != OLD.maximum_micro_usd OR NEW.expires_at != OLD.expires_at
  OR NEW.created_at != OLD.created_at OR NEW.spent_micro_usd < OLD.spent_micro_usd
  OR NEW.next_ordinal < OLD.next_ordinal OR NEW.updated_at < OLD.updated_at
  OR (OLD.status = 'halted' AND NEW.status != 'halted')
  OR (OLD.status = 'complete' AND NEW.status = 'active')
BEGIN SELECT RAISE(ABORT, 'immutable benchmark grant'); END;

CREATE TRIGGER memory_benchmark_experiment_no_delete BEFORE DELETE ON memory_benchmark_experiments
BEGIN SELECT RAISE(ABORT, 'benchmark grant cannot be reset'); END;

CREATE TRIGGER memory_benchmark_operation_immutable BEFORE UPDATE ON memory_benchmark_operations
WHEN NEW.experiment_id != OLD.experiment_id OR NEW.operation_id != OLD.operation_id
  OR NEW.request_hash != OLD.request_hash OR NEW.ordinal != OLD.ordinal
  OR NEW.reservation_token != OLD.reservation_token OR NEW.maximum_micro_usd != OLD.maximum_micro_usd
  OR NEW.created_at != OLD.created_at OR NEW.updated_at < OLD.updated_at
  OR (OLD.dispatch_claimed_at IS NOT NULL AND (NEW.dispatch_claimed_at IS NOT OLD.dispatch_claimed_at
    OR NEW.dispatch_claim_token IS NOT OLD.dispatch_claim_token))
  OR (OLD.dispatch_claimed_at IS NULL AND NEW.dispatch_claimed_at IS NOT NULL AND NOT (
    OLD.state='reserved' AND NEW.state='reserved' AND NEW.updated_at>=NEW.dispatch_claimed_at
    AND EXISTS (SELECT 1 FROM memory_benchmark_experiments e WHERE e.experiment_id=OLD.experiment_id
      AND e.status='active' AND e.expires_at>NEW.dispatch_claimed_at AND e.updated_at<=NEW.dispatch_claimed_at
      AND e.period=strftime('%Y-%m', NEW.dispatch_claimed_at / 1000, 'unixepoch'))))
  OR (OLD.state = 'uncertain' AND NEW.state != 'uncertain')
  OR (OLD.state = 'settled' AND (NEW.state != 'settled'
    OR NEW.actual_micro_usd IS NOT OLD.actual_micro_usd
    OR (NEW.result_json IS NOT OLD.result_json AND NOT (
      OLD.result_json IS NOT NULL AND NEW.result_json IS NULL AND OLD.payload_purged_at IS NULL
      AND NEW.payload_purged_at IS NOT NULL
      AND NEW.payload_purged_at >= (SELECT expires_at FROM memory_benchmark_experiments WHERE experiment_id=OLD.experiment_id)
      AND NEW.updated_at >= NEW.payload_purged_at))))
  OR (NEW.payload_purged_at IS NOT OLD.payload_purged_at AND NOT (
    OLD.payload_purged_at IS NULL AND NEW.payload_purged_at IS NOT NULL
    AND OLD.state='settled' AND NEW.state='settled' AND OLD.result_json IS NOT NULL AND NEW.result_json IS NULL
    AND NEW.payload_purged_at >= (SELECT expires_at FROM memory_benchmark_experiments WHERE experiment_id=OLD.experiment_id)
    AND NEW.updated_at >= NEW.payload_purged_at))
BEGIN SELECT RAISE(ABORT, 'immutable benchmark operation'); END;

CREATE TRIGGER memory_benchmark_operation_no_delete BEFORE DELETE ON memory_benchmark_operations
BEGIN SELECT RAISE(ABORT, 'benchmark operation cannot be reset'); END;

CREATE TRIGGER memory_benchmark_operation_no_preexisting_purge BEFORE INSERT ON memory_benchmark_operations
WHEN NEW.payload_purged_at IS NOT NULL OR NEW.dispatch_claimed_at IS NOT NULL OR NEW.dispatch_claim_token IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'benchmark metadata requires an existing operation'); END;
