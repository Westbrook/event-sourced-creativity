# Forma

Forma is an event-sourced creative studio. A context document, provenance graph,
authored collections, generations, and re-entry brief are all rebuildable
projections over one append-only event stream.

## Product slice

- context blocks with authored/inferred/constraint authority
- generated studies compiled from cited block snapshots
- editable reflection chips with authority-restoring compensation
- deterministic uploaded-reference extraction with a fixed correction-rate quality gate
- event-derived re-entry briefs with cold-start protection, rejected-path memory, and measurable dosage
- versioned event-derived vectors, correctable aesthetic-family claims, and cited private few-shot retrieval
- authored collection tree with cycle and duplicate-membership validation
- chat proposals previewed before user acceptance
- provenance lineage and filterable event stream
- standalone event administration with projection inspection and as-of replay
- deterministic 1k/10k/50k theoretical interaction streams
- personal library plus lossless graph import/export
- durable D1 event storage and R2 reference uploads
- append-time actor permissions and optimistic sequence checks
- external storage for erasable natural-language content

Autonomous scout and taste-model behavior remains gated behind the Phase 6 brief
hypothesis and the human decisions recorded in `docs/decisions.ndjson`.

## Local development

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm dev
```

Validation:

```bash
pnpm build
pnpm lint
pnpm test
```

The UI is implemented entirely as Lit custom elements. `signal-polyfill` and
`signal-utils` are isolated behind `FormaStore` because both packages are still
experimental. React and framework-specific UI runtimes are not dependencies.

The System Architecture page exposes the Phase 3 extractor scorecard. Admins
can rerun the frozen corpus and append an `ExtractorEvaluationCompleted` receipt
without calling a model provider.

The Sessions page now runs the Phase 6 pilot from durable facts. Closing a
session captures its projection receipt; opening an eligible session composes a
bounded brief and witnesses every rendered item in the same append batch.

The Library page runs the Phase 7 private-pilot index. An admin rebuild derives
versioned vectors, worker-owned family claims, and a cited corpus from the
stream; correcting a family supersedes one inferred edge without deleting the
family, and promotion still requires an authored collection event.

The Event admin page can export a theoretical replay fixture. Rebuild it from
the command line with:

```bash
pnpm replay --file ./creative-loop-50000.json --as-of 32000 --projection context-document
```

The Sites runtime reads logical D1 and R2 bindings from
`.openai/hosting.json`. Database migrations live in `drizzle/`.
