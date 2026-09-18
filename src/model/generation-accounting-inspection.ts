type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const unavailable = (): never => { throw new Error("accounting_preview_unavailable"); };
const textId = (value: unknown): string => identifier(value) ? value : unavailable();
const nullableId = (value: unknown): string | null => value === null ? null : textId(value);
const amount = (value: unknown): number => integer(value) ? value : unavailable();
const nullableAmount = (value: unknown): number | null => value === null ? null : amount(value);
const flag = (value: unknown): boolean => typeof value === "boolean" ? value : unavailable();
const date = (value: unknown): string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)) ? value : unavailable();
const hash = (value: unknown): string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : unavailable();
const choice = <T extends string>(value: unknown, values: readonly T[]): T => typeof value === "string" && values.includes(value as T) ? value as T : unavailable();
const list = (value: unknown, limit: number): unknown[] => Array.isArray(value) && value.length <= limit ? value : unavailable();

export type GenerationAccountingTarget = { jobId: string; documentId: string; attemptCount: number; status: "failed" | "canceled" };
export function generationAccountingTarget(inspection: unknown, admission: { role?: string; shared: boolean; impersonating: boolean }): GenerationAccountingTarget | null {
  if (admission.role !== "admin" || admission.shared || admission.impersonating) return null;
  const inspected = object(inspection), receipt = object(inspected.receipt), job = object(receipt.job);
  if (inspected.outcome !== "failed" || job.kind !== "render_document" || job.artifact_kind !== "video" || job.production_mode !== "managed"
    || !["failed", "canceled"].includes(String(job.status)) || !identifier(job.job_id) || !identifier(job.document_id) || !integer(job.attempt_count)) return null;
  return { jobId: job.job_id, documentId: job.document_id, attemptCount: job.attempt_count, status: job.status as "failed" | "canceled" };
}

const callReasons = ["submission_outcome_unresolved", "accepted_call_billing_unresolved", "completed_call_cost_missing", "planner_usage_incomplete", "completed_call_identity_missing"] as const;
const mediaReasons = ["media_call_identity_conflict", "media_call_receipt_missing", "media_call_operation_conflict", "media_call_cost_conflict"] as const;
const historyReasons = ["recorded_call_count_unavailable", "recorded_calls_missing", "retained_media_call_history_unresolved"] as const;
const auditAmountKeys = ["reserved_tokens", "used_tokens", "released_tokens", "total_tokens", "planner_tokens", "reserved_microusd", "used_microusd", "released_microusd", "cost_microusd", "planner_cost_microusd", "video_cost_microusd"] as const;


const acquisitionReasonCodes = ["external_billing_adjudication_not_acquired", "prepaid_marker_present", "prepaid_marker_malformed", "prior_usage_observed", "prior_usage_truncated", "prior_usage_evidence_malformed", "prior_usage_join_unresolved"] as const;
const coverageCodes = ["global_prior_use_not_established", "other_job_per_call_allocation_not_acquired"] as const;
const matchCodes = ["job_attempt_correlation", "job_id", "reservation_id", "cost_reservation_id", "planner_response_id", "provider_job_id"] as const;
const uniqueChoices = <T extends string>(value: unknown, choices: readonly T[], limit = choices.length) => {
  const values = list(value, limit).map(item => choice(item, choices));
  if (new Set(values).size !== values.length) return unavailable();
  return values;
};

