# Forma: adversarial product reassessment and next-version build plan

Assessment date: August 23, 2026  
Clean comparison revision: `eab3aa0130fe8a3607fbf44fc241933f8d37605a`  
Reviewed state: the current working tree, including the remediation implemented during this assessment  
Method: four independent, argumentative specialists; source-level verification; primary-source market research; repeated plan → implementation → adversarial review cycles

## Executive decision

Forma moved from an interesting but operationally unsafe product idea to a credible, bounded collaborative creative-work system. Its strongest positioning is not “another AI notebook” or “one prompt makes many things.” Its defensible proposition is:

> Forma turns licensed, verified organizational source material into exact, inspectable creative context; generates durable editable work in multiple forms; records the decisions that shaped it; and controls release through independently attributable, least-privilege human approval.

Across the four mandated goals and four independent disciplines, the unweighted product score improved from **45.25/100** in the original study to **66.50/100** at the clean-code baseline, **79.56/100** after the first remediation cycle, **94.69/100** after the earlier implementation review, and **98.56/100** after the completed local pilot-foundations cycle.

That is **+53.31 points against the initial review**, **+32.06 against the clean-code baseline**, **+19.00 against the first implementation cycle**, and **+3.88 against the preceding accepted implementation review**. The exact current composite is **98.5625**, and its exact improvement over the earlier **94.6875** composite is **3.875** points.

All four reviewers approve the narrowly controlled, non-sensitive customer pilot. The procurement reviewer separately scores local-pilot purchase readiness **98/100**, but still vetoes unrestricted confidential-data or regulated enterprise deployment. Local tenant deletion, legal holds, reusable organizational context, independent review, delegated provisioning, encrypted recovery evidence, revision restoration, editable Office documents, and complete ordered media exports are implemented. Verified enterprise federation, customer-managed primary-storage encryption, production failover, hosted scheduling, replicated backups, and independent assurance remain externally dependent.

## Scope, revision, authorization, and evidence

The four goals supplied by the user remained unchanged:

1. Well-managed context is the most important aspect of generating quality, exacting content.
2. Forma supports managing deeply complex context in an easy-to-use manner.
3. One well-managed context can be the source of multiple generated output forms.
4. Forma’s event-sourced foundation supports manual, collaborative, and automated interactions that accelerate project success.

The assessment first recovered the original study, inspected the latest available local commit and existing application implementation, commissioned four independent role-specific reviews, and used subsequent adversarial rounds to select and verify concrete remediation. The local repository had no configured remote, so “latest” means the latest available local checkout rather than an independently fetched remote revision.

The current request explicitly authorized implementation. It did **not** authorize writing to existing application projects, creating a reporter project, submitting real paid model requests, changing provider accounts, deploying the application, or publishing externally. Accordingly:

- No customer or user project was created, edited, or repurposed.
- No production model/provider operation or new real billable generation was invoked.
- Evidence is derived from source, deterministic in-memory fixtures, production-bundle endpoint tests, and official vendor materials—not claimed production observation.
- A new in-app reporter exercise was not repeated. The original reporter artifacts supplied historical context, but this request did not separately authorize new application-data writes or provider spending.

The application changed during review; findings below distinguish the clean-code baseline, intermediate implementation, and final re-reviewed source.

## Scoring method

Each specialist independently assigned an integer from 1 through 100 to every required goal. The goal score is the arithmetic mean of the four reviewers’ scores. The composite is the arithmetic mean of all 16 goal/role cells; therefore every goal and every role contributes equally to the product composite.

Role-specific overall grades are reported separately and may use their own weights. Procurement’s purchasing score is explicitly stricter than the product composite and cannot override an unconditional security, privacy, legal, recovery, or identity veto.

### Score progression by goal

| Goal | Original study | Clean baseline | Iteration 1 | Prior review | Current final | Δ original | Δ prior |
|---|---:|---:|---:|---:|---:|---:|---:|
| G1: Context produces exacting content | 60.75 | 72.25 | 85.25 | 97.00 | **98.75** | **+38.00** | **+1.75** |
| G2: Complex context stays manageable | 41.50 | 58.50 | 76.25 | 93.50 | **97.75** | **+56.25** | **+4.25** |
| G3: One context creates many outputs | 57.25 | 71.75 | 83.50 | 94.25 | **99.00** | **+41.75** | **+4.75** |
| G4: Events accelerate collaborative work | 21.50 | 63.50 | 73.25 | 94.00 | **98.75** | **+77.25** | **+4.75** |
| **Equal-weight composite** | **45.25** | **66.50** | **79.56** | **94.69** | **98.56** | **+53.31** | **+3.88** |

The largest improvement is the event-system goal. It moved from an essentially unconvincing collaboration/automation proposition to actual shared authorization, accountable review, scoped notifications, governed release, and privacy-aware immutable history.

### Final score matrix, with change against the original study

| Goal | End user | Market researcher | Product owner | Procurement officer | Mean |
|---|---:|---:|---:|---:|---:|
| G1: Exacting context | **98** (+46) | **99** (+26) | **99** (+42) | **99** (+38) | **98.75** |
| G2: Complex-context usability | **97** (+57) | **99** (+68) | **98** (+46) | **97** (+54) | **97.75** |
| G3: Many durable outputs | **99** (+31) | **99** (+51) | **99** (+54) | **99** (+31) | **99.00** |
| G4: Manual/team/automated events | **98** (+77) | **99** (+75) | **99** (+77) | **99** (+80) | **98.75** |

