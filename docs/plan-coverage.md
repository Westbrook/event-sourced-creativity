# Forma plan coverage

This ledger reconciles Revision 2.1 of the synthesis/build plan with the kickoff addendum and the adopted pilot baseline. “Operational” means the interaction is server-enforced, appends a durable fact, or derives from those facts. “Evaluation” means the product contract is active but still requires pilot evidence.

| Slice | Status | Implemented evidence | Remaining gate |
|---|---|---|---|
| Phase 0 | Operational | Append-only decision ledger, authenticated identities, admin/creator/agent/viewer roles, consent receipt, configurable policy | Production organization membership and wider access remain pilot operations |
| Phase 1 | Operational | Immutable D1 log, actor permissions, partial batches, stale-sequence checks, authored-wins fold, persistent compensation, navigable document projection, collection validation, standalone stream viewer and replay lab | Production Postgres/Timescale topology is outside this Sites slice |
| Phase 2 | Operational with accepted debt | Deterministic context snapshots, citations, server-side OpenAI Responses adapter, structured output, token receipts, hard-cap reservation | D-0019 records the second-provider debt; revisit before Phase 7 production rollout or general availability |
| Phase 3 | Operational | Editable chips/swatches, confidence text, authority labels, compensation semantics, real upload extraction, fixed v1 corpus, executable 10% correction-rate gate, durable evaluation receipts | Expand the corpus with representative licensed pilot references while keeping the frozen baseline |
| Phase 4 | Operational | Provenance inspector, context diff, side-by-side comparison, rights receipt at export, region-promotion event seam | Attribution algorithm and influence-taint policy remain open |
| Phase 5 | Operational | Chat proposal → preview → explicit accept/reject; 30-day externalized private content; expected sequence; same committed event vocabulary | Pilot evaluation of proposal quality |
| Phase 5.5 | Operational | Authored nested collection tree, handles, filing/moving, duplicate and cycle validation, family promotion | Multi-membership deliberately absent |
| Phase 6 | Operational with monitoring | Server-owned close snapshots, continuity delta, warm-thread composition, replayable item destinations, rejected-path memory, atomic `BriefComposed` + impression batches, accept/ignore/dismiss, new-document blank canvas, cold-start threshold, private optional intent, cost and dosage projections, durable advance-with-monitoring receipt | Continue collecting impression-denominated acceptance, cost, and dosage evidence; revisit the decision as the pilot sample grows |
| Phase 7 | Operational pilot | Versioned rebuildable vector projection, collection-filter metadata, event-derived family clustering, worker-only family claims, edge correction by `ClaimSuperseded`, embedding freshness, private cited few-shot retrieval in chat | Production pgvector/HNSW scale, representative licensed corpus, and the D-0019 second-provider revisit before production rollout |
| Phase 8 | Operational pilot | Per-thread trajectory slices, typed convergence/divergence/stall/adjacency observations, stable evidence references, rejected-path memory, hard planning envelopes, planned budget terminals, run-grouped report space, precision-per-dollar ledger, report-only candidate generations, and explicit user promotion | Collect human judgments by observation type; deterministic pilot generations do not claim production model quality |
| Phase 9 | Evaluation | Versioned bi-temporal beliefs, visible 60-day decay, authored standing constraints compiled into every generation, ranking-only inferred capsule, affirm/revoke/forget paths, axis-resolved output critiques, promotion KPI, as-of history viewer, and scheduler-owned conditions/resurfacing | Tune decay and ranking from witnessed promotion and critique evidence; inferred taste must never become a filter |
| Phase 10 | Operational | Project-wide document browser, focused block/output/family previews, cited block-to-output relationships, explicit recent-versus-kept output semantics, reusable library, archive import/export, lossless downloads, expiring revocable read-only share projections | Broader team/community publication remains out of scope |

## Adopted pilot controls

