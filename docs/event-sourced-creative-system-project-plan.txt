# Event-Sourced Creative System

## Project Plan

**Purpose:** Standalone implementation specification for a new agent or engineering team  
**Run mode:** Begin with Agent Bootstrap, continue through Phase 0, and execute in order while honoring every gate and standing invariant

---

## 0. Purpose and operating instructions

This is a clean-room build plan for an event-sourced creative application. It contains the complete product, architecture, interaction, privacy, evaluation, routing, and visual-system specification needed to begin in an empty workspace.

It is intentionally not a progress report. A team or orchestrator should be able to start with an empty repository, execute the phases in order, and arrive at the full application ecosystem described here.

### 0.1 How to execute the plan

1. Begin with the decisions and invariants in this document.
2. Create the append-only decision ledger before writing the first product event.
3. Treat each phase’s **Done when** clause as its acceptance gate.
4. Do not cross a gate by weakening an invariant or silently deferring its witnessing events.
5. When a decision changes, append a superseding decision with rationale and reversal cost. Never rewrite the history to make the outcome appear inevitable.
6. Continue non-dependent work when a human-owned decision blocks one branch.
7. Build evaluation instrumentation in the same change as the surface it evaluates.
8. Preserve the user’s authority at every boundary between evidence, inference, proposal, and authored state.

### 0.2 Agent bootstrap

Before Phase 0, the implementing agent should establish a minimal, inspectable workspace:

1. Create a new repository with Node.js 22.13 or newer, TypeScript in strict mode, and pnpm as the package manager.
2. Initialize a Vite application that produces Cloudflare Worker-compatible ESM output.
3. Add Lit, `signal-polyfill`, `signal-utils`, Drizzle ORM, the Cloudflare Vite plugin, ESLint, and the Node test runner.
4. Create these initial surfaces:
   - `src/components/` for Lit custom elements;
   - `src/model/` for events, folds, projections, block taxonomy, routing, and evaluation scenarios;
   - `src/state/` for the application store and server-synchronized UI state;
   - `worker/` for append, query, upload, share, provider, and static-entry routing;
   - `drizzle/` for versioned database migrations;
   - `scripts/` for replay, migration, and operational utilities;
   - `tests/` for projection, permission, routing, accessibility, replay, and invariant tests;
   - `docs/` for the decision ledger, payload classification, event registry, and operational policy.
5. Create scripts for development, build, type checking, linting, tests, replay, and migration generation.
6. Configure logical D1 and R2 bindings for local/private deployment while keeping the production Postgres and object-storage adapters behind interfaces.
7. Add continuous checks for type safety, lint, full build, tests, projection rebuild equivalence, and CSS invariants.
8. Make the first repository commit contain only the bootstrap, this plan, and the empty append-only decision ledger.

The new agent should not begin by inventing screens. It should begin by recording the baseline decisions, defining the event envelope, and establishing the rebuild test harness.

### 0.3 Product outcome

Build an event-sourced creative studio in which:

- people construct reusable creative context from typed blocks, references, constraints, and outcomes;
- generated work cites the exact context that produced it;
- interruptions preserve momentum through event-derived re-entry;
- agents can extract, propose, investigate, and prepare without silently editing authored truth;
- inferred taste and attention remain weak, reversible, inspectable signals;
- every application view can be rebuilt from one durable stream;
- administrators can inspect, replay, and explain the system outside the main creative interface;
- project, document, Library, and administrative state can be shared through durable URLs;
- the application remains standards-first, accessible, responsive, portable, and provider-neutral.

---

## 1. Product model

### 1.1 One system at three altitudes

| Altitude | Concern | System expression |
| --- | --- | --- |
| Synchronous creative surface | What the person manipulates now | Documents, typed blocks, references, outputs, comparisons, chat proposals |
| Temporal substrate | What survives between sessions | Events, collections, sessions, briefs, rejected paths, conditions, memories |
| Model participation contract | How assistance behaves safely | Task-specific projections, actor permissions, expected sequence, evidence, budgets |

The context document is a projection over the event log. A block is the current fold of events about one creative reality. A generation is reproducible because `ContextCompiled` freezes an immutable snapshot of the exact input, not because the latest document happens to resemble it.

### 1.2 Durable hierarchy

```text
Account
└── Projects
    ├── Collections (authored organization)
    ├── Documents
    │   ├── Context blocks
    │   ├── Outputs
    │   └── Document views
    └── Project library (derived discovery + deliberate keeping)
```

Creative intelligence operates across witnessed work without silently changing the durable hierarchy:

```text
Re-entry → Scout → Taste & time
```

Administration observes and governs the system without competing with creative destinations:

```text
System & governance → Event operations
```

### 1.3 Authored and inferred pairs

| Scope | Inferred state | Authored state |
| --- | --- | --- |
| Block property | Extracted palette, mood, composition, material, lighting, or spatial finding | User adopts or edits the finding into the document |
| Taste | Confidence-bearing, decaying preference claim | `PreferenceAuthored`, optionally citing the claim it promotes |
| Organization | Aesthetic-family membership | `CollectionCreated` and explicit user filing |
| Scout result | Candidate artifact in report space | User promotion into a document block |

These are different objects. Promotion is a user act and an event. Undo restores authority as well as value.

---

## 2. Standing invariants

These apply to every phase, interface, worker, provider adapter, and deployment.

1. **The event log is the only source of truth.** Mutable state that can be derived belongs in a projection.
2. **Workers append events.** Workers never mutate projections directly.
3. **Every projection is rebuildable.** Wiping it and replaying the stream must reproduce the same result.
4. **Inference remains attributable.** Every inferred property carries evidence, confidence where applicable, and a supersession path.
5. **Inference never silently becomes authorship.** Promotion requires a user act.
6. **Equivalent surfaces commit equivalent events.** Canvas, keyboard, chat, and alternate document views share one vocabulary.
7. **Keyboard parity is foundational.** It is not a late accessibility pass.
8. **Embeddings, aggregates, families, attention summaries, and taste beliefs are projections, never truth.**
9. **Witness facts when their surfaces ship.** A missing view can be rebuilt; a missing fact cannot be backfilled.
10. **Never witness what can be derived.** Admit a new event only when the fact would otherwise be lost, a named view requires it, and no anti-goal is violated.
11. **Every model consumer is a compiler.** Model-specific prompt strings live only in adapters.
12. **Model proposals carry `expected_sequence`.** Stale work is rejected or explicitly rebased.
13. **Undo is compensation.** The compensating event references what it reverses and restores semantic authority.
14. **Instrumentation is optional for the user and complete for an enabled surface.** Declaring intent never gates creation.
15. **The system must make the user more capable, not more dependent.** Dosage caps are ceilings, never targets.
16. **Filing, preference promotion, extraction adoption, and Scout promotion are authored acts.** No worker performs them implicitly.
17. **Erasable content stays outside the immutable log.** Events retain non-sensitive references and receipts.
18. **Assistance must be falsifiable.** Claims expose evidence at the point where they ask for trust.
19. **Every visible control has an outcome.** It performs an event-backed action, navigates to a durable destination, or remains disabled with the missing prerequisite explained.
20. **The same document remains the same document in every view.** Alternate experiences may regroup the projection but may not omit durable content.
21. **Human-blocked capabilities remain reviewable without being falsely activated.** Provide functional simulations and governance surfaces while external execution stays disabled pending approval.

