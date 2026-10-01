# Still action-quality evaluation

Still evaluates an action as an invitation that may help the user now. The target
is useful creative progress: coherent work, satisfied constraints, informed
review, successful recovery, or deliberately preserving an option. A click,
generation submission, long session, or accepted Next Best nomination does not
by itself establish that outcome.

The offline evaluator makes the selection policy inspectable and repeatable. It
compares local selection, scored selection, and selection with Next Best Action
on the same frozen evidence. It does not call Jev, modify application state,
change the production policy, submit jobs, or establish deployment or user
acceptance. The bundled fixture is fictional. Its labels describe expected
usefulness in designed scenarios, not measured behavior from Still users.

See the [original review and plans](still-jev-action-surfaces-review-2026-09-30.md),
[Still developer guide](../src/still/README.md), and
[validation workflow](validation.md) for the surrounding contracts.

## Implemented Still enhancement release

Policy `still-24`, branch `codex/still-action-outcomes`, based on `63bad27`.
The implementation adds:

- A versioned action metadata catalog describing selection effects, submission,
  cost class, reversibility, prerequisites, and observable outcomes.
- One answer validator for ranking, finder, presentation and nomination. Missing
  distributions allow degraded ordinary ranking; contradictions are unusable.
  A valid distribution with zero helpful-now probability cannot populate the
  suggested toolbar. Positive support and complete palette access are preserved.
- Final-only delivery and nomination invalidation after relevant later evidence
  or exclusion from the final menu. Incomplete constraint evidence blocks primary
  emphasis for affected generation and structural actions.
- Allowlisted semantic workflow state, explicit session goals, and optional
  remembered document/project goals with criteria and lifecycle controls.
- Per-section evidence coverage, text truncation counts, actor/causal provenance,
  active scoped preferences, canonical attention filtering and expiry-aware
  history/decision caches, including an unchanged event head.
- Separate opt-in semantic receipts and observations, exact-reference outcome
  verification, explicit feedback and erasure, with retention no longer than
  30 days or the applicable shorter policy. Private goals and their derivatives
  bypass durable decision caches. Active corrections have their own retrieval
  budget instead of competing with exposure traffic.
- Goal/focus/change/diversity retrieval, one request deadline and cancellation
  contract, numeric provider usage, stable assessment identities, and separately
  recorded first-interactive exposure latency. First evidence is diagnostic;
  the request duration and actual interactivity are separate measurements.
- Frozen offline replay and source/question hashes for comparing local, scored,
  and Next Best policies without provider calls.

The additive [migration](../drizzle/0074_still_action_outcomes.sql) and bootstrap
schema are equivalent in isolated SQLite tests. No existing application database
or deployed service was changed during this work. Existing local attention remains
observe-only; optional semantic recording has a visible scope and erasure control.

Verification receipts are retained under `outputs/still-actions/` and
`outputs/validation/`. The source-based browser fixture uses a fresh fictional
account and an owned ephemeral server, without rebuilding a shared `dist`.
The suite covers remembered/session goals, scoped feedback and erasure, final-only
streaming, interrupted-stream recovery, navigation, Viewer controls and startup
recovery at desktop and 320-pixel widths.

The final 12-case replay contains 108 policy/ablation comparisons. For the full
scored and Next Best policies, the supplied judgments produce no labeled unwanted
invitations; all 12 primary-appropriateness labels pass. This is **synthetic policy
verification**, not measured Jev calibration or user benefit. The local fallback
still offers three rubric-disfavored invitations across preservation, uncertain
payment and undo/review scenarios. Those baseline findings remain in the receipt;
local fallback does not semantically interpret free-text goals. They are retained
for subsequent outcome-based tuning, not hidden by relabeling the cases.

The prior replay is preserved as
`outputs/still-actions/quality-replay-baseline-before-zero-useful-gate.json`;
`quality-replay-final.json` captures the semantic zero-support correction.
No confidence thresholds, diversity weights or novelty weights were tuned to
force these fictional cases to pass. Live rollout, real-user benefit measurement,
and acceptance of existing open product feedback remain separate review steps.