### Role-specific decision progression

| Reviewer | Original role verdict | Latest-code baseline | Iteration 1 | Final role verdict | Δ original |
|---|---:|---:|---:|---:|---:|
| End user | 48 | 63 | 79 | **98** | **+50** |
| Market researcher | 44 | 65 | 80 | **99** | **+55** |
| Product owner | 44 | 66 | 79 | **99** | **+55** |
| Procurement buying decision | 29 | 58 | 71.05 | **98** | **+69** |

These role verdicts are not substitutes for the 16-cell composite: the end user and product owner apply role-specific goal weights, while procurement uses a separate ten-dimension buying model.

## What changed between the original review and the latest clean baseline

The initial review identified a plausible architecture but weak end-to-end delivery: confusing complex context, weakly evidenced source intake, incomplete finished-work workflows, collaboration that did not convincingly survive tenant boundaries, and an event system that recorded activity without demonstrably accelerating teams.

By the latest local revision, the project had already gained meaningful product surface and multi-account collaboration primitives. The baseline score rose to 66.50, and G4 rose from 21.50 to 63.50. However, independent reassessment still found serious gaps:

- Sensitive customer-authored prose could survive in immutable event payloads or derived caches.
- Previously generated work and the sensitive execution evidence surrounding it did not have adequately differentiated retention behavior.
- Complex customer documents could be uploaded without becoming reliable, inspectable generation context.
- A client could overstate context/source authority, rights, or source versions.
- Finished generated outputs were not consistently correctable as the actual retained deliverable.
- Independent approval existed conceptually but lacked a usable, customer-owned reviewer assignment path.
- Context changes could leave review decisions stale or race with approval/export.
- Reviewer authorization did not reliably control actual external handoff.
- Project-level notifications and other useful event-triggered follow-up were weak or absent.
- Account analytics, media ownership, and offline custody needed stricter principal/project boundaries.

The remediation cycles deliberately prioritized these trust and completion problems before adding speculative surface area.

## Implemented remediation, by product outcome

### 1. Context is now authoritative, rights-aware, and understandable

Forma reconstructs provider-facing context from authorized server-side history rather than accepting the browser’s preferred snapshot as truth. Actual document identity, project scope, source versions, selected Canvas context, required exclusions, source rights, rights expiration, and contradictory mandatory decisions are checked before generation.

The interface adds actionable context-health feedback and an optional guided project brief that can establish the objective, audience, intended output, hard exclusions, and licensed source without forcing fabricated placeholder content.

Generation-readiness caching now validates the entire trusted tuple: document, document revision, request kind, prompt technique, production mode, Canvas selection, context selection, and the actual context event head. Cross-document cache-key reuse cannot silently substitute stale readiness.

Key implementation: `worker/context-authority.ts`, `src/model/context-health.ts`, `worker/generation-readiness.ts`, `src/components/forma-projects.ts`.

### 2. Source documents become real, verified, inspectable evidence

Supported uploads include images plus selectable PDF, DOCX, PPTX, XLSX, plain text, Markdown, CSV, and JSON. Document extraction occurs in Forma’s worker against the exact uploaded bytes; anchored evidence preserves PDF pages, Word paragraphs, PowerPoint slides, spreadsheet cells, or text-line ranges.

The resulting canonical receipt cryptographically binds:

- the original source SHA-256 digest;
- trusted source MIME type and exact object owner;
- extraction status and document kind;
- complete bounded model-facing extracted text;
- every displayed source anchor and quoted excerpt;
- segment count and truncation state.

Both personal and shared event admission reject fabricated excerpts, altered anchors, content-hash mismatches, wrong owners, and attempts to present an ordinary owned image as an unattested PDF. Verified source evidence cannot later be silently rewritten. The interface exposes the original file, cited passages, actual source locations, the file digest, unavailable-extraction explanations, and truncation.

Safety limits are explicit: maximum 12 MB upload, 120 grounded segments, 120,000 grounded characters, bounded decompression, path/ZIP safeguards, encrypted-file rejection, truthful unsupported-OCR behavior, accurate multi-stream PDF page association, and disclosure when a page cannot be verified.

Key implementation: `src/model/source-documents.ts`, `worker/media-api.ts`, `worker/project-access.ts`, `worker/events-api.ts`, `src/components/context-block.ts`, `tests/source-documents.test.mjs`.

### 3. Finished deliverables can actually be finished

Stories, scenes, presentations, storyboards, and video narratives can now be corrected as the real retained output—not merely copied into an unrelated editable context block. The endpoint checks current owner/project access, content scope, item boundaries, revision, structure, and SHA-256 metadata. The retained body and immutable operational edit event commit together; competing updates fail with a usable revision conflict.

An edit does not invoke a model provider and immediately invalidates any previous release approval. For slides and other structured output, individual headings, body text, and notes can be adjusted.

Finished output bodies are durable. Exact provider/source-input evidence uses its own configurable governed window, defaulting to 365 days, and transient prompts remain on their shorter retention schedule. Still-live historical generated work is migrated before cleanup; already expired work is not falsely resurrected.