/** Additive v1 evidence: no raw payload, source, URL, caller authority or payment verdict enters the dialog. */
function acquisitionForInspection(value: unknown, base: ObjectValue) {
  const a = object(value), binding = object(a.binding), prior = object(a.priorUsage), prepaid = object(a.prepaid);
  const job = object(base.job), reservations = object(base.reservations), tokens = object(reservations.tokens), dollars = object(reservations.dollars);
  const counters = object(base.counters);
  if (a.version !== 1 || a.status !== "observations_only" || a.mutationAvailable !== false
    || a.proposedSettlementMicrousd !== null || a.proposedSettlementTokens !== null
    || a.snapshotSha256 !== base.snapshotSha256 || binding.jobId !== job.jobId || binding.correlationId !== job.correlationId
    || binding.period !== reservations.period || binding.tokenReservationId !== tokens.reservationId || binding.costReservationId !== dollars.reservationId) return unavailable();
  const ownerId = textId(binding.ownerId);
  if (binding.streamId !== `creative:${ownerId}`) return unavailable();
  for (const unit of ["tokens", "dollars"]) {
    const rows = list(counters[unit], 2).map(object);
    if (rows.length !== 2 || rows.filter(row => row.scope === "user" && row.scope_id === ownerId).length !== 1
      || rows.filter(row => row.scope === "workspace" && row.scope_id === "forma").length !== 1) return unavailable();
  }
  let positiveMarker = false, malformedMarker = false;
  const markers = (value: unknown) => {
    const source = object(value);
    const marker = (value: unknown, kind: "anchor" | "sceneIds" | "providerCostMicrousd") => {
      const m = object(value), state = choice(m.state, ["absent", "value", "malformed"]);
      if (state !== "value") {
        if (m.value !== null) return unavailable();
        if (state === "malformed") malformedMarker = true;
        return { state, value: null };
      }
      const selected = kind === "anchor" ? flag(m.value) : kind === "providerCostMicrousd" ? amount(m.value) : list(m.value, 64).map(textId);
      if (Array.isArray(selected) && new Set(selected).size !== selected.length) return unavailable();
      if (selected === true || typeof selected === "number" && selected > 0 || Array.isArray(selected) && selected.length > 0) positiveMarker = true;
      return { state, value: selected };
    };
    return { anchor: marker(source.anchor, "anchor"), sceneIds: marker(source.sceneIds, "sceneIds"), providerCostMicrousd: marker(source.providerCostMicrousd, "providerCostMicrousd") };
  };
  const selectedPrepaid = { request: markers(prepaid.request), checkpoint: markers(prepaid.checkpoint) };
  if (prior.scope !== "current_principal_personal_stream_all_periods" || prior.queryLimit !== 32
    || prior.coverage !== "supported_writer_fields_and_job_attempt_links_only" || prior.globalPriorUseEstablished !== false
    || prior.otherJobPerCallAllocation !== "not_acquired") return unavailable();
  let unresolvedJoin = false;
  const rows = list(prior.rows, 32).map(value => {
    const row = object(value);
    const reservationId = nullableId(row.reservationId), costReservationId = nullableId(row.costReservationId);
    const ledger = (value: unknown, expectedId: string | null, unit: "tokens" | "dollars") => {
      const entry = object(value), state = choice(entry.state, ["not_referenced", "missing", "binding_conflict", "observed"]);
      if (entry.reservationId !== expectedId || (state === "not_referenced") !== (expectedId === null)) return unavailable();
      if (state !== "observed") { unresolvedJoin = true; return { state, reservationId: expectedId }; }
      const status = choice(entry.status, unit === "tokens" ? ["active", "settled", "released"] : ["active", "executing", "settled", "released"]);
      const reserved = amount(entry.reserved), used = amount(entry.used);
      if (typeof entry.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(entry.period) || status !== "settled" && used !== 0) return unavailable();
      return { state, reservationId: expectedId, period: entry.period, status, reserved, used };
    };
    const matchedBy = uniqueChoices(row.matchedBy, matchCodes);
    if (!matchedBy.length) return unavailable();
    const values = object(row.amounts);
    return { eventId: textId(row.eventId), correlationId: textId(row.correlationId), type: choice(row.type, ["GenerationUsageRecorded", "BudgetReleased"]),
      occurredAt: date(row.occurredAt), matchedBy, reservationId, costReservationId,
      plannerResponseId: nullableId(row.plannerResponseId), providerJobId: nullableId(row.providerJobId),
      amounts: Object.fromEntries(auditAmountKeys.map(key => [key, nullableAmount(values[key])])),
      tokenLedger: ledger(row.tokenLedger, reservationId, "tokens"), dollarLedger: ledger(row.dollarLedger, costReservationId, "dollars") };
  });
  const rowsRead = amount(prior.rowsRead), malformedRows = amount(prior.malformedRows), truncated = flag(prior.truncated);
  if (rowsRead > 33 || truncated !== (rowsRead === 33) || rows.length + malformedRows !== Math.min(rowsRead, 32)
    || new Set(rows.map(row => row.eventId)).size !== rows.length) return unavailable();
  const unresolvedReasons = uniqueChoices(a.unresolvedReasons, acquisitionReasonCodes);
  const expectedReasons = acquisitionReasonCodes.filter(reason => reason === "external_billing_adjudication_not_acquired"
    || reason === "prepaid_marker_present" && positiveMarker || reason === "prepaid_marker_malformed" && malformedMarker
    || reason === "prior_usage_observed" && rows.length > 0 || reason === "prior_usage_truncated" && truncated
    || reason === "prior_usage_evidence_malformed" && malformedRows > 0 || reason === "prior_usage_join_unresolved" && unresolvedJoin);
  if (JSON.stringify(unresolvedReasons) !== JSON.stringify(expectedReasons)) return unavailable();
  const coverageLimitations = uniqueChoices(a.coverageLimitations, coverageCodes);
  if (JSON.stringify(coverageLimitations) !== JSON.stringify(coverageCodes)) return unavailable();
  const plannerRefusalReasons = list(a.plannerRefusalReasons, 1).map(value => typeof value === "string" && /^[a-z][a-z0-9_]{0,99}$/u.test(value) ? value : unavailable());
  let conditionalArithmetic = null;
  if (a.conditionalArithmetic !== null) {
    const c = object(a.conditionalArithmetic);
    if (unresolvedReasons.length !== 1 || plannerRefusalReasons.length || c.basis !== "hypothetical_exact_zero_and_no_prior_payment_not_established"
      || c.period !== reservations.period || c.hypotheticalVideoMicrousd !== 0) return unavailable();
    const selected = { basis: c.basis, period: reservations.period, receiptSubtotalMicrousd: amount(c.receiptSubtotalMicrousd), hypotheticalVideoMicrousd: 0,
      hypotheticalTotalMicrousd: amount(c.hypotheticalTotalMicrousd), hypotheticalUnusedMicrousd: amount(c.hypotheticalUnusedMicrousd),
      plannerInputTokens: amount(c.plannerInputTokens), plannerOutputTokens: amount(c.plannerOutputTokens),
      hypotheticalTotalTokens: amount(c.hypotheticalTotalTokens), hypotheticalUnusedTokens: amount(c.hypotheticalUnusedTokens) };
    const calls = list(base.calls, 3).map(object), planner = calls.find(call => call.operation === "planning");
    if (calls.length !== 3 || !planner || planner.inputTokens !== selected.plannerInputTokens || planner.outputTokens !== selected.plannerOutputTokens
      || planner.totalTokens !== selected.hypotheticalTotalTokens || selected.plannerInputTokens + selected.plannerOutputTokens !== selected.hypotheticalTotalTokens
      || selected.receiptSubtotalMicrousd !== object(base.accounting).knownReceiptCostMicrousd || selected.hypotheticalTotalMicrousd !== selected.receiptSubtotalMicrousd
      || selected.hypotheticalUnusedMicrousd + selected.hypotheticalTotalMicrousd !== dollars.reservedMicrousd
      || selected.hypotheticalUnusedTokens + selected.hypotheticalTotalTokens !== tokens.reserved) return unavailable();
    conditionalArithmetic = selected;
  }
  return { version: 1, status: "observations_only", binding: { ownerId, streamId: textId(binding.streamId), jobId: textId(binding.jobId), correlationId: textId(binding.correlationId),
    period: reservations.period, tokenReservationId: textId(binding.tokenReservationId), costReservationId: textId(binding.costReservationId) },
    prepaid: selectedPrepaid, priorUsage: { scope: prior.scope, queryLimit: 32, rowsRead, truncated, malformedRows, rows, coverage: prior.coverage,
      globalPriorUseEstablished: false, otherJobPerCallAllocation: "not_acquired" }, coverageLimitations, unresolvedReasons, plannerRefusalReasons, conditionalArithmetic,
    mutationAvailable: false, proposedSettlementMicrousd: null, proposedSettlementTokens: null, snapshotSha256: hash(a.snapshotSha256), evidenceSha256: hash(a.evidenceSha256) };
}

