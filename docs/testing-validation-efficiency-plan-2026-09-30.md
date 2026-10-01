# Testing and validation efficiency plan

Current workflow: [validation guide](validation.md). All six implementation
packages and measured results are recorded in the
[final receipt](validation-implementation-2026-09-30.md) and
[qualification boundaries](validation-qualification.md). The audit below preserves
its original baseline and proposals.

Prepared September 30, 2026 against `main` at `eff7c5ee08bc85a6f8107ec30c634c02e60c7dab`.
**Status at original review: review complete; implementation proposed.** No test runner, application,
AGENTS rule, deployment, fixture, or acceptance requirement was changed by this
review. This plan covers engineering validation in this repository, including
local checks, browser and Worker environments, evaluations, release verification,
migration checks, and human acceptance. External CI and sibling repositories
need separate confirmation where they participate in the same delivery process.

The largest immediate opportunities are to discover type errors before building,
stop duplicate test registration, build each candidate once, and run compatible
browser checks together against reusable infrastructure. Parallelism should be
bounded by CPU, memory, and shared resources; fresh mutable test state remains
necessary even when the browser, server, compiler, or build is reused.

## What this review establishes

Three parallel source audits covered Node/Worker tests, browser infrastructure,
and process/release guidance. Counts below are a static census, not executed test
counts or measured savings. Representative fixture and assertion implementations
were examined; this does **not** certify every individual test's usefulness.
Phase 1 below turns the census into an executable ownership and cost inventory.
No full suites, builds, migrations, paid evaluations, or live acceptance journeys
were run merely to prepare this plan.

| Surface | Current inventory and scope |
| --- | --- |
| Package commands | `typecheck`, `lint`, `cem`, `cem:check`, `i18n:check`, `build`, `test`, `test:a11y`, `test:still-toolbar`, `release:verify`; also `dev`/`start`, `db:generate`/`db:migrate:local`, `replay`, and the three `eval:image-adapters*` commands and their prerequisites. |
| Default Node discovery | 1,421 top-level `tests/*.test.mjs` files. The same glob excludes 18 `.test.ts` files and 28 nested browser `.test.mjs` files. Some separate browser runners are intentional. |
| Browser discovery | 17 root Playwright configs; 40 `tests/browser/*.spec.mjs` files, 34 named by their explicit config membership. Six nested Node browser files are reached by `test:still-toolbar`; the other 22 are outside these package test commands. Additional native 3D and standalone MP3/Still-rejection runners exist. |
| Heavy Node setup candidates | 65 selected files directly construct Miniflare, with 119 constructor sites; 159 load TypeScript, 75 call transpilation, and 362 assign globals. These source patterns are not measured execution counts. |
| Assertion review candidates | 630 selected files contain `assert.match`/`assert.doesNotMatch`, with 7,554 textual call occurrences. These are not all source-only tests and must not be deleted as a group. |
| Other gates | Build hooks, localization/CEM/schema generation, D1 query-limit compilation, migration dry runs, native heartbeat modes, provider preflights/reuse, historical generation-envelope checkers, archive/source verification, and manual device/assistive-technology acceptance. |
| Automation | No tracked `.github`, `.gitlab-ci.yml`, or `.husky` entry points were found; the local `core.hooksPath` setting was unset. This does not establish the absence of externally managed CI. |

Primary entry points: [package scripts](../package.json), [agent guidance](../AGENTS.md),
[development instructions](../README.md), [browser guide](../tests/browser/README.md),
[toolbar release guide](still-toolbar-release-checks.md), [migration guide](local-migrations.md),
[generation evaluation guide](../evals/generation-reliability/README.md),
and [backlog](backlog.md). The project research skill already warns that test/check
commands can mutate artifacts or invoke providers; preserve that guidance in
[its workflow](../.agents/skills/adversarial-product-research/SKILL.md).

## Findings and priorities

