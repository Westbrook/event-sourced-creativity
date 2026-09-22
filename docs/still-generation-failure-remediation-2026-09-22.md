# Still: a clear path from failure to generation

Investigation and proposed remediation · 22 September 2026 · Version 1

**Finding:** the reported image failed during application preparation, before a provider request. A prior repair intentionally isolated inactive Memory tables to restore ordinary saves. Ordinary generation still requires the pre-isolation Memory schema while preparing private content. That conflict reproduces the exact error. The product then loses the actionable cause and offers generic prompt-editing and paid-attempt advice.

**Outcome sought:** every attempt opens either its usable content or a concise explanation of the known state, who can act, and the next effective step toward content. Technical evidence supports that explanation without becoming the default experience.

This is an investigation and implementation plan. No product code, production schema, provider configuration or historical attempt was changed. No new generation, recovery purchase or repair was triggered. Browser navigation can invoke the application's existing decision/onboarding services; these are separate from generation execution.

## 1. What happened in this attempt

| Fact | Verified observation |
| --- | --- |
| Attempt | `01a0cadd-2429-7893-9203-a123331424f1` |
| Document | `fedbe915-6e12-420e-b049-b00430902446`, “To Kill a Mocking Bird” |
| Requested output | Full-quality image, 1536 × 1024 |
| Timing | Requested 20:44:45.481 UTC; started 20:44:47.403; failed 20:44:51.976 on 22 September |
| Recorded failure | `memory_boundary_schema_unavailable`; normalized to `operation_failed` / unknown / `retryable:false` |
| Submission | `not_submitted`; receipt says `provider_contacted:false` |
| Source transmission | `not_transmitted` |
| Accounting | $1 reservation released; recorded settled usage $0 |
| Retained content | No usable output exposed; no exact prompt, frozen source or per-operation envelope available to this viewer |
| Deployment | Current Site version 519; investigation source base `fd714354d3b2f5a963ca6e104bc3ea0d69a7176d` |

The legacy receipt's provider/model fields describe recorded configuration; they do not prove any model ran. Missing provider call counts remain unknown instead of being rewritten to zero. The explicit not-submitted/contacted/transmitted fields can still be presented independently.

The first response's “schema missing or unavailable” explanation was incomplete. Fresh evidence identifies an intentional, installed isolation state rather than simply a forgotten migration.

## 2. Structural cause and strength of evidence

The live event-save repair inspection reports `empty-memory-trigger-isolation-v1`, complete, with **250 removed triggers**, **40 protected empty Memory tables**, and ordinary save compilation passing. Its database receipt records application at **16:23:15.400 UTC**, before the failed generation. The older Memory installer reports blocked, 250 missing objects and the 40 isolation barriers; that is an expected incompatibility with the original full Memory schema, not an instruction to reinstall it.

A disposable local database reproduces the interaction: private-content preparation, ordinary private-content loading, and the Memory exclusion boundary pass with the original complete schema; applying the actual event-save repair makes all three fail with `memory_boundary_schema_unavailable`. Six isolation triggers enter the semantic consumer schema snapshot and are absent from its allowlist; required original trigger families are also missing.

The causal chain is:

1. The event-save repair installs write barriers on inactive, empty Memory tables and removes their deep trigger graph so ordinary creative saves work.
2. Ordinary private-content preparation tries to qualify Memory provenance exclusions for **optional expiry cleanup**.
3. The semantic boundary recognizes absent or complete original schemas, but does not recognize the intentionally isolated schema as a separate supported state.
4. Optional cleanup ignores two known unavailable-schema errors, but propagates this third error. Ordinary input/evidence preparation fails before its insert completes and before provider execution.
5. The job catch path normalizes the application error through a generic provider classifier, losing its stable diagnostic identity.
6. Status, notification, evidence and action code present different fragments of the outcome, leaving the user to infer the cause and remedy.

**Confidence:** the schema compatibility defect and preparation failure are reproduced, and production matches the isolation state. The original attempt has no retained stack or failing-subcheck record, so the exact historical throw site is not directly recorded. Other throw sites share the same string; logging must distinguish them going forward. The reproduction uses actual implementations in Node SQLite with the 41-migration baseline plus the pinned repair. A separate local D1 run did not complete; hosted D1 end-to-end generation remains a release-validation requirement.

**Scope:** this shared private-content boundary is used beyond full-quality images. Draft images, other media, retained inputs, private evidence, content hydration and unrelated private writes need targeted coverage. This investigation does not assert that every route currently fails identically.