Key implementation: `worker/artifact-api.ts`, `src/components/document-artifacts.ts`, `worker/pilot-policy.ts`, `worker/runtime.ts`.

### 4. Reviewer designation is usable and least-privilege

An organization/project manager can directly assign or revoke an exact-project reviewer through visible workspace settings. Reviewers may be ordinary editors or **read-only viewers**; viewer reviewers can approve or request changes but cannot author context, edit artifacts, run provider jobs, or acquire broader organizational access.

Approval requires all of the following:

1. A real completed output belonging to the selected project/document.
2. A formal review request.
3. Actual current, complete source block versions.
4. An active exact-project review capability.
5. A reviewer who did not create, submit, or edit that output.
6. An unchanged project stream between validation and transaction commit.

The interface hides ineligible self-approval actions and explains the separation-of-duties requirement. Viewer-only review actions recheck membership and reviewer capability inside the same guarded transaction. Grant/revoke changes are audit-logged, and revocation invalidates active project sessions.

Key implementation: `worker/artifact-review.ts`, `worker/workspaces-api.ts`, `worker/project-access.ts`, `worker/access-policy.ts`, `src/components/forma-workspace-settings.ts`.

### 5. Review governs real release, including existing shared links

For newly governed outputs carrying verified source versions, independent approval is not merely a badge:

- Markdown, generated media, PDF, and structured document exports require the currently approved output and source revision.
- External project share creation is rejected until all governed outputs included in the document are independently approved.
- Existing public share views and media access stop when a later edit or context change invalidates approval.
- Export events cannot hide inside mixed export/mutation batches.
- Both export and external-share creation use transaction-bound source stream heads, preventing approval-check/time-of-release races.
- The interface disables unavailable PDF, Markdown, and media downloads instead of promising a handoff that the server will reject.

Historical outputs with no verifiable source revision are intentionally grandfathered for backward compatibility. This is **not** a suitable regulated-enterprise policy; the controlled pilot must exclude those records or regenerate them into governed outputs.

Key implementation: `worker/project-access.ts`, `worker/shares-api.ts`, `src/components/document-artifacts.ts`, `src/components/presentation-deck.ts`.

### 6. Event history is operationally useful without trapping authored prose

All newly written event bodies are split into an immutable, operationally safe envelope plus a separately erasable owner-scoped payload. The envelope retains identifiers and counters needed for sequencing, project scoping, notifications, accounting, and review, but excludes authored prose, nested creative context, document text, and secret source excerpts.

The administrator-invoked historical migration handles **every** event type rather than relying on an incomplete sensitive-event allowlist. It preserves event IDs, SQLite row IDs, stream sequences, client receipts, project cursors, database triggers, and exact hydrated historical folds. Dedicated regressions cover preferences, collections, renamed collections, forked documents, edited chips, judgment notes, and future uncatalogued event types.

The customer-facing personal erasure flow clearly describes its actual boundary: shared organization work, durable finished outputs, uploaded objects, backups, and other devices are not comprehensively removed. It refuses to imply complete personal-context erasure while unprotected historical rows remain.

An indexed, bounded global sweeper physically redacts expired prompts and governed evidence even when their original account owner never returns. Application traffic schedules cleanup at most every five minutes per running isolate; the worker also exposes a scheduled entrypoint. **Actual hosting cron registration and a no-traffic deletion SLA have not been verified.**

Key implementation: `worker/event-privacy.ts`, `worker/event-privacy-migration.ts`, `worker/privacy-api.ts`, `worker/runtime.ts`, `worker/index.ts`, `drizzle/0015_true_lila_cheney.sql`.

### 7. Collaboration and automation now perform useful work

Committed project events automatically create bounded, 30-day teammate notifications for review requests, approvals, requested changes, finished results, output edits, and source-context changes. Recipients must still possess active exact-organization/project memberships, and notification bodies never copy customer prose. The acting user does not notify themselves.

Additional isolation improvements include injective per-owner media namespaces, verified legacy-media compatibility, principal-scoped analytics, project-entitled reporting, and strict offline Canvas custody limits: 14 days, 10,000 operations, and 50 MB within one authorization boundary.

“Ask Forma” now routes its requesting user to the same document’s private Chat view, where the actual assistant response is visible. Rule-based quick edits remain separately labeled rather than pretending to be model-backed assistance.

These are real automated event reactions. They should **not** be described as autonomous agents, configurable third-party workflows, email/Slack delivery, webhook orchestration, or unattended provider generation.

Key implementation: `worker/project-notifications-api.ts`, `worker/runtime.ts`, `worker/analytics-api.ts`, `src/sync/canvas-offline-queue.ts`, `src/components/forma-workspace.ts`.

### 8. The local pilot roadmap is implemented end to end

The final implementation cycle closes the five previously proposed local build priorities:

