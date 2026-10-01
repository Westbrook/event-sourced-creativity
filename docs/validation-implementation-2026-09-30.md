# Validation efficiency implementation

Implemented against `main` baseline `eff7c5ee08bc85a6f8107ec30c634c02e60c7dab`,
with published source `d1dddc3a9ce8f820ea81fa6e2c2cb09b346a41bc` reconciled into
main without replacing the reviewed candidate. This receipt supersedes the
initial partial implementation record. The [guide](validation.md),
[qualification record](validation-qualification.md) and [AGENTS rules](../AGENTS.md)
define the maintained workflow. Publication is established separately by the
native deployment receipt in the project report.

## Plan completion

| Package | Implementation and evidence |
| --- | --- |
| Inventory and ownership | Registry contains 1,512 test files: 553 source, 851 runtime, 38 artifact, 70 browser; 21 Playwright configs, 29 package commands, 51 checker/build entrypoints and 208 conditional-mode records. Every suite has a maintained command/resource/owner role. External CI is identified as the separate Still pilot, not misrepresented as this Site's release gate. |
| Scheduling and duplication | Types → lint → source → runtime → one build → artifact. Negative stages stop dependent work. Four registration-free helper families preserve original scenario declarations (56 + 1 + 6 + 4); guarded historical imports remain explicit. README, AGENTS, browser and toolbar guides agree. The obsolete paid cycle command stops before credentials/provider work. |
| Shared preparation and browsers | Input/output receipts and exclusive ownership protect a single build. Ordinary tests share a worker browser with fresh contexts; true zoom has an isolated profile. Toolbar uses one identified parent server with retained Vite cache. Compatible configs share one server; mismatches fail. Synthetic Memory/containment has an explicit portable loopback port; reviewed-download requires its authorized backend. |
| Parallelism and heavy setup | Two Node workers by default; one browser worker for shared-resource lanes. Exact-key immutable D1 compilation and bounded TypeScript fixture output are cached; databases, stores and module evaluation stay fresh. Compiler/SQL/key corruption, cancellation, writer conflicts and state-isolation probes pass. |
| Value and long-tail review | Cost reporter separates leaf assertions from parent summaries and records first negatives. Costliest families retain distinct authority/lifecycle failures. Brittle cost-prefix assertions now execute the actual expression. Stale shared API/controller/focus/Scene/Storyboard fixtures were repaired; full owned-source lint now passes, with exact vendor integrity checks. Historical and actual-data acceptance stays separate. |
| Portable gate and rollout | Fresh-checkout and retained-state selected gates verify identical coverage. Repeated cold/warm trials set measured budgets. Direct explicit Node/Playwright commands remain the diagnostic fallback. Exact source/archive preflight preserves the held-migration release policy; native deployment completes release separately. |

## Verification

Receipts and logs are retained under ignored `outputs/validation/`; isolated
checkout receipts are copied there for durable inspection. No private archive was
created, no paid provider was called, and the existing user preview was preserved.

- Expanded production/queue/all 18 TypeScript test files and full owned-source
  lint pass. Incremental TypeScript measured 68.2s on a cold program and 11.3s
  on the next coherent checkpoint; these are individual shared-machine samples.
- Fresh selected graph: 502/502 checks, no skips or cancellations. It includes
  source, actual SQLite/Worker transport, controller/API/focus, publication,
  Storyboard, Scene and release-preflight checks. The same 502 leaf identities and
  outcomes passed warm with types/lint reused. Source/runtime phases were
  39.1/134.5s fresh and 38.8/129.4s warm; fresh static work was 46.1/4.9s.
  See `fresh-warm-parity.json`. This comparison precedes the small reporting and
  hash-port, browser identity and font/clock corrections, which have focused
  regression and browser qualification runs.
- Final reporting/lifetime probes pass (21/21); the final workflow suite also
  passes all 15 cases, including exact project/download admission and pinned font
  transport boundaries. An intentionally injected compiler error
  does not announce a false negative when quoted in a passing TAP test. Actual
  compiler failure still surfaces early and blocks dependent stages.
