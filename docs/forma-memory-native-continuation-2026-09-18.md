# Native Memory continuation: merge preparation

This continues the full [Memory plan](forma-scope-aware-memory-plan-2026-09-02.md)
and [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
It is **branch work, not a production release or whole-plan completion**.
Base: local main `7d74584bb72a1ed3cbab25ee64071994f8976d2f`.

## Implemented and locally verified

- `75b4b02`: genuine Canvas-open observations, canonical native document custody
  proofs, and negotiated personal/current-artifact consumption v2. See the capability
  To Do for exclusions. No implicit user enrollment or expanded access.
- Completed Chat Studio originals can now span **64 complete pairs / 128 references**
  across up to 32 exact windows. One shared native proof retains the original
  32-statement / 8,192-row / 2 MiB read budget. The old single-window API still admits
  six pairs. Overflow preserves existing history and reports capacity.
- The provider-free Chat Studio reference answer opts into a 128 KiB structured
  context and 256 KiB private manifest; its visible answer stays at 8 KiB. All
  original references remain in private evidence; compact display lists every
  source ordinal. Default/provider and older Creator context limits stay unchanged.
- Historical v1 projection bytes remain replayable, including genuine separate
  disjoint or overlapping v1 capture frames. Historical display frame counts are
  comparison-only metadata, never fresh authority or a renewed budget/lease.
- Shared Forget can now finish dependent answer retirement after native ledger
  redaction has already removed ledger custody sidecars. The exception requires
  exact terminal native ledger/body proof; authored originals and answer/manifest
  custody remain strict. Header-scope and late legal holds still prevent erasure.
- A strict **unverified model-candidate parser** checks exact original IDs,
  revisions, content hashes and code-point quotations, supporting/counterevidence,
  protected correction targets, lineage suppression and original lifetime bounds.
  Exact attribution does not prove entailment. The parser is **not yet a native
  derivation caller**, permission grant, persistence pipeline or paid operation.

Local evidence: 68 native capture/checkpoint/Chat Studio/retirement tests and 67
conversation/parser/manifest/record tests passed; typecheck, changed-worker lint,
and production build passed. The build retains existing large-chunk warnings.
These are isolated local fixtures, not hosted browser/provider/scheduling qualification.

## Subsequent purpose-control slice

[Separate derivation controls](forma-memory-purpose-controls-2026-09-18.md) now
implement exact qualified purpose/allowance consent, native privacy inverses,
metadata-only revocation recovery, additive migration0043 and localized manual
UI controls. This does **not** implement the paid processing or financial ledger;
`processingImplemented:false` keeps UI enrollment inactive.

## Subsequent durable reference-delivery slice

[Native reference delivery](forma-memory-reference-delivery-2026-09-18.md) adds
an exact-consent queue, source/qualification/privacy inverses, bounded catch-up
and original-time retention. It is not provider-ready admission, paid processing,
a completed semantic cursor or delivery of the separate Chat Studio producer.

[Native job admission and budget primitives](forma-memory-native-admission-2026-09-18.md)
now add exact single-consumer reference leases, replayable privacy/configuration
checks, and protected paired-budget helpers. [Full original source capture](forma-memory-native-source-capture-2026-09-18.md) now retains exact personal/shared free/paid conversation evidence and separate typed observations, with bounded hydration and durable negative ancestry. Financial execution now has its own verified branch slice below; processing windows and semantic consumers remain implementation work.

The [independent finance foundation](forma-memory-finance-foundation-2026-09-18.md)
now adds retained payer-month cap floors, protected paired holds, usage/no-dispatch
records, privacy cascade receipts and schema-only migration handling. The subsequent
[financial execution slice](forma-memory-financial-execution-2026-09-18.md) adds
source-bound paired admission, one-shot mocked-qualified transport, verified
settlement/no-dispatch recovery, organization erasure and localized cap/retention
controls. Durable semantic publication and its worker integration remain open.

[Interrupted-work recovery](forma-memory-native-recovery-2026-09-18.md) now adds
bounded source-free financial maintenance, a durable fair scan cursor, safe
unfunded-lease backoff/exhaustion and an existing scheduled-event code hook.
No hosted schedule, paid derivation consumer or user activation was added.

[Read-only evidence](forma-memory-native-read-evidence-2026-09-18.md) now separates
fresh source access from execution authority. A retained job can be inspected
after execution expiry without renewing its lease or granting another provider
call. Result storage is implemented in the subsequent slice below; public consumers remain open.

[Canonical manifests and publication receipts](forma-memory-native-manifests-2026-09-18.md)
now capture complete provider-input provenance, preserve original retention across
fresh reads, and bind publication preparation to verified provider usage. This
format and its native proof are implemented.

[Durable private results](forma-memory-native-results-2026-09-18.md) now add atomic
body/manifest/dependency publication, fresh authenticated reads, source-change
inverses, single-result withdrawal, expiry and exact personal/organization privacy
cascades. Migration0047 remains unapplied in production. Cross-job suppression,
completed semantic cursors and worker/consumer integration are still open.

## Current native implementation status

[User controls and native worker integration](forma-memory-user-controls-worker-2026-09-18.md)
implement explicit corrections/suppression/release, private review UI, atomic
completion cursors and bounded scheduled-event dispatch. The subsequent
[processing-window/artifact/lifecycle slice](forma-memory-windows-artifacts-2026-09-18.md)
adds byte-aware new-job registration, capacity fairness, certified current
personal artifact observations, actor-private artifact identity and immediate
lifecycle/custody retirement through additive migration0050.

## Remaining native implementation — still in scope

1. [Bounded original-backed rolling refresh and latest-purpose review](forma-memory-rolling-history-2026-09-19.md) are implemented. Longer-term semantic reconciliation, cross-scope recall and automatic consumers remain open; the three-window bound is not lifetime coverage.
2. [Native index intents and source invalidation](forma-memory-native-index-intents-2026-09-19.md) are implemented. Remote dispatch, qualified deletion acknowledgements and index reconciliation remain gated on the external adapter.
3. Nested project containment/reparenting and remaining page/library/canvas block identities. [Native document-local block revision bindings](forma-memory-native-block-revisions-2026-09-19.md) now certify personal/governed block field histories and complete supporting-event inverses.
4. [Independent Chat Studio derivation](forma-memory-chat-studio-derivation-2026-09-19.md) is implemented; library/canvas block and cross-document reuse evidence
   and governed artifact consumption remain open. [Historical personal artifact recertification](forma-memory-historical-artifact-consumption-2026-09-19.md) now supports native delivery/derivation and the explicitly negotiated v3 private inspector, while v1/v2 readers retain their original contract.
5. Guarded rolling summary/profile/suggestion/autocomplete consumers with explicit
   correction priority and separate access versus relevance checks. Manual result
   inspection and persisted candidates do not complete those consumer paths.
6. Source-free local index diagnostics are implemented. Remote-index observability and full integration/privacy/request-
   budget qualification; eight prior Output HTTP budget failures remain tracked.

The 64-pair cumulative ledger is not a rolling semantic summary. Native scheduled-
event code does not register or qualify a hosted scheduler. Historical slice notes
above describe what each earlier change implemented; this section is the current
reconciliation and does not reduce the original plan.

## External and operational gates

Keep PostgreSQL/pgvector provisioning, hosted scheduling and atomic migration
execution, provider/pricing qualification, measured monthly-cap approval, restore/
erase/browser qualification and affirmative enrollment in the linked
[capability To Do](forma-memory-sites-capability-todo-2026-09-18.md#capabilities-not-available-directly-through-the-inspected-sites-tools)
and [non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md).
No service was provisioned; no credential, flags, audience, schedule or budget was
changed. The three pending SQL candidates remain unassigned and unapplied.


[User controls, scheduled processing and review](forma-memory-user-controls-worker-2026-09-18.md)
now implement cross-job lineage suppression/correction/release, actor-scoped manual
inspection, localized UI, bounded native worker dispatch, metadata-only backoff,
atomic eligible-work completion watermarks, and scoped processing snapshots.
Migrations0048–0049 are additive and unapplied. Broader consumers, processing rebase,
independent producers, nested scope identity and native index lifecycle remain open.

## Legacy capacity recovery continuation

[Atomic legacy subdivision](forma-memory-legacy-subdivision-2026-09-18.md) adds guarded whole-reference replacement with no financial repurchase or false completion. Migration0051 is schema-only but includes a hash-pinned trigger replacement, not a purely additive migration. It remains unapplied to production. Full native integration remains open.

## Rolling history continuation

[Original-backed rolling refresh](forma-memory-rolling-history-2026-09-19.md) adds same-consent recent originals, complete downstream dependencies, additive migration0052, explicit history boundaries and purpose-specific newest-first review. Migration0052 remains unapplied. All broader native and external work listed above remains tracked.

## Whole-request Memory inspection

[Native inspection budget work](forma-memory-native-read-budget-2026-09-19.md) reduces the tested three-window authenticated reads from 68 to 45/48 D1 calls for free/paid original histories, retaining every native privacy assertion. Local D1 includes paid ancestry. This does not qualify hosted quotas or close broader native integration.

[Independent Chat Studio derivation](forma-memory-chat-studio-derivation-2026-09-19.md) adds schema-only migration0053, independent producer progress, bounded original-backed Chat Studio history and locally qualified privacy/recovery. It does not reset Creator progress or complete the broader plan.

## Structural relationship privacy continuation

[Relationship retirement](forma-memory-relation-retirement-2026-09-19.md) packages additive migration0055 and closes immediate native result/index-intent invalidation for relationship lifecycle and custody changes. Endpoint/version certification, reuse edges and automatic consumers are still open implementation work. The migration is not applied to production.

## Exact relationship version continuation

[Native relationship bindings](forma-memory-native-relationship-bindings-2026-09-19.md) now certify both document-local endpoint revisions and retain complete privacy inverses. The bounded rolling reader consolidates resource evidence and preserves all three history windows under the native request gate (46 free / 49 paid calls in resource-rich synthetic qualification). Cross-document reuse, library/canvas resources and broader automatic consumers remain open.
