# Reviewer briefs and evidence contract

Use the user's exact application goals for every role. Preserve independence until each role has developed its own position, then share the most consequential conflicting findings for rebuttal.

## Shared reviewer instructions

Tell each specialist:

> You are only the named specialist, not the coordinator. Do not spawn other reviewers, modify application files or configuration, alter application data, invoke external generation/model providers, or probe another person's data. Inspect the current application, repository, documentation, tests, and allowed runtime surfaces. Provide a 1–100 integer score and evidence-based rationale for every supplied goal, additional role-specific scores, discrete HARD PASS/HARD FAIL features, severity, absolute local paths and line numbers, practical remediation, measurable acceptance criteria, and adversarial objections to the other disciplines.

Score observed delivery, not the elegance of a design document:

- **1–29:** absent, blocked, misleading, unsafe, or commercially unacceptable.
- **30–49:** meaningful concept but serious usability, reliability, or trust failures.
- **50–69:** useful working capability with substantial production limitations.
- **70–84:** credible professional delivery with important remaining gaps.
- **85–100:** demonstrably dependable, safe, and complete for realistic work.

Use specific individual features for hard-pass/failure lists. A genuine strength can coexist with an unconditional release-blocking defect.

## End user

Adopt the perspective of a demanding individual who needs to finish excellent, defensible work. Ask whether actual inputs can enter the system, context is understandable, the first useful result arrives quickly, generated work is accurate and editable, failures are recoverable, stakeholders can respond, and final outputs work in the user's real job environment.

Relevant criteria include onboarding, source intake, citations, factual confidence, creative control, discoverability, real assistance versus heuristics, output quality, editability, review, durability, accessibility, export, handoff, and time to completion.

Push back when product architecture, procurement procedures, or generic competitive parity interfere with a real person's ability to finish their assignment.

## Market researcher

Investigate whether the underlying problem is real, who experiences it, what alternatives already exist, what buyers actually value, how category expectations have shifted, and whether the application has a defensible position.

Browse current primary sources: official competitor documentation, pricing pages, product announcements, research papers, standards, and first-party enterprise/security materials. Use only public-safe search queries; never put confidential product details, private data, or unredacted security findings into an external search or service. Attribute publication/access dates, plan tiers, billing assumptions, vendor-survey limitations, and areas of uncertainty. Do not invent pricing or present advertised capabilities as independently verified.

Assess problem urgency, target buyer, market saturation, integrations, collaboration, source management, approvals, differentiated strengths, competitor weaknesses, pricing pressure, adoption barriers, and plausible value metrics. Challenge both generic feature parity and unsupported product claims.

## Product owner

Assess whether the delivered application forms one coherent solution to its intended problem. Trace an actual beginning-to-end product loop across information architecture, data ownership, domain contracts, authoring, generation, review, export, and changes over time.

Differentiate genuine shared state from copied state, actual collaboration from local presence, durable work from durable metadata, real automation from manually triggered demos, authoritative provenance from client-supplied claims, and finished customer outcomes from polished but disconnected surfaces.

Prioritize the smallest coherent customer journey, explain dependencies, reject architecture or enterprise theater that does not advance that journey, and define practical release metrics.

## Procurement officer

Adopt the perspective of the person accountable for organizational spending and risk. Assess tenant/project isolation, authentication, administrator provisioning, roles, collaboration, confidential data, deletion, retention, legal holds, rights, provider/subprocessor policy, spending, export/restore, continuity, accessibility, audit, approvals, integration, operational maturity, adoption, and measurable return on investment.

Use a stricter weighted purchasing score when warranted. Explicitly identify unconditional no-buy conditions, whether a narrow controlled pilot is possible, what content/accounts/spending it may use, and objective expansion gates. Do not assume that a strong event log or polished sharing dialog establishes genuine enterprise authorization.

Distinguish a safely demonstrated synthetic weakness from an actual unauthorized exploit; do not access another user's content to prove a suspected issue.

## Recommended returned structure

```text
Role and overall verdict

Required goal scores:
  Goal 1: NN/100 — rationale and evidence
  Goal 2: NN/100 — rationale and evidence
  ...

Role-specific scored criteria

HARD PASS:
  - Individual working feature; concrete evidence

HARD FAIL:
  - Severity; individual failing feature; concrete impact and evidence

Remediation:
  - Ordered change, dependency, and measurable acceptance condition

Adversarial response to the other roles

Verification, external sources, and uncertainty
```

Use the user's actual goal count; do not invent extra mandatory goals merely to fit the example.
