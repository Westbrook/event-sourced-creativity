# Validation workflow

Run the least expensive relevant checks first. Keep compatible work together and
reuse qualified infrastructure without sharing mutable test state. The maintained
entry point is `scripts/validation.mjs`; discovery is in
`tests/validation-registry.json`.

## Commands and order

| Command | Purpose and prerequisites |
| --- | --- |
| `pnpm typecheck` | One TypeScript program for production, queue worker, build and `.test.ts` contracts. Use during editing. |
| `pnpm validate:fast` | Types, then full lint. Records successful input hashes. |
| `pnpm test` / `pnpm validate` | Types → lint → source → runtime → build → artifact. Stops between stages on failure. Matching successful type/lint receipts are reused. |
| `pnpm test:source [files...]` | Cheap source/logic lane by default; explicit registered selections follow their actual lane prerequisites. |
| `pnpm test:runtime [files...]` | Runtime/SQLite/workerd lane without an unconditional main build. |
| `pnpm test:artifact [files...]` | Prepares or reuses the main build before artifact consumers. Individual fixture builds may still be distinct necessary tests. |
| `pnpm test:node [files...]` | Node lanes; artifact consumers require an already qualified matching build. Does not run types or lint. |
| `pnpm build` | CEM generation, localization check, Memory schema check, clean and Vite, or exact input/output reuse. |
| `pnpm validate:inventory:update` | Recalculate discovery and conservative dependency classification. Review changes before use. |
| `pnpm validate:inventory` | Reject missing files/configs/commands, stale classification, and unguarded imports of registering test modules. |
| `FORMA_A11Y_SYNTHETIC_NETWORK=1 FORMA_BROWSER_CONFIGS=output-footer,context-return-reading pnpm test:browser` | Selected compatible Playwright configs, one owned server per origin, run-specific output. |
| `pnpm test:still-toolbar` | Focused units then all three toolbar engines against one identified synthetic Vite server. |
| `pnpm test:still-toolbar:browser` | Browser half only when the exact unit inputs already have passing evidence. |

Append `--dry-run` to Node validation commands to inspect the graph. `--workers=1..32`
controls Node process concurrency (default min(2, available CPU parallelism)).
`--force` on the runner disables static/build receipt reuse. Browser CLI options
pass through the browser command. Browser default stays one worker: calibrations
at 2/4 workers do not qualify shared-account lanes for parallel execution.

TypeScript keeps its incremental graph in ignored `outputs/validation/types.tsbuildinfo`;
ESLint keeps a content cache beside it. Preserve these across edits. The compiler
and linter still revalidate changed inputs; a warm cache is not a test result.

`memory-synthetic` supports an explicitly allocated loopback port through
`FORMA_SYNTHETIC_PREVIEW_PORT` (for example, 48286). Its network guard and preview
share that origin and strict port binding fails on collision. Historical configs
with fixed URLs retain their original port; do not apply the override to those
configs without port-equivalence evidence. No port owner is killed or adopted. This lane serves hash-pinned local copies of
the same font families; licenses and upstream commits are in
`tests/browser/font-fixtures/`. Semantic expiry uses Playwright clock advancement
after asserting visible private content; it does not substitute for native
wall-clock cadence evidence.

Run one CPU/memory budget across concurrent Node, browser, Vite and workerd jobs.
Independent reads can run together. Build consumers, shared profiles, shared
accounts and mutable fixtures require ownership and ordering. Node process
isolation is retained. Do not split one test lane into repeated setup/teardown
cycles around unrelated work. Do not run full checks after every small edit:
select affected cases, fix failures, then widen at a coherent checkpoint.

## Discovery and coverage

The registry accounts for `.test.mjs`, `.test.ts`, `.spec.mjs` and `.spec.ts` under
`tests`, including nested browser files, root Playwright configs, package scripts,
and validation/evaluation entry points. A `browser` classification means separate
prerequisites are required, not that the Node graph executes it. Direct Node
browser runners retain their documented commands; explicit Playwright config
selection rejects specs without an owned config. Review coverage and
conditional modes before claiming a complete project qualification.

Source/runtime/artifact classification follows static helper references and is
conservative scheduling metadata, not proof that a test is useful or that dynamic
imports are fully understood. Review overrides with a reason. Each domain owner
must still map changed behavior and its negative cases to the selected tests.
Keep unique proof from real D1 limits, workerd transport, browsers, native zoom,
physical devices and assistive technology. Do not remove source assertions merely
because they inspect source; forbidden-dependency checks can be appropriate.

Registering test modules must not double as fixtures. Shared fixture modules
contain setup functions, no scenario registrations. Inspected historical
`directlyInvoked` guards and loader suppression have explicit registry exceptions;
new imports require a helper or a reviewed guard. Do not automatically add an
exception when discovery fails.

`historicalHolds` records the QA-001 boundary. Offline synthetic harness regression
work is authorized; production/native-account/GPU qualification remains separately
unresolved. No excluded file, disabled environment mode, skip, missing tool,
or failure is a passing test. Node receipts distinguish passes with skips.

