# Forma components and audience-navigation patterns

Forma's design system is one shared production implementation for six focused
application surfaces, the public welcome page, and exact-resource guest review.
The living reference is `/knowledge/design-system`;
`/knowledge/patterns` presents audience and navigation compositions;
`/knowledge/guidance` publishes privacy, accessibility, and localization rules.
Every example is fictional and store-independent.

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
  do not use it as the transient cross-workspace navigation picker.
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
