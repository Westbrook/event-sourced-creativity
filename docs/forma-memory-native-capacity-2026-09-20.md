# Native Memory capacity and response bounds — 2026-09-20

Status: implemented and locally verified on the Memory branch. No production changes, real provider calls or enrollment.

## Implementation

- Approved specialist execution continues the same process-local source compilation into its deferred driver only within the original monotonic lease. It rereads retained consent and validates the actor and exact binding. Every dispatch/publication still runs current SQL source, target, hierarchy, permission and negative-ancestry assertions. Expiry independently reconstructs evidence; rollback, withdrawal and drift fail closed. No access decision or serialized capability is cached.
- Native derivation read admission batches job, reference and actor-specific grant/parent/qualification metadata in one database snapshot. It explicitly checks the grant identity against the captured job and retains all final exact-row predicates. Missing, malformed or changed acknowledgements deny issuance before loading original bodies.
- Shared-project synchronization executes its four existing catalog, negative-provenance and manifest queries in two read-only snapshots. The independent integrity query still runs when no migration row exists. Malformed acknowledgements, schema drift and restored derived bodies cannot trigger an unqualified rebuild or scope write. Existing write-transaction bookends remain unchanged.
- Specialist provider response reading is bounded incrementally at 256 KiB with strict UTF-8 decoding and explicit cancellation. It no longer buffers an arbitrary response before checking its size. Provider fetch and response reading have a deadline of at most 60 seconds, shortened to the existing execution/access deadline. An interrupted response remains an uncertain paid operation: no invented usage, automatic retry or private result publication.

## Measured limits

These are synthetic native binding round trips, **not a hosted D1 quota or SQL-statement-count certificate**. The deferred driver begins before the HTTP response finishes, so execution and background phase counts must be added for the stable invocation interval.

| Journey | Earlier personal/shared | Current personal/shared |
| --- | --- | --- |
| Quote | 51 / 57 | 50 / 54 |
| Approved execution including deferred work | 153 / 170 | 132 / 142 |
| Retrieve | 40 / 40 | 39 / 39 |

Regression ceilings now protect these improvements. The conservative 50-call target is **not satisfied** by shared quotes or approved execution. This checkpoint does not close native request-capacity work or substitute for hosted capacity, latency and failure-recovery qualification.

## Verification

- Broad native Memory regression run: 626/626 pass across derivation, consent, privacy, original histories, finance, semantic recall and follow-up. This run preceded the final response-stream bounds; those changes have separate targeted evidence below.
- Final shared-project/output and actual isolated workerd/D1 tests: 45/45 pass, including partial acknowledgements, database substitution, schema races, rollback and negative-provenance restoration.
- Final combined semantic D1, handoff, original/follow-up retirement, metadata and Chat guidance tests: 51/51 pass.
- Provider-reader tests: 15/15 pass, including exact byte ceiling, overflow without draining, split multibyte text, malformed/truncated UTF-8, abort and BOM preservation.
- Runtime response-bound failures: 4/4 pass, including stalled headers and body; one dispatch, no private derived output and no retry or accounting rewrite.
- Quote/execution/retrieval regression ceilings: 4/4 pass. Personal/shared delayed dispatch has 16/16 additional source/consent/permission/schema/clock tests.
- TypeScript, changed-worker/test lint and production build pass; existing large-chunk build warnings remain. The large existing runtime test file still has pre-existing lint findings outside these changes.

Actual providers are mocked, D1 data is isolated and synthetic, and no hosted scheduling, deployment, budget changes or service provisioning took place. The [full native completion matrix](forma-memory-completion-matrix-2026-09-20.md) and [external capability To Do](forma-memory-sites-capability-todo-2026-09-18.md) remain authoritative.

## Incoming control-message bounds

Specialist quote/execute/retrieve/resume now use the same strict native Memory
control parser before any approval or purchase work. It caps bytes while reading,
rejects duplicate/escaped keys, invalid UTF-8, BOMs and non-object JSON, and never
accepts drafts through this control route. The shared parser also cancels on
request abort or its 30-second upload deadline. Cancellation is not awaited, so a
stalled producer cancellation hook cannot keep the handler open. Declared excess
length is rejected before pulling body bytes.

Nineteen focused native/parser/structured-history checks pass, including two
actual specialist upload-abort/deadline cases with unchanged financial state and
zero new executions or provider calls. The earlier 27-case quote/dispatch/control
regression also passes. TypeScript, changed source/host-test lint and the
production build pass; existing chunk-size warnings remain. No runtime deadline
is a substitute for separate hosted qualification.