---

## 3. Baseline decisions

The following decisions are inputs to the build, not questions for each implementation team to reopen casually.

### 3.1 Event and data decisions

| Decision | Adopted position |
| --- | --- |
| Source of truth | One append-only event log; every application view is a replayable projection |
| Stream partition | One per-user stream for the first product; aggregate boundaries remain projections |
| Envelope | Include event ID, stream ID, sequence, valid/system time, actor, client, correlation, causation, compensation, schema version, type, and payload from event #1 |
| Event contract | One discriminated event union behind one append boundary; actor-by-type permissions enforced server-side |
| Handles | Content-derived, user-editable, never auto-renamed; retain historical aliases and positional collision fallbacks |
| Block extensibility | Closed v1 taxonomy with `type: string` and versioned JSON properties as the additive seam |
| Erasure | Keep erasable natural language and private provider content in an external store; immutable payloads hold pointers and non-sensitive receipts |
| Collections | Authored tree, one parent per item, sibling-scoped handles, fractional positions, implicit root |
| Physical deletion | Do not physically delete creative state; remove/restore events produce reversible tombstones |
| Embeddings | Store source artifacts as truth; embeddings are model-versioned, fully rebuildable projections |

### 3.2 Runtime and provider decisions

| Decision | Adopted position |
| --- | --- |
| UI runtime | Lit custom elements on a plain Vite/Cloudflare Worker shell; no React runtime |
| Reactive state | `signal-polyfill` and `signal-utils` isolated behind `ApplicationStore` so proposal changes do not leak into component contracts |
| Pilot persistence | D1 for durable event storage and R2 for media |
| Production persistence | Postgres 17, pgvector/HNSW, TimescaleDB, and object storage |
| First live provider | OpenAI Responses API with `gpt-5.6-terra`, structured output, `store: false`, and a privacy-preserving safety identifier |
| Provider diversity | Permit one live adapter for the private pilot; add a second adapter and run same-context comparison before Phase 7 production rollout or general availability |
| Workflow engines | Keep workers pure `(input) → Event[]`; the engine owns trigger, retry, and scheduling only |
| High-volume signals | Use a lightweight append path and consume aggregates rather than routing raw signal volume through workflow orchestration |

### 3.3 Privacy, spending, and sharing decisions

| Decision | Adopted position |
| --- | --- |
| Upload rights | Require explicit ownership or license assertion before external assets participate in generation |
| Private-content retention | Redact prompt/provider content after 30 days while retaining non-sensitive receipts |
| Attention | Off by default; explicit opt-in for coarse visible-page episodes only; no raw pointer, coordinate, key, typed-text, microphone, or ambient-device capture |
| Attention authority | Cap downstream weight at 0.25 of a direct action; attention alone cannot author taste or document state |
| Attention retention | Expire device-level detail after 14 days; provide pause, review, and forget controls |
| Pilot budgets | Hard caps of 250,000 tokens per user and 2,500,000 per workspace; reserve before paid work and fail closed at exhaustion |
| Sharing | Private by default, read-only, revocable immediately, and expiring within seven days |
| Publication | Treat broader team/community publication as a later human-owned product and moderation decision |

### 3.4 Evaluation decisions

| Decision | Adopted position |
| --- | --- |
| Extractor bar | Fixed v1 corpus; correction rate at or below 10% globally and for each extractor; one incorrect result may block a small per-extractor sample |
| Re-entry evidence floor | At least ten witnessed brief-item impressions before the first human advance review; the floor is not an automatic success threshold |
| Phase 6 advance | Permit Phases 8 and 9 to begin with continued Phase 6 monitoring once the evidence floor and required views exist |
| Pilot vectors | Use deterministic, versioned local embeddings to validate semantics; migrate by full projection rebuild for production |
| Taste decay | Begin with a visible, versioned 60-day exponential half-life and tune only from witnessed evidence |
| Replay fixtures | Build long theoretical streams in memory; never append them to the user’s durable stream unless explicitly exported for testing |

---

## 4. Target architecture

### 4.1 System shape

```text
Canvas · Chat · Upload · Library · Re-entry · Admin actions
                         │
                         ▼
               Append-only event log
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
 Product projections  Trust views   Operational gauges
        │                │                │
        └────────────────┼────────────────┘
                         ▼
      Compiler · Extractor · Brief · Scout · Taste · Scheduler
                         │
                         └──── append events only
```

### 4.2 Append behavior

Classify each event type:

- **Commutative:** always append, such as views, annotations, Scout observations, and independent edge assertions.
- **Authored wins:** late inference still appends as history but folds as superseded when an authored correction already exists.
- **Version checked:** generation and proposal work carries the document sequence against which it was prepared.
- **Partial batch:** independent valid events append; rejected members return structured reasons for one retry and produce `ValidationFailed`.

Preserve CRDT readiness with `client_id`, fractional ordering, append-overwrite semantics, and separate position/content folds. Do not build collaborative merge events until actual multi-user requirements exist.

### 4.3 Prompt-plane contract

Every LLM-facing projection must provide:

1. Selection under an explicit token sub-budget.
2. Deterministic serialization for the same as-of point.
3. Event citations on every included fact or claim.
4. `authored`, `inferred`, or `constraint` authority on every value.
5. Log-head and projection-lag stamps plus expected sequence for proposed mutations.
6. Model-versioned, rebuildable natural-language renders.

Assemble context facts first, pins and other non-droppable salience second, recent tail last. Drop the oldest tail first when a budget is exceeded. Exclude `AssistantReasoned` by default.

### 4.4 Projection catalog

Build and register these projections under rebuild-equivalence and Projection Health:

**Canonical projections**

- Context document.
- Provenance graph.
- Vector index.
- Taste model.

**Product and interaction projections**

- Handle Resolution Index.
- Undo/Compensation Stack.
- Collection Tree.
- Session Continuity Delta.
- Warm-thread ranking.
- Brief Dosage Curve.
- Decision Frontier.
- Clearance view.
- Scout Trajectory Substrate.
- Aesthetic Family Clustering.
- Standing Constraints.
- Axis-resolved preference ledger.
- Intent-to-outcome ledger.
- Terminal-outcome funnel.

