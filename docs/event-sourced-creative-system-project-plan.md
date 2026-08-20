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
4. Create `DESIGN.md` as a normative, from-scratch visual and interaction contract before building product screens. Use the gallery-first requirements in Section 21; do not derive the design contract from starter UI or framework defaults.
5. Create these initial surfaces:
   - `src/components/` for Lit custom elements;
   - `src/model/` for events, folds, projections, block taxonomy, routing, and evaluation scenarios;
   - `src/state/` for the application store and server-synchronized UI state;
   - `worker/` for append, query, upload, share, provider, and static-entry routing;
   - `drizzle/` for versioned database migrations;
   - `scripts/` for replay, migration, and operational utilities;
   - `tests/` for projection, permission, routing, accessibility, replay, and invariant tests;
   - `docs/` for the decision ledger, payload classification, event registry, and operational policy.
6. Create scripts for development, build, type checking, linting, tests, replay, and migration generation.
7. Configure logical D1 and R2 bindings for local/private deployment while keeping the production Postgres and object-storage adapters behind interfaces.
8. Add continuous checks for type safety, lint, full build, tests, projection rebuild equivalence, and CSS/design invariants.
9. Make the first repository commit contain only the bootstrap, this plan, `DESIGN.md`, and the empty append-only decision ledger.

The new agent should not begin by inventing screens. It should begin by recording the baseline decisions, defining the event envelope, and establishing the rebuild test harness.

### 0.3 Product outcome

Build an event-sourced creative studio in which:

- people construct reusable creative context from typed blocks, references, constraints, and outcomes;
- independent project blocks can be related into reusable context sets and inserted into a document as one deliberate action;
- generated work cites the exact context that produced it;
- draft ideation and full-quality generation form one quality-aware history, with promotion from draft to full quality preserved as high-confidence intent and outcome evidence;
- interruptions preserve momentum through event-derived re-entry;
- long-running and costly work continues safely on the server across refresh, navigation, and temporary disconnection;
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
    └── Project library
        ├── Independent reusable blocks
        ├── Typed block relationships and context sets
        ├── Derived discovery and deliberate keeping
        └── The same collection containers and access boundary as documents
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

### 1.4 Spatial scope for block effects

Every block defaults to the whole document but may carry a versioned `spatial_scope` property when its instruction applies locally. The property uses document-normalized coordinates so it survives viewport changes, alternate document views, output sizes, and responsive layouts:

```ts
type SpatialScope = {
  schema_version: 1;
  kind: "document" | "region" | "aabb" | "subject" | "path";
  coordinate_space: "document-normalized";
  region?: "left" | "right" | "top" | "bottom" | "center" | "foreground" | "background" | "edges" | "custom";
  instruction?: string; // fuzzy custom region, such as “quiet area behind the subject”
  aabb?: { x: number; y: number; width: number; height: number }; // each value is 0..1
  subject_block_id?: string;
  subject_relation?: "inside" | "around" | "in-front-of" | "behind";
  path?: Array<{ x: number; y: number }>; // normalized clipping polygon
  feather: number; // 0..1
  falloff: "hard" | "soft" | "contextual";
  polarity: "inside" | "outside";
};
```

Absence normalizes to a whole-document scope. Named regions cover fast and fuzzy intent; AABBs cover exact rectangular placement; subject-relative scopes follow a durable subject block; paths cover authored or subject-derived clipping shapes. Polarity supports exclusions and edge treatments, while feather and falloff state how strongly an effect transitions at its boundary. Scope edits use the ordinary versioned `BlockPropertyEdited` event, participate in Undo/Redo, and compile with the exact block version that produced an output.

The scope editor must make the preview the primary authoring surface: drag to draw or move a normalized rectangle, drag to sketch a freeform clipping shape, or describe a fuzzy area in natural language beside the preview. Numeric coordinates and point lists remain available as accessible precision fallbacks; they are not the only path to authoring a target.

### 1.5 Independent blocks, relationships, and context sets

Keep reusable creative realities as independent typed blocks. Connect them with first-class, typed relationships rather than embedding a reference image and its lifecycle into every richer block.

```ts
type BlockRelation = {
  id: string;
  project_id: string;
  document_id?: string;
  from_block_id: string;
  to_block_id: string;
  kind:
    | "visual_evidence"
    | "subject_reference"
    | "style_reference"
    | "composition_reference"
    | "material_reference"
    | "lighting_reference"
    | "palette_reference"
    | "mood_reference";
  properties: Record<string, unknown>;
};
```

The root creative block remains editable, fileable, removable, and reusable independently. A Reference block separately owns its media, rights assertion, focal point, extracted findings, and pixel-use policy. The relationship explains what that image contributes to the root block.

A **context set** is the directed closure from a selected root block through its active outgoing relationships. It is a user-facing compound object without becoming a monolithic storage object. “Add context set” copies the root, all directed supporting blocks, and their relationships into one destination document in one atomic batch. It never follows incoming edges and therefore never merges unrelated roots merely because they share a reference.

