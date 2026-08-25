# Application architecture

The product is one event-sourced platform with six independently loaded,
audience-authorized applications. They share durable domain contracts and
presentational foundations; they do not share route ownership, sibling imports,
creative-store hydration, or access to another audience's private data.

## Application boundaries

### Creator Workspace

Owns the Creator-scoped `/projects` and `/library` routes, Create, documents,
Re-entry, Scout, and Taste & time. It may append user-authorized creative events
and consume creative projections. Projects and Library are shared capabilities,
not Creator-exclusive data domains: Canvas presents the identical records under
its own routes without duplicating projects, documents, events, or media.

The current Create experience remains the baseline. Future Create approaches belong below `src/apps/creative/create/` and use `/creative/create/...` for their application routes. They must operate on the same document stream and projections rather than creating a parallel data model.

### Canvas

Owns named, project-scoped spatial workspaces and report-space proposals. Canvas is an alternative authoring interface over the same projects, documents, blocks, collections, outputs, users, and project membership boundaries as Creative. Canvas-native blocks remain visible in the project Library.

Spatial placement is its own projection: moving or grouping an item never changes its source content and never enters generation context until a person emits `ContextSetFormalized`. URL-only lenses may reorder or filter a view without creating events. Cursor presence is ephemeral and must not enter the durable stream.

Canonical routes begin with `/canvas`. `/canvas/projects` and `/canvas/library`
are Canvas-owned task surfaces for the same authoritative projects and reusable
resources available at `/projects` and `/library`. Their dynamic Library
previews, block editor, project selection, collection links, deep links, page
metadata, performance families, and navigation chrome remain Canvas-owned.
The Canvas entry lazily imports the same reusable Projects and Library page
components; it does not import the Creator application entry or hydrate a
second store. Ordinary same-workspace navigation never silently switches
applications. Document editing remains a clearly labeled, server-revalidated
handoff to Creator Workspace. `src/canvas/` owns the spatial projection and UI,
while `src/sync/` and `worker/realtime/` own personal offline operation
delivery and admission.

### Platform Operations

Owns server-authorized platform access, provider policy, governed releases,
platform health, and accountable operational decisions. Route, asset, and API
capabilities are evaluated independently.

Canonical routes begin with `/operations`. Historical `/system` links remain
compatibility aliases; former event inspection routes resolve to Engineering.

### Product & Quality

Owns separately authorized aggregate product insights, delivery readiness, and
synthetic evaluation. Reporting suppresses small populations, excludes fictional
activity, and never returns private projects, documents, prompts, media,
individual creator histories, or provider credentials. Evaluation requires its
own capability.

Canonical routes begin with `/product`. Historical `/operations/analytics`,
`/laboratory`, and replay aliases resolve to their Product & Quality owner and
still require the receiving module's capability.

### Design & Knowledge

Owns approved reusable component contracts, synthetic-only audience and
navigation patterns, and design/accessibility/localization guidance. Its shell
and routes are store-independent and never hydrate creator history.

Canonical routes begin with `/knowledge`. `/knowledge/design-system`,
`/knowledge/patterns`, and `/knowledge/guidance` provide distinct Components,
Patterns, and Guidance views. Historical `/laboratory/design-system` and focal
point URLs resolve to their appropriate Knowledge destination.

### Engineering Diagnostics

Owns independently granted operational diagnostics, redacted event/sync health,
and background-job reliability. Projections exclude private creator documents,
prompts, media, provider secrets, and personal attention signals.

Canonical routes begin with `/engineering`. Historical `/operations/events` and
`/admin/events` URLs resolve to Engineering and cannot bypass its capability.

### Exact-resource public review

`/share/:token` is a separate unauthenticated delivery boundary, not a seventh
signed-in application. Its store-independent entry exposes only the exact
immutable shared resource and approved owner-scoped media; it never hydrates
account sessions, creative events, application launchers, or internal chunks.

## Shared platform

- `src/platform/` contains the application catalog, canonical route ownership, and cross-application contracts.
- `src/platform/capabilities.ts` defines scoped capability names;
  `worker/access-policy.ts` validates active grants, accepted memberships,
  organization/project scope, revocation, and permission epochs.
- `src/platform/session-controller.ts` supplies minimized internal sessions;
  `<forma-platform-shell>` composes Operations, Product, Knowledge, and Engineering without
  loading the creator event store.
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
   HTML, protected JavaScript, API responses, or application hydration;
   client-side route visibility is never an access-control boundary.
10. Active, user-authorized creative decisions alone may reach provider-facing
    generation prompts; inactive decisions and internal identifiers are removed.

These rules are enforced by the application-boundary tests and the production manifest.

## Native form ownership and submission

Every editable control belongs to the native `<form>` for the user action it
serves. Forms are scoped to one intention: searching existing work must not
create new work, changing a local decision must not submit its containing
document, and cancellation or destructive actions must never become implicit
submitters. Immediately applied preferences still receive a harmless,
independently scoped owner; read-only receipts and generated sharing links are
display surfaces rather than submission inputs.

- Application and presentational form controls render in light DOM, so their
  native inputs already participate in an ancestor form. Do not wrap reusable
  control primitives in their own forms.
- Native forms never nest, including across light-DOM custom elements or dialogs
  shown in the top layer. When local and global actions share a visual layout,
  use sibling forms with stable IDs and explicitly associate each native
  control and submit button through its `form` attribute.
