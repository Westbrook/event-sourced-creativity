# Forma

Forma is an event-sourced creative platform. Projects, reusable creative decisions,
spatial canvases, images, stories, screen scenes, presentations, storyboards, and
videos are coherent projections over durable append-only history. The underlying
history is infrastructure; the product experience is the creative work.

## Applications

The platform has four independently loaded applications over shared domain contracts:

- **Creative** owns projects, Create, documents, the Library, Re-entry, Scout, and Taste & time.
- **Canvas** owns project-level spatial composition, direct manipulation, Combined Contexts, and document preparation.
- **Operations** owns governance, health, producer permissions, and durable-stream inspection.
- **Laboratory** owns controlled replay, image-adapter qualification, focal-point experiments, and the living atomic design system.

Canonical application routes begin with `/creative`, `/canvas`, `/operations`, and
`/laboratory`. Existing document, project, Library, and Canvas deep links remain
server-addressable before client hydration. Historical `/system` and `/admin/events`
URLs are compatibility aliases.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for ownership, dependency, security, and
provider-boundary rules; [DESIGN.md](./DESIGN.md) for visual and interaction
contracts; and [docs/product-architecture-review.md](./docs/product-architecture-review.md)
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
- Independently loadable Operations, Canvas, and Laboratory applications, including `/laboratory/design-system`.

Autonomous behavior, provider experimentation, replay impersonation, sharing,
and Canvas access remain bounded by explicit server-side governance. Cross-account
real-time collaboration is not claimed until project-scoped authorization and a
shared synchronization backend exist.

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

The design laboratory at `/laboratory/design-system` presents the actual
store-independent foundations, atoms, molecules, organisms, and application
templates used by production surfaces. It is a review tool, not a second design
implementation.

Every application-pattern entry also includes a clearly labeled interactive
composition assembled from the same production primitives and synthetic sample
content. The actual application element is not mounted, so previews never read
or alter a project, initiate generation, or navigate away from the Laboratory.

Cards, page headers, list items, notices, and disclosures also support genuine
default and named HTML slots for authored headings, media, rich content, and
independent actions. Their existing attribute-only shorthand remains supported.
Native form controls, transparent layouts, overlays, and production-critical
primitives retain light DOM; the five slotted composition elements share one
token-driven adopted stylesheet. Expand any component's API in the Laboratory
to inspect its actual slots, attribute fallback, events, and theme tokens.

The machine-readable Custom Elements Manifest is generated into
`custom-elements.json` and `public/custom-elements.json`. Run `pnpm cem` after
adding or changing custom-element declarations; `pnpm cem:check` verifies the
documented component inventory, real named/default slots, rendering boundaries,
and inherited theme contract stay synchronized with the application.

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
