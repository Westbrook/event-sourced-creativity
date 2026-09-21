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
| MEM-003 | Open — checkpoint shipped in production 435; native continuation on feature branch | Memory task (implementation); external owners unassigned | Follow the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md) and [merge-preparation record](forma-memory-native-continuation-2026-09-18.md): current-artifact consumption v2, bounded 64-pair capture, historical replay and shared Forget retirement are locally verified; [purpose controls](forma-memory-purpose-controls-2026-09-18.md) add separate consent/privacy/UI and [durable reference delivery](forma-memory-reference-delivery-2026-09-18.md) adds consent-bound queueing and catch-up; [native admission](forma-memory-native-admission-2026-09-18.md) adds exact reference leases and protected budget primitives; [source capture](forma-memory-native-source-capture-2026-09-18.md) adds complete personal/shared original text and bounded replay. [Financial execution](forma-memory-financial-execution-2026-09-18.md) now implements source-bound admission, single dispatch, verified settlement/no-dispatch recovery, organization erasure and cap/privacy controls. [Interrupted-work recovery](forma-memory-native-recovery-2026-09-18.md) adds bounded financial scanning, durable fairness and unfunded-lease backoff through the existing scheduled-event hook. [Read-only evidence](forma-memory-native-read-evidence-2026-09-18.md) separates fresh source access from spending authority. [Canonical manifests and publication receipts](forma-memory-native-manifests-2026-09-18.md) now bind all provider inputs and original retention to native source/usage proof; [durable private results](forma-memory-native-results-2026-09-18.md) now add atomic storage, complete inverse indexes, fresh reads, single-result withdrawal and privacy/expiry cascades through additive migration0047. [User controls, worker completion and localized review](forma-memory-user-controls-worker-2026-09-18.md) now implement cross-job correction/suppression/release, atomic completion watermarks, bounded dispatch/backoff and scoped processing snapshots through additive migrations0048–0049. [Byte-aware new-job windows, certified artifact observations and immediate lifecycle retirement](forma-memory-windows-artifacts-2026-09-18.md) now add native continuation and migration0050. [Legacy oversized-job subdivision](forma-memory-legacy-subdivision-2026-09-18.md) now preserves whole references and financial no-repurchase guarantees through the schema-only, hash-pinned trigger upgrade0051. [Bounded rolling original-backed history and newest-purpose review](forma-memory-rolling-history-2026-09-19.md) now add additive migration0052, downstream erasure and localized history boundaries. [Whole-request inspection qualification](forma-memory-native-read-budget-2026-09-19.md) now keeps the tested three-window free/paid reads below the conservative native request gate without dropping privacy checks. [Independent Chat Studio derivation](forma-memory-chat-studio-derivation-2026-09-19.md) now provides separately tracked registration/completion, native original proofs, rolling history and source/cause/privacy inverses through schema-only migration0053. [Native index lifecycle](forma-memory-native-index-intents-2026-09-19.md) adds atomic source-free intents, terminal erasure recovery and local queue diagnostics through additive migration0054; remote indexing/acknowledgements remain explicitly unqualified. [Historical personal artifact recertification](forma-memory-historical-artifact-consumption-2026-09-19.md) now preserves genuinely viewed old revisions through delayed delivery and explicit v3 private inspection without weakening current-view writing, legacy clients or original retention. Longer-term reconciliation, broader scopes/producers and automatic consumers remain implementation work; [the eight pre-existing Output request-budget failures are now fixed](forma-memory-native-output-budget-2026-09-19.md), as are the 117 paid-Scene depth failures. [Relationship privacy retirement](forma-memory-relation-retirement-2026-09-19.md) packages additive migration0055; [document-local relationship/endpoint certification](forma-memory-native-relationship-bindings-2026-09-19.md) is now implemented, with [genuine approved-copy evidence](forma-memory-approved-reuse-2026-09-19.md) now implemented through additive migration0056; independent original-source recall is still open. [Governed artifact views and v4 inspection](forma-memory-governed-artifact-consumption-2026-09-19.md) now preserve private actor presentation and exact source/current access with isolated D1 coverage. [Mixed artifact/approved-copy rolling qualification](forma-memory-mixed-history-budget-2026-09-19.md) keeps all three tested windows and up to twelve artifact views within the native request budget, including isolated shared/paid D1. [Native document-local block revision bindings](forma-memory-native-block-revisions-2026-09-19.md) now certify exact source histories and preserve supporting-event privacy inverses; library/canvas resources, original-source recall and broader consumers remain open. | [Automatic document briefs](forma-memory-document-brief-2026-09-19.md) now provide read-only summary/profile/suggestion consumers; automatic assistant/autocomplete publication and broader scope work remain open. [Bounded Creator/Chat Studio reconciliation](forma-memory-cross-producer-history-2026-09-19.md) now preserves original evidence and independent producer cursors. Each native pipeline has real caller/recovery/privacy evidence; PostgreSQL, hosted delivery/execution, provider qualification and explicit enrollment close only with their own receipts. |

