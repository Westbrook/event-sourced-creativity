# Still decision-episode intake and product review

This template prepares separately authorized, redacted evidence for
[Still's action-quality evaluation](still-action-quality.md). It does not request
an export of an account, authorize provider calls or a user experiment, or ingest
examples as training data. Continue fictional replay and local verification while
authorization or examples are unavailable. No real-user episodes were collected
for this implementation.

## One episode, one decision point

An episode can be a success, a difficult recovery, a deliberate decision to do
nothing, or work whose outcome remains unknown. Start with a few representative
successes and difficult cases across creation, review, preservation, and recovery.
Include directly discovered actions and unselected suggestions. A convenience
sample helps identify defects; it cannot estimate population benefit.

Copy this block and leave unavailable fields `unknown`. Remove names, secrets,
private creative bodies, media URLs, and unnecessary identifying details before
sharing. Use consistent pseudonyms within an authorized set.

```text
Episode ID / version:
Authorization reference, allowed purpose, reviewer, expiry/erasure contact:
Source: user report | expert review | authorized-redacted log | fictional
Occurrence time / recording time (or known uncertainty):
Actor relationship: self | collaborator | reviewer; permission at the time:
Scope and joins: pseudonymous project/document, workflow ID, target + revision:

Goal and its revision:
Success criteria (up to five); hard constraints:
Preferences, their scope/expiry; what was already complete:
Surface / screen / workflow stage; pending operation or review blocker:
Available history and missing/stale evidence:

Suggestions actually shown: action IDs, target/revision, order, emphasis:
Decision / exposure / invocation IDs; policy/model version if known:
Chosen action and source: toolbar | More | palette | content | shortcut | direct:
Other acceptable actions; whether no primary action / no action was useful:
Unacceptable actions and why; reviewer/source for each judgment:

Immediate result: attempted | acknowledged commit | completed job |
  file retrieved by browser | browser download handoff | failed | cancelled |
  unresolved; exact event / operation / job references when available:
Later assessment: target/revision, criterion met | not met | unknown,
  explicit accepted | not accepted | unknown, optional reason:
Assessment occurrence/recording times, horizon, pending/censored/unknown/revoked:
Correction/reversal: superseded assessment ID, revised judgment and reason:
What we cannot determine, including attribution or permission changes:
```

Browser retrieval and download handoff do not prove receipt, use, or acceptance
by the person. Presentation does not prove understanding. Approval of a creation
version, final commit, job completion, and acceptance of the result are distinct.
Keep explicit cancellation, preserved draft, discard, failure, and interruption
separate; do not infer abandonment or regret from silence, navigation, or undo.

## Normalization contract

1. Record the authorization reference, permitted purpose, source, redaction
   method/version, reviewers, and expiry before admitting a real episode. Keep
   any source material and pseudonym map only in its authorized location. Do not
   copy actual-data fixtures into the repository as part of this local task.
2. Preserve stable pseudonymous joins across decision, exposure, invocation,
   workflow, target revision, operation, job, outcome, and assessment. Record
   actor relationship without pretending that a collaborator's action is the
   current actor's choice. Retain causal, undo, supersession, and permission-change
   links. Redact identity consistently without rewriting the sequence.
3. Preserve occurrence and recording times independently, their precision and
   clock uncertainty. Mark late delivery, duplicate IDs, interrupted collection,
   and missing receipts. Deduplicate exact repeats; quarantine conflicting
   duplicates. Do not invent an event order from delivery order or treat a missing
   transition as a failed transition.
4. Bind facts to the exact historical target revision and scope. Keep attempted
   transitions apart from confirmed ones. A current snapshot cannot establish a
   prior approval, historical permission, or exact acknowledged operation.
   Receipt existence alone is weaker than verification of its actor, scope,
   operation identity, and exact event/job set.
5. Keep source facts, user assessments, expert usefulness labels, and fictional
   expectations separate. Allow several useful actions or no useful primary.
   Unjudged actions remain unknown; missing criteria, regret, success, cost, and
   duration stay absent. A later correction appends a version linked to its
   predecessor and preserves the earlier record within the same retention scope.
6. Declare the horizon from the episode's occurrence, limited by the applicable
   shorter retention policy and the 30-day ceiling. `pending` means still within
   the observation window; `censored` means follow-up ended without an observed
   result; `unknown` names unavailable evidence; `revoked` means withdrawn evidence
   must not contribute. A late report never renews old evidence or its retention.
7. Before replay, map reviewed material into the existing
   [fixture/capture contract](../src/still/decision-quality.ts). Use a new fixture
   version and freeze hash; preserve original fixtures, labels, hashes, and
   failure receipts. Record input and question-contract hashes from compatible
   historical evidence. Never stamp today's question hash onto incompatible
   answers. Keep policy-tuning cases separate from held-out review cases.

The offline evaluator accepts `observed`, `pending`, `censored`, `unknown`, and
`revoked` outcomes. Missing success/quality/regret fields stay absent; unknown
never becomes `false` or contributes an observed quality result. New semantic
workflow, outcome, and quality-assessment observations are diagnostic only; they
do not enter Jev's evidence merely because an episode has been reviewed.

## Request accompanying existing logs

Before any separately authorized export, ask the log owner for an event dictionary
and a coverage statement. A small redacted schema example can answer this request;
raw creative content is unnecessary.

| Needed information | What it must establish |
| --- | --- |
| Event name, version, producer, trigger, field types and enums | Whether the event records an attempt, a server acknowledgment, a presentation, or an explicit report; units and null/missing semantics. |
| Stable IDs and links | Decision/exposure/invocation, workflow instance, target/revision, goal/criteria revision, operation/event/job, actor relationship, scope, parent/undo/correction links. |
| Timestamps and delivery | Occurrence versus recording, clock source/precision, buffering, retry/idempotency rules, duplicates, late-arrival limits and reconciliation behavior. |
| Authority and lifecycle | Permission at occurrence/current access, opt-in epoch, authorization basis, source withdrawal, retention/expiry, deletion/redaction and cache/export invalidation. |
| Surface and version coverage | App/policy versions, supported toolbar views, actual palette/More/format/workflow policies, rollout periods, feature flags, browser/offline gaps and unsupported actions. |
| Sampling and denominators | Who could be observed, who opted in, missing exposure/invocation records, sampling/loss, interrupted sessions, unavailable assessments and changes in instrumentation. |
| Outcome semantics | Exactly what commit/job/export/acceptance means; which receipt was verified; observation horizon and pending/censored/unknown/revoked treatment. |

Do not claim replay coverage for palette, format, workflow, or More from a toolbar
capture. Each needs its actual production surface policy and compatible evidence.

## Three separate open product reviews

Source inspection below records current behavior, not user acceptance. Preserve
the original feedback and its status in the independent report. These reviews
must remain separately addressable even when they share instrumentation.

| Open review | Current source evidence | Concrete next review and decision |
| --- | --- | --- |
| Creation approval/finalization clarity | `StillCreationFlow.toolbar` distinguishes Continue review, Approve, Approve all, Final review, and final **Approve selected**; `CreationController.eligible` requires current, presented, complete, approved versions. `commit` previews/applies one operation and checks its receipt after interruption. Keep draft/Stay/Discard are separate choices. See [flow](../src/still/creation-flow.ts) and [controller](../src/still/creation-controller.ts). | Review title-only and organized multi-item creation separately. Ask the reviewer when they expect records to become durable, then inspect version changes and interrupted finalization. If wording is confusing, review an explicit final “Save approved records” label and a short presentation → approval → save explanation. This is a proposal; retain every current approval, source, and permission gate. |
| Viewer journey | `StillClient.abilities` derives author/generator permissions from the current session. Listings, result inspection, and eligible action discovery remain accessible. `StillApp.exportWork` refreshes scope, verifies retained content/revision, records export, retrieves bytes, and rechecks scope. Shared export authority is enforced separately. See [client](../src/still/client.ts), [app](../src/still/app.ts), and [server export checks](../worker/project-access.ts). | Review find → read → inspect → permitted download with an authorized resource, denied deep link, changed permissions, expired content, and an artifact awaiting exact-revision approval. Judge whether the Viewer can locate and understand work and a denied export. Decide any explanatory empty-state/copy change from that journey; do not add authoring controls to fill space. |
| Load-failure recovery | `StillApp.renderDock` already supplies **Retry loading Still** and **View projects** on startup failure, and View projects for an unavailable route. Writing and generation reads have separate retry controls. See [app](../src/still/app.ts). The guide retains prior local verification; no new acceptance is asserted here. | Replay transient and persistent startup failure, unavailable deep link, and writing/job read failure with fictional fixtures. Review focus, error wording, retained draft context, and retry destination; ask whether the two recovery choices are understandable. Propose changes only for a reproduced defect or unresolved product choice, rather than adding duplicate recovery controls. |

The [current journey inventory](still-action-quality.md#current-viewer-journeys-and-capability-boundaries)
contains the fuller capability and creation-stage map. No observed user-friction
rate, quality improvement, or acceptance is established by this intake or source
inspection.
