# Forma Memory: remaining non-implementation work

Updated **2026-09-18**. Backlog entry: [MEM-001](backlog.md#memory).

September 18 release continuation: see [completion and release status](forma-memory-release-2026-09-18.md).
The Memory task pushed the integrated implementation to remote `main` and published
production **426**, then notified **Build minimalist Jev creative app**, the latest
active Forma publisher. The linked release status contains the exact receipt.
This is not a claim of accepted release ownership for future operations, production
qualification or complete implementation.

This is the operational, policy, evaluation and acceptance checklist, **not a
claim that the entire Memory expansion is implemented**. Unfinished source work
is tracked separately in [the implementation reconciliation](forma-memory-implementation-2026-09-17.md#remaining-source-work).
A gate only closes for the specific implementation, audience and runtime tested.

See the [Sites capability and implementation To Do](forma-memory-sites-capability-todo-2026-09-18.md)
for the current checkpoint/status/tooling continuation and separately tracked
external services. This does not close the semantic system or rollout gates.

## Decisions already made

The user approved storing Memory with their other Forma data, charging its
provider work to the AI allowance for now, selecting a monthly cap from a
benchmark, and reusing the existing OpenAI credential. These are not unanswered
questions. The retained benchmark approval has a **$10 one-time ceiling**; that
is not a monthly Memory budget. No measured monthly recommendation exists yet.

Real users must not be enrolled until the relevant qualification passes and they
explicitly consent. Publishing default-disabled code is not enrollment. A
credential's presence is not model access, price verification or spend approval.

## Checklist

| Gate | Next action | Evidence needed to close | Owner |
| --- | --- | --- | --- |
| Release review and integration | The default-disabled source release is shipped as production 426; see the exact receipt. Remaining: owner/human acceptance, future migration review, qualified rollback and later pipeline releases. The older specialist production task remains archived. | Publication/source receipt is recorded; it does not close future schema, qualification, acceptance or operations gates. | Memory task delivered this release; ongoing operations unassigned |
| Hosted scheduling qualification | Qualify the supported independent scheduler/runtime using isolated accounts/data before registering production delivery. | No-visitor invocation, timezone/activity gating, concurrency/capacity limits, duplicate and missed delivery, lease expiry, loss of ACK, restart and backpressure evidence. Privacy/expiry maintenance must run even without human activity. | Unassigned; user is arranging scheduling |
| Hosted storage/privacy qualification | Rehearse the exact schema and bounded SQL on the selected host, with isolated data and real access transitions. | Atomicity and statement/binding limits; revoke/remove/expire/erase, concurrent publication, retained-content withdrawal, recovery and backup/restore checks; no false erasure success. Qualify larger retention limits separately rather than assuming the earlier 257-item boundary passed. | Unassigned |
| Provider qualification | Verify the selected models, current pricing, account access, residency/retention and bounded usage reporting for the exact candidate source. | Reviewable dated evidence bound to model/pricing versions, exact plan and source digest, origin and validity period. Do not fabricate qualification records merely to enable a route. | Unassigned |
| Bounded synthetic benchmark | After the native candidate and provider contract qualify, run the previously approved synthetic experiment against the explicitly confirmed self-paying account. Do not use real user histories. | Actual token/dollar ledger reconciliation, quality and latency measurements, failure/lost-ACK evidence, cleanup, and a comparison with Forma's existing baseline. Stop under the one-time ceiling; unresolved exposure is not refunded or retried blindly. | Unassigned |
| Monthly cap selection | Use measured demand and human-reviewed usefulness to propose the smallest productive cap and its exhaustion behavior. | Recorded workloads, cost sensitivity, quality threshold, daily/monthly bounds, explicit accepted cap and grant scope. Hypothetical $1/$3/$5 projections and stale estimates do not establish the cap. | User decision after benchmark |
| Retention and scope policy | Confirm offered retention windows, allowed background purposes, broad-history portability and any organization-sharing rules for the actual rollout. | Versioned policy and consent text; local/project history dominates; cross-organization private material remains excluded; no accidental inheritance from project nesting. | Product/privacy owner; unassigned |
| Browser/device and human acceptance | Exercise the actual deployed candidate in supported browsers, a second authorized device, and assistive technology. Review Memory usefulness and misleading-inference failures with humans. | Scope/account changes, visibility/BFCache/expiry, dropped connections, original-request recovery, no paid fallback, localization/accessibility and stale-view retirement receipts. Finite mocked component tests are not this acceptance. | Acceptance owner; unassigned |
| Explicit user enrollment | Offer purpose-specific consent only after the relevant gates pass; record actual authorized actors/scopes/providers/budget/expiry. | Each user's affirmative consent and inspect/correct/suppress/pause/forget checks. No enrollment inferred from chat, app use, deployment, or a benchmark grant. | Authorized user and rollout owner |
| Canary and ongoing operations | Record a bounded rollout/rollback decision and operational ownership. | Source-free freshness/cost/failure/privacy metrics, alert response, accounting reconciliation, safe pause/drain, audit cadence and a measured canary report. Any missing monitoring or runtime adapter code remains implementation, not this gate. | Operations owner; unassigned |

## Handoff rules

- Keep source completion, local verification, hosted qualification, deployment,
  enrollment and user acceptance separate in every status update.
- Preserve original request and financial receipts after uncertain execution;
  do not silently retry provider work or erase unresolved exposure.
- Do not treat a scheduled Codex task, an open browser, or visitor-triggered
  maintenance as a qualified production scheduler.
- Do not broaden an accepted synthetic or document-local result into a claim
  about semantic, organization-wide or world-scale personal recall.
