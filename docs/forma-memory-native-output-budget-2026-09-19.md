# Memory boundary and whole-request Output budget

Local feature-branch implementation; no migration, production deployment, provider
purchase, user enrollment or scheduling change.

## Implemented

The eight retained Output HTTP request-budget failures are resolved. Output
execution now shares an execution-local **negative cleanup predicate** rather than
rereading the Memory schema for each optional expired-body cleanup. Every cleanup
UPDATE still evaluates the exact schema and current origin/marker exclusions in
its transaction. A newly installed or changed schema can only postpone optional
cleanup; it cannot authorize ordinary reads or erase newly registered Memory.
Returned predicates are copied, DB replacement is rejected, and a new execution
has a new observation. Ordinary callers and paired Slides publication retain
their existing fresh-read contracts.

The native `/run` route also shares its initial job identity across the Memory,
durable-job and shared-route checks. Current selected-project authority is still
checked. The atomic execution claim now compares the exact original request,
kind, document and surface as well as its existing attempt/checkpoint conditions.
A late Memory-mode or resource change therefore cannot start an ordinary job or
spend against a stale route snapshot. Other route operations retain their reads.

## Qualification

- Reproduced all eight failures before editing. The complete HTTP matrix now
  passes, including three renewals, source storage checks, bounded provider repair,
  partial publication, lost acknowledgements and late access revocation.
- Worst measured request: **54 → 49 operations**, including D1, R2 and mocked
  provider traffic. Both shared repaired-Slides success cases: **51 → 46**.
  Slow provider-ledger failure: **51 → 47**; publication lost-ack: **52 → 47**;
  final-job lost-ack: Slides **53 → 48**, image **51 → 48**; shared revoked-after-
  commit: **50 → 46**. Request limits and semantic safety assertions were not raised.
- **64** budget/cleanup checks pass, including native route identity races,
  negative marker/schema races, immutable predicate copies and DB replacement.
- **62** Memory/Chat Studio original-capture, publication, recovery and privacy
  checks pass, including isolated workerd/D1.
- Broader native job/reliability/source/identity checks: **318 pass, two existing
  source-regex assertions fail**. Both failures reproduce on pre-change `a1f3a665`.
  Three additional existing UI/import harness load failures also reproduce on
  that baseline. No whole-repository green claim is made.
- Typecheck, changed production-file lint, build and whitespace checks pass;
  existing build chunk-size warnings remain. All data/provider transports are
  synthetic; these checks do not qualify hosted quotas or real-provider behavior.

## Remaining scope

This closes those eight specific budget failures, not every potential integration
mixture. Cross-scope semantic recall, nested project/resource identity, automatic
assistant prompts and autocomplete/accept/reject/undo provenance remain planned
native work in [MEM-003](backlog.md#memory). Unsupported infrastructure and hosted
qualification remain separate in the [Sites To Do](forma-memory-sites-capability-todo-2026-09-18.md).