| Priority | Finding and evidence | Proposed correction |
| --- | --- | --- |
| P0 | README lines 76–81 schedule `build → typecheck → lint → test → cem:check`. Both `build` and `test` regenerate CEM, check localization, clean `dist`, and run Vite (`package.json:12–14`). Types therefore arrive late, and following the whole list builds twice. | Put types and relevant static checks first. Separate no-build test execution from preparation; schedule one canonical production build and let downstream checks consume it. |
| P0 | Build/test prerequisites differ: only `build` checks the Memory schema-repair manifest (`package.json:12–14`). | Preserve the union of required checks in the shared preparation graph. Removing a duplicate build must not silently remove schema verification. |
| P0 | A fixture exported by `inactive-generation-dialog-host.test.mjs:334` lives beside 51 unconditional tests beginning at line 396. Three independently discovered files import it: `model3d-generation-ui.test.mjs:3`, `output-viewer-focus.test.mjs:6`, and `activity-private-note-pending.test.mjs:6`. | Extract side-effect-free helpers. The current full glob registers those 51 cases in three additional processes: 153 extra registrations. Audit the same pattern in publication-depth, storyboard-source-route, and scene-admission test imports. |
| P0 | Test discovery omits the 18 TypeScript tests; production `tsconfig.json:20` also excludes tests. Browser discovery is split across configs, flags, and direct Node invocations. | Assign every test and optional mode to a maintained command or an explicit owned exclusion. Fail inventory validation on new unassigned files. Do not add browser files indiscriminately to the Node glob. |
| P1 | All 17 Playwright configs effectively use one worker. Nine explicitly disable existing-server reuse. Several contend for port 4186 (`playwright.output-footer.config.mjs:13`, `playwright.context-return-reading.config.mjs:13`, `playwright.library-controls-reach.config.mjs:4`). | Consolidate compatible groups and allocate owned ports. Benchmark isolated lanes at 1/2/4 workers; keep resource-dependent lanes serial until proven independent. A listening port alone is insufficient evidence for reuse. |
| P1 | The shared browser fixture launches and removes a persistent Chromium profile for every test, including zoom=1 (`tests/browser/fixtures.mjs:22–85`); 34 specs import it. It records a full trace on passing tests too. | Use a worker browser with a fresh context per ordinary test. Preserve specialized true-zoom profiles. Separate ordinary development diagnostics from required acceptance traces and measure capture cost before changing it. |
| P1 | Nested browser tests repeatedly own Vite/browser lifecycles. Toolbar fixtures create and delete Vite caches (`tests/browser/helpers/still-toolbar.mjs:19–24`). Activity previews rebuild on every start (`scripts/activity-receipt-test-preview.mjs:18–23`). | Share compatible fixture servers/builds within a batch, retain a dependency cache keyed to its inputs, and keep per-test data and per-run evidence separate. Extend the existing MP3 runner's one-server/browser, fresh-context pattern. |
| P1 | `test:still-toolbar` reruns seven Node files already included by `pnpm test` (`scripts/test-still-toolbar.mjs:9–10`). | Keep the convenient focused command, but allow the orchestration graph to satisfy its unit prerequisite using a matching successful receipt and run only the remaining browser cases. |
| P1 | D1 depth checks spawn Python synchronously and recreate an in-memory schema for every uncached compile (`tests/helpers/d1-expression-depth.mjs:34–49,100–108`). Its existing cache is process-local (`:128–166`); 93 test/helper files mention the enforcing helper. | Measure startup/schema/compile costs. Trial a run-scoped compiler service or immutable cross-process result cache with complete SQL/schema/functions/limits/tool-version keys. Preserve actual limit enforcement and isolated schema state. |
| P1 | Node file concurrency is not explicitly bounded, while many files mutate globals or start expensive runtimes (`package.json:14`; `tests/selected-output-share-performance.test.mjs:21–28`). | Tune file-level concurrency by resource class. Retain process isolation and serialize shared global mocks inside each file. Apply one total budget across agents, Node workers, browsers, Vite, and Miniflare. |
| P1 | Browser/release docs contain historical full-baseline sequences and prohibitions on targeted runs; toolbar release instructions put the browser lane before types (`tests/browser/README.md:154,189,424`; `docs/still-toolbar-release-checks.md:17`). QA-001 already requests reconciliation of older 3D test holds. | Separate current developer regression rules from historical acceptance records. Reconcile holds with current owners/evidence; preserve unresolved requirements explicitly instead of silently ignoring them or replaying every old sequence. |
| P2 | Activity selects installed Chrome rather than the pinned Playwright browser (`playwright.activity-receipt-focus.config.mjs:16`). Type/lint ownership is incomplete: tests/scripts/evals and `workers/ordinary-image-queue` are outside production types, and lint ignores `build` (`tsconfig.json`, `eslint.config.mjs:7`). | Pin tool/browser evidence or name the intentionally installed-browser lane. Record the checker owning each code area; add dedicated type-contract/tooling checks where appropriate. |
| P2 | `eval:image-adapters:cycle` sends legacy paid flags that its child now rejects (`scripts/run-image-adapter-cycle-search.mjs:17–19`; `scripts/run-image-adapter-eval.mjs:19–22`). Nested v2 generation checks repeat bridge/native-host work via v1 (`scripts/check-generation-integrated-release-v2.mjs:35–43`; v1 lines 33–40). | Retire or redirect the stale command with an early, no-provider-call diagnostic. Classify historical envelope checks separately; share current calculations only if profiling warrants it, retaining historical expected-mismatch assertions. |