Creating, changing, removing, restoring, copying, and compiling relationships are durable, replayable operations. Every document view may offer a single context-set action while still allowing its members to be edited separately after insertion.

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
22. **Costly asynchronous work is server-owned.** Image generation, reference extraction, adaptive structuring, and conversational work survive refresh and reconnect through durable jobs.
23. **Draft promotion is a first-class success signal.** Selecting a draft for full-quality generation records both user intent and eventual system delivery; failure never erases the intent.
24. **Reference pixels require explicit policy.** Metadata-only context never silently becomes image input, and a pixel-enabled reference is passed to the editing model rather than described only in text.
25. **Image crops preserve the focal subject.** Every generated image and uploaded reference receives a durable normalized focal point; every `object-fit: cover` surface uses it.
26. **`DESIGN.md` is normative.** New and changed UI must satisfy its gallery-first, accessibility, typography, spacing, form, image, collapse, and hover-stability rules.
27. **Generated artifacts are quality-aware everywhere.** Draft and full-quality images share one durable history and remain visibly distinguishable across every document view, Library surface, comparison, and replay.

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
| Reusable blocks | Project-scoped blocks live independently of documents, use the same project/collection containers and access boundary, and may be copied into documents |
| Block relationships | Typed, directed, replayable edges connect independent blocks; a directed context set may be inserted atomically without merging the underlying identities |
| Physical deletion | Do not physically delete creative state; remove/restore events produce reversible tombstones |
| Embeddings | Store source artifacts as truth; embeddings are model-versioned, fully rebuildable projections |
| Image focal points | Durable normalized focal points belong to generated outputs and Reference blocks; deterministic local analysis is preferred before model-assisted fallback |
| Generation quality | Draft ideation and full-quality results share one history with explicit quality, model, dimensions, source preview, and promotion receipts |

### 3.2 Runtime and provider decisions

| Decision | Adopted position |
| --- | --- |
| UI runtime | Lit custom elements on a plain Vite/Cloudflare Worker shell; no React runtime |
| Reactive state | `signal-polyfill` and `signal-utils` isolated behind `ApplicationStore` so proposal changes do not leak into component contracts |
| Pilot persistence | D1 for durable event storage and R2 for media |
| Production persistence | Postgres 17, pgvector/HNSW, TimescaleDB, and object storage |
| Planning provider | OpenAI Responses API with `gpt-5.6-terra`, structured output, `store: false`, and a privacy-preserving safety identifier |
| Image provider | OpenAI Image API with `gpt-image-2`; use the structured direction plus the immutable document snapshot as the image prompt; use image editing when policy-enabled reference pixels are present |
| Draft profile | Low-quality 816×816 JPEG with compression around 70, streaming/partial preview where supported, and no unnecessary high-fidelity settings |
| Full profile | High-quality `gpt-image-2`, normally 1536×1024, using the selected latest draft plus every policy-enabled reference image as image inputs |
| Live chat preview | On by default; the user may disable it to send several chat turns before requesting another draft image |
| Generated media | Store generated image bytes in private R2; immutable events keep authenticated asset references, dimensions, MIME type, models, usage, and timings—not base64 payloads |
| Async execution | Durable server jobs own preview, full generation, chat, adaptive structuring, and reference extraction; clients reconnect and acknowledge results |
| OpenAI attribution | Configure `OPENAI_PROJECT` per environment and attach it to every direct OpenAI request without exposing credentials in clients, logs, or events |
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
| Pilot budgets | Hard caps of 500,000 tokens per user and 5,000,000 per workspace; reserve before paid work and fail closed at exhaustion |
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
| Provider-backed replay | Permit an optional real-data replay only after direct, one-use user approval; agents, automations, and test tools may never invoke it; persist completed sessions for reuse |

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

Long-running work uses a durable job boundary rather than a browser request lifecycle:

```text
User action → append request receipt → durable document job → provider/storage
      │                    │                       │
      └──── reconnect/poll ┴──── partial image ───┴─ completion/failure events
```

The browser may leave, refresh, or reconnect without canceling the provider operation. A lease, retry policy, correlation ID, requested document sequence, progress payload, completion result, notification state, and acknowledgment belong to the job record. Final creative truth still enters through ordinary events; the job table is orchestration state, not a second document source of truth.

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
- Library Block and Block Relationship projections.
- Context Set manifest for directed reusable compounds.
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
- Document Job Health and reconnect/notification status.
- Generation Quality and Draft-Promotion ledger.
- Image Focal Point coverage.
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
- Every document view offers a URL-addressable focus mode that hides the global header, project rail, page introduction, and summary chrome while keeping the document-view switcher and an obvious exit control available.
- Its disclosure control is integrated, labeled, exposes expanded state, and works on touch and keyboard.
- Library and Studio use the same rail component language, header hierarchy, spacing, scope cues, and responsive rules.
- Library collection filtering changes the Library projection only; it never silently opens a document.
- Mobile navigation preserves every primary destination in a horizontally accessible workspace navigation.
- Use an eyebrow only when it adds non-redundant orientation. When present, it communicates workspace, project/document scope, Creative intelligence, or Administration—not implementation phases.
- Project state is displayed as status and edited through a real form.
- Navigation actions are links with real URLs; mutations are buttons.

### 5.3 The seven views of one document

All document views fold the same durable event stream. Switching views changes the interaction model, not the document.

| View | User experience | Required “a-ha” moment |
| --- | --- | --- |
| **Document** | Baseline block authoring and generation | The durable context is directly inspectable and editable |
| **Context board** | Spatially relate outcomes, evidence, constraints, and results | Relationships become visible before the user must formalize them |
| **Guided brief** | Turn the document into a sequenced decision conversation | The next useful decision becomes clearer than the machinery underneath it |
| **Reality layers** | Image-editor-style list of creative realities | A complex brief becomes controllable through add, edit, order, weight, lock, and visibility operations |
| **Adaptive path** | Restructure guidance from the user’s open intent and adopted choices | The interface exposes the next related decision without hiding durable context |
| **Creative editor** | A familiar tool palette, one-page artboard, contextual inspector, and preview | The person can shape the whole document without learning block, event, provenance, authority, handle, or sequence concepts |
| **Chat** | One generated-image stage and one conversation between the user and the assistant; blocks change behind the scenes | Natural conversation can build the same complete document without making the user manage its machinery |

Requirements for every alternate view:

