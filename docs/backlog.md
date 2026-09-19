# Forma backlog

Central entry point for unfinished delivery work. Mini-app task reconciliation
updated **2026-09-18** against its completed R22 / production 421 delivery.
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

## Memory

The Memory branch was reconciled with local `main` on 2026-09-17. Source delivery,
production qualification and the full scope-aware expansion remain distinct.
See the [current implementation reconciliation](forma-memory-implementation-2026-09-17.md)
and the **[remaining non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md)**.

| ID | Status | Owner | Remaining work / next action | Done when |
| --- | --- | --- | --- | --- |
| MEM-001 | Open — depends on qualified implementation | Unassigned | Complete the linked non-implementation checklist: release review, hosted scheduling/privacy qualification, bounded synthetic benchmark and cap decision, acceptance and explicit consent. | Evidence closes every applicable gate for the exact deployed source/runtime/audience. No real-user enrollment before qualification and affirmative consent. |
| MEM-002 | Open — verified foundation shipped through production 435 | Unassigned | Follow the [completion/release To Do](forma-memory-release-2026-09-18.md) and [native producer follow-up](forma-memory-native-producers-2026-09-18.md) with genuine semantic summary/profile derivation, native index lifecycle, nested scope identity, consumption v2 and learned suggestions. Bounded Chat Studio capture and exact personal artifact receipts do not complete these pipelines. Reconcile active owners before splitting work. | Native producers, storage, guarded consumers, recovery and privacy tests exist for every claimed part of the original plan. Synthetic foundations and detached adapters alone are not completion. |
| MEM-003 | Open — checkpoint shipped in production 435; native continuation on feature branch | Memory task (implementation); external owners unassigned | Follow the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md) and [merge-preparation record](forma-memory-native-continuation-2026-09-18.md): current-artifact consumption v2, bounded 64-pair capture, historical replay and shared Forget retirement are locally verified; [purpose controls](forma-memory-purpose-controls-2026-09-18.md) add separate consent/privacy/UI and [durable reference delivery](forma-memory-reference-delivery-2026-09-18.md) adds consent-bound queueing and catch-up; [native admission](forma-memory-native-admission-2026-09-18.md) adds exact reference leases and protected budget primitives; [source capture](forma-memory-native-source-capture-2026-09-18.md) adds complete personal/shared original text and bounded replay. [Financial execution](forma-memory-financial-execution-2026-09-18.md) now implements source-bound admission, single dispatch, verified settlement/no-dispatch recovery, organization erasure and cap/privacy controls. [Interrupted-work recovery](forma-memory-native-recovery-2026-09-18.md) adds bounded financial scanning, durable fairness and unfunded-lease backoff through the existing scheduled-event hook. [Read-only evidence](forma-memory-native-read-evidence-2026-09-18.md) separates fresh source access from spending authority. [Canonical manifests and publication receipts](forma-memory-native-manifests-2026-09-18.md) now bind all provider inputs and original retention to native source/usage proof; [durable private results](forma-memory-native-results-2026-09-18.md) now add atomic storage, complete inverse indexes, fresh reads, single-result withdrawal and privacy/expiry cascades through additive migration0047. [User controls, worker completion and localized review](forma-memory-user-controls-worker-2026-09-18.md) now implement cross-job correction/suppression/release, atomic completion watermarks, bounded dispatch/backoff and scoped processing snapshots through additive migrations0048–0049. [Byte-aware new-job windows, certified artifact observations and immediate lifecycle retirement](forma-memory-windows-artifacts-2026-09-18.md) now add native continuation and migration0050. [Legacy oversized-job subdivision](forma-memory-legacy-subdivision-2026-09-18.md) now preserves whole references and financial no-repurchase guarantees through the schema-only, hash-pinned trigger upgrade0051. [Bounded rolling original-backed history and newest-purpose review](forma-memory-rolling-history-2026-09-19.md) now add additive migration0052, downstream erasure and localized history boundaries. [Whole-request inspection qualification](forma-memory-native-read-budget-2026-09-19.md) now keeps the tested three-window free/paid reads below the conservative native request gate without dropping privacy checks. [Independent Chat Studio derivation](forma-memory-chat-studio-derivation-2026-09-19.md) now provides separately tracked registration/completion, native original proofs, rolling history and source/cause/privacy inverses through schema-only migration0053. [Native index lifecycle](forma-memory-native-index-intents-2026-09-19.md) adds atomic source-free intents, terminal erasure recovery and local queue diagnostics through additive migration0054; remote indexing/acknowledgements remain explicitly unqualified. [Historical personal artifact recertification](forma-memory-historical-artifact-consumption-2026-09-19.md) now preserves genuinely viewed old revisions through delayed delivery and explicit v3 private inspection without weakening current-view writing, legacy clients or original retention. Longer-term reconciliation, broader scopes/producers and automatic consumers remain implementation work; eight pre-existing Output request-budget failures remain tracked, while the 117 paid-Scene depth failures are fixed. [Relationship privacy retirement](forma-memory-relation-retirement-2026-09-19.md) packages additive migration0055; [document-local relationship/endpoint certification](forma-memory-native-relationship-bindings-2026-09-19.md) is now implemented, with [genuine approved-copy evidence](forma-memory-approved-reuse-2026-09-19.md) now implemented through additive migration0056; independent original-source recall is still open. [Governed artifact views and v4 inspection](forma-memory-governed-artifact-consumption-2026-09-19.md) now preserve private actor presentation and exact source/current access with isolated D1 coverage. [Mixed artifact/approved-copy rolling qualification](forma-memory-mixed-history-budget-2026-09-19.md) keeps all three tested windows and up to twelve artifact views within the native request budget, including isolated shared/paid D1. [Native document-local block revision bindings](forma-memory-native-block-revisions-2026-09-19.md) now certify exact source histories and preserve supporting-event privacy inverses; library/canvas resources, original-source recall and broader consumers remain open. | [Automatic document briefs](forma-memory-document-brief-2026-09-19.md) now provide read-only summary/profile/suggestion consumers; automatic assistant/autocomplete publication and broader scope work remain open. [Bounded Creator/Chat Studio reconciliation](forma-memory-cross-producer-history-2026-09-19.md) now preserves original evidence and independent producer cursors. Each native pipeline has real caller/recovery/privacy evidence; PostgreSQL, hosted delivery/execution, provider qualification and explicit enrollment close only with their own receipts. |