## Exact initial authority snapshot — 2026-09-21

The durable specialist source reader now gets the current owner-stream head and
initial native admission in one SQL snapshot. The final authority/head replay
and exact private-row dispatch witness remain separate mandatory checks; no
positive access decision is cached. Synthetic complete execution now measures
**123 personal / 133 shared binding round trips**, down from 126 / 136. Quote
remains 50 / 54 and retrieve 37 / 37. The conservative 50-call target still
requires further implementation; these are not hosted qualification numbers.

52 focused native checks pass, including actual isolated workerd/D1, late private
body/custody changes, successful follow-ups and permission/rights changes. Tightened
whole-execution regression ceilings cover the measured reduction.

## Shared current-source ancestry proof — 2026-09-21

Purchase preparation now checks negative Memory ancestry in the same native
current-source predicate used by its atomic consumers, instead of running an
earlier redundant SELECT. The failure path still distinguishes withdrawn
ancestry. No final dispatch, consent, exact source, rights or lease check is
removed. Complete synthetic execution measures **120 personal / 130 shared
binding round trips**; the conservative target remains unmet.

71 focused runtime/privacy tests, TypeScript, changed-worker lint and the
production build pass (existing chunk warnings). These are local, mocked-provider
checks, not hosted qualification or a claim about the later full-suite run.

## Canonical result snapshot — 2026-09-21

Canonical specialist result lookup now reads the execution pointer and its
authorized retained body in one native snapshot. A non-null pointer with an
unreadable body remains an unavailable result, never a missing result eligible
for repurchase or replacement. Final retained-byte and authority assertions
remain mandatory. The redundant recovery pointer read is removed.

Complete synthetic execution is **116 personal /126 shared binding calls**,
and retrieval is **36/36**. The conservative capacity target is still unmet.
301 specialist/semantic regression checks pass, including real local D1,
withdrawal, original/follow-up retirement, finance and crash recovery.98 focused
checks overlap that run. Four final capacity/inventory checks pass after
tightening the ceilings and adding deterministic eight-task selection.
TypeScript, changed-worker lint and production build pass (existing warnings).
No provider spending, deployment or hosted-capacity qualification occurred.

## Exact original chat ingress — 2026-09-21

The original Assistant POST now uses the same strict bounded upload reader as
Memory controls, before context or persistence reads. Its16KiB wire limit includes
fully escaped1,200-character multilingual messages. Invalid UTF-8, duplicate or
escaped-duplicate keys, length mismatch, lone-surrogate text, cancellation and
upload deadline expiry fail without saving a turn or purchasing work. These
safeguards preserve original human text before separately consented Memory capture.

Nine focused checks pass, including bytewise multilingual input. The previous
reader's acceptance of malformed encoding, duplicate keys and lone surrogates was
reproduced on the baseline. TypeScript and production build pass; the API's28
pre-existing lint findings are unchanged. No deployment or enrollment occurred.

## Paired accounting and interrupted recovery — 2026-09-21

[Native paired settlement](forma-memory-paired-settlement-2026-09-21.md) now replays
original financial snapshots and settles both ledgers atomically, while preserving
source-independent accounting and recoverable private responses where authorized.
Counter underfunding, changed custody, missing acknowledgements and concurrent
winners cannot produce a partial new charge or a second purchase.

Whole execution is now **111 personal /119 shared** native binding calls. Quote
is50/54 and retrieval36/36.28 focused native checks, including actual isolated D1,
pass; types, changed-worker lint and build pass. The capacity target remains
assigned and is not a hosted qualification claim.

## Exact local-source dispatch handoff — 2026-09-21

Memory execution now carries an opaque, same-execution source certificate for
plain native authored text from admission into the driver. It retains the exact
native source/head/custody proof, bound consent bytes, database identity and a
30-second wall/monotonic lifetime. Every claim, reservation and final dispatch
still replays that proof. Access, provider policy and pilot allowance are read
again. References, governed packages, externally backed content and managed-pilot
classification retain their original full source reads.

An elapsed certificate can only be replaced by full source preparation under the
same approval; it cannot extend the independent Memory evidence lease. Rollback,
nonfinite clocks, database/consent replacement and expiry at final serialization
prevent dispatch. Newly unsubmitted steps skip paid-result recovery; a new Memory
execute202 acknowledges admission without launching a competing recovery worker.
Retrieve/resume and already-submitted executions retain canonical recovery. The
final response still checks negative ancestry, exact retained bytes and access.