- Toolbar: 98/98 across three engines, exactly one server start, 310.67s. Browser
  context isolation and native 200% zoom: 2/2. Ordinary-browser calibration:
  11/11 before and after; 17.7s → 8.5s at one worker (single samples).
- Shared API boundary: 34/34; generated moderation/freshness variants: 164/164
  with unique case titles. Scenario declaration parity and no newly failing
  extracted-fixture consumers were checked before adopting shared helpers.
- Build preparation includes CEM, localization, schema consistency, clean and Vite.
  Warm reuse and deliberate stale-output rejection were verified. No test runner
  silently rebuilds an artifact held by a browser or another writer.

## Measured cache and concurrency pilots

The fixed 25-leaf Node/SQLite workload ran twice at each setting, cold and warm.
All 12 trials passed with identical leaf membership/outcomes and stable input hash
(`benchmark-20261001T010409716589Z/receipt.json`).

| Node workers | Cold wall time | Warm wall time |
| --- | --- | --- |
| 1 | 30.31–31.96s | 9.98–10.43s |
| 2 | 19.15–19.47s | 8.73–9.04s |
| 4 | 19.89–20.21s | 9.42–9.70s |

Two workers meet the measured review targets of <25s cold and <12s warm without
increasing the shared-machine default. OS child high-water RSS was 74.7–86.0 MB;
this is **not** aggregate simultaneous process-tree memory. These samples establish
neither p95 nor a flake rate or whole-repository speedup.

A separate real Scene store setup pilot created three independent stores in each
mode. Uncached compilation took 1.698s over 108 calls; caching took 0.611s with
36 misses/72 hits, retaining 2.24 MB. Warm store setup fell from 744/702ms to
194/180ms. Each store and module evaluation remained independent. These single
paired samples justify caching immutable compiler output, not sharing live stores
or claiming every consumer has been timed.

## Explicit remaining exceptions

The broad source diagnostic reported 10,456 passes and 111 failures out of 10,567
Node records, no skips/cancellations/timeouts, in 358s; its first negative arrived
at 7.97s. Comparison with the original baseline matched 110 failing case names.
The remaining unchanged hash-lifetime test had a native crypto scheduling race
(the baseline instead failed its Video variant). Its finite hash port now returns
exact SHA-256 bytes deterministically; both variants pass. Existing native byte
verification remains exercised separately. No failing suite was excluded.

**The default full historical graph remains red.** The 110 matched failures are
preserved engineering debt under VAL-002, with an [exact case inventory](validation-baseline-failures.json). The baseline also failed one additional
presentation assertion. This change does not certify all historical product tests,
claim a green external CI run, or use retries to conceal failures. The remaining
historical assertions require their domain owners' separate repairs.

Actual account/archive/backend variants, GPU, physical-device and assistive-
technology acceptance remain explicit under QA-001. Synthetic contexts cannot
satisfy those claims. QA-002 accepted journeys are not reopened merely to collect
more performance samples. Published SQL retains the existing approved migration
manifest; held migrations stay excluded.

## Final browser and release gate

The complete synthetic selection is qualified: four unchanged reference-review
cases passed with pinned fonts, followed by 98/98 affected and remaining cases in
one owned-server batch (5.9 minutes, one worker, no retries/skips). This includes
all expiry, blur, apply, resource and containment variants. The first diagnostic
retains its external-font refusal; an intermediate invalid 60-second lease was
also rejected by the production 30-second maximum and corrected to 20 seconds.
Those failed attempts remain in the logs, not counted as passes.

Final isolated production build passed; the subsequent warm receipt contains
only `build: reused`. The eight selected built-route checks also passed. The
release retains 41 approved SQL migrations and the existing hosting manifest.
Archive/source verification and the native deployment result are retained in the
project report, separately from these local test receipts.

Final release checkout: `/private/tmp/forma-validation-release`. Selected logs
and JSON receipts are copied under `outputs/validation/release-*`; per-case traces
remain in the isolated checkout. The source/build environment was preserved for
inspection rather than torn down.
