# Forma everywhere: an adaptive collaborative-creativity product strategy

**Research date:** August 23, 2026  
**Reviewed commit:** `eab3aa0130fe8a3607fbf44fc241933f8d37605a`  
**Important qualification:** The existing working tree was substantially modified before the study and continued changing during it. Findings describe current observed source and the running application, not the clean committed revision. Previously written product assessments already misstate some capabilities that have since landed.

**Research panel:** Lead Designer; Design Engineer; Product Owner; Smart Phone End User; Tablet End User; Small Monitor End User; Large Monitor End User; and independent End User, Market Researcher, and Procurement Officer reviewers. These are expressly commissioned role-playing research agents. Their quoted statements are their actual original contributions to this study; they are not fabricated quotations from external customers, real employees, or interviews.

## Executive decision

Forma should become the **adaptive, project-centered collaborative creative world in which verified sources, authored decisions, many finished outputs, and accountable human review remain connected on every screen**.

This is not four separate applications for four device classes. It is one understandable product expressed through different amounts of visible working context. A phone concentrates on the exact next action without losing access to Forma's depth; a tablet gains genuine touch-enhanced exploration; a small or snapped laptop keeps the primary job and one chosen supporting pane; a generous display makes source, work, result, and review relationships visible concurrently.

Adopt five stable creator-facing destinations:

> **Projects · Work · Explore · Activity · Deliver**

`Explore` opens the project Library by default and also reveals project-authorized Canvas, collections, Scout, and Taste & time. `Activity` is the persistent, entitlement-safe inbox. `Deliver` exposes project-scoped outputs and review without copying or weakening existing ownership. `Work` groups seven preserved document lenses into understandable **Write / Shape / Present** mode families. Settings remain behind a clearly visible, accessible account control.

The visible mental model can unify Creator and Canvas without merging their existing server-authorized applications, changing their routes, exposing private content, or inventing a seventh application.

> “A smaller screen is not permission to ship a smaller product; it is an obligation to present the next meaningful decision first.” — **Product Owner**

> “Responsive design is not the art of hiding tools; it is the discipline of preserving agency under changing physical constraints.” — **Lead Designer**

## Independent scorecard

Four independent reviewers scored the same six requested goals from 1 to 100. The overall figure is the arithmetic mean of all 24 cells, with equal weight per role and per goal. It is an expert assessment of observed delivery, not a measured customer benchmark.

| Shared product goal | End User | Market Researcher | Product Owner | Procurement Officer | Mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| Phone: focused portrait/landscape touch workflows, breadth, asynchronous intervention | 35 | 43 | 38 | 43 | **39.75** |
| Tablet: orientation-inclusive exploration and genuinely touch-enhanced work | 47 | 55 | 54 | 56 | **53.00** |
| Small monitor and narrowed multitasking windows | 64 | 71 | 65 | 69 | **67.25** |
| Large monitor and continuously resized windows | 63 | 69 | 69 | 73 | **68.50** |
| Coherent adaptive/accessibility/design-system/collaboration delivery | 49 | 64 | 62 | 60 | **58.75** |
| Durable context → creation → many outputs → governed review/handoff | 67 | 84 | 83 | 84 | **79.50** |
| **Equal-weight role means** | **54.17** | **64.33** | **61.83** | **64.17** | **61.13** |

The Procurement Officer separately scored enterprise buying readiness at **56.17/100** under a stricter weighted purchasing rubric. Independent designer and engineer assessments informed the design but were not silently mixed into the four-role score matrix; the Lead Designer gave a separate, differently defined overall design judgment of **58/100**.

**Decision:** Invest first in the usability and attention layer above a substantially stronger existing content-and-governance foundation. Do not represent unrestricted enterprise deployment as procurement-ready until identity, tenant offboarding, recoverability, and independent accessibility evidence satisfy explicit gates.

## What Forma already does well

The current implementation must be evaluated as it exists now, not as an older reassessment described it.

1. **One durable creative project and document support many genuine outputs:** images, stories, scenes, presentations, storyboards, and video.
2. **Seven document lenses address the same durable document:** Document, Context board, Guided brief, Reality layers, Adaptive path, Creative editor, and Chat.
3. **Six distinct applications already enforce audience and authorization boundaries:** Creator Workspace, Canvas, Platform Operations, Product & Quality, Design & Knowledge, and Engineering Diagnostics. An exact-resource public review link is a boundary, not a seventh signed-in application.
4. **Meaningful container queries already exist** for Studio, Chat, Library, and Canvas-card presentation; this is not a project starting from zero responsive capability.
5. **Editable PowerPoint and Word export are already implemented.** PowerPoint exports retain speaker notes; finished slide decks also support actual PDF export, style variants, and slideshow/list presentation.
6. **Artifact revision bodies, history, preview, and restoration already exist.** Revision restoration creates a new revision and must pass review policy again.
7. **Independent review is real:** exact reviewer entitlement, source-version freshness, review-request state, and self-approval exclusions are enforced.
8. **Scoped project notifications already exist** in the database, server, and store; the principal gap is user-facing delivery and exact-task navigation.
9. **Organization retention policies, legal holds, named pilot cohorts, budget controls, and provider reservations already exist** with important scope and deployment qualifications.
10. **Localization, Arabic/RTL, responsive dialog constraints, semantic links, reduced-motion handling, focus behavior, and ordinary 44px shared controls** are valuable design-system assets.

Primary local evidence:

- `/Users/westbrook/Documents/repos/codex/src/platform/applications.ts:43`
- `/Users/westbrook/Documents/repos/codex/src/model/routes.ts:1`
- `/Users/westbrook/Documents/repos/codex/src/design-system.css:3434`
- `/Users/westbrook/Documents/repos/codex/src/components/presentation-deck.ts:27`
- `/Users/westbrook/Documents/repos/codex/src/components/document-artifacts.ts:64`
- `/Users/westbrook/Documents/repos/codex/src/components/document-artifacts.ts:170`
- `/Users/westbrook/Documents/repos/codex/worker/artifact-review.ts:34`
- `/Users/westbrook/Documents/repos/codex/worker/project-notifications-api.ts:8`
- `/Users/westbrook/Documents/repos/codex/db/schema.ts:76`

> “I give Forma real credit for independent approvals, source-bound exports, editable PowerPoint speaker notes, and recoverable revisions; those capabilities are implemented, not aspirational.” — **Procurement Officer**

## Verified current-state failures

### 1. The phone loses search precisely when search becomes essential

At widths of 480px and below, the design system explicitly hides the global command/search trigger. Live inspection at **390 × 844** found that its actual bounding box is **0 × 0**. The remaining Cmd/Ctrl+K path is not a touch-only equivalent. The existing responsive test actively asserts that the control disappears.

- `/Users/westbrook/Documents/repos/codex/src/design-system.css:3651`
- `/Users/westbrook/Documents/repos/codex/src/components/forma-shell.ts:35`
- `/Users/westbrook/Documents/repos/codex/tests/responsive-layout.test.mjs:200`

> “Hiding search on the device with the least room to browse is a design contradiction, not a responsive strategy.” — **Lead Designer**

### 2. Mobile hides the visible Ask/Send action and deep collections

At widths of 760px and below, CSS suppresses the visible `.composer .ask` button. It also forces `.collection-tree ul { display: none !important; }`, while actual child collections exist exclusively in those nested lists. This is removal of customer functionality, not progressive disclosure.

- `/Users/westbrook/Documents/repos/codex/src/styles.css:1163`
- `/Users/westbrook/Documents/repos/codex/src/styles.css:1167`
- `/Users/westbrook/Documents/repos/codex/src/styles.css:1178`
- `/Users/westbrook/Documents/repos/codex/src/components/collection-tree.ts:67`

> “If a collection exists on my desktop but disappears on my phone, the mobile experience is not simpler; it is broken.” — **End User**

### 3. Existing notifications cannot reliably bring someone back to work

The server already persists recipient- and project-scoped events. However, the user interface renders them only in the ordinary document workspace, only for its current shared document, and at most four at a time. Activating an item merely acknowledges it rather than opening its exact artifact, source change, or requested review. Projects, Canvas, Library, Chat, and other document lenses have no equivalent durable activity destination.

Shared event coverage also misses important image-generation completion/failure and document-render failure scenarios. No implemented browser/service-worker push channel was identified; browser visibility-aware polling and ephemeral toasts are not equivalent to durable background delivery.

- `/Users/westbrook/Documents/repos/codex/src/components/forma-workspace.ts:234`
- `/Users/westbrook/Documents/repos/codex/src/components/forma-workspace.ts:244`
- `/Users/westbrook/Documents/repos/codex/src/state/store.ts:369`
- `/Users/westbrook/Documents/repos/codex/worker/runtime.ts:62`

> “If a reviewer has to open the exact document mode that happened to render a notification, we have built an event log, not collaboration.” — **Product Owner**

> “A notification that disappears when tapped, without taking me to the artifact that needs my decision, is an interruption—not a workflow.” — **Design Engineer**

### 4. Phone landscape and split-screen height are not first-class states

The shell's actual global header measured **64px**. Canvas requires a minimum **34rem / 544px** work region, Chat requires at least **620px**, and the Creative Editor starts around **590px**. These minimums already exceed many 320–430px landscape phone viewports before the application and browser chrome are counted.