## Run and retain a comparison

From the repository root, using the repository's supported Node version. The
explicit type-stripping flag also supports the minimum Node 22.13 runtime:

```sh
node --experimental-strip-types scripts/evaluate-still-actions.mjs --fixture tests/fixtures/still-action-quality-v1.json --out work/testing/still-quality/receipt.json
```

Omitting `--fixture` selects the bundled frozen fictional fixture. The default
comparison includes all three policies with the `full` ablation. Select policy
and evidence comparisons explicitly when investigating a change:

```sh
node --experimental-strip-types scripts/evaluate-still-actions.mjs --policies local,scored,next-best --ablations full,without-next-best,without-support --out work/testing/still-quality/receipt.json
```

`--captures PATH` accepts optional authorized, normalized JSON decisions. It is
not permission to export real user records or send captures to a provider. Use
the fixture's versioned shape as the contract and retain the original capture
separately when authorized. The evaluator derives candidate eligibility from each case’s supplied events,
position, and abilities using Still’s current policy. It needs assessment
evidence, applicable policy context, and reviewed labels; a raw
Decision Lab export or an incomplete metadata-only export must not be silently
treated as equivalent evidence. Never fill absent evidence with invented scores,
constraints, exposures, outcomes, or reviewer judgments.

Keep receipts under ignored `work/testing/`, alongside the exact inputs used for
a review. Freeze a new fixture version when materially changing case scope or
expected judgments; preserve previous fixtures and failure receipts. Record the
reason for changed labels, the reviewer, source revision, policy and rubric
versions, capture normalization method, and relevant privacy/retention scope.
A successful command validates and produces a receipt; it does not automatically
pass or fail the policy against a quality threshold. Review the case failures and
metrics against a predeclared acceptance criterion. This replay does not replace
the selected source, API, browser, or authorization checks.

## Frozen inputs and normalized captures

The contracts live in [decision-quality.ts](../src/still/decision-quality.ts).
A fixture declares `schemaVersion: 1`, `id`, `version`, `labelVersion`, `frozenAt`,
`provenance`, `cases`, `outcomes`, and `freezeSha256`. The frozen hash is SHA-256
of `JSON.stringify(fixtureWithoutFreezeSha256)`; changing a frozen value requires
a new reviewed fixture version. Fictional fixtures use
`provenance.kind: "fictional"`; authorized redacted fixtures require an
`authorizationReference`.

Each case supplies `id`, cohort `tags`, a versioned `goal` with quality `criteria`,
Still `position` and `abilities`, creative `events`, `evidence` coverage, supplied
`answers`, and independent `labels`. Labels distinguish `useful`, `neutral`, and
`unacceptable` action IDs, useful `complementaryGroups`, and primary choices.
`primary.abstention` is `required`, `allowed`, or `unexpected`; its `acceptable`
actions must also be useful. Every label set retains a `source` and `rationale`.
Actions without labels stay unjudged rather than becoming negative examples.

A capture set declares `schemaVersion: 1`, matching `fixtureId` and
`fixtureVersion`, `provenance: "authorized-redacted"`, an
`authorizationReference`, and normalized `cases`. Each captured case binds
`caseId`, `inputSha256`, `questionContractSha256`, `policy`, `model`, and `answers`.
An optional `providerRequestSha256` retains the identity of the original provider
request. Authorization references must be nonempty strings.

The input fingerprint is SHA-256 of `JSON.stringify(qualityInput(case))` and binds
the exact events, position, abilities, goal, evidence coverage, and optional
`finalEvidenceChanged` reason. The required question fingerprint is SHA-256 of
`JSON.stringify(qualityQuestionContract(case))`. That exported function returns
the replay policy, candidate metadata/descriptions, and questions. Receipts
include both fingerprints for every case and reject incompatible normalized
captures.

