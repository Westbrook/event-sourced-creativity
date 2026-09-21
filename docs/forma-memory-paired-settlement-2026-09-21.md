# Native Memory paired settlement — 2026-09-21

## Implemented behavior

An actual Memory specialist execution now settles its recorded token and dollar
usage in one native transaction. The established ledger writers are reused;
there is no second budget, purchase authorization, source-access grant or retry.
Usage is first durably recorded independently of Memory retention. If settlement
is interrupted, a still-authorized private provider response remains recoverable.
Source withdrawal prevents retaining that response, but does not cancel accounting.

Before updating either ledger, the transaction replays the exact reservation and
project/pilot custody snapshots and matches the already-recorded execution receipt.
Every required counter must exist, contain its full hold and admit safe integer
arithmetic. Counter/reservation writes must acknowledge one row. A changed owner,
amount, period, project scope, receipt, missing counter or failed write rolls back
the pair. Previously settled portions of a legacy partial receipt are not charged
again. Concurrent winners and lost acknowledgements converge through durable rows.
The raw-result recovery path uses the same paired accounting, not a weaker fallback.

There is no UI change, migration, production data change, enrollment, provider
spending or scheduler registration in this change.

## Verification

- 28 focused native checks pass: personal/shared complete execution, interruption
  before either ledger, both kinds of legacy partial settlement, late financial
  races, malformed reads, underfunded counters, concurrent winners and lost ACKs.
- The focused run includes actual isolated workerd/D1 recovery after Memory
  withdrawal in personal and shared projects. Providers and accounts are synthetic.
- TypeScript, changed-worker lint, production build and diff checks pass. Existing
  large-chunk build warnings remain.
- Broader specialist/semantic/accounting regression is being recorded separately;
  the 2,016-test full native pass is at preceding commit `e7d79ce2`, not proof of
  this later financial change.

## Capacity and remaining scope

Complete approved execution now measures **111 personal / 119 shared native binding
round trips**, reduced from 116 / 126. Quote remains 50 / 54 and retrieval 36 / 36.
These are whole synthetic invocation measurements, not hosted SQL quotas or
latency qualification. The conservative 50-call execution target remains assigned.

The [native completion matrix](forma-memory-completion-matrix-2026-09-20.md) retains
all remaining consumer, automatic suggestion, profile-promotion, resource/reuse and
qualification work. External qualification and rollout remain in the separate
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
