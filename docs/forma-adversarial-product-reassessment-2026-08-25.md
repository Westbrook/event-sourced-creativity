# Forma: double-strict adversarial reassessment, implemented remediation, and release decision

- Assessment opened: August 25, 2026.
- Final independent panel decisions: August 26, 2026, America/New_York.
- Reviewed clean main revision: 41b82422229e666fdd542f6156b2504592240199.
- Verified live production during assessment: version 146 from the identical revision.
- Previous production version: 145, revision 87d31375258662665c283605a369d0fda71b5013.
- Assessment candidate: locally validated remediation on top of the production-equivalent revision; deployment was outside the assessment scope.
- Assessment authorization: local source changes, synthetic in-memory fixtures, mocked providers, and read-only production metadata; no real application-data writes, customer data, paid provider calls, deployment, or publication.

## Executive decision

Forma now earns unanimous approval from a deliberately more demanding, independently argumentative end user, market researcher, product owner, and procurement officer for a **named, consented, non-sensitive, manually operated local controlled pilot**.

Its defensible proposition is:

> Forma turns licensed, verified source material and first-party organizational decisions into exact, independently reviewed, reusable creative context; produces editable work in multiple forms; and immediately carries permissions, approvals, financial controls, and source-rights changes across the complete delivery chain.

The corrected double-strict composite improved from **71.38/100 to 92.44/100**, an improvement of **21.06 points** after multiple implementation and independent re-review cycles. Every role awards every product goal at least 88/100. Procurement separately approves the explicitly restricted pilot at **92.56/100**.

This does **not** mean enterprise production is approved. Procurement's comparable enterprise buying score improved from **44.33 to 70.07**, but the verdict remains **NO-BUY** until external identity, hosted scheduling, primary-storage encryption assurance, replicated production recovery, custody handoff, legal/compliance commitments, and independent accessibility/security evidence are independently verified. Local tests cannot substitute for those controls.

## Scope, reconciliation, and evidence contract

The review uses the user's four original goals:

1. Well-managed context is essential to generating quality, exacting content.
2. Forma makes deeply complex context manageable.
3. One governed context can produce many useful output forms.
4. The underlying event log accelerates manual, collaborative, and automated project work.

Live hosted metadata establishes that current local main and deployed production version 146 share the same source commit. Production version 145 corresponds to the older cached reference; an earlier suggestion that production lagged main is therefore false. No Git remote is configured, so there is no further remote branch to fetch. All subsequent changes exist only in the authorized local candidate.

Source paths below identify directly inspectable local implementation or deterministic tests. External claims are attributed to official first-party sources accessed August 25–26, 2026. Vendor pricing, tiers, contract terms, regions, taxes, and feature availability may change. Marketing claims and vendor-sponsored surveys are not independently demonstrated customer outcomes.

## Corrected initial double-strict scorecard

Each reviewer independently scored each shared goal from 1–100. Goal means average the four reviewers. The overall composite averages all 16 cells. Role-specific purchasing scores use their own documented criteria and must never hide a categorical release veto.

| Goal | End user | Market researcher | Product owner | Procurement officer | Initial strict mean |
|---|---:|---:|---:|---:|---:|
| G1: Exacting, context-grounded content | 76 | 76 | 76 | 74 | **75.50** |
| G2: Manageable, deeply complex context | 67 | 69 | 72 | 64 | **68.00** |
| G3: Many useful outputs from one context | 80 | 81 | 77 | 78 | **79.00** |
| G4: Event-driven individual and team progress | 58 | 71 | 68 | 55 | **63.00** |
| **Reviewer goal average** | **70.25** | **74.25** | **73.25** | **67.75** | **71.38** |

The initial end-user G2 score is **67**, not 60: cross-examination disproved the assertion that package decision counts counted files. The earlier draft composite of 70.94 reflected that retracted assertion and must not be quoted. The exact corrected initial composite is 71.375.

