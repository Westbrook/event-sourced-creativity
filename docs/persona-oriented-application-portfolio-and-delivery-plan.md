# Forma persona-oriented application portfolio and delivery plan

Date: 2026-08-22  
Reviewed production baseline: `dc6f88508551e2bfded027c32d2f159e0cac3281` (production version 117)
Status: Reassessed against current main and production; first creator-trust and production-visibility delivery tranche in implementation
Decision requested: Deliver audience-oriented applications without fragmenting Forma's shared creative platform or claiming nonexistent tenant administration.

## Executive recommendation

Forma does not need to be split from one technical monolith into many disconnected products. It already has four independently loaded applications: Creative, Canvas, Operations, and Laboratory. The problem is that those applications, their common navigation, their bootstrap data, and their authorization model still mix jobs belonging to creators, customer administrators, platform operators, product teams, designers, evaluators, and engineers.

Organize delivery around **who must accomplish which job, which information they are allowed to see, and which decisions they are authorized to make**. Keep one durable platform, one project/document/context model, one design system, and one set of policy-enforced generation services.

The expanded catalog identifies **50 capability families across six audience groups**: 15 end-user capabilities; five currently blocked customer/workspace-administration capabilities; seven platform-administration capabilities; 10 product, production, and evaluation capabilities; four design/research capabilities; and nine engineering, reliability, and security capabilities. The eight additions account for current format-specific production teams, reusable generated inputs, scoped continuity, honest artifact evidence, creator-owned cost reporting, production orchestration, cross-format evaluation, and reservation/recovery engineering.

The recommended initial portfolio has no more than six authenticated task surfaces:

1. **Creator Workspace:** projects, document/context authoring, the project Library, all document lenses and output formats, creative assistance, and self-service privacy/settings.
2. **Canvas:** the existing independently loaded, project-scoped spatial companion, visible only when the creator is entitled to use it.
3. **Platform Operations:** platform administration, provider configuration, policies, release approvals, budgets, service health, incidents, and privileged audit.
4. **Product & Quality:** separately entitled Insights, Delivery, and Evaluation workspaces for production/product decisions, project planning, release evidence, and safe evaluation.
5. **Design & Knowledge:** classified internal documentation, design-system guidance, and interactive production-component examples using synthetic data only.
6. **Engineering Diagnostics:** restricted event/projection, synchronization, job, adapter-implementation, and reliability diagnostics.

The existing public **Review & Share** experience remains a separate, minimal, exact-resource, read-only security boundary; it is not another signed-in application launcher destination. **Workspace Administration** is an important customer-administrator candidate but must remain blocked until real organizations, memberships, project authorization, isolated streams/projections, scoped budgets, revocation, and multi-account security tests exist. Launch it first as a scoped workspace-settings area; fund a standalone application only if actual administrator usage justifies another product surface.

The immediate first user benefit is straightforward: give creators complete personal privacy and usage controls in their own experience, then remove Operations, provider internals, implementation roadmaps, evaluation gates, and raw infrastructure concepts from their normal navigation. Make managed-production outcomes, actual charges, and the limits of available quality evidence understandable beside the work itself.

### Current-main reassessment and adversarial scorecard

Four independent reviewers reassessed the committed main/production baseline as an end user, market researcher, product owner, and procurement officer. Scores describe observed delivery before the implementation tranche below, not aspirations or the quality of this plan.

| Shared product goal | End user | Market | Product owner | Procurement | Mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| Coherent Creator Workspace and distinct project-scoped Canvas. | 59 | 54 | 46 | 57 | 54.00 |
| One authoritative context powering editable, managed multimodal outcomes. | 79 | 78 | 80 | 83 | 80.00 |
| Trustworthy identity, authorization, privacy, spending, and recovery. | 46 | 45 | 34 | 38 | 40.75 |
| Accessible, localized, reliable, performant audience journeys. | 43 | 62 | 57 | 54 | 54.00 |
| Credible separation of creators, administration, production, design, and engineering. | 37 | 41 | 39 | 35 | 38.00 |

The arithmetic mean across all 20 role-by-goal scores is **53.35/100**. Procurement's more stringent weighted purchase-readiness score is **44/100**. These averages do not override a hard authorization, account-isolation, identity-bootstrap, or privacy failure. The current hosted Site has a custom allowlist containing four authorized accounts and no external visitors; it is therefore **not owner-only**. Organizational purchase and genuine cross-account project collaboration remain blocked even when this explicitly restricted creator pilot improves.

Intervening production changes materially strengthen the product thesis:

- Six format-specific orchestration contracts cover film, previsualization, presentation, writers'-room, screenwriting, and image-art-direction work. “Production team” means coordinated specialist responsibilities, not separately hired people or proof of six autonomous model calls.
- Shared authored context now drives production claims, exclusions, target-scoped Combined Contexts, continuity anchors, ordered narrative units, execution dependencies, and recoverable per-scene/frame provider receipts.
- Completed text and slides can receive actual rendered-copy evidence. Image and video receipts establish delivery and work coverage, but visual adherence, continuity, duplication, and transitions must remain explicitly **not evaluated** until pixels or frames are actually inspected.
- Managed video with optional original environmental audio is an **ordered, individually playable scene reel**. A combined MP4, validated visual continuity, and a generated soundtrack are not delivered capabilities.
- Owner-bound USD and token reservations now support exact admission, settlement, failed-operation release, original accounting periods, and recovery without silently resubmitting paid provider work. The “workspace” limit is still one global `forma` scope, not a customer tenant.
- Eight human-approved outputs now exist across the four Forma-authored review documents; the previous zero-output/no-provider assertions are historically stale. Read-only runtime verification found two outputs per document and **$18.487293** total recorded account-level usage for those document operations.

The first implementation tranche therefore combines: creator-owned privacy/sharing/personal-spend settings; audience-entitled navigation; administrator authorization before internal HTML, bootstrap, or privileged module delivery; explicitly configured hosted administrator bootstrap; account/project-partitioned Canvas offline custody with conservative legacy recovery; a shared multi-scene-video rerender repair; always-available Canvas reading order; and creator-readable production/evidence/cost summaries. Real organizations, delegated billing, project ACLs, assembled video, advanced evaluator roles, and accessible tagged PDF remain future gated work.

### Current market context and product differentiation

Official vendor sources checked on 2026-08-22 show a consistent pattern: integrate related creative workflows while separately controlling audience access, billing, and administration. Published US prices exclude taxes and may vary by contract, region, plan, and billing cadence.

