-- Unassigned additive candidate. Requires retained memory-benchmark.pending.sql and
-- existing native budget tables. Does not create any qualification or grant.
CREATE TABLE memory_benchmark_native_qualifications (
  qualification_id TEXT PRIMARY KEY NOT NULL,
  plan_hash TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
  origin TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('qualified','withdrawn')),
  qualified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>qualified_at),
  model_access_verified INTEGER NOT NULL CHECK(model_access_verified IN(0,1)),
  pricing_verified INTEGER NOT NULL CHECK(pricing_verified IN(0,1)),
  retention_verified INTEGER NOT NULL CHECK(retention_verified IN(0,1)),
  token_bounds_verified INTEGER NOT NULL CHECK(token_bounds_verified IN(0,1)),
  native_accounting_verified INTEGER NOT NULL CHECK(native_accounting_verified IN(0,1)),
  hold_reconciliation_verified INTEGER NOT NULL CHECK(hold_reconciliation_verified IN(0,1)),
  cleanup_verified INTEGER NOT NULL CHECK(cleanup_verified IN(0,1)),
  UNIQUE(plan_hash,source_sha256,origin)
);
CREATE TABLE memory_benchmark_native_grants (
  experiment_id TEXT PRIMARY KEY NOT NULL,
  singleton INTEGER NOT NULL UNIQUE DEFAULT 1 CHECK(singleton=1),
  principal_id TEXT NOT NULL,
  payer_id TEXT NOT NULL CHECK(payer_id=principal_id),
  plan_hash TEXT NOT NULL,
  qualification_id TEXT NOT NULL REFERENCES memory_benchmark_native_qualifications(qualification_id),
  period TEXT NOT NULL,
  maximum_micro_usd INTEGER NOT NULL CHECK(maximum_micro_usd=10000000),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at-created_at<=86400000),
  revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE TABLE memory_benchmark_native_operations (
  binding_id TEXT PRIMARY KEY NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES memory_benchmark_native_grants(experiment_id),
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  payer_id TEXT NOT NULL CHECK(payer_id=principal_id),
  period TEXT NOT NULL,
  model TEXT NOT NULL CHECK(model IN('gpt-5.6-luna','gpt-5.6-terra','text-embedding-3-small')),
  maximum_tokens INTEGER NOT NULL CHECK(maximum_tokens>0),
  maximum_micro_usd INTEGER NOT NULL CHECK(maximum_micro_usd>0 AND maximum_micro_usd<=10000000),
  token_id TEXT NOT NULL UNIQUE,
  cost_id TEXT NOT NULL UNIQUE,
  verified_tokens INTEGER CHECK(verified_tokens IS NULL OR typeof(verified_tokens)='integer' AND verified_tokens>0 AND verified_tokens<=maximum_tokens),
  verified_micro_usd INTEGER CHECK(verified_micro_usd IS NULL OR typeof(verified_micro_usd)='integer' AND verified_micro_usd>0 AND verified_micro_usd<=maximum_micro_usd),
  usage_receipt_json TEXT CHECK(usage_receipt_json IS NULL OR json_valid(usage_receipt_json) AND length(CAST(usage_receipt_json AS BLOB))<=4096),
  CHECK((verified_tokens IS NULL)=(verified_micro_usd IS NULL)),
  CHECK((verified_tokens IS NULL)=(usage_receipt_json IS NULL)),
  UNIQUE(experiment_id,operation_id),
  FOREIGN KEY(experiment_id,operation_id) REFERENCES memory_benchmark_operations(experiment_id,operation_id)
);
CREATE TABLE memory_benchmark_native_assertions (passed INTEGER NOT NULL CHECK(passed=1));
CREATE TABLE memory_benchmark_native_dispositions (
  binding_id TEXT PRIMARY KEY NOT NULL REFERENCES memory_benchmark_native_operations(binding_id),
  kind TEXT NOT NULL CHECK(kind='verified-not-dispatched'),
  principal_id TEXT NOT NULL,
  authority_sha256 TEXT NOT NULL CHECK(length(authority_sha256)=64),
  token_was_present INTEGER NOT NULL CHECK(token_was_present IN(0,1)),
  cost_was_present INTEGER NOT NULL CHECK(cost_was_present IN(0,1)),
  recorded_at INTEGER NOT NULL CHECK(typeof(recorded_at)='integer' AND recorded_at>=0)
);