/** Construct a second source-free allowlist; unknown future response fields never enter DOM or copied diagnostics. */
export function accountingPreviewForInspection(value: unknown, target: GenerationAccountingTarget) {
  const preview = object(object(value).preview), job = object(preview.job), reservations = object(preview.reservations), accounting = object(preview.accounting);
  if (preview.version !== 1 || preview.kind !== "read_only_generation_accounting_preview" || preview.mutationAvailable !== false || preview.providerCalls !== 0 || preview.ledgerWrites !== 0
    || job.jobId !== target.jobId || job.documentId !== target.documentId || job.attemptCount !== target.attemptCount || job.status !== target.status
    || typeof reservations.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(reservations.period) || accounting.proposedSettlementMicrousd !== null) return unavailable();
  const tokens = object(reservations.tokens), dollars = object(reservations.dollars);
  if (dollars.currency !== "USD") return unavailable();
  const calls = list(preview.calls, 64).map(value => {
    const call = object(value);
    if (typeof call.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(call.model)) return unavailable();
    const selected = { clientRequestId: textId(call.clientRequestId), provider: choice(call.provider, ["openai", "fal"]), operation: choice(call.operation, ["planning", "image", "video"]), model: call.model,
      unitId: nullableId(call.unitId), status: choice(call.status, ["pending", "accepted", "completed", "rejected"]), providerRequestId: nullableId(call.providerRequestId),
      costMicrousd: nullableAmount(call.costMicrousd), inputTokens: nullableAmount(call.inputTokens), outputTokens: nullableAmount(call.outputTokens), totalTokens: nullableAmount(call.totalTokens),
      accountingReason: call.accountingReason === null ? null : choice(call.accountingReason, callReasons) };
    const expectedReason = selected.status === "pending" ? "submission_outcome_unresolved" : selected.status === "accepted" ? "accepted_call_billing_unresolved"
      : selected.status === "completed" && selected.costMicrousd === null ? "completed_call_cost_missing"
        : selected.status === "completed" && selected.operation === "planning" && (![selected.inputTokens, selected.outputTokens, selected.totalTokens].every(integer) || selected.totalTokens !== Number(selected.inputTokens) + Number(selected.outputTokens)) ? "planner_usage_incomplete"
          : selected.status === "completed" && selected.providerRequestId === null ? "completed_call_identity_missing" : null;
    if (selected.accountingReason !== expectedReason || selected.status === "rejected" && [selected.costMicrousd, selected.inputTokens, selected.outputTokens, selected.totalTokens].some(value => value !== null && value !== 0)) return unavailable();
    return selected;
  });
  const retainedMedia = list(preview.retainedMedia, 65).map(value => {
    const media = object(value);
    return { kind: choice(media.kind, ["anchor", "scene"]), sceneId: nullableId(media.sceneId), providerRequestId: nullableId(media.providerRequestId), providerSubmissionId: nullableId(media.providerSubmissionId),
      status: choice(media.status, ["retained", "preparing", "submitted", "completed"]), durationSeconds: nullableAmount(media.durationSeconds), costMicrousd: nullableAmount(media.costMicrousd),
      matchedCallId: nullableId(media.matchedCallId), accountingReason: media.accountingReason === null ? null : choice(media.accountingReason, mediaReasons) };
  });
  const audits = list(preview.audits, 100).map(value => {
    const audit = object(value), amounts = object(audit.amounts);
    return { eventId: textId(audit.eventId), correlationId: textId(audit.correlationId), type: choice(audit.type, ["BudgetReserved", "GenerationUsageRecorded", "BudgetReleased"]), occurredAt: date(audit.occurredAt),
      reservationId: nullableId(audit.reservationId), costReservationId: nullableId(audit.costReservationId), plannerResponseId: nullableId(audit.plannerResponseId),
      amounts: Object.fromEntries(auditAmountKeys.map(key => [key, nullableAmount(amounts[key])])) };
  });
  const counters = object(preview.counters);
  const counter = (value: unknown, unit: "tokens" | "microusd") => {
    const row = object(value);
    if (row.period !== reservations.period) return unavailable();
    return { scope: choice(row.scope, ["user", "workspace"]), scope_id: textId(row.scope_id), period: reservations.period,
      [`used_${unit}`]: amount(row[`used_${unit}`]), [`reserved_${unit}`]: amount(row[`reserved_${unit}`]), [`hard_limit_${unit}`]: amount(row[`hard_limit_${unit}`]), updated_at: date(row.updated_at) };
  };
  const allCallsKnown = flag(accounting.allCallsKnown), callHistoryComplete = flag(accounting.callHistoryComplete), legacyUncertain = flag(accounting.legacyUncertain);
  const knownReceiptCostMicrousd = amount(accounting.knownReceiptCostMicrousd), totalReceiptCostMicrousd = nullableAmount(accounting.totalReceiptCostMicrousd), unresolvedCallCount = amount(accounting.unresolvedCallCount);
  const known = calls.filter(call => call.accountingReason === null), countedCost = known.reduce((sum, call) => sum + (call.costMicrousd ?? 0), 0);
  const recordedProviderCallCount = nullableAmount(accounting.recordedProviderCallCount);
  const callHistoryReason = recordedProviderCallCount === null ? "recorded_call_count_unavailable" : recordedProviderCallCount > calls.length ? "recorded_calls_missing"
    : retainedMedia.some(media => media.accountingReason !== null) ? "retained_media_call_history_unresolved" : null;
  if (!calls.length || knownReceiptCostMicrousd !== countedCost || unresolvedCallCount !== calls.length - known.length
    || accounting.callHistoryReason !== callHistoryReason || callHistoryComplete !== (callHistoryReason === null)
    || allCallsKnown !== (!legacyUncertain && callHistoryComplete && known.length === calls.length)
    || allCallsKnown && totalReceiptCostMicrousd !== knownReceiptCostMicrousd || !allCallsKnown && totalReceiptCostMicrousd !== null
    || recordedProviderCallCount === null && callHistoryComplete || recordedProviderCallCount !== null && recordedProviderCallCount > calls.length && callHistoryComplete) return unavailable();
  const selected = { version: 1, kind: "read_only_generation_accounting_preview", observedAt: date(preview.observedAt), snapshotSha256: hash(preview.snapshotSha256), mutationAvailable: false, providerCalls: 0, ledgerWrites: 0,
    job: { ...target, correlationId: textId(job.correlationId), completedAt: date(job.completedAt), checkpointUpdatedAt: date(job.checkpointUpdatedAt), requestSha256: hash(job.requestSha256), checkpointSha256: hash(job.checkpointSha256) },
    reservations: { period: reservations.period,
      tokens: { reservationId: textId(tokens.reservationId), status: choice(tokens.status, ["active", "settled", "released"]), reserved: amount(tokens.reserved), used: amount(tokens.used) },
      dollars: { reservationId: textId(dollars.reservationId), currency: "USD", status: choice(dollars.status, ["active", "executing", "settled", "released"]), reservedMicrousd: amount(dollars.reservedMicrousd), usedMicrousd: amount(dollars.usedMicrousd) } },
    calls, retainedMedia, audits, counters: { tokens: list(counters.tokens, 2).map(value => counter(value, "tokens")), dollars: list(counters.dollars, 2).map(value => counter(value, "microusd")) },
    accounting: { allCallsKnown, legacyUncertain, callHistoryComplete, callHistoryReason: accounting.callHistoryReason === null ? null : choice(accounting.callHistoryReason, historyReasons),
      recordedProviderCallCount, knownReceiptCostMicrousd, unresolvedCallCount, totalReceiptCostMicrousd, proposedSettlementMicrousd: null } };
  return preview.acquisition === undefined ? selected : { ...selected, acquisition: acquisitionForInspection(preview.acquisition, selected) };
}

