# E3 — remaining E2/H baseline verification

22 September 2026. Local implementation and mocked/offline verification only, on `882729f176a2f66ec7e10aeb90765ab89d3f6870`. Reused the clean E worktree `/private/tmp/forma-e-cross-media-outcomes`, fast-forwarding its existing branch. Actual main was reread before editing and at handoff. H2/516, E2/H/517 and H3/518 are preserved; no completed release repeated. H3's optional schema remains uninstalled, with no product import, actual source/direction still absent in the retained H3 evidence, C synthetic and F2 false/null.

## Cause classification and exact query

All three requested tests failed on unchanged main: **0/3**. The native Scene diagnostic with the strict compiler disabled passed **1/1**, which did not qualify the strict path.

**Scene: production SQL violates the documented target contract; the stale historical exception exposes it.** Both tests reach `reduceSceneVersionedHistory` in `worker/scene-versioned-history-read.ts`. Its metadata page query serializes 27 metadata fields plus `metadata_valid` with one 56-argument `json_object`. This is not a broken strict compiler. The earlier statement also had 56 arguments, but different bytes:

| SQL identity | SHA-256 | UTF-8 bytes | Maximum JSON function arguments |
| --- | --- | ---: | ---: |
| [Historically qualified](evidence/generation-e3/historical-query.sql) | `87984dc31fc80df29511e79e97c2d1f59ce7e1c5324781951a3cb486f96d1a41` | 7,514 | 56 |
| [Current main before repair](evidence/generation-e3/baseline-query.sql) | `4d5688aa5e03bbc95c4ccceebb16ba43d9db07f1e8d052ad2527f896a4331c3e` | 7,548 | 56 |
| [Repaired query](evidence/generation-e3/repaired-query.sql) | `e387ca665421447bd5d169880687419d7b176348f1c7beec4dfedda7740b8fc8` | 7,585 | 32 (`json_object`); 25 (`json_insert`) |

The historical bytes were reconstructed from the earlier source's `textFields` conjunction and matched the pinned hash exactly. Current `sceneHistoryMetadataSelect` balances the same predicates to avoid a deep expression tree, adding 34 bytes. That required depth repair is preserved. Equal argument count does not extend the historical workerd qualification to the changed SQL.