Memory continuation checkpoint: [private text-edit review](forma-memory-edit-review-2026-09-20.md)
is implemented on the feature branch, including historical field binding and
privacy clearing. Applying suggestions, output ancestry and the other native
items in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md)
remain implementation work under MEM-003; they are not reclassified as external
services or rollout-only tasks. No main push, deployment or enrollment is claimed.

Memory continuation checkpoint: [control uploads and financial recovery](forma-memory-native-controls-recovery-2026-09-20.md)
are implemented and locally verified on the feature branch. All inspected Memory
mutation readers now have bounded, abortable uploads and strict decoding; recovery
avoids redundant no-op reads. Full execution capacity and the six native completion
workstreams remain open under MEM-003. This checkpoint does not claim main or
production integration, semantic profile consolidation, or user enrollment.

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

### MEM-003 rolling consumption inspector continuation

**In progress — Memory implementation task.** [7/30-day descriptive document/artifact/block windows](forma-memory-consumption-windows-2026-09-19.md) are implemented and locally verified inside the existing private inspector lease. The native consumer/scope list and external qualification gates remain open; no deployment or full-system completion is claimed.


### MEM-003 behavioral evidence continuation

**Bounded native integration implemented — local feature branch only.**
[Behavioral evidence and event-backed private controls](forma-memory-behavioral-evidence-2026-09-19.md)
now connect the strict v2 recipe to separately qualified original/action consent,
native capture and suppression, provider/result manifests, atomic mixed control
targets, localized evidence and scheduled-event processing. Additive migration0057
remains unapplied. No v1 grant is broadened and no user/provider is activated.
Broader cross-scope/long-term reconciliation, nested scopes, Library/Canvas and
automatic assistant/autocomplete consumers remain implementation work; hosted
qualification and enrollment remain separate operational gates.

### MEM-003 private result export continuation

[Fresh private semantic-result export](forma-memory-result-export-2026-09-19.md) is implemented and locally verified: a new native access check for each explicit download, separate quotations/actions, bounded snapshot disclosure and localized copy-retention warning. This is neither all-memory export nor production activation. Remaining native scope/reconciliation/consumer work stays open.

[Manual private review lifetimes](forma-memory-review-lifetime-2026-09-19.md) now retire result/correction presentation and stalled reads on monotonic expiry or clock anomalies. This locally verified privacy fix does not close broader scope/reconciliation/consumer implementation.

[Native resource rename observations](forma-memory-resource-renames-2026-09-19.md) now include genuine document/block renames as descriptive edits, with strict export/origin compatibility and exact native block versions. Names remain outside model quotation inputs. Broader resource identity and automatic consumers remain implementation work.

## Native project containment continuation — 2026-09-19

[Native project containment](forma-memory-project-containment-2026-09-19.md) now implements same-owner nesting, reparenting/detach, independent parent access, transactional stale-edit rejection, schema/privacy inverses and localized Projects controls. Additive migration0058 is unapplied; no deployment or enrollment occurred.

Still native implementation: ancestry-backed semantic recall and its durable move/erasure inverses, cross-owner hierarchy, broader resource identities/history, cross-document/long-term reconciliation and durable assistant/autocomplete consumers. Existing document-only Memory contracts are not broadened by this feature. External adapters/scheduling and operational qualification remain separately tracked; the full plan is not complete.

## Native cross-scope Memory recall continuation — 2026-09-19