Native multi-turn reservation claims now split over-limit source assertions into
the same atomic batch as the claim. This fixes a reproduced101-bind shared
three-generation case without omitting a predicate or weakening custody.

Whole synthetic execution is now **98 personal /102 shared binding calls**,
quote50/54 and retrieve35/35. The conservative50-call whole-execution target remains
assigned.33 focused source/clock/admission checks plus two actual local D1
three-generation/withdrawal journeys pass;42 Memory field/paired settlement/D1
checks passed before the final reservation-bind split. Full native regression at`e836e547` passes2055/2055
in915.3seconds. No hosted qualification, deployment or enrollment.

## Atomic fresh-result publication — 2026-09-21

A successfully accounted Memory response now publishes its retained private result,
inverse dependencies, execution completion, task completion and action receipt in
one native transaction. The exact retained response, recorded provider usage,
settled ledger amounts (when settled), original source and current permissions
are replayed before publication. Recovery still uses the canonical retained
receipt after interruption; it never repurchases a result. Publication does not
authorize a document edit or disclose private text.

Injected late receipt replacement, raw-body replacement, source withdrawal,
ignored task completion and missing action acknowledgment cannot partially publish.
Repairable interruptions recover from the original receipt without another call;
withdrawn or changed raw sources remain unavailable.

Whole synthetic execution is **88 personal /90 shared binding calls**, quote50/52
and retrieve35/33. Regression ceilings now reflect those measurements. The
conservative50-call execution target remains assigned.436 native specialist,
semantic, consequential and organization regression checks pass;39 overlapping
fault/field/settlement/three-generation checks include real isolated D1.
The full suite at preceding organization commit`e4adb0ea` passes2070/2070; that
full run does not include this later publication change. Types, changed-worker
lint and build pass. Whole runtime-test-file lint retains16 pre-existing findings.
All provider responses are synthetic. No hosted qualification or deployment.

## Native approval replay and paired admission — 2026-09-21

Freshly admitted native Memory requests now carry an opaque, single-use,
same-request/database/host compilation into the deferred driver. One read-only
transaction replays the exact principal, pilot admission, retained consent,
execution identity, winning task, original turns and full semantic source proof.
The receiver requires every acknowledgement. It is not a cached positive access
decision: changed rows fail, expired captures require full reconstruction, and
clock rollback or malformed acknowledgements prevent dispatch. Existing tasks,
managed pilots and unsupported source kinds keep the original full-read path.
The worker still refreshes authorization before provider dispatch.

New native Memory steps now reserve the existing token and dollar ledgers and
claim the cost reservation in one transaction. This composes the existing budget
builders and the same live cost-claim policy; it creates no separate allowance.
Exact source/principal assertions, a quoted-step CAS, reservation absence,
per-insert acknowledgements and final bookends make cap/claim/source failures
atomic. No partial or previously submitted hold is adopted. A lost acknowledgement
never authorizes dispatch or automatic repurchase; verified unsubmitted holds
are released by the existing recovery path.

The Document path now compiles the exact current principal, email, custody and
pilot predicates into the preparation, step and dispatch transactions. These
remain separate SQL assertions to preserve native parameter and expression-depth
limits. After provider completion, an unchanged actor snapshot is verified again;
a changed snapshot falls back to ordinary authorization. Other routes retain
the original authorization path.

Fresh publication returns the actual completed execution row from the same
atomic transaction. Missing, malformed or lost result acknowledgements cannot
turn a second attempt into another purchase or overwrite an existing winner.
Retained derivation reads now enforce the existing 64 KiB result and 256 KiB
manifest limits in SQLite before hydration, following every admission assertion
in that same transaction. A historical read handle cannot inherit another job's
captured body. Exact source/result/dependency replay is still mandatory.

Whole synthetic execution is **67 personal / 71 shared native binding calls**,
from 88/90. Quote is 49/51 and retrieval 34/32. The conservative 50-call target
is still open; these are not hosted quota or latency qualification numbers.

Verification checkpoints (overlapping, not additive): 444 broad runtime checks
passed before the subsequent compiled-authority and bounded-row changes; 65
compiled-authority/source/acknowledgement checks then passed; the final bounded-row
smoke passed 39 checks, and 15 new body-boundary/publication/history checks passed,
including real isolated workerd/D1 three-generation replay. The 15 cover UTF-8
byte limits, admission acknowledgement faults, late withdrawal, history handle
separation and committed-publication recovery including a concurrent winner.
TypeScript, changed-worker lint and production build pass at this source
(existing chunk warnings). The full runtime run launched at admission checkpoint `cd995ff4` passes
2,188/2,188 tests (1,027 seconds). Later exact-field/profile-loading changes have
separate focused evidence; that full run is not an exact-final-tree claim. The earlier background-field checkpoint separately passed
2,125 tests at `0bc453f9`. No actual provider calls, enrollment, production
migration, deployment or external provisioning.