The earlier, differently scoped August 23 panel awarded 98.5625. The corrected initial double-strict review was **27.19 points lower**, primarily because it applied a materially harsher rubric and examined subsystems that the earlier restricted review did not test.

## Final independently accepted scorecard

| Goal | End user | Market researcher | Product owner | Procurement officer | Final strict mean | Change from initial |
|---|---:|---:|---:|---:|---:|---:|
| G1: Exacting, context-grounded content | **94** | **95** | **95** | **94** | **94.50** | **+19.00** |
| G2: Manageable, deeply complex context | **91** | **92** | **93** | **88** | **91.00** | **+23.00** |
| G3: Many useful outputs from one context | **93** | **94** | **94** | **92** | **93.25** | **+14.25** |
| G4: Event-driven individual and team progress | **88** | **94** | **92** | **90** | **91.00** | **+28.00** |
| **Reviewer goal average** | **91.50** | **93.75** | **93.50** | **91.00** | **92.44** | **+21.06** |

The exact final composite is 92.4375; its exact improvement over the corrected initial baseline is 21.0625. Compared with the less demanding August 23 score of 98.5625, the final double-strict result remains **6.13 points lower** because outstanding enterprise/market expansion gaps are explicitly scored instead of ignored.

| Specialist | Initial role verdict | Final role verdict | Comparable change | Final decision |
|---|---:|---:|---:|---|
| End user | 70 | **92** | **+22** | Restricted pilot approved |
| Market researcher | 63 | **91** | **+28** | Restricted pilot commercially credible |
| Product owner | 74 | **94** | **+20** | Restricted pilot product-ready |
| Procurement: restricted-pilot framework | Not scored under this framework | **92.56** | Not directly comparable | Restricted pilot BUY |
| Procurement: unchanged enterprise framework | 44.33 | **70.07** | **+25.74** | Enterprise NO-BUY |

Do not report 92.56 minus 44.33 as an improvement: those figures use different purchasing scopes and weights.

## Independent end-user verdict: 92/100

Goal scores: exactness **94**, complexity **91**, output variety **93**, event-driven completion **88**.

**Hard passes**

- Visible Word, PowerPoint, Excel, PDF, and plain-text material enters context with real source anchors, chart values, authored order, exact whitespace, and Unicode evidence. Hidden, deleted, invisible, ambiguous, unreadable, unlicensed, and revoked material fails closed: [source-document tests](/Users/westbrook/Documents/repos/codex/tests/source-documents.test.mjs:115).
- Project onboarding preserves named documents, optional briefs, real protected wording, explicit source-rights confirmation, accidental-dismissal drafts, and localized prompts: [project-intake tests](/Users/westbrook/Documents/repos/codex/tests/project-intake.test.mjs:57).
- The visible selection limit and actual client guard both admit up to 128 governed decisions; the server atomically adopts more than 50 privileged events without broadening ordinary user batches: [creator-capacity regression](/Users/westbrook/Documents/repos/codex/tests/project-intake.test.mjs:196), [bulk-adoption regression](/Users/westbrook/Documents/repos/codex/tests/assistant-runtime.test.mjs:458).
- A genuine Viewer reviewer sees complete proposed wording, include/avoid/prohibit intent, active state, exact whitespace and placements, relationships, sources, and rights before independent approval: [two-person pilot](/Users/westbrook/Documents/repos/codex/tests/assistant-runtime.test.mjs:397).
- Readable assistance preserves governed first-party decisions and hard boundaries, discloses incomplete context, and blocks paid dispatch when rights or protected multilingual content are unsafe: [assistant-context tests](/Users/westbrook/Documents/repos/codex/tests/conversation-context.test.mjs:34).
- Word exports retain editable tables and safe hyperlinks; PowerPoint defaults to audience-safe slides and requires a separate, authorized presenter export for private notes: [editable Office tests](/Users/westbrook/Documents/repos/codex/tests/office-documents.test.mjs:84), [audience-safe reading regression](/Users/westbrook/Documents/repos/codex/tests/output-viewer-focus.test.mjs:134).

