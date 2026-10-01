# Forma components and audience-navigation patterns

Forma's design system is one shared production implementation for six focused
application surfaces, the public welcome page, and exact-resource guest review.
The living reference is `/knowledge/design-system`;
`/knowledge/patterns` presents audience and navigation compositions;
`/knowledge/guidance` publishes privacy, accessibility, and localization rules.
Every example is fictional and store-independent.

Creator’s document workbench composes the existing shell, ProjectRail and Studio
navigation around `--forma-pane-inset`. Heading text, first navigation labels,
and identity marks share that logical leading edge; backgrounds and separators
keep their own full-width boundaries. This is application layout, with no new
component API or translated copy. The compact dock keeps its equal-width cells.

Library output thumbnails use one responsive 3:2 frame with equal border insets
for individual images, prompt fans, video covers, storyboard summaries, and other
artifact summaries. Loading video placeholders reserve the same frame. Raster
previews fill their available area with `object-fit: cover` and focal-aware
`object-position`; storyboard frames retain their individual saved Focus Points.
OutputVisual and ArtifactSummary use the shared local image analyzer when a
saved point is absent. Video analysis uses the actual saved WebP cover, never a
scene's potentially different source image. Unreadable pixels fall back to center.
This does not call a provider or modify history. Slides scale their complete
native layout inside the common frame; text/audio/3D summaries remain icon and
copy previews. Full image and artifact viewers retain their original presentation.
Thumbnail sizing stays scoped to Library previews. The ArtifactSummary catalog
example illustrates the frame and focal placement with isolated fictional artwork.

Before creating an interface, inspect the live reference, this guide,
`DESIGN.md`, and `custom-elements.json`. Reuse an exact production component
first, extend the closest shared contract second, and create a new component
only when its documented semantics, accessibility, public isolation, or transfer
budget make the existing choices unsuitable. Promote repeated controls to the
shared design system and migrate every known consumer in the same change.
Implementation, a genuine safe catalog example, translated catalog copy,
human-readable guidance, both generated Custom Elements Manifests, and
regression coverage ship atomically; no page-specific duplicate is complete.

## Audience-owned application surfaces

| Surface | Audience | Canonical route | Authorized tasks |
| --- | --- | --- | --- |
| Creator Workspace | Creators and personal account owners | `/projects`, `/library` | Projects, Create, Library, Re-entry, Settings |
| Canvas | Entitled creators and explicitly granted project viewers/editors | `/canvas`, `/canvas/projects`, `/canvas/library` | Permission-shaped boards, the same projects, and the same project Library |
| Platform Operations | Platform operators | `/operations` | Governance, providers, releases, access |
| Product & Quality | Product owners, delivery leads, authorized evaluators | `/product` | Insights, Delivery, separately granted Evaluation |
| Design & Knowledge | Designers and approved internal readers | `/knowledge` | Components, Patterns, Guidance |
| Engineering Diagnostics | Authorized reliability specialists | `/engineering` | Health, redacted events, synchronization, jobs |

`/share/:token` is an unauthenticated exact-resource review boundary. It never
displays authenticated workspace switching or internal navigation. Customer
Workspace Administration is a nested Creator Settings task at
`/settings/workspaces`, not a seventh application: its organization switcher,
member invitations and role controls, project grants, budget policy, and audit
actions exist only when the exact current organization permits them. A project
viewer gets read-only documents, outputs, and—only after a separate scoped
grant—boards. An authorized editor can author the same project, arrange granted
boards, and create actor-private conversations and output jobs against their
personal and organization's budgets. Frozen provider inputs remain private to
their actor. Public review requires its own exact-document authorization;
membership and editor status never create a public share automatically.
Shared board convergence uses authenticated bounded event polling, not
cross-account live cursor presence or an unauthenticated broadcast channel.

Shared-project task rails and commands exclude personal-only Sessions, Scout,
Taste Memory, and unsupported Canvas proposals. A bookmarked personal-only
route explains why it cannot run in the selected shared project and offers an
explicit return to the personal Creator Workspace. Viewer-only project and
conversation states describe their actual read access without showing an
impossible creation or chat action. The shared Canvas board list, navigation,
privacy guidance, role announcements, and failure states are localized in
English, French, Arabic, and Japanese, including right-to-left layouts and bidirectional
user-authored project names.

