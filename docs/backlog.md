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

## Library thumbnails

| ID | Status | Owner | Remaining work / next action | Done when |
| --- | --- | --- | --- | --- |
| LIB-THUMB-001 | Done — cross-media qualification; publication tracked in report | Library thumbnail task | One responsive 3:2 frame for images, fans, video covers, storyboards and native artifact summaries. Raster previews use saved or locally calculated focal points with cover cropping. See [component guidance](components.md). | Chromium checks at 1440/768/390/320px cover frame parity, video placeholders, saved/local focal placement, retained WebP covers, and uncropped full-image dialogs. Publication and user review remain distinct in the report. |

## Validation efficiency

| ID | Status | Owner | Remaining work / next action | Done when |
| --- | --- | --- | --- | --- |
| VAL-001 | Implemented and qualified — release tracked in report | Validation maintainer | All six validation-efficiency packages implemented: maintained ownership, types-first staged graph, qualified infrastructure reuse, bounded parallelism, measured cost review, portable selected gate and release preflight. See [receipt](validation-implementation-2026-09-30.md) and [qualification](validation-qualification.md). | Types/full lint, 502-case fresh gate, repeated 25-leaf cold/warm trials, toolbar/zoom/isolation and stale-artifact rejection pass. Native publication status is separate in the report; historical red baseline remains VAL-002. |
| VAL-002 | Open — historical product assertion debt | Domain test maintainers | Stable broad source diagnostic has 110 failures matching the original baseline; kept in ordinary discovery. Repair their stale assertions/fixtures without weakening intended contracts. Shared dialog/Storyboard/API fixtures, lint debt, unassigned browser commands and external CI ownership from the initial follow-up are resolved. | Preserve named negative coverage and compare actual behavior before changing expectations. Native account/archive/hardware acceptance remains QA-001. Full repository green, p95 and flake-rate claims are not established by the selected infrastructure gate. |

## Video provenance follow-up

| ID | Status | Owner | Remaining work / next action | Done when |
| --- | --- | --- | --- | --- |
| VP-001 | Published554; user acceptance pending | Video reference provenance; P7 release owner | Focused source `49893648` deployed over verified553, preserving552 toolbar and Idea note. [Release receipt](http://127.0.0.1:4193/next-tasks/video-reference-provenance/published-554/). No further implementation required for this bounded correction. | 89 scoped tests, TypeScript/lint/build and held41 migration/archive checks pass. Ten exact baseline failures reproduce unchanged553 and candidate. Audience/environment and disabled controls preserved. Quality/moderation effects remain unknown; no historical image-rejection explanation. |

## P5 pilot evidence feasibility

| ID | Status | Owner | Next action / completion basis |
| --- | --- | --- | --- |
| P6-EVIDENCE | Done — bounded local feasibility decision; paid pilot remains unsupported | P6 evidence task; P5 retains browser/Sites support ownership | [Decision sheet](evidence/generation-p6/decision-sheet.md): missing authentic private registration, original study-charge producer and account-specific finality source. Owner supplies only the four consolidated record/choice groups. Conditional producer connection is a proposal, not accepted implementation. P4 is complete; no hosted action, purchase or October 1 expiry renewal. |

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
| MEM-001 | Open — hosted qualification and release | Unassigned | Complete the linked non-implementation checklist: release review, hosted scheduling/privacy qualification, bounded synthetic benchmark and cap decision, acceptance and explicit consent. | Evidence closes every applicable gate for the exact deployed source/runtime/audience. No real-user enrollment before qualification and affirmative consent. |
| MEM-002 | Native complete; service-dependent integration open | Memory task | Reconcile the [current completion matrix](forma-memory-completion-matrix-2026-09-20.md) throughbd6c4ef3:2,942 runtime,2,351 Memory inventory and116 browser checks pass, with local main00e23d97 integrated. Native work is merge-ready for owner review. Keep service-dependent index/embedding adapter and genuine candidate baseline code in the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md). | Actual native callers, durable privacy/accounting and current verification for every row; no claim that native intents equal a deployed vector service, or that production435 contains this candidate. |
| MEM-003 | Native continuation complete; integration review pending | Memory task; external service/release owners unassigned | The [current completion matrix](forma-memory-completion-matrix-2026-09-20.md) supersedes the older slice-by-slice pending lists below. All six native workstreams have real callers and local evidence. The exhaustive2,942-case runtime receipt is complete; remaining selected-service adapter/baseline code stays in the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md). | Current native runtime, model/client, migration, privacy/capacity and browser evidence is recorded. Hosted service readiness, deployment and real-user enrollment are not inferred. |