**Hard failures inside the authorized pilot:** no P0 or P1. Remaining P2 friction includes in-app-only notifications, 30-second collaboration refresh, no OCR or connected cloud intake, partial archives rather than full restoration, and an honestly labeled scene collection rather than a composed movie.

**Adversarial objection:** approval theater, architectural elegance, and enterprise checklists are irrelevant if a person cannot preserve exact evidence, finish the assigned deliverable, and hand it to a stakeholder safely.

## Independent market-researcher verdict: 91/100

Goal scores: exactness **95**, complexity **92**, output variety **94**, event-driven progress **94**.

**Hard passes:** inspectable source-grounded creative direction; independently approved immutable organizational context; immediate cross-custodian license revocation; private rights-aware assistance; editable professional exports; actor-private provider evidence; and buyer-safe measurements of activation, approved/released deliverables, pending reviews, package adoption, turnaround, and settled cost per approved output: [organizational outcome reporting](/Users/westbrook/Documents/repos/codex/worker/workspaces-api.ts:412).

**Hard failures inside the authorized pilot:** no P0 or P1. Expansion gaps include permission-aware cloud and URL connectors, synchronization, OCR and larger corpora, finished composed video, external notification channels, uniform claim-level citations across every output, observed retention, validated willingness-to-pay, and sustainable media margins.

**Defensible differentiation:** not generic AI chat, broad company knowledge, or producing many formats. The potentially defensible wedge is **independently approved, exact, licensed creative direction that remains attributable, confidential, measurable, reusable, and immediately revocable through review and release**.

**Adversarial objection:** enterprise features and attractive architecture do not establish product-market fit; Forma must prove a faster time to an independently approved deliverable at a financially sustainable cost.

## Independent product-owner verdict: 94/100

Goal scores: exactness **95**, complexity **93**, output variety **94**, event-driven progress **92**. The weighted goal calculation is 93.65, rounded to 94.

**Hard passes:** localized intake; faithful confidential-source extraction; preserved protected decisions; real two-person independent package review; immutable versioned adoption; rights-aware bounded assistant reasoning; collaborative compare-and-swap editing; approved-output freshness; professional audience-safe handoff; truthful scene-package semantics; and independently audited uncertain spending.

Pure, organization-authored decisions remain usable even when their original source project or creator disappears; only genuinely licensed or reference-backed material requires a live source-rights check: [orphan-safe organizational ownership](/Users/westbrook/Documents/repos/codex/tests/context-package-rights.test.mjs:5).

**Hard failures inside the authorized pilot:** no P0 or P1. P2 follow-up includes explicit draft-review assignment, faster targeted notifications, an administrative uncertain-charge reconciliation interface, permission-bounded real cross-document synthesis, and actual video composition.

**Adversarial objection:** feature inventories and enterprise theatrics do not count unless they complete one honest chain from authorized source, through governed creation and human review, to durable stakeholder-ready work.

## Independent procurement verdict: pilot BUY; enterprise NO-BUY

Goal scores: exactness **94**, complexity **88**, output variety **92**, event-driven progress **90**. Equal-weight product assessment: **91.00**, up **23.25** points from 67.75.

### Restricted-pilot purchasing model

| Criterion | Weight | Final score |
|---|---:|---:|
| Trusted identity and exact tenant/project authorization | 20% | 94 |
| Spending controls and independent reconciliation | 18% | 96 |
| Pilot lifecycle, retention, legal holds, and safe deletion | 15% | 90 |
| Rights-aware organizational context and independent approval | 15% | 94 |
| Reviewer separation and audience-safe release | 12% | 94 |
| Event coordination and buyer-safe outcome measurement | 10% | 90 |
| Exports, recovery evidence, and operational continuity | 10% | 86 |
| **Weighted restricted-pilot readiness** | **100%** | **92.56** |

### Unrestricted enterprise purchasing model