Shared generation reports that both the individual and their organization can
be charged. An actual organization owner or administrator receives a direct
link to `/settings/workspaces/:organizationId/usage` for that exact selected
organization; contributors without an organization-administration role instead
see a localized instruction to contact their project administrator. Budget
acknowledgment and suppression preferences are partitioned by account and
organization, and an open confirmation closes when the authorization scope
changes.

Only the exact active project owner can open the shared-document Review
dialog, whether the action originates in the document header, account popover,
or command dialog. Editors and viewers never receive the affordance or API
authority. Newly generated raw guest URLs remain ephemeral and are immediately
cleared when the principal, organization, project, document, or permission
epoch changes; revoking the link takes effect immediately. Shared image,
media, Markdown, JSON, archive, and presentation PDF downloads each require a
committed exact-project, exact-resource, actor-attributed export acknowledgment
before the browser download begins. A failed or stale acknowledgment produces
no file action. Personal-project downloads retain their existing direct flow.

Projects and Library are reusable capabilities, not application-switching
shortcuts or duplicate collections. `/canvas/projects` uses the same
`<forma-projects>` implementation and project IDs as `/projects`;
`/canvas/library` uses the same `<forma-library>`, blocks, output history,
collections, and media as `/library`. Canvas-owned preview and editor routes
remain under `/canvas/library/...`, preserve browser-refreshable URLs and
modified-click behavior, and keep the Canvas task rail/current-workspace
indicator selected. Selecting a project, following a collection, or pressing
the Forma brand never silently exits the current workspace. Only genuine
document-editing handoffs cross to Creator, with an explicit localized visible
label and accessible name naming **Creator Workspace**.

## Shared control metrics and wrapping composition

Document context and results headings share the pane inset and a first title
row at least as tall as `--forma-hit-target`. Titles align at the top of their
panes even when the results actions wrap; the context score stays centered in
its own flex row. Keep these metrics in the existing pane composition rather
than giving each column separate heading offsets.

Comparable supporting controls reuse `--forma-font-size-supporting`,
`--forma-body-line-height`, `--forma-space-2`, and
`--forma-control-min-size`. Their native button/input/select borders and block
padding share one box model; a 44px minimum alone does not make two controls
the same height. Comparable same-line action peers share the applicable minimum
and stretch through wrappers as labels wrap and controls grow. Keep widths
content-led; a minimum must never become a height ceiling. Textareas, native
checkbox glyphs, and larger editorial calls to action retain their own roles.
Account preferences give the whole native checkbox label the minimum target.
The same peer-only sizing is consumed by real page-header actions, Library
result/family actions, Activity headers, generation failure actions and specialist
approval footers. Noninteractive badges and intentional scroll strips retain
their existing alignment/overflow. Document failure grids stretch only their
button cells; labelled specialist fields retain their own responsive grid.

`<forma-ui-cluster>` preserves authored light-DOM children. Its reflected
`alignment` accepts `center` (default) or `stretch`; unsupported values retain
the default centered layout. Keep badge/status rows centered. Use `stretch`
only for comparable peer actions: it stretches each wrapped row and propagates
through `forma-ui-button`, `forma-ui-icon-button`, and `forma-ui-link` to their
inner native control without changing native events or link destinations.

```html
<forma-ui-cluster alignment="stretch" gap="small">
  <button type="button" class="button secondary">Cancel</button>
  <forma-ui-button label="Save direction" variant="primary"></forma-ui-button>
  <forma-ui-link href="#history" label="View history"></forma-ui-link>
</forma-ui-cluster>
```

Do not use action-row stretching to fill the entire height of a labelled field
and its help text. Forms retain responsive label/control/help grids with
bottom-aligned actions. The shared slotted page header and list item reserve a
useful main-content flex basis before wrapping actions; allowing shrinkage alone
does not reserve room for full headings and supporting copy. Wrap text and then
actions instead of clipping either. List items keep the leading
visual and copy in one group so wrapping cannot strand the icon or avatar on
its own row. Notices move their actions below
the copy when their own container is narrow. Body copy inherits the locale's
leading token through both light and shadow DOM.

Each route owns one logical outer gutter. Full-bleed header backgrounds may
extend beyond it, but equivalent header/body content uses that same gutter;
nested controls add only their genuine object inset. Deliver applies its body
inset once around the existing keyed Output hosts, results and final caveat.
Media stages and intentional timeline, filmstrip, or table scrollports retain
their documented local sizing and overflow; those exceptions must not clip
neighboring task copy or introduce a second peer gutter.