The question contract is not a reconstruction of the server exchange: authorized
hydration, compaction, selected evidence, and optional enrichment can differ.
Retain original exchanges separately under their authorized retention scope.
During normalization, verify that the historical questions and candidate meanings
match the replay contract; never stamp the current hash onto incompatible old
answers merely to satisfy the check. Preserve the original provider request hash
when available. This contract supplies existing assessments; it does not dispatch
an experiment or reconstruct answers for changed inputs.

Outcome observations use stable `outcomeId` plus increasing `revision`, `caseId`,
`actionId`, source, occurrence/recording times, and `horizonMs`. Status is
`observed`, `pending`, `censored`, or `revoked`. Optional success, quality, regret,
cost, duration, and independently declared `predictedSuccess` must remain absent
when unknown. Exposure identifies an invocation and whether assignment was
`randomized`, `observational`, or `direct`, with decision/impression IDs,
alternatives, position, and propensity where known. Feedback can retain its own
identity, kind, scope, expiry, and superseded assessment. Summaries use the latest
revision and retain missingness counts. These offline fields are an evaluation
contract, not a claim that every field is collected by Still today.

## What a case should establish

A useful evaluation case states the decision problem before assigning a preferred
answer. Include enough evidence to distinguish a helpful invitation from an
available but irrelevant action.

| Evidence | What reviewers should check |
| --- | --- |
| Surface and workflow | Route/surface, selected target and revision, current step, reserved controls, slot limit, safe return path, interaction lock |
| Explicit purpose | User-stated goal, audience, desired quality, active constraints, budget/time preferences; provenance and scope of each |
| Current work | Active inputs, excluded or locked content, unresolved validation, saved versus dirty state, required review, relevant output status |
| Action contract | Eligibility, target, launch versus commit effects, prerequisites, costs, reversibility, and known failure/recovery routes |
| Relevant history | Committed work and outcomes, interrupted attempts, actor and causal identity, scoped preferences, recent actual exposures |
| Coverage | Included, empty, omitted, expired, or unknown evidence; truncation and freshness; what was never assessed |
| Reviewed judgment | Helpful actions, unacceptable choices, acceptable alternatives, primary appropriateness, and reasons grounded in the case |

Keep scenario labels independent of the candidate policy's ranking. Reviewers
should be able to approve several useful actions, a helpful alternative set, or
no primary action. A narrowly scripted single “correct” action can penalize
legitimate exploration. Separate factual constraint violations from subjective
style preferences. Have a second reviewer adjudicate material disagreements
without discarding the original assessments.

Test different state and history conditions with explicit cases: absent goals,
stale goals, conflicting constraints, no history, incomplete history, a
collaborator's edit, an automated completion, undo, an unconfirmed operation,
and an already completed step. Do not assume a historical click expresses a
current goal or that lack of a click means rejection.

## Compare by surface and evidence coverage

The current harness replays only the action toolbar on `projects`, `documents`,
`ideas`, `document`, `results`, `artifact`, `generation`, and `rejection` views.
It rejects unknown views and palette, format, workflow, or More surface requests;
those surfaces have distinct production policies that this harness does not
simulate. The bundled twelve-case fixture currently covers only `projects`,
`document`, and `generation`. Other supported toolbar views remain untested by
that fixture. The broader cohort inventory below is a recommendation for further
verification, not a coverage claim.

Aggregate results can hide a policy that works on document editing while failing
in recovery. Report counts and metrics for each represented cohort:

- Home/resume and project/document listing.
- Whole-document work and a focused idea or selected object.
- Format discovery and an open configuration/review workflow.
- Results needing review, comparison, reuse, or acceptance.
- Failed or uncertain operations and deterministic recovery.
- More and the command palette, where discovery and alternatives are the task.

Within these cohorts, distinguish empty, sparse, and established work; explicit
versus unknown goals; new and returning users when authorized; complete versus
partial evidence; local fallback versus model evidence; and action availability
or permission restrictions. A cohort with zero cases is untested. A cohort too
small to support a conclusion should stay inconclusive rather than inheriting
an overall score.