CREATE TRIGGER memory_benchmark_native_disposition_no_replace BEFORE INSERT ON memory_benchmark_native_dispositions
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_dispositions WHERE binding_id=NEW.binding_id)
BEGIN SELECT RAISE(ABORT,'benchmark no-dispatch disposition cannot replace'); END;
CREATE TRIGGER memory_benchmark_native_disposition_no_update BEFORE UPDATE ON memory_benchmark_native_dispositions
BEGIN SELECT RAISE(ABORT,'benchmark no-dispatch disposition is immutable'); END;
CREATE TRIGGER memory_benchmark_native_disposition_no_delete BEFORE DELETE ON memory_benchmark_native_dispositions
BEGIN SELECT RAISE(ABORT,'benchmark no-dispatch disposition cannot reset'); END;
CREATE TRIGGER memory_benchmark_native_disposition_proof BEFORE INSERT ON memory_benchmark_native_dispositions
WHEN NOT EXISTS(SELECT 1 FROM memory_benchmark_native_operations native
 JOIN memory_benchmark_native_grants grant_row ON grant_row.experiment_id=native.experiment_id
 JOIN memory_benchmark_experiments experiment ON experiment.experiment_id=native.experiment_id
 JOIN memory_benchmark_operations operation ON operation.experiment_id=native.experiment_id AND operation.operation_id=native.operation_id
 LEFT JOIN budget_reservations token ON token.reservation_id=native.token_id
 LEFT JOIN cost_budget_reservations cost ON cost.reservation_id=native.cost_id
 WHERE native.binding_id=NEW.binding_id AND native.principal_id=NEW.principal_id AND native.payer_id=native.principal_id
 AND grant_row.principal_id=native.principal_id AND grant_row.payer_id=native.payer_id AND grant_row.period=native.period
 AND experiment.plan_hash=grant_row.plan_hash AND experiment.period=native.period
 AND experiment.principal_id=native.principal_id AND experiment.payer_id=native.payer_id AND experiment.status='halted'
 AND operation.request_hash=native.request_hash AND operation.maximum_micro_usd=native.maximum_micro_usd
 AND operation.state IN('reserved','uncertain') AND operation.dispatch_claimed_at IS NULL AND operation.dispatch_claim_token IS NULL
 AND operation.actual_micro_usd IS NULL AND operation.result_json IS NULL AND operation.payload_purged_at IS NULL
 AND native.verified_tokens IS NULL AND native.verified_micro_usd IS NULL AND native.usage_receipt_json IS NULL
 AND NEW.token_was_present=(CASE WHEN token.reservation_id IS NULL THEN 0 ELSE 1 END)
 AND NEW.cost_was_present=(CASE WHEN cost.reservation_id IS NULL THEN 0 ELSE 1 END)
 AND (token.reservation_id IS NULL OR token.owner_id=native.payer_id AND token.period=native.period
   AND token.stream_id='memory-benchmark:'||native.principal_id AND token.correlation_id=native.binding_id
   AND token.operation='memory-benchmark:'||native.model AND token.reserved_tokens=native.maximum_tokens
   AND token.status='active' AND token.used_tokens=0)
 AND (cost.reservation_id IS NULL OR cost.owner_id=native.payer_id AND cost.period=native.period
   AND cost.stream_id='memory-benchmark:'||native.principal_id AND cost.correlation_id=native.binding_id
   AND cost.operation='memory-benchmark:'||native.model AND cost.reserved_microusd=native.maximum_micro_usd
   AND cost.workspace_id='forma' AND cost.allow_user_overage=0 AND cost.status IN('active','executing') AND cost.used_microusd=0))
BEGIN SELECT RAISE(ABORT,'benchmark no-dispatch proof unavailable'); END;

-- An originally absent reservation is tombstoned too: a paused reserve caller cannot
-- create it after the operator records no dispatch and returns another allowance hold.
CREATE TRIGGER memory_benchmark_native_token_no_late_reserve BEFORE INSERT ON budget_reservations
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_operations native JOIN memory_benchmark_native_dispositions disposition
 ON disposition.binding_id=native.binding_id WHERE native.token_id=NEW.reservation_id)
