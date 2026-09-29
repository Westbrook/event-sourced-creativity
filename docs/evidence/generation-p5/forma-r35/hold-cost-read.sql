-- PROPOSED FIXED READ ONLY; NOT EXECUTED ON HOSTED DATA.
-- Bind :owner_id from current trusted personal actor, :observed_at from server time.
-- This returns per-reservation redacted metadata, not unique operations or clearance.
SELECT
 CASE WHEN r.status IN ('authorizing','active','executing','exceeded') THEN r.status ELSE 'other-unsettled' END AS reservation_state,
 CASE WHEN r.operation IN ('generation-study','study-lifecycle-provision','image-generation','image-preview','video-generation') THEN r.operation ELSE 'other-or-unknown' END AS operation_class,
 CASE WHEN julianday(r.created_at) IS NULL OR julianday(r.created_at)>julianday(:observed_at) THEN 'unknown'
      WHEN julianday(:observed_at)-julianday(r.created_at)<1 THEN 'under-1-day'
      WHEN julianday(:observed_at)-julianday(r.created_at)<7 THEN '1-to-7-days' ELSE '7-days-or-more' END AS age_bucket,
 (SELECT COUNT(*) FROM (SELECT 1 FROM document_jobs j WHERE j.owner_id=:owner_id AND j.stream_id=r.stream_id
   AND (j.correlation_id=r.correlation_id OR j.job_id=r.correlation_id OR json_extract(CASE WHEN json_valid(j.result_json) THEN j.result_json ELSE '{}' END,'$.costReservationId')=r.reservation_id) LIMIT 2)) AS document_matches_capped2,
 EXISTS(SELECT 1 FROM output_operation_slots s JOIN output_execution_grants g ON g.scope_key=s.scope_key AND g.grant_id=s.grant_id
   WHERE g.payer_user_id=:owner_id AND s.cost_reservation_id=r.reservation_id) AS output_binding_candidate,
 EXISTS(SELECT 1 FROM consequential_execution_steps s JOIN consequential_executions e USING(execution_id)
   WHERE e.actor_user_id=:owner_id AND s.cost_reservation_id=r.reservation_id) AS consequential_binding_candidate
FROM cost_budget_reservations r WHERE r.owner_id=:owner_id AND r.status NOT IN ('settled','released')
ORDER BY r.reservation_id LIMIT 101;
