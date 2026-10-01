# Validation efficiency implementation

Implemented against `main` baseline `eff7c5ee08bc85a6f8107ec30c634c02e60c7dab`.
The [current guide](validation.md) and [AGENTS rules](../AGENTS.md) define the
workflow. This receipt records local implementation and verification, not hosted
activation, human acceptance, or a claim that every existing test is green.

## Delivered

- **Early negative feedback:** one expanded TypeScript program includes production,
  the queue worker and all 18 TypeScript test files. Types precede lint, source
  tests, runtime tests, build preparation and artifact tests. Later stages stop on
  a negative result. Successful types/lint receipts are reused only on matching
  inputs; failures are never reused as passes. Generated `outputs`, test reports,
  coverage and work directories are outside lint discovery.
- **Maintained discovery:** 1,511 test files (572 source, 831 runtime, 38 artifact,
  70 browser), 19 Playwright configs, 29 package commands, checker entrypoints and
  129 existing conditional-mode records. Inventory detects omitted/removed files,
  stale helper classification and importing registering test modules. Separate Worker/temporary Vite fixture builds do not trigger a main build. The Node
  graph now includes `.test.ts`; separate browser prerequisites stay explicit.
- **No duplicate registration through four extracted fixture families:** dialog
  host, native publication, Storyboard source and original Scene admission. Their
  consumers use helper modules; original named scenarios and assertions remain.
  Twelve previously guarded imports remain documented exceptions, not automatic
  permission to add new imports. AST-based import discovery avoids treating
  source strings used by tests as real imports.
- **Qualified preparation:** build owns the union of CEM, localization, Memory
  schema, clean and Vite prerequisites. Input and output hashes qualify reuse.
  Managed build writers, artifact tests and combined built-browser runs share an
  exclusive lock. An interrupted process cannot qualify a check even if its child
  exits zero. POSIX cancellation targets the owned process group.
- **Reusable infrastructure:** ordinary browser tests get new contexts on a
  worker-owned Chromium; true zoom retains fresh persistent profiles and native
  extension zoom. Toolbar browser cases use one identified, parent-owned Vite
  server and retained dependency cache. Compatible explicit Playwright configs
  combine into one server batch; conflicting source/built commands fail closed.
  Installed Chrome was replaced with bundled Chromium in the activity lane.
- **Bounded parallelism and compilation:** Node defaults to two processes, with
  an explicit worker option. A run-scoped cross-process D1 compile cache keys exact
  SQL, schema, function signatures, bindings, limits, compiler and Python/SQLite
  identity; corrupt records recompile. It never shares mutable databases.
- **Current process guidance:** README, AGENTS, browser and toolbar release guides
  put cheap checks first, keep compatible lanes together, preserve user previews,
  distinguish historical acceptance from local regression and require honest
  failure/skip reporting. The stale image-cycle CLI now stops before credential or
  provider work and points to the manifest workflow.

## Verification and observations

Logs and receipts are retained under ignored `outputs/validation/`. Temporary
build/baseline checkouts were used so the existing preview's `dist` was preserved.
No retained actual-data fixture was created or altered; no paid evaluation or
release was run.

| Check | Result and evidence |
| --- | --- |
| Expanded production/test/queue typecheck | Pass; `final-types.log`, and the types step of `2026-10-01T00-00-42-090Z-d10c9bb8`. Test-only type errors were repaired without relaxing the tested runtime assertions. |
| Workflow and D1 infrastructure | 29 checks pass across the final 10 workflow cases and 19 D1/cache cases. Includes negative-stage ordering, discovery/import guards, complete-input keys, exclusive locks, cancelled-zero-exit rejection, static receipt reuse/invalidation, exact cross-process compile reuse and conflicting browser lifecycle rejection. See `runner-final.log`, its TAP receipt, `infrastructure-final.log` and `d1-workers-*.log`. |
| Production build and warm reuse | Isolated build passes with all five prerequisites. A second invocation has only a `build: reused` receipt, with no CEM/Vite execution. See `final-build-candidate.log`, `final-build-warm.log` and retained build receipts. |
| Stale artifact rejection | Injecting a synthetic file into isolated `dist` makes `test:node` fail before artifact cases; removing only that probe restores the output. `stale-output-probe.log`. |
| Shared toolbar server | 98/98 reported tests pass, zero skips, all three engines, exactly one server start. Receipt `toolbar-64bcf5f7-f183-4c47-921e-1fe05a29d846/receipt.json`; browser duration 310.67s. This is an integration result, not a before/after speed claim. |
| Toolbar units plus previously omitted TS runtime tests | 288 total, 284 pass, four existing failures. The 44 toolbar unit cases pass. `typescript-and-toolbar-units-final.log`. |
| Ordinary browser reuse and native zoom | Calibration 11/11 before and after; fresh-context and native 200% probes 2/2. `baseline/browser.log`, `browser-after.log`, `browser-isolation.log`. |
| Combined Playwright configuration | Two intended cases list correctly; one compatible server is selected, conflicting source/built lifecycles rejected by the workflow test. Actual historical journeys remain unverified: their required 4186 port is occupied. A missing synthetic-network opt-in also fails explicitly. The port owner was preserved. |
| Changed-file lint and whitespace | Pass; `final-changed-lint.log`, `final-runner-lint.log`, `git diff --check`. |
| Full lint / full graph | 276 existing errors remain; untouched baseline has 279. The fast graph passes types and fails lint, starting no later test/build stage. `full-lint.log`, `baseline/full-lint.log`, `final-fast.log`. A green full graph is not claimed. |

