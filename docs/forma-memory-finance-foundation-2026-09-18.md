# Memory financial execution — branch implementation, not activation

Feature-branch work on `codex/forma-memory-foundation`, based on local main
`7d74584bb72a1ed3cbab25ee64071994f8976d2f`. No production SQL, deployment,
provider request, enrollment, scheduling, credential or budget change occurred.

## Implemented

- Additive migration `0045_memory_derivation_finance`, ORM declarations and
  snapshot0041. Five tables separate minimized financial records from erasable
  job/source records. They contain no source text, document IDs or private body references.
- A payer/UTC-month cap shared across Memory purposes. Accepted consent can
  lower it, but withdrawal, erasure, replacement or later consent cannot increase
  or reset it during that month. Schema-only installation leaves existing data untouched; consent/erasure triggers preserve historical minima, and a separate runtime transaction carries accepted caps into each new month before reservation.
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
- Migration0045 is schema-only. The unused finance-specific migration DML
  exception was removed; cap preservation occurs in reviewed runtime/trigger paths.
- Genuine leased full-source captures now reserve both native ledgers atomically,
  with deterministic original reservation IDs, exact native budget acknowledgements,
  and a write-once dispatch claim. Lost acknowledgements never authorize another POST.
- One bounded Responses transport uses the approved model/prices/limits,
  `store:false`, no tools, no background response, no truncation, a 30-second
  deadline, 128 KiB request and 1 MiB response limits, and duplicate-key rejection.
  It returns only citation-checked, explicitly unverified candidates; it does not
  persist or expose them through normal recall. Source withdrawal withholds output
  while verified actual usage still settles at the original prices.
- Financial recovery is independent of source access. Verified zero, overrun and
  cached-token usage settle both original ledgers in one transaction, idempotently.
  Proven non-dispatch can release funds only after permanent admission closure;
  uncertain dispatch remains reserved and is never retried automatically.
- Owner-confirmed organization deletion closes purpose admissions under a fresh
  owner/legal-hold guard, erases private jobs/sources, and preserves only exact
  finance-bound settlement targets. Unrelated provider blockers remain enforced.
- Read-only purpose controls disclose the payer's aggregate effective UTC-month
  cap, verified usage, reserved/uncertain exposure and minimized accounting
  retention in English, French, Arabic and Japanese. They never enroll or spend.

## Verification

All provider fixtures are mocked; no external provider call or hosted qualification
occurred. Current verification is recorded in the
[execution continuation](forma-memory-financial-execution-2026-09-18.md).

## Remaining implementation — not an external blocker

1. Connect the financial/provider path to durable semantic processing windows,
   candidate persistence, dependency/correction/suppression stores and guarded
   consumers. A function returning a candidate is not a completed pipeline.
2. Add durable verified-receipt recovery for interrupted transport/settlement and
   minimized job observability. A stored dispatch marker cannot prove non-submission;
   no timeout or guessed provider usage may release its holds.
3. Complete wider scopes, rolling-history rebase, independent Chat Studio delivery,
   broader original producers and the full native qualification matrix in the
   [native continuation](forma-memory-native-continuation-2026-09-18.md).

Migration0045 is journaled on the branch but **not applied to production or
approved here for standalone activation**. `processingImplemented:false` remains.
This foundation is not a scheduler, consumer, embedding index or complete Memory
system. External/service work remains separately tracked in the
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