- [Adobe Firefly for Teams](https://www.adobe.com/creativecloud/business/teams/firefly.html) lists $19.99, $49.99, and $199.99 per license per month billed annually, with corresponding credit allotments; [Firefly Boards](https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards/about-firefly-boards.html) combines references, generation, and shared composition.
- [Canva pricing](https://www.canva.com/pricing/) lists Canva Business at $250 per person annually and includes team, brand, and approval capabilities; Enterprise governance is negotiated.
- [Figma pricing](https://www.figma.com/pricing/) lists Professional/Organization/Enterprise Full seats at $16/$55/$90 monthly, with annual billing for Organization and Enterprise; [Figma AI credit administration](https://help.figma.com/hc/en-us/articles/35865276858647-Manage-AI-credits) documents per-person visibility, pooled controls, and current $0.03 pay-as-you-go credits.
- [Miro pricing](https://miro.com/pricing/) lists Starter at $8 per member per month billed yearly; Miro's [August 17, 2026 Enterprise announcement](https://miro.com/blog/enterprise-pricing-miro/) describes bundling AI workflows into the existing product rather than creating disconnected add-ons.
- [Runway workspace roles](https://help.runwayml.com/hc/en-us/articles/43198398846611-Managing-Workspace-Members) distinguish actual Admin, Editor, Billing Admin, and Viewer authority; [Runway Enterprise credits](https://help.runwayml.com/hc/en-us/articles/32117491177619-Enterprise-Credits) explain pooled and individual usage.

Forma's defensible position is **authoritative reusable creative direction → specialist-managed multimodal production → inspectable source evidence, recovery, and actual cost**. It should separate audience authority and decision-oriented reporting without selling a separate application for every document lens, generated format, or production-team label.

### Requested capability families mapped to delivery

| Requested family | Default audience | Recommended first delivery | Independent application? |
| --- | --- | --- | --- |
| App evaluations | Evaluators, production, product, and authorized engineering. | Product & Quality → Evaluation; restricted actual-data operations separately approved. | Candidate only after a real evaluator cohort and operating cadence justify it. |
| App administration | Platform operations, trust/safety, and privileged support. | Platform Operations. | Yes: distinct authority, data sensitivity, and operational ownership. |
| Internal documentation | Designers, engineers, product/production, and approved internal readers. | Design & Knowledge with classified publishing and synthetic component examples. | Yes: a separately entitled internal knowledge/design surface. |
| End-user administration | Individual creators; later delegated customer workspace administrators. | Self-service personal settings inside Creator Workspace; future tenant-scoped Workspace Administration. | Customer-admin standalone is blocked until real tenancy/ACLs and evidence support it. |
| Context management and content generation | Creators and production specialists. | One Creator Workspace containing contextual project Library, one document model, and every output type. | Keep unified; standalone Library/production tools require validated specialist workflows. |
| App-build project planning | Product owners, production/delivery leads, and release reviewers. | Product & Quality → Delivery, separately bounded from Insights and Evaluation. | Start as a module; dedicated planning application requires its own owner and recurring delivery workflow. |

## Current-state findings

### What already exists

| Current application | Existing ownership | Audiences currently mixed together |
| --- | --- | --- |
| Creative | Projects, seven interchangeable document lenses, 21 context-block kinds, project Library, six outcome families, Re-entry, Scout, and Taste & time. | Everyday creators, specialist curators, customer self-administration, and people investigating experimentation or implementation behavior. |
| Canvas | Project-level boards, spatial composition, reusable context, document preparation, proposals, synchronization, and gated release behavior. | Creators, spatial-production specialists, prospective collaborators, proposal reviewers, and people inspecting a still-gated pilot. |
| Operations | Governance, product analytics, release evidence, provider readiness, durable-stream inspection, producer permissions, and synchronization diagnostics. | Creators seeking privacy controls, platform administrators, product owners, trust/safety operators, finance, support, and engineers. |
| Laboratory | Synthetic/actual-data replay, image-adapter qualification, focal-point comparison, and the living design-system catalog. | Evaluators, platform administrators, production/product teams, designers, accessibility specialists, and engineers. |

The updated static route catalog declares 39 entries, including historical aliases and creator-owned `/settings`, while the four application definitions retain 21 discoverable destinations. The creator's actual primary navigation progressively exposes only five relevant destinations. The split must extend these existing application boundaries rather than recreate them or discard their proven lazy-loading, route-ownership, and sibling-import constraints.

### Evidence of the current audience mismatch

- `src/components/forma-shell.ts:225-241`: Operations appears in every signed-in user's application switcher and account menu; the personal "Review privacy controls" action navigates to `/operations#governance`.
- `src/components/forma-system.ts:10-46`: one Operations page mixes personal attention/privacy settings and budget information with implementation phases, evaluation thresholds, provider topology, role matrices, infrastructure facts, and platform governance.
- `worker/index.ts:39-53`: recognized application HTML is resolved and served before an application-specific entitlement check, even though selected privileged APIs independently reject nonadministrators.
- `worker/pilot-policy.ts:6-11`: the existing platform roles are only `viewer`, `agent`, `creator`, and `admin`; there are no tenant-admin, product, evaluator, design, support, or engineer grants.
- `worker/analytics-api.ts`: analytics remains platform-administrator-only and aggregates multiple user streams under a hardcoded organization named `forma`. The latest implementation now excludes synthetic activity by default and uses owner-bound in-memory/durable checkpoints plus event deltas, so it no longer performs an unconditional full-history scan on every request; it still cannot safely be repackaged as tenant-scoped or nonadministrator product reporting.
- `worker/pilot-policy.ts:87-108`: the current workspace budget likewise uses one hardcoded workspace scope rather than actual tenant ownership.
- `docs/product-architecture-review.md:88-103`: membership-like project events do not grant real cross-account access; genuine collaboration requires new project ACLs, sequencing, migration, and authorized fan-out.
- `worker/pilot-policy.ts:310-319`: global account listing and role assignment already exist on the server, but there is no corresponding user-administration application interface.
- `src/model/document-artifacts.ts:3-26`: supported generated outputs are short stories, scenes, slides, storyboards, and video; there is no generic native report, plan, approval, or memo output type.

### Status vocabulary

- **Existing:** currently implemented and usable within its documented policy gates.
- **Extractable:** substantially implemented but mixed with the wrong audience, route, permission, or navigation.
- **New:** requires new user experience, workflows, projections, data objects, or services.
- **Blocked:** must not launch until a separately identified security, authorization, data, legal, or operational dependency exists.
- **Module first:** keep the capability inside a role-oriented application until evidence supports an independently owned standalone application.

These labels describe the capability, not a promise that every feature is generally available. Existing Canvas, adapter, replay, sharing, and provider operations still obey their own release and approval gates.

## Capability catalog by audience

### End-user-facing capabilities

| Capability family | User job and reporting need | Current evidence | Recommended delivery | Status |
| --- | --- | --- | --- | --- |
| Project home and discovery | Start/resume work; see project status, recent outcomes, and a clear next action. | `/projects`; `forma-projects.ts`; `forma-project-contents.ts`. | Creator Workspace home. | Existing; module first. |
| Document and creative-context authoring | Edit one durable document and independently correct reusable creative decisions. | `/document/*`; `forma-workspace.ts`; `context-block.ts`; `block-types.ts`. | Creator Workspace; never require an application switch to author context. | Existing. |
| Alternate document lenses | Choose Document, Board, Guided, Layers, Adaptive, Editor, or Chat as interchangeable views over the same work. | `studio-navigation.ts`; `docs/event-sourced-creative-system-project-plan.md:438-460`. | One progressively disclosed mode chooser in Creator Workspace. | Existing; explicitly not separate applications. |
| Images and multimodal content generation | Produce, inspect, compare, retry, and retain images, stories, scenes, presentations, storyboards, and video. | `document-artifacts.ts`; `document-generations.ts`; `worker/document-jobs-api.ts`. | One document-scoped generation workflow and history. | Existing, subject to provider/consent gates. |
| Specialist-managed multimodal production | Choose coordinated film, previsualization, presentation, writing, screenplay, or art-direction responsibilities without leaving the source document. | `src/model/managed-production.ts`; `worker/managed-production.ts`. | Creator Workspace's document-native Production Desk; no separate application per team or output. | Existing orchestration; creator-readable reporting is new. |
| Scoped creative continuity and authorized references | Carry explicit characters, locations, style constraints, exclusions, approved references, and account-owned continuity anchors into only their intended output units. | `src/model/managed-production.ts`; `src/model/combined-context.ts`; `worker/managed-production.ts`. | Document-owned production planning and reference disclosure. | Existing; visual continuity itself remains unverified. |
| Generated-result adoption and editable reuse | Turn generated stories, scenes, slides, frames, or scenes into editable provenance-preserving creative input. | `src/model/output-authoring.ts`; `src/model/output-context.ts`; `document-artifacts.ts`. | One Creator Workspace context-to-output-to-context loop. | Existing; keep every source and edit attributable. |
| Truthful production evidence and delivery state | Understand source coverage, completed narrative units, quality-evidence basis, unmeasured visual dimensions, and actual reel-versus-film delivery. | `src/model/production-evidence.ts`; `worker/events-api.ts`; retained artifact receipts. | Creator-readable artifact summaries and progressive receipt disclosure. | Existing evidence foundation; audience-appropriate presentation is new. |
| Personal generation spend and recoverability | Inspect own estimated/reserved/settled USD and token use, remaining limits, failed work, and safe no-rebill recovery. | `worker/pilot-policy.ts`; `src/model/generation-budget.ts`; `worker/document-jobs-api.ts`. | Creator-owned settings plus document-local production summaries. | Existing ledger/recovery; self-service reporting is extractable. |
| Project Library and context management | Search, curate, reuse, and export project-scoped decisions, collections, references, and outcomes. | `/library`; `forma-library.ts`; `library-block-editor.ts`. | Creator Workspace module; consider standalone only for a validated curator/librarian cohort. | Existing; module first. |
| Spatial project composition | Arrange project materials, prepare documents, and formalize Combined Contexts. | `/canvas/*`; `src/canvas/*`; `docs/canvas-implementation.md`. | Existing independently loaded Canvas companion with preserved project handoff. | Existing but release-gated. |
| Continuity and creative assistance | Resume unfinished work; inspect bounded Scout findings; manage taste and time without implementation jargon. | `/sessions`, `/scout`, `/memory`. | Contextual Creator Workspace assistance, surfaced only when useful. | Existing; simplify rather than extract. |
| Personal account, privacy, and accessibility preferences | Understand consent, retention, language, sharing, personal usage, attention opt-in/pause/delete, and support options. | Account menu in `forma-shell.ts`; governance panel in `forma-system.ts`. | Shared self-service settings available from every authenticated application; creator-native landing. | Extractable; privacy-first migration requirement. |
| Generation readiness and recovery | Understand whether work can proceed, see personal limits, retry safely, or contact an administrator. | `generation-readiness.ts`; `src/model/document-jobs.ts`. | Plain-language Creator Workspace notices; privileged provider diagnostics stay internal. | Existing with new role-shaped messaging. |
| External stakeholder review and delivery | Review exactly the shared document/outcomes; use semantic HTML presentation review and any honestly described export. | `/share/*`; `worker/shares-api.ts`; `forma-shared-view.ts`. | Existing minimal public Review & Share boundary; no authenticated shell. | Existing; preserve exact-resource restrictions; current PDF accessibility requires remediation. |

### End-user administrator-facing capabilities

| Capability family | Administrator job and reporting need | Current evidence | Recommended delivery | Status |
| --- | --- | --- | --- | --- |
| Workspace membership and invitations | Invite, remove, and manage actual organization members. | Global `/api/admin/users` exists; no tenant membership authority. | Future Workspace Administration. | Blocked: organizations, memberships, scoped grants, invitation acceptance, and revocation. |
| Project and content access control | Grant/revoke project access; inspect who can use or export a project. | Project membership intent is not enforceable cross-account access. | Future project-scoped Workspace Administration. | Blocked: project ACLs, isolated project sequencing, and media/share authorization. |
| Workspace policy and provider availability | Configure approved capabilities, permitted providers, retention, and sharing for one tenant. | Global pilot policy and release governance only. | Scoped workspace-settings module, then standalone only if justified. | Blocked: actual tenant identity and policy inheritance. |
| Usage, budgets, and chargeback | See tenant-limited spend, quotas, reservations, users, and trends. | One global hardcoded workspace budget and account-scoped reservations. | Future tenant-scoped usage dashboard. | Blocked: tenant attribution, scoped budgets, and materialized reporting. |
| Workspace security, privacy, and audit | Review only the tenant's policy exceptions, shares, rights, and administrative actions. | Platform-level shares/privacy controls; no tenant audit projection. | Future restricted tenant audit module. | Blocked: tenant-scoped audit, minimum disclosure, retention, and revocation semantics. |

Do not describe these capabilities as shipped, demonstrate fake invitation/access behavior, or grant a customer administrator the current global `admin` role as a shortcut.

### Application/platform-administrator-facing capabilities

| Capability family | Operator job and reporting need | Current evidence | Recommended delivery | Status |
| --- | --- | --- | --- | --- |
| Platform identity and privileged access | Inspect platform users, assign approved platform capabilities, and audit changes. | `worker/pilot-policy.ts:310-319`. | Platform Operations; build the missing administration UI. | Existing backend; new interface and granular grants. |
| Provider, model, and integration administration | Configure providers, inspect health, own contracts/entitlements, approve activation, and diagnose readiness. | `worker/image-adapters-api.ts`; `generation-readiness.ts`. | Platform Operations owns configuration and activation. | Extractable; preserve explicit approval. |
| Platform spending, quotas, and settlement | Review aggregate costs, reservations, limits, failed settlements, and capacity risk. | `worker/pilot-policy.ts`; generation jobs and analytics. | Platform Operations cost/usage module. | Extractable; tenant chargeback is blocked. |
| Trust, safety, rights, legal, and procurement governance | Review moderation/rights evidence, counsel decisions, approvals, and launch blockers. | `worker/canvas-governance-api.ts`; `worker/pilot-policy.ts`. | Platform Operations governance module. | Existing/extractable, with policy-specific gates. |
| Release and feature authorization | Approve/revoke availability from canonical evidence rather than stale copied prose. | Canvas governance; adapter evidence; `docs/evaluations/*`. | Platform Operations owns final approval; Product & Quality links to evidence. | Existing/extractable; consolidated readiness projection is new. |
| Operational health, jobs, incident response, and support | Understand service health, stalled jobs, failures, recovery paths, and incident ownership. | `forma-system.ts`; document jobs; operations diagnostics. | Platform Operations summary; link to restricted engineering diagnostics when authorized. | Extractable; incident workflows and durable queue supervision are new. |
| Privileged audit and break-glass review | Inspect sensitive events or user-impacting support actions with an audited reason. | `/operations/events/*`; global admin media access; impersonation APIs. | Restricted Platform Operations authorization; least-privilege drillthrough into Engineering. | Existing/extractable; scoped approvals/audit improvements required. |

### Production, product, and evaluation-team-facing capabilities

| Capability family | Team job and reporting need | Current evidence | Recommended delivery | Status |
| --- | --- | --- | --- | --- |
| Product outcome analytics | Understand activation, first useful outcome, retained results, reuse, friction, and value by allowed segment. | `/operations/analytics`; `src/model/analytics.ts`. | Product & Quality → Insights; aggregated, scoped, and role-shaped. | Existing global calculation; new safe production-team projection. |
| Experience and funnel analysis | Compare task completion, abandonment, navigation noise, accessibility blockers, and time to meaningful action. | Existing event-derived analytics and performance instrumentation. | Product & Quality → Insights. | Extractable with new persona/task instrumentation. |
| Delivery planning and roadmap | Track initiatives, milestones, owners, dependencies, risks, acceptance criteria, and decisions. | Repository Markdown/NDJSON plans; no application planning objects. | Product & Quality → Delivery. | New; existing repository content is source material, not a delivered planning app. |
| Release-readiness reporting | See current gate status, responsible owners, evidence versions, exceptions, and approved decisions. | Canvas governance and versioned evaluation documentation. | Product & Quality → Delivery reads canonical evidence; Operations owns approval. | Extractable evidence; new consolidated projection/UI. |
| Capability and outcome reporting | Report adoption and benefit without exposing private prompts, raw event payloads, or user identities. | `worker/analytics-api.ts` currently reads global raw streams. | Small scoped Insights dashboards with explicit metric ownership. | New projection and disclosure policy. |
| Application and experience evaluation | Review deterministic corpora, outcome judgments, accessibility/usability findings, and failure trends. | Extractor gates, replay scenarios, adapter corpora, existing tests. | Product & Quality → Evaluation, with separately entitled safe modules. | Extractable; advanced campaign management is new. |
| Provider/model qualification | Compare approved frozen corpora, model capabilities, correction rates, cost, and evidence versions. | `/laboratory/image-adapters`; `evals/image-adapters/*`; `docs/evaluations/*`. | Product & Quality → Evaluation evidence/runs; Platform Operations owns production approval. | Existing/extractable; paid execution remains separately authorized. |
| Cross-format production coordination | Review responsible specialist contracts, work-unit dependencies, execution order, completed checkpoints, and recovery behavior across explicitly authorized production scopes. | `src/model/production-system.ts`; `src/model/managed-production.ts`; `worker/managed-production.ts`. | Product & Quality → Production insights; creators retain their own document-native desk. | Existing owner-scoped execution; cross-creator operations blocked without real grants. |
| Artifact-level quality and claim coverage | Compare rendered-text/slide evidence, source-claim coverage, unevaluated media dimensions, and attributable human review without presenting proxies as measured quality. | `src/model/production-evidence.ts`; `tests/production-evidence.test.mjs`. | Product & Quality → Evaluation through sanitized, explicitly authorized projections. | Existing measurement primitives; safe aggregate reporting is new. |
| Documentation and operating knowledge | Locate product behavior, operating procedures, evidence definitions, and decision history. | `README.md`, `ARCHITECTURE.md`, `DESIGN.md`, `docs/*`. | Design & Knowledge for approved published content; Delivery links to current evidence. | Existing repository content; new classified publishing/search experience. |

### Design and research-team-facing capabilities

| Capability family | Team job and reporting need | Current evidence | Recommended delivery | Status |
| --- | --- | --- | --- | --- |
| Design system and reusable components | Review real foundations, tokens, primitives, patterns, templates, and component contracts. | `/laboratory/design-system`; `custom-elements.json`; `src/components/design-system/*`. | Design & Knowledge; preserve interactive real-component previews. | Extractable, after live-store dependencies are removed. |
| Interaction, content, and accessibility standards | Review UX rules, native form/dialog behavior, keyboard patterns, and accessible interaction guidance. | `DESIGN.md`; design primitives; `tests/form-semantics.test.mjs`. | Design & Knowledge standards and examples. | Existing standards; new curated publishing. |
| Localization and inclusive-design verification | Inspect en/fr/ar, right-to-left behavior, contrast, zoom/reflow, focus, and announcements. | Design-system locale files; color/typography/responsive tests. | Design & Knowledge interactive verification; release evidence linked to Product & Quality. | Existing foundations; expanded checks/reporting are new. |
| Design/visual research | Compare focal-point treatments, layout variants, and interaction outcomes. | `/laboratory/focal-points`. | Synthetic, separately entitled Design & Knowledge or Evaluation module. | Extractable; must not expose real creator data. |

### Engineering, reliability, and security-team-facing capabilities

| Capability family | Team job and reporting need | Current evidence | Recommended delivery | Status |
| --- | --- | --- | --- | --- |
| Event and projection diagnostics | Inspect allowed durable events, causality, projection rebuilds, and concurrency failures. | `/operations/events/*`; `worker/events-api.ts`. | Engineering Diagnostics; sensitive reads require explicit capability/audit. | Existing/extractable. |
| Synchronization and Canvas reliability | Diagnose offline queues, ordering, merge conflicts, convergence, locks, and admitted project access. | `/operations/events/sync`; `src/sync/*`; `worker/realtime/*`. | Engineering Diagnostics → Synchronization. | Existing/extractable; cross-account convergence remains blocked. |
| Synthetic replay and deterministic fixtures | Build reproducible journeys and compare safe projection outcomes. | `/laboratory/replay`; replay models and tests. | Product & Quality → Evaluation owns synthetic scenario evidence; Engineering links to restricted diagnostics. | Existing/extractable; one authoritative owner, no duplicated replay applications. |
| Actual-data replay and impersonation | Investigate explicitly approved production-shaped behavior with isolated fictional accounts. | `worker/replay-sessions-api.ts`; `worker/pilot-policy.ts`. | Separately entitled restricted Evaluation mode with conspicuous identity, one-use approval, audit, and safe return. | Existing, exceptionally privileged; never available to ordinary production/design roles. |
| Provider implementation and adapter debugging | Diagnose adapter implementations, normalized errors, preflight, retries, and capability mismatches. | `worker/*adapter*.ts`; `worker/provider-errors.ts`. | Engineering Diagnostics; link qualification evidence from Evaluation. | Existing/extractable; production provider activation remains Operations-owned. |
| Production settlement and checkpoint integrity | Reconcile owner-bound reservations, accounting periods, per-scene/frame receipts, cancellation, duplicate protection, and safe provider-job recovery. | `worker/pilot-policy.ts`; `worker/managed-production.ts`; `tests/cost-budget-ledger.test.mjs`; `tests/managed-production.test.mjs`. | Engineering Diagnostics with redacted finance/Operations handoff; creators see only their own outcome and charge. | Existing platform capability; role-scoped operational read models are new. |
| Performance and reliability observability | Compare route bundles, p75/p95 timings, request counts, D1 contention, queue health, and recoverability. | `src/performance.ts`; `tests/data-loading-performance.test.mjs`. | Engineering Diagnostics; role-specific summaries in Operations. | Existing local instrumentation; durable telemetry/alerts are new. |
| Developer architecture and integration documentation | Understand event contracts, APIs, package boundaries, component manifests, runbooks, and integrations. | `ARCHITECTURE.md`; `custom-elements.json`; `docs/*`. | Approved Design & Knowledge documentation; sensitive runbooks require engineering scope. | Existing documents; curated role-filtered publication is new. |
| Automated security, accessibility, localization, and quality evidence | Verify route/API isolation, deep links, component contracts, inclusive interactions, performance, and release gates. | Existing Node tests and targeted PDF visual harness. | Product & Quality consumes summarized results; Engineering/Design own remediation. | Existing partial test foundation; broad persona E2E, axe, CI, and release automation are new. |

## Recommended application boundaries

### Initial authenticated portfolio

| Surface | Primary people | Primary ownership | Explicitly excluded |
| --- | --- | --- | --- |
| Creator Workspace | Creators and individual end users. | Projects, documents, context, Library, output generation, creator-readable assistance, personal settings. | Platform roadmaps, raw events, provider keys, internal evaluation controls, global analytics, engineering diagnostics. |
| Canvas | Entitled creators and spatial-production specialists. | Project-scoped boards, spatial references, Combined Context, and return-to-document handoff. | Fake collaboration, tenant administration, platform release approval, hidden provider execution. |
| Platform Operations | Authorized platform operators, trust/safety, and incident responders. | Platform access, provider activation, budgets, release approval, policy, incidents, and privileged audit. | Ordinary creator authoring, product roadmap editing, unrestricted customer access without purpose/audit. |
| Product & Quality | Separately entitled product, production, delivery, and evaluation roles. | Insights, Delivery, and Evaluation modules with distinct task-specific landings. | Global raw streams, unrelated internal modules, provider activation, privileged impersonation without separate approval. |
| Design & Knowledge | Authorized designers, accessibility/design engineers, integrators, and approved internal readers. | Synthetic interactive component examples, curated standards, classified documentation, and approved contract references. | Production project reads, provider spending, navigation side effects, sensitive receipts, customer event data. |
| Engineering Diagnostics | Separately authorized engineering and reliability operators. | Redacted event/projection, synchronization, provider-implementation, job, and performance diagnostics. | Product-roadmap ownership, provider production activation, broad content access without separate approval, customer-admin powers. |

All six applications remain focused deliveries of the same underlying Forma platform:

```text
Creators       Creators      Operators      Product / QA    Designers       Engineers
    |              |              |              |               |               |
 Creator         Canvas       Platform       Product &       Design &      Engineering
 Workspace                    Operations      Quality        Knowledge     Diagnostics
    |              |              |              |               |               |
    +--------------+--------------+--------------+---------------+---------------+
                                   |
            Worker: scoped authorization + audience-shaped sessions/APIs
                                   |
            Shared project/context/generation/event domain contracts
                                   |
                  D1 durable events + R2 authorized media

Public reviewer --> exact-resource share-token boundary --> read-only shared projection
```

### Default audience-to-surface entitlement matrix

`Own` means the persona's ordinary task surface; `Scoped` means explicitly granted and resource-limited; `Separate` means access requires a deliberate separately approved capability; `No` means absent from both discovery and server-delivered data by default.

| Persona | Creator | Canvas | Platform Operations | Product & Quality | Design & Knowledge | Engineering | Public share |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Creator/end user | Own. | Scoped pilot entitlement. | No. | No. | No. | No. | Exact token only. |
| External reviewer | No account bootstrap. | No. | No. | No. | No. | No. | Own; exact token only. |
| Future workspace administrator | Scoped creator or delegated tenant settings only. | Scoped project entitlement. | No. | No global analytics. | No. | No. | Exact token only. |
| Platform operator acting as a creator | Own, with the same clean creator experience. | Scoped pilot entitlement. | Separate deliberate mode. | Separate capability. | Separate capability. | Separate audited capability. | Exact token only. |
| Product owner/production lead | Scoped only if also a creator. | No by default. | No. | Own Insights/Delivery modules only. | Scoped approved documentation. | No. | Exact token only. |
| Evaluator/quality specialist | Scoped only if also a creator. | No by default. | No production-activation rights. | Own Evaluation module; synthetic by default. | Scoped approved guidance. | Separate diagnostic access. | Exact token only. |
| Designer/accessibility reviewer | Scoped only if also a creator. | Scoped only for approved design review. | No. | Scoped outcome/evidence summaries. | Own synthetic design/documentation surface. | No. | Exact token only. |
| Engineer/reliability specialist | Scoped only if also a creator. | Scoped only for authorized diagnosis. | Separate incident/provider authorization. | Scoped approved evaluation evidence. | Scoped approved technical documentation. | Own; redacted by default. | Exact token only. |

No row implies automatic access to another person's projects, full streams, private prompts, actual-data replay, impersonation, paid generation, or production provider activation. Those exceptional actions require a separate resource scope, purpose, approval, and audit trail.

### Existing guest boundary and conditional candidates

| Candidate | Recommendation | Standalone trigger |
| --- | --- | --- |
| Review & Share | Keep the existing public, capability-token, exact-resource experience independent of every authenticated shell. | Already has a distinct security boundary; does not need a signed-in destination. |
| Workspace Administration | Build only after genuine tenancy; start inside scoped workspace settings. | A real tenant-admin cohort has three or more recurring jobs and needs a distinct authority/operating cadence. |
| Context & Asset Library | Keep inline with creator work and project discovery. | Validated librarian/curator workflow, sufficiently distinct grants, demonstrated switching benefit, named owner. |
| Content Production | Keep all output formats attached to their source document and shared creator composer. | A separately staffed production/review queue with distinct production permissions and a proven need to manage many authorized documents without duplicating context. |
| Evaluation Center | Start as a role-isolated Product & Quality module with separately gated actual-data mode. | Dedicated evaluator cohort, independent release cadence, three or more sustained tasks, clear ownership, positive operating ROI. |
| Support/Security/Finance consoles | Keep role-specific modules inside Platform Operations. | Independent compliance, incident, finance, or support ownership/availability requirements justify separation. |

Do **not** make one application per document lens, output format, chart, dashboard, settings page, or existing component. Application extraction is warranted only when a recurring audience, authority boundary, task set, operating cadence, accountable owner, and maintenance-adjusted benefit all exist.

### Persona-appropriate reporting

Each landing page should answer its audience's next decision with no more than five default measures. Scope, freshness, data provenance, and ownership must be explicit.

| Audience | Default reporting and next decisions | Must not see by default |
| --- | --- | --- |
| Creator | Current document/context, next useful action, generation status, personal usage remaining, saved/shared outcomes. | Global users, provider credentials/models, raw event counts, engineering failures, product delivery gates. |
| External reviewer | Shared document/outcome, creator-authorized media, expiration, and available accessible viewing/export. | Account session, project navigation, future uploads, private prompts, analytics, other documents. |
| Future workspace administrator | Tenant-scoped active seats, usage/limits, project access, sharing exceptions, and policy status. | Other tenants, global audit streams, provider secrets, privileged replay, private prompt contents. |
| Platform operator | Provider readiness, launch blockers, incidents/job failures, spend/limits, and security/policy exceptions. | Full creative content unless separately approved, scoped, justified, and audited. |
| Product/production | Activated creator funnel, first retained outcome, reuse/repeat value, cost per retained result, and role-scoped friction/release evidence. | Raw private events, customer emails, unapproved case-level identities, synthetic activity mixed into real cohorts. |
| Evaluator | Corpus version, outcome threshold, regression/change, qualification evidence, and approval state. | Production activation authority, unrelated planning work, real-data replay without distinct approval. |
| Designer | Pattern coverage, reusable component contract, accessibility defects, localization coverage, and design-token drift. | Live creator projects, provider configuration, user spending, raw event history. |
| Engineer | Scoped failure categories, queue/projection/sync health, p95 latency, evaluated regressions, and approved diagnostic links. | Default production content, tenant-management authority, paid/provider execution approval. |

## Authorization and data-classification model

### Capability grants rather than one overloaded role

Retain the existing authenticated principal and introduce explicit, deny-by-default capability grants. Capabilities must carry a valid scope (`self`, `project`, `workspace`, `platform`, `synthetic`, or exact share resource), an expiry/revocation policy where appropriate, and an audit requirement for privileged access.

Suggested capability families:

- `self.profile.read`, `self.privacy.manage`, `self.usage.read`, `self.share.manage`.
- `project.read`, `project.author`, `project.library.manage`, `project.canvas.use`, `project.output.request`.
- `workspace.member.read`, `workspace.member.manage`, `workspace.policy.manage`, `workspace.usage.read`, `workspace.audit.read` — disabled until real tenant/project authority exists.
- `platform.identity.manage`, `platform.policy.manage`, `platform.provider.configure`, `platform.provider.activate`, `platform.release.approve`, `platform.audit.read`, `platform.incident.manage`.
- `product.analytics.read`, `product.delivery.read`, `product.delivery.manage`, `product.release.read`.
- `evaluation.synthetic.read`, `evaluation.synthetic.run`, `evaluation.qualification.read`, `evaluation.qualification.run`, `evaluation.actual.request`, `evaluation.actual.approve`, `evaluation.actual.run`.
- `design.catalog.read`, `design.docs.read`, `engineering.diagnostics.read`, `engineering.events.read`, `engineering.sync.read`, `engineering.provider.debug`.

The same capability policy must govern application discovery, direct HTML navigation, protected application entries/chunks, session/bootstrap contents, every API, exports, provider calls, audit access, redirect targets, and explicit cross-surface handoffs. Hiding a navigation item is never an authorization control.

Public share tokens remain separate exact-resource capabilities and must never be converted into authenticated account or tenant permissions.

### Information sensitivity classes

| Classification | Examples | Minimum handling |
| --- | --- | --- |
| Public exact-resource | Approved read-only shared document and frozen authorized media manifest. | Share-token validation, expiry/revocation, private/no-store responses, zero mutation/telemetry side effects. |
| Self/private | Own project context, authored content, attention controls, personal limits. | Authenticated self/project authority, retention and prompt redaction, no leakage into product/docs tooling. |
| Tenant-scoped | Future membership, project access, workspace reporting, tenant policy, tenant audit. | Genuine tenant/project ACL; server-filtered reads, scoped exports, revocation, tenant isolation. |
| Internal aggregated | Approved product measures, thresholded cohort summaries, release status. | Classified role grant, minimum cell sizes, excluded/redacted sensitive fields, no default synthetic pollution. |
| Internal synthetic | Design examples, deterministic fixtures, synthetic evaluations. | Explicit fixtures; no live store subscription, project navigation, generation, writes, or telemetry. |
| Privileged operational | Provider contracts/configuration, cross-account incidents, security evidence, platform spend. | Explicit platform grants, purpose-limited access, audit, private caching, least-privilege payloads. |
| Exceptional restricted | Actual-data replay, fictional impersonation, customer-content support, paid evaluation, provider activation. | Separate capability, fresh explicit human approval, segregation of duties, visible identity/cost, expiry, full audit. |

### Cross-surface handoff contract

Use a small, typed handoff envelope containing only identifiers the destination is permitted to receive: destination capability, allowed project/document/board identifier where relevant, intended return URL, locale, and non-sensitive navigation intent.

- Reauthorize the destination and referenced resource on the server; reject stale or revoked scope.
- Preserve project/document identity, selected work, unsaved-edit protection, pending jobs, offline operations, generation consent/reservations, locale/RTL, keyboard focus, and browser history only when those concepts apply to the target.
- Never copy creator content, prompts, full projections, raw events, customer identities, or unrelated IDs into analytics URLs, design documentation, platform operations, or guest review.
- Provide an understandable inaccessible-resource state and safe return destination without disclosing the existence of other tenants/apps.
- Preserve `/document/*`, `/library/*`, `/canvas/*`, `/share/*`, `/system`, `/admin/events/*`, and other supported historical URLs through authorized redirects or compatibility ownership.

## Delivery sequence and exit criteria

### Stage 0: Establish the actual baseline and decision ownership

Deliverables:

- Persona/job inventory, current 39-route catalog, task-to-capability matrix, data sensitivity, canonical ownership, and application extraction criteria.
- Baselines for matched persona/task cohorts: task success, time to first relevant action, time to first retained result, irrelevant destinations, dead ends/denials, support contacts, app switches, performance, accessibility, and provider cost.
- Existing database/runtime table inventory, stable event schemas, compatibility routes, approval boundaries, and owner-approved effort/benefit estimates.
- A decision register that distinguishes `planned`, `running`, `failed`, `passed`, `approval_required`, `approved`, `revoked`, and `superseded`.

Exit only when each proposed standalone application has a named owner, validated audience/tasks, sensitivity classification, success metric, and explicit dependency status.

### Stage 1A: Move personal privacy before changing access

Deliverables:

- Creator-owned personal settings for consent, retention disclosure, attention enable/pause/delete, sharing-link review/revocation, language/accessibility preferences, and scope-correct personal usage.
- Consistent access to those personal controls from every authenticated application.
- Creator-readable provider/job errors: retry, adjust inputs, check own usage, contact support/administrator; no unactionable API-key, global-billing, organization, raw-event, or Operations instructions.
- Admin-as-creator behavior matching the clean ordinary creator experience.
- Document-native managed-production summaries that explain team, output units, known estimate versus actual cost, evidence basis, and unevaluated visual dimensions without requiring raw technical-receipt inspection.
- Repair shared multi-scene video announcements without corrupting Lit's rendering markers; keep scene-reel delivery and optional ambient audio honest.

Exit only when every creator can complete privacy/consent and delete/revoke tasks in no more than two navigational decisions, without entering Operations or losing any existing controls.

### Stage 1B: Implement deny-by-default capability and delivery boundaries

Deliverables:

- Server-owned principal/capability policy and scope evaluation; compatibility mapping from the four existing roles.
- Hosted administrator bootstrap comes only from an explicitly configured administrator identity; arbitrary first signed-in visitors never acquire platform-wide authority.
- Application/route registry entries declare required audience, capability, sensitivity, loader, canonical route, and backward-compatible aliases.
- Worker authorization before HTML/session hydration; equivalent checks for protected entries/chunks, APIs, exports, redirects, and navigation handoffs.
- Account/project-bound device queue ownership, synchronization locks, and conservative recovery of provably owner-attributed legacy Canvas batches; unidentified records remain quarantined.
- Persona-specific bootstrap/session projections that omit provider topology, global governance, budgets, event metadata, and unrelated applications when unnecessary.
- Entitlement-aware task launcher that disappears for users with only one available surface.
- Remove Operations, Laboratory, internal docs, and engineering/evaluation destinations from unqualified creator navigation only after Stage 1A is complete.

Exit only when the full role × scope × route × entry × API × export matrix denies unauthorized access, all legacy/share deep links remain valid for entitled users, and no page exposes unauthorized application data or dead-end links.

### Stage 2: Ship the first audience-focused product improvements

Deliverables:

- Creator Workspace with at most three to five primary task destinations, progressive document-lens selection, contextual Library/assistance, creator-owned settings, and one-click entitled Canvas handoff.
- Design & Knowledge publication limited to approved documents and interactive synthetic/store-independent production primitives.
- Product & Quality role-specific entry points for separately entitled Insights, Delivery, and Evaluation; safe synthetic evaluation first.
- Re-home platform phases, global provider controls, release approval, and audit into Platform Operations rather than creator paths.
- Role-specific dashboard defaults limited to five decision-oriented measures with a named metric owner.

Exit targets: at least 90% unaided completion of representative tasks per tested audience; at least 30% fewer irrelevant visible destinations and lower time to first relevant action versus the measured persona baseline; zero creator-visible internal destinations; no first-retained-outcome, privacy, sharing, accessibility, or performance regression.

### Stage 3: Extract internal ownership and canonical evidence

Deliverables:

- Platform Operations owns authoritative identity administration, provider policy/activation, spending, safety/legal review, final release approval, incident response, and privileged audit.
- Product & Quality exposes bounded task landings: Insights owns role-safe outcome measures; Delivery owns roadmap/decisions/milestones; Evaluation owns frozen corpora, synthetic scenarios, comparison evidence, and qualification results.
- Engineering Diagnostics owns redacted event/projection/sync/job/provider-implementation investigation; actual-data replay remains a separately approved restricted Evaluation mode.
- Consolidated release-readiness projection links to the current evidence rather than copied Markdown statements.
- Explicit domain-facing command/read facades reduce reliance on the current 23-action `/api/events` multiplexer while preserving the existing event envelopes and data store.

Exit only when every dashboard is scoped/redacted, product users cannot approve production providers, evaluators cannot activate a provider, engineers cannot silently run paid operations, actual-data access remains separately approved/audited, and each audience can finish its core task without entering an irrelevant privileged application.

### Stage 4: Build genuine tenancy before Workspace Administration

Deliverables, in strict order:

1. Durable organization/workspace identities, membership acceptance, delegated roles, and revocation.
2. Server-owned project ACLs, media/share scope, scoped budgets, tenant-aware analytics, and auditable privileged support.
3. An identity-preserving migration from account-only creative streams to authorized project ownership/sequencing and rebuildable scoped projections.
4. Multi-account read/write/export/share/media/analytics isolation tests, revoked-session tests, synchronization convergence, authenticated fan-out, and migration rehearsal/rollback.
5. Only after those gates pass: real Workspace Administration for tenant members, project access, policy, spend, and scoped audit.

Exit only when cross-tenant read/write/export/analytics leakage is zero, revoked access takes effect within the adopted service target, historical ownership remains attributable, and tenant administrators cannot access platform audit, unrelated tenant content, or restricted replay.

### Stage 5: Reliability, performance, accessibility, and extraction reassessment

Deliverables:

- Per-surface bundle and API budgets, role-shaped projections, cached/rebuildable read models, durable telemetry, and regression alerts.
- Scheduled/private-data retention, durable job execution/recovery, tenant fairness, provider settlement reconciliation, and scoped operational runbooks where justified.
- End-to-end keyboard/screen-reader/reduced-motion/RTL/zoom testing across role changes, direct links, handoffs, rejection states, and public sharing.
- 30/60/90-day measurement of audience activation, task completion, navigation noise, first meaningful outcome, switching cost, support load, provider cost per retained result, security incidents, and application ownership cost.
- Reevaluate standalone Evaluation, Workspace Administration, or Library only when real cohort evidence meets the application extraction criteria.

### Indicative sequencing, staffing lanes, and critical path

These are planning estimates rather than commitments; establish actual staffing, discovered migration complexity, and current production baseline before scheduling a launch.

| Delivery wave | Indicative effort | Accountable workstreams | Hard predecessor |
| --- | --- | --- | --- |
| Baseline, task research, capability inventory, test/build reproducibility. | Approximately one sprint. | Product/design research; platform architecture; quality/accessibility. | None. |
| Creator-owned privacy/account settings and creator-readable recovery. | Approximately one sprint. | Creator product/design; application engineering; privacy/accessibility. | Persona inventory and existing-control parity plan. |
| Capability grants, server route/asset/API guards, shaped sessions, cache partitions, and compatibility tests. | Approximately two sprints. | Platform/IAM; Worker/data engineering; security; design engineering. | Personal privacy must be available before legacy Operations access is removed. |
| Creator cleanup, synthetic Knowledge extraction, role-safe Product modules, Platform/Engineering ownership, and scoped analytics. | Approximately two to three sprints, with independent lanes where contracts allow. | Creator experience; design-system/docs; product analytics/delivery; evaluation; platform operations; engineering reliability. | Deny-by-default delivery/session contracts; classified docs; safe aggregate read models for production-facing analytics. |
| Genuine tenancy, membership, project ACL, stream/media/budget migration, and Workspace Administration validation. | Approximately three to five additional sprints; highly dependent on migration findings. | Identity/data platform; synchronization; security; customer administration; product. | Reconciled schema, rehearsed ownership migration, safe revocation, and multi-account isolation. |
| Ongoing performance, accessibility, telemetry, rollout, and 30/60/90-day audience-outcome review. | Continuous alongside and after each release wave. | Performance; accessibility; product analytics; release/operations; quality. | Instrumented baseline and defined persona-specific release gates. |

Critical-path ordering is **privacy parity → server-owned entitlement and scoped session delivery → audience-specific extraction → real organization/project authorization → customer Workspace Administration**. Design documentation extraction, creator mode simplification, and role-safe aggregate-read-model construction can overlap after their access/data contracts exist. A feature-flag rollback may restore a previous authorized route owner; it must never disable authorization, expose privileged session fields, or reverse a data migration without a rehearsed recovery plan.

## Technical architecture and implementation workstreams

### 1. Extend existing route/application seams; do not restart the platform

Build from `src/platform/applications.ts`, `src/route-loader.ts`, `src/apps/*/entry.ts`, `worker/index.ts`, and `tests/application-boundaries.test.mjs`.

- Extend application definitions with audience, required capabilities, route ownership, loader/asset sensitivity, and explicit aliases.
- Preserve independently loaded Lit/Vite entries and the existing prohibition on sibling-application imports.
- Keep the root shell responsible only for authenticated task selection, common design tokens, personal settings, and loading an authorized application.
- Use separately lazy-loaded Insights, Delivery, and Evaluation route modules so a product owner does not download or navigate through evaluator tooling.
- Update the existing hardcoded four-application architecture tests before introducing additional route-owning entries.

### 2. Treat routing, assets, session shape, and APIs as one security boundary

`vite.config.ts:17-25` deliberately bypasses the Worker for public immutable `/assets/*`, while `worker/index.ts:39-53` currently serves recognized application HTML before role checks. Protect privileged HTML, entry manifests, and sensitive application modules through a Worker-first protected asset prefix or separately access-controlled internal origin. Publicly cacheable shared assets must contain no secrets, customer content, sensitive manifests, or privileged bootstrap payloads.

Evaluate the authenticated principal and scope before resolving a protected route, streaming a session, returning a protected module, following a historical redirect, or fulfilling an API/export request. Shape creator, product, design, engineering, operations, workspace-admin, and guest payloads separately; never rely on frontend conditionals to discard already-disclosed private fields.

### 3. Preserve one shared event platform while introducing typed domain contracts

The first extraction unit is the **audience-facing application and its read/command facade**, not the database or provider service. Keep the shared Cloudflare Worker, D1 event history, R2 media, existing account identity, document IDs, immutable receipts, consent, budgets, provider approvals, and exact-resource share manifests until a real scaling/compliance reason requires physical extraction.

Introduce typed boundaries around:

- Identity/session and capability/scope evaluation.
- Durable event transport, append authorization, and replayable projection reads.
- Projects, documents, authored context, collections, and Library access.
- Generation readiness, provider selection, explicit consent, durable jobs, quotas, and settlement.
- Exact-resource sharing, authorized media, rights receipts, and revocation.
- Aggregated product metrics, evaluation evidence, release decisions, and privileged audit.
- Tenant membership/project authorization only after the Stage 4 foundation exists.

Do not create independent project/context stores, duplicated provider credential stores, conflicting share projections, separate budget counters, or disconnected approval/audit systems.

### 4. Reconcile schema ownership before major persistence extraction

The current runtime bootstraps 26 tables in `worker/runtime.ts`, while `db/schema.ts` declares 15 tables. Replay approvals, experiences, fictional personas, impersonation sessions, provider health, and generation preflight include runtime-only table definitions.

Create an authoritative schema inventory, ownership map, migration path, and consistency tests before attempting separate services/databases, tenant migration, or independent approval/replay persistence. Preserve immutable event compatibility and require migration rehearsal plus rollback evidence.

### 5. Build role-safe reporting projections rather than exposing raw analytics

The current administrator analytics endpoint still aggregates global users/streams under one hardcoded organization, although recent code now excludes synthetic streams by default and reuses principal-bound durable/in-memory checkpoints with incremental event deltas. Those performance improvements do not create customer or product authorization scopes. Produce bounded projections keyed by authorized audience/scope, exclude private prompt/attention/memory content, suppress small-cell identity leakage, preserve explicit synthetic-cohort labeling, and attach metric definitions, freshness, source, and owner.

Represent release state explicitly. Existing documentation illustrates why: `docs/evaluations/ideogram-adapter-cycle-5-outcome.md` records a passed 50-case provider evaluation, while other documentation still describes a provider gate as blocked. A passing evaluation is not the same as provider entitlement, legal approval, or release authorization. Canonical evidence must distinguish evaluation outcome from approval state.

### 6. Keep reusable design and inclusive behavior centralized

Reuse the current Lit production primitives, semantic `--forma-*` tokens, custom-element contracts, shared light/shadow DOM policy, native forms/dialogs, locale loaders, and accessibility utilities. Design & Knowledge examples must remain interactive but render synthetic fixtures only; remove any `FormaStore` projection access, project navigation, provider readiness, media reads, real analytics, or mutation side effects from that surface.

Use real links, native semantics, consistent document titles/headings, scoped page announcements, return focus, explicit scope breadcrumbs, and the existing en/fr/ar/RTL/reduced-motion/light/dark contracts on every authorized app handoff.

### 7. Decouple long-running work only when operational evidence justifies it

Current document jobs use request-coupled `waitUntil()`, and private-content redaction is opportunistically triggered by same-owner writes. Before separate deployment or larger tenant rollout, evaluate durable queue consumers, retries/dead-letter policies, per-tenant fairness, scheduled retention cleanup, provider settlement reconciliation, and auditable privileged support recovery. These are platform improvements, not new end-user application categories.

### 8. Concrete application, authorization, and state implementation map

Use the current same-origin Sites/Vite/Cloudflare Worker deployment as a modular monolith. The proposed paths below are technical implementation seams, not an instruction to create independent repositories, duplicate runtimes, or expose unfinished routes:

| Concern | Existing seam | Proposed next implementation boundary |
| --- | --- | --- |
| Shared capability vocabulary | `src/platform/applications.ts`; `worker/pilot-policy.ts`. | `src/platform/capabilities.ts` and a surface/route registry declaring required capability, scope, sensitivity, app loader, legacy aliases, and feature gate. |
| Server identity, scope, and access checks | `worker/index.ts`; `worker/pilot-policy.ts`. | `worker/auth/{identity,capabilities,scope,route-policy}.ts`, with one principal-derived, deny-by-default policy. |
| Persona-specific bootstrapping | `worker/session-bootstrap.ts`; `src/state/session-bootstrap.ts`. | Separate `worker/session/{creator,canvas,control,product,engineering,knowledge}.ts` projection profiles; validate surface and effective principal before streaming. |
| Application entry/import graphs | `src/apps/{creative,canvas,operations,laboratory}/entry.ts`; `src/route-loader.ts`. | Preserve existing Creative/Canvas entries; add bounded Control, Product, Engineering, Knowledge, and genuinely separate public-share entries as validated. |
| HTML generation and protected assets | `build/sites-vite-plugin.ts`; `vite.config.ts`. | Multiple entry templates; public immutable safe shared chunks; guarded `/internal-assets/<surface>/...` only for confidential internal modules. |
| Shared shell and app-local state | `src/components/forma-shell.ts`; `src/components/forma-element.ts`; `src/state/store.ts`. | Store-independent platform/session/navigation controller plus app-owned Creator, Canvas, Operations, Product, Engineering, and synthetic Knowledge controllers. |
| Personal privacy | `forma-shell.ts`; `forma-system.ts`. | Shared account/settings UI backed by a self-scoped privacy command contract before Operations access changes. |
| Public share | `src/components/forma-shared-view.ts`; `src/components/output-visual.ts`. | Independent public entry and presentational read-only output/gallery components; no `FormaStore`, account bootstrap, signed-in shell, or event polling. |
| Role-safe projections | `worker/analytics-api.ts`; `src/model/analytics.ts`. | `worker/projections/{analytics-redacted,delivery,eval-synthetic,ops-health,engineering-diagnostics}.ts`, each with its own permission and disclosure contract. |
| Event command ownership | `worker/events-api.ts`. | Typed action registry mapping every command/event to principal capability, resource scope, consent, approval, idempotency, and command validator. |
| Durable permissions | `db/schema.ts`; `drizzle/*`. | Auditable `capability_grants`; later real `organizations`, `organization_memberships`, `projects`, `project_memberships`, event-scope indexes, and media-resource ACLs. |

Important implementation corrections identified by design engineering:

- `src/components/forma-shell.ts:61-69` currently loads the global creative store on every authenticated route. The new platform shell must not hydrate creative events or start generation polling for Product, Design, or ordinary Operations pages.
- `src/components/forma-element.ts:1-12` binds application elements to the global store. Shared navigation, presentational output previews, and design documentation must not inherit store-connected behavior merely because they reuse product components.
- `src/components/forma-design-system-lab.ts:22-23,39,44-48` currently displays real project counts/actions and can navigate to production applications. Replace these with immutable synthetic fixtures and isolated DOM events.
- `src/components/forma-shared-view.ts` currently imports a store-connected output visual; extract a truly presentational read-only gallery before describing public review as an isolated application bundle.
- `tests/component-library.test.mjs` currently asserts that the design lab can navigate through the live store. That contract must be inverted: synthetic documentation must not navigate, subscribe, mutate, issue provider requests, or record real-product telemetry.

### 9. Enforce authorization before any protected bytes are delivered

Recommended request sequence:

1. Canonicalize the path once, reject traversal/encoded-path ambiguity, and resolve only explicitly registered application routes; never allow wildcard internal child pages.
2. Handle public `/share/:token` using exact-resource token policy only, without initializing an authenticated shell or creative session.
3. Resolve the trusted authenticated **principal**. An impersonated fictional account is never the authority for privileged capability checks.
4. Evaluate the requested surface capability, principal scope, resource ownership, feature gate, consent requirements, and applicable revocation/expiry.
5. Reject unauthorized `GET` and `HEAD` requests before protected HTML, route metadata, application-entry references, or embedded session bytes are emitted.
6. Validate any legacy redirect under the same policy before redirecting; avoid revealing protected application names or resource existence in denial responses.
7. Return only the role-specific bootstrap/profile and authorized task manifest with private, noncacheable personalized HTML.
8. Apply equivalent checks on protected internal assets, every API/command, media/export, scope-changing handoff, and privileged support action.
9. Audit restricted reads, actual-data replay, privileged impersonation, provider approvals, and other exceptional operations without logging user prompts, content, or credentials.

Use explicit, non-hierarchical capabilities. Do not treat `admin > creator > viewer` as equivalent to "all design, product, customer-admin, evaluation, engineering, impersonation, and provider powers." Transitional platform admins receive a deliberately enumerated allowlist; ordinary creators receive only self/project grants; unknown grants or scopes fail closed.

### 10. Partition caches, offline queues, subscriptions, and presence

Current cache and synchronization structures need additional boundaries before new personas or real tenancy are introduced:

- `src/state/account-cache.ts:40-70` keys cached account snapshots by user/policy and can reuse a `full` snapshot for a narrower profile. Add principal, audience, tenant/workspace when available, project scope, permission epoch, impersonation state, schema version, and projection version to every cache identity.
- Never satisfy a product/design/self-service request by filtering a previously cached privileged account projection in the browser; create the reduced projection server-side.
- `src/sync/canvas-offline-queue.ts` currently stores pending operations in a globally named database without complete tenant/account partitioning. Scope durable queue entries by authorized organization, project, principal, and permission epoch; reject or quarantine work when membership or accounts change.
- `src/canvas/presence.ts` currently keys browser-local presence by canvas identifier. Partition presence by principal and authorized project/workspace; do not present browser-local presence as genuine cross-account collaboration.
- Maintain one active identity/session, subscription coordinator, and generation-job polling owner. Do not multiply background polling or whole-account event folds by the number of applications or tabs.
- Invalidate all affected cached projections, queues, subscriptions, and protected task entries after logout, role changes, revocation, account switches, or tenant/project handoffs.

### 11. Adopt evidence-based route and query budgets

The last available production build predates several existing uncommitted source changes. Consequently, these measurements are a **stale-artifact comparison point only** and must be regenerated in a coordinated clean build before becoming authoritative:

| Existing route closure | Last available gzipped transfer | Proposed post-optimization ceiling |
| --- | ---: | ---: |
| Shared shell and shared CSS | Approximately 151 KiB. | 110 KiB total; target 65 KiB JavaScript and 45 KiB CSS. |
| Project home | Approximately 162 KiB. | 140 KiB. |
| Creator document | Approximately 241 KiB. | 210 KiB. |
| Canvas | Approximately 219 KiB. | 195 KiB. |
| Operations/product analytics | Approximately 161 KiB. | 140 KiB for Product; 150 KiB for Platform Operations. |
| Event inspection or replay | Approximately 257 KiB each. | 190 KiB; split the currently shared large inspector/replay module. |
| Design-system laboratory | Approximately 191 KiB. | 170 KiB without live-store hydration. |

These are proposed engineering targets, not claims that the current application already meets them. Reduce the existing large shared stylesheet by separating common tokens/base/navigation from application-local styles, remove or self-host blocking third-party font imports when licensed, and keep docs indexes, evaluation corpora, provider tooling, replay, and optional collaborative dependencies out of creator bundles.

Preserve existing D1/query invariants: an ordinary authenticated session should require no more than three read-only D1 calls; ordinary project/event/job list operations should remain bounded to the current approximately two-call patterns; batch SQL must respect D1's 100-parameter ceiling; offline operation delivery must remain idempotent. Fold resource authorization into a bounded server query or batch rather than issuing a database lookup for every component or row.

Measure cold/warm assets, cache hit class, route family, audience class, project/event-count bucket, D1 reads/scanned rows, compressed JS/CSS/API bytes, projection fold time, queue latency, and relevant p50/p75/p95 timings. Do not collect user identifiers, tenant identifiers, document text, prompts, media URLs, or assistive-technology fingerprints in telemetry.

### 12. Remediate discovered accessibility defects instead of carrying them forward

The accessibility review identified existing defects that should become explicit migration/release work rather than assumed inherited compliance:

- **Route identity and transitions:** `src/components/design-system/localization.ts:240` currently establishes a locale-level document title rather than updating the route-specific titles already declared in `src/platform/applications.ts`. Set a localized, route-specific `document.title`; expose exactly one primary heading and main landmark; move focus after new content is ready; announce the transition once.
- **Public shares:** `src/components/forma-shell.ts:215` bypasses the ordinary skip link on `/share/:token`. The separate guest experience needs its own skip link, semantic main, localized title, keyboard-complete result inspection, and no account/admin leakage.
- **Canvas equivalence:** `src/canvas/canvas-application.ts:483-485` hides reading-order controls until at least four items exist and applies a broad application role. Provide reading-order/list alternatives even for zero to three items; scope application semantics narrowly; avoid nested main landmarks and restore standard screen-reader navigation around the canvas.
- **Canvas controls and shortcuts:** spatial cards currently combine button-like articles with nested real controls, and single-letter shortcuts can intercept focused non-text controls. Use semantic groups/articles with separate native selection buttons and suspend global shortcuts whenever another interactive control owns focus.
- **Analytics tabs and reporting tables:** `src/components/forma-analytics.ts:32` exposes tab roles without the complete tablist keyboard/panel contract. Use the existing accessible tab primitive or a native button group; provide chart-equivalent semantic data tables with captions, headers, scope, sorting announcements, and textual trend explanations.
- **Presentation PDFs:** `src/model/presentation-pdf.ts:100` marks rendered PDFs as tagged without providing a real structure tree, semantic reading order, headings, lists, figures/alternative text, table semantics, or document language. The vector fallback also removes non-ASCII text, including Arabic. Do not claim PDF/UA or accessible PDF compliance until genuine tagged structure, Unicode/bidi text, language metadata, reading order, chart alternatives, and validator coverage exist; offer accessible semantic HTML in the meantime.
- **Locale, reflow, and preferences:** retain en/fr/ar, RTL, authored-content bidi safety, existing higher contrast targets, reduced motion/transparency, forced colors, visible focus, 320-pixel/200% layouts, and applicable 400% reflow checks across every persona and denial state.

Add rendered browser and keyboard journeys, automated accessibility scans, role/route/locale/zoom/preference combinations, manual VoiceOver/Safari and NVDA/Firefox checks, PDF tag validation, and an up-to-date Custom Elements Manifest. Source-pattern tests alone are not sufficient to verify user-visible behavior.

### 13. Migrate tenancy without rewriting or inventing existing history

When the customer-administrator business case is validated, first add real organization membership and server-owned project access. Backfill an explicit event-scope index and project/event membership projection while preserving original event IDs, actor identity, sequence provenance, causation, correlation, media ownership, idempotency, and immutable public-share manifests.

Quarantine ambiguous historical ownership as private rather than guessing. Rehearse dual reads, projection parity, authorized canonical `project:<id>` sequencing, media-resource ACLs, revoked membership behavior, scoped budget migration, and rollback before switching any tenant-facing read/write path. Only once separate users can verifiably gain and lose the intended project/media/job access may Workspace Administration or genuine collaboration become available.

## Ownership and decision rights

| Capability or decision | Accountable owner | Consulted or read-only consumers | Approval boundary |
| --- | --- | --- | --- |
| Creator workflow, personal controls, and output experience | Creator-product owner. | Design, accessibility, engineering, platform operations. | Explicit creator consent remains required for generation and sharing. |
| Canvas interaction and release readiness | Canvas-product owner. | Design, engineering, evaluation, trust/safety. | Platform Operations makes final governed release decision. |
| Platform identity, policies, providers, budgets, and incidents | Platform Operations. | Security, support, finance, product, engineering. | Only approved platform operators change platform policy or activate a provider. |
| Product metrics and roadmap/delivery priorities | Product/production leadership. | Evaluation, design, engineering, operations. | Product interprets evidence; it does not change provider/release policy. |
| Frozen corpora, synthetic experiments, qualification evidence | Evaluation/quality owner. | Product, design, engineering, operations. | Paid/actual-data runs need distinct explicit approval; Operations owns production activation. |
| Design system, documentation, interaction, and inclusive standards | Design/design-engineering owner. | Product, engineering, accessibility, integrators. | Only approved, classified material is published; demos remain synthetic. |
| Event/projection/sync diagnostics and technical remediation | Engineering/reliability owner. | Platform Operations and approved evaluators. | Sensitive customer-content access is separately authorized and audited. |
| Future workspace membership, tenant policy, and scoped audit | Customer workspace administrator. | Customer security/billing owners; scoped platform support. | Authority never escapes the specific organization/project and never becomes global `admin`. |

## Verification and release scorecard

### Product and audience experience

- Establish matched persona/task baselines before advertising improvement.
- At least 90% unaided success for creator creation/context reuse/Canvas return, guest share review, operator approval, product funnel analysis, evaluator qualification review, designer component discovery, and engineer synchronization diagnosis.
- At least 30% fewer irrelevant visible destinations and at least 30% faster time to first relevant action versus the corresponding measured baseline, without degrading first retained creative outcome.
- No more than two navigational decisions for each primary task and no unnecessary cross-application detour.
- No creator-visible provider credentials, implementation phases, raw events, internal evaluation controls, or Operations/Laboratory links.
- Workspace Administration is not released until the tenant-foundation isolation scorecard is fully green.

### Security, privacy, and consent

- Zero unauthorized role/scope access across HTML, protected entries/assets, session payloads, APIs, exports, redirects, and destination handoffs.
- Zero cross-tenant/project/customer media, event, analytics, prompt, private attention, or share-manifest leakage.
- Every public share remains exact-resource, read-only, revocable/expiring, privately cached, and free of account bootstrap, personalized navigation, or analytics mutations.
- Zero paid/provider operations, privileged replay/impersonation, or production activation without the existing distinct explicit human approval.
- Privacy controls remain available from every authenticated surface; creator enable/pause/delete/revoke actions work without platform-admin access.
- Admin-as-creator sees the same clean creator experience; internal tools require an explicit authorized task switch.

### Performance and reliability

- Preserve or improve the current measured p75 first-useful-action and route-loading baselines; target warm loaded-route transitions below 250 ms.
- Target p75 LCP at or below 2.5 seconds, INP at or below 200 ms, and CLS at or below 0.1, or stricter existing measured baselines.
- Do not increase creator initial-route JavaScript/CSS transfer, D1 round trips, session bootstrap size, API request count, or account-wide projection hydration.
- Maintain Canvas p95 visible-frame work below 16 ms where the current product scorecard applies.
- Prevent creator entries from importing privileged operations, replay, evaluation, corpus, documentation, design-catalog, or engineering chunks.
- Preserve pending jobs, account/project-isolated offline writes, retry/idempotency, budget reservations, consent, effective-account isolation, and direct-link behavior across all entitled application transitions; quarantine unattributed legacy device records rather than assigning them to a newly active account.

### Accessibility, internationalization, and component contracts

- No critical WCAG 2.2 AA regressions; preserve existing stronger text contrast where provided.
- Complete representative tasks with keyboard only and with a screen reader, including role task selection, privacy changes, Canvas handoff, output status, public share, access denial, and safe return.
- Preserve correct app/page title, primary heading, skip link, focus placement/return, live announcements, native form submission, and dialog semantics across app changes.
- Preserve en/fr/ar localization, RTL/bidi behavior, light/dark contrast, reduced motion/transparency, browser zoom, and 320-CSS-pixel layouts without horizontal task-blocking overflow.
- Publish an up-to-date, truthful Custom Elements Manifest; no application-state or fictional-slot leakage into supposedly store-free design documentation.
- Add automated role/route/browser coverage, accessible component/page assertions, manual assistive-technology checks, and visual/PDF verification to the existing native Node test foundation.

### Current validated implementation baseline

The reassessed creator-trust/production-visibility tranche was verified against the actual current source and deployment build on 2026-08-22:

```text
pnpm typecheck
PASS

pnpm lint
PASS

pnpm test
PASS: production server/client build; 548 tests; 0 failures

pnpm cem:check
PASS: Custom Elements Manifest is current (102 elements).
```

The full suite now includes executable checks for hosted first-user administrator allowlisting; denial of unauthorized Operations, Laboratory, historical internal aliases, and privileged production bundles before protected bytes; creator-owned `/settings`; effective-owner/project Canvas device queue filtering, foreign-account deletion refusal, conservative legacy quarantine, and server-side sync rejection; Lit-safe scene selection; truthful creator-visible estimated/reserved/actual production evidence; unrestricted Canvas reading order; and the preserved three-read authenticated creator navigation/session baseline.

The earlier transient lint failure, stale manifest, component-registration mismatch, and generated-server session-streaming failures no longer reproduce. No real provider call was made by this verification; externally generated outputs listed below were previously and separately authorized by the user. Actual cross-tenant authorization, composed MP4 delivery, decoded visual evaluation, and independently validated tagged multilingual PDF remain unsolved future gates rather than inferred from a passing build.

## Principal risks and mitigations

| Risk | Failure mode | Required mitigation |
| --- | --- | --- |
| Application sprawl | Four existing applications become a dozen branded destinations and creators must shop for tools. | Cap the initial authenticated portfolio at six; keep Library, personal settings, intelligence, seven lenses, and output formats contextual. |
| Privacy regression during cleanup | Locking Operations removes the only complete personal privacy controls. | Ship and verify creator-native universal self-service privacy before hiding/restricting the current Operations route. |
| Cosmetic authorization | Navigation hides privileged destinations while HTML, bootstrap, assets, APIs, or redirects still expose them. | One deny-by-default server capability policy across the full route/data delivery boundary. |
| Fake workspace administration | Global `admin` or intent-only project membership is presented as customer team access. | Block customer administration until tenancy, project ACL, stream migration, revocation, and multi-account isolation pass. |
| Analytics oversharing | Product/workspace dashboards expose global users, private prompt data, or all account streams. | Role/tenant-scoped aggregate projections, data minimization, small-cell suppression, and approved drillthrough. |
| Fragmented source of truth | New apps copy projects, contexts, jobs, provider state, budgets, or release evidence. | Preserve one event platform and typed domain services; link to one canonical evidence/approval owner. |
| Unsafe design previews | Component demos read live creator data, navigate, generate, or leak documentation receipts. | Approved docs plus interactive synthetic/store-independent fixtures only; test network, navigation, telemetry, and mutation isolation. |
| Privilege confusion | Evaluators activate providers, product users run paid replay, or engineers receive customer-admin rights. | Explicit capabilities, segregation of duties, one-use approvals, purpose-based audit, and role/scenario testing. |
| Deep-link and handoff breakage | Existing links, unsaved work, locale, offline operations, jobs, or guest shares fail during extraction. | Authorized compatibility routes, typed scoped handoffs, retry-safe persistence, and browser back/refresh/focus regression coverage. |
| Arbitrary privileged bootstrap | The first authenticated visitor on a fresh hosted deployment accidentally becomes a global administrator. | Require an explicit hosted administrator allowlist; permit automatic first-user bootstrap only for the local development identity. |
| Cross-account device custody | A shared browser stages or replays another account's pending Canvas content. | Bind offline batches, reads, removals, summaries, and synchronization locks to effective owner and project; quarantine legacy records lacking provable ownership. |
| Misleading managed-production evidence | Plan proxies, provider receipts, scene reels, or specialist labels are presented as verified media quality, a composed film, or hired humans. | Label evidence basis and measured coverage; explicitly state unevaluated image/video quality and actual ordered-scene delivery; describe specialist contracts as orchestration. |
| Documentation drift | A passed evaluation is confused with approved production availability. | Canonical versioned release-evidence projection with distinct passed, approval-required, approved, revoked, and superseded states. |
| Premature database/service extraction | Schema drift and account-only streams cause migration, reservation, media, or ownership failures. | Reconcile the 26 runtime/15 declared table inventory; extract UI/read facades first; rehearse every later data migration. |
| Paid-operation assumptions | Automation creates provider-backed work or repeats a charged submission without informed human approval. | Require a deliberate final human action beside exact maximum cost, provider/reference/audio disclosure, and server-enforced paid-media confirmation; preserve reservation identity and no-rebill recovery. Do not add a redundant blanket checkbox. |

## Cross-functional adversarial review outcome

All seven independently assigned reviewers found the proposed audience-focused delivery **higher-value than the existing mixed experience**, provided their stated conditions become non-negotiable release gates. Every approval is conditional; none represents permission to ship unresolved security or accessibility defects or unrelated in-progress lint failures.

| Reviewer | Verdict | Principal condition for creating higher value |
| --- | --- | --- |
| End user | Conditional pass. | Keep one coherent creator workflow, move privacy first, preserve handoffs, and avoid fake tenant administration. |
| Product owner | Conditional pass. | Limit application sprawl, assign decision ownership, scope reporting, and prove measurable persona-level outcomes. |
| Design lead | Conditional pass. | Use task-specific entry points, progressively disclose complexity, maintain contextual continuity, and eliminate live-data design previews. |
| System architect | Conditional pass. | Authorize every protected route, asset, bootstrap, and API before delivery; preserve one shared event platform. |
| Design engineer | Conditional pass. | Make shared chrome and documentation store-independent, isolate public shares, and keep creative workflows and component contracts intact. |
| Performance engineer | Conditional pass. | Lazy-load authorized surfaces, shape projections, partition caches/offline state, and replace global analytics scans. |
| Accessibility engineer | Conditional pass. | Fix navigation landmarks, Canvas keyboard equivalence, reporting semantics, truthful PDF accessibility, and real browser/assistive-technology coverage. |

## Adversarial product and design review disposition

### End-user reviewer: conditional pass, incorporated

The end-user reviewer rejected a recreated "four-app split," separate products for document lenses, mandatory Library/intelligence switching, creator-facing provider/engineering terminology, fake workspace administration, and claiming a nonexistent native report artifact. Required changes were incorporated: privacy first; a coherent Creator Workspace; creator-specific failure messages; exact-resource guest sharing; tenant isolation before customer administration; complete identity/draft/offline/job/locale continuity; and provider-backed Slides only after explicit human approval.

### Product-owner reviewer: conditional pass, incorporated

The product-owner reviewer rejected application proliferation, implied tenant support, unscoped product analytics, copied provider/evaluation ownership, and treating repository Markdown as an existing project-planning product. Required changes were incorporated: a six-surface initial ceiling; existing/extractable/new/blocked classifications; named owners and extraction ROI criteria; separate Insights/Delivery/Evaluation modules; server-filtered role-safe reporting; canonical release evidence; and measured phased business gates.

### Design-lead reviewer: conditional pass, incorporated

The design-lead reviewer rejected an "app mall," seven permanently prominent document modes, a mixed Product & Quality landing, duplicated replay/provider controls, live-data design demos, insensitive cross-app context copying, and treating navigation visibility as authorization. Required changes were incorporated: audience-entitled task launchers; a maximum of three to five creator primary destinations; progressive document-mode choice; independent internal module landings; interactive synthetic-only component demos; scope-checked handoffs; universal self-service settings; and pre-hydration route/entry/API capability enforcement.

## Adversarial technical review disposition

### System architect: conditional pass, incorporated

The architect approved the six-surface same-origin modular architecture only with creator privacy before Operations lockdown, non-hierarchical scoped capabilities, authorization before any privileged HTML/bootstrap/module bytes, surface-specific session shaping, and a strict prohibition on customer administration before genuine tenant/project authorization. The report incorporates a concrete capability/route/session/module layout, an ordered Worker request policy, protected-versus-public asset treatment, owner-preserving event/media migration, and an explicit recommendation against premature microservices or database separation.

### Design engineer: conditional pass, incorporated

The design-engineering review identified an otherwise easy-to-miss failure: the shared shell and base application element currently initialize the global creative store across unrelated applications. It also showed that the design-system parent observes live creator projections and that guest-share output rendering still depends on a store-connected component. The technical approach now requires a store-independent platform shell, app-owned data controllers, a progressive same-document view chooser, presentational guest output rendering, synthetic-only interactive design examples, truthful component-manifest contracts, and role-specific navigation/handoff tests.

### Performance engineer: conditional pass, incorporated

The performance reviewer rejected six independently initialized runtimes, account-wide projections on every surface, reuse of privileged cached snapshots, unpartitioned Canvas queues/presence, and product dashboards that scan all global events. The report incorporates one shared shell/runtime, independently lazy application modules, surface-specific projections, cache/queue/presence partitioning, incremental privacy-filtered reporting, D1 query ceilings, quantified route-bundle budgets, shared-CSS reduction, and the requirement to remeasure any historical build baseline against the intended release artifact.

### Accessibility engineer: conditional pass, incorporated

The accessibility reviewer accepted role-oriented delivery as an accessibility improvement only if the migration also fixes identified user-visible defects: route-specific titles and transition announcements, single main/heading ownership, guest skip links, creator-native privacy, keyboard-complete Canvas list equivalents for zero to three items, nested Canvas controls/application roles, incomplete analytics tabs/tables, and misleading unstructured PDF accessibility claims. The report now requires rendered-browser/assistive-technology verification, locale/RTL/zoom/preference coverage, truthful accessible-HTML review, genuinely tagged multilingual PDFs before any PDF/UA claim, and a continuously synchronized generated manifest; the previously observed manifest mismatch has since been resolved.

## Forma-authored review materials

Forma does not currently provide a generic generated `report` or `plan` artifact. The truthful native materials are:

1. A dedicated Forma project containing authored, reviewable planning documents.
2. Durable context blocks describing the existing baseline, personas, capability inventory, proposed portfolio, authorization boundaries, phased execution, technical dependencies, success measures, and reviewer conditions.
3. Optionally, the supported **Slides** output using the **Field notes** style, which is specifically appropriate for research, evidence, and plans.

Authored projects, documents, and context blocks can be created without provider execution. Subsequent supported outputs use configured external providers and may incur cost; each generation remains a separate human-approved action. Existing presentations can be reviewed as semantic HTML and exported as a **visual PDF**; the current PDF is neither a separate native report artifact nor a verified accessible/PDF-UA deliverable. Managed video is a playable ordered scene reel, not a combined MP4.

**Actual authoring status: completed.** Retesting the current application on its advertised `http://localhost:5173` endpoint confirmed that the earlier browser-security limitation no longer prevents ordinary project/document authoring. The **Forma Audience-Focused Application Portfolio — Review Plan** project now exists inside Forma, with four documents and **29 persisted authored context blocks**:

| Forma document | Authored context blocks | Verified completed outputs | Recorded document usage | Canonical document route |
| --- | ---: | --- | ---: | --- |
| 01 — Capability Catalog and Audience Portfolio | 7 | Short story; Slides. | $0.064540 | `/document/c9b29f08-5f37-4b2d-a4b8-4be07f320366/01-capability-catalog-and-audience-portfolio` |
| 02 — Secure Technical Architecture and Accessibility | 7 | Managed Video; managed Slides. | $9.169997 | `/document/6b864592-9704-4a1e-b2e1-14d911066abb/02-secure-technical-architecture-and-accessibility` |
| 03 — Delivery Roadmap, Scorecard and Review Gates | 8 | Scene; Slides. | $0.063078 | `/document/4a6ed5cf-f96b-4de3-ad3e-45078677454f/03-delivery-roadmap-scorecard-and-review-gates` |
| 04 — Review-Ready Presentation Brief | 7 | Slides; managed Video. | $9.189678 | `/document/b5038591-d80b-46c9-823c-37aa2536304e/04-review-ready-presentation-brief` |

A read-only current-runtime event projection independently verifies **four documents, 29 authored context blocks, eight completed outputs, three managed artifacts, and $18.487293 of recorded document-operation usage**. The initial project/blocks were entered through ordinary visible controls; the outputs were subsequently created only after the user requested and approved their individual generation operations. Current reassessment did not submit another provider call, mutate an application record, bypass browser security, or invent a generic report artifact. The exact authored context is also preserved in `docs/forma-persona-portfolio-review-contexts.md`.

## Source and verification index

- Existing application boundaries and invariants: `README.md:7-20`; `ARCHITECTURE.md:1-69`; `src/platform/applications.ts:34-199`; `src/route-loader.ts:8-14`; `tests/application-boundaries.test.mjs:12-85`.
- Existing creator/admin audience overlap: `src/components/forma-shell.ts:225-241`; `src/components/forma-system.ts:10-46`; `src/components/studio-navigation.ts`.
- Route/session/API security and current roles: `worker/index.ts:15-53`; `worker/pilot-policy.ts:6-65`; `worker/pilot-policy.ts:278-319`; `worker/analytics-api.ts:6-20`.
- Tenant and collaboration limitations: `docs/product-architecture-review.md:88-103`; `docs/plan-coverage.md:7-19`; `ARCHITECTURE.md:141-151`; `worker/realtime/canvas-admission.ts`.
- Shared event/job/media/provider services: `worker/events-api.ts`; `worker/document-jobs-api.ts`; `worker/generation-readiness.ts`; `worker/media-api.ts`; `worker/shares-api.ts`; `worker/image-adapters-api.ts`.
- Design, accessibility, component contracts, and localization: `DESIGN.md:245-361`; `src/components/design-system/*`; `src/components/forma-design-system-lab.ts`; `custom-elements.json`; `tests/form-semantics.test.mjs`; `tests/responsive-layout.test.mjs`.
- Product/evaluation planning and release evidence: `docs/event-sourced-creative-system-project-plan.md`; `docs/decisions.ndjson`; `docs/plan-coverage.md`; `docs/evaluations/*`; `src/apps/operations/canvas-governance.ts`.
- Performance and current delivery topology: `src/performance.ts`; `tests/data-loading-performance.test.mjs`; `vite.config.ts:13-25`; `worker/runtime.ts`; `db/schema.ts`.
- Supported review-output types: `src/model/document-artifacts.ts:3-26`; `docs/document-artifact-rendering.md`; `src/components/presentation-deck.ts`; `src/components/presentation-pdf-export.ts`.