- `/Users/westbrook/Documents/repos/codex/src/canvas/canvas.css:18`
- `/Users/westbrook/Documents/repos/codex/src/styles.css:1456`
- `/Users/westbrook/Documents/repos/codex/src/styles.css:1635`

> “A landscape phone is a constrained-height workstation, not a squashed portrait phone.” — **Product Owner**

### 5. Chat becomes a tall image billboard before it becomes a conversation

At content widths below 840px, Chat stacks a **620px** image preview above a **680px** conversation. Even narrower configurations still require roughly **520px + 620px**. A 1024px tablet or laptop with a fixed 240px project rail has only about 784px of working width, so this failure appears even in nominally comfortable landscape layouts.

- `/Users/westbrook/Documents/repos/codex/src/styles.css:1697`
- `/Users/westbrook/Documents/repos/codex/src/components/forma-chat-studio.ts:39`
- `/Users/westbrook/Documents/repos/codex/src/components/forma-chat-studio.ts:52`

> “Do not make me scroll past a 620-pixel image just to reach the conversation I came here to have.” — **Tablet End User**

> “An image preview I must scroll past before I can reply is a billboard, not a collaborator.” — **Small Monitor End User**

### 6. Tablet layouts surrender too much space to navigation

Between 761px and 1200px, the Creator/Library project rail is fixed at **240px**. An 834px portrait tablet therefore has roughly 594px left for work. Studio collapses context and results when its actual container is at most **992px**, so even a 1194px landscape tablet can fail to present its two most useful panes if the rail remains open.

- `/Users/westbrook/Documents/repos/codex/src/design-system.css:3468`
- `/Users/westbrook/Documents/repos/codex/src/design-system.css:3475`

> “When I hold the tablet upright, I want the document—not a 240-pixel project rail—to own the screen.” — **Tablet End User**

### 7. Generic shared buttons are correctly sized; particular important controls are not

The later-loaded design-system stylesheet correctly raises ordinary `.button`, `.button.compact`, and `.icon-button` controls to **44px**. It would be incorrect to cite earlier base-stylesheet values as rendered generic-button defects. Nevertheless, direct running-browser measurements and source identify actual exceptions:

| Control | Observed/declared effective size | Required project contract |
| --- | ---: | ---: |
| Account avatar | **32 × 32px** | At least 44 × 44px |
| Brand action at phone width | Approximately **40 × 30px** | At least 44 × 44px |
| Visible compact search | Approximately **42 × 42px** | At least 44 × 44px |
| Project rail disclosure | Approximately **36px** high | At least 44px |
| Narrow document actions | Approximately **40px** wide | At least 44px |
| Canvas history controls | Approximately **32px** high | At least 44px |
| Canvas resize handles | Approximately **25px** | At least 44px effective hit area |
| Spatial editing handles | Approximately **10–16px** on some axes | At least 44px effective hit area |

The minimum in WCAG 2.2 AA is not categorically 44px: [WCAG 2.2 target-size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) describes a **24 × 24 CSS-pixel** minimum with conditions and exceptions, while [enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) describes **44 × 44**. Forma's own more ambitious internal design contract requires 44px for relevant controls.

- `/Users/westbrook/Documents/repos/codex/src/design-system.css:55`
- `/Users/westbrook/Documents/repos/codex/src/design-system.css:107`
- `/Users/westbrook/Documents/repos/codex/src/styles.css:185`
- `/Users/westbrook/Documents/repos/codex/src/design-system.css:519`
- `/Users/westbrook/Documents/repos/codex/src/canvas/canvas.css:20`
- `/Users/westbrook/Documents/repos/codex/src/canvas/canvas.css:42`

> “A 44-pixel design token is not accessibility evidence when the actual region-edit handle is ten pixels.” — **Market Researcher**

### 8. Canvas does not deliver the defining interactions of a touch-first workspace

The board handles single-pointer pan/drag and Ctrl-modified wheel zoom. No actual two-touch centroid/distance pinch recognizer was identified. Multiple selection depends on Shift in important paths, and stylus strokes currently commit an empty pressure array despite a model that supports pressure.

- `/Users/westbrook/Documents/repos/codex/src/canvas/canvas-application.ts:319`
- `/Users/westbrook/Documents/repos/codex/src/canvas/canvas-application.ts:327`
- `/Users/westbrook/Documents/repos/codex/src/canvas/canvas-application.ts:356`
- `/Users/westbrook/Documents/repos/codex/src/canvas/canvas-application.ts:381`

> “A pencil should draw, two fingers should move the board, and none of that should depend on owning a keyboard.” — **Tablet End User**

> “My thumb needs every tool my mouse gets; I do not have a Shift key attached to my finger.” — **Smart Phone End User**

### 9. Genuine cross-account live presence does not work

The `BroadcastChannel` name includes the current user's own ID. Different users therefore subscribe to different channels, while messages from the same user are filtered. An independent safe, in-memory three-client probe found no peers across different users or a second tab for the same user. Browser-local channels also cannot provide cross-device transport.

Durable board edits can still synchronize through existing server polling; that must not be confused with genuine ephemeral live presence.

- `/Users/westbrook/Documents/repos/codex/src/canvas/presence.ts:6`
- `/Users/westbrook/Documents/repos/codex/src/canvas/canvas-application.ts:148`

> “If Forma draws collaborator cursors but two real collaborators can never see each other, that is not collaboration.” — **Large Monitor End User**

### 10. Existing responsive tests prove CSS patterns, not user success

The reviewed responsive suite reads source/CSS text and applies regular expressions. It does not run cross-browser viewport interaction, calculate target sizes, open a virtual keyboard, rotate a device, or prove a reviewer can complete an exact authorized task. The same tests currently pass while enforcing the hidden phone command trigger.

- `/Users/westbrook/Documents/repos/codex/tests/responsive-layout.test.mjs:5`
- `/Users/westbrook/Documents/repos/codex/tests/responsive-layout.test.mjs:200`

> “A passing regular-expression test proves that a selector exists; it does not prove that a human can finish a task.” — **Design Engineer**

### 11. Stale-write messaging can misreport successful saves and create duplicates

During the authorized end-user reporting exercise, project creation, document renaming, and document creation sometimes displayed “The document changed elsewhere. Its latest state is now loaded; try that change again” even though the requested change had already committed. Final full-page verification revealed that retrying the initial apparent project-creation failure created **two separate same-title research projects**; following the same document-creation advice also produced **four duplicate role documents inside the fully populated project**. Pre-existing projects were not modified, and neither the extra research project nor the duplicate documents were deleted without separate authorization.

The event store sends an expected stream sequence and performs only two default rebase attempts; the project-document dialog creates a document plus an empty-canvas event as one batch. The user-visible error does not establish whether an earlier operation committed. Collaborative creativity cannot rely on users guessing whether Save succeeded: introduce client mutation identifiers, server-side idempotency, authoritative acknowledgment/reconciliation, visible pending versus confirmed states, and conflict tests proving that retry never creates a duplicate document.

- `/Users/westbrook/Documents/repos/codex/src/state/store.ts:720`
- `/Users/westbrook/Documents/repos/codex/src/components/forma-project-contents.ts:14`

## Live running-application measurements

The authenticated development application was inspected without changing existing projects. Seven viewport shapes were applied to the Projects page; the viewport was restored afterward. No page-level horizontal overflow was observed on that page.

| Context | Actual viewport | Header | Search | Account avatar | Main lesson |
| --- | --- | ---: | --- | --- | --- |
| Phone portrait | 390 × 844 | 64px | Present but **0 × 0**, not visible | **32 × 32** | Core global capability is gone. |
| Phone landscape | 844 × 390 | 64px | Visible, **42 × 42** | **32 × 32** | Height and targets require independent handling. |
| Tablet portrait | 834 × 1194 | 64px | Visible, **42 × 42** | **32 × 32** | Width alone does not establish touch readiness. |
| Tablet landscape | 1194 × 834 | 64px | Visible, approximately 277 × 42 | **32 × 32** | Navigation consumes scarce work-container width. |
| Narrow laptop | 912 × 700 | 64px | Visible, **42 × 42** | **32 × 32** | Snapped windows deserve the same capability, not a weaker product. |
| Desktop | 1440 × 900 | 64px | Visible, approximately 277 × 42 | **32 × 32** | Available work regions, not physical screen class, determine layout. |
| Large display | 1920 × 1080 | 64px | Visible, approximately 277 × 42 | **32 × 32** | Extra width should reveal useful relationships rather than merely expanding margins. |

These measurements describe this route and observed browser, not every component or every device. The Canvas presence finding was independently verified using an in-memory test, not an unauthorized account-access attempt.

## Negotiated stakeholder decisions

### Stable destination names win over opaque adaptation

The Product Owner proposed `Projects / Work / Explore / Activity / Deliver`; the smartphone stakeholder wanted directly recognizable Projects, Work, Library, Inbox, and More; the Lead Designer wanted a unified project experience and intelligible mode families. The resolved structure is:

| Stable destination | Job | What it reveals | Phone first action |
| --- | --- | --- | --- |
| **Projects** | Find or resume the right authorized project. | Project identity, recent work, shared roles, current obligations, collections. | Resume or search a project. |
| **Work** | Make decisions and develop the current document. | Document, Guided, Board, Layers, Adaptive, Editor, Chat; all preserved exact routes. | Open the current task with a visible primary action. |
| **Explore** | Browse and connect relevant project material. | The **Library** as its default landing, full-depth collections, references, authorized Canvas, Scout, Taste & time. | Open Library/search in one tap. |
| **Activity** | Know what completed, failed, or requires a person. | Principal-scoped inbox, private jobs, review requests, approved-safe collaboration, resumable tasks. | Open “Needs you” in one tap. |
| **Deliver** | Finish, review, present, export, and reuse outputs. | Images, stories, scenes, decks, storyboards, video, revision history, independent approvals. | Open the exact latest or assigned deliverable. |

Destination meaning and ordering remain stable. Visual presentation can move from bottom dock to side rail or full navigation. `Explore` should clearly announce “Library, Canvas, and more” rather than making Library a guessing game; `Activity` should also expose the familiar “Inbox” accessibility/name vocabulary without becoming a differently named destination by device. Account settings, organizations, authorized specialist apps, and keyboard commands stay available but do not occupy a sixth creator-navigation slot.

### Three mode families organize seven preserved working lenses

| Family | Job | Existing preserved capabilities |
| --- | --- | --- |
| **Write** | Understand, author, and discuss the document. | Document, Guided brief, Chat, and relevant Creative Editor tools. |
| **Shape** | Arrange relationships and inspect visual direction. | Context board, Reality layers, Adaptive path, Creative Editor, and an explicitly authorized project-Canvas handoff. |
| **Present** | Inspect results, compare, review, and hand off. | Output readers, slideshow, storyboard, revision history, source-aware review, export, and the `Deliver` projection. |

An individual exact document lens can logically belong to more than one family; do not duplicate state or change its route. The user explicitly chooses a lens. Adaptation may explain a useful option but never silently navigates, edits, generates, spends, approves, or changes sharing.

> “Seven equally promoted editing modes are an implementation inventory masquerading as a customer journey.” — **Product Owner**

> “Forma should remember my work, not make me remember which of seven tabs currently understands it.” — **Lead Designer**

### A “global” inbox is global to an authorized person, not to all projects

Resolve the procurement objection by making the aggregation server-owned, principal-scoped, recipient-scoped, and individually revalidated for each organization/project/resource. Actor-private job details and personal AI conversations do not become shared activity. Counts, preview text, ordering, cached results, deep links, notification subscription state, and stale review actions must fail closed on revocation.

Lock-screen previews should default to generic text. Notification clicks only open the exact task; they never spend, approve, export, publish, change access, or transmit private source material.

> “Global attention must mean everything this specific person is currently authorized to see—not an invitation to leak project names, provider payloads, or someone else’s work.” — **Market Researcher**

### Product unity must not erase security boundaries

Creator and Canvas can feel like two stances toward one project while their separate entry points, application grants, exact shared-project permissions, owner-scoped data, and public-share isolation remain intact. Specialist applications inherit the adaptive primitives but never hydrate private creator documents.

> “An adaptive interface may change its posture; it must never change the identity, authority, or meaning of the work.” — **Product Owner**

## The adaptive capability model

Avoid device sniffing and assuming a wide viewport is a desktop or a narrow window is a phone. Four independent signals determine presentation:

1. **Shell viewport inline size** chooses bottom dock, compact side rail, expanded navigation, or a panoramic project workbench.
2. **Actual content-container inline size** determines whether an individual work surface can support one, two, three, or four meaningful panes.
3. **Available block size** handles landscape phones, split screens, small laptops, virtual keyboards, and safe-area insets separately from width.
4. **Input/accessibility capabilities** include coarse/fine/mixed pointer, pen where supported, hover, hardware/software keyboard, writing direction, text scaling, reduced motion, and forced colors.

Suggested initial engineering bands, to be validated by real tasks rather than treated as hardware identity:

| Signal | Initial classes |
| --- | --- |
| Shell viewport width | `<480`, `480–767`, `768–1023`, `1024–1439`, `≥1440` CSS px |
| Actual work-container width | `<360`, `360–599`, `600–839`, `840–1199`, `≥1200` CSS px |
| Available height | `≤480`, `481–720`, `>720` CSS px |
| Control hit target | At least `44 × 44px`; prefer `48px` for coarse-pointer primary tasks. |
| Expanded project navigation | Approximately `200–240px`, only when the work stage remains useful. |
| Compact project rail | Approximately `56–72px`; use an explicitly named drawer at smaller sizes. |
| Selected context/review pane | Approximately `280–360px`, only when the primary work retains roughly `520–640px`. |
| Wide optional Activity lane | Approximately `260–320px`, user-controlled and scope-filtered. |

Use CSS Grid named regions, logical properties, shared design tokens, named container queries, targeted `subgrid` where repeated alignment actually benefits, and a small Lit reactive layout controller only for semantic capability transitions. Use `ResizeObserver` and `visualViewport` judiciously; avoid synchronous geometry loops, user-agent classification, or one window listener per component.

> “The viewport tells the shell how to spend space; the container tells the work surface what it can actually afford.” — **Design Engineer**

## Screen-real-estate priorities by posture

### Phone portrait: one complete task, never a smaller product

- Use a roughly 48–52px project/document scope bar and a 56–64px safe-area-aware task dock.
- Keep Projects, Work, Explore, Activity, and Deliver visibly labeled and consistently ordered.
- Keep global Search visible and touch-operable.
- Show the current object, truthful saving/offline/queued state, and exactly one clearly labeled primary action.
- Put complete project hierarchy, all seven views, filters, sources, review, and inspector detail behind clearly labeled accessible sheets.
- Open Chat to the conversation and visible Send control, not a 520–620px image banner.
- Show presentations in readable linear/text or large single-slide view, with visible Previous/Next alternatives.
- Keep review requests, completed outputs, failures, and necessary intervention one tap away through Activity.

> “I do not need every tool on screen, but I do need confidence that every tool still exists.” — **Small Monitor End User**

> “Search is more important on a small screen, not less.” — **Smart Phone End User**

### Phone landscape: a short-height workstation

- Treat available height as the scarce resource, even when width looks tablet-like.
- Merge scope, search, activity, and primary status into one approximately 44–48px bar.
- Move persistent navigation to a compact logical-start rail rather than stacking independent top and bottom bars.
- Give at least roughly 70–72% of available height to the work surface where feasible.
- Offer a context/result split only when both sides remain legible; otherwise use one named reversible panel.
- Remove fixed 544–680px content minimums and preserve active input above the virtual keyboard.

> “Turning my phone sideways should give my work more room, not reveal a desktop interface that no longer fits vertically.” — **Smart Phone End User**

### Tablet portrait: purposeful exploration without a permanent rail tax

- Default to a 56–72px compact rail or a project drawer instead of reserving 240px continuously.
- Preserve at least approximately 520px of primary working width where the total container allows it.
- Provide a touch-friendly selected-context sheet, meaningful large previews, full-depth collections, and immediately visible Activity.
- Support deliberate additive touch selection, anchored comments, accessible non-drag alternatives, and stylus enhancement where tested.
- Keep the same breadth of document lenses, output families, review, and source context as other postures.

### Tablet landscape: two genuine panes before three decorative ones

- Default to primary work plus a useful supporting pane: document/result, source/editor, conversation/preview, library/object, or board/inspector.
- Add a third region only when the primary stage retains roughly 560px or more.
- Support actual two-pointer pan/pinch, pen mode where supported, large touch handles, object-anchored comments, and visible alternatives.
- Suggest rotation only when a specific operation materially benefits; never require it to finish the job.

> “Landscape should let me see what I am changing and what that change produced at the same time.” — **Tablet End User**

### Small monitor or snapped window: full capability with one chosen supporting pane

- A narrow desktop window keeps keyboard-first commands, complete authoring, mouse/trackpad precision, and touch support where present.
- At roughly 800 × 600, protect at least approximately 360px or 60% of useful working height.
- Keep top chrome near 96px maximum in short-height modes and the composer roughly 64–80px.
- Let the user choose Context, Result, Inspector, Compare, or Activity; do not vertically stack two viewport-height regions.
- Preserve pane choice, draft text, selection, scroll, exact resource identity, and activity state during resizing.

> “A half-width window is not a half-capable application.” — **Small Monitor End User**

> “When I drag the window narrower, don’t drag my train of thought with it.” — **Small Monitor End User**

### Large monitor: reveal relationships, not merely larger margins

- At approximately 1440px, preserve project navigation, a meaningful work surface, and one chosen inspector where possible.
- At approximately 1920px, progressively reveal project navigation, sources/context, central work, inspector, and scoped Activity.
- At 2560px and wider, support useful source/current-result/revision/second-result comparisons and a user-pinned review lane.
- Cap prose measure, not the entire application workspace; do not trap a tall-screen editor at a 780px maximum.
- Let users intentionally collapse, resize, or pin regions. A narrow browser on a huge monitor uses the narrow-window layout.

> “The current document, its source passages, its generated outputs, and its approval history are one chain of work; show me the chain.” — **Large Monitor End User**