The real Cluster catalog example includes a centered badge row and an opt-in
row with both native and wrapped actions. Stylesheet-contract tests verify the
declared rules. Companion actual-source catalog/primitive tests exercise native
and wrapped labels, events and destinations with finite template ports; neither
suite certifies rendered heights, real slot layout, text fit, focus or accessibility.
Acceptance still requires four-locale, narrow-container, 200%-text and native
browser checks; regenerate both Custom Elements Manifests after API changes.

## Shared language selection

`<forma-ui-language-picker>` is the single native, light-DOM language control
used by the public welcome page, Creator Workspace and consent flows, internal
application shells, and exact-token guest review. Its shared pure language
registry contains English, Français, العربية, and 日本語 exactly once; every
option carries its own `lang` and writing direction.

```html
<forma-ui-language-picker label="Language" value="en"></forma-ui-language-picker>
```

The translated `label`, stable locale-code `value`, `disabled`, and `busy`
attributes reflect their JavaScript properties. Property-only `.options`
accepts `{ value, label, direction }` records; option labels are authored
language names and option values remain untranslated machine identifiers. A
real visible `<label>` wraps the native 44px-minimum `<select>`; constrained
headers may visually hide the label while preserving its accessible name.
Selecting a language emits bubbling, composed
`forma-change: CustomEvent<{ value: string }>`. Consumers own their existing
locale loading, request concurrency, persistence, route updates, error
recovery, and live announcements. The public page preserves navigable language
links when JavaScript is unavailable.

The component and its canonical options import no Lit runtime, application
translation catalog, account state, provider adapter, or private API. The
reference at `/knowledge/design-system#forma-ui-language-picker` renders the
actual isolated implementation without changing the workspace language.

## One conversation owner per surface

`<forma-ui-conversation-composer>` is the single store-independent, light-DOM
conversation input shared by contextual Ask Forma and the expanded document Chat
experience. Place it inside its owner's genuine native `<form>`; the host, never
the shared component, decides whether submission requests private guidance,
paid creative chat, a free reviewed quick edit, document planning, or
project-wide Canvas planning.

```html
<form>
  <forma-ui-conversation-composer
    label="Message Forma"
    placeholder="Describe what you want to explore…"
    submit-label="Send message"
    max-length="1200"
  ></forma-ui-conversation-composer>
</form>
```

The real textarea keeps the caller-localized accessible label, bidirectional
authored text, visible keyboard focus, composition-safe input, and native form
submission. Unmodified Enter submits; Shift+Enter adds a line; modified
shortcuts and in-progress IME composition never submit. Empty, busy, and
explicitly unauthorized actions cannot submit. `forma-input` and `forma-submit`
expose stable `{ value }` details without loading account state, private work,
provider adapters, or network clients. Maximum length is chosen by the actual
operation: 1,200 characters for page assistance, 2,000 for reviewed planning,
and 4,000 for document Chat.

`assistantInteractionForSurface` gives every route exactly one conversational
owner. An editable Chat view uses its inline document conversation; viewers
retain safe floating guidance. Other Creator pages use floating assistance,
adding paid, reviewed **Plan decisions** or **Explore board** modes only when
the exact document or spatial board, authoring role, output permission, and
provider are all available. Board suggestions and document decisions stay inert
until their existing page explicitly applies them. Personal **Quick edit** is
free and requires separate approval; direct **Creative chat** explains that it
updates the document. Platform assistants remain independently scoped and
guidance-only; public share pages never mount an assistant. Authored session
intentions, individual creative decisions, sources, reviews, and search remain
distinct nonconversational forms.

## Selection-scoped context controls

Document decisions keep their complete authored wording, protected phrases, type,
intent, and lock state in the reading surface. `forma-context-block` uses the
existing focused decision and a native radio group; **Controls for {decision}**
appears only for the selected decision and reveals its full editor, including the
editable text or adopted input without a third navigation choice. No first
decision is automatically selected. Escape closes these controls and restores their trigger without
discarding unfinished edits. Explicit Cancel inside a form retains its existing
discard behavior. Read-only consumers use the `read-only` attribute and receive
named inspection without authoring or paid actions.

Document lists use keyed decision identity. The editor template is retained with
Lit’s `cache` directive outside the connected DOM, so inactive buttons and
selects do not contribute to the page. Identity includes the current
authorization scope; a changed actor, project, document, or role cannot reuse a
retained private editor. Context intelligence, spatial scope, and palette controls
expose `suspendControls()` to leave their owned native top layer before detachment
while retaining unfinished drafts and the original request identity. Closing an
intelligence review with its close button, backdrop, or Escape suspends it;
explicit Cancel and server Dismiss/Done keep their existing discard semantics.
A guarded review lookup can finish while suspended without restarting its quote.
Re-entry does not approve or submit work. Nested context and character settings
start expanded inside the selected editor, keeping their controls within the
same disclosure.