**Trust projections**

- Provenance Explanation.
- Context Diff.
- Scout Evidence Ledger.
- Belief History Viewer.

**LLM context projections**

- Addressable State Manifest.
- Session Working Set.
- Preference Capsule.
- Rejected-Path Memory.
- Clarification Queue.
- Few-Shot Corpus.
- Budget/Capability Envelope.

**Operational gauges**

- Projection Health.
- Compute Ledger.
- Parity Ledger.
- Extractor Scorecard.
- Authorship Ratio.
- Scout Precision Ledger.
- Compiler Blame.
- Model/Adapter Reliability.
- Schema Strain for JSON properties and `AssistantReasoned`.
- Embedding Freshness.
- Prefix Stability.
- Concurrent-append pressure.

Do not build a universal model summary, a raw-event-tail prompt, or a context feed made from replayed model reasoning.

---

## 5. Application information architecture

### 5.1 Primary destinations

1. **Projects** — list, select, create, and understand durable workspaces. The application mark returns here.
2. **Studio** — create and manage the open document.
3. **Project library** — reuse blocks, inspect outputs, and browse inferred families in the current project.
4. **Re-entry** — review sessions and resume exact blocks, comparisons, or collections.
5. **Scout** — inspect bounded trajectory observations and candidate artifacts.
6. **Taste & time** — inspect, promote, revoke, forget, defer, and resurface preferences.

Keep administration distinct:

- **System & governance** — product coverage, budgets, rights, retention, consent, attention controls, and evaluation gates.
- **Event operations** — stream inspection, replay, projection analysis, permissions, and concurrency.

### 5.2 Scope rules

- Project overview is a project-level Studio destination, not a document view.
- The project rail owns project identity, project overview, collections, library destinations, and creative-history health.
- The document navigation owns only representations of the open document.
- The project rail collapses into a functional dock; it does not erase all wayfinding.
- Every document view offers a device-local focus mode that hides the global header, project rail, page introduction, and summary chrome while keeping the document-view switcher and an obvious exit control available.
- Its disclosure control is integrated, labeled, exposes expanded state, and works on touch and keyboard.
- Library and Studio use the same rail component language, header hierarchy, spacing, scope cues, and responsive rules.
- Library collection filtering changes the Library projection only; it never silently opens a document.
- Mobile navigation preserves every primary destination in a horizontally accessible workspace navigation.
- Eyebrows communicate workspace, project/document scope, Creative intelligence, or Administration—not implementation phases.
- Project state is displayed as status and edited through a real form.
- Navigation actions are links with real URLs; mutations are buttons.

### 5.3 The six views of one document

All document views fold the same durable event stream. Switching views changes the interaction model, not the document.

| View | User experience | Required “a-ha” moment |
| --- | --- | --- |
| **Document** | Baseline block authoring and generation | The durable context is directly inspectable and editable |
| **Context board** | Spatially relate outcomes, evidence, constraints, and results | Relationships become visible before the user must formalize them |
| **Guided brief** | Turn the document into a sequenced decision conversation | The next useful decision becomes clearer than the machinery underneath it |
| **Reality layers** | Image-editor-style list of creative realities | A complex brief becomes controllable through add, edit, order, weight, lock, and visibility operations |
| **Adaptive path** | Restructure guidance from the user’s open intent and adopted choices | The interface exposes the next related decision without hiding durable context |
| **Creative editor** | A familiar tool palette, one-page artboard, contextual inspector, and preview | The person can shape the whole document without learning block, event, provenance, authority, handle, or sequence concepts |

Requirements for every alternate view:

- Represent every current block, output, saved decision, and relevant durable state.
- Let the user navigate among project, collections, documents, and all document views.
- Use outcome-oriented language instead of exposing event-sourcing machinery as the primary experience.
- Make all mutations through the shared event vocabulary.
- Preserve Undo, Redo, provenance, generation, Library reuse, and document lifecycle capabilities.
- Adapt to its own available width; do not require a parent to scroll sideways to reach essential controls.
- In focus mode, use the full working viewport and keep dense editor overflow inside the relevant tool, canvas, or inspector region; preserve a natural stacked page on narrow screens.

Reality Layers additionally supports creating customized layers, all 20 block types, suggested subtypes, edit, reorder, remove/restore, duplicate, weight, lock/unlock, and active/inactive state.

Adaptive Path additionally begins with open user input to an LLM, returns a proposed structure with interpretation and rationale, and changes the UI only after explicit adoption.

---

## 6. Durable routing and delivery contract

### 6.1 Canonical routes

| Destination | Route |
| --- | --- |
| Projects | `/projects` |
| Project overview | `/studio/project` |
| Baseline document | `/document/{document-id}/{optional-readable-name}` |
| Alternate document lens | `/document/{document-id}/{optional-readable-name}/view/{board|guided|layers|adaptive|editor}` |
| Project library | `/library` |
| Focused Library block | `/library/block/{block-id}/{optional-readable-name}` |
| Focused output | `/library/output/{output-id}` |
| Focused aesthetic family | `/library/family/{family-id}/{optional-readable-name}` |
| Re-entry | `/sessions` |
| Scout | `/scout` |
| Taste & time | `/memory` |
| System & governance | `/system` plus durable section anchors |
| Event stream | `/admin/events/stream` |
| Replay laboratory | `/admin/events/replay` |
| Permissions & concurrency | `/admin/events/permissions` |
| Read-only share | `/share/{share-id}` |

The ID is authoritative; the readable slug is cosmetic. Rename may update the slug without changing identity. Root and legacy URLs canonicalize to the event-projected open document.

### 6.2 Routing acceptance criteria

- Refresh, cold entry, copy/paste, browser back/forward, and alternate lens changes retain the selected document.
- Closing a Library focus dialog returns to `/library`.
- Cross-dialog links between block, output, and family previews update browser history.
- Unknown or removed focused items return to Library with a clear explanation.
- Archive import remains session-only because a browser cannot restore a local file selection.
- Non-root deployed requests receive a page-specific HTML entry point.
- Page implementations compile into separately cacheable lazy chunks.
- Direct routes do not depend on one monolithic root bundle or server-side query parameters for document identity.

---

## 7. Creative-context vocabulary

### 7.1 Block taxonomy

Use a closed v1 taxonomy of 20 types in five user-facing categories:

| Category | Types |
| --- | --- |
| Purpose & audience | Direction, Audience, Message, Emotion |
| Scene & reality | Subject, Environment, Motion, Scale |
| Visual craft | Composition, Camera, Lighting, Style, Material, Palette, Typography |
| Requirements & limits | Format, Brand, Exclusion, Accessibility |
| Grounding evidence | Reference |

