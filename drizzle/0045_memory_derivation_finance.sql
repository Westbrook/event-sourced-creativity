-- Independent minimized financial records. No source text or FK to erasable
-- users/grants/jobs/organizations. Private job links alone cascade on erasure.
CREATE TABLE memory_derivation_month_caps (
 payer_id TEXT NOT NULL ,
 period TEXT NOT NULL ,
 cap_microusd INTEGER NOT NULL ,
 PRIMARY KEY(payer_id,period),
 CONSTRAINT memory_derivation_month_caps_check_1 CHECK(length(payer_id) BETWEEN 1 AND 240),
 CONSTRAINT memory_derivation_month_caps_check_2 CHECK(length(period)=7 AND period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(period,6,2) BETWEEN '01' AND '12'),
 CONSTRAINT memory_derivation_month_caps_check_3 CHECK(typeof(cap_microusd)='integer' AND cap_microusd BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE memory_derivation_finance (
 finance_id TEXT PRIMARY KEY NOT NULL ,
 payer_id TEXT NOT NULL ,
 period TEXT NOT NULL ,
 token_id TEXT NOT NULL UNIQUE ,
 cost_id TEXT NOT NULL UNIQUE ,
 operation TEXT NOT NULL ,
 provider TEXT NOT NULL , model TEXT NOT NULL ,
 terms_sha256 TEXT NOT NULL , request_sha256 TEXT NOT NULL ,
 input_price INTEGER NOT NULL ,
 cached_input_price INTEGER NOT NULL ,
 output_price INTEGER NOT NULL ,
 maximum_input INTEGER NOT NULL ,
 maximum_output INTEGER NOT NULL ,
 maximum_tokens INTEGER NOT NULL ,
 maximum_microusd INTEGER NOT NULL ,
 authorized_cap_microusd INTEGER NOT NULL ,
 workspace_id TEXT NOT NULL , project_access_id TEXT, pilot_cohort_id TEXT,
 created_at TEXT NOT NULL , dispatch_token TEXT UNIQUE, dispatched_at TEXT, admission_closed_at TEXT,
 CONSTRAINT memory_derivation_finance_check_1 CHECK(length(finance_id) BETWEEN 1 AND 240),
 CONSTRAINT memory_derivation_finance_check_2 CHECK(length(payer_id) BETWEEN 1 AND 240),
 CONSTRAINT memory_derivation_finance_check_3 CHECK(period=substr(created_at,1,7)),
 CONSTRAINT memory_derivation_finance_check_4 CHECK(length(token_id) BETWEEN 1 AND 240),
 CONSTRAINT memory_derivation_finance_check_5 CHECK(length(cost_id) BETWEEN 1 AND 240 AND cost_id<>token_id),
 CONSTRAINT memory_derivation_finance_check_6 CHECK(operation IN('memory-derivation:rolling-summary','memory-derivation:profile','memory-derivation:suggestion')),
 CONSTRAINT memory_derivation_finance_check_7 CHECK(provider='openai'),
 CONSTRAINT memory_derivation_finance_check_8 CHECK(length(model) BETWEEN 1 AND 240),
 CONSTRAINT memory_derivation_finance_check_9 CHECK(length(terms_sha256)=64 AND terms_sha256 NOT GLOB '*[^0-9a-f]*'),
 CONSTRAINT memory_derivation_finance_check_10 CHECK(length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
 CONSTRAINT memory_derivation_finance_check_11 CHECK(typeof(input_price)='integer' AND input_price BETWEEN 0 AND 1000000000),
 CONSTRAINT memory_derivation_finance_check_12 CHECK(typeof(cached_input_price)='integer' AND cached_input_price BETWEEN 0 AND input_price),
 CONSTRAINT memory_derivation_finance_check_13 CHECK(typeof(output_price)='integer' AND output_price BETWEEN 0 AND 1000000000),
 CONSTRAINT memory_derivation_finance_check_14 CHECK(typeof(maximum_input)='integer' AND maximum_input BETWEEN 1 AND 131072),
 CONSTRAINT memory_derivation_finance_check_15 CHECK(typeof(maximum_output)='integer' AND maximum_output BETWEEN 1 AND 8192),
 CONSTRAINT memory_derivation_finance_check_16 CHECK(typeof(maximum_tokens)='integer' AND maximum_tokens=maximum_input+maximum_output),
 CONSTRAINT memory_derivation_finance_check_17 CHECK(typeof(maximum_microusd)='integer' AND maximum_microusd BETWEEN 1 AND 1000000000
   AND maximum_microusd=(maximum_input*input_price+maximum_output*output_price+999999)/1000000),
 CONSTRAINT memory_derivation_finance_check_18 CHECK(typeof(authorized_cap_microusd)='integer' AND authorized_cap_microusd BETWEEN 1 AND 1000000000),
 CONSTRAINT memory_derivation_finance_check_19 CHECK(length(workspace_id) BETWEEN 1 AND 240),
 CONSTRAINT memory_derivation_finance_check_20 CHECK(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
 CONSTRAINT memory_derivation_finance_check_21 CHECK((workspace_id='forma' AND project_access_id IS NULL AND pilot_cohort_id IS NULL) OR (workspace_id<>'forma' AND project_access_id IS NOT NULL AND length(project_access_id) BETWEEN 1 AND 240)),
 CONSTRAINT memory_derivation_finance_check_22 CHECK(pilot_cohort_id IS NULL OR length(pilot_cohort_id) BETWEEN 1 AND 240),
 CONSTRAINT memory_derivation_finance_check_23 CHECK((dispatch_token IS NULL AND dispatched_at IS NULL) OR (dispatch_token IS NOT NULL AND length(dispatch_token) BETWEEN 1 AND 240 AND dispatched_at IS NOT NULL AND length(dispatched_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',dispatched_at) IS dispatched_at AND dispatched_at>=created_at)),
 CONSTRAINT memory_derivation_finance_check_24 CHECK(admission_closed_at IS NULL OR length(admission_closed_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',admission_closed_at) IS admission_closed_at AND admission_closed_at>=created_at)
);
--> statement-breakpoint
CREATE INDEX idx_memory_derivation_finance_payer_month ON memory_derivation_finance(payer_id,period);
--> statement-breakpoint
CREATE INDEX idx_memory_derivation_finance_workspace ON memory_derivation_finance(workspace_id,project_access_id,pilot_cohort_id);
--> statement-breakpoint
CREATE TABLE memory_derivation_usage (
 finance_id TEXT PRIMARY KEY NOT NULL REFERENCES memory_derivation_finance(finance_id),
 provider_request_id TEXT NOT NULL UNIQUE ,
 receipt_sha256 TEXT NOT NULL ,
 input_tokens INTEGER NOT NULL ,
 cached_input_tokens INTEGER NOT NULL ,
 output_tokens INTEGER NOT NULL ,
 used_tokens INTEGER NOT NULL ,
 used_microusd INTEGER NOT NULL ,
 recorded_at TEXT NOT NULL,
 CONSTRAINT memory_derivation_usage_check_1 CHECK(length(provider_request_id) BETWEEN 1 AND 240),
 CONSTRAINT memory_derivation_usage_check_2 CHECK(length(receipt_sha256)=64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
 CONSTRAINT memory_derivation_usage_check_3 CHECK(typeof(input_tokens)='integer' AND input_tokens BETWEEN 0 AND 1000000),
 CONSTRAINT memory_derivation_usage_check_4 CHECK(typeof(cached_input_tokens)='integer' AND cached_input_tokens BETWEEN 0 AND input_tokens),
 CONSTRAINT memory_derivation_usage_check_5 CHECK(typeof(output_tokens)='integer' AND output_tokens BETWEEN 0 AND 1000000),
 CONSTRAINT memory_derivation_usage_check_6 CHECK(typeof(used_tokens)='integer' AND used_tokens=input_tokens+output_tokens),
 CONSTRAINT memory_derivation_usage_check_7 CHECK(typeof(used_microusd)='integer' AND used_microusd BETWEEN 0 AND 2000000000),
 CONSTRAINT memory_derivation_usage_check_8 CHECK(length(recorded_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at) IS recorded_at)
);
--> statement-breakpoint
CREATE TABLE memory_derivation_no_dispatch (
 finance_id TEXT PRIMARY KEY NOT NULL REFERENCES memory_derivation_finance(finance_id),
 evidence_sha256 TEXT NOT NULL ,
 token_was_present INTEGER NOT NULL ,
 cost_was_present INTEGER NOT NULL ,
 recorded_at TEXT NOT NULL,
 CONSTRAINT memory_derivation_no_dispatch_check_1 CHECK(length(evidence_sha256)=64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
 CONSTRAINT memory_derivation_no_dispatch_check_2 CHECK(typeof(token_was_present)='integer' AND token_was_present IN(0,1)),
 CONSTRAINT memory_derivation_no_dispatch_check_3 CHECK(typeof(cost_was_present)='integer' AND cost_was_present IN(0,1)),
 CONSTRAINT memory_derivation_no_dispatch_check_4 CHECK(length(recorded_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at) IS recorded_at)
);
--> statement-breakpoint
CREATE TABLE memory_derivation_job_finance (
 job_id TEXT PRIMARY KEY NOT NULL REFERENCES memory_derivation_jobs(job_id) ON DELETE CASCADE,
 finance_id TEXT NOT NULL UNIQUE REFERENCES memory_derivation_finance(finance_id)

);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_month_cap_no_replace BEFORE INSERT ON memory_derivation_month_caps WHEN EXISTS(SELECT 1 FROM memory_derivation_month_caps WHERE payer_id=NEW.payer_id AND period=NEW.period)
BEGIN SELECT RAISE(ABORT,'memory_finance_cap_cannot_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_month_cap_no_delete BEFORE DELETE ON memory_derivation_month_caps
BEGIN SELECT RAISE(ABORT,'memory_finance_cap_cannot_reset'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_month_cap_no_increase BEFORE UPDATE ON memory_derivation_month_caps WHEN NEW.payer_id IS NOT OLD.payer_id OR NEW.period IS NOT OLD.period OR NEW.cap_microusd>OLD.cap_microusd
BEGIN SELECT RAISE(ABORT,'memory_finance_cap_cannot_increase'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_grant_cap_floor AFTER INSERT ON memory_derivation_grants
BEGIN
 INSERT INTO memory_derivation_month_caps(payer_id,period,cap_microusd)
 SELECT NEW.payer_user_id,substr(NEW.consented_at,1,7),(SELECT MIN(monthly_cap_microusd) FROM memory_derivation_grants WHERE actor_user_id=NEW.payer_user_id AND substr(consented_at,1,7)=substr(NEW.consented_at,1,7))
 WHERE NOT EXISTS(SELECT 1 FROM memory_derivation_month_caps WHERE payer_id=NEW.payer_user_id AND period=substr(NEW.consented_at,1,7));
 UPDATE memory_derivation_month_caps SET cap_microusd=(SELECT MIN(monthly_cap_microusd) FROM memory_derivation_grants WHERE actor_user_id=NEW.payer_user_id AND substr(consented_at,1,7)=substr(NEW.consented_at,1,7))
 WHERE payer_id=NEW.payer_user_id AND period=substr(NEW.consented_at,1,7) AND cap_microusd>(SELECT MIN(monthly_cap_microusd) FROM memory_derivation_grants WHERE actor_user_id=NEW.payer_user_id AND substr(consented_at,1,7)=substr(NEW.consented_at,1,7)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_grant_cap_retire BEFORE DELETE ON memory_derivation_grants
BEGIN
 INSERT INTO memory_derivation_month_caps(payer_id,period,cap_microusd)
 SELECT OLD.payer_user_id,substr(OLD.consented_at,1,7),(SELECT MIN(monthly_cap_microusd) FROM memory_derivation_grants WHERE actor_user_id=OLD.payer_user_id AND substr(consented_at,1,7)=substr(OLD.consented_at,1,7))
 WHERE NOT EXISTS(SELECT 1 FROM memory_derivation_month_caps WHERE payer_id=OLD.payer_user_id AND period=substr(OLD.consented_at,1,7));
 UPDATE memory_derivation_month_caps SET cap_microusd=(SELECT MIN(monthly_cap_microusd) FROM memory_derivation_grants WHERE actor_user_id=OLD.payer_user_id AND substr(consented_at,1,7)=substr(OLD.consented_at,1,7))
 WHERE payer_id=OLD.payer_user_id AND period=substr(OLD.consented_at,1,7) AND cap_microusd>(SELECT MIN(monthly_cap_microusd) FROM memory_derivation_grants WHERE actor_user_id=OLD.payer_user_id AND substr(consented_at,1,7)=substr(OLD.consented_at,1,7)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_finance_no_replace BEFORE INSERT ON memory_derivation_finance WHEN EXISTS(SELECT 1 FROM memory_derivation_finance WHERE finance_id=NEW.finance_id OR token_id IN(NEW.token_id,NEW.cost_id) OR cost_id IN(NEW.token_id,NEW.cost_id) OR dispatch_token=NEW.dispatch_token)
BEGIN SELECT RAISE(ABORT,'memory_finance_cannot_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_finance_no_delete BEFORE DELETE ON memory_derivation_finance
BEGIN SELECT RAISE(ABORT,'memory_finance_cannot_reset'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_finance_immutable BEFORE UPDATE ON memory_derivation_finance WHEN NEW.finance_id IS NOT OLD.finance_id OR NEW.payer_id IS NOT OLD.payer_id OR NEW.period IS NOT OLD.period OR NEW.token_id IS NOT OLD.token_id OR NEW.cost_id IS NOT OLD.cost_id OR NEW.operation IS NOT OLD.operation OR NEW.provider IS NOT OLD.provider OR NEW.model IS NOT OLD.model OR NEW.terms_sha256 IS NOT OLD.terms_sha256 OR NEW.request_sha256 IS NOT OLD.request_sha256 OR NEW.input_price IS NOT OLD.input_price OR NEW.cached_input_price IS NOT OLD.cached_input_price OR NEW.output_price IS NOT OLD.output_price OR NEW.maximum_input IS NOT OLD.maximum_input OR NEW.maximum_output IS NOT OLD.maximum_output OR NEW.maximum_tokens IS NOT OLD.maximum_tokens OR NEW.maximum_microusd IS NOT OLD.maximum_microusd OR NEW.authorized_cap_microusd IS NOT OLD.authorized_cap_microusd OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.project_access_id IS NOT OLD.project_access_id OR NEW.pilot_cohort_id IS NOT OLD.pilot_cohort_id OR NEW.created_at IS NOT OLD.created_at OR OLD.admission_closed_at IS NOT NULL AND NEW.admission_closed_at IS NOT OLD.admission_closed_at OR OLD.dispatch_token IS NOT NULL AND (NEW.dispatch_token IS NOT OLD.dispatch_token OR NEW.dispatched_at IS NOT OLD.dispatched_at)
BEGIN SELECT RAISE(ABORT,'memory_finance_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_finance_admit BEFORE INSERT ON memory_derivation_finance
BEGIN 
 SELECT CASE WHEN NEW.dispatch_token IS NULL AND NEW.dispatched_at IS NULL AND NEW.admission_closed_at IS NULL
 AND NEW.period=strftime('%Y-%m','now') AND NEW.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND NOT EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id IN(NEW.token_id,NEW.cost_id))
 AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id IN(NEW.token_id,NEW.cost_id))
 AND NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes WHERE reservation_id IN(NEW.token_id,NEW.cost_id))
 AND NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes WHERE reservation_id IN(NEW.token_id,NEW.cost_id))
 AND EXISTS(SELECT 1 FROM memory_derivation_month_caps cap WHERE cap.payer_id=NEW.payer_id AND cap.period=NEW.period
   AND cap.cap_microusd<=NEW.authorized_cap_microusd
   AND NOT EXISTS(SELECT 1 FROM memory_derivation_grants prior WHERE prior.actor_user_id=NEW.payer_id AND substr(prior.consented_at,1,7)=NEW.period AND prior.monthly_cap_microusd<cap.cap_microusd)
   AND NEW.maximum_microusd+COALESCE((SELECT SUM(CASE WHEN unused.finance_id IS NOT NULL THEN 0 WHEN usage.finance_id IS NOT NULL THEN usage.used_microusd ELSE existing.maximum_microusd END)
 FROM memory_derivation_finance existing LEFT JOIN memory_derivation_usage usage ON usage.finance_id=existing.finance_id
 LEFT JOIN memory_derivation_no_dispatch unused ON unused.finance_id=existing.finance_id WHERE existing.payer_id=NEW.payer_id AND existing.period=NEW.period),0)<=cap.cap_microusd)
 THEN 1 ELSE RAISE(ABORT,'memory_finance_admission_unavailable') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_usage_no_replace BEFORE INSERT ON memory_derivation_usage WHEN EXISTS(SELECT 1 FROM memory_derivation_usage WHERE finance_id=NEW.finance_id OR provider_request_id=NEW.provider_request_id)
BEGIN SELECT RAISE(ABORT,'memory_finance_cannot_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_usage_no_update BEFORE UPDATE ON memory_derivation_usage
BEGIN SELECT RAISE(ABORT,'memory_finance_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_usage_no_delete BEFORE DELETE ON memory_derivation_usage
BEGIN SELECT RAISE(ABORT,'memory_finance_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_no_dispatch_no_replace BEFORE INSERT ON memory_derivation_no_dispatch WHEN EXISTS(SELECT 1 FROM memory_derivation_no_dispatch WHERE finance_id=NEW.finance_id)
BEGIN SELECT RAISE(ABORT,'memory_finance_cannot_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_no_dispatch_no_update BEFORE UPDATE ON memory_derivation_no_dispatch
BEGIN SELECT RAISE(ABORT,'memory_finance_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_no_dispatch_no_delete BEFORE DELETE ON memory_derivation_no_dispatch
BEGIN SELECT RAISE(ABORT,'memory_finance_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_usage_proof BEFORE INSERT ON memory_derivation_usage
BEGIN 
 SELECT CASE WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE f.finance_id=NEW.finance_id
 AND f.dispatch_token IS NOT NULL AND f.dispatched_at<=NEW.recorded_at AND NEW.recorded_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND NOT EXISTS(SELECT 1 FROM memory_derivation_no_dispatch WHERE finance_id=f.finance_id)
 AND NEW.used_microusd=((NEW.input_tokens-NEW.cached_input_tokens)*f.input_price+NEW.cached_input_tokens*f.cached_input_price+NEW.output_tokens*f.output_price+999999)/1000000)
 THEN 1 ELSE RAISE(ABORT,'memory_finance_usage_unverified') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_no_dispatch_proof BEFORE INSERT ON memory_derivation_no_dispatch
BEGIN 
 SELECT CASE WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f
 LEFT JOIN budget_reservations token ON token.reservation_id=f.token_id LEFT JOIN cost_budget_reservations cost ON cost.reservation_id=f.cost_id
 WHERE f.finance_id=NEW.finance_id AND f.admission_closed_at IS NOT NULL AND f.admission_closed_at<=NEW.recorded_at AND NEW.recorded_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND f.dispatch_token IS NULL AND f.dispatched_at IS NULL AND NOT EXISTS(SELECT 1 FROM memory_derivation_usage WHERE finance_id=f.finance_id)
 AND NEW.token_was_present=(token.reservation_id IS NOT NULL) AND NEW.cost_was_present=(cost.reservation_id IS NOT NULL)
 AND (token.reservation_id IS NULL OR (token.reservation_id=f.token_id AND token.owner_id=f.payer_id AND token.period=f.period AND token.operation=f.operation AND token.stream_id='memory-derivation:'||f.finance_id AND token.correlation_id=f.finance_id AND token.reserved_tokens=f.maximum_tokens) AND token.status='active' AND token.used_tokens=0 AND token.settled_at IS NULL)
 AND (cost.reservation_id IS NULL OR (cost.reservation_id=f.cost_id AND cost.owner_id=f.payer_id AND cost.period=f.period AND cost.operation=f.operation AND cost.stream_id='memory-derivation:'||f.finance_id AND cost.correlation_id=f.finance_id AND cost.reserved_microusd=f.maximum_microusd AND cost.workspace_id=f.workspace_id AND cost.allow_user_overage=0) AND cost.status IN('active','executing') AND cost.used_microusd=0 AND cost.settled_at IS NULL))
 THEN 1 ELSE RAISE(ABORT,'memory_finance_no_dispatch_unproven') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_job_finance_no_replace BEFORE INSERT ON memory_derivation_job_finance WHEN EXISTS(SELECT 1 FROM memory_derivation_job_finance WHERE job_id=NEW.job_id OR finance_id=NEW.finance_id)
BEGIN SELECT RAISE(ABORT,'memory_finance_private_binding_cannot_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_job_finance_no_update BEFORE UPDATE ON memory_derivation_job_finance
BEGIN SELECT RAISE(ABORT,'memory_finance_private_binding_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_job_finance_fence BEFORE DELETE ON memory_derivation_job_finance
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=OLD.job_id) THEN 1 ELSE RAISE(ABORT,'memory_finance_private_binding_retained') END; UPDATE memory_derivation_finance SET admission_closed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE finance_id=OLD.finance_id AND admission_closed_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_job_finance_proof BEFORE INSERT ON memory_derivation_job_finance
BEGIN 
 SELECT CASE WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f JOIN memory_derivation_jobs job ON job.job_id=NEW.job_id
 JOIN memory_derivation_grants g ON g.consent_id=job.consent_id
 JOIN memory_derivation_qualifications q ON q.qualification_id=g.qualification_id
 JOIN memory_live_enrollments parent ON parent.enrollment_id=g.enrollment_id AND parent.revision=g.enrollment_revision
 WHERE f.finance_id=NEW.finance_id
 AND f.workspace_id=COALESCE(g.organization_id,'forma') AND f.project_access_id IS g.project_access_id
 AND f.provider=json_extract(q.terms_json,'$.provider') AND f.model=json_extract(q.terms_json,'$.model')
 AND f.input_price=json_extract(q.terms_json,'$.pricing.inputMicroUsdPerMillion')
 AND f.cached_input_price=json_extract(q.terms_json,'$.pricing.cachedInputMicroUsdPerMillion')
 AND f.output_price=json_extract(q.terms_json,'$.pricing.outputMicroUsdPerMillion')
 AND f.maximum_input=json_extract(q.terms_json,'$.maximumInputTokens') AND f.maximum_output=json_extract(q.terms_json,'$.maximumOutputTokens')
 AND f.authorized_cap_microusd=json_extract(q.terms_json,'$.monthlyCapMicroUsd') AND q.terms_sha256=g.terms_sha256
 AND q.status='qualified' AND q.qualified_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND parent.learn_enabled=1 AND parent.background_enabled=1 AND parent.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND f.dispatch_token IS NULL AND f.admission_closed_at IS NULL
 AND f.payer_id=g.payer_user_id AND f.operation='memory-derivation:'||g.purpose AND f.terms_sha256=g.terms_sha256 AND f.authorized_cap_microusd=g.monthly_cap_microusd
 AND job.state='leased' AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.revoked_at IS NULL
 AND g.background_enabled=1 AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 THEN 1 ELSE RAISE(ABORT,'memory_finance_private_binding_unavailable') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_finance_dispatch BEFORE UPDATE OF dispatch_token,dispatched_at ON memory_derivation_finance WHEN NEW.dispatch_token IS NOT OLD.dispatch_token OR NEW.dispatched_at IS NOT OLD.dispatched_at
BEGIN 
 SELECT CASE WHEN OLD.dispatch_token IS NULL AND OLD.dispatched_at IS NULL AND NEW.dispatch_token IS NOT NULL AND NEW.dispatched_at IS NOT NULL
 AND OLD.admission_closed_at IS NULL AND NEW.admission_closed_at IS NULL AND OLD.period=strftime('%Y-%m','now')
 AND NEW.dispatched_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND NOT EXISTS(SELECT 1 FROM memory_derivation_usage WHERE finance_id=OLD.finance_id)
 AND NOT EXISTS(SELECT 1 FROM memory_derivation_no_dispatch WHERE finance_id=OLD.finance_id)
 AND EXISTS(SELECT 1 FROM memory_derivation_job_finance link JOIN memory_derivation_jobs job ON job.job_id=link.job_id
 JOIN memory_derivation_grants g ON g.consent_id=job.consent_id WHERE link.finance_id=OLD.finance_id AND job.state='leased'
 AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.revoked_at IS NULL AND g.background_enabled=1 AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 AND EXISTS(SELECT 1 FROM memory_derivation_finance f JOIN budget_reservations token ON token.reservation_id=f.token_id
 JOIN cost_budget_reservations cost ON cost.reservation_id=f.cost_id WHERE f.finance_id=OLD.finance_id
 AND (token.reservation_id=f.token_id AND token.owner_id=f.payer_id AND token.period=f.period AND token.operation=f.operation AND token.stream_id='memory-derivation:'||f.finance_id AND token.correlation_id=f.finance_id AND token.reserved_tokens=f.maximum_tokens) AND (cost.reservation_id=f.cost_id AND cost.owner_id=f.payer_id AND cost.period=f.period AND cost.operation=f.operation AND cost.stream_id='memory-derivation:'||f.finance_id AND cost.correlation_id=f.finance_id AND cost.reserved_microusd=f.maximum_microusd AND cost.workspace_id=f.workspace_id AND cost.allow_user_overage=0) AND token.status='active' AND cost.status='executing'
 AND token.used_tokens=0 AND cost.used_microusd=0 AND token.settled_at IS NULL AND cost.settled_at IS NULL)
 AND EXISTS(SELECT 1 FROM memory_derivation_month_caps cap WHERE cap.payer_id=NEW.payer_id AND cap.period=NEW.period
 AND COALESCE((SELECT SUM(CASE WHEN unused.finance_id IS NOT NULL THEN 0 WHEN usage.finance_id IS NOT NULL THEN usage.used_microusd ELSE existing.maximum_microusd END)
 FROM memory_derivation_finance existing LEFT JOIN memory_derivation_usage usage ON usage.finance_id=existing.finance_id
 LEFT JOIN memory_derivation_no_dispatch unused ON unused.finance_id=existing.finance_id WHERE existing.payer_id=NEW.payer_id AND existing.period=NEW.period),0)<=cap.cap_microusd)
 THEN 1 ELSE RAISE(ABORT,'memory_finance_dispatch_unavailable') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_token_hold_insert BEFORE INSERT ON budget_reservations WHEN EXISTS(SELECT 1 FROM memory_derivation_finance WHERE NEW.reservation_id IN(token_id,cost_id))
BEGIN 
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=NEW.reservation_id)
 AND EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE (NEW.reservation_id=f.token_id AND NEW.owner_id=f.payer_id AND NEW.period=f.period AND NEW.operation=f.operation AND NEW.stream_id='memory-derivation:'||f.finance_id AND NEW.correlation_id=f.finance_id AND NEW.reserved_tokens=f.maximum_tokens) AND f.dispatch_token IS NULL AND f.admission_closed_at IS NULL
 AND NEW.status='authorizing' AND NEW.used_tokens=0 AND NEW.settled_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM memory_derivation_no_dispatch WHERE finance_id=f.finance_id) AND NOT EXISTS(SELECT 1 FROM memory_derivation_usage WHERE finance_id=f.finance_id))
 THEN 1 ELSE RAISE(ABORT,'memory_finance_hold_unavailable') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_token_hold_no_delete BEFORE DELETE ON budget_reservations WHEN EXISTS(SELECT 1 FROM memory_derivation_finance WHERE token_id=OLD.reservation_id)
BEGIN SELECT RAISE(ABORT,'memory_finance_hold_cannot_reset'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_token_hold_incoming_identity BEFORE UPDATE ON budget_reservations WHEN NEW.reservation_id IS NOT OLD.reservation_id AND EXISTS(SELECT 1 FROM memory_derivation_finance WHERE NEW.reservation_id IN(token_id,cost_id))
BEGIN SELECT RAISE(ABORT,'memory_finance_hold_incoming_identity'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_token_hold_update BEFORE UPDATE ON budget_reservations WHEN EXISTS(SELECT 1 FROM memory_derivation_finance WHERE token_id=OLD.reservation_id) AND (NEW.reservation_id IS NOT OLD.reservation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.stream_id IS NOT OLD.stream_id OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.operation IS NOT OLD.operation OR NEW.period IS NOT OLD.period OR NEW.reserved_tokens IS NOT OLD.reserved_tokens OR NEW.created_at IS NOT OLD.created_at OR (NEW.status IS NOT OLD.status OR NEW.used_tokens IS NOT OLD.used_tokens OR NEW.settled_at IS NOT OLD.settled_at) AND NOT ((OLD.status='authorizing' AND NEW.status='active' AND NEW.used_tokens=0 AND NEW.settled_at IS NULL
 AND EXISTS(SELECT 1 FROM memory_derivation_finance WHERE token_id=OLD.reservation_id AND dispatch_token IS NULL AND admission_closed_at IS NULL)) OR (OLD.status='active' AND NEW.settled_at IS NOT NULL AND
 ((EXISTS(SELECT 1 FROM memory_derivation_finance f JOIN memory_derivation_usage usage ON usage.finance_id=f.finance_id
 WHERE f.token_id=OLD.reservation_id AND usage.used_tokens=NEW.used_tokens) AND NEW.status=CASE WHEN NEW.used_tokens=0 THEN 'released' ELSE 'settled' END)
 OR (NEW.status='released' AND NEW.used_tokens=0 AND EXISTS(SELECT 1 FROM memory_derivation_finance f
 JOIN memory_derivation_no_dispatch unused ON unused.finance_id=f.finance_id WHERE f.token_id=OLD.reservation_id AND unused.token_was_present=1))))))
BEGIN SELECT RAISE(ABORT,'memory_finance_hold_retained'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_cost_hold_insert BEFORE INSERT ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM memory_derivation_finance WHERE NEW.reservation_id IN(token_id,cost_id))
BEGIN 
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=NEW.reservation_id)
 AND EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE (NEW.reservation_id=f.cost_id AND NEW.owner_id=f.payer_id AND NEW.period=f.period AND NEW.operation=f.operation AND NEW.stream_id='memory-derivation:'||f.finance_id AND NEW.correlation_id=f.finance_id AND NEW.reserved_microusd=f.maximum_microusd AND NEW.workspace_id=f.workspace_id AND NEW.allow_user_overage=0) AND f.dispatch_token IS NULL AND f.admission_closed_at IS NULL
 AND NEW.status='authorizing' AND NEW.used_microusd=0 AND NEW.settled_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM memory_derivation_no_dispatch WHERE finance_id=f.finance_id) AND NOT EXISTS(SELECT 1 FROM memory_derivation_usage WHERE finance_id=f.finance_id))
 THEN 1 ELSE RAISE(ABORT,'memory_finance_hold_unavailable') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_cost_hold_no_delete BEFORE DELETE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM memory_derivation_finance WHERE cost_id=OLD.reservation_id)
BEGIN SELECT RAISE(ABORT,'memory_finance_hold_cannot_reset'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_cost_hold_incoming_identity BEFORE UPDATE ON cost_budget_reservations WHEN NEW.reservation_id IS NOT OLD.reservation_id AND EXISTS(SELECT 1 FROM memory_derivation_finance WHERE NEW.reservation_id IN(token_id,cost_id))
BEGIN SELECT RAISE(ABORT,'memory_finance_hold_incoming_identity'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_cost_hold_update BEFORE UPDATE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM memory_derivation_finance WHERE cost_id=OLD.reservation_id) AND (NEW.reservation_id IS NOT OLD.reservation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.stream_id IS NOT OLD.stream_id OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.operation IS NOT OLD.operation OR NEW.period IS NOT OLD.period OR NEW.reserved_microusd IS NOT OLD.reserved_microusd OR NEW.created_at IS NOT OLD.created_at OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.allow_user_overage IS NOT OLD.allow_user_overage OR (NEW.status IS NOT OLD.status OR NEW.used_microusd IS NOT OLD.used_microusd OR NEW.settled_at IS NOT OLD.settled_at) AND NOT ((OLD.status='authorizing' AND NEW.status='active' AND NEW.used_microusd=0 AND NEW.settled_at IS NULL
 AND EXISTS(SELECT 1 FROM memory_derivation_finance WHERE cost_id=OLD.reservation_id AND dispatch_token IS NULL AND admission_closed_at IS NULL)) OR (OLD.status='active' AND NEW.status='executing' AND NEW.used_microusd=0 AND NEW.settled_at IS NULL
 AND EXISTS(SELECT 1 FROM memory_derivation_finance WHERE cost_id=OLD.reservation_id AND dispatch_token IS NULL AND admission_closed_at IS NULL)) OR (OLD.status IN('active','executing') AND NEW.settled_at IS NOT NULL AND
 ((EXISTS(SELECT 1 FROM memory_derivation_finance f JOIN memory_derivation_usage usage ON usage.finance_id=f.finance_id
 WHERE f.cost_id=OLD.reservation_id AND usage.used_microusd=NEW.used_microusd) AND NEW.status=CASE WHEN NEW.used_microusd=0 THEN 'released' ELSE 'settled' END)
 OR (NEW.status='released' AND NEW.used_microusd=0 AND EXISTS(SELECT 1 FROM memory_derivation_finance f
 JOIN memory_derivation_no_dispatch unused ON unused.finance_id=f.finance_id WHERE f.cost_id=OLD.reservation_id AND unused.cost_was_present=1))))))
BEGIN SELECT RAISE(ABORT,'memory_finance_hold_retained'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_project_sidecar_insert BEFORE INSERT ON project_budget_reservation_scopes WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.reservation_id IN(f.token_id,f.cost_id))
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes WHERE (reservation_kind=NEW.reservation_kind AND reservation_id=NEW.reservation_id)) AND EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.actor_user_id=f.payer_id AND NEW.organization_id=f.workspace_id AND NEW.workspace_scope_id=f.workspace_id AND NEW.project_access_id=f.project_access_id AND ((NEW.reservation_kind='tokens' AND NEW.reservation_id=f.token_id) OR (NEW.reservation_kind='usd' AND NEW.reservation_id=f.cost_id)) AND f.dispatch_token IS NULL AND f.admission_closed_at IS NULL) THEN 1 ELSE RAISE(ABORT,'memory_finance_sidecar_unavailable') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_project_sidecar_no_update BEFORE UPDATE ON project_budget_reservation_scopes WHEN (EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE OLD.reservation_id IN(f.token_id,f.cost_id))) OR (EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.reservation_id IN(f.token_id,f.cost_id)))
BEGIN SELECT RAISE(ABORT,'memory_finance_sidecar_retained'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_project_sidecar_no_delete BEFORE DELETE ON project_budget_reservation_scopes WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE OLD.reservation_id IN(f.token_id,f.cost_id))
BEGIN SELECT RAISE(ABORT,'memory_finance_sidecar_retained'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_pilot_sidecar_insert BEFORE INSERT ON pilot_cost_reservation_scopes WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.reservation_id IN(f.token_id,f.cost_id))
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes WHERE reservation_id=NEW.reservation_id) AND EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.reservation_id=f.cost_id AND NEW.actor_user_id=f.payer_id AND NEW.organization_id=f.workspace_id AND NEW.cohort_id=f.pilot_cohort_id AND f.dispatch_token IS NULL AND f.admission_closed_at IS NULL) THEN 1 ELSE RAISE(ABORT,'memory_finance_sidecar_unavailable') END; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_pilot_sidecar_no_update BEFORE UPDATE ON pilot_cost_reservation_scopes WHEN (EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE OLD.reservation_id IN(f.token_id,f.cost_id))) OR (EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.reservation_id IN(f.token_id,f.cost_id)))
BEGIN SELECT RAISE(ABORT,'memory_finance_sidecar_retained'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_pilot_sidecar_no_delete BEFORE DELETE ON pilot_cost_reservation_scopes WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE OLD.reservation_id IN(f.token_id,f.cost_id))
BEGIN SELECT RAISE(ABORT,'memory_finance_sidecar_retained'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_token_counter_no_delete BEFORE DELETE ON budget_counters WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE OLD.period=f.period AND (OLD.scope='user' AND OLD.scope_id=f.payer_id OR OLD.scope='workspace' AND OLD.scope_id IN('forma',f.workspace_id)))
BEGIN SELECT RAISE(ABORT,'memory_finance_counter_retained'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_token_counter_identity BEFORE UPDATE ON budget_counters WHEN (NEW.scope IS NOT OLD.scope OR NEW.scope_id IS NOT OLD.scope_id OR NEW.period IS NOT OLD.period) AND ((EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE OLD.period=f.period AND (OLD.scope='user' AND OLD.scope_id=f.payer_id OR OLD.scope='workspace' AND OLD.scope_id IN('forma',f.workspace_id)))) OR (EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.period=f.period AND (NEW.scope='user' AND NEW.scope_id=f.payer_id OR NEW.scope='workspace' AND NEW.scope_id IN('forma',f.workspace_id)))))
BEGIN SELECT RAISE(ABORT,'memory_finance_counter_identity'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_token_counter_no_replace BEFORE INSERT ON budget_counters WHEN EXISTS(SELECT 1 FROM budget_counters current WHERE (current.scope,current.scope_id,current.period)=(NEW.scope,NEW.scope_id,NEW.period)) AND EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.period=f.period AND (NEW.scope='user' AND NEW.scope_id=f.payer_id OR NEW.scope='workspace' AND NEW.scope_id IN('forma',f.workspace_id)))
BEGIN SELECT RAISE(ABORT,'memory_finance_counter_cannot_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_cost_counter_no_delete BEFORE DELETE ON cost_budget_counters WHEN EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE OLD.period=f.period AND (OLD.scope='user' AND OLD.scope_id=f.payer_id OR OLD.scope='workspace' AND OLD.scope_id IN('forma',f.workspace_id)) OR f.pilot_cohort_id IS NOT NULL AND OLD.period='pilot:'||f.pilot_cohort_id AND (OLD.scope='pilot_org' AND OLD.scope_id=f.pilot_cohort_id OR OLD.scope='pilot_user' AND OLD.scope_id=f.payer_id))
BEGIN SELECT RAISE(ABORT,'memory_finance_counter_retained'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_cost_counter_identity BEFORE UPDATE ON cost_budget_counters WHEN (NEW.scope IS NOT OLD.scope OR NEW.scope_id IS NOT OLD.scope_id OR NEW.period IS NOT OLD.period) AND ((EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE OLD.period=f.period AND (OLD.scope='user' AND OLD.scope_id=f.payer_id OR OLD.scope='workspace' AND OLD.scope_id IN('forma',f.workspace_id)) OR f.pilot_cohort_id IS NOT NULL AND OLD.period='pilot:'||f.pilot_cohort_id AND (OLD.scope='pilot_org' AND OLD.scope_id=f.pilot_cohort_id OR OLD.scope='pilot_user' AND OLD.scope_id=f.payer_id))) OR (EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.period=f.period AND (NEW.scope='user' AND NEW.scope_id=f.payer_id OR NEW.scope='workspace' AND NEW.scope_id IN('forma',f.workspace_id)) OR f.pilot_cohort_id IS NOT NULL AND NEW.period='pilot:'||f.pilot_cohort_id AND (NEW.scope='pilot_org' AND NEW.scope_id=f.pilot_cohort_id OR NEW.scope='pilot_user' AND NEW.scope_id=f.payer_id))))
BEGIN SELECT RAISE(ABORT,'memory_finance_counter_identity'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_cost_counter_no_replace BEFORE INSERT ON cost_budget_counters WHEN EXISTS(SELECT 1 FROM cost_budget_counters current WHERE (current.scope,current.scope_id,current.period)=(NEW.scope,NEW.scope_id,NEW.period)) AND EXISTS(SELECT 1 FROM memory_derivation_finance f WHERE NEW.period=f.period AND (NEW.scope='user' AND NEW.scope_id=f.payer_id OR NEW.scope='workspace' AND NEW.scope_id IN('forma',f.workspace_id)) OR f.pilot_cohort_id IS NOT NULL AND NEW.period='pilot:'||f.pilot_cohort_id AND (NEW.scope='pilot_org' AND NEW.scope_id=f.pilot_cohort_id OR NEW.scope='pilot_user' AND NEW.scope_id=f.payer_id))
BEGIN SELECT RAISE(ABORT,'memory_finance_counter_cannot_replace'); END;
