-- Input to the offline fresh-install compiler, not a migration or upgrade.
CREATE TABLE generation_study_pair_transfers (
 pair_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id),
 plan_id TEXT NOT NULL, review_id TEXT NOT NULL REFERENCES generation_study_supplied_reviews(review_id), preview_id TEXT NOT NULL REFERENCES authoring_study_commits(preview_id),
 baseline_id TEXT NOT NULL UNIQUE REFERENCES generation_study_operations(operation_id),
 treatment_id TEXT NOT NULL UNIQUE REFERENCES generation_study_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 baseline_token_id TEXT NOT NULL, baseline_cost_id TEXT NOT NULL, baseline_lifecycle_id TEXT NOT NULL, treatment_token_id TEXT NOT NULL, treatment_cost_id TEXT NOT NULL, treatment_lifecycle_id TEXT NOT NULL,
 baseline_policy TEXT NOT NULL, treatment_policy TEXT NOT NULL, pair_json TEXT NOT NULL CHECK(json_valid(pair_json)),
 provider_request_id TEXT NOT NULL, artifact_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, evidence_set_hash TEXT NOT NULL,
 stream_id TEXT NOT NULL, period TEXT NOT NULL, baseline_cost INTEGER NOT NULL, baseline_lifecycle INTEGER NOT NULL, baseline_tokens INTEGER NOT NULL,
 treatment_cost INTEGER NOT NULL, treatment_lifecycle INTEGER NOT NULL, treatment_tokens INTEGER NOT NULL,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, CHECK(baseline_id!=treatment_id),
 CHECK(baseline_cost>0 AND baseline_lifecycle>0 AND baseline_tokens>0 AND treatment_cost>0 AND treatment_lifecycle>0 AND treatment_tokens>0)
);
CREATE VIEW generation_study_pair_eligible AS
 SELECT json_extract(bf.policy_json,'$.pair.id') AS pair_id,o.owner_id,o.grant_id,o.plan_id,r.review_id,a.preview_id,o.operation_id AS baseline_id,
 tf.operation_id AS treatment_id,bf.policy_id AS baseline_policy,tf.policy_id AS treatment_policy,json_extract(bf.policy_json,'$.pair') AS pair_json,
 o.provider_request_id,o.artifact_hash,o.receipt_hash,o.expires_at,o.token_reservation_id AS baseline_token_id,o.cost_reservation_id AS baseline_cost_id,o.lifecycle_reservation_id AS baseline_lifecycle_id,
 json_extract(tf.policy_json,'$.pair.arms[1].tokenReservationId') AS treatment_token_id,json_extract(tf.policy_json,'$.pair.arms[1].costReservationId') AS treatment_cost_id,json_extract(tf.policy_json,'$.pair.arms[1].lifecycleReservationId') AS treatment_lifecycle_id,
 json_extract(bf.policy_json,'$.reservationMicrousd') AS baseline_cost,json_extract(bf.policy_json,'$.lifecycleReserveMicrousd') AS baseline_lifecycle,
 json_extract(bf.policy_json,'$.pair.arms[0].tokens') AS baseline_tokens,
 json_extract(tf.policy_json,'$.reservationMicrousd') AS treatment_cost,json_extract(tf.policy_json,'$.lifecycleReserveMicrousd') AS treatment_lifecycle,
 json_extract(tf.policy_json,'$.pair.arms[1].tokens') AS treatment_tokens
 FROM generation_study_operations o
 JOIN generation_study_grants g ON g.grant_id=o.grant_id AND g.owner_id=o.owner_id AND g.plan_id=o.plan_id
 JOIN generation_study_financial_grants bf ON bf.grant_id=g.grant_id AND bf.operation_id=o.operation_id AND bf.owner_id=o.owner_id AND bf.policy_id=o.financial_policy_id
 JOIN generation_study_financial_grants tf ON tf.grant_id=g.grant_id AND tf.owner_id=o.owner_id AND tf.operation_id=json_extract(bf.policy_json,'$.pair.arms[1].operationId')
 JOIN generation_study_supplied_reviews r ON r.grant_id=g.grant_id AND r.owner_id=o.owner_id
 JOIN generation_study_supplied_observations v ON v.operation_id=o.operation_id AND v.review_id=r.review_id AND v.owner_id=o.owner_id AND v.principal_hash=r.principal_hash
 JOIN authoring_study_commits a ON a.grant_id=g.grant_id AND a.review_id=r.review_id AND a.owner_id=o.owner_id AND a.plan_id=o.plan_id AND a.principal_hash=r.principal_hash AND a.baseline_operation=o.operation_id AND a.treatment_operation=tf.operation_id
 JOIN authoring_study_configurations cfg ON cfg.proposal_id=a.proposal_id AND cfg.owner_id=o.owner_id AND cfg.configuration_hash=a.configuration_hash
 JOIN budget_reservations bt ON bt.reservation_id=o.token_reservation_id AND bt.owner_id=o.owner_id
 JOIN cost_budget_reservations bc ON bc.reservation_id=o.cost_reservation_id AND bc.owner_id=o.owner_id
 JOIN cost_budget_reservations bl ON bl.reservation_id=o.lifecycle_reservation_id AND bl.owner_id=o.owner_id
 LEFT JOIN generation_study_operations t ON t.operation_id=tf.operation_id
 WHERE (((((g.authority_version='authoring-study-v2' AND a.version=2 AND a.verified=1 AND cfg.status='active')
 AND ((g.status='authorized' AND g.stopped=0 AND bf.status='authorized' AND tf.status='authorized' AND r.status='authorized' AND r.hard_stop IS NULL)
 AND (o.status='hold' AND o.reason='original_charge_unreconciled' AND o.trial_id='baseline')))
 AND (((o.pair_yield_to IS NULL OR o.pair_yield_to=tf.operation_id))
 AND ((o.pair_artifact_verified_hash=o.artifact_hash AND o.provider_request_id IS NOT NULL AND o.artifact_ref IS NOT NULL AND o.artifact_hash=v.artifact_hash AND o.receipt_hash=v.receipt_hash AND o.private_writes=9)
 AND (json_valid(o.usage_json) AND json_type(o.usage_json,'$.input_tokens')='integer' AND json_type(o.usage_json,'$.output_tokens')='integer' AND json_type(o.usage_json,'$.total_tokens')='integer'))))
 AND (((json_extract(o.usage_json,'$.total_tokens')<=bt.reserved_tokens)
 AND ((v.safety='clear' AND v.fidelity IN('pass','expected-failure') AND v.protocol='p2-human-between-arm-v1' AND v.resume=1)
 AND ((SELECT COUNT(*) FROM generation_study_stages s WHERE s.operation_id=o.operation_id AND ((s.stage IN('advisory','moderation') AND s.status='complete') OR (s.stage='image' AND s.status='received' AND s.receipt_hash=o.receipt_hash) OR (s.stage='storage' AND s.status='complete' AND s.receipt_hash=o.artifact_hash)))=4)))
 AND ((((SELECT COUNT(*) FROM generation_study_evidence e JOIN private_content p ON p.content_id=e.content_ref WHERE e.operation_id=o.operation_id AND p.owner_id=o.owner_id AND p.redacted_at IS NULL AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))=9)
 AND (bf.expires_at=o.expires_at AND tf.expires_at=o.expires_at AND g.expires_at=o.expires_at AND r.expires_at=o.expires_at AND a.expires_at=o.expires_at AND cfg.expires_at=o.expires_at AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 AND ((json_extract(bf.policy_json,'$.version')='generation-financial-policy-v2' AND json_extract(tf.policy_json,'$.version')='generation-financial-policy-v2')
 AND (json_extract(bf.policy_json,'$.pair')=json_extract(tf.policy_json,'$.pair'))))))
 AND ((((json_extract(bf.policy_json,'$.pair.ownerId')=o.owner_id AND json_extract(bf.policy_json,'$.pair.grantId')=g.grant_id AND json_extract(bf.policy_json,'$.pair.planId')=o.plan_id AND json_extract(bf.policy_json,'$.pair.proposalId')=a.proposal_id)
 AND ((json_extract(bf.policy_json,'$.pair.arms[0].operationId')=o.operation_id AND json_extract(bf.policy_json,'$.pair.arms[0].tokenReservationId')=o.token_reservation_id AND json_extract(bf.policy_json,'$.pair.arms[0].costReservationId')=o.cost_reservation_id AND json_extract(bf.policy_json,'$.pair.arms[0].lifecycleReservationId')=o.lifecycle_reservation_id)
 AND (json_extract(bf.policy_json,'$.pairAcceptance.decision')='ALLOW_EXACT_TREATMENT_WITH_BASELINE_UNSETTLED' AND json_extract(tf.policy_json,'$.pairAcceptance.decision')='ALLOW_EXACT_TREATMENT_WITH_BASELINE_UNSETTLED')))
 AND ((bt.status='active' AND bc.status='active' AND bl.status='active')
 AND ((bt.reserved_tokens=json_extract(bf.policy_json,'$.pair.arms[0].tokens') AND bc.reserved_microusd=json_extract(bf.policy_json,'$.reservationMicrousd') AND bl.reserved_microusd=json_extract(bf.policy_json,'$.lifecycleReserveMicrousd'))
 AND (json_extract(bf.policy_json,'$.lifecycle.through')>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_extract(tf.policy_json,'$.lifecycle.through')>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))
 AND (((NOT EXISTS(SELECT 1 FROM generation_study_operations other WHERE other.owner_id=o.owner_id AND other.status!='completed' AND other.operation_id NOT IN(o.operation_id,tf.operation_id)))
 AND ((NOT EXISTS(SELECT 1 FROM budget_reservations q WHERE q.owner_id=o.owner_id AND q.status IN('authorizing','active') AND q.reservation_id!=o.token_reservation_id AND (t.operation_id IS NULL OR q.reservation_id!=t.token_reservation_id)))
 AND (NOT EXISTS(SELECT 1 FROM cost_budget_reservations q WHERE q.owner_id=o.owner_id AND q.status NOT IN('settled','released') AND q.reservation_id NOT IN(o.cost_reservation_id,o.lifecycle_reservation_id) AND (t.operation_id IS NULL OR q.reservation_id NOT IN(t.cost_reservation_id,t.lifecycle_reservation_id))))))
 AND (((NOT EXISTS(SELECT 1 FROM output_provider_calls c JOIN output_execution_grants g ON g.scope_key=c.scope_key AND g.grant_id=(SELECT grant_id FROM output_operation_slots s WHERE s.scope_key=c.scope_key AND s.slot_id=c.slot_id) WHERE g.payer_user_id=o.owner_id AND c.status NOT IN('settled','rejected')))
 AND (NOT EXISTS(SELECT 1 FROM document_jobs j WHERE j.owner_id=o.owner_id AND (j.status IN('queued','running','committing') OR json_extract(j.result_json,'$.providerSubmissionLegacyUncertain')=1 OR json_extract(j.result_json,'$.model3dProviderSubmission')='pending' OR EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(j.result_json,'$.providerSubmissions'),'{}')) WHERE (json_extract(value,'$.status') IS NULL OR json_extract(value,'$.status') NOT IN('completed','rejected') OR json_extract(value,'$.accountingState')='unknown' OR json_extract(value,'$.status')='completed' AND COALESCE(json_type(value,'$.costMicrousd'),'missing') NOT IN('integer','real')))))))
 AND ((NOT EXISTS(SELECT 1 FROM consequential_execution_steps s JOIN consequential_executions e USING(execution_id) WHERE e.actor_user_id=o.owner_id AND s.status NOT IN('settled','not-submitted')))
 AND (NOT EXISTS(SELECT 1 FROM generation_study_reconciliations q WHERE q.operation_id=o.operation_id AND (q.policy_id!=o.financial_policy_id OR q.provider_settled!=0 OR q.lifecycle_closed!=0 OR q.incurred_microusd>bc.reserved_microusd OR q.incurred_tokens>bt.reserved_tokens OR q.lifecycle_microusd>bl.reserved_microusd OR q.lifecycle_through!=json_extract(bf.policy_json,'$.lifecycle.through') OR q.lifecycle_scope!=json_extract(bf.policy_json,'$.lifecycle.scope') OR q.liability_owner!=o.owner_id))))))));