Every type includes a description, creation prompt, and suggested subtypes. Suggestions accelerate authoring but never prevent editing.

Suggested subtype families include:

- Direction: campaign goal, emotional outcome, behavioral objective, exploration question.
- Audience: primary audience, use context, cultural lens, accessibility need.
- Message: proposition, narrative beat, call to action, subtext.
- Emotion: primary affect, contrast, energy, temporal mood.
- Subject: hero, supporting subject, human presence, object study.
- Environment: interior, exterior, abstract space, social setting.
- Motion: subject motion, camera motion, implied motion, stillness.
- Scale: intimate, human, monumental, relative contrast.
- Composition: focal hierarchy, grid, negative space, crop.
- Camera: viewpoint, lens character, depth of field, perspective.
- Lighting: direction, quality, color temperature, time of day.
- Style: art direction, era, medium, finish.
- Material: surface, fabrication, texture, wear.
- Palette: extracted, brand, emotional, tonal.
- Typography: role, voice, layout, letterform constraint.
- Format: aspect ratio, channel, resolution, safe area.
- Brand: identity cue, mandatory asset, tone rule, forbidden treatment.
- Exclusion: visual, semantic, safety boundary, failure mode.
- Accessibility: contrast, legibility, motion sensitivity, cultural clarity.
- Reference: mood, composition, material, color.

### 7.2 Block operations

Across all document experiences, provide event-backed ways to:

- add a typed block;
- create a customized block from the categorized Authored Block dialog;
- edit instructions, subtype, values, and weight;
- reorder through drag-and-drop and keyboard-equivalent controls;
- lock, unlock, activate, deactivate, duplicate, remove, and restore;
- inspect provenance and source events;
- copy a Library block into the open document with its citation;
- ask the assistant to propose any legal block type, preview the diff, and accept or reject it.

Do not make “Add context block” default every intention to Direction.

### 7.3 Blank document contract

- Ask for an initial document name before creation.
- Create an empty document.
- Do not add `direction/untitled`, “Describe a direction…”, or any other placeholder block.
- Add a Direction only after the user authors and submits one.
- Support rename after creation.
- Support reversible remove and restore.

---

## 8. Phase 0 — Foundation decisions and operating boundaries

### Tasks

1. Create an append-only decision ledger. Each record carries ID, time, decision, rationale, reversal cost, status, optional supersedes link, and optional revisit trigger.
2. Record every decision in Section 3 and the production/pilot distinction.
3. Create the event-payload classification ledger before the first event.
4. Classify natural language, identifiers, rights data, model receipts, provider content, embeddings, attention data, and public-share data.
5. Define authenticated identities and admin, creator, agent, and viewer roles.
6. Define the actor × event-type permission matrix.
7. Define token ceilings, per-run Scout envelopes, and reservation behavior.
8. Define upload rights assertion and read-only share policy.
9. Pin Postgres 17 as the production target and record a dependency re-verification date.
10. Establish the collection tree, handle, stream, envelope, erasure, and provider-adapter decisions before schema implementation.

### Human-owned approvals before production exposure

- Intended audience: personal, team, or community.
- Formal retention and erasure posture.
- Rights propagation and the legal meaning of `influenced-by`.
- Production spending authority and cost ceilings.
- Public or organization-scoped publication and moderation.

### Done when

- Every adopted position is present in the append-only decision ledger.
- Every admitted event family has a data-classification row and legal actor set.
- Pilot defaults and production approvals are visibly distinct without weakening the build path.

### Do not

- Write product events before deciding the unbackfillable envelope fields.
- Assume permission to widen capture, spending, sharing, or inferred-to-authored promotion.

---

## 9. Phase 1 — Event substrate, document baseline, observability, and shell

### 9.1 Durable event pipeline

1. Implement the append-only event store with database-level immutability.
2. Enforce schema version and actor-by-event permissions server-side.
3. Implement sequence checks, authored-wins races, commutative append, partial batch acceptance, and structured validation failures.
4. Store erasable content externally and retain only references in the log.
5. Add a lightweight high-volume signal endpoint and aggregation seam.
6. Implement correction folds in which authored values win while superseded facts remain inspectable.

### 9.2 Foundational event vocabulary

Admit specific events rather than a generic “changed” event. Include families for:

- projects, documents, blocks, references, extraction, generations, objects, comparisons, annotations;
- sessions, briefs, optional intent, blank canvas, proposals, validation, export, retention, budgets;
- collections, families, claims, preferences, conditions, resurfacing, Scout, attention, and gates.

Include the escape hatches only with strain gauges. `AssistantReasoned` is an auditable receipt, not replayable model context. JSON properties preserve additive types but do not replace specific events when a fact must be witnessed.

### 9.3 Baseline projections

1. Context Document with separate position and content folds.
2. Handle Resolution Index with historical aliases.
3. Undo/Compensation Stack with semantic authority restoration.
4. Project and document listings.
5. Projection Health for lag, rebuild duration, and throughput.
6. Classification and content-reference resolution.

### 9.4 Baseline application shell

1. Build the UI entirely as Lit custom elements.
2. Isolate Signals proposal packages behind `ApplicationStore`.
3. Create Projects as the root destination and make the application mark return there.
4. Create the Studio shell with project rail, project overview, document navigation, sticky document bar, and baseline Document view.
5. Create real durable routes and page-specific HTML entries from Section 6.
6. Make the rail responsive, collapsible into a useful dock, keyboard operable, and structurally shared by Studio and Library.
7. Implement a semantic list representation alongside any spatial canvas.
8. Implement roving focus, arrow-key movement, modifier movement, focus-visible treatment, reduced motion, labeled locks, and keyboard-equivalent commands for drag operations.

### 9.5 Administrative observability

Build Event operations outside the main app interface:

- stream viewer with actor, type, correlation, and sequence filters;
- projection inspector that reveals source events;
- replay CLI for any projection and as-of sequence;
- permissions and concurrency explanation surface;
- keyboard-operable semantic HTML.

### Done when

- Create and name a project and a truly blank document.
- Add, edit, reorder, lock, remove, restore, undo, and redo baseline blocks.
- Reload and reproduce the same document.
- Wipe every Phase 1 projection and rebuild byte-equivalent state from the log.
- Complete the flow by keyboard.
- Open a document through its canonical URL on a cold request.
- Inspect every resulting event and replay the document to an earlier sequence.

### Do not

- Build extraction, generation, chat, Scout, taste, or automatic filing.
- Reuse the prior document when the user explicitly creates a blank one.

---

## 10. Phase 2 — Compiler, provider contract, budgets, and generation

