# Still action-quality replay, version 2

This is fictional, offline verification of the toolbar recommendation policy.
It does not measure Jev performance, user benefit, rendered control completeness,
deployment, or acceptance of the creation and Viewer journeys. The production
policy is `still-25`; the evaluator is `still-action-quality-v2`. No selection
thresholds or ranking weights were changed for these examples.

## Frozen evidence and separate holdout

The [original twelve cases](../tests/fixtures/still-action-quality-v1.json),
including their labels and contradictory/obsolete snapshots, remain unchanged.
The file SHA-256 is
`41ff3c00090cec47bff3c98b0d494040e2b27994b0cf14d31183e7be3155d721`;
its frozen content hash is
`d3dbadaf9725fdbfd25f258635630ad380dfc642295da5dc05723bb19b01a987`.

New fixtures record the original fixture's identity/hash as their parent:

| Release | Scope | Frozen content SHA-256 |
| --- | --- | --- |
| [Development 2.0.0](../tests/fixtures/still-action-quality-v2.json) | 16 cases; all eight supported toolbar views | `6611eb554e911bb1731b6f7b158efd01d9a0c4b97b9e057b9c637a903a8d9af0` |
| [Holdout 2.0.0](../tests/fixtures/still-action-quality-holdout-v2.json) | Four separate cases: excluded idea, read-only results, known non-submission, unjudged artifact alternatives | `d4dad215065b02f81a662a3efbbae101b5b76b0c0868b19fb99ee61d7f44f81d` |

The holdout is a separately selected fixture, never merged into development
averages. It was designed before its first replay; its results are for audit,
not retuning this release. These are agent-authored fictional judgments, without
independent human adjudication. After inspection, the holdout is consumed for
this release; a later tuning study needs a new unseen, independently reviewed
set. Several useful actions and several acceptable primaries are allowed. Cases
can explicitly require no primary. Unlisted actions remain unknown, including
an emphasized unjudged action unless abstention was explicitly required.

The development cases cover projects (1), documents (2), ideas (2), document (3),
results (2), artifact (2), generation (2), and rejection (2). Cross-cutting cases
include sparse or missing work, incomplete/expired history, collaboration and
late recording, removed permissions, interruption, compensation, review, and
recovery. Each cohort remains too small to support a benefit estimate.

`generationJob` optionally supplies a canonical fictional `DocumentJob`. Replay
derives its generation state using production `generationDecisionContext`,
instead of trusting a handwritten `canStartNew` flag. It is part of the input
hash and must match the selected document/job. Existing v1 input fingerprints
are unchanged. The CLI records partition, parent identity, counts including zero
coverage, per-tag summaries, and unsupported surfaces. `primaryJudged` and
`primaryUnknown` disclose the denominator behind primary appropriateness.
Offline outcomes also accept explicit `unknown` status, separately from pending,
censored, observed, and revoked; only observed outcomes contribute success or
quality measurements.

## The three retained fallback findings

| Finding | Investigation and change | Boundary |
| --- | --- | --- |
| Unlock while preserving a locked idea | A lock caused an automatic local Unlock invitation. Local fallback now offers source/project review; Unlock remains eligible for deliberate discovery or supported model judgment. | This uses explicit lock state, without interpreting the goal's prose. Project Ideas and focused document ideas are covered. |
| New paid attempt while submission is uncertain | The old fixture injected `canStartNew: true` alongside `provider_submission_uncertain`. Production `generationOutcome` already sets it false. Eligibility now also rejects explicit unknown-submission/failure-code contradictions. Generic duplicate-charge risk no longer produces an automatic local paid invitation; inspectable failures offer inspection. | The old replay did not establish a production duplicate purchase. Existing generation/review controls still own execution and permissions. New cases derive state from canonical fictional jobs. |
| Create after undo/review | `completed:edit-block` survived newly delivered source changes. Still's refresh can receive another app's compensation or a collaborator edit while this marker remains. Client merging now invalidates completion continuity for newly delivered current-source/result mutations, including shared blocks, relations, and partial-history completion. | Duplicate delivery, unrelated edits and passive opens preserve the marker; own acknowledged writes retire older continuity before the caller records the new completion. Format choices remain. The old frozen snapshot still explicitly supplies the obsolete marker and is not silently repaired by replay. |