- Represent every current block, output, saved decision, and relevant durable state.
- Render the same quality-aware generation history, including drafts, full-quality outputs, current progress, and draft-to-full promotion links. If a view has no natural generation location, add one.
- Let the user navigate among project, collections, documents, and all document views.
- Use outcome-oriented language instead of exposing event-sourcing machinery as the primary experience.
- Make all mutations through the shared event vocabulary.
- Preserve Undo, Redo, provenance, generation, Library reuse, and document lifecycle capabilities.
- Adapt to its own available width; do not require a parent to scroll sideways to reach essential controls.
- In focus mode, use the full working viewport and keep dense editor overflow inside the relevant tool, canvas, or inspector region; preserve a natural stacked page on narrow screens.
- Resolve the same `spatial_scope` property and offer a local customization path without creating view-specific targeting state.

Spatial targeting appears in the language of each view:

- **Document:** an `Affects` control on every context block.
- **Context board:** the same control on each board card so scope remains attached while blocks are spatially related.
- **Guided brief:** an affected-area step beside each saved answer; unsaved answers explain that scope becomes available after the decision exists.
- **Reality layers:** a mask-style summary in the layer list and an affected-area editor in the selected layer inspector.
- **Adaptive path:** a `Where this decision applies` step when reviewing a resolved decision, after the user has supplied its content.
- **Creative editor:** a plain-language affected-area control in the selected-item inspector plus a concise scope summary on the plan item.
- **Chat:** accept plain-language locations such as “the right side,” resolve them into the shared `spatial_scope`, and ask for confirmation only when the intended region is materially ambiguous.

Every authored block separates three independent dimensions: semantic role (`Subject`, `Mood`, `Composition`, `Palette`, `Material`, and the rest of the closed block vocabulary), intent (`Include`, `Prefer`, `Avoid`, or `Never`), and `spatial_scope`. Avoidance is therefore not a role. “Avoid people under 20 years old” remains a Subject decision whose intent is `avoid`; “never use neon green” remains a Palette decision whose intent is `prohibit`. The compiler includes role, intent, and an explicit signed effect in every fact. `avoid` and `prohibit` compile as `must_not_include`; weight expresses influence within that intent rather than positive creative prominence. Legacy Exclusion blocks normalize to a general constraint with `avoid` intent until the user gives them a more specific role.

Quick-add tools must visibly select both the requested role and intent in the authored-block dialog rather than relying on hidden component state. The Avoid quick tool opens with negative intent and a suggested Subject role, while leaving every non-reference role available. Creative Editor exposes separate `Role in the plan` and `Intent` controls in the selected-item inspector; each correction appends an ordinary replayable property edit so content and identity remain intact. Negative items collect under Guardrails and display specific language such as `Avoid subject`, `Avoid material`, or `Never use palette`, while positive preview summaries exclude negative facts from their focal subject, goal, and look.

Reality Layers additionally supports creating customized layers, all 20 block types, suggested subtypes, edit, reorder, remove/restore, duplicate, weight, lock/unlock, and active/inactive state.

Adaptive Path additionally begins with open user input to an LLM, returns a proposed structure with interpretation and rationale, and changes the UI only after explicit adoption.

Chat additionally:

- shows only the current generation/history and the user-assistant thread, never a block list, event log, provenance table, or document visualization;
- resolves conversation into ordinary create/edit/remove block events behind the scenes;
- keeps `Live preview` on by default next to Send;
- permits Live preview to be disabled so several turns can accumulate before another draft is requested;
- runs the low-quality draft profile after preview-worthy conversation changes;
- exposes both Draft and Full-quality generation actions;
- uses the selected or most recent draft as an image input when the user promotes it to full quality;
- passes every Reference block whose pixel policy permits use to the image editing request;
- interprets plain-language instructions such as “use X as a reference image” by creating or updating the typed block relationship and pixel policy, subject to rights clearance;
- records draft intent, full-quality promotion, completion/failure, intervening document changes, and conversation turns as evidence without turning the chat transcript into immutable event payloads.

---

## 6. Durable routing and delivery contract

### 6.1 Canonical routes

| Destination | Route |
| --- | --- |
| Projects | `/projects` |
| Project overview | `/studio/project` |
| Baseline document | `/document/{document-id}/{optional-readable-name}` |
| Alternate document lens | `/document/{document-id}/{optional-readable-name}/view/{board|guided|layers|adaptive|editor|chat}` |
| Focused document lens | Append `/focus` to any canonical baseline or alternate document route |
| Project library | `/library` |
| Library block editor | `/library/blocks/editor/{new|block-id}` |
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

- Refresh, cold entry, copy/paste, browser back/forward, and alternate lens changes retain the selected document and its focused presentation state.
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
- relate a block to independent Reference blocks with a typed purpose;
- add the complete directed context set to a document in one atomic action from every document view;
- ask the assistant to propose any legal block type, preview the diff, and accept or reject it.

Do not make “Add context block” default every intention to Direction.

### 7.3 Blank document contract

- Ask for an initial document name before creation.
- Create an empty document.
- Do not add `direction/untitled`, “Describe a direction…”, or any other placeholder block.
- Add a Direction only after the user authors and submits one.
- Support rename after creation.
- Support reversible remove and restore.

### 7.4 Reference policy and reusable compounds

- A Reference block owns one media asset, rights assertion, extracted realities, focal point, and `pixel_reference_mode`.
- `context_only` contributes textual findings but not image bytes.
- `inspiration`, `edit_reference`, and any future pixel-enabled mode explicitly authorize the adapter to send the authenticated image bytes to the image-editing request.
- A relationship states whether the Reference supports subject appearance, style, composition, material, lighting, palette, mood, or general visual evidence.
- A non-reference block may create a new Reference during authoring, but the result is still two independently addressable blocks plus one relationship.
- Forking a root block preserves its outgoing relationship graph. Document-owned related blocks are forked into the project Library when required; already-independent Library references may remain shared.
- Removing a relation does not remove either block. Removing a block does not erase its historical relationships.

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