1. **Controlled pilot and retention:** exactly named, bounded cohorts; independent reviewer roles; participant and organization spending ceilings; prospective scoped retention; hold-aware cleanup; customer-visible retention evidence; and truthful disclosure that hosted scheduling is not independently configured.
2. **Finished-work history and handoff:** immutable revision bodies, conflict-safe restoration, fresh independent review after restoration, genuinely editable DOCX/PPTX documents, and complete storyboard/multi-scene ZIP exports containing ordered original bytes, an authored README, and an exact revision/digest manifest.
3. **Canonical organizational context:** organization-owned licensed source copies, verified evidence and citations, immutable published package versions, document-specific pinned/follow-approved bindings, explicit update acceptance, governed read-only boundaries, and downstream change notification.
4. **Reviewer workflow and automation:** exact reviewer assignment and reassignment, actor-independent approvals, actionable revision-bound feedback, targeted project notifications, bounded deterministic reminders, immediate role revocation, and visibility-aware passive collaborative event refresh.
5. **Local enterprise foundations:** exact tenant legal holds and deletion, independently verified object removal, partial-deletion resumption, closed customer-identifier privacy allowlists, historical privacy migration, delegated organization provisioning, versioned recovery-root keyrings, encrypted tenant snapshots, and explicitly scoped rollback-verified recovery exercises.

Recovery terminology is deliberately precise: an **isolated rollback exercise** decrypts the authentic tenant snapshot, checks project membership/custody and evidence integrity, stages customer records inside one atomic SQLite transaction, and proves that every staged row/table is rolled back. It does **not** restore a production tenant, recreate media objects, provide replicated backups, or establish a contractual RPO/RTO. Failed encrypted-object uploads remain durably inventoried, can be retried by the exact owner even if the root is absent, and never authorize unsafe cleanup of an active upload.

## Independent adversarial findings

### End user — 98/100

Required goals: **98 / 97 / 99 / 98**.

The end user’s threshold is whether one real person can enter defensible evidence, understand the instructions, finish an actual deliverable, get an answer from the assistant, submit the result for review, and safely hand it off.

**Hard passes:** Server-verified source intake; visible evidence and governed context; revision inspection/restoration; editable Word and PowerPoint; complete ordered storyboard/video media archives; actionable independent reviewer feedback; passive shared-project refresh; explicit owner-accessible rollback recovery and cleanup retry.

**Local hard failures:** None. A composed final multi-scene MP4 remains unavailable and is not misrepresented as part of the local-pilot deliverable.

**Objection:** Neither an elegant event model nor a passing approval check excuses work that cannot be recovered or delivered in the recipient’s normal tools.

**Pilot decision:** Accept the bounded creator/team pilot with supported source files, editable Office handoff, complete ordered media archives, honest rollback-only recovery, and non-sensitive source restrictions.

### Market researcher — 99/100

Required goals: **99 / 99 / 99 / 99**.

The market researcher accepts the underlying problem but rejects undifferentiated “AI canvas,” “AI agent,” or “one context, many outputs” claims. Those features already exist in aggressively priced, well-integrated incumbent offerings.

**Hard passes:** Internally verifiable source extraction; reusable versioned organizational context; independently licensed source custody; durable editable outputs; reviewer-only signoff; approval-gated editable Office and complete original-media handoff; scoped reminders; and truthful operational recovery evidence.

**Local hard failures:** None. OCR, live URLs, external connectors, customer-defined outbound automation, output claim-level citations, and composed final video remain optional market-expansion opportunities rather than conditions for this pilot.

**Objection:** The defensible wedge is verified source → enforceable creative decisions → durable editable outputs → independent release approval. Additional generic dashboards, agent personas, or output formats do not create defensibility without measured customer outcomes.

**Pilot decision:** Commercially defensible for a constrained paid pilot with transparent usage pricing and explicit input/output limitations.

### Product owner — 99/100

Required goals: **99 / 98 / 99 / 99**. Role-specific weighted score: 30% G1, 25% G2, 25% G3, and 20% G4; **98.75**, rounded to **99**.

The product owner evaluates one coherent journey rather than a collection of individually attractive features:

`guided brief → verified source → authorized context → generated outputs → direct correction → independent viewer review → approved release → change notification`

**Hard passes:** One actual end-to-end journey; immutable exact-source organizational context; explicit governed version adoption; least-privilege review and targeted feedback; race-safe approval/release; historical output restoration; Word/PowerPoint and ordered-media archives; scoped automation; owner-visible recovery and recoverable deletion; honest unsupported-feature disclosures.

**Local hard failures:** None. Fair parallel execution across independent owner workloads and genuine production tenant/media restoration remain future operational work; neither is falsely advertised as complete.

**Objection:** Delivering editable slides before ensuring the slides cannot be exported without independent approval would optimize the distribution of an unapproved mistake. Conversely, full enterprise records management is not a prerequisite for a carefully bounded, honestly scoped pilot.

**Pilot decision:** Authorize a 30-day controlled customer pilot with approximately 5–10 named participants after full endpoint integration gates pass.

### Procurement officer — 98/100 local-pilot buying readiness

Required goals: **99 / 97 / 99 / 99**. Procurement approves a **98/100 local, non-sensitive, controlled-pilot purchase decision** while retaining an unconditional veto on unrestricted enterprise production.

| Buying criterion | Weight | Score |
|---|---:|---:|
| Tenant/project isolation | 15% | 99 |
| Pilot-scoped identity and provisioning | 10% | 92 |
| Locally verified privacy, retention, and deletion | 15% | 99 |
| Team collaboration and independent review | 15% | 99 |
| Context governance and source authenticity | 10% | 99 |
| Auditability and dual control | 5% | 99 |
| Spending and provider controls | 10% | 98 |
| Approved output portability | 10% | 98 |
| Honestly scoped local recovery operations | 5% | 96 |
| Differentiated pilot ROI hypothesis | 5% | 96 |

