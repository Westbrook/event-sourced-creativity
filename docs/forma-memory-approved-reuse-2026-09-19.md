# Native approved-copy memory

Status: implemented and locally verified on the Memory feature branch. Not
published, activated, enrolled or scheduled in production. This is one part of
[the native continuation](forma-memory-native-continuation-2026-09-18.md), not
whole-plan completion.

## What is now recorded

Creator derivation can distinguish a genuine **approved context copy into the
enrolled document** from an ordinary block edit. It verifies the actual native
`authoring_commits` receipt, retained actor-private approval, and the entire
consecutive event footprint written by the authoring operation. Personal and
organization-scoped native writers are covered.

A `copied_from_block_id`, browser label, `authority: authored` field, or model
claim alone cannot establish reuse. Unknown, partial, changed or oversized
approval evidence remains an ordinary descriptive document action. Neither a
copy nor a click establishes an independent preference or original authorship.
Multiple blocks from one approval share a private outcome key; the provider gets
one descriptive reuse action, not multiple independent outcomes. The private
key, copied body, approval body and original source identifiers are not included
in that provider projection.

`provenance.reuseBindings` is separately versioned and private. It records the
native target scope, copy source pointer, exact receipt/approval hashes, supporting
event IDs and original private-body expiration. The original source's scope is
explicitly **unresolved**. This certifies the copy action; it does not authorize
reading, enroll, or resolve the original source document. Original-source memory
recall and broader cross-scope reconciliation remain separate implementation work.

## Source and privacy contract

- Exact approval hash, actor, owner stream, project/document, organization/access
  scope, operation, target, result, committed tail and complete event sequence.
- Retained private-envelope/event custody and compensation checks; exact current
  target block placement and native revision from the existing block certifier.
- Governed private content has current actor-private custody and matching native
  retention classification/policy/assigned expiry.
- The prospective approval deadline is checked against the committed footprint,
  not incorrectly treated as a new deadline for every historical read. Retained
  approval expiry still caps the result and cannot be renewed by rereading it.
- Full approval-content and footprint dependencies participate in existing
  private-content/event erasure. No preview body is copied into the manifest.
- Additive migration **0056** supplies three exact native receipt inverses:
  delete, update, and replacement (including recursive triggers disabled).
  Receipt changes clear dependent result bodies/manifests/dependencies. When
  migration0054 is present, terminal index deletion is queued in the same
  transaction. Rollback restores the receipt, result and index intent together.
- The optional schema is pinned in native and guest schema readers. Missing
  lifecycle support does not enable new bindings; partial/extra schema fails
  closed. Older manifests retain their prior, explicitly selected contract.

There is no new table, backfill, remote dispatch, financial authorization, user
activation, enrollment, migration execution or UI change in this slice. Existing
provider accounting remains unchanged by privacy retirement.

## Bounds and request budget

The approval query admits at most eight native previews, 64 KiB per retained
approval, 128 events and 192 KiB of native payloads per footprint, and 768 KiB
aggregate approval/payload bytes. The gates and hydration share one statement;
there is no preflight/body-read gap. Unknown/oversized evidence is not truncated.

Direct block observations and relationship endpoints now share one native block
read when the union fits. If the union exceeds the existing ID/byte/row bounds,
the independent bounded reads remain available; coverage is not silently reduced.
All queries still enter the native witness and are replayed before use.

Complete authenticated three-window inspection with original conversation pairs,
relationship endpoints and genuine two-block copies measures **45 calls for free
originals and 48 for paid originals**, retaining all three windows under the
existing strict `<50` local gate. Resource-only histories measure 44/47 calls.
These are isolated local measurements, not hosted quota qualification.

## Verification

- 408 native derivation/reuse regressions passed, including actual isolated D1
  footprint reads, atomic erasure, replacement, rollback and a late-erasure race.
- An additional committed-deadline/original-expiry test passed.
- 117 artifact/block/relationship regressions passed; independent resource-union
  ID and byte capacity cases are verified separately.
- Migration/schema suites and the guest copy schema's isolated D1 checks passed.
- Typecheck, changed-worker lint and production build passed. Existing bundle
  size warnings remain. No real provider calls or production changes were made.

Evidence is retained in this task's independent progress-report handoff. This
verification does not close the tracked prior Output request-budget failures or
external scheduling/vector/provider qualification.