Model newer behavior with explicit witnesses as well: block relationship add/remove/restore, draft preview request/completion/failure, draft-to-full promotion intent and outcome, image focal-point calculation, durable job request/completion/failure, and provider-backed Replay approval/session lifecycle. Do not collapse these facts into generic property bags or ephemeral UI state.

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
9. Implement the shared normalized spatial-scope schema and editor, default every missing scope to the whole document, and compile an explicit normalized scope with every block.
10. Implement the normative `DESIGN.md` foundations: one sans-serif hierarchy, user-owned root font size, neutral gallery canvas, shared form controls, whitespace-led grouping, large image stages, stable hover/focus behavior, and collapsible dense regions.

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
- Apply different blocks to a named or fuzzy region, normalized rectangle, subject-relative area, and custom clipping path; switch among all document views and confirm they resolve and edit the same scope.

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
11. Drive the first private pilot through a two-stage OpenAI workflow: produce a bounded structured direction with the Responses API, then generate the actual artifact through the Image API with `gpt-image-2`.
12. Persist generated image bytes in private object storage and append only authenticated asset references plus model, adapter, usage, dimension, MIME, and latency receipts.
13. Render the same stored image in the active document, Creative Editor, comparison, history, project overview, Library, export, and revocable shared views; do not substitute decorative CSS art for generated output.
14. Keep the second provider adapter as a release gate: add it and run same-context comparison before production Phase 7 or general availability.
15. Create a durable `document_jobs` subsystem for `preview`, `generate`, `chat`, `structure_adaptive`, and `extract_reference` with queued/running/completed/failed state, leases, retry, correlation, expected document sequence, partial result, final result, notification, and acknowledgment fields.
16. Start provider work from the server and let the Worker continue it after the initiating response. Reconnecting clients fetch active/recent jobs rather than restarting the operation.
17. Keep job idempotency explicit so refresh, repeated polling, and retry cannot duplicate a costly provider request or append the same completion twice.
18. Notify the user when an operation completes or fails away from the surface where the result is already visible. Keep the toast above open dialogs or repeat the feedback inside the active dialog.
19. Implement a low-cost Draft action on every document view using low quality, 816×816 JPEG, compression near 70, and early partial image delivery when supported.
20. Implement Full-quality generation on every document view using high-quality `gpt-image-2`, normally 1536×1024. When a draft is selected or is the most recent relevant output, send its pixels as the first edit reference.
21. Keep draft and full outputs in one projection and visibly label their quality throughout the application.
22. Record explicit draft-to-full intent before the full provider call. Join it later to completion or failure so user intent and system success can be evaluated independently.
23. Include role, intent, signed effect, weight, spatial scope, active typed relationships, extracted findings, and standing constraints in every generation snapshot.
24. Resolve every policy-enabled Reference image to authenticated bytes and send those bytes to the image-editing model. Do not substitute textual descriptions when pixel use was explicitly requested.
25. Calculate and append a normalized focal point for every generated image. Prefer inexpensive deterministic analysis and use a bounded vision-model fallback only when local confidence is inadequate.
26. Configure OpenAI credentials and `OPENAI_PROJECT` only in server environments. Add project attribution to every Responses and Image API request.
27. Compile one canonical creative meaning into four prompt representations: narrative prose, prose bullets, structured JSON, and a stable XML node set. Keep prose as the no-preference default.
28. Make prompt representation an explicit generation receipt and job-identity dimension; it must never be inferred from the prompt body after the fact.
29. Add Draft and Full-quality fan actions that queue all four representations against the same immutable document state, reference inputs, generation profile, and shared planner direction.
30. Compare fan outputs side by side with technique explanations and expandable prepared prompts. Persist an explicit preferred technique at document, collection, project, or account scope, resolving the narrowest applicable scope first.
31. Keep ordinary generation and Chat live-preview generation on the effective preferred technique. Fan actions always run all four and never silently change preference.

### Done when

- The same as-of document serializes byte-identically twice.
- Every compiled fragment opens its source block.
- An adapter version change appears as a queryable generation-metric change-point.
- Budget exhaustion prevents paid work without losing the user’s request history.
- A generated image can be viewed across every output surface, downloaded as an image, and the export appears in the stream.
- Image bytes are absent from D1 events and private-content rows; replay resolves them through an authenticated R2 asset reference.
- The compiler contract can drive a second adapter without changing document or event semantics.
- Preview, full generation, chat, adaptive structure, and reference analysis survive refresh and navigation without duplicate charges.
- A completed background job notifies the user only when its result is not already visible.
- Every document view can create and distinguish Draft and Full-quality images from the same document.
- Promoting a draft to full quality preserves the selected draft as an image reference and creates a queryable intent-to-outcome record.
- Spatial scopes, typed block relationships, and policy-enabled reference pixels measurably affect the provider request.
- Every `object-fit: cover` rendering of a generated image uses its focal point.
- Prose, bullets, JSON, and XML serialize deterministically from the same canonical context; JSON follows the stable image-operation/layout schema and XML preserves a stable node hierarchy.
- One fan produces four durable outputs with a common fan identity and shared planner direction, while each output retains its own prompt reference and technique.
- Preference resolution is replayable at document, collection, project, and account scope; removing a preference falls back to the next applicable scope and ultimately prose.

### Do not

- Put a model-specific string outside an adapter.
- Treat the single-provider pilot exception as provider-diversity completion.
- Embed base64 image payloads in immutable events or use a CSS illustration as if it were a provider result.
- Let browser refresh or route changes cancel, orphan, or silently repeat costly work.
- Treat Draft output as disposable UI state or hide it from other document views.

---

## 11. Phase 3 — Reference extraction, reflection, and quality gate

### 11.1 Reference workflow