Mandatory workflow and recovery controls are not optional recommendation slots.
Evaluate their presence and correctness separately, including when the model
abstains, times out, or supplies invalid evidence. Review the actual rendered
surface as well as the selected menu: density, More pagination, focus, interaction
freezing, and eligibility checks can change what the user sees.

## Interpret the metrics

The evaluator's metrics describe agreement with supplied scenario labels. Their
denominators and missing evidence matter as much as the headline numbers.

| Measure | Interpretation and limits |
| --- | --- |
| `usefulSetPrecision` and `labelCoverage` | Useful suggestions divided by judged suggestions, alongside the share of suggestions with labels; an empty or unjudged set does not prove a good recommendation. |
| `usefulRecall` and `retrievalRecall` | Useful actions selected and useful actions eligible for selection, respectively, divided by all labeled useful actions; read alongside the slot budget and acceptable alternatives. |
| `constraintViolations` | Selected actions labeled unacceptable under the case constraints; inspect each violation rather than averaging away a serious failure. |
| `groupDiversity` and `complementaryGroupRecall` | Distinct groups divided by selected actions, and labeled complementary groups covered by useful selections; variety is useful only when the alternatives themselves help. |
| `primaryAppropriate` and abstention | Whether prominent emphasis agrees with the reviewed primary/abstention judgment, including cases where none is justified; summaries report `primaryAppropriateness` and `abstentionRate`. |
| `unwantedInvitationProxy` | Unacceptable invitations divided by all selected invitations; a limited offline regret proxy, not observed regret or an estimate of the best counterfactual outcome. |
| Latency and cost | Descriptive measurements when the input supplies them; replay duration is not Jev or interactive UI latency. Missing usage or cost remains unknown. |

Precision/recall should not reward filling every slot, and diversity should not
reward unnecessary generation or irrelevant alternatives. Report the selected
IDs and reasons with the summary so reviewers can inspect concrete failures.
Retain the count of labeled versus unlabeled cases for every metric. Do not
convert missing labels, usage, duration, or cost into favorable zeros.

Usefulness calibration and outcome calibration are different studies. A Jev
usefulness distribution estimates the rubric rating for an invitation. The harness compares
helpful-or-better probability with independent usefulness labels using five
reliability bins and a Brier score in `usefulnessCalibration`. Small fictional
samples demonstrate calculation, not production calibration.
`usefulnessCalibrationBySource` separates fictional, expert, and user labels;
inspect these groups before interpreting an aggregate. Next Best choice probability and
choice margin concern relative preference among the supplied candidates; they
do not estimate probability of successful completion. Primary thresholds and
abstention need their own reviewed cases.

Outcome calibration asks whether a recommendation led to better work after the
user acted, under actual conditions. The receipt’s `successCalibration` compares only explicitly supplied
`predictedSuccess` values with observed, labeled success. It never substitutes a
usefulness score as a success forecast. A claim about benefit requires attributed
outcomes, an appropriate comparison, and enough observations over a defined horizon. A
well-calibrated usefulness rating cannot substitute for those measurements.
No fictional replay score establishes either production calibration or benefit
to Still users. `outcomesBySource` similarly separates fictional, expert, and
user observations after resolving each outcome’s latest revision globally, so a
withdrawal is not undone by grouping older revisions. Synthetic examples must not
count as real outcome evidence.

## Ablations have a limited causal meaning

The harness can compare `full`, `without-next-best`, and `without-support`
selection using frozen supplied assessments. `without-support` removes every
contextual answer except `use_*` and `next_best_action`, including negative
preservation/review signals, novelty, stage, per-idea judgments, and explicit
format-request gates. It is a broad contextual-judgment ablation, not merely
removal of positive score bonuses. These comparisons isolate how the local
policy uses those fields. They do not recreate what Jev would have said
if it had received different history, context, questions, or candidate sets.
Removing evidence after a response was produced does not undo that evidence's
influence on the response.