The client regression tests exercise canonical compensation, shared-source
changes, late delivery, duplicate delivery, partial history, and acknowledged
writes. Clearing a stale completion is not an inference of regret or a permanent
preference against editing or generation. Complete action discovery remains.

Local fallback still does not interpret arbitrary goals, review intent, or
success criteria. A current saved result alone cannot establish that someone
wants to review it rather than request another output. Future semantics should
use an explicit scoped review purpose bound to target and revision, with a
recorded expiry/invalidation transition, instead of keyword rules or click
inferences. Such a signal would affect recommendations, never waive required
review or authorize a submission.

## Surfaces outside this replay

| Surface | Actual production contract required for replay |
| --- | --- |
| Palette | [finder.ts](../src/still/finder.ts) `paletteActions` and [app.ts](../src/still/app.ts) `refreshPalette`: query, complete catalog, utilities, passed-over ordering, and opening versus execution. |
| Format chooser | [decisions.ts](../src/still/decisions.ts) `rankAllFormats`, [local-policy.ts](../src/still/local-policy.ts) `localFormatRules`, and `renderGenerationDock`: authored preferences, all formats, reserved Back/Other outputs, and separate submission. |
| Workflow | [workflow-toolbar.ts](../src/still/workflow-toolbar.ts) plus creation/context/use-in flow commands: stage/version review gates, Save/Check save, Back, preserve/discard, and reconciliation. |
| More | `nextToolbarActions` and `renderDock`: already visible IDs, remaining slots, Back/Find action, secondary emphasis, and generation-specific overflow. |
| Rendered toolbar and recovery | `renderDock`, `renderGenerationStatusDock`, and [toolbar-fit.ts](../src/still/toolbar-fit.ts): density, document return, paging, utility reservation, interaction locks, and startup/route/recovery replacement. |

The evaluator continues rejecting palette, formats, workflow, and More surface
requests. It never labels generic toolbar results as those surfaces. Browser
and source tests must separately establish actual controls and workflow gates.

## Retained receipts and reproduction

Original ignored receipts remain intact under `outputs/still-actions/`:

| Receipt | File SHA-256 |
| --- | --- |
| `quality-replay-baseline-before-zero-useful-gate.json` | `76d0e00101f4773cf46b1d58c866ea1c2d9210ff12301ec00979d6cdcc6e3d43` |
| `quality-replay-final.json` | `81d60ae641ae08120b0e9028b360e0afd77041c4274ec767dad7f9d479d094b9` |
| `quality-replay-v1-before-workflow-evidence.json` | `a1f9991f50372f6ed641cf030ab92af024f88c32715e210e90246677d9a9e3d5` |

Each original local/full receipt retains the three unacceptable invitations:
Unlock, New paid attempt, and Create. Receipts also preserve exact source and
question hashes. Ignored output files may be absent from another checkout;
these identities do not substitute for possessing the original evidence.

The completed October 1 replay produced 288 comparisons across all three
fixtures, three policies and three ablations. The following are `full` results;
the ablation rows remain in each receipt. Scored and Next Best mean selection
from supplied fictional scores, not new provider answers.

| Fixture | Comparisons, including ablations | Local labeled violations | Scored / Next Best labeled violations | Unjudged primary emphasis |
| --- | ---: | ---: | ---: | --- |
| Original v1 | 108 | 1 | 0 / 0 | None |
| Development v2 | 144 | 1 | 0 / 0 | None |
| Holdout v2 | 36 | 0 | 0 / 0 | One each for scored and Next Best; excluded from appropriateness denominator |