## Atomic admission/response receipts and retention preflight — 2026-09-21

Native Memory admission now compares an already-read quote against the exact
current execution identity, consent reference, intent and expiry in the claim
transaction. That transaction returns the actual reserved execution row. Missing,
sparse, foreign or malformed acknowledgements cannot dispatch a provider request;
an explicit retry recovers the same reserved execution rather than purchasing a
replacement. Non-Memory callers retain their existing claim path.

Fresh Memory response retention now publishes raw private custody, its inverse
registration and the exact task pointer atomically, with a closed native read
receipt in the same transaction. It remains separate from final interpretation:
a later decode/publication failure can recover the paid raw response without
another provider call. Required source-proof, insertion and task-write receipts
are checked, including each expected final-publication assertion. Raw response
and task metadata byte limits are enforced in SQLite before hydration; the
transport-body bound is checked again before decoding. This is not a new raw
response disclosure endpoint.

A non-pilot continuation now checks current cohort absence in the same native
statement as its source proof. It does not reuse a positive allowance decision.
Late active, paused and closed cohort assignment is rejected in both personal
and shared execution, including immediately before dispatch.

Ordinary expiry preflight batches independent schema and candidate reads. Each
bounded erasure still rechecks its full expiry, legal-hold and negative-origin
predicates. Dedicated ledger/origin work, shared work-unit limits and durable
work exclusions remain unchanged. Unconfirmed candidate frames cannot authorize
erasure. The retention tests now use the existing complete native schema rather
than a three-table fixture that lacked the required event/provenance exclusions.

Current whole synthetic execution: **60 personal / 64 shared binding calls**
(from 67/71 at admission checkpoint `cd995ff4`). Quote remains 49/51 and retrieval
34/32. The conservative 50-call target is still open, and these measurements are
not hosted quota or latency qualification.

Verification: the final-source execution/recovery/D1 regression passes 151/151;
15 rebuilt-worker retention/hold/scheduled-handler checks pass. The complete
native runtime checkpoint at `8ee293ab` passes **2,254/2,254** (1,052 seconds).
This full run is separate from the later `63e91938` disclosure fix below.
All 29 product/privacy/retention checks pass, including eight new
candidate-acknowledgement and late expiry/durable/schema/hold races. Types,
changed-worker/test-file lint and build pass, apart from the separately verified
unchanged 16-finding runtime-test lint baseline. No production migration,
enrollment, deployment, external service registration or actual provider call.


## Confirmed final private disclosure — 2026-09-21

Quote and result delivery now require the complete dense set of successful native
source-proof acknowledgements, plus each expected named result value. Missing,
false, sparse, extra-key, string-valued and array-shaped replies cannot release
private quote, result or Memory presentation bytes. Asynchronous delivery failures
are awaited within the protocol error boundary, producing a bounded refusal
instead of escaping as an unhandled request failure. Explicit retrieval can
recover the same already-paid result after a transport fault; no repurchase or
older-source fallback occurs. Claim, raw and final publication decoders also deny
array-shaped row objects.

All 30 quote/execute/retrieval fault cases pass; the overlapping expanded
execution/D1 regression passes 135/135. Types, changed-worker lint and build pass.
A failed execute-delivery acknowledgement does not erase an already authorized
purchase: retrieval recovers that same paid execution without another provider call.
The full runtime checkpoint at `8ee293ab` is separate from this later disclosure
change. No UI, migration, enrollment, scheduling registration, provider charge or
deployment was added. The remaining native completion matrix is unchanged.


## Bounded native metadata and atomic dispatch — 2026-09-21

Whole approved execution now measures **48 personal / 50 shared native binding
calls** in the existing synthetic journey, down from 60/64. Quote is44/45 and
retrieval29/27. Regression ceilings enforce these values. This meets the local
50-call target for this journey, not hosted quota, latency or capacity qualification.

Document enrollment/identity, bounded source/identity, context/schema and current
principal metadata share native read snapshots. Project hierarchy inventory has
a same-statement byte/count gate. Every original custody, access, source, schema
and lifecycle predicate still participates in final disclosure/write proofs.
No positive access decision is cached between requests.