### Tasks

1. Compile the Context Document deterministically into provider inputs.
2. Define the compiler signature as `(document, standing_constraints)` even while constraints are initially empty.
3. Implement the prompt-plane contract and stable serialization order.
4. Add `ModelRegistered`, `AdapterVersioned`, and `CapabilityDeclared` receipts.
5. Confine every provider-specific prompt and cache marker to adapter modules.
6. Make `ContextCompiled` carry the immutable snapshot, source block versions, as-of point, adapter version, and citations.
7. Highlight any compiled fragment back to its source block.
8. Reserve user/workspace budget before provider work, settle against reported usage, release unused budget, and fail closed after exhaustion.
9. Record request, completion, failure, usage, latency, provider, model, and adapter change-points.
10. Implement download-class export with an event receipt.
11. Drive the first private pilot through the OpenAI Responses adapter.
12. Keep the second adapter as a release gate: add it and run same-context comparison before production Phase 7 or general availability.

### Done when

- The same as-of document serializes byte-identically twice.
- Every compiled fragment opens its source block.
- An adapter version change appears as a queryable generation-metric change-point.
- Budget exhaustion prevents paid work without losing the user’s request history.
- A generated object can be downloaded and the export appears in the stream.
- The compiler contract can drive a second adapter without changing document or event semantics.

### Do not

- Put a model-specific string outside an adapter.
- Treat the single-provider pilot exception as provider-diversity completion.

---

## 11. Phase 3 — Reference extraction, reflection, and quality gate

### 11.1 Reference workflow

1. Confirm ownership or license in a contextual native dialog rather than `alert()`.
2. Open the original reference in a top-layer modal rather than a new tab.
3. Use `closedby="any"` where supported and a backdrop target-equality fallback.
4. Run deterministic extraction eagerly where appropriate.
5. Show interpretive findings as confidence-bearing evidence.
6. Let the user opt into individual findings and adopt each separately as editable document state.

### 11.2 Extractable realities

Support:

- dimensions and aspect behavior;
- k-means palette;
- dominant edge direction;
- mood and emotional energy;
- composition and focal hierarchy;
- material and surface character;
- lighting direction, quality, and temperature;
- spatial character, depth, and scale cues.

Keep the source palette read-only. Sampling can select pixels from the reference image, must state which next swatch will be set, and must not include an arbitrary `input type="color"` disguised as image evidence.

### 11.3 Reflection

1. Render editable chips with accessible confidence text and provenance.
2. Mark an adopted or edited chip as authored and suppress silent re-extraction.
3. Make compensation restore inferred authority.
4. Add optional axis-based `ObjectCritiqued` interactions for save and discard.
5. Build the Extractor Scorecard: correction rate, correction direction, churn, and confidence calibration.
6. Build Authorship Ratio and JSON-property strain gauges.
7. Build the fixed v1 evaluation corpus before accepting extractor quality.
8. Require correction rate at or below 10% globally and for each extractor.
9. Add representative licensed pilot references later without rewriting the frozen baseline.

### Done when

- Editing or adopting an extracted value measurably changes the next compile.
- No extractor silently overwrites authored state.
- The scorecard excludes compensated edits and distinguishes directional bias from noise.
- The frozen corpus passes the global and per-extractor gate.
- A critique is queryable by axis, block, model, and adapter without being required to discard.

### Do not

- Ship model-based interpretation before deterministic extraction proves the interaction.
- Present low-confidence inference as authored fact.

---

## 12. Phase 4 — Provenance, comparison, and bidirectional creation

### Tasks

1. Build typed edges for `variant-of`, `derived-from`, `influenced-by`, `supersedes`, `contradicts`, `belongs-to-family`, and `responds-to`.
2. Provide recursive traversal in both directions.
3. Promote a selected output region into a named reusable block.
4. Build side-by-side comparison with a shared Context Diff engine.
5. Witness `ComparisonOpened` in the same change as the comparison surface.
6. Build the Decision Frontier from comparison recurrence and recency.
7. Build plain-language Provenance Explanation records for UI and assistive technology.
8. Build Clearance from ancestry and capture-time rights.
9. Surface the worst effective rights class at export.
10. Preserve keyboard parity across graph navigation, comparison, and region promotion.

### Done when

- A region of an output becomes a reusable block with queryable lineage.
- The same Context Diff drives comparison and later chat proposal previews.
- A user can answer “why am I seeing this?” without reading event or edge machinery.
- Export exposes the effective rights result and its evidence.

### Do not

- Settle `influenced-by` legal taint in schema; expose it as a policy input pending accountable review.

---

## 13. Phase 5 — Conversation, progressive disclosure, and alternate document views

### 13.1 Conversation

1. Resolve chat into a proposed event batch.
2. Preview the batch through Context Diff.
3. Require explicit accept or reject.
4. Record proposal, acceptance/rejection, expected sequence, correlation, and causation.
5. Build the Addressable State Manifest, Session Working Set, and Clarification Queue before the first live proposal.
6. Store user natural language outside the immutable log.
7. Record accepted command-to-batch pairs and rejected proposals for the later Few-Shot Corpus.
8. Add a Parity Ledger that compares committed event sequences for equivalent visual and conversational actions.
9. Permit the conversational assistant to propose across all legal block types rather than defaulting to Direction.

### 13.2 Progressive disclosure

- A new document may begin as one named blank surface or one open text field.
- Structure accretes through the same events the full canvas uses.
- The system may suggest block type and subtype, but the user decides what is adopted.
- The expanded New Authored Block experience is a categorized dialog, not an inline form that displaces the document.

### 13.3 Alternate document views

Build Context Board, Guided Brief, Reality Layers, Adaptive Path, and Creative Editor against the same durable document projection.

- Give each view the full breadth of block and document lifecycle capabilities.
- Keep Project overview separate from document-view navigation.
- Make cross-view links use canonical document URLs.
- Let each view adapt to its delivery width.
- Make the experience outcome-led rather than event-machinery-led.
- Ensure every alternate representation includes all durable decisions and results.
- Build Creative Editor as the machinery-free lens: translate the complete projection into a tool palette, one-page plan, visual preview, and contextual inspector; keep stream counts, IDs, handles, authority labels, provenance controls, and event terminology outside its working surface.

### Done when

- Automated parity exercises every baseline canvas operation from chat and every chat mutation from a visual surface with equivalent committed events.
- Invalid chat references become rare because the manifest constrains them before generation.
- A deliberately stale proposal is rejected or explicitly rebased.
- A rejected proposal is witnessed.
- Every alternate view opens the same document ID and represents its complete projection.
- The Adaptive Path never mutates structure until the user adopts the proposed interpretation.

### Do not