[Source-side recall consent and hierarchy-backed private consumers](forma-memory-cross-scope-recall-2026-09-19.md) implement explicit project/tree/partition ranges, default document isolation, independent native source/target proofs, newest-result withdrawal handling, localized previews and automatic nearest-source document briefs. Migration0059 is additive and unapplied; no users were enrolled and nothing was deployed. The [remaining native implementation list](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope) still includes long-term semantic reconciliation, broader resource learning and durable assistant/autocomplete publication. These are implementation tasks, not external-service excuses. Remote infrastructure, hosted qualification and rollout remain in the separate [capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).

Memory cross-scope integration qualification: historical pagination and explicit latest
reads are separate, native target-only recall works without a processing grant, and
pilot/cancellation deadlines are enforced. [Verified behavior and open scope](forma-memory-cross-scope-recall-2026-09-19.md#end-to-end-integration-qualification).
The complete Memory plan remains open; no production activation is implied.

## Memory saved-context and page continuation — 2026-09-20

[Saved assistant references and canonical document pages](forma-memory-saved-context-pages-2026-09-20.md) implement private native selection controls, reference retirement, localized review, genuine governed page encounters and exact per-view derivation provenance. Migration0060 is unapplied. Automatic prompt/answer integration, field autocomplete, long-term reconciliation and the broader native scopes remain planned implementation, not external-service blockers. No production activation occurred.


[Transactional saved-reference retirement](forma-memory-saved-context-pages-2026-09-20.md#transactional-reference-retirement-and-immediate-ui-clearing)
now covers boundary/hierarchy changes, result withdrawal and claim controls,
with immediate browser privacy invalidation. This is local branch work, not a
release. Broader automatic assistant/autocomplete, long-term reconciliation,
Library/Canvas/cross-owner scopes and integration qualification remain tracked
in the native continuation; external scheduling/provider/index qualification
and enrollment remain separate gates.

## MEM-003 contextual profile and consumer privacy — 2026-09-20

**In progress — Memory implementation task.** [Contextual retained profiles, native resource evidence and privacy integration](forma-memory-contextual-profile-2026-09-20.md) add original-backed page/block differentiation, bounded retained-profile review, separately weighted project/tree/partition notes, 1/7/30/90-day consumption and cross-tab/assistant-transcript privacy clearing. Locally verified feature-branch work; no deployment or enrollment. Continue the explicit native implementation list in that record. Hosted/external work remains in the capability To Do and non-implementation checklist; it is not a reason to defer the remaining native code.

[Current main integration and migration history](forma-memory-main-reconciliation-2026-09-20.md) preserves upstream Still history and all existing SQL bytes, with a tested, ordered Memory continuation. This does not apply migrations or close remaining native implementation.


[Native saved-context source evidence](forma-memory-native-consumer-source-2026-09-20.md)
now supplies the shared opaque source preparation and transactional replay used
by the existing authenticated reference reader. This is not generated-answer or
edit publication. The [consolidated completion matrix](forma-memory-completion-matrix-2026-09-20.md)
keeps every remaining native workstream distinct from external/operational gates.

## MEM-003 private processing diagnostics — 2026-09-20

[Native queue, recovery and completion-timing diagnostics](forma-memory-processing-health-2026-09-20.md) are implemented through the actual private results API and localized Memory review controls, with bounded display lifetime and no extra database requests. Verified locally; not deployed. The [full completion matrix](forma-memory-completion-matrix-2026-09-20.md) remains open for native consumer, autocomplete, profile, resource and downstream lifecycle implementation. External/operational gates remain in the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md) and [non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md).

## MEM-003 retained profile history — 2026-09-20

[Native retained-profile paging and interpretation review](forma-memory-profile-history-2026-09-20.md) now support 16 freshly validated results per page and explicit older-page traversal, exact-claim revision/counterevidence disclosure, localized keyboard controls and privacy clearing. The [completion matrix](forma-memory-completion-matrix-2026-09-20.md) remains the implementation checklist; longer-term semantic consolidation and durable assistant/autocomplete consumers are not closed by this review feature. External services and rollout remain separately tracked.

### Memory-assisted specialist consumer checkpoint

[Native semantic assistant consumption](forma-memory-semantic-assistant-2026-09-20.md)
now includes an explicit free quote choice, exact paid approval, private generated
result provenance, historical review and source-dependent erasure. Capacity and
semantic follow-up/Chat Studio integration remain implementation work; do not
mark the [full completion matrix](forma-memory-completion-matrix-2026-09-20.md)
complete or merge-ready based on this slice. No production deployment or real
enrollment occurred. External/operational items stay in the linked capability
and non-implementation To Do documents.

### Memory original-conversation lifecycle

[Implemented input erasure and multi-turn D1 integration](forma-memory-conversation-lifecycle-2026-09-20.md)
records the additive migration, completed privacy checks and rollout transition.
Remaining native implementation stays in the Memory completion matrix; external
services, qualification and enrollment remain in the Sites capability checklist.

## MEM-003 semantic follow-up — 2026-09-20

[Bounded semantic follow-up](forma-memory-semantic-followup-2026-09-20.md) is implemented on the feature branch: actual prompt inputs, dependent-answer retirement and non-resurrection. Track migration0063’s non-additive trigger upgrade explicitly in owner/hosted review. No deployment or enrollment is claimed; continue every open row of the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).

