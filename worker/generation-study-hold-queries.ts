// Fixed R35 queries. No request-selected SQL or bindings.
export const HOLD_QUERIES={
  "token": {
    "sql": "SELECT\n CASE WHEN r.status IN ('authorizing','active','executing','exceeded') THEN r.status ELSE 'other-unsettled' END AS reservation_state,\n CASE WHEN r.operation IN ('generation-study','study-lifecycle-provision','image-generation','image-preview','video-generation') THEN r.operation ELSE 'other-or-unknown' END AS operation_class,\n CASE WHEN julianday(r.created_at) IS NULL OR julianday(r.created_at)>julianday(?) THEN 'unknown'\n      WHEN julianday(?)-julianday(r.created_at)<1 THEN 'under-1-day'\n      WHEN julianday(?)-julianday(r.created_at)<7 THEN '1-to-7-days' ELSE '7-days-or-more' END AS age_bucket,\n (SELECT COUNT(*) FROM (SELECT 1 FROM document_jobs j WHERE j.owner_id=? AND j.stream_id=r.stream_id\n   AND (j.correlation_id=r.correlation_id OR j.job_id=r.correlation_id OR json_extract(CASE WHEN json_valid(j.result_json) THEN j.result_json ELSE '{}' END,'$.reservationId')=r.reservation_id) LIMIT 2)) AS document_matches_capped2,\n EXISTS(SELECT 1 FROM output_operation_slots s JOIN output_execution_grants g ON g.scope_key=s.scope_key AND g.grant_id=s.grant_id\n   WHERE g.payer_user_id=? AND s.token_reservation_id=r.reservation_id) AS output_binding_candidate,\n EXISTS(SELECT 1 FROM consequential_execution_steps s JOIN consequential_executions e USING(execution_id)\n   WHERE e.actor_user_id=? AND s.token_reservation_id=r.reservation_id) AS consequential_binding_candidate\nFROM budget_reservations r WHERE r.owner_id=? AND r.status IN ('authorizing','active')\nORDER BY r.reservation_id LIMIT 101",
    "bindings": [
      "observed_at",
      "observed_at",
      "observed_at",
      "owner_id",
      "owner_id",
      "owner_id",
      "owner_id"
    ]
  },
  "cost": {
    "sql": "SELECT\n CASE WHEN r.status IN ('authorizing','active','executing','exceeded') THEN r.status ELSE 'other-unsettled' END AS reservation_state,\n CASE WHEN r.operation IN ('generation-study','study-lifecycle-provision','image-generation','image-preview','video-generation') THEN r.operation ELSE 'other-or-unknown' END AS operation_class,\n CASE WHEN julianday(r.created_at) IS NULL OR julianday(r.created_at)>julianday(?) THEN 'unknown'\n      WHEN julianday(?)-julianday(r.created_at)<1 THEN 'under-1-day'\n      WHEN julianday(?)-julianday(r.created_at)<7 THEN '1-to-7-days' ELSE '7-days-or-more' END AS age_bucket,\n (SELECT COUNT(*) FROM (SELECT 1 FROM document_jobs j WHERE j.owner_id=? AND j.stream_id=r.stream_id\n   AND (j.correlation_id=r.correlation_id OR j.job_id=r.correlation_id OR json_extract(CASE WHEN json_valid(j.result_json) THEN j.result_json ELSE '{}' END,'$.costReservationId')=r.reservation_id) LIMIT 2)) AS document_matches_capped2,\n EXISTS(SELECT 1 FROM output_operation_slots s JOIN output_execution_grants g ON g.scope_key=s.scope_key AND g.grant_id=s.grant_id\n   WHERE g.payer_user_id=? AND s.cost_reservation_id=r.reservation_id) AS output_binding_candidate,\n EXISTS(SELECT 1 FROM consequential_execution_steps s JOIN consequential_executions e USING(execution_id)\n   WHERE e.actor_user_id=? AND s.cost_reservation_id=r.reservation_id) AS consequential_binding_candidate\nFROM cost_budget_reservations r WHERE r.owner_id=? AND r.status NOT IN ('settled','released')\nORDER BY r.reservation_id LIMIT 101",
    "bindings": [
      "observed_at",
      "observed_at",
      "observed_at",
      "owner_id",
      "owner_id",
      "owner_id",
      "owner_id"
    ]
  }
} as const;