The six browser specs without explicit root-config membership are
`forma-audio-reviewed-download`, `forma-slides-reviewed-download`,
`forma-memory-assistant-context`, `forma-memory-resource`,
`forma-memory-scope-recall`, and `forma-project-containment` (all `.spec.mjs`).
Some require detached backends or specific authority. Inventory their status
before admission; absence from these commands does not mean they were never run.

## Proposed work sequence

The following is the target workflow, **not a list of new commands already available**.
Current commands should be inspected before use; `pnpm test` still owns a build.

| Stage | When and what runs | Reuse and concurrency |
| --- | --- | --- |
| 0 — Select | At task start: map changed behavior and dependencies to checks; inspect active holds, installed tools, existing preview ownership, required fixtures, and source/build identity. Docs-only work uses links/commands/diff checks. | A cheap discovery/preflight can fail immediately without a browser/build. No reinstall, account creation, archive export, migration, or server reset unless actually required and authorized. |
| 1 — Fast feedback | Start typecheck at the first coherent edit checkpoint, before any expensive build/browser matrix. Run scoped lint, relevant static contracts, and focused no-build behavior tests as soon as their code is coherent. | Independent cheap lanes may overlap within a measured budget. A retained type watcher can support iteration; record which source revision reached a clean state. Do not treat a still-running watch process as a completed final check. |
| 2 — Focused runtime | Run affected source/model/component/SQLite cases while implementation continues. Add Worker/real-D1 cases where the changed contract requires them. | Batch each compatible family. Avoid Node → browser → build → Node alternation without a dependency or failure-driven reason. Fix cheap failures before launching their expensive dependents; independent useful diagnostics may continue. |
| 3 — Prepare candidate | Once relevant edits settle, generate affected contracts once, inspect generated diffs, verify localization/schema/manifest requirements, and build the required production artifact once. | One writer per generated output. The canonical build retains all current cleanup and packaging invariants. Identical prerequisites are deduplicated; unknown inputs cause a rerun, not a guessed cache hit. |
| 4 — Integration/browser batch | Run all selected build-dependent, server, browser, keyboard/focus/zoom, and platform cases against qualified outputs. | Keep compatible infrastructure warm; fresh contexts/data per case. Independent synthetic lanes can overlap; shared-account/true-zoom/timing-sensitive lanes retain documented constraints. No rebuild of an output actively used by a preview. |
| 5 — Final integration | At the final integrated candidate, widen coverage according to risk. Sweeping shared-contract/harness changes select broader consumers, across all affected applications. | Reuse still-valid earlier receipts. Run the broader remaining matrix once, not once per subagent. A later change invalidates its affected checks and dependent artifacts, not automatically every prior check. |
| 6 — Release/acceptance | If separately in scope, verify the tested release archive, saved receipt, hosted behavior, and missing physical-device/AT/operator evidence. | Reuse the exact tested artifact. Source-before/after archive checks and saved-receipt comparisons establish different facts and remain. Accepted unchanged human journeys are not automatically reopened. |

For the current implementation, a major-change final check can use `pnpm build`
for one main production build followed by the selected
`node --import tsx --test <explicit files>` invocation,
rather than immediately invoking the build-owning `pnpm test`. Selection must first
respect resolved holds and build prerequisites; the separate TypeScript/browser
lanes must be accounted for. This is an interim scheduling option, not a complete
replacement for `pnpm test` or permission to skip its coverage. Some selected Node
tests legitimately build distinct fixture artifacts (for example,
`tests/audio-share-mp3-vite.test.mjs:43`); those have separate identities and are
not duplicate main production builds. Direct Node invocation is not universally
free of build or other setup side effects.

### Selection and invalidation rules