export type GenerationAccountingInspectionPreview = ReturnType<typeof accountingPreviewForInspection>;
export type GenerationAccountingReadState = { status: "idle" | "loading" | "unavailable"; preview: null } | { status: "ready"; preview: GenerationAccountingInspectionPreview };
type ReadPorts = { current: () => boolean; changed: () => void; fetch: (url: string, init: RequestInit, current: () => boolean) => Promise<Response> };
const MAX_RECEIPT_BYTES = 262144;

async function readReceipt(response: Response, current: () => boolean, signal: AbortSignal) {
  if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" || Number(response.headers.get("content-length") ?? 0) > MAX_RECEIPT_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined); return unavailable();
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let size = 0, body = "";
  try {
    while (true) {
      if (signal.aborted || !current()) return unavailable();
      const chunk = await reader.read();
      if (signal.aborted || !current()) return unavailable();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RECEIPT_BYTES) return unavailable();
      body += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Local-only lifetime: cancellation and exact ownership, never a global store, toast, provider action or automatic read. */
export function createGenerationAccountingReader() {
  type Owner = { controller: AbortController; current: () => boolean };
  let owner: Owner | null = null, state: GenerationAccountingReadState = { status: "idle", preview: null };
  const cancel = () => { const previous = owner; owner = null; state = { status: "idle", preview: null }; previous?.controller.abort(); };
  const owned = (candidate: Owner): boolean => { try { return owner === candidate && !candidate.controller.signal.aborted && candidate.current(); } catch { return false; } };
  return {
    cancel,
    state(): GenerationAccountingReadState { if (owner && !owned(owner)) cancel(); return state; },
    async read(target: GenerationAccountingTarget, ports: ReadPorts) {
      cancel(); const candidate = { controller: new AbortController(), current: ports.current }; owner = candidate;
      const current = () => owned(candidate), captured = Object.freeze({ ...target });
      if (!current()) { cancel(); return; }
      state = { status: "loading", preview: null }; ports.changed();
      try {
        if (!current()) return;
        const response = await ports.fetch(`/api/admin/generation-accounting?jobId=${encodeURIComponent(captured.jobId)}`, { method: "GET", cache: "no-store", signal: candidate.controller.signal }, current);
        if (!current()) { await response.body?.cancel().catch(() => undefined); return; }
        const value = await readReceipt(response, current, candidate.controller.signal);
        if (!current()) return;
        const preview = accountingPreviewForInspection(value, captured);
        if (!current()) return;
        state = { status: "ready", preview }; ports.changed();
      } catch {
        if (current()) { state = { status: "unavailable", preview: null }; ports.changed(); }
      } finally { if (owner === candidate && !current()) cancel(); }
    },
  };
}
