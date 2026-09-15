import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { captureModel3dComparisonData } from "../src/model/output-model3d-offer.ts";
import { readOutputModel3dPayload, verifyModel3dPreparedReceipt } from "./output-model3d-execution.ts";
import type { Model3dPreparedReceipt } from "./fal-model3d-adapter.ts";
import { model3dMiniAppAttemptMatches } from "../src/model/model3d-mini-app-consent.ts";

const fail = (): never => { throw new Error("output_model3d_recovery_checkpoint_unavailable"); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const same = (left: unknown, right: unknown) => { try { return canonicalJson(left) === canonicalJson(right); } catch { return false; } };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
const parse = (value: unknown) => typeof value === "string" && new TextEncoder().encode(value).length <= 262144 ? object(JSON.parse(value)) : fail();

/** Pure captured-checkpoint comparison, NOT authorization or a recovery lease.
 * The caller must load these rows from one owned tuple and retain the exact
 * source/private/call/reservation SQL witnesses before every read or write.
 * This function neither reserves, settles, acknowledges nor contacts a provider.
 * An accepted provider ID alone is deliberately insufficient.
 */
export async function captureOutputModel3dRecoveryCheckpoint(input: unknown, at = Date.now()) {
  const captured = object(captureModel3dComparisonData(input));
  const scope = object(captured.scope), slot = object(captured.slot), job = object(captured.job);
  const grant = object(captured.grant), current = object(captured.current);
  const token = object(captured.token), cost = object(captured.cost);
  if (!Number.isSafeInteger(at) || at < 0 || !identifier(scope.actorUserId) || scope.actorUserId !== scope.ownerUserId
    || scope.kind !== "personal" || scope.contextId !== null || scope.organizationId !== null || scope.projectAccessId !== null
    || job.owner_id !== scope.actorUserId || job.stream_id !== `creative:${scope.actorUserId}` || job.document_id !== scope.documentId
    || job.kind !== "render_document" || job.source_surface !== "outputs" || job.status !== "failed"
    || !identifier(job.job_id) || !identifier(job.correlation_id) || job.attempt_count !== 1
    || job.output_slot_id !== slot.slotId || slot.jobId !== job.job_id || slot.scopeKey !== scope.key
    || !["failed", "uncertain"].includes(String(slot.status))
    || slot.maximumCalls !== 1 || slot.maximumTokens !== 1 || slot.provider !== "fal"
    || grant.scope_key !== scope.key || grant.grant_id !== slot.grantId || grant.actor_user_id !== scope.actorUserId
    || grant.payer_user_id !== scope.ownerUserId || grant.context_id !== null
    || !["authorized", "active", "completed"].includes(String(grant.status))) return fail();
  const expiresAt = Math.min(Date.parse(String(job.expires_at)), Date.parse(String(current.retentionExpiresAt)));
  if (!Number.isFinite(expiresAt) || expiresAt <= at || job.lease_expires_at !== null
    && (!Number.isFinite(Date.parse(String(job.lease_expires_at))) || Date.parse(String(job.lease_expires_at)) > at)) return fail();
  const request = parse(job.request_json), checkpoint = parse(job.result_json);
  if (Object.hasOwn(checkpoint, "outputModel3dStop") || !identifier(checkpoint.artifactId) || checkpoint.artifactKind !== "model3d") return fail();
  const offer = await readOutputModel3dPayload(request);
  if (!offer || typeof slot.jobId!=="string" || typeof slot.attemptOrdinal!=="number" || !(slot.previousSlotId===null||typeof slot.previousSlotId==="string")
    || !model3dMiniAppAttemptMatches(offer.preview, {jobId:slot.jobId,attemptOrdinal:slot.attemptOrdinal,previousSlotId:slot.previousSlotId})
    || offer.contract.reference !== null || offer.preview.sourceFilesTransferred !== 0
    || offer.preview.actorUserId !== scope.actorUserId || offer.preview.documentId !== scope.documentId || offer.preview.projectId !== scope.projectId
    || offer.preview.requestId !== job.job_id || offer.preview.sourceDigest !== slot.sourceDigest
    || current.sourceDigest !== slot.sourceDigest || current.requirementsDigest !== offer.preview.requirementsDigest
    || offer.preview.maximumMicrousd !== slot.maximumMicrousd || slot.model !== offer.preview.model
    || offer.preview.maximumCalls !== 1 || offer.preview.maximumTokens !== 1
    || !same(request.model3dCostConsent, { ...offer.preview, confirmed: true, providerTransferConfirmed: true })) return fail();
  const execution = { scopeKey: slot.scopeKey, slotId: slot.slotId, grantId: slot.grantId, planRevisionId: slot.planRevisionId,
    targetId: slot.targetId, targetContractDigest: slot.targetContractDigest, sourceDigest: slot.sourceDigest };
  if (!same(request.outputExecution, execution) || !same(checkpoint.outputExecution, execution)) return fail();
  const prepared = await verifyModel3dPreparedReceipt(offer, checkpoint.model3dInputReceipt as Model3dPreparedReceipt);
  if (prepared.referenceInputs.length !== 0 || prepared.usedReferencePixels !== false) return fail();
  const submissions = object(checkpoint.providerSubmissions), entries = Object.entries(submissions);
  if (entries.length !== 1 || !Array.isArray(captured.calls) || captured.calls.length !== 1) return fail();
  const [key, value] = entries[0]!, submission = object(value), call = object(captured.calls[0]);
  const providerRequestId = submission.providerRequestId, clientRequestId = submission.clientRequestId;
  if (typeof clientRequestId !== "string" || !/^forma-model3d-[A-Za-z0-9._:-]{1,150}$/u.test(clientRequestId) || key !== clientRequestId
    || typeof providerRequestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(providerRequestId)
    || ["pending", "unknown", "submitted"].includes(providerRequestId.toLowerCase()) || providerRequestId === offer.preview.previousProviderRequestId
    || submission.provider !== "fal" || submission.operation !== "model3d" || submission.model !== prepared.model
    || !["accepted", "completed"].includes(String(submission.status))
    || submission.requestDigest !== undefined && submission.requestDigest !== prepared.requestDigest
    || checkpoint.providerJobId !== undefined && checkpoint.providerJobId !== providerRequestId
    || checkpoint.providerModel !== undefined && checkpoint.providerModel !== prepared.model
    || checkpoint.provider !== undefined && checkpoint.provider !== "fal"
    || call.scope_key !== scope.key || call.slot_id !== slot.slotId || call.call_key !== "model3d:initial" || call.stage_key !== "model3d:initial"
    || call.provider !== "fal" || call.model !== prepared.model || call.client_request_id !== clientRequestId
    || call.provider_response_id !== providerRequestId || call.request_digest !== prepared.requestDigest
    || call.reserved_microusd !== offer.preview.maximumMicrousd || !["uncertain", "settled"].includes(String(call.status))) return fail();
  const completed = submission.status === "completed";
  if (completed && (submission.costMicrousd !== offer.preview.maximumMicrousd || submission.inputTokens !== 0 || submission.outputTokens !== 0 || submission.totalTokens !== 0)
    || call.status === "settled" && (!completed || call.used_microusd !== offer.preview.maximumMicrousd)
    || call.status === "uncertain" && call.used_microusd !== null) return fail();
  if (checkpoint.reservationId !== slot.tokenReservationId || checkpoint.costReservationId !== slot.costReservationId
    || token.reservation_id !== slot.tokenReservationId || cost.reservation_id !== slot.costReservationId
    || token.owner_id !== scope.ownerUserId || cost.owner_id !== scope.ownerUserId
    || token.stream_id !== job.stream_id || cost.stream_id !== job.stream_id
    || token.correlation_id !== job.correlation_id || cost.correlation_id !== job.correlation_id
    || token.operation !== "document-render:model3d" || cost.operation !== token.operation
    || typeof token.period !== "string" || !token.period || token.period !== cost.period || checkpoint.costReservationPeriod !== cost.period
    || token.reserved_tokens !== 1 || cost.reserved_microusd !== offer.preview.maximumMicrousd) return fail();
  const held = token.status === "active" && ["active", "executing"].includes(String(cost.status))
    && (token.used_tokens === null || token.used_tokens === 0) && (cost.used_microusd === null || cost.used_microusd === 0);
  const settled = completed && call.status === "settled" && token.status === "released" && token.used_tokens === 0
    && cost.status === "settled" && cost.used_microusd === offer.preview.maximumMicrousd;
  if (!held && !settled) return fail();
  // Do not require the old dispatch quote to be live and do not renew it. The
  // retained offer/consent remains byte-bound, with an independent data deadline.
  return freeze({ version: "output-model3d-recovery-checkpoint-v1", jobId: job.job_id, artifactId: checkpoint.artifactId,
    execution, offer, prepared, submission, providerRequestId, clientRequestId, requestDigest: prepared.requestDigest,
    reservationId: slot.tokenReservationId, costReservationId: slot.costReservationId, expiresAt: new Date(expiresAt).toISOString(),
    requestJson: job.request_json, resultJson: job.result_json, settled });
}
