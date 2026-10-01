# Still action quality continuation prompt

Copy the prompt below into a new task against the Still repository. The completed
foundation is commit `0451de43` (policy `still-24`); this handoff accompanies its
integration into local `main`. Deployment, applying migration `0074` to existing
databases, and empirical user-benefit measurement remain separate work.

## Kickoff prompt

Continue Still's action-quality work in `/Users/westbrook/Documents/repos/codex`.
Start from current `main`, confirm that `0451de43` is an ancestor, and inspect the
actual checkout, concurrent changes, and owned environments before editing.
Preserve unrelated work. Read:

- [Repository instructions](../AGENTS.md).
- [Current implementation and evaluation guide](still-action-quality.md).
- [Original review and two plans](still-jev-action-surfaces-review-2026-09-30.md).
- [Still developer guide](../src/still/README.md).
- [Central backlog](backlog.md), especially `ST-ACTIONS-001`.
- [Independent progress report locator](../.progress-report/project.json).

Reuse the existing progress report. Read its canonical `/api/state`, the
`actionSurfaceImplementation` and `actionSurfaceCommit` handoffs, and unresolved
feedback. Reconcile historical proposals against current code. The completed
foundation already includes answer validation, final-only suggestions, coherent
Next Best Action, explicit goals, corrections, scoped attribution and privacy,
bounded history/retrieval, request budgets, and an offline evaluator. Build on it.

**Primary objective:** complete the missing workflow and outcome evidence so
Still can diagnose friction and evaluate whether suggestions help users produce
better work. Keep this task focused on that evidence and its verification.

### 1. Complete semantic workflow observations

Begin with the creation review/finalization journey. Add an opt-in, versioned
contract with workflow-instance ID, stage, explicit transition, blocker category,
target/revision, canonical operation/job references, occurrence time, and recording
time. Cover review presentation, version approval/invalidation, final review,
backtracking, help, draft preservation/discard, internal failures, and interrupted
operation reconciliation. Distinguish attempted transitions from confirmed ones.

Preserve causal links, idempotency, ordering/late delivery, current authorization,
and exact receipt verification. Keep observations outside the creative event head
and avoid recommendation loops. Do not infer understanding, emotion, abandonment,
or regret from navigation, silence, passive attention, or an undo.

### 2. Connect outcomes and explicit quality assessments

Distinguish acknowledged commit, completed job, file retrieval, and explicit user
acceptance. Where practical, collect brief optional, revision-linked assessments
at natural review points against the user's stated criteria. A browser download
handoff does not prove that the person received or used the file.

Support delayed assessments and append-only corrections, with pending, censored,
unknown, and revoked outcomes. Declare observation horizons. Preserve scope,
opt-in, retention ceilings, erasure, and cache invalidation. Current observation
retention is at most 30 days, possibly shorter under policy; do not extend it
implicitly to support a longer study. Specify which bounded, authorized facts
inform later Jev requests and which remain diagnostic/evaluation evidence.

### 3. Expand evaluation and inspect fallback findings

Preserve the original twelve fictional cases, labels, hashes, and failure receipts.
Add versioned cases covering the other supported toolbar views and sparse,
incomplete, stale, collaborative, permission-restricted, interrupted, review,
and recovery conditions. Permit multiple useful actions or no primary action;
unjudged actions remain unknown. Keep a holdout set separate from policy tuning.

The current harness simulates toolbar policies only. Palette, format, workflow,
and More need their actual production surface contracts before replay can claim
coverage; explicitly inventory any remaining unsupported surfaces.

Investigate the three retained local-fallback findings: unlocking during
preservation, a new paid attempt during uncertain submission, and creation during
undo/review. Fix demonstrated state or eligibility defects with focused tests.
If a finding requires interpreting free-text intent, document the limitation and
design an explicit semantic signal rather than inventing keyword heuristics or
tuning thresholds to the fictional labels. Preserve complete action discovery
and mandatory review/recovery controls.

### 4. Prepare real evidence and preserve product review boundaries

Prepare a concise intake template and normalization contract for authorized,
redacted decision episodes. Request goals/criteria, hard constraints versus scoped
preferences, screen/step/target revision, suggestions shown, actual choice,
acceptable alternatives, immediate result, later assessment/reason, and unknowns.
For existing event exports, request a data dictionary, occurrence/recording times,
stable join identifiers, actor relationship, causal/undo links, revisions, and
coverage gaps. Start with representative successes and difficult cases; do not
treat a small convenience sample as measured benefit. Manual examples are
reviewed evidence, not automatically ingested training data. Continue synthetic
local work while awaiting any required real-data authorization or inputs.

Keep creation approval/finalization clarity, Viewer journeys, and load-failure
recovery as separate open product review items. Inspect the documented current
journeys, record demonstrated defects, and propose concrete changes where product
choices remain unresolved. Existing Retry/View projects controls have already
been verified locally. Do not infer user acceptance or weaken review/permission
gates to improve a funnel metric.

### Verification and delivery

Follow repository validation order: types, lint, focused source/runtime checks,
then relevant reproducible browser checks. Use one bounded worker budget, isolated
fictional fixtures, and owned servers. Update and verify the test registry when
tests change. Reuse matching passing receipts; retain failures and untested areas.

Tests must cover causal/revision linkage, duplicate and late delivery,
interruption/recovery, scope and permission changes, opt-out/erasure, retention,
missing evidence, and preserved deterministic controls. Inspect the actual
rendered journey as well as event payloads. The foundation has passing scoped
checks; that is not a claim that the repository's historical full suite is green.

Deliver the implemented slice, a documented event/API contract, frozen evaluation
evidence, data-intake template, and updated guide/backlog/report. Prepare a rollout
checklist for migration `0074` plus any new additive migration, observation opt-in,
shadow comparison, monitoring, rollback, and a predeclared outcome study. Report
engineering completion, deployment, measured benefit, and user acceptance
separately.

This task permits local implementation and synthetic verification. Paid provider
runs, actual-data fixtures/exports, changes to existing databases, hosted rollout,
and real-user experiments require their applicable explicit authorization. Do
not reuse old grants or launch those activities just because a checklist exists.

## Existing verification references

The repository guide explains the implemented behavior and limits. Local receipts
are retained under `outputs/still-actions/`, `outputs/still-actions-browser/`, and
`outputs/validation/`; these ignored files may not exist in a fresh clone. The
independent [implementation reader](http://127.0.0.1:4198/implementation.html)
preserves source snapshots and selected receipts, and the
[progress report](http://127.0.0.1:4187) retains their handoff. Verify availability
instead of treating local URLs or historical server entries as live evidence.