- Let model phrasing launder inferred values into authored-sounding facts.
- Create a separate data model for any alternate document experience.

---

## 14. Phase 5.5 — Authored collections and project overview

### Tasks

1. Implement `CollectionCreated`, `CollectionRenamed`, `CollectionRemoved`, `CollectionRestored`, `CollectionItemAdded`, `CollectionItemRemoved`, and `CollectionItemMoved`.
2. Use fractional sibling positions.
3. Reject duplicate filing and ancestor cycles with `ValidationFailed`.
4. Support lift-or-tombstone orphan policy per removal event.
5. Build the Collection Tree projection and register it under Projection Health.
6. Add collection handles and aliases to the Handle Resolution Index.
7. Add the WAI-ARIA tree pattern, roving focus, keyboard create/rename/move/reorder, and drag equivalents.
8. Extend chat parity and the Manifest for collections.
9. Roll warm-thread and dormancy summaries up to collections.
10. Promote a family into a collection only through `CollectionCreated` with `source_claim_ref`.
11. Build Project overview inside Studio with all project documents, collections, state, and open/remove actions.

### Done when

- Nested collections can be created, renamed, reordered, and populated by keyboard and chat with equivalent committed events.
- Duplicate and cycle attempts append structured validation receipts.
- Removal honors the selected orphan policy.
- A full replay reproduces the tree exactly.
- “Put X in Y” resolves through the handle index.
- A user can see and open all documents in the project from one project-scoped destination.

### Do not

- Build multi-membership until usage proves it is needed.
- Build smart or rule-based collections; inferred grouping belongs to families.
- Let a model, Scout, extractor, or composer file an item.

---

## 15. Phase 6 — Sessions and re-entry

### Tasks

1. Record session open/close and state at close.
2. Build Session Continuity Delta and warm-thread ranking.
3. Compose briefs from continuity, warm threads, rejected paths, optional intent, and later preferences—without inventing a universal summary.
4. Compose no brief before three closed sessions and one dormant or unresolved thread.
5. Render the brief as a small context document using the same block language as the work.
6. Witness `BriefItemPresented` when an item is rendered in the viewport or reached in reading order.
7. Give every brief item an exact destination to a comparison, block, collection, or document.
8. Record accept, ignore, dismiss, and equal-prominence blank-canvas choice separately.
9. Ensure blank canvas creates a newly named empty document.
10. Build Rejected-Path Memory before ranking repeated suggestions.
11. Build the Brief Dosage Curve and join it with Compute Ledger cost.
12. Permit optional `IntentDeclared` content; never require it.
13. Require at least ten witnessed item impressions before the first human advance review.

### Gate

Read together:

1. Acceptance denominated by actual presentation.
2. Acceptance adjusted by composition cost.
3. Dosage shape, dismissal, time to first accept, and blank-canvas selection.

The ten-impression floor permits review; it is not automatic proof. Phases 8 and 9 may begin after an accountable advance-with-monitoring decision, while Phase 6 evidence continues to accrue.

### Done when

- A returning user can open every cited destination exactly.
- The app never confuses a click with a meaningful destination change.
- Acceptance, cost-adjusted acceptance, dosage, and blank-canvas choice can be computed from durable facts.
- Rejected paths are not immediately re-proposed.

### Do not

- Build Scout solely to make a weak re-entry hypothesis look successful.
- Compose a brief from cold-start absence.
- Gate creation on a declared goal.

---

## 16. Phase 7 — Vector index, aesthetic families, and private corpus

### Tasks

1. Build a versioned embedding projection; record model ID and version on every vector.
2. Make a full re-embedding an ordinary unattended rebuild.
3. Support hybrid filtered search with collection membership as a user-facing facet.
4. For the private semantic pilot, permit deterministic local embeddings while preserving the production pgvector/HNSW contract.
5. Cluster neighbor structure and engagement co-occurrence into inferred aesthetic families.
6. Store family declarations, anchors, and membership as confidence-bearing claims.
7. Correct one family edge through `ClaimSuperseded` without destroying the family.
8. Keep a family only through explicit promotion to an authored collection.
9. Activate cited Few-Shot Corpus retrieval from accepted command-to-batch exemplars.
10. Use rejected proposals as hard negatives and extractor corrections as cited examples.
11. Add Embedding Freshness and the second Schema Strain gauge.
12. Prepare the production move to pgvector/HNSW as a projection rebuild, not an event migration.
13. Add a second provider adapter and same-context comparison before production rollout of this phase.

### Done when

- Full-corpus re-embedding runs unattended within the agreed projection-health SLO.
- A family has inspectable evidence and survives an individual membership correction.
- A chat request demonstrably includes retrieved, cited exemplars.
- Collection filters affect retrieval without mutating authored organization.
- Replacing the embedding model requires no rewrite of durable events.

### Do not

- Treat similarity as taste.
- Present deterministic pilot vectors as production retrieval quality.

---

## 17. Phase 8 — Bounded Scout

### Pre-phase artifact

Define the Scout Trajectory Substrate and stable evidence-reference shape before the first `ScoutObserved` event. Evidence identifiers become permanent as soon as observations cite them.

### Tasks

1. Fold generation embeddings over time with engagement outcomes, comparison activity, branch density, rejected paths, and family adjacency.
2. Derive evidence for convergence, divergence, stall, adjacency, and oscillation.
3. Start each run with a hard Budget/Capability Envelope.
4. Plan directions and variants within the envelope so budget exhaustion is an expected terminal state.
5. Record typed observations with confidence and stable evidence references.
6. Render the Scout Evidence Ledger grouped by run.
7. Make every observation falsifiable in the UI.
8. Witness `ObservationJudged` with the observation surface.
9. Keep Scout generations in report space.
10. Promote a candidate into a document only after an explicit user act.
11. Build the Scout Precision Ledger and confirmed-observations-per-dollar view.
12. Prevent adjacency suggestions from rediscovering recently rejected paths without an explicit staleness reason.

### Done when

- Every observation exposes enough evidence to confirm or reject it.
- Confidence calibration is measurable by observation type.
- Budget exhaustion is planned rather than surprising.
- Candidate artifacts remain outside authored documents until promoted.
- Confirmed observations per dollar can be computed.

### Do not

- Admit an event that lets Scout choose the user’s direction.
- Claim production image quality from deterministic candidate fixtures.

---

## 18. Phase 9 — Taste, time, and bounded attention

### 18.1 Taste and time

