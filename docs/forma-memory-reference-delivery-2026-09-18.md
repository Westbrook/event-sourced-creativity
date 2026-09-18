# Durable native Memory reference delivery

Branch implementation only. No production migration, schedule, provider call,
budget change or real-user enrollment was performed.

## Implemented

- Additive migration `0044_memory_derivation_reference_jobs`: three private tables
  for consent-specific registration cursors, pending jobs and exact remembered
  event references. The complete 20-object schema is fingerprinted; partial or
  unknown schema is rejected. Existing `0043` remains independently supported.
- Source publication and durable registration share one guarded transaction.
  A separate catch-up path handles existing references without a new event page
  or disposable checkpoint. Lost acknowledgements do not register an interval twice.
- Each exact consent incarnation has its own `registered_through_sequence`,
  initialized from its consent-time watermark. This is **not a processed cursor**.
  Pages contain at most 128 references; a 129th reference witnesses continuation.
  A 32-job limit applies independently to each consent. Capacity never advances
  the cursor or claims completion.
- Job retention is capped by the original event time plus the narrower purpose
  retention, remembered-source expiry, consent expiry and qualification expiry.
  Registration latency does not renew retention. Active cursors last until the
  consent expires so expired/deleted work cannot silently reappear.
- Consent withdrawal/deletion, qualification withdrawal, source removal and source
  expiry changes erase dependent private jobs. Source replacement invalidates the
  whole job even with SQLite recursive triggers disabled. Unrelated conversation
  bookkeeping does not invalidate a job.
- Native privacy and cleanup receipts accept only the exact direct SQLite count
  or the exact D1 count including pinned trigger/FK cascades. SQL `changes()`
  separately proves the direct mutation. Cleanup runs independently of learning flags.
- Closed guest inventories recognize the exact additive schema and reject
  guest-linked references without reading provider credentials or altering history.

## What this does not claim

These records are candidate pointers, **not provider-ready source proofs**. They
contain no source prose, vector, prompt, inference, budget reservation or payment.
No processing consumer is activated, and purpose UI still reports
`processingImplemented:false`.

This delivery contract covers `memory_live_sources`. The separate completed
Chat Studio reference producer does not yet register through this contract.
Artifact-view pointers still require their own durable body/revision dependency
inverses before use in inferred outputs. Actual native rehydration, paired allowance
holds, single-dispatch accounting, receipt-only recovery, grounded processing and
guarded result consumers remain implementation work—not external-service blockers.

## Verification

- 92 focused native delivery, consent, checkpoint and personal-erasure tests pass.
  They include real isolated workerd/D1 pagination, cascade cleanup and privacy
  withdrawal with all outbound requests forbidden.
- 177 migration/schema/guest-inventory checks pass, including the four new
  guest schema/reference regressions.
- Typecheck, changed-source lint and production build pass. Existing large-chunk
  build warnings remain. These checks are not hosted/provider qualification.

Continue with the full [native plan](forma-memory-native-continuation-2026-09-18.md).
External/operational requirements remain in the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