> “White space is useful around a paragraph; an empty third of my monitor is not a product feature.” — **Large Monitor End User**

## Complete page-by-page feature allocation

Priority definitions: **P0** is visible immediately in the initial meaningful work region; **P1** is available through one clearly labeled action; **P2** is secondary but never absent or undiscoverable. Phone and tablet cells explicitly distinguish **P**ortrait and **L**andscape. Laptop and large-monitor behavior always derives from actual window/container space, not hardware identity.

### Creator, project, document, and review surfaces

| Surface / route family | Phone portrait / landscape | Tablet portrait / landscape | Small monitor / snapped window | Large monitor / resizable window |
| --- | --- | --- | --- | --- |
| **Global authenticated shell** | P: project scope, search, five-task bottom dock, Activity badge; L: one short top bar and compact side dock. P1 full project drawer. | P: icon rail + context sheet; L: compact rail + optional selected pane. P1 authorized app switch. | Stable project/document breadcrumb, command entry, one user-chosen pane, visible jobs/review. | Expand navigation, context, work, inspector, and optionally Activity only when the work stage remains useful. |
| **Projects** `/projects`, `/creative`, `/canvas/projects` | P: Resume, urgent review, search, compact rows, New; L: list + selected preview. P1 shared/project filters. | P: two-column project discovery; L: project grid + recent output/activity detail. | Search, compact portfolio, recent project, exact role, one-click resume; cards grow only with real room. | Project portfolio, recent outcomes, owner/role, actionable activity, selected preview; avoid blanket 1400px workspace cap. |
| **Project home** `/studio/project` | P: last document, Needs you, documents, New; L: list + selected result. P1 complete nested collection drawer. | P: documents + recent work with optional selection sheet; L: documents/collections + result/activity pane. | Current objective, document list, collection search, one useful preview, visible review/job state. | Project-world cockpit: collections, documents, boards, sources, results, collaborators, review and jobs. |
| **Baseline document** `/`, `/document/:id/:slug` | P: current decision/result, visible Ask/Send and state, Context/Result/Activity selector; L: compact work/result split. | P: primary work + selected-context sheet; L: document/context + current result. | Document and user-selected context/result pane; never force preview below long context lists. | Pinned document, verified source/context, current result, review/revision inspector, optional activity lane. |
| **Context board** `/studio/board`, document `/view/board` | P: one named lane, current decision, Add; L: one/two lanes + details. P1 complete lane list. | P: touch-readable lanes and add controls; L: multiple lanes + selected decision/output. | One or two useful lanes; keyboard-operable move/inspect and explicit source access. | All meaningful lanes, source context, current result, selected decision relationships and review. |
| **Guided brief** `/studio/guided`, document `/view/guided` | P: one question, progress, Save/Continue; L: question + concise evidence. | P: current answer with outline sheet; L: interview + source/brief preview. | Current step + chosen context/outline; visible save/undo and rights checks. | Question/answer history, full authored brief, evidence, gaps, output/readiness preview. |
| **Reality layers** `/studio/layers`, document `/view/layers` | P: selected layer + useful preview; L: result + narrow layer pane. P1 full stack and reorder. | P: preview + touch layer sheet; L: preview + layer stack + optional inspector. | Selected result + layers; properties in a reversible drawer when narrow. | Stage, source material, full layer stack, inspector, output comparison and explicit review state. |
| **Adaptive path** `/studio/adaptive`, document `/view/adaptive` | P: one explained next step, manual override, current result; L: step + compact context. | P: focused recommendation; L: recommendation + source or result. | Stable user-selected task, rationale, alternatives, no automatic navigation. | Multiple explainable options beside source, resulting changes, and current work; no unsolicited edits or spend. |
| **Creative editor** `/studio/editor`, document `/view/editor` | P: selected item/plan, Save/undo, visible action; L: stage + one tools/properties pane. | P: stage + touch-safe properties sheet; L: stage + tools/inspector when useful. | Primary editor plus one optional pane; preserve at least approximately 600px central stage where possible. | Tools, full-height stage, selected-item inspector, source context, history and review; remove arbitrary height ceiling. |
| **Chat** `/studio/chat`, document `/view/chat` | P: conversation first, Send above keyboard, compact result; L: short-height conversation/result split. | P: thread + expandable preview; L: thread + result simultaneously. | Thread + optional preview only if both remain useful; no 620px + 680px vertical tower. | Thread, source/decision context, selected visual outcome, private job state, authorized results. |
| **Any document focus** `/document/:id/.../focus` | P/L: current exact document, essential task, exit, saving/activity indicator. | P/L: same resource, selected object, optional temporary inspector; rotation preserves draft. | User-selected reduced chrome, keyboard exit, one chosen supporting panel. | Intentionally simplified or multi-pane focused arrangement chosen by the user, never a different permission set. |
| **Source intake / rights** embedded source workflows | P: attach/capture/paste, explicit rights, blocking issue; L: source + confirmation. | P: large excerpt and selected anchor; L: source + authored derived decision. | Source excerpt, rights, selected document, actionable errors; keyboard accessible. | Multiple source passages, rights/expiration, extracted anchors, affected decisions and output impact. |
| **Generation / queue / recovery** embedded operations | P: exact task, explicit consent/cost, queued/running/failed, direct result; L: compact job/details split. | P: action sheet and visible pending state; L: job tray beside work. | Persistent activity badge, exact job failure/recovery, no duplicate submission. | Optional production lane with scoped jobs, failures, safe recovery, context freshness and review readiness. |
| **Output composer** embedded story/scene/slides/storyboard/video | P: type, required settings, exact consent, Create; L: settings + compact safe preview. | P: format + relevant fields; L: complete settings beside source/result. | All formats and meaningful cost/rights warnings remain visible or one action away. | Configurator, verified source/context, audience/tone, safe preview, output history, release prerequisites. |
| **Finished artifact / independent review** exact artifact viewer | P: readable output, version/freshness, eligible Approve/Request changes; L: content + compact review sheet. | P: large reader and direct review; L: artifact + source changes/revision inspector. | Exact output, source freshness, reviewer eligibility, revision change, clear action. | Source evidence, output, revision comparison, comments, independent approval, release/export policy together. |
| **Slides / slideshow** finished slide decks | P: readable linear or single-slide view, visible Prev/Next, review; L: large slide, compact notes. | P: tap/swipe plus visible alternatives; L: stage + filmstrip + speaker notes. | Outline or thumbnails + current slide, notes, approved PDF/PPTX export. | Filmstrip, large slide, speaker notes, source references, revision/review lane and export. |
| **Storyboard / video** finished visual outputs | P: readable frame/player, captions/notes, current review action; L: stage + compact sequence. | P: touch frame sequence; L: neighboring frames or player + notes. | Current frame/scene + one selected source/review pane. | Sequence, stage, source/continuity evidence, selected item, notes and review; no implied paid media creation. |
| **Public share** `/share/:token` | P: exact approved output first, read-only/expiry state, accessible controls; L: clean wide stage. | P: readable output; L: output + explicitly authorized context only. | Exact shared object and presentation; no account/global navigation. | Large presentation and approved scoped context; no private prompts, account data, unrelated projects or unapproved downloads. |

### Exploration, Library, continuity, and account surfaces