## Other recorded follow-ups

The mini-app rows below separate completed published subscopes from unfinished
requirements. No mini-app implementation is currently active; an assigned
continuation owner does not mean work is running. The
[original-plan status](forma-mini-app-original-plan-status-2026-09-17.md) records
the exact held patches, twelve pending decisions and missing acceptance checks.
R22 is delivered; it is not an outstanding integration or publication task.
QA-001, PLAN-001 and the DG activation rows retain their separate scope and ownership.

| ID | Status | Owner | Work and next action | Completion evidence / source |
| --- | --- | --- | --- | --- |
| SP-001 | Blocked — sponsor launch terms and activation acceptance | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | Sponsored Image host entry and bounded dormant composition are accepted and published. Resolve payer, audience, caps and identity/retention terms, then qualify the explicitly offered activation scope. | [Sponsor boundary](forma-mini-app-original-plan-status-2026-09-17.md#sponsored-generation-sp-001-and-sp-002). Reuse accepted host/Run/read evidence. Actual activation requires the agreed route/schema and acceptance gates; browser-absent sponsored Run has the separate actor/payer runtime dependency. |
| SP-002 | Blocked — exact recipe patches and launch terms | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | Resolve Story result/status hooks, Storyboard final-storage settlement, Video financial repair and 3D dispatcher decisions; apply approved patches and qualify affected boundaries, including dependent Scene/Slides finite reads. Preserve accepted issuance and Audio review/authorization increments. | [Recipe status and future integration](forma-mini-app-original-plan-status-2026-09-17.md#sponsored-generation-sp-001-and-sp-002). Each offered recipe retains its own execution/result/settlement and activation boundary. Audio review/authorization does not establish Audio Run/provider/result/recovery acceptance. |
| SH-001 | Blocked — recipient, current-Document and retention patches | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | MP3 delivery and the accepted sharing foundations are published. Resolve the three exact held patches, then qualify offered recipient/revoke/expiry/erasure composition and applicable provenance disclosure. | [Sharing boundary](forma-mini-app-original-plan-status-2026-09-17.md#selected-output-sharing-sh-001). Creation stays disabled until explicit activation and authorized actual-share acceptance; publishing dormant source or packaging SQL0040 is not activation. |
| GS-001 | Blocked — Image API/outer integration and launch terms | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | Native inventory, claim → adoption → Save → fresh Check → revision 1 and direct supplier ports are accepted and published. Resolve exact Image API patch `906d6f64`, then qualify held API/route/client composition, missing retention/expiry/capacity boundaries and approved ingress. | [Guest boundary](forma-mini-app-original-plan-status-2026-09-17.md#guest-custody-gs-001). Preserve original identity/payer history and accepted bytes. Native success does not establish complete generated custody, public ingress or activation. |
| QA-001 | Needs reconciliation | Unassigned | Reconcile the historical 3D production-readiness record with newer implementation and release receipts. | Locate or obtain hosted schema/executor, native account/archive and hardware GPU qualification; update the record and preserve any still-active test ownership holds. See [3D readiness](3d-production-readiness.md#qualification-boundaries) and [migration process](local-migrations.md). |
| QA-002 | Open — missing acceptance; device/cohort/reference decisions pending | [Original-plan continuation](forma-mini-app-original-plan-status-2026-09-17.md#ownership-and-release-boundary) | Obtain named physical-device/OS-input/AT operators and field-performance cohort/budget; record human verdicts on the eight retained files. Resolve the exact one-image 3D transfer/spend decision before that case. Preserve the unresolved Storyboard whole-button Tab observation for focused disposition. | [Missing-only checklist](forma-mini-app-original-plan-status-2026-09-17.md#remaining-acceptance-qa-002). Allocated 400%/200%-text desktop segments are dispositioned, not awaiting a blanket rerun; historical failures remain. Emulation is not device evidence and missing creative verdicts do not authorize regeneration. |
| PLAN-001 | Needs reconciliation | Unassigned | Reconcile the [plan-coverage ledger](plan-coverage.md) with newer delivery evidence. Keep its unresolved policy, pilot and wider-rollout requirements visible here. | Resolve or link current evidence for the ledger's Phase 4 attribution/influence-taint decision, Phase 7 cited-chat and wider-rollout gates, Canvas C0–C3 collaboration gates, and accepted provider/index delivery debt. Split confirmed open work into stable child IDs; do not infer completion from unrelated releases. |

## Completed

The scopes below are complete within their recorded limits. Parent SP/SH/GS/QA
IDs remain open for the specific work above; these closures do not mean whole-plan
completion. The [421 publication receipt](evidence/forma-mini-app-publication-421.json)
records source `282236d28473fd5a53d9c2ce38ed89e882368c82`, successful deployment,
unchanged audience and excluded activation/spend. Earlier snapshots and failures
remain in Git and the independent report.

| Completed scope | Closure evidence and boundary |
| --- | --- |
| Eight technical live journeys; ordinary signed-in custody, authorization, caps and original-result recovery | [Acceptance account](forma-mini-app-original-plan-status-2026-09-17.md#requirement-to-evidence-account). Image, Short story, Scene, Slides, Storyboard, Video, Audio and text-only 3D retain generated results, same-Document editing/reopening and downloaded files. Do not repeat them. |
| Bounded audit repairs and governed maintenance | Memory/harness repairs in 369; review/governance/UI/localization/startup work through 374; image-mode 3D recovery in 375; upload lifetime in 389; subsequent fork/Project, focus, Slides and current Image model/API repairs included by R22/421. Exact scope is in the [acceptance account](forma-mini-app-original-plan-status-2026-09-17.md#requirement-to-evidence-account). |
| Accepted dormant sponsor increments under SP-001/SP-002 | Image host and user-approved Story intake, Scene/Slides composition, and Audio Prepare/Review/Authorize/original replay and rollback are delivered. [Recipe limits](forma-mini-app-original-plan-status-2026-09-17.md#sponsored-generation-sp-001-and-sp-002) retain the unfinished patches and activation boundaries. |
| Accepted sharing increments under SH-001 | Text/media lifecycle, custody/read/publisher controls and bounded original MP3 delivery adapter are delivered. [Recipient/eligibility/retention work remains](forma-mini-app-original-plan-status-2026-09-17.md#selected-output-sharing-sh-001). |
| Accepted guest increments under GS-001 | Source/lease/SAVE/admission/foreground replay, result inventory, native claim/adoption/edit chain and four direct supplier-port groups are delivered. [Outer API/route/client integration and acceptance remain](forma-mini-app-original-plan-status-2026-09-17.md#guest-custody-gs-001). |
| Allocated desktop checks under QA-002 | Bounded touch/RTL/keyboard, native 200% zoom, selected 400% and allocated 200%-text checks are dispositioned. [Limits and historical Storyboard Tab failure](forma-mini-app-original-plan-status-2026-09-17.md#remaining-acceptance-qa-002) remain visible. |
| Legacy/current-source harness and final R22 delivery | Focused extraction, Response identity, Video fixture, D1 compound-limit and Audio host-fixture repairs are accepted; historical failures remain. All accepted R22 supplier entries are integrated and published in 421. No R22 merge, build or publication step remains. |

### MEM-003 native document block inspection continuation

**In progress — Memory implementation task.** [Native block inspection and private v5 consumption](forma-memory-block-inspection-2026-09-19.md) now implement genuine actor-private receipt publication, consented bounded capture, descriptive review, original-backed derivation and source erasure. Local feature branch only. Continue the [remaining native scope/consumer work](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope); hosted/external gates remain separate in the [capability To Do](forma-memory-sites-capability-todo-2026-09-18.md). No all-system completion or deployment claim.
