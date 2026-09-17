# Ordinary intake HTTP boundary maintenance

`tests/experience-intake-http-boundary.test.mjs` restores the meaningful HTTP
coverage left behind by the old two-output extraction harness. It uses the
current native handler, principal authorization, private storage, receipt
reader, and event append code with disposable in-memory SQLite. No product
source changes are included.

The seven focused groups cover:

- Foreign Origin and cross-site POST refusal before any database preparation.
- Exactly 32,768 UTF-8 bytes accepted, with a multibyte fixture that distinguishes
  bytes from characters; overflowing bytes, excessive declared length, wrong
  content type, malformed JSON, and invalid UTF-8 refused without row writes.
- Two streamed chunks totaling 32,769 bytes rejected despite a false short
  Content-Length and cancellation that never settles. Rejection has a bounded
  test deadline and releases the reader lock.
- Prepare refuses supplied events, owner, grant, and an actually unknown output.
- Commit refuses extra/coerced envelopes and stale approval hashes.
- Current registration drift refuses recommit, while the real original receipt
  remains readable with exactly its original events, Document, Project and hash.
- The public project-intake grammar refuses a real mini-app plan and successfully
  commits its own ordinary empty-canvas shape.

Every rejected operation and retained receipt read checks SQLite's
`total_changes()` plus a complete schema/row snapshot. This is a no-write result
for the fixture's already established, consented Creator; it does not claim
that all native authentication bootstrap/profile paths are read-only. Counted
fetch, media and assets sentinels reject attempted calls, including swallowed
errors. The sentinels are installed before account bootstrap. No provider
transport, output generation, financial hold, real account, or live media is
used. The native source-import helper is reused; this is not a separately
qualified finite import allowlist or remote D1 integration test.

## Narrow registration seam

The current catalog is frozen. To exercise the commit-versus-receipt rule without
altering catalog files or constructing a fake retained plan, a Node loader hook
intercepts exactly the intake API module's import of `src/experiences/intake.ts`.
It reexports the actual module and delegates `registeredExperience` to the real
function. Only during the drift test, after native prepare and commit, that one
returned current release hash differs. Native request validation, compilation,
storage, retained-plan validation, authorization, SQL and original receipts
remain unchanged. A call counter confirms the commit consulted the seam once
and the historical receipt did not consult it. Hooks, the test state and the
original fetch descriptor are restored on teardown. This tests the actual API
comparison branch, not a real deployed catalog migration.

## Historical failures retained

The original guest-plan compatibility invocation remains at:

`/Users/westbrook/.codex/visualizations/2026/09/17/01a0acf8-4b13-75c0-b520-b444b077515e/guest-plan-custody-evidence/history/forma-guest-plan-intake-regression-20260917.log`

It reports fifteen failures: one `experience-intake-authority.test.mjs` setup
failure because its explicit reviewed root/manifest environment was omitted,
and fourteen old boundary cases stopping at the first unapproved extracted
dependency, `./intake-authority.ts`. None is reclassified as a product assertion
failure or relabeled passing. The obsolete suite is not edited or replayed.
Its two-output catalog and blanket Model3D refusal are not current requirements.

The authority test has separate historical R9 evidence for 17 passing cases;
the test bytes are unchanged, but two of its eleven production module hashes
have since changed. A future current run must use a freshly reviewed manifest.
The invalid invocation does not justify silently removing that requirement.

Native retained-draft, private-storage, atomic-intake and fresh-intake-join suites
already cover original custody, duplicate/lost-ack recovery, quotas and atomic
rollback. Their accepted evidence is reused. The accompanying current-task
`intake-legacy-coverage-map.md` records the requirement mapping and precise
historical qualification limits. No unrelated accepted suite or live journey
is repeated by this maintenance.

## Validation

Run only this new test with the existing Node runtime:

```sh
node --experimental-transform-types --test tests/experience-intake-http-boundary.test.mjs
node node_modules/eslint/bin/eslint.js tests/experience-intake-http-boundary.test.mjs
git diff --check
```

The initial seven-group run passed against reviewed integration base
`3f281b1dcd743c81429e7606de0d7cc4dd19231f`; its log remains in
`/private/tmp/forma-intake-http-boundary-evidence-20260917/first-run.log`.
That initial run used ASCII body padding. The final body fixture additionally
uses multibyte authored text. Final source hashes, focused verification,
independent review and the integrated guest-API qualification are recorded in
the adjacent evidence packet. Publication is controlled by the existing owner.