The final Memory dispatch marker now commits with its exact source/authority
assertions; every mutation and proof receipt is required before calling a provider.
Shared two-currency reservation observes the native project policy once through
an opaque, environment/scope/clock-bound handle; both ledger INSERTs still enforce
the exact current limits and permissions atomically. Negative private-origin
cleanup guards may be reused only within the execution; governed retention
policy remains fresh and its version is checked by the write. A source-free
empty-expiry snapshot avoids unnecessary cleanup preparation only when all
optional Memory/platform retention classes and expiry work are absent.

Verification:22 final dispatch/retention-metadata/capacity checks,73 overlapping
read-bundle/budget/idle-retention/pair checks, and54 adjacent product/private
retention checks pass. Earlier148 source/hierarchy/D1 and34 dispatch/authority
checks cover intermediate versions and are not an exact-final-tree full pass.
The first full native run completed with 2,371 passes and eight stale test-hook
failures: the fault injector expected three metadata statements instead of four.
After correcting that hook, all 48 metadata-bundle fault checks pass. A clean
full rerun will be recorded separately; this is not yet a full-suite pass.
The preceding creative checkpoint at`9f6b67df` passed2,304/2,304 and excludes
this subsequent batching implementation. No provider traffic, deployment,
enrollment, migration or external service registration was performed.


### Frozen full regression result

The immutable `763e91c2` snapshot passes **2,399/2,399** native runtime tests
(zero failures, 1,136.079 seconds). This includes the corrected metadata fault
hooks and committed original-discovery integration. Newer profile and multi-hop
changes are separately verified and are not attributed to this full pass.

## Final private-response delivery — 2026-09-21

Saved assistant context (including aggregate profile sources), retained derivation
results, user corrections, result inventories, selected-source recall, recall
catalogs and boundary metadata now recheck their original request lease after
JSON serialization. A database replacement, elapsed deadline, non-finite clock
or backwards wall clock cannot disclose a response prepared under an older
lease. Correction controls also bound their advertised lifetime by the earliest
retained correction expiry, not only the request timeout. This adds no source
cache and does not bypass the existing final transactional source proofs.

Verification:41 new adversarial delivery cases and122 selected integrated native
cases pass, including personal/shared scopes and correction expiry during
serialization. TypeScript and the unchanged production build pass. No migration,
provider call, deployment or enrollment occurred. The initial unprivileged
integrated attempt could not start the local D1 runtime; the qualified rerun
completed with122 passes and zero failures.

A separately frozen full native run at`a6e690e6` passes2641/2641. That older receipt
does **not** verify the subsequent coordinated-read, resource-recall or current
final-delivery changes. The native completion matrix remains the full scope.

## Aggregate capacity, immediate receipts and restored heads — 2026-09-21

The actual two/three-source assistant now completes in **48 personal / 50 shared
D1 binding calls**, with quote at47/48 and retrieval at32/30. Every phase is
asserted at or below50. Tests require the task to be completed **before retrieval**;
a later recovery response cannot hide a fresh-publication failure.

D1 mutation metadata counts trigger side effects. Raw-response retention now
uses a separately checked SQLite `changes()` assertion after each publication
write, in the same atomic batch. Missing or false assertions, zero direct writes,
changed sources and late authority changes still fail closed. This fixes a real
fresh-publication failure that previously recovered only during retrieval.

Independent original-message, paid-consent, negative-origin schema and correction
reads share an atomic source snapshot. Request-local history and target metadata
staging reuses no positive access result. Exact consent/source predicates remain
in the claim, reservation and dispatch transactions, under the original deadline.

Automatic latest-result lists and cross-scope readers now keep stored completion
identities as head markers if a partial restore omitted a newer result row.
Ordinary deletion already requires tombstones; the additional restore defense
never grants body access. Explicit independently authorized history remains usable.

Evidence:410 integrated native tests,27 subsequent current-head/cross-scope
native tests (including four partial-restore cases),363 client/model checks and
20 actual synthetic Memory-panel browser journeys pass. TypeScript, changed-worker
lint and production build pass with the existing bundle-size warnings. Counts
from overlapping suites are not a distinct-test total. All providers are mocked.

The separate full run atcf5b1f31 finished with2,806 passes,zero assertion failures
and two30-second test timeouts among2,808 tests. All three150-row deletion scenarios
pass in isolation. Only the two expensive fixture setup budgets are raised to120s;
production deadlines, query bounds and deletion chunk assertions are unchanged.
A clean full rerun is still required; that earlier run is not called a full pass.
No hosted capacity, scheduling, activation, enrollment or deployment is implied.
