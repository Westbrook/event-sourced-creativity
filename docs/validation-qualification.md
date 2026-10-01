# Validation qualification and ownership

This continues the [September 30 plan](testing-validation-efficiency-plan-2026-09-30.md).
The integration owner schedules the combined candidate; domain maintainers own
behavioral assertions. This is an engineering validation record, not human
acceptance of the product or permission to create private fixtures.

## Execution ownership

`tests/validation-registry.json` records a command, lane, resource class and
maintainer role for every discovered suite. Playwright membership is explicit,
including the previously unassigned Memory/containment and reviewed-download
specs. Conditional environment inputs are inventoried without evaluating modules
or enabling their flags. Browser owners must supply the named prerequisites;
a missing account/archive/backend is an unavailable variant, not a skipped pass.

The current Forma Site release uses this repository's graph and the Sites
source/archive workflow. There are no tracked GitHub/GitLab workflows or configured
local Git hooks in this checkout. The report also identifies the separate
[`reve-ai/still-platform-pilot` verification gate](https://github.com/reve-ai/still-platform-pilot/actions/runs/36322751152):
its successful run belongs to commit `2409a32da23625520f840db4846da548326b0264`,
not this checkout. Its `.github/workflows/still-core.yml` owns the GKE pilot's
core/focus jobs and an explicitly dispatched `full_forma_audit`. It does not
qualify or deploy this Site's current source.

That pilot integration owner must adopt the same staged graph when these changes
are ported to that separate repository. Its independently provisioned core/focus
jobs currently each build; sharing an immutable artifact is a future pilot-CI
optimization, not permission to reuse a mutable build across isolated runners or
to modify its protected release gate here. No workflow was dispatched and no
pilot deployment was changed by this task. The external ownership question is
resolved without pretending a local receipt is a successful external CI run.

The managed Node runner supplies this checkout as `FORMA_SOURCE_ROOT`. An explicit
alternate source tree is rejected: diagnostic cross-checkout runs must use direct
commands and cannot qualify this checkout. Per-test deadlines default to 60 seconds
for source cases and 180 seconds for runtime/artifact cases. Explicit case deadlines
remain authoritative, including intentionally longer heartbeat observations.

## Value and cost decisions

Review identity is behavior × failure mechanism × layer × environment. The
following dispositions retain the named scenario declarations and negative cases.
No failing suite was removed from discovery or automatically retried.

| Family | Disposition | Protected failure and reason |
| --- | --- | --- |
| Dialog, Scene admission, Storyboard source, native publication helpers | Merge setup only | Registration-free fixtures eliminate repeated parent scenarios while retaining each consumer's different failure mechanism. Scenario parity was checked before extraction. |
| D1 expression/query limits | Keep; reuse immutable compilation results | Real SQLite rejects invalid/deep SQL. Full SQL/schema/function/limit/binding/compiler keys, corruption misses and cross-process tests prevent a warm false pass. Mutable databases remain independent. |
| Toolbar and ordinary browser fixtures | Keep; share the owned server/browser | Fresh contexts retain cookie/storage isolation. The three-engine toolbar matrix and native zoom still prove different behavior. True zoom retains its own profile. |
| Slow Store/Source ownership fixtures | Keep; cache only immutable TypeScript output | The same production module was repeatedly transpiled. A bounded cache keys source, compiler options and TypeScript version; evaluation, stores and authorization remain fresh. No whole-suite speedup is attributed to this small cache. |
| Output controller, accessible names, focus, private API boundaries | Keep; repair stale harness ports | Missing current imports, DOM event surfaces, retained receipt fields and private methods previously failed before reaching assertions. Exact source/authority/expiry and stale-response refusal checks remain. |
| Source-only architecture and dependency assertions | Keep when they enforce a boundary | They remain useful for forbidden imports and scope rules. Text matching on a cost-expression prefix was replaced with evaluation of that actual expression, preserving the native-quote regression check. |
| Native Worker transport and SQL limits | Keep separately | Node response behavior and actual workerd transport/SQLite constraints are different evidence. Passing one cannot satisfy the other. |
| Legacy paid image-cycle command | Retire entry point | It sent unsupported paid flags; it now stops before credentials/provider work and points to the maintained manifest workflow. Historical paid receipts remain intact. |
| Historical generation-envelope scripts | Keep outside routine regression | These preserve intentional historical mismatch evidence. They are inventoried; no unmeasured rewrite or repeated provider calls are justified. |
| Retained native-account/archive, GPU, physical devices and AT | Keep explicit acceptance gate | Synthetic contexts and local browsers do not establish those claims. Missing evidence stays open under QA-001, rather than fabricating a fixture or replaying accepted QA-002 journeys. |

`node scripts/validation-cost.mjs <cases.jsonl> [...]` ranks observed leaf-case
cost by suite and reports repeated observations. Parent summaries are excluded.
Repeated observations across deliberate reruns are not automatically duplicate
coverage. Timing sums describe assertions, not process startup or elapsed critical
path. Use the receipt's wall duration and resource measurements alongside them.

High-value fault probes cover a real injected TypeScript error, altered vendor
bytes/membership, stale build output, conflicting server identities, changed
SQL/schema/limits, interrupted processes and isolated module state. These failures
must remain visible before reusing the corresponding infrastructure.

## Measurement rules

`python3 scripts/measure-validation.py` runs a fixed provider-free Node/SQLite
selection at 1, 2 and 4 workers, twice each with fresh and warm compile caches.
It checks identical leaf outcomes and stable candidate inputs. It never deletes a
shared cache or reinstalls packages. RSS is the operating system's child-process
high-water mark, not aggregate simultaneous memory of the process tree. Samples
on a shared workstation are exploratory; they do not establish p95 or a flake rate.

On the measured workstation, the review targets for the fixed 25-leaf pilot are
under 25 seconds cold and 12 seconds warm at two workers. These are comparison
targets for this workload, not universal timing assertions in normal tests.

The default remains two Node processes and one browser worker for shared-resource
lanes. Four-worker calibration is permission to measure an isolated workload,
not a global concurrency recommendation. Independent background work consumes the
same machine budget; do not multiply each nested runner's worker count.

## Broad diagnostic census

The stable source-lane diagnostic on the repaired harness reported 10,567 Node
records: 10,456 passed, 111 failed, no skips/cancellations/timeouts, in 358 seconds.
Its first visible negative arrived at 7.97 seconds. The previous diagnostic used
a different lane membership and changing fixtures, so its longer wall time is
not a valid whole-suite before/after comparison.

The cost reporter identified 10,509 distinct leaf identities and two generated
name collisions (three malformed moderation responses and four refresh-failure
variants). Those are distinct inputs, not evidence to delete tests. Each variant
now has a unique descriptive title. The longest measured suite was Document-scoped
Output names (51.3 seconds of assertions), followed by responsive-product (33.6
seconds, one existing failure). Controller paid-intent, queued-grant and preflight
binding followed at 20.1, 15.3 and 14.8 seconds. Their different authority and
stale-callback failure mechanisms are retained; no arbitrary file split repeats
fixture initialization.

The unchanged historical assertion failures remain engineering debt. Full source
coverage was measured to expose that debt; it is not the acceptance result for
a selected infrastructure change and is not reported as green.

## Remaining evidence boundaries

The full historical repository baseline has stale source assertions and fixture
failures outside the changed harness consumers. Its failures remain in normal
discovery and fail the default graph. They are recorded separately from the
infrastructure's acceptance probes; an implementation receipt must not describe a
partial selection as a green repository baseline.

Actual-data downloads require an explicitly supplied detached backend. The
Memory synthetic config requires its provider-free network opt-in and an owned
preview port. Neither config silently adopts an occupied user preview. Production
SQL packaging continues to use the existing approved migration manifest; test
optimization does not activate held migrations.
