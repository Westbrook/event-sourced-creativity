# Forma backlog

Central entry point for unfinished delivery work. Updated **2026-09-17**.
Use the linked guides for detailed contracts and evidence; keep task status here.
The initial inventory reconciles the durable-generation handoff with selected
existing repository records. It is not an exhaustive audit of every historical
TODO. Ongoing work in other branches must be reconciled before reimplementing it.

## Maintaining this list

- Give each item a stable ID, an owner, a status, a concrete next action and a
  completion condition. `Unassigned` means no owner has been recorded here.
- Use **Open**, **Blocked**, **In progress**, **Needs reconciliation**, or **Done**.
  Record the blocker for blocked work. Record the responsible person or task
  before changing an item to In progress; a suggested role is not an assignment.
- Update the relevant row in the same change that materially advances or closes
  it. Include a repository-relative evidence link and the integration commit or
  release receipt. Source implementation, production activation and acceptance
  are separate milestones; passing unit tests does not close a live acceptance gate.
- Reconcile Needs reconciliation items against the current branch and their
  active owners. Historical notes alone must not reopen completed work.
- Move closed items to Completed below, retaining their IDs and evidence. Add
  newly discovered work here and link its detailed issue or guide. Keep proposals
  separate from accepted delivery requirements in the linked decision records.

## Durable generation

**Current state:** the reviewed execution/recovery foundations are implemented;
independent background execution remains inactive. The completed foundation is
not an outstanding implementation task. Track activation and acceptance below.

Primary references: [activation guide](durable-generation-activation-2026-09-17.md),
[execution contract](durable-generation-contract-2026-09-17.md),
[foundation verification](durable-generation-verification-2026-09-17.md), and
[candidate schema](activation-candidates/output-durable.sql).

**Next action:** DG-001. Confirm a supported independent runtime and its limits
before choosing host bindings or installing the candidate schema. All items are
Unassigned until an owner is recorded. Row order groups dependencies, not dates
or a promise to activate every output route at once.

| ID | Status | Owner | Remaining work / next action | Done when |
| --- | --- | --- | --- | --- |
| DG-001 | Blocked — runtime contract unverified | Unassigned | Qualify a supported Sites queue/workflow/scheduled trigger or an explicitly approved companion runtime. Record delivery, invocation and lease limits. | A supported independent execution contract is documented and verified. Browser activity, `waitUntil` and recurring Codex work are not the delivery mechanism. |
| DG-002 | Open | Unassigned | Choose the first actor-paid personal-original routes and an explicit enrollment allowlist. Keep unqualified media/provider routes excluded. | Each offered route has genuine admission → consumer → retained-byte evidence, including interrupted planner/media/storage boundaries; provider/model configuration matches that evidence. |
| DG-003 | Blocked — DG-001 | Unassigned | Promote the candidate schema through typed schema and reviewed migrations, first on an isolated database. | Exact schema checks and migration evidence pass on the selected environment; installation is explicit rather than opportunistic request handling. |
| DG-004 | Blocked — DG-001 | Unassigned | Implement host delivery and an independently scheduled sweep, bounded retries, acknowledgement handling and service authentication. Decide whether webhooks are needed. | Duplicate delivery, missed enqueue/ACK and due-row recovery pass. Execution is unavailable to browsers; any adopted webhook verifies signature, freshness, replay and original-request ownership. |
| DG-005 | Blocked — DG-002, DG-003, DG-004 | Unassigned | Wire the trusted server runtime into the authenticated Run chain and qualify hosted D1/R2 execution. | Existing authority/consent proofs remain intact; batch assertions, statement/binding limits, concurrent leases, deadlines, clock skew, dead letters and lost storage acknowledgements pass on the target host. |
| DG-006 | Open | Unassigned | Reconcile completion committed before job finalization; qualify original planner-response adoption and storage cleanup for each offered route. | Exact original completion/media receipts close bookkeeping without duplicate media, usage or paid submission. Unsupported states retain evidence and remain uncertain. |
| DG-007 | Open | Unassigned | Separate financial receipt reconciliation from private result recovery after source deletion or consent revocation. | Accounting can be reconciled without restoring erased private content or weakening current authority; exact original receipts remain the basis. |
| DG-008 | Open | Unassigned | Implement the durable stop command, downstream cancellation contract and accounting behavior. | Separate stop authority and race tests establish truthful cancellation/accounting; disconnect alone does not cancel, refund or resubmit work. |
| DG-009 | Open | Unassigned | Add source-free metrics, alerts and an audited operator reconciliation tool. | Operators can identify overdue work, expired leases, failed hints, repeated GET faults, uncertainty, unresolved exposure and orphan receipts without editing ownership/provider IDs manually. |
| DG-010 | Open | Unassigned | Define outbox/command-receipt retention with job/accounting history and qualify erasure, backup and restore. | Retention and privacy behavior are documented and tested; restore preserves original ownership and accounting evidence. |
| DG-011 | Blocked — qualified runtime and route prerequisites | Unassigned | Run a bounded, explicitly approved canary and the browser/device fault matrix, then record the rollout and rollback decision. | Browser close/offline/reload/BFCache and another authorized device recover the original result; retained media playback/download, accessible status, provider invoice/exposure/allowance checks and safe drain/pause pass. Exact source/schema/runtime/trigger versions are recorded. |