Library uses the same inspection organism and keeps its existing
`forma-library-block-editor` for reusable authoring and document-owned forks.
The property-only `blockId` pins a retained editor to its exact decision;
`null` addresses the existing new-block form and `undefined` follows the route.
Its bubbling `library-use-copy` event carries `{ blockId }` to the Library host,
which executes the same permission-checked copy operation. Closing and switching
Library editors retain their native fields and child editor instances within the
current authorization scope. Viewer routes never mount disabled authoring forms. A selected read-only decision
has one **Inspect saved review** action. It uses the existing actor-private
`resume`, `retrieve`, and `dismiss` authoring-review operations; it cannot quote,
buy, preview project changes, or apply them. Authorization changes scrub the
old cached review before a fresh read. Personal surfaces use server-issued
session capabilities, not the absence of a shared-project context. An author
without generation permission can still inspect and save an already-retained
review through the existing free human-authoring path.

## Shared native dialog foundation

`ensureNativeModalDialog` in `src/components/design-system/native-dialog.ts`
promotes a real `<dialog>` into the browser's native top layer, keeps the
background inert, derives its accessible name from the actual heading, and
accepts a caller-translated `fallbackLabel` when a heading is absent. It has no
Lit, localization, account, provider, or network dependencies, so the public
welcome experience and authenticated applications use the same modal
semantics without sharing private application code.

Authenticated surfaces continue to call `ensureModalDialog`; that wrapper
delegates to the shared foundation and provides the current application
language. Public surfaces call the foundation directly with their own
translated labels. Every dismissible host retains explicit close controls,
backdrop and Escape behavior, focus restoration, and reduced-motion support.

## Context creation and reusable choice cards

`<forma-ui-choice-card>` also presents the shared exact next actions in Document and Canvas. The host supplies at most one primary and two alternatives, translated labels, and the immutable object target. Activating the card revalidates the current actor, project, document, board, object and source before opening saved work or free configuration. It never generates, approves, copies or exports on its own. See `src/components/next-action-cards.ts` and `src/model/workspace-intelligence.ts`; no second card or canonical data store is introduced.

`<forma-ui-choice-card>` is the shared, light-DOM molecule for a real actionable
choice. Document block types, the create-or-reuse context entry, Canvas source
categories, Context board starters, Adaptive path answers, Creative Editor
tools, and optional Chat starters all render the same production component:

```html
<forma-ui-choice-card
  label="Creative idea"
  detail="Supporting context"
  icon-name="spark"
  value="creative-idea"
></forma-ui-choice-card>
```

`label` and `detail` are caller-localized authored content; `value` is an
untranslated, stable machine identifier. `icon-name`, `compact`, `disabled`,
and an optional `selected` state control presentation without replacing the
native `<button type="button">`. Only explicitly selectable choices expose
`aria-pressed`; every
enabled activation emits bubbling, composed
`forma-action: CustomEvent<{ value: string }>`. Supporting text, focus rings,
44px minimum targets, reduced motion, right-to-left layouts, forced colors, and
light/dark surfaces use the shared design tokens.

Use **Add context** for the common entry, distinguish **Add a context block**
from **Add from project**, and reuse the canonical `BLOCK_GROUPS`/`BLOCK_TYPES`
taxonomy wherever a decision type must be chosen. Broad Canvas add menus may
also offer documents, finished outputs, references, and drawing; guided
questions, adaptive adoption, board capture, and chat remain native to their
working mode. Opening a choice never creates placeholder content, silently
adopts a suggestion, uploads a reference, starts generation, or grants new
permissions. Existing native modal hosts retain browser-owned focus, Escape,
backdrop dismissal, separate form ownership, and explicit reference consent.

The actual isolated demonstration and complete generated API are available at
`/knowledge/design-system#forma-ui-choice-card`.

## Navigation destination and event contracts

Both navigation components consume property-only records:

```ts
type FormaNavigationDestination = {
  label: string;
  value: string;
  href: string;
  description?: string;
  disabled?: boolean;
};
```

`label` and `description` are translated human-readable text; `value` and `href`
are stable machine identifiers. Assign records to `.destinations`; never
serialize private account or capability data into HTML attributes.