1. Build a versioned, bi-temporal taste projection.
2. Begin with a visible 60-day exponential half-life.
3. Use inferred beliefs only to rank, never to filter.
4. Implement `PreferenceAuthored` and `PreferenceRevoked`.
5. Build authored Standing Constraints and compile them into every generation through the Phase 2 seam.
6. Build the Preference Capsule with value, authority, confidence, evidence count, freshness, and claim ID.
7. Build the axis-resolved preference ledger from critiques.
8. Join critique through generated object, generation, compile snapshot, adapter, and source block versions for Compiler Blame.
9. Build the Belief History Viewer with as-of queries.
10. Implement affirm, revoke, retract, forget, defer, condition, fire, and resurface paths.
11. Measure promotion and revocation rather than treating suggestion acceptance as taste truth.

### 18.2 Opt-in attention pilot

1. Keep ordinary explicit-click instrumentation separately controllable.
2. Make attention capture off by default and require explicit opt-in.
3. Capture only while `document.visibilityState === "visible"`.
4. Record coarse semantic surface, action context, visible object IDs, active time, idle time, and terminal action.
5. Exclude raw pointer movement, coordinates, keystrokes, typed text, microphone, camera, and ambient device signals.
6. Discount page exits, hidden pages, idle timeouts, and long machine-away periods.
7. Give greater—but still weak—weight when an episode ends in comparison selection, pin, generation choice, document creation, or another explicit act.
8. Cap downstream authority at 0.25 of a direct action.
9. Prevent attention alone from creating taste or authored state.
10. Permit Scout to use repeated friction episodes only as low-confidence supporting evidence.
11. Expire device-level detail after 14 days.
12. Provide pause, review, and forget controls.
13. Measure opt-in, false-positive friction flags, confirmed judgments, and erase behavior before widening scope or retention.

### Done when

- A user can see what the system believes, when, why, and from which evidence.
- The user can affirm, revoke, retract, and forget.
- Model phrasing remains tentative for inferred beliefs and assertive only for authored constraints.
- Attention data is understandable, erasable, visibly weaker than direct action, and incapable of silently changing creative truth.
- Decay, ranking, resurfacing, and attention weights can be tuned from witnessed evidence.

### Do not

- Use inferred taste as an option filter.
- Convert presence, dwell, or visible content into authorship.
- Widen capture scope because the data is convenient.

---

## 19. Phase 10 — Library, sharing, export, and portability

### 19.1 Project Library

1. Build project-scoped Documents, Blocks, Outputs, and Families views.
2. Make “Use a copy” create a cited authored block in the open document and navigate visibly back to Studio.
3. Give non-image blocks focused previews with linked generations that cited them.
4. Give recent outputs focused dialogs with full context receipts.
5. Distinguish the complete recent trail from the explicitly kept set.
6. Make “Keep for reuse” and removal from kept state event-backed.
7. Give aesthetic families a lightbox of every cited member.
8. Align Taste Evidence forms with the site’s form, spacing, and typographic system.
9. Let focused dialogs link among blocks, outputs, and families through durable URLs.

### 19.2 Sharing and portability

1. Treat documents and provenance graphs as first-class portable file types.
2. Implement lossless archive export/import and CI round-trip tests.
3. Support output-only, output-with-context-receipt, and full-graph export shapes.
4. Implement private, read-only, revocable shares that expire within seven days.
5. Keep append authority out of shares.
6. Keep archive file selection session-only while preserving every imported durable identity after import.

### Done when

- Every Library affordance produces a visible event-backed result or explains why it is unavailable.
- A copied block retains provenance to its source.
- Every focused preview survives refresh and browser navigation.
- Export followed by import reproduces the complete document and graph losslessly.
- Revocation immediately invalidates a share without deleting its audit receipt.

### Do not

- Imply account-wide search without an explicit cross-project projection.
- Launch team or community publication without resolving identity, moderation, rights, and collaboration policy.

---

## 20. Event operations and Replay laboratory

Build this as an administrative application surface independent of the creative workspace.

### 20.1 Durable stream

- Filter by actor, event type, category, correlation ID, and sequence.
- Inspect every envelope and payload.
- Open projection rows and the events folded into them.
- Replay any projection to any as-of sequence.
- Explain actor permissions, concurrency classes, stale proposals, partial batches, compensation, and rejection.
- Preserve the selected section at `/admin/events/stream`, `/admin/events/replay`, or `/admin/events/permissions`.

### 20.2 Theoretical long-stream laboratory

Build deterministic 1,000, 10,000, and 50,000-event streams in memory. Provide eight narratives:

1. **Creative loop** — extraction, authored correction, compile, generate, compare, keep, and export.
2. **Document evolution** — project/document lifecycle, all 20 block types, reversible context, objects, annotations, Library, and collections.
3. **Asynchronous return** — session close, brief, Scout report space, judgment, acceptance, and document promotion.
4. **Concurrent pressure** — inert model proposal, commutative actions, stale validation, partial progress, and explicit rejection.
5. **Family promotion** — inferred grouping kept separate from authored collection promotion.
6. **Taste & time** — critique, versioned belief, authored preference, delayed resurfacing, revocation, and forgetting.
7. **Attention & friction** — visible-only dwell, weak weighting, useful and weak terminal actions, review, and deletion.
8. **Operational safeguards** — registry, reservations, settlement, failures, retention, attribution, abandonment, and phase-gate receipts.

Keep the fixtures synchronized with every admitted server-produced or authorized event and every block type.

### 20.3 Event exposition

For every selected event, show:

- **What happened** — the concrete action or fact.
- **Why this happens** — the actual trigger or preceding condition.
- **How this helps** — the user, trust, creative, operational, or evaluation benefit.

Also show meaningful elapsed time, wall-clock position, actor handoff, and session boundary. Time is supporting context, not a generic claim about causation. Do not repeat nearly identical benefits for unrelated events.

### Done when

- The scenario coverage audit exercises the complete event and block capability set.
- Every event has a specific trigger and benefit explanation.
- Replay to any sequence rebuilds the selected projection without writing the fixture to the user stream.
- Refreshing any Event operations tab preserves the tab.

---

## 21. Cross-cutting interface and visual-system requirements

### 21.1 Typography

- Preserve the browser’s default 16px root size; do not reduce `html` or `body` font size.
- Use `rem`-based typography.
- Render no visible text below 10px.
- Repeat one clear page hierarchy: scope eyebrow, page title, supporting copy, local navigation, section title, body, metadata.
- Use whitespace to group meaning rather than shrinking text or adding arbitrary separators.
- Style Library and Document headers as the same structural family.
- Avoid flex rules that reserve empty white space without helping action layout.
- Wrap, scroll, or collapse metadata labels—such as “Authored” to “A” and “Why?” to “?”—before `.block-meta` overflows.

### 21.2 Responsive layout

