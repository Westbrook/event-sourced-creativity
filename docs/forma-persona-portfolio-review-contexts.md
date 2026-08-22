# Forma-ready audience-portfolio review documents and context

Date: 2026-08-22  
Companion report: `docs/persona-oriented-application-portfolio-and-delivery-plan.md`  
Suggested Forma project: **Forma Audience-Focused Application Portfolio — Review Plan**

This package contains ready-to-paste documents and context blocks using Forma's real supported **Direction**, **Audience**, **Subject**, **Message**, **Brand**, **Accessibility**, **Exclusion**, and **Emotion** block types. It does not invent a native `report` artifact: these are authored Forma context documents, suitable for later review and optional supported **Slides** generation.

The assigned end-user agent opened the running Forma application and reached its actual **Name your project** dialog. Further browser interaction was then explicitly denied by browser URL-security policy before a project or document could be saved. No browser restriction was bypassed, no provider call was made, and no paid generation was authorized.

When the application can be used normally, create the named project at `/projects`, rename its initial document, create additional documents from `/studio/project`, and add the following blocks through **Add a context block**. The context is intentionally written as creator-readable, self-contained reporting.

## Document 1: 01 — Capability Catalog and Audience Portfolio

### Direction block

Explain why Forma should evolve from four existing, independently loaded applications—Creative, Canvas, Operations, and Laboratory—into audience-focused experiences over one shared creative platform. The problem is not a missing application split: it is that one shell, coarse permissions, internal reporting, personal privacy controls, and unrelated technical tools still mix distinct audiences. Describe the opportunity through 42 capability families across end users, future customer/workspace administrators, platform administrators, production/product/evaluation teams, design teams, and engineering teams.

### Audience block

Address six principal stakeholder groups: creators/end users; future customer workspace administrators; platform administrators and trust/safety/support operators; product owners, delivery leads, production specialists, and evaluators; designers, accessibility specialists, and internal documentation readers; and engineering/reliability teams. Include external client/stakeholder reviewers as a separate exact-resource public-sharing audience. A person may have more than one grant, but their creator experience should stay clean until they deliberately switch to an authorized internal task.

### Subject block

Catalog the current capability families: project discovery; document/context authoring; seven interchangeable document lenses; project Library and reusable blocks; image/story/scene/slides/storyboard/video generation; Canvas spatial composition; continuity/Scout/taste; personal privacy and usage; exact-resource sharing; future tenant membership/access/budgets; platform identity/providers/finance/governance/release/audit; outcome analytics; delivery planning; release evidence; evaluation corpora; design-system documentation; accessibility/localization; event/projection diagnostics; synchronization; synthetic/actual-data replay; provider engineering; and performance/reliability.

### Message block

Recommend at most six authenticated task surfaces in the initial portfolio: (1) Creator Workspace, including projects, documents, contextual Library, all output formats, assistance, and personal privacy; (2) the existing entitled Canvas companion; (3) Platform Operations; (4) Product & Quality with separately entitled Insights, Delivery, and Evaluation modules; (5) Design & Knowledge with interactive synthetic examples; and (6) Engineering Diagnostics. Public Review & Share remains a minimal unauthenticated exact-resource security boundary. Future Workspace Administration is blocked until genuine tenant/project authorization exists.

### Brand block

Describe the proposed experience in plain language that speaks to a person's goal: “Create,” “Projects,” “Library,” “Workspace settings,” “Product insights,” “Release evidence,” and “Design documentation.” Keep technical concepts such as event streams, provider keys, release gates, evaluation corpora, and platform policy out of normal creator navigation. Provide no more than three to five primary creator destinations and no more than five decision-oriented measures on any role-specific landing page.

### Accessibility block

Keep every audience's primary task understandable and keyboard-operable. Preserve localized English, French, and Arabic labels; right-to-left layouts; visible focus; skip links; semantic headings; native dialogs/forms; reduced-motion and high-contrast behavior; and clear cross-surface destination announcements. Creator privacy and exact-resource guest review must be available without entering administrator or engineering experiences.

