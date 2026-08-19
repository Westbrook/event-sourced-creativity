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

Canonical routes begin with `/laboratory`. Replay and focal-point comparison are the first two laboratories.

## Shared platform

- `src/platform/` contains the application catalog, canonical route ownership, and cross-application contracts.
- `src/model/` contains pure event, projection, prompt, spatial, and evaluation contracts.
- `src/state/` is the browser adapter over the shared event API.
- `src/components/` contains reusable Lit UI and legacy page implementations consumed through an application entry.
- `worker/` owns authenticated APIs, policy enforcement, provider adapters, and shared persistence.
- `db/` and `drizzle/` own the one schema used by every application.

## Dependency rules

1. `src/apps/<app>/` may import the shared platform; it must not import a sibling application.
2. Shared model, state, component, worker, and database code may not import an application entry. The root shell, build tooling, and worker may use `src/platform/applications.ts` to select an owner without importing its implementation.
3. The root shell may read the application catalog and load an application entry; it may not render application pages itself.
4. Every canonical route declares one application owner and one build entry.
5. New Create approaches register inside Creative and reuse the existing document identity, events, jobs, generations, and projections.
6. Cross-application navigation uses URLs. Cross-application data exchange uses shared contracts, never component imports.

These rules are enforced by the application-boundary tests and the production manifest.
