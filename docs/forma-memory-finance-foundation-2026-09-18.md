# Memory finance foundation — not live processing

Feature-branch work on `codex/forma-memory-foundation`, based on local main
`7d74584bb72a1ed3cbab25ee64071994f8976d2f`. No production SQL, deployment,
provider request, enrollment, scheduling, credential or budget change occurred.

## Implemented

- Additive migration `0045_memory_derivation_finance`, ORM declarations and
  snapshot0041. Five tables separate minimized financial records from erasable
  job/source records. They contain no source text, document IDs or private body references.
- A payer/UTC-month cap shared across Memory purposes. Accepted consent can
  lower it, but withdrawal, erasure, replacement or later consent cannot increase
  or reset it during that month. Existing consent floors are seeded atomically.
- Immutable original payer, period, model/prices, maxima and token/cost IDs;
  exact native holds, organization/pilot settlement targets, write-once dispatch
  claim and permanent admission closure. Only the private job bridge cascades.
- Immutable verified usage retains actual zero or overrun usage. Zero usage is
  not evidence of no dispatch. A separate proven-no-dispatch disposition can
  release original exposure only after permanently closing dispatch.
- Counter initialization now inserts absent rows and updates limits separately,
  without attempting replacement of retained financial targets.
- Purpose-consent and withdrawal acknowledgement accounts for exact additional
  D1 trigger/cascade changes. Renewing consent closes old jobs without silently
  refunding their holds. Guest historical inventory rejects guest-linked finance,
  cross-kind reservation aliases and schema drift.
- The local migration runner admits exactly this hash-pinned cap seed, not
  arbitrary data-changing SQL. Existing installations must prove their retained
  floors; missing/weakened floors fail closed rather than being guessed or reset.

## Verification

Isolated synthetic data; no external provider requests:

- 134 native derivation/tenant-deletion tests passed, including twelve finance
  tests and personal/shared consent-renewal/withdrawal against SQLite and local D1.
- 52 local migration tests, 17 schema/history tests, eight new guest-finance
  isolation tests, and 27 budget-ledger/admission tests passed.
- Typecheck, changed-source lint and production build passed. Build retains
  existing large-chunk warnings. The entire repository lint is not claimed clean.
- Eight Output HTTP operation-budget failures reproduce with identical counts
  on the isolated `297acaa` baseline. They remain unresolved baseline gates,
  not waived tests or evidence of a merge-ready whole branch. The broader paid
  Scene suite also reproduces 117/117 failures on that same baseline (primarily
  native source-proof expression-depth limits); the same 27 accounting tests
  pass with this change. That source-proof integration gate remains open.

## Remaining implementation — not an external blocker

1. Connect native leased source capture to financial admission and durably
   synchronize accepted cap floors for each new UTC month before reserving.
2. Implement one-shot provider dispatch, authenticated usage receipt persistence,
   uncertain-submission recovery and exact original-hold reconciliation. SQL
   receipt acceptance alone does not authenticate provider evidence.
3. Complete organization deletion integration: preserve exact finance-bound
   counters/sidecars, close admission, erase private sources, and reconcile late
   usage without reacquiring source access. Existing blockers remain conservative.
4. Expose effective retained cap/usage and minimized-financial-retention disclosure
   in purpose controls; no automatic consent or invented cap.
5. Complete the semantic processors, dependency/correction/suppression stores,
   wider scopes, rolling-history rebase, broader producers and full qualification
   in the [native continuation](forma-memory-native-continuation-2026-09-18.md).

Migration0045 is journaled on the branch but **not applied to production or
approved here for standalone activation**. `processingImplemented:false` remains.
This foundation is not a scheduler, consumer, embedding index or complete Memory
system. External/service work remains separately tracked in the
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
