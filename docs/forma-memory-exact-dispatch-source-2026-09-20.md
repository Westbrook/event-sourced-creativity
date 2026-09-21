# Memory current-source dispatch binding — 2026-09-20

Status: implemented and verified locally. No deployment,
real provider calls, migration, enrollment or external service changes.

## Current-source privacy

A document stream head does not change when a private event body is erased,
replaced, or its custody changes. The specialist previously checked the head
but could dispatch an already captured private body after such a change.

The actual specialist quote, purchase and dispatch now capture the exact event
and private-body rows already read for their canonical context. A bounded,
request-local read witness replays those rows as an exact multiset predicate
inside the native consent/admission transaction and final provider check.
Owner, project, document, public provenance and private bytes are bound; missing
or redacted rows fail closed. Shared source hydration also requires the sidecar
owner to match the selected project owner.

The witness is not a permission or a browser capability. Existing current actor,
selected session, project custody, rights, source head, budget, consent and
Memory ancestry checks remain mandatory. It adds no source-read round trip.

## Native database limits

Large shared quote reuse checks separate the additional source assertion from
the custody SELECT, within one atomic native batch. Specialist submission also
uses a separate same-transaction source assertion to stay within SQLite's
expression-depth limit. No positive proof is cached outside that transaction.
Private values stay bound parameters, never SQL literals.

## Verification checkpoint

- 28 personal/shared fault cases cover changed body, redaction, owner/project/
  document custody, deletion and public provenance at admission and final dispatch.
- Actual isolated workerd/D1 checks exercise unchanged successful requests and
  late changed-source requests, plus personal/shared chained semantic results.
- Native paid-result reader and cancellation checks protect the expression-depth
  fix and release proven-unused reservations.
- Neighboring authoring, duplication and Output regression: 96 passing tests.
- The prior downstream/profile full native suite completed with 1,951 passing
  tests **before this dispatch change**; it is not final proof for this change.

Final native regression: **166/166 pass**. Actual workerd/D1 and native-depth/
cancellation subset: **10/10 pass**; fault-seam subset: **21/21 pass** (counts
overlap). TypeScript, changed-worker lint and production build pass with existing
chunk-size warnings. The full
[native completion matrix](forma-memory-completion-matrix-2026-09-20.md) remains
assigned; the external/operational checklist is separate.