The [activation sequence](durable-generation-activation-2026-09-17.md#activation-sequence)
and [remaining acceptance work](durable-generation-activation-2026-09-17.md#remaining-acceptance-work)
define these gates. The [safe-pause contract](durable-generation-activation-2026-09-17.md#rollback-and-safe-pause)
continues to apply during rollout. Route-specific readiness must be recorded even
if a different route has already passed its canary.

## Other recorded follow-ups

These entries make existing work discoverable without treating old implementation
notes as current release status. The mini-app rows are reconciled in the
[original-plan status](forma-mini-app-original-plan-status-2026-09-17.md), which
records their continuation owner and separates published, local and activation
evidence. Reconcile newer receipts before implementing or closing an item.

| ID | Status | Owner | Work and next action | Completion evidence / source |
| --- | --- | --- | --- | --- |
| SP-001 | In progress — entry approval and launch terms pending | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | Sponsored Image. Preserve published inactive foundations and locally qualified intake/confirmation/read protection; complete the held authenticated host entry and finite Run/result/download composition. | [Current sponsor boundary and next actions](forma-mini-app-original-plan-status-2026-09-17.md#sponsored-generation-sp-001-and-sp-002). End-to-end qualification, reviewed schema/route installation and explicit payer/audience/caps are still required. A dormant client or passing native fixture is not activation. |
| SP-002 | In progress — recipe-specific work remains | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | The other seven sponsored recipes: Short story, Scene, Slides, Storyboard, Video, Audio and 3D. Finish each recipe's native authority, issuance, execution, settlement and finite supporting reads; retain the held Story/3D hooks. | [Recipe status](forma-mini-app-original-plan-status-2026-09-17.md#sponsored-generation-sp-001-and-sp-002) and [original issuer exclusions](forma-sponsor-issuer-2026-09-17.md#remaining-original-scope-work). Each offered recipe/input/provider mapping needs its own composed evidence. Image-first staging does not waive this original scope. |
| SH-001 | In progress — exact UI/retention approvals pending | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | Selected-output sharing. Preserve the local custody, byte-profile, lifecycle and publisher-control repairs; finish bounded original MP3 delivery integration and the held recipient/current-media/retention changes. | [Current sharing boundary](forma-mini-app-original-plan-status-2026-09-17.md#selected-output-sharing-sh-001). Complete review/publish/revoke, erasure, exact delivered-byte and recipient qualification before explicit schema/route activation and authorized actual-share acceptance. Creation remains disabled. |
| GS-001 | In progress — full claim and ingress unfinished | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | Guest source custody and same-Document claim. Reuse published source formation and local context/SAVE/lease/expiry/schema repairs; finish saved-output claim and confirmation/preflight stages, then complete generated-result/media custody and public ingress. | [Current guest boundary](forma-mini-app-original-plan-status-2026-09-17.md#guest-custody-gs-001). Truthful complete inventory, destination hydration, atomic completion/revocation, media-copy cleanup and bounded cookie/CSRF/origin ingress under approved retention/linking terms. Context-only adoption does not close this item. |
| QA-001 | Needs reconciliation | Unassigned | Reconcile the historical 3D production-readiness record with newer implementation and release receipts. | Locate or obtain hosted schema/executor, native account/archive and hardware GPU qualification; update the record and preserve any still-active test ownership holds. See [3D readiness](3d-production-readiness.md#qualification-boundaries) and [migration process](local-migrations.md). |
| QA-002 | In progress — devices and exact reference-image approval pending | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | Record missing physical-device/OS-input/assistive-technology and exact zoom/performance evidence; obtain human verdicts on the eight existing outputs; run only the separately authorized one-image 3D acceptance. | [Missing-only acceptance checklist](forma-mini-app-original-plan-status-2026-09-17.md#remaining-acceptance-qa-002). Existing desktop/RTL/keyboard/true 200% and software lifetime checks remain credited. Emulation is not a device pass; missing creative-review paperwork is not a product defect or permission to regenerate. |
| PLAN-001 | Needs reconciliation | Unassigned | Reconcile the [plan-coverage ledger](plan-coverage.md) with newer delivery evidence. Keep its unresolved policy, pilot and wider-rollout requirements visible here. | Resolve or link current evidence for the ledger's Phase 4 attribution/influence-taint decision, Phase 7 cited-chat and wider-rollout gates, Canvas C0–C3 collaboration gates, and accepted provider/index delivery debt. Split confirmed open work into stable child IDs; do not infer completion from unrelated releases. |

## Completed

Keep closure evidence here when moving a tracked item out of the active sections.
The backlog's initial population does not assign new IDs to already-completed
historical work; its evidence remains in the linked verification and plan records.