CREATE TRIGGER generation_study_pair_transfer_admission BEFORE INSERT ON generation_study_pair_transfers
 WHEN NOT EXISTS(SELECT 1 FROM generation_study_pair_eligible e WHERE e.pair_id=NEW.pair_id AND e.owner_id=NEW.owner_id AND e.grant_id=NEW.grant_id AND e.plan_id=NEW.plan_id AND e.review_id=NEW.review_id AND e.preview_id=NEW.preview_id AND e.baseline_id=NEW.baseline_id AND e.treatment_id=NEW.treatment_id AND e.baseline_token_id=NEW.baseline_token_id AND e.baseline_cost_id=NEW.baseline_cost_id AND e.baseline_lifecycle_id=NEW.baseline_lifecycle_id AND e.treatment_token_id=NEW.treatment_token_id AND e.treatment_cost_id=NEW.treatment_cost_id AND e.treatment_lifecycle_id=NEW.treatment_lifecycle_id AND e.baseline_policy=NEW.baseline_policy AND e.treatment_policy=NEW.treatment_policy AND e.pair_json=NEW.pair_json AND e.provider_request_id=NEW.provider_request_id AND e.artifact_hash=NEW.artifact_hash AND e.receipt_hash=NEW.receipt_hash AND e.expires_at=NEW.expires_at AND e.baseline_cost=NEW.baseline_cost AND e.baseline_lifecycle=NEW.baseline_lifecycle AND e.baseline_tokens=NEW.baseline_tokens AND e.treatment_cost=NEW.treatment_cost AND e.treatment_lifecycle=NEW.treatment_lifecycle AND e.treatment_tokens=NEW.treatment_tokens)
 OR EXISTS(SELECT 1 FROM generation_study_operations WHERE operation_id=NEW.treatment_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_pair_transfer_denied'); END;
CREATE TRIGGER generation_study_pair_transfer_identity BEFORE UPDATE ON generation_study_pair_transfers BEGIN SELECT RAISE(ABORT,'generation_study_pair_transfer_immutable'); END;
CREATE TRIGGER generation_study_pair_transfer_no_delete BEFORE DELETE ON generation_study_pair_transfers BEGIN SELECT RAISE(ABORT,'generation_study_pair_transfer_immutable'); END;
CREATE TRIGGER generation_study_pair_yield_guard BEFORE UPDATE OF pair_yield_to ON generation_study_operations
 WHEN NEW.pair_yield_to IS NOT OLD.pair_yield_to AND (OLD.pair_yield_to IS NOT NULL OR NEW.pair_yield_to IS NULL OR NOT EXISTS(SELECT 1 FROM generation_study_pair_transfers x JOIN generation_study_pair_eligible e USING(pair_id) WHERE x.baseline_id=OLD.operation_id AND x.treatment_id=NEW.pair_yield_to AND x.owner_id=OLD.owner_id))
 BEGIN SELECT RAISE(ABORT,'generation_study_pair_yield_denied'); END;
CREATE TRIGGER generation_study_pair_operation_admission BEFORE INSERT ON generation_study_operations
 WHEN NEW.pair_yield_to IS NOT NULL OR NEW.pair_artifact_verified_hash IS NOT NULL OR NEW.pair_head_reads!=0 OR EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND NOT EXISTS(SELECT 1 FROM generation_study_pair_transfers x JOIN generation_study_pair_eligible e USING(pair_id) WHERE x.baseline_id=o.operation_id AND o.pair_yield_to=NEW.operation_id AND x.treatment_id=NEW.operation_id AND x.owner_id=NEW.owner_id AND x.grant_id=NEW.grant_id AND x.plan_id=NEW.plan_id AND NEW.trial_id='treatment' AND NEW.token_reservation_id=x.treatment_token_id AND NEW.cost_reservation_id=x.treatment_cost_id AND NEW.lifecycle_reservation_id=x.treatment_lifecycle_id AND NEW.financial_policy_id=x.treatment_policy AND NEW.status='reserved' AND NEW.expires_at=x.expires_at))
 BEGIN SELECT RAISE(ABORT,'generation_study_pair_operation_denied'); END;

CREATE TRIGGER generation_study_pair_artifact_verification BEFORE UPDATE OF pair_artifact_verified_hash ON generation_study_operations
 WHEN NEW.pair_artifact_verified_hash IS NOT OLD.pair_artifact_verified_hash AND (OLD.pair_artifact_verified_hash IS NOT NULL OR NEW.pair_artifact_verified_hash IS NOT NEW.artifact_hash OR NEW.artifact_reads<1)
 BEGIN SELECT RAISE(ABORT,'generation_study_original_artifact_required'); END;

CREATE TRIGGER generation_study_pair_head_monotonic BEFORE UPDATE OF pair_head_reads ON generation_study_operations
 WHEN NEW.pair_head_reads!=OLD.pair_head_reads+1 OR NEW.trial_id!='baseline'
 BEGIN SELECT RAISE(ABORT,'generation_study_pair_head_limit'); END;
