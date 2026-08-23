# Forma

Forma is an event-sourced creative platform. Projects, reusable creative decisions,
spatial canvases, images, stories, screen scenes, presentations, storyboards, and
videos are coherent projections over durable append-only history. The underlying
history is infrastructure; the product experience is the creative work.

## Applications

The platform has six independently loaded, explicitly authorized applications
over shared domain contracts:

- **Creator Workspace** owns projects, Create, documents, the Library, Re-entry, creative intelligence, and personal privacy/sharing/spending.
- **Canvas** owns project-level spatial composition, direct manipulation, Combined Contexts, and document preparation.
- **Platform Operations** owns governed platform access, provider configuration, operational policy, and release decisions.
- **Product & Quality** owns privacy-preserving Insights, Delivery evidence, and separately authorized synthetic Evaluation.
- **Design & Knowledge** owns living Components, audience Patterns, and approved Guidance using fictional examples only.
- **Engineering Diagnostics** owns redacted event, synchronization, and job-health diagnostics.

Canonical application routes begin with `/projects`, `/canvas`, `/operations`,
`/product`, `/knowledge`, and `/engineering`. Existing document, project,
Library, and Canvas deep links remain server-addressable before hydration.
Historical `/system`, `/operations/analytics`, `/operations/events`, and
`/laboratory/*` URLs resolve to their newly authorized audience owners.
Exact-resource `/share/:token` review is a store-independent public boundary,
not a signed-in application.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for ownership, dependency, security, and
provider-boundary rules; [DESIGN.md](./DESIGN.md) for visual and interaction
contracts; [docs/components.md](./docs/components.md) for canonical audience
navigation and component integration; and
[docs/product-architecture-review.md](./docs/product-architecture-review.md)
for the product audit and future decision register.

## Product capabilities

- Shared projects, authored folders, independent reusable blocks, and document-owned context.
- Multiple complete document lenses, including direct editing, adaptive guidance, and chat.
- Project-level virtual Canvas with optimistic offline-safe actions, focused mode, direct manipulation, resizing, organization, and undo.
- Spatially scoped positive and negative decisions plus ordered, isolated Combined Contexts.
- Draft and full image generation, four prompt languages, grouped comparison, and explicit fan promotion.
- Durable document-derived short stories, scripted scenes, accessible presentations, illustrated storyboards, and reference-backed video.
- One shared output composer with audience, tone, frame count, video duration, image references, and explicit paid-operation consent.
- Project Library discovery, project-only archives, and focused deep links for every output family, not just still images.
- Privacy-preserving exact-resource sharing with immutable owner-scoped media manifests.
- Server-resumable jobs, provider preflight, moderation diagnostics, retained input receipts, and reservation settlement.
- Opt-in bounded attention signals, corrective Scout and taste evidence, outcome-oriented analytics, and reversible user control.
- Deterministic and explicitly approved actual-data Replay fixtures with isolated fictional identities.
- Six independently loadable audience applications, scoped capabilities, and fictional-only design documentation at `/knowledge/design-system`.

Autonomous behavior, provider experimentation, replay impersonation, sharing,
and Canvas access remain bounded by explicit server-side governance. Exact
project authorization, actor-private jobs and conversations, combined personal/
organization/platform budgets, owner-only review links, and authenticated
adaptive Canvas polling support real cross-account project collaboration.
Ephemeral cross-account live cursor presence is not implemented or claimed.

## Local development

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm dev
```

Validation:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm cem:check
```

The UI is implemented entirely as Lit custom elements. `signal-polyfill` and
`signal-utils` are isolated behind `FormaStore` because both packages are still
experimental. React and framework-specific UI runtimes are not dependencies.

Design & Knowledge at `/knowledge/design-system` presents the actual
store-independent foundations, atoms, molecules, organisms, and application
templates used by production surfaces. It is a review tool, not a second design
implementation. `/knowledge/patterns` demonstrates entitlement-safe workspace
switching and audience navigation; `/knowledge/guidance` explains approved
privacy, accessibility, localization, and architectural boundaries.

Every application-pattern entry also includes a clearly labeled interactive
composition assembled from the same production primitives and synthetic sample
content. Actual application elements are not mounted, so previews never read or
alter a project, initiate generation, or leave Design & Knowledge.

Cards, page headers, list items, notices, and disclosures also support genuine
default and named HTML slots for authored headings, media, rich content, and
independent actions. Their existing attribute-only shorthand remains supported.
Native form controls, transparent layouts, overlays, and production-critical
primitives retain light DOM; the five slotted composition elements share one
token-driven adopted stylesheet. Expand any component's API in Design & Knowledge
to inspect its actual slots, attribute fallback, events, and theme tokens.

The machine-readable Custom Elements Manifest is generated into
`custom-elements.json` and `public/custom-elements.json`. Run `pnpm cem` after
adding or changing custom-element declarations; `pnpm cem:check` verifies the
documented component inventory, real named/default slots, rendering boundaries,
and inherited theme contract stay synchronized with the application.

### Internationalized component infrastructure

The application and component library include English, French, and Arabic.
Language selection follows the browser preference initially, remains local to
the current device, and stays available before privacy consent and on shared
documents. Translations load only when their language is selected. Writing
direction, keyboard navigation, accessible announcements, plural categories,
numbers, dates, and script-aware typography update together.

Use the non-rendering locale foundation to override the language or regional
formatting for any composed subtree:

```html
<forma-ui-locale
  lang="fr"
  format-locale="fr-CA"
  time-zone="America/Toronto"
>
  <forma-ui-button value="save-direction" label="Enregistrer"></forma-ui-button>
</forma-ui-locale>
```

The corresponding JavaScript properties are `formatLocale` and `timeZone`.
Assign a dictionary to the property-only `messages` API to override component
messages within that scope. Nested locale scopes inherit parent settings and
overrides unless they explicitly replace them.

Authored headings, labels, descriptions, slot content, and option labels belong
to the integrator and should be translated or preserved as authored. Element
names, event names, CSS custom properties, routes, option values, action
values, form field names, and persisted identifiers are stable machine
contracts and must never be derived from translated text. The manifest exposes
supported locales, message-ID patterns, content ownership, property-only
collections, and invariant values through namespaced `x-forma.i18n` metadata.

The Replay laboratory can export theoretical fixtures. Rebuild one from the
command line with:

```bash
pnpm replay --file ./creative-loop-50000.json --as-of 32000 --projection context-document
```

The Sites runtime reads logical D1 and R2 bindings from
`.openai/hosting.json`. Database migrations live in `drizzle/`.

Provider credentials remain server-only. Never commit an API key, run a paid
actual-data fixture or provider evaluation without explicit human authorization,
or represent an internal membership receipt as a real collaborator invitation.