1. Confirm ownership or license in a contextual native dialog rather than `alert()`.
2. Open the original reference in a top-layer modal rather than a new tab.
3. Use `closedby="any"` where supported and a backdrop target-equality fallback.
4. Run deterministic extraction eagerly where appropriate.
5. Show interpretive findings as confidence-bearing evidence.
6. Let the user opt into individual findings and adopt each separately as editable document state.
7. Calculate and persist a normalized focal point for every uploaded reference before it appears in cropped contexts; use deterministic local analysis first and a bounded model fallback only when needed.
8. Let each Reference choose an explicit pixel policy. Explain the cost and provider effect before enabling pixel use.
9. Resolve pixel-enabled references through authenticated server storage and pass their bytes to the image editing model; keep context-only references in the textual compile only.

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
- Every `object-fit: cover` rendering of an uploaded reference uses its durable focal point.
- A pixel-enabled reference is observably present in the image-editing request; a context-only reference is observably absent from image inputs.

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
11. Add independent-block relationships for visual evidence, subject, style, composition, material, lighting, palette, and mood. Keep these distinct from output provenance edges while allowing one explanation surface to traverse both.
12. Make relationship add/remove/restore, copy, fork, and compile behavior visible in Context Diff and Provenance Explanation using human-readable actions rather than raw IDs.

### Done when

- A region of an output becomes a reusable block with queryable lineage.
- The same Context Diff drives comparison and later chat proposal previews.
- A user can answer “why am I seeing this?” without reading event or edge machinery.
- Export exposes the effective rights result and its evidence.
- A root block and its directed reference context can be added to any document as one atomic context-set action while every member remains separately editable.

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
10. Build the Chat document view as a complete abstraction: only the generation stage/history and the conversation are visible; document blocks are created, edited, and removed through ordinary events behind the scenes.
11. Add a `Live preview` checkbox beside Send, on by default. When off, commit multiple chat changes without generating another draft until the user explicitly requests one or turns preview back on.
12. Use the low-cost Draft profile for conversational previews and the Full-quality profile only for an explicit Generate action.
13. When moving from a draft to full quality, send the selected/latest draft and every pixel-enabled Reference block to the image-editing model.
14. Resolve “use X as a reference image” into a typed relation and explicit reference pixel policy rather than an unstructured prompt-only hint.

### 13.2 Progressive disclosure

- A new document may begin as one named blank surface or one open text field.
- Structure accretes through the same events the full canvas uses.
- The system may suggest block type and subtype, but the user decides what is adopted.
- The expanded New Authored Block experience is a categorized dialog, not an inline form that displaces the document.

### 13.3 Alternate document views

Build Context Board, Guided Brief, Reality Layers, Adaptive Path, Creative Editor, and Chat against the same durable document projection.

- Give each view the full breadth of block and document lifecycle capabilities.
- Keep Project overview separate from document-view navigation.
- Make cross-view links use canonical document URLs.
- Let each view adapt to its delivery width.
- Make the experience outcome-led rather than event-machinery-led.
- Ensure every alternate representation includes all durable decisions and results.
- Give every view access to Draft and Full-quality generation and the same generation history.
- Build Creative Editor as the machinery-free lens: translate the complete projection into a tool palette, one-page plan, generated-image preview, and contextual inspector; keep stream counts, IDs, handles, authority labels, provenance controls, and event terminology outside its working surface.

### Done when

- Automated parity exercises every baseline canvas operation from chat and every chat mutation from a visual surface with equivalent committed events.
- Invalid chat references become rare because the manifest constrains them before generation.
- A deliberately stale proposal is rejected or explicitly rebased.
- A rejected proposal is witnessed.
- Every alternate view opens the same document ID and represents its complete projection.
- The Adaptive Path never mutates structure until the user adopts the proposed interpretation.
- Chat with Live preview disabled can accept several turns without starting image work, then produce one draft from the accumulated document.
- An explicit Generate from Chat promotes the chosen/latest draft, records the intent before provider work, and uses that draft as an image reference.

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
12. Allow collections to contain independent Library blocks through the same membership and project-access model used for documents.
13. Add `BlockRelationAdded` and `BlockRelationRemoved` with compensating restore behavior, server permissions, project/document scoping, and rebuild tests.
14. Build the directed Context Set projection with a hard traversal bound and no reverse-edge expansion.

### Done when

- Nested collections can be created, renamed, reordered, and populated by keyboard and chat with equivalent committed events.
- Duplicate and cycle attempts append structured validation receipts.
- Removal honors the selected orphan policy.
- A full replay reproduces the tree exactly.
- “Put X in Y” resolves through the handle index.
- A user can see and open all documents in the project from one project-scoped destination.
- Documents and reusable blocks can be filed into the same authored collections without becoming the same kind of object.
- A context-set copy reproduces its directed blocks and relationships atomically in the destination document.

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
14. Witness canonical document-view visits, including Focus mode, and carry the strongest/last working mode into each document-bound re-entry destination.
15. Evaluate acceptance by destination view so a useful brief item can be distinguished from a useful route and presentation mode.

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
- Re-entry can return to an evidenced working mode without confusing navigation frequency with creative preference.

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
13. Treat draft-to-full promotion as direct trajectory evidence: the user found an exploratory result worth advancing. Keep the later provider completion/failure separate so Scout can distinguish strong intent from delivery quality.
14. Analyze direct visits, edits, generation requests, retained outcomes, transitions, and optional friction support by document view.
15. Report working-mode fit as a falsifiable workflow observation; use it to improve routing and UX support, never as generation context or creative direction.

### Done when

- Every observation exposes enough evidence to confirm or reject it.
- Confidence calibration is measurable by observation type.
- Budget exhaustion is planned rather than surprising.
- Candidate artifacts remain outside authored documents until promoted.
- Confirmed observations per dollar can be computed.
- Progress and friction can be located in a named document view with direct and supplemental evidence visibly separated.

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
12. Feed draft-to-full promotion into the Intent-to-outcome ledger and later ranking as strong direct-action evidence, while never turning one promotion into a permanent taste rule.
13. Store a separate working-mode projection for last/preferred document view and per-view outcomes; label it as UI-routing memory and exclude it from aesthetic beliefs and generation input.