| Criterion | Weight | Final score |
|---|---:|---:|
| Verified federation, MFA, provisioning, and domain ownership | 15% | 34 |
| Tenant isolation, privacy, and provider boundaries | 15% | 84 |
| Retention, deletion, and operational lifecycle | 15% | 61 |
| Financial authorization and independent reconciliation | 15% | 94 |
| Independent organizational governance | 10% | 92 |
| Provenance and enforceable licensing | 8% | 92 |
| Recovery, replicated restoration, and custody continuity | 8% | 35 |
| Scalable collaboration and operational delivery | 6% | 70 |
| Independently demonstrated accessibility | 4% | 60 |
| Demonstrated buyer-relevant outcome measurement | 4% | 79 |
| **Weighted unrestricted enterprise readiness** | **100%** | **70.07** |

**Pilot hard passes:** trustworthy platform identity and same-origin mutations; live organization/project/actor authorization; named consented cohort enrollment; independent uncertain-charge reconciliation; exact reviewer permissions; tenant-safe provider uncertainty and deletion; aggregate buyer-safe outcomes; revocable public sharing; and licensed-source governance across custodians.

**Enterprise hard vetoes:** no independently verified SSO/MFA/SCIM/domain ownership; no verified hosted no-traffic scheduling; no primary database/object-storage encryption or customer-managed-key assurance; no independently witnessed replicated production restoration, failover, RPO/RTO, or project-custody handoff; no executed DPA/subprocessor commitments, SOC 2/ISO evidence, independent penetration review, or accessibility attestation.

**Adversarial objection:** no user convenience, product-owner narrative, or competitor comparison justifies disclosing a revoked source, self-approving uncertain charges, pretending that local handlers are hosted operations, or purchasing enterprise deployment without verifiable controls.

## Corrected findings and cross-examined evidence

The panel explicitly retracts these initially suspected findings:

- Organizational package decision counts already count selected decisions; the original count-is-files allegation was false.
- The former 20-root presentation was not itself proof of a server defect, but a separate real client-side creator guard did reject legitimate selection above 20; that actual guard now matches the documented 128-decision limit.
- Canvas already supported recursive composition before this review; previous recursion-absent language was false.
- Editable output context is an intentional product capability, not automatically a protected-source bypass.
- A scene reel is transparently described as ordered scenes, not falsely asserted to be an existing combined film.
- Main and live production version 146 were already aligned; an older cached production reference was stale.

The following initial failures were independently demonstrated, remediated, and retested:

1. **Trusted identity and request origin.** Unverified standalone email assertions can no longer establish hosted identity; one same-origin policy fences state-changing APIs: [identity/origin regression](/Users/westbrook/Documents/repos/codex/tests/assistant-runtime.test.mjs:223).
2. **Confidential source fidelity.** Deleted/hidden Word text, hidden presentation slides/shapes/groups, hidden workbook content, invisible or unverifiable PDF text, ambiguous ZIP names, and unresolved chart evidence cannot enter trusted context; visible authored evidence remains exact: [source extraction](/Users/westbrook/Documents/repos/codex/src/model/source-documents.ts:148).
3. **Revocation across the complete delivery chain.** A revoked upstream license invalidates package version loading, new adoption, approved deliverables, new shares, existing public document/media links, personal-owner direct generation, personal-owner queued generation, and project-scoped queued generation: [cross-custodian route regression](/Users/westbrook/Documents/repos/codex/tests/data-loading-performance.test.mjs:2835).
4. **Late personal-owner bypass.** A final adversarial cycle discovered that organization scope was inferred after a personal-session rights check. Both immediate and queued generation now revalidate rights as soon as exact owner/project billing scope is known, before provider calls, generation events, reservations, or jobs: [direct-generation guard](/Users/westbrook/Documents/repos/codex/worker/events-api.ts:574), [queued-generation guard](/Users/westbrook/Documents/repos/codex/worker/document-jobs-api.ts:2138).
5. **Uncertain-charge separation of duties.** A task owner cannot self-reconcile an ambiguous provider submission. An independent, authorized reviewer must supply auditable evidence before a reservation is released: [independent billing control](/Users/westbrook/Documents/repos/codex/worker/assistant-api.ts:1198).
6. **Provider-safe tenant lifecycle and recoverable known charges.** Unresolved assistant/video submissions, executing image reservations, and provider-submission races block destructive deletion. A final adversarial transaction race confirmed that a newly submitted video without its provider identifier must remain running with both reservations protected even if that checkpoint appears immediately before cancellation. Missing, null, false, empty, and array-valued production anchors are never mistaken for a paid provider identity; only a genuine object anchor can authorize documented settlement. Fully documented, costable paid-video receipts remain recoverable and can be canceled only while preserving their original evidence and settling the exact billing account; never-submitted tenant work can be safely canceled and scoped mutable records erased: [tenant deletion controls](/Users/westbrook/Documents/repos/codex/worker/enterprise-api.ts:863), [paid-recovery and atomic-race regressions](/Users/westbrook/Documents/repos/codex/tests/document-reservation-recovery.test.mjs:442).
7. **Real two-person independent review.** Active, paused, and closed cohorts retain author/approver separation. A designated source-project Viewer can inspect the full proposal and independently approve without receiving authorship or administrator privileges: [reviewer route regression](/Users/westbrook/Documents/repos/codex/tests/assistant-runtime.test.mjs:397).
8. **Assistant confidentiality and exactness.** Governed approved first-party decisions inform permitted assistance without raw source transcripts, durable identifiers, private audio, unsafe rights, unsupported cross-document synthesis, truncated protected text, or overflowing multilingual context: [paid-specialist refusal regression](/Users/westbrook/Documents/repos/codex/tests/assistant-runtime.test.mjs:952).
9. **Truthful complex-context capacity.** Both the author interface and store permit 128 decisions; privileged adoption handles up to 384 guarded events while ordinary users retain their smaller batch boundary. Licensed packages are bounded to 12 MiB per source and 48 MiB total: [package source limits](/Users/westbrook/Documents/repos/codex/worker/context-packages-api.ts:46).
10. **Audience-safe, editable handoff.** Default PowerPoint delivery excludes confidential presenter notes; an explicit producer-only presenter variant remains available. Editable Word output preserves real tables and safe external hyperlinks: [presentation export](/Users/westbrook/Documents/repos/codex/src/components/presentation-deck.ts:217).
11. **Collaborative accountability.** Compare-and-swap rejects conflicting same-field edits; older unread assigned reviews remain discoverable; tenant-safe aggregate reporting includes approved/released outputs, review timing, reusable-context adoption, and settled cost per approved output: [shared-collaboration regressions](/Users/westbrook/Documents/repos/codex/tests/assistant-runtime.test.mjs:249).
12. **Source-rights freshness after approval.** Previously approved artifacts immediately become stale when an input license expires or its latest authoritative receipt is revoked: [artifact-approval regression](/Users/westbrook/Documents/repos/codex/tests/context-health-readiness.test.mjs:100).
13. **Scalable per-recipient notification retention.** Final all-project verification uncovered an overly expensive correlated cleanup on projects with thousands of events. A single recipient-partitioned ranking now preserves up to 1,000 notifications per person, prioritizes each person's oldest unread assignment, and lets a real 5,050-event Canvas history finish in approximately four seconds: [independent-recipient retention regression](/Users/westbrook/Documents/repos/codex/tests/assistant-runtime.test.mjs:299), [long-history integration](/Users/westbrook/Documents/repos/codex/tests/data-loading-performance.test.mjs:2062).

## Completed dependency-ordered implementation cycles

### Cycle 1: establish trustworthy pilot and source foundations — COMPLETE

Suggested owner: platform/security engineer plus source-ingestion engineer.

Delivered: named active-pilot admission, trusted platform identity, same-origin request protection, exact live tenant/project/actor checks, source-rights fail-closed behavior, exact visible Office/PDF/plain-text extraction, hidden-content exclusion, ambiguous archive rejection, authored slide/chart order, localized project briefs, keyboard-friendly file intake, and preserved in-memory drafts.