Every suite has an execution record and named maintainer role. See
[qualification and cost decisions](validation-qualification.md) for conditional
browser commands, historical holds and the confirmed automation boundary.

The managed runner supplies `FORMA_SOURCE_ROOT` for its checkout. Default per-test
timeouts are 60 seconds for source cases and 180 seconds for runtime/artifact
cases; an explicit test timeout can cover deliberately longer observations.

## Qualified reuse and resource ownership

Build receipts hash source, dependencies/lockfile, configuration, generators,
relevant environment and tool identity, then hash output independently. An altered
or missing `dist` invalidates reuse. CEM is fingerprinted after generation. A
failed or interrupted build never writes a successful receipt. `build.lock`
serializes managed builds, Node artifact consumers and combined built-browser
runs. A busy lock fails with ownership guidance instead of killing another task.
Investigate `owner.json` and confirm its process has stopped before manually
removing an abandoned lock; do not delete an active owner's lock.

Standalone preview/checker commands do not participate in this lock. Before a
rebuild, coordinate any active preview using `dist`, or validate in a separate
checkout. Source HMR and built fixtures are separate identities. The combined
browser runner rejects conflicting server commands/environment at one origin and
never adopts a server merely because its port is open. Project names remain
unchanged because exact fixture admission can depend on them; duplicate names
fail before startup and require separate selections. Only artifact directories
are namespaced. Existing account previews
remain externally owned and retain the browser guide's actual-data requirements.

Ordinary shared-fixture tests reuse Chromium within a worker and get a new context
for every test. True zoom keeps a new persistent profile and the real extension.
Cookies, storage, globals, pages, consent and accounting must never leak between
cases. Toolbar child tests validate their parent's exact identity endpoint before
borrowing its server; only the parent closes it. Vite dependency cache survives
the batch; temporary per-case caches are still cleaned in standalone fallback.

D1 compilation uses an optional **run-scoped** immutable result cache shared by
Node processes. Keys include exact SQL, schema, functions, limits, bindings,
Python/SQLite/platform identity and compiler code. Connections remain fresh for
misses; real D1 limits remain enforced. Corrupt records are misses. Errors and
negative SQL results remain failures, never qualification. No real fixture rows
are written into the cache. Mutable databases are never shared by this cache.

## Evidence and lifecycle

Managed runs write `outputs/validation/<run>/receipt.json` and per-stage logs.
Each Node stage also writes `*.cases.jsonl` with actual leaf/parent names, outcomes,
explicit skips and durations. `node scripts/validation-cost.mjs <cases.jsonl>`
produces an offline cost ranking. Receipts retain input hashes, selections, concurrency, durations, exit signals,
Node totals/skips and build reuse. Logs announce the first observed negative
result while the active lane finishes; later lanes do not start. Process groups
are terminated on interruption/timeout on POSIX. No automatic retry masks a
failure. Per-run logs remain after failure; cleanup is not automatic.

A receipt is evidence for its exact inputs and selected scope. It grants no
release, provider, actual-data or migration authority. Changed relevant inputs
invalidate cached evidence. Cheap types/lint can be reused automatically only
from successful matching receipts; test cases are not automatically cached.
Keep retained archives, paid receipts and acceptance traces distinct from
rebuildable caches. No retention policy here authorizes deleting them.

Use the [browser guide](../tests/browser/README.md),
[release checks](still-toolbar-release-checks.md), and
[migration coordination](local-migrations.md) for their separate prerequisites.
Missing actual archives never authorize recreating them. The retired image
cycle CLI fails before reading credentials or starting a provider; use the
[generation manifest workflow](../evals/generation-reliability/README.md) only
within its existing authority.

Performance observations and remaining baseline failures are recorded in the
[implementation receipt](validation-implementation-2026-09-30.md). The original
[audit plan](testing-validation-efficiency-plan-2026-09-30.md) remains historical
context rather than a second current command sequence.

## Diagnostic fallback and rollback

If a managed receipt or scheduler is suspect, retain its logs and use the same
explicit selection with `node --import tsx --test --test-concurrency=1 <files>`.
Unset `FORMA_SQLITE_CACHE_DIR` for a no-cache SQL comparison; preserve the existing
cache for inspection. Browser configuration files also remain directly callable
with `pnpm exec playwright test --config=<owned config>`, after establishing the
same fixture/build prerequisites. A direct invocation is diagnostic evidence,
not permission to bypass a failed release gate or an occupied preview.

`--force` recomputes managed checks/build qualification when investigating stale
receipts. For a prior-implementation comparison, use an isolated checkout of
`eff7c5ee08bc85a6f8107ec30c634c02e60c7dab`; retain current environments and source.
The published predecessor is `d1dddc3a9ce8f820ea81fa6e2c2cb09b346a41bc` (Site 556).
Its saved archive is a release recovery reference, not an automatic rollback:
reconcile any later publication before replacing a live version.
