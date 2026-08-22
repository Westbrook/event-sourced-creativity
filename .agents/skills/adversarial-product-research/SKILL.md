---
name: adversarial-product-research
description: Assess an application through adversarial end-user, market-researcher, product-owner, and procurement perspectives; produce scored product goals, evidence-backed hard passes and failures, competitive research, remediation, and a prioritized build plan. Use for deep multiperspective product studies, Forma reassessments, or enterprise-readiness reviews; include an actual in-app reporter exercise only when the user authorizes it. Do not use for ordinary code review, bug fixing, or implementation requests.
---

# Adversarial Product Research

Produce an evidence-driven product study that explains whether the application actually helps its intended users, competes credibly, maintains a coherent product loop, and deserves organizational funding. Preserve the user's requested application, goals, scope, and authorization boundaries.

## Establish scope and evidence

Identify the application, repository or runtime, user-stated goals, desired deliverable, and whether application-data writes or external provider calls are explicitly authorized. If goals are missing, derive a small set from the application's actual positioning and label them as assumptions. For Forma, use its context quality, complex-context usability, context-to-many-outputs, and manual/collaborative/automated event goals unless the user specifies otherwise.

Inspect applicable repository instructions, working-tree status, existing documentation, architecture, user interfaces, schemas, authorization, persistence, events, output workflows, tests, and runtime availability. Treat existing or concurrently appearing edits as user-owned. Record the reviewed revision/time when the repository changes while the study runs.

Do not change application source code, modify existing projects, alter configuration, install dependencies, publish externally, or perform exploitative security testing unless the user separately requests and authorizes that action. An application research project, provider-backed generation, invitations, or other application-state changes require authorization independent of the research request.

Inspect package scripts before running them: commands labeled “test,” “build,” or “check” can regenerate tracked assets, clean directories, migrate data, or use paid providers. Prefer genuinely read-only targeted checks. Distinguish source-regex false positives and stale compiled artifacts from demonstrated customer-facing defects.

## Run four independent adversarial reviews

Read [references/review-roles.md](references/review-roles.md) before commissioning the reviewers. When subagents are available, spawn exactly these four bounded, independent roles in parallel:

1. End user.
2. Market researcher.
3. Product owner.
4. Procurement officer.

Give every reviewer the same application, explicit goals, baseline constraints, evidence requirements, and authorization boundaries. State that the reviewer is responsible only for their named role, must not spawn another panel, and must not edit source or mutate application data. Use a self-contained task prompt so a subagent does not mistake itself for the coordinator. If subagents are unavailable, perform the four perspectives separately and disclose that limitation.

Each reviewer must provide:

- An integer **1–100 score for every shared goal**, with a role-specific rationale.
- Additional scored criteria relevant to that role.
- Discrete **HARD PASS** and **HARD FAIL** features, including severity and supporting evidence.
- A role-specific overall assessment; procurement may apply stricter weighted buying criteria.
- A practical remediation report with dependencies and measurable acceptance criteria.
- An explicit argument against at least one other role's likely priorities or assumptions.

Use primary sources for current competitor capabilities, pricing, research, standards, and legal/enterprise claims. Keep search queries and externally transmitted material public-safe; never disclose private application details or security findings through competitive research. Include publication or access dates, billing/tier caveats, source links, and uncertainty. Do not treat marketing language, roadmaps, simulated features, local-only collaboration, or passing source-text tests as proof of actual user outcomes.

Cross-examine material disagreements and independently verify critical findings before scoring them as release blockers. Cite real local files with absolute paths and line numbers; clearly distinguish runtime observations, source evidence, external references, documentation assertions, and inference.

## Synthesize the decision and roadmap

Wait until all four reviews are complete. Build a goal-by-role score matrix, calculate per-goal means and an explicitly defined overall score, and separately report stricter role-specific measures such as procurement buy-readiness. Never let a good average conceal a security, data-loss, privacy, authorization, or financial hard failure.

Deliver:

1. The actual product thesis and whether market evidence supports it.
2. Each role's score, adjacent criteria, hard passes, hard failures, objections, and remediation.
3. Current competitor alternatives, relevant pricing assumptions, and defensible differentiation.
4. Verified release blockers with evidence, concrete impact, and confidence.
5. A dependency-aware build plan ordered from trust/ownership foundations through product workflow, collaboration, outputs, and automation as appropriate to the application.
6. Named ownership suggestions, practical effort ranges when supportable, measurable acceptance criteria, and buyer/launch gates.
7. Honest verification results, known uncertainty, and whether the application was changing during the assessment.

Preserve this sequence: **all four reviews first, synthesized study second, reporter third**. Write a standalone study only if the user requests a file or it materially improves delivery; when source changes are disallowed, place it in an authorized location outside the repository and explain if that location is temporary. An instruction to make no changes at all overrides optional file creation, including temporary files.

## Commission a reporter only within the user's authorization

After completing the synthesis, determine whether the user explicitly requested an actual in-app reporter project, content creation, or generated artifacts. Skill invocation or a general request for an assessment does not itself authorize those side effects.

If authorized and the application is accessible, commission one separate reporter. For Forma, first read [references/forma-reporter.md](references/forma-reporter.md); for another application, adapt the same isolation, classification, and verification principles to its genuine user-facing workflows.

The reporter must:

- Use the actual application as an end user, creating only a clearly isolated, newly authorized research project.
- Preserve existing projects and verify project/document identity immediately before every write.
- Prepare a complete internal research context plus role-specific documents when supported.
- Classify content before provider submission. Keep credentials, personal data, exploit mechanics, sensitive internal findings, private documents, and restricted information out of external model requests unless their transmission is specifically authorized.
- If a sensitive context cannot be transmitted, create a genuinely sanitized output context and generate approved artifacts from that single shared safe source.
- Use only authorized, appropriate provider operations; respect specified spending limits and avoid materially uncertain charges, duplicate retries, expensive media, publication, or fake worker events.
- Respect an automated safety rejection. Do not bypass it, repeat the same blocked operation through another interface, or seek approval when the tool explicitly prohibits doing so. A materially safer operation may proceed only if it is genuinely within scope and accepted.
- Wait for terminal completion and verify real documents, context, output titles/IDs, common source, provider, and available usage evidence. Do not represent queued, simulated, authored-only, or failed artifacts as completed generated outputs.

If application writes or provider use were not authorized, keep the reporter read-only or omit it and explicitly state what additional authorization would be necessary. If the application cannot perform a requested output, report the limitation rather than fabricating it.