To study a question, retrieval rule, or provider prompt, prepare separately
versioned inputs and assessments for each condition. Freeze the case inventory,
expected judgments, policy, rubric, and comparison before execution. Provider
runs require their applicable authorization; the offline command grants none.
Change one factor at a time when practical, retain failed cases, and reserve a
holdout set so threshold tuning cannot simply memorize the fixture.

## Connect recommendations to actual quality

The durable measurement unit is a causal chain:

`decision → actual exposure → selection → invocation → committed operation → outcome → user assessment`

Keep observations separate from the creative event stream. An impression must
not change the content head or trigger another recommendation by itself. Record
actual exposure after controls render, with decision and policy identity, surface,
visible action/target/revision, emphasis, slot, and timing. Selection identifies
what was chosen; invocation identifies the attempted workflow; a commit receipt
identifies the actual operation. Record directly invoked actions too, since
users can find a better path through content, shortcuts, or the palette.

Outcomes should distinguish produced, reviewed, accepted, revised, reversed,
failed, cancelled, and unknown. Attach explicit success criteria where available:
constraints met, user acceptance, independent quality review, avoided duplicate
work, or successful recovery. A cancelled unnecessary operation can be a good
outcome. An undo may indicate regret, exploration, or normal comparison; retain
the event and ask only when clarification is useful.

Use a declared observation horizon. Still-open work is right-censored, not a
failure. Missing attribution, revoked access, deleted source content, and
unavailable receipts are unknown. A late review or acceptance appends new
evidence and updates the derived analysis without rewriting the earlier event
or assessment. Report late, censored, and unobserved cases separately. Restrict
retention and access for raw events, captures, summaries, and caches consistently.

Offer short, optional corrections such as “not useful now,” “already done,”
“different goal,” and “keep this choice available.” Preserve their scope,
provenance, validity, and revocation. Do not infer a lasting preference from
hover, dwell time, silence, one rejection, or a single clicked suggestion.
Human assessments should remain append-only, with later corrections linked to
the originals. Ask about achieved quality at a natural review point instead of
interrupting every action.

## Current viewer journeys and capability boundaries

“Viewer” here means an authenticated, authorized scope with neither
`project.author` nor `project.output.request`, or their personal author/generator
equivalents. Still derives these abilities from the fresh session; a role label,
a proposed action, or a supplied surface hint does not grant them. Shared-project
read access is resolved against the current project context and resource
allowlists. This inventory documents existing behavior and provides concrete
journeys for review; it does not close the open viewer-experience feedback.

| Viewer journey | Current entry points and behavior | Boundary to verify |
| --- | --- | --- |
| Find existing work | Projects, Documents, and project Ideas use directly interactive listings; route links and Back/Forward restore the selected view. | Only authorized projects and resources appear. A missing or revoked deep link must not silently open another document. |
| Read a document or idea | Open a document and select its idea; View document returns from the focused idea, with project/document navigation and Find action available where eligible. | Readiness, protected content, and retained source access remain authoritative; no edit, rename, lock, composition, reuse, or reference-write authority follows from reading. |
| Inspect results | View results lists saved outputs; open an authorized artifact or generation to inspect its available content/status and navigate back. Failed attempts can expose Inspect failure and View attempt status where applicable. | Inspection reads saved job evidence. It must not recover a provider operation, request a new result, or imply that inaccessible private inputs are available. |
| Download permitted work | Download is eligible after selecting an output/artifact. The handler refreshes scope, checks retained content/revision, submits a dedicated export event, rechecks the selected bytes, then retrieves/delivers the file. | Shared read permission permits an export-only event batch, but exact-resource, source-rights, retained-content, current-revision, and applicable independent-approval checks still apply. Personal read-only sessions do not receive the shared export-only exception. A toolbar invitation does not guarantee download eligibility. |
| Express a personal goal | Set next goal and Goal and suggestions describe the viewer’s desired next step and optional scoped feedback. | These actor-private preferences do not change shared creative records, elevate permission, or waive export review. |
| Discover permitted actions | More reuses ranked alternatives; Find action exposes the eligible catalog and routes inferred requests to supported views/reviews. | An empty authoring set is a valid outcome. Do not add create/edit/generate controls merely to fill the dock. |

