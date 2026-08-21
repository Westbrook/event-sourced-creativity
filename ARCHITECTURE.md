# Application architecture

The product is one event-sourced platform with four independently loaded applications. They share durable data and domain contracts; they do not share route ownership or import each other.

## Application boundaries

### Creative

Owns projects, Create, documents, the Library, Re-entry, Scout, and Taste & time. It may append user-authorized creative events and consume creative projections.

The current Create experience remains the baseline. Future Create approaches belong below `src/apps/creative/create/` and use `/creative/create/...` for their application routes. They must operate on the same document stream and projections rather than creating a parallel data model.

### Canvas

Owns named, project-scoped spatial workspaces and report-space proposals. Canvas is an alternative authoring interface over the same projects, documents, blocks, collections, outputs, users, and project membership boundaries as Creative. Canvas-native blocks remain visible in the project Library.

Spatial placement is its own projection: moving or grouping an item never changes its source content and never enters generation context until a person emits `ContextSetFormalized`. URL-only lenses may reorder or filter a view without creating events. Cursor presence is ephemeral and must not enter the durable stream.

Canonical routes begin with `/canvas`. `src/canvas/` owns the spatial projection and UI, while `src/sync/` and `worker/realtime/` own offline operation delivery and admission.

### Operations

Owns governance, health, roles, producer permissions, and inspection of the durable stream. It explains and administers the platform but does not host creative experiments.

Canonical routes begin with `/operations`. Historical `/system` and `/admin/events` links remain compatibility aliases.

### Laboratory

Owns controlled experiments, comparison tooling, and reusable synthetic fixtures. A laboratory may read production-shaped data and save explicitly approved fixtures, but experimental controls must not silently mutate creative documents.

Each actual-data replay owns one fictional creator with a separate event stream, media namespace, and complete project graph. Administrators inspect that graph through a bounded impersonation session rather than copying it into a regular account. The effective fictional identity is always visible; every modifying request requires a fresh explicit confirmation, while cancellation or light-dismiss prevents the request. Personal attention, memory, taste, Scout, and re-entry evidence never cross this boundary, and provider costs remain attributable to the signed-in principal.

Canonical routes begin with `/laboratory`. Replay, image-adapter qualification,
focal-point comparison, and the living design system are separate laboratories.

## Shared platform

- `src/platform/` contains the application catalog, canonical route ownership, and cross-application contracts.
- `src/model/` contains pure event, projection, prompt, spatial, and evaluation contracts.
- `src/model/prompt-policy.ts` owns reusable provider-facing context sanitization,
  inactive-decision filtering, and output-independent creative guardrails.
- `src/model/share-scope.ts` owns immutable, document-scoped share and media contracts.
- `src/model/workspace-intelligence.ts` turns authored state into bounded, user-facing next actions.
- `src/model/generation-intent.ts` owns the dependency-injected preflight and
  explicit-risk-acknowledgment boundary for user-requested image generation.
- `src/state/` is the browser adapter over the shared event API.
- `src/components/` contains reusable Lit UI and page implementations consumed
  through an application entry. `FormaPresentationalElement` powers
  store-independent design primitives; `FormaElement` is the explicit
  store-connected application boundary.
- `worker/` owns authenticated APIs, policy enforcement, provider adapters, and shared persistence.
- `db/` and `drizzle/` own the one schema used by every application.

## Dependency rules

1. `src/apps/<app>/` may import the shared platform; it must not import a sibling application.
2. Shared model, state, component, worker, and database code may not import an application entry. The root shell, build tooling, and worker may use `src/platform/applications.ts` to select an owner without importing its implementation.
3. The root shell may read the application catalog and load an application entry; it may not render application pages itself.
4. Every canonical route declares one application owner and one build entry.
5. New Create approaches register inside Creative and reuse the existing document identity, events, jobs, generations, and projections.
6. Cross-application navigation uses URLs. Cross-application data exchange uses shared contracts, never component imports.
7. Presentational atoms and molecules may not import, observe, or mutate the
   application store; communicate user intent through named DOM events.
8. All output entry points reuse the same configuration, consent, readiness,
   reference-policy, durable-job, and inspection contracts.
9. URL resolution and authorization happen on the server before application
   hydration; client-side route visibility is never an access-control boundary.
10. Active, user-authorized creative decisions alone may reach provider-facing
    generation prompts; inactive decisions and internal identifiers are removed.

These rules are enforced by the application-boundary tests and the production manifest.

## Durable authoring and projection ownership

Projects define the creative boundary. Documents are scoped editable intentions;
Canvas boards are project-level spatial workspaces; blocks may belong to a
document or live independently in the project Library. Collections organize
existing objects without creating a second ownership hierarchy.

Image generations and every document artifact are first-class sibling outcomes.
They remain tied to their document and project, preserve the context used to
create them, and may become new authored inputs without flattening source
provenance. Combined Contexts retain target, role, ordered membership, isolation,
and relativity through image, story, scene, slide, storyboard, and video output.

Every compile or render request records the exact document, project, and source
block versions. Workspace-wide projections must select a compile receipt by its
document, never by whichever event happened last in another document.

## Privacy and sharing

The durable stream, private language store, and object store are account-scoped.
Public shares carry a separate immutable `share_scopes` row declaring owner,
resource kind, document ID, project ID, and exact authorized object keys.

