# Cross-application product and architecture review

## Executive assessment

The strongest product idea is not image generation. It is that a creator can
author a durable, inspectable creative world once and shape it through multiple
working modes and multiple outputs without losing intention, relationships, or
control. Images, scenes, stories, presentations, storyboards, and motion should
feel like different expressions of the same work, while Canvas provides a
project-level place to discover relationships between them.

The primary risk is that the implementation can expose the machinery before it
demonstrates that value. Every improvement should therefore be measured against
four questions:

1. Does it make a creator's next useful action more obvious?
2. Does it preserve complete, trustworthy ownership and provenance?
3. Does it reduce avoidable provider cost, latency, confusion, or data exposure?
4. Can another application reuse the capability without copying business logic?

## Product model

```text
Account
└── Project
    ├── Project library
    │   ├── Independent reusable decisions
    │   ├── References and related context
    │   ├── Authored collections
    │   └── Searchable results from every document
    ├── Documents
    │   ├── Authored and inferred context
    │   ├── Combined Context boundaries
    │   ├── Complete alternate authoring views
    │   ├── Draft, full-quality, and comparison-fan images
    │   └── Stories, scenes, slide decks, storyboards, and videos
    └── Project canvases
        ├── Spatial references to any project content
        ├── Explicit selections, arrangements, and Combined Contexts
        └── Prepared documents and their complete output histories
```

Four separately loaded applications consume that model:

- **Creative:** complete document creation and project discovery.
- **Canvas:** project-level spatial synthesis, not another document lens.
- **Operations:** governance, reliability, privacy, cost, and truthful diagnostics.
- **Laboratory:** isolated replay, provider qualification, visual investigation,
  and a living design-system inventory.

This distinction is essential: a project can contain many documents and boards,
but a document output always has one attributable source document. A board may
compose realities across documents without claiming that visual proximity alone
changes a generation.

## Security and privacy requirements

### Document shares are capabilities, not account sessions

A share must freeze the exact document and project being disclosed plus the
specific object-store keys visible when the share is created. Public media
resolution must verify both the owning namespace and exact manifest membership.
No token may authorize unrelated documents, future uploads, private-language
records, prompt references, or a complete account stream.

The project Library has the same boundary for downloads: exporting a project
resolves ownership across its documents, reusable decisions, references,
collections, generations, composed outcomes, and boards before selecting history.
An account-wide event archive must never masquerade as a project export.

The immutable `share_scopes` projection records this capability separately from
the existing share lifecycle. Older links without a scope must fail closed.
Public responses require private/no-store caching behavior.

The shared document should still be useful: authorized images, grouped prompt
fans, written outcomes, presentations, storyboard frames, and videos remain
reviewable without importing unrelated account content. Public image inspection
must be strictly read-only and may never append view or comparison events to the
recipient's private stream.

Provider-backed Replay fixtures retain their original paid assets and rights
receipts across contract versions. Fictional-account preparation normalizes
older missing source-provenance, study-stage, image-format, and experience
fields from retained evidence without inventing a licensed source or requesting
another paid generation. Recoverable legacy failures expose a human next step
by default and their exact technical receipt only on request.

### Collaboration must never overstate its boundary

Current Canvas presence is browser-local, and creative streams are account-owned.
Membership receipts can describe intended future access, but they do not send
invitations or grant another signed-in account access. Interfaces must state
this plainly until project-scoped authorization and a cross-account stream exist.

A production collaboration milestone requires:

1. A project membership and role authority owned by the server.
2. Identity-preserving migration from per-user streams to project-scoped
   sequencing or a dedicated durable project coordinator.
3. Authenticated cross-session change distribution, ideally WebSocket-backed.
4. Bounded, expiring, consent-aware presence separate from authored history.
5. Optimistic conflict recovery that never drops or silently reorders edits.
6. Multi-account authorization, revocation, and convergence integration tests.

### Provider boundaries

Provider keys remain server-side. Every paid operation must be user-initiated,
bounded by the correct budget, and attributable to the effective owner.
Actual-data replay, provider qualification, and impersonated-account mutation
retain their stronger explicit-confirmation contracts.

## Information architecture and user experience

### Projects must communicate real work

