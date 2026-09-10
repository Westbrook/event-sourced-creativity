export const accountingTarget = { jobId: "job-1", documentId: "doc-1", attemptCount: 1, status: "failed" };
export const inputInspection = () => ({ outcome: "failed", title: "Failed generation inputs", subtitle: "Video", prompt: "", retained: false,
  receipt: { job: { job_id: "job-1", document_id: "doc-1", attempt_count: 1, status: "failed", kind: "render_document", artifact_kind: "video", production_mode: "managed" } } });
export const accountingResponse = () => ({ preview: {
  version: 1, kind: "read_only_generation_accounting_preview", observedAt: "2026-09-10T12:00:00.000Z", snapshotSha256: "a".repeat(64), mutationAvailable: false, providerCalls: 0, ledgerWrites: 0,
  job: { ...accountingTarget, correlationId: "job-1:attempt:1", completedAt: "2026-08-27T00:57:18.946Z", checkpointUpdatedAt: "2026-08-27T00:57:18.946Z", requestSha256: "b".repeat(64), checkpointSha256: "c".repeat(64) },
  reservations: { period: "2026-08", tokens: { reservationId: "token-1", status: "active", reserved: 1000, used: 0 }, dollars: { reservationId: "cost-1", currency: "USD", status: "executing", reservedMicrousd: 19644000, usedMicrousd: 0 } },
  counters: { tokens: ["user", "workspace"].map(scope => ({ scope, scope_id: scope === "user" ? "owner" : "forma", period: "2026-08", used_tokens: 0, reserved_tokens: 1000, hard_limit_tokens: 1000000, updated_at: "2026-09-10T12:00:00.000Z" })),
    dollars: ["user", "workspace"].map(scope => ({ scope, scope_id: scope === "user" ? "owner" : "forma", period: "2026-08", used_microusd: 0, reserved_microusd: 19644000, hard_limit_microusd: 100000000, updated_at: "2026-09-10T12:00:00.000Z" })) },
  calls: [
    { clientRequestId: "client-plan", provider: "openai", operation: "planning", model: "gpt-5.6-terra", unitId: null, status: "completed", providerRequestId: "resp-plan", costMicrousd: 30000, inputTokens: 100, outputTokens: 50, totalTokens: 150, accountingReason: null },
    { clientRequestId: "client-anchor", provider: "fal", operation: "image", model: "fal-ai/ideogram/v4", unitId: "continuity-anchor", status: "completed", providerRequestId: "fal-anchor", costMicrousd: 80000, inputTokens: 0, outputTokens: 0, totalTokens: 0, accountingReason: null },
    { clientRequestId: "client-video", provider: "fal", operation: "video", model: "bytedance/seedance-2.0/reference-to-video", unitId: "scene:scene-003", status: "accepted", providerRequestId: "fal-video", costMicrousd: null, inputTokens: null, outputTokens: null, totalTokens: null, accountingReason: "accepted_call_billing_unresolved" },
  ], retainedMedia: [], audits: [],
  accounting: { allCallsKnown: false, legacyUncertain: false, callHistoryComplete: true, callHistoryReason: null, recordedProviderCallCount: 3, knownReceiptCostMicrousd: 110000, unresolvedCallCount: 1, totalReceiptCostMicrousd: null, proposedSettlementMicrousd: null },
} });
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