### Exclusion block

Do not describe Forma as an undifferentiated monolith. Do not split seven representations of the same document into separate products, create one application for each output format, force creators to leave their document to manage context, present fictional collaboration as real team access, grant customers the global administrator role, or expose platform/evaluation/engineering links to ordinary users. Do not claim a generic native `report` or `plan` output exists.

## Document 2: 02 — Secure Technical Architecture and Accessibility

### Direction block

Define a same-origin modular application portfolio that keeps one Cloudflare Worker, D1 durable event history, R2 media boundary, account identity, project/document/context contracts, provider policy, consent ledger, budget reservations, and reusable Lit design system. Separate audiences through independently loaded entries, bounded internal modules, explicit server authorization, minimized read models, and carefully scoped cross-application handoffs—not duplicated data models, iframe/microfrontend stacks, or premature microservices.

### Audience block

Write for system architects, design engineers, performance engineers, accessibility engineers, security/platform operators, product owners, and implementation teams. Distinguish audience access from task-specific exceptions: evaluators can inspect approved qualification evidence without activating providers; product owners can read safe aggregates without viewing creator identities or private events; design readers use synthetic examples; engineering accesses redacted diagnostics; actual-data replay, impersonation, paid execution, and provider activation require separate human approval and audit.

### Subject block

Identify concrete source seams: `src/platform/applications.ts`, `src/route-loader.ts`, `src/apps/*/entry.ts`, `worker/index.ts`, `worker/pilot-policy.ts`, `worker/session-bootstrap.ts`, `src/state/store.ts`, `src/state/account-cache.ts`, `src/sync/canvas-offline-queue.ts`, `src/canvas/presence.ts`, `worker/analytics-api.ts`, `src/components/forma-design-system-lab.ts`, and `src/model/presentation-pdf.ts`. Add a shared capability registry, scoped route policy, role-shaped bootstrap profiles, store-independent platform shell, app-owned data controllers, redacted audience projections, and truly isolated public share entry.

### Message block

Enforce non-hierarchical, deny-by-default capability grants before any protected HTML, session payload, route metadata, internal entry/chunk, API response, export, redirect, or sensitive handoff is delivered. Existing roles are only viewer, agent, creator, and global admin; introduce granular self, project, platform, product, evaluation, design, and engineering scopes without treating platform admin as a customer tenant-admin shortcut. Shape creator sessions to personal policy and usage only; never disclose provider topology, global governance, all-user analytics, or raw customer events to unrelated audiences.

### Brand block

Treat the shared platform as one source of truth: immutable event provenance, rights receipts, explicit consent, generation readiness, provider approvals, reservations/settlement, exact-resource sharing, and the reusable design system each have one authoritative owner. Product owns outcome interpretation and delivery planning; Evaluation owns corpora and qualification evidence; Operations owns production activation and release approval; Engineering owns implementation diagnostics; Design owns approved standards and synthetic previews.

### Accessibility block

Address concrete known gaps before shipping: route-specific localized document titles and a single transition announcement; exactly one main landmark and primary heading; a skip link on public shares; creator-native privacy; Canvas accessible reading order even for zero to three items; no nested interactive Canvas controls or uncontrolled single-letter shortcuts; correctly implemented analytics tabs; semantic reporting tables and chart alternatives; and accurate multilingual PDF claims. Current generated PDFs lack a real structure tree and the fallback strips Arabic, so accessible semantic HTML is the review source until truly tagged/validated PDF output exists.

### Exclusion block

Do not authorize by hiding navigation alone. Do not stream protected HTML before validating the principal. Do not reuse full privileged cached projections for narrower roles, mix tenant/account data in offline queues or presence channels, scan all global events to serve a product dashboard, load live creator projections inside design documentation, or initialize a private creator store on public review. Do not launch tenant administration until real organizations, memberships, project ACLs, revocation, scoped media/budgets, identity-preserving stream migration, and multi-account isolation exist.