### 18.2 Opt-in attention pilot

1. Keep ordinary explicit-click instrumentation separately controllable.
2. Make attention capture off by default and require explicit opt-in.
3. Capture only while `document.visibilityState === "visible"`.
4. Record coarse semantic surface, document view and Focus state when applicable, action context, visible object IDs, active time, idle time, and terminal action.
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
10. Add a project-scoped Block editor that creates, edits, forks, locks, removes, restores, and files blocks without attaching them to a document.
11. Use the same project and collection containers for documents and independent blocks so access and organization follow one boundary.
12. Let any non-reference block relate existing standalone Reference blocks with a typed purpose or upload a new independently reusable Reference while authoring.
13. Preserve related-reference graphs when a Library block is forked. Fork document-owned targets as needed; do not duplicate already reusable targets without reason.
14. Show connected reference previews and context-set size in Library cards, focused previews, and document-view insertion dialogs.
15. Provide one `Add context set` action in every document view; copy the directed set as one atomic event batch while keeping copied members independently editable.

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
- Independent blocks and their typed reference relationships rebuild exactly and can be filed, forked, removed, restored, and copied without a document.
- A context-set insertion produces one visible success outcome and never accidentally pulls in a second root that shares the same reference.

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

1. **Creative loop** — extraction, authored correction, pixel policy, focal point, compile, draft, draft-to-full promotion, four-technique prompt fan, scoped prompt preference and revocation, image editing, compare, keep, and export.
2. **Document evolution** — project/document lifecycle, all 20 block types, standalone Library blocks, typed reference relationships, atomic context-set copy, reversible context, objects, annotations, and shared collections.
3. **Asynchronous return** — durable server job, partial preview, navigation away, completion notice, session close, brief, Scout report space, judgment, acceptance, and document promotion.
4. **Concurrent pressure** — inert model proposal, commutative actions, stale validation, partial progress, and explicit rejection.
5. **Family promotion** — inferred grouping kept separate from authored collection promotion.
6. **Taste & time** — critique, versioned belief, authored preference, delayed resurfacing, revocation, and forgetting.
7. **Attention & friction** — visible-only dwell, weak weighting, useful and weak terminal actions, review, and deletion.
8. **Operational safeguards** — registry, reservations, settlement, failures, retention, attribution, abandonment, and phase-gate receipts.

Keep the fixtures synchronized with every admitted server-produced or authorized event and every block type.

Each narrative must exercise spatial scopes, quality-aware generation, focal points, typed relationships, reference pixel policy, Chat mutations, job completion/failure, and draft-promotion evidence wherever the capability naturally belongs. The as-of projection reports active context links in addition to blocks, outputs, collections, and other existing rows.

### 20.3 Event exposition

For every selected event, show:

- **What happened** — the concrete action or fact.
- **Why this happens** — the actual trigger or preceding condition.
- **How this helps** — the user, trust, creative, operational, or evaluation benefit.

Also show meaningful elapsed time, wall-clock position, actor handoff, and session boundary. Time is supporting context, not a generic claim about causation. Do not repeat nearly identical benefits for unrelated events.

Translate opaque identifiers into user-readable action labels in diffs and projection comparisons. Preserve raw IDs in an expandable technical receipt, not as the primary explanation.

### 20.4 Provider-backed reusable mock sessions

Add an optional mode that uses real provider data to populate a complete replay session:

1. Use one structured planning response to author realistic values for all mocked fields.
2. Generate one synthetic reference image.
3. Generate one low-quality 816×816 JPEG draft using that reference.
4. Generate one high-quality image-edit request using both the chosen draft and reference image.
5. Build a replay event stream that contains the same rights, extraction, focal-point, relationship, pixel-policy, job, draft-promotion, completion, and reuse semantics as ordinary product work.
6. Store the session, events, plan, image assets, model receipts, usage, and summary so the paid fixture can be reopened and reused without repeating provider work.

This mode is expensive and guarded:

- It is disabled unless the server has an explicit feature flag and provider configuration.
- Automation headers, agents, evaluation tools, and test runners are rejected at the server boundary.
- The UI explains the provider operations, expected delay, and cost-bearing nature before approval.
- The user must check separate acknowledgments, enter the exact confirmation phrase, and provide direct-user initiation.
- Approval creates a one-use, short-lived server record, is consumed atomically, and cannot be replayed.
- The operation reserves budget before work and releases or settles it after success/failure.
- Saving a provider-backed session never appends it to the user’s creative document stream; it remains a reusable administrative fixture.

### Done when

- The scenario coverage audit exercises the complete event and block capability set.
- Every event has a specific trigger and benefit explanation.
- Replay to any sequence rebuilds the selected projection without writing the fixture to the user stream.
- Refreshing any Event operations tab preserves the tab.
- Relationship add/remove/restore, context-set compilation, Chat, quality levels, draft promotion, focal points, pixel handoff, and durable job behavior appear in the coverage audit and event exposition.
- A directly approved provider-backed session can be generated once, saved, reopened, and replayed without another provider charge.
- Agents and automated tests cannot invoke provider-backed replay even when they know the endpoint or confirmation phrase.

---

## 21. Cross-cutting interface and visual-system requirements

### 21.1 Normative design contract

Create and maintain `DESIGN.md` as the visual and interaction source of truth. It must describe a new design direction rather than documenting whatever the current CSS happens to do.

The product should feel like minimalist, high-end creative software: closer to a contemporary gallery and a precise editing instrument than a CMS or dashboard. Created images and authored content own the canvas; the interface that produced them fades into the background without becoming obscure, inaccessible, or intimidating.

