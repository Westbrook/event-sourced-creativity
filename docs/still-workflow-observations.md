# Still workflow and outcome observation contract

This implementation extends the preference-controlled endpoint
`POST /api/still/action-observations`. It uses the JSON body and unconstrained
`kind` column introduced by [migration 0074](../drizzle/0074_still_action_outcomes.sql).
These observation kinds require no new migration. The later
[goal/settings change](still-goal-settings-actions.md) adds migration0075 for a
durable account preference, with default-on saving and explicit opt-out. The
creation feature's existing draft/operation schema supplies retained receipts.
The [shared contract](../src/still/action-outcomes.ts) and
[server verification](../worker/still-action-outcomes-evidence.ts) are authoritative.

The existing action-context envelope remains `still-action-context-v1`. New
payloads have their own version strings so old consumers can ignore unknown
kinds. Observations remain outside creative history: they do not append events,
advance its head, grant permission, or substitute for creation review gates.

## Common envelope and authorization

Every write retains the existing `id`, exact `scope`, `decisionId`, `actionId`,
`surface`, and `source` fields. `source` is `toolbar`, `more`, `palette`, or
`direct`. An optional `parentId` identifies a causal predecessor. Direct context
receipts permit recording workflows without a suggested action; they are not
suggestion exposures. Every `actionId` must belong to the retained receipt's
candidate catalog. A new direct invocation or root workflow must enter within
the receipt's ten-minute context window; already linked work can continue later.

Current authentication, terms consent and resource access are checked before
both reads and writes, including duplicate replay. Canonical targets also recheck current resource custody,
including work first created from the root scope. An assessment follows its
retained draft's applied operation to that new target even when the assessment
was recorded before the commit and has no operational evidence field. Unavailable canonical targets
are withheld from reads with `coverage.withheld`; their current outcome remains
unknown. Historical receipt statuses are not recomputed. Collection follows a durable personal account preference, while data stays
scoped and every row is bound to its current recording epoch. A parent must
be live, in the same actor/scope/consent epoch and decision/action/source chain.
Missing parents return `409 parent_unavailable`; delivery can retry after the
parent arrives. Recording order is not substituted for causal order.

Identifiers are bounded machine identifiers, not free-form authored text. Each
request is limited to 16,000 characters; canonical event references are capped at
24, and live scope storage at 5,000 observations. Text, keystrokes, draft bodies,
passive attention, model prompts and provider prose are not observation fields.

## Workflow payload

`kind: "workflow"` carries `workflow.version: "still-workflow-v1"`:

| Field | Meaning |
| --- | --- |
| `instanceId` | Stable creation draft ID, reused across resume/reconciliation. |
| `stage` | `draft`, `ideas`, `documents`, `project`, `final-review`, `finalized`. |
| `transition` | `entered`, `resumed`, `interpreted`, `presented`, `approved`, `approval-invalidated`, `final-review`, `backtracked`, `help-opened`, `draft-preserved`, `draft-discarded`, `finalize`, `internal-failure`, `reconciled`. |
| `status` | `attempted`, `confirmed`, `blocked`, `failed`, `reconciled`. An attempt never implies confirmation. |
| `blocker` | Optional `unseen`, `incomplete`, `unapproved`, `stale-revision`, `permission`, `source-unavailable`, `operation-uncertain`, `internal`, `none`. `blocked` requires a substantive category. |
| `target` | `{kind,id,revision}`. Workflow kinds are `creation-draft`, `creation-node`, `creation-use`. Draft revision is the decimal `draftRevision`; node/use revision is its content/review hash. |
| `draftRevision` | Positive saved/local draft revision counter. |
| `operationId` | Optional exact retained creation operation reference; actor, draft, custody and expiry are checked. |
| `occurredAt` | Client-reported ISO occurrence time, distinct from server `recordedAt`. |

Example, with identifiers abbreviated for readability:

```json
{
  "id": "review-presented-1",
  "scope": {"projectId": "project", "documentId": "document"},
  "decisionId": "direct-receipt",
  "actionId": "compose",
  "surface": "creation-review",
  "source": "direct",
  "parentId": "creation-invocation",
  "kind": "workflow",
  "workflow": {
    "version": "still-workflow-v1",
    "instanceId": "draft",
    "stage": "ideas",
    "transition": "presented",
    "status": "confirmed",
    "target": {"kind": "creation-node", "id": "node", "revision": "content-hash"},
    "draftRevision": 3,
    "occurredAt": "2026-10-01T15:00:00.000Z"
  }
}
```

