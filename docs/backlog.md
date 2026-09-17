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
notes as current release status. Owner assignments are not yet recorded in this
repo index. Reconcile active branches and receipts before splitting or closing an
item; retain its ID when adding a more detailed checklist.

| ID | Status | Owner | Work and next action | Completion evidence / source |
| --- | --- | --- | --- | --- |
| SP-001 | Needs reconciliation | Unassigned | Sponsored Image entry and end-to-end qualification. Reconcile active transport/entry work with the committed dormant foundation, then list the actual remaining activation gates. | Authenticated entry/host wiring, every offered read/result/download path, reviewed schema/policy installation and approved payer/audience/allowance/browser acceptance. See [client handoff](forma-sponsor-intake-client-2026-09-17.md), [issuer remaining scope](forma-sponsor-issuer-2026-09-17.md#remaining-original-scope-work), and [read approval](forma-sponsor-read-approval-2026-09-17.md). |
| SH-001 | Needs reconciliation | Unassigned | Selected-output sharing. Reconcile the current media/privacy work with the detached lifecycle and record the remaining public delivery gates. | Native media custody, delivered-byte manifests, review/publish/revoke and recipient UI, erasure, route/schema activation and actual sharing/device acceptance. See [sharing gates](forma-selected-output-share-2026-09-17.md#media-and-activation-still-open). |
| GS-001 | Needs reconciliation | Unassigned | Guest source custody, same-Document claim and public ingress. Reconcile current adoption/context work before assigning missing pieces. | Native inventory and truthful adoption receipts, destination hydration, atomic claim completion/revocation, media-copy handling, private-event expiry and bounded cookie/CSRF/origin ingress under approved retention terms. See [guest source](forma-guest-source-2026-09-17.md#next-custody-integration) and [claim lease](forma-guest-claim-lease-2026-09-17.md#next-native-custody-work). |
| QA-001 | Needs reconciliation | Unassigned | Reconcile the historical 3D production-readiness record with newer implementation and release receipts. | Locate or obtain hosted schema/executor, native account/archive and hardware GPU qualification; update the record and preserve any still-active test ownership holds. See [3D readiness](3d-production-readiness.md#qualification-boundaries) and [migration process](local-migrations.md). |
| QA-002 | Open | Unassigned | Complete the remaining physical-device/assistive-technology, human creative-quality and authorized reference-image 3D acceptance. Confirm the exact scoped matrix with the current acceptance owner before running it. | Retain portable acceptance receipts for each outstanding gate and preserve already-accepted journeys. These remaining gates were confirmed by the original-plan owner on 2026-09-17; see the [browser guide](../tests/browser/README.md) and [3D readiness boundaries](3d-production-readiness.md#qualification-boundaries) for existing test limitations. |
| PLAN-001 | Needs reconciliation | Unassigned | Reconcile the [plan-coverage ledger](plan-coverage.md) with newer delivery evidence. Keep its unresolved policy, pilot and wider-rollout requirements visible here. | Resolve or link current evidence for the ledger's Phase 4 attribution/influence-taint decision, Phase 7 cited-chat and wider-rollout gates, Canvas C0–C3 collaboration gates, and accepted provider/index delivery debt. Split confirmed open work into stable child IDs; do not infer completion from unrelated releases. |

## Completed

Keep closure evidence here when moving a tracked item out of the active sections.
The backlog's initial population does not assign new IDs to already-completed
historical work; its evidence remains in the linked verification and plan records.