Apply these principles to every Studio lens, Project, Library, Re-entry, Scout, Taste & time, System, Event operations, dialog, and shared view:

- Use whitespace, alignment, and rhythm as the primary sectioning system.
- Avoid containers nested inside containers. Add a card only when the object is independently actionable or movable.
- Prefer one strong image stage or outer surface over several decorative panels.
- Make generated images and references materially larger than metadata and controls.
- Use a neutral warm-white, white, ink, gray, and restrained blue-accent palette; reserve semantic green, amber, and red for explicit states.
- Use one sans-serif family for every headline and body role. Reserve monospace for identifiers, event payloads, shortcuts, and code-like values.
- Use direct page titles and compact helper copy. Eyebrows are optional context, not a required layer above every heading.
- Normalize buttons, inputs, selects, textareas, checkboxes, field help, dialogs, status chips, and image lightboxes across the entire application.
- Let side rails, inspectors, histories, advanced form groups, and dense supporting regions collapse and return their space to the work.
- Keep administrative surfaces denser where useful, but never give them a separate visual brand.

### 21.2 Typography and content hierarchy

- Preserve the browser’s default 16px root size; do not set a smaller size on `html` or `body`.
- Use `rem`-based typography and render no visible text below 10px.
- Use sans-serif headlines with moderate weight and tight tracking.
- Repeat one clear hierarchy: optional scope context, page title, at most one supporting sentence, local navigation, section title, body, then metadata.
- Do not repeat the same concept in an eyebrow, title, and description.
- Use bold only for headings, selected values, and one essential phrase in compact status.
- Style Library, Document, Project, Intelligence, and Administration headers as one structural family with purposeful variations in density.
- Wrap, scroll, or collapse metadata labels—such as “Authored” to “A” and “Why?” to “?”—before `.block-meta` overflows.

### 21.3 Forms and controls

Every form section uses this order:

1. Heading outside the field border.
2. Optional one-sentence help.
3. Visible label.
4. Control.
5. Optional supporting or error text.

Inputs, textareas, and selects use the same white surface, balanced one-pixel border, six-pixel radius, minimum target height, and visible accent focus ring. Related fields form a responsive grid and become one column before compression harms comprehension. Advanced or infrequent controls use semantic disclosure. Placeholder text never substitutes for a label.

Primary actions are scarce and local. Secondary actions use a balanced hairline. Ghost actions gain a quiet surface on hover/focus. Destructive actions are separated from forward progress. Icon-only targets remain at least 36px square and have an accessible name; ordinary interactive targets aim for at least 40px.

### 21.4 Images and content-led surfaces

- Use focal-point-aware `object-fit: cover` only for thumbnails and browsing grids.
- Use `object-fit: contain` for editing, comparing, focused previews, lightboxes, and any surface intended to show the whole image.
- A passive generation or reference image opens the shared largest-possible image dialog.
- Image stages use near-black so content edges remain legible without a competing frame.
- Overlay labels maintain contrast and do not obscure the focal region.
- Library block and output grids use fewer, larger columns; object name and one useful fact follow the image, while receipts move into focused views or disclosures.
- Families present as visual groups first and inferred records second.

### 21.5 Responsive and collapsible layout

- Keep every page within the viewport at supported widths; horizontal scrolling is intentional only for timelines, filmstrips, and wide data tables.
- Use `minmax(0, 1fr)` and allow reusable-component children to shrink without overflow.
- Make the project rail a stable edge-pinned region on wide screens and a complete functional dock/disclosure on constrained screens.
- Permit Project Context, Project & folders, generation history, tool palettes, inspectors, and other dense secondary regions to collapse independently.
- Collapsing a region returns useful width or height to the created content and leaves a named, keyboard-operable restoration control.
- Make Reality Layers, Creative Editor, Context Board, and other dense tools container-adaptive and independently scroll only the region that needs it.
- Keep document actions available through a sticky document bar without stacking sticky chrome into an unusable viewport.
- Treat focus mode and rail collapse as independent valid states.
- Preserve every navigation destination and essential action on touch and keyboard.

### 21.6 Motion and hover stability

- Hover or focus may change color, opacity, border color, or a non-layout shadow.
- Never translate or scale an in-flow card or control on hover.
- Never reveal in-flow content on hover in a way that changes page geometry.
- Reserve action space, use a non-obscuring overlay, or keep actions visible.
- No essential action may exist only on hover.
- Respect `prefers-reduced-motion` globally.

### 21.7 Rounded-edge invariant

- Never put an imbalanced CSS border on an element with `border-radius`.
- Never simulate an imbalanced border with an offset inset box-shadow, pseudo-element, or another paint workaround.
- Inset emphasis on rounded elements must be concentric: zero horizontal and vertical offset with balanced spread.
- Enforce the rule through automated CSS source checks.

### 21.8 Dialogs and transient feedback

- Use native `dialog` for focused previews, block creation, project/collection editing, rights confirmation, original images, palette selection, spatial scope, and paid replay approval.
- Prefer `closedby="any"` where available and add a target-equality backdrop fallback.
- Render dialogs in the top layer so positioning never alternates between viewport and component containment.
- Preserve Escape, explicit close control, focus return, label association, and keyboard operation.
- Deliver toasts above open dialogs. If the platform cannot guarantee that ordering, repeat the feedback within the active dialog.

### 21.9 Affordance audit

Before every phase gate, enumerate every button, link, drag target, tab, menu item, disclosure, and dialog action. Verify that it:

1. appends or derives a visible event-backed outcome;
2. navigates to a durable URL; or
3. is disabled and names the prerequisite.

A successful append that leaves the user believing nothing happened is a usability failure. A hover interaction that moves the content the user was targeting is also a usability failure.

---

## 22. Evaluation program

### 22.1 Structural evaluation