| Change | Early evidence | Later evidence and invalidation |
| --- | --- | --- |
| Documentation only | Links, command validity, diff | No application build unless executable/configuration content actually changes. |
| Pure model/Worker logic | Types, scoped lint, focused behavior/negative tests | Relevant DB/runtime/HTTP consumers; full matrix if shared authority, accounting, event/state, or provider contracts change. |
| Component contract or shared UI | Types, lint, component behaviors; affected CEM/localization contracts | Generate/verify both manifests once; built rendering and affected keyboard/focus/RTL/zoom/browser lanes. Shared primitives select all known consumers. |
| Migration or schema contract | Static journal/hash checks and isolated dry-run/migration tests | Real applicable D1/Worker constraints; existing shared DB migration coordination remains. Do not stop an unrelated preview. |
| Test/helper/config only | Discovery, checker configuration, helper callers | Rerun affected tests; app rebuild only if build inputs changed. Shared fixtures select all consumers and isolation checks. |
| Lockfile/toolchain/build boundary | Install/preflight once if needed; types/static checks | Invalidate corresponding compiler/browser/build caches and broaden artifact/runtime coverage. |
| Live provider, release, or human acceptance | Existing qualification, authority and exact scope | Only missing or invalidated evidence; uncertain purchases are never automatically resubmitted. |

Each receipt should identify the selected cases and unique leaf IDs, relevant
source/input hashes (including uncommitted content), lockfile/config/tool versions,
fixture/environment/build identity, mode/flags, outcomes/skips, timings and artifact
locations. HEAD alone is insufficient. Record why a receipt was reused or
invalidated. A cached failure can aid diagnosis but cannot qualify a candidate.

### Tooling and confirmation overhead

Measure shell/tool startup separately from command execution. During this review,
initial login shells stalled before producing output; non-login calls returned
normally, matching the existing handoff's warning. Use the known working shell
configuration instead of repeatedly starting a broken login environment. This is
an observed tooling issue, not a measured test-suite bottleneck.

Reuse available setup, valid scoped approvals and completed evidence within their
actual boundaries. Collect independent read-only prerequisites in one batch and
surface genuinely missing inputs together. Do not repeat an approval question or
replay a human checklist solely because another agent or chat takes over. Changed
scope or authority still needs its own disposition; a test receipt grants no new
permission. Preserve concise run receipts and handoffs so later work can tell
what remains valid without redoing the investigation.

Progress-report status/data updates do not require rerunning report browser tests
unless report behavior changed. Similarly, a documentation-only validation plan
does not justify running the application suite. Measure administrative checks and
evidence preparation alongside the test phases when evaluating total work cost.

## Reuse infrastructure without leaking state

Distinguish three ownership classes: user-owned previews/data, reusable synthetic
infrastructure, and isolated disposable test state. Never kill or reset an
unowned server because its port is convenient. Preserve current retained account
and archive prerequisites; missing data is not authority to recreate it.

Use a small environment lease/manifest rather than a generic service platform.
It should record owner, process/port, workspace, source-versus-built mode,
artifact/fixture identity, browser/runtime versions, readiness, active consumers,
and cleanup responsibility. Probe health **and identity** before attaching.
Reuse a server only when those fields match. Replace/restart it when it cannot
adopt a newly qualified application/build/fixture identity, for a changed
runtime/config or schema requirement, an unhealthy process, or a test specifically
exercising restart behavior. HMR avoids a restart only after verifying the new
identity. A source HMR fixture and built-output fixture are distinct.

Keep package/browser installations and immutable builds available across batches.
Cache keys must include relevant transitive inputs and tool/config versions;
generated outputs are published as complete artifacts only after successful
preparation. Keep one writer to today's `dist`; do not remove the cleaner merely
for speed. If immutable per-candidate outputs are introduced, adapt consumers
explicitly and test interrupted builds and stale-output rejection.

Reuse browsers with fresh contexts, Worker bundles with isolated DB/bucket
namespaces, and compiler outputs with full correctness keys. Do not share mutable
cookies, globals, storage, consent, jobs, or accounting across cases. Preserve
tests that deliberately require fresh processes, startup/teardown, independent
storage, migrations, or recovery. Run order-randomization and cross-case leakage
probes before widening concurrency.

Useful existing patterns include
[one workerd instance with separate scenario bindings](../tests/output-model3d-recovery-workerd.test.mjs),
[a helper accepting an existing verified build](../tests/helpers/audio-share-mp3-lifecycle-workerd.mjs),
and [one MP3 browser/server with fresh contexts](../tests/selected-output-share-mp3-browser/run.mjs).