Workflow reports can precede persistence of a draft; these are explicitly
`interpretation: "diagnostic-client-report"`. Reported presentation/approval
records a UI transition, not comprehension or independent server approval.
The separate creation API remains authoritative. A confirmed `finalize` requires
an applied retained operation, matching draft revision and internally consistent
operation/preview/approval receipt. No-change navigation is not a new commit.

A server-verified `operationStatus` is a historical receipt snapshot. It does
not change a client-reported transition into a quality result. An interrupted
operation is reconciled against the same operation ID; observations must not
initiate another save or provider request. Backtracking, help and preservation
are explicit events, never inferred abandonment, confusion, regret or emotion.

## Outcome payload and evidence levels

`kind: "outcome"` carries `outcome.version: "still-outcome-v1"`, `outcomeId`,
positive `revision`, `type`, `status`, `target`, `occurredAt`, `horizonStartedAt`
and `horizonMs`. It can also carry `workflowInstanceId`, `operationId`, and
`supersedesId`. Canonical `eventIds` and `jobId` remain outer-envelope fields.

| Outcome type | Verification and limit |
| --- | --- |
| `acknowledged-commit` | An applied creation operation matches the exact draft ID plus its approval hash or saved revision; a job admission matches retained `request_json` document revision; or an export matches its exact export receipt target. Generic arbitrary event references cannot certify an unrelated target. This establishes an acknowledgement, not output quality. |
| `completed-job` | Exact actor/scoped live job, matching document ID and retained generation revision. `observed` requires canonical status `completed`. Admission, running, partial, failed and canceled statuses do not become completed outcomes. |
| `file-retrieved` | An exact verified export event binds the target. Artifact targets use `artifact_revision`; output targets use the exact `ObjectExported` event ID as the export-receipt revision because that event does not retain a content revision. Retrieval/handoff is still a client report; it cannot prove a saved file, use, or acceptance. |
| `user-acceptance` | Explicit user report linked to an earlier outcome/assessment with the same target. It is never inferred from job completion, download or tests. The creation review UI normally records this through the criteria assessment below. |

Target kinds are `creation-draft`, `creation-node`, `creation-use`, `document`,
`generation`, `artifact`, and `output`; only the verified combinations above
establish canonical effects. A declared `generation` target alone is not a job
receipt. Verified operational observations return
`interpretation: "verified-operation"`; explicit acceptance returns
`"explicit-user-report"`; file reports remain `"diagnostic-client-report"`.

Outcome status is `observed`, `pending`, `censored`, `unknown`, or `revoked`.
Pending means the declared result is still awaiting evidence. Censored means the
horizon elapsed without establishing it; it is not a failure. Unknown means
available evidence cannot settle it. Revoked withdraws a previous observation.
Missing observations remain unknown; no background process turns silence into
failure or acceptance. Retrieval outages and browser closure leave incomplete
coverage rather than manufacturing terminal reports.

The production job/export observer declares a 24-hour window from the original
acknowledgment. It uses existing authorized job reads and app updates; it adds no
polling or background service. A later app update may record censoring, while a
closed session remains pending or missing. Stable series IDs derive from the
canonical job/export receipt and outcome type. A missing row in the bounded
history does not authorize inventing its latest revision. Corrections wait for an
acknowledged predecessor; collisions with an unseen existing series remain
unavailable evidence rather than creating another series.

## Optional quality assessment

`kind: "assessment"` carries `assessment.version:
"still-quality-assessment-v1"`, `assessmentId`, positive `revision`, `target`,
`workflowInstanceId`, immutable remembered `goalId`, `criteria`, `acceptance`,
`occurredAt`, `horizonStartedAt`, `horizonMs`, and optional `operationId` and
`supersedesId`.

Each criterion is `{index,result}`, where index names one of the retained goal's
at most five stated criteria and result is `met`, `not-met`, or `unknown`.
Unanswered criteria stay absent/unknown. No goal text is duplicated into this
stream. `acceptance` is `accepted`, `needs-work`, `unknown`, or `revoked`; it is
independent from each criterion judgment. A revoked assessment has no criterion
ratings. There is no inferred acceptance default.