- Full projection rebuild equivalence.
- Chat/canvas/alternate-view event parity.
- Actor permission and schema enforcement.
- Optimistic concurrency, authored-wins race, and partial-batch behavior.
- Stable prompt serialization.
- Four-language prompt parity, schema stability, fan identity, shared-planner reuse, and scoped preference precedence.
- Lossless archive round-trip.
- Route refresh, cold entry, deep-link, and browser-history tests.
- Projection lag, rebuild duration, and throughput.
- Budget reservation, settlement, cap, failure, and recovery behavior.
- Durable document-job lease, reconnect, idempotency, progress, completion, notification, and acknowledgment behavior.
- Draft/full quality projection, selected-draft promotion, reference-pixel handoff, and intent-to-outcome joins.
- Focal-point coverage for every generated and uploaded image plus explicit focal positioning for every cover crop.
- Independent block-relationship add/remove/restore, directed context-set copy, and cross-project/document filtering.
- Automated rounded-edge invariant checks.
- Automated rejection of layout-affecting hover reveal and hover translation.
- Keyboard, focus, dialog, collapse/restore, toast-above-dialog, and reduced-motion checks.
- `DESIGN.md` contract checks for sans-serif headings, user-owned root size, 10px text floor, normalized forms, and gallery-first image hierarchy.

### 22.2 Product evaluation

| Area | Evidence | Decision supported |
| --- | --- | --- |
| Extractors | Correction rate, direction, churn, confidence calibration | Whether a finding is reliable enough to show or automate |
| Re-entry | Impressions, acceptance, blank canvas, composition cost, dosage, destination-view acceptance | Whether pre-paid re-entry helps and returns through a productive working mode without creating dependence |
| Retrieval | Cited-example relevance, family correction, collection filtering | Whether the private corpus improves translation and recall |
| Scout | Judgment by type/confidence, confirmed observations per dollar, per-view progress/friction | Whether bounded exploration is honest, useful, and able to locate UX support opportunities |
| Taste | Promotion, revocation, critiques, freshness, ranking usefulness, separated working-mode memory | Whether memory should rank without narrowing possibility or confusing workflow with aesthetics |
| Attention | Opt-in, false-positive friction, later explicit confirmation, forgetting | Whether weak signals improve UX insight without surveillance |
| Adaptive UI | Structure adoption/rejection and time to next meaningful decision | Whether mutation clarifies rather than destabilizes |
| IA | Rail collapse, direct-entry comprehension, project/Library scope | Whether hierarchy remains legible without prior context |
| Generation loop | Draft use, draft-to-full promotion, completion/failure, time and cost | Whether fast exploration reliably produces work worth advancing |
| Reference pixels | Pixel-policy adoption, relationship role, edit-result usefulness, rights failures | Whether images improve results without hidden provider inputs |
| Async work | Completion after navigation, duplicate prevention, notice usefulness, retry recovery | Whether costly work feels dependable rather than fragile |
| Visual system | Content prominence, collapse use, hover stability, form comprehension, image inspection | Whether the product feels like inviting high-end creative software rather than a CMS |

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
- Confirm Draft and Full-quality profiles, partial preview behavior, reference editing, and `OPENAI_PROJECT` attribution across environments.
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
- Verify all seven views remain complete representations of one document and one generation history.
- Verify every Replay laboratory scenario stays synchronized with the admitted vocabulary.
- Verify costly jobs survive refresh and reconnect without duplicate charges.
- Verify `DESIGN.md` compliance across creative, intelligence, administrative, and shared surfaces.

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
- a Chat view that stores a second hidden document model or omits generations from the other views;
- embedded reference media duplicated across richer block types when a typed relationship can preserve independent ownership and reuse;
- context-set traversal through incoming edges that accidentally merges unrelated roots;
- context-only references sent as image bytes without explicit pixel policy;
- browser-owned costly operations that disappear, restart, or double-charge after refresh;
- low-quality drafts hidden as disposable preview state;
- full-quality generation that ignores the promoted draft or policy-enabled reference pixels;
- cover crops that ignore a known focal point;
- non-functional UI affordances;
- imbalanced borders or simulated imbalanced edge accents on rounded elements;
- layout-affecting hover reveals or hover translation/scale of in-flow content;
- a CMS-style visual system dominated by nested panels, repeated eyebrows, small images, inconsistent type/color/weight, or non-collapsible machinery;
- provider-backed Replay generation initiated by an agent, automation, evaluation tool, or reusable approval token;
- production claims based only on deterministic pilot embeddings, fixtures, or theoretical generations;
- team/community publication before identity, moderation, rights, and collaboration decisions exist.

---

## 25. Handoff checklist

An implementation team beginning at zero should receive:

- this plan;
- `DESIGN.md` as the normative gallery-first visual and interaction contract;
- `docs/decisions.ndjson` as the append-only rationale ledger;
- the normative event schema and actor permission matrix;
- the payload classification ledger;
- the projection catalog and rebuild tests;
- the 20-type block taxonomy and subtype definitions;
- canonical route tests;
- the fixed extractor corpus;
- the eight Replay laboratory narratives;
- the provider-backed Replay approval policy, one-use approval store, reusable paid-session format, and automation-rejection tests;
- accessibility, responsive, dialog, typography, and rounded-edge invariant tests;
- form-normalization, collapse/restore, focal-point crop, image-lightbox, hover-stability, and toast-layering tests;
- provider, budget, rights, retention, and deployment configuration separated by pilot and production environment.
- direct Image API contract tests, private generated-asset storage tests, and cross-surface image-projection tests.
- durable document-job, Draft/Full-quality, draft-promotion, reference-pixel, block-relationship, and atomic context-set tests.

The agent begins with Agent Bootstrap, proceeds to Phase 0, and advances only through the gates in this document. The result must be one coherent event-sourced creative system, not a set of pages that merely share a visual theme.