A project should show its most recent meaningful outcome, whether that outcome
is an image, grouped prompt fan, story, scene, presentation, storyboard, or
video. Counts must represent all outcomes without pretending four fan members
are four unrelated creative decisions. Project cards should lead with project
identity and outcome, not IDs, status chips, or decorative containers.

### The Library must actually be the project library

All reusable outcomes belong in project discovery. Search, collection filtering,
focused inspection, and reuse must cover every output format. Image-only
history produces the false impression that a story or presentation disappeared
once its document was closed.

Output and reusable-block previews should preserve their source document,
creation date, useful summary, relationships, and one direct next action.
Technical indexing detail belongs behind an administrator-only disclosure.
Visual families are projected only from the active project's available images;
family IDs, anchor claims, removed members, and prompt-fan variants must never
accidentally merge work from another project or collapse four distinct creative
approaches into indistinguishable labels.
Accepted-proposal precedents, authored corrections, and retained-image examples
follow the same project boundary both when shown in the Library and when added
to a document assistant's model context. Account-wide retrieval is an explicit
future capability, never the accidental consequence of one shared event stream.

The global Create entry resolves an existing document in the current project,
falls back to that project's most recent remaining document, or opens project
contents when a document first needs to be created. It never links to an old
document from another project or duplicates Projects while a usable project
already exists.

Commands obey the same authority boundaries as visible navigation: only an
administrator is offered the durable stream, replay experiments, or restricted
Operations destinations. Hiding a route is never the authorization boundary,
but actionable navigation should not invite a creator into a predictable denial.

### One result, one complete creation workflow

Stories, scenes, presentations, storyboards, and video must share one output
composer regardless of whether creation begins in a document, alternate
document lens, Library handoff, or Canvas document card. Audience, tone,
frame/slide count, video duration, aspect ratio, selected pixel references,
provider readiness, and paid-operation consent are capabilities of the output,
not incidental properties of one route.

Canvas may provide a concise format chooser, but choosing a format opens the
same complete configuration used elsewhere. Paid consent is collected once at
the actual point of commitment, not as an unrelated preliminary checkbox.

The command menu follows the same rule: choosing to add a creative decision
opens the actual document authoring flow; it never appends an invented
placeholder. Sharing and export likewise retain one complete, readable
document-scoped contract across every working mode, including written,
presentational, storyboard, and video outcomes.

### Expose machinery only when it answers a user question

The creative surface should say “Saved,” “Your results,” or “Try a first draft,”
not lead with stream sequence numbers, compiler terminology, object-store names,
model IDs, or event classifications. Those details remain inspectable through a
disclosure or Operations. Preserve the ability to explain a result without
requiring every creator to understand the event log.

### Reactive, just-in-time interface behavior

The alternate document views demonstrate that one immutable creative reality can
be expressed through several interaction grammars. Their common abstraction is
an intent/readiness model rather than a fixed list of visible tools:

- No decisions: help the user begin.
- Decisions but no output: offer a draft or a useful alternate format.
- Draft but no finished result: offer refinement or deliberate promotion.
- Multiple comparable outcomes: reveal comparison.
- Failed work: offer explanation, exact inputs, and safe recovery first.
- Valuable retained outcomes: offer reuse, export, or composition.
- Multiple selected Canvas items: reveal only the actions possible for that
  selection and preserve organization while resizing or moving it.

These recommendations are deterministic and explanatory. They never spend,
author, promote, or infer a preference without the user's action.

When a user explicitly chooses a draft or final-image recommendation, the same
document-specific provider/budget/safety preflight runs before paid work is
queued. A review-required request can proceed only after its own exact risk
acknowledgment; unavailable, pending, or blocked readiness fails closed.

Only active, nonzero-influence decisions qualify as usable context. A four-way
comparison fan remains one result until its images are promoted; guidance must
not suggest a standalone side-by-side comparison that the creator cannot
actually open. Unaccepted assistant proposals describe the change in ordinary
language rather than exposing event names, internal identifiers, or stream
positions.

### Intelligence must speak the creator's language

Re-entry should lead with the unfinished work a person can actually resume;
Scout should explain useful next directions; Taste & time should distinguish
saved instructions from optional suggestions. Pilot gates, event identifiers,
raw claim references, provider internals, and implementation receipts belong in
progressively disclosed diagnostics—not in the default reading path.