## Document 3: 03 — Delivery Roadmap, Scorecard and Review Gates

### Direction block

Provide an executable migration roadmap that first protects current creators, then creates enforceable audience boundaries, then incrementally extracts internal task surfaces, and only afterward considers customer-facing tenant administration. Define release blockers and measurable evidence rather than treating a navigation relabeling or a copied roadmap as a completed product split.

### Audience block

Prepare the roadmap for the product owner, design lead, end-user representatives, system architect, design engineer, performance engineer, accessibility engineer, platform operations, evaluation/quality, engineering, and future customer administrators. Make owners, dependencies, decisions, role-specific success criteria, and release/rollback authority unambiguous.

### Subject block

Use this critical path: Stage 0 establishes persona/job inventory, route/data sensitivity, task baselines, schema inventory, owner assignments, and reproducible generated artifacts. Stage 1A delivers creator-owned privacy, usage, sharing, and understandable recovery before restricting Operations. Stage 1B implements deny-by-default route/asset/API/redirect authorization, granular scopes, shaped sessions, cache boundaries, and legacy-link protection. Stage 2 reduces creator navigation and publishes isolated synthetic Knowledge plus separately entitled Product modules. Stage 3 assigns canonical Operations/Product/Evaluation/Engineering ownership and role-safe aggregate reporting. Stage 4 implements real organization/project authorization and migration before any Workspace Administration launch. Stage 5 continuously verifies performance, accessibility, reliability, rollout, and long-term outcome value.

### Message block

Adopt measurable acceptance gates: at least 90% unaided critical-task completion per tested persona; at least 30% fewer irrelevant destinations and reduced time to first relevant action versus a real baseline; zero unauthorized HTML/session/API/export/asset disclosure; zero cross-tenant/project/media/share leaks; zero unapproved paid provider or replay execution; preserved deep links, current project/document identity, browser history, unsaved edits, offline actions, locale, and personal consent. Target p75 loaded route transitions under 250 ms, LCP at or below 2.5 seconds, INP at or below 200 ms, CLS at or below 0.1, and no more than three read-only D1 calls for a normal authenticated session.

### Brand block

Keep reporting decision-oriented and appropriately scoped: creators see current work, next action, own usage, and saved/shared outcomes; future customer administrators see only tenant seats, access, spend, and policy; operators see readiness, launch blockers, incidents, and platform limits; product sees activation, retained value, reuse, friction, and cost per retained outcome; evaluators see corpus, threshold, regression, evidence, and approval status; designers see component, accessibility, and localization coverage; engineers see redacted reliability, synchronization, queue, and provider-implementation signals.

### Accessibility block

Make WCAG 2.2 AA a release condition and preserve stronger existing contrast/focus targets, keyboard-only primary workflows, screen-reader route announcements, en/fr/ar and RTL, reduced motion/transparency, forced colors, 320-pixel layouts, 200% text enlargement, applicable 400% reflow, and accessible guest/privacy/denial states. Add real browser and assistive-technology testing instead of relying only on source-pattern assertions. Block accessible-PDF claims until actual structural tagging, Unicode/bidi support, and independent validation are present.

### Emotion block

Communicate calm confidence and practical honesty. Acknowledge that all seven independent reviewers—the end user, product owner, design lead, system architect, design engineer, performance engineer, and accessibility engineer—conditionally approve the revised plan because it offers higher value than today's mixed delivery, provided the documented security, privacy, accessibility, performance, data ownership, and tenant prerequisites become nonnegotiable release gates.

### Exclusion block

Do not claim unmeasured 30% gains as already achieved. Do not claim current Canvas collaboration is cross-account, a passed provider evaluation equals production activation, existing Markdown files already provide a planning application, generated PDF is PDF/UA-compliant, or a stale production build represents current source. Preserve the existing dirty worktree: `pnpm typecheck`, `pnpm lint`, and 69 focused source tests pass, while `pnpm cem:check` currently reports a stale generated Custom Elements Manifest and requires a coordinated clean-build decision.

