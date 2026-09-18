/**
 * Pure, source-free conditional arithmetic for the existing v1 accounting preview.
 * NO IO, authority verification, evidence acquisition, settlement or ready state.
 * A JSON object, even one labelled "adjudicated", is not a trusted server proof.
 * The later server acquisition/apply boundary is deliberately not implemented here.
 */
type RecordValue = Record<string, unknown>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const VIDEO_MODEL = "bytedance/seedance-2.0/reference-to-video";
const ANCHOR_MODEL = "ideogram/v4";
const VERSION = "conditional-managed-video-accounting-v1";
const LIMITS = "Conditional arithmetic only. Caller-supplied JSON cannot prove server acquisition, current authority, complete prior-payment history, prepaid-marker absence, authentic adjudication or permission to apply. No settlement, refund, release, provider verification or generation completion is claimed.";

class InvalidEvidence extends Error {}
const requireEvidence: (condition: unknown, code: string) => asserts condition = (condition, code) => {
  if (!condition) throw new InvalidEvidence(code);
};
const record = (value: unknown, code: string): RecordValue => {
  requireEvidence(value !== null && typeof value === "object" && !Array.isArray(value), code);
  return value as RecordValue;
};
const list = (value: unknown, length: number, code: string): unknown[] => {
  requireEvidence(Array.isArray(value) && value.length === length, code);
  return value;
};
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && SHA.test(value);
const date = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && Number.isFinite(Date.parse(value));
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const add = (left: number, right: number, code: string) => {
  const result = left + right;
  requireEvidence(integer(result), code);
  return result;
};
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, stable(entry)])) : value;
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(JSON.stringify(stable(value)))))).map(byte => byte.toString(16).padStart(2, "0")).join("");

const baseResult = () => ({
  version: VERSION, status: "unresolved" as const, mutationAvailable: false as const,
  providerCalls: 0, ledgerWrites: 0, proposedSettlementMicrousd: null, proposedSettlementTokens: null,
  requiredServerWork: [
    "fresh_exact_snapshot_and_current_owner_administrator_authority",
    "bounded_complete_prior_payment_and_prepaid_marker_acquisition",
    "durable_exact_external_zero_adjudication_with_authentic_provenance",
    "explicit_exact_financial_apply_authorization_and_atomic_compare_and_swap",
  ], limits: LIMITS,
});

/**
 * `snapshot` is the *preview object*, not {preview}, returned by the reviewed
 * previewGenerationAccounting reader. Its declarations are checked for internal
 * consistency, not accepted as authentication. `externalEvidence` is a candidate
 * evidence description, never a caller capability or a trusted approval token.
 * Every return, including valid arithmetic, is unresolved and non-mutable.
 */