Relevant source: [private-content preparation](../worker/private-content-storage.ts#L130), [semantic consumer qualification](../worker/memory-consumer-boundary.ts#L8), [isolation contract](../worker/event-save-repair.ts#L16), and [earlier save repair rationale](forma-save-trigger-depth-2026-09-22.md).

## 3. Why the state is unclear to a user

| Issue | Current behavior and consequence | Required behavior |
| --- | --- | --- |
| Cause is flattened | A stable internal error becomes `operation_failed`, unknown origin, unknown corrective scope and action none. | Preserve a typed application-preparation failure and a separate diagnostic subcode. |
| Known facts are buried | No-submission and released-funds facts appear far below generic explanations. | Lead with output availability, request state, recorded cost and who needs to act. |
| Safety advice is unconditional | Failure details discuss rejection, risk categories, changing ideas and safeguards even though no provider was contacted. | Present safety education only when supported by safety evidence. |
| Raw code is the explanation | Status and notifications expose `memory_boundary_schema_unavailable`. | Use a short human explanation; keep the code in technical details. |
| Actions lack readiness | Source reproduction gives `canStartNew:true`; the live page initially offers a new paid attempt. | Server-owned readiness must gate another attempt while the same prerequisite is broken. |
| Suggestions change the apparent remedy | The observed toolbar changed from View document / Refresh status / New paid attempt to Inspect failure / View document / Add direction / Add idea. More offered reference actions. | Reserve the state-specific primary action before optional Jev ranking; creative edits remain optional. |
| Navigation overpromises | “View output” opens a failed attempt status with no output. | Use “View attempt” when no artifact exists; “View image” only for available image content. |
| Evidence instructions cannot be followed | The page tells the user to inspect original inputs while saying none are available. It also says a source hash remains available although the receipt hash is null. | Describe availability per source and avoid claims of retained values that are absent. |
| Recovery language is broader than the controls | Inspection describes original-request recovery, but Still mostly exposes saved-status refresh rather than all existing backend recovery mechanisms. | Expose only a supported recovery action with its precise effect and eligibility. |
| Dismissal affects discoverability | Notice dismissal sets `dismissedAt`; Results filters those unsuccessful attempts out. | Keep durable attempt history accessible independently of notice dismissal. |
| Support starts with excessive evidence | “Copy all evidence” is prominent and may include source material when retained. | Offer a content-free diagnostic summary first; disclose private evidence in a separate export. |

Existing evidence work correctly preserves uncertainty, separates private-source availability and distinguishes a new paid request from original-request recovery. Retain those properties. The gap is translating evidence into a consistent, useful product outcome.

Source anchors: `worker/document-jobs-api.ts:565,1824`; `worker/provider-errors.ts:96,144`; `src/model/document-jobs.ts:400,435`; `src/still/rejection-page.ts:143,150,194`; `src/still/rejection-evidence.ts:47`; `src/still/generation-decision.ts:13`; `src/still/local-policy.ts:48`; `src/still/app.ts:894,935,969,1186`; `src/still/notifications.ts:4`; `src/still/generation-activity.ts:45`; `src/still/results.ts:30`; ordinary hydration also calls the same boundary at `worker/pilot-policy.ts:1588` and `worker/events-api.ts:736`.

## 4. The proposed user experience

The generation URL should be the canonical outcome page. Render usable output first, including a valid partial result. If there is no usable output, render an educational outcome in that same content area. “Usable” means a server-published artifact that passes required validation and current viewer authorization; private checkpoints, refused media and unvalidated drafts are not output merely because bytes exist. Inspection becomes a disclosure or linked detail view; preserve existing `/rejection` deep links as compatible evidence entry points.

The first screen answers five questions: **Do I have content? Was my request sent? What happened? What happened to my allowance? What should I do next, and who can do it?** Do not make users inspect JSON to answer these.

Proposed copy for this exact receipt:

> **Still couldn’t start your image.**
>
> An internal service check failed before your request reached the generation provider. No image was produced, and your source was not sent.
>
> Recorded charge: **$0**. Your **$1 reservation was released**.
>
> The service needs a repair before another attempt can succeed. Changing your prompt is not required to resolve this error.

Primary action: **Check generation readiness**. Secondary actions: **View document** and **Copy support details**. Expandable detail: **Technical evidence**. The readiness action is proposed new functionality; the current Refresh status control does not establish service health.

A readiness check must be a bounded service/preparation check that creates no provider call, new attempt or reservation. Show its checked time and one of “Still unavailable”, “Ready to review a new attempt”, or “Couldn’t verify readiness”. Never change an unknown check into readiness. Do not promise automatic repair, reporting, notification or a completion time unless implemented.

When ready, offer **Review new image request** from the preserved document. Show whether the current document differs from the failed attempt's recorded revision. If exact frozen input is unavailable, say the next request uses current content. Use normal consent, source, budget and provider safeguards. A new attempt has a new identity linked to the prior failure; the old receipt remains unchanged.

Do not make normal users understand Memory, schema fingerprints or migrations. The service operator's diagnostic view can name the exact failed prerequisite and repair procedure.

## 5. Outcome and action contract

Use one shared presenter for generation pages, inspection, notifications, Results and Jev's allowed action set. Keep independently sourced facts separate: content availability; submission certainty; failure origin and category; financial state; input retention; and recovery/readiness capabilities. A single `failed` status or `retryable` boolean cannot represent these decisions.

| Outcome | Content/explanation | Primary next step | Money/request rule |
| --- | --- | --- | --- |
| Usable content | Open the image or other artifact. A non-blocking accounting issue stays secondary. | View or continue with content | No replacement request just because accounting is incomplete. |
| Saved content cannot load | Explain that the generation is saved but the current content read failed or access changed. | Retry the authorized content load or resolve access | Do not suggest a replacement purchase or show an indefinite loading state. |
| Useful partial content | Show completed parts and explain missing parts. | View partial result; recover remaining work only when supported | Preserve completed work and original purchases. |
| Service failure before dispatch | Name the application problem and operator ownership. | Check generation readiness | No new doomed reservation; show known release/charge facts. |
| Fixable request validation | Identify the affected requirement or field and preserve its draft. | Review the specific input | Revalidate before any provider submission. |
| Local safety preflight | Explain the exact local warning and available choices. | Review warning; acknowledgement only if existing contract permits | Acknowledgement does not bypass provider safeguards. |
| Provider refusal | Explain only the recorded refusal/category; avoid guessing a trigger. | Review request guidance and affected inputs, if known | A changed request is a separate paid attempt. |
| Account/access/quota issue | Explain whether user, workspace administrator or provider must act. | Open the relevant account/budget action or guidance | Readiness alone is not spending authority. |
| Temporary failure before dispatch | State no submission only when proved and expose the supported retry interval. | Recheck readiness, then explicitly start a new request | Bound retries; no hidden duplicate purchase. |
| Submission uncertain | Say the original request may still exist; show last verified time. | Check the original request through supported bounded recovery | No automatic replacement; maintain uncertain charges/holds. |
| Provider result exists but local save failed | Explain that content may be recoverable from the original request. | Recover original result if capability is valid | No new generation call; preserve financial evidence. |
| Evidence expired or unavailable | Say what is missing and what is still known. | View current document or review a new request when safe | Do not reconstruct old private inputs from current content. |
| Unknown failure | State only established facts and the limit of diagnosis. | Check status/support details; new request only under current eligibility | Unknown cost/submission is not zero/not-submitted. |

Suggested capability fields: action ID; eligibility; ineligible reason; responsible actor; side effect (`read_status`, `check_readiness`, `recover_original`, `new_paid_request`); evidence basis; last checked time; and expiry/version of readiness. Server revalidation remains authoritative. Deterministic actions must remain keyboard-accessible and reachable at narrow widths even when ranking changes or Jev is unavailable.

For historical attempts, derive a presentation view from explicit recorded facts without rewriting historical envelopes or inventing stage observations. For this exact historical fixture, recognize the exact known diagnostic in the trusted recorded error field even though the public code is already `operation_failed`; arbitrary text parsing must never authorize recovery or spending. Exact known error codes may inform an application explanation; missing provider evidence remains missing.

## 6. Remediation packages and order

The following packages are recommendations, not already accepted implementation or release work. They can run in parallel where noted, but the release must satisfy the combined gates.

### R1 — Restore ordinary content operations under intentional isolation · P0

**Owner:** private-content / database boundary. **Dependency:** none.

Create a supported, versioned distinction between absent Memory schema, qualified active schema, certified inactive isolation, and unknown/damaged schema. Reuse the existing isolation receipt and exact barrier/emptiness qualification instead of accepting arbitrary incomplete schemas or trusting feature flags alone. Bind any reusable proof to the database, schema identity and relevant transaction; test revocation/change races.

For optional expiry cleanup, an unavailable cleanup proof must omit cleanup without weakening insert authorization or broadening deletion. Use a typed cleanup-unavailable outcome rather than a blanket catch. Review the ordinary read/hydration path as well: a write-only fix is insufficient if the newly saved input or result cannot be read. Dedicated Memory reads, writes and activation must continue to reject isolated state.

Consider moving optional cleanup off the insertion critical path in a subsequent bounded change, using an already authorized lifecycle mechanism. Do not introduce a new schedule implicitly. Document how expiry/read denial continues and how deferred physical cleanup is accounted for.

**Do not** restore the removed deep trigger graph, enable Memory, remove its barriers, disable provenance checks, rewrite old migrations or whitelist every `memory_*` error.

**Acceptance:** complete original and certified isolated profiles support an ordinary synthetic image journey through input retention, evidence retention, mocked provider execution, artifact persistence and reload. Personal/shared authorization and retention remain enforced. The live-profile analogue still passes ordinary-save compilation. All 40 isolated Memory write barriers hold; unknown, partial, populated and tampered profiles deny the relevant protected operations.

### R2 — Preserve typed failure and preparation evidence · P0

**Owner:** generation job/outcome contract. **Dependency:** can begin alongside R1.

Preserve a stable code such as `generation_preparation_unavailable` plus the bounded diagnostic `memory_boundary_schema_unavailable`. Record application origin, preparation phase, operator ownership and current blocked prerequisite without representing this as a provider refusal. Distinguish the individual failing checks internally: response shape, unexpected object, missing family, digest mismatch or database change.

Capture minimal content-free start/stop and dispatch-intent facts in a persistence path independent of the failing optional cleanup. Do not capture secret/source content in public receipts or logs. Record a correlation ID, deployment version and schema/profile fingerprint for diagnostics. Failure to persist private evidence must remain explicit; it must not erase known accounting or submission facts.

**Acceptance:** the exact incident fixture has a coherent explanation and no inferred provider cause; genuine refusals, unknown submission and post-provider save failures retain their distinct semantics. Bounded logs correlate the failing check without exposing prompts or private content. Existing receipts remain immutable.

### R3 — Deliver useful educational outcomes and stable actions · P0

**Owner:** shared model / Still UI. **Dependency:** use a versioned R2 contract; fixture work can start in parallel.

Implement the shared outcome presenter and the state/action table above. Put known submission and financial facts near the heading. Replace unconditional safety copy and raw-code notices. Ensure View attempt / View image labels match the destination. Reserve a meaningful next action independently of Jev's rankings; do not equate editing a document with fixing the service.

Progressively disclose stages, source availability, comparisons and technical records. Provide a content-free support export, with the full private evidence export separately described. Preserve existing deep links and accessibility semantics.

**Acceptance:** status, notification, detail page, Results and toolbar agree for all thirteen outcome classes. The exact incident displays the proposed service explanation and costs, without prompt-blame or safety-refusal language. Mobile and keyboard tests preserve the primary action. Slow, failed or changing Jev responses cannot replace a required recovery action with unrelated creative edits.

### R4 — Gate new attempts and connect supported recovery · P1, required for complete recovery flow

**Owner:** admission / recovery API and Still client. **Dependency:** R1 and R2 contracts.

Add bounded generation-readiness checks before a new reservation and revalidate at submission. Readiness is capability- and environment-specific, expires appropriately, and never grants consent or provider authority. Any cache is keyed by environment, capability, schema profile and relevant viewer authorization scope; discard late replies after account/workspace changes. Keep schema fingerprints in operator diagnostics, not user-facing or Jev payloads. An unsuccessful check preserves the current draft/request and identifies who must act. Keep service-health checking distinct from reading an old job's status.

Expose supported original-result/status recovery from existing server predicates and contracts. Each control states whether it rereads local state, checks the provider's original request, recovers saved content or starts a new paid request. Do not add a fake recovery action for this incident: its receipt says there was no provider request to recover.

After repair, let the user review a fresh request from current preserved content with an explicit new-attempt action. Link the old and new attempts and disclose revision changes. Prevent duplicate admission under double-click, stale tabs, competing refreshes and delayed receipts.

**Acceptance:** repeated actions during an unresolved service blocker create no new generation/reservation. A successful readiness check alone creates no purchase. Original-request recovery cannot create a replacement purchase; unsupported or expired recovery explains the next feasible choice. A simulated repaired service leads through explicit new request to a currently authorized, validated artifact and reload. Assert the actual endpoint and side effects for every primary control, not just its label. Completed jobs with failed/denied content reads must explain the loading problem and never imply another purchase is required.

### R5 — Retain attempt continuity and qualify release · P1

**Owner:** Results / notification state plus integration. **Dependency:** R1–R4.

Separate notification dismissal from attempt visibility; keep a clear, compact attempt-history entry when no artifact exists. Dismissing a toast must not remove the only route to its receipt or next step. Existing direct links and older dismissed attempts need a compatible history path.

Add a release matrix covering clean schema, production's isolated schema and damaged schema. Exercise success, partial output, pre-dispatch infrastructure failure, unknown provider submission, provider refusal, local save failure and unavailable evidence across representative shared code paths. Maintain the guarded deployment packaging that holds optional Memory migrations; do not ship the full migration directory by accident.

**Acceptance:** mocked end-to-end checks verify user-visible content or education, accounting and no duplicate requests; dismissal/reload retains history; full TypeScript and relevant existing tests pass. After an authorized release, read-only production checks confirm deployment, certified isolation and readiness. Any real generation smoke test is a separately explicit, bounded request, recorded as live validation rather than inferred from mocked success.

## 7. Verification matrix and release evidence

| Layer | Required proof |
| --- | --- |
| Schema compatibility | Before/after actual isolation repair; exact barriers, empty witnesses and historical migration preservation; unknown/tampered/populated rejection. |
| Privacy and retention | Cross-owner/shared-scope denial; no Memory read/write activation; optional cleanup does not widen; expired and held content behavior preserved; database/schema-change races. |
| Full generation route | Personal image admission → retained inputs → mocked planner/media → artifact save → authorized reload under isolated schema, plus shared and representative cross-media callers. |
| Failure truth | Explicit no-dispatch differs from uncertain dispatch; absent call counts remain null; a configured model is not shown as an executed model. |
| Finance | Original reservation release/settlement remains correct; no new reservation while readiness is blocked; uncertain charges stay uncertain; recovered output uses the original purchase. |
| UI consistency | Same fixture agrees across notification, output page, inspection, Results and primary action; no unconditional refusal language. |
| Recovery continuity | Refresh is distinct from service readiness and original provider recovery; no duplicate purchase; current versus retained inputs disclosed. |
| Accessibility | Keyboard and narrow viewport retain next actions; async ranking cannot steal focus; status changes announced once; detail remains readable. |
| Operations | Content-free correlated failure log and readiness response; stale/failed checks display unknown; repair status is operator-owned. |

This investigation used live read-only page inspection, read-only Sites metadata/repair receipt inspection, source tracing and disposable reproductions. Worker logs provided no stack for the original attempt; the bounded all-events sample did not reach its execution timestamp, and absence from the error sample is not proof no error occurred. The deployment source attribution uses version 519 and its retained release record. No live provider effectiveness or successful-generation claim is made.

## 8. Fit with current work and handoff

Reuse A's outcome/evidence model, G's inspection/private-source handling, existing no-repurchase recovery contracts and the event-save isolation manifest. Coordinate shared `private-content-storage`, native-boundary and job-contract changes with E4 and other active source owners. Do not overwrite unrelated current working-tree changes.

The earlier repair tests cover event saves, barriers and rollback, but omit ordinary private-content preparation, hydration and generation checkpoints. Add these cross-feature seams to the release gate rather than relying on separately passing component suites.

H5's real-source capture and F4's preparation-finance work remain separate, valuable investigations. They do not replace repairing ordinary user generation's schema compatibility. Do not make this user wait for the experimental study executor, pricing experiments or Memory activation to regain ordinary generation.

The proposed order is **R1 compatibility and R2 failure contract**, with **R3 UI fixtures in parallel**, followed by **R4 connected readiness/recovery** and **R5 combined release validation**. A message-only mitigation can ship sooner if independently authorized, but must be labelled as clearer guidance while generation remains blocked.

**Completion definition:** with supported service prerequisites, an explicitly requested generation reaches usable content. With an unavailable prerequisite, the same journey reaches specific educational content with an accurate owner, cost/submission facts, and a next step that can actually change the outcome. No silent replacement, invented evidence or prompt-blame.

**Next concrete action:** implement R1 against the reproduced isolated-schema fixture, while defining R2's typed outcome and R3's exact incident fixture. This plan does not itself authorize deployment, schema modification or a paid generation.

Review the investigation's diagnosis, action model and packages independently in the existing [Progress Report](http://127.0.0.1:4187/). Recommendations remain unaccepted until the user directs implementation; viewing the report does not approve them.