- A share never exposes an entire user stream or an unrelated document.
- Shared media must belong to the resource's immutable media manifest and its
  owner's object-store namespace; possession of a share token alone is not enough.
- Private content, prompt, input, and intent references never cross public share
  serialization.
- Exporting a current document excludes unrelated project and account events.
- Project Library archives resolve ownership across documents, reusable blocks,
  collections, references, outputs, and boards before selecting events or media;
  interleaved history from another project never enters a project download.
- Analytics and Laboratory impersonation remain administrator-authorized.

## Synchronization and performance

Canvas actions are staged optimistically, grouped, idempotent, and flushed in
client order. Idle delta polls do not reload private content or republish
unchanged projections. Private content is hydrated only on first load or when a
newly observed event introduces an unknown content reference.

Database bootstrap runs once per worker isolate rather than on every request.
Existing user identities avoid redundant database writes. Mergeable Canvas text
is indexed by item before projection so unedited items never allocate a Yjs
document or repeatedly scan unrelated events.

These measures improve the existing single-account, same-stream model; they do
not turn browser-local BroadcastChannel presence into real multi-user
collaboration. Cross-account editing requires project-scoped streams or durable
project sequencers, project ACLs, authenticated session fan-out, presence
expiry, conflict policy, and a carefully rehearsed identity-preserving migration.

## Provider and prompt boundaries

Provider adapters consume normalized creative snapshots and explicit attachment
receipts. Disabled decisions, zero-weight decisions, implementation-only
identifiers, and unrelated private content are excluded before submission.
Positive and negative intent, spatial targeting, ordered reference pixels, and
Combined Context boundaries remain separate contracts rather than advisory copy.
The same policy applies to image-direction planning, conversation, adaptive
authoring, output rendering, and evaluation planning. Rendering requests use
semantic request-local decision and Combined Context aliases; durable document,
block, reference, media, and relationship identities remain server-side across
prose, bullets, JSON, and XML. Mutation-capable conversation alone retains the
specific editable IDs required to target an existing authored decision.

Paid generation is always an explicit user action. Server jobs survive page
reload, record provider status and immutable submitted inputs, and release
unused reservations on cancellation or failure. Provider-backed replay and
adapter evaluations require their separate explicit approval workflows.
Adaptive suggestions use the same document-specific readiness and risk-consent
contract as primary generation controls; a helpful recommendation is never a
shortcut around a blocked provider, unavailable budget, or unacknowledged risk.

## Design-system boundary

`src/components/design-primitives.ts` contains store-independent atoms and
molecules. `artifact-summary.ts`, shared modal behavior, complete output
composition, and outcome-driven next actions compose those foundations into
reusable production patterns. `/laboratory/design-system` demonstrates the real
implementation across foundations, atoms, molecules, organisms, and templates.
The same primitives render production project creation, Canvas onboarding,
creative intelligence, and the Operations capability inventory. Every product
dialog enters the browser top layer through one accessible, independently
testable modal contract.

`src/components/design-system/` groups independently importable atom, form,
navigation, feedback, and layout families behind one small shared contract. UI
elements never import the application store. Native form controls, overlays,
transparent layout scopes, production metrics, and application-connected
interfaces retain light DOM, inherited `--forma-*` theme tokens, and bubbling
named intent events. Five composition-heavy card, page-header, list-item,
notice, and disclosure elements instead inherit `FormaSlottedElement`, use real
open shadow roots, and expose 19 genuinely projected default/named slots. Every
instance adopts the same memoized constructable stylesheet; inherited theme
tokens style both fallback and authored content. Existing attributes remain
compatible, authored controls retain native click/form behavior, notice actions
stay outside live regions, and grouped disclosures coordinate peers within
their actual host tree. Complex option lists remain JavaScript-only, with their
complete record shapes documented for automation.

The Laboratory reference and its searchable metadata are route-lazy and
store-independent. Twelve application-pattern demonstrations safely compose
real presentational primitives around synthetic fixtures without importing or
mounting the corresponding application elements. They cannot subscribe to the
workspace, navigate, enqueue provider readiness, fetch media, or mutate user
data; each demonstration is explicitly identified as an isolated composition.
Expanding an API disclosure loads the canonical Custom
Elements Manifest once, only after the user explicitly requests complete API
details. `scripts/generate-custom-elements-manifest.mjs` statically analyzes
every registered element with the existing TypeScript compiler, emits CEM
schema 2.1.0 to `custom-elements.json` and `public/custom-elements.json`, and
records real attributes, properties, defaults, unions, semantic events, CSS
tokens, atomic roles, base classes, genuine shadow slots, render-root
boundaries, actual inheritance-derived application state, and links to the
isolated application-pattern demonstrations. Slot declarations are checked
bidirectionally against actual rendered templates; light-DOM elements cannot
advertise fictional slots or `::part` surfaces.
`pnpm cem:check` detects documentation drift without changing files.

CSS uses preference-reactive semantic tokens, browser-controlled font sizing,
stable focus and hover geometry, reduced-motion/transparency accommodations,
and balanced borders. Route-level applications own their specialized CSS; future
work should continue moving the remaining global component rules into isolated
tokens, primitives, patterns, and application-local style modules.