Initial assessments require a parent `final-review` workflow report with status
`confirmed` from the same instance. The goal must exist before that review and
the declared horizon. The target must match the exact retained draft version
named by that review: a draft counter, its approval hash, or that version's
node/use hash. Verification reads only that exact retained version; the server-issued
`reviewedDraftRevision` binds later corrections to it. An erased or unavailable
target is unavailable, not a guessed match. The same original
review can anchor a delayed assessment while its evidence is retained. A new
reviewed content revision uses a new assessment series. Autosaved review state
does not justify attaching an old content hash to a different review revision.

The quality controls are optional. A remembered goal supplies the success
criteria. A session-only goal is not silently persisted to support measurement.
Users may append corrections or withdraw their earlier report. A withdrawal
can still reference a prior live verified assessment after its draft content is
redacted; it does not require rereading erased text.

## Revisions, clocks, horizons and idempotence

The server adds `recordedAt` and `expiresAt`. Occurrence timestamps permit at
most one minute of future clock skew and must be within the 30-day ceiling;
recording before the active recording epoch is rejected. Workflow causal edges
cannot reverse known workflow occurrence times. A child can be recorded after
its parent even when both occurred before either was delivered.

An outcome/assessment series starts at revision 1 without `supersedesId`.
Corrections increment by exactly one and name the immediately preceding
observation ID. Target, goal/type, workflow/operation identity, horizon and
attribution remain fixed. Already bound canonical references cannot be switched.
A correction's occurrence cannot precede its predecessor. The SQL insertion
checks that no same-or-later revision exists, preventing concurrent forks under
different observation IDs. All prior records remain append-only until erasure
or expiry. Consumers must resolve the latest revision globally before grouping;
a withdrawn observation must not reappear through an older row.

An identical canonical payload replaying the same observation ID returns the
immutable original with `replayed: true` (HTTP 200). A changed identity returns
409. Concurrent identical submissions converge through insert-and-replay.
Unknown parents and revision conflicts return 409, and do not create partial
rows. A duplicate still needs live authorization and the current consent epoch;
re-enabling saving does not revive an old chain. Replays retain the historical receipt
snapshot instead of rewriting it when a job's status changes.

A horizon is positive and at most 30 days. `horizonStartedAt` is not later than
`occurredAt`; server `horizonEndsAt` records the declared end, and `late` means
occurrence followed that end. A late explicit result can correct a censored
series within retention. Censoring cannot be reported before the declared end.
Recording latency and late outcomes are different measurements.

Retention is the minimum of the current consent preference, delivery receipt,
causal parent, applicable deployment/organization policy, canonical source or
remembered goal expiry, and the original horizon-start ceiling. Corrections and
late delivery never reset that clock. The policy cap applies from occurrence or
horizon start as well as recording. A shorter policy can erase evidence before
a longer declared horizon ends; studies must predeclare a feasible horizon and
report that coverage limit. Expiry removes records; it does not preserve a new
unconsented summary or silently extend the current 30-day maximum.

## Decision use, privacy and verification boundary

All three new kinds are diagnostic/evaluation evidence. They are excluded from
`readStillActionContext(..., forDecision=true)`. Jev continues receiving only the
existing bounded acknowledged commits, failures/cancellations and applicable
explicit corrections. Impressions and new workflow/quality writes cannot trigger
recommendation loops through creative history. Existing opt-out/erasure and
privacy routes clear these rows together with receipts. Clearing a remembered
goal also deletes its linked quality assessments. These operations invalidate the
existing decision caches; scheduled expiry uses the same observation table.

Selected checks in [the runtime tests](../tests/still-action-outcomes.test.mjs)
and [real authorization tests](../tests/still-action-outcomes-authorization.test.mjs)
cover exact revisions, canonical references, foreign actors, permission changes,
causal and late delivery, duplication, series forks, interruption/reconciliation,
criteria/goal binding, missing evidence, opt-out, withdrawal and retention.
Client/controller and isolated browser checks verify the production emissions.
Passing those checks establishes the tested local behavior only. Deployment,
real-world attribution, measured benefit and product acceptance remain separate;
see the [rollout checklist](still-action-quality-rollout.md).