Continuity counts exclude synchronization locks, budget bookkeeping, provider
probes, page visits, and other system housekeeping. Working-mode transitions are
measured only within the relevant session interval, so a creator is never told
that a lifetime count of view switches represents newly discovered editing modes.

## Rendering, prompt, and semantic integrity

### Every output deserves its complete context

Image compiles and document artifact requests must explicitly identify their
document, project, and consumed block versions. A document projection must not
display the last compile from another document merely because that event came
later in a shared account stream.

Disabled, removed, or zero-weight decisions never reach provider-facing prompt
copy or spatial directives. Otherwise a muted sensitive phrase can still trigger
moderation, influence composition, or mislead a generated story.

Prompt guardrails must consistently preserve:

- Positive direction versus role-specific exclusions.
- Spatial targets, inside/outside polarity, and local influence.
- Combined Context isolation, target identity, order, and relativity.
- Ordered storyboard shots and their selected pixel-reference policy.
- Existing subjects, environmental continuity, audience, and tone.
- Format-specific completeness without repeated or placeholder copy.
- A clean separation between creative meaning and implementation-only IDs.

Provider-specific syntax belongs in an adapter, not in a user-facing document
or an unrelated output workflow. The four image prompt representations remain
comparable expressions of the same normalized semantic facts.

Rendering and conversational assistance have different authority requirements.
Image planners, final image prompts, and story/scene/slide/storyboard/video
planners receive request-local decision/group aliases and descriptive
relationship labels; durable document, block, reference, media, and group IDs
never become model-facing creative prose. Mutation-capable chat assistants keep
only the editable IDs strictly required to target an existing user-owned
decision. Regression tests exercise prose, bullets, JSON, XML, grouped context,
spatial parent relationships, and the provider boundary independently.

### Outcomes must remain reusable

Every completed output can become an explicit, cited document input. A storyboard
remains one ordered reference set, even when individual frame reference modes
vary. A slide deck remains structured presentational data rather than an opaque
image. A screenplay or story carries its actual authored content when reused,
not only its title or artifact identifier.

## Analytics and operational trust

Analytics should first reveal how Forma can improve and second demonstrate how
its workflows helped a creator move faster or achieve stronger outcomes.

Count a block as used when either image compilation or any document-output
request consumes it. Never attach project-library-only context to whichever
document happened to be open. Distinguish provider failures, retries, user
cancellations, administrative stops, blocked preflights, harmless exploration,
actual retention, and meaningful reuse.

Every operational insight should retain inspectable evidence: source document,
surface, context, generation inputs, output quality, provider category, timing,
cost, and the creator action that followed. Attention remains low-authority,
bounded, opt-in evidence; it cannot independently become taste or authorship.

Failure reporting follows the same two-layer rule. The default result list names
the practical problem and next action in ordinary language. Exact prompts,
ordered image references, provider parameters, request identifiers, frozen
document state, and raw technical receipts remain one deliberate “Inspect
inputs” action away for both completed and failed work. Machine-only failures
such as `fal_422` become actionable settings/reference guidance; explicit safety
classifications are never hidden behind generic retry advice.

## Performance and delivery

### Current improvements

- Database schema/bootstrap work is cached per worker isolate.
- Existing account identities avoid unconditional database writes.
- Idle Canvas delta synchronization no longer downloads all private content or
  republishes unchanged application state.
- New private content is hydrated only when a previously unknown reference is
  observed.
- Mergeable Canvas text is indexed by item rather than replaying the whole event
  stream independently for every card.
- Project-aware semantic indexing and precedent retrieval fold creative state
  once per build instead of replaying the entire event history independently for
  every indexed block, generation, correction, or example.
- Analytics grouping mutates one existing bucket instead of copying a stream's
  complete event array for every additional event.
- Each application and Laboratory experiment remains independently loaded.

### Remaining performance boundaries

- The application still hydrates a large account-wide stream. Introduce a
  versioned bootstrap envelope with project/document slices and projection
  checkpoints before very large accounts become common.
- Cross-session project change distribution needs authenticated subscription or
  project-scoped WebSockets; aggressive account polling is not an adequate
  collaboration architecture.