### MEM-003 Chat Studio guidance checkpoint

[Read-only embedded Memory guidance](forma-memory-chat-guidance-2026-09-20.md) is implemented and locally tested on the Memory branch. The [full native completion matrix](forma-memory-completion-matrix-2026-09-20.md) remains authoritative; creative-edit/output ancestry, autocomplete, long-term consolidation, resource coverage and integrated capacity are still implementation work. External provisioning, owner deployment and affirmative enrollment remain separate To Do gates.

### MEM-003 native capacity and response bounds

[Lease-preserving dispatch continuation, metadata snapshots and bounded provider reads](forma-memory-native-capacity-2026-09-20.md) are implemented with local native/D1/privacy evidence. Conservative whole-invocation capacity still requires work; external hosted qualification is separately tracked. No real provider, deployment or user enrollment was activated.

### MEM-003 native request and block-history boundaries

[Incoming control upload limits](forma-memory-native-capacity-2026-09-20.md#incoming-control-message-bounds) and [structured-block inspection integration](forma-memory-block-inspection-2026-09-19.md#structured-block-history-integration--2026-09-20) are implemented and locally verified. Native inspection remains read-authorized and cannot repair stale project projections. Continue all remaining consumer/profile/resource/lifecycle work in the completion matrix; no deployment, scheduler registration or real-user enrollment occurred.

### MEM-003 native field Undo coverage

[Closed native Undo/Redo histories](forma-memory-native-field-undo-2026-09-20.md) are now supported by Document Memory inspection, with exact custody/private-body replay and historical invalidation. The complete context-controls suite also passes after reconciling its stale navigation port. The subsequently reproduced shared-block-removal restoration gap is now also fixed using a guarded historical proof and exact D1-aware write receipts. Final native/project D1 verification:294/294 pass. Current resource authorization remains mandatory; the other completion-matrix work stays in scope.

### MEM-003 native resource ancestry

[Resource-specific content/event provenance](forma-memory-asset-ancestry-2026-09-20.md)
adds migration0064, existing assistant publication registration, private-event inheritance and bounded descendant retirement. Authored records are
explicitly excluded so Memory disable cannot erase them. Root accepted-edit publication, event-reader/browser lifecycle, output/index
callers and the other [native workstreams](forma-memory-completion-matrix-2026-09-20.md)
remain implementation work on this task. No deployment, external service or real
user enrollment is claimed.

### MEM-003 explicit authored Memory edits

[Accepted text authoring and non-destructive provenance](forma-memory-authored-edits-2026-09-20.md)
connect reviewed suggestions to actual Document Assistant and embedded Chat
approval, atomic personal/shared writes, canonical Undo/Redo and downstream
assistant prompt disclosure. Memory withdrawal does not erase authored edits.
Continue autocomplete, profile consolidation, full resource/reuse/output coverage
and qualification in the [native completion matrix](forma-memory-completion-matrix-2026-09-20.md).
External qualification and rollout remain tracked separately; no production or
user enrollment is claimed.

### Memory inline field consumer and generic-reader privacy — 2026-09-20

Implemented [exact-field saved suggestion reuse](forma-memory-field-completion-2026-09-20.md) in the actual Document editor, with canonical acceptance/Undo and draft/IME/privacy retirement. Ordinary event feeds no longer hydrate marked private inference. Native and browser evidence is in the checkpoint. [Remaining native work](forma-memory-completion-matrix-2026-09-20.md) stays assigned; [external qualification and rollout](forma-memory-sites-capability-todo-2026-09-18.md) remains separate. No deployment or enrollment.

### Memory authored-copy attribution — 2026-09-20

[Approved copies and document duplication](forma-memory-authored-copy-provenance-2026-09-20.md) now retain negative Memory attribution in the native reviewed authoring transaction, without copying private support or creating erasure dependencies. Verified locally; original-source recall and the other native completion-matrix work remain assigned.

### MEM-003 source-backed profile consolidation

[Profile consolidation](forma-memory-profile-consolidation-2026-09-20.md) adds a separately qualified original-evidence recipe for tentative revision/contradiction relationships, exact anchor lineage, native correction/retirement and localized review/export. Continue the remaining native consumers, resource zooms, promotion and integrated qualification in the completion matrix. No deployment or enrollment.

### MEM-003 authored downstream attribution

[Downstream attribution](forma-memory-authored-downstream-2026-09-20.md) now survives canonical Output/Canvas context, legacy creative-chat mutations/history and optional preview direction. Legacy taste inference cannot count assisted descendants as independent evidence or revive them through an old cached model. Authored work survives withdrawal. Direct private-semantic output integration remains separate work.

### MEM-003 exact current-source dispatch

[Exact dispatch binding](forma-memory-exact-dispatch-source-2026-09-20.md) covers private-body and custody changes that do not advance the event head. Verified with 166 native regressions and actual local D1; the [completion matrix](forma-memory-completion-matrix-2026-09-20.md) remains assigned and external operational work stays separately tracked.

### MEM-003 request snapshot and analytics consistency — 2026-09-21

[Initial authority snapshot](forma-memory-native-capacity-2026-09-20.md#exact-initial-authority-snapshot--2026-09-21) reduces complete synthetic execution to 123/133 calls without caching access. [Preference metrics](forma-memory-authored-downstream-2026-09-20.md#analytics-consistency--2026-09-21) now exclude the same assisted evidence as the active profile. The capacity target and remaining native matrix stay assigned.

### MEM-003 extracted reference field history — 2026-09-21

[Native extraction and focal-point histories](forma-memory-extracted-block-history-2026-09-21.md) now support actual document inspection, consumption capture and Undo with complete scoped sources. 271 native resource tests pass; Library/Canvas Memory identities and the remaining matrix remain assigned.

Memory capacity follow-up (2026-09-21): [current-source ancestry proof](forma-memory-native-capacity-2026-09-20.md#shared-current-source-ancestry-proof--2026-09-21) reduces complete synthetic execution to120/130 personal/shared binding calls;71 focused tests pass. Native capacity remains assigned and above target; no deployment or hosted qualification.

Memory field/history follow-up (2026-09-21): [bounded saved history and final delivery](forma-memory-field-completion-2026-09-20.md#bounded-history-and-final-delivery--2026-09-21) now preserve eligible older suggestions across unrelated later answers, and close final-serialization expiry in task/inline/quote/retrieval responses.20 focused checks include real isolated D1; no new provider call, enrollment or deployment. Remaining native scope stays assigned in the completion matrix.

Memory recovery capacity (2026-09-21): [canonical pointer/body snapshot](forma-memory-native-capacity-2026-09-20.md#canonical-result-snapshot--2026-09-21) preserves unavailable-result/no-repurchase behavior while reducing execution to116/126 and retrieval to36/36 synthetic binding calls.301 native regressions pass; native capacity remains above target and assigned.

Memory continuation (2026-09-21): original Assistant uploads now have strict
byte/encoding/key/deadline/cancellation validation before persistence; see
[exact original ingress](forma-memory-native-capacity-2026-09-20.md#exact-original-chat-ingress--2026-09-21).
The native completion matrix remains assigned; next work is fresh field-bound
suggestion generation through existing explicit spending and publication review.

Memory continuation (2026-09-21): [fresh exact-field suggestions](forma-memory-fresh-field-generation-2026-09-21.md)
now have an actual editor caller, saved field/revision/hash binding, explicit cost
review, provider alias restriction and separate canonical replacement acceptance.
Native personal/shared D1 withdrawal preserves accepted text. Automatic background
completion, broader resources/reuse and all other completion-matrix native work
remain assigned; no deployment, scheduling or enrollment is implied.

Memory accounting continuation (2026-09-21): [paired native settlement](forma-memory-paired-settlement-2026-09-21.md)
now records observed usage before atomically settling both ledgers, preserves
recoverable authorized responses across accounting interruption, and recovers after
withdrawal without repurchase.28 focused checks include isolated D1; complete
execution is111/119 binding calls. Remaining native work stays in the completion
matrix; external qualification and rollout are separately tracked.

Memory current-source continuation (2026-09-21): [exact local-source handoff](forma-memory-native-capacity-2026-09-20.md#exact-local-source-dispatch-handoff--2026-09-21)
removes repeated body compilation and competing202 recovery while preserving
fresh policy and transactional source/access checks. Exact field/custody mutation
with an unchanged event head is denied, and actual D1 three-generation recovery
passes. Whole execution is98/102 calls; the native capacity target and remaining
resource/profile/consumer work stay assigned, separately from external rollout.

Memory organization continuation (2026-09-21): [explicit cross-owner recall](forma-memory-organization-recall-2026-09-21.md)
now reaches native private previews, saved contexts, document briefs and the
approved specialist prompt through independent source/target project authority.
Additive migration0065 never broadens existing partition consent. Withdrawal
retires private copies without deleting usage, and the actual consent control now
survives its own privacy barrier while hidden/inert. Native matrix work remains
in progress; this is local implementation, not deployment or enrollment.

Memory atomic-publication continuation (2026-09-21): [native completion and recovery](forma-memory-native-capacity-2026-09-20.md#atomic-fresh-result-publication--2026-09-21)
now atomically retains the fresh private answer, its inverse dependencies and task
receipts.436 native regressions pass; whole synthetic execution is88/90 calls.
Native capacity and the other MEM-003 completion-matrix work stay assigned.

Memory nesting continuation (2026-09-21): [owner-qualified project hierarchy](forma-memory-cross-owner-nesting-2026-09-21.md)
now supports independently authorized organization parents through the actual UI,
combined native cycle/depth checks, explicit-consent-only recall and durable
private-use retirement. MEM-003 remains In progress for its other native
completion-matrix requirements. Additive0066 still needs production integration.

## MEM-026 — Pre-authorized saved-field proposals

**In progress — Memory implementation task.** [Background plain-text suggestions](forma-memory-background-fields-2026-09-21.md) now connect separately qualified source consent, native capture/job/accounting/private publication and the actual inline editor’s explicit application with non-destructive authored provenance. Focused native/D1, model/control and browser checks pass; the broader native regression passes613/613. Continue the remaining native workstreams in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md). Hosted schedule registration, real-provider qualification and affirmative enrollment remain tracked separately; no production activation is claimed.

## MEM-027 — Native Memory approval and paired budget admission

Implemented locally: single-use native approval compilation with fresh atomic
source/access replay, paired token/dollar reservation, exact compiled Document
authorization, atomic publication-row acknowledgement and admission-bound,
SQLite-byte-limited result reads. Current whole execution is 67/71 personal/shared
calls, still above the conservative 50-call target. See
[versioned capacity evidence](forma-memory-native-capacity-2026-09-20.md#native-approval-replay-and-paired-admission--2026-09-21)
for distinct regression checkpoints and the 2,188-test admission full run. Types, changed-worker
lint and build pass. MEM-003 and the full native completion matrix remain assigned;
no deployment or enrollment occurred. Background-field checkpoint `0bc453f9`
separately passes the full 2,125-test runtime suite.

## MEM-028 — Exact saved fields and bounded profile loading

Implemented locally: [multiline/typed plain-text field coverage](forma-memory-background-fields-2026-09-21.md#exact-multiline-fields-and-typed-metadata)
and [bounded concurrent retained-profile reads](forma-memory-profile-history-2026-09-20.md#bounded-automatic-reads--2026-09-21).
The exact saved value survives request/review/application; protected and disabled
fields stay excluded. Whole-brief timeout, cancellation and four-read concurrency
retain original expiry, source order and no older fallback on failure. Native,
client/component and field browser checks pass; all eight English/Arabic profile
and rolling-summary browser journeys also pass. All other native completion-matrix requirements stay assigned here.
External scheduling/provider/rollout gates are unchanged; no production activation.