Acceptance passed: forged identity and cross-origin writes fail; hidden or revoked source material never becomes grounded evidence; visible charts, literal protected text, Unicode, and citations survive; licensed onboarding preserves exact authored intent.

### Cycle 2: contain financial uncertainty and destructive lifecycle races — COMPLETE

Suggested owner: platform/security engineer plus billing and operations owner. Depends on Cycle 1.

Delivered: independent audited uncertain-charge reconciliation; live scoped provider reservations; source and custody checks immediately before execution; safe distinction among never-submitted work, genuinely uncertain charges, and fully documented settleable provider receipts; deletion blocking for uncertain assistant/media/image submissions; transaction-boundary race protection; account-exact impersonation/recovery settlement; scoped assistant-metadata erasure.

Acceptance passed: no owner self-certifies an ambiguous charge; deleting organizations and stale members cannot dispatch; unresolved provider submissions prevent deletion; safe never-submitted work releases cleanly; documented paid work retains recoverable receipts and settles once against the correct actor/stream; provider-submission races do not produce false completion.

### Cycle 3: make organizational context reusable, inspectable, and governable — COMPLETE

Suggested owner: creative product engineer plus authorization engineer. Depends on Cycles 1–2.

Delivered: immutable source-bound package versions, distinct independent approval, source-project Viewer review, complete localized whitespace-preserving review previews, include/avoid/prohibit semantics, active state, exact wording and placements, relationship visibility, 128-decision selection, bounded source bytes, atomic privileged bulk adoption, version-correct provenance, and orphan-safe first-party organizational decisions.

Acceptance passed: a genuine two-person pilot creates, independently reviews, approves, and adopts governed context without granting the reviewer administrative or authoring rights; paused and closed cohorts cannot self-approve; first-party decisions survive source-owner removal while licensed decisions respect live upstream custody.

### Cycle 4: deliver safe assistance and professional, collaborative work — COMPLETE

Suggested owner: product, accessibility, and export engineers. Depends on Cycle 3.

Delivered: zero-cost pilot assistance; protected-first bounded multilingual decision context; request-local aliases; safe approved immutable grounding; rights/truncation/scope disclosure; paid specialist refusal when evidence is incomplete; collision-safe shared edits; older-unread-first notifications; independently reviewed output freshness; editable tables/links; safe default PowerPoint exports; explicit protected presenter copies; truthful scene-package and partial-archive semantics.

Acceptance passed: no raw private source or durable identifier enters provider-facing assistant context; unsupported synthesis incurs zero provider requests; protected wording remains immutable; authorized collaborators can correct generated work; audience exports contain no presenter secrets; every recipient retains their oldest unread assignment without quadratic cleanup; review work and measurable approved-output economics remain tenant-scoped.

### Cycle 5: cross-examine the complete revocation chain — COMPLETE

Suggested owner: procurement/security reviewer plus runtime engineer. Depends on Cycles 1–4.

Delivered: live revalidation of original source rights for every licensed governed package across loading, adoption, existing public shares/media, new shares, assistant eligibility, project release, direct generation, and queued generation. A final independent regression uncovered and closed both personal-owner-session variants after the initial scoped-path fixes.

Acceptance passed: revoke the original owner receipt after a different project adopts the source; all existing public links immediately stop; all three authorized/personal generation routes return the precise rights error; provider-call, generation-event, reservation, and queued-job counts remain unchanged.

## Competitive market evidence and commercial position

The problem is genuine: creative teams repeatedly coordinate scattered source material, stakeholder decisions, approvals, brand constraints, and costly output revisions. Official first-party materials confirm that the market is already crowded; customer value must be established through outcomes rather than merely introducing an AI assistant.

