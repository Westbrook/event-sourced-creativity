# Memory completion matrix — 2026-09-20

**The full plan is not complete.** This consolidates, rather than replaces or
narrows, the [original plan](forma-scope-aware-memory-plan-2026-09-02.md).
Source integration with local main is committed at `3ed22909`; the verified
source/maintenance follow-up is `618d55e5`. Production and main deployment have
not occurred. Passing a foundation or display test does
not close an end-to-end consumer.

## Remaining implementation within the native application

| Workstream | Implemented foundation | Work required before closing it |
| --- | --- | --- |
| Assistant and Chat Studio consumption | Native original-backed recall; private summary/profile/suggestion results; saved references; fresh native consumer source evidence | Wire eligible semantic context into the actual prompt paths with bounded current/recent coverage; durable generated-answer provenance; final source/target replay; historical reader and source withdrawal/expiry/erasure integration; whole-request budgets and UI privacy tests. |
| Exact-field autocomplete | Native versioned block history, source proofs and suggestion results | Bind completion to exact field/revision/language; cancellable nonblocking presentation and IME/keyboard behavior; explicit accept/reject/edit/undo; retain assisted ancestry through later edits and independently authorized reuse; do not persist unsent drafts. |
| Unified evolving profile | Qualified derivation, rolling original-backed windows, private controls, four-result retained profile and explicit broader bands | Longer-term source-backed consolidation, supersession and contradiction handling beyond the bounded retained projection; scope-specific promotion with independent support; consumer integration and lifecycle tests. |
| Complete native resource/zoom coverage | Document/page/block identities and inspection; artifact revisions; same-owner nesting; certified approved-copy outcomes | Library/Canvas resource identity and history, remaining unsupported block histories, cross-owner nesting with independent permissions, and original-source recall across reuse relationships. Nesting must not grant access. |
| Durable downstream lifecycle | Native result/index-intent retirement and saved-reference retirement | Persisted ancestry-dependent generated-answer/edit/output/index invalidation, restore/rebuild negative provenance and non-resurrection tests for the new consumers/resources. |
| Integrated qualification and operations | [Private retained-job diagnostics](forma-memory-processing-health-2026-09-20.md), budget/finance/recovery tests and migration reconciliation | End-to-end journeys across the above consumers, expanded privacy/request/byte bounds, consumer latency and source-evidence freshness qualification; reconcile all failures and update deployment/handoff evidence. |

These are code/integration tasks. **They are not blocked merely because external
services or hosted scheduling are not yet available.** They remain on this task;
no extra user approval is needed to continue their local implementation.

## Separate external and operational work

Track provisioning/qualification and rollout in the
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md#capabilities-not-available-directly-through-the-inspected-sites-tools)
and [non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md):

- Qualified embedding/index transport and PostgreSQL/pgvector service.
- Supported hosted scheduler and atomic migration executor, with capacity,
  no-visitor, failure-recovery, privacy and restore evidence.
- Real provider/model/pricing/retention qualification and benchmark-backed cap.
- Production-owner integration/deployment and affirmative user enrollment.

No fabricated qualification, implicit enrollment, provider charge or deployment
is allowed to substitute for these gates.

## Completion rule

Close the implementation task only after every native workstream above has its
actual caller, durable privacy behavior, tests and recorded evidence. Keep the
separate external/operational checklist open where appropriate. A clean branch,
a passing isolated helper test, or a display-only feature is not full completion.

## Integration handoff status

The review handoff to **Assemble Forma specialist team**
(`01a03eaa-d5b7-7630-943d-7105f7a3067b`) was rejected because that task is archived.
No message was delivered, no task was unarchived and no replacement production
owner was assumed. Owner integration/deployment remains pending; this does not
block the native implementation work above.

## Latest native implementation

[Private processing diagnostics](forma-memory-processing-health-2026-09-20.md) now
connect retained queue age, disjoint job/recovery state, publication age and
registration-to-completion timing to the actual localized Memory review controls.
This closes that diagnostic slice, not the six end-to-end workstreams above.
No migration, deployment, new service, polling or enrollment was added.