- Put the business action in a `submit` listener and synchronously call
  `preventDefault()`. Mark primary buttons `type="submit"`; mark close,
  cancel, navigation, clear, destructive, and other secondary controls
  `type="button"`. The `forma-ui-button` primitive defaults to `button`, so
  custom-element submitters must opt in explicitly.
- Keep ordinary multiline editing native. Established Enter-to-send and
  Command/Control-Enter shortcuts must preserve composition and modifier
  behavior, respect disabled submitters, and enter the same validated submit
  path through `requestSubmit()`.
- Paid or privileged submissions additionally require the existing consent,
  budget, one-use server authorization, trusted direct submit-button activation,
  and available browser user activation. Configuration fields are associated
  with a separate nonauthorizing form; synthetic submission cannot bypass the
  direct-user boundary.

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
- Raw cross-account analytics, provider policy, and actual-data impersonation
  remain platform-authorized. Product readers receive only approved aggregate
  reporting; synthetic evaluation requires its own grant.
- Customer Workspace Administration is a scoped Creator Settings child, never a
  seventh application. Accepted organization membership, exact project grants,
  opaque project-context sessions, owner-preserving project event sidecars, and
  per-resource R2/content manifests restrict collaborator reads and edits.
- Project-scoped reservations enforce the creator, exact organization, and
  platform token/USD limits together; registered project owners are charged to
  that organization when they generate from their normal Creator Workspace.
  Authorized project editors receive actor-owned provider jobs and private
  conversations against the owner's canonical project history; immutable
  actor/organization/project receipts, personal-plus-tenant-plus-platform
  spending limits, fair cross-actor scheduling, and immediate cancellation
  preserve custody. Canvas requires its own exact project grant and canonical
  release approval: viewers can inspect a board, while editors can author it.
  Public review still requires its separately authorized exact-resource share.

## Synchronization and performance

Canvas actions are staged optimistically, grouped, idempotent, and flushed in
client order. Idle delta polls do not reload private content or republish
unchanged projections. Private content is hydrated only on first load or when a
newly observed event introduces an unknown content reference.

Database bootstrap runs once per worker isolate rather than on every request.
Existing user identities avoid redundant database writes. Mergeable Canvas text
is indexed by item before projection so unedited items never allocate a Yjs
document or repeatedly scan unrelated events.

These measures support real cross-account project editing and board
convergence: exact project ACLs, immutable owner-stream/project sequence
sidecars, actor-bound device receipts, scoped offline queues, and authenticated
adaptive delta polling synchronize shared board state without changing the
single canonical owner history. Browser-local BroadcastChannel presence is
not cross-account cursor presence; a future remote-cursor experience would
still require separately authenticated ephemeral fan-out, expiry, and conflict
policies. It is not required for the implemented durable collaboration model.

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
reusable production patterns. `/knowledge/design-system` demonstrates the real
implementation across foundations, atoms, molecules, organisms, and templates.
`/knowledge/patterns` demonstrates audience surfaces, workspace handoffs,
authorized task navigation, and Creator-versus-Canvas continuity;
`/knowledge/guidance` publishes approved privacy and interaction rules. The
same primitives render creator tasks, internal application shells, reporting,
operational access management, the public welcome experience, and exact-token
guest review. Repeated controls are architectural dependencies of the shared
design system, not independently recreated audience-specific markup. Search the
live catalog and Custom Elements Manifest before introducing an interface;
reuse an existing contract, extend the nearest shared contract, or document why
a genuinely new primitive is necessary. Promote repeated patterns and migrate
all existing public, guest, and application consumers together. Publish the
actual safe live demonstration, every supported-language catalog description,
human documentation, accurate semantic event/property/token contracts, both
generated manifests, and regression coverage in the same change.

Public-safe modules must remain independently importable without Lit,
application-wide translation catalogs, authenticated state, provider adapters,
network side effects, or protected assets. Canonical language-option records
live in a pure, DOM-free module usable by browser, worker, and Node consumers;
the native light-DOM `<forma-ui-language-picker>` imports that registry without
importing application localization. Its hosts alone own locale loading,
persistence, routing, announcements, and authorization boundaries. This narrow
framework-free custom-element exception preserves public-route performance
while exposing the same documented production control everywhere.

Every dialog enters the browser top layer through one accessible,
independently testable modal contract. The dependency-free
`src/components/design-system/native-dialog.ts` foundation is safe for the
public welcome route; the existing application-level `modal-dialog.ts` wrapper
adds authenticated-surface localization without making that catalog an
architectural dependency of public or guest experiences.

`src/components/design-system/` groups independently importable atom, form,
navigation, feedback, and layout families behind one small shared contract. UI
elements never import the application store. `<forma-ui-workspace-switcher>`
and `<forma-ui-audience-navigation>` receive property-only, already-authorized
destinations and emit cancelable intent; they are not authorization boundaries.
Two available workspaces remain direct native links; larger authorized sets use
a current-workspace button and a browser-managed, light-dismiss auto popover
containing ordinary navigation links, never a form-value picker or modal trap.
Native form controls, overlays,
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

The Design & Knowledge reference and its searchable metadata are route-lazy and
store-independent. Application-pattern demonstrations safely compose
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
Treat a failing check, an undocumented repeated control, a fictional component
preview, or a public/private dependency leak as a release blocker rather than
postponed design-system maintenance.

CSS uses preference-reactive semantic tokens, browser-controlled font sizing,
stable focus and hover geometry, reduced-motion/transparency accommodations,
and balanced borders. Route-level applications own their specialized CSS; future
work should continue moving the remaining global component rules into isolated
tokens, primitives, patterns, and application-local style modules.