The retained v1 violation is Create in the deliberately unchanged stale undo
snapshot. The v2 violation is Create on Results when the free-text goal asks to
review first. The canonical source contains no explicit revision-bound review
purpose for local fallback, so that finding remains; the future semantic signal
above is a proposal, not an implemented or inferred user preference. The holdout
artifact case leaves Download unjudged, including its primary emphasis. No
fixture labels or policy thresholds were changed after inspecting these results.

These first v2 receipts share source-closure SHA-256
`c3de72f4912831628a27bb1b499d0f069fb3265ffc26c5182301e1bafd348e9e`:

| New receipt | File SHA-256 |
| --- | --- |
| `quality-replay-v1-after-workflow-evidence.json` | `92aa1d326aaaddec8140e47ed913e887181be2187fbe5788463340bd56e858cd` |
| `quality-replay-v2-development.json` | `d33d149d5b1eeee98793cb28af1e49a54888a2d7ed36335b72a42c4f63bf7afa` |
| `quality-replay-v2-holdout.json` | `5637b481720bb13e8056898ae858e6b5112018ef1ee6ec585c285750f8585630` |

Run each fixture separately with the supported repository Node runtime. Use a
fresh receipt name on later reruns; preserve previous results. The first v2
receipts above precede the additive explicit-unknown outcome summary field and
other workflow-source changes; a final integration rerun should retain its own
source hashes.

```sh
node --experimental-strip-types scripts/evaluate-still-actions.mjs --fixture tests/fixtures/still-action-quality-v1.json --ablations full,without-next-best,without-support --out outputs/still-actions/quality-replay-v1-after-workflow-evidence-verified.json
node --experimental-strip-types scripts/evaluate-still-actions.mjs --fixture tests/fixtures/still-action-quality-v2.json --ablations full,without-next-best,without-support --out outputs/still-actions/quality-replay-v2-development-verified.json
node --experimental-strip-types scripts/evaluate-still-actions.mjs --fixture tests/fixtures/still-action-quality-holdout-v2.json --ablations full,without-next-best,without-support --out outputs/still-actions/quality-replay-v2-holdout-verified.json
```

Predeclared engineering checks: frozen hashes match; every selection is eligible;
permission/explicit uncertainty gates hold; changed-source continuity is cleared;
unknown judgments remain unknown; unsupported surfaces are disclosed; original
failures remain inspectable. Rubric disagreement is retained rather than used as
a blanket pass/fail threshold. No provider runs, actual-data fixtures, or study
assignment is authorized by these commands.

Focused checks after types and lint:

```sh
pnpm test:source tests/still-local-policy.test.mjs tests/still-decision-quality.test.mjs tests/still.test.mjs --workers=2
```

Update/check the validation registry after these test edits. Passing these checks
does not establish the historical full suite is green or prove user acceptance.

## Final local replay receipts

After the explicit unknown-outcome support and focused checks, the final replay
used source hash `ce48f04acecc23456f2aa16817e8d9d2c4e903dd5056f2cc8a266fd76c0a6d83`.
The earlier receipts remain unchanged. All 288 comparisons ran without providers.

| Receipt in `outputs/still-actions/` | SHA-256 |
| --- | --- |
| `quality-replay-v1-after-workflow-evidence-verified.json` | `2cf9f87e81a32668aba8ab2ffa4e7557b38eb9e0fb90077993d8a9eae3d50f68` |
| `quality-replay-v2-development-verified.json` | `25b529802764c7a48a74698d3edb612031b91b0851421a68b4f3cf51979d698a` |
| `quality-replay-v2-holdout-verified.json` | `4984eaed7b0c839b443460c0b9c6055926faea99bc34a1d7501cf87ef16dbc88` |

The retained local/full findings remain one obsolete completion-marker snapshot
in v1 and one text-only review-intent limitation in development v2. Full scored
and Next Best policies have no labeled violations in these cases. The holdout
has no labeled violations, with one unjudged primary for each scored policy.
These are fictional expectations; absent judgments are unknown, and no result
establishes live Jev calibration, causal benefit, or human acceptance.
