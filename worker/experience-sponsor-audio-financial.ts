/** Original V8 monetary identity only. This static SQL creates no capability.
 * Exactly two bindings: original job id, then its personal actor user id. The
 * aliases match the common financial reader and its retained assertion.
 *
 * The frozen V8 recipe has two 500,000-microusd planner allowances and one
 * 37,600-microusd render allowance. These are original reservation ceilings,
 * not invoices or a tariff used to reprice incurred usage. Route rows carry
 * stage/model/count; native call claims separately enforce each paid call cap.
 *
 * Immutable issuance holds the actor request/review digests. Its original
 * deadline identifies the original execution grant; it is deliberately not tested against
 * the current clock. No current campaign, creative source, or body is read.
 * The original personal reservation pair belongs to Forma and has no project
 * or cost-pilot ledger association. Current membership is not consulted.
 * Financial capability ownership remains in experience-sponsor-execution.ts.
 * Balanced conjunctions keep the complete SELECT/assertion within D1 depth.
 */
export const AUDIO_FINANCIAL_FROM = `FROM document_jobs job
 JOIN output_operation_slots slot ON slot.job_id=job.job_id
 JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN experience_sponsor_consumptions consumption ON consumption.job_id=job.job_id AND consumption.actor_user_id=execution.actor_user_id
 JOIN experience_sponsor_grants issued ON issued.grant_id=consumption.grant_id AND issued.campaign_id=consumption.campaign_id
 JOIN budget_reservations tokens ON tokens.reservation_id=slot.token_reservation_id
 JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
 WHERE ((((((job.job_id=?)
 AND (job.owner_id=?))
 AND ((execution.actor_user_id=job.owner_id)
 AND ((plan.scope_kind='personal')
 AND (plan.owner_user_id=job.owner_id))))
 AND (((plan.document_id=job.document_id)
 AND ((plan.organization_id IS NULL)
 AND (plan.project_access_id IS NULL)))
 AND ((plan.source_digest=slot.source_digest)
 AND ((job.stream_id='creative:'||job.owner_id)
 AND (job.kind='render_document')))))
 AND ((((job.source_surface='outputs')
 AND ((execution.context_id IS NULL)
 AND (execution.plan_revision_id=slot.plan_revision_id)))
 AND ((execution.payer_user_id<>execution.actor_user_id)
 AND ((slot.attempt_ordinal=0)
 AND (slot.previous_slot_id IS NULL))))
 AND (((execution.maximum_microusd=slot.maximum_microusd)
 AND ((execution.maximum_calls=3)
 AND (slot.maximum_calls=3)))
 AND (((SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1)
 AND ((consumption.maximum_microusd=slot.maximum_microusd)
 AND (issued.actor_user_id=consumption.actor_user_id))))))
 AND (((((issued.session_digest=consumption.session_digest)
 AND ((issued.intent_key=consumption.intent_key)
 AND (issued.envelope_digest=consumption.envelope_digest)))
 AND ((tokens.owner_id=execution.payer_user_id)
 AND ((cost.owner_id=execution.payer_user_id)
 AND (tokens.stream_id=job.stream_id))))
 AND (((cost.stream_id=job.stream_id)
 AND ((tokens.correlation_id=job.correlation_id)
 AND (cost.correlation_id=job.correlation_id)))
 AND ((tokens.operation='document-render:audio')
 AND ((cost.operation=tokens.operation)
 AND (cost.period=tokens.period)))))
 AND ((((tokens.reserved_tokens=slot.maximum_tokens)
 AND ((cost.reserved_microusd=slot.maximum_microusd)
 AND (((cost.allow_user_overage=0)
 AND (cost.workspace_id='forma'))
 AND ((NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes billing WHERE billing.reservation_id IN(tokens.reservation_id,cost.reservation_id)))
 AND (NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes fixed WHERE fixed.reservation_id=cost.reservation_id))))))
 AND ((slot.provider='fal')
 AND ((slot.model='fal-ai/stable-audio-3/medium/text-to-audio')
 AND (slot.maximum_tokens=128000))))
 AND (((slot.maximum_microusd=1037600)
 AND (((SELECT COUNT(*) FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id)=3)
 AND (EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id AND route.stage_key='planning:0:initial' AND route.provider='openai' AND route.model='gpt-5.6-terra' AND route.maximum_calls=1))))
 AND ((EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id AND route.stage_key='planning:0:repair' AND route.provider='openai' AND route.model='gpt-5.6-terra' AND route.maximum_calls=1))
 AND ((EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id AND route.stage_key='audio:initial' AND route.provider='fal' AND route.model='fal-ai/stable-audio-3/medium/text-to-audio' AND route.maximum_calls=1))
 AND (EXISTS(SELECT 1 FROM experience_sponsor_issuances original WHERE ((((((original.grant_id=issued.grant_id)
 AND ((original.campaign_id=issued.campaign_id)
 AND (original.actor_user_id=job.owner_id)))
 AND ((original.intent_key=consumption.intent_key)
 AND ((original.envelope_digest=consumption.envelope_digest)
 AND (original.policy_digest=issued.policy_digest))))
 AND (((json_extract(original.envelope_json,'$.version')=8)
 AND ((json_extract(original.envelope_json,'$.family')='canonical-instrumental-cue@1')
 AND (json_extract(original.envelope_json,'$.recipe.appId')='audio')))
 AND ((json_extract(original.envelope_json,'$.recipe.outputKind')='audio')
 AND ((json_extract(original.envelope_json,'$.recipe.provider')=slot.provider)
 AND (json_extract(original.envelope_json,'$.recipe.model')=slot.model)))))
 AND ((((json_extract(original.envelope_json,'$.recipe.routeDigest')='sha256:'||slot.route_digest)
 AND ((json_extract(original.envelope_json,'$.sourceDigest')='sha256:'||slot.source_digest)
 AND (json_extract(original.envelope_json,'$.recipe.maximumTokens')=slot.maximum_tokens)))
 AND ((json_extract(original.envelope_json,'$.recipe.maximumMicrousd')=slot.maximum_microusd)
 AND ((json_extract(original.envelope_json,'$.recipe.calls.parsing')=0)
 AND (json_extract(original.envelope_json,'$.recipe.calls.planning')=1))))
 AND (((json_extract(original.envelope_json,'$.recipe.calls.render')=1)
 AND ((json_extract(original.envelope_json,'$.recipe.calls.repair')=1)
 AND (json_extract(original.envelope_json,'$.recipe.outputCount')=1)))
 AND ((json_extract(original.envelope_json,'$.recipe.durationMs')=20000)
 AND ((json_extract(original.envelope_json,'$.recipe.width')=0)
 AND (json_extract(original.envelope_json,'$.recipe.height')=0))))))
 AND (((((json_extract(original.envelope_json,'$.payerUserId')=execution.payer_user_id)
 AND ((json_extract(original.envelope_json,'$.actorKind')='canonical-principal')
 AND (json_extract(original.envelope_json,'$.actorUserId')=job.owner_id)))
 AND ((json_extract(original.envelope_json,'$.ownerUserId')=job.owner_id)
 AND ((json_extract(original.envelope_json,'$.campaignId')=consumption.campaign_id)
 AND (json_extract(original.envelope_json,'$.consumptionId')=consumption.consumption_id))))
 AND (((json_extract(original.envelope_json,'$.sessionDigest')=consumption.session_digest)
 AND ((json_extract(original.envelope_json,'$.intentKey')=consumption.intent_key)
 AND (json_extract(original.envelope_json,'$.documentId')=plan.document_id)))
 AND ((json_extract(original.envelope_json,'$.projectId')=plan.project_id)
 AND ((json_extract(original.envelope_json,'$.sourceRevision')=plan.source_head)
 AND (json_extract(original.envelope_json,'$.issuedAtMs')=issued.issued_at_ms)))))
 AND ((((json_extract(original.envelope_json,'$.expiresAtMs')=issued.expires_at_ms)
 AND ((json_extract(original.envelope_json,'$.originalRequestId')=job.job_id)
 AND (json_type(original.envelope_json,'$.originalExpiresAtMs')='integer')))
 AND ((json_extract(original.envelope_json,'$.originalExpiresAtMs') BETWEEN 1 AND 8640000000000000)
 AND ((strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(original.envelope_json,'$.originalExpiresAtMs')/1000.0,'unixepoch')=execution.expires_at)
 AND (json_type(original.envelope_json,'$.audioActorRequestDigest')='text'))))
 AND (((length(json_extract(original.envelope_json,'$.audioActorRequestDigest'))=71)
 AND ((substr(json_extract(original.envelope_json,'$.audioActorRequestDigest'),1,7)='sha256:')
 AND (substr(json_extract(original.envelope_json,'$.audioActorRequestDigest'),8) NOT GLOB '*[^a-f0-9]*')))
 AND (((json_type(original.envelope_json,'$.audioSponsorReviewDigest')='text')
 AND (length(json_extract(original.envelope_json,'$.audioSponsorReviewDigest'))=71))
 AND ((substr(json_extract(original.envelope_json,'$.audioSponsorReviewDigest'),1,7)='sha256:')
 AND (substr(json_extract(original.envelope_json,'$.audioSponsorReviewDigest'),8) NOT GLOB '*[^a-f0-9]*')))))))))))))))`;
