# Memory: Sites implementation and external capability To Do

Updated 2026-09-18. Part of [MEM-002](backlog.md#memory), not a new or reduced plan.
The [full implementation reconciliation](forma-memory-implementation-2026-09-17.md#remaining-source-work)
and [operational gates](forma-memory-nonimplementation-work-2026-09-17.md) remain open.

## Implemented in this continuation

- Additive D1 change checkpoints, written atomically with each enrolled scope's
  native source references and cursor. One coalesced row per enrollment contains
  bounds, counts, times and a random generation; no source text, event IDs or
  vector data. Counts mean observed references, not comprehension or current evidence.
- Actor-owned `/api/memory/processing` status, with current native access and exact
  schema/enrollment guards. It explicitly reports semantic processing as unimplemented.
- Checkpoint invalidation for source and enrollment changes; explicit scoped
  Forget/erasure integration, schema-race rejection and bounded physical expiry.
  Expiry runs independently of learning admission when a scheduled invocation occurs;
  a missing scheduler is still a missing cleanup delivery guarantee.
- Closed guest-custody schema compatibility for the exact new migration only.
- `scripts/qualify-memory-migrations.mjs`: a no-target, no-apply command checking
  the three hash-pinned pending candidates in disposable SQLite. It validates
  additive source chunks and the atomic conversation schema change, then rolls back.
  It does not qualify hosted execution, install candidates, or enable provider work.
- ORM conversation constraints corrected to the actually deployed minimum of one
  annotation. Zero-annotation reference capture remains gated by its separate pending
  30-statement rebuild; historical migration SQL was not rewritten.

**Checkpoint limits:** these are disposable hints, not a reliable derivation or
index-deletion queue. Invalidating a hint can discard its dirty range. A semantic
worker must independently reread native custody, source lifetime, source exclusions
and purpose/budget authority. No semantic summary, inferred profile, learned
suggestion or vector index is created by this change.

## Merge-ready continuation (not published)

The branch now incorporates local main `80ed2618ac57fee8f77aef316dacd478308ac72f`;
see the [migration-history reconciliation](forma-memory-main-reconciliation-2026-09-20.md).
This continuation does not change production configuration or enroll anyone.
The [native continuation record](forma-memory-native-continuation-2026-09-18.md)
tracks the subsequent 64-pair bounded capture, saved-answer compatibility, shared
Forget retirement fix and unverified derivation-parser component. The subsequent [purpose-control slice](forma-memory-purpose-controls-2026-09-18.md)
adds qualified separate consent and privacy controls. [Durable reference delivery](forma-memory-reference-delivery-2026-09-18.md)
now adds consent-specific queue registration, catch-up and privacy-safe retention;
[native admission](forma-memory-native-admission-2026-09-18.md) adds exact single-consumer
reference leases and protected budget primitives; [full original source capture](forma-memory-native-source-capture-2026-09-18.md) adds exact original evidence, typed observations and bounded privacy-safe replay. These slices do not complete
the open native pipeline table below. The [finance foundation](forma-memory-finance-foundation-2026-09-18.md)
adds retained cap floors and protected original accounting. The subsequent
[financial execution slice](forma-memory-financial-execution-2026-09-18.md) implements
source-bound admission, one-shot provider transport, original-ledger recovery,
organization deletion and localized cap/privacy controls with isolated tests.
[User controls and native worker integration](forma-memory-user-controls-worker-2026-09-18.md) now add source-bound corrections/suppression, localized review UI, atomic completion, bounded dispatch and processing snapshots. [Processing windows, artifact observations and immediate retirement](forma-memory-windows-artifacts-2026-09-18.md) now close further native gaps. [Bounded original-backed rolling refresh](forma-memory-rolling-history-2026-09-19.md) is now implemented. Longer-term reconciliation, broader scopes/producers, automatic consumer integration and index lifecycle remain native implementation work, not external-service gates.

- Canvas now records a personal artifact view only after the actual viewer opens,
  hashing the exact retained bytes and rechecking route, revision, custody and visibility.
- Canonical actor-private document/project identities and native declaration/lifecycle/
  custody proofs are shared by native recall, source selection and palette inspection.
  Project ancestry remains explicitly unresolved; identity is not an access grant.
- Negotiated consumption v2 joins genuine navigation and retained **current personal**
  artifact-view receipts in the opt-in inspector, with its own source ordinal map.
  Scheduled source publication preserves original lifetime ceilings, resumes bounded
  pages, and rolls back the cursor if source writes are unacknowledged.
- Exact native body/revision and final privacy replay reject changes to access,
  enrollment, custody, source content and compensation. These observations mean only
  that a viewer opened; they do not measure attention, reading or preference.
- Artifact observations remain excluded from assistant answer origins and exports.
  Historical and governed artifact evidence, genuine block inspection, longer rolling
  conversation capture, and broader inferred-output consumer/index inverses remain implementation work.

Verification: 625 focused artifact/client/UI checks and 51 focused native runtime
checks passed; typecheck and production build passed. These are local tests, not
hosted provider, browser, scheduling or real-user qualification.

## Sites-native code still to implement

These are not external-service blockers and must not be moved into a rollout-only list.

| Work | Concrete next step | Completion evidence |
| --- | --- | --- |
| Purpose grants / native accounting integration | Consent, source-bound native holds, payer-month caps, one-shot transport, settlement/recovery and manual UI are implemented; connect them to durable semantic processing | Real admission/accounting/recovery and privacy tests, no automatic enrollment |
| Reliable changed-scope delivery | Reference jobs, leases and [bounded recovery](forma-memory-native-recovery-2026-09-18.md) are implemented. [Private result storage and source inverses](forma-memory-native-results-2026-09-18.md) are implemented. Atomic eligible-work completion cursors and bounded native worker are implemented; [Byte-aware new-job windows and capacity fairness](forma-memory-windows-artifacts-2026-09-18.md) are implemented; [legacy oversized-job subdivision](forma-memory-legacy-subdivision-2026-09-18.md) is implemented with financial no-repurchase guards; [bounded original-backed rolling refresh](forma-memory-rolling-history-2026-09-19.md) is implemented; finish longer-term reconciliation and index outbox acknowledgements | Cursor/publication atomicity, replay, backpressure, source invalidation and deletion acknowledgements |
| Wider scope identities | Canonical certified personal/current artifact identities and lifecycle/custody retirement are implemented; finish real nested-project and page/block identities, bounded ancestry and reparent invalidation | Cycle, move, isolation and independent access-versus-relevance tests |
| Broader source and consumption coverage | Certified personal/current artifact views now accompany genuine originals in derivation capture; [Independent Chat Studio derivation](forma-memory-chat-studio-derivation-2026-09-19.md) and its bounded rolling rebase are implemented; historical personal artifacts, document-local block/relationship revisions and [native approved-copy evidence](forma-memory-approved-reuse-2026-09-19.md) are implemented; [governed artifacts and actor-private v4 inspection](forma-memory-governed-artifact-consumption-2026-09-19.md) are implemented; [bounded cross-producer reconciliation](forma-memory-cross-producer-history-2026-09-19.md) is implemented; [genuine native document block inspection and v5 private consumption](forma-memory-block-inspection-2026-09-19.md) are implemented; finish longer-term/cross-scope reconciliation, library/canvas and unsupported block-field histories, and independent cross-scope source recall | Exact source/body/lifetime/custody proofs; do not infer preference or comprehension from a click |
| Semantic/profile and suggestion callers | Citation parsing, provider adapter, [fresh read-only evidence](forma-memory-native-read-evidence-2026-09-18.md) and [complete-input manifests/publication receipts](forma-memory-native-manifests-2026-09-18.md) are implemented. [Result storage](forma-memory-native-results-2026-09-18.md) retains complete dependencies and privacy inverses; cross-job corrections/suppression and manual review are implemented; [automatic document-local briefs](forma-memory-document-brief-2026-09-19.md) implement correction-prioritized summary/profile/suggestion presentation and [v2 behavioral evidence](forma-memory-behavioral-evidence-2026-09-19.md) is integrated. Automatic assistant prompts, autocomplete, acceptance/rejection/undo provenance and broader reconciliation remain | Local adapter tests can proceed before external qualification; actual provider/index integration stays gated |
| Runtime observability | Scoped derivation counts, completion and uncertain-usage snapshots are implemented; finish index freshness/deletion status as that pipeline becomes real | Native measurements and failure drills; no text/vector payloads in general analytics |
| Pending migration integration | Assign candidates only after review, matching ORM/snapshot generation and qualified execution path | Append-only history, full rollback/row preservation and exact reader compatibility |

## Capabilities not available directly through the inspected Sites tools

Tool availability is evidence about this environment, not a claim that Sites can
never support these services. Sites currently provides D1/R2 and Worker-compatible
application code. The tool inspection exposed no scheduler registration, managed
PostgreSQL/vector provisioning, queue/workflow provisioning or hosted atomic SQL
executor for the pending rebuild. `get_site` can describe automations when available;
its omission here is not proof that no schedules exist.

| External / unqualified work | Tracked next action | Gate / owner |
| --- | --- | --- |
| PostgreSQL/pgvector service | Select/provision the retained PostgreSQL direction, with an authenticated Sites-compatible HTTP adapter, scoped partitions and deletion/reindex contract | Service owner unassigned; keep vectors with Forma user data; do not silently substitute D1 |
| Hosted invocation registration | User is arranging scheduling; identify supported Sites scheduling or an approved external scheduler and authenticated delivery | Isolated capacity, duplicates/missed runs, concurrency, timezone, recovery and no-visitor privacy cleanup qualification before enrollment |
| Durable external delivery, if required | Determine whether existing D1 leases suffice at measured load; otherwise qualify a queue/workflow adapter | No unrequested service provisioning or spend; preserve original IDs and uncertain outcomes |
| Hosted conversation rebuild | Qualify an executor that applies all 30 candidate statements in one atomic transaction/batch and preserves exact rows/schema | Local SQLite/workerd success does not qualify the hosted tool; never execute chunks as independent commits |
| Provider/model qualification | Verify access, current pricing, retention/residency and original usage receipts for the existing approved credential | No key rotation/re-request or synthetic approval records; real provider calls remain gated |
| Benchmark and monthly cap | Run the approved isolated experiment only after native/provider qualification; use measured usefulness and cost | AI allowance for now; one-time $10 ceiling is not the monthly cap; user approves measured cap |
| Operations and user acceptance | Name an operations owner, qualify restore/erase and browser/device behavior, then collect each user's affirmative enrollment | No real-user enrollment inferred from publication or site use |

## Release boundary and verification

New additive migration: `0042_memory_live_change_checkpoints.sql` (five explicit
schema objects). The three `db/*.pending.sql` candidates remain unchanged,
unassigned and unapplied. Runtime flags, audience, enrollment, provider credentials,
scheduler registration and billing authority are unchanged.

The release receipt and final test results are recorded in the
[release status](forma-memory-release-2026-09-18.md). This checklist does not itself
schedule work, provision a service or establish human review.

[Native whole-request inspection qualification](forma-memory-native-read-budget-2026-09-19.md) now covers tested three-window free/paid histories at 45/48 D1 calls in personal/shared scopes. Artifact-heavy and full broader integration qualification remain open; these local checks are not hosted quota evidence.

[Independent Chat Studio derivation](forma-memory-chat-studio-derivation-2026-09-19.md) is implemented with separate consent-bound registration/completion frontiers and 36-call tested whole-request history reads. Its migration0053 is schema-only with exact trigger/index replacements, not purely additive.

## Native index lifecycle continuation

[Atomic result-index intents](forma-memory-native-index-intents-2026-09-19.md) now cover publication, privacy invalidation, source-free deletion recovery and local queue diagnostics. Migration0054 is additive and unapplied. This closes the native outbox foundation, **not** qualified external dispatch/embedding consent or remote deletion acknowledgements. PostgreSQL/pgvector HTTP fencing, current-source admission, exact authenticated receipts and tombstone compaction remain tracked service/integration work; no remote indexing success is claimed.

## Historical personal artifact continuation

[Native historical artifact recertification](forma-memory-historical-artifact-consumption-2026-09-19.md) now covers genuine older viewed revisions in delivery/derivation, with original retention and current custody/access. Governed artifact evidence remains native integration work. The private inspector now explicitly negotiates v3 historical views; strict v1/v2 clients retain their prior contract. The current-view writer and v2 API contract are intentionally unchanged; neither unviewed history nor renewed retention is invented.

## Native document-local block continuation

[Block revision bindings](forma-memory-native-block-revisions-2026-09-19.md) now supplement Creator captures with exact native field histories, current personal/governed custody and complete pre-window supporting-event inverses. They do not promote raw pointers, block text or descendants into human preference evidence. Library/canvas placement, structural relations, reuse edges, nested scope ancestry and automatic consumers remain implementation work, not external-service blockers.

## Structural relationship privacy continuation

[Relationship retirement](forma-memory-relation-retirement-2026-09-19.md) packages additive migration0055 and closes immediate native result/index-intent invalidation for relationship lifecycle and custody changes. Endpoint/version certification, reuse edges and automatic consumers are still open implementation work. The migration is not applied to production.

## Relationship binding and rolling budget continuation

[Exact document-local relationship/endpoint bindings](forma-memory-native-relationship-bindings-2026-09-19.md) are integrated into Creator derivation with legacy-manifest compatibility, complete supporting-event privacy inverses and bounded union reads. Cross-document reuse, library/canvas scope and nested ancestry remain implementation work; none is silently converted into an external blocker.

## Genuine approved-copy continuation

[Native approved-copy evidence](forma-memory-approved-reuse-2026-09-19.md) now certifies committed copy outcomes without enrolling or reading the original source document for memory. Receipt/content/footprint inverses preserve immediate private erasure; migration0056 is additive and unapplied. Private outcome grouping prevents copied descendants from being counted as independent original intent. This closes the approved-copy action path, not library/canvas recall, original-source access, nested scopes or automatic consumers.

[Governed artifact consumption](forma-memory-governed-artifact-consumption-2026-09-19.md) now includes current-authority native writing, exact historical certification, actor-private event presentation and explicit v4 inspection. The four-source inspector uses 28/40 personal/shared D1 calls; artifact-heavy rolling derivation and broader integration remain open qualification work.

[Artifact-heavy rolling derivation](forma-memory-artifact-rolling-budget-2026-09-19.md) now retains all three tested windows at 46/49 free/paid D1 calls in personal/shared scopes. Opaque bounded native frames keep exact original/custody/expiry proofs and do not repair project indexes. Broader mixed-resource workload qualification remains open.

[Mixed-history request qualification](forma-memory-mixed-history-budget-2026-09-19.md) now covers three original windows with up to four artifacts and an approved-copy outcome in each window at 48 calls across personal/shared and free/paid scopes (artifact-only: 43). Atomic admission and bounded consent hydration retain every original privacy guard; the largest shared/paid mixture also passes isolated D1. Other broader native integration work remains tracked above.

[Automatic document-local Memory briefs](forma-memory-document-brief-2026-09-19.md) now consume native retained summaries, tentative profiles and suggestions with correction priority and private ephemeral rendering. Metadata GETs prove identity/custody without synchronizing indexes. Automatic assistant context, autocomplete, explicit acceptance/origin/inverses and broader scoped recall remain implementation work. No enrollment or external operation was activated.

## Native document block inspection continuation

[The native inspection/v5 slice](forma-memory-block-inspection-2026-09-19.md) closes genuine document block-control receipt capture, consented reference learning, private inspection, bounded derivation and source erasure. Historical statuses above remain evidence for their earlier slices; broader scope and durable consumer work is still implementation, not an external-service blocker.

[Rolling descriptive v5 windows](forma-memory-consumption-windows-2026-09-19.md) now summarize the already inspected document/artifact/block observations over 7/30 days. They add no collection, permission or external dependency and do not claim semantic patterns or complete analytics.


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

## Native whole-request qualification continuation

[The eight retained Output HTTP budget failures are resolved](forma-memory-native-output-budget-2026-09-19.md): execution-local negative cleanup predicates retain exact transaction-time exclusions, and job claims bind the original request/resource identity. Worst measured request is 49 operations. This is local synthetic qualification, not a hosted capacity or activation receipt.

### MEM-003 private result export continuation

[Fresh private semantic-result export](forma-memory-result-export-2026-09-19.md) is implemented and locally verified: a new native access check for each explicit download, separate quotations/actions, bounded snapshot disclosure and localized copy-retention warning. This is neither all-memory export nor production activation. Remaining native scope/reconciliation/consumer work stays open.

[Manual private review lifetimes](forma-memory-review-lifetime-2026-09-19.md) now retire result/correction presentation and stalled reads on monotonic expiry or clock anomalies. This locally verified privacy fix does not close broader scope/reconciliation/consumer implementation.

[Native resource rename observations](forma-memory-resource-renames-2026-09-19.md) now include genuine document/block renames as descriptive edits, with strict export/origin compatibility and exact native block versions. Names remain outside model quotation inputs. Broader resource identity and automatic consumers remain implementation work.

## Native project containment continuation — 2026-09-19

[Native project containment](forma-memory-project-containment-2026-09-19.md) now implements same-owner nesting, reparenting/detach, independent parent access, transactional stale-edit rejection, schema/privacy inverses and localized Projects controls. Additive migration0058 is unapplied; no deployment or enrollment occurred.

Still native implementation: ancestry-backed semantic recall and its durable move/erasure inverses, cross-owner hierarchy, broader resource identities/history, cross-document/long-term reconciliation and durable assistant/autocomplete consumers. Existing document-only Memory contracts are not broadened by this feature. External adapters/scheduling and operational qualification remain separately tracked; the full plan is not complete.

## Native cross-scope recall checkpoint — 2026-09-19

[Consent-gated cross-scope recall](forma-memory-cross-scope-recall-2026-09-19.md) is implemented locally with hierarchy/source/target proofs, optional automatic nearest-source briefs and explicit localized controls. Its additive migration0059, source changes and qualification evidence require integration review before rollout. No external service is required for this bounded native presentation path. No external adapter, schedule, budget, deployment, enrollment or production setting was changed. Durable semantic answer/edit consumers, broader resource learning and long-term reconciliation remain native implementation; do not classify them as capabilities missing from Sites.

The [cross-scope end-to-end follow-up](forma-memory-cross-scope-recall-2026-09-19.md#end-to-end-integration-qualification) verifies actual personal/shared automatic callers, explicit latest-only discovery, unchanged historical pagination, original pilot deadlines and stalled-response cancellation. Target recall does not enroll target processing. The native implementation backlog above remains in scope; these passing tests are not hosted qualification.

## Memory saved-context and page continuation — 2026-09-20

[Saved assistant references and canonical document pages](forma-memory-saved-context-pages-2026-09-20.md) implement private native selection controls, reference retirement, localized review, genuine governed page encounters and exact per-view derivation provenance. Migration0060 is unapplied. Automatic prompt/answer integration, field autocomplete, long-term reconciliation and the broader native scopes remain planned implementation, not external-service blockers. No production activation occurred.

[Canonical-page consumption review](forma-memory-saved-context-pages-2026-09-20.md#page-consumption-continuation) now adds explicitly negotiated v6 page targets and localized 7/30-day per-view counts, retaining older contracts and final privacy replay. This is descriptive, bounded observation coverage, not inferred preference or lifetime history. Broader native implementation remains in scope.


[Transactional saved-reference retirement](forma-memory-saved-context-pages-2026-09-20.md#transactional-reference-retirement-and-immediate-ui-clearing)
now covers boundary/hierarchy changes, result withdrawal and claim controls,
with immediate browser privacy invalidation. This is local branch work, not a
release. Broader automatic assistant/autocomplete, long-term reconciliation,
Library/Canvas/cross-owner scopes and integration qualification remain tracked
in the native continuation; external scheduling/provider/index qualification
and enrollment remain separate gates.

## Contextual profile and privacy continuation — 2026-09-20

[Contextual retained profiles, native resource evidence and privacy integration](forma-memory-contextual-profile-2026-09-20.md) implement bounded retained-profile reconciliation, explicitly negotiated native page/block citation locations, nearest-per-band project/tree/partition context, extended consumption windows and source-free cross-tab privacy invalidation. This is branch work with local evidence, not whole-plan completion or release. Automatic prompt/answer publication, exact-field autocomplete/undo provenance, longer-term semantic consolidation and broader native resource/owner scopes remain implementation work. External and operational gates above are unchanged.


[Native saved-context source evidence](forma-memory-native-consumer-source-2026-09-20.md)
now supplies the shared opaque source preparation and transactional replay used
by the existing authenticated reference reader. This is not generated-answer or
edit publication. The [consolidated completion matrix](forma-memory-completion-matrix-2026-09-20.md)
keeps every remaining native workstream distinct from external/operational gates.

## Additional exact migration review: consumer dependency retirement

Before rollout, qualify the [0063 consumer-parent upgrade](forma-memory-semantic-followup-2026-09-20.md#migration-and-rollout-review). It replaces a hash-pinned trigger to permit exact retired-row no-ops during cascades; it is not purely additive. Local qualification does not satisfy owner review or hosted atomic-executor qualification, and the earlier additive-only rollout authorization is not expanded.

## Independent resource rollout dependency — 2026-09-21

[Native Library/Canvas integration](forma-memory-resource-integration-2026-09-21.md)
is implemented locally, including the native scheduled callback and source-free
privacy controls. The production owner's atomic migration review must include
additive0067 and its source/settings retirement triggers before any resource
consent is enabled. There is no automatic enrollment/backfill. Hosted registration,
no-visitor execution, combined subsystem capacity, failure recovery and privacy
qualification remain external/operational gates; local D1/browser checks do not
qualify the host or authorize real user enrollment.

## Aggregate profile rollout dependency — 2026-09-21

[Independent aggregate profile context](forma-memory-aggregate-profile-context-2026-09-21.md)
adds0068 and reconciles missing source snapshots63–65. The production owner's
atomic migration review must include these exact files. Local snapshots are not
hosted receipts; no production migration has run. Measure the integrated maximum
source set against the actual host's request, byte, CPU and database ceilings
before enrollment. Existing scheduler/provider/index/retention/privacy gates and
explicit consent requirements remain unchanged.

### Native Output requirement integration

[Memory-assisted Output wording](forma-memory-output-requirements-2026-09-21.md)
is implemented locally without external services. It saves an unconfirmed
requirement only, not a plan or a paid generation. Native source/privacy and
localized browser tests pass. Private image/live-preview still belongs to native
implementation; hosted scheduling, provider qualification and rollout remain
separate operational gates.

## Resource opening consumption continuation

[Private Library/Canvas opening history](forma-memory-resource-openings-2026-09-21.md)
now connects actual visible-resource entry to independent existing consent and
bounded7/30-day counts. These private observations do not assert content reading
or preferences; forget/renewal/expiry and old-schema compatibility are verified.
Additive0069 is local only. Semantic resource/profile consumers, direct private
image/live-preview and integrated qualification remain assigned native work.

## Resource selection and semantic execution rollout — 2026-09-21

Native [resource selection](forma-memory-resource-assistant-context-2026-09-21.md)
and [private guidance](forma-memory-resource-semantic-assistant-2026-09-21.md)
are locally implemented. Owner review must include additive0070/0071, exact
source-retirement/restore behavior and the source-free billing maintenance hook.
The local50-call target is met for this consumer; that is not hosted capacity,
model/pricing/retention qualification or schedule registration. No real provider
calls, deployment or enrollment occurred for these slices. The native completion
matrix remains separate from these operational gates.

The [unified current-profile catalog](forma-memory-unified-profile-review-2026-09-21.md)
is implemented natively with existing tables and source authority. No external
service is needed for its explicit review UI. Automatic cross-scope publication,
remaining native consumers and qualification stay on the implementation matrix;
this catalog is not a substitute for those tasks or hosted schedule qualification.

## Local aggregate-capacity receipt

[Aggregate execution now meets48/50 local D1 calls](forma-memory-native-capacity-2026-09-20.md#aggregate-capacity-immediate-receipts-and-restored-heads--2026-09-21), with immediate publication and partial-restore head checks. This is
synthetic local evidence, not hosted scheduler/no-visitor capacity or deployment
qualification. External provisioning, real-provider qualification, production-owner
integration and affirmative enrollment gates above remain open and separately tracked.