- Keep Library content within the viewport at every supported width.
- Make the project rail a stable edge-pinned layout region on wide screens and a complete disclosure/dock on constrained screens.
- Make Reality Layers and other dense editors container-adaptive.
- Keep document actions visible through a sticky document bar.
- Preserve every navigation destination on touch and keyboard.

### 21.3 Rounded-edge invariant

- Never put an imbalanced CSS border on an element with `border-radius`.
- Never simulate an imbalanced border with an offset inset box-shadow or another paint workaround.
- Inset emphasis on rounded elements must be concentric: zero horizontal and vertical offset with balanced spread.
- Enforce the rule through automated CSS source checks.

### 21.4 Dialogs

- Use native `dialog` for focused previews, block creation, project/collection editing, rights confirmation, original images, and palette selection.
- Prefer `closedby="any"` where available.
- Add a target-equality fallback so clicking the backdrop dismisses the dialog.
- Render dialogs in the top layer so their positioning never alternates between window and block containment.
- Preserve Escape, explicit close control, focus return, label association, and keyboard operation.

### 21.5 Affordance audit

Before every phase gate, enumerate every button, link, drag target, tab, menu item, and dialog action. Verify that it:

1. appends or derives a visible event-backed outcome;
2. navigates to a durable URL; or
3. is disabled and names the prerequisite.

A successful append that leaves the user believing nothing happened is a usability failure.

---

## 22. Evaluation program

### 22.1 Structural evaluation

- Full projection rebuild equivalence.
- Chat/canvas/alternate-view event parity.
- Actor permission and schema enforcement.
- Optimistic concurrency, authored-wins race, and partial-batch behavior.
- Stable prompt serialization.
- Lossless archive round-trip.
- Route refresh, cold entry, deep-link, and browser-history tests.
- Projection lag, rebuild duration, and throughput.
- Budget reservation, settlement, cap, failure, and recovery behavior.
- Automated rounded-edge invariant checks.
- Keyboard, focus, dialog, and reduced-motion checks.

### 22.2 Product evaluation

| Area | Evidence | Decision supported |
| --- | --- | --- |
| Extractors | Correction rate, direction, churn, confidence calibration | Whether a finding is reliable enough to show or automate |
| Re-entry | Impressions, acceptance, blank canvas, composition cost, dosage | Whether pre-paid re-entry helps without creating dependence |
| Retrieval | Cited-example relevance, family correction, collection filtering | Whether the private corpus improves translation and recall |
| Scout | Judgment by type/confidence, confirmed observations per dollar | Whether bounded exploration is honest and useful |
| Taste | Promotion, revocation, critiques, freshness, ranking usefulness | Whether memory should rank without narrowing possibility |
| Attention | Opt-in, false-positive friction, later explicit confirmation, forgetting | Whether weak signals improve UX insight without surveillance |
| Adaptive UI | Structure adoption/rejection and time to next meaningful decision | Whether mutation clarifies rather than destabilizes |
| IA | Rail collapse, direct-entry comprehension, project/Library scope | Whether hierarchy remains legible without prior context |

### 22.3 Model-output regression

Bootstrap with deterministic synthetic streams for volume and handwritten scenarios for judgment. Under non-determinism, treat any of these as regressions:

- structural mismatch in emitted events;
- semantic loss in user-facing prose;
- missing or invalid citations;
- lost authority markings;
- observation, brief, extraction, or proposal claims that overstate their evidence in sampled human review.

---

## 23. Production readiness and release gates

### 23.1 Infrastructure gate

- Migrate durable storage to the approved Postgres 17/Timescale topology.
- Migrate vector projections to pgvector/HNSW through a full rebuild.
- Demonstrate backup, restore, replay, re-embedding, retention, and projection rebuild within agreed SLOs.
- Establish operational alerting and incident/rollback procedures.

### 23.2 Provider and cost gate

- Add a second provider adapter.
- Run same-context comparisons through the same compiler contract.
- Confirm model/adapter reliability and prefix-stability views.
- Approve production user, workspace, and Scout spend ceilings.

### 23.3 Data and policy gate

- Complete accountable legal review for rights, clearance, retention, erasure, encryption, and derived memory.
- Use representative licensed corpora for extraction and retrieval evaluation.
- Decide personal, team, or community product scope.
- Add collaboration and moderation only after that scope is chosen.

### 23.4 Product gate

- Review continuing Phase 6 acceptance, cost, dosage, and blank-canvas evidence.
- Review Scout precision and value per dollar.
- Review taste promotion/revocation and ensure inference never filters.
- Review attention opt-in, false positives, and erase behavior.
- Verify all six views remain complete representations of one document.
- Verify every Replay laboratory scenario stays synchronized with the admitted vocabulary.

### 23.5 General-availability definition

Do not declare general availability until:

- every canonical projection rebuilds within its SLO;
- provider-diversity debt is retired;
- licensed evaluation data supports extraction and retrieval quality;
- privacy, rights, retention, budget, and audience decisions are approved;
- route-level accessibility, keyboard parity, responsive behavior, and lossless portability pass release review;
- administrative replay can explain every admitted event with its trigger and benefit;
- the application demonstrates that assistance increases creative capacity without silently accumulating authority.

---

## 24. Explicit anti-goals

Do not build:

- a mutable context document that bypasses the event log;
- workers that write projections directly;
- a universal summary prompt or raw-event-tail prompt;
- model-specific prompt strings outside adapters;
- automatic filing into authored collections;
- smart collections that duplicate inferred families;
- Scout authority to choose a direction;
- inferred taste filters that hide options;
- placeholder Direction blocks in a blank document;
- arbitrary color controls masquerading as reference sampling;
- attention capture of raw behavior or ambient device data;
- physical deletion in place of remove/restore history;
- framework-specific UI state that cannot be represented in URLs or events;
- document views that show only a convenient subset of durable context;
- non-functional UI affordances;
- imbalanced borders or simulated imbalanced edge accents on rounded elements;
- production claims based only on deterministic pilot embeddings, fixtures, or theoretical generations;
- team/community publication before identity, moderation, rights, and collaboration decisions exist.

---

## 25. Handoff checklist

An implementation team beginning at zero should receive:

- this plan;
- `docs/decisions.ndjson` as the append-only rationale ledger;
- the normative event schema and actor permission matrix;
- the payload classification ledger;
- the projection catalog and rebuild tests;
- the 20-type block taxonomy and subtype definitions;
- canonical route tests;
- the fixed extractor corpus;
- the eight Replay laboratory narratives;
- accessibility, responsive, dialog, typography, and rounded-edge invariant tests;
- provider, budget, rights, retention, and deployment configuration separated by pilot and production environment.

The agent begins with Agent Bootstrap, proceeds to Phase 0, and advances only through the gates in this document. The result must be one coherent event-sourced creative system, not a set of pages that merely share a visual theme.
