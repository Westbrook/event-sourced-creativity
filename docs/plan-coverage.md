# Forma plan coverage

This ledger reconciles Revision 2.1 of the synthesis/build plan with the kickoff addendum and the adopted pilot baseline. “Operational” means the interaction is server-enforced, appends a durable fact, or derives from those facts. “Evaluation” means the product contract is active but still requires pilot evidence.

| Slice | Status | Implemented evidence | Remaining gate |
|---|---|---|---|
| Phase 0 | Operational | Append-only decision ledger, authenticated identities, admin/creator/agent/viewer roles, consent receipt, configurable policy | Production organization membership and wider access remain pilot operations |
| Phase 1 | Operational | Immutable D1 log, actor permissions, partial batches, stale-sequence checks, authored-wins fold, compensation, collection validation, standalone stream viewer and replay lab | Production Postgres/Timescale topology is outside this Sites slice |
| Phase 2 | Operational with accepted debt | Deterministic context snapshots, citations, server-side OpenAI Responses adapter, structured output, token receipts, hard-cap reservation | D-0019 records the second-provider debt; revisit before Phase 7 production rollout or general availability |
| Phase 3 | Operational | Editable chips/swatches, confidence text, authority labels, compensation semantics, real upload extraction, fixed v1 corpus, executable 10% correction-rate gate, durable evaluation receipts | Expand the corpus with representative licensed pilot references while keeping the frozen baseline |
| Phase 4 | Operational | Provenance inspector, context diff, side-by-side comparison, rights receipt at export, region-promotion event seam | Attribution algorithm and influence-taint policy remain open |
| Phase 5 | Operational | Chat proposal → preview → explicit accept/reject; 30-day externalized private content; expected sequence; same committed event vocabulary | Pilot evaluation of proposal quality |
| Phase 5.5 | Operational | Authored nested collection tree, handles, filing/moving, duplicate and cycle validation, family promotion | Multi-membership deliberately absent |
| Phase 6 | Evaluation | Server-owned close snapshots, continuity delta, warm-thread composition, replayable item destinations, rejected-path memory, atomic `BriefComposed` + impression batches, accept/ignore/dismiss, new-document blank canvas, cold-start threshold, private optional intent, cost and dosage projections, durable human gate-review receipt | After the evidence floor is reached, an authorized human must record advance, collect-more, or stop; no automatic pass threshold |
| Phase 7 | Operational pilot | Versioned rebuildable vector projection, collection-filter metadata, event-derived family clustering, worker-only family claims, edge correction by `ClaimSuperseded`, embedding freshness, private cited few-shot retrieval in chat | Production pgvector/HNSW scale, representative licensed corpus, and the D-0019 second-provider revisit before production rollout |
| Phase 8 | Gated | Scout report-space scenario, evidence/judgment events, producer permissions, hard budget ceilings | Autonomous execution remains outside the human-in-the-loop pilot |
| Phase 9 | Evaluation | Preference/time folds, condition UI, authority/history semantics, 30-day private-content redaction | Pilot evidence must tune decay semantics |
| Phase 10 | Operational | Reusable library, archive import/export, lossless downloads, expiring revocable read-only share projections | Broader team/community publication remains out of scope |

## Adopted pilot controls

- Identity uses authenticated Sites or Cloudflare Access headers; the first private-site user is bootstrapped as admin and all authorization remains server-side.
- Generation uses OpenAI Responses with `store: false`, a privacy-preserving safety identifier, structured output, and private content references rather than natural language in immutable payloads.
- Budgets reserve capacity before an external call, settle against reported token usage, and fail closed when user or workspace limits are reached.
- Prompt/provider content is redacted after 30 days; events retain only non-sensitive receipts and references.
- Uploads require explicit ownership or license confirmation. Shares are read-only, expire after at most seven days, and are immediately revocable.
- The Phase 3 deterministic suite extracts dimensions, a k-means palette, and dominant edge direction from uploaded references. The frozen corpus gate must pass globally and per extractor at a correction rate of 10% or less.
- Phase 6 composes no brief before three closed sessions and one dormant or unresolved thread. Composition and item impressions append atomically, and the pilot remains in evaluation until at least ten impressions support a human review of acceptance, cost, and dosage.
- Phase 7 uses a deterministic, versioned local embedding projection for the private pilot. Rebuilding writes only inferred family claims; vectors and corpus rankings remain disposable projections, family edges are individually correctable, and keeping a family still requires an authored collection event.

## Accepted delivery debt

- Phase 2's two-provider done-when is intentionally deferred under D-0019. The OpenAI adapter is the sole live pilot adapter; a second provider and same-context comparison are required before Phase 7 production rollout or general availability.
- Phase 7's private-pilot index deliberately does not claim production pgvector/HNSW scale. D-0022 keeps the projection contract and model/version receipts stable so that migration remains a rebuild, not an event rewrite.

## UI affordance audit

All visible buttons now do one of three explicit things: perform an event-backed action, navigate to a real route, or remain disabled with the blocking human decision in its label/tooltip. The prior inert project breadcrumb, account avatar, library links, block handles, swatches, comparison button, export button, output history, command search, inspector controls, and reference upload are operational. Re-entry actions carry exact comparison, block, or collection destinations and focus the intended surface. Blank canvas collects an initial document name and then creates only that document. The authored-block composer offers direction, subject, composition, style, lighting, exclusion, palette, and reference types; no block is appended before submission. Document renames and existing-block edits are inline, event-backed actions. Blocks support pointer drag-and-drop, adjacent keyboard move controls, reversible removal, and locked-state protection. Prior documents remain available to the Library projection. Uploaded references render their R2-backed media in both Studio and Library with an accessible failure state and an in-app original-image viewer. Upload rights are confirmed in a contextual dialog before bytes are stored. Extracted reference colors are read-only evidence; users may adopt a named derived palette or sample source pixels into a separate authored palette block. Collection filing retains command-equivalent buttons.

## Administrative scenarios

- Creative loop: extraction → authored correction → compile → generate → compare → export.
- Asynchronous return: session close → brief/scout report space → judgment → user acceptance → document promotion.
- Concurrent pressure: inert model proposal, commutative actions, stale validation, partial progress, explicit rejection.
- Family promotion: inferred grouping remains separate from the user-authored collection that keeps it.

The replay laboratory can deterministically build 1,000, 10,000, or 50,000 events and replay any projection to any sequence without writing fixtures to D1.