## Document 4: 04 — Review-Ready Presentation Brief

### Direction block

Prepare an executive-readable, evidence-backed presentation that explains why Forma's current four applications still overwhelm unrelated user groups, which 42 capability families exist, how a six-surface audience-oriented portfolio improves focus, which platform boundaries must remain shared, and what security, accessibility, performance, organizational, and release gates must precede rollout.

### Audience block

The presentation audience includes end-user representatives, product owners, the design lead, platform administrators, production/delivery managers, quality/evaluation specialists, system architects, design engineers, accessibility engineers, performance engineers, reliability teams, and future customer workspace administrators. Assume mixed technical familiarity and explain every decision in terms of the user group's concrete goal.

### Subject block

Recommended slide progression: (1) executive problem and current four-application baseline; (2) six audience groups and 42 capability families; (3) today's creator/admin/evaluation/documentation collisions; (4) proposed six authenticated task surfaces plus exact-resource public review; (5) persona-to-capability and data-sensitivity matrix; (6) one shared Worker/D1/R2 event platform with role-shaped entry points; (7) creator privacy and server authorization as immediate release blockers; (8) real tenancy prerequisites before customer Workspace Administration; (9) staged roadmap, owner decisions, and critical path; (10) measurable product/performance/accessibility/security gates and seven conditional reviewer approvals.

### Message block

Anchor the recommendation in a single sentence: **Separate audiences, privileges, and decision-oriented reporting—not the creator's projects, documents, context, output history, or source of truth.** Explain why Context Library and Evaluation should remain modules until a validated specialist audience justifies independent products. Distinguish existing, extractable, new, and blocked capabilities. End with clear decision requests: fund privacy-first experience cleanup, scoped security/session foundations, role-safe reporting, and a later tenant-authorization discovery initiative.

### Brand block

Use a concise, structured research-and-planning treatment: trustworthy, calm, inclusive, decision-oriented, and free of implementation jargon on creator-facing slides. If later generated through Forma, choose its supported **Slides** output with the **Field notes** presentation style. Favor clear headings, concise comparisons, an application-to-audience matrix, a migration timeline, and role-specific success measures.

### Accessibility block

Use meaningful headings, semantic lists, plain-language summaries, clear chart/table equivalents, high contrast, readable labels, concise speaker notes, and localization-aware copy. Treat semantic HTML slide review as the accessible deliverable. Do not describe the current visual PDF export as tagged, PDF/UA-compliant, or equivalent to an accessible report until its documented structural and Unicode defects are fixed.

### Exclusion block

Do not trigger **Create output**, **Generate**, **Ask Forma**, replay generation, adapter evaluation, or any other provider-backed paid action unless a human explicitly approves that operation. Do not claim a generic native report, planning, or memo artifact exists. Authoring the project, documents, and context blocks is sufficient to prepare reviewable materials and a complete later slide-generation brief.

## Suggested manual authoring checklist

1. Open Forma's ordinary `/projects` page.
2. Choose **New project** and create **Forma Audience-Focused Application Portfolio — Review Plan**.
3. Rename the initial blank document to **01 — Capability Catalog and Audience Portfolio**.
4. Add its seven authored blocks using the labeled block types above.
5. Open `/studio/project`, choose **New document**, and create Documents 2, 3, and 4 in order.
6. Add each document's corresponding authored blocks without importing references or activating provider features.
7. Verify the project overview lists four documents with seven, seven, eight, and seven context blocks respectively.
8. If a human later explicitly approves provider usage, open Document 4 and request the supported **Slides** output using **Field notes** styling; otherwise leave generation unstarted.

No authentication bypass, direct API write, database mutation, paid provider execution, or browser-policy workaround is needed or authorized.