Primary documentation checked on 22 September: [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/) specifies 32 function arguments, 100 parameters and 100,000 SQL bytes, per statement including within batches. [SQLite limits](https://www.sqlite.org/limits.html) explains configurable limits and the 1,000 default from SQLite 3.48.0. Here Node v24.16.0 uses SQLite3.53.0 with functionargs1000, depth1000, parameters32766 and SQL1GB; the Python strict compiler uses SQLite3.53.3, also defaulting to args1000 before explicitly lowering limits. Neither default is D1 qualification. The deployed target contract is D1 binding `DB` in `.openai/hosting.json`. Historical local workerd acceptance of 32/34/56 controls remains a documented/runtime discrepancy, not evidence of current deployed failure. **No current deployed-engine probe or production outage is claimed.** The repair removes reliance on that undocumented allowance.

**Presentation: fixture/schema dependency omission.** `settleLegacyPresentationReservations` reads `budget_hold_dispositions`; this disposable HTTP fixture only bootstrapped runtime schema and omitted the existing administrative schema. It now loads `db/operations/budget-hold-dispositions.sql`, as adjacent receipt tests already do. No production presentation behavior or migration was changed or installed.

## Focused repair and invariants

The Scene reader creates the first 16 key/value pairs with `json_object`, then inserts disjoint remaining fields in groups of at most15. `json_insert` preserves explicit null values and insertion order; a merge patch would drop null fields. This alters only the expression used to measure metadata page bytes. Source relations, metadata predicates, hydration, payload equality, transaction/page guards, deadlines, private retention, and budget accounting are untouched.

The regression executes real owner-history pages with nulls, empty strings, Unicode, escapes and dense metadata forcing the byte cutoff before the256-row limit. It compares the emitted JSON byte-for-byte and the complete ordered result pages against the old serializer. Its strict run fails on original source and passes on repaired source. Existing project-membership, mutation/restore, final empty-page, missing-guard and capacity tests pass.

Strict helpers keep depth100, functionargs32, compoundSELECT5, bindings100 and SQL100k. The historical hash remains unchanged, but its verification is conditional on actual use; both current positive/replay journeys explicitly demand **zero exceptions**. No compiler bypass, higher blanket limit, changed hash, recaptured authorization, replacement purchase or financial relaxation was introduced.

Presentation retains all substantive assertions: one original provider request, failed artifact persistence, retained nine-slide candidate under the flexible admitted range, changed policy rejected409, original policy restored and recovered, terminal replay, exactly one completion and zero replacement requests. Earlier `nativeStoryboard` and `outputJobIsDurable` extraction repairs remain unchanged and pass with the required `FORMA_SOURCE_ROOT` environment.

## Verification and remaining failures

Exact file sets, source hashes, commands and named failures are in [verification.json](evidence/generation-e3/verification.json).

- Assigned baseline before repair: **0/3**, all three expected failures.
- New strict serialization regression on original source: **0/1**, `too many arguments on function json_object`.
- Focused assigned regressions plus serialization check after repair: **4/4**.
- Final selected18-file suite: **500/500**, including native Scene206 SQL shapes and connected driver252 SQL shapes, both with zero exceptions. Driver maximum bindings59; one synthetic provider call; replay makes no replacement. This is mocked execution with strict SQLite compilation, not deployed D1 execution.
- Preserved extraction suites with the required source-root environment: **14/14** (subset of the final500).
- Diagnostic native Scene before and after: **1/1 each**, compiler disabled, separately labeled and not added to the strict count.
- Full TypeScript, changed-file ESLint, diff check, localization/schema generation checks and production build pass. Existing large-chunk warning remains. Build is local only.

The broader initial21-file sweep is retained as **598/660, 62 failures**, not a passed baseline. One is an invocation error (`FORMA_SOURCE_ROOT` missing), corrected by the14/14 run above. **61 other failures remain** outside the assigned three:

| Owner / file | Remaining result | Baseline control and next action |
| --- | --- | --- |
| E recovery / `scene-policy-stop-recovery.test.mjs` | 58 assertions fail, including expected versus observed receipt/call counts | All58 reproduce with the original production reader restored; classify original receipt projection versus stale fixture expectations in a separately bounded continuation. No accounting assertions weakened here. |
| E UI fixture / `scene-composer-recovery.test.mjs` | One suite import fails: `lit/directives/live.js` from a data URL | Same failure with original reader; repair the extraction/import fixture independently. No UI product edit made. |
| E bundled recovery / `document-reservation-recovery.test.mjs` | Two tests fail with `execution_interrupted`: planner-only paid draft reuse and submitted video-scene resume | Both fail after fresh builds of original and repaired production source. They are not the Scene screenplay query failure. Investigate retained original planner/provider recovery independently; do not buy replacements. |

The original-source control for the policy/UI files is40/99 pass,59 fail. The independently rebuilt original-source bundled control is0/2. Final500 excludes those three explicitly named files; it does not supersede the broader failures. Full repository testing was not performed. These additional observations are handed off without broadening product changes.

## Handoff and scope

E owns this patch and the [updated transfer ledger](generation-cross-media-transfer-e2.md); H3/H4 continuation owner was notified of scope, exact query identity and results. No shared host or OpenAI/Scene provider adapter was edited. No inference, live key, paid trial, publication, support message, infrastructure provisioning, schema installation or runtime activation occurred. Memory, Replay, original purchases, no-replacement recovery, production routing, private authorization and retention remain unchanged. Historical evidence is preserved, not resealed.

Narration exactness, slide layout, Scene screenplay fidelity, video continuity/audio sync and3D geometry/material quality remain separate unmeasured studies. This Scene-specific SQL defect does not establish a shared direct-image contract defect, so E3 is not a prerequisite for the first image operation. Any later integration remains subject to the owning task's actual scope; this task authorizes no release.