The policy and execution sources are [action eligibility](../src/still/decisions.ts),
[session abilities and write guards](../src/still/client.ts),
[action dispatch and export](../src/still/app.ts),
[project context authorization](../worker/project-request-context.ts),
[shared export/review enforcement](../worker/project-access.ts), and
[job inspection authorization](../worker/document-jobs-api.ts).

The viewer review should exercise each journey with an authorized resource,
a resource outside the selected project, changed permission, expired content,
and a shared artifact whose exact revision is awaiting approval. Check useful
navigation and understandable empty states as well as forbidden writes. Record
whether the user can find and understand the work they came to inspect. That
requires an authorized viewer journey and user review; fictional toolbar scores
cannot settle the product question.

## Creation review and finalization: the actual steps

Still has separate record-creation and generated-output workflows. Review their
wording and outcomes separately. The current record-creation flow below applies
when the unified creation feature is enabled; the legacy named project/document
and idea forms remain a simpler explicit Save path.

| Record-creation stage | Current behavior | Evidence useful for diagnosing the open feedback |
| --- | --- | --- |
| Enter or resume a draft | New project/document/idea opens the capture surface. Draft changes are saved separately from committed creative records. Save may interpret the description into a retained graph; a title-only project/document can commit through its explicit Save path. | Entry kind, whether a draft was resumed, interpretation/manual path, and whether the user expected Save to finish are distinct facts. |
| Inspect retained items | Review Ideas, Documents, and Project stages as applicable; included source content must be available. Continue review records presentation of the current version after the content has been traversed. | Record exact item/revision presentation, unavailable source reasons, and navigation backtracking separately from approval. A scroll or presentation marker is not comprehension. |
| Approve versions | Approve marks the presented, complete current item/use. Approve all covers only already presented, complete versions. Edits change hashes and can require another review. | Distinguish approval attempts, successful approval, changed-version invalidation, and missing-information blockers. None of these alone commits the retained records. |
| Final review | The final screen reports retained record/use counts plus unseen, incomplete, and unapproved counts. Final commit requires all retained versions to be presented, complete, and approved. | Capture final-review entry, the exact blocker category, and return to prior stages; test whether the difference between approval and saving is understood. |
| Apply and confirm | Approve selected (or Approve selected use) validates the graph, freezes final approval, previews the operation, and applies that same operation. An interrupted response queries its operation receipt rather than starting a new save. A no-change result opens existing work. | Link confirmed creative event IDs to the operation; distinguish no-change, unconfirmed receipt, failed apply, and committed result. |
| Leave or recover | Back offers Keep draft and leave, Stay, and Discard draft. Organizer failure preserves input, with retry/manual completion/copy options where available. | Keeping a draft is an interruption, discarding is explicit, and cancelling an unnecessary path can be a good outcome. Do not combine them into abandonment without user evidence. |

The version-bound behavior lives in [creation-flow.ts](../src/still/creation-flow.ts)
and [creation-controller.ts](../src/still/creation-controller.ts). The creation
authority and server apply checks remain the execution boundary; Jev's toolbar
recommendation does not replace them.

