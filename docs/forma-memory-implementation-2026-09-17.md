# Forma Memory implementation reconciliation

**Current status is in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).** The opening continuation and verification below preserve the historical September17/18 record.

Updated **2026-09-17**. Scope: `codex/forma-memory-foundation`, synchronized with
local `main` at `2face013e96a9796302ba9a5f44bef16706a1f79` by merge `c2ee60e`.
There is no configured Git remote in this checkout. The merge retained the newer
main versions of both conflicted Memory model files; its tree matched main.
It did not modify the main checkout or its unrelated proposal documents.

See the [Sites capability and implementation To Do](forma-memory-sites-capability-todo-2026-09-18.md)
for the current checkpoint/status/tooling continuation and separately tracked
external services. This does not close the semantic system or rollout gates.
The subsequent [native merge-preparation record](forma-memory-native-continuation-2026-09-18.md)
records exact locally verified changes without replacing historical production receipts.

## September 18 follow-up

[Completion and release status](forma-memory-release-2026-09-18.md) records the
production 435 / remote-main receipt, exact-schema benchmark fixes and dependency-ordered
implementation To Do list. Publishing the default-disabled source does not close
the remaining source table below.

[Native producer continuation](forma-memory-native-producers-2026-09-18.md) adds
bounded genuine Chat Studio completed-turn capture, personal exact artifact-view
receipts and exact schema/custody compatibility. Those are implementation
prerequisites, not semantic summaries or full consumption v2. The remaining table
below reflects those delivered boundaries; the verification section retains the
September 17 snapshot, with current evidence in the follow-up document.

## Current continuation

- Connect Chat Studio's explicit document-memory request to the existing native
  claim, candidate, publication and certified-read path. Keep ordinary chat and
  paid work separate, require current enrollment/authority, and recover the same
  request manually after uncertain acknowledgements.
- Render recalled text only in an owned, short-lived view. Never insert it into
  generic chat history/content or renew it through polling or a render. A manual
  authenticated read may acquire a fresh lease after current authority checks.
- Bind personal artifact-view evidence to the exact revision and content hash.
  Intent completion must apply those checks to artifact-derived object IDs too;
  ordinary generated-image object behavior remains compatible.
- Connect the existing extractive nightly source runner to the native Worker
  scheduled event. Keep its scheduling flag, actor allowlist and background
  enrollment gates intact; no schedule or flag is registered/enabled here.
- Reconcile the retained synthetic benchmark runner with native account and
  allowance ledgers. Keep the candidate default-disabled and qualification-bound;
  unknown spend must remain held. No provider calls, real enrollment or scheduler
  activation are part of this continuation.

The native benchmark routes and independent synthetic-payload cleanup are mounted in source; no optional benchmark schema is installed by a request. The two SQL files remain explicit activation candidates, not assigned or applied production migrations. See [the benchmark contract](forma-memory-benchmark-2026-09-17.md).

## Remaining source work

**Current source ledger:** [completion matrix](forma-memory-completion-matrix-2026-09-20.md).
The six native workstreams are implemented through `f0ae8a12`; final integrated
qualification is running. This supersedes the September17 foundation-only table:
semantic summaries, automatic scope profiles, native index intent retirement,
project nesting, artifact/block/resource consumption and UI consumers are no
longer merely detached foundations.

The [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md#capabilities-not-available-directly-through-the-inspected-sites-tools)
retains service-dependent code for the actual vector/embedding adapter, hybrid
index retrieval/deletion and genuine candidate baseline once the service/provider
contracts are fixed. It also tracks hosted delivery and migration qualification.
No live index, provider benchmark, remote deletion receipt, monthly cap or
production activation is claimed. Human review/rollout gates remain in the
[non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md).

## Historical September17 verification

Using Node 24.16.0 and the existing installed dependencies in an isolated worktree:

| Check | Result |
| --- | --- |
| Explicit Chat Studio backend + adjacent native publication/read tests | 25 passed |
| Memory client, actual Chat component, exact artifact/intent and ordinary job-store regressions | 161 passed |
| Actual Worker routing, scheduled privacy and scheduling-admission/activity integration | 3 passed |
| Benchmark corpus, provider contract, one-shot ledger, runner, projection and native accounting | 403 passed, including 25 native accounting/recovery cases |
| Full TypeScript | Passed after final delta |
| Production build and localization audit | Passed after final delta. Existing large-chunk warning retained. |
| Broad assistant runtime (pre-final-delta snapshot) | 951 tests: 941 passed, 10 failed. All 10 failures reproduce with identical normalized signatures on exact merge baseline `c2ee60e`. |
| Ordinary document-jobs + native-image-store suites | 37 tests: 35 passed, 2 failed. Both static source-assertion failures also reproduce on `c2ee60e`. |
| Touched-source lint | Only 13 pre-existing unnecessary-escape errors in `tests/assistant-runtime.test.mjs`; identical locations/messages on `c2ee60e`. All other linted changed source/tests passed. |

The isolated baseline comparison ran 966 tests with 954 passing and the same 12
failures. The broad failures are not claimed fixed; no new failure name or
normalized failure signature appeared in that comparison. Independent review
caught and verified corrections to the object-ID stale-review bypass, passive
Memory job execution/acknowledgement, recall prompts leaking into ordinary chat,
D1 prepared-statement wrapping, and immutable accounting replacement guards.

Tests use synthetic SQLite/native account fixtures, in-process fake providers,
and finite actual-component/Store transports. These are not real-browser,
assistive-technology, hosted-runtime or live-provider acceptance receipts.