Both components emit bubbling, composed, cancelable events:

```ts
type FormaNavigationIntent = CustomEvent<{
  value: string;
  href: string;
}>;
```

Cancel `forma-navigate` for same-surface client routing. Preserve ordinary
native-link behavior or revalidate the receiving session for cross-audience
handoffs. Creator Workspace and Canvas preserve same-project continuity.

Navigation components are presentation, never authorization. The server
independently checks the principal, scope, accepted membership, active grant,
expiration, revocation, HTML route, protected asset, data API, and media.
Hosts pass only destinations already authorized by that policy.

Internal-session responses intentionally carry **only the current audience's
capabilities**. The independent `availableApplications` field contains safe
`{ id, href }` records for entitled workspace switching; it never expands into
other audiences' capability names, customer records, budgets, provider details,
or organization memberships. Receiving routes validate authorization again.

## Workspace switcher

`<forma-ui-workspace-switcher>` is a store-independent organism:

```html
<forma-ui-workspace-switcher
  id="workspaces"
  label="Available workspaces"
  value="creative"
></forma-ui-workspace-switcher>
```

```ts
document.querySelector("#workspaces").destinations = [
  { label: "Creator Workspace", value: "creative", href: "/projects" },
  { label: "Canvas", value: "canvas", href: "/canvas" },
];
```

- Zero or one authorized destination renders no switcher.
- Exactly two destinations render direct native navigation links.
- Three or more render a compact button showing the current workspace and
  opening a native `popover="auto"` containing a named `<nav>` of real links.
- The localized button names both the switching action and current workspace,
  declares `aria-controls`, and keeps `aria-expanded` synchronized with the
  browser's popover state.
- Opening focuses the current destination; Escape and outside interaction
  dismiss the popover, while Escape and in-panel activation restore trigger
  focus without stealing focus from a clicked outside control.
- Native anchors preserve ordinary navigation, modifier/middle-click,
  copy-link, and opening destinations in another browser tab.
- Disabled destinations are omitted; the current destination receives
  `aria-current="page"`.
- Do not use `<select>` for URL navigation, a modal dialog for a bounded
  workspace list, or false menu/listbox ARIA roles. Language selection remains
  a native form control; command search remains a modal dialog.
- Unauthorized provider, engineering, evaluation, and platform tools never
  appear in creator or guest navigation.

## Audience task navigation

`<forma-ui-audience-navigation>` is a store-independent molecule:

```html
<forma-ui-audience-navigation
  id="product-navigation"
  label="Product &amp; Quality"
  value="insights"
></forma-ui-audience-navigation>
```

```ts
document.querySelector("#product-navigation").destinations = [
  { label: "Insights", value: "insights", href: "/product/insights" },
  { label: "Delivery", value: "delivery", href: "/product/delivery" },
];
```

Include Evaluation only with its distinct synthetic-evaluation or qualification
capability. Render at most five primary tasks using an audience-neutral named
`<nav>`, a native list, real anchors, and exactly one truthful
`aria-current="page"`; never use tab roles for page routes. When an upstream
caller accidentally supplies more than five authorized tasks, retain the
current authorized destination instead of silently hiding it. Empty task sets
render no navigation landmark or reserved chrome.

The accessible landmark name identifies the audience without repeating the
already-visible workspace heading. Tasks align to one logical page gutter on a
preference-reactive surface; their current state uses readable accent text and
a restrained underline, never a fixed-dark administrative pill. Every link
retains native modifier-click/new-tab behavior, at least 44-by-44-pixel hit
areas, unclipped focus outlines, local horizontal scrolling, and forced-colors
support. The component reveals its current link inside its own scroller for
English, French, Japanese, and right-to-left Arabic without moving the page viewport.
Document and Canvas focus modes hide the entire rail.

`<forma-area-navigation>` remains a compatibility adapter around this same
production component; Creator Workspace, Canvas, specialist shells, and the
living Design System all consume the identical implementation.

Creator Workspace edits documents and reusable context; Canvas spatially
arranges that same project, documents, decisions, and results. Switching must
preserve identity, project, document context, pending jobs, consent, drafts,
and account-partitioned offline work.

### Evaluation, delivery, and release disclosure

- `evaluation.synthetic.read` may inspect frozen scenario metadata;
  `evaluation.synthetic.run` alone enables free in-memory rehearsal.
- `evaluation.qualification.read` exposes redacted historical provider
  evidence; `evaluation.qualification.run` alone enables the server-side
  no-provider/no-pixel/no-write adapter contract simulation. Full provider
  configuration remains exclusive to `platform.provider.configure`.
