# Native Memory user controls, processing, and review

This is implementation on `codex/forma-memory-foundation`, not a deployment,
user enrollment, hosted scheduling qualification, or completion of the full plan.
It extends the [private result store](forma-memory-native-results-2026-09-18.md).

## Implemented

- Actor-private, original-lineage corrections and suppression survive job turnover
  within a document enrollment and purpose. They are explicit user controls, never
  model instructions or silently accepted model claims. Release is revision-checked
  and does not resurrect withdrawn results. Corrections do not extend source life.
- Correction/suppression/release atomically retire affected results. Native capture
  excludes protected originals before a provider request. Exact source, custody,
  parent Forget, expiry and tenant deletion paths remove dependent private data;
  minimal accounting remains available to settle original charges.
- Native scheduled processing requires both scheduling and processing flags to be
  literally `true`, plus existing actor, scope, qualification, purpose and allowance
  authority. The default-off path reads no data. An invocation examines at most
  four candidate jobs and dispatches at most one provider request. An inaccessible
  waiting head gets exact-row backoff; an uncertain committed lease is not reset.
- Result publication and completion records/watermarks commit in one transaction.
  Later completed windows cannot advance past earlier unfinished jobs. Empty eligible
  original windows complete without buying a model call. Lost publication ACKs do
  not repurchase. These watermarks describe eligible retained queue work, **not**
  semantic truth, complete historical coverage, or vector-index completion.
- New registration windows are bounded to 64 source references when the completion
  schema exists. Existing larger jobs are not truncated or falsely completed;
  capacity rejection preserves pending work. Individual source/token/body overflow
  still requires explicit processing-window/rebase work.
- Authenticated, no-store HTTP discovery and inspection; explicit correction,
  suppression, release, and single-result withdrawal. Scope/enrollment-bound client
  contracts reject changed identities and stale responses. Owner metadata-only
  recovery after access loss does not load stored correction text.
- Manual review UI in English, French, Arabic, and Japanese. Opening the section
  does not load private results, enroll a user, or invoke a model. Result text and
  correction views retire on scope/visibility/lifetime changes. Failed writes are
  unconfirmed and never automatically retried. Claims remain visibly unverified.
- Scoped, text-free processing snapshots report unfinished/completed windows,
  retained results, and dispatched requests without verified usage. They explicitly
  do not claim a freshness or delivery guarantee. Existing cap/usage UI remains.

## Migrations and release gate

`0048_memory_derivation_user_controls.sql` adds one table, three indexes, and
seven guards/inverses (11 schema-only statements). `0049_memory_derivation_completion.sql`
adds two tables and six guards (eight schema-only statements). Matching ORM,
snapshots, journal, exact runtime/guest profiles, and local dry-run/rerun checks
are included. Both are **unapplied in production**; the separate pending atomic
conversation rebuild still needs its own qualified executor.

`FORMA_MEMORY_DERIVATION_PROCESSING_ENABLED` is a new optional, default-off flag.
No environment, audience, credential, scheduler, qualification, cap, or enrollment
was changed. The consent UI reports processing readiness only with the complete
schema and both explicit scheduling/processing flags. Separate native qualification
and affirmative individual consent remain mandatory.

## Verification

Synthetic original fixtures and mocked provider transport only; no real model
requests or user data. At this checkpoint: 287 native/tenant/scheduled checks,
73 migration/history checks, 47 Memory guest-isolation checks, 524 client/component
checks, and two English-wide/Arabic-320-pixel browser journeys passed. TypeScript,
changed-source lint, `git diff --check`, and the production build passed; existing
large-chunk warnings remain. Browser screenshots were inspected. Evidence is retained
in the independent report. The browser transport is explicitly synthetic and
read-only, not hosted qualification. These suites overlap earlier checkpoint runs;
counts must not be added to historical totals.

## Still native implementation, not an external-services excuse

The [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md)
retains broader scope identities/reparenting, independent Chat Studio derivation
jobs, rolling-history rebase, genuine broader consumption producers, guarded
summary/profile/suggestion/autocomplete consumers, and native index outbox/deletion
acknowledgements. Correction priority is implemented for source exclusion and review;
its integration into these broader consumers remains necessary. Eight previously
reproduced Output HTTP budget failures remain separately tracked, not waived.
PostgreSQL/pgvector provisioning and hosted provider/scheduler qualification remain
separate external/operational gates. This implementation does not replace them with D1.
