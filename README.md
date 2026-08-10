# Forma

Forma is an event-sourced creative studio. A context document, provenance graph,
authored collections, generations, and re-entry brief are all rebuildable
projections over one append-only event stream.

## Product slice

- context blocks with authored/inferred/constraint authority
- generated studies compiled from cited block snapshots
- editable reflection chips with authority-restoring compensation
- authored collection tree with cycle and duplicate-membership validation
- chat proposals previewed before user acceptance
- provenance lineage and filterable event stream
- durable D1 event storage and R2 reference uploads
- append-time actor permissions and optimistic sequence checks
- external storage for erasable natural-language content

Autonomous scout and taste-model behavior remains gated behind the Phase 6 brief
hypothesis and the human decisions recorded in `docs/decisions.ndjson`.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Validation:

```bash
npm run build
npm run lint
npm test
```

The Sites runtime reads logical D1 and R2 bindings from
`.openai/hosting.json`. Database migrations live in `drizzle/`.