**Hard passes:** Thirty-day named cohorts and $15/$150 caps; reviewer escalation resistance; immutable organization-owned licensed context; closed operational identifier allowlists; exact-tenant privacy migration and deletion; hold-aware historical restoration; approval-gated editable Office/media ZIP exports; targeted reviewer reminders; versioned environment-owned recovery roots; rollback-verified staging; and retry-safe encrypted object cleanup.

**Unconditional enterprise no-buy conditions:** External backup/device deletion remains unverified; primary database/object encryption and external customer-managed keys remain unattested; customer SSO/SCIM/MFA/domain verification is absent; production tenant/media failover and independently witnessed RPO/RTO are unavailable; and hosted scheduling, DPA, SOC 2/ISO, penetration testing, accessibility, incident response, and contractual service evidence have not been independently established.

**Objection:** A scheduled function in source is not proof that production actually provisions and monitors its trigger; an erasable application database is not equivalent to comprehensive customer offboarding; a strong review flow does not create disaster-recovery evidence.

**Pilot decision:** Approve only non-sensitive or public customer data, named accounts, explicit usage caps, upstream managed identity, distinct reviewer accounts, current versioned outputs, and written acknowledgment of deletion/export limitations. Reject unrestricted enterprise purchase.

## Market validation and competitor alternatives

All public sources below were checked on August 23, 2026. Vendor-sponsored surveys and advertised vendor capabilities establish market direction; they are not independent proof of Forma outcomes.

### Problem validity