Keep historical acceptance evidence immutable. Store current diagnostics in
run-specific directories. Any cache/artifact retention policy must distinguish
rebuildable cache from irreplaceable archives, paid receipts, and retained failure
evidence; this plan does not authorize deleting the latter. Trace-on-failure may
be suitable for ordinary development, but successful acceptance traces and
geometry captures remain wherever their evidence contract requires them.

Playwright supports worker reuse with isolated contexts and configurable worker
limits; server reuse is configurable. These mechanisms support the proposed
approach, but do not establish that this repository's fixtures are safe to share.
See the official [parallelism](https://playwright.dev/docs/test-parallel) and
[web-server](https://playwright.dev/docs/test-webserver) documentation. Node's
[test runner documentation](https://nodejs.org/docs/latest-v24.x/api/test.html)
describes process isolation and concurrency controls; validate options against the
actual pinned/runtime version rather than adopting new APIs from latest docs.

## Decide which tests are useful

Give each suite a small record: owner, behavior/requirement, protected failure,
layer/runtime, positive and negative cases, dependencies, command/modes, side
effects, resource class, fixture authority, observed duration/setup cost, and
required evidence. Group possible duplicates by **behavior × failure mechanism ×
layer × environment**, rather than by filename or assertion wording.

Use four dispositions: keep; merge exact overlap; move to a cheaper appropriate
layer; retire superseded proof with a recorded replacement. Record the reason and
retained scenario IDs. Require a known regression or bounded fault injection to
demonstrate detection for high-cost/high-value cases. Pilot mutation sensitivity
on a few changed contracts; do not add a whole-repository mutation run to every edit.

Source assertions can appropriately enforce forbidden dependencies, localization,
or architecture. Brittle implementation-text assertions should be replaced when
a behavior test protects the actual contract more reliably. Extract type-contract
fixtures into an early dedicated typecheck where practical. Mocks must not merely
reimplement the code under test. Very large files are candidates for measured
domain splits, not arbitrary fragmentation that repeats expensive setup.

Retain distinct proof from Node SQLite, D1 query-limit compilation, real workerd
transport, built browser behavior, true browser zoom, and physical/AT testing.
For example, workerd's `Content-Length` behavior differs from Node
(`tests/selected-output-share-stable-mp3-workerd.test.mjs:23–26`). The optional
125-second native heartbeat observation (`tests/helpers/model3d-heartbeat-workerd.mjs:78`)
establishes real cadence; schedule it separately from fast timer-mocked logic,
rather than shortening it and claiming equivalent proof.

Report skips, environment-disabled variants, quarantines, and missing tools as
unverified coverage. A green partial run must not imply those cases passed. Any
quarantine needs an owner, reason, affected claim, and review trigger; retries
must not conceal a regression or become the principal performance strategy.

## Proposed AGENTS.md validation replacement

Apply this with the runner/documentation work, preserving architecture, authority,
privacy, fixture, migration, and deployment rules. Update README and the active
browser/release guides in the same change so instructions do not conflict.

> Before expensive validation, identify changed behavior, relevant suites and
> active holds, existing environments, prerequisites and shared-resource owners.
> Documentation-only changes require link, command and diff checks, not an app build.
>
> Run TypeScript and relevant static checks at the first coherent code checkpoint,
> before production builds and browser matrices. Run focused no-build behavior
> tests early. Parallelize independent cheap checks within the task's total resource
> budget, and surface failures immediately.
>
> Inspect command side effects. Generate affected contracts once and review both
> manifest diffs. Prepare one required production build per candidate input set,
> preserving all localization, schema and packaging checks. Do not run a build and
> then a build-owning test command for the same inputs. Until split runners exist,
> select an explicit no-build test invocation after the required build. Serialize
> writers to generated files and dist; never rebuild an artifact in active use.
>
> Batch compatible integration/browser cases while their infrastructure is warm.
> Verify environment identity before reuse; retain fresh contexts and mutable data
> isolation. Replace/restart a server that cannot adopt the new application/build/
> fixture identity, or for changed dependencies/configuration/schema, failed health,
> or a test of restart itself. Verify HMR adoption before reuse. Preserve user-owned
> previews and retained data.
>
> Use bounded file/suite parallelism after identifying ports, files, databases,
> globals and timing constraints. One coordinator budgets all nested runners and
> agents. Delegated work returns focused receipts; the integration owner schedules
> the broader final check once for the combined candidate.
>
> Repeat successful checks only when relevant inputs changed, their environment
> became invalid, failure investigation requires it, or a broader integration scope
> requires additional proof. Record selection, source/build identity, results,
> skips, timing and invalidation reasons. Keep local tests, release verification,
> hosted qualification and human acceptance distinct; report unverified areas.

## Implementation packages and completion criteria

| Order | Work package / proposed owner | Concrete completion evidence |
| --- | --- | --- |
| 1 | Inventory and baseline — validation maintainer | Machine-readable registry covers every package command, test file, config project, conditional mode, standalone checker, build hook and current manual gate. Reconcile QA-001 holds with owners; resolve external CI ownership. Inventory itself does not launch tests or paid work. |
| 2 | Scheduling and proven duplication — validation maintainer | Extract side-effect-free fixtures; verify unique scenario coverage and absence of import-triggered registration. Expose source/artifact/runtime/browser lanes and a composed compatibility command. Preserve schema-check parity. Update AGENTS/README/active guides and stale eval CLI. No app build is prerequisite to source-only tests. |
| 3 | Shared preparation and browser lifecycle — browser/runtime maintainers | One qualified build per candidate; one server per compatible batch. Nonzoom cases use isolated contexts on reusable workers. Tool/browser versions and ports are reproducible. User previews survive the batch unchanged. True-zoom/network/calibration proof remains equivalent. |
| 4 | Bounded parallelism and heavy setup — runtime maintainer | Benchmark 1/2/4 worker settings by resource class; choose a default based on elapsed time, first-failure latency and peak memory. Trial compiler/runtime reuse only where setup is material. Exercise stale keys, crashes, cleanup, concurrent writers and cross-case leakage. |
| 5 | Value review and long-tail cleanup — domain owners | Review suites in descending measured cost and flake burden. Each merge/removal preserves named failure coverage; high-value cases demonstrate detection. Separate historical qualification commands from ordinary regression commands without rewriting historical receipts. |
| 6 | Portable final gate and rollout — integration/release owner | Local and confirmed CI use the same selection/dependency graph. Fresh-checkout and warm rerun produce the same unique case membership/results. Final report shows timing/cost improvement, skips and remaining exceptions. Preserve a rollback path to prior lane behavior until equivalence is demonstrated. |

These are proposed roles, not assignments or authorization to activate CI, hosted
services, paid evaluations, or migrations. This is the original planning record; all six implementation packages and their
remaining evidence boundaries are now recorded in the
[implementation receipt](validation-implementation-2026-09-30.md) under VAL-001. QA-001/QA-002 keep their own ownership and acceptance scope.

### Measurement and acceptance

Capture baseline data before changing runners using representative small logic,
shared-component, Worker/D1, browser-only and sweeping multi-application changes.
Use the same candidate, machine class, tool versions, workload and evidence mode
for before/after comparisons. Separate cold setup, warm reuse and steady-state
assertion time; report sample sizes. A few trials can guide a pilot but do not
justify a p95 claim. Reuse existing receipts where trustworthy; do not repeatedly
run live/paid scenarios to obtain performance samples.

Measure time to first actionable failure and complete selected validation; phase
and slow-file durations; build/server/browser/Python/Miniflare starts; cache hits;
CPU/peak RSS; tracing/artifact bytes; unique leaf cases; skips; flaky failures and
reruns; and unexpected environment resets. Count leaf cases separately from
parent-suite records and imported duplicate registrations.

Adoption requires:

- Types start before expensive dependent stages; an injected type error prevents
  those stages from starting and is surfaced promptly.
- Exactly one build per required unchanged candidate/artifact identity; no
  duplicate scenario registration or duplicate prerequisite execution.
- Every discovered test/mode has a maintained owner/command or explicit exclusion;
  selecting a lane does not accidentally expand into unrelated or paid work.
- Identical retained behavioral/negative coverage, no stale-artifact passes, no
  cross-test state leakage, and no increase in flakes or hidden skips.
- Reproducible cold-start success and lower warm validation/feedback cost under a
  fixed resource budget. Set numeric latency targets after the baseline; this
  review makes no unmeasured percentage-speedup claim.
- Logs and receipts explain reused, rerun, skipped and blocked checks; unrelated
  user environments and accepted human evidence remain intact.

Start with packages 1–2. They resolve concrete correctness and scheduling defects
before the more invasive runtime/cache optimizations. Validate the plan and
backlog as documentation only; implementing the packages carries its own focused
behavior, discovery, isolation and performance checks.