- Identity uses authenticated Sites or Cloudflare Access headers; the first private-site user is bootstrapped as admin and all authorization remains server-side.
- Generation uses OpenAI Responses with `store: false`, a privacy-preserving safety identifier, structured output, and private content references rather than natural language in immutable payloads.
- Budgets reserve capacity before an external call, settle against reported token usage, and fail closed when user or workspace limits are reached.
- Prompt/provider content is redacted after 30 days; events retain only non-sensitive receipts and references.
- Uploads require explicit ownership or license confirmation. Shares are read-only, expire after at most seven days, and are immediately revocable.
- The Phase 3 deterministic suite extracts dimensions, a k-means palette, and dominant edge direction from uploaded references. The frozen corpus gate must pass globally and per extractor at a correction rate of 10% or less.
- Phase 6 composes no brief before three closed sessions and one dormant or unresolved thread. Composition and item impressions append atomically. The human gate advanced with monitoring after the evidence floor; evidence continues to accrue and no metric is treated as an automatic pass threshold.
- Phase 7 uses a deterministic, versioned local embedding projection for the private pilot. Rebuilding writes only inferred family claims; vectors and corpus rankings remain disposable projections, family edges are individually correctable, and keeping a family still requires an authored collection event.
- Phase 8 derives deterministic trajectory slices before a run, records a hard envelope, groups falsifiable observations by run, and treats exhaustion as a planned terminal. Candidate artifacts remain in Scout report space until a user promotes one into an authored document block.
- Phase 9 keeps authored standing constraints and inferred rankings visibly separate. A pilot 60-day exponential half-life is versioned, every inferred claim exposes confidence/evidence/freshness, and revocation or retraction leaves the durable history inspectable as of any sequence.

## Accepted delivery debt

- Phase 2's two-provider done-when is intentionally deferred under D-0019. The OpenAI adapter is the sole live pilot adapter; a second provider and same-context comparison are required before Phase 7 production rollout or general availability.
- Phase 7's private-pilot index deliberately does not claim production pgvector/HNSW scale. D-0022 keeps the projection contract and model/version receipts stable so that migration remains a rebuild, not an event rewrite.

## UI affordance audit

All visible buttons now do one of three explicit things: perform an event-backed action, navigate to a named destination, or remain disabled with the missing prerequisite in its label or tooltip. Project settings have a dedicated form; project state is a status rather than a false link. Collections use contextual create/rename dialogs, “File open document” records the document’s authored location, and collection navigation opens a filtered document view. Studio Library links land on Documents, Blocks, Outputs, or Families rather than a generic page. The project-wide Documents view appends `DocumentOpened` when switching active work. “Use in open document” creates a cited authored copy and returns to Studio. Blocks expose focused previews plus outputs whose compile receipts cite them; outputs have focused context previews and distinguish the complete recent trail from the explicitly kept set; aesthetic families open all cited members in a lightbox. Compare controls are disabled until two current-document outputs exist. Ask Forma proposes across the closed block taxonomy instead of defaulting every request to Direction. The authored-block composer, project editor, reference viewers, and collection editor are dialog elements with backdrop dismissal. Undo finds the latest safe reversible authored event and redo targets the newly appended replay event. The document action bar remains sticky. The account switch is labeled as explicit-click instrumentation; passive and dwell-time capture remain structurally unavailable, and Review governance deep-links to that policy. Uploaded reference palettes remain read-only evidence and image sampling contains no arbitrary color input.

## Administrative scenarios

- Creative loop: extraction → authored correction → compile → generate → compare → export.
- Asynchronous return: session close → brief/scout report space → judgment → user acceptance → document promotion.
- Concurrent pressure: inert model proposal, commutative actions, stale validation, partial progress, explicit rejection.
- Family promotion: inferred grouping remains separate from the user-authored collection that keeps it.

The replay laboratory can deterministically build 1,000, 10,000, or 50,000 events and replay any projection to any sequence without writing fixtures to D1.
