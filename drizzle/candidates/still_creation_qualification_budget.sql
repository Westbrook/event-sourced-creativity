-- UNJOURNALED: isolated, explicitly authorized qualification target only.
-- No admission rows are installed. Nano-USD values are integers; $25 = 25000000000.
CREATE TABLE IF NOT EXISTS creation_qualification_runs (
  run_id TEXT PRIMARY KEY,
  authorized INTEGER NOT NULL DEFAULT 0 CHECK(authorized IN(0,1)),
  phase TEXT NOT NULL CHECK(phase IN('canary','full')),
  starts_at INTEGER NOT NULL CHECK(typeof(starts_at)='integer'),
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>starts_at AND expires_at<=starts_at+172800),
  authorization_sha256 TEXT NOT NULL CHECK(length(authorization_sha256)=64),
  pricing_sha256 TEXT NOT NULL CHECK(length(pricing_sha256)=64)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_qualification_limits (
  run_id TEXT NOT NULL REFERENCES creation_qualification_runs(run_id),
  scope TEXT NOT NULL CHECK(scope IN('canary','full')),
  provider TEXT NOT NULL CHECK(provider IN('*','openai:embeddings','openai:organizer','jev')),
  model TEXT NOT NULL,
  max_calls INTEGER NOT NULL CHECK(max_calls BETWEEN 0 AND 1000000),
  max_input_units INTEGER NOT NULL CHECK(max_input_units BETWEEN 0 AND 1000000000000),
  max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens BETWEEN 0 AND 1000000000000),
  max_nano_usd INTEGER NOT NULL CHECK(max_nano_usd BETWEEN 0 AND 25000000000 AND (scope<>'canary' OR max_nano_usd<=5000000000)),
  max_input_bytes_per_call INTEGER NOT NULL CHECK(max_input_bytes_per_call BETWEEN 0 AND 1000000),
  max_output_tokens_per_call INTEGER NOT NULL CHECK(max_output_tokens_per_call BETWEEN 0 AND 16384),
  input_units_per_byte INTEGER NOT NULL CHECK(input_units_per_byte BETWEEN 1 AND 100),
  input_nano_usd_per_unit INTEGER NOT NULL CHECK(input_nano_usd_per_unit BETWEEN 1 AND 1000000),
  output_nano_usd_per_token INTEGER NOT NULL CHECK(output_nano_usd_per_token BETWEEN 0 AND 1000000),
  used_calls INTEGER NOT NULL DEFAULT 0 CHECK(used_calls BETWEEN 0 AND max_calls),
  used_input_units INTEGER NOT NULL DEFAULT 0 CHECK(used_input_units BETWEEN 0 AND max_input_units),
  used_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK(used_output_tokens BETWEEN 0 AND max_output_tokens),
  used_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK(used_nano_usd BETWEEN 0 AND max_nano_usd),
  CHECK(typeof(max_calls)='integer' AND typeof(max_input_units)='integer' AND typeof(max_output_tokens)='integer' AND typeof(max_nano_usd)='integer' AND typeof(max_input_bytes_per_call)='integer' AND typeof(max_output_tokens_per_call)='integer' AND typeof(input_units_per_byte)='integer' AND typeof(input_nano_usd_per_unit)='integer' AND typeof(output_nano_usd_per_token)='integer' AND typeof(used_calls)='integer' AND typeof(used_input_units)='integer' AND typeof(used_output_tokens)='integer' AND typeof(used_nano_usd)='integer'),
  PRIMARY KEY(run_id,scope,provider)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_qualification_attempts (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES creation_qualification_runs(run_id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN('canary','full')),
  input_units INTEGER NOT NULL CHECK(input_units>0),
  output_tokens INTEGER NOT NULL CHECK(output_tokens>=0),
  cost_nano_usd INTEGER NOT NULL CHECK(cost_nano_usd>=0),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS creation_qualification_consume AFTER INSERT ON creation_qualification_attempts
BEGIN
  UPDATE creation_qualification_limits SET
    used_calls=used_calls+1,used_input_units=used_input_units+NEW.input_units,
    used_output_tokens=used_output_tokens+NEW.output_tokens,used_nano_usd=used_nano_usd+NEW.cost_nano_usd
  WHERE run_id=NEW.run_id AND provider IN('*',NEW.provider)
    AND (scope='full' OR (NEW.phase='canary' AND scope='canary'));
END;