For generated outputs, Choose output opens an unselected format chooser. A
format selection opens configuration; the normal Generate path validates the
reviewed source/settings and performs required readiness, cost, budget, safety,
and admission reviews. Scenes obtain a current cost preview before submission.
A confirmed job receipt leads to attempt status, followed by result inspection;
job admission or completion is not user acceptance. An uncertain request uses
its existing request key for reconciliation. The separately labeled New paid
attempt action can initiate a new paid request on its action click and retains
its existing eligibility and admission checks; it is not recovery of the
original operation. See [Still's generation handler](../src/still/app.ts),
[client submission/reconciliation](../src/still/client.ts), and
[action effect metadata](../src/still/action-metadata.ts).

## What instrumentation now establishes, and what remains unknown

Opt-in semantic observations now connect a shown recommendation and selected
action to an invocation, reported failure/cancellation, and acknowledged event
or job references. Unified creation completion connects its committed operation
to canonical event IDs. The server verifies reference ownership/scope and
existence; that verification does not prove the recommendation caused the work
or that the work was good. A generation receipt can describe admission while
the output is still pending. Exposure/selection are kept for attribution, while
bounded useful outcomes and active corrections can inform later decisions.

`SurfaceContext` supplies the semantic surface, coarse workflow step, dirty/pending
state, review blocker, selected parameters/targets, readiness hints, return view,
and interaction lock. It is a current bounded snapshot, not a durable record of
every creation review transition. Creation drafts already retain version-bound
presentation and approval state, but the new observation stream does not yet
provide a complete per-stage history of Continue review, Approve, Final review,
help opened, unchanged-receipt recovery, or why the user went back. Internal
subflow failures are not guaranteed to produce a top-level failure observation.
Do not claim a fully instrumented friction funnel from the current stream.

The next diagnostic addition should link a workflow instance and stage to
explicit transitions and blocker categories, with exact target/approval revisions
and operation IDs. Retain semantic timestamps and optional user-reported reasons;
keep draft text, keystrokes, passive attention, and assumed emotion out of this
measurement. Separate acknowledged commit, completed job, successful file
retrieval, user acceptance, and criteria-based quality assessment. In particular,
a verified export event precedes file delivery and cannot prove that the file
was successfully received.

Use the added explicit corrections and “Helped my work”/“Did not help my work”
feedback as scoped user reports. They are not complete independent quality
rubrics. A permissioned, bounded review of the actual creation journey should
compare the steps above with user expectations before changing labels or
collapsing review gates. No empirical friction reduction or quality improvement
has been established by these code changes or the fictional replay.

Three existing feedback items remain open for review: creation
approval/finalization clarity, the viewer experience, and load-failure recovery.
The current app already contains Retry loading Still and View projects recovery
controls; their presence is source evidence, not user acceptance of that journey.
Preserve the original feedback records and resolve them only with the appropriate
verification and user review. This inventory and telemetry foundation do not
mark any of those feedback items fixed.

## Roll out without confusing correlation and benefit

First run the fictional replay and focused regression checks. Then review
separately authorized captures against a frozen rubric. Run any proposed policy
in a read-only shadow comparison before exposing it, retaining the local policy
as a baseline. Shadow agreement is diagnostic; it is not evidence that users
benefited from an unseen suggestion.

For a bounded user-facing comparison, define assignment before exposure and
keep it stable at an appropriate user or workflow unit. Retain assignment,
actual exposure, non-exposure reasons, fallback, and cross-surface transitions.
Measure by assigned group as well as actual exposure. Users who choose an action
are a selected subset; comparing their later success with users who ignored it
confounds relevance, skill, task difficulty, and prior intent. Deterministic logs
without known assignment probabilities cannot establish counterfactual benefit.

Predeclare the quality objective, duration, cohorts, meaningful effect, stopping
rules, and guardrails. Monitor constraint violations, accidental repeat work,
recovery failures, reversals, abandonment, user-reported usefulness, accessibility,
and time/cost to an accepted outcome. Treat click-through as supporting evidence.
Check useful exploration and deliberate non-action as well as artifact delivery.
Keep dependable More, palette, review, save/cancel, and recovery access throughout.

Promote a change only after reviewing the exact tested version, coverage,
remaining uncertainty, and real outcome evidence required for that rollout.
Implementation complete, offline verified, deployed, measured helpful, and
accepted by users are separate statuses. Local replay alone advances the first
two only within its stated scope.