BEGIN SELECT RAISE(ABORT,'benchmark no-dispatch token reservation prohibited'); END;
CREATE TRIGGER memory_benchmark_native_cost_no_late_reserve BEFORE INSERT ON cost_budget_reservations
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_operations native JOIN memory_benchmark_native_dispositions disposition
 ON disposition.binding_id=native.binding_id WHERE native.cost_id=NEW.reservation_id)
BEGIN SELECT RAISE(ABORT,'benchmark no-dispatch dollar reservation prohibited'); END;
CREATE TRIGGER memory_benchmark_native_disposition_no_usage BEFORE UPDATE ON memory_benchmark_native_operations
WHEN (NEW.verified_tokens IS NOT OLD.verified_tokens OR NEW.verified_micro_usd IS NOT OLD.verified_micro_usd
 OR NEW.usage_receipt_json IS NOT OLD.usage_receipt_json)
 AND EXISTS(SELECT 1 FROM memory_benchmark_native_dispositions WHERE binding_id=OLD.binding_id)
BEGIN SELECT RAISE(ABORT,'benchmark no-dispatch provider usage prohibited'); END;

CREATE TRIGGER memory_benchmark_experiment_no_replace BEFORE INSERT ON memory_benchmark_experiments
WHEN EXISTS(SELECT 1 FROM memory_benchmark_experiments WHERE experiment_id=NEW.experiment_id OR singleton=NEW.singleton)
BEGIN SELECT RAISE(ABORT,'benchmark experiment cannot replace'); END;
CREATE TRIGGER memory_benchmark_operation_no_replace BEFORE INSERT ON memory_benchmark_operations
WHEN EXISTS(SELECT 1 FROM memory_benchmark_operations WHERE experiment_id=NEW.experiment_id AND (operation_id=NEW.operation_id OR ordinal=NEW.ordinal)
 OR reservation_token=NEW.reservation_token OR dispatch_claim_token=NEW.dispatch_claim_token)
BEGIN SELECT RAISE(ABORT,'benchmark operation cannot replace'); END;
CREATE TRIGGER memory_benchmark_native_token_no_replace BEFORE INSERT ON budget_reservations
WHEN EXISTS(SELECT 1 FROM budget_reservations existing JOIN memory_benchmark_native_operations native
 ON native.token_id=existing.reservation_id WHERE existing.reservation_id=NEW.reservation_id)
BEGIN SELECT RAISE(ABORT,'benchmark token accounting cannot replace'); END;
CREATE TRIGGER memory_benchmark_native_cost_no_replace BEFORE INSERT ON cost_budget_reservations
WHEN EXISTS(SELECT 1 FROM cost_budget_reservations existing JOIN memory_benchmark_native_operations native
 ON native.cost_id=existing.reservation_id WHERE existing.reservation_id=NEW.reservation_id)
BEGIN SELECT RAISE(ABORT,'benchmark dollar accounting cannot replace'); END;

CREATE TRIGGER memory_benchmark_native_grant_no_replace BEFORE INSERT ON memory_benchmark_native_grants
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_grants WHERE experiment_id=NEW.experiment_id OR singleton=NEW.singleton)
BEGIN SELECT RAISE(ABORT,'benchmark native grant cannot replace'); END;
CREATE TRIGGER memory_benchmark_native_operation_no_replace BEFORE INSERT ON memory_benchmark_native_operations
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_operations WHERE binding_id=NEW.binding_id
 OR experiment_id=NEW.experiment_id AND operation_id=NEW.operation_id OR token_id=NEW.token_id OR cost_id=NEW.cost_id)
BEGIN SELECT RAISE(ABORT,'benchmark native accounting cannot replace'); END;

CREATE TRIGGER memory_benchmark_native_grant_immutable BEFORE UPDATE ON memory_benchmark_native_grants
WHEN NEW.experiment_id IS NOT OLD.experiment_id OR NEW.singleton IS NOT OLD.singleton
 OR NEW.principal_id IS NOT OLD.principal_id OR NEW.payer_id IS NOT OLD.payer_id OR NEW.plan_hash IS NOT OLD.plan_hash
 OR NEW.qualification_id IS NOT OLD.qualification_id OR NEW.period IS NOT OLD.period
 OR NEW.maximum_micro_usd IS NOT OLD.maximum_micro_usd OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at
