# Native synthetic Memory benchmark

Source contract, **2026-09-17**. This is a default-disabled, synthetic-only
benchmark, not production semantic Memory. No provider call or real-user
qualification has been performed by this continuation.

## Integrated source

The fixed corpus, provider adapter, one-shot ledger, runner and demand projection
live in `worker/memory-benchmark/`. `native.ts` supplies existing-principal
administrator authentication, purpose-specific approval, self-payer token and
dollar accounting, immutable original-operation linkage and usage recovery.
The HTTP routes are mounted in `worker/index.ts`.

| Route | Operation |
| --- | --- |
| POST `/api/internal/memory-benchmark/approval` | Explicitly confirm the exact fixed server plan, self-payment from the AI allowance, a one-time $10 ceiling and an expiry of at most 24 hours within the current UTC month. |
| GET/POST `/api/internal/memory-benchmark` | Read status, perform one exact fixed ordinal, or halt. No caller-authored source, prompt, model, payer, URL or ceiling. |
| POST `/api/internal/memory-benchmark/reconcile` | Empty body; settle only retained, immutable verified usage of the original operation. No provider call, experiment resume or grant reset. |
| POST `/api/internal/memory-benchmark/release-undispatched` | Empty body; release native holds only when durable evidence proves the halted original operation was never claimed or dispatched. No fabricated usage receipt, provider call or experiment resume. |

Spending and new approval require literal `FORMA_MEMORY_BENCHMARK_ENABLED="1"`,
plus `FORMA_MEMORY_BENCHMARK_ACTOR_IDS`, exact HTTPS
`FORMA_MEMORY_BENCHMARK_ORIGIN` and the reviewed integrated-source digest in
`FORMA_MEMORY_BENCHMARK_SOURCE_SHA256`. No values are set by this change.
The existing `OPENAI_API_KEY` and optional `OPENAI_PROJECT` bindings are reused;
no secret is copied or exposed. Impersonation, selected-project cookies,
fictional accounts, managed-pilot billing and another user's payer are rejected.

Financial reconciliation and proven-undispatched release remain available with spending disabled, while still
requiring the configured origin, actor allowlist and current real administrator /
self-payer authority. Expiry or withdrawal cannot authorize another provider
request and cannot erase an original charge receipt.

## Schema and qualification

[Base schema](../db/memory-benchmark.pending.sql) followed by
[native bindings](../db/memory-benchmark-native.pending.sql) are additive optional
activation candidates. They depend on the current native accounting tables.
They have **no production migration assignment**, are not in runtime schema
bootstrap and have not been applied to a hosted database. Install and qualify
them together; the shared `pilot-policy.ts` hold-exclusion change and both native
ledger protections are part of the required source review.

There is deliberately no qualification seed or public qualification writer.
A durable qualification must bind the actual plan, integrated-source digest,
HTTPS origin, evidence digest and expiry, with model access, current pricing,
retention, token limits, native accounting, hold recovery and cleanup evidence.
A made-up ID or an approval click cannot establish these facts.

The model/pricing recipe is the retained September 4 source, **not a newly
verified price quote**. A model or pricing change requires source/plan review,
not bypassing the exact plan hash. The $10 cap is the previously approved
experiment ceiling, not a measured monthly recommendation. No monthly cap has
been selected from actual benchmark results.

## Failure, privacy and maintenance

Both native holds must be acknowledged before the one-shot dispatch claim.
Provider-returned usage is retained before either native ledger settles. A lost
ACK or partial settlement never causes provider replay; exact verified usage can
be reconciled after grant withdrawal or while spending is disabled. A halted or
uncertain experiment remains halted: accounting recovery does not fabricate its
missing synthetic output or continue the experiment.

A separate immutable `verified-not-dispatched` disposition requires an exact halted operation, both dispatch fields unset, no provider usage or result, and matching original account, grant, budget and reservation bindings. Its atomic insertion permanently fences delayed reservations, claims and fabricated receipts. Token and dollar releases then use separate guarded, idempotent settlement transactions; repeats and partial or lost acknowledgements cannot release twice. An absent reservation is not manufactured. The experiment remains halted and its lifetime ceiling is not reset.

Unknown claimed exposure is retained. Generic orphan reconciliation excludes
Memory benchmark operations even when optional schema is absent. Do not refund
these rows based on age, missing content, a failed response or a disabled flag.

The existing scheduled handler calls `purgeExpiredNativeMemoryBenchmark`
independently of benchmark spending and Memory enrollment. Missing base schema
is a no-op; partial-schema failure remains visible and does not prevent the
existing reminder pass. Expiry removes synthetic result bodies, not immutable
financial tombstones or the lifetime ceiling. No schedule was registered or
qualified as part of this change.

## Remaining qualification

Follow [MEM-001's non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md)
for hosted D1/capacity/privacy, supported scheduling, real provider/model and
price checks, a bounded approved synthetic run and human quality assessment.
The [implementation reconciliation](forma-memory-implementation-2026-09-17.md#remaining-source-work)
separately records missing semantic/profile pipelines, the genuine native
comparison baseline and any wider payer support. Unit fixtures must not be
reported as a live run or production enrollment.