Single-sample calibration observations, same selected 11 cases:

| Setup | Playwright duration |
| --- | ---: |
| Before: persistent browser per ordinary test, one worker | 17.7s |
| After: worker browser, fresh context, one worker | 8.5s |
| After: two workers, fully parallel calibration only | 8.8s |
| After: four workers, fully parallel calibration only | 5.1s |

The D1/query-limit/cache slice has 19 passing cases at each worker count. End-to-end
single-sample durations were 12.35s (one), 5.50s (two), 4.78s (four), recorded in
`d1-worker-samples.json`. These are pilots, not p95, flake-rate, peak-memory, or
whole-suite speed guarantees. The two-process Node default leaves room for other
active runtimes. Shared-account browser lanes remain at one worker.

## Retained failure coverage

The four extracted parent files retain identical scenario declarations; the AST
comparison is in `scenario-parity.json`. Before/after runtime slices show fewer
reported registrations without new unique failing names:

| Slice | Before | After |
| --- | ---: | ---: |
| Dialog parent and two direct consumers | 192 records; 55 failures | 122 records; 40 failures |
| Scene/publication extraction slice | 120 records; 117 failures | 59 records; 25 failures |
| Remaining fixture consumers plus 18 TS files | 526 records; 15 failures | 520 records; 12 failures |

These are Node-reported records, not unique leaf counts. The audit's initial
static estimate of 153 extra dialog registrations was not a measured runtime
saving; guarded/source-extracted consumers behave differently. Comparisons use
baseline source with unchanged production code; the last slice was repeated in
an untouched `HEAD` checkout. Earlier baseline loaders and raw logs are retained.
No assertion was weakened and no failing suite was excluded.

Existing failures include stale dialog fixture APIs (`store.subscribe`,
`owner.hasFocus`), Storyboard preparation/quote expectations, and four experience
host/selector runtime cases. They still fail after inclusion/extraction. Full
lint debt includes existing production and vendored declarations. These need
separate domain repairs, not ignored failures or automatic retries.

## Remaining boundaries

[VAL-002](backlog.md) records the observed baseline repairs and continuing value
review. The inventory does not establish that every assertion is useful or every
conditional mode executed. In particular:

- Six Playwright specs lack current config membership: audio reviewed download,
  slides reviewed download, Memory assistant context/resource/scope recall, and
  project containment. Their prerequisites and owners require qualification before
  promotion into a default lane. Other standalone browser Node files remain
  explicitly separate from default Node execution.
- QA-001 hosted/native-account/archive/hardware evidence remains unresolved. The
  current task authorized synthetic harness work, not replacement actual-data
  archives or live qualification. Accepted unchanged QA-002 journeys stay closed.
- External CI was not available in this repository. The portable local graph is
  ready for an identified CI owner; no external CI activation is claimed.
- Whole-suite cold/warm equivalence, RSS limits, repeated flake sampling, and broad
  semantic/mutation review remain unestablished because the baseline is red and
  some qualification fixtures require separate authority. Keep reviewing costly
  suites from retained receipts; do not use this work to delete distinct proof.
- Build fingerprints are deliberately conservative. They favor safe invalidation
  over speculative dependency narrowing; passing ordinary tests are not cached.
  Standalone tools/previews outside the managed lock still require coordination.

Existing run evidence and qualified caches remain available. No cleanup policy
was introduced for retained failure logs, paid receipts or actual-data archives.