| Surface / route family | Phone portrait / landscape | Tablet portrait / landscape | Small monitor / snapped window | Large monitor / resizable window |
| --- | --- | --- | --- | --- |
| **Explore / Library** `/library`, `/canvas/library` | P: search, project scope, type chips, reusable result; L: list + selected detail. P1 every collection depth. | P: visual browse + object sheet; L: collection rail + gallery + object preview when room allows. | Fast faceted search, one preview, keyboard reuse, predictable return to current document/board. | Collections, source context, every output family, gallery, selected item, relations and review. |
| **Focused reusable block** `/library/block/:id` | P: actual content, rights, Use/Edit; L: content + linked output. | P: block + source sheet; L: selected block + evidence/related outcomes. | Reusable decision and explicit destination without losing active document. | Block, source evidence, related documents/results, authority and revision impact. |
| **Focused generated image** `/library/output/:id` | P: contain-fit image, source document, Keep/Use; L: image + compact details. | P: full image and visible alternatives; L: image + source/review/compare pane. | Large image + keyboard-operable context/reuse. | Image, variants, source context, allowed receipt, reuse and independent review. |
| **Focused deliverable** `/library/artifact/:id` | P: readable output, review state, exact action; L: result + notes. | P: output and approval sheet; L: selected artifact + notes/revision/source. | Stage + one chosen review/history pane; authorized exports remain reachable. | Deliverable, versions, source decisions, review comments, current approval and export. |
| **Aesthetic family** `/library/family/:id` | P: strongest member, honest inferred-group label, Keep/Correct; L: two-up comparison. | P: swipe with visible controls; L: member grid + selected evidence. | Comparable members and clear explanation without treating inference as authored truth. | Related outputs, side-by-side comparison, source context, correction and intentional collection creation. |
| **Reusable-block editor** `/library/blocks/editor/new`, `/library/blocks/editor/:id` | P: edit content/type, Save, rights; L: editor + selected source. | P: editor + context sheet; L: browser/editor + optional filing pane. | Main editor + one supporting context, keyboard-safe save and predictable return. | Browser, editing surface, source/relation inspector, filing and affected-output preview. |
| **Re-entry** `/sessions` | P: one best Resume plus pending obligation; L: queue + compact selected preview. | P: resumable work cards; L: queue + document/result. | Current session continuation, recent work and scoped jobs. | Authorized continuation history, cross-project pending work, selected context and outcomes. |
| **Scout** `/scout` | P: one actionable finding, evidence, cost and Apply/Dismiss; L: finding + source. | P: touch-browsable options; L: option + supporting evidence/result. | Ranked findings, exact budget and explicit promotion; no autonomous mutations. | Multiple alternatives, bounded investigation, provenance, outcome comparison and user-controlled decision. |
| **Taste & time** `/memory` | P: authored preferences/reminders, private-data scope; L: preference + evidence. | P: explorable preference cards; L: preference + visual/source evidence. | Authored-vs-inferred distinction, reversible updates, reminder control. | Preference history, supporting examples, resurfacing, reversible inference and current creative relevance. |
| **Activity / Inbox** proposed principal-scoped destination | P: Needs you, Ready, Updates; exact object deep link; L: queue + selected task. | P: touch triage; L: queue + selected artifact/context. | Global keyboard-friendly list/detail and scoped badge; never auto-acknowledge before action. | User-controlled persistent project/review lane, approved-safe cross-project grouping and direct task context. |
| **Personal settings** `/settings` | P: privacy, spend, notifications, shares; L: section list + detail. | P: legible settings; L: category navigation + detail. | Complete policies and user-controlled layout/notification preferences without inaccessible tables. | Policy navigation, usage/active shares, privacy details and authorized scoped audit. |
| **Organizations / invitations** `/settings/workspaces`, `/settings/workspaces/invitations` | P: pending invite, organization/project, exact role, Accept/Decline; L: list + role details. | P: organization/invitation cards; L: selected invitation + existing access. | Searchable organizations, shared project, explicit role and reviewer eligibility. | Organization/project portfolio, roles, pending invitations and authorized audit context. |
| **Organization overview** `/settings/workspaces/:id/overview` | P: exact organization, own role, urgent action; L: summary + selected detail. | P: project/member/budget overview; L: organization + selected project. | Action-first organization dashboard without hidden permissions. | Organization status, policies, pilot, budget, shared projects and exact project access together. |
| **Members** `/settings/workspaces/:id/members` | P: searchable cards, identity, role, safe action; L: list + selected member. | P: member cards; L: member list + project/reviewer access. | Complete keyboard-accessible member detail, current role, safe confirmation. | Membership matrix, reviewer eligibility, project access, pending invitations and exact audit. |
| **Organization projects** `/settings/workspaces/:id/projects` | P: project, exact role, open and reviewer status; L: list + access detail. | P: shared project cards; L: project + members/reviewer grants. | Project and permitted member/reviewer actions stay visible. | Project/member authorization matrix, reviewer separation and selected activity. |
| **Organization usage** `/settings/workspaces/:id/usage` | P: remaining budget, reservations, urgent decision; L: summary + charge detail. | P: accessible usage cards; L: budget + permitted participant/project breakdown. | Budget policy, current commitments and exact next action. | Allocations, reservations, user/project breakdown and spend-safe operational evidence. |
| **Organization activity** `/settings/workspaces/:id/activity` | P: current security/review/access event; L: list + safe event detail. | P: scoped timeline; L: timeline + selected evidence. | Filterable authorized activity and locally scrollable details. | Project/actor/action history, bounded audit, permission-aware filters and selected evidence. |

### Canvas and separately authorized specialist surfaces

| Surface / route family | Phone portrait / landscape | Tablet portrait / landscape | Small monitor / snapped window | Large monitor / resizable window |
| --- | --- | --- | --- | --- |
| **Canvas home** `/canvas` | P: current project, last board, activity, Open/Create; L: board list + preview. | P: meaningful board gallery; L: boards + current-project/result preview. | Board list, exact project scope, latest change and searchable open. | Project boards, recent sources, output/review state, selected preview and activity. |
| **Spatial board** `/canvas/:id/:slug` | P: board, project identity, truthful offline/saved state, Add/select; L: edge-to-edge stage + compact side dock. | P: touch-native board + selected sheet; L: two-pointer board + optional source/inspector. | Board-first, accessible keyboard tools, one chosen pane, no hard height minimum. | Full board, source/library rail, selected inspector, authorized review/activity; genuine live presence only if implemented. |
| **Canvas list** `/canvas/:id/view/list` | P: semantic ordered item list, selection, search; L: list + selected object. | P: large touch rows; L: reading order + preview. | Keyboard list, filter, exact object source and explicit return to spatial board. | Searchable list, object preview, source/relationship/review details. |
| **Canvas comparison** `/canvas/:id/view/compare` | P: one readable item + visible Previous/Next; L: legible two-up. | P: touch compare; L: two large outputs + selected evidence. | Two-up only if both remain meaningful; preserve selection on resizing. | Multiple comparisons, synchronized fit, source differences, review and selection. |
| **Canvas folders** `/canvas/:id/view/folders` | P: full-depth drill-in, current path, folder items; L: path/list + selected item. | P: touch-accessible hierarchy; L: folder browser + content. | Complete collections via one chosen rail/drawer, not hidden nested nodes. | Collection hierarchy, selected object, source board placement and related outcomes. |
| **Canvas focus** `/canvas/:id/.../focus` | P/L: board + scope/sync, selected task, visible exit. | P/L: preserve object/camera and allow reversible inspector. | Keyboard-friendly board-first mode with explicit exit and status. | User-configured board/source/review arrangement with no loss of identity or authority. |
| **Canvas proposals** `/canvas/proposals`, `/canvas/proposals/:id` | P: one explained proposal + Accept/Reject when permitted; L: before/after. | P: proposal card + detail sheet; L: before/after + affected objects. | One proposal and contextual evidence; preserve shared-project restrictions. | Proposal queue, visual differences, source rationale and explicit reversible decision. |
| **Operations overview** `/operations`, historical `/system` | P: urgent service/release decision; L: list + incident. | P: triage; L: status + evidence. | Searchable incidents/owner/action with scoped data. | Concurrent incident, provider, evidence and approval lanes; never hydrate creator content. |
| **Operations providers / access / release** `/operations/providers`, `/operations/access`, `/operations/canvas` | P: current blocked capability and one authorized action; L: selected detail. | P: role-safe task cards; L: task + evidence. | Dense role-safe forms/tables with intentional local scrolling. | Governed provider, capability and release workbench; explicit authorization and signed approvals. |
| **Product insights / delivery** `/product/insights`, `/product/delivery` | P: most relevant aggregate or blocker; L: metric/decision + evidence. | P: cohort-safe overview; L: metric/initiative + decision. | Outcome funnel, dependency/ownership and privacy-safe segments. | Task completion by coarse posture/input, decision ownership, delivery dependencies and release evidence. |
| **Product evaluation / replay / adapters** `/product/evaluation`, `/replay`, `/adapters`, `/actual` | P: current permitted pass/fail or safe next action; L: detail + evidence. | P: explicit synthetic/actual boundary; L: approved scenario + result. | Authorized fixture/evidence navigation; no unapproved provider operations. | Side-by-side safe scenarios, evidence, rollout decisions and exact independent grants. |
| **Knowledge components / patterns / guidance / focal points** `/knowledge/*` | P: search + one accessible fictional example; L: example + contract. | P: touch-first component study; L: responsive pattern + implementation guidance. | Resizable synthetic component preview, target sizes, keyboard/RTL evidence. | Responsive pattern lab with multiple posture previews, tokens, a11y and fictional-only fixtures. |
| **Engineering health / events / sync / jobs** `/engineering/*` | P: urgent redacted incident and exact next action; L: list + selected diagnostic. | P: scoped health triage; L: status + evidence. | Searchable bounded diagnostic data, failed job/sync evidence, safe local table scroll. | Correlated authorized service health, event integrity, synchronization and job diagnostics; no private creator material. |

Legacy route aliases inherit their canonical page's P0/P1/P2 requirements and their exact authorization. Existing routes and dynamic resource families are cataloged at `/Users/westbrook/Documents/repos/codex/src/platform/applications.ts:288` and `/Users/westbrook/Documents/repos/codex/src/platform/applications.ts:363`.

## Touch, keyboard, accessibility, and orientation contract

