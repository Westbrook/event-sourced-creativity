# Memory-assisted Output requirements — 2026-09-21

## Implemented

The actual Document Assistant and Chat Studio now retain eligible Output wording
in their private, source-bound creation review. Version2 explicitly allows only
`output` with `include`; version1 remains unchanged and cannot be reinterpreted
as Output approval. The version participates in the exact publication hash.
Field-only requests cannot expand into Output creation.

The localized control explicitly saves an **unconfirmed Output requirement**.
It sends identifiers and an approval hash, not a substituted draft or client
specification. Native authoring rechecks source, actor, target, exact retained
review and Memory authority atomically. Shared projects have a separate narrow
`memory-output-create` operation: only the deterministic interpretation of the
approved prose is accepted. Supplied statuses, media settings, influence fields
and modified specifications cannot enter that operation.

The real Output snapshot receives the authored requirement, with no confirmed
plan, grant or generation. Subsequent interpretation, plan confirmation, cost
approval and generation use existing Output controls. Generic block Undo is not
offered: Output editing/removal must keep its revision/commitment boundary.

Withdrawal retires private review and supporting inference, but preserves the
deliberately authored requirement and its non-independent Memory attribution.
Restored private bodies cannot supply a new approval. This is direct Output
requirement integration, **not private image generation or live image preview**;
those remain assigned in the completion matrix.

## Evidence

- Four personal/shared SQLite and real local D1 journeys: explicit save, exact
  native Output snapshot, duplicate denial, withdrawal and ordinary-Undo denial.
-14 native approval/source/private-body/access race checks pass with no authored
  changes on rejection.
-67 model checks and114 focused Memory component/host checks pass; counts overlap.
-12 whole-app synthetic browser journeys pass: Document/Chat, English/320px
  Arabic, blur/expiry/explicit save. Arabic screenshot inspected: RTL text and
  approval disclosure wrap, script-like text stays literal, no horizontal overflow.
- TypeScript, scoped lint and Sites production build pass, with existing bundle
  size warnings. No migration or external service is needed for this change.

The broad600-test model/host/panel run has545 passes and55 failures. All55 exact
failure names reproduce on immutable preceding a2523f8b; none are introduced
here. They are stale selector expectations in broad panel fixtures and remain
tracked for reconciliation, not reported as a passing full suite. The2,594-test
native full pass belongs to a2523f8b, not this subsequent change.

No real provider call, enrollment, deployment or main push occurred.

## Integrated fixture reconciliation

The55 baseline panel failures are now corrected in the test ports: they model
the current exact Library-inspection and document status/footer selectors while
preserving the query census, focus, geometry and no-write assertions. The combined
model/host/panel run passes611/611. No production UI was changed by this repair.

The broader Memory model/client/native run passes2,158/2,159; the sole failure
was an unchanged block-history expectation that still required version1 instead
of the current default version2. That expectation is corrected and the same test
now separately verifies explicit legacy-version1 capture. The focused rerun and
changed-test lint pass. This does not relabel the original broad run as passing.
The full native run at immutable1009d386 passes2,614/2,614, with zero
failures (1,916,666.945333ms). This includes aggregate read batching, its original
request deadline and Output requirements. It excludes the later fixture changes
and current resource-opening integration.
