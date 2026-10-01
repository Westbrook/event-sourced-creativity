# Still workflow and outcome evidence: local verification

This receipt covers the local continuation of ST-ACTIONS-001 on 2026-10-01.
Both `0451de43` and `2168fc05` are ancestors of the current `main` checkout.
The worktree also contains concurrent unrelated work; it has been preserved.
At this local verification checkpoint, the changes were uncommitted.
The user subsequently authorized commit and publication; see the later release
entry in the implementation guide for its separately recorded status. No existing database was changed, no
paid provider evaluation or actual-data export ran, and no hosted release or
real-user study was started.

See the [implementation guide](still-action-quality.md),
[event/API contract](still-workflow-observations.md),
[frozen replay evidence](still-action-quality-evaluation-v2.md),
[intake and open product reviews](still-action-quality-intake.md), and
[rollout checklist](still-action-quality-rollout.md).

## Qualified checks

| Check | Result and exact boundary |
| --- | --- |
| TypeScript and lint | `pnpm typecheck` and scoped ESLint passed for the changed production, Worker, script and test files. Full repository lint was not run. |
| Component/localization contracts | `pnpm cem`, `pnpm cem:check` and `pnpm i18n:check` passed. Both generated component manifests remained unchanged. The optional quality controls reuse existing primitives and native form semantics; English, French, Arabic and Japanese copy is included. |
| Validation inventory | Updated and checked the registry after adding the operation monitor, quality review, and workflow browser checks. Source/runtime checks remain in their registered lanes. |
| Focused source/runtime | **89 source + 39 runtime cases passed**, with zero failures, skips or cancellations. The runner confirmed matching beginning/end inputs. |
| Fictional replay | **288 policy/ablation comparisons** across unchanged v1, expanded development v2 and separate holdout v2. No provider calls. Residual fallback findings and unknown primary judgments remain in the receipts. |
| Existing Chromium browser journey | All **seven action-context scenarios passed**: optional/session goals, explicit feedback/erasure, final-only streaming, interrupted streaming, scope navigation, Viewer controls and startup recovery. |
| New workflow Chromium journey | **Passed** the production creation-to-finalization journey, including delayed quality corrections, exact receipts, opt-out and erasure. |
| Repository/document checks | Required commit ancestry, original v1 fixture hash, relative documentation links and whitespace checked. No build or shared `dist` mutation was needed for the source-based fixture. |

The stable selected-run receipt is
`outputs/validation/2026-10-01T14-45-54-625Z-3c6c5c0d/receipt.json`, with input and
final-input hash
`c34d39392828d8590df572e0bb6687b9142ec498a8e870dbd7372f003fe77971`.
It used Node 24.16.0 and two workers. The selected files were:

```text
tests/still-action-context-client.test.ts
tests/still-action-operation-evidence.test.ts
tests/still-creation-controller.test.mjs
tests/still-local-policy.test.mjs
tests/still-decision-quality.test.mjs
tests/still-quality-review.test.ts
tests/still.test.mjs
tests/still-action-outcomes.test.mjs
tests/still-action-outcomes-authorization.test.mjs
```

The source command selected the registered runtime dependencies as well. It
covers exact review/approval/operation/job/export references, append-only series,
causal ordering and duplicate delivery, late evidence, uncertainty and missing
history, interruption/reconciliation, opt-out/erasure, permission changes,
root-created target custody, goal deletion, retention and decision retrieval
exclusion. The client checks include stale opt-in responses, retry identity,
missing bounded predecessors and delayed quality corrections.

## Browser evidence and limits

Existing action-context browser receipt:
`outputs/still-actions-browser/2026-10-01T14-46-24.723Z/receipt.json`.
The workflow test uses a real browser, Vite forwarding, the production Worker,
and a disposable fictional SQLite fixture. It disables configured provider
credentials, guards browser traffic to its fixture origin and uses explicit
manual title completion. It does not change an existing account or database.