- The shared browser store currently combines identity, event transport,
  projections, navigation, jobs, preferences, and impersonation. Extract typed
  services behind a compatibility facade before adding more applications.
- Global style sheets remain roughly 6,300 lines combined. Continue moving
  implementation into foundation tokens, reusable primitives/patterns, and
  application-local CSS while preserving visual invariants.
- The typography stylesheet still imports a third-party font stylesheet. Either
  self-host licensed font subsets with explicit preload/fallback behavior or use
  the system stack; a creator's first render should not depend on another
  origin, an extra connection, or an avoidable privacy disclosure.
- Long-line worker handlers contain too many branches. Extract focused command,
  authorization, job, and provider services with contract tests before changing
  concurrency or provider routing again.

## Visual and accessibility contract

The product should feel like a high-end creative instrument: authored content
owns the surface; structural whitespace replaces nested decorative containers;
one semantic color system follows browser light/dark preference; headlines are
sans-serif; and actions never move neighboring content on hover.

The living design laboratory documents the actual shipped hierarchy:

1. Foundations: semantic color, typography, spacing, shape, and motion.
2. Atoms: named buttons, status badges, icons, and state treatments.
3. Molecules: accessible fields, metrics, disclosures, and outcome summaries.
4. Organisms: complete output composition, next actions, shared dialogs, and
   meaningful empty states.
5. Templates: consistent Creative, Canvas, Operations, and Laboratory shells.

Store-free foundations are isolated in dedicated modules: the base
presentational element, icon vocabulary, form primitives, slide renderer, and
artifact summaries can be reused by other applications or public views without
subscribing to a private creative account. Connected organisms deliberately sit
above that boundary and receive durable project state explicitly.

These are production dependencies rather than a demonstration-only component
catalog: Projects and Canvas use shared action/onboarding primitives, project
creation uses the labeled field, Scout uses the outcome-oriented empty state,
and Operations uses the common status/metric vocabulary. Every modal across all
four applications shares one heading-aware native top-layer helper; regression
tests reject direct route-specific modal implementations.

All routes should expose a skip link, visible focus states, keyboard-operable
controls, named native-modal dialogs, preference-reactive surfaces, and
responsive layouts that never force horizontal document scrolling. Canvas cards
must be selectable from the keyboard as well as through direct manipulation.

## Product-quality scorecard

These are proposed release targets, not claims that the current build already
achieves them. Instrument them against realistic accounts before enforcing a
threshold.

- **First useful work:** a returning creator can recognize the current project,
  document, and last meaningful outcome without interpreting implementation
  vocabulary. Cached authenticated workspaces should target a p75 usable state
  under two seconds on a representative broadband connection.
- **Navigation continuity:** already loaded applications should target a p75
  route-to-meaningful-content transition below 250 milliseconds. Current
  project, active document, collections, focused mode, and deep-linked previews
  must survive reload without disclosing another owner's work.
- **Direct manipulation:** Canvas should acknowledge a local selection, drag,
  resize, or keyboard move within the next available frame and keep p95 visible
  frame work below 16 milliseconds at the published viewport/item budget. The
  DOM budget depends on visible items and overscan, never board extents.
- **Durability and recovery:** every accepted local action appears immediately,
  remains ordered through reconnect/reload, and is ultimately confirmed,
  conflict-rebased, or explicitly recoverable; silently lost edits are a release
  blocker. Provider jobs always expose a current stage, last heartbeat, terminal
  outcome, exact submitted inputs, and reversible unused-budget reservation.
- **Explicit spending:** every paid route uses the same owner, budget,
  moderation, provider, pixel-reference, settings, and confirmation contract.
  Automated recommendations, replay, evaluation, and impersonation never
  independently initiate a billable provider request.
- **Accessibility and visual quality:** target WCAG 2.2 AA, full keyboard
  completion of every primary task, meaningful announcements for async changes,
  unobscured focus, reduced-motion support, light/dark parity, and no horizontal
  page overflow at 320 CSS pixels, 200% zoom, or applicable reflow sizes.
- **Privacy:** test project export, exact-document sharing, public media,
  fictional-account impersonation, archived history, analytics, and collaboration
  with at least two real owners and interleaved projects. Any foreign payload,
  media key, private prompt, or unauthorized write is a release blocker.