- Historical qualification, actual paid replay, and production activation are
  distinct concerns. Paid replay requires principal-administrator status plus a
  direct human approval, one-use exact quote, and bounded reservation; fictional
  persona entry independently requires a named warning, typed confirmation,
  acknowledgment, and trusted final submission.
- Delivery readers may inspect durable audience-owned decisions; only
  `product.delivery.manage` can create/change them. Authenticated ownership,
  immutable dependencies, explicit evidence, and revision conflicts are server
  controlled.
- Interrupted paid generation resumes only with its original, atomically
  matched token and USD reservation pair. Recovery checks owner, creative
  stream, operation, accounting period, and active provider attempt; a stale
  worker or unrelated reservation must never claim or duplicate paid work.
  Usage reporting includes a settled provider charge even when its planner
  tokens were already accounted for and the new token count is zero.
- Product, Operations, and Engineering report the same canonical three release
  requirements. A missing requirement or stale adapter qualification remains
  blocked even when an outdated row says `approved`; only
  `platform.release.approve` may change release state.
- Product outcome metrics exclude seeded, fictional, simulated, and synthetic
  activity, suppress cohorts below three real creators, and never expose raw
  titles, prompts, account IDs, or private payloads.
- Platform Access lists only effective grants: revoked or expired privileges
  must not appear as active, enable an application destination, or authorize a
  session. Valid future-expiring and unbounded grants remain available.

## Accessible and internationalized interaction

- Provide 44px targets, visible focus, named landmarks, a first skip link, one
  current destination, accurate page headings, and a focusable main region.
- Prefer native anchors, ordinary keyboard navigation, browser-managed
  popovers/dialogs, and real forms. Reserve `<details>/<summary>` for persistent
  supporting information, such as evidence, receipts, and technical details;
  do not use it as a floating menu, language picker, or floating control panel.
- Reuse `forma-ui-popover` for native auto-dismiss action groups and rich controls.
  Its property-only `content` accepts a Lit template in light DOM; authored form,
  link, audio, and disclosure semantics remain unchanged. `triggerId` is an
  optional host-owned stable unique invoker ID; the panel always receives its
  own instance-unique target. Use native buttons with `popovertarget`, ordinary
  group or navigation semantics, and `:popover-open`-gated layout. Do not declare
  an ARIA menu without implementing its full keyboard contract.
  Its optional property-only `actionCurrent(value)` checks current opening and
  target ownership before an action closes, focuses, or emits. It is not an
  authorization check; the existing action executor retains that responsibility.
  Call `close(true)` before handing off an action and `close()` on authority,
  route, or lifetime teardown; never queue focus after the destination opens.
  The framework-free native-popover helper only positions an already native
  surface, using RTL, visual-viewport and safe-area bounds. It cannot authorize,
  submit, open, or persist work. Browser light-dismiss and Escape own closure.
  Public language fallback links use the same native attributes without JavaScript;
  the existing language-picker enhancement continues to use a native select.
- Bound account menus and floating panels to the dynamic viewport minus their
  trigger offset and bottom safe-area inset. Keep excess content independently
  scrollable, contain scroll chaining, and preserve visible keyboard focus so
  final privacy and account actions remain reachable on short screens.
- Use the browser-managed `popover="auto"` and `popovertarget` pairing for both
  account controls and workspace selection. Outside interaction dismisses the
  active surface, opening either surface closes the other, and Escape returns to
  its invoking control. Compact floating panels should use `scrollbar-gutter:
  auto` instead of reserving a permanently empty, one-sided gutter; use stable
  gutters only when preserving a changing scrollport's layout is necessary.
- Translate human-readable labels into English, French, Arabic, and Japanese; preserve
  RTL, 320px layouts, 200% text scaling, forced colors, and reduced motion.
- Never translate routes, grants, events, identifiers, destination values,
  ownership scopes, or CSS custom properties.
- Bound role-specific reporting to five measures and disclose scope, refresh
  time, fictional evidence, and pending/blocked/passed/approval-required state.
- Put detailed milestones, frozen qualification history, and replay evidence
  beneath those measures in labeled native sections, lists, and captioned
  tables. Keep delivery mutations exclusive to delivery managers, synthetic
  rehearsal separate from historical paid fixtures, and actual-data replay
  exclusive to explicitly authorized administrators.