- [Atlassian State of Teams 2026](https://www.atlassian.com/blog/state-of-teams-2026) identifies coordination and measurable-value concerns, but is vendor-sponsored research rather than proof of Forma's efficacy.
- [Canva State of Marketing and AI 2026](https://www.canva.com/newsroom/news/marketing-ai-report-2026/) supports the coexistence of widespread creative AI adoption and concerns about generic or weakly differentiated work.
- [Google Gemini Notebook source documentation](https://support.google.com/gemininotebook/answer/16215270) and [Google Cloud's NotebookLM Enterprise offering](https://cloud.google.com/resources/notebooklm-enterprise) demonstrate larger connected source limits and advertised enterprise research capability; the examined enterprise page advertised a $9/month license, subject to its current terms.
- [Notion pricing](https://www.notion.com/pricing), [Notion Enterprise Search](https://www.notion.com/help/enterprise-search), and [Notion AI connectors](https://www.notion.com/help/notion-ai-connectors) establish permissions-aware connected knowledge and organizational search as competitive expectations.
- [OpenAI business pricing](https://openai.com/business/pricing/) and [OpenAI company knowledge](https://openai.com/index/introducing-company-knowledge/) establish substantial price and platform competition from integrated workspace knowledge; verify the live edition, billing cadence, eligibility, and contract before quoting a purchase price.
- [Microsoft 365 Copilot enterprise pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/enterprise) advertised a $30/user/month annual Copilot license at review time, with qualifying Microsoft subscriptions and some agent costs additional.
- [Canva pricing](https://www.canva.com/pricing/) advertised a $250/person/year Business tier while reserving some identity, approval, and usage controls for other plans or enterprise contracts.
- [Adobe Firefly plans](https://www.adobe.com/products/firefly/plans.html) and [Runway pricing](https://runway.com/pricing) demonstrate credit-limited image/video economics; Runway advertised $12/month Standard on annual billing, making unmanaged media unit costs a real commercial concern.
- [Descript pricing](https://www.descript.com/pricing) and [Descript Brand Studio](https://www.descript.com/brand-studio) establish that professional video finishing, brand governance, and team-oriented handoff already have mature alternatives.

Commercial acceptance requires a narrow initial buyer: a small creative or product-marketing team that already suffers repeated approval/revision cycles and values exact, licensed, reviewer-approved brand or campaign direction. Measure median time to an independently approved deliverable, review rounds, rejected outputs, package reuse, retained active creators, settled cost per approved output, and avoided rights/brand incidents against the team's previous workflow. Do not claim product-market fit until actual authorized pilot data exists.

## Remaining practical build plan and expansion gates

The team approves the **completed local pilot scope**, not every conceivable enterprise feature. These are the dependency-ordered next steps, with honest ownership and acceptance gates.

1. **Operate and measure the controlled pilot.** Owner: pilot operations plus product analytics. Initial effort: 1–2 weeks of real observation once authorized. Enroll only named, consented participants; use synthetic, public, or explicitly licensed non-sensitive material; retain an independent reviewer and billing reviewer; enforce spending caps; manually inspect retention, reminders, legal holds, recovery, and deletion. Acceptance: zero unauthorized disclosures, zero self-approvals, zero unresolved unreviewed charges, and measured activated creators, independently approved deliverables, review turnaround, context reuse, and cost per approved output.
2. **Finish pilot-facing reviewer operations.** Owner: collaboration/product engineering. Indicative effort: 1–2 weeks, dependent on permitted notification infrastructure. Add explicit package-draft reviewer assignment, quicker tenant-safe refresh, durable targeted notification delivery, and an authorized administrator surface for uncertain-charge reconciliation. Acceptance: the exact reviewer receives one actionable notice; revocation immediately removes access; no other project, reviewer, or tenant observes private data.
3. **Expand source and output capability without weakening context rights.** Owner: ingestion and creative-output teams. Indicative effort: 2–6 weeks per independently scoped capability and any required third-party authorization. Add permission-aware connectors, safe URL intake, OCR, claim-level source evidence across every supported output, bounded cross-document synthesis, and genuine composed multiscene video only if actual providers/integrations are authorized. Acceptance: every external source has verified custody and expiry; synthesis respects exact per-document ACLs; every advertised movie corresponds to a genuinely downloadable composed file; cost is known before execution.
4. **Prove unattended hosted operations and real recovery.** Owner: hosting/platform operations. Indicative effort: 2–4 weeks after platform access and infrastructure authorization. Configure actual no-traffic retention/review schedules; capture independent run evidence; define service alerts; establish replicated encrypted backups; restore a complete isolated tenant including object bytes; measure RPO/RTO; support authorized project-custody transfer. Acceptance: witnessed scheduled runs without user traffic, successful full restore drill, recovery evidence, owner handoff, and independently documented objectives.
5. **Clear enterprise identity, encryption, privacy, and compliance vetoes.** Owner: security, identity, legal, procurement, and accessibility. Indicative effort: 4–12+ weeks and external vendors/auditors. Independently validate SSO, MFA, domain ownership, SCIM provisioning/deprovisioning, primary-storage encryption and customer-managed keys, subprocessor contracts, DPA, penetration assessment, accessibility attestation, incident response, and required certifications. Acceptance: procurement witnesses and documents every non-negotiable control; no simulated feature, local-only handler, aspirational roadmap, or unsigned contract is accepted as evidence.

## Required controlled-pilot operating conditions

- Limit access to individually named, consented participants in the exact active organization, cohort, and project.
- Prohibit confidential, personal, regulated, customer, or production material; admit only synthetic, public, or explicitly licensed non-sensitive evidence.
- Maintain the live source custodian required for licensed material and a separate project-authorized Viewer reviewer.
- Keep an independent qualified billing reviewer available before enabling any separately authorized chargeable provider feature.
- Enforce explicit individual, organizational, and pilot-wide spending caps; freeze uncertain submissions until independently reconciled.
- Manually operate and inspect retention, review reminders, legal holds, recovery evidence, and deletion; do not claim unattended hosted scheduling.
- Release only currently approved, rights-valid deliverables. Presenter notes and source excerpts require separate authorized access.
- Do not deploy this local candidate, change production/customer application data, initiate real paid generation, or expand to enterprise production without separate explicit authorization and validated prerequisites.

## Verification, uncertainty, and reporter boundary

The owner independently verified production-equivalent main, completed repeated source and endpoint regressions, generated the client/server deployment build, passed the localization audit across **6,015 system phrases, 2,295 English messages, 1,168 referenced identifiers, 22 block types, and three translated locales**, and obtained four independent final approvals.

Independent procurement verification passed **142 deterministic direct-source tests across nine suites**, **5 focused blocker regressions**, the actual built-worker cross-custodian revocation scenario, and an independently reproduced provider-submission SQL race. The end user independently passed **30 focused direct-source tests** after the last remediation. The product owner separately passed **44 provider-generation reliability tests**, **24 reservation/recovery tests**, and focused unresolved-provider/revocation tests, in addition to verifying genuine two-person approval, durable owned decisions, and all three zero-provider-call revocation paths.

- Final full-suite result: **1,389 of 1,389 tests passed; zero failures**, including clean client/server production builds.
- TypeScript validation: **passed with no errors**.
- Lint validation: **passed with no errors or warnings**.
- Manifest and localization consistency: **passed; 129 current custom elements and all supported locale catalogs verified**.
- Working-tree whitespace validation: **passed**.

The application changed while reviewers worked; all final role decisions reflect the local post-remediation candidate, not the unchanged hosted deployment. Existing customer projects were not created, edited, or repurposed; real provider requests and spending were not authorized. The original reporter workflow therefore remained read-only. A fresh in-app reporter project, new generated outputs, real customer interviews, provider experiments, hosted scheduling, or production rollout requires separate explicit authorization.

**Final product decision: unanimously acceptable for the specified restricted local pilot. Final enterprise decision: not acceptable until every external operational and procurement gate is genuinely satisfied.**