Atlassian’s 2026 State of Teams research reports a double-blind survey of 12,035 knowledge workers and 173 executives, and identifies a small minority of teams as effectively connecting AI with context, workflows, and culture. This supports Forma’s contextual-governance thesis but does not prove Forma-specific return on investment. [Atlassian, State of Teams 2026](https://www.atlassian.com/blog/state-of-teams-2026).

Adobe’s 2026 content-management research reports organizational data quality, integration, and operational readiness as meaningful obstacles to agentic and generative-AI adoption. The research is first-party/vendor-sponsored and should be interpreted accordingly. [Adobe, 2026 content-management digital trends](https://business.adobe.com/resources/reports/content-management-digital-trends.html).

### Competitive landscape

| Alternative | Public reference price | Strength relevant to Forma | Remaining defensible Forma distinction |
|---|---|---|---|
| Google Gemini Notebook Enterprise | $9/license/month; annual discounts may apply | Large grounded document corpora, broad file/URL/audio sources, shared notebooks, enterprise identity integration. Official limits include 300 sources/notebook and up to 500 MB or 500,000 words/source. | Explicit enforceable creative constraints, attributable editable deliverables, current-source approval, least-privilege release control. |
| Miro Business / Enterprise | $20/member/month annual or $25 monthly for Business; Enterprise packaging varies | Collaborative visual work, a single shared context creating multiple business outputs, workflow/prototype packaging. | Server-bound licensed source receipts and independent approval against exact context/output revisions. |
| Adobe GenStudio / Workfront | Contact sales; packaging depends on product/integration | Brand guidance, reviewers/approvers, campaign production, enterprise ecosystem. | Accessible exact source/context lineage and event-bound independent approval; do not compare against standalone GenStudio while ignoring Workfront integration. |
| Airtable | Team $20/user/month annually; Business $45/user/month annually; Enterprise custom | Organization-scale workflow/data model, automations, agent/human audit positioning. Some detailed AI-credit audit features require Enterprise Scale. | Creative-decision semantics, exact source provenance, governed artifact editing/release. |
| Jasper Pro | $59/month annually or $69 monthly | Familiar creative-market pricing, brand-oriented AI content, established market awareness. | Verifiable source-to-decision-to-review chain rather than generic content generation. |

Primary-source references:

- [Google: Gemini Notebook Enterprise product and licensing](https://cloud.google.com/resources/notebooklm-enterprise)
- [Google: Gemini Notebook Enterprise capabilities, source limits, and static-copy behavior](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/overview)
- [Miro: Business-plan pricing](https://miro.com/business-plan/)
- [Miro: Shared-context AI workflow announcement](https://miro.com/newsroom/miro-launches-ai-workflows/)
- [Miro: August 17, 2026 enterprise packaging](https://miro.com/blog/enterprise-pricing-miro/)
- [Adobe: Approval lifecycle and Workfront Proof caveats](https://experienceleague.adobe.com/en/docs/genstudio-for-performance-marketing/user-guide/approve/overview)
- [Adobe: Brand/content guidelines](https://experienceleague.adobe.com/en/docs/genstudio-for-performance-marketing/user-guide/guidelines/add-guidelines)
- [Airtable: Current pricing](https://airtable.com/pricing)
- [Airtable: Agent audit positioning](https://www.airtable.com/articles/agent-audit-log)
- [Airtable: Enterprise Scale-only AI-credit audit tracking](https://support.airtable.com/articles/5959979753-tracking-ai-credit-consumption-in-airtable-audit-logs)
- [Jasper: Current plan pricing](https://www.jasper.ai/pricing)

Prices reflect published tiers and billing assumptions, not directly comparable entitlements. Competitor subscriptions and Forma’s metered provider-generated media have materially different cost structures; compare actual monthly team usage and paid output volume before asserting price equivalence.

## Remaining release blockers and honest limitations

### Pilot activation gates

1. **Verified locally:** the fresh production bundle passes real worker-endpoint coverage for controlled enrollment, viewer-only grant, independent review, immutable context versions, output history, editable Office/media exports, source isolation, release, privacy migration, legal holds, encrypted recovery, cleanup retry, partial deletion recovery, and revocation. Repeat the complete suite against the exact release candidate before promotion.
2. The pilot must contain only new source-versioned governed outputs. Compatibility-grandfathered historical results must not be treated as approved organizational releases.
3. Real hosting must provision and monitor the scheduled retention trigger before any contractual no-traffic deletion SLA is promised.
4. Provider budgets, permitted source sensitivity, organization ownership, upstream identity controls, and named reviewer separation must be agreed in advance.

### Enterprise-blocking, but not required for a non-sensitive bounded pilot

1. Verified destruction across external platform backups and other devices; local exact-tenant D1/R2 deletion, scoped legal holds, retention exceptions, deletion receipts, and resumable cleanup are already implemented.
2. Independently attested primary D1/R2 encryption, external customer-managed key custody, and cryptographic destruction; versioned application-owned recovery envelope encryption is already implemented.
3. Verified customer identity federation, enforced MFA/conditional access, domain ownership, and actual SCIM interoperability; local scoped provisioning and group-role controls are already implemented.
4. Replicated encrypted backups and actual production tenant/media restoration with witnessed RPO/RTO; encrypted snapshots, integrity verification, and isolated rollback staging are already implemented but explicitly do not provide production failover.
5. Third-party security/privacy/accessibility evidence: DPA, subprocessors, residency, penetration testing, incident response, SOC 2/ISO, and WCAG/VPAT.

### Product and market limitations

- No assembled final MP4 for multiple generated video scenes.
- No scanned-document OCR, live URL ingestion, cloud-drive sync, or source-refresh policy.
- No claim-level citation links inside individual generated output statements.
- Reviewer notifications remain intentionally in-app; no external notification digests or enterprise escalation delivery are provided.
- No customer-configurable webhook, email, Slack, service-principal, or external automation platform.
- Independent jobs sharing an owner can still contend behind that owner’s event/job stream.
- No production tenant or original-media restoration; the implemented recovery exercise is isolated, transactional, and deliberately rolled back.

## Practical next-version implementation plan

Effort below is directional engineering scope, not a contractual estimate. Suggested roles can be combined in a small team.

### Phase A — Pilot assurance and operational activation

**Current status:** Local controlled-pilot authorization, exact named enrollment, budget ceilings, retention policies, legal holds, scheduler receipts, and all currently scoped customer-facing local-pilot controls are implemented. Hosted trigger provisioning and monitoring remain external release prerequisites.

**Owner:** product owner + security/backend engineer.  
**Indicative effort:** 3–5 engineering days.  
**Dependencies:** the implementation and generated schema migration in this assessment.

Implementation steps:

1. **Complete locally; repeat for the release candidate:** build the current production bundle and run its full endpoint suite against isolated, synthetic in-memory tenants.
2. **Complete locally; retain as release gates:** exercise negative fixtures for cross-tenant citations, viewer-only edit/generation denial, revoked reviewer sessions, mixed approval/export batches, source-change races, stale shared links, and zero unauthorized provider calls.
3. Provision the scheduled retention trigger in the actual hosting environment; record observed executions, duration, redacted counts, and failures.
4. Quarantine legacy unversioned outputs or force an explicit regeneration/review before any regulated sharing is enabled.
5. Configure and validate the already implemented named-user pilot budgets, owner/reviewer roles, acceptable source classes, and pause/close kill switch for the actual customer cohort.

Acceptance:

- All production-bundle unit/integration suites pass.
- Viewer-only reviewers can approve but cannot edit, generate, or cross tenant boundaries.
- Invalid rights, fabricated source evidence, stale approvals, and unapproved releases produce zero provider calls and zero unauthorized writes.
- Inactive-account evidence is physically redacted within the agreed maximum once the scheduler is actually configured.
- At least two distinct source formats produce two independently approved output forms in one controlled project.

### Phase B — Recovery and professional handoff

**Current status:** Local revision history/restoration, editable DOCX/PPTX exports, complete ordered scene/frame ZIP archives, encrypted snapshots, safe rollback recovery exercises, and retry-safe object cleanup are implemented. Production tenant/media restore, replicated backups, and optional final MP4 composition remain outside the local pilot boundary.

**Owner:** product owner + document/output engineer.  
**Indicative effort:** 1–3 weeks.  
**Dependencies:** durable artifacts, review/release policy, exact media ownership.

Implementation steps:

1. **Implemented locally:** store governed artifact-revision bodies with bounded per-tenant retention and release-aware ownership.
2. **Implemented locally:** inspect and restore historical revisions; append an auditable new revision and invalidate prior approval without overwriting history.
3. **Implemented locally:** export genuinely editable DOCX/PPTX and complete ordered original-media ZIP files with exact digest-bound release receipts.
4. **Implemented locally in part:** authenticate and stage encrypted tenant snapshots, including original-media bytes and role metadata, then automatically roll back. Real production restore and replicated backup require separate infrastructure work.
5. Either implement authorized multi-scene video composition or continue labeling the output as individually playable scenes.

Acceptance:

- A user can recover an earlier manuscript/slide revision after two conflicting edits.
- Exported DOCX/PPTX opens as genuinely editable content in standard workplace software.
- Encrypted tenant snapshots preserve authorized records/source bytes for an isolated, automatically rolled-back integrity exercise, while ordered original-media ZIP archives contain every approved scene/frame without leaking erased or foreign-tenant content. Actual production restoration remains a Phase E external prerequisite.
- Any restored or changed output requires a fresh independent review before external release.

### Phase C — Canonical context packages and trustworthy reuse

**Current status:** Immutable tenant-owned packages, independent licensed source custody, published versions, pinned/follow-approved bindings, explicit change acceptance, governed read-only decisions, and scoped downstream notifications are implemented. Universal claim-level citations remain an optional future enhancement.

**Owner:** domain/backend engineer + product designer.  
**Indicative effort:** 2–4 weeks.  
**Dependencies:** authoritative context, event-private payloads, source evidence receipts, approvals.

Implementation steps:

1. **Implemented locally:** immutable organization-owned packages and published versions with source rights, content digests, and evidence receipts.
2. **Implemented locally:** explicit pinned/follow-approved document bindings and user-approved version acceptance.
3. **Implemented locally:** exact source decision, package/version, downstream document, output, and approval dependency tracking.
4. **Implemented locally:** governed source/version differences and targeted downstream update notification before explicit acceptance.
5. Provide optional output-claim citation spans that point to actual verified page/paragraph/slide/cell evidence without claiming universal factual correctness.

Acceptance:

- One approved context package drives at least three independently governed documents/output forms.
- A source change marks only genuinely dependent outputs stale.
- Pinned outputs do not silently change; following outputs update only after explicit policy-authorized acceptance.
- Every currently displayed source-evidence citation resolves to an entitled, verified source segment; generated-output claim citation spans remain an optional future enhancement.

### Phase D — Targeted collaborative automation and fair execution

**Current status:** Exact reviewer assignment/reassignment, due dates, actor-specific inboxes, deduplicated in-app reminders, scoped notification controls, and visibility-aware passive event refresh are implemented. Fair multi-lane provider execution and external notification platforms remain expansion work.

**Owner:** collaboration/backend engineer + operations owner.  
**Indicative effort:** 2–4 weeks.  
**Dependencies:** approved context versions, exact project access, existing notification events.

Implementation steps:

1. **Implemented locally:** exact reviewer assignment, due dates, actionable feedback, reassignment, and bounded deduplicated in-app reminders; external digest/escalation delivery is not claimed.
2. Partition the owner-global job bottleneck using fair project/document/actor lanes while preserving authoritative stream sequencing and budget reservations.
3. Add an idempotent durable outbox for approved external notifications or integrations; retain exact tenant, actor, provider, and redaction boundaries.
4. **Implemented locally:** explicitly authorized, tenant-scoped in-app automation that cannot initiate paid generation or external delivery.
5. **Implemented locally in part:** bounded review/context routing and deterministic reminders; hosted scheduled rights-expiration delivery remains future infrastructure work.

Acceptance:

- Unrelated projects/documents make progress concurrently with no duplicate spend or cross-project source leakage.
- A source/review change notifies only the assigned, active, entitled reviewers.
- Revoked users receive no new task or integration event.
- Automated rules cannot invoke paid generation without explicitly authorized budget and policy.

### Phase E — Enterprise custody and buying readiness

**Current status:** Locally enforceable deletion, scoped retention/legal holds, delegated provisioning, group-role reconciliation, customer-specific operational privacy, AES-GCM tenant recovery envelopes, root-keyring continuity, and rollback drills are complete. Actual enterprise identity, KMS, primary-storage encryption, replicated disaster recovery, external backup/device deletion, and independent compliance require external platform/operator evidence.

**Owner:** security/privacy lead + identity/platform lead + procurement sponsor.  
**Indicative effort:** 4–10+ weeks plus independent assurance/vendor processes.  
**Dependencies:** project export/recovery, operational scheduling, documented subprocessor and identity architecture.

Implementation steps:

1. **Implemented locally:** scoped retention/deletion, legal holds, held revision recovery, verified D1/R2 cleanup, retry-safe offboarding, and explicit receipts; external backups/devices remain disclosed exceptions.
2. **Implemented locally in part:** per-tenant AES-GCM recovery envelopes, safe key rotation, versioned environment-root keyrings, and historical-key preservation; external KMS and primary-store cryptographic destruction remain unverified.
3. **Implemented locally in part:** short-lived scoped provisioning, deprovisioning, group-role reconciliation, and reviewer anti-escalation; actual federated identity, MFA, domain verification, and SCIM remain external integration work.
4. **Implemented locally in part:** authenticated encrypted snapshots and witnessed rollback-only staging; actual replicated production restore/media failover and contractual RPO/RTO remain unavailable.
5. Publish and independently verify a DPA, subprocessors, residency controls, penetration-testing results, incident-response commitments, and accessibility conformance.

Acceptance:

- Tenant deletion removes authorized D1 payloads and R2 objects within the contracted window without affecting other tenants.
- Backup destruction completes within its documented retention window.
- Deprovisioning removes access within 60 seconds.
- Tenant key destruction renders all protected tenant payloads unreadable.
- A complete restore meets agreed **RPO ≤15 minutes** and **RTO ≤4 hours**.
- Customer legal, security, accessibility, and procurement teams approve the evidence independently.

## Controlled pilot proposal and success metrics

Run an exactly **30-day** pilot with one organization, approximately **5–10 named participants**, at least one real output author, and at least one independent viewer-only reviewer. Use public, synthetic, or explicitly non-sensitive and appropriately licensed sources.

Recommended commercial boundaries:

- Provider-spend ceiling: **$15 per person** and **$150 per organization** during the pilot.
- Preliminary fully loaded pricing objective: **at most $45 per user monthly**, revisited after actual provider/media usage is measured.
- Evidence retention: explicitly set, documented, and acknowledged separately from the fixed 30-day pilot window.
- Legacy unversioned outputs: excluded.
- External sharing: allowed only after independent approval of the exact current source and output revision.

Measure:

1. **At least 30 minutes saved per user weekly** on source preparation, correction, review, and handoff.
2. **At least 25% faster** completion of an approved three-format deliverable.
3. **At least 30% fewer** review/rework loops versus the team’s existing process.
4. **At least 95% adherence** to mandatory source constraints.
5. **100% rights-confirmed, server-verified grounded sources** and honest truncation disclosure.
6. **Zero** successful cross-tenant reads, fabricated source citations, self-approvals, stale approvals, unapproved releases, or revoked-reviewer actions.
7. **Zero** provider calls or charges after rejected rights, authorization, or source-integrity checks.

At an illustrative $75 hourly labor rate, saving 30 minutes weekly corresponds to approximately $162 per user monthly. Compared with a $45 all-in ceiling, that is roughly **3.6× gross labor benefit before implementation and management costs**. This is a pilot hypothesis, not an observed return.

## Verification record

The final implementation was verified against the latest available local baseline, commit `eab3aa0130fe8a3607fbf44fc241933f8d37605a`; this checkout has no configured Git remote. All checks below ran after the complete implementation and the final source-integrity/recovery fixes:

- `pnpm build`: **passed**, producing current client and server production bundles and a Custom Elements Manifest for **122 elements**.
- `pnpm typecheck`: **passed** with no TypeScript errors.
- `pnpm cem:check`: **passed**; the checked-in and public component manifests match the current **122-element** implementation.
- `pnpm i18n:check`: **passed** for **6,011** system phrases, **1,782** English messages, **886** referenced message IDs, **21** block types, and **three** translated locales.
- `pnpm test`: **845 tests passed; 0 failed, cancelled, skipped, or marked TODO**. This command independently rebuilt both server/client production bundles and reran localization/component-manifest generation before executing the complete suite.
- Dedicated direct-source editable Office, ordered-binary ZIP, local-root provisioning, privacy migration, rights/context, reviewer, and retention checks: **33 tests passed**.
- Production-worker regressions cover exact named-pilot authorization, spending races, reviewer anti-escalation, immutable package adoption, legal-hold restoration, owner succession, historical root-key preservation, rejected unsafe rotations, rollback-only tenant staging, ambiguous R2 writes, root-independent cleanup retry, partial-deletion recovery, closed-cohort reviewer restrictions, and revoked provisioning enrollment.
- Local development encryption was configured with `pnpm setup:local-encryption`; the generated root remains only in the ignored permission-restricted local environment, and repeated/invalid setup behavior is covered by an isolated temporary-directory subprocess regression.
- Generated migrations `drizzle/0015_true_lila_cheney.sql`, `drizzle/0016_living_tarantula.sql`, and `drizzle/0017_previous_pixie.sql`: **created, inspected, and replay-tested**. They cover event privacy, controlled cohorts, artifact revisions, scoped retention, owner-protection triggers, organizational context packages, review automation, legal holds, tenant deletion, provisioning, key versions, and recovery snapshots.

The final adversarial cycle also uncovered and corrected a previously untested organization-owner succession SQL defect, closed-cohort reviewer escalation, customer-defined operational identifier leakage, retryable recovery/deletion failures that were initially invisible in the interface, preservation of held expired work, owner-root rotation continuity, and cold-start retention rewrites. Fault-injected tests now reproduce the relevant authorization, object-storage, and privacy failures before asserting their safe outcomes.

The retained development server remains running locally at `http://localhost:5173/`; after local root provisioning it automatically reloaded the ignored environment configuration and restarted within its existing retained session. A scheduled cleanup entrypoint exists in source; actual hosting-level schedule registration, deployment behavior, production identity perimeter, provider execution, and customer data were not exercised or modified. No existing customer project, paid provider, external deployment, or real production tenant was touched.

## Final recommendation

Proceed with the **30-day, named-participant, non-sensitive controlled pilot**. All four adversarial product roles and the additional retention/operations reviewers accept the implemented local scope; the final composite is **98.56/100**, and the complete **845-test** suite passes. Treat exact licensed organizational context, immutable version reuse, editable professional outputs, independent human review, approved media handoff, honest rollback recovery, and bounded operational automation as the core product.

Do not represent Forma as ready for unrestricted enterprise procurement. Promote it beyond the non-sensitive pilot only after actual hosted scheduling, verified customer identity, independently attested primary-storage encryption/KMS, transferable project custody, replicated production disaster recovery, external backup/device deletion, and independent legal/security/accessibility assurance cross measurable buying gates.