- Separate Knowledge **Components**, **Patterns**, and **Guidance** into real
  task views. Lazy-load the component inventory only for `design.catalog.read`;
  protect its machine-readable manifest; keep focal-point comparisons limited
  to approved fictional fixtures and browser-local calculations.
- Mount Platform Operations on the same store-independent specialist shell as
  Product, Knowledge, and Engineering. Overview, Providers, Access, and Release
  each require their own route, data projection, protected code, and task-level
  permission; viewing policy never implies approval authority.
- Keep creator provenance human-readable by default. Raw event receipts and the
  `/engineering/events` handoff exist only behind an explicit disclosure for
  an `engineering.events.read` principal; never expose a broken Operations link
  to ordinary creators.
- Preserve native browser shortcuts in Canvas. Only unmodified single-letter
  board commands may be captured; browser Find/New/tab selection/zoom reset,
  focused input/button/link behavior, Escape, and semantic card groups remain
  intact.
- Public shared images, storyboard frames, and prompt-fan alternatives use
  store-independent native buttons and a same-origin/same-token modal. Keep
  unique translated image names, RTL ArrowLeft/ArrowRight comparison, live
  image position, close/backdrop/Escape, and trigger-focus restoration.
  Guest HTML is `private, no-store`; private prompts, provider/model data,
  unrelated media, account sessions, and mutation/telemetry hooks are absent.
- Focal research is discoverable from Knowledge Patterns only with
  `design.catalog.read`, uses exactly approved fictional fixtures, and owns a
  localized distinct route title without loading creator images.
- Offer accessible semantic presentation HTML and the genuinely tagged,
  multilingual browser-rendered PDF export. Its document language, heading,
  paragraph/list structure, MCIDs, and reading order are verified against
  Poppler. The legacy text-only PDF helper remains untagged. Neither path has
  independent assistive-technology or formal PDF/UA certification; do not claim
  that certification or treat source-level checks as a human audit.

## Output requirements and delivery

`<forma-output-requirement-card>` is a store-independent organism for requested
deliverables. It renders native forms in light DOM and takes property-only
`snapshot`, `resourceState`, `presentation`, `editorState`, and `readOnlyReason`.
The authorized snapshot includes the Document and authorization scope, expected
revision, authored text, structured requirements, permitted source choices,
whole-scope progress, and exact result references. Its host supplies translated
status descriptions; authored text and stable identifiers are not translated.

The card emits `forma-output-edit`, `forma-output-save`, `forma-output-cancel`,
`forma-output-review-plan`, and `forma-output-open-result` intents. Save intent
retains a mutation identity and expected revision; it grants no payment or
execution authority. A conflict preserves the local draft for an explicit
decision. Unknown quantities stay unresolved. Exact counts, authored ranges,
accepted flexibility, and suggested aims remain separate. Optional work stays
optional until chosen. Unsupported schema versions are read-only and retained.
There are no influence, Include, Prefer, Avoid, or Never controls for Output
requirements. Its canonical demonstration mounts the real card with an
explicitly fictional, read-only snapshot and no result URLs.

`<forma-output-requirements>` is the authenticated application controller. Its
property-only `documentId`, optional `blockId`, and `surface` select a Document,
one requirement card, or a Document/Project/Deliver view; they do not grant
access. The host owns scoped loading, conditional writes, conflict responses,
file adoption, exact-target checks, review, and authorized downloads. Confirming
requirements does not run providers or authorize payment. Generation preflight,
spending authorization, and execution are separate actions. Run selection does
not reduce the owed scope. Execution, checks, review, freshness, availability,
and capability are distinct facts; a finished operation is not an accepted
assignment. A partial download is explicitly identified and retains the
missing-work manifest.

The controller's catalog demonstration composes existing presentational
primitives and never imports or mounts the controller. Neither demonstration
subscribes to application state, reads private media, calls a provider, grants
payment authority, downloads files, or mutates data. Both entries have English,
French, Arabic, and Japanese catalog descriptions. Their API references come
from the generated Custom Elements Manifest, not manually invented slots or
attributes. Run `pnpm cem` and `pnpm cem:check` after integration, and verify
both generated manifests alongside the component and localization tests.

## Synthetic documentation and machine-readable contracts

The living reference never mounts production application elements, subscribes
to creator events, loads private media, contacts providers, modifies durable
records, or navigates away. Its immutable fictional examples cover six
audiences, one/two/many workspaces, bounded task lists, Creator-versus-Canvas
continuity, separately authorized Evaluation, and exact-resource guest review.

