# Still Jev review and action surface adoption plans

Review date: September 30, 2026, America/New_York. Source: Forma `main` at `63bad27ced5b0dd51e51206e2ed9ee871740f184`, policy `still-23`. This is a source and test review with two proposed plans, not an implementation or a live provider evaluation. The new application's domain is unspecified; its action inventory and quality rubric are discovery deliverables rather than assumptions about Coffee Run.

**Recommendation: adopt Still's separation of capabilities, contextual judgments, deterministic selection, and UI presentation, then add explicit outcome criteria and a durable feedback loop.** Still has a strong foundation for useful suggestions. Its largest opportunity is connecting those suggestions to completed work and user-assessed quality, with sufficiently precise state and history to explain what helped.

## What Still does today

### Useful actions and Next Best Action are different decisions

Still does not ask Jev to invent commands or predict the user's next click. The application supplies a catalog of implemented actions, determines eligibility, and asks how useful it would be to offer each action now. A separate choice question nominates the most useful action to emphasize. Its instructions explicitly treat this as an invitation, allow `none`, and avoid assuming that creative work must culminate in generation. [Action catalog and eligibility](../src/still/decisions.ts#L13), [Next Best question](../src/still/next-best.ts#L21).

The current pipeline is:

1. The client sends bounded position and intent hints to `/api/still/decision`.
2. The worker authenticates, checks consent and resource scope, derives capabilities, and reconstructs authorized current state and history. Generation pages resolve saved job evidence on the server.
3. Application code filters the action catalog. Jev receives the resulting candidates, state, and named questions.
4. Jev returns typed probabilistic assessments. Code combines usefulness scores with contextual signals, selects a diverse menu, and may enrich connections or assess individual ideas.
5. The response returns action IDs, ranked alternatives, target hints, presentation evidence, and the separate Next Best nomination. The client checks freshness and current eligibility again.
6. Surface-specific code decides what fits, what is primary, what belongs in More, and which deterministic workflow controls take precedence.