BEGIN SELECT RAISE(ABORT,'immutable benchmark native grant'); END;
CREATE TRIGGER memory_benchmark_native_grant_no_delete BEFORE DELETE ON memory_benchmark_native_grants
BEGIN SELECT RAISE(ABORT,'benchmark native grant cannot reset'); END;
CREATE TRIGGER memory_benchmark_native_operation_immutable BEFORE UPDATE ON memory_benchmark_native_operations
WHEN NEW.binding_id IS NOT OLD.binding_id OR NEW.experiment_id IS NOT OLD.experiment_id
 OR NEW.operation_id IS NOT OLD.operation_id OR NEW.request_hash IS NOT OLD.request_hash
 OR NEW.principal_id IS NOT OLD.principal_id OR NEW.payer_id IS NOT OLD.payer_id OR NEW.period IS NOT OLD.period
 OR NEW.model IS NOT OLD.model OR NEW.maximum_tokens IS NOT OLD.maximum_tokens OR NEW.maximum_micro_usd IS NOT OLD.maximum_micro_usd
 OR NEW.token_id IS NOT OLD.token_id OR NEW.cost_id IS NOT OLD.cost_id
 OR OLD.verified_tokens IS NOT NULL AND (NEW.verified_tokens IS NOT OLD.verified_tokens OR NEW.verified_micro_usd IS NOT OLD.verified_micro_usd
   OR NEW.usage_receipt_json IS NOT OLD.usage_receipt_json)
BEGIN SELECT RAISE(ABORT,'immutable benchmark native operation'); END;
CREATE TRIGGER memory_benchmark_native_operation_no_delete BEFORE DELETE ON memory_benchmark_native_operations
BEGIN SELECT RAISE(ABORT,'benchmark native accounting cannot reset'); END;

-- The runner's actual one-shot dispatch transaction must own both native holds.
CREATE TRIGGER memory_benchmark_native_dispatch BEFORE UPDATE OF dispatch_claimed_at ON memory_benchmark_operations
WHEN OLD.dispatch_claimed_at IS NULL AND NEW.dispatch_claimed_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM memory_benchmark_native_operations native
 JOIN memory_benchmark_native_grants grant_row ON grant_row.experiment_id=native.experiment_id
 JOIN memory_benchmark_native_qualifications qualified ON qualified.qualification_id=grant_row.qualification_id
 JOIN budget_reservations token ON token.reservation_id=native.token_id AND token.owner_id=native.payer_id
 JOIN cost_budget_reservations cost ON cost.reservation_id=native.cost_id AND cost.owner_id=native.payer_id
 WHERE native.experiment_id=OLD.experiment_id AND native.operation_id=OLD.operation_id AND native.request_hash=OLD.request_hash
 AND native.maximum_micro_usd=OLD.maximum_micro_usd AND native.verified_tokens IS NULL
 AND NOT EXISTS(SELECT 1 FROM memory_benchmark_native_dispositions disposition WHERE disposition.binding_id=native.binding_id)
 AND native.principal_id=grant_row.principal_id AND native.payer_id=grant_row.payer_id AND native.period=grant_row.period
 AND grant_row.revoked_at IS NULL AND grant_row.expires_at>NEW.dispatch_claimed_at
 AND qualified.status='qualified' AND qualified.expires_at>NEW.dispatch_claimed_at AND qualified.plan_hash=grant_row.plan_hash
 AND token.status='active' AND cost.status='executing' AND token.used_tokens=0 AND cost.used_microusd=0
 AND token.reserved_tokens=native.maximum_tokens AND cost.reserved_microusd=native.maximum_micro_usd
 AND token.period=native.period AND cost.period=native.period AND token.correlation_id=native.binding_id AND cost.correlation_id=native.binding_id
 AND token.stream_id='memory-benchmark:'||native.principal_id AND cost.stream_id=token.stream_id
 AND token.operation='memory-benchmark:'||native.model AND cost.operation=token.operation)
BEGIN SELECT RAISE(ABORT,'benchmark native dispatch authority unavailable'); END;