Run `pnpm cem` after component changes and `pnpm cem:check` during validation.
`custom-elements.json` and `public/custom-elements.json` must match. Each
navigation component documents category, light render root, `stateful: false`,
property-only `.destinations`, actual `forma-navigate`, localized
`destinations[].label`/`.description`, invariant
`destinations[].value`/`.href`, and a canonical
`/knowledge/design-system#<element-name>` demonstration URL.

These manifests also power live API disclosures, component discovery, external
tooling, and independent consumer contracts; new reusable work is not published
until every corresponding surface, translated live catalog entry, semantic
contract, and generated manifest agrees.

`DESIGN.md` owns visual and interaction policy; `ARCHITECTURE.md` owns
authorization, application boundaries, and protected delivery contracts.

## Exact artifact review and export entry

Document, Canvas, Activity, Library, and Deliver retain the same generated artifact,
source-health projection, review events, assignment records, and export executor.
`forma-document-artifacts.openArtifactById` accepts an expected revision, an
optional SHA-256 of the exact retained content, and an `inspect`, `review`, or
`export` disclosure intent. These intents never approve, download, or generate
anything by themselves. Canvas may provide a current-scope callback; it checks
source and board identity while opening and preserves authorized output editing
after the viewer has opened. Source changes still invalidate review and release.

Revision links preserve their requested revision and hash. A stale link offers an
explicit way to open the current output rather than substituting it. The shared
viewer displays the actual retained byte hash, exact review assignment, current
source blockers, and existing export choices. Each action remains server-checked
against current permissions, independent authorship, retained bytes, rights, and
revision at commit. The standard buttons, disclosure, native modal, and focus
foundation remain in use; no new visual primitive is introduced.

A `DocumentArtifactExported` event is the existing pre-download authorization
receipt. It does not prove a completed local download or recipient delivery.
Independent approval records, export acknowledgments, and saved work are counted
separately. Unmanaged legacy outputs without a source manifest retain a clearly
labeled **Export unreviewed draft** path, with current access, rights, private
retention, and exact bytes checked. They are never counted as independently
approved delivery, and inspecting or exporting them does not require new spending.

## Exact paid adaptive proposal changes

Document Adaptive path and Canvas paid suggestion buttons share the
component-lifetime `AdaptiveProposalReviewController` and
`renderAdaptiveProposalDialog`. The latter consumes the same
`renderAuthoringPreview` as Context Intelligence and free document copying;
it does not create a second approval model or authoring store.

The read-only `FormaStore.adaptiveProposalSource` exposes only an exact
current-authority paid execution and its retained binding proof. General job
pages do not supply that private proof. A surviving exact job’s metadata
binding hash supports receipt lookup only, with no private structure or Apply
authority. The explicit **Retrieve this original proposal** action uses the
existing exact job inspection, never a new quote or provider execution. Suggestions keep their immutable JSON-pointer IDs;
new native decisions are the default, edits require a named same-destination
native target, and Canvas creation previews include the reviewed placement.

Only `/api/context/adaptive/apply` applies paid suggestions. A server preview
discloses original/current source hashes, exact destinations and changes.
Apply submits only its immutable preview ID and approval hash. The hosts do not
append client events or treat a partial append as success. Closing preserves
the current component's own draft and exact handle; a lost response permits
read-only retrieval, not automatic reapplication. Source/permission withdrawal
removes private review bytes while retaining content-free recovery identity.
A certified expired lease permits only an explicit same-handle retry; a stale
expired lease permits explicit same-handle dismissal before a fresh review.
Read-only checking recognizes a completed dismissal after a lost response.

Fresh hosts can resume a retained unapplied review. If legacy resume returns a
latest applied result without an exact handle or selection, it only offers
explicit receipt discovery; it does not select that latest result. After private
preview expiry, exact
paid-execution receipt discovery shows explicit paginated choices without
reconstructing private edits or selecting a latest result. This lookup requires
the exact paid execution and binding identity. Private-content erasure does
not itself erase the job’s metadata binding; that existing metadata is reused
first when available. If the job has also expired or its identity is absent,
explicit destination-scoped metadata discovery lists only the current actor’s
canonical receipts in this exact destination. Each row remains an explicit read-only choice; neither path invents
a missing hash or reconstructs text from the current document. Canonical receipts
confirm authorship, never independent approval, export, delivery, provider
quality, or ROI. Native dialog and keyboard/assistive-technology verification
remains an integration obligation, separate from mocked host tests.