New workflow final receipt:
`outputs/still-actions-browser/2026-10-01T14-52-17.679Z/workflow/receipt.json`;
log: `outputs/still-actions/workflow-browser-focused-5.log`. Chromium
151.0.7922.34 completed this journey with 26 observation writes, all HTTP 201,
four explicit assessment revisions and no page errors or off-origin browser
requests. The test confirms presentation/help/backtracking, explicit approval,
delayed assessment after reload, correction/withdrawal lineage, and exact
operation/approval/revision binding at finalization. Feedback does not append
creative events or call apply; the later explicit content finalization does.
Opt-out and erasure then remove the scoped diagnostic evidence while preserving
the committed creative events. The desktop and 320-pixel screenshots were
visually inspected; the existing dialog scrolls within its viewport.

The final selected source/test byte hashes are recorded in
`outputs/still-actions/workflow-continuation-candidate.json`; candidate digest
`a2c58158f37848be2d5746aab4fc79bceb838bd1806e5a392f3b9b7794e78839`.
This fingerprints a local worktree slice, not a release artifact.

Reproduce the selected browser checks from the repository root with the pinned
Playwright dependency and its installed Chromium browser:

```sh
node --import tsx --test --test-concurrency=1 tests/browser/still-action-context.test.mjs tests/browser/still-action-workflow.test.mjs
```

Browser checks use a single owned ephemeral source server at a time, sharing the
same bounded worker budget. Desktop and 320-pixel layouts are exercised. Console
warnings about Lit development mode and update scheduling remain visible in the
logs. Firefox/WebKit, native zoom, assistive technology, actual-account/archive
acceptance and a full repository build/test gate were not run for this slice.
Passing browser checks does not establish that people understand the approval
flow or accept the resulting work.

## Preserved failures and replay evidence

- `outputs/validation/2026-10-01T14-34-31-000Z-15f01262/receipt.json` retains the
  initial recovery fixture failure: its acknowledged receipt lacked the now
  required exact approval hash. The fixture was corrected and a mismatched-hash
  rejection case was added.
- `outputs/validation/2026-10-01T14-38-30-635Z-bcd01cf3/receipt.json` retains a run
  whose selected assertions passed but whose inputs changed while running. It
  is not the qualifying stable receipt.
- `outputs/still-actions/workflow-browser.log` retains the first new browser
  failure: ambiguous fictional input selected the interpretation path without
  a configured provider. The fixture now explicitly chooses the existing
  **Treat as a title** control; production title classification is unchanged.
- `outputs/still-actions/workflow-browser-focused.log` and `-2.log` preserve
  loader and sandbox localhost setup failures. `-3.log` retains a wrong fixture
  label; `-4.log` retains a locator failure after backtracking, when Final review
  was correctly available in the real More menu. The final test uses that menu,
  compares JSON-persistable review state and prohibits provider-attempt POSTs
  while permitting ordinary job-history GETs. No production source was changed
  to resolve these fixture failures.
- The [evaluation record](still-action-quality-evaluation-v2.md) lists immutable
  fixture hashes and each final replay receipt/hash. Original fictional labels
  and baseline failure receipts were not rewritten. The exact frozen v1 file
  SHA256 remains
  `41ff3c00090cec47bff3c98b0d494040e2b27994b0cf14d31183e7be3155d721`.

Palette, format, workflow and More are not covered by toolbar replay: each needs
its actual surface policy before a replay claim. The production local fallback
does not interpret arbitrary free-text goals. Synthetic labels do not justify
threshold tuning or measured-benefit claims.

## Next authorized work

The [intake](still-action-quality-intake.md) requests authorized redacted decision
episodes plus an event dictionary and coverage information. No input has yet
been supplied for real-evidence analysis. Creation approval/finalization clarity,
Viewer journeys, and load-failure recovery remain three separately open product
reviews in the canonical Progress Report. Deployment, a predeclared study and
user acceptance remain separate from this local engineering verification.