[Worker orchestration](../worker/still-api.ts#L27), [ranking](../src/still/decisions.ts#L332), [client application](../src/still/app.ts#L574).

Jev's API receives `{model, state, questions}` at `POST https://api.typesafe.ai/v1/systemone`. Named answers correspond to named questions. Its primitives are `noul` for a yes/true probability, `score` for an expected rating over an ordered rubric, and `choice` for a categorical choice with a probability distribution. The response also provides the resolved model and usage. These meanings are documented in the [official API schema](https://api.typesafe.ai/openapi.json). They do not make a toolbar score an empirically established probability of user success.

### The questions and selection policies

| Question family | What Still asks | How it is used |
| --- | --- | --- |
| Per-action usefulness | Unrelated/counterproductive; possible later; helpful now; directly answers the need | Base 0–3 scores for the menu |
| Next Best Action | Which eligible invitation is most useful to emphasize now? | Separate nomination, checked against usefulness evidence |
| Current activity | Collect, organize, explore, shape, review, finish | Small ranking adjustment; not a mandatory funnel |
| Contextual judgments | Intent to create, preserving options, missing inputs, contradictions, unreviewed results, independent reuse, structural integrity, constraints | Bounded supporting signals and penalties |
| Specific-format request | Does current explicit intent request this format now? | Prevents past clicks or subject matter from selecting a format |
| Format suitability | Poor fit through especially promising | Separate output chooser ranking |
| Idea opportunities | Would splitting, research, finding or supplying references help a particular idea? | Per-idea benefit and target selection |
| Connection enrichment | Is a destination useful, conflicting or duplicative? Does an alternative add a distinct path? | Optional refinement of reuse destinations and menu diversity |
| Palette/finder | Which available alternative helps, or which existing action matches a query? | Complete action discovery outside the small toolbar |

The main request prunes the broader question library to judgments consumed by the current menu. Questions are organized into intent, structure, connections/reuse, and exploration compositions. [Question construction](../src/still/decisions.ts#L215), [dependency pruning](../src/still/decisions.ts#L315), [compositions and enrichment](../src/still/assessments.ts#L7).

Ordinary menu ranking accepts valid usefulness scores with confidence at least 0.12 and positive scores, then applies bounded support, activity, novelty, preservation, and review-first adjustments. It normally selects up to four suggestions, at most two from one group and one generation-group action. These permissive ranking thresholds mean the set is better described as **ranked useful candidates**, not a set of calibrated “highly likely” outcomes. [Ranking policy](../src/still/decisions.ts#L332).

Primary emphasis is stricter:

| Path to emphasis | Current requirements |
| --- | --- |
| Accepted Next Best nomination | Choice confidence ≥0.60; choice probability ≥0.50; lead ≥0.15 over the next choice; usefulness confidence ≥0.55; P(helpful or directly useful) ≥0.70; valid, eligible, unrestricted nominee |
| Score-only primary | Score ≥2.4/3; confidence ≥0.70; helpful-or-better probability ≥0.80; visible score lead ≥0.30, with adequate comparative evidence |
| Product default | Certain page invitations can be emphasized by explicit local policy, with their origin disclosed |

An accepted Next Best nomination does not require the score-only mean threshold. This intentionally permits a likely-helpful invitation whose mean score is lower. The toolbar permits at most one primary; it can have none. More alternatives remain secondary. These are product heuristics requiring outcome validation in another domain. [Next Best acceptance](../src/still/next-best.ts#L25), [presentation](../src/still/presentation.ts#L3).

### How the surfaces differ

| Surface | Current behavior worth carrying forward |
| --- | --- |
| Main toolbar | Small menu, current eligibility, local fallback, layout-aware capacity. Default density is five total controls, including utilities; four suggestions are not guaranteed to fit. |
| Focused idea | Reserves a return to the whole document; parent-document maintenance is moved out of the focused toolbar. |
| Content lists | Existing content is directly interactive. Toolbar recommendation does not rank project/document rows. |
| Output chooser | Evaluates formats separately. Choosing one opens configuration; generation requires explicit submission and its normal checks. |
| More | Reuses the same ranked assessment without another Jev request. |
| Command palette | Complete eligible catalog is immediately available locally. A bounded reassessment may reorder before interaction; passed-over suggestions are weak evidence, not rejection. |
| Open workflow, required review, busy/recovery state | Deterministic workflow controls take precedence. Jev cannot authorize submission or waive required review. |
| Developer tools | Inspect exact supplied evidence, questions, responses, ranking adjustments, omissions, Next Best checks and final controls; capture and compare decisions. |

[Toolbar construction](../src/still/app.ts#L1241), [palette refresh](../src/still/app.ts#L710), [local policy](../src/still/local-policy.ts#L1), [Decision Lab](../src/still/decision-lab-panel.ts#L29).

Requests follow meaningful navigation, selection, content/job-state changes and explicit refresh. Scrolling does not request new decisions. The client prepares local controls, but the current motion coordinator controls when controls become interactive and when a request expires; this is not an uncontrolled stream of button rearrangements. Tickets, scope, position, event head, policy and interaction checks reject stale responses. Browser/server caches are bounded and authorization-aware. [Request lifecycle](../src/still/app.ts#L574), [motion coordination](../src/still/motion/coordinator.ts#L51), [five-minute memo](../src/still/decision-cache.ts#L1).

### State and history actually supplied

Still already supplies much more than a route name: explicit session intent; current project/document/idea/result IDs; capabilities; selected writing; active ideas; neighboring relationships; locked constraints; provenance; output summaries; reusable context; and generation outcome/recovery facts where applicable. The worker uses authorized history rather than trusting a client event dump. [State builder](../src/still/decisions.ts#L394), [authorized job context](../src/still/generation-decision.ts#L11).

History starts with event-type aggregates and bounded windows of 45 recent events, 12 recent creative events, 35 focused events, and 40 milestones. Separate creative windows prevent a burst of browsing from hiding meaningful edits or generation outcomes. State is compacted toward 20 KB; a complete provider request is separately checked against 60 KB. These are Still's engineering bounds, not recommended universal constants. [History collection](../src/still/history.ts#L50), [request budgeting](../src/still/decisions.ts#L430).

Important limits:

- Client `recentActions` is only twelve action-ID strings, with some `completed:*` markers. Document/project changes clear it. Selection is recorded before success. “Set next goal” is also session state rather than a durable goal lifecycle. [Navigation](../src/still/app.ts#L551), [action selection](../src/still/app.ts#L802), [goal save](../src/still/app.ts#L946).
- Provider-facing event compaction drops actor and causal identifiers that the underlying records possess. Jev cannot reliably distinguish the user's choice, a collaborator's edit, system completion, or compensation of a prior event. [Compaction](../src/still/history.ts#L5), [read metadata](../worker/still-history-read.ts#L12).
- Still's attention observer explicitly remains local, observe-only and not sent to Jev. This is distinct from retained platform attention events that can enter authorized history. [Local observer contract](../src/still/attention.ts#L1).
- Developer decision captures are temporary, with explicit export. Operational caches and developer traces do not constitute a durable suggestion-to-quality learning loop. [Decision recording](../src/still/app.ts#L443), [capture limit](../src/still/decision-lab.ts#L6).
- Coverage reporting is useful but incomplete: budget reduction can omit active blocks, outputs, provenance, preference evidence and even aggregates without a complete per-field coverage manifest. Missing data must remain unknown. [Pruning](../src/still/decisions.ts#L434).

## Plan one: a new application's action surfaces

### Define success and the surface contract first

For each important user job, define a quality outcome with the user or domain experts. Examples include an accepted design satisfying constraints, a resolved exception without duplicate work, or a resumed draft with its content preserved. “Clicked the primary button,” “generated something,” and “spent longer in the app” are insufficient quality measures. Exploration and deciding not to act can be successful outcomes.

Create a surface inventory before selecting a model or tuning thresholds:

| Surface | Recommendation job | Required local behavior |
| --- | --- | --- |
| Home/resume | Suggest a useful continuation or new start from unresolved goals and recent meaningful work | Keep direct content navigation and search; do not infer a current goal from old habits |
| Workspace/document | Suggest the next useful change, review or exploration for the assembled work | Preserve constraints and accessible alternatives |
| Selected object/range | Suggest actions applicable to this exact target and its dependencies | Retain parent navigation; bind target revision |
| Workflow/configuration | Help resolve a missing input or choose among valid next steps | Explicit step prerequisites, save/cancel/review controls stay deterministic |
| Result/review | Offer evaluation, comparison, revision, reuse, acceptance or export | Distinguish produced, reviewed and accepted |
| Error/recovery | Offer inspect, resume, reconcile or safe escape based on known operation state | Never confuse retry with recovery or duplicate an uncertain operation |
| Command palette | Discover the complete implemented eligible catalog | Search, keyboard operation, stable interaction and explicit invocation |

Each surface declares its supported action families, recommendation purpose, slot budget, reserved controls, nomination rules, fallback, update timing and success rubric. At most one optional primary is a good starting convention. Maintain a complete alternative surface so model uncertainty never removes access to capabilities.

### Provide actions as a versioned application-owned registry

Separate a **capability** (“compare versions”), an **action definition** (“open comparison”), and an **action instance** (“compare document D revisions 12 and 14”). The model selects among supplied instances or bounded action/target choices. It does not supply executable code, arbitrary URLs, unchecked parameters or new permission grants.

| Action metadata | Why it improves suggestions |
| --- | --- |
| Stable capability/action ID, definition version, title, plain-language description | Consistent selection, analytics and migration; labels remain localizable |
| Supported surfaces, entity types, target and parameter schemas | Prevents a useful general action being suggested in the wrong place or against the wrong object |
| User benefit, intended outcome, quality rubric, when useful and when inappropriate | Gives the model a meaningful utility objective beyond feature popularity |
| Preconditions, dependencies, missing inputs, readiness and explicit exclusions | Separates executable now, available after setup, and unavailable |
| Launch effect, commit effect, affected resources and downstream consequences | Distinguishes opening a form from changing shared content, publishing or paying |
| Reversibility, undo/recovery route, destructive/external/shared effects | Supports proportionate emphasis and user review |
| Cost estimate/range, duration range, effort, freshness and uncertainty | Enables comparison against the user's time/budget preferences without fabricated certainty |
| Required permission/consent/confirmation, idempotency and concurrency behavior | Keeps authorization and safe execution in application code |
| Prerequisite/alternative/substitute relations, overlap group, exploration value | Produces a useful set rather than four variations of one step |
| Outcome events and validation criteria | Makes suggestions measurable against actual results |
| Evidence requirements and missing-evidence policy | Lets the orchestrator retrieve necessary context or abstain |
| Availability/health, definition owner, rollout status and policy version | Avoids recommending broken, retired or incompatible capabilities |

Expose only metadata needed for the decision. Actual executors, secrets and authorization proofs remain server-side. Provide readiness as server-derived facts; use an explicit preparatory action such as “supply required input” instead of pretending the final action is ready. Recheck authorization, current revisions and preconditions when the user invokes an action, even if it was recommended moments earlier.

For a large catalog, retrieve by deterministic surface/type/permission filters first, then a bounded relevance pass. Preserve mandatory controls, explicit user requests and broad discovery outside this shortlist. Evaluate retrieval recall: an omitted good action cannot be recovered by a better ranker. Jointly assess action and target when targets materially change utility.

### Use a server decision service and surface adapters

Recommended flow:

`client hints → authorized snapshot → eligible action instances → relevant evidence → typed judgments → validated selection → surface presentation → explicit invocation → outcome events`

The new application's API should accept a surface, selection and user intent, then build the authoritative decision envelope on the server. Keep the provider adapter replaceable. Cache and replay the application-level contract rather than allowing provider response fields to become UI/execution authority.

An illustrative state shape follows. Names and budgets are proposed application contracts, not additional top-level Jev API fields:

```json
{
  "schemaVersion": "decision-state-v1",
  "snapshot": {
    "asOf": "2026-09-30T20:00:00-04:00",
    "contentRevision": 142,
    "workflowRevision": 9,
    "preferenceRevision": 3,
    "authorizationRevision": 7
  },
  "surface": {
    "id": "document.review",
    "selection": { "resourceId": "doc-17", "revision": 142 },
    "workflowId": "review-8",
    "step": "compare",
    "dirtyDraft": false,
    "pendingOperation": null,
    "blockingReview": null,
    "interactionLocked": false,
    "maxSuggestions": 3,
    "reservedControls": ["return-to-document"]
  },
  "goal": {
    "source": "explicit-user",
    "scope": "doc-17",
    "objective": "Choose a version suitable for the intended audience",
    "successCriteria": ["Preserves the agreed facts", "Meets the approved tone"],
    "status": "active"
  },
  "currentWork": { "summary": "Two versions await review", "constraintRefs": ["constraint-4"] },
  "history": {
    "recentCommittedActions": [],
    "unresolvedWork": [],
    "activePreferences": [],
    "recentExposure": []
  },
  "candidates": [
    {
      "instanceId": "compare-doc17-r140-r142",
      "actionId": "compare-versions",
      "actionVersion": 1,
      "benefit": "Inspect whether the revision improved the agreed criteria",
      "launchEffect": "Opens a comparison; does not accept either version",
      "readiness": "ready",
      "reversible": true
    }
  ],
  "coverage": { "history": "partial", "constraints": "complete", "omittedReason": "bounded retrieval" }
}
```

The request to Jev wraps such state in its existing `{model, state, questions}` interface. Ask a small number of specific questions with anchored rubrics:

- Per action: how much would offering this action help the stated goal now, given the present workflow and evidence?
- Where useful: does a missing prerequisite require clarification; would this repeat failed work; would it conflict with an explicit constraint; would it add a distinct useful path?
- For uncertain choices with material consequences: would asking a specific clarification change the recommended next step enough to justify interruption? Keep clarification concise and optional when a safe reversible path exists.
- After any necessary enrichment: which final promotable action is best to offer prominently, or is none appropriate?

Do not ask the model to infer facts already known from code, such as permissions, dirty state, budget balances or supported parameters. Keep declared goals separate from embedded text in documents and retrieved sources. Mark source text as evidence and minimize untrusted instructions, while enforcing hard constraints outside the model.

Normalize responses centrally: required question/type, finite/ranged values, exact permitted keys, normalized distributions within documented tolerances, valid score expectation and choice argmax where the provider contract requires them. Preserve missing/invalid/unknown distinctions. A documented degraded path may permit ordinary fallback suggestions while prohibiting confident emphasis. Do not multiply score confidence, usefulness probability and choice probability as if they were independent success estimates.

Select the final set with eligibility, utility, diversity, overlap, prerequisites and UI capacity. A candidate judged best alone may be redundant beside other choices. Produce one immutable decision receipt recording requested and resolved model, registry/question/policy versions, evidence identities and coverage, candidate set, inspected answers, policy adjustments and exclusions. The client response should contain only bounded display fields: decision ID, state fingerprint/expiry, suggestion instance IDs, optional primary, target bindings, structured reason/evidence references, source and coverage warnings.

Use application-authored explanations such as “Compare these versions to check the approved tone,” grounded in retained facts and typed reason codes. Jev's current interface does not generate freeform explanation text. Rich generated explanations would require a separate component and their own grounding checks; internal rationale or confidence numbers need not clutter the UI.

### Supply current state and history together

**Current state answers what is true and possible now; history answers how the user arrived here and what helped.** An event log alone cannot reveal unsaved edits, active focus or an open review. A snapshot alone cannot reveal repeated failed attempts, abandoned directions or the reason a constraint was chosen.

| Evidence slice | Productive fields | Treatment |
| --- | --- | --- |
| Goal and quality | Objective, audience, success criteria, priority, explicit constraints, relevant effort/time/budget preferences, lifecycle | Explicit and scoped; unset remains unknown; allow correction |
| Location and workflow | Surface/view, workflow instance/step, selected target/range and revision, entry point, previous semantic step, completed prerequisites, return path | Semantic state rather than screenshots or DOM dumps |
| Current authored work | Relevant content/summary, active/excluded inputs, constraints/locks, provenance, dependencies, review and validation state | Server-authorized projection; do not infer media quality from a URL |
| Transient interaction | Dirty draft and safe summary of unsaved changes, pending save, open dialog, blocking validation, explicit selections, composing/focused/touched state | Client hints with provenance; avoid raw keystrokes and unnecessary draft text |
| Operations | In-flight job/attempt, failure class, acceptance/receipt certainty, recovery eligibility, unresolved cost/liability | Server-owned evidence; distinguish resume, reconcile and new attempt |
| Active preferences | User-authored preference, owner/scope, explicit or inferred source, validity, supersession/revocation, evidence | Individual taste is separate from shared project constraints |
| Actual exposure | IDs and versions actually shown, order/slot, primary, exposure timing, More/palette entry, selection source | Offered, rendered, visible, selected and completed are distinct |
| Relevant history | Recent semantic actions and outcomes on this goal/entity; retries, cancellations, undo, feedback and review decisions | Retrieve causal sequences, not only the last global N events |
| Unfinished obligations | Interrupted drafts, unresolved reviews, promises, failed operations and outstanding inputs | Preserve beyond recency windows until resolved |
| Comparable outcomes | Relevant previous successful/unsuccessful workflows with evidence, time/cost, sample counts and uncertainty | Avoid copying old goals or overfitting a small sample |
| Coverage and freshness | As-of time, independent revisions, section/item truncation, included/omitted counts, evidence age/expiry, unknown reasons | Missing is not false; stale is not current |

Use a budgeted history projection: current workflow timeline first, then relevant recent authored outcomes, unresolved work, active preferences, and a few comparable cases. Keep raw events available under access controls for debugging; do not send the entire log on every request. Summaries need supporting event references, a version, and an update/revocation rule. Deduplicate evidence repeated across windows. Preserve explicit constraints and current blockers before optional exploratory material; if necessary constraints cannot fit, withhold affected recommendations or fetch a narrower assessment.

An event envelope should retain:

- Event ID/schema version, occurred and recorded times, ordered scope sequence.
- Pseudonymous actor identity plus actor kind and relationship to the current user; application, surface, session, goal and workflow IDs.
- Action ID/version/instance, invocation source, target IDs and pre/post revisions, allowlisted parameter summary.
- Decision ID, impression ID, invocation/operation/job ID, causation/correlation links, and compensation or supersession links.
- Precisely defined lifecycle and outcome, validation result, user assessment, actual duration/cost when relevant, and outcome observation horizon.
- Sensitivity, retention/expiry, consent basis and deletion/redaction lineage.

Record both recommended and directly invoked actions. A useful lifecycle is decision requested/produced/applied → suggestion exposed → selected → workflow entered → committed → completed/failed/cancelled → reviewed/accepted/revised/undone. These are separate events; do not fabricate a completion from a click or a rejection from silence. Distinguish user cancellation, system failure, policy refusal, interruption and unresolved state. Late outcomes may arrive after the session; unobserved outcomes remain censored/unknown.

Keep canonical domain events separate from recommendation observations with different retention needs. Give content, workflow, preference, authorization and feedback their own revisions. Recording an impression must not recursively invalidate the content snapshot and request another recommendation. Revoke deleted/expired evidence from projections, caches and replay exports; clock-driven expiry must work without a new domain event.

### Timing, quality evaluation and rollout

Request on meaningful surface/selection changes, committed changes, explicit goal edits, relevant job/review transitions, and user-requested alternatives. Coalesce rapid changes, cancel obsolete work, deduplicate matching calls, and use surface-specific deadlines. Avoid per-keystroke or per-scroll calls. More can reuse a receipt; a new palette query or substantive state change can justify reassessment. Once the user interacts, keep controls stable until a safe transition, except that newly invalid actions must be disabled or removed with accessible feedback.

Cache only within the current authorized scope and exact dependency versions, bounded by the earliest evidence expiry. Include action catalog, question, policy and resolved model identity or an explicit model-alias invalidation epoch. Record cache source, misses and fallback reasons. Define partial-result behavior deliberately: either validated baseline suggestions may survive optional enrichment failure, or the entire surface uses deterministic fallback. Do not leave transport and UI with conflicting promises.

Evaluation should proceed in four stages:

1. Freeze synthetic/redacted cases with explicit goals, current state, histories, eligible actions, useful alternatives, unacceptable actions and expert/user quality labels. Include cold start, experts, exploratory work, shared edits, sparse/truncated context, failed jobs, unsaved work, revoked permission, undo and changed goals.
2. Test deterministic contracts: eligibility, target binding, response validation, partial failures, stale replies, scope isolation, deletion/expiry, no automatic execution, replay, and accessible stable controls. Use portable Playwright fixtures for browser behavior.
3. Compare local policy, Still-like scoring, separate nomination, and richer context/history offline and in shadow mode. Measure retrieval recall, useful-set precision/diversity, Next Best appropriateness and abstention, calibration by surface, latency, cost and stability. Use ablations to find which history fields actually help.
4. Run a bounded opt-in comparison with real outcomes after the application has an appropriate authorization and privacy basis. Measure quality improvement with uncertainty, not just engagement. Log assignment/exposure and available alternatives; account for selection and position bias before treating observational clicks as causal evidence.

Primary measures should include task-rubric quality, constraints satisfied, user acceptance/reuse, successful resumption/recovery, avoidable rework, and time/cost to an accepted outcome. Countermetrics include regret/undo, unwanted workflow starts, duplicate operations, ineligible/stale suggestions, excessive clarification, suggestion churn and accessibility failures. Compare by surface and goal; do not force diverse workflows into a single completion number. Use human review of sampled failures and distribution shifts. Keep a rollback and reliable local baseline.

### Delivery sequence for the new application

| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 1. Product definitions | Surface inventory, capability/action registry, user jobs and quality rubrics | Representative workflows can be completed with deterministic controls; action effects and quality criteria are unambiguous |
| 2. Evidence foundation | Versioned snapshot, causal event contracts, history projection and privacy/retention rules | Can replay why a candidate was eligible; current state, explicit goals and unknowns remain distinct |
| 3. Decision service | Replaceable Jev adapter, typed questions/validation, set selection, optional Next Best, receipt and cache contracts | Offline invariants pass; low confidence, missing evidence and provider failure have usable fallbacks |
| 4. Surface integration | Main toolbar, contextual controls, More/palette and workflow-specific behavior | Stable keyboard/touch use; no stale target execution; deterministic review paths preserved |
| 5. Outcome evaluation | Attribution, expert/user evaluation, shadow comparison and bounded rollout | Predefined quality criteria improve without unacceptable regressions; rollback and monitoring are operational |

Do not start by cloning Still's full question library. Start with one representative surface and a small catalog, then add questions only when an identified decision and evaluation demonstrate their value.

## Plan two: enhance Still

The following are proposals grounded in current source. They should be implemented and validated as separate changes; this review does not authorize provider evaluations, deployment or automatic behavioral tracking.

### First establish consistent decisions and faithful evidence

| Priority | Finding and proposed change | Verification required |
| --- | --- | --- |
| P0 | **Reconcile Next Best with final evidence.** Nomination is from the first pass, while connection enrichment and later idea assessments may alter the menu/ranking. Client nomination can pull an action back from the full ranked list. Nominate from final promotable candidates/evidence, or invalidate/revalidate the original choice when relevant evidence changes. Align nominated candidates with toolbar policy, including explicit-format rules. | A fixture where enrichment changes the best path produces a coherent final menu, target and primary; a nomination cannot undo a validated diversity/constraint decision. |
| P0 | **Centralize answer validation.** Distribution problems currently become warnings while score/choice can remain Answered. Ranking/finder paths use different subsets of the evidence. Define valid, degraded and unusable answers centrally; check expected score and choice argmax consistently with the provider contract. | Malformed/missing distributions, extra keys, inconsistent mean/choice, NaN, unknown candidates and partial responses yield documented fallback behavior across toolbar, formats, finder and idea assessments. |
| P0 | **Align attention retention.** Still's history path filters forgotten attention but does not apply the canonical attention helper's expiry/phantom filtering. Actual exposure depends on stored data; this is a read-path inconsistency, not evidence of a measured production incident. Apply consistent filtering before summaries/cache reuse. | Expired, forgotten and phantom episodes never reach model state or retained decision reuse, including expiry with unchanged event head. |
| P0 | **Make coverage complete.** Add per-section and text-field inclusion, truncation, expiry and source references. Preserve constraints and blockers under budgets. | Sparse, large and multibyte fixtures report exactly what was omitted; emptied aggregates are labeled unavailable rather than representing zero activity. |
| P0 | **Settle the partial-stream contract.** Transport can return an initial assessment when enrichment is interrupted; the main toolbar explicitly rejects initial-stage results. Decide whether final-only behavior is intended or a validated baseline may survive. | End-to-end interrupted-stream test verifies visible controls and status. Distinguish this from provider enrichment failure that still produces a complete server response. |

Evidence: [first and final pass orchestration](../worker/still-api.ts#L152), [nominee reordering](../src/still/next-best.ts#L49), [format eligibility for ranking](../src/still/decisions.ts#L352), [answer inspection](../src/still/diagnostics.ts#L10), [finder threshold](../worker/still-api.ts#L156), [Still attention filter](../src/still/history.ts#L20), [canonical attention filter](../src/model/attention.ts#L96), [transport fallback](../src/still/decision-transport.ts#L29), [client final-only check](../src/still/app.ts#L600).

The first two rows are logical consistency and robustness findings. They are not claims that a particular live user received a wrong suggestion. Freeze regression cases that reproduce the potential discrepancy before altering behavior.

### Then measure outcomes and strengthen workflow context

1. **Add durable decision and outcome attribution without changing ranking first.** Extend the existing inspector/Decision Lab vocabulary into a bounded receipt and event stream. Join actual visible actions and invocation sources to committed domain events, jobs and later user assessment. Retain cancellations, direct actions and reversals. Keep local attention observe-only unless a separately defined purpose and retention basis justify changing it.

2. **Make goals resumable and user-controlled.** Preserve the current lightweight session intent, and optionally allow a goal scoped to an idea/document/project with success criteria and active/completed/abandoned states. Show and allow clearing it. Never persist an inferred goal from a click. Clarification should help only when the answer materially changes the next step.

3. **Extend Position into a surface/workflow contract.** Add current workflow/step, dirty/pending state, blocking review or validation, explicit parameter selections, actual visible actions, and safe return path. Include these summaries in palette context where relevant. Keep required review and failure recovery deterministic.

4. **Retain actor kind and causal links in compact history.** Distinguish authored decisions, collaborator edits, automation, and undo. Add a normalized projection of active, scoped preferences with provenance and revocation; generic historical Preference events and text are insufficient for knowing which preferences still apply.

5. **Improve relevant evidence retrieval.** Whole-document idea assessment currently starts with at most eight eligible ideas in list order, with possible further reduction under its budget. Select by focus, current goal, relevant changes and unresolved needs, and disclose assessed versus total coverage. Connection retrieval is lexical overlap over a top-six shortlist; evaluate hybrid relevance/diversity retrieval before assuming a semantic index will improve outcomes. Preserve authorization checks during retrieval and hydration.

6. **Use one end-to-end work budget.** Main/connection passes have a shared deadline; idea assessment and repair have their own timeouts. Establish a common cancellation/deadline contract across preparation, provider calls, enrichment and UI readiness. Retain numeric provider usage, resolved model, per-pass cost estimates and actual interactive latency; the current decision paths read model/answers but do not retain API usage.

Evidence: [transient goal](../src/still/app.ts#L946), [Position](../src/still/decisions.ts#L13), [history compaction](../src/still/history.ts#L5), [idea assessment scope and execution](../worker/still-idea-assessment.ts#L9), [connection retrieval](../src/still/assessments.ts#L20), [provider response handling](../worker/still-api.ts#L132).

### Finally tune for demonstrated user benefit

Use the existing Decision Lab as the evaluation workbench. Turn authorized redacted captures and fictional scenarios into versioned replay cases with expected useful choices and user/expert assessments. Current tests cover policy mechanics and some sanitized real-answer regressions; their presence does not establish outcome calibration. Re-evaluate the 0.12 ranking floor, Next Best gates, correlated support signals, stage adjustment without a confidence gate, novelty, diversity and abstention against these cases and subsequent outcome evidence. Change the questions, retrieval and weights separately enough to attribute improvements. [Threshold regressions](../tests/still-next-best.test.mjs#L9), [ranking adjustments](../src/still/decisions.ts#L345).

Add low-friction corrections: “not useful now,” “already done,” “different goal,” or “keep this choice available.” Scope and expire them appropriately. A passed-over button or brief hover should not become a persistent preference. Evaluate useful exploration, preserving coherent ideas, reviewing unreviewed results and avoiding unnecessary generation as positive outcomes alongside completed artifacts.

Reconcile existing user feedback with current code:

- Creation approval/finalization confusion remains open feedback. Map the actual steps and use completion, cancellation, backtracking and assistance requests to identify friction; do not assume better ranking alone fixes confusing review language.
- Viewer-mode controls remain an underspecified product question. Inventory permitted read/review/navigation/export capabilities by resource policy, then propose concrete viewer journeys. Do not relax authorization to fill a toolbar.
- The report's load-failure feedback predates current recovery controls: `renderDock()` now supplies Retry loading Still and View projects. Verify the current user experience and update its review record when warranted rather than planning a duplicate implementation. [Existing recovery toolbar](../src/still/app.ts#L1244).
- Refresh the Still README's action-density and presentation descriptions to match current code. Existing documentation describes older 3–12 density and weaker/smaller styling; current developer density is 1–7 and toolbar presentation uses medium primary/secondary controls. [README](../src/still/README.md#L33), [density](../src/still/decision-lab.ts#L5), [presentation normalization](../src/still/presentation.ts#L32).

Recommended Still sequence: correctness/coverage regression cases → consistent validation and final nomination → attribution and state contracts → retrieval/latency improvements → calibrated quality evaluation → bounded rollout. Maintain separate completion criteria for implementation, measured benefit, deployment and user acceptance. Existing reliable access to More, palette, required reviews and local fallbacks should remain throughout.

## Verification and limits of this review

Three independent source reviews covered server selection/questions, state/history, and client presentation/observability. Findings were reconciled against current code, selected tests, Still's canonical report and open feedback, and the official Jev API schema. Documentation links and embedded JSON are checked separately as part of delivery.

No app implementation, user records, permissions, paid provider calls, deployment or model thresholds were changed. Existing test sources were inspected; application suites and live UI/provider evaluations were not run for this documentation-only task. Potential behavioral inconsistencies are explicitly distinguished from reproduced live incidents. Plans remain recommendations awaiting project scoping, not accepted implementation requirements.