1. Every essential action has a visible touch and keyboard path. Hover, long press, Shift-click, drag, and multi-pointer gestures are optional accelerators, not sole access mechanisms.
2. Native semantic links remain links; forms preserve explicit Save/Send buttons; modal sheets have programmatic names, focus containment where required, Escape/back behavior, and focus restoration.
3. Implement explicit tablet pointer coordination: one-finger select or intentionally chosen drag, two-finger camera pan/pinch, optional pen drawing, interruption-safe `pointercancel`, and visible zoom/fit/select alternatives.
4. Enlarge effective touch hit areas without requiring visually oversized handles or reducing surrounding content legibility.
5. Preserve document/project/board identity, view, selected object, current slide, unfinished text, chosen context, review revision, offline work, and focus through rotation and resizing.
6. Keep the current composer and primary Send/Save/Approve action visible above the soft keyboard and safe-area insets.
7. Support English, French, Arabic/RTL, coarse/fine/mixed input, assistive technology, reduced motion, forced colors, 200% text scaling, and relevant 400% reflow scenarios.
8. Offer an orientation hint only where it materially helps: “Landscape can show slides and notes together.” Never require rotation for ordinary access, review, editing, or approved export.
9. Provide alternatives for dragging and multipoint gestures consistent with [WCAG 2.2 dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [pointer gestures](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [orientation](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html), and [focus-not-obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

> “Recommend landscape when comparison benefits from it, but never tell me I must rotate before I can finish.” — **Tablet End User**

> “The application should adapt to the space I gave it, not the device it imagines I own.” — **Small Monitor End User**

## Notifications, human collaboration, and asynchronous intervention

### Typed activity

Group notifications into **Needs you**, **Ready**, and **Updates**.

- **Needs you:** requested independent review, requested changes, stale approval, failed generation/render, explicit budget or rights intervention, source conflict, offline-sync conflict, relevant invitation, revoked/changed access, or authorized specialist incident.
- **Ready:** completed images, prompt fans, stories, scenes, presentations, storyboards, video, source processing, approved outputs, or recoverable job outcomes.
- **Updates:** bounded relevant collaborator changes, context changes, comments, source updates, completed review state, and permitted project activity.

Separate three security categories:

1. Actor-private generation jobs, chat, failure diagnostics, and sensitive input receipts.
2. Recipient-safe, exact-project collaboration notices with current membership and reviewer-role verification.
3. Independently authorized account/organization/specialist operational notices.

Every actionable item exposes a safe human-readable category, authorized project/resource identity, current status, event time, exact canonical resource link, valid reviewer/action state, and an explicit read/dismiss operation. Never mark it handled just because a toast appeared. Never disclose inaccessible projects through counts, grouping, preview text, or timing side channels.

### Human annotation

Existing domain events already support annotations. Build an exact-project, object-anchored comment surface for documents, decisions, outputs, slides, storyboard frames, and Canvas objects. Finger, pen, keyboard, and assistive technology must all provide equivalent creation and reading. Separate comment resolution from output approval and keep actor-private AI chat private.

### Honest live presence

Do not market same-user `BroadcastChannel` or durable polling as live cross-account cursors. Add real presence only with authenticated project/board transport, explicit permission, ephemeral retention, reconnect/expiry semantics, rate limiting, and immediate revocation. Preserve the usefulness of ordinary durable editing even if live presence ships later.

### Optional background delivery

Ship the durable in-product inbox first. Any browser/push/device notification later requires explicit contextual opt-in, support detection, privacy-safe lock-screen content, revocable subscriptions, appropriate quiet hours, and realistic delivery statements. A notification never triggers approval, export, publishing, provider spend, or data sharing automatically.

> “The image finished after I locked my phone; tell me, and take me straight to the result.” — **Smart Phone End User**

> “I want one entitlement-aware inbox across Projects, Library, Canvas, and document work—not a separate notification implementation for every screen size.” — **Procurement Officer**

## Design-system and implementation architecture

### Stable object contract

```text
Authenticated principal
  └── Authorized project
      ├── Authored collections and source evidence
      ├── Durable documents and seven exact working lenses
      ├── Separately authorized project boards
      ├── Images, stories, scenes, presentations, storyboards, and video
      ├── Immutable/recoverable output revisions and independent review
      └── Exact-recipient activity and actor-private job state
```

### Shared presentation primitives

- `forma-ui-adaptive-shell`: named scope, navigation, main, inspector, activity, and compact action regions.
- `forma-ui-scope-switcher`: exact project/document/board identity, role, and search entry.
- `forma-ui-task-dock`: the stable five creator-facing destinations with touch, keyboard, RTL, and current-location semantics.
- `forma-ui-adaptive-pane`: the same semantic panel rendered inline, as a side drawer, as a bottom sheet, or as a bounded full-screen task.
- `forma-ui-workbench`: named context/work/result/review regions with user-selected pane visibility and central-stage minimums.
- `forma-ui-action-bar`: priority-aware critical/primary/supporting actions that never disappear behind an unnamed breakpoint.
- `forma-ui-view-selector`: concise mode families with complete access to all seven stable document lenses.
- `forma-ui-activity-inbox`: recipient- and scope-safe unread queue, typed status, filtering, deep links, and exact authorization.
- `forma-ui-job-tray`: truthful queued/running/completed/failed state, existing safe cancellation/recovery, no duplicate provider execution.
- `forma-ui-object-picker`: searchable full-depth projects, documents, collections, references, blocks, results, and authorized boards.
- `forma-ui-review-bar`: source freshness, exact reviewer eligibility, permitted Approve/Request changes, revision and export status.
- `forma-ui-responsive-data-list`: semantic rows/cards or explicitly labeled local table scroll, never silent deletion of owner/role/status fields.
- `forma-ui-orientation-hint`: optional, dismissible, explicitly task-specific suggestion.

Keep atoms, molecules, and generic layout primitives independent of `FormaStore`. Capability checks remain in the application/server; layout changes only presentation.

### State ownership

**Authoritative durable state:** project/document/board/output identity; exact organization/project permissions; source rights and versions; authored decisions; generation reservations; final artifacts; revision history; review request/approval; scoped notifications.

**Actor-private state:** personal AI chat, private job inputs/failures, personal spending/attention preferences, exact reviewer obligations, and sensitive receipts.

**Device-local presentation preferences:** rail open/collapsed, user-selected panes and widths, density, temporary panel disclosure, local Canvas camera, reading scroll, current slide, and properly scoped unsent draft. Key private preferences by current user + application + authorized project/resource and invalidate when identity/permission changes.

### Component and system migration rules

1. Introduce a small named breakpoint/token vocabulary instead of adding to more than 20 competing literal thresholds.
2. Use viewport conditions for shell posture and actual container conditions for work regions.
3. Explicitly handle available height, soft keyboard, dynamic viewport, and safe areas.
4. Preserve user-controlled content sizing; reduce decorative whitespace before reducing target or type size.
5. Keep collapsed controls discoverable, accessible, and named by the capability they reveal.
6. Avoid reparenting/remounting the active document, conversation, Canvas board, or review form across ordinary layout transitions.
7. Preserve existing exact URL, route aliases, focus state, browser history, organization/project authority, and public-share isolation.
8. Add supporting specialist-shell parity without hydrating creator state or exposing unauthorized destinations.
9. Preserve performance budgets and virtualize large galleries/boards by visible items, not total project size.
10. Measure outcomes by coarse consent-safe posture/input buckets rather than private pointer trails, raw viewport dimensions, device fingerprints, typed text, or customer prose.

> “Container queries decide arrangement; explicit user intent decides whether an inspector, rail, or comparison is open.” — **Design Engineer**

> “When my window gets narrower, collapse the furniture before you shrink the art.” — **Lead Designer**

## Market comparison and defensible category

Competitive capabilities and prices were checked against first-party sources on August 23, 2026. Pricing varies with geography, currency, tax, billing cadence, seat type, plan entitlement, and product rollout. Announced beta/research-preview capabilities must not be treated as universally deployed.

| Alternative | Verified benchmark | Caveat and Forma opportunity |
| --- | --- | --- |
| **Notion** | Persistent Home/Search/Inbox/New mobile navigation, documented notification behavior, cross-workspace attention and flexible content. | Mobile documentation acknowledges workflow limitations. Observed pricing was localized in GBP; do not invent USD prices. Forma can differentiate through source-bound outputs, creative media, and independent governed review. [Mobile workspaces](https://www.notion.com/help/workspaces-on-mobile), [notifications](https://www.notion.com/help/updates-and-notifications), [pricing](https://www.notion.com/pricing). |
| **Miro** | Documented tablet pinch, one-/two-finger navigation, long-press selection, pen support, and mobile/tablet collaboration. Starter advertises **$8/user/month billed annually**; Business **$20/user/month billed annually** or **$25 monthly**. | Plan entitlements and rollout vary. Forma should match credible touch interaction while preserving stronger source→deliverable→review continuity. [Tablet application](https://help.miro.com/hc/en-us/articles/360017731633-Tablet-app), [pricing](https://miro.com/pricing/), [Business](https://miro.com/business-plan/). |
| **Figma / FigJam** | Integrated design/collaboration, documented iPad interaction, slide/PowerPoint workflows. Professional Full **$16**, Dev **$12**, Collab **$3** monthly listed seat amounts; Organization Full **$55**, Collab **$5**, with commitment/tier qualifications. | Standalone FigJam iPad app was retired January 8, 2026 into the Figma app; current capabilities remain tier-dependent. [FigJam for iPad](https://help.figma.com/hc/en-us/articles/4502073572247-FigJam-for-iPad), [pricing](https://www.figma.com/pricing/). |
| **Canva** | Multi-format creative suite covering documents, presentations, video, whiteboards, websites, and more. Current observed Business pricing was **$250/person/year**, approximately **$20.83/month effective**; an older launch announcement described $20/person/month. | Prefer the currently displayed package/billing figure and disclose the conflict; do not claim multi-output generation alone as differentiated. [Visual Suite](https://www.canva.com/newsroom/news/canva-create-2025/), [pricing](https://www.canva.com/pricing/), [Business launch](https://www.canva.com/newsroom/news/introducing-canva-business/). |
| **Gamma** | Free-tier messaging already advertises import and PDF/PPTX/PNG/Google Slides export. | Its accessible official pricing page did not expose a reliable verified numeric paid price during this study; do not invent one. [Gamma pricing](https://gamma.app/pricing). |

**Differentiation that survives this market:** a verified, rights-aware, durable creative project context; accountable source-to-output lineage; genuine multi-format editable deliverables; independent source-fresh approval; and an exact actionable next step on whichever device the authorized person currently has.

> “One context producing many outputs is table stakes in 2026; verified rights, current-source approval, and a device-appropriate next action are the part worth paying for.” — **Market Researcher**

## Prioritized delivery plan

### Team and planning assumptions

Suggested ownership: one Product Owner, one Lead Designer, two Design Engineers/frontend engineers, one Canvas interaction engineer, one collaboration/backend engineer, and shared accessibility/QA, security/privacy, and operations support. A useful first release can land in approximately **4–6 weeks**. A comprehensive coordinated program is approximately **12–16 weeks** with overlapping workstreams. These are planning ranges, not commitments or measured estimates.

| Phase | Indicative duration | Accountable owners | Dependency | Main result | Exit gate |
| --- | --- | --- | --- | --- | --- |
| **0. Truth, instrumentation, behavioral baseline** | Week 1–2 | Product Owner; Lead Designer; Design Engineer; QA/A11y; privacy | None | Exact page/task/authorization matrix; real viewport test harness; current-state evidence; semantic vocabulary. | Existing phone-search, nested-folder, touch-target, chat-height, landscape, presence, stale-acknowledgment, and duplicate-create failures are reproducible in behavioral tests; no sensitive telemetry. |
| **1. Adaptive shell and immediate blockers** | Week 2–4 | Lead Designer; Design Engineers; collaboration/backend; QA/A11y | Phase 0 capability and state contract | Five stable destinations, visible global search and Ask/Send, accessible project drawer, full-depth hierarchy, 44px targets, short-height posture, idempotent create/save acknowledgments. | 320px portrait and short-height landscape both complete project search, navigation, authoring, and Canvas entry without removed actions; retries cannot duplicate a committed project or document. |
| **2. Secure Activity, review and Deliver** | Week 3–6, overlapping shell | Product Owner; collaboration/backend engineer; privacy/security; Design Engineer | Principal/recipient access contract and stable shell entry | Principal-safe global inbox; exact resource deep links; actor-private vs shared event separation; project-wide output/review projection. | Authorized reviewer opens the exact current artifact in ≤2 interactions; no stale/self-approval, private-job leakage, foreign project metadata, or auto-acknowledged work. |
| **3. Phone-first Work, Chat and slides** | Week 4–8 | Lead Designer; Design Engineers; document/output owners | Shared shell, action/pane primitives, scoped activity | Task-first document templates, visible Send, contextual mode families, conversation-first Chat, readable phone decks, keyboard-safe action bar. | Phone portrait and landscape complete all seven document-lens tasks and all supported artifact-review paths without forced orientation or lost draft. |
| **4. Projects, Explore/Library and continuity** | Week 5–9 | Product Owner; Design Engineers; research/QA | Shell, object picker, scoped pane state | Useful project home, full collections, filterable project Library, Scout/Taste discovery, exact-resource continuation, selected-object previews. | Every authored collection, Library family, existing lens, and authorized advanced feature is reachable in ≤2 deliberate navigation actions from its relevant context. |
| **5. Tablet-native Canvas and direct manipulation** | Week 6–11 | Canvas engineer; Lead Designer; Design Engineer; QA/A11y | Input/height primitives, scope-safe workbench | Actual two-pointer pan/pinch; explicit selection; 44px effective handles; stylus enhancement; comments; reliable rotation/split-screen posture. | Tablet portrait and landscape select, group, move, inspect, annotate and review without Shift/hover; no accidental mutations, stale locks, permission leaks or duplicate writes. |
| **6. Wide workbench and truthful collaboration** | Week 8–13 | Design Engineer; collaboration/backend; Product Owner | Activity, exact-project review, workbench panes, Canvas semantics | User-controlled 2–4-pane source/work/result/review composition; revision comparisons; scoped annotation; genuine live presence only if authenticated transport exists. | Resizing 2560→1440→900→2560 retains resource identity, draft, selection, focus, review revision and panel intent; no fake live cursors. |
| **7. Specialist parity, trust evidence and staged rollout** | Week 11–16 | Product & Quality; QA/A11y; security/privacy; operations; Procurement Officer | All relevant functionality and independently verified authority boundaries | Responsive specialist patterns; real multi-browser/device/assistive tests; privacy-safe outcome reporting; restricted pilot and enterprise evidence. | No P0/P1 launch blockers; all role/permission/locale/input matrices pass; enterprise deployment stays blocked until separate trust gates are proven. |

### Critical sequencing

1. Fix the user-visible phone action removal **before** debating visual polish.
2. Extend existing scoped notifications **before** introducing optional push delivery.
3. Preserve review and rights authorization **before** simplifying approval or adding a cross-project inbox.
4. Add behavioral tests **before** deleting or replacing current responsive source-pattern checks.
5. Ship stable project/document semantics and idempotent acknowledged writes **before** adding adaptive recommendations or custom layout persistence.
6. Add genuine two-pointer interaction **before** claiming tablet-native Canvas excellence.
7. Define true authenticated live presence **before** drawing or advertising collaborator cursors.
8. Verify full tenant deletion, identity federation, recovery, and accessibility evidence **before** declaring enterprise readiness.

## Persona-level acceptance criteria

### Shared product invariants

1. No authorized capability disappears because of viewport width, height, orientation, zoom, or input modality.
2. Every essential interactive target has a genuinely measured **44 × 44px** activation area.
3. No route has unexplained whole-page horizontal scrolling at **320px CSS width**; intentional table/filmstrip scrollers remain labeled and locally bounded.
4. Search, current project/document identity, primary task action, truthful save/offline state, and Activity remain visible or reachable in a single explicit action.
5. Every create/save/retry operation has an idempotent mutation identity and an authoritative visible committed state; stale-sequence recovery never silently duplicates a project or document.
6. A change of window size, orientation, virtual-keyboard state, or pane choice cannot alter permissions, route ownership, document/board/output identity, review eligibility, spending consent, unsaved text, selection, current slide, or scroll anchor.
7. No layout change generates content, contacts a provider, changes a project, acknowledges an approval, changes access, or leaks restricted data.
8. Owner, editor, reviewer, viewer, specialist, and public-share roles retain exact existing server-side enforcement.

### Phone

- Test at `320×568`, `360×640`, `390×844`, `430×932`, `568×320`, `844×390`, and equivalent short-height keyboard-open viewports.
- A returning user reaches the exact relevant task in **≤2 deliberate navigational actions** and sees the first actionable state within an initial target of approximately **8–10 seconds** after authenticated readiness.
- Search is visible at every supported width; Ask/Send, Save, and authorized review actions remain above the software keyboard.
- Full-depth collection browsing and all seven document lenses remain discoverable.
- The user can inspect and request changes or independently approve a current artifact within **≤3 deliberate task interactions** after authentication.
- Every completed/failed actor-private operation remains available in durable Activity after foregrounding or reload; optional push is claimed only when genuinely implemented and explicitly enabled.

### Tablet

- Test `768×1024`, `820×1180`, `834×1194`, `1024×768`, `1112×834`, and `1194×834`, including split view and software keyboard.
- At 1024–1194px landscape, a useful document/result, conversation/result, library/item, or board/inspector combination remains visible where the actual container permits.
- Two touch points pan/zoom around a real midpoint; a touch user can select at least three nonadjacent objects without Shift; all actions have visible non-gesture equivalents.
- Stylus pressure is captured only when supported and intentionally enabled; finger-only and keyboard-only alternatives remain complete.
- Rotating portrait→landscape→portrait preserves exact project, document, selected item, unsent text, board anchor, slide index, and review state.

### Small monitor

- Test `640×600`, `800×600`, `960×720`, `1024×768`, `1280×720`, `1366×768`, and `1440×900`.
- At 800 × 600, preserve approximately **360px / 60%** of useful vertical work area when practical.
- At 1024 × 768, Chat opens with conversation and composer visible; no forced 620px+680px vertical stack.
- Keyboard command search covers projects, documents, views, outputs, Activity, current tasks, and only currently authorized actions.
- A one-pane window may explicitly select one useful supporting surface without losing the active document or result.

### Large monitor

- Test `1440×900`, `1920×1080`, `2560×1440`, and `3440×1440`, plus the same physical display narrowed to 900px and 480px.
- At approximately 1920px, the user can show source/context, primary work, current output, and an exact authorized review or Activity indicator together.
- At 2560px and above, make multiple comparisons/pinned evidence available without imposing unreadably long prose lines or exposing unpermitted data.
- Height expansion meaningfully increases working-editor stage rather than stopping at an arbitrary 780px.
- A `2560 → 1440 → 1200 → 900 → 2560` transition retains selection, user-entered text, current result, role, active review, focus and intentional pane configuration.

### Accessibility, privacy, and performance

- Include Chromium, Firefox, and WebKit; touch, mouse, keyboard-only, trackpad and supported pen; screen readers; English/French/Arabic; RTL; 100%, 200%, and relevant 400% browser zoom; reduced motion and forced colors.
- Primary workflows have **zero critical or serious accessibility findings**, no hidden focused element behind a composer/sheet, and complete keyboard equivalents.
- Verify owner/editor/viewer/independent-reviewer authorization, immediate revocation, stale review rejection, privacy-safe notification metadata, and exact public-share containment.
- Use [Core Web Vitals](https://web.dev/articles/vitals) as starting field-performance gates: p75 LCP **≤2.5s**, INP **≤200ms**, CLS **≤0.1**; establish separate Canvas pan/zoom interaction budgets because those behaviors are not fully represented by INP.
- Never report projected time saved, conversion, or ROI as observed performance until the approved pilot measures it.

## Enterprise and pilot decision gates

The product has meaningful existing independent review, reservations, spending caps, legal hold, retention policies, and recoverable output revisions. However, those strengths do not establish every enterprise control.

### Unconditional unrestricted-enterprise blockers

1. **Complete tenant offboarding is not established.** The existing personal-erasure boundary explicitly retains some shared-project outputs, uploads, other devices, and backups, including a `otherDevicesAndBackupsPurged: false` outcome. This is not a claim that existing retention/legal-hold support is absent.
2. **Enterprise identity lifecycle is not independently attested.** Existing trusted upstream headers require a verified edge boundary and cannot by themselves establish customer SSO/OIDC/SAML, MFA/conditional access, SCIM lifecycle, group mapping, or managed-device policy.
3. **Complete tenant-isolated restore, encryption custody, contractual RPO/RTO, and backup/device destruction are not independently demonstrated.**
4. **Independent accessibility conformance and real-device task completion are not yet evidenced.**
5. **Canvas exposure remains subject to real environment-specific governance, approvals, and exact project entitlements.** Existing local availability does not prove production pilot access.

Relevant evidence:

- `/Users/westbrook/Documents/repos/codex/worker/privacy-api.ts:45`
- `/Users/westbrook/Documents/repos/codex/worker/privacy-api.ts:65`
- `/Users/westbrook/Documents/repos/codex/worker/pilot-policy.ts:27`
- `/Users/westbrook/Documents/repos/codex/src/sync/canvas-offline-queue.ts:22`
- `/Users/westbrook/Documents/repos/codex/worker/canvas-governance-policy.ts:51`

### Narrow controlled-pilot conditions

- One named organization, approximately **5–10 named participants**, 21–30 days, and at least one independently eligible reviewer.
- Public, synthetic, or explicitly non-sensitive licensed material only.
- Existing default pilot guardrails of **$15 per participant** and **$150 per organization** where applicable; no unapproved provider operation, expensive media, retry, or expanded spend.
- Explicit author/editor/viewer/reviewer distinction and verified immediate membership revocation.
- Canvas included only when the actual deployed environment proves all applicable release approvals.
- Phone portrait and landscape, tablet portrait and landscape, snapped laptop, large-display resizing, and screen-reader workflows pass behavioral acceptance first.
- Stop immediately on cross-project leakage, unauthorized release, stale/self-approval, lost edit, duplicate spend, permission bypass, or critical accessibility failure.

> “Our buying decision must remain a no until tenant recovery, deletion, identity, and independent accessibility evidence are demonstrated, regardless of how compelling the creative workflow becomes.” — **Procurement Officer**

## Quotes that directly shaped the product plan

These are genuine original statements from this study's named role agents, quoted verbatim; they should not be represented as external human-customer interviews.

### Lead Designer

> “A smaller screen is not a smaller product; it is a stricter argument about what deserves the next square inch.”

> “The Canvas and the document should feel like two stances toward the same creative work, not two storefronts in an application mall.”

> “A review workflow is not finished when the button exists; it is finished when the right person can find it at the right moment.”

### Design Engineer

> “A big monitor running a 620-pixel split window is a compact workspace, not a desktop exception.”

> “Two-finger pan and pinch are not the same feature as calling a trackpad wheel event ‘pinch.’”

> “I will not approve a breakpoint that changes entitlements, generates paid work, or discards an unsaved draft.”

### Product Owner

> “Forma is not an image generator, a document editor, or a whiteboard. It is the living creative world that keeps all three accountable to the same intent.”

> “Every extra inch of screen should reveal a useful relationship, not another column of product chrome.”

> “The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.”

### Smart Phone End User

> “I am here to finish something, not to reconstruct a desktop sidebar.”

> “If Forma hides the one thing I need to act on, it is not responsive; it is withholding my work.”

> “Success on my phone means I can recognize the task, trust the state, and finish the work before the interface asks me to think about itself.”

### Tablet End User

> “Portrait should never turn the complete creative plan into a secret I can no longer find.”

> “I want to browse a reference beside my work in landscape and open that same reference with one tap in portrait.”

> “When I rotate the tablet, keep the same document, selection, unfinished text, and canvas position; rotation is not a new session.”

### Small Monitor End User

> “My window can be narrow while my intent is sophisticated.”

> “A side panel should borrow my attention, not confiscate my document.”

> “Make the product deeper when I give it more room, not merely bigger.”

### Large Monitor End User

> “I bought screen space to see relationships, decisions, and collaborators together—not to display a larger version of the same cramped interface.”

> “A presentation deserves slide thumbnails, the active slide, speaker notes, source evidence, and approval state on one screen.”

> “Predictable tools beat clever tools that move somewhere else whenever the product guesses my intent.”

### Market Researcher

> “An asynchronous job without a global, actionable inbox is just work the customer has to remember to check.”

> “Do not call a same-user BroadcastChannel presence ‘multiplayer’; an honest collaboration story requires two different people on different devices.”

### Procurement Officer

> “Passing a regular expression against a stylesheet does not tell me whether a blind reviewer can approve a deck or whether a 32-pixel account button can be operated on a phone.”

> “The right success metric is not whether the interface looks responsive; it is whether an authorized person can complete the same governed creative outcome quickly on the device they actually have.”

## Verification and limitations

- The running local Forma application returned the authenticated Projects and Design & Knowledge experiences.
- The coordinator performed actual viewport measurements at `390×844`, `844×390`, `834×1194`, `1194×834`, `912×700`, `1440×900`, and `1920×1080`; the temporary viewport override was reset.
- An independent reviewer safely verified zero different-user and same-user-tab peers using an in-memory Canvas presence probe without touching application data.
- The coordinator executed the genuinely read-only targeted command:

```text
node --experimental-strip-types --test \
  tests/responsive-layout.test.mjs \
  tests/routes.test.mjs \
  tests/office-documents.test.mjs \
  tests/presentation-pdf.test.mjs

36 tests passed; 0 failed.
```

- Existing Office round-trip tests substantiate editable DOCX/PPTX and preserved slide speaker notes; PDF tests substantiate tagged multilingual accessible document structure. Passing source-string responsive tests do not establish actual device task success.
- The authorized in-application end-user exercise produced the fully populated project **Forma Everywhere — Adaptive Creative Workbench — 2026-08-23**, containing one master document, all seven requested stakeholder-role documents, and three separately authored slideshow narratives; together these 11 substantive documents contain **34 reload-verified authored context blocks**. The three narratives describe **12 executive slides, 14 device/experience slides, and 16 implementation/trust slides**.
- Forma's misleading stale-sequence retry advice created **a second identically titled research project** and four duplicate role documents inside the substantive project, which therefore contains **15 total documents and 34 creative decisions**. The accidental duplicate project contains **one initial document and four creative decisions**; the Projects screen distinguishes the complete project by its 15-document count. Both research projects and all duplicate documents were intentionally preserved rather than performing unapproved destructive cleanup. The exercise created **zero generated outputs**, made no provider call, and incurred no generation spend.
- The team did not install dependencies, modify application source, publish/deploy changes, invite collaborators, exploit tenant boundaries, or initiate an external generation/provider operation.
- Existing user projects and content were not modified or used as external-provider material; the new research collection contains only deliberately created study material.
- Source files changed during the study without a corresponding change in `HEAD`; recheck all quoted line numbers and implementation state before converting findings into engineering tickets.
- Vendor pricing and plan capabilities were current observations, not durable commitments, and should be checked again before publication or purchasing.

## Final decision

**Build a stable project-centered adaptive product, not separate device-tier experiences.** Preserve Forma's current durable sources, many real outputs, editable portable formats, independent review, server-owned permissions, and role boundaries. Replace disappearing controls, oversized rails, hidden activity, mouse-only touch behavior, cramped-height assumptions, misleading presence, and CSS-string-only confidence with measured end-to-end task completion.

The smallest important release restores phone Search/Send, complete project hierarchy, accessible touch targets, short-height layout, and a scoped Activity path. The full program turns those fixes into a coherent collaborative creative world that is equally trustworthy on a phone, pleasurable on a tablet, effective in a snapped laptop window, and increasingly powerful as a user gives Forma more real working space.

> “The right density is not the most controls you can cram onto the screen; it is the most useful decisions I can make without losing context.” — **Large Monitor End User**