export async function planManagedVideoAccounting(snapshot: unknown, externalEvidence: unknown = null) {
  try {
    const preview = record(snapshot, "preview_invalid");
    requireEvidence(preview.version === 1 && preview.kind === "read_only_generation_accounting_preview"
      && preview.mutationAvailable === false && preview.providerCalls === 0 && preview.ledgerWrites === 0
      && sha(preview.snapshotSha256) && date(preview.observedAt), "preview_contract_invalid");
    const job = record(preview.job, "job_invalid");
    requireEvidence(id(job.jobId) && id(job.documentId) && job.status === "failed" && job.attemptCount === 1
      && job.correlationId === `${job.jobId}:attempt:1` && date(job.completedAt) && date(job.checkpointUpdatedAt)
      && sha(job.requestSha256) && sha(job.checkpointSha256), "exact_failed_first_attempt_required");
    const reservations = record(preview.reservations, "reservations_invalid");
    const tokens = record(reservations.tokens, "token_reservation_invalid");
    const dollars = record(reservations.dollars, "dollar_reservation_invalid");
    requireEvidence(typeof reservations.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/u.test(reservations.period)
      && id(tokens.reservationId) && id(dollars.reservationId) && tokens.reservationId !== dollars.reservationId
      && tokens.status === "active" && dollars.status === "executing" && dollars.currency === "USD"
      && integer(tokens.reserved) && tokens.reserved > 0 && tokens.used === 0
      && integer(dollars.reservedMicrousd) && dollars.reservedMicrousd > 0 && dollars.usedMicrousd === 0,
    "untouched_original_reservations_required");

    const calls = list(preview.calls, 3, "exact_three_calls_required").map(value => record(value, "call_invalid"));
    const clientIds = new Set(), providerIds = new Set();
    for (const call of calls) {
      requireEvidence(id(call.clientRequestId) && id(call.providerRequestId)
        && typeof call.model === "string" && MODEL.test(call.model)
        && ["openai", "fal"].includes(String(call.provider)), "call_identity_invalid");
      requireEvidence(!clientIds.has(call.clientRequestId) && !providerIds.has(`${call.provider}:${call.providerRequestId}`), "duplicate_call_identity");
      clientIds.add(call.clientRequestId); providerIds.add(`${call.provider}:${call.providerRequestId}`);
    }
    const findOne = (operation: string) => {
      const matches = calls.filter(call => call.operation === operation);
      requireEvidence(matches.length === 1, "exact_call_operations_required");
      return matches[0];
    };
    const planner = findOne("planning"), anchor = findOne("image"), video = findOne("video");
    requireEvidence(planner.provider === "openai" && planner.status === "completed" && planner.accountingReason === null
      && planner.unitId === null && integer(planner.costMicrousd)
      && integer(planner.inputTokens) && integer(planner.outputTokens) && integer(planner.totalTokens)
      && add(planner.inputTokens, planner.outputTokens, "planner_usage_overflow") === planner.totalTokens,
    "frozen_planner_receipt_required");
    requireEvidence(anchor.provider === "fal" && anchor.model === ANCHOR_MODEL && anchor.unitId === "continuity-anchor"
      && anchor.status === "completed" && anchor.accountingReason === null && integer(anchor.costMicrousd)
      && anchor.inputTokens === 0 && anchor.outputTokens === 0 && anchor.totalTokens === 0,
    "frozen_zero_token_ideogram_anchor_required");
    requireEvidence(video.provider === "fal" && video.model === VIDEO_MODEL && video.status === "accepted"
      && typeof video.unitId === "string" && /^scene:[A-Za-z0-9][A-Za-z0-9._:-]{0,193}$/u.test(video.unitId)
      && video.accountingReason === "accepted_call_billing_unresolved" && video.costMicrousd === null
      && video.inputTokens === null && video.outputTokens === null && video.totalTokens === null,
    "exact_unresolved_seedance_video_required");
    const accounting = record(preview.accounting, "accounting_invalid");
    const knownMicrousd = add(planner.costMicrousd, anchor.costMicrousd, "cost_sum_overflow");
    requireEvidence(accounting.callHistoryComplete === true && accounting.callHistoryReason === null
      && accounting.recordedProviderCallCount === 3 && accounting.legacyUncertain === false
      && accounting.allCallsKnown === false && accounting.unresolvedCallCount === 1
      && accounting.knownReceiptCostMicrousd === knownMicrousd && accounting.totalReceiptCostMicrousd === null
      && accounting.proposedSettlementMicrousd === null, "exact_accounting_consistency_required");

    const retained = list(preview.retainedMedia, 2, "exact_anchor_and_scene_required").map(value => record(value, "media_invalid"));
    for (const [kind, call] of [["anchor", anchor], ["scene", video]] as const) {
      const matches = retained.filter(media => media.kind === kind);
      requireEvidence(matches.length === 1, "exact_anchor_and_scene_required");
      const media = matches[0];
      requireEvidence(media.matchedCallId === call.clientRequestId && media.accountingReason === null
        && (media.providerRequestId !== null || media.providerSubmissionId !== null)
        && (media.providerRequestId === null || media.providerRequestId === call.providerRequestId)
        && (media.providerSubmissionId === null || media.providerSubmissionId === call.clientRequestId), "media_identity_conflict");
      if (kind === "anchor") {
        requireEvidence(media.status === "retained" && media.durationSeconds === null
          && (media.costMicrousd === null || media.costMicrousd === anchor.costMicrousd), "anchor_receipt_conflict");
        // The actual v1 reader permits null for missing legacy scene identity.
        // This narrower planner does not infer that missing anchor-to-scene link.
        requireEvidence(id(media.sceneId) && `scene:${media.sceneId}` === video.unitId, "anchor_scene_binding_unverified");
      } else requireEvidence(media.status === "submitted" && media.durationSeconds === 15
        && id(media.sceneId) && `scene:${media.sceneId}` === video.unitId && media.costMicrousd === null,
      "submitted_unpriced_fifteen_second_scene_required");
    }

    // This confirms only the existing bounded reader's returned collection.
    // It does NOT prove globally absent prior usage or omitted prepaid markers.
    const audits = list(preview.audits, 1, "initial_slice_requires_one_returned_reservation_audit");
    const audit = record(audits[0], "audit_invalid"), amounts = record(audit.amounts, "audit_amounts_invalid");
    requireEvidence(id(audit.eventId) && audit.type === "BudgetReserved" && audit.correlationId === job.correlationId
      && date(audit.occurredAt)
      && (audit.reservationId === null || audit.reservationId === tokens.reservationId)
      && (audit.costReservationId === null || audit.costReservationId === dollars.reservationId)
      && (audit.plannerResponseId === null || audit.plannerResponseId === planner.providerRequestId), "returned_audit_conflict");
    for (const field of ["reserved_tokens", "used_tokens", "released_tokens", "total_tokens", "planner_tokens",
      "reserved_microusd", "used_microusd", "released_microusd", "cost_microusd", "planner_cost_microusd", "video_cost_microusd"]) {
      requireEvidence(amounts[field] === null || integer(amounts[field]), "audit_amounts_invalid");
      if (!field.startsWith("reserved_")) requireEvidence(amounts[field] === null || amounts[field] === 0, "returned_audit_has_usage");
    }
    requireEvidence((amounts.reserved_tokens === null || amounts.reserved_tokens === tokens.reserved)
      && (amounts.reserved_microusd === null || amounts.reserved_microusd === dollars.reservedMicrousd), "returned_reservation_audit_amount_conflict");

    requireEvidence(planner.totalTokens <= tokens.reserved && knownMicrousd <= dollars.reservedMicrousd, "usage_exceeds_reserved_initial_scope");
    const counters = record(preview.counters, "counters_invalid");
    let ownerId: string | null = null;
    const projectedCounters: Array<RecordValue> = [];
    for (const [key, suffix, reservation, usage] of [
      ["tokens", "tokens", tokens.reserved, planner.totalTokens],
      ["dollars", "microusd", dollars.reservedMicrousd, knownMicrousd],
    ] as const) {
      const rows = list(counters[key], 2, "exact_two_counters_per_unit_required").map(row => record(row, "counter_invalid"));
      requireEvidence(rows.filter(row => row.scope === "user").length === 1
        && rows.filter(row => row.scope === "workspace").length === 1, "counter_scope_conflict");
      for (const row of rows) {
        const reserved = row[`reserved_${suffix}`], used = row[`used_${suffix}`], hardLimit = row[`hard_limit_${suffix}`];
        requireEvidence(row.period === reservations.period && id(row.scope_id)
          && (row.scope === "user" || row.scope === "workspace" && row.scope_id === "forma")
          && integer(reserved) && reserved >= reservation && integer(used) && integer(hardLimit)
          && date(row.updated_at), "counter_binding_or_value_invalid");
        if (row.scope === "user") {
          if (ownerId === null) ownerId = row.scope_id;
          else requireEvidence(ownerId === row.scope_id, "cross_unit_owner_conflict");
        }
        projectedCounters.push({ unit: suffix, scope: row.scope, scopeId: row.scope_id, period: row.period,
          beforeReserved: reserved, beforeUsed: used, reservedDelta: -reservation, usedDelta: usage,
          conditionalAfterReserved: reserved - reservation, conditionalAfterUsed: add(used, usage, "counter_usage_overflow"),
          hardLimitUnchanged: hardLimit, observedCounterUpdatedAt: row.updated_at });
      }
    }
    projectedCounters.sort((a, b) => compare(`${a.unit}:${a.scope}`, `${b.unit}:${b.scope}`));
    const subject = { snapshotSha256: preview.snapshotSha256, jobId: job.jobId, attemptCount: job.attemptCount,
      correlationId: job.correlationId, tokenReservationId: tokens.reservationId, costReservationId: dollars.reservationId,
      period: reservations.period, provider: "fal", operation: "video", model: video.model, unitId: video.unitId,
      clientRequestId: video.clientRequestId, providerRequestId: video.providerRequestId };
    let external: RecordValue | null = null;
    let externalReason = "external_evidence_not_supplied";
    if (externalEvidence !== null) {
      const candidate = record(externalEvidence, "external_evidence_invalid");
      requireEvidence(typeof candidate.kind === "string"
        && ["screenshot_displayed_zero", "operator_adjudicated_zero"].includes(candidate.kind)
        && candidate.currency === "USD" && candidate.displayedAmount === "$0.00"
        && sha(candidate.screenshotSha256) && integer(candidate.screenshotByteLength) && candidate.screenshotByteLength > 0,
      "external_evidence_kind_or_amount_invalid");
      const binding = record(candidate.subject, "external_subject_missing");
      requireEvidence(Object.entries(subject).every(([key, value]) => binding[key] === value), "external_subject_mismatch");
      external = { kind: candidate.kind, currency: "USD", displayedAmount: "$0.00",
        screenshotSha256: candidate.screenshotSha256, screenshotByteLength: candidate.screenshotByteLength,
        providerVerification: "not_established", provenanceVerification: "not_performed_by_pure_planner" };
      externalReason = "screenshot_display_does_not_establish_final_exact_zero";
      if (candidate.kind === "operator_adjudicated_zero") {
        const adjudication = record(candidate.adjudication, "adjudication_description_missing");
        requireEvidence(id(adjudication.recordId) && id(adjudication.reviewerId) && date(adjudication.reviewedAt)
          && adjudication.resolvedCostMicrousd === 0 && adjudication.basis === "manual_review_of_displayed_zero",
        "adjudication_description_invalid");
        external.adjudicationDescription = { recordId: adjudication.recordId, reviewerId: adjudication.reviewerId,
          reviewedAt: adjudication.reviewedAt, resolvedCostMicrousd: 0, basis: adjudication.basis };
        externalReason = "operator_adjudication_authenticity_and_authority_not_verified";
      }
    }
    const conditionalArithmetic = {
      condition: "Only if later server checks admit the exact video call at 0 microusd, prove no prior payment/reuse settlement, and authorize the exact atomic change. These conditions are NOT established here.",
      period: reservations.period,
      receiptSubtotalMicrousd: knownMicrousd,
      hypotheticalVideoMicrousd: 0,
      hypotheticalTotalMicrousd: knownMicrousd,
      hypotheticalUnusedMicrousd: dollars.reservedMicrousd - knownMicrousd,
      plannerInputTokens: planner.inputTokens, plannerOutputTokens: planner.outputTokens,
      hypotheticalTotalTokens: planner.totalTokens, hypotheticalUnusedTokens: tokens.reserved - planner.totalTokens,
      tokenBasis: { planning: "exact_frozen_completed_receipt", anchor: "explicit_zero_token_receipt",
        video: "this_exact_fal_seedance_video_adapter_does_not_meter_token_quota; missing_fields_are_not_general_zero_evidence" },
      projectedCounters,
    };
    const retainedMediaBinding = retained.map(media => ({ kind: media.kind, sceneId: media.sceneId,
      providerRequestId: media.providerRequestId, providerSubmissionId: media.providerSubmissionId,
      matchedCallId: media.matchedCallId, status: media.status, durationSeconds: media.durationSeconds,
      costMicrousd: media.costMicrousd })).sort((a, b) => compare(String(a.kind), String(b.kind)));
    const returnedAuditBinding = { eventId: audit.eventId, correlationId: audit.correlationId,
      type: audit.type, occurredAt: audit.occurredAt, reservationId: audit.reservationId,
      costReservationId: audit.costReservationId, plannerResponseId: audit.plannerResponseId,
      amounts: Object.fromEntries(["reserved_tokens", "used_tokens", "released_tokens", "total_tokens", "planner_tokens",
        "reserved_microusd", "used_microusd", "released_microusd", "cost_microusd", "planner_cost_microusd", "video_cost_microusd"]
        .map(key => [key, amounts[key]])) };
    const normalized = { version: VERSION, subject, observation: { observedAt: preview.observedAt,
      requestSha256: job.requestSha256, checkpointSha256: job.checkpointSha256 },
      calls: calls.map(call => ({ clientRequestId: call.clientRequestId, providerRequestId: call.providerRequestId,
        provider: call.provider, operation: call.operation, model: call.model, unitId: call.unitId,
        status: call.status, costMicrousd: call.costMicrousd, inputTokens: call.inputTokens,
        outputTokens: call.outputTokens, totalTokens: call.totalTokens })).sort((a, b) => compare(String(a.clientRequestId), String(b.clientRequestId))),
      retainedMediaBinding, returnedAuditBinding, external, conditionalArithmetic };
    return { ...baseResult(), inputDisposition: "internally_consistent_conditional_input",
      unresolvedReasons: [externalReason, "prior_payment_and_prepaid_marker_proof_not_acquired",
        "fresh_server_authority_and_snapshot_not_verified", "financial_apply_not_authorized_or_implemented"],
      subject, externalEvidence: external, preservedExecution: { jobStatus: "failed", videoSubmissionStatus: "accepted", usableClipCreated: false },
      returnedAuditScope: { eventIds: [audit.eventId], statement: "Only the original bounded preview query collection; not proof of globally absent usage." },
      conditionalArithmetic, proposalSha256: await hash(normalized),
      digestMeaning: "Integrity fingerprint of normalized supplied evidence and conditional arithmetic; not a signature, fresh database proof, approval or apply capability." };
  } catch (error) {
    if (!(error instanceof InvalidEvidence)) throw error;
    return { ...baseResult(), inputDisposition: "rejected_for_this_initial_slice", unresolvedReasons: [error.message],
      conditionalArithmetic: null, proposalSha256: null };
  }
}