- **Semantic consistency:** one frozen creative document produces equivalent
  meaning across prose, bullets, JSON, XML, artifact planners, Canvas promotion,
  and share/export. Tests cover exclusions, muted decisions, spatial isolation,
  grouped characters, ordered storyboard frames, and provider-local aliases.
- **Outcome value:** track time to first useful draft, draft-to-retained-result
  conversion, cost per accepted outcome, recovery after a failed job, context
  reuse across outputs, Canvas-to-document completion, and whether suggested
  actions actually produced a better next step. Segment by surface, document
  view, output format, provider, and project maturity without treating passive
  attention as authorship or independent creative preference.

## Change-discipline checklist

Any new capability should establish, in the same change:

1. Its pure, documented domain contract and owning application.
2. Server-side authorization, privacy, idempotency, cost, and recovery rules.
3. The shared creation/inspection workflow used by every applicable entry point.
4. Stable, human-readable UI states for empty, loading, success, failure, and
   cancellation; no raw durable identifier by default.
5. Keyboard, responsive, light/dark, and reduced-motion coverage.
6. Event/projection fixtures, focused unit tests, multi-project isolation tests,
   and relevant provider-boundary tests without an unapproved paid call.
7. Operational receipts, product analytics, user-readable next actions, and the
   relevant deterministic or explicitly approved Replay scenario.
8. An entry in the living design laboratory and architecture documentation when
   the change introduces a reusable interaction or application-level pattern.

## External product and standards benchmarks

These are references for interaction quality and product structure, not designs
to imitate literally:

- [Adobe Firefly Boards: Create boards](https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards/create-mood-boards.html)
  supports collecting images, videos, shapes, text, references, and generated
  material in one spatial ideation flow. Forma should preserve that breadth
  while retaining stronger provenance, reusable context, and explicit spend
  consent.
- [Adobe Firefly Boards: workflow presets](https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards/use-boards-presets-for-complex-workflows.html)
  demonstrates task-shaped actions instead of exposing provider machinery.
  Forma's next-step model should reveal a complete, context-aware operation at
  the moment it becomes useful.
- [Figma: Guide to FigJam](https://help.figma.com/hc/en-us/articles/1500004362321-Guide-to-FigJam)
  and [Figma: Create and manage pages in FigJam](https://help.figma.com/hc/en-us/articles/24005082123159-Create-and-manage-pages-in-FigJam)
  show how spatial sections, movable groups, pages, and scoped organization
  keep large boards comprehensible and performant. Forma's board arrangements
  should remain meaningful organizational groupings without silently changing
  generation context; intentional Combined Context remains the semantic action.
- [Apple Human Interface Guidelines: Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
  reinforces content-first hierarchy, consistent alignment, logical spacing,
  progressive disclosure, and recognizable adaptation across window sizes.
- [W3C: What's New in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
  establishes the practical checks especially relevant here: unobscured focus,
  keyboard-accessible alternatives to dragging, appropriately sized pointer
  targets, and consistent help across repeated workflows.

## Recommended next milestones

### 1. Genuine project collaboration

Ship server-owned project ACLs and a shared project sequencer before promising
invitations, teams, presence across devices, or simultaneous multi-account edits.

### 2. Typed domain-service extraction

Separate `IdentitySession`, `EventTransport`, `ProjectProjection`,
`DocumentProjection`, `JobService`, `ProviderPolicy`, `ShareService`, and
`TelemetryService` behind testable contracts. Keep the existing UI adapter as a
temporary compatibility facade during migration.

### 3. Subscription and projection checkpoints

Move from account-wide polling toward scoped server subscriptions, compact
projection snapshots, cursored deltas, and measured hydration budgets.

### 4. Outcome-oriented workflow evaluation

Evaluate complete user journeys: idea to reusable context, context to first
draft, draft to retained final, storyboard to pixel-backed motion, and Canvas
synthesis to composed document. Include cost, accessibility, latency,
recoverability, privacy, and actual comprehension—not only event coverage.

### 5. Continued systematization

Replace remaining route-specific controls, cards, dialogs, hard-coded colors,
and fixed copy with shared primitives and explicit semantic contracts. Every new
capability must be visible in its operational receipts, analytics, Replay
scenario, applicable output workflows, and the design laboratory.