**Historical Memory checkpoints:** The slice descriptions below record what was
open at each earlier commit. Their former native “remaining” lists are superseded
by MEM-002/MEM-003 and the current completion matrix, not additional unassigned
implementation. External service and release gates remain open in their own To Dos.

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
| ST-MOTION-002 | Done — published556; scoped manual acceptance complete | Still toolbar | User confirmed physical touch/rotation, iOS VoiceOver, and macOS Chrome with VoiceOver on2026-09-30. No remaining manual release check. Other screen readers were not tested; no universal accessibility claim. | Shared timing/selected-path cleanup and mobile fixes committed to main. Exact release passes44 unit tests,98 browser checks across Chromium/Firefox/WebKit,5 release-preflight tests, build/typecheck/lint and41-migration/archive verification. Native Chromium200% zoom, keyboard navigation, both Find action dismissals and Reduced Motion are automated. [Release receipt](still-toolbar-motion-2026-09-28.md#hardening-release--2026-09-30), [manual checklist](../tests/browser/README.md#still-toolbar-motion). |
| ST-ACTIONS-001 | Implemented locally — verification and review record | Still | Policy still-24: coherent final nomination, validated answers, action metadata, faithful scoped history, explicit goals/workflow state, opt-in semantic outcome/feedback receipts, retrieval and shared budgets, plus frozen offline quality replay. | [Implementation and evaluation guide](still-action-quality.md). Additive migration0074 prepared; no existing DB migration or deployment. Synthetic checks do not establish live user benefit; local-fallback rubric findings and prior product feedback remain visible. [Original review](still-jev-action-surfaces-review-2026-09-30.md). |

## Completed

The scopes below are complete within their recorded limits. Parent SP/SH/GS/QA
IDs remain open for the specific work above; these closures do not mean whole-plan
completion. The [421 publication receipt](evidence/forma-mini-app-publication-421.json)
records source `282236d28473fd5a53d9c2ce38ed89e882368c82`, successful deployment,
unchanged audience and excluded activation/spend. Earlier snapshots and failures
remain in Git and the independent report.

| Completed scope | Closure evidence and boundary |
| --- | --- |
| UI-RESULTS-GUTTERS · Results column alignment | **Done locally, 2026-10-01; publication authorized; exact deployment receipt tracked in the Progress Report.** Generation controls now share the heading/media pane inset, with no extra Image-button offset. [Spacing rule](../src/responsive-foundation.css) and [responsive contracts](../tests/responsive-product.test.mjs). Typecheck, scoped lint, inventory and eight isolated Playwright geometry cases pass (320–1000px, LTR/RTL). Responsive suite: 44/45 pass; existing D428 narrow-container assertion conflicts with the unchanged rendered-posture selector. No full application browser journey or release claimed. |
| ST-MOTION-001 · Still toolbar adoption | **Done — reviewed, integrated and deployed as Sites552, 2026-09-29.** Cushion, Infusion and Thread retain their selected behavior. Build/typecheck/changed-file lint,42 focused unit checks and11 app browser checks pass. The hosted release preserves restored550 backend, workspace access and41 approved migrations. [Contract and release receipt](still-toolbar-motion-2026-09-28.md). Live user review remains separate; no paid provider execution. |
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


## MEM-029 — Atomic claim/response receipts and retained-byte bounds

Implemented locally: [exact native quote claim, atomic raw-response custody,
strict publication receipts, non-pilot continuation and batched ordinary retention
preflight](forma-memory-native-capacity-2026-09-20.md#atomic-admissionresponse-receipts-and-retention-preflight--2026-09-21).
Lost acknowledgements cannot authorize dispatch or repurchase; raw paid responses
remain separately recoverable. Current synthetic whole execution is 60/64
personal/shared calls, above the conservative 50-call target. 151 final-source execution/D1, 29 product/retention and 15 rebuilt-worker
retention checks pass. The full native checkpoint at `8ee293ab` passes 2,254/2,254;
MEM-030 has separate later-source verification. The complete native matrix
remains assigned to this task. External service and rollout gates remain separate.


## MEM-030 — Confirm every final private disclosure acknowledgement

Implemented locally: [final quote/result source-proof and named-row checks](forma-memory-native-capacity-2026-09-20.md#confirmed-final-private-disclosure--2026-09-21),
including normalized asynchronous failures and rejection of array-shaped native
rows. Thirty quote/execute/retrieval fault cases and 135 overlapping native/D1
checks pass; types, changed-worker lint and build pass. No new source consent, provider charge, native scope promotion or
production activation. Other native completion-matrix requirements remain assigned.

## MEM-031 — Reviewed creative creation and native Undo/Redo

Implemented locally: [private creative-block previews and explicit authored
publication](forma-memory-creative-blocks-2026-09-21.md) in Document Assistant and
Chat Studio. Acceptance reuses native consent, custody and exact source proofs;
withdrawal preserves authored work and its negative attribution. Shared-project
Redo now restores a verified creation lifecycle rather than recreating its ID.
Native, localized control, browser and history checks pass; reproduced pre-change
panel/navigation test failures remain separately recorded. Full runtime
verification at`9f6b67df` passes2,304/2,304 (before subsequent metadata batching). No production activation or enrollment. Remaining
native work stays in the completion matrix; external gates are not relabeled as
implementation completion.


## MEM-032 — Native execution capacity and batched metadata

Implemented locally: [bounded metadata and atomic dispatch](forma-memory-native-capacity-2026-09-20.md#bounded-native-metadata-and-atomic-dispatch--2026-09-21).
The existing synthetic invocation meets its conservative50-call target at48/50
personal/shared, with explicit regression ceilings and adversarial receipt,
policy, authority and retention checks. The first full run exposed eight stale metadata fault hooks. After their correction, the immutable full rerun at763e91c2 passes2,399/2,399. Later source changes are qualified separately. Hosted qualification
and the remaining native completion-matrix rows remain separate, tracked work.


## MEM-033 — Independently authorized original-source discovery

Implemented locally: [certified-copy source discovery, preview and explicit assistant context](forma-memory-reuse-discovery-2026-09-21.md).
It preserves source-side recall boundaries and independent enrollment/access,
adds no copied preference evidence or relevance boost, and never falls back to an
older withdrawn window. The actual localized UI now connects to retained original
context consent; a candidate-control first-render defect is fixed. Native D1,
privacy-race, client/component and browser checks pass. Broader source/resource
coverage and other native completion rows remain assigned; no production rollout.


## MEM-034 — Private scope-specific profile proposals

Implemented locally: [original-backed project/tree/partition/organization facets](forma-memory-scope-profile-facets-2026-09-21.md).
Actual Document review requires independent originals, owner-qualified identities,
bilateral range consent and current controls; inference cannot become shared
policy. Native/D1, strict-client, RTL/browser, types and scoped lint checks pass.
Semantic cross-scope consolidation and aggregate prompt consumers remain tracked.

## MEM-035 — Certified multi-hop original discovery

Implemented locally: [bounded multi-hop discovery](forma-memory-reuse-discovery-2026-09-21.md#independently-authorized-multi-hop-continuation).
Every intermediate requires its own access, enrollment, range and current native
approval/result. No pointer-only shortcut or resurrection after body restore.
Actual personal/shared D1 measures46 calls; final privacy/receipt regression passes.
Duplicate-document/cross-owner and distinct resource coverage remain assigned.


## MEM-036 — Explicitly enrolled duplicate-document original recall

Implemented locally: [native duplication, inspected history and source recall](forma-memory-duplicate-source-recall-2026-09-21.md).
Real copied document identity never inherits consent. Version2 provenance verifies
native approval and the complete footprint, supports folder/lock copies and keeps
inspection separate from new reuse. Version1 replays unchanged.137 native and62
existing authoring/model checks pass, including actual D1 retirement/restoration.
Cross-owner and distinct-resource/consumer integration remains tracked, not waived.


## MEM-037 — Scope filtering before private history hydration

Implemented locally: [private history boundaries](forma-memory-private-history-boundaries-2026-09-21.md).
Block, relation, copy and authored-profile readers withhold foreign private bodies in SQL. Native inspected-reference counts use version2 with retained-version1 replay.22 focused,126 history/recall and54 resource/mixed-producer checks pass. This closes a concrete source boundary, not Library/Canvas enrollment or the other native completion rows.


## MEM-038 — Owner-qualified published-package original recall

Implemented locally: [published-package source recall](forma-memory-published-package-recall-2026-09-21.md).
Native publishing/adoption preserves original owner/project identity and negative
Memory attribution. Independently enrolled sources retain their own access,
consent, rights and retirement.81 native,40 authoring and16 browser checks pass;
actual direct D1 recall uses46 binding calls. Media references and other native
completion-matrix rows remain assigned; no deployment or implicit enrollment.


## MEM-039 — Licensed-package references and current rights

Implemented locally: [reference provenance and fresh package rights](forma-memory-published-package-recall-2026-09-21.md#licensed-references-and-fresh-rights-continuation).
Native metadata binds both owners’ reference/file custody, exact adoption and
current license state. All private disclosure proofs replay; authored copies
survive withdrawal.102 integrated checks pass; actual D1 calls47 plain/48 file.
No file hydration, provider purchase, migration, rollout or implicit enrollment.
Other native completion-matrix rows remain assigned.

## MEM-040 — Independent Library/Canvas Memory and privacy controls

Implemented locally: [resource identity, consent, history and consumers](forma-memory-resource-integration-2026-09-21.md).
Additive0067 has no enrollment/backfill. Native nightly processing, bounded
metadata history, before/after-capture retirement and source-free forgetting are
connected to real Library/Canvas and Memory-panel controls.73 native,177 client,
83 migration and10 browser checks pass; actual D1 requests use8/7 personal and9/8
shared capture/recall calls. No deployment, schedule registration or real enrollment.
Semantic aggregate/resource consumers, direct private creative Output and integrated
qualification stay assigned in the completion matrix.

## MEM-041 — Durable multi-source profile context and snapshot reconciliation

Implemented locally: [independent profile sources in actual assistant prompts](forma-memory-aggregate-profile-context-2026-09-21.md).
Explicit localized selection retains at most two independently authorized profile
sources beside the main note. Additive0068 binds revision/hash/range/retention and
retires dependent private copies on source loss; restored bodies cannot revive
an approved execution. Missing generated snapshots63–65 and new66 are included.
Aggregate capacity, broader semantic/resource integration and direct private
Output remain assigned, not external-service excuses. No deployment or enrollment.

## MEM-042 — Bounded aggregate read multiplexing

Implemented locally: [request-local aggregate reads](forma-memory-aggregate-profile-context-2026-09-21.md#request-local-read-multiplexing).
28 unit and98 integrated native checks pass, including maximum-three-source
local D1 execution. No positive-access cache or source-proof removal. Actual
aggregate execution63–66calls remains above the conservative50-call target;
capacity and the other completion-matrix rows stay assigned. No deployment.

## MEM-043 — Private Memory review to unconfirmed Output requirements

Implemented locally: [actual Assistant/Chat review and native Output authoring](forma-memory-output-requirements-2026-09-21.md).
Versioned exact approval creates an unconfirmed authored requirement only, with
separate shared-project validation and durable negative attribution. No plan,
spending or generation approval is inherited.18 native,67 model,114 focused UI
and12 browser checks pass (overlapping scopes). Baseline panel fixtures are reconciled;611 combined checks pass. Private image/live-preview, semantic resource/profile
integration and the other completion-matrix work remain assigned.

## MEM-044 — Consent-bound native resource openings

Implemented locally: [Library/Canvas opening receipts and rolling counts](forma-memory-resource-openings-2026-09-21.md).
Additive0069, exact native admission, actual visible-resource callers, four-language
counts and privacy retirement are verified:69 native plus2 erasure cases,265
client/migration checks and10 browser journeys. Old0067 controls remain supported.
No authored events, implicit enrollment or provider use. Semantic resource/profile
consumers, direct private images and broader qualification stay in the matrix.

## MEM-045 — Deterministic aggregate source read coordination

Implemented locally: [independent read waves and truthful capacity accounting](forma-memory-aggregate-profile-context-2026-09-21.md#coordinated-independent-source-reads).
41 unit and32 integrated native cases pass, plus four local D1 capacity cases.
Three-source execution is now63/64 personal/shared binding calls with original
source proofs intact. SQL statement counts are recorded separately. The50-call
target and all other native matrix work remain assigned, not silently waived.

## MEM-046 — Native resource recall proof and final-delivery lifetime

Implemented locally: [resource downstream evidence and delivery privacy](forma-memory-resource-integration-2026-09-21.md#native-downstream-recall-evidence-and-final-delivery).
The actual endpoint retains native proofs and rejects post-serialization expiry;
rolling counts stop at their next window transition.104 integrated native tests
pass, including13 new lifetime/authority/D1 cases. This does not grant provider
consent or replace the still-required durable semantic resource consumer.

## MEM-047 — Final private-response delivery

Implemented locally: [post-serialization privacy checks](forma-memory-native-capacity-2026-09-20.md#final-private-response-delivery--2026-09-21).
Eight native read surfaces now retain the original lease through serialization;
correction text expires at its own retention boundary.41 new cases and122
integrated native checks pass. No source cache, migration or deployment.

## MEM-048 — Resource collection consent preflight

Implemented locally: [client preflight and navigation regression](forma-memory-resource-openings-2026-09-21.md#client-collection-preflight-and-integrated-navigation).
Native resource openings make no collection POST without a fresh affirmative
learning enrollment.206 client/model checks,36 integrated navigation checks and10
synthetic browser journeys pass; server authority remains mandatory.

## MEM-049 — Original-backed semantic profile synthesis

Implemented locally: [cross-scope semantic review](forma-memory-profile-consolidation-2026-09-20.md#cross-scope-semantic-review--2026-09-21).
The approved specialist groups eligible profile interpretations using verified
original identities, derives scope/relevance natively, and retains a localized
private review with durable withdrawal.752 integrated client/provider checks,34
native aggregate checks,6 final native cases and8 browser journeys pass (native
counts overlap). Automatic nightly unified-profile evolution remains assigned.

## MEM-050 — Independently selected resource assistant history

Implemented locally: [explicit frozen activity selection](forma-memory-resource-assistant-context-2026-09-21.md).
The actual Library/Canvas controls now separately review/select/forget exact
resource activity, with native source proof, immutable retention and non-resurrecting
retirement.0070 is additive and local only.146 integrated native,27 final native,
287 client/migration and10 browser checks pass (native counts overlap). Actual
paid semantic resource consumption remains assigned native implementation, not an
external-service prerequisite or an implied model-use enrollment.

## MEM-051 — Native resource semantic assistant and accounting recovery

Implemented locally: [independently approved resource guidance](forma-memory-resource-semantic-assistant-2026-09-21.md).
Library/Canvas now have actual question, exact-input/cost approval, private answer
and source-free recovery controls, with additive0071 ancestry and native paired
billing.148 native,3 final accounting,224 client/documentation,102 migration and
10 browser checks pass. Personal/shared execution uses38/42 local D1 calls.
No deployment or enrollment; automatic unified profiles, private Output and the
remaining native matrix work continue on this task.

## MEM-052 — Unified current-profile review

Implemented locally: [actor-private current profile catalog and review](forma-memory-unified-profile-review-2026-09-21.md).
The real localized Memory panel now discovers qualified nightly projections and
explicitly inspects the latest completed result with original-source and current
correction checks. Retired heads never fall back to older interpretations.
38 integrated native and232 client cases pass; local D1 catalog/current inspection
uses6/30 calls. No new enrollment, provider work or migration. Remaining native
cross-scope publication, aggregate capacity, direct private Output and broader
integration stay assigned in the completion matrix; external rollout remains gated.

## MEM-053 — Aggregate native capacity and restored-head continuity

Implemented locally: [atomic source/receipt qualification](forma-memory-native-capacity-2026-09-20.md#aggregate-capacity-immediate-receipts-and-restored-heads--2026-09-21).
Maximum-three-source execution meets48/50 personal/shared calls with immediate
completion; missing publication acknowledgements still prevent dispatch/disclosure.
Automatic current views cannot promote an older result after partial restoration.
410 native,27 subsequent restore/recall,363 client/model and20 browser checks pass.
The preceding full run has two fixture timeouts, separately investigated and not
waived; a current clean full regression remains assigned. No production changes.

## MEM-054 — Automatic native scope profiles and reference publication

Implemented locally: [scope-profile integration](forma-memory-automatic-scope-profile-2026-09-21.md).
Current-only, independently authorized profiles now have a native reader, actual
localized review, scheduled reference-only snapshots, unavailable-target backoff,
expiry cleanup and personal-only atomic erasure. Local D1 observes 24 scheduled
and25 HTTP calls. No private prose is duplicated in0072, no provider is called,
and no enrollment, production migration or hosted schedule is activated.
Remaining consumers and full integration evidence stay assigned in the completion
matrix; external/operational requirements remain separately tracked.

## MEM-055 — Private resource intent draft completions

Implemented locally: [Library/Canvas next-question drafts](forma-memory-resource-intent-drafts-2026-09-21.md).
The approved private response can supply optional bounded drafts to the actual
resource UI. Selection only fills an empty field without sending, spending,
overwriting a draft or extending private retention. 43 native,336 provider/client
and10 browser checks pass. The12 stale full-regression race hooks are repaired and
pass at real transaction boundaries; a full current rerun remains assigned.
No deployment or enrollment; other native matrix work continues here.

## MEM-056 — Private image preview and paid-response recovery

Implemented locally: [private Memory image preview](forma-memory-private-image-preview-2026-09-21.md).
Actual Document/Chat cost review, private pixels, retirement, no-repurchase recovery
and source-free accounting maintenance are implemented.31 native and8 browser
checks pass; preceding full commit passes2,869/2,869. Explicit authored-image
adoption, long-response capacity/UI recovery and integrated qualification remain
assigned native work. No production or enrollment change.

## MEM-057 — Explicit authored-image acceptance and erasure custody

Implemented locally: [Memory-assisted image adoption](forma-memory-authored-image-adoption-2026-09-21.md).
Native transaction, exact UI acceptance, recovery without repurchase, negative
provenance, permanent accepted-work erasure receipts and downstream media readers
are integrated. Additive0073 remains undeployed. Maximum-three-source D1 execution
passes48/50 calls. Delayed-response capacity and final integrated qualification
remain on this task; external scheduling, provider qualification and rollout stay
on the separate capability To Do.

## MEM-058 — Fixed private-image processing lifetime and cold capacity

Implemented locally: [server processing and browser lifetime separation](forma-memory-image-processing-lifetime-2026-09-21.md). Cold maximum-three-source delayed execution uses50 D1 calls including bootstrap. Late pilot/task/source changes and over-deadline results fail closed; verified usage settles without repurchase. Final full native regression and matrix reconciliation remain on this task, not a request for further user approval.

## MEM-059 — Optional authored-image schema qualification

Implemented and locally qualified; final integrated qualification recorded in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md).
[Schema qualification](forma-memory-authored-image-schema-2026-09-21.md) fixes the
six full-runtime maintenance failures caused by an absent optional migration.
Clean absence is a no-op; partial/changed privacy schema and orphaned material
are denied. Exact native guards fence acceptance and accepted-media reads,
including late schema changes. No deployment, migration execution or enrollment.

Native closure receipt2026-09-21: all six native workstreams are complete and
locally qualified.2,942/2,942 exhaustive runtime checks,2,351/2,351 Memory inventory
checks and116/116 browser journeys pass. No native implementation is scheduled
or left queued. Service-dependent adapter/baseline code, hosted qualification,
owner integration, deployment and explicit enrollment remain in MEM-001/MEM-002
and their linked To Dos. This is not a production completion claim.

## MEM-060 — Authorized publication and hosted migration hold

**Done — code publication and hosted schema repair. Owner: Memory task.**

Remote `main` source `0c544606` is published in production500. The
[hosted repair receipt](forma-memory-schema-repair-2026-09-21.md) records completed
schema effects for all31 held migrations:361 objects/42 tables, zero missing or
pending replacements, verified rollback and exact final catalog. A fresh
post-redeployment inspection confirms completion and a disabled repair switch.
No user table was dropped or rewritten; original applied-history receipts remain
unchanged. Memory activation, enrollment and scheduling remain off.

**Retained release constraint:** continue the guarded41-migration packaging prefix.
Do not replay the historical31 files through the unqualified Sites executor; their
schema effects were installed through the fixed atomic D1 repair instead.
[Packaging instructions](forma-memory-publication-2026-09-21.md) and the complete
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md) retain
separate service-dependent and activation work. No repair is still pending for
these31 journaled migrations.


### Creator document leading-edge alignment — 2026-10-01

**Implemented, integrated on main, and published.** Shell and project identity marks,
document headings, Studio family labels, pane-switch labels, and context headings
use the existing bounded pane gutter (16–20px at the default font size). Rails
retain their own column; compact bottom navigation retains equal-width cells.
The short-landscape document title retains clearance for its project toggle.

Verification: TypeScript and the 161-element CEM check passed; Playwright measured
18 English/Arabic width/height cases, native Tab focus, and page overflow with
synthetic data. Release preparation updates the stale D428 container-query
assertion to enforce the actual shared measured posture, its pane visibility,
and the existing 62rem boundary. Screenshots and geometry receipts are in
`outputs/creator-alignment/`. Published as **Sites560** on 2026-10-01;
[release receipt](evidence/creator-leading-edge-release-2026-10-01.json) records
45/45 responsive checks, the verified build/archive, unchanged access and runtime
settings, and the preserved 41-migration package. Main integration: `a0d4d0d6`.

### Shared Creator page gutters — 2026-10-01

**Integrated into main (`73dc48f8`) and published as Sites562.** Deployment
`appgdep_6abe7337c998819180da92754ebb78cf` succeeded with environment16 and
unchanged workspace access revision7. The exact source and 622-file archive
match; the existing 41 approved migrations are preserved. See the
[release receipt](evidence/creator-shared-gutters-release-2026-10-01.json).

The
original document-only alignment omitted Library and other Creator browse
pages. Creator page containers now supply the same bounded pane inset to
Projects, project overview, Library, Activity and Deliver. Shell identity,
project rail and desktop navigation follow the shared rule; Library Resource
Memory aligns with the heading and search, including its expanded panel.

Verification: types/full lint, all 45 responsive source tests, and the registered
`creator-gutters` Playwright lane pass. Its eight tests cover four actual pages
(Library, Projects, project overview and Document), nine viewports and English/
Arabic (72 geometry cases), plus native Library disclosure keyboard/focus checks.
Activity and Deliver inherit the shared container rule but were not separately
browser-replayed. The first run exposed an incorrect viewport-width expectation
in the new test: compact Library reserves a trailing navigation rail. The final
assertion compares both panel edges with search in the content column. No full
historical suite, paid provider work or live-account acceptance is claimed.
Evidence is retained under `outputs/creator-alignment-shared/` and the managed
validation receipts. Hosted activation and user review remain distinct.

### Shared Creator page gutters — 2026-10-01

**Implementation complete; publication authorized and in preparation.** The
original document-only alignment omitted Library and other Creator browse
pages. Creator page containers now supply the same bounded pane inset to
Projects, project overview, Library, Activity and Deliver. Shell identity,
project rail and desktop navigation follow the shared rule; Library Resource
Memory aligns with the heading and search, including its expanded panel.

Verification: types/full lint, all 45 responsive source tests, and the registered
`creator-gutters` Playwright lane pass. Its eight tests cover four actual pages
(Library, Projects, project overview and Document), nine viewports and English/
Arabic (72 geometry cases), plus native Library disclosure keyboard/focus checks.
Activity and Deliver inherit the shared container rule but were not separately
browser-replayed. The first run exposed an incorrect viewport-width expectation
in the new test: compact Library reserves a trailing navigation rail. The final
assertion compares both panel edges with search in the content column. No full
historical suite, paid provider work or live-account acceptance is claimed.
Evidence is retained under `outputs/creator-alignment-shared/` and the managed
validation receipts. Hosted activation and user review remain distinct.

### Document column heading alignment — 2026-10-01

**Published as Site561.** Context and results titles share a control-height
first row and top alignment when titles or actions wrap. Local main implementation
is `0213436f`; release source is `e1c93e9f`. The release preserves Results558,
Library559 and leading-edge560. Types/full lint, all 45 responsive checks, the
production build and 14 built-renderer English/Arabic cases pass. The uploaded
622-file archive matches the build and retains the 41 approved migrations,
workspace access revision7 and environment16. Evidence and the successful native
deployment receipt are in `outputs/workbench-spacing/release/`. Live human visual
acceptance remains separate; no further implementation or publication remains.

### Project sidebar spacing — 2026-10-01

Implemented locally: project copy, section headings, and navigation icon cells
share a logical inset; Documents and Library use the same centered icon/label
layout. Section boundaries use a single divider and consistent vertical spacing.
TypeScript, scoped lint, CEM checks, and 12 synthetic Chromium geometry cases
pass (320–1600px, short landscape, English/Arabic). Visual evidence and focused
validation logs are retained in `outputs/sidebar-spacing/`. Publication and user
visual acceptance remain separate.
The selected Node run passed 84/91 tests. All seven native-navigation fixture
failures also reproduce with the original ProjectRail component (focus ownership
and the collection-create request count); they remain outside this visual fix.

### Ask Forma trailing alignment — 2026-10-01

**Published as Site563.** Main implementation `ed23b17a`; release
`bf2db728` preserves the concurrent Creator562 publication. Native deployment
succeeded with environment16 and workspace access7. Exact622-file archive and
41 approved migrations verified; receipts: `outputs/ask-gutter/release563/`.

Implemented the requested follow-up to document gutters: the floating Ask Forma
launcher tracks the Results content edge, including inspector resizing and
reserved scrollbar space. Compact Studio uses the shared pane inset for its
existing utility slot. Bottom clearance, open-panel placement, and focus return
are preserved. No new component API or translated copy; generated manifests
remain unchanged.

Verification: types/full lint and build pass; all 218 assistant placement/runtime
checks pass. Chromium 151 passes 36 built-renderer geometry cases across seven
sizes, English/Arabic, and fine/coarse pointer modes, plus open/Escape focus
return at 1600px and 320px. Evidence: `outputs/ask-gutter/`. The assistant-shell
source suite has four pre-existing failures, reproduced on Site561's unchanged
source: shell-mount text pattern, checkbox exclusion, and two stale placement
text assertions. Those assertions remain a separate validation-maintenance
backlog item; they were not weakened or excluded. Live review remains pending.
