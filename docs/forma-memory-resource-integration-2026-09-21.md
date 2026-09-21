# Independent Library and Canvas Memory — 2026-09-21

Implemented locally on `codex/forma-memory-foundation`. No production schema,
feature flags, users, provider spending or schedule registrations were changed.

## Native resource identity and explicit consent

A Library is its actual owner-qualified project collection. A Canvas is its
native CanvasCreated identity. Neither uses a fake document ID. Current principal,
project/context selection, organization custody, Canvas eligibility and resource
visibility are proven independently. An organization owner cannot omit project
context to alias a governed resource as personal Memory. Links, nesting, the
selected document and its enrollment grant no additional resource access.

Additive migration `0067_memory_resource_enrollments.sql` creates independent
actor-private resource consent, metadata history and negative retirement markers.
There is no backfill. Enrollment explicitly fixes custody, future-only sequence
floor, learning/recall/background choices, time zone and a 1–30-day retention and
consent lifetime. Changes use exact revision checks, clear old private history
and start a new future-only window. Missing or modified optional schema fails
closed; requests do not install migrations.

## Actual callers and activity history

Library and Canvas have explicit Resource Memory controls, localized in English,
French, Arabic and Japanese. Merely mounting, opening or focusing the controls
never enrolls, captures activity, reads linked documents or invokes a model.
Users may review the next bounded page and inspect retained 7/30-day activity.
These are **action counts, not semantic preferences or reading-time estimates**.
The source responses carry no private authored prose, file bytes or destination
content. All counts are non-independent evidence.

Native block creation/edit/rename/weight/lock/removal/restoration and Canvas item,
reference, text and register actions are selected using historical and current
native placement. Ordinary Library edits that omit project metadata are bound to
their exact native block history, never the currently selected project. Actor,
owner, custody, private envelope, synthetic/replay exclusion and current consent
remain mandatory. Document-owned blocks are not silently included.

Each capture reads at most 65 qualifying metadata rows, commits at most 64 and
updates its cursor in the same transaction. Final source/access observations are
replayed before publication. Lost acknowledgements remain unconfirmed and are not
automatically retried. A new explicit attempt resumes the durable cursor without
duplicating sources. Storage retains at most 2,048 action references per grant;
inspection reports up to 256 current sources and discloses the bounded history.

## Nightly processing and privacy

The existing native scheduled handler now calls the resource runner, separately
gated by literal scheduling admission, actor rollout and each background grant.
One due resource is processed per invocation. New windows become due at the next
local 01:00, including DST and quarter-hour zones; delayed invocations catch up.
Saved pages can continue later. No-change scans create no inferred preferences or
provider request. Failed scopes receive source-free backoff instead of starving
other enrollments. **Host registration, throughput and nightly delivery remain
unqualified operational work.**

Private-source changes/deletion retire captured references immediately. Durable
negative markers also cover erasure *before the first review*, preventing exact
body restoration from being treated as new activity. Markers below the committed
cursor are safely pruned; renewed consent starts beyond prior history. Withdrawal,
expiry and personal-account erasure remove the corresponding private resource
state. Authored event history and created resources remain intact. Shared-owned
records are excluded from personal-content erasure, but each actor can separately
forget their own shared-resource Memory.

The existing Memory panel now includes a source-free inventory of the actor's
Library/Canvas enrollments. It remains usable when Memory is disabled or project
access has been withdrawn. It reads control metadata only, with bounded paging,
and never requires re-enrollment to forget a grant. UI views clear on blur,
pagehide, expiry, scope changes and privacy mutations; delayed responses cannot
restore cleared history. No private browser persistence was added.

## Verification

- 73/73 integrated native checks, including adjacent personal erasure, genuine
  personal/shared scope and consent, actual D1 capture/recall, source restoration,
  pagination and neighboring document Memory with the new migration installed.
- Separate actual D1 request measurements: personal capture/recall 8/7 calls;
  shared 9/8 calls, all below the unchanged 50-call regression ceiling. Observed
  synthetic local request times were approximately 143/43 ms and 146/56 ms,
  respectively; these are not hosted latency/SLA evidence.
- 747/747 adjacent-control/client checks, including the 177 client checks, and
  83/83 disposable local-migration checks.
- 10/10 whole-application synthetic browser journeys: real Library/Canvas controls,
  explicit consent, uncertain writes, privacy invalidation and source-free
  forgetting, including Arabic RTL at 320px. Screenshots were inspected.
- Type checking, scoped lint and Sites build pass; existing chunk-size and dynamic
  import warnings remain. Runtime-test lint retains its 16 pre-existing findings;
  none are in the new tests.

Evidence is retained in the independent continuation handoff under
`continuation-20260918/evidence/20260921-resource-memory`.

## Still assigned elsewhere in the full plan

This closes distinct resource identity/enrollment, metadata history, native
scheduling integration and these actual privacy controls. It does not turn action
counts into semantic resource summaries or aggregate assistant authority. Broader
semantic profile consumers, direct private creative-output integration and whole-
system qualification remain assigned in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md). External service,
rollout and explicit user-enrollment gates remain in the
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).

## Frozen full regression

Commit `b2c72f14` passes the complete assistant runtime suite:2564/2564, zero
failures,1485794.973375ms, from an immutable archived checkout. This includes the
resource integration and preceding package-reference work, but not later
aggregate-profile changes. It remains local synthetic evidence, not deployment.

## Native downstream recall evidence and final delivery

The actual resource-history reader now retains a private, environment-bound
source handle alongside its owned presentation. Future native consumers can
replay every exact schema, actor, custody, enrollment, source-row and opening
predicate in their own atomic transactions; browser JSON cannot mint authority.
A failed or uncertain replay permanently retires that request handle. This is
not model-use consent or a durable semantic consumer registration.

Both resource identity and history responses recheck the original lease after
serialization. Invalid/non-finite clocks, clock reversal, expiry, configuration
changes and binding replacement deny disclosure. Rolling counts expire at the
next seven-/thirty-day boundary as well as the source retention ceiling.

104 integrated native checks pass, including13 new cases and two real local D1
handle/replay/uncertain-ack journeys. Types, scoped worker lint and the production
build pass. A separate integrated Memory regression at4af22be3 passes2172/2172
with zero failures; it predates this resource recall change. No migration,
provider request, enrollment or deployment was performed.
