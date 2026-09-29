import assert from 'node:assert/strict';
import { reserveBudget, reserveCostBudget, claimCostBudgetReservation, storePrivateContent } from '../worker/pilot-policy.ts';
import { appendAuditEvent } from '../worker/runtime.ts';

export const LEGACY_STORYBOARD_PROMPT = 'Retained historical Fal prompt: adult designer arranging blank cards.';
/** Seed an already purchased historical request. Never send it through today's
 * Draft route just to make a fixture. All records live in the caller's :memory: DB. */
export async function seedLegacyStoryboard(fixture, admitted, plan, { providerJobId = null } = {}) {
  const row = fixture.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(admitted.jobId);
  const owner = row.owner_id, now = new Date().toISOString();
  const context = { streamId: row.stream_id, correlationId: row.correlation_id, operation: 'document-render:storyboard' };
  const tokens = await reserveBudget(fixture.env, owner, 32000, context);
  const amount = (plan.items.length + 1) * 1_000_000;
  const cost = await reserveCostBudget(fixture.env, owner, amount, { ...context, maximumMicrousd: amount, allowUserOverage: false, period: tokens.period });
  assert.equal(tokens.ok, true); assert.equal(cost.ok, true);
  assert.equal(await claimCostBudgetReservation(fixture.env, owner, cost.reservationId), true);
  const prompt = await storePrivateContent(fixture.env, owner, 'prompt', LEGACY_STORYBOARD_PROMPT);
  const model = 'ideogram/v4/fast';
  const root = providerJobId ? `https://queue.fal.run/ideogram/v4/requests/${providerJobId}` : null;
  const detail = { code: providerJobId ? 'network_error' : 'provider_submission_uncertain', category: 'network', scope: 'provider', action: 'retry',
    message: 'Historical request awaiting its original provider receipt.', retryable: Boolean(providerJobId), retryAfterMs: null, requestId: providerJobId, httpStatus: null };
  const result = { artifactId: `legacy-${admitted.jobId}`, artifactPlan: plan, renderedItems: [],
    reservationId: tokens.reservationId, costReservationId: cost.reservationId, costReservationPeriod: cost.period, costReservationMicrousd: amount,
    plannerModel: 'gpt-5.6-terra', plannerResponseId: 'retained-storyboard-plan', plannerUsage: { inputTokens: 250, outputTokens: 100, totalTokens: 350 },
    provider: 'fal', providerModel: model, providerJobId, providerStatusUrl: root ? `${root}/status` : null, providerResponseUrl: root, providerCancelUrl: root ? `${root}/cancel` : null,
    storyboardProviderSubmission: providerJobId ? 'confirmed' : 'pending', storyboardProviderRequestedAt: now, storyboardProviderAcceptedAt: providerJobId ? now : null,
    moderationPromptRef: prompt.contentId, providerSubmissionProtocol: 1,
    providerSubmissions: {
      'retained-plan': { clientRequestId: 'retained-plan', provider: 'openai', operation: 'planning', model: 'gpt-5.6-terra', status: 'completed', providerRequestId: 'retained-storyboard-plan', costMicrousd: 2100, inputTokens: 250, outputTokens: 100, totalTokens: 350 },
      'retained-frame': { clientRequestId: 'retained-frame', provider: 'fal', operation: 'image', model, unitId: 'frame:1', status: providerJobId ? 'accepted' : 'pending', providerRequestId: providerJobId },
    }, errorDetail: detail, stage: 'failed',
    generationReceipt: { artifact_kind: 'storyboard', provider: 'fal', model, provider_request_status: providerJobId ? 'submitted' : 'submission_unknown', source_transmission_status: providerJobId ? 'transmitted' : 'unknown', settled_cost_microusd: null, reservation_status: 'executing' },
  };
  fixture.sqlite.prepare("UPDATE document_jobs SET status='failed',attempt_count=1,result_json=?,error_message=?,completed_at=?,updated_at=? WHERE job_id=?")
    .run(JSON.stringify(result), detail.message, now, now, admitted.jobId);
  await appendAuditEvent(fixture.env, row.stream_id, 'worker:renderer', 'DocumentRenderFailed', { document_id: row.document_id, artifact_kind: 'storyboard', artifact_id: result.artifactId, prompt_ref: prompt.contentId, error_detail: detail }, row.correlation_id);
  const response = await fixture.route(admitted.jobId);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).job;
}
