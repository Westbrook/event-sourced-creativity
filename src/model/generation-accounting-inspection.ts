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
  return { version: 1, kind: "read_only_generation_accounting_preview", observedAt: date(preview.observedAt), snapshotSha256: hash(preview.snapshotSha256), mutationAvailable: false, providerCalls: 0, ledgerWrites: 0,
    job: { ...target, correlationId: textId(job.correlationId), completedAt: date(job.completedAt), checkpointUpdatedAt: date(job.checkpointUpdatedAt), requestSha256: hash(job.requestSha256), checkpointSha256: hash(job.checkpointSha256) },
    reservations: { period: reservations.period,
      tokens: { reservationId: textId(tokens.reservationId), status: choice(tokens.status, ["active", "settled", "released"]), reserved: amount(tokens.reserved), used: amount(tokens.used) },
      dollars: { reservationId: textId(dollars.reservationId), currency: "USD", status: choice(dollars.status, ["active", "executing", "settled", "released"]), reservedMicrousd: amount(dollars.reservedMicrousd), usedMicrousd: amount(dollars.usedMicrousd) } },
    calls, retainedMedia, audits, counters: { tokens: list(counters.tokens, 2).map(value => counter(value, "tokens")), dollars: list(counters.dollars, 2).map(value => counter(value, "microusd")) },
    accounting: { allCallsKnown, legacyUncertain, callHistoryComplete, callHistoryReason: accounting.callHistoryReason === null ? null : choice(accounting.callHistoryReason, historyReasons),
      recordedProviderCallCount, knownReceiptCostMicrousd, unresolvedCallCount, totalReceiptCostMicrousd, proposedSettlementMicrousd: null } };
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