-- Direct/correlation-based generic releases cannot refund an uncertain provider call.
-- The separate prefix exclusion prevents routine orphan reconciliation from hitting these guards.
CREATE TRIGGER memory_benchmark_native_token_settlement BEFORE UPDATE ON budget_reservations
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_operations native WHERE native.token_id=OLD.reservation_id)
 AND (NEW.reservation_id IS NOT OLD.reservation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.stream_id IS NOT OLD.stream_id
 OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.operation IS NOT OLD.operation OR NEW.period IS NOT OLD.period
 OR NEW.reserved_tokens IS NOT OLD.reserved_tokens OR (NEW.status IS NOT OLD.status OR NEW.used_tokens IS NOT OLD.used_tokens)
 AND NOT (OLD.status='authorizing' AND NEW.status='active' AND NEW.used_tokens=0
   AND NOT EXISTS(SELECT 1 FROM memory_benchmark_native_operations native JOIN memory_benchmark_native_dispositions disposition
     ON disposition.binding_id=native.binding_id WHERE native.token_id=OLD.reservation_id)
 OR OLD.status='active' AND NEW.status='released' AND NEW.used_tokens=0
   AND EXISTS(SELECT 1 FROM memory_benchmark_native_operations native JOIN memory_benchmark_native_dispositions disposition
     ON disposition.binding_id=native.binding_id WHERE native.token_id=OLD.reservation_id AND native.payer_id=OLD.owner_id
       AND disposition.token_was_present=1 AND disposition.kind='verified-not-dispatched')
 OR EXISTS(SELECT 1 FROM memory_benchmark_native_operations native WHERE native.token_id=OLD.reservation_id
   AND native.payer_id=OLD.owner_id AND native.verified_tokens=NEW.used_tokens AND NEW.status='settled')))
BEGIN SELECT RAISE(ABORT,'benchmark native token hold retained'); END;
CREATE TRIGGER memory_benchmark_native_cost_settlement BEFORE UPDATE ON cost_budget_reservations
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_operations native WHERE native.cost_id=OLD.reservation_id)
 AND (NEW.reservation_id IS NOT OLD.reservation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.stream_id IS NOT OLD.stream_id
 OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.operation IS NOT OLD.operation OR NEW.period IS NOT OLD.period
 OR NEW.reserved_microusd IS NOT OLD.reserved_microusd OR NEW.workspace_id IS NOT OLD.workspace_id
 OR (NEW.status IS NOT OLD.status OR NEW.used_microusd IS NOT OLD.used_microusd)
 AND NOT (OLD.status='authorizing' AND NEW.status='active' AND NEW.used_microusd=0
   AND NOT EXISTS(SELECT 1 FROM memory_benchmark_native_operations native JOIN memory_benchmark_native_dispositions disposition
     ON disposition.binding_id=native.binding_id WHERE native.cost_id=OLD.reservation_id)
 OR OLD.status='active' AND NEW.status='executing' AND NEW.used_microusd=0
   AND NOT EXISTS(SELECT 1 FROM memory_benchmark_native_operations native JOIN memory_benchmark_native_dispositions disposition
     ON disposition.binding_id=native.binding_id WHERE native.cost_id=OLD.reservation_id)
 OR OLD.status IN('active','executing') AND NEW.status='released' AND NEW.used_microusd=0
   AND EXISTS(SELECT 1 FROM memory_benchmark_native_operations native JOIN memory_benchmark_native_dispositions disposition
     ON disposition.binding_id=native.binding_id WHERE native.cost_id=OLD.reservation_id AND native.payer_id=OLD.owner_id
       AND disposition.cost_was_present=1 AND disposition.kind='verified-not-dispatched')
 OR EXISTS(SELECT 1 FROM memory_benchmark_native_operations native WHERE native.cost_id=OLD.reservation_id
   AND native.payer_id=OLD.owner_id AND native.verified_micro_usd=NEW.used_microusd AND NEW.status='settled')))
BEGIN SELECT RAISE(ABORT,'benchmark native dollar hold retained'); END;
CREATE TRIGGER memory_benchmark_native_token_no_delete BEFORE DELETE ON budget_reservations
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_operations native WHERE native.token_id=OLD.reservation_id)
BEGIN SELECT RAISE(ABORT,'benchmark native token accounting retained'); END;
CREATE TRIGGER memory_benchmark_native_cost_no_delete BEFORE DELETE ON cost_budget_reservations
WHEN EXISTS(SELECT 1 FROM memory_benchmark_native_operations native WHERE native.cost_id=OLD.reservation_id)
BEGIN SELECT RAISE(ABORT,'benchmark native dollar accounting retained'); END;
