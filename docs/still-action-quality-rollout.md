# Still action-quality rollout and outcome-study checklist

This is a release preparation checklist. The current task authorizes local
implementation and fictional verification only. Existing-database changes,
hosted activation, actual-data exports, paid provider runs, and real-user studies
require their applicable explicit authorization. No such activity follows merely
from completing this document. The user subsequently authorized committing and
publishing this slice; release evidence is recorded separately.

Use the [implementation and evaluation guide](still-action-quality.md),
[intake contract](still-action-quality-intake.md),
[migration guide](local-migrations.md), and [validation guide](validation.md).
Record evidence and remaining gaps against the exact release commit and policy;
do not turn a passing fictional case into a claim of user benefit.

## Schema and release preparation

- [ ] Record release commit, action policy, observation contract versions, client
  and Worker compatibility, test/replay receipt paths, fixture/input/question
  hashes, and the named release/review owners. Preserve the original fictional
  fixture and its fallback failure receipts alongside subsequent results.
- [ ] Include additive [0074_still_action_outcomes.sql](../drizzle/0074_still_action_outcomes.sql)
  with its unchanged SQL hash/journal entry. It creates opt-in preferences,
  decision receipts, observations, and goal references outside the creative event
  head. With the held-migration release policy,0074 remains source-only; the
  equivalent bootstrap creates these empty objects on the first auth-required
  request (before principal lookup). The release must qualify the exact
  source-journal extension without activating held Memory migrations. Confirm bootstrap and journaled schema equivalence in an isolated,
  fictional database, including rerun and rollback behavior.
- [ ] Confirm the current slice needs **no additional migration**: versioned
  `still-workflow-v1`, `still-outcome-v1`, and `still-quality-assessment-v1` payloads
  use the existing observation JSON table and `/api/still/action-observations`.
  If a later schema addition is required, create a new additive migration and
  journal/snapshot entry; qualify bootstrap equivalence and old/new application
  compatibility. Never edit 0074 after it has been qualified/applied to make a
  subsequent release fit.
- [ ] Before any authorized existing-database change, identify the exact database
  and its owner, coordinate the development server, and arrange the authorized
  backup/recovery procedure. Preview with
  `pnpm db:migrate:local --database <explicit-path>` and retain the disposition
  report; preview can take a write lock even though it rolls back. Review that
  exact plan before the separately authorized `--apply` action. Follow the Sites
  deployment boundary for hosted migration; a local receipt does not qualify it.
- [ ] Test version skew and observation-write failure without losing creative
  work or duplicating operations. Missing/expired telemetry remains unknown and
  cannot block ordinary creation, review, save, recovery, or permitted export.

## Observation, privacy, and release gates

- [ ] Opt-in remains off by default for each scope. Verify the consent epoch,
  owner/scope/permission checks, shorter policy expiry, and the 30-day maximum for
  receipts, observations, goal-derived assessments, caches, and review exports.
  A delayed assessment/correction must not renew an earlier episode's lifetime.
- [ ] Verify exact workflow/target revision and causal operation links, attempted
  versus confirmed transitions, duplicate/conflicting IDs, late delivery,
  interruption/reconciliation, current authorization and permission changes.
  Commit acknowledgment, completed job, browser retrieval, and explicit user
  acceptance must remain separate evidence classes.
- [ ] Verify opt-out, explicit erasure, source withdrawal, expiry without a new
  creative event, and cache invalidation. Do not retain revoked examples in a
  replay export merely because the export was previously reviewed. Any separately
  permitted aggregate retention must be declared before the study; the checklist
  does not grant an exception to the existing retention ceiling.
- [ ] Inspect the rendered review/recovery journey as well as payloads. Preserve
  More/Find action, required approval and permission gates, save/cancel, draft
  preservation, and original-operation recovery. Presentation/help/backtracking
  are diagnostics; they do not establish comprehension, abandonment, or regret.
- [ ] Confirm Jev's evidence boundary: the three new workflow/outcome/quality
  payload versions remain diagnostic/evaluation evidence. Existing bounded,
  authorized verified commits/failures/cancellations and active explicit
  corrections follow their existing retrieval rules. Changing which new evidence
  informs Jev requires a separately reviewed policy and replay contract.
- [ ] Complete types, scoped lint, registered source/runtime checks, then relevant
  reproducible browser checks with one bounded worker budget. Review inventory
  changes and generated manifest diffs where applicable. Record selected
  coverage, skipped/disabled modes, failures, and unverified areas separately;
  reuse matching receipts and coordinate the single `dist` writer.

## Shadow comparison and monitoring

- [ ] Freeze a compatible baseline and candidate policy. Compare identical
  authorized snapshots in a read-only shadow run, starting with fictional
  evidence. A provider-backed shadow run still needs its paid-call authorization.
  Do not execute shadow recommendations or expose a candidate by accident.
- [ ] Stratify agreement and omissions by toolbar view, workflow stage, evidence
  completeness, collaborator relationship, permission change, and recovery
  status. Keep unsupported palette/format/workflow/More replay explicit until
  their actual surface policies are implemented in the harness. Shadow agreement
  is diagnostic; unseen suggestions cannot establish user benefit.
