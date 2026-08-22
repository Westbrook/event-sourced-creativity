# Forma-specific defaults and reporter playbook

Read this reference only when the target is Forma and an actual in-app reporter exercise was explicitly authorized. Forma evolves; verify every route, label, policy, provider, and capability in the current application rather than treating historical observations as current facts.

## Default Forma assessment goals

Unless the user supplies a different set, score:

1. Well-managed context improves the quality and precision of generated content.
2. Deeply complex context is manageable through an approachable user experience.
3. One managed context can support multiple relevant generated outputs.
4. Event sourcing supports manual, collaborative, and automated interactions that measurably accelerate project success.

Treat context quality as a hypothesis to test, not an unconditional fact: assess source accuracy, sufficiency, rights, authorization, freshness, conflicting requirements, review, and outcome quality.

## Before using the application

Use an already-running Forma instance where possible. Determine its actual URL, signed-in account, consent state, authorized role, available provider, and spending boundaries without displaying credentials. Do not install dependencies, reconfigure providers, launch paid evaluations, or start extra servers unless separately authorized.

When controlling the actual in-app browser is appropriate and its skill is available, announce and fully read `browser:control-in-app-browser` before using its tools. Exercise normal visible user controls; do not forge events, bypass application permissions, or substitute direct APIs for a user-experience test.

## Isolate application writes

Create exactly one clearly named new research project, such as:

```text
Forma Next — Adversarial Product Research — YYYY-MM-DD
```

Historically, project creation was available under `/projects` through **New project → Project name → Create project**. The initial project contained one blank document that could be renamed.

Always verify the actual project name and expected document identity immediately before clicking a creation, save, or generation control. Project-overview routes such as `/studio/project` have previously depended on globally selected project state and can switch when another session changes the active project. Re-enter through an exact document deep link or the intended project card; cancel rather than risking a write to an existing project.

## Create useful context and documents

Create:

- One complete internal master document containing the synthesized goal scores, stakeholder disagreements, verified findings, primary-source competitive evidence, prioritized roadmap, and acceptance metrics.
- One document for each of the end user, market researcher, product owner, and procurement officer, with substantive score/pass/fail/remediation context.
- A separate public-safe output-source document when the complete internal context contains material that must not be sent to a provider.

Honor an explicit user limit on the number or kind of documents. Do not add optional master or sanitized documents when the user prohibited them; omit generation if it cannot be done safely within the approved structure.

Forma's **Guided brief** view has previously offered four useful sections:

```text
Purpose: goal, audience, lasting message.
World: required subjects and operating environment.
Expression: intended emotion, treatment, and composition.
Delivery: output format, accessibility, and exclusions.
```

Saving those sections can author multiple typed context blocks efficiently without a model call. Verify the current controls rather than relying on exact historical labels. Create additional documents through the currently supported project-overview flow only after confirming the intended project immediately before submission.

## Classify context before external generation

Keep the detailed internal master local when it contains sensitive data. In particular, do not send exploit mechanics, tenant-isolation weaknesses, real or example account identities, contact information, secrets, internal repository details, private customer records, personal information, or restricted financial data to an external provider unless that disclosure is specifically authorized.

For public-safe generation, create a separate shared source containing only aggregated scores, generic product objectives, fictional professional roles, nonsensitive differentiators, an abstract implementation sequence, and approved acceptance criteria. Verify every requested artifact consumes that sanitized source and not the internal master.

If an automated safety reviewer rejects a sensitive submission, do not repeat or bypass it. A genuinely sanitized source is materially safer; proceed only if the tool allows the new action.

## Generate and verify actual outputs

Only generate outputs the user explicitly authorized. Favor inexpensive text-only formats where they serve the task. Depending on current Forma capabilities, appropriate examples include:

- A narrative showing the desired user or customer journey.
- A stakeholder scene dramatizing the four reviewers' disagreements.
- An executive slide deck summarizing the scores, positioning, roadmap, and release gates.

Avoid images, preview/fan generation, storyboard frames, video, paid replay, evaluation runs, invitations, publication, and expensive media unless independently requested. An executive slide artifact is appropriate only when its actual implementation is a low-cost text/structured-output operation rather than image or rich-media generation. Preserve existing provider consent, application spending controls, and any user-provided cap; do not proceed when the actual charge is materially uncertain. Do not retry paid jobs speculatively or report a queued job as completed.

Wait for each authorized job's terminal state. Verify visible output cards and, where available, native **Inspect inputs** receipts showing the same source document, authorized project, provider/model, artifact ID, and input context. Capture real project/document links, artifact titles/IDs, counts, and readily visible token/cost information. Verify all role documents again after reload or concurrent route changes.

Report precisely which information remained internal, which sanitized facts reached a provider, what user-facing friction occurred, and which capabilities were genuinely observed. Attribute development-server/HMR failures carefully; concurrent source changes do not automatically prove a production defect.