- [ ] Predeclare monitoring owners, windows, thresholds, and response actions
  before exposure. Watch rejection/duplicate rates, unmatched causal references,
  occurrence-to-recording lag, unknown/censored outcomes, revision mismatches,
  opt-out/erasure completion, expiry/cache failures, decision latency, fallback,
  duplicate paid attempts, inaccessible actions, and required-control loss.
- [ ] Separate a missing telemetry receipt from a failed creative operation.
  Inspect a bounded authorized sample of failures and coverage changes. Report
  denominators and opt-in/availability bias; never use the selected-action subset
  as if it were randomly assigned.

## Predeclare a bounded outcome study before recruitment

The following is a protocol to finalize and authorize, not an active experiment.
Store the signed, versioned protocol before assignment. Do not choose effect
thresholds or exclusions after looking at results.

| Declaration | Required choice before launch |
| --- | --- |
| Question and population | Whether the exact candidate policy improves explicitly assessed success criteria for consenting creation/review workflows. State eligible roles/scopes, exclusions, and the target population; Viewer and recovery journeys may need separate strata/studies. |
| Unit and assignment | Stable workflow or user assignment made before actual exposure; justify contamination handling across surfaces/collaborators. Record assignment, exposure/non-exposure reasons, fallback, and known assignment probability. If comparison is observational, state that causal benefit is unestablished. |
| Baseline and candidate | Exact policy/model/contract versions, allowed surfaces, preserved review/recovery controls, and any differences in evidence. Keep local fallback available. |
| Primary endpoint | Explicit target-revision acceptance plus assessment against the user's predeclared success criteria at a natural review point. Specify a rubric/aggregation rule and what counts as a meaningful effect. Report missing assessments separately. |
| Timing | Proposed follow-up horizon: 7 days from workflow entry, with immediate review optional. Use a shorter horizon where policy requires it. The whole collection/analysis plan must fit each record's remaining retention and never exceed 30 days; staggered enrollment does not restart an episode's clock. |
| Sample and analysis | Predeclare required sample/precision, assignment-based analysis, treatment of crossovers and repeated actors/workflows, uncertainty interval, and sensitivity to missingness. Specify a holdout before policy tuning. If the available sample is smaller, report descriptive evidence only. |
| Incomplete outcomes | Still-open work is pending before the horizon and censored afterward; inaccessible or missing evidence is unknown; revoked observations contribute no quality judgment. Preserve delayed assessment/correction lineage only while authorized and unexpired. |
| Secondary outcomes | Successful resumption/recovery, satisfied hard constraints, avoidable rework, and time/cost to explicitly accepted work. Useful exploration, preserved options, or deciding not to act can succeed. Clicks and submissions are supporting diagnostics. |
| Guardrails and stopping | Predeclare tolerated rates and precision for duplicate operations/cost, ineligible/stale invitations, broken review/permission gates, recovery failure, accessibility failures, and explicit user-reported harm/regret. Stop immediately for confirmed authority/privacy violations or duplicate paid execution attributable to the change. Name the person who can pause/roll back. |
| Review and promotion | Review exact-version evidence, uncertainty, coverage gaps and adverse cases. Separate engineering release review, the three open product reviews, and explicit user acceptance. Declare what evidence is sufficient to promote, revise, or reject the candidate. |

An optional nonresponse is never “not accepted.” A commit or completed job alone
is never “accepted.” A later assessment about a changed target belongs to that
new revision rather than silently relabeling the original episode.

## Rollback and closeout

- [ ] Identify and rehearse the application/policy rollback in an isolated
  environment. Restore the qualified local/baseline selection behavior; disable
  candidate exposure and diagnostic collection through the release's reviewed
  mechanism. Existing opt-in controls remain available. Do not invent a feature
  switch or claim an operational kill switch without verifying it exists.
- [ ] Retain additive 0074 tables through application rollback unless a separately
  authorized migration says otherwise. Do not rewrite creative history, drop
  observations to hide a failure, resubmit uncertain operations, or extend
  retention to ease investigation. Preserve authorized failure receipts only
  within their remaining scope/expiry; continue erasure and expiry processing.
- [ ] Close the study at its predeclared horizon, apply authorized erasure/expiry
  to raw and derived records, and report late/missing/revoked evidence and
  uncertainty. Record exact versions and remaining open work in the guide,
  backlog, and independent progress report.

Use separate status fields in the release record:

| Status | Evidence needed |
| --- | --- |
| Engineering implemented | Reviewed source/API/schema slice; scope and limitations stated. |
| Locally verified | Matching synthetic/source/runtime/browser receipts with gaps disclosed. |
| Deployed | Separately authorized migration and hosted release receipts for the exact version. |
| Measured beneficial | Predeclared outcome analysis with adequate comparison, sample, uncertainty, and guardrails. |
| Accepted by users | Explicit review/acceptance of the relevant journey or result; tests and exposure do not substitute. |

This checklist advances release preparation only. The latter three statuses are
not established by local implementation, fictional replay, or this document.
